import { errorText } from "./client";
import { DoorError } from "./l5";
import { rateLimitOf, type RateLimit } from "./l7";
import type { Matrix, Metrics } from "../metrics";

/**
 * The L8 doors of the first round (backend/CONTRACT.md, "L8: lifecycle and
 * deliverables", "As built (backend, L8 first half)"): evals on the backend,
 * policy reviews with separation of duties, the promotion gate on a deploy
 * to production with an administrator's override, drafts, deployments per
 * environment, the lifecycle spine, rollback with its flagged runs, and
 * retirement.
 *
 * Every shape here was written against responses captured from the
 * backend's own app, driven in-process through its doors (the scratchpad
 * capture reuses backend/tests/l8.py and the test_l8_*.py fixtures without
 * editing them); tests/l8-contract.test.ts replays them through the calls
 * and mappings below with fetch stubbed and holds each console shape to the
 * generated schema field by field. The calls are plain fetches read by
 * mapping functions, as lib/api/l6.ts, l7.ts and l7b.ts do: a refusal
 * carries more than the generated ErrorBody types (the unmet conditions on a
 * gate's 409, the control on a 403 or a retired 409, the field on a 400 or a
 * 404), and every answer is read defensively. Same-origin: proxy.ts forwards
 * `/api/agents` and `/api/evals/runs` to the backend (lib/route-policy.ts
 * BACKEND_PREFIXES), behind the cookie.
 *
 * The eval runner moved here from the console: `POST
 * /api/agents/{id}/evals/run` answers 202 at once and the run is followed by
 * reading `GET /api/evals/runs/{id}` until it is done (followEval). A deploy
 * gate trusts only a score the backend produced itself.
 */

/* ═══════════════════ reading ═══════════════════ */

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : v === null || v === undefined ? d : String(v));
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const isObj = (v: unknown): boolean => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const boolOrNull = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const objs = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObj).map(obj) : []);
const enc = encodeURIComponent;

/* ═══════════════════ evals ═══════════════════ */

/** queued (accepted, nothing run), running, done (every case graded), failed (the runner stopped, or an instance left it: `error` says why). */
export type EvalState = "queued" | "running" | "done" | "failed";
export const EVAL_STATES: EvalState[] = ["queued", "running", "done", "failed"];

/** What the request names; everything is optional: the latest version's digest, the spec's own suite (`evals.dataset`), the set's model. */
export interface EvalRequest {
  set?: string;
  model?: string;
  /** A digest of the agent's: the newest version carrying it is evaluated. */
  digest?: string;
  /** One row per candidate, every model call pinned to it: the incumbent's tier, that tier and the one below, every model offered, or the models named. */
  compare?: { scope?: "class" | "below" | "all"; models?: string[] };
}

/** `POST /api/agents/{id}/evals/run` (202): accepted; read it at the status URL. */
export interface EvalRunStarted {
  /** The row to read; with `compare`, the incumbent's. */
  id: string;
  /** Every row this request writes: one, or one per candidate. */
  runs: string[];
  batch_id: string;
  agent: string;
  set: string;
  /** The version's digest (a comparison's rows each run a pinned document of their own). */
  digest: string;
  version: number | null;
  /** Cases per row. */
  total: number;
  /** The spec's own suite: its threshold applies. */
  dataset: boolean;
  threshold: number | null;
  /** `default` for the deployment's default model. */
  models: string[];
  compare: boolean;
  status_url: string;
}

export type EvalCheck = {
  kind: string;
  ok: boolean;
  note: string;
};

/** One case, graded: the console's record as it was, plus the outcome drift compares with production. */
export type EvalCaseResult = {
  id: string;
  note: string;
  passed: boolean;
  /** The run's final state, or `failed` for a start that was refused. */
  state: string;
  error: string;
  checks: EvalCheck[];
  /** A labeled set's ground truth and the label the run's result reduced to; null when the set is not labeled (or, for `predicted`, the result named no label). */
  expected: string | null;
  predicted: string | null;
  duration_ms: number;
  /** The case's run on the backend; "" when its start was refused (a rate limit past its retries, a lockdown that landed mid-eval). */
  run_file: string;
  /** What drift compares: the spec's `evals.compare` field, else `state:<final>`. */
  outcome: string;
};

/** The case running now. `run` is "" until its start is accepted (a rate limit holds it meanwhile). */
export type EvalCurrent = {
  index: number;
  id: string;
  model: string;
  run: string;
};

/** The last rate limit a case's start waited on; it stays on the row once the eval is done, as the record of that wait. */
export type EvalRateLimited = {
  index: number;
  id: string;
  model: string;
  /** This wait's attempt, of how many the runner allows. */
  attempt: number;
  of: number;
  /** What the runner waits (never past its own cap of six minutes in all). */
  wait_s: number;
  /** The door's own sentence. */
  text: string;
  limit: RateLimit;
};

export interface EvalProgress {
  done: number;
  total: number;
  passed: number;
  current: EvalCurrent | null;
  rate_limited: EvalRateLimited | null;
}

/** One candidate of a comparison, as the console's own runner summarised it. */
export type ModelSummary = {
  model: string;
  forced: boolean;
  tier: string | null;
  /** The eval run that measured it. */
  run_id: string;
  passed: number;
  total: number;
  pass_rate: number;
  headline_f1: number | null;
  macro_f1: number | null;
  invalid: number;
  avg_ms: number;
  tokens: { in: number; out: number };
  model_calls: number;
  /** null when a model's price is unknown: an unknown price makes the total unknown, never zero. */
  cost_total: number | null;
  cost_per_case: number | null;
};

/** A comparison's recommendation, on every candidate's row once all are done. */
export type EvalComparison = {
  batch_id: string;
  incumbent: string;
  models: ModelSummary[];
  /** The cheapest candidate that clears the incumbent's quality within 0.02 with no invalid outputs; null to keep the incumbent. */
  recommended: string | null;
  rationale: string;
  /** Every candidate's eval run, the incumbent's first. */
  runs: string[];
};

/** `GET /api/evals/runs/{id}` */
export interface EvalRunView {
  id: string;
  agent: string;
  set: string;
  set_name: string;
  /** The digest the cases ran: the version's, or a comparison candidate's pinned document's. */
  digest: string;
  version: number | null;
  /** The version evaluated: what a comparison's rows share. */
  version_digest: string;
  /** `default` for the deployment's default model. */
  model: string;
  /** Every model call pinned to `model` (a comparison's row): never the gate's eval nor the benchmark. */
  forced: boolean;
  /** Who started it, as the backend signs. */
  by: string;
  at: string;
  finished_at: string | null;
  state: EvalState;
  error: string;
  progress: EvalProgress;
  passed: number;
  total: number;
  /** The pass rate once done; null before. */
  score: number | null;
  /** The spec's own threshold when this is its own suite and the model is not forced; null otherwise. */
  threshold: number | null;
  /** score ≥ threshold, once done; null while running or with no threshold. */
  passed_threshold: boolean | null;
  dataset: boolean;
  /** The backend says so once the matrix is written, at the end; a labeled run reads false while it runs. */
  labeled: boolean;
  matrix: Matrix | null;
  metrics: Metrics | null;
  headline_f1: number | null;
  macro_f1: number | null;
  invalid: number;
  results: EvalCaseResult[];
  /** The console's summary fields: batch_id, forced, compare, tier, avg_ms, tokens, model_calls, cost_total, cost_per_case, incumbent; and set_name, dataset, version_digest, positive, progress. */
  summary: Record<string, unknown>;
  comparison: EvalComparison | null;
  status_url: string;
}

/** `GET /api/agents/{id}/benchmark`: what production runs, measured on its own suite. */
export interface Benchmark {
  score: number | null;
  passed: number;
  total: number;
  threshold: number | null;
  passed_threshold: boolean | null;
  model: string;
  set: string;
  digest: string;
  /** The eval measured exactly the digest production runs. False: the agent's latest eval of something else (nothing deployed yet, or a draft's). */
  matches_deployed: boolean;
  at: string;
  /** The eval run. */
  id: string;
  version: number | null;
  /** What production runs now, or null. */
  deployed: { version: number | null; digest: string } | null;
}

const checkOf = (v: unknown): EvalCheck => {
  const c = obj(v);
  return { kind: str(c.kind), ok: c.ok === true, note: str(c.note) };
};

export function caseResultOf(v: unknown): EvalCaseResult {
  const o = obj(v);
  return {
    id: str(o.id),
    note: str(o.note),
    passed: o.passed === true,
    state: str(o.state),
    error: str(o.error),
    checks: (Array.isArray(o.checks) ? o.checks : []).map(checkOf),
    expected: typeof o.expected === "string" ? o.expected : null,
    predicted: typeof o.predicted === "string" ? o.predicted : null,
    duration_ms: num(o.duration_ms),
    run_file: str(o.run_file),
    outcome: str(o.outcome),
  };
}

export function rateLimitedOf(v: unknown): EvalRateLimited | null {
  if (!isObj(v)) return null;
  const o = obj(v);
  const limit = obj(o.limit);
  // The figures are a 429's body's, under `limit`; the door's sentence is `text`.
  const rl = rateLimitOf(429, { ...limit, error: str(o.text) || str(limit.error) });
  if (!rl) return null;
  return { index: num(o.index), id: str(o.id), model: str(o.model), attempt: num(o.attempt), of: num(o.of), wait_s: num(o.wait_s, rl.retry_after_s), text: str(o.text), limit: rl };
}

export function progressOf(v: unknown): EvalProgress {
  const o = obj(v);
  const c = obj(o.current);
  return {
    done: num(o.done),
    total: num(o.total),
    passed: num(o.passed),
    current: isObj(o.current) ? { index: num(c.index), id: str(c.id), model: str(c.model), run: str(c.run) } : null,
    rate_limited: rateLimitedOf(o.rate_limited),
  };
}

export function matrixOf(v: unknown): Matrix | null {
  const o = obj(v);
  if (!Array.isArray(o.labels) || !Array.isArray(o.counts)) return null;
  return { labels: strs(o.labels), counts: o.counts.map((row) => (Array.isArray(row) ? row.map((x) => num(x)) : [])) };
}

export function modelSummaryOf(v: unknown): ModelSummary {
  const o = obj(v);
  const t = obj(o.tokens);
  return {
    model: str(o.model),
    forced: o.forced === true,
    tier: strOrNull(o.tier),
    run_id: str(o.run_id),
    passed: num(o.passed),
    total: num(o.total),
    pass_rate: num(o.pass_rate),
    headline_f1: numOrNull(o.headline_f1),
    macro_f1: numOrNull(o.macro_f1),
    invalid: num(o.invalid),
    avg_ms: num(o.avg_ms),
    tokens: { in: num(t.in), out: num(t.out) },
    model_calls: num(o.model_calls),
    cost_total: numOrNull(o.cost_total),
    cost_per_case: numOrNull(o.cost_per_case),
  };
}

export function comparisonOf(v: unknown): EvalComparison | null {
  if (!isObj(v)) return null;
  const o = obj(v);
  const models = (Array.isArray(o.models) ? o.models : []).map(modelSummaryOf).filter((m) => m.model);
  if (!models.length) return null;
  return { batch_id: str(o.batch_id), incumbent: str(o.incumbent) || models[0].model, models, recommended: strOrNull(o.recommended), rationale: str(o.rationale), runs: strs(o.runs) };
}

export function evalRunViewOf(v: unknown): EvalRunView {
  const o = obj(v);
  const state = EVAL_STATES.find((s) => s === o.state) ?? "failed";
  return {
    id: str(o.id),
    agent: str(o.agent),
    set: str(o.set),
    set_name: str(o.set_name),
    digest: str(o.digest),
    version: numOrNull(o.version),
    version_digest: str(o.version_digest) || str(o.digest),
    model: str(o.model) || "default",
    forced: o.forced === true,
    by: str(o.by),
    at: str(o.at),
    finished_at: strOrNull(o.finished_at),
    state,
    error: str(o.error),
    progress: progressOf(o.progress),
    passed: num(o.passed),
    total: num(o.total),
    score: numOrNull(o.score),
    threshold: numOrNull(o.threshold),
    passed_threshold: boolOrNull(o.passed_threshold),
    dataset: o.dataset === true,
    labeled: o.labeled === true,
    matrix: matrixOf(o.matrix),
    metrics: isObj(o.metrics) ? (obj(o.metrics) as unknown as Metrics) : null,
    headline_f1: numOrNull(o.headline_f1),
    macro_f1: numOrNull(o.macro_f1),
    invalid: num(o.invalid),
    results: (Array.isArray(o.results) ? o.results : []).map(caseResultOf),
    summary: obj(o.summary),
    comparison: comparisonOf(o.comparison),
    status_url: str(o.status_url),
  };
}

export function evalRunStartedOf(v: unknown): EvalRunStarted {
  const o = obj(v);
  const id = str(o.id);
  return {
    id,
    runs: strs(o.runs).length ? strs(o.runs) : id ? [id] : [],
    batch_id: str(o.batch_id) || id,
    agent: str(o.agent),
    set: str(o.set),
    digest: str(o.digest),
    version: numOrNull(o.version),
    total: num(o.total),
    dataset: o.dataset === true,
    threshold: numOrNull(o.threshold),
    models: strs(o.models),
    compare: o.compare === true,
    status_url: str(o.status_url),
  };
}

export function benchmarkOf(v: unknown): Benchmark {
  const o = obj(v);
  const d = obj(o.deployed);
  return {
    score: numOrNull(o.score),
    passed: num(o.passed),
    total: num(o.total),
    threshold: numOrNull(o.threshold),
    passed_threshold: boolOrNull(o.passed_threshold),
    model: str(o.model) || "default",
    set: str(o.set),
    digest: str(o.digest),
    matches_deployed: o.matches_deployed === true,
    at: str(o.at),
    id: str(o.id),
    version: numOrNull(o.version),
    deployed: isObj(o.deployed) ? { version: numOrNull(d.version), digest: str(d.digest) } : null,
  };
}

/* ═══════════════════ reviews ═══════════════════ */

export type Verdict = "approved" | "changes_requested";
export const VERDICTS: Verdict[] = ["approved", "changes_requested"];

/** One signed policy review of a digest. */
export interface Review {
  id: string;
  agent: string;
  digest: string;
  version: number | null;
  /** approved or changes_requested, or whatever a newer backend names. */
  verdict: string;
  note: string;
  /** The reviewer, as the backend signs. */
  by: string;
  at: string;
  /** Everyone who saved a version carrying the digest: none of them may review it. */
  authors: string[];
}

/** `GET /api/agents/{id}/reviews` */
export interface ReviewList {
  agent: string;
  /** Newest first. */
  reviews: Review[];
  count: number;
  /** The role a reviewer holds (`POLICY_REVIEWER_ROLE`, default `policy-reviewer`); an administrator passes. */
  role: string;
}

/** `POST /api/agents/{id}/reviews` */
export interface ReviewRequest {
  digest: string;
  verdict: Verdict;
  note?: string;
}

export function reviewOf(v: unknown): Review {
  const o = obj(v);
  return { id: str(o.id), agent: str(o.agent), digest: str(o.digest), version: numOrNull(o.version), verdict: str(o.verdict), note: str(o.note), by: str(o.by), at: str(o.at), authors: strs(o.authors) };
}

export function reviewListOf(v: unknown): ReviewList {
  const o = obj(v);
  const reviews = (Array.isArray(o.reviews) ? o.reviews : []).map(reviewOf).filter((r) => r.id);
  return { agent: str(o.agent), reviews, count: num(o.count, reviews.length), role: str(o.role) || "policy-reviewer" };
}

/* ═══════════════════ the promotion gate ═══════════════════ */

/** The four conditions a production deploy is held to, in the order the backend reads them. */
export type ConditionName = "eval" | "review" | "findings" | "regression";
export const CONDITION_NAMES: ConditionName[] = ["eval", "review", "findings", "regression"];

/** One condition as the gate read it for exactly the digest it was asked to deploy. */
export type Condition = {
  /** One of CONDITION_NAMES, or whatever a newer backend adds. */
  condition: string;
  met: boolean;
  detail: string;
  /** What was read: eval runs (eval, regression: this digest's and the predecessor's), reviews (review), findings `{kind, ref, detail}`. */
  items: Record<string, unknown>[];
  /** An administrator's override passed it. */
  overridden: boolean;
};

/** An unmet condition on a refusal. */
export type Unmet = {
  condition: string;
  detail: string;
  items: Record<string, unknown>[];
};

/** An override as recorded on the deployment and the decision. */
export type OverrideRecord = {
  reason: string;
  by: string;
  at: string;
  /** The conditions it passed. */
  passed: string[];
  /** What was unmet when it was given. */
  unmet: { condition: string; detail: string }[];
  /** The `deploy_override` audit event. */
  audit_id: number | null;
};

/** An administrator's override: it passes the conditions it names, every unmet one when it names none. */
export interface OverrideRequest {
  reason: string;
  conditions?: ConditionName[];
}

/** `POST /api/agents/{id}/deploy` */
export interface DeployRequest {
  version?: number;
  digest?: string;
  /** `production` (gated, changes what runs) by default; another environment is recorded and changes nothing production runs. */
  environment?: string;
  override?: OverrideRequest;
}

/** What `POST /api/agents` answers: the version saved, and whether it is a draft (the agent is deployed, so what runs did not move). */
export interface AgentSaved {
  saved: boolean;
  id: string;
  digest: string;
  version: number | null;
  store: string;
  /** This request deployed it (only with `deploy: true`, through the gate). */
  deployed: boolean;
  /** The agent's own deployment stamp (the version deployed before, for a draft), not this version's. */
  deployed_at: string | null;
  /** A save once the agent is deployed: a version row and nothing else; production keeps running what it ran until a deploy. */
  draft: boolean;
}

/** The gate's 409: the unmet conditions with their detail and items, every condition, and the decision recorded. */
export interface GateRefusal {
  error: string;
  unmet: Unmet[];
  conditions: Condition[];
  agent: string;
  version: number | null;
  digest: string;
  environment: string;
  /** The gate decision recorded for this refusal. */
  decision: string;
  /** `POST /api/agents` with `deploy: true` only: the version, saved as a draft before the gate refused it. */
  saved: AgentSaved | null;
}

export type DeployStep = {
  step: string;
  ms: number;
};

/** `POST /api/agents/{id}/deploy` (200) */
export interface Deployed {
  deployed: boolean;
  id: string;
  digest: string;
  version: number | null;
  store: string;
  at: string;
  /** validate, gate, register (no gate outside production). */
  steps: DeployStep[];
  environment: string;
  /** The deployment row. */
  deployment: string;
  /** The gate decision ("" outside production). */
  decision: string;
  conditions: Condition[];
  override: OverrideRecord | null;
}

export function conditionOf(v: unknown): Condition {
  const o = obj(v);
  return { condition: str(o.condition), met: o.met === true, detail: str(o.detail), items: objs(o.items), overridden: o.overridden === true };
}

export function unmetOf(v: unknown): Unmet {
  const o = obj(v);
  return { condition: str(o.condition), detail: str(o.detail), items: objs(o.items) };
}

export function overrideRecordOf(v: unknown): OverrideRecord | null {
  if (!isObj(v)) return null;
  const o = obj(v);
  return {
    reason: str(o.reason),
    by: str(o.by),
    at: str(o.at),
    passed: strs(o.passed),
    unmet: objs(o.unmet).map((u) => ({ condition: str(u.condition), detail: str(u.detail) })),
    audit_id: numOrNull(o.audit_id),
  };
}

export function agentSavedOf(v: unknown): AgentSaved {
  const o = obj(v);
  return { saved: o.saved === true, id: str(o.id), digest: str(o.digest), version: numOrNull(o.version), store: str(o.store), deployed: o.deployed === true, deployed_at: strOrNull(o.deployed_at), draft: o.draft === true };
}

export function gateRefusalBodyOf(v: unknown): GateRefusal {
  const o = obj(v);
  return {
    error: str(o.error),
    unmet: objs(o.unmet).map(unmetOf),
    conditions: objs(o.conditions).map(conditionOf),
    agent: str(o.agent),
    version: numOrNull(o.version),
    digest: str(o.digest),
    environment: str(o.environment) || "production",
    decision: str(o.decision),
    saved: isObj(o.saved) ? agentSavedOf(o.saved) : null,
  };
}

/** The gate's refusal a deploy (or a save with `deploy: true`) rejected with, or null for any other refusal. */
export function gateRefusalOf(e: unknown): GateRefusal | null {
  if (!(e instanceof DoorError) || e.status !== 409 || !Array.isArray(e.body.unmet)) return null;
  return gateRefusalBodyOf(e.body);
}

export function deployedOf(v: unknown): Deployed {
  const o = obj(v);
  return {
    deployed: o.deployed === true,
    id: str(o.id),
    digest: str(o.digest),
    version: numOrNull(o.version),
    store: str(o.store),
    at: str(o.at),
    steps: objs(o.steps).map((s) => ({ step: str(s.step), ms: num(s.ms) })),
    environment: str(o.environment) || "production",
    deployment: str(o.deployment),
    decision: str(o.decision),
    conditions: objs(o.conditions).map(conditionOf),
    override: overrideRecordOf(o.override),
  };
}

/* ═══════════════════ deployments, the spine ═══════════════════ */

/** What a deployment replaced: the version before it in that environment. `adopted` when that was a version deployed before L8 kept deployment rows. */
export type Previous = {
  version: number | null;
  digest: string;
  deployment: string;
  adopted: boolean;
};

/** One deployment row: a deploy or a rollback, to one environment. */
export interface Deployment {
  id: string;
  agent: string;
  environment: string;
  version: number | null;
  digest: string;
  /** deploy, or rollback, or whatever a newer backend names. */
  kind: string;
  by: string;
  at: string;
  /** A rollback's reason. */
  reason: string;
  override: OverrideRecord | null;
  /** The gate decision that let it through ("" for a rollback, or outside production). */
  decision: string;
  /** The eval it was measured by; "" for none. */
  eval_run: string;
  /** The review that approved it; "" for none. */
  review: string;
  previous: Previous | null;
  /** A rollback's flagged runs: every run of the version rolled back from since it was deployed. */
  flagged: string[];
  /** What this environment runs now. */
  current: boolean;
}

/** What production runs: its deployment, or (`adopted`) the highest version marked deployed before L8 kept rows. */
export type Running = {
  version: number | null;
  digest: string;
  deployment: Deployment | null;
  adopted: boolean;
};

/** `GET /api/agents/{id}/deployments` */
export interface DeploymentList {
  agent: string;
  /** Newest first, every environment. */
  deployments: Deployment[];
  count: number;
  /** What each environment runs now. */
  current: Record<string, Deployment>;
  /** Production deployed before L8 kept rows, or null. */
  adopted: Running | null;
}

export type StageName = "designed" | "reviewed" | "approved" | "canary" | "deployed" | "retired";
export const STAGE_NAMES: StageName[] = ["designed", "reviewed", "approved", "canary", "deployed", "retired"];

/** One stage of the spine, lit only by its own record. */
export interface Stage {
  /** One of STAGE_NAMES, or whatever a newer backend names. */
  stage: string;
  lit: boolean;
  at: string | null;
  by: string;
  digest: string;
  version: number | null;
  /** The record that lights it: a version row, an approving review, a gate decision that passed, a deployment row, the retirement. */
  record: Record<string, unknown> | null;
}

/** A retirement: who, why, and the agent that replaces it. */
export type Retired = {
  id: string;
  agent: string;
  reason: string;
  /** Another saved agent's id, or "". */
  replacement: string;
  by: string;
  at: string;
};

/** `GET /api/agents/{id}/lifecycle?digest=`: the spine of one digest, the latest version's unless one is named. */
export interface Lifecycle {
  agent: string;
  digest: string;
  version: number | null;
  /** The furthest stage lit (`retired` once retired). */
  current: string | null;
  stages: Stage[];
  /** What production runs now, whatever digest the spine is drawn for. */
  deployed: Running | null;
  retired: Retired | null;
}

export function previousOf(v: unknown): Previous | null {
  if (!isObj(v)) return null;
  const o = obj(v);
  return { version: numOrNull(o.version), digest: str(o.digest), deployment: str(o.deployment), adopted: o.adopted === true };
}

export function deploymentOf(v: unknown): Deployment {
  const o = obj(v);
  return {
    id: str(o.id),
    agent: str(o.agent),
    environment: str(o.environment) || "production",
    version: numOrNull(o.version),
    digest: str(o.digest),
    kind: str(o.kind) || "deploy",
    by: str(o.by),
    at: str(o.at),
    reason: str(o.reason),
    override: overrideRecordOf(o.override),
    decision: str(o.decision),
    eval_run: str(o.eval_run),
    review: str(o.review),
    previous: previousOf(o.previous),
    flagged: strs(o.flagged),
    current: o.current === true,
  };
}

export function runningOf(v: unknown): Running | null {
  if (!isObj(v)) return null;
  const o = obj(v);
  return { version: numOrNull(o.version), digest: str(o.digest), deployment: isObj(o.deployment) ? deploymentOf(o.deployment) : null, adopted: o.adopted === true };
}

export function deploymentListOf(v: unknown): DeploymentList {
  const o = obj(v);
  const deployments = objs(o.deployments).map(deploymentOf).filter((d) => d.id);
  const current: Record<string, Deployment> = {};
  for (const [env, d] of Object.entries(obj(o.current))) if (isObj(d)) current[env] = deploymentOf(d);
  return { agent: str(o.agent), deployments, count: num(o.count, deployments.length), current, adopted: runningOf(o.adopted) };
}

export function retiredOf(v: unknown): Retired | null {
  if (!isObj(v)) return null;
  const o = obj(v);
  if (!str(o.agent) && !str(o.reason)) return null;
  return { id: str(o.id), agent: str(o.agent), reason: str(o.reason), replacement: str(o.replacement), by: str(o.by), at: str(o.at) };
}

export function stageOf(v: unknown): Stage {
  const o = obj(v);
  return { stage: str(o.stage), lit: o.lit === true, at: strOrNull(o.at), by: str(o.by), digest: str(o.digest), version: numOrNull(o.version), record: isObj(o.record) ? obj(o.record) : null };
}

export function lifecycleOf(v: unknown): Lifecycle {
  const o = obj(v);
  return {
    agent: str(o.agent),
    digest: str(o.digest),
    version: numOrNull(o.version),
    current: strOrNull(o.current),
    stages: objs(o.stages).map(stageOf).filter((s) => s.stage),
    deployed: runningOf(o.deployed),
    retired: retiredOf(o.retired),
  };
}

/* ═══════════════════ rollback, retirement, versions ═══════════════════ */

/** `POST /api/agents/{id}/rollback` */
export interface RollbackRequest {
  /** A version that ran in production before. */
  to_version: number;
  reason: string;
}

export type VersionPoint = {
  version: number | null;
  digest: string;
};

/** `POST /api/agents/{id}/rollback` (200): what runs again, and every run of the version rolled back from, flagged for review. */
export interface RollbackResult {
  agent: string;
  environment: string;
  from: VersionPoint;
  to: VersionPoint;
  reason: string;
  by: string;
  at: string;
  /** Each carries `review: {flag: "rolled_back", from, to, reason, by, at}` on its record now. */
  flagged: string[];
  count: number;
  /** The new deployment row (kind rollback). */
  deployment: Deployment;
  audit_id: number | null;
}

/** `POST /api/agents/{id}/retire` */
export interface RetireRequest {
  reason: string;
  /** Another saved agent's id. */
  replacement?: string;
}

/** `POST /api/agents/{id}/retire` (201) */
export interface Retirement {
  /** The retirement row (`rt-…`), as `GET /api/agents/{id}/lifecycle` names it under `retired.id`; "" from a backend older than L8's second round. */
  id: string;
  agent: string;
  reason: string;
  replacement: string;
  by: string;
  at: string;
  /** Its queued jobs, cancelled with the reason (`cancel_reason`). */
  cancelled_jobs: string[];
  audit_id: number | null;
}

/** `GET /api/agents/{id}/versions/{version}`: one saved version with its document. */
export interface VersionDocument {
  id: string;
  version: number;
  digest: string;
  saved_by: string;
  saved_at: string;
  deployed: boolean;
  deployed_at: string | null;
  nodes: number;
  tools: string[];
  name: string;
  /** The document saved. */
  spec: Record<string, unknown>;
  /** What production runs now. */
  current: boolean;
}

const pointOf = (v: unknown): VersionPoint => {
  const o = obj(v);
  return { version: numOrNull(o.version), digest: str(o.digest) };
};

export function rollbackResultOf(v: unknown): RollbackResult {
  const o = obj(v);
  const flagged = strs(o.flagged);
  return {
    agent: str(o.agent),
    environment: str(o.environment) || "production",
    from: pointOf(o.from),
    to: pointOf(o.to),
    reason: str(o.reason),
    by: str(o.by),
    at: str(o.at),
    flagged,
    count: num(o.count, flagged.length),
    deployment: deploymentOf(o.deployment),
    audit_id: numOrNull(o.audit_id),
  };
}

export function retirementOf(v: unknown): Retirement {
  const o = obj(v);
  return { id: str(o.id), agent: str(o.agent), reason: str(o.reason), replacement: str(o.replacement), by: str(o.by), at: str(o.at), cancelled_jobs: strs(o.cancelled_jobs), audit_id: numOrNull(o.audit_id) };
}

export function versionDocumentOf(v: unknown): VersionDocument {
  const o = obj(v);
  return {
    id: str(o.id),
    version: num(o.version),
    digest: str(o.digest),
    saved_by: str(o.saved_by),
    saved_at: str(o.saved_at),
    deployed: o.deployed === true,
    deployed_at: strOrNull(o.deployed_at),
    nodes: num(o.nodes),
    tools: strs(o.tools),
    name: str(o.name),
    spec: obj(o.spec),
    current: o.current === true,
  };
}

/**
 * The retirement a refusal names: every door that would start work for a
 * retired agent (a run, a trigger, an eval, a deploy, a rollback, a second
 * retirement) answers 409 `{error, control: "retired", retired}`. Null for
 * any other refusal.
 */
export function retiredRefusalOf(e: unknown): Retired | null {
  if (!(e instanceof DoorError) || e.status !== 409 || e.control !== "retired") return null;
  return retiredOf(e.body.retired);
}

/* ═══════════════════ an agent, as L8 reads it ═══════════════════ */

/**
 * `GET /api/agents/{id}` since L8: the document that runs is `spec` (with
 * `spec_version`), the latest save is `version`/`digest`, production's
 * deployment is `deployed_version`/`deployed_digest`, and `retired` says
 * whether it takes new work.
 */
export interface AgentLifecycleDetail {
  id: string;
  name: string;
  description: string;
  /** What runs: the deployed version's document once the agent is deployed, else the latest save. */
  spec: Record<string, unknown>;
  /** The version whose document `spec` is; null for a document no version carries. */
  spec_version: number | null;
  /** The latest save. */
  version: number | null;
  digest: string;
  deployed_version: number | null;
  deployed_digest: string;
  deployed_at: string | null;
  updated_at: string | null;
  store: string;
  retired: Retired | null;
  /** An agent cut from a certified template (L8, second round): the template and the digest it was cut from; null for one made by hand. */
  lineage: { template: string; template_digest: string } | null;
}

export function agentDetailOf(v: unknown): AgentLifecycleDetail {
  const o = obj(v);
  return {
    id: str(o.id),
    name: str(o.name) || str(o.id),
    description: str(o.description),
    spec: obj(o.spec),
    spec_version: numOrNull(o.spec_version),
    version: numOrNull(o.version),
    digest: str(o.digest),
    deployed_version: numOrNull(o.deployed_version),
    deployed_digest: str(o.deployed_digest),
    deployed_at: strOrNull(o.deployed_at),
    updated_at: strOrNull(o.updated_at),
    store: str(o.store),
    retired: retiredOf(o.retired),
    lineage: isObj(o.lineage) && str(obj(o.lineage).template) ? { template: str(obj(o.lineage).template), template_digest: str(obj(o.lineage).template_digest) } : null,
  };
}

/** The document a person edits: the latest save (a draft newer than what runs), with what runs beside it. */
export interface EditableDocument {
  agent: AgentLifecycleDetail;
  spec: Record<string, unknown>;
  /** The version `spec` is: the latest save. */
  version: number | null;
  /** The latest save is a draft: production runs another version. */
  draft: boolean;
}

/* ═══════════════════ calls ═══════════════════ */

/** One request to an L8 door: what is sent, before it is sent. */
export interface DoorRequest {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
}

const agentAt = (agent: string) => `/api/agents/${enc(agent)}`;
const qs = (q: Record<string, string | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
};

/** The L8 doors' requests, by action. */
export const L8 = {
  startEval: (agent: string, body: EvalRequest = {}): DoorRequest => ({ method: "POST", path: `${agentAt(agent)}/evals/run`, body }),
  evalRun: (id: string): DoorRequest => ({ method: "GET", path: `/api/evals/runs/${enc(id)}` }),
  benchmark: (agent: string): DoorRequest => ({ method: "GET", path: `${agentAt(agent)}/benchmark` }),
  reviews: (agent: string, digest?: string): DoorRequest => ({ method: "GET", path: `${agentAt(agent)}/reviews${qs({ digest })}` }),
  review: (agent: string, body: ReviewRequest): DoorRequest => ({ method: "POST", path: `${agentAt(agent)}/reviews`, body }),
  deploy: (agent: string, body: DeployRequest = {}): DoorRequest => ({ method: "POST", path: `${agentAt(agent)}/deploy`, body }),
  save: (spec: Record<string, unknown>, opts: { deploy?: boolean; override?: OverrideRequest } = {}): DoorRequest => ({ method: "POST", path: "/api/agents", body: { spec, ...(opts.deploy ? { deploy: true } : {}), ...(opts.override ? { override: opts.override } : {}) } }),
  lifecycle: (agent: string, digest?: string): DoorRequest => ({ method: "GET", path: `${agentAt(agent)}/lifecycle${qs({ digest })}` }),
  deployments: (agent: string, environment?: string): DoorRequest => ({ method: "GET", path: `${agentAt(agent)}/deployments${qs({ environment })}` }),
  rollback: (agent: string, body: RollbackRequest): DoorRequest => ({ method: "POST", path: `${agentAt(agent)}/rollback`, body }),
  retire: (agent: string, body: RetireRequest): DoorRequest => ({ method: "POST", path: `${agentAt(agent)}/retire`, body }),
  version: (agent: string, version: number): DoorRequest => ({ method: "GET", path: `${agentAt(agent)}/versions/${enc(String(version))}` }),
  agent: (agent: string): DoorRequest => ({ method: "GET", path: agentAt(agent) }),
};

/**
 * One request. A refusal is a DoorError carrying the body: the unmet
 * conditions on a gate's 409 (gateRefusalOf), the retirement on a retired
 * 409 (retiredRefusalOf), the control on a 403 (`separation_of_duties`,
 * `override`), the role missing (`missing_role`), the field on a 400 or a
 * 404 (`digest`, `set`, `to_version`, `replacement`, `override.reason`). A
 * bare 404, 502 or 503 with no body of the backend's means no backend
 * answered the door.
 */
async function call<T>(req: DoorRequest, parse: (v: unknown) => T, signal?: AbortSignal): Promise<T> {
  const res = await fetch(req.path, {
    method: req.method,
    headers: req.body === undefined ? undefined : { "content-type": "application/json" },
    body: req.body === undefined ? undefined : JSON.stringify(req.body),
    cache: "no-store",
    credentials: "include",
    ...(signal ? { signal } : {}),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const page = typeof json !== "object" || json === null;
    let message = errorText(page ? (text.trimStart().startsWith("<") ? null : text) : json, res);
    if (/answered (404|502|503)/.test(message) && !obj(json).error) message = `${message}: this door is served by the backend; this deployment may not have named it (BACKEND_ORIGIN)`;
    throw new DoorError(message, res.status, obj(json));
  }
  return parse(json);
}

/** `POST /api/agents/{id}/evals/run` (run): 202 at once; follow it with followEval. 400/404 name the field (`set`, `digest`), 409 a set of another agent's or the agent paused or retired, 423 the lockdown, 402 the budget. */
export async function startEval(agent: string, body: EvalRequest = {}): Promise<EvalRunStarted> {
  return call(L8.startEval(agent, body), evalRunStartedOf);
}

/** `GET /api/evals/runs/{id}` (view): the graded cases so far and the progress while it runs; the score, the threshold and whether it was met once done. */
export async function getEvalRun(id: string): Promise<EvalRunView> {
  return call(L8.evalRun(id), evalRunViewOf);
}

/** An eval is over once every case is graded, or the runner stopped. */
export const isEvalOver = (v: Pick<EvalRunView, "state">): boolean => v.state === "done" || v.state === "failed";

/**
 * Follow evals until each is over: every row read in turn, then again after
 * `everyMs`, each view handed to `onView` as it arrives. A read that fails
 * is not the eval failing: it is tried again on the next round, and only
 * `misses` failures in a row for the same row end the follow (the error is
 * thrown). Resolves to the last view of each row, in the order asked.
 */
export async function followEval(
  ids: readonly string[],
  opts: { onView?: (v: EvalRunView) => void; everyMs?: number; misses?: number; sleep?: (ms: number) => Promise<void>; stopped?: () => boolean } = {},
): Promise<EvalRunView[]> {
  const every = opts.everyMs ?? 1000;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const limit = opts.misses ?? 5;
  const last = new Map<string, EvalRunView>();
  const missed = new Map<string, number>();
  for (;;) {
    for (const id of ids) {
      if (opts.stopped?.()) return ids.map((i) => last.get(i)).filter((v): v is EvalRunView => Boolean(v));
      const seen = last.get(id);
      if (seen && isEvalOver(seen)) continue;
      try {
        const v = await getEvalRun(id);
        missed.set(id, 0);
        last.set(id, v);
        opts.onView?.(v);
      } catch (e) {
        const n = (missed.get(id) ?? 0) + 1;
        missed.set(id, n);
        if (n >= limit) throw e;
      }
    }
    if (ids.every((id) => {
      const v = last.get(id);
      return v !== undefined && isEvalOver(v);
    })) return ids.map((id) => last.get(id)!);
    await sleep(every);
  }
}

/** `GET /api/agents/{id}/benchmark` (view): the latest eval of what production runs, on its own suite; null when none is on record (404). */
export async function getBenchmark(agent: string): Promise<Benchmark | null> {
  try {
    return await call(L8.benchmark(agent), benchmarkOf);
  } catch (e) {
    if (e instanceof DoorError && e.status === 404 && /no eval of/.test(e.message)) return null;
    throw e;
  }
}

/** `GET /api/agents/{id}/reviews?digest=` (view): newest first, and the role a reviewer holds. */
export async function listReviews(agent: string, digest?: string): Promise<ReviewList> {
  return call(L8.reviews(agent, digest), reviewListOf);
}

/** `POST /api/agents/{id}/reviews` (approve, and the reviewer role): 201. 403 `control: separation_of_duties` for an author, `missing_role` without the role; 404 `field: digest`. */
export async function submitReview(agent: string, body: ReviewRequest): Promise<Review> {
  return call(L8.review(agent, body), reviewOf);
}

/** `POST /api/agents/{id}/deploy` (deploy): 200, or 409 the gate's refusal (gateRefusalOf), 403 `control: override` for a non-administrator's override, 409 retired. */
export async function deploy(agent: string, body: DeployRequest = {}, opts: { signal?: AbortSignal } = {}): Promise<Deployed> {
  return call(L8.deploy(agent, body), deployedOf, opts.signal);
}

/** `POST /api/agents` (deploy): a save, never gated; a draft once the agent is deployed. With `deploy: true` the saved version goes through the gate, and a refusal carries `saved`. */
export async function saveAgent(spec: Record<string, unknown>, opts: { deploy?: boolean; override?: OverrideRequest; signal?: AbortSignal } = {}): Promise<AgentSaved> {
  return call(L8.save(spec, { deploy: opts.deploy, override: opts.override }), agentSavedOf, opts.signal);
}

/** `GET /api/agents/{id}/lifecycle?digest=` (view) */
export async function getLifecycle(agent: string, digest?: string): Promise<Lifecycle> {
  return call(L8.lifecycle(agent, digest), lifecycleOf);
}

/** `GET /api/agents/{id}/deployments?environment=` (view) */
export async function listDeployments(agent: string, environment?: string): Promise<DeploymentList> {
  return call(L8.deployments(agent, environment), deploymentListOf);
}

/** `POST /api/agents/{id}/rollback` (deploy): 200 with the flagged runs. 409 for a version that is what runs, one never deployed, nothing deployed, or a retired agent; 404 `field: to_version`; 400 `field: reason`. */
export async function rollback(agent: string, body: RollbackRequest): Promise<RollbackResult> {
  return call(L8.rollback(agent, body), rollbackResultOf);
}

/** `POST /api/agents/{id}/retire` (deploy): 201. 409 retired; 400/404 `field: replacement` (itself, or no such agent); 400 `field: reason`. */
export async function retire(agent: string, body: RetireRequest): Promise<Retirement> {
  return call(L8.retire(agent, body), retirementOf);
}

/** `GET /api/agents/{id}/versions/{version}` (view): a saved version and its document, a draft the builder edits or a version deployed before. */
export async function getVersionDocument(agent: string, version: number): Promise<VersionDocument> {
  return call(L8.version(agent, version), versionDocumentOf);
}

/** `GET /api/agents/{id}` (view): what runs, the latest save, production's deployment, the retirement. */
export async function getAgentDetail(agent: string): Promise<AgentLifecycleDetail> {
  return call(L8.agent(agent), agentDetailOf);
}

/**
 * The document to edit: `GET /api/agents/{id}` answers what runs; when the
 * latest save is not that (a draft, once the agent is deployed), its
 * document is `GET /api/agents/{id}/versions/{version}`.
 */
export async function editableDocument(agent: string): Promise<EditableDocument> {
  const detail = await getAgentDetail(agent);
  const latest = detail.version;
  if (latest !== null && detail.spec_version !== latest) {
    const doc = await getVersionDocument(agent, latest);
    return { agent: detail, spec: doc.spec, version: latest, draft: !doc.current };
  }
  return { agent: detail, spec: detail.spec, version: latest, draft: false };
}
