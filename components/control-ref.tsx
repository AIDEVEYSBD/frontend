"use client";

import Link from "next/link";
import { CONTROLS, FAMILIES, explainControl } from "@/lib/guardrails";

/**
 * A reference to a control in the register, wherever a control fired.
 *
 * A refusal, a taint mark, a gate or a kill is the register doing its job;
 * the entry that records it should name the control the way the register
 * does, with its identifier, so a reviewer can go from the firing to the
 * control statement in one click. The chip links to the Controls page with
 * that control opened.
 */

const FAMILY_COLOR: Record<string, string> = {
  AC: "var(--t-c1)", DP: "var(--t-c2)", HO: "var(--t-c8)", IN: "var(--t-c5)", RS: "var(--t-c7)", AU: "var(--t-c3)", ID: "var(--t-c9)",
};

/** The control an operator kill is the evidence of. */
export const KILL_CONTROL = "AF-RS-03";

/** Resolve a journal control key (`capability`, `taint`, `contract.breach`) or a register id (`AF-AC-01`). */
export function resolveControl(key: string): { id: string; title: string; family: string; statement: string } | null {
  const byId = CONTROLS.find((c) => c.id === key);
  if (byId) return { id: byId.id, title: byId.title, family: byId.family, statement: byId.statement };
  const why = explainControl(key);
  if (!why.id) return null;
  const c = CONTROLS.find((x) => x.id === why.id)!;
  return { id: c.id, title: c.title, family: c.family, statement: c.statement };
}

export function ControlRef({ control, size = "sm" }: { control: string; size?: "sm" | "md" }) {
  const c = resolveControl(control);
  if (!c) return null;
  const family = FAMILIES.find((f) => f.id === c.family)?.name ?? c.family;
  return (
    <Link
      href={`/guardrails?control=${encodeURIComponent(c.id)}`}
      title={`${c.id} · ${family}. ${c.statement}`}
      onClick={(e) => e.stopPropagation()}
      className={`focusable inline-flex max-w-full items-center gap-1.5 rounded-sm border border-line bg-surface font-medium text-fg transition-colors hover:border-line-strong hover:bg-raise ${
        size === "md" ? "px-2 py-1 text-[11px]" : "px-1.5 py-px text-[10px]"
      }`}
    >
      <span className="size-1.5 shrink-0 rounded-[2px]" style={{ background: FAMILY_COLOR[c.family] ?? "var(--t-fg-4)" }} />
      <span className="tnum shrink-0 font-mono">{c.id}</span>
      <span className="truncate text-faint">{c.title}</span>
    </Link>
  );
}
