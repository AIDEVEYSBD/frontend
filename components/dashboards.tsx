"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button, Meter } from "./ui";
import { Banner } from "./overlays";
import { PageHeader } from "./section";
import { usePageFacts } from "./assistant";
import { WINDOWS, WindowPick, type Win } from "./window-pick";
import { OutcomesBody } from "./outcomes";
import { fmtAge, fmtCount, fmtMoney, leaders, plural, spendText, unpricedIn, unpricedWords, useFigures, useWaiting, windowWords } from "./overview-data";
import { Card, CardFigure, FigureTile, FootNote, Nothing, RankList, TrendBars } from "./overview-parts";
import { rankControls, rankRefusals, resultTotals, spendByAgent, spendByModel, windowBudget, windowDays } from "./dashboards-data";
import { notBuilt, notBuiltOf } from "@/lib/not-built";
import { BoardNote, BoardSwitch, CloudFindingsCard, ValueBars } from "./dashboards-parts";
import type { Answer, FindingsSummary } from "@/lib/api/pending";

/**
 * Dashboards: three fixed boards, and no chart builder.
 *
 *   Security posture   what waits on a person, what was refused or killed,
 *                      the lockdown, the controls that fired, the runs that failed
 *   Cost               spend over the window, by agent and by model, and
 *                      where it stands against the budget
 *   Workload results   the Results summary: findings by severity and status
 *                      for each workload
 *
 * A board holds no record of its own. The security posture and cost boards
 * show the platform's own counts for the window (`GET /api/estate`, the
 * answer the Overview reads too), so a figure here and on the Overview is
 * the same number; the results board reads the findings summary. The board and the window live in the
 * address (`?board=cost&window=30d`), so a reload or a shared link opens on
 * the same board over the same cut.
 */

type Board = "security" | "cost" | "results";

const BOARDS: { id: Board; label: string; line: string }[] = [
  { id: "security", label: "Security posture", line: "What waits on a person, what the controls stopped, and the runs that failed." },
  { id: "cost", label: "Cost", line: "What the model calls cost over the window, where it went, and the budget." },
  { id: "results", label: "Workload results", line: "What each security workload found over the window." },
];

const DEFAULT_BOARD: Board = "security";
const DEFAULT_WINDOW: Win = "7d";

const percent = (part: number, whole: number) => (whole ? `${((part / whole) * 100).toFixed(part && part / whole < 0.1 ? 1 : 0)}%` : "0%");
const stamp = (t: number, unit: string) =>
  unit === "hour" ? new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
/** A small amount with its cents kept: a cost per run is often under a cent. */
const fmtSmall = (c: number) => (c > 0 && c < 0.01 ? `$${c.toFixed(4)}` : fmtMoney(c));
const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(Math.round(n)));
const PERIOD_WORDS = { day: "24 hours", week: "7 days", month: "30 days" } as const;

/** The figures of a board: two across on a phone, three, then five. */
function FigureBand({ children }: { children: React.ReactNode }) {
  return (
    <div className="@container">
      <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-surface elev-1 @min-[460px]:grid-cols-3 @min-[760px]:grid-cols-5">{children}</div>
    </div>
  );
}

/** The cards of a board: one across, two, then four on a wide window. */
function CardGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-5 @min-[640px]:grid-cols-2 @min-[1360px]:grid-cols-4">{children}</div>
    </div>
  );
}

export function DashboardsView() {
  return (
    <Suspense>
      <Dashboards />
    </Suspense>
  );
}

function Dashboards() {
  const params = useSearchParams();
  const board: Board = BOARDS.find((b) => b.id === params.get("board"))?.id ?? DEFAULT_BOARD;
  const win: Win = WINDOWS.find((w) => w.id === params.get("window"))?.id ?? DEFAULT_WINDOW;
  const address = (b: Board, w: Win) => {
    const q = new URLSearchParams();
    if (b !== DEFAULT_BOARD) q.set("board", b);
    if (w !== DEFAULT_WINDOW) q.set("window", w);
    return q.size ? `/dashboards?${q}` : "/dashboards";
  };
  /* A board is a place (Back returns to the one before); the window is a setting of it. */
  const setBoard = (b: Board) => window.history.pushState(null, "", address(b, win));
  const setWin = (w: Win) => window.history.replaceState(null, "", address(board, w));

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-5 px-5 py-7" data-hue="blue">
      <PageHeader
        title="Dashboards"
        action={
          <span className="flex flex-col items-end gap-1">
            <span className="text-[10px] text-faint">Window for every card</span>
            <WindowPick value={win} onChange={setWin} />
          </span>
        }
      >
        Three fixed boards, each drawn from the same records as the pages it links to.
      </PageHeader>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <BoardSwitch value={board} onChange={setBoard} options={BOARDS} />
        <span className="text-[12px] leading-[1.5] text-faint">{BOARDS.find((b) => b.id === board)!.line}</span>
      </div>

      {board === "security" && <SecurityBoard win={win} setWin={setWin} />}
      {board === "cost" && <CostBoard win={win} setWin={setWin} />}
      {board === "results" && <ResultsBoard win={win} />}
    </div>
  );
}

interface BoardProps {
  win: Win;
  setWin: (w: Win) => void;
}

const chipOf = (win: Win) => WINDOWS.find((w) => w.id === win)!.label;

/** What a board says when its window holds no runs but the record does: how old the latest is, and the way to it. */
function EmptyWindow({ win, setWin, age }: BoardProps & { age: number }) {
  return (
    <BoardNote
      action={
        <Button size="sm" variant="solid" tone="ink" onClick={() => setWin("all")}>
          Show all runs
        </Button>
      }
    >
      No runs in {windowWords(win)}. The latest run was asked for {fmtAge(age)} ago.
    </BoardNote>
  );
}

/* ═══════════════════ security posture ═══════════════════ */

const SECURITY_VIEW = "/explore?view=security";

/** What a board says while its figures are not in hand: reading, or why they could not be read. */
function useBoardFigures(win: Win) {
  const figures = useFigures(win, 30_000);
  const f = figures.data;
  const reading = f === null && !figures.error;
  const unread = f === null && Boolean(figures.error);
  const off: false | string = unread ? (/not built/i.test(figures.error) ? "Not built" : "Not read") : false;
  const stale = f !== null && Boolean(figures.error);
  return { figures, f, reading, unread, off, stale };
}

function FiguresBanners({ figures, unread, stale }: { figures: { error: string; at: number }; unread: boolean; stale: boolean }) {
  return (
    <>
      {unread && (
        <Banner tone="err" title="The figures could not be read">
          {figures.error}. The figures below stay empty until the platform answers.
        </Banner>
      )}
      {stale && (
        <Banner tone="err" title="The figures stopped answering">
          {figures.error}. The figures below are stale: they are as the platform last answered{figures.at ? `, at ${new Date(figures.at).toLocaleTimeString("en-GB")}` : ""}.
        </Banner>
      )}
    </>
  );
}

function SecurityBoard({ win, setWin }: BoardProps) {
  const { figures, f, reading, unread, off, stale } = useBoardFigures(win);
  const { gates, gatesError } = useWaiting(30_000);
  const chip = chipOf(win);
  const now = figures.at || 0;
  const names = useMemo(() => Object.fromEntries((f?.rank.agents ?? []).map((a) => [a.id, a.name])), [f]);
  const refusers = useMemo(() => (f ? leaders(rankRefusals(f, names)) : { top: [], of: 0 }), [f, names]);
  const controls = useMemo(() => (f ? leaders(rankControls(f)) : { top: [], of: 0 }), [f]);
  const total = f?.runs.total ?? 0;
  const state = (s: string) => f?.runs.by_state[s] ?? 0;
  const peak = f ? Math.max(...f.trend.failed) : 0;
  const waiting = useMemo(() => [...(gates ?? [])].sort((a, b) => (Date.parse(a.waiting_since) || Infinity) - (Date.parse(b.waiting_since) || Infinity)), [gates]);
  const oldest = f?.now.oldest_gate_since ? now - Date.parse(f.now.oldest_gate_since) : null;
  const latest = f?.now.last_run_at ?? null;
  const lock = f?.now.lockdown ?? null;
  const lockAt = lock?.at ? Date.parse(lock.at) : NaN;

  usePageFacts(
    f
      ? {
          page: "Dashboards",
          board: "Security posture",
          window: win,
          approvals_waiting: f.now.at_gate,
          refused_calls_in_window: f.refusals.total,
          runs_killed_in_window: state("killed"),
          runs_failed_in_window: state("failed"),
          runs_in_window: total,
          lockdown_on: lock?.on ?? null,
        }
      : null,
  );

  const sub = (said: string) => (reading ? "reading the figures" : unread ? "figures not read" : said);
  /** What a card says in place of its rows (null when it has rows): `holds` is what it will list, `none` what it says of a window that gives it nothing. */
  const noRows = (has: boolean, holds: string, none: string) => {
    if (reading) return <Nothing>Reading the figures.</Nothing>;
    if (off) return <Nothing>{holds}</Nothing>;
    return has ? null : <Nothing>{latest ? none : `No runs yet. ${holds}`}</Nothing>;
  };

  return (
    <>
      <FiguresBanners figures={figures} unread={unread} stale={stale} />
      {f && !latest && <BoardNote>No agent has run on this deployment yet. The figures and lists below fill in from the first run.</BoardNote>}
      {f && latest && total === 0 && <EmptyWindow win={win} setWin={setWin} age={now - Date.parse(latest)} />}

      <FigureBand>
        <FigureTile
          label="Approvals waiting"
          href="/approvals"
          value={f ? fmtCount(f.now.at_gate) : null}
          off={off}
          tone={f?.now.at_gate ? "warn" : undefined}
          sub={sub(f?.now.at_gate ? (oldest !== null ? `oldest waiting ${fmtAge(oldest)}` : "gates open") : "no gates open")}
        />
        <FigureTile
          label="Refused calls"
          chip={chip}
          href={`/explore?kind=refusal&window=${win}`}
          value={f ? fmtCount(f.refusals.total) : null}
          off={off}
          tone={f?.refusals.total ? "err" : undefined}
          sub={sub(f?.refusals.total ? `in ${plural(f.refusals.runs, "run")}` : "no call refused")}
        />
        <FigureTile
          label="Runs killed"
          chip={chip}
          href="/runs"
          value={f ? fmtCount(state("killed")) : null}
          off={off}
          tone={state("killed") ? "err" : undefined}
          sub={sub(state("killed") ? `of ${plural(total, "run")}` : "no run killed")}
        />
        <FigureTile
          label="Lockdown"
          href="/control"
          value={lock ? (lock.on ? "On" : "Off") : null}
          off={off}
          tone={lock?.on ? "err" : undefined}
          sub={sub(!lock ? "" : Number.isNaN(lockAt) ? (lock.on ? "nothing new starts" : "never set") : `${lock.on ? "set" : "lifted"} ${fmtAge(now - lockAt)} ago${lock.by ? ` by ${lock.by}` : ""}`)}
        />
        <FigureTile
          label="Failed runs"
          chip={chip}
          href="/runs"
          value={f ? fmtCount(state("failed")) : null}
          off={off}
          tone={state("failed") ? "err" : undefined}
          sub={sub(total ? `${percent(state("failed"), total)} of ${plural(total, "run")}` : "no runs in this window")}
        />
      </FigureBand>

      <CardGrid>
        <Card
          title="Waiting for approval"
          meta={waiting.length ? "oldest first" : undefined}
          footer={
            <>
              <FootNote>{waiting.length > 5 ? `5 of ${fmtCount(waiting.length)} gates` : waiting.length ? plural(waiting.length, "gate") : "Gates a person has to answer"}</FootNote>
              <Button size="sm" href="/approvals">
                Approvals
              </Button>
            </>
          }
        >
          {gates === null && !gatesError ? (
            <Nothing>Reading the approvals inbox.</Nothing>
          ) : gates === null ? (
            <Nothing>The approvals inbox could not be read: {gatesError}</Nothing>
          ) : waiting.length === 0 ? (
            <Nothing>Nothing is waiting on a person.</Nothing>
          ) : (
            <ul className="flex flex-col px-4 py-1">
              {waiting.slice(0, 5).map((g) => {
                const since = Date.parse(g.waiting_since);
                const asks = g.asks || `${g.node || "A step"} is waiting for an answer`;
                return (
                  <li key={g.run} className="border-b border-line last:border-0">
                    <Link href="/approvals" title={`${asks}${g.agent ? ` · ${names[g.agent] ?? g.agent}` : ""}`} className="focusable -mx-2 grid h-9 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-sm px-2 hover:bg-raise/50">
                      <span className="truncate text-[12px] text-mist">
                        {asks}
                        {g.agent && <span className="text-faint"> · {names[g.agent] ?? g.agent}</span>}
                      </span>
                      <span className="tnum text-right font-mono text-[11px] text-dim">{Number.isNaN(since) ? "" : fmtAge(now - since)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card
          title="Refused calls by agent"
          footer={
            <>
              <FootNote>{f?.refusals.total ? `${plural(f.refusals.total, "refused call")} in ${plural(f.refusals.runs, "run")}` : "Calls a control refused"}</FootNote>
              <Button size="sm" href={SECURITY_VIEW}>
                Security events
              </Button>
            </>
          }
        >
          {noRows(refusers.top.length > 0, "Agents rank here by the calls a control refused them.", `No call was refused in ${windowWords(win)}.`) ?? <RankList rows={refusers.top} format={fmtCount} measure="refused calls" />}
        </Card>

        <Card
          title="Controls that fired most"
          footer={
            <>
              <FootNote>{f?.firings.total ? plural(f.firings.total, "firing") : "Counted from the run journals"}</FootNote>
              <Button size="sm" href="/guardrails">
                Controls
              </Button>
            </>
          }
        >
          {noRows(controls.top.length > 0, "Controls rank here by how often they fired.", `No control fired in ${windowWords(win)}.`) ?? <RankList rows={controls.top} format={fmtCount} measure="firings" />}
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
          {off ? (
            <Nothing>The share of runs that failed, and the failed runs over the window, show here.</Nothing>
          ) : !f || !total ? (
            <Nothing>{reading ? "Reading the figures." : latest ? `No runs in ${windowWords(win)}.` : "No runs yet."}</Nothing>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 px-4 pt-4 pb-3">
                <CardFigure label="Failure rate" value={percent(state("failed"), total)} tone={state("failed") ? "err" : undefined} />
                <CardFigure label={`Most in one ${f.trend.unit === "30 days" ? "span" : f.trend.unit}`} value={fmtCount(peak)} />
              </div>
              {state("failed") > 0 ? (
                <div className="px-4 pb-4">
                  <TrendBars points={f.trend.failed} from={stamp(Date.parse(f.trend.from), f.trend.unit)} to="now" />
                </div>
              ) : (
                <p className="px-4 pb-4 text-[12px] leading-[1.55] text-faint">No run failed in {windowWords(win)}.</p>
              )}
            </>
          )}
        </Card>
      </CardGrid>

      <CloudFindingsCard now={now || Date.now()} />
    </>
  );
}

/* ═══════════════════ cost ═══════════════════ */

function CostBoard({ win, setWin }: BoardProps) {
  const { figures, f, reading, unread, off, stale } = useBoardFigures(win);
  const chip = chipOf(win);
  const now = figures.at || 0;
  const agents = useMemo(() => (f ? leaders(spendByAgent(f)) : { top: [], of: 0 }), [f]);
  const models = useMemo(() => (f ? leaders(spendByModel(f)) : { top: [], of: 0 }), [f]);
  const spend = f?.spend ?? null;
  const total = f?.runs.total ?? 0;
  const days = f ? windowDays(f) : 1;
  const series = f?.trend ?? null;
  const peak = series ? Math.max(...series.cost_usd) : 0;
  const span = series ? (series.unit === "30 days" ? "span" : series.unit) : "day";
  const latest = f?.now.last_run_at ?? null;
  const budget = f?.budget ?? null;
  const used = budget?.used ?? null;
  const budgetTone = budget?.exceeded ? "err" : used !== null && used > 0.8 ? "warn" : undefined;
  const scaled = f ? windowBudget(f) : null;
  const priced = spend?.cost_usd ?? null;

  usePageFacts(
    f && spend
      ? {
          page: "Dashboards",
          board: "Cost",
          window: win,
          spend_in_window_usd: spend.cost_usd,
          model_calls_with_no_price: spend.unpriced_calls,
          runs_in_window: total,
          model_calls_in_window: spend.calls,
          budget_usd: budget?.budget_usd ?? null,
          budget_period: budget?.period ?? null,
          budget_used_share: used,
        }
      : null,
  );

  const sub = (said: string) => (reading ? "reading the figures" : unread ? "figures not read" : said);
  /** What a spend card says in place of its rows (null when it has rows). */
  const noRows = (has: boolean, holds: string) => {
    if (reading) return <Nothing>Reading the figures.</Nothing>;
    if (off) return <Nothing>{holds}</Nothing>;
    if (!spend?.calls) return <Nothing>{latest ? `No model calls in ${windowWords(win)}.` : `No model calls yet. ${holds}`}</Nothing>;
    return has ? null : <Nothing>{spend.unpriced_calls ? `No priced spend: ${unpricedWords(spend)}.` : "No spend recorded for these calls."}</Nothing>;
  };
  const finops = (
    <Button size="sm" href="/finops">
      Costs
    </Button>
  );
  const unpricedNote = spend?.unpriced_calls ? ` · ${unpricedWords(spend)}, not counted` : "";

  return (
    <>
      <FiguresBanners figures={figures} unread={unread} stale={stale} />
      {f && !latest && <BoardNote>No agent has run on this deployment yet. Spend shows here from the first model call.</BoardNote>}
      {f && latest && total === 0 && <EmptyWindow win={win} setWin={setWin} age={now - Date.parse(latest)} />}

      <FigureBand>
        <FigureTile
          label="Spend"
          chip={chip}
          href="/finops"
          value={spend ? spendText(spend) : null}
          off={off}
          sub={sub(!spend?.calls ? "nothing spent in this window" : spend.unpriced_calls ? `${unpricedWords(spend)}, not counted` : `across ${plural(spend.calls, "model call")}`)}
        />
        <FigureTile label="Runs" chip={chip} href="/finops" value={f ? fmtCount(total) : null} off={off} sub={sub(!total ? "none in this window" : `${((spend?.calls ?? 0) / total).toFixed(1)} model calls per run`)} />
        <FigureTile
          label="Cost per run"
          chip={chip}
          href="/finops"
          value={f ? (!total ? "No runs" : priced === null ? "Not priced" : fmtSmall(priced / total)) : null}
          off={off}
          sub={sub(total ? (spend?.unpriced_calls ? "priced spend divided by runs; calls with no price left out" : "spend divided by runs") : "none in this window")}
        />
        <FigureTile label="Tokens" chip={chip} href="/finops" value={spend ? fmtTokens(spend.tokens_in + spend.tokens_out) : null} off={off} sub={sub(spend?.calls ? "in and out, every model call" : "none in this window")} />
        <FigureTile
          label="Budget used"
          href="/finops"
          value={f ? (budget === null ? "Not set" : percent(budget.used, 1)) : null}
          off={off}
          tone={budgetTone}
          sub={sub(budget === null ? "spend is not capped" : budget.exceeded ? "spent, new runs are refused" : `${fmtMoney(budget.spent)} of ${fmtMoney(budget.budget_usd)} this ${budget.period}`)}
        />
      </FigureBand>

      <CardGrid>
        <Card
          title="Spend over time"
          meta={`per ${series?.unit ?? "day"}`}
          footer={
            <>
              <FootNote>{spend?.calls ? `${spendText(spend)} across ${plural(spend.calls, "model call")}${unpricedNote}` : "What the model calls were costed at"}</FootNote>
              {finops}
            </>
          }
        >
          {off ? (
            <Nothing>Spend per {span} over the window shows here.</Nothing>
          ) : !spend?.calls || !series ? (
            <Nothing>{reading ? "Reading the figures." : latest ? `No model calls in ${windowWords(win)}.` : "No model calls yet."}</Nothing>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 px-4 pt-4 pb-3">
                <CardFigure label="A day, on average" value={priced === null ? "Not priced" : fmtSmall(priced / days)} />
                <CardFigure label={`Most in one ${span}`} value={fmtSmall(peak)} />
              </div>
              {peak > 0 ? (
                <div className="px-4 pb-4">
                  <ValueBars
                    points={series.cost_usd}
                    titles={series.cost_usd.map(
                      (v, i) =>
                        `${series.unit === "hour" ? "Hour" : series.unit === "day" ? "Day" : series.unit === "week" ? "Week" : "30 days"} from ${stamp(Date.parse(series.from) + i * series.size_s * 1000, series.unit)}: ${fmtSmall(v)}${series.unpriced_calls[i] ? `, and ${plural(series.unpriced_calls[i], "call")} with no price` : ""}`,
                    )}
                    from={stamp(Date.parse(series.from), series.unit)}
                    to="now"
                    describe={`Spend per ${span}`}
                  />
                </div>
              ) : (
                <p className="px-4 pb-4 text-[12px] leading-[1.55] text-faint">{spend.unpriced_calls ? `No priced spend: ${unpricedWords(spend)}.` : "No spend recorded for these calls."}</p>
              )}
            </>
          )}
        </Card>

        <Card
          title="Spend by agent"
          footer={
            <>
              <FootNote>
                {agents.top.length ? `${agents.top.length} of ${plural(agents.of, "agent")}` : "Where the spend went"}
                {f && unpricedIn(f.rank.agents) ? ` · ${plural(unpricedIn(f.rank.agents), "call")} with no price not counted` : ""}
              </FootNote>
              {finops}
            </>
          }
        >
          {noRows(agents.top.length > 0, "Agents rank here by what their model calls cost.") ?? <RankList rows={agents.top} format={fmtMoney} measure="spent" />}
        </Card>

        <Card
          title="Spend by model"
          footer={
            <>
              <FootNote>
                {models.top.length ? `${models.top.length} of ${plural(models.of, "model")}` : "Which models the spend went to"}
                {f && unpricedIn(f.rank.models) ? ` · ${plural(unpricedIn(f.rank.models), "call")} with no price not counted` : ""}
              </FootNote>
              {finops}
            </>
          }
        >
          {noRows(models.top.length > 0, "Models rank here by what the calls to them cost.") ?? <RankList rows={models.top} format={fmtMoney} measure="spent" />}
        </Card>

        <Card
          title="Budget"
          meta={budget ? `per ${budget.period}` : undefined}
          footer={
            <>
              <FootNote>{budget ? "Runs are refused once the budget is spent" : "A cap on spend per day, week or month"}</FootNote>
              {finops}
            </>
          }
        >
          {reading ? (
            <Nothing>Reading the figures.</Nothing>
          ) : off ? (
            <Nothing>The budget, how much of it is spent and what is left show here.</Nothing>
          ) : budget === null ? (
            <Nothing>No budget is set, so spend is not capped. A budget is set on the Costs page.</Nothing>
          ) : (
            <div className="flex flex-col gap-3 px-4 pt-4 pb-4">
              <div className="grid grid-cols-2 gap-4">
                <CardFigure label="Used" value={percent(budget.used, 1)} tone={budget.exceeded ? "err" : undefined} />
                <CardFigure label="Left" value={fmtMoney(Math.max(0, budget.remaining))} />
              </div>
              <Meter value={budget.used} tone={budgetTone ?? "run"} />
              <p className="text-[12px] leading-[1.55] text-faint">
                {budget.exceeded
                  ? `${fmtMoney(budget.spent)} of ${fmtMoney(budget.budget_usd)} is spent in the last ${PERIOD_WORDS[budget.period]}. New runs are refused until spend falls back under the budget or the budget is raised.`
                  : `${fmtMoney(budget.spent)} of ${fmtMoney(budget.budget_usd)} spent in the last ${PERIOD_WORDS[budget.period]}.`}
                {budget.unpriced ? ` ${plural(budget.unpriced, "call")} with no price set are not counted against it.` : ""}
                {scaled !== null && win !== "all" && priced !== null && ` Over ${windowWords(win)} the same rate allows ${fmtMoney(scaled)}, and ${fmtMoney(priced)} was spent.`}
              </p>
            </div>
          )}
        </Card>
      </CardGrid>
    </>
  );
}

/* ═══════════════════ workload results ═══════════════════ */

function ResultFigures({ answer, win }: { answer: Answer<FindingsSummary> | null; win: Win }) {
  const chip = chipOf(win);
  const t = resultTotals(answer);
  /* The door is not there, or did not answer: the tiles say so and carry no figure. */
  // The summary names its producer as not built: every figure is empty because nothing can fill it, so the tiles say "Not built" instead of zeros.
  const unproduced = answer?.state === "ok" && notBuilt(notBuiltOf(answer.data), "producer");
  const off = answer?.state === "pending" || unproduced ? "Not built" : answer?.state === "error" ? "Not read" : false;
  const sub = (said: string) => (answer === null ? "reading the summary" : t ? said : "summary not read");
  return (
    <FigureBand>
      <FigureTile label="Workload runs" chip={chip} href="/outcomes" value={t ? fmtCount(t.runs) : null} off={off} sub={sub(t?.runs ? `across ${plural(t.workloads, "workload")}` : "none in this window")} />
      <FigureTile label="Findings" chip={chip} href="/findings" value={t ? fmtCount(t.findings) : null} off={off} sub={sub(t?.findings ? "every severity" : "none in this window")} />
      <FigureTile label="Critical and high" chip={chip} href="/findings" value={t ? fmtCount(t.severe) : null} off={off} tone={t?.severe ? "err" : undefined} sub={sub(t?.findings ? `${percent(t.severe, t.findings)} of findings` : "none in this window")} />
      <FigureTile label="Open" chip={chip} href="/findings?status=open" value={t ? fmtCount(t.open) : null} off={off} tone={t?.open ? "warn" : undefined} sub={sub(t?.open ? "not yet looked at" : "none in this window")} />
      <FigureTile label="Remediated" chip={chip} href="/findings?status=remediated" value={t ? fmtCount(t.remediated) : null} off={off} sub={sub(t?.remediated ? "reported as fixed" : "none in this window")} />
    </FigureBand>
  );
}

function ResultsBoard({ win }: { win: Win }) {
  /* The Results summary's own body, so the board and the Summary tab are one implementation over one door. */
  return <OutcomesBody win={win} compact figures={(answer) => <ResultFigures answer={answer} win={win} />} />;
}
