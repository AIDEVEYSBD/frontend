"use client";

import type { ReactNode } from "react";
import type { Stage } from "@/lib/pipeline";

/**
 * The pipeline, as a drawing.
 *
 * Two lanes run left to right and converge on retrieval, which is the one
 * place an agent touches either. A drawing earns its place over a list here
 * because the argument is topological: what feeds what, and where the human
 * sits. A live stage is solid and tinted; a specified stage is dashed. Both
 * are labelled in the legend, and both are clickable.
 *
 * It is laid out in HTML rather than a fixed SVG so that labels size their own
 * boxes and nothing ever clips; the only drawn geometry is the two converging
 * connectors, which scale with the lanes beside them.
 */

export interface DiagramLane {
  id: string;
  name: string;
  purpose: string;
  stages: Stage[];
}

/* ── icons: a small stroke set, one glyph per stage ── */

const ICONS: Record<string, ReactNode> = {
  connectors: <><path d="M9 2v6M15 2v6" /><path d="M5 8h14l-1 5a6 6 0 0 1-12 0z" /><path d="M12 19v3" /></>,
  parsers: <><path d="M8 3H6a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2" /><path d="M16 3h2a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2" /></>,
  bronze: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /></>,
  silver: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>,
  gold: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v4c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 9v4c0 1.7 3.6 3 8 3s8-1.3 8-3V9" /><path d="M4 13v4c0 1.7 3.6 3 8 3s8-1.3 8-3v-4" /></>,
  curated: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /><path d="M9 7h7M9 11h5" /></>,
  fetch: <><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></>,
  sections: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h8M8 9h2" /></>,
  chunks: <><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" /></>,
  metadata: <><path d="M12 2H2v10l9.3 9.3a1 1 0 0 0 1.4 0l8.6-8.6a1 1 0 0 0 0-1.4z" /><circle cx="7" cy="7" r="1.5" /></>,
  lexical: <><path d="M4 7V4h16v3" /><path d="M9 20h6" /><path d="M12 4v16" /></>,
  embedding: <><path d="M12 3v3M12 18v3M3 12h3M18 12h3" /><circle cx="12" cy="12" r="3" /><path d="M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></>,
  hitl: <><circle cx="9" cy="7" r="4" /><path d="M2 21v-2a4 4 0 0 1 4-4h6" /><path d="m16 17 2 2 4-4" /></>,
  pgvector: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
  hybrid: <><circle cx="10" cy="10" r="6" /><path d="m21 21-6.5-6.5" /><path d="M7 10h6M10 7v6" /></>,
  adjacent: <><rect x="3" y="4" width="18" height="4" rx="1" /><rect x="3" y="10" width="18" height="4" rx="1" /><rect x="3" y="16" width="18" height="4" rx="1" /></>,
  rerank: <><path d="M4 6h10M4 12h7M4 18h4" /><path d="m17 8 3-3 3 3M20 5v14" /></>,
  guardrails: <><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z" /><path d="m9 12 2 2 4-4" /></>,
  agent: <><rect x="4" y="8" width="16" height="12" rx="3" /><path d="M12 4v4M8 2h8" /><circle cx="9" cy="14" r="1.2" fill="currentColor" stroke="none" /><circle cx="15" cy="14" r="1.2" fill="currentColor" stroke="none" /></>,
  telemetry: <><path d="M3 12h4l3-8 4 16 3-8h4" /></>,
  knowledge: <><path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z" /><path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z" /></>,
};

export function StageIcon({ id, size = 14, className = "" }: { id: string; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden>
      {ICONS[id] ?? <circle cx="12" cy="12" r="8" />}
    </svg>
  );
}

/* ── a step node ── */

function Node({ s, count, active, onPick }: { s: Stage; count?: string; active: boolean; onPick: (s: Stage) => void }) {
  const live = s.state === "live";
  return (
    <button
      type="button"
      onClick={() => onPick(s)}
      aria-pressed={active}
      className={[
        "focusable group flex min-w-0 items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-[background-color,border-color,box-shadow]",
        live
          ? active
            ? "border-ok bg-ok-bg elev-2"
            : "border-ok-line bg-surface hover:border-ok hover:bg-ok-bg"
          : active
            ? "border-dim border-dashed bg-raise"
            : "border-line-strong border-dashed bg-canvas hover:bg-raise",
      ].join(" ")}
    >
      <span className={`grid size-6 shrink-0 place-items-center rounded-[5px] ${live ? "bg-ok/12 text-ok" : "bg-raise text-faint"}`}>
        <StageIcon id={s.id} size={13} />
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <span className={`truncate text-[11px] font-semibold ${live ? "text-fg" : "text-dim"}`}>{s.label}</span>
        {count ? (
          <span className="tnum truncate font-mono text-[9px] text-faint">{count}</span>
        ) : (
          <span className="text-[9px] text-ghost">{live ? "running" : "specified"}</span>
        )}
      </span>
    </button>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 16 12" width="14" height="10" className="shrink-0 text-line-strong" aria-hidden>
      <path d="M1 6h12" stroke="currentColor" strokeWidth="1.4" fill="none" />
      <path d="M9 2l5 4-5 4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── the drawing ── */

export function PipelineDiagram({
  lanes,
  retrieval,
  counts,
  onPick,
  picked,
}: {
  lanes: [DiagramLane, DiagramLane];
  retrieval: Stage[];
  counts?: Record<string, string>;
  onPick: (s: Stage) => void;
  picked?: string;
}) {
  return (
    <div className="grid items-stretch gap-0 lg:grid-cols-[minmax(0,1fr)_44px_240px_72px]">
      {/* the two lanes */}
      <div className="grid gap-3 lg:grid-rows-2">
        {lanes.map((lane) => (
          <section key={lane.id} className="flex min-w-0 gap-3 rounded-lg border border-line bg-sunken/40 p-3">
            <span className="flex w-[104px] shrink-0 flex-col gap-1 border-r border-line pr-3">
              <span className="grid size-7 place-items-center rounded-md bg-ink text-on-ink">
                <StageIcon id={lane.id} size={15} />
              </span>
              <span className="text-[11.5px] leading-tight font-semibold text-fg">{lane.name}</span>
              <span className="text-[9.5px] leading-[1.35] text-faint">{lane.stages.length} stages</span>
            </span>
            <span className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-2">
              {lane.stages.map((s, i) => (
                <span key={s.id} className="flex items-center gap-1">
                  {i > 0 && <Arrow />}
                  <Node s={s} count={counts?.[s.id]} active={picked === s.id} onPick={onPick} />
                </span>
              ))}
            </span>
          </section>
        ))}
      </div>

      {/* the convergence, drawn */}
      <div className="relative hidden lg:block">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full text-line-strong" aria-hidden>
          <path d="M0 26 C 55 26, 45 50, 100 50" fill="none" stroke="currentColor" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
          <path d="M0 74 C 55 74, 45 50, 100 50" fill="none" stroke="currentColor" strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="absolute top-1/2 right-0 size-1.5 -translate-y-1/2 translate-x-1/2 rounded-full bg-line-strong" />
      </div>

      {/* retrieval */}
      <section className="mt-3 flex flex-col gap-2 rounded-lg border border-line bg-sunken/40 p-3 lg:mt-0">
        <span className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-md bg-ink text-on-ink">
            <StageIcon id="hybrid" size={15} />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-[11.5px] font-semibold text-fg">Agentic retrieval</span>
            <span className="text-[9.5px] text-faint">where an agent reads</span>
          </span>
        </span>
        <span className="flex flex-col gap-1.5">
          {retrieval.map((s) => (
            <Node key={s.id} s={s} count={counts?.[s.id]} active={picked === s.id} onPick={onPick} />
          ))}
        </span>
      </section>

      {/* the agent */}
      <div className="hidden items-center lg:flex">
        <svg viewBox="0 0 24 12" width="22" height="11" className="shrink-0 text-line-strong" aria-hidden>
          <path d="M0 6h19" stroke="currentColor" strokeWidth="1.4" fill="none" />
          <path d="M16 2l5 4-5 4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="flex flex-col items-center gap-1">
          <span className="grid size-10 place-items-center rounded-full bg-ink text-on-ink elev-2">
            <StageIcon id="agent" size={20} />
          </span>
          <span className="text-[9.5px] font-medium text-faint">agent</span>
        </span>
      </div>
    </div>
  );
}
