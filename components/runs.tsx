"use client";

import { CURRENT_USER } from "@/lib/user";
import { useSession, signerName } from "@/lib/use-session";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { soon } from "@/lib/soon";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, IconButton, Kbd, Label, Mono, RUN_STATE, Status, Tag } from "./ui";
import { Skeleton, Thinking } from "./loaders";
import { Field, Textarea } from "./forms";
import { Banner } from "./overlays";
import { Icon } from "./builder/icons";
import { Pick } from "./select";
import { fromDocument, HARNESS, inputKeysOf, toDocument, type AgentSystem, type Kind } from "@/lib/spec";
import { useModels } from "@/lib/use-models";
import { SpanDetail, Waterfall, useTrace, type Span } from "./waterfall";
import { explainControl } from "@/lib/guardrails";
import { ControlRef, KILL_CONTROL } from "./control-ref";
import { RunBoard, ViewSwitch, useRunView, type BoardEdge } from "./run-board";
import { api, errorText, subscribeRunEvents, type RunEnd, type Schemas } from "@/lib/api/client";
import { artefactsZipUrl, gateFromSuspension, listGates, lockdownRefusalOf, lockdownRefusalText, operatorOf, type Gate } from "@/lib/api/l5";
import { runSourceOf, type RunRowL6 } from "@/lib/api/l6";
import { exitText, sandboxLine, sandboxOfEntry, sandboxRunOf, SANDBOX_TOOL } from "@/lib/sandbox";
import { RunSourceTag } from "./run-source";
import { SandboxOutput, SandboxSummary } from "./sandbox-result";
import { KillDialog } from "./kill-dialog";
import { KillReceiptView, RunTreePanel } from "./run-tree";
import { RateLimitNote, useRetryReady } from "./rate-limit";
import { killRun, rateLimitOf, type KillReceipt, type RateLimit } from "@/lib/api/l7";
import { LineageDrawer } from "./lineage";
import { ApproveDialog } from "./approve";
import { SteerPanel } from "./steer";
import { followsLive, steerOffer } from "@/lib/steer";
import { agentDocument, listAgents } from "@/lib/api/l2";
import { Deadline, useNow } from "./gate-form";

/**
 * The runs console: where a workflow actually runs.
 *
 * The view is the landing page's run theater, verbatim in vocabulary — graph
 * rail with a filling spine, transcript with kind-specific rows, artifact rail,
 * scrubber — but over real journals. Live runs stream into it; finished runs
 * replay through the same scrubber, so reviewing a run and watching one are
 * the same room with the clock in a different place.
 */

/* ═══════════════════ Journal shapes ═══════════════════ */

interface Entry {
  id: string;
  t: number;
  kind: string;
  node?: string;
  title?: string;
  detail?: string;
  tainted?: boolean;
  /** The entries this one was derived from; the lineage drawer walks it both ways. */
  because?: string[];
  data?: {
    tool?: string;
    args?: Record<string, unknown>;
    value?: unknown;
    [k: string]: unknown;
  };
}

interface Suspension {
  node: string;
  approvers: string[];
  prompt: string;
  /** Absolute; null when the gate has none. */
  deadline: string | null;
  /** The suspension as the backend sent it (shape, items, chain, deadline), for the dialog when the inbox has not caught up. */
  raw: Record<string, unknown>;
}

interface OutputRecord {
  kind: string;
  ok: boolean;
  where?: string;
  error?: string;
}

/**
 * Journal time is monotonic within a leg, but a resumed run starts a fresh
 * clock. Display time must never run backwards, so a running offset folds the
 * legs into one line. Relative times within each leg stay honest.
 */
function normalise(entries: Entry[]): Entry[] {
  let offset = 0;
  let prev = -1;
  return entries.map((e) => {
    if (e.t + offset < prev) offset = prev;
    prev = e.t + offset;
    return { ...e, t: e.t + offset };
  });
}

function artifactsOf(entries: Entry[]): { name: string; kind: string; t: number }[] {
  const out: { name: string; kind: string; t: number }[] = [];
  for (const e of entries) {
    const v = (e.data?.value ?? {}) as Record<string, unknown>;
    const where =
      (e.kind === "tool.result" && v.written === true && String(v.where ?? "")) ||
      (e.kind === "note" && String(e.data?.where ?? "")) ||
      "";
    if (where) {
      const name = where.split("/").pop() ?? where;
      if (!out.some((a) => a.name === name)) {
        out.push({ name, kind: name.split(".").pop() ?? "file", t: e.t });
      }
    }
  }
  return out;
}

const clock = (ms: number) => {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};

/* ═══════════════════ Page routing ═══════════════════ */

export function Runs() {
  return (
    <Suspense>
      <RunsInner />
    </Suspense>
  );
}

function RunsInner() {
  const params = useSearchParams();
  const agent = params.get("agent");
  const draft = params.get("draft") === "1";
  const replay = params.get("id");

  if (agent || draft) return <LiveTheater agentId={agent} draft={draft} />;
  if (replay) return <ReplayTheater id={replay} />;
  return <Launcher />;
}

/* ═══════════════════ Launcher: pick something to run ═══════════════════ */

interface SavedAgent {
  id: string;
  name: string;
  description: string;
  nodes: number;
}

/** A row of the backend's run ledger, as the list shows it. `stuck` and `waiting_on` are L5's; `source` (an attached agent's SDK, or A2A) is L6's. */
type RunSummary = Pick<RunRowL6, "id" | "system" | "state" | "at" | "ms" | "denials" | "live" | "stuck" | "waiting_on" | "source">;

const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};

function StateBadge({ state }: { state: string }) {
  const s = RUN_STATE[state];
  return <Status tone={s?.tone ?? "queue"}>{s?.label ?? (state || "Ready")}</Status>;
}

function Launcher() {
  const [agents, setAgents] = useState<SavedAgent[] | null>(null);
  const [history, setHistory] = useState<RunSummary[] | null>(null);
  const [stateFilter, setStateFilter] = useState("");
  const router = useRouter();

  useEffect(() => {
    listAgents()
      .then((rows) => setAgents(rows.map((a) => ({ id: a.id, name: a.name, description: a.description ?? "", nodes: a.nodes }))))
      .catch(() => setAgents([]));
    api
      .GET("/api/runs")
      .then(({ data }) => setHistory(data?.runs ?? []))
      .catch(() => setHistory([]));
  }, []);

  return (
    <div className="min-h-full" data-hue="blue">
      <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-8 px-5 py-7">
        <header className="flex flex-col gap-1.5">
          <h1 className="text-[24px] font-semibold tracking-[-0.02em]">Runs</h1>
          <p className="max-w-[640px] text-[13.5px] leading-relaxed text-dim">
            Launch a workflow and follow its execution as it happens. Review each model and tool
            call, control decision, human approval and output in the resulting run record.
          </p>
        </header>

        <section className="flex flex-col gap-3">
          <h2>
            <Label>Run a workflow</Label>
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {agents === null &&
              [0, 1, 2].map((i) => (
                <div key={i} className="flex animate-pulse flex-col gap-3 rounded-lg border border-line bg-surface p-4">
                  <div className="flex items-center gap-2.5">
                    <span className="size-8 rounded-md bg-raise" />
                    <span className="h-3.5 w-32 rounded-sm bg-raise" />
                  </div>
                  <span className="h-3 w-full rounded-sm bg-raise" />
                  <span className="h-3 w-2/3 rounded-sm bg-raise" />
                </div>
              ))}
            {agents?.length === 0 && (
              <p className="col-span-full rounded-lg border border-dashed border-line-strong px-5 py-8 text-[12.5px] text-faint">
                Nothing saved yet — build something and press Save.
              </p>
            )}
            {(agents ?? []).map((a) => (
              <button
                key={a.id}
                onClick={() => router.push(`/runs?agent=${encodeURIComponent(a.id)}`)}
                className="focusable group flex cursor-pointer flex-col gap-2.5 rounded-lg border border-line bg-surface p-4 text-left elev-1 transition-[border-color,box-shadow,transform] duration-200 ease-[var(--ease-out)] hover:-translate-y-px hover:border-line-strong hover:elev-2"
              >
                <div className="flex items-center gap-2.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-md bg-raise text-dim">
                    <Icon name="workflow" size={15} />
                  </span>
                  <span className="min-w-0 truncate text-[13.5px] font-semibold text-fg">{a.name}</span>
                </div>
                {a.description && (
                  <p className="text-[11.5px] leading-[1.55] text-dim">{a.description}</p>
                )}
                <span className="mt-auto flex items-center gap-2 border-t border-line pt-2">
                  <Mono className="text-[10px] text-faint">{a.nodes} nodes</Mono>
                  <span className="grow" />
                  <span className="flex items-center gap-1 text-[11px] font-medium text-run opacity-0 transition-opacity group-hover:opacity-100">
                    Run
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M5 12h14M13 6l6 6-6 6" />
                    </svg>
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <h2>
              <Label>Previous runs</Label>
            </h2>
            <span className="grow" />
            {/* Filter by outcome — the list grows without bound. */}
            <div className="flex items-center gap-1">
              {["", "done", "failed", "suspended", "killed"].map((s) => (
                <button
                  key={s || "all"}
                  onClick={() => setStateFilter(s)}
                  aria-pressed={stateFilter === s}
                  className={`focusable cursor-pointer rounded-sm px-2 py-0.5 text-[11px] transition-colors ${
                    stateFilter === s
                      ? "bg-raise font-semibold text-fg"
                      : "font-medium text-faint hover:text-dim"
                  }`}
                >
                  {s ? (RUN_STATE[s]?.label ?? s) : "All"}
                  {s && history ? ` (${history.filter((r) => r.state === s).length})` : ""}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
            {history === null && (
              <div role="status" aria-label="Reading the record" className="px-4 py-5">
                <Skeleton lines={3} />
              </div>
            )}
            {history?.length === 0 && (
              <p className="px-4 py-5 text-[12px] text-faint">No runs recorded yet.</p>
            )}
            {(history ?? [])
              .filter((r) => !stateFilter || r.state === stateFilter)
              .map((r, i) => (
                <button
                  key={r.id}
                  onClick={() => router.push(`/runs?id=${encodeURIComponent(r.id)}`)}
                  className={`focusable flex cursor-pointer items-center gap-4 px-4 py-2.5 text-left transition-colors hover:bg-raise/60 ${
                    i > 0 ? "border-t border-line" : ""
                  }`}
                >
                  <div className="flex min-w-0 grow flex-col">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-fg">{r.system || r.id}</span>
                      <RunSourceTag run={r} />
                    </span>
                    <Mono className={`truncate text-[10.5px] ${r.stuck ? "text-warn" : "text-faint"}`}>
                      {r.id} · {ago(r.at)} · {(r.ms / 1000).toFixed(1)}s
                      {r.waiting_on ? ` · waiting on ${r.waiting_on}` : ""}
                    </Mono>
                  </div>
                  {r.stuck && <Status tone="warn">stuck</Status>}
                  {r.denials > 0 && <Status tone="err">{r.denials} refused</Status>}
                  <StateBadge state={r.state} />
                </button>
              ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ═══════════════════ Live theater ═══════════════════ */

function seedInput(s: AgentSystem): string {
  const entry = s.nodes.find((n) => n.id === s.entry);
  if (!entry) return "{}";
  const seed: Record<string, unknown> = {};
  const blank = { string: "", number: 0, bool: false, object: {}, list: [], any: null } as const;
  for (const f of entry.expects ?? []) seed[f.name] = blank[f.kind] ?? null;
  const produced = new Set((entry.steps ?? []).map((st) => st.emits).filter(Boolean));
  for (const st of entry.steps ?? []) {
    const text = `${st.prompt ?? ""} ${JSON.stringify(st.args ?? {})}`;
    for (const m of text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
      if (!produced.has(m[1]) && !(m[1] in seed)) seed[m[1]] = "";
    }
  }
  return JSON.stringify(seed, null, 2);
}

function LiveTheater({ agentId, draft }: { agentId: string | null; draft: boolean }) {
  const [system, setSystem] = useState<AgentSystem | null>(null);
  const [loadError, setLoadError] = useState("");
  const { models, defaultModel } = useModels();
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [input, setInput] = useState("{}");
  // The spec names its own inputs; typed fields are the default, JSON the escape hatch.
  const [fields, setFields] = useState<{ name: string; kind: Kind; value: string }[]>([]);
  const [jsonMode, setJsonMode] = useState(false);
  const [killing, setKilling] = useState(false);

  const [phase, setPhase] = useState<"setup" | "live" | "done">("setup");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [suspension, setSuspension] = useState<Suspension | null>(null);
  const [outputs, setOutputs] = useState<OutputRecord[]>([]);
  const [finalState, setFinalState] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  // The run's id, as the backend minted it: what a resume, a kill, the event
  // stream and the cost lookup all refer to. The state twin is for what
  // renders by it (the steering panel, the artefact bundle link).
  const runId = useRef("");
  const [liveRunId, setLiveRunId] = useState("");
  const abort = useRef<AbortController | null>(null);
  // Closes the event stream. The backend replays the whole journal on every
  // (re)connection, so entries are deduplicated by id across legs here.
  const stop = useRef<(() => void) | null>(null);
  const seen = useRef(new Set<string>());
  // Journal time restarts on a resumed leg; an offset folds the legs onto one clock.
  const legOffset = useRef(0);
  const lastRaw = useRef(0);
  const maxT = useRef(0);
  /** The run the kill dialog is asking about, by id; null when it is closed. */
  const [killAsk, setKillAsk] = useState<string | null>(null);
  /** What the kill reached: the run and its whole tree (L7). */
  const [receipt, setReceipt] = useState<KillReceipt | null>(null);
  /** A start refused for a rate limit (429): nothing started; the form stays, with the limit and a countdown. */
  const [limited, setLimited] = useState<{ limit: RateLimit; at: number } | null>(null);
  const retry = useRetryReady(limited?.limit ?? null, limited?.at ?? 0);
  // Wall clock: the journal ticks only when entries land; a 40-second tool
  // call must not look like a hang.
  const startedAt = useRef(0);
  const [wallMs, setWallMs] = useState(0);
  // The number an approver asks first: what did this run cost. Read from the
  // control plane's price math once the journal is settled; unknown stays "—".
  const [runCost, setRunCost] = useState<string | null>(null);

  useEffect(() => {
    if (phase !== "live") return;
    const id = setInterval(() => setWallMs(Date.now() - startedAt.current), 1000);
    return () => clearInterval(id);
  }, [phase]);
  // The journal's clock: the latest folded time on the transcript.
  const journalMs = useMemo(() => entries.reduce((m, e) => Math.max(m, e.t), 0), [entries]);

  /* The spec: from the registry, or handed over from the builder as a draft. */
  useEffect(() => {
    if (draft) {
      return soon(() => {
        try {
          const raw = sessionStorage.getItem("af-run-draft");
          if (!raw) throw new Error("no draft was handed over — go back to the builder");
          setSystem(fromDocument(JSON.parse(raw)));
        } catch (e) {
          setLoadError((e as Error).message);
        }
      });
    }
    if (!agentId) return;
    agentDocument(agentId)
      .then((doc) => setSystem(fromDocument(doc)))
      .catch((e) => setLoadError((e as Error).message));
  }, [agentId, draft]);

  // A new spec seeds the form during render, so the inputs never show a stale shape for a frame.
  const [seededFor, setSeededFor] = useState<typeof system>(null);
  if (system && system !== seededFor) {
    setSeededFor(system);
    setInput(seedInput(system));
    setFields(inputKeysOf(system).map((k) => ({ ...k, value: "" })));
  }
  useEffect(
    () => () => {
      abort.current?.abort();
      stop.current?.();
    },
    [],
  );

  /** The run settled — done, failed, killed — or stopped at a gate. */
  const settle = useCallback(async (end: RunEnd) => {
    const id = runId.current;
    let suspension = end.suspension;
    let result = end.result;
    if (end.state === "suspended" && !suspension && id) {
      // A live stream's end names the state; the gate itself is on the run record.
      const { data } = await api.GET("/api/runs/{run_id}", { params: { path: { run_id: id } } });
      suspension = data?.suspension ?? null;
      if (data?.result && Object.keys(data.result).length) result = data.result;
    }
    if (result && Object.keys(result).length) setResult(result);
    setFinalState(end.state);
    if (end.state === "suspended" && suspension) {
      const raw = suspension as unknown as Record<string, unknown>;
      setSuspension({ node: suspension.node, approvers: suspension.approvers ?? [], prompt: suspension.prompt ?? "", deadline: typeof raw.deadline === "string" ? raw.deadline : null, raw });
    } else {
      setPhase("done");
    }
    if (end.error) setError(end.error);
    if (id) {
      fetch("/api/control")
        .then((r) => r.json())
        .then((d) => {
          const row = (d.runs ?? []).find((x: { id: string }) => x.id === id);
          if (!row) return;
          setRunCost(
            row.cost === null ? "cost —" : row.cost === 0 ? "$0.00" : row.cost < 0.005 ? "<$0.01" : `$${row.cost.toFixed(2)}`,
          );
        })
        .catch(() => {});
    }
  }, []);

  /** Follow the run's journal from the backend until it ends; a resumed leg joins the same transcript. */
  const follow = useCallback(
    (id: string) => {
      stop.current?.();
      stop.current = subscribeRunEvents(id, {
        onEntry: (e) => {
          if (seen.current.has(e.id)) return;
          seen.current.add(e.id);
          if (e.t < lastRaw.current) legOffset.current = maxT.current;
          lastRaw.current = e.t;
          const t = e.t + legOffset.current;
          maxT.current = Math.max(maxT.current, t);
          setEntries((prev) => [...prev, { ...(e as unknown as Entry), t }]);
        },
        onEnd: (end) => void settle(end),
        onError: async (message) => {
          // The stream is gone; the run may not be. Its record says.
          const { data } = await api.GET("/api/runs/{run_id}", { params: { path: { run_id: id } } });
          if (data && data.state !== "running") {
            void settle({ state: data.state, error: data.error ?? "", result: data.result ?? {}, suspension: data.suspension ?? null });
            return;
          }
          setError(message);
          setPhase("done");
          setFinalState(data?.state ?? "unknown");
        },
      });
    },
    [settle],
  );

  /** POST /api/runs, then follow the stream. A saved workflow goes by name; a draft travels as its spec. */
  const launch = async (parsed: Record<string, unknown>) => {
    if (!system) return;
    setPhase("live");
    setError("");
    setSuspension(null);
    startedAt.current = Date.now();
    setWallMs(0);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const { data, error, response } = await api.POST("/api/runs", {
        body: {
          ...(agentId && !draft ? { agent: agentId } : { spec: toDocument(system) as Record<string, unknown> }),
          input: parsed,
          model: model || defaultModel,
          provider: "foundry",
        },
        signal: ctrl.signal,
      });
      if (!data) {
        // A rate limit (429) started nothing: back to the form, saying whose
        // limit, which, the figures and when to retry.
        const rl = rateLimitOf(response.status, error, response.headers.get("retry-after"));
        if (rl) {
          setLimited({ limit: rl, at: Date.now() });
          setPhase("setup");
          return;
        }
        // A lockdown refuses every start (423): say why, who set it and how it ends, not the door's instructions.
        const locked = lockdownRefusalOf(response.status, error);
        setError(locked ? lockdownRefusalText(locked) : errorText(error, response));
        setPhase("done");
        setFinalState("failed");
        return;
      }
      runId.current = data.run;
      setLiveRunId(data.run);
      follow(data.run);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError((e as Error).message);
      setPhase("done");
      setFinalState("failed");
    }
  };

  const start = () => {
    if (!system) return;
    let parsed: Record<string, unknown>;
    if (system.trigger?.kind === "prompt") {
      const entry = system.nodes.find((n) => n.id === system.entry);
      const field = entry?.expects?.find((f) => f.kind === "string")?.name ?? "topic";
      parsed = { [field]: prompt };
    } else if (!jsonMode && fields.length) {
      parsed = Object.fromEntries(
        fields.map((f) => [
          f.name,
          f.kind === "number"
            ? Number(f.value) || 0
            : f.kind === "bool"
              ? f.value === "true"
              : f.kind === "object" || f.kind === "list"
                ? (() => {
                    try {
                      return JSON.parse(f.value || (f.kind === "list" ? "[]" : "{}"));
                    } catch {
                      return f.value;
                    }
                  })()
                : f.value,
        ]),
      );
    } else {
      try {
        parsed = JSON.parse(input || "{}");
      } catch (e) {
        setError(`The input is not valid JSON — ${(e as Error).message}`);
        return;
      }
    }
    setEntries([]);
    setOutputs([]);
    setResult(null);
    setSuspension(null);
    setKilling(false);
    setReceipt(null);
    setLimited(null);
    runId.current = "";
    setLiveRunId("");
    maxT.current = 0;
    seen.current = new Set();
    legOffset.current = 0;
    lastRaw.current = 0;
    stop.current?.();
    void launch(parsed);
  };

  /** The gate was answered through the inbox dialog; the backend signed and resumed, and the stream picks up the new leg. */
  const answered = () => {
    const id = runId.current;
    if (!id) return;
    setError("");
    setSuspension(null);
    setPhase("live");
    startedAt.current = Date.now();
    setWallMs(0);
    follow(id);
  };

  if (loadError) {
    return (
      <div className="mx-auto max-w-[720px] px-6 py-10">
        <Banner tone="err" title="Could not load the workflow">
          {loadError}
        </Banner>
      </div>
    );
  }
  if (!system) return <p className="px-8 py-10 text-[12.5px] text-faint">Loading the workflow…</p>;

  return (
    <>
      {killAsk && (
        <KillDialog
          title="Kill this run and its tree?"
          what={`${system.name} · ${killAsk}. The backend cancels it before its next model or tool call, and the kill reaches everything it set off: in-process sub-runs stop with it, child runs are killed where they run, queued children are dead-lettered. The journal records the reason and your name.`}
          onClose={() => setKillAsk(null)}
          onConfirm={(reason) => {
            const id = killAsk;
            setKillAsk(null);
            setKilling(true);
            killRun(id, reason)
              .then((r) => setReceipt(r))
              .catch((e: Error) => {
                setKilling(false);
                setError(e.message);
              });
          }}
        />
      )}
    <Theater
      title={system.name}
      subtitle={system.id}
      runId={liveRunId || undefined}
      agentId={system.id}
      nodes={system.nodes.map((n) => ({ id: n.id, label: n.label || n.id, kind: n.harness }))}
      edges={system.edges.map((e) => ({ source: e.source, target: e.target, when: e.when, label: e.label }))}
      entries={entries}
      live={phase === "live" && !suspension}
      finalState={suspension ? "suspended" : phase === "done" ? finalState : phase === "live" ? "running" : ""}
      error={error}
      outputs={outputs}
      result={result}
      suspension={suspension}
      onAnswered={answered}
      runLive={phase === "live" && !suspension}
      notice={receipt ? <KillReceiptView receipt={receipt} onDismiss={() => setReceipt(null)} /> : null}
      steer={liveRunId && phase === "live" && !suspension ? <SteerPanel runId={liveRunId} /> : null}
      setup={
        phase === "setup" ? (
          <div className="flex flex-col gap-3 border-b border-line bg-raise/40 px-4 py-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[280px] grow">
                {system.trigger?.kind === "prompt" ? (
                  <Field label="Prompt">
                    <Textarea
                      rows={2}
                      value={prompt}
                      onChange={setPrompt}
                      placeholder={String(system.trigger.config?.placeholder ?? "What should this run look at?")}
                    />
                  </Field>
                ) : jsonMode || !fields.length ? (
                  <div className="flex flex-col gap-1.5">
                    <span className="flex items-center gap-2 text-[12px] font-medium text-mist">
                      Input
                      {fields.length > 0 && (
                        <Button size="sm" variant="quiet" onClick={() => setJsonMode(false)}>
                          back to fields
                        </Button>
                      )}
                    </span>
                    <Textarea
                      rows={3}
                      value={input}
                      onChange={(v) => {
                        setInput(v);
                        setError("");
                      }}
                      invalid={Boolean(error)}
                      mono
                      aria-label="Input as JSON"
                    />
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <span className="flex items-center gap-2 text-[12px] font-medium text-mist">
                      Input
                      <span className="text-[10.5px] font-normal text-ghost">
                        fields from the spec itself
                      </span>
                      <Button size="sm" variant="quiet" onClick={() => setJsonMode(true)}>
                        edit as JSON
                      </Button>
                    </span>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {fields.map((f, i) => (
                        <label key={f.name} className="flex flex-col gap-1">
                          <span className="font-mono text-[10px] text-faint">
                            {f.name}
                            {f.kind !== "string" && <span className="text-ghost"> · {f.kind}</span>}
                          </span>
                          {f.kind === "bool" ? (
                            <Pick
                              value={f.value || "false"}
                              onChange={(v) =>
                                setFields((fs) => fs.map((x, j) => (j === i ? { ...x, value: v } : x)))
                              }
                              options={[
                                { value: "false", label: "false" },
                                { value: "true", label: "true" },
                              ]}
                            />
                          ) : (
                            <Textarea
                              rows={1}
                              value={f.value}
                              onChange={(v) =>
                                setFields((fs) => fs.map((x, j) => (j === i ? { ...x, value: v } : x)))
                              }
                            />
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {error && (
                  <p className="pt-1.5 text-[11.5px] text-err" role="alert">
                    {error}
                  </p>
                )}
                {limited && (
                  <div className="pt-2">
                    <RateLimitNote limit={limited.limit} readAt={limited.at} />
                  </div>
                )}
              </div>
              <div className="w-[190px]">
                <span className="mb-1.5 block text-[12px] font-medium text-mist">Model</span>
                <Pick
                  value={model || defaultModel}
                  onChange={setModel}
                  options={models.map((m) => ({ value: m.id, label: m.label }))}
                />
              </div>
              <Button tone="ink" variant="solid" permission="run" onClick={start} disabled={!retry.ready} className="shrink-0 px-5">
                {retry.ready ? "Run" : `Retry in ${retry.left}s`}
              </Button>
            </div>
          </div>
        ) : null
      }
      footer={
        phase === "live" && !suspension ? (
          <div className="flex h-11 shrink-0 items-center gap-3 border-t border-line bg-surface px-4">
            <Thinking height={10} />
            <span className="text-[12px] text-dim">
              {killing ? "kill requested — the journal records it in a moment" : "running — every entry lands as the runtime writes it"}
            </span>
            <span className="grow" />
            <Mono className="tnum text-[11px] text-faint">{clock(Math.max(journalMs, wallMs))}</Mono>
            <Button
              tone="err"
              variant="solid"
              size="sm"
              permission="run"
              onClick={() => {
                if (runId.current) {
                  // The real kill switch: the backend cancels the run, which
                  // journals the reason and who threw it. The stream stays
                  // open so the kill lands in the transcript in front of you.
                  setKillAsk(runId.current);
                } else {
                  // Not started yet — the request is still on its way.
                  abort.current?.abort();
                  setPhase("done");
                  setFinalState("killed");
                  setError("stopped before the backend registered the run");
                }
              }}
              loading={killing}
            >
              {killing ? "Killing…" : "Kill run"}
            </Button>
          </div>
        ) : phase === "done" || suspension ? (
          <div className="flex h-11 shrink-0 items-center gap-3 border-t border-line bg-surface px-4">
            <StateBadge state={suspension ? "suspended" : finalState} />
            {error && <span className="min-w-0 truncate text-[11.5px] text-err">{error}</span>}
            <span className="grow" />
            {runCost && <Mono className="tnum text-[11px] text-faint">{runCost}</Mono>}
            <Mono className="tnum text-[11px] text-faint">{clock(journalMs)}</Mono>
            <Button
              tone="ink"
              variant="solid"
              size="sm"
              onClick={() => {
                setPhase("setup");
                setEntries([]);
                setOutputs([]);
                setResult(null);
                setSuspension(null);
                setFinalState("");
                setError("");
                setKilling(false);
                setReceipt(null);
                runId.current = "";
                setLiveRunId("");
                maxT.current = 0;
                seen.current = new Set();
                legOffset.current = 0;
                lastRaw.current = 0;
                stop.current?.();
              }}
            >
              Run again
            </Button>
          </div>
        ) : null
      }
    />
    </>
  );
}

/* ═══════════════════ Replay theater ═══════════════════ */

function ReplayTheater({ id }: { id: string }) {
  // A run followed while in flight is read again once it settles, from a
  // fresh mount, so its replay opens at the outcome like any other.
  const [reads, setReads] = useState(0);
  return <RunRecord key={`${id}:${reads}`} id={id} onReread={() => setReads((n) => n + 1)} />;
}

function RunRecord({ id, onReread }: { id: string; onReread: () => void }) {
  const params = useSearchParams();
  // The journal as the record holds it; the display folds resumed legs onto one clock.
  const [raw, setRaw] = useState<Entry[] | null>(null);
  const entries = useMemo(() => (raw ? normalise(raw) : null), [raw]);
  const [meta, setMeta] = useState<{
    system: string;
    runId: string;
    state: string;
    error: string;
    result: Record<string, unknown> | null;
    /** `sdk` or `a2a` for a run an attached agent opened; `worker` for a queued job's; "" for the platform's own. */
    source: string;
    startedAt: string;
    /** A kill asked of the run and not yet taken: an SDK agent takes it on its next control poll, which may be a while. */
    kill: Schemas["KillInfo"] | null;
    /** When the run finished; "" while an SDK agent still holds it open. */
    finishedAt: string;
  }>({ system: "", runId: "", state: "", error: "", result: null, source: "", startedAt: "", kill: null, finishedAt: "" });
  const [specNodes, setSpecNodes] = useState<{ id: string; label: string; kind: string }[] | null>(null);
  const [specEdges, setSpecEdges] = useState<BoardEdge[]>([]);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    api
      .GET("/api/runs/{run_id}", { params: { path: { run_id: id } } })
      .then(({ data, error, response }) => {
        if (!data) throw new Error(errorText(error, response));
        setRaw((data.journal?.entries ?? []) as unknown as Entry[]);
        setMeta({
          system: data.system ?? "",
          runId: data.id ?? "",
          state: data.state ?? "",
          error: data.error ?? "",
          result: data.result ?? null,
          source: runSourceOf(data),
          startedAt: typeof data.started_at === "string" ? data.started_at : "",
          kill: data.kill ?? null,
          finishedAt: typeof data.finished_at === "string" ? data.finished_at : "",
        });
      })
      .catch((e) => setLoadError((e as Error).message));
  }, [id]);

  /* The full spine comes from the spec, so the nodes a run never reached are
     visible as never-reached — what a run didn't do is part of the review. */
  useEffect(() => {
    if (!meta.system) return;
    let stop = false;
    agentDocument(meta.system)
      .then((doc) => {
        if (stop) return;
        const s = fromDocument(doc);
        setSpecNodes(s.nodes.map((n) => ({ id: n.id, label: n.label || n.id, kind: n.harness })));
        setSpecEdges(s.edges.map((e) => ({ source: e.source, target: e.target, when: e.when, label: e.label })));
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [meta.system]);

  const duration = useMemo(() => (entries?.length ? entries[entries.length - 1].t : 0), [entries]);
  // Review opens at the outcome, paused — a reviewer starts from the verdict,
  // not from a screensaver. ?t= deep-links a moment.
  const openAt = params.get("t");
  const playback = usePlayback(duration, Boolean(entries?.length), openAt ? Number(openAt) : duration);
  // Opened in the agents view, a replay is a film: it plays from the start.
  const [view] = useRunView();
  const rolled = useRef(false);
  useEffect(() => {
    // A run in flight is followed, not replayed (FollowTheater below).
    if (rolled.current || !entries?.length || openAt || view !== "cards" || followsLive({ state: meta.state, source: meta.source, finished_at: meta.finishedAt })) return;
    rolled.current = true;
    playback.seek(0);
    playback.setPlaying(true);
  }, [entries, openAt, view, playback, meta.state, meta.source, meta.finishedAt]);


  const marks = useMemo(
    () => (entries ?? []).filter((e) => e.kind === "node.enter").map((e) => e.t),
    [entries],
  );
  const loud = useMemo(
    () =>
      (entries ?? [])
        .filter((e) => e.kind === "denied" || e.kind === "contract.breach" || e.kind === "error")
        .map((e) => ({ t: e.t, title: `${e.kind} · ${e.title ?? ""}` })),
    [entries],
  );

  /* Node bands for the scrubber: each node owns the stretch of the clock from
     its first entry to the next node's — the run's anatomy, in colour. */
  const segments = useMemo(() => {
    const enters = (entries ?? []).filter((e) => e.kind === "node.enter" && e.node);
    return enters.map((e, i) => ({
      id: String(e.node),
      label: e.title || String(e.node),
      from: e.t,
      to: i + 1 < enters.length ? enters[i + 1].t : duration,
    }));
  }, [entries, duration]);

  /* Every journal entry as a typed tick on the timeline. */
  const ticks = useMemo(
    () =>
      (entries ?? [])
        .filter((e) => e.kind !== "tool.result")
        .map((e) => ({ t: e.t, kind: e.kind, title: `${ROW[e.kind]?.label ?? e.kind} · ${e.title ?? ""}` })),
    [entries],
  );

  /* Keyboard parity with the landing theater: space plays, arrows step. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
      if (e.key === " ") {
        e.preventDefault();
        playback.setPlaying((p) => !p);
      } else if (e.key === "ArrowRight") {
        playback.step(1, marks);
      } else if (e.key === "ArrowLeft") {
        playback.step(-1, marks);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playback, marks]);

  const nodes = useMemo(() => {
    if (specNodes) return specNodes;
    const seen: { id: string; label: string; kind: string }[] = [];
    for (const e of entries ?? []) {
      if (e.kind === "node.enter" && e.node && !seen.some((n) => n.id === e.node)) {
        seen.push({ id: e.node, label: e.title || e.node, kind: "" });
      }
    }
    return seen;
  }, [entries, specNodes]);

  if (loadError) {
    return (
      <div className="mx-auto max-w-[720px] px-6 py-10">
        <Banner tone="err" title="Could not load the run">
          {loadError}
        </Banner>
      </div>
    );
  }
  if (!entries || !raw) return <p className="px-8 py-10 text-[12.5px] text-faint">Loading the journal…</p>;

  // Still in flight: follow it live, with the kill switch and the steering
  // a run launched here would have, whoever started it. An SDK run its agent
  // holds open at a gate is in flight too: it is answered, steered and
  // killed from here.
  if (followsLive({ state: meta.state, source: meta.source, finished_at: meta.finishedAt })) {
    return (
      <FollowTheater
        id={meta.runId || id}
        system={meta.system}
        source={meta.source}
        startedAt={meta.startedAt}
        pendingKill={meta.kill}
        initial={raw}
        specNodes={specNodes}
        edges={specEdges}
        onReplay={onReread}
      />
    );
  }

  const atEnd = playback.t >= duration;
  const visible = entries.filter((e) => e.t <= playback.t);

  return (
    <Theater
      title={meta.system}
      subtitle={meta.runId}
      runId={meta.runId}
      nodes={nodes}
      edges={specEdges}
      entries={visible}
      allEntries={entries}
      onRestart={() => {
        playback.seek(0);
        playback.setPlaying(true);
      }}
      live={playback.playing}
      // The state is a fact about the record, not about the scrub position.
      finalState={meta.state}
      error={atEnd ? meta.error : ""}
      outputs={[]}
      result={atEnd ? meta.result : null}
      suspension={null}
      onAnswered={() => {}}
      setup={null}
      segments={segments}
      tNow={playback.t}
      traceOf={id}
      source={meta.source}
      runLive={false}
      footer={
        <Scrubber
          t={playback.t}
          duration={duration}
          playing={playback.playing}
          setPlaying={playback.setPlaying}
          seek={playback.seek}
          step={playback.step}
          speed={playback.speed}
          setSpeed={playback.setSpeed}
          marks={marks}
          segments={segments}
          ticks={ticks}
          loud={loud}
        />
      }
    />
  );
}

/* ═══════════════════ Following a run in flight ═══════════════════ */

/**
 * A run still in flight, opened by its id rather than launched here: a
 * worker's, another tab's, or one an attached agent opened through the SDK
 * (phase L6). It is followed, not replayed: the event stream replays the
 * journal so far and then delivers each entry as it is written, and the run
 * is operated exactly as the live theater operates one launched here: Kill
 * in the footer, Steer in the rail, a gate answered from the banner. For an
 * SDK run the backend relays the kill, the steering and the gate's answer
 * on the SDK's control long-poll; this page calls the same doors either way.
 */
function FollowTheater({
  id,
  system,
  source,
  startedAt,
  pendingKill = null,
  initial,
  specNodes,
  edges,
  onReplay,
}: {
  id: string;
  system: string;
  source: string;
  /** When the run started, for the clock between entries; "" when the record does not say. */
  startedAt: string;
  /** A kill already on the record when the page opened, not yet taken by the run. */
  pendingKill?: Schemas["KillInfo"] | null;
  /** The journal as the record held it when the page opened, before the legs are folded. */
  initial: Entry[];
  /** The spec's nodes, when the agent has a spec here; an SDK agent's run draws its nodes as it enters them. */
  specNodes: { id: string; label: string; kind: string }[] | null;
  edges: BoardEdge[];
  /** The run settled: read the record again and replay it. */
  onReplay: () => void;
}) {
  const [raw, setRaw] = useState<Entry[]>(initial);
  // The stream replays the whole journal on every (re)connection; entries are deduplicated by id.
  const seen = useRef(new Set(initial.map((e) => e.id)));
  const [state, setState] = useState("running");
  const [suspension, setSuspension] = useState<Suspension | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [killAsk, setKillAsk] = useState(false);
  const [killing, setKilling] = useState(false);
  // The kill as the backend took it: for an SDK run it waits on the row until the agent polls.
  const [killed, setKilled] = useState<Schemas["KillInfo"] | null>(pendingKill);
  /** What the kill reached: the run and its whole tree (L7). */
  const [receipt, setReceipt] = useState<KillReceipt | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const entries = useMemo(() => normalise(raw), [raw]);
  const nodes = useMemo(() => {
    if (specNodes) return specNodes;
    const seen: { id: string; label: string; kind: string }[] = [];
    for (const e of entries) {
      if (e.kind === "node.enter" && e.node && !seen.some((n) => n.id === e.node)) seen.push({ id: e.node, label: e.title || e.node, kind: "" });
    }
    return seen;
  }, [entries, specNodes]);
  const journalMs = entries.length ? entries[entries.length - 1].t : 0;
  const running = state === "running" && !suspension;
  const sdk = source === "sdk";
  // An SDK run waiting at a gate still takes guidance and a model on its control poll; the hold is not offered there.
  const offer = steerOffer({ state, atGate: Boolean(suspension), source });

  // Wall clock: the journal ticks only when entries land; a 40-second tool
  // call must not look like a hang.
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  const since = Date.parse(startedAt);
  const elapsed = Number.isNaN(since) ? journalMs : Math.max(journalMs, now - since);

  /** The run settled, or stopped at a gate. */
  const settle = useCallback(
    async (end: RunEnd) => {
      let susp = end.suspension;
      let res = end.result;
      if (end.state === "suspended" && !susp) {
        // A live stream's end names the state; the gate itself is on the run record.
        const { data } = await api.GET("/api/runs/{run_id}", { params: { path: { run_id: id } } });
        susp = data?.suspension ?? null;
        if (data?.result && Object.keys(data.result).length) res = data.result;
      }
      if (res && Object.keys(res).length) setResult(res);
      setKilling(false);
      if (end.state === "suspended" && susp) {
        const r = susp as unknown as Record<string, unknown>;
        setSuspension({ node: susp.node, approvers: susp.approvers ?? [], prompt: susp.prompt ?? "", deadline: typeof r.deadline === "string" ? r.deadline : null, raw: r });
      }
      setState(end.state);
      if (end.error) setError(end.error);
    },
    [id],
  );

  const follow = useCallback(() => {
    stop.current?.();
    stop.current = subscribeRunEvents(id, {
      onEntry: (e) => {
        if (seen.current.has(e.id)) return;
        seen.current.add(e.id);
        setRaw((prev) => [...prev, e as unknown as Entry]);
      },
      onEnd: (end) => void settle(end),
      onError: async (message) => {
        // The stream is gone; the run may not be. Its record says.
        const { data } = await api.GET("/api/runs/{run_id}", { params: { path: { run_id: id } } });
        if (data && data.state !== "running") {
          void settle({ state: data.state, error: data.error ?? "", result: data.result ?? {}, suspension: data.suspension ?? null });
          return;
        }
        setError(message);
      },
    });
  }, [id, settle]);

  useEffect(() => {
    follow();
    return () => stop.current?.();
  }, [follow]);

  /** The gate was answered through the inbox dialog; the stream picks up the new leg. */
  const answered = () => {
    setSuspension(null);
    setState("running");
    setError("");
    follow();
  };

  return (
    <>
      {killAsk && (
        <KillDialog
          title="Kill this run and its tree?"
          what={`${system || "run"} · ${id}. ${
            sdk ? "The agent's SDK receives the kill on its control channel and stops before its next model or tool call" : "The backend cancels it before its next model or tool call"
          }, and the kill reaches everything it set off: in-process sub-runs stop with it, child runs are killed where they run, queued children are dead-lettered. The journal records the reason and your name.`}
          onClose={() => setKillAsk(false)}
          onConfirm={(reason) => {
            setKillAsk(false);
            setKilling(true);
            killRun(id, reason)
              .then((r) => {
                setKilled(r.kill);
                setReceipt(r);
              })
              .catch((e: Error) => {
                setKilling(false);
                setError(e.message);
              });
          }}
        />
      )}
      <Theater
        title={system}
        subtitle={id}
        runId={id}
        agentId={system}
        source={source}
        nodes={nodes}
        edges={edges}
        entries={entries}
        live={running}
        finalState={suspension ? "suspended" : state}
        error={error}
        outputs={[]}
        result={result}
        suspension={suspension}
        onAnswered={answered}
        runLive={running}
        notice={receipt ? <KillReceiptView receipt={receipt} onDismiss={() => setReceipt(null)} /> : null}
        steer={offer.show ? <SteerPanel runId={id} holdBlocked={offer.hold.allowed ? undefined : offer.hold.reason} /> : null}
        setup={null}
        footer={
          running ? (
            <div className="flex h-11 shrink-0 items-center gap-3 border-t border-line bg-surface px-4">
              <Thinking height={10} />
              <span className="min-w-0 truncate text-[12px] text-dim">
                {sdk && (killing || killed)
                  ? `kill requested${killed?.by ? ` by ${killed.by}` : ""} — the agent's SDK takes it on its next control poll and stops before its next model or tool call`
                  : killing
                    ? "kill requested — the journal records it in a moment"
                    : sdk
                      ? "following — the agent's SDK sends each entry as it is written"
                      : "following — every entry lands as the runtime writes it"}
              </span>
              {error && <span className="min-w-0 truncate text-[11.5px] text-err">{error}</span>}
              <span className="grow" />
              <Mono className="tnum text-[11px] text-faint">{clock(elapsed)}</Mono>
              <Button tone="err" variant="solid" size="sm" permission="run" loading={killing} onClick={() => setKillAsk(true)}>
                {killing ? "Killing…" : "Kill run"}
              </Button>
            </div>
          ) : (
            <div className="flex h-11 shrink-0 items-center gap-3 border-t border-line bg-surface px-4">
              <StateBadge state={suspension ? "suspended" : state} />
              {error && <span className="min-w-0 truncate text-[11.5px] text-err">{error}</span>}
              <span className="grow" />
              <Mono className="tnum text-[11px] text-faint">{clock(journalMs)}</Mono>
              {!suspension && (
                <Button tone="ink" variant="solid" size="sm" onClick={onReplay}>
                  Replay the record
                </Button>
              )}
            </div>
          )
        }
      />
    </>
  );
}

/** The landing theater's playback hook, in milliseconds over a real journal. */
function usePlayback(duration: number, ready: boolean, openAt?: number) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(8);
  const raf = useRef(0);
  const last = useRef(0);
  const started = useRef(false);

  // Review opens paused at the requested moment (default: the end). Playing
  // from zero is an explicit choice, not the price of opening the page.
  useEffect(() => {
    if (ready && !started.current) {
      started.current = true;
      setT(Math.max(0, Math.min(duration, openAt ?? duration)));
    }
  }, [ready, duration, openAt]);

  useEffect(() => {
    if (!playing) return;
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = now - last.current;
      last.current = now;
      setT((prev) => {
        const next = prev + dt * speed;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, speed, duration]);

  const seek = useCallback((v: number) => setT(Math.max(0, Math.min(duration, v))), [duration]);
  const step = useCallback(
    (dir: 1 | -1, marks: number[]) => {
      setPlaying(false);
      setT((prev) => {
        const next =
          dir > 0 ? marks.find((m) => m > prev + 1) : [...marks].reverse().find((m) => m < prev - 1);
        return next ?? (dir > 0 ? duration : 0);
      });
    },
    [duration],
  );

  return { t, playing, setPlaying, speed, setSpeed, seek, step };
}

/** Tick colours by journal kind — the transcript's vocabulary, on the clock. */
const TICK: Record<string, string> = {
  "model.call": "bg-run",
  "tool.call": "bg-c2",
  "node.enter": "bg-faint",
  "node.exit": "bg-ok",
  taint: "bg-warn",
  "gate.open": "bg-warn",
  "gate.answer": "bg-warn",
  suspend: "bg-warn",
  resume: "bg-warn",
  denied: "bg-err",
  "contract.breach": "bg-err",
  error: "bg-err",
};

function Scrubber({
  t,
  duration,
  playing,
  setPlaying,
  seek,
  step,
  speed,
  setSpeed,
  marks,
  segments,
  ticks,
  loud,
}: {
  t: number;
  duration: number;
  playing: boolean;
  setPlaying: (fn: (p: boolean) => boolean) => void;
  seek: (v: number) => void;
  step: (dir: 1 | -1, marks: number[]) => void;
  speed: number;
  setSpeed: (v: number) => void;
  marks: number[];
  segments: { id: string; label: string; from: number; to: number }[];
  ticks: { t: number; kind: string; title: string }[];
  loud: { t: number; title: string }[];
}) {
  const D = duration || 1;
  const pct = (t / D) * 100;
  // What the playhead is over, in words — the scrubber's bands and ticks are
  // too small to label, so the current node and latest event are read here.
  const here = segments.find((s) => t >= s.from && t < s.to) ?? (t >= D ? segments[segments.length - 1] : undefined);
  const latest = [...ticks].reverse().find((e) => e.t <= t);

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-line bg-raise/60 px-4 py-3">
      <div className="flex items-center gap-3">
        <IconButton
          size="sm"
          label={playing ? "Pause" : "Play"}
          onClick={() => setPlaying((p) => !p)}
          className="shrink-0"
        >
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5.5v13l11-6.5z" />
            </svg>
          )}
        </IconButton>

        <div className="flex items-center gap-1">
          <IconButton size="sm" label="Previous node" onClick={() => step(-1, marks)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M17 5.5v13L8 12z" />
              <rect x="5" y="5" width="2" height="14" rx="1" />
            </svg>
          </IconButton>
          <IconButton size="sm" label="Next node" onClick={() => step(1, marks)}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M7 5.5v13L16 12z" />
              <rect x="17" y="5" width="2" height="14" rx="1" />
            </svg>
          </IconButton>
        </div>

        <Mono className="tnum shrink-0 text-[11.5px] text-dim">
          {clock(t)} <span className="text-ghost">/ {clock(duration)}</span>
        </Mono>

        {/* Scrubber: node bands underneath, event ticks on top. */}
        <div className="relative flex h-8 grow items-center">
          <div className="absolute inset-x-0 top-1.5 flex h-2 overflow-hidden rounded-[2px]">
            {segments.map((s, i) => (
              <span
                key={`${s.id}-${i}`}
                className="h-full border-r border-surface last:border-0"
                style={{
                  width: `${((s.to - s.from) / D) * 100}%`,
                  background: `var(--t-c${(i % 10) + 1})`,
                  opacity: t >= s.from ? 0.65 : 0.16,
                }}
              />
            ))}
            {segments.length === 0 && <span className="h-full w-full bg-sunken" />}
          </div>

          <div className="absolute inset-x-0 top-4 h-3">
            {ticks.map((e, i) => (
              <span
                key={`${e.t}-${i}`}
                className={`absolute top-0 h-2 w-px ${TICK[e.kind] ?? "bg-faint"} ${
                  t >= e.t ? "opacity-90" : "opacity-25"
                }`}
                style={{ left: `${(e.t / D) * 100}%` }}
              />
            ))}
          </div>

          {/* Playhead */}
          <span className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-fg" style={{ left: `${pct}%` }}>
            <span className="absolute -top-0.5 left-1/2 size-2 -translate-x-1/2 rotate-45 bg-fg" />
          </span>

          <input
            type="range"
            min={0}
            max={D}
            value={t}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Scrub the run"
            className="focusable absolute inset-x-0 top-0 h-8 w-full cursor-pointer appearance-none bg-transparent"
          />

          {/* Refusals stay clickable — the moments a reviewer came for. */}
          {loud.map((m, i) => (
            <button
              key={`l${m.t}-${i}`}
              onClick={() => seek(m.t)}
              title="Jump to refusal"
              aria-label={`Jump to ${m.title} at ${clock(m.t)}`}
              className="focusable absolute top-1 z-20 size-2 -translate-x-1/2 cursor-pointer rounded-[2px] bg-err transition-transform hover:scale-150"
              style={{ left: `${(m.t / D) * 100}%` }}
            />
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {[1, 8, 32].map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`focusable cursor-pointer rounded-sm px-1.5 py-0.5 font-mono text-[10.5px] transition-colors ${
                speed === s ? "bg-raise font-medium text-fg" : "text-faint hover:text-dim"
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="min-w-0 max-w-[48ch] truncate text-[11px] text-faint">
          {here ? here.label : "start"}
          {latest && <span className="text-ghost"> · </span>}
          {latest?.title}
        </span>
        <span className="flex items-center gap-1.5 text-[10.5px] text-faint">
          <Kbd>space</Kbd> play
        </span>
        <span className="flex items-center gap-1.5 text-[10.5px] text-faint">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd> step node
        </span>
        <div className="grow" />
        {[
          ["tool.call", "tool"],
          ["model.call", "reasoning"],
          ["taint", "taint"],
          ["node.exit", "step done"],
          ["denied", "refused"],
        ].map(([k, label]) => (
          <span key={k} className="flex items-center gap-1.5 text-[10.5px] text-faint">
            <span className={`size-1.5 rounded-[2px] ${TICK[k]}`} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════ The theater itself ═══════════════════
   Header · graph rail · transcript · artifact rail · footer — the landing
   page's grid, fed by a journal instead of a scripted trace. */

function Theater({
  title,
  subtitle,
  nodes,
  edges = [],
  entries,
  allEntries,
  onRestart,
  live,
  finalState,
  error,
  outputs,
  result,
  suspension,
  onAnswered,
  steer,
  setup,
  footer,
  traceOf,
  segments,
  tNow,
  runId,
  agentId,
  source = "",
  runLive,
  notice,
}: {
  title: string;
  subtitle: string;
  nodes: { id: string; label: string; kind: string }[];
  /** The spec's edges, so the agents view can draw the plan and the path through it. */
  edges?: BoardEdge[];
  entries: Entry[];
  /** On a replay, the whole journal: the agents view lays the run out once and reveals it as the scrubber moves. */
  allEntries?: Entry[];
  /** Play the replay again from the start (the agents view offers it when paused). */
  onRestart?: () => void;
  live: boolean;
  finalState: string;
  error: string;
  outputs: OutputRecord[];
  result: Record<string, unknown> | null;
  suspension: Suspension | null;
  /** The gate was answered through the inbox dialog; the run is resuming. */
  onAnswered: () => void;
  /** Live only: the steering panel, at the top of the artifact rail. */
  steer?: React.ReactNode;
  setup: React.ReactNode;
  footer: React.ReactNode;
  /** Replay only: node time-bands + the playhead, for per-node progress. */
  segments?: { id: string; from: number; to: number }[];
  tNow?: number;
  /** Run id whose trace the theater may show. Absent on a live run. */
  traceOf?: string;
  /** The run's id, for the lineage drawer's link to the record and the artefact bundle. Absent on a live run that has not started. */
  runId?: string;
  /** The agent the run belongs to, for a gate the inbox has not listed yet. */
  agentId?: string;
  /** Where the run came from when not the platform itself (`sdk`, `a2a`), for the header's badge. */
  source?: string;
  /** Whether the run itself is in flight (a replay's `live` is the film playing, not the run): the run tree is read again while it is. */
  runLive?: boolean;
  /** Above the footer: what a kill reached. */
  notice?: React.ReactNode;
}) {
  const draftId =
    result && typeof result.draft_id === "string" && /^[a-z][a-z0-9-]{0,62}$/.test(result.draft_id)
      ? result.draft_id
      : null;
  const modelCalls = entries.filter((e) => e.kind === "model.call").length;
  const denied = entries.filter((e) => e.kind === "denied" || e.kind === "contract.breach").length;
  const artifacts = useMemo(() => artifactsOf(entries), [entries]);
  // Theatre or agents: the same journal, read as one transcript or as a card
  // per agent. The choice is the reader's and it sticks across runs.
  const [view, setView, fold, setFold] = useRunView();

  /* Node states from the journal: entered without exit = active. */
  const nodeState = useMemo(() => {
    const m = new Map<string, "pending" | "active" | "done">();
    for (const n of nodes) m.set(n.id, "pending");
    for (const e of entries) {
      if (!e.node || !m.has(e.node)) {
        if (e.node && e.kind === "node.enter") m.set(e.node, "active");
        continue;
      }
      if (e.kind === "node.enter") m.set(e.node, "active");
      if (e.kind === "node.exit") m.set(e.node, "done");
    }
    return m;
  }, [nodes, entries]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-hue="blue">
      {/* ── header, in the landing theater's grammar ── */}
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface px-4 py-2.5">
        <div className="flex items-center gap-2 text-[12px]">
          <Link href="/runs" className="focusable rounded-sm text-faint transition-colors hover:text-fg">
            Runs
          </Link>
          <span className="text-ghost">/</span>
          <Mono className="text-[11.5px] text-faint">{subtitle}</Mono>
        </div>
        <span className="text-[13px] font-semibold tracking-[-0.01em]">{title}</span>
        <RunSourceTag run={{ source }} />
        {suspension ? (
          <Status tone="warn">Awaiting approval</Status>
        ) : live ? (
          <Status tone="run">Running</Status>
        ) : (
          <StateBadge state={finalState} />
        )}
        <div className="grow" />
        <ViewSwitch view={view} setView={setView} fold={fold} setFold={setFold} />
        <div className="flex items-center gap-3 font-mono text-[11.5px] text-dim">
          <span className="tnum">{modelCalls} model calls</span>
          <span className="text-ghost">·</span>
          <span className="tnum">{entries.filter((e) => e.kind === "tool.call").length} tool calls</span>
          <span className="text-ghost">·</span>
          <span className={`tnum ${denied ? "font-semibold text-err" : ""}`}>{denied} refused</span>
        </div>
      </header>

      {setup}

      {/* ── The gate: when a person is the next step, the room says so. ── */}
      {suspension && <GateBanner suspension={suspension} runId={runId ?? ""} agentId={agentId ?? title} onAnswered={onAnswered} />}

      {view === "cards" && (
        <div className="flex min-h-0 grow flex-col">
          <RunBoard nodes={nodes} edges={edges} entries={entries} allEntries={allEntries} live={live} fold={fold} plan={live && !allEntries} clockT={tNow} onRestart={onRestart} suspendedNode={suspension?.node ?? null} />
          {(artifacts.length > 0 || (error && finalState === "failed") || finalState === "killed") && (
            <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line bg-raise/40 px-4 py-2.5">
              <span className="text-[11px] font-medium text-faint">Artifacts</span>
              {artifacts.map((a) => (
                <a key={a.name} href={`/api/artifact?name=${encodeURIComponent(a.name)}`} download={a.name} className="focusable flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-[11.5px] text-fg hover:border-line-strong">
                  <Icon name={a.kind === "json" ? "json" : "file"} size={12} className="text-dim" />
                  {a.name}
                </a>
              ))}
              {artifacts.length === 0 && <span className="text-[11px] text-ghost">none written</span>}
              {artifacts.length > 0 && runId && (
                <a href={artefactsZipUrl(runId)} download className="focusable flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-[11.5px] font-medium text-fg hover:border-line-strong">
                  Download all (.zip)
                </a>
              )}
              <span className="grow" />
              {error && finalState === "failed" && <Status tone="err">{error.slice(0, 120)}</Status>}
              {finalState === "killed" && <span className="flex items-center gap-2"><Status tone="err">Killed by operator</Status><ControlRef control={KILL_CONTROL} /></span>}
            </div>
          )}
        </div>
      )}

      <div className={`min-h-0 grow grid-cols-1 md:grid-cols-[minmax(150px,190px)_minmax(0,1fr)] xl:grid-cols-[minmax(160px,200px)_minmax(0,1fr)_minmax(280px,340px)] ${view === "cards" ? "hidden" : "grid"}`}>
        {/* ── graph rail: the spine, filling as the run advances. Below md it
            lies down as a horizontal strip so the transcript keeps the room. ── */}
        <aside className="flex min-h-0 min-w-0 flex-row gap-3 overflow-x-auto border-b border-line bg-raise/60 p-3 md:flex-col md:gap-1 md:overflow-x-visible md:overflow-y-auto md:border-r md:border-b-0">
          <span className="hidden px-1 pb-1.5 text-[11px] text-faint md:block">Workflow</span>
          {nodes.map((n, i) => {
            const s = nodeState.get(n.id) ?? "pending";
            const last = i === nodes.length - 1;
            return (
              <div key={n.id} className="flex shrink-0 gap-2.5 md:shrink">
                <div className="hidden w-3 shrink-0 flex-col items-center pt-1.5 md:flex">
                  <span
                    className={`size-2.5 shrink-0 rounded-[2px] border-2 transition-colors duration-200 ${
                      s === "done"
                        ? "border-ok bg-ok"
                        : s === "active"
                          ? "border-run bg-surface"
                          : "border-line-strong bg-surface"
                    }`}
                  />
                  {!last && (
                    <span className="relative my-1 w-px grow bg-line">
                      <span
                        className="absolute inset-x-0 top-0 bg-ok transition-[height] duration-200"
                        style={{ height: `${s === "done" ? 100 : 0}%` }}
                      />
                    </span>
                  )}
                </div>
                <div className={`flex min-w-0 grow flex-col gap-1 ${last ? "pb-1" : "pb-4"}`}>
                  <span
                    className={`truncate text-[12.5px] transition-colors ${
                      s === "active" ? "font-semibold text-fg" : s === "done" ? "text-mist" : "text-faint"
                    }`}
                  >
                    {n.label}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10.5px] text-ghost">
                      {HARNESS[n.kind as keyof typeof HARNESS]?.name ?? n.kind}
                    </span>
                    {s === "active" && live && <Thinking height={8} />}
                  </div>
                  {/* Replay: how far through its stretch of the clock this node is. */}
                  {s === "active" &&
                    segments &&
                    tNow !== undefined &&
                    (() => {
                      const seg = segments.find((x) => x.id === n.id);
                      if (!seg || seg.to <= seg.from) return null;
                      const p = Math.min(1, Math.max(0, (tNow - seg.from) / (seg.to - seg.from)));
                      return (
                        <span className="mt-0.5 block h-0.5 overflow-hidden rounded-[2px] bg-sunken">
                          <span className="block h-full rounded-[2px] bg-run" style={{ width: `${p * 100}%` }} />
                        </span>
                      );
                    })()}
                </div>
              </div>
            );
          })}
        </aside>

        {/* ── transcript ── */}
        <TheaterTranscript entries={entries} live={live} runId={runId ?? traceOf ?? ""} />

        {/* ── artifact rail ── */}
        <aside className="flex min-h-0 min-w-0 flex-col md:col-span-2 xl:col-span-1">
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-raise/60 px-4">
            <span className="truncate text-[12px] font-semibold">Artifacts</span>
            <div className="grow" />
            {/* Every file the run wrote, as one archive: the backend's bundle door, a plain link the proxy forwards. */}
            {artifacts.length > 0 && runId && (
              <Button size="sm" variant="quiet" className="shrink-0" href={artefactsZipUrl(runId)}>
                Download all ({artifacts.length})
              </Button>
            )}
            <Mono className="shrink-0 text-[11px] text-faint">{artifacts.length} produced</Mono>
          </div>
          <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto px-4 py-4">
            {steer}
            {suspension && (
              <div className="relative overflow-hidden rounded-md border border-line bg-surface px-3 py-2.5 pl-4">
                <span className="absolute inset-y-0 left-0 w-[3px] bg-warn" />
                <p className="text-[12px] leading-[1.55] text-dim">
                  Paused at <Mono className="text-[11px]">{suspension.node}</Mono> — the decision is
                  in the banner above.
                </p>
              </div>
            )}

            {draftId && finalState === "done" && (
              <div className="relative flex flex-col gap-2.5 overflow-hidden rounded-md border border-line bg-surface p-3 pl-4">
                <span className="absolute inset-y-0 left-0 w-[3px] bg-run" />
                <span className="text-[12px] font-semibold text-fg">A draft was authored</span>
                <p className="text-[12px] leading-[1.55] text-mist">
                  The agent designed <code className="font-mono text-[11px]">{draftId}</code> and it
                  passed the deployment parser. It is a draft, not a deployed agent — open it,
                  review every grant and gate, then Save if it holds up.
                </p>
                <Button
                  tone="ink"
                  variant="solid"
                  size="sm"
                  href={`/builder?draftId=${encodeURIComponent(draftId)}`}
                  className="self-start"
                >
                  Open in Builder
                </Button>
              </div>
            )}

            {artifacts.length === 0 && !suspension && !draftId && (
              <span className="text-[12px] text-ghost">
                Nothing written yet — files appear here the moment a node produces them.
              </span>
            )}

            {artifacts.map((a) => (
              <ArtifactRow key={a.name} a={a} />
            ))}

            {outputs
              .filter((o) => !o.ok)
              .map((o, i) => (
                <Banner key={i} tone="err" title={`${o.kind} output failed`}>
                  {o.error}
                </Banner>
              ))}

            {error && finalState === "failed" && (
              <Banner tone="err" title="The run failed">
                {error}
              </Banner>
            )}
            {finalState === "killed" && (
              <Banner tone="err" title="Killed by operator">
                <span className="flex flex-col gap-1.5">
                  <span>{error || "The kill switch was thrown; the runtime trapped it and persisted the partial record."}</span>
                  <ControlRef control={KILL_CONTROL} size="md" />
                </span>
              </Banner>
            )}
          </div>
        </aside>
      </div>

      <RunTreePanel key={runId ?? traceOf ?? ""} runId={runId ?? traceOf} live={runLive ?? live} />
      {traceOf && <TracePanel runId={traceOf} />}
      {notice}
      {footer}
    </div>
  );
}

/**
 * The run's trace, in the theater.
 *
 * The scrubber says when things happened; this says how long each took and what
 * it cost, which is the question a reviewer asks second. Collapsed by default:
 * the stage is the point, and a waterfall permanently open would compete with
 * it for the same glance.
 */
function TracePanel({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  const { trace, state } = useTrace(open ? runId : null);
  const [span, setSpan] = useState<Span | null>(null);

  return (
    <div className="shrink-0 border-t border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="focusable flex w-full items-center gap-2 px-4 py-1.5 text-left hover:bg-raise/40"
      >
        <span
          className="grid size-3.5 shrink-0 place-items-center text-dim transition-transform"
          style={{ transform: open ? "rotate(90deg)" : "none" }}
          aria-hidden
        >
          <svg viewBox="0 0 16 16" width="9" height="9" fill="none">
            <path d="M5.5 3.5 10.5 8l-5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="text-[11.5px] font-medium">Trace</span>
        <span className="text-[10.5px] text-faint">
          {open
            ? state === "loading"
              ? "reading the journal…"
              : trace
                ? `${trace.spans.length} spans · click one`
                : "no journal for this run"
            : "where the time and the money went"}
        </span>
      </button>
      {open && trace && (
        <div className="grid gap-px border-t border-line bg-line lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="bg-surface">
            <Waterfall trace={trace} onPick={(sp) => setSpan(sp)} maxHeight={200} />
          </div>
          <div className="max-h-[236px] overflow-y-auto bg-surface">
            {span ? (
              <SpanDetail span={span} />
            ) : (
              <p className="px-4 py-3 text-[11px] leading-[1.5] text-faint">
                Pick a span. A faded bar is a duration inferred from the entries around it rather
                than measured.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════ Artifacts ═══════════════════
   Text-shaped artifacts preview inline; download never navigates away from a
   live stream. */

const PREVIEWABLE = new Set(["json", "md", "txt", "csv", "html"]);

function ArtifactRow({ a }: { a: { name: string; kind: string; t: number } }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const url = `/api/artifact?name=${encodeURIComponent(a.name)}`;
  const canPreview = PREVIEWABLE.has(a.kind);

  const toggle = async () => {
    if (!canPreview) return;
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (preview === null) {
      try {
        const res = await fetch(url);
        const text = await res.text();
        setPreview(text.slice(0, 8000));
      } catch {
        setPreview("(could not read the file)");
      }
    }
  };

  return (
    <div className="overflow-hidden rounded-md border border-line bg-raise/60 transition-colors hover:border-line-strong">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface text-dim">
          <Icon name={a.kind === "json" ? "json" : "file"} size={15} />
        </span>
        {canPreview ? (
          <button onClick={toggle} className="focusable flex min-w-0 grow cursor-pointer flex-col text-left">
            <span className="truncate text-[12px] font-medium text-fg">{a.name}</span>
            <span className="flex items-center gap-2">
              <Tag>{a.kind}</Tag>
              <Mono className="text-[10px] text-ghost">{clock(a.t)}</Mono>
              <span className="text-[10px] text-faint">{open ? "hide preview" : "preview"}</span>
            </span>
          </button>
        ) : (
          <span className="flex min-w-0 grow flex-col">
            <span className="truncate text-[12px] font-medium text-fg">{a.name}</span>
            <span className="flex items-center gap-2">
              <Tag>{a.kind}</Tag>
              <Mono className="text-[10px] text-ghost">{clock(a.t)}</Mono>
            </span>
          </span>
        )}
        <IconButton
          size="sm"
          label={`Download ${a.name}`}
          className="shrink-0"
          onClick={() => {
            const link = document.createElement("a");
            link.href = url;
            link.download = a.name;
            link.click();
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
        </IconButton>
      </div>
      {open && (
        <pre className="max-h-[220px] overflow-auto border-t border-line bg-sunken/30 p-2.5 font-mono text-[10px] leading-[1.6] whitespace-pre-wrap text-mist">
          {preview ?? "reading…"}
        </pre>
      )}
    </div>
  );
}

/* ═══════════════════ The gate banner ═══════════════════
   Approval is the product's thesis moment — it interrupts, names the
   approver, and writes who/why into the journal. */

function GateBanner({
  suspension,
  runId,
  agentId,
  onAnswered,
}: {
  suspension: Suspension;
  runId: string;
  agentId: string;
  /** The gate was answered through the dialog; the run is resuming. */
  onAnswered: () => void;
}) {
  const { session: me } = useSession();
  const by = signerName(me, CURRENT_USER.name);
  const now = useNow();
  // The same dialog as the inbox: the gate's row from the approvals door
  // when it is there, else one built from the suspension the stream sent.
  const [gate, setGate] = useState<Gate | null>(null);
  const [opening, setOpening] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  const answer = async () => {
    setOpening(true);
    try {
      const inbox = runId ? await listGates().catch(() => null) : null;
      const row = inbox?.pending.find((g) => g.run === runId) ?? null;
      setGate(row ?? gateFromSuspension(runId, agentId, { ...suspension.raw, node: suspension.node, approvers: suspension.approvers, prompt: suspension.prompt }));
    } finally {
      setOpening(false);
    }
  };

  return (
    <div
      ref={ref}
      role="region"
      aria-label="Approval required"
      className="relative flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2.5 overflow-hidden border-b border-line bg-surface px-4 py-3 pl-5"
    >
      <span className="absolute inset-y-0 left-0 w-[3px] bg-warn" />
      <span className="flex items-center gap-2">
        <span className="size-2 shrink-0 rounded-full bg-warn" />
        <span className="text-[13px] font-semibold text-fg">A person decides here</span>
      </span>
      <span className="min-w-0 max-w-[52ch] text-[12.5px] leading-[1.5] text-mist">
        {suspension.prompt}
      </span>
      <Mono className="text-[10.5px] text-faint">
        {suspension.approvers.length ? `asks: ${suspension.approvers.join(", ")}` : "no approver role set"}
      </Mono>
      <Deadline deadline={suspension.deadline} now={now} />
      <span className="grow" />
      <span className="flex items-center gap-1.5 text-[11px] text-faint">
        <span className="grid size-5 place-items-center rounded-full bg-ink text-[8.5px] font-semibold text-on-ink">{me?.initials ?? CURRENT_USER.initials}</span>
        {by}
      </span>
      <Button tone="warn" variant="solid" size="sm" permission="approve" loading={opening} disabled={!runId} onClick={answer}>
        Answer
      </Button>
      {gate && (
        <ApproveDialog
          gates={[gate]}
          onClose={() => setGate(null)}
          onAnswered={() => {
            setGate(null);
            onAnswered();
          }}
        />
      )}
    </div>
  );
}

/* ═══════════════════ Transcript, in the landing vocabulary ═══════════════════ */

const ROW: Record<string, { dot: string; text: string; label: string }> = {
  "run.start": { dot: "bg-faint", text: "text-dim", label: "start" },
  "run.end": { dot: "bg-faint", text: "text-dim", label: "run done" },
  "node.enter": { dot: "bg-c2", text: "text-c2", label: "step" },
  "node.exit": { dot: "bg-ok", text: "text-ok", label: "step done" },
  "gate.open": { dot: "bg-warn", text: "text-warn", label: "escalation" },
  "gate.answer": { dot: "bg-warn", text: "text-warn", label: "decision" },
  suspend: { dot: "bg-warn", text: "text-warn", label: "escalation" },
  resume: { dot: "bg-warn", text: "text-warn", label: "resumed" },
  taint: { dot: "bg-warn", text: "text-warn", label: "taint" },
  denied: { dot: "bg-err", text: "text-err", label: "refused" },
  "contract.breach": { dot: "bg-err", text: "text-err", label: "contract" },
  error: { dot: "bg-err", text: "text-err", label: "error" },
  note: { dot: "bg-faint", text: "text-dim", label: "note" },
};

/** Filter families — the rows a reviewer wants to isolate, by what they mean. */
const FILTERS: { id: string; label: string; kinds: string[] }[] = [
  { id: "all", label: "All", kinds: [] },
  { id: "reasoning", label: "Reasoning", kinds: ["model.call"] },
  { id: "tools", label: "Tools", kinds: ["tool.call", "tool.result"] },
  { id: "refused", label: "Refused", kinds: ["denied", "contract.breach", "error"] },
  { id: "gates", label: "Gates", kinds: ["gate.open", "gate.answer", "suspend", "resume"] },
  { id: "taints", label: "Taints", kinds: ["taint"] },
];

function TheaterTranscript({ entries, live, runId = "" }: { entries: Entry[]; live: boolean; runId?: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [unseen, setUnseen] = useState(0);
  const [filter, setFilter] = useState("all");
  /** The entry whose lineage is open: what it was derived from, what it fed. */
  const [lineage, setLineage] = useState<string | null>(null);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (pinned.current) {
      el.scrollTop = el.scrollHeight;
      setUnseen(0);
    } else {
      setUnseen((n) => n + 1);
    }
  }, [entries.length]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const was = pinned.current;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (pinned.current && !was) setUnseen(0);
  };

  const current = [...entries].reverse().find((e) => e.kind === "node.enter");
  const active = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  const shown =
    active.id === "all" ? entries : entries.filter((e) => active.kinds.includes(e.kind));
  const countOf = (f: (typeof FILTERS)[number]) =>
    f.id === "all" ? entries.length : entries.filter((e) => f.kinds.includes(e.kind) && e.kind !== "tool.result").length;

  return (
    <section className="relative flex min-h-0 min-w-0 flex-col border-b border-line xl:border-r xl:border-b-0">
      <div className="flex h-9 shrink-0 items-center gap-2 overflow-x-auto border-b border-line bg-raise/60 px-4 [scrollbar-width:none]">
        <span className="shrink-0 truncate text-[12px] font-semibold">{current?.title ?? "Transcript"}</span>
        {live && <Thinking height={8} />}
        <div className="grow" />
        {/* Isolate what matters: refusals, gates, taints — with counts. */}
        <div className="flex shrink-0 items-center gap-0.5">
          {FILTERS.map((f) => {
            const n = countOf(f);
            if (f.id !== "all" && n === 0) return null;
            return (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                aria-pressed={filter === f.id}
                className={`focusable cursor-pointer rounded-sm px-1.5 py-0.5 text-[10.5px] whitespace-nowrap transition-colors ${
                  filter === f.id
                    ? "bg-surface font-semibold text-fg shadow-[var(--shadow-1)]"
                    : `font-medium ${f.id === "refused" ? "text-err" : "text-faint"} hover:text-dim`
                }`}
              >
                {f.label} {f.id !== "all" && <span className="tnum">{n}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div ref={scroller} onScroll={onScroll} className="flex min-h-0 grow flex-col gap-3.5 overflow-y-auto px-4 py-4">
        {shown.map((e, i) => (
          <JournalRow key={e.id ?? i} e={e} entries={entries} onLineage={setLineage} />
        ))}
        {shown.length === 0 && (
          <p className="text-[12px] text-faint">Nothing of this kind in the journal{live ? " yet" : ""}.</p>
        )}
      </div>

      {lineage && <LineageDrawer runId={runId} entryId={lineage} entries={entries} onClose={() => setLineage(null)} />}

      {/* Events landing below the fold while scrolled up — say so. */}
      {unseen > 0 && live && (
        <Button
          size="sm"
          variant="outline"
          className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 elev-2"
          onClick={() => {
            const el = scroller.current;
            if (el) el.scrollTop = el.scrollHeight;
            pinned.current = true;
            setUnseen(0);
          }}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 5v14M6 13l6 6 6-6" />
          </svg>
          {unseen} new event{unseen === 1 ? "" : "s"}
        </Button>
      )}
    </section>
  );
}

/* ── Humanising: the transcript speaks prose; JSON is one click away ── */

/** One line saying what a tool call produced — never the payload itself. */
function summarise(value: unknown): string {
  if (value === null || value === undefined) return "";
  const sandbox = sandboxRunOf(value);
  if (sandbox) return sandboxLine(sandbox);
  if (typeof value === "string") {
    const flat = value.replace(/\s+/g, " ").trim();
    return flat.length > 96 ? flat.slice(0, 93) + "…" : flat;
  }
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.results)) return `${v.results.length} result${v.results.length === 1 ? "" : "s"}`;
    if (v.written === true && v.where) return `wrote ${String(v.where).split("/").pop()}`;
    if (v.task_id) return `task ${String(v.task_id)} · ${String(v.state ?? "")}`.trim();
    if (v.id && v.type) return `${String(v.type)} ${String(v.id)}`;
    const keys = Object.keys(v);
    return keys.length ? keys.slice(0, 4).join(" · ") + (keys.length > 4 ? " · …" : "") : "empty";
  }
  return String(value);
}

/**
 * A JSON-shaped model reply, rendered as key: value prose.
 *
 * The journal truncates long completions, so the object often arrives cut
 * mid-string and will not parse. The fallback extracts what fields it can by
 * grammar rather than parser — a truncated decision must still read as prose,
 * never as a wall of braces.
 */
function parseJsonText(text: string): [string, string][] | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  if (!trimmed.startsWith("{")) return null;

  try {
    const v = JSON.parse(trimmed);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.entries(v as Record<string, unknown>).map(([k, x]) => [
        k,
        typeof x === "string" ? x : summarise(x),
      ]);
    }
  } catch {
    /* truncated — extract below */
  }

  const out: [string, string][] = [];
  const keyRe = /"([a-zA-Z0-9_.-]+)"\s*:\s*/g;
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(trimmed))) {
    const rest = trimmed.slice(keyRe.lastIndex);
    if (rest.startsWith('"')) {
      // A string value — possibly unterminated at the truncation point.
      let value = "";
      let i = 1;
      for (; i < rest.length; i++) {
        const c = rest[i];
        if (c === "\\" && i + 1 < rest.length) {
          const n = rest[i + 1];
          value += n === "n" ? "\n" : n === "t" ? "  " : n;
          i++;
        } else if (c === '"') break;
        else value += c;
      }
      out.push([m[1], value]);
      keyRe.lastIndex += i;
    } else {
      const lit = rest.match(/^(-?\d+(?:\.\d+)?|true|false|null)/);
      if (lit) out.push([m[1], lit[1]]);
      else if (rest.startsWith("[") || rest.startsWith("{")) out.push([m[1], "…"]);
    }
  }
  return out.length ? out : null;
}

function JournalRow({ e, entries, onLineage }: { e: Entry; entries: Entry[]; onLineage?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const lineageButton = onLineage && e.id ? (
    <Button size="sm" variant="quiet" onClick={() => onLineage(e.id)}>Lineage</Button>
  ) : null;

  /* Reasoning: the model's own words, as prose — the landing's signature row.
     Never silently cut: long thoughts get a labelled expander. */
  if (e.kind === "model.call") {
    const text = e.detail || e.title || "";
    const asJson = parseJsonText(text);
    const long = !asJson && text.length > 700;
    return (
      <div className="flex gap-3">
        <Mono className="w-9 shrink-0 pt-0.5 text-[10.5px] text-ghost">{clock(e.t)}</Mono>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-2">
            <span className="text-[10.5px] font-medium text-run">reasoning</span>
            {e.tainted && <Tag tone="warn">tainted input</Tag>}
            {e.tainted && lineageButton}
          </span>
          {e.tainted && (
            <span className="text-[11px] text-faint">
              Worked over content authored outside the system — untrusted input, tracked by the taint rules.
            </span>
          )}
          {asJson && !open ? (
            /* A structured decision reads as prose; the raw object is a click away. */
            <div className="flex max-w-[62ch] flex-col gap-1.5">
              {asJson.slice(0, 8).map(([k, v], i) => (
                <p key={`${k}-${i}`} className="text-[13px] leading-[1.55] whitespace-pre-wrap text-mist">
                  <span className="font-medium text-fg">{k.replace(/_/g, " ")}:</span>{" "}
                  {v.length > 420 ? v.slice(0, 417) + "…" : v}
                </p>
              ))}
            </div>
          ) : (
            <p className="max-w-[62ch] text-[13px] leading-[1.6] whitespace-pre-wrap text-mist">
              {long && !open ? text.slice(0, 700) : text}
              {long && !open && "…"}
            </p>
          )}
          {(long || asJson) && (
            <Button size="sm" variant="quiet" className="self-start" onClick={() => setOpen(!open)}>
              {open ? (asJson ? "show as prose" : "show less") : asJson ? "view raw" : `show all (${(text.length / 1000).toFixed(1)}k chars)`}
            </Button>
          )}
        </div>
      </div>
    );
  }

  /* Tool calls: the raised card, expandable to the exact request/response.
     Pairing is positional — the nth call of a tool owns the nth result — so
     two back-to-back calls of the same tool never share a response. */
  if (e.kind === "tool.call") {
    const myIndex = entries.filter(
      (x) => x.kind === "tool.call" && x.data?.tool === e.data?.tool && x.t <= e.t,
    ).length;
    const response = entries.filter(
      (x) => x.kind === "tool.result" && x.data?.tool === e.data?.tool,
    )[myIndex - 1];
    // `sandbox.execute` under an isolator (phase L6): the isolator, the exit,
    // the time, the truncation and the manifest digest come before the output.
    const sandbox = response && e.data?.tool === SANDBOX_TOOL ? sandboxRunOf(response.data?.value) : null;
    return (
      <div className="flex gap-3">
        <Mono className="w-9 shrink-0 pt-2 text-[10.5px] text-ghost">{clock(e.t)}</Mono>
        <div className="min-w-0 grow rounded-md border border-line bg-raise">
          <button
            onClick={() => setOpen(!open)}
            className="focusable flex w-full cursor-pointer flex-col gap-0.5 px-3 py-2 text-left"
          >
            <span className="flex items-center justify-between gap-3">
              <Mono className="truncate text-[11.5px] text-mist">{String(e.data?.tool ?? e.title)}</Mono>
              <span className="flex shrink-0 items-center gap-2">
                {sandbox ? (
                  <Mono className={`text-[10.5px] ${sandbox.exit === 0 ? "text-ok" : "text-err"}`}>{exitText(sandbox)}</Mono>
                ) : response ? (
                  <Mono className="text-[10.5px] text-ok">returned</Mono>
                ) : (
                  <Mono className="text-[10.5px] text-faint">…</Mono>
                )}
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={`text-ghost transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </span>
            </span>
            {/* One prose line about what came back — the payload stays behind the click. */}
            {response && !open && summarise(response.data?.value) && (
              <span className="truncate text-[11.5px] text-faint">→ {summarise(response.data?.value)}</span>
            )}
          </button>
          {open && (
            <div className="flex flex-col gap-2 border-t border-line px-3 py-2.5">
              <CurlBlock tool={String(e.data?.tool ?? "")} args={e.data?.args ?? {}} />
              {sandbox ? <SandboxOutput run={sandbox} /> : response && <ResponseBlock value={response.data?.value} />}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (e.kind === "tool.result") return null; // rendered inside its call's card

  /* A guardrail firing is the one entry a reviewer must never have to decode.
     It says which control refused, the rule in that control's own words, what
     was attempted, and why the control exists — because "refused" on its own
     reads as a malfunction rather than the system working. */
  if (e.kind === "denied" || e.kind === "contract.breach" || e.kind === "taint" || e.kind === "gate.open") {
    const control = String(e.data?.control ?? (e.kind === "contract.breach" ? "contract.breach" : e.kind));
    const why = explainControl(control);
    const refused = e.kind === "denied" || e.kind === "contract.breach";
    const tool = e.data?.tool ? String(e.data.tool) : "";
    return (
      <div className="flex gap-3">
        <Mono className="w-9 shrink-0 pt-2 text-[10.5px] text-ghost">{clock(e.t)}</Mono>
        <div className={`min-w-0 grow rounded-md border bg-raise ${refused ? "border-err/40" : "border-warn/40"}`}>
          <div className="flex flex-col gap-1 px-3 py-2">
            <span className="flex flex-wrap items-center gap-2">
              <span className={`size-1.5 shrink-0 rounded-[2px] ${refused ? "bg-err" : "bg-warn"}`} />
              <span className={`text-[10.5px] font-medium ${refused ? "text-err" : "text-warn"}`}>
                {refused ? "refused by" : "marked by"}
              </span>
              <span className="text-[12.5px] font-medium text-fg">{why.name}</span>
              <ControlRef control={control} />
              {tool && <Mono className="text-[10.5px] text-mist">{tool}</Mono>}
              <span className="grow" />
              {lineageButton}
            </span>
            {/* The rule, in full. Truncating the reason is how a refusal turns
                into a mystery two weeks later. */}
            {e.detail && (
              <span className="text-[11.5px] leading-[1.55] text-fg">{e.detail}</span>
            )}
            {why.decides && (
              <span className="text-[11px] leading-[1.5] text-faint">
                {why.name} decides: {why.decides}
              </span>
            )}
            {!!e.data?.args && (
              <details className="pt-0.5">
                <summary className="focusable cursor-pointer text-[10.5px] text-ghost">
                  what was attempted
                </summary>
                <pre className="mt-1 max-h-40 overflow-auto rounded-sm border border-line bg-canvas px-2 py-1.5 font-mono text-[10px] leading-[1.5] whitespace-pre-wrap text-faint">
                  {JSON.stringify(e.data.args, null, 2)}
                </pre>
              </details>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* An isolated execution journalled in its own entry (the manifest digest,
     the isolator, the exit), rather than as a tool result. */
  const isolated = sandboxOfEntry(e);
  if (isolated) {
    return (
      <div className="flex gap-3">
        <Mono className="w-9 shrink-0 pt-2 text-[10.5px] text-ghost">{clock(e.t)}</Mono>
        <div className="flex min-w-0 grow flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-2">
            <span className={`size-1.5 shrink-0 rounded-[2px] ${isolated.exit === 0 ? "bg-ok" : "bg-err"}`} />
            <span className="text-[10.5px] font-medium text-dim">sandbox</span>
            <Mono className="text-[11.5px] text-mist">{SANDBOX_TOOL}</Mono>
            {e.detail && <span className="truncate text-[11.5px] text-faint">{e.detail}</span>}
          </span>
          <SandboxSummary run={isolated} />
        </div>
      </div>
    );
  }

  /* An operator's hand on the run: guidance, a hold, a model change (the
     steer door), each journalled with who and when. The row says so, in
     those words, so a reviewer can tell the operator's steps from the
     run's own. */
  const operator = operatorOf(e);
  if (operator) {
    return (
      <div className="flex gap-3">
        <Mono className="w-9 shrink-0 pt-2 text-[10.5px] text-ghost">{clock(e.t)}</Mono>
        <div className="min-w-0 grow rounded-md border border-line bg-raise">
          <div className="flex flex-col gap-1 px-3 py-2">
            <span className="flex flex-wrap items-center gap-2">
              <span className="size-1.5 shrink-0 rounded-[2px] bg-run" />
              <span className="text-[10.5px] font-medium text-run">operator</span>
              <span className="text-[12.5px] font-medium text-fg">{operator.action}</span>
              <span className="grow" />
              <span className="text-[11px] text-faint">
                {operator.by}
                {operator.at ? ` · ${new Date(operator.at).toLocaleTimeString()}` : ""}
              </span>
            </span>
            {operator.detail && <span className="text-[11.5px] leading-[1.55] whitespace-pre-wrap text-mist">{operator.detail}</span>}
          </div>
        </div>
      </div>
    );
  }

  const k = ROW[e.kind] ?? { dot: "bg-faint", text: "text-dim", label: e.kind };
  return (
    <div className="flex gap-3">
      <Mono className="w-9 shrink-0 text-[10.5px] text-ghost">{clock(e.t)}</Mono>
      <div className="flex min-w-0 items-baseline gap-2">
        <span className={`mt-1.5 size-1.5 shrink-0 rounded-[2px] ${k.dot}`} />
        <span className={`shrink-0 text-[10.5px] font-medium ${k.text}`}>{k.label}</span>
        <span className="text-[12.5px] text-fg">{e.title}</span>
        {e.detail && <span className="truncate text-[11.5px] text-faint">{e.detail}</span>}
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="quiet"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      {done ? "copied" : "copy"}
    </Button>
  );
}

function CurlBlock({ tool, args }: { tool: string; args: Record<string, unknown> }) {
  // The journal records tool + args; the address is notation, not a claim —
  // this product never renders a record it does not have as if it did.
  const [server, ...rest] = tool.split(".");
  const body = JSON.stringify(args, null, 2);
  // POSIX-correct single-quote escaping: 'it'\''s' — a copy block that does
  // not run when pasted is worse than no copy block.
  const shellBody = body.replace(/'/g, "'\\''");
  const text = `# mcp://${server}/${rest.join(".") || "call"}\ncurl -X POST $MCP_ENDPOINT/${server}/${rest.join(".") || "call"} \\\n  -H 'content-type: application/json' \\\n  -d '${shellBody}'`;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2">
        <Label>Request · reconstructed from the journal</Label>
        <span className="grow" />
        <CopyButton text={text} />
      </span>
      <pre className="overflow-x-auto rounded-md border border-line bg-sunken/40 p-2.5 font-mono text-[10.5px] leading-[1.6] text-mist">{text}</pre>
    </div>
  );
}

function ResponseBlock({ value }: { value: unknown }) {
  const text = typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2">
        <Label>Response</Label>
        <span className="grow" />
        <CopyButton text={text} />
      </span>
      <pre className="max-h-[240px] overflow-auto rounded-md border border-line bg-sunken/40 p-2.5 font-mono text-[10.5px] leading-[1.6] whitespace-pre-wrap text-mist">
        {text}
      </pre>
    </div>
  );
}
