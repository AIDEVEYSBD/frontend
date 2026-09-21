import { costOf, type Sheet } from "@/lib/server/prices";

/**
 * A run journal, read as a trace.
 *
 * The journal is the system of record and it is richer than a trace: it holds
 * the reasoning chain, every refusal, and the evidence under each decision. A
 * trace is a projection of it — spans with start, duration and attributes —
 * and this module is the only place that projection is defined, so what the
 * Observability page draws and what we send to Langfuse can never disagree.
 *
 * Timing honesty: entries are stamped when a thing *finished*, and model and
 * tool entries carry their own measured duration. Where a duration was not
 * recorded (runs from before that was added) the span is marked `derived` and
 * its length is the gap since the previous entry in the same node, which
 * attributes waiting to whatever preceded it. The page says which is which
 * rather than drawing both the same.
 */

export type SpanKind = "trace" | "agent" | "generation" | "tool" | "guardrail" | "event";

export interface Span {
  id: string;
  parent: string | null;
  name: string;
  kind: SpanKind;
  /** Milliseconds from the start of the run. */
  start: number;
  /** Milliseconds. */
  duration: number;
  /** True when the duration was inferred rather than measured. */
  derived: boolean;
  level: "DEFAULT" | "WARNING" | "ERROR";
  node: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  cost?: number | null;
  tool?: string;
  input?: string;
  output?: string;
  statusMessage?: string;
  /** The control that refused, when this span is a guardrail. */
  control?: string;
}

export interface Trace {
  id: string;
  agent: string;
  state: string;
  startedAt: string;
  durationMs: number;
  spans: Span[];
  totals: {
    generations: number;
    toolCalls: number;
    refusals: number;
    tokensIn: number;
    tokensOut: number;
    cost: number | null;
    /** Time inside model calls, milliseconds. */
    modelMs: number;
    toolMs: number;
  };
  error: string;
}

interface Entry {
  id?: string;
  t?: number;
  kind: string;
  node?: string;
  title?: string;
  detail?: string;
  data?: Record<string, unknown>;
}

interface RunDoc {
  id?: string;
  system?: string;
  state?: string;
  error?: string;
  journal?: { entries?: Entry[]; duration_ms?: number };
}

const GUARDRAIL_KINDS = new Set(["denied", "contract.breach", "taint", "gate.open", "gate.answer"]);

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Project one run into spans. */
export function toTrace(runId: string, run: RunDoc, startedAt: string, sheet: Sheet | null): Trace {
  const entries = (run.journal?.entries ?? []).slice().sort((a, b) => num(a.t) - num(b.t));
  const spans: Span[] = [];
  const totals = {
    generations: 0,
    toolCalls: 0,
    refusals: 0,
    tokensIn: 0,
    tokensOut: 0,
    cost: 0 as number | null,
    modelMs: 0,
    toolMs: 0,
  };

  const runMs = num(run.journal?.duration_ms) || num(entries[entries.length - 1]?.t);
  const rootId = `${runId}:root`;

  /* Node spans: opened on enter, closed on the matching exit. A node that never
     exited (the run failed inside it) is closed at the end of the run and left
     at ERROR, because a span that simply stops is indistinguishable from one
     that finished, and those are very different stories. */
  const openNodes = new Map<string, { id: string; start: number }>();
  /** Last entry time per node, for deriving a duration where none was recorded. */
  const lastAt = new Map<string, number>();

  const parentOf = (node: string) => openNodes.get(node)?.id ?? rootId;

  for (const [i, e] of entries.entries()) {
    const at = num(e.t);
    const node = String(e.node ?? "");
    const prev = lastAt.get(node) ?? openNodes.get(node)?.start ?? 0;

    switch (e.kind) {
      case "node.enter": {
        const id = `${runId}:n${i}`;
        openNodes.set(node, { id, start: at });
        spans.push({
          id,
          parent: rootId,
          name: String(e.title ?? node),
          kind: "agent",
          start: at,
          duration: 0,
          derived: false,
          level: "DEFAULT",
          node,
          input: preview(e.data?.inputs),
        });
        break;
      }
      case "node.exit": {
        const open = openNodes.get(node);
        if (open) {
          const span = spans.find((s) => s.id === open.id);
          if (span) {
            span.duration = at - open.start;
            span.output = preview(e.data?.emitted);
          }
          openNodes.delete(node);
        }
        break;
      }
      case "model.call": {
        const measured = num(e.data?.ms);
        const duration = measured || Math.max(0, at - prev);
        const tokens = (e.data?.tokens ?? {}) as { in?: number; out?: number };
        const model = String(e.title ?? "");
        const tIn = num(tokens.in);
        const tOut = num(tokens.out);
        const c = costOf(model, { in: tIn, out: tOut }, sheet);
        totals.generations += 1;
        totals.tokensIn += tIn;
        totals.tokensOut += tOut;
        totals.modelMs += duration;
        totals.cost = totals.cost === null || c === null ? null : totals.cost + c;
        spans.push({
          id: `${runId}:m${i}`,
          parent: parentOf(node),
          name: model || "model",
          kind: "generation",
          start: at - duration,
          duration,
          derived: !measured,
          level: "DEFAULT",
          node,
          model,
          tokensIn: tIn,
          tokensOut: tOut,
          cost: c,
          input: preview(e.data?.prompt),
          output: String(e.detail ?? "").slice(0, 1200),
        });
        break;
      }
      case "tool.result": {
        const measured = num(e.data?.ms);
        const duration = measured || Math.max(0, at - prev);
        const tool = String(e.data?.tool ?? e.title ?? "");
        totals.toolCalls += 1;
        totals.toolMs += duration;
        spans.push({
          id: `${runId}:t${i}`,
          parent: parentOf(node),
          name: tool,
          kind: "tool",
          start: at - duration,
          duration,
          derived: !measured,
          level: "DEFAULT",
          node,
          tool,
          output: preview(e.data?.value),
        });
        break;
      }
      default: {
        if (GUARDRAIL_KINDS.has(e.kind)) {
          const refused = e.kind === "denied" || e.kind === "contract.breach";
          if (refused) totals.refusals += 1;
          spans.push({
            id: `${runId}:g${i}`,
            parent: parentOf(node),
            name: String(e.title ?? e.kind),
            kind: "guardrail",
            start: at,
            duration: 0,
            derived: false,
            level: refused ? "ERROR" : "WARNING",
            node,
            statusMessage: String(e.detail ?? ""),
            control: String((e.data as { control?: string } | undefined)?.control ?? e.kind),
          });
        } else if (e.kind === "error") {
          spans.push({
            id: `${runId}:e${i}`,
            parent: parentOf(node),
            name: String(e.title ?? "error"),
            kind: "event",
            start: at,
            duration: 0,
            derived: false,
            level: "ERROR",
            node,
            statusMessage: String(e.detail ?? ""),
          });
        }
        break;
      }
    }
    lastAt.set(node, at);
  }

  // Nodes the run never left.
  for (const [node, open] of openNodes) {
    const span = spans.find((s) => s.id === open.id);
    if (span) {
      span.duration = Math.max(0, runMs - open.start);
      span.level = "ERROR";
      span.statusMessage = `${node} never exited`;
    }
  }

  const root: Span = {
    id: rootId,
    parent: null,
    name: String(run.system ?? runId),
    kind: "trace",
    start: 0,
    duration: runMs,
    derived: false,
    level: run.state === "done" ? "DEFAULT" : run.state === "suspended" ? "WARNING" : "ERROR",
    node: "",
    statusMessage: String(run.error ?? ""),
  };

  return {
    id: runId,
    agent: String(run.system ?? ""),
    state: String(run.state ?? "unknown"),
    startedAt,
    durationMs: runMs,
    spans: [root, ...spans].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id)),
    totals,
    error: String(run.error ?? ""),
  };
}

function preview(v: unknown): string {
  if (v === undefined || v === null) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 1200 ? `${s.slice(0, 1200)}…` : s;
}
