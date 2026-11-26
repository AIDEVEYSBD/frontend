"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Button, Tag } from "./ui";
import { Field, Input, Switch, Textarea } from "./forms";
import { SearchBox } from "./filters";
import { CONTROLS, FAMILIES, type Control } from "@/lib/guardrails";
import type { ControlCustom, IclControl } from "@/lib/api/pending";
import { EntryChip, ICL, plural, tidyCustom, type StandardCol } from "./compliance-parts";

/**
 * The matrix: one row per catalogue control, one column per standard, the
 * ABB ICL last. It scrolls inside its card with the header row and the
 * control column held in place. A row opens under itself to the control's
 * statement, every reference in full, its ICL mapping and what this
 * deployment has changed about it; with the `configure` permission the same
 * panel edits the mapping and the changes, which the page collects and saves
 * together.
 */

export interface MatrixProps {
  rows: Control[];
  /** The standards' columns, from the service's framework mapping (GET /api/controls); empty while it is not read. */
  cols: StandardCol[];
  /** Controls per standard, of the ones that apply here, for the header row. */
  counts: Map<string, number>;
  /** How many controls the counts are out of. */
  applying: number;
  /** The loaded list; null when there is none (not connected, unreadable, or not loaded yet). */
  list: IclControl[] | null;
  /** What the ICL column says under its name. */
  iclSays: string;
  mappingOf: (id: string) => string[];
  customOf: (id: string) => ControlCustom | null;
  /** The record as last saved, for undoing one control's changes. */
  savedCustomOf: (id: string) => ControlCustom | null;
  /** The control has changes that are not saved yet. */
  changed: (id: string) => boolean;
  /** Catalogue controls answering each ICL control, by ICL id. */
  answeredBy: Map<string, string[]>;
  /** How often a control fired on record; null when it acts outside a run, undefined when there is no record to count from. */
  firedOf: (c: Control) => number | null | undefined;
  open: string | null;
  onOpen: (id: string | null) => void;
  editing: boolean;
  onEdit: (on: boolean) => void;
  /** Why the page cannot write now; "" when it can. */
  whyNot: string;
  onMapping: (id: string, ids: string[]) => void;
  onCustom: (id: string, custom: ControlCustom | null) => void;
  onUndo: (id: string) => void;
}

// Whole-pixel line heights throughout: a held cell is painted on its own layer, and a row of fractional height puts its rule a pixel off its neighbours'.
const HEAD = "sticky top-0 z-20 border-b border-line-strong bg-surface px-2 py-2 align-bottom text-[10.5px] leading-[16px] font-medium text-faint";
const EDGE = "border-b border-line align-top transition-colors";
const CELL = `${EDGE} px-2 py-2`;

export function ComplianceMatrix(p: MatrixProps) {
  const { rows, list, open } = p;
  // The opened row's panel is as wide as the card, not as wide as the table, so it does not scroll sideways with the columns.
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = new ResizeObserver(() => setWidth(el.clientWidth));
    measure.observe(el);
    return () => measure.disconnect();
  }, []);
  const byId = useMemo(() => new Map((list ?? []).map((x) => [x.id, x])), [list]);
  const firstGrouped = p.cols.findIndex((s) => s.kind === "grouped");
  const span = p.cols.length + 2;

  return (
    <div ref={frame} className="max-h-[max(420px,calc(100vh-200px))] overflow-auto" role="region" aria-label="Controls against standards" tabIndex={0}>
      <table className="w-full min-w-[1064px] table-fixed border-separate border-spacing-0 text-left">
        <colgroup>
          <col className="w-[208px] lg:w-[272px]" />
          {p.cols.map((s) => (
            <col key={s.id} />
          ))}
          <col className="w-[168px]" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className={`${HEAD} left-0 z-30 border-r border-r-line pl-4`}>
              Control
            </th>
            {p.cols.map((s, i) => (
              <th key={s.id} scope="col" title={s.title} className={`${HEAD} ${i === firstGrouped ? "border-l border-l-line" : ""}`}>
                <span className="flex flex-col gap-0.5">
                  <span className="text-[11px] leading-[14px] font-semibold text-fg">{s.short}</span>
                  <span className="tnum leading-[16px] font-normal">
                    {p.counts.get(s.id) ?? 0} of {p.applying}
                  </span>
                </span>
              </th>
            ))}
            <th scope="col" className={`${HEAD} border-l border-l-line`}>
              <span className="flex flex-col gap-0.5">
                <span className="text-[11px] leading-[14px] font-semibold text-fg">{ICL}</span>
                <span className="tnum leading-[16px] font-normal">{p.iclSays}</span>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {FAMILIES.map((f) => {
            const mine = rows.filter((c) => c.family === f.id);
            if (!mine.length) return null;
            const all = CONTROLS.filter((c) => c.family === f.id).length;
            return (
              <Fragment key={f.id}>
                <tr>
                  <th scope="rowgroup" className="sticky left-0 z-10 border-r border-b border-line bg-raise py-1.5 pr-2 pl-4 text-left align-baseline">
                    <span className="flex items-baseline gap-2">
                      <span className="text-[12px] leading-[18px] font-semibold text-fg">{f.name}</span>
                      <span className="tnum text-[10.5px] leading-[18px] font-normal text-faint">{mine.length === all ? all : `${mine.length} of ${all}`}</span>
                    </span>
                  </th>
                  <td colSpan={span - 1} className="border-b border-line bg-raise px-2 py-1.5 text-[11px] leading-[18px] text-faint">
                    <span className="sticky left-[216px] lg:left-[280px]">{f.purpose}</span>
                  </td>
                </tr>
                {mine.map((c) => (
                  <ControlRow key={c.id} c={c} p={p} byId={byId} isOpen={open === c.id} firstGrouped={firstGrouped} span={span} width={width} />
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <p className="px-4 py-5 text-[12px] leading-[1.55] text-faint">No control matches these filters.</p>}
    </div>
  );
}

function ControlRow({ c, p, byId, isOpen, firstGrouped, span, width }: { c: Control; p: MatrixProps; byId: Map<string, IclControl>; isOpen: boolean; firstGrouped: number; span: number; width: number }) {
  const custom = tidyCustom(p.customOf(c.id));
  const off = custom?.applies === false;
  const mapped = p.mappingOf(c.id);
  const tint = isOpen ? "bg-raise" : "bg-surface group-hover/row:bg-raise";
  const SHOWN = 3;
  return (
    <>
      <tr className="group/row" data-control={c.id}>
        <th scope="row" className={`${EDGE} ${tint} sticky left-0 z-10 border-r border-r-line p-0 text-left font-normal`}>
          <button type="button" aria-expanded={isOpen} onClick={() => p.onOpen(isOpen ? null : c.id)} className="focusable flex w-full cursor-pointer items-start gap-2 py-2 pr-2 pl-4 text-left">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`mt-[3px] shrink-0 text-faint transition-transform ${isOpen ? "" : "-rotate-90"}`}>
              <path d="M6 9l6 6 6-6" />
            </svg>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-mono text-[10.5px] leading-[14px] text-faint">{c.id}</span>
              <span className={`text-[12.5px] leading-[17px] font-medium ${off ? "text-dim" : "text-fg"}`}>{c.title}</span>
              {(off || custom || p.changed(c.id)) && (
                <span className="flex flex-wrap gap-1 pt-0.5 leading-[16px]">
                  {off && <Tag tone="warn">Does not apply here</Tag>}
                  {!off && custom && <Tag>Changed here</Tag>}
                  {p.changed(c.id) && <Tag tone="run">Not saved</Tag>}
                </span>
              )}
            </span>
          </button>
        </th>
        {p.cols.map((s, i) => (
          <td key={s.id} className={`${CELL} ${tint} ${i === firstGrouped ? "border-l border-l-line" : ""}`}>
            <span className={`flex flex-wrap gap-1 ${off ? "opacity-45" : ""}`}>
              {s.entries(c).map((e) => (
                <EntryChip key={e.ref} entry={e} standard={s.short} />
              ))}
            </span>
          </td>
        ))}
        <td className={`${CELL} ${tint} border-l border-l-line`}>
          {p.list &&
            (mapped.length ? (
              <span className={`flex flex-wrap gap-1 ${off ? "opacity-45" : ""}`}>
                {mapped.slice(0, SHOWN).map((id) => {
                  const known = byId.get(id);
                  return <EntryChip key={id} entry={{ ref: id, name: known ? known.title : "not in the loaded list" }} standard={ICL} />;
                })}
                {mapped.length > SHOWN && <span className="tnum text-[10.5px] leading-[18px] text-faint">and {mapped.length - SHOWN} more</span>}
              </span>
            ) : (
              <span className="text-[11px] leading-[18px] text-ghost">Not mapped</span>
            ))}
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={span} className="border-b border-line-strong bg-raise/40 p-0">
            <div className="sticky left-0" style={{ width: width || "100%" }}>
              <Opened c={c} p={p} byId={byId} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

const LABEL = "text-[11px] font-semibold text-dim";

function Opened({ c, p, byId }: { c: Control; p: MatrixProps; byId: Map<string, IclControl> }) {
  const custom = tidyCustom(p.customOf(c.id));
  const mapped = p.mappingOf(c.id);
  const fired = p.firedOf(c);
  return (
    <div className="grid gap-x-8 gap-y-4 px-4 py-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>Statement</span>
          <p className="max-w-[82ch] text-[12.5px] leading-[1.6] text-fg">{c.statement}</p>
          {typeof fired === "number" && <span className="tnum text-[11.5px] text-faint">Fired {plural(fired, "time")} in the runs on record.</span>}
        </div>
        <div className="flex flex-col gap-1.5">
          <span className={LABEL}>References</span>
          <span className="flex flex-col">
            {p.cols.flatMap((s) =>
              s.entries(c).map((e) => (
                <span key={`${s.id}-${e.ref}`} className="grid grid-cols-[112px_64px_minmax(0,1fr)] items-baseline gap-x-2 border-b border-line py-1 text-[12px] last:border-b-0">
                  <span className="text-dim">{s.short}</span>
                  <span className="font-mono text-[11px] text-faint">{e.ref}</span>
                  <span className="text-fg">{e.name}</span>
                </span>
              )),
            )}
          </span>
        </div>
      </div>

      {p.editing ? (
        <Edit key={c.id} c={c} p={p} byId={byId} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>{ICL} controls this answers</span>
            {!p.list ? (
              <span className="text-[12px] text-faint">No list is loaded.</span>
            ) : mapped.length === 0 ? (
              <span className="text-[12px] text-faint">Not mapped to any {ICL} control.</span>
            ) : (
              <span className="flex flex-col">
                {mapped.map((id) => (
                  <IclLine key={id} id={id} known={byId.get(id)} />
                ))}
              </span>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>On this deployment</span>
            {!custom ? (
              <span className="text-[12px] leading-[1.55] text-faint">Applies as the catalogue states it.</span>
            ) : (
              <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12px]">
                <dt className="text-faint">Applies</dt>
                <dd>{custom.applies ? <span className="text-fg">Yes</span> : <Tag tone="warn">Does not apply here</Tag>}</dd>
                {custom.note && (
                  <>
                    <dt className="text-faint">{custom.applies ? "Note" : "Reason"}</dt>
                    <dd className="leading-[1.55] text-fg">{custom.note}</dd>
                  </>
                )}
                {custom.owner && (
                  <>
                    <dt className="text-faint">Owner</dt>
                    <dd className="text-fg">{custom.owner}</dd>
                  </>
                )}
              </dl>
            )}
          </div>
          <span className="flex flex-wrap items-center gap-2" title={p.whyNot || undefined}>
            <Button size="sm" variant="solid" tone="ink" permission="configure" disabled={Boolean(p.whyNot)} onClick={() => p.onEdit(true)}>
              Edit the mapping and the changes
            </Button>
          </span>
        </div>
      )}
    </div>
  );
}

function IclLine({ id, known, action }: { id: string; known: IclControl | undefined; action?: React.ReactNode }) {
  return (
    <span className="flex items-baseline gap-2 border-b border-line py-1 text-[12px] last:border-b-0">
      <span className="shrink-0 font-mono text-[11px] text-faint">{id}</span>
      <span className="flex min-w-0 grow flex-col">
        {known ? <span className="text-fg">{known.title}</span> : <span className="text-warn">Not in the loaded list</span>}
        {known?.domain && <span className="text-[11px] text-faint">{known.domain}</span>}
      </span>
      {action && <span className="shrink-0 self-center">{action}</span>}
    </span>
  );
}

/** The opened row in edit: the ICL controls it answers, and what this deployment changes about it. */
function Edit({ c, p, byId }: { c: Control; p: MatrixProps; byId: Map<string, IclControl> }) {
  const mapped = p.mappingOf(c.id);
  const [q, setQ] = useState("");
  // The fields keep what is typed; the page keeps the change they add up to.
  const [form, setForm] = useState(() => {
    const now = p.customOf(c.id);
    return { applies: now?.applies !== false, note: now?.note ?? "", owner: now?.owner ?? "" };
  });
  const change = (next: typeof form) => {
    setForm(next);
    p.onCustom(c.id, tidyCustom(next));
  };
  const undo = () => {
    const saved = p.savedCustomOf(c.id);
    setForm({ applies: saved?.applies !== false, note: saved?.note ?? "", owner: saved?.owner ?? "" });
    p.onUndo(c.id);
  };

  const term = q.trim().toLowerCase();
  const choices = useMemo(() => {
    const taken = new Set(mapped);
    return (p.list ?? []).filter((x) => !taken.has(x.id) && (!term || [x.id, x.title, x.domain ?? ""].some((v) => v.toLowerCase().includes(term))));
  }, [p.list, mapped, term]);
  const SHOWN = 6;
  const needsReason = !form.applies && !form.note.trim();

  return (
    <div className="flex flex-col gap-4" data-editing={c.id}>
      <div className="flex flex-col gap-2">
        <span className={LABEL}>{ICL} controls this answers</span>
        {!p.list ? (
          <span className="text-[12px] leading-[1.55] text-faint">No list is loaded.</span>
        ) : (
          <>
            {mapped.length === 0 ? (
              <span className="text-[12px] text-faint">Not mapped to any {ICL} control.</span>
            ) : (
              <span className="flex flex-col">
                {mapped.map((id) => (
                  <IclLine
                    key={id}
                    id={id}
                    known={byId.get(id)}
                    action={
                      <Button size="sm" variant="solid" tone="err" onClick={() => p.onMapping(c.id, mapped.filter((x) => x !== id))}>
                        Remove
                      </Button>
                    }
                  />
                ))}
              </span>
            )}
            <div className="flex flex-col gap-1.5 rounded-md border border-line bg-surface p-2.5">
              <SearchBox value={q} onChange={setQ} placeholder={`Search the ${ICL} by id, title or domain`} width="w-full" />
              {choices.length === 0 ? (
                <span className="px-0.5 text-[11.5px] text-faint">{term ? "No control in the list matches." : p.list.length === 0 ? "The loaded list has no controls." : "Every control in the list is already mapped here."}</span>
              ) : (
                <span className="flex flex-col">
                  {choices.slice(0, SHOWN).map((x) => {
                    const by = (p.answeredBy.get(x.id) ?? []).filter((id) => id !== c.id);
                    return (
                      <span key={x.id} className="flex items-baseline gap-2 border-b border-line py-1 text-[12px] last:border-b-0">
                        <span className="shrink-0 font-mono text-[11px] text-faint">{x.id}</span>
                        <span className="flex min-w-0 grow flex-col">
                          <span className="text-fg">{x.title}</span>
                          <span className="text-[11px] text-faint">
                            {[x.domain, by.length ? `answered by ${by.join(", ")}` : "no catalogue control answers it yet"].filter(Boolean).join(" · ")}
                          </span>
                        </span>
                        <span className="shrink-0 self-center">
                          <Button size="sm" variant="solid" tone="ink" onClick={() => p.onMapping(c.id, [...mapped, x.id])}>
                            Add
                          </Button>
                        </span>
                      </span>
                    );
                  })}
                  {choices.length > SHOWN && <span className="pt-1.5 text-[11px] text-faint">{plural(choices.length - SHOWN, "more control")} in the list; search to narrow them.</span>}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <span className={LABEL}>On this deployment</span>
        <Switch label="This control applies to this deployment" checked={form.applies} onChange={(on) => change({ ...form, applies: on })} />
        <Field
          label={form.applies ? "Note" : "Reason it does not apply"}
          hint={form.applies ? "Optional; how it is met here, if that differs." : "Required; it is left out of the coverage counts."}
          error={needsReason ? "A reason is needed to mark a control as not applying." : undefined}
        >
          <Textarea rows={2} value={form.note} onChange={(v) => change({ ...form, note: v })} />
        </Field>
        <Field label="Owner" hint="Optional; who answers for it here.">
          <Input value={form.owner} onChange={(v) => change({ ...form, owner: v })} autoComplete="off" />
        </Field>
      </div>

      <span className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="solid" tone="ink" onClick={() => p.onEdit(false)}>
          Done
        </Button>
        {p.changed(c.id) && (
          <Button size="sm" variant="solid" tone="err" onClick={undo}>
            Undo the changes to this control
          </Button>
        )}
        <span className="text-[11.5px] text-faint">Kept on this page until saved.</span>
      </span>
    </div>
  );
}
