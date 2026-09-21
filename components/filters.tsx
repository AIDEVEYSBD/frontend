"use client";

import type { ReactNode } from "react";

/**
 * Filters as buttons, the way the CTEM console does them.
 *
 * A filter is a chip with a count: a real hit area, and a selected state in
 * the design system's own ink so which filter is on is legible at a glance.
 * Groups sit on one plane; the way out of them ("Clear N filters") appears
 * only when something is set, because a permanently visible clear control
 * over an unfiltered list is furniture. Filters that exist but are not worth
 * a permanent row live under "More filters".
 */

export interface Chip {
  value: string;
  label: string;
  count?: number;
  active: boolean;
  tone?: "ok" | "warn" | "err";
}

function fmt(n: number): string {
  return n.toLocaleString("en-GB");
}

export function Chips({ items, label, onToggle }: { items: Chip[]; label?: string; onToggle: (value: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {label && <span className="mr-0.5 text-[11px] font-medium text-faint">{label}</span>}
      {items.map((c) => (
        <button
          key={c.value}
          type="button"
          onClick={() => onToggle(c.value)}
          aria-pressed={c.active}
          className={`focusable inline-flex h-7 items-center gap-1.5 rounded-sm border px-2.5 text-[12px] font-medium whitespace-nowrap transition-colors duration-100 ${
            c.active ? "border-transparent bg-ink text-on-ink" : "border-line bg-surface text-dim hover:bg-raise hover:text-fg"
          }`}
        >
          {c.tone && !c.active && <span className={`size-1.5 rounded-full ${c.tone === "err" ? "bg-err" : c.tone === "warn" ? "bg-warn" : "bg-ok"}`} />}
          {c.label}
          {c.count !== undefined && <span className={`tnum font-mono text-[10.5px] ${c.active ? "opacity-70" : "text-faint"}`}>{fmt(c.count)}</span>}
        </button>
      ))}
    </div>
  );
}

export function FilterBar({ children, count, onClear }: { children: ReactNode; count: number; onClear: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {children}
      {count > 0 && (
        <>
          <div className="grow" />
          <button
            type="button"
            onClick={onClear}
            className="focusable inline-flex h-7 items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 text-[12px] font-medium text-dim whitespace-nowrap transition-colors duration-100 hover:bg-raise hover:text-fg"
          >
            Clear {count} filter{count === 1 ? "" : "s"}
            <span aria-hidden className="text-faint">×</span>
          </button>
        </>
      )}
    </div>
  );
}

export function MoreFilters({ children, open = false }: { children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group flex flex-col gap-2">
      <summary className="focusable inline-flex h-7 w-fit cursor-pointer list-none items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 text-[12px] font-medium text-dim transition-colors duration-100 hover:bg-raise hover:text-fg [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-[10px] text-faint transition-transform group-open:rotate-90">▶</span>
        More filters
      </summary>
      <div className="flex flex-col gap-2 border-l border-line pt-2 pl-3">{children}</div>
    </details>
  );
}

export function ActiveFilters({ items, onClear }: { items: { key: string; label: string }[]; onClear: (key: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[11px] font-medium text-faint">Filtered by</span>
      {items.map((f) => (
        <button key={f.key} type="button" onClick={() => onClear(f.key)} className="focusable inline-flex items-center gap-1.5 rounded-sm border border-line-strong bg-raise px-2 py-1 text-[11.5px] font-medium text-fg hover:bg-sunken" title="Remove this filter">
          {f.label}
          <span aria-hidden className="text-faint">×</span>
        </button>
      ))}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder, width = "w-[300px]" }: { value: string; onChange: (v: string) => void; placeholder: string; width?: string }) {
  return (
    <span className={`relative ${width} max-w-full`}>
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint" aria-hidden>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="focusable h-7 w-full rounded-sm border border-line bg-canvas pr-2 pl-7 text-[12px] text-fg placeholder:text-ghost" />
    </span>
  );
}
