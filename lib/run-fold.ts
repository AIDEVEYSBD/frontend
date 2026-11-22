/**
 * The run as a flow of agents: the fold from a journal to waves, lanes,
 * traces and bands. Pure data, no React, so it can be exercised against a
 * real journal from a script as well as rendered by the board.
 */

import { sandboxLine, sandboxRunOf } from "./sandbox";

export interface BoardEntry {
  id: string;
  t: number;
  kind: string;
  node?: string;
  title?: string;
  detail?: string;
  tainted?: boolean;
  /** The entries this one rests on: a result, a refusal or a failure cites the `tool.call` it closes. */
  because?: string[];
  data?: { tool?: string; args?: Record<string, unknown>; value?: unknown; [k: string]: unknown };
}
export interface BoardNode { id: string; label: string; kind: string }
export interface BoardEdge { source: string; target: string; when?: string; label?: string }

export type NodeState = "pending" | "active" | "done" | "skipped" | "waiting";

export interface Item {
  id: string;
  t: number;
  kind: "tool" | "reasoning" | "refused" | "taint" | "gate" | "note" | "error" | "answer";
  title: string;
  detail?: string;
  result?: BoardEntry;
  call?: BoardEntry;
  control?: string;
  done: boolean;
  /** A tool call closed by something other than its result: refused after it was recorded, or failed. */
  outcome?: "refused" | "failed";
  ms?: number;
  /** Tokens a model call spent, when the journal recorded them. */
  tokens?: { in: number; out: number };
}

export interface FanItem { index: number; label: string; state: "active" | "done" | "failed" }

export interface Visit {
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
  /** The fields the visit received, from its enter entry. */
  inputs?: string[];
  /** The fields it handed on, from its exit entry. */
  emitted?: string[];
  ghost: boolean;
  wave: number;
  row: number;
}

export interface Trace { from: string; to: string; kind: "done" | "flow" | "pending" | "closed" | "loopk" | "nest"; label?: string }
export interface Band { id: string; visits: string[]; hue: string; label: string; dashed?: boolean }
export type Rect = { x: number; y: number; w: number; h: number };

const TRACK_HUES = ["teal", "blue", "red", "green", "amber", "indigo"];

export const clock = (ms: number) => {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
};
export const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60_000).toFixed(1)}m`);

export function summarise(value: unknown): string {
  if (value === null || value === undefined) return "";
  // An isolated `sandbox.execute` (phase L6) reads as its exit, isolator and time, never as its keys.
  const sandbox = sandboxRunOf(value);
  if (sandbox) return sandboxLine(sandbox);
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
export function prose(text: string): [string, string][] | string {
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
export function gist(text: string): string {
  const p = prose(text);
  const line = typeof p === "string" ? p : p.length ? `${p[0][0]}: ${p[0][1]}` : "";
  const flat = line.replace(/\s+/g, " ").trim();
  return flat.length > 90 ? flat.slice(0, 87) + "…" : flat;
}

/* ═══════════════════ folding the journal into visits ═══════════════════ */

function newVisit(node: string, label: string, kind: string, index: number, t: number): Visit {
  return { id: `${node}#${index}`, node, label, kind, index, count: 1, enteredAt: t, exitedAt: null, lastT: t, state: "active", items: [], model: "", ghost: false, wave: 0, row: 0 };
}

/** The keys of a brief map the runtime journals on enter and exit. */
function fieldNames(brief: unknown): string[] | undefined {
  return brief && typeof brief === "object" && !Array.isArray(brief) ? Object.keys(brief as Record<string, unknown>) : undefined;
}

/** The open tool call an entry cites in `because`, taken off the open list; undefined when it cites none. */
function takeCited(pending: Map<string, Item[]>, e: BoardEntry): Item | undefined {
  const cites = Array.isArray(e.because) ? e.because : [];
  if (!cites.length) return undefined;
  for (const [key, list] of pending) {
    const i = list.findIndex((it) => cites.includes(it.id));
    if (i >= 0) {
      const [item] = list.splice(i, 1);
      pending.set(key, list);
      return item;
    }
  }
  return undefined;
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
      // The call it cites, else (a journal from before calls were cited) the oldest open call of that tool in this visit.
      const key = `${v.id}:${String(e.data?.tool ?? "")}`;
      // A result that cites a call already closed is not handed to another call of the same tool.
      const citesACall = (e.because ?? []).some((id) => [...pending.values()].some((list) => list.some((it) => it.id === id)) || id.includes("#"));
      const item = takeCited(pending, e) ?? (citesACall ? undefined : (pending.get(key) ?? []).shift());
      if (item) {
        item.result = e;
        item.done = true;
        item.ms = typeof e.data?.ms === "number" ? (e.data.ms as number) : e.t - item.t;
      }
      break;
    }
    case "model.call": {
      v.model = String(e.title ?? v.model);
      const tk = e.data?.tokens as { in?: number; out?: number } | undefined;
      v.items.push({
        // `call` keeps the entry, so a reader can show the model and (through the gateway) the route it took.
        id: e.id, t: e.t, kind: "reasoning", title: String(e.title ?? "model"), detail: e.detail ?? "", done: true, call: e,
        ms: typeof e.data?.ms === "number" ? (e.data.ms as number) : undefined,
        tokens: tk ? { in: Number(tk.in ?? 0), out: Number(tk.out ?? 0) } : undefined,
      });
      break;
    }
    case "denied":
    case "contract.breach": {
      // A refusal after the call was recorded closes that call: it is no longer in flight.
      const closed = takeCited(pending, e);
      if (closed) {
        closed.done = true;
        closed.outcome = "refused";
        closed.ms = e.t - closed.t;
      }
      v.items.push({ id: e.id, t: e.t, kind: "refused", title: String(e.data?.tool ?? e.title ?? "refused"), detail: e.detail, control: String(e.data?.control ?? (e.kind === "contract.breach" ? "contract.breach" : "denied")), done: true });
      break;
    }
    case "error": {
      const closed = takeCited(pending, e);
      if (closed) {
        closed.done = true;
        closed.outcome = "failed";
        closed.ms = e.t - closed.t;
      }
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

export function foldRun(nodes: BoardNode[], edges: BoardEdge[], entries: BoardEntry[], opts: { live: boolean; fold: boolean; plan?: boolean }) {
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
      if (e.kind === "node.exit") { v.state = "done"; v.exitedAt = e.t; v.lastT = e.t; v.emitted = fieldNames(e.data?.emitted); continue; }
      addEvent(v, e, pending);
      continue;
    }
    if (!e.node) continue;
    const spec = byId.get(e.node);
    if (e.kind === "node.enter") {
      const list = perNode.get(e.node) ?? [];
      const v = newVisit(e.node, spec?.label ?? String(e.title ?? e.node), spec?.kind ?? "sequence", list.length + 1, e.t);
      v.inputs = fieldNames(e.data?.inputs);
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
      v.emitted = fieldNames(e.data?.emitted);
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
        m.emitted = v.emitted ?? m.emitted;
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
    // A replay shows a card when its agent runs, not before; a closed route
    // still shows, because the run did decide something about it.
    if (!sk && opts.plan === false) continue;
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

  /* ── lanes: a chain keeps its lane across waves, a fan spreads around
     its hub, a join sits in the middle of what it joins. The lane is the
     row of the grid, so a branch reads as one straight track. ── */
  const waves = Math.max(1, ...shown.map((v) => v.wave));
  const columns: Visit[][] = Array.from({ length: waves }, () => []);
  const specOrder = new Map(nodes.map((n, i) => [n.id, i]));
  const laneOf = new Map<string, number>();
  const into = (v: Visit) => traces.filter((t) => t.to === v.id && t.kind !== "nest" && laneOf.has(t.from));
  for (let w = 1; w <= waves; w++) {
    const main = shown.filter((v) => v.wave === w && !v.sub);
    const desired = new Map<string, number>();
    // Siblings fanning out of one hub spread symmetrically around it: the
    // hub is the nearest visit feeding each of them, so a branch that also
    // hears from further back still fans with its siblings.
    const hubOf = (v: Visit): string | null => {
      let best: Trace | null = null;
      for (const t of into(v)) if (!best || (byVisitId.get(t.from)?.wave ?? 0) > (byVisitId.get(best.from)?.wave ?? 0)) best = t;
      return best?.from ?? null;
    };
    const fans = new Map<string, Visit[]>();
    for (const v of main) {
      const hub = hubOf(v);
      if (hub) fans.set(hub, [...(fans.get(hub) ?? []), v]);
    }
    for (const [hub, sibs] of fans) {
      if (sibs.length < 2) continue;
      sibs.sort((a, b) => (specOrder.get(a.node) ?? 0) - (specOrder.get(b.node) ?? 0));
      const centre = laneOf.get(hub) ?? 0;
      sibs.forEach((sib, i) => {
        const off = i - (sibs.length - 1) / 2;
        desired.set(sib.id, centre + (off < 0 ? Math.floor(off) : Math.ceil(off)));
      });
    }
    // Everything else wants the middle of what feeds it; a root wants the top.
    for (const v of main) {
      if (desired.has(v.id)) continue;
      const ls = into(v).map((t) => laneOf.get(t.from)!).sort((a, b) => a - b);
      const mid = !ls.length ? 0 : ls.length % 2 ? ls[(ls.length - 1) / 2] : (ls[ls.length / 2 - 1] + ls[ls.length / 2]) / 2;
      desired.set(v.id, mid + (specOrder.get(v.node) ?? 0) / 1e4);
    }
    main.sort((a, b) => desired.get(a.id)! - desired.get(b.id)! || (specOrder.get(a.node) ?? 0) - (specOrder.get(b.node) ?? 0));
    let last = -Infinity;
    const col: Visit[] = [];
    for (const v of main) {
      const lane = Math.max(Math.round(desired.get(v.id)!), last + 1);
      laneOf.set(v.id, lane);
      last = lane;
      col.push(v);
      // A sub-run hangs under the visit that invoked it.
      for (const sv of shown.filter((x) => x.sub && x.wave === w && x.sub.parent === v.id).sort((a, b) => (a.enteredAt ?? 0) - (b.enteredAt ?? 0))) {
        last += 1;
        laneOf.set(sv.id, last);
        col.push(sv);
      }
    }
    columns[w - 1] = col;
  }
  for (const v of shown) {
    if (laneOf.has(v.id)) continue;
    const used = columns[v.wave - 1].map((x) => laneOf.get(x.id) ?? 0);
    laneOf.set(v.id, used.length ? Math.max(...used) + 1 : 0);
    columns[v.wave - 1].push(v);
  }
  const low = Math.min(0, ...laneOf.values());
  for (const v of shown) v.row = (laneOf.get(v.id) ?? 0) - low;
  for (const col of columns) col.sort((a, b) => a.row - b.row);
  const lanes = Math.max(1, ...shown.map((v) => v.row + 1));

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
      // A band is the first pass of a parallel track. A node the loop later
      // re-runs shows up again on the spine, and that visit is the loop's,
      // not the track's: including it would stretch the band over the tiles
      // between.
      const vs = shown.filter((v) => !v.sub && v.index === 1 && chain.includes(v.node)).map((v) => v.id);
      if (vs.length) bands.push({ id: `${h.id}:${chain[0]}`, visits: vs, hue: TRACK_HUES[i % TRACK_HUES.length], label: `${byId.get(chain[0])?.label ?? chain[0]}` });
    });
  }
  const subGroups = new Map<string, string[]>();
  for (const v of shown) if (v.sub) { const k = `${v.sub.parent}:${v.sub.agent}`; subGroups.set(k, [...(subGroups.get(k) ?? []), v.id]); }
  for (const [k, vs] of subGroups) bands.push({ id: `sub:${k}`, visits: vs, hue: "violet", label: `${k.split(":")[1]} · sub-run`, dashed: true });

  return { columns, traces, bands, byVisitId, waves, lanes };
}
