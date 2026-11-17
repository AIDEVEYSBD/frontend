"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { hueFor } from "@/lib/hue";
import { BarSpark } from "./data";
import { CAT } from "./charts";
import type { RankRow } from "./overview-data";

/**
 * The Overview page's pieces: a card with a header, a body and a footer, the
 * switch between a ranking's two measures, a ranked list, a figure tile and
 * the failure chart's frame. No data is read here.
 */

/* ═══════════════════ card ═══════════════════ */

export function Card({
  title,
  hue,
  meta,
  action,
  footer,
  children,
}: {
  title: string;
  /** What the header's hue follows, when the title alone would not say. */
  hue?: string;
  meta?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1" aria-label={title}>
      <div data-hue={hueFor((hue ?? title).toLowerCase())} className="flex h-11 shrink-0 items-center gap-2 border-b border-line bg-raise/55 px-4">
        <h2 className="text-[12.5px] font-semibold whitespace-nowrap text-fg">{title}</h2>
        {meta && <span className="min-w-0 truncate text-[11px] text-faint">{meta}</span>}
        <span className="grow" />
        {action}
      </div>
      <div className="flex min-h-0 grow flex-col">{children}</div>
      {footer && <div className="flex min-h-11 shrink-0 items-center gap-2 border-t border-line px-4 py-2">{footer}</div>}
    </section>
  );
}

/** What a card's body says when it has nothing to list: one plain line where the rows would be. */
export function Nothing({ children }: { children: ReactNode }) {
  return <p className="px-4 py-5 text-[12px] leading-[1.55] text-faint">{children}</p>;
}

/** A read that failed, said plainly in the card it belongs to. */
export function ReadError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="px-4 py-5 text-[12px] leading-[1.55] text-err">
      {children}
    </p>
  );
}

/** A footer's caption: what the card counted. */
export function FootNote({ children }: { children: ReactNode }) {
  return <span className="min-w-0 grow truncate text-[11px] text-faint">{children}</span>;
}

/* ═══════════════════ measure switch ═══════════════════ */

export function MeasureSwitch<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[]; label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-px rounded-sm border border-line bg-canvas p-px" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`focusable cursor-pointer rounded-[3px] px-2 py-0.5 text-[11px] font-medium transition-colors ${value === o.id ? "bg-ink text-on-ink" : "text-faint hover:text-fg"}`}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

/* ═══════════════════ ranked list ═══════════════════ */

/**
 * Rank, name, a bar proportional to the leader, the figure. The rows share
 * one grid, so the figure column is as wide as its widest figure, every bar
 * starts on the same edge and sits on a track of the same length.
 */
export function RankList({ rows, format, measure }: { rows: RankRow[]; format: (v: number) => string; /** What the figure counts, for a screen reader. */ measure: string }) {
  const lead = rows[0]?.value ?? 0;
  return (
    <ol className="grid grid-cols-[auto_minmax(0,1.5fr)_minmax(0,1fr)_auto] gap-x-3 px-4 py-1">
      {rows.map((r, i) => (
        <li key={r.key} className="col-span-4 grid h-9 grid-cols-subgrid items-center border-b border-line last:border-0">
          <span className="tnum w-3 font-mono text-[10.5px] text-faint">{i + 1}</span>
          {r.href ? (
            <Link href={r.href} title={r.label} className={`focusable truncate rounded-sm text-mist hover:text-fg hover:underline ${r.code ? "font-mono text-[11px]" : "text-[12px]"}`}>
              {r.label}
            </Link>
          ) : (
            <span title={r.label} className={`truncate text-mist ${r.code ? "font-mono text-[11px]" : "text-[12px]"}`}>
              {r.label}
            </span>
          )}
          <span className="block h-1.5 overflow-hidden rounded-[2px] bg-raise" aria-hidden>
            <span className="block h-full min-w-[2px] rounded-[2px]" style={{ width: `${lead > 0 ? (r.value / lead) * 100 : 0}%`, background: CAT[1] }} />
          </span>
          <span className="tnum min-w-7 text-right font-mono text-[11px] text-dim" aria-label={`${format(r.value)} ${measure}`}>
            {format(r.value)}
          </span>
        </li>
      ))}
    </ol>
  );
}

/* ═══════════════════ figure tile ═══════════════════ */

/** One figure of the band, as a link to the page behind it. */
export function FigureTile({
  label,
  chip,
  value,
  off = false,
  sub,
  href,
  tone,
}: {
  label: string;
  /** The window the figure is cut over; none for a figure that is about now. */
  chip?: string;
  /** The figure, or null while it is being read (or could not be). */
  value: string | null;
  /** A quiet console whose read failed: the tile says it is not connected, with no figure and no reason. */
  off?: boolean;
  sub: string;
  href: string;
  /** A tone on the figure, only when the state warrants it. */
  tone?: "run" | "warn" | "err";
}) {
  return (
    <Link href={href} className="focusable -mr-px -mb-px flex min-w-0 flex-col gap-1.5 border-r border-b border-line px-4 py-3 hover:bg-raise/50">
      <span className="flex items-center gap-1.5">
        <span className="truncate text-[11px] text-faint">{label}</span>
        {chip && <span className="rounded-[3px] border border-line bg-canvas px-1 font-mono text-[9px] leading-[14px] text-dim">{chip}</span>}
      </span>
      {off && value === null ? (
        <span className="flex h-[22px] items-center text-[12px] text-faint">Not connected</span>
      ) : (
        <span className="tnum text-[22px] leading-none font-semibold tracking-[-0.02em]" style={tone && value !== null ? { color: `var(--color-${tone})` } : undefined}>
          {value ?? "—"}
        </span>
      )}
      <span className="truncate text-[10.5px] text-ghost">{off && value === null ? "\u00a0" : sub}</span>
    </Link>
  );
}

/** A figure inside a card (p50, p95, failed runs). */
export function CardFigure({ label, value, tone }: { label: string; value: string; tone?: "err" }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[11px] text-faint">{label}</span>
      <span className="tnum text-[22px] leading-none font-semibold tracking-[-0.02em]" style={tone ? { color: `var(--color-${tone})` } : undefined}>
        {value}
      </span>
    </div>
  );
}

/* ═══════════════════ failure chart ═══════════════════ */

/** The column chart at the width of its card: `BarSpark` draws to a pixel width, so the frame is measured. */
export function TrendBars({ points, from, to }: { points: number[]; from: string; to: string }) {
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
      <div ref={frame} className="h-12 border-b border-line-strong" role="img" aria-label={`Failed runs per bucket, oldest first: ${points.join(", ")}`}>
        {width > 0 && peak > 0 && <BarSpark points={points} width={width} height={48} tone="err" />}
      </div>
      <div className="flex justify-between font-mono text-[9.5px] text-faint">
        <span>{from}</span>
        <span>{to}</span>
      </div>
    </div>
  );
}
