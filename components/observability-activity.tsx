"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Mono, Status } from "./ui";
import { EmptyState } from "./overlays";
import { PageHeader } from "./section";
import { ControlMark } from "./control-ref";
import { Skeleton } from "./loaders";
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
  WindowBar,
  agentOf,
  ago,
  clockText,
  count,
  inWindow,
  lastActive,
  runHref,
  useDigests,
  useLedger,
  useReadLimit,
  useWindow,
  windowWords,
  type RunDigest,
} from "./observability-shared";

/**
 * Agent activity.
 *
 * Per agent, over a window: its runs, model calls, tool calls and failed
 * runs from the run ledger, its steps from the journals read so far, and
 * when it last did anything. Picking an agent lists what happened on its
 * most recent runs (started, a gate opened or answered, a refusal, a kill,
 * ended), each a link to the run at that entry.
 */

/** An agent's runs whose journals are read for its events, per step. */
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

function ActivityPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [now] = useState(() => Date.now());
  const { rows, error, reload, loading } = useLedger();
  const { win, auto, pick } = useWindow(rows, now);
  const { limit, more } = useReadLimit(win);
  const [registry, setRegistry] = useState<AgentSummary[] | null>(null);
  const [registryError, setRegistryError] = useState("");
  const [eventRuns, setEventRuns] = useState(EVENT_RUNS);
  const [eventRows, setEventRows] = useState(EVENT_ROWS);

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

  const chosen = params.get("agent");
  const selected = chosen ?? (inWin.length ? agentOf(inWin[0]) : "");
  const agentRuns = useMemo(() => inWin.filter((r) => agentOf(r) === selected), [inWin, selected]);
  const agentWanted = useMemo(() => agentRuns.slice(0, eventRuns), [agentRuns, eventRuns]);
  const own = useDigests(agentWanted);

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
    for (const r of inWin) {
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
  }, [registry, rows, inWin, digests]);

  const events = useMemo(() => own.digests.flatMap((d) => d.events).sort((a, b) => b.at - a.at), [own.digests]);
  const select = (id: string) => {
    setEventRuns(EVENT_RUNS);
    setEventRows(EVENT_ROWS);
    router.replace(`/observability/activity?agent=${encodeURIComponent(id)}`, { scroll: false });
  };
  const selectedRow = table.find((a) => a.id === selected);
  const unknown = <span className="text-ghost">unknown</span>;
  const noRecords = rows !== null && rows.length === 0 && registry !== null && registry.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7">
      <PageHeader title="Agent activity" action={<WindowBar win={win} auto={auto} onPick={pick} onReload={reload} loading={loading} />}>
        What each agent did in a window: its runs, steps, model calls, tool calls and failed runs, and when it was last active. Pick an agent to read what happened on its most recent runs.
      </PageHeader>

      {error && <ErrorLine what="The run ledger did not answer" message={error} />}
      {registryError && <ErrorLine what="The agent registry did not answer, so only agents with a run are listed" message={registryError} />}

      {noRecords && <EmptyState title="No agents and no runs yet" detail="Activity is read from the run ledger. Once an agent is saved and has run, it is listed here." action={<Button size="sm" variant="solid" tone="ink" href="/workflows">Open workflows</Button>} />}

      {!noRecords && (
        <>
          {inWin.length > 0 && <ReadNote read={estate.digests.length} total={inWin.length} pending={estate.pending} failed={estate.failed} win={win} onMore={more} />}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <Card
              title="Agents"
              hue="agent"
              meta={rows ? `${count(table.filter((a) => a.runs > 0).length)} of ${count(table.length)} active in ${windowWords(win)} · runs and calls from the ledger, steps from the journals read` : error ? "the run ledger did not answer, so runs and calls are unknown" : "reading the run ledger…"}
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
                      const on = a.id === selected;
                      const partial = a.stepsFrom < a.runs;
                      return (
                        <tr key={a.id} onClick={() => select(a.id)} aria-selected={on} className={`cursor-pointer border-b border-line last:border-0 ${on ? "bg-raise/80" : "hover:bg-raise/50"}`}>
                          <td className="px-4 py-2 align-top">
                            <button type="button" onClick={() => select(a.id)} className="focusable flex max-w-[220px] flex-col rounded-sm text-left">
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
                            {a.runs > 0 && a.stepsFrom > 0 && partial && <span className="block text-[10px] whitespace-nowrap text-ghost">{count(a.stepsFrom)} of {count(a.runs)} runs read</span>}
                          </td>
                          <td className="tnum px-3 py-2 text-right align-top text-dim">{rows ? count(a.modelCalls) : unknown}</td>
                          <td className="tnum px-3 py-2 text-right align-top text-dim">{rows ? count(a.toolCalls) : unknown}</td>
                          <td className="tnum px-3 py-2 text-right align-top" style={a.failed ? { color: "var(--color-err)" } : undefined}>
                            {rows ? count(a.failed) : unknown}
                          </td>
                          <td className="tnum px-3 py-2 text-right align-top whitespace-nowrap text-dim">
                            {a.last ? ago(a.last, now) : a.lastEver ? <span className="text-ghost" title="Its most recent run is outside the window">{ago(a.lastEver, now)}<span className="block text-[10px]">outside the window</span></span> : <span className="text-ghost">{rows ? "no run" : "unknown"}</span>}
                          </td>
                        </tr>
                      );
                    })}
                    {!rows && !error && (
                      <tr>
                        <td colSpan={7} className="px-4 py-4">
                          <Skeleton lines={3} />
                        </td>
                      </tr>
                    )}
                    {rows && table.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-[11.5px] text-faint">
                          No agent has a run on record.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {rows && rows.length > 0 && inWin.length === 0 && (
                <MoreRow action={<Button size="sm" variant="solid" tone="ink" onClick={() => pick("all")}>Show all time</Button>}>
                  No run in {windowWords(win)}. The ledger holds {count(rows.length)} run{rows.length === 1 ? "" : "s"} outside it.
                </MoreRow>
              )}
            </Card>

            <Card
              title={selected ? `Recent events · ${selectedRow?.name || selected}` : "Recent events"}
              hue="activity"
              meta={selected ? `newest first · from ${count(own.digests.length)} of ${count(agentRuns.length)} run${agentRuns.length === 1 ? "" : "s"} in the window` : undefined}
              action={
                selected ? (
                  <Button size="sm" variant="solid" tone="neutral" href={agentHref(selected)}>
                    Open agent
                  </Button>
                ) : undefined
              }
            >
              {!selected && <p className="px-4 py-6 text-[11.5px] text-faint">Pick an agent to read what happened on its runs.</p>}
              {selected && agentRuns.length === 0 && <p className="px-4 py-6 text-[11.5px] text-faint">This agent has no run in {windowWords(win)}, so there is nothing to list.</p>}
              {selected && agentRuns.length > 0 && events.length === 0 && (
                <div className="px-4 py-4">{own.pending > 0 ? <Skeleton lines={4} /> : <p className="text-[11.5px] text-faint">{own.failed.length ? `The journals did not read: ${own.failed[0].message}` : "The journals read hold no run start, gate, refusal or run end."}</p>}</div>
              )}
              {events.length > 0 && (
                <ol className="flex flex-col">
                  {events.slice(0, eventRows).map((e) => (
                    <li key={e.key} className="flex flex-col gap-0.5 border-b border-line px-4 py-2 last:border-0">
                      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <Status tone={e.kind === "gate_answered" && e.approved === false ? "err" : e.kind === "ended" && /failed|killed/i.test(e.title) ? "err" : e.kind === "ended" && /complete|done/i.test(e.title) ? "ok" : EVENT[e.kind].tone}>{EVENT[e.kind].label}</Status>
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
              {selected && agentRuns.length > 0 && (events.length > 0 || own.pending === 0) && (
                <MoreRow
                  action={
                    <span className="flex flex-wrap items-center gap-2">
                      {events.length > eventRows && (
                        <Button size="sm" variant="solid" tone="neutral" onClick={() => setEventRows((n) => n + EVENT_ROWS)}>
                          Show {Math.min(EVENT_ROWS, events.length - eventRows)} more
                        </Button>
                      )}
                      {agentRuns.length > agentWanted.length && (
                        <Button size="sm" variant="solid" tone="neutral" disabled={own.pending > 0} onClick={() => setEventRuns((n) => n + EVENT_RUNS)}>
                          Read {Math.min(EVENT_RUNS, agentRuns.length - agentWanted.length)} more run{Math.min(EVENT_RUNS, agentRuns.length - agentWanted.length) === 1 ? "" : "s"}
                        </Button>
                      )}
                    </span>
                  }
                >
                  {count(Math.min(eventRows, events.length))} of {count(events.length)} event{events.length === 1 ? "" : "s"}, from this agent&rsquo;s {count(own.digests.length)} most recent run{own.digests.length === 1 ? "" : "s"}. Journals are read {EVENT_RUNS} runs at a time.
                  {own.pending > 0 ? ` Reading ${count(own.pending)} more…` : ""}
                </MoreRow>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

export function AgentActivityView() {
  return (
    <Suspense>
      <ActivityPage />
    </Suspense>
  );
}
