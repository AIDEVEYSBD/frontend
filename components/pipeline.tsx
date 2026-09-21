"use client";

import { useState } from "react";
import { Mono, Status } from "./ui";
import { BrandMark } from "./brand";
import { PipelineDiagram } from "./pipeline-diagram";
import {
  FEATURES,
  KNOWLEDGE_LANE,
  RETRIEVAL_STAGES,
  TELEMETRY_LANE,
  TELEMETRY_SOURCES,
  type Stage,
} from "@/lib/pipeline";

/**
 * The architecture, drawn, with its explanation beside it.
 *
 * Two lanes feed an agent's context — security tooling parsed into structured
 * facts, and authority documents made retrievable — and they converge at
 * retrieval, the only place an agent touches either. Every stage says whether
 * it runs here or is specified, which is what lets the drawing be shown to a
 * client without a caveat.
 */

export function PipelineView({ counts }: { counts?: Record<string, string> }) {
  const [open, setOpen] = useState<Stage | null>(null);
  const all = [...TELEMETRY_LANE.stages, ...KNOWLEDGE_LANE.stages, ...RETRIEVAL_STAGES];
  const live = all.filter((s) => s.state === "live").length;

  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3">
        <span className="text-[13px] font-semibold tracking-[-0.005em]">Context and RAG engineering</span>
        <span className="text-[11.5px] text-faint">how context reaches an agent · click any stage</span>
        <span className="grow" />
        <span className="flex items-center gap-3 text-[10.5px]">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] bg-ok" />
            <span className="text-faint">
              running here <span className="tnum text-fg">{live}</span> of {all.length}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px] border border-dashed border-line-strong" />
            <span className="text-faint">specified</span>
          </span>
        </span>
      </div>

      <div className="px-2 pt-3 pb-1">
        <PipelineDiagram
          lanes={[TELEMETRY_LANE, KNOWLEDGE_LANE]}
          retrieval={RETRIEVAL_STAGES}
          counts={counts}
          onPick={(s) => setOpen(open?.id === s.id ? null : s)}
          picked={open?.id}
        />
      </div>

      <div className="grid gap-px border-t border-line bg-line lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {/* what the picked stage does */}
        <div className="flex min-h-[96px] flex-col gap-1.5 bg-surface px-4 py-3">
          {open ? (
            <>
              <span className="flex flex-wrap items-baseline gap-2">
                <span className="text-[13px] font-semibold">{open.label}</span>
                <Status tone={open.state === "live" ? "ok" : "neutral"}>
                  {open.state === "live" ? "running here" : "specified"}
                </Status>
                {(open.features ?? []).map((n) => (
                  <Mono key={n} className="text-[10px] text-ghost">
                    feature {n}
                  </Mono>
                ))}
              </span>
              <span className="max-w-[80ch] text-[12px] leading-[1.6] text-faint">{open.detail}</span>
            </>
          ) : (
            <>
              <span className="text-[13px] font-semibold">Two lanes, one meeting point</span>
              <span className="max-w-[80ch] text-[12px] leading-[1.6] text-faint">
                Telemetry lands as facts an agent can query. Knowledge lands as passages it can cite.
                Both pass through a person before an agent can reach them, and both reach the agent
                only through retrieval, which is where the guardrails sit.
              </span>
            </>
          )}
        </div>

        {/* the salient features, numbered as the architecture numbers them */}
        <div className="grid grid-cols-1 gap-px bg-line sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.n} className="flex items-start gap-2 bg-surface px-3 py-2">
              <span className={`mt-1.5 size-1.5 shrink-0 rounded-[2px] ${f.state === "live" ? "bg-ok" : "bg-line-strong"}`} />
              <span className="flex min-w-0 flex-col">
                <span className="text-[10.5px] leading-[1.45] text-fg">{f.text}</span>
                <span className="text-[9px] text-ghost">
                  {f.n} · {f.state === "live" ? "running here" : "specified"}
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** The tooling the telemetry lane is designed around, with its parser state. */
export function TelemetryRegister() {
  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="text-[13px] font-semibold tracking-[-0.005em]">Tools and telemetry sources</span>
        <span className="truncate text-[11.5px] text-faint">the estate an agent asks about</span>
        <span className="grow" />
        <Status tone="neutral" dot={false}>
          {TELEMETRY_SOURCES.length} specified
        </Status>
      </div>
      <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-4">
        {TELEMETRY_SOURCES.map((t) => (
          <div key={t.name} className="flex items-start gap-2.5 bg-surface px-3 py-2.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-raise">
              <BrandMark name={t.name} size={16} />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[12px] font-medium text-fg">{t.name}</span>
              <span className="truncate text-[10px] text-faint">{t.kind}</span>
              <span className="mt-0.5 text-[10px] leading-[1.4] text-ghost">{t.contributes}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
