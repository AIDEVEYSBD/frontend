import { api, errorText, type Schemas } from "./client";
import { DoorError, type AttentionItem } from "./l5";

/**
 * The L9 doors (backend/CONTRACT.md, "L9: policy and evidence", with its "As
 * built" notes): policy as reviewed change, simulation, the hash chain and
 * the ledger, the controls catalogue and evidence packs, attestations,
 * autonomy tiers, retention, the AI-BOM and the regulatory views.
 *
 * Every shape here was written from responses captured from the backend's own
 * app before any of this existed (tests/fixtures/l9-captures.json, driven
 * through its doors from a frozen copy of the tree), and
 * tests/l9-contract.test.ts replays every one of them through the calls and
 * mappings below with fetch stubbed, so a renamed or re-nested field fails a
 * test instead of leaving a panel blank. Calls go through the generated
 * client, so a door that moves fails the type check; every answer is still
 * read by a mapping, because much of what L9 serves is `dict[str, Any]` in
 * the document (an evidence pack's rows, a catalogue control, a BOM's models).
 * A refusal is a DoorError carrying the backend's body: the `control`
 * (`separation_of_duties`, `policy_change`, `attestation_owner`), the `field`
 * (`proposed.calls`, `target.id`, `effective_at`, `window`), a change's
 * `state`, and on a 409 of a direct write, `door` and the `proposal` to send
 * there. Same-origin: proxy.ts forwards these paths to the backend
 * (lib/route-policy.ts BACKEND_PREFIXES), behind the cookie.
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
const orNull = <T,>(v: unknown, read: (x: unknown) => T): T | null => (isObj(v) ? read(v) : null);

/** What openapi-fetch hands back: `data` on success, the parsed body (or its text) in `error` otherwise. */
interface Answer {
  data?: unknown;
  error?: unknown;
  response: Response;
}

function refusal(error: unknown, res: Response): DoorError {
  const page = typeof error === "string";
  let message = errorText(page && error.trimStart().startsWith("<") ? null : error, res);
  if (/answered (404|502|503)/.test(message) && !obj(error).error) message = `${message}: this door is served by the backend; this deployment may not have named it (BACKEND_ORIGIN)`;
  return new DoorError(message, res.status, obj(error));
}

function read<T>(a: Answer, parse: (v: unknown) => T): T {
  if (a.response.ok && a.data !== undefined) return parse(a.data);
  throw refusal(a.error, a.response);
}

/** What a browser can be asked to save. */
export interface SavedFile {
  blob: Blob;
  filename: string;
  /** The manifest's SHA-256, for a zip: `x-evidence-manifest-sha256`. */
  sha256: string;
}

const filenameOf = (res: Response, fallback: string): string => /filename="?([^";]+)"?/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallback;

/* ═══════════════════ policy as reviewed change ═══════════════════ */

/** The change states, as `CHANGE_STATES` in backend/app/registry_l9.py. */
export type ChangeState = "pending" | "approved" | "applied" | "rejected" | "rolled_back" | "failed";
export const CHANGE_STATES: ChangeState[] = ["pending", "approved", "applied", "rejected", "rolled_back", "failed"];

export type TargetKindName = "attached" | "guardian" | "breakers" | "rate_limits" | "screener" | "retention" | "redaction" | "autonomy_tiers" | "attestation" | "peer";

export interface PolicyTarget {
  kind: string;
  /** `estate` for the estate's rules, else an agent. */
  id: string;
}

/** One field that moves, in the target's own vocabulary. A list field reads as what it gains and loses, a scalar as from and to. */
export interface DiffChange {
  field: string;
  label: string;
  from: unknown;
  to: unknown;
  added: unknown[] | null;
  removed: unknown[] | null;
  /** A list of named rules: the names whose rule changed. */
  changed: unknown[] | null;
}

export interface PolicyDiff {
  target: PolicyTarget;
  /** Nothing moves. */
  same: boolean;
  changes: DiffChange[];
  /** One line per change, in the target's vocabulary. */
  summary: string[];
}

export interface HistoryStep {
  state: string;
  by: string;
  at: string | null;
  note: string;
}

/** `GET /api/policy/changes/{id}`, and what every move of one answers. */
export interface PolicyChange {
  id: string;
  target: PolicyTarget;
  state: ChangeState;
  proposed: Record<string, unknown>;
  /** Against the rules when it was proposed. */
  diff: PolicyDiff;
  reason: string;
  effective_at: string | null;
  proposed_by: string;
  proposed_at: string;
  approved_by: string;
  approved_at: string | null;
  note: string;
  rejected_by: string;
  rejected_at: string | null;
  reject_reason: string;
  applied_at: string | null;
  applied_by: string;
  /** The rules just before and just after it was applied. */
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** The diff as applied: the rules may have moved since it was proposed. */
  applied_diff: PolicyDiff | null;
  /** Why it failed: its target was gone when it fell due. */
  error: string;
  emergency: boolean;
  rollback_of: string;
  /** The change that undid this one. */
  rolled_back_by: string;
  rolled_back_at: string | null;
  audit_id: number | null;
  history: HistoryStep[];
}

export interface PolicyChangeList {
  changes: PolicyChange[];
  count: number;
  states: Record<string, number>;
}

/** What may be proposed: `GET /api/policy/targets`. */
export interface TargetKind {
  kind: string;
  what: string;
  /** estate | agent | attached | estate_or_agent | peer */
  ids: string;
  fields: string[];
  labels: Record<string, string>;
  /** The direct write it replaced, refused 409 since L9. */
  replaces: string;
  enforced: string;
  /** The estate's rules now; null for a target held per id. */
  current: Record<string, unknown> | null;
  /** Each id holding rules of its own, and those rules. */
  by_id: Record<string, Record<string, unknown>>;
}

/** `GET /api/policy/targets/{kind}/{id}`: one target's rules now, and what a null in them inherits. */
export interface TargetRules {
  kind: string;
  id: string;
  current: Record<string, unknown>;
  inherits: Record<string, unknown> | null;
}

export interface TargetKinds {
  targets: TargetKind[];
  door: string;
}

/** `POST /api/policy/changes`: the fields it changes, the rest kept. */
export interface ProposeRequest {
  target: { kind: string; id?: string };
  proposed: Record<string, unknown>;
  /** ISO 8601; left out, applied at once on approval. */
  effective_at?: string | null;
  reason: string;
}

const targetOf = (v: unknown): PolicyTarget => ({ kind: str(obj(v).kind), id: str(obj(v).id) });

function diffChangeOf(v: unknown): DiffChange {
  const o = obj(v);
  const list = (x: unknown): unknown[] | null => (Array.isArray(x) ? x : null);
  return { field: str(o.field), label: str(o.label) || str(o.field), from: o.from ?? null, to: o.to ?? null, added: list(o.added), removed: list(o.removed), changed: list(o.changed) };
}

export function policyDiffOf(v: unknown): PolicyDiff {
  const o = obj(v);
  return { target: targetOf(o.target), same: o.same === true, changes: objs(o.changes).map(diffChangeOf), summary: strs(o.summary) };
}

const stepOf = (v: unknown): HistoryStep => {
  const o = obj(v);
  return { state: str(o.state), by: str(o.by), at: strOrNull(o.at), note: str(o.note) };
};

export function policyChangeOf(v: unknown): PolicyChange {
  const o = obj(v);
  return {
    id: str(o.id),
    target: targetOf(o.target),
    state: (CHANGE_STATES.includes(str(o.state) as ChangeState) ? str(o.state) : "failed") as ChangeState,
    proposed: obj(o.proposed),
    diff: policyDiffOf(o.diff),
    reason: str(o.reason),
    effective_at: strOrNull(o.effective_at),
    proposed_by: str(o.proposed_by),
    proposed_at: str(o.proposed_at),
    approved_by: str(o.approved_by),
    approved_at: strOrNull(o.approved_at),
    note: str(o.note),
    rejected_by: str(o.rejected_by),
    rejected_at: strOrNull(o.rejected_at),
    reject_reason: str(o.reject_reason),
    applied_at: strOrNull(o.applied_at),
    applied_by: str(o.applied_by),
    before: isObj(o.before) ? obj(o.before) : null,
    after: isObj(o.after) ? obj(o.after) : null,
    applied_diff: isObj(o.applied_diff) ? policyDiffOf(o.applied_diff) : null,
    error: str(o.error),
    emergency: o.emergency === true,
    rollback_of: str(o.rollback_of),
    rolled_back_by: str(o.rolled_back_by),
    rolled_back_at: strOrNull(o.rolled_back_at),
    audit_id: numOrNull(o.audit_id),
    history: objs(o.history).map(stepOf),
  };
}

export function policyChangeListOf(v: unknown): PolicyChangeList {
  const o = obj(v);
  const changes = objs(o.changes).map(policyChangeOf);
  return { changes, count: num(o.count, changes.length), states: counts(o.states) };
}

export function targetKindsOf(v: unknown): TargetKinds {
  const o = obj(v);
  return {
    door: str(o.door),
    targets: objs(o.targets).map((t) => {
      const labels: Record<string, string> = {};
      for (const [k, l] of Object.entries(obj(t.labels))) labels[k] = str(l);
      const byId: Record<string, Record<string, unknown>> = {};
      for (const [id, rules] of Object.entries(obj(t.by_id))) byId[id] = obj(rules);
      return { kind: str(t.kind), what: str(t.what), ids: str(t.ids), fields: strs(t.fields), labels, replaces: str(t.replaces), enforced: str(t.enforced), current: isObj(t.current) ? obj(t.current) : null, by_id: byId };
    }),
  };
}

export const targetRulesOf = (v: unknown): TargetRules => {
  const o = obj(v);
  return { kind: str(o.kind), id: str(o.id), current: obj(o.current), inherits: isObj(o.inherits) ? obj(o.inherits) : null };
};

/**
 * A direct write to a policy target, as the 409 reads: the door it goes
 * through now, the target, and the proposal to send there (`refuse_direct`).
 * Null for any other refusal.
 */
export interface DirectWriteRefusal {
  error: string;
  door: string;
  target: PolicyTarget;
  /** The fields of the write that belong to the target, ready for the door; the reason is a person's. */
  proposal: { target: PolicyTarget; proposed: Record<string, unknown>; reason: string };
}

export function directWriteRefusalOf(status: number, body: unknown): DirectWriteRefusal | null {
  if (status !== 409) return null;
  const o = obj(body);
  if (o.control !== "policy_change") return null;
  const p = obj(o.proposal);
  return { error: str(o.error), door: str(o.door), target: targetOf(o.target), proposal: { target: targetOf(p.target), proposed: obj(p.proposed), reason: str(p.reason) } };
}

/* ═══════════════════ simulation ═══════════════════ */

export type Ruling = "allowed" | "refused" | "gated";

/** One recorded call a proposal would rule differently. */
export interface SimulatedCall {
  run: string;
  entry: string;
  tool: string;
  node: string;
  was: Ruling;
  would_be: Ruling;
  control: string;
  reason: string;
  /** The record's arguments were redacted, and the re-ruling read them so: the paths. */
  redacted_args: string[] | null;
}

export interface SimulationResult {
  /** Runs ruled again, and their calls. */
  runs: number;
  calls: number;
  changed: SimulatedCall[];
  summary: { newly_refused: number; newly_gated: number; newly_allowed: number };
  target: PolicyTarget;
  window: { from: string; to: string };
  skipped: Record<string, unknown>[];
  notes: string[];
  excluded: { shadow: number; no_spec: number; no_journal: number };
  /** The limit left runs out. */
  truncated: boolean;
}

/** `24h`, `7d` or a period: `{from, to}`. */
export type SimWindow = string | { from: string; to: string };

/** `POST /api/policy/simulate`: `agent` for a spec's policy, `target` for an attached agent's grants and gate risk. */
export interface SimulateRequest {
  agent?: string;
  target?: { kind: string; id: string };
  proposed: Record<string, unknown>;
  window: SimWindow;
  limit?: number;
}

const rulingOf = (v: unknown): Ruling => (v === "refused" || v === "gated" ? v : "allowed");

export function simulationOf(v: unknown): SimulationResult {
  const o = obj(v);
  const s = obj(o.summary);
  const w = obj(o.window);
  const e = obj(o.excluded);
  return {
    runs: num(o.runs),
    calls: num(o.calls),
    changed: objs(o.changed).map((c) => ({
      run: str(c.run),
      entry: str(c.entry),
      tool: str(c.tool),
      node: str(c.node),
      was: rulingOf(c.was),
      would_be: rulingOf(c.would_be),
      control: str(c.control),
      reason: str(c.reason),
      redacted_args: Array.isArray(c.redacted_args) ? strs(c.redacted_args) : null,
    })),
    summary: { newly_refused: num(s.newly_refused), newly_gated: num(s.newly_gated), newly_allowed: num(s.newly_allowed) },
    target: targetOf(o.target),
    window: { from: str(w.from), to: str(w.to) },
    skipped: objs(o.skipped),
    notes: strs(o.notes),
    excluded: { shadow: num(e.shadow), no_spec: num(e.no_spec), no_journal: num(e.no_journal) },
    truncated: o.truncated === true,
  };
}

/* ═══════════════════ the chain ═══════════════════ */

/** `unchained`: recorded before L9. `tombstoned`: retention deleted it, and the ledger stands in. */
export type ChainState = "ok" | "broken" | "unanchored" | "unchained" | "tombstoned";
export const CHAIN_STATES: ChainState[] = ["ok", "broken", "unanchored", "unchained", "tombstoned"];

const chainOf = (v: unknown): ChainState => (CHAIN_STATES.includes(v as ChainState) ? (v as ChainState) : "broken");

export interface TombstoneRef {
  seq: number | null;
  tombstone: string;
  class: string;
  digest: string;
  count: number;
  at: string;
}

/** `GET /api/runs/{id}/verify` */
export interface RunVerification {
  run: string;
  agent: string;
  /** True for ok, unanchored and tombstoned; false for broken and unchained. */
  valid: boolean;
  /** The entry's index, or the index past the last when entries were cut off the end or the journal was rebuilt. */
  broken_at: number | null;
  /** The last hash verified. */
  anchor: string;
  anchored: boolean;
  chain: ChainState;
  entries: number;
  genesis: string;
  /** The anchor the run's genesis names. */
  previous: string;
  recorded: { seq: number | null; anchor: string; state: string; entries: number; at: string } | null;
  reason: string;
  /** Entries a control-plane note wrote on a run still being written: they wait outside the chain until it rests. */
  pending: number;
  tombstone: TombstoneRef | null;
}

export function runVerificationOf(v: unknown): RunVerification {
  const o = obj(v);
  return {
    run: str(o.run),
    agent: str(o.agent),
    valid: o.valid === true,
    broken_at: numOrNull(o.broken_at),
    anchor: str(o.anchor),
    anchored: o.anchored === true,
    chain: chainOf(o.chain),
    entries: num(o.entries),
    genesis: str(o.genesis),
    previous: str(o.previous),
    recorded: orNull(o.recorded, (r) => {
      const x = obj(r);
      return { seq: numOrNull(x.seq), anchor: str(x.anchor), state: str(x.state), entries: num(x.entries), at: str(x.at) };
    }),
    reason: str(o.reason),
    pending: num(o.pending),
    tombstone: orNull(o.tombstone, (t) => {
      const x = obj(t);
      return { seq: numOrNull(x.seq), tombstone: str(x.tombstone), class: str(x.class), digest: str(x.digest), count: num(x.count), at: str(x.at) };
    }),
  };
}

export interface LedgerBreak {
  /** The row of the ledger it was found at; null for one with no row. */
  seq: number | null;
  run: string;
  broken_at: number | null;
  reason: string;
}

/** One row of the ledger as walked. */
export interface LedgerRow {
  seq: number;
  run: string;
  agent: string;
  /** `run`, or `tombstone` for the row a retention deletion left. */
  kind: string;
  anchor: string;
  state: string;
  entries: number;
  at: string;
  chain: ChainState;
  broken_at: number | null;
}

/** `GET /api/ledger/verify?from=&to=&agent=&limit=` */
export interface LedgerVerification {
  valid: boolean;
  from: string | null;
  to: string | null;
  anchors: number;
  runs: number;
  head: { seq: number; run: string; anchor: string; at: string } | null;
  /** Runs by reading, including records with no row at all (which do not fail the walk). */
  counts: Record<ChainState, number>;
  first_break: LedgerBreak | null;
  breaks: LedgerBreak[];
  walk: LedgerRow[];
  truncated: boolean;
}

const ledgerBreakOf = (v: unknown): LedgerBreak => {
  const o = obj(v);
  return { seq: numOrNull(o.seq), run: str(o.run), broken_at: numOrNull(o.broken_at), reason: str(o.reason) };
};

export function ledgerOf(v: unknown): LedgerVerification {
  const o = obj(v);
  const c = counts(o.counts);
  return {
    valid: o.valid === true,
    from: strOrNull(o.from),
    to: strOrNull(o.to),
    anchors: num(o.anchors),
    runs: num(o.runs),
    head: orNull(o.head, (h) => {
      const x = obj(h);
      return { seq: num(x.seq), run: str(x.run), anchor: str(x.anchor), at: str(x.at) };
    }),
    counts: { ok: c.ok ?? 0, broken: c.broken ?? 0, unanchored: c.unanchored ?? 0, unchained: c.unchained ?? 0, tombstoned: c.tombstoned ?? 0 },
    first_break: isObj(o.first_break) ? ledgerBreakOf(o.first_break) : null,
    breaks: objs(o.breaks).map(ledgerBreakOf),
    walk: objs(o.walk).map((r) => ({
      seq: num(r.seq),
      run: str(r.run),
      agent: str(r.agent),
      kind: str(r.kind),
      anchor: str(r.anchor),
      state: str(r.state),
      entries: num(r.entries),
      at: str(r.at),
      chain: chainOf(r.chain),
      broken_at: numOrNull(r.broken_at),
    })),
    truncated: o.truncated === true,
  };
}

/* ═══════════════════ the controls catalogue ═══════════════════ */

/** One framework reference of a control. `basis` and `quote` name where a mapping taken from the docs was read. */
export interface FrameworkRef {
  ref: string;
  name: string;
  source: string;
  basis: string | null;
  quote: string[];
}

export interface CatalogueControl {
  id: string;
  title: string;
  family: string;
  statement: string;
  implementation: string;
  /** What the journal shows when it fires. */
  evidence: string;
  /** The journal key that names it, when one does. */
  journal: string | null;
  /** References by framework id. An empty list is a framework that maps nothing to this control. */
  frameworks: Record<string, FrameworkRef[]>;
}

export interface FrameworkInfo {
  id: string;
  name: string;
  short: string;
  /** framework | regulation */
  kind: string;
  /** The sources the mapping rests on: `console`, `docs`; empty when nothing maps. */
  mapping: string[];
  /** Why nothing is mapped, when nothing is. */
  why: string | null;
  corpus: { id: string; name: string; publisher: string; url: string; use: string; licence: string } | null;
  obligations: { ref: string; name: string; controls: string[] }[];
}

/** `GET /api/controls` */
export interface ControlsCatalogue {
  count: number;
  controls: CatalogueControl[];
  frameworks: FrameworkInfo[];
  families: { id: string; name: string; purpose: string }[];
}

export function catalogueControlOf(v: unknown): CatalogueControl {
  const o = obj(v);
  const frameworks: Record<string, FrameworkRef[]> = {};
  for (const [k, refs] of Object.entries(obj(o.frameworks))) {
    frameworks[k] = objs(refs).map((r) => ({ ref: str(r.ref), name: str(r.name), source: str(r.source), basis: strOrNull(r.basis), quote: strs(r.quote) }));
  }
  return { id: str(o.id), title: str(o.title), family: str(o.family), statement: str(o.statement), implementation: str(o.implementation), evidence: str(o.evidence), journal: strOrNull(o.journal), frameworks };
}

export function frameworkInfoOf(v: unknown): FrameworkInfo {
  const o = obj(v);
  const c = obj(o.corpus);
  return {
    id: str(o.id),
    name: str(o.name),
    short: str(o.short) || str(o.name) || str(o.id),
    kind: str(o.kind) || "framework",
    mapping: strs(o.mapping),
    why: strOrNull(o.why),
    corpus: isObj(o.corpus) ? { id: str(c.id), name: str(c.name), publisher: str(c.publisher), url: str(c.url), use: str(c.use), licence: str(c.licence) } : null,
    obligations: objs(o.obligations).map((x) => ({ ref: str(x.ref), name: str(x.name), controls: strs(x.controls) })),
  };
}

export function catalogueOf(v: unknown): ControlsCatalogue {
  const o = obj(v);
  const controls = objs(o.controls).map(catalogueControlOf);
  return {
    count: num(o.count, controls.length),
    controls,
    frameworks: objs(o.frameworks).map(frameworkInfoOf),
    families: objs(o.families).map((f) => ({ id: str(f.id), name: str(f.name), purpose: str(f.purpose) })),
  };
}

/* ═══════════════════ evidence packs ═══════════════════ */

export interface EvidenceFiring {
  run: string;
  agent: string;
  entry: string;
  at: string;
  /** The key the journal names (gate, limit, capability, taint...), and the catalogue ids it maps to; a key the catalogue does not map has none. */
  key: string;
  label: string;
  control_ids: string[];
  kind: string;
  node: string;
  tool: string;
  title: string;
  detail: string;
}

/** A gate's signed answer, stamped with the controls that opened the gate. The digest is over its own fields; it sits outside the hash chain. */
export interface SignedDecision {
  run: string;
  agent: string;
  /** The journal entry of the gate it answers. */
  gate: string;
  node: string;
  approved: boolean;
  aborted: boolean;
  by: string;
  at: string;
  note: string;
  shape: string;
  /** resume, timeout, an external link, or `journal` for one read back from an older record. */
  via: string;
  controls: string[];
  control_ids: string[];
  digest: string;
  /** The controls come from the hash-chained `gate.answer`, not a stamp on the record beside it. */
  chained: boolean;
  /** That entry's id, when chained. */
  entry: string;
  /** What the record's own copy said that the chain does not: the chain's word is what is shown, and the run reads broken. */
  disagrees: { field: string; record: string; chain: string }[];
}

export interface PackVersion {
  agent: string;
  version: number | null;
  digest: string;
  saved_at: string;
  saved_by: string;
  deployed: boolean;
  reviews: Record<string, unknown>[];
}

export interface PackChange {
  id: string;
  target_kind: string;
  target_id: string;
  state: string;
  summary: string[];
  reason: string;
  proposed_by: string;
  approved_by: string;
  applied_by: string;
  applied_at: string | null;
  emergency: boolean;
  rollback_of: string;
  rolled_back_by: string;
  in_force_at_start: boolean;
}

export interface PackDeployment {
  id: string;
  agent: string;
  version: number | null;
  digest: string;
  environment: string;
  kind: string;
  by: string;
  at: string;
  in_force_at_start: boolean;
}

export interface CitedRun {
  id: string;
  agent: string;
  state: string;
  started_at: string;
  finished_at: string;
  spec_digest: string;
  chain: ChainState;
  valid: boolean;
  broken_at: number | null;
  anchor: string;
  anchored: boolean;
  reason: string;
}

/** `ok`: every run cited holds. `partial`: one from before the chain, or with no anchor yet. `broken`: one does not. */
export type PackChainStatus = "unavailable" | "no_runs" | "ok" | "partial" | "broken";

export interface EvidencePack {
  pack: { control: string | null; framework: string | null; agent: string | null; from: string; to: string; generated_at: string; generated_by: string; keys: string[] };
  controls: CatalogueControl[];
  firings: EvidenceFiring[];
  decisions: SignedDecision[];
  policy: { versions: PackVersion[]; changes: PackChange[]; deployments: PackDeployment[] };
  identities: { identity: string; acted_as: string[]; count: number }[];
  runs: CitedRun[];
  chain: { status: PackChainStatus; runs: number; counts: Record<string, number>; broken: { run: string; broken_at: number | null; reason: string }[]; reason: string };
  counts: { controls: number; firings: number; decisions: number; runs: number; versions: number; changes: number; identities: number; by_key: Record<string, number> };
  excluded: { shadow: number };
  truncated: boolean;
}

export function signedDecisionOf(v: unknown): SignedDecision {
  const o = obj(v);
  return {
    run: str(o.run),
    agent: str(o.agent),
    gate: str(o.gate),
    node: str(o.node),
    approved: o.approved === true,
    aborted: o.aborted === true,
    by: str(o.by),
    at: str(o.at),
    note: str(o.note),
    shape: str(o.shape),
    via: str(o.via),
    chained: o.chained === true,
    entry: str(o.entry),
    disagrees: objs(o.disagrees).map((x) => ({ field: str(x.field), record: str(x.record), chain: str(x.chain) })),
    controls: strs(o.controls),
    control_ids: strs(o.control_ids),
    digest: str(o.digest),
  };
}

export function evidencePackOf(v: unknown): EvidencePack {
  const o = obj(v);
  const p = obj(o.pack);
  const c = obj(o.counts);
  const policy = obj(o.policy);
  const chain = obj(o.chain);
  // A status this client does not know reads as broken, never as holding.
  const status = chain.status === "ok" || chain.status === "partial" || chain.status === "no_runs" || chain.status === "unavailable" ? chain.status : "broken";
  return {
    pack: {
      control: strOrNull(p.control),
      framework: strOrNull(p.framework),
      agent: strOrNull(p.agent),
      from: str(p.from),
      to: str(p.to),
      generated_at: str(p.generated_at),
      generated_by: str(p.generated_by),
      keys: strs(p.keys),
    },
    controls: objs(o.controls).map(catalogueControlOf),
    firings: objs(o.firings).map((f) => ({
      run: str(f.run),
      agent: str(f.agent),
      entry: str(f.entry),
      at: str(f.at),
      key: str(f.key),
      label: str(f.label) || str(f.key),
      control_ids: strs(f.control_ids),
      kind: str(f.kind),
      node: str(f.node),
      tool: str(f.tool),
      title: str(f.title),
      detail: str(f.detail),
    })),
    decisions: objs(o.decisions).map(signedDecisionOf),
    policy: {
      versions: objs(policy.versions).map((r) => ({
        agent: str(r.agent),
        version: numOrNull(r.version),
        digest: str(r.digest),
        saved_at: str(r.saved_at),
        saved_by: str(r.saved_by),
        deployed: r.deployed === true,
        reviews: objs(r.reviews),
      })),
      changes: objs(policy.changes).map((r) => ({
        id: str(r.id),
        target_kind: str(r.target_kind),
        target_id: str(r.target_id),
        state: str(r.state),
        summary: strs(r.summary),
        reason: str(r.reason),
        proposed_by: str(r.proposed_by),
        approved_by: str(r.approved_by),
        applied_by: str(r.applied_by),
        applied_at: strOrNull(r.applied_at),
        emergency: r.emergency === true,
        rollback_of: str(r.rollback_of),
        rolled_back_by: str(r.rolled_back_by),
        in_force_at_start: r.in_force_at_start === true,
      })),
      deployments: objs(policy.deployments).map((r) => ({
        id: str(r.id),
        agent: str(r.agent),
        version: numOrNull(r.version),
        digest: str(r.digest),
        environment: str(r.environment),
        kind: str(r.kind),
        by: str(r.by),
        at: str(r.at),
        in_force_at_start: r.in_force_at_start === true,
      })),
    },
    identities: objs(o.identities).map((i) => ({ identity: str(i.identity), acted_as: strs(i.acted_as), count: num(i.count) })),
    runs: objs(o.runs).map((r) => ({
      id: str(r.id),
      agent: str(r.agent),
      state: str(r.state),
      started_at: str(r.started_at),
      finished_at: str(r.finished_at),
      spec_digest: str(r.spec_digest),
      chain: chainOf(r.chain),
      valid: r.valid === true,
      broken_at: numOrNull(r.broken_at),
      anchor: str(r.anchor),
      anchored: r.anchored === true,
      reason: str(r.reason),
    })),
    chain: { status, runs: num(chain.runs), counts: counts(chain.counts), broken: objs(chain.broken).map((b) => ({ run: str(b.run), broken_at: numOrNull(b.broken_at), reason: str(b.reason) })), reason: str(chain.reason) },
    counts: {
      controls: num(c.controls),
      firings: num(c.firings),
      decisions: num(c.decisions),
      runs: num(c.runs),
      versions: num(c.versions),
      changes: num(c.changes),
      identities: num(c.identities),
      by_key: counts(c.by_key),
    },
    excluded: { shadow: num(obj(o.excluded).shadow) },
    truncated: o.truncated === true,
  };
}

/** `GET /api/evidence`: a control, a framework, or both; and the period and agent it is narrowed to. */
export interface EvidenceQuery {
  control?: string;
  framework?: string;
  from?: string;
  to?: string;
  agent?: string;
}

/* ═══════════════════ attestations ═══════════════════ */

export interface OwnerOf {
  /** Who answers for the agent; "" when no owner is recorded. */
  owner: string;
  owner_sub: string;
  /** Where that was read from: `register`, `spec`, or `none`. */
  source: string;
}

export interface Attestation {
  id: string;
  agent: string;
  digest: string;
  version: number | null;
  statement: string;
  by: string;
  /** `owner`, or `administrator` for someone attesting for them. */
  as_role: string;
  at: string;
  /** The attestation before this one; null for the first. */
  previous: { id: string; digest: string; version: number | null; at: string; by: string } | null;
  /** The spec diff since the last attestation (the shape the versions page reads); null for the first, or when the earlier version is gone. */
  diff: Schemas["SpecDiff"] | null;
  period_days: number;
  due_at: string;
  /** What production ran when it was given; null when nothing was deployed. */
  deployed: { digest: string; version: number | null } | null;
  /** The attested digest is what production ran. */
  matches_deployed: boolean;
}

/** `GET /api/agents/{id}/attestations` */
export interface AttestationList {
  agent: string;
  attestations: Attestation[];
  count: number;
  owner: OwnerOf;
  period_days: number;
  last_at: string | null;
  due_at: string | null;
  overdue: boolean;
}

/** One row of `GET /api/attestations`: a deployed, unretired agent's standing. */
export interface Standing {
  agent: string;
  owner: OwnerOf;
  period_days: number;
  last: Attestation | null;
  due_at: string | null;
  overdue: boolean;
  deployed: { digest: string; version: number | null } | null;
}

export interface Standings {
  agents: Standing[];
  count: number;
  overdue: number;
}

const ownerOf = (v: unknown): OwnerOf => ({ owner: str(obj(v).owner), owner_sub: str(obj(v).owner_sub), source: str(obj(v).source) });
const pointOf = (v: unknown): { digest: string; version: number | null } => ({ digest: str(obj(v).digest), version: numOrNull(obj(v).version) });

export function attestationOf(v: unknown): Attestation {
  const o = obj(v);
  return {
    id: str(o.id),
    agent: str(o.agent),
    digest: str(o.digest),
    version: numOrNull(o.version),
    statement: str(o.statement),
    by: str(o.by),
    as_role: str(o.as_role),
    at: str(o.at),
    previous: orNull(o.previous, (p) => {
      const x = obj(p);
      return { id: str(x.id), digest: str(x.digest), version: numOrNull(x.version), at: str(x.at), by: str(x.by) };
    }),
    diff: isObj(o.diff) ? (obj(o.diff) as unknown as Schemas["SpecDiff"]) : null,
    period_days: num(o.period_days),
    due_at: str(o.due_at),
    deployed: isObj(o.deployed) ? pointOf(o.deployed) : null,
    matches_deployed: o.matches_deployed === true,
  };
}

export function attestationListOf(v: unknown): AttestationList {
  const o = obj(v);
  const attestations = objs(o.attestations).map(attestationOf);
  return {
    agent: str(o.agent),
    attestations,
    count: num(o.count, attestations.length),
    owner: ownerOf(o.owner),
    period_days: num(o.period_days),
    last_at: strOrNull(o.last_at),
    due_at: strOrNull(o.due_at),
    overdue: o.overdue === true,
  };
}

export function standingsOf(v: unknown): Standings {
  const o = obj(v);
  const agents = objs(o.agents).map((a) => ({
    agent: str(a.agent),
    owner: ownerOf(a.owner),
    period_days: num(a.period_days),
    last: isObj(a.last) ? attestationOf(a.last) : null,
    due_at: strOrNull(a.due_at),
    overdue: a.overdue === true,
    deployed: isObj(a.deployed) ? pointOf(a.deployed) : null,
  }));
  return { agents, count: num(o.count, agents.length), overdue: num(o.overdue) };
}

/* ═══════════════════ autonomy tiers ═══════════════════ */

export const TIERS = ["L0", "L1", "L2", "L3", "L4", "L5"] as const;
export type Tier = (typeof TIERS)[number];

export interface TierInfo {
  tier: string;
  /** The runtime's name (L3 is Conditional) and what it means. */
  name: string;
  description: string;
  /** The controls this tier adds. */
  adds: string[];
  /** The requirements the gate judges for it, under any policy change. */
  requires: string[];
  /** The security doc's reading of the tier. */
  doc_name: string;
  example: string;
  doc_minimum_controls: string;
}

export interface TierRequirement {
  id: string;
  title: string;
  what: string;
  since: string;
  judged_by: string;
}

/** One requirement as judged for an agent's digest. `met: null` is pending: not yet judged. */
export interface JudgedRequirement {
  requirement: string;
  met: boolean | null;
  detail: string;
  judged_by: string;
}

/** An agent's declared tier and what it lacks, for what production runs, else its latest version. */
export interface AgentTier {
  agent: string;
  digest: string;
  version: number | null;
  tier: string;
  name: string;
  /** Why it could not be judged. */
  problem: string;
  requires: JudgedRequirement[];
  missing: string[];
  pending: string[];
  met: boolean;
}

/** `GET /api/autonomy-tiers?agent=` */
export interface AutonomyTiers {
  tiers: TierInfo[];
  requirements: TierRequirement[];
  attestation_within_days: number;
  set_by: string;
  set_at: string;
  change: string;
  agent: AgentTier | null;
}

export function agentTierOf(v: unknown): AgentTier {
  const o = obj(v);
  return {
    agent: str(o.agent),
    digest: str(o.digest),
    version: numOrNull(o.version),
    tier: str(o.tier),
    name: str(o.name),
    problem: str(o.problem),
    requires: objs(o.requires).map((r) => ({ requirement: str(r.requirement), met: typeof r.met === "boolean" ? r.met : null, detail: str(r.detail), judged_by: str(r.judged_by) })),
    missing: strs(o.missing),
    pending: strs(o.pending),
    met: o.met === true,
  };
}

export function autonomyTiersOf(v: unknown): AutonomyTiers {
  const o = obj(v);
  return {
    tiers: objs(o.tiers).map((t) => ({
      tier: str(t.tier),
      name: str(t.name),
      description: str(t.description),
      adds: strs(t.adds),
      requires: strs(t.requires),
      doc_name: str(t.doc_name),
      example: str(t.example),
      doc_minimum_controls: str(t.doc_minimum_controls),
    })),
    requirements: objs(o.requirements).map((r) => ({ id: str(r.id), title: str(r.title), what: str(r.what), since: str(r.since), judged_by: str(r.judged_by) })),
    attestation_within_days: num(o.attestation_within_days),
    set_by: str(o.set_by),
    set_at: str(o.set_at),
    change: str(o.change),
    agent: isObj(o.agent) ? agentTierOf(o.agent) : null,
  };
}

/* ═══════════════════ retention ═══════════════════ */

export const RETENTION_CLASSES = ["runs", "journals", "evals", "deliverables", "auth_events"] as const;

export interface Tombstone {
  id: string;
  record: string;
  class: string;
  deleted_at: string;
  by: string;
  digest: string;
  detail: Record<string, unknown>;
}

/** `GET /api/retention` */
export interface RetentionView {
  /** Days per class; null keeps it. */
  rules: Record<string, number | null>;
  set_by: string;
  set_at: string;
  /** The policy change that set them; "" when none did. */
  change: string;
  last_sweep_at: string | null;
  last_sweep: Record<string, unknown>[];
  tombstones: Tombstone[];
  count: number;
}

export function retentionOf(v: unknown): RetentionView {
  const o = obj(v);
  const rules: Record<string, number | null> = {};
  for (const [k, d] of Object.entries(obj(o.rules))) rules[k] = numOrNull(d);
  const tombstones = objs(o.tombstones).map((t) => ({ id: str(t.id), record: str(t.record), class: str(t.class), deleted_at: str(t.deleted_at), by: str(t.by), digest: str(t.digest), detail: obj(t.detail) }));
  return { rules, set_by: str(o.set_by), set_at: str(o.set_at), change: str(o.change), last_sweep_at: strOrNull(o.last_sweep_at), last_sweep: objs(o.last_sweep), tombstones, count: num(o.count, tombstones.length) };
}

/* ═══════════════════ the AI-BOM ═══════════════════ */

export interface BomModel {
  /** "" when the deployment's default picks it. */
  model: string;
  nodes: string[];
  /** node_route, node, tier:<class>, default. */
  chosen_by: string[];
  route: { provider: string; kind: string; endpoint: string; local: boolean; served_as: string } | null;
}

export interface BomTool {
  name: string;
  server: string;
  risk: string;
  sink: boolean;
  taints: boolean;
  impact: string[];
  /** The class of what it returns. */
  data_class: string;
  /** The highest class a sink takes. */
  max_data_class: string;
  /** `retrieval.search`'s sources. */
  sources: { name: string; data_class: string }[];
  /** `peer.send`'s peers. */
  peers: { name: string; max_data_class: string }[];
}

export interface BomServer {
  id: string;
  label: string;
  builtin: boolean;
  registered: boolean;
  status: string;
  transport: string;
  url: string;
  version: string;
  /** The MCP `serverInfo` from discovery. */
  server_info: { name: string; version: string } | null;
  tool_list_digest: string;
  discovered_at: string | null;
  tools: string[];
}

export interface BomPeer {
  id: string;
  name: string;
  registered: boolean;
  status: string;
  url: string;
  card: { name: string; version: string } | null;
  card_digest: string;
  /** The limit that holds: the stricter of the registry's and the spec's, "" when neither sets one. */
  effective_max_data_class: string;
}

/** `GET /api/agents/{id}/bom` */
export interface AiBom {
  agent: string;
  name: string;
  owner: string;
  autonomy: string;
  version: number | null;
  digest: string;
  deployed: boolean;
  production: Record<string, unknown> | null;
  saved_by: string;
  saved_at: string | null;
  generated_at: string;
  runtime: { package: string; version: string };
  models: BomModel[];
  tools: BomTool[];
  servers: BomServer[];
  peers: BomPeer[];
  templates: { cut_from: Record<string, unknown> | null; made: Record<string, unknown>[] };
  digests: { spec: string; tool_lists: Record<string, string>; cards: Record<string, string> };
  count: { models: number; tools: number; servers: number; peers: number };
}

const stringMap = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(obj(v))) out[k] = str(x);
  return out;
};

export function bomOf(v: unknown): AiBom {
  const o = obj(v);
  const c = obj(o.count);
  const d = obj(o.digests);
  const t = obj(o.templates);
  const models = objs(o.models).map((m) => ({
    model: str(m.model),
    nodes: strs(m.nodes),
    chosen_by: strs(m.chosen_by),
    route: orNull(m.route, (r) => {
      const x = obj(r);
      return { provider: str(x.provider), kind: str(x.kind), endpoint: str(x.endpoint), local: x.local === true, served_as: str(x.served_as) };
    }),
  }));
  const tools = objs(o.tools).map((x) => ({
    name: str(x.name),
    server: str(x.server),
    risk: str(x.risk),
    sink: x.sink === true,
    taints: x.taints === true,
    impact: strs(x.impact),
    data_class: str(x.data_class),
    max_data_class: str(x.max_data_class),
    sources: objs(x.sources).map((s) => ({ name: str(s.name), data_class: str(s.data_class) })),
    peers: objs(x.peers).map((p) => ({ name: str(p.name), max_data_class: str(p.max_data_class) })),
  }));
  const servers = objs(o.servers).map((s) => ({
    id: str(s.id),
    label: str(s.label),
    builtin: s.builtin === true,
    registered: s.registered === true,
    status: str(s.status),
    transport: str(s.transport),
    url: str(s.url),
    version: str(s.version),
    server_info: orNull(s.server_info, (i) => ({ name: str(obj(i).name), version: str(obj(i).version) })),
    tool_list_digest: str(s.tool_list_digest),
    discovered_at: strOrNull(s.discovered_at),
    tools: strs(s.tools),
  }));
  const peers = objs(o.peers).map((p) => ({
    id: str(p.id),
    name: str(p.name),
    registered: p.registered === true,
    status: str(p.status),
    url: str(p.url),
    card: orNull(p.card, (x) => ({ name: str(obj(x).name), version: str(obj(x).version) })),
    card_digest: str(p.card_digest),
    effective_max_data_class: str(p.effective_max_data_class),
  }));
  const runtime = obj(o.runtime);
  return {
    agent: str(o.agent),
    name: str(o.name),
    owner: str(o.owner),
    autonomy: str(o.autonomy),
    version: numOrNull(o.version),
    digest: str(o.digest),
    deployed: o.deployed === true,
    production: isObj(o.production) ? obj(o.production) : null,
    saved_by: str(o.saved_by),
    saved_at: strOrNull(o.saved_at),
    generated_at: str(o.generated_at),
    runtime: { package: str(runtime.package), version: str(runtime.version) },
    models,
    tools,
    servers,
    peers,
    templates: { cut_from: isObj(t.cut_from) ? obj(t.cut_from) : null, made: objs(t.made) },
    digests: { spec: str(d.spec), tool_lists: stringMap(d.tool_lists), cards: stringMap(d.cards) },
    count: { models: num(c.models, models.length), tools: num(c.tools, tools.length), servers: num(c.servers, servers.length), peers: num(c.peers, peers.length) },
  };
}

/* ═══════════════════ regulatory views ═══════════════════ */

export type ObligationStatus = "evidenced" | "configured" | "not_applicable" | "not_evidenced";
export const OBLIGATION_STATUSES: ObligationStatus[] = ["evidenced", "configured", "not_evidenced", "not_applicable"];

export interface ObligationControl {
  id: string;
  title: string;
  firings: number;
  latest: string | null;
  /** platform, declared, absent, n/a */
  configuration: string;
  detail: string;
}

export interface AgentObligation {
  ref: string;
  name: string;
  status: ObligationStatus;
  controls: ObligationControl[];
}

export interface FrameworkAgent {
  agent: string;
  /** workflow | attached */
  kind: string;
  deployed: Record<string, unknown> | null;
  autonomy: string | null;
  obligations: AgentObligation[];
  summary: Partial<Record<ObligationStatus, number>>;
}

/** `GET /api/frameworks/{name}/view` */
export interface RegulatoryView {
  framework: FrameworkInfo;
  period: { from: string; to: string };
  agents: FrameworkAgent[];
  count: number;
}

export function regulatoryViewOf(v: unknown): RegulatoryView {
  const o = obj(v);
  const p = obj(o.period);
  const agents = objs(o.agents).map((a) => ({
    agent: str(a.agent),
    kind: str(a.kind),
    deployed: isObj(a.deployed) ? obj(a.deployed) : null,
    autonomy: strOrNull(a.autonomy),
    obligations: objs(a.obligations).map((x) => ({
      ref: str(x.ref),
      name: str(x.name),
      status: (OBLIGATION_STATUSES.includes(x.status as ObligationStatus) ? x.status : "not_evidenced") as ObligationStatus,
      controls: objs(x.controls).map((c) => ({ id: str(c.id), title: str(c.title), firings: num(c.firings), latest: strOrNull(c.latest), configuration: str(c.configuration), detail: str(c.detail) })),
    })),
    summary: counts(a.summary),
  }));
  return { framework: frameworkInfoOf(o.framework), period: { from: str(p.from), to: str(p.to) }, agents, count: num(o.count, agents.length) };
}

/* ═══════════════════ the record: signed decisions ═══════════════════ */

/** The signed answers on a run's record, each with what opened its gate, read from the chain where the record has it (`chained`). */
export const decisionsOf = (record: unknown): SignedDecision[] => {
  const r = obj(record);
  return objs(r.decisions).map((d) => ({ ...signedDecisionOf(d), run: str(d.run) || str(r.id), agent: str(d.agent) || str(r.system) }));
};

/** `POST /api/runs/{id}/resume`'s stamped answer, or null when the answer carries none. */
export const resumeDecisionOf = (answer: unknown): SignedDecision | null => (isObj(obj(answer).decision) ? signedDecisionOf(obj(answer).decision) : null);

/* ═══════════════════ attention ═══════════════════ */

/** An attention row that is an emergency rollback: the change it undid and the one that did. */
export function rollbackAttentionOf(item: Pick<AttentionItem, "kind" | "data">): { change: string; rollback_of: string } | null {
  if (item.kind !== "policy_rollback" || !item.data) return null;
  return { change: str(item.data.change), rollback_of: str(item.data.rollback_of) };
}

/* ═══════════════════ calls ═══════════════════ */

/** `GET /api/policy/targets` (view): what may be proposed, and the estate's rules now. */
export async function getPolicyTarget(kind: string, id: string): Promise<TargetRules> {
  return read(await api.GET("/api/policy/targets/{kind}/{target_id}", { params: { path: { kind, target_id: id } } }), targetRulesOf);
}

export async function listPolicyTargets(): Promise<TargetKinds> {
  return read(await api.GET("/api/policy/targets"), targetKindsOf);
}

/** `GET /api/policy/changes?target=&state=` (view): newest first. `target` is a kind, or `kind:id`. */
export async function listPolicyChanges(q: { target?: string; state?: ChangeState; limit?: number } = {}): Promise<PolicyChangeList> {
  return read(await api.GET("/api/policy/changes", { params: { query: q } }), policyChangeListOf);
}

/** `GET /api/policy/changes/{id}` (view); 404 for one that is not on record. */
export async function getPolicyChange(id: string): Promise<PolicyChange> {
  return read(await api.GET("/api/policy/changes/{change_id}", { params: { path: { change_id: id } } }), policyChangeOf);
}

/** `POST /api/policy/changes` (configure, a person): 201 pending with its diff. 400 names `field`: `target.kind`, `target.id`, `proposed`, `proposed.<field>`, `effective_at`, `reason`. 404 for an attached agent that is not. */
export async function proposePolicyChange(body: ProposeRequest): Promise<PolicyChange> {
  return read(await api.POST("/api/policy/changes", { body: { target: { kind: body.target.kind, id: body.target.id ?? "" }, proposed: body.proposed, effective_at: body.effective_at ?? null, reason: body.reason } }), policyChangeOf);
}

/** `POST /api/policy/changes/{id}/approve` (configure, not its proposer): `applied`, or `approved` until its effective time. 403 `control: separation_of_duties`; 409 with its `state`. */
export async function approvePolicyChange(id: string, note = ""): Promise<PolicyChange> {
  return read(await api.POST("/api/policy/changes/{change_id}/approve", { params: { path: { change_id: id } }, body: { note } }), policyChangeOf);
}

/** `POST /api/policy/changes/{id}/reject` (configure): pending or approved, with a reason. */
export async function rejectPolicyChange(id: string, reason: string): Promise<PolicyChange> {
  return read(await api.POST("/api/policy/changes/{change_id}/reject", { params: { path: { change_id: id } }, body: { reason } }), policyChangeOf);
}

/** `POST /api/policy/changes/{id}/rollback` (configure): 201, a new change already applied, marked an emergency. 409 for what is not applied, or when there is nothing left to undo. */
export async function rollbackPolicyChange(id: string, reason: string): Promise<PolicyChange> {
  return read(await api.POST("/api/policy/changes/{change_id}/rollback", { params: { path: { change_id: id } }, body: { reason } }), policyChangeOf);
}

/** `POST /api/policy/simulate` (view): nothing is executed. 400 names `field` (and `path` for a proposal that does not load), and by name a target that decides nothing per call. */
export async function simulatePolicy(body: SimulateRequest): Promise<SimulationResult> {
  return read(await api.POST("/api/policy/simulate", { body: body as Schemas["SimulateRequest"] }), simulationOf);
}

/** `GET /api/runs/{id}/verify` (view): a deleted run still answers, from its tombstone. */
export async function verifyRun(id: string): Promise<RunVerification> {
  return read(await api.GET("/api/runs/{run_id}/verify", { params: { path: { run_id: id } } }), runVerificationOf);
}

/** `GET /api/ledger/verify` (view): walks the run anchors. `from` and `to` are times, matched against when a row was recorded. */
export async function verifyLedger(q: { from?: string; to?: string; agent?: string; limit?: number } = {}): Promise<LedgerVerification> {
  return read(await api.GET("/api/ledger/verify", { params: { query: q } }), ledgerOf);
}

/** `GET /api/controls` (view) */
export async function getControls(): Promise<ControlsCatalogue> {
  return read(await api.GET("/api/controls"), catalogueOf);
}

/** `GET /api/evidence` (view): JSON. 400 names `field`: `control` (name one, or a framework), `framework`, `from`, `format`. */
export async function getEvidence(q: EvidenceQuery): Promise<EvidencePack> {
  return read(await api.GET("/api/evidence", { params: { query: q } }), evidencePackOf);
}

/** The pack as a zip: a manifest with a SHA-256 per file, and each cited record. */
export async function downloadEvidence(q: EvidenceQuery): Promise<SavedFile> {
  const { data, error, response } = await api.GET("/api/evidence", { params: { query: { ...q, format: "zip" } }, parseAs: "blob" });
  if (!response.ok || !data) throw refusal(error, response);
  return { blob: data as unknown as Blob, filename: filenameOf(response, "evidence.zip"), sha256: response.headers.get("x-evidence-manifest-sha256") ?? "" };
}

/** `GET /api/attestations?overdue=` (view): every deployed, unretired agent's standing. */
export async function listStandings(overdue?: boolean): Promise<Standings> {
  return read(await api.GET("/api/attestations", { params: { query: overdue === undefined ? {} : { overdue } } }), standingsOf);
}

/** `GET /api/agents/{id}/attestations` (view): newest first, with its owner, period and due date. 404 for an agent never saved. */
export async function listAttestations(agent: string): Promise<AttestationList> {
  return read(await api.GET("/api/agents/{agent}/attestations", { params: { path: { agent } } }), attestationListOf);
}

/** `POST /api/agents/{id}/attestations` (the owner, or an administrator): 201 with the diff since the last. 403 `control: attestation_owner`; 404 `field: digest`. */
export async function attestAgent(agent: string, body: { statement: string; digest: string }): Promise<Attestation> {
  return read(await api.POST("/api/agents/{agent}/attestations", { params: { path: { agent } }, body }), attestationOf);
}

/** `GET /api/autonomy-tiers?agent=` (view): 404 for an agent never saved. */
export async function getAutonomyTiers(agent?: string): Promise<AutonomyTiers> {
  return read(await api.GET("/api/autonomy-tiers", { params: { query: agent ? { agent } : {} } }), autonomyTiersOf);
}

/** `GET /api/retention?class=&limit=` (view) */
export async function getRetention(q: { class?: string; limit?: number } = {}): Promise<RetentionView> {
  return read(await api.GET("/api/retention", { params: { query: q } }), retentionOf);
}

/** `GET /api/agents/{id}/bom?version=` (view): 404 `field: version`, or for an agent never saved. */
export async function getBom(agent: string, version?: number): Promise<AiBom> {
  return read(await api.GET("/api/agents/{agent}/bom", { params: { path: { agent }, query: version === undefined ? {} : { version } } }), bomOf);
}

/** The BOM as a CycloneDX 1.6 document. */
export async function downloadCycloneDx(agent: string, version?: number): Promise<SavedFile> {
  const { data, error, response } = await api.GET("/api/agents/{agent}/bom", { params: { path: { agent }, query: { format: "cyclonedx", ...(version === undefined ? {} : { version }) } }, parseAs: "blob" });
  if (!response.ok || !data) throw refusal(error, response);
  return { blob: data as unknown as Blob, filename: `${agent}${version === undefined ? "" : `-v${version}`}.cdx.json`, sha256: "" };
}

/** `GET /api/frameworks/{name}/view?agent=&from=&to=` (view) */
export async function getFrameworkView(name: string, q: { agent?: string; from?: string; to?: string } = {}): Promise<RegulatoryView> {
  return read(await api.GET("/api/frameworks/{name}/view", { params: { path: { name }, query: q } }), regulatoryViewOf);
}

/** `GET /api/frameworks` (view): each with its obligations, or why it has none. */
export async function listFrameworks(): Promise<FrameworkInfo[]> {
  return read(await api.GET("/api/frameworks"), (v) => objs(obj(v).frameworks).map(frameworkInfoOf));
}

/** Hand a file to the browser to save. */
export function saveFile(f: SavedFile): void {
  const url = URL.createObjectURL(f.blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = f.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
