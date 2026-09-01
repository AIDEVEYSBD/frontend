/**
 * Builder state.
 *
 * One reducer over one `AgentSystem`. Everything the canvas, the inspector and
 * the problems rail show is derived from that single document — the same
 * document that gets deployed. There is no separate "builder model" that has to
 * be translated on save, because that translation is where the divergence
 * between what you designed and what runs would live.
 *
 * The canvas starts empty on purpose. What ships is the three harnesses and the
 * capabilities; what gets built on top of them is the team's, not ours.
 */

import { CATALOGUE, TOOL_BY_ID, asTool } from "./catalogue";
import { CONNECTOR_DEF, bindingFor } from "./connections";
import { slug as slugify } from "./spec";
import type { AgentSystem, Edge, Field, HarnessKind, Node, OutputDecl, Trigger } from "./spec";
import { slug } from "./spec";

/** An empty system. The starting point, and the only one we ship. */
export const EMPTY: AgentSystem = {
  id: "untitled-agent",
  name: "Untitled agent",
  entry: "",
  nodes: [],
  edges: [],
  tools: [],
  policy: {
    grants: [],
    gates: [],
    injection: { patterns: [], prohibited_actions: [], action: "block" },
    block_tainted_sinks: true,
  },
  evals: {},
};

/* ═══════════════════ Actions ═══════════════════ */

export type Action =
  | { type: "load"; system: AgentSystem }
  | { type: "meta"; patch: Partial<Pick<AgentSystem, "id" | "name" | "owner" | "description">> }
  | { type: "add-node"; harness: HarnessKind; x: number; y: number }
  | { type: "add-node-connected"; harness: HarnessKind; x: number; y: number; from: string }
  | { type: "insert-on-edge"; harness: HarnessKind; edge: number }
  | { type: "duplicate-node"; id: string }
  | { type: "move-node"; id: string; x: number; y: number }
  | { type: "patch-node"; id: string; patch: Partial<Node> }
  | { type: "delete-node"; id: string }
  | { type: "set-entry"; id: string }
  | { type: "add-edge"; source: string; target: string }
  | { type: "patch-edge"; index: number; patch: Partial<Edge> }
  | { type: "delete-edge"; index: number }
  | { type: "connect-tool"; name: string }
  | { type: "disconnect-tool"; name: string }
  | { type: "grant"; node: string; tool: string }
  | { type: "revoke"; node: string; tool: string }
  | { type: "patch-policy"; patch: Partial<AgentSystem["policy"]> }
  | { type: "patch-evals"; patch: Partial<AgentSystem["evals"]> }
  | { type: "set-field"; node: string; side: "expects" | "emits"; fields: Field[] }
  | { type: "set-trigger"; trigger: Trigger }
  | { type: "set-outputs"; outputs: OutputDecl[] }
  | { type: "tool-config"; name: string; config: Record<string, unknown> }
  | { type: "grant-tool-card"; node: string; card: string }
  | { type: "add-connection"; tool: string; kind: string; node: string }
  | { type: "patch-connection"; server: string; slot: string; index: number; patch: Record<string, unknown> }
  | { type: "remove-connection"; server: string; slot: string; index: number }
  | { type: "add-workflow-node"; agent: string; name: string; x: number; y: number };

/* A new node of each shape, with only what that shape requires. Nothing here
   presumes a domain — the label is the harness, and the rest is the team's. */
const NEW_NODE: Record<HarnessKind, (id: string, x: number, y: number) => Node> = {
  sequence: (id, x, y) => ({
    id,
    harness: "sequence",
    label: "Step",
    x,
    y,
    steps: [{ id: "s1", action: "model", prompt: "", emits: "*" }],
    emits: [],
  }),
  delegate: (id, x, y) => ({
    id,
    harness: "delegate",
    label: "Loop",
    x,
    y,
    max_steps: 10,
    persona: "",
    emits: [],
  }),
  await: (id, x, y) => ({
    id,
    harness: "await",
    label: "Wait",
    x,
    y,
    interface: { kind: "approval", target: "", timeout_s: 86400, on_timeout: "escalate" },
    emits: [],
  }),
};

export function reduce(s: AgentSystem, a: Action): AgentSystem {
  switch (a.type) {
    case "load":
      return a.system;

    case "meta":
      return { ...s, ...a.patch };

    case "add-node": {
      const seed = { sequence: "step", delegate: "loop", await: "wait" }[a.harness];
      const id = slug(seed, new Set(s.nodes.map((n) => n.id)));
      const node = NEW_NODE[a.harness](id, a.x, a.y);
      return {
        ...s,
        nodes: [...s.nodes, node],
        // The first node on an empty canvas is the entry by default. Anything
        // else means a fresh graph is invalid until you notice why.
        entry: s.nodes.length === 0 ? id : s.entry,
        policy: { ...s.policy, grants: [...s.policy.grants, { node: id, tools: [] }] },
      };
    }

    /* The wire-out-to-empty-canvas move: the new node arrives already wired,
       so a graph grows one gesture at a time instead of add-then-hunt-then-
       connect. One reduce, so undo-by-delete stays coherent. */
    case "add-node-connected": {
      const withNode = reduce(s, { type: "add-node", harness: a.harness, x: a.x, y: a.y });
      const id = withNode.nodes[withNode.nodes.length - 1].id;
      return reduce(withNode, { type: "add-edge", source: a.from, target: id });
    }

    /* Splicing into an existing edge: a→b becomes a→new→b. The guard stays on
       the a-side, because a guard describes when work leaves its source — the
       spliced node changes where the work goes, not when it goes. */
    case "insert-on-edge": {
      const old = s.edges[a.edge];
      if (!old) return s;
      const na = s.nodes.find((n) => n.id === old.source);
      const nb = s.nodes.find((n) => n.id === old.target);
      const x = na && nb ? (na.x + nb.x) / 2 : 200;
      const y = na && nb ? (na.y + nb.y) / 2 + 28 : 200;
      const withNode = reduce(s, { type: "add-node", harness: a.harness, x, y });
      const id = withNode.nodes[withNode.nodes.length - 1].id;
      return {
        ...withNode,
        edges: [
          ...withNode.edges.filter((_, i) => i !== a.edge),
          { source: old.source, target: id, when: old.when, label: old.label },
          { source: id, target: old.target },
        ],
      };
    }

    case "duplicate-node": {
      const src = s.nodes.find((n) => n.id === a.id);
      if (!src) return s;
      const id = slug(src.label || src.id, new Set(s.nodes.map((n) => n.id)));
      const copy = { ...structuredClone(src), id, x: src.x + 36, y: src.y + 36 };
      const grant = s.policy.grants.find((g) => g.node === a.id);
      return {
        ...s,
        nodes: [...s.nodes, copy],
        policy: {
          ...s.policy,
          grants: [...s.policy.grants, { node: id, tools: [...(grant?.tools ?? [])] }],
        },
      };
    }

    case "move-node":
      return {
        ...s,
        nodes: s.nodes.map((n) => (n.id === a.id ? { ...n, x: a.x, y: a.y } : n)),
      };

    case "patch-node":
      return {
        ...s,
        nodes: s.nodes.map((n) => (n.id === a.id ? { ...n, ...a.patch } : n)),
      };

    case "delete-node": {
      const nodes = s.nodes.filter((n) => n.id !== a.id);
      return {
        ...s,
        nodes,
        edges: s.edges.filter((e) => e.source !== a.id && e.target !== a.id),
        entry: s.entry === a.id ? (nodes[0]?.id ?? "") : s.entry,
        policy: { ...s.policy, grants: s.policy.grants.filter((g) => g.node !== a.id) },
      };
    }

    case "set-entry":
      return { ...s, entry: a.id };

    case "add-edge": {
      if (a.source === a.target) return s;
      if (s.edges.some((e) => e.source === a.source && e.target === a.target)) return s;
      return { ...s, edges: [...s.edges, { source: a.source, target: a.target }] };
    }

    case "patch-edge":
      return {
        ...s,
        edges: s.edges.map((e, i) => (i === a.index ? { ...e, ...a.patch } : e)),
      };

    case "delete-edge":
      return { ...s, edges: s.edges.filter((_, i) => i !== a.index) };

    case "connect-tool": {
      if (s.tools.some((t) => t.name === a.name)) return s;
      const entry = CATALOGUE.find((t) => t.name === a.name);
      if (!entry) return s;
      return { ...s, tools: [...s.tools, asTool(entry)] };
    }

    case "disconnect-tool":
      return {
        ...s,
        tools: s.tools.filter((t) => t.name !== a.name),
        policy: {
          ...s.policy,
          grants: s.policy.grants.map((g) => ({ ...g, tools: g.tools.filter((t) => t !== a.name) })),
        },
      };

    case "grant": {
      // Granting a capability nobody connected yet connects it — the
      // alternative is a dead grant that only surfaces as an error two panels
      // away from where it was made.
      const withTool = s.tools.some((t) => t.name === a.tool)
        ? s
        : reduce(s, { type: "connect-tool", name: a.tool });
      const has = withTool.policy.grants.some((g) => g.node === a.node);
      const grants = has
        ? withTool.policy.grants.map((g) =>
            g.node === a.node && !g.tools.includes(a.tool) ? { ...g, tools: [...g.tools, a.tool] } : g,
          )
        : [...withTool.policy.grants, { node: a.node, tools: [a.tool] }];
      return { ...withTool, policy: { ...withTool.policy, grants } };
    }

    case "revoke":
      return {
        ...s,
        policy: {
          ...s.policy,
          grants: s.policy.grants.map((g) =>
            g.node === a.node ? { ...g, tools: g.tools.filter((t) => t !== a.tool) } : g,
          ),
        },
      };

    case "patch-policy":
      return { ...s, policy: { ...s.policy, ...a.patch } };

    case "patch-evals":
      return { ...s, evals: { ...s.evals, ...a.patch } };

    case "set-field":
      return {
        ...s,
        nodes: s.nodes.map((n) => (n.id === a.node ? { ...n, [a.side]: a.fields } : n)),
      };

    /* A tool card grants its underlying capabilities in one gesture. */
    case "grant-tool-card": {
      const card = TOOL_BY_ID.get(a.card);
      if (!card) return s;
      return card.capabilities.reduce(
        (acc, tool) => reduce(acc, { type: "grant", node: a.node, tool }),
        s,
      );
    }

    /* A connection is a connector card pinned beneath the agent it was
       dropped on. Granting the owning tool rides along, because a connector
       under a node that cannot use it is furniture. The same shape serves
       every tool — retrieval sources, register backends, notify transports,
       custom engines, git roots — which is the whole point of the pattern. */
    case "add-connection": {
      const def = CONNECTOR_DEF.get(`${a.tool}:${a.kind}`);
      if (!def) return s;
      let next = reduce(s, { type: "grant-tool-card", node: a.node, card: a.tool });
      const bindingName = bindingFor(next, def.server);
      if (!bindingName) return next;
      const binding = next.tools.find((t) => t.name === bindingName)!;
      const list = [...(((binding.config?.[def.slot] as Record<string, unknown>[] | undefined) ?? []))];
      const taken = new Set(list.map((x) => String(x.name ?? "")));
      const entry: Record<string, unknown> = {
        ...structuredClone(def.defaults),
        name: slugify(String(def.defaults.name ?? def.kind), taken),
        attached_to: a.node,
      };
      return reduce(next, {
        type: "tool-config",
        name: bindingName,
        config: { ...binding.config, [def.slot]: [...list, entry] },
      });
    }

    case "patch-connection":
    case "remove-connection": {
      const bindingName = bindingFor(s, a.server);
      if (!bindingName) return s;
      const binding = s.tools.find((t) => t.name === bindingName)!;
      const list = [...(((binding.config?.[a.slot] as Record<string, unknown>[] | undefined) ?? []))];
      if (a.type === "remove-connection") list.splice(a.index, 1);
      else if (list[a.index]) list[a.index] = { ...list[a.index], ...a.patch };
      return reduce(s, {
        type: "tool-config",
        name: bindingName,
        config: { ...binding.config, [a.slot]: list },
      });
    }

    /* A saved workflow lands as a node that invokes it: real chaining, not a
       picture of chaining — agent.invoke loads the saved spec and runs it. */
    case "add-workflow-node": {
      const id = slug(a.name, new Set(s.nodes.map((n) => n.id)));
      const withTool = s.tools.some((t) => t.name === "agent.invoke")
        ? s
        : reduce(s, { type: "connect-tool", name: "agent.invoke" });
      return {
        ...withTool,
        nodes: [
          ...withTool.nodes,
          {
            id,
            harness: "sequence" as const,
            label: a.name,
            x: a.x,
            y: a.y,
            emits: [{ name: "result", kind: "object" as const }],
            steps: [
              {
                id: "s1",
                action: "tool" as const,
                tool: "agent.invoke",
                args: { agent: a.agent, input: {} },
                emits: "result",
              },
            ],
          },
        ],
        entry: withTool.nodes.length === 0 ? id : withTool.entry,
        policy: {
          ...withTool.policy,
          grants: [...withTool.policy.grants, { node: id, tools: ["agent.invoke"] }],
        },
      };
    }

    case "set-trigger":
      return { ...s, trigger: a.trigger };

    case "set-outputs":
      return { ...s, outputs: a.outputs };

    case "tool-config": {
      // Config lives on every binding of the same server, so retrieval.search
      // and retrieval.fetch cannot disagree about which sources exist.
      const server = s.tools.find((t) => t.name === a.name)?.server;
      return {
        ...s,
        tools: s.tools.map((t) =>
          t.name === a.name || (server && t.server === server) ? { ...t, config: a.config } : t,
        ),
      };
    }

    default:
      return s;
  }
}

/* ═══════════════════ History ═══════════════════
   The reducer stays pure over one document; history is a wrapper around it.
   Undo is the whole-document kind — a popped snapshot is the same shape that
   deploys, so undoing can never leave a state the runtime would refuse for
   structural reasons the editor cannot reproduce. */

export interface HistoryState {
  past: AgentSystem[];
  present: AgentSystem;
  future: AgentSystem[];
  /** Node id when the last recorded action was a move — consecutive drags of
      the same node coalesce into one undo step instead of fifty. */
  lastMove?: string | null;
}

export type HistoryAction = Action | { type: "undo" } | { type: "redo" };

const MAX_PAST = 50;

export function withHistory(reduceFn: typeof reduce) {
  return (h: HistoryState, a: HistoryAction): HistoryState => {
    if (a.type === "undo") {
      if (!h.past.length) return h;
      return {
        past: h.past.slice(0, -1),
        present: h.past[h.past.length - 1],
        future: [h.present, ...h.future],
        lastMove: null,
      };
    }
    if (a.type === "redo") {
      if (!h.future.length) return h;
      return {
        past: [...h.past, h.present],
        present: h.future[0],
        future: h.future.slice(1),
        lastMove: null,
      };
    }

    const present = reduceFn(h.present, a);
    if (present === h.present) return h;
    // Loading a document is a fresh start, not an edit to walk back from.
    if (a.type === "load") return { past: [], present, future: [], lastMove: null };
    if (a.type === "move-node" && h.lastMove === a.id) {
      // Coalesce: the snapshot from before the drag began stays the target.
      return { ...h, present, future: [] };
    }
    return {
      past: [...h.past, h.present].slice(-MAX_PAST),
      present,
      future: [],
      lastMove: a.type === "move-node" ? a.id : null,
    };
  };
}
