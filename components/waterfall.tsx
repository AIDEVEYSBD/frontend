"use client";

import { useEffect, useState } from "react";
import { ControlRef } from "./control-ref";

/**
 * A run's trace, drawn where the run already is.
 *
 * Observability is not a place you go, it is what a run looks like when you
 * open it — so this lives inside the control pane's drill-down and inside the
 * theater, rather than on a page of its own. The spans come from the journal
 * the runtime already wrote, projected server-side, so nothing here depends on
 * a collector being up or an SDK being installed.
 *
 * Every bar is a click target. Picking one shows what that span actually did:
 * the model and its tokens and cost, the tool and what it returned, or the
 * control that refused and why. A faded bar is a duration inferred from the
 * entries around it rather than measured, which is true of runs made before
 * the runtime recorded per-call timing, and it is drawn differently because a
 * measurement and an inference should never look the same.
 */

export type SpanKind = "trace" | "agent" | "generation" | "tool" | "guardrail" | "event";

export interface Span {
  id: string;
  parent: string | null;
  name: string;
  kind: SpanKind;
  start: number;
  duration: number;
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
  control?: string;
}

export interface Trace {
  id: string;
  agent: string;
  state: string;
  durationMs: number;
  spans: Span[];
  totals: {
    generations: number;
    toolCalls: number;
    refusals: number;
    tokensIn: number;
    tokensOut: number;
    cost: number | null;
    modelMs: number;
    toolMs: number;
  };
}

const KIND_COLOR: Record<SpanKind, string> = {
  trace: "bg-fg/30",
  agent: "bg-run",
  generation: "bg-[var(--t-c2)]",
  tool: "bg-[var(--t-c7)]",
  guardrail: "bg-warn",
  event: "bg-err",
};

const KIND_LABEL: Record<SpanKind, string> = {
  trace: "run",
  agent: "agent",
  generation: "model call",
  tool: "tool call",
  guardrail: "guardrail",
  event: "event",
};

export function useTrace(runId: string | null) {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "failed">(runId ? "loading" : "idle");

  // A change of run resets the trace during render; the fetch below fills it.
  const [seen, setSeen] = useState(runId);
  if (runId !== seen) {
    setSeen(runId);
    setTrace(null);
    setState(runId ? "loading" : "idle");
  }

  useEffect(() => {
    if (!runId) return;
    let stop = false;
    fetch(`/api/observability?run=${encodeURIComponent(runId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (stop) return;
        if (d.trace) {
          setTrace(d.trace);
          setState("idle");
        } else setState("failed");
      })
      .catch(() => !stop && setState("failed"));
    return () => {
      stop = true;
    };
  }, [runId]);

  return { trace, state };
}

const ms = (n: number) =>
  n < 1000 ? `${Math.round(n)} ms` : n < 60_000 ? `${(n / 1000).toFixed(1)} s` : `${Math.floor(n / 60_000)}m ${Math.round((n % 60_000) / 1000)}s`;

const tokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

const money = (n: number | null | undefined) =>
  n === null || n === undefined ? "unpriced" : `$${n < 0.01 ? n.toFixed(4) : n.toFixed(2)}`;

function depthOf(spans: Span[]): Map<string, number> {
  const byId = new Map(spans.map((s) => [s.id, s]));
  const d = new Map<string, number>();
  const walk = (s: Span): number => {
    if (d.has(s.id)) return d.get(s.id)!;
    const parent = s.parent ? byId.get(s.parent) : undefined;
    const v = parent ? walk(parent) + 1 : 0;
    d.set(s.id, v);
    return v;
  };
  for (const s of spans) walk(s);
  return d;
}

/** The waterfall. `onPick` lets the host open a span in its own drill-down. */
export function Waterfall({
  trace,
  onPick,
  maxHeight = 260,
}: {
  trace: Trace;
  onPick: (s: Span) => void;
  maxHeight?: number;
}) {
  const depth = depthOf(trace.spans);
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 border-b border-line px-4 py-2 text-[10.5px] text-faint">
        <span className="tnum">{ms(trace.durationMs)}</span>
        <span className="tnum">{trace.spans.length} spans</span>
        <span className="tnum">
          {Math.round((trace.totals.modelMs / Math.max(1, trace.durationMs)) * 100)}% in the model
        </span>
        <span className="grow" />
        <span className="tnum">{money(trace.totals.cost)}</span>
      </div>
      <div className="overflow-y-auto" style={{ maxHeight }}>
        {trace.spans.map((s) => {
          const left = (s.start / Math.max(1, trace.durationMs)) * 100;
          const width = Math.max(0.5, (s.duration / Math.max(1, trace.durationMs)) * 100);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onPick(s)}
              title={s.derived ? "duration inferred from the surrounding entries" : s.name}
              className="focusable flex w-full items-center gap-2 border-b border-line px-4 py-1 text-left last:border-0 hover:bg-raise/50"
            >
              <span
                className="flex min-w-0 shrink-0 items-center gap-1.5"
                style={{ paddingLeft: `${(depth.get(s.id) ?? 0) * 9}px`, width: 168 }}
              >
                <span className={`size-1.5 shrink-0 rounded-[2px] ${KIND_COLOR[s.kind]}`} />
                <span className={`truncate text-[10.5px] ${s.level === "ERROR" ? "text-err" : "text-mist"}`}>
                  {s.name}
                </span>
              </span>
              <span className="relative h-2 min-w-0 grow rounded-sm bg-raise">
                <span
                  className={`absolute top-0 h-2 rounded-sm ${KIND_COLOR[s.kind]} ${s.derived ? "opacity-45" : ""}`}
                  style={{ left: `${left}%`, width: `${width}%` }}
                />
              </span>
              <span className="tnum w-12 shrink-0 text-right text-[10px] text-faint">
                {s.duration ? ms(s.duration) : "·"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** One span, as the drill-down shows it. */
export function SpanDetail({ span }: { span: Span }) {
  return (
    <div className="flex flex-col">
      <Row k="Kind" v={KIND_LABEL[span.kind]} />
      <Row k="Duration" v={`${ms(span.duration)}${span.derived ? " · inferred" : " · measured"}`} />
      <Row k="Starts at" v={`${ms(span.start)} into the run`} />
      {span.node && <Row k="Node" v={span.node} />}
      {span.model && <Row k="Model" v={span.model} />}
      {span.kind === "generation" && (
        <>
          <Row k="Tokens" v={`${tokens(span.tokensIn ?? 0)} in · ${tokens(span.tokensOut ?? 0)} out`} />
          <Row k="Cost" v={money(span.cost)} />
        </>
      )}
      {span.tool && <Row k="Tool" v={span.tool} />}
      {span.control && <Row k="Control" v={<ControlRef control={span.control} size="md" />} />}
      {span.statusMessage && <Row k="Status" v={span.statusMessage} />}
      {span.input && <Block k="Input" v={span.input} />}
      {span.output && <Block k={span.kind === "tool" ? "Returned" : "Output"} v={span.output} />}
      {!span.input && !span.output && !span.statusMessage && (
        <p className="px-4 py-3 text-[11px] leading-[1.5] text-faint">
          This span carries timing only. Model calls and tool results carry what went in and what
          came back; a node boundary carries what it emitted.
        </p>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2">
      <span className="text-[11.5px] text-faint">{k}</span>
      <span className="tnum min-w-0 truncate text-right text-[12px] font-medium text-fg">{v}</span>
    </div>
  );
}

function Block({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-line px-4 py-2.5 last:border-0">
      <span className="text-[10.5px] text-ghost">{k}</span>
      <pre className="max-h-48 overflow-auto rounded-sm border border-line bg-canvas px-2 py-1.5 font-mono text-[10px] leading-[1.5] whitespace-pre-wrap text-faint">
        {v}
      </pre>
    </div>
  );
}
