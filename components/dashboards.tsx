"use client";
import { notBuiltDoorOf } from "@/lib/api/client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button, Meter } from "./ui";
import { Banner } from "./overlays";
import { PageHeader } from "./section";
import { usePageFacts } from "./assistant";
import { WINDOWS, WindowPick, type Win } from "./window-pick";
import { OutcomesBody } from "./outcomes";
import { failureTrend, fmtAge, fmtCount, fmtMoney, inWindow, leaders, oldestGate, totalsOf, windowWords } from "./overview-data";
import { Card, CardFigure, FigureTile, FootNote, Nothing, RankList, TrendBars } from "./overview-parts";
import { bucketsOf, cutCost, rankControls, rankRefusals, resultTotals, useCost, useSecurity, staleOf } from "./dashboards-data";
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
 * A board holds no record of its own: every figure is counted from the doors
 * the page it links to reads (components/dashboards-data.tsx), so a figure
 * here and the page behind it agree. The board and the window live in the
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

const plural = (n: number, one: string, many = `${one}s`) => `${fmtCount(n)} ${n === 1 ? one : many}`;
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
      No runs in {windowWords(win)}. The latest run finished {fmtAge(age)} ago.
    </BoardNote>
  );
}

/* ═══════════════════ security posture ═══════════════════ */

const SECURITY_VIEW = "/explore?view=security";

function SecurityBoard({ win, setWin }: BoardProps) {
  const { runs, gates, lockdown, firings, names, now } = useSecurity();
  const chip = chipOf(win);

  const rows = useMemo(() => (runs.data ? inWindow(runs.data, (r) => r.at, now, win) : []), [runs.data, now, win]);
  const totals = useMemo(() => totalsOf(rows), [rows]);
  const refusals = useMemo(() => rows.reduce((a, r) => a + (r.denials > 0 ? r.denials : 0), 0), [rows]);
  const refusedRuns = useMemo(() => rows.filter((r) => r.denials > 0).length, [rows]);
  const refusers = useMemo(() => leaders(rankRefusals(rows, names)), [rows, names]);
  const controls = useMemo(() => (firings.data ? rankControls(firings.data, now, win) : null), [firings.data, now, win]);
  const controlsTop = useMemo(() => leaders(controls?.rows ?? []), [controls]);
  const trend = useMemo(() => {
    const all = runs.data ?? [];
    return failureTrend(rows, now, win, all.length ? Date.parse(all[all.length - 1].at) : null);
  }, [rows, runs.data, now, win]);
  const peak = Math.max(...trend.points);
  const waiting = useMemo(() => [...(gates.data ?? [])].sort((a, b) => (Date.parse(a.waiting_since) || Infinity) - (Date.parse(b.waiting_since) || Infinity)), [gates.data]);
  const oldest = gates.data?.length ? oldestGate(gates.data, now) : null;
  const latest = runs.data?.[0]?.at ?? null;

  /* A read that never answered: data null with a reason. A quiet console (lib/quiet.ts) says so once, under the switch, and its figures stay unset. */
  const unread = (r: { data: unknown; error: string }) => r.data === null && Boolean(r.error);
  const reading = (r: { data: unknown; error: string }) => r.data === null && !r.error;
  const failures = [
    unread(runs) ? `the run ledger (${runs.error})` : "",
    unread(gates) ? `the approvals inbox (${gates.error})` : "",
    unread(lockdown) ? `the lockdown (${lockdown.error})` : "",
    unread(firings) ? `the control firings (${firings.error})` : "",
  ].filter(Boolean);
  const off = (r: { data: unknown; error: string }) => (unread(r) ? (notBuiltDoorOf(r.error) ? "Not built" : "Not read") : false);
  const ledgerSub = (said: string) => (reading(runs) ? "reading the ledger" : unread(runs) ? "ledger not read" : !rows.length ? "no runs in this window" : said);

  usePageFacts(
    runs.data
      ? {
          page: "Dashboards",
          board: "Security posture",
          window: win,
          approvals_waiting: gates.data?.length ?? null,
          refused_calls_in_window: refusals,
          runs_killed_in_window: totals.killed,
          runs_failed_in_window: totals.failed,
          runs_in_window: totals.runs,
          lockdown_on: lockdown.data?.on ?? null,
        }
      : null,
  );

  /** What a ledger card says in place of its rows (null when it has rows): `holds` is what it will list, `none` what it says of runs that give it nothing. */
  const noRows = (has: boolean, holds: string, none: string) => {
    if (reading(runs)) return <Nothing>Reading the run ledger.</Nothing>;
    if (off(runs)) return <Nothing>{holds}</Nothing>;
    if (unread(runs)) return <Nothing>The run ledger could not be read.</Nothing>;
    if (!rows.length) return <Nothing>{runs.data?.length ? `No runs in ${windowWords(win)}.` : `No runs yet. ${holds}`}</Nothing>;
    return has ? null : <Nothing>{none}</Nothing>;
  };

  const lock = lockdown.data;
  const lockAt = lock?.at ? Date.parse(lock.at) : NaN;

  return (
    <>
      {[runs, gates, lockdown, firings].some(staleOf) && (
        <Banner tone="err" title="Some of this board stopped answering">
          Stale:{" "}
          {[
            staleOf(runs) ? `the run ledger (${runs.error})` : "",
            staleOf(gates) ? `the approvals inbox (${gates.error})` : "",
            staleOf(lockdown) ? `the lockdown (${lockdown.error})` : "",
            staleOf(firings) ? `the control firings (${firings.error})` : "",
          ]
            .filter(Boolean)
            .join("; ")}
          . Their figures are as each last answered, not current.
        </Banner>
      )}
      {failures.length > 0 && (
        <Banner tone="err" title="Some of this board could not be read">
          Not read: {failures.join("; ")}. Their figures stay empty until they answer.
        </Banner>
      )}
      {runs.data && runs.data.length === 0 && <BoardNote>No agent has run on this deployment yet. The figures and lists below fill in from the first run.</BoardNote>}
      {runs.data && runs.data.length > 0 && rows.length === 0 && latest && <EmptyWindow win={win} setWin={setWin} age={now - Date.parse(latest)} />}

      <FigureBand>
        <FigureTile
          label="Approvals waiting"
          href="/approvals"
          value={gates.data ? fmtCount(gates.data.length) : null}
          off={off(gates)}
          tone={gates.data?.length ? "warn" : undefined}
          sub={reading(gates) ? "reading the inbox" : unread(gates) ? "inbox not read" : gates.data?.length ? (oldest !== null ? `oldest waiting ${fmtAge(oldest)}` : "gates open") : "no gates open"}
        />
        <FigureTile
          label="Refused calls"
          chip={chip}
          href={SECURITY_VIEW}
          value={runs.data ? fmtCount(refusals) : null}
          off={off(runs)}
          tone={refusals ? "err" : undefined}
          sub={ledgerSub(refusals ? `in ${plural(refusedRuns, "run")}` : "no call refused")}
        />
        <FigureTile
          label="Runs killed"
          chip={chip}
          href={SECURITY_VIEW}
          value={runs.data ? fmtCount(totals.killed) : null}
          off={off(runs)}
          tone={totals.killed ? "err" : undefined}
          sub={ledgerSub(totals.killed ? `of ${plural(totals.runs, "run")}` : "no run killed")}
        />
        <FigureTile
          label="Lockdown"
          href={SECURITY_VIEW}
          value={lock ? (lock.on ? "On" : "Off") : null}
          off={off(lockdown)}
          tone={lock?.on ? "err" : undefined}
          sub={
            reading(lockdown)
              ? "reading the lockdown"
              : !lock
                ? "lockdown not read"
                : Number.isNaN(lockAt)
                  ? lock.on
                    ? "nothing new starts"
                    : "never set"
                  : `${lock.on ? "set" : "lifted"} ${fmtAge(now - lockAt)} ago${lock.by ? ` by ${lock.by}` : ""}`
          }
        />
        <FigureTile
          label="Failed runs"
          chip={chip}
          href="/runs"
          value={runs.data ? fmtCount(totals.failed) : null}
          off={off(runs)}
          tone={totals.failed ? "err" : undefined}
          sub={ledgerSub(`${percent(totals.failed, totals.runs)} of ${plural(totals.runs, "run")}`)}
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
          {reading(gates) ? (
            <Nothing>Reading the approvals inbox.</Nothing>
          ) : off(gates) ? (
            <Nothing>The gates waiting on a person list here, the one that has waited longest first.</Nothing>
          ) : unread(gates) ? (
            <Nothing>The approvals inbox could not be read.</Nothing>
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
              <FootNote>{refusals ? `${plural(refusals, "refused call")} in ${plural(refusedRuns, "run")}` : "Calls a control refused"}</FootNote>
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
          meta={controls && !controls.windowed ? "on record" : undefined}
          footer={
            <>
              <FootNote>
                {controls && controlsTop.top.length ? (
                  <span title={controls.windowed ? undefined : "The record dates only its latest firings, so this ranking is over every run on record and the window does not cut it."}>
                    {plural(controls.total, "firing")}
                    {controls.windowed ? "" : ", over every run on record"}
                  </span>
                ) : (
                  "Counted from the run journals"
                )}
              </FootNote>
              <Button size="sm" href="/guardrails">
                Controls
              </Button>
            </>
          }
        >
          {reading(firings) ? (
            <Nothing>Reading the control firings.</Nothing>
          ) : off(firings) ? (
            <Nothing>Controls rank here by how often they fired.</Nothing>
          ) : unread(firings) ? (
            <Nothing>The control firings could not be read.</Nothing>
          ) : controlsTop.top.length === 0 ? (
            <Nothing>{controls?.windowed && win !== "all" ? `No control fired in ${windowWords(win)}.` : "No control has fired yet."}</Nothing>
          ) : (
            <RankList rows={controlsTop.top} format={fmtCount} measure="firings" />
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
          {off(runs) ? (
            <Nothing>The share of runs that failed, and the failed runs per {trend.unit === "30 days" ? "span" : trend.unit}, show here.</Nothing>
          ) : !totals.runs ? (
            <Nothing>{reading(runs) ? "Reading the run ledger." : unread(runs) ? "The run ledger could not be read." : runs.data?.length ? `No runs in ${windowWords(win)}.` : "No runs yet."}</Nothing>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 px-4 pt-4 pb-3">
                <CardFigure label="Failure rate" value={percent(totals.failed, totals.runs)} tone={totals.failed ? "err" : undefined} />
                <CardFigure label={`Most in one ${trend.unit === "30 days" ? "span" : trend.unit}`} value={fmtCount(peak)} />
              </div>
              {totals.failed > 0 ? (
                <div className="px-4 pb-4">
                  <TrendBars points={trend.points} from={stamp(trend.from, trend.unit)} to="now" />
                </div>
              ) : (
                <p className="px-4 pb-4 text-[12px] leading-[1.55] text-faint">No run failed in {windowWords(win)}.</p>
              )}
            </>
          )}
        </Card>
      </CardGrid>

      <CloudFindingsCard now={now} />
    </>
  );
}

/* ═══════════════════ cost ═══════════════════ */

function CostBoard({ win, setWin }: BoardProps) {
  const { ledger, names } = useCost();
  const chip = chipOf(win);
  const data = ledger.data;
  const unread = data === null && Boolean(ledger.error);
  const reading = data === null && !ledger.error;
  const off = unread ? (notBuiltDoorOf(ledger.error) ? "Not built" : "Not read") : false;

  const cut = useMemo(() => (data ? cutCost(data, names, win) : null), [data, names, win]);
  const agents = useMemo(() => leaders(cut?.byAgent ?? []), [cut]);
  const models = useMemo(() => leaders(cut?.byModel ?? []), [cut]);
  const series = useMemo(() => (data && cut ? bucketsOf(cut.dated, data.now, win, cut.earliest) : null), [data, cut, win]);
  const peak = series ? Math.max(...series.points) : 0;
  const span = series ? (series.unit === "30 days" ? "span" : series.unit) : "day";
  const latest = data?.runs.length ? Math.max(...data.runs.map((r) => Date.parse(r.at)).filter((t) => !Number.isNaN(t))) : null;

  const budget = data?.budget ?? null;
  const state = data?.state ?? null;
  const used = state?.used ?? null;
  const budgetTone = state?.exceeded ? "err" : used !== null && used > 0.8 ? "warn" : undefined;

  usePageFacts(
    data && cut
      ? {
          page: "Dashboards",
          board: "Cost",
          window: win,
          spend_in_window_usd: Number(cut.spend.toFixed(4)),
          runs_in_window: cut.runs,
          model_calls_in_window: cut.calls,
          budget_usd: budget,
          budget_period: data.period,
          budget_used_share: used,
        }
      : null,
  );

  const sub = (said: string) => (reading ? "reading the cost ledger" : unread ? "cost ledger not read" : said);
  /** What a spend card says in place of its rows (null when it has rows). */
  const noRows = (has: boolean, holds: string) => {
    if (reading) return <Nothing>Reading the cost ledger.</Nothing>;
    if (off) return <Nothing>{holds}</Nothing>;
    if (unread) return <Nothing>The cost ledger could not be read.</Nothing>;
    if (!cut?.calls) return <Nothing>{data?.calls.length ? `No model calls in ${windowWords(win)}.` : `No model calls yet. ${holds}`}</Nothing>;
    return has ? null : <Nothing>No spend recorded for these calls.</Nothing>;
  };
  const finops = (
    <Button size="sm" href="/finops">
      Costs
    </Button>
  );

  return (
    <>
      {unread && (
        <Banner tone="err" title="The cost ledger could not be read">
          {ledger.error}. The figures below stay empty until it answers.
        </Banner>
      )}
      {staleOf(ledger) && (
        <Banner tone="err" title="The cost ledger stopped answering">
          {ledger.error}. The figures below are stale: they are as it last answered{ledger.at ? `, at ${new Date(ledger.at).toLocaleTimeString("en-GB")}` : ""}.
        </Banner>
      )}
      {data && data.runs.length === 0 && <BoardNote>No agent has run on this deployment yet. Spend shows here from the first model call.</BoardNote>}
      {data && cut && data.runs.length > 0 && cut.runs === 0 && latest !== null && <EmptyWindow win={win} setWin={setWin} age={data.now - latest} />}

      <FigureBand>
        <FigureTile
          label="Spend"
          chip={chip}
          href="/finops"
          value={cut ? fmtMoney(cut.spend) : null}
          off={off}
          sub={sub(!cut?.calls ? "nothing spent in this window" : cut.estimated ? `${plural(cut.estimated, "call")} priced by estimate` : `across ${plural(cut.calls, "model call")}`)}
        />
        <FigureTile label="Runs" chip={chip} href="/finops" value={cut ? fmtCount(cut.runs) : null} off={off} sub={sub(!cut?.runs ? "none in this window" : `${(cut.calls / cut.runs).toFixed(1)} model calls per run`)} />
        <FigureTile label="Cost per run" chip={chip} href="/finops" value={cut ? (cut.runs ? fmtSmall(cut.spend / cut.runs) : "No runs") : null} off={off} sub={sub(cut?.runs ? "spend divided by runs" : "none in this window")} />
        <FigureTile label="Tokens" chip={chip} href="/finops" value={cut ? fmtTokens(cut.tokens) : null} off={off} sub={sub(cut?.calls ? "in and out, every model call" : "none in this window")} />
        <FigureTile
          label="Budget used"
          href="/finops"
          value={data ? (budget === null ? "Not set" : used !== null ? percent(used, 1) : fmtMoney(budget)) : null}
          off={off}
          tone={budgetTone}
          sub={sub(budget === null ? "spend is not capped" : state?.exceeded ? "spent, new runs are refused" : state ? `${fmtMoney(state.spent)} of ${fmtMoney(budget)} this ${data?.period ?? "month"}` : `${fmtMoney(budget)} a ${data?.period ?? "month"}`)}
        />
      </FigureBand>

      <CardGrid>
        <Card
          title="Spend over time"
          meta={`per ${series?.unit ?? "day"}`}
          footer={
            <>
              <FootNote>{cut?.calls ? `${fmtMoney(cut.spend)} across ${plural(cut.calls, "model call")}` : "What the model calls were costed at"}</FootNote>
              {finops}
            </>
          }
        >
          {off ? (
            <Nothing>Spend per {span} over the window shows here.</Nothing>
          ) : !cut?.calls ? (
            <Nothing>{reading ? "Reading the cost ledger." : unread ? "The cost ledger could not be read." : data?.calls.length ? `No model calls in ${windowWords(win)}.` : "No model calls yet."}</Nothing>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-4 px-4 pt-4 pb-3">
                <CardFigure label="A day, on average" value={fmtSmall(cut.spend / cut.days)} />
                <CardFigure label={`Most in one ${span}`} value={fmtSmall(peak)} />
              </div>
              {series && peak > 0 ? (
                <div className="px-4 pb-4">
                  <ValueBars
                    points={series.points}
                    titles={series.points.map((v, i) => `${series.unit === "hour" ? "Hour" : series.unit === "day" ? "Day" : series.unit === "week" ? "Week" : "30 days"} from ${stamp(series.from + i * series.size, series.unit)}: ${fmtSmall(v)}`)}
                    from={stamp(series.from, series.unit)}
                    to="now"
                    describe={`Spend per ${span}`}
                  />
                </div>
              ) : (
                <p className="px-4 pb-4 text-[12px] leading-[1.55] text-faint">No spend recorded for these calls.</p>
              )}
            </>
          )}
        </Card>

        <Card
          title="Spend by agent"
          footer={
            <>
              <FootNote>{agents.top.length ? `${agents.top.length} of ${plural(agents.of, "agent")}` : "Where the spend went"}</FootNote>
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
              <FootNote>{models.top.length ? `${models.top.length} of ${plural(models.of, "model")}` : "Which models the spend went to"}</FootNote>
              {finops}
            </>
          }
        >
          {noRows(models.top.length > 0, "Models rank here by what the calls to them cost.") ?? <RankList rows={models.top} format={fmtMoney} measure="spent" />}
        </Card>

        <Card
          title="Budget"
          meta={budget !== null && data ? `per ${data.period}` : undefined}
          footer={
            <>
              <FootNote>{budget !== null ? "Runs are refused once the budget is spent" : "A cap on spend per day, week or month"}</FootNote>
              {finops}
            </>
          }
        >
          {reading ? (
            <Nothing>Reading the cost ledger.</Nothing>
          ) : off ? (
            <Nothing>The budget, how much of it is spent and what is left show here.</Nothing>
          ) : unread ? (
            <Nothing>The cost ledger could not be read.</Nothing>
          ) : budget === null || !data ? (
            <Nothing>No budget is set, so spend is not capped. A budget is set on the Costs page.</Nothing>
          ) : (
            <div className="flex flex-col gap-3 px-4 pt-4 pb-4">
              {state && used !== null && (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <CardFigure label="Used" value={percent(used, 1)} tone={state.exceeded ? "err" : undefined} />
                    <CardFigure label="Left" value={fmtMoney(Math.max(0, state.remaining ?? budget - state.spent))} />
                  </div>
                  <Meter value={used} tone={budgetTone ?? "run"} />
                </>
              )}
              <p className="text-[12px] leading-[1.55] text-faint">
                {state
                  ? state.exceeded
                    ? `${fmtMoney(state.spent)} of ${fmtMoney(budget)} is spent in the last ${PERIOD_WORDS[data.period]}. New runs are refused until spend falls back under the budget or the budget is raised.`
                    : `${fmtMoney(state.spent)} of ${fmtMoney(budget)} spent in the last ${PERIOD_WORDS[data.period]}.`
                  : `${fmtMoney(budget)} a ${data.period}.`}
                {cut && cut.windowBudget !== null && win !== "all" && ` Over ${windowWords(win)} the same rate allows ${fmtMoney(cut.windowBudget)}, and ${fmtMoney(cut.spend)} was spent.`}
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
  const off = answer?.state === "pending" ? "Not built" : answer?.state === "error" ? "Not read" : false;
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
