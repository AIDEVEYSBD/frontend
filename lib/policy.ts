import type { Tone } from "@/components/ui";
import type { ChangeState, DiffChange, PolicyChange, PolicyDiff, PolicyTarget, Ruling, SimWindow, SimulationResult, TargetKind } from "./api/l9";
import { DoorError } from "./api/l5";
import { dataClassChoices } from "./bom";

/**
 * Policy as reviewed change, as a person meets it (phase L9): the words for a
 * change's states and moves, a target as a form, and what a simulation found.
 * Pure: components/policy.tsx renders these, tests/l9-contract.test.ts holds
 * them against the backend's own answers.
 */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ═══════════════════ a change ═══════════════════ */

export const CHANGE_STATE_META: Record<ChangeState, { label: string; tone: Tone }> = {
  pending: { label: "Awaiting review", tone: "warn" },
  approved: { label: "Approved, not yet effective", tone: "queue" },
  applied: { label: "Applied", tone: "ok" },
  rejected: { label: "Rejected", tone: "neutral" },
  rolled_back: { label: "Rolled back", tone: "err" },
  failed: { label: "Failed", tone: "err" },
};

export const TARGET_LABEL: Record<string, string> = {
  attached: "Attached agent",
  guardian: "Guardian",
  breakers: "Estate breakers",
  rate_limits: "Rate limits",
  screener: "Screener",
  retention: "Retention",
  redaction: "Redaction",
  autonomy_tiers: "Autonomy tiers",
  attestation: "Attestation period",
  peer: "Peer data classes",
};

export const targetLabel = (kind: string): string => TARGET_LABEL[kind] ?? kind.replace(/_/g, " ");

const isEstate = (id: string) => !id || id === "estate";

/** A target as a line: `Rate limits, tiny`, or `Guardian` for the estate's. */
export const targetLine = (t: PolicyTarget): string => (isEstate(t.id) ? targetLabel(t.kind) : `${targetLabel(t.kind)}, ${t.id}`);

/** `?target=` for the history door: a kind, or `kind:id`. */
export const targetQuery = (t: PolicyTarget): string => (isEstate(t.id) ? t.kind : `${t.kind}:${t.id}`);

/** The diff to read: as applied once it landed (the rules may have moved since it was proposed), else as proposed. */
export const diffOf = (c: Pick<PolicyChange, "diff" | "applied_diff">): PolicyDiff => c.applied_diff ?? c.diff;

/** One line of what it changes. */
export const changeSummary = (c: Pick<PolicyChange, "diff" | "applied_diff">): string => {
  const lines = diffOf(c).summary;
  return lines.length ? lines.join("; ") : "changes nothing";
};

const shown = (v: unknown): string => {
  if (v === null || v === undefined) return "unset";
  if (v === "") return "none";
  if (typeof v === "string") return v;
  return JSON.stringify(v);
};

/** One field of a diff: what was and what would be, or what a list gains and loses. */
export function diffCells(d: DiffChange): { from: string; to: string } {
  const list = d.added !== null || d.removed !== null || d.changed !== null;
  if (!list) return { from: shown(d.from), to: shown(d.to) };
  const items = (xs: unknown[] | null) => (xs ?? []).map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
  const gone = items(d.removed);
  const moved = items(d.changed);
  const added = items(d.added);
  return { from: gone.length ? `removes ${gone.join(", ")}` : "", to: [added.length ? `adds ${added.join(", ")}` : "", moved.length ? `changes ${moved.join(", ")}` : ""].filter(Boolean).join("; ") };
}

/** A person's name as the backend signs them: `Ada <ada@example.com>`, or the name alone. */
export interface Who {
  name: string;
  email: string;
}

/** Whether `who` signed `signed`. The backend holds this on the identity; this only says it sooner. */
export function signedBy(signed: string, who: Who | null): boolean {
  if (!who || !signed) return false;
  const s = signed.trim().toLowerCase();
  const email = who.email.trim().toLowerCase();
  const name = who.name.trim().toLowerCase();
  return Boolean((email && s.includes(`<${email}>`)) || (email && s === email) || (name && s === name) || (name && email && s === `${name} <${email}>`));
}

export interface Move {
  /** The door would hear it from someone with the permission. */
  open: boolean;
  /** Why it is closed, in a line; "" when open. */
  why: string;
}

/** What may be done to a change now, by whom. Permission is the button's own; this is the change's state and separation of duties. */
export function movesOf(c: Pick<PolicyChange, "state" | "proposed_by">, who: Who | null): { approve: Move; reject: Move; rollback: Move } {
  const mine = signedBy(c.proposed_by, who);
  const label = CHANGE_STATE_META[c.state].label.toLowerCase();
  return {
    approve:
      c.state !== "pending"
        ? { open: false, why: `it is ${label}` }
        : mine
          ? { open: false, why: "you proposed it: its proposer may not approve it; another administrator does" }
          : { open: true, why: "" },
    reject: c.state === "pending" || c.state === "approved" ? { open: true, why: "" } : { open: false, why: `it is ${label}` },
    rollback: c.state === "applied" ? { open: true, why: "" } : { open: false, why: `it is ${label}: only an applied change is rolled back` },
  };
}

/** Where a change stands, in a line: who has it and what happens next. */
export function changeLine(c: PolicyChange): string {
  switch (c.state) {
    case "pending":
      return `Waiting for someone other than ${c.proposed_by || "its proposer"} to review it${c.effective_at ? `; effective ${when(c.effective_at)} once approved` : "; applied at once on approval"}.`;
    case "approved":
      return `Approved by ${c.approved_by}; the scheduler applies it at ${when(c.effective_at)}. It can still be rejected.`;
    case "applied":
      return c.emergency ? `Emergency rollback by ${c.applied_by || c.proposed_by}: no second person, raised for review.` : `Applied ${when(c.applied_at)} by ${c.applied_by}, approved by ${c.approved_by}.`;
    case "rejected":
      return `Rejected by ${c.rejected_by}: ${c.reject_reason}`;
    case "rolled_back":
      return `Rolled back by ${c.rolled_back_by} ${when(c.rolled_back_at)}.`;
    case "failed":
      return `Failed when it fell due: ${c.error || "the target was gone"}.`;
  }
}

const when = (iso: string | null | undefined): string => (iso ? iso.replace("T", " ").replace(/\.\d+Z$|Z$/, " UTC") : "");

/**
 * Text for an effective time as the door takes it. `value` is a
 * `datetime-local` value, read in the person's own zone: "" for at once.
 */
export function effectiveAt(value: string): string | null {
  if (!value.trim()) return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

export function effectiveProblem(value: string, now = Date.now()): string {
  if (!value.trim()) return "";
  const t = Date.parse(value);
  if (Number.isNaN(t)) return "an effective time is a date and a time";
  return t < now ? "that time has passed: leave it empty to apply on approval" : "";
}

/* ═══════════════════ a target as a form ═══════════════════ */

export type FieldKind = "bool" | "number" | "list" | "text" | "longtext" | "choice" | "json";

export interface ProposalField {
  name: string;
  label: string;
  kind: FieldKind;
  /** For `choice`. */
  choices?: { value: string; label: string }[];
  hint?: string;
  /** A one-item list of `*` goes to the door as the string: every agent. */
  star?: boolean;
}

export const GATE_CHOICES = [
  { value: "", label: "never" },
  { value: "read", label: "read and above" },
  { value: "write", label: "write and above" },
  { value: "risky", label: "risky and above" },
  { value: "destructive", label: "destructive only" },
];

const FIXED: Record<string, Pick<ProposalField, "kind" | "choices" | "hint" | "star">> = {
  "attached.grants": { kind: "list", hint: "registry tools, as server.tool" },
  "attached.gate_at": { kind: "choice", choices: GATE_CHOICES },
  "attached.gates": { kind: "json", hint: "a JSON list of gate rules, written as an agent definition writes them" },
  "attached.scope": { kind: "json", hint: "a JSON object: each granted tool, the argument values it may be called with" },
  "attestation.period_days": { kind: "number", hint: "days; the default is 90" },
  "guardian.agents": { kind: "list", hint: "agent ids; * for every agent", star: true },
  "peer.data_class": { kind: "choice", choices: dataClassChoices("undeclared"), hint: "what it returns; a task it sends in starts at this class or higher" },
  "peer.max_data_class": { kind: "choice", choices: dataClassChoices("no limit here"), hint: "a spec's own limit holds beside this one, and the lower decides" },
  "guardian.may": { kind: "list", hint: "hold, block, redirect" },
  "guardian.model": { kind: "text" },
  "guardian.rubric": { kind: "longtext" },
  "redaction.patterns": { kind: "json", hint: "a JSON object: a rule's name, its regular expression" },
  "screener.patterns": { kind: "list", hint: "phrases blocked before the screener port" },
};

/** The form's fields, from what the door says of the target: its names and labels, each field's kind read from the rules it holds now. */
export function fieldsOf(t: Pick<TargetKind, "kind" | "fields" | "labels">, current: Record<string, unknown> | null, inherits: Record<string, unknown> | null = null): ProposalField[] {
  return t.fields.map((name) => {
    const fixed = FIXED[`${t.kind}.${name}`];
    const said = t.labels[name] ?? name.replace(/_/g, " ");
    const label = `${said.charAt(0).toUpperCase()}${said.slice(1)}`;
    if (fixed) return { name, label, ...fixed };
    const v = current?.[name];
    // A list of words is edited as chips; a list of objects (gate rules) or an object is edited as JSON.
    const kind: FieldKind =
      typeof v === "boolean" ? "bool" : Array.isArray(v) ? (v.some((x) => x !== null && typeof x === "object") ? "json" : "list") : typeof v === "string" ? "text" : v && typeof v === "object" ? "json" : "number";
    const nullable = v === null || v === undefined;
    // An agent's own limit, shown so it can be cleared: empty goes back to the estate's.
    if (inherits && kind === "number") return { name, label, kind, hint: `empty inherits the estate's: ${String(inherits[name] ?? "unset")}` };
    return { name, label, kind, ...(kind === "number" && nullable ? { hint: t.kind === "retention" ? "days; empty keeps the records" : "empty inherits the estate's" } : {}) };
  });
}

/** One id's own rules in a line, the fields it leaves to the estate left out. */
export function byIdLine(t: Pick<TargetKind, "labels">, rules: Record<string, unknown>): string {
  const set = Object.entries(rules).filter(([, v]) => v !== null && v !== "");
  return set.length ? set.map(([k, v]) => `${t.labels[k] ?? k} ${shown(v)}`).join(", ") : "nothing of its own";
}

/** What the form holds: text until sent, so a half-typed value is not lost. */
export type DraftValue = string | boolean | string[];
export type Draft = Record<string, DraftValue>;

export function draftOf(fields: readonly ProposalField[], current: Record<string, unknown> | null): Draft {
  const d: Draft = {};
  for (const f of fields) {
    const v = current?.[f.name];
    if (f.kind === "bool") d[f.name] = v === true;
    else if (f.kind === "list") d[f.name] = Array.isArray(v) ? v.map(String) : v === "*" ? ["*"] : [];
    else if (f.kind === "json") d[f.name] = v === null || v === undefined ? "{}" : JSON.stringify(v, null, 2);
    else d[f.name] = v === null || v === undefined ? "" : String(v);
  }
  return d;
}

function value(f: ProposalField, raw: DraftValue): { ok: true; value: unknown } | { ok: false; problem: string } {
  if (f.kind === "bool") return { ok: true, value: raw === true };
  if (f.kind === "list") return { ok: true, value: f.star && Array.isArray(raw) && raw.length === 1 && raw[0] === "*" ? "*" : raw };
  const text = String(raw).trim();
  if (f.kind === "number") {
    if (!text) return { ok: true, value: null };
    const n = Number(text);
    return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, problem: "a number, please" };
  }
  if (f.kind === "json") {
    try {
      const parsed = JSON.parse(text || "{}") as unknown;
      if (parsed && typeof parsed === "object") return { ok: true, value: parsed };
    } catch {
      /* said below */
    }
    return { ok: false, problem: "a JSON object or list, please" };
  }
  return { ok: true, value: String(raw) };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The fields that moved, as the door takes them, and what would be refused before anything is sent. */
export function patchOf(fields: readonly ProposalField[], draft: Draft, current: Record<string, unknown> | null): { patch: Record<string, unknown>; problems: Record<string, string> } {
  const patch: Record<string, unknown> = {};
  const problems: Record<string, string> = {};
  for (const f of fields) {
    if (!(f.name in draft)) continue;
    const r = value(f, draft[f.name]);
    if (!r.ok) {
      problems[f.name] = r.problem;
      continue;
    }
    const was = value(f, draftOf([f], current)[f.name]);
    if (!was.ok || !same(r.value, was.value)) patch[f.name] = r.value;
  }
  return { patch, problems };
}

/** The field a 400 from the door names (`proposed.calls`), or null when it names the proposal as a whole. */
export function proposedField(e: unknown): string | null {
  if (!(e instanceof DoorError) || !e.field) return null;
  return e.field.startsWith("proposed.") ? e.field.slice("proposed.".length) : null;
}

/** A proposal that has gone in, in a sentence with where it goes next. */
export function proposedLine(c: PolicyChange): string {
  return `Proposed as ${c.id}: ${changeSummary(c)}. Someone other than you reviews it${c.effective_at ? ` and it takes effect ${when(c.effective_at)}` : ", and it applies on approval"}.`;
}

/**
 * An attached agent's policy editor, split by door: grants and gate risk are a
 * policy target and go to review; the injection filter and the A2A secret stay
 * `PATCH /api/attached`, which answers 409 for the others.
 */
function sortedLimits(limits: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(limits).sort()) {
    const v = limits[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k] = v;
  }
  return out;
}

export function attachedSplit(
  row: { grants: string[]; gate_at: string; injection: string; secret_name?: string | null; model?: string; models?: string[]; fallbacks?: string[]; limits?: Record<string, unknown> },
  draft: { grants: string[]; gate_at: string; injection: string; secret_name: string; model?: string; models?: string[]; fallbacks?: string[]; limits?: Record<string, unknown> },
): { reviewed: Record<string, unknown>; direct: { injection?: string; secret_name?: string } } {
  const reviewed: Record<string, unknown> = {};
  if ([...draft.grants].sort().join() !== [...row.grants].sort().join()) reviewed.grants = draft.grants;
  if (draft.gate_at !== row.gate_at) reviewed.gate_at = draft.gate_at;
  // Routing and limits go the same way as the grants: a person other than the proposer says yes.
  if (draft.model !== undefined && draft.model !== (row.model ?? "")) reviewed.model = draft.model;
  if (draft.models !== undefined && draft.models.join() !== (row.models ?? []).join()) reviewed.models = draft.models;
  if (draft.fallbacks !== undefined && draft.fallbacks.join() !== (row.fallbacks ?? []).join()) reviewed.fallbacks = draft.fallbacks;
  if (draft.limits !== undefined && JSON.stringify(sortedLimits(draft.limits)) !== JSON.stringify(sortedLimits(row.limits ?? {}))) reviewed.limits = sortedLimits(draft.limits);
  const direct: { injection?: string; secret_name?: string } = {};
  if (draft.injection !== row.injection) direct.injection = draft.injection;
  // The secret is sent only when it changed: the door checks the vault holds it, and "" removes it.
  if (draft.secret_name.trim() !== (row.secret_name ?? "")) direct.secret_name = draft.secret_name.trim();
  return { reviewed, direct };
}

/* ═══════════════════ simulation ═══════════════════ */

export const RULING_META: Record<Ruling, { label: string; tone: Tone }> = {
  allowed: { label: "allowed", tone: "ok" },
  refused: { label: "refused", tone: "err" },
  gated: { label: "gated", tone: "warn" },
};

export const SIM_WINDOWS: { value: string; label: string }[] = [
  { value: "24h", label: "The last 24 hours" },
  { value: "7d", label: "The last 7 days" },
  { value: "period", label: "A period" },
];

/** The request's window, from the form. */
export function simWindowOf(pick: string, from: string, to: string): SimWindow {
  if (pick !== "period") return pick;
  const iso = (x: string) => (x && !Number.isNaN(Date.parse(x)) ? new Date(x).toISOString() : x);
  return { from: iso(from), to: iso(to) };
}

/** The proposal as typed, or what is wrong with it. */
export function parseProposal(text: string): { proposed: Record<string, unknown> } | { problem: string } {
  try {
    const v = JSON.parse(text) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return { proposed: v as Record<string, unknown> };
  } catch {
    return { problem: "the proposal is not valid JSON" };
  }
  return { problem: "the proposal is a JSON object: a policy block, a whole spec, or an attached agent's fields" };
}

/** What a simulation found, in a sentence. */
export function simulationLine(r: SimulationResult): string {
  const ruled = `${plural(r.calls, "recorded call")} in ${plural(r.runs, "run")} ruled again`;
  if (!r.runs) return "No run in that window to rule again.";
  if (!r.changed.length) return `${ruled}: nothing would change.`;
  const parts = [
    r.summary.newly_refused ? `${r.summary.newly_refused} newly refused` : "",
    r.summary.newly_gated ? `${r.summary.newly_gated} newly gated` : "",
    r.summary.newly_allowed ? `${r.summary.newly_allowed} newly allowed` : "",
  ].filter(Boolean);
  return `${ruled}: ${parts.join(", ")}.`;
}

/** What was left out of the simulation, in lines; none when nothing was. */
export function simulationGaps(r: SimulationResult): string[] {
  const e = r.excluded;
  return [
    e.shadow ? `${plural(e.shadow, "shadow run")} left out: a mirror executes nothing above read` : "",
    e.no_spec ? `${plural(e.no_spec, "run")} left out: the spec it ran under is not on record` : "",
    e.no_journal ? `${plural(e.no_journal, "run")} left out: its journal is gone` : "",
    r.skipped.length ? `${plural(r.skipped.length, "call")} could not be ruled again` : "",
    r.truncated ? "The limit left older runs out; widen it, or narrow the window" : "",
  ].filter(Boolean);
}
