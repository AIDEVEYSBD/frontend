import type { ReactNode } from "react";
import { Label, Meter, Panel, type Tone } from "./ui";

/* ═══════════════════ Charts ═══════════════════ */

const STROKE: Record<string, string> = {
  run: "var(--t-run)",
  ok: "var(--t-ok)",
  warn: "var(--t-warn)",
  err: "var(--t-err)",
  queue: "var(--t-queue)",
  ink: "var(--t-fg)",
  neutral: "var(--t-fg-3)",
};

/**
 * Sparkline. No axes, no gridlines, no legend — at this size they would
 * cost more space than the data. The last point is marked because the
 * current value is the one a reader is looking for.
 */
export function Sparkline({
  points,
  width = 132,
  height = 36,
  tone = "ink",
  area = true,
}: {
  points: number[];
  width?: number;
  height?: number;
  tone?: Tone;
  area?: boolean;
}) {
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const pad = 3;

  const co = points.map((p, i): [number, number] => [
    i * step,
    height - pad - ((p - min) / span) * (height - pad * 2),
  ]);

  const line = co.map(([x, y], i) => `${i ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const last = co[co.length - 1];
  const id = `sp-${tone}-${points.length}-${Math.round(points[0])}`;

  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden>
      {area && (
        <>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={STROKE[tone]} stopOpacity="0.16" />
              <stop offset="100%" stopColor={STROKE[tone]} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`${line} L ${width} ${height} L 0 ${height} Z`} fill={`url(#${id})`} />
        </>
      )}
      <path
        d={line}
        fill="none"
        stroke={STROKE[tone]}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={STROKE[tone]} />
    </svg>
  );
}

/** Column sparkline — for counts, where a line would imply continuity. */
export function BarSpark({
  points,
  width = 132,
  height = 36,
  tone = "ink",
}: {
  points: number[];
  width?: number;
  height?: number;
  tone?: Tone;
}) {
  const max = Math.max(...points);
  const gap = 2;
  const bw = (width - gap * (points.length - 1)) / points.length;

  return (
    <svg width={width} height={height} aria-hidden>
      {points.map((p, i) => {
        const h = Math.max(2, (p / max) * height);
        return (
          <rect
            key={i}
            x={i * (bw + gap)}
            y={height - h}
            width={bw}
            height={h}
            rx={1}
            fill={STROKE[tone]}
            opacity={i === points.length - 1 ? 1 : 0.35}
          />
        );
      })}
    </svg>
  );
}

/** Signed change. Direction is an arrow as well as a colour. */
export function Delta({ value, invert = false }: { value: number; invert?: boolean }) {
  const up = value >= 0;
  const good = invert ? !up : up;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[11.5px] font-medium ${
        good ? "text-ok" : "text-err"
      }`}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {up ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M5 12l7 7 7-7" />}
      </svg>
      <span className="tnum">
        {up ? "+" : ""}
        {value}%
      </span>
    </span>
  );
}

/* ═══════════════════ KPI cards ═══════════════════ */

/**
 * Four shapes for one job. The variant follows the question a reader is
 * asking: how much (plain), against what (meter), trending how (trend),
 * or how does this compare in a row (compact).
 */
export function Kpi({
  label,
  value,
  unit,
  sub,
  delta,
  invertDelta,
  meter,
  trend,
  trendKind = "line",
  tone = "ink",
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  delta?: number;
  invertDelta?: boolean;
  meter?: number;
  trend?: number[];
  trendKind?: "line" | "bar";
  tone?: Tone;
}) {
  return (
    <Panel className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <Label>{label}</Label>
        {delta !== undefined && <Delta value={delta} invert={invertDelta} />}
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-1">
          <span className="tnum text-[28px] leading-none font-semibold tracking-[-0.025em]">
            {value}
          </span>
          {unit && <span className="text-[15px] text-dim">{unit}</span>}
        </div>
        {trend &&
          (trendKind === "bar" ? (
            <BarSpark points={trend} tone={tone} width={104} height={30} />
          ) : (
            <Sparkline points={trend} tone={tone} width={104} height={30} />
          ))}
      </div>

      {meter !== undefined && <Meter value={meter} tone={tone} />}
      {sub && <span className="text-[11.5px] text-faint">{sub}</span>}
    </Panel>
  );
}

/** Dense variant for a strip above a table, where cards would be too loud. */
export function KpiInline({
  label,
  value,
  delta,
}: {
  label: string;
  value: string;
  delta?: number;
}) {
  return (
    <div className="flex flex-col gap-1.5 border-l border-line pl-4 first:border-0 first:pl-0">
      <Label>{label}</Label>
      <div className="flex items-baseline gap-2">
        <span className="tnum text-[19px] leading-none font-semibold tracking-[-0.02em]">
          {value}
        </span>
        {delta !== undefined && <Delta value={delta} />}
      </div>
    </div>
  );
}

/* ═══════════════════ Chart panel ═══════════════════ */

export function ChartPanel({
  title,
  meta,
  children,
  action,
}: {
  title: string;
  meta?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Panel className="flex flex-col">
      <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] font-semibold tracking-[-0.005em]">{title}</span>
          {meta && <span className="text-[11.5px] text-faint">{meta}</span>}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </Panel>
  );
}

/**
 * Grouped columns with a baseline. Deliberately axis-light: one value
 * label on hover-height, a baseline rule, and category labels — the rest
 * would be chart junk at this size.
 */
export function ColumnChart({
  data,
  height = 132,
}: {
  data: { label: string; a: number; b: number }[];
  height?: number;
}) {
  const max = Math.max(...data.flatMap((d) => [d.a, d.b]));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-3" style={{ height }}>
        {data.map((d) => (
          <div key={d.label} className="flex h-full grow flex-col justify-end gap-1">
            <div className="flex h-full items-end gap-1">
              <div
                className="grow rounded-xs bg-fg"
                style={{ height: `${(d.a / max) * 100}%` }}
                title={`Completed ${d.a}`}
              />
              <div
                className="grow rounded-xs bg-run"
                style={{ height: `${(d.b / max) * 100}%` }}
                title={`Escalated ${d.b}`}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="h-px bg-line-strong" />

      <div className="flex gap-3">
        {data.map((d) => (
          <span key={d.label} className="grow text-center text-[10.5px] text-faint">
            {d.label}
          </span>
        ))}
      </div>

      <div className="flex items-center gap-4 pt-1">
        <span className="flex items-center gap-1.5 text-[11.5px] text-dim">
          <span className="size-2 rounded-xs bg-fg" /> Completed
        </span>
        <span className="flex items-center gap-1.5 text-[11.5px] text-dim">
          <span className="size-2 rounded-xs bg-run" /> Escalated
        </span>
      </div>
    </div>
  );
}
