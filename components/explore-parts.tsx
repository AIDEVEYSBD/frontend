"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { Button } from "./ui";
import { ActiveFilters, SearchBox } from "./filters";
import { CAT } from "./charts";
import { count } from "./observability-shared";
import { winMs, type Win } from "./window-pick";

/**
 * What every view of Explore shares: the address as the one place a filter is
 * kept, the fold from records to facet counts, the timeline that narrows by
 * a dragged span, and the filter rail.
 *
 * Nothing here reads a door. A view hands over the records it read and says
 * which of their own fields are facets; the counts in the rail, the bars of
 * the timeline and the rows of the list are all cut from those records.
 */

/* ═══════════════════ the address ═══════════════════ */

export type ViewId = "tools" | "activity" | "security";

export const VIEWS: { id: ViewId; label: string; what: string }[] = [
  { id: "tools", label: "Tool calls", what: "Every tool call in the journals read: when it was made, by which agent at which step, how it ended and how long it took. A row opens the run at that entry." },
  { id: "activity", label: "Agent activity", what: "What each agent did: its runs, steps, model calls, tool calls and failed runs, and what happened on those runs. An event opens the run at that entry." },
  { id: "security", label: "Security events", what: "What the controls did and what people did about it: refusals, screening blocks and flags, gates, operator kills and lockdown changes. A row opens the run at that entry." },
];

/** Parameters that belong to the page, not to one view's filters. */
const PAGE_KEYS = new Set(["view", "window"]);

export interface Span {
  from: number;
  to: number;
}

export interface Address {
  /** The query string, as the key a memo can depend on. */
  key: string;
  all: (id: string) => string[];
  one: (id: string) => string;
  span: Span | null;
  toggle: (id: string, value: string) => void;
  /** Set a parameter to exactly these values; none removes it. */
  set: (id: string, values: string[]) => void;
  setSpan: (s: Span | null) => void;
  /** Drop every filter of the view: facets, search and span. The view and the window stay. */
  clear: () => void;
  /** Move to another view. Filters belong to a view, so they are dropped; the window stays. */
  go: (view: ViewId) => void;
  /** Pick the window. A span was dragged on the old window's bars, so it goes. */
  window: (w: Win) => void;
}

/**
 * The address as state. Changes go through `history.replaceState`, which the
 * router follows (`useSearchParams` re-reads), so a filter never asks the
 * server for anything and a filtered view can be copied as a link.
 */
export function useAddress(): Address {
  const params = useSearchParams();
  const key = params.toString();
  const write = useCallback((change: (p: URLSearchParams) => void) => {
    const p = new URLSearchParams(window.location.search);
    change(p);
    const s = p.toString();
    window.history.replaceState(null, "", s ? `/explore?${s}` : "/explore");
  }, []);
  return useMemo(() => {
    const p = new URLSearchParams(key);
    const from = Number(p.get("from"));
    const to = Number(p.get("to"));
    const set = (id: string, values: string[]) =>
      write((q) => {
        q.delete(id);
        for (const v of values) q.append(id, v);
      });
    return {
      key,
      all: (id) => p.getAll(id),
      one: (id) => p.get(id) ?? "",
      span: Number.isFinite(from) && Number.isFinite(to) && from > 0 && to > from ? { from, to } : null,
      set,
      toggle: (id, value) =>
        write((q) => {
          const now = q.getAll(id);
          q.delete(id);
          for (const v of now.includes(value) ? now.filter((x) => x !== value) : [...now, value]) q.append(id, v);
        }),
      setSpan: (s) =>
        write((q) => {
          q.delete("from");
          q.delete("to");
          if (s) {
            q.set("from", String(s.from));
            q.set("to", String(s.to));
          }
        }),
      clear: () =>
        write((q) => {
          for (const k of [...q.keys()]) if (!PAGE_KEYS.has(k)) q.delete(k);
        }),
      go: (view) =>
        write((q) => {
          const win = q.get("window");
          for (const k of [...q.keys()]) q.delete(k);
          q.set("view", view);
          if (win) q.set("window", win);
        }),
      window: (w) =>
        write((q) => {
          q.set("window", w);
          q.delete("from");
          q.delete("to");
        }),
    };
  }, [key, write]);
}

/* ═══════════════════ facets ═══════════════════ */

type Tone = "ok" | "warn" | "err";

/** One field of a record that the rail can filter on. `id` is its parameter in the address. */
export interface FacetDef<T> {
  id: string;
  label: string;
  /** The values a record carries for this field; none when it carries nothing. */
  of: (r: T) => readonly string[];
  /** A value in words. */
  name?: (value: string) => string;
  tone?: (value: string) => Tone | undefined;
  /** A fixed order for the values; otherwise the most frequent comes first. */
  order?: readonly string[];
}

export interface FacetValue {
  value: string;
  label: string;
  count: number;
  on: boolean;
  tone?: Tone;
}

export interface FacetView {
  id: string;
  label: string;
  values: FacetValue[];
}

export interface Narrowed<T> {
  /** Search, facets and span applied: what the list shows. */
  list: T[];
  /** Search and facets applied, the span not: what the timeline counts. */
  timeline: T[];
  /** One entry per facet that has a value: the count beside a value is what picking it would list. */
  facets: FacetView[];
  /** What is set, as removable chips. */
  chips: { key: string; label: string }[];
  /** Search, span and every facet but one applied. */
  except: (id: string) => T[];
}

/**
 * Cut `records` by what the address holds. A value's count is taken with its
 * own facet left out, so the values of one facet add up to what the others
 * leave and picking a second value widens rather than empties.
 */
export function narrow<T>(
  records: readonly T[],
  defs: readonly FacetDef<T>[],
  address: Address,
  /** When a record happened, for the span; null for records the span does not cut. */
  at: ((r: T) => number) | null,
  /** What the search reads of a record; null for records the search does not cut. */
  text: ((r: T) => string) | null,
): Narrowed<T> {
  const chosen = new Map(defs.map((d) => [d.id, new Set(address.all(d.id))]));
  const needle = text ? address.one("q").trim().toLowerCase() : "";
  const s = at ? address.span : null;
  const passes = (r: T, skip?: string) =>
    defs.every((d) => {
      const set = chosen.get(d.id)!;
      return d.id === skip || !set.size || d.of(r).some((v) => set.has(v));
    });
  const searched = needle && text ? records.filter((r) => text(r).toLowerCase().includes(needle)) : [...records];
  const spanned = s && at ? searched.filter((r) => at(r) >= s.from && at(r) < s.to) : searched;
  const except = (id: string) => spanned.filter((r) => passes(r, id));

  const facets: FacetView[] = [];
  const chips: { key: string; label: string }[] = [];
  for (const d of defs) {
    const set = chosen.get(d.id)!;
    const tally = new Map<string, number>();
    for (const r of except(d.id)) for (const v of new Set(d.of(r))) tally.set(v, (tally.get(v) ?? 0) + 1);
    // A value picked from a link that nothing carries any more still shows, at zero, so it can be removed.
    for (const v of set) if (!tally.has(v)) tally.set(v, 0);
    const rank = (v: string) => {
      const i = d.order ? d.order.indexOf(v) : -1;
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    const values = [...tally.entries()]
      .sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([value, n]) => ({ value, label: d.name?.(value) || value || "(unnamed)", count: n, on: set.has(value), tone: d.tone?.(value) }));
    if (values.length) facets.push({ id: d.id, label: d.label, values });
    for (const v of set) chips.push({ key: `${d.id}\u0000${v}`, label: `${d.label}: ${d.name?.(v) || v || "(unnamed)"}` });
  }
  return { list: spanned.filter((r) => passes(r)), timeline: searched.filter((r) => passes(r)), facets, chips, except };
}

/** Remove what a chip stands for. Facet chips are keyed `${facet}\0${value}`. */
export function dropChip(address: Address, key: string) {
  if (key === "q") address.set("q", []);
  else if (key === "span") address.setSpan(null);
  else {
    const [id, value] = key.split("\u0000");
    address.toggle(id, value);
  }
}

/** The search and the span as chips, beside a view's facet chips. */
export function pageChips(address: Address): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  const q = address.one("q").trim();
  if (q) out.push({ key: "q", label: `Search: ${q}` });
  if (address.span) out.push({ key: "span", label: `Time: ${spanText(address.span)}` });
  return out;
}

/* ═══════════════════ the timeline's buckets ═══════════════════ */

export interface Bucket {
  from: number;
  to: number;
  total: number;
  flagged: number;
}

export interface Domain {
  start: number;
  step: number;
  n: number;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** A window's bar: 48 half hours, 56 three-hour bars, 60 half days, 90 days. */
const STEP: Record<Exclude<Win, "all">, number> = { "24h": 30 * MIN, "7d": 3 * HOUR, "30d": 12 * HOUR, "90d": DAY };
const STEPS = [5 * MIN, 15 * MIN, 30 * MIN, HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY, 30 * DAY, 90 * DAY, 365 * DAY];
/** Bars across the widest timeline. */
const MAX_BARS = 96;

/**
 * The timeline's axis for a window: bars of one size ending at the present,
 * on local clock edges so a span in a link lands on the same bars later.
 * A record older than the window (a call early in a run that ended inside
 * it) widens the axis rather than being left off it.
 */
export function domainOf(win: Win, now: number, times: readonly number[]): Domain | null {
  const known = times.filter((t) => t > 0);
  if (!known.length) return null;
  const oldest = Math.min(...known);
  const newest = Math.max(now, ...known);
  const zone = new Date(now).getTimezoneOffset() * MIN;
  const edge = (t: number, step: number, up: boolean) => (up ? Math.ceil((t - zone) / step) : Math.floor((t - zone) / step)) * step + zone;
  const fit = (step: number): Domain => {
    const end = edge(newest, step, true);
    const start = edge(win === "all" ? oldest : Math.min(oldest, now - winMs(win)), step, false);
    return { start, step, n: Math.max(1, Math.round((end - start) / step)) };
  };
  let step = win === "all" ? STEPS[0] : STEP[win];
  let d = fit(step);
  for (const next of STEPS) {
    if (d.n <= MAX_BARS) break;
    if (next <= step) continue;
    step = next;
    d = fit(step);
  }
  return d;
}

/** Count records into the axis's bars. A record with no time is on no bar. */
export function fill<T>(domain: Domain, records: readonly T[], at: (r: T) => number, flagged: (r: T) => boolean): Bucket[] {
  const out: Bucket[] = Array.from({ length: domain.n }, (_, i) => ({ from: domain.start + i * domain.step, to: domain.start + (i + 1) * domain.step, total: 0, flagged: 0 }));
  for (const r of records) {
    const t = at(r);
    if (!t) continue;
    const b = out[Math.min(domain.n - 1, Math.max(0, Math.floor((t - domain.start) / domain.step)))];
    b.total += 1;
    if (flagged(r)) b.flagged += 1;
  }
  return out;
}

const stamp = (ms: number, day: boolean) =>
  new Date(ms).toLocaleString("en-GB", day ? { day: "2-digit", month: "short" } : { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

/** A span in words. Whole days read as days. */
export function spanText(s: Span): string {
  const whole = (s.to - s.from) % DAY === 0 && new Date(s.from).getHours() === 0 && new Date(s.from).getMinutes() === 0;
  if (whole) return s.to - s.from === DAY ? stamp(s.from, true) : `${stamp(s.from, true)} to ${stamp(s.to - 1, true)}`;
  return `${stamp(s.from, false)} to ${stamp(s.to, false)}`;
}

const stepText = (ms: number): string => {
  if (ms % DAY === 0) return ms === DAY ? "one day" : `${ms / DAY} days`;
  if (ms % HOUR === 0) return ms === HOUR ? "one hour" : `${ms / HOUR} hours`;
  return `${ms / MIN} minutes`;
};

/* ═══════════════════ the timeline ═══════════════════ */

const BAR = CAT[1];
const FLAG = "var(--color-err)";

/**
 * A histogram of the view's records over the window: one bar per bucket, the
 * flagged ones (failures, refusals) as the red top of the bar. Dragging across
 * it sets the span every list below is narrowed to; a click sets one bar.
 * From the keyboard: the arrow keys choose a bar and move the span, Shift
 * with an arrow widens or shortens it, Escape clears it.
 */
export function Timeline({
  buckets,
  step,
  span,
  onSpan,
  nouns,
  flagNoun,
  title,
  untimed = 0,
  note,
}: {
  buckets: Bucket[];
  step: number;
  span: Span | null;
  onSpan: (s: Span | null) => void;
  /** What a bar counts, one and many: ["call", "calls"]. */
  nouns: [string, string];
  /** What the red part counts: "refused or failed". */
  flagNoun: string;
  title: string;
  /** Records with no recorded time, which no bar can hold. */
  untimed?: number;
  /** What the bars were counted from, when it is less than the whole window. */
  note?: string;
}) {
  const plot = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const n = buckets.length;
  const peak = Math.max(1, ...buckets.map((b) => b.total));
  const total = buckets.reduce((s, b) => s + b.total, 0);
  const day = step % DAY === 0;

  // The bars a span covers. A span from a link need not sit on bar edges.
  const chosen = useMemo(() => {
    if (!span) return null;
    let lo = -1;
    let hi = -1;
    buckets.forEach((b, i) => {
      if (b.from < span.to && b.to > span.from) {
        if (lo < 0) lo = i;
        hi = i;
      }
    });
    return lo < 0 ? null : { lo, hi };
  }, [span, buckets]);
  const live = drag ? { lo: Math.min(drag.a, drag.b), hi: Math.max(drag.a, drag.b) } : chosen;
  const put = (lo: number, hi: number) => onSpan({ from: buckets[lo].from, to: buckets[hi].to });

  const indexAt = (x: number): number => {
    const box = plot.current?.getBoundingClientRect();
    if (!box || !box.width) return 0;
    return Math.min(n - 1, Math.max(0, Math.floor(((x - box.left) / box.width) * n)));
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const i = indexAt(e.clientX);
    setDrag({ a: i, b: i });
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const i = indexAt(e.clientX);
    setHover(i);
    if (drag && drag.b !== i) setDrag({ a: drag.a, b: i });
  };
  const up = () => {
    if (!drag) return;
    const lo = Math.min(drag.a, drag.b);
    const hi = Math.max(drag.a, drag.b);
    setDrag(null);
    // A click on the one bar already chosen lets it go.
    if (lo === hi && chosen && chosen.lo === lo && chosen.hi === hi) onSpan(null);
    else put(lo, hi);
  };
  const keys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      if (span) {
        e.preventDefault();
        onSpan(null);
      }
      return;
    }
    const dir = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0;
    if (!dir && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    if (!chosen) {
      // Start on the most recent bar that holds something; on the last bar when none does.
      let i = n - 1;
      while (i >= 0 && !buckets[i].total) i -= 1;
      if (i < 0) i = n - 1;
      if (e.key === "Home") i = 0;
      if (e.key === "End") i = n - 1;
      put(i, i);
      return;
    }
    const width = chosen.hi - chosen.lo;
    if (e.key === "Home") put(0, width);
    else if (e.key === "End") put(n - 1 - width, n - 1);
    else if (e.shiftKey) put(chosen.lo, Math.min(n - 1, Math.max(chosen.lo, chosen.hi + dir)));
    else {
      const lo = Math.min(n - 1 - width, Math.max(0, chosen.lo + dir));
      put(lo, lo + width);
    }
  };

  const tip = hover !== null && !drag ? buckets[hover] : null;
  const inSpan = live ? buckets.slice(live.lo, live.hi + 1) : [];
  const spanTotal = inSpan.reduce((s, b) => s + b.total, 0);
  const shown = live ? { from: buckets[live.lo].from, to: buckets[live.hi].to } : null;
  const flaggedAny = buckets.some((b) => b.flagged > 0);

  return (
    <section className="flex min-w-0 flex-col rounded-lg border border-line bg-surface elev-1" aria-label="Timeline" data-explore-timeline>
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1.5 rounded-t-lg border-b border-line bg-raise/55 px-4 py-2">
        <h2 className="text-[12.5px] font-semibold whitespace-nowrap text-fg">{title}</h2>
        <span className="flex items-center gap-3 text-[11px] text-dim">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-[2px]" style={{ background: BAR }} aria-hidden />
            {nouns[1]}
          </span>
          {flaggedAny && (
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-[2px]" style={{ background: FLAG }} aria-hidden />
              {flagNoun}
            </span>
          )}
        </span>
        <span className="grow" />
        {shown ? (
          <span className="flex flex-wrap items-center gap-2" aria-live="polite">
            <span className="text-[11.5px] text-fg">
              <span className="font-medium">{spanText(shown)}</span>
              <span className="text-faint">
                {" "}
                · {count(spanTotal)} {nouns[spanTotal === 1 ? 0 : 1]}
              </span>
            </span>
            {span && !drag && (
              <Button size="sm" variant="solid" tone="neutral" onClick={() => onSpan(null)}>
                Clear span
              </Button>
            )}
          </span>
        ) : (
          <span className="text-[11px] text-faint">Drag across the bars to narrow the list to a span.</span>
        )}
      </div>

      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1.5 px-4 pt-3.5 pb-2.5">
        {/* The scale: the tallest bar's count, level with the top rule. */}
        <span className="-mt-[3px] text-right font-mono text-[9.5px] leading-none text-faint" aria-hidden>
          {count(peak)}
        </span>
        <div className="relative">
          <div
            ref={plot}
            tabIndex={0}
            role="group"
            aria-label={`${title}: ${count(total)} ${nouns[total === 1 ? 0 : 1]} in ${n} bars of ${stepText(step)}. Left and right arrows choose a bar and move the span, Shift with an arrow widens or shortens it, Escape clears it.`}
            onKeyDown={keys}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={() => setDrag(null)}
            onPointerLeave={() => setHover(null)}
            className="focusable flex h-16 cursor-crosshair touch-none items-stretch gap-[2px] rounded-[3px] border-t border-b border-t-line border-b-line-strong select-none"
            data-timeline-plot
          >
            {buckets.map((b, i) => {
              const on = live ? i >= live.lo && i <= live.hi : false;
              const rest = b.total - b.flagged;
              return (
                <span key={b.from} className={`flex min-w-0 flex-1 flex-col justify-end gap-[2px] ${on ? "bg-raise" : hover === i ? "bg-raise/60" : ""}`} style={live && !on ? { opacity: 0.32 } : undefined} data-bar={b.total || undefined}>
                  {b.flagged > 0 && <span className="min-h-[2px] rounded-t-[2px]" style={{ height: `${(b.flagged / peak) * 100}%`, background: FLAG }} />}
                  {rest > 0 && <span className={`min-h-[2px] ${b.flagged > 0 ? "" : "rounded-t-[2px]"}`} style={{ height: `${(rest / peak) * 100}%`, background: BAR }} />}
                </span>
              );
            })}
          </div>
          {tip && hover !== null && (
            <span
              role="status"
              className="pointer-events-none absolute bottom-full z-20 mb-1 flex flex-col gap-0.5 rounded-md border border-line bg-surface px-2.5 py-1.5 whitespace-nowrap elev-2"
              style={hover < n * 0.2 ? { left: `${(hover / n) * 100}%` } : hover > n * 0.8 ? { right: `${((n - 1 - hover) / n) * 100}%` } : { left: `${((hover + 0.5) / n) * 100}%`, transform: "translateX(-50%)" }}
            >
              <span className="text-[10.5px] text-faint">{spanText({ from: tip.from, to: tip.to })}</span>
              <span className="text-[11.5px] font-medium text-fg">
                {count(tip.total)} {nouns[tip.total === 1 ? 0 : 1]}
                {tip.flagged > 0 && (
                  <span className="font-normal text-dim">
                    {" "}
                    · {count(tip.flagged)} {flagNoun}
                  </span>
                )}
              </span>
            </span>
          )}
        </div>
        <span aria-hidden />
        <div className="flex justify-between gap-3 font-mono text-[9.5px] text-faint">
          <span>{stamp(buckets[0].from, day)}</span>
          <span className="truncate font-sans text-[10.5px]">
            One bar is {stepText(step)}
            {note ? ` · ${note}` : ""}
            {untimed > 0 ? ` · ${count(untimed)} with no recorded time ${untimed === 1 ? "is" : "are"} on no bar` : ""}
          </span>
          <span>{stamp(buckets[n - 1].to, day)}</span>
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════ the rail ═══════════════════ */

export interface RailSection {
  /** Said above the facets when a view filters more than one kind of record. */
  title?: string;
  facets: FacetView[];
}

/** Values drawn for a facet before "Show all". */
const FOLD = 6;

function Facet({ facet, onToggle }: { facet: FacetView; onToggle: (id: string, value: string) => void }) {
  const [all, setAll] = useState(false);
  // What is picked stays in view, whatever its rank.
  const head = facet.values.slice(0, FOLD);
  const tail = facet.values.slice(FOLD);
  const values = all ? facet.values : [...head, ...tail.filter((v) => v.on)];
  const hidden = facet.values.length - values.length;
  return (
    <fieldset className="flex min-w-0 flex-col gap-0.5" data-facet={facet.id}>
      <legend className="mb-1 px-1.5 text-[11px] font-medium text-faint">{facet.label}</legend>
      {values.map((v) => (
        <button
          key={v.value}
          type="button"
          role="checkbox"
          aria-checked={v.on}
          onClick={() => onToggle(facet.id, v.value)}
          title={v.label}
          data-value={v.value}
          className={`focusable flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-left transition-colors duration-100 ${v.on ? "bg-raise" : "hover:bg-raise/60"}`}
        >
          <span className={`grid size-3.5 shrink-0 place-items-center rounded-[3px] border ${v.on ? "border-transparent bg-ink text-on-ink" : "border-line-strong bg-surface"}`} aria-hidden>
            {v.on && (
              <svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m2.5 6.5 2.5 2.5 4.5-5.5" />
              </svg>
            )}
          </span>
          {v.tone && <span className={`size-1.5 shrink-0 rounded-[2px] ${v.tone === "err" ? "bg-err" : v.tone === "warn" ? "bg-warn" : "bg-ok"}`} aria-hidden />}
          <span className={`min-w-0 grow truncate text-[12px] ${v.on ? "font-medium text-fg" : "text-mist"}`}>{v.label}</span>
          <span className="tnum shrink-0 font-mono text-[10.5px] text-faint">{count(v.count)}</span>
        </button>
      ))}
      {(hidden > 0 || all) && facet.values.length > FOLD && (
        <span className="px-1.5 pt-1">
          <Button size="sm" variant="quiet" tone="neutral" onClick={() => setAll((a) => !a)}>
            {all ? "Show fewer" : `Show all ${count(facet.values.length)}`}
          </Button>
        </span>
      )}
    </fieldset>
  );
}

function RailBody({ sections, onToggle, search, onSearch, placeholder }: { sections: RailSection[]; onToggle: (id: string, value: string) => void; search: string; onSearch: (v: string) => void; placeholder: string }) {
  return (
    <div className="flex flex-col gap-4">
      <SearchBox value={search} onChange={onSearch} placeholder={placeholder} width="w-full" />
      {sections
        .filter((s) => s.facets.length > 0)
        .map((s, i) => (
          <div key={s.title ?? i} className="flex flex-col gap-3.5">
            {s.title && <span className="border-t border-line px-1.5 pt-3 text-[11.5px] font-semibold text-fg">{s.title}</span>}
            {s.facets.map((f) => (
              <Facet key={f.id} facet={f} onToggle={onToggle} />
            ))}
          </div>
        ))}
    </div>
  );
}

/**
 * A view's frame: the timeline across the top, the filter rail on the left
 * and the view's own body beside it, with what is set as removable chips.
 * Under 1100 wide the rail folds into a "Filters" button that opens it as a
 * panel.
 */
export function ExploreFrame({
  timeline,
  sections,
  address,
  chips,
  placeholder,
  shown,
  children,
}: {
  timeline: ReactNode;
  sections: RailSection[];
  address: Address;
  chips: { key: string; label: string }[];
  placeholder: string;
  /** What the list holds now, in words, for the panel's close button: "128 calls". */
  shown: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const esc = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // The panel is for narrow pages only: a page widened past the fold has its rail back.
    const wide = window.matchMedia("(min-width: 1100px)");
    const close = () => {
      if (wide.matches) setOpen(false);
    };
    window.addEventListener("keydown", esc);
    wide.addEventListener("change", close);
    return () => {
      window.removeEventListener("keydown", esc);
      wide.removeEventListener("change", close);
    };
  }, [open]);

  const search = address.one("q");
  const body = <RailBody sections={sections} onToggle={address.toggle} search={search} onSearch={(v) => address.set("q", v ? [v] : [])} placeholder={placeholder} />;
  const clearAll = (
    <Button size="sm" variant="solid" tone="neutral" onClick={address.clear}>
      Clear {chips.length} filter{chips.length === 1 ? "" : "s"}
    </Button>
  );

  return (
    <>
      {timeline}
      <div className="grid min-w-0 items-start gap-4 min-[1100px]:grid-cols-[216px_minmax(0,1fr)]">
        <aside aria-label="Filters" className="sticky top-4 hidden max-h-[calc(100dvh-6rem)] flex-col overflow-y-auto rounded-lg border border-line bg-surface p-2.5 elev-1 min-[1100px]:flex" data-explore-rail>
          {body}
        </aside>

        <div className="@container flex min-w-0 flex-col gap-4">
          <div className={`flex flex-wrap items-center gap-x-3 gap-y-2 ${chips.length ? "" : "min-[1100px]:hidden"}`}>
            <span className="min-[1100px]:hidden">
              <Button size="sm" variant="solid" tone="ink" onClick={() => setOpen(true)}>
                Filters{chips.length ? ` · ${chips.length}` : ""}
              </Button>
            </span>
            <ActiveFilters items={chips} onClear={(key) => dropChip(address, key)} />
            {chips.length > 0 && (
              <>
                <span className="grow" />
                {clearAll}
              </>
            )}
          </div>
          {children}
        </div>
      </div>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex min-[1100px]:hidden">
            <button type="button" aria-label="Close the filters" onClick={() => setOpen(false)} className="absolute inset-0 cursor-default bg-black/45" />
            <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Filters" className="relative flex h-full w-[300px] max-w-[88vw] flex-col bg-surface elev-3 outline-none" data-explore-panel>
              <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3.5">
                <span className="text-[13px] font-semibold text-fg">Filters</span>
                <span className="grow" />
                {chips.length > 0 && clearAll}
              </div>
              <div className="min-h-0 grow overflow-y-auto p-2.5">{body}</div>
              <div className="shrink-0 border-t border-line p-2.5">
                <Button size="md" variant="solid" tone="ink" full onClick={() => setOpen(false)}>
                  Show {shown}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/* ═══════════════════ the view switch ═══════════════════ */

/** The kind of record being read. Segmented and solid: the view in force is ink. */
export function ViewSwitch({ value, onChange }: { value: ViewId; onChange: (v: ViewId) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="inline-flex w-fit max-w-full shrink-0 items-center gap-0.5 overflow-x-auto rounded-md border border-line bg-raise p-0.5" role="radiogroup" aria-label="What to read">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={value === v.id}
            onClick={() => onChange(v.id)}
            className={`focusable h-8 cursor-pointer rounded-[5px] px-3.5 text-[12.5px] font-medium whitespace-nowrap transition-colors duration-100 ${value === v.id ? "bg-ink text-on-ink" : "bg-surface text-dim hover:text-fg"}`}
          >
            {v.label}
          </button>
        ))}
      </div>
      <p className="max-w-[96ch] min-w-[min(100%,36ch)] flex-1 text-[12px] leading-[1.5] text-dim">{VIEWS.find((v) => v.id === value)?.what}</p>
    </div>
  );
}
