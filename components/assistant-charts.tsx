"use client";

import { Donut, LineChart, RankBar, StackedBar } from "./charts";
import { DataTable } from "./markdown";

/**
 * Charts the assistant can draw.
 *
 * The model emits a fenced ```chart block carrying one JSON object; the
 * renderer turns it into the same chart primitives the console uses, in the
 * same palette, so a chart in the conversation looks like a chart on the
 * page. Anything malformed renders as a quiet note rather than an error, and
 * a block still being streamed shows as "drawing" until its fence closes.
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

const PALETTE = ["var(--t-c2)", "var(--t-c5)", "var(--t-c1)", "var(--t-c7)", "var(--t-c8)", "var(--t-c3)", "var(--t-c6)", "var(--t-c9)"];
const color = (i: number) => PALETTE[i % PALETTE.length];

export function parseChart(raw: string): ChartSpec | null {
  try {
    const j = JSON.parse(raw.trim()) as ChartSpec;
    if (!j || typeof j !== "object" || !j.type) return null;
    return j;
  } catch {
    return null;
  }
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function AssistantChart({ spec }: { spec: ChartSpec }) {
  const items = (spec.items ?? []).map((it) => ({ label: String(it.label ?? ""), value: num(it.value), meta: it.meta })).filter((it) => it.label);
  const labels = (spec.labels ?? []).map(String);
  const series = (spec.series ?? []).map((s, i) => ({ name: String(s.name ?? `Series ${i + 1}`), data: (s.data ?? []).map(num), color: color(i) }));

  let body: React.ReactNode = null;
  switch (spec.type) {
    case "bar":
      if (!items.length || items.every((it) => it.value <= 0)) break;
      body = <RankBar data={items.map((it, i) => ({ label: it.label, value: it.value, color: color(i), meta: it.meta ?? (spec.unit ? `${it.value}${spec.unit}` : undefined) }))} />;
      break;
    case "donut":
      if (!items.length || items.every((it) => it.value <= 0)) break;
      body = <Donut data={items.filter((it) => it.value > 0).map((it, i) => ({ label: it.label, value: it.value, color: color(i) }))} size={104} />;
      break;
    case "line":
      if (!series.length || labels.length < 2 || series.some((s) => s.data.length !== labels.length)) break;
      if (series.every((s) => s.data.every((v) => v <= 0))) {
        body = <p className="text-[11px] text-faint">No activity in this period: every value is zero.</p>;
        break;
      }
      body = (
        <div className="flex flex-col gap-2">
          <LineChart series={series} labels={labels} height={150} unit={spec.unit ?? ""} />
          {series.length > 1 && (
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              {series.map((s) => (
                <span key={s.name} className="flex items-center gap-1.5 text-[10.5px] text-dim">
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
      if (!series.length || !labels.length || series.every((s) => s.data.every((v) => v <= 0))) break;
      body = (
        <StackedBar
          data={labels.map((l, i) => ({ label: l, values: series.map((s) => s.data[i] ?? 0) }))}
          keys={series.map((s) => s.name)}
          colors={series.map((s) => s.color)}
          height={150}
        />
      );
      break;
    case "kpi": {
      const kpis = (spec.kpis ?? []).filter((k) => k && k.label);
      if (!kpis.length) break;
      body = (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3">
          {kpis.map((k) => (
            <div key={k.label} className="flex flex-col gap-0.5 bg-surface px-3 py-2">
              <span className="tnum text-[18px] leading-none font-semibold tracking-[-0.02em]">{String(k.value)}</span>
              <span className="text-[10.5px] text-faint">{k.label}</span>
              {k.sub && <span className="truncate text-[9.5px] text-ghost">{k.sub}</span>}
            </div>
          ))}
        </div>
      );
      break;
    }
    case "table": {
      const cols = (spec.columns ?? []).map(String);
      const rows = (spec.rows ?? []).filter(Array.isArray);
      if (!cols.length || !rows.length) break;
      body = <DataTable columns={cols} rows={rows.map((r) => r.map(String))} />;
      break;
    }
  }

  if (!body) {
    return <p className="my-1 text-[11px] text-faint">The chart could not be drawn from the data given.</p>;
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
