"use client";

import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { Spinner } from "./ui";
import { Thinking } from "./loaders";
import { HARNESS } from "@/lib/spec";
import { explainControl } from "@/lib/guardrails";
import { sandboxRunOf, SANDBOX_TOOL } from "@/lib/sandbox";
import { SandboxOutput } from "./sandbox-result";
import { ControlMark } from "./control-ref";
import { DrillModal } from "./drill";
import { Icon } from "./builder/icons";
import { RetrievalBody, retrievalOf } from "./run-retrieval";
import { modelCallOf, routeLine } from "./run-model";
import { foldRun, clock, fmtMs, summarise, prose, gist, type BoardEntry, type BoardNode, type BoardEdge, type NodeState, type Item, type Visit, type Rect } from "@/lib/run-fold";
export { foldRun, type BoardEntry, type BoardNode, type BoardEdge } from "@/lib/run-fold";

/**
 * The run as a flow of agents.
 *
 * The theatre reads a run as one transcript with a spine beside it. This
 * reads the same journal as the shape the run actually had: columns are
 * waves of execution (whatever sits in one column happened together),
 * vertical position is the branch, every tile is one visit of one agent.
 * A chain draws flat through the middle; parallel work fans out from a hub
 * into bands and converges; a sub-run is a band of its own; a loop is a
 * trace that leaves the bottom of the critic and returns under the line,
 * or, unfolded, a second tile further right. Nodes the run has not reached
 * are drawn from the spec as ghosts, so the plan and the path through it
 * are visible together, live and under the scrubber alike.
 *
 * Every branch keeps one lane, so a chain reads as a straight track and a
 * fan spreads around its hub. The frame decides the orientation: left to
 * right when every wave fits at a readable width, top to bottom with the
 * lanes side by side when it does not, one column wave by wave on a phone.
 *
 * Nothing expands in place. A click opens the agent's sheet.
 */

/* ═══════════════════ the board ═══════════════════ */

const TILE_MIN = 240;
const TILE_MAX = 380;
/** Between waves in a row: room for a loop's chip and a hand-off's curve. */
const GAP = 56;
const PAD = 40;
/** The wave label above a row. */
const RULER = 20;
/** Headroom a band's label needs above its first tile. */
const BAND_HEAD = 24;
/** A loop's return channel, outside the tiles. */
const CHANNEL = 26;
/** The slate across the top of the stage: state, chapter, timecode. */
const HUD = 26;

/**
 * How the waves fold onto the page. The run reads as a snake: waves run left
 * to right, wrap, and run back right to left, each row holding the lanes its
 * waves use. The fold picks the rows and the tile size so the whole run fits
 * the frame without scrolling, and when nothing fits, the one that comes
 * closest.
 */
interface Plan {
  K: number;
  rows: number;
  tileW: number;
  tileH: number;
  laneGap: number;
  rowGap: number;
  padTop: number;
  height: number;
  fits: boolean;
  lanesInRow: number[][];
  rowBase: number[];
  rowOf: (wave: number) => number;
  colOf: (wave: number) => number;
}

function planBoard(columns: Visit[][], waves: number, frameW: number, frameH: number, banded: boolean): Plan {
  const laneGap = banded ? 60 : 48;
  const rowGap = banded ? 92 : 68;
  const padTop = PAD + RULER + (banded ? BAND_HEAD : 0) + HUD;
  const W = frameW > 0 ? frameW : 1440;
  const H = frameH > 0 ? frameH : 0;
  const lanesIn = (from: number, to: number) => {
    const set = new Set<number>();
    for (let w = from; w <= to; w++) for (const v of columns[w - 1] ?? []) set.add(v.row);
    return [...set].sort((a, b) => a - b);
  };
  let fit: Plan | null = null;
  let spill: Plan | null = null;
  const seen = new Set<number>();
  for (let R = 1; R <= waves; R++) {
    const K = Math.ceil(waves / R);
    if (seen.has(K)) continue;
    seen.add(K);
    const usable = W - 2 * PAD - (K - 1) * GAP;
    if (K > 1 && usable < K * TILE_MIN) continue;
    const tileW = K === 1 ? Math.max(180, Math.min(TILE_MAX, usable)) : Math.max(TILE_MIN, Math.min(TILE_MAX, Math.floor(usable / K)));
    const tileH = Math.round(Math.max(140, Math.min(200, tileW * 0.5)));
    const rows = Math.ceil(waves / K);
    const lanesInRow = Array.from({ length: rows }, (_, r) => lanesIn(r * K + 1, Math.min(waves, (r + 1) * K)));
    let height = padTop + PAD + (rows - 1) * rowGap;
    for (const ls of lanesInRow) height += Math.max(1, ls.length) * tileH + Math.max(0, ls.length - 1) * laneGap;
    const rowBase: number[] = [];
    let base = 1;
    lanesInRow.forEach((ls, r) => {
      rowBase[r] = base;
      base += 2 * Math.max(1, ls.length) - 1 + (r < rows - 1 ? 1 : 0);
    });
    const plan: Plan = {
      K, rows, tileW, tileH, laneGap, rowGap, padTop, height,
      fits: H === 0 ? R === 1 : height <= H,
      lanesInRow, rowBase,
      rowOf: (w) => Math.floor((w - 1) / K),
      colOf: (w) => {
        const r = Math.floor((w - 1) / K);
        const c = w - 1 - r * K;
        return r % 2 ? K - 1 - c : c;
      },
    };
    if (plan.fits) {
      if (!fit || plan.tileW > fit.tileW) fit = plan;
    } else if (!spill || plan.height < spill.height) spill = plan;
  }
  return fit ?? spill!;
}

/** An orthogonal path through `pts` with rounded corners. */
function orth(pts: [number, number][], r = 8): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1], [cx, cy] = pts[i], [nx, ny] = pts[i + 1];
    const inLen = Math.hypot(cx - px, cy - py), outLen = Math.hypot(nx - cx, ny - cy);
    const k = Math.min(r, inLen / 2, outLen / 2);
    if (k < 1) { d += ` L ${cx} ${cy}`; continue; }
    const ax = cx - ((cx - px) / inLen) * k, ay = cy - ((cy - py) / inLen) * k;
    const bx = cx + ((nx - cx) / outLen) * k, by = cy + ((ny - cy) / outLen) * k;
    d += ` L ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`;
  }
  const [ex, ey] = pts[pts.length - 1];
  return d + ` L ${ex} ${ey}`;
}

function arrow(x: number, y: number, dir: "r" | "l" | "d" | "u"): string {
  return dir === "r" ? `M ${x - 7} ${y - 4} L ${x} ${y} L ${x - 7} ${y + 4} Z`
    : dir === "l" ? `M ${x + 7} ${y - 4} L ${x} ${y} L ${x + 7} ${y + 4} Z`
    : dir === "d" ? `M ${x - 4} ${y - 7} L ${x} ${y} L ${x + 4} ${y - 7} Z`
    : `M ${x - 4} ${y + 7} L ${x} ${y} L ${x + 4} ${y + 7} Z`;
}

/** Does a horizontal channel at y, spanning x0..x1, run through any tile? */
function blocked(rects: Rect[], x0: number, x1: number, y: number, pad = 8): boolean {
  const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
  return rects.some((r) => r.x < hi && r.x + r.w > lo && y > r.y - pad && y < r.y + r.h + pad);
}

interface Route { key: string; d: string; head: string; stroke: string; dash?: string; width: number; faint: boolean; mark?: { x: number; y: number; text: string; title?: string } }

export function RunBoard({
  nodes,
  edges,
  entries,
  allEntries,
  live,
  fold,
  plan: showPlan = true,
  clockT,
  onRestart,
  suspendedNode,
}: {
  nodes: BoardNode[];
  edges: BoardEdge[];
  entries: BoardEntry[];
  /** The whole journal when `entries` is a slice of it (a replay): the board is laid out for the whole run so cards keep their place as they appear. */
  allEntries?: BoardEntry[];
  live: boolean;
  fold: boolean;
  /** Draw the nodes the run has not reached yet, from the spec. Off for a replay: a card appears when its agent runs. */
  plan?: boolean;
  /** The replay clock, for the timecode. */
  clockT?: number;
  /** Play the replay again from the start. */
  onRestart?: () => void;
  suspendedNode?: string | null;
}) {
  const now = useMemo(() => foldRun(nodes, edges, entries, { live, fold, plan: showPlan }), [nodes, edges, entries, live, fold, showPlan]);
  const whole = useMemo(
    () => (allEntries && allEntries.length > entries.length ? foldRun(nodes, edges, allEntries, { live: false, fold, plan: showPlan }) : null),
    [nodes, edges, allEntries, entries.length, fold, showPlan],
  );
  // Geometry comes from the whole run when we have it; what is shown comes from now.
  const { traces, bands, byVisitId } = now;
  const waves = whole?.waves ?? now.waves;
  const at = (v: Visit) => (whole?.byVisitId.get(v.id) ?? v);
  const columns = useMemo(() => {
    const cols: Visit[][] = Array.from({ length: waves }, () => []);
    for (const v of now.columns.flat()) cols[Math.min(waves, at(v).wave) - 1].push(v);
    for (const col of cols) col.sort((a, b) => at(a).row - at(b).row);
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, whole, waves]);
  const planColumns = whole?.columns ?? now.columns;
  const maxT = useMemo(() => entries.reduce((m, e) => Math.max(m, e.t), 0), [entries]);
  const [open, setOpen] = useState<{ visit: Visit; filter: Filter } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState({ w: 0, h: 0 });
  const [geom, setGeom] = useState<{ w: number; h: number; rects: Map<string, Rect> }>({ w: 0, h: 0, rects: new Map() });

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setFrame({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    setFrame({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const banded = bands.length > 0;
  const plan = useMemo(() => planBoard(planColumns, waves, frame.w, frame.h, banded), [planColumns, waves, frame, banded]);

  // Every trace, band and ruler mark is drawn from where the tiles actually landed.
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => {
      const b = el.getBoundingClientRect();
      const rects = new Map<string, Rect>();
      el.querySelectorAll<HTMLElement>("[data-visit]").forEach((t) => {
        const r = t.getBoundingClientRect();
        rects.set(t.dataset.visit!, { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height });
      });
      setGeom({ w: el.scrollWidth, h: el.scrollHeight, rects });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [columns, plan]);

  /* ── the grid: rows of waves, each row its own lanes ── */
  const tracks: string[] = [];
  plan.lanesInRow.forEach((ls, r) => {
    const n = Math.max(1, ls.length);
    for (let i = 0; i < n; i++) {
      tracks.push("auto");
      if (i < n - 1) tracks.push(`${plan.laneGap}px`);
    }
    if (r < plan.rows - 1) tracks.push(`${plan.rowGap}px`);
  });
  const place = (v: Visit): CSSProperties => {
    const pos = at(v);
    const r = plan.rowOf(pos.wave);
    const li = Math.max(0, plan.lanesInRow[r]?.indexOf(pos.row) ?? 0);
    return { gridColumn: plan.colOf(pos.wave) + 1, gridRow: plan.rowBase[r] + 2 * li };
  };
  const hostStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: `repeat(${plan.K}, ${plan.tileW}px)`,
    gridTemplateRows: tracks.join(" "),
    columnGap: GAP,
    justifyContent: "center",
    alignItems: "stretch",
    padding: PAD,
    paddingTop: plan.padTop,
    width: "max-content",
    minWidth: "100%",
    minHeight: "100%",
  };

  /* ── geometry derived from the measured tiles ── */
  const rowTop: number[] = [], rowBottom: number[] = [];
  let gridLeft = Infinity, gridRight = -Infinity;
  for (const col of columns) {
    for (const v of col) {
      const r = geom.rects.get(v.id);
      if (!r) continue;
      const row = plan.rowOf(at(v).wave);
      rowTop[row] = Math.min(rowTop[row] ?? Infinity, r.y);
      rowBottom[row] = Math.max(rowBottom[row] ?? -Infinity, r.y + r.h);
      gridLeft = Math.min(gridLeft, r.x);
      gridRight = Math.max(gridRight, r.x + r.w);
    }
  }
  const allRects = useMemo(() => [...geom.rects.values()], [geom]);
  const rulers = columns.map((col, i) => {
    const rs = col.map((v) => geom.rects.get(v.id)).filter(Boolean) as Rect[];
    const ts = col.filter((v) => !v.ghost && v.enteredAt !== null).map((v) => v.enteredAt!);
    const row = plan.rowOf(i + 1);
    return rs.length ? { n: i + 1, x: Math.min(...rs.map((r) => r.x)), y: Math.min(...rs.map((r) => r.y)) - (banded ? BAND_HEAD : 0) - RULER, at: ts.length ? Math.min(...ts) : null, back: row % 2 === 1 } : null;
  });

  /* ── traces, routed around the snake ── */
  const routes: Route[] = [];
  const slots = new Map<number, number>();
  const channelY = (gap: number) => {
    const slot = slots.get(gap) ?? 0;
    slots.set(gap, slot + 1);
    // A gap below a row nobody has reached yet is measured from the row under it.
    const base = rowBottom[gap] ?? (rowTop[gap + 1] !== undefined ? rowTop[gap + 1] - plan.rowGap : 0);
    return base + 16 + (slot % 3) * 9;
  };
  traces.forEach((t) => {
    const A = geom.rects.get(t.from), B = geom.rects.get(t.to);
    const va = byVisitId.get(t.from), vb = byVisitId.get(t.to);
    if (!A || !B || !va || !vb) return;
    const stroke = t.kind === "done" ? "var(--color-ok)" : t.kind === "flow" ? "var(--color-run)" : t.kind === "closed" ? "var(--color-err)" : t.kind === "loopk" ? "rgba(var(--hue-indigo), 1)" : t.kind === "nest" ? "rgba(var(--hue-violet), .9)" : "var(--color-line-strong)";
    const dash = t.kind === "flow" ? "5 4" : t.kind === "closed" ? "2 3" : t.kind === "loopk" ? "4 3" : t.kind === "pending" ? "1.5 3.5" : undefined;
    const width = t.kind === "done" || t.kind === "flow" || t.kind === "loopk" ? 1.75 : 1.25;
    const ax = A.x + A.w / 2, bx = B.x + B.w / 2, ay = A.y + A.h / 2, by = B.y + B.h / 2;
    const wa = at(va).wave, wb = at(vb).wave;
    const rA = plan.rowOf(wa), rB = plan.rowOf(wb);
    const loop = wb < wa;
    const faint = !loop && wb - wa > 1 && t.kind !== "closed";
    let d = "", head = "", mark: Route["mark"];
    const times = t.kind === "loopk" ? /×(\d+)/.exec(t.label ?? "")?.[1] : undefined;
    const chip = t.kind === "loopk" ? `↺${times ? ` ×${times}` : ""}` : "";
    if (wa === wb) {
      // Two tiles in one wave: a short connector across the lane gap.
      const x = t.kind === "nest" ? A.x + A.w - 22 : ax;
      const down = B.y > A.y;
      d = down ? `M ${x} ${A.y + A.h} V ${B.y}` : `M ${x} ${A.y} V ${B.y + B.h}`;
      head = arrow(x, down ? B.y : B.y + B.h, down ? "d" : "u");
    } else if (rA === rB && !loop) {
      // A hand-off along the row, in whichever direction the row runs.
      if (bx > ax) {
        const x1 = A.x + A.w, x2 = B.x, k = Math.max(16, (x2 - x1) * 0.5);
        d = `M ${x1} ${ay} C ${x1 + k} ${ay}, ${x2 - k} ${by}, ${x2} ${by}`;
        head = arrow(x2, by, "r");
      } else {
        const x1 = A.x, x2 = B.x + B.w, k = Math.max(16, (x1 - x2) * 0.5);
        d = `M ${x1} ${ay} C ${x1 - k} ${ay}, ${x2 + k} ${by}, ${x2} ${by}`;
        head = arrow(x2, by, "l");
      }
    } else if (rA === rB) {
      // A loop inside the row: out of the tile, along a free channel, back
      // into the target. Under the tiles unless something sits there, then over.
      const others = allRects.filter((r) => r !== A && r !== B);
      const below = Math.max(A.y + A.h, B.y + B.h) + CHANNEL;
      const above = Math.min(A.y, B.y) - CHANNEL;
      const useBelow = !blocked(others, bx, ax, below) || blocked(others, bx, ax, above);
      const yC = useBelow ? below : above;
      d = useBelow
        ? orth([[ax, A.y + A.h], [ax, yC], [bx, yC], [bx, B.y + B.h]])
        : orth([[ax, A.y], [ax, yC], [bx, yC], [bx, B.y]]);
      head = arrow(bx, useBelow ? B.y + B.h : B.y, useBelow ? "u" : "d");
      mark = chip ? { x: (ax + bx) / 2, y: yC, text: chip, title: t.label } : undefined;
    } else if (!loop) {
      // Down to a later row: through the gap below this row, straight when the
      // next row is the one, by the snake's outer margin when it is not.
      const y1 = channelY(rA);
      if (rB === rA + 1) {
        d = orth([[ax, A.y + A.h], [ax, y1], [bx, y1], [bx, B.y]]);
      } else {
        const side = rA % 2 === 0 ? gridRight + 22 : gridLeft - 22;
        const y2 = channelY(rB - 1);
        d = orth([[ax, A.y + A.h], [ax, y1], [side, y1], [side, y2], [bx, y2], [bx, B.y]]);
      }
      head = arrow(bx, B.y, "d");
      mark = chip ? { x: (ax + bx) / 2, y: y1, text: chip, title: t.label } : undefined;
    } else {
      // Back up to an earlier row: through the gap above this row.
      const y1 = channelY(rA - 1);
      if (rB === rA - 1) {
        d = orth([[ax, A.y], [ax, y1], [bx, y1], [bx, B.y + B.h]]);
      } else {
        const side = rB % 2 === 0 ? gridRight + 22 : gridLeft - 22;
        const y2 = channelY(rB);
        d = orth([[ax, A.y], [ax, y1], [side, y1], [side, y2], [bx, y2], [bx, B.y + B.h]]);
      }
      head = arrow(bx, B.y + B.h, "u");
      mark = chip ? { x: (ax + bx) / 2, y: y1, text: chip, title: t.label } : undefined;
    }
    routes.push({ key: `${t.from}>${t.to}:${t.kind}`, d, head, stroke, dash, width, faint, mark });
  });

  /* ── the film: a replay plays; light follows the wave that is working ── */
  const cinematic = Boolean(allEntries);
  const playing = cinematic ? live : false;
  const shown = columns.flat();
  const activeVisit = shown.find((v) => v.state === "active" && !v.ghost) ?? shown.find((v) => v.state === "waiting" && !v.ghost);
  const activeWave = activeVisit ? at(activeVisit).wave : 0;
  const actors = shown.filter((v) => !v.ghost && (v.state === "active" || v.state === "waiting"));
  const atEnd = cinematic && !activeVisit && entries.length > 0 && entries.length >= (allEntries?.length ?? 0);
  const focusOf = (v: Visit): "on" | "near" | "off" => {
    if (!cinematic || !activeVisit) return "on";
    const w = at(v).wave;
    return w === activeWave ? "on" : w === activeWave - 1 ? "near" : "off";
  };
  const clockMs = clockT ?? maxT;
  const timecode = (() => {
    const s = Math.max(0, clockMs) / 1000;
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}.${Math.floor((s * 10) % 10)}`;
  })();
  const chapter = activeVisit
    ? `wave ${String(activeWave).padStart(2, "0")} / ${String(waves).padStart(2, "0")} · ${actors.map((v) => v.label).join(", ")}`
    : atEnd
      ? `${waves} waves · complete`
      : cinematic
        ? "standing by"
        : `${waves} waves`;
  const nowRect = (live || cinematic) && activeVisit ? geom.rects.get(activeVisit.id) : undefined;
  const nowRow = activeVisit ? plan.rowOf(at(activeVisit).wave) : 0;
  const nowBack = nowRow % 2 === 1;

  const tile = (v: Visit) => (
    <Tile
      key={v.id}
      v={v}
      live={live}
      maxT={maxT}
      suspended={suspendedNode === v.node}
      style={{ ...place(v), minHeight: plan.tileH }}
      roomy={plan.tileW >= 320}
      lines={plan.tileH >= 185 ? 3 : 2}
      focus={focusOf(v)}
      lit={(live || playing) && !v.ghost && (v.state === "active" || v.state === "waiting")}
      onOpen={(f) => setOpen({ visit: v, filter: f })}
    />
  );

  return (
    <>
      <div data-theme="dark" className="af-stage relative flex min-h-0 grow flex-col">
      {/* the slate: what is playing, which chapter, the timecode */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[5] flex items-center gap-3 px-5 pt-3 font-mono text-[10.5px] tracking-[.08em] text-faint uppercase">
        <span className="flex shrink-0 items-center gap-2">
          <span className={`size-1.5 rounded-[2px] ${playing || (live && !cinematic) ? "bg-run af-pulse" : "bg-line-strong"}`} />
          <span>{cinematic ? (playing ? "replay" : atEnd ? "end" : "paused") : live ? "live" : "run"}</span>
        </span>
        <span className="text-ghost">·</span>
        <span className="min-w-0 truncate">{chapter}</span>
        <span className="grow" />
        {cinematic && !playing && onRestart && (
          <button type="button" onClick={onRestart} className="focusable pointer-events-auto flex items-center gap-1.5 rounded-sm border border-line bg-raise px-2 py-0.5 text-[10.5px] tracking-[.06em] text-dim uppercase transition-colors hover:border-line-strong hover:text-fg">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M6 4.5v15l13-7.5z" /></svg>
            play from start
          </button>
        )}
        <span className="tnum shrink-0 text-[12.5px] tracking-normal text-fg">T+{timecode}</span>
      </div>
      <div ref={scroller} className="min-h-0 grow overflow-auto">
        <div ref={host} className="relative" style={hostStyle}>
          {/* bands: one tinted track per branch, split where the snake wraps */}
          {bands.flatMap((b) => {
            const byRow = new Map<number, Rect[]>();
            for (const id of b.visits) {
              const r = geom.rects.get(id), v = byVisitId.get(id);
              if (!r || !v) continue;
              const row = plan.rowOf(at(v).wave);
              byRow.set(row, [...(byRow.get(row) ?? []), r]);
            }
            return [...byRow.entries()].map(([row, rs]) => {
              const x = Math.min(...rs.map((r) => r.x)) - 10;
              const y = Math.min(...rs.map((r) => r.y)) - BAND_HEAD;
              const w = Math.max(...rs.map((r) => r.x + r.w)) - x + 10;
              const h = Math.max(...rs.map((r) => r.y + r.h)) - y + 10;
              return (
                <div key={`${b.id}:${row}`} data-hue={b.hue} className={`pointer-events-none absolute z-0 rounded-xl border ${b.dashed ? "border-dashed" : ""}`} style={{ left: x, top: y, width: w, height: h, background: "rgba(var(--hue), .06)", borderColor: "rgba(var(--hue), .28)" }}>
                  <span className="absolute top-[3px] left-2.5 max-w-[calc(100%-20px)] truncate font-mono text-[10px] leading-[18px] font-medium tracking-[.06em] uppercase" style={{ color: "rgba(var(--hue), 1)" }}>{b.label}</span>
                </div>
              );
            });
          })}

          {/* the wave ruler: when each wave began, and which way the row runs */}
          {rulers.map((r) =>
            r && (
              <span key={r.n} className="pointer-events-none absolute z-[3] flex items-baseline gap-1.5 font-mono text-[10.5px] leading-[16px] whitespace-nowrap transition-colors duration-500" style={{ left: r.x, top: r.y }}>
                <span className={r.at === null ? "text-ghost" : r.n === activeWave ? "text-run" : "text-faint"}>{r.back ? "←" : "→"}</span>
                <span className={r.at === null ? "text-ghost" : r.n === activeWave ? "font-semibold text-fg" : "font-medium text-faint"}>wave {r.n}</span>
                <span className="tnum text-ghost">{r.at === null ? "planned" : `+${fmtMs(r.at)}`}</span>
              </span>
            ),
          )}

          {/* now: where the live run is */}
          {nowRect && (
            <div className="af-now pointer-events-none absolute z-[3] border-l-[1.5px] border-dashed border-run opacity-80" style={{ left: nowBack ? nowRect.x + nowRect.w + GAP / 2 : nowRect.x - GAP / 2, top: (rowTop[nowRow] ?? nowRect.y) - 8, height: (rowBottom[nowRow] ?? nowRect.y + nowRect.h) - (rowTop[nowRow] ?? nowRect.y) + 16 }}>
              {!cinematic && <span className="absolute top-0 rounded-sm bg-canvas px-1.5 font-mono text-[10px] leading-[16px] whitespace-nowrap text-run" style={nowBack ? { left: 6 } : { right: 6 }}>now · {clock(maxT)}</span>}
            </div>
          )}

          <svg className="pointer-events-none absolute inset-0 z-[1]" width={geom.w} height={geom.h} viewBox={`0 0 ${Math.max(1, geom.w)} ${Math.max(1, geom.h)}`} aria-hidden>
            {routes.map((r) => (
              <g key={r.key} opacity={r.faint ? 0.5 : 1}>
                {r.dash ? (
                  <path d={r.d} fill="none" stroke={r.stroke} strokeWidth={r.width} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={r.dash} className={r.dash === "5 4" ? "af-flow" : "af-fade-in"} />
                ) : (
                  <path d={r.d} pathLength={1} fill="none" stroke={r.stroke} strokeWidth={r.width} strokeLinecap="round" strokeLinejoin="round" className="af-draw" />
                )}
                <path d={r.head} fill={r.stroke} className="af-fade-late" />
                {r.mark && (
                  <g className="af-fade-late">
                    {r.mark.title && <title>{r.mark.title}</title>}
                    <rect x={r.mark.x - (r.mark.text.length * 6.2 + 12) / 2} y={r.mark.y - 8} width={r.mark.text.length * 6.2 + 12} height={16} rx={4} fill="var(--color-surface)" stroke={r.stroke} strokeOpacity={0.6} />
                    <text x={r.mark.x} y={r.mark.y + 3.5} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="10" fontWeight="500" fill={r.stroke}>{r.mark.text}</text>
                  </g>
                )}
              </g>
            ))}
          </svg>

          {columns.flatMap((col) => col.map(tile))}
        </div>
      </div>
      </div>
      {open && <LedgerModal visit={open.visit} live={live} maxT={maxT} initial={open.filter} onClose={() => setOpen(null)} />}
    </>
  );
}

/* ═══════════════════ one tile ═══════════════════ */

function elapsed(v: Visit, live: boolean, maxT: number): string {
  if (v.ghost) return "";
  const end = v.exitedAt ?? (live ? maxT : v.lastT);
  return v.enteredAt === null ? "" : fmtMs(end - v.enteredAt);
}

const HARNESS_ICON: Record<string, "layers" | "bot" | "gavel"> = { sequence: "layers", delegate: "bot", await: "gavel" };
const fmtK = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function Tile({ v, live, maxT, suspended, style, roomy = false, lines = 2, focus = "on", lit = false, onOpen }: { v: Visit; live: boolean; maxT: number; suspended: boolean; style?: CSSProperties; roomy?: boolean; lines?: 2 | 3; focus?: "on" | "near" | "off"; lit?: boolean; onOpen: (f: Filter) => void }) {
  const harness = HARNESS[v.kind as keyof typeof HARNESS];
  const tools = v.items.filter((x) => x.kind === "tool");
  const refused = v.items.filter((x) => x.kind === "refused" || x.kind === "error").length;
  const thoughts = v.items.filter((x) => x.kind === "reasoning");
  const tainted = v.items.some((x) => x.kind === "taint");
  const tokens = thoughts.reduce((n, x) => n + (x.tokens ? x.tokens.in + x.tokens.out : 0), 0);
  const inFlight = v.state === "active" && live ? [...v.items].reverse().find((x) => x.kind === "tool" && !x.done) : undefined;
  const latestThought = [...thoughts].reverse()[0];
  const gate = [...v.items].reverse().find((x) => x.kind === "gate");
  const answer = [...v.items].reverse().find((x) => x.kind === "answer");
  const working = v.state === "active" && live;
  const waiting = v.state === "waiting" || suspended;
  const tone = waiting ? "text-warn" : working ? "text-run" : v.state === "done" ? (refused ? "text-warn" : "text-ok") : "text-faint";
  const gistLine = v.ghost
    ? v.state === "skipped" ? (v.guards?.length ? `route closed: ${v.guards[0]}` : "skipped") : "not reached yet"
    : inFlight
      ? inFlight.title
      : waiting
        ? (gate?.detail || gate?.title || "awaiting a person")
        : (() => {
            const last = [...tools].reverse().find((x) => x.result) ?? null;
            const lastThought = latestThought?.detail ? gist(latestThought.detail) : "";
            return lastThought || (last ? `${last.title} · ${summarise(last.result?.data?.value)}` : v.state === "done" ? "complete" : "starting");
          })();
  const stateWord = v.ghost ? (v.state === "skipped" ? "skipped" : "planned") : waiting ? "waiting" : working ? "working" : v.state === "active" ? "open" : refused ? "flagged" : "complete";
  const chip = "flex shrink-0 items-center gap-1 rounded-sm border px-1.5 font-mono text-[10px] leading-[17px]";
  // The step strip: one mark per thing the agent did, in order.
  const marks = v.items.filter((x) => x.kind === "tool" || x.kind === "reasoning" || x.kind === "refused" || x.kind === "error" || x.kind === "gate");
  const cap = roomy ? 26 : 16;
  const markCls = (x: Item) =>
    x.kind === "refused" || x.kind === "error" ? "bg-err"
    : x.kind === "gate" ? (x.done ? "bg-warn/70" : "bg-warn af-pulse")
    : x.kind === "reasoning" ? "border border-[rgba(var(--hue-indigo),.9)] bg-[rgba(var(--hue-indigo),.18)]"
    : x.done ? "bg-ok" : live ? "bg-run af-pulse" : "border border-line-strong";

  return (
    <button
      type="button"
      data-visit={v.id}
      data-focus={focus}
      data-lit={lit ? "true" : undefined}
      style={style}
      onClick={() => !v.ghost && onOpen("all")}
      title={v.ghost ? v.skippedWhy || undefined : `${v.label} · ${stateWord}`}
      className={`af-card-in focusable relative z-[2] flex w-full min-w-0 flex-col overflow-hidden rounded-lg border text-left ${
        v.ghost ? "cursor-default border-dashed border-line-strong bg-transparent" : waiting ? "border-warn/60 bg-warn-bg elev-1" : working ? "border-run/60 bg-surface elev-1" : "border-line bg-surface elev-1 hover:-translate-y-px hover:border-line-strong hover:shadow-[var(--shadow-2)]"
      }`}
    >
      <span className={`absolute inset-x-0 top-0 h-[3px] overflow-hidden ${v.ghost ? "" : "bg-line/60"}`} aria-hidden>
        {v.state === "done" && <span className={`af-wipe block h-full ${refused ? "bg-warn" : "bg-ok"}`} />}
        {working && <span className="af-indeterminate block h-full w-1/3 bg-run" />}
        {waiting && <span className="af-pulse block h-full bg-warn" />}
      </span>

      {/* who: the agent, how it is built, which model, how long */}
      <span className="flex flex-col gap-1 px-3.5 pt-3.5 pb-2.5">
        <span className="flex min-w-0 items-center gap-2">
          <StateDot state={v.state} live={live} ghost={v.ghost} />
          <span className={`min-w-0 grow truncate leading-[1.25] font-semibold tracking-[-0.01em] ${roomy ? "text-[15px]" : "text-[14px]"} ${v.ghost ? "text-faint" : "text-fg"}`}>{v.label}</span>
          {v.count > 1 && <span className={`${chip} border-[rgba(var(--hue-indigo),.5)] bg-raise text-[rgba(var(--hue-indigo),1)]`} title={`${v.count} visits — the loop sent the case back ${v.count - 1}×`}><Icon name="refresh" size={10} strokeWidth={2.2} />{v.count}</span>}
          {v.count === 1 && v.index > 1 && <span className={`${chip} border-[rgba(var(--hue-indigo),.5)] bg-raise text-[rgba(var(--hue-indigo),1)]`} title={`visit ${v.index}: the loop sent the case back`}><Icon name="refresh" size={10} strokeWidth={2.2} />{v.index}</span>}
          {v.fanCount ? <span className={`${chip} border-line-strong bg-raise text-dim`} title={`${v.fanCount} copies in parallel`}><Icon name="git" size={10} strokeWidth={2.2} />×{v.fanCount}</span> : null}
          {v.sub && <span className={`${chip} border-[rgba(var(--hue-violet),.5)] bg-raise text-[rgba(var(--hue-violet),1)]`} title={`a sub-run of ${v.sub.agent}`}><Icon name="workflow" size={10} strokeWidth={2.2} />sub</span>}
        </span>
        <span className="flex min-w-0 items-center gap-2 pl-[19px] text-[11.5px] leading-[1.3] text-faint">
          <span className="flex min-w-0 items-center gap-1 truncate">
            <Icon name={v.sub ? "workflow" : HARNESS_ICON[v.kind] ?? "layers"} size={11} className="shrink-0 text-faint" />
            <span className="truncate">{v.sub ? `${v.sub.agent} · sub-run` : harness?.name ?? v.kind}</span>
          </span>
          {v.model && !v.sub && (
            <span className="flex min-w-0 items-center gap-1 truncate">
              <Icon name="chip" size={11} className="shrink-0 text-faint" />
              <span className="truncate font-mono text-[10.5px]">{v.model}</span>
            </span>
          )}
          <span className="grow" />
          {!v.ghost && (
            <span className={`tnum flex shrink-0 items-center gap-1 font-mono text-[11px] ${tone}`}>
              <Icon name="clock" size={11} className="shrink-0" />
              {elapsed(v, live, maxT)}
            </span>
          )}
        </span>
      </span>

      <span className={`mx-3.5 border-t ${v.ghost ? "border-dashed border-line" : "border-line/80"}`} aria-hidden />

      {/* what: what it is doing or what came of it; every step as a mark; the count */}
      <span className="flex grow flex-col gap-2 px-3.5 pt-2.5 pb-3">
        <span className={`flex min-w-0 items-start gap-2 leading-[1.45] ${roomy ? "text-[13px]" : "text-[12.5px]"} ${working ? "text-run" : waiting ? "text-warn" : v.ghost ? "text-ghost" : "text-mist"}`}>
          {inFlight ? <span className="mt-[3px] shrink-0"><Spinner size={11} /></span>
            : working ? <span className="mt-[5px] shrink-0"><Thinking height={8} /></span>
            : waiting ? <Icon name="bell" size={12} className="mt-[3px] shrink-0 text-warn" />
            : !v.ghost && latestThought && !inFlight ? <Icon name="prompt" size={12} className="mt-[3px] shrink-0 text-faint" />
            : !v.ghost && tools.length ? <Icon name="plug" size={12} className="mt-[3px] shrink-0 text-faint" />
            : null}
          <span key={gistLine} className={`af-fade-in ${lines === 3 ? "line-clamp-3" : "line-clamp-2"} min-w-0 grow break-words`}>{gistLine}</span>
        </span>

        {marks.length > 0 && (
          <span className="flex items-center gap-2" title={`${marks.length} steps: tools, model calls, refusals, gates — in order`}>
            <span className="flex min-w-0 flex-wrap items-center gap-[3px]">
              {marks.slice(0, cap).map((x) => <span key={x.id} className={`af-mark-in size-[7px] shrink-0 rounded-[1.5px] ${markCls(x)}`} />)}
              {marks.length > cap && <span className="font-mono text-[9.5px] leading-none text-ghost">+{marks.length - cap}</span>}
            </span>
            <span className="grow" />
            <span className="tnum shrink-0 font-mono text-[10px] text-ghost">{marks.length} step{marks.length === 1 ? "" : "s"}</span>
          </span>
        )}

        {v.fanItems && v.fanItems.length > 0 && (
          <span className="flex flex-col gap-1 border-t border-dashed border-line pt-2">
            {v.fanItems.slice(0, 4).map((fi) => (
              <span key={fi.index} className="flex items-center gap-2 text-[11px] leading-[1.3] text-dim">
                <span className={`size-[6px] shrink-0 rounded-[1.5px] ${fi.state === "failed" ? "bg-err" : fi.state === "done" ? "bg-ok" : "bg-run af-pulse"}`} />
                <span className="min-w-0 grow truncate">{fi.label}</span>
              </span>
            ))}
            {v.fanItems.length > 4 && <span className="font-mono text-[10px] text-ghost">+{v.fanItems.length - 4} more</span>}
          </span>
        )}

        {!v.ghost ? (
          <span className="mt-auto flex flex-wrap items-center gap-x-2.5 gap-y-1 pt-1 font-mono text-[10.5px] text-ghost">
            {tools.length > 0 && <span className="tnum flex items-center gap-1 whitespace-nowrap" title={`${tools.length} tool calls`}><Icon name="plug" size={11} className="text-faint" />{tools.length}</span>}
            <span className="tnum flex items-center gap-1 whitespace-nowrap" title={`${thoughts.length} model calls`}><Icon name="prompt" size={11} className="text-faint" />{thoughts.length}</span>
            {refused > 0 && <span className="tnum flex items-center gap-1 whitespace-nowrap text-err" title={`${refused} refused or failed`}><Icon name="cross" size={11} strokeWidth={2.2} />{refused}</span>}
            {tokens > 0 && <span className="tnum flex items-center gap-1 whitespace-nowrap" title={`${tokens.toLocaleString()} tokens in and out`}><Icon name="chip" size={11} className="text-faint" />{fmtK(tokens)}</span>}
            {(v.inputs?.length || v.emitted?.length) ? (
              <span className="tnum flex items-center gap-1 whitespace-nowrap" title={`received ${v.inputs?.join(", ") || "nothing"} · handed on ${v.emitted?.join(", ") || "nothing yet"}`}>
                <Icon name="exchange" size={11} className="text-faint" />{v.inputs?.length ?? 0}→{v.emitted?.length ?? 0}
              </span>
            ) : null}
            {tainted && <span className="flex items-center gap-1 whitespace-nowrap text-warn" title="handled content authored outside the system"><Icon name="globe" size={11} /></span>}
            {answer && <span className="flex items-center gap-1 whitespace-nowrap text-ok" title={answer.detail || answer.title}><Icon name="gavel" size={11} /></span>}
            <span className="grow" />
            <span className={`flex items-center gap-1 whitespace-nowrap ${tone}`}>
              {v.state === "done" && !refused && (
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5 10 17.5 19 7" /></svg>
              )}
              {stateWord}
            </span>
          </span>
        ) : (
          <span className="mt-auto flex items-center pt-1 font-mono text-[10.5px] text-ghost">
            <span className="flex items-center gap-1"><Icon name={HARNESS_ICON[v.kind] ?? "layers"} size={11} />{harness?.name ?? v.kind}</span>
            <span className="grow" />
            <span>{stateWord}</span>
          </span>
        )}
      </span>
    </button>
  );
}

function StateDot({ state, live, ghost }: { state: NodeState; live: boolean; ghost: boolean }) {
  if (ghost) return <span className="size-[11px] shrink-0 rounded-[2px] border-[1.5px] border-dashed border-line-strong" />;
  if (state === "active" && live) {
    return (
      <span className="relative flex size-[11px] shrink-0">
        <span className="absolute inline-flex size-[11px] animate-ping rounded-[2px] bg-run opacity-60" />
        <span className="relative inline-flex size-[11px] rounded-[2px] border-[1.5px] border-run bg-surface" />
      </span>
    );
  }
  const cls = state === "done" ? "border-ok bg-ok" : state === "waiting" ? "border-warn bg-warn" : state === "active" ? "border-run bg-surface" : "border-line-strong bg-surface";
  return <span className={`size-[11px] shrink-0 rounded-[2px] border-[1.5px] ${cls}`} />;
}

/* ═══════════════════ the sheet ═══════════════════ */

type Filter = "all" | "tools" | "thoughts" | "refused";
const FILTER_KINDS: Record<Filter, Item["kind"][] | null> = { all: null, tools: ["tool"], thoughts: ["reasoning"], refused: ["refused", "error"] };

interface Row extends Item { count: number; allDone: boolean; members: Item[] }
function compress(items: Item[]): Row[] {
  const out: Row[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && it.kind === "tool" && last.kind === "tool" && last.title === it.title) {
      last.count += 1;
      last.members.push(it);
      last.allDone = last.allDone && it.done;
      last.ms = (last.ms ?? 0) + (it.ms ?? 0);
      last.result = it.result ?? last.result;
      continue;
    }
    out.push({ ...it, count: 1, allDone: it.done, members: [it] });
  }
  return out;
}

function Glyph({ row, live }: { row: Row; live: boolean }) {
  const common = { width: 12, height: 12, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (row.kind === "tool" && !row.allDone) return live ? <Spinner size={10} /> : <span className="size-[9px] rounded-full border-[1.5px] border-line-strong" />;
  // A call closed by a refusal or a failure after it was recorded is not a success.
  if (row.kind === "tool" && row.members.some((m) => m.outcome)) return <svg {...common} className="text-err"><path d="M7 7l10 10M17 7L7 17" /></svg>;
  if (row.kind === "tool" || row.kind === "answer" || (row.kind === "gate" && row.done)) return <svg {...common} className="text-ok"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
  if (row.kind === "refused" || row.kind === "error") return <svg {...common} className="text-err"><path d="M7 7l10 10M17 7L7 17" /></svg>;
  if (row.kind === "gate") return <span className="size-[9px] rounded-full border-[1.5px] border-warn" />;
  if (row.kind === "taint") return <span className="size-[7px] rotate-45 rounded-[1px] bg-warn" />;
  if (row.kind === "reasoning") return <span className="size-[7px] rounded-full bg-run" />;
  return <span className="size-[5px] rounded-full bg-line-strong" />;
}

function lineText(row: Row): { main: React.ReactNode; sub?: string; cls: string } {
  switch (row.kind) {
    case "tool":
      return { main: <span className="font-mono">{row.title}{row.count > 1 ? <span className="text-faint"> ×{row.count}</span> : null}</span>, sub: row.result ? summarise(row.result.data?.value) : undefined, cls: "text-fg" };
    case "reasoning": {
      // The model that was called, on every model call.
      const m = row.call ? modelCallOf(row.call) : null;
      return { main: m?.model ? <span>thought <span className="font-mono text-dim">{m.model}</span>{m.provider ? <span className="text-faint"> on {m.provider}</span> : null}</span> : "thought", sub: row.detail ? gist(row.detail) : undefined, cls: "text-run" };
    }
    case "refused":
      return { main: <span>refused <span className="font-mono text-fg">{row.title}</span></span>, sub: row.detail, cls: "text-err" };
    case "error":
      return { main: row.title, sub: row.detail, cls: "text-err" };
    case "gate":
      return { main: row.done ? "decision received" : "awaiting a decision", sub: row.detail, cls: "text-warn" };
    case "answer":
      return { main: row.title, sub: row.detail, cls: "text-fg" };
    case "taint":
      return { main: "untrusted content", sub: row.detail, cls: "text-warn" };
    default:
      return { main: row.title, sub: row.detail, cls: "text-dim" };
  }
}

function LedgerModal({ visit: v, live, maxT, initial, onClose }: { visit: Visit; live: boolean; maxT: number; initial: Filter; onClose: () => void }) {
  const harness = HARNESS[v.kind as keyof typeof HARNESS];
  const rows = useMemo(() => compress(v.items), [v.items]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>(initial);
  const tools = v.items.filter((x) => x.kind === "tool").length;
  const thoughts = v.items.filter((x) => x.kind === "reasoning").length;
  const refused = v.items.filter((x) => x.kind === "refused" || x.kind === "error").length;
  const kinds = FILTER_KINDS[filter];
  const shown = kinds ? rows.filter((r) => kinds.includes(r.kind)) : rows;
  const chips: { id: Filter; label: string; n: number }[] = [
    { id: "all", label: "All", n: rows.length },
    { id: "tools", label: "Tools", n: tools },
    { id: "thoughts", label: "Thoughts", n: thoughts },
    { id: "refused", label: "Refused", n: refused },
  ];
  const state = v.state === "done" ? `complete in ${elapsed(v, live, maxT)}` : v.state === "waiting" ? "awaiting a person" : v.state === "active" ? `working · ${elapsed(v, live, maxT)}` : v.state;
  return (
    <DrillModal
      title={`${v.label}${v.count > 1 ? ` · ${v.count} visits` : v.index > 1 ? ` · ${v.index}` : ""}`}
      subtitle={`${v.sub ? `${v.sub.agent} sub-run · ` : ""}${harness?.name ?? v.kind}${v.model ? ` on ${v.model}` : ""} · ${state}${tools ? ` · ${tools} tool call${tools === 1 ? "" : "s"}` : ""}${refused ? ` · ${refused} refused` : ""}${v.fanCount ? ` · fan-out ×${v.fanCount}` : ""}`}
      count={shown.length}
      onClose={onClose}
      actions={
        <span role="radiogroup" aria-label="Show" className="inline-flex items-center gap-px rounded-md border border-line bg-raise p-px">
          {chips.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={filter === c.id} onClick={() => setFilter(c.id)}
              className={`focusable cursor-pointer rounded-sm px-2 py-0.5 text-[11px] transition-colors duration-100 ${filter === c.id ? "bg-surface font-semibold text-fg shadow-[var(--shadow-1)]" : `font-medium hover:text-dim ${c.id === "refused" && c.n ? "text-err" : "text-faint"}`}`}>
              {c.label} <span className="tnum font-mono text-[10px] opacity-70">{c.n}</span>
            </button>
          ))}
        </span>
      }
    >
      {v.fanItems && v.fanItems.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2.5">
          {v.fanItems.map((fi) => (
            <span key={fi.index} className={`inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 text-[10.5px] ${fi.state === "failed" ? "border-err/40 text-err" : "border-line text-dim"}`}>
              <span className={`size-[5px] rounded-[1px] ${fi.state === "failed" ? "bg-err" : fi.state === "done" ? "bg-ok" : "bg-run"}`} />
              {fi.label}
            </span>
          ))}
        </div>
      )}
      <ol className="flex flex-col divide-y divide-line">
        {shown.map((r) => {
          const t = lineText(r);
          const isOpen = openId === r.id;
          const canOpen = r.kind === "tool" || r.kind === "reasoning" || r.kind === "refused" || r.kind === "error";
          return (
            <li key={r.id}>
              <button type="button" onClick={() => canOpen && setOpenId(isOpen ? null : r.id)} className={`focusable flex w-full items-center gap-3 px-4 py-2 text-left ${canOpen ? "cursor-pointer hover:bg-raise/40" : "cursor-default"}`}>
                <span className="tnum w-10 shrink-0 font-mono text-[10px] text-ghost">{clock(r.t)}</span>
                <span className="grid size-3.5 shrink-0 place-items-center"><Glyph row={r} live={live} /></span>
                <span className={`min-w-0 grow truncate text-[12px] ${t.cls}`}>
                  {t.main}
                  {t.sub && !isOpen && <span className="text-faint"> · {t.sub}</span>}
                </span>
                {r.control && <ControlMark control={r.control} />}
                <span className={`tnum shrink-0 font-mono text-[10px] ${r.kind === "tool" && !r.allDone && live ? "text-run" : "text-ghost"}`}>
                  {r.kind === "tool" && !r.allDone && live ? fmtMs(maxT - r.t) : r.allDone && r.ms !== undefined ? fmtMs(r.ms) : ""}
                </span>
              </button>
              {isOpen && (
                <div className="flex flex-col gap-2 bg-canvas px-4 py-3 pl-[72px]">
                  {r.kind === "tool" && r.members.map((m, i) => {
                    // An isolated `sandbox.execute` (phase L6): its facts above its output.
                    const sandbox = m.result && m.result.data?.tool === SANDBOX_TOOL ? sandboxRunOf(m.result.data?.value) : null;
                    // A retrieval call: the sources consulted and the passages returned.
                    const retrieval = m.result ? retrievalOf(String(m.result.data?.tool ?? ""), m.result.data?.value) : null;
                    return (
                      <div key={m.id} className="flex flex-col gap-1.5">
                        {r.count > 1 && <span className="font-mono text-[10px] text-faint">call {i + 1} of {r.count} · {m.outcome ? m.outcome : m.done && m.ms !== undefined ? fmtMs(m.ms) : "no result"}</span>}
                        {r.count === 1 && m.outcome && <span className="text-[11px] text-err">{m.outcome === "refused" ? "Refused after the call was recorded." : "Failed after the call was recorded."}</span>}
                        <Args args={m.call?.data?.args ?? {}} />
                        {sandbox ? (
                          <SandboxOutput run={sandbox} />
                        ) : retrieval ? (
                          <RetrievalBody r={retrieval} />
                        ) : (
                          m.result && (
                            <pre className="max-h-[320px] overflow-auto rounded-md border border-line bg-sunken/40 p-2.5 font-mono text-[10.5px] leading-[1.55] whitespace-pre-wrap text-mist">
                              {typeof m.result.data?.value === "string" ? m.result.data.value : JSON.stringify(m.result.data?.value ?? null, null, 2)}
                            </pre>
                          )
                        )}
                      </div>
                    );
                  })}
                  {r.kind === "reasoning" && r.call && routeLine(modelCallOf(r.call)) && <p className="font-mono text-[10.5px] leading-[1.5] break-words text-faint">{routeLine(modelCallOf(r.call))}</p>}
                  {r.kind === "reasoning" && <Thought text={r.detail ?? ""} />}
                  {(r.kind === "refused" || r.kind === "error") && (
                    <div className="flex flex-col gap-1">
                      {r.detail && <p className="text-[12px] leading-[1.55] text-fg">{r.detail}</p>}
                      {r.control && <p className="text-[11px] leading-[1.5] text-faint">{explainControl(r.control).name} decides: {explainControl(r.control).decides}</p>}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {shown.length === 0 && <li className="px-4 py-6 text-center text-[12px] text-faint">{rows.length ? "Nothing of this kind for this agent." : "Nothing recorded for this agent."}</li>}
      </ol>
    </DrillModal>
  );
}

function Args({ args }: { args: Record<string, unknown> }) {
  const rows = Object.entries(args).slice(0, 8);
  if (!rows.length) return <span className="text-[10.5px] text-ghost">no arguments</span>;
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="truncate font-mono text-[10.5px] text-faint">{k}</dt>
          <dd className="truncate font-mono text-[10.5px] text-fg">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
        </div>
      ))}
      {Object.keys(args).length > 8 && <span className="col-span-2 text-[10px] text-ghost">+{Object.keys(args).length - 8} more</span>}
    </dl>
  );
}

function Thought({ text }: { text: string }) {
  const p = prose(text);
  if (typeof p === "string") return <p className="max-w-[72ch] text-[12.5px] leading-[1.6] whitespace-pre-wrap text-mist">{p}</p>;
  return (
    <div className="flex max-w-[72ch] flex-col gap-1">
      {p.slice(0, 14).map(([k, v], i) => (
        <p key={i} className="text-[12.5px] leading-[1.55] text-mist">
          <span className="font-medium text-fg">{k}:</span> {v.length > 600 ? v.slice(0, 597) + "…" : v}
        </p>
      ))}
    </div>
  );
}

/* ═══════════════════ the view switch ═══════════════════ */

export type RunView = "theatre" | "cards";

/* The two preferences live in localStorage and are read through an external
   store, so the server renders the default and the client takes over after
   hydration without a state write inside an effect. */
const prefListeners = new Set<() => void>();
const subscribePrefs = (fn: () => void) => {
  prefListeners.add(fn);
  return () => prefListeners.delete(fn);
};
function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* no storage */
  }
  prefListeners.forEach((fn) => fn());
}

export function useRunView(): [RunView, (v: RunView) => void, boolean, (f: boolean) => void] {
  const view = useSyncExternalStore(
    subscribePrefs,
    () => (readPref("af.runs.view") === "cards" ? "cards" : "theatre") as RunView,
    () => "theatre" as RunView,
  );
  const fold = useSyncExternalStore(subscribePrefs, () => readPref("af.runs.fold") === "1", () => false);
  return [view, (v) => writePref("af.runs.view", v), fold, (f) => writePref("af.runs.fold", f ? "1" : "0")];
}

export function ViewSwitch({ view, setView, fold, setFold }: { view: RunView; setView: (v: RunView) => void; fold: boolean; setFold: (f: boolean) => void }) {
  const seg = (on: boolean) => `focusable cursor-pointer rounded-sm px-2 py-0.5 text-[11px] transition-colors duration-100 ${on ? "bg-surface font-semibold text-fg shadow-[var(--shadow-1)]" : "font-medium text-faint hover:text-dim"}`;
  return (
    <span className="flex items-center gap-2">
      <span role="radiogroup" aria-label="View" className="inline-flex items-center gap-px rounded-md border border-line bg-raise p-px">
        <button type="button" role="radio" aria-checked={view === "theatre"} onClick={() => setView("theatre")} className={seg(view === "theatre")}>Theatre</button>
        <button type="button" role="radio" aria-checked={view === "cards"} onClick={() => setView("cards")} className={seg(view === "cards")}>Agents</button>
      </span>
      {view === "cards" && (
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-dim select-none">
          <input type="checkbox" checked={fold} onChange={(e) => setFold(e.target.checked)} className="accent-[var(--color-ink)]" />
          Fold loops
        </label>
      )}
    </span>
  );
}
