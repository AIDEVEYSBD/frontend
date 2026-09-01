"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Mono, Status } from "./ui";
import { Sparkline } from "./data";
import { Icon } from "./builder/icons";

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
  finops: { credits: { total: number; used: number } | null; budget: number | null; spend7d: number | null };
  ledger: { entries: number; runs: number; lastWrite: string | null };
  totals: {
    deployed: number;
    registered: number;
    active: number;
    pending: number;
    runs7d: number;
    cost7d: number | null;
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
}

type Drill =
  | { kind: "kpi"; which: "deployed" | "active" | "pending" | "runs" | "spend" | "time" | "denials" | "kills" }
  | { kind: "agent"; id: string }
  | { kind: "day"; day: string }
  | { kind: "model"; id: string }
  | { kind: "run"; id: string };

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

export function Control() {
  const router = useRouter();
  const [data, setData] = useState<ControlData | null>(null);
  const [error, setError] = useState("");
  const [confirmAll, setConfirmAll] = useState(false);
  const [stack, setStack] = useState<Drill[]>([]);
  const [stageNotice, setStageNotice] = useState<string | null>(null);
  const [deployingId, setDeployingId] = useState<string | null>(null);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drill = stack[stack.length - 1] ?? null;

  const notice = useCallback((msg: string) => {
    setStageNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setStageNotice(null), 3200);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/control");
      const d = await res.json();
      if (d.error) throw new Error(String(d.error));
      setData(d);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [load]);

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

  const kill = useCallback(
    async (id?: string) => {
      await fetch("/api/kill", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(id ? { id } : { all: true }),
      }).catch(() => {});
      load();
    },
    [load],
  );

  const t = data?.totals;
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
            Every figure on this page is computed from primary records, and every figure opens.
            Click anything.
          </p>
        </div>
        <span className="grow" />
        <LogExport />
        {t && t.active > 0 && (
          <button
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
            className={`focusable flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
              confirmAll ? "border-err bg-err text-on-solid" : "border-err/40 bg-err-bg text-err hover:border-err"
            }`}
          >
            <span className={`size-1.5 rounded-[2px] ${confirmAll ? "bg-on-solid" : "bg-err"}`} />
            {confirmAll ? `Really stop ${t.active} run${t.active === 1 ? "" : "s"}?` : "Kill all runs"}
          </button>
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
        <Kpi label="Runs · 7d" value={t ? String(t.runs7d) : "…"} sub="every journal counted"
          spark={data?.days.map((d) => d.runs)} active={drill?.kind === "kpi" && drill.which === "runs"}
          onOpen={() => open({ kind: "kpi", which: "runs" })} />
        <Kpi label="Spend · 7d" value={t ? fmtCost(t.cost7d) : "…"} sub={t ? `${fmtTokens(t.tokens7d)} tokens` : ""}
          spark={data?.days.map((d) => d.cost ?? 0)} active={drill?.kind === "kpi" && drill.which === "spend"}
          onOpen={() => open({ kind: "kpi", which: "spend" })} />
        <Kpi label="Avg run time" value={t ? fmtMs(t.avgMs7d) : "…"} sub="wall clock, 7d"
          spark={data?.days.map((d) => d.avgMs ?? 0)} active={drill?.kind === "kpi" && drill.which === "time"}
          onOpen={() => open({ kind: "kpi", which: "time" })} />
        <Kpi label="Guardrail denials" value={t ? String(t.denials7d) : "…"} sub="policy said no"
          tone={t?.denials7d ? "warn" : undefined} spark={data?.days.map((d) => d.denials)}
          active={drill?.kind === "kpi" && drill.which === "denials"} onOpen={() => open({ kind: "kpi", which: "denials" })} />
        <Kpi label="Kills · 7d" value={t ? String(t.kills7d) : "…"} sub="operator decisions"
          tone={t?.kills7d ? "err" : undefined} spark={data?.days.map((d) => d.kills)}
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
                  <span className="text-[9.5px] font-semibold tracking-wide text-dim uppercase">{s.label}</span>
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
                  <button
                    onClick={() => open({ kind: "agent", id: a.id })}
                    className="focusable w-fit max-w-full cursor-pointer truncate rounded-sm text-left text-[12px] font-medium text-fg hover:underline"
                  >
                    {a.name}
                  </button>
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
                        onClick={() => stageAction(a, s.id)}
                        title={hint}
                        aria-label={`${a.name} — ${hint}`}
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
      </section>

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
        {/* ── The estate ── */}
        <section className="flex h-fit flex-col overflow-hidden rounded-md border border-line bg-surface">
          <PanelHead title="Estate" meta="every agent, its whole record — click a row" />
          <div className="overflow-x-auto">
            <div className="min-w-[820px]">
              <div className="grid grid-cols-[minmax(170px,1.4fr)_96px_120px_130px_86px_86px_72px] items-center gap-3 border-b border-line px-4 py-2">
                {["Agent", "Status", "Benchmark", "Health · last 14", "Avg time", "Spend · 7d", ""].map((h, i) => (
                  <span key={i} className="text-[11px] font-semibold text-dim">{h}</span>
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
                      {a.id} · {a.nodes} node{a.nodes === 1 ? "" : "s"} · {a.runs7d} run{a.runs7d === 1 ? "" : "s"} 7d
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
                        onClick={(e) => {
                          e.stopPropagation();
                          open({ kind: "run", id: tk.id });
                        }}
                        title={`${tk.state} · ${ago(tk.at)}`}
                        aria-label={`Run ${tk.state} ${ago(tk.at)}`}
                        className={`focusable h-3.5 w-[6px] cursor-pointer rounded-[1.5px] transition-transform hover:scale-y-125 ${DOT_BG[tk.state] ?? "bg-line-strong"}`}
                      />
                    ))}
                  </span>

                  <span className="tnum text-[12.5px] text-mist">{fmtMs(a.avgMs7d)}</span>
                  <span className="tnum text-[12.5px] text-mist">{fmtCost(a.cost7d)}</span>

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
                  onClick={() => open({ kind: "run", id: r.id })}
                  className="focusable flex min-w-0 grow cursor-pointer flex-col text-left"
                >
                  <span className="truncate text-[12.5px] font-medium text-fg">{r.system}</span>
                  <span className="truncate font-mono text-[10px] text-faint">{r.id} · {ago(r.startedAt)}</span>
                </button>
                <Button size="sm" variant="outline" tone="err" onClick={() => kill(r.id)}>
                  Kill
                </Button>
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
                    onClick={() => open({ kind: "run", id: r.id })}
                    className="focusable flex min-w-0 grow cursor-pointer flex-col text-left"
                  >
                    <span className="truncate text-[12.5px] font-medium text-fg">{r.system}</span>
                    <span className="truncate font-mono text-[10px] text-warn">
                      paused at {r.suspendedAt || "a gate"} · {ago(r.at)}
                    </span>
                  </button>
                  <Button size="sm" variant="outline" tone="warn" href={`/runs?agent=${encodeURIComponent(r.system)}`}>
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
                { label: "Gates answered", value: (data?.runs ?? []).filter((r) => new Date(r.at).getTime() >= Date.now() - 7 * 86_400_000 && r.state === "done").length, tone: "text-fg", drill: "runs" as const },
              ].map((g) => (
                <button
                  key={g.label}
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
          <FinOpsPanel finops={data?.finops ?? null} onSaved={load} />
        </div>
      </div>

      {/* ── The lower boards: one masonry flow. Columns pack panels by their
          real height — no panel is ever stretched to a neighbour's, so there
          is no void to stretch into. ── */}
      <div className="mt-4 gap-4 md:columns-2 xl:columns-3">
        <section className="mb-4 flex break-inside-avoid flex-col overflow-hidden rounded-md border border-line bg-surface">
          <PanelHead title="Activity" meta="14 days — click a day" right={<Mono className="text-[10px] text-ghost">{t ? `${fmtCost(t.cost7d)} · 7d` : ""}</Mono>} />
          <ActivityChart days={data?.days ?? []} selected={drill?.kind === "day" ? drill.day : null} onPick={(day) => open({ kind: "day", day })} />
        </section>

        <section className="mb-4 flex break-inside-avoid flex-col overflow-hidden rounded-md border border-line bg-surface">
          <PanelHead title="Model mix" meta="7 days — click a model" />
          <ModelMix models={data?.models ?? []} onPick={(id) => open({ kind: "model", id })} selected={drill?.kind === "model" ? drill.id : null} />
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
                    className="focusable shrink-0 rounded-sm p-1 text-faint transition-colors hover:text-fg"
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

        {/* Model gateway — per-node routing across the estate */}
        <section className="mb-4 flex break-inside-avoid flex-col overflow-hidden rounded-md border border-line bg-surface">
          <PanelHead title="Model gateway" meta="per-node routing" />
          <div className="max-h-[260px] overflow-y-auto">
            {(data?.routing ?? []).map((r, i) => (
              <div key={i} className="flex items-center gap-2 border-b border-line px-3 py-1.5 last:border-b-0">
                <span className="min-w-0 truncate font-mono text-[10px] text-faint">
                  {r.agent} · <span className="text-mist">{r.node}</span>
                </span>
                <span className="grow" />
                {r.model ? (
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span className={`size-1.5 rounded-[2px] ${r.model.startsWith("ollama/") ? "bg-ok" : "bg-run"}`} />
                    <Mono className="max-w-[140px] truncate text-[9.5px] text-fg">{r.model}</Mono>
                  </span>
                ) : (
                  <span className="shrink-0 text-[9.5px] text-ghost">deployment default</span>
                )}
              </div>
            ))}
            {data && data.routing.length === 0 && (
              <p className="px-3 py-4 text-[12px] text-faint">Nothing deployed yet.</p>
            )}
          </div>
          <p className="border-t border-line px-3 py-2 text-[10.5px] leading-[1.5] text-faint">
            Specs name a model per node, never a provider — the router decides where it runs.
          </p>
        </section>

        {/* Partner agents — A2A peers, card-pinged live */}
        <section className="mb-4 flex break-inside-avoid flex-col overflow-hidden rounded-md border border-line bg-surface">
          <PanelHead title="Partner agents" meta="A2A peers, card-pinged live" />
          {(data?.peers ?? []).map((p) => (
            <div key={`${p.name}@${p.url}`} className="flex items-center gap-2.5 border-b border-line px-3 py-2.5 last:border-b-0">
              <span className="relative flex size-2 shrink-0">
                {p.up && <span className="absolute inline-flex size-2 animate-ping rounded-full bg-ok opacity-50" />}
                <span className={`relative inline-flex size-2 rounded-full ${p.up ? "bg-ok" : "bg-err"}`} />
              </span>
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
                  <div className="mt-1 flex flex-col gap-1 rounded-md border border-warn-line bg-warn-bg px-2.5 py-2">
                    <span className="text-[11px] font-semibold text-warn">
                      {data.posture.ungated.length} sink{data.posture.ungated.length === 1 ? "" : "s"} without an approval gate
                    </span>
                    {data.posture.ungated.slice(0, 4).map((u, i) => (
                      <button
                        key={i}
                        onClick={() => open({ kind: "agent", id: u.agent })}
                        className="focusable w-fit cursor-pointer rounded-sm font-mono text-[10px] text-mist hover:text-fg"
                      >
                        {u.agent} · {u.node} · {u.tool}
                      </button>
                    ))}
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
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-md border border-line bg-surface px-4 py-2 text-[12px] text-fg elev-2">
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
        />
      )}
    </div>
  );
}

/* ═══════════════════ pieces ═══════════════════ */

/** FinOps: live gateway balance, this week's burn, and a budget to burn against. */
function FinOpsPanel({
  finops,
  onSaved,
}: {
  finops: ControlData["finops"] | null;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const remaining = finops?.credits ? finops.credits.total - finops.credits.used : null;
  const spend = finops?.spend7d ?? null;
  const burnPct =
    finops?.budget && spend !== null ? Math.min(100, (spend / Math.max(0.01, finops.budget)) * 100) : null;

  return (
    <section className="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
      <PanelHead title="FinOps" meta="live balance · burn vs budget" />
      <div className="grid grid-cols-3 divide-x divide-line border-b border-line">
        {[
          { label: "Credits left", value: remaining === null ? "—" : `$${remaining.toFixed(2)}`, tone: remaining !== null && remaining < 2 ? "text-warn" : "text-fg" },
          { label: "Spend · 7d", value: fmtCost(spend), tone: "text-fg" },
          { label: "Budget", value: finops?.budget != null ? `$${finops.budget.toFixed(2)}` : "unset", tone: "text-fg" },
        ].map((x) => (
          <div key={x.label} className="flex flex-col items-center gap-0.5 px-1 py-2.5">
            <span className={`tnum text-[15px] leading-none font-semibold ${x.tone}`}>{x.value}</span>
            <span className="text-[9.5px] text-faint">{x.label}</span>
          </div>
        ))}
      </div>
      {burnPct !== null && (
        <div className="flex flex-col gap-1 px-3 pt-2.5">
          <span className="flex justify-between text-[10px] text-faint">
            <span>burn vs budget</span>
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
              placeholder="weekly budget, USD"
              inputMode="decimal"
              autoFocus
              className="focusable h-7 w-32 rounded-sm border border-line bg-canvas px-2 text-[11.5px] text-fg placeholder:text-ghost"
            />
            <Button
              size="sm"
              variant="solid"
              tone="ink"
              onClick={async () => {
                const n = Number(value);
                if (!Number.isFinite(n) || n < 0) return;
                await fetch("/api/control", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ budget_usd: n }),
                }).catch(() => {});
                setEditing(false);
                onSaved();
              }}
            >
              Set
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <button
              onClick={() => {
                setValue(finops?.budget != null ? String(finops.budget) : "");
                setEditing(true);
              }}
              className="focusable cursor-pointer rounded-sm text-[11px] font-medium text-dim transition-colors hover:text-fg"
            >
              {finops?.budget != null ? "Change budget" : "Set a weekly budget"}
            </button>
            <span className="grow" />
            <span className="text-[10px] text-ghost">local models burn $0</span>
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
        Export logs
      </Button>
      {open && (
        <div className="absolute top-full right-0 z-40 mt-1.5 flex w-72 flex-col overflow-hidden rounded-md border border-line bg-surface elev-2">
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

function PanelHead({ title, meta, right, pulse }: { title: string; meta?: string; right?: React.ReactNode; pulse?: boolean }) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-raise/55 px-3">
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
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "run" | "warn" | "err";
  spark?: number[];
  active: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      aria-pressed={active}
      className={`focusable -mr-px -mb-px flex cursor-pointer flex-col gap-1 border-r border-b border-line px-3 py-2.5 text-left transition-colors ${
        active ? "bg-raise/80" : "hover:bg-raise/50"
      }`}
    >
      <span className="truncate text-[10.5px] text-faint">{label}</span>
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
    </button>
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
  return (
    <div className="flex flex-col">
      <div className="relative px-3 pt-4">
        <div className="flex items-end gap-[3px]" style={{ height: 92 }}>
          {days.map((d) => (
            <button
              key={d.day}
              onClick={() => onPick(d.day)}
              aria-pressed={selected === d.day}
              title={`${d.day}: ${d.runs} run${d.runs === 1 ? "" : "s"}${d.cost !== null ? ` · ${fmtCost(d.cost)}` : ""}${d.kills ? ` · ${d.kills} killed` : ""}`}
              className="group flex h-full grow cursor-pointer items-end"
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
  if (!models.length) return <p className="px-3 py-4 text-[12px] text-faint">No model calls in the last 7 days.</p>;
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
}: {
  drill: Drill;
  data: ControlData;
  depth: number;
  onBack: () => void;
  onClose: () => void;
  onOpen: (d: Drill) => void;
  onKill: (id: string) => void;
}) {
  const { title, body } = renderDrill(drill, data, onOpen, onKill);
  return (
    // A modal over the room: the backdrop is a click target — empty space
    // closes the drill-down, Esc steps back one level.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[82vh] w-[min(560px,94vw)] flex-col overflow-hidden rounded-lg border border-line bg-surface elev-2"
      >
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-raise/55 px-3">
          {depth > 1 && (
            <button onClick={onBack} aria-label="Back" className="focusable cursor-pointer rounded-sm p-1 text-dim transition-colors hover:text-fg">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
          )}
          <span className="min-w-0 truncate text-[12.5px] font-semibold text-fg">{title}</span>
          <span className="grow" />
          <button onClick={onClose} aria-label="Close" className="focusable cursor-pointer rounded-sm p-1 text-dim transition-colors hover:text-fg">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
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
): { title: string; body: React.ReactNode } {
  const runs = data.runs;

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
              <Button size="sm" variant="outline" tone="err" onClick={() => onKill(l.id)}>
                Kill this run
              </Button>
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
                  <span className={`size-1.5 shrink-0 rounded-[2px] ${b.model.startsWith("ollama/") ? "bg-ok" : "bg-run"}`} />
                  <span className="min-w-0 grow truncate font-mono text-[10.5px] text-mist">{b.model}</span>
                  <span className="tnum text-[10.5px] text-dim">{fmtTokens(b.in + b.out)}</span>
                  <span className="tnum w-14 text-right text-[10.5px] text-mist">{fmtCost(b.cost)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex gap-2 px-4 py-3">
            <Button size="sm" variant="solid" tone="ink" href={`/runs?id=${encodeURIComponent(r.id)}`}>
              Open in theater
            </Button>
            {r.state === "suspended" && (
              <Button size="sm" variant="outline" href={`/runs?agent=${encodeURIComponent(r.system)}`}>
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
          <Fact k="Runs" v={`${a.runs7d} in 7d · ${a.runsTotal} total`} />
          <Fact k="Avg time · 7d" v={fmtMs(a.avgMs7d)} />
          <Fact k="Spend · 7d" v={fmtCost(a.cost7d)} />
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
                  <span className={`size-1.5 shrink-0 rounded-[2px] ${m.startsWith("ollama/") ? "bg-ok" : "bg-run"}`} />
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
          <Fact k="Where it runs" v={m?.local ? "this machine — local, $0" : "cloud gateway"} tone={m?.local ? "text-ok" : undefined} />
          <Fact k="Tokens · 7d" v={m ? `${fmtTokens(m.in)} in · ${fmtTokens(m.out)} out` : "—"} />
          <Fact k="Cost · 7d" v={fmtCost(m?.cost ?? null)} />
          <Fact k="Runs that used it" v={String(m?.runs ?? modelRuns.length)} />
          <p className="px-4 pt-3 pb-1 text-[11px] font-semibold text-dim">Runs</p>
          <RunList runs={modelRuns.slice(0, 15)} onOpen={onOpen} empty="No recent runs used this model." />
        </div>
      ),
    };
  }

  // KPI drills — the records behind the tile.
  const week = Date.now() - 7 * 86_400_000;
  const recent = runs.filter((r) => new Date(r.at).getTime() >= week);
  switch (drill.which) {
    case "deployed":
      return {
        title: "Agents",
        body: (
          <div className="flex flex-col">
            {data.agents.map((a) => (
              <button
                key={a.id}
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
                <span className="text-[10px] text-ghost">{a.runs7d} runs · 7d</span>
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
                <button onClick={() => onOpen({ kind: "run", id: l.id })} className="focusable flex min-w-0 grow cursor-pointer flex-col text-left">
                  <span className="truncate text-[12px] font-medium text-fg">{l.system}</span>
                  <span className="truncate font-mono text-[9.5px] text-faint">{ago(l.startedAt)}</span>
                </button>
                <Button size="sm" variant="outline" tone="err" onClick={() => onKill(l.id)}>
                  Kill
                </Button>
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
      return { title: "Slowest runs · 7 days", body: <RunList runs={slowest.slice(0, 12)} onOpen={onOpen} empty="No runs in the last week." /> };
    }
    case "denials":
      return {
        title: "Guardrail denials · 7 days",
        body: (
          <RunList
            runs={recent.filter((r) => r.denials > 0)}
            onOpen={onOpen}
            empty="No denials this week — nothing tried to cross a line. Open any run's theater to see the rules standing guard."
          />
        ),
      };
    case "kills":
      return {
        title: "Killed runs · 7 days",
        body: (
          <RunList
            runs={recent.filter((r) => r.state === "killed")}
            onOpen={onOpen}
            empty="No kills this week. When an operator throws the switch, the journalled decision lands here."
          />
        ),
      };
  }
}
