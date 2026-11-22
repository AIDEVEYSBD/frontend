"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RunRow } from "@/lib/api/client";
import { explainControl } from "@/lib/guardrails";
import { Button, Mono, Status } from "./ui";
import { EmptyState } from "./overlays";
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
  ago,
  clockText,
  count,
  durationText,
  inWindow,
  lastActive,
  runHref,
  useDigests,
  useReadLimit,
  windowWords,
  type Outcome,
  type ToolCall,
} from "./observability-shared";
import { ExploreFrame, QuietFrame, QuietTable, QuietTiles, Timeline, domainOf, fill, narrow, pageChips, type FacetDef } from "./explore-parts";
import type { Win } from "./window-pick";
import type { ViewProps } from "./explore";

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
const TONE: Partial<Record<Outcome, "ok" | "warn" | "err">> = { ran: "ok", refused: "err", failed: "warn" };

/** The server a tool is on: the part of its name before the first dot, as the run page reads it. */
const serverOf = (tool: string): string[] => {
  const i = tool.indexOf(".");
  return i > 0 ? [tool.slice(0, i)] : [];
};

const FACETS: FacetDef<ToolCall>[] = [
  { id: "status", label: "Status", of: (c) => [c.outcome], name: (v) => OUTCOME[v as Outcome]?.label ?? v, tone: (v) => TONE[v as Outcome], order: OUTCOMES },
  { id: "agent", label: "Agent", of: (c) => [c.agent] },
  { id: "server", label: "Tool server", of: (c) => serverOf(c.tool) },
  { id: "tool", label: "Tool", of: (c) => [c.tool] },
  { id: "step", label: "Step", of: (c) => (c.node ? [c.node] : []) },
  { id: "control", label: "Refused by", of: (c) => (c.control ? [c.control] : []), name: (v) => explainControl(v).name },
];

const when = (c: ToolCall) => c.at;
const words = (c: ToolCall) => `${c.tool} ${c.agent} ${c.node} ${c.run} ${c.control} ${c.detail}`;
const stopped = (c: ToolCall) => c.outcome === "refused" || c.outcome === "failed";


export function ToolCallsView({ rows, win, now, address }: ViewProps & { rows: RunRow[] }) {
  const router = useRouter();
  const { limit, more } = useReadLimit(win);
  const inWin = useMemo(() => rows.filter((r) => inWindow(r, win, now)), [rows, win, now]);
  const wanted = useMemo(() => inWin.slice(0, limit), [inWin, limit]);
  const { digests, failed, pending } = useDigests(wanted);
  const [shown, setShown] = useState(ROW_BATCH);

  const calls = useMemo(() => digests.flatMap((d) => d.tools).sort((a, b) => b.at - a.at || b.t - a.t), [digests]);
  const cut = useMemo(() => narrow(calls, FACETS, address, when, words), [calls, address]);
  const domain = useMemo(() => domainOf(win, now, calls.map(when)), [win, now, calls]);
  const buckets = useMemo(() => (domain ? fill(domain, cut.timeline, when, stopped) : []), [domain, cut.timeline]);

  const filtered = cut.list;
  const status = address.all("status");
  const tally = (o: Outcome) => cut.facets.find((f) => f.id === "status")?.values.find((v) => v.value === o)?.count ?? 0;
  const only = (o: Outcome) => address.set("status", status.length === 1 && status[0] === o ? [] : [o]);
  const is = (o: Outcome) => status.length === 1 && status[0] === o;
  const byTool = (cut.facets.find((f) => f.id === "tool")?.values ?? []).filter((v) => v.count > 0).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  const chips = [...cut.chips, ...pageChips(address)];

  const read = digests.length;
  const scope = read === inWin.length ? `all ${count(read)} run${read === 1 ? "" : "s"} in the window` : `${count(read)} of ${count(inWin.length)} runs in the window`;
  const readNote = <ReadNote read={read} total={inWin.length} pending={pending} failed={failed} win={win} onMore={more} />;

  if (rows.length === 0) {
    return <EmptyState title="No runs yet" detail="Tool calls are read from run journals. Once an agent has run, its calls are listed here." action={<Button size="sm" variant="solid" tone="ink" href="/runs">Open runs</Button>} />;
  }
  if (inWin.length === 0) {
    return (
      <EmptyState
        title={`No runs in ${windowWords(win)}`}
        detail={`The ledger holds ${count(rows.length)} run${rows.length === 1 ? "" : "s"}; the most recent was ${ago(Math.max(...rows.map(lastActive)), now)}. Widen the window to see its tool calls.`}
        action={<Button size="sm" variant="solid" tone="ink" onClick={() => address.window("all")}>Show all time</Button>}
      />
    );
  }
  // Nothing read yet: say that it is being read, not a rail of zeros.
  if (!calls.length && pending > 0) {
    return (
      <Card title="Tool calls" hue="tool" meta="reading the run journals…">
        <div className="p-4">
          <Skeleton lines={4} />
        </div>
      </Card>
    );
  }
  // Every journal asked for failed to read: that is not the same as a window with no tool call in it.
  if (!calls.length && read === 0 && failed.length > 0) {
    return <ErrorLine what="The run journals did not read" message={failed[0].message} />;
  }
  if (!calls.length || !domain) {
    return (
      <>
        {readNote}
        <p className="rounded-lg border border-dashed border-line-strong px-4 py-8 text-center text-[12.5px] leading-[1.55] text-dim">No tool call in the journals read for {windowWords(win)}.</p>
      </>
    );
  }

  return (
    <ExploreFrame
      timeline={<Timeline title={`Tool calls, ${windowWords(win)}`} buckets={buckets} step={domain.step} span={address.span} onSpan={address.setSpan} nouns={["call", "calls"]} flagNoun="refused or failed" note={read < inWin.length ? `from ${scope}` : undefined} />}
      sections={[{ facets: cut.facets }]}
      address={address}
      chips={chips}
      placeholder="Search tool, step, run or control"
      shown={`${count(filtered.length)} call${filtered.length === 1 ? "" : "s"}`}
    >
      <Tiles
        tiles={[
          { id: "calls", label: "Tool calls", value: count(cut.except("status").length), sub: `in ${scope}`, onPick: () => address.set("status", []) },
          { id: "ran", label: "Ran", value: count(tally("ran")), sub: "returned a result", onPick: () => only("ran"), active: is("ran") },
          { id: "refused", label: "Refusals", value: count(tally("refused")), sub: "stopped by a control", tone: tally("refused") ? "err" : undefined, onPick: () => only("refused"), active: is("refused") },
          { id: "failed", label: "Failures", value: count(tally("failed")), sub: "the tool raised an error", tone: tally("failed") ? "warn" : undefined, onPick: () => only("failed"), active: is("failed") },
          { id: "open", label: "No result recorded", value: count(tally("open")), sub: "the journal holds the call only", onPick: () => only("open"), active: is("open") },
        ]}
      />

      {readNote}

      <Card title="Most-called tools" hue="tool" meta={byTool.length ? `top ${Math.min(5, byTool.length)} of ${count(byTool.length)} · pick one to filter` : undefined}>
        <div className="px-4 py-2">
          {byTool.length === 0 && <p className="py-2 text-[11.5px] text-faint">No call matches these filters.</p>}
          {byTool.length > 0 && <RankBar data={byTool.slice(0, 5).map((v) => ({ label: v.value, value: v.count, color: CAT[1], meta: count(v.count) }))} onPick={(label) => address.toggle("tool", label)} />}
        </div>
      </Card>

      <Card title="Calls" hue="tool" meta={`${count(filtered.length)} of ${count(calls.length)} · newest first · a time is the run's start plus the entry's offset`}>
        <div className="overflow-x-auto">
          {/* Beside the rail the table has less room: under 960 of it, the run sits under the agent and the step under the tool. */}
          <table className="w-full min-w-[640px] border-collapse text-[11.5px]">
            <thead>
              <tr className="border-b border-line text-left text-[10.5px] text-faint">
                <th className="px-4 py-2 font-medium">When</th>
                <th className="hidden px-3 py-2 font-medium @[960px]:table-cell">Run</th>
                <th className="px-3 py-2 font-medium">
                  Agent<span className="@[960px]:hidden"> and run</span>
                </th>
                <th className="hidden px-3 py-2 font-medium @[960px]:table-cell">Step</th>
                <th className="px-3 py-2 font-medium">
                  Tool<span className="@[960px]:hidden"> and step</span>
                </th>
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
                  <td className="hidden max-w-[150px] px-3 py-2 align-top @[960px]:table-cell">
                    <RunLink run={c.run} entry={c.entry} />
                  </td>
                  <td className="px-3 py-2 align-top whitespace-nowrap text-dim">
                    {c.agent || <span className="text-ghost">unnamed</span>}
                    <span className="block w-[150px] @[960px]:hidden">
                      <RunLink run={c.run} entry={c.entry} />
                    </span>
                  </td>
                  <td className="hidden px-3 py-2 align-top @[960px]:table-cell">
                    <Mono className="text-[10.5px]">{c.node || "—"}</Mono>
                  </td>
                  <td className="min-w-[200px] px-3 py-2 align-top [overflow-wrap:anywhere]">
                    <Link href={runHref(c.run, c.entry)} onClick={(e) => e.stopPropagation()} className="focusable rounded-sm text-[12px] font-medium text-fg hover:underline">
                      {/* A long name breaks after its server, never mid-word. */}
                      {c.tool.includes(".") ? (
                        <>
                          {c.tool.slice(0, c.tool.indexOf(".") + 1)}
                          <wbr />
                          {c.tool.slice(c.tool.indexOf(".") + 1)}
                        </>
                      ) : (
                        c.tool
                      )}
                    </Link>
                    {c.node && <Mono className="block text-[10.5px] @[960px]:hidden">{c.node}</Mono>}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <Status tone={OUTCOME[c.outcome].tone}>{OUTCOME[c.outcome].label}</Status>
                      {c.outcome === "refused" && <ControlMark control={c.control} />}
                    </span>
                    {c.detail && (
                      <span className="mt-0.5 line-clamp-2 max-w-[56ch] text-[10.5px] leading-[1.5] [overflow-wrap:anywhere] text-faint" title={c.detail}>
                        {c.detail}
                      </span>
                    )}
                  </td>
                  <td className="tnum px-3 py-2 text-right align-top whitespace-nowrap text-dim">{c.ms === null ? <span className="text-ghost">not recorded</span> : durationText(c.ms)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-[11.5px] text-faint">
                    No call matches these filters.
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
    </ExploreFrame>
  );
}
