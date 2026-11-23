/**
 * What production's figures count (phase L8, second round).
 *
 * A shadow run is a canary's mirror: the candidate version run on the same
 * input as a production run, in shadow mode, where nothing above read
 * executes. Its record says `shadow: true`. It is not production's work, so
 * it counts toward none of production's figures: not the budget's spend (the
 * backend shows it beside the budget as `shadow_spent`), not the run counts,
 * costs, tokens, latencies or refusals the Control and FinOps pages compute
 * from the journals. It still appears wherever runs are listed, marked as a
 * shadow. Pure: the Agents list and the Control page use it;
 * tests/l8b-logic.test.ts holds it.
 */

/** A run row or a run record: the record's `shadow: true` marks a shadow run. */
export const isShadow = (r: { shadow?: unknown } | null | undefined): boolean => r?.shadow === true;

/** Production's runs: everything but the shadows, in the order given. */
export function productionRuns<T extends { shadow?: unknown }>(rows: readonly T[]): T[] {
  return rows.filter((r) => !isShadow(r));
}

/** The shadows, in the order given. */
export function shadowRuns<T extends { shadow?: unknown }>(rows: readonly T[]): T[] {
  return rows.filter(isShadow);
}

/**
 * Spend in a window, split as the backend's BudgetState splits it: `spent`
 * and `unpriced` over production's runs only, `shadow_spent` over the
 * shadows (shown beside the budget, never counted toward it).
 */
export function spendSplit(rows: readonly { shadow?: unknown; cost: number; estimated: number; at: string }[], since: Date): { spent: number; unpriced: number; shadow_spent: number; shadow_runs: number } {
  const t = since.getTime();
  const window = rows.filter((r) => new Date(r.at).getTime() >= t);
  const prod = productionRuns(window);
  const shadow = shadowRuns(window);
  return {
    spent: prod.reduce((s, r) => s + r.cost, 0),
    unpriced: prod.filter((r) => r.estimated > 0).length,
    shadow_spent: shadow.reduce((s, r) => s + r.cost, 0),
    shadow_runs: shadow.length,
  };
}

/** What the shadows in a window came to, for the line beside production's figures. */
export interface ShadowSummary {
  runs: number;
  cost: number;
  /** Their ids, newest first, for the drill-down. */
  ids: string[];
}

export function shadowSummary(rows: readonly { shadow?: unknown; id: string; cost: number; at: string }[], since?: Date): ShadowSummary {
  const t = since ? since.getTime() : -Infinity;
  const shadows = shadowRuns(rows).filter((r) => new Date(r.at).getTime() >= t);
  return { runs: shadows.length, cost: shadows.reduce((s, r) => s + r.cost, 0), ids: shadows.map((r) => r.id) };
}

/** The shadows beside a figure, in a line; "" when there are none. */
export function shadowBesideLine(s: Pick<ShadowSummary, "runs" | "cost">, fmtCost: (n: number) => string): string {
  if (!s.runs) return "";
  return `${s.runs} shadow run${s.runs === 1 ? "" : "s"} (${fmtCost(s.cost)}) left out: a canary's mirrors are not production's work`;
}

/** The budget's shadow spend, beside it, in a line (the backend's `BudgetState.shadow_spent`); "" for none. */
export function shadowSpentLine(shadowSpent: number | null | undefined, fmtCost: (n: number) => string): string {
  if (!shadowSpent || !(shadowSpent > 0)) return "";
  return `beside it, not in it: ${fmtCost(shadowSpent)} spent by a canary's shadow runs`;
}
