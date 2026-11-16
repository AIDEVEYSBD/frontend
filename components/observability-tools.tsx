"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Mono, Status } from "./ui";
import { EmptyState } from "./overlays";
import { PageHeader } from "./section";
import { Pick } from "./select";
import { Chips, FilterBar, SearchBox } from "./filters";
import { CAT, RankBar } from "./charts";
import { ControlMark } from "./control-ref";
import { Skeleton } from "./loaders";
import {
  Card,
  ErrorLine,
  MoreRow,
  OUTCOME,
  ROW_BATCH,
  ReadNote,
  RunLink,
  Tiles,
  WindowBar,
  ago,
  clockText,
  count,
  durationText,
  inWindow,
  runHref,
  useDigests,
  useLedger,
  useReadLimit,
  useWindow,
  windowWords,
  type Outcome,
  type ToolCall,
} from "./observability-shared";

/**
 * Tool calls, across runs.
 *
 * Every tool call the journals hold for the runs in a window: when, on which
 * run, agent and step, which tool, how it ended (ran, refused with the
 * control that refused it, failed, or no result recorded) and how long it
 * took. The ledger lists the runs; each run's journal is read through the
 * same door the run page reads (components/observability-shared.tsx), a
 * bounded number at a time. A row opens the run at that entry.
 */

const OUTCOMES: Outcome[] = ["ran", "refused", "failed", "open"];

export function ToolCallsView() {
  const router = useRouter();
  const [now] = useState(() => Date.now());
  const { rows, error, reload, loading } = useLedger();
  const { win, auto, pick } = useWindow(rows, now);
  const { limit, more } = useReadLimit(win);
  const inWin = useMemo(() => (rows ?? []).filter((r) => inWindow(r, win, now)), [rows, win, now]);
  const wanted = useMemo(() => inWin.slice(0, limit), [inWin, limit]);
  const { digests, failed, pending } = useDigests(wanted);

  const [tool, setTool] = useState("");
  const [agent, setAgent] = useState("");
  const [outcomes, setOutcomes] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(ROW_BATCH);

  const calls = useMemo(() => digests.flatMap((d) => d.tools).sort((a, b) => b.at - a.at || b.t - a.t), [digests]);
  const byTool = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of calls) m.set(c.tool, (m.get(c.tool) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [calls]);
  const agents = useMemo(() => [...new Set(calls.map((c) => c.agent))].sort(), [calls]);
  const tally = (o: Outcome) => calls.filter((c) => c.outcome === o).length;

  const needle = q.trim().toLowerCase();
  const matches = (c: ToolCall, skip?: "outcome") =>
    (!tool || c.tool === tool) &&
    (!agent || c.agent === agent) &&
    (skip === "outcome" || !outcomes.size || outcomes.has(c.outcome)) &&
    (!needle || `${c.tool} ${c.agent} ${c.node} ${c.run} ${c.control} ${c.detail}`.toLowerCase().includes(needle));
  const filtered = useMemo(
    () => calls.filter((c) => matches(c)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [calls, tool, agent, outcomes, needle],
  );
  const filterCount = (tool ? 1 : 0) + (agent ? 1 : 0) + outcomes.size + (needle ? 1 : 0);
  const clear = () => {
    setTool("");
    setAgent("");
    setOutcomes(new Set());
    setQ("");
  };
  const toggleOutcome = (o: string) =>
    setOutcomes((s) => {
      const n = new Set(s);
      if (n.has(o)) n.delete(o);
      else n.add(o);
      return n;
    });
  const only = (o: Outcome) => setOutcomes((s) => (s.size === 1 && s.has(o) ? new Set() : new Set([o])));

  const reading = pending > 0;
  const read = digests.length;
  const scope = read === inWin.length ? `all ${count(read)} run${read === 1 ? "" : "s"} in the window` : `${count(read)} of ${count(inWin.length)} runs in the window`;

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7">
      <PageHeader title="Tool calls" action={<WindowBar win={win} auto={auto} onPick={pick} onReload={reload} loading={loading} />}>
        Every tool call the journals hold for the runs in a window: when it was made, by which agent at which step, how it ended and how long it took. A row opens the run at that entry.
      </PageHeader>

      {error && <ErrorLine what="The run ledger did not answer" message={error} />}

      {!rows && !error && (
        <Card title="Tool calls" hue="tool" meta="reading the run ledger…">
          <div className="p-4">
            <Skeleton lines={4} />
          </div>
        </Card>
      )}

      {rows && rows.length === 0 && <EmptyState title="No runs yet" detail="Tool calls are read from run journals. Once an agent has run, its calls are listed here." action={<Button size="sm" variant="solid" tone="ink" href="/runs">Open runs</Button>} />}

      {rows && rows.length > 0 && inWin.length === 0 && (
        <EmptyState
          title={`No runs in ${windowWords(win)}`}
          detail={`The ledger holds ${count(rows.length)} run${rows.length === 1 ? "" : "s"}; the most recent was ${ago(Math.max(...rows.map((r) => Date.parse(r.finished || r.at || r.started) || 0)), now)}. Widen the window to see its tool calls.`}
          action={<Button size="sm" variant="solid" tone="ink" onClick={() => pick("all")}>Show all time</Button>}
        />
      )}

      {inWin.length > 0 && (
        <>
          <Tiles
            tiles={[
              { id: "calls", label: "Tool calls", value: reading && !read ? "…" : count(calls.length), sub: `in ${scope}`, onPick: () => setOutcomes(new Set()) },
              { id: "ran", label: "Ran", value: reading && !read ? "…" : count(tally("ran")), sub: "returned a result", onPick: () => only("ran"), active: outcomes.size === 1 && outcomes.has("ran") },
              { id: "refused", label: "Refusals", value: reading && !read ? "…" : count(tally("refused")), sub: "stopped by a control", tone: tally("refused") ? "err" : undefined, onPick: () => only("refused"), active: outcomes.size === 1 && outcomes.has("refused") },
              { id: "failed", label: "Failures", value: reading && !read ? "…" : count(tally("failed")), sub: "the tool raised an error", tone: tally("failed") ? "warn" : undefined, onPick: () => only("failed"), active: outcomes.size === 1 && outcomes.has("failed") },
              { id: "open", label: "No result recorded", value: reading && !read ? "…" : count(tally("open")), sub: "the journal holds the call only", onPick: () => only("open"), active: outcomes.size === 1 && outcomes.has("open") },
            ]}
          />

          <ReadNote read={read} total={inWin.length} pending={pending} failed={failed} win={win} onMore={more} />

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
            <Card title="Most-called tools" hue="tool" meta={byTool.length ? `top ${Math.min(5, byTool.length)} of ${count(byTool.length)} · pick one to filter` : undefined}>
              <div className="px-4 py-2">
                {reading && !read && <Skeleton lines={4} />}
                {!byTool.length && !(reading && !read) && <p className="py-2 text-[11.5px] text-faint">No tool call in the journals read.</p>}
                {byTool.length > 0 && <RankBar data={byTool.slice(0, 5).map(([label, value]) => ({ label, value, color: CAT[1], meta: count(value) }))} onPick={(label) => setTool((t) => (t === label ? "" : label))} />}
              </div>
            </Card>

            <Card title="Filter" hue="observability" meta={`${count(filtered.length)} of ${count(calls.length)} calls`}>
              <div className="flex flex-col gap-3 px-4 py-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex min-w-0 flex-col gap-1">
                    <span className="text-[11px] font-medium text-faint">Tool</span>
                    <Pick aria-label="Tool" value={tool} onChange={setTool} options={[{ value: "", label: "Every tool" }, ...byTool.map(([t, n]) => ({ value: t, label: `${t} · ${count(n)}` }))]} />
                  </label>
                  <label className="flex min-w-0 flex-col gap-1">
                    <span className="text-[11px] font-medium text-faint">Agent</span>
                    <Pick aria-label="Agent" value={agent} onChange={setAgent} options={[{ value: "", label: "Every agent" }, ...agents.map((a) => ({ value: a, label: a || "(unnamed)" }))]} />
                  </label>
                </div>
                <FilterBar count={filterCount} onClear={clear}>
                  <Chips
                    label="Outcome"
                    items={OUTCOMES.map((o) => ({ value: o, label: OUTCOME[o].label, count: calls.filter((c) => matches(c, "outcome") && c.outcome === o).length, active: outcomes.has(o), tone: o === "refused" ? "err" : o === "failed" ? "warn" : o === "ran" ? "ok" : undefined }))}
                    onToggle={toggleOutcome}
                  />
                  <SearchBox value={q} onChange={setQ} placeholder="Search tool, step, run or control" width="w-[280px]" />
                </FilterBar>
              </div>
            </Card>
          </div>

          <Card title="Calls" hue="tool" meta={`newest first · a time is the run's start plus the entry's offset · window: ${windowWords(win)}`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-[11.5px]">
                <thead>
                  <tr className="border-b border-line text-left text-[10.5px] text-faint">
                    <th className="px-4 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">Run</th>
                    <th className="px-3 py-2 font-medium">Agent</th>
                    <th className="px-3 py-2 font-medium">Step</th>
                    <th className="px-3 py-2 font-medium">Tool</th>
                    <th className="px-3 py-2 font-medium">Outcome</th>
                    <th className="px-3 py-2 text-right font-medium">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, shown).map((c) => (
                    <tr key={c.key} onClick={() => router.push(runHref(c.run, c.entry))} className="cursor-pointer border-b border-line last:border-0 hover:bg-raise/40">
                      <td className="px-4 py-2 align-top whitespace-nowrap">
                        <span className="tnum text-fg">{clockText(c.at)}</span>
                        <span className="block text-[10px] text-ghost">{ago(c.at, now)}</span>
                      </td>
                      <td className="max-w-[240px] px-3 py-2 align-top">
                        <RunLink run={c.run} entry={c.entry} />
                      </td>
                      <td className="px-3 py-2 align-top whitespace-nowrap text-dim">{c.agent || <span className="text-ghost">unnamed</span>}</td>
                      <td className="px-3 py-2 align-top">
                        <Mono className="text-[10.5px]">{c.node || "—"}</Mono>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <Link href={runHref(c.run, c.entry)} onClick={(e) => e.stopPropagation()} className="focusable rounded-sm text-[12px] font-medium text-fg hover:underline">
                          {c.tool}
                        </Link>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <Status tone={OUTCOME[c.outcome].tone}>{OUTCOME[c.outcome].label}</Status>
                          {c.outcome === "refused" && <ControlMark control={c.control} />}
                        </span>
                        {c.detail && <span className="mt-0.5 line-clamp-2 max-w-[56ch] text-[10.5px] leading-[1.5] text-faint">{c.detail}</span>}
                      </td>
                      <td className="tnum px-3 py-2 text-right align-top whitespace-nowrap text-dim">{c.ms === null ? <span className="text-ghost">not recorded</span> : durationText(c.ms)}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-[11.5px] text-faint">
                        {reading && !read ? "Reading the journals…" : calls.length ? "No call matches these filters." : `No tool call in the journals read for ${windowWords(win)}.`}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {filtered.length > 0 && (
              <MoreRow
                action={
                  filtered.length > shown ? (
                    <Button size="sm" variant="solid" tone="neutral" onClick={() => setShown((n) => n + ROW_BATCH)}>
                      Show {Math.min(ROW_BATCH, filtered.length - shown)} more
                    </Button>
                  ) : undefined
                }
              >
                Showing {count(Math.min(shown, filtered.length))} of {count(filtered.length)} call{filtered.length === 1 ? "" : "s"}. The table draws {ROW_BATCH} rows at a time.
              </MoreRow>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
