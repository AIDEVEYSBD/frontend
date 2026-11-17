"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { api, errorText, type RunRow } from "@/lib/api/client";
import { listRuns } from "@/lib/api/l2";
import { operatorOf } from "@/lib/api/l5";
import { redactText } from "@/lib/redact";
import { soon } from "@/lib/soon";
import { hueFor } from "@/lib/hue";
import { Button } from "./ui";
import { QuietNote } from "./overlays";
import { QUIET } from "@/lib/quiet";
import { WINDOWS, WindowPick, winMs, type Win } from "./window-pick";

/**
 * What the views of Explore (components/explore.tsx) share: the run ledger,
 * a bounded read of run journals, and the fold from a journal to tool calls
 * and run events.
 *
 * The ledger (`GET /api/runs`) lists every run with its counts. A tool call's
 * outcome, a gate or a refusal is only in the run's own journal
 * (`GET /api/runs/{id}`), and a journal is large, so journals are read for a
 * bounded number of runs at a time (RUN_BATCH, newest first inside the
 * window) and a view says how many it has read. What is shown from a journal
 * is the entry's own words (tool name, step, the engine's sentence for a
 * refusal or a failure), passed through lib/redact.ts; arguments, prompts and
 * returned values are never read into a row.
 */

/** Journals read per step: the first load, and each "read more". */
export const RUN_BATCH = 25;
/** Table rows drawn per step. */
export const ROW_BATCH = 200;
/** Journal reads in flight at once. */
const PARALLEL = 4;

export const count = (n: number) => n.toLocaleString("en-GB");

export function ago(ms: number, now: number): string {
  if (!ms) return "unknown";
  const mins = Math.round((now - ms) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function clockText(ms: number): string {
  if (!ms) return "unknown";
  return new Date(ms).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export const durationText = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60_000).toFixed(1)}m`);

/** Where a run opens, at one journal entry when it is named. */
export function runHref(run: string, entry?: string): string {
  return `/runs?id=${encodeURIComponent(run)}${entry ? `&entry=${encodeURIComponent(entry)}` : ""}`;
}

const time = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
};

/** When a run last did anything: its finish, else the ledger's own clock, else its start. */
export const lastActive = (r: RunRow): number => time(r.finished) || time(r.at) || time(r.started);
export const startedAt = (r: RunRow): number => time(r.started) || time(r.at);
export const agentOf = (r: RunRow): string => r.agent || (r as unknown as { system?: string }).system || "";

/* ═══════════════════ the window ═══════════════════ */

/** The narrowest window that holds the most recent run, so the page does not open on an empty cut. */
export function narrowestWindow(rows: readonly RunRow[], now: number): Win {
  const newest = Math.max(0, ...rows.map(lastActive));
  if (!newest) return "7d";
  return WINDOWS.find((w) => now - newest <= w.ms)?.id ?? "all";
}

export const inWindow = (r: RunRow, win: Win, now: number): boolean => win === "all" || now - lastActive(r) <= winMs(win);

export const windowWords = (w: Win): string => (w === "all" ? "all time" : w === "24h" ? "the last 24 hours" : `the last ${w.replace("d", " days")}`);

/* ═══════════════════ the ledger ═══════════════════ */

/** `GET /api/runs`, newest first. `error` is the door's own words. */
export function useLedger(): { rows: RunRow[] | null; error: string; reload: () => void; loading: boolean } {
  const [rows, setRows] = useState<RunRow[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const cancel = soon(() => {
      listRuns()
        .then((r) => {
          if (!live) return;
          setRows([...r].sort((a, b) => lastActive(b) - lastActive(a)));
          setError("");
        })
        .catch((e) => {
          if (live) setError((e as Error).message || "the run ledger did not answer");
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    });
    return () => {
      live = false;
      cancel();
    };
  }, [tick]);
  const reload = useCallback(() => {
    // A run still going has a journal that moves: read it again.
    for (const [id, d] of CACHE) if (d.live) CACHE.delete(id);
    FAILED.clear();
    setLoading(true);
    setTick((t) => t + 1);
  }, []);
  return { rows, error, reload, loading };
}

/* ═══════════════════ a journal, folded ═══════════════════ */

export type Outcome = "ran" | "refused" | "failed" | "open";

export const OUTCOME: Record<Outcome, { label: string; tone: "ok" | "err" | "warn" | "neutral" }> = {
  ran: { label: "Ran", tone: "ok" },
  refused: { label: "Refused", tone: "err" },
  failed: { label: "Failed", tone: "warn" },
  open: { label: "No result recorded", tone: "neutral" },
};

export interface ToolCall {
  /** `${run}:${entry}` */
  key: string;
  run: string;
  agent: string;
  node: string;
  tool: string;
  /** The entry a link opens: the refusal when it was refused, else the call. */
  entry: string;
  /** The run's start plus the entry's offset. */
  at: number;
  t: number;
  outcome: Outcome;
  /** The control that refused it. */
  control: string;
  /** The engine's sentence for a refusal or a failure, redacted. */
  detail: string;
  ms: number | null;
}

export type RunEventKind = "started" | "gate_opened" | "gate_answered" | "refusal" | "breach" | "marked" | "killed" | "operator" | "ended";

export const EVENT: Record<RunEventKind, { label: string; tone: "ok" | "err" | "warn" | "run" | "neutral" }> = {
  started: { label: "Run started", tone: "run" },
  gate_opened: { label: "Gate opened", tone: "warn" },
  gate_answered: { label: "Gate answered", tone: "ok" },
  refusal: { label: "Refusal", tone: "err" },
  breach: { label: "Contract breach", tone: "err" },
  marked: { label: "Marked untrusted", tone: "warn" },
  killed: { label: "Killed by operator", tone: "err" },
  operator: { label: "Operator action", tone: "warn" },
  ended: { label: "Run ended", tone: "neutral" },
};

export interface RunEvent {
  key: string;
  run: string;
  agent: string;
  node: string;
  /** "" for an event read from the run record, which has no entry of its own. */
  entry: string;
  at: number;
  kind: RunEventKind;
  title: string;
  /** Redacted. */
  detail: string;
  control: string;
  /** A gate's answer: who signed and which way. */
  by: string;
  approved: boolean | null;
}

export interface RunDigest {
  id: string;
  agent: string;
  state: string;
  live: boolean;
  startedAt: number;
  entries: number;
  steps: number;
  modelCalls: number;
  tools: ToolCall[];
  events: RunEvent[];
}

interface Raw {
  id: string;
  t: number;
  kind: string;
  node: string;
  title: string;
  detail: string;
  because: string[];
  data: Record<string, unknown>;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const clip = (text: string, n = 300): string => redactText(text).replace(/\s+/g, " ").trim().slice(0, n);

/** The control an entry names: the engine's key or the register id, as lib/guardrails-watch.ts reads it. */
export function controlOfEntry(kind: string, data: Record<string, unknown>): string {
  const named = data.control;
  const first = Array.isArray(named) ? named[0] : named;
  if (first) return String(first);
  if (kind === "contract.breach") return "contract.breach";
  if (kind === "denied") return "capability";
  if (kind === "gate.open" || kind === "gate.answer") return "gate";
  return kind;
}

const KILL_RX = /killed by operator/i;

/** Fold one run record into its tool calls and its events. Pure. */
export function digestOf(row: Pick<RunRow, "id" | "live" | "state">, agent: string, started: number, record: unknown): RunDigest {
  const doc = obj(record);
  const journal = obj(doc.journal);
  const raw: Raw[] = (Array.isArray(journal.entries) ? journal.entries : []).map((e) => {
    const o = obj(e);
    return { id: str(o.id), t: Number(o.t ?? 0) || 0, kind: str(o.kind), node: str(o.node), title: str(o.title), detail: str(o.detail), because: Array.isArray(o.because) ? o.because.map(str) : [], data: obj(o.data) };
  });
  const run = row.id;
  const who = str(doc.system) || str(doc.agent) || agent;
  const start = time(str(doc.started_at)) || started;
  const state = str(doc.state) || row.state;

  const tools: ToolCall[] = [];
  const events: RunEvent[] = [];
  const open = new Map<string, ToolCall[]>();
  const byEntry = new Map<string, ToolCall>();
  let steps = 0;
  let modelCalls = 0;
  let ended = false;
  let killed = false;

  // A resumed leg restarts the journal's clock; keep the run's own order.
  let offset = 0;
  let lastRaw = 0;
  let maxT = 0;

  const settle = (c: ToolCall) => {
    const k = `${c.node}:${c.tool}`;
    open.set(k, (open.get(k) ?? []).filter((x) => x !== c));
  };
  const firstOpen = (node: string, tool: string) => (open.get(`${node}:${tool}`) ?? [])[0];
  const event = (e: Raw, at: number, kind: RunEventKind, extra: Partial<RunEvent> = {}) =>
    events.push({ key: `${run}:${e.id}:${kind}`, run, agent: who, node: e.node, entry: e.id, at, kind, title: clip(e.title, 160), detail: clip(e.detail), control: "", by: "", approved: null, ...extra });

  for (const e of raw) {
    if (e.t < lastRaw) offset = maxT;
    lastRaw = e.t;
    const t = e.t + offset;
    maxT = Math.max(maxT, t);
    const at = start ? start + t : 0;

    switch (e.kind) {
      case "run.start":
        event(e, at, "started");
        break;
      case "run.end":
        ended = true;
        event(e, at, "ended");
        break;
      case "node.enter":
        steps += 1;
        break;
      case "model.call":
        modelCalls += 1;
        break;
      case "tool.call": {
        const tool = str(e.data.tool) || e.title || "tool";
        const c: ToolCall = { key: `${run}:${e.id}`, run, agent: who, node: e.node, tool, entry: e.id, at, t, outcome: "open", control: "", detail: "", ms: null };
        tools.push(c);
        byEntry.set(e.id, c);
        open.set(`${e.node}:${tool}`, [...(open.get(`${e.node}:${tool}`) ?? []), c]);
        break;
      }
      case "tool.result": {
        const tool = str(e.data.tool) || e.title.replace(/ returned$/, "");
        const c = firstOpen(e.node, tool);
        if (c) {
          c.outcome = "ran";
          c.ms = typeof e.data.ms === "number" ? e.data.ms : Math.max(0, t - c.t);
          settle(c);
        }
        break;
      }
      case "denied": {
        const control = controlOfEntry(e.kind, e.data);
        const tool = str(e.data.tool);
        const c = e.because.map((id) => byEntry.get(id)).find((x) => x && x.outcome === "open") ?? (tool ? firstOpen(e.node, tool) : undefined);
        if (c) {
          c.outcome = "refused";
          c.control = control;
          c.detail = clip(e.detail || e.title);
          c.entry = e.id;
          settle(c);
        } else if (tool) {
          // Refused before any call was journalled: the refusal is the row.
          tools.push({ key: `${run}:${e.id}`, run, agent: who, node: e.node, tool, entry: e.id, at, t, outcome: "refused", control, detail: clip(e.detail || e.title), ms: null });
        }
        event(e, at, "refusal", { control });
        break;
      }
      case "contract.breach":
        event(e, at, "breach", { control: controlOfEntry(e.kind, e.data) });
        break;
      case "taint":
        event(e, at, "marked", { control: controlOfEntry(e.kind, e.data) });
        break;
      case "gate.open":
        event(e, at, "gate_opened", { control: controlOfEntry(e.kind, e.data) });
        break;
      case "gate.answer":
        event(e, at, "gate_answered", { control: controlOfEntry(e.kind, e.data), by: str(e.data.by), approved: typeof e.data.approved === "boolean" ? e.data.approved : null });
        break;
      case "error": {
        const named = /^(.+) failed$/.exec(e.title)?.[1] ?? "";
        const c = e.because.map((id) => byEntry.get(id)).find((x) => x && x.outcome === "open") ?? (named ? firstOpen(e.node, named) : undefined);
        if (c) {
          c.outcome = "failed";
          c.detail = clip(e.detail || e.title);
          c.ms = Math.max(0, t - c.t);
          settle(c);
        }
        const control = e.data.control ? controlOfEntry(e.kind, e.data) : "";
        if (KILL_RX.test(e.title) || control === "AF-RS-03" || control === "kill") {
          killed = true;
          event(e, at, "killed", { control: control || "AF-RS-03", by: str(e.data.by) });
        }
        break;
      }
      default: {
        const op = operatorOf(e);
        if (op) event(e, at, "operator", { title: clip(op.action, 160), detail: clip(op.detail), by: op.by, control: str(e.data.control) });
      }
    }
  }

  // A run that stopped without a `run.end` entry still ended: say so from its record.
  if (!ended && !killed && state && state !== "running" && state !== "suspended" && !row.live) {
    const finished = time(str(doc.finished_at)) || (start ? start + maxT : 0);
    events.push({ key: `${run}::ended`, run, agent: who, node: "", entry: "", at: finished, kind: "ended", title: `Run ${state}`, detail: clip(str(doc.error)), control: "", by: "", approved: null });
  }

  return { id: run, agent: who, state, live: Boolean(row.live), startedAt: start, entries: raw.length, steps, modelCalls, tools, events };
}

/* ═══════════════════ the bounded read ═══════════════════ */

const CACHE = new Map<string, RunDigest>();
const FAILED = new Map<string, string>();
const INFLIGHT = new Map<string, Promise<void>>();

function read(row: RunRow): Promise<void> {
  const going = INFLIGHT.get(row.id);
  if (going) return going;
  const p = api
    .GET("/api/runs/{run_id}", { params: { path: { run_id: row.id } } })
    .then(({ data, error, response }) => {
      if (!data) throw new Error(errorText(error, response));
      CACHE.set(row.id, digestOf(row, agentOf(row), startedAt(row), data));
    })
    .catch((e) => {
      FAILED.set(row.id, (e as Error).message || "the run did not read");
    })
    .finally(() => {
      INFLIGHT.delete(row.id);
    });
  INFLIGHT.set(row.id, p);
  return p;
}

/**
 * The journals of `rows`, read a few at a time and kept for the session, so
 * widening a window or moving between views reads only what is new.
 */
export function useDigests(rows: readonly RunRow[]): { digests: RunDigest[]; failed: { id: string; message: string }[]; pending: number } {
  const [version, setVersion] = useState(0);
  const key = rows.map((r) => r.id).join("|");
  useEffect(() => {
    let live = true;
    const todo = rows.filter((r) => !CACHE.has(r.id) && !FAILED.has(r.id));
    let i = 0;
    const worker = async () => {
      while (live && i < todo.length) {
        await read(todo[i++]);
        if (live) setVersion((v) => v + 1);
      }
    };
    const cancel = soon(() => {
      for (let k = 0; k < PARALLEL; k++) void worker();
    });
    return () => {
      live = false;
      cancel();
    };
    // `key` is `rows` by identity of its ids.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return useMemo(() => {
    const digests: RunDigest[] = [];
    const failed: { id: string; message: string }[] = [];
    for (const r of rows) {
      const d = CACHE.get(r.id);
      if (d) digests.push(d);
      else if (FAILED.has(r.id)) failed.push({ id: r.id, message: FAILED.get(r.id) ?? "" });
    }
    return { digests, failed, pending: rows.length - digests.length - failed.length };
    // `version` moves each time a read lands in the cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version]);
}

/** How many of a window's runs to read, kept per window so a wider window starts at one batch again. */
export function useReadLimit(win: Win): { limit: number; more: () => void } {
  const [limits, setLimits] = useState<Record<string, number>>({});
  const limit = limits[win] ?? RUN_BATCH;
  const more = useCallback(() => setLimits((l) => ({ ...l, [win]: (l[win] ?? RUN_BATCH) + RUN_BATCH })), [win]);
  return { limit, more };
}

/* ═══════════════════ shared pieces ═══════════════════ */

/** The page header's right-hand side: the window and a re-read. `auto` says the page chose the window, so it says which and why. */
export function WindowBar({ win, auto, onPick, onReload, loading }: { win: Win; auto: boolean; onPick: (w: Win) => void; onReload: () => void; loading: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-faint">{auto ? `Window: ${windowWords(win)}, the narrowest with a run in it` : "Window"}</span>
      <WindowPick value={win} onChange={onPick} inherited={auto} />
      <Button size="sm" variant="solid" tone="neutral" loading={loading} onClick={onReload}>
        Read again
      </Button>
    </span>
  );
}

/** A card with a tinted header and a flush body, for a table or a list. */
export function Card({ title, hue, meta, action, children }: { title: string; hue?: string; meta?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
      <div data-hue={hueFor((hue ?? title).toLowerCase())} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-raise/55 px-4 py-2.5">
        <span className="text-[12.5px] font-semibold tracking-[-0.005em] text-fg">{title}</span>
        {meta && <span className="max-w-[110ch] text-[11px] leading-[1.55] text-faint">{meta}</span>}
        {action && (
          <>
            <span className="grow" />
            {action}
          </>
        )}
      </div>
      {children}
    </section>
  );
}

export interface Tile {
  id: string;
  label: string;
  value: string;
  sub: string;
  tone?: "err" | "warn" | "ok";
  active?: boolean;
  onPick?: () => void;
}

/**
 * The band of counts above a table. A tile with `onPick` filters the table below it.
 * The band sits beside a filter rail, so it folds by its own width, not the screen's:
 * one row once every tile has room for its words, else three across, else two.
 */
export function Tiles({ tiles }: { tiles: Tile[] }) {
  const row = tiles.length > 5 ? "@[1040px]:grid-flow-col @[1040px]:auto-cols-fr @[1040px]:grid-cols-none" : "@[820px]:grid-flow-col @[820px]:auto-cols-fr @[820px]:grid-cols-none";
  return (
    <div className="@container">
      <div className={`grid grid-cols-2 overflow-hidden rounded-md border border-line bg-surface @[520px]:grid-cols-3 ${row}`}>
        {tiles.map((t) => {
          const body = (
            <>
              <span className="truncate text-[10.5px] text-faint">{t.label}</span>
              <span className="tnum text-[22px] leading-none font-semibold tracking-[-0.02em]" style={t.tone ? { color: `var(--color-${t.tone})` } : undefined}>
                {t.value}
              </span>
              <span className="truncate text-[10px] text-ghost">{t.sub}</span>
            </>
          );
          const frame = "-mr-px -mb-px flex min-w-0 flex-col gap-1 border-r border-b border-line px-3 py-2.5 text-left";
          return t.onPick ? (
            <button key={t.id} type="button" onClick={t.onPick} aria-pressed={Boolean(t.active)} className={`focusable cursor-pointer transition-colors ${frame} ${t.active ? "bg-raise/80" : "hover:bg-raise/50"}`}>
              {body}
            </button>
          ) : (
            <div key={t.id} className={frame}>
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One line under a table: what is shown, and the button that shows more of it. */
export function MoreRow({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-4 py-2.5">
      <span className="min-w-0 grow text-[11.5px] leading-[1.5] text-faint">{children}</span>
      {action}
    </div>
  );
}

/** How much of the window the journals read so far cover, in a line, with the way to read more. */
export function ReadNote({ read, total, pending, failed, win, onMore }: { read: number; total: number; pending: number; failed: { id: string; message: string }[]; win: Win; onMore: () => void }) {
  const left = total - read - pending - failed.length;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-line bg-surface px-3 py-2">
      <span className="min-w-0 grow text-[11.5px] leading-[1.5] text-faint">
        Journals read for <span className="tnum font-medium text-fg">{count(read)}</span> of <span className="tnum font-medium text-fg">{count(total)}</span> run{total === 1 ? "" : "s"} in {windowWords(win)}, newest first, {RUN_BATCH} at a
        time.{pending > 0 ? ` Reading ${count(pending)} more…` : ""}
        {failed.length > 0 && !QUIET && (
          <span className="text-err">
            {" "}
            {count(failed.length)} did not read: {failed[0].message}
          </span>
        )}
      </span>
      {left > 0 && (
        <Button size="sm" variant="solid" tone="neutral" disabled={pending > 0} onClick={onMore}>
          Read {Math.min(RUN_BATCH, left)} more run{Math.min(RUN_BATCH, left) === 1 ? "" : "s"}
        </Button>
      )}
    </div>
  );
}

/** A run id as a link to the run, at an entry when one is named. */
export function RunLink({ run, entry, children }: { run: string; entry?: string; children?: ReactNode }) {
  return (
    <Link href={runHref(run, entry)} onClick={(e) => e.stopPropagation()} title={run} className="focusable inline-block max-w-full truncate rounded-sm align-bottom font-mono text-[10.5px] text-dim hover:underline">
      {children ?? run}
    </Link>
  );
}

/** A door's failure, in the door's words. A quiet console (lib/quiet.ts) says it is not connected and prints no reason; a page shows it once. */
export function ErrorLine({ what, message }: { what: string; message: string }) {
  if (QUIET) return <QuietNote />;
  return (
    <p role="alert" className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err">
      {what}: {message}
    </p>
  );
}
