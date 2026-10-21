"use client";

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Status, Tag } from "./ui";
import { hueFor } from "@/lib/hue";
import { DoorError } from "@/lib/api/l5";
import { candidatesOf, getBlastRadius, getDependencies, type BlastRadius, type DepEdge, type DepMap, type DepNode } from "@/lib/api/l7";
import {
  APP_CLASS_TEXT,
  APP_SOURCE_TEXT,
  EDGE_KIND_TEXT,
  EVIDENCE_TEXT,
  KIND_ONE,
  USES_TEXT,
  adjacency,
  blastCountsLine,
  blastIds,
  blastRefusalText,
  drawnEnds,
  edgeLine,
  edgeLook,
  groupByLayer,
  healthOf,
  nodeTitle,
  pathText,
} from "@/lib/dependencies";
import { fmtUsd } from "@/lib/run-tree";

/**
 * The dependency map (phase L7, `GET /api/dependencies`): every agent, the
 * tools and servers it calls, the sub-agents it invokes, the peers it hands
 * work to, the models it uses, and the applications built on them. Each
 * edge is declared by the specs, seen in the journals of the window, or
 * both; a dashed edge was declared and never used, an amber one was used
 * without any spec declaring it. Read left to right in the direction of
 * dependence (lib/dependencies.ts LAYERS).
 *
 * Picking a node shows its neighbourhood and asks the backend for its blast
 * radius (`GET /api/dependencies/{node}/blast-radius`): every agent that
 * fails if it does, directly or through another agent, with the path; the
 * runs in flight; the applications. A key scoped to one agent cannot ask
 * for a blast radius (403), and says so. Reading only: nothing here changes
 * anything, so a viewer sees all of it.
 */

const WINDOWS = ["1h", "24h", "7d", "30d", "90d"] as const;
type Window = (typeof WINDOWS)[number];

const DOT: Record<string, string> = { ok: "bg-ok", warn: "bg-warn", err: "bg-err", neutral: "bg-line-strong" };
const STROKE: Record<string, string> = { line: "var(--color-line-strong)", warn: "var(--color-warn)", err: "var(--color-err)" };

function ago(iso: string | null): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function Dependencies() {
  return (
    <Suspense>
      <DependenciesInner />
    </Suspense>
  );
}

function DependenciesInner() {
  const params = useSearchParams();
  const router = useRouter();
  const [win, setWin] = useState<Window>("7d");
  const [map, setMap] = useState<DepMap | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  /** The nodes the picked node's blast radius passes through, lit on the map once the backend answers. */
  const [lit, setLit] = useState<{ node: string; ids: Set<string> } | null>(null);
  const picked = params.get("node") ?? "";

  const load = useCallback(() => {
    setLoading(true);
    getDependencies(win)
      .then((m) => {
        setMap(m);
        setError("");
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [win]);
  useEffect(() => {
    const id = setTimeout(load, 0);
    return () => clearTimeout(id);
  }, [load]);

  const pick = (id: string) => router.replace(id ? `/dependencies?node=${encodeURIComponent(id)}` : "/dependencies", { scroll: false });
  const byId = useMemo(() => new Map((map?.nodes ?? []).map((n) => [n.id, n])), [map]);
  const node = picked ? byId.get(picked) ?? null : null;

  return (
    <div className="mx-auto w-full max-w-[1520px] px-5 py-7" data-hue="indigo">
      <header className="flex flex-wrap items-end gap-4">
        <div className="flex max-w-[86ch] flex-col gap-1.5">
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">Dependencies</h1>
          <p className="text-[12.5px] leading-[1.6] text-dim">
            What every agent depends on, declared by its spec and seen in its runs: the tools it calls and the servers that serve them, the sub-agents it
            invokes, the peers it hands work to, the models it uses, and the applications built on them. Pick a node for its blast radius: everything that
            fails if it does.
          </p>
        </div>
        <span className="grow" />
        <span className="flex items-center gap-2">
          <span className="text-[10.5px] text-faint">Journals read from the last</span>
          <span role="radiogroup" aria-label="Window" className="inline-flex items-center gap-px rounded-sm border border-line bg-canvas p-px">
            {WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                role="radio"
                aria-checked={win === w}
                onClick={() => setWin(w)}
                className={`focusable rounded-[3px] px-1.5 py-0.5 font-mono text-[10px] transition-colors ${win === w ? "bg-ink text-on-ink" : "bg-surface text-faint hover:text-fg"}`}
              >
                {w}
              </button>
            ))}
          </span>
          <Button size="sm" variant="solid" tone="neutral" loading={loading} onClick={load}>
            Read again
          </Button>
        </span>
      </header>

      <section className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-4">
        {[
          { k: "Nodes", v: map?.counts.nodes },
          { k: "Edges", v: map?.counts.edges },
          { k: "Seen in the window", v: map?.counts.seen },
          { k: "Declared, never seen", v: map?.counts.declared_only },
        ].map((x) => (
          <div key={x.k} className="flex flex-col gap-0.5 bg-surface px-3 py-2.5">
            <span className="tnum text-[17px] leading-none font-semibold">{x.v ?? "…"}</span>
            <span className="text-[10.5px] text-faint">{x.k}</span>
          </div>
        ))}
      </section>

      <Legend />

      {error && <p className="mt-4 text-[12.5px] text-err">{error}</p>}

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <MapView map={map} picked={picked} lit={lit && lit.node === picked ? lit.ids : null} onPick={pick} />
        <SidePanel map={map} node={node} picked={picked} window={win} byId={byId} onPick={pick} onLit={(ids) => setLit(ids ? { node: picked, ids } : null)} />
      </div>
    </div>
  );
}

function Legend() {
  const line = (dash: string | undefined, color: string) => (
    <svg width="34" height="8" aria-hidden className="shrink-0">
      <path d="M1 4 H33" stroke={color} strokeWidth="2" strokeDasharray={dash} />
    </svg>
  );
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-faint">
      <span className="flex items-center gap-1.5">{line(undefined, STROKE.line)} declared and seen</span>
      <span className="flex items-center gap-1.5">{line("4 4", STROKE.line)} declared, not seen in the window</span>
      <span className="flex items-center gap-1.5">{line(undefined, STROKE.warn)} seen, not declared by any spec</span>
      <span className="flex items-center gap-1.5">{line(undefined, STROKE.err)} calls through it failed or were refused</span>
      <span className="flex items-center gap-1.5">
        <span className="size-2 rounded-[2px] bg-ok" /> healthy <span className="ml-1 size-2 rounded-[2px] bg-warn" /> degraded, paused, pending
        <span className="ml-1 size-2 rounded-[2px] bg-err" /> failing, blocked, changed <span className="ml-1 size-2 rounded-[2px] bg-line-strong" /> idle
      </span>
    </div>
  );
}

/* ═══════════════════ the map ═══════════════════ */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function MapView({ map, picked, lit, onPick }: { map: DepMap | null; picked: string; lit: Set<string> | null; onPick: (id: string) => void }) {
  const columns = useMemo(() => (map ? groupByLayer(map) : []), [map]);
  const host = useRef<HTMLDivElement>(null);
  const [geom, setGeom] = useState<{ w: number; h: number; rects: Map<string, Rect> }>({ w: 0, h: 0, rects: new Map() });

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const measure = () => {
      const b = el.getBoundingClientRect();
      const rects = new Map<string, Rect>();
      el.querySelectorAll<HTMLElement>("[data-node]").forEach((t) => {
        const r = t.getBoundingClientRect();
        rects.set(t.dataset.node!, { x: r.left - b.left, y: r.top - b.top, w: r.width, h: r.height });
      });
      setGeom({ w: el.scrollWidth, h: el.scrollHeight, rects });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [columns]);

  // What the pick lights up: its edges, and the nodes at their other ends.
  const near = useMemo(() => {
    if (!map || !picked) return null;
    const ids = new Set<string>([picked]);
    for (const e of map.edges) if (e.from === picked || e.to === picked) ids.add(e.from === picked ? e.to : e.from);
    return ids;
  }, [map, picked]);

  if (!map) return <div className="rounded-md border border-line bg-surface px-4 py-6 text-[12px] text-faint">Reading the map…</div>;
  if (!map.nodes.length) {
    return <div className="rounded-md border border-line bg-surface px-4 py-6 text-[12px] text-faint">Nothing is deployed or seen in this window: no agent, tool, model or application to map.</div>;
  }

  const paths = map.edges.map((e) => {
    const { from, to } = drawnEnds(e);
    const A = geom.rects.get(from);
    const B = geom.rects.get(to);
    if (!A || !B) return null;
    const look = edgeLook(e);
    // Lit: the picked node's own edges, and every edge along its blast radius.
    const touches = !picked || e.from === picked || e.to === picked || Boolean(lit?.has(e.from) && lit?.has(e.to));
    let d: string;
    if (Math.abs(A.x - B.x) < 4) {
      // Same column (an agent invoking another): out of the left side and back in.
      const x = A.x - 2;
      const y1 = A.y + A.h / 2;
      const y2 = B.y + B.h / 2;
      const bulge = Math.min(60, 18 + Math.abs(y2 - y1) / 6);
      d = `M ${x} ${y1} C ${x - bulge} ${y1}, ${x - bulge} ${y2}, ${B.x - 2} ${y2}`;
    } else if (B.x > A.x) {
      const x1 = A.x + A.w;
      const x2 = B.x;
      const k = Math.max(24, (x2 - x1) * 0.45);
      d = `M ${x1} ${A.y + A.h / 2} C ${x1 + k} ${A.y + A.h / 2}, ${x2 - k} ${B.y + B.h / 2}, ${x2} ${B.y + B.h / 2}`;
    } else {
      const x1 = A.x;
      const x2 = B.x + B.w;
      const k = Math.max(24, (x1 - x2) * 0.45);
      d = `M ${x1} ${A.y + A.h / 2} C ${x1 - k} ${A.y + A.h / 2}, ${x2 + k} ${B.y + B.h / 2}, ${x2} ${B.y + B.h / 2}`;
    }
    return { key: `${e.from}>${e.to}:${e.kind}`, d, look, opacity: picked ? (touches ? 0.95 : 0.08) : 0.45, width: look.width + (picked && touches ? 0.75 : 0) };
  });

  return (
    <div className="overflow-x-auto rounded-md border border-line bg-surface">
      <div ref={host} className="relative grid min-w-[880px] grid-cols-4 gap-x-16 px-10 py-4">
        <svg className="pointer-events-none absolute inset-0 z-0" width={geom.w} height={geom.h} viewBox={`0 0 ${Math.max(1, geom.w)} ${Math.max(1, geom.h)}`} aria-hidden>
          {paths.map((p) =>
            p ? <path key={p.key} d={p.d} fill="none" stroke={STROKE[p.look.tone]} strokeWidth={p.width} strokeDasharray={p.look.dash} strokeLinecap="round" opacity={p.opacity} /> : null,
          )}
        </svg>
        {columns.map((col) => (
          <div key={col.key} className="relative z-[1] flex min-w-0 flex-col gap-3">
            <span data-hue={hueFor(col.title)} className="flex items-baseline gap-2 border-b border-line pb-1.5">
              <span className="text-[11.5px] font-semibold text-fg">{col.title}</span>
              <span className="tnum text-[10.5px] text-faint">{col.count}</span>
            </span>
            {col.groups.length === 0 && <span className="text-[11px] text-ghost">none</span>}
            {col.groups.map((g) => (
              <div key={g.kind} className="flex flex-col gap-1.5">
                {col.groups.length > 1 && <span className="text-[10px] font-medium tracking-[.04em] text-faint uppercase">{g.title}</span>}
                {g.nodes.map((n) => (
                  <NodePill key={n.id} node={n} picked={picked === n.id} lit={Boolean(lit?.has(n.id))} dim={Boolean(near && !near.has(n.id) && !lit?.has(n.id))} onPick={() => onPick(picked === n.id ? "" : n.id)} />
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function NodePill({ node: n, picked, lit, dim, onPick }: { node: DepNode; picked: boolean; lit: boolean; dim: boolean; onPick: () => void }) {
  const h = healthOf(n.health);
  const { title, subtitle } = nodeTitle(n);
  return (
    <button
      type="button"
      data-node={n.id}
      onClick={onPick}
      aria-pressed={picked}
      title={`${n.id}\n${h.label}${n.detail ? ` · ${n.detail}` : ""}\n${n.count} ${n.kind === "agent" ? "runs" : "calls"} seen${n.failures ? `, ${n.failures} failed` : ""}${n.declared ? "" : " · not declared by any spec"}`}
      className={`focusable flex w-full min-w-0 cursor-pointer flex-col gap-0.5 rounded-md border bg-surface px-2.5 py-1.5 text-left transition-[opacity,border-color,box-shadow] duration-150 ${
        picked ? "border-ink shadow-[var(--shadow-2)]" : lit ? "border-err-line" : "border-line hover:border-line-strong"
      } ${lit && !picked ? "ring-2 ring-err/30" : ""} ${dim ? "opacity-35" : "opacity-100"}`}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span className={`size-2 shrink-0 rounded-[2px] ${DOT[h.tone]}`} />
        <span className="min-w-0 truncate text-[12px] font-medium text-fg">{title}</span>
        <span className="grow" />
        {n.count > 0 && (
          <span className={`tnum shrink-0 font-mono text-[10px] ${n.failures ? "text-err" : "text-faint"}`}>
            {n.count}
            {n.failures ? `/${n.failures}✕` : ""}
          </span>
        )}
      </span>
      {(subtitle || n.detail) && <span className="truncate pl-3.5 text-[10px] text-faint">{[subtitle, n.detail].filter(Boolean).join(" · ")}</span>}
    </button>
  );
}

/* ═══════════════════ the picked node and its blast radius ═══════════════════ */

function EdgeRows({ title, rows, byId, onPick, empty }: { title: string; rows: { edge: DepEdge; other: string }[]; byId: Map<string, DepNode>; onPick: (id: string) => void; empty: string }) {
  return (
    <div className="flex flex-col border-b border-line">
      <span className="px-4 pt-2.5 pb-1 text-[11px] font-semibold text-dim">
        {title} <span className="tnum font-normal text-faint">{rows.length}</span>
      </span>
      {rows.length === 0 && <span className="px-4 pb-2.5 text-[11px] text-ghost">{empty}</span>}
      {rows.map(({ edge: e, other }) => {
        const n = byId.get(other);
        const look = edgeLook(e);
        return (
          <span key={`${e.from}>${e.to}:${e.kind}`} className="flex flex-col gap-0.5 border-t border-line/60 px-4 py-1.5">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 text-[10.5px] text-faint">{EDGE_KIND_TEXT[e.kind]}</span>
              <button type="button" onClick={() => onPick(other)} className="focusable min-w-0 cursor-pointer truncate rounded-sm text-[12px] font-medium text-fg hover:underline">
                {n ? nodeTitle(n).title : other}
              </button>
              {n && <span className="shrink-0 text-[10px] text-ghost">{KIND_ONE[n.kind]}</span>}
              <span className="grow" />
              <span className={`shrink-0 text-[10px] ${look.tone === "warn" ? "text-warn" : e.evidence === "declared" ? "text-faint" : "text-dim"}`}>{EVIDENCE_TEXT[e.evidence]}</span>
            </span>
            <span className={`tnum font-mono text-[10.5px] ${look.tone === "err" ? "text-err" : "text-faint"}`}>
              {edgeLine(e, fmtUsd)} · last {ago(e.last_at)}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function SidePanel({
  map,
  node,
  picked,
  window,
  byId,
  onPick,
  onLit,
}: {
  map: DepMap | null;
  node: DepNode | null;
  picked: string;
  window: string;
  byId: Map<string, DepNode>;
  onPick: (id: string) => void;
  onLit: (ids: Set<string> | null) => void;
}) {
  if (!map) return null;
  if (!picked) {
    return (
      <aside className="flex flex-col gap-2 rounded-md border border-line bg-surface px-4 py-3.5">
        <span className="text-[12px] font-semibold text-fg">Pick a node</span>
        <span className="text-[11.5px] leading-[1.55] text-faint">
          Its neighbourhood (what it depends on, what depends on it, with how often each edge was used, what it cost, what failed) and its blast radius:
          every agent that fails if it does, directly or through another agent, the runs in flight, the applications.
        </span>
        {map.how && <span className="text-[10.5px] leading-[1.55] text-ghost">{map.how}.</span>}
      </aside>
    );
  }
  if (!node) {
    return (
      <aside className="flex flex-col gap-2 rounded-md border border-line bg-surface px-4 py-3.5">
        <span className="text-[12px] font-semibold text-fg">No node {picked} in this window</span>
        <span className="text-[11.5px] text-faint">Nothing declares it and no journal in the window shows it. Widen the window, or pick another node.</span>
        <span>
          <Button size="sm" variant="solid" tone="neutral" onClick={() => onPick("")}>
            Clear
          </Button>
        </span>
      </aside>
    );
  }
  const adj = adjacency(map, node.id);
  const h = healthOf(node.health);
  const { title, subtitle } = nodeTitle(node);
  return (
    <aside className="flex flex-col overflow-hidden rounded-md border border-line bg-surface lg:sticky lg:top-4">
      <div data-hue={hueFor(node.kind === "agent" ? "agent" : node.kind)} className="flex flex-col gap-1 border-b border-line bg-raise/55 px-4 py-2.5">
        <span className="flex min-w-0 items-center gap-2">
          <Tag>{KIND_ONE[node.kind]}</Tag>
          <span className="min-w-0 truncate text-[13px] font-semibold text-fg">{title}</span>
          <span className="grow" />
          <Button size="sm" variant="solid" tone="neutral" onClick={() => onPick("")}>
            Clear
          </Button>
        </span>
        {subtitle && <span className="text-[11px] text-faint">{subtitle}</span>}
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          <Status tone={h.tone === "neutral" ? "neutral" : h.tone}>{h.label}</Status>
          {node.detail && <span className="text-faint">{node.detail}</span>}
          <span className="tnum text-faint">
            {node.count} {node.kind === "agent" ? "runs" : "calls"} in {window}
            {node.failures ? `, ${node.failures} failed` : ""}
          </span>
          <span className="text-ghost">{node.declared && node.observed ? "declared and seen" : node.declared ? "declared only" : "seen only"}</span>
        </span>
        <span className="tnum font-mono truncate text-[10px] text-ghost">{node.id}</span>
        {node.kind === "agent" && (
          <span className="flex flex-wrap gap-1.5 pt-1">
            <Button size="sm" variant="solid" tone="neutral" href={`/drift?agent=${encodeURIComponent(node.id.slice(6))}`}>
              Drift
            </Button>
            <Button size="sm" variant="solid" tone="neutral" href={`/runs?agent=${encodeURIComponent(node.id.slice(6))}`}>
              Run it
            </Button>
          </span>
        )}
      </div>
      <EdgeRows title="Depends on" rows={adj.dependsOn} byId={byId} onPick={onPick} empty="Nothing: it depends on no other node on the map." />
      <EdgeRows title="Depended on by" rows={adj.dependedOnBy} byId={byId} onPick={onPick} empty="Nothing on the map depends on it." />
      <Blast id={node.id} window={window} byId={byId} onPick={onPick} onLit={onLit} />
    </aside>
  );
}

function Blast({ id, window, byId, onPick, onLit }: { id: string; window: string; byId: Map<string, DepNode>; onPick: (id: string) => void; onLit: (ids: Set<string> | null) => void }) {
  const [state, setState] = useState<{ key: string; blast: BlastRadius | null; error: string; status: number; candidates: string[] }>({ key: "", blast: null, error: "", status: 0, candidates: [] });
  const key = `${id}@${window}`;
  useEffect(() => {
    if (!id) return;
    let stop = false;
    getBlastRadius(id, window)
      .then((b) => {
        if (stop) return;
        setState({ key, blast: b, error: "", status: 200, candidates: [] });
        onLit(blastIds(b));
      })
      .catch((e) => {
        if (stop) return;
        const status = e instanceof DoorError ? e.status : 0;
        setState({ key, blast: null, error: blastRefusalText(status, (e as Error).message), status, candidates: candidatesOf(e) });
        onLit(null);
      });
    return () => {
      stop = true;
    };
    // onLit is the page's setter, stable in effect; the answer is asked again only for another node or window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, window, key]);

  const current = state.key === key ? state : null;
  const b = current?.blast ?? null;
  return (
    <div className="flex flex-col">
      <span data-hue="red" className="flex items-center gap-2 border-b border-line bg-raise/55 px-4 py-2">
        <span className="text-[12px] font-semibold">Blast radius</span>
        <span className="text-[10.5px] text-faint">if this fails</span>
      </span>
      {!current ? (
        <p className="px-4 py-2.5 text-[11.5px] text-faint">Asking the backend…</p>
      ) : !b ? (
        <div className="flex flex-col gap-1.5 px-4 py-2.5">
          <p className={`text-[11.5px] leading-[1.55] ${current.status === 403 ? "text-warn" : "text-err"}`}>{current.error}</p>
          {current.candidates.length > 0 && (
            <span className="flex flex-wrap gap-1.5">
              {current.candidates.map((c) => (
                <Button key={c} size="sm" variant="solid" tone="neutral" onClick={() => onPick(c)}>
                  {c}
                </Button>
              ))}
            </span>
          )}
        </div>
      ) : (
        <BlastView blast={b} byId={byId} onPick={onPick} />
      )}
    </div>
  );
}

/** A blast radius as the panel shows it: the counts, the agents with their paths, the runs in flight, the applications. Presentational, so tests render it from a captured answer. */
export function BlastView({ blast: b, byId, onPick }: { blast: BlastRadius; byId: Map<string, DepNode>; onPick: (id: string) => void }) {
  return (
    <div className="flex flex-col">
      <p className={`border-b border-line px-4 py-2 text-[11.5px] ${b.counts.agents ? "text-err" : "text-faint"}`}>{blastCountsLine(b)}</p>
      <span className="px-4 pt-2 pb-1 text-[11px] font-semibold text-dim">Agents</span>
      {b.agents.length === 0 && <span className="px-4 pb-2 text-[11px] text-ghost">No agent depends on it.</span>}
      {b.agents.map((a) => (
        <span key={a.id} className="flex flex-col gap-0.5 border-t border-line/60 px-4 py-1.5">
          <span className="flex items-center gap-2">
            <button type="button" onClick={() => onPick(a.id)} className="focusable cursor-pointer rounded-sm text-[12px] font-medium text-fg hover:underline">
              {a.agent}
            </button>
            <Tag tone={a.how === "direct" ? "err" : "warn"}>{a.how === "direct" ? "direct" : "through another agent"}</Tag>
          </span>
          <span className="text-[10.5px] leading-[1.5] text-faint">{pathText(a.via, byId)}</span>
        </span>
      ))}
      <span className="border-t border-line px-4 pt-2 pb-1 text-[11px] font-semibold text-dim">Runs in flight</span>
      {b.runs_in_flight.length === 0 && <span className="px-4 pb-2 text-[11px] text-ghost">None in flight.</span>}
      {b.runs_in_flight.map((r) => (
        <span key={r.run} className="flex flex-col gap-0.5 border-t border-line/60 px-4 py-1.5">
          <span className="flex min-w-0 items-center gap-2">
            <Link href={`/runs?id=${encodeURIComponent(r.run)}`} className="focusable min-w-0 truncate rounded-sm font-mono text-[11px] text-fg hover:underline">
              {r.run}
            </Link>
            <Status tone="run">{r.state}</Status>
            {r.called && <Tag tone="warn">already called it</Tag>}
          </span>
          <span className="text-[10.5px] text-faint">
            {r.agent} · {r.source || "console"} · {USES_TEXT[r.uses]}
          </span>
        </span>
      ))}
      <span className="border-t border-line px-4 pt-2 pb-1 text-[11px] font-semibold text-dim">Applications</span>
      {b.applications.length === 0 && <span className="px-4 pb-2.5 text-[11px] text-ghost">No application on the register.</span>}
      {b.applications.map((a) => (
        <span key={`${a.source}:${a.id}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-line/60 px-4 py-1.5 text-[11px]">
          <span className="font-medium text-fg">{a.name}</span>
          <span className="tnum font-mono text-[10px] text-ghost">{a.id}</span>
          <Tag>{APP_CLASS_TEXT[a.class] ?? a.class}</Tag>
          <span className="text-faint">{APP_SOURCE_TEXT[a.source] ?? a.source}</span>
          {a.via && a.via !== `application:${a.id}` && <span className="text-ghost">via {byId.get(a.via) ? nodeTitle(byId.get(a.via)!).title : a.via}</span>}
        </span>
      ))}
      {b.how && <p className="border-t border-line px-4 py-2 text-[10.5px] leading-[1.55] text-ghost">{b.how}.</p>}
    </div>
  );
}
