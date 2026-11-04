import type { Tone } from "@/components/ui";
import type { Attestation, AttestationList, OwnerOf, Standing } from "./api/l9";
import type { SessionInfo } from "./use-session";

/**
 * Owner attestations as a person meets them (phase L9): who answers for an
 * agent, when they last said it still does what was approved, and what
 * changed since. Pure.
 */

const when = (iso: string | null | undefined): string => (iso ? iso.replace("T", " ").replace(/\.\d+Z$|Z$/, " UTC") : "");

export function standingState(s: Pick<Standing, "overdue" | "last">): { label: string; tone: Tone } {
  if (s.overdue) return { label: "Overdue", tone: "err" };
  return s.last ? { label: "Current", tone: "ok" } : { label: "Never attested", tone: "warn" };
}

export const ownerLine = (o: OwnerOf): string => (o.owner ? `${o.owner}${o.source === "register" ? " (the register)" : o.source === "spec" ? " (the spec)" : ""}` : "no owner on record: only an administrator can attest it");

export function dueLine(l: Pick<AttestationList, "due_at" | "overdue" | "period_days" | "last_at">): string {
  const every = `every ${l.period_days} days`;
  if (!l.due_at) return `Attested ${every}; nothing is due until it is deployed.`;
  return l.overdue ? `Overdue since ${when(l.due_at)} (${every}).` : `Next due ${when(l.due_at)} (${every}).`;
}

/** An attestation in a line: who said it, as what, of which version. */
export function attestationLine(a: Attestation): string {
  const as = a.as_role === "owner" ? "as owner" : a.as_role ? `as ${a.as_role}, for the owner` : "";
  return [`${a.by} ${as}`.trim(), when(a.at), a.version !== null ? `version ${a.version}` : ""].filter(Boolean).join(" · ");
}

/** Whether what was attested is what production ran then. */
export function deployedNote(a: Attestation): { text: string; tone: Tone } | null {
  if (!a.deployed) return { text: "nothing was deployed when this was given", tone: "neutral" };
  return a.matches_deployed ? null : { text: `production ran version ${a.deployed.version ?? "?"}, not this one`, tone: "warn" };
}

export function diffLine(a: Attestation): string {
  if (!a.previous) return "The first attestation: nothing to compare.";
  if (!a.diff) return `The version attested before (${a.previous.version ?? "?"}) is no longer on record.`;
  return a.diff.same ? `Nothing changed since ${a.previous.by} attested version ${a.previous.version ?? "?"}.` : `Changed since ${a.previous.by} attested version ${a.previous.version ?? "?"}:`;
}

/** Whether this person may attest: the door's rule (`attestation_owner`), said sooner. The backend decides. */
export function mayAttest(s: SessionInfo | null, owner: OwnerOf): { may: boolean; why: string } {
  const named = owner.owner || "nobody (no owner is recorded)";
  const why = `only the owner, ${named}, or an administrator attests this agent`;
  if (!s) return { may: false, why };
  if (s.appRoles.includes("administrator") || !s.sso) return { may: true, why: "" };
  const who = owner.owner.trim().toLowerCase();
  if ((owner.owner_sub && owner.owner_sub === s.sub) || (who && [s.email, s.name, ...s.roles, ...(s.groups ?? [])].some((x) => x && x.trim().toLowerCase() === who))) return { may: true, why: "" };
  return { may: false, why };
}
