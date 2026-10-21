import { errorText, type RunRow } from "./client";

/**
 * The L5 doors (backend/CONTRACT.md, "L5: gates as interfaces, and operating
 * the estate"), called by hand.
 *
 * These doors are not in backend/openapi.json yet, so lib/api/backend.d.ts
 * does not know them and every call here is a plain fetch against the same
 * origin (proxy.ts forwards the prefixes in lib/route-policy.ts
 * BACKEND_PREFIXES to the backend). The types are the contract's, written
 * out. Once the backend lands the doors, run `npm run gen:api` and switch
 * each call below to `api.GET(...)`/`api.POST(...)` on the generated paths,
 * as lib/api/l4.ts does; the console-side shapes (Gate, AttentionItem and
 * so on) and the mapping functions can stay.
 */

/* ═══════════════════ gates as interfaces ═══════════════════ */

/** The three answer shapes a gate's interface may declare. */
export type Shape = "decision" | "form" | "verdicts";

/** The field kinds a `form` gate may ask for. */
export type FieldKind = "string" | "number" | "bool" | "choice" | "list" | "object";
export const FIELD_KINDS: FieldKind[] = ["string", "number", "bool", "choice", "list", "object"];

export interface GateField {
  name: string;
  kind: FieldKind;
  required?: boolean;
  /** For `choice`: the values the field may take. */
  choices?: string[];
  /** Shown instead of the name when the spec gives one. */
  label?: string;
  hint?: string;
}

/**
 * One item of the register a `verdicts` gate rules on. The run emitted the
 * list under `register`; the backend lays each item out with its current
 * verdict (null until one is recorded) and whatever fields the item carries,
 * which the table shows as evidence.
 */
export interface VerdictItem {
  id: string;
  title: string;
  verdict: string | null;
  fields: Record<string, unknown>;
}

/** One step the chain has already walked: who held the gate, who it went to, when. */
export interface Escalation {
  at: string;
  from: string[];
  to: string[];
  reason: string;
}

/** The evidence the backend lays out for a reviewer. */
export interface Evidence {
  /** Scalars the run decided (disposition, score, hashes). */
  decided: Record<string, unknown>;
  /** What the gate was shown, as the spec presents it. */
  presented: Record<string, unknown>;
  /** Entries whose content came from outside the firm. */
  tainted_by: string[];
}

/**
 * A gate as the inbox shows it: the backend's `GET /api/approvals` row,
 * normalised. Every field the console reads is present; what the backend
 * omits is defaulted here, never left undefined for the form to trip on.
 */
export interface Gate {
  run: string;
  agent: string;
  node: string;
  kind: string;
  asks: string;
  source: string;
  shape: Shape;
  fields: GateField[];
  items: VerdictItem[];
  verdicts: string[];
  transitions: Record<string, string[]>;
  register: string;
  /** Roles, never names. */
  approvers: string[];
  /** The roles an unanswered gate walks to, in order. */
  chain: string[];
  /** Absolute; null when the gate has no deadline. */
  deadline: string | null;
  escalations: Escalation[];
  external: { allowed: boolean };
  evidence: Evidence;
  timeout_s: number | null;
  on_timeout: string;
  waiting_since: string;
  /** Kept for the assistant and older readers; the same scalars as evidence.decided. */
  decided: Record<string, unknown>;
  job: { id: string; external_id: string | null; source: string } | null;
  warning: string;
}

/** What `GET /api/approvals` answers. */
export interface Inbox {
  count: number;
  pending: Gate[];
}

/** The answer a gate takes, by shape. */
export type DecisionAnswer = { approved: boolean };
export type FormAnswer = Record<string, unknown>;
/** Item id → verdict. */
export type VerdictsAnswer = { verdicts: Record<string, string> };
export type Answer = DecisionAnswer | FormAnswer | VerdictsAnswer;

/** One run's outcome, from the single door or one row of the batch. */
export interface AnswerResult {
  run: string;
  ok: boolean;
  /** The run's state after the answer: running, done, failed, closed. */
  state: string;
  continuing: boolean;
  delivered: string;
  error: string;
}

export interface BatchResult {
  answered: number;
  of: number;
  remaining: number;
  by: string;
  results: AnswerResult[];
}

/** `POST /api/approvals/{run}/links` */
export interface MintedLink {
  url: string;
  /** When the token stops working; at most the gate's deadline. */
  expires_at: string | null;
  email: string;
}

/** What the external answer page is given for a token. */
export interface ExternalGate {
  gate: Gate;
  /** The identity the answer is written under: `external:<email>`. */
  answered_as: string;
  expires_at: string | null;
  /** The token was already used; the page shows that instead of a form. */
  spent: boolean;
}

/* ═══════════════════ operating the estate ═══════════════════ */

export type AttentionKind = "gate" | "refusal" | "budget" | "dead_letter" | "health";
export type AttentionActionKind = "answer" | "replay" | "acknowledge" | "open";

export interface AttentionAction {
  kind: AttentionActionKind;
  /** A page to open (`open`), when the backend names one. */
  href?: string;
  /** A door to call (`replay`, `acknowledge`), when the backend names one; POST unless `method` says otherwise. */
  path?: string;
  method?: "POST" | "DELETE";
  label?: string;
}

/** What makes a row urgent beyond its age: the sinks a gate holds, their risk. */
export interface BlastRadius {
  sinks: number;
  risk: string;
  agents: number;
}

/** One row of `GET /api/attention`. */
export interface AttentionItem {
  id: string;
  kind: AttentionKind;
  title: string;
  detail: string;
  agent: string;
  run: string | null;
  job: string | null;
  /** 1 (low) to 5 (critical). */
  severity: number;
  /** When it arose. */
  since: string;
  age_s: number;
  /** severity × age, as the backend ranks it. */
  rank: number;
  blast_radius: BlastRadius | null;
  deadline: string | null;
  action: AttentionAction;
}

export type SteerRequest = { guidance?: string; hold_at_next_gate?: boolean; model?: string };

export interface SteerResult {
  run: string;
  applied: SteerRequest;
  by: string;
  at: string;
}

export type FleetAction = "pause" | "resume" | "drain" | "kill";
export const FLEET_ACTIONS: { id: FleetAction; label: string; verb: string; tone: "ink" | "warn" | "err"; what: string }[] = [
  { id: "pause", label: "Pause", verb: "Paused", tone: "warn", what: "stops new starts and queue claims for these agents; runs already in flight keep going" },
  { id: "resume", label: "Resume", verb: "Resumed", tone: "ink", what: "lifts a pause or a drain; starts and claims are accepted again" },
  { id: "drain", label: "Drain", verb: "Draining", tone: "warn", what: "pauses these agents and lets every run in flight finish; nothing new starts" },
  { id: "kill", label: "Kill", verb: "Killed", tone: "err", what: "cancels every run in flight for these agents before its next model or tool call, and pauses them" },
];

export interface FleetResult {
  action: FleetAction;
  agents: string[];
  /** Runs the action touched (killed, drained); 0 for a pause with nothing in flight. */
  affected: number;
  /** The audit event's id. */
  audit: string;
}

export interface LockdownState {
  on: boolean;
  reason: string;
  by: string;
  at: string | null;
  /** The controls the lockdown names in its audit event. */
  controls: string[];
}

/** `GET /api/runs` rows gain `stuck` and `waiting_on` in L5. */
export type RunRowL5 = RunRow & { stuck?: boolean; waiting_on?: string | null };

/** What `GET /api/models` offers for the next step. */
export interface OfferedModel {
  id: string;
  label: string;
}

/* ═══════════════════ mapping ═══════════════════ */

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : v === null || v === undefined ? d : String(v));
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function shapeOf(v: unknown): Shape {
  return v === "form" || v === "verdicts" ? v : "decision";
}

export function fieldOf(v: unknown): GateField | null {
  const f = obj(v);
  const name = str(f.name);
  if (!name) return null;
  const kind = FIELD_KINDS.includes(f.kind as FieldKind) ? (f.kind as FieldKind) : "string";
  return {
    name,
    kind,
    required: Boolean(f.required),
    choices: kind === "choice" ? strs(f.choices) : undefined,
    label: str(f.label) || undefined,
    hint: str(f.hint) || undefined,
  };
}

/**
 * An item of the register, from whatever the run emitted: an object with an
 * id (or ref, or key) and fields, or a bare string. The index is the id of
 * last resort, so a verdict always has something to attach to.
 */
export function itemOf(v: unknown, i: number): VerdictItem {
  if (typeof v === "string") return { id: v, title: v, verdict: null, fields: {} };
  const o = obj(v);
  const id = str(o.id) || str(o.ref) || str(o.key) || String(i + 1);
  const { id: _id, verdict, ...rest } = o;
  void _id;
  const title = str(o.title) || str(o.name) || str(o.summary) || id;
  return { id, title, verdict: typeof verdict === "string" && verdict ? verdict : null, fields: rest };
}

function transitionsOf(v: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, xs] of Object.entries(obj(v))) out[k] = strs(xs);
  return out;
}

function escalationOf(v: unknown): Escalation {
  const o = obj(v);
  return { at: str(o.at), from: strs(o.from), to: strs(o.to), reason: str(o.reason) };
}

/**
 * The deadline as an instant. The backend carries it on the suspension; an
 * older row carries only `timeout_s` from `waiting_since`, which is the same
 * instant computed here. Null when neither says.
 */
export function deadlineOf(deadline: unknown, waitingSince: string, timeoutS: number | null): string | null {
  const d = str(deadline);
  if (d && !Number.isNaN(Date.parse(d))) return d;
  if (timeoutS && waitingSince && !Number.isNaN(Date.parse(waitingSince))) return new Date(Date.parse(waitingSince) + timeoutS * 1000).toISOString();
  return null;
}

export function gateOf(v: unknown): Gate {
  const g = obj(v);
  const answer = obj(g.answer);
  const decided = obj(g.decided);
  const ev = obj(g.evidence);
  const timeout_s = typeof g.timeout_s === "number" ? g.timeout_s : null;
  const waiting_since = str(g.waiting_since);
  const job = g.job ? obj(g.job) : null;
  const ext = obj(g.external);
  return {
    run: str(g.run),
    agent: str(g.agent),
    node: str(g.node),
    kind: str(g.kind, "approval"),
    asks: str(g.asks),
    source: str(g.source),
    shape: shapeOf(g.shape ?? answer.shape),
    fields: (Array.isArray(g.fields) ? g.fields : Array.isArray(answer.fields) ? answer.fields : []).map(fieldOf).filter((f): f is GateField => f !== null),
    items: (Array.isArray(g.items) ? g.items : []).map(itemOf),
    verdicts: strs(g.verdicts ?? answer.verdicts),
    transitions: transitionsOf(g.transitions ?? answer.transitions),
    register: str(g.register ?? answer.register),
    approvers: strs(g.approvers),
    chain: strs(g.chain ?? g.escalate_to),
    deadline: deadlineOf(g.deadline, waiting_since, timeout_s),
    escalations: (Array.isArray(g.escalations) ? g.escalations : []).map(escalationOf),
    external: { allowed: ext.allowed === true || g.external === true },
    evidence: { decided: Object.keys(obj(ev.decided)).length ? obj(ev.decided) : decided, presented: obj(ev.presented), tainted_by: strs(ev.tainted_by) },
    timeout_s,
    on_timeout: str(g.on_timeout),
    waiting_since,
    decided,
    job: job ? { id: str(job.id), external_id: job.external_id === null || job.external_id === undefined ? null : str(job.external_id), source: str(job.source) } : null,
    warning: str(g.warning),
  };
}

/**
 * A gate from a live run's suspension, for the theater when the inbox has
 * not caught up (the stream's `end` frame arrives before the next inbox
 * read). The suspension carries shape, items, chain, approvers and deadline
 * in L5; an older one carries node, approvers and prompt, which makes a
 * decision gate.
 */
export function gateFromSuspension(run: string, agent: string, s: Record<string, unknown>): Gate {
  return gateOf({
    ...s,
    run,
    agent,
    asks: s.asks ?? s.prompt ?? "",
    waiting_since: s.waiting_since ?? s.since ?? new Date().toISOString(),
    source: s.source ?? "runtime",
  });
}

export function attentionOf(v: unknown): AttentionItem {
  const o = obj(v);
  const a = obj(o.action);
  const br = o.blast_radius ? obj(o.blast_radius) : null;
  const kind = (["gate", "refusal", "budget", "dead_letter", "health"].includes(str(o.kind)) ? str(o.kind) : "health") as AttentionKind;
  const actionKind = (["answer", "replay", "acknowledge", "open"].includes(str(a.kind)) ? str(a.kind) : kind === "gate" ? "answer" : kind === "dead_letter" ? "replay" : "open") as AttentionActionKind;
  const since = str(o.since) || str(o.at);
  const age_s = typeof o.age_s === "number" ? o.age_s : since ? Math.max(0, (Date.now() - Date.parse(since)) / 1000) : 0;
  const severity = typeof o.severity === "number" ? o.severity : 1;
  return {
    id: str(o.id) || `${kind}:${str(o.run) || str(o.job) || str(o.agent)}`,
    kind,
    title: str(o.title),
    detail: str(o.detail),
    agent: str(o.agent),
    run: str(o.run) || null,
    job: str(o.job) || null,
    severity,
    since,
    age_s,
    rank: typeof o.rank === "number" ? o.rank : severity * age_s,
    blast_radius: br ? { sinks: Number(br.sinks ?? 0), risk: str(br.risk, "read"), agents: Number(br.agents ?? 1) } : null,
    deadline: str(o.deadline) || null,
    action: { kind: actionKind, href: str(a.href) || undefined, path: str(a.path) || undefined, method: a.method === "DELETE" ? "DELETE" : "POST", label: str(a.label) || undefined },
  };
}

export function lockdownOf(v: unknown): LockdownState {
  const o = obj(v);
  return { on: o.on === true, reason: str(o.reason), by: str(o.by), at: str(o.at) || null, controls: strs(o.controls) };
}

/* ═══════════════════ calls ═══════════════════ */

async function call<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, parse: (v: unknown) => T = (v) => v as T): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
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
  if (!res.ok) {
    const e = errorText(json ?? text, res);
    if (/answered (404|502|503)/.test(e)) throw new Error(`${e}: this door is served by the backend; this deployment may not have named it (BACKEND_ORIGIN)`);
    throw new Error(e);
  }
  return parse(json);
}

/** `GET /api/approvals`: every gate waiting, laid out for a reviewer. */
export async function listGates(): Promise<Inbox> {
  return call("GET", "/api/approvals", undefined, (j) => {
    const o = obj(j);
    const pending = (Array.isArray(o.pending) ? o.pending : []).map(gateOf);
    return { count: typeof o.count === "number" ? o.count : pending.length, pending };
  });
}

function resultOf(v: unknown, run: string): AnswerResult {
  const r = obj(v);
  return { run: str(r.run) || run, ok: r.ok === true, state: str(r.state), continuing: r.continuing === true, delivered: str(r.delivered), error: str(r.error) };
}

/**
 * `POST /api/approvals/{run}` with `{answer, note}`: validated against the
 * shape before the run resumes; 400 names the field, 403 names the missing
 * role. The signer is the session. A decision also carries `approved` at the
 * top level, which is what the door read before answers had a shape.
 */
export async function answerGate(run: string, answer: Answer, note: string): Promise<AnswerResult> {
  const approved = "approved" in answer && typeof answer.approved === "boolean" ? answer.approved : undefined;
  return call("POST", `/api/approvals/${encodeURIComponent(run)}`, { answer, note, ...(approved === undefined ? {} : { approved }) }, (j) => {
    const o = obj(j);
    // The door may answer the result itself, or wrap it as the batch does.
    const first = Array.isArray(o.results) ? o.results[0] : o;
    return resultOf(first, run);
  });
}

/**
 * `POST /api/approvals` with `{runs, answer, note}`: one answer for several
 * gates of the same agent and shape. The signer is the session; `by` is
 * what the record shows beside it.
 */
export async function answerGates(runs: string[], answer: Answer, note: string, by: string): Promise<BatchResult> {
  const approved = "approved" in answer && typeof answer.approved === "boolean" ? answer.approved : undefined;
  return call("POST", "/api/approvals", { runs, answer, note, by, ...(approved === undefined ? {} : { approved }) }, (j) => {
    const o = obj(j);
    const results = (Array.isArray(o.results) ? o.results : []).map((r, i) => resultOf(r, runs[i] ?? ""));
    return {
      answered: typeof o.answered === "number" ? o.answered : results.filter((r) => r.ok).length,
      of: typeof o.of === "number" ? o.of : runs.length,
      remaining: typeof o.remaining === "number" ? o.remaining : 0,
      by: str(o.by, by),
      results,
    };
  });
}

/** `POST /api/approvals/{run}/links` with `{email, expires_s?}` → the signed URL, shown once, never sent from here. */
export async function mintLink(run: string, email: string, expiresS?: number): Promise<MintedLink> {
  return call("POST", `/api/approvals/${encodeURIComponent(run)}/links`, { email, ...(expiresS ? { expires_s: expiresS } : {}) }, (j) => {
    const o = obj(j);
    return { url: str(o.url), expires_at: str(o.expires_at) || null, email: str(o.email, email) };
  });
}

/** `GET /api/answer/{token}`: the gate's evidence and shape for an outside participant. */
export async function readExternalGate(token: string): Promise<ExternalGate> {
  return call("GET", `/api/answer/${encodeURIComponent(token)}`, undefined, (j) => {
    const o = obj(j);
    const raw = o.gate && typeof o.gate === "object" ? o.gate : o;
    return { gate: gateOf(raw), answered_as: str(o.answered_as) || str(o.as), expires_at: str(o.expires_at) || null, spent: o.spent === true };
  });
}

/** `POST /api/answer/{token}` with `{answer, note}`; the token is spent on answer. */
export async function submitExternalAnswer(token: string, answer: Answer, note: string): Promise<AnswerResult> {
  const approved = "approved" in answer && typeof answer.approved === "boolean" ? answer.approved : undefined;
  return call("POST", `/api/answer/${encodeURIComponent(token)}`, { answer, note, ...(approved === undefined ? {} : { approved }) }, (j) => resultOf(j, ""));
}

/** `GET /api/attention`: ranked, each row with the action that clears it. */
export async function listAttention(): Promise<AttentionItem[]> {
  return call("GET", "/api/attention", undefined, (j) => {
    const o = obj(j);
    const rows = Array.isArray(o.items) ? o.items : Array.isArray(o.attention) ? o.attention : Array.isArray(j) ? j : [];
    return rows.map(attentionOf);
  });
}

/** Call the door an attention row names to clear itself (replay, acknowledge). */
export async function clearAttention(item: AttentionItem): Promise<void> {
  const path = item.action.path ?? (item.action.kind === "replay" && item.job ? `/api/queue/jobs/${encodeURIComponent(item.job)}/replay` : item.action.kind === "acknowledge" ? `/api/attention/${encodeURIComponent(item.id)}/acknowledge` : "");
  if (!path) throw new Error("this row names no door to clear it");
  await call(item.action.method ?? "POST", path, {});
}

/** `POST /api/runs/{id}/steer`: guidance, a hold at the next gate, the next step's model; journalled with who and when. */
export async function steerRun(id: string, req: SteerRequest): Promise<SteerResult> {
  return call("POST", `/api/runs/${encodeURIComponent(id)}/steer`, req, (j) => {
    const o = obj(j);
    return { run: str(o.run, id), applied: obj(o.applied) as SteerRequest, by: str(o.by), at: str(o.at) || new Date().toISOString() };
  });
}

/** `POST /api/fleet` with `{action, agents, reason}`: one audit event. */
export async function fleet(action: FleetAction, agents: string[], reason: string): Promise<FleetResult> {
  return call("POST", "/api/fleet", { action, agents, reason }, (j) => {
    const o = obj(j);
    const affected = typeof o.affected === "number" ? o.affected : typeof o.killed === "number" ? o.killed : Array.isArray(o.killed) ? o.killed.length : Array.isArray(o.runs) ? o.runs.length : 0;
    return { action, agents: strs(o.agents).length ? strs(o.agents) : agents, affected, audit: str(o.audit) || str(o.event) };
  });
}

export async function getLockdown(): Promise<LockdownState> {
  return call("GET", "/api/lockdown", undefined, lockdownOf);
}

/** `POST /api/lockdown` with `{on, reason}`: every gate threshold becomes read-only, the queue pauses, sinks are held. */
export async function setLockdown(on: boolean, reason: string): Promise<LockdownState> {
  return call("POST", "/api/lockdown", { on, reason }, (j) => {
    const s = lockdownOf(j);
    return { ...s, on: typeof obj(j).on === "boolean" ? s.on : on, reason: s.reason || reason };
  });
}

/** `GET /api/runs/{id}/artefacts.zip`: a plain link; the proxy forwards it. */
export function artefactsZipUrl(run: string): string {
  return `/api/runs/${encodeURIComponent(run)}/artefacts.zip`;
}

/** `GET /api/models`: the deployments the next step may run on. */
export async function listOfferedModels(): Promise<OfferedModel[]> {
  return call("GET", "/api/models", undefined, (j) => {
    const o = obj(j);
    return (Array.isArray(o.models) ? o.models : []).map((m) => {
      const x = obj(m);
      return { id: str(x.id), label: str(x.label) || str(x.id) };
    }).filter((m) => m.id);
  });
}
