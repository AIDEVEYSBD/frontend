import { dbReady, query } from "@/lib/server/db";
import { priceSheet } from "@/lib/server/prices";
import { readRuns } from "@/lib/server/runs";

/**
 * The spend budget, with the period it is for.
 *
 * A budget is a rate: so much per day, week or month. Two things follow.
 * A card showing a different window compares its spend to the budget scaled
 * to that window ($5 a day is $150 over 30 days), never to the bare number.
 * And the budget is enforced: when journalled spend in the current period
 * reaches it, the platform refuses to start a run until the rolling period
 * falls back under or somebody raises it. The period is rolling (the last
 * 24 hours, 7 days, 30 days), which is the only reading that cannot be
 * gamed by the calendar rolling over at midnight.
 */

export type Period = "day" | "week" | "month";
export const PERIODS: Period[] = ["day", "week", "month"];
export const PERIOD_DAYS: Record<Period, number> = { day: 1, week: 7, month: 30 };

export interface Budget {
  budget_usd: number | null;
  period: Period;
}

export interface BudgetState extends Budget {
  /** Start of the rolling period the figures below cover. */
  since: string;
  /** Priced spend journalled inside the period. */
  spent: number;
  /** Runs inside the period whose cost is unknown (not counted in `spent`). */
  unpriced: number;
  remaining: number | null;
  /** Spent is at or over the budget: new runs are refused. */
  exceeded: boolean;
  /** Share of the budget used, 0 to 1 and beyond. */
  used: number | null;
}

export async function readBudget(): Promise<Budget> {
  if (!(await dbReady())) return { budget_usd: null, period: "month" };
  const rows = await query<{ value: { budget_usd?: number | null; period?: string } }>("SELECT value FROM settings WHERE key = 'finops'");
  const v = rows[0]?.value ?? {};
  const budget = typeof v.budget_usd === "number" && v.budget_usd >= 0 ? v.budget_usd : null;
  const period = (PERIODS as string[]).includes(String(v.period)) ? (v.period as Period) : "month";
  return { budget_usd: budget, period };
}

export async function writeBudget(b: Budget): Promise<void> {
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('finops', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [{ budget_usd: b.budget_usd, period: b.period }],
  );
}

/** The budget scaled to a window of `days`: what this window may cost. */
export function budgetFor(b: Budget, days: number): number | null {
  return b.budget_usd === null ? null : (b.budget_usd * days) / PERIOD_DAYS[b.period];
}

/** Where spend stands against the budget in the current rolling period. */
export async function budgetState(): Promise<BudgetState> {
  const b = await readBudget();
  const since = new Date(Date.now() - PERIOD_DAYS[b.period] * 86_400_000);
  // The journals are the truth; the metrics table is their shadow. Reading
  // the journals costs a directory scan, which is fine for a decision that
  // is made once per run start.
  const runs = await readRuns(await priceSheet());
  const inPeriod = runs.filter((r) => new Date(r.at).getTime() >= since.getTime());
  const spent = inPeriod.reduce((s, r) => s + (r.cost ?? 0), 0);
  const unpriced = inPeriod.filter((r) => r.cost === null).length;
  const remaining = b.budget_usd === null ? null : b.budget_usd - spent;
  return {
    ...b,
    since: since.toISOString(),
    spent,
    unpriced,
    remaining,
    exceeded: b.budget_usd !== null && spent >= b.budget_usd,
    used: b.budget_usd ? spent / b.budget_usd : null,
  };
}

/** The refusal a run start gets when the budget is spent, or null when it may go ahead. */
export async function budgetGate(): Promise<{ error: string; budget: BudgetState } | null> {
  const s = await budgetState();
  if (!s.exceeded) return null;
  return {
    error: `budget exhausted: $${s.spent.toFixed(2)} of $${(s.budget_usd ?? 0).toFixed(2)} spent in the last ${s.period === "day" ? "24 hours" : s.period === "week" ? "7 days" : "30 days"}. Runs resume when the rolling ${s.period} falls under the budget, or when it is raised on the Control or FinOps page.`,
    budget: s,
  };
}
