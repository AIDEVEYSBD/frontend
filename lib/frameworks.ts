import type { Tone } from "@/components/ui";
import type { FrameworkInfo, ObligationStatus, RegulatoryView } from "./api/l9";

/**
 * Regulatory views in words (phase L9). A framework the catalogue maps no
 * obligation of (DPDP, SEBI, RBI) must read as exactly that: nobody has
 * mapped a clause, so the view shows no obligations because none exist here,
 * not because an agent met them. Pure.
 */

export const OBLIGATION_META: Record<ObligationStatus, { label: string; tone: Tone; means: string }> = {
  evidenced: { label: "Evidenced", tone: "ok", means: "a control fired in the period" },
  configured: { label: "Configured", tone: "run", means: "none fired; one is declared or platform-enforced" },
  not_evidenced: { label: "Not evidenced", tone: "err", means: "nothing fired and nothing covers it" },
  not_applicable: { label: "Not applicable", tone: "neutral", means: "nothing the agent has would make it fire" },
};

export const CONFIGURATION_META: Record<string, { label: string; tone: Tone }> = {
  platform: { label: "platform-enforced", tone: "ok" },
  declared: { label: "declared", tone: "ok" },
  absent: { label: "absent", tone: "err" },
  "n/a": { label: "n/a", tone: "neutral" },
};

/** Whether anything is mapped: a framework with no obligations has nothing to show an agent against. */
export const isUnmapped = (f: Pick<FrameworkInfo, "obligations">): boolean => f.obligations.length === 0;

/** The plain sentence for a framework nothing is mapped to. */
export const unmappedLine = (f: Pick<FrameworkInfo, "short" | "why">): string => f.why || `No clause of ${f.short} is mapped to a control, so nothing here can be read as meeting it.`;

export function frameworkLine(f: Pick<FrameworkInfo, "obligations" | "kind" | "short" | "why">): string {
  return isUnmapped(f) ? "no obligations mapped" : `${f.obligations.length} obligation${f.obligations.length === 1 ? "" : "s"}`;
}

/** The estate against one framework: each status counted over every agent. */
export function viewCounts(v: Pick<RegulatoryView, "agents">): Record<ObligationStatus, number> {
  const out: Record<ObligationStatus, number> = { evidenced: 0, configured: 0, not_evidenced: 0, not_applicable: 0 };
  for (const a of v.agents) for (const o of a.obligations) out[o.status] += 1;
  return out;
}
