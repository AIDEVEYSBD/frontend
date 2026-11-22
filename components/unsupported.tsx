"use client";

import type { UnsupportedPart } from "@/lib/unsupported";

/**
 * The parts of an agent's definition the platform does not carry out yet
 * (lib/unsupported.ts), each with the platform's own reason. Drawn wherever
 * the agent can be deployed or run, beside the disabled control.
 */
export function UnsupportedParts({ parts, compact = false, className = "", heading }: { parts: UnsupportedPart[]; compact?: boolean; className?: string; /** What the parts stop, when it is not deploy and run both (lib/unsupported.ts unsupportedHeading). */ heading?: string }) {
  if (!parts.length) return null;
  return (
    <div className={`flex flex-col gap-1 rounded-md border border-warn/40 bg-surface ${compact ? "px-2.5 py-1.5" : "px-3 py-2.5"} ${className}`} data-unsupported={parts.map((p) => p.part).join(",")}>
      <span className="text-[11.5px] font-semibold text-warn">
        {heading ?? `Not carried out by the platform yet${compact ? "" : ": deploy and run are off"}`}
      </span>
      <ul className="flex flex-col gap-0.5">
        {parts.map((p) => (
          <li key={p.part} className="text-[11px] leading-[1.5] text-dim">
            <span className="font-mono text-[10.5px] text-fg">{p.part}</span>
            {p.why ? ` · ${p.why}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
