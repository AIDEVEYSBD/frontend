"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "@/lib/api/client";
import { listAttention, listGates, type AttentionItem, type Gate } from "@/lib/api/l5";
import { agentHref } from "@/lib/agent-link";
import { ATTENTION_LABEL, orderAttention } from "@/lib/gates";
import { soon } from "@/lib/soon";
import type { Tone } from "./ui";
import type { Win } from "./window-pick";

/**
 * What the Overview and the Dashboards read.
 *
 * Every figure is the platform's own count (`GET /api/estate?window=`,
 * agentfactory/estate/figures.py): runs by state, spend with the calls that
 * had no price counted apart, latency over the ended runs, the failure
 * trend, refusals and control firings, and the rankings of agents, people,
 * tools and models. The two screens read the same answer, so a figure is the
 * same number on both. What waits on a person is read from the attention
 * queue (`GET /api/attention`) and the approvals inbox (`GET /api/approvals`).
 */

/* ═══════════════════ shapes (mirror GET /api/estate) ═══════════════════ */

export interface Spend {
  calls: number;
  priced_calls: number;
  /** Calls on a model with no price set: never counted as $0. */
  unpriced_calls: number;
  unpriced_models: string[];
  /** The priced calls' sum: 0 with no call, null when there were calls and none was priced. */
  cost_usd: number | null;
  tokens_in: number;
  tokens_out: number;
}

export interface LockdownNow {
  on: boolean;
  reason: string;
  by: string;
  at: string | null;
}

export interface EstateNow {
  running: number;
  at_gate: number;
  oldest_gate_since: string | null;
  last_run_at: string | null;
  paused_at_budget: number;
  in_flight: number;
  agents_held: { paused: number; draining: number };
  lockdown: LockdownNow;
}

export interface EstateFigures {
  window: Win;
  since: string | null;
  until: string;
  runs: { total: number; by_state: Record<string, number> };
  spend: Spend;
  latency: { p50: number; p95: number; p99: number; max: number; runs: number } | null;
  trend: { unit: "hour" | "day" | "week" | "30 days"; size_s: number; from: string; failed: number[]; cost_usd: number[]; unpriced_calls: number[] };
  refusals: { total: number; runs: number; by_control: { control: string; count: number }[]; by_agent: { agent: string; count: number }[] };
  firings: { total: number; by_control: { control: string; count: number }[] };
  gates: { opened: number; answered: number };
  rank: {
    agents: { id: string; name: string; runs: number; cost_usd: number | null; unpriced_calls: number }[];
    people: { key: string; name: string; email: string; kind: string; runs: number; cost_usd: number | null; unpriced_calls: number }[];
    tools: { tool: string; calls: number; ms: number; ran: number; refused: number; failed: number; open: number }[];
    models: { model: string; calls: number; tokens: number; cost_usd: number | null; unpriced_calls: number }[];
  };
  now: EstateNow;
  budget: { budget_usd: number; period: "day" | "week" | "month"; since: string; spent: number; unpriced: number; remaining: number; exceeded: boolean; used: number } | null;
  basis: string;
  not_included: { what: string; why: string }[];
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

export const plural = (n: number, one: string, many = `${one}s`) => `${fmtCount(n)} ${n === 1 ? one : many}`;

/** "2 calls with no price set (free-x)", or "" when every call was priced. */
export function unpricedWords(s: Spend): string {
  if (!s.unpriced_calls) return "";
  return `${plural(s.unpriced_calls, "call")} with no price set${s.unpriced_models.length ? ` (${s.unpriced_models.join(", ")})` : ""}`;
}

/** A spend figure as a tile shows it: the priced sum, or "Not priced" when no call of the window was priced. */
export const spendText = (s: Spend) => (s.cost_usd === null ? "Not priced" : fmtMoney(s.cost_usd));

/* ═══════════════════ the figures, read ═══════════════════ */

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** `GET /api/estate?window=`: the answer, or a thrown error carrying the platform's own words. */
async function readFigures(win: Win): Promise<EstateFigures> {
  const path = `/api/estate?window=${win}`;
  let res: Response;
  try {
    res = await fetch(path, { cache: "no-store" });
  } catch (e) {
    throw new Error(`the backend did not answer GET /api/estate (${message(e)})`);
  }
  const body = (await res.json().catch(() => null)) as (EstateFigures & { error?: string }) | null;
  if (!res.ok || !body || typeof body.runs !== "object" || body.runs === null) throw new Error(errorText(body, res, "GET", "/api/estate"));
  return body;
}

/**
 * The model calls the platform's figures leave out (`not_included`), each with
 * why: shown above every spend figure, so a total never reads as the whole
 * when the platform says it is not. Renders nothing when the answer names none.
 */
export function NotIncludedNote({ list }: { list: readonly { what: string; why: string }[] | undefined }) {
  if (!list?.length) return null;
  return (
    <div className="rounded-md border border-warn/40 bg-surface px-4 py-2.5 text-[12px] leading-[1.55] text-warn">
      {list.map((n) => (
        <p key={n.what}>
          <span className="font-medium">Not in any spend figure: {n.what}.</span> {n.why}
        </p>
      ))}
    </div>
  );
}

export interface Figures {
  data: EstateFigures | null;
  error: string;
  /** When the platform last answered (ms), 0 before it ever has; a later failure keeps the last answer and its time. */
  at: number;
}

/** The estate's figures for one window, read again every `everyMs`. A changed window is read at once, and an answer for an older window is dropped. */
export function useFigures(win: Win, everyMs = 15_000): Figures {
  const [figures, setFigures] = useState<Figures>({ data: null, error: "", at: 0 });
  const asked = useRef(win);
  const load = useCallback(async () => {
    const w = win;
    asked.current = w;
    try {
      const data = await readFigures(w);
      if (asked.current === w) setFigures({ data, error: "", at: Date.now() });
    } catch (e) {
      if (asked.current === w) setFigures((prev) => ({ data: prev.data && prev.data.window === w ? prev.data : null, error: message(e), at: prev.at }));
    }
  }, [win]);

  useEffect(() => {
    setFigures((prev) => (prev.data && prev.data.window !== win ? { data: null, error: "", at: 0 } : prev));
    const cancel = soon(load);
    const id = setInterval(load, everyMs);
    return () => {
      cancel();
      clearInterval(id);
    };
  }, [load, everyMs, win]);

  return figures;
}

/** What waits on a person: the attention queue and the approvals inbox, read again every `everyMs`. */
export function useWaiting(everyMs = 15_000): { gates: Gate[] | null; gatesError: string; attention: AttentionItem[] | null; attentionError: string } {
  const [state, setState] = useState<{ gates: Gate[] | null; gatesError: string; attention: AttentionItem[] | null; attentionError: string }>({
    gates: null,
    gatesError: "",
    attention: null,
    attentionError: "",
  });
  const load = useCallback(async () => {
    const [inbox, queue] = await Promise.allSettled([listGates(), listAttention()]);
    setState((prev) => ({
      gates: inbox.status === "fulfilled" ? inbox.value.pending : prev.gates,
      gatesError: inbox.status === "rejected" ? message(inbox.reason) : "",
      attention: queue.status === "fulfilled" ? orderAttention(queue.value) : prev.attention,
      attentionError: queue.status === "rejected" ? message(queue.reason) : "",
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
  return state;
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

/** Agents by runs, or by what their priced calls cost (a cost of null, every call unpriced, ranks nowhere). */
export function rankAgents(f: EstateFigures, measure: RunMeasure): RankRow[] {
  return f.rank.agents.map((a) => ({ key: a.id, label: a.name, value: measure === "runs" ? a.runs : a.cost_usd ?? 0, href: agentHref(a.id) }));
}

const KIND_WORD: Record<string, string> = { key: "key", service: "service" };

/** People, keys and services by the runs they started, or by what their calls cost. Runs that name nobody are one row, "no person". */
export function rankPeople(f: EstateFigures, measure: RunMeasure): RankRow[] {
  return f.rank.people.map((p) => ({
    key: p.key || "no-person",
    label: KIND_WORD[p.kind] ? `${p.name} (${KIND_WORD[p.kind]})` : p.name,
    value: measure === "runs" ? p.runs : p.cost_usd ?? 0,
  }));
}

export type ToolMeasure = "calls" | "ms";

export function rankTools(f: EstateFigures, measure: ToolMeasure): RankRow[] {
  return f.rank.tools.map((t) => ({ key: t.tool, label: t.tool, value: measure === "calls" ? t.calls : t.ms, code: true }));
}

/** Calls with no price among the rows a spend ranking leaves out. */
export const unpricedIn = (rows: readonly { unpriced_calls: number }[]) => rows.reduce((s, r) => s + r.unpriced_calls, 0);

/* ═══════════════════ what needs a person ═══════════════════ */

export interface Need {
  id: string;
  /** The kind, as its mark reads. */
  kind: string;
  tone: Tone;
  title: string;
  agent: string;
  /** How long it has been open, milliseconds; null when the platform gave no time it opened. */
  age: number | null;
  /** Where it is cleared. */
  href: string;
}

const NEED_TONE: Record<AttentionItem["kind"], Tone> = {
  gate: "warn",
  run: "err",
  fleet: "warn",
  lockdown: "err",
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
      age: Number.isNaN(waiting(g)) ? null : now - waiting(g),
      href: "/approvals",
    });
  }
  return out;
}
