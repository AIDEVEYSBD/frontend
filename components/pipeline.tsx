"use client";

import { useState } from "react";
import { PipelineDiagram } from "./pipeline-diagram";
import { KNOWLEDGE_LANE, RETRIEVAL_STAGES, type Stage } from "@/lib/pipeline";

/**
 * The stages, drawn, with the explanation of the one picked beside them.
 *
 * What happens to a source between its address and an agent's question, so
 * the words the page uses (fetched, staged, admitted, indexed) have a
 * meaning a reader can check. It explains the stages and only that: no
 * count, no state, nothing about what this deployment is running. Folded
 * until asked for, because it is reference, not the page's work.
 */
export function PipelineView() {
  const [shown, setShown] = useState(false);
  const [open, setOpen] = useState<Stage | null>(null);

  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-expanded={shown}
        aria-controls="knowledge-stages"
        className={`focusable flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 bg-raise/55 px-4 py-2.5 text-left ${shown ? "border-b border-line" : ""}`}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 text-faint transition-transform ${shown ? "" : "-rotate-90"}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
        <span className="text-[12.5px] font-semibold tracking-[-0.005em]">How a source becomes retrievable</span>
        <span className="text-[11px] leading-[1.55] text-faint">the stages, explained; this drawing does not report what is running</span>
        <span className="grow" />
        <span className="text-[10.5px] text-ghost">{shown ? "hide" : "show"}</span>
      </button>

      {shown && (
        <div id="knowledge-stages" className="flex flex-col">
          <div className="p-3">
            <PipelineDiagram lane={KNOWLEDGE_LANE} retrieval={RETRIEVAL_STAGES} onPick={(s) => setOpen(open?.id === s.id ? null : s)} picked={open?.id} />
          </div>
          <div className="flex min-h-[72px] flex-col gap-1 border-t border-line px-4 py-3">
            {open ? (
              <>
                <span className="text-[13px] font-semibold">{open.label}</span>
                <span className="max-w-[90ch] text-[12px] leading-[1.6] text-dim">{open.detail}</span>
              </>
            ) : (
              <>
                <span className="text-[13px] font-semibold">Pick a stage to read what it does</span>
                <span className="max-w-[90ch] text-[12px] leading-[1.6] text-dim">
                  A source is added to the register, fetched, split and indexed by its words, and then waits for a person. Only an admitted document is embedded and can be
                  searched, by a person here or by an agent with a read grant through its retrieval.search tool.
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
