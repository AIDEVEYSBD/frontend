"use client";
import { Failure, AnswerFailure } from "./pending";
import { ask, type Answer } from "@/lib/api/pending";

import { agentHref } from "@/lib/agent-link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
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
import { machineLine } from "@/lib/site";
import { useMachineOrigin } from "@/lib/use-session";
import { ApproveDialog, useGates, type Gate } from "./approve";
import { soon } from "@/lib/soon";
import { WindowPick, nextWin, winMs, type Win } from "./window-pick";
import { Pick } from "./select";
import { Checkbox } from "./forms";
import { api, type RunRow as LedgerRow, errorText } from "@/lib/api/client";
import { listAttached, readQueue, type QueueSummary } from "@/lib/api/l2";
import type { AttachedAgent } from "@/lib/attached";
import { getLifecycle, STAGE_NAMES, type Lifecycle } from "@/lib/api/l8";
import { STAGE_LABEL, spineOf } from "@/lib/lifecycle";
import { DeployDialog } from "./deploy-gate";
import { JOB_STATUS_META, countOf, jobLine } from "@/lib/queue";
import { productionRuns } from "@/lib/production";
import { partnerStatus, type PartnerPeer } from "@/lib/peers";
import { auditLine, inFlight, type RunRowL5 } from "@/lib/api/l5";
import { KillDialog } from "./kill-dialog";
import { StopForm, stopNotice, type StopScope } from "./stop-form";
import { killRefusalOf, killRun } from "@/lib/api/l7";
import { alreadySummary, killSummary } from "@/lib/run-tree";
import { RunSourceTag } from "./run-source";
import { JobsList } from "./jobs";
import { runSourceOf } from "@/lib/api/l6";
import { AttentionPanel } from "./attention";
import { FleetBar, FleetPanel, LockdownBanner, LockdownSwitch, liveTotal, useAgentList, useFleet, useLockdown } from "./operate";
import { VersionHistory } from "./versions";
import { Deadline, ShapeTag, useNow } from "./gate-form";
import { batchable, escalationPath, historyOf, lastMoved, stepLine } from "@/lib/gates";
import { useSession } from "@/lib/use-session";

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
  /** The run's own recorded cost: null once one of its calls was on a model with no price set. */
  cost: number | null;
  /** What the run's priced calls cost; null when it made calls and none of them was priced. */
  priced: number | null;
  /** Calls of the run on a model with no price set: counted apart, never as $0. */
  unpricedCalls: number;
  tokens: { in: number; out: number };
  models: string[];
  suspendedAt: string;
  denials: number;
  modelCalls: number;
  toolCalls: number;
  artifacts: number;
  artifactNames: string[];
  byModel: { model: string; in: number; out: number; cost: number | null; unpricedCalls: number }[];
  /** How the run was started: console, trigger, sub_run, api. */
  source?: string;
  /** A canary's shadow run: listed and marked, counted in none of the page's figures (the platform keeps it out of them too). */
  shadow?: boolean;
}

/**
 * An agent's benchmark: the newest finished evaluation of what production
 * runs, else of the agent. `incomplete` when a case could not run (`refused`)
 * or was not graded (`not_graded`): its score is not a measure, and it is
 * left out of a model's accuracy. `matches_deployed` is false when it scored
 * a version other than the one deployed.
 */
interface Benchmark {
  passed: number;
  total: number;
  at: string;
  digest: string;
  model: string;
  score?: number | null;
  threshold?: number | null;
  matches_deployed?: boolean | null;
  refused?: number;
  not_graded?: number;
  incomplete?: boolean;
}

/** A benchmark's caveats in a line: incomplete, or of another version; "" when it has none. */
function benchmarkCaveat(e: Benchmark): string {
  return [
    e.incomplete ? `incomplete: ${[e.refused ? `${e.refused} case${e.refused === 1 ? "" : "s"} could not run` : "", e.not_graded ? `${e.not_graded} not graded` : ""].filter(Boolean).join(", ") || "not every case was graded"}` : "",
    e.matches_deployed === false ? "of a version other than the one deployed" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

/** A shadow run's mark in a run list. */
function ShadowMark({ run }: { run: { shadow?: boolean } }) {
  if (!run.shadow) return null;
  return (
    <span title="A canary's shadow run: the candidate version on a production run's input. Listed here, counted in no figure." className="inline-flex shrink-0">
      <Tag tone="neutral">shadow</Tag>
    </span>
  );
}

/** An agent's figures over one window, as the platform counted them. */
interface AgentWindow {
  runs: number;
  avgMs: number | null;
  cost: number | null;
  unpricedCalls: number;
  tokens: number;
  models: string[];
}

interface AgentRow {
  id: string;
  name: string;
  description: string;
  deployed_at: string | null;
  retired: boolean;
  nodes: number;
  active: number;
  pending: number;
  runsTotal: number;
  ticks: { id: string; state: string; at: string }[];
  /** The agent's benchmark (newest finished evaluation); an empty list when it has none. Null when the answer carries none, and `not_built.evals` then says why, in the platform's words. */
  evals: Benchmark[] | null;
  byWindow: Record<Win, AgentWindow>;
  /* The window's figures, laid on by `rewindow` from `byWindow`. */
  runs7d: number;
  avgMs7d: number | null;
  cost7d: number | null;
  unpriced7d: number;
  tokens7d: number;
  models: string[];
}

interface DayRow {
  day: string;
  runs: number;
  cost: number | null;
  unpricedCalls: number;
  denials: number;
  kills: number;
  avgMs: number | null;
  ids: string[];
}

interface ModelRow {
  model: string;
  tokens: number;
  in: number;
  out: number;
  cost: number | null;
  unpricedCalls: number;
  runs: number;
}

interface Posture {
  agents: number;
  grants: number;
  byRisk: Record<string, number>;
  sinks: number;
  gatedSinks: number;
  conditionalSinks: number;
  ungated: { agent: string; node: string; tool: string; risk: string; conditional: boolean }[];
  unregistered: { agent: string; node: string; tool: string }[];
  undeclared: { agent: string; node: string; tool: string }[];
  basis: string;
}

/** One window's figures, counted by the platform (the page never sums records itself). */
interface WindowFigures {
  totals: { runs: number; cost: number | null; unpricedCalls: number; tokens: number; denials: number; kills: number; avgMs: number | null; gatesAnswered: number };
  days: DayRow[];
  models: ModelRow[];
  latency: { p50: number; p95: number; p99: number; max: number; runs: number } | null;
}

interface ControlData {
  posture: Posture;
  /** The registry's peers. Null when the answer carries no list; `not_built.peers` then says why, in the platform's words. */
  peers: PartnerPeer[] | null;
  finops: {
    /** Null: reading a cloud bill is not built (`not_built.billing` says so). */
    billing: null;
    budget: number | null;
    period: "day" | "week" | "month" | null;
    /** `spent` null when calls were made and none was priced; `remaining`, `exceeded` and `used` null when unpriced calls leave them unknown, and `unknown_why` says why. */
    budgetState: { since: string; spent: number | null; unpriced: number; remaining: number | null; exceeded: boolean | null; used: number | null; unknown_why?: string | null } | null;
    spend7d: number | null;
    unpriced7d: number;
  };
  ledger: { entries: number; runs: number; lastWrite: string | null };
  totals: {
    deployed: number;
    registered: number;
    active: number;
    pending: number;
    pausedAtBudget: number;
    runs7d: number;
    cost7d: number | null;
    unpriced7d: number;
    tokens7d: number;
    denials7d: number;
    kills7d: number;
    avgMs7d: number | null;
    gatesAnswered: number;
  };
  windows: Record<Win, WindowFigures>;
  agents: AgentRow[];
  /** In flight. `step`, `stuck` and `waitingOn` come from the run ledger (GET /api/runs), laid over by `withLive`. */
  live: { id: string; system: string; startedAt: string; stuck?: boolean; waitingOn?: string | null; step?: string; stepMs?: number; stepP95Ms?: number | null; source?: string; state?: string }[];
  days: DayRow[];
  models: ModelRow[];
  latency: WindowFigures["latency"];
  runs: RunRow[];
  /** How many runs there are; `runs` holds the newest of them. */
  runsTotal: number;
  /** A canary's shadow runs on record: listed among `runs`, marked, and counted in no figure. */
  shadowTotal?: number;
  store: string;
  costBasis: string;
  /** What this platform does not have, each with why. */
  not_built: Record<string, string>;
  /** The window the figures are cut over. */
  window: Win;
  /** The clock the window was cut against. */
  now: number;
}

/* ── windows: every time-shaped figure is the platform's own count for that window ── */

/** The estate read with one window's figures laid on. Field names keep their "7d" suffix —
    they are "the window" everywhere below, and the label says which. */
function rewindow(d: ControlData, now: number, w: Win): ControlData {
  const f = d.windows[w];
  return {
    ...d,
    agents: d.agents.map((a) => {
      const aw = a.byWindow[w];
      return { ...a, runs7d: aw.runs, avgMs7d: aw.avgMs, cost7d: aw.cost, unpriced7d: aw.unpricedCalls, tokens7d: aw.tokens, models: aw.models };
    }),
    days: f.days,
    models: f.models,
    latency: f.latency,
    finops: { ...d.finops, spend7d: f.totals.cost, unpriced7d: f.totals.unpricedCalls },
    totals: {
      ...d.totals,
      runs7d: f.totals.runs,
      cost7d: f.totals.cost,
      unpriced7d: f.totals.unpricedCalls,
      tokens7d: f.totals.tokens,
      denials7d: f.totals.denials,
      kills7d: f.totals.kills,
      avgMs7d: f.totals.avgMs,
      gatesAnswered: f.totals.gatesAnswered,
    },
    window: w,
    now,
  };
}

/** A run's cost as a list shows it: its own recorded cost, or, once a call had no price, what the priced calls came to and how many had none. */
const runCost = (r: { cost: number | null; priced: number | null; unpricedCalls: number }) =>
  r.cost !== null ? fmtCost(r.cost) : `${r.priced !== null ? `${fmtCost(r.priced)} priced, ` : ""}${r.unpricedCalls} with no price`;

/** "3 calls with no price", for a figure that leaves such calls out. */
const unpricedLine = (n: number) => (n ? `${n} call${n === 1 ? "" : "s"} with no price` : "");

/** The backend's view of what is in flight (GET /api/runs, the `live` flag), laid over the estate read. Null leaves the read as it came. */
function withLive(d: ControlData, rows: LedgerRow[] | null): ControlData {
  if (rows === null) return d;
  const live = (rows as RunRowL5[]).map((r) => ({
    id: r.id,
    system: r.system,
    startedAt: r.started,
    stuck: r.stuck === true,
    waitingOn: r.waiting_on || null,
    step: r.step ?? "",
    stepMs: r.step_ms ?? 0,
    stepP95Ms: r.step_p95_ms ?? null,
    source: runSourceOf(r),
    // An SDK run its agent holds open stays live at a gate (phase L6): in flight, waiting on a person.
    state: r.state,
  }));
  const bySystem = new Map<string, number>();
  for (const l of live) bySystem.set(l.system, (bySystem.get(l.system) ?? 0) + 1);
  return {
    ...d,
    live,
    totals: { ...d.totals, active: live.length },
    agents: d.agents.map((a) => ({ ...a, active: bySystem.get(a.id) ?? 0 })),
  };
}

type Drill =
  | { kind: "kpi"; which: "deployed" | "active" | "pending" | "runs" | "spend" | "time" | "denials" | "kills" }
  | { kind: "agent"; id: string }
  /** The agent's saved versions and the difference between any two, in spec vocabulary. */
  | { kind: "versions"; id: string }
  | { kind: "day"; day: string }
  | { kind: "model"; id: string }
  | { kind: "run"; id: string }
  | { kind: "span"; run: string; span: Span };

/* ═══════════════════ formatting ═══════════════════ */

const fmtMs = (ms: number | null) =>
  ms === null ? "—" : ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}m` : `${(ms / 1000).toFixed(1)}s`;

const fmtCost = (c: number | null) =>
  c === null ? "—" : c === 0 ? "$0.00" : c < 0.005 ? "<$0.01" : `$${c.toFixed(2)}`;

/**
 * A sum the platform priced, with what it leaves out. The platform's sum covers the priced calls only, so calls on a
 * model with no price set are named beside it and a partial sum never reads as the whole; null with calls left out is
 * "no price set", null with none is nothing to price.
 */
const partialCost = (c: number | null, unpriced: number) =>
  c === null ? (unpriced ? "no price set" : "—") : unpriced ? `${fmtCost(c)} + ${unpriced} unpriced` : fmtCost(c);

const fmtTokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n));

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return `${Math.max(1, Math.round(s))}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};

/* ── Lifecycle: the backend's spine per agent (phase L8), each stage lit only by its own record ── */

/** Where a stage's click goes on the lifecycle page. */
const STAGE_ANCHOR: Record<string, string> = { reviewed: "#reviews", approved: "#deployments", canary: "#deployments", deployed: "#deployments" };

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

/** A refusal entry as Explore answers it, as far as the denials drill reads it. */
interface Refusal {
  id: string;
  control: string;
  run: string | null;
  agent: string;
  node: string;
  title: string;
  detail: string;
  at: string;
}

/** The refusals behind the denials tile: the window's `denied` and `contract.breach` entries (`GET /api/explore?kind=refusal`), newest first. */
function useRefusals(active: boolean, window: Win) {
  const [read, setRead] = useState<{ window: Win; rows: Refusal[]; total: number; error: string } | null>(null);
  useEffect(() => {
    if (!active || read?.window === window) return;
    let stop = false;
    fetch(`/api/explore?kind=refusal&window=${window}&limit=200`, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as { entries?: Refusal[]; total?: number; error?: string } | null;
        if (!res.ok || !body || !Array.isArray(body.entries)) throw new Error(errorText(body, res, "GET", "/api/explore"));
        if (!stop) setRead({ window, rows: body.entries, total: body.total ?? body.entries.length, error: "" });
      })
      .catch((e: Error) => !stop && setRead({ window, rows: [], total: 0, error: e.message }));
    return () => {
      stop = true;
    };
  }, [active, window, read]);
  return read?.window === window ? read : null;
}

export function Control() {
  const router = useRouter();
  const [raw, setRaw] = useState<ControlData | null>(null);
  const [error, setError] = useState("");
  /* The kill switch's question: which run (none means every run in flight), answered with a reason. */
  const [killAsk, setKillAsk] = useState<{ id?: string } | null>(null);
  /* The stop form (every run, the ticked agents' runs, or the lockdown), and the choice it opens on. */
  const [stopAsk, setStopAsk] = useState<StopScope | null>(null);
  // The page window, and per-card overrides (a KPI tile, the activity chart,
  // the model mix). Changing the page window clears every override.
  const [win, setWinState] = useState<Win>("7d");
  const [cardWin, setCardWin] = useState<Partial<Record<string, Win>>>({});
  const setWin = (w: Win) => {
    setWinState(w);
    setCardWin({});
  };
  const [stack, setStack] = useState<Drill[]>([]);
  /* The gates the inbox dialog is answering: one, or several of one agent and shape together. */
  const [answering, setAnswering] = useState<Gate[] | null>(null);
  /** Third-party agents: on the estate with the factory's own, though no workflow row holds them. */
  const [attached, setAttached] = useState<AttachedAgent[]>([]);
  /** Why the attached agents were not read; "" while they answer. The list keeps what last answered, and says so. */
  const [attachedError, setAttachedError] = useState("");
  useEffect(() => {
    let live = true;
    const read = () =>
      listAttached()
        .then((l) => {
          if (!live) return;
          setAttached(l.agents as AttachedAgent[]);
          setAttachedError("");
        })
        .catch((e) => live && setAttachedError((e as Error).message));
    void read();
    const t = setInterval(read, 15_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  /* Inbox rows ticked for a batch answer, by run id. */
  const [picked, setPicked] = useState<Set<string>>(new Set());
  /* Estate rows ticked for a fleet action, by agent id. */
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { lockdown, error: lockdownError, setState: setLockdownState, reload: reloadLockdown } = useLockdown();
  /* Which agents stand paused or draining, and the runs in flight per agent: the platform's, read back after every fleet action. */
  const { fleet: fleetState, error: fleetError, reload: reloadFleet } = useFleet();
  const { session } = useSession();
  // The inbox's deadlines tick on a slow clock: the page is large, and a second is finer than a countdown in hours needs.
  const clock = useNow(15_000);
  const [stageNotice, setStageNotice] = useState<string | null>(null);
  /* The agent the deploy dialog is open for: the gate decides, an administrator may override. */
  const [deployAsk, setDeployAsk] = useState<string | null>(null);
  /* Each agent's spine, read from the backend once per agent list (and after a deploy), not on the page's 4-second tick. */
  const [spines, setSpines] = useState<Record<string, Lifecycle>>({});
  /** Each agent whose spine read failed, with the reason: its row says so instead of "reading the spine…". */
  const [spineErrors, setSpineErrors] = useState<Record<string, string>>({});
  const [spineTick, setSpineTick] = useState(0);
  /* Hover readouts — what a tooltip would have hidden, kept on the page. */
  const [stageHint, setStageHint] = useState<string | null>(null);
  const [tickHint, setTickHint] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const drill = stack[stack.length - 1] ?? null;
  const { gates, failed: gatesFailed, reload: reloadGates } = useGates();

  const notice = useCallback((msg: string) => {
    setStageNotice(msg);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setStageNotice(null), 3200);
  }, []);

  const [queue, setQueue] = useState<QueueData | null>(null);
  /* Why the trigger queue was not read, in the platform's words; "" while it answers. */
  const [queueError, setQueueError] = useState("");
  /** The estate read as it answered; `estateNotBuilt` stops asking once it has said 501. */
  const [estateAnswer, setEstateAnswer] = useState<Answer<unknown> | null>(null);
  const estateNotBuilt = useRef(false);
  // What is in flight, from the backend's run ledger; null until it answers.
  const [liveRows, setLiveRows] = useState<LedgerRow[] | null>(null);
  /** Why the run ledger was not read; "" while it answers. Meanwhile what is in flight is the estate read's own list. */
  const [liveError, setLiveError] = useState("");
  // The clock the windows are cut against: stamped when the data arrives, so a
  // render is a pure function of what was loaded and when.
  const [now, setNow] = useState(0);

  const load = useCallback(async () => {
    // The estate is one read (GET /api/control). While the platform answers 501 it is not asked again: the page says it is not built.
    if (estateNotBuilt.current) return;
    const a = await ask<ControlData>("control");
    setEstateAnswer(a);
    if (a.state === "pending") {
      estateNotBuilt.current = true;
      setRaw(null);
      setError("");
      return;
    }
    if (a.state === "ok" && a.data && typeof a.data === "object") {
      setRaw(a.data);
      setNow(Date.now());
      setError("");
    } else setError(a.state === "error" ? a.message : "GET /api/control answered with something that is not the estate");
    // The trigger queue is its own read: the intake can be healthy while the
    // estate read is slow, and the other way round.
    try {
      setQueue(await readQueue());
      setQueueError("");
    } catch (e) {
      setQueue(null);
      setQueueError((e as Error).message || "the trigger queue did not answer");
    }
    // Liveness is the backend's: `live` flags the runs it drives in-process,
    // and a worker's or an attached agent's run in flight reads `running`.
    try {
      const { data } = await api.GET("/api/runs");
      // Production's runs in flight: a canary's shadow runs are listed on the Runs page, never counted here (lib/production.ts).
      setLiveRows(data ? inFlight(productionRuns(data.runs)) : null);
      setLiveError(data ? "" : "the run ledger answered with no list");
    } catch (e) {
      setLiveRows(null);
      setLiveError((e as Error).message || "the run ledger did not answer");
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

  const estate = useMemo(() => (raw ? withLive(raw, liveRows) : null), [raw, liveRows]);
  const data = useMemo(() => (estate ? rewindow(estate, now, win) : null), [estate, now, win]);
  /* While the estate read is not drawn (GET /api/control is a later phase), the agents for the fleet controls come from GET /api/agents. */
  const { agents: fleetAgents, error: fleetAgentsError, reload: reloadFleetAgents } = useAgentList(!data);
  /* Runs in flight, running or waiting at a gate, from GET /api/fleet: what "Kill all runs" would reach. */
  const inFlightCount = liveTotal(fleetState);
  // A card on its own window gets its own cut of the same ledger.
  const cut = useCallback((card: string): ControlData | null => (estate && cardWin[card] ? rewindow(estate, now, cardWin[card]!) : data), [estate, now, cardWin, data]);
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

  /* The spines, for the agents on the page: one read per agent, again after a deploy. */
  const agentIds = (raw?.agents ?? []).map((a) => a.id).join(",");
  useEffect(() => {
    if (!agentIds) return;
    let stop = false;
    const ids = agentIds.split(",");
    Promise.allSettled(ids.map((id) => getLifecycle(id))).then((rs) => {
      if (stop) return;
      const out: Record<string, Lifecycle> = {};
      const failed: Record<string, string> = {};
      rs.forEach((r, i) => {
        if (r.status === "fulfilled") out[ids[i]] = r.value;
        else failed[ids[i]] = (r.reason as Error)?.message || "the lifecycle read failed";
      });
      setSpines(out);
      setSpineErrors(failed);
    });
    return () => {
      stop = true;
    };
  }, [agentIds, spineTick]);

  /* Each lifecycle stage is a control, not a caption: the design opens the
     agent's own page, an undeployed agent's deploy opens the gate's dialog, every
     other stage opens the agent's lifecycle page at that record. */
  const stageAction = useCallback(
    (a: AgentRow, stage: string, lit: boolean, retired: boolean) => {
      if (stage === "designed") return router.push(agentHref(a.id));
      if (stage === "deployed" && !lit && !retired) return setDeployAsk(a.id);
      router.push(`/lifecycle?agent=${encodeURIComponent(a.id)}${STAGE_ANCHOR[stage] ?? ""}`);
    },
    [router],
  );

  /* Which single-run kill is in flight: the run's id. The button that fired
     it shows the spinner until the request settles. Stopping every run, the
     ticked agents' runs or the whole estate is the stop form's
     (components/stop-form.tsx), which calls those doors itself. */
  const [killing, setKilling] = useState<string | null>(null);
  const kill = useCallback(
    async (reason: string, id: string) => {
      setKilling(id);
      setKillAsk(null);
      try {
        // The kill reaches the run's whole tree (L7); the receipt says whom, and how.
        try {
          notice(killSummary(await killRun(id, reason)));
        } catch (e) {
          // Everything in flight already stopping on an earlier kill is that, not a refusal.
          const refusal = killRefusalOf(e);
          notice(refusal?.already.length ? alreadySummary(refusal) : `Kill refused: ${(e as Error).message.slice(0, 120)}`);
        }
        await load();
      } catch (e) {
        notice(`Kill failed: ${(e as Error).message.slice(0, 120)}`);
      } finally {
        setKilling(null);
      }
    },
    [load, notice],
  );
  /* Every kill button opens the same question; the dialog carries the reason to `kill`. */
  const askKill = useCallback((id: string) => setKillAsk({ id }), []);

  const t = data?.totals;
  /* The estate was not read (not built, or failed): no panel fed by it is drawn, and no figure stands in for it. */
  const regOff = !raw && (Boolean(error) || estateAnswer?.state === "pending");
  const off = regOff;
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
  const locked = Boolean(lockdown?.on);
  const statusLine = locked
    ? `lockdown${lockdown?.reason ? ` · ${lockdown.reason}` : ""}${data && t!.active > 0 ? ` · ${t!.active} in flight` : ""}`
    : estateAnswer?.state === "pending"
      ? "the estate read is not built"
      : off
      ? "the estate could not be read"
      : !data
      ? "reading the estate…"
      : t!.active > 0
        ? `${t!.active} run${t!.active === 1 ? "" : "s"} in flight`
        : t!.pending > 0
          ? `quiet — ${t!.pending} awaiting a person`
          : `all quiet · last activity ${ago(data.runs[0]?.at ?? null)}`;

  /* The inbox dialog for one run's gate; false when the inbox has no row for it yet. */
  const answerRun = useCallback(
    (runId: string): boolean => {
      const g = (gates ?? []).find((x) => x.run === runId);
      if (!g) return false;
      setAnswering([g]);
      return true;
    },
    [gates],
  );
  const pickedGates = (gates ?? []).filter((g) => picked.has(g.run));
  const batchCheck = batchable(pickedGates, session ? { roles: session.roles, appRoles: session.appRoles, groups: session.groups ?? [] } : null);

  return (
    <div className="relative mx-auto w-full max-w-[1520px] px-5 py-7">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-3">
            <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">Control</h1>
            <span className="flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1">
              {locked ? (
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-2 animate-ping rounded-full bg-err opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-err" />
                </span>
              ) : data && t!.active > 0 ? (
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-2 animate-ping rounded-full bg-run opacity-60" />
                  <span className="relative inline-flex size-2 rounded-full bg-run" />
                </span>
              ) : (
                <span className={`size-2 rounded-full ${off ? "bg-faint" : "bg-ok"}`} />
              )}
              <span className={`text-[11.5px] font-medium ${locked ? "text-err" : "text-dim"}`}>{statusLine}</span>
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
        <LockdownSwitch state={lockdown} onChanged={(s) => { setLockdownState(s); load(); }} onNotice={notice} onLockDown={() => setStopAsk("lockdown")} />
        {((inFlightCount ?? 0) > 0 || (t && t.active > 0)) && (
          <Button tone="err" variant="solid" size="sm" permission="run" onClick={() => setStopAsk("all")}>
            <span className="size-1.5 rounded-[2px] bg-on-solid" />
            Kill all runs
          </Button>
        )}
      </div>

      {estateAnswer && estateAnswer.state === "pending" && (
        <div className="mt-4">
          <AnswerFailure answer={estateAnswer} compact={false} />
        </div>
      )}
      {error && <Failure className="mt-4" what={raw ? "The estate stopped answering; the figures below are as it last answered" : "The estate could not be read"} message={error} />}

      {lockdownError && <Failure className="mt-4" what={lockdown ? "The lockdown stopped answering; the switch shows it as it last answered" : "The lockdown could not be read; the switch cannot be used until it is"} message={lockdownError} />}
      {data && fleetError && <Failure className="mt-4" what={fleetState ? "Which agents are held stopped answering; the marks below are as it last answered" : "Which agents are paused or draining could not be read; no mark is shown"} message={fleetError} />}
      {data && liveError && <Failure className="mt-4" what="The run ledger (GET /api/runs) could not be read; the runs in flight below are the estate read's own list" message={liveError} />}
      {attachedError && <Failure className="mt-4" what={attached.length ? "The attached agents stopped answering; the Estate lists them as they last answered" : "The attached agents could not be read; the Estate does not list them"} message={attachedError} />}

      {/* ── Lockdown: the banner stays while it is on ── */}
      {locked && (
        <div className="mt-4">
          <LockdownBanner state={lockdown} />
        </div>
      )}

      {/* ── What needs a person, ranked; each row with the one action that clears it ── */}
      <div className="mt-4">
        <AttentionPanel
          onAnswer={answerRun}
          onOpenRun={(id) => open({ kind: "run", id })}
          onNotice={notice}
          onLockdown={() => {
            reloadLockdown();
            reloadFleet();
          }}
        />
      </div>

      {/* Every panel from here to the inbox is cut from the estate read: none is drawn until it has answered. */}
      {data && (<>
      {/* ── KPI band — every tile opens its records ── */}
      <div className="mt-6 grid grid-cols-2 overflow-hidden rounded-md border border-line bg-surface sm:grid-cols-4 xl:grid-cols-8">
        <Kpi off={regOff} label="Deployed agents" value={t ? String(t.deployed) : "…"} sub={t ? `${t.registered} registered` : ""}
          active={drill?.kind === "kpi" && drill.which === "deployed"} onOpen={() => open({ kind: "kpi", which: "deployed" })} />
        <Kpi off={off} label="Active now" value={t ? String(t.active) : "…"} sub={t?.active ? "streaming live" : "nothing in flight"}
          tone={t?.active ? "run" : undefined} active={drill?.kind === "kpi" && drill.which === "active"}
          onOpen={() => open({ kind: "kpi", which: "active" })} />
        <Kpi off={off} label="Awaiting approval" value={t ? String(t.pending) : "…"} sub={t?.pending ? "a person is next" : "no gates open"}
          tone={t?.pending ? "warn" : undefined} active={drill?.kind === "kpi" && drill.which === "pending"}
          onOpen={() => open({ kind: "kpi", which: "pending" })} />
        <Kpi off={off} label="Runs" value={cut("runs")?.totals ? String(cut("runs")!.totals.runs7d) : "…"} sub="every run asked for in the window"
          win={wf("runs")} onWin={() => tile("runs")} spark={cut("runs")?.days.map((d) => d.runs)} active={drill?.kind === "kpi" && drill.which === "runs"}
          onOpen={() => open({ kind: "kpi", which: "runs" })} />
        <Kpi off={off} label="Spend" value={cut("spend")?.totals ? fmtCost(cut("spend")!.totals.cost7d) : "…"} sub={cut("spend")?.totals ? [`${fmtTokens(cut("spend")!.totals.tokens7d)} tokens`, unpricedLine(cut("spend")!.totals.unpriced7d)].filter(Boolean).join(" · ") : ""}
          win={wf("spend")} onWin={() => tile("spend")} spark={cut("spend")?.days.map((d) => d.cost ?? 0)} active={drill?.kind === "kpi" && drill.which === "spend"}
          onOpen={() => open({ kind: "kpi", which: "spend" })} />
        <Kpi off={off} label="Avg run time" value={cut("time")?.totals ? fmtMs(cut("time")!.totals.avgMs7d) : "…"} sub="ended runs, work time"
          win={wf("time")} onWin={() => tile("time")} spark={cut("time")?.days.map((d) => d.avgMs ?? 0)} active={drill?.kind === "kpi" && drill.which === "time"}
          onOpen={() => open({ kind: "kpi", which: "time" })} />
        <Kpi off={off} label="Guardrail denials" value={cut("denials")?.totals ? String(cut("denials")!.totals.denials7d) : "…"} sub="click for the rule that fired"
          win={wf("denials")} onWin={() => tile("denials")} tone={cut("denials")?.totals.denials7d ? "warn" : undefined} spark={cut("denials")?.days.map((d) => d.denials)}
          active={drill?.kind === "kpi" && drill.which === "denials"} onOpen={() => open({ kind: "kpi", which: "denials" })} />
        <Kpi off={off} label="Kills" value={cut("kills")?.totals ? String(cut("kills")!.totals.kills7d) : "…"} sub="operator decisions"
          win={wf("kills")} onWin={() => tile("kills")} tone={cut("kills")?.totals.kills7d ? "err" : undefined} spark={cut("kills")?.days.map((d) => d.kills)}
          active={drill?.kind === "kpi" && drill.which === "kills"} onOpen={() => open({ kind: "kpi", which: "kills" })} />
      </div>

      {/* ── Lifecycle: the backend's spine per agent, each stage lit only by its own record ── */}
      {deployAsk && (
        <DeployDialog
          agent={deployAsk}
          label={`the latest version of ${data?.agents.find((a) => a.id === deployAsk)?.name ?? deployAsk}`}
          onClose={() => setDeployAsk(null)}
          onDeployed={(d) => {
            notice(`${d.id} version ${d.version ?? "?"} deployed — digest ${d.digest.slice(0, 8)}${d.override ? " (by override)" : ""}`);
            setSpineTick((n) => n + 1);
            load();
          }}
        />
      )}
      <section className="mt-4 flex flex-col overflow-hidden rounded-md border border-line bg-surface">
        <PanelHead
          title="Agent lifecycle"
          meta="the latest version of each agent, each stage lit only by its own record: a version, a review, a gate decision, a deployment, a retirement"
        />
        <div className="af-list overflow-x-auto">
          <div className="min-w-[720px]">
            <div data-sticky className="grid grid-cols-[minmax(140px,1fr)_repeat(6,minmax(64px,80px))] items-center gap-1 border-b border-line px-4 py-1.5">
              <span className="text-[10.5px] font-semibold text-dim">Agent</span>
              {STAGE_NAMES.map((st) => (
                <span key={st} className="flex flex-col items-center gap-0.5 text-center">
                  <Label>{STAGE_LABEL[st]}</Label>
                </span>
              ))}
            </div>
            {(data?.agents ?? []).map((a) => {
              const spine = spines[a.id];
              const spineError = spineErrors[a.id] ?? "";
              const stages = spine ? spineOf(spine) : [];
              const retired = Boolean(spine?.retired);
              return (
                <div
                  key={a.id}
                  className={`grid w-full grid-cols-[minmax(140px,1fr)_repeat(6,minmax(64px,80px))] items-center gap-1 border-b border-line px-4 py-1.5 last:border-b-0 hover:bg-raise/30 ${retired ? "opacity-70" : ""}`}
                >
                  <Button size="sm" variant="solid" tone="neutral" className="max-w-full justify-self-start" onClick={() => open({ kind: "agent", id: a.id })}>
                    <span className="min-w-0 truncate">{a.name}</span>
                    {retired && <span className="ml-1 text-[10px] text-faint">retired</span>}
                  </Button>
                  {STAGE_NAMES.map((name, i) => {
                    const st = stages.find((x) => x.stage === name);
                    const on = Boolean(st?.lit);
                    const prev = i === 0 || Boolean(stages.find((x) => x.stage === STAGE_NAMES[i - 1])?.lit);
                    const hint = !spine
                      ? spineError
                        ? `${STAGE_LABEL[name]}: the lifecycle could not be read (${spineError})`
                        : `${STAGE_LABEL[name]}: reading the spine…`
                      : on
                        ? `${STAGE_LABEL[name]}: ${[st?.who, st?.note].filter(Boolean).join(" — ")} — click to open`
                        : name === "deployed" && !retired
                          ? `${STAGE_LABEL[name]}: not deployed — click to deploy through the promotion gate`
                          : `${STAGE_LABEL[name]}: waiting on ${st?.needs ?? "its record"} — click to open its lifecycle`;
                    const dot = !spine ? (spineError ? "border-err bg-surface" : "border-line bg-raise") : on ? (st?.tone === "warn" ? "border-warn bg-warn" : st?.tone === "err" ? "border-err bg-err" : "border-ok bg-ok") : "border-line-strong bg-surface";
                    return (
                      <button
                        key={name}
                        type="button"
                        onClick={() => stageAction(a, name, on, retired)}
                        title={`${a.name} · ${STAGE_LABEL[name]}`}
                        aria-label={`${a.name} — ${hint}`}
                        onMouseEnter={() => setStageHint(`${a.name} · ${hint}`)}
                        onMouseLeave={() => setStageHint(null)}
                        onFocus={() => setStageHint(`${a.name} · ${hint}`)}
                        onBlur={() => setStageHint(null)}
                        className="focusable flex cursor-pointer items-center justify-center rounded-sm py-1.5 transition-colors hover:bg-raise/70"
                      >
                        <span className={`h-px w-4 ${i === 0 ? "opacity-0" : on && prev ? "bg-ok/60" : "bg-line"}`} />
                        <span className={`size-2.5 shrink-0 rounded-[3px] border transition-transform ${deployAsk === a.id && name === "deployed" ? "animate-pulse border-run bg-run" : dot}`} />
                        <span className={`h-px w-4 ${i === STAGE_NAMES.length - 1 ? "opacity-0" : "bg-line"}`} />
                      </button>
                    );
                  })}
                </div>
              );
            })}
            {!data && !regOff && <p className="px-4 py-4 text-[12px] text-faint">Reading the registry…</p>}
            {regOff && <p className="px-4 py-4 text-[12px] text-faint">Each agent is a row here, its stages lit by their own records.</p>}
            {Object.keys(spineErrors).length > 0 && (
              <div className="px-4 py-2">
                <Failure
                  what={`The lifecycle of ${Object.keys(spineErrors).join(", ")} could not be read; ${Object.keys(spineErrors).length === 1 ? "its stages are" : "their stages are"} not shown`}
                  message={[...new Set(Object.values(spineErrors))].join("; ")}
                />
              </div>
            )}
          </div>
        </div>
        {!regOff && (
          <p className="truncate border-t border-line px-4 py-1.5 text-[10.5px] text-faint" aria-live="polite">
            {stageHint ?? "Hover a stage for the record behind it and what a click does."}
          </p>
        )}
      </section>
      </>)}

      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
        {/* ── The fleet controls without the estate read: every agent, its hold, its runs in flight ── */}
        {!data && (
          <FleetPanel
            agents={fleetAgents}
            agentsError={fleetAgentsError}
            fleet={fleetState}
            fleetError={fleetError}
            selected={selected}
            onSelect={setSelected}
            onStop={() => setStopAsk("agents")}
            onDone={(r) => {
              const verb = { pause: "Paused", resume: "Resumed", drain: "Draining", kill: "Stopped the runs of" }[r.action];
              notice(`${verb} ${r.agents.length} agent${r.agents.length === 1 ? "" : "s"}${r.killed.length ? ` · ${r.killed.length} run${r.killed.length === 1 ? "" : "s"} stopped` : ""}${auditLine(r.audit_id)}`);
              setSelected(new Set());
              reloadFleet();
              reloadFleetAgents();
            }}
          />
        )}
        {data && (<>
        {/* ── The estate ── */}
        <section className="flex h-fit flex-col overflow-hidden rounded-md border border-line bg-surface">
          <PanelHead
            title="Estate"
            meta={selected.size ? "pause, resume, drain or kill the agents ticked" : "every agent, its whole record — click a row, tick rows for a fleet action"}
            right={
              selected.size > 0 ? (
                <FleetBar
                  agents={[...selected]}
                  names={(id) => data?.agents.find((a) => a.id === id)?.name ?? id}
                  onClear={() => setSelected(new Set())}
                  onStop={() => setStopAsk("agents")}
                  onDone={(r) => {
                    const verb = { pause: "Paused", resume: "Resumed", drain: "Draining", kill: "Stopped the runs of" }[r.action];
                    notice(`${verb} ${r.agents.length} agent${r.agents.length === 1 ? "" : "s"}${r.killed.length ? ` · ${r.killed.length} run${r.killed.length === 1 ? "" : "s"} stopped` : ""}${auditLine(r.audit_id)}`);
                    setSelected(new Set());
                    load();
                    reloadFleet();
                  }}
                />
              ) : undefined
            }
          />
          <div className="max-h-[560px] overflow-auto">
            <div className="min-w-[860px]">
              <div className="sticky top-0 z-10 grid grid-cols-[28px_minmax(170px,1.4fr)_96px_120px_130px_86px_86px_72px] items-center gap-3 border-b border-line bg-surface px-4 py-2">
                <Checkbox
                  aria-label="Select every agent"
                  checked={Boolean(data?.agents.length) && selected.size === data?.agents.length}
                  indeterminate={selected.size > 0 && selected.size < (data?.agents.length ?? 0)}
                  onChange={(on) => setSelected(on ? new Set((data?.agents ?? []).map((a) => a.id)) : new Set())}
                />
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
                  className={`focusable grid cursor-pointer grid-cols-[28px_minmax(170px,1.4fr)_96px_120px_130px_86px_86px_72px] items-center gap-3 border-b border-line px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-raise/50 ${
                    drill?.kind === "agent" && drill.id === a.id ? "bg-raise/70" : selected.has(a.id) ? "bg-raise/40" : ""
                  }`}
                >
                  <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <Checkbox
                      aria-label={`Select ${a.name}`}
                      checked={selected.has(a.id)}
                      onChange={(on) =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (on) n.add(a.id);
                          else n.delete(a.id);
                          return n;
                        })
                      }
                    />
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[13px] font-semibold text-fg">{a.name}</span>
                    <span className="truncate font-mono text-[10px] text-faint">
                      {a.id} · {a.nodes} node{a.nodes === 1 ? "" : "s"} · {a.runs7d} run{a.runs7d === 1 ? "" : "s"} · {win}
                    </span>
                  </span>

                  <span className="flex flex-col gap-1">
                    {spines[a.id]?.retired ? (
                      <span title={`${spines[a.id].retired!.reason}${spines[a.id].retired!.replacement ? ` · replaced by ${spines[a.id].retired!.replacement}` : ""}`}>
                        <Status tone="neutral">Retired</Status>
                      </span>
                    ) : a.retired ? (
                      <Status tone="neutral">Retired</Status>
                    ) : a.active > 0 ? (
                      <Status tone="run">{a.active} live</Status>
                    ) : a.deployed_at ? (
                      <Status tone="ok">Deployed</Status>
                    ) : (
                      <Status tone="queue">Saved</Status>
                    )}
                    {a.pending > 0 && <Status tone="warn">{a.pending} waiting</Status>}
                    {fleetState?.paused[a.id] && (
                      <span title={`${fleetState.paused[a.id].reason}${fleetState.paused[a.id].by ? ` · ${fleetState.paused[a.id].by}` : ""}`}>
                        <Status tone="warn">{fleetState.paused[a.id].mode === "drain" ? "Draining" : "Paused"}</Status>
                      </span>
                    )}
                  </span>

                  <span className="flex flex-col gap-1">
                    {a.evals === null ? (
                      // No benchmark in the answer: the platform's own reason, never one written here.
                      <span className="text-[11px] text-faint" title={data.not_built.evals || "The platform's answer carries no benchmark for this agent and gives no reason."}>
                        {data.not_built.evals ? "Not built" : "Not in the answer"}
                      </span>
                    ) : a.evals.length ? (
                      <>
                        <span className="flex items-baseline gap-1">
                          <span className={`tnum text-[13px] font-semibold ${a.evals[0].incomplete ? "text-warn" : a.evals[0].passed === a.evals[0].total ? "text-ok" : "text-warn"}`}>
                            {a.evals[0].passed}/{a.evals[0].total}
                          </span>
                          <span className="text-[10px] text-faint">{ago(a.evals[0].at)}</span>
                        </span>
                        {benchmarkCaveat(a.evals[0]) && <span className="text-[10px] leading-[1.35] text-warn">{benchmarkCaveat(a.evals[0])}</span>}
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
                  <span className={`tnum text-right text-[12.5px] ${a.unpriced7d ? "text-warn" : "text-mist"}`} title={a.unpriced7d ? unpricedLine(a.unpriced7d) + ", not in the sum" : undefined}>{partialCost(a.cost7d, a.unpriced7d)}</span>

                  <span className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                    <Button size="sm" variant="outline" href={`/runs?agent=${encodeURIComponent(a.id)}`}>
                      Run
                    </Button>
                  </span>
                </div>
              ))}

              {attached.map((a) => (
                <div key={a.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-4 border-b border-line px-4 py-2.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[12.5px] font-semibold text-fg">{a.name}</span>
                    <Tag>{a.mode === "a2a" ? "A2A" : "SDK"}</Tag>
                  </span>
                  {a.blocked ? <Status tone="err">Blocked</Status> : <Status tone="ok">Attached</Status>}
                  <span className="tnum text-[11.5px] text-faint">{a.runs30d} runs</span>
                  {/* A cost that leaves out a call with no price set is null from the platform: it reads "no price set", never $0.00. */}
                  <span className={`tnum text-[11.5px] ${a.cost30d === null ? "text-warn" : "text-faint"}`}>{a.cost30d === null ? "no price set" : `$${a.cost30d.toFixed(2)}`}</span>
                </div>
              ))}

              {regOff && attached.length === 0 && <p className="px-4 py-6 text-[12.5px] text-faint">Deployed workflows are listed here, each with its whole record.</p>}
              {data && !regOff && data.agents.length === 0 && attached.length === 0 && (
                <p className="px-4 py-6 text-[12.5px] text-faint">
                  Nothing in the registry. Build a workflow and deploy it — it appears here with
                  its whole record.
                </p>
              )}
              {!data && !regOff && <p className="px-4 py-6 text-[12.5px] text-faint">Reading the registry…</p>}
            </div>
          </div>
          {!regOff && (
            <p className="truncate border-t border-line px-4 py-1.5 text-[10.5px] text-faint" aria-live="polite">
              {tickHint ?? "Health: one tick per run — hover for its state and age, click to open."}
            </p>
          )}

          {/* Recent runs fill the column — the estate's pulse, row by row. */}
          <div className="border-t border-line">
            <div className="flex h-8 items-center gap-2 border-b border-line bg-raise/40 px-4">
              <span className="text-[11px] font-semibold text-dim">Recent runs</span>
              {(data?.shadowTotal ?? 0) > 0 && (
                <span className="text-[10.5px] text-faint" title="A canary's shadow runs: the candidate version on production runs' input. Marked in the list, counted in no figure on this page.">
                  · {data!.shadowTotal} shadow run{data!.shadowTotal === 1 ? "" : "s"} on record, counted in no figure
                </span>
              )}
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
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[11.5px] font-medium text-fg">{r.system}</span>
                      <RunSourceTag run={r} />
                      <ShadowMark run={r} />
                    </span>
                    <span className="truncate font-mono text-[9.5px] text-faint">
                      {r.state} · {fmtMs(r.ms)} · {runCost(r)}
                      {r.denials > 0 ? ` · ${r.denials} denied` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-[9.5px] whitespace-nowrap text-ghost">{ago(r.at)}</span>
                </button>
              ))}
            </div>
          </div>
        </section>
        </>)}

        {/* ── Right rail: what needs a person, and what is running ── */}
        <div className="flex flex-col gap-4">
          {data && (<>
          {/* Live now */}
          <section className="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
            <PanelHead
              title="Live now"
              right={<Mono className="text-[10px] text-ghost">stop requested, journalled</Mono>}
              pulse={Boolean(data?.live.length)}
            />
            {(data?.live ?? []).map((r) => (
              <div key={r.id} className="flex items-center gap-3 border-b border-line px-3 py-2.5 last:border-b-0">
                <button
                  type="button"
                  onClick={() => open({ kind: "run", id: r.id })}
                  className="focusable flex min-w-0 grow cursor-pointer flex-col text-left"
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[12.5px] font-medium text-fg">{r.system}</span>
                    <RunSourceTag run={r} />
                    {r.stuck && <Status tone="warn">stuck</Status>}
                  </span>
                  <span className={`truncate font-mono text-[10px] ${r.stuck ? "text-warn" : "text-faint"}`}>
                    {r.id} · {ago(r.startedAt)}
                    {r.state === "suspended" ? " · at a gate, waiting on a person" : r.waitingOn ? ` · waiting on ${r.waitingOn}` : ""}
                  </span>
                </button>
                <KillButton id={r.id} busy={killing === r.id || killing === "*"} onKill={askKill} />
              </div>
            ))}
            {!data && !off && <p className="px-3 py-4 text-[12px] text-faint">Reading the process table…</p>}
            {off && <p className="px-3 py-4 text-[12px] text-faint">Runs appear here the moment they start, kill switch beside each.</p>}
            {data && !off && data.live.length === 0 && (
              <p className="px-3 py-4 text-[12px] text-faint">
                Nothing in flight. Runs appear here the moment they start, kill switch beside each.
              </p>
            )}
          </section>
          </>)}

          {/* The inbox: every gate waiting, as the approvals door lays it out.
              The attention queue above ranks what needs a person; this is
              where the gates themselves are answered, one at a time or several
              of one agent and shape together. */}
          <section className="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
            <PanelHead
              title="Inbox"
              meta={picked.size ? (batchCheck.ok ? `${picked.size} ticked · answer them together` : batchCheck.reason) : "gates waiting for a person · tick several to answer together"}
              right={
                picked.size > 0 ? (
                  <span className="flex items-center gap-1.5">
                    <Button size="sm" variant="solid" tone="warn" permission="approve" disabled={!batchCheck.ok} onClick={() => setAnswering(pickedGates)}>
                      Answer {picked.size} together
                    </Button>
                    <Button size="sm" variant="quiet" onClick={() => setPicked(new Set())}>
                      Clear
                    </Button>
                  </span>
                ) : (gates?.length ?? 0) > 0 ? (
                  <Status tone="warn">{gates!.length} waiting</Status>
                ) : undefined
              }
            />
            <div className="max-h-[420px] overflow-y-auto">
              {(gates ?? []).map((g) => (
                <div key={g.run} className={`flex items-center gap-2.5 border-b border-line px-3 py-2.5 last:border-b-0 ${picked.has(g.run) ? "bg-raise/40" : ""}`}>
                  <Checkbox
                    aria-label={`Tick ${g.agent} · ${g.node}`}
                    checked={picked.has(g.run)}
                    onChange={(on) =>
                      setPicked((s) => {
                        const n = new Set(s);
                        if (on) n.add(g.run);
                        else n.delete(g.run);
                        return n;
                      })
                    }
                  />
                  <button
                    type="button"
                    onClick={() => open({ kind: "run", id: g.run })}
                    className="focusable flex min-w-0 grow cursor-pointer flex-col text-left"
                  >
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[12.5px] font-medium text-fg">{g.agent}</span>
                      <ShapeTag shape={g.shape} />
                      {/* A report gate (L8, second round): what the run wrote waits for this review. */}
                      {(g.control === "report" || g.deliverables.length > 0) && (
                        <Tag tone="warn">
                          report · {g.deliverables.length} deliverable{g.deliverables.length === 1 ? "" : "s"}
                        </Tag>
                      )}
                    </span>
                    <span className="truncate font-mono text-[10px] text-warn">
                      {g.asks ? g.asks.slice(0, 60) : `paused at ${g.node}`} · {ago(g.waiting_since)}
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 text-[10px] text-faint">
                      <span>{g.approvers.length ? g.approvers.join(", ") : "anyone"}</span>
                      <Deadline deadline={g.deadline} now={clock} />
                      {g.escalations > 0 && <span>escalated ×{g.escalations}</span>}
                    </span>
                    {/* Where it has been: first approvers, each role it walked to, and the latest step's when and why. */}
                    {g.escalations > 0 && (
                      <span className="truncate text-[10px] text-faint" title={[`first: ${historyOf(g).first.join(", ") || "not recorded"}`, ...g.escalation_history.map(stepLine)].join("\n")}>
                        {escalationPath(g)}
                        {lastMoved(g)}
                      </span>
                    )}
                  </button>
                  {/* Answering happens here. It used to link to the run page,
                      which is where a run is *started* — the one place a person
                      with a gate to answer should never be sent. */}
                  <Button permission="approve" size="sm" variant="solid" tone="warn" onClick={() => setAnswering([g])}>
                    Answer
                  </Button>
                </div>
              ))}
              {gatesFailed && (
                <div className="px-3 py-3">
                  <Failure what="The inbox could not be read" message={gatesFailed} />
                </div>
              )}
              {gates && gates.length === 0 && !gatesFailed && (
                <p className="px-3 py-4 text-[12px] text-faint">
                  No gates open. When a workflow suspends for a person, it queues here with an
                  Answer button.
                </p>
              )}
              {gates === null && <p className="px-3 py-4 text-[12px] text-faint">Reading the inbox…</p>}
            </div>
          </section>

          {data && (<>
          {/* Guardrails — the record of "no" */}
          <section className="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
            <PanelHead title="Guardrails" meta={`policy in action, ${win}`} />
            <div className={off ? "hidden" : "grid grid-cols-3 divide-x divide-line"}>
              {[
                { label: "Denials", value: t?.denials7d ?? 0, tone: t?.denials7d ? "text-warn" : "text-fg", drill: "denials" as const },
                { label: "Kills", value: t?.kills7d ?? 0, tone: t?.kills7d ? "text-err" : "text-fg", drill: "kills" as const },
                { label: "Gates answered", value: t?.gatesAnswered ?? 0, tone: "text-fg", drill: "gates" as const },
              ].map((g) => (
                <button
                  key={g.label}
                  type="button"
                  onClick={() => (g.drill === "gates" ? router.push(`/explore?kind=gate&outcome=approved,refused,answered&window=${win}`) : open({ kind: "kpi", which: g.drill }))}
                  className="focusable flex cursor-pointer flex-col items-center gap-0.5 px-2 py-3 transition-colors hover:bg-raise/50"
                >
                  <span className={`tnum text-[18px] leading-none font-semibold ${g.tone}`}>{g.value}</span>
                  <span className="text-[10px] text-faint">{g.label}</span>
                </button>
              ))}
            </div>
            <p className={`${off ? "" : "border-t border-line "}px-3 py-2 text-[10.5px] leading-[1.5] text-faint`}>
              Every refusal, gate and kill is a journal entry with a because-chain. Gates answered
              opens them in Explore; open any run to read the exact rule that fired.
            </p>
          </section>

          {/* FinOps — the gateway's own balance, and the budget beside the burn */}
          <FinOpsPanel finops={data?.finops ?? null} window={win} onSaved={load} off={off} billingNote={data?.not_built.billing ?? "no billed figure: the platform's answer carries none and gives no reason"} />
          </>)}
        </div>
      </div>

      {data && (<>
      {/* ── The lower boards: one masonry flow. Columns pack panels by their
          real height — no panel is ever stretched to a neighbour's, so there
          is no void to stretch into. ── */}
      <div className="mt-4 gap-4 md:columns-2 xl:columns-3">
        <section className="mb-4 flex break-inside-avoid flex-col overflow-hidden rounded-md border border-line bg-surface">
          <PanelHead title="Activity" meta={`${cut("activity")?.days.length ?? 14} days — click a day`} right={
            <span className="flex items-center gap-2">
              <Mono className="text-[10px] text-ghost">{off ? "" : cut("activity")?.totals ? `${partialCost(cut("activity")!.totals.cost7d, cut("activity")!.totals.unpriced7d)} · ${wf("activity")}` : ""}</Mono>
              <WindowPick value={wf("activity")} onChange={(w) => tile("activity", w)} inherited={!cardWin.activity} />
            </span>
          } />
          {off ? (
            <p className="px-3 py-4 text-[12px] text-faint">Runs per day, with their cost, chart here.</p>
          ) : (
            <ActivityChart days={cut("activity")?.days ?? []} selected={drill?.kind === "day" ? drill.day : null} onPick={(day) => open({ kind: "day", day })} />
          )}
        </section>

        <section className="mb-4 flex break-inside-avoid flex-col overflow-hidden rounded-md border border-line bg-surface">
          <PanelHead title="Model mix" meta={`${wf("mix")} — click a model`} right={<WindowPick value={wf("mix")} onChange={(w) => tile("mix", w)} inherited={!cardWin.mix} />} />
          <ModelMix off={off} models={cut("mix")?.models ?? []} onPick={(id) => open({ kind: "model", id })} selected={drill?.kind === "model" ? drill.id : null} />
        </section>

        {/* The intake: what external systems have posted, and who is draining it */}
        <section className="mb-4 flex break-inside-avoid flex-col overflow-hidden rounded-md border border-line bg-surface">
          <PanelHead
            title="Trigger queue"
            meta="external posts, by agent"
            pulse={Boolean(queue && Object.values(queue.agents).some((a) => (a.running ?? 0) > 0))}
            right={<Mono className="text-[10px] text-ghost">{queue ? `${queue.workers.length} worker${queue.workers.length === 1 ? "" : "s"} live` : ""}</Mono>}
          />
          <QueuePanel queue={queue} error={queueError} now={now} />
          {/* The jobs themselves (L8, second round): a cancelled one with its reason, a dead letter, a shadow job, a canary's arm. */}
          {queue && <JobsList agents={Object.keys(queue.agents)} />}
        </section>

        {/* The optimizing triangle: cost, accuracy, time. Every model sits
            where its own evidence pulls it. */}
        <section className="mb-4 flex break-inside-avoid flex-col overflow-hidden rounded-md border border-line bg-surface">
          <TradeoffTriangle
            off={off}
            evalsWhy={data?.not_built.evals ?? ""}
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
                  {/* The file itself is downloaded from its run's page, where each file links to its deliverable. */}
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
                </div>
              ))}
            {off && (
              <p className="px-3 py-4 text-[12px] text-faint">
                {estateAnswer?.state === "pending" ? "Not built: the files runs wrote are listed from the estate read, which the platform does not build yet." : "Not read: the estate could not be read."}
              </p>
            )}
            {data && !off && !data.runs.some((r) => r.artifactNames.length) && (
              <p className="px-3 py-4 text-[12px] text-faint">
                Nothing written yet — documents land here the moment a run produces them.
              </p>
            )}
          </div>
        </section>

        {/* Partner agents — A2A peers, as the peer registry holds them */}
        <section className="mb-4 flex break-inside-avoid flex-col overflow-hidden rounded-md border border-line bg-surface">
          <PanelHead title="Partner agents" meta="A2A peers, from the registry" />
          {/* No peer list in the answer: the platform's own reason when it names one, else that the list is missing. */}
          {data && data.peers === null && (
            <p className="px-3 py-4 text-[12px] leading-[1.55] text-faint">
              {data.not_built.peers ? `Not built, as the platform answers: ${data.not_built.peers}.` : "The platform's answer carries no peer list and gives no reason. The peers it holds are listed on Configuration, under Peers."}
            </p>
          )}
          {(data?.peers ?? []).map((p) => {
            const st = partnerStatus(p);
            return (
              <Link key={`${p.name}@${p.url}`} href={`/configuration#peer-${encodeURIComponent(p.name)}`} className="focusable flex items-center gap-2.5 border-b border-line px-3 py-2.5 transition-colors last:border-b-0 hover:bg-raise/50">
                <span className={`size-2 shrink-0 rounded-full ${st.tone === "ok" ? "bg-ok" : st.tone === "warn" ? "bg-warn" : st.tone === "err" ? "bg-err" : "bg-line-strong"}`} aria-hidden />
                <span className="flex min-w-0 grow flex-col">
                  <span className="truncate text-[12px] font-medium text-fg">{p.title}</span>
                  <span className="truncate font-mono text-[9.5px] text-faint">
                    {p.name} · {p.url || "no URL"}
                    {p.agent ? ` · used by ${p.agent}` : ""}
                  </span>
                </span>
                <span className={`shrink-0 text-[10px] ${st.tone === "err" ? "text-err" : st.tone === "warn" ? "text-warn" : "text-ghost"}`}>{st.text}</span>
              </Link>
            );
          })}
          {data && !regOff && data.peers !== null && data.peers.length === 0 && (
            <p className="px-3 py-4 text-[12px] leading-[1.55] text-faint">
              No peer is registered or named by a workflow. Register one on Configuration, under Peers: its card is pinned and nothing is sent to it until a person
              approves it.
            </p>
          )}
          {data && data.peers !== null && (
            <p className="border-t border-line px-3 py-2 text-[10.5px] leading-[1.5] text-faint">
              Spoken to only once registered and approved, signed both ways. Their answers arrive marked untrusted — the same taint rules as every other boundary.
            </p>
          )}
        </section>

        {/* Least-privilege posture */}
        <section className="mb-4 flex break-inside-avoid flex-col overflow-hidden rounded-md border border-line bg-surface">
          <PanelHead title="Least privilege" meta="grants × risk × gates, by the engine's rule" />
          {regOff && <p className="px-3 py-4 text-[12px] leading-[1.55] text-faint">Grants by declared risk, and the sinks behind a gate, are counted here from the specs.</p>}
          {data && !regOff && (
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
                {data.posture.conditionalSinks > 0 && (
                  <span className="flex items-baseline justify-between text-[11.5px]">
                    <span className="text-dim">Sinks gated only when a condition holds</span>
                    <span className="tnum font-semibold text-warn">{data.posture.conditionalSinks}</span>
                  </span>
                )}
                {data.posture.ungated.length > 0 && (
                  <div className="mt-1">
                    <Banner
                      tone="warn"
                      title={`${data.posture.ungated.length} sink${data.posture.ungated.length === 1 ? "" : "s"} no gate always holds`}
                    >
                      <span className="flex flex-col gap-1 pt-0.5">
                        {data.posture.ungated.slice(0, 4).map((u, i) => (
                          <Button key={i} size="sm" variant="quiet" className="max-w-full self-start font-mono" onClick={() => open({ kind: "agent", id: u.agent })}>
                            <span className="min-w-0 truncate">
                              {u.agent} · {u.node} · {u.tool} · {u.risk}
                              {u.conditional ? " · gated under a condition" : ""}
                            </span>
                          </Button>
                        ))}
                      </span>
                    </Banner>
                  </div>
                )}
                {(data.posture.unregistered.length > 0 || data.posture.undeclared.length > 0) && (
                  <p className="text-[11px] leading-[1.5] text-warn">
                    {[
                      data.posture.unregistered.length ? `${data.posture.unregistered.length} grant${data.posture.unregistered.length === 1 ? "" : "s"} of a tool that is not registered (a run of that agent is refused at its start)` : "",
                      data.posture.undeclared.length ? `${data.posture.undeclared.length} grant${data.posture.undeclared.length === 1 ? "" : "s"} of a tool the definition does not declare (every call of it is refused)` : "",
                    ]
                      .filter(Boolean)
                      .join("; ")}
                    .
                  </p>
                )}
              </div>
              <p className="border-t border-line px-3 py-2 text-[10.5px] leading-[1.5] text-faint" title={data.posture.basis}>
                Read from each agent&rsquo;s deployed version (its latest when none is deployed) and judged by the rule the engine applies to a call.
              </p>
            </>
          )}
        </section>

        {/* The ledger */}
        <section className="mb-4 flex break-inside-avoid flex-col overflow-hidden rounded-md border border-line bg-surface">
          <PanelHead title="Execution ledger" meta="append-only, exportable" />
          <div className={off ? "hidden" : "grid grid-cols-3 divide-x divide-line border-b border-line"}>
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
      </>)}

      {data && (
        <p className="mt-4 flex items-center gap-2 text-[10.5px] text-ghost">
          <Icon name="database" size={11} />
          {`${data.store} · cost basis: ${data.costBasis}`}
        </p>
      )}

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
          onKill={askKill}
          killing={killing}
          onAnswer={(runId) => {
            answerRun(runId);
          }}
        />
      )}

      {killAsk?.id && (
        <KillDialog
          title="Kill this run?"
          what={`${(data?.live ?? []).find((l) => l.id === killAsk.id)?.system ?? "run"} · ${killAsk.id}. A worker running it stops before its next model call, step or node; a call already in flight finishes. A run waiting for a person stops at once. Every run it started, and theirs, is stopped the same way. The journal records the reason and your name.`}
          confirm="Kill run"
          busy={killing !== null}
          onClose={() => setKillAsk(null)}
          onConfirm={(reason) => killAsk.id && kill(reason, killAsk.id)}
        />
      )}

      {/* Every run, the ticked agents' runs, or the lockdown: one form that shows the impact before it sends. */}
      {stopAsk && (
        <StopForm
          initial={stopAsk}
          agents={[...selected]}
          names={(id) => data?.agents.find((a) => a.id === id)?.name ?? fleetAgents?.find((a) => a.id === id)?.name ?? id}
          lockdown={lockdown}
          onClose={() => setStopAsk(null)}
          onDone={(o) => {
            if (o.scope === "lockdown") setLockdownState(o.state);
            if (o.scope === "agents") setSelected(new Set());
            reloadFleet();
            notice(stopNotice(o));
            load();
          }}
        />
      )}

      {answering && (
        <ApproveDialog
          gates={answering}
          onClose={() => setAnswering(null)}
          onAnswered={() => {
            setPicked(new Set());
            reloadGates();
            load();
          }}
        />
      )}
    </div>
  );
}

/* ═══════════════════ pieces ═══════════════════ */

/** FinOps: what the model calls recorded as spent over the window, and a budget to burn
    against. Spend is the recorded cost of each priced call; a call on a model with no price
    set is counted apart, never as $0. Reading a cloud bill is not built. */
function FinOpsPanel({
  finops,
  window,
  onSaved,
  billingNote,
  off = false,
}: {
  finops: ControlData["finops"] | null;
  window: Win;
  onSaved: () => void;
  /** Why no billed figure is shown: the platform's `not_built.billing`. */
  billingNote: string;
  /** The estate was not read: no figure is shown for a spend that was not read. */
  off?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [period, setPeriod] = useState<"day" | "week" | "month">("month");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const spend = finops?.spend7d ?? null;
  // The budget is a rate (so much per period). The window's spend is compared
  // to the budget scaled to the window: $5 a day is $150 over 30 days, and
  // an "all time" window is scaled to however many days it actually spans.
  const state = finops?.budgetState ?? null;
  const per = finops?.budget != null && finops.period ? finops.period : null;
  // One clock reading per mount: the window's span must not move between renders.
  const [now] = useState(() => Date.now());
  const windowDays = window === "all" ? Math.max(1, (now - new Date(state?.since ?? now).getTime()) / 86_400_000) : winMs(window) / 86_400_000;
  const windowBudget = per && finops?.budget != null ? (finops.budget * windowDays) / PERIOD_DAYS[per] : null;
  const burnPct = windowBudget && spend !== null ? Math.min(100, (spend / Math.max(0.01, windowBudget)) * 100) : null;
  const usedPct = state?.used != null ? Math.round(state.used * 100) : null;

  return (
    <section className="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
      <PanelHead title="Costs" meta="recorded spend vs budget" />
      {off && <p className="border-b border-line px-3 py-3 text-[12px] text-faint">What the model calls recorded as spent shows here, beside the budget.</p>}
      <div className={off ? "hidden" : "grid grid-cols-2 divide-x divide-line border-b border-line"}>
        {[
          { label: [`Recorded · ${window}`, unpricedLine(finops?.unpriced7d ?? 0)].filter(Boolean).join(" · "), value: fmtCost(spend), tone: "text-fg" },
          { label: per ? `Budget · per ${PERIOD_LABEL[per]}` : "Budget", value: finops?.budget != null ? `$${finops.budget.toFixed(2)}` : "unset", tone: state?.exceeded ? "text-err" : "text-fg" },
        ].map((x) => (
          <div key={x.label} className="flex flex-col items-center gap-0.5 px-1 py-2.5">
            <span className={`tnum text-[15px] leading-none font-semibold ${x.tone}`}>{x.value}</span>
            <span className="text-[9.5px] text-faint">{x.label}</span>
          </div>
        ))}
      </div>
      {state && per && finops?.budget != null && (
        <div className={`flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line px-3 py-2 text-[10.5px] ${state.exceeded ? "text-err" : "text-faint"}`}>
          <span className="font-medium">{state.exceeded === true ? "Budget exhausted · new runs are refused" : state.exceeded === null ? `This ${PERIOD_LABEL[per]} so far: whether it is spent is unknown` : `This ${PERIOD_LABEL[per]} so far`}</span>
          <span className="tnum">{state.spent === null ? "spent: unknown" : `${state.exceeded === null ? "at least " : ""}${fmtCost(state.spent)}`} of ${finops.budget.toFixed(2)}{usedPct !== null ? ` · ${usedPct}%` : ""}</span>
          {state.remaining !== null && state.exceeded === false && <span className="tnum">{fmtCost(Math.max(0, state.remaining))} left</span>}
          {state.unknown_why ? <span className="text-warn">{state.unknown_why[0].toUpperCase() + state.unknown_why.slice(1)}.</span> : state.unpriced > 0 && <span>{unpricedLine(state.unpriced)}, not counted against it</span>}
        </div>
      )}
      {burnPct !== null && windowBudget !== null && (
        <div className="flex flex-col gap-1 px-3 pt-2.5">
          <span className="flex justify-between text-[10px] text-faint">
            <span>{window} spend vs {fmtCost(windowBudget)} ({`$${finops!.budget!.toFixed(2)} per ${PERIOD_LABEL[per!]}`} scaled to {window})</span>
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
              permission="configure"
              loading={saving}
              onClick={async () => {
                const n = Number(value);
                if (!Number.isFinite(n) || n < 0) return;
                setSaving(true);
                setSaveError("");
                try {
                  const res = await fetch("/api/control", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ budget_usd: n, period }),
                  });
                  // A refusal is shown and the editor stays open: nothing is closed as if it were saved.
                  if (!res.ok) {
                    setSaveError(errorText(await res.json().catch(() => null), res, "POST", "/api/control"));
                    return;
                  }
                  setEditing(false);
                  onSaved();
                } catch (e) {
                  setSaveError(`the backend did not answer POST /api/control (${(e as Error).message})`);
                } finally {
                  setSaving(false);
                }
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
              permission="configure"
              onClick={() => {
                setValue(finops?.budget != null ? String(finops.budget) : "");
                setPeriod(finops?.period ?? "month");
                setEditing(true);
              }}
            >
              {finops?.budget != null ? "Change budget" : "Set a budget"}
            </Button>
            <span className="grow" />
            <span className="truncate text-[10px] text-ghost" title={billingNote}>
              {/* The platform's own sentence when it names billing as not built; otherwise that the answer lacks a billed figure. */}
              {billingNote[0]?.toUpperCase()}
              {billingNote.slice(1)}.
            </span>
            {saveError && <Failure inline message={saveError} />}
          </>
        )}
      </div>
    </section>
  );
}

/** Log export: every run's journal as one download. The audit trail is also forwarded as
    it is written when the deployment names a destination; nothing here configures that. */
function LogExport() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss<HTMLDivElement>(open, close);

  return (
    <div ref={ref} className="relative">
      <Button size="sm" variant="solid" tone="neutral" onClick={() => setOpen((v) => !v)}>
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
              <span className="text-[10.5px] text-faint">Every run&rsquo;s journal, one entry per line</span>
            </span>
          </a>
          <p className="px-3 py-2 text-[10px] leading-[1.5] text-ghost">
            The audit trail is forwarded as it is written, as OpenTelemetry logs or syslog, when the deployment names a destination
            (LOG_FORWARD_TO). What receives it is outside this platform.
          </p>
        </div>
      )}
    </div>
  );
}

/** A kill switch that names its consequence before it fires: the click opens
    the kill dialog, which asks for the reason the journal will carry. */
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
  return (
    <Button permission="run" size="sm" variant="solid" tone="err" loading={busy} onClick={() => onKill(id)}>
      {label}
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
  off = false,
}: {
  /** The figure was not read: the tile says so, shows no figure and opens nothing. */
  off?: boolean;
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
      onClick={off ? undefined : onOpen}
      onKeyDown={(e) => {
        if (off) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-pressed={active}
      aria-disabled={off || undefined}
      className={`focusable -mr-px -mb-px flex flex-col gap-1 border-r border-b border-line px-3 py-2.5 text-left transition-colors ${
        off ? "" : active ? "cursor-pointer bg-raise/80" : "cursor-pointer hover:bg-raise/50"
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
        {off ? (
          <span className="flex h-[22px] items-center text-[12px] text-faint">Not connected</span>
        ) : (
          <span
            className="tnum text-[22px] leading-none font-semibold tracking-[-0.02em]"
            style={tone ? { color: `var(--color-${tone})` } : undefined}
          >
            {value}
          </span>
        )}
        {!off && spark && spark.some((v) => v > 0) && (
          <Sparkline points={spark} tone={tone ?? "run"} width={52} height={16} area={false} />
        )}
      </span>
      <span className="truncate text-[10px] text-ghost">{off ? "\u00a0" : sub}</span>
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
    `${d.day} · ${d.runs} run${d.runs === 1 ? "" : "s"}${d.cost !== null || d.unpricedCalls ? ` · ${partialCost(d.cost, d.unpricedCalls)}` : ""}${d.kills ? ` · ${d.kills} killed` : ""}`;
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
  off = false,
}: {
  /** The estate was not read: the panel says what it holds, and shows no figure. */
  off?: boolean;
  models: ModelRow[];
  selected: string | null;
  onPick: (id: string) => void;
}) {
  const total = Math.max(1, models.reduce((s, m) => s + m.tokens, 0));
  const unpriced = models.reduce((s, m) => s + m.unpricedCalls, 0);
  if (off) return <p className="px-3 py-4 text-[12px] text-faint">Where the tokens went, model by model, shows here.</p>;
  if (!models.length) return <p className="px-3 py-4 text-[12px] text-faint">No model calls in this window.</p>;
  return (
    <div className="flex flex-col gap-2.5 p-3">
      <div className="flex h-2 w-full gap-px overflow-hidden rounded-full">
        {models.map((m) => (
          <span
            key={m.model}
            title={`${m.model} · ${fmtTokens(m.tokens)} tokens`}
            className="bg-run"
            style={{ width: `${Math.max(1.5, (m.tokens / total) * 100)}%` }}
          />
        ))}
      </div>
      <p className="text-[10.5px] text-faint">
        Tokens and recorded spend per model{unpriced ? `; ${unpricedLine(unpriced)}, counted apart beside each sum rather than as $0` : ""}.
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
            <span className="size-1.5 shrink-0 rounded-[2px] bg-run" />
            <span className="min-w-0 grow truncate font-mono text-[11px] text-fg">{m.model}</span>
            <span className="tnum shrink-0 text-[10.5px] text-dim">{fmtTokens(m.tokens)}</span>
            <span className={`tnum min-w-14 shrink-0 text-right text-[10.5px] ${m.unpricedCalls ? "text-warn" : "text-mist"}`}>{partialCost(m.cost, m.unpricedCalls)}</span>
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
  const { trace, state: traceState, failure: traceAnswer } = useTrace(runInView);
  // Why the trace was not read, in the platform's words: a failed read is never "no journal".
  const traceFailure = !traceAnswer ? "" : traceAnswer.state === "pending" ? `not built: ${traceAnswer.door.method} ${traceAnswer.door.path}` : traceAnswer.state === "error" ? traceAnswer.message : "";
  const refusals = useRefusals(drill.kind === "kpi" && drill.which === "denials", data.window);
  const { title, body } = renderDrill(drill, data, onOpen, onKill, killing, trace, traceState, refusals, onAnswer, traceFailure);
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
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[12px] font-medium text-fg">{r.system}</span>
              <RunSourceTag run={r} />
                      <ShadowMark run={r} />
            </span>
            <span className="truncate font-mono text-[9.5px] text-faint">
              {r.state} · {fmtMs(r.ms)} · {runCost(r)}
              {r.denials > 0 ? ` · ${r.denials} denied` : ""}
            </span>
          </span>
          <span className="shrink-0 text-[10px] whitespace-nowrap text-ghost">{ago(r.at)}</span>
        </button>
      ))}
    </div>
  );
}

/** Said above a drill list when the estate read carried only the newest runs (the figures still count every run). */
function TruncatedNote({ data }: { data: ControlData }) {
  const prod = productionRuns(data.runs).length;
  if (prod >= data.runsTotal) return null;
  return (
    <p className="border-b border-line px-4 py-2 text-[10.5px] text-faint">
      Listing from the newest {prod} of {data.runsTotal} runs; the figures count every run.
    </p>
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
  refusals: { rows: Refusal[]; total: number; error: string } | null,
  onAnswer: (runId: string) => void,
  traceFailure = "",
): { title: string; body: React.ReactNode } {
  // The drills stand behind production's figures: a canary's shadow runs are in none of them.
  const runs = productionRuns(data.runs);

  if (drill.kind === "span") {
    return { title: drill.span.name, body: <SpanDetail span={drill.span} /> };
  }

  if (drill.kind === "run") {
    // One run opened by id: a shadow run listed (and marked) under Recent runs opens too; only the lists behind figures leave shadows out.
    const r = data.runs.find((x) => x.id === drill.id);
    const isLive = data.live.some((l) => l.id === drill.id);
    if (!r && isLive) {
      const l = data.live.find((x) => x.id === drill.id)!;
      return {
        title: `Run · ${l.system}`,
        body: (
          <div className="flex flex-col">
            <Fact
              k="State"
              v={
                <span className="flex items-center gap-2">
                  {l.state === "suspended" ? <Status tone="warn">at a gate</Status> : <Status tone="run">running</Status>}
                  <RunSourceTag run={l} />
                </span>
              }
            />
            {l.stuck && (
              <Fact
                k="Stuck"
                v={`${l.step || "this step"} has run ${fmtMs(l.stepMs ?? null)}, past the agent's p95 of ${fmtMs(l.stepP95Ms ?? null)} for it${l.waitingOn ? ` · waiting on ${l.waitingOn}` : ""}`}
                tone="text-warn"
              />
            )}
            {!l.stuck && l.waitingOn && <Fact k="Waiting on" v={<Mono className="text-[10.5px]">{l.waitingOn}</Mono>} />}
            <Fact k="Started" v={ago(l.startedAt)} />
            <Fact k="Run file" v={<Mono className="text-[10px]">{l.id}</Mono>} />
            <div className="flex gap-2 px-4 py-3">
              {/* The run itself, followed live with its kill switch and steering, whoever started it. */}
              <Button size="sm" variant="solid" tone="ink" href={`/runs?id=${encodeURIComponent(l.id)}`}>
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
          <Fact k="Cost" v={r.cost !== null ? fmtCost(r.cost) : `${fmtCost(r.priced)} priced · ${unpricedLine(r.unpricedCalls)}`} tone={r.cost === null ? "text-warn" : undefined} />
          <Fact k="Tokens" v={`${fmtTokens(r.tokens.in)} in · ${fmtTokens(r.tokens.out)} out`} />
          <Fact k="Calls" v={`${r.modelCalls} model · ${r.toolCalls} tool`} />
          {r.artifacts > 0 && <Fact k="Artifacts" v={String(r.artifacts)} />}
          {r.denials > 0 && <Fact k="Guardrail denials" v={String(r.denials)} tone="text-warn" />}
          {r.byModel.length > 0 && (
            <div className="border-b border-line px-4 py-2.5">
              <span className="text-[11px] font-semibold text-dim">By model</span>
              {r.byModel.map((b) => (
                <div key={b.model} className="mt-1.5 flex items-center gap-2">
                  <span className="size-1.5 shrink-0 rounded-[2px] bg-run" />
                  <span className="min-w-0 grow truncate font-mono text-[10.5px] text-mist">{b.model}</span>
                  <span className="tnum text-[10.5px] text-dim">{fmtTokens(b.in + b.out)}</span>
                  <span className={`tnum min-w-14 text-right text-[10.5px] ${b.unpricedCalls ? "text-warn" : "text-mist"}`}>{partialCost(b.cost, b.unpricedCalls)}</span>
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
                    ? `the trace could not be read${traceFailure ? `: ${traceFailure}` : ""}`
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

  if (drill.kind === "versions") {
    const a = data.agents.find((x) => x.id === drill.id);
    return { title: `Versions · ${a?.name ?? drill.id}`, body: <VersionHistory agent={drill.id} /> };
  }

  if (drill.kind === "agent") {
    const a = data.agents.find((x) => x.id === drill.id);
    if (!a) return { title: "Agent", body: null };
    const mine = runs.filter((r) => r.system === a.id);
    const costByModel = new Map<string, { tokens: number; cost: number | null; unpriced: number }>();
    for (const r of mine) {
      for (const b of r.byModel) {
        const agg = costByModel.get(b.model) ?? { tokens: 0, cost: 0, unpriced: 0 };
        agg.tokens += b.in + b.out;
        agg.cost = agg.cost === null || b.cost === null ? null : agg.cost + b.cost;
        agg.unpriced += b.unpricedCalls;
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
          <Fact
            k="Versions"
            v={
              <Button size="sm" variant="quiet" onClick={() => onOpen({ kind: "versions", id: a.id })}>
                History and diff
              </Button>
            }
          />
          <Fact k="Runs" v={`${a.runs7d} in ${data.window} · ${a.runsTotal} total`} />
          {a.unpriced7d > 0 && <Fact k={`Calls with no price · ${data.window}`} v={String(a.unpriced7d)} tone="text-warn" />}
          <Fact k={`Avg time · ${data.window}`} v={fmtMs(a.avgMs7d)} />
          <Fact k={`Spend · ${data.window}`} v={partialCost(a.cost7d, a.unpriced7d)} tone={a.unpriced7d ? "text-warn" : undefined} />
          {a.pending > 0 && <Fact k="Awaiting approval" v={String(a.pending)} tone="text-warn" />}

          {a.evals === null && <Fact k="Benchmark" v={data.not_built.evals ? `Not built: ${data.not_built.evals}` : "not in the platform's answer"} />}
          {a.evals !== null && a.evals.length === 0 && <Fact k="Benchmark" v="none yet: no finished evaluation" />}
          {a.evals !== null && a.evals.length > 0 && (
            <div className="border-b border-line px-4 py-2.5">
              <span className="text-[11px] font-semibold text-dim">Benchmark history</span>
              {a.evals.map((e, i) => (
                <div key={i} className="mt-1.5 flex items-center gap-2 text-[11px]">
                  <span className={`tnum font-semibold ${e.passed === e.total ? "text-ok" : "text-warn"}`}>
                    {e.passed}/{e.total}
                  </span>
                  <Mono className="min-w-0 truncate text-[9.5px] text-faint">{e.model}</Mono>
                  <Mono className="text-[9.5px] text-ghost">spec {e.digest.slice(0, 8)}</Mono>
                  {benchmarkCaveat(e) && <span className="min-w-0 truncate text-[9.5px] text-warn" title={benchmarkCaveat(e)}>{benchmarkCaveat(e)}</span>}
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
                  <span className="size-1.5 shrink-0 rounded-[2px] bg-run" />
                  <span className="min-w-0 grow truncate font-mono text-[10.5px] text-mist">{m}</span>
                  <span className="tnum text-[10.5px] text-dim">{fmtTokens(agg.tokens)}</span>
                  <span className={`tnum min-w-14 text-right text-[10.5px] ${agg.unpriced ? "text-warn" : "text-mist"}`}>{partialCost(agg.cost, agg.unpriced)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2 px-4 py-3">
            <Button size="sm" variant="solid" tone="ink" href={`/runs?agent=${encodeURIComponent(a.id)}`}>
              Run
            </Button>
            <Button size="sm" variant="outline" href={agentHref(a.id)}>
              Open
            </Button>
            <Button size="sm" variant="outline" href={`/evals?agent=${encodeURIComponent(a.id)}`}>
              Benchmark
            </Button>
            <Button size="sm" variant="outline" href={`/drift?agent=${encodeURIComponent(a.id)}`}>
              Drift
            </Button>
            <Button size="sm" variant="outline" href={`/dependencies?node=${encodeURIComponent(`agent:${a.id}`)}`}>
              Dependencies
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
          <Fact k="Cost" v={d ? partialCost(d.cost, d.unpricedCalls) : "—"} tone={d?.unpricedCalls ? "text-warn" : undefined} />
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
          <Fact k={`Tokens · ${data.window}`} v={m ? `${fmtTokens(m.in)} in · ${fmtTokens(m.out)} out` : "—"} />
          <Fact k={`Cost · ${data.window}`} v={m ? partialCost(m.cost, m.unpricedCalls) : "—"} tone={m?.unpricedCalls ? "text-warn" : undefined} />
          {(m?.unpricedCalls ?? 0) > 0 && <Fact k="Calls with no price" v={String(m!.unpricedCalls)} tone="text-warn" />}
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
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-[12px] font-medium text-fg">{l.system}</span>
                    <RunSourceTag run={l} />
                  </span>
                  <span className="truncate font-mono text-[9.5px] text-faint">
                    {ago(l.startedAt)}
                    {l.state === "suspended" ? " · at a gate" : ""}
                  </span>
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
      return { title: `Runs · ${data.window}`, body: <><TruncatedNote data={data} /><RunList runs={recent} onOpen={onOpen} empty="No runs in this window." /></> };
    case "spend": {
      const priciest = [...recent].filter((r) => (r.priced ?? 0) > 0).sort((a, b) => (b.priced ?? 0) - (a.priced ?? 0));
      return {
        title: `Spend · ${data.window}`,
        body: (
          <div className="flex flex-col">
            <div className="border-b border-line px-4 py-2.5">
              <span className="text-[11px] font-semibold text-dim">By model</span>
              {data.models.map((m) => (
                <div key={m.model} className="mt-1.5 flex items-center gap-2">
                  <span className="size-1.5 shrink-0 rounded-[2px] bg-run" />
                  <span className="min-w-0 grow truncate font-mono text-[10.5px] text-mist">{m.model}</span>
                  {m.unpricedCalls > 0 && <span className="text-[10px] text-warn">{unpricedLine(m.unpricedCalls)}, not in the sum</span>}
                  <span className="tnum w-14 text-right text-[10.5px] text-mist">{m.cost === null && m.unpricedCalls ? "no price set" : fmtCost(m.cost)}</span>
                </div>
              ))}
            </div>
            <p className="px-4 pt-3 pb-1 text-[11px] font-semibold text-dim">Costliest runs, by their priced calls</p>
            <TruncatedNote data={data} />
            <RunList runs={priciest.slice(0, 10)} onOpen={onOpen} empty="No run in this window has a priced model call." />
          </div>
        ),
      };
    }
    case "time": {
      const slowest = [...recent].filter((r) => r.state === "done" || r.state === "failed" || r.state === "killed").sort((a, b) => b.ms - a.ms);
      // An average hides the tail, and the tail is what a person waits through. The percentiles are the platform's, over the window's ended runs.
      const lat = data.latency;
      return {
        title: `Run time · ${data.window}`,
        body: (
          <div className="flex flex-col">
            <Fact k="Ended runs measured" v={String(lat?.runs ?? 0)} />
            <Fact k="Median" v={fmtMs(lat?.p50 ?? null)} />
            <Fact k="95th percentile" v={fmtMs(lat?.p95 ?? null)} />
            <Fact k="99th percentile" v={fmtMs(lat?.p99 ?? null)} />
            <Fact k="Slowest" v={fmtMs(lat?.max ?? null)} />
            <div className="px-4 pt-2.5 pb-1">
              <span className="text-[11px] font-semibold text-dim">Slowest runs</span>
            </div>
            <RunList runs={slowest.slice(0, 12)} onOpen={onOpen} empty="No run in this window has ended." />
          </div>
        ),
      };
    }
    case "denials": {
      const hard = refusals?.rows ?? [];
      return {
        title: `Guardrail denials · ${data.window}`,
        body: (
          <div className="flex flex-col">
            {refusals === null && (
              <p className="px-4 py-3 text-[11.5px] text-faint">Reading the journals…</p>
            )}
            {refusals?.error && (
              <div className="px-4 py-3">
                <Failure what="The refusals could not be read" message={refusals.error} />
              </div>
            )}
            {refusals !== null && !refusals.error && hard.length === 0 && (
              <p className="px-4 py-4 text-[12px] leading-[1.55] text-faint">
                No call was refused in this window. The Guardrails page shows which controls are in
                force and how often each has fired.
              </p>
            )}
            {refusals !== null && refusals.total > hard.length && (
              <p className="border-b border-line px-4 py-2 text-[10.5px] text-faint">
                The newest {hard.length} of {refusals.total}.{" "}
                <Link href={`/explore?kind=refusal&window=${data.window}`} className="underline">
                  All of them in Explore
                </Link>
              </p>
            )}
            {hard.map((x, i) => {
              const why = explainControl(x.control);
              return (
                <button
                  key={`${x.id}-${i}`}
                  type="button"
                  onClick={() => x.run && onOpen({ kind: "run", id: x.run })}
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
        title: `Killed runs · ${data.window}`,
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
              empty="No run was killed in this window. When an operator throws the switch, the journalled decision lands here."
            />
          </div>
        ),
      };
  }
}

/* ═══════════════════ the optimizing triangle ═══════════════════ */

interface Corner {
  model: string;
  /** null when no call was priced, or when any was not: a sum that leaves calls out is no cost per run, and never "cheapest". */
  costPerRun: number | null;
  /** Calls on this model with no price set in the window. */
  unpricedCalls: number;
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
    // Production's runs only (a shadow run is in no figure), and only benchmarks that measured every case.
    const used = runs.filter((r) => !r.shadow && r.models.includes(m.model) && r.ms > 0);
    const evals = agents.flatMap((a) => (a.evals ?? []).filter((e) => e.model === m.model && !e.incomplete));
    const total = evals.reduce((s, e) => s + e.total, 0);
    return {
      model: m.model,
      runs: m.runs,
      costPerRun: m.cost === null || m.unpricedCalls > 0 ? null : m.cost / Math.max(1, m.runs),
      unpricedCalls: m.unpricedCalls,
      avgMs: used.length ? used.reduce((s, r) => s + r.ms, 0) / used.length : null,
      passRate: total ? evals.reduce((s, e) => s + e.passed, 0) / total : null,
      evalCases: total,
    };
  });
  // Log scale against the best in view, two decades wide: the cheapest or
  // fastest model scores 1, ten times worse scores 0.5, a hundred times worse
  // scores 0. Halving a bar always means the same thing, and the worst model
  // still has a shape instead of collapsing to a point.
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
  off = false,
  evalsWhy = "",
}: {
  /** The estate was not read: the key stays, and nothing is said about model calls that were not read. */
  off?: boolean;
  /** Why no agent has a benchmark, in the platform's words (`not_built.evals`); "" when it names none. */
  evalsWhy?: string;
  models: ModelRow[];
  runs: RunRow[];
  agents: AgentRow[];
  selected: string | null;
  onPick: (id: string) => void;
}) {
  const [view, setView] = useState<"profiles" | "table">("profiles");
  const corners = cornersOf(models, runs, agents);
  // Accuracy needs a benchmark: with none in the answer for any agent, the platform's own reason is said (`evalsWhy`), never one written here.
  const evalsBuilt = agents.some((a) => a.evals !== null);
  const noEvals = evalsBuilt ? "no evals" : evalsWhy ? "not built" : "not in the answer";
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
        meta="this window — one triangle per model"
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
                  <td className={`px-2 py-1.5 text-right ${c.unpricedCalls ? "text-warn" : ""}`}>{c.unpricedCalls ? `not known: ${c.unpricedCalls} unpriced` : fmtCost(c.costPerRun)}</td>
                  <td className="px-2 py-1.5 text-right">
                    {c.passRate === null ? noEvals : `${Math.round(c.passRate * 100)}% · ${c.evalCases}`}
                  </td>
                  <td className="px-2 py-1.5 text-right">{fmtMs(c.avgMs)}</td>
                  <td className="px-3 py-1.5 text-right">{c.runs}</td>
                </tr>
              ))}
              {!corners.length && !off && (
                <tr><td colSpan={5} className="px-3 py-3 text-faint">No model calls in this window.</td></tr>
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

          {!ranked.length && !off && (
            <p className="px-3 py-4 text-[12px] text-faint">No model calls in this window.</p>
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
                { k: "Accuracy", v: c.passRate === null ? noEvals : `${Math.round(c.passRate * 100)}%`, s: c.score.accuracy, sub: c.passRate === null ? "" : `${c.evalCases} cases` },
                { k: "Cost", v: c.unpricedCalls ? "not known" : fmtCost(c.costPerRun), s: c.score.cost, sub: c.unpricedCalls ? `${c.unpricedCalls} calls with no price` : "per run" },
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
            times worse, empty is a hundred times worse. Accuracy is the eval pass rate measured on that model
            {evalsBuilt ? "" : evalsWhy ? `; no model has one here, as the platform answers: ${evalsWhy}` : "; the platform's answer carries no benchmark for any agent, so no model has one"}. A model with calls that had no price has no cost per run.
            Click a model for the runs behind it.
          </p>
        </div>
      )}
    </>
  );
}

/* ═══════════════════ the trigger queue ═══════════════════ */

/** The intake as `GET /api/queue` answers it, read through the generated client (lib/api/l2.ts). */
type QueueData = QueueSummary;

/**
 * The intake, as numbers. Depth is the honest measure of "always on": a
 * queue that grows is a provider or a worker pool that cannot keep up, and
 * the oldest queued age says how far behind the estate is right now.
 */
function QueuePanel({ queue, error, now }: { queue: QueueData | null; error: string; now: number }) {
  // Where outside systems post: the platform's own address (the session's machineOrigin), never the console's.
  const machine = useMachineOrigin();
  if (!queue) return <p className="px-3 py-4 text-[12px] text-faint">{error ? `The trigger queue could not be read: ${error}` : "Reading the trigger queue…"}</p>;
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
        <p className="px-3 py-3 text-[11.5px] text-faint">
          Nothing posted in the last hour.{" "}
          {machine ? `External systems post to ${machine}/api/trigger/<agent>.` : machineLine(machine, "", "external systems cannot reach the trigger door")}
        </p>
      ) : (
        <div className="flex flex-col">
          <div className="grid grid-cols-[minmax(0,1fr)_repeat(5,52px)] items-center gap-1 border-b border-line px-3 py-1.5 text-[10px] text-faint">
            <span>agent</span>
            <span className="text-right">queued</span>
            <span className="text-right">running</span>
            <span className="text-right">done</span>
            <span className="text-right">failed</span>
            <span className="text-right" title={JOB_STATUS_META.cancelled.means}>
              cancelled
            </span>
          </div>
          {rows.map(([agent, a]) => (
            <div key={agent} className="grid grid-cols-[minmax(0,1fr)_repeat(5,52px)] items-center gap-1 border-b border-line px-3 py-2 text-[11.5px] last:border-b-0">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="truncate font-mono text-[11px] text-fg">{agent}</span>
                {a.oldest_queued && <span className="shrink-0 text-[10px] text-warn">oldest {age(a.oldest_queued)}</span>}
              </span>
              <span className={`tnum text-right ${(a.queued ?? 0) > 0 ? "font-semibold text-warn" : "text-dim"}`}>{a.queued ?? 0}</span>
              <span className={`tnum text-right ${(a.running ?? 0) > 0 ? "font-semibold text-run" : "text-dim"}`}>{a.running ?? 0}</span>
              <span className="tnum text-right text-dim">{a.done ?? 0}</span>
              <span className={`tnum text-right ${(a.failed ?? 0) > 0 ? "font-semibold text-err" : "text-dim"}`}>{a.failed ?? 0}</span>
              <span className="tnum text-right text-dim" title={JOB_STATUS_META.cancelled.means}>
                {countOf(a, "cancelled")}
              </span>
            </div>
          ))}
        </div>
      )}
      {queue.dead_letters.length > 0 && (
        <div className="flex flex-col border-t border-line">
          <span className="px-3 pt-2 text-[10px] text-faint" title={JOB_STATUS_META.dead.means}>
            dead letters
          </span>
          {queue.dead_letters.slice(0, 6).map((j) => (
            <span key={j.job} className="flex min-w-0 items-baseline gap-2 px-3 py-1 text-[10.5px]">
              <span className="shrink-0 font-mono text-fg">{j.agent}</span>
              {j.run_id ? (
                <Link href={`/runs?id=${encodeURIComponent(j.run_id)}`} className="focusable shrink-0 rounded-sm font-mono text-dim hover:underline">
                  {j.job.slice(0, 8)}
                </Link>
              ) : (
                <span className="shrink-0 font-mono text-ghost">{j.job.slice(0, 8)}</span>
              )}
              <span className={`min-w-0 truncate ${j.taint ? "text-warn" : "text-faint"}`} title={jobLine(j)}>
                {jobLine(j)}
              </span>
            </span>
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
