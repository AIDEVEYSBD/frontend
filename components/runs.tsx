"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Kbd, Mono, RUN_STATE, Status, Tag } from "./ui";
import { Thinking } from "./loaders";
import { Icon } from "./builder/icons";
import { Pick } from "./select";
import { fromDocument, HARNESS, inputKeysOf, toDocument, type AgentSystem, type Kind } from "@/lib/spec";
import { useModels } from "@/lib/use-models";

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

interface RunSummary {
  id: string;
  system: string;
  state: string;
  at: string;
  duration_ms: number;
  denied: number;
}

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
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d) => setAgents(d.agents ?? []))
      .catch(() => setAgents([]));
    fetch("/api/runs")
      .then((r) => r.json())
      .then((d) => setHistory(d.runs ?? []))
      .catch(() => setHistory([]));
  }, []);

  return (
    <div className="min-h-full">
      <div className="mx-auto flex max-w-[1080px] flex-col gap-8 px-4 py-8 sm:px-6 lg:px-10">
        <header className="flex flex-col gap-1.5">
          <h1 className="text-[24px] font-semibold tracking-[-0.02em]">Runs</h1>
          <p className="max-w-[640px] text-[13.5px] leading-relaxed text-dim">
            Pick a workflow and run it. Everything happens in the theater — the graph filling in,
            every call and refusal as it lands, artifacts appearing as they are written.
          </p>
        </header>

        <section className="flex flex-col gap-3">
          <h2 className="font-mono text-[10px] tracking-[0.14em] text-faint uppercase">Run a workflow</h2>
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
                className="focusable group flex cursor-pointer flex-col gap-2.5 rounded-lg border border-line bg-surface p-4 text-left elev-1 transition-[border-color,box-shadow,transform] duration-150 ease-[var(--ease-out)] hover:-translate-y-px hover:border-line-strong hover:elev-2"
              >
                <div className="flex items-center gap-2.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-md bg-run-bg text-run">
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
            <h2 className="font-mono text-[10px] tracking-[0.14em] text-faint uppercase">Previous runs</h2>
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
              <p className="animate-pulse px-4 py-5 text-[12px] text-faint">Reading the record…</p>
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
                    <span className="truncate text-[13px] font-semibold text-fg">{r.system || r.id}</span>
                    <Mono className="truncate text-[10.5px] text-faint">
                      {r.id} · {ago(r.at)} · {(r.duration_ms / 1000).toFixed(1)}s
                    </Mono>
                  </div>
                  {r.denied > 0 && <Status tone="err">{r.denied} refused</Status>}
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
  const stateFile = useRef("");
  const abort = useRef<AbortController | null>(null);
  const maxT = useRef(0);
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

  /* The spec: from the registry, or handed over from the builder as a draft. */
  useEffect(() => {
    if (draft) {
      try {
        const raw = sessionStorage.getItem("af-run-draft");
        if (!raw) throw new Error("no draft was handed over — go back to the builder");
        setSystem(fromDocument(JSON.parse(raw)));
      } catch (e) {
        setLoadError((e as Error).message);
      }
      return;
    }
    if (!agentId) return;
    fetch(`/api/agents?id=${encodeURIComponent(agentId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(String(d.error));
        setSystem(fromDocument(d.spec));
      })
      .catch((e) => setLoadError((e as Error).message));
  }, [agentId, draft]);

  useEffect(() => {
    if (!system) return;
    setInput(seedInput(system));
    setFields(inputKeysOf(system).map((k) => ({ ...k, value: "" })));
  }, [system]);
  useEffect(() => () => abort.current?.abort(), []);

  const consume = useCallback(
    async (body: Record<string, unknown>) => {
      setPhase("live");
      setError("");
      setSuspension(null);
      startedAt.current = Date.now();
      setWallMs(0);
      const ctrl = new AbortController();
      abort.current = ctrl;
      try {
        const res = await fetch("/api/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error((await res.text().catch(() => "")).slice(0, 300) || `runtime returned ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffered = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffered += decoder.decode(value, { stream: true });
          const frames = buffered.split("\n\n");
          buffered = frames.pop() ?? "";
          for (const frame of frames) {
            const line = frame.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            let msg: Record<string, unknown>;
            try {
              msg = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            if (msg.type === "entry") {
              const e = msg as unknown as Entry;
              // Fold resumed legs onto one clock.
              const t = e.t + (e.t + maxT.current < maxT.current ? 0 : 0);
              const shifted = { ...e, t: e.t < maxT.current ? e.t + maxT.current : e.t };
              maxT.current = Math.max(maxT.current, shifted.t);
              setEntries((prev) => [...prev, shifted]);
              void t;
            } else if (msg.type === "opened") {
              stateFile.current = String(msg.stateFile ?? "");
            } else if (msg.type === "output") {
              setOutputs((prev) => [...prev, msg as unknown as OutputRecord]);
            } else if (msg.type === "end") {
              const end = msg as { state?: string; error?: string; suspension?: Suspension | null; result?: Record<string, unknown> };
              if (end.result) setResult(end.result);
              setFinalState(String(end.state ?? ""));
              if (end.state === "suspended" && end.suspension) setSuspension(end.suspension);
              else setPhase("done");
              if (end.error) setError(String(end.error));
              const runId = stateFile.current.split("/").pop()?.replace(/\.json$/, "");
              if (runId) {
                fetch("/api/control")
                  .then((r) => r.json())
                  .then((d) => {
                    const row = (d.runs ?? []).find((x: { id: string }) => x.id === runId);
                    if (!row) return;
                    setRunCost(
                      row.cost === null ? "cost —" : row.cost === 0 ? "$0.00" : row.cost < 0.005 ? "<$0.01" : `$${row.cost.toFixed(2)}`,
                    );
                  })
                  .catch(() => {});
              }
            } else if (msg.type === "error") {
              setError(String(msg.message ?? "unknown failure"));
            }
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setError((e as Error).message);
          setPhase("done");
          setFinalState("failed");
        }
      } finally {
        setPhase((p) => (p === "live" ? p : p));
      }
    },
    [],
  );

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
    stateFile.current = "";
    maxT.current = 0;
    consume({ spec: toDocument(system), input: parsed, model: model || defaultModel });
  };

  const answer = (approved: boolean, by: string, note: string) => {
    if (!system) return;
    consume({
      spec: toDocument(system),
      stateFile: stateFile.current,
      answer: { approved, by: by || "console", note },
      model: model || defaultModel,
    });
  };

  if (loadError) {
    return (
      <div className="mx-auto max-w-[720px] px-6 py-10">
        <p className="rounded-md border border-err-line bg-err-bg px-3 py-2.5 text-[12.5px] text-err">{loadError}</p>
      </div>
    );
  }
  if (!system) return <p className="px-8 py-10 text-[12.5px] text-faint">Loading the workflow…</p>;

  return (
    <Theater
      title={system.name}
      subtitle={system.id}
      nodes={system.nodes.map((n) => ({ id: n.id, label: n.label || n.id, kind: n.harness }))}
      entries={entries}
      live={phase === "live" && !suspension}
      finalState={suspension ? "suspended" : phase === "done" ? finalState : phase === "live" ? "running" : ""}
      error={error}
      outputs={outputs}
      result={result}
      suspension={suspension}
      onAnswer={answer}
      setup={
        phase === "setup" ? (
          <div className="flex flex-col gap-3 border-b border-line bg-raise/40 px-4 py-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[280px] grow">
                {system.trigger?.kind === "prompt" ? (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[12px] font-medium text-mist">Prompt</span>
                    <textarea
                      rows={2}
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder={String(system.trigger.config?.placeholder ?? "What should this run look at?")}
                      className="w-full resize-y rounded-md border border-line-strong bg-field px-3 py-2 text-[13px] leading-[1.55] text-fg placeholder:text-ghost focus:border-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-fg/15"
                    />
                  </label>
                ) : jsonMode || !fields.length ? (
                  <label className="flex flex-col gap-1.5">
                    <span className="flex items-center gap-2 text-[12px] font-medium text-mist">
                      Input
                      {fields.length > 0 && (
                        <button
                          onClick={() => setJsonMode(false)}
                          className="focusable cursor-pointer rounded-sm text-[10.5px] font-normal text-faint hover:text-fg"
                        >
                          back to fields
                        </button>
                      )}
                    </span>
                    <textarea
                      rows={3}
                      value={input}
                      onChange={(e) => {
                        setInput(e.target.value);
                        setError("");
                      }}
                      aria-invalid={Boolean(error) || undefined}
                      className={`w-full resize-y rounded-md border bg-field px-3 py-2 font-mono text-[12px] leading-[1.55] text-fg focus:border-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-fg/15 ${
                        error ? "border-err-line" : "border-line-strong"
                      }`}
                    />
                  </label>
                ) : (
                  <div className="flex flex-col gap-2">
                    <span className="flex items-center gap-2 text-[12px] font-medium text-mist">
                      Input
                      <span className="text-[10.5px] font-normal text-ghost">
                        fields from the spec itself
                      </span>
                      <button
                        onClick={() => setJsonMode(true)}
                        className="focusable cursor-pointer rounded-sm text-[10.5px] font-normal text-faint hover:text-fg"
                      >
                        edit as JSON
                      </button>
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
                            <textarea
                              rows={1}
                              value={f.value}
                              onChange={(e) =>
                                setFields((fs) =>
                                  fs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                                )
                              }
                              className="w-full resize-y rounded-md border border-line-strong bg-field px-3 py-1.5 text-[12.5px] leading-[1.5] text-fg focus:border-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-fg/15"
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
              </div>
              <div className="w-[190px]">
                <span className="mb-1.5 block text-[12px] font-medium text-mist">Model</span>
                <Pick
                  value={model || defaultModel}
                  onChange={setModel}
                  options={models.map((m) => ({ value: m.id, label: m.label }))}
                />
              </div>
              <button
                onClick={start}
                className="focusable h-9 shrink-0 cursor-pointer rounded-md border border-transparent bg-ink px-5 text-[13px] font-medium text-on-ink transition-[filter] hover:brightness-[1.15] active:brightness-95"
              >
                Run
              </button>
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
            <Mono className="tnum text-[11px] text-faint">{clock(Math.max(maxT.current, wallMs))}</Mono>
            <button
              onClick={() => {
                // The real kill switch — SIGTERM to the runtime, which journals
                // "killed by operator" and persists the run. The stream stays
                // open so the kill lands in the transcript in front of you.
                setKilling(true);
                const id = stateFile.current.split("/").pop()?.replace(/\.json$/, "");
                if (id) {
                  fetch("/api/kill", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ id }),
                  }).catch(() => {});
                } else {
                  // Nothing registered yet — nothing is running to kill.
                  abort.current?.abort();
                  setPhase("done");
                  setFinalState("killed");
                  setError("stopped before the runtime registered the run");
                }
              }}
              disabled={killing}
              className="focusable cursor-pointer rounded-sm border border-line px-2 py-1 text-[11.5px] font-medium text-dim transition-colors hover:border-err-line hover:text-err disabled:opacity-50"
            >
              {killing ? "Killing…" : "Kill run"}
            </button>
          </div>
        ) : phase === "done" || suspension ? (
          <div className="flex h-11 shrink-0 items-center gap-3 border-t border-line bg-surface px-4">
            <StateBadge state={suspension ? "suspended" : finalState} />
            {error && <span className="min-w-0 truncate text-[11.5px] text-err">{error}</span>}
            <span className="grow" />
            {runCost && <Mono className="tnum text-[11px] text-faint">{runCost}</Mono>}
            <Mono className="tnum text-[11px] text-faint">{clock(maxT.current)}</Mono>
            <button
              onClick={() => {
                setPhase("setup");
                setEntries([]);
                setOutputs([]);
                setResult(null);
                setSuspension(null);
                setFinalState("");
                setError("");
                setKilling(false);
                stateFile.current = "";
                maxT.current = 0;
              }}
              className="focusable cursor-pointer rounded-sm border border-line px-2 py-1 text-[11.5px] font-medium text-dim transition-colors hover:text-fg"
            >
              Run again
            </button>
          </div>
        ) : null
      }
    />
  );
}

/* ═══════════════════ Replay theater ═══════════════════ */

function ReplayTheater({ id }: { id: string }) {
  const params = useSearchParams();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [meta, setMeta] = useState<{
    system: string;
    runId: string;
    state: string;
    error: string;
    result: Record<string, unknown> | null;
  }>({ system: "", runId: "", state: "", error: "", result: null });
  const [specNodes, setSpecNodes] = useState<{ id: string; label: string; kind: string }[] | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    fetch(`/api/runs?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(String(d.error));
        setEntries(normalise(d.run?.journal?.entries ?? []));
        setMeta({
          system: d.run?.system ?? "",
          runId: d.run?.id ?? "",
          state: d.run?.state ?? "",
          error: d.run?.error ?? "",
          result: d.run?.result ?? null,
        });
      })
      .catch((e) => setLoadError((e as Error).message));
  }, [id]);

  /* The full spine comes from the spec, so the nodes a run never reached are
     visible as never-reached — what a run didn't do is part of the review. */
  useEffect(() => {
    if (!meta.system) return;
    let stop = false;
    fetch(`/api/agents?id=${encodeURIComponent(meta.system)}`)
      .then((r) => r.json())
      .then((d) => {
        if (stop || !d.spec) return;
        const s = fromDocument(d.spec);
        setSpecNodes(s.nodes.map((n) => ({ id: n.id, label: n.label || n.id, kind: n.harness })));
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
        <p className="rounded-md border border-err-line bg-err-bg px-3 py-2.5 text-[12.5px] text-err">{loadError}</p>
      </div>
    );
  }
  if (!entries) return <p className="px-8 py-10 text-[12.5px] text-faint">Loading the journal…</p>;

  const atEnd = playback.t >= duration;
  const visible = entries.filter((e) => e.t <= playback.t);

  return (
    <Theater
      title={meta.system}
      subtitle={meta.runId}
      nodes={nodes}
      entries={visible}
      live={playback.playing}
      // The state is a fact about the record, not about the scrub position.
      finalState={meta.state}
      error={atEnd ? meta.error : ""}
      outputs={[]}
      result={atEnd ? meta.result : null}
      suspension={null}
      onAnswer={() => {}}
      setup={null}
      segments={segments}
      tNow={playback.t}
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

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-line bg-raise/60 px-4 py-3">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "Pause" : "Play"}
          className="focusable grid size-8 shrink-0 cursor-pointer place-items-center rounded-md bg-ink text-on-ink transition-opacity hover:opacity-90"
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
        </button>

        <div className="flex items-center gap-1">
          <button
            onClick={() => step(-1, marks)}
            aria-label="Previous node"
            className="focusable grid size-7 cursor-pointer place-items-center rounded-md text-faint transition-colors hover:bg-raise hover:text-fg"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M17 5.5v13L8 12z" />
              <rect x="5" y="5" width="2" height="14" rx="1" />
            </svg>
          </button>
          <button
            onClick={() => step(1, marks)}
            aria-label="Next node"
            className="focusable grid size-7 cursor-pointer place-items-center rounded-md text-faint transition-colors hover:bg-raise hover:text-fg"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M7 5.5v13L16 12z" />
              <rect x="17" y="5" width="2" height="14" rx="1" />
            </svg>
          </button>
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
                title={s.label}
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
                title={e.title}
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
              title={`${m.title} · ${clock(m.t)}`}
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
  entries,
  live,
  finalState,
  error,
  outputs,
  result,
  suspension,
  onAnswer,
  setup,
  footer,
  segments,
  tNow,
}: {
  title: string;
  subtitle: string;
  nodes: { id: string; label: string; kind: string }[];
  entries: Entry[];
  live: boolean;
  finalState: string;
  error: string;
  outputs: OutputRecord[];
  result: Record<string, unknown> | null;
  suspension: Suspension | null;
  onAnswer: (approved: boolean, by: string, note: string) => void;
  setup: React.ReactNode;
  footer: React.ReactNode;
  /** Replay only: node time-bands + the playhead, for per-node progress. */
  segments?: { id: string; from: number; to: number }[];
  tNow?: number;
}) {
  const router = useRouter();
  const draftId =
    result && typeof result.draft_id === "string" && /^[a-z][a-z0-9-]{0,62}$/.test(result.draft_id)
      ? result.draft_id
      : null;
  const modelCalls = entries.filter((e) => e.kind === "model.call").length;
  const denied = entries.filter((e) => e.kind === "denied" || e.kind === "contract.breach").length;
  const artifacts = useMemo(() => artifactsOf(entries), [entries]);

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
    <div className="flex h-full min-h-0 flex-col">
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
        {suspension ? (
          <Status tone="warn">Awaiting approval</Status>
        ) : live ? (
          <Status tone="run">Running</Status>
        ) : (
          <StateBadge state={finalState} />
        )}
        <div className="grow" />
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
      {suspension && <GateBanner suspension={suspension} onAnswer={onAnswer} />}

      <div className="grid min-h-0 grow grid-cols-1 md:grid-cols-[minmax(150px,190px)_minmax(0,1fr)] xl:grid-cols-[minmax(160px,200px)_minmax(0,1fr)_minmax(280px,340px)]">
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
        <TheaterTranscript entries={entries} live={live} />

        {/* ── artifact rail ── */}
        <aside className="flex min-h-0 min-w-0 flex-col md:col-span-2 xl:col-span-1">
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-raise/60 px-4">
            <span className="truncate text-[12px] font-semibold">Artifacts</span>
            <div className="grow" />
            {artifacts.length > 1 && (
              <button
                onClick={() => {
                  for (const a of artifacts) {
                    const link = document.createElement("a");
                    link.href = `/api/artifact?name=${encodeURIComponent(a.name)}`;
                    link.download = a.name;
                    link.click();
                  }
                }}
                className="focusable shrink-0 cursor-pointer rounded-sm text-[10.5px] font-medium text-faint transition-colors hover:text-fg"
              >
                Download all ({artifacts.length})
              </button>
            )}
            <Mono className="shrink-0 text-[11px] text-faint">{artifacts.length} produced</Mono>
          </div>
          <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto px-4 py-4">
            {suspension && (
              <p className="rounded-md border border-warn-line bg-warn-bg px-3 py-2.5 text-[12px] leading-[1.55] text-warn">
                Paused at <Mono className="text-[11px]">{suspension.node}</Mono> — the decision is
                in the banner above.
              </p>
            )}

            {draftId && finalState === "done" && (
              <div className="flex flex-col gap-2.5 rounded-md border border-run-line bg-run-bg p-3">
                <span className="text-[12px] font-semibold text-run">A draft was authored</span>
                <p className="text-[12px] leading-[1.55] text-mist">
                  The agent designed <code className="font-mono text-[11px]">{draftId}</code> and it
                  passed the deployment parser. It is a draft, not a deployed agent — open it,
                  review every grant and gate, then Save if it holds up.
                </p>
                <button
                  onClick={() => router.push(`/builder?draftId=${encodeURIComponent(draftId)}`)}
                  className="focusable h-8 w-fit cursor-pointer rounded-md bg-ink px-3.5 text-[12.5px] font-medium text-on-ink transition-[filter] hover:brightness-[1.15]"
                >
                  Open in Builder
                </button>
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
                <p key={i} className="rounded-md border border-err-line bg-err-bg px-2.5 py-2 text-[11.5px] text-err">
                  {o.kind} output failed: {o.error}
                </p>
              ))}

            {error && finalState === "failed" && (
              <p className="rounded-md border border-err-line bg-err-bg px-2.5 py-2 text-[11.5px] leading-[1.55] text-err">
                {error}
              </p>
            )}
          </div>
        </aside>
      </div>

      {footer}
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
        <a
          href={url}
          download={a.name}
          target="_blank"
          rel="noreferrer"
          aria-label={`Download ${a.name}`}
          className="focusable shrink-0 rounded-sm p-1 text-faint transition-colors hover:text-fg"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
          </svg>
        </a>
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
  onAnswer,
}: {
  suspension: Suspension;
  onAnswer: (approved: boolean, by: string, note: string) => void;
}) {
  const [by, setBy] = useState("");
  const [note, setNote] = useState("");
  const [needNote, setNeedNote] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, []);

  return (
    <div
      ref={ref}
      role="region"
      aria-label="Approval required"
      className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2.5 border-b border-warn-line bg-warn-bg px-4 py-3"
    >
      <span className="flex items-center gap-2">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-2 animate-ping rounded-full bg-warn opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-warn" />
        </span>
        <span className="text-[13px] font-semibold text-warn">A person decides here</span>
      </span>
      <span className="min-w-0 max-w-[52ch] text-[12.5px] leading-[1.5] text-mist">
        {suspension.prompt}
      </span>
      <Mono className="text-[10.5px] text-faint">
        {suspension.approvers.length ? `asks: ${suspension.approvers.join(", ")}` : "no approver role set"}
      </Mono>
      <span className="grow" />
      <input
        value={by}
        onChange={(e) => setBy(e.target.value)}
        placeholder="Your name or initials"
        aria-label="Approver identity — goes to the journal"
        className="focusable h-8 w-36 rounded-md border border-warn-line bg-surface px-2.5 text-[12px] text-fg placeholder:text-ghost"
      />
      <input
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          setNeedNote(false);
        }}
        placeholder={needNote ? "A rejection needs a reason" : "Reason (goes to the journal)"}
        aria-label="Decision rationale — goes to the journal"
        aria-invalid={needNote || undefined}
        className={`focusable h-8 w-64 rounded-md border bg-surface px-2.5 text-[12px] text-fg placeholder:text-ghost ${
          needNote ? "border-err-line placeholder:text-err" : "border-warn-line"
        }`}
      />
      <button
        onClick={() => onAnswer(true, by, note || "approved in the theater")}
        className="focusable h-8 cursor-pointer rounded-md bg-ok px-3.5 text-[12.5px] font-medium text-on-solid transition-[filter] hover:brightness-110"
      >
        Approve
      </button>
      <button
        onClick={() => {
          // A rejection with no reason is a rejection nobody can learn from.
          if (!note.trim()) {
            setNeedNote(true);
            return;
          }
          onAnswer(false, by, note);
        }}
        className="focusable h-8 cursor-pointer rounded-md border border-err-line px-3.5 text-[12.5px] font-medium text-err transition-colors hover:bg-err-bg"
      >
        Reject
      </button>
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

function TheaterTranscript({ entries, live }: { entries: Entry[]; live: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [unseen, setUnseen] = useState(0);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (pinned.current) {
      el.scrollTop = el.scrollHeight;
      setUnseen(0);
    } else {
      setUnseen((n) => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          <JournalRow key={e.id ?? i} e={e} entries={entries} />
        ))}
        {shown.length === 0 && (
          <p className="text-[12px] text-faint">Nothing of this kind in the journal{live ? " yet" : ""}.</p>
        )}
      </div>

      {/* Events landing below the fold while scrolled up — say so. */}
      {unseen > 0 && live && (
        <button
          onClick={() => {
            const el = scroller.current;
            if (el) el.scrollTop = el.scrollHeight;
            pinned.current = true;
            setUnseen(0);
          }}
          className="focusable absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-[11px] font-medium text-dim elev-2 transition-colors hover:text-fg"
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 5v14M6 13l6 6 6-6" />
          </svg>
          {unseen} new event{unseen === 1 ? "" : "s"}
        </button>
      )}
    </section>
  );
}

/* ── Humanising: the transcript speaks prose; JSON is one click away ── */

/** One line saying what a tool call produced — never the payload itself. */
function summarise(value: unknown): string {
  if (value === null || value === undefined) return "";
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

function JournalRow({ e, entries }: { e: Entry; entries: Entry[] }) {
  const [open, setOpen] = useState(false);

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
            {e.tainted && (
              <span
                title="This model call worked over content authored outside the system — untrusted input, tracked by the taint rules"
                className="rounded-sm border border-warn-line bg-warn-bg px-1 py-px text-[9px] font-semibold text-warn"
              >
                tainted input
              </span>
            )}
          </span>
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
            <button
              onClick={() => setOpen(!open)}
              className="focusable w-fit cursor-pointer rounded-sm text-[10.5px] font-medium text-faint transition-colors hover:text-fg"
            >
              {open ? (asJson ? "show as prose" : "show less") : asJson ? "view raw" : `show all (${(text.length / 1000).toFixed(1)}k chars)`}
            </button>
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
                {response ? (
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
              {response && <ResponseBlock value={response.data?.value} />}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (e.kind === "tool.result") return null; // rendered inside its call's card

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
    <button
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
      aria-label="Copy"
      className="focusable cursor-pointer rounded-sm px-1 font-mono text-[9px] tracking-[0.1em] text-faint uppercase transition-colors hover:text-fg"
    >
      {done ? "copied" : "copy"}
    </button>
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
        <span className="font-mono text-[9px] tracking-[0.12em] text-faint uppercase">
          Request · reconstructed from the journal
        </span>
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
        <span className="font-mono text-[9px] tracking-[0.12em] text-faint uppercase">Response</span>
        <span className="grow" />
        <CopyButton text={text} />
      </span>
      <pre className="max-h-[240px] overflow-auto rounded-md border border-ok-line/50 bg-ok-bg/30 p-2.5 font-mono text-[10.5px] leading-[1.6] whitespace-pre-wrap text-mist">
        {text}
      </pre>
    </div>
  );
}
