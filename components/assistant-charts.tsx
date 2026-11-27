"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Donut, LineChart, RankBar, StackedBar } from "./charts";
import { DataTable } from "./markdown";

/**
 * Charts the assistant can draw.
 *
 * The model emits a fenced ```chart block carrying one JSON object; the
 * renderer turns it into the same chart primitives the console uses, in the
 * same palette, so a chart in the conversation looks like a chart on the
 * page. The object is model output, and the model may have read a poisoned
 * document, so `parseChart` checks it field by field before anything is
 * drawn: a field of the wrong shape refuses the chart with the field named,
 * and a value that is not a number is never drawn as zero. A block still
 * being streamed shows as "drawing" until its fence closes.
 *
 * `BlockChart` draws the chart block of an answer (components/answer-blocks.tsx):
 * one or two series over shared points, as lines on a grid.
 */

export interface ChartSpec {
  type: "bar" | "line" | "donut" | "kpi" | "table" | "stacked";
  title?: string;
  unit?: string;
  /** bar and donut: one row per item. */
  items?: { label: string; value: number; meta?: string }[];
  /** line and stacked: x labels and one or more series. */
  labels?: string[];
  series?: { name: string; data: number[] }[];
  /** kpi: a strip of numbers. */
  kpis?: { label: string; value: string | number; sub?: string }[];
  /** table: header row and body rows. */
  columns?: string[];
  rows?: (string | number)[][];
  note?: string;
}

/** A chart checked and ready to draw, or the reason it cannot be. */
export type ChartParse = { spec: ChartSpec } | { error: string };

const TYPES: ChartSpec["type"][] = ["bar", "line", "donut", "kpi", "table", "stacked"];
/**
 * The answers' categorical slots in their fixed order (app/globals.css, the answer blocks block): blue, amber,
 * teal, violet, olive, magenta (--ask-cat-1..6). Red is never a slot, so red in an answer always means something.
 */
export const ANSWER_SLOTS = ["var(--ask-cat-1)", "var(--ask-cat-2)", "var(--ask-cat-3)", "var(--ask-cat-4)", "var(--ask-cat-5)", "var(--ask-cat-6)"];
const PALETTE = ANSWER_SLOTS;
const color = (i: number) => PALETTE[i % PALETTE.length];

class Unreadable extends Error {}

const shown = (v: unknown): string => {
  const s = JSON.stringify(v) ?? String(v);
  return s.length > 40 ? `${s.slice(0, 40)}…` : s;
};

function record(v: unknown, where: string): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Unreadable(`${where} is not an object`);
  return v as Record<string, unknown>;
}

function list(v: unknown, where: string, least = 1): unknown[] {
  if (!Array.isArray(v)) throw new Unreadable(`${where} is ${v === undefined ? "missing" : `${shown(v)}, not a list`}`);
  if (v.length < least) throw new Unreadable(`${where} has ${v.length} ${v.length === 1 ? "entry" : "entries"}, and at least ${least} are needed`);
  return v;
}

/** A label: text, or a number written as text (a year, a count). */
function label(v: unknown, where: string): string {
  if (typeof v === "string" && v.trim()) return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  throw new Unreadable(`${where} is ${v === undefined ? "missing" : `${shown(v)}, not a label`}`);
}

function optionalText(v: unknown, where: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v;
  throw new Unreadable(`${where} is ${shown(v)}, not text`);
}

/** A number, or text that is wholly one ("1,234", "12%", "$5"). Anything else refuses the chart, never zero. */
function number(v: unknown, where: string): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\s*[-+]?[$€£]?\s*\d[\d,]*(\.\d+)?\s*%?\s*$/.test(v)) return Number(v.replace(/[^0-9.+-]/g, ""));
  throw new Unreadable(`${where} is ${v === undefined ? "missing" : shown(v)}, not a number`);
}

function notNegative(values: number[], where: string): void {
  const i = values.findIndex((x) => x < 0);
  if (i >= 0) throw new Unreadable(`${where}[${i}] is ${values[i]}, and this chart cannot show a value below zero`);
}

function chartOf(raw: unknown): ChartSpec {
  const j = record(raw, "the chart");
  if (!TYPES.includes(j.type as ChartSpec["type"])) throw new Unreadable(`"type" is ${shown(j.type)}, which this console does not draw (it draws ${TYPES.join(", ")})`);
  const type = j.type as ChartSpec["type"];
  const spec: ChartSpec = { type, title: optionalText(j.title, '"title"'), unit: optionalText(j.unit, '"unit"'), note: optionalText(j.note, '"note"') };
  switch (type) {
    case "bar":
    case "donut": {
      spec.items = list(j.items, '"items"').map((it, i) => {
        const x = record(it, `items[${i}]`);
        return { label: label(x.label, `items[${i}].label`), value: number(x.value, `items[${i}].value`), meta: optionalText(x.meta, `items[${i}].meta`) };
      });
      notNegative(spec.items.map((it) => it.value), '"items" value');
      break;
    }
    case "line":
    case "stacked": {
      spec.labels = list(j.labels, '"labels"', type === "line" ? 2 : 1).map((l, i) => label(l, `labels[${i}]`));
      const points = spec.labels.length;
      spec.series = list(j.series, '"series"').map((s, i) => {
        const x = record(s, `series[${i}]`);
        const data = list(x.data, `series[${i}].data`).map((d, k) => number(d, `series[${i}].data[${k}]`));
        if (data.length !== points) throw new Unreadable(`series[${i}].data has ${data.length} values for ${points} labels`);
        if (type === "stacked") notNegative(data, `series[${i}].data`);
        return { name: optionalText(x.name, `series[${i}].name`) || `Series ${i + 1}`, data };
      });
      break;
    }
    case "kpi": {
      spec.kpis = list(j.kpis, '"kpis"').map((k, i) => {
        const x = record(k, `kpis[${i}]`);
        const value = x.value;
        if (!(typeof value === "string" || (typeof value === "number" && Number.isFinite(value)))) throw new Unreadable(`kpis[${i}].value is ${shown(value)}, not a number or text`);
        return { label: label(x.label, `kpis[${i}].label`), value, sub: optionalText(x.sub, `kpis[${i}].sub`) };
      });
      break;
    }
    case "table": {
      spec.columns = list(j.columns, '"columns"').map((c, i) => label(c, `columns[${i}]`));
      const width = spec.columns.length;
      spec.rows = list(j.rows, '"rows"').map((r, i) => {
        const cells = list(r, `rows[${i}]`).map((c, k) => {
          if (typeof c === "string" || (typeof c === "number" && Number.isFinite(c))) return c;
          throw new Unreadable(`rows[${i}][${k}] is ${shown(c)}, not a number or text`);
        });
        if (cells.length !== width) throw new Unreadable(`rows[${i}] has ${cells.length} cells for ${width} columns`);
        return cells;
      });
      break;
    }
  }
  return spec;
}

/** The chart in a fenced block, checked field by field; the reason when it cannot be drawn. */
export function parseChart(raw: string): ChartParse {
  let j: unknown;
  try {
    j = JSON.parse(raw.trim());
  } catch {
    return { error: "the block is not valid JSON" };
  }
  try {
    return { spec: chartOf(j) };
  } catch (e) {
    if (e instanceof Unreadable) return { error: e.message };
    throw e;
  }
}

export function ChartRefused({ reason }: { reason: string }) {
  return <p className="my-1 text-[11px] text-faint">The chart could not be drawn: {reason}.</p>;
}

/** Draws a chart `parseChart` returned. */
export function AssistantChart({ spec }: { spec: ChartSpec }) {
  const items = spec.items ?? [];
  const labels = spec.labels ?? [];
  const series = (spec.series ?? []).map((s, i) => ({ ...s, color: color(i) }));

  let body: React.ReactNode;
  switch (spec.type) {
    case "bar":
    case "donut":
      if (items.every((it) => it.value === 0)) {
        body = <p className="text-[11px] text-faint">Every value is zero: there is nothing to draw.</p>;
      } else if (spec.type === "bar") {
        body = <RankBar data={items.map((it, i) => ({ label: it.label, value: it.value, color: color(i), meta: it.meta ?? (spec.unit ? `${it.value}${spec.unit}` : undefined) }))} />;
      } else {
        body = <Donut data={items.filter((it) => it.value > 0).map((it, i) => ({ label: it.label, value: it.value, color: color(i) }))} size={104} />;
      }
      break;
    case "line":
      if (series.every((s) => s.data.every((v) => v === 0))) {
        body = <p className="text-[11px] text-faint">No activity in this period: every value is zero.</p>;
        break;
      }
      body = (
        <div className="flex flex-col gap-2">
          <LineChart series={series} labels={labels} height={150} unit={spec.unit ?? ""} />
          {series.length > 1 && (
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              {series.map((s, i) => (
                <span key={i} className="flex items-center gap-1.5 text-[10.5px] text-dim">
                  <span className="h-0.5 w-3 rounded-[2px]" style={{ background: s.color }} />
                  {s.name}
                </span>
              ))}
            </span>
          )}
        </div>
      );
      break;
    case "stacked":
      if (series.every((s) => s.data.every((v) => v === 0))) {
        body = <p className="text-[11px] text-faint">Every value is zero: there is nothing to draw.</p>;
        break;
      }
      body = (
        <StackedBar
          data={labels.map((l, i) => ({ label: l, values: series.map((s) => s.data[i]) }))}
          keys={series.map((s) => s.name)}
          colors={series.map((s) => s.color)}
          height={150}
        />
      );
      break;
    case "kpi":
      body = (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3">
          {(spec.kpis ?? []).map((k, i) => (
            <div key={i} className="flex flex-col gap-0.5 bg-surface px-3 py-2">
              <span className="tnum text-[18px] leading-none font-semibold tracking-[-0.02em]">{String(k.value)}</span>
              <span className="text-[10.5px] text-faint">{k.label}</span>
              {k.sub && <span className="truncate text-[9.5px] text-ghost">{k.sub}</span>}
            </div>
          ))}
        </div>
      );
      break;
    case "table":
      body = <DataTable columns={spec.columns ?? []} rows={(spec.rows ?? []).map((r) => r.map(String))} />;
      break;
  }

  return (
    <figure className="my-2 flex flex-col gap-2 rounded-md border border-line bg-surface p-3">
      {spec.title && <figcaption className="text-[11.5px] font-semibold text-fg">{spec.title}</figcaption>}
      {body}
      {spec.note && <span className="text-[10.5px] leading-[1.45] text-faint">{spec.note}</span>}
    </figure>
  );
}

export function ChartDrawing() {
  return (
    <div className="my-2 flex h-16 items-center justify-center rounded-md border border-dashed border-line text-[11px] text-faint">
      drawing the chart…
    </div>
  );
}

/* ═══════════════════ the chart block of an answer ═══════════════════ */

/** Round tick steps: 1, 2, 2.5 or 5 times a power of ten. */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/**
 * The chart block of an answer: one or two series over shared points, as 2px lines over a tinted area on a
 * hairline grid, in the answers' first two categorical slots. A null is a gap in the line, never a zero. Hover,
 * or focus and the arrow keys, show every series' value at a point; two series carry a legend; a single series
 * labels its last value. `fmt` writes a value as the block's format does (components/answer-blocks.tsx).
 */
export function BlockChart({ x, series, fmt, tick = fmt, height = 180 }: { x: string[]; series: { label: string; values: (number | null)[] }[]; fmt: (v: number) => string; tick?: (v: number) => string; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    setWidth(Math.round(el.getBoundingClientRect().width));
    const seen = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    seen.observe(el);
    return () => seen.disconnect();
  }, []);

  const known = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const n = x.length;
  const colours = series.map((_, k) => ANSWER_SLOTS[k]);

  let body: React.ReactNode = null;
  if (!known.length) {
    body = <p className="py-6 text-center text-[11px] text-faint">No point has a value in the record.</p>;
  } else if (width > 0) {
    const lo0 = Math.min(0, ...known);
    const hi0 = Math.max(0, ...known);
    const step = niceStep((hi0 - lo0) / 4 || 1);
    const lo = Math.floor(lo0 / step) * step;
    const hi = Math.max(lo + step, Math.ceil(hi0 / step) * step);
    const ticks: number[] = [];
    for (let v = lo; v <= hi + step / 1000; v += step) ticks.push(Number(v.toPrecision(12)));
    const padL = Math.max(28, Math.max(...ticks.map((t) => tick(t).length)) * 6 + 10);
    const padR = series.length === 1 ? 14 : 10;
    const padT = series.length === 1 ? 18 : 8;
    const padB = 22;
    const plotW = Math.max(40, width - padL - padR);
    const plotH = height - padT - padB;
    const px = (i: number) => padL + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));
    const py = (v: number) => padT + plotH * (1 - (v - lo) / (hi - lo));
    const base = py(Math.max(lo, Math.min(0, hi)));
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 70))));
    const short = (l: string) => l.replace(/^week of /i, "");

    // Each series as runs of points with a value: a null breaks the line.
    const runs = series.map((s) => {
      const out: { i: number; v: number }[][] = [];
      let cur: { i: number; v: number }[] = [];
      s.values.forEach((v, i) => {
        if (v === null) {
          if (cur.length) out.push(cur);
          cur = [];
        } else cur.push({ i, v });
      });
      if (cur.length) out.push(cur);
      return out;
    });
    const line = (r: { i: number; v: number }[]) => r.map((p, k) => `${k ? "L" : "M"}${px(p.i).toFixed(1)},${py(p.v).toFixed(1)}`).join("");
    const area = (r: { i: number; v: number }[]) => `${line(r)}L${px(r[r.length - 1].i).toFixed(1)},${base.toFixed(1)}L${px(r[0].i).toFixed(1)},${base.toFixed(1)}Z`;

    const pick = (e: PointerEvent<SVGSVGElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      const i = n === 1 ? 0 : Math.round(((e.clientX - r.left - padL) / plotW) * (n - 1));
      setAt(Math.max(0, Math.min(n - 1, i)));
    };
    const last = series.length === 1 ? runs[0].at(-1)?.at(-1) : undefined;

    body = (
      <>
        <svg width={width} height={height} role="img" aria-label={`${series.map((s) => s.label).join(" and ")} over ${n} points, from ${x[0]} to ${x[n - 1]}`} onPointerMove={pick} onPointerLeave={() => setAt(null)} className="block touch-none select-none">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={padL + plotW} y1={py(t)} y2={py(t)} stroke="var(--ask-line)" strokeWidth={1} shapeRendering="crispEdges" />
              <text x={padL - 6} y={py(t)} dy="0.32em" textAnchor="end" className="tnum fill-[var(--t-fg-4)] text-[9.5px]">
                {tick(t)}
              </text>
            </g>
          ))}
          <line x1={padL} x2={padL + plotW} y1={base} y2={base} stroke="var(--ask-line-strong)" strokeWidth={1} shapeRendering="crispEdges" />
          {x.map((l, i) =>
            i % every === 0 ? (
              <text key={i} x={px(i)} y={height - 6} textAnchor={n > 1 && i === 0 ? "start" : n > 1 && i === n - 1 ? "end" : "middle"} className="fill-[var(--t-fg-4)] text-[9.5px]">
                {short(l)}
              </text>
            ) : null,
          )}
          {runs.map((rs, k) => (
            <g key={k}>
              {rs.filter((r) => r.length > 1).map((r, j) => (
                <path key={`a${j}`} d={area(r)} fill={colours[k]} fillOpacity={series.length > 1 ? 0.08 : 0.12} />
              ))}
              {rs.filter((r) => r.length > 1).map((r, j) => (
                <path key={`l${j}`} d={line(r)} fill="none" stroke={colours[k]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {/* A point with no neighbour that has a value has no line: it is drawn as a dot. */}
              {rs.filter((r) => r.length === 1).map((r, j) => (
                <circle key={`d${j}`} cx={px(r[0].i)} cy={py(r[0].v)} r={3.5} fill={colours[k]} stroke="var(--ask-surface)" strokeWidth={2} />
              ))}
            </g>
          ))}
          {last && at === null && (
            <g>
              <circle cx={px(last.i)} cy={py(last.v)} r={4} fill={colours[0]} stroke="var(--ask-surface)" strokeWidth={2} />
              <text x={px(last.i)} y={py(last.v) - 9} textAnchor={last.i === n - 1 ? "end" : "middle"} className="tnum fill-[var(--t-fg-2)] text-[10px] font-semibold">
                {fmt(last.v)}
              </text>
            </g>
          )}
          {at !== null && (
            <g pointerEvents="none">
              <line x1={px(at)} x2={px(at)} y1={padT} y2={base} stroke="var(--ask-line-strong)" strokeWidth={1} />
              {series.map((s, k) => {
                const v = s.values[at];
                return v === null ? null : <circle key={k} cx={px(at)} cy={py(v)} r={4.5} fill={colours[k]} stroke="var(--ask-surface)" strokeWidth={2} />;
              })}
            </g>
          )}
        </svg>
        {at !== null && (
          <div
            role="status"
            className="ask-tip pointer-events-none absolute top-1 z-10 min-w-[8.5rem] rounded-md px-2.5 py-1.5 text-[11px] leading-[1.5]"
            style={{ left: Math.min(Math.max(px(at), 70), width - 70), transform: "translateX(-50%)" }}
          >
            <span className="block font-semibold text-fg">{x[at]}</span>
            {series.map((s, k) => (
              <span key={k} className="flex items-center gap-1.5 text-dim">
                <span className="h-0.5 w-2.5 shrink-0 rounded-full" style={{ background: colours[k] }} />
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                <span className={`tnum font-semibold ${s.values[at] === null ? "font-normal text-ghost italic" : "text-fg"}`}>{s.values[at] === null ? "none" : fmt(s.values[at] as number)}</span>
              </span>
            ))}
          </div>
        )}
      </>
    );
  }

  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setAt((a) => Math.max(0, Math.min(n - 1, (a ?? (e.key === "ArrowRight" ? -1 : n)) + (e.key === "ArrowRight" ? 1 : -1))));
    } else if (e.key === "Home") setAt(0);
    else if (e.key === "End") setAt(n - 1);
    else if (e.key === "Escape") setAt(null);
  };

  return (
    <div className="flex flex-col gap-1.5">
      {series.length > 1 ? (
        <span className="flex flex-wrap gap-x-3.5 gap-y-1 text-[10.5px] text-dim">
          {series.map((s, k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span className="h-[3px] w-3.5 rounded-full" style={{ background: colours[k] }} />
              {s.label}
            </span>
          ))}
        </span>
      ) : (
        <span className="text-[10.5px] font-medium text-dim">{series[0]?.label}</span>
      )}
      <div ref={box} tabIndex={0} onKeyDown={key} onBlur={() => setAt(null)} className="focusable relative min-w-0" style={{ minHeight: height }}>
        {body}
      </div>
    </div>
  );
}
