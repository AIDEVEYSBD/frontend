"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Mono, Status, Tag } from "./ui";
import { CAT, RankBar, StackedBar } from "./charts";
import { ActiveFilters, Chips, FilterBar, SearchBox, type Chip } from "./filters";
import { usePageFacts } from "./assistant";
import { DrillModal, DrillTable } from "./drill";
import { Pick } from "./select";
import { hueFor } from "@/lib/hue";
import { FOUNDRY_ID, kindOf, type Provider } from "@/lib/providers";
import { WindowPick, winMs, type Win } from "./window-pick";

/**
 * FinOps: where the money goes, step by step, and where it could go instead.
 *
 * Every figure is computed in the browser from the primary records the route
 * returns — each model call with its node, tokens, latency and the price it
 * was costed at — so a window, a filter or a what-if never asks the server
 * for a different number, it re-cuts the same records. Nothing here is a
 * stored verdict: the hand-off candidates are derived from each step's own
 * call profile plus the eval evidence on record, and the calculator replays
 * the journalled workload at another model's price.
 */

/* ═══════════════════ shapes (mirror /api/finops) ═══════════════════ */

type ModelClass = "small" | "medium" | "large";
interface Offered { id: string; label: string; class?: ModelClass; price_in?: number; price_out?: number; provider?: string; served_as?: string }
interface Config { models: Offered[]; default_model: string; class_defaults: Partial<Record<ModelClass, string>>; providers: Provider[]; node_routes: Record<string, string> }
interface NodeSpec { id: string; harness: string; model: string; model_class: string; purpose: string; tools: number; risk: string; sinks: number; structured: boolean }
interface AgentSpec { id: string; name: string; deployed: boolean; gated: boolean; nodes: NodeSpec[] }
interface Run { id: string; system: string; state: string; at: string; ms: number; cost: number | null; tokens: { in: number; out: number }; denials: number; modelCalls: number }
interface Call { run: string; system: string; at: string; state: string; node: string; model: string; in: number; out: number; ms: number; cost: number | null; tools: number }
interface Eval { id: string; agent: string; model: string; passed: number; total: number; at: string; batch_id: string; compare: boolean; forced: boolean; incumbent: string | null; cost_per_case: number | null; cost_total: number | null; avg_ms: number | null }
interface Azure { configured: boolean; currency: string | null; mtd: number | null; last7d: number | null; error: string | null }
type Period = "day" | "week" | "month";
const PERIOD_DAYS: Record<Period, number> = { day: 1, week: 7, month: 30 };
interface BudgetState { since: string; spent: number; unpriced: number; remaining: number | null; exceeded: boolean; used: number | null }
interface Data { now: string; config: Config; agents: AgentSpec[]; runs: Run[]; calls: Call[]; evals: Eval[]; azure: Azure; budget: number | null; period: Period; budgetState: BudgetState; costBasis: string }

/* ═══════════════════ formatting ═══════════════════ */

const fmtCost = (c: number | null, precise = false) =>
  c === null ? "unknown" : c === 0 ? "$0.00" : c < 0.01 && precise ? `$${c.toFixed(4)}` : c < 0.005 ? "<$0.01" : c < 100 ? `$${c.toFixed(2)}` : `$${Math.round(c).toLocaleString("en-GB")}`;
const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(Math.round(n)));
const fmtMs = (ms: number | null) => (ms === null ? "—" : ms < 1000 ? `${Math.round(ms)}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60_000).toFixed(1)}m`);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
};

/* ═══════════════════ model economics ═══════════════════ */

interface ModelInfo { id: string; label: string; price_in: number | null; price_out: number | null; provider: Provider | null; local: boolean; hourly: number | null; tier: ModelClass | null }

function modelBook(cfg: Config): Map<string, ModelInfo> {
  const providers = new Map(cfg.providers.map((p) => [p.id, p]));
  const book = new Map<string, ModelInfo>();
  for (const m of cfg.models) {
    const provider = providers.get(m.provider ?? FOUNDRY_ID) ?? null;
    const local = Boolean(provider?.local);
    book.set(m.id, {
      id: m.id,
      label: m.label,
      price_in: local ? 0 : typeof m.price_in === "number" ? m.price_in : null,
      price_out: local ? 0 : typeof m.price_out === "number" ? m.price_out : null,
      provider,
      local,
      hourly: provider?.hourly_usd ?? null,
      tier: m.class ?? null,
    });
  }
  book.set("scripted", { id: "scripted", label: "scripted (no model)", price_in: 0, price_out: 0, provider: null, local: true, hourly: 0, tier: null });
  return book;
}

/** What one journalled call would cost on a given model — replaying its tokens and time. */
function replay(call: { in: number; out: number; ms: number }, m: { price_in: number | null; price_out: number | null; local: boolean; hourly: number | null }, speed = 1): number | null {
  if (m.local) {
    // Tokens are free on hardware already paid for; the hour is the cost.
    if (m.hourly === null) return null;
    return ((call.ms * speed) / 3_600_000) * m.hourly;
  }
  if (m.price_in === null && m.price_out === null) return null;
  return (call.in * (m.price_in ?? 0) + call.out * (m.price_out ?? 0)) / 1_000_000;
}

const sumCost = (xs: (number | null)[]): number | null =>
  xs.length === 0 || xs.every((x) => x === null) ? (xs.length ? null : 0) : xs.reduce((a: number, b) => a + (b ?? 0), 0);

/* ═══════════════════ the page ═══════════════════ */

type Drill =
  | { kind: "calls"; title: string; subtitle?: string; rows: Call[] }
  | { kind: "runs"; title: string; subtitle?: string; rows: Run[] }
  | { kind: "node"; agent: string; node: string }
  | { kind: "model"; id: string };

export function FinOps() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [win, setWin] = useState<Win>("30d");
  const [overrides, setOverrides] = useState<Partial<Record<string, Win>>>({});
  const [agentF, setAgentF] = useState<Set<string>>(new Set());
  const [modelF, setModelF] = useState<Set<string>>(new Set());
  const [placeF, setPlaceF] = useState<"local" | "cloud" | null>(null);
  const [search, setSearch] = useState("");
  const [drill, setDrill] = useState<Drill | null>(null);
  const [folds, setFolds] = useState<Record<string, boolean>>({});
  const [routes, setRoutes] = useState<Record<string, string>>({});
  const [routesDirty, setRoutesDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");

  const load = useCallback(() => {
    fetch("/api/finops")
      .then((r) => r.json())
      .then((d: Data) => {
        if ((d as unknown as { error?: string }).error) throw new Error((d as unknown as { error: string }).error);
        setData(d);
        setRoutes(d.config.node_routes ?? {});
        setRoutesDirty(false);
      })
      .catch((e) => setError(String(e)));
  }, []);
  useEffect(load, [load]);

  const winFor = (card: string): Win => overrides[card] ?? win;
  const setCardWin = (card: string, w: Win) => setOverrides((o) => ({ ...o, [card]: w }));
  const setGlobal = (w: Win) => {
    setWin(w);
    setOverrides({});
  };

  const book = useMemo(() => (data ? modelBook(data.config) : new Map<string, ModelInfo>()), [data]);
  const [loadedAt] = useState(() => Date.now());
  const now = data ? new Date(data.now).getTime() : loadedAt;
  const inWin = useCallback((at: string, w: Win) => now - new Date(at).getTime() <= winMs(w), [now]);

  // The filters cut every card the same way; the window is the one axis a card may override.
  const passes = useCallback(
    (c: Call) => {
      if (agentF.size && !agentF.has(c.system)) return false;
      if (modelF.size && !modelF.has(c.model)) return false;
      if (placeF) {
        const local = book.get(c.model)?.local ?? false;
        if ((placeF === "local") !== local) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        if (!`${c.system} ${c.node} ${c.model} ${c.run}`.toLowerCase().includes(q)) return false;
      }
      return true;
    },
    [agentF, modelF, placeF, search, book],
  );
  const callsIn = useCallback((w: Win) => (data?.calls ?? []).filter((c) => inWin(c.at, w) && passes(c)), [data, inWin, passes]);
  const runsIn = useCallback(
    (w: Win) => (data?.runs ?? []).filter((r) => inWin(r.at, w) && (!agentF.size || agentF.has(r.system)) && (!search || `${r.system} ${r.id}`.toLowerCase().includes(search.toLowerCase()))),
    [data, inWin, agentF, search],
  );

  const spanDays = (w: Win, calls: Call[]) => {
    if (w !== "all") return winMs(w) / 86_400_000;
    if (!calls.length) return 1;
    const first = Math.min(...calls.map((c) => new Date(c.at).getTime()));
    return Math.max(1, (now - first) / 86_400_000);
  };

  /* ── per-card figures ── */
  const kpiCalls = callsIn(winFor("kpi"));
  const kpiRuns = runsIn(winFor("kpi"));
  const totals = useMemo(() => {
    const cost = sumCost(kpiCalls.map((c) => c.cost));
    const tokens = kpiCalls.reduce((s, c) => s + c.in + c.out, 0);
    const localTokens = kpiCalls.filter((c) => book.get(c.model)?.local).reduce((s, c) => s + c.in + c.out, 0);
    const unpriced = kpiCalls.filter((c) => c.cost === null).length;
    const days = spanDays(winFor("kpi"), kpiCalls);
    return {
      cost,
      tokens,
      calls: kpiCalls.length,
      runs: kpiRuns.length,
      perRun: cost === null || !kpiRuns.length ? null : cost / kpiRuns.length,
      perCall: cost === null || !kpiCalls.length ? null : cost / kpiCalls.length,
      localShare: tokens ? localTokens / tokens : 0,
      monthly: cost === null ? null : (cost / days) * 30,
      unpriced,
      avgMs: kpiCalls.length ? kpiCalls.reduce((s, c) => s + c.ms, 0) / kpiCalls.length : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kpiCalls, kpiRuns, book]);

  usePageFacts(
    data
      ? {
          window: winFor("kpi"),
          spendUSD: totals.cost,
          tokens: totals.tokens,
          modelCalls: totals.calls,
          localShareOfTokens: totals.localShare,
          projectedMonthlyUSD: totals.monthly,
          providers: data.config.providers.map((p) => ({ id: p.id, kind: p.kind, local: Boolean(p.local) })),
          nodeRoutes: routes,
        }
      : null,
  );

  const agentsById = useMemo(() => new Map((data?.agents ?? []).map((a) => [a.id, a])), [data]);
  const resolve = useCallback(
    (agent: string, node: NodeSpec | undefined, withRoutes = routes) => {
      if (!data) return "";
      const key = `${agent}/${node?.id ?? ""}`;
      return withRoutes[key] || node?.model || (node?.model_class ? data.config.class_defaults[node.model_class as ModelClass] ?? "" : "") || data.config.default_model;
    },
    [data, routes],
  );

  /* ── spend over time ── */
  const timeWin = winFor("time");
  const timeCalls = callsIn(timeWin);
  const series = useMemo(() => {
    const days = Math.min(90, Math.max(7, Math.ceil(spanDays(timeWin, timeCalls))));
    const byModel = new Map<string, number>();
    for (const c of timeCalls) byModel.set(c.model, (byModel.get(c.model) ?? 0) + (c.cost ?? 0));
    const keys = [...byModel.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).slice(0, 6);
    if ([...byModel.keys()].length > keys.length) keys.push("other");
    const rows: { label: string; values: number[]; day: string }[] = [];
    for (let d = days - 1; d >= 0; d--) {
      const day = new Date(now - d * 86_400_000).toISOString().slice(0, 10);
      const values = keys.map(() => 0);
      for (const c of timeCalls) {
        if (c.at.slice(0, 10) !== day) continue;
        const i = keys.indexOf(c.model);
        values[i === -1 ? keys.length - 1 : i] += c.cost ?? 0;
      }
      rows.push({ label: days > 30 ? (d % 7 === 0 ? day.slice(5) : "") : day.slice(5), values, day });
    }
    return { keys, rows };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeCalls, timeWin, now]);

  /* ── by model ── */
  const modelWin = winFor("models");
  const modelCalls = callsIn(modelWin);
  const byModel = useMemo(() => {
    const agg = new Map<string, { calls: number; in: number; out: number; ms: number; cost: number | null; runs: Set<string> }>();
    for (const c of modelCalls) {
      const a = agg.get(c.model) ?? { calls: 0, in: 0, out: 0, ms: 0, cost: 0, runs: new Set<string>() };
      a.calls += 1;
      a.in += c.in;
      a.out += c.out;
      a.ms += c.ms;
      a.cost = a.cost === null || c.cost === null ? null : a.cost + c.cost;
      a.runs.add(c.run);
      agg.set(c.model, a);
    }
    const total = sumCost([...agg.values()].map((a) => a.cost)) ?? 0;
    return [...agg.entries()]
      .map(([model, a]) => ({ model, ...a, runs: a.runs.size, share: total ? (a.cost ?? 0) / total : 0, info: book.get(model) ?? null }))
      .sort((x, y) => (y.cost ?? 0) - (x.cost ?? 0) || y.calls - x.calls);
  }, [modelCalls, book]);

  /* ── by workflow ── */
  const wfWin = winFor("workflows");
  const wfCalls = callsIn(wfWin);
  const byWorkflow = useMemo(() => {
    const agg = new Map<string, { calls: number; cost: number | null; runs: Set<string>; tokens: number }>();
    for (const c of wfCalls) {
      const a = agg.get(c.system) ?? { calls: 0, cost: 0, runs: new Set<string>(), tokens: 0 };
      a.calls += 1;
      a.tokens += c.in + c.out;
      a.cost = a.cost === null || c.cost === null ? null : a.cost + c.cost;
      a.runs.add(c.run);
      agg.set(c.system, a);
    }
    return [...agg.entries()]
      .map(([id, a]) => ({ id, name: agentsById.get(id)?.name ?? id, calls: a.calls, cost: a.cost, runs: a.runs.size, tokens: a.tokens, perRun: a.cost === null ? null : a.cost / Math.max(1, a.runs.size) }))
      .sort((x, y) => (y.cost ?? 0) - (x.cost ?? 0));
  }, [wfCalls, agentsById]);

  /* ── by step: the profile every recommendation is made from ── */
  interface Profile {
    agent: string; node: string; spec: NodeSpec | undefined; calls: number; runs: number; avgIn: number; avgOut: number; avgMs: number; toolRate: number;
    cost: number | null; share: number; models: string[]; effective: string; rows: Call[];
  }
  const stepWin = winFor("steps");
  const stepCalls = callsIn(stepWin);
  const profiles = useMemo<Profile[]>(() => {
    const agg = new Map<string, { rows: Call[]; runs: Set<string>; models: Set<string> }>();
    for (const c of stepCalls) {
      const key = `${c.system}/${c.node}`;
      const a = agg.get(key) ?? { rows: [], runs: new Set<string>(), models: new Set<string>() };
      a.rows.push(c);
      a.runs.add(c.run);
      a.models.add(c.model);
      agg.set(key, a);
    }
    const total = sumCost(stepCalls.map((c) => c.cost)) ?? 0;
    return [...agg.entries()]
      .map(([key, a]) => {
        const [agent, node] = key.split("/");
        const spec = agentsById.get(agent)?.nodes.find((n) => n.id === node);
        const cost = sumCost(a.rows.map((r) => r.cost));
        const n = a.rows.length;
        return {
          agent, node, spec, calls: n, runs: a.runs.size,
          avgIn: a.rows.reduce((s, r) => s + r.in, 0) / n,
          avgOut: a.rows.reduce((s, r) => s + r.out, 0) / n,
          avgMs: a.rows.reduce((s, r) => s + r.ms, 0) / n,
          toolRate: a.rows.filter((r) => r.tools > 0).length / n,
          cost, share: total ? (cost ?? 0) / total : 0,
          models: [...a.models], effective: resolve(agent, spec), rows: a.rows,
        };
      })
      .sort((x, y) => (y.cost ?? 0) - (x.cost ?? 0) || y.calls - x.calls);
  }, [stepCalls, agentsById, resolve]);

  /* ── eval evidence: per workflow, the latest comparison ── */
  const evidence = useMemo(() => {
    const out = new Map<string, { batch: string; at: string; incumbent: string; rows: (Eval & { rate: number; clears: boolean })[]; best: string | null }>();
    for (const e of data?.evals ?? []) {
      if (!e.compare) continue;
      const have = out.get(e.agent);
      if (have && have.batch !== e.batch_id) continue; // evals arrive newest first — keep the newest batch
      const cur = have ?? { batch: e.batch_id, at: e.at, incumbent: e.incumbent ?? "", rows: [], best: null };
      cur.rows.push({ ...e, rate: e.passed / Math.max(1, e.total), clears: false });
      out.set(e.agent, cur);
    }
    for (const v of out.values()) {
      const inc = v.rows.find((r) => r.model === v.incumbent) ?? v.rows[0];
      const floor = (inc?.rate ?? 0) - 0.02;
      for (const r of v.rows) r.clears = r.rate >= floor;
      const eligible = v.rows.filter((r) => r.clears && r.cost_per_case !== null).sort((a, b) => (a.cost_per_case as number) - (b.cost_per_case as number));
      v.best = eligible[0]?.model ?? null;
      v.rows.sort((a, b) => b.rate - a.rate || (a.cost_per_case ?? 1e9) - (b.cost_per_case ?? 1e9));
    }
    return out;
  }, [data]);

  /* ── hand-off candidates ── */
  const localModels = useMemo(() => [...book.values()].filter((m) => m.local && m.id !== "scripted"), [book]);
  const smallest = useMemo(() => {
    const priced = [...book.values()].filter((m) => !m.local && m.price_out !== null).sort((a, b) => (a.price_in ?? 0) + (a.price_out ?? 0) - ((b.price_in ?? 0) + (b.price_out ?? 0)));
    return priced[0] ?? null;
  }, [book]);
  interface Verdict { p: Profile; action: "handoff" | "trial" | "keep"; target: ModelInfo | null; reasons: string[]; saving: number | null; projected: number | null }
  const verdicts = useMemo<Verdict[]>(() => {
    return profiles
      .map((p): Verdict => {
        const reasons: string[] = [];
        const s = p.spec;
        const current = book.get(p.effective) ?? null;
        const ev = evidence.get(p.agent);
        let action: Verdict["action"] = "trial";
        let target: ModelInfo | null = null;
        if (current?.local) {
          return { p, action: "keep", target: current, reasons: ["already on a local provider"], saving: 0, projected: p.cost };
        }
        if (s && s.risk === "destructive" && !agentsById.get(p.agent)?.gated) {
          action = "keep";
          reasons.push("may call destructive tools with no approval gate on the workflow");
        } else if (p.avgOut > 1500) {
          action = "keep";
          reasons.push(`long generations — ${fmtTokens(p.avgOut)} tokens out per call on average`);
        } else if (p.avgIn > 40_000) {
          action = "keep";
          reasons.push(`very long prompts — ${fmtTokens(p.avgIn)} tokens in per call; needs a large context window`);
        } else {
          reasons.push(`short output (${fmtTokens(p.avgOut)} tokens out) on ${fmtTokens(p.avgIn)} in — a bounded task`);
          if (s?.structured) reasons.push("emits a typed contract, so a wrong answer is caught by the schema");
          if (p.toolRate > 0.5) reasons.push(`drives tools on ${pct(p.toolRate)} of calls — needs reliable function calling`);
          if (s?.risk === "read" || s?.risk === "none") reasons.push("read-only tool grants");
          if (ev?.best && ev.best !== ev.incumbent && book.get(ev.best)) {
            target = book.get(ev.best)!;
            action = "handoff";
            const row = ev.rows.find((r) => r.model === ev.best)!;
            const inc = ev.rows.find((r) => r.model === ev.incumbent);
            reasons.push(`eval evidence: ${ev.best} scored ${row.passed}/${row.total} against ${inc ? `${inc.passed}/${inc.total}` : "the incumbent"} at ${fmtCost(row.cost_per_case, true)} per case`);
          } else if (localModels[0]) {
            target = localModels[0];
            action = "trial";
            reasons.push(ev ? "no candidate cleared the incumbent's quality in the latest comparison — trial locally with a fresh eval" : "no eval comparison on record yet — run Compare models before switching");
          } else if (smallest && smallest.id !== p.effective) {
            target = smallest;
            action = "trial";
            reasons.push("no local provider configured — the cheapest offered model is the next best hand-off");
          } else {
            action = "keep";
            reasons.push("already on the cheapest offered model and no local provider is configured");
          }
        }
        const projected = target ? sumCost(p.rows.map((r) => replay(r, target!, target!.local ? 1.5 : 1))) : p.cost;
        const saving = p.cost === null || projected === null ? null : p.cost - projected;
        return { p, action, target, reasons, saving, projected };
      })
      .sort((a, b) => (b.saving ?? -1) - (a.saving ?? -1));
  }, [profiles, book, evidence, agentsById, localModels, smallest]);

  /* ── calculator ── */
  const [calcModel, setCalcModel] = useState<string>("");
  const [customIn, setCustomIn] = useState("0.15");
  const [customOut, setCustomOut] = useState("0.60");
  const [customHourly, setCustomHourly] = useState("2.50");
  const [customLocal, setCustomLocal] = useState(false);
  const [speed, setSpeed] = useState("1.5");
  const calcWin = winFor("calc");
  const calcCalls = callsIn(calcWin);
  const calcTarget: ModelInfo | null = useMemo(() => {
    if (calcModel === "custom") {
      return { id: "custom", label: "Custom model", price_in: Number(customIn) || 0, price_out: Number(customOut) || 0, provider: null, local: customLocal, hourly: Number(customHourly) || 0, tier: null };
    }
    return book.get(calcModel) ?? null;
  }, [calcModel, customIn, customOut, customHourly, customLocal, book]);
  const calc = useMemo(() => {
    const actual = sumCost(calcCalls.map((c) => c.cost));
    const sp = Number(speed) || 1;
    const projected = calcTarget ? sumCost(calcCalls.map((c) => replay(c, calcTarget, calcTarget.local ? sp : 1))) : null;
    const days = spanDays(calcWin, calcCalls);
    const perModel = [...book.values()]
      .filter((m) => m.id !== "scripted")
      .map((m) => ({ m, cost: sumCost(calcCalls.map((c) => replay(c, m, m.local ? sp : 1))) }))
      .sort((a, b) => (a.cost ?? Infinity) - (b.cost ?? Infinity));
    return { actual, projected, days, perModel, runs: new Set(calcCalls.map((c) => c.run)).size, ms: calcCalls.reduce((s, c) => s + c.ms, 0) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calcCalls, calcTarget, speed, book, calcWin]);

  /* ── routing table ── */
  const routeRows = useMemo(
    () =>
      (data?.agents ?? []).flatMap((a) =>
        a.nodes
          .filter((n) => n.harness !== "await")
          .map((n) => {
            const key = `${a.id}/${n.id}`;
            const p = profiles.find((x) => x.agent === a.id && x.node === n.id);
            return { key, agent: a, node: n, route: routes[key] ?? "", effective: resolve(a.id, n), specSays: n.model ? `spec: ${n.model}` : n.model_class ? `tier: ${n.model_class}` : "deployment default", calls: p?.calls ?? 0, cost: p?.cost ?? null };
          }),
      ),
    [data, profiles, routes, resolve],
  );
  const setRoute = (key: string, model: string) => {
    setRoutes((r) => {
      const next = { ...r };
      if (model) next[key] = model;
      else delete next[key];
      return next;
    });
    setRoutesDirty(true);
  };
  const saveRoutes = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/config", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ node_routes: routes }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      setRoutesDirty(false);
      setSaved("routes saved — the next run of each workflow uses them");
      setTimeout(() => setSaved(""), 4000);
    } catch (e) {
      setSaved(`could not save: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };
  const applyAll = () => {
    for (const v of verdicts) if (v.action === "handoff" && v.target) setRoute(`${v.p.agent}/${v.p.node}`, v.target.id);
    document.getElementById("routing")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  /* ── filter chips ── */
  const chipsAgents: Chip[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of data?.calls ?? []) if (inWin(c.at, win)) counts.set(c.system, (counts.get(c.system) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ value: id, label: agentsById.get(id)?.name ?? id, count: n, active: agentF.has(id) }));
  }, [data, inWin, win, agentF, agentsById]);
  const chipsModels: Chip[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of data?.calls ?? []) if (inWin(c.at, win)) counts.set(c.model, (counts.get(c.model) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ value: id, label: id, count: n, active: modelF.has(id), tone: book.get(id)?.local ? "ok" : undefined }));
  }, [data, inWin, win, modelF, book]);
  const toggleIn = (set: Set<string>, v: string) => {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    return n;
  };
  const filterCount = agentF.size + modelF.size + (placeF ? 1 : 0) + (search ? 1 : 0);
  const clearFilters = () => {
    setAgentF(new Set());
    setModelF(new Set());
    setPlaceF(null);
    setSearch("");
  };

  const toggleFold = (id: string) => setFolds((f) => ({ ...f, [id]: !f[id] }));
  const offeredOptions = useMemo(
    () => [{ value: "", label: "no override" }, ...(data?.config.models ?? []).map((m) => ({ value: m.id, label: `${m.label}${book.get(m.id)?.local ? " · local" : ""}` }))],
    [data, book],
  );

  // The budget is per period; the KPI shows the current rolling period, which is
  // the figure runs are refused against. The window's own comparison is below.
  const budgetUse = data?.budgetState?.used ?? null;
  const windowDays = winFor("kpi") === "all" ? Math.max(1, spanDays("all", kpiCalls)) : winMs(winFor("kpi")) / 86_400_000;
  const windowBudget = data?.budget != null ? (data.budget * windowDays) / PERIOD_DAYS[data.period] : null;

  return (
    <div className="min-h-full" data-hue="green">
      <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-5 px-5 py-7">
        {/* ── Header ── */}
        <header className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">FinOps</h1>
            <p className="max-w-[72ch] text-[12.5px] leading-[1.55] text-dim">
              Model spend by provider, workflow and step, computed from every journalled model call at the configured price. Replay the same workload on
              another model, see which steps are candidates for a smaller or local model, and route them without touching a spec.
            </p>
          </div>
          <span className="grow" />
          <div className="flex flex-col items-end gap-1">
            <span className="text-[10.5px] text-faint">Page window</span>
            <WindowPick value={win} onChange={setGlobal} />
          </div>
        </header>

        {error && <p className="text-[12.5px] text-err">{error}</p>}

        {/* ── Filters ── */}
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-4 py-3 elev-1">
          <FilterBar count={filterCount} onClear={clearFilters}>
            <Chips label="Workflow" items={chipsAgents} onToggle={(v) => setAgentF((s) => toggleIn(s, v))} />
            <Chips label="Model" items={chipsModels.slice(0, 8)} onToggle={(v) => setModelF((s) => toggleIn(s, v))} />
            <Chips
              label="Served"
              items={[
                { value: "cloud", label: "Cloud", active: placeF === "cloud" },
                { value: "local", label: "Local", active: placeF === "local", tone: "ok" },
              ]}
              onToggle={(v) => setPlaceF((p) => (p === v ? null : (v as "local" | "cloud")))}
            />
            <SearchBox value={search} onChange={setSearch} placeholder="Search step, model or run" width="w-[240px]" />
          </FilterBar>
          <ActiveFilters
            items={[
              ...[...agentF].map((a) => ({ key: `a:${a}`, label: `Workflow: ${agentsById.get(a)?.name ?? a}` })),
              ...[...modelF].map((m) => ({ key: `m:${m}`, label: `Model: ${m}` })),
              ...(placeF ? [{ key: "p", label: `Served: ${placeF}` }] : []),
              ...(search ? [{ key: "q", label: `“${search}”` }] : []),
            ]}
            onClear={(k) => {
              if (k.startsWith("a:")) setAgentF((s) => toggleIn(s, k.slice(2)));
              else if (k.startsWith("m:")) setModelF((s) => toggleIn(s, k.slice(2)));
              else if (k === "p") setPlaceF(null);
              else setSearch("");
            }}
          />
        </div>

        {/* ── KPI band ── */}
        <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
          <div data-hue="green" className="flex h-9 items-center gap-2 border-b border-line bg-raise/55 px-3">
            <span className="text-[12px] font-semibold">Spend</span>
            <span className="truncate text-[11px] text-faint">{data ? data.costBasis : "reading the ledger…"}</span>
            <span className="grow" />
            <WindowPick value={winFor("kpi")} onChange={(w) => setCardWin("kpi", w)} inherited={!overrides.kpi} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8">
            <Kpi label={`Spend · ${winFor("kpi")}`} value={data ? fmtCost(totals.cost) : "…"} sub={totals.unpriced ? `${totals.unpriced} calls unpriced` : `${totals.calls} model calls`} tone="ok"
              onOpen={() => setDrill({ kind: "calls", title: `Model calls · ${winFor("kpi")}`, subtitle: "Every call in the window, newest first, with the price it was costed at.", rows: kpiCalls })} />
            <Kpi label="Tokens" value={data ? fmtTokens(totals.tokens) : "…"} sub={`${fmtTokens(kpiCalls.reduce((s, c) => s + c.in, 0))} in · ${fmtTokens(kpiCalls.reduce((s, c) => s + c.out, 0))} out`}
              onOpen={() => setDrill({ kind: "calls", title: "Tokens by call", rows: [...kpiCalls].sort((a, b) => b.in + b.out - (a.in + a.out)) })} />
            <Kpi label="Runs" value={data ? String(totals.runs) : "…"} sub={`${totals.calls} calls · ${totals.runs ? (totals.calls / totals.runs).toFixed(1) : "0"} per run`}
              onOpen={() => setDrill({ kind: "runs", title: `Runs · ${winFor("kpi")}`, rows: kpiRuns })} />
            <Kpi label="Cost per run" value={data ? fmtCost(totals.perRun, true) : "…"} sub="spend ÷ runs in window"
              onOpen={() => setDrill({ kind: "runs", title: "Runs by cost", subtitle: "Most expensive first.", rows: [...kpiRuns].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0)) })} />
            <Kpi label="Cost per call" value={data ? fmtCost(totals.perCall, true) : "…"} sub={`avg latency ${fmtMs(totals.avgMs)}`}
              onOpen={() => setDrill({ kind: "calls", title: "Calls by cost", subtitle: "Most expensive first.", rows: [...kpiCalls].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0)) })} />
            <Kpi label="Local share" value={data ? pct(totals.localShare) : "…"} sub="tokens served on local providers" tone={totals.localShare > 0 ? "ok" : undefined}
              onOpen={() => setDrill({ kind: "calls", title: "Calls on local providers", rows: kpiCalls.filter((c) => book.get(c.model)?.local) })} />
            <Kpi label="Run rate · month" value={data ? fmtCost(totals.monthly) : "…"} sub={`from ${winFor("kpi") === "all" ? "the whole record" : `the last ${winFor("kpi")}`}`}
              onOpen={() => document.getElementById("calc")?.scrollIntoView({ behavior: "smooth" })} />
            <Kpi label={data?.budget ? `Budget · this ${data.period}` : "Budget"} value={data ? (data.budget ? pct(budgetUse ?? 0) : "not set") : "…"} sub={data?.budget ? (data.budgetState.exceeded ? "exhausted · new runs are refused" : `${fmtCost(data.budgetState.spent)} of ${fmtCost(data.budget)} per ${data.period}`) : "set one below"} tone={data?.budgetState?.exceeded ? "err" : budgetUse !== null && budgetUse > 0.8 ? "warn" : undefined}
              onOpen={() => document.getElementById("billing")?.scrollIntoView({ behavior: "smooth" })} />
          </div>
        </section>

        {/* ── Row: time series + by model ── */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.3fr_1fr]">
          <Section id="time" title="Spend over time" caption="Daily spend stacked by model. Click a bar for the calls behind it." folded={folds.time} onToggle={() => toggleFold("time")}
            meta={<WindowPick value={timeWin} onChange={(w) => setCardWin("time", w)} inherited={!overrides.time} />}>
            <div className="p-3">
              {series.rows.some((r) => r.values.some((v) => v > 0)) ? (
                <StackedBar
                  data={series.rows}
                  keys={series.keys}
                  colors={series.keys.map((k, i) => (book.get(k)?.local ? "var(--color-ok)" : CAT[i % CAT.length]))}
                  height={190}
                  onPick={(label, key) => {
                    const row = series.rows.find((r) => r.label === label) ?? series.rows[series.rows.findIndex((r) => r.label === label)];
                    const day = row?.day;
                    if (!day) return;
                    setDrill({ kind: "calls", title: `${day}${key ? ` · ${key}` : ""}`, rows: timeCalls.filter((c) => c.at.slice(0, 10) === day && (!key || key === "other" ? true : c.model === key)) });
                  }}
                />
              ) : (
                <p className="px-1 py-6 text-center text-[12px] text-faint">No priced model calls in this window.</p>
              )}
            </div>
          </Section>

          <Section id="models" title="Spend by model" caption="Where the tokens went and what each model cost per call. Local providers show $0 per token." folded={folds.models} onToggle={() => toggleFold("models")}
            meta={<WindowPick value={modelWin} onChange={(w) => setCardWin("models", w)} inherited={!overrides.models} />}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[11.5px]">
                <thead>
                  <tr className="border-b border-line text-left text-[10.5px] text-faint">
                    {["Model", "Served", "Calls", "Tokens", "Avg latency", "$/call", "Cost", "Share"].map((h, i) => (
                      <th key={h} className={`px-3 py-2 font-medium whitespace-nowrap ${i >= 2 ? "text-right" : ""}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {byModel.map((m) => (
                    <tr key={m.model} onClick={() => setDrill({ kind: "model", id: m.model })} className="cursor-pointer border-b border-line last:border-0 hover:bg-raise/40">
                      <td className="px-3 py-2 font-mono text-[11px]">{m.model}</td>
                      <td className="px-3 py-2"><Place info={m.info} /></td>
                      <td className="tnum px-3 py-2 text-right">{m.calls}</td>
                      <td className="tnum px-3 py-2 text-right text-dim">{fmtTokens(m.in)} / {fmtTokens(m.out)}</td>
                      <td className="tnum px-3 py-2 text-right">{fmtMs(m.ms / m.calls)}</td>
                      <td className="tnum px-3 py-2 text-right">{fmtCost(m.cost === null ? null : m.cost / m.calls, true)}</td>
                      <td className="tnum px-3 py-2 text-right font-medium">{fmtCost(m.cost)}</td>
                      <td className="px-3 py-2 text-right">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="h-1.5 w-14 overflow-hidden rounded-full bg-raise"><span className={`block h-full ${m.info?.local ? "bg-ok" : "bg-run"}`} style={{ width: `${Math.round(m.share * 100)}%` }} /></span>
                          <span className="tnum w-8 text-right text-[10.5px] text-dim">{pct(m.share)}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                  {!byModel.length && <tr><td colSpan={8} className="px-3 py-5 text-center text-faint">No model calls in this window.</td></tr>}
                </tbody>
              </table>
            </div>
          </Section>
        </div>

        {/* ── Row: by workflow + by step ── */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_1.6fr]">
          <Section id="workflows" title="Spend by workflow" caption="Each workflow's share and its cost per run. Click for its runs." folded={folds.workflows} onToggle={() => toggleFold("workflows")}
            meta={<WindowPick value={wfWin} onChange={(w) => setCardWin("workflows", w)} inherited={!overrides.workflows} />}>
            <div className="p-3">
              {byWorkflow.length ? (
                <RankBar
                  data={byWorkflow.map((w, i) => ({ label: w.name, value: w.cost ?? 0, color: CAT[i % CAT.length], meta: `${fmtCost(w.cost)} · ${w.runs} runs · ${fmtCost(w.perRun, true)}/run` }))}
                  onPick={(label) => {
                    const w = byWorkflow.find((x) => x.name === label);
                    if (w) setDrill({ kind: "runs", title: w.name, subtitle: `${w.runs} runs in the window, ${w.calls} model calls.`, rows: runsIn(wfWin).filter((r) => r.system === w.id) });
                  }}
                />
              ) : (
                <p className="py-6 text-center text-[12px] text-faint">No workflow spend in this window.</p>
              )}
            </div>
          </Section>

          <Section id="steps" title="Spend by step" caption="Every node that made a model call: its call profile, latency and cost. The profile is what decides whether a step can move to a smaller model." folded={folds.steps} onToggle={() => toggleFold("steps")}
            meta={<WindowPick value={stepWin} onChange={(w) => setCardWin("steps", w)} inherited={!overrides.steps} />}>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[11.5px]">
                <thead>
                  <tr className="border-b border-line text-left text-[10.5px] text-faint">
                    {["Workflow › step", "Pattern", "Calls", "Avg in / out", "Avg latency", "Tools", "Model", "Cost", "Share"].map((h, i) => (
                      <th key={h} className={`px-3 py-2 font-medium whitespace-nowrap ${i >= 2 && i !== 6 ? "text-right" : ""}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((p) => (
                    <tr key={`${p.agent}/${p.node}`} onClick={() => setDrill({ kind: "node", agent: p.agent, node: p.node })} className="cursor-pointer border-b border-line last:border-0 hover:bg-raise/40">
                      <td className="px-3 py-2"><span className="text-dim">{agentsById.get(p.agent)?.name ?? p.agent}</span> <span className="text-faint">›</span> <span className="font-mono text-[11px] text-fg">{p.node}</span></td>
                      <td className="px-3 py-2 text-dim">{p.spec?.harness ?? "—"}</td>
                      <td className="tnum px-3 py-2 text-right">{p.calls}</td>
                      <td className="tnum px-3 py-2 text-right text-dim">{fmtTokens(p.avgIn)} / {fmtTokens(p.avgOut)}</td>
                      <td className="tnum px-3 py-2 text-right">{fmtMs(p.avgMs)}</td>
                      <td className="tnum px-3 py-2 text-right text-dim">{pct(p.toolRate)}</td>
                      <td className="px-3 py-2 font-mono text-[10.5px]">{p.models.join(", ")}</td>
                      <td className="tnum px-3 py-2 text-right font-medium">{fmtCost(p.cost)}</td>
                      <td className="tnum px-3 py-2 text-right text-dim">{pct(p.share)}</td>
                    </tr>
                  ))}
                  {!profiles.length && <tr><td colSpan={9} className="px-3 py-5 text-center text-faint">No steps made model calls in this window.</td></tr>}
                </tbody>
              </table>
            </div>
          </Section>
        </div>

        {/* ── Hand-off candidates ── */}
        <Section id="handoff" title="Hand-off candidates" caption="Which steps a smaller or local model could take. Derived from each step's own call profile, its tool grants and the eval evidence on record — a bounded, short-output, read-only step is the natural hand-off; a long-reasoning or destructive step is not." folded={folds.handoff} onToggle={() => toggleFold("handoff")}
          meta={
            <span className="flex items-center gap-2">
              {verdicts.some((v) => v.action === "handoff") && (
                <Button size="sm" variant="solid" permission="configure" onClick={applyAll}>
                  Route all evidence-backed
                </Button>
              )}
            </span>
          }>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11.5px]">
              <thead>
                <tr className="border-b border-line text-left text-[10.5px] text-faint">
                  {["Step", "Verdict", "Now", "Hand off to", "Cost now", "Projected", "Saving", "Why", ""].map((h, i) => (
                    <th key={h} className={`px-3 py-2 font-medium whitespace-nowrap ${i >= 4 && i <= 6 ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {verdicts.map((v) => (
                  <tr key={`${v.p.agent}/${v.p.node}`} className="border-b border-line align-top last:border-0">
                    <td className="px-3 py-2 whitespace-nowrap"><span className="text-dim">{agentsById.get(v.p.agent)?.name ?? v.p.agent}</span> <span className="text-faint">›</span> <span className="font-mono text-[11px]">{v.p.node}</span></td>
                    <td className="px-3 py-2">
                      <Status tone={v.action === "handoff" ? "ok" : v.action === "trial" ? "warn" : "neutral"}>
                        {v.action === "handoff" ? "Hand off" : v.action === "trial" ? "Trial" : "Keep"}
                      </Status>
                    </td>
                    <td className="px-3 py-2 font-mono text-[10.5px]">{v.p.effective || "—"}</td>
                    <td className="px-3 py-2">{v.target && v.action !== "keep" ? <span className="flex items-center gap-1.5 font-mono text-[10.5px]">{v.target.id}<Place info={v.target} /></span> : <span className="text-faint">—</span>}</td>
                    <td className="tnum px-3 py-2 text-right">{fmtCost(v.p.cost)}</td>
                    <td className="tnum px-3 py-2 text-right">{v.action === "keep" ? <span className="text-faint">—</span> : fmtCost(v.projected)}</td>
                    <td className={`tnum px-3 py-2 text-right font-medium ${v.saving && v.saving > 0 ? "text-ok" : ""}`}>{v.action === "keep" || v.saving === null ? <span className="text-faint">—</span> : fmtCost(v.saving)}</td>
                    <td className="max-w-[46ch] px-3 py-2 text-[11px] leading-[1.45] text-dim">{v.reasons.join("; ")}.</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {v.action !== "keep" && v.target && (
                        <Button size="sm" variant="solid" permission="configure" onClick={() => { setRoute(`${v.p.agent}/${v.p.node}`, v.target!.id); document.getElementById("routing")?.scrollIntoView({ behavior: "smooth" }); }}>
                          Route
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {!verdicts.length && <tr><td colSpan={9} className="px-3 py-5 text-center text-faint">No steps to assess in this window.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-3 py-2 text-[10.5px] leading-[1.5] text-faint">
            Projected figures replay this window&rsquo;s journalled tokens at the target&rsquo;s price; on a local provider they price the hardware hour at the provider&rsquo;s rate with a 1.5× latency allowance. Evidence comes from the latest Compare models batch for the workflow, which measures the whole workflow, not one step.
          </p>
        </Section>

        {/* ── Calculator + eval evidence ── */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.4fr_1fr]">
          <Section id="calc" title="Cost calculator" caption="Replay the filtered workload on any model — offered, or one you describe — and compare every offered model on the same work." folded={folds.calc} onToggle={() => toggleFold("calc")}
            meta={<WindowPick value={calcWin} onChange={(w) => setCardWin("calc", w)} inherited={!overrides.calc} />}>
            <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-[280px_1fr]">
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-[11px] text-faint">
                  Target model
                  <Pick
                    value={calcModel}
                    onChange={setCalcModel}
                    options={[{ value: "", label: "choose a model" }, ...(data?.config.models ?? []).map((m) => ({ value: m.id, label: `${m.label}${book.get(m.id)?.local ? " · local" : ""}` })), { value: "custom", label: "Custom (describe it)" }]}
                  />
                </label>
                {calcModel === "custom" && (
                  <div className="flex flex-col gap-2 rounded-md border border-line bg-canvas p-2.5">
                    <label className="flex items-center justify-between gap-2 text-[11px] text-dim">
                      Served locally
                      <input type="checkbox" checked={customLocal} onChange={(e) => setCustomLocal(e.target.checked)} />
                    </label>
                    {customLocal ? (
                      <Num label="Hardware $/hour" value={customHourly} onChange={setCustomHourly} />
                    ) : (
                      <>
                        <Num label="$/M tokens in" value={customIn} onChange={setCustomIn} />
                        <Num label="$/M tokens out" value={customOut} onChange={setCustomOut} />
                      </>
                    )}
                  </div>
                )}
                {(calcTarget?.local || (calcModel === "custom" && customLocal)) && <Num label="Local latency × (vs. recorded)" value={speed} onChange={setSpeed} />}
                <div className="flex flex-col gap-1 rounded-md border border-line bg-canvas p-2.5 text-[11px] text-dim">
                  <span>Workload: <b className="text-fg">{calcCalls.length}</b> calls in <b className="text-fg">{calc.runs}</b> runs</span>
                  <span>{fmtTokens(calcCalls.reduce((s, c) => s + c.in, 0))} in · {fmtTokens(calcCalls.reduce((s, c) => s + c.out, 0))} out · {fmtMs(calc.ms)} of model time</span>
                </div>
              </div>
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-3 gap-3">
                  <Big label="Actual" value={fmtCost(calc.actual)} sub={`${calcWin} as journalled`} />
                  <Big label={calcTarget ? `On ${calcTarget.label}` : "Projected"} value={calcTarget ? fmtCost(calc.projected) : "—"} sub={calcTarget?.local ? (calcTarget.hourly === null ? "hardware hour not priced" : `${fmtCost(calcTarget.hourly)}/h hardware`) : calcTarget ? `$${calcTarget.price_in ?? "?"} in · $${calcTarget.price_out ?? "?"} out /M` : "pick a target"} />
                  <Big
                    label="Difference"
                    value={calc.actual !== null && calc.projected !== null ? `${calc.projected <= calc.actual ? "−" : "+"}${fmtCost(Math.abs(calc.actual - calc.projected))}` : "—"}
                    sub={calc.actual && calc.projected !== null ? `${pct(Math.abs(1 - calc.projected / calc.actual))} ${calc.projected <= calc.actual ? "less" : "more"} · ${fmtCost(((calc.projected - calc.actual) / calc.days) * 30)} / month` : ""}
                    tone={calc.actual !== null && calc.projected !== null ? (calc.projected <= calc.actual ? "ok" : "err") : undefined}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[10.5px] font-medium text-faint">Every offered model on this workload</span>
                  <RankBar
                    data={calc.perModel.map(({ m, cost }, i) => ({ label: m.id, value: cost ?? 0, color: m.local ? "var(--color-ok)" : CAT[i % CAT.length], meta: cost === null ? "price unknown" : `${fmtCost(cost)}${m.local ? ` · local at ${fmtCost(m.hourly)}/h` : ""}` }))}
                    onPick={(label) => setCalcModel(label)}
                  />
                </div>
              </div>
            </div>
          </Section>

          <Section id="evidence" title="Eval evidence" caption="The latest Compare models batch per workflow: quality, cost per case and latency for each candidate. A candidate clears the bar when it scores within 0.02 of the incumbent." folded={folds.evidence} onToggle={() => toggleFold("evidence")}>
            <div className="flex flex-col">
              {[...evidence.entries()].map(([agent, ev]) => (
                <div key={agent} className="flex flex-col border-b border-line last:border-0">
                  <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
                    <span className="text-[12px] font-medium">{agentsById.get(agent)?.name ?? agent}</span>
                    <span className="text-[10.5px] text-faint">{ago(ev.at)} · incumbent {ev.incumbent}</span>
                    <span className="grow" />
                    {ev.best && <Tag tone={ev.best === ev.incumbent ? "neutral" : "ok"}>{ev.best === ev.incumbent ? "keep incumbent" : `cheapest that clears: ${ev.best}`}</Tag>}
                  </div>
                  <table className="w-full border-collapse text-[11.5px]">
                    <tbody>
                      {ev.rows.map((r) => (
                        <tr key={r.id} className="border-t border-line/60">
                          <td className="px-3 py-1.5 font-mono text-[10.5px]">{r.model}{r.model === ev.incumbent && <span className="ml-1 text-[9px] text-faint">INCUMBENT</span>}</td>
                          <td className="tnum px-3 py-1.5 text-right"><span className={r.clears ? "text-ok" : "text-err"}>{r.passed}/{r.total}</span> <span className="text-faint">{pct(r.rate)}</span></td>
                          <td className="tnum px-3 py-1.5 text-right">{fmtCost(r.cost_per_case, true)}<span className="text-faint">/case</span></td>
                          <td className="tnum px-3 py-1.5 text-right text-dim">{fmtMs(r.avg_ms)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
              {!evidence.size && (
                <p className="px-3 py-5 text-center text-[12px] text-faint">
                  No model comparison on record yet. Run <Link href="/evals" className="underline">Compare models</Link> on a workflow&rsquo;s eval set to get evidence here.
                </p>
              )}
            </div>
          </Section>
        </div>

        {/* ── Routing ── */}
        <Section id="routing" title="Model routing" caption="Where each step's calls go. A route set here outranks the step's own model in its spec and the tier defaults; a forced model for a measurement outranks everything. Saved routes apply to the next run of the workflow." folded={folds.routing} onToggle={() => toggleFold("routing")}
          meta={
            <span className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              {saved && <span className={`text-[11px] ${saved.startsWith("could not") ? "text-err" : "text-ok"}`}>{saved}</span>}
              {routesDirty && <Button size="sm" variant="quiet" onClick={() => { setRoutes(data?.config.node_routes ?? {}); setRoutesDirty(false); }}>Discard</Button>}
              <Button size="sm" variant="solid" permission="configure" loading={saving} disabled={!routesDirty} onClick={saveRoutes}>Save routes</Button>
            </span>
          }>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[11.5px]">
              <thead>
                <tr className="border-b border-line text-left text-[10.5px] text-faint">
                  {["Workflow › step", "Pattern", "Spec says", "Effective model", "Served", "Override", `Calls · ${stepWin}`, `Cost · ${stepWin}`].map((h, i) => (
                    <th key={h} className={`px-3 py-2 font-medium whitespace-nowrap ${i >= 6 ? "text-right" : ""}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {routeRows.map((r) => (
                  <tr key={r.key} className={`border-b border-line last:border-0 ${r.route ? "bg-ok/5" : ""}`}>
                    <td className="px-3 py-1.5 whitespace-nowrap"><span className="text-dim">{r.agent.name}</span> <span className="text-faint">›</span> <span className="font-mono text-[11px]">{r.node.id}</span></td>
                    <td className="px-3 py-1.5 text-dim">{r.node.harness}</td>
                    <td className="px-3 py-1.5 text-[10.5px] text-faint">{r.specSays}</td>
                    <td className="px-3 py-1.5 font-mono text-[10.5px]">{r.effective || <span className="text-faint">none</span>}</td>
                    <td className="px-3 py-1.5"><Place info={book.get(r.effective) ?? null} /></td>
                    <td className="px-3 py-1.5"><div className="w-56"><Pick value={r.route} onChange={(v) => setRoute(r.key, v)} options={offeredOptions} aria-label={`Route ${r.key}`} /></div></td>
                    <td className="tnum px-3 py-1.5 text-right text-dim">{r.calls}</td>
                    <td className="tnum px-3 py-1.5 text-right">{fmtCost(r.cost)}</td>
                  </tr>
                ))}
                {!routeRows.length && <tr><td colSpan={8} className="px-3 py-5 text-center text-faint">No workflows in the registry.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line px-3 py-2 text-[10.5px] text-faint">
            <span>Deployment default: <Mono>{data?.config.default_model || "none"}</Mono></span>
            {(["small", "medium", "large"] as const).map((c) => (
              <span key={c}>{c}: <Mono>{data?.config.class_defaults?.[c] || "—"}</Mono></span>
            ))}
            <span className="grow" />
            <Link href="/settings" className="underline">Manage models and providers</Link>
          </div>
        </Section>

        {/* ── Providers + billing ── */}
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.4fr_1fr]">
          <Section id="providers" title="Providers" caption="Every endpoint this deployment can route to, with the models offered from it. Local providers are priced by the hardware hour." folded={folds.providers} onToggle={() => toggleFold("providers")}>
            <div className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
              {(data?.config.providers ?? []).map((p) => {
                const models = (data?.config.models ?? []).filter((m) => (m.provider ?? FOUNDRY_ID) === p.id);
                const spend = sumCost(kpiCalls.filter((c) => models.some((m) => m.id === c.model)).map((c) => c.cost));
                return (
                  <button key={p.id} type="button" onClick={() => setDrill({ kind: "calls", title: p.label, subtitle: `Calls on ${p.label} in the last ${winFor("kpi")}.`, rows: kpiCalls.filter((c) => models.some((m) => m.id === c.model)) })}
                    className="focusable flex flex-col gap-2 rounded-md border border-line bg-canvas p-3 text-left transition-colors hover:bg-raise/40">
                    <span className="flex items-center gap-2">
                      <span className="text-[12.5px] font-medium">{p.label}</span>
                      <Tag tone={p.local ? "ok" : "neutral"}>{p.local ? "local" : "cloud"}</Tag>
                      <span className="grow" />
                      <span className="text-[10.5px] text-faint">{kindOf(p.kind).label}</span>
                    </span>
                    <span className="truncate font-mono text-[10px] text-faint" title={p.endpoint}>{p.endpoint ? hostOf(p.endpoint) : "endpoint from environment"}</span>
                    <span className="flex items-center gap-3 text-[11px] text-dim">
                      <span><b className="text-fg">{models.length}</b> model{models.length === 1 ? "" : "s"}</span>
                      <span><b className="text-fg">{fmtCost(spend)}</b> · {winFor("kpi")}</span>
                      {p.local && <span>{p.hourly_usd !== undefined ? `${fmtCost(p.hourly_usd)}/h` : "hour not priced"}</span>}
                    </span>
                    <span className="flex flex-wrap gap-1">
                      {models.slice(0, 6).map((m) => <span key={m.id} className="rounded-sm border border-line px-1 py-px font-mono text-[9.5px] text-dim">{m.id}</span>)}
                      {models.length > 6 && <span className="text-[9.5px] text-faint">+{models.length - 6}</span>}
                    </span>
                  </button>
                );
              })}
              <Link href="/settings" className="focusable flex min-h-[96px] flex-col items-center justify-center gap-1 rounded-md border border-dashed border-line-strong p-3 text-[11.5px] text-dim hover:bg-raise/40">
                <span className="text-[18px] leading-none">+</span>
                Add a provider in Settings
                <span className="text-[10px] text-faint">Foundry, Vertex, Bedrock, vLLM, Ollama, LM Studio…</span>
              </Link>
            </div>
          </Section>

          <Section id="billing" title="Billing and budget" caption="Journalled spend against what the cloud actually billed, and the monthly budget the run rate is measured against." folded={folds.billing} onToggle={() => toggleFold("billing")}>
            <Billing key={`${data?.budget ?? ""}/${data?.period ?? ""}`} data={data} totals={totals} windowBudget={windowBudget} window={winFor("kpi")} onSaved={load} />
          </Section>
        </div>
      </div>

      {drill && (
        <DrillView drill={drill} data={data} book={book} profiles={profiles} evidence={evidence} verdicts={verdicts} routes={routes} onRoute={setRoute} onClose={() => setDrill(null)} onDrill={setDrill} agentsById={agentsById} />
      )}
    </div>
  );
}

/* ═══════════════════ pieces ═══════════════════ */

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function Section({ id, title, caption, meta, children, folded = false, onToggle }: { id: string; title: string; caption: string; meta?: React.ReactNode; children: React.ReactNode; folded?: boolean; onToggle?: () => void }) {
  return (
    <section id={id} className="flex scroll-mt-4 flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
      <div data-hue={hueFor(title)} className={`flex w-full items-start gap-3 bg-raise/55 px-4 py-2.5 text-left ${folded ? "" : "border-b border-line"}`}>
        <button type="button" onClick={onToggle} aria-expanded={!folded} aria-controls={`${id}-body`} className="focusable flex min-w-0 grow items-start gap-3 text-left">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`mt-0.5 shrink-0 text-faint transition-transform ${folded ? "-rotate-90" : ""}`}>
            <path d="M6 9l6 6 6-6" />
          </svg>
          <span className="flex min-w-0 grow flex-col gap-0.5">
            <span className="flex items-center gap-2 text-[12.5px] font-semibold tracking-[-0.005em]">{title}</span>
            {!folded && <span className="max-w-[110ch] text-[11px] leading-[1.55] text-faint">{caption}</span>}
          </span>
        </button>
        <span className="flex shrink-0 items-center gap-2 pt-0.5">{meta}<span className="text-[10.5px] text-ghost">{folded ? "show" : ""}</span></span>
      </div>
      <div id={`${id}-body`} hidden={folded}>
        {children}
      </div>
    </section>
  );
}

function Kpi({ label, value, sub, tone, onOpen }: { label: string; value: string; sub: string; tone?: "ok" | "warn" | "err"; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="focusable -mr-px -mb-px flex cursor-pointer flex-col gap-1 border-r border-b border-line px-3 py-2.5 text-left transition-colors hover:bg-raise/50">
      <span className="truncate text-[10.5px] text-faint">{label}</span>
      <span className="tnum text-[22px] leading-none font-semibold tracking-[-0.02em]" style={tone ? { color: `var(--color-${tone})` } : undefined}>{value}</span>
      <span className="truncate text-[10px] text-ghost">{sub}</span>
    </button>
  );
}

function Big({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "ok" | "err" }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-line bg-canvas p-3">
      <span className="text-[10.5px] text-faint">{label}</span>
      <span className="tnum text-[20px] leading-none font-semibold tracking-[-0.02em]" style={tone ? { color: `var(--color-${tone})` } : undefined}>{value}</span>
      <span className="truncate text-[10px] text-ghost">{sub}</span>
    </div>
  );
}

function Num({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 text-[11px] text-dim">
      {label}
      <input type="number" min={0} step="0.01" value={value} onChange={(e) => onChange(e.target.value)} className="focusable h-7 w-20 rounded-md border border-line-strong bg-field px-1.5 font-mono text-[11px] text-fg" />
    </label>
  );
}

function Place({ info }: { info: ModelInfo | null }) {
  if (!info) return <span className="text-[10.5px] text-faint">—</span>;
  return <Tag tone={info.local ? "ok" : "neutral"}>{info.local ? "local" : info.provider?.label ?? "cloud"}</Tag>;
}

function Billing({ data, totals, windowBudget, window, onSaved }: { data: Data | null; totals: { cost: number | null; monthly: number | null }; windowBudget: number | null; window: Win; onSaved: () => void }) {
  const [budget, setBudget] = useState(data?.budget ? String(data.budget) : "");
  const [period, setPeriod] = useState<Period>(data?.period ?? "month");
  const [busy, setBusy] = useState(false);
  const az = data?.azure;
  const st = data?.budgetState;
  const save = async () => {
    setBusy(true);
    try {
      await fetch("/api/finops", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ budget_usd: budget === "" ? null : Number(budget), period }) });
      onSaved();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col">
      <Fact k={`Journalled · ${window}`} v={fmtCost(totals.cost)} />
      {windowBudget !== null && <Fact k={`Budget scaled to ${window}`} v={`${fmtCost(windowBudget)} · ${totals.cost !== null ? pct(totals.cost / Math.max(0.01, windowBudget)) : "—"} used`} tone={totals.cost !== null && totals.cost > windowBudget ? "text-err" : undefined} />}
      {st && data?.budget != null && (
        <Fact k={`This ${data.period} so far`} v={st.exceeded ? `${fmtCost(st.spent)} of ${fmtCost(data.budget)} · exhausted, runs refused` : `${fmtCost(st.spent)} of ${fmtCost(data.budget)} · ${fmtCost(Math.max(0, st.remaining ?? 0))} left`} tone={st.exceeded ? "text-err" : undefined} />
      )}
      <Fact k="Run rate · month" v={fmtCost(totals.monthly)} />
      <Fact k="Cloud billed · month to date" v={az?.configured && !az.error ? `${az.currency ?? ""} ${az.mtd?.toFixed(2) ?? "—"}` : "billing connector not configured"} tone={az?.configured ? undefined : "text-faint"} />
      <Fact k="Cloud billed · 7d" v={az?.configured && !az.error ? `${az.currency ?? ""} ${az.last7d?.toFixed(2) ?? "—"}` : "—"} />
      <div className="flex items-center gap-2 px-4 py-3">
        <label className="flex items-center gap-2 text-[11.5px] text-dim">
          Budget $
          <input type="number" min={0} step="1" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="none" className="focusable h-7 w-24 rounded-md border border-line-strong bg-field px-1.5 font-mono text-[11px] text-fg" />
        </label>
        <span className="text-[11px] text-faint">per</span>
        <div className="w-24">
          <Pick value={period} onChange={setPeriod} options={[{ value: "day", label: "day" }, { value: "week", label: "week" }, { value: "month", label: "month" }]} aria-label="Budget period" />
        </div>
        <span className="text-[10.5px] text-ghost">Runs are refused once the rolling period&rsquo;s spend reaches it.</span>
        <Button size="sm" variant="solid" permission="configure" loading={busy} onClick={save}>Set budget</Button>
      </div>
    </div>
  );
}

function Fact({ k, v, tone }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2 text-[11.5px] last:border-0">
      <span className="text-faint">{k}</span>
      <span className={`tnum text-right font-medium ${tone ?? "text-fg"}`}>{v}</span>
    </div>
  );
}

/* ═══════════════════ drill-downs ═══════════════════ */

function DrillView({ drill, data, book, profiles, evidence, verdicts, routes, onRoute, onClose, onDrill, agentsById }: {
  drill: Drill; data: Data | null; book: Map<string, ModelInfo>;
  profiles: { agent: string; node: string; spec: NodeSpec | undefined; calls: number; runs: number; avgIn: number; avgOut: number; avgMs: number; toolRate: number; cost: number | null; share: number; models: string[]; effective: string; rows: Call[] }[];
  evidence: Map<string, { batch: string; at: string; incumbent: string; rows: (Eval & { rate: number; clears: boolean })[]; best: string | null }>;
  verdicts: { p: { agent: string; node: string }; action: string; target: ModelInfo | null; reasons: string[]; saving: number | null; projected: number | null }[];
  routes: Record<string, string>; onRoute: (key: string, model: string) => void; onClose: () => void; onDrill: (d: Drill) => void; agentsById: Map<string, AgentSpec>;
}) {
  const callCols = [
    { label: "When", cell: (c: Call) => <span className="whitespace-nowrap text-dim">{ago(c.at)}</span> },
    { label: "Run", cell: (c: Call) => <Link href={`/runs?run=${encodeURIComponent(c.run)}`} className="font-mono text-[10.5px] underline decoration-line-strong" onClick={(e) => e.stopPropagation()}>{c.run.slice(0, 28)}</Link> },
    { label: "Step", cell: (c: Call) => <span><span className="text-dim">{agentsById.get(c.system)?.name ?? c.system}</span> › <span className="font-mono text-[10.5px]">{c.node}</span></span> },
    { label: "Model", cell: (c: Call) => <span className="flex items-center gap-1.5 font-mono text-[10.5px]">{c.model}<Place info={book.get(c.model) ?? null} /></span> },
    { label: "In / out", cell: (c: Call) => `${fmtTokens(c.in)} / ${fmtTokens(c.out)}`, right: true },
    { label: "Latency", cell: (c: Call) => fmtMs(c.ms), right: true },
    { label: "Tools", cell: (c: Call) => (c.tools ? String(c.tools) : "—"), right: true },
    { label: "Cost", cell: (c: Call) => fmtCost(c.cost, true), right: true },
  ];
  const runCols = [
    { label: "When", cell: (r: Run) => <span className="whitespace-nowrap text-dim">{ago(r.at)}</span> },
    { label: "Run", cell: (r: Run) => <Link href={`/runs?run=${encodeURIComponent(r.id)}`} className="font-mono text-[10.5px] underline decoration-line-strong" onClick={(e) => e.stopPropagation()}>{r.id.slice(0, 32)}</Link> },
    { label: "Workflow", cell: (r: Run) => agentsById.get(r.system)?.name ?? r.system },
    { label: "State", cell: (r: Run) => <Status tone={r.state === "done" ? "ok" : r.state === "failed" || r.state === "killed" ? "err" : r.state === "suspended" ? "warn" : "neutral"}>{r.state}</Status> },
    { label: "Calls", cell: (r: Run) => String(r.modelCalls), right: true },
    { label: "Tokens", cell: (r: Run) => fmtTokens(r.tokens.in + r.tokens.out), right: true },
    { label: "Time", cell: (r: Run) => fmtMs(r.ms), right: true },
    { label: "Cost", cell: (r: Run) => fmtCost(r.cost, true), right: true },
  ];

  if (drill.kind === "calls") {
    return (
      <DrillModal title={drill.title} subtitle={drill.subtitle} count={drill.rows.length} onClose={onClose}>
        <DrillTable columns={callCols} rows={drill.rows.slice(0, 500)} keyOf={(c) => `${c.run}/${c.node}/${c.at}/${c.in}/${c.out}`} empty="No model calls match." />
      </DrillModal>
    );
  }
  if (drill.kind === "runs") {
    return (
      <DrillModal title={drill.title} subtitle={drill.subtitle} count={drill.rows.length} onClose={onClose}>
        <DrillTable columns={runCols} rows={drill.rows.slice(0, 500)} keyOf={(r) => r.id} empty="No runs match." />
      </DrillModal>
    );
  }
  if (drill.kind === "model") {
    const info = book.get(drill.id) ?? null;
    const rows = profiles.flatMap((p) => p.rows.filter((c) => c.model === drill.id));
    const steps = profiles.filter((p) => p.rows.some((c) => c.model === drill.id));
    return (
      <DrillModal title={drill.id} subtitle={info ? `${info.label} · ${info.local ? `local on ${info.provider?.label ?? "local hardware"}` : info.provider?.label ?? "Azure AI Foundry"}${info.tier ? ` · ${info.tier} tier` : ""}` : "not in the offered list — costed as unknown"} count={rows.length} onClose={onClose}>
        <div className="grid grid-cols-2 gap-x-6 border-b border-line px-4 py-2 sm:grid-cols-4">
          <Fact k="$/M in" v={info?.price_in === null || !info ? "unknown" : `$${info.price_in}`} />
          <Fact k="$/M out" v={info?.price_out === null || !info ? "unknown" : `$${info.price_out}`} />
          <Fact k="Cost in window" v={fmtCost(sumCost(rows.map((c) => c.cost)))} />
          <Fact k="Steps using it" v={String(steps.length)} />
        </div>
        <p className="px-4 pt-3 pb-1 text-[11px] font-semibold text-dim">Steps</p>
        <div className="flex flex-wrap gap-1.5 px-4 pb-3">
          {steps.map((p) => (
            <button key={`${p.agent}/${p.node}`} type="button" onClick={() => onDrill({ kind: "node", agent: p.agent, node: p.node })} className="focusable rounded-sm border border-line px-2 py-1 font-mono text-[10.5px] hover:bg-raise/50">
              {agentsById.get(p.agent)?.name ?? p.agent} › {p.node}
            </button>
          ))}
        </div>
        <DrillTable columns={callCols} rows={rows.slice(0, 500)} keyOf={(c) => `${c.run}/${c.node}/${c.at}/${c.in}`} />
      </DrillModal>
    );
  }
  // node
  const p = profiles.find((x) => x.agent === drill.agent && x.node === drill.node);
  const v = verdicts.find((x) => x.p.agent === drill.agent && x.p.node === drill.node);
  const spec = p?.spec ?? agentsById.get(drill.agent)?.nodes.find((n) => n.id === drill.node);
  const key = `${drill.agent}/${drill.node}`;
  const ev = evidence.get(drill.agent);
  return (
    <DrillModal
      title={`${agentsById.get(drill.agent)?.name ?? drill.agent} › ${drill.node}`}
      subtitle={spec?.purpose || `A ${spec?.harness ?? "sequence"} step.`}
      count={p?.calls}
      onClose={onClose}
      actions={
        data && (
          <span className="flex items-center gap-2">
            <span className="text-[10.5px] text-faint">Route to</span>
            <div className="w-52">
              <Pick value={routes[key] ?? ""} onChange={(m) => onRoute(key, m)} options={[{ value: "", label: "no override" }, ...data.config.models.map((m) => ({ value: m.id, label: `${m.label}${book.get(m.id)?.local ? " · local" : ""}` }))]} aria-label="Route this step" />
            </div>
          </span>
        )
      }
    >
      <div className="grid grid-cols-2 gap-x-6 border-b border-line px-4 py-2 sm:grid-cols-4">
        <Fact k="Pattern" v={spec?.harness ?? "—"} />
        <Fact k="Effective model" v={p?.effective || "—"} />
        <Fact k="Tool grants" v={spec ? `${spec.tools} · ${spec.risk}${spec.sinks ? ` · ${spec.sinks} sink${spec.sinks === 1 ? "" : "s"}` : ""}` : "—"} />
        <Fact k="Typed contract" v={spec?.structured ? "yes" : "no"} />
        <Fact k="Calls · runs" v={p ? `${p.calls} · ${p.runs}` : "0"} />
        <Fact k="Avg tokens in / out" v={p ? `${fmtTokens(p.avgIn)} / ${fmtTokens(p.avgOut)}` : "—"} />
        <Fact k="Avg latency" v={fmtMs(p?.avgMs ?? null)} />
        <Fact k="Cost in window" v={fmtCost(p?.cost ?? null)} />
      </div>
      {v && (
        <div className="flex flex-col gap-1 border-b border-line px-4 py-3">
          <span className="flex items-center gap-2 text-[11px] font-semibold text-dim">
            Assessment
            <Status tone={v.action === "handoff" ? "ok" : v.action === "trial" ? "warn" : "neutral"}>{v.action === "handoff" ? `Hand off to ${v.target?.id}` : v.action === "trial" ? `Trial on ${v.target?.id}` : "Keep"}</Status>
            {v.saving !== null && v.action !== "keep" && <span className="tnum text-[11px] text-ok">saves {fmtCost(v.saving)} in window</span>}
          </span>
          <ul className="list-disc pl-5 text-[11.5px] leading-[1.5] text-dim">
            {v.reasons.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
      )}
      {ev && (
        <div className="flex flex-col border-b border-line px-4 py-3">
          <span className="text-[11px] font-semibold text-dim">Eval evidence for this workflow ({ago(ev.at)})</span>
          <span className="text-[11px] text-faint">{ev.rows.map((r) => `${r.model} ${r.passed}/${r.total} at ${fmtCost(r.cost_per_case, true)}/case`).join(" · ")}</span>
        </div>
      )}
      <DrillTable columns={callCols} rows={(p?.rows ?? []).slice(0, 500)} keyOf={(c) => `${c.run}/${c.at}/${c.in}/${c.out}`} empty="No calls in the window." />
    </DrillModal>
  );
}
