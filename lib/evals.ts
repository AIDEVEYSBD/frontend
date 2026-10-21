import { derive, type Matrix } from "./metrics";
import { isEvalOver, type EvalCaseResult, type EvalComparison, type EvalRateLimited, type EvalRunView, type ModelSummary } from "./api/l8";

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

/** The threshold against the score, in words: met, not met, still measuring, or none applies (not the spec's own suite, or a forced model). */
export function thresholdText(v: { threshold: number | null; passed_threshold: boolean | null; state?: string; forced?: boolean }): string {
  if (v.threshold === null) return v.forced ? "no threshold: a forced model is a comparison, never the gate's eval" : "no threshold: not the spec's own suite";
  if (v.passed_threshold === true) return `at or above the threshold ${v.threshold}`;
  if (v.passed_threshold === false) return `under the threshold ${v.threshold}`;
  return v.state && v.state !== "done" ? `threshold ${v.threshold}, still measuring` : `threshold ${v.threshold}`;
}

export type ThresholdTone = "ok" | "err" | "neutral";
export const thresholdTone = (v: { passed_threshold: boolean | null }): ThresholdTone => (v.passed_threshold === true ? "ok" : v.passed_threshold === false ? "err" : "neutral");

/* ═══════════════════ the history, as the console's /api/evals reads it ═══════════════════ */

export interface HistorySummary {
  batch_id?: string;
  forced?: boolean;
  compare?: boolean;
  tier?: "small" | "medium" | "large" | null;
  avg_ms?: number;
  tokens?: { in: number; out: number };
  model_calls?: number;
  cost_total?: number | null;
  cost_per_case?: number | null;
  incumbent?: string;
  /** The backend's runner: the version it measured (rows the console's runner wrote before L8 carry none). */
  version_digest?: string;
  /** The backend's runner: the recommendation, on every candidate's row once all are done. */
  comparison?: unknown;
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
  passed_threshold: boolean | null;
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
      duration_ms: n_(c.duration_ms) ?? 0,
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

const quality = (m: Pick<ModelSummary, "headline_f1" | "pass_rate">) => m.headline_f1 ?? m.pass_rate;

/**
 * The most recent comparison in a set's history. A batch the backend ran
 * carries its recommendation on every row (`summary.comparison`): that is
 * read as it is. A batch the console's own runner wrote before L8 carries
 * none, and is rebuilt from its rows (one per model), as the page always
 * did. A batch with fewer than two finished legs is not a comparison and
 * must not hide the last one that was.
 */
export function lastComparison(runs: readonly HistoryRow[], positive?: string): CompareResult | null {
  const batches = new Map<string, HistoryRow[]>();
  for (const r of runs) {
    const b = r.summary?.batch_id;
    if (!b || !r.summary?.compare || r.state !== "done") continue;
    batches.set(b, [...(batches.get(b) ?? []), r]);
  }
  const latest = [...batches.values()]
    .filter((rows) => rows.length >= 2 || rows.some((r) => r.summary?.comparison))
    .sort((a, b) => new Date(b[0].at).getTime() - new Date(a[0].at).getTime())[0];
  if (!latest) return null;
  const withCmp = latest.find((r) => r.summary?.comparison && typeof r.summary.comparison === "object");
  if (withCmp) {
    const c = o_(withCmp.summary?.comparison);
    const models = (Array.isArray(c.models) ? c.models : []).map((x) => {
      const m = o_(x);
      const t = o_(m.tokens);
      return {
        model: s_(m.model),
        forced: m.forced === true,
        tier: s_(m.tier) || null,
        run_id: s_(m.run_id),
        passed: n_(m.passed) ?? 0,
        total: n_(m.total) ?? 0,
        pass_rate: n_(m.pass_rate) ?? 0,
        headline_f1: n_(m.headline_f1),
        macro_f1: n_(m.macro_f1),
        invalid: n_(m.invalid) ?? 0,
        avg_ms: n_(m.avg_ms) ?? 0,
        tokens: { in: n_(t.in) ?? 0, out: n_(t.out) ?? 0 },
        model_calls: n_(m.model_calls) ?? 0,
        cost_total: n_(m.cost_total),
        cost_per_case: n_(m.cost_per_case),
      };
    });
    if (models.length >= 2) {
      return {
        batch_id: s_(c.batch_id),
        incumbent: s_(c.incumbent) || models[0].model,
        models,
        recommended: s_(c.recommended) || null,
        rationale: s_(c.rationale),
        runs: Array.isArray(c.runs) ? c.runs.map(s_) : models.map((m) => m.run_id),
        digest: withCmp.summary?.version_digest || withCmp.digest,
        at: withCmp.finished_at ?? withCmp.at,
      };
    }
  }
  if (latest.length < 2) return null;
  const models: ModelSummary[] = latest.map((r) => {
    const m = r.matrix ? derive(r.matrix, positive) : null;
    const durations = r.results.map((c) => c.duration_ms);
    return {
      model: r.model,
      forced: r.summary?.forced === true,
      run_id: r.id,
      tier: r.summary?.tier ?? null,
      passed: r.passed,
      total: r.total,
      pass_rate: r.passed / Math.max(1, r.total),
      headline_f1: m?.headlineF1 ?? null,
      macro_f1: m?.macroF1 ?? null,
      invalid: m?.invalid ?? 0,
      avg_ms: r.summary?.avg_ms ?? Math.round(durations.reduce((a, b) => a + b, 0) / Math.max(1, durations.length)),
      tokens: r.summary?.tokens ?? { in: 0, out: 0 },
      model_calls: r.summary?.model_calls ?? 0,
      cost_total: r.summary?.cost_total ?? null,
      cost_per_case: r.summary?.cost_per_case ?? null,
    };
  });
  const incumbent = latest[0].summary?.incumbent ?? models[0].model;
  const inc = models.find((m) => m.model === incumbent) ?? models[0];
  const eligible = models
    .filter((m) => quality(m) >= quality(inc) - 0.02 && m.invalid === 0 && m.cost_per_case !== null)
    .sort((a, b) => (a.cost_per_case as number) - (b.cost_per_case as number) || a.avg_ms - b.avg_ms);
  const best = eligible[0] ?? null;
  return {
    batch_id: latest[0].summary?.batch_id ?? "",
    digest: latest[0].digest,
    at: latest[0].at,
    incumbent: inc.model,
    models,
    recommended: best?.model ?? null,
    runs: models.map((m) => m.run_id),
    rationale: best
      ? best.model === inc.model
        ? "The incumbent is already the cheapest model that clears the bar."
        : `${best.model} clears the incumbent's quality within 0.02${inc.cost_per_case && best.cost_per_case !== null ? ` at ${Math.round((1 - best.cost_per_case / inc.cost_per_case) * 100)}% lower cost per case` : ""}.`
      : "No candidate cleared the incumbent's quality with a known cost; keep the incumbent.",
  };
}

/** A history row's state, when it is not a finished one: `running 1/3`, `queued`, `failed: interrupted…`; "" for a finished row. */
export function rowStateText(r: Pick<HistoryRow, "state" | "results" | "total" | "error">): string {
  if (r.state === "done") return "";
  if (r.state === "running") return `running ${r.results.length}/${r.total}`;
  if (r.state === "failed") return `failed${r.error ? `: ${r.error}` : ""}`;
  return r.state;
}
