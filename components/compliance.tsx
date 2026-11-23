"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "./ui";
import { GroupHeader } from "./page-tabs";
import { Chips, FilterBar } from "./filters";
import { Pick } from "./select";
import { CAT } from "./charts";
import { Card, Nothing, ReadError } from "./overview-parts";
import { NotConnectedNote, useDoor, AnswerFailure } from "./pending";
import { whenFull } from "./dataset-parts";
import { usePageFacts } from "./assistant";
import { IclLoad } from "./compliance-icl-load";
import { ComplianceMatrix } from "./compliance-matrix";
import { ICL, ICL_ID, coverage, plural, readCompliance, sameCustom, sameIds, standardColsOf, tidyCustom, useFirings } from "./compliance-parts";
import { useControls } from "@/lib/controls-status";
import { CONTROLS, FAMILIES } from "@/lib/guardrails";
import { useSession } from "@/lib/use-session";
import { ask, type Compliance, type ComplianceSave, type ControlCustom, type Door, type IclControl } from "@/lib/api/pending";

/**
 * Compliance: the catalogue's controls against the standards they answer to
 * and against the ABB ICL, with firings by control family.
 *
 * The standards and where each control is cited or placed in them are the
 * service's framework mapping (GET /api/controls `frameworks`); while it is
 * not read the columns are left out and the page says why, never filled
 * from the console's own copy. A citation is not enforcement, so the card
 * counts controls citing each standard and claims no coverage. The ABB ICL, its mapping and what this deployment changed
 * about a control come from the `compliance` door; the list is loaded through
 * `iclLoad` and the mapping and changes are saved together through
 * `complianceSave` (lib/api/pending.ts). Firings are read from the record
 * the Catalogue tab reads.
 */

const BAR = CAT[1];

export function ComplianceView() {
  const { answer, reload } = useDoor<Compliance>("compliance");
  const { session, loaded, can } = useSession();
  const firings = useFirings();
  // The standards' columns come from the service's mapping; none while it is not read.
  const controlsRead = useControls();
  const cols = useMemo(() => standardColsOf(controlsRead?.state === "ok" ? controlsRead.frameworks : null), [controlsRead]);
  const colsWhy = !controlsRead
    ? "Reading the standards from the platform…"
    : controlsRead.state !== "ok"
      ? `The standards are not shown: ${controlsRead.state === "pending" ? "the controls address is not built" : `the controls could not be read (${controlsRead.message})`}.`
      : controlsRead.frameworks === null
        ? "The standards are not shown: the platform's answer carries no framework list."
        : "";

  // What was just saved stands in for the record until the door answers again.
  const [held, setHeld] = useState<{ over: unknown; data: ReturnType<typeof readCompliance> } | null>(null);
  const server = useMemo(() => (held && held.over === answer ? held.data : readCompliance(answer?.state === "ok" ? answer.data : null)), [answer, held]);
  const connected = answer?.state === "ok";
  const list: IclControl[] | null = connected && server.icl ? server.icl.controls : null;

  /* ── changes not saved yet: only what differs from the record is kept ── */
  const [draftMap, setDraftMap] = useState<Record<string, string[]>>({});
  const [draftCustom, setDraftCustom] = useState<Record<string, ControlCustom | null>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [waits, setWaits] = useState<Door | null>(null);
  const [notice, setNotice] = useState("");

  const mappingOf = (id: string) => draftMap[id] ?? server.mapping[id] ?? [];
  const customOf = (id: string) => (id in draftCustom ? draftCustom[id] : server.custom[id] ?? null);
  const savedCustomOf = (id: string) => server.custom[id] ?? null;
  const changed = (id: string) => id in draftMap || id in draftCustom;

  const onMapping = (id: string, ids: string[]) => {
    setNotice("");
    setDraftMap((d) => {
      const next = { ...d };
      if (sameIds(ids, server.mapping[id] ?? [])) delete next[id];
      else next[id] = ids;
      return next;
    });
  };
  const onCustom = (id: string, custom: ControlCustom | null) => {
    setNotice("");
    setDraftCustom((d) => {
      const next = { ...d };
      if (sameCustom(custom, server.custom[id])) delete next[id];
      else next[id] = custom;
      return next;
    });
  };
  const onUndo = (id: string) => {
    const without = <T,>(d: Record<string, T>) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== id));
    setDraftMap(without);
    setDraftCustom(without);
  };
  const discard = () => {
    setDraftMap({});
    setDraftCustom({});
    setEditing(false);
    setSaveError("");
    setWaits(null);
  };

  const dirty = [...new Set([...Object.keys(draftMap), ...Object.keys(draftCustom)])];
  const needReason = CONTROLS.filter((c) => {
    const now = customOf(c.id);
    return now?.applies === false && !now.note?.trim();
  }).map((c) => c.id);

  // A notice is said once and clears itself.
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(id);
  }, [notice]);

  // Leaving the page with changes on it asks first.
  const unsaved = dirty.length > 0;
  useEffect(() => {
    if (!unsaved) return;
    const hold = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", hold);
    return () => window.removeEventListener("beforeunload", hold);
  }, [unsaved]);

  const save = async () => {
    if (!unsaved || needReason.length) return;
    const body: ComplianceSave = {};
    if (Object.keys(draftMap).length) {
      body.mapping = Object.fromEntries(Object.entries({ ...server.mapping, ...draftMap }).filter(([, ids]) => ids.length > 0));
    }
    if (Object.keys(draftCustom).length) {
      const merged: Record<string, ControlCustom> = { ...server.custom };
      for (const [id, c] of Object.entries(draftCustom)) {
        const kept = tidyCustom(c);
        if (kept) merged[id] = kept;
        else delete merged[id];
      }
      body.custom = merged;
    }
    setSaving(true);
    setSaveError("");
    const a = await ask<unknown>("complianceSave", { body });
    setSaving(false);
    if (a.state === "pending") {
      setWaits(a.door);
      return;
    }
    if (a.state === "error") {
      setSaveError(a.message);
      return;
    }
    setHeld({ over: answer, data: { icl: server.icl, mapping: body.mapping ?? server.mapping, custom: body.custom ?? server.custom } });
    setDraftMap({});
    setDraftCustom({});
    setEditing(false);
    setNotice("The changes are saved.");
    reload();
  };

  /* ── counted from the catalogue and the door ── */
  const cover = coverage(cols, mappingOf, customOf, list);
  const known = useMemo(() => new Set((list ?? []).map((x) => x.id)), [list]);
  const answeredBy = new Map<string, string[]>();
  for (const c of cover.applying) for (const id of mappingOf(c.id)) answeredBy.set(id, [...(answeredBy.get(id) ?? []), c.id]);
  const isMapped = (id: string) => mappingOf(id).some((x) => known.has(x));

  /* ── filters ── */
  const [family, setFamily] = useState("");
  const [std, setStd] = useState("");
  const [unmapped, setUnmapped] = useState(false);
  const col = cols.find((s) => s.id === std);
  const rows = CONTROLS.filter(
    (c) => (!family || c.family === family) && (!col || col.entries(c).length > 0) && (std !== ICL_ID || isMapped(c.id)) && (!unmapped || !isMapped(c.id)),
  );
  const filters = (family ? 1 : 0) + (std ? 1 : 0) + (unmapped ? 1 : 0);
  const pickStandard = (id: string) => {
    setStd(id);
    if (id === ICL_ID) setUnmapped(false);
  };

  /* ── why nothing can be written, when it cannot ── */
  const denied = loaded && session !== null && !can("configure");
  // Why nothing can be written, from what the address answered: not built only when the platform says so (501), else the refusal or failure in its words.
  const whyNot = !connected
    ? answer === null
      ? "Reading the compliance register…"
      : answer.state === "pending"
        ? "Not built yet: the platform does not answer this address"
        : answer.state === "error"
          ? `The compliance register could not be read: ${answer.message}`
          : ""
    : denied
      ? `Needs the "configure" permission. Your roles: ${session?.appRoles.join(", ") || "none"}.`
      : "";

  // Until the door has answered there is nothing to say about the list, and after a failed read only that it was not read.
  const noList = answer === null ? "" : answer.state === "error" ? "not read" : "not loaded";
  const iclSays = !list ? noList : `${cover.icl?.mapped ?? 0} of ${cover.applying.length}`;
  const totalFired = firings.record ? FAMILIES.reduce((n, f) => n + familyFired(f.id), 0) : 0;
  function familyFired(id: string): number {
    return CONTROLS.filter((c) => c.family === id).reduce((n, c) => n + (firings.fired(c) ?? 0), 0);
  }
  const lead = Math.max(0, ...FAMILIES.map((f) => familyFired(f.id)));
  const showFirings = firings.record !== null && !firings.noRecord;

  usePageFacts({
    controls: CONTROLS.length,
    applyingHere: cover.applying.length,
    // How many controls cite each standard (or are placed in one of its domains); a citation is not enforcement.
    controlsCitingEachStandard: cols.length ? Object.fromEntries(cols.map((s) => [s.short, cover.byStandard.get(s.id) ?? 0])) : colsWhy,
    abbIcl: !connected ? "not connected" : !list ? "no list loaded" : { controls: list.length, catalogueControlsMapped: cover.icl?.mapped ?? 0, notAnswered: cover.icl?.gaps.length ?? 0 },
    firingsByFamily: showFirings ? Object.fromEntries(FAMILIES.map((f) => [f.name, familyFired(f.id)])) : "no record",
    openControl: open,
    unsavedChanges: dirty.length,
  });

  const gaps = cover.icl?.gaps ?? [];

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7">
      <GroupHeader
        group="controls"
        tab="compliance"
        actions={
          <span title={whyNot || undefined}>
            <Button size="sm" variant="solid" tone="ink" permission="configure" disabled={!connected} onClick={() => setLoading(true)}>
              Load the {ICL}
            </Button>
          </span>
        }
      >
        The catalogue&rsquo;s {CONTROLS.length} controls against the standards they answer to and against the {ICL}, with firings by control family. A platform admin loads the{" "}
        {ICL} here, maps it to the catalogue and can mark a control as not applying to this deployment.
      </GroupHeader>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        {/* ── controls citing each standard: where they come from, not what is enforced ── */}
        <Card
          title="Controls citing each standard"
          hue="controls"
          meta={cover.left ? `of the ${cover.applying.length} controls that apply here` : `of the ${CONTROLS.length} controls`}
          footer={
            <span className="text-[11px] leading-[1.5] text-faint">
              A count says how many controls cite an entry of the standard, or are placed in one of its domains, as the platform maps them: where a control comes from, not that it is enforced. Whether each is enforced is on the Controls page.{" "}
              {cover.left > 0 && `${plural(cover.left, "control is", "controls are")} marked as not applying to this deployment and left out of every count. `}
              {unsaved && "The counts include the changes not saved yet. "}
              Pick a standard to see only its controls.
            </span>
          }
        >
          <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_auto] gap-x-3 px-4 py-1">
            {colsWhy && <p className="col-span-3 py-2 text-[11.5px] leading-[1.55] text-faint">{colsWhy}</p>}
            {(["cited", "grouped"] as const).filter((kind) => cols.some((s) => s.kind === kind)).map((kind) => (
              <CoverageGroup key={kind} label={kind === "cited" ? "Entries the catalogue cites" : "Domains each control is placed under"}>
                {cols.filter((s) => s.kind === kind).map((s) => {
                  const n = cover.byStandard.get(s.id) ?? 0;
                  return <CoverageRow key={s.id} name={s.short} title={[s.title, s.note].filter(Boolean).join(". ")} n={n} of={cover.applying.length} on={std === s.id} onPick={() => pickStandard(std === s.id ? "" : s.id)} />;
                })}
              </CoverageGroup>
            ))}
            <CoverageGroup label="The client's own list">
              {cover.icl ? (
                <CoverageRow name={ICL} title={`Catalogue controls mapped to at least one ${ICL} control`} n={cover.icl.mapped} of={cover.applying.length} on={std === ICL_ID} onPick={() => pickStandard(std === ICL_ID ? "" : ICL_ID)} />
              ) : (
                <div className="col-span-3 grid h-9 grid-cols-subgrid items-center">
                  <span className="truncate text-[12px] text-mist">{ICL}</span>
                  <span className="col-span-2 text-right text-[11.5px] text-faint">{noList && `List ${noList}`}</span>
                </div>
              )}
            </CoverageGroup>
          </div>
        </Card>

        <div className="flex min-w-0 flex-col gap-4">
          {/* ── firings by control family ── */}
          <Card
            title="Firings by control family"
            hue="controls"
            meta={showFirings && firings.record ? `${plural(totalFired, "firing")} over ${plural(firings.record.runs, "run")} on record` : undefined}
          >
            {firings.failed && firings.answer ? (
              <AnswerFailure className="px-4 py-4" answer={firings.answer} what="The record of control firings could not be read" />
            ) : !firings.record ? (
              <div className="h-14" />
            ) : totalFired === 0 ? (
              <Nothing>No control has fired in the {plural(firings.record.runs, "run")} on record.</Nothing>
            ) : (
              <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_auto] gap-x-3 px-4 py-1">
                {FAMILIES.map((f) => {
                  const n = familyFired(f.id);
                  const on = family === f.id;
                  // A family whose controls all act outside a run has no firing to count, which is not the same as none.
                  const counted = CONTROLS.some((c) => c.family === f.id && firings.fired(c) !== null);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      aria-pressed={on}
                      title={`${f.name}: ${counted ? `${plural(n, "firing")} across its ${plural(CONTROLS.filter((c) => c.family === f.id).length, "control")}` : "its controls act outside a run"}. Pick to see only this family.`}
                      onClick={() => setFamily(on ? "" : f.id)}
                      className={`focusable col-span-3 -mx-2 grid h-9 cursor-pointer grid-cols-subgrid items-center rounded-sm border-b border-line px-2 text-left last:border-0 hover:bg-raise/60 ${on ? "bg-raise" : ""}`}
                    >
                      <span className="truncate text-[12px] text-mist">{f.name}</span>
                      {counted ? (
                        <>
                          <span className="block h-1.5 overflow-hidden rounded-[2px] bg-raise" aria-hidden>
                            {n > 0 && <span className="block h-full min-w-[2px] rounded-[2px]" style={{ width: `${lead > 0 ? (n / lead) * 100 : 0}%`, background: BAR }} />}
                          </span>
                          <span className="tnum min-w-7 text-right font-mono text-[11px] text-dim">{n.toLocaleString("en-GB")}</span>
                        </>
                      ) : (
                        <span className="col-span-2 text-right text-[11.5px] text-faint">acts outside a run</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </Card>

          {/* ── the client's list ── */}
          <Card title={ICL} hue="controls" meta={list ? plural(list.length, "control") : undefined}>
            {answer === null ? (
              <div className="h-14" />
            ) : answer.state === "pending" ? (
              <div className="flex flex-col gap-1.5 px-4 py-4">
                <p className="text-[12px] leading-[1.55] text-dim">
                  No list is loaded. The {ICL} is the client&rsquo;s own control list: it is loaded here as a file and mapped to the catalogue. The console adds no control to it.
                </p>
                <NotConnectedNote door={answer.door} />
              </div>
            ) : answer.state === "error" ? (
              <div className="flex flex-wrap items-center gap-3 px-4 py-4">
                <p role="alert" className="min-w-0 grow text-[12px] leading-[1.55] text-err">
                  The list and its mapping could not be read: {answer.message}
                </p>
                <Button size="sm" variant="solid" tone="neutral" onClick={reload}>
                  Try again
                </Button>
              </div>
            ) : !server.icl ? (
              <Nothing>No list is loaded yet. Load the {ICL} as a CSV file to map the catalogue to it. Until then the {ICL} column of the matrix stays empty.</Nothing>
            ) : (
              <dl className="grid grid-cols-[112px_minmax(0,1fr)] gap-x-3 gap-y-1.5 px-4 py-3.5 text-[12px]">
                <dt className="text-faint">List</dt>
                <dd className="min-w-0 text-fg">
                  <span className="break-words">{server.icl.name}</span>
                  {server.icl.version && <span className="text-faint"> · version {server.icl.version}</span>}
                </dd>
                {(server.icl.loaded_at || server.icl.loaded_by) && (
                  <>
                    <dt className="text-faint">Loaded</dt>
                    <dd className="text-fg">{[whenFull(server.icl.loaded_at), server.icl.loaded_by?.name && `by ${server.icl.loaded_by.name}`].filter(Boolean).join(" ")}</dd>
                  </>
                )}
                <dt className="text-faint">Answered</dt>
                <dd className="tnum text-fg">
                  {server.icl.controls.length === 0
                    ? "The loaded list has no controls."
                    : `${(server.icl.controls.length - gaps.length).toLocaleString("en-GB")} of ${plural(server.icl.controls.length, "control")} answered by a catalogue control`}
                </dd>
                {gaps.length > 0 && (
                  <>
                    <dt className="text-faint">Not answered</dt>
                    <dd className="tnum text-fg">{plural(gaps.length, "control")}, listed below</dd>
                  </>
                )}
              </dl>
            )}
          </Card>
        </div>
      </div>

      {/* ── the gaps: ICL controls nothing in the catalogue answers ── */}
      {gaps.length > 0 && <Gaps gaps={gaps} total={list?.length ?? 0} left={cover.left} />}

      {/* ── the matrix ── */}
      <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1" aria-label="Controls against standards">
        <div className="flex flex-col gap-2.5 border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-[12.5px] font-semibold text-fg">Controls against standards</h2>
            <span className="tnum text-[11px] text-faint">{filters ? `${rows.length} of ${CONTROLS.length} controls` : `${CONTROLS.length} controls`}</span>
            <span className="grow" />
            {connected && answer.data?.updated_at && (
              <span className="text-[11px] text-faint">
                Last saved {whenFull(answer.data.updated_at)}
                {answer.data.updated_by?.name ? ` by ${answer.data.updated_by.name}` : ""}
              </span>
            )}
          </div>
          <p className="max-w-[110ch] text-[11.5px] leading-[1.55] text-faint">
            A cell lists the entries a control answers in that standard; rest on one for its name, or open the row for every reference in full. The first five standards are cited entry by
            entry; under NIST 800-53, NIST CSF 2.0 and ISO 27001 each control sits in one domain.
          </p>
          <FilterBar
            count={filters}
            onClear={() => {
              setFamily("");
              setStd("");
              setUnmapped(false);
            }}
          >
            <Chips
              label="Family"
              onToggle={(v) => setFamily(family === v ? "" : v)}
              items={FAMILIES.map((f) => ({ value: f.id, label: f.name, active: family === f.id, count: CONTROLS.filter((c) => c.family === f.id).length }))}
            />
            <label className="flex items-center gap-2">
              <span className="text-[11px] font-medium text-faint">Has an entry in</span>
              <span className="w-[172px]">
                <Pick
                  aria-label="Has an entry in"
                  value={std}
                  onChange={pickStandard}
                  options={[{ value: "", label: "Any standard" }, ...cols.map((s) => ({ value: s.id, label: s.short })), ...(list ? [{ value: ICL_ID, label: ICL }] : [])]}
                />
              </span>
            </label>
            <span title={list ? undefined : "No list is loaded"}>
              <button
                type="button"
                aria-pressed={unmapped}
                disabled={!list}
                onClick={() => {
                  setUnmapped(!unmapped);
                  if (std === ICL_ID) setStd("");
                }}
                className={`focusable inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-sm border px-2.5 text-[12px] font-medium whitespace-nowrap transition-colors duration-100 disabled:pointer-events-none disabled:opacity-40 ${
                  unmapped ? "border-transparent bg-ink text-on-ink" : "border-line bg-surface text-dim hover:bg-raise hover:text-fg"
                }`}
              >
                Not mapped to {ICL}
                {list && <span className={`tnum font-mono text-[10.5px] ${unmapped ? "opacity-70" : "text-faint"}`}>{CONTROLS.filter((c) => !isMapped(c.id)).length}</span>}
              </button>
            </span>
          </FilterBar>
        </div>
        <ComplianceMatrix
          rows={rows}
          cols={cols}
          counts={cover.byStandard}
          applying={cover.applying.length}
          list={list}
          iclSays={iclSays}
          mappingOf={mappingOf}
          customOf={customOf}
          savedCustomOf={savedCustomOf}
          changed={changed}
          answeredBy={answeredBy}
          firedOf={(c) => (showFirings ? firings.fired(c) : undefined)}
          open={open}
          onOpen={(id) => {
            setOpen(id);
            setEditing(false);
          }}
          editing={editing}
          onEdit={setEditing}
          whyNot={whyNot}
          onMapping={onMapping}
          onCustom={onCustom}
          onUndo={onUndo}
        />
      </section>

      {/* ── changes waiting to be saved ── */}
      {unsaved && (
        <div className="sticky bottom-4 z-30 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line-strong bg-surface px-4 py-2.5 elev-3" role="region" aria-label="Changes not saved">
          <span className="flex min-w-0 grow flex-col gap-0.5">
            <span className="text-[12.5px] font-semibold text-fg">
              {plural(dirty.length, "control has", "controls have")} changes not saved
              <span className="ml-2 font-mono text-[11px] font-normal text-faint">{dirty.slice(0, 4).join(", ")}{dirty.length > 4 ? ` and ${dirty.length - 4} more` : ""}</span>
            </span>
            {needReason.length > 0 ? (
              <span className="text-[11.5px] leading-[1.5] text-warn">{needReason.join(", ")} {needReason.length === 1 ? "is" : "are"} marked as not applying and {needReason.length === 1 ? "needs" : "need"} a reason first.</span>
            ) : waits ? (
              <NotConnectedNote door={waits} />
            ) : saveError ? (
              <span role="alert" className="text-[11.5px] leading-[1.5] text-err">
                The changes were not saved: {saveError}
              </span>
            ) : (
              <span className="text-[11.5px] leading-[1.5] text-faint">The mapping and the changes to controls are saved together.</span>
            )}
          </span>
          <Button size="sm" variant="solid" tone="err" disabled={saving} onClick={discard}>
            Discard
          </Button>
          <Button size="sm" variant="solid" tone="ink" permission="configure" disabled={needReason.length > 0 || Boolean(waits)} loading={saving} onClick={save}>
            Save changes
          </Button>
        </div>
      )}

      {/* ── what was just done, said where the person is looking, then gone ── */}
      {notice && !unsaved && (
        <p role="status" className="sticky bottom-4 z-30 w-fit rounded-lg border border-line-strong bg-surface px-4 py-2.5 text-[12.5px] font-medium text-fg elev-3">
          {notice}
        </p>
      )}

      {loading && (
        <IclLoad
          replaces={Boolean(server.icl)}
          onClose={() => setLoading(false)}
          onDone={() => {
            setLoading(false);
            setNotice(`The ${ICL} is loaded.`);
            reload();
          }}
        />
      )}
    </div>
  );
}

function CoverageGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="col-span-3 pt-2.5 pb-0.5 text-[10.5px] font-medium text-faint">{label}</span>
      {children}
    </>
  );
}

/** One standard: its name, the share of the applying controls with an entry in it, and the count. Picking it filters the matrix. */
function CoverageRow({ name, title, n, of, on, onPick }: { name: string; title: string; n: number; of: number; on: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onPick}
      className={`focusable col-span-3 -mx-2 grid h-9 cursor-pointer grid-cols-subgrid items-center rounded-sm border-b border-line px-2 text-left last:border-0 hover:bg-raise/60 ${on ? "bg-raise" : ""}`}
    >
      <span className="truncate text-[12px] text-mist">{name}</span>
      <span className="block h-1.5 overflow-hidden rounded-[2px] bg-raise" aria-hidden>
        {n > 0 && <span className="block h-full min-w-[2px] rounded-[2px]" style={{ width: `${of > 0 ? (n / of) * 100 : 0}%`, background: BAR }} />}
      </span>
      <span className="tnum text-right font-mono text-[11px] text-dim" aria-label={`${n} of ${of} controls`}>
        {n} of {of}
      </span>
    </button>
  );
}

/** The ICL controls no applying catalogue control answers, by the list's own domains. */
function Gaps({ gaps, total, left }: { gaps: IclControl[]; total: number; left: number }) {
  const [shut, setShut] = useState(false);
  const domains = [...new Set(gaps.map((g) => g.domain?.trim() || ""))].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b)));
  return (
    <Card
      title={`${ICL} controls no catalogue control answers`}
      hue="controls"
      meta={`${gaps.length.toLocaleString("en-GB")} of ${total.toLocaleString("en-GB")}`}
      action={
        <Button size="sm" variant="solid" tone="neutral" onClick={() => setShut(!shut)}>
          {shut ? "Show" : "Hide"}
        </Button>
      }
    >
      {!shut && (
        <>
          <p className="border-b border-line px-4 py-2.5 text-[11.5px] leading-[1.55] text-faint">
            To close one, open a catalogue control in the matrix and add it to that control&rsquo;s mapping.
            {left > 0 && " A mapping held by a control marked as not applying does not count as an answer."}
          </p>
          <div className="max-h-[300px] overflow-y-auto">
            {domains.map((d) => (
              <div key={d || "none"} className="flex flex-col">
                <span className="sticky top-0 border-b border-line bg-raise px-4 py-1.5 text-[11px] font-semibold text-dim">
                  {d || "No domain given"}
                  <span className="tnum ml-2 font-normal text-faint">{gaps.filter((g) => (g.domain?.trim() || "") === d).length}</span>
                </span>
                {gaps
                  .filter((g) => (g.domain?.trim() || "") === d)
                  .map((g) => (
                    <span key={g.id} className="flex items-baseline gap-3 border-b border-line px-4 py-1.5 text-[12px]">
                      <span className="w-[120px] shrink-0 truncate font-mono text-[11px] text-faint" title={g.id}>
                        {g.id}
                      </span>
                      <span className="min-w-0 text-fg">{g.title}</span>
                    </span>
                  ))}
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
