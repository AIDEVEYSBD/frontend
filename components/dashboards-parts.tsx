"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BarSpark } from "./data";

/**
 * The Dashboards page's own pieces. The cards, figure tiles and ranked lists
 * are the Overview page's (components/overview-parts.tsx); what is here is
 * the board switch and a column chart for a value that is not a failure
 * count (that chart's frame, `TrendBars`, is worded and toned for failures).
 */

/* ═══════════════════ board switch ═══════════════════ */

/** One board at a time: a segmented control, every segment a solid fill. */
export function BoardSwitch<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[] }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-line-strong bg-raise p-0.5" role="radiogroup" aria-label="Board">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`focusable h-8 cursor-pointer rounded-[5px] px-3.5 text-[12.5px] font-medium whitespace-nowrap transition-colors ${
            value === o.id ? "bg-ink text-on-ink" : "bg-surface text-dim hover:bg-canvas hover:text-fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

/** A line of plain text between the switch and the figures: an empty window, a deployment with no runs. */
export function BoardNote({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface px-3 py-2">
      <p className="min-w-0 grow text-[12px] leading-[1.5] text-dim">{children}</p>
      {action}
    </div>
  );
}

/* ═══════════════════ value per bucket ═══════════════════ */

/**
 * A value per bucket of time as columns, at the width of its card, in the
 * Overview page's chart style (`BarSpark` in a measured frame, the first
 * bucket's date and "now" under it). Each column answers a pointer with its
 * bucket and its figure; `describe` says what the chart is for a screen reader.
 */
export function ValueBars({ points, titles, from, to, describe }: { points: number[]; /** One per point: the bucket and its figure, in words. */ titles: string[]; from: string; to: string; describe: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    measure.observe(el);
    return () => measure.disconnect();
  }, []);
  const peak = Math.max(...points);
  return (
    <div className="flex flex-col gap-1.5">
      <div ref={frame} className="relative h-12 border-b border-line-strong" role="img" aria-label={`${describe}, oldest first: ${titles.join("; ")}`}>
        {width > 0 && peak > 0 && <BarSpark points={points} width={width} height={48} tone="ink" />}
        {/* The pointer's targets: one per column, the full height of the frame, on the columns' own grid (equal widths, a 2px gap). */}
        <div className="absolute inset-0 flex gap-[2px]" aria-hidden>
          {titles.map((t, i) => (
            <span key={i} title={t} className="h-full min-w-0 flex-1 rounded-[1px] hover:bg-fg/[0.06]" />
          ))}
        </div>
      </div>
      <div className="flex justify-between font-mono text-[9.5px] text-faint">
        <span>{from}</span>
        <span>{to}</span>
      </div>
    </div>
  );
}
