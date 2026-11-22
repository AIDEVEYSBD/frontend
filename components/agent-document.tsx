import { RISK_ORDER } from "@/lib/spec";

/**
 * An agent's document, as the configuration page reads and changes it.
 *
 * The page is a form over the saved JSON spec (runtime/agentfactory/spec.py
 * names the fields). It reads the raw document rather than a model of it,
 * and a save writes a copy of that document with only the changed fields
 * set at their own paths: nothing is round-tripped through another shape,
 * so a field the form has no control for (a grant's data class, a gate's
 * answer shape, the layout) leaves exactly as it arrived.
 */

export type Doc = Record<string, unknown>;

const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
export const obj = (v: unknown): Record<string, unknown> => (isObj(v) ? v : {});
export const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const str = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const strs = (v: unknown): string[] => arr(v).map(str).filter(Boolean);
/** A document value as the form shows it: "" when the document does not carry it. */
const shown = (v: unknown): string => (v === null || v === undefined ? "" : typeof v === "number" ? String(v) : str(v));

/** Role names typed as a comma-separated line. */
export const roles = (text: string): string[] => text.split(",").map((r) => r.trim()).filter(Boolean);

const specOf = (doc: Doc) => obj(doc.spec);
const policyOf = (doc: Doc) => obj(specOf(doc).policy);
const nodesOf = (doc: Doc) => arr(specOf(doc).nodes).map(obj);

/* ═══════════════════ reading ═══════════════════ */

export interface StepRow {
  id: string;
  label: string;
  harness: string;
  /** A sequence's fixed steps. */
  fixed: number;
  /** The model or the tier the step names; "" for the deployment's default. */
  model: string;
  fanout: { over: string; max_parallel: number | null } | null;
  /** An await step's interface kind: approval, webhook, schedule, agent. */
  waits: string;
}

export function stepsOf(doc: Doc): StepRow[] {
  return nodesOf(doc).map((n) => {
    const fan = isObj(n.fanout) ? n.fanout : null;
    return {
      id: str(n.id),
      label: str(n.label) || str(n.id),
      harness: str(n.harness),
      fixed: arr(n.steps).length,
      model: str(n.model) || (str(n.model_class) ? `${str(n.model_class)} tier` : ""),
      fanout: fan ? { over: str(fan.over), max_parallel: typeof fan.max_parallel === "number" ? fan.max_parallel : null } : null,
      waits: str(obj(n.interface).kind),
    };
  });
}

export interface ToolRow {
  name: string;
  /** The binding the document registers under that name; false for a grant naming a tool it does not register. */
  registered: boolean;
  risk: string;
  summary: string;
  sink: boolean;
  taints: boolean;
  impact: string[];
  dataClass: string;
  maxDataClass: string;
  /** The tool's own scope: argument path, and the values it may take. */
  scope: [string, string[]][];
  /** This step's narrowing on top of it. */
  narrowed: [string, string[]][];
}

export interface GrantRow {
  step: string;
  label: string;
  maxDataClass: string;
  tools: ToolRow[];
}

const scopeRows = (v: unknown): [string, string[]][] => Object.entries(obj(v)).map(([k, vals]) => [k, strs(vals)]);

/** The tools the document declares (`spec.tools[].name`): the only ones a grant may name. */
export function declaredTools(doc: Doc): string[] {
  return arr(specOf(doc).tools).map(obj).map((t) => str(t.name)).filter(Boolean);
}

/** One tool as a step holds it: the document's binding for it, and the step's own narrowing of its scope. */
export function toolRowOf(doc: Doc, step: string, name: string): ToolRow {
  const t = arr(specOf(doc).tools).map(obj).find((x) => str(x.name) === name);
  const g = arr(policyOf(doc).grants).map(obj).find((x) => str(x.node) === step) ?? {};
  return {
    name,
    registered: Boolean(t),
    risk: str(t?.risk),
    summary: str(t?.summary),
    sink: t?.is_sink === true,
    taints: t?.taints === true,
    impact: strs(t?.impact),
    dataClass: str(t?.data_class),
    maxDataClass: str(t?.max_data_class),
    scope: scopeRows(t?.scope),
    narrowed: scopeRows(obj(g.scope)[name]),
  };
}

/** Per step, the tools granted and their scope. A step with no grant, or an empty one, is listed with none. */
export function grantsOf(doc: Doc): GrantRow[] {
  const grants = new Map(arr(policyOf(doc).grants).map(obj).map((g) => [str(g.node), g]));
  return stepsOf(doc).map((s) => {
    const g = grants.get(s.id) ?? {};
    return {
      step: s.id,
      label: s.label,
      maxDataClass: str(g.max_data_class),
      tools: strs(g.tools).map((name) => toolRowOf(doc, s.id, name)),
    };
  });
}

/* ═══════════════════ fields ═══════════════════ */

export type FieldKind = "number" | "text" | "roles" | "choice";

export interface FieldSpec {
  key: string;
  /** What the change is called beside the Save button. */
  label: string;
  kind: FieldKind;
  /** What the document says, as the form shows it. */
  base: string;
  /** "" when the value may be saved. */
  check: (v: string) => string;
  /** Sets the value in a copy of the document. Called only for a changed field. */
  write: (doc: Doc, v: string) => void;
}

/** Whether a typed value differs from what the document says. Spacing in a number or a list of roles is not a change. */
export function changed(kind: FieldKind, base: string, v: string): boolean {
  if (kind === "roles") return roles(base).join("\n") !== roles(v).join("\n");
  if (kind === "number") {
    const [a, b] = [base.trim(), v.trim()];
    if (a === b) return false;
    if (a === "" || b === "") return true;
    return Number(a) !== Number(b);
  }
  return base.trim() !== v.trim();
}

function numberCheck(opts: { least: number; open: boolean; whole: boolean; required?: boolean }) {
  return (v: string): string => {
    const t = v.trim();
    if (!t) return opts.required ? "Needs a value." : "";
    const n = Number(t);
    if (!Number.isFinite(n)) return "Needs a number.";
    if (n < opts.least || (opts.open && n === opts.least)) return opts.open ? `Must be greater than ${opts.least}.` : `Must be at least ${opts.least}.`;
    if (opts.whole && !Number.isInteger(n)) return "Must be a whole number.";
    return "";
  };
}

const POSITIVE = numberCheck({ least: 0, open: true, whole: false });
const POSITIVE_WHOLE = numberCheck({ least: 0, open: true, whole: true });

/** The section of the policy a field lives in, made when the first field in it is set. */
function section(doc: Doc, name: string): Record<string, unknown> {
  const spec = isObj(doc.spec) ? doc.spec : (doc.spec = {} as Record<string, unknown>);
  const policy = isObj(spec.policy) ? spec.policy : (spec.policy = {} as Record<string, unknown>);
  if (!isObj(policy[name])) policy[name] = {};
  return policy[name] as Record<string, unknown>;
}

/** Sets or clears one optional number in a policy section; a section the change emptied goes with it. */
function writeNumber(doc: Doc, name: string, key: string, v: string): void {
  const s = section(doc, name);
  if (v.trim()) s[key] = Number(v);
  else delete s[key];
  if (Object.keys(s).length === 0) delete obj(obj(doc.spec).policy)[name];
}

function nodeIn(doc: Doc, id: string): Record<string, unknown> | undefined {
  return arr(obj(doc.spec).nodes).find((n) => isObj(n) && str(n.id) === id) as Record<string, unknown> | undefined;
}

export const BUDGET_KEYS = ["cost_usd", "tokens", "tool_calls", "wall_clock_s"] as const;
export type BudgetKey = (typeof BUDGET_KEYS)[number];
const BUDGET_LABEL: Record<BudgetKey, string> = { cost_usd: "cost", tokens: "tokens", tool_calls: "tool calls", wall_clock_s: "wall clock" };

const hours = (seconds: unknown): string => (typeof seconds === "number" && Number.isFinite(seconds) ? String(Math.round((seconds / 3600) * 1000) / 1000) : "");

/** Every field the form may change, keyed, with what the document says for it. */
export function fieldsOf(doc: Doc): Map<string, FieldSpec> {
  const out = new Map<string, FieldSpec>();
  const add = (f: FieldSpec) => out.set(f.key, f);
  const policy = policyOf(doc);

  const budget = obj(policy.budget);
  for (const k of BUDGET_KEYS) {
    add({
      key: `budget.${k}`,
      label: `Limits: ${BUDGET_LABEL[k]}`,
      kind: "number",
      base: shown(budget[k]),
      check: k === "tokens" || k === "tool_calls" ? POSITIVE_WHOLE : POSITIVE,
      write: (d, v) => writeNumber(d, "budget", k, v),
    });
  }

  add({
    key: "delegation.max_depth",
    label: "Bounds: delegation depth",
    kind: "number",
    base: shown(obj(policy.delegation).max_depth),
    check: numberCheck({ least: 0, open: false, whole: true }),
    write: (d, v) => writeNumber(d, "delegation", "max_depth", v),
  });

  const declared = new Set(declaredTools(doc));
  const grantList = arr(policy.grants).map(obj);
  for (const n of nodesOf(doc)) {
    const id = str(n.id);
    const name = str(n.label) || id;
    // The tools this step may call (`policy.grants[node].tools`): only tools the document declares may be added.
    const granted = strs(grantList.find((g) => str(g.node) === id)?.tools);
    add({
      key: `grant.${id}.tools`,
      label: `Tools: grants of ${name}`,
      kind: "roles",
      base: granted.join(", "),
      check: (v) => {
        const added = roles(v).filter((t) => !granted.includes(t) && !declared.has(t));
        return added.length ? `${added.join(", ")} ${added.length === 1 ? "is" : "are"} not declared in this document's tools.` : "";
      },
      write: (d, v) => {
        const spec = isObj(d.spec) ? d.spec : (d.spec = {} as Record<string, unknown>);
        const pol = isObj(spec.policy) ? spec.policy : (spec.policy = {} as Record<string, unknown>);
        const list = Array.isArray(pol.grants) ? (pol.grants as unknown[]) : (pol.grants = [] as unknown[]);
        const tools = [...new Set(roles(v))];
        const grant = list.find((g) => isObj(g) && str(g.node) === id) as Record<string, unknown> | undefined;
        if (grant) grant.tools = tools;
        else if (tools.length) list.push({ node: id, tools });
      },
    });
    if (str(n.harness) === "delegate") {
      add({
        key: `step.${id}.max_steps`,
        label: `Bounds: step limit of ${name}`,
        kind: "number",
        base: shown(n.max_steps),
        check: numberCheck({ least: 1, open: false, whole: true }),
        write: (d, v) => {
          const node = nodeIn(d, id);
          if (!node) return;
          if (v.trim()) node.max_steps = Number(v);
          else delete node.max_steps;
        },
      });
      add({
        key: `step.${id}.stop_when`,
        label: `Bounds: stop condition of ${name}`,
        kind: "text",
        base: str(n.stop_when),
        check: () => "",
        write: (d, v) => {
          const node = nodeIn(d, id);
          if (!node) return;
          if (v.trim()) node.stop_when = v.trim();
          else delete node.stop_when;
        },
      });
    }
    const iface = obj(n.interface);
    if (str(n.harness) === "await" && str(iface.kind) === "approval") {
      const face = (d: Doc) => {
        const node = nodeIn(d, id);
        return node && isObj(node.interface) ? node.interface : undefined;
      };
      add({
        key: `await.${id}.target`,
        label: `Gates: approvers of ${name}`,
        kind: "roles",
        base: roles(str(iface.target)).join(", "),
        check: () => "",
        write: (d, v) => {
          const f = face(d);
          if (f) f.target = roles(v).join(", ");
        },
      });
      add({
        key: `await.${id}.escalate_to`,
        label: `Gates: escalation of ${name}`,
        kind: "roles",
        base: strs(iface.escalate_to).join(", "),
        check: () => "",
        write: (d, v) => {
          const f = face(d);
          if (!f) return;
          if (roles(v).length) f.escalate_to = roles(v);
          else delete f.escalate_to;
        },
      });
      add({
        key: `await.${id}.on_timeout`,
        label: `Gates: unanswered action of ${name}`,
        kind: "choice",
        base: str(iface.on_timeout) || "escalate",
        check: () => "",
        write: (d, v) => {
          const f = face(d);
          if (f) f.on_timeout = v;
        },
      });
      add({
        key: `await.${id}.timeout_h`,
        label: `Gates: wait of ${name}`,
        kind: "number",
        base: hours(iface.timeout_s),
        check: POSITIVE,
        write: (d, v) => {
          const f = face(d);
          if (!f) return;
          if (v.trim()) f.timeout_s = Math.round(Number(v) * 3600);
          else delete f.timeout_s;
        },
      });
    }
  }
  return out;
}

/* ═══════════════════ policy gates ═══════════════════ */

export interface GateDraft {
  /** Its place in the document's list; null for one added here. */
  src: number | null;
  at_or_above: string;
  when: string;
  approvers: string;
  escalate_to: string;
  on_timeout: string;
  timeout_h: string;
  /** The steps it applies to; none means every step. Shown, not edited. */
  nodes: string[];
}

export function gatesOf(doc: Doc): GateDraft[] {
  return arr(policyOf(doc).gates).map(obj).map((g, i) => ({
    src: i,
    at_or_above: str(g.at_or_above),
    when: str(g.when),
    approvers: strs(g.approvers).join(", "),
    escalate_to: strs(g.escalate_to).join(", "),
    on_timeout: str(g.on_timeout) || "escalate",
    timeout_h: hours(g.timeout_s),
    nodes: strs(g.nodes),
  }));
}

export const NEW_GATE: GateDraft = { src: null, at_or_above: "risky", when: "", approvers: "", escalate_to: "", on_timeout: "escalate", timeout_h: "", nodes: [] };

type GateField = "at_or_above" | "when" | "approvers" | "escalate_to" | "on_timeout" | "timeout_h";
const GATE_FIELDS: { key: GateField; kind: FieldKind; label: string }[] = [
  { key: "at_or_above", kind: "choice", label: "risk floor" },
  { key: "when", kind: "text", label: "condition" },
  { key: "approvers", kind: "roles", label: "approvers" },
  { key: "escalate_to", kind: "roles", label: "escalation" },
  { key: "on_timeout", kind: "choice", label: "unanswered action" },
  { key: "timeout_h", kind: "number", label: "wait" },
];

/** What would be refused before anything is sent, per field. */
export function gateProblems(g: GateDraft): Partial<Record<GateField, string>> {
  const out: Partial<Record<GateField, string>> = {};
  if (!(RISK_ORDER as string[]).includes(g.at_or_above)) out.at_or_above = "Pick a risk.";
  if (!roles(g.approvers).length) out.approvers = "Name at least one role.";
  const wait = POSITIVE(g.timeout_h);
  if (wait) out.timeout_h = wait;
  return out;
}

/** The changes between the document's gates and the form's, in words; empty when there are none. */
export function gateChanges(base: GateDraft[], drafts: GateDraft[]): string[] {
  const out: string[] = [];
  drafts.forEach((g, i) => {
    if (g.src === null) return void out.push(`Gates: gate ${i + 1} added`);
    const was = base[g.src];
    for (const f of GATE_FIELDS) if (changed(f.kind, was[f.key], g[f.key])) out.push(`Gates: ${f.label} of gate ${i + 1}`);
  });
  const kept = new Set(drafts.map((g) => g.src));
  base.forEach((g, i) => {
    if (!kept.has(i)) out.push(`Gates: gate ${i + 1} removed (${g.at_or_above || "no risk"} and above)`);
  });
  return out;
}

function setGateField(target: Record<string, unknown>, key: GateField, v: string): void {
  if (key === "at_or_above" || key === "on_timeout") target[key] = v;
  else if (key === "approvers") target.approvers = roles(v);
  else if (key === "when") {
    if (v.trim()) target.when = v.trim();
    else delete target.when;
  } else if (key === "escalate_to") {
    if (roles(v).length) target.escalate_to = roles(v);
    else delete target.escalate_to;
  } else if (v.trim()) target.timeout_s = Math.round(Number(v) * 3600);
  else delete target.timeout_s;
}

/** Writes the form's gates into a copy of the document: a kept gate keeps every key the form did not change. */
function writeGates(doc: Doc, base: GateDraft[], drafts: GateDraft[]): void {
  const spec = isObj(doc.spec) ? doc.spec : (doc.spec = {} as Record<string, unknown>);
  const policy = isObj(spec.policy) ? spec.policy : (spec.policy = {} as Record<string, unknown>);
  const before = arr(policy.gates).map(obj);
  policy.gates = drafts.map((g) => {
    if (g.src === null) {
      const fresh: Record<string, unknown> = {};
      for (const f of GATE_FIELDS) if (changed(f.kind, f.key === "on_timeout" ? "escalate" : "", g[f.key])) setGateField(fresh, f.key, g[f.key]);
      return fresh;
    }
    const kept = before[g.src];
    for (const f of GATE_FIELDS) if (changed(f.kind, base[g.src][f.key], g[f.key])) setGateField(kept, f.key, g[f.key]);
    return kept;
  });
}

/* ═══════════════════ saving ═══════════════════ */

export interface Pending {
  /** The changes, in words. */
  changes: string[];
  /** Why the form cannot be saved as it stands; empty when it can. */
  problems: string[];
}

/** What a save would write, and what stands in its way. */
export function pendingOf(fields: Map<string, FieldSpec>, edits: Record<string, string>, baseGates: GateDraft[], gates: GateDraft[]): Pending {
  const changes: string[] = [];
  const problems: string[] = [];
  for (const f of fields.values()) {
    const v = edits[f.key];
    if (v === undefined || !changed(f.kind, f.base, v)) continue;
    changes.push(f.label);
    const bad = f.check(v);
    if (bad) problems.push(`${f.label}: ${bad}`);
  }
  const gateList = gateChanges(baseGates, gates);
  changes.push(...gateList);
  if (gateList.length) {
    gates.forEach((g, i) => {
      for (const bad of Object.values(gateProblems(g))) problems.push(`Gate ${i + 1}: ${bad}`);
    });
  }
  return { changes, problems };
}

/**
 * The document to save: a copy of the one loaded, with each changed field
 * set at its own path. A field the form did not change is not written, and
 * the gate list is replaced only when a gate changed.
 */
export function withEdits(doc: Doc, fields: Map<string, FieldSpec>, edits: Record<string, string>, baseGates: GateDraft[], gates: GateDraft[]): Doc {
  const next = structuredClone(doc);
  for (const f of fields.values()) {
    const v = edits[f.key];
    if (v !== undefined && changed(f.kind, f.base, v)) f.write(next, v);
  }
  if (gateChanges(baseGates, gates).length) writeGates(next, baseGates, gates);
  return next;
}
