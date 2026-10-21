import type { AttentionItem, FormAnswer, Gate, GateField, VerdictItem, VerdictsAnswer } from "./api/l5";

/**
 * What the console decides about a gate before the backend does: whether a
 * form is complete and typed, which verdicts an item may still take, who may
 * press Submit, and in what order the attention queue reads. Pure, so
 * tests/gates.test.ts and tests/attention.test.ts hold every rule without a
 * browser. The backend validates again on resume (`AnswerError`); this is
 * the first reading, not the last.
 */

/* ═══════════════════ forms ═══════════════════ */

/**
 * A form's working state, as the inputs hold it: text for string, number
 * and object (raw JSON), a boolean or nothing for bool, a value or nothing
 * for choice, a list of strings for list.
 */
export type FormState = Record<string, string | boolean | string[] | undefined>;

export interface FormCheck {
  ok: boolean;
  /** Field name → why it does not pass. */
  errors: Record<string, string>;
  /** The typed answer, complete only when `ok`. */
  answer: FormAnswer;
}

/** The empty working state for a form: nothing typed, nothing chosen. */
export function emptyForm(fields: GateField[]): FormState {
  const s: FormState = {};
  for (const f of fields) s[f.name] = f.kind === "list" ? [] : f.kind === "bool" || f.kind === "choice" ? undefined : "";
  return s;
}

/** Validate one field of a form, by kind; the typed value when it passes. */
export function checkField(f: GateField, raw: FormState[string]): { error?: string; value?: unknown } {
  const label = f.label ?? f.name;
  switch (f.kind) {
    case "string": {
      const v = typeof raw === "string" ? raw.trim() : "";
      if (!v) return f.required ? { error: `${label} is required` } : {};
      return { value: v };
    }
    case "number": {
      const v = typeof raw === "string" ? raw.trim() : "";
      if (!v) return f.required ? { error: `${label} is required` } : {};
      const n = Number(v);
      if (!Number.isFinite(n)) return { error: `${label} must be a number` };
      return { value: n };
    }
    case "bool": {
      if (typeof raw !== "boolean") return f.required ? { error: `${label} needs a yes or a no` } : {};
      return { value: raw };
    }
    case "choice": {
      const v = typeof raw === "string" ? raw : "";
      if (!v) return f.required ? { error: `${label} needs a choice` } : {};
      const choices = f.choices ?? [];
      if (choices.length && !choices.includes(v)) return { error: `${label} must be one of ${choices.join(", ")}` };
      return { value: v };
    }
    case "list": {
      const v = Array.isArray(raw) ? raw.map((x) => x.trim()).filter(Boolean) : [];
      if (!v.length) return f.required ? { error: `${label} needs at least one entry` } : { value: [] };
      return { value: v };
    }
    case "object": {
      const v = typeof raw === "string" ? raw.trim() : "";
      if (!v) return f.required ? { error: `${label} is required` } : {};
      let parsed: unknown;
      try {
        parsed = JSON.parse(v);
      } catch {
        return { error: `${label} is not valid JSON` };
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { error: `${label} must be a JSON object` };
      if (f.required && Object.keys(parsed as object).length === 0) return { error: `${label} must not be empty` };
      return { value: parsed };
    }
  }
}

/** Validate a whole form. Optional fields left blank are omitted from the answer, never sent as empty strings. */
export function validateForm(fields: GateField[], state: FormState): FormCheck {
  const errors: Record<string, string> = {};
  const answer: FormAnswer = {};
  for (const f of fields) {
    const r = checkField(f, state[f.name]);
    if (r.error) errors[f.name] = r.error;
    else if (r.value !== undefined) answer[f.name] = r.value;
  }
  return { ok: Object.keys(errors).length === 0, errors, answer };
}

/* ═══════════════════ verdicts ═══════════════════ */

/**
 * The verdicts an item may take now. With no verdict yet, any of the gate's
 * verdicts. With one, `transitions[current]` lists where it may move, and
 * staying put is always allowed; a verdict with no entry is unconstrained
 * (the spec limits only the moves it names), and an entry that is an empty
 * list is terminal.
 */
export function allowedVerdicts(current: string | null, verdicts: string[], transitions: Record<string, string[]>): string[] {
  if (!current) return verdicts;
  const next = transitions[current];
  if (next === undefined) return verdicts.includes(current) ? verdicts : [current, ...verdicts];
  const out = [current];
  for (const v of next) if (!out.includes(v) && verdicts.includes(v)) out.push(v);
  return out;
}

export interface VerdictCheck {
  ok: boolean;
  /** Item id → why it does not pass. */
  errors: Record<string, string>;
  answer: VerdictsAnswer;
}

/** Every item needs a verdict, and each must be one its current verdict allows. */
export function validateVerdicts(items: VerdictItem[], verdicts: string[], transitions: Record<string, string[]>, chosen: Record<string, string | undefined>): VerdictCheck {
  const errors: Record<string, string> = {};
  const out: Record<string, string> = {};
  for (const it of items) {
    const v = chosen[it.id] ?? it.verdict ?? "";
    if (!v) {
      errors[it.id] = "needs a verdict";
      continue;
    }
    const allowed = allowedVerdicts(it.verdict, verdicts, transitions);
    if (!allowed.includes(v)) {
      errors[it.id] = it.verdict ? `${it.verdict} may only move to ${allowed.filter((x) => x !== it.verdict).join(", ") || "nothing"}` : `${v} is not one of ${verdicts.join(", ")}`;
      continue;
    }
    out[it.id] = v;
  }
  return { ok: Object.keys(errors).length === 0, errors, answer: { verdicts: out } };
}

/** Set every item to `verdict` where its transitions allow; the rest keep what they had. Returns the new choice map. */
export function bulkVerdict(items: VerdictItem[], verdicts: string[], transitions: Record<string, string[]>, chosen: Record<string, string | undefined>, verdict: string): Record<string, string | undefined> {
  const next = { ...chosen };
  for (const it of items) if (allowedVerdicts(it.verdict, verdicts, transitions).includes(verdict)) next[it.id] = verdict;
  return next;
}

/* ═══════════════════ the answer, as the doors read it ═══════════════════ */

/**
 * Whether a form declares its own `note` field. The approvals and answer
 * doors take the body's `note` over the answer's whenever the body's is not
 * empty, so a separate note box beside such a form would overwrite the
 * field; the field is the note.
 */
export function declaresNote(gate: Pick<Gate, "shape" | "fields">): boolean {
  return gate.shape === "form" && gate.fields.some((f) => f.name === "note");
}

/**
 * Where a 400's `field` belongs in the dialog: a form field by its name,
 * one verdict by its item id (`verdicts.<id>`), the decision itself
 * (`approved`, shown as `decision`). The message loses its `field: `
 * prefix, which the place it is shown already says. Empty when the field
 * is none of these (the answer as a whole, `aborted`): the message is shown
 * as the dialog's failure instead.
 */
export function refusalErrors(gate: Pick<Gate, "fields" | "items">, field: string | undefined, message: string): Record<string, string> {
  if (!field) return {};
  const text = message.startsWith(`${field}: `) ? message.slice(field.length + 2) : message;
  if (field === "approved") return { decision: text };
  if (field.startsWith("verdicts.")) {
    const id = field.slice("verdicts.".length);
    return gate.items.some((i) => i.id === id) ? { [id]: text } : {};
  }
  return gate.fields.some((f) => f.name === field) ? { [field]: text } : {};
}

/* ═══════════════════ the chain ═══════════════════ */

export interface ChainPosition {
  /** The gate has walked at least once, so its first approvers were passed over. The row no longer names them: each escalation replaces the approvers. */
  passedFirst: boolean;
  /** Roles of the chain already walked past, before the current one. */
  passed: string[];
  current: string[];
  /** What the gate walks to next if this deadline passes too; empty when the chain is spent. */
  ahead: string[];
}

/**
 * Where an unanswered gate stands on its escalation chain. The backend
 * serves `chain` as the spec's `escalate_to`, never trimmed, and
 * `escalations` as the steps walked; after k steps the approvers are
 * chain[k-1] and what is ahead is the rest of the chain.
 */
export function chainOf(gate: Pick<Gate, "approvers" | "chain" | "escalations">): ChainPosition {
  const k = Math.max(0, Math.min(gate.escalations, gate.chain.length));
  return { passedFirst: k > 0, passed: gate.chain.slice(0, Math.max(0, k - 1)), current: gate.approvers, ahead: gate.chain.slice(k) };
}

/* ═══════════════════ who may answer ═══════════════════ */

export interface Who {
  /** `autox:roles` from the token. */
  roles: readonly string[];
  /** `autox:app_roles`; "administrator" passes every gate. */
  appRoles: readonly string[];
}

export interface Access {
  ok: boolean;
  /** Why not, in a line the dialog shows beside the disabled Submit. */
  reason: string;
}

/**
 * Whether this person may answer a gate whose `approvers` are roles. A gate
 * with no approvers is anyone's. Otherwise one of the person's roles (either
 * list) must be named, or the person is an administrator. The backend
 * refuses the same way (403 naming the role missing); this only stops the
 * click from happening first.
 */
export function gateAccess(who: Who | null, approvers: readonly string[]): Access {
  if (!approvers.length) return { ok: true, reason: "" };
  if (!who) return { ok: false, reason: `Only ${approvers.join(", ")} may answer this gate; your roles are not known yet.` };
  if (who.appRoles.includes("administrator")) return { ok: true, reason: "" };
  const mine = new Set([...who.roles, ...who.appRoles]);
  if (approvers.some((r) => mine.has(r))) return { ok: true, reason: "" };
  const have = [...mine];
  return { ok: false, reason: `Only ${approvers.join(", ")} may answer this gate (or an administrator). Your roles: ${have.length ? have.join(", ") : "none"}.` };
}

/** Several gates answered together must be one agent's, of one shape, and each must be this person's to answer. */
export function batchable(gates: readonly Gate[], who: Who | null): Access {
  if (gates.length < 2) return { ok: false, reason: "Select at least two gates to answer them together." };
  const agents = new Set(gates.map((g) => g.agent));
  if (agents.size > 1) return { ok: false, reason: `A batch answers one agent's gates; selected: ${[...agents].join(", ")}.` };
  const shapes = new Set(gates.map((g) => g.shape));
  if (shapes.size > 1) return { ok: false, reason: `A batch answers gates of one shape; selected: ${[...shapes].join(", ")}.` };
  for (const g of gates) {
    const a = gateAccess(who, g.approvers);
    if (!a.ok) return { ok: false, reason: `${g.run}: ${a.reason}` };
  }
  return { ok: true, reason: "" };
}

/* ═══════════════════ time ═══════════════════ */

/** A deadline as a countdown: `2d 4h`, `3h 12m`, `8m`, `40s`, or `overdue 2h`. Null deadline reads as "no deadline". */
export function countdown(deadline: string | null, now: number): { text: string; overdue: boolean; soon: boolean } {
  if (!deadline) return { text: "no deadline", overdue: false, soon: false };
  const at = Date.parse(deadline);
  if (Number.isNaN(at)) return { text: "no deadline", overdue: false, soon: false };
  const left = at - now;
  const span = (ms: number) => {
    const s = Math.floor(Math.abs(ms) / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ${m % 60}m`;
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  };
  if (left <= 0) return { text: `overdue ${span(left)}`, overdue: true, soon: true };
  return { text: span(left), overdue: false, soon: left < 3_600_000 };
}

/* ═══════════════════ attention ═══════════════════ */

export const ATTENTION_LABEL: Record<AttentionItem["kind"], string> = {
  gate: "gate",
  refusal: "refusal",
  budget: "budget",
  dead_letter: "dead letter",
  health: "health",
};

export const ACTION_LABEL: Record<AttentionItem["action"]["kind"], string> = {
  answer: "Answer",
  replay: "Replay",
  check: "Re-check",
  open: "Open",
};

/**
 * The severity (1 to 10) from which a row reads as urgent: a gate past its
 * deadline (10) or due within the hour (9), a breached budget or a failing
 * port (8), a gate due within the day that holds a sink or a destructive
 * call (8).
 */
export const URGENT_SEVERITY = 8;

/** What a gate stands in front of (`holds`), as its tag reads. */
export const HOLDS_LABEL: Record<string, string> = { sink: "holds a sink", destructive: "destructive call", risky: "risky call", write: "write call" };

/**
 * The order the queue reads in: the backend's rank (severity × age) first,
 * the nearer deadline next among equals, then the older row, then the id so
 * the order is total. Rows arrive ranked; this holds the order when a row
 * is added or aged between reads.
 */
export function orderAttention(items: readonly AttentionItem[]): AttentionItem[] {
  const deadline = (x: AttentionItem) => (x.deadline ? Date.parse(x.deadline) : Number.POSITIVE_INFINITY);
  return [...items].sort((a, b) => b.rank - a.rank || deadline(a) - deadline(b) || b.age_s - a.age_s || a.id.localeCompare(b.id));
}

/** The one verb that clears a row, as the button reads. */
export function attentionVerb(item: AttentionItem): string {
  return ACTION_LABEL[item.action.kind];
}
