"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, IconButton, Label, Mono, Status, Tag } from "./ui";
import { Banner } from "./overlays";
import { useDismiss } from "./dismiss";
import { Sparkline } from "./data";
import { CAT } from "./charts";
import { TriangleGlyph, bestOf, logScore } from "./tradeoff";
import { Icon } from "./builder/icons";
import { SpanDetail, Waterfall, useTrace, type Span } from "./waterfall";
import { explainControl } from "@/lib/guardrails";
import { ControlRef, KILL_CONTROL } from "./control-ref";
import { hueFor } from "@/lib/hue";
import { usePageFacts } from "./assistant";
import { ApproveDialog, useGates, type Gate } from "./approve";
import { soon } from "@/lib/soon";
import { WindowPick, nextWin, winMs, type Win } from "./window-pick";
import { Pick } from "./select";

const PERIOD_DAYS = { day: 1, week: 7, month: 30 } as const;
const PERIOD_LABEL = { day: "day", week: "week", month: "month" } as const;

/**
 * The control plane: everything about the estate, live, and every figure
 * answerable. Click any KPI, agent, model, day or run and the drawer shows
 * the primary records behind it — a number you cannot drill into is a number
 * you have to take on faith, which is the opposite of this product.
 *
 * Nothing here is typed in: deployment stamps, run activity, token spend,
 * benchmark scores and liveness are computed from the registry, the run
 * journals, the eval record and the process table.
 */

/* ═══════════════════ shapes (mirror /api/control) ═══════════════════ */

interface RunRow {
  id: string;
  system: string;
  state: string;
  at: string;
  ms: number;
  entries: number;
  cost: number | null;
  tokens: { in: number; out: number };
  models: string[];
  suspendedAt: string;
  denials: number;
  modelCalls: number;
  toolCalls: number;
  artifacts: number;
  artifactNames: string[];
  byModel: { model: string; in: number; out: number; cost: number | null }[];
}

interface AgentRow {
  id: string;
  name: string;
  description: string;
  deployed_at: string | null;
  nodes: number;
  active: number;
  pending: number;
  runs7d: number;
  runsTotal: number;
  lastRun: string | null;
  lastState: string | null;
  avgMs7d: number | null;
  cost7d: number | null;
  unpriced7d?: number;
  tokens7d: number;
  models: string[];
  ticks: { id: string; state: string; at: string }[];
  evals: { passed: number; total: number; at: string; digest: string; model: string }[];
}

interface DayRow {
  day: string;
  runs: number;
  cost: number | null;
  denials: number;
  kills: number;
  avgMs: number | null;
  ids: string[];
}

interface ModelRow {
  model: string;
  local: boolean;
  tokens: number;
  in: number;
  out: number;
  cost: number | null;
  runs: number;
}

interface Posture {
  grants: number;
  byRisk: Record<string, number>;
  sinks: number;
  gatedSinks: number;
  ungated: { agent: string; node: string; tool: string }[];
  taintSplits: number;
}

interface ControlData {
  posture: Posture;
  routing: { agent: string; node: string; model: string | null }[];
  peers: { agent: string; name: string; url: string; up: boolean; title: string; skills: number }[];
  finops: {
    azure: {
      configured: boolean;
      missing: string[];
      scope: "resource" | "subscription" | null;
      currency: string | null;
      mtd: number | null;
      last7d: number | null;
      daily: { date: string; cost: number }[];
      fetchedAt: string | null;
      error: string | null;
    };
    budget: number | null;
    period: "day" | "week" | "month";
    budgetState: { since: string; spent: number; unpriced: number; remaining: number | null; exceeded: boolean; used: number | null };
    spend7d: number | null;
    unpriced7d?: number;
  };
  ledger: { entries: number; runs: number; lastWrite: string | null };
  totals: {
    deployed: number;
    registered: number;
    active: number;
    pending: number;
    runs7d: number;
    cost7d: number | null;
    unpriced7d?: number;
    tokens7d: number;
    denials7d: number;
    kills7d: number;
    avgMs7d: number | null;
  };
  agents: AgentRow[];
  live: { id: string; system: string; startedAt: string }[];
  days: DayRow[];
  models: ModelRow[];
  runs: RunRow[];
  store: string;
  costBasis: string;
  /** The window every "7d"-shaped figure was actually cut over (client-side). */
  window: Win;
  /** The clock the window was cut against. */
  now: number;
}

/* ── windows: every time-shaped figure re-cut in the browser from the run ledger ── */

const sumCosts = (xs: (number | null)[]): number | null =>
  xs.every((x) => x === null) ? null : xs.reduce((a: number, b) => a + (b ?? 0), 0);
const countUnpriced = (xs: (number | null)[]): number => xs.filter((x) => x === null).length;

/** The estate read, re-cut to a window. Field names keep their "7d" suffix —
    they are "the window" everywhere below, and the label says which. */
function rewindow(d: ControlData, now: number, w: Win): ControlData {
  const since = now - winMs(w);
  const inWin = (r: RunRow) => new Date(r.at).getTime() >= since;
  const recent = d.runs.filter(inWin);
  const agents = d.agents.map((a) => {
    const mine = recent.filter((r) => r.system === a.id);
    return {
      ...a,
      runs7d: mine.length,
      avgMs7d: mine.length ? Math.round(mine.reduce((s, r) => s + r.ms, 0) / mine.length) : null,
      cost7d: sumCosts(mine.map((r) => r.cost)),
      unpriced7d: countUnpriced(mine.map((r) => r.cost)),
      tokens7d: mine.reduce((s, r) => s + r.tokens.in + r.tokens.out, 0),
      models: [...new Set(mine.flatMap((r) => r.models))],
    };
  });
  const oldest = d.runs.length ? Math.min(...d.runs.map((r) => new Date(r.at).getTime())) : now;
  const nDays = w === "all" ? Math.min(90, Math.max(14, Math.ceil((now - oldest) / 86_400_000) + 1)) : Math.max(14, Math.min(90, Math.round(winMs(w) / 86_400_000)));
  const days: DayRow[] = [];
  for (let i = nDays - 1; i >= 0; i--) {
    const key = new Date(now - i * 86_400_000).toISOString().slice(0, 10);
    const inDay = d.runs.filter((r) => r.at.slice(0, 10) === key);
    days.push({
      day: key,
      runs: inDay.length,
      cost: sumCosts(inDay.map((r) => r.cost)),
      denials: inDay.reduce((s, r) => s + r.denials, 0),
      kills: inDay.filter((r) => r.state === "killed").length,
      avgMs: inDay.length ? Math.round(inDay.reduce((s, r) => s + r.ms, 0) / inDay.length) : null,
      ids: inDay.map((r) => r.id),
    });
  }
  const agg = new Map<string, { in: number; out: number; cost: number | null; runs: Set<string> }>();
  for (const r of recent) {
    for (const b of r.byModel ?? []) {
      const a = agg.get(b.model) ?? { in: 0, out: 0, cost: 0, runs: new Set<string>() };
      a.in += b.in;
      a.out += b.out;
      a.cost = a.cost === null || b.cost === null ? null : a.cost + b.cost;
      a.runs.add(r.id);
      agg.set(b.model, a);
    }
  }
  const models: ModelRow[] = [...agg.entries()]
    .map(([model, a]) => ({ model, local: model === "scripted", tokens: a.in + a.out, in: a.in, out: a.out, cost: a.cost, runs: a.runs.size }))
    .sort((a, b) => b.tokens - a.tokens);
  const cost7d = sumCosts(recent.map((r) => r.cost));
  const unpriced7d = countUnpriced(recent.map((r) => r.cost));
  return {
    ...d,
    agents,
    days,
    models,
    finops: { ...d.finops, spend7d: cost7d, unpriced7d },
    totals: {
      ...d.totals,
      runs7d: recent.length,
      cost7d,
      unpriced7d,
      tokens7d: recent.reduce((s, r) => s + r.tokens.in + r.tokens.out, 0),
      denials7d: recent.reduce((s, r) => s + r.denials, 0),
      kills7d: recent.filter((r) => r.state === "killed").length,
      avgMs7d: recent.length ? Math.round(recent.reduce((s, r) => s + r.ms, 0) / recent.length) : null,
    },
    window: w,
    now,
  };
}

type Drill =
  | { kind: "kpi"; which: "deployed" | "active" | "pending" | "runs" | "spend" | "time" | "denials" | "kills" }
  | { kind: "agent"; id: string }
  | { kind: "day"; day: string }
  | { kind: "model"; id: string }
  | { kind: "run"; id: string }
  | { kind: "span"; run: string; span: Span };

/* ═══════════════════ formatting ═══════════════════ */

const fmtMs = (ms: number | null) =>
  ms === null ? "—" : ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}m` : `${(ms / 1000).toFixed(1)}s`;

const fmtCost = (c: number | null) =>
  c === null ? "unknown" : c === 0 ? "$0.00" : c < 0.005 ? "<$0.01" : `$${c.toFixed(2)}`;

const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n));

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return `${Math.max(1, Math.round(s))}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};

/* ── Lifecycle stages: the slide's spine, each lit only by a real record ── */

const LIFECYCLE: {
  id: string;
  label: string;
  roadmap?: boolean;
  evidence: (a: AgentRow) => string;
}[] = [
  { id: "design", label: "Design", evidence: () => "spec in the registry" },
  { id: "test", label: "Test", evidence: (a) => `${a.evals.length} benchmark run${a.evals.length === 1 ? "" : "s"}` },
  { id: "approve", label: "Approve", roadmap: true, evidence: () => "" },
  { id: "publish", label: "Publish", evidence: (a) => `deployed ${a.deployed_at ? "" : "not yet"}` },
  { id: "deploy", label: "Deploy", evidence: (a) => `deployed_at stamp in the registry${a.deployed_at ? "" : ""}` },
  { id: "observe", label: "Observe", evidence: (a) => `${a.runsTotal} journalled run${a.runsTotal === 1 ? "" : "s"}` },
  { id: "improve", label: "Improve", evidence: () => "benchmarked across two spec versions" },
  { id: "retire", label: "Retire", roadmap: true, evidence: () => "" },
];

function lifecycleOf(a: AgentRow): Set<string> {
  const lit = new Set<string>(["design"]);
  if (a.evals.length > 0) lit.add("test");
  if (a.deployed_at) {
    lit.add("publish");
    lit.add("deploy");
  }
  if (a.runsTotal > 0) lit.add("observe");
  if (new Set(a.evals.map((e) => e.digest)).size > 1) lit.add("improve");
  return lit;
}

const DOT_BG: Record<string, string> = {
  done: "bg-ok",
  failed: "bg-err",
  suspended: "bg-warn",
  killed: "bg-err",
  running: "bg-run",
};

const STATE_TONE: Record<string, "ok" | "err" | "warn" | "run" | "queue"> = {
  done: "ok",
  failed: "err",
  suspended: "warn",
  killed: "err",
  running: "run",
};

/* ═══════════════════ the page ═══════════════════ */

/** Every refusal and mark on this deployment, with the rule that fired. */
function useRefusals(active: boolean) {
  const [rows, setRows] = useState<
    { control: string; run: string; agent: string; node: string; title: string; detail: string; at: string }[] | null
  >(null);
  useEffect(() => {
    if (!active || rows) return;
    let stop = false;
    fetch("/api/guardrails")
      .then((r) => r.json())
      .then((d) => !stop && setRows(d.recent ?? []))
      .catch(() => !stop && setRows([]));
    return () => {
      stop = true;
    };
  }, [active, rows]);
  return rows;
}

export function Control() {
  const router = useRouter();
  const [raw, setRaw] = useState<ControlData | null>(null);
  const [error, setError] = useState("");
  const [confirmAll, setConfirmAll] = useState(false);
  // The page window, and per-card overrides (a KPI tile, the activity chart,
  // the model mix). Changing the page window clears every override.
  const [win, setWinState] = useState<Win>("7d");
  const [cardWin, setCardWin] = useState<Partial<Record<string, Win>>>({});
  const setWin = (w: Win) => {
    setWinState(w);
    setCardWin({});
  };
  const [stack, setStack] = useState<Drill[]>([]);
  const [answering, setAnswering] = useState<Gate | null>(null);
  const [stageNotice, setStageNotice] = useState<string | null>(null);
  const [deployingId, setDeployingId] = useState<string | null>(null);
  /* Hover readouts — what a tooltip would have hidden, kept on the page. */
  const [stageHint, setStageHint] = useState<string | null>(null);
  const [tickHint, setTickHint] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drill = stack[stack.length - 1] ?? null;
  const { gates, reload: reloadGates } = useGates();

  const notice = useCallback((msg: string) => {
    setStageNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setStageNotice(null), 3200);
  }, []);

  const [queue, setQueue] = useState<QueueData | null>(null);
  // The clock the windows are cut against: stamped when the data arrives, so a
  // render is a pure function of what was loaded and when.
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/control");
      const d = await res.json();
      if (d.error) throw new Error(String(d.error));
      setRaw(d);
      setNow(Date.now());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
    // The trigger queue is its own read: the intake can be healthy while the
    // estate read is slow, and the other way round.
    try {
      const q = await (await fetch("/api/queue")).json();
      setQueue(q.error ? null : q);
    } catch {
      setQueue(null);
    }
  }, []);

  useEffect(() => {
    const cancel = soon(load);
    const id = setInterval(load, 4000);
    return () => {
      cancel();
      clearInterval(id);
    };
  }, [load]);

  const data = useMemo(() => (raw ? rewindow(raw, now, win) : null), [raw, now, win]);
  // A card on its own window gets its own cut of the same ledger.
  const cut = useCallback((card: string): ControlData | null => (raw && cardWin[card] ? rewindow(raw, now, cardWin[card]!) : data), [raw, now, cardWin, data]);
  const wf = (card: string): Win => cardWin[card] ?? win;
  const tile = (card: string, w?: Win) => (w ? setCardWin((c) => ({ ...c, [card]: w })) : setCardWin((c) => ({ ...c, [card]: nextWin(wf(card)) })));

  const open = useCallback((d: Drill) => {
    setStack((s) => {
      const top = s[s.length - 1];
      if (top && JSON.stringify(top) === JSON.stringify(d)) return s; // same click closes nothing, keeps state
      return [...s, d].slice(-8);
    });
  }, []);
  const back = useCallback(() => setStack((s) => s.slice(0, -1)), []);
  const close = useCallback(() => setStack([]), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setStack((s) => s.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* Deploy straight from the lifecycle strip — the real /api/deploy, same as
     the builder's theater, minus the theatrics. */
  const deployNow = useCallback(
    async (agentId: string) => {
      setDeployingId(agentId);
      try {
        const spec = await (await fetch(`/api/agents?id=${encodeURIComponent(agentId)}`)).json();
        if (spec.error) throw new Error(String(spec.error));
        const res = await fetch("/api/deploy", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ spec: spec.spec }),
        });
        const d = await res.json();
        if (!res.ok || d.error) throw new Error(String(d.error ?? res.status));
        notice(`${agentId} deployed — digest ${String(d.digest).slice(0, 8)}`);
        load();
      } catch (e) {
        notice(`Deploy refused: ${(e as Error).message.slice(0, 120)}`);
      } finally {
        setDeployingId(null);
      }
    },
    [load, notice],
  );

  /* Each lifecycle stage is a control, not a caption. */
  const stageAction = useCallback(
    (a: AgentRow, stageId: string) => {
      switch (stageId) {
        case "design":
          router.push(`/builder?load=${encodeURIComponent(a.id)}`);
          break;
        case "test":
        case "improve":
          router.push(`/evals?agent=${encodeURIComponent(a.id)}`);
          break;
        case "approve":
          notice("Approval flow ships with auth — authoring and authorising stay separate powers.");
          break;
        case "publish":
        case "deploy":
          if (a.deployed_at) open({ kind: "agent", id: a.id });
          else deployNow(a.id);
          break;
        case "observe":
          if (a.runsTotal > 0) open({ kind: "agent", id: a.id });
          else router.push(`/runs?agent=${encodeURIComponent(a.id)}`);
          break;
        case "retire":
          notice("No retirement flow yet — Delete on the Workflows page removes a spec from the registry.");
          break;
      }
    },
    [router, notice, deployNow, open],
  );

  /* Which kill is in flight: a run id, or "*" for the whole estate. The
     button that fired it shows the spinner until the request settles. */
  const [killing, setKilling] = useState<string | null>(null);
  const kill = useCallback(
    async (id?: string) => {
      setKilling(id ?? "*");
      try {
        await fetch("/api/kill", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(id ? { id } : { all: true }),
        }).catch(() => {});
        await load();
      } finally {
        setKilling(null);
      }
    },
    [load],
  );

  const t = data?.totals;
  usePageFacts(
    data
      ? {
          totals: t,
          runsInFlight: data.live.map((l) => ({ id: l.id, system: l.system })),
          gatesAwaiting: (gates ?? []).map((g) => ({ run: g.run, agent: g.agent, node: g.node })),
          recentRuns: data.runs.slice(0, 8).map((r) => ({ id: r.id, system: r.system, state: r.state, denials: r.denials })),
        }
      : null,
  );
  const statusLine = !data
    ? "reading the estate…"
    : t!.active > 0
      ? `${t!.active} run${t!.active === 1 ? "" : "s"} in flight`
      : t!.pending > 0
        ? `quiet — ${t!.pending} awaiting a person`
        : `all quiet · last activity ${ago(data.runs[0]?.at ?? null)}`;

  return (
    <div className="relative mx-auto w-full max-w-[1520px] px-5 py-7">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-3">
            <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">Control</h1>
            <span className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1">
              {data && t!.active > 0 ? (
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-2 animate-ping rounded-full bg-run opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-run" />
                </span>
              ) : (
                <span className="size-2 rounded-full bg-ok" />
              )}
              <span className="text-[11.5px] font-medium text-dim">{statusLine}</span>
            </span>
          </div>
          <p className="max-w-[64ch] text-[12.5px] leading-[1.55] text-dim">
            Monitor deployed workflows, active runs, approvals, performance, cost and control
            events. Each measure is calculated from platform records and opens to its supporting detail.
          </p>
        </div>
        <span className="grow" />
        <span className="flex flex-col items-end gap-1">
          <span className="text-[10px] text-faint">Page window · click a tile&rsquo;s window to override it</span>
          <WindowPick value={win} onChange={setWin} />
        </span>
        <LogExport />
        {t && t.active > 0 && (
          <Button
            tone="err"
            variant="solid"
            size="sm"
            loading={killing === "*"}
            onClick={() => {
              if (confirmAll) {
                kill();
                setConfirmAll(false);
                if (confirmTimer.current) clearTimeout(confirmTimer.current);
              } else {
                setConfirmAll(true);
                confirmTimer.current = setTimeout(() => setConfirmAll(false), 3000);
              }
            }}
          >
            <span className="size-1.5 rounded-[2px] bg-on-solid" />
            {confirmAll ? `Really stop ${t.active} run${t.active === 1 ? "" : "s"}?` : "Kill all runs"}
          </Button>
        )}
      </div>

      {error && <p className="mt-4 text-[12.5px] text-err">{error}</p>}

      {/* ── KPI band — every tile opens its records ── */}
      <div className="mt-6 grid grid-cols-2 overflow-hidden rounded-md border border-line bg-surface sm:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Deployed agents" value={t ? String(t.deployed) : "…"} sub={t ? `${t.registered} registered` : ""}
          active={drill?.kind === "kpi" && drill.which === "deployed"} onOpen={() => open({ kind: "kpi", which: "deployed" })} />
        <Kpi label="Active now" value={t ? String(t.active) : "…"} sub={t?.active ? "streaming live" : "nothing in flight"}
          tone={t?.active ? "run" : undefined} active={drill?.kind === "kpi" && drill.which === "active"}
          onOpen={() => open({ kind: "kpi", which: "active" })} />
        <Kpi label="Awaiting approval" value={t ? String(t.pending) : "…"} sub={t?.pending ? "a person is next" : "no gates open"}
          tone={t?.pending ? "warn" : undefined} active={drill?.kind === "kpi" && drill.which === "pending"}
          onOpen={() => open({ kind: "kpi", which: "pending" })} />
        <Kpi label="Runs" value={cut("runs")?.totals ? String(cut("runs")!.totals.runs7d) : "…"} sub="every journal counted"
          win={wf("runs")} onWin={() => tile("runs")} spark={cut("runs")?.days.map((d) => d.runs)} active={drill?.kind === "kpi" && drill.which === "runs"}
          onOpen={() => open({ kind: "kpi", which: "runs" })} />
        <Kpi label="Spend" value={cut("spend")?.totals ? fmtCost(cut("spend")!.totals.cost7d) : "…"} sub={cut("spend")?.totals ? `${fmtTokens(cut("spend")!.totals.tokens7d)} tokens${cut("spend")!.totals.unpriced7d ? ` · ${cut("spend")!.totals.unpriced7d} unpriced` : ""}` : ""}
          win={wf("spend")} onWin={() => tile("spend")} spark={cut("spend")?.days.map((d) => d.cost ?? 0)} active={drill?.kind === "kpi" && drill.which === "spend"}
          onOpen={() => open({ kind: "kpi", which: "spend" })} />
        <Kpi label="Avg run time" value={cut("time")?.totals ? fmtMs(cut("time")!.totals.avgMs7d) : "…"} sub="wall clock"
          win={wf("time")} onWin={() => tile("time")} spark={cut("time")?.days.map((d) => d.avgMs ?? 0)} active={drill?.kind === "kpi" && drill.which === "time"}
          onOpen={() => open({ kind: "kpi", which: "time" })} />
        <Kpi label="Guardrail denials" value={cut("denials")?.totals ? String(cut("denials")!.totals.denials7d) : "…"} sub="click for the rule that fired"
          win={wf("denials")} onWin={() => tile("denials")} tone={cut("denials")?.totals.denials7d ? "warn" : undefined} spark={cut("denials")?.days.map((d) => d.denials)}
          active={drill?.kind === "kpi" && drill.which === "denials"} onOpen={() => open({ kind: "kpi", which: "denials" })} />
        <Kpi label="Kills" value={cut("kills")?.totals ? String(cut("kills")!.totals.kills7d) : "…"} sub="operator decisions"
          win={wf("kills")} onWin={() => tile("kills")} tone={cut("kills")?.totals.kills7d ? "err" : undefined} spark={cut("kills")?.days.map((d) => d.kills)}
          active={drill?.kind === "kpi" && drill.which === "kills"} onOpen={() => open({ kind: "kpi", which: "kills" })} />
      </div>

      {/* ── Lifecycle: the Design→Retire spine, lit by real signals only ── */}
      <section className="mt-4 flex flex-col overflow-hidden rounded-md border border-line bg-surface">
        <PanelHead
          title="Agent lifecycle"
          meta="each stage lit by its own record — unlit stages are honestly unbuilt"
        />
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-[minmax(140px,1fr)_repeat(8,minmax(64px,72px))] items-center gap-1 border-b border-line px-4 py-1.5">
              <span className="text-[10.5px] font-semibold text-dim">Agent</span>
              {LIFECYCLE.map((s) => (
                <span key={s.id} className="flex flex-col items-center gap-0.5 text-center">
                  <Label>{s.label}</Label>
                  {s.roadmap && <span className="text-[8px] text-ghost">roadmap</span>}
                </span>
              ))}
            </div>
            {(data?.agents ?? []).map((a) => {
              const lit = lifecycleOf(a);
              return (
                <div
                  key={a.id}
                  className="grid w-full grid-cols-[minmax(140px,1fr)_repeat(8,minmax(64px,72px))] items-center gap-1 border-b border-line px-4 py-1.5 last:border-b-0 hover:bg-raise/30"
                >
                  <Button size="sm" variant="quiet" className="max-w-full justify-self-start" onClick={() => open({ kind: "agent", id: a.id })}>
                    <span className="min-w-0 truncate">{a.name}</span>
                  </Button>
                  {LIFECYCLE.map((s, i) => {
                    const on = lit.has(s.id);
                    const prev = i === 0 || lit.has(LIFECYCLE[i - 1].id) || LIFECYCLE[i - 1].roadmap;
                    const busy = deployingId === a.id && (s.id === "publish" || s.id === "deploy");
                    const hint = s.roadmap
                      ? `${s.label}: not built yet — click for the honest answer`
                      : on
                        ? `${s.label}: ${s.evidence(a)} — click to open`
                        : s.id === "publish" || s.id === "deploy"
                          ? `${s.label}: not deployed — click to deploy now`
                          : s.id === "test" || s.id === "improve"
                            ? `${s.label}: no benchmark yet — click to build one`
                            : `${s.label}: no record yet — click to start`;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => stageAction(a, s.id)}
                        title={`${a.name} · ${s.label}`}
                        aria-label={`${a.name} — ${hint}`}
                        onMouseEnter={() => setStageHint(`${a.name} · ${hint}`)}
                        onMouseLeave={() => setStageHint(null)}
                        onFocus={() => setStageHint(`${a.name} · ${hint}`)}
                        onBlur={() => setStageHint(null)}
                        className="focusable flex cursor-pointer items-center justify-center rounded-sm py-1.5 transition-colors hover:bg-raise/70"
                      >
                        <span className={`h-px w-4 ${i === 0 ? "opacity-0" : on && prev ? "bg-ok/60" : "bg-line"}`} />
                        <span
                          className={`size-2.5 shrink-0 rounded-[3px] border transition-transform ${
                            busy
                              ? "animate-pulse border-run bg-run"
                              : s.roadmap
                                ? "border-dashed border-line-strong bg-transparent"
                                : on
                                  ? "border-ok bg-ok"
                                  : "border-line-strong bg-surface"
                          }`}
                        />
                        <span className={`h-px w-4 ${i === LIFECYCLE.length - 1 ? "opacity-0" : "bg-line"}`} />
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {!data && <p className="px-4 py-4 text-[12px] text-faint">Reading the registry…</p>}
          </div>
        </div>
        <p className="truncate border-t border-line px-4 py-1.5 text-[10.5px] text-faint" aria-live="polite">
          {stageHint ?? "Hover a stage for the record behind it and what a click does."}
        </p>
      </section>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
        {/* ── The estate ── */}
        <section className="flex h-fit flex-col overflow-hidden rounded-md border border-line bg-surface">
          <PanelHead title="Estate" meta="every agent, its whole record — click a row" />
          <div className="max-h-[560px] overflow-auto">
            <div className="min-w-[820px]">
              <div className="sticky top-0 z-10 grid grid-cols-[minmax(170px,1.4fr)_96px_120px_130px_86px_86px_72px] items-center gap-3 border-b border-line bg-surface px-4 py-2">
                {["Agent", "Status", "Benchmark", "Health · last 14", "Avg time", `Spend · ${win}`, ""].map((h, i) => (
                  <span key={i} className={`text-[11px] font-semibold text-dim ${i === 4 || i === 5 ? "text-right" : ""}`}>{h}</span>
                ))}
              </div>

              {(data?.agents ?? []).map((a) => (
                <div
                  key={a.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => open({ kind: "agent", id: a.id })}
                  onKeyDown={(e) => e.key === "Enter" && open({ kind: "agent", id: a.id })}
                  className={`focusable grid cursor-pointer grid-cols-[minmax(170px,1.4fr)_96px_120px_130px_86px_86px_72px] items-center gap-3 border-b border-line px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-raise/50 ${
                    drill?.kind === "agent" && drill.id === a.id ? "bg-raise/70" : ""
                  }`}
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[13px] font-semibold text-fg">{a.name}</span>
                    <span className="truncate font-mono text-[10px] text-faint">
                      {a.id} · {a.nodes} node{a.nodes === 1 ? "" : "s"} · {a.runs7d} run{a.runs7d === 1 ? "" : "s"} · {win}
                    </span>
                  </span>

                  <span className="flex flex-col gap-1">
                    {a.active > 0 ? (
                      <Status tone="run">{a.active} live</Status>
                    ) : a.deployed_at ? (
                      <Status tone="ok">Deployed</Status>
                    ) : (
                      <Status tone="queue">Saved</Status>
                    )}
                    {a.pending > 0 && <Status tone="warn">{a.pending} waiting</Status>}
                  </span>

                  <span className="flex flex-col gap-1">
                    {a.evals.length ? (
                      <>
                        <span className="flex items-baseline gap-1">
                          <span className={`tnum text-[13px] font-semibold ${a.evals[0].passed === a.evals[0].total ? "text-ok" : "text-warn"}`}>
                            {a.evals[0].passed}/{a.evals[0].total}
                          </span>
                          <span className="text-[10px] text-faint">{ago(a.evals[0].at)}</span>
                        </span>
                        <span className="h-1 w-full overflow-hidden rounded-full bg-raise">
                          <span
                            className={`block h-full rounded-full ${a.evals[0].passed === a.evals[0].total ? "bg-ok" : "bg-warn"}`}
                            style={{ width: `${(a.evals[0].passed / Math.max(1, a.evals[0].total)) * 100}%` }}
                          />
                        </span>
                      </>
                    ) : (
                      <span className="text-[11px] text-faint">no benchmark yet</span>
                    )}
                  </span>

                  {/* Health ticks — each one is a real run */}
                  <span className="flex items-center gap-[3px]">
                    {a.ticks.length === 0 && <span className="text-[10.5px] text-ghost">no runs</span>}
                    {a.ticks.map((tk) => (
                      <button
                        key={tk.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          open({ kind: "run", id: tk.id });
                        }}
                        title="Open run"
                        aria-label={`Run ${tk.state} ${ago(tk.at)}`}
                        onMouseEnter={() => setTickHint(`${a.name} · run ${tk.state} · ${ago(tk.at)}`)}
                        onMouseLeave={() => setTickHint(null)}
                        onFocus={() => setTickHint(`${a.name} · run ${tk.state} · ${ago(tk.at)}`)}
                        onBlur={() => setTickHint(null)}
                        className={`focusable h-3.5 w-[6px] cursor-pointer rounded-[1.5px] transition-transform hover:scale-y-125 ${DOT_BG[tk.state] ?? "bg-line-strong"}`}
                      />
                    ))}
                  </span>

                  <span className="tnum text-right text-[12.5px] text-mist">{fmtMs(a.avgMs7d)}</span>
                  <span className="tnum text-right text-[12.5px] text-mist">{fmtCost(a.cost7d)}</span>

                  <span className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="outline" href={`/runs?agent=${encodeURIComponent(a.id)}`}>
                      Run
                    </Button>
                  </span>
                </div>
              ))}

              {data && data.agents.length === 0 && (
                <p className="px-4 py-6 text-[12.5px] text-faint">
                  Nothing in the registry. Build a workflow and deploy it — it appears here with
                  its whole record.
                </p>
              )}
              {!data && <p className="px-4 py-6 text-[12.5px] text-faint">Reading the registry…</p>}
            </div>
          </div>
          <p className="truncate border-t border-line px-4 py-1.5 text-[10.5px] text-faint" aria-live="polite">
            {tickHint ?? "Health: one tick per run — hover for its state and age, click to open."}
          </p>

          {/* Recent runs fill the column — the estate's pulse, row by row. */}
          <div className="border-t border-line">
            <div className="flex h-8 items-center gap-2 border-b border-line bg-raise/40 px-4">
              <span className="text-[11px] font-semibold text-dim">Recent runs</span>
              <span className="grow" />
              <Button size="sm" variant="quiet" href="/runs">
                All runs →
              </Button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2">
              {(data?.runs ?? []).slice(0, 10).map((r, i) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => open({ kind: "run", id: r.id })}
                  className={`focusable flex cursor-pointer items-center gap-2.5 border-b border-line px-4 py-2 text-left transition-colors hover:bg-raise/50 ${
                    i % 2 === 0 ? "sm:border-r" : ""
                  }`}
                >
                  <span className={`size-1.5 shrink-0 rounded-[2px] ${DOT_BG[r.state] ?? "bg-line-strong"}`} />
                  <span className="flex min-w-0 grow flex-col">
                    <span className="truncate text-[11.5px] font-medium text-fg">{r.system}</span>
                    <span className="truncate font-mono text-[9.5px] text-faint">
                      {r.state} · {fmtMs(r.ms)} · {fmtCost(r.cost)}
                      {r.denials > 0 ? ` · ${r.denials} denied` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-[9.5px] whitespace-nowrap text-ghost">{ago(r.at)}</span>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ── Right rail: what needs a person, and what is running ── */}
        <div className="flex flex-col gap-4">
          {/* Live now */}
          <section className="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
            <PanelHead
              title="Live now"
              right={<Mono className="text-[10px] text-ghost">SIGTERM, journalled</Mono>}
              pulse={Boolean(data?.live.length)}
            />
            {(data?.live ?? []).map((r) => (
              <div key={r.id} className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
                <button
                  type="button"
                  onClick={() => open({ kind: "run", id: r.id })}
                  className="focusable flex min-w-0 grow cursor-pointer flex-col text-left"
                >
                  <span className="truncate text-[12.5px] font-medium text-fg">{r.system}</span>
                  <span className="truncate font-mono text-[10px] text-faint">{r.id} · {ago(r.startedAt)}</span>
                </button>
                <KillButton id={r.id} busy={killing === r.id || killing === "*"} onKill={kill} />
              </div>
            ))}
            {!data && <p className="px-3 py-4 text-[12px] text-faint">Reading the process table…</p>}
            {data && data.live.length === 0 && (
              <p className="px-3 py-4 text-[12px] text-faint">
                Nothing in flight. Runs appear here the moment they start, kill switch beside each.
              </p>
            )}
          </section>

          {/* Approvals queue — the human turn, front and center */}
          <section className="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
            <PanelHead
              title="Approvals queue"
              meta="a person is the next step"
              right={
                (data?.totals.pending ?? 0) > 0 ? (
                  <Status tone="warn">{data!.totals.pending} waiting</Status>
                ) : undefined
              }
            />
            {(data?.runs ?? [])
              .filter((r) => r.state === "suspended")
              .slice(0, 6)
              .map((r) => (
                <div key={r.id} className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => open({ kind: "run", id: r.id })}
                    className="focusable flex min-w-0 grow cursor-pointer flex-col text-left"
                  >
                    <span className="truncate text-[12.5px] font-medium text-fg">{r.system}</span>
                    <span className="truncate font-mono text-[10px] text-warn">
                      paused at {r.suspendedAt || "a gate"} · {ago(r.at)}
                    </span>
                  </button>
                  {/* Answering happens here. It used to link to the run page,
                      which is where a run is *started* — the one place a person
                      with a gate to answer should never be sent. */}
                  <Button permission="approve"
                    size="sm"
                    variant="outline"
                    tone="warn"
                    onClick={() => {
                      const g = (gates ?? []).find((x) => x.run === r.id);
                      if (g) setAnswering(g);
                      else open({ kind: "run", id: r.id });
                    }}
                  >
                    Answer
                  </Button>
                </div>
              ))}
            {data && !data.runs.some((r) => r.state === "suspended") && (
              <p className="px-3 py-4 text-[12px] text-faint">
                No gates open. When a workflow suspends for sign-off, it queues here with an
                Answer button.
              </p>
            )}
          </section>

          {/* Guardrails — the record of "no" */}
          <section className="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
            <PanelHead title="Guardrails" meta="policy in action, 7 days" />
            <div className="grid grid-cols-3 divide-x divide-line">
              {[
                { label: "Denials", value: t?.denials7d ?? 0, tone: t?.denials7d ? "text-warn" : "text-fg", drill: "denials" as const },
                { label: "Kills", value: t?.kills7d ?? 0, tone: t?.kills7d ? "text-err" : "text-fg", drill: "kills" as const },
                { label: "Gates answered", value: (data?.runs ?? []).filter((r) => new Date(r.at).getTime() >= now - 7 * 86_400_000 && r.state === "done").length, tone: "text-fg", drill: "runs" as const },
              ].map((g) => (
                <button
                  key={g.label}
                  type="button"
                  onClick={() => open({ kind: "kpi", which: g.drill })}
                  className="focusable flex cursor-pointer flex-col items-center gap-0.5 px-2 py-3 transition-colors hover:bg-raise/50"
                >
                  <span className={`tnum text-[18px] leading-none font-semibold ${g.tone}`}>{g.value}</span>
                  <span className="text-[10px] text-faint">{g.label}</span>
                </button>
              ))}
            </div>
            <p className="border-t border-line px-3 py-2 text-[10.5px] leading-[1.5] text-faint">
              Every refusal, gate and kill is a journal entry with a because-chain — open any run
              to read the exact rule that fired.
            </p>
          </section>

          {/* FinOps — the gateway's own balance, and the budget beside the burn */}
          <FinOpsPanel finops={data?.finops ?? null} window={win} onSaved={load} />
        </div>
      </div>

      {/* ── The lower boards: one masonry flow. Columns pack panels by their
          real height — no panel is ever stretched to a neighbour's, so there
          is no void to stretch into. ── */}
      <div className="mt-4 gap-4 md:columns-2 xl:columns-3">
        <section className="mb-4 flex break-inside-avoid flex-col overflow-hidden rounded-md border border-line bg-surface">
          <PanelHead title="Activity" meta={`${cut("activity")?.days.length ?? 14} days — click a day`} right={
            <span className="flex items-center gap-2">
              <Mono className="text-[10px] text-ghost">{cut("activity")?.totals ? `${fmtCost(cut("activity")!.totals.cost7d)} · ${wf("activity")}` : ""}</Mono>
              <WindowPick value={wf("activity")} onChange={(w) => tile("activity", w)} inherited={!cardWin.activity} />
            </span>
          } />
          <ActivityChart days={cut("activity")?.days ?? []} selected={drill?.kind === "day" ? drill.day : null} onPick={(day) => open({ kind: "day", day })} />
        </section>

        <section className="mb-4 flex break-inside-avoid flex-col overflow-hidden rounded-md border border-line bg-surface">
          <PanelHead title="Model mix" meta={`${wf("mix")} — click a model`} right={<WindowPick value={wf("mix")} onChange={(w) => tile("mix", w)} inherited={!cardWin.mix} />} />
          <ModelMix models={cut("mix")?.models ?? []} onPick={(id) => open({ kind: "model", id })} selected={drill?.kind === "model" ? drill.id : null} />
        </section>

        {/* The intake: what external systems have posted, and who is draining it */}
        <section className="mb-4 flex break-inside-avoid flex-col overflow-hidden rounded-md border border-line bg-surface">
          <PanelHead
            title="Trigger queue"
            meta="external posts, by agent"
            pulse={Boolean(queue && Object.values(queue.agents).some((a) => (a.running ?? 0) > 0))}
            right={<Mono className="text-[10px] text-ghost">{queue ? `${queue.workers.length} worker${queue.workers.length === 1 ? "" : "s"} live` : ""}</Mono>}
          />
          <QueuePanel queue={queue} now={now} />
        </section>

        {/* The optimizing triangle: cost, accuracy, time. Every model sits
            where its own evidence pulls it. */}
        <section className="mb-4 flex break-inside-avoid flex-col overflow-hidden rounded-md border border-line bg-surface">
          <TradeoffTriangle
            models={data?.models ?? []}
            runs={data?.runs ?? []}
            agents={data?.agents ?? []}
            selected={drill?.kind === "model" ? drill.id : null}
            onPick={(id) => open({ kind: "model", id })}
          />
        </section>

        {/* What the estate actually produced — files, not vibes */}
        <section className="mb-4 flex break-inside-avoid flex-col overflow-hidden rounded-md border border-line bg-surface">
          <PanelHead title="Artifacts" meta="what the runs wrote" />
          <div className="max-h-[260px] overflow-y-auto">
            {(data?.runs ?? [])
              .flatMap((r) => r.artifactNames.map((name) => ({ name, run: r })))
              .slice(0, 10)
              .map(({ name, run: r }, i) => (
                <div key={`${name}-${i}`} className="flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0">
                  <span className="grid size-6 shrink-0 place-items-center rounded-sm bg-raise text-dim">
                    <Icon name={name.endsWith(".json") ? "json" : "file"} size={12} />
                  </span>
                  <button
                    type="button"
                    onClick={() => open({ kind: "run", id: r.id })}
                    className="focusable flex min-w-0 grow cursor-pointer flex-col text-left"
                  >
                    <span className="truncate text-[11.5px] font-medium text-fg">{name}</span>
                    <span className="truncate font-mono text-[9.5px] text-faint">
                      {r.system} · {ago(r.at)}
                    </span>
                  </button>
                  <a
                    href={`/api/artifact?name=${encodeURIComponent(name)}`}
                    download={name}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Download ${name}`}
                    className="focusable inline-grid size-7 shrink-0 cursor-pointer place-items-center rounded-md border border-transparent bg-raise text-fg transition-[filter] duration-100 hover:brightness-[1.08] active:brightness-95"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
                    </svg>
                  </a>
                </div>
              ))}
            {data && !data.runs.some((r) => r.artifactNames.length) && (
              <p className="px-3 py-4 text-[12px] text-faint">
                Nothing written yet — documents land here the moment a run produces them.
              </p>
            )}
          </div>
        </section>

        {/* Partner agents — A2A peers, card-pinged live */}
        <section className="mb-4 flex break-inside-avoid flex-col overflow-hidden rounded-md border border-line bg-surface">
          <PanelHead title="Partner agents" meta="A2A peers, card-pinged live" />
          {(data?.peers ?? []).map((p) => (
            <div key={`${p.name}@${p.url}`} className="flex items-center gap-2.5 border-b border-line px-3 py-2.5 last:border-b-0">
              <span className={`size-2 shrink-0 rounded-full ${p.up ? "bg-ok" : "bg-err"}`} aria-hidden />
              <span className="flex min-w-0 grow flex-col">
                <span className="truncate text-[12px] font-medium text-fg">{p.title}</span>
                <span className="truncate font-mono text-[9.5px] text-faint">
                  {p.url} · used by {p.agent}
                </span>
              </span>
              <span className="shrink-0 text-[10px] text-ghost">
                {p.up ? `${p.skills} skill${p.skills === 1 ? "" : "s"}` : "unreachable"}
              </span>
            </div>
          ))}
          {data && data.peers.length === 0 && (
            <p className="px-3 py-4 text-[12px] leading-[1.55] text-faint">
              No external agents configured. Drop an A2A connector on any workflow and the peer
              appears here with a live status.
            </p>
          )}
          <p className="border-t border-line px-3 py-2 text-[10.5px] leading-[1.5] text-faint">
            Their answers arrive marked untrusted — the same taint rules as every other boundary.
          </p>
        </section>

        {/* Least-privilege posture */}
        <section className="mb-4 flex break-inside-avoid flex-col overflow-hidden rounded-md border border-line bg-surface">
          <PanelHead title="Least privilege" meta="grants × declared risk × gates" />
          {data && (
            <>
              <div className="grid grid-cols-4 divide-x divide-line border-b border-line">
                {(["read", "write", "risky", "destructive"] as const).map((r) => (
                  <div key={r} className="flex flex-col items-center gap-0.5 px-1 py-2.5">
                    <span className={`tnum text-[16px] leading-none font-semibold ${r === "read" ? "text-fg" : (data.posture.byRisk[r] ?? 0) > 0 ? "text-warn" : "text-fg"}`}>
                      {data.posture.byRisk[r] ?? 0}
                    </span>
                    <span className="text-[9.5px] text-faint">{r}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-1.5 px-3 py-2.5">
                <span className="flex items-baseline justify-between text-[11.5px]">
                  <span className="text-dim">Grants across the estate</span>
                  <span className="tnum font-semibold text-fg">{data.posture.grants}</span>
                </span>
                <span className="flex items-baseline justify-between text-[11.5px]">
                  <span className="text-dim">Sinks behind a gate</span>
                  <span className={`tnum font-semibold ${data.posture.gatedSinks === data.posture.sinks ? "text-ok" : "text-warn"}`}>
                    {data.posture.gatedSinks}/{data.posture.sinks}
                  </span>
                </span>
                {data.posture.ungated.length > 0 && (
                  <div className="mt-1">
                    <Banner
                      tone="warn"
                      title={`${data.posture.ungated.length} sink${data.posture.ungated.length === 1 ? "" : "s"} without an approval gate`}
                    >
                      <span className="flex flex-col gap-1 pt-0.5">
                        {data.posture.ungated.slice(0, 4).map((u, i) => (
                          <Button key={i} size="sm" variant="quiet" className="max-w-full self-start font-mono" onClick={() => open({ kind: "agent", id: u.agent })}>
                            <span className="min-w-0 truncate">
                              {u.agent} · {u.node} · {u.tool}
                            </span>
                          </Button>
                        ))}
                      </span>
                    </Banner>
                  </div>
                )}
              </div>
              <p className="border-t border-line px-3 py-2 text-[10.5px] leading-[1.5] text-faint">
                Derived from the specs, never typed in — the same numbers the runtime enforces.
              </p>
            </>
          )}
        </section>

        {/* The ledger */}
        <section className="mb-4 flex break-inside-avoid flex-col overflow-hidden rounded-md border border-line bg-surface">
          <PanelHead title="Execution ledger" meta="append-only, exportable" />
          <div className="grid grid-cols-3 divide-x divide-line border-b border-line">
            {[
              { label: "Entries", value: data ? String(data.ledger.entries) : "…" },
              { label: "Runs", value: data ? String(data.ledger.runs) : "…" },
              { label: "Last write", value: data ? ago(data.ledger.lastWrite) : "…" },
            ].map((x) => (
              <div key={x.label} className="flex flex-col items-center gap-0.5 px-1 py-2.5">
                <span className="tnum text-[16px] leading-none font-semibold text-fg">{x.value}</span>
                <span className="text-[9.5px] text-faint">{x.label}</span>
              </div>
            ))}
          </div>
          <p className="px-3 py-2.5 text-[11px] leading-[1.55] text-dim">
            Every model call, tool call, refusal, gate and kill — one entry each, carrying the
            evidence chain it rests on. The journal is what an auditor reads; nothing on this
            page exists that it doesn&rsquo;t.
          </p>
          <div className="border-t border-line px-3 py-2.5">
            <Button size="sm" variant="outline" href="/api/logs">
              Download NDJSON
            </Button>
          </div>
        </section>

      </div>

      <p className="mt-4 flex items-center gap-2 text-[10.5px] text-ghost">
        <Icon name="database" size={11} />
        {data ? `${data.store} · cost basis: ${data.costBasis}` : "reading the estate…"}
      </p>

      {/* Stage-action feedback — the honest answer, or the receipt. */}
      {stageNotice && (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-md border border-line bg-surface px-4 py-2 text-[12px] text-fg elev-3 af-pop">
          {stageNotice}
        </div>
      )}

      {/* ── The drawer: primary records behind whatever was clicked ── */}
      {drill && data && (
        <Drawer
          drill={drill}
          data={data}
          depth={stack.length}
          onBack={back}
          onClose={close}
          onOpen={open}
          onKill={kill}
          killing={killing}
          onAnswer={(runId) => {
            const g = (gates ?? []).find((x) => x.run === runId);
            if (g) setAnswering(g);
          }}
        />
      )}

      {answering && (
        <ApproveDialog
          gate={answering}
          onClose={() => setAnswering(null)}
          onAnswered={() => {
            reloadGates();
            load();
          }}
        />
      )}
    </div>
  );
}

/* ═══════════════════ pieces ═══════════════════ */

/** FinOps: what Azure billed for the resource, what the journal says was
    spent, and a budget to burn against. Billed lags usage by up to a day and
    is the truth; journalled is tokens times the configured price and is now. */
function FinOpsPanel({
  finops,
  window,
  onSaved,
}: {
  finops: ControlData["finops"] | null;
  window: Win;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [period, setPeriod] = useState<"day" | "week" | "month">("month");
  const [saving, setSaving] = useState(false);
  const azure = finops?.azure ?? null;
  const billed = azure?.configured && azure.error === null ? azure.last7d : null;
  const cur = azure?.currency ?? "USD";
  const fmtBilled = (n: number | null) => (n === null ? "—" : `${cur === "USD" ? "$" : `${cur} `}${n.toFixed(2)}`);
  const spend = finops?.spend7d ?? null;
  // The budget is a rate (so much per period). The window's spend is compared
  // to the budget scaled to the window: $5 a day is $150 over 30 days, and
  // an "all time" window is scaled to however many days it actually spans.
  const state = finops?.budgetState ?? null;
  const windowDays = window === "all" ? Math.max(1, (Date.now() - new Date(state?.since ?? Date.now()).getTime()) / 86_400_000) : winMs(window) / 86_400_000;
  const windowBudget = finops?.budget != null && finops.period ? (finops.budget * windowDays) / PERIOD_DAYS[finops.period] : null;
  const burnPct = windowBudget && spend !== null ? Math.min(100, (spend / Math.max(0.01, windowBudget)) * 100) : null;
  const usedPct = state?.used != null ? Math.round(state.used * 100) : null;

  return (
    <section className="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
      <PanelHead
        title="FinOps"
        meta={azure?.configured ? `Azure billed · ${azure.scope === "resource" ? "Foundry resource" : "subscription"} · burn vs budget` : "journalled burn vs budget"}
      />
      <div className="grid grid-cols-4 divide-x divide-line border-b border-line">
        {[
          { label: "Billed · MTD", value: fmtBilled(azure?.configured && azure.error === null ? azure.mtd : null), tone: "text-fg" },
          { label: "Billed · 7d", value: fmtBilled(billed), tone: "text-fg" },
          { label: finops?.unpriced7d ? `Journalled · ${window} · ${finops.unpriced7d} unpriced` : `Journalled · ${window}`, value: fmtCost(spend), tone: "text-fg" },
          { label: finops?.budget != null ? `Budget · per ${PERIOD_LABEL[finops.period]}` : "Budget", value: finops?.budget != null ? `$${finops.budget.toFixed(2)}` : "unset", tone: state?.exceeded ? "text-err" : "text-fg" },
        ].map((x) => (
          <div key={x.label} className="flex flex-col items-center gap-0.5 px-1 py-2.5">
            <span className={`tnum text-[15px] leading-none font-semibold ${x.tone}`}>{x.value}</span>
            <span className="text-[9.5px] text-faint">{x.label}</span>
          </div>
        ))}
      </div>
      {state && finops?.budget != null && (
        <div className={`flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line px-3 py-2 text-[10.5px] ${state.exceeded ? "text-err" : "text-faint"}`}>
          <span className="font-medium">{state.exceeded ? "Budget exhausted · new runs are refused" : `This ${PERIOD_LABEL[finops.period]} so far`}</span>
          <span className="tnum">{fmtCost(state.spent)} of ${finops.budget.toFixed(2)}{usedPct !== null ? ` · ${usedPct}%` : ""}</span>
          {state.remaining !== null && !state.exceeded && <span className="tnum">{fmtCost(Math.max(0, state.remaining))} left</span>}
          {state.unpriced > 0 && <span>{state.unpriced} unpriced run{state.unpriced === 1 ? "" : "s"} not counted</span>}
        </div>
      )}
      {burnPct !== null && windowBudget !== null && (
        <div className="flex flex-col gap-1 px-3 pt-2.5">
          <span className="flex justify-between text-[10px] text-faint">
            <span>{window} spend vs {fmtCost(windowBudget)} ({`$${finops!.budget!.toFixed(2)} per ${PERIOD_LABEL[finops!.period]}`} scaled to {window})</span>
            <span className="tnum">{burnPct.toFixed(0)}%</span>
          </span>
          <span className="h-1.5 w-full overflow-hidden rounded-full bg-raise">
            <span
              className={`block h-full rounded-full ${burnPct >= 90 ? "bg-err" : burnPct >= 60 ? "bg-warn" : "bg-ok"}`}
              style={{ width: `${burnPct}%` }}
            />
          </span>
        </div>
      )}
      <div className="flex items-center gap-2 px-3 py-2.5">
        {editing ? (
          <>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="budget, USD"
              inputMode="decimal"
              autoFocus
              className="focusable h-7 w-28 rounded-sm border border-line bg-canvas px-2 text-[11.5px] text-fg placeholder:text-ghost"
            />
            <span className="text-[11px] text-faint">per</span>
            <div className="w-24">
              <Pick value={period} onChange={setPeriod} options={[{ value: "day", label: "day" }, { value: "week", label: "week" }, { value: "month", label: "month" }]} aria-label="Budget period" />
            </div>
            <Button
              size="sm"
              variant="solid"
              tone="ink"
              loading={saving}
              onClick={async () => {
                const n = Number(value);
                if (!Number.isFinite(n) || n < 0) return;
                setSaving(true);
                try {
                  await fetch("/api/control", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ budget_usd: n, period }),
                  }).catch(() => {});
                } finally {
                  setSaving(false);
                }
                setEditing(false);
                onSaved();
              }}
            >
              Set
            </Button>
            <Button size="sm" variant="solid" tone="err" disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => {
                setValue(finops?.budget != null ? String(finops.budget) : "");
                setPeriod(finops?.period ?? "month");
                setEditing(true);
              }}
            >
              {finops?.budget != null ? "Change budget" : "Set a weekly budget"}
            </Button>
            <span className="grow" />
            <span className="truncate text-[10px] text-ghost" title={azure?.error ?? azure?.missing.join(", ") ?? ""}>
              {!azure?.configured
                ? `Azure billing not connected: set ${azure?.missing.join(", ") ?? "the AZURE_* variables"}`
                : azure.error
                  ? `Azure Cost Management: ${azure.error}`
                  : `Azure figures as of ${azure.fetchedAt ? new Date(azure.fetchedAt).toLocaleTimeString() : "now"}; billing lags usage by up to a day`}
            </span>
          </>
        )}
      </div>
    </section>
  );
}

/** Log export: the journal stream, SIEM-shaped. The download works today;
    the forwarders are deployment slots and say so. */
function LogExport() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss<HTMLDivElement>(open, close);

  return (
    <div ref={ref} className="relative">
      <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
        Export logs
      </Button>
      {open && (
        <div className="absolute top-full right-0 z-40 mt-1.5 flex w-72 flex-col overflow-hidden rounded-md border border-line bg-surface elev-3 af-pop">
          <a
            href="/api/logs"
            download
            onClick={() => setOpen(false)}
            className="focusable flex items-center gap-2.5 border-b border-line px-3 py-2.5 transition-colors hover:bg-raise/60"
          >
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-raise text-fg">
              <Icon name="file" size={13} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-[12.5px] font-semibold text-fg">Download NDJSON</span>
              <span className="text-[10.5px] text-faint">
                Every journal entry, one event per line — SIEM-ready
              </span>
            </span>
          </a>
          {[
            { name: "Splunk HEC", hint: "HTTP Event Collector" },
            { name: "Microsoft Sentinel", hint: "Log Analytics ingestion" },
            { name: "Google Chronicle", hint: "Ingestion API" },
          ].map((s) => (
            <div key={s.name} className="flex items-center gap-2.5 border-b border-line px-3 py-2 opacity-70 last:border-b-0">
              <span className="grid size-7 shrink-0 place-items-center rounded-md bg-raise text-faint">
                <Icon name="webhook" size={13} />
              </span>
              <span className="flex min-w-0 grow flex-col">
                <span className="text-[12px] font-medium text-dim">{s.name}</span>
                <span className="text-[10px] text-ghost">{s.hint}</span>
              </span>
              <Status tone="queue">not configured</Status>
            </div>
          ))}
          <p className="px-3 py-2 text-[10px] leading-[1.5] text-ghost">
            Forwarders are wired per deployment — same stream as the download, shipped
            continuously inside the client&rsquo;s tenancy.
          </p>
        </div>
      )}
    </div>
  );
}

/** A kill switch that names its consequence before it fires: the first click
    arms it, the second kills, and it disarms itself after three seconds. */
function KillButton({
  id,
  label = "Kill",
  busy,
  onKill,
}: {
  id: string;
  label?: string;
  busy: boolean;
  onKill: (id: string) => void;
}) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return (
    <Button permission="run"
      size="sm"
      variant="solid"
      tone="err"
      loading={busy}
      onClick={() => {
        if (timer.current) clearTimeout(timer.current);
        if (armed) {
          setArmed(false);
          onKill(id);
        } else {
          setArmed(true);
          timer.current = setTimeout(() => setArmed(false), 3000);
        }
      }}
    >
      {armed ? "Click again to kill" : label}
    </Button>
  );
}

function PanelHead({ title, meta, right, pulse }: { title: string; meta?: string; right?: React.ReactNode; pulse?: boolean }) {
  return (
    <div data-hue={hueFor(title)} className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-raise/55 px-3">
      <span className="text-[12px] font-semibold">{title}</span>
      {pulse && (
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-2 animate-ping rounded-full bg-run opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-run" />
        </span>
      )}
      {meta && <span className="truncate text-[11px] text-faint">{meta}</span>}
      <span className="grow" />
      {right}
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
  spark,
  active,
  onOpen,
  win,
  onWin,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "run" | "warn" | "err";
  spark?: number[];
  active: boolean;
  onOpen: () => void;
  /** The tile's own window; clicking the chip cycles it without opening the drill. */
  win?: Win;
  onWin?: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-pressed={active}
      className={`focusable -mr-px -mb-px flex cursor-pointer flex-col gap-1 border-r border-b border-line px-3 py-2.5 text-left transition-colors ${
        active ? "bg-raise/80" : "hover:bg-raise/50"
      }`}
    >
      <span className="flex items-center gap-1.5">
        <span className="truncate text-[10.5px] text-faint">{label}</span>
        {win && (
          <button
            type="button"
            title="Click to change this tile's window"
            onClick={(e) => {
              e.stopPropagation();
              onWin?.();
            }}
            className="focusable rounded-[3px] border border-line bg-canvas px-1 font-mono text-[9px] leading-[14px] text-dim hover:border-line-strong hover:text-fg"
          >
            {win}
          </button>
        )}
      </span>
      <span className="flex items-end justify-between gap-2">
        <span
          className="tnum text-[22px] leading-none font-semibold tracking-[-0.02em]"
          style={tone ? { color: `var(--color-${tone})` } : undefined}
        >
          {value}
        </span>
        {spark && spark.some((v) => v > 0) && (
          <Sparkline points={spark} tone={tone ?? "run"} width={52} height={16} area={false} />
        )}
      </span>
      <span className="truncate text-[10px] text-ghost">{sub}</span>
    </div>
  );
}

function ActivityChart({
  days,
  selected,
  onPick,
}: {
  days: DayRow[];
  selected: string | null;
  onPick: (day: string) => void;
}) {
  const maxRuns = Math.max(1, ...days.map((d) => d.runs));
  const knownCosts = days.filter((d) => d.cost !== null).map((d) => d.cost as number);
  const maxCost = Math.max(0.01, ...knownCosts);
  // The day under the pointer, else the picked day: its figures sit in the
  // footer rather than in a tooltip, so they are on the page for everyone.
  const [hover, setHover] = useState<string | null>(null);
  const shown = days.find((d) => d.day === (hover ?? selected)) ?? null;
  const readout = (d: DayRow) =>
    `${d.day} · ${d.runs} run${d.runs === 1 ? "" : "s"}${d.cost !== null ? ` · ${fmtCost(d.cost)}` : ""}${d.kills ? ` · ${d.kills} killed` : ""}`;
  return (
    <div className="flex flex-col">
      <div className="relative px-3 pt-4">
        <div className="flex items-end gap-[3px]" style={{ height: 92 }}>
          {days.map((d) => (
            <button
              key={d.day}
              type="button"
              onClick={() => onPick(d.day)}
              aria-pressed={selected === d.day}
              aria-label={readout(d)}
              onMouseEnter={() => setHover(d.day)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(d.day)}
              onBlur={() => setHover(null)}
              className="group focusable flex h-full grow cursor-pointer items-end"
            >
              <span
                className={`w-full rounded-t-[2px] transition-colors ${
                  selected === d.day ? "bg-run" : "bg-run/60 group-hover:bg-run/90"
                }`}
                style={{ height: `${Math.max(d.runs ? 6 : 1.5, (d.runs / maxRuns) * 100)}%` }}
              />
            </button>
          ))}
        </div>
        {/* Cost overlay — drawn only over days whose cost is actually known. */}
        <svg className="pointer-events-none absolute inset-x-3 top-4" style={{ height: 92 }} preserveAspectRatio="none" viewBox={`0 0 ${days.length * 10} 92`} aria-hidden>
          <polyline
            fill="none"
            stroke="var(--color-warn)"
            strokeWidth="1.5"
            strokeLinejoin="round"
            points={days
              .map((d, i) => (d.cost === null ? null : `${i * 10 + 5},${92 - (d.cost / maxCost) * 80 - 4}`))
              .filter(Boolean)
              .join(" ")}
          />
        </svg>
      </div>
      <div className="flex justify-between px-3 pt-1 pb-2">
        <span className="font-mono text-[9.5px] text-ghost">{days[0]?.day.slice(5)}</span>
        <span className="flex items-center gap-1.5 text-[9.5px] text-ghost">
          <span className="inline-block h-px w-3 bg-warn" /> cost
        </span>
        <span className="font-mono text-[9.5px] text-ghost">today</span>
      </div>
      <p className="tnum truncate border-t border-line px-3 py-1.5 font-mono text-[10px] text-faint" aria-live="polite">
        {shown ? readout(shown) : "Hover a day for its runs and cost; click to open them."}
      </p>
    </div>
  );
}

function ModelMix({
  models,
  selected,
  onPick,
}: {
  models: ModelRow[];
  selected: string | null;
  onPick: (id: string) => void;
}) {
  const total = Math.max(1, models.reduce((s, m) => s + m.tokens, 0));
  const localShare = Math.round((models.filter((m) => m.local).reduce((s, m) => s + m.tokens, 0) / total) * 100);
  if (!models.length) return <p className="px-3 py-4 text-[12px] text-faint">No model calls in this window.</p>;
  return (
    <div className="flex flex-col gap-2.5 p-3">
      <div className="flex h-2 w-full gap-px overflow-hidden rounded-full">
        {models.map((m) => (
          <span
            key={m.model}
            title={`${m.model} · ${fmtTokens(m.tokens)} tokens`}
            className={m.local ? "bg-ok" : "bg-run"}
            style={{ width: `${Math.max(1.5, (m.tokens / total) * 100)}%` }}
          />
        ))}
      </div>
      <p className="text-[10.5px] text-faint">
        <span className="font-semibold text-ok">{localShare}%</span> of tokens ran on local models — genuinely $0, nothing left the machine.
      </p>
      <div className="flex flex-col">
        {models.map((m) => (
          <button
            key={m.model}
            type="button"
            onClick={() => onPick(m.model)}
            aria-pressed={selected === m.model}
            className={`focusable -mx-1 flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1.5 text-left transition-colors ${
              selected === m.model ? "bg-raise/80" : "hover:bg-raise/50"
            }`}
          >
            <span className={`size-1.5 shrink-0 rounded-[2px] ${m.local ? "bg-ok" : "bg-run"}`} />
            <span className="min-w-0 grow truncate font-mono text-[11px] text-fg">{m.model}</span>
            <span className="tnum shrink-0 text-[10.5px] text-dim">{fmtTokens(m.tokens)}</span>
            <span className="tnum w-14 shrink-0 text-right text-[10.5px] text-mist">{fmtCost(m.cost)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════ the drawer ═══════════════════ */

function Drawer({
  drill,
  data,
  depth,
  onBack,
  onClose,
  onOpen,
  onKill,
  killing,
  onAnswer,
}: {
  drill: Drill;
  data: ControlData;
  depth: number;
  onBack: () => void;
  onClose: () => void;
  onOpen: (d: Drill) => void;
  onKill: (id: string) => void;
  killing: string | null;
  onAnswer: (runId: string) => void;
}) {
  // The trace loads beside the drill rather than inside it: renderDrill is a
  // pure function of what is already known, and a waterfall needs a fetch.
  const runInView = drill.kind === "run" ? drill.id : drill.kind === "span" ? drill.run : null;
  const { trace, state: traceState } = useTrace(runInView);
  const refusals = useRefusals(drill.kind === "kpi" && drill.which === "denials");
  const { title, body } = renderDrill(drill, data, onOpen, onKill, killing, trace, traceState, refusals, onAnswer);
  return (
    // A modal over the room: the backdrop is a click target — empty space
    // closes the drill-down, Esc steps back one level.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[82vh] w-[min(560px,94vw)] flex-col overflow-hidden rounded-lg border border-line bg-surface elev-3 af-pop"
      >
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-raise/55 px-3">
          {depth > 1 && (
            <IconButton size="sm" label="Back" onClick={onBack}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </IconButton>
          )}
          <span className="min-w-0 truncate text-[12.5px] font-semibold text-fg">{title}</span>
          <span className="grow" />
          <IconButton size="sm" label="Close" onClick={onClose}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </IconButton>
        </div>
        <div className="min-h-0 grow overflow-y-auto">{body}</div>
      </div>
    </div>
  );
}

function RunList({
  runs,
  onOpen,
  empty,
}: {
  runs: RunRow[];
  onOpen: (d: Drill) => void;
  empty: string;
}) {
  if (!runs.length) return <p className="px-4 py-5 text-[12px] text-faint">{empty}</p>;
  return (
    <div className="flex flex-col">
      {runs.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onOpen({ kind: "run", id: r.id })}
          className="focusable flex cursor-pointer items-center gap-2.5 border-b border-line px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-raise/50"
        >
          <span className={`size-1.5 shrink-0 rounded-[2px] ${DOT_BG[r.state] ?? "bg-line-strong"}`} />
          <span className="flex min-w-0 grow flex-col">
            <span className="truncate text-[12px] font-medium text-fg">{r.system}</span>
            <span className="truncate font-mono text-[9.5px] text-faint">
              {r.state} · {fmtMs(r.ms)} · {fmtCost(r.cost)}
              {r.denials > 0 ? ` · ${r.denials} denied` : ""}
            </span>
          </span>
          <span className="shrink-0 text-[10px] whitespace-nowrap text-ghost">{ago(r.at)}</span>
        </button>
      ))}
    </div>
  );
}

function Fact({ k, v, tone }: { k: string; v: React.ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2">
      <span className="text-[11.5px] text-faint">{k}</span>
      <span className={`tnum text-[12.5px] font-medium ${tone ?? "text-fg"}`}>{v}</span>
    </div>
  );
}

function renderDrill(
  drill: Drill,
  data: ControlData,
  onOpen: (d: Drill) => void,
  onKill: (id: string) => void,
  killing: string | null,
  trace: import("./waterfall").Trace | null,
  traceState: "idle" | "loading" | "failed",
  refusals:
    | { control: string; run: string; agent: string; node: string; title: string; detail: string; at: string }[]
    | null,
  onAnswer: (runId: string) => void,
): { title: string; body: React.ReactNode } {
  const runs = data.runs;

  if (drill.kind === "span") {
    return { title: drill.span.name, body: <SpanDetail span={drill.span} /> };
  }

  if (drill.kind === "run") {
    const r = runs.find((x) => x.id === drill.id);
    const isLive = data.live.some((l) => l.id === drill.id);
    if (!r && isLive) {
      const l = data.live.find((x) => x.id === drill.id)!;
      return {
        title: `Run · ${l.system}`,
        body: (
          <div className="flex flex-col">
            <Fact k="State" v={<Status tone="run">running</Status>} />
            <Fact k="Started" v={ago(l.startedAt)} />
            <Fact k="Run file" v={<Mono className="text-[10px]">{l.id}</Mono>} />
            <div className="flex gap-2 px-4 py-3">
              <Button size="sm" variant="solid" tone="ink" href={`/runs?agent=${encodeURIComponent(l.system)}`}>
                Open theater
              </Button>
              <KillButton id={l.id} label="Kill this run" busy={killing === l.id || killing === "*"} onKill={onKill} />
            </div>
            <p className="px-4 pb-4 text-[11px] leading-[1.5] text-faint">
              The journal is being written right now; the full record lands here the moment the
              run settles.
            </p>
          </div>
        ),
      };
    }
    if (!r) return { title: "Run", body: <p className="px-4 py-5 text-[12px] text-faint">This run has no record yet.</p> };
    return {
      title: `Run · ${r.system}`,
      body: (
        <div className="flex flex-col">
          <Fact k="State" v={<Status tone={STATE_TONE[r.state] ?? "queue"}>{r.state}</Status>} />
          {r.state === "killed" && <Fact k="Control" v={<ControlRef control={KILL_CONTROL} size="md" />} />}
          {r.denials > 0 && (
            <Fact
              k="Refused by"
              v={
                <span className="flex flex-wrap gap-1">
                  {[...new Set((trace?.spans ?? []).filter((sp) => sp.control && sp.level === "ERROR").map((sp) => String(sp.control)))].map((c) => (
                    <ControlRef key={c} control={c} size="md" />
                  ))}
                </span>
              }
            />
          )}
          {r.suspendedAt && <Fact k="Waiting at" v={<Mono className="text-[10.5px]">{r.suspendedAt}</Mono>} tone="text-warn" />}
          <Fact k="When" v={ago(r.at)} />
          <Fact k="Duration" v={fmtMs(r.ms)} />
          <Fact k="Cost" v={fmtCost(r.cost)} />
          <Fact k="Tokens" v={`${fmtTokens(r.tokens.in)} in · ${fmtTokens(r.tokens.out)} out`} />
          <Fact k="Calls" v={`${r.modelCalls} model · ${r.toolCalls} tool`} />
          {r.artifacts > 0 && <Fact k="Artifacts" v={String(r.artifacts)} />}
          {r.denials > 0 && <Fact k="Guardrail denials" v={String(r.denials)} tone="text-warn" />}
          {r.byModel.length > 0 && (
            <div className="border-b border-line px-4 py-2.5">
              <span className="text-[11px] font-semibold text-dim">By model</span>
              {r.byModel.map((b) => (
                <div key={b.model} className="mt-1.5 flex items-center gap-2">
                  <span className={`size-1.5 shrink-0 rounded-[2px] ${b.model === "scripted" ? "bg-ok" : "bg-run"}`} />
                  <span className="min-w-0 grow truncate font-mono text-[10.5px] text-mist">{b.model}</span>
                  <span className="tnum text-[10.5px] text-dim">{fmtTokens(b.in + b.out)}</span>
                  <span className="tnum w-14 text-right text-[10.5px] text-mist">{fmtCost(b.cost)}</span>
                </div>
              ))}
            </div>
          )}
          {/* The trace, where the run already is. Every bar opens the span. */}
          <div className="border-b border-line">
            <div className="flex items-center gap-2 px-4 pt-2.5 pb-1">
              <span className="text-[11px] font-semibold text-dim">Trace</span>
              <span className="text-[10.5px] text-faint">
                {traceState === "loading"
                  ? "reading the journal…"
                  : traceState === "failed"
                    ? "no journal for this run"
                    : "click a span"}
              </span>
            </div>
            {trace && <Waterfall trace={trace} onPick={(sp) => onOpen({ kind: "span", run: r.id, span: sp })} />}
          </div>
          <div className="flex flex-wrap gap-2 px-4 py-3">
            <Button size="sm" variant="solid" tone="ink" href={`/runs?id=${encodeURIComponent(r.id)}`}>
              Open in theater
            </Button>
            <Button size="sm" variant="quiet" href={`/api/observability/export?run=${encodeURIComponent(r.id)}`}>
              OpenTelemetry payload
            </Button>
            {r.state === "suspended" && (
              <Button size="sm" variant="outline" tone="warn" onClick={() => onAnswer(r.id)}>
                Answer the gate
              </Button>
            )}
          </div>
        </div>
      ),
    };
  }

  if (drill.kind === "agent") {
    const a = data.agents.find((x) => x.id === drill.id);
    if (!a) return { title: "Agent", body: null };
    const mine = runs.filter((r) => r.system === a.id);
    const costByModel = new Map<string, { tokens: number; cost: number | null }>();
    for (const r of mine) {
      for (const b of r.byModel) {
        const agg = costByModel.get(b.model) ?? { tokens: 0, cost: 0 };
        agg.tokens += b.in + b.out;
        agg.cost = agg.cost === null || b.cost === null ? null : agg.cost + b.cost;
        costByModel.set(b.model, agg);
      }
    }
    return {
      title: a.name,
      body: (
        <div className="flex flex-col">
          {a.description && (
            <p className="border-b border-line px-4 py-3 text-[12px] leading-[1.55] text-dim">{a.description}</p>
          )}
          <Fact
            k="Status"
            v={
              a.active > 0 ? <Status tone="run">{a.active} live</Status> : a.deployed_at ? <Status tone="ok">Deployed {ago(a.deployed_at)}</Status> : <Status tone="queue">Saved, not deployed</Status>
            }
          />
          <Fact k="Runs" v={`${a.runs7d} in ${data.window} · ${a.runsTotal} total`} />
          <Fact k={`Avg time · ${data.window}`} v={fmtMs(a.avgMs7d)} />
          <Fact k={`Spend · ${data.window}`} v={fmtCost(a.cost7d)} />
          {a.pending > 0 && <Fact k="Awaiting approval" v={String(a.pending)} tone="text-warn" />}

          {a.evals.length > 0 && (
            <div className="border-b border-line px-4 py-2.5">
              <span className="text-[11px] font-semibold text-dim">Benchmark history</span>
              {a.evals.map((e, i) => (
                <div key={i} className="mt-1.5 flex items-center gap-2 text-[11px]">
                  <span className={`tnum font-semibold ${e.passed === e.total ? "text-ok" : "text-warn"}`}>
                    {e.passed}/{e.total}
                  </span>
                  <Mono className="min-w-0 truncate text-[9.5px] text-faint">{e.model}</Mono>
                  <Mono className="text-[9.5px] text-ghost">spec {e.digest.slice(0, 8)}</Mono>
                  <span className="ml-auto shrink-0 text-[9.5px] text-ghost">{ago(e.at)}</span>
                </div>
              ))}
            </div>
          )}

          {costByModel.size > 0 && (
            <div className="border-b border-line px-4 py-2.5">
              <span className="text-[11px] font-semibold text-dim">Models this agent used</span>
              {[...costByModel.entries()].map(([m, agg]) => (
                <div key={m} className="mt-1.5 flex items-center gap-2">
                  <span className={`size-1.5 shrink-0 rounded-[2px] ${m === "scripted" ? "bg-ok" : "bg-run"}`} />
                  <span className="min-w-0 grow truncate font-mono text-[10.5px] text-mist">{m}</span>
                  <span className="tnum text-[10.5px] text-dim">{fmtTokens(agg.tokens)}</span>
                  <span className="tnum w-14 text-right text-[10.5px] text-mist">{fmtCost(agg.cost)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 px-4 py-3">
            <Button size="sm" variant="solid" tone="ink" href={`/runs?agent=${encodeURIComponent(a.id)}`}>
              Run
            </Button>
            <Button size="sm" variant="outline" href={`/builder?load=${encodeURIComponent(a.id)}`}>
              Open in Builder
            </Button>
            <Button size="sm" variant="outline" href={`/evals?agent=${encodeURIComponent(a.id)}`}>
              Benchmark
            </Button>
          </div>

          <div className="border-t border-line">
            <p className="px-4 pt-3 pb-1 text-[11px] font-semibold text-dim">Recent runs</p>
            <RunList runs={mine.slice(0, 12)} onOpen={onOpen} empty="No recorded runs yet." />
          </div>
        </div>
      ),
    };
  }

  if (drill.kind === "day") {
    const d = data.days.find((x) => x.day === drill.day);
    const dayRuns = runs.filter((r) => r.at.slice(0, 10) === drill.day);
    return {
      title: `Activity · ${drill.day}`,
      body: (
        <div className="flex flex-col">
          <Fact k="Runs" v={String(d?.runs ?? 0)} />
          <Fact k="Cost" v={fmtCost(d?.cost ?? null)} />
          {(d?.denials ?? 0) > 0 && <Fact k="Denials" v={String(d!.denials)} tone="text-warn" />}
          {(d?.kills ?? 0) > 0 && <Fact k="Kills" v={String(d!.kills)} tone="text-err" />}
          <Fact k="Avg time" v={fmtMs(d?.avgMs ?? null)} />
          <RunList runs={dayRuns} onOpen={onOpen} empty="A quiet day — no runs recorded." />
        </div>
      ),
    };
  }

  if (drill.kind === "model") {
    const m = data.models.find((x) => x.model === drill.id);
    const modelRuns = runs.filter((r) => r.models.includes(drill.id));
    return {
      title: drill.id,
      body: (
        <div className="flex flex-col">
          <Fact k="Where it runs" v={m?.local ? "no model, $0" : "Azure AI Foundry"} tone={m?.local ? "text-ok" : undefined} />
          <Fact k={`Tokens · ${data.window}`} v={m ? `${fmtTokens(m.in)} in · ${fmtTokens(m.out)} out` : "—"} />
          <Fact k={`Cost · ${data.window}`} v={fmtCost(m?.cost ?? null)} />
          <Fact k="Runs that used it" v={String(m?.runs ?? modelRuns.length)} />
          <p className="px-4 pt-3 pb-1 text-[11px] font-semibold text-dim">Runs</p>
          <RunList runs={modelRuns.slice(0, 15)} onOpen={onOpen} empty="No recent runs used this model." />
        </div>
      ),
    };
  }

  // KPI drills — the records behind the tile.
  const since = data.now - winMs(data.window);
  const recent = runs.filter((r) => new Date(r.at).getTime() >= since);
  switch (drill.which) {
    case "deployed":
      return {
        title: "Agents",
        body: (
          <div className="flex flex-col">
            {data.agents.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onOpen({ kind: "agent", id: a.id })}
                className="focusable flex cursor-pointer items-center gap-2.5 border-b border-line px-4 py-2.5 text-left transition-colors last:border-b-0 hover:bg-raise/50"
              >
                <span className={`size-1.5 shrink-0 rounded-[2px] ${a.deployed_at ? "bg-ok" : "bg-line-strong"}`} />
                <span className="flex min-w-0 grow flex-col">
                  <span className="truncate text-[12px] font-medium text-fg">{a.name}</span>
                  <span className="truncate font-mono text-[9.5px] text-faint">
                    {a.deployed_at ? `deployed ${ago(a.deployed_at)}` : "saved, not deployed"}
                  </span>
                </span>
                <span className="text-[10px] text-ghost">{a.runs7d} runs · {data.window}</span>
              </button>
            ))}
          </div>
        ),
      };
    case "active":
      return {
        title: "Active runs",
        body: data.live.length ? (
          <div className="flex flex-col">
            {data.live.map((l) => (
              <div key={l.id} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-b-0">
                <button type="button" onClick={() => onOpen({ kind: "run", id: l.id })} className="focusable flex min-w-0 grow cursor-pointer flex-col text-left">
                  <span className="truncate text-[12px] font-medium text-fg">{l.system}</span>
                  <span className="truncate font-mono text-[9.5px] text-faint">{ago(l.startedAt)}</span>
                </button>
                <KillButton id={l.id} busy={killing === l.id || killing === "*"} onKill={onKill} />
              </div>
            ))}
          </div>
        ) : (
          <p className="px-4 py-5 text-[12px] text-faint">Nothing in flight right now.</p>
        ),
      };
    case "pending":
      return {
        title: "Awaiting approval",
        body: (
          <RunList
            runs={runs.filter((r) => r.state === "suspended")}
            onOpen={onOpen}
            empty="No gates are open. When a workflow suspends for a person, it appears here."
          />
        ),
      };
    case "runs":
      return { title: "Runs · 7 days", body: <RunList runs={recent} onOpen={onOpen} empty="No runs in the last week." /> };
    case "spend": {
      const priciest = [...recent].filter((r) => (r.cost ?? 0) > 0).sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0));
      return {
        title: "Spend · 7 days",
        body: (
          <div className="flex flex-col">
            <div className="border-b border-line px-4 py-2.5">
              <span className="text-[11px] font-semibold text-dim">By model</span>
              {data.models.map((m) => (
                <div key={m.model} className="mt-1.5 flex items-center gap-2">
                  <span className={`size-1.5 shrink-0 rounded-[2px] ${m.local ? "bg-ok" : "bg-run"}`} />
                  <span className="min-w-0 grow truncate font-mono text-[10.5px] text-mist">{m.model}</span>
                  <span className="tnum w-14 text-right text-[10.5px] text-mist">{fmtCost(m.cost)}</span>
                </div>
              ))}
            </div>
            <p className="px-4 pt-3 pb-1 text-[11px] font-semibold text-dim">Costliest runs</p>
            <RunList runs={priciest.slice(0, 10)} onOpen={onOpen} empty="Every recent run cost $0 — all local." />
          </div>
        ),
      };
    }
    case "time": {
      const slowest = [...recent].sort((a, b) => b.ms - a.ms);
      // An average hides the tail, and the tail is what a person waits through.
      const sorted = recent.map((r) => r.ms).sort((a, b) => a - b);
      const at = (p: number) =>
        sorted.length ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] : 0;
      return {
        title: "Run time · 7 days",
        body: (
          <div className="flex flex-col">
            <Fact k="Median" v={fmtMs(at(50))} />
            <Fact k="95th percentile" v={fmtMs(at(95))} />
            <Fact k="99th percentile" v={fmtMs(at(99))} />
            <Fact k="Slowest" v={fmtMs(sorted[sorted.length - 1] ?? 0)} />
            <div className="px-4 pt-2.5 pb-1">
              <span className="text-[11px] font-semibold text-dim">Slowest runs</span>
            </div>
            <RunList runs={slowest.slice(0, 12)} onOpen={onOpen} empty="No runs in the last week." />
          </div>
        ),
      };
    }
    case "denials": {
      const hard = (refusals ?? []).filter((x) => x.control !== "taint" && x.control !== "gate");
      return {
        title: "Guardrail denials",
        body: (
          <div className="flex flex-col">
            {refusals === null && (
              <p className="px-4 py-3 text-[11.5px] text-faint">Reading the journals…</p>
            )}
            {refusals !== null && hard.length === 0 && (
              <p className="px-4 py-4 text-[12px] leading-[1.55] text-faint">
                Nothing has been refused on this deployment. That is the controls having nothing to
                stop rather than the controls being off — the Guardrails page shows which are
                running and how often each has fired.
              </p>
            )}
            {hard.map((x, i) => {
              const why = explainControl(x.control);
              return (
                <button
                  key={`${x.run}-${i}`}
                  type="button"
                  onClick={() => onOpen({ kind: "run", id: x.run })}
                  className="focusable flex flex-col gap-1 border-b border-line px-4 py-2.5 text-left last:border-0 hover:bg-raise/40"
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <Status tone="err">{why.name}</Status>
                    <ControlRef control={x.control} />
                    <span className="min-w-0 grow truncate text-[12px] text-fg">{x.title}</span>
                  </span>
                  {/* The rule itself, in full. A denial you have to go and look
                      up is a denial nobody reviews. */}
                  {x.detail && <span className="text-[11.5px] leading-[1.5] text-mist">{x.detail}</span>}
                  <span className="flex items-baseline gap-2 text-[10.5px] text-faint">
                    <span>{x.agent}</span>
                    {x.node && <Mono className="text-[10px]">{x.node}</Mono>}
                    <span className="grow" />
                    <span>{ago(x.at)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ),
      };
    }
    case "kills":
      return {
        title: "Killed runs · 7 days",
        body: (
          <div className="flex flex-col">
            <div className="flex flex-col gap-1.5 border-b border-line px-4 py-3">
              <span className="flex flex-wrap items-center gap-2">
                <Status tone="err">kill switch</Status>
                <ControlRef control={KILL_CONTROL} size="md" />
              </span>
              <span className="text-[11px] leading-[1.5] text-faint">
                Every kill is an operator decision the runtime traps, journals and persists as a partial
                record. The run below is the evidence that control produces.
              </span>
            </div>
            <RunList
              runs={recent.filter((r) => r.state === "killed")}
              onOpen={onOpen}
              empty="No kills this week. When an operator throws the switch, the journalled decision lands here."
            />
          </div>
        ),
      };
  }
}

/* ═══════════════════ the optimizing triangle ═══════════════════ */

interface Corner {
  model: string;
  local: boolean;
  costPerRun: number | null;
  avgMs: number | null;
  passRate: number | null;
  evalCases: number;
  runs: number;
  /** 0..1 per axis, relative to the estate in view; null when there is no evidence. */
  score: { cost: number | null; accuracy: number | null; time: number | null };
  overall: number;
  known: number;
}

/**
 * Cost, accuracy and time are the three things every model choice trades
 * between, and they cannot all be maximised at once. Each model gets its own
 * triangle: a reference outline is the ideal, and the filled shape inside it
 * is the model's actual profile, one vertex per axis. A full triangle is a
 * model good at everything; a shape leaning to one corner is a trade-off you
 * can read at a glance, and two models side by side compare as shapes before
 * anyone reads a number.
 *
 * Scores are relative to the estate in view (cheapest = 1, slowest = 0,
 * accuracy = eval pass rate on that model), so the panel answers "which of my
 * models" rather than making an absolute claim.
 */
function cornersOf(models: ModelRow[], runs: RunRow[], agents: AgentRow[]): Corner[] {
  const raw = models.map((m) => {
    const used = runs.filter((r) => r.models.includes(m.model) && r.ms > 0);
    const evals = agents.flatMap((a) => a.evals.filter((e) => e.model === m.model));
    const total = evals.reduce((s, e) => s + e.total, 0);
    return {
      model: m.model,
      local: m.local,
      runs: m.runs,
      costPerRun: m.cost === null ? null : m.cost / Math.max(1, m.runs),
      avgMs: used.length ? used.reduce((s, r) => s + r.ms, 0) / used.length : null,
      passRate: total ? evals.reduce((s, e) => s + e.passed, 0) / total : null,
      evalCases: total,
    };
  });
  // Log scale against the best in view, two decades wide: the cheapest or
  // fastest model scores 1, ten times worse scores 0.5, a hundred times worse
  // scores 0. Halving a bar always means the same thing, and the worst model
  // still has a shape instead of collapsing to a point. Zero (local) is best.
  const bestCost = bestOf(raw.map((r) => r.costPerRun));
  const bestMs = bestOf(raw.map((r) => r.avgMs));
  return raw.map((r) => {
    const score = {
      cost: logScore(r.costPerRun, bestCost),
      accuracy: r.passRate,
      time: logScore(r.avgMs, bestMs),
    };
    const known = [score.cost, score.accuracy, score.time].filter((v): v is number => v !== null);
    return {
      ...r,
      score,
      known: known.length,
      overall: known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0,
    };
  });
}

function TradeoffTriangle({
  models,
  runs,
  agents,
  selected,
  onPick,
}: {
  models: ModelRow[];
  runs: RunRow[];
  agents: AgentRow[];
  selected: string | null;
  onPick: (id: string) => void;
}) {
  const [view, setView] = useState<"profiles" | "table">("profiles");
  const corners = cornersOf(models, runs, agents);
  const colorOf = new Map(corners.map((c, i) => [c.model, CAT[i % CAT.length]]));
  const ranked = [...corners].sort((a, b) => b.overall - a.overall || b.known - a.known);
  const short = (id: string) => id.split("/").pop() ?? id;

  // Superlatives: computed over models that have evidence on that axis.
  const best = (pick: (c: Corner) => number | null, dir: 1 | -1) => {
    const have = corners.filter((c) => pick(c) !== null);
    if (have.length < 2) return null;
    return have.reduce((b, c) => ((pick(c)! - pick(b)!) * dir > 0 ? c : b)).model;
  };
  const cheapest = best((c) => c.costPerRun, -1);
  const mostAccurate = best((c) => c.passRate, 1);
  const fastest = best((c) => c.avgMs, -1);
  const balanced = ranked.find((c) => c.known >= 2)?.model ?? null;

  const axes = [
    { key: "accuracy", label: "Accuracy", sub: "eval pass rate" },
    { key: "cost", label: "Cost", sub: "cheaper per run" },
    { key: "time", label: "Time", sub: "faster wall clock" },
  ] as const;

  return (
    <>
      <PanelHead
        title="Cost · accuracy · time"
        meta="7 days — one triangle per model"
        right={
          <Button size="sm" variant="quiet" onClick={() => setView(view === "profiles" ? "table" : "profiles")}>
            {view === "profiles" ? "Table" : "Profiles"}
          </Button>
        }
      />
      {view === "table" ? (
        <div className="overflow-x-auto">
          <table className="tnum w-full text-[11px]">
            <thead>
              <tr className="text-left text-[10px] text-faint">
                <th className="px-3 py-1.5 font-medium">model</th>
                <th className="px-2 py-1.5 text-right font-medium">cost / run</th>
                <th className="px-2 py-1.5 text-right font-medium">eval pass</th>
                <th className="px-2 py-1.5 text-right font-medium">avg time</th>
                <th className="px-3 py-1.5 text-right font-medium">runs</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((c) => (
                <tr key={c.model} className="border-t border-line text-dim">
                  <td className="px-3 py-1.5 font-mono text-[10.5px] text-fg">{c.model}</td>
                  <td className="px-2 py-1.5 text-right">{fmtCost(c.costPerRun)}</td>
                  <td className="px-2 py-1.5 text-right">
                    {c.passRate === null ? "no evals" : `${Math.round(c.passRate * 100)}% · ${c.evalCases}`}
                  </td>
                  <td className="px-2 py-1.5 text-right">{fmtMs(c.avgMs)}</td>
                  <td className="px-3 py-1.5 text-right">{c.runs}</td>
                </tr>
              ))}
              {!corners.length && (
                <tr><td colSpan={5} className="px-3 py-3 text-faint">No model calls in the last 7 days.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex flex-col">
          {/* the key: the three corners, stated once */}
          <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 border-b border-line px-3 py-2.5">
            <TriangleGlyph score={{ cost: 1, accuracy: 1, time: 1 }} color="var(--t-fg-4)" size={54} />
            <div className="flex flex-wrap gap-x-4 gap-y-0.5">
              {axes.map((a) => (
                <span key={a.key} className="flex items-baseline gap-1.5 text-[10.5px]">
                  <span className="font-semibold text-fg">{a.label}</span>
                  <span className="text-faint">{a.sub}</span>
                </span>
              ))}
              <span className="basis-full text-[10px] leading-[1.5] text-faint">
                The outline is the ideal. The shape inside is the model. Dashed corner: no evidence on that axis yet.
              </span>
            </div>
          </div>

          {!ranked.length && (
            <p className="px-3 py-4 text-[12px] text-faint">No model calls in the last 7 days.</p>
          )}

          <div className="flex flex-col">
            {ranked.map((c, i) => {
              const color = colorOf.get(c.model)!;
              const badges = [
                c.model === balanced && corners.length > 1 ? { t: "best balance", tone: "ok" as const } : null,
                c.model === cheapest ? { t: "cheapest", tone: "neutral" as const } : null,
                c.model === mostAccurate ? { t: "most accurate", tone: "neutral" as const } : null,
                c.model === fastest ? { t: "fastest", tone: "neutral" as const } : null,
              ].filter((b): b is { t: string; tone: "ok" | "neutral" } => b !== null);
              const isSel = selected === c.model;
              const rows = [
                { k: "Accuracy", v: c.passRate === null ? "no evals" : `${Math.round(c.passRate * 100)}%`, s: c.score.accuracy, sub: c.passRate === null ? "" : `${c.evalCases} cases` },
                { k: "Cost", v: fmtCost(c.costPerRun), s: c.score.cost, sub: c.local ? "local" : "per run" },
                { k: "Time", v: fmtMs(c.avgMs), s: c.score.time, sub: c.avgMs === null ? "" : "avg run" },
              ];
              return (
                <button
                  key={c.model}
                  type="button"
                  onClick={() => onPick(c.model)}
                  aria-pressed={isSel}
                  className={`focusable grid cursor-pointer grid-cols-[96px_minmax(0,1fr)] items-center gap-x-3 border-b border-line px-3 py-2.5 text-left transition-colors ${
                    isSel ? "bg-raise/80" : "hover:bg-raise/50"
                  }`}
                >
                  <TriangleGlyph score={c.score} color={color} size={96} />

                  <span className="flex min-w-0 flex-col gap-1.5">
                    <span className="flex items-center gap-2">
                      <span className="tnum shrink-0 font-mono text-[10px] text-ghost">#{i + 1}</span>
                      <span className="min-w-0 truncate font-mono text-[11.5px] font-medium text-fg" title={c.model}>
                        {short(c.model)}
                      </span>
                      <span className="grow" />
                      {badges.map((b) => (
                        <Tag key={b.t} tone={b.tone}>{b.t}</Tag>
                      ))}
                    </span>

                    {rows.map((row) => (
                      <span key={row.k} className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-x-2">
                        <span className="text-[10px] text-faint">{row.k}</span>
                        <span className="h-1.5 overflow-hidden rounded-full bg-raise">
                          <span
                            className="block h-full rounded-full transition-[width] duration-[260ms] ease-[var(--ease-out)]"
                            style={{ width: `${Math.round((row.s ?? 0) * 100)}%`, background: row.s === null ? "transparent" : color }}
                          />
                        </span>
                        <span className="flex items-baseline gap-1 whitespace-nowrap">
                          <span className={`tnum w-14 text-right text-[11.5px] font-semibold ${row.s === null ? "text-ghost" : "text-fg"}`}>{row.v}</span>
                          <span className="w-12 truncate text-[9.5px] text-ghost">{row.sub}</span>
                        </span>
                      </span>
                    ))}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="px-3 py-2 text-[10.5px] leading-[1.5] text-faint">
            Cost and Time bars are log-scaled against the best model in view: full is the best, half is ten
            times worse, empty is a hundred times worse. Accuracy is the eval pass rate measured on that model.
            Click a model for the runs behind it.
          </p>
        </div>
      )}
    </>
  );
}

/* ═══════════════════ the trigger queue ═══════════════════ */

interface QueueData {
  agents: Record<string, { queued?: number; running?: number; done?: number; failed?: number; suspended?: number; oldest_queued?: string | null }>;
  workers: { name: string; running: number; lease_until: string }[];
  last_hour: { finished: number; failed: number; avg_ms: number | null };
}

/**
 * The intake, as numbers. Depth is the honest measure of "always on": a
 * queue that grows is a provider or a worker pool that cannot keep up, and
 * the oldest queued age says how far behind the estate is right now.
 */
function QueuePanel({ queue, now }: { queue: QueueData | null; now: number }) {
  if (!queue) return <p className="px-3 py-4 text-[12px] text-faint">The queue needs the registry database.</p>;
  const rows = Object.entries(queue.agents);
  const age = (iso: string | null | undefined) => {
    if (!iso) return "";
    const s = (now - new Date(iso).getTime()) / 1000;
    return s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`;
  };
  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-3 divide-x divide-line border-b border-line">
        {[
          ["finished · 1h", String(queue.last_hour.finished)],
          ["failed · 1h", String(queue.last_hour.failed)],
          ["avg run", fmtMs(queue.last_hour.avg_ms)],
        ].map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5 px-3 py-2">
            <span className="text-[10px] text-faint">{k}</span>
            <span className="tnum text-[16px] leading-none font-semibold">{v}</span>
          </div>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-[11.5px] text-faint">Nothing posted in the last hour. External systems post to /api/trigger/&lt;agent&gt;.</p>
      ) : (
        <div className="flex flex-col">
          <div className="grid grid-cols-[minmax(0,1fr)_repeat(4,52px)] items-center gap-1 border-b border-line px-3 py-1.5 text-[10px] text-faint">
            <span>agent</span>
            <span className="text-right">queued</span>
            <span className="text-right">running</span>
            <span className="text-right">done</span>
            <span className="text-right">failed</span>
          </div>
          {rows.map(([agent, a]) => (
            <div key={agent} className="grid grid-cols-[minmax(0,1fr)_repeat(4,52px)] items-center gap-1 border-b border-line px-3 py-2 text-[11.5px] last:border-b-0">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="truncate font-mono text-[11px] text-fg">{agent}</span>
                {a.oldest_queued && <span className="shrink-0 text-[10px] text-warn">oldest {age(a.oldest_queued)}</span>}
              </span>
              <span className={`tnum text-right ${(a.queued ?? 0) > 0 ? "font-semibold text-warn" : "text-dim"}`}>{a.queued ?? 0}</span>
              <span className={`tnum text-right ${(a.running ?? 0) > 0 ? "font-semibold text-run" : "text-dim"}`}>{a.running ?? 0}</span>
              <span className="tnum text-right text-dim">{a.done ?? 0}</span>
              <span className={`tnum text-right ${(a.failed ?? 0) > 0 ? "font-semibold text-err" : "text-dim"}`}>{a.failed ?? 0}</span>
            </div>
          ))}
        </div>
      )}
      {queue.workers.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-3 py-2">
          {queue.workers.map((w) => (
            <span key={w.name} className="flex items-center gap-1.5 text-[10.5px] text-dim">
              <span className="size-1.5 rounded-[2px] bg-run" />
              <span className="font-mono">{w.name}</span>
              <span className="text-faint">{w.running} in flight</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
