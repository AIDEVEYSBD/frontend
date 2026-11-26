"use client";

import { Mono } from "./ui";
import { DigestChip } from "./digest-chip";
import { sandboxFacts, type SandboxRun } from "@/lib/sandbox";

/**
 * An isolated `sandbox.execute`, as the transcript and the agents view show
 * it (phase L6): the isolator, the exit, how long it took, whether the
 * output was cut at the bound, and the copy-in manifest's digest (short, the
 * full value a hover or a click away), then the output itself. The facts
 * come first because they say whether the output can be trusted as the
 * whole of it.
 */

const TONE = { ok: "text-ok", err: "text-err", warn: "text-warn" } as const;

export function SandboxSummary({ run }: { run: SandboxRun }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border border-line bg-surface px-2.5 py-2">
      <span className="text-[10.5px] font-medium text-faint">Isolated run</span>
      {sandboxFacts(run).map((f) => (
        <span key={f.k} className="flex min-w-0 items-center gap-1.5 text-[11px]">
          <span className="text-ghost">{f.k}</span>
          {f.full ? <DigestChip digest={f.full} label={f.k} /> : <Mono className={`text-[11px] ${f.tone ? TONE[f.tone] : "text-fg"}`}>{f.v}</Mono>}
        </span>
      ))}
    </div>
  );
}

function Stream({ label, text, err = false }: { label: string; text: string; err?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10.5px] font-medium text-faint">{label}</span>
      <pre className={`max-h-[240px] overflow-auto rounded-md border border-line bg-sunken/40 p-2.5 font-mono text-[10.5px] leading-[1.6] whitespace-pre-wrap ${err ? "text-err" : "text-mist"}`}>
        {text || <span className="text-ghost">(empty)</span>}
      </pre>
    </div>
  );
}

export function SandboxOutput({ run }: { run: SandboxRun }) {
  return (
    <div className="flex flex-col gap-2">
      <SandboxSummary run={run} />
      <Stream label="stdout" text={run.stdout} />
      {run.stderr && <Stream label="stderr" text={run.stderr} err />}
      {run.truncated && <span className="text-[10.5px] text-warn">Output cut at the sandbox&rsquo;s bound.</span>}
    </div>
  );
}
