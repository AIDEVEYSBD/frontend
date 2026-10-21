import { meanSideOf, mixSideOf, rateSideOf, type AgentDrift, type DriftMeasure, type DriftReport, type MeasureName } from "./api/l7";
import { fmtUsd } from "./run-tree";

/**
 * Drift per agent, as the console says it. The backend compares the last
 * day of an agent's finished runs against the thirty days before it on
 * five measures: how runs end (a mix), the result's confidence and the
 * cost per run (means), which tools were called (a mix), and how often a
 * run met a refusal (a rate). A mix moves by its Jensen–Shannon distance
 * (0 to 1, past 0.2), a mean by Welch's z and a rate by the two-proportion
 * z (past ±2). Too few runs in either window and there is nothing to
 * compare. Pure: components/drift.tsx renders these, tests/l7-logic.test.ts
 * holds them.
 */

export const MEASURE_LABEL: Record<MeasureName, string> = {
  disposition_mix: "Disposition mix",
  confidence: "Confidence",
  cost_per_run: "Cost per run",
  tool_mix: "Tool mix",
  refusal_rate: "Refusal rate",
};

export const MEASURE_ASKS: Record<MeasureName, string> = {
  disposition_mix: "how runs end: the spec's outcome field, else the final state",
  confidence: "the confidence the result carries",
  cost_per_run: "what a run costs, priced as the ledger prices it",
  tool_mix: "which tools the runs call, every call pooled",
  refusal_rate: "the share of runs that met a refusal",
};

export const STATISTIC_LABEL: Record<DriftMeasure["statistic"], string> = {
  jensen_shannon: "Jensen–Shannon distance",
  welch_z: "Welch's z",
  proportion_z: "two-proportion z",
};

/** The measure's statistic as a figure: the distance for a mix, the signed z for a mean or a rate; "—" when there was not enough to compute it. */
export function statText(m: Pick<DriftMeasure, "kind" | "distance" | "z" | "enough">): string {
  if (m.kind === "mix") return m.distance === null ? "—" : m.distance.toFixed(3);
  if (m.z === null) return "—";
  const z = Math.abs(m.z) >= 99 ? `${m.z < 0 ? "−" : "+"}99 (no spread)` : `${m.z < 0 ? "−" : "+"}${Math.abs(m.z).toFixed(2)}`;
  return `z ${z}`;
}

/** The threshold it is held to: "past 0.2", "past ±2". */
export function thresholdText(m: Pick<DriftMeasure, "kind" | "threshold">): string {
  return m.kind === "mix" ? `past ${m.threshold}` : `past ±${m.threshold}`;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** A mean, in the measure's own unit: dollars for the cost, two places for a confidence. */
function meanText(name: MeasureName, x: number): string {
  return name === "cost_per_run" ? fmtUsd(x) : x.toFixed(2);
}

/**
 * One side of a measure (`recent` or `baseline`) in a line: a mix as its
 * largest shares (three at most, then how many more), a mean as mean ± sd,
 * a rate as a share of runs; each with how many it read. "—" when the side
 * is empty (no run carried a confidence).
 */
export function sideText(m: Pick<DriftMeasure, "kind" | "name">, side: Record<string, unknown>, top = 3): string {
  if (m.kind === "mix") {
    const s = mixSideOf(side);
    const entries = Object.entries(s.shares).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (!entries.length) return "—";
    const shown = entries.slice(0, top).map(([k, v]) => `${k} ${pct(v)}`);
    const more = entries.length - top;
    return `${shown.join(" · ")}${more > 0 ? ` · +${more} more` : ""} (n ${s.n})`;
  }
  if (m.kind === "mean") {
    const s = meanSideOf(side);
    if (!s) return "—";
    return `${meanText(m.name, s.mean)} ± ${meanText(m.name, s.sd)} (n ${s.n})`;
  }
  const s = rateSideOf(side);
  if (!s) return "—";
  return `${pct(s.rate)} of runs (${s.runs_with} of ${s.n})`;
}

/** The two windows in a sentence: "8 runs in the last 24 h against 24 in the 30 days before". */
export function windowsLine(a: Pick<AgentDrift, "recent" | "baseline">, windows: DriftReport["windows"] = {}): string {
  const h = windows.recent_h ?? 24;
  const d = windows.baseline_d ?? 30;
  return `${a.recent.runs} run${a.recent.runs === 1 ? "" : "s"} in the last ${h} h against ${a.baseline.runs} in the ${d} days before`;
}

export type VerdictTone = "err" | "ok" | "neutral";

/** An agent's verdict: drifted (which measures), within its thresholds, or not enough runs to say. */
export function driftVerdict(a: Pick<AgentDrift, "enough" | "drifted" | "measures" | "says">): { tone: VerdictTone; label: string; detail: string } {
  if (!a.enough) return { tone: "neutral", label: "Not enough runs", detail: a.says };
  if (a.drifted) {
    const moved = a.measures.filter((m) => m.drifted).map((m) => MEASURE_LABEL[m.name]);
    return { tone: "err", label: "Drifted", detail: moved.length ? `shifted: ${moved.join(", ")}` : a.says };
  }
  return { tone: "ok", label: "Within thresholds", detail: a.says || "no measure past its threshold" };
}

/** Agents in reading order: drifted first, then those compared, then those without enough runs; by name within each. */
export function orderDrift(agents: readonly AgentDrift[]): AgentDrift[] {
  const rank = (a: AgentDrift) => (a.drifted ? 0 : a.enough ? 1 : 2);
  return [...agents].sort((a, b) => rank(a) - rank(b) || a.agent.localeCompare(b.agent));
}

/** The field disposition_mix read: the spec's outcome field, or the run's final state. */
export function dispositionField(a: Pick<AgentDrift, "outcome_field">): string {
  return a.outcome_field ? `the result's ${a.outcome_field} (the spec's outcome field)` : "the run's final state (the spec names no outcome field)";
}
