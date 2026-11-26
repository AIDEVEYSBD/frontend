import type { BlastRadius, DepEdge, DepKind, DepMap, DepNode } from "./api/l7";

/**
 * The dependency map as the console lays it out, and a node's blast radius
 * as it reads. Pure: components/dependencies.tsx renders these,
 * tests/l7-logic.test.ts holds them.
 *
 * Edges point from what depends to what it depends on (an agent to the tool
 * it calls, the sub-agent it invokes, the peer it hands work to, the model
 * it uses; an application to its model), except `serves`, which points
 * from a server or connector to the tool it serves. So the map reads left
 * to right in the direction of dependence: applications, then agents, then
 * what agents reach (models, peers, tools), then what serves the tools.
 */

/* ═══════════════════ layers ═══════════════════ */

export interface Layer {
  key: "applications" | "agents" | "reached" | "serving";
  title: string;
  /** Node kinds in this column, in the order their groups stack. */
  kinds: DepKind[];
}

export const LAYERS: Layer[] = [
  { key: "applications", title: "Applications", kinds: ["application"] },
  { key: "agents", title: "Agents", kinds: ["agent"] },
  { key: "reached", title: "Models, peers and tools", kinds: ["model", "peer", "tool"] },
  { key: "serving", title: "Servers and connectors", kinds: ["server", "connector"] },
];

export const KIND_TITLE: Record<DepKind, string> = {
  application: "Applications",
  agent: "Agents",
  model: "Models",
  peer: "Peers",
  tool: "Tools",
  server: "Tool servers",
  connector: "Connectors",
};

export const KIND_ONE: Record<DepKind, string> = {
  application: "application",
  agent: "agent",
  model: "model",
  peer: "peer",
  tool: "tool",
  server: "tool server",
  connector: "connector",
};

/** The name a node's id carries (`tool:casedesk.lookup` → `casedesk.lookup`). */
export const nameOf = (id: string): string => (id.includes(":") ? id.slice(id.indexOf(":") + 1) : id);

/**
 * What to call a node on the map. An agent's label is its spec's name,
 * which several agents may share, so its id is the name and the label the
 * subtitle when they differ; everything else goes by its label.
 */
export function nodeTitle(n: Pick<DepNode, "id" | "kind" | "label">): { title: string; subtitle: string } {
  const name = nameOf(n.id);
  if (n.kind === "agent") return { title: name, subtitle: n.label && n.label !== name ? n.label : "" };
  return { title: n.label || name, subtitle: n.label && n.label !== name ? name : "" };
}

export interface LayerGroup {
  kind: DepKind;
  title: string;
  nodes: DepNode[];
}

export interface LayerColumn extends Layer {
  groups: LayerGroup[];
  count: number;
}

/** The map's nodes in columns by layer, each column in groups by kind, each group by name. Empty groups are left out; empty columns stay, so the layout is stable. */
export function groupByLayer(map: Pick<DepMap, "nodes">): LayerColumn[] {
  return LAYERS.map((layer) => {
    const groups = layer.kinds
      .map((kind) => ({ kind, title: KIND_TITLE[kind], nodes: map.nodes.filter((n) => n.kind === kind).sort((a, b) => nodeTitle(a).title.localeCompare(nodeTitle(b).title) || a.id.localeCompare(b.id)) }))
      .filter((g) => g.nodes.length > 0);
    return { ...layer, groups, count: groups.reduce((n, g) => n + g.nodes.length, 0) };
  });
}

/* ═══════════════════ health ═══════════════════ */

export type HealthTone = "ok" | "warn" | "err" | "neutral";

/** A node's health as a tone and a word: traffic (ok, degraded, failing, idle), or what rules over it (a paused agent, a blocked application, a server's pin). */
export function healthOf(health: string): { tone: HealthTone; label: string } {
  switch (health) {
    case "ok":
      return { tone: "ok", label: "healthy" };
    case "degraded":
      return { tone: "warn", label: "degraded" };
    case "failing":
      return { tone: "err", label: "failing" };
    case "idle":
      return { tone: "neutral", label: "idle in the window" };
    case "paused":
      return { tone: "warn", label: "paused" };
    case "blocked":
      return { tone: "err", label: "blocked" };
    case "pending":
      return { tone: "warn", label: "pin pending approval" };
    case "changed":
      return { tone: "err", label: "tool list changed" };
    case "refused":
      return { tone: "err", label: "refused by the screener" };
    case "not_measured":
      return { tone: "neutral", label: "not measured" };
    default:
      return { tone: "neutral", label: health || "unknown" };
  }
}

/* ═══════════════════ edges ═══════════════════ */

export const EDGE_KIND_TEXT: Record<DepEdge["kind"], string> = {
  calls: "calls",
  sub_run: "invokes",
  peer: "hands work to",
  uses_model: "uses",
  serves: "serves",
};

/** The evidence for an edge: the specs declare it, the journals show it, or both. Seen without being declared is the one to read twice. */
export const EVIDENCE_TEXT: Record<DepEdge["evidence"], string> = {
  both: "declared and seen",
  declared: "declared, not seen in the window",
  seen: "seen, not declared by any spec",
};

export interface EdgeLook {
  /** The stroke's dash pattern; none for an edge the journals show. */
  dash: string | undefined;
  tone: "line" | "warn" | "err";
  /** 1 to 3.5, by how often it was used (log scale). */
  width: number;
}

/** How an edge is drawn: dashed when only declared, amber when only seen, red when calls through it failed or were refused. */
export function edgeLook(e: Pick<DepEdge, "evidence" | "failures" | "refusals" | "count">): EdgeLook {
  const tone = e.failures > 0 || e.refusals > 0 ? "err" : e.evidence === "seen" ? "warn" : "line";
  return { dash: e.evidence === "declared" ? "4 4" : undefined, tone, width: Math.min(3.5, 1 + Math.log10(1 + Math.max(0, e.count)) * 1.2) };
}

/**
 * For a picked node, its edges in the direction of dependence: what it
 * depends on, and what depends on it. A `serves` edge reads the other way
 * round: a tool depends on the server that serves it.
 */
export function adjacency(map: Pick<DepMap, "edges">, id: string): { dependsOn: { edge: DepEdge; other: string }[]; dependedOnBy: { edge: DepEdge; other: string }[] } {
  const dependsOn: { edge: DepEdge; other: string }[] = [];
  const dependedOnBy: { edge: DepEdge; other: string }[] = [];
  for (const e of map.edges) {
    const serves = e.kind === "serves";
    if (e.from === id) (serves ? dependedOnBy : dependsOn).push({ edge: e, other: e.to });
    if (e.to === id) (serves ? dependsOn : dependedOnBy).push({ edge: e, other: e.from });
  }
  const order = (a: { edge: DepEdge; other: string }, b: { edge: DepEdge; other: string }) => b.edge.count - a.edge.count || a.other.localeCompare(b.other);
  return { dependsOn: dependsOn.sort(order), dependedOnBy: dependedOnBy.sort(order) };
}

/** The ends an edge is drawn between, in the direction of dependence (a `serves` edge from the tool to its server). */
export function drawnEnds(e: Pick<DepEdge, "from" | "to" | "kind">): { from: string; to: string } {
  return e.kind === "serves" ? { from: e.to, to: e.from } : { from: e.from, to: e.to };
}

/** An edge's figures in one line: how often, what a model edge cost ("no price set" for the models named), what failed or was refused. */
export function edgeLine(e: Pick<DepEdge, "count" | "cost" | "failures" | "refusals" | "kind"> & { unpriced?: string[] }, fmtUsd: (n: number) => string): string {
  const unit = e.kind === "sub_run" ? "sub-run" : "call";
  const parts = [`${e.count} ${unit}${e.count === 1 ? "" : "s"}`];
  // Only a model edge carries a cost. A null one with unpriced models had calls with no price set; with no calls there is nothing to price.
  // Other edges keep no cost figure (a sub-run's cost is on its run; a tool or peer call has no model cost of its own), and none is shown.
  if (e.kind === "uses_model") {
    if (e.cost === null) {
      if (e.unpriced?.length) parts.push(`no price set for ${e.unpriced.join(", ")}`);
      else if (e.count > 0) parts.push("no price set");
    } else if (e.cost > 0) parts.push(fmtUsd(e.cost));
  }
  if (e.failures) parts.push(`${e.failures} failed`);
  if (e.refusals) parts.push(`${e.refusals} refused`);
  return parts.join(" · ");
}

/* ═══════════════════ the blast radius ═══════════════════ */

/** A path of node ids as names: `Case desk → casedesk.lookup → gamma`. */
export function pathText(via: string[], nodes: ReadonlyMap<string, Pick<DepNode, "id" | "kind" | "label">>): string {
  return via.map((id) => { const n = nodes.get(id); return n ? nodeTitle(n).title : nameOf(id); }).join(" → ");
}

/** The counts in a sentence: agents (direct and through another agent), runs in flight, applications. */
export function blastCountsLine(b: Pick<BlastRadius, "counts">): string {
  const c = b.counts;
  const agents = c.agents ? `${c.agents} agent${c.agents === 1 ? "" : "s"} (${c.direct} direct, ${c.transitive} through another agent)` : "no agent";
  return `${agents} · ${c.runs_in_flight} run${c.runs_in_flight === 1 ? "" : "s"} in flight · ${c.applications} application${c.applications === 1 ? "" : "s"}`;
}

export const USES_TEXT: Record<"direct" | "transitive" | "called", string> = {
  direct: "its agent depends on it directly",
  transitive: "its agent depends on it through another agent",
  called: "only its journal ties it: it already called the node",
};

export const APP_CLASS_TEXT: Record<string, string> = { chatbot: "chatbot", rag: "RAG app", agent: "agent", multi_agent: "multi-agent system" };
export const APP_SOURCE_TEXT: Record<string, string> = { application: "registered application", workflow: "workflow", attached: "attached agent" };

/** Every node a blast radius passes through, the failing node included: what the map lights up. */
export function blastIds(b: Pick<BlastRadius, "node" | "agents" | "applications">): Set<string> {
  const out = new Set<string>([b.node.id]);
  for (const a of b.agents) for (const id of a.via) out.add(id);
  for (const a of b.applications) if (a.via) out.add(a.via);
  return out;
}

/** A refusal from the blast-radius door, in the reader's words. A 409's candidates are offered beside it. */
export function blastRefusalText(status: number, message: string): string {
  if (status === 403) return "A key scoped to one agent cannot read a blast radius.";
  if (status === 404) return `${message || "No such node"}; read the map again.`;
  return message;
}
