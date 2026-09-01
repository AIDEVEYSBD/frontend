/**
 * The spec, in TypeScript.
 *
 * This mirrors `runtime/agentfactory/spec.py` field for field. The builder emits
 * this document and the runtime loads it — one shape, no translation layer, no
 * drift. Where the two could disagree, the Python side is authoritative: it runs
 * at deploy time and refuses anything malformed. This side exists to tell you
 * *while you are dragging* what the deploy is going to say, which is the only
 * moment the feedback is cheap.
 *
 * The validation rules below are not stylistic. Each one corresponds to a way
 * these graphs fail in front of a client, and the comment on each says which.
 */

import { listConnections } from "./connections";

/* ═══════════════════ The three harnesses ═══════════════════
   A harness answers one question: what decides there will be another model
   call? The plan did, the model did, or something outside did. There is no
   fourth answer, which is why this union is closed. */

export type HarnessKind = "sequence" | "delegate" | "await";

export const HARNESS_ORDER: HarnessKind[] = ["sequence", "delegate", "await"];

export const HARNESS: Record<
  HarnessKind,
  {
    name: string;
    decides: string;
    does: string;
    /** When this is the right choice — written for someone picking, not reading. */
    use: string;
    /** The mistake people make reaching for it. */
    mistake: string;
    /** Design-token colour variable, not a Tailwind class. */
    token: string;
    tint: string;
  }
> = {
  sequence: {
    name: "Pre-determined",
    decides: "The plan decides",
    does: "Runs a fixed list of steps in order.",
    use: "Anything whose shape is known before the run starts — fetch, parse, rank, score, render.",
    mistake:
      "A step calling a large model with an elaborate prompt is still pre-determined. What matters is whether the run can change what happens next, not whether inference is involved.",
    token: "--t-c2",
    tint: "--t-queue-bg",
  },
  delegate: {
    name: "Model decides",
    decides: "Inference decides",
    does: "Calls the model, reads what it wants to do, dispatches, repeats.",
    use: "Open-ended investigation where the next move genuinely depends on what the last one found.",
    mistake:
      "Reaching for this when a fixed plan would do. You buy nondeterminism and pay for it in evals that never settle.",
    token: "--t-run",
    tint: "--t-run-bg",
  },
  await: {
    name: "External decision",
    decides: "Something outside decides",
    does: "Suspends, exposes an interface, waits, resumes.",
    use: "Human approval, a webhook from a ticketing system, a schedule, a peer agent.",
    mistake:
      "Treating these as four different things. They are one mechanic with four bindings — which is also why this is where the runtime's API boundary lives.",
    token: "--t-c9",
    tint: "--t-err-bg",
  },
};

/* ═══════════════════ Types ═══════════════════ */

export type Kind = "string" | "number" | "bool" | "object" | "list" | "any";

export const KINDS: Kind[] = ["string", "number", "bool", "object", "list", "any"];

export interface Field {
  name: string;
  kind: Kind;
  required?: boolean;
  note?: string;
}

export type Risk = "read" | "write" | "risky" | "destructive";

export const RISK_ORDER: Risk[] = ["read", "write", "risky", "destructive"];

export const RISK: Record<Risk, { label: string; means: string; tone: string }> = {
  read: { label: "Read", means: "Cannot change anything outside the run.", tone: "--t-ok" },
  write: { label: "Write", means: "Changes state that can be undone without contacting anyone.", tone: "--t-c2" },
  risky: { label: "Risky", means: "Reaches a third party, spends money, or is visible outside.", tone: "--t-warn" },
  destructive: { label: "Destructive", means: "Cannot be undone. Always gated.", tone: "--t-err" },
};

export interface Tool {
  name: string;
  risk: Risk;
  server: string;
  remote_name?: string;
  summary?: string;
  /**
   * JSON-Schema-shaped argument signature, handed to the model in a `delegate`
   * node. Carried in the spec so the runtime can call a tool it has never heard
   * of — which is what makes a team's own MCP server a config change rather
   * than a runtime release.
   */
  params?: Record<string, unknown>;
  /**
   * Capability configuration — for retrieval, the list of sources. Opaque to
   * the runtime core; the service behind the endpoint interprets it. Part of
   * the digest: two agents with different sources are different agents.
   */
  config?: Record<string, unknown>;
  scope?: Record<string, string[]>;
  /** Output is untrusted content authored outside the system. */
  taints?: boolean;
  /** Acts on the outside world. Tainted input reaching one of these is the attack. */
  is_sink?: boolean;
}

export interface Step {
  id?: string;
  action: "model" | "tool";
  prompt?: string;
  tool?: string;
  args?: Record<string, unknown>;
  emits?: string;
  /**
   * A condition over the node's accumulated state. A plan containing a switch
   * is still pre-determined — every branch is known before the run starts, and
   * nothing the run discovers can add one.
   */
  when?: string;
}

/**
 * Cardinality: run this node once per item in a list.
 *
 * A binding, not a fourth harness. Fanning out does not change what decides the
 * next model call — only how many copies of that decision are in flight. It is
 * worth showing on the canvas because a node that reads as one box and runs as
 * four hundred instances is a diagram lying about its cost.
 */
export interface Fanout {
  over: string;
  as_field?: string;
  max_parallel?: number;
  collect_as?: string;
  tolerate_failures?: boolean;
}

export interface Interface {
  kind: "approval" | "webhook" | "schedule" | "agent";
  target?: string;
  timeout_s?: number;
  on_timeout?: string;
}

export interface Node {
  id: string;
  harness: HarnessKind;
  label?: string;
  persona?: string;
  model?: string;
  expects?: Field[];
  emits?: Field[];
  steps?: Step[];
  max_steps?: number;
  stop_when?: string;
  interface?: Interface;
  fanout?: Fanout;
  x: number;
  y: number;
}

export interface Edge {
  source: string;
  target: string;
  when?: string;
  label?: string;
}

export interface Grant {
  node: string;
  tools: string[];
  scope?: Record<string, Record<string, string[]>>;
}

export interface Gate {
  at_or_above: Risk;
  approvers: string[];
  nodes?: string[];
  on_timeout?: string;
}

export interface Policy {
  grants: Grant[];
  gates: Gate[];
  injection: { patterns: string[]; prohibited_actions: string[]; action: "block" | "flag" };
  block_tainted_sinks: boolean;
}

export interface Evals {
  dataset?: string;
  compare?: string;
  threshold?: number;
}

/** How a run starts. Not a harness — nothing here decides a model call. */
export interface Trigger {
  kind: "prompt" | "api" | "cron" | "webhook";
  config?: Record<string, unknown>;
}

/** What happens to the result. Also not a harness — the run has ended. */
export interface OutputDecl {
  kind: "response" | "document" | "json" | "webhook";
  from_node?: string;
  config?: Record<string, unknown>;
}

export const TRIGGER_META: Record<Trigger["kind"], { label: string; blurb: string }> = {
  prompt: { label: "Prompt", blurb: "Someone types the input and presses run." },
  api: { label: "API call", blurb: "Another system POSTs the input to this agent's endpoint." },
  cron: { label: "Schedule", blurb: "Fires on a cron expression, with no input but the clock." },
  webhook: { label: "Webhook", blurb: "An external event arrives and becomes the run input." },
};

export const OUTPUT_META: Record<OutputDecl["kind"], { label: string; blurb: string }> = {
  response: { label: "Response", blurb: "The result is returned to whoever triggered the run." },
  document: { label: "Document", blurb: "Rendered to readable Markdown and written to the outbox." },
  json: { label: "JSON file", blurb: "The raw result, written verbatim." },
  webhook: { label: "Webhook", blurb: "POSTed onward, with vault-referenced auth." },
};

export interface AgentSystem {
  id: string;
  name: string;
  owner?: string;
  description?: string;
  entry: string;
  nodes: Node[];
  edges: Edge[];
  tools: Tool[];
  policy: Policy;
  evals: Evals;
  trigger?: Trigger;
  outputs?: OutputDecl[];
}

/* ═══════════════════ Validation ═══════════════════
   Every rule here is a way one of these graphs fails at a client. The severity
   is the honest one: "error" blocks deploy because the runtime will refuse it
   anyway; "warn" ships but is a decision someone should have made on purpose. */

export type Severity = "error" | "warn";

export interface Problem {
  severity: Severity;
  /** Node or edge this attaches to, so the canvas can mark it. */
  at?: string;
  title: string;
  detail: string;
  /** What to do about it, in one clause. */
  fix?: string;
}

export function validate(s: AgentSystem): Problem[] {
  const out: Problem[] = [];
  const byId = new Map(s.nodes.map((n) => [n.id, n]));
  const toolByName = new Map(s.tools.map((t) => [t.name, t]));

  if (s.nodes.length === 0) {
    return [
      {
        severity: "error",
        title: "Nothing to run",
        detail: "This system has no nodes.",
        fix: "Drag a harness onto the canvas.",
      },
    ];
  }

  /* Duplicate ids — two nodes answering to the same name means edges are
     ambiguous and the journal cannot attribute anything. */
  const seen = new Set<string>();
  for (const n of s.nodes) {
    if (seen.has(n.id)) {
      out.push({
        severity: "error",
        at: n.id,
        title: `Two nodes are called ${n.id}`,
        detail: "Edges and journal entries address nodes by id, so a duplicate makes both ambiguous.",
        fix: "Rename one of them.",
      });
    }
    seen.add(n.id);
  }

  if (!byId.has(s.entry)) {
    out.push({
      severity: "error",
      title: "No entry point",
      detail: `The entry is set to "${s.entry}", which is not a node on this canvas.`,
      fix: "Mark a node as the entry point.",
    });
  }

  /* Unreachable nodes. Almost always a node dragged out and never wired —
     which at a client looks like a stage that silently did nothing. */
  const reachable = new Set<string>([s.entry]);
  const frontier = [s.entry];
  while (frontier.length) {
    const cur = frontier.pop()!;
    for (const e of s.edges.filter((e) => e.source === cur)) {
      if (!reachable.has(e.target)) {
        reachable.add(e.target);
        frontier.push(e.target);
      }
    }
  }
  for (const n of s.nodes) {
    if (!reachable.has(n.id)) {
      out.push({
        severity: "error",
        at: n.id,
        title: `${n.label || n.id} is never reached`,
        detail: "Nothing routes into this node, so it will never run.",
        fix: "Wire an edge into it, or delete it.",
      });
    }
  }

  /* Typed edges. This is the failure that looks fine in the builder and breaks
     with real data: a graph that appears typed and behaves untyped. */
  s.edges.forEach((e, i) => {
    const src = byId.get(e.source);
    const dst = byId.get(e.target);
    if (!src || !dst) {
      out.push({
        severity: "error",
        title: "Edge points at nothing",
        detail: `Edge ${i + 1} connects "${e.source}" to "${e.target}", and one of those is not on the canvas.`,
      });
      return;
    }
    const emits = src.emits ?? [];
    const expects = dst.expects ?? [];
    if (!emits.length || !expects.length) return;

    /* A fanned-out node's declared output describes one item; what crosses the
       edge is the collection plus its counts. Reading a per-item field here is
       the mistake, and it is invisible until it runs. */
    if (src.fanout) {
      const collected = new Set([
        src.fanout.collect_as ?? "results",
        "attempted",
        "succeeded",
        "failed",
      ]);
      for (const f of expects) {
        if (f.required === false) continue;
        if (!collected.has(f.name)) {
          out.push({
            severity: "error",
            at: dst.id,
            title: `${dst.label || dst.id} reads a per-item field across a fan-out`,
            detail: `${src.label || src.id} runs once per item, so it emits ${[...collected].join(
              ", ",
            )} — not ${f.name}.`,
            fix: `Read ${src.fanout.collect_as ?? "results"} and work over the collection.`,
          });
        }
      }
      return;
    }

    for (const f of expects) {
      if (f.required === false) continue;
      // A fanned-out target's as_field arrives per item from the fan-out
      // machinery, never from the source.
      if (dst.fanout && f.name === (dst.fanout.as_field ?? "item")) continue;
      const match = emits.find((g) => g.name === f.name);
      if (!match) {
        out.push({
          severity: "error",
          at: dst.id,
          title: `${dst.label || dst.id} needs ${f.name}`,
          detail: `${src.label || src.id} does not emit it. It emits ${
            emits.map((g) => g.name).join(", ") || "nothing"
          }.`,
          fix: `Add ${f.name} to the output of ${src.label || src.id}.`,
        });
      } else if (match.kind !== f.kind && match.kind !== "any" && f.kind !== "any") {
        out.push({
          severity: "error",
          at: dst.id,
          title: `${f.name} changes type across this edge`,
          detail: `${src.label || src.id} emits it as ${match.kind}, ${dst.label || dst.id} expects ${f.kind}.`,
          fix: "Make the two agree.",
        });
      }
    }
  });

  /* A node cannot spread over a list nobody hands it. Easy to get wrong and
     invisible once it is: the node reads as "runs per file", the graph looks
     right, and at runtime the field is simply absent. */
  for (const n of s.nodes) {
    if (!n.fanout || n.id === s.entry) continue;
    const incoming = s.edges.filter((e) => e.target === n.id);
    if (!incoming.length) continue;

    const available = new Set<string>();
    let untyped = false;
    for (const e of incoming) {
      const src = byId.get(e.source);
      if (!src) continue;
      if (src.fanout) {
        for (const k of [src.fanout.collect_as ?? "results", "attempted", "succeeded", "failed"]) {
          available.add(k);
        }
      } else if (src.emits?.length) {
        for (const g of src.emits) available.add(g.name);
      } else {
        untyped = true;
      }
    }

    if (!untyped && n.fanout.over && !available.has(n.fanout.over)) {
      out.push({
        severity: "error",
        at: n.id,
        title: `${n.label || n.id} spreads over a list nothing produces`,
        detail: `It runs once per ${n.fanout.over}, but nothing upstream emits that. Available: ${
          [...available].join(", ") || "nothing"
        }.`,
        fix: `Emit ${n.fanout.over} upstream, or spread over a field that exists.`,
      });
    }
    if (!n.fanout.over) {
      out.push({
        severity: "error",
        at: n.id,
        title: `${n.label || n.id} fans out over nothing`,
        detail: "It is set to run once per item but no field was named.",
        fix: "Name the input field holding the list.",
      });
    }
  }

  /* Least privilege, structurally. A node that both reads untrusted content and
     can act on the outside world is the entire attack surface in one node. */
  for (const g of s.policy.grants) {
    const node = byId.get(g.node);
    const taints = g.tools.filter((t) => toolByName.get(t)?.taints);
    const sinks = g.tools.filter((t) => toolByName.get(t)?.is_sink);
    if (taints.length && sinks.length) {
      out.push({
        severity: "error",
        at: g.node,
        title: `${node?.label || g.node} can read untrusted content and act on the outside world`,
        detail: `It holds ${taints.join(", ")}, which returns content authored elsewhere, and ${sinks.join(
          ", ",
        )}, which acts outward. An instruction in that content has everything it needs in one place.`,
        fix: "Split it into two nodes so the acting node's gate can see its input arrived tainted.",
      });
    }
    for (const t of g.tools) {
      if (!toolByName.has(t)) {
        out.push({
          severity: "error",
          at: g.node,
          title: `${node?.label || g.node} is granted a tool that is not connected`,
          detail: `"${t}" is granted but no integration provides it.`,
          fix: "Connect the integration, or remove the grant.",
        });
      }
    }
  }

  /* A planned call to an ungranted tool. Cheaper to catch here than as a
     denial mid-run at a client site. */
  for (const n of s.nodes) {
    if (n.harness !== "sequence") continue;
    const granted = new Set(s.policy.grants.find((g) => g.node === n.id)?.tools ?? []);
    for (const st of n.steps ?? []) {
      if (st.action === "tool" && st.tool && !granted.has(st.tool)) {
        out.push({
          severity: "error",
          at: n.id,
          title: `${n.label || n.id} calls a tool it does not hold`,
          detail: `Step "${st.id ?? st.tool}" calls ${st.tool}, which this node was not granted.`,
          fix: `Grant ${st.tool} to this node, or remove the step.`,
        });
      }
    }
  }

  /* Gates that open when nobody answers are not gates. */
  for (const g of s.policy.gates) {
    if (g.on_timeout === "proceed") {
      out.push({
        severity: "error",
        title: "A gate is set to open on timeout",
        detail: "A gate that proceeds when nobody answers is not a gate — it is a delay.",
        fix: "Set it to escalate or fail.",
      });
    }
    if (!g.approvers.length) {
      out.push({
        severity: "error",
        title: "A gate has no approvers",
        detail: "Nobody can answer it, so any run reaching it stops permanently.",
        fix: "Name at least one approving role.",
      });
    }
  }

  /* A connection missing what its runtime class requires fails at deploy
     with the same message — catching it here keeps the two voices agreeing. */
  {
    for (const c of listConnections(s)) {
      for (const f of c.def.fields) {
        const v = c.entry[f.key];
        const empty = v === undefined || v === null || (typeof v === "string" && !v.trim());
        if (f.required && empty && c.entry.enabled !== false) {
          out.push({
            severity: "error",
            at: typeof c.entry.attached_to === "string" ? c.entry.attached_to : undefined,
            title: `${c.def.label} connection is missing ${f.label.toLowerCase()}`,
            detail: `The ${c.def.tool} connector "${String(c.entry.name ?? c.def.kind)}" cannot deploy without it — the runtime refuses it with this same message.`,
            fix: `Click the connector card and set ${f.label.toLowerCase()}, or disable it.`,
          });
        }
      }
    }
  }

  /* Boundary declarations have to be complete, or the deploy refuses them. */
  if (s.trigger?.kind === "cron" && !String(s.trigger.config?.cron ?? "").trim()) {
    out.push({
      severity: "error",
      title: "The schedule has no cron expression",
      detail: "A cron trigger with no expression never fires, which reads as an agent that never ran.",
      fix: "Set one, e.g. */15 9-17 * * 1-5.",
    });
  }
  for (const [i, o] of (s.outputs ?? []).entries()) {
    if (o.kind === "webhook" && !String(o.config?.url ?? "").trim()) {
      out.push({
        severity: "error",
        title: `Output ${i + 1} posts to nowhere`,
        detail: "A webhook output needs a URL.",
        fix: "Set config.url — auth headers can reference the vault: ${secret:name}.",
      });
    }
    if (o.from_node && !byId.has(o.from_node)) {
      out.push({
        severity: "error",
        title: `Output ${i + 1} reads a node that does not exist`,
        detail: `"${o.from_node}" is not on this canvas.`,
        fix: "Point it at a real node, or leave it blank to use the run result.",
      });
    }
  }

  /* ── Warnings: things that ship, but should be deliberate ── */

  /* The runtime refuses these at parse; showing "ready" here and "refused"
     there is the drift this validator exists to prevent. */
  for (const n of s.nodes) {
    for (const [i, st] of (n.steps ?? []).entries()) {
      if (st.action === "model" && !(st.prompt ?? "").trim()) {
        out.push({
          severity: "error",
          at: n.id,
          title: `${n.label || n.id} has an empty prompt`,
          detail: `Step ${st.id ?? i + 1} calls the model with nothing to say.`,
          fix: "Write the prompt, or remove the step.",
        });
      }
      if (st.action === "tool" && !st.tool) {
        out.push({
          severity: "error",
          at: n.id,
          title: `${n.label || n.id} has a tool step with no tool`,
          detail: `Step ${st.id ?? i + 1} is set to call a tool but does not name one.`,
          fix: "Pick a granted tool, or remove the step.",
        });
      }
    }
  }

  for (const n of s.nodes) {
    if (n.harness === "sequence" && !(n.steps ?? []).length) {
      out.push({
        severity: "error",
        at: n.id,
        title: `${n.label || n.id} has no steps`,
        detail: "A pre-determined node's plan is its definition, and this one has an empty plan.",
        fix: "Add at least one step.",
      });
    }
    if (n.harness === "delegate" && !(s.policy.grants.find((g) => g.node === n.id)?.tools ?? []).length) {
      out.push({
        severity: "warn",
        at: n.id,
        title: `${n.label || n.id} decides for itself but holds no tools`,
        detail: "A model-decides node with nothing to dispatch to can only produce text.",
        fix: "Grant it tools, or make it pre-determined.",
      });
    }
    if (n.harness === "delegate" && (n.max_steps ?? 12) > 30) {
      out.push({
        severity: "warn",
        at: n.id,
        title: `${n.label || n.id} allows ${n.max_steps} model calls`,
        detail: "The step budget is the only stop condition the model cannot assert for itself.",
        fix: "Lower it unless the work genuinely needs the room.",
      });
    }
    if (!(n.emits ?? []).length && s.edges.some((e) => e.source === n.id)) {
      out.push({
        severity: "warn",
        at: n.id,
        title: `${n.label || n.id} has no declared output`,
        detail: "Anything downstream receives whatever it happens to produce, unchecked.",
        fix: "Declare what it must return.",
      });
    }
  }

  const sinkTools = s.tools.filter((t) => t.is_sink);
  for (const t of sinkTools) {
    if (!t.scope || Object.keys(t.scope).length === 0) {
      out.push({
        severity: "warn",
        title: `${t.name} acts outward with no scope limit`,
        detail: "It can act on anything it is asked to. Tool-level allow/deny is rarely enough for a sink.",
        fix: "Limit it — a recipient domain, a tenant, a time window.",
      });
    }
  }

  if (sinkTools.length && !s.policy.gates.length) {
    out.push({
      severity: "warn",
      title: "Nothing in this system is gated",
      detail: "It can act on the outside world without a human ever answering for it.",
      fix: "Add a gate at risky and above.",
    });
  }

  if (!s.evals.dataset) {
    out.push({
      severity: "warn",
      title: "No eval set",
      detail:
        "Nothing measures whether this works. A pass rate is also the only way a steered-but-permitted decision gets caught, since no rule is broken when one happens.",
      fix: "Upload a labelled dataset.",
    });
  }

  return out;
}

/* ═══════════════════ Emit ═══════════════════ */

/** The document that gets deployed. Round-trips through the Python parser. */
export function toDocument(s: AgentSystem): unknown {
  return {
    apiVersion: "agentfactory/v1",
    kind: "AgentSystem",
    metadata: {
      id: s.id,
      name: s.name,
      ...(s.owner ? { owner: s.owner } : {}),
      ...(s.description ? { description: s.description } : {}),
    },
    spec: {
      entry: s.entry,
      nodes: s.nodes.map((n) => {
        const d: Record<string, unknown> = {
          id: n.id,
          harness: n.harness,
          label: n.label || n.id,
          x: Math.round(n.x),
          y: Math.round(n.y),
        };
        if (n.persona) d.persona = n.persona;
        if (n.model) d.model = n.model;
        if (n.expects?.length) d.expects = n.expects;
        if (n.emits?.length) d.emits = n.emits;
        if (n.harness === "sequence") d.steps = n.steps ?? [];
        if (n.harness === "delegate") {
          d.max_steps = n.max_steps ?? 12;
          if (n.stop_when) d.stop_when = n.stop_when;
        }
        if (n.harness === "await" && n.interface) d.interface = n.interface;
        if (n.fanout) d.fanout = n.fanout;
        return d;
      }),
      edges: s.edges,
      tools: s.tools,
      policy: s.policy,
      ...(s.evals.dataset ? { evals: s.evals } : {}),
      ...(s.trigger && (s.trigger.kind !== "api" || s.trigger.config)
        ? { trigger: s.trigger }
        : {}),
      ...(s.outputs?.length ? { outputs: s.outputs } : {}),
    },
  };
}

/* ═══════════════════ Helpers the builder leans on ═══════════════════ */

export function grantsFor(s: AgentSystem, nodeId: string): string[] {
  return s.policy.grants.find((g) => g.node === nodeId)?.tools ?? [];
}

/** Tools whose output this node's input can be derived from, transitively. */
export function taintReaching(s: AgentSystem, nodeId: string): string[] {
  const toolByName = new Map(s.tools.map((t) => [t.name, t]));
  const sources = new Set<string>();
  const seen = new Set<string>();

  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const t of grantsFor(s, id)) {
      if (toolByName.get(t)?.taints) sources.add(t);
    }
    for (const e of s.edges.filter((e) => e.target === id)) walk(e.source);
  };
  walk(nodeId);
  return [...sources];
}

export function slug(text: string, taken: Set<string>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "node";
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i += 1;
  return `${base}-${i}`;
}

/* ═══════════════════ Load ═══════════════════ */

/**
 * The inverse of `toDocument`: a saved spec document back into builder state.
 *
 * This is what makes "Open in Builder" honest — a saved workflow reconstructs
 * into the same nodes, connector cards and boundary cards it was built from,
 * because the document is the only artefact and both directions read it. No
 * side-channel builder state, so nothing to fall out of sync with.
 *
 * Tolerant where the builder has defaults, strict where guessing would lie:
 * a node without coordinates is laid out left-to-right rather than stacked at
 * the origin, but an unknown harness is an error, not a guess.
 */
export function fromDocument(doc: unknown): AgentSystem {
  const d = doc as {
    metadata?: Record<string, unknown>;
    spec?: Record<string, unknown>;
  };
  const meta = d?.metadata ?? {};
  const spec = d?.spec ?? {};
  const rawNodes = (spec.nodes as Record<string, unknown>[] | undefined) ?? [];
  if (!Array.isArray(rawNodes)) throw new Error("the document has no node list");

  const fields = (raw: unknown): Field[] =>
    Array.isArray(raw)
      ? raw.map((f: Record<string, unknown>) => ({
          name: String(f.name ?? ""),
          kind: (KINDS.includes(f.kind as Kind) ? f.kind : "any") as Kind,
          ...(f.required === false ? { required: false } : {}),
          ...(f.note ? { note: String(f.note) } : {}),
        }))
      : [];

  const nodes: Node[] = rawNodes.map((n, i) => {
    const harness = String(n.harness ?? "");
    if (!HARNESS_ORDER.includes(harness as HarnessKind)) {
      throw new Error(`node ${String(n.id ?? i)} has unknown harness "${harness}"`);
    }
    return {
      id: String(n.id ?? `node-${i}`),
      harness: harness as HarnessKind,
      label: String(n.label ?? n.id ?? ""),
      ...(n.persona ? { persona: String(n.persona) } : {}),
      ...(n.model ? { model: String(n.model) } : {}),
      expects: fields(n.expects),
      emits: fields(n.emits),
      ...(Array.isArray(n.steps)
        ? {
            steps: (n.steps as Record<string, unknown>[]).map((st, j) => ({
              id: String(st.id ?? `s${j + 1}`),
              action: (st.action === "tool" ? "tool" : "model") as "model" | "tool",
              ...(st.prompt ? { prompt: String(st.prompt) } : {}),
              ...(st.tool ? { tool: String(st.tool) } : {}),
              ...(st.args ? { args: st.args as Record<string, unknown> } : {}),
              ...(st.emits ? { emits: String(st.emits) } : {}),
              ...(st.when ? { when: String(st.when) } : {}),
            })),
          }
        : {}),
      ...(typeof n.max_steps === "number" ? { max_steps: n.max_steps } : {}),
      ...(n.stop_when ? { stop_when: String(n.stop_when) } : {}),
      ...(n.interface ? { interface: n.interface as Interface } : {}),
      ...(n.fanout ? { fanout: n.fanout as Fanout } : {}),
      x: typeof n.x === "number" ? n.x : 64 + i * 280,
      y: typeof n.y === "number" ? n.y : 180,
    };
  });

  const rawPolicy = (spec.policy as Record<string, unknown> | undefined) ?? {};
  const rawInjection = (rawPolicy.injection as Record<string, unknown> | undefined) ?? {};

  return {
    id: String(meta.id ?? "untitled-agent"),
    name: String(meta.name ?? meta.id ?? "Untitled agent"),
    ...(meta.owner ? { owner: String(meta.owner) } : {}),
    ...(meta.description ? { description: String(meta.description) } : {}),
    entry: String(spec.entry ?? nodes[0]?.id ?? ""),
    nodes,
    edges: ((spec.edges as Edge[] | undefined) ?? []).map((e) => ({
      source: String(e.source),
      target: String(e.target),
      ...(e.when ? { when: String(e.when) } : {}),
      ...(e.label ? { label: String(e.label) } : {}),
    })),
    tools: ((spec.tools as Tool[] | undefined) ?? []).map((t) => ({ ...t })),
    policy: {
      grants: ((rawPolicy.grants as Grant[] | undefined) ?? []).map((g) => ({
        node: String(g.node),
        tools: (g.tools ?? []).map(String),
        ...(g.scope ? { scope: g.scope } : {}),
      })),
      gates: ((rawPolicy.gates as Gate[] | undefined) ?? []).map((g) => ({ ...g })),
      injection: {
        patterns: ((rawInjection.patterns as string[] | undefined) ?? []).map(String),
        prohibited_actions: ((rawInjection.prohibited_actions as string[] | undefined) ?? []).map(String),
        action: rawInjection.action === "flag" ? "flag" : "block",
      },
      block_tainted_sinks: rawPolicy.block_tainted_sinks !== false,
    },
    evals: (spec.evals as Evals | undefined) ?? {},
    ...(spec.trigger ? { trigger: spec.trigger as Trigger } : {}),
    ...(spec.outputs ? { outputs: spec.outputs as OutputDecl[] } : {}),
  };
}

/**
 * The input fields a run of this system actually reads: the entry node's
 * declared `expects`, plus any {{placeholder}} its steps reference that no
 * earlier step produced. One derivation, used by the run launcher and the
 * eval case builder — the spec already knows its own inputs, so no surface
 * should ask a person to guess them.
 */
export function inputKeysOf(s: AgentSystem): { name: string; kind: Kind }[] {
  const entry = s.nodes.find((n) => n.id === s.entry);
  if (!entry) return [];
  const out = new Map<string, Kind>();
  for (const f of entry.expects ?? []) out.set(f.name, f.kind);
  const produced = new Set((entry.steps ?? []).map((st) => st.emits).filter(Boolean));
  for (const st of entry.steps ?? []) {
    const text = `${st.prompt ?? ""} ${JSON.stringify(st.args ?? {})} ${entry.persona ?? ""}`;
    for (const m of text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
      if (!produced.has(m[1]) && !out.has(m[1])) out.set(m[1], "string");
    }
  }
  return [...out.entries()].map(([name, kind]) => ({ name, kind }));
}
