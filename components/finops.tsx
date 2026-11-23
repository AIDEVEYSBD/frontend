"use client";
import { errorText } from "@/lib/api/client";
import { Failure } from "./pending";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Mono, Status } from "./ui";
import { CAT } from "./charts";
import { usePageFacts } from "./assistant";
import { DrillModal, DrillTable } from "./drill";
import { Pick } from "./select";
import { hueFor } from "@/lib/hue";
import { WindowPick, type Win } from "./window-pick";

/**
 * Costs: what model calls cost, from the cost recorded with every call.
 *
 * Every figure is the service's (`GET /api/finops?window=`, agentfactory/
 * budgets/): the recorded model calls of runs, of the model gateway and of
 * the service on its own account (`source` "service"), cut
 * by model, agent, step, application, person and team over the page window,
 * as a series, and checked run by run against the runs' own costs. A call
 * on a model with no price set has a cost of null; it is counted apart as
 * "no price set" and never added as $0. The records themselves (`calls`,
 * `runs`) are only listed here, behind a figure, never summed again.
 *
 * Cost planning (`GET /api/finops/planning`) prices each step's recorded
 * tokens on every other offered, priced model; whether a smaller model could
 * do a step's work is not built, and the page says so in the service's words.
 * Budgets are the deployment's per rolling period (`POST /api/finops`) and
 * each use case's (`PUT/DELETE /api/budgets/use-cases/{workload}`). Step
 * routes are model settings (`POST /api/config`).
 */

/* ═══════════════════ shapes (mirror /api/finops) ═══════════════════ */

type Period = "day" | "week" | "month";
type Rec = Record<string, unknown>;

interface Offered { id: string; label: string; class?: string; price_in: number | null; price_out: number | null; provider?: string; cleared_for?: string[]; fallbacks?: string[] }
interface Config { models: Offered[]; default_model: string; class_defaults: Partial<Record<"small" | "medium" | "large", string>>; node_routes: Record<string, string> }
/** The model a step's calls go to now, the endpoint and the rule; or why none could be chosen. */
interface Effective { model?: string; endpoint?: string; rule?: string; error?: string }
interface NodeSpec { id: string; harness: string; model: string; model_class: string; purpose: string; effective: Effective | null }
interface AgentSpec { id: string; name: string; deployed: boolean; nodes: NodeSpec[] }
interface RunOwner { sub: string; name: string; email?: string; team?: string }
interface Run { id: string; system: string; state: string; at: string; ms: number; cost: number | null; tokens: { in: number; out: number }; modelCalls: number; use_case: string; owner: RunOwner | null }
/**
 * One recorded call: a run's journal entry (`source: run`), a gateway
 * completion (`source: gateway`, no run or step), or a call the service made
 * on its own account (`source: service`: the Ask assistant, a knowledge
 * answer, a re-ranking search, an evaluation's judge; `purpose` says which,
 * and `run` names the run it was made for, when it was).
 */
interface Call { source: "run" | "gateway" | "service"; ref: string; run: string; system: string; application: string; at: string; node: string; model: string; in: number; out: number; ms: number; cost: number | null; unpriced: boolean; purpose?: string }
/** What a group of calls cost (budgets/spend.py `figures`): `cost_usd` null when it has calls and none was priced. */
interface Figures { calls: number; tokens_in: number; tokens_out: number; cost_usd: number | null; priced_calls: number; unpriced_calls: number; unpriced_models: string[]; runs: number }
interface Point { at: string; calls: number; cost_usd: number | null; unpriced_calls: number }
interface Reconciled { runs: number; agree: number; cost_unknown: number; differ: { run: string; recorded_usd: number | null; calls_usd: number | null; unpriced_calls: number }[] }
interface NotIncluded { what: string; why: string }
interface Spend {
  window: Win;
  since: string | null;
  until: string;
  totals: Figures;
  by_source: (Figures & { source: "run" | "gateway" | "service" })[];
  by_model: (Figures & { model: string; label: string; offered: boolean })[];
  by_agent: (Figures & { agent: string })[];
  by_step: (Figures & { agent: string; node: string })[];
  by_application: (Figures & { application: string })[];
  by_person: (Figures & { sub: string; name: string; email: string })[];
  by_team: (Figures & { team: string; label: string })[];
  series: { bucket: "hour" | "day"; points: Point[] };
  runs: Reconciled;
}
/** The deployment's budget now. `spent` is null when calls were made and none was priced; `remaining`, `exceeded` and `used` are null when unpriced calls leave them unknown, and `unknown_why` says why. */
interface BudgetState { budget_usd: number; period: Period; since: string; spent: number | null; unpriced: number; remaining: number | null; exceeded: boolean | null; used: number | null; unknown_why?: string | null }
/** A period budget. `spent_usd` is null when calls were made and none was priced; `remaining_usd` and `exceeded` are null when unpriced calls leave them unknown, and `unknown_why` says why. */
interface BudgetRow { scope: "deployment" | "use_case"; key: string; amount_usd: number; period: Period; spent_usd: number | null; remaining_usd: number | null; exceeded?: boolean | null; since: string; unpriced_calls: number; unknown_why?: string | null; set_by: { name?: string; email?: string; sub?: string } | null; set_at: string }
interface Data { now: string; config: Config; agents: AgentSpec[]; agentsBasis: string; runs: Run[]; calls: Call[]; budgetState: BudgetState | null; budgets: BudgetRow[]; spend: Spend; costBasis: string; not_built: string[]; not_included: NotIncluded[] }
interface PlanStep extends Figures { agent: string; node: string; models: string[]; elsewhere: { model: string; label: string; cost_usd: number; difference_usd: number | null; cleared?: boolean | null; why?: string }[] }
interface Planning { steps: PlanStep[]; unpriced_models: string[]; could_take_it: { built: boolean; why: string }; basis: string }
interface UseCase { name: string; workload: string }

/* ═══════════════════ formatting ═══════════════════ */

const fmtUsd = (c: number) => (c === 0 ? "$0.00" : Math.abs(c) < 0.01 ? `$${c.toFixed(6).replace(/0+$/, "")}` : Math.abs(c) < 100 ? `$${c.toFixed(2)}` : `$${Math.round(c).toLocaleString("en-GB")}`);
/** A group's cost: its priced sum, or "no price set" when it has calls and none was priced. */
const groupCost = (f: Pick<Figures, "cost_usd" | "calls">) => (f.cost_usd === null ? (f.calls ? "no price set" : "$0.00") : fmtUsd(f.cost_usd));
const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(Math.round(n)));
const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60_000).toFixed(1)}m`);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "");
const ago = (iso: string, now: number) => {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
};
const unpricedNote = (f: Figures) => (f.unpriced_calls ? `${plural(f.unpriced_calls, "call")} with no price set` : "");

/** Whether a set of groups adds up to the window's totals: calls, unpriced calls and priced spend (to the millionth of a dollar per call). */
function addsUp(rows: Figures[], totals: Figures): { ok: boolean; cost: number; calls: number; unpriced: number } {
  const cost = rows.reduce((s, r) => s + (r.cost_usd ?? 0), 0);
  const calls = rows.reduce((s, r) => s + r.calls, 0);
  const unpriced = rows.reduce((s, r) => s + r.unpriced_calls, 0);
  const ok = calls === totals.calls && unpriced === totals.unpriced_calls && Math.abs(cost - (totals.cost_usd ?? 0)) <= 1e-6 * Math.max(1, totals.calls);
  return { ok, cost, calls, unpriced };
}

async function read<T>(path: string): Promise<T> {
  const r = await fetch(path);
  const d = (await r.json().catch(() => null)) as T | null;
  // A refusal, a 501, an empty body or a page (a proxy's 502) is a failed read, never an answer to draw.
  if (!r.ok || !d || (d as Rec).error) throw new Error(errorText(d, r, "GET", path));
  return d;
}

/** A write's answer: the body on success, else the service's own reason. */
async function write(method: "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<Rec> {
  const r = await fetch(path, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const d = (await r.json().catch(() => null)) as Rec | null;
  if (!r.ok || !d) throw new Error(errorText(d, r, method, path));
  return d;
}

/* ═══════════════════ the page ═══════════════════ */

type Drill = { kind: "calls"; title: string; subtitle?: string; rows: Call[] } | { kind: "runs"; title: string; subtitle?: string; rows: Run[] };

export function FinOps() {
  const [win, setWin] = useState<Win>("30d");
  const [data, setData] = useState<{ win: Win; d: Data } | null>(null);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<{ win: Win; p: Planning } | null>(null);
  const [planError, setPlanError] = useState("");
  const [drill, setDrill] = useState<Drill | null>(null);
  const [folds, setFolds] = useState<Record<string, boolean>>({});

  const load = useCallback((w: Win) => {
    read<Data>(`/api/finops?window=${w}`)
      .then((d) => {
        if (!d.spend || !d.config) throw new Error("the answer of GET /api/finops carries no spend or model settings");
        setData({ win: w, d });
        setError("");
      })
      .catch((e: Error) => setError(e.message));
    read<Planning>(`/api/finops/planning?window=${w}`)
      .then((p) => {
        setPlan({ win: w, p });
        setPlanError("");
      })
      .catch((e: Error) => setPlanError(e.message));
  }, []);
  useEffect(() => load(win), [load, win]);

  const d = data?.d ?? null;
  const current = data?.win === win;
  const s = d?.spend ?? null;
  const now = d ? new Date(d.now).getTime() : 0;
  const since = s?.since ? new Date(s.since).getTime() : 0;
  /** The records in the window the figures were cut over: for the lists behind a figure. */
  const callsIn = useMemo(() => (d ? d.calls.filter((c) => new Date(c.at).getTime() >= since) : []), [d, since]);
  const runsIn = useMemo(() => (d ? d.runs.filter((r) => new Date(r.at).getTime() >= since) : []), [d, since]);
  const agentsById = useMemo(() => new Map((d?.agents ?? []).map((a) => [a.id, a])), [d]);
  const name = (agent: string) => agentsById.get(agent)?.name ?? agent;
  const toggleFold = (id: string) => setFolds((f) => ({ ...f, [id]: !f[id] }));

  usePageFacts(
    s && d
      ? {
          window: s.window,
          spendUSD: s.totals.cost_usd,
          modelCalls: s.totals.calls,
          callsWithNoPriceSet: s.totals.unpriced_calls,
          runsChecked: s.runs,
          deploymentBudget: d.budgetState,
          notBuilt: d.not_built,
        }
      : null,
  );

  const gatewayCalls = s?.by_source.find((x) => x.source === "gateway")?.calls ?? 0;
  const runCalls = s?.by_source.find((x) => x.source === "run")?.calls ?? 0;
  const serviceCalls = s?.by_source.find((x) => x.source === "service")?.calls ?? 0;

  return (
    <div className="min-h-full" data-hue="green">
      <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-5 px-5 py-7">
        <header className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">Costs</h1>
            <p className="max-w-[80ch] text-[12.5px] leading-[1.55] text-dim">
              What model calls cost, from the cost recorded with each call: by model, agent, step, application, person and team, for runs, for calls through the model gateway and for the service&rsquo;s own calls (the Ask assistant, knowledge answers, re-ranking, evaluation judges). A call on a model with no price set has no cost: it is counted apart, never as $0. Budgets per period, what the same work would cost on another model, and where each step&rsquo;s calls go.
            </p>
          </div>
          <span className="grow" />
          <div className="flex flex-col items-end gap-1">
            <span className="text-[10.5px] text-faint">{d && !current ? "Reading this window…" : "Window"}</span>
            <WindowPick value={win} onChange={setWin} />
          </div>
        </header>

        {error && <Failure what="The costs could not be read" message={error} />}
        {d && d.not_included.length > 0 && (
          <div className="rounded-md border border-warn/40 bg-surface px-4 py-2.5 text-[12px] leading-[1.55] text-warn">
            {d.not_included.map((n) => (
              <p key={n.what}>
                <span className="font-medium">Not in any figure: {n.what}.</span> {n.why}.
              </p>
            ))}
          </div>
        )}

        {d && s && (
          <>
            {/* ── KPI band ── */}
            <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
              <div data-hue="green" className="flex min-h-9 flex-wrap items-center gap-2 border-b border-line bg-raise/55 px-3 py-1.5">
                <span className="text-[12px] font-semibold">Spend · {s.window}</span>
                <span className="text-[11px] text-faint">{d.costBasis}</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
                <Kpi label="Spend" value={groupCost(s.totals)} sub={`${plural(s.totals.priced_calls, "priced call")}${s.since ? ` since ${when(s.since)}` : ""}`} tone={s.totals.cost_usd === null ? undefined : "ok"}
                  onOpen={() => setDrill({ kind: "calls", title: `Model calls · ${s.window}`, subtitle: "Every recorded call in the window, newest first, with the cost recorded with it.", rows: [...callsIn].reverse() })} />
                <Kpi label="No price set" value={s.totals.unpriced_calls.toLocaleString("en-GB")} sub={s.totals.unpriced_calls ? `calls on ${s.totals.unpriced_models.join(", ")}, in no sum` : "every call was priced"} tone={s.totals.unpriced_calls ? "warn" : undefined}
                  onOpen={() => setDrill({ kind: "calls", title: "Calls with no price set", subtitle: "Their model had no price set when they were made, so they have no cost. Setting a price later does not price them.", rows: callsIn.filter((c) => c.unpriced).reverse() })} />
                <Kpi label="Model calls" value={s.totals.calls.toLocaleString("en-GB")} sub={`${plural(runCalls, "run call")} · ${plural(gatewayCalls, "gateway call")} · ${plural(serviceCalls, "service call")}`}
                  onOpen={() => setDrill({ kind: "calls", title: `Model calls · ${s.window}`, rows: [...callsIn].reverse() })} />
                <Kpi label="Tokens" value={fmtTokens(s.totals.tokens_in + s.totals.tokens_out)} sub={`${fmtTokens(s.totals.tokens_in)} in · ${fmtTokens(s.totals.tokens_out)} out`}
                  onOpen={() => setDrill({ kind: "calls", title: "Calls by tokens", rows: [...callsIn].sort((a, b) => b.in + b.out - (a.in + a.out)) })} />
                <Kpi label="Runs checked" value={`${s.runs.agree} of ${s.runs.runs}`} sub={s.runs.differ.length ? `${plural(s.runs.differ.length, "run")} whose calls do not add up` : "each run's calls add up to its cost"} tone={s.runs.differ.length ? "err" : undefined}
                  onOpen={() => document.getElementById("check")?.scrollIntoView({ behavior: "smooth" })} />
                <Kpi
                  label={d.budgetState ? `Budget · last ${d.budgetState.period}` : "Budget"}
                  value={d.budgetState ? (d.budgetState.used === null ? "unknown" : `${Math.round(d.budgetState.used * 100)}%`) : "not set"}
                  sub={
                    d.budgetState
                      ? d.budgetState.exceeded === true
                        ? "spent: new runs refused, running ones pause"
                        : d.budgetState.exceeded === null
                          ? d.budgetState.unknown_why || "what was spent is not known"
                          : `${d.budgetState.spent === null ? "unknown" : fmtUsd(d.budgetState.spent)} of ${fmtUsd(d.budgetState.budget_usd)}`
                      : "for the deployment, set below"
                  }
                  tone={d.budgetState?.exceeded === true ? "err" : d.budgetState && (d.budgetState.exceeded === null || (d.budgetState.used ?? 0) > 0.8) ? "warn" : undefined}
                  onOpen={() => document.getElementById("budgets")?.scrollIntoView({ behavior: "smooth" })}
                />
              </div>
            </section>

            {/* ── over time + by model ── */}
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_1fr]">
              <Section id="time" title="Spend over time" caption={`Priced spend ${s.series.bucket === "hour" ? "each hour" : "each day"}. A call with no price set is in no bar; the buckets that hold one are named below. Click a bar for its calls.`} folded={folds.time} onToggle={() => toggleFold("time")}>
                <Series spend={s} calls={callsIn} onDrill={setDrill} />
              </Section>

              <Section id="models" title="Spend by model" caption="Every call by the model that answered it, with the price set for it now. A model no longer offered keeps its recorded costs." folded={folds.models} onToggle={() => toggleFold("models")}>
                <div className="af-list overflow-x-auto">
                  <table className="w-full border-collapse text-[11.5px]">
                    <thead>
                      <tr className="border-b border-line text-left text-[10.5px] text-faint">
                        {["Model", "Price now ($/M in · out)", "Calls", "Tokens", "No price set", "Cost"].map((h, i) => (
                          <th key={h} className={`px-3 py-2 font-medium whitespace-nowrap ${i >= 2 ? "text-right" : ""}`}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {s.by_model.map((m) => {
                        const o = d.config.models.find((x) => x.id === m.model);
                        return (
                          <tr key={m.model} onClick={() => setDrill({ kind: "calls", title: m.model, subtitle: `Calls answered by ${m.model} in the window.`, rows: callsIn.filter((c) => c.model === m.model).reverse() })} className="cursor-pointer border-b border-line last:border-0 hover:bg-raise/40">
                            <td className="px-3 py-2 font-mono text-[11px]">{m.model}</td>
                            <td className="px-3 py-2 text-dim">{!m.offered ? "not offered now" : o && o.price_in !== null && o.price_out !== null ? `$${o.price_in} · $${o.price_out}` : <span className="text-warn">no price set</span>}</td>
                            <td className="tnum px-3 py-2 text-right">{m.calls}</td>
                            <td className="tnum px-3 py-2 text-right text-dim">{fmtTokens(m.tokens_in)} / {fmtTokens(m.tokens_out)}</td>
                            <td className={`tnum px-3 py-2 text-right ${m.unpriced_calls ? "text-warn" : "text-ghost"}`}>{m.unpriced_calls}</td>
                            <td className="tnum px-3 py-2 text-right font-medium">{groupCost(m)}</td>
                          </tr>
                        );
                      })}
                      {!s.by_model.length && <tr><td colSpan={6} className="px-3 py-5 text-center text-faint">No model call was recorded in this window.</td></tr>}
                    </tbody>
                  </table>
                </div>
                <AddsUp rows={s.by_model} totals={s.totals} />
              </Section>
            </div>

            {/* ── by person + by team ── */}
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <Section id="people" title="Spend by person" caption="A run's calls count for the person who started it; a gateway call for the person who chatted from the console, else for the application's owner. Click for the runs they started." folded={folds.people} onToggle={() => toggleFold("people")}>
                <Groups
                  rows={s.by_person.map((p) => ({ key: p.sub, label: p.name, f: p }))}
                  totals={s.totals}
                  empty="No model call was recorded in this window."
                  onPick={(key, label) => setDrill({ kind: "runs", title: label, subtitle: "Runs this person started in the window. Calls they made through the gateway are counted in the row, and listed on each application's page.", rows: runsIn.filter((r) => (key ? r.owner?.sub === key : !r.owner)) })}
                />
              </Section>
              <Section id="teams" title="Spend by team" caption="The same calls by the team the run or the application records. Click for the team's runs." folded={folds.teams} onToggle={() => toggleFold("teams")}>
                <Groups
                  rows={s.by_team.map((t) => ({ key: t.team, label: t.label, f: t }))}
                  totals={s.totals}
                  empty="No model call was recorded in this window."
                  onPick={(key, label) => setDrill({ kind: "runs", title: label, subtitle: "Runs of this team in the window. Gateway calls are counted in the row and listed on each application's page.", rows: runsIn.filter((r) => (r.owner?.team ?? "") === key) })}
                />
              </Section>
            </div>

            {/* ── by agent + by application ── */}
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <Section id="agents" title="Spend by agent" caption="The calls of runs, by the agent they carried out. Click for its runs." folded={folds.agents} onToggle={() => toggleFold("agents")}>
                <Groups
                  rows={s.by_agent.map((a) => ({ key: a.agent, label: name(a.agent), f: a }))}
                  empty="No run made a model call in this window."
                  onPick={(key, label) => setDrill({ kind: "runs", title: label, subtitle: "Runs of this agent in the window.", rows: runsIn.filter((r) => r.system === key) })}
                />
              </Section>
              <Section id="applications" title="Spend by application" caption="Calls registered applications made through the model gateway; they belong to no run or step. Click for the application." folded={folds.applications} onToggle={() => toggleFold("applications")}>
                <Groups
                  rows={s.by_application.map((a) => ({ key: a.application, label: a.application, f: a }))}
                  empty="No registered application made a call through the gateway in this window."
                  href={(key) => `/applications/${encodeURIComponent(key)}`}
                />
              </Section>
            </div>
            <AddsUpLine label="Agents and applications together" rows={[...s.by_agent, ...s.by_application]} totals={s.totals} />

            {/* ── by step ── */}
            <Section id="steps" title="Spend by step" caption="Every step of an agent that made model calls in the window. Click for its calls." folded={folds.steps} onToggle={() => toggleFold("steps")}>
              <div className="af-list overflow-x-auto">
                <table className="w-full border-collapse text-[11.5px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[10.5px] text-faint">
                      {["Agent › step", "Calls", "Runs", "Tokens in / out", "No price set", "Cost"].map((h, i) => (
                        <th key={h} className={`px-3 py-2 font-medium whitespace-nowrap ${i >= 1 ? "text-right" : ""}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {s.by_step.map((p) => (
                      <tr key={`${p.agent}/${p.node}`} onClick={() => setDrill({ kind: "calls", title: `${name(p.agent)} › ${p.node}`, rows: callsIn.filter((c) => c.source === "run" && c.system === p.agent && c.node === p.node).reverse() })} className="cursor-pointer border-b border-line last:border-0 hover:bg-raise/40">
                        <td className="px-3 py-2"><span className="text-dim">{name(p.agent)}</span> <span className="text-faint">›</span> <span className="font-mono text-[11px] text-fg">{p.node}</span></td>
                        <td className="tnum px-3 py-2 text-right">{p.calls}</td>
                        <td className="tnum px-3 py-2 text-right text-dim">{p.runs}</td>
                        <td className="tnum px-3 py-2 text-right text-dim">{fmtTokens(p.tokens_in)} / {fmtTokens(p.tokens_out)}</td>
                        <td className={`tnum px-3 py-2 text-right ${p.unpriced_calls ? "text-warn" : "text-ghost"}`}>{p.unpriced_calls}</td>
                        <td className="tnum px-3 py-2 text-right font-medium">{groupCost(p)}</td>
                      </tr>
                    ))}
                    {!s.by_step.length && <tr><td colSpan={6} className="px-3 py-5 text-center text-faint">No step made a model call in this window.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Section>

            {/* ── cost planning ── */}
            <Section id="planning" title="Cost planning" caption="What each step's recorded tokens in the window would cost on every other offered, priced model. A price comparison, not a measured cost: another model counts tokens its own way and may answer at another length." folded={folds.planning} onToggle={() => toggleFold("planning")}>
              <PlanningView plan={plan?.win === win ? plan.p : null} error={planError} name={name} />
            </Section>

            {/* ── runs checked ── */}
            <Section id="check" title="Runs checked against their calls" caption="For every run with a call in the window: whether its recorded calls add up to the cost the run records. A run with a call on a model with no price set records no cost, and agrees when its calls show the same." folded={folds.check} onToggle={() => toggleFold("check")}>
              <div className="flex flex-col gap-2 px-4 py-3 text-[12px] leading-[1.55]">
                <p className="text-dim">
                  {plural(s.runs.runs, "run")} with calls in this window: <span className="text-ok">{s.runs.agree} agree</span>
                  {s.runs.cost_unknown ? `, ${s.runs.cost_unknown} of them with no cost because a call had no price set` : ""}
                  {s.runs.differ.length ? <span className="text-err">; {plural(s.runs.differ.length, "run does", "runs do")} not add up</span> : ""}.
                </p>
                {s.runs.differ.length > 0 && (
                  <table className="w-full border-collapse text-[11.5px]">
                    <thead>
                      <tr className="border-b border-line text-left text-[10.5px] text-faint">
                        <th className="py-1.5 pr-3 font-medium">Run</th>
                        <th className="px-3 py-1.5 text-right font-medium">Recorded on the run</th>
                        <th className="px-3 py-1.5 text-right font-medium">Its calls add up to</th>
                        <th className="px-3 py-1.5 text-right font-medium">No price set</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.runs.differ.map((x) => (
                        <tr key={x.run} className="border-b border-line last:border-0">
                          <td className="py-1.5 pr-3"><Link href={`/runs?id=${encodeURIComponent(x.run)}`} className="font-mono text-[11px] underline decoration-line-strong">{x.run}</Link></td>
                          <td className="tnum px-3 py-1.5 text-right">{x.recorded_usd === null ? "none" : fmtUsd(x.recorded_usd)}</td>
                          <td className="tnum px-3 py-1.5 text-right">{x.calls_usd === null ? "none" : fmtUsd(x.calls_usd)}</td>
                          <td className="tnum px-3 py-1.5 text-right">{x.unpriced_calls}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </Section>

            {/* ── budgets ── */}
            <Section id="budgets" title="Budgets" caption="An amount in USD per rolling period (the last 24 hours, 7 days or 30 days). Once one is spent, a new run it applies to is refused (and, once the deployment's is spent, every application's gateway call), and a run already going pauses after the model call that reached it, until a person decides under Paused at budget on the Approvals page. Calls with no price set are not counted against it, so while one applies such a call is refused." folded={folds.budgets} onToggle={() => toggleFold("budgets")}>
              <Budgets state={d.budgetState} rows={d.budgets} onSaved={() => load(win)} />
            </Section>

            {/* ── routing ── */}
            <Section id="routing" title="Model routing" caption="Where each step's calls go now, and by which rule. In order: a model forced for a measurement, a route set here, the model the step names, its tier's default, the deployment default. The model shown is for data of no stated class and a run started without a model of its own; a call whose data class its model is not cleared for goes to that model's first cleared fallback (Configuration, Models). Saved routes apply from the next call." folded={folds.routing} onToggle={() => toggleFold("routing")}>
              <Routing agents={d.agents} config={d.config} bySteps={s.by_step} window={s.window} onSaved={() => load(win)} />
            </Section>

            {/* What the service names as not built, in its own words; only the bare key "billing" is spelt out. */}
            {d.not_built.length > 0 && (
              <p className="pb-2 text-[10.5px] text-ghost">
                Not built on this deployment, as the platform answers: {d.not_built.map((k) => (k === "billing" ? "a cloud billing feed, so recorded spend is not compared with an invoice" : k)).join("; ")}.
              </p>
            )}
          </>
        )}
        {!d && !error && <p className="text-[12px] text-faint">Reading the costs…</p>}
      </div>

      {drill && <DrillView drill={drill} now={now} name={name} onClose={() => setDrill(null)} />}
    </div>
  );
}

/* ═══════════════════ pieces ═══════════════════ */

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
      <span className="truncate text-[10px] text-ghost" title={sub}>{sub}</span>
    </button>
  );
}

/** Whether a card's rows add up to the window's totals, said under the card. */
function AddsUp({ rows, totals }: { rows: Figures[]; totals: Figures }) {
  if (!rows.length) return null;
  const a = addsUp(rows, totals);
  return (
    <p className={`border-t border-line px-3 py-2 text-[10.5px] leading-[1.5] ${a.ok ? "text-faint" : "text-err"}`}>
      {a.ok ? "The rows add up to the window's total: " : "The rows do not add up to the window's total: "}
      {fmtUsd(a.cost)} over {plural(a.calls - a.unpriced, "priced call")}, and {plural(a.unpriced, "call")} with no price set{a.ok ? "." : `; the total is ${groupCost(totals)} over ${plural(totals.calls - totals.unpriced_calls, "priced call")}, and ${plural(totals.unpriced_calls, "call")} with no price set.`}
    </p>
  );
}

function AddsUpLine({ label, rows, totals }: { label: string; rows: Figures[]; totals: Figures }) {
  if (!totals.calls) return null;
  const a = addsUp(rows, totals);
  return (
    <p className={`-mt-3 px-1 text-[10.5px] leading-[1.5] ${a.ok ? "text-faint" : "text-err"}`}>
      {label} {a.ok ? "add up to" : "do not add up to"} the window&rsquo;s total: {fmtUsd(a.cost)} over {plural(a.calls - a.unpriced, "priced call")}, and {plural(a.unpriced, "call")} with no price set
      {a.ok ? "." : `, against ${groupCost(totals)} over ${plural(totals.calls - totals.unpriced_calls, "priced call")}, and ${plural(totals.unpriced_calls, "call")} with no price set.`}
    </p>
  );
}

/** A ranked list of groups: the bar is the priced spend; calls with no price set are named on the row, never drawn as $0. */
function Groups({ rows, totals, empty, onPick, href }: { rows: { key: string; label: string; f: Figures }[]; totals?: Figures; empty: string; onPick?: (key: string, label: string) => void; href?: (key: string) => string }) {
  if (!rows.length) return <p className="px-4 py-6 text-center text-[12px] text-faint">{empty}</p>;
  return (
    <>
      <div className="af-list flex flex-col px-3 py-1">
        {rows.map((r, i) => {
          const max = Math.max(...rows.map((x) => x.f.cost_usd ?? 0));
          const width = max > 0 ? ((r.f.cost_usd ?? 0) / max) * 100 : 0;
          const body = (
            <>
              <span className="truncate text-[12px] text-mist">{r.label}</span>
              <span className="flex h-3.5 items-center">{width > 0 && <span className="h-full rounded-[2px]" style={{ width: `${width}%`, background: CAT[i % CAT.length] }} />}</span>
              <span className="tnum text-right text-[11px] whitespace-nowrap text-dim">
                {groupCost(r.f)} · {plural(r.f.calls, "call")}
                {r.f.runs ? ` · ${plural(r.f.runs, "run")}` : ""}
                {r.f.unpriced_calls && r.f.cost_usd !== null ? <span className="text-warn"> · {r.f.unpriced_calls} no price set</span> : ""}
              </span>
            </>
          );
          const cls = "grid grid-cols-[minmax(96px,1fr)_1.4fr_auto] items-center gap-3 border-b border-line py-2 last:border-0";
          if (href) return <Link key={r.key || "none"} href={href(r.key)} className={`${cls} focusable -mx-1 rounded-sm px-1 hover:bg-raise/60`}>{body}</Link>;
          return (
            <div key={r.key || "none"} role={onPick ? "button" : undefined} onClick={onPick ? () => onPick(r.key, r.label) : undefined} className={`${cls} ${onPick ? "focusable -mx-1 cursor-pointer rounded-sm px-1 hover:bg-raise/60" : ""}`}>
              {body}
            </div>
          );
        })}
      </div>
      {totals && <AddsUp rows={rows.map((r) => r.f)} totals={totals} />}
    </>
  );
}

function Series({ spend, calls, onDrill }: { spend: Spend; calls: Call[]; onDrill: (d: Drill) => void }) {
  const hourly = spend.series.bucket === "hour";
  const step = hourly ? 3_600_000 : 86_400_000;
  const points = spend.series.points;
  const label = (p: Point) => (hourly ? `${p.at.slice(5, 10)} ${p.at.slice(11, 16)}` : p.at.slice(0, 10));
  const withUnpriced = points.filter((p) => p.unpriced_calls > 0);
  const priced = points.some((p) => (p.cost_usd ?? 0) > 0);
  const max = Math.max(0, ...points.map((p) => p.cost_usd ?? 0));
  const bucketCalls = (at: string) => {
    const t = new Date(at).getTime();
    return calls.filter((c) => {
      const x = new Date(c.at).getTime();
      return x >= t && x < t + step;
    });
  };
  // Three labels under the bars: the first bucket, the middle one and the last.
  const marks = new Set([0, Math.floor((points.length - 1) / 2), points.length - 1]);
  return (
    <div className="flex flex-col gap-2 p-3">
      {priced ? (
        <div className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between text-[10px] text-faint">
            <span>{fmtUsd(max)} at the highest</span>
            <span>a warn mark under a bar: calls with no price set in it</span>
          </div>
          <div className="flex h-[170px] items-end gap-px border-b border-line">
            {points.map((p) => (
              <button
                key={p.at}
                type="button"
                title={`${label(p)}: ${p.cost_usd === null ? (p.calls ? "no price set" : "no call") : fmtUsd(p.cost_usd)} over ${plural(p.calls, "call")}${p.unpriced_calls ? `, ${p.unpriced_calls} with no price set` : ""}`}
                onClick={() => p.calls && onDrill({ kind: "calls", title: label(p), rows: bucketCalls(p.at).reverse() })}
                className={`focusable flex h-full min-w-0 grow flex-col justify-end ${p.calls ? "cursor-pointer hover:bg-raise/60" : "cursor-default"}`}
              >
                {(p.cost_usd ?? 0) > 0 && <span className="block w-full rounded-t-[2px]" style={{ height: `${((p.cost_usd ?? 0) / max) * 100}%`, background: CAT[0] }} />}
              </button>
            ))}
          </div>
          <div className="flex gap-px">
            {points.map((p, i) => (
              <span key={p.at} className="relative h-4 min-w-0 grow">
                {p.unpriced_calls > 0 && <span className="absolute top-0 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-warn" />}
                {marks.has(i) && <span className={`absolute top-1 font-mono text-[9.5px] whitespace-nowrap text-faint ${i === 0 ? "left-0" : i === points.length - 1 ? "right-0" : "left-1/2 -translate-x-1/2"}`}>{label(p)}</span>}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="px-1 py-6 text-center text-[12px] text-faint">{points.some((p) => p.calls > 0) ? "No call in this window was priced, so there is no spend to chart." : "No model call was recorded in this window."}</p>
      )}
      {withUnpriced.length > 0 && (
        <p className="px-1 text-[10.5px] leading-[1.5] text-warn">
          Calls with no price set, in no bar: {withUnpriced.slice(0, 8).map((p) => `${label(p)} (${p.unpriced_calls})`).join(", ")}
          {withUnpriced.length > 8 ? `, and ${withUnpriced.length - 8} more ${hourly ? "hours" : "days"}` : ""}.
        </p>
      )}
    </div>
  );
}

function PlanningView({ plan, error, name }: { plan: Planning | null; error: string; name: (a: string) => string }) {
  if (error) return <p className="px-4 py-3"><Failure inline message={error} /></p>;
  if (!plan) return <p className="px-4 py-3 text-[12px] text-faint">Reading the cost plan…</p>;
  return (
    <div className="flex flex-col">
      <div className="af-list overflow-x-auto">
        <table className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr className="border-b border-line text-left text-[10.5px] text-faint">
              <th className="px-3 py-2 font-medium">Agent › step</th>
              <th className="px-3 py-2 font-medium">Model used</th>
              <th className="px-3 py-2 text-right font-medium">Tokens in / out</th>
              <th className="px-3 py-2 text-right font-medium">Recorded cost</th>
              <th className="px-3 py-2 font-medium">The same tokens on each other offered, priced model</th>
            </tr>
          </thead>
          <tbody>
            {plan.steps.map((p) => (
              <tr key={`${p.agent}/${p.node}`} className="border-b border-line align-top last:border-0">
                <td className="px-3 py-2 whitespace-nowrap"><span className="text-dim">{name(p.agent)}</span> <span className="text-faint">›</span> <span className="font-mono text-[11px]">{p.node}</span></td>
                <td className="px-3 py-2 font-mono text-[10.5px]">{p.models.join(", ")}</td>
                <td className="tnum px-3 py-2 text-right text-dim">{fmtTokens(p.tokens_in)} / {fmtTokens(p.tokens_out)}</td>
                <td className="tnum px-3 py-2 text-right">
                  {groupCost(p)}
                  {p.unpriced_calls > 0 && p.cost_usd !== null && <span className="block text-[10px] text-warn">{unpricedNote(p)}, not in it</span>}
                </td>
                <td className="px-3 py-2">
                  {p.elsewhere.length ? (
                    <span className="flex flex-wrap gap-x-4 gap-y-1">
                      {p.elsewhere.map((e) => (
                        <span key={e.model} className="tnum whitespace-nowrap" title={e.why}>
                          <Mono className="text-[10.5px]">{e.model}</Mono> {fmtUsd(e.cost_usd)}
                          {e.cleared === false ? (
                            <span className="text-err"> (not cleared for this step&rsquo;s data)</span>
                          ) : (
                            e.difference_usd !== null && <span className={e.difference_usd < 0 ? "text-ok" : "text-faint"}> ({e.difference_usd < 0 ? "−" : "+"}{fmtUsd(Math.abs(e.difference_usd))})</span>
                          )}
                          {e.cleared === null && <span className="text-faint"> · clearance unknown</span>}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-faint">no other offered model has a price set</span>
                  )}
                </td>
              </tr>
            ))}
            {!plan.steps.length && <tr><td colSpan={5} className="px-3 py-5 text-center text-faint">No step made a model call in this window.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-1 border-t border-line px-3 py-2 text-[10.5px] leading-[1.5] text-faint">
        <span>{plan.basis}</span>
        {plan.unpriced_models.length > 0 && <span className="text-warn">Given no figure, because no price is set: {plan.unpriced_models.join(", ")}.</span>}
        {!plan.could_take_it.built && (
          <span>
            <span className="font-medium text-dim">Not built: whether a smaller model could take a step.</span> {plan.could_take_it.why}
          </span>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════ budgets ═══════════════════ */

function Budgets({ state, rows, onSaved }: { state: BudgetState | null; rows: BudgetRow[]; onSaved: () => void }) {
  const [amount, setAmount] = useState(state ? String(state.budget_usd) : "");
  const [period, setPeriod] = useState<Period>(state?.period ?? "month");
  const [busy, setBusy] = useState("");
  const [said, setSaid] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [useCases, setUseCases] = useState<UseCase[] | null>(null);
  const [ucError, setUcError] = useState("");
  const [uc, setUc] = useState("");
  const [ucAmount, setUcAmount] = useState("");
  const [ucPeriod, setUcPeriod] = useState<Period>("month");

  useEffect(() => {
    read<{ use_cases: UseCase[] }>("/api/use-cases")
      .then((d) => setUseCases(Array.isArray(d.use_cases) ? d.use_cases : []))
      .catch((e: Error) => {
        setUseCases([]);
        setUcError(e.message);
      });
  }, []);

  /** A typed amount: the number when it is one, else the text as typed, so the service refuses it in its own words. */
  const typed = (s: string): number | string => (Number.isFinite(Number(s.trim())) && s.trim() !== "" ? Number(s.trim()) : s.trim());

  const act = async (what: string, run: () => Promise<Rec>, done: string, after?: () => void) => {
    setBusy(what);
    setSaid(null);
    try {
      await run();
      after?.();
      setSaid({ tone: "ok", text: done });
      onSaved();
    } catch (e) {
      setSaid({ tone: "err", text: (e as Error).message });
    } finally {
      setBusy("");
    }
  };

  const useCaseRows = rows.filter((r) => r.scope === "use_case");
  const nameOf = (workload: string) => useCases?.find((u) => u.workload === workload)?.name ?? "";
  const by = (r: BudgetRow) => r.set_by?.name || r.set_by?.email || r.set_by?.sub || "";

  return (
    <div className="flex flex-col">
      {said && (
        <p className={`border-b border-line px-4 py-2 text-[11.5px] leading-[1.5] ${said.tone === "ok" ? "text-ok" : "text-err"}`} role={said.tone === "err" ? "alert" : undefined}>
          {said.tone === "err" && <span className="font-medium">Not saved. </span>}
          {said.text}
        </p>
      )}

      {/* the deployment's */}
      <div className="flex flex-col gap-2 border-b border-line px-4 py-3">
        <span className="text-[12px] font-semibold text-fg">The deployment</span>
        <span className="text-[11.5px] leading-[1.5] text-dim">
          {state
            ? state.exceeded === null || state.spent === null || state.remaining === null
              ? // Unpriced calls in the period: what was spent, what is left and whether it is spent are not known; the service says why.
                `${fmtUsd(state.budget_usd)} per ${state.period}, since ${when(state.since)}: ${state.exceeded === true ? "spent by the priced calls alone, so new runs and applications' gateway calls are refused, and running runs pause. " : "what remains is unknown. "}${state.unknown_why ? `${state.unknown_why[0].toUpperCase()}${state.unknown_why.slice(1)}.` : "The platform gives no reason."}`
              : `${fmtUsd(state.budget_usd)} per ${state.period}: ${fmtUsd(state.spent)} spent since ${when(state.since)}, ${state.exceeded ? "nothing left, so new runs and applications' gateway calls are refused, and running runs pause" : `${fmtUsd(state.remaining)} left`}${state.unpriced ? `; ${plural(state.unpriced, "call")} with no price set are not counted` : ""}.`
            : "No budget is set for the deployment: every recorded call still counts in the figures above, and nothing is refused or paused for spend."}
        </span>
        {state && (
          <span className="text-[11.5px] leading-[1.5] text-faint">
            Every recorded call counts against it, applications&rsquo; gateway calls among them. While it is set, a call with no price is refused: a run&rsquo;s call to a model with no price set, and an application&rsquo;s gateway call to one, or for embeddings (the embedding interface reports no token counts).
          </span>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-[11.5px] text-dim">
            USD
            <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="amount" aria-label="Deployment budget in USD" className="focusable h-7 w-28 rounded-md border border-line-strong bg-field px-1.5 font-mono text-[11px] text-fg" />
          </label>
          <span className="text-[11px] text-faint">per</span>
          <div className="w-24">
            <Pick value={period} onChange={setPeriod} options={[{ value: "day", label: "day" }, { value: "week", label: "week" }, { value: "month", label: "month" }]} aria-label="Budget period" />
          </div>
          <Button size="sm" variant="solid" tone="ink" permission="configure" loading={busy === "deployment"} disabled={!amount.trim()}
            onClick={() => act("deployment", () => write("POST", "/api/finops", { budget_usd: typed(amount), period }), `The deployment's budget is ${amount.trim()} USD per ${period}.`)}>
            Set the budget
          </Button>
          {state && (
            <Button size="sm" variant="solid" tone="err" permission="configure" loading={busy === "remove"}
              onClick={() => act("remove", () => write("POST", "/api/finops", { budget_usd: null, period: null }), "The deployment's budget is removed.", () => setAmount(""))}>
              Remove it
            </Button>
          )}
        </div>
      </div>

      {/* each use case's */}
      <div className="flex flex-col gap-2 px-4 py-3">
        <span className="text-[12px] font-semibold text-fg">Use cases</span>
        <span className="text-[11.5px] leading-[1.5] text-faint">The calls of the runs that served a use case count against its budget, beside the deployment&rsquo;s. Applications serve no use case: their gateway calls count against the deployment&rsquo;s budget only.</span>
        {useCaseRows.length > 0 && (
          <table className="w-full border-collapse text-[11.5px]">
            <thead>
              <tr className="border-b border-line text-left text-[10.5px] text-faint">
                <th className="py-1.5 pr-3 font-medium">Use case</th>
                <th className="px-3 py-1.5 text-right font-medium">Budget</th>
                <th className="px-3 py-1.5 text-right font-medium">Spent in the period</th>
                <th className="px-3 py-1.5 text-right font-medium">Left</th>
                <th className="px-3 py-1.5 font-medium">Set</th>
                <th className="py-1.5 pl-3" />
              </tr>
            </thead>
            <tbody>
              {useCaseRows.map((r) => (
                <tr key={r.key} className="border-b border-line align-top last:border-0">
                  <td className="py-1.5 pr-3">
                    <span className="block text-fg">{nameOf(r.key) || r.key}</span>
                    <Mono className="text-[10px] text-faint">{r.key}</Mono>
                  </td>
                  <td className="tnum px-3 py-1.5 text-right">{fmtUsd(r.amount_usd)} per {r.period}</td>
                  <td className="tnum px-3 py-1.5 text-right">
                    {r.spent_usd === null ? "unknown" : `${r.remaining_usd === null ? "at least " : ""}${fmtUsd(r.spent_usd)}`}
                    {r.unpriced_calls > 0 && <span className="block text-[10px] text-warn">{plural(r.unpriced_calls, "call")} with no price set</span>}
                  </td>
                  <td className={`tnum px-3 py-1.5 text-right ${r.remaining_usd !== null && r.remaining_usd <= 0 ? "text-err" : r.remaining_usd === null ? "text-warn" : ""}`} title={r.unknown_why ?? undefined}>
                    {r.remaining_usd === null ? "unknown" : r.remaining_usd <= 0 ? "spent" : fmtUsd(r.remaining_usd)}
                    {r.remaining_usd === null && r.unknown_why && <span className="block max-w-[34ch] text-left text-[10px] leading-[1.4] whitespace-normal text-faint">{r.unknown_why}</span>}
                  </td>
                  <td className="px-3 py-1.5 text-dim">{by(r)}{r.set_at ? `, ${when(r.set_at)}` : ""}</td>
                  <td className="py-1.5 pl-3 text-right">
                    <Button size="sm" variant="solid" tone="err" permission="configure" loading={busy === `uc:${r.key}`}
                      onClick={() => act(`uc:${r.key}`, () => write("DELETE", `/api/budgets/use-cases/${encodeURIComponent(r.key)}`), `The budget of ${nameOf(r.key) || r.key} is removed.`)}>
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {ucError && <Failure inline message={ucError} />}
        {useCases?.length === 0 && !ucError && <span className="text-[11.5px] text-faint">No use case is registered, so none can have a budget.</span>}
        {useCases && useCases.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-64">
              <Pick value={uc} onChange={setUc} options={[{ value: "", label: "choose a use case" }, ...useCases.map((u) => ({ value: u.workload, label: `${u.name} (${u.workload})` }))]} aria-label="Use case" />
            </div>
            <label className="flex items-center gap-2 text-[11.5px] text-dim">
              USD
              <input value={ucAmount} onChange={(e) => setUcAmount(e.target.value)} inputMode="decimal" placeholder="amount" aria-label="Use case budget in USD" className="focusable h-7 w-28 rounded-md border border-line-strong bg-field px-1.5 font-mono text-[11px] text-fg" />
            </label>
            <span className="text-[11px] text-faint">per</span>
            <div className="w-24">
              <Pick value={ucPeriod} onChange={setUcPeriod} options={[{ value: "day", label: "day" }, { value: "week", label: "week" }, { value: "month", label: "month" }]} aria-label="Use case budget period" />
            </div>
            <Button size="sm" variant="solid" tone="ink" permission="configure" loading={busy === "uc"} disabled={!uc || !ucAmount.trim()}
              onClick={() => act("uc", () => write("PUT", `/api/budgets/use-cases/${encodeURIComponent(uc)}`, { amount_usd: typed(ucAmount), period: ucPeriod }), `The budget of ${nameOf(uc) || uc} is ${ucAmount.trim()} USD per ${ucPeriod}.`)}>
              Set its budget
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════ routing ═══════════════════ */

function Routing({ agents, config, bySteps, window, onSaved }: { agents: AgentSpec[]; config: Config; bySteps: Spend["by_step"]; window: Win; onSaved: () => void }) {
  const [routes, setRoutes] = useState<Record<string, string>>(config.node_routes ?? {});
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ tone: "ok" | "err" | "warn"; text: string } | null>(null);
  // Compared entry by entry, sorted: the stored routes come back in no particular key order.
  const sorted = (r: Record<string, string>) => JSON.stringify(Object.entries(r).sort(([a], [b]) => a.localeCompare(b)));
  const dirty = sorted(routes) !== sorted(config.node_routes ?? {});

  const rows = agents.flatMap((a) => a.nodes.filter((n) => n.effective !== null).map((n) => ({ key: `${a.id}/${n.id}`, agent: a, node: n, f: bySteps.find((x) => x.agent === a.id && x.node === n.id) })));
  const options = [{ value: "", label: "no route" }, ...config.models.map((m) => ({ value: m.id, label: m.label || m.id }))];
  const setRoute = (key: string, model: string) =>
    setRoutes((r) => {
      const next = { ...r };
      if (model) next[key] = model;
      else delete next[key];
      return next;
    });

  const save = async () => {
    setBusy(true);
    setSaid(null);
    try {
      const d = await write("POST", "/api/config", { node_routes: routes });
      const dropped = (d.dropped && typeof d.dropped === "object" ? (d.dropped as Rec).node_routes : null) as Record<string, string> | null;
      setSaid(dropped && Object.keys(dropped).length ? { tone: "warn", text: `Saved, except: ${Object.entries(dropped).map(([k, why]) => `${k} (${why})`).join("; ")}.` } : { tone: "ok", text: "Routes saved: each applies from the step's next call." });
      onSaved();
    } catch (e) {
      setSaid({ tone: "err", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        {said && <span className={`text-[11.5px] ${said.tone === "ok" ? "text-ok" : said.tone === "warn" ? "text-warn" : "text-err"}`}>{said.tone === "err" ? `Not saved. ${said.text}` : said.text}</span>}
        <span className="grow" />
        {dirty && (
          <Button size="sm" variant="solid" tone="err" onClick={() => setRoutes(config.node_routes ?? {})}>
            Discard
          </Button>
        )}
        <Button size="sm" variant="solid" tone="ink" permission="configure" loading={busy} disabled={!dirty} onClick={save}>
          Save routes
        </Button>
      </div>
      <div className="af-list overflow-x-auto">
        <table className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr className="border-b border-line text-left text-[10.5px] text-faint">
              {["Agent › step", "The step names", "Its calls go to now", "Route", `Calls · ${window}`, `Cost · ${window}`].map((h, i) => (
                <th key={h} className={`px-3 py-2 font-medium whitespace-nowrap ${i >= 4 ? "text-right" : ""}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const changed = (routes[r.key] ?? "") !== (config.node_routes?.[r.key] ?? "");
              return (
                <tr key={r.key} className={`border-b border-line align-top last:border-0 ${routes[r.key] ? "bg-ok/5" : ""}`}>
                  <td className="px-3 py-1.5 whitespace-nowrap"><span className="text-dim">{r.agent.name}</span> <span className="text-faint">›</span> <span className="font-mono text-[11px]">{r.node.id}</span></td>
                  <td className="px-3 py-1.5 text-[10.5px] text-faint">{r.node.model ? `model ${r.node.model}` : r.node.model_class ? `the ${r.node.model_class} tier` : "nothing: the deployment default"}</td>
                  <td className="px-3 py-1.5">
                    {r.node.effective?.error ? (
                      <span className="text-[11px] text-err">{r.node.effective.error}</span>
                    ) : (
                      <span className="flex flex-col">
                        <Mono className="text-[10.5px]">{r.node.effective?.model}</Mono>
                        <span className="text-[10px] text-faint">{changed ? "changes when the routes are saved" : r.node.effective?.rule}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5"><div className="w-56"><Pick value={routes[r.key] ?? ""} onChange={(v) => setRoute(r.key, v)} options={options} aria-label={`Route ${r.key}`} /></div></td>
                  <td className="tnum px-3 py-1.5 text-right text-dim">{r.f?.calls ?? 0}</td>
                  <td className="tnum px-3 py-1.5 text-right">{r.f ? groupCost(r.f) : "$0.00"}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={6} className="px-3 py-5 text-center text-faint">No agent has a step that calls a model.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-line px-3 py-2 text-[10.5px] text-faint">
        <span>Deployment default: <Mono>{config.default_model || "none"}</Mono></span>
        {(["small", "medium", "large"] as const).map((c) => (
          <span key={c}>{c} tier: <Mono>{config.class_defaults?.[c] || "no default"}</Mono></span>
        ))}
        <span className="grow" />
        <Link href="/configuration?tab=models" className="underline">Models, prices, clearances and fallbacks in Configuration</Link>
      </div>
    </div>
  );
}

/* ═══════════════════ drill-downs ═══════════════════ */

function DrillView({ drill, now, name, onClose }: { drill: Drill; now: number; name: (a: string) => string; onClose: () => void }) {
  const cost = (c: number | null, unpriced: boolean) => (c !== null ? fmtUsd(c) : unpriced ? "no price set" : "none");
  if (drill.kind === "calls") {
    return (
      <DrillModal title={drill.title} subtitle={<>{drill.subtitle}{drill.rows.length > 500 ? ` · the first 500 of ${drill.rows.length.toLocaleString("en-GB")} are listed below` : ""}</>} count={drill.rows.length} onClose={onClose}>
        <DrillTable
          columns={[
            { label: "When", cell: (c: Call) => <span className="whitespace-nowrap text-dim">{ago(c.at, now)}</span> },
            {
              label: "Where",
              cell: (c: Call) =>
                c.source === "run" ? (
                  <span className="flex flex-col">
                    <span><span className="text-dim">{name(c.system)}</span> › <span className="font-mono text-[10.5px]">{c.node}</span></span>
                    <Link href={`/runs?id=${encodeURIComponent(c.run)}`} className="font-mono text-[10px] text-faint underline decoration-line-strong" onClick={(e) => e.stopPropagation()}>{c.run}</Link>
                  </span>
                ) : c.source === "service" ? (
                  <span className="flex flex-col">
                    <span className="text-dim">the service&rsquo;s own call{c.purpose ? `: ${c.purpose}` : ""}</span>
                    {c.run ? (
                      <Link href={`/runs?id=${encodeURIComponent(c.run)}`} className="font-mono text-[10px] text-faint underline decoration-line-strong" onClick={(e) => e.stopPropagation()}>for {c.run}</Link>
                    ) : (
                      <span className="text-[10px] text-faint">made for no run</span>
                    )}
                  </span>
                ) : (
                  <span className="flex flex-col">
                    <Link href={`/applications/${encodeURIComponent(c.application)}`} className="underline decoration-line-strong" onClick={(e) => e.stopPropagation()}>{c.application}</Link>
                    <span className="text-[10px] text-faint">through the gateway</span>
                  </span>
                ),
            },
            { label: "Model", cell: (c: Call) => <Mono className="text-[10.5px]">{c.model}</Mono> },
            { label: "In / out", cell: (c: Call) => `${fmtTokens(c.in)} / ${fmtTokens(c.out)}`, right: true },
            { label: "Latency", cell: (c: Call) => fmtMs(c.ms), right: true },
            { label: "Cost", cell: (c: Call) => <span className={c.unpriced ? "text-warn" : ""}>{cost(c.cost, c.unpriced)}</span>, right: true },
          ]}
          rows={drill.rows.slice(0, 500)}
          keyOf={(c) => c.ref}
          empty="No recorded call matches."
        />
      </DrillModal>
    );
  }
  return (
    <DrillModal title={drill.title} subtitle={<>{drill.subtitle}{drill.rows.length > 500 ? ` · the first 500 of ${drill.rows.length.toLocaleString("en-GB")} are listed below` : ""}</>} count={drill.rows.length} onClose={onClose}>
      <DrillTable
        columns={[
          { label: "When", cell: (r: Run) => <span className="whitespace-nowrap text-dim">{ago(r.at, now)}</span> },
          { label: "Run", cell: (r: Run) => <Link href={`/runs?id=${encodeURIComponent(r.id)}`} className="font-mono text-[10.5px] underline decoration-line-strong" onClick={(e) => e.stopPropagation()}>{r.id.slice(0, 32)}</Link> },
          { label: "Agent", cell: (r: Run) => name(r.system) },
          { label: "Started by", cell: (r: Run) => <span className="text-dim">{r.owner ? `${r.owner.name}${r.owner.team ? ` · ${r.owner.team}` : ""}` : "not recorded"}</span> },
          { label: "State", cell: (r: Run) => <Status tone={r.state === "done" ? "ok" : r.state === "failed" || r.state === "killed" ? "err" : r.state === "suspended" ? "warn" : "neutral"}>{r.state}</Status> },
          { label: "Calls", cell: (r: Run) => String(r.modelCalls), right: true },
          { label: "Tokens", cell: (r: Run) => fmtTokens(r.tokens.in + r.tokens.out), right: true },
          { label: "Cost", cell: (r: Run) => (r.cost !== null ? fmtUsd(r.cost) : r.modelCalls ? <span className="text-warn">no price set</span> : "$0.00"), right: true },
        ]}
        rows={drill.rows.slice(0, 500)}
        keyOf={(r) => r.id}
        empty="No run matches."
      />
    </DrillModal>
  );
}

