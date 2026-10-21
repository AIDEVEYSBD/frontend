import type { Schemas } from "./api/client";

/**
 * A workflow's versions and what changed between two of them, in the spec's
 * own vocabulary.
 *
 * Every save and every deploy writes a version (`GET /api/agents/{id}/versions`),
 * and the backend compares two of them after normalising both through the
 * runtime's parser (`GET /api/agents/{id}/diff`), so layout and defaulted
 * fields never register. This reads that comparison as a reviewer would
 * say it: nodes, edges and their guards, tools, grants, gates, budgets and
 * the rest of the policy, each added, removed or changed, never as a JSON
 * diff. Pure: components/versions.tsx renders it and tests/versions.test.ts
 * holds it to diffs captured from the backend.
 */

export type VersionList = Schemas["VersionList"];
export type VersionView = Schemas["VersionView"];
export type SpecDiff = Schemas["SpecDiff"];
type Change = Schemas["Change"];

export type Op = "added" | "removed" | "changed";

export interface DiffLine {
  op: Op;
  /** What changed, named as the spec names it: `node triage`, `edge decide → notify`, `gate at risky`, `tool calls`. */
  subject: string;
  /** How, in a line: the values before and after, or what the thing is. */
  detail: string;
}

export type SectionId = "metadata" | "system" | "nodes" | "edges" | "guards" | "tools" | "grants" | "gates" | "budget" | "policy";

export interface DiffSection {
  id: SectionId;
  title: string;
  lines: DiffLine[];
}

/* ═══════════════════ values, as a person reads them ═══════════════════ */

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

/** A short reading of any value: a string quoted, a list joined, an object as its keys and values; `(none)` for nothing. */
export function show(v: unknown): string {
  if (isEmpty(v)) return "(none)";
  if (typeof v === "string") return `"${v}"`;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : show(x))).join(", ");
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => !isEmpty(x));
    return entries.length ? entries.map(([k, x]) => `${k} ${typeof x === "string" ? x : show(x)}`).join(", ") : "(none)";
  }
  return String(v);
}

/** Seconds as the spec's timeouts are read: `90 s`, `15 min`, `2 h`, `3 d`. */
export function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return `${seconds} s`;
  if (seconds % 86_400 === 0) return `${seconds / 86_400} d`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600} h`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ═══════════════════ budgets ═══════════════════ */

/** A run's budget (spec.policy.budget): only tool_calls has a default; the others are off until set. */
interface Budget {
  tool_calls?: number;
  tokens?: number;
  cost_usd?: number;
  wall_clock_s?: number;
}

/** The runtime's default when a spec sets no budget (agentfactory/spec.py Budget). */
export const DEFAULT_TOOL_CALLS = 200;

const LIMITS: { key: keyof Budget; name: string; read: (v: number) => string }[] = [
  { key: "tool_calls", name: "tool calls", read: (v) => v.toLocaleString("en-GB") },
  { key: "tokens", name: "tokens", read: (v) => v.toLocaleString("en-GB") },
  { key: "cost_usd", name: "cost", read: (v) => `$${v.toFixed(2)}` },
  { key: "wall_clock_s", name: "wall clock", read: duration },
];

function budgetOf(v: unknown): Budget {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const out: Budget = {};
  for (const { key } of LIMITS) if (typeof o[key] === "number") out[key] = o[key] as number;
  return out;
}

/**
 * A budget change, limit by limit. The backend reports the budget as one
 * changed field (`policy.budget`), from and to; absent on either side means
 * the runtime's default (200 tool calls, nothing else limited). A limit
 * appearing is added, one going is removed, one moving is changed.
 */
export function budgetLines(from: unknown, to: unknown): DiffLine[] {
  const a = budgetOf(from);
  const b = budgetOf(to);
  const out: DiffLine[] = [];
  for (const { key, name, read } of LIMITS) {
    if (key === "tool_calls") {
      const x = a.tool_calls ?? DEFAULT_TOOL_CALLS;
      const y = b.tool_calls ?? DEFAULT_TOOL_CALLS;
      if (x !== y) out.push({ op: "changed", subject: `${name} per run`, detail: `${read(x)}${a.tool_calls === undefined ? " (the default)" : ""} → ${read(y)}${b.tool_calls === undefined ? " (the default)" : ""}` });
      continue;
    }
    const x = a[key];
    const y = b[key];
    if (x === y) continue;
    if (x === undefined) out.push({ op: "added", subject: `${name} limit per run`, detail: `${read(y!)} (unlimited before)` });
    else if (y === undefined) out.push({ op: "removed", subject: `${name} limit per run`, detail: `was ${read(x)}; unlimited now` });
    else out.push({ op: "changed", subject: `${name} limit per run`, detail: `${read(x)} → ${read(y)}` });
  }
  return out;
}

/* ═══════════════════ the rest of the policy ═══════════════════ */

const listOf = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

function injectionLines(from: unknown, to: unknown): DiffLine[] {
  const a = (from && typeof from === "object" ? from : {}) as Record<string, unknown>;
  const b = (to && typeof to === "object" ? to : {}) as Record<string, unknown>;
  const out: DiffLine[] = [];
  for (const [key, name] of [["patterns", "injection pattern"], ["prohibited_actions", "prohibited action"]] as const) {
    const x = listOf(a[key]);
    const y = listOf(b[key]);
    for (const p of y) if (!x.includes(p)) out.push({ op: "added", subject: name, detail: `"${p}"` });
    for (const p of x) if (!y.includes(p)) out.push({ op: "removed", subject: name, detail: `"${p}"` });
  }
  const x = String(a.action ?? "block");
  const y = String(b.action ?? "block");
  if (x !== y) out.push({ op: "changed", subject: "on an injection", detail: `${x === "block" ? "refuse the step" : "flag it and go on to a gate"} → ${y === "block" ? "refuse the step" : "flag it and go on to a gate"}` });
  return out;
}

const sinkRule = (v: unknown) => (v === false ? "gated, as any risky call is" : "refused outright");

function policyLines(changes: readonly Change[]): { budget: DiffLine[]; policy: DiffLine[] } {
  const budget: DiffLine[] = [];
  const policy: DiffLine[] = [];
  for (const c of changes) {
    if (c.field === "budget") budget.push(...budgetLines(c.from, c.to));
    else if (c.field === "injection") policy.push(...injectionLines(c.from, c.to));
    else if (c.field === "block_tainted_sinks") policy.push({ op: "changed", subject: "tainted data reaching a sink", detail: `${sinkRule(c.from)} → ${sinkRule(c.to)}` });
    else policy.push(changeLine(`policy.${c.field}`, c));
  }
  return { budget, policy };
}

/* ═══════════════════ one Change, generically ═══════════════════ */

function changeLine(subject: string, c: Change): DiffLine {
  if (isEmpty(c.from) && !isEmpty(c.to)) return { op: "added", subject, detail: show(c.to) };
  if (!isEmpty(c.from) && isEmpty(c.to)) return { op: "removed", subject, detail: `was ${show(c.from)}` };
  return { op: "changed", subject, detail: `${show(c.from)} → ${show(c.to)}` };
}

/** The system's boundary, named: the entry node, the trigger, the evals, the outputs. */
function systemLine(c: Change): DiffLine {
  if (c.field === "entry") return { op: "changed", subject: "entry node", detail: `${show(c.from)} → ${show(c.to)}` };
  if (c.field === "trigger") {
    const kind = (v: unknown) => (v && typeof v === "object" ? String((v as { kind?: unknown }).kind ?? "api") : "api");
    const config = (v: unknown) => (v && typeof v === "object" ? (v as { config?: unknown }).config : undefined);
    const a = kind(c.from);
    const b = kind(c.to);
    const conf = isEmpty(config(c.to)) || show(config(c.to)) === "(none)" ? "" : ` (${show(config(c.to))})`;
    return { op: "changed", subject: "trigger", detail: a === b ? `${b}: configuration ${show(config(c.from))} → ${show(config(c.to))}` : `${a} → ${b}${conf}` };
  }
  if (c.field === "outputs") {
    const n = (v: unknown) => (Array.isArray(v) ? v.length : 0);
    return { op: isEmpty(c.from) ? "added" : isEmpty(c.to) ? "removed" : "changed", subject: "outputs", detail: `${plural(n(c.from), "output")} → ${plural(n(c.to), "output")}${Array.isArray(c.to) && c.to.length ? `: ${c.to.map((o) => String((o as { kind?: unknown }).kind ?? "output")).join(", ")}` : ""}` };
  }
  return changeLine(c.field === "evals" ? "evals" : c.field, c);
}

/* ═══════════════════ the sections ═══════════════════ */

const NODE_ATTR: Record<string, string> = { max_steps: "step budget", stop_when: "stop condition", model_class: "model class", expects: "inputs", emits: "outputs", fanout: "fan-out", interface: "gate interface" };

function nodeLines(d: SpecDiff): DiffLine[] {
  const n = d.nodes;
  const out: DiffLine[] = [];
  for (const a of n.added ?? []) out.push({ op: "added", subject: `node ${a.id}`, detail: `${a.harness || "node"}${a.label && a.label !== a.id ? `, "${a.label}"` : ""}` });
  for (const r of n.removed ?? []) out.push({ op: "removed", subject: `node ${r.id}`, detail: `${r.harness || "node"}${r.label && r.label !== r.id ? `, "${r.label}"` : ""}` });
  for (const c of n.changed ?? []) {
    const parts: string[] = [];
    const valued = new Set<string>();
    for (const ch of c.changes ?? []) {
      valued.add(ch.field);
      parts.push(`${NODE_ATTR[ch.field] ?? ch.field} ${show(ch.from)} → ${show(ch.to)}`);
    }
    if (c.steps) {
      const s = c.steps;
      const steps: string[] = [];
      if (s.added?.length) steps.push(`added ${s.added.join(", ")}`);
      if (s.removed?.length) steps.push(`removed ${s.removed.join(", ")}`);
      for (const sc of s.changed ?? []) steps.push(`${sc.id} changed (${sc.attributes.join(", ")})`);
      if (steps.length) parts.push(`steps: ${steps.join("; ")}`);
      valued.add("steps");
    }
    const rest = c.attributes.filter((a) => !valued.has(a)).map((a) => NODE_ATTR[a] ?? a);
    if (rest.length) parts.push(`${rest.join(", ")} changed`);
    out.push({ op: "changed", subject: `node ${c.id}`, detail: parts.join("; ") || `${c.attributes.join(", ")} changed` });
  }
  return out;
}

const arrow = (e: { source: string; target: string }) => `${e.source} → ${e.target}`;

function edgeLines(d: SpecDiff): DiffLine[] {
  const out: DiffLine[] = [];
  for (const e of d.edges.added ?? []) out.push({ op: "added", subject: `edge ${arrow(e)}`, detail: e.when ? `when ${e.when}` : "always taken" });
  for (const e of d.edges.removed ?? []) out.push({ op: "removed", subject: `edge ${arrow(e)}`, detail: e.when ? `was taken when ${e.when}` : "was always taken" });
  return out;
}

function guardLines(d: SpecDiff): DiffLine[] {
  return (d.guards ?? []).map((g) => ({
    op: (!g.from ? "added" : !g.to ? "removed" : "changed") as Op,
    subject: g.where === "edge" ? `guard on ${g.source} → ${g.target}` : `guard on step ${g.node}/${g.step}`,
    detail: `${g.from || "(always)"} → ${g.to || "(always)"}`,
  }));
}

function toolLines(d: SpecDiff): DiffLine[] {
  const what = (t: { risk?: string; server?: string }) => [t.risk, t.server ? `server ${t.server}` : ""].filter(Boolean).join(", ");
  const out: DiffLine[] = [];
  for (const t of d.tools.added ?? []) out.push({ op: "added", subject: `tool ${t.name}`, detail: what(t) || "registered" });
  for (const t of d.tools.removed ?? []) out.push({ op: "removed", subject: `tool ${t.name}`, detail: what(t) ? `was ${what(t)}` : "no longer registered" });
  for (const t of d.tools.changed ?? []) {
    const attrs = t.attributes.map((a) => (a === "risk" ? `risk (now ${t.risk || "unset"})` : a === "server" ? `server (now ${t.server || "unset"})` : a === "is_sink" ? "sink marking" : a === "taints" ? "taint marking" : a));
    out.push({ op: "changed", subject: `tool ${t.name}`, detail: `${attrs.join(", ")} changed` });
  }
  return out;
}

function grantLines(d: SpecDiff): DiffLine[] {
  const out: DiffLine[] = [];
  for (const g of d.grants ?? []) {
    for (const t of g.added ?? []) out.push({ op: "added", subject: `grant ${t}`, detail: `to node ${g.node}` });
    for (const t of g.removed ?? []) out.push({ op: "removed", subject: `grant ${t}`, detail: `from node ${g.node}` });
    for (const t of g.scope_changed ?? []) out.push({ op: "changed", subject: `scope of ${t}`, detail: `on node ${g.node}: the arguments it may take changed` });
  }
  return out;
}

type GateLike = { at_or_above: string; nodes?: string[]; approvers?: string[]; on_timeout?: string; timeout_s?: number };

const gateName = (g: GateLike) => `gate at ${g.at_or_above || "any risk"}${g.nodes?.length ? ` on ${g.nodes.join(", ")}` : ""}`;
const gateWhat = (g: GateLike) =>
  [`approvers ${g.approvers?.length ? g.approvers.join(", ") : "anyone with approve"}`, `on timeout ${g.on_timeout || "escalate"} after ${duration(g.timeout_s ?? 86_400)}`].join("; ");

function gateLines(d: SpecDiff): DiffLine[] {
  const out: DiffLine[] = [];
  for (const g of d.gates.added ?? []) out.push({ op: "added", subject: gateName(g), detail: gateWhat(g) });
  for (const g of d.gates.removed ?? []) out.push({ op: "removed", subject: gateName(g), detail: `was ${gateWhat(g)}` });
  for (const g of d.gates.changed ?? []) {
    const parts = (g.changes ?? []).map((c) =>
      c.field === "timeout_s"
        ? `timeout ${typeof c.from === "number" ? duration(c.from) : show(c.from)} → ${typeof c.to === "number" ? duration(c.to) : show(c.to)}`
        : c.field === "on_timeout"
          ? `on timeout ${show(c.from).replace(/"/g, "")} → ${show(c.to).replace(/"/g, "")}`
          : `${c.field} ${show(c.from)} → ${show(c.to)}`,
    );
    out.push({ op: "changed", subject: gateName(g), detail: parts.join("; ") || `${g.attributes.join(", ")} changed` });
  }
  return out;
}

const TITLES: Record<SectionId, string> = {
  metadata: "Name and description",
  system: "Entry, trigger and outputs",
  nodes: "Nodes",
  edges: "Edges",
  guards: "Guards",
  tools: "Tools",
  grants: "Grants",
  gates: "Gates",
  budget: "Budget",
  policy: "Policy",
};

/** Every section with something in it, in the order a reviewer reads a spec: what it is, its graph, what it may touch, who stops it, what it may spend. */
export function diffSections(d: SpecDiff): DiffSection[] {
  const { budget, policy } = policyLines(d.policy ?? []);
  const sections: [SectionId, DiffLine[]][] = [
    ["metadata", (d.metadata ?? []).map((c) => changeLine(c.field, c))],
    ["system", (d.system ?? []).map(systemLine)],
    ["nodes", nodeLines(d)],
    ["edges", edgeLines(d)],
    ["guards", guardLines(d)],
    ["tools", toolLines(d)],
    ["grants", grantLines(d)],
    ["gates", gateLines(d)],
    ["budget", budget],
    ["policy", policy],
  ];
  return sections.filter(([, lines]) => lines.length > 0).map(([id, lines]) => ({ id, title: TITLES[id], lines }));
}

/** How much moved, by kind of change. */
export function diffCounts(sections: readonly DiffSection[]): Record<Op, number> {
  const out: Record<Op, number> = { added: 0, removed: 0, changed: 0 };
  for (const s of sections) for (const l of s.lines) out[l.op] += 1;
  return out;
}

/* ═══════════════════ the version list ═══════════════════ */

export type VersionStatus = "deployed" | "deployed earlier" | "draft";

export interface VersionRow extends VersionView {
  status: VersionStatus;
  latest: boolean;
  /** The earlier version whose digest this one repeats (a save that moved only layout or defaults), else null. */
  sameAs: number | null;
}

/**
 * The versions newest first, each with what it is now: the one deployed (the
 * highest version marked deployed), one deployed before it, or a draft
 * saved and never deployed; the latest save; and a save whose digest repeats
 * the version before it, which changed nothing that runs.
 */
export function versionRows(list: VersionList): VersionRow[] {
  const sorted = [...list.versions].sort((a, b) => a.version - b.version);
  const deployed = list.deployed ?? (sorted.filter((v) => v.deployed).at(-1)?.version ?? null);
  const latest = list.latest ?? sorted.at(-1)?.version ?? null;
  return sorted
    .map((v, i) => ({
      ...v,
      status: (v.version === deployed ? "deployed" : v.deployed ? "deployed earlier" : "draft") as VersionStatus,
      latest: v.version === latest,
      sameAs: i > 0 && v.digest && v.digest === sorted[i - 1].digest ? sorted[i - 1].version : null,
    }))
    .reverse();
}

/** The pair a page opens on: what is deployed against the latest save, else the latest against the one before it; null with fewer than two versions. */
export function defaultPair(list: VersionList): { from: number; to: number } | null {
  const numbers = list.versions.map((v) => v.version).sort((a, b) => a - b);
  if (numbers.length < 2) return null;
  const latest = list.latest ?? numbers[numbers.length - 1];
  const deployed = list.deployed ?? null;
  if (deployed !== null && deployed !== latest && numbers.includes(deployed)) return { from: deployed, to: latest };
  const before = numbers.filter((n) => n < latest).at(-1);
  return before === undefined ? null : { from: before, to: latest };
}
