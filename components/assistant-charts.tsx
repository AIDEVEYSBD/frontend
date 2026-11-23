"use client";

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
const PALETTE = ["var(--t-c2)", "var(--t-c5)", "var(--t-c1)", "var(--t-c7)", "var(--t-c8)", "var(--t-c3)", "var(--t-c6)", "var(--t-c9)"];
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
