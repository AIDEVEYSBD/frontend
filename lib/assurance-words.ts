import type { Tone } from "@/components/ui";
import type { ChainReading, EvidencePack, EvidenceQuery, FrameworkInfo, LedgerVerification, ObligationStatus, PackChainStatus, RegulatoryView, RunVerification } from "./api/assurance";

/**
 * The assurance screens in words: the chain (the run page and the Ledger
 * page), evidence packs, and frameworks. The answers are read in
 * lib/api/assurance.ts. Pure.
 *
 * The chain: each run's journal entries are chained from a genesis bound to
 * the run and its definition, and the run's own row holds the last hash and
 * the count. A reading is "holds" or "broken"; the platform's own sentence
 * says what was checked or where it broke.
 */

/* ═══════════════════ the chain ═══════════════════ */

export const CHAIN_META: Record<ChainReading, { label: string; tone: Tone; means: string }> = {
  ok: { label: "Chain holds", tone: "ok", means: "every entry hashes to the next from the run's genesis, and the run's row holds the last hash and the count" },
  broken: { label: "Chain broken", tone: "err", means: "the record is not what was written" },
};

export const PACK_CHAIN_META: Record<PackChainStatus, { label: string; tone: Tone; means: string }> = {
  no_runs: { label: "No run to verify", tone: "neutral", means: "this pack cites no run, so the chain says nothing about it" },
  ok: { label: "Every cited run holds", tone: "ok", means: "each run cited verifies against its own chain, checked when the pack was built" },
  broken: { label: "A cited run is broken", tone: "err", means: "a run cited is not what was written" },
};

/** A run's reading, beside its status: where it breaks, or what was checked, in the platform's words. */
export function verifyLine(v: RunVerification): string {
  const at = v.broken_at === null ? "" : v.broken_at > v.entries ? `Past entry ${v.entries}: ` : `At entry ${v.broken_at}: `;
  const why = v.reason || CHAIN_META[v.chain].means;
  return at ? `${at}${why}.` : `${why.charAt(0).toUpperCase()}${why.slice(1)}.`;
}

/** What a pack's chain says, from the platform's own status. A pack that cites no run has its own: `no_runs`, never `ok`. */
export function packChainLine(c: { status: PackChainStatus; runs: number }): { title: string; tone: Tone; line: string } {
  const m = PACK_CHAIN_META[c.status];
  const means = `${m.means.charAt(0).toUpperCase()}${m.means.slice(1)}.`;
  return { title: m.label, tone: m.tone, line: c.status === "no_runs" ? means : `${means} ${c.runs} run${c.runs === 1 ? "" : "s"} cited.` };
}

/** The walk as a headline: every run's chain and the audit trail's. */
export function ledgerHeadline(l: LedgerVerification): { title: string; tone: Tone; line: string } {
  const scope = `${l.runs} run${l.runs === 1 ? "" : "s"}`;
  const rows = l.audit ? `${l.audit.rows} row${l.audit.rows === 1 ? "" : "s"}` : "";
  const trail = l.audit ? (l.audit.valid ? `the audit trail's ${rows} ${l.audit.rows === 1 ? "holds" : "hold"}` : `the audit trail breaks at row ${l.audit.broken_at}`) : "the audit trail was not checked";
  if (!l.valid) {
    const runs = l.breaks.length ? `${l.breaks.length} of ${scope} do${l.breaks.length === 1 ? "es" : ""} not verify` : `every one of ${scope} holds`;
    return { title: "The record does not verify", tone: "err", line: `${runs}; ${trail}.` };
  }
  if (!l.runs) return { title: "No run in this view", tone: "neutral", line: `No run was created in this view; ${trail}.` };
  return { title: "The record verifies", tone: "ok", line: `Every one of ${scope} holds, and ${trail}.` };
}

/** What sits beside the walk. */
export function ledgerNotes(l: LedgerVerification): string[] {
  return [l.truncated ? "The walk stopped at its limit; narrow the period or the agent to read the rest" : ""].filter(Boolean);
}

/* ═══════════════════ evidence packs ═══════════════════ */

/** What a line about a decision reads: a gate's answer, from a pack or from a run's own record. */
interface Answer {
  approved: boolean;
  aborted: boolean;
  by: string;
  at: string;
  via: string;
  note: string;
}

const when = (iso: string | null | undefined): string => (iso ? iso.replace("T", " ").replace(/\.\d+Z$|Z$/, " UTC") : "");

export interface PackForm {
  control: string;
  /** A key the journal names that the catalogue does not map: takes the place of `control`. */
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
  return [n(c.firings, "firing"), n(c.decisions, "signed decision"), n(c.runs, "run"), n(c.versions, "definition", "definitions"), n(c.identities, "identity", "identities")].join(" · ");
}

export const periodLine = (p: Pick<EvidencePack["pack"], "from" | "to">): string => `${when(p.from)} to ${when(p.to)}`;

/** A signed decision in a line: the answer, who, and through what. */
export function decisionLine(d: Answer): string {
  const said = d.aborted ? "Closed at the gate" : d.approved ? "Approved" : "Refused";
  return `${said} by ${d.by || "someone"} ${when(d.at)}${d.via && d.via !== "resume" ? ` (${d.via})` : ""}${d.note ? `: ${d.note}` : ""}`;
}

/** Where a decision was read from: the hash chain, or a stamp only the record's own copy holds. */
export const stampLine = (d: { chained: boolean; disagrees: { field: string }[] }): string =>
  d.disagrees.length
    ? `The record's copy disagrees with the chain on ${d.disagrees.map((x) => x.field).join(", ")}: this is the chain's`
    : d.chained
      ? "Recorded on the run"
      : "Controls stamped on the record, outside the chain";

/** Why a pack has no firing: said plainly, since an assessor reads silence as a pass. */
export const noFiringLine = (p: EvidencePack): string =>
  p.controls.length && p.outside_a_run.length === p.controls.length
    ? "These controls act outside a run: no journal entry names them, so no firing of them is counted."
    : p.controls.length
      ? "No firing in the period. A control that never fired is not evidence that it works."
      : "No firing of this key in the period.";

/* ═══════════════════ frameworks ═══════════════════ */

export const OBLIGATION_META: Record<ObligationStatus, { label: string; tone: Tone; means: string }> = {
  evidenced: { label: "Evidenced", tone: "ok", means: "a control answering it is enforced now and fired in the period" },
  configured: { label: "Configured", tone: "run", means: "a control answering it is enforced now; none fired in the period" },
  not_evidenced: { label: "Not evidenced", tone: "err", means: "no control answering it is enforced now, or none answers it" },
};

/** A control's enforcement, as the platform read it when the view was asked for. */
export const CONFIGURATION_META: Record<string, { label: string; tone: Tone }> = {
  enforced: { label: "enforced", tone: "ok" },
  partly: { label: "partly enforced", tone: "warn" },
  not_enforced: { label: "not enforced", tone: "err" },
  unknown: { label: "enforcement unknown", tone: "neutral" },
};

/** Whether anything is mapped: a framework with no obligations has nothing to show an agent against. */
export const isUnmapped = (f: Pick<FrameworkInfo, "obligations">): boolean => f.obligations.length === 0;

/** The plain sentence for a framework nothing is mapped to. */
export const unmappedLine = (f: Pick<FrameworkInfo, "short" | "why">): string => f.why || `No obligation of ${f.short} is mapped to a control, so nothing here can be read as meeting it.`;

export function frameworkLine(f: Pick<FrameworkInfo, "obligations">): string {
  return isUnmapped(f) ? "no obligations mapped" : `${f.obligations.length} obligation${f.obligations.length === 1 ? "" : "s"}`;
}

/** The estate against one framework: each status counted over every agent. */
export function viewCounts(v: Pick<RegulatoryView, "agents">): Record<ObligationStatus, number> {
  const out: Record<ObligationStatus, number> = { evidenced: 0, configured: 0, not_evidenced: 0 };
  for (const a of v.agents) for (const o of a.obligations) out[o.status] += 1;
  return out;
}
