"use client";
import { Failure } from "./pending";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button, Status } from "./ui";
import { Banner } from "./overlays";
import { PageHeader } from "./section";
import { usePageFacts } from "./assistant";
import { WINDOWS, WindowPick, type Win } from "./window-pick";
import {
  fmtAge,
  fmtCount,
  fmtMoney,
  fmtMs,
  leaders,
  needsOf,
  plural,
  rankAgents,
  rankPeople,
  rankTools,
  spendText,
  unpricedWords,
  useFigures,
  useWaiting,
  windowWords,
  type RunMeasure,
  type ToolMeasure,
} from "./overview-data";
import { Card, CardFigure, FigureTile, FootNote, MeasureSwitch, Nothing, RankList, TrendBars } from "./overview-parts";

/**
 * Overview: what the estate is doing and what needs a person, on one screen.
 *
 * One window scopes every panel: the figures (runs, failed, spend), the three
 * rankings, the latency percentiles and the failure trend. Three figures are
 * about now and say so by carrying no window mark: what is running, what
 * waits at a gate, and what needs attention. Every figure is the platform's
 * own count (`GET /api/estate`, the same answer the Dashboards read); the
 * open items come from the attention queue and the approvals inbox.
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

  const figures = useFigures(win);
  const { gates, gatesError, attention, attentionError } = useWaiting();
  const f = figures.data;
  const [agentMeasure, setAgentMeasure] = useState<RunMeasure>("runs");
  const [toolMeasure, setToolMeasure] = useState<ToolMeasure>("calls");
  const [peopleMeasure, setPeopleMeasure] = useState<RunMeasure>("runs");
  // The clock ages are read against: stamped with each answer, so a render is a function of what was read.
  const now = figures.at || 0;

  const loading = f === null && !figures.error;
  const unread = f === null && Boolean(figures.error);
  /* An answer that came once and has failed since: the figures stay as of then, and say so. */
  const stale = f !== null && Boolean(figures.error);
  const chip = WINDOWS.find((w) => w.id === win)!.label;
  const total = f?.runs.total ?? 0;
  const state = (s: string) => f?.runs.by_state[s] ?? 0;

  const agents = useMemo(() => (f ? leaders(rankAgents(f, agentMeasure)) : { top: [], of: 0 }), [f, agentMeasure]);
  const people = useMemo(() => (f ? leaders(rankPeople(f, peopleMeasure)) : { top: [], of: 0 }), [f, peopleMeasure]);
  const tools = useMemo(() => (f ? leaders(rankTools(f, toolMeasure)) : { top: [], of: 0 }), [f, toolMeasure]);
  const peak = f ? Math.max(...f.trend.failed) : 0;

  const needs = useMemo(() => needsOf(attention, gates, now || Date.now()), [attention, gates, now]);
  const oldest = f?.now.oldest_gate_since ? now - Date.parse(f.now.oldest_gate_since) : null;
  const nobodyAnswered = attention === null && gates === null && Boolean(attentionError || gatesError);
  const latest = f?.now.last_run_at ?? null;

  usePageFacts(
    f
      ? {
          page: "Overview",
          window: win,
          runs_in_window: total,
          failed_in_window: state("failed"),
          spend_in_window_usd: f.spend.cost_usd,
          model_calls_with_no_price: f.spend.unpriced_calls,
          running_now: f.now.running,
          awaiting_approval: f.now.at_gate,
          p50_ms: f.latency?.p50 ?? null,
          p95_ms: f.latency?.p95 ?? null,
          open_attention_items: needs.length,
        }
      : null,
  );

  /** What a ranking says in place of rows (null when it has rows to show): `none` is what it says of a window that gives it nothing. */
  const noRows = (has: boolean, none: string) => {
    if (loading) return <Nothing>Reading the figures.</Nothing>;
    if (unread) return <Nothing>The figures could not be read.</Nothing>;
    if (!total && !has) return <Nothing>{latest ? `No runs in ${windowWords(win)}.` : "No runs yet."}</Nothing>;
    return has ? null : <Nothing>{none}</Nothing>;
  };
  const sub = (said: string) => (loading ? "reading the figures" : unread ? "figures not read" : said);

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
        What the estate is doing and what is waiting on a person.
      </PageHeader>

      {unread && (
        <Banner tone="err" title="The figures could not be read">
          {figures.error}
        </Banner>
      )}
      {stale && (
        <Banner tone="err" title={`The figures stopped answering; shown as of ${new Date(figures.at).toLocaleTimeString("en-GB")}`}>
          {figures.error}
        </Banner>
      )}
      {gatesError && gates !== null && (
        <Banner tone="err" title="The approvals inbox stopped answering">
          {gatesError}
        </Banner>
      )}
      {f && !latest && (
        <p className="rounded-md border border-line bg-surface px-3 py-2 text-[12px] leading-[1.5] text-dim">No agent has run on this deployment yet.</p>
      )}
      {f && latest && total === 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface px-3 py-2">
          <p className="min-w-0 grow text-[12px] leading-[1.5] text-dim">
            No runs in {windowWords(win)} · latest {fmtAge(now - Date.parse(latest))} ago
          </p>
          <Button size="sm" variant="solid" tone="ink" onClick={() => setWin("all")}>
            Show all runs
          </Button>
        </div>
      )}

      {/* ── figures ── */}
      <div className="@container">
        <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface elev-1 @min-[460px]:grid-cols-3 @min-[760px]:grid-cols-5">
          <FigureTile label="Runs" chip={chip} href="/runs" value={f ? fmtCount(total) : null} off={unread} sub={sub(total ? `${fmtCount(state("done"))} complete` : "none in this window")} />
          <FigureTile label="Running now" href="/runs" value={f ? fmtCount(f.now.running) : null} off={unread} tone={f?.now.running ? "run" : undefined} sub={sub(f?.now.running ? "in flight" : "nothing in flight")} />
          <FigureTile
            label="Awaiting approval"
            href="/approvals"
            value={f ? fmtCount(f.now.at_gate) : null}
            off={unread}
            tone={f?.now.at_gate ? "warn" : undefined}
            sub={sub(f?.now.at_gate ? (oldest !== null ? `oldest waiting ${fmtAge(oldest)}` : "gates open") : "no gates open")}
          />
          <FigureTile
            label="Failed"
            chip={chip}
            href="/runs"
            value={f ? fmtCount(state("failed")) : null}
            off={unread}
            tone={state("failed") ? "err" : undefined}
            sub={sub(total ? [`${percent(state("failed"), total)} of runs`, state("killed") ? `${fmtCount(state("killed"))} killed` : ""].filter(Boolean).join(" · ") : "none in this window")}
          />
          <FigureTile
            label="Spend"
            chip={chip}
            href="/finops"
            value={f ? spendText(f.spend) : null}
            off={unread}
            sub={sub(!f?.spend.calls ? "no model call in this window" : f.spend.unpriced_calls ? unpricedWords(f.spend) : `across ${plural(f.spend.calls, "model call")}`)}
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
            {noRows(agents.top.length > 0, f?.spend.unpriced_calls ? "No price set." : "No spend recorded in this window.") ?? (
              <RankList rows={agents.top} format={agentMeasure === "runs" ? fmtCount : fmtMoney} measure={agentMeasure === "runs" ? "runs" : "spent"} />
            )}
          </Card>

          <Card
            title="Top tools"
            action={<MeasureSwitch label="Rank tools by" value={toolMeasure} onChange={setToolMeasure} options={TOOL_MEASURES} />}
            footer={
              <>
                <FootNote>{tools.top.length ? `${tools.top.length} of ${plural(tools.of, "tool")}` : "By calls, or time in the tool"}</FootNote>
                <Button size="sm" href={`/explore?kind=tool_call&window=${win}`}>
                  View all
                </Button>
              </>
            }
          >
            {noRows(tools.top.length > 0, "No tool was called in this window.") ?? (
              <RankList rows={tools.top} format={toolMeasure === "calls" ? fmtCount : fmtMs} measure={toolMeasure === "calls" ? "calls" : "in the tool"} />
            )}
          </Card>

          <Card
            title="Top people"
            action={<MeasureSwitch label="Rank people by" value={peopleMeasure} onChange={setPeopleMeasure} options={RUN_MEASURES} />}
            footer={
              <>
                <FootNote>{people.top.length ? `${people.top.length} of ${plural(people.of, "person", "people")}, keys and services included` : "Who started the runs and made the calls"}</FootNote>
                <Button size="sm" href="/iam">
                  View all
                </Button>
              </>
            }
          >
            {noRows(people.top.length > 0, f?.spend.unpriced_calls ? "No price set." : "No spend recorded in this window.") ?? (
              <RankList rows={people.top} format={peopleMeasure === "runs" ? fmtCount : fmtMoney} measure={peopleMeasure === "runs" ? "runs" : "spent"} />
            )}
          </Card>

          <Card
            title="Latency"
            meta="run duration"
            footer={
              <>
                <FootNote>{f?.latency ? plural(f.latency.runs, "ended run") : "Ended runs"}</FootNote>
                <Button size="sm" href="/runs">
                  View runs
                </Button>
              </>
            }
          >
            {unread ? (
              <Nothing>The figures could not be read.</Nothing>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-4 px-4 pt-4 pb-3">
                  <CardFigure label="p50" value={f?.latency ? fmtMs(f.latency.p50) : "—"} />
                  <CardFigure label="p95" value={f?.latency ? fmtMs(f.latency.p95) : "—"} />
                  <CardFigure label="Slowest" value={f?.latency ? fmtMs(f.latency.max) : "—"} />
                </div>
                {!f?.latency && (
                  <p className="px-4 pb-4 text-[12px] leading-[1.55] text-faint">
                    {loading ? "Reading the figures." : total ? "No run has ended in this window." : latest ? `No runs in ${windowWords(win)}.` : "No runs yet."}
                  </p>
                )}
              </>
            )}
          </Card>

          <Card
            title="Failed runs"
            meta={f ? `per ${f.trend.unit}` : undefined}
            footer={
              <>
                <FootNote>{total ? `${fmtCount(state("failed"))} of ${plural(total, "run")} failed` : "Runs that ended in the failed state"}</FootNote>
                <Button size="sm" href="/runs">
                  View runs
                </Button>
              </>
            }
          >
            {unread || !f ? (
              <Nothing>{unread ? "The figures could not be read." : "Reading the figures."}</Nothing>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-4 px-4 pt-4 pb-3">
                  <CardFigure label="Failure rate" value={total ? percent(state("failed"), total) : "—"} tone={state("failed") ? "err" : undefined} />
                  <CardFigure label={`Most in one ${f.trend.unit === "30 days" ? "span" : f.trend.unit}`} value={total ? fmtCount(peak) : "—"} />
                </div>
                {state("failed") > 0 ? (
                  <div className="px-4 pb-4">
                    <TrendBars points={f.trend.failed} from={stamp(Date.parse(f.trend.from), f.trend.unit)} to="now" />
                  </div>
                ) : (
                  <p className="px-4 pb-4 text-[12px] leading-[1.55] text-faint">{total ? `No run failed in ${windowWords(win)}.` : latest ? `No runs in ${windowWords(win)}.` : "No runs yet."}</p>
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
                <FootNote>{needs.length > 5 ? `5 of ${fmtCount(needs.length)}, most urgent first` : attentionError && !nobodyAnswered ? "The attention queue was not read" : "Open items and pending gates"}</FootNote>
                <Button size="sm" href="/control">
                  Control
                </Button>
                <Button size="sm" href="/approvals">
                  Approvals
                </Button>
              </>
            }
          >
            {nobodyAnswered ? (
              <div className="flex flex-col gap-2 p-4">
                {attentionError && <Failure what="The attention queue could not be read" message={attentionError} />}
                {gatesError && <Failure what="The approvals inbox could not be read" message={gatesError} />}
              </div>
            ) : attention === null && gates === null ? (
              <Nothing>Reading the attention queue.</Nothing>
            ) : needs.length === 0 && (attentionError || gatesError) ? (
              <div className="flex flex-col gap-2 p-4">
                {attentionError && <Failure what="The attention queue could not be read" message={attentionError} />}
                {gatesError && <Failure what="The approvals inbox could not be read" message={gatesError} />}
              </div>
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
                      <span className="tnum text-right font-mono text-[11px] text-dim">{n.age === null ? "age unknown" : fmtAge(n.age)}</span>
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
