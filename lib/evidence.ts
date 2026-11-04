import type { EvidencePack, EvidenceQuery, SignedDecision } from "./api/l9";

/**
 * Evidence packs in words (phase L9): a pack for a control or a framework
 * over a period, and how a person asks for one. Pure.
 */

const when = (iso: string | null | undefined): string => (iso ? iso.replace("T", " ").replace(/\.\d+Z$|Z$/, " UTC") : "");

export interface PackForm {
  control: string;
  /** A control key the catalogue does not map (lockdown, breaker, rate_limit): takes the place of `control`. */
  key: string;
  framework: string;
  /** `YYYY-MM-DD`, or `datetime-local` text; empty for the door's default (30 days to now). */
  from: string;
  to: string;
  agent: string;
}

export const EMPTY_PACK_FORM: PackForm = { control: "", key: "", framework: "", from: "", to: "", agent: "" };

const iso = (text: string, end = false): string | undefined => {
  const t = text.trim();
  if (!t) return undefined;
  const dated = /^\d{4}-\d{2}-\d{2}$/.test(t) ? `${t}T${end ? "23:59:59" : "00:00:00"}Z` : t;
  const ms = Date.parse(dated);
  return Number.isNaN(ms) ? t : new Date(ms).toISOString();
};

/** The door's query, from the form. A time the door will not parse is sent as typed, so its own refusal names it. */
export function packQuery(f: PackForm): EvidenceQuery {
  const q: EvidenceQuery = {};
  const control = f.key.trim() || f.control;
  if (control) q.control = control;
  if (f.framework) q.framework = f.framework;
  const from = iso(f.from);
  const to = iso(f.to, true);
  if (from) q.from = from;
  if (to) q.to = to;
  if (f.agent) q.agent = f.agent;
  return q;
}

export const packProblem = (f: PackForm): string => (f.control || f.key.trim() || f.framework ? "" : "Name a control or a framework.");

/** What the pack holds, in a line. */
export function packLine(p: EvidencePack): string {
  const c = p.counts;
  const n = (x: number, one: string, many = `${one}s`) => `${x} ${x === 1 ? one : many}`;
  return [n(c.firings, "firing"), n(c.decisions, "signed decision"), n(c.runs, "run"), n(c.versions, "policy version"), n(c.changes, "policy change"), n(c.identities, "identity", "identities")].join(" · ");
}

export const periodLine = (p: Pick<EvidencePack["pack"], "from" | "to">): string => `${when(p.from)} to ${when(p.to)}`;

/** A signed decision in a line: the answer, who, and through what. */
export function decisionLine(d: Pick<SignedDecision, "approved" | "aborted" | "by" | "at" | "via" | "note">): string {
  const said = d.aborted ? "Closed at the gate" : d.approved ? "Approved" : "Refused";
  return `${said} by ${d.by || "someone"} ${when(d.at)}${d.via && d.via !== "resume" ? ` (${d.via})` : ""}${d.note ? `: ${d.note}` : ""}`;
}

/** Where a decision was read from: the hash chain, or a stamp only the record's own copy holds. */
export const stampLine = (d: Pick<SignedDecision, "chained" | "disagrees">): string =>
  d.disagrees.length
    ? `The record's copy disagrees with the chain on ${d.disagrees.map((x) => x.field).join(", ")}: this is the chain's`
    : d.chained
      ? "Read from the hash chain"
      : "Controls stamped on the record, outside the chain";

/** Why a pack has no firing: said plainly, since an assessor reads silence as a pass. */
export const noFiringLine = (p: EvidencePack): string => (p.chain.status === "unavailable" ? "The run records could not be read, so nothing is known about firings in this period." : p.controls.length ? "No firing of this control in the period. Its statement and mappings still stand; a control that never fired is not evidence it works." : "No firing of this key in the period.");
