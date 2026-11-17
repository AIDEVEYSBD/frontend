"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button, Status } from "./ui";
import { Banner } from "./overlays";
import { QUIET } from "@/lib/quiet";
import { PageHeader } from "./section";
import { usePageFacts } from "./assistant";
import { WINDOWS, WindowPick, type Win } from "./window-pick";
import { inFlight } from "@/lib/api/l5";
import {
  TOOL_RUNS,
  failureTrend,
  journalsReadable,
  fmtAge,
  fmtCount,
  fmtMoney,
  fmtMs,
  inWindow,
  latencyOf,
  leaders,
  namesPerson,
  needsOf,
  oldestGate,
  rankAgents,
  rankStarters,
  totalsOf,
  useEstate,
  useToolCalls,
  windowWords,
  type RankRow,
  type RunMeasure,
  type ToolMeasure,
} from "./overview-data";
import { Card, CardFigure, FigureTile, FootNote, MeasureSwitch, Nothing, RankList, ReadError, TrendBars } from "./overview-parts";

/**
 * Overview: what the estate is doing and what needs a person, on one screen.
 *
 * One window scopes every panel: the figures (runs, failed, spend), the three
 * rankings, the latency percentiles and the failure trend. Two figures are
 * about now and say so by carrying no window mark: what is in flight and
 * what waits at a gate. Everything is counted from the run ledger
 * (`GET /api/runs`), the inbox (`GET /api/approvals`), the attention queue
 * (`GET /api/attention`) and the console's observability route; no door
 * returns a ranking, so components/overview-data.tsx computes them.
 *
 * "Top people" is only as good as the record: a ledger row names the door a
 * run came through (`source`), not a person, so until rows carry an owner
 * the list is of sources and is titled so.
 */

const DEFAULT_WINDOW: Win = "7d";

const RUN_MEASURES: { id: RunMeasure; label: string }[] = [
  { id: "runs", label: "Runs" },
  { id: "spend", label: "Spend" },
];
const TOOL_MEASURES: { id: ToolMeasure; label: string }[] = [
  { id: "calls", label: "Calls" },
  { id: "ms", label: "Time" },
];

const plural = (n: number, one: string, many = `${one}s`) => `${fmtCount(n)} ${n === 1 ? one : many}`;
const percent = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(part && part / whole < 0.1 ? 1 : 0)}%` : "0%");
const stamp = (t: number, unit: string) =>
  unit === "hour" ? new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function OverviewView() {
  return (
    <Suspense>
      <Overview />
    </Suspense>
  );
}

function Overview() {
  /* The window lives in the address (`?window=30d`), so a reload or a shared link opens on the same cut. */
  const asked = useSearchParams().get("window");
  const win: Win = WINDOWS.find((w) => w.id === asked)?.id ?? DEFAULT_WINDOW;
  const setWin = (w: Win) => window.history.replaceState(null, "", w === DEFAULT_WINDOW ? "/overview" : `/overview?window=${w}`);

  const estate = useEstate();
  const { runs, now, gates, attention } = estate;
  const [agentMeasure, setAgentMeasure] = useState<RunMeasure>("runs");
  const [toolMeasure, setToolMeasure] = useState<ToolMeasure>("calls");
  const [starterMeasure, setStarterMeasure] = useState<RunMeasure>("runs");

  const rows = useMemo(() => (runs ? inWindow(runs, (r) => r.at, now, win) : []), [runs, now, win]);
  const totals = useMemo(() => totalsOf(rows), [rows]);
  const live = runs ? inFlight(runs).length : 0;
  const latest = runs?.[0]?.at ?? null;
  const loading = runs === null && !estate.runsError;
  const unread = runs === null && Boolean(estate.runsError);
  /* A quiet console (lib/quiet.ts): a read that failed leaves its panel saying what it will hold, under the one note at the top, and no figure stands in for it. */
  const off = QUIET && unread;
  const gatesOff = QUIET && gates === null && Boolean(estate.gatesError);
  const chip = WINDOWS.find((w) => w.id === win)!.label;

  /* Rankings. */
  const agents = useMemo(() => leaders(rankAgents(rows, estate.names, agentMeasure)), [rows, estate.names, agentMeasure]);
  const starters = useMemo(() => rankStarters(rows, starterMeasure), [rows, starterMeasure]);
  const startersTop = useMemo(() => leaders(starters.rows), [starters]);
  const readable = journalsReadable(estate);
  const toolRuns = useMemo(() => (readable ? rows.slice(0, TOOL_RUNS) : []), [rows, readable]);
  const toolCalls = useToolCalls(toolRuns);
  const tools = useMemo(
    () => leaders(toolCalls.tools.map((t): RankRow => ({ key: t.tool, label: t.tool, value: toolMeasure === "calls" ? t.calls : t.ms, code: true }))),
    [toolCalls, toolMeasure],
  );

  /* Latency and failures. */
  const latency = useMemo(() => latencyOf(estate, rows, win), [estate, rows, win]);
  const trend = useMemo(() => {
    const earliest = runs?.length ? Date.parse(runs[runs.length - 1].at) : null;
    return failureTrend(rows, now, win, earliest);
  }, [rows, runs, now, win]);
  const peak = Math.max(...trend.points);

  /* What needs a person. */
  const needs = useMemo(() => needsOf(attention, gates, now), [attention, gates, now]);
  const waiting = gates && gates.length ? oldestGate(gates, now) : null;
  const nobodyAnswered = attention === null && gates === null && Boolean(estate.attentionError || estate.gatesError);

  usePageFacts(
    runs
      ? {
          page: "Overview",
          window: win,
          runs_in_window: totals.runs,
          failed_in_window: totals.failed,
          spend_in_window_usd: Number(totals.spend.toFixed(4)),
          running_now: live,
          awaiting_approval: gates?.length ?? null,
          p50_ms: latency?.p50 ?? null,
          p95_ms: latency?.p95 ?? null,
          open_attention_items: needs.length,
        }
      : null,
  );

  /** What a ranking says in place of rows (null when it has rows to show): `ranks` is what the list will hold once there are runs, `none` what it says of runs that give it nothing. */
  const noRows = (has: boolean, ranks: string, none: string) => {
    if (loading) return <Nothing>Reading the run ledger.</Nothing>;
    if (off) return <Nothing>{ranks}</Nothing>;
    if (unread) return <Nothing>The run ledger could not be read.</Nothing>;
    if (!rows.length) return <Nothing>{runs?.length ? `No runs in ${windowWords(win)}.` : `No runs yet. ${ranks}`}</Nothing>;
    return has ? null : <Nothing>{none}</Nothing>;
  };

  const toolsBody =
    noRows(true, "Tools rank here by calls, or by the time spent in them.", "") ??
    (tools.top.length ? null : !estate.observed ? (
      <Nothing>Reading the run journals.</Nothing>
    ) : toolCalls.pending ? (
      <Nothing>Reading tool calls from {plural(toolRuns.length, "run")}.</Nothing>
    ) : !readable || (toolCalls.read === 0 && toolCalls.unread > 0) ? (
      <Nothing>{QUIET ? "Tools rank here by calls, or by the time spent in them." : "The journals of these runs cannot be read from this console, so their tool calls are not counted."}</Nothing>
    ) : (
      <Nothing>These runs made no tool calls.</Nothing>
    ));
  const toolsNote = [
    tools.top.length ? `${tools.top.length} of ${plural(tools.of, "tool")}` : "",
    toolRuns.length && rows.length > toolRuns.length ? `the ${toolRuns.length} most recent of ${fmtCount(rows.length)} runs` : "",
    toolCalls.unread && !QUIET ? `${plural(toolCalls.unread, "run")} not readable` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  /* People only where the records name them: in the window, or (an empty window) anywhere in the ledger; an empty ledger keeps the list's intended name. */
  const people = rows.length ? starters.people : !runs?.length || runs.some(namesPerson);
  const startersNote = !people
    ? "Run records name a source, not a person"
    : startersTop.top.length
      ? [`${startersTop.top.length} of ${plural(startersTop.of, "person", "people")}`, starters.unnamed ? `${plural(starters.unnamed, "run")} name no person` : ""].filter(Boolean).join(" · ")
      : "Who started the runs";

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-5 px-5 py-7" data-hue="blue">
      <PageHeader
        title="Overview"
        action={
          <span className="flex flex-col items-end gap-1">
            <span className="text-[10px] text-faint">Window for every panel</span>
            <WindowPick value={win} onChange={setWin} />
          </span>
        }
      >
        What the estate is doing and what is waiting on a person. Each figure is counted from the run ledger, the approvals inbox and the attention queue, and leads to the page behind it.
      </PageHeader>

      {unread && (
        <Banner tone="err" title="The run ledger could not be read">
          {estate.runsError}. The figures below stay empty until it answers.
        </Banner>
      )}
      {runs && runs.length === 0 && (
        <p className="rounded-md border border-line bg-surface px-3 py-2 text-[12px] leading-[1.5] text-dim">No agent has run on this deployment yet. The figures and lists below fill in from the first run.</p>
      )}
      {runs && runs.length > 0 && rows.length === 0 && latest && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface px-3 py-2">
          <p className="min-w-0 grow text-[12px] leading-[1.5] text-dim">
            No runs in {windowWords(win)}. The latest run finished {fmtAge(now - Date.parse(latest))} ago.
          </p>
          <Button size="sm" variant="solid" tone="ink" onClick={() => setWin("all")}>
            Show all runs
          </Button>
        </div>
      )}

      {/* ── figures ── */}
      <div className="@container">
        <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface elev-1 @min-[460px]:grid-cols-3 @min-[760px]:grid-cols-5">
          <FigureTile label="Runs" chip={chip} href="/runs" value={runs ? fmtCount(totals.runs) : null} off={off} sub={loading ? "reading the ledger" : unread ? "ledger not read" : totals.runs ? `${fmtCount(totals.done)} complete` : "none in this window"} />
          <FigureTile label="Running now" href="/runs" value={runs ? fmtCount(live) : null} off={off} tone={live ? "run" : undefined} sub={loading ? "reading the ledger" : unread ? "ledger not read" : live ? "in flight" : "nothing in flight"} />
          <FigureTile
            label="Awaiting approval"
            href="/approvals"
            value={gates ? fmtCount(gates.length) : null}
            off={gatesOff}
            tone={gates?.length ? "warn" : undefined}
            sub={gates === null ? (estate.gatesError ? "inbox not read" : "reading the inbox") : gates.length ? (waiting !== null ? `oldest waiting ${fmtAge(waiting)}` : "gates open") : "no gates open"}
          />
          <FigureTile
            label="Failed"
            chip={chip}
            href="/runs"
            value={runs ? fmtCount(totals.failed) : null}
            off={off}
            tone={totals.failed ? "err" : undefined}
            sub={loading ? "reading the ledger" : unread ? "ledger not read" : totals.runs ? [`${percent(totals.failed, totals.runs)} of runs`, totals.killed ? `${fmtCount(totals.killed)} killed` : ""].filter(Boolean).join(" · ") : "none in this window"}
          />
          <FigureTile
            label="Spend"
            chip={chip}
            href="/finops"
            value={runs ? fmtMoney(totals.spend) : null}
            off={off}
            sub={loading ? "reading the ledger" : unread ? "ledger not read" : !totals.runs ? "nothing spent in this window" : totals.estimated ? `${plural(totals.estimated, "run")} priced by estimate` : `across ${plural(totals.runs, "run")}`}
          />
        </div>
      </div>

      {/* ── rankings, then latency, failures and what needs a person: three across, two across on a narrow window, one on a phone ── */}
      <div className="@container">
        <div className="grid grid-cols-1 gap-5 @min-[640px]:grid-cols-2 @min-[960px]:grid-cols-3">
          <Card
            title="Top agents"
            action={<MeasureSwitch label="Rank agents by" value={agentMeasure} onChange={setAgentMeasure} options={RUN_MEASURES} />}
            footer={
              <>
                <FootNote>{agents.top.length ? `${agents.top.length} of ${plural(agents.of, "agent")}` : "By runs or spend"}</FootNote>
                <Button size="sm" href="/agents">
                  View all
                </Button>
              </>
            }
          >
            {noRows(agents.top.length > 0, "Agents rank here by runs, or by spend.", "No spend recorded for these runs.") ?? <RankList rows={agents.top} format={agentMeasure === "runs" ? fmtCount : fmtMoney} measure={agentMeasure === "runs" ? "runs" : "spent"} />}
          </Card>

          <Card
            title="Top tools"
            action={<MeasureSwitch label="Rank tools by" value={toolMeasure} onChange={setToolMeasure} options={TOOL_MEASURES} />}
            footer={
              <>
                <FootNote>
                  <span title={toolsNote}>{toolsNote || "By calls or time in the tool"}</span>
                </FootNote>
                <Button size="sm" href="/configuration">
                  View all
                </Button>
              </>
            }
          >
            {toolsBody ?? <RankList rows={tools.top} format={toolMeasure === "calls" ? fmtCount : fmtMs} measure={toolMeasure === "calls" ? "calls" : "in the tool"} />}
          </Card>

          <Card
            title={people ? "Top people" : "Top sources"}
            action={<MeasureSwitch label={people ? "Rank people by" : "Rank sources by"} value={starterMeasure} onChange={setStarterMeasure} options={RUN_MEASURES} />}
            footer={
              <>
                <FootNote>
                  <span title={startersNote}>{startersNote}</span>
                </FootNote>
                <Button size="sm" href={people ? "/iam" : "/runs"}>
                  View all
                </Button>
              </>
            }
          >
            {noRows(startersTop.top.length > 0, "Whoever starts runs ranks here, as far as the run records name them.", "No spend recorded for these runs.") ?? <RankList rows={startersTop.top} format={starterMeasure === "runs" ? fmtCount : fmtMoney} measure={starterMeasure === "runs" ? "runs" : "spent"} />}
          </Card>

          <Card
            title="Latency"
            meta="run duration"
            footer={
              <>
                <FootNote>{latency ? `${plural(latency.runs, "run")}, from ${latency.basis === "traces" ? "the run journals" : "the run ledger"}` : "Start to finish, per run"}</FootNote>
                <Button size="sm" href="/runs">
                  View runs
                </Button>
              </>
            }
          >
            {off ? (
              <Nothing>The median run time, the time 95 in 100 runs finish within, and the slowest run show here.</Nothing>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-4 px-4 pt-4 pb-3">
                  <CardFigure label="p50" value={latency ? fmtMs(latency.p50) : "—"} />
                  <CardFigure label="p95" value={latency ? fmtMs(latency.p95) : "—"} />
                  <CardFigure label="Slowest" value={latency ? fmtMs(latency.max) : "—"} />
                </div>
                <p className="px-4 pb-4 text-[12px] leading-[1.55] text-faint">
                  {latency
                    ? `Half the runs finished within ${fmtMs(latency.p50)}, 95 in 100 within ${fmtMs(latency.p95)}.`
                    : loading
                      ? "Reading the run ledger."
                      : unread
                        ? "The run ledger could not be read."
                        : rows.length
                          ? "These runs carry no recorded duration."
                          : runs?.length
                            ? `No runs in ${windowWords(win)}, so there is no duration to measure.`
                            : "No runs yet, so there is no duration to measure."}
                </p>
              </>
            )}
          </Card>

          <Card
            title="Failed runs"
            meta={`per ${trend.unit}`}
            footer={
              <>
                <FootNote>{totals.runs ? `${fmtCount(totals.failed)} of ${plural(totals.runs, "run")} failed` : "Runs that ended in the failed state"}</FootNote>
                <Button size="sm" href="/runs">
                  View runs
                </Button>
              </>
            }
          >
            {off ? (
              <Nothing>The share of runs that failed, and the failed runs per {trend.unit === "30 days" ? "span" : trend.unit}, show here.</Nothing>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-4 px-4 pt-4 pb-3">
                  <CardFigure label="Failure rate" value={totals.runs ? percent(totals.failed, totals.runs) : "—"} tone={totals.failed ? "err" : undefined} />
                  <CardFigure label={`Most in one ${trend.unit === "30 days" ? "span" : trend.unit}`} value={totals.runs ? fmtCount(peak) : "—"} />
                </div>
                {totals.failed > 0 ? (
                  <div className="px-4 pb-4">
                    <TrendBars points={trend.points} from={stamp(trend.from, trend.unit)} to="now" />
                  </div>
                ) : (
                  <p className="px-4 pb-4 text-[12px] leading-[1.55] text-faint">
                    {loading ? "Reading the run ledger." : unread ? "The run ledger could not be read." : rows.length ? `No run failed in ${windowWords(win)}.` : runs?.length ? `No runs in ${windowWords(win)}.` : "No runs yet."}
                  </p>
                )}
              </>
            )}
          </Card>

          <Card
            title="Needs attention"
            hue="approval"
            meta={needs.length ? `${fmtCount(needs.length)} open` : undefined}
            footer={
              <>
                <FootNote>{needs.length > 5 ? `5 of ${fmtCount(needs.length)}, most urgent first` : estate.attentionError && !nobodyAnswered && !QUIET ? "The attention queue could not be read" : "Open items and pending gates"}</FootNote>
                <Button size="sm" href="/control">
                  Control
                </Button>
                <Button size="sm" href="/approvals">
                  Approvals
                </Button>
              </>
            }
          >
            {nobodyAnswered && QUIET ? (
              <Nothing>Open items and the gates waiting on a person list here, most urgent first.</Nothing>
            ) : nobodyAnswered ? (
              <ReadError>The attention queue and the inbox could not be read: {estate.attentionError || estate.gatesError}.</ReadError>
            ) : attention === null && gates === null ? (
              <Nothing>Reading the attention queue.</Nothing>
            ) : needs.length === 0 ? (
              <Nothing>Nothing is waiting on a person.</Nothing>
            ) : (
              <ul className="flex flex-col px-4 py-1">
                {needs.slice(0, 5).map((n) => (
                  <li key={n.id} className="border-b border-line last:border-0">
                    <Link href={n.href} title={`${n.title}${n.agent ? ` · ${n.agent}` : ""}`} className="focusable -mx-2 grid h-9 grid-cols-[minmax(0,5.5rem)_minmax(0,1fr)_auto] items-center gap-3 rounded-sm px-2 hover:bg-raise/50">
                      <span className="min-w-0 overflow-hidden">
                        <Status tone={n.tone}>{n.kind}</Status>
                      </span>
                      <span className="truncate text-[12px] text-mist">
                        {n.title}
                        {n.agent && <span className="text-faint"> · {n.agent}</span>}
                      </span>
                      <span className="tnum text-right font-mono text-[11px] text-dim">{fmtAge(n.age)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
