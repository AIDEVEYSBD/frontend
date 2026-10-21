import { errorText, type RunRow, type Schemas } from "./client";
import { PUBLIC_ORIGIN } from "../site";

/**
 * The L5 doors (backend/CONTRACT.md, "L5: gates as interfaces, and operating
 * the estate", with its "As built" notes), called by hand.
 *
 * The doors are in backend/openapi.json and, since `npm run gen:api` was
 * run for L6, in lib/api/backend.d.ts too; every call here is still a plain
 * fetch against the same origin (proxy.ts forwards the prefixes in
 * lib/route-policy.ts BACKEND_PREFIXES to the backend) and every answer is
 * read by a mapping function below. Each mapping reads the backend's own models
 * (backend/app/approvals.py PendingGate, links.py, attention.py, fleet.py,
 * schemas.py RunSteered and RunRow); tests/l5-contract.test.ts feeds them
 * responses captured from the running backend, so a renamed or re-nested
 * field fails a test instead of leaving a panel blank. Once `npm run
 * gen:api` is run, each call can move to `api.GET(...)`/`api.POST(...)` as
 * lib/api/l4.ts does; the console-side shapes and the mappings stay.
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
  /** The field's explanation: the spec's `note` on the field (`{name, kind, required?, choices?, note?}`). */
  hint?: string;
}

/**
 * One item of the register a `verdicts` gate rules on. The backend serves
 * each as `{id, index, verdict, item}`: the item's id (its own `id`, else
 * its index), its current verdict (null until one is recorded), and the
 * register's entry under `item`, whose fields the table shows as evidence.
 */
export interface VerdictItem {
  id: string;
  title: string;
  verdict: string | null;
  /** The register entry's own fields, less its id and verdict. */
  fields: Record<string, unknown>;
}

/** One journal entry the gate rests on, as the backend lays it out (`evidence.trail`): what it was, where, and a one-line summary. */
export interface TrailEntry {
  id: string;
  /** Milliseconds into the run. */
  t: number;
  kind: string;
  node: string;
  title: string;
  detail: string;
  tool: string;
  summary: string;
  tainted: boolean;
}

/** The evidence the backend lays out for a reviewer. */
export interface Evidence {
  /** Scalars the run decided (disposition, score, hashes). */
  decided: Record<string, unknown>;
  /** What the gate was shown, as the spec presents it. */
  presented: Record<string, unknown>;
  /** Entries whose content came from outside the firm. */
  tainted_by: string[];
  /** The entries the gate cites, walked back along `because` from the gate's own entry, in journal order. */
  trail: TrailEntry[];
}

/** What each answer does next, in the backend's words (`next`). */
export interface NextSteps {
  approve: string;
  refuse: string;
}

/**
 * A gate as the inbox shows it: the backend's `GET /api/approvals` row
 * (PendingGate), normalised. Every field the console reads is present; what
 * the backend omits is defaulted here, never left undefined for the form to
 * trip on.
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
  /** The roles that may answer now, never names. Replaced by the next role in `chain` on each escalation. */
  approvers: string[];
  /** The spec's `escalate_to`: the roles an unanswered gate walks to after its first approvers, in order. Not trimmed as it walks; `escalations` says how far along it is. */
  chain: string[];
  /** How many steps along `chain` the gate has walked. */
  escalations: number;
  /** The approvers the gate first waited on, before any escalation; empty when the record cannot say (a gate escalated before the history was kept, whose journal lost the step). */
  original_approvers: string[];
  /** Every step the gate took along its chain, oldest first: when, from whom, to whom, why, and who moved it. */
  escalation_history: EscalationStep[];
  /** Absolute; null when the gate has no deadline. Reset on every escalation. */
  deadline: string | null;
  external: { allowed: boolean };
  evidence: Evidence;
  next: NextSteps;
  timeout_s: number | null;
  on_timeout: string;
  waiting_since: string;
  /** Kept for the assistant and older readers; the same scalars as evidence.decided. */
  decided: Record<string, unknown>;
  job: { id: string; external_id: string | null; source: string } | null;
  warning: string;
}

/**
 * One step an unanswered gate took along its escalation chain (the backend's
 * `EscalationStep`): when it moved (null on a record escalated before the
 * time was kept), the approvers it moved away from, the role it moved to,
 * the reason in the backend's words, and who moved it (the scheduler).
 */
export interface EscalationStep {
  at: string | null;
  from: string[];
  to: string;
  reason: string;
  by: string;
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
  /** The answer page, absolute: the backend's `url`, or this console's public origin before the path it answers when the backend has no PUBLIC_ORIGIN. */
  url: string;
  /** The API door the page calls. */
  path: string;
  /** When the token stops working; never after the gate's deadline. */
  expires_at: string | null;
  /** The gate's own deadline. */
  deadline: string | null;
  email: string;
}

/** What the external answer page is given for a token. */
export interface ExternalGate {
  gate: Gate;
  /** The address the link is bound to. */
  email: string;
  /** The identity the answer is written under: `external:<email>`. */
  answered_as: string;
  expires_at: string | null;
}

/**
 * A refusal from an L5 door. The message is the backend's `error`; beside
 * it, what the body names: the field a 400 refuses, the role a 403 says is
 * missing (and the gate's approvers), the control that refused, the pause a
 * 409 carries. A spent or expired link is a 410, an unknown one a 404.
 */
export class DoorError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  readonly field?: string;
  readonly missingRole?: string;
  readonly approvers?: string[];
  readonly control?: string;

  constructor(message: string, status: number, body: Record<string, unknown>) {
    super(message);
    this.name = "DoorError";
    this.status = status;
    this.body = body;
    this.field = typeof body.field === "string" ? body.field : undefined;
    this.missingRole = typeof body.missing_role === "string" ? body.missing_role : undefined;
    this.approvers = Array.isArray(body.approvers) ? body.approvers.map(String) : undefined;
    this.control = typeof body.control === "string" ? body.control : undefined;
  }
}

/* ═══════════════════ operating the estate ═══════════════════ */

export type AttentionKind = "gate" | "refusal" | "budget" | "dead_letter" | "health" | "drift" | "guardian" | "side_channel" | "breaker";
const ATTENTION_KINDS: AttentionKind[] = ["gate", "refusal", "budget", "dead_letter", "health", "drift", "guardian", "side_channel", "breaker"];
/** The kinds L7 added: the fleet read as a system (drift per agent, the guardian's verdicts, two agents coordinating through a shared store, an estate breaker that opened). */
export const L7_ATTENTION_KINDS: AttentionKind[] = ["drift", "guardian", "side_channel", "breaker"];

/**
 * What a row's one button does, derived from the backend's action: answer
 * the gate in the inbox dialog, replay the dead letter through the door it
 * names, re-read a health door, or open a page (or the run, for a refusal:
 * the backend's door there starts the run again, which is a person's call
 * after reading the journal, never a click from the queue). L7: a verdict
 * the guardian could not act on names the door a person would use, the
 * kill (`kill`: the kill dialog, its reason filled in from the guardian's)
 * or the steer's hold (`hold`); a drift opens the agent's drift page; an
 * act of the guardian and a side channel open the run. An estate breaker
 * still open names its close (`close`: `DELETE /api/breakers/{name}`, a
 * person with configure); one that has closed opens the Breakers page.
 */
export type AttentionActionKind = "answer" | "replay" | "check" | "open" | "kill" | "hold" | "close";

export interface AttentionAction {
  kind: AttentionActionKind;
  /** As the backend names it: POST or GET for a door; "" when `path` is a console page. */
  method: string;
  path: string;
  /** The body the door takes, as the backend lays it out (a gate's answer template); null for none. */
  body: Record<string, unknown> | null;
  /** What clears the item, in the backend's words. */
  says: string;
  /** A console page to open: the backend's `path` when it names no method. */
  href?: string;
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
  /** 1 (low) to 10 (a gate past its deadline). */
  severity: number;
  /** When it arose. */
  since: string;
  age_s: number;
  /** severity × (1 + min(age in hours, 48) / 24), as the backend ranks it. */
  rank: number;
  deadline: string | null;
  /** For a gate, what it stands in front of: sink, destructive, risky, write, or "". */
  holds: string;
  action: AttentionAction;
  /** L7: every agent the item links (a side channel: the writer, then the reader); empty for the L5 kinds. */
  agents: string[];
  /** L7: every run the item links (a side channel: the first writer and reader runs, then the rest). A reader inside an in-process sub-run is named by the sub-run's id, which is no record. */
  runs: string[];
  /** L7: what is behind it: a drift's measures and both windows, the guardian's verdict, a side channel's reads; null for the L5 kinds. */
  data: Record<string, unknown> | null;
}

export type SteerRequest = { guidance?: string; hold_at_next_gate?: boolean; model?: string };

/** Where a steer (or a kill) is delivered: the backend's own `RunSteered.delivery`, `sdk` since L6. */
export type Delivery = Schemas["RunSteered"]["delivery"];
const DELIVERIES: Delivery[] = ["in-process", "worker", "sdk"];

export interface SteerResult {
  run: string;
  /** running, or (an SDK run steered at its gate) suspended: a steer on a run that is not in flight is refused (409). */
  state: string;
  /** The levers as the backend recorded them; for a worker's or an SDK agent's run, merged with any not yet handed over (the latest guidance and model win, a hold stays). */
  applied: SteerRequest;
  by: string;
  at: string;
  /** in-process: taken at the run's next checkpoint here; worker: handed to the worker on its next heartbeat; sdk: handed to the attached agent on its next control poll. */
  delivery: Delivery;
}

export type FleetAction = "pause" | "resume" | "drain" | "kill";
export const FLEET_ACTIONS: { id: FleetAction; label: string; verb: string; tone: "ink" | "warn" | "err"; what: string }[] = [
  { id: "pause", label: "Pause", verb: "Paused", tone: "warn", what: "stops new starts and queue claims for these agents, and kills every run of theirs already in flight" },
  { id: "resume", label: "Resume", verb: "Resumed", tone: "ink", what: "lifts a pause or a drain; starts and claims are accepted again" },
  { id: "drain", label: "Drain", verb: "Draining", tone: "warn", what: "stops new starts and queue claims for these agents and lets every run in flight finish" },
  { id: "kill", label: "Kill", verb: "Killed", tone: "err", what: "kills every run in flight for these agents before its next model or tool call; it does not pause them, so new runs still start" },
];

/** A pause or a drain on an agent (`workflows.paused`). */
export interface PauseInfo {
  mode: "pause" | "drain";
  reason: string;
  by: string;
  at: string;
}

/** What `POST /api/fleet` answers. */
export interface FleetResult {
  action: FleetAction;
  agents: string[];
  reason: string;
  by: string;
  at: string;
  /** The runs the action killed (pause and kill), in-process and worker-started. */
  killed: string[];
  /** Every agent paused or draining after the action, not only these. */
  paused: Record<string, PauseInfo>;
  /** The one audit event the action wrote: its id on the IAM page's sign-in and action trail; null when the trail could not be written. */
  audit_id: number | null;
}

/** What `GET /api/fleet` answers. */
export interface FleetState {
  paused: Record<string, PauseInfo>;
  lockdown: LockdownState;
  /** Runs this backend drives in-process, per agent; a worker's runs are not counted here. */
  live: Record<string, number>;
}

export interface LockdownState {
  on: boolean;
  /** Why it was set, or why it was lifted. */
  reason: string;
  by: string;
  at: string | null;
  /** The controls a lockdown exercises while it is on, in the backend's words; empty when off. */
  controls: string[];
  /** The audit event that set (or lifted) it, on the IAM page's trail; null before the first switch. */
  audit_id: number | null;
}

/**
 * One port's own health check (`GET /api/ports/{name}/health`): the
 * implementation behind it, whether it is configured, whether its check
 * passed (null when there is nothing to check, a port with nowhere to send
 * or one that reports its configuration only), the region it runs in, what
 * the check said, and when it was read.
 */
export interface PortHealth {
  port: string;
  implementation: string;
  configured: boolean;
  ok: boolean | null;
  region: string;
  detail: Record<string, unknown>;
  checked_at: string;
}

/** What clearing an attention row came back with: a re-read port's health, else nothing to show. */
export interface Cleared {
  health: PortHealth | null;
}

/**
 * `GET /api/runs` rows gain, for a running run: the node in flight
 * (`step`), how long it has run and the agent's p95 for it over 30 days,
 * whether it is past that p95 (`stuck`), and the tool call nothing has
 * answered, else `model` (`waiting_on`; "" when not running).
 */
export type RunRowL5 = RunRow & { step?: string; step_ms?: number; step_p95_ms?: number | null; stuck?: boolean; waiting_on?: string | null };

/** What `GET /api/models` offers for the next step. */
export interface OfferedModel {
  id: string;
  label: string;
}

/** An operator's hand on a run, as its journal records it. */
export interface OperatorAction {
  action: string;
  by: string;
  /** ISO time when the entry carries one; the journal's own clock otherwise. */
  at: string;
  detail: string;
}

/* ═══════════════════ mapping ═══════════════════ */

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : v === null || v === undefined ? d : String(v));
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

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
    hint: str(f.note) || str(f.hint) || undefined,
  };
}

/**
 * An item of the register. The backend's is `{id, index, verdict, item}`
 * with the register's entry under `item` (an object, or a bare value); an
 * entry given flat (an object with an id, ref or key, or a bare string) is
 * read the same way. The index is the id of last resort, so a verdict
 * always has something to attach to.
 */
export function itemOf(v: unknown, i: number): VerdictItem {
  if (typeof v === "string") return { id: v, title: v, verdict: null, fields: {} };
  const o = obj(v);
  const wrapped = "item" in o && "index" in o;
  const inner = wrapped ? o.item : o;
  const entry = obj(inner);
  const { id: _id, verdict: _verdict, ...fields } = entry;
  void _id;
  void _verdict;
  const id = str(o.id) || str(entry.id) || str(entry.ref) || str(entry.key) || String(i + 1);
  const bare = wrapped && (typeof inner === "string" || typeof inner === "number") ? String(inner) : "";
  const title = str(entry.title) || str(entry.name) || str(entry.summary) || bare || id;
  const verdict = typeof o.verdict === "string" && o.verdict ? o.verdict : null;
  return { id, title, verdict, fields };
}

function transitionsOf(v: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, xs] of Object.entries(obj(v))) out[k] = strs(xs);
  return out;
}

function trailOf(v: unknown): TrailEntry[] {
  return (Array.isArray(v) ? v : []).map((x) => {
    const e = obj(x);
    return { id: str(e.id), t: num(e.t), kind: str(e.kind), node: str(e.node), title: str(e.title), detail: str(e.detail), tool: str(e.tool), summary: str(e.summary), tainted: e.tainted === true };
  });
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

/**
 * One escalation step. `at` is null on a record escalated before the time
 * was kept (the backend reads such a step back from the run's journal);
 * `to` was a list in the contract's first draft and is read as one role.
 */
export function escalationStepOf(v: unknown): EscalationStep {
  const o = obj(v);
  const at = str(o.at);
  return {
    at: at && !Number.isNaN(Date.parse(at)) ? at : null,
    from: strs(o.from),
    to: Array.isArray(o.to) ? strs(o.to).join(", ") : str(o.to),
    reason: str(o.reason),
    by: str(o.by),
  };
}

export function gateOf(v: unknown): Gate {
  const g = obj(v);
  const answer = obj(g.answer);
  const decided = obj(g.decided);
  const ev = obj(g.evidence);
  const next = obj(g.next);
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
    // A count of steps walked; an older reader's list of steps counts the same.
    escalations: typeof g.escalations === "number" ? Math.max(0, Math.floor(g.escalations)) : Array.isArray(g.escalations) ? g.escalations.length : 0,
    original_approvers: strs(g.original_approvers),
    // The steps themselves; a reader older than `escalation_history` carried them as the list `escalations`.
    escalation_history: (Array.isArray(g.escalation_history) ? g.escalation_history : Array.isArray(g.escalations) ? g.escalations : []).map(escalationStepOf),
    deadline: deadlineOf(g.deadline, waiting_since, timeout_s),
    external: { allowed: g.external === true || ext.allowed === true },
    evidence: { decided: Object.keys(obj(ev.decided)).length ? obj(ev.decided) : decided, presented: obj(ev.presented), tainted_by: strs(ev.tainted_by), trail: trailOf(ev.trail) },
    next: { approve: str(next.approve), refuse: str(next.refuse) },
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
 * read). The suspension carries shape, fields, items, chain, escalations,
 * approvers, deadline and external as the inbox row does; it has no
 * evidence or next steps, which only the inbox lays out.
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

/** The backend's rank: severity × (1 + min(age in hours, 48) / 24), to two places. */
export function rankOf(severity: number, ageS: number): number {
  const hours = Math.max(0, ageS) / 3600;
  return Math.round(severity * (1 + Math.min(hours, 48) / 24) * 100) / 100;
}

/**
 * Whether a run id names a record a run page can open. The engine names an
 * in-process sub-run `<agent>-sub-<10 hex>` and a worker's runtime by a
 * path, and neither is a record (a kill's receipt can name one).
 */
export function looksLikeRecordId(id: string): boolean {
  return /^[a-z0-9][A-Za-z0-9._-]{0,120}$/.test(id) && !/-sub-[0-9a-f]{10}$/.test(id);
}

/**
 * The run an item's Open goes to: its own run, else the first it links.
 * Every run an attention item names is a record since the backend's L7
 * polish (a side channel read inside an in-process sub-run names the record
 * holding it, the sub-run under `data`).
 */
export function openableRun(item: Pick<AttentionItem, "run" | "runs">): string | null {
  return item.run || item.runs[0] || null;
}

/** L7 kinds: the console's page or lever for the backend's door. */
function l7Action(kind: AttentionKind, method: string, path: string, agent: string): { kind: AttentionActionKind; href?: string } {
  if (method === "POST" && /\/api\/runs\/[^/]+\/kill$/.test(path)) return { kind: "kill" };
  if (method === "POST" && /\/api\/runs\/[^/]+\/steer$/.test(path)) return { kind: "hold" };
  if (kind === "breaker") return method === "DELETE" && /^\/api\/breakers\/./.test(path) ? { kind: "close" } : { kind: "open", href: "/breakers" };
  if (kind === "drift") {
    const named = /[?&]agent=([^&]+)/.exec(path)?.[1];
    let who = agent;
    try {
      who = named ? decodeURIComponent(named) : agent;
    } catch {
      /* a malformed query names nobody: the item's own agent */
    }
    return { kind: "open", href: who ? `/drift?agent=${encodeURIComponent(who)}` : "/drift" };
  }
  return { kind: "open" };
}

export function attentionOf(v: unknown): AttentionItem {
  const o = obj(v);
  const a = obj(o.action);
  const kind: AttentionKind = ATTENTION_KINDS.includes(str(o.kind) as AttentionKind) ? (str(o.kind) as AttentionKind) : "health";
  const method = str(a.method).toUpperCase();
  const path = str(a.path);
  const page = path.startsWith("/") && !path.startsWith("/api/");
  // The L7 kinds name API doors with GET (the run, the drift report, the
  // inbox): those open a page here, never re-read the door.
  const l7 = L7_ATTENTION_KINDS.includes(kind) ? l7Action(kind, method, path, str(o.agent)) : null;
  const actionKind: AttentionActionKind = l7
    ? l7.kind
    : kind === "gate" ? "answer" : !method || page ? "open" : kind === "dead_letter" && method === "POST" ? "replay" : method === "GET" ? "check" : "open";
  const since = str(o.since);
  const age_s = typeof o.age_s === "number" ? o.age_s : since && !Number.isNaN(Date.parse(since)) ? Math.max(0, (Date.now() - Date.parse(since)) / 1000) : 0;
  const severity = num(o.severity, 1);
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
    rank: typeof o.rank === "number" ? o.rank : rankOf(severity, age_s),
    deadline: str(o.deadline) || null,
    holds: str(o.holds),
    action: {
      kind: actionKind,
      method,
      path,
      body: a.body && typeof a.body === "object" && !Array.isArray(a.body) ? obj(a.body) : null,
      says: str(a.says),
      href: l7?.href ?? (actionKind === "open" && page ? path : undefined),
    },
    agents: strs(o.agents),
    runs: strs(o.runs),
    data: o.data && typeof o.data === "object" && !Array.isArray(o.data) ? obj(o.data) : null,
  };
}

const auditIdOf = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** The audit event an operator's action wrote, for its receipt: ` · audit event #12`, or "" when the answer named none. */
export function auditLine(id: number | null): string {
  return id === null ? "" : ` · audit event #${id}`;
}

export function lockdownOf(v: unknown): LockdownState {
  const o = obj(v);
  return { on: o.on === true, reason: str(o.reason), by: str(o.by), at: str(o.at) || null, controls: strs(o.controls), audit_id: auditIdOf(o.audit_id) };
}

/**
 * A refused start during a lockdown: `POST /api/runs` answers 423 with
 * `{error, lockdown}`. The lockdown as it stands, or null when the answer
 * is not that refusal.
 */
export function lockdownRefusalOf(status: number, body: unknown): LockdownState | null {
  if (status !== 423) return null;
  const o = obj(body);
  if (!o.lockdown || typeof o.lockdown !== "object") return null;
  const s = lockdownOf(o.lockdown);
  return s.on ? s : null;
}

/** The refusal in a line a person reads where the run was started: why, who, when, and how it ends. */
export function lockdownRefusalText(s: LockdownState): string {
  const who = [s.by ? `by ${s.by}` : "", s.at && !Number.isNaN(Date.parse(s.at)) ? new Date(s.at).toLocaleString() : ""].filter(Boolean).join(", ");
  return `The estate is locked down${s.reason ? `: ${s.reason}` : ""}${who ? ` (${who})` : ""}. Nothing starts until the lockdown is lifted on the Control page${s.audit_id !== null ? `; audit event #${s.audit_id}` : ""}.`;
}

/** A port's health as the door answers it; `ok` stays null when the port had nothing to check. */
export function portHealthOf(v: unknown): PortHealth {
  const o = obj(v);
  return {
    port: str(o.port),
    implementation: str(o.implementation),
    configured: o.configured !== false,
    ok: typeof o.ok === "boolean" ? o.ok : null,
    region: str(o.region),
    detail: obj(o.detail),
    checked_at: str(o.checked_at),
  };
}

/** What a port's health says, in a line: the verdict, then what the check reported. */
export function portHealthLine(h: PortHealth): string {
  const verdict = h.ok === true ? "healthy" : h.ok === false ? "failing" : h.configured ? "nothing to check" : "not configured";
  const said = typeof h.detail.detail === "string" ? h.detail.detail : Object.entries(h.detail).filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v)).map(([k, v]) => `${k} ${String(v)}`).join(", ");
  return `The ${h.port || "port"} port (${h.implementation || "unknown"}${h.region ? `, ${h.region}` : ""}) reads ${verdict}${said ? `: ${said}` : ""}.`;
}

function pausesOf(v: unknown): Record<string, PauseInfo> {
  const out: Record<string, PauseInfo> = {};
  for (const [agent, raw] of Object.entries(obj(v))) {
    const p = obj(raw);
    out[agent] = { mode: p.mode === "drain" ? "drain" : "pause", reason: str(p.reason), by: str(p.by), at: str(p.at) };
  }
  return out;
}

export function fleetStateOf(v: unknown): FleetState {
  const o = obj(v);
  const live: Record<string, number> = {};
  for (const [agent, n] of Object.entries(obj(o.live))) live[agent] = num(n);
  return { paused: pausesOf(o.paused), lockdown: lockdownOf(o.lockdown), live };
}

/**
 * The runs in flight in a ledger read: those this backend drives in-process
 * and the SDK runs their agents hold open (`live`; an SDK run stays `live`
 * at a gate, where a kill still reaches it), and those a worker is driving
 * (state running, `live` false). `live` alone misses the worker's.
 */
export function inFlight<T extends { live?: boolean; state?: string }>(rows: readonly T[]): T[] {
  return rows.filter((r) => r.live === true || r.state === "running");
}

/**
 * An operator's action in a run's journal, or null. The steer door's levers
 * are journalled as `note` entries whose `data.control` names them (the
 * `gate.open` a hold opens carries `operator.hold` too, and stays a gate): the
 * runtime writes `operator.guidance` (`text`), `operator.model` (`model`,
 * `instead_of`) and `operator.hold` (`tool`) when the run takes each one;
 * the backend writes `operator.steer` on a worker's run when the steer is
 * asked; the SDKs write the same controls. Each carries `by`, and `at` when
 * the writer had a clock.
 */
export function operatorOf(e: { kind: string; title?: string; detail?: string; data?: Record<string, unknown> }): OperatorAction | null {
  const d = e.data ?? {};
  const control = str(d.control);
  // L7: the guardian's own note when it acted (`data.control = "guardian"`:
  // the verdict, the action, the model, the confidence, the reason, signed
  // `guardian`), an operator's action like any other, by the guardian.
  if (e.kind === "note" && control === "guardian") return guardianNoteOf(e.title ?? "", e.detail ?? "", d);
  // A gate the hold opened carries the same control, but it is a gate, not the operator's note.
  if (e.kind !== "note" || !control.startsWith("operator.")) return null;
  const by = str(d.by) || "an operator";
  const at = str(d.at);
  const detail = str(e.detail);
  switch (control) {
    case "operator.guidance":
      return { action: "Guidance for the next step", by, at, detail: str(d.text) || detail };
    case "operator.model":
      return { action: `Model for the next call: ${str(d.model) || "unnamed"}`, by, at, detail };
    case "operator.hold":
      return { action: "Held for a person", by, at, detail };
    case "operator.steer":
      return { action: "Steered", by, at, detail };
    default:
      return { action: str(e.title) || control, by, at, detail };
  }
}

/**
 * The guardian's note on a run it acted on: "Guardian: held at the next
 * gate" or "Guardian: blocked the run", with the reason, the confidence, the
 * model and where the act was delivered, and since the backend's L7 polish
 * the wall clock it acted at (`data.at`, ISO 8601; a journal entry's `t` is
 * only the run's own clock). An older note has none (`at` is "").
 */
function guardianNoteOf(title: string, detail: string, d: Record<string, unknown>): OperatorAction {
  const act = str(d.action) || str(d.verdict);
  const conf = typeof d.confidence === "number" && Number.isFinite(d.confidence) ? `confidence ${d.confidence.toFixed(2)}` : "";
  const facts = [conf, str(d.model), str(d.delivery) ? `delivered ${str(d.delivery)}` : ""].filter(Boolean).join(" · ");
  const reason = str(d.reason) || detail;
  return {
    action: act === "block" ? "Guardian blocked the run" : act === "hold" ? "Guardian held the run at its next gate" : title || "Guardian",
    by: str(d.by) || "guardian",
    at: str(d.at),
    detail: [reason, facts].filter(Boolean).join(" — "),
  };
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
    const hint = /answered (404|502|503)/.test(e) ? `${e}: this door is served by the backend; this deployment may not have named it (BACKEND_ORIGIN)` : e;
    throw new DoorError(hint, res.status, obj(json));
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

const isDecision = (answer: Answer): answer is DecisionAnswer => "approved" in answer && typeof answer.approved === "boolean";

/**
 * `POST /api/approvals/{run}` with `{answer, note}`: validated against the
 * shape before the run resumes; a refusal is a DoorError, 400 naming the
 * field, 403 naming the missing role. The signer is the session. A decision
 * also carries `approved` at the top level, which the door reads first.
 */
export async function answerGate(run: string, answer: Answer, note: string): Promise<AnswerResult> {
  return call("POST", `/api/approvals/${encodeURIComponent(run)}`, { answer, note, ...(isDecision(answer) ? { approved: answer.approved } : {}) }, (j) => resultOf(j, run));
}

/**
 * One answer for several gates of the same agent and shape. The batch door
 * (`POST /api/approvals` with `{runs, approved, note}`) answers decisions
 * only and refuses anything else up front, so a form or a verdicts answer
 * goes to each gate's own door in turn, and every run's outcome is a row of
 * the result either way. The signer is the session; `by` is what the door
 * records beside a machine key's answer.
 */
export async function answerGates(runs: string[], answer: Answer, note: string, by: string): Promise<BatchResult> {
  if (!isDecision(answer)) {
    const results: AnswerResult[] = [];
    for (const run of runs) {
      try {
        results.push(await answerGate(run, answer, note));
      } catch (e) {
        results.push({ run, ok: false, state: "", continuing: false, delivered: "", error: (e as Error).message });
      }
    }
    return { answered: results.filter((r) => r.ok).length, of: runs.length, remaining: 0, by, results };
  }
  return call("POST", "/api/approvals", { runs, answer, note, by, approved: answer.approved }, (j) => {
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

/** The answer page's address in full: an absolute `url` as the backend gave it, else this console's public origin before the path. */
export function absoluteLink(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return url.startsWith("/") ? `${PUBLIC_ORIGIN}${url}` : url;
}

/** `POST /api/approvals/{run}/links` with `{email, expires_s?}` → the signed URL, shown once, never sent from here. */
export async function mintLink(run: string, email: string, expiresS?: number): Promise<MintedLink> {
  return call("POST", `/api/approvals/${encodeURIComponent(run)}/links`, { email, ...(expiresS ? { expires_s: expiresS } : {}) }, (j) => {
    const o = obj(j);
    return { url: absoluteLink(str(o.url)), path: str(o.path), expires_at: str(o.expires_at) || null, deadline: str(o.deadline) || null, email: str(o.email, email) };
  });
}

/**
 * `GET /api/answer/{token}`: the gate's shape and evidence for an outside
 * participant, flat (run, agent, node, asks, shape, fields, items, verdicts,
 * transitions, deadline, evidence, next) beside the link's `email` and
 * `expires_at`. A spent or expired link, or a gate no longer open, is a 410
 * DoorError; a token that is not one is a 404; a run running right now, 409.
 */
export async function readExternalGate(token: string): Promise<ExternalGate> {
  return call("GET", `/api/answer/${encodeURIComponent(token)}`, undefined, (j) => {
    const o = obj(j);
    const email = str(o.email);
    return { gate: gateOf(o), email, answered_as: email ? `external:${email}` : "", expires_at: str(o.expires_at) || null };
  });
}

/** `POST /api/answer/{token}` with `{answer, note}`; the token is spent on answer. */
export async function submitExternalAnswer(token: string, answer: Answer, note: string): Promise<AnswerResult> {
  return call("POST", `/api/answer/${encodeURIComponent(token)}`, { answer, note }, (j) => resultOf(j, ""));
}

/**
 * `GET /api/attention`: ranked, each row with the action that clears it.
 * An id is one row: the backend instance that tripped an estate breaker
 * lists its opening twice (from the shared row and from its own memory),
 * so a repeated id keeps its first, highest-ranked, row.
 */
export async function listAttention(): Promise<AttentionItem[]> {
  return call("GET", "/api/attention", undefined, (j) => {
    const o = obj(j);
    const seen = new Set<string>();
    return (Array.isArray(o.items) ? o.items : []).map(attentionOf).filter((item) => !seen.has(item.id) && Boolean(seen.add(item.id)));
  });
}

/** Whether a path is a port's health door (`/api/ports/{name}/health`). */
export const isPortHealthPath = (path: string): boolean => /^\/api\/ports\/[^/]+\/health$/.test(path);

/**
 * Call the door an attention row names (replay a dead letter, re-read a
 * health door), with the body the backend laid out. A health row's door is
 * the failing port's own check (`GET /api/ports/{name}/health`); what it
 * answered comes back so the row can say it.
 */
export async function clearAttention(item: AttentionItem): Promise<Cleared> {
  const { method, path, body } = item.action;
  if (!path.startsWith("/api/") || (method !== "POST" && method !== "GET")) throw new Error("this row names no door to call");
  const answer = await call(method === "GET" ? "GET" : "POST", path, method === "POST" && body ? body : undefined);
  return { health: method === "GET" && isPortHealthPath(path) ? portHealthOf(answer) : null };
}

/** `GET /api/ports/{name}/health`: one port's own check, read now. */
export async function readPortHealth(name: string): Promise<PortHealth> {
  return call("GET", `/api/ports/${encodeURIComponent(name)}/health`, undefined, portHealthOf);
}

/** `POST /api/runs/{id}/steer`: guidance, a hold at the next gate, the next call's model; journalled with who and when. 409 unless the run is in flight. */
export async function steerRun(id: string, req: SteerRequest): Promise<SteerResult> {
  return call("POST", `/api/runs/${encodeURIComponent(id)}/steer`, req, (j): SteerResult => {
    const o = obj(j);
    const s = obj(o.steer);
    const applied: SteerRequest = {};
    if (str(s.guidance)) applied.guidance = str(s.guidance);
    if (s.hold_at_next_gate === true) applied.hold_at_next_gate = true;
    if (str(s.model)) applied.model = str(s.model);
    return { run: str(o.run, id), state: str(o.state), applied, by: str(s.by), at: str(s.at), delivery: DELIVERIES.find((d) => d === o.delivery) ?? "in-process" };
  });
}

/** `POST /api/fleet` with `{action, agents, reason}`: one audit event. */
export async function fleet(action: FleetAction, agents: string[], reason: string): Promise<FleetResult> {
  return call("POST", "/api/fleet", { action, agents, reason }, (j): FleetResult => {
    const o = obj(j);
    return {
      action,
      agents: strs(o.agents).length ? strs(o.agents) : agents,
      reason: str(o.reason, reason),
      by: str(o.by),
      at: str(o.at),
      killed: strs(o.killed),
      paused: pausesOf(o.paused),
      audit_id: auditIdOf(o.audit_id),
    };
  });
}

/** `GET /api/fleet`: which agents are paused or draining, the lockdown, and what is in flight in-process. */
export async function getFleet(): Promise<FleetState> {
  return call("GET", "/api/fleet", undefined, fleetStateOf);
}

export async function getLockdown(): Promise<LockdownState> {
  return call("GET", "/api/lockdown", undefined, lockdownOf);
}

/** `POST /api/lockdown` with `{on, reason}`: every call above read in a new or resumed run waits for a person, every sink is held; the doors keep accepting work. */
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
