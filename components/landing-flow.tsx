import type { ReactNode } from "react";

/**
 * How a piece of work moves through the console, as a diagram of structure:
 * five stages left to right, the limits that bound the agent above them and
 * the journal beneath. No case, no names, no figures. Wide, it is a row of
 * boxes over the journal band; narrow, the journal is the rail the stages
 * hang from.
 */

interface Stage {
  /** Who or what acts at this stage. */
  by: string;
  title: string;
  text: string;
  /** The stage where a person decides: the one place the diagram is red. */
  gate?: boolean;
  /** The stage the limits bound. */
  bounded?: boolean;
}

const STAGES: Stage[] = [
  { by: "A person", title: "Request and dataset", text: "Someone permitted to run a workload starts it and hands over the dataset it will work on." },
  { by: "The agent", title: "Steps", text: "Each step uses an approved model, admitted knowledge and only the tools granted to that step.", bounded: true },
  { by: "A named role", title: "Gate", text: "The work waits. The role named on the gate approves and it continues, or refuses and it stops.", gate: true },
  { by: "Output", title: "Findings", text: "Each finding is linked to the evidence beneath it and to the steps that produced it." },
  { by: "Output", title: "Report", text: "The workload's report, kept as a record with its state and history." },
];

const LIMITS = "Limits enforced outside the model: budget, step limit, stop control, emergency stop";
const JOURNAL = "Every step, tool call and decision is written as it happens, in order. The record can be verified afterwards.";

/** Three steps in a row: the agent's work is a sequence, not one act. */
function StepMarks() {
  return (
    <span aria-hidden className="flex items-center">
      {[0, 1, 2].map((i) => (
        <span key={i} className="flex items-center">
          {i > 0 && <span className="h-px w-3 bg-line-strong" />}
          <span className="size-2.5 border border-fg bg-surface" />
        </span>
      ))}
    </span>
  );
}

function Box({ s, children }: { s: Stage; children?: ReactNode }) {
  return (
    <div className={`flex h-full flex-col gap-2 rounded-sm border bg-surface p-4 ${s.gate ? "border-line-strong border-t-[3px] border-t-brand pt-[14px]" : "border-line-strong"}`}>
      <span className="flex items-center justify-between gap-2 text-[11.5px] font-medium text-faint">
        {s.by}
        {s.bounded && <StepMarks />}
      </span>
      <span className="text-[15.5px] leading-tight font-semibold tracking-[-0.01em] text-fg">{s.title}</span>
      <span className="text-[13px] leading-[1.55] text-dim">{s.text}</span>
      {children}
    </div>
  );
}

/** The arrow between two stages. */
function Arrow() {
  return (
    <svg aria-hidden viewBox="0 0 32 12" className="h-3 w-full self-center text-fg" preserveAspectRatio="none">
      <path d="M0 6h30" stroke="currentColor" strokeWidth="1.25" vectorEffect="non-scaling-stroke" fill="none" />
      <path d="M25 1.5 31 6l-6 4.5" stroke="currentColor" strokeWidth="1.25" vectorEffect="non-scaling-stroke" fill="none" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** A stage's line down to the journal. */
function Drop() {
  return (
    <span aria-hidden className="flex h-10 flex-col items-center">
      <span className="w-px grow border-l border-dashed border-fg/45" />
      <span className="size-1.5 bg-fg" />
    </span>
  );
}

const COLS = "grid grid-cols-[1fr_32px_1.2fr_32px_1fr_32px_1fr_32px_1fr]";

export function WorkFlow() {
  return (
    <figure aria-label="A request and its dataset, the agent's steps, a gate where a named role decides, the findings and the report, with the journal recording every step.">
      {/* Wide: the stages in a row, the limits above the agent, the journal beneath. */}
      <div className="hidden lg:block">
        <div className={COLS}>
          <div className="col-start-3 col-end-4 flex flex-col gap-2 pb-3">
            <span className="text-[12px] leading-snug font-medium text-dim">{LIMITS}</span>
            <span aria-hidden className="h-2 border-x border-t border-fg/55" />
          </div>
        </div>
        <div className={COLS}>
          {STAGES.map((s, i) => (
            <Fragmented key={s.title} first={i === 0}>
              <Box s={s} />
            </Fragmented>
          ))}
        </div>
        <div className={COLS}>
          {STAGES.map((s, i) => (
            <Fragmented key={s.title} first={i === 0} blank>
              <Drop />
            </Fragmented>
          ))}
        </div>
        {/* The band keeps the stages' columns, so its words sit under the boxes' own. */}
        <div className={`${COLS} items-baseline rounded-sm bg-ink py-4 text-on-ink`}>
          <span className="pl-[17px] text-[15.5px] font-semibold tracking-[-0.01em]">Journal</span>
          <span className="col-start-3 col-end-10 px-[17px] text-[13.5px] leading-[1.55] opacity-80">{JOURNAL}</span>
        </div>
      </div>

      {/* Narrow: the journal is the rail down the left, and every stage hangs from it. */}
      <div className="lg:hidden">
        <ol className="relative flex flex-col gap-4 pb-6 pl-9">
          <span aria-hidden className="absolute top-0 bottom-0 left-[5px] w-[2px] bg-ink" />
          {STAGES.map((s) => (
            <li key={s.title} className="relative">
              <span aria-hidden className={`absolute top-5 -left-9 size-3 ${s.gate ? "bg-brand" : "bg-ink"}`} />
              <span aria-hidden className="absolute top-[25px] -left-6 h-px w-6 bg-line-strong" />
              <Box s={s}>{s.bounded && <span className="mt-1 border-t border-line pt-2.5 text-[12px] leading-snug font-medium text-dim">{LIMITS}</span>}</Box>
            </li>
          ))}
        </ol>
        <div className="flex flex-col gap-1.5 rounded-sm bg-ink px-5 py-4 text-on-ink">
          <span className="text-[15.5px] font-semibold tracking-[-0.01em]">Journal</span>
          <span className="text-[13.5px] leading-[1.55] opacity-80">{JOURNAL}</span>
        </div>
      </div>
    </figure>
  );
}

/** A stage cell preceded by its connector cell, so both rows share one grid. */
function Fragmented({ first, blank = false, children }: { first: boolean; blank?: boolean; children: ReactNode }) {
  return (
    <>
      {!first && (blank ? <span aria-hidden /> : <Arrow />)}
      {children}
    </>
  );
}
