import type { Tone } from "@/components/ui";
import type { AgentTier, JudgedRequirement, TierInfo, TierRequirement } from "./api/l9";

/**
 * Autonomy tiers as a person meets them (phase L9): a spec's
 * `metadata.autonomy`, the controls its tier requires, and what the agent
 * lacks. The tiers and requirements are the runtime's; the judging is the
 * promotion gate's `autonomy` condition. Pure.
 */

export const requirementLabel = (id: string, reqs: readonly Pick<TierRequirement, "id" | "title">[] = []): string => reqs.find((r) => r.id === id)?.title ?? id.replace(/_/g, " ");

export function requirementState(r: Pick<JudgedRequirement, "met">): { label: string; tone: Tone } {
  return r.met === true ? { label: "met", tone: "ok" } : r.met === false ? { label: "missing", tone: "err" } : { label: "not judged yet", tone: "queue" };
}

/** Where an agent stands against its tier, in a line. */
export function tierLine(a: AgentTier, reqs: readonly Pick<TierRequirement, "id" | "title">[] = []): string {
  if (a.problem) return a.problem;
  const name = `${a.tier} (${a.name})`;
  if (!a.requires.length) return `${name} requires no controls.`;
  const of = `${a.requires.length} control${a.requires.length === 1 ? "" : "s"}`;
  if (a.met && !a.pending.length) return `${name}: all ${of} met.`;
  const missing = a.missing.map((m) => requirementLabel(m, reqs).toLowerCase());
  const pending = a.pending.map((m) => requirementLabel(m, reqs).toLowerCase());
  return [`${name}: ${a.missing.length} of ${of} missing`, missing.length ? `(${missing.join("; ")})` : "", pending.length ? `; not judged yet: ${pending.join("; ")}` : ""].filter(Boolean).join(" ") + ".";
}

/** A tier as a compact tag for an agent's row. */
export function tierTag(a: Pick<AgentTier, "tier" | "met" | "missing" | "problem">): { label: string; tone: Tone } {
  if (a.problem) return { label: `${a.tier || "tier"}: cannot judge`, tone: "warn" };
  return a.met ? { label: a.tier, tone: "neutral" } : { label: `${a.tier}: ${a.missing.length} missing`, tone: "err" };
}

/** The security doc's reading of a tier beside the runtime's. */
export const tierDocLine = (t: Pick<TierInfo, "doc_name" | "example" | "doc_minimum_controls">): string => [t.doc_name, t.example ? `such as ${t.example}` : "", t.doc_minimum_controls ? `minimum: ${t.doc_minimum_controls}` : ""].filter(Boolean).join(" · ");
