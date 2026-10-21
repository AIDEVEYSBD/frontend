"use client";

import { useEffect, useMemo, useState } from "react";
import { api, errorText } from "@/lib/api/client";
import { lineageOf, type Hop, type LineageEntry } from "@/lib/lineage";
import { clock } from "@/lib/run-fold";
import { DrillModal } from "./drill";
import { Button, Mono, Tag } from "./ui";
import { ControlRef } from "./control-ref";
import { Skeleton } from "./loaders";

/**
 * The taint lineage drawer: one entry of one run, with the entries it was
 * derived from above it and the entries it fed below it.
 *
 * Opened from the Runs transcript (the Taints filter, or any refusal) and
 * from the Controls watch. The Runs page hands over the entries it already
 * holds; the watch names a run and the record is read from the runs door.
 * The walk itself is lib/lineage.ts; this only draws it. Any row can become
 * the root, so a reviewer follows the chain hop by hop without leaving.
 */

const KIND_LABEL: Record<string, string> = {
  "run.start": "start",
  "run.end": "run done",
  "node.enter": "step",
  "node.exit": "step done",
  "model.call": "reasoning",
  "tool.call": "tool",
  "tool.result": "returned",
  "gate.open": "escalation",
  "gate.answer": "decision",
  taint: "taint mark",
  denied: "refused",
  "contract.breach": "contract",
  error: "error",
  note: "note",
};

const KIND_TONE: Record<string, string> = {
  denied: "text-err",
  "contract.breach": "text-err",
  error: "text-err",
  taint: "text-warn",
  "gate.open": "text-warn",
  "model.call": "text-run",
  "tool.result": "text-ok",
};

function Row({ hop, root, onFocus }: { hop: Hop | { entry: LineageEntry; depth: 0; via: "" }; root?: boolean; onFocus: (id: string) => void }) {
  const e = hop.entry;
  const control = e.data?.control ? String(Array.isArray(e.data.control) ? e.data.control[0] : e.data.control) : "";
  const tool = typeof e.data?.tool === "string" ? e.data.tool : "";
  return (
    <div
      className={`flex items-start gap-3 border-b border-line px-4 py-2 last:border-0 ${root ? "bg-raise/50" : ""}`}
      style={{ paddingLeft: `${16 + Math.min(hop.depth, 6) * 14}px` }}
    >
      <Mono className="w-9 shrink-0 pt-0.5 text-[10.5px] text-ghost">{clock(e.t)}</Mono>
      <span className="flex min-w-0 grow flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className={`text-[10.5px] font-medium ${KIND_TONE[e.kind] ?? "text-dim"}`}>{KIND_LABEL[e.kind] ?? e.kind}</span>
          <span className="truncate text-[12px] font-medium text-fg">{e.title || tool || e.kind}</span>
          {tool && e.title !== tool && <Mono className="text-[10.5px] text-mist">{tool}</Mono>}
          {e.tainted && <Tag tone="warn">tainted</Tag>}
          {control && <ControlRef control={control} />}
          {e.node && <span className="text-[10.5px] text-ghost">{e.node}</span>}
        </span>
        {e.detail && <span className="line-clamp-2 text-[11px] leading-[1.5] text-faint">{e.detail}</span>}
        <span className="flex items-center gap-2">
          <Mono className="text-[9.5px] text-ghost">{e.id}</Mono>
          {hop.depth > 0 && <span className="text-[9.5px] text-ghost">{hop.depth === 1 ? "direct" : `${hop.depth} hops`} · via {hop.via}</span>}
        </span>
      </span>
      {!root && (
        <Button size="sm" variant="quiet" onClick={() => onFocus(e.id)}>Focus</Button>
      )}
    </div>
  );
}

export function LineageDrawer({
  runId,
  entryId,
  entries,
  onClose,
}: {
  runId: string;
  entryId: string;
  /** The journal, when the caller already holds it; otherwise the run record is read. */
  entries?: LineageEntry[];
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<LineageEntry[] | null>(entries ?? null);
  const [error, setError] = useState("");
  const [focus, setFocus] = useState(entryId);

  useEffect(() => {
    if (entries) return;
    let stop = false;
    api
      .GET("/api/runs/{run_id}", { params: { path: { run_id: runId } } })
      .then(({ data, error: err, response }) => {
        if (stop) return;
        if (!data) {
          setError(errorText(err, response));
          return;
        }
        setLoaded((data.journal?.entries ?? []) as LineageEntry[]);
      })
      .catch((e: Error) => !stop && setError(e.message));
    return () => {
      stop = true;
    };
  }, [runId, entries]);

  const lineage = useMemo(() => (loaded ? lineageOf(loaded, focus) : null), [loaded, focus]);
  const root = lineage?.root ?? null;

  return (
    <DrillModal
      title={`Lineage · ${focus}`}
      subtitle={
        root
          ? `${root.title || root.kind} in run ${runId}. Above: what it was derived from (the because chain, backwards). Below: every later entry that cites it.`
          : `Run ${runId}`
      }
      onClose={onClose}
      actions={
        <span className="flex items-center gap-2">
          {lineage?.taintedUpstream && <Tag tone="warn">untrusted content upstream</Tag>}
          {lineage && lineage.sinks.length > 0 && <Tag tone="err">{lineage.sinks.length} sink{lineage.sinks.length === 1 ? "" : "s"} or refusal{lineage.sinks.length === 1 ? "" : "s"} reached</Tag>}
          {focus !== entryId && (
            <Button size="sm" variant="quiet" onClick={() => setFocus(entryId)}>Back to {entryId}</Button>
          )}
          <Button size="sm" variant="solid" tone="ink" href={`/runs?id=${encodeURIComponent(runId)}`}>Open run</Button>
        </span>
      }
    >
      {error && <p className="px-4 py-3 text-[11.5px] text-err">{error}</p>}
      {!error && !lineage && (
        <div className="p-4">
          <Skeleton lines={4} />
        </div>
      )}
      {lineage && !root && <p className="px-4 py-3 text-[11.5px] text-faint">The record holds no entry {focus}.</p>}
      {lineage && root && (
        <div className="flex flex-col">
          <span className="border-b border-line bg-raise/40 px-4 py-1.5 text-[10.5px] font-medium tracking-[0.04em] text-ghost uppercase">
            Derived from · {lineage.upstream.length}{lineage.missing.length ? ` · ${lineage.missing.length} cited but not on the record` : ""}
          </span>
          {lineage.upstream.length === 0 && <p className="px-4 py-2 text-[11px] text-faint">Nothing: this entry cites no earlier one.</p>}
          {[...lineage.upstream].reverse().map((h) => (
            <Row key={h.entry.id} hop={h} onFocus={setFocus} />
          ))}
          {lineage.missing.length > 0 && (
            <p className="px-4 py-2 text-[11px] text-warn">
              Cited but not on the record: {lineage.missing.join(", ")}. A hole in the chain is itself a finding.
            </p>
          )}
          <span className="border-y border-line bg-raise/40 px-4 py-1.5 text-[10.5px] font-medium tracking-[0.04em] text-ghost uppercase">The entry</span>
          <Row hop={{ entry: root, depth: 0, via: "" }} root onFocus={setFocus} />
          <span className="border-y border-line bg-raise/40 px-4 py-1.5 text-[10.5px] font-medium tracking-[0.04em] text-ghost uppercase">Fed into · {lineage.downstream.length}</span>
          {lineage.downstream.length === 0 && <p className="px-4 py-2 text-[11px] text-faint">Nothing cites this entry.</p>}
          {lineage.downstream.map((h) => (
            <Row key={h.entry.id} hop={h} onFocus={setFocus} />
          ))}
        </div>
      )}
    </DrillModal>
  );
}
