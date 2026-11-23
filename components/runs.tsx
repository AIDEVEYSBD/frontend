"use client";

import { CURRENT_USER } from "@/lib/user";
import { useSession, signerName } from "@/lib/use-session";
import { roleLabel } from "@/lib/permissions";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { soon } from "@/lib/soon";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, IconButton, Kbd, Label, Mono, RUN_STATE, Status, Tag } from "./ui";
import { Skeleton, Thinking } from "./loaders";
import { Field, Textarea } from "./forms";
import { Banner } from "./overlays";
import { gateDeadlineLine } from "@/lib/gates";
import { Failure, AnswerFailure } from "./pending";
import { Icon } from "./builder/icons";
import { Pick } from "./select";
import { fromDocument, HARNESS, inputKeysOf, toDocument, type AgentSystem, type Kind } from "@/lib/spec";
import { useModels } from "@/lib/use-models";
import { runBlockers, unsupportedOf, unsupportedReason, type UnsupportedPart } from "@/lib/unsupported";
import { notBuilt, readRunRowsNotBuilt } from "@/lib/not-built";
import { UnsupportedParts } from "./unsupported";
import { SpanDetail, Waterfall, useTrace, type Span } from "./waterfall";
import { controlLabel, explainControl } from "@/lib/guardrails";
import { ControlMark, ControlRef, KILL_CONTROL } from "./control-ref";
import { callOfEntry, callOutcomes, callStateLabel, type CallOutcome } from "@/lib/tool-calls";
import { RunBoard, ViewSwitch, useRunView, type BoardEdge } from "./run-board";
import { api, errorText, subscribeRunEvents, type RunEnd, type Schemas } from "@/lib/api/client";
import { DoorError, artefactsZipUrl, gateFromSuspension, listGates, operatorOf, type Gate } from "@/lib/api/l5";
import { startRefusalOf, type StartRefusal } from "@/lib/start-refusal";
import { runSourceOf, type RunRowL6 } from "@/lib/api/l6";
import { exitText, sandboxLine, sandboxOfEntry, sandboxRunOf, SANDBOX_TOOL } from "@/lib/sandbox";
import { RunSourceTag } from "./run-source";
import { SandboxOutput, SandboxSummary } from "./sandbox-result";
import { KillDialog } from "./kill-dialog";
import { RunFlagsBanner, RunMarkers } from "./run-flags";
import { retiredLine, runFlagsOf, type RunFlags } from "@/lib/lifecycle";
import { retiredOf, type Retired } from "@/lib/api/l8";
import { deliverableFileUrl, downloadDeliverable } from "@/lib/api/l8b";
import { fileRefusalText, sizeText } from "@/lib/deliverables";
import { useDoorOff } from "@/lib/use-doors";
import { wouldCallOf, wouldCallLine } from "@/lib/canary";
import { KillAlreadyView, KillReceiptView, RunTreePanel } from "./run-tree";
import { RateLimitNote, useRetryReady } from "./rate-limit";
import { killRefusalOf, killRun, type KillReceipt, type KillRefusal, type RateLimit } from "@/lib/api/l7";
import { LineageDrawer } from "./lineage";
import { ProvenanceDrawer, RunAssurance } from "./provenance";
import { decisionsOf, type SignedDecision } from "@/lib/api/l9";
import { hasProvenance } from "@/lib/provenance";
import { ApproveDialog } from "./approve";
import { SteerPanel } from "./steer";
import { followsLive, steerOffer } from "@/lib/steer";
import { agentDocument, listAgents } from "@/lib/api/l2";
import { Deadline, useNow } from "./gate-form";
import { RunLimitsPanel, RunStrip, useRunSpec, type RunFacts } from "./run-limits";
import { RunFindings } from "./run-findings";
import { RunAuthorityPanel } from "./run-authority";
import { RunBoundaryPanel } from "./run-boundary";
import { RetrievalCard, retrievalOf } from "./run-retrieval";
import { ModelMark, modelCallOf, routeLine, titleIsModel } from "./run-model";
import type { Owner, Scope } from "@/lib/api/pending";

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

/**
 * A file the run wrote. `document.write` answers `{written, where, deliverable, digest, bytes, format}`:
 * the file is the deliverable that holds it, served by `GET /api/deliverables/{id}/file`. A file an
 * entry names without a deliverable (an older run's output note) is listed by name, with no link.
 */
interface RunFile {
  name: string;
  kind: string;
  t: number;
  deliverable?: string;
  digest?: string;
  bytes?: number;
}

function artifactsOf(entries: Entry[]): RunFile[] {
  const out: RunFile[] = [];
  for (const e of entries) {
    const raw = e.data?.value;
    const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const deliverable = e.kind === "tool.result" && typeof v.deliverable === "string" && v.deliverable ? v.deliverable : undefined;
    // `where` names the file; a result that names its deliverable without `written`/`where` (the shape before them) names it as `file`.
    const where =
      (e.kind === "tool.result" && v.written === true && String(v.where ?? "")) ||
      (deliverable && String(v.where ?? v.file ?? "")) ||
      (e.kind === "note" && String(e.data?.where ?? "")) ||
      "";
    if (!where) continue;
    const name = where.split("/").pop() ?? where;
    // One row per deliverable; a file without one is listed once by its name.
    if (out.some((a) => (deliverable ? a.deliverable === deliverable : !a.deliverable && a.name === name))) continue;
    out.push({
      name,
      kind: (typeof v.format === "string" && v.format) || name.split(".").pop() || "file",
      t: e.t,
      deliverable,
      digest: typeof v.digest === "string" && v.digest ? v.digest : undefined,
      bytes: typeof v.bytes === "number" && Number.isFinite(v.bytes) ? v.bytes : undefined,
    });
  }
  return out;
}

/**
 * Save a deliverable's file: fetched from its door, so a refusal (gone from
 * disk, changed since it was written) is said in words instead of saved as
 * the file. Returns the refusal's sentence, or "" when the file was saved.
 */
async function saveRunFile(f: RunFile): Promise<string> {
  if (!f.deliverable) return "the journal names no deliverable for this file, so the platform serves no copy of it";
  try {
    const got = await downloadDeliverable(f.deliverable);
    const url = URL.createObjectURL(got.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = got.filename || f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return "";
  } catch (e) {
    return e instanceof DoorError ? fileRefusalText(e) : (e as Error).message;
  }
}

/** A run's file as a link to its deliverable's file; a click saves it and says a refusal in words. Without a deliverable, its name alone. */
function RunFileLink({ f }: { f: RunFile }) {
  const [refused, setRefused] = useState("");
  const chip = "focusable flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-[11.5px] text-fg";
  if (!f.deliverable)
    return (
      <span className={`${chip} text-dim`} title="The journal names no deliverable for this file, so there is no copy to download.">
        <Icon name="file" size={12} className="text-faint" />
        {f.name}
      </span>
    );
  return (
    <span className="flex items-center gap-1.5">
      <a
        href={deliverableFileUrl(f.deliverable)}
        download={f.name}
        onClick={async (e) => {
          e.preventDefault();
          setRefused(await saveRunFile(f));
        }}
        className={`${chip} hover:border-line-strong`}
      >
        <Icon name={f.kind === "json" ? "json" : "file"} size={12} className="text-dim" />
        {f.name}
      </a>
      {refused && <span className="text-[11px] text-err" role="alert">{refused}</span>}
    </span>
  );
}

/** Every file of the run as one zip (`GET /api/runs/{id}/artefacts.zip`), a plain link; "not built" while the platform lists the address as not built. */
function DownloadAll({ runId, count, className = "" }: { runId: string; count: number; className?: string }) {
  const { off, why } = useDoorOff("GET", "/api/runs/{id}/artefacts.zip");
  const look = `focusable inline-flex h-7 shrink-0 items-center gap-1.5 rounded-sm border border-transparent bg-raise px-2.5 text-[12px] font-medium whitespace-nowrap text-fg ${className}`;
  if (off)
    return (
      <span aria-disabled="true" title={why} className={`${look} cursor-not-allowed opacity-50`}>
        Download all: not built
      </span>
    );
  return (
    <a href={artefactsZipUrl(runId)} download className={`${look} hover:brightness-[1.08] active:brightness-95`}>
      Download all ({count}, .zip)
    </a>
  );
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

/* ═══════════════════ The live stream's own state ═══════════════════ */

interface StreamState {
  reconnecting: boolean;
  lost: string;
  dropped: number;
  setReconnecting: (on: boolean) => void;
  setLost: (message: string) => void;
  setDropped: (n: number) => void;
  reset: () => void;
}

/** What the run screen says about its live stream: reconnecting, lost (with the status), and frames it could not read. */
function useStreamState(): StreamState {
  const [reconnecting, setReconnecting] = useState(false);
  const [lost, setLost] = useState("");
  const [dropped, setDropped] = useState(0);
  const reset = useCallback(() => {
    setReconnecting(false);
    setLost("");
    setDropped(0);
  }, []);
  return useMemo(() => ({ reconnecting, lost, dropped, setReconnecting, setLost, setDropped, reset }), [reconnecting, lost, dropped, reset]);
}

/** The footer's line about the stream: following, reconnecting, or lost with a way to open it again; and a count of unreadable frames. */
function StreamLine({ stream, following, onRetry }: { stream: StreamState; following: string; onRetry: () => void }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {stream.lost ? (
        <>
          <span className="min-w-0 truncate text-[12px] text-err" role="alert">Live stream lost: {stream.lost}</span>
          <Button size="sm" variant="solid" tone="ink" onClick={onRetry}>
            Open the stream again
          </Button>
        </>
      ) : stream.reconnecting ? (
        <span className="min-w-0 truncate text-[12px] text-warn" role="status">The live stream dropped; reconnecting… nothing new is shown until it is back.</span>
      ) : (
        <span className="min-w-0 truncate text-[12px] text-dim">{following}</span>
      )}
      {stream.dropped > 0 && (
        <span className="shrink-0 text-[11px] text-err">
          {stream.dropped} frame{stream.dropped === 1 ? "" : "s"} could not be read
        </span>
      )}
    </span>
  );
}

/* ═══════════════════ Launcher: pick something to run ═══════════════════ */

interface SavedAgent {
  id: string;
  name: string;
  description: string;
  nodes: number;
  /** L8: retired agents take no new runs; their card opens the lifecycle instead. */
  retired: Retired | null;
  /** Parts of its definition the platform does not carry out: such an agent cannot be run, and its card opens the agent instead. */
  unsupported: UnsupportedPart[];
}

/** A row of the backend's run ledger, as the list shows it. `stuck` and `waiting_on` are L5's; `source` (an attached agent's SDK, or A2A) is L6's. */
type RunSummary = Pick<RunRowL6, "id" | "system" | "state" | "at" | "ms" | "denials" | "live" | "stuck" | "waiting_on" | "source" | "shadow" | "review" | "taint" | "eval" | "canary"> & {
  /** Why the run is stuck, when it is: no worker has taken it and none has reported in, or its job ended while it still ran. */
  stuck_reason?: string | null;
};

const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};

/** A row's owner, when the ledger carries one (it will; see lib/api/pending.ts). */
const ownerOf = (r: unknown): Owner | null => {
  const o = (r as { owner?: unknown } | null)?.owner;
  return o && typeof o === "object" && typeof (o as Owner).name === "string" && (o as Owner).name ? (o as Owner) : null;
};

/** The agents that took part in a run beside the one it is listed under, when the row carries them. */
const agentsOf = (r: unknown, system: string): string[] => {
  const a = (r as { agents?: unknown } | null)?.agents;
  return Array.isArray(a) ? [...new Set(a.filter((x): x is string => typeof x === "string" && x !== "" && x !== system))] : [];
};

/* "My team" is shown and not offered: nothing sets a person's team, so the ledger has nothing to filter on. */
const SCOPES: { id: Scope; label: string; off?: string }[] = [
  { id: "mine", label: "Mine" },
  { id: "team", label: "My team", off: "Not built: nothing on this platform sets a person's team, so runs cannot be filtered by one." },
  { id: "all", label: "All" },
];

function StateBadge({ state }: { state: string }) {
  const s = RUN_STATE[state];
  return <Status tone={s?.tone ?? "queue"}>{s?.label ?? (state || "Ready")}</Status>;
}

function Launcher() {
  const [agents, setAgents] = useState<SavedAgent[] | null>(null);
  const [history, setHistory] = useState<RunSummary[] | null>(null);
  const [stateFilter, setStateFilter] = useState("");
  /** L8, second round: a canary's shadow runs are listed, marked; a person may set them aside. */
  const [hideShadows, setHideShadows] = useState(false);
  const shadows = (history ?? []).filter((r) => r.shadow === true).length;
  const router = useRouter();
  /** Whose runs: sent as `scope` on the list call once chosen. Offered only when the ledger's rows carry owners. */
  const [scope, setScope] = useState<Scope | "">("");
  const [owned, setOwned] = useState(false);
  /* Why each of the two reads failed, when it did. A failed read is shown as the failure, never as "no workflow yet" or "no runs yet". */
  const [agentsError, setAgentsError] = useState("");
  const [historyError, setHistoryError] = useState("");

  useEffect(() => {
    listAgents()
      .then((rows) => setAgents(rows.map((a) => ({ id: a.id, name: a.name, description: a.description ?? "", nodes: a.nodes, retired: retiredOf(a.retired), unsupported: runBlockers(unsupportedOf(a), a.version, a.deployed_version) }))))
      .catch((e) => setAgentsError((e as Error).message));
  }, []);

  useEffect(() => {
    let live = true;
    api
      // `scope` is ahead of the generated types: the ledger takes it once rows carry owners.
      .GET("/api/runs", scope ? { params: { query: { scope } as unknown as { agent?: string } } } : {})
      .then(({ data, error, response }) => {
        if (!live) return;
        if (!data) {
          setHistory(null);
          setHistoryError(errorText(error, response, "GET"));
          return;
        }
        setHistory(data.runs);
        setHistoryError("");
        if (data.runs.some((r) => ownerOf(r))) setOwned(true);
      })
      .catch((e) => {
        if (!live) return;
        setHistory(null);
        setHistoryError(`the backend did not answer GET /api/runs (${(e as Error).message})`);
      });
    return () => {
      live = false;
    };
  }, [scope]);

  return (
    <div className="min-h-full" data-hue="blue">
      <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-8 px-5 py-7">
        <header className="flex flex-col gap-1.5">
          <h1 className="text-[24px] font-semibold tracking-[-0.02em]">Runs</h1>
          <p className="max-w-[640px] text-[13.5px] leading-relaxed text-dim">
            Launch a workflow and follow its execution as it happens. Review each model call, budget
            decision, human approval and output in the resulting run record.
          </p>
        </header>

        <section className="flex flex-col gap-3">
          <h2>
            <Label>Run a workflow</Label>
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {agentsError && <Failure className="col-span-full" what="The workflows could not be read" message={agentsError} />}
            {agents === null && !agentsError &&
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
                No workflow is on this deployment yet. Once one is deployed it can be run from here.
              </p>
            )}
            {(agents ?? []).map((a) => (
              <button
                key={a.id}
                onClick={() => router.push(a.retired ? `/lifecycle?agent=${encodeURIComponent(a.id)}` : a.unsupported.length ? `/agent?id=${encodeURIComponent(a.id)}` : `/runs?agent=${encodeURIComponent(a.id)}`)}
                title={a.retired ? retiredLine(a.retired) : a.unsupported.length ? unsupportedReason(a.unsupported) : undefined}
                className={`focusable group flex cursor-pointer flex-col gap-2.5 rounded-lg border border-line p-4 text-left elev-1 transition-[border-color,box-shadow,transform] duration-200 ease-[var(--ease-out)] hover:-translate-y-px hover:border-line-strong hover:elev-2 ${a.retired ? "bg-raise/60" : "bg-surface"}`}
              >
                <div className="flex items-center gap-2.5">
                  <span className="grid size-8 shrink-0 place-items-center rounded-md bg-raise text-dim">
                    <Icon name="workflow" size={15} />
                  </span>
                  <span className={`min-w-0 truncate text-[13.5px] font-semibold ${a.retired ? "text-dim" : "text-fg"}`}>{a.name}</span>
                  {a.retired && <Status tone="neutral">Retired</Status>}
                </div>
                {a.retired ? (
                  <p className="text-[11.5px] leading-[1.55] text-faint">
                    {a.retired.reason}
                    {a.retired.replacement ? ` · replaced by ${a.retired.replacement}` : ""}
                  </p>
                ) : (
                  a.description && <p className="text-[11.5px] leading-[1.55] text-dim">{a.description}</p>
                )}
                {!a.retired && <UnsupportedParts parts={a.unsupported} compact />}
                <span className="mt-auto flex items-center gap-2 border-t border-line pt-2">
                  <Mono className="text-[10px] text-faint">{a.nodes} nodes</Mono>
                  {!a.retired && a.unsupported.length > 0 && <span className="text-[10.5px] font-medium text-warn">Cannot be run</span>}
                  <span className="grow" />
                  <span className={`flex items-center gap-1 text-[11px] font-medium opacity-0 transition-opacity group-hover:opacity-100 ${a.retired || a.unsupported.length ? "text-dim" : "text-run"}`}>
                    {a.retired ? "Lifecycle" : a.unsupported.length ? "Agent" : "Run"}
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
            {/* Whose runs: only once the ledger says whose each is. */}
            {(owned || scope) && (
              <div role="radiogroup" aria-label="Whose runs" className="inline-flex items-center gap-px rounded-md border border-line bg-raise p-px">
                {SCOPES.map((o) => {
                  const on = (scope || "all") === o.id;
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-disabled={o.off ? true : undefined}
                      disabled={Boolean(o.off)}
                      title={o.off}
                      onClick={() => setScope(o.id)}
                      className={`focusable rounded-sm px-2 py-0.5 text-[11px] transition-colors duration-100 ${o.off ? "cursor-not-allowed font-medium text-ghost" : on ? "cursor-pointer bg-surface font-semibold text-fg shadow-[var(--shadow-1)]" : "cursor-pointer font-medium text-faint hover:text-dim"}`}
                    >
                      {o.label}
                      {o.off && <span className="ml-1 text-[10px] font-normal">not built</span>}
                    </button>
                  );
                })}
              </div>
            )}
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
              {shadows > 0 && (
                <button
                  onClick={() => setHideShadows((h) => !h)}
                  aria-pressed={hideShadows}
                  title="A shadow run is a canary's mirror of a production run: its calls at or above write and calls that act outside were recorded as would-call, not made."
                  className={`focusable ml-2 cursor-pointer rounded-sm px-2 py-0.5 text-[11px] transition-colors ${hideShadows ? "bg-raise font-semibold text-fg" : "font-medium text-faint hover:text-dim"}`}
                >
                  {hideShadows ? `Show shadow runs (${shadows})` : `Hide shadow runs (${shadows})`}
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
            {historyError && <Failure className="m-3" what="The run ledger could not be read" message={historyError} />}
            {history === null && !historyError && (
              <div role="status" aria-label="Reading the record" className="px-4 py-5">
                <Skeleton lines={3} />
              </div>
            )}
            {history?.length === 0 && (
              <p className="px-4 py-5 text-[12px] text-faint">{scope === "mine" ? "No run of yours is recorded." : "No runs recorded yet."}</p>
            )}
            {(history ?? [])
              .filter((r) => !stateFilter || r.state === stateFilter)
              .filter((r) => !hideShadows || r.shadow !== true)
              .map((r, i) => {
                const took = agentsOf(r, r.system);
                const owner = ownerOf(r);
                return (
                <button
                  key={r.id}
                  onClick={() => router.push(`/runs?id=${encodeURIComponent(r.id)}`)}
                  className={`focusable flex cursor-pointer items-center gap-4 px-4 py-2.5 text-left transition-colors hover:bg-raise/60 ${
                    i > 0 ? "border-t border-line" : ""
                  }`}
                >
                  <div className="flex min-w-0 grow flex-col">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={`truncate text-[13px] font-semibold ${r.shadow ? "text-dim" : "text-fg"}`}>{r.system || r.id}</span>
                      <RunSourceTag run={r} />
                      <RunMarkers run={r} />
                    </span>
                    <Mono className={`truncate text-[10.5px] ${r.stuck ? "text-warn" : "text-faint"}`}>
                      {r.id} · {ago(r.at)} · {(r.ms / 1000).toFixed(1)}s
                      {r.waiting_on ? ` · waiting on ${r.waiting_on}` : ""}
                    </Mono>
                    {r.stuck && r.stuck_reason && <span className="text-[11px] leading-[1.45] text-warn">{r.stuck_reason}</span>}
                    {took.length > 0 && (
                      <span className="flex min-w-0 flex-wrap items-center gap-1 pt-0.5" title={`Agents that took part: ${took.join(", ")}`}>
                        <span className="text-[10.5px] text-faint">with</span>
                        {took.slice(0, 4).map((a) => (
                          <Tag key={a}>{a}</Tag>
                        ))}
                        {took.length > 4 && <span className="tnum text-[10.5px] text-faint">and {took.length - 4} more</span>}
                      </span>
                    )}
                  </div>
                  {owner && (
                    <span className="hidden max-w-[180px] shrink-0 truncate text-[11px] text-dim sm:inline" title={[owner.name, owner.team, owner.email].filter(Boolean).join(" · ")}>
                      {owner.name}
                      {owner.team ? <span className="text-faint"> · {owner.team}</span> : null}
                    </span>
                  )}
                  {r.stuck && <Status tone="warn">stuck</Status>}
                  {r.denials > 0 && <Status tone="err">{r.denials} refused</Status>}
                  <StateBadge state={r.state} />
                </button>
                );
              })}
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
  const { models, defaultModel, read: modelsRead, error: modelsError } = useModels();
  const [model, setModel] = useState("");
  /** Parts of the agent's definition the platform does not carry out: Run stays off, with the reason. Read from the agent, and from a 409 start refusal. */
  const [unsupported, setUnsupported] = useState<UnsupportedPart[]>([]);
  useEffect(() => {
    if (!agentId || draft) return;
    let live = true;
    // The start refusal (409 with `unsupported`) says the same if this read fails; it only lets Run be off before the press.
    fetch(`/api/agents/${encodeURIComponent(agentId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && d && setUnsupported(runBlockers(unsupportedOf(d), d.version, d.deployed_version)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [agentId, draft]);
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
  /** L8, second round: the shadow run a canary started beside this one (`RunStarted.shadow_run`), or "". */
  const [shadowRun, setShadowRun] = useState("");
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
  const [already, setAlready] = useState<KillRefusal | null>(null);
  /** A start refused for a rate limit (429): nothing started; the form stays, with the limit and a countdown. */
  const [limited, setLimited] = useState<{ limit: RateLimit; at: number; said: string } | null>(null);
  const retry = useRetryReady(limited?.limit ?? null, limited?.at ?? 0);
  /** A start refused for the lockdown (423), a held agent (409) or another reason: the form stays, with the platform's sentence. */
  const [refused, setRefused] = useState<StartRefusal | null>(null);
  // Wall clock: the journal ticks only when entries land; a 40-second tool
  // call must not look like a hang.
  const startedAt = useRef(0);
  const [wallMs, setWallMs] = useState(0);
  // The live stream: reconnecting while the browser retries, the reason once it is lost, and frames that could not be read.
  const stream = useStreamState();

  useEffect(() => {
    if (phase !== "live") return;
    const id = setInterval(() => setWallMs(Date.now() - startedAt.current), 1000);
    return () => clearInterval(id);
  }, [phase]);
  // The journal's clock: the latest folded time on the transcript.
  const journalMs = useMemo(() => entries.reduce((m, e) => Math.max(m, e.t), 0), [entries]);
  // The spec this run is started from is the one in hand: its limits are shown beside the run as it goes.
  const liveFacts = useMemo<RunFacts | null>(
    () => (system ? { spec: toDocument(system), specDigest: "", spent: {}, visits: {}, provider: "", model: "", dataClass: "", startedAt: "", finishedAt: "" } : null),
    [system],
  );

  /* The spec: from the registry, or handed over from the builder as a draft. */
  useEffect(() => {
    if (draft) {
      return soon(() => {
        try {
          const raw = sessionStorage.getItem("af-run-draft");
          if (!raw) throw new Error("no draft was handed over");
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
  }, []);

  /** Follow the run's journal from the backend until it ends; a resumed leg joins the same transcript. */
  const follow = useCallback(
    (id: string) => {
      stop.current?.();
      stream.reset();
      stop.current = subscribeRunEvents(id, {
        onReconnecting: stream.setReconnecting,
        onDropped: stream.setDropped,
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
          // Still running, or its record could not be read: nothing more will arrive here until the stream is opened again.
          stream.setLost(message);
        },
      });
    },
    [settle, stream],
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
    const chosen = model || defaultModel;
    // The endpoint the offered model is called on. Left out when none is named, and the platform finds the endpoint that serves the model.
    const servedBy = models.find((m) => m.id === chosen)?.provider;
    try {
      const { data, error, response } = await api.POST("/api/runs", {
        // The generated request type still asks for `provider` and fixes its values; the platform takes an endpoint id, or none.
        body: {
          ...(agentId && !draft ? { agent: agentId } : { spec: toDocument(system) as Record<string, unknown> }),
          input: parsed,
          model: chosen,
          ...(servedBy ? { provider: servedBy } : {}),
        } as Schemas["RunStartRequest"],
        signal: ctrl.signal,
      });
      if (!data) {
        // A definition with parts the platform does not carry out is refused (409 `unsupported`): the parts are listed beside the form.
        if (response.status === 409 && unsupportedOf(error).length) setUnsupported(unsupportedOf(error));
        // Nothing started. The lockdown (423), a held agent (409 `control: "paused"`) and a rate limit (429) are said in the
        // platform's words, back at the form; a rate limit also holds Run until its wait is over.
        const refusal = startRefusalOf(agentId || system?.id || "", response.status, error, response.headers.get("retry-after"), response);
        setPhase("setup");
        if (refusal.kind === "rate_limit") setLimited({ limit: refusal.limit, at: Date.now(), said: refusal.text });
        else setRefused(refusal);
        return;
      }
      runId.current = data.run;
      setLiveRunId(data.run);
      setShadowRun(data.shadow_run ?? "");
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
    setRefused(null);
    runId.current = "";
    setLiveRunId("");
    setShadowRun("");
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
          title="Kill this run?"
          what={`${system.name} · ${killAsk}. A worker running it stops before its next model call, step or node; a call already in flight finishes. A run waiting for a person stops at once. Child runs it started are not stopped. The journal records the reason and your name.`}
          onClose={() => setKillAsk(null)}
          onConfirm={(reason) => {
            const id = killAsk;
            setKillAsk(null);
            setKilling(true);
            setAlready(null);
            killRun(id, reason)
              .then((r) => {
                setReceipt(r);
                // A run nobody was carrying (waiting at a gate) is stopped here and now: it has ended, and no stream frame will say so.
                if (r.state === "killed") {
                  setKilling(false);
                  setSuspension(null);
                  setFinalState("killed");
                  setPhase("done");
                }
              })
              .catch((e: Error) => {
                setKilling(false);
                // Everything in flight is already stopping on an earlier kill: that, not an error.
                const refusal = killRefusalOf(e);
                if (refusal?.already.length) setAlready(refusal);
                else setError(e.message);
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
      limits={liveFacts && liveRunId ? { facts: liveFacts, system: system.id, error } : undefined}
      notice={
        receipt ? (
          <KillReceiptView receipt={receipt} onDismiss={() => setReceipt(null)} />
        ) : already ? (
          <KillAlreadyView refusal={already} onDismiss={() => setAlready(null)} />
        ) : shadowRun ? (
          <Banner tone="neutral" title="Mirrored in shadow mode">
            A canary&rsquo;s candidate is running on the same input as shadow run{" "}
            <Link href={`/runs?id=${encodeURIComponent(shadowRun)}`} className="focusable rounded-sm font-mono text-fg underline">
              {shadowRun}
            </Link>
            : its calls at or above write and calls that act outside are recorded there, not made. The pair is compared on the lifecycle page.
          </Banner>
        ) : null
      }
      steer={liveRunId && phase === "live" ? <SteerPanel runId={liveRunId} atGate={Boolean(suspension)} /> : null}
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
                {unsupported.length > 0 && <UnsupportedParts parts={unsupported} className="mt-2" />}
                {error && (
                  <p className="pt-1.5 text-[11.5px] text-err" role="alert">
                    {error}
                  </p>
                )}
                {limited && (
                  <div className="pt-2">
                    <RateLimitNote limit={limited.limit} readAt={limited.at} said={limited.said} />
                  </div>
                )}
                {refused && (
                  <div className="pt-2">
                    <Banner tone="err" title={refused.kind === "other" ? "The start failed" : "Nothing started: the platform refused the start"}>
                      {refused.text}
                    </Banner>
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
                {modelsError && (
                  <span className="block pt-1 text-[11px] leading-[1.45] text-err" role="alert">
                    The offered models could not be read: {modelsError}
                  </span>
                )}
                {!modelsError && modelsRead && models.length === 0 && (
                  <span className="block pt-1 text-[11px] leading-[1.45] text-faint">No model is offered on this deployment (Configuration, Models).</span>
                )}
              </div>
              <Button tone="ink" variant="solid" permission="run" onClick={start} disabled={!retry.ready || unsupported.length > 0} title={unsupported.length ? unsupportedReason(unsupported) : undefined} className="shrink-0 px-5">
                {retry.ready ? "Run" : `Retry in ${retry.left}s`}
              </Button>
            </div>
          </div>
        ) : phase === "done" && liveRunId ? (
          <RunAssurance run={liveRunId} />
        ) : null
      }
      footer={
        phase === "live" && !suspension ? (
          <div className="flex h-11 shrink-0 items-center gap-3 border-t border-line bg-surface px-4">
            {!stream.lost && <Thinking height={10} />}
            <StreamLine stream={stream} onRetry={() => liveRunId && follow(liveRunId)} following={killing ? "kill requested — the journal records it in a moment" : "running — every entry lands as the runtime writes it"} />
            <span className="grow" />
            <Mono className="tnum text-[11px] text-faint">{clock(Math.max(journalMs, wallMs))}</Mono>
            <Button
              tone="err"
              variant="solid"
              size="sm"
              permission="run"
              disabled={!liveRunId}
              onClick={() => {
                // The real kill switch: the backend records the request with the reason and who asked;
                // the stream stays open so the kill lands in the transcript in front of you.
                if (runId.current) setKillAsk(runId.current);
              }}
              loading={killing}
            >
              {killing ? "Killing…" : liveRunId ? "Kill run" : "Starting…"}
            </Button>
          </div>
        ) : phase === "done" || suspension ? (
          <div className="flex h-11 shrink-0 items-center gap-3 border-t border-line bg-surface px-4">
            <StateBadge state={suspension ? "suspended" : finalState} />
            {error && <span className="min-w-0 truncate text-[11.5px] text-err">{error}</span>}
            <span className="grow" />

            <Mono className="tnum text-[11px] text-faint">{clock(journalMs)}</Mono>
            {suspension && liveRunId && (
              // A run waiting at a gate is still in flight: the platform stops it at once.
              <Button tone="err" variant="solid" size="sm" permission="run" loading={killing} onClick={() => runId.current && setKillAsk(runId.current)}>
                {killing ? "Killing…" : "Kill run"}
              </Button>
            )}
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

/** `live`, `waiting_on`, `stuck` and `stuck_reason` of a run record; ahead of the generated types. */
function waitingOf(data: unknown): { on: string; live: boolean; stuck: boolean; reason: string } {
  const o = (data ?? {}) as { live?: unknown; waiting_on?: unknown; stuck?: unknown; stuck_reason?: unknown };
  return { on: typeof o.waiting_on === "string" ? o.waiting_on : "", live: o.live === true, stuck: o.stuck === true, reason: typeof o.stuck_reason === "string" ? o.stuck_reason : "" };
}

/** What a run record says beside its journal, each member empty when the record does not hold it. */
function runFactsOf(data: Schemas["RunState"]): RunFacts {
  const text = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    spec: data.spec ?? null,
    specDigest: text(data.spec_digest) || text(data.journal?.spec_digest),
    spent: data.spent && typeof data.spent === "object" ? data.spent : {},
    visits: data.visits ?? {},
    provider: text(data.provider),
    model: text(data.model),
    dataClass: text(data.data_class),
    startedAt: text(data.started_at),
    finishedAt: text(data.finished_at),
  };
}

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
    /** Whether anyone is working on it, as the record says: `waiting_on` is "a worker" while no worker has taken it, and `stuck` (with why) once none has for too long. */
    waiting: { on: string; live: boolean; stuck: boolean; reason: string };
  }>({ system: "", runId: "", state: "", error: "", result: null, source: "", startedAt: "", kill: null, finishedAt: "", waiting: { on: "", live: false, stuck: false, reason: "" } });
  const [loadError, setLoadError] = useState("");
  /** L8: what the record says beyond the journal: a rollback's flag, an A2A task's taint, the eval it is a case of. */
  const [flags, setFlags] = useState<RunFlags | null>(null);
  /** L9: the signed answers on the record, stamped with the controls that opened each gate. */
  const [decisions, setDecisions] = useState<SignedDecision[]>([]);
  /** What the record says beside its journal: its spec, what it spent, where it ran. Read by the limits and trust boundary panels. */
  const [facts, setFacts] = useState<RunFacts | null>(null);
  /** `?entry=`: the journal entry a link points at; the transcript opens on it, marked. */
  const linked = params.get("entry") ?? "";

  useEffect(() => {
    api
      .GET("/api/runs/{run_id}", { params: { path: { run_id: id } } })
      .then(({ data, error, response }) => {
        if (!data) throw new Error(errorText(error, response));
        setFlags(runFlagsOf(data));
        setDecisions(decisionsOf(data));
        setFacts(runFactsOf(data));
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
          waiting: waitingOf(data),
        });
      })
      .catch((e) => setLoadError((e as Error).message));
  }, [id]);

  /* The full spine comes from the run's own copy of its definition (`spec` on
     the record), never the agent's current one, so the nodes a run never
     reached are visible as never-reached and a later version changes nothing
     here. A record without a spec falls back to the steps its journal names. */
  const runSpec = useMemo(() => {
    if (!facts?.spec) return null;
    try {
      return fromDocument(facts.spec);
    } catch {
      return null;
    }
  }, [facts]);
  const specNodes = useMemo(() => (runSpec ? runSpec.nodes.map((n) => ({ id: n.id, label: n.label || n.id, kind: n.harness })) : null), [runSpec]);
  const specEdges = useMemo<BoardEdge[]>(() => (runSpec ? runSpec.edges.map((e) => ({ source: e.source, target: e.target, when: e.when, label: e.label })) : []), [runSpec]);

  const duration = useMemo(() => (entries?.length ? entries[entries.length - 1].t : 0), [entries]);
  // Review opens at the outcome, paused — a reviewer starts from the verdict,
  // not from a screensaver. ?t= deep-links a moment.
  const openAt = params.get("t");
  // A linked entry opens the whole record, so the entry is there to be shown.
  const playback = usePlayback(duration, Boolean(entries?.length), openAt && !linked ? Number(openAt) : duration);
  // Opened in the agents view, a replay is a film: it plays from the start.
  const [view] = useRunView();
  const rolled = useRef(false);
  useEffect(() => {
    // A run in flight is followed, not replayed (FollowTheater below).
    if (rolled.current || !entries?.length || openAt || linked || view !== "cards" || followsLive({ state: meta.state, source: meta.source, finished_at: meta.finishedAt })) return;
    rolled.current = true;
    playback.seek(0);
    playback.setPlaying(true);
  }, [entries, openAt, linked, view, playback, meta.state, meta.source, meta.finishedAt]);


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
        flags={flags}
        facts={facts}
        locate={linked}
        waiting={meta.waiting}
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
      setup={
        <>
          {flags ? <RunFlagsBanner flags={flags} agent={meta.system} /> : null}
          <RunAssurance run={id || meta.runId} decisions={decisions} entries={entries} />
        </>
      }
      segments={segments}
      tNow={playback.t}
      traceOf={id}
      source={meta.source}
      runLive={false}
      limits={facts ? { facts, system: meta.system, error: meta.error } : undefined}
      locate={linked}
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
  flags = null,
  facts = null,
  locate = "",
  waiting = null,
}: {
  id: string;
  system: string;
  source: string;
  /** Whether anyone was working on the run when the page opened (RunRecord): shown until an entry beyond those already on the record arrives. */
  waiting?: { on: string; live: boolean; stuck: boolean; reason: string } | null;
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
  /** What the record said beyond the journal when the page opened (L8). */
  flags?: RunFlags | null;
  /** The record's spec and spend as they stood when the page opened, for the limits and trust boundary panels. */
  facts?: RunFacts | null;
  /** `?entry=`: the journal entry a link points at. */
  locate?: string;
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
  const [already, setAlready] = useState<KillRefusal | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const stream = useStreamState();
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
  // A run waiting at a gate is steered too: each lever waits for its next step after the gate.
  const offer = steerOffer({ state, atGate: Boolean(suspension) });

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
    stream.reset();
    stop.current = subscribeRunEvents(id, {
      onReconnecting: stream.setReconnecting,
      onDropped: stream.setDropped,
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
        stream.setLost(message);
      },
    });
  }, [id, settle, stream]);

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
          title="Kill this run?"
          what={`${system || "run"} · ${id}. A worker running it stops before its next model call, step or node; a call already in flight finishes. A run waiting for a person stops at once. Child runs it started are not stopped. The journal records the reason and your name.`}
          onClose={() => setKillAsk(false)}
          onConfirm={(reason) => {
            setKillAsk(false);
            setKilling(true);
            setAlready(null);
            killRun(id, reason)
              .then((r) => {
                setKilled(r.kill);
                setReceipt(r);
                // A run nobody was carrying (waiting at a gate) is stopped here and now: it has ended, and no stream frame will say so.
                if (r.state === "killed") {
                  setKilling(false);
                  setSuspension(null);
                  setState("killed");
                }
              })
              .catch((e: Error) => {
                setKilling(false);
                // Everything in flight is already stopping on an earlier kill: that, not an error.
                const refusal = killRefusalOf(e);
                if (refusal?.already.length) setAlready(refusal);
                else setError(e.message);
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
        limits={facts ? { facts, system, error } : undefined}
        locate={locate}
        notice={receipt ? <KillReceiptView receipt={receipt} onDismiss={() => setReceipt(null)} /> : already ? <KillAlreadyView refusal={already} onDismiss={() => setAlready(null)} /> : null}
        steer={offer.show ? <SteerPanel runId={id} atGate={offer.atGate} /> : null}
        setup={
          <>
            {flags ? <RunFlagsBanner flags={flags} agent={system} /> : null}
            <RunAssurance key={running ? "running" : "settled"} run={id} />
          </>
        }
        footer={
          running ? (
            <div className="flex h-11 shrink-0 items-center gap-3 border-t border-line bg-surface px-4">
              {!stream.lost && <Thinking height={10} />}
              <StreamLine
                stream={stream}
                onRetry={follow}
                following={
                  killing || killed
                    ? `kill requested${killed?.by ? ` by ${killed.by}` : ""} — the run stops before its next model call, step or node`
                    : waiting && !waiting.live && entries.length <= initial.length && waiting.stuck
                      ? `stuck: ${waiting.reason || "no worker is carrying this run"}`
                      : waiting && !waiting.live && entries.length <= initial.length && waiting.on
                        ? `queued — waiting on ${waiting.on}; nothing is written until it is taken up`
                        : "following — every entry lands as the runtime writes it"
                }
              />
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
              {suspension && (
                // A run waiting at a gate is still in flight: the platform stops it at once.
                <Button tone="err" variant="solid" size="sm" permission="run" loading={killing} onClick={() => setKillAsk(true)}>
                  {killing ? "Killing…" : "Kill run"}
                </Button>
              )}
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
        {/* Only the kinds this run's journal holds: a legend entry is never a claim that such a thing can happen here. */}
        {[
          ["tool.call", "tool"],
          ["model.call", "reasoning"],
          ["taint", "taint"],
          ["node.exit", "step done"],
          ["denied", "refused"],
        ].filter(([k]) => ticks.some((x) => x.kind === k)).map(([k, label]) => (
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
  limits,
  locate = "",
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
  /** What the run's record says beside its journal (its spec, its spend), the agent it belongs to and its error: the limits and trust boundary panels read these. Absent before a run exists. */
  limits?: { facts: RunFacts; system: string; error: string };
  /** `?entry=`: the journal entry a link points at; the transcript opens on it, marked. */
  locate?: string;
}) {
  const draftId =
    result && typeof result.draft_id === "string" && /^[a-z][a-z0-9-]{0,62}$/.test(result.draft_id)
      ? result.draft_id
      : null;
  const modelCalls = entries.filter((e) => e.kind === "model.call").length;
  const denied = entries.filter((e) => e.kind === "denied" || e.kind === "contract.breach").length;
  const artifacts = useMemo(() => artifactsOf(entries), [entries]);
  /** While the run ledger names `runs[].artifacts` as not built, an empty panel says "not built" instead of "0 produced". */
  const [rowsNotBuilt, setRowsNotBuilt] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    void readRunRowsNotBuilt().then((l) => live && setRowsNotBuilt(l));
    return () => {
      live = false;
    };
  }, []);
  /** The documents the run registered as deliverables (`deliverable.written`, L8 second round). */
  const deliverablesWritten = useMemo(() => entries.filter((e) => e.kind === "deliverable.written").length, [entries]);
  // Theatre or agents: the same journal, read as one transcript or as a card
  // per agent. The choice is the reader's and it sticks across runs.
  const [chosenView, setChosenView, fold, setFold] = useRunView();
  // A linked entry, or a jump to the refusals, lives in the transcript: it is
  // shown then whatever view was chosen, until the reader picks a view again.
  const [jump, setJump] = useState<Jump | null>(() => (locate ? { entry: locate, n: 0 } : null));
  const [holdTranscript, setHoldTranscript] = useState(Boolean(locate));
  const [locatedFor, setLocatedFor] = useState(locate);
  if (locate !== locatedFor) {
    setLocatedFor(locate);
    if (locate) {
      setJump({ entry: locate, n: (jump?.n ?? 0) + 1 });
      setHoldTranscript(true);
    }
  }
  const view = holdTranscript ? "theatre" : chosenView;
  const setView = (v: typeof chosenView) => {
    setHoldTranscript(false);
    setChosenView(v);
  };
  // The limits and the trust boundary share the room under the transcript: one is open at a time. null: neither was touched, and the limits strip opens by itself when a limit ended the run.
  const [strip, setStrip] = useState<"limits" | "boundary" | "findings" | "authority" | "" | null>(null);
  const showRefusals = () => {
    setHoldTranscript(true);
    // The refusals are in the transcript: the strip gives the room back to it.
    setStrip("");
    setJump({ filter: "refused", n: (jump?.n ?? 0) + 1 });
  };
  // The whole journal, not the scrub position: a limit is a fact about the record.
  const record = allEntries ?? entries;
  const spec = useRunSpec(limits?.facts.spec, limits?.system ?? "", limits?.facts.specDigest ?? "");

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
        ) : (runLive ?? live) ? (
          // A replay's `live` is the film playing; the badge says what the run is, so a finished run replaying reads as finished.
          <Status tone="run">Running</Status>
        ) : (
          <StateBadge state={finalState} />
        )}
        <div className="grow" />
        <ViewSwitch view={view} setView={setView} fold={fold} setFold={setFold} />
        <div className="flex items-center gap-3 font-mono text-[11.5px] text-dim">
          <span className="tnum">{modelCalls} model calls</span>
          <span className="text-ghost">·</span>
          {entries.some((e) => e.kind === "tool.call") && (
            <>
              <span className="tnum">{entries.filter((e) => e.kind === "tool.call").length} tool calls</span>
              <span className="text-ghost">·</span>
            </>
          )}
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
                <RunFileLink key={a.deliverable ?? a.name} f={a} />
              ))}
              {artifacts.length === 0 && <span className="text-[11px] text-ghost">none written</span>}
              {artifacts.some((a) => a.deliverable) && runId && <DownloadAll runId={runId} count={artifacts.filter((a) => a.deliverable).length} />}
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
        <TheaterTranscript entries={entries} all={record} live={live} runId={runId ?? traceOf ?? ""} jump={jump} />

        {/* ── artifact rail ── */}
        <aside className="flex min-h-0 min-w-0 flex-col md:col-span-2 xl:col-span-1">
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-raise/60 px-4">
            <span className="truncate text-[12px] font-semibold">Artifacts</span>
            <div className="grow" />
            {/* Every file the run wrote, as one archive: the platform's zip of the run's deliverables, a plain link the proxy forwards. */}
            {artifacts.some((a) => a.deliverable) && runId && <DownloadAll runId={runId} count={artifacts.filter((a) => a.deliverable).length} />}
            {/* L8, second round: what the run wrote as deliverables, with their states, history and files. */}
            {runId && deliverablesWritten > 0 && (
              <Button size="sm" variant="quiet" className="shrink-0" href={`/deliverables?run=${encodeURIComponent(runId)}`}>
                Deliverables ({deliverablesWritten})
              </Button>
            )}
            <Mono className="shrink-0 text-[11px] text-faint">{artifacts.length === 0 && notBuilt(rowsNotBuilt, "artifacts") ? "not built" : `${artifacts.length} produced`}</Mono>
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
                  passed the deployment parser. It is a draft, not a deployed agent: nothing runs
                  it until it has been reviewed and deployed.
                </p>
              </div>
            )}


            {artifacts.map((a) => (
              <ArtifactRow key={a.deliverable ?? a.name} a={a} />
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
                  <span>{error || "The run was stopped on a kill request. The journal holds what it did before it stopped."}</span>
                  <ControlRef control={KILL_CONTROL} size="md" />
                </span>
              </Banner>
            )}
          </div>
        </aside>
      </div>

      {/* A replay is asked for by the id it was opened under (`traceOf`): an older record's own id can differ from it, and the doors know the run by the former. */}
      <RunTreePanel key={traceOf ?? runId ?? ""} runId={traceOf ?? runId} live={runLive ?? live} />
      {limits && (
        <>
          <RunLimitsPanel key={`limits:${traceOf ?? runId ?? ""}`} runId={traceOf ?? runId} spec={spec} facts={limits.facts} entries={record} error={limits.error} live={runLive ?? live} open={strip === null ? null : strip === "limits"} onToggle={(o) => setStrip(o ? "limits" : "")} />
          <RunBoundaryPanel key={`boundary:${traceOf ?? runId ?? ""}`} spec={spec} facts={limits.facts} entries={record} source={source} onShowRefusals={showRefusals} open={strip === "boundary"} onToggle={(o) => setStrip(o ? "boundary" : "")} />
        </>
      )}
      {/* Who started the run and what they held then, and where it stops for a person. Read only when opened. */}
      {(traceOf ?? runId) && (
        <RunStrip title="Authority" summary="who started it, what they held, its gates" open={strip === "authority"} onToggle={() => setStrip(strip === "authority" ? "" : "authority")}>
          <div className="px-4 py-3">{strip === "authority" && <RunAuthorityPanel run={(traceOf ?? runId)!} />}</div>
        </RunStrip>
      )}
      {/* What the run found: its findings, once the control plane keeps them. */}
      {(traceOf ?? runId) && (
        <RunStrip title="Findings" summary="recorded for this run, by severity" open={strip === "findings"} onToggle={() => setStrip(strip === "findings" ? "" : "findings")}>
          <div className="px-4 py-3">
            <RunFindings run={(traceOf ?? runId)!} />
          </div>
        </RunStrip>
      )}
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
  const { trace, state, failure } = useTrace(open ? runId : null);
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
                : failure?.state === "pending"
                  ? "not built"
                  : "could not be read"
            : "how long each step took"}
        </span>
      </button>
      {open && !trace && failure && (
        <div className="border-t border-line px-4 py-3">
          <AnswerFailure answer={failure} what="The trace could not be read" />
        </div>
      )}
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
   A run's files are its deliverables. Text-shaped ones preview inline, read
   from the deliverable's file door; a refusal is shown as a refusal, never as
   the file's contents. Download never navigates away from a live stream. */

const PREVIEWABLE = new Set(["json", "md", "txt", "csv", "html"]);

function ArtifactRow({ a }: { a: RunFile }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [refused, setRefused] = useState("");
  const [open, setOpen] = useState(false);
  const canPreview = Boolean(a.deliverable) && PREVIEWABLE.has(a.kind);

  const toggle = async () => {
    if (!canPreview || !a.deliverable) return;
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (preview === null) {
      try {
        const got = await downloadDeliverable(a.deliverable);
        setPreview((await got.blob.text()).slice(0, 8000));
        setRefused("");
      } catch (e) {
        setRefused(e instanceof DoorError ? fileRefusalText(e) : (e as Error).message);
      }
    }
  };
  const facts = (
    <span className="flex flex-wrap items-center gap-2">
      <Tag>{a.kind}</Tag>
      <Mono className="text-[10px] text-ghost">{clock(a.t)}</Mono>
      {a.bytes !== undefined && <Mono className="text-[10px] text-ghost">{sizeText(a.bytes)}</Mono>}
      {canPreview && <span className="text-[10px] text-faint">{open ? "hide preview" : "preview"}</span>}
      {!a.deliverable && <span className="text-[10px] text-faint">no deliverable named: no copy to download</span>}
    </span>
  );

  return (
    <div className="overflow-hidden rounded-md border border-line bg-raise/60 transition-colors hover:border-line-strong">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-surface text-dim">
          <Icon name={a.kind === "json" ? "json" : "file"} size={15} />
        </span>
        {canPreview ? (
          <button onClick={toggle} className="focusable flex min-w-0 grow cursor-pointer flex-col text-left">
            <span className="truncate text-[12px] font-medium text-fg">{a.name}</span>
            {facts}
          </button>
        ) : (
          <span className="flex min-w-0 grow flex-col">
            <span className="truncate text-[12px] font-medium text-fg">{a.name}</span>
            {facts}
          </span>
        )}
        {a.deliverable && (
          <IconButton size="sm" label={`Download ${a.name}`} className="shrink-0" onClick={async () => setRefused(await saveRunFile(a))}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
          </IconButton>
        )}
      </div>
      {refused && (
        <p className="border-t border-line px-3 py-2 text-[11px] leading-[1.5] text-err" role="alert">
          {refused}
        </p>
      )}
      {open && !refused && (
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
  // L8, second round: what a run wrote, as deliverables and register items, and each move of a deliverable.
  "deliverable.written": { dot: "bg-c2", text: "text-c2", label: "deliverable" },
  "deliverable.reviewed": { dot: "bg-warn", text: "text-warn", label: "reviewed" },
  "deliverable.published": { dot: "bg-ok", text: "text-ok", label: "published" },
  "deliverable.withdrawn": { dot: "bg-faint", text: "text-dim", label: "withdrawn" },
  "register.item": { dot: "bg-c2", text: "text-c2", label: "register" },
};

/** Filter families — the rows a reviewer wants to isolate, by what they mean. */
const FILTERS: { id: string; label: string; kinds: string[] }[] = [
  { id: "all", label: "All", kinds: [] },
  { id: "reasoning", label: "Reasoning", kinds: ["model.call"] },
  { id: "tools", label: "Tools", kinds: ["tool.call", "tool.result"] },
  { id: "refused", label: "Refused", kinds: ["denied", "contract.breach", "error"] },
  { id: "gates", label: "Gates", kinds: ["gate.open", "gate.answer", "suspend", "resume"] },
  { id: "taints", label: "Taints", kinds: ["taint"] },
  // A shadow run's calls it did not make (L8, second round).
  { id: "would", label: "Would call", kinds: ["would_call"] },
];

/** Where the transcript is asked to go: a journal entry to show marked, or a filter family to open. `n` tells one ask from the next. */
interface Jump {
  entry?: string;
  filter?: string;
  n: number;
}

function TheaterTranscript({ entries, all, live, runId = "", jump = null }: { entries: Entry[]; /** The whole journal, to tell a linked entry that is not in it from one the scrubber has not reached. */ all?: Entry[]; live: boolean; runId?: string; jump?: Jump | null }) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [unseen, setUnseen] = useState(0);
  const [filter, setFilter] = useState(jump?.filter ?? "all");
  // A new ask resets the filter: a linked entry is shown among everything, a jump to the refusals isolates them.
  const [asked, setAsked] = useState(jump);
  if (jump !== asked) {
    setAsked(jump);
    setFilter(jump?.filter ?? "all");
  }
  const linked = jump?.entry ?? "";
  /** How each tool call ended, paired through `because` (lib/tool-calls.ts). */
  const outcomes = useMemo(() => callOutcomes(entries), [entries]);
  /** The row that shows the linked entry: itself, or for a tool's result the call whose card it is drawn in. */
  const target = useMemo(() => {
    if (!linked) return "";
    const hit = entries.find((x) => x.id === linked);
    if (!hit) return "";
    if (hit.kind !== "tool.result") return hit.id;
    // A result has no row of its own: the call it closes is the row that shows it.
    return callOfEntry(outcomes, hit.id);
  }, [entries, linked, outcomes]);
  const absent = linked !== "" && !(all ?? entries).some((x) => x.id === linked);
  /** The entry whose lineage is open: what it was derived from, what it fed. */
  const [lineage, setLineage] = useState<string | null>(null);
  /** The entry whose provenance is open: its chain, from the input and prompt to the result. */
  const [provenance, setProvenance] = useState<string | null>(null);

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

  // An ask is answered once what it points at is on the page: the linked
  // entry scrolled to the middle, or the refusals from their top. Declared
  // after the pin-to-bottom effect, so on the first paint this one wins.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !jump) return;
    if (jump.entry) {
      if (!target) return;
      const row = el.querySelector(`[data-entry="${CSS.escape(target)}"]`);
      if (!row) return;
      pinned.current = false;
      row.scrollIntoView({ block: "center" });
    } else if (jump.filter) {
      pinned.current = false;
      el.scrollTop = 0;
      el.scrollIntoView({ block: "nearest" });
    }
  }, [jump, target]);

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
        {absent && (
          <p role="status" className="rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-[12px] leading-[1.5] text-fg">
            The link points at entry <Mono className="text-[11px] text-fg">{linked}</Mono>, which is not in this run&rsquo;s journal{live ? " so far" : ""}.
          </p>
        )}
        {shown.map((e, i) => {
          // A tool's result is drawn inside its call's card, so it takes no row (and no gap) of its own.
          if (e.kind === "tool.result") return null;
          const marked = target !== "" && e.id === target;
          return (
            <div key={e.id ?? i} data-entry={e.id} className={marked ? "af-located flex flex-col gap-1.5 py-1" : undefined}>
              {marked && (
                <span className="flex items-center gap-2 pl-12">
                  <Tag tone="warn">linked entry</Tag>
                  <Mono className="text-[10px] text-faint">{linked}</Mono>
                </span>
              )}
              <JournalRow e={e} entries={entries} outcomes={outcomes} live={live} located={marked} onLineage={setLineage} onProvenance={setProvenance} />
            </div>
          );
        })}
        {shown.length === 0 && (
          <p className="text-[12px] text-faint">Nothing of this kind in the journal{live ? " yet" : ""}.</p>
        )}
      </div>

      {lineage && <LineageDrawer runId={runId} entryId={lineage} entries={entries} onClose={() => setLineage(null)} />}
      {provenance && <ProvenanceDrawer entries={entries} entryId={provenance} onClose={() => setProvenance(null)} />}

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

function JournalRow({ e, entries, outcomes, live = false, located = false, onLineage, onProvenance }: { e: Entry; entries: Entry[]; /** How each tool call ended (lib/tool-calls.ts). */ outcomes: Map<string, CallOutcome<Entry>>; /** The run is still going: an open call is in flight, not unanswered. */ live?: boolean; /** A link points at this row: a tool card opens on what it holds. */ located?: boolean; onLineage?: (id: string) => void; onProvenance?: (id: string) => void }) {
  const [open, setOpen] = useState(located && e.kind === "tool.call");
  const lineageButton = onLineage && e.id ? (
    <Button size="sm" variant="quiet" onClick={() => onLineage(e.id)}>Lineage</Button>
  ) : null;
  /** Any decision's chain: what it stands on, from the input and prompt to the result. */
  const provenanceButton = onProvenance && e.id && hasProvenance(e) ? (
    <Button size="sm" variant="quiet" onClick={() => onProvenance(e.id)}>Provenance</Button>
  ) : null;

  /* Reasoning: the model's own words, as prose — the landing's signature row.
     Never silently cut: long thoughts get a labelled expander. */
  if (e.kind === "model.call") {
    // The runtime titles the entry with the model it called: that is the row's label, not the model's words.
    const called = modelCallOf(e);
    const route = routeLine(called);
    const text = e.detail || (titleIsModel(e) ? "" : e.title) || "";
    const intents = Array.isArray(e.data?.intents) ? e.data.intents.length : 0;
    const asJson = parseJsonText(text);
    const long = !asJson && text.length > 700;
    return (
      <div className="flex gap-3">
        <Mono className="w-9 shrink-0 pt-0.5 text-[10.5px] text-ghost">{clock(e.t)}</Mono>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[10.5px] font-medium text-run">reasoning</span>
            <ModelMark m={called} />
            {e.tainted && <Tag tone="warn">tainted input</Tag>}
            {e.tainted && lineageButton}
            {provenanceButton}
          </span>
          {route && <span className="font-mono text-[10.5px] leading-[1.5] break-words text-faint">{route}</span>}
          {!text && (
            <span className="text-[12px] text-faint">
              {intents ? `No text: the model asked for ${intents} tool call${intents === 1 ? "" : "s"}.` : "The journal holds no text for this call."}
            </span>
          )}
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
          ) : text ? (
            <p className="max-w-[62ch] text-[13px] leading-[1.6] whitespace-pre-wrap text-mist">
              {long && !open ? text.slice(0, 700) : text}
              {long && !open && "…"}
            </p>
          ) : null}
          {(long || asJson) && (
            <Button size="sm" variant="quiet" className="self-start" onClick={() => setOpen(!open)}>
              {open ? (asJson ? "show as prose" : "show less") : asJson ? "view raw" : `show all (${(text.length / 1000).toFixed(1)}k chars)`}
            </Button>
          )}
        </div>
      </div>
    );
  }

  /* Tool calls: the raised card, expandable to the arguments and the answer.
     A call is closed by the entry that cites it (lib/tool-calls.ts): its
     result, a refusal after the call was recorded, or a failure. A call
     nothing closed says why: in flight, waiting for a person, outcome
     unknown, or no outcome on record. */
  if (e.kind === "tool.call") {
    const o: CallOutcome<Entry> = outcomes.get(e.id) ?? { state: "open" };
    const response = o.state === "returned" ? o.closing : undefined;
    const state = callStateLabel(o.state, live);
    const risk = typeof e.data?.risk === "string" ? e.data.risk : "";
    const sink = e.data?.sink === true;
    const taintedBy = strList(e.data?.tainted_by);
    // `sandbox.execute` under an isolator: the isolator, the exit, the time, the truncation and the manifest digest come before the output.
    const sandbox = response && e.data?.tool === SANDBOX_TOOL ? sandboxRunOf(response.data?.value) : null;
    // A retrieval call: the sources consulted and the passages returned, not the generic card.
    const retrieval = response ? retrievalOf(String(e.data?.tool ?? ""), response.data?.value) : null;
    if (retrieval && response) {
      return (
        <div className="flex gap-3">
          <Mono className="w-9 shrink-0 pt-2 text-[10.5px] text-ghost">{clock(e.t)}</Mono>
          <RetrievalCard
            tool={String(e.data?.tool ?? e.title)}
            r={retrieval}
            tainted={response.tainted === true}
            actions={provenanceButton}
            raw={
              <>
                <ArgsBlock tool={String(e.data?.tool ?? e.title ?? "")} args={e.data?.args ?? {}} />
                <ResponseBlock value={response.data?.value} />
              </>
            }
          />
        </div>
      );
    }
    const closingControl = o.closing && o.closing.kind === "denied" ? String(o.closing.data?.control ?? "") : "";
    const tone = state.tone === "ok" ? "text-ok" : state.tone === "err" ? "text-err" : state.tone === "warn" ? "text-warn" : "text-faint";
    return (
      <div className="flex gap-3">
        <Mono className="w-9 shrink-0 pt-2 text-[10.5px] text-ghost">{clock(e.t)}</Mono>
        <div className={`min-w-0 grow rounded-md border bg-raise ${o.state === "refused" || o.state === "failed" ? "border-err/40" : o.state === "unknown" || o.state === "held" ? "border-warn/40" : "border-line"}`}>
          <button
            onClick={() => setOpen(!open)}
            className="focusable flex w-full cursor-pointer flex-col gap-0.5 px-3 py-2 text-left"
          >
            <span className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                <Mono className="truncate text-[11.5px] text-mist">{String(e.data?.tool ?? e.title)}</Mono>
                {risk && risk !== "read" && <Tag tone={risk === "destructive" ? "err" : risk === "risky" ? "warn" : "neutral"}>{risk}</Tag>}
                {sink && <Tag tone="warn">acts outside</Tag>}
                {taintedBy.length > 0 && <Tag tone="warn">untrusted arguments</Tag>}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {sandbox ? (
                  <Mono className={`text-[10.5px] ${sandbox.exit === 0 ? "text-ok" : "text-err"}`}>{exitText(sandbox)}</Mono>
                ) : (
                  <Mono className={`text-[10.5px] ${tone}`}>{o.state === "refused" ? "refused" : state.text}</Mono>
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
            {(o.state === "refused" || o.state === "failed") && o.closing && (
              <span className="text-[11.5px] leading-[1.5] text-err">
                → {o.state === "refused" ? `${closingControl ? controlLabel(closingControl) : "Refused"}${o.closing.detail ? `: ${o.closing.detail}` : ""}` : o.closing.detail || o.closing.title}
              </span>
            )}
            {o.state === "unknown" && (
              <span className="text-[11.5px] leading-[1.5] text-warn">
                → {o.gate ? "The worker stopped before the answer was recorded; the run waits for a person to say whether the call happened." : o.interrupted?.detail || "The worker stopped before the answer was recorded."}
              </span>
            )}
            {o.state === "held" && o.gate && <span className="text-[11.5px] leading-[1.5] text-warn">→ {o.gate.title || "Held for a person"}{o.gate.detail ? `: ${o.gate.detail}` : ""}</span>}
            {o.state === "open" && !live && <span className="text-[11.5px] leading-[1.5] text-faint">→ The run is not live and nothing in the journal closes this call.</span>}
          </button>
          {open && (
            <div className="flex flex-col gap-2 border-t border-line px-3 py-2.5">
              <ArgsBlock tool={String(e.data?.tool ?? e.title ?? "")} args={e.data?.args ?? {}} />
              {taintedBy.length > 0 && <span className="text-[11px] leading-[1.5] text-faint">Arguments derive from untrusted content via {taintedBy.join(", ")}.</span>}
              {sandbox ? <SandboxOutput run={sandbox} /> : response && <ResponseBlock value={response.data?.value} />}
              {provenanceButton && <span className="self-start">{provenanceButton}</span>}
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
     reads as a malfunction rather than the system working. A gate says who
     must answer, the rule that held the call and every other rule that would
     have, its condition, and its deadline. */
  if (e.kind === "denied" || e.kind === "contract.breach" || e.kind === "taint" || e.kind === "gate.open") {
    // An entry that names no control is read by its kind: a refusal by capability (as the firing record counts it), a gate by `gate`.
    const control = String(e.data?.control ?? (e.kind === "contract.breach" ? "contract.breach" : e.kind === "gate.open" ? "gate" : e.kind));
    const why = explainControl(control);
    // A key with no register row reads as its own line (lib/guardrails.ts CONTROL_LABELS), never as a bare word.
    const name = why.id ? why.name : controlLabel(control);
    const refused = e.kind === "denied" || e.kind === "contract.breach";
    const tool = e.data?.tool ? String(e.data.tool) : "";
    const gate = e.kind === "gate.open";
    const unknownOutcome = gate && (e.data?.outcome === "unknown" || control === "worker.interrupted");
    const approvers = strList(e.data?.approvers);
    const also = strList(e.data?.also).filter((c) => c !== control);
    const risk = typeof e.data?.risk === "string" ? e.data.risk : "";
    const problems = strList(e.data?.problems);
    const reasons = strList(e.data?.reasons);
    const where = typeof e.data?.where === "string" ? e.data.where : "";
    const sources = strList(e.data?.sources);
    const when = typeof e.data?.when === "string" ? e.data.when : "";
    const conditionError = typeof e.data?.condition_error === "string" ? e.data.condition_error : "";
    // A refusal citing a recorded call came after the call (the host, the result screener, the class on the way back).
    const afterCall = refused && callOfEntry(outcomes, e.id) !== "";
    return (
      <div className="flex gap-3">
        <Mono className="w-9 shrink-0 pt-2 text-[10.5px] text-ghost">{clock(e.t)}</Mono>
        <div className={`min-w-0 grow rounded-md border bg-raise ${refused ? "border-err/40" : "border-warn/40"}`}>
          <div className="flex flex-col gap-1 px-3 py-2">
            <span className="flex flex-wrap items-center gap-2">
              <span className={`size-1.5 shrink-0 rounded-[2px] ${refused ? "bg-err" : "bg-warn"}`} />
              <span className={`text-[10.5px] font-medium ${refused ? "text-err" : "text-warn"}`}>
                {gate ? (unknownOutcome ? "outcome unknown · waits for" : "waits for") : refused ? "refused by" : "marked by"}
              </span>
              <span className="text-[12.5px] font-medium text-fg">{gate ? (approvers.length ? approvers.map(roleLabel).join(" or ") : "no approver named on the entry") : name}</span>
              {!gate && <ControlRef control={control} />}
              {tool && <Mono className="text-[10.5px] text-mist">{tool}</Mono>}
              {risk && <Tag tone={risk === "destructive" ? "err" : risk === "risky" ? "warn" : "neutral"}>{risk}</Tag>}
              {afterCall && <Tag>after the call was recorded</Tag>}
              <span className="grow" />
              {lineageButton}
              {provenanceButton}
            </span>
            {gate && e.title && <span className="text-[11.5px] font-medium text-fg">{e.title}</span>}
            {/* The rule, in full. Truncating the reason is how a refusal turns
                into a mystery two weeks later. */}
            {e.detail && (
              <span className="text-[11.5px] leading-[1.55] text-fg">{e.detail}</span>
            )}
            {gate && (
              <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
                <span>Held by</span>
                <ControlMark control={control} />
                {also.length > 0 && <span>and also</span>}
                {also.map((c) => (
                  <ControlMark key={c} control={c} />
                ))}
              </span>
            )}
            {gate && when && (
              <span className="text-[11px] leading-[1.5] text-faint">
                Condition: <Mono className="text-[10.5px] text-dim">{when}</Mono>
              </span>
            )}
            {gate && conditionError && <span className="text-[11px] leading-[1.5] text-warn">The condition could not be read, so the call is held: {conditionError}</span>}
            {unknownOutcome && <span className="text-[11px] leading-[1.5] text-faint">The answer says whether the call happened before the worker stopped.</span>}
            {gate && <span className="text-[11px] leading-[1.5] text-faint">{gateDeadlineLine(typeof e.data?.deadline === "string" ? e.data.deadline : null, (iso) => new Date(iso).toLocaleString("en-GB"))}</span>}
            {!gate && why.decides && (
              <span className="text-[11px] leading-[1.5] text-faint">
                {why.name} decides: {why.decides}
              </span>
            )}
            {problems.length > 0 && (
              <ul className="flex flex-col gap-0.5 text-[11px] leading-[1.5] text-fg">
                {problems.map((p, i) => (
                  <li key={i}>· {p}</li>
                ))}
              </ul>
            )}
            {(where || reasons.length > 0) && (
              <span className="text-[11px] leading-[1.5] text-faint">
                {where ? `Screened: ${where}` : "Screened"}
                {reasons.length ? ` · ${reasons.join("; ")}` : ""}
              </span>
            )}
            {sources.length > 0 && <span className="text-[11px] leading-[1.5] text-faint">Untrusted source{sources.length === 1 ? "" : "s"}: {sources.join(", ")}</span>}
            {!!e.data?.args && (
              <details className="pt-0.5">
                <summary className="focusable cursor-pointer text-[10.5px] text-ghost">
                  {gate ? "what it is about to send" : "what was attempted"}
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

  /* A person's answer to a gate over a tool call: who, which way, and every
     rule the answer covers. Other answers keep the plain row below. */
  if (e.kind === "gate.answer" && (e.data?.tool || e.data?.call_digest)) {
    const approved = e.data?.approved === true ? true : e.data?.approved === false ? false : null;
    const covered = strList(e.data?.controls);
    const said = typeof e.data?.outcome === "string" ? e.data.outcome : "";
    const by = typeof e.data?.by === "string" ? e.data.by : "";
    const note = typeof e.data?.note === "string" ? e.data.note : "";
    return (
      <div className="flex gap-3">
        <Mono className="w-9 shrink-0 pt-2 text-[10.5px] text-ghost">{clock(e.t)}</Mono>
        <div className="min-w-0 grow rounded-md border border-warn/40 bg-raise">
          <div className="flex flex-col gap-1 px-3 py-2">
            <span className="flex flex-wrap items-center gap-2">
              <span className="size-1.5 shrink-0 rounded-[2px] bg-warn" />
              <span className="text-[10.5px] font-medium text-warn">decision</span>
              <span className="text-[12.5px] font-medium text-fg">{e.data?.aborted === true ? "Aborted" : said ? `“${said}”` : approved === true ? "Approved" : approved === false ? "Refused" : e.title}</span>
              {by && <span className="text-[11px] text-dim">by {by.replace(/\s*<[^>]*>\s*$/, "")}</span>}
              {e.data?.tool ? <Mono className="text-[10.5px] text-mist">{String(e.data.tool)}</Mono> : null}
              <span className="grow" />
              {provenanceButton}
            </span>
            {/* The entry's detail is "<by>: <note>"; the note alone is shown when there is one. */}
            {note ? <span className="text-[11.5px] leading-[1.55] whitespace-pre-wrap text-mist">{note}</span> : e.detail && !e.detail.startsWith(by) ? <span className="text-[11.5px] leading-[1.55] text-fg">{e.detail}</span> : null}
            {e.data?.aborted === true && typeof e.data?.reason === "string" && !note && <span className="text-[11.5px] leading-[1.55] text-fg">{e.data.reason}</span>}
            {covered.length > 0 && (
              <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
                <span>Covers</span>
                {covered.map((c) => (
                  <ControlMark key={c} control={c} />
                ))}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* The engine's note that a worker stopped mid-call or mid-step: which call,
     and whether it is made again or waits for a person. */
  if (e.kind === "note" && e.data?.control === "worker.interrupted") {
    const repeated = e.data?.outcome === "repeated";
    return (
      <div className="flex gap-3">
        <Mono className="w-9 shrink-0 text-[10.5px] text-ghost">{clock(e.t)}</Mono>
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="mt-1.5 size-1.5 shrink-0 rounded-[2px] bg-warn" />
            <span className="shrink-0 text-[10.5px] font-medium text-warn">{repeated ? "interrupted · repeated" : e.data?.outcome === "unknown" ? "interrupted · outcome unknown" : "interrupted"}</span>
            <span className="text-[12.5px] text-fg">{e.title}</span>
            {e.data?.tool ? <Mono className="text-[10.5px] text-mist">{String(e.data.tool)}</Mono> : null}
          </span>
          {e.detail && <span className="pl-3.5 text-[11.5px] leading-[1.5] text-faint">{e.detail}</span>}
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

  /* A shadow run's call it did not make (L8, second round): nothing above
     read executes in shadow mode, so the call is journalled with its
     arguments instead. The row says so, so it never reads as a call made. */
  const would = wouldCallOf({ kind: e.kind, data: e.data ?? null });
  if (would) {
    return (
      <div className="flex gap-3">
        <Mono className="w-9 shrink-0 pt-2 text-[10.5px] text-ghost">{clock(e.t)}</Mono>
        <div className="min-w-0 grow rounded-md border border-dashed border-line-strong bg-canvas">
          <div className="flex flex-col gap-1 px-3 py-2">
            <span className="flex flex-wrap items-center gap-2">
              <span className="size-1.5 shrink-0 rounded-[2px] bg-faint" />
              <span className="text-[10.5px] font-medium text-dim">would call</span>
              <Mono className="text-[11.5px] text-mist">{would.tool}</Mono>
              {would.sink && <Tag tone="warn">sink</Tag>}
              {would.risk && <Tag>{would.risk}</Tag>}
              <Tag tone="queue">not executed</Tag>
            </span>
            <span className="text-[11.5px] leading-[1.55] text-faint">{wouldCallLine(would)}</span>
            {Object.keys(would.args).length > 0 && (
              <details className="pt-0.5">
                <summary className="focusable cursor-pointer text-[10.5px] text-ghost">what it would have sent</summary>
                <pre className="mt-1 max-h-40 overflow-auto rounded-sm border border-line bg-canvas px-2 py-1.5 font-mono text-[10px] leading-[1.5] whitespace-pre-wrap text-faint">{JSON.stringify(would.args, null, 2)}</pre>
              </details>
            )}
          </div>
        </div>
      </div>
    );
  }

  // A gate's deadline passing moves it to the next approver: a note the platform marks `gate.escalated`, drawn as the gate's own colour.
  const k = e.kind === "note" && e.data?.control === "gate.escalated" ? { dot: "bg-warn", text: "text-warn", label: "escalated" } : (ROW[e.kind] ?? { dot: "bg-faint", text: "text-dim", label: e.kind });
  return (
    <div className="flex gap-3">
      <Mono className="w-9 shrink-0 text-[10.5px] text-ghost">{clock(e.t)}</Mono>
      <div className="flex min-w-0 items-baseline gap-2">
        <span className={`mt-1.5 size-1.5 shrink-0 rounded-[2px] ${k.dot}`} />
        <span className={`shrink-0 text-[10.5px] font-medium ${k.text}`}>{k.label}</span>
        <span className="text-[12.5px] text-fg">{e.title}</span>
        {/* A note or an error that names a rule (a lockdown, a breaker, a screener's flag) shows it in words. */}
        {typeof e.data?.control === "string" && e.data.control && !BOOKKEEPING.test(e.data.control) && (
          <span className="shrink-0">
            <ControlMark control={e.data.control} />
          </span>
        )}
        {e.detail && <span className="truncate text-[11.5px] text-faint">{e.detail}</span>}
      </div>
      {provenanceButton && <span className="ml-auto shrink-0">{provenanceButton}</span>}
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

/** Keys a note carries for the engine's own bookkeeping (a model call started, a worker took over) or that another row already names: no rule chip on the plain row. */
const BOOKKEEPING = /^(operator\.|gate\.escalated$|model\.request$|worker\.takeover$)/;

/** A list of strings from an entry's payload; anything else is no list. */
function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : [];
}

/** What the call was sent, as the journal recorded it: the tool and its arguments, nothing reconstructed. */
function ArgsBlock({ tool, args }: { tool: string; args: unknown }) {
  const text = JSON.stringify(args ?? {}, null, 2);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2">
        <Label>Arguments · as journalled</Label>
        <Mono className="text-[10.5px] text-faint">{tool}</Mono>
        <span className="grow" />
        <CopyButton text={text} />
      </span>
      <pre className="max-h-[240px] overflow-auto rounded-md border border-line bg-sunken/40 p-2.5 font-mono text-[10.5px] leading-[1.6] whitespace-pre-wrap text-mist">{text}</pre>
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
