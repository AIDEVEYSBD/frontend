"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorText, type RunRow } from "@/lib/api/client";
import { listAgents } from "@/lib/api/l2";
import { inFlight, listAttention, listGates, type AttentionItem, type Gate } from "@/lib/api/l5";
import { runSourceOf } from "@/lib/api/l6";
import { agentHref } from "@/lib/agent-link";
import { ATTENTION_LABEL, orderAttention } from "@/lib/gates";
import { productionRuns } from "@/lib/production";
import { soon } from "@/lib/soon";
import type { Tone } from "./ui";
import { winMs, type Win } from "./window-pick";

/**
 * What the Overview page reads, and how it cuts it.
 *
 * Nothing here is typed in. The run ledger (`GET /api/runs`) gives the runs,
 * their state, cost, duration and the door each came through; the inbox
 * (`GET /api/approvals`) and the attention queue (`GET /api/attention`) give
 * what waits on a person; the console's own observability route gives each
 * run's duration and, per run, its tool calls. No door returns a ranking, so
 * the rankings are computed here from those rows, over the page's window.
 */

/* ═══════════════════ shapes (mirror /api/observability) ═══════════════════ */

interface TraceSummary {
  id: string;
  agent: string;
  state: string;
  /** When the run's record was last written. */
  startedAt: string;
  durationMs: number;
}

interface Observability {
  traces: TraceSummary[];
  total?: number;
  latency?: { p50: number; p95: number; p99: number; max: number };
  error?: string;
}

interface ToolSpan {
  kind: string;
  tool?: string;
  name: string;
  duration: number;
}

/** A person a run row names as its starter, when the ledger carries one (`owner`, lib/api/pending.ts). */
interface Starter {
  sub?: string;
  name?: string;
  email?: string;
}

/* ═══════════════════ formatting ═══════════════════ */

export const fmtCount = (n: number) => n.toLocaleString("en-GB");

export const fmtMoney = (c: number) =>
  c === 0 ? "$0.00" : c < 0.005 ? "<$0.01" : c < 100 ? `$${c.toFixed(2)}` : `$${Math.round(c).toLocaleString("en-GB")}`;

export const fmtMs = (ms: number) =>
  ms < 1000 ? `${Math.round(ms)}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : ms < 3_600_000 ? `${(ms / 60_000).toFixed(1)}m` : `${(ms / 3_600_000).toFixed(1)}h`;

/** An age in one unit: `40s`, `12m`, `3h`, `5d`. */
export function fmtAge(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  if (s < 60) return `${Math.max(1, Math.round(s))}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86_400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86_400)}d`;
}

const WINDOW_WORDS: Record<Win, string> = { "24h": "the last 24 hours", "7d": "the last 7 days", "30d": "the last 30 days", "90d": "the last 90 days", all: "any period" };
export const windowWords = (w: Win) => WINDOW_WORDS[w];

/* ═══════════════════ the estate, read ═══════════════════ */

export interface Estate {
  /** Production's runs, newest first; null until the ledger answers. */
  runs: RunRow[] | null;
  runsError: string;
  /** Agent id → its name in the registry. */
  names: Record<string, string>;
  gates: Gate[] | null;
  gatesError: string;
  attention: AttentionItem[] | null;
  attentionError: string;
  observability: Observability | null;
  /** Whether the observability route has been asked yet (it may have answered nothing). */
  observed: boolean;
  /** The clock the window is cut against: stamped when the ledger answered. */
  now: number;
  /** When the ledger last answered; a later failure leaves `runs` as of then, and the page marks it stale. */
  runsAt: number;
}

const EMPTY: Estate = { runs: null, runsError: "", names: {}, gates: null, gatesError: "", attention: null, attentionError: "", observability: null, observed: false, now: 0, runsAt: 0 };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function readLedger(): Promise<RunRow[]> {
  const { data, error, response } = await api.GET("/api/runs");
  if (!data) throw new Error(errorText(error, response));
  // A canary's shadow runs are listed on the Runs page and counted in none of production's figures (lib/production.ts).
  return productionRuns(data.runs).sort((a, b) => b.at.localeCompare(a.at));
}

async function readObservability(): Promise<Observability | null> {
  try {
    const res = await fetch("/api/observability");
    if (!res.ok) return null;
    const d = (await res.json()) as Partial<Observability>;
    return { traces: Array.isArray(d.traces) ? d.traces : [], total: d.total, latency: d.latency, error: d.error };
  } catch {
    return null;
  }
}

/** The page's reads, again every `everyMs`. The duration read and the agents' names follow the ledger: they are read again only when it has changed. */
export function useEstate(everyMs = 15_000): Estate {
  const [estate, setEstate] = useState<Estate>(EMPTY);
  const seen = useRef("");

  const load = useCallback(async () => {
    const [ledger, inbox, queue] = await Promise.allSettled([readLedger(), listGates(), listAttention()]);
    const runs = ledger.status === "fulfilled" ? ledger.value : null;
    const mark = runs ? `${runs.length}:${runs[0]?.at ?? ""}:${inFlight(runs).length}` : "unread";
    let extra: Pick<Estate, "observability" | "names"> | null = null;
    if (mark !== seen.current) {
      seen.current = mark;
      const [obs, agents] = await Promise.allSettled([readObservability(), listAgents()]);
      extra = {
        observability: obs.status === "fulfilled" ? obs.value : null,
        names: agents.status === "fulfilled" ? Object.fromEntries(agents.value.map((a) => [a.id, a.name || a.id])) : {},
      };
    }
    setEstate((prev) => ({
      runs: runs ?? prev.runs,
      runsError: ledger.status === "rejected" ? message(ledger.reason) : "",
      gates: inbox.status === "fulfilled" ? inbox.value.pending : prev.gates,
      gatesError: inbox.status === "rejected" ? message(inbox.reason) : "",
      attention: queue.status === "fulfilled" ? orderAttention(queue.value) : prev.attention,
      attentionError: queue.status === "rejected" ? message(queue.reason) : "",
      observability: extra ? extra.observability : prev.observability,
      observed: prev.observed || extra !== null,
      names: extra && Object.keys(extra.names).length ? extra.names : prev.names,
      // The window is cut against when the ledger last answered: a failed read moves neither the figures nor their clock.
      now: runs ? Date.now() : prev.now || Date.now(),
      runsAt: runs ? Date.now() : prev.runsAt,
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

  return estate;
}

/* ═══════════════════ the window ═══════════════════ */

export function inWindow<T>(rows: readonly T[], at: (row: T) => string, now: number, win: Win): T[] {
  const ms = winMs(win);
  if (!Number.isFinite(ms)) return [...rows];
  const since = now - ms;
  return rows.filter((r) => Date.parse(at(r)) >= since);
}

/* ═══════════════════ figures ═══════════════════ */

export interface Totals {
  runs: number;
  done: number;
  failed: number;
  killed: number;
  /** The priced runs' cost summed. Read it with `unpriced`: while any run is not priced, the window has no total. */
  spend: number;
  /** Runs whose cost includes a call priced by estimate. */
  estimated: number;
  /** Runs with no cost figure (`cost: null`): a call used a model with no price set. */
  unpriced: number;
}

export function totalsOf(rows: readonly RunRow[]): Totals {
  const t: Totals = { runs: rows.length, done: 0, failed: 0, killed: 0, spend: 0, estimated: 0, unpriced: 0 };
  for (const r of rows) {
    if (r.state === "done") t.done += 1;
    if (r.state === "failed") t.failed += 1;
    if (r.state === "killed") t.killed += 1;
    // `cost` is null for a run on a model with no price set (ahead of the generated type): counted as not priced, never as $0.
    const cost = r.cost as number | null;
    if (typeof cost === "number") t.spend += cost;
    else t.unpriced += 1;
    if (r.estimated > 0) t.estimated += 1;
  }
  return t;
}

/* ═══════════════════ rankings ═══════════════════ */

export interface RankRow {
  key: string;
  label: string;
  value: number;
  /** Where the row's name leads, when the thing has a page of its own. */
  href?: string;
  /** An identifier (a tool's name) rather than a title: set in the mono face. */
  code?: boolean;
}

/** The leaders by `value`, largest first; rows with nothing to show are left out. Ties fall back to the name so the order is stable between reads. */
export function leaders(rows: readonly RankRow[], limit = 5): { top: RankRow[]; of: number } {
  const ranked = rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  return { top: ranked.slice(0, limit), of: ranked.length };
}

export type RunMeasure = "runs" | "spend";

function tally(rows: readonly RunRow[], keyOf: (r: RunRow) => string | null, measure: RunMeasure): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const k = keyOf(r);
    if (k === null) continue;
    out.set(k, (out.get(k) ?? 0) + (measure === "runs" ? 1 : r.cost || 0));
  }
  return out;
}

export function rankAgents(rows: readonly RunRow[], names: Record<string, string>, measure: RunMeasure): RankRow[] {
  return [...tally(rows, (r) => r.agent || r.system || null, measure)].map(([id, value]) => ({ key: id, label: names[id] ?? id, value, href: agentHref(id) }));
}

/** The person a run row names as its starter, or null. The ledger gains `owner` later; until a row carries one, nobody is named. */
function starterOf(row: RunRow): { key: string; label: string } | null {
  const o = (row as unknown as { owner?: Starter | null }).owner;
  if (!o || typeof o !== "object") return null;
  const label = [o.name, o.email, o.sub].find((v) => typeof v === "string" && v.trim());
  if (!label) return null;
  const key = [o.sub, o.email, o.name].find((v) => typeof v === "string" && v.trim()) ?? label;
  return { key, label };
}

/** The door a run came through, in the ledger's vocabulary (lib/api/l6.ts), as a reader would say it. */
const SOURCE_LABEL: Record<string, string> = {
  "": "Platform",
  console: "Console",
  worker: "Queue worker",
  sdk: "Attached agent, SDK",
  a2a: "Attached agent, A2A",
  gateway: "Model gateway",
};

/** Whether a run row names the person who started it. */
export const namesPerson = (row: RunRow): boolean => starterOf(row) !== null;

export interface Starters {
  /** True when at least one run in the window names the person who started it. */
  people: boolean;
  rows: RankRow[];
  /** Runs in the window that name no person (only counted when others do). */
  unnamed: number;
}

/**
 * Who started the runs, only as far as the records say. A ledger row names
 * the door a run came through (`source`: the console, a worker, an attached
 * agent, the gateway), not a person. Where rows carry an `owner` the list is
 * of people and the runs that name nobody are counted beside it; where none
 * does, the list is of sources and is titled so.
 */
export function rankStarters(rows: readonly RunRow[], measure: RunMeasure): Starters {
  const named = rows.filter((r) => starterOf(r));
  if (named.length) {
    const label = new Map<string, string>();
    for (const r of named) {
      const s = starterOf(r)!;
      label.set(s.key, s.label);
    }
    return {
      people: true,
      rows: [...tally(named, (r) => starterOf(r)!.key, measure)].map(([key, value]) => ({ key, label: label.get(key) ?? key, value })),
      unnamed: rows.length - named.length,
    };
  }
  return {
    people: false,
    rows: [...tally(rows, (r) => runSourceOf(r), measure)].map(([key, value]) => ({ key: key || "platform", label: SOURCE_LABEL[key] ?? key, value })),
    unnamed: 0,
  };
}

/* ═══════════════════ tool calls ═══════════════════ */

/** How many runs' journals the tool ranking reads at most: the most recent in the window, as the observability route bounds its own model mix. */
export const TOOL_RUNS = 60;

type ToolTally = { tool: string; calls: number; ms: number }[];

/** One run's tool calls, by run id and last write; null when the run's journal could not be read. Settled runs never change, so a window switch reads nothing twice. */
const toolCache = new Map<string, ToolTally | null>();
const cacheKey = (r: { id: string; at: string }) => `${r.id}@${r.at}`;

async function readTools(run: string): Promise<ToolTally | null> {
  try {
    const res = await fetch(`/api/observability?run=${encodeURIComponent(run)}`);
    if (!res.ok) return null;
    const spans = ((await res.json()) as { trace?: { spans?: ToolSpan[] } }).trace?.spans;
    if (!Array.isArray(spans)) return null;
    const by = new Map<string, { calls: number; ms: number }>();
    for (const s of spans) {
      if (s.kind !== "tool") continue;
      const tool = s.tool || s.name;
      if (!tool) continue;
      const t = by.get(tool) ?? { calls: 0, ms: 0 };
      t.calls += 1;
      t.ms += Number.isFinite(s.duration) ? s.duration : 0;
      by.set(tool, t);
    }
    return [...by].map(([tool, t]) => ({ tool, ...t }));
  } catch {
    return null;
  }
}

export type ToolMeasure = "calls" | "ms";

export interface ToolCalls {
  /** Per tool, over the runs read. */
  tools: { tool: string; calls: number; ms: number }[];
  /** Runs whose journal was read. */
  read: number;
  /** Runs whose journal could not be read. */
  unread: number;
  /** Runs still being read. */
  pending: number;
}

/** Whether this console can read run journals at all: its observability route listed at least one trace. Where it cannot, no run is asked for its trace. */
export const journalsReadable = (estate: Estate): boolean => Boolean(estate.observability?.traces.length);

/**
 * Tool calls per tool over `runs`, read from each run's trace
 * (`GET /api/observability?run=`): the ledger row counts a run's tool calls
 * but does not name the tools. Six reads at a time.
 */
export function useToolCalls(runs: readonly RunRow[]): ToolCalls {
  const [got, setGot] = useState<Map<string, ToolTally | null>>(() => new Map(toolCache));
  const keys = useMemo(() => runs.map(cacheKey), [runs]);
  const mark = keys.join("|");

  useEffect(() => {
    const todo = mark ? mark.split("|").filter((k) => !toolCache.has(k)) : [];
    if (!todo.length) return;
    let live = true;
    let next = 0;
    const reader = async () => {
      while (live && next < todo.length) {
        const k = todo[next++];
        const tally = await readTools(k.slice(0, k.lastIndexOf("@")));
        if (toolCache.size > 2000) toolCache.clear();
        toolCache.set(k, tally);
      }
    };
    void Promise.all(Array.from({ length: Math.min(6, todo.length) }, reader)).then(() => {
      if (live) setGot(new Map(toolCache));
    });
    return () => {
      live = false;
    };
  }, [mark]);

  return useMemo(() => {
    const by = new Map<string, { calls: number; ms: number }>();
    let read = 0;
    let unread = 0;
    let pending = 0;
    for (const k of keys) {
      if (!got.has(k)) {
        pending += 1;
        continue;
      }
      const tally = got.get(k);
      if (!tally) {
        unread += 1;
        continue;
      }
      read += 1;
      for (const t of tally) {
        const sum = by.get(t.tool) ?? { calls: 0, ms: 0 };
        sum.calls += t.calls;
        sum.ms += t.ms;
        by.set(t.tool, sum);
      }
    }
    return { tools: [...by].map(([tool, t]) => ({ tool, ...t })), read, unread, pending };
  }, [keys, got]);
}

/* ═══════════════════ latency ═══════════════════ */

/** Nearest-rank, as app/api/observability/route.ts computes it. */
function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

export interface Latency {
  p50: number;
  p95: number;
  max: number;
  /** Runs measured. */
  runs: number;
  /** Where the durations came from: the observability route's traces, or the ledger's own `ms` where that route has no journals to read. */
  basis: "traces" | "ledger";
}

/**
 * p50 and p95 run duration over the window. The observability route computes
 * its percentiles over every run ever made; for a window they are computed
 * here, the same way, over the route's traces in that window. The route's
 * own figure is used when the window is everything and it lists fewer traces
 * than it counted. A deployment whose console cannot read the journals falls
 * back to the duration each ledger row carries.
 */
export function latencyOf(estate: Estate, rows: readonly RunRow[], win: Win): Latency | null {
  const obs = estate.observability;
  if (obs && obs.traces.length) {
    if (win === "all" && obs.latency && (obs.total ?? 0) > obs.traces.length) return { p50: obs.latency.p50, p95: obs.latency.p95, max: obs.latency.max, runs: obs.total ?? obs.traces.length, basis: "traces" };
    // The ledger says which runs are production's; a trace it does not list at all is kept.
    const listed = new Set((estate.runs ?? []).map((r) => r.id));
    const counted = new Set(rows.map((r) => r.id));
    const ms = inWindow(obs.traces, (t) => t.startedAt, estate.now, win)
      .filter((t) => counted.has(t.id) || !listed.has(t.id))
      .map((t) => t.durationMs)
      .filter((v) => Number.isFinite(v))
      .sort((a, b) => a - b);
    return ms.length ? { p50: percentile(ms, 50), p95: percentile(ms, 95), max: ms[ms.length - 1], runs: ms.length, basis: "traces" } : null;
  }
  const ms = rows
    .filter((r) => !r.live && r.state !== "running" && r.ms > 0)
    .map((r) => r.ms)
    .sort((a, b) => a - b);
  return ms.length ? { p50: percentile(ms, 50), p95: percentile(ms, 95), max: ms[ms.length - 1], runs: ms.length, basis: "ledger" } : null;
}

/* ═══════════════════ failure trend ═══════════════════ */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export interface Trend {
  /** Failed runs per bucket, oldest first. */
  points: number[];
  /** One bucket's length, as a word. */
  unit: "hour" | "day" | "week" | "30 days";
  /** When the first bucket starts. */
  from: number;
}

/** Failed runs per bucket over the window: hours over a day, days up to a month and a half, weeks up to a year, then 30-day spans. Buckets count back from now. */
export function failureTrend(rows: readonly RunRow[], now: number, win: Win, earliest: number | null): Trend {
  const span = Number.isFinite(winMs(win)) ? winMs(win) : Math.max(DAY, now - (earliest ?? now));
  const [size, unit]: [number, Trend["unit"]] = span <= DAY ? [HOUR, "hour"] : span <= 45 * DAY ? [DAY, "day"] : span <= 366 * DAY ? [7 * DAY, "week"] : [30 * DAY, "30 days"];
  const n = Math.max(2, Math.ceil(span / size));
  const points = Array.from({ length: n }, () => 0);
  for (const r of rows) {
    if (r.state !== "failed") continue;
    const i = n - 1 - Math.floor((now - Date.parse(r.at)) / size);
    if (i >= 0 && i < n) points[i] += 1;
  }
  return { points, unit, from: now - n * size };
}

/* ═══════════════════ what needs a person ═══════════════════ */

export interface Need {
  id: string;
  /** The kind, as its mark reads. */
  kind: string;
  tone: Tone;
  title: string;
  agent: string;
  /** How long it has been open, milliseconds. */
  age: number;
  /** Where it is cleared. */
  href: string;
}

const NEED_TONE: Record<AttentionItem["kind"], Tone> = {
  gate: "warn",
  refusal: "err",
  budget: "err",
  dead_letter: "queue",
  health: "err",
  drift: "warn",
  guardian: "err",
  side_channel: "warn",
  breaker: "err",
  override: "warn",
  rollback: "warn",
  policy_rollback: "err",
  attestation: "warn",
};

const sentence = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * The open items, in the attention queue's own order, then any pending gate
 * the queue does not already list (the queue folds gates in; the inbox is
 * read as well so a gate shows even where the queue cannot be read). A gate
 * is cleared on the approvals page, everything else on Control.
 */
export function needsOf(attention: readonly AttentionItem[] | null, gates: readonly Gate[] | null, now: number): Need[] {
  const out: Need[] = (attention ?? []).map((a) => ({
    id: a.id,
    kind: sentence(ATTENTION_LABEL[a.kind] ?? a.kind),
    tone: NEED_TONE[a.kind] ?? "warn",
    title: a.title || a.detail || "An open item",
    agent: a.agent,
    age: a.age_s * 1000,
    href: a.kind === "gate" ? "/approvals" : "/control",
  }));
  const listed = new Set((attention ?? []).filter((a) => a.kind === "gate" && a.run).map((a) => a.run));
  const waiting = (g: Gate) => (g.waiting_since ? Date.parse(g.waiting_since) : NaN);
  const rest = (gates ?? []).filter((g) => !listed.has(g.run)).sort((a, b) => (waiting(a) || 0) - (waiting(b) || 0));
  for (const g of rest) {
    out.push({
      id: `gate:${g.run}`,
      kind: "Gate",
      tone: "warn",
      title: g.asks || `${g.node || "A step"} is waiting for an answer`,
      agent: g.agent,
      age: Number.isNaN(waiting(g)) ? 0 : now - waiting(g),
      href: "/approvals",
    });
  }
  return out;
}

/** The longest any pending gate has waited, milliseconds; null when none says since when. */
export function oldestGate(gates: readonly Gate[], now: number): number | null {
  const since = gates.map((g) => Date.parse(g.waiting_since)).filter((t) => !Number.isNaN(t));
  return since.length ? now - Math.min(...since) : null;
}
