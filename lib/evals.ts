import type { Matrix } from "./metrics";
import { comparisonOf, isEvalOver, type EvalCaseResult, type EvalComparison, type EvalRateLimited, type EvalRunView } from "./api/l8";

/**
 * The Evals page's readings of the backend's runner (phase L8): the runner
 * moved to the backend (`POST /api/agents/{id}/evals/run`, followed by
 * reading `GET /api/evals/runs/{id}`), so the page's live table, its
 * rate-limit note and its model comparison are read off the eval's view
 * rather than off a stream of the console's own. The sets and their history
 * stay the console's (`/api/evals`, the shared `eval_runs` table), and a row
 * the backend wrote reads there with its `state`, `threshold`,
 * `passed_threshold` and `by`. Pure: components/evals.tsx renders these,
 * tests/l8-logic.test.ts and tests/l8-contract.test.ts hold them.
 */

/** A comparison as the page shows it: the backend's, plus the version it measured and when, so a stale one reads as stale. */
export interface CompareResult extends EvalComparison {
  /** The version's digest every candidate pinned a copy of. */
  digest?: string;
  at?: string;
}

/** The comparison on a finished candidate's row, with the version it measured; null for a plain eval or one still running. */
export function compareFromView(v: Pick<EvalRunView, "comparison" | "version_digest" | "finished_at" | "at">): CompareResult | null {
  if (!v.comparison) return null;
  return { ...v.comparison, digest: v.version_digest || undefined, at: v.finished_at ?? v.at };
}

/** What the card shows while an eval runs: the candidate measured now, its graded cases, and a rate limit its next case waits on. */
export interface LiveEval {
  /** The row being followed now: the first not over, else the last. */
  id: string;
  model: string;
  done: number;
  total: number;
  passed: number;
  cases: EvalCaseResult[];
  throttle: EvalRateLimited | null;
  /** Of a comparison: which candidate, of how many. */
  leg: number;
  legs: number;
}

/**
 * A case's start the backend's runner is waiting to try again after a rate
 * limit: shown only while the eval runs and the case it names has not
 * started (`current.run` is ""). Once the eval is over the note stays on
 * the row as the record of the wait, and is not a wait any more.
 */
export function throttleOf(v: Pick<EvalRunView, "state" | "progress">): EvalRateLimited | null {
  const rl = v.progress.rate_limited;
  const cur = v.progress.current;
  if (!rl || v.state !== "running" || !cur || cur.run || cur.index !== rl.index) return null;
  return rl;
}

/** The live reading over every row of a request (one, or one per candidate), in the order started. */
export function liveOf(views: readonly EvalRunView[]): LiveEval | null {
  if (!views.length) return null;
  const open = views.findIndex((x) => !isEvalOver(x));
  const leg = open === -1 ? views.length - 1 : open;
  const v = views[leg];
  return { id: v.id, model: v.model, done: v.progress.done, total: v.progress.total || v.total, passed: v.progress.passed, cases: v.results, throttle: throttleOf(v), leg: leg + 1, legs: views.length };
}

/** What the comparison's rows ended in, once every one is over: the recommendation (the backend's) and any row that failed. */
export function settleOf(views: readonly EvalRunView[]): { comparison: CompareResult | null; failed: EvalRunView[] } {
  const failed = views.filter((v) => v.state === "failed");
  const withCmp = views.find((v) => v.comparison);
  return { comparison: withCmp ? compareFromView(withCmp) : null, failed };
}

/**
 * A finished evaluation's verdict against its threshold in a word: met, under, or incomplete (a case could not run or was not graded, so
 * the backend does not judge its score against the threshold and answers `passed_threshold` null with `threshold_why`); null when there is
 * none yet. Incomplete is read first: it is never shown as met or under.
 */
export function thresholdWord(v: { passed_threshold?: boolean | null; incomplete?: boolean | null; state?: string }): "met" | "under" | "incomplete" | null {
  if (v.incomplete && (v.state === undefined || v.state === "done")) return "incomplete";
  return v.passed_threshold === true ? "met" : v.passed_threshold === false ? "under" : null;
}

/** The threshold against the score, in words: met, not met, incomplete, still measuring, or none applies (not the spec's own suite, or a forced model). */
export function thresholdText(v: { threshold: number | null; passed_threshold: boolean | null; incomplete?: boolean; state?: string; forced?: boolean }): string {
  if (v.threshold === null) return v.forced ? "no threshold: forced model" : "no threshold: not the spec's own suite";
  const word = thresholdWord(v);
  if (word === "incomplete") return `incomplete · threshold ${v.threshold}`;
  if (word === "met") return `at or above the threshold ${v.threshold}`;
  if (word === "under") return `under the threshold ${v.threshold}`;
  return v.state && v.state !== "done" ? `threshold ${v.threshold}, still measuring` : `threshold ${v.threshold}`;
}

export type ThresholdTone = "ok" | "err" | "warn" | "neutral";
export const thresholdTone = (v: { passed_threshold?: boolean | null; incomplete?: boolean | null; state?: string }): ThresholdTone => {
  const word = thresholdWord(v);
  return word === "met" ? "ok" : word === "under" ? "err" : word === "incomplete" ? "warn" : "neutral";
};

/* ═══════════════════ the history, as the console's /api/evals reads it ═══════════════════ */

export interface HistorySummary {
  batch_id?: string;
  forced?: boolean;
  compare?: boolean;
  tier?: "small" | "medium" | "large" | null;
  /** null when no case ran: nothing was measured. */
  avg_ms?: number | null;
  /** This row's place among a comparison's candidates, and how many there are. */
  leg?: number;
  legs?: number;
  tokens?: { in: number; out: number };
  model_calls?: number;
  cost_total?: number | null;
  cost_per_case?: number | null;
  incumbent?: string;
  /** The backend's runner: the version it measured (rows the console's runner wrote before L8 carry none). */
  version_digest?: string;
  /** The backend's runner: the recommendation, on every candidate's row once all are done. */
  comparison?: unknown;
  /** Cases whose start was refused, cases that ran but could not be graded, and whether either is above 0. */
  refused?: number;
  not_graded?: number;
  incomplete?: boolean;
}

/** One row of `GET /api/evals?id=` history (the shared `eval_runs` table). */
export interface HistoryRow {
  id: string;
  model: string;
  digest: string;
  passed: number;
  total: number;
  results: EvalCaseResult[];
  matrix?: Matrix | null;
  summary?: HistorySummary | null;
  at: string;
  /** queued, running, done or failed; `done` for a row the console's runner wrote before L8. */
  state: string;
  threshold: number | null;
  /** null for an incomplete evaluation, with `threshold_why`: the backend does not judge such a score against the threshold. */
  passed_threshold: boolean | null;
  /** A case could not run or was not graded. */
  incomplete: boolean;
  threshold_why: string | null;
  /** Who started it ("" for a row from before L8). */
  by: string;
  version: number | null;
  finished_at: string | null;
  error: string;
}

const s_ = (v: unknown): string => (typeof v === "string" ? v : "");
const n_ = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const o_ = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** A history row as the page reads it; the columns L8 added default to a finished row of the console's when absent. */
export function historyRowOf(v: unknown): HistoryRow {
  const o = o_(v);
  const results = (Array.isArray(o.results) ? o.results : []).map((r) => {
    const c = o_(r);
    return {
      id: s_(c.id),
      note: s_(c.note),
      passed: c.passed === true,
      state: s_(c.state),
      error: s_(c.error),
      checks: (Array.isArray(c.checks) ? c.checks : []).map((k) => ({ kind: s_(o_(k).kind), ok: o_(k).ok === true, note: s_(o_(k).note) })),
      expected: typeof c.expected === "string" ? c.expected : null,
      predicted: typeof c.predicted === "string" ? c.predicted : null,
      duration_ms: n_(c.duration_ms),
      run_file: s_(c.run_file),
      outcome: s_(c.outcome),
    };
  });
  const m = o_(o.matrix);
  return {
    id: s_(o.id),
    model: s_(o.model) || "default",
    digest: s_(o.digest),
    passed: n_(o.passed) ?? 0,
    total: n_(o.total) ?? 0,
    results,
    matrix: Array.isArray(m.labels) && Array.isArray(m.counts) ? (m as unknown as Matrix) : null,
    summary: o.summary && typeof o.summary === "object" ? (o.summary as HistorySummary) : null,
    at: s_(o.at),
    state: s_(o.state) || "done",
    threshold: n_(o.threshold),
    passed_threshold: typeof o.passed_threshold === "boolean" ? o.passed_threshold : null,
    incomplete: o.incomplete === true || o_(o.summary).incomplete === true,
    threshold_why: s_(o.threshold_why) || null,
    by: s_(o.by),
    version: n_(o.version),
    finished_at: s_(o.finished_at) || null,
    error: s_(o.error),
  };
}

/**
 * An eval's view as a history row: what the set's history will read from
 * the shared table once the console's next read lands, so a finished eval
 * shows at once (and still shows if this console reads another database).
 */
export function historyRowFromView(v: EvalRunView): HistoryRow {
  return {
    id: v.id,
    model: v.model,
    digest: v.digest,
    passed: v.passed,
    total: v.total,
    results: v.results,
    matrix: v.matrix,
    summary: { ...(v.summary as HistorySummary), ...(v.comparison ? { comparison: v.comparison } : {}) },
    at: v.at,
    state: v.state,
    threshold: v.threshold,
    passed_threshold: v.passed_threshold,
    incomplete: v.incomplete,
    threshold_why: v.threshold_why,
    by: v.by,
    version: v.version,
    finished_at: v.finished_at,
    error: v.error,
  };
}

/** The history with rows the console has seen finish that its read does not hold yet, newest first. */
export function mergeHistory(history: readonly HistoryRow[], seen: readonly HistoryRow[]): HistoryRow[] {
  const have = new Set(history.map((r) => r.id));
  return [...seen.filter((r) => !have.has(r.id)), ...history].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id));
}

/** Whether a history row was written by the backend's runner: it names the version it measured. Only these count for the gate. */
export const isBackendRow = (r: Pick<HistoryRow, "summary">): boolean => Boolean(r.summary?.version_digest);

/** The rows of each model comparison in a set's history, newest batch first; each batch's rows in the history's order. */
function comparisonBatches(runs: readonly HistoryRow[]): HistoryRow[][] {
  const batches = new Map<string, HistoryRow[]>();
  for (const r of runs) {
    const b = r.summary?.batch_id;
    if (!b || !r.summary?.compare) continue;
    batches.set(b, [...(batches.get(b) ?? []), r]);
  }
  const started = (rows: HistoryRow[]) => Math.min(...rows.map((r) => Date.parse(r.at)).filter((t) => !Number.isNaN(t)));
  return [...batches.values()].sort((a, b) => started(b) - started(a));
}

const hasVerdict = (r: HistoryRow) => Boolean(r.summary?.comparison && typeof r.summary.comparison === "object");

/**
 * The most recent comparison in a set's history that the backend gave a
 * verdict: its runner writes the recommendation (`summary.comparison`) on
 * every candidate's row once the last candidate finishes. That is read as it
 * is; the console never builds a recommendation of its own. A batch with no
 * verdict yet (a candidate still queued or running, or the last one failed)
 * is not a comparison: `unfinishedComparison` says what became of it.
 */
export function lastComparison(runs: readonly HistoryRow[]): CompareResult | null {
  for (const rows of comparisonBatches(runs)) {
    const withCmp = rows.find(hasVerdict);
    if (!withCmp) continue;
    const c = comparisonOf(withCmp.summary?.comparison);
    if (!c || c.models.length < 2) continue;
    return { ...c, runs: c.runs.length ? c.runs : c.models.map((m) => m.run_id), digest: withCmp.summary?.version_digest || withCmp.digest, at: withCmp.finished_at ?? withCmp.at };
  }
  return null;
}

/** The newest comparison in a set's history when the backend has given it no verdict: what finished, what failed, what is still to run. */
export interface UnfinishedComparison {
  batch_id: string;
  at: string;
  /** Candidates in the batch, as the backend counted them (`summary.legs`), else the rows the history holds. */
  legs: number;
  done: string[];
  failed: { model: string; error: string }[];
  /** Candidates still queued or running. */
  open: string[];
}

/** The newest model comparison, when it has no verdict from the backend; null when it has one, or there is none. */
export function unfinishedComparison(runs: readonly HistoryRow[]): UnfinishedComparison | null {
  const newest = comparisonBatches(runs)[0];
  if (!newest || newest.some(hasVerdict)) return null;
  const label = (r: HistoryRow) => r.model || "default";
  const legs = Math.max(newest.length, ...newest.map((r) => (typeof r.summary?.legs === "number" ? r.summary.legs : 0)));
  return {
    batch_id: newest[0].summary?.batch_id ?? "",
    at: newest.map((r) => r.at).sort()[0] ?? "",
    legs,
    done: newest.filter((r) => r.state === "done").map(label),
    failed: newest.filter((r) => r.state === "failed").map((r) => ({ model: label(r), error: r.error })),
    open: newest.filter((r) => r.state === "queued" || r.state === "running").map(label),
  };
}

/** A history row's state, when it is not a finished one: `running 1/3`, `queued`, `failed: interrupted…`; "" for a finished row. */
export function rowStateText(r: Pick<HistoryRow, "state" | "results" | "total" | "error">): string {
  if (r.state === "done") return "";
  if (r.state === "running") return `running ${r.results.length}/${r.total}`;
  if (r.state === "failed") return `failed${r.error ? `: ${r.error}` : ""}`;
  return r.state;
}

/* ═══════════════════ the sets, as the backend reads them (L8, second round) ═══════════════════ */

/** The latest finished eval of a set, from the console's history read (the shared `eval_runs` table: the backend has no door that lists it). */
export interface SetLatest {
  passed: number;
  total: number;
  model: string;
  at: string;
  matrix?: Matrix | null;
  threshold?: number | null;
  /** null for an incomplete evaluation, with `threshold_why`. */
  passed_threshold?: boolean | null;
  threshold_why?: string | null;
  /** Cases whose start was refused, cases not graded, and whether either is above 0. */
  refused?: number;
  not_graded?: number;
  incomplete?: boolean;
  by?: string;
  version?: number | null;
}

/** A set as the Evals page lists it. */
export interface SetRow {
  id: string;
  agent: string;
  name: string;
  model: string;
  /** Cases. */
  n: number;
  labeled?: boolean;
  latest: SetLatest | null;
  /** The agent's spec names it as its own suite (`evals.dataset`): its threshold gates a deploy. */
  suite?: boolean;
  /** Where the eval runner reads it: the shared table (`db`), the workspace file (`file`); `console` when only the console's own read named it. */
  source?: string;
}

/**
 * The page's set list: the sets as the backend's eval runner reads them
 * (`GET /api/agents/{id}/eval-sets`: the shared table, then the workspace
 * files, with which one each spec names as its suite), each with its latest
 * finished score from the console's history read. A set only the console's
 * read names (its agent gone, or no backend to ask) is kept, marked
 * `console`, so nothing a team made disappears from the page. Newest first
 * by the backend's `updated_at`; a set from a file (no time) after them.
 */
export function mergeSetRows(
  backend: readonly { id: string; agent: string; name: string; model: string; labels: Record<string, unknown> | null; count: number; updated_at: string | null; source: string; suite: boolean }[],
  consoleRows: readonly SetRow[],
): SetRow[] {
  const latest = new Map(consoleRows.map((r) => [r.id, r.latest]));
  const updated = new Map<string, string>();
  const rows: SetRow[] = [];
  for (const s of backend) {
    if (updated.has(s.id)) continue;
    updated.set(s.id, s.updated_at ?? "");
    rows.push({ id: s.id, agent: s.agent, name: s.name, model: s.model, n: s.count, labeled: s.labels !== null, latest: latest.get(s.id) ?? null, suite: s.suite, source: s.source });
  }
  const at = (r: SetRow) => updated.get(r.id) ?? "";
  rows.sort((a, b) => (at(a) === at(b) ? 0 : !at(a) ? 1 : !at(b) ? -1 : at(a) < at(b) ? 1 : -1));
  return [...rows, ...consoleRows.filter((r) => !updated.has(r.id)).map((r) => ({ ...r, source: r.source ?? "console" }))];
}
