/**
 * Chart primitives.
 *
 * Enterprise density means axes, gridlines and legends earn their space —
 * a reader here is reading values off the chart, not glancing at a shape.
 * Series colour comes from the constrained categorical palette so a dense
 * view cannot go garish.
 */

export const CAT = [
  "var(--t-c1)",
  "var(--t-c2)",
  "var(--t-c3)",
  "var(--t-c4)",
  "var(--t-c5)",
  "var(--t-c6)",
  "var(--t-c7)",
  "var(--t-c8)",
  "var(--t-c9)",
  "var(--t-c10)",
];

const AXIS = "var(--t-fg-4)";
const GRID = "var(--t-line)";

function niceTicks(max: number, count = 4) {
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = Math.ceil(raw / mag) * mag;
  return Array.from({ length: count + 1 }, (_, i) => i * step);
}

export function Legend({
  items,
}: {
  items: { label: string; color: string; dashed?: boolean }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5 text-[11px] text-dim">
          <span
            className="h-0.5 w-3 rounded-[2px]"
            style={{
              background: i.dashed
                ? `repeating-linear-gradient(90deg, ${i.color} 0 3px, transparent 3px 6px)`
                : i.color,
            }}
          />
          {i.label}
        </span>
      ))}
    </div>
  );
}

/* ═══════════════════ Multi-series line ═══════════════════ */

export function LineChart({
  series,
  labels,
  height = 190,
  unit = "",
}: {
  series: { name: string; data: number[]; color: string; dashed?: boolean }[];
  labels: string[];
  height?: number;
  unit?: string;
}) {
  const padL = 34;
  const padB = 20;
  const padT = 8;
  const w = 100; // viewBox units, stretched by preserveAspectRatio="none"
  const max = Math.max(...series.flatMap((s) => s.data));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];

  const x = (i: number) => (i / (labels.length - 1)) * w;
  const y = (v: number) => padT + (1 - v / top) * (height - padT - padB);

  return (
    <div className="flex flex-col gap-3">
      {/* overflow-hidden is load-bearing: the plot is stretched with
          preserveAspectRatio="none", and without it the strokes paint
          outside the panel and across whatever sits below. */}
      <div className="relative overflow-hidden" style={{ height }}>
        {/* Y axis labels sit outside the stretched plot so text is never distorted. */}
        <div
          className="absolute inset-y-0 left-0 flex flex-col justify-between"
          style={{ width: padL, paddingTop: padT, paddingBottom: padB }}
        >
          {[...ticks].reverse().map((t) => (
            <span key={t} className="tnum -translate-y-1/2 font-mono text-[9.5px] text-faint">
              {t >= 1000 ? `${t / 1000}k` : t}
              {unit}
            </span>
          ))}
        </div>

        <svg
          className="absolute inset-y-0 right-0 block"
          style={{ left: padL }}
          width="100%"
          height="100%"
          viewBox={`0 0 ${w} ${height}`}
          preserveAspectRatio="none"
        >
          {ticks.map((t) => (
            <line
              key={t}
              x1="0"
              x2={w}
              y1={y(t)}
              y2={y(t)}
              stroke={t === 0 ? AXIS : GRID}
              strokeWidth={t === 0 ? 1 : 1}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {series.map((s) => (
            <polyline
              key={s.name}
              points={s.data.map((v, i) => `${x(i)},${y(v)}`).join(" ")}
              fill="none"
              stroke={s.color}
              strokeWidth="1.75"
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray={s.dashed ? "4 3" : undefined}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>

        <div
          className="absolute right-0 bottom-0 flex justify-between"
          style={{ left: padL, height: padB }}
        >
          {labels.map((l) => (
            <span key={l} className="font-mono text-[9.5px] text-faint">
              {l}
            </span>
          ))}
        </div>
      </div>

      <Legend items={series.map((s) => ({ label: s.name, color: s.color, dashed: s.dashed }))} />
    </div>
  );
}

/* ═══════════════════ Stacked bars ═══════════════════ */

export function StackedBar({
  data,
  keys,
  colors,
  height = 170,
}: {
  data: { label: string; values: number[] }[];
  keys: string[];
  colors: string[];
  height?: number;
}) {
  const totals = data.map((d) => d.values.reduce((a, b) => a + b, 0));
  const max = Math.max(...totals);
  const ticks = niceTicks(max, 3);
  const top = ticks[ticks.length - 1];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2" style={{ height }}>
        <div className="flex w-8 shrink-0 flex-col justify-between pb-5">
          {[...ticks].reverse().map((t) => (
            <span key={t} className="tnum font-mono text-[9.5px] text-faint">
              {t >= 1000 ? `${t / 1000}k` : t}
            </span>
          ))}
        </div>

        <div className="relative flex grow flex-col">
          <div className="relative grow">
            {ticks.map((t) => (
              <div
                key={t}
                className="absolute inset-x-0 border-t"
                style={{
                  bottom: `${(t / top) * 100}%`,
                  borderColor: t === 0 ? AXIS : GRID,
                }}
              />
            ))}

            <div className="absolute inset-0 flex items-end gap-2">
              {data.map((d, di) => (
                <div key={d.label} className="flex h-full grow flex-col justify-end">
                  <div
                    className="flex w-full flex-col-reverse overflow-hidden rounded-t-[2px]"
                    style={{ height: `${(totals[di] / top) * 100}%` }}
                    title={`${d.label}: ${totals[di]}`}
                  >
                    {d.values.map((v, i) => (
                      <div
                        key={keys[i]}
                        style={{
                          height: `${(v / totals[di]) * 100}%`,
                          background: colors[i],
                        }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex h-5 items-center gap-2">
            {data.map((d) => (
              <span key={d.label} className="grow text-center font-mono text-[9.5px] text-faint">
                {d.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      <Legend items={keys.map((k, i) => ({ label: k, color: colors[i] }))} />
    </div>
  );
}

/* ═══════════════════ Ranked horizontal bars ═══════════════════ */

export function RankBar({
  data,
}: {
  data: { label: string; value: number; color: string; meta?: string }[];
}) {
  const max = Math.max(...data.map((d) => d.value));
  return (
    <div className="flex flex-col">
      {data.map((d) => (
        <div
          key={d.label}
          className="grid grid-cols-[minmax(96px,1fr)_2fr_auto] items-center gap-3 border-b border-line py-2 last:border-0"
        >
          <span className="truncate text-[12px] text-mist">{d.label}</span>
          <span className="flex h-3.5 items-center">
            <span
              className="h-full rounded-[2px]"
              style={{ width: `${(d.value / max) * 100}%`, background: d.color }}
            />
          </span>
          <span className="tnum w-14 text-right font-mono text-[11px] text-dim">
            {d.meta ?? d.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════ Heatmap ═══════════════════ */

export function Heatmap({
  rows,
  cols,
  values,
}: {
  rows: string[];
  cols: string[];
  values: number[][];
}) {
  const max = Math.max(...values.flat());

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        <span className="w-8 shrink-0" />
        <div className="flex grow gap-[3px]">
          {cols.map((c, i) => (
            <span
              key={c}
              className="grow text-center font-mono text-[9px] text-faint"
              style={{ visibility: i % 2 ? "hidden" : "visible" }}
            >
              {c}
            </span>
          ))}
        </div>
      </div>

      {rows.map((r, ri) => (
        <div key={r} className="flex items-center gap-1">
          <span className="w-8 shrink-0 font-mono text-[9.5px] text-faint">{r}</span>
          <div className="flex grow gap-[3px]">
            {cols.map((c, ci) => {
              const v = values[ri][ci];
              return (
                <span
                  key={c}
                  title={`${r} ${c}: ${v}`}
                  className="h-4 grow rounded-[2px]"
                  style={{
                    background: "var(--t-c2)",
                    opacity: 0.12 + (v / max) * 0.88,
                  }}
                />
              );
            })}
          </div>
        </div>
      ))}

      <div className="flex items-center gap-2 pt-1">
        <span className="font-mono text-[9.5px] text-faint">Low</span>
        <div className="flex grow gap-[2px]">
          {Array.from({ length: 10 }).map((_, i) => (
            <span
              key={i}
              className="h-2 grow rounded-[1px]"
              style={{ background: "var(--t-c2)", opacity: 0.12 + (i / 9) * 0.88 }}
            />
          ))}
        </div>
        <span className="font-mono text-[9.5px] text-faint">{max}</span>
      </div>
    </div>
  );
}

/* ═══════════════════ Donut ═══════════════════ */

export function Donut({
  data,
  size = 132,
}: {
  data: { label: string; value: number; color: string }[];
  size?: number;
}) {
  const total = data.reduce((a, d) => a + d.value, 0);
  const r = size / 2 - 9;
  const c = 2 * Math.PI * r;

  // Offsets are derived up front rather than accumulated inside the map,
  // so nothing is mutated while rendering.
  const segments = data.reduce<{ d: (typeof data)[number]; frac: number; start: number }[]>(
    (acc, d) => {
      const prev = acc[acc.length - 1];
      const start = prev ? prev.start + prev.frac : 0;
      return [...acc, { d, frac: d.value / total, start }];
    },
    [],
  );

  return (
    <div className="flex items-center gap-5">
      <svg width={size} height={size} className="shrink-0 -rotate-90">
        {segments.map(({ d, frac, start }) => (
          <circle
            key={d.label}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={d.color}
            strokeWidth="14"
            strokeDasharray={`${frac * c} ${c}`}
            strokeDashoffset={-start * c}
          />
        ))}
      </svg>

      <div className="flex min-w-0 flex-col gap-1.5">
        {data.map((d) => (
          <div key={d.label} className="flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-[2px]" style={{ background: d.color }} />
            <span className="grow truncate text-[12px] text-mist">{d.label}</span>
            <span className="tnum font-mono text-[11px] text-dim">
              {Math.round((d.value / total) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
