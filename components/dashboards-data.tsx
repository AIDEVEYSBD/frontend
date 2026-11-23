"use client";

import { SEVERITIES, type Answer, type FindingsSummary } from "@/lib/api/pending";
import { agentHref } from "@/lib/agent-link";
import { CONTROLS, controlLabel, explainControl } from "@/lib/guardrails";
import type { EstateFigures, RankRow } from "./overview-data";

/**
 * How the Dashboards read the figures.
 *
 * The security posture and cost boards read the platform's own counts for
 * the window (`GET /api/estate`, the answer the Overview reads too, through
 * `useFigures` in components/overview-data.tsx): nothing on them is summed in
 * the browser. The workload results board reads the findings summary through
 * the Results summary's own body (components/outcomes.tsx).
 *
 * A read that fails leaves its figures unset (null), never zero.
 */

/* ═══════════════════ security posture ═══════════════════ */

/** Calls a control refused, per agent, over the window: the platform's count of refusal entries. */
export function rankRefusals(f: EstateFigures, names: Record<string, string>): RankRow[] {
  return f.refusals.by_agent.map((a) => ({ key: a.agent, label: names[a.agent] ?? a.agent, value: a.count, href: agentHref(a.agent) }));
}

/** The catalogue's controls a firing's key names: its catalogue id, or the name the policy engine journals (which several controls can share). */
function controlsNamed(key: string) {
  const direct = CONTROLS.filter((c) => c.id === key || c.journal === key);
  if (direct.length) return { named: direct, direct: true };
  // A key that names its control another way (the report gate journals `report` for the authorisation gate).
  const id = explainControl(key).id;
  return { named: id ? CONTROLS.filter((c) => c.id === id) : [], direct: false };
}

/** The controls by how often they fired in the window, each named from the catalogue where it is in it. */
export function rankControls(f: EstateFigures): RankRow[] {
  return f.firings.by_control.map(({ control: key, count: value }): RankRow => {
    const { named, direct } = controlsNamed(key);
    if (!named.length) {
      const label = controlLabel(key);
      return { key, label, value, href: `/explore?control=${encodeURIComponent(key)}&window=${f.window}`, code: label === key };
    }
    const others = named.length - 1;
    const label = !direct ? controlLabel(key) : others ? `${named[0].title} and ${others} other${others === 1 ? "" : "s"}` : named[0].title;
    return { key, label, value, href: `/guardrails?control=${encodeURIComponent(named[0].id)}` };
  });
}

/* ═══════════════════ cost ═══════════════════ */

export type Period = "day" | "week" | "month";
export const PERIOD_DAYS: Record<Period, number> = { day: 1, week: 7, month: 30 };

/** How many days the window spans: its own, or for "all" the span the platform's trend covers. */
export function windowDays(f: EstateFigures): number {
  if (f.since) return Math.max(1 / 24, (Date.parse(f.until) - Date.parse(f.since)) / 86_400_000);
  return Math.max(1, (Date.parse(f.until) - Date.parse(f.trend.from)) / 86_400_000);
}

/** The budget scaled to the window (so much a period, over the window's days); null when none is set. */
export function windowBudget(f: EstateFigures): number | null {
  return f.budget ? (f.budget.budget_usd * windowDays(f)) / PERIOD_DAYS[f.budget.period] : null;
}

/** Agents by what their priced calls cost in the window. */
export function spendByAgent(f: EstateFigures): RankRow[] {
  return f.rank.agents.map((a) => ({ key: a.id, label: a.name, value: a.cost_usd ?? 0, href: agentHref(a.id) }));
}

/** Models by what their priced calls cost in the window. */
export function spendByModel(f: EstateFigures): RankRow[] {
  return f.rank.models.map((m) => ({ key: m.model, label: m.model, value: m.cost_usd ?? 0, code: true }));
}

/* ═══════════════════ workload results ═══════════════════ */

export interface ResultTotals {
  runs: number;
  findings: number;
  /** Critical and high together. */
  severe: number;
  open: number;
  remediated: number;
  /** Workloads the summary has runs or findings for. */
  workloads: number;
}

const whole = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/** The summary's figures added across its workloads; null until the door answers with them. */
export function resultTotals(answer: Answer<FindingsSummary> | null): ResultTotals | null {
  if (answer?.state !== "ok" || !Array.isArray(answer.data?.workloads)) return null;
  const t: ResultTotals = { runs: 0, findings: 0, severe: 0, open: 0, remediated: 0, workloads: 0 };
  for (const w of answer.data.workloads) {
    if (!w) continue;
    const found = SEVERITIES.reduce((a, s) => a + whole(w.by_severity?.[s]), 0);
    t.runs += whole(w.runs);
    t.findings += found;
    t.severe += whole(w.by_severity?.critical) + whole(w.by_severity?.high);
    t.open += whole(w.by_status?.open);
    t.remediated += whole(w.by_status?.remediated);
    if (whole(w.runs) || found) t.workloads += 1;
  }
  return t;
}
