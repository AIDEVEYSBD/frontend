"use client";
import { Failure } from "./pending";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Mono, Status, Tag } from "./ui";
import { Banner } from "./overlays";
import { GroupHeader } from "./page-tabs";
import { Field, Input } from "./forms";
import { Pick } from "./select";
import { DigestChip } from "./digest-chip";
import { hueFor } from "@/lib/hue";
import { soon } from "@/lib/soon";
import { DoorError, type Gate } from "@/lib/api/l5";
import { notBuiltDoorOf } from "@/lib/api/client";
import { listAgents, type AgentSummary } from "@/lib/api/l2";
import {
  DELIVERABLE_STATES,
  downloadDeliverable,
  getDeliverable,
  listDeliverables,
  listRegisterItems,
  listRegisters,
  type DeliverableList,
  type DeliverableView,
  type RegisterItems,
  type RegisterList,
} from "@/lib/api/l8b";
import { whenText } from "@/lib/lifecycle";
import {
  deliverableLine,
  deliverableQuery,
  deliverableStateMeta,
  fileLine,
  fileName,
  fileRefusalText,
  gateDeliverableLine,
  historyLine,
  registerItemLine,
  registerLine,
  reportGateNote,
  sinkOfAsk,
  statesLine,
} from "@/lib/deliverables";

/**
 * Deliverables and registers (phase L8, second round).
 *
 * What runs write, as first-class records: every document a run wrote (a
 * report, a contract, a register export), with its state (draft, reviewed
 * at the report gate, published through the sink the gate held, or
 * withdrawn), its history step by step (who reviewed it, which sink
 * published it, a move another run tried and that was kept, not applied),
 * and its file, served only from the outbox, only with the digest it was
 * written with, never for a run an attached agent reported. Beside them, the
 * registers a records backend wrote to, each item with its state and every
 * run that wrote it. Filters by state, agent and run (`?state=&agent=&run=`,
 * so a run's page can link here). Reviewing is the report gate's answer in
 * the inbox (components/approve.tsx), not a button here. The doors are the
 * backend's (lib/api/l8b.ts); the words lib/deliverables.ts's.
 */

const TONE = (state: string) => deliverableStateMeta(state).tone;

function Section({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-md border border-line bg-surface">
      <div data-hue={hueFor(title.toLowerCase())} className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/55 px-4 py-2">
        <span className="text-[12.5px] font-semibold text-fg">{title}</span>
        {meta && <span className="text-[11px] text-faint">{meta}</span>}
      </div>
      <div className="flex flex-col gap-3 p-4">{children}</div>
    </section>
  );
}

/**
 * Download a deliverable's file: fetched from its door, so a refusal (gone
 * from disk, changed since it was written, a reported run's) is said in
 * words rather than opened as a page, then handed to the browser to save.
 */
export function DeliverableDownload({ id, download, label = "Download" }: { id: string; download: string | null; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!download) return null;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="solid"
        tone="neutral"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const f = await downloadDeliverable(id, download);
            const url = URL.createObjectURL(f.blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = f.filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch (e) {
            setError(e instanceof DoorError ? fileRefusalText(e) : (e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {label}
      </Button>
      {error && <span className="text-[11px] text-err">{error}</span>}
    </span>
  );
}

/**
 * What a report gate names (phase L8, second round): the deliverables the
 * run wrote and nobody has reviewed, so the reviewer sees what they approve
 * (title, kind, state, digest, the file) before answering. Approving reviews
 * them, signed with the answer's name, and the sink fires and publishes
 * them; refusing withdraws them. Renders nothing for any other gate.
 * Presentational.
 */
export function ReportGateDeliverables({ gate }: { gate: Pick<Gate, "control" | "deliverables" | "asks"> }) {
  if (!gate.deliverables.length && gate.control !== "report") return null;
  return (
    <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
      <span className="flex items-center gap-2">
        <Tag tone="warn">report gate</Tag>
        <span className="text-[11.5px] font-semibold text-fg">What you approve</span>
      </span>
      <p className="text-[11.5px] leading-[1.55] text-dim">{reportGateNote(gate.deliverables.length, sinkOfAsk(gate.asks))}</p>
      {gate.deliverables.length === 0 ? (
        <p className="text-[11px] text-faint">The gate names no deliverable; open the run to read what it wrote.</p>
      ) : (
        <ul className="flex flex-col overflow-hidden rounded-md border border-line">
          {gate.deliverables.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2 last:border-b-0">
              <span className="flex min-w-0 grow flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <Link href={`/deliverables?id=${encodeURIComponent(d.id)}`} className="focusable rounded-sm text-[12px] font-medium text-fg hover:underline">
                    {d.title}
                  </Link>
                  <Status tone={TONE(d.current_state || d.state)}>{deliverableStateMeta(d.current_state || d.state).label}</Status>
                </span>
                <span className="text-[10.5px] text-faint">{gateDeliverableLine(d)}</span>
                <Mono className="truncate text-[10px] text-ghost">
                  {fileName(d.path)} · {d.digest}
                </Mono>
              </span>
              <DeliverableDownload id={d.id} download={d.download} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The deliverables listed. Presentational. */
export function DeliverablesListView({ list, selected, onSelect }: { list: DeliverableList; selected?: string | null; onSelect?: (id: string) => void }) {
  if (!list.deliverables.length)
    return list.not_built.includes("producer") ? (
      <p className="text-[12px] text-dim" data-not-built="producer">
        Nothing produces deliverables yet: the platform names their producer as not built, so this list is empty because no run can write one.
      </p>
    ) : (
      <p className="text-[12px] text-faint">No deliverable matches.</p>
    );
  return (
    <ul className="flex flex-col overflow-hidden rounded-md border border-line">
      {list.deliverables.map((d) => (
        <li key={d.id} className={`border-b border-line last:border-b-0 ${selected === d.id ? "bg-raise/50" : ""}`}>
          <button type="button" onClick={() => onSelect?.(d.id)} className="focusable flex w-full cursor-pointer flex-col gap-0.5 px-3 py-2 text-left hover:bg-raise/40">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] font-semibold text-fg">{d.title}</span>
              <Status tone={TONE(d.state)}>{deliverableStateMeta(d.state).label}</Status>
              <Tag>{d.kind}</Tag>
              <span className="grow" />
              <span className="text-[10.5px] text-faint">{whenText(d.updated_at)}</span>
            </span>
            <span className="text-[11px] text-dim">{deliverableLine(d)}</span>
            <Mono className="truncate text-[10px] text-faint">
              {d.agent} · {d.run} · {d.id}
            </Mono>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** One deliverable: its state, history and file. Presentational. */
export function DeliverableDetailView({ deliverable }: { deliverable: DeliverableView }) {
  const d = deliverable;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[14px] font-semibold text-fg">{d.title}</span>
        <Status tone={TONE(d.state)}>{deliverableStateMeta(d.state).label}</Status>
        <Tag>{d.kind}</Tag>
        <Mono className="text-[10.5px] text-faint">{d.id}</Mono>
      </div>
      <p className="text-[11.5px] text-faint">{deliverableStateMeta(d.state).means}.</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-dim">
        <span>{deliverableLine(d)}</span>
        {d.digest && <DigestChip digest={d.digest} label="Digest as written" />}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
        <span>
          {d.agent}, run{" "}
          <Link href={`/runs?id=${encodeURIComponent(d.run)}`} className="focusable rounded-sm font-mono text-dim hover:underline">
            {d.run}
          </Link>
          {d.node ? `, node ${d.node}` : ""}
          {d.sub_run ? `, sub-run ${d.sub_run}` : ""}
        </span>
        <span className="font-mono">{fileName(d.path)}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-semibold text-dim">History</span>
        <ol className="flex flex-col overflow-hidden rounded-md border border-line">
          {d.history.map((h, i) => (
            <li key={`${h.entry}-${i}`} className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 border-b border-line px-3 py-1.5 text-[11.5px] last:border-b-0 ${h.applied ? "" : "bg-raise/40"}`}>
              <Status tone={h.applied ? TONE(h.state) : "neutral"}>{deliverableStateMeta(h.state).label}</Status>
              <span className={h.applied ? "text-dim" : "text-faint"}>{historyLine(h)}</span>
              {h.entry &&
                (h.applied ? (
                  // The step's journal entry, in the run that wrote the deliverable: the link opens the run on it.
                  <Link href={`/runs?id=${encodeURIComponent(d.run)}&entry=${encodeURIComponent(h.entry)}`} title="Open the run at this journal entry" className="focusable rounded-sm font-mono text-[9.5px] text-dim hover:underline">
                    entry {h.entry}
                  </Link>
                ) : (
                  <Mono className="text-[9.5px] text-ghost">entry {h.entry}</Mono>
                ))}
            </li>
          ))}
        </ol>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`text-[11.5px] ${d.file.available ? "text-dim" : "text-warn"}`}>{fileLine(d.file)}</span>
        <span className="grow" />
        {d.file.available && <DeliverableDownload id={d.id} download={d.download} />}
      </div>
    </div>
  );
}

/** The registers a records backend wrote to. Presentational. */
export function RegistersView({ list, selected, onSelect }: { list: RegisterList; selected?: string | null; onSelect?: (name: string) => void }) {
  if (!list.registers.length) return <p className="text-[12px] text-faint">No register is on record. A run whose records backend writes a row registers it as an item of its register.</p>;
  return (
    <ul className="flex flex-col overflow-hidden rounded-md border border-line">
      {list.registers.map((r) => (
        <li key={r.name} className={`border-b border-line last:border-b-0 ${selected === r.name ? "bg-raise/50" : ""}`}>
          <button type="button" onClick={() => onSelect?.(r.name)} className="focusable flex w-full cursor-pointer flex-col gap-0.5 px-3 py-2 text-left hover:bg-raise/40">
            <span className="flex items-center gap-2">
              <span className="font-mono text-[12.5px] font-semibold text-fg">{r.name}</span>
              <span className="grow" />
              {r.latest && <span className="text-[10.5px] text-faint">{whenText(r.latest)}</span>}
            </span>
            <span className="text-[11px] text-dim">{registerLine(r)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** One register's items with their states and the runs that wrote them. Presentational. */
export function RegisterItemsView({ items }: { items: RegisterItems }) {
  if (!items.items.length) return <p className="text-[12px] text-faint">No item of {items.register} matches.</p>;
  return (
    <ul className="flex flex-col overflow-hidden rounded-md border border-line">
      {items.items.map((i) => (
        <li key={i.id} className="flex flex-col gap-0.5 border-b border-line px-3 py-2 last:border-b-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[12px] font-semibold text-fg">{i.item}</span>
            <Status tone={TONE(i.state)}>{deliverableStateMeta(i.state).label}</Status>
            <Mono className="text-[10px] text-faint">{i.id}</Mono>
            <span className="grow" />
            <span className="text-[10.5px] text-faint">{whenText(i.updated_at)}</span>
          </span>
          <span className="text-[11px] text-dim">{registerItemLine(i)}</span>
          {i.history.length > 1 && (
            <span className="flex flex-wrap gap-x-2 text-[10px] text-faint">
              written by:
              {i.history.map((h, k) => (
                <Link key={`${h.entry}-${k}`} href={`/runs?id=${encodeURIComponent(h.run)}${h.entry ? `&entry=${encodeURIComponent(h.entry)}` : ""}`} title={h.entry ? `Open the run at entry ${h.entry}` : undefined} className="focusable rounded-sm font-mono hover:underline">
                  {h.run}
                </Link>
              ))}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ═══════════════════ the page ═══════════════════ */

function DeliverablesPage() {
  const params = useSearchParams();
  const router = useRouter();
  const state = params.get("state") ?? "";
  const agent = params.get("agent") ?? "";
  const run = params.get("run") ?? "";
  const selected = params.get("id");
  const register = params.get("register");
  const [itemState, setItemState] = useState("");
  const [runText, setRunText] = useState(run);
  const [list, setList] = useState<DeliverableList | null>(null);
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<DeliverableView | null>(null);
  const [detailError, setDetailError] = useState("");
  const [registers, setRegisters] = useState<RegisterList | null>(null);
  const [items, setItems] = useState<RegisterItems | null>(null);
  const [itemsError, setItemsError] = useState("");
  /* A list that was not read is not shown as an empty one: its failure is shown in its place. */
  const [registersFailed, setRegistersFailed] = useState("");
  const listOff = Boolean(error);
  const registersOff = Boolean(registersFailed);
  /** The platform answers 501 for the registers: the section reads "not built", not empty and not failed. */
  const registersUnbuilt = Boolean(notBuiltDoorOf(registersFailed));
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  /** Why the agents were not read: the agent picker says so, never offering an empty list as the estate's. */
  const [agentsError, setAgentsError] = useState("");

  const go = useCallback(
    (next: Record<string, string | null>) => {
      const q = new URLSearchParams();
      const merged: Record<string, string | null> = { state, agent, run, id: selected, register, ...next };
      for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
      const s = q.toString();
      router.push(`/deliverables${s ? `?${s}` : ""}`);
    },
    [state, agent, run, selected, register, router],
  );

  const load = useCallback(async () => {
    try {
      setList(await listDeliverables(deliverableQuery({ state, agent, run })));
      setError("");
    } catch (e) {
      setList(null);
      setError((e as Error).message);
    }
    try {
      setRegisters(await listRegisters());
      setRegistersFailed("");
    } catch (e) {
      setRegisters(null);
      setRegistersFailed((e as Error).message);
    }
  }, [state, agent, run]);
  useEffect(() => soon(load), [load]);
  useEffect(() => {
    listAgents()
      .then((a) => {
        setAgents(a);
        setAgentsError("");
      })
      .catch((e) => {
        setAgents([]);
        setAgentsError((e as Error).message);
      });
  }, []);
  useEffect(() => {
    if (!selected) return;
    let stop = false;
    getDeliverable(selected)
      .then((d) => {
        if (stop) return;
        setDetail(d);
        setDetailError("");
      })
      .catch((e: Error) => !stop && setDetailError(e.message));
    return () => {
      stop = true;
    };
  }, [selected]);
  useEffect(() => {
    if (!register) return;
    let stop = false;
    listRegisterItems(register, itemState ? { state: itemState } : {})
      .then((i) => {
        if (stop) return;
        setItems(i);
        setItemsError("");
      })
      .catch((e: Error) => !stop && setItemsError(e.message));
    return () => {
      stop = true;
    };
  }, [register, itemState]);

  const shownDetail = detail && detail.id === selected ? detail : null;
  const shownItems = items && items.register === register ? items : null;
  const stateButton = (value: string, label: string, on: boolean, pick: () => void) => (
    <button
      key={value || "all"}
      type="button"
      onClick={pick}
      aria-pressed={on}
      className={`focusable cursor-pointer rounded-sm px-2 py-0.5 text-[11px] transition-colors ${on ? "bg-raise font-semibold text-fg" : "font-medium text-faint hover:text-dim"}`}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-5 px-5 py-7" data-hue="violet">
      <GroupHeader group="results" tab="deliverables">
        The documents runs write, each with its state (draft, reviewed, published or withdrawn), its history and its file, and the registers a records backend wrote to. A run writes a document through
        the document.write tool, as a draft. Before a tool that acts outside the platform fires in that run, a report gate asks a person to review what it wrote: approving reviews it, refusing withdraws it,
        and the tool then fires and publishes it.
      </GroupHeader>
      {error && (
        <Banner tone="err" title="Could not read the deliverables">
          {error}
        </Banner>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Section title="Deliverables" meta={list && !listOff ? (list.count === 0 && list.not_built.includes("producer") ? "not built: nothing produces one" : `${list.count} · ${statesLine(list.states)}`) : undefined}>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-faint">State</span>
              <span className="flex items-center gap-1">
                {stateButton("", "All", !state, () => go({ state: null, id: null }))}
                {DELIVERABLE_STATES.map((s) => stateButton(s, deliverableStateMeta(s).label, state === s, () => go({ state: s, id: null })))}
              </span>
            </div>
            <div className="w-56">
              <Field label="Agent" error={agentsError ? `the agents could not be read, so none can be picked: ${agentsError}` : undefined}>
                <Pick value={agent} onChange={(v) => go({ agent: v || null, id: null })} options={[{ value: "", label: "Every agent" }, ...agents.map((a) => ({ value: a.id, label: a.id }))]} />
              </Field>
            </div>
            <div className="w-64">
              <Field label="Run">
                <Input value={runText} onChange={setRunText} placeholder="a run id" mono />
              </Field>
            </div>
            <Button size="sm" variant="solid" tone="neutral" onClick={() => go({ run: runText.trim() || null, id: null })}>
              Apply
            </Button>
          </div>
          {listOff ? <p className="text-[12px] text-faint">Not read.</p> : list ? <DeliverablesListView list={list} selected={selected} onSelect={(id) => go({ id })} /> : <p className="text-[12px] text-faint">Reading the deliverables…</p>}
        </Section>
        <Section title="Deliverable" meta={shownDetail ? shownDetail.id : selected ? (detailError ? "not read" : "reading…") : "pick one"}>
          {!selected && <p className="text-[12px] text-faint">Pick a deliverable to read its history and download its file.</p>}
          {detailError && <Failure inline what="This deliverable could not be read" message={detailError} />}
          {shownDetail && <DeliverableDetailView deliverable={shownDetail} />}
        </Section>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Section title="Registers" meta={registers && !registersOff ? `${registers.count} on record` : registersUnbuilt ? "not built" : undefined}>
          {registersOff ? <Failure what="The registers could not be read" message={registersFailed} /> : registers ? <RegistersView list={registers} selected={register} onSelect={(name) => go({ register: name })} /> : <p className="text-[12px] text-faint">Reading the registers…</p>}
        </Section>
        <Section title={register ? `Register ${register}` : "Register items"} meta={shownItems ? `${shownItems.count} · ${statesLine(shownItems.states)}` : undefined}>
          {!register && (registersUnbuilt ? <p className="text-[12px] text-faint">Not built: with no list of registers, there is no register to pick.</p> : <p className="text-[12px] text-faint">Pick a register to read its items and their states.</p>)}
          {register && (
            <span className="flex items-center gap-1">
              {stateButton("", "All", !itemState, () => setItemState(""))}
              {DELIVERABLE_STATES.map((s) => stateButton(s, deliverableStateMeta(s).label, itemState === s, () => setItemState(s)))}
            </span>
          )}
          {itemsError && <Failure inline what={`The items of ${register} could not be read`} message={itemsError} />}
          {shownItems && <RegisterItemsView items={shownItems} />}
        </Section>
      </div>
    </div>
  );
}

export function DeliverablesView() {
  return (
    <Suspense>
      <DeliverablesPage />
    </Suspense>
  );
}
