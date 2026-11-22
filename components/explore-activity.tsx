"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { RunRow } from "@/lib/api/client";
import { Button, Mono, RUN_STATE, Status } from "./ui";
import { EmptyState } from "./overlays";
import { ControlMark } from "./control-ref";
import { Skeleton } from "./loaders";
import { NotBuiltValue } from "./pending";
import { notBuilt } from "@/lib/not-built";
import { listAgents, type AgentSummary } from "@/lib/api/l2";
import { agentHref } from "@/lib/agent-link";
import { soon } from "@/lib/soon";
import {
  Card,
  EVENT,
  ErrorLine,
  MoreRow,
  ReadNote,
  RunLink,
  agentOf,
  ago,
  clockText,
  count,
  inWindow,
  lastActive,
  runHref,
  useDigests,
  useReadLimit,
  windowWords,
  type RunDigest,
  type RunEvent,
  type RunEventKind,
} from "./observability-shared";
import { ExploreFrame, QuietFrame, QuietTable, Timeline, domainOf, fill, narrow, pageChips, type FacetDef } from "./explore-parts";
import type { Win } from "./window-pick";
import type { ViewProps } from "./explore";

/**
 * Agent activity.
 *
 * Per agent, over a window: its runs, model calls, tool calls and failed
 * runs from the run ledger, its steps from the journals read so far, and
 * when it last did anything. The records of this view are the runs: the
 * rail filters them by agent, state, model and where they were started from,
 * and the timeline counts them by when they were last active. Under the
 * agents, what happened on the runs that are left (started, a gate opened or
 * answered, a refusal, a kill, ended), each a link to the run at that entry.
 * Picking an agent in the table is the same as picking it in the rail.
 */

/** Runs whose journals are read for their events, per step. */
const EVENT_RUNS = 10;
/** Events drawn per step. */
const EVENT_ROWS = 100;

interface AgentRow {
  id: string;
  name: string;
  registered: boolean;
  runs: number;
  modelCalls: number;
  toolCalls: number;
  failed: number;
  /** In the window; 0 when it has no run there. */
  last: number;
  /** On the whole ledger. */
  lastEver: number;
  steps: number;
  stepsFrom: number;
}

const STATE_TONE: Record<string, "ok" | "warn" | "err" | undefined> = { done: "ok", failed: "err", killed: "err", suspended: "warn" };
const KINDS = Object.keys(EVENT) as RunEventKind[];

const EVENT_FACETS: FacetDef<RunEvent>[] = [
  { id: "event", label: "Kind of event", of: (e) => [e.kind], name: (v) => EVENT[v as RunEventKind]?.label ?? v, order: KINDS },
  { id: "person", label: "Person", of: (e) => (e.by ? [e.by] : []) },
];

const runWords = (r: RunRow) => `${r.id} ${agentOf(r)} ${r.state} ${(r.models ?? []).join(" ")} ${r.source ?? ""}`;
const runFailed = (r: RunRow) => r.state === "failed";


export function AgentActivityView({ ledger, win, now, address }: ViewProps) {
  const { rows, error } = ledger;
  /** The run rows' tool counts are named as not built: the column says so instead of a measured zero. */
  const toolsUnbuilt = notBuilt(ledger.notBuilt, "toolCalls");
  const { limit, more } = useReadLimit(win);
  const [registry, setRegistry] = useState<AgentSummary[] | null>(null);
  const [registryError, setRegistryError] = useState("");
  // How far the events have been read and drawn, for the filters in force: another cut starts at one step again.
  const [paging, setPaging] = useState({ of: "", runs: EVENT_RUNS, rows: EVENT_ROWS });
  const page = paging.of === address.key ? paging : { of: address.key, runs: EVENT_RUNS, rows: EVENT_ROWS };

  useEffect(
    () =>
      soon(() => {
        listAgents()
          .then(setRegistry)
          .catch((e) => setRegistryError((e as Error).message));
      }),
    [],
  );

  const inWin = useMemo(() => (rows ?? []).filter((r) => inWindow(r, win, now)), [rows, win, now]);
  const wanted = useMemo(() => inWin.slice(0, limit), [inWin, limit]);
  const estate = useDigests(wanted);

  const names = useMemo(() => new Map((registry ?? []).map((a) => [a.id, a.name])), [registry]);
  const runFacets = useMemo<FacetDef<RunRow>[]>(
    () => [
      { id: "agent", label: "Agent", of: (r) => [agentOf(r)], name: (v) => names.get(v) || v },
      { id: "state", label: "Run state", of: (r) => (r.state ? [r.state] : []), name: (v) => RUN_STATE[v]?.label ?? v, tone: (v) => STATE_TONE[v] },
      { id: "model", label: "Model", of: (r) => r.models ?? [] },
      { id: "source", label: "Started from", of: (r) => (r.source ? [r.source] : []) },
    ],
    [names],
  );
  const cut = useMemo(() => narrow(inWin, runFacets, address, lastActive, runWords), [inWin, runFacets, address]);
  const domain = useMemo(() => domainOf(win, now, inWin.map(lastActive)), [win, now, inWin]);
  const buckets = useMemo(() => (domain ? fill(domain, cut.timeline, lastActive, runFailed) : []), [domain, cut.timeline]);

  // The table lists every agent, so the agent filter is left out of its figures: it marks rows instead.
  const tableRuns = useMemo(() => cut.except("agent"), [cut]);
  const picked = address.all("agent");
  const one = picked.length === 1 ? picked[0] : "";
  const eventRuns = cut.list;
  const eventWanted = useMemo(() => eventRuns.slice(0, page.runs), [eventRuns, page.runs]);
  const own = useDigests(eventWanted);

  /* Every journal read so far for the window, whichever read fetched it. */
  const digests = useMemo(() => {
    const m = new Map<string, RunDigest>();
    for (const d of estate.digests) m.set(d.id, d);
    for (const d of own.digests) m.set(d.id, d);
    return m;
  }, [estate.digests, own.digests]);

  const table = useMemo(() => {
    const m = new Map<string, AgentRow>();
    const row = (id: string): AgentRow => {
      let a = m.get(id);
      if (!a) {
        a = { id, name: "", registered: false, runs: 0, modelCalls: 0, toolCalls: 0, failed: 0, last: 0, lastEver: 0, steps: 0, stepsFrom: 0 };
        m.set(id, a);
      }
      return a;
    };
    for (const a of registry ?? []) {
      const r = row(a.id);
      r.name = a.name;
      r.registered = true;
    }
    for (const r of rows ?? []) row(agentOf(r)).lastEver = Math.max(row(agentOf(r)).lastEver, lastActive(r));
    for (const r of tableRuns) {
      const a = row(agentOf(r));
      a.runs += 1;
      a.modelCalls += r.modelCalls ?? 0;
      a.toolCalls += r.toolCalls ?? 0;
      if (r.state === "failed") a.failed += 1;
      a.last = Math.max(a.last, lastActive(r));
      const d = digests.get(r.id);
      if (d) {
        a.steps += d.steps;
        a.stepsFrom += 1;
      }
    }
    return [...m.values()].sort((a, b) => b.runs - a.runs || b.lastEver - a.lastEver || a.id.localeCompare(b.id));
  }, [registry, rows, tableRuns, digests]);

  const allEvents = useMemo(() => own.digests.flatMap((d) => d.events).sort((a, b) => b.at - a.at), [own.digests]);
  const eventCut = useMemo(() => narrow(allEvents, EVENT_FACETS, address, null, null), [allEvents, address]);
  const events = eventCut.list;
  const chips = [...cut.chips, ...eventCut.chips, ...pageChips(address)];
  const narrowed = chips.length > 0;
  // The agents table leaves the agent filter and the event filters out, so only the rest narrows it.
  const tableNarrowed = cut.chips.length - picked.length + pageChips(address).length > 0;

  const select = (id: string) => address.set("agent", one === id ? [] : [id]);
  const unknown = <span className="text-ghost">unknown</span>;
  const noRecords = rows !== null && rows.length === 0 && registry !== null && registry.length === 0;

  const agents = (
    <Card
      title="Agents"
      hue="agent"
      meta={
        rows
          ? `${count(table.filter((a) => a.runs > 0).length)} of ${count(table.length)} ${tableNarrowed ? "with a run these filters leave" : `active in ${windowWords(win)}`} · runs and calls from the ledger, steps from the journals read`
          : error
            ? "the run ledger did not answer, so runs and calls are unknown"
            : "reading the run ledger…"
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] border-collapse text-[11.5px]">
          <thead>
            <tr className="border-b border-line text-left text-[10.5px] text-faint">
              <th className="px-4 py-2 font-medium">Agent</th>
              <th className="px-3 py-2 text-right font-medium">Runs</th>
              <th className="px-3 py-2 text-right font-medium">Steps</th>
              <th className="px-3 py-2 text-right font-medium">Model calls</th>
              <th className="px-3 py-2 text-right font-medium">Tool calls</th>
              <th className="px-3 py-2 text-right font-medium">Failed runs</th>
              <th className="px-3 py-2 text-right font-medium">Last active</th>
            </tr>
          </thead>
          <tbody>
            {table.map((a) => {
              const on = picked.includes(a.id);
              const partial = a.stepsFrom < a.runs;
              return (
                <tr key={a.id} onClick={() => select(a.id)} aria-selected={on} className={`cursor-pointer border-b border-line last:border-0 ${on ? "bg-raise/80" : "hover:bg-raise/50"}`}>
                  <td className="px-4 py-2 align-top">
                    <button type="button" onClick={(e) => (e.stopPropagation(), select(a.id))} className="focusable flex max-w-[220px] cursor-pointer flex-col rounded-sm text-left">
                      <span className="truncate text-[12px] font-medium text-fg">{a.name || a.id || "(unnamed)"}</span>
                      <span className="truncate font-mono text-[10px] text-faint">
                        {a.id}
                        {!a.registered && registry ? " · not in the registry" : ""}
                      </span>
                    </button>
                  </td>
                  <td className="tnum px-3 py-2 text-right align-top text-fg">{rows ? count(a.runs) : unknown}</td>
                  <td className="tnum px-3 py-2 text-right align-top text-dim">
                    {!rows ? unknown : a.runs === 0 ? "0" : a.stepsFrom === 0 ? <span className="text-ghost">not read</span> : `${count(a.steps)}${partial ? "+" : ""}`}
                    {a.runs > 0 && a.stepsFrom > 0 && partial && (
                      <span className="block text-[10px] whitespace-nowrap text-ghost">
                        {count(a.stepsFrom)} of {count(a.runs)} runs read
                      </span>
                    )}
                  </td>
                  <td className="tnum px-3 py-2 text-right align-top text-dim">{rows ? count(a.modelCalls) : unknown}</td>
                  <td className="tnum px-3 py-2 text-right align-top text-dim">{!rows ? unknown : toolsUnbuilt ? <NotBuiltValue field="runs[].toolCalls" /> : count(a.toolCalls)}</td>
                  <td className="tnum px-3 py-2 text-right align-top" style={a.failed ? { color: "var(--color-err)" } : undefined}>
                    {rows ? count(a.failed) : unknown}
                  </td>
                  <td className="tnum px-3 py-2 text-right align-top whitespace-nowrap text-dim">
                    {a.last ? (
                      ago(a.last, now)
                    ) : a.lastEver ? (
                      <span className="text-ghost" title={tableNarrowed ? "Its most recent run is outside what the window and the filters leave" : "Its most recent run is outside the window"}>
                        {ago(a.lastEver, now)}
                        <span className="block text-[10px]">{tableNarrowed ? "not in this cut" : "outside the window"}</span>
                      </span>
                    ) : (
                      <span className="text-ghost">{rows ? "no run" : "unknown"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows && table.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-[11.5px] text-faint">
                  No agent has a run on record.
                </td>
              </tr>
            )}
            {!rows && table.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-4">
                  {registryError ? <span className="text-[11.5px] text-faint">No agent could be listed.</span> : <Skeleton lines={3} />}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows && rows.length > 0 && inWin.length === 0 && (
        <MoreRow action={<Button size="sm" variant="solid" tone="ink" onClick={() => address.window("all")}>Show all time</Button>}>
          No run in {windowWords(win)}. The ledger holds {count(rows.length)} run{rows.length === 1 ? "" : "s"} outside it.
        </MoreRow>
      )}
    </Card>
  );

  const recent = (
    <Card
      title={one ? `Recent events · ${names.get(one) || one}` : "Recent events"}
      hue="activity"
      meta={`newest first · from ${count(own.digests.length)} of ${count(eventRuns.length)} run${eventRuns.length === 1 ? "" : "s"} ${narrowed ? "these filters leave" : "in the window"}`}
      action={
        one ? (
          <Button size="sm" variant="solid" tone="neutral" href={agentHref(one)}>
            Open agent
          </Button>
        ) : undefined
      }
    >
      {eventRuns.length === 0 && <p className="px-4 py-6 text-[11.5px] text-faint">{one && cut.chips.length === 1 ? `This agent has no run in ${windowWords(win)}, so there is nothing to list.` : "No run matches these filters, so there is nothing to list."}</p>}
      {eventRuns.length > 0 && allEvents.length === 0 && (
        <div className="px-4 py-4">
          {own.pending > 0 ? <Skeleton lines={4} /> : <p className="text-[11.5px] text-faint">{own.failed.length ? `The journals did not read: ${own.failed[0].message}` : "The journals read hold no run start, gate, refusal or run end."}</p>}
        </div>
      )}
      {allEvents.length > 0 && events.length === 0 && <p className="px-4 py-6 text-[11.5px] text-faint">No event on these runs matches the event filters.</p>}
      {events.length > 0 && (
        <ol className="flex flex-col">
          {events.slice(0, page.rows).map((e) => (
            <li key={e.key} className="flex flex-col gap-0.5 border-b border-line px-4 py-2 last:border-0">
              <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <Status tone={e.kind === "gate_answered" && e.approved === false ? "err" : e.kind === "ended" && /failed|killed/i.test(e.title) ? "err" : e.kind === "ended" && /complete|done/i.test(e.title) ? "ok" : EVENT[e.kind].tone}>{EVENT[e.kind].label}</Status>
                {!one && e.agent && <span className="text-[11px] text-dim">{names.get(e.agent) || e.agent}</span>}
                {e.node && <Mono className="text-[10.5px]">{e.node}</Mono>}
                {(e.kind === "refusal" || e.kind === "breach") && <ControlMark control={e.control} />}
                <span className="grow" />
                <span className="tnum text-[10.5px] whitespace-nowrap text-faint" title={e.at ? new Date(e.at).toISOString() : undefined}>
                  {clockText(e.at)} · {ago(e.at, now)}
                </span>
              </span>
              <Link href={runHref(e.run, e.entry || undefined)} className="focusable w-fit max-w-full rounded-sm text-[12px] leading-[1.5] font-medium text-fg hover:underline">
                {e.kind === "gate_answered" ? `${e.approved === false ? "Refused" : e.approved ? "Approved" : e.title}${e.by ? ` by ${e.by}` : ""}` : e.title || EVENT[e.kind].label}
              </Link>
              {e.detail && e.kind !== "started" && <span className="line-clamp-2 text-[11px] leading-[1.5] text-faint">{e.detail}</span>}
              <span className="flex flex-wrap items-center gap-x-2 text-[10px] text-ghost">
                <RunLink run={e.run} entry={e.entry || undefined} />
                {!e.entry && <span>read from the run record, which has no entry for it</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
      {eventRuns.length > 0 && (allEvents.length > 0 || own.pending === 0) && (
        <MoreRow
          action={
            <span className="flex flex-wrap items-center gap-2">
              {events.length > page.rows && (
                <Button size="sm" variant="solid" tone="neutral" onClick={() => setPaging({ ...page, rows: page.rows + EVENT_ROWS })}>
                  Show {Math.min(EVENT_ROWS, events.length - page.rows)} more
                </Button>
              )}
              {eventRuns.length > eventWanted.length && (
                <Button size="sm" variant="solid" tone="neutral" disabled={own.pending > 0} onClick={() => setPaging({ ...page, runs: page.runs + EVENT_RUNS })}>
                  Read {Math.min(EVENT_RUNS, eventRuns.length - eventWanted.length)} more run{Math.min(EVENT_RUNS, eventRuns.length - eventWanted.length) === 1 ? "" : "s"}
                </Button>
              )}
            </span>
          }
        >
          {count(Math.min(page.rows, events.length))} of {count(events.length)} event{events.length === 1 ? "" : "s"}, from the {count(own.digests.length)} most recent run{own.digests.length === 1 ? "" : "s"}
          {one ? " of this agent" : ""}. Journals are read {EVENT_RUNS} runs at a time.
          {own.pending > 0 ? ` Reading ${count(own.pending)} more…` : ""}
        </MoreRow>
      )}
    </Card>
  );

  if (noRecords) {
    return <EmptyState title="No agents and no runs yet" detail="Activity is read from the run ledger. Once an agent is saved and has run, it is listed here." action={<Button size="sm" variant="solid" tone="ink" href="/agents">Open agents</Button>} />;
  }

  const registryNote = registryError ? <ErrorLine what="The agent registry did not answer, so only agents with a run are listed" message={registryError} /> : null;

  // No run in the window (or no ledger): the agents alone, which say when each last ran.
  if (!domain || inWin.length === 0) {
    return (
      <>
        {registryNote}
        {agents}
      </>
    );
  }

  return (
    <>
      {registryNote}
      <ExploreFrame
        timeline={<Timeline title={`Runs, ${windowWords(win)}`} buckets={buckets} step={domain.step} span={address.span} onSpan={address.setSpan} nouns={["run", "runs"]} flagNoun="failed" />}
        sections={[{ title: "Runs", facets: cut.facets }, { title: "Events on those runs", facets: eventCut.facets }]}
        address={address}
        chips={chips}
        placeholder="Search run, agent or model"
        shown={`${count(cut.list.length)} run${cut.list.length === 1 ? "" : "s"}`}
      >
        <ReadNote read={estate.digests.length} total={inWin.length} pending={estate.pending} failed={estate.failed} win={win} onMore={more} />
        <div className="grid items-start gap-4 @[1180px]:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          {agents}
          {recent}
        </div>
      </ExploreFrame>
    </>
  );
}
