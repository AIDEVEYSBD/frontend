"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Spinner } from "./ui";
import { Thinking } from "./loaders";
import { HARNESS } from "@/lib/spec";
import { explainControl } from "@/lib/guardrails";
import { ControlRef } from "./control-ref";
import { DrillModal } from "./drill";

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
 * Nothing expands in place. A click opens the agent's sheet.
 */

export interface BoardEntry {
  id: string;
  t: number;
  kind: string;
  node?: string;
  title?: string;
  detail?: string;
  tainted?: boolean;
  data?: { tool?: string; args?: Record<string, unknown>; value?: unknown; [k: string]: unknown };
}
export interface BoardNode { id: string; label: string; kind: string }
export interface BoardEdge { source: string; target: string; when?: string; label?: string }

type NodeState = "pending" | "active" | "done" | "skipped" | "waiting";

interface Item {
  id: string;
  t: number;
  kind: "tool" | "reasoning" | "refused" | "taint" | "gate" | "note" | "error" | "answer";
  title: string;
  detail?: string;
  result?: BoardEntry;
  call?: BoardEntry;
  control?: string;
  done: boolean;
  ms?: number;
}

interface FanItem { index: number; label: string; state: "active" | "done" | "failed" }

interface Visit {
  id: string;
  node: string;
  label: string;
  kind: string;
  index: number;
  count: number;
  enteredAt: number | null;
  exitedAt: number | null;
  lastT: number;
  state: NodeState;
  items: Item[];
  model: string;
  fanCount?: number;
  fanItems?: FanItem[];
  sub?: { agent: string; parent: string };
  skippedWhy?: string;
  guards?: string[];
  ghost: boolean;
  wave: number;
  row: number;
}

interface Trace { from: string; to: string; kind: "done" | "flow" | "pending" | "closed" | "loopk" | "nest"; label?: string }
interface Band { id: string; visits: string[]; hue: string; label: string; dashed?: boolean }
type Rect = { x: number; y: number; w: number; h: number };

const TRACK_HUES = ["teal", "blue", "red", "green", "amber", "indigo"];

const clock = (ms: number) => {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};
const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60_000).toFixed(1)}m`);

function summarise(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") {
    const flat = value.replace(/\s+/g, " ").trim();
    return flat.length > 110 ? flat.slice(0, 107) + "…" : flat;
  }
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.results)) return `${v.results.length} result${v.results.length === 1 ? "" : "s"}`;
    if (Array.isArray(v.rows)) return `${v.rows.length} row${v.rows.length === 1 ? "" : "s"}`;
    if (v.written === true && v.where) return `wrote ${String(v.where).split("/").pop()}`;
    if (v.task_id) return `task ${String(v.task_id)} · ${String(v.state ?? "")}`.trim();
    const keys = Object.keys(v);
    return keys.length ? keys.slice(0, 5).join(" · ") + (keys.length > 5 ? " · …" : "") : "empty";
  }
  return String(value);
}

/** A model's reply as prose: a JSON decision becomes key: value lines. */
function prose(text: string): [string, string][] | string {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  if (!trimmed.startsWith("{")) return text;
  try {
    const v = JSON.parse(trimmed);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.entries(v as Record<string, unknown>).map(([k, x]) => [k.replace(/_/g, " "), typeof x === "string" ? x : summarise(x)]);
    }
  } catch {
    /* the journal clips long completions mid-string: read what fields it can by grammar */
  }
  const out: [string, string][] = [];
  const keyRe = /"([a-zA-Z0-9_.-]+)"\s*:\s*/g;
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(trimmed))) {
    const rest = trimmed.slice(keyRe.lastIndex);
    if (rest.startsWith('"')) {
      let value = "";
      let i = 1;
      for (; i < rest.length; i++) {
        const c = rest[i];
        if (c === "\\" && i + 1 < rest.length) { value += rest[i + 1] === "n" ? " " : rest[i + 1]; i++; }
        else if (c === '"') break;
        else value += c;
      }
      out.push([m[1].replace(/_/g, " "), value]);
      keyRe.lastIndex += i;
    } else {
      const lit = rest.match(/^(-?\d+(?:\.\d+)?|true|false|null)/);
      if (lit) out.push([m[1].replace(/_/g, " "), lit[1]]);
    }
  }
  // Nested objects produce their inner keys too; the first few are the summary.
  return out.length ? out : text;
}
function gist(text: string): string {
  const p = prose(text);
  const line = typeof p === "string" ? p : p.length ? `${p[0][0]}: ${p[0][1]}` : "";
  const flat = line.replace(/\s+/g, " ").trim();
  return flat.length > 90 ? flat.slice(0, 87) + "…" : flat;
}

/* ═══════════════════ folding the journal into visits ═══════════════════ */

function newVisit(node: string, label: string, kind: string, index: number, t: number): Visit {
  return { id: `${node}#${index}`, node, label, kind, index, count: 1, enteredAt: t, exitedAt: null, lastT: t, state: "active", items: [], model: "", ghost: false, wave: 0, row: 0 };
}

function addEvent(v: Visit, e: BoardEntry, pending: Map<string, Item[]>) {
  v.lastT = Math.max(v.lastT, e.t);
  switch (e.kind) {
    case "tool.call": {
      const item: Item = { id: e.id, t: e.t, kind: "tool", title: String(e.data?.tool ?? e.title ?? "tool"), call: e, done: false };
      v.items.push(item);
      const key = `${v.id}:${item.title}`;
      pending.set(key, [...(pending.get(key) ?? []), item]);
      break;
    }
    case "tool.result": {
      const key = `${v.id}:${String(e.data?.tool ?? "")}`;
      const item = (pending.get(key) ?? []).shift();
      if (item) {
        item.result = e;
        item.done = true;
        item.ms = typeof e.data?.ms === "number" ? (e.data.ms as number) : e.t - item.t;
      }
      break;
    }
    case "model.call":
      v.model = String(e.title ?? v.model);
      v.items.push({ id: e.id, t: e.t, kind: "reasoning", title: String(e.title ?? "model"), detail: e.detail ?? "", done: true, ms: typeof e.data?.ms === "number" ? (e.data.ms as number) : undefined });
      break;
    case "denied":
    case "contract.breach":
      v.items.push({ id: e.id, t: e.t, kind: "refused", title: String(e.data?.tool ?? e.title ?? "refused"), detail: e.detail, control: String(e.data?.control ?? (e.kind === "contract.breach" ? "contract.breach" : "denied")), done: true });
      break;
    case "error": {
      const failures = e.data?.failures as { index: number }[] | undefined;
      if (Array.isArray(failures) && v.fanItems) for (const f of failures) { const fi = v.fanItems.find((x) => x.index === f.index); if (fi) fi.state = "failed"; }
      v.items.push({ id: e.id, t: e.t, kind: "error", title: String(e.title ?? "error"), detail: e.detail, done: true });
      break;
    }
    case "taint":
      v.items.push({ id: e.id, t: e.t, kind: "taint", title: String(e.title ?? "Marked untrusted"), detail: e.detail, done: true });
      break;
    case "gate.open":
      v.items.push({ id: e.id, t: e.t, kind: "gate", title: String(e.title ?? "Awaiting a decision"), detail: e.detail, done: false });
      v.state = "waiting";
      break;
    case "suspend":
      v.state = "waiting";
      break;
    case "gate.answer":
      for (const it of v.items) if (it.kind === "gate") it.done = true;
      v.items.push({ id: e.id, t: e.t, kind: "answer", title: String(e.title ?? "Answered"), detail: e.detail, done: true });
      v.state = "active";
      break;
    case "resume":
      v.state = "active";
      break;
    case "note": {
      const d = e.data ?? {};
      if (typeof d.fan_item === "number") {
        v.fanItems = v.fanItems ?? [];
        v.fanItems.push({ index: d.fan_item as number, label: e.detail || `item ${(d.fan_item as number) + 1}`, state: "active" });
        v.fanCount = typeof d.count === "number" ? (d.count as number) : v.fanCount;
      } else if (typeof d.count === "number" && /fans out/i.test(String(e.title))) {
        v.fanCount = d.count as number;
      } else {
        v.items.push({ id: e.id, t: e.t, kind: "note", title: String(e.title ?? "note"), detail: e.detail, done: true });
      }
      break;
    }
  }
}

export function foldRun(nodes: BoardNode[], edges: BoardEdge[], entries: BoardEntry[], opts: { live: boolean; fold: boolean }) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const preds = new Map<string, BoardEdge[]>();
  const succs = new Map<string, BoardEdge[]>();
  for (const e of edges) {
    preds.set(e.target, [...(preds.get(e.target) ?? []), e]);
    succs.set(e.source, [...(succs.get(e.source) ?? []), e]);
  }
  // Back edges: a depth-first walk from the entry marks any edge into a node still on the stack.
  const entryNode = nodes.find((n) => !preds.has(n.id))?.id ?? nodes[0]?.id;
  const back = new Set<string>();
  {
    const state = new Map<string, 1 | 2>();
    const walk = (id: string) => {
      state.set(id, 1);
      for (const e of succs.get(id) ?? []) {
        const s = state.get(e.target);
        if (s === 1) back.add(`${e.source}>${e.target}`);
        else if (!s) walk(e.target);
      }
      state.set(id, 2);
    };
    if (entryNode) walk(entryNode);
    for (const n of nodes) if (!state.has(n.id)) walk(n.id);
  }
  const isBack = (e: BoardEdge) => back.has(`${e.source}>${e.target}`);

  /* ── visits from the journal ── */
  const visits: Visit[] = [];
  const openMain: Visit[] = [];
  const perNode = new Map<string, Visit[]>();
  const perSub = new Map<string, Visit[]>();
  const pending = new Map<string, Item[]>();
  const skipped = new Map<string, { why: string; guards: string[]; t: number }>();
  const subVisit = (agent: string, subNode: string, e: BoardEntry): Visit | null => {
    const key = `${agent}/${subNode}`;
    const list = perSub.get(key) ?? [];
    if (e.kind === "node.enter" || !list.length) {
      if (e.kind !== "node.enter" && !subNode) return null;
      const parent = openMain[openMain.length - 1];
      const v = newVisit(key, subNode || agent, "sequence", list.length + 1, e.t);
      v.label = String(e.title || subNode || agent);
      v.sub = { agent, parent: parent?.id ?? "" };
      list.push(v);
      perSub.set(key, list);
      visits.push(v);
      return v;
    }
    return list[list.length - 1];
  };
  for (const e of entries) {
    const d = e.data ?? {};
    if (typeof d.sub === "number" || (e.node && e.node.includes("/"))) {
      const agent = String(d.agent ?? (e.node ?? "").split("/")[0]);
      const subNode = (e.node ?? "").includes("/") ? (e.node ?? "").split("/").slice(1).join("/") : "";
      if (e.kind === "run.start" || e.kind === "run.end") continue;
      const v = subVisit(agent, subNode, e);
      if (!v) continue;
      if (e.kind === "node.enter") continue;
      if (e.kind === "node.exit") { v.state = "done"; v.exitedAt = e.t; v.lastT = e.t; continue; }
      addEvent(v, e, pending);
      continue;
    }
    if (!e.node) continue;
    const spec = byId.get(e.node);
    if (e.kind === "node.enter") {
      const list = perNode.get(e.node) ?? [];
      const v = newVisit(e.node, spec?.label ?? String(e.title ?? e.node), spec?.kind ?? "sequence", list.length + 1, e.t);
      list.push(v);
      perNode.set(e.node, list);
      visits.push(v);
      openMain.push(v);
      continue;
    }
    const list = perNode.get(e.node) ?? [];
    const v = list[list.length - 1];
    if (e.kind === "note" && /skipped$/i.test(String(e.title ?? "")) && !v) {
      skipped.set(e.node, { why: e.detail ?? "", guards: ((e.data?.guards as string[]) ?? []).filter(Boolean), t: e.t });
      continue;
    }
    if (!v) continue;
    if (e.kind === "node.exit") {
      v.state = "done";
      v.exitedAt = e.t;
      v.lastT = e.t;
      if (v.fanItems) for (const fi of v.fanItems) if (fi.state === "active") fi.state = "done";
      const i = openMain.indexOf(v);
      if (i >= 0) openMain.splice(i, 1);
      continue;
    }
    addEvent(v, e, pending);
  }

  /* ── folding: one tile per node, or one per visit ── */
  let shown: Visit[] = visits;
  if (opts.fold) {
    const merged = new Map<string, Visit>();
    shown = [];
    for (const v of visits) {
      const key = v.sub ? `${v.sub.agent}/${v.node}` : v.node;
      const m = merged.get(key);
      if (!m) {
        const copy: Visit = { ...v, items: [...v.items], fanItems: v.fanItems ? [...v.fanItems] : undefined };
        merged.set(key, copy);
        shown.push(copy);
      } else {
        m.count += 1;
        m.items = [...m.items, ...v.items];
        m.state = v.state;
        m.exitedAt = v.exitedAt;
        m.lastT = Math.max(m.lastT, v.lastT);
        m.model = v.model || m.model;
        if (v.fanItems) m.fanItems = v.fanItems;
        if (v.fanCount) m.fanCount = v.fanCount;
      }
    }
  }
  const byVisitId = new Map(shown.map((v) => [v.id, v]));
  const visitsOf = (node: string) => shown.filter((v) => !v.sub && v.node === node);

  /* ── ghosts: the plan the run has not reached ── */
  for (const n of nodes) {
    if (visitsOf(n.id).length) continue;
    const sk = skipped.get(n.id);
    const g: Visit = { ...newVisit(n.id, n.label, n.kind, 1, sk?.t ?? 0), enteredAt: null, state: sk ? "skipped" : "pending", ghost: true, skippedWhy: sk?.why, guards: sk?.guards };
    shown.push(g);
    byVisitId.set(g.id, g);
  }

  /* ── waves: by the predecessors that had finished when the visit began ── */
  const traces: Trace[] = [];
  const sourceFor = (v: Visit, e: BoardEdge): Visit | null => {
    const cands = visitsOf(e.source).filter((p) => !p.ghost);
    if (!cands.length) return null;
    if (v.ghost) return cands[cands.length - 1];
    const started = v.enteredAt ?? 0;
    const finished = cands.filter((p) => p.exitedAt !== null && p.exitedAt <= started);
    if (finished.length) return finished[finished.length - 1];
    const begun = cands.filter((p) => (p.enteredAt ?? 0) <= started);
    return begun.length ? begun[begun.length - 1] : null;
  };
  const real = shown.filter((v) => !v.ghost && !v.sub).sort((a, b) => (a.enteredAt ?? 0) - (b.enteredAt ?? 0));
  for (const v of real) {
    let wave = 0;
    for (const e of preds.get(v.node) ?? []) {
      if (opts.fold && isBack(e)) continue;
      const p = sourceFor(v, e);
      if (p && p !== v) {
        wave = Math.max(wave, p.wave);
        traces.push({ from: p.id, to: v.id, kind: isBack(e) ? "loopk" : "done", label: e.label });
      }
    }
    v.wave = wave + 1;
  }
  // Folded loops that actually fired: one trace back along the line.
  if (opts.fold) {
    for (const e of edges) {
      if (!isBack(e)) continue;
      const src = visitsOf(e.source)[0];
      const dst = visitsOf(e.target)[0];
      if (src && dst && !src.ghost && !dst.ghost && dst.count > 1) traces.push({ from: src.id, to: dst.id, kind: "loopk", label: `${e.label ?? "again"} ×${dst.count - 1}` });
    }
  }
  // Ghosts in topological order over the forward edges.
  const ghosts = shown.filter((v) => v.ghost);
  for (let pass = 0; pass < nodes.length && ghosts.some((g) => g.wave === 0); pass++) {
    for (const g of ghosts) {
      if (g.wave) continue;
      const ins = (preds.get(g.node) ?? []).filter((e) => !isBack(e));
      const srcs = ins.map((e) => ({ e, p: visitsOf(e.source)[visitsOf(e.source).length - 1] })).filter((x) => x.p);
      if (!ins.length) { g.wave = 1; continue; }
      if (srcs.some((x) => x.p.wave === 0)) continue;
      g.wave = Math.max(1, ...srcs.map((x) => x.p.wave)) + (srcs.length ? 1 : 0);
      for (const { e, p } of srcs) {
        const closed = g.state === "skipped" && Boolean(e.when);
        traces.push({ from: p.id, to: g.id, kind: closed ? "closed" : !p.ghost && p.state !== "done" && p.state !== "skipped" ? "flow" : "pending", label: closed ? `⊘ ${e.when}` : e.label });
      }
    }
  }
  for (const g of ghosts) if (!g.wave) g.wave = 1;
  // Sub-runs sit in their parent's column.
  for (const v of shown) {
    if (!v.sub) continue;
    const parent = byVisitId.get(v.sub.parent) ?? shown.find((p) => !p.sub && !p.ghost && p.node === v.sub!.parent.split("#")[0]);
    v.wave = parent?.wave ?? Math.max(1, v.wave);
    const agentVisits = shown.filter((s) => s.sub && s.sub.agent === v.sub!.agent && s.sub.parent === v.sub!.parent).sort((a, b) => (a.enteredAt ?? 0) - (b.enteredAt ?? 0));
    const i = agentVisits.indexOf(v);
    if (i === 0 && parent) traces.push({ from: parent.id, to: v.id, kind: "nest", label: `${v.sub.agent} · sub-run` });
    else if (i > 0) traces.push({ from: agentVisits[i - 1].id, to: v.id, kind: "nest" });
  }

  /* ── rows: each column ordered by where its predecessors sit ── */
  const waves = Math.max(1, ...shown.map((v) => v.wave));
  const columns: Visit[][] = Array.from({ length: waves }, () => []);
  const specOrder = new Map(nodes.map((n, i) => [n.id, i]));
  const rowOf = new Map<string, number>();
  for (let w = 1; w <= waves; w++) {
    const main = shown.filter((v) => v.wave === w && !v.sub);
    const bary = (v: Visit) => {
      const rows = traces.filter((t) => t.to === v.id && byVisitId.get(t.from)?.wave === w - 1).map((t) => rowOf.get(t.from) ?? 0);
      return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : (specOrder.get(v.node) ?? 0) / 100;
    };
    main.sort((a, b) => bary(a) - bary(b) || (specOrder.get(a.node) ?? 0) - (specOrder.get(b.node) ?? 0));
    const col: Visit[] = [];
    for (const v of main) {
      col.push(v);
      for (const s of shown.filter((x) => x.sub && x.wave === w && x.sub.parent === v.id).sort((a, b) => (a.enteredAt ?? 0) - (b.enteredAt ?? 0))) col.push(s);
    }
    col.forEach((v, i) => { v.row = i; rowOf.set(v.id, i); });
    columns[w - 1] = col;
  }

  /* ── bands: chains that run beside each other out of one hub ── */
  const bands: Band[] = [];
  for (const h of nodes) {
    const outs = (succs.get(h.id) ?? []).filter((e) => !isBack(e));
    if (outs.length < 2) continue;
    const chains: string[][] = [];
    for (const o of outs) {
      const chain: string[] = [];
      let cur = o.target;
      for (let guard = 0; guard < nodes.length; guard++) {
        const ins = (preds.get(cur) ?? []).filter((e) => !isBack(e));
        if (ins.length > 1) break;
        chain.push(cur);
        const nxt = (succs.get(cur) ?? []).filter((e) => !isBack(e));
        if (nxt.length !== 1) break;
        cur = nxt[0].target;
      }
      if (chain.length) chains.push(chain);
    }
    if (chains.length < 2) continue;
    chains.forEach((chain, i) => {
      const vs = shown.filter((v) => !v.sub && chain.includes(v.node)).map((v) => v.id);
      if (vs.length) bands.push({ id: `${h.id}:${chain[0]}`, visits: vs, hue: TRACK_HUES[i % TRACK_HUES.length], label: `${byId.get(chain[0])?.label ?? chain[0]}` });
    });
  }
  const subGroups = new Map<string, string[]>();
  for (const v of shown) if (v.sub) { const k = `${v.sub.parent}:${v.sub.agent}`; subGroups.set(k, [...(subGroups.get(k) ?? []), v.id]); }
  for (const [k, vs] of subGroups) bands.push({ id: `sub:${k}`, visits: vs, hue: "violet", label: `${k.split(":")[1]} · sub-run`, dashed: true });

  return { columns, traces, bands, byVisitId, waves };
}

/* ═══════════════════ the board ═══════════════════ */

const TILE_MIN = 184;
const TILE_MAX = 240;
const GAP_X = 44;
const GAP_Y = 18;
const PAD = 40;
/** Below this width the flow runs top to bottom instead of left to right. */
const NARROW = 760;

export function RunBoard({
  nodes,
  edges,
  entries,
  live,
  fold,
  suspendedNode,
}: {
  nodes: BoardNode[];
  edges: BoardEdge[];
  entries: BoardEntry[];
  live: boolean;
  fold: boolean;
  suspendedNode?: string | null;
}) {
  const { columns, traces, bands } = useMemo(() => foldRun(nodes, edges, entries, { live, fold }), [nodes, edges, entries, live, fold]);
  const maxT = useMemo(() => entries.reduce((m, e) => Math.max(m, e.t), 0), [entries]);
  const [open, setOpen] = useState<{ visit: Visit; filter: Filter } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState(0);
  const [geom, setGeom] = useState<{ w: number; h: number; rects: Map<string, Rect> }>({ w: 0, h: 0, rects: new Map() });

  // The frame decides the shape: wide screens read left to right, narrow ones top to bottom,
  // and tiles grow to use the row when the whole flow fits.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setFrame(e.contentRect.width));
    ro.observe(el);
    setFrame(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const vertical = frame > 0 && frame < NARROW;
  const waves = columns.length;
  const tileW = vertical ? Math.max(160, Math.min(TILE_MAX, frame - 32)) : Math.max(TILE_MIN, Math.min(TILE_MAX, Math.floor((frame - 2 * PAD - (waves - 1) * GAP_X) / Math.max(1, waves))));

  // Every trace and band is drawn from where the tiles actually landed.
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
  }, [columns, vertical, tileW]);

  const activeCol = columns.findIndex((c) => c.some((v) => (v.state === "active" || v.state === "waiting") && !v.ghost));
  const nowAt = live && activeCol >= 0 ? geom.rects.get(columns[activeCol][0]?.id) : undefined;
  const allRects = useMemo(() => [...geom.rects.values()], [geom]);

  return (
    <>
      <div ref={scroller} className="min-h-0 grow overflow-auto">
        <div
          ref={host}
          className={`relative ${vertical ? "flex flex-col items-stretch" : "flex w-max items-stretch"}`}
          style={{ padding: PAD, gap: vertical ? 56 : GAP_X, minHeight: "100%", minWidth: vertical ? undefined : "100%" }}
        >
          {bands.map((b) => {
            const rs = b.visits.map((id) => geom.rects.get(id)).filter(Boolean) as Rect[];
            if (!rs.length) return null;
            const x = Math.min(...rs.map((r) => r.x)) - 12, y = Math.min(...rs.map((r) => r.y)) - 14;
            const w = Math.max(...rs.map((r) => r.x + r.w)) - x + 12, h = Math.max(...rs.map((r) => r.y + r.h)) - y + 12;
            return (
              <div key={b.id} data-hue={b.hue} className={`pointer-events-none absolute rounded-xl border ${b.dashed ? "border-dashed" : ""}`} style={{ left: x, top: y, width: w, height: h, background: "rgba(var(--hue), .055)", borderColor: "rgba(var(--hue), .26)" }}>
                <span className="absolute -top-[9px] left-3 rounded-sm bg-canvas px-1.5 font-mono text-[9.5px] leading-[18px] tracking-[.06em] uppercase" style={{ color: "rgba(var(--hue), 1)" }}>{b.label}</span>
              </div>
            );
          })}
          {nowAt && !vertical && (
            <div className="pointer-events-none absolute inset-y-0 border-l-[1.5px] border-dashed border-run opacity-80" style={{ left: nowAt.x - GAP_X / 2 }}>
              <span className="absolute top-2.5 left-1.5 rounded-sm bg-canvas px-1.5 font-mono text-[10px] leading-[16px] whitespace-nowrap text-run">now · {clock(maxT)}</span>
            </div>
          )}
          {nowAt && vertical && (
            <div className="pointer-events-none absolute inset-x-0 border-t-[1.5px] border-dashed border-run opacity-80" style={{ top: nowAt.y - 28 }}>
              <span className="absolute top-1 left-3 rounded-sm bg-canvas px-1.5 font-mono text-[10px] leading-[16px] whitespace-nowrap text-run">now · {clock(maxT)}</span>
            </div>
          )}
          <svg className="pointer-events-none absolute inset-0 z-[1]" width={geom.w} height={geom.h} viewBox={`0 0 ${Math.max(1, geom.w)} ${Math.max(1, geom.h)}`} aria-hidden>
            {traces.map((t, i) => {
              const A = geom.rects.get(t.from), B = geom.rects.get(t.to);
              if (!A || !B) return null;
              return <TracePath key={`${t.from}>${t.to}:${i}`} t={t} A={A} B={B} vertical={vertical} rects={allRects} />;
            })}
          </svg>
          {columns.map((col, i) => (
            <div key={i} className={`relative z-[2] flex ${vertical ? "flex-row flex-wrap justify-center" : "flex-col justify-center"}`} style={{ gap: vertical ? 14 : GAP_Y, width: vertical ? undefined : tileW }}>
              {col.map((v) => (
                <div key={v.id} style={{ width: tileW }}>
                  <Tile v={v} live={live} maxT={maxT} suspended={suspendedNode === v.node} onOpen={(f) => setOpen({ visit: v, filter: f })} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      {open && <LedgerModal visit={open.visit} live={live} maxT={maxT} initial={open.filter} onClose={() => setOpen(null)} />}
    </>
  );
}

/** Does a horizontal channel at y, spanning x0..x1, run through any tile? */
function blocked(rects: Rect[], x0: number, x1: number, y: number, pad = 8): boolean {
  const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
  return rects.some((r) => r.x < hi && r.x + r.w > lo && y > r.y - pad && y < r.y + r.h + pad);
}

function TracePath({ t, A, B, vertical, rects }: { t: Trace; A: Rect; B: Rect; vertical: boolean; rects: Rect[] }) {
  const stroke = t.kind === "done" ? "var(--color-ok)" : t.kind === "flow" ? "var(--color-run)" : t.kind === "closed" ? "var(--color-err)" : t.kind === "loopk" ? "rgba(var(--hue-indigo), 1)" : t.kind === "nest" ? "rgba(var(--hue-violet), .9)" : "var(--color-line-strong)";
  const dash = t.kind === "flow" ? "5 4" : t.kind === "closed" ? "2 3" : t.kind === "loopk" ? "4 3" : t.kind === "pending" ? "1.5 3.5" : undefined;
  const width = t.kind === "done" || t.kind === "flow" || t.kind === "loopk" ? 1.5 : 1.25;
  let d: string, hx: number, hy: number, dir: "r" | "d" | "u" | "l", lx = 0, ly = 0;
  const sameColumn = Math.abs(A.x - B.x) < 4 && !vertical;
  const sameRow = Math.abs(A.y - B.y) < 4 && vertical;
  const backward = vertical ? B.y < A.y : B.x < A.x;
  if (t.kind === "nest" && (sameColumn || sameRow)) {
    if (sameColumn) {
      const x = A.x + 18;
      d = `M ${x} ${A.y + A.h} V ${B.y}`;
      hx = x; hy = B.y; dir = "d";
    } else {
      const y = A.y + A.h / 2;
      d = `M ${A.x + A.w} ${y} H ${B.x}`;
      hx = B.x; hy = y; dir = "r";
    }
  } else if (backward && !vertical) {
    // A loop: out of the tile, along a free channel, back into the target. The
    // channel goes under the line unless something sits there, then over it.
    const xa = A.x + A.w * 0.5, xb = B.x + B.w * 0.5;
    const below = Math.max(A.y + A.h, B.y + B.h) + 24;
    const above = Math.min(A.y, B.y) - 24;
    const useBelow = !blocked(rects.filter((r) => r !== A && r !== B), xb, xa, below) || blocked(rects.filter((r) => r !== A && r !== B), xb, xa, above);
    const yC = useBelow ? below : above;
    if (useBelow) {
      d = `M ${xa} ${A.y + A.h} V ${yC - 8} Q ${xa} ${yC} ${xa - 8} ${yC} H ${xb + 8} Q ${xb} ${yC} ${xb} ${yC - 8} V ${B.y + B.h}`;
      hx = xb; hy = B.y + B.h; dir = "u";
    } else {
      d = `M ${xa} ${A.y} V ${yC + 8} Q ${xa} ${yC} ${xa - 8} ${yC} H ${xb + 8} Q ${xb} ${yC} ${xb} ${yC + 8} V ${B.y}`;
      hx = xb; hy = B.y; dir = "d";
    }
    lx = (xa + xb) / 2; ly = yC;
  } else if (backward && vertical) {
    const ya = A.y + A.h * 0.5, yb = B.y + B.h * 0.5, xC = Math.max(A.x + A.w, B.x + B.w) + 22;
    d = `M ${A.x + A.w} ${ya} H ${xC - 8} Q ${xC} ${ya} ${xC} ${ya - 8} V ${yb + 8} Q ${xC} ${yb} ${xC - 8} ${yb} H ${B.x + B.w}`;
    hx = B.x + B.w; hy = yb; dir = "l"; lx = xC; ly = (ya + yb) / 2;
  } else if (vertical) {
    const x1 = A.x + A.w / 2, y1 = A.y + A.h, x2 = B.x + B.w / 2, y2 = B.y, k = Math.max(14, (y2 - y1) * 0.5);
    d = `M ${x1} ${y1} C ${x1} ${y1 + k}, ${x2} ${y2 - k}, ${x2} ${y2}`;
    hx = x2; hy = y2; dir = "d"; lx = (x1 + x2) / 2 + (x1 === x2 ? 0 : 0); ly = (y1 + y2) / 2;
  } else {
    const x1 = A.x + A.w, y1 = A.y + A.h / 2, x2 = B.x, y2 = B.y + B.h / 2, k = Math.max(16, (x2 - x1) * 0.5);
    d = `M ${x1} ${y1} C ${x1 + k} ${y1}, ${x2 - k} ${y2}, ${x2} ${y2}`;
    hx = x2; hy = y2; dir = "r"; lx = (x1 + x2) / 2; ly = (y1 + y2) / 2;
  }
  const head =
    dir === "r" ? `M ${hx - 6} ${hy - 3.5} L ${hx} ${hy} L ${hx - 6} ${hy + 3.5} Z`
    : dir === "l" ? `M ${hx + 6} ${hy - 3.5} L ${hx} ${hy} L ${hx + 6} ${hy + 3.5} Z`
    : dir === "d" ? `M ${hx - 3.5} ${hy - 6} L ${hx} ${hy} L ${hx + 3.5} ${hy - 6} Z`
    : `M ${hx - 3.5} ${hy + 6} L ${hx} ${hy} L ${hx + 3.5} ${hy + 6} Z`;
  // Only the traces that change the reading carry a label: a closed guard, or
  // a loop that fired. Plain hand-offs stay quiet so tiles stay uncovered.
  const wants = t.kind === "closed" || t.kind === "loopk";
  const label = !wants || !t.label ? "" : t.label.length <= 30 ? t.label : t.label.slice(0, 28) + "…";
  const lw = label.length * 5.7 + 12;
  return (
    <g>
      <path d={d} fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={dash} className={t.kind === "flow" ? "af-flow" : undefined} />
      <path d={head} fill={stroke} />
      {label && (
        <>
          <rect x={lx - lw / 2} y={ly - 8} width={lw} height={16} rx={4} fill="var(--color-surface)" stroke={stroke} strokeOpacity={0.55} />
          <text x={lx} y={ly + 3.5} textAnchor="middle" fontFamily="var(--font-mono)" fontSize="9.5" fontWeight="500" fill={stroke}>{label}</text>
        </>
      )}
    </g>
  );
}

/* ═══════════════════ one tile ═══════════════════ */

function elapsed(v: Visit, live: boolean, maxT: number): string {
  if (v.ghost) return "";
  const end = v.exitedAt ?? (live ? maxT : v.lastT);
  return v.enteredAt === null ? "" : fmtMs(end - v.enteredAt);
}

function Tile({ v, live, maxT, suspended, onOpen }: { v: Visit; live: boolean; maxT: number; suspended: boolean; onOpen: (f: Filter) => void }) {
  const harness = HARNESS[v.kind as keyof typeof HARNESS];
  const tools = v.items.filter((x) => x.kind === "tool").length;
  const refused = v.items.filter((x) => x.kind === "refused" || x.kind === "error").length;
  const thoughts = v.items.filter((x) => x.kind === "reasoning").length;
  const inFlight = v.state === "active" && live ? [...v.items].reverse().find((x) => x.kind === "tool" && !x.done) : undefined;
  const latestThought = [...v.items].reverse().find((x) => x.kind === "reasoning");
  const working = v.state === "active" && live;
  const waiting = v.state === "waiting" || suspended;
  const tone = waiting ? "text-warn" : working ? "text-run" : v.state === "done" ? (refused ? "text-warn" : "text-ok") : "text-faint";
  const kicker = v.sub ? `${v.sub.agent} · sub-run` : `${harness?.name ?? v.kind}${v.model ? ` · ${v.model}` : ""}`;
  const gistLine = v.ghost
    ? v.state === "skipped" ? (v.guards?.length ? `route closed: ${v.guards[0]}` : "skipped") : "not reached yet"
    : inFlight
      ? inFlight.title
      : v.state === "waiting"
        ? ([...v.items].reverse().find((x) => x.kind === "gate")?.detail || "awaiting a person")
        : (() => {
            const last = [...v.items].reverse().find((x) => x.kind === "tool" && x.result) ?? null;
            const lastThought = latestThought?.detail ? gist(latestThought.detail) : "";
            return lastThought || (last ? `${last.title} · ${summarise(last.result?.data?.value)}` : v.state === "done" ? "complete" : "starting");
          })();
  const stateWord = v.ghost ? (v.state === "skipped" ? "skipped" : "planned") : waiting ? "waiting" : working ? "working" : v.state === "active" ? "open" : refused ? "complete · flagged" : "complete";

  return (
    <button
      type="button"
      data-visit={v.id}
      onClick={() => !v.ghost && onOpen("all")}
      title={v.ghost ? v.skippedWhy || undefined : `${v.label} · ${stateWord}`}
      className={`focusable relative flex w-full flex-col gap-1 overflow-hidden rounded-lg border bg-surface px-3 pt-2.5 pb-2.5 text-left transition-[transform,box-shadow,border-color] duration-200 ease-[var(--ease-out)] ${
        v.ghost ? "cursor-default border-dashed border-line-strong bg-transparent opacity-75" : waiting ? "border-warn/60 bg-warn-bg elev-1" : working ? "border-run/60 elev-1" : "border-line elev-1 hover:-translate-y-px hover:border-line-strong hover:shadow-[var(--shadow-2)]"
      }`}
    >
      <span className="absolute inset-x-0 top-0 h-[3px] overflow-hidden bg-line/70" aria-hidden>
        {v.state === "done" && <span className={`block h-full ${refused ? "bg-warn" : "bg-ok"}`} />}
        {working && <span className="af-indeterminate block h-full w-1/3 bg-run" />}
        {waiting && <span className="af-pulse block h-full bg-warn" />}
      </span>

      {/* 1 · who, and how long */}
      <span className="flex min-w-0 items-center gap-2 pt-px">
        <StateDot state={v.state} live={live} ghost={v.ghost} />
        <span className={`min-w-0 grow truncate text-[13px] leading-[1.3] font-semibold tracking-[-0.01em] ${v.ghost ? "text-faint" : "text-fg"}`}>{v.label}</span>
        {v.count > 1 && <span className="shrink-0 rounded-sm border border-line-strong bg-raise px-1 font-mono text-[9.5px] leading-[15px] text-dim" title={`${v.count} visits`}>↺ {v.count}</span>}
        {v.count === 1 && v.index > 1 && <span className="shrink-0 font-mono text-[10px] text-ghost">·{v.index}</span>}
        {v.fanCount ? <span className="shrink-0 rounded-sm border border-line bg-raise px-1 font-mono text-[9.5px] leading-[15px] text-dim">×{v.fanCount}</span> : null}
        <span className={`tnum shrink-0 font-mono text-[10.5px] ${tone}`}>{elapsed(v, live, maxT)}</span>
      </span>

      {/* 2 · the pattern and the model */}
      <span className="truncate text-[10.5px] leading-[1.3] text-faint">{kicker}</span>

      {/* 3 · what it is doing, or what came of it */}
      <span className={`flex min-w-0 items-center gap-1.5 text-[11.5px] leading-[1.4] ${working ? "text-run" : waiting ? "text-warn" : v.ghost ? "text-ghost" : "text-mist"}`}>
        {inFlight && <Spinner size={10} />}
        {working && !inFlight && <Thinking height={8} />}
        <span className="min-w-0 grow truncate">{gistLine}</span>
      </span>

      {/* 4 · the count, or the copies */}
      {!v.ghost && !v.sub && (
        <span className="flex items-center gap-2 pt-0.5 font-mono text-[10px] text-ghost">
          <span className="tnum">{tools} tool{tools === 1 ? "" : "s"}</span>
          <span className="tnum">{thoughts} thought{thoughts === 1 ? "" : "s"}</span>
          {refused > 0 && <span className="tnum text-err">{refused} refused</span>}
          <span className="grow" />
          <span className={`${tone}`}>{stateWord}</span>
        </span>
      )}
      {v.fanItems && v.fanItems.length > 0 && (
        <span className="mt-1 flex flex-col gap-0.5 border-t border-dashed border-line pt-1.5">
          {v.fanItems.slice(0, 5).map((fi) => (
            <span key={fi.index} className="flex items-center gap-2 text-[10.5px] text-dim">
              <span className={`size-[6px] shrink-0 rounded-[1.5px] ${fi.state === "failed" ? "bg-err" : fi.state === "done" ? "bg-ok" : "bg-run af-pulse"}`} />
              <span className="min-w-0 grow truncate">{fi.label}</span>
            </span>
          ))}
          {v.fanItems.length > 5 && <span className="text-[10px] text-ghost">+{v.fanItems.length - 5} more</span>}
        </span>
      )}
    </button>
  );
}

function StateDot({ state, live, ghost }: { state: NodeState; live: boolean; ghost: boolean }) {
  if (ghost) return <span className="size-2.5 shrink-0 rounded-[2px] border-[1.5px] border-dashed border-line-strong" />;
  if (state === "active" && live) {
    return (
      <span className="relative flex size-2.5 shrink-0">
        <span className="absolute inline-flex size-2.5 animate-ping rounded-[2px] bg-run opacity-60" />
        <span className="relative inline-flex size-2.5 rounded-[2px] border-[1.5px] border-run bg-surface" />
      </span>
    );
  }
  const cls = state === "done" ? "border-ok bg-ok" : state === "waiting" ? "border-warn bg-warn" : state === "active" ? "border-run bg-surface" : "border-line-strong bg-surface";
  return <span className={`size-2.5 shrink-0 rounded-[2px] border-[1.5px] ${cls}`} />;
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
    case "reasoning":
      return { main: "thought", sub: row.detail ? gist(row.detail) : undefined, cls: "text-run" };
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
      subtitle={`${v.sub ? `${v.sub.agent} sub-run · ` : ""}${harness?.name ?? v.kind}${v.model ? ` on ${v.model}` : ""} · ${state} · ${tools} tool call${tools === 1 ? "" : "s"}${refused ? ` · ${refused} refused` : ""}${v.fanCount ? ` · fan-out ×${v.fanCount}` : ""}`}
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
                {r.control && <ControlRef control={r.control} />}
                <span className={`tnum shrink-0 font-mono text-[10px] ${r.kind === "tool" && !r.allDone && live ? "text-run" : "text-ghost"}`}>
                  {r.kind === "tool" && !r.allDone && live ? fmtMs(maxT - r.t) : r.allDone && r.ms !== undefined ? fmtMs(r.ms) : ""}
                </span>
              </button>
              {isOpen && (
                <div className="flex flex-col gap-2 bg-canvas px-4 py-3 pl-[72px]">
                  {r.kind === "tool" && r.members.map((m, i) => (
                    <div key={m.id} className="flex flex-col gap-1.5">
                      {r.count > 1 && <span className="font-mono text-[10px] text-faint">call {i + 1} of {r.count} · {m.done && m.ms !== undefined ? fmtMs(m.ms) : "no result"}</span>}
                      <Args args={m.call?.data?.args ?? {}} />
                      {m.result && (
                        <pre className="max-h-[320px] overflow-auto rounded-md border border-line bg-sunken/40 p-2.5 font-mono text-[10.5px] leading-[1.55] whitespace-pre-wrap text-mist">
                          {typeof m.result.data?.value === "string" ? m.result.data.value : JSON.stringify(m.result.data?.value ?? null, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))}
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

export function useRunView(): [RunView, (v: RunView) => void, boolean, (f: boolean) => void] {
  const [view, setView] = useState<RunView>("theatre");
  const [fold, setFold] = useState(true);
  useEffect(() => {
    try {
      const v = localStorage.getItem("af.runs.view");
      const f = localStorage.getItem("af.runs.fold");
      if (v === "cards" || v === "theatre") setView(v);
      if (f === "0" || f === "1") setFold(f === "1");
    } catch {
      /* no storage */
    }
  }, []);
  return [
    view,
    (v) => {
      setView(v);
      try { localStorage.setItem("af.runs.view", v); } catch { /* ignore */ }
    },
    fold,
    (f) => {
      setFold(f);
      try { localStorage.setItem("af.runs.fold", f ? "1" : "0"); } catch { /* ignore */ }
    },
  ];
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
