import { errorText, type Schemas } from "./client";
import { DoorError } from "./l5";

/**
 * The L7 doors (backend/CONTRACT.md, "L7: multi-agent systems governed",
 * with its "As built" notes for the first half): the run tree and the kill
 * that reaches it, rate limits across agents, the dependency map with its
 * blast radius, drift per agent, and the guardian.
 *
 * Every shape here was written against responses captured from the
 * backend's own app (driven in-process through its doors), not against the
 * contract's prose: tests/l7-contract.test.ts replays those captures through
 * the calls and mappings below with fetch stubbed, and holds each console
 * shape to the generated schema field by field. The calls are plain
 * fetches read by mapping functions, as lib/api/l5.ts and l6.ts do: a
 * refusal carries more than the generated ErrorBody types (a 429's scope,
 * limit and figures, a 409's candidates, a 400's field), and every answer is
 * read defensively, so a renamed field fails the contract test instead of
 * leaving a panel blank. Same-origin: proxy.ts forwards `/api/runs`,
 * `/api/dependencies`, `/api/drift` and `/api/guardian` to the backend
 * (lib/route-policy.ts BACKEND_PREFIXES).
 */

/* ═══════════════════ reading ═══════════════════ */

const str = (v: unknown, d = ""): string => (typeof v === "string" ? v : v === null || v === undefined ? d : String(v));
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => str(x)).filter(Boolean) : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown, d = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : d);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const pick = <T extends string>(v: unknown, allowed: readonly T[], d: T): T => (allowed.includes(v as T) ? (v as T) : d);

/* ═══════════════════ the run tree ═══════════════════ */

/** What a node is: a record (a run some door started), an in-process sub-run read off its parent's journal, or a task handed to a peer. */
export type TreeNodeKind = Schemas["TreeNode"]["kind"];
export const TREE_NODE_KINDS: TreeNodeKind[] = ["run", "sub_run", "peer"];

/** How the node is known to be in the tree: the root, a `parent_run` link, the shared trace (no parent the tree knows), or the journal it was mirrored into. */
export type TreeLink = Schemas["TreeNode"]["link"];
export const TREE_LINKS: TreeLink[] = ["root", "parent", "trace", "journal"];

/** Cost (priced as the ledger prices it), tokens in plus out, tool calls, refusals. */
export interface Figures {
  cost: number;
  tokens: number;
  tool_calls: number;
  refusals: number;
}

/** What a journal knows of one task handed to a peer: no cost (the peer's own), the calls made, the task's last state. */
export interface PeerInfo {
  name: string;
  task_id: string;
  /** submitted, working, completed, failed, canceled, input-required; `refused` when every call was refused; `unknown`. */
  state: string;
  calls: number;
  refused: number;
  failed: number;
  tools: string[];
  replied: boolean;
  /** L8 polish: a kill's cancel the peer answered (`state` is its answer), by whom, why, and how it went; null when no cancel landed. */
  cancel: PeerCancel | null;
}

/** A delivered cancel, on the run tree's peer node. */
export type PeerCancel = {
  state: string;
  by: string;
  reason: string;
  delivery: string;
};

export interface TreeNode {
  /** A record's run id; for a sub-run its minted id (`<agent>-sub-<hex>`, or a path for a worker's), for a peer `peer:<name>/<task or the calling run>`. Only `kind: run` is a record. */
  run: string;
  /** The agent; for a peer leaf, the peer's name. */
  agent: string;
  /** console, worker, sdk, a2a; a sub-run carries its parent's; a peer leaf `peer`. */
  source: string;
  state: string;
  /** null for the root. */
  parent: string | null;
  /** Levels below the root, as the backend counts them. */
  depth: number;
  /** This node's own figures: its own entries only, so nothing is counted twice. */
  cost: number;
  tokens: number;
  tool_calls: number;
  refusals: number;
  peer: PeerInfo | null;
  kind: TreeNodeKind;
  link: TreeLink;
  /** A record's clock; null for a sub-run and a peer leaf (the backend keeps none for them). */
  started_at: string | null;
  finished_at: string | null;
  error: string;
  /** Its cost includes a model priced at an estimate. */
  estimated: boolean;
  /** This node and everything under it. The root's is the runs list's rows summed over the records in the tree, which is the rollup. */
  total: Figures;
  /**
   * A record's row in the runs list (`GET /api/runs`): its whole journal, so
   * an orchestrator whose work ran in in-process sub-runs has own figures of
   * nothing here and a cost there. null for a sub-run or a peer leaf, which
   * have no row.
   */
  listed: Figures | null;
}

export interface AgentFigures extends Figures {
  /** Nodes of this agent in the tree; a peer is keyed `peer:<name>`. */
  nodes: number;
}

export interface TreeRollup extends Figures {
  by_agent: Record<string, AgentFigures>;
}

/** `GET /api/runs/{id}/tree` */
export interface RunTree {
  /** The orchestrator: the top of the parent chain from the run asked about (for a key scoped to one agent, the run asked about). */
  root: string;
  asked: string;
  trace_id: string;
  /** The backend's sentence on which figure is which: own, total, listed, the rollup. */
  how: string;
  /** In the backend's order: records as they were found, each followed by its sub-runs and peer leaves. `parent` makes the tree. */
  nodes: TreeNode[];
  rollup: TreeRollup;
  count: number;
  /** More than 500 nodes were found; the rest are left out. */
  truncated: boolean;
}

export function figuresOf(v: unknown): Figures {
  const o = obj(v);
  return { cost: num(o.cost), tokens: num(o.tokens), tool_calls: num(o.tool_calls), refusals: num(o.refusals) };
}

export function peerOf(v: unknown): PeerInfo | null {
  const o = obj(v);
  if (!str(o.name)) return null;
  const c = obj(o.cancel);
  const cancel = o.cancel && typeof o.cancel === "object" && !Array.isArray(o.cancel) ? { state: str(c.state), by: str(c.by), reason: str(c.reason), delivery: str(c.delivery) } : null;
  return { name: str(o.name), task_id: str(o.task_id), state: str(o.state, "unknown") || "unknown", calls: num(o.calls), refused: num(o.refused), failed: num(o.failed), tools: strs(o.tools), replied: o.replied === true, cancel };
}

export function treeNodeOf(v: unknown): TreeNode {
  const o = obj(v);
  const own = figuresOf(o);
  return {
    run: str(o.run),
    agent: str(o.agent),
    source: str(o.source),
    state: str(o.state, "unknown") || "unknown",
    parent: strOrNull(o.parent),
    depth: num(o.depth),
    ...own,
    peer: peerOf(o.peer),
    kind: pick(o.kind, TREE_NODE_KINDS, "run"),
    link: pick(o.link, TREE_LINKS, "root"),
    started_at: strOrNull(o.started_at),
    finished_at: strOrNull(o.finished_at),
    error: str(o.error),
    estimated: o.estimated === true,
    // A node with no `total` stands for itself alone.
    total: o.total && typeof o.total === "object" ? figuresOf(o.total) : own,
    listed: o.listed && typeof o.listed === "object" && !Array.isArray(o.listed) ? figuresOf(o.listed) : null,
  };
}

export function treeOf(v: unknown): RunTree {
  const o = obj(v);
  const nodes = (Array.isArray(o.nodes) ? o.nodes : []).map(treeNodeOf).filter((n) => n.run);
  const r = obj(o.rollup);
  const by_agent: Record<string, AgentFigures> = {};
  for (const [k, x] of Object.entries(obj(r.by_agent))) by_agent[k] = { ...figuresOf(x), nodes: num(obj(x).nodes) };
  return {
    root: str(o.root) || nodes[0]?.run || "",
    asked: str(o.asked),
    trace_id: str(o.trace_id),
    how: str(o.how),
    nodes,
    rollup: { ...figuresOf(r), by_agent },
    count: typeof o.count === "number" ? o.count : nodes.length,
    truncated: o.truncated === true,
  };
}

/* ═══════════════════ the kill that reaches the tree ═══════════════════ */

/** Where the named run's own kill went; `tree` when the run itself had ended and the kill reached what it set off. */
/** `settled`: the platform stopped the run at once, as no worker held it (queued, or waiting for a person); `worker`: the worker holding it stops it at its next checkpoint. */
export type KillDelivery = Schemas["RunKilled"]["delivery"] | "settled";
export const KILL_DELIVERIES: KillDelivery[] = ["settled", "in-process", "worker", "sdk", "tree"];

/**
 * What a reached run is: a record, an in-process sub-run (on its parent's
 * cancel), a queued job (dead-lettered before it started; its `run` is the
 * job's id), or (the second round) a task a run in the tree handed a peer,
 * cancelled over A2A (its `run` is `peer:<peer>/<task>`).
 */
export type ReachedKind = Schemas["ReachedRun"]["kind"];
export const REACHED_KINDS: ReachedKind[] = ["run", "sub_run", "job", "peer_task"];

/** How the kill reached it: in-process, worker (the row a heartbeat reads), sdk (the row and the control poll), shared-cancel (a sub-run, with the run it runs in), queue (dead-lettered), a2a (a peer's task, cancelled with a signed tasks/cancel the peer answered), a2a-refused (the cancel did not reach it, or the peer said no). The backend types it a string. */
export type ReachedDelivery = "in-process" | "worker" | "sdk" | "shared-cancel" | "queue" | "a2a" | "a2a-refused";
export const REACHED_DELIVERIES: ReachedDelivery[] = ["in-process", "worker", "sdk", "shared-cancel", "queue", "a2a", "a2a-refused"];

export interface Reached {
  run: string;
  agent: string;
  source: string;
  kind: ReachedKind;
  /** One of REACHED_DELIVERIES, or whatever a newer backend names. */
  delivery: string;
  parent: string | null;
  /** Levels below the run the kill named. */
  depth: number;
  /** Its state when the kill reached it (a job: `queued`, though it is dead-lettered now; a peer task: the task's last state this side saw, delivered or not). */
  state: string;
  /** A peer task the cancel reached: the state the peer answered with (`canceled`; `unknown` when its answer named none). Null when the cancel did not land, and for everything that is not a peer task (L8 polish). */
  answered_state: string | null;
  /** A peer task: the peer it was handed to (the registry's id); null for everything else. */
  peer: string | null;
  /** A peer task: its id at the peer; null for everything else. */
  task_id: string | null;
  /** A peer task the cancel did not reach (`a2a-refused`): why, in the backend's words (not in the registry, unreachable, a 401, the peer's refusal); null otherwise. */
  error: string | null;
  /** Under `already`: the earlier kill that run is still stopping on (who, why, when); null for a run this kill reached. */
  kill: KillInfo | null;
}

export interface KillInfo {
  reason: string;
  by: string;
  at: string;
}

const killInfoOf = (v: unknown): KillInfo => {
  const k = obj(v);
  return { reason: str(k.reason), by: str(k.by), at: str(k.at) };
};

/** `POST /api/runs/{id}/kill` (202) */
export interface KillReceipt {
  run: string;
  /** `running` when the run itself was in flight; its own settled state when `delivery` is `tree`. */
  state: string;
  kill: KillInfo;
  delivery: KillDelivery;
  /** The run itself (when it was in flight), its open sub-runs, its descendants by parent link, its queued children, and the tasks they handed peers. */
  reached: Reached[];
  /** What an earlier kill is still stopping, which this one did not throw at again (each with that kill under `kill`); the answer is `delivery: tree` when something new was reached beside them. */
  already: Reached[];
}

/**
 * `POST /api/runs/{id}/kill` answered 409 `KillRefused`: the kill reached
 * nothing new. Either everything in flight is already stopping on an
 * earlier kill (`already` lists it, each with that kill), which is no
 * failure and reads as "already being stopped", or nothing in the tree is
 * in flight at all (`already` empty).
 */
export interface KillRefusal {
  /** The backend's sentence: who killed it and that it stops at its next checkpoint, or that nothing is in flight. */
  error: string;
  already: Reached[];
}

export function reachedOf(v: unknown): Reached {
  const o = obj(v);
  return {
    run: str(o.run),
    agent: str(o.agent),
    source: str(o.source),
    kind: pick(o.kind, REACHED_KINDS, "run"),
    delivery: str(o.delivery),
    parent: strOrNull(o.parent),
    depth: num(o.depth),
    state: str(o.state),
    answered_state: strOrNull(o.answered_state),
    peer: strOrNull(o.peer),
    task_id: strOrNull(o.task_id),
    error: strOrNull(o.error),
    kill: o.kill && typeof o.kill === "object" && !Array.isArray(o.kill) ? killInfoOf(o.kill) : null,
  };
}

const reachedList = (v: unknown): Reached[] => (Array.isArray(v) ? v : []).map(reachedOf).filter((r) => r.run);

export function killReceiptOf(v: unknown, run = ""): KillReceipt {
  const o = obj(v);
  return {
    run: str(o.run) || run,
    state: str(o.state),
    kill: killInfoOf(o.kill),
    delivery: pick(o.delivery, KILL_DELIVERIES, "in-process"),
    reached: reachedList(o.reached),
    already: reachedList(o.already),
  };
}

export function killRefusalBodyOf(v: unknown): KillRefusal {
  const o = obj(v);
  return { error: str(o.error), already: reachedList(o.already) };
}

/**
 * The 409 of a kill that reached nothing new, or null for any other
 * refusal. `already` non-empty means the tree is already being stopped,
 * which the console shows as that rather than as an error.
 */
export function killRefusalOf(e: unknown): KillRefusal | null {
  if (!(e instanceof DoorError) || e.status !== 409) return null;
  return { error: e.message, already: reachedList(e.body.already) };
}

/* ═══════════════════ rate limits across agents ═══════════════════ */

/**
 * A 429 from a door that starts work (`POST /api/runs`, the trigger and
 * webhook doors, a live SDK open, the worker's sub-run admission): typed by
 * the backend as `RateLimitRefusal` (the A2A door's JSON-RPC 429 carries the
 * same figures as `RateLimitFigures` under `error.data`). Which scope ruled
 * (the agent's own limit, or the tree's: everything one trace started in
 * the minute), which limit, what was used against what is allowed, and the
 * seconds until the oldest counted event ages out (`retry_after_s`, also the
 * `Retry-After` header). `tree` is the trace the event counted in; `""` when
 * it joins none (a root enqueue, a refused root start).
 */
export type RateLimitRefusal = Schemas["RateLimitRefusal"];
export type RateLimitName = RateLimitRefusal["limit"];
export type RateLimitKind = RateLimitRefusal["kind"];
export const RATE_LIMIT_NAMES: RateLimitName[] = ["run_starts_per_minute", "sub_runs_per_minute", "enqueues_per_minute", "tree_per_minute"];

export type RateLimit = Pick<RateLimitRefusal, "error" | "scope" | "used" | "allowed" | "retry_after_s" | "agent" | "tree"> & {
  /** One of RATE_LIMIT_NAMES, or whatever a newer backend names. */
  limit: RateLimitName | (string & {});
  /** start, sub_run, enqueue, or whatever a newer backend names. */
  kind: RateLimitKind | (string & {});
};

/**
 * The refusal in a 429, or null when the answer is not one. The seconds to
 * wait come from the body, else the `Retry-After` header, else a minute
 * (the window), never less than one.
 */
export function rateLimitOf(status: number, body: unknown, retryAfter?: string | null): RateLimit | null {
  if (status !== 429) return null;
  const o = obj(body);
  const header = Number.parseInt(str(retryAfter), 10);
  const wait = typeof o.retry_after_s === "number" && Number.isFinite(o.retry_after_s) ? o.retry_after_s : Number.isFinite(header) ? header : 60;
  return {
    error: errorText(body, { status }),
    scope: o.scope === "tree" ? "tree" : "agent",
    limit: str(o.limit),
    used: num(o.used),
    allowed: num(o.allowed),
    retry_after_s: Math.max(1, Math.round(wait)),
    agent: str(o.agent),
    tree: str(o.tree),
    kind: str(o.kind),
  };
}

/**
 * The A2A door's JSON-RPC 429 (`RpcRateLimited`): the figures under
 * `error.data`, the sentence in `error.message`. Null when the answer is
 * not one.
 */
export function rateLimitOfRpc(status: number, body: unknown, retryAfter?: string | null): RateLimit | null {
  if (status !== 429) return null;
  const e = obj(obj(body).error);
  return rateLimitOf(429, { ...obj(e.data), error: str(e.message) }, retryAfter);
}

/* ═══════════════════ the dependency map ═══════════════════ */

export type DepKind = Schemas["DepNode"]["kind"];
export const DEP_KINDS: DepKind[] = ["agent", "tool", "server", "peer", "connector", "model", "application"];
export type EdgeKind = Schemas["DepEdge"]["kind"];
export const EDGE_KINDS: EdgeKind[] = ["calls", "sub_run", "peer", "uses_model", "serves"];
export type EdgeEvidence = Schemas["DepEdge"]["evidence"];
export const EDGE_EVIDENCE: EdgeEvidence[] = ["declared", "seen", "both"];

export interface DepNode {
  /** `<kind>:<name>`; a model's name may carry a slash. */
  id: string;
  kind: DepKind;
  /** An agent's spec name (not unique), a server's registry label, else the name. */
  label: string;
  /** ok, degraded, failing, idle; an agent paused, an application blocked; a server's pin pending, changed or refused. */
  health: string;
  declared: boolean;
  observed: boolean;
  /** Calls into it (runs, for an agent) seen in the window, and how many failed. */
  count: number;
  failures: number;
  /** What the health rests on when it is not traffic (`MCP pin pending`), or an application's class. */
  detail: string;
}

export interface DepEdge {
  /** What depends; for `serves`, the server or connector. */
  from: string;
  /** What it depends on; for `serves`, the tool it serves. */
  to: string;
  kind: EdgeKind;
  count: number;
  cost: number;
  failures: number;
  refusals: number;
  last_at: string | null;
  declared: boolean;
  observed: boolean;
  evidence: EdgeEvidence;
}

/** `GET /api/dependencies?window=` */
export interface DepMap {
  window: string;
  since: string;
  until: string;
  how: string;
  counts: { nodes: number; edges: number; seen: number; declared_only: number };
  nodes: DepNode[];
  edges: DepEdge[];
}

export function depNodeOf(v: unknown): DepNode {
  const o = obj(v);
  const id = str(o.id);
  const kind = pick(o.kind, DEP_KINDS, (DEP_KINDS.find((k) => id.startsWith(`${k}:`)) ?? "tool") as DepKind);
  return {
    id,
    kind,
    label: str(o.label) || id.slice(id.indexOf(":") + 1),
    health: str(o.health, "idle") || "idle",
    declared: o.declared === true,
    observed: o.observed === true,
    count: num(o.count),
    failures: num(o.failures),
    detail: str(o.detail),
  };
}

export function depEdgeOf(v: unknown): DepEdge {
  const o = obj(v);
  const declared = o.declared === true;
  const observed = o.observed === true;
  return {
    from: str(o.from),
    to: str(o.to),
    kind: pick(o.kind, EDGE_KINDS, "calls"),
    count: num(o.count),
    cost: num(o.cost),
    failures: num(o.failures),
    refusals: num(o.refusals),
    last_at: strOrNull(o.last_at),
    declared,
    observed,
    evidence: pick(o.evidence, EDGE_EVIDENCE, declared && observed ? "both" : observed ? "seen" : "declared"),
  };
}

export function depMapOf(v: unknown): DepMap {
  const o = obj(v);
  const c = obj(o.counts);
  const nodes = (Array.isArray(o.nodes) ? o.nodes : []).map(depNodeOf).filter((n) => n.id);
  const edges = (Array.isArray(o.edges) ? o.edges : []).map(depEdgeOf).filter((e) => e.from && e.to);
  return {
    window: str(o.window),
    since: str(o.since),
    until: str(o.until),
    how: str(o.how),
    counts: {
      nodes: num(c.nodes, nodes.length),
      edges: num(c.edges, edges.length),
      seen: num(c.seen, edges.filter((e) => e.observed).length),
      declared_only: num(c.declared_only, edges.filter((e) => e.evidence === "declared").length),
    },
    nodes,
    edges,
  };
}

/* ═══════════════════ the blast radius ═══════════════════ */

export interface BlastAgent {
  id: string;
  agent: string;
  /** direct: reached without passing through another agent. */
  how: "direct" | "transitive";
  /** Node ids from the failing node to this agent, in order. */
  via: string[];
}

export interface BlastRun {
  run: string;
  agent: string;
  state: string;
  source: string;
  /** How its agent is affected; `called` when only its journal ties it to the node. */
  uses: "direct" | "transitive" | "called";
  /** Its journal already shows a call to the node. */
  called: boolean;
}

export interface BlastApplication {
  id: string;
  name: string;
  /** The register's class: chatbot, rag, agent, multi_agent. */
  class: string;
  /** application (registered), workflow, attached. */
  source: string;
  /** The node through which it is affected. */
  via: string;
}

/** `GET /api/dependencies/{node}/blast-radius` */
export interface BlastRadius {
  node: DepNode;
  window: string;
  agents: BlastAgent[];
  runs_in_flight: BlastRun[];
  applications: BlastApplication[];
  counts: { direct: number; transitive: number; agents: number; runs_in_flight: number; applications: number };
  how: string;
}

export function blastOf(v: unknown): BlastRadius {
  const o = obj(v);
  const c = obj(o.counts);
  const agents = (Array.isArray(o.agents) ? o.agents : []).map((x): BlastAgent => {
    const a = obj(x);
    const id = str(a.id);
    return { id, agent: str(a.agent) || id.replace(/^agent:/, ""), how: a.how === "transitive" ? "transitive" : "direct", via: strs(a.via) };
  });
  const runs = (Array.isArray(o.runs_in_flight) ? o.runs_in_flight : []).map((x): BlastRun => {
    const r = obj(x);
    return { run: str(r.run), agent: str(r.agent), state: str(r.state), source: str(r.source), uses: pick(r.uses, ["direct", "transitive", "called"] as const, "direct"), called: r.called === true };
  });
  const apps = (Array.isArray(o.applications) ? o.applications : []).map((x): BlastApplication => {
    const a = obj(x);
    return { id: str(a.id), name: str(a.name) || str(a.id), class: str(a.class), source: str(a.source), via: str(a.via) };
  });
  const direct = agents.filter((a) => a.how === "direct").length;
  return {
    node: depNodeOf(o.node),
    window: str(o.window),
    agents,
    runs_in_flight: runs,
    applications: apps,
    counts: {
      direct: num(c.direct, direct),
      transitive: num(c.transitive, agents.length - direct),
      agents: num(c.agents, agents.length),
      runs_in_flight: num(c.runs_in_flight, runs.length),
      applications: num(c.applications, apps.length),
    },
    how: str(o.how),
  };
}

/* ═══════════════════ drift ═══════════════════ */

export type MeasureName = Schemas["DriftMeasure"]["name"];
/** The five trailing measures, then (L8) the two read against the deployed digest's benchmark. */
export const MEASURE_NAMES: MeasureName[] = ["disposition_mix", "confidence", "cost_per_run", "tool_mix", "refusal_rate", "benchmark_outcomes", "benchmark_labels"];
export type MeasureKind = Schemas["DriftMeasure"]["kind"];
export type Statistic = Schemas["DriftMeasure"]["statistic"];

export interface DriftWindow {
  since: string;
  until: string;
  runs: number;
}

/** A mix's side: counts by value, shares, how many pooled. */
export interface MixSide {
  counts: Record<string, number>;
  shares: Record<string, number>;
  n: number;
}

/** A mean's side. */
export interface MeanSide {
  mean: number;
  sd: number;
  n: number;
}

/** A rate's side: the share of runs with at least one refusal. */
export interface RateSide {
  rate: number;
  runs_with: number;
  n: number;
}

export interface DriftMeasure {
  name: MeasureName;
  kind: MeasureKind;
  statistic: Statistic;
  /** The Jensen–Shannon distance of a mix, |z| of a mean or a rate; null when there is not enough to compute it. */
  distance: number | null;
  /** A mean's or a rate's z, signed (recent above the baseline is positive); null for a mix. */
  z: number | null;
  /** 0.2 for a mix, 2 (either way) for a z. */
  threshold: number;
  drifted: boolean;
  enough: boolean;
  /** The backend's own sentence: `z +2.24 past ±2`, `not enough runs with a confidence: …`. */
  says: string;
  /** A mix: {counts, shares, n}; a mean: {mean, sd, n}; a rate: {rate, runs_with, n}; empty when there was nothing to read. */
  recent: Record<string, unknown>;
  baseline: Record<string, unknown>;
  /** disposition_mix: the field read (the spec's outcome field, or `state`). */
  field: string | null;
}

export interface AgentDrift {
  agent: string;
  recent: DriftWindow;
  baseline: DriftWindow;
  /** Enough runs in both windows; without, no measures. */
  enough: boolean;
  says: string;
  drifted: boolean;
  /** The spec's declared outcome field (its evals' `compare`), or null when the final state is read instead. */
  outcome_field: string | null;
  measures: DriftMeasure[];
  /**
   * L8: the recent window against the benchmark of the digest production
   * runs, when that digest has an eval on its suite; null otherwise. It
   * counts toward `drifted` even when the trailing baseline has too few
   * runs (`enough` false above).
   */
  benchmark: BenchmarkDrift | null;
}

/** The eval drift is read against: what production runs, measured on its own suite. */
export type BenchmarkEval = {
  id: string;
  digest: string;
  version: number | null;
  set: string;
  at: string;
  /** Cases on the benchmark: the baseline of `benchmark_outcomes`. */
  cases: number;
  /** A labeled set: `benchmark_labels` reads against its labels too. */
  labeled: boolean;
};

/** `AgentDrift.benchmark` (L8): the recent window's dispositions against the benchmark's outcomes, and its labels for a labeled set. */
export interface BenchmarkDrift {
  eval: BenchmarkEval;
  /** Enough recent runs to read (fewer than `min_recent` says so, and raises nothing). */
  enough: boolean;
  says: string;
  drifted: boolean;
  /** benchmark_outcomes, and benchmark_labels for a labeled set: each a Jensen–Shannon distance past 0.2. */
  measures: DriftMeasure[];
}

/** `GET /api/drift` */
export interface DriftReport {
  agents: AgentDrift[];
  count: number;
  now: string;
  /** `{mix_js, mean_z}`; a rate's z threshold is the mean's. */
  thresholds: Record<string, number>;
  /** `{recent, baseline}`: the runs each window needs. */
  min_runs: Record<string, number>;
  /** `{recent_h, baseline_d}`. */
  windows: Record<string, number>;
}

function windowOf(v: unknown): DriftWindow {
  const o = obj(v);
  return { since: str(o.since), until: str(o.until), runs: num(o.runs) };
}

export function measureOf(v: unknown): DriftMeasure {
  const o = obj(v);
  const kind = pick(o.kind, ["mix", "mean", "rate"] as const, "mix");
  return {
    name: pick(o.name, MEASURE_NAMES, "tool_mix"),
    kind,
    statistic: pick(o.statistic, ["jensen_shannon", "welch_z", "proportion_z"] as const, kind === "mix" ? "jensen_shannon" : kind === "mean" ? "welch_z" : "proportion_z"),
    distance: numOrNull(o.distance),
    z: numOrNull(o.z),
    threshold: num(o.threshold, kind === "mix" ? 0.2 : 2),
    drifted: o.drifted === true,
    enough: o.enough !== false,
    says: str(o.says),
    recent: obj(o.recent),
    baseline: obj(o.baseline),
    field: strOrNull(o.field),
  };
}

export function agentDriftOf(v: unknown): AgentDrift {
  const o = obj(v);
  return {
    agent: str(o.agent),
    recent: windowOf(o.recent),
    baseline: windowOf(o.baseline),
    enough: o.enough === true,
    says: str(o.says),
    drifted: o.drifted === true,
    outcome_field: strOrNull(o.outcome_field),
    measures: (Array.isArray(o.measures) ? o.measures : []).map(measureOf),
    benchmark: benchmarkDriftOf(o.benchmark),
  };
}

export function benchmarkEvalOf(v: unknown): BenchmarkEval {
  const o = obj(v);
  return { id: str(o.id), digest: str(o.digest), version: numOrNull(o.version), set: str(o.set), at: str(o.at), cases: num(o.cases), labeled: o.labeled === true };
}

export function benchmarkDriftOf(v: unknown): BenchmarkDrift | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = obj(v);
  return { eval: benchmarkEvalOf(o.eval), enough: o.enough === true, says: str(o.says), drifted: o.drifted === true, measures: (Array.isArray(o.measures) ? o.measures : []).map(measureOf) };
}

const numbers = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const [k, x] of Object.entries(obj(v))) if (typeof x === "number" && Number.isFinite(x)) out[k] = x;
  return out;
};

export function driftOf(v: unknown): DriftReport {
  const o = obj(v);
  const agents = (Array.isArray(o.agents) ? o.agents : []).map(agentDriftOf).filter((a) => a.agent);
  return { agents, count: num(o.count, agents.length), now: str(o.now), thresholds: numbers(o.thresholds), min_runs: numbers(o.min_runs), windows: numbers(o.windows) };
}

/** A mix's side as the console reads it; empty when the side is not a mix. */
export function mixSideOf(v: Record<string, unknown>): MixSide {
  return { counts: numbers(v.counts), shares: numbers(v.shares), n: num(v.n) };
}

export function meanSideOf(v: Record<string, unknown>): MeanSide | null {
  return typeof v.mean === "number" ? { mean: v.mean, sd: num(v.sd), n: num(v.n) } : null;
}

export function rateSideOf(v: Record<string, unknown>): RateSide | null {
  return typeof v.rate === "number" ? { rate: v.rate, runs_with: num(v.runs_with), n: num(v.n) } : null;
}

/* ═══════════════════ the guardian ═══════════════════ */

/** hold: at the run's next gate; block: kill it and what it set off; redirect (L8): its reason handed to the run as guidance at its next model call. */
export type GuardianAct = "hold" | "block" | "redirect";
export const GUARDIAN_ACTS: GuardianAct[] = ["hold", "block", "redirect"];

/** What it has done since this backend instance started (kept in memory, not on the record). */
export interface GuardianStats {
  evaluations: number;
  ok: number;
  acted: number;
  attention: number;
  /** Answers that were not exactly a verdict: read as ok, never acted on. */
  unparseable: number;
  /** Model calls that failed. */
  errors: number;
  /** Verdicts already acted on or raised for that run. */
  repeated: number;
  /** Runs being watched now. */
  watching: number;
}

/** `GET /api/guardian`, and what `PUT` answers. */
export interface GuardianView {
  enabled: boolean;
  /** "" is the deployment's default model. */
  model: string;
  /** Agent ids, or "*" for every agent. */
  agents: string[] | "*";
  may: GuardianAct[];
  max_actions_per_hour: number;
  min_confidence: number;
  rubric: string;
  /** Judge a run once this many new entries have landed since it was last judged… */
  every_entries: number;
  /** …or once this many seconds have passed with at least one. */
  every_s: number;
  set_by: string;
  set_at: string;
  /** The audit event that set this configuration, on the IAM page's trail. */
  audit_id: number | null;
  /** Acts in the last hour, against `max_actions_per_hour` (counted from the table). */
  actions_last_hour: number;
  stats: GuardianStats;
}

/** The guardian's limits a change may name; a field left out keeps its value. Since L9 they are proposed through the policy door (target `guardian`). */
export type GuardianPatch = Partial<Pick<GuardianView, "enabled" | "model" | "agents" | "may" | "max_actions_per_hour" | "min_confidence" | "rubric" | "every_entries" | "every_s">>;

/** One row of `GET /api/guardian/actions`: a verdict it acted on, or one it raised for a person instead. */
export interface GuardianAction {
  id: string;
  at: string;
  run: string;
  agent: string;
  /** The verdict the model gave: hold, block or redirect. */
  verdict: string;
  confidence: number;
  reason: string;
  model: string;
  /** What it did, or would have done. */
  action: GuardianAct;
  /** acted: the hold, the kill or the redirect landed on the run. attention: outside its limits, raised for a person. */
  outcome: "acted" | "attention";
  /** Why it only raised attention: an action it may not take, the hourly cap, confidence under the floor. */
  why: string;
  /** Journal entries it had read when it judged. */
  entries: number;
  source: string;
}

export function guardianStatsOf(v: unknown): GuardianStats {
  const o = obj(v);
  return {
    evaluations: num(o.evaluations),
    ok: num(o.ok),
    acted: num(o.acted),
    attention: num(o.attention),
    unparseable: num(o.unparseable),
    errors: num(o.errors),
    repeated: num(o.repeated),
    watching: num(o.watching),
  };
}

export function guardianOf(v: unknown): GuardianView {
  const o = obj(v);
  return {
    enabled: o.enabled === true,
    model: str(o.model),
    agents: o.agents === "*" ? "*" : strs(o.agents),
    may: strs(o.may).filter((x): x is GuardianAct => GUARDIAN_ACTS.includes(x as GuardianAct)),
    max_actions_per_hour: num(o.max_actions_per_hour, 10),
    min_confidence: num(o.min_confidence, 0.8),
    rubric: str(o.rubric),
    every_entries: num(o.every_entries, 5),
    every_s: num(o.every_s, 15),
    set_by: str(o.set_by),
    set_at: str(o.set_at),
    audit_id: typeof o.audit_id === "number" && Number.isFinite(o.audit_id) ? o.audit_id : null,
    actions_last_hour: num(o.actions_last_hour),
    stats: guardianStatsOf(o.stats),
  };
}

export function guardianActionOf(v: unknown): GuardianAction {
  const o = obj(v);
  return {
    id: str(o.id),
    at: str(o.at),
    run: str(o.run),
    agent: str(o.agent),
    verdict: str(o.verdict),
    confidence: num(o.confidence),
    reason: str(o.reason),
    model: str(o.model),
    action: pick(o.action, GUARDIAN_ACTS, "hold"),
    outcome: o.outcome === "acted" ? "acted" : "attention",
    why: str(o.why),
    entries: num(o.entries),
    source: str(o.source),
  };
}

/* ═══════════════════ calls ═══════════════════ */

/**
 * One request to an L7 door. A refusal is a DoorError carrying the body,
 * with the `Retry-After` header folded in on a 429 (`retry_after_header`)
 * so rateLimitOf reads it either way; a bare 404 or 502 means no backend
 * answered the door.
 */
async function call<T>(method: "GET" | "POST" | "PUT", path: string, body: unknown, parse: (v: unknown) => T): Promise<T> {
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
    const page = typeof json !== "object" || json === null;
    const message = errorText(page ? (text.trimStart().startsWith("<") ? null : text) : json, res, method, path);
    const b = obj(json);
    const retry = res.headers?.get?.("retry-after") ?? null;
    throw new DoorError(message, res.status, res.status === 429 && retry ? { ...b, retry_after_header: retry } : b);
  }
  return parse(json);
}

const runPath = (id: string) => `/api/runs/${encodeURIComponent(id)}`;

/** `GET /api/runs/{id}/tree`: the whole tree under one trace, from the orchestrator down. 404 for an unknown run; 403 for a key scoped to another agent. */
export async function getRunTree(id: string): Promise<RunTree> {
  return call("GET", `${runPath(id)}/tree`, undefined, treeOf);
}

/**
 * `POST /api/runs/{id}/kill` with `{reason}`: the run where it runs and
 * everything it set off. 202 with the receipt (`delivery: tree` when the
 * run itself had ended, or was already stopping, and the kill reached
 * something new; `already` what an earlier kill is still stopping). 409
 * `KillRefused` when it reached nothing new: read it with killRefusalOf,
 * which tells "already being stopped" from "nothing in flight".
 */
export async function killRun(id: string, reason: string): Promise<KillReceipt> {
  return call("POST", `${runPath(id)}/kill`, { reason }, (j) => killReceiptOf(j, id));
}

/** `GET /api/dependencies?window=`: 30m, 24h, 7d, at most 90d (else 400, field `window`). */
export async function getDependencies(window = "7d"): Promise<DepMap> {
  return call("GET", `/api/dependencies?window=${encodeURIComponent(window)}`, undefined, depMapOf);
}

/**
 * A node id as the path the blast-radius door routes: each segment encoded,
 * the slashes kept (`model:meta/llama-3-70b` → `model%3Ameta/llama-3-70b`).
 * The door's route is `/{node:path}/blast-radius`, so an id with a slash is
 * asked like any other.
 */
export function nodePath(id: string): string {
  return id.split("/").map(encodeURIComponent).join("/");
}

/** `GET /api/dependencies/{node}/blast-radius?window=`: 403 for a key scoped to one agent, 404 for no such node, 409 (`AmbiguousNode`, its `candidates`) for a bare name several nodes carry. */
export async function getBlastRadius(node: string, window = "7d"): Promise<BlastRadius> {
  return call("GET", `/api/dependencies/${nodePath(node)}/blast-radius?window=${encodeURIComponent(window)}`, undefined, blastOf);
}

/** The candidates a 409 names, when the blast radius was asked by a bare name several nodes carry. */
export function candidatesOf(e: unknown): string[] {
  return e instanceof DoorError ? strs(e.body.candidates) : [];
}

/** `GET /api/drift?agent=`: per agent, the last day against the thirty before it. */
export async function getDrift(agent?: string): Promise<DriftReport> {
  return call("GET", agent ? `/api/drift?agent=${encodeURIComponent(agent)}` : "/api/drift", undefined, driftOf);
}

/** `GET /api/guardian`: the limits a person set, and what it has done since this backend started. */
export async function getGuardian(): Promise<GuardianView> {
  return call("GET", "/api/guardian", undefined, guardianOf);
}

/**
 * `PUT /api/guardian` (configure). Refused since L9: it answers 409 naming the
 * policy door, and its answer here is that DoorError. The Guardian page proposes
 * instead (`proposePolicyChange`, lib/api/l9.ts); only the contract tests call this.
 */
export async function setGuardian(patch: GuardianPatch): Promise<GuardianView> {
  return call("PUT", "/api/guardian", patch, guardianOf);
}

/** `GET /api/guardian/actions?run=&limit=`: newest first. */
export async function listGuardianActions(opts: { run?: string; limit?: number } = {}): Promise<{ actions: GuardianAction[]; count: number }> {
  const q = new URLSearchParams();
  if (opts.run) q.set("run", opts.run);
  if (opts.limit) q.set("limit", String(opts.limit));
  const qs = q.toString();
  return call("GET", `/api/guardian/actions${qs ? `?${qs}` : ""}`, undefined, (j) => {
    const o = obj(j);
    const actions = (Array.isArray(o.actions) ? o.actions : []).map(guardianActionOf).filter((a) => a.id);
    return { actions, count: num(o.count, actions.length) };
  });
}

/** A DoorError's 429, read as a rate limit (the body, and the header folded in). */
export function rateLimitOfError(e: unknown): RateLimit | null {
  if (!(e instanceof DoorError)) return null;
  return rateLimitOf(e.status, e.body, str(e.body.retry_after_header) || null);
}
