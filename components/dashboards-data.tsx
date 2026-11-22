"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errorText, type RunRow } from "@/lib/api/client";
import { listAgents } from "@/lib/api/l2";
import { getLockdown, listGates, type Gate, type LockdownState } from "@/lib/api/l5";
import { SEVERITIES, type Answer, type FindingsSummary } from "@/lib/api/pending";
import { agentHref } from "@/lib/agent-link";
import { CONTROLS } from "@/lib/guardrails";
import { productionRuns } from "@/lib/production";
import { soon } from "@/lib/soon";
import type { RankRow } from "./overview-data";
import { winMs, type Win } from "./window-pick";

/**
 * What the Dashboards page reads, and how it cuts it.
 *
 * The boards hold no records of their own. Each reads the doors the page it
 * links to reads, and counts from what they return:
 *
 *   Security posture   the run ledger (`GET /api/runs`), the approvals inbox
 *                      (`GET /api/approvals`), the lockdown (`GET /api/lockdown`)
 *                      and the control firings the console counts from the
 *                      run journals (`GET /api/guardrails`)
 *   Cost               the cost ledger (`GET /api/finops`): every model call
 *                      with its price, the runs, the budget and where spend
 *                      stands against it
 *   Workload results   the findings summary, read by the Results summary's
 *                      own body (components/outcomes.tsx)
 *
 * A read that fails leaves its figures unset (null), never zero.
 */

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * One door's answer: `data` null with no `error` while it is being read, null
 * with an `error` when it could not be. A later failure keeps the last answer
 * with its `error` set and `at` left at when it last answered, and the board
 * marks those figures stale.
 */
export interface Read<T> {
  data: T | null;
  error: string;
  /** When the door last answered (ms), 0 before it ever has. */
  at?: number;
}

const UNREAD = { data: null, error: "", at: 0 };

const settle = <T,>(prev: Read<T>, r: PromiseSettledResult<T>): Read<T> =>
  r.status === "fulfilled" ? { data: r.value, error: "", at: Date.now() } : { data: prev.data, error: message(r.reason), at: prev.at ?? 0 };

/** A read that answered once and has failed since: its figures are as of `at`. */
export const staleOf = (r: Read<unknown>): boolean => r.data !== null && Boolean(r.error);

/** Agent id → its name in the registry; empty when the registry did not answer (the ids are shown instead). */
async function readNames(): Promise<Record<string, string>> {
  try {
    return Object.fromEntries((await listAgents()).map((a) => [a.id, a.name || a.id]));
  } catch {
    return {};
  }
}

/* ═══════════════════ security posture ═══════════════════ */

/** `GET /api/guardrails`, as far as the board reads it. */
export interface Firings {
  /** Runs whose journals were counted. */
  runs: number;
  /** Firings per control, over every run on record: keyed by the name the journal gives the control, or its catalogue id. */
  counts: Record<string, number>;
  /** The latest firings, each with the time its run was last written; at most 40. */
  recent: { control: string; run: string; agent: string; at: string }[];
}

export interface SecurityReads {
  runs: Read<RunRow[]>;
  gates: Read<Gate[]>;
  lockdown: Read<LockdownState>;
  firings: Read<Firings>;
  names: Record<string, string>;
  /** The clock the window is cut against: stamped when the reads came back. */
  now: number;
}

async function readLedger(): Promise<RunRow[]> {
  const { data, error, response } = await api.GET("/api/runs");
  if (!data) throw new Error(errorText(error, response));
  // A canary's shadow runs are counted in none of production's figures (lib/production.ts).
  return productionRuns(data.runs).sort((a, b) => b.at.localeCompare(a.at));
}

async function readFirings(): Promise<Firings> {
  const res = await fetch("/api/guardrails");
  const d = (await res.json().catch(() => null)) as (Partial<Firings> & { posture?: { agents?: number }; error?: string }) | null;
  // An answer that is not the record (a refusal, a page, a 501) is a failed read, never a record to count.
  if (!res.ok || !d || typeof d.counts !== "object" || d.counts === null) throw new Error(errorText(d, res, "GET", "/api/guardrails"));
  return { runs: Number(d.runs) || 0, counts: d.counts, recent: Array.isArray(d.recent) ? d.recent : [] };
}

/** The security board's reads, again every `everyMs`: what waits on a person is a figure about now. */
export function useSecurity(everyMs = 30_000): SecurityReads {
  const [reads, setReads] = useState<SecurityReads>({ runs: UNREAD, gates: UNREAD, lockdown: UNREAD, firings: UNREAD, names: {}, now: 0 });

  const load = useCallback(async () => {
    const [ledger, inbox, lock, fired, names] = await Promise.allSettled([readLedger(), listGates().then((i) => i.pending), getLockdown(), readFirings(), readNames()]);
    setReads((prev) => ({
      runs: settle(prev.runs, ledger),
      gates: settle(prev.gates, inbox),
      lockdown: settle(prev.lockdown, lock),
      firings: settle(prev.firings, fired),
      names: names.status === "fulfilled" && Object.keys(names.value).length ? names.value : prev.names,
      now: Date.now(),
    }));
  }, []);

  useEffect(() => {
    const cancel = soon(load);
    const id = setInterval(load, everyMs);
    return () => {
      cancel();
      clearInterval(id);
    };
  }, [load, everyMs]);

  return reads;
}

/** Calls the policy engine refused, per agent, over `rows`: the ledger counts them on each run (`denials`). */
export function rankRefusals(rows: readonly RunRow[], names: Record<string, string>): RankRow[] {
  const by = new Map<string, number>();
  for (const r of rows) {
    const id = r.agent || r.system;
    if (!id || !(r.denials > 0)) continue;
    by.set(id, (by.get(id) ?? 0) + r.denials);
  }
  return [...by].map(([id, value]) => ({ key: id, label: names[id] ?? id, value, href: agentHref(id) }));
}

/** The catalogue's controls a firing's key names: its catalogue id, or the name the policy engine journals (which several controls can share). */
function controlsNamed(key: string) {
  return CONTROLS.filter((c) => c.id === key || c.journal === key);
}

export interface ControlRanking {
  rows: RankRow[];
  /** Firings counted. */
  total: number;
  /** Whether the ranking is cut to the window. The door dates only its latest firings; when it counted more than it dated, the ranking is over every run on record. */
  windowed: boolean;
}

/**
 * The controls by how often they fired. The door counts every firing on
 * record and dates the latest of them; where it dated all it counted, the
 * ranking is cut to the window, otherwise it says it is over the whole record.
 */
export function rankControls(firings: Firings, now: number, win: Win): ControlRanking {
  const counted = Object.values(firings.counts).reduce((a, b) => a + (Number(b) || 0), 0);
  const windowed = firings.recent.length >= counted;
  let counts: Record<string, number> = firings.counts;
  if (windowed) {
    const since = Number.isFinite(winMs(win)) ? now - winMs(win) : -Infinity;
    counts = {};
    for (const f of firings.recent) if (Date.parse(f.at) >= since) counts[f.control] = (counts[f.control] ?? 0) + 1;
  }
  const rows = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([key, value]): RankRow => {
      const named = controlsNamed(key);
      if (!named.length) return { key, label: key, value, href: "/guardrails", code: true };
      const others = named.length - 1;
      return { key, label: others ? `${named[0].title} and ${others} other${others === 1 ? "" : "s"}` : named[0].title, value, href: `/guardrails?control=${encodeURIComponent(named[0].id)}` };
    });
  return { rows, total: rows.reduce((a, r) => a + r.value, 0), windowed };
}

/* ═══════════════════ cost ═══════════════════ */

export type Period = "day" | "week" | "month";
export const PERIOD_DAYS: Record<Period, number> = { day: 1, week: 7, month: 30 };

/** `GET /api/finops`, as far as the board reads it (the FinOps page reads the same answer in full). */
export interface CostLedger {
  /** The server's clock when it answered: the window is cut against it, as on the FinOps page. */
  now: number;
  runs: { id: string; system: string; at: string; cost: number | null }[];
  calls: { run: string; system: string; at: string; model: string; in: number; out: number; cost: number | null; estimated?: boolean }[];
  /** Model id → the label it is offered under. */
  labels: Record<string, string>;
  /** Dollars per `period`; null when no budget is set. */
  budget: number | null;
  period: Period;
  /** Where spend stands in the current rolling period; null when the answer carried none. */
  state: { spent: number; remaining: number | null; exceeded: boolean; used: number | null } | null;
}

async function readCost(): Promise<CostLedger> {
  const res = await fetch("/api/finops");
  const d = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !d || (typeof d.error === "string" && d.error)) throw new Error(errorText(d, res, "GET", "/api/finops"));
  if (!Array.isArray(d.calls) || !Array.isArray(d.runs)) throw new Error(`GET /api/finops answered ${res.status} without the cost ledger`);
  const models = (d.config as { models?: { id: string; label?: string }[] } | undefined)?.models;
  const st = d.budgetState as Partial<NonNullable<CostLedger["state"]>> | undefined;
  const period = (["day", "week", "month"] as const).find((p) => p === d.period) ?? "month";
  return {
    now: Date.parse(String(d.now)) || Date.now(),
    runs: d.runs as CostLedger["runs"],
    calls: d.calls as CostLedger["calls"],
    labels: Object.fromEntries((Array.isArray(models) ? models : []).map((m) => [m.id, m.label || m.id])),
    budget: typeof d.budget === "number" ? d.budget : null,
    period,
    state: st && typeof st.spent === "number" ? { spent: st.spent, remaining: st.remaining ?? null, exceeded: st.exceeded === true, used: st.used ?? null } : null,
  };
}

export interface CostReads {
  ledger: Read<CostLedger>;
  names: Record<string, string>;
}

/** The cost board's read, again every `everyMs`. */
export function useCost(everyMs = 60_000): CostReads {
  const [reads, setReads] = useState<CostReads>({ ledger: UNREAD, names: {} });

  const load = useCallback(async () => {
    const [ledger, names] = await Promise.allSettled([readCost(), readNames()]);
    setReads((prev) => ({
      ledger: settle(prev.ledger, ledger),
      names: names.status === "fulfilled" && Object.keys(names.value).length ? names.value : prev.names,
    }));
  }, []);

  useEffect(() => {
    const cancel = soon(load);
    const id = setInterval(load, everyMs);
    return () => {
      cancel();
      clearInterval(id);
    };
  }, [load, everyMs]);

  return reads;
}

export interface CostCut {
  runs: number;
  calls: number;
  /** Calls priced at the estimate rate. */
  estimated: number;
  spend: number;
  tokens: number;
  byAgent: RankRow[];
  byModel: RankRow[];
  /** `{at, value}` per priced call, for the spend-over-time chart. */
  dated: { at: string; value: number }[];
  /** The earliest call on record, for the "all" window's span; null when there are none. */
  earliest: number | null;
  /** The window in days ("all": from the earliest call to now, at least one). */
  days: number;
  /** The budget scaled to the window; null when none is set. */
  windowBudget: number | null;
}

/** The ledger over one window, cut the way the FinOps page cuts it: spend is the sum of what each model call was costed at. */
export function cutCost(ledger: CostLedger, names: Record<string, string>, win: Win): CostCut {
  const ms = winMs(win);
  const within = (at: string) => ledger.now - Date.parse(at) <= ms;
  const calls = ledger.calls.filter((c) => within(c.at));
  const agent = new Map<string, number>();
  const model = new Map<string, number>();
  let spend = 0;
  let tokens = 0;
  let estimated = 0;
  for (const c of calls) {
    const cost = c.cost ?? 0;
    spend += cost;
    tokens += (c.in || 0) + (c.out || 0);
    if (c.estimated) estimated += 1;
    agent.set(c.system, (agent.get(c.system) ?? 0) + cost);
    model.set(c.model, (model.get(c.model) ?? 0) + cost);
  }
  const first = ledger.calls.length ? Math.min(...ledger.calls.map((c) => Date.parse(c.at)).filter((t) => !Number.isNaN(t))) : null;
  const days = Number.isFinite(ms) ? ms / 86_400_000 : Math.max(1, (ledger.now - (first ?? ledger.now)) / 86_400_000);
  return {
    runs: ledger.runs.filter((r) => within(r.at)).length,
    calls: calls.length,
    estimated,
    spend,
    tokens,
    byAgent: [...agent].map(([id, value]) => ({ key: id, label: names[id] ?? id, value, href: agentHref(id) })),
    byModel: [...model].map(([id, value]) => ({ key: id, label: ledger.labels[id] ?? id, value, code: !ledger.labels[id] })),
    dated: calls.map((c) => ({ at: c.at, value: c.cost ?? 0 })),
    earliest: first !== null && Number.isFinite(first) ? first : null,
    days,
    windowBudget: ledger.budget === null ? null : (ledger.budget * days) / PERIOD_DAYS[ledger.period],
  };
}

/* ═══════════════════ a value per bucket of time ═══════════════════ */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface Buckets {
  /** The sum per bucket, oldest first. */
  points: number[];
  /** One bucket's length, as a word. */
  unit: "hour" | "day" | "week" | "30 days";
  /** One bucket's length, milliseconds. */
  size: number;
  /** When the first bucket starts. */
  from: number;
}

/** Values summed per bucket over the window, bucketed as the Overview page's failure chart is: hours over a day, days up to a month and a half, weeks up to a year, then 30-day spans. Buckets count back from `now`. */
export function bucketsOf(rows: readonly { at: string; value: number }[], now: number, win: Win, earliest: number | null): Buckets {
  const span = Number.isFinite(winMs(win)) ? winMs(win) : Math.max(DAY, now - (earliest ?? now));
  const [size, unit]: [number, Buckets["unit"]] = span <= DAY ? [HOUR, "hour"] : span <= 45 * DAY ? [DAY, "day"] : span <= 366 * DAY ? [7 * DAY, "week"] : [30 * DAY, "30 days"];
  const n = Math.max(2, Math.ceil(span / size));
  const points = Array.from({ length: n }, () => 0);
  for (const r of rows) {
    const i = n - 1 - Math.floor((now - Date.parse(r.at)) / size);
    if (i >= 0 && i < n) points[i] += r.value;
  }
  return { points, unit, size, from: now - n * size };
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
