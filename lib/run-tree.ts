import type { Figures, KillInfo, KillReceipt, KillRefusal, Reached, RunTree, TreeNode } from "./api/l7";
import { looksLikeRecordId } from "./api/l5";

/**
 * The run tree as the console lays it out, and the kill that reaches it.
 * Pure: components/run-tree.tsx renders these, tests/l7-logic.test.ts holds
 * them.
 *
 * The backend serves a tree as a flat list in the order it found things
 * (each record, then its in-process sub-runs and peer leaves; children by
 * parent link come after their parent, a record sharing the trace after
 * everything linked), with `parent` saying where each hangs. The outline
 * here is depth-first under the root, siblings in the backend's order, with
 * the guide lines an indented tree needs. Only `kind: run` nodes are
 * records: a sub-run runs inside its parent's tool call and is read off its
 * parent's journal, a peer leaf is a task handed to another agent, and
 * neither has a page of its own.
 */

/* ═══════════════════ figures ═══════════════════ */

/** Dollars, to the precision a run's cost needs: two significant figures under a cent, cents above; `$0` for nothing. */
export function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  const a = Math.abs(n);
  if (a < 0.0001) return "<$0.0001";
  if (a < 0.01) return `$${Number(n.toPrecision(2))}`;
  if (a < 100) return `$${n.toFixed(2)}`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export function fmtCount(n: number): string {
  return n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A node's figures in one line: cost, tokens, tool calls, refusals (the last only when there are any). */
export function figuresLine(f: Figures): string {
  const parts = [fmtUsd(f.cost), `${fmtCount(f.tokens)} tokens`, plural(f.tool_calls, "tool call")];
  if (f.refusals) parts.push(plural(f.refusals, "refusal"));
  return parts.join(" · ");
}

/**
 * Whether a record's runs-list row says something its own figures do not:
 * the row covers the record's whole journal, its in-process sub-runs
 * folded in, so an orchestrator whose work ran in sub-runs costs nothing
 * here and something there. Shown beside the node then, so the run page and
 * the runs list agree; a row that says the same is not repeated.
 */
export function listedDiffers(n: Pick<TreeNode, "listed" | "cost" | "tokens" | "tool_calls" | "refusals">): boolean {
  const l = n.listed;
  if (!l) return false;
  return Math.abs(l.cost - n.cost) > 1e-12 || l.tokens !== n.tokens || l.tool_calls !== n.tool_calls || l.refusals !== n.refusals;
}

/* ═══════════════════ the outline ═══════════════════ */

export interface TreeRow {
  node: TreeNode;
  /** 0 for the root; one more than its parent's. */
  level: number;
  /** For each level above this row's, whether that ancestor has siblings still to come below (a guide line runs through). */
  guides: boolean[];
  /** The last child of its parent: its elbow closes. */
  last: boolean;
  /** Direct children. */
  children: number;
  /** Every node under it. */
  descendants: number;
  /** The run the page is about. */
  asked: boolean;
  /** A record, with a page of its own. */
  record: boolean;
  /** Its parent is not in the tree (it was cut by the 500-node limit, or the record is torn): hung under the root. */
  stray: boolean;
}

/** Whether a node is a record a run page can open (`/runs?id=`). */
export const isRecordNode = (n: Pick<TreeNode, "kind">): boolean => n.kind === "run";

/** The page a node opens, or null: sub-runs and peer leaves have none. */
export function nodeHref(n: Pick<TreeNode, "kind" | "run">): string | null {
  return isRecordNode(n) ? `/runs?id=${encodeURIComponent(n.run)}` : null;
}

/**
 * Depth-first rows under the root. Children keep the backend's order. A
 * node whose parent the tree does not hold hangs under the root (`stray`);
 * a node met twice (a cycle in torn data) is drawn once.
 */
export function treeRows(tree: Pick<RunTree, "root" | "asked" | "nodes">): TreeRow[] {
  const byId = new Map<string, TreeNode>();
  for (const n of tree.nodes) if (!byId.has(n.run)) byId.set(n.run, n);
  const root = byId.get(tree.root) ?? tree.nodes.find((n) => n.parent === null) ?? tree.nodes[0];
  if (!root) return [];
  const kids = new Map<string, TreeNode[]>();
  const stray = new Set<string>();
  for (const n of byId.values()) {
    if (n === root) continue;
    let p = n.parent ?? "";
    if (!p || !byId.has(p) || p === n.run) {
      stray.add(n.run);
      p = root.run;
    }
    kids.set(p, [...(kids.get(p) ?? []), n]);
  }
  const seen = new Set<string>();
  const count = (id: string, guard: Set<string>): number => {
    let total = 0;
    for (const c of kids.get(id) ?? []) {
      if (guard.has(c.run)) continue;
      total += 1 + count(c.run, new Set([...guard, c.run]));
    }
    return total;
  };
  const rows: TreeRow[] = [];
  const walk = (n: TreeNode, level: number, guides: boolean[], last: boolean) => {
    if (seen.has(n.run)) return;
    seen.add(n.run);
    const children = (kids.get(n.run) ?? []).filter((c) => !seen.has(c.run));
    rows.push({ node: n, level, guides, last, children: children.length, descendants: count(n.run, new Set([n.run])), asked: n.run === tree.asked, record: isRecordNode(n), stray: stray.has(n.run) });
    children.forEach((c, i) => walk(c, level + 1, level === 0 ? [] : [...guides, !last], i === children.length - 1));
  };
  walk(root, 0, [], true);
  // Anything a cycle kept out of the walk still shows, under the root.
  for (const n of byId.values()) if (!seen.has(n.run)) walk(n, 1, [], true);
  return rows;
}

/** What a node is, in a word or two. */
export function nodeKindLabel(n: Pick<TreeNode, "kind" | "link" | "parent">): string {
  if (n.kind === "sub_run") return "sub-run";
  if (n.kind === "peer") return "peer task";
  if (n.parent === null || n.link === "root") return "orchestrator";
  return n.link === "trace" ? "same trace" : "child run";
}

/** How the node is known to be in the tree, for the hover. */
export function nodeLinkText(n: Pick<TreeNode, "kind" | "link" | "parent" | "agent">): string {
  if (n.kind === "sub_run") return "An in-process sub-run: it ran inside its parent's tool call, on its parent's cancel, and has no record of its own; its entries are in the parent's journal.";
  if (n.kind === "peer") return "A task handed to a peer agent: the journal knows the calls made and the task's last state, not the peer's own cost.";
  switch (n.link) {
    case "root":
      return "The orchestrator: the top of the parent chain.";
    case "parent":
      return "Started as its parent's child (parent_run), in the parent's trace.";
    case "trace":
      return "Shares the orchestrator's trace and names no parent the tree knows: hung under the root.";
    default:
      return "Read from its parent's journal.";
  }
}

/* ═══════════════════ the rollup ═══════════════════ */

/** Where the tree's refusals happened, from each node's own figures. */
export interface RefusalSplit {
  total: number;
  /** In the orchestrator's own entries. */
  root: number;
  /** In in-process sub-runs, at any depth. */
  subRuns: number;
  /** In child records (worker, SDK, console children, a trace's records). */
  children: number;
}

export function refusalSplit(tree: Pick<RunTree, "root" | "nodes">): RefusalSplit {
  const out: RefusalSplit = { total: 0, root: 0, subRuns: 0, children: 0 };
  for (const n of tree.nodes) {
    if (!n.refusals) continue;
    out.total += n.refusals;
    if (n.run === tree.root) out.root += n.refusals;
    else if (n.kind === "sub_run") out.subRuns += n.refusals;
    else out.children += n.refusals;
  }
  return out;
}

/** The tree's refusals in words: "2 refusals in sub-runs"; "3 refusals: 2 in sub-runs, 1 in a child run"; "no refusals". */
export function refusalLine(tree: Pick<RunTree, "root" | "nodes">): string {
  const s = refusalSplit(tree);
  if (!s.total) return "no refusals";
  const parts: string[] = [];
  if (s.root) parts.push(`${s.root} in the orchestrator`);
  if (s.subRuns) parts.push(`${s.subRuns} in sub-runs`);
  if (s.children) parts.push(`${s.children} in ${s.children === 1 ? "a child run" : "child runs"}`);
  const head = plural(s.total, "refusal");
  return parts.length === 1 ? `${head} ${parts[0].replace(/^\d+ /, "")}` : `${head}: ${parts.join(", ")}`;
}

export interface AgentRollupRow extends Figures {
  key: string;
  /** The agent's id, or the peer's name for a `peer:<name>` key. */
  label: string;
  peer: boolean;
  nodes: number;
}

/** The rollup by agent, the costliest first (then the most refused, then by name). */
export function byAgentRows(tree: Pick<RunTree, "rollup">): AgentRollupRow[] {
  return Object.entries(tree.rollup.by_agent)
    .map(([key, f]) => ({ key, label: key.startsWith("peer:") ? key.slice(5) : key, peer: key.startsWith("peer:"), ...f }))
    .sort((a, b) => b.cost - a.cost || b.refusals - a.refusals || a.key.localeCompare(b.key));
}

const LIVE = new Set(["running", "starting"]);

/** Nodes still in flight (running, or a sub-run starting): what a kill would reach. A run waiting at a gate is not killed by the tree's kill. */
export function inFlightNodes(tree: Pick<RunTree, "nodes">): TreeNode[] {
  return tree.nodes.filter((n) => n.kind !== "peer" && LIVE.has(n.state));
}

/** The tree in one line for a panel header: how many nodes, what it cost, its refusals. */
export function treeSummary(tree: RunTree): string {
  const records = tree.nodes.filter(isRecordNode).length;
  const subs = tree.nodes.filter((n) => n.kind === "sub_run").length;
  const peers = tree.nodes.filter((n) => n.kind === "peer").length;
  const shape = [plural(records, "run"), subs ? plural(subs, "sub-run") : "", peers ? plural(peers, "peer task") : ""].filter(Boolean).join(", ");
  return `${shape} · ${fmtUsd(tree.rollup.cost)} · ${fmtCount(tree.rollup.tokens)} tokens · ${plural(tree.rollup.tool_calls, "tool call")} · ${refusalLine(tree)}`;
}

/* ═══════════════════ the kill's receipt ═══════════════════ */

/** How the kill reached a run, in the reader's words. */
export const DELIVERY_TEXT: Record<string, string> = {
  "in-process": "stopped here, before its next model or tool call",
  "shared-cancel": "an in-process sub-run, stopped with the run it runs in",
  worker: "a worker's run: the kill waits on its row and lands on its next heartbeat",
  sdk: "an attached agent's run: its SDK takes the kill on its next control poll",
  queue: "a queued child job: dead-lettered, so it never starts",
  // The second round's peer tasks: a signed tasks/cancel, as the agent that sent the task, at the registry's URL.
  a2a: "a peer's task: cancelled over A2A, and the peer answered",
  "a2a-refused": "a peer's task: the cancel could not be delivered, or the peer said no",
};

export const deliveryText = (d: string): string => DELIVERY_TEXT[d] ?? `delivered: ${d || "unknown"}`;

/** Whether a reached entry is a record with a page (a job's `run` is the job's id; a sub-run has none; anything not shaped like a run id has none either). */
export const isRecordReached = (r: Pick<Reached, "kind" | "run">): boolean => r.kind === "run" && looksLikeRecordId(r.run);

/** What a reached entry is, in a word or two. A delivery over A2A is a peer's task, whatever kind a newer backend names it. */
export function reachedKindLabel(r: Pick<Reached, "kind" | "delivery" | "depth">): string {
  if (r.kind === "peer_task" || r.delivery.startsWith("a2a")) return "peer task";
  if (r.kind === "sub_run") return "sub-run";
  if (r.kind === "job") return "queued job";
  return r.depth === 0 ? "this run" : "child run";
}

/**
 * The peer's answer to a delivered cancel: `answered_state` since the
 * backend's L8 polish split it from `state` (the task's last state this side
 * saw); a receipt from before the split carried the answer in `state`. ""
 * when the cancel was not delivered.
 */
export function answerOf(r: Pick<Reached, "delivery" | "state" | "answered_state">): string {
  if (r.delivery !== "a2a") return "";
  return r.answered_state ?? r.state;
}

/**
 * A peer task's line: the peer and its task, what the peer answered and the
 * state this side last saw it in, and why the cancel did not reach it when
 * it did not. The peer's id is the registry's, so the Peers page names the
 * same one.
 */
export function peerTaskLine(r: Pick<Reached, "kind" | "delivery" | "agent" | "peer" | "task_id" | "error" | "state" | "answered_state">): string {
  if (r.kind !== "peer_task" && !r.delivery.startsWith("a2a")) return "";
  const who = r.peer || r.agent || "a peer";
  const task = r.task_id ? `task ${r.task_id} at ${who}` : `a task at ${who}`;
  if (r.delivery === "a2a") {
    const answer = answerOf(r);
    // A delivered cancel whose answer named no state: the backend does not assume it stopped, so a later kill asks again.
    if (!answer || answer === "unknown") return `${task}: the cancel was delivered and the peer named no state; a later kill asks again`;
    const seen = r.answered_state !== null && r.state && r.state !== answer ? ` (last seen ${r.state})` : "";
    return `${task}: cancelled, the peer answered ${answer}${seen}`;
  }
  return `${task}: not cancelled${r.error ? `: ${r.error}` : ""}${r.state ? ` (last seen ${r.state})` : ""}`;
}

/** What a reached row's state says, beside it: a job's new status, a peer's answer, a run's state when the kill reached it, or (under `already`) its state now. */
export function reachedStateText(r: Pick<Reached, "kind" | "delivery" | "state" | "kill" | "answered_state">): string {
  const st = r.state || "?";
  if (r.kill) return `still ${st}`;
  if (r.kind === "job") return st === "failed" ? "dead-lettered, now failed" : `now ${st}`;
  if (r.kind === "peer_task" || r.delivery.startsWith("a2a")) {
    if (r.delivery !== "a2a") return `last seen ${st}`;
    const answer = answerOf(r);
    return !answer || answer === "unknown" ? "answered without a state" : `answered ${answer}`;
  }
  return `was ${st}`;
}

/** A tree peer node's delivered cancel in a line (L8 polish: `peer.cancel`), or "" when none landed. */
export function peerCancelLine(p: { cancel: { state: string; by: string; reason: string; delivery: string } | null } | null): string {
  const c = p?.cancel;
  if (!c) return "";
  return `cancelled over A2A${c.by ? ` by ${c.by}` : ""}${c.reason ? ` (${c.reason})` : ""}; the peer answered ${c.state || "without a state"}`;
}

/** An earlier kill in words: `by Ann (runaway tree)`. */
export function killByText(k: Pick<KillInfo, "by" | "reason"> | null): string {
  if (!k) return "an earlier kill";
  return `${k.by ? `by ${k.by}` : "an earlier kill"}${k.reason ? ` (${k.reason})` : ""}`;
}

/** The earlier kills the `already` rows are stopping on, each once: who and why. */
function earlierKills(rows: readonly Reached[]): string {
  const seen = new Map<string, KillInfo | null>();
  for (const r of rows) seen.set(r.kill ? `${r.kill.by}\u0000${r.kill.reason}` : "", r.kill);
  return [...seen.values()].map(killByText).join("; ");
}

const recordsOf = (rows: readonly Reached[]) => rows.filter((r) => r.kind !== "sub_run");

/**
 * A kill that reached nothing new (409 `KillRefused`), as the console says
 * it: already being stopped, by whom and why, and how many runs are still
 * unwinding; or, with nothing in `already`, the backend's own sentence
 * (nothing in the tree is in flight).
 */
export function alreadySummary(refusal: KillRefusal): string {
  if (!refusal.already.length) return refusal.error || "Nothing in its tree is in flight.";
  const runs = recordsOf(refusal.already);
  const subs = refusal.already.length - runs.length;
  const n = runs.length;
  const what = `${n} run${n === 1 ? "" : "s"}${subs ? ` and ${subs} sub-run${subs === 1 ? "" : "s"}` : ""}`;
  return `Already being stopped: an earlier kill ${earlierKills(refusal.already)} reached ${what} in this tree, still stopping at their next checkpoint. Nothing new to reach, so nothing was sent again.`;
}

/** The reached runs grouped by how the kill reached them, in a stable order. */
export function reachedGroups(receipt: Pick<KillReceipt, "reached">): { delivery: string; label: string; runs: Reached[] }[] {
  const order = ["in-process", "shared-cancel", "worker", "sdk", "queue", "a2a", "a2a-refused"];
  const groups = new Map<string, Reached[]>();
  for (const r of receipt.reached) groups.set(r.delivery, [...(groups.get(r.delivery) ?? []), r]);
  return [...groups.entries()]
    .sort(([a], [b]) => (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b)) || a.localeCompare(b))
    .map(([delivery, runs]) => ({ delivery, label: deliveryText(delivery), runs }));
}

/**
 * The receipt in one line: whom the kill reached and how. With `delivery:
 * tree` the run itself had already ended, and the kill reached what it set
 * off.
 */
export function killSummary(receipt: KillReceipt): string {
  const others = receipt.reached.filter((r) => r.run !== receipt.run);
  const count = (d: string, one: string, many: string) => {
    const n = others.filter((r) => r.delivery === d).length;
    return n ? `${n} ${n === 1 ? one : many}` : "";
  };
  const parts = [
    count("shared-cancel", "sub-run on its cancel", "sub-runs on its cancel"),
    count("in-process", "child run here", "child runs here"),
    count("worker", "worker run on its next heartbeat", "worker runs on their next heartbeat"),
    count("sdk", "SDK run on its next control poll", "SDK runs on their next control poll"),
    count("queue", "queued job dead-lettered", "queued jobs dead-lettered"),
    count("a2a", "peer task cancelled over A2A", "peer tasks cancelled over A2A"),
    count("a2a-refused", "peer task the cancel did not reach", "peer tasks the cancel did not reach"),
  ].filter(Boolean);
  const known = new Set(["shared-cancel", "in-process", "worker", "sdk", "queue", "a2a", "a2a-refused"]);
  const odd = others.filter((r) => !known.has(r.delivery)).length;
  if (odd) parts.push(`${odd} more`);
  const rest = parts.length ? parts.join(", ") : "nothing else in flight in its tree";
  const by = receipt.kill.by ? ` by ${receipt.kill.by}` : "";
  const stopping = recordsOf(receipt.already).length;
  const already = receipt.already.length ? ` ${stopping || receipt.already.length} more ${(stopping || receipt.already.length) === 1 ? "is" : "are"} already stopping on an earlier kill ${earlierKills(receipt.already)}, and ${(stopping || receipt.already.length) === 1 ? "was" : "were"} not sent another.` : "";
  if (receipt.delivery === "tree") {
    const self = receipt.already.some((r) => r.run === receipt.run);
    const head = self ? `The run is already stopping on an earlier kill; this kill${by} reached what that kill had not` : `The run itself had already ended (${receipt.state || "settled"}); the kill${by} reached what it set off`;
    return `${head}: ${rest}.${already}`;
  }
  const own = receipt.delivery === "in-process" ? "stopped here" : receipt.delivery === "worker" ? "on its worker's next heartbeat" : "on its SDK's next control poll";
  return `Kill requested${by}: the run ${own}; ${rest}.${already}`;
}
