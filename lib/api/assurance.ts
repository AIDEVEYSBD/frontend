import { errorText } from "./client";
import { DoorError } from "./l5";

/**
 * The assurance doors as the platform answers them: a run's chain and every
 * run's chain with the audit trail's, evidence packs, frameworks, retention,
 * and platform health. Every answer is read by a mapping below, so a field
 * the platform does not send reads as absent (null, an empty list), never as
 * a value it did not give. A refusal is a DoorError carrying the platform's
 * own sentence, its status and the address.
 *
 * The chain: each run's journal entries are hash-chained from a genesis bound
 * to the run and its definition, and the run's own row holds the last hash
 * and the count. There is no separate ledger of runs: "ledger" here is the
 * walk over every run's chain, with the audit trail's chain beside it.
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

/** A query string from the parts that are set. */
function url(path: string, query: Record<string, string | number | undefined>): string {
  const q = Object.entries(query).filter(([, v]) => v !== undefined && v !== "");
  return q.length ? `${path}?${new URLSearchParams(q.map(([k, v]) => [k, String(v)])).toString()}` : path;
}

async function answered(path: string, query: Record<string, string | number | undefined>): Promise<Response> {
  try {
    return await fetch(url(path, query), { cache: "no-store" });
  } catch (e) {
    throw new DoorError(`GET ${path} could not be reached: ${(e as Error).message || "the request did not reach the server"}`, 0, {});
  }
}

async function refusal(res: Response, path: string): Promise<DoorError> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return new DoorError(errorText(body, res, "GET", path), res.status, obj(body));
}

async function getJson(path: string, query: Record<string, string | number | undefined> = {}): Promise<unknown> {
  const res = await answered(path, query);
  if (!res.ok) throw await refusal(res, path);
  try {
    return await res.json();
  } catch {
    throw new DoorError(`GET ${path} answered ${res.status} with a body that is not JSON`, res.status, {});
  }
}

/** What a browser can be asked to save. */
export interface SavedFile {
  blob: Blob;
  filename: string;
  /** The SHA-256 of the manifest inside a pack's zip (`x-evidence-manifest-sha256`); "" for anything else. */
  sha256: string;
}

const filenameOf = (res: Response, fallback: string): string => /filename="?([^";]+)"?/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallback;

/* ═══════════════════ the chain ═══════════════════ */

/** How a chain read when it was checked: every entry hashes to the next and the run's row holds the last hash, or not. */
export type ChainReading = "ok" | "broken";

const chainOf = (v: unknown): ChainReading => (v === "ok" ? "ok" : "broken");

/** `GET /api/runs/{id}/verify` */
export interface RunVerification {
  run: string;
  agent: string;
  state: string;
  valid: boolean;
  chain: ChainReading;
  /** The first entry that does not check out; past the last entry when the run's row disagrees with the journal. */
  broken_at: number | null;
  /** What was checked, or where and why it broke, in the platform's words. */
  reason: string;
  /** How many entries the run's journal holds. */
  entries: number;
  /** How many checked out before the first break; all of them when the chain holds. */
  verified: number;
  /** The last hash verified. */
  anchor: string;
  genesis: string;
  /** How each hash is computed. */
  rule: string;
  /** Where the last hash is kept. */
  kept_in: string;
  /** What this check cannot show. */
  limits: string[];
}

export function runVerificationOf(v: unknown): RunVerification {
  const o = obj(v);
  return {
    run: str(o.run),
    agent: str(o.agent),
    state: str(o.state),
    valid: o.valid === true,
    chain: chainOf(o.chain),
    broken_at: numOrNull(o.broken_at),
    reason: str(o.reason),
    entries: num(o.entries),
    verified: num(o.verified),
    anchor: str(o.anchor),
    genesis: str(o.genesis),
    rule: str(o.rule),
    kept_in: str(o.kept_in),
    limits: strs(o.limits),
  };
}

export interface LedgerBreak {
  /** The run's place in the walk. */
  seq: number | null;
  run: string;
  broken_at: number | null;
  reason: string;
}

export interface LedgerRow {
  seq: number;
  run: string;
  agent: string;
  state: string;
  entries: number;
  /** The run's last hash. */
  anchor: string;
  /** When the run was created. */
  at: string;
  chain: ChainReading;
  broken_at: number | null;
}

export interface AuditVerification {
  valid: boolean;
  rows: number;
  /** The id of the first audit row that does not check out. */
  broken_at: number | null;
  reason: string | null;
  head: string | null;
  limits: string[];
  scope: string;
}

/** `GET /api/ledger/verify?agent=&from=&to=&limit=` */
export interface LedgerVerification {
  valid: boolean;
  from: string | null;
  to: string | null;
  runs: number;
  counts: { ok: number; broken: number };
  first_break: LedgerBreak | null;
  breaks: LedgerBreak[];
  walk: LedgerRow[];
  truncated: boolean;
  audit: AuditVerification | null;
  rule: string;
  limits: string[];
}

const ledgerBreakOf = (v: unknown): LedgerBreak => {
  const o = obj(v);
  return { seq: numOrNull(o.seq), run: str(o.run), broken_at: numOrNull(o.broken_at), reason: str(o.reason) };
};

export function ledgerOf(v: unknown): LedgerVerification {
  const o = obj(v);
  const c = counts(o.counts);
  const a = obj(o.audit);
  return {
    valid: o.valid === true,
    from: strOrNull(o.from),
    to: strOrNull(o.to),
    runs: num(o.runs),
    counts: { ok: c.ok ?? 0, broken: c.broken ?? 0 },
    first_break: isObj(o.first_break) ? ledgerBreakOf(o.first_break) : null,
    breaks: objs(o.breaks).map(ledgerBreakOf),
    walk: objs(o.walk).map((r) => ({
      seq: num(r.seq),
      run: str(r.run),
      agent: str(r.agent),
      state: str(r.state),
      entries: num(r.entries),
      anchor: str(r.anchor),
      at: str(r.at),
      chain: chainOf(r.chain),
      broken_at: numOrNull(r.broken_at),
    })),
    truncated: o.truncated === true,
    audit: isObj(o.audit)
      ? { valid: a.valid === true, rows: num(a.rows), broken_at: numOrNull(a.broken_at), reason: strOrNull(a.reason), head: strOrNull(a.head), limits: strs(a.limits), scope: str(a.scope) }
      : null,
    rule: str(o.rule),
    limits: strs(o.limits),
  };
}

/** `GET /api/runs/{id}/verify` (view): the run's chain, checked now. */
export async function verifyRun(id: string): Promise<RunVerification> {
  return runVerificationOf(await getJson(`/api/runs/${encodeURIComponent(id)}/verify`));
}

/** `GET /api/ledger/verify` (view): every run's chain, and the audit trail's. `from` and `to` are matched against when a run was created. */
export async function verifyLedger(q: { from?: string; to?: string; agent?: string; limit?: number } = {}): Promise<LedgerVerification> {
  return ledgerOf(await getJson("/api/ledger/verify", q));
}

/* ═══════════════════ retention ═══════════════════ */

export interface RetentionClass {
  class: string;
  label: string;
  holds: string;
  removable: boolean;
  /** Days kept; null when no period is set, and always null for a class that is evidence. */
  days: number | null;
  /** Why it is kept: "no period is set", or that it is evidence; null when a period is set. */
  kept_because: string | null;
}

export interface SweptClass {
  class: string;
  period_days: number | null;
  removed: number;
  kept: { record: string; why: string }[];
  said: string;
}

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
  classes: RetentionClass[];
  set_by: string;
  /** Whether and how a period can be changed. */
  changeable: string;
  not_reached: string;
  last_sweep_at: string | null;
  last_sweep_by: string | null;
  last_sweep_error: string | null;
  last_sweep: SweptClass[];
  tombstones: Tombstone[];
  count: number;
}

export function retentionOf(v: unknown): RetentionView {
  const o = obj(v);
  return {
    classes: objs(o.classes).map((c) => ({ class: str(c.class), label: str(c.label), holds: str(c.holds), removable: c.removable === true, days: numOrNull(c.days), kept_because: strOrNull(c.kept_because) })),
    set_by: str(o.set_by),
    changeable: str(o.changeable),
    not_reached: str(o.not_reached),
    last_sweep_at: strOrNull(o.last_sweep_at),
    last_sweep_by: strOrNull(o.last_sweep_by),
    last_sweep_error: strOrNull(o.last_sweep_error),
    last_sweep: objs(o.last_sweep).map((s) => ({
      class: str(s.class),
      period_days: numOrNull(s.period_days),
      removed: num(s.removed),
      kept: objs(s.kept).map((k) => ({ record: str(k.record), why: str(k.why) })),
      said: str(s.said),
    })),
    tombstones: objs(o.tombstones).map((t) => ({ id: str(t.id), record: str(t.record), class: str(t.class), deleted_at: str(t.deleted_at), by: str(t.by), digest: str(t.digest), detail: obj(t.detail) })),
    count: num(o.count),
  };
}

/** `GET /api/retention?class=&limit=` (view) */
export async function getRetention(q: { class?: string; limit?: number } = {}): Promise<RetentionView> {
  return retentionOf(await getJson("/api/retention", q));
}

/* ═══════════════════ frameworks ═══════════════════ */

export interface Obligation {
  ref: string;
  name: string;
  /** A domain's own description, or an ICL control's domain. */
  note: string;
  controls: string[];
}

export interface FrameworkInfo {
  id: string;
  name: string;
  short: string;
  /** framework | regulation */
  kind: string;
  /** cited (entries the catalogue cites), placed (one domain per control), client list (the ICL). */
  basis: string;
  /** What the obligations listed cover of the framework. */
  scope: string;
  mapping: string[];
  /** Why there are no obligations, when there are none. */
  why: string | null;
  obligations: Obligation[];
}

export function frameworkInfoOf(v: unknown): FrameworkInfo {
  const o = obj(v);
  return {
    id: str(o.id),
    name: str(o.name),
    short: str(o.short) || str(o.name) || str(o.id),
    kind: str(o.kind) || "framework",
    basis: str(o.basis),
    scope: str(o.scope),
    mapping: strs(o.mapping),
    why: strOrNull(o.why),
    obligations: objs(o.obligations).map((x) => ({ ref: str(x.ref), name: str(x.name), note: str(x.note) || str(x.domain), controls: strs(x.controls) })),
  };
}

export type ObligationStatus = "evidenced" | "configured" | "not_evidenced";
export const OBLIGATION_STATUSES: ObligationStatus[] = ["evidenced", "configured", "not_evidenced"];

export interface ObligationControl {
  id: string;
  title: string;
  /** The control's enforcement now: enforced, partly, not_enforced, unknown. */
  configuration: string;
  /** Why, as the platform read it. */
  detail: string;
  /** Firings in the period for this agent; null for a control that acts outside a run, whose firings are not counted. */
  firings: number | null;
  latest: string | null;
}

export interface AgentObligation {
  ref: string;
  name: string;
  status: ObligationStatus;
  detail: string;
  controls: ObligationControl[];
}

export interface FrameworkAgent {
  agent: string;
  deployed: { version: number | null; at: string } | null;
  obligations: AgentObligation[];
  summary: Partial<Record<ObligationStatus, number>>;
}

/** `GET /api/frameworks/{name}/view` */
export interface RegulatoryView {
  framework: FrameworkInfo;
  period: { from: string; to: string };
  agents: FrameworkAgent[];
  count: number;
  /** When enforcement was read. */
  as_of: string;
}

export function regulatoryViewOf(v: unknown): RegulatoryView {
  const o = obj(v);
  const p = obj(o.period);
  const agents = objs(o.agents).map((a) => {
    const d = obj(a.deployed);
    return {
      agent: str(a.agent),
      deployed: isObj(a.deployed) ? { version: numOrNull(d.version), at: str(d.at) } : null,
      obligations: objs(a.obligations).map((x) => ({
        ref: str(x.ref),
        name: str(x.name),
        status: (OBLIGATION_STATUSES.includes(x.status as ObligationStatus) ? x.status : "not_evidenced") as ObligationStatus,
        detail: str(x.detail),
        controls: objs(x.controls).map((c) => ({ id: str(c.id), title: str(c.title), configuration: str(c.configuration), detail: str(c.detail), firings: numOrNull(c.firings), latest: strOrNull(c.latest) })),
      })),
      summary: counts(a.summary),
    };
  });
  return { framework: frameworkInfoOf(o.framework), period: { from: str(p.from), to: str(p.to) }, agents, count: num(o.count, agents.length), as_of: str(o.as_of) };
}

/** `GET /api/frameworks` (view): each with its obligations, or why it has none. */
export async function listFrameworks(): Promise<FrameworkInfo[]> {
  return objs(obj(await getJson("/api/frameworks")).frameworks).map(frameworkInfoOf);
}

/** `GET /api/frameworks/{name}/view?agent=&from=&to=` (view) */
export async function getFrameworkView(name: string, q: { agent?: string; from?: string; to?: string } = {}): Promise<RegulatoryView> {
  return regulatoryViewOf(await getJson(`/api/frameworks/${encodeURIComponent(name)}/view`, q));
}

/* ═══════════════════ evidence packs ═══════════════════ */

export interface EvidenceFiring {
  run: string;
  agent: string;
  entry: string;
  at: string;
  key: string;
  label: string;
  control_ids: string[];
  kind: string;
  node: string;
  tool: string;
  title: string;
  detail: string;
}

export interface PackDecision {
  run: string;
  agent: string;
  /** The `gate.open` entry it answers. */
  gate: string;
  node: string;
  approved: boolean;
  aborted: boolean;
  by: string;
  at: string;
  note: string;
  via: string;
  controls: string[];
  control_ids: string[];
  digest: string;
  /** The digest was computed again over the record when the pack was built, and matched. */
  digest_holds: boolean;
  /** The `gate.answer` entry the record names is on the run's chain. */
  chained: boolean;
  entry: string;
  disagrees: { field: string; record: string; chain: string }[];
}

export interface PackVersion {
  agent: string;
  version: number | null;
  digest: string;
  saved_at: string;
  saved_by: string;
  deployed: boolean;
  /** The run ran a definition never saved as a version. */
  draft: boolean;
}

export interface PackRun {
  id: string;
  agent: string;
  state: string;
  started_at: string;
  spec_digest: string;
  chain: ChainReading;
  broken_at: number | null;
  anchor: string;
  reason: string;
}

/** `no_runs`: the pack cites no run. `ok`: every run cited verifies. `broken`: one does not. */
export type PackChainStatus = "no_runs" | "ok" | "broken";

export interface EvidencePack {
  pack: { control: string | null; framework: string | null; agent: string | null; from: string; to: string; generated_at: string; generated_by: string; keys: string[] };
  controls: { id: string; title: string; statement: string; evidence: string }[];
  firings: EvidenceFiring[];
  decisions: PackDecision[];
  /**
   * `changes`: every policy change that moved in the period (proposed,
   * approved, applied, rejected or rolled back), newest first. `deployments`:
   * every deployment and rollback made in the period, with the deploy gate's
   * conditions. `truncated` when the period held more than the pack cites.
   */
  policy: { versions: PackVersion[]; platform: { control: string; state: string | null; why: string }[]; platform_as_of: string; changes: PackPolicyChange[]; deployments: PackDeployment[]; truncated: boolean };
  identities: { identity: string; acted_as: string[]; count: number }[];
  runs: PackRun[];
  chain: { status: PackChainStatus; runs: number; broken: { run: string; broken_at: number | null; reason: string }[] };
  counts: { controls: number; firings: number; decisions: number; runs: number; versions: number; identities: number; by_key: Record<string, number> };
  /** Controls in the pack that act outside a run: no firing of them is counted. */
  outside_a_run: string[];
  truncated: boolean;
  /** What the pack cannot hold, and why. */
  not_built: Record<string, string>;
}

/** A policy change the pack cites: what it targets, where it stands, who moved it and when. */
export interface PackPolicyChange {
  id: string;
  target: { kind: string; id: string };
  state: string;
  reason: string;
  emergency: boolean;
  proposed_by: string;
  proposed_at: string;
  approved_by: string | null;
  approved_at: string;
  applied_at: string;
  rejected_by: string | null;
  rejected_at: string;
  rolled_back_at: string;
  rollback_of: string | null;
}

/** A deployment or rollback the pack cites, with the gate's conditions as they held. */
export interface PackDeployment {
  id: string;
  agent: string;
  environment: string;
  version: number | null;
  digest: string;
  kind: string;
  reason: string;
  by: string;
  at: string;
  conditions: { condition: string; holds: boolean | null }[];
}

export function evidencePackOf(v: unknown): EvidencePack {
  const o = obj(v);
  const p = obj(o.pack);
  const c = obj(o.counts);
  const policy = obj(o.policy);
  const chain = obj(o.chain);
  // A status this client does not know reads as broken, never as holding.
  const status: PackChainStatus = chain.status === "ok" || chain.status === "no_runs" ? chain.status : "broken";
  const notBuilt: Record<string, string> = {};
  for (const [k, why] of Object.entries(obj(o.not_built))) if (typeof why === "string") notBuilt[k] = why;
  return {
    pack: { control: strOrNull(p.control), framework: strOrNull(p.framework), agent: strOrNull(p.agent), from: str(p.from), to: str(p.to), generated_at: str(p.generated_at), generated_by: str(p.generated_by), keys: strs(p.keys) },
    controls: objs(o.controls).map((x) => ({ id: str(x.id), title: str(x.title), statement: str(x.statement), evidence: str(x.evidence) })),
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
    decisions: objs(o.decisions).map((d) => ({
      run: str(d.run),
      agent: str(d.agent),
      gate: str(d.gate),
      node: str(d.node),
      approved: d.approved === true,
      aborted: d.aborted === true,
      by: str(d.by),
      at: str(d.at),
      note: str(d.note),
      via: str(d.via),
      controls: strs(d.controls),
      control_ids: strs(d.control_ids),
      digest: str(d.digest),
      digest_holds: d.digest_holds === true,
      chained: d.chained === true,
      entry: str(d.entry),
      disagrees: objs(d.disagrees).map((x) => ({ field: str(x.field), record: str(x.record), chain: str(x.chain) })),
    })),
    policy: {
      versions: objs(policy.versions).map((r) => ({ agent: str(r.agent), version: numOrNull(r.version), digest: str(r.digest), saved_at: str(r.saved_at), saved_by: str(r.saved_by), deployed: r.deployed === true, draft: r.draft === true })),
      platform: objs(policy.platform).map((x) => ({ control: str(x.control), state: strOrNull(x.state), why: str(x.why) })),
      platform_as_of: str(policy.platform_as_of),
      changes: objs(policy.changes).map((r) => {
        const t = obj(r.target);
        return {
          id: str(r.id),
          target: { kind: str(t.kind), id: str(t.id) },
          state: str(r.state),
          reason: str(r.reason),
          emergency: r.emergency === true,
          proposed_by: str(r.proposed_by),
          proposed_at: str(r.proposed_at),
          approved_by: strOrNull(r.approved_by),
          approved_at: str(r.approved_at),
          applied_at: str(r.applied_at),
          rejected_by: strOrNull(r.rejected_by),
          rejected_at: str(r.rejected_at),
          rolled_back_at: str(r.rolled_back_at),
          rollback_of: strOrNull(r.rollback_of),
        };
      }),
      deployments: objs(policy.deployments).map((r) => ({
        id: str(r.id),
        agent: str(r.agent),
        environment: str(r.environment),
        version: numOrNull(r.version),
        digest: str(r.digest),
        kind: str(r.kind),
        reason: str(r.reason),
        by: str(r.by),
        at: str(r.at),
        conditions: objs(r.conditions).map((c) => ({ condition: str(c.condition), holds: c.holds === true ? true : c.holds === false ? false : null })),
      })),
      truncated: policy.truncated === true,
    },
    identities: objs(o.identities).map((i) => ({ identity: str(i.identity), acted_as: strs(i.acted_as), count: num(i.count) })),
    runs: objs(o.runs).map((r) => ({ id: str(r.id), agent: str(r.agent), state: str(r.state), started_at: str(r.started_at), spec_digest: str(r.spec_digest), chain: chainOf(r.chain), broken_at: numOrNull(r.broken_at), anchor: str(r.anchor), reason: str(r.reason) })),
    chain: { status, runs: num(chain.runs), broken: objs(chain.broken).map((b) => ({ run: str(b.run), broken_at: numOrNull(b.broken_at), reason: str(b.reason) })) },
    counts: { controls: num(c.controls), firings: num(c.firings), decisions: num(c.decisions), runs: num(c.runs), versions: num(c.versions), identities: num(c.identities), by_key: counts(c.by_key) },
    outside_a_run: strs(o.outside_a_run),
    truncated: o.truncated === true,
    not_built: notBuilt,
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

/** `GET /api/evidence` (view): built now from the records. 400 names `field`: `control`, `framework`, `from`, `to`, `format`. */
export async function getEvidence(q: EvidenceQuery): Promise<EvidencePack> {
  return evidencePackOf(await getJson("/api/evidence", { ...q }));
}

/** The pack as a zip: the pack, each cited run's stored journal and verification, and a manifest with a SHA-256 per file. */
export async function downloadEvidence(q: EvidenceQuery): Promise<SavedFile> {
  const res = await answered("/api/evidence", { ...q, format: "zip" });
  if (!res.ok) throw await refusal(res, "/api/evidence");
  return { blob: await res.blob(), filename: filenameOf(res, "evidence.zip"), sha256: res.headers.get("x-evidence-manifest-sha256") ?? "" };
}

/* ═══════════════════ platform health ═══════════════════ */

export interface Latency {
  p50_ms: number | null;
  p95_ms: number | null;
  max_ms: number | null;
  count: number;
  /** Why there is no figure, when there is none. */
  why: string | null;
}

export interface PlatformHealth {
  window: { hours: number; from: string; to: string };
  runs: { failed: number; killed: number; done: number; running_now: number; waiting_now: number; latest_failures: { run: string; agent: string; error: string; at: string }[] };
  queue: { queued: number; due: number; oldest_due_waiting_s: number | null; claimed: number; lease_lapsed: number; failed_in_window: number; why_no_wait: string | null };
  workers: { live: { id: string; host: string; threads: number; last_seen: string }[]; within_s: number };
  model_calls: { started: number; answered: number; failed: number; unanswered: number; error_rate: number | null; why_no_rate: string | null; latency: Latency };
  tool_calls: { called: number; returned: number; refused: number; failed: number; open: number; error_rate: number | null; why_no_rate: string | null; latency: Latency };
  controls: { breakers_open: { tool: string; until: string }[]; agents_held: { agent: string; mode: string; reason: string; by: string; at: string }[]; lockdown: { reason: string; by: string; at: string } | null };
  alerts: { items: { id: string; kind: string; severity: number; title: string; detail: string }[]; count: number; source: string; not_built: string[] };
  dependencies: { checked: boolean; why: string | null; ports: { port: string; ran: boolean; ok: boolean | null; configured: boolean; implementation: string; detail: string }[] };
  telemetry: {
    traces: { configured: boolean; destination: string; reason: string | null };
    logs: { configured: boolean; destination: string; reason: string | null; forwarded_through: number | null; behind: number | null; last_at: string | null; last_error: string | null };
    not_shown: string;
  };
}

const latencyOf = (v: unknown): Latency => {
  const o = obj(v);
  return { p50_ms: numOrNull(o.p50_ms), p95_ms: numOrNull(o.p95_ms), max_ms: numOrNull(o.max_ms), count: num(o.count), why: strOrNull(o.why) };
};

export function healthOf(v: unknown): PlatformHealth {
  const o = obj(v);
  const w = obj(o.window);
  const r = obj(o.runs);
  const q = obj(o.queue);
  const m = obj(o.model_calls);
  const t = obj(o.tool_calls);
  const c = obj(o.controls);
  const a = obj(o.alerts);
  const d = obj(o.dependencies);
  const tel = obj(o.telemetry);
  const tr = obj(tel.traces);
  const lg = obj(tel.logs);
  const lock = obj(c.lockdown);
  return {
    window: { hours: num(w.hours), from: str(w.from), to: str(w.to) },
    runs: {
      failed: num(r.failed),
      killed: num(r.killed),
      done: num(r.done),
      running_now: num(r.running_now),
      waiting_now: num(r.waiting_now),
      latest_failures: objs(r.latest_failures).map((x) => ({ run: str(x.run), agent: str(x.agent), error: str(x.error), at: str(x.at) })),
    },
    queue: { queued: num(q.queued), due: num(q.due), oldest_due_waiting_s: numOrNull(q.oldest_due_waiting_s), claimed: num(q.claimed), lease_lapsed: num(q.lease_lapsed), failed_in_window: num(q.failed_in_window), why_no_wait: strOrNull(q.why_no_wait) },
    workers: { live: objs(obj(o.workers).live).map((x) => ({ id: str(x.id), host: str(x.host), threads: num(x.threads), last_seen: str(x.last_seen) })), within_s: num(obj(o.workers).within_s) },
    model_calls: { started: num(m.started), answered: num(m.answered), failed: num(m.failed), unanswered: num(m.unanswered), error_rate: numOrNull(m.error_rate), why_no_rate: strOrNull(m.why_no_rate), latency: latencyOf(m.latency) },
    tool_calls: { called: num(t.called), returned: num(t.returned), refused: num(t.refused), failed: num(t.failed), open: num(t.open), error_rate: numOrNull(t.error_rate), why_no_rate: strOrNull(t.why_no_rate), latency: latencyOf(t.latency) },
    controls: {
      breakers_open: objs(c.breakers_open).map((x) => ({ tool: str(x.tool), until: str(x.until) })),
      agents_held: objs(c.agents_held).map((x) => ({ agent: str(x.agent), mode: str(x.mode), reason: str(x.reason), by: str(x.by), at: str(x.at) })),
      lockdown: isObj(c.lockdown) ? { reason: str(lock.reason), by: str(lock.by), at: str(lock.at) } : null,
    },
    alerts: { items: objs(a.items).map((x) => ({ id: str(x.id), kind: str(x.kind), severity: num(x.severity), title: str(x.title), detail: str(x.detail) })), count: num(a.count), source: str(a.source), not_built: strs(a.not_built) },
    dependencies: {
      checked: d.checked === true,
      why: strOrNull(d.why),
      ports: objs(d.ports).map((x) => ({ port: str(x.port), ran: x.ran === true, ok: typeof x.ok === "boolean" ? x.ok : null, configured: x.configured === true, implementation: str(x.implementation), detail: str(x.detail) })),
    },
    telemetry: {
      traces: { configured: tr.configured === true, destination: str(tr.destination), reason: strOrNull(tr.reason) },
      logs: { configured: lg.configured === true, destination: str(lg.destination), reason: strOrNull(lg.reason), forwarded_through: numOrNull(lg.forwarded_through), behind: numOrNull(lg.behind), last_at: strOrNull(lg.last_at), last_error: strOrNull(lg.last_error) },
      not_shown: str(tel.not_shown),
    },
  };
}

/** `GET /api/observability/health?hours=&dependencies=` (view): counted now from the records. */
export async function getHealth(q: { hours?: number; dependencies?: boolean } = {}): Promise<PlatformHealth> {
  return healthOf(await getJson("/api/observability/health", { hours: q.hours, dependencies: q.dependencies ? 1 : undefined }));
}
