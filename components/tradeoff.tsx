"use client";

/**
 * The optimizing triangle, as a reusable glyph.
 *
 * Cost, accuracy and time are the three things every model choice trades
 * between. One triangle per model: the outline is the ideal, the filled
 * shape is the model's profile, one vertex per axis. A dashed vertex at the
 * centre means no evidence on that axis. Used by the control pane (per
 * model, over the estate) and by evals (per model, over one benchmark).
 */

export interface TradeoffScore {
  cost: number | null;
  accuracy: number | null;
  time: number | null;
}

/** The best (lowest positive) value among a set, or null when none is known. */
export function bestOf(vals: (number | null)[]): number | null {
  const pos = vals.filter((v): v is number => v !== null && v > 0);
  return pos.length ? Math.min(...pos) : null;
}

/**
 * Log scale against the best in view, two decades wide: best scores 1, ten
 * times worse scores 0.5, a hundred times worse scores 0. Zero cost (a local
 * model) is best by definition.
 */
export function logScore(v: number | null, best: number | null): number | null {
  if (v === null) return null;
  if (v <= 0 || best === null) return 1;
  return Math.max(0, Math.min(1, 1 - Math.log10(v / best) / 2));
}

export function TriangleGlyph({ score, color, size = 150 }: { score: TradeoffScore; color: string; size?: number }) {
  const W = 150, H = 122;
  const A: [number, number] = [75, 12];
  const C: [number, number] = [14, 108];
  const T: [number, number] = [136, 108];
  const O: [number, number] = [(A[0] + C[0] + T[0]) / 3, (A[1] + C[1] + T[1]) / 3];
  const toward = (v: [number, number], s: number): [number, number] => [O[0] + (v[0] - O[0]) * s, O[1] + (v[1] - O[1]) * s];
  const ring = (s: number) => [toward(A, s), toward(C, s), toward(T, s)].map((p) => p.join(",")).join(" ");
  const pa = toward(A, score.accuracy ?? 0);
  const pc = toward(C, score.cost ?? 0);
  const pt = toward(T, score.time ?? 0);
  const shape = [pa, pc, pt].map((p) => p.join(",")).join(" ");
  const vertex = (p: [number, number], s: number | null) =>
    s === null ? (
      <circle cx={p[0]} cy={p[1]} r={3.5} fill="var(--color-surface)" stroke="var(--t-fg-4)" strokeWidth="1.5" strokeDasharray="2 2" />
    ) : (
      <circle cx={p[0]} cy={p[1]} r={3.5} fill={color} stroke="var(--color-surface)" strokeWidth="2" />
    );
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={size} height={(size * H) / W} className="block" aria-hidden>
      <polygon points={ring(1 / 3)} fill="none" stroke="var(--t-line)" strokeWidth="1" />
      <polygon points={ring(2 / 3)} fill="none" stroke="var(--t-line)" strokeWidth="1" />
      <polygon points={ring(1)} fill="none" stroke="var(--t-fg-4)" strokeWidth="1.2" strokeLinejoin="round" />
      {[A, C, T].map((v, i) => (
        <line key={i} x1={O[0]} y1={O[1]} x2={v[0]} y2={v[1]} stroke="var(--t-line)" strokeWidth="1" />
      ))}
      <polygon points={shape} fill={color} fillOpacity="0.16" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      {vertex(pa, score.accuracy)}
      {vertex(pc, score.cost)}
      {vertex(pt, score.time)}
    </svg>
  );
}
