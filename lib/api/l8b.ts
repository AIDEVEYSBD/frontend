import { errorText, type Schemas } from "./client";
import { DoorError, type PauseInfo } from "./l5";
import { agentSavedOf, conditionOf, gateRefusalBodyOf, type AgentSaved, type Condition, type GateRefusal, type OverrideRequest, type VersionPoint } from "./l8";

/**
 * The L8 doors of the second round (backend/CONTRACT.md, "L8: lifecycle and
 * deliverables", "As built (backend, L8 second half)"): canary and shadow
 * beside production, templates and lineage, deliverables and registers, and
 * what the first round's capture found missing (the eval sets read through
 * the backend, the paused refusal's control).
 *
 * Every shape here was written against responses captured from the
 * backend's own app, driven in-process through its doors (the scratchpad
 * capture reuses backend/tests/l8b.py and the test_l8_canary.py,
 * test_l8_templates.py, test_l8_deliverables.py and test_l8_capture_gaps.py
 * fixtures without editing them); tests/l8b-contract.test.ts replays them
 * through the calls and mappings below with fetch stubbed. The calls are
 * plain fetches read by mapping functions, as lib/api/l8.ts does: a refusal
 * carries more than the generated ErrorBody types (the unmet conditions on a
 * canary's 409, the control on a 403 or a 409, the field and what a template
 * takes on a 400, why a file is not served), and every answer is read
 * defensively. Same-origin: proxy.ts forwards `/api/agents` (the canary, the
 * lineage, an agent's eval sets), `/api/templates`, `/api/deliverables`,
 * `/api/registers` and `/api/eval-sets` to the backend (lib/route-policy.ts
 * BACKEND_PREFIXES), behind the cookie.
 */

/* ═══════════════════ reading ═══════════════════ */

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : v === null || v === undefined ? d : String(v));
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const isObj = (v: unknown): boolean => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const objs = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isObj).map(obj) : []);
const counts = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(obj(v))) if (typeof n === "number" && Number.isFinite(n)) out[k] = n;
  return out;
};
const pointOf = (v: unknown): VersionPoint | null => (isObj(v) ? { version: numOrNull(obj(v).version), digest: str(obj(v).digest) } : null);
const enc = encodeURIComponent;

/* ═══════════════════ canary and shadow ═══════════════════ */

/** canary: a share of the agent's new starts runs the candidate instead; shadow: a share of production runs is mirrored by a candidate run on the same input, whose calls at or above write and calls that act outside are recorded (would_call), not made. */
export type CanaryMode = "canary" | "shadow";
export const CANARY_MODES: CanaryMode[] = ["canary", "shadow"];

/** `PUT /api/agents/{id}/canary` */
export interface CanaryRequest {
  /** A saved version other than the one production runs, held to production's deploy conditions (a shadow does not need the release threshold). */
  version: number;
  /** (0, 1]: of new starts (canary), or of production runs (shadow). */
  share: number;
  mode: CanaryMode;
  /** ISO 8601 in the future: the canary ends itself then. */
  until?: string | null;
}

/** A deploy condition as read for the candidate: `required` is false only for the release threshold (`eval`) of a shadow, which is read and shown. */
export type CanaryCondition = Condition & { required: boolean };

/** One shadow pair that disagreed: production's outcome beside the candidate's, each with its run. */
export interface CanaryExample {
  production_run: string;
  shadow_run: string;
  production: string;
  shadow: string;
  at: string | null;
}

/** One side of a canary: its runs, how many finished, their outcomes (a canary: `state:<final>`; a shadow: the compared field's value of a run that ended done, else `state:<final>`), and what they cost (null once any used a model with no price set). */
export interface CanaryArm {
  runs: number;
  finished: number;
  outcomes: Record<string, number>;
  /** Null once any of the arm's runs used a model with no price set; absent only in a view not read through `canaryViewOf`. */
  cost_usd?: number | null;
}

/** One call in a shadow pair: production's `tool.call`, or the shadow's `tool.call` (made) or `would_call` (recorded, not made). */
export interface CanaryCall {
  tool: string;
  args: Record<string, unknown>;
  made: boolean;
}

/** A shadow pair whose calls differ: each side's calls in order, and the calls (tool and arguments) only one side has. */
export interface CanaryCallPair {
  production_run: string;
  shadow_run: string;
  production: CanaryCall[];
  shadow: CanaryCall[];
  only_production: string[];
  only_shadow: string[];
}

/** Shadow only: the compared pairs' calls, tool and arguments in any order; the pairs that differ, newest first, at most ten. */
export interface CanaryCalls {
  compared: number;
  same: number;
  differ: number;
  rate: number | null;
  pairs: CanaryCallPair[];
}

/** Why a canary stopped standing: ended by a person, replaced by another, its until passed, promoted, or the agent retired. */
export interface CanaryEnded {
  at: string | null;
  by: string;
  reason: string;
}

/** Why a pair was skipped, not counted: the candidate would not start on the input, so there is no shadow run (`candidate_refused`); a shadow that failed on a placeholder, or whose compared field is one (`stand_in`); a shadow that ended where a run would wait for a person: an await node (`await`), a budget (`budget`), a call whose worker died (`interrupted`); either side stopped (`killed`). */
export type SkipWhy = "candidate_refused" | "stand_in" | "await" | "budget" | "interrupted" | "killed";

/** `GET /api/agents/{id}/canary`, and what PUT and DELETE answer. */
export interface CanaryView {
  id: string;
  agent: string;
  /** The candidate. */
  version: number | null;
  digest: string;
  share: number;
  mode: CanaryMode;
  until: string | null;
  by: string;
  at: string;
  /** It stands now: starts are diverted (canary) or mirrored (shadow). */
  active: boolean;
  ended: CanaryEnded | null;
  /** What production ran when it was configured. */
  production: VersionPoint | null;
  /** What production runs now. */
  production_now: VersionPoint | null;
  /** The candidate's `spec.evals.compare` field shadow pairs are compared on; null to compare the whole result. */
  field: string | null;
  /** The candidate's runs. */
  runs: number;
  /** Shadow only: pairs both finished and compared. */
  compared: number;
  disagreements: number;
  /** disagreements / compared; null before any pair. */
  rate: number | null;
  examples: CanaryExample[];
  /** Pairs with either side still in flight. */
  pending: number;
  skipped: number;
  skipped_why: Record<string, number>;
  arms: { candidate: CanaryArm; production: CanaryArm };
  /** Shadow only: how the compared pairs' calls compared; null for a canary. */
  calls: CanaryCalls | null;
  /** The deploy conditions as read for the candidate when it was configured. */
  conditions: CanaryCondition[];
  /** The decision recorded in the mode's environment. */
  decision: string;
  /** The deployment row (environment canary or shadow) that lights the spine's canary stage. */
  deployment: string;
  /**
   * Never sent by this backend, and never filled by `canaryViewOf`: ending a canary withdraws no queued job (runs already started go on to
   * their end). Kept optional so views captured from the earlier backend still type-check.
   */
  cancelled_jobs?: string[];
  released_jobs?: string[];
}

/** A condition with `required` as the backend says it; required when it does not say. */
export function canaryConditionOf(v: unknown): CanaryCondition {
  const o = obj(v);
  const c = conditionOf(o);
  return { ...c, required: typeof o.required === "boolean" ? o.required : true };
}

const armOf = (v: unknown): CanaryArm => {
  const o = obj(v);
  return { runs: num(o.runs), finished: num(o.finished), outcomes: counts(o.outcomes), cost_usd: numOrNull(o.cost_usd) };
};

const callOf = (v: unknown): CanaryCall => {
  const o = obj(v);
  return { tool: str(o.tool), args: obj(o.args), made: o.made === true };
};

const callsOf = (v: unknown): CanaryCalls | null => {
  if (!isObj(v)) return null;
  const o = obj(v);
  return {
    compared: num(o.compared),
    same: num(o.same),
    differ: num(o.differ),
    rate: numOrNull(o.rate),
    pairs: objs(o.pairs).map((p) => ({
      production_run: str(p.production_run),
      shadow_run: str(p.shadow_run),
      production: objs(p.production).map(callOf),
      shadow: objs(p.shadow).map(callOf),
      only_production: strs(p.only_production),
      only_shadow: strs(p.only_shadow),
    })),
  };
};

export function canaryViewOf(v: unknown): CanaryView {
  const o = obj(v);
  const ended = obj(o.ended);
  const arms = obj(o.arms);
  return {
    id: str(o.id),
    agent: str(o.agent),
    version: numOrNull(o.version),
    digest: str(o.digest),
    share: num(o.share),
    mode: o.mode === "shadow" ? "shadow" : "canary",
    until: strOrNull(o.until),
    by: str(o.by),
    at: str(o.at),
    active: o.active === true,
    ended: isObj(o.ended) ? { at: strOrNull(ended.at), by: str(ended.by), reason: str(ended.reason) } : null,
    production: pointOf(o.production),
    production_now: pointOf(o.production_now),
    field: strOrNull(o.field),
    runs: num(o.runs),
    compared: num(o.compared),
    disagreements: num(o.disagreements),
    rate: numOrNull(o.rate),
    examples: objs(o.examples).map((e) => ({ production_run: str(e.production_run), shadow_run: str(e.shadow_run), production: str(e.production), shadow: str(e.shadow), at: strOrNull(e.at) })),
    pending: num(o.pending),
    skipped: num(o.skipped),
    skipped_why: counts(o.skipped_why),
    arms: { candidate: armOf(arms.candidate), production: armOf(arms.production) },
    calls: callsOf(o.calls),
    conditions: objs(o.conditions).map(canaryConditionOf),
    decision: str(o.decision),
    deployment: str(o.deployment),
  };
}

/** The canary's 409: the deploy conditions refusing the candidate in the mode's environment (`canary` or `shadow`), every condition marked required or not. */
export type CanaryRefusal = Omit<GateRefusal, "conditions"> & { conditions: CanaryCondition[] };

/**
 * The gate's refusal a canary's PUT rejected with, or null for any other
 * refusal (a 409 naming `field: version`, for what production runs or for
 * nothing deployed, carries no `unmet`).
 */
export function canaryRefusalOf(e: unknown): CanaryRefusal | null {
  if (!(e instanceof DoorError) || e.status !== 409 || !Array.isArray(e.body.unmet)) return null;
  const base = gateRefusalBodyOf(e.body);
  return { ...base, environment: str(e.body.environment) || "canary", conditions: objs(e.body.conditions).map(canaryConditionOf) };
}

/* ═══════════════════ templates and lineage ═══════════════════ */

export type TemplateState = "pending" | "certified";

/** A template's certification: who signed it, when, with what note. */
export interface Certified {
  by: string;
  at: string | null;
  note: string;
}

/** One template: a saved version's document, pending until a certifier who is not its author signs it. */
export interface TemplateView {
  id: string;
  name: string;
  /** The agent and version it was made from. */
  agent: string;
  version: number | null;
  digest: string;
  /** pending, certified, or whatever a newer backend names. */
  state: string;
  by: string;
  at: string;
  /** Whoever made it and whoever saved a version carrying its digest: none of them may certify it. */
  authors: string[];
  certified: Certified | null;
  /** The params its `${param:name}` references take: name → the default (`${param:name|default}`), or null when a cut must give one. */
  params: Record<string, string | null>;
}

/** `GET /api/templates/{id}`: the template and its document. */
export interface TemplateDocument extends TemplateView {
  spec: Record<string, unknown>;
}

/** `GET /api/templates` */
export interface TemplateList {
  templates: TemplateView[];
  count: number;
  /** The role a certifier holds (`TEMPLATE_CERTIFIER_ROLE`, default `template-certifier`); an administrator passes. */
  role: string;
}

/** `POST /api/templates` */
export interface TemplateRequest {
  from_agent: string;
  version: number;
  name: string;
}

/** `POST /api/agents` cutting an agent from a certified template. */
export interface CutRequest {
  from_template: string;
  /** The new agent's id: lowercase letters, digits and dashes; never one that exists. */
  id: string;
  params?: Record<string, unknown>;
  deploy?: boolean;
  override?: OverrideRequest;
}

/** What an agent was cut from: the template and the digest. */
export interface LineageRef {
  template: string;
  template_digest: string;
}

/** `POST /api/agents` with `from_template`: the save, and the lineage recorded. */
export interface AgentCut extends AgentSaved {
  lineage: LineageRef | null;
}

/** The cut itself: the version and digest it saved, the params it filled, who and when. */
export interface CutFrom {
  version: number | null;
  digest: string;
  params: Record<string, unknown>;
  by: string;
  at: string;
}

/** `GET /api/agents/{id}/lineage` */
export interface Lineage {
  agent: string;
  template: TemplateView;
  template_digest: string;
  cut: CutFrom;
  /** The agent's latest version. */
  current: VersionPoint;
  deployed: VersionPoint | null;
  /** The drift has a non-empty summary. The params a cut fills are drift from the start; the id always differs and is not in the diff's vocabulary. */
  drifted: boolean;
  /** The agents door's own diff, from the template's document to the agent's latest version. */
  drift: Schemas["SpecDiff"] | null;
}

export function templateOf(v: unknown): TemplateView {
  const o = obj(v);
  const c = obj(o.certified);
  const params: Record<string, string | null> = {};
  for (const [k, d] of Object.entries(obj(o.params))) params[k] = d === null || d === undefined ? null : str(d);
  return {
    id: str(o.id),
    name: str(o.name) || str(o.id),
    agent: str(o.agent),
    version: numOrNull(o.version),
    digest: str(o.digest),
    state: str(o.state) || "pending",
    by: str(o.by),
    at: str(o.at),
    authors: strs(o.authors),
    certified: isObj(o.certified) ? { by: str(c.by), at: strOrNull(c.at), note: str(c.note) } : null,
    params,
  };
}

export function templateDocumentOf(v: unknown): TemplateDocument {
  return { ...templateOf(v), spec: obj(obj(v).spec) };
}

export function templateListOf(v: unknown): TemplateList {
  const o = obj(v);
  const templates = objs(o.templates).map(templateOf).filter((t) => t.id);
  return { templates, count: num(o.count, templates.length), role: str(o.role) || "template-certifier" };
}

export function lineageRefOf(v: unknown): LineageRef | null {
  if (!isObj(v)) return null;
  const o = obj(v);
  return str(o.template) ? { template: str(o.template), template_digest: str(o.template_digest) } : null;
}

export function agentCutOf(v: unknown): AgentCut {
  return { ...agentSavedOf(v), lineage: lineageRefOf(obj(v).lineage) };
}

export function lineageOf(v: unknown): Lineage {
  const o = obj(v);
  const cut = obj(o.cut);
  return {
    agent: str(o.agent),
    template: templateOf(o.template),
    template_digest: str(o.template_digest),
    cut: { version: numOrNull(cut.version), digest: str(cut.digest), params: obj(cut.params), by: str(cut.by), at: str(cut.at) },
    current: pointOf(o.current) ?? { version: null, digest: "" },
    deployed: pointOf(o.deployed),
    drifted: o.drifted === true,
    drift: isObj(o.drift) ? (obj(o.drift) as unknown as Schemas["SpecDiff"]) : null,
  };
}

/* ═══════════════════ deliverables and registers ═══════════════════ */

export type DeliverableState = "draft" | "reviewed" | "published" | "withdrawn";
export const DELIVERABLE_STATES: DeliverableState[] = ["draft", "reviewed", "published", "withdrawn"];
export type DeliverableKind = "report" | "contract" | "register";

/** A document a run wrote (`documents.write`, a `json` or `document` output), registered from its journal. */
export interface DeliverableSummary {
  id: string;
  run: string;
  agent: string;
  /** report, contract, register, or whatever a newer backend names. */
  kind: string;
  title: string;
  /** Where it was written: on this deployment's disk for the platform's own runs, on the reporter's host for an SDK's. */
  path: string;
  /** `sha256:…` as written. */
  digest: string;
  bytes: number | null;
  format: string;
  node: string;
  /** The tool or output that wrote it (`document.write`). */
  source: string;
  /** engine (a run here), worker, or sdk (an attached agent reported it). */
  origin: string;
  /** draft, reviewed, published, withdrawn. */
  state: string;
  at: string;
  updated_at: string;
  /** The in-process sub-run that wrote it, or "". */
  sub_run: string;
  /** The file door (`/api/deliverables/{id}/file`), or null when it is never served (a reported run's). */
  download: string | null;
}

/** One step of a deliverable's history, from the journal entry that made it. A move another run tried, or one backwards, is kept with `applied: false`. */
export interface HistoryStep {
  state: string;
  /** The journal entry. */
  entry: string;
  at: string | null;
  t: number | null;
  /** Who signed a review or a withdrawal. */
  by: string;
  note: string;
  /** The sink the review held, or that published it. */
  tool: string;
  /** The gate a review answered. */
  gate: string;
  /** Who reviewed it, on a publish. */
  reviewed_by: string;
  aborted: boolean;
  digest: string;
  source: string;
  origin: string;
  applied: boolean;
}

/** Whether the file is served, and why not: `missing` (no longer on disk), `reported` (an attached agent's run: never read here), `outside_outbox`, `digest` (changed since it was written). */
export interface DeliverableFile {
  available: boolean;
  why: string;
  /** The backend's sentence. */
  says: string;
}

/** `GET /api/deliverables/{id}` */
export interface DeliverableView extends DeliverableSummary {
  history: HistoryStep[];
  file: DeliverableFile;
}

/** `GET /api/deliverables?state=&agent=&run=` */
export interface DeliverableList {
  deliverables: DeliverableSummary[];
  count: number;
  /** State → count over the list answered. */
  states: Record<string, number>;
  /** What the platform names as not built for this answer (`producer`: nothing produces deliverables yet, so an empty list says so). */
  not_built: string[];
}

export interface DeliverableFilter {
  state?: string;
  agent?: string;
  run?: string;
  limit?: number;
}

/** One register a records backend wrote to. */
export interface RegisterSummary {
  name: string;
  items: number;
  states: Record<string, number>;
  backends: string[];
  agents: string[];
  latest: string | null;
}

/** `GET /api/registers` */
export interface RegisterList {
  registers: RegisterSummary[];
  count: number;
}

/** One write of a register item: which run wrote it, with what digest. */
export interface RegisterStep {
  state: string;
  entry: string;
  at: string | null;
  t: number | null;
  run: string;
  digest: string;
  origin: string;
}

/** A register item: keyed `<register>/<backend>/<row id or digest>`; the same row written again is a step in its history (its run and digest the latest). */
export interface RegisterItem {
  id: string;
  register: string;
  backend: string;
  item: string;
  digest: string;
  run: string;
  agent: string;
  origin: string;
  state: string;
  at: string;
  updated_at: string;
  history: RegisterStep[];
}

/** `GET /api/registers/{name}/items?state=&agent=` */
export interface RegisterItems {
  register: string;
  items: RegisterItem[];
  count: number;
  states: Record<string, number>;
}

export function deliverableOf(v: unknown): DeliverableSummary {
  const o = obj(v);
  return {
    id: str(o.id),
    run: str(o.run),
    agent: str(o.agent),
    kind: str(o.kind) || "report",
    title: str(o.title) || str(o.id),
    path: str(o.path),
    digest: str(o.digest),
    bytes: numOrNull(o.bytes),
    format: str(o.format),
    node: str(o.node),
    source: str(o.source),
    origin: str(o.origin) || "engine",
    state: str(o.state) || "draft",
    at: str(o.at),
    updated_at: str(o.updated_at) || str(o.at),
    sub_run: str(o.sub_run),
    download: strOrNull(o.download),
  };
}

export function historyStepOf(v: unknown): HistoryStep {
  const o = obj(v);
  return {
    state: str(o.state),
    entry: str(o.entry),
    at: strOrNull(o.at),
    t: numOrNull(o.t),
    by: str(o.by),
    note: str(o.note),
    tool: str(o.tool),
    gate: str(o.gate),
    reviewed_by: str(o.reviewed_by),
    aborted: o.aborted === true,
    digest: str(o.digest),
    source: str(o.source),
    origin: str(o.origin),
    applied: o.applied !== false,
  };
}

export function deliverableViewOf(v: unknown): DeliverableView {
  const o = obj(v);
  const f = obj(o.file);
  return {
    ...deliverableOf(o),
    history: objs(o.history).map(historyStepOf),
    file: { available: f.available === true, why: str(f.why), says: str(f.says) },
  };
}

export function deliverableListOf(v: unknown): DeliverableList {
  const o = obj(v);
  const deliverables = objs(o.deliverables).map(deliverableOf).filter((d) => d.id);
  return { deliverables, count: num(o.count, deliverables.length), states: counts(o.states), not_built: strs(o.not_built) };
}

export function registerListOf(v: unknown): RegisterList {
  const o = obj(v);
  const registers = objs(o.registers).map((r) => ({ name: str(r.name), items: num(r.items), states: counts(r.states), backends: strs(r.backends), agents: strs(r.agents), latest: strOrNull(r.latest) })).filter((r) => r.name);
  return { registers, count: num(o.count, registers.length) };
}

export function registerItemOf(v: unknown): RegisterItem {
  const o = obj(v);
  return {
    id: str(o.id),
    register: str(o.register),
    backend: str(o.backend),
    item: str(o.item),
    digest: str(o.digest),
    run: str(o.run),
    agent: str(o.agent),
    origin: str(o.origin) || "engine",
    state: str(o.state) || "draft",
    at: str(o.at),
    updated_at: str(o.updated_at) || str(o.at),
    history: objs(o.history).map((h) => ({ state: str(h.state), entry: str(h.entry), at: strOrNull(h.at), t: numOrNull(h.t), run: str(h.run), digest: str(h.digest), origin: str(h.origin) })),
  };
}

export function registerItemsOf(v: unknown): RegisterItems {
  const o = obj(v);
  const items = objs(o.items).map(registerItemOf).filter((i) => i.id);
  return { register: str(o.register), items, count: num(o.count, items.length), states: counts(o.states) };
}

/** A deliverable the report gate names: lib/api/l5.ts reads it onto the gate (`Gate.deliverables`). */
export type { GateDeliverable } from "./l5";
export { gateDeliverableOf } from "./l5";

/* ═══════════════════ eval sets, as the backend reads them ═══════════════════ */

/** One eval set: from the shared `eval_sets` table (`db`), else `workspace/evals/<id>.json` (`file`), as the eval runner reads it. */
export interface EvalSetSummary {
  id: string;
  agent: string;
  name: string;
  /** The set's own model; "" for the deployment's default. */
  model: string;
  /** A labeled set's label space, positive class and reducer; null when not labeled. */
  labels: Record<string, unknown> | null;
  /** Cases. */
  count: number;
  updated_at: string | null;
  source: string;
  /** The spec names it as its own suite (`evals.dataset`): its threshold gates a deploy. */
  suite: boolean;
}

/** `GET /api/agents/{id}/eval-sets` */
export interface EvalSetList {
  agent: string;
  sets: EvalSetSummary[];
  count: number;
  /** The set the spec names as its suite, or null. */
  suite: string | null;
}

/** `GET /api/eval-sets/{id}`: the set with its cases. */
export interface EvalSetDocument extends EvalSetSummary {
  cases: Record<string, unknown>[];
}

export function evalSetSummaryOf(v: unknown): EvalSetSummary {
  const o = obj(v);
  return {
    id: str(o.id),
    agent: str(o.agent),
    name: str(o.name) || str(o.id),
    model: str(o.model),
    labels: isObj(o.labels) ? obj(o.labels) : null,
    count: num(o.count),
    updated_at: strOrNull(o.updated_at),
    source: str(o.source) || "db",
    suite: o.suite === true,
  };
}

export function evalSetListOf(v: unknown): EvalSetList {
  const o = obj(v);
  const sets = objs(o.sets).map(evalSetSummaryOf).filter((s) => s.id);
  return { agent: str(o.agent), sets, count: num(o.count, sets.length), suite: strOrNull(o.suite) };
}

export function evalSetDocumentOf(v: unknown): EvalSetDocument {
  const o = obj(v);
  return { ...evalSetSummaryOf(o), cases: objs(o.cases) };
}

/* ═══════════════════ the paused refusal ═══════════════════ */

/**
 * A paused agent's 409 (the runs, trigger and webhook doors): `{error,
 * control: "paused", paused: {mode, reason, by, at}}`. The pause as it
 * stands, or null when the answer is not that refusal.
 */
export function pausedRefusalOf(status: number, body: unknown): PauseInfo | null {
  if (status !== 409) return null;
  const o = obj(body);
  if (o.control !== "paused" && !isObj(o.paused)) return null;
  const p = obj(o.paused);
  return { mode: p.mode === "drain" ? "drain" : "pause", reason: str(p.reason), by: str(p.by), at: str(p.at) };
}

/* ═══════════════════ calls ═══════════════════ */

/** One request to an L8 door of the second round: what is sent, before it is sent. */
export interface DoorRequest {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
}

const agentAt = (agent: string) => `/api/agents/${enc(agent)}`;
const qs = (q: Record<string, string | number | undefined>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
};

/** The second round's requests, by action. */
export const L8B = {
  canary: (agent: string, id?: string): DoorRequest => ({ method: "GET", path: `${agentAt(agent)}/canary${qs({ id })}` }),
  putCanary: (agent: string, body: CanaryRequest): DoorRequest => ({ method: "PUT", path: `${agentAt(agent)}/canary`, body }),
  endCanary: (agent: string): DoorRequest => ({ method: "DELETE", path: `${agentAt(agent)}/canary` }),
  templates: (q: { state?: string; agent?: string } = {}): DoorRequest => ({ method: "GET", path: `/api/templates${qs(q)}` }),
  template: (id: string): DoorRequest => ({ method: "GET", path: `/api/templates/${enc(id)}` }),
  makeTemplate: (body: TemplateRequest): DoorRequest => ({ method: "POST", path: "/api/templates", body }),
  certify: (id: string, note?: string): DoorRequest => ({ method: "POST", path: `/api/templates/${enc(id)}/certify`, body: note ? { note } : {} }),
  cut: (body: CutRequest): DoorRequest => ({ method: "POST", path: "/api/agents", body }),
  lineage: (agent: string): DoorRequest => ({ method: "GET", path: `${agentAt(agent)}/lineage` }),
  deliverables: (f: DeliverableFilter = {}): DoorRequest => ({ method: "GET", path: `/api/deliverables${qs({ state: f.state, agent: f.agent, run: f.run, limit: f.limit })}` }),
  deliverable: (id: string): DoorRequest => ({ method: "GET", path: `/api/deliverables/${enc(id)}` }),
  registers: (): DoorRequest => ({ method: "GET", path: "/api/registers" }),
  registerItems: (name: string, q: { state?: string; agent?: string } = {}): DoorRequest => ({ method: "GET", path: `/api/registers/${enc(name)}/items${qs(q)}` }),
  evalSets: (agent: string): DoorRequest => ({ method: "GET", path: `${agentAt(agent)}/eval-sets` }),
  evalSet: (id: string): DoorRequest => ({ method: "GET", path: `/api/eval-sets/${enc(id)}` }),
};

/** Where a deliverable's file is served: the backend's `download` when it names one, never for a reported run's. */
export const deliverableFileUrl = (id: string) => `/api/deliverables/${enc(id)}/file`;

/**
 * One request. A refusal is a DoorError carrying the body: the unmet
 * conditions on a canary's 409 (canaryRefusalOf), the control on a 403
 * (`separation_of_duties`) or a 409 (`template_certification`, `paused`,
 * `retired`), the role missing (`missing_role`), the field on a 400, 404 or
 * 409 (`version`, `share`, `mode`, `until`, `params.<name>`, `params` with
 * `missing` and `takes`, `id`, `from_template`, `state`, `name`), why a file
 * is not served (`why`). A bare 404, 502 or 503 with no body of the
 * backend's means no backend answered the door.
 */
async function call<T>(req: DoorRequest, parse: (v: unknown) => T): Promise<T> {
  const res = await fetch(req.path, {
    method: req.method,
    headers: req.body === undefined ? undefined : { "content-type": "application/json" },
    body: req.body === undefined ? undefined : JSON.stringify(req.body),
    cache: "no-store",
    credentials: "include",
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) throw refusalOf(res, text, json, req.method, req.path);
  return parse(json);
}

function refusalOf(res: Response, text: string, json: unknown, method?: string, path?: string): DoorError {
  const page = typeof json !== "object" || json === null;
  const message = errorText(page ? (text.trimStart().startsWith("<") ? null : text) : json, res, method, path);
  return new DoorError(message, res.status, obj(json));
}

/** A 404 the door answers for "nothing of that kind on record" (as opposed to no backend at all). */
const noneOnRecord = (e: unknown, pattern: RegExp): boolean => e instanceof DoorError && e.status === 404 && pattern.test(e.message);

/** `GET /api/agents/{id}/canary?id=` (view): the latest canary, or one by id; null when none was ever configured (404). */
export async function getCanary(agent: string, id?: string): Promise<CanaryView | null> {
  try {
    return await call(L8B.canary(agent, id), canaryViewOf);
  } catch (e) {
    if (noneOnRecord(e, /no canary/)) return null;
    throw e;
  }
}

/**
 * `PUT /api/agents/{id}/canary` (deploy): 200, the canary standing (a PUT
 * replaces the one standing). 409 the deploy conditions' refusal for the
 * candidate (canaryRefusalOf), or `field: version` for what production runs
 * and for an agent with nothing deployed; 404 `field: version`; 400 `field:
 * share | mode | until`; 409 retired.
 */
export async function putCanary(agent: string, body: CanaryRequest): Promise<CanaryView> {
  return call(L8B.putCanary(agent, body), canaryViewOf);
}

/** `DELETE /api/agents/{id}/canary` (deploy): the canary ended (runs already started go on to their end); 404 when none stands. */
export async function endCanary(agent: string): Promise<CanaryView> {
  return call(L8B.endCanary(agent), canaryViewOf);
}

/** `GET /api/templates?state=&agent=` (view): newest first, with the certifier's role. */
export async function listTemplates(q: { state?: string; agent?: string } = {}): Promise<TemplateList> {
  return call(L8B.templates(q), templateListOf);
}

/** `GET /api/templates/{id}` (view): the template with its document and the params it takes. */
export async function getTemplate(id: string): Promise<TemplateDocument> {
  return call(L8B.template(id), templateDocumentOf);
}

/** `POST /api/templates` (deploy): 201, pending. 404 `field: from_agent | version`. */
export async function makeTemplate(body: TemplateRequest): Promise<TemplateView> {
  return call(L8B.makeTemplate(body), templateOf);
}

/** `POST /api/templates/{id}/certify` (approve, and the certifier role): 200. 403 `control: separation_of_duties` naming the authors, 403 `missing_role`; 409 `state` once certified. */
export async function certifyTemplate(id: string, note?: string): Promise<TemplateView> {
  return call(L8B.certify(id, note), templateOf);
}

/** `POST /api/agents` with `{from_template, id, params}` (deploy): the new agent's version 1, with its lineage. 409 `control: template_certification` for a pending template, `field: id` for one that exists; 400 `field: params.<name>` (with `takes`), `field: params` (with `missing` and `takes`), `field: id`; 404 `field: from_template`. */
export async function cutAgent(body: CutRequest): Promise<AgentCut> {
  return call(L8B.cut(body), agentCutOf);
}

/** `GET /api/agents/{id}/lineage` (view): the template, the cut and the drift since; null for an agent made by hand (404). */
export async function getLineage(agent: string): Promise<Lineage | null> {
  try {
    return await call(L8B.lineage(agent), lineageOf);
  } catch (e) {
    if (noneOnRecord(e, /not cut from a template/)) return null;
    throw e;
  }
}

/** `GET /api/deliverables?state=&agent=&run=&limit=` (view). 400 `field: state`. */
export async function listDeliverables(f: DeliverableFilter = {}): Promise<DeliverableList> {
  return call(L8B.deliverables(f), deliverableListOf);
}

/** `GET /api/deliverables/{id}` (view): with its history and whether its file is served. */
export async function getDeliverable(id: string): Promise<DeliverableView> {
  return call(L8B.deliverable(id), deliverableViewOf);
}

/** A deliverable's file as served: the bytes, the name it is saved under, and the digest and state the door vouches for. */
export interface DeliverableFileBody {
  blob: Blob;
  filename: string;
  contentType: string;
  digest: string;
  state: string;
}

/**
 * `GET /api/deliverables/{id}/file` (view): the file, only while it is on
 * disk, inside the outbox and still carrying the digest it was written with.
 * A refusal is a DoorError whose body names `why`: 404 `missing`, 409
 * `reported`, `outside_outbox` or `digest` (with `found`).
 */
export async function downloadDeliverable(id: string, path?: string): Promise<DeliverableFileBody> {
  const res = await fetch(path || deliverableFileUrl(id), { method: "GET", cache: "no-store", credentials: "include" });
  if (!res.ok) {
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    throw refusalOf(res, text, json);
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const named = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1] ?? "";
  return {
    blob: await res.blob(),
    filename: named ? decodeURIComponent(named) : `${id}`,
    contentType: res.headers.get("content-type") ?? "",
    digest: res.headers.get("x-deliverable-digest") ?? "",
    state: res.headers.get("x-deliverable-state") ?? "",
  };
}

/** `GET /api/registers` (view): every register a records backend wrote to. */
export async function listRegisters(): Promise<RegisterList> {
  return call(L8B.registers(), registerListOf);
}

/** `GET /api/registers/{name}/items?state=&agent=` (view): newest first. 404 for no such register, 400 `field: name`. */
export async function listRegisterItems(name: string, q: { state?: string; agent?: string } = {}): Promise<RegisterItems> {
  return call(L8B.registerItems(name, q), registerItemsOf);
}

/** `GET /api/agents/{id}/eval-sets` (view): the agent's sets as the eval runner reads them, and the one its spec names as its suite. 404 for no such agent. */
export async function listAgentEvalSets(agent: string): Promise<EvalSetList> {
  return call(L8B.evalSets(agent), evalSetListOf);
}

/** `GET /api/eval-sets/{id}` (view): one set with its cases. 404 for none; 403 for a key scoped to another agent. */
export async function getEvalSet(id: string): Promise<EvalSetDocument> {
  return call(L8B.evalSet(id), evalSetDocumentOf);
}

/**
 * Every agent's eval sets, read agent by agent (the backend has no door that
 * lists them all). An agent the door no longer knows (404) has none; any
 * other refusal is the whole read's.
 */
export async function listEvalSets(agents: readonly string[]): Promise<EvalSetSummary[]> {
  const lists = await Promise.all(
    agents.map((a) =>
      listAgentEvalSets(a).catch((e) => {
        if (e instanceof DoorError && e.status === 404 && /no saved agent/.test(e.message)) return null;
        throw e;
      }),
    ),
  );
  const seen = new Set<string>();
  const out: EvalSetSummary[] = [];
  for (const l of lists) {
    for (const s of l?.sets ?? []) {
      if (seen.has(s.id)) continue;
      seen.add(s.id);
      out.push(s);
    }
  }
  return out;
}
