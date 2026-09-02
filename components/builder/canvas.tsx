"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BY_NAME } from "@/lib/catalogue";
import { listConnections, type Connection } from "@/lib/connections";
import { IconButton, Kbd } from "../ui";
import { Icon } from "./icons";
import {
  HARNESS,
  HARNESS_ORDER,
  grantsFor,
  type AgentSystem,
  type HarnessKind,
  type Problem,
} from "@/lib/spec";
import type { HistoryAction } from "@/lib/builder-store";

export const NODE_W = 208;
export const NODE_H = 96;

const CONN_W = 150;
const CONN_H = 52;
const SYS_W = 168;
const SYS_H = 58;

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 1.75;
const GRID = 12;

/*
 * The interaction grammar, borrowed deliberately from the editors people
 * already know (n8n, React Flow) so nothing here needs teaching:
 *
 *   scroll            pans (trackpads feel native)
 *   pinch / ⌘-scroll  zooms toward the cursor, not the origin
 *   drag empty space  pans; space-drag pans from anywhere
 *   drag a node       moves it, snapped to the grid
 *   drag from a port  draws a wire; drop on a node connects, drop on nothing
 *                     opens a picker and the new node arrives already wired
 *   click a port      same picker, for people who don't drag
 *   hover an edge     shows insert-between and remove; click selects it
 *   ⌫ / ⌦             deletes the selected node or edge
 *   ⌘D                duplicates; arrows nudge
 *
 * The one non-negotiable: every affordance is visible before it is needed.
 * Ports are drawn, not discovered; edge controls appear on hover, not on
 * memory of a hidden click zone.
 */

interface Drag {
  id: string;
  dx: number;
  dy: number;
  moved: boolean;
}

interface Wire {
  from: string;
  x: number;
  y: number;
  /** Node currently under the pointer — highlighted as the drop target. */
  over: string | null;
  /** Output boundary card under the pointer — a wire drop sets its source. */
  overOut: number | null;
}

interface PickerAt {
  /** Canvas coordinates where the new node will land. */
  x: number;
  y: number;
  /** Screen coordinates for the popover itself. */
  sx: number;
  sy: number;
  from?: string;
  edge?: number;
}

export interface CanvasApi {
  /** Pan the viewport to center a node, with a short glide and a flash. */
  focusNode: (id: string) => void;
}

export function Canvas({
  system,
  dispatch,
  selected,
  onSelect,
  problems,
  onAddAt,
  canUndo,
  canRedo,
  apiRef,
}: {
  system: AgentSystem;
  dispatch: (a: HistoryAction) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  problems: Problem[];
  onAddAt: (harness: string, x: number, y: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  apiRef?: React.MutableRefObject<CanvasApi | null>;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [wire, setWire] = useState<Wire | null>(null);
  const [panning, setPanning] = useState<{ x: number; y: number } | null>(null);
  const [hoverEdge, setHoverEdge] = useState<number | null>(null);
  const [picker, setPicker] = useState<PickerAt | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [dropHint, setDropHint] = useState(false);
  const [glide, setGlide] = useState(false);
  const [flashNode, setFlashNode] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  const spaceHeld = useRef(false);

  // Edge selection is a selection like any other — derived, never a second
  // source of truth that can disagree with the inspector.
  const selectedEdge = selected?.startsWith("edge:") ? Number(selected.slice(5)) : null;

  const byId = useMemo(() => new Map(system.nodes.map((n) => [n.id, n])), [system.nodes]);

  /* Connector cards hang beneath the agent they were dropped on — every
     tool's connections, one derivation. Geometry is derived, never stored:
     they follow the node like a shadow. */
  const connectors = useMemo(() => {
    const perNode = new Map<string, number>();
    return listConnections(system)
      .map((c, globalIndex) => {
        const host = c.attached_to && byId.has(c.attached_to) ? c.attached_to : null;
        const slot = host ? (perNode.get(host) ?? 0) : 0;
        if (host) perNode.set(host, slot + 1);
        const hostNode = host ? byId.get(host)! : null;
        return {
          conn: c,
          globalIndex,
          host,
          x: hostNode ? hostNode.x + slot * (CONN_W + 14) : 0,
          y: hostNode ? hostNode.y + NODE_H + 46 : 0,
        };
      })
      .filter((c) => c.host);
  }, [system, byId]);

  /* Boundary cards: the trigger sits before the entry; each output sits after
     the node it reads (or the rightmost node, for run-result outputs). */
  const entryNode = byId.get(system.entry);
  const triggerCard =
    system.trigger && system.trigger.kind !== "api" && entryNode
      ? { x: entryNode.x - SYS_W - 64, y: entryNode.y + NODE_H / 2 - SYS_H / 2 }
      : null;

  const outputCards = useMemo(() => {
    const outs = system.outputs ?? [];
    const rightmost = system.nodes.reduce(
      (best, n) => (n.x > best.x ? n : best),
      system.nodes[0] ?? { x: 0, y: 0 },
    );
    return outs.map((o, index) => {
      const from = (o.from_node && byId.get(o.from_node)) || rightmost;
      return {
        output: o,
        index,
        from: o.from_node && byId.has(o.from_node) ? o.from_node : null,
        x: (from?.x ?? 0) + NODE_W + 64,
        y: (from?.y ?? 0) + NODE_H / 2 - SYS_H / 2 + index * (SYS_H + 16),
      };
    });
  }, [system.outputs, system.nodes, byId]);

  const flagged = useMemo(() => {
    const m = new Map<string, "error" | "warn">();
    for (const p of problems) {
      if (!p.at) continue;
      if (p.severity === "error" || !m.has(p.at)) m.set(p.at, p.severity);
    }
    return m;
  }, [problems]);

  const toCanvas = useCallback(
    (clientX: number, clientY: number) => {
      const rect = surface.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - pan.x) / zoom,
        y: (clientY - rect.top - pan.y) / zoom,
      };
    },
    [pan.x, pan.y, zoom],
  );

  /* Zoom about an anchor point in viewport coordinates — the wheel handler,
     the +/− buttons and the keyboard all share this one piece of math, so
     every zoom keeps its anchor stationary. */
  const zoomBy = useCallback((factor: number, cx: number, cy: number) => {
    setZoom((z) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * factor));
      setPan((p) => ({
        x: cx - ((cx - p.x) / z) * next,
        y: cy - ((cy - p.y) / z) * next,
      }));
      return next;
    });
  }, []);

  const fit = useCallback(() => {
    if (!system.nodes.length || !surface.current) return;
    const rect = surface.current.getBoundingClientRect();
    const xs = system.nodes.map((n) => n.x);
    const ys = system.nodes.map((n) => n.y);
    const w = Math.max(...xs) + NODE_W - Math.min(...xs);
    const h = Math.max(...ys) + NODE_H - Math.min(...ys);
    const z = Math.min(1.1, Math.max(MIN_ZOOM, Math.min((rect.width - 128) / w, (rect.height - 128) / h)));
    setZoom(z);
    setPan({
      x: (rect.width - w * z) / 2 - Math.min(...xs) * z,
      y: (rect.height - h * z) / 2 - Math.min(...ys) * z,
    });
  }, [system.nodes]);

  const focusNode = useCallback(
    (id: string) => {
      const n = byId.get(id);
      if (!n || !surface.current) return;
      const rect = surface.current.getBoundingClientRect();
      setGlide(true);
      setPan({
        x: rect.width / 2 - (n.x + NODE_W / 2) * zoom,
        y: rect.height / 2 - (n.y + NODE_H / 2) * zoom,
      });
      setFlashNode(id);
      window.setTimeout(() => setGlide(false), 220);
      window.setTimeout(() => setFlashNode((f) => (f === id ? null : f)), 1300);
    },
    [byId, zoom],
  );

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = { focusNode };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, focusNode]);

  /* ── drag / wire / pan, one global listener pair ── */

  useEffect(() => {
    if (!drag && !wire && !panning) return;

    const move = (e: PointerEvent) => {
      if (drag) {
        const p = toCanvas(e.clientX, e.clientY);
        // Snap while dragging: graphs stay tidy without anyone tidying them.
        dispatch({
          type: "move-node",
          id: drag.id,
          x: Math.round((p.x - drag.dx) / GRID) * GRID,
          y: Math.round((p.y - drag.dy) / GRID) * GRID,
        });
        if (!drag.moved) setDrag({ ...drag, moved: true });
      } else if (wire) {
        const p = toCanvas(e.clientX, e.clientY);
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const over = el?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId ?? null;
        const outAttr = el?.closest<HTMLElement>("[data-out-index]")?.dataset.outIndex;
        setWire({
          ...wire,
          x: p.x,
          y: p.y,
          over: over !== wire.from ? over : null,
          overOut: outAttr !== undefined ? Number(outAttr) : null,
        });
      } else if (panning) {
        setPan({ x: e.clientX - panning.x, y: e.clientY - panning.y });
      }
    };

    const up = (e: PointerEvent) => {
      if (wire) {
        if (wire.over && wire.over !== wire.from) {
          dispatch({ type: "add-edge", source: wire.from, target: wire.over });
        } else if (wire.overOut !== null) {
          // A wire dropped on an output card points that output at its source.
          dispatch({
            type: "set-outputs",
            outputs: (system.outputs ?? []).map((o, i) =>
              i === wire.overOut ? { ...o, from_node: wire.from } : o,
            ),
          });
        } else {
          // Dropped on nothing: the n8n move. Offer the three shapes right
          // here, and whatever is picked arrives already wired.
          const p = toCanvas(e.clientX, e.clientY);
          setPicker({
            x: Math.round((p.x - NODE_W / 2) / GRID) * GRID,
            y: Math.round((p.y - NODE_H / 2) / GRID) * GRID,
            sx: e.clientX,
            sy: e.clientY,
            from: wire.from,
          });
        }
      }
      setDrag(null);
      setWire(null);
      setPanning(null);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, wire, panning, toCanvas, dispatch, system.outputs]);

  /* ── keyboard: undo, delete, duplicate, nudge, zoom, space-pan ── */

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

      if (e.key === " ") {
        spaceHeld.current = true;
        return;
      }
      if (e.key === "Escape") {
        // Staged: each press dismisses the topmost thing, never everything.
        if (showKeys) setShowKeys(false);
        else if (picker) setPicker(null);
        else onSelect(null);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? "redo" : "undo" });
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "=" || e.key === "+" || e.key === "-" || e.key === "0" || e.key === "1")) {
        e.preventDefault();
        const rect = surface.current?.getBoundingClientRect();
        const cx = (rect?.width ?? 0) / 2;
        const cy = (rect?.height ?? 0) / 2;
        if (e.key === "=" || e.key === "+") zoomBy(1.2, cx, cy);
        else if (e.key === "-") zoomBy(1 / 1.2, cx, cy);
        else if (e.key === "0") zoomBy(1 / zoom, cx, cy);
        else fit();
        return;
      }
      if ((e.key === "Backspace" || e.key === "Delete")) {
        if (selectedEdge !== null) {
          e.preventDefault();
          dispatch({ type: "delete-edge", index: selectedEdge });
          onSelect(null);
        } else if (selected?.startsWith("conn:")) {
          e.preventDefault();
          const c: Connection | undefined = listConnections(system)[Number(selected.slice(5))];
          if (c) {
            dispatch({ type: "remove-connection", server: c.def.server, slot: c.def.slot, index: c.index });
          }
          onSelect(null);
        } else if (selected?.startsWith("sys:out:")) {
          e.preventDefault();
          const i = Number(selected.slice(8));
          dispatch({ type: "set-outputs", outputs: (system.outputs ?? []).filter((_, j) => j !== i) });
          onSelect(null);
        } else if (selected === "sys:trigger") {
          e.preventDefault();
          dispatch({ type: "set-trigger", trigger: { kind: "api", config: {} } });
          onSelect(null);
        } else if (selected) {
          e.preventDefault();
          dispatch({ type: "delete-node", id: selected });
          onSelect(null);
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d" && selected && byId.has(selected)) {
        e.preventDefault();
        dispatch({ type: "duplicate-node", id: selected });
        return;
      }
      if (selected && byId.has(selected) && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const n = byId.get(selected);
        if (!n) return;
        const step = e.shiftKey ? GRID * 4 : GRID;
        dispatch({
          type: "move-node",
          id: selected,
          x: n.x + (e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0),
          y: n.y + (e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0),
        });
      }
    };
    const upKey = (e: KeyboardEvent) => {
      if (e.key === " ") spaceHeld.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", upKey);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", upKey);
    };
  }, [selected, selectedEdge, byId, dispatch, onSelect, system, picker, showKeys, zoom, zoomBy, fit]);

  /* ── wheel: scroll pans, pinch/⌘ zooms toward the cursor ──
     Trackpads send pinch as ctrl+wheel, so this one branch makes both mice
     and trackpads feel native without a mode switch anywhere. */
  useEffect(() => {
    const el = surface.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        // Keep the point under the cursor stationary while scale changes.
        zoomBy(1 - e.deltaY * 0.01, e.clientX - rect.left, e.clientY - rect.top);
      } else {
        setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
      }
    };
    // React's synthetic wheel handler is passive; preventDefault needs this.
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  /* A cancelled drag (Esc mid-drag) fires dragend without dragleave — this
     keeps the drop ghost from surviving it. */
  useEffect(() => {
    if (!ghost && !dropHint) return;
    const end = () => {
      setGhost(null);
      setDropHint(false);
    };
    window.addEventListener("dragend", end);
    window.addEventListener("drop", end);
    return () => {
      window.removeEventListener("dragend", end);
      window.removeEventListener("drop", end);
    };
  }, [ghost, dropHint]);

  useEffect(() => {
    fit();
    // Fit once on mount; refitting on every edit would fight the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── tidy: rank nodes by graph depth, lay out in columns ──
     Small and deterministic beats clever: BFS from the entry gives each node a
     column, order within a column follows current y so tidying never shuffles
     what somebody arranged vertically on purpose. */
  const tidy = useCallback(() => {
    const rank = new Map<string, number>();
    const queue: [string, number][] = system.entry ? [[system.entry, 0]] : [];
    while (queue.length) {
      const [id, r] = queue.shift()!;
      if ((rank.get(id) ?? -1) >= r) continue;
      rank.set(id, r);
      for (const e of system.edges.filter((e) => e.source === id)) queue.push([e.target, r + 1]);
    }
    for (const n of system.nodes) if (!rank.has(n.id)) rank.set(n.id, 0);

    const columns = new Map<number, string[]>();
    for (const n of [...system.nodes].sort((a, b) => a.y - b.y)) {
      const r = rank.get(n.id)!;
      columns.set(r, [...(columns.get(r) ?? []), n.id]);
    }
    for (const [r, ids] of columns) {
      ids.forEach((id, i) => {
        dispatch({ type: "move-node", id, x: 48 + r * (NODE_W + 72), y: 48 + i * (NODE_H + 44) });
      });
    }
    requestAnimationFrame(fit);
  }, [system, dispatch, fit]);

  const openPickerFrom = useCallback(
    (from: string, e: React.MouseEvent) => {
      const n = byId.get(from);
      if (!n) return;
      // Keyboard activation reports (0,0) — anchor the picker to the port's
      // element instead of the screen corner.
      const rect = e.detail === 0 ? e.currentTarget.getBoundingClientRect() : null;
      setPicker({
        x: n.x + NODE_W + 72,
        y: n.y,
        sx: rect ? rect.left + rect.width / 2 : e.clientX,
        sy: rect ? rect.top + rect.height / 2 : e.clientY,
        from,
      });
    },
    [byId],
  );

  return (
    <div
      ref={surface}
      onPointerDown={(e) => {
        if (
          spaceHeld.current ||
          e.target === e.currentTarget ||
          (e.target as HTMLElement).dataset.surface
        ) {
          onSelect(null);
          setPicker(null);
          setPanning({ x: e.clientX - pan.x, y: e.clientY - pan.y });
        }
      }}
      onDoubleClick={(e) => {
        // Double-click on empty space: the picker, unanchored. The same
        // gesture every canvas tool ships, so hands already know it.
        if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.surface) return;
        const p = toCanvas(e.clientX, e.clientY);
        setPicker({
          x: Math.round((p.x - NODE_W / 2) / GRID) * GRID,
          y: Math.round((p.y - NODE_H / 2) / GRID) * GRID,
          sx: e.clientX,
          sy: e.clientY,
        });
      }}
      onDragOver={(e) => {
        const types = e.dataTransfer.types;
        if (!types.some((x) => x.startsWith("application/x-af-"))) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        if (types.includes("application/x-af-harness") || types.includes("application/x-af-workflow")) {
          const p = toCanvas(e.clientX, e.clientY);
          const x = Math.round((p.x - NODE_W / 2) / GRID) * GRID;
          const y = Math.round((p.y - NODE_H / 2) / GRID) * GRID;
          setGhost((g) => (g && g.x === x && g.y === y ? g : { x, y }));
        } else if (["tool", "connector", "custom"].some((k) => types.includes(`application/x-af-${k}`))) {
          setDropHint(true);
        }
      }}
      onDragLeave={(e) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as globalThis.Node | null)) {
          setGhost(null);
          setDropHint(false);
        }
      }}
      onDrop={(e) => {
        setDropTarget(null);
        setGhost(null);
        setDropHint(false);
        const get = (k: string) => e.dataTransfer.getData(`application/x-af-${k}`);
        const at = () => {
          const p = toCanvas(e.clientX, e.clientY);
          return {
            x: Math.round((p.x - NODE_W / 2) / GRID) * GRID,
            y: Math.round((p.y - NODE_H / 2) / GRID) * GRID,
          };
        };
        const under = () => {
          const el = document.elementFromPoint(e.clientX, e.clientY);
          return el?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId ?? null;
        };

        const harness = get("harness");
        const tool = get("tool");
        const connector = get("connector");
        const sys = get("system");
        const workflow = get("workflow");
        const capability = get("capability");
        const custom = get("custom");
        if (!harness && !tool && !connector && !sys && !workflow && !capability && !custom) return;
        e.preventDefault();

        if (harness) {
          const p = at();
          onAddAt(harness, p.x, p.y);
        } else if (tool) {
          const target = under();
          if (target) {
            dispatch({ type: "grant-tool-card", node: target, card: tool });
            onSelect(target);
          }
        } else if (custom) {
          const target = under();
          if (target) {
            try {
              dispatch({ type: "grant-custom-tool", node: target, tool: JSON.parse(custom) });
              onSelect(target);
            } catch {
              /* malformed payload — ignore */
            }
          }
        } else if (connector) {
          const target = under();
          if (target) {
            try {
              const c = JSON.parse(connector) as { tool: string; kind: string };
              dispatch({ type: "add-connection", tool: c.tool, kind: c.kind, node: target });
              onSelect(target);
            } catch {
              /* malformed payload — ignore */
            }
          }
        } else if (sys === "input") {
          if (!system.trigger || system.trigger.kind === "api") {
            dispatch({ type: "set-trigger", trigger: { kind: "prompt", config: {} } });
          }
          onSelect("sys:trigger");
        } else if (sys === "output") {
          dispatch({ type: "set-outputs", outputs: [...(system.outputs ?? []), { kind: "response" }] });
          onSelect(`sys:out:${(system.outputs ?? []).length}`);
        } else if (workflow) {
          try {
            const w = JSON.parse(workflow) as { id: string; name: string };
            const p = at();
            dispatch({ type: "add-workflow-node", agent: w.id, name: w.name, x: p.x, y: p.y });
          } catch {
            /* malformed payload — ignore */
          }
        } else if (capability) {
          const target = under();
          if (target) {
            dispatch({ type: "grant", node: target, tool: capability });
            onSelect(target);
          } else {
            dispatch({ type: "connect-tool", name: capability });
          }
        }
      }}
      className="relative min-h-0 grow overflow-hidden bg-canvas select-none"
      style={{ cursor: panning ? "grabbing" : "default" }}
    >
      <style>{`
        @keyframes af-node-flash {
          0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--t-run) 65%, transparent); }
          70% { box-shadow: 0 0 0 12px color-mix(in srgb, var(--t-run) 0%, transparent); }
          100% { box-shadow: 0 0 0 0 transparent; }
        }
        .af-node-flash { animation: af-node-flash 550ms var(--ease-out) 2; }
      `}</style>

      <div
        data-surface="1"
        className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,var(--t-line-strong)_1px,transparent_0)]"
        style={{
          backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      />

      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          // Only the pan-to-problem glide animates; drags stay immediate.
          transition: glide ? "transform 200ms var(--ease-out)" : undefined,
        }}
      >
        <Wires
          system={system}
          byId={byId}
          wire={wire}
          zoom={zoom}
          selectedEdge={selectedEdge}
          hoverEdge={hoverEdge}
          onHoverEdge={setHoverEdge}
          onSelectEdge={(i) => onSelect(`edge:${i}`)}
          onDeleteEdge={(i) => {
            dispatch({ type: "delete-edge", index: i });
            if (selectedEdge === i) onSelect(null);
          }}
          onInsertOnEdge={(i, sx, sy) => {
            const a = byId.get(system.edges[i]?.source ?? "");
            const b = byId.get(system.edges[i]?.target ?? "");
            if (!a || !b) return;
            setPicker({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, sx, sy, edge: i });
          }}
        />

        {/* ── attachment lines: two short curves per connector (in and out),
            plus dashed boundary links ── */}
        <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width={1} height={1}>
          {connectors.map((c) => {
            const host = byId.get(c.host!)!;
            const meta = c.conn.def;
            const off = c.conn.entry.enabled === false;
            const x1a = c.x + CONN_W * 0.32;
            const x1b = c.x + CONN_W * 0.68;
            const topY = c.y;
            const bottomY = host.y + NODE_H;
            const stroke = off ? "var(--t-line)" : meta.hex;
            return (
              <g key={`cl-${c.globalIndex}`} opacity={off ? 0.5 : 0.75}>
                <path d={`M ${x1a} ${bottomY} C ${x1a} ${bottomY + 18}, ${x1a} ${topY - 18}, ${x1a} ${topY}`} fill="none" stroke={stroke} strokeWidth="1.5" />
                <path d={`M ${x1b} ${topY} C ${x1b} ${topY - 18}, ${x1b} ${bottomY + 18}, ${x1b} ${bottomY}`} fill="none" stroke={stroke} strokeWidth="1.5" />
                {/* direction ticks: down into the connector, up out of it */}
                <path d={`M ${x1a - 3.5} ${topY - 7} L ${x1a} ${topY - 1.5} L ${x1a + 3.5} ${topY - 7}`} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d={`M ${x1b - 3.5} ${bottomY + 7} L ${x1b} ${bottomY + 1.5} L ${x1b + 3.5} ${bottomY + 7}`} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </g>
            );
          })}
          {triggerCard && entryNode && (
            <path
              d={`M ${triggerCard.x + SYS_W} ${triggerCard.y + SYS_H / 2} C ${triggerCard.x + SYS_W + 28} ${triggerCard.y + SYS_H / 2}, ${entryNode.x - 28} ${entryNode.y + NODE_H / 2}, ${entryNode.x - 4} ${entryNode.y + NODE_H / 2}`}
              fill="none" stroke="var(--t-line-strong)" strokeWidth="1.5" strokeDasharray="4 4" markerEnd="url(#af-arrow)"
            />
          )}
          {outputCards.map((o) => {
            const from = (o.from ? byId.get(o.from) : null) ?? system.nodes.reduce((b, n) => (n.x > b.x ? n : b), system.nodes[0]);
            if (!from) return null;
            return (
              <path
                key={`ol-${o.index}`}
                d={`M ${from.x + NODE_W + 4} ${from.y + NODE_H / 2} C ${from.x + NODE_W + 30} ${from.y + NODE_H / 2}, ${o.x - 26} ${o.y + SYS_H / 2}, ${o.x} ${o.y + SYS_H / 2}`}
                fill="none" stroke="var(--t-line-strong)" strokeWidth="1.5" strokeDasharray="4 4" markerEnd="url(#af-arrow)"
              />
            );
          })}
        </svg>

        {/* ── connector cards, one grammar for every tool ── */}
        {connectors.map((c) => {
          const meta = c.conn.def;
          const id = `conn:${c.globalIndex}`;
          const isSel = selected === id;
          const off = c.conn.entry.enabled === false;
          return (
            <button
              key={id}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(id);
              }}
              style={{
                left: c.x,
                top: c.y,
                width: CONN_W,
                height: CONN_H,
                borderColor: isSel ? meta.hex : undefined,
                boxShadow: isSel ? `0 0 0 1px ${meta.hex}` : undefined,
                opacity: off ? 0.55 : 1,
              }}
              className={`absolute flex cursor-pointer items-center gap-2 rounded-md border bg-surface px-2.5 text-left transition-shadow ${
                isSel ? "elev-2" : "elev-1 border-line hover:border-line-strong"
              }`}
            >
              <span
                className="grid size-7 shrink-0 place-items-center rounded-md"
                style={{
                  background: `color-mix(in srgb, ${meta.hex} 14%, transparent)`,
                  color: meta.hex,
                }}
              >
                <Icon name={meta.icon} size={14} />
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[11.5px] font-semibold text-fg">
                  {String(c.conn.entry.name ?? meta.label)}
                </span>
                <span className="truncate font-mono text-[9px] tracking-[0.06em] text-faint uppercase">
                  {meta.label}{off ? " · off" : ""}
                </span>
              </span>
            </button>
          );
        })}

        {/* ── boundary cards ── */}
        {triggerCard && system.trigger && (
          <BoundaryCard
            x={triggerCard.x}
            y={triggerCard.y}
            icon={{ prompt: "prompt", api: "api", cron: "clock", webhook: "webhook" }[system.trigger.kind]}
            title="Input"
            sub={{ prompt: "User prompt", api: "External API", cron: String(system.trigger.config?.cron || "Schedule"), webhook: "Webhook" }[system.trigger.kind]}
            selected={selected === "sys:trigger"}
            onSelect={() => onSelect("sys:trigger")}
          />
        )}
        {outputCards.map((o) => (
          <BoundaryCard
            key={`out-${o.index}`}
            x={o.x}
            y={o.y}
            icon={{ response: "response", document: "file", json: "json", webhook: "webhook" }[o.output.kind]}
            title="Output"
            sub={{ response: "Response", document: "Document", json: "JSON file", webhook: "Webhook" }[o.output.kind]}
            selected={selected === `sys:out:${o.index}`}
            onSelect={() => onSelect(`sys:out:${o.index}`)}
            outIndex={o.index}
            wireOver={wire?.overOut === o.index}
          />
        ))}

        {system.nodes.map((n) => {
          const meta = HARNESS[n.harness];
          const flag = flagged.get(n.id);
          const isSel = selected === n.id;
          const isWireTarget = wire?.over === n.id;
          const isDropTarget = dropTarget === n.id;
          const tools = grantsFor(system, n.id);
          const isEntry = system.entry === n.id;
          const hasOut = system.edges.some((e) => e.source === n.id);

          return (
            <div
              key={n.id}
              data-node-id={n.id}
              tabIndex={0}
              role="button"
              aria-label={`${n.label || n.id} — ${n.harness}`}
              aria-pressed={isSel}
              onFocus={() => onSelect(n.id)}
              onPointerDown={(e) => {
                if (spaceHeld.current) return;
                e.stopPropagation();
                onSelect(n.id);
                setPicker(null);
                const p = toCanvas(e.clientX, e.clientY);
                setDrag({ id: n.id, dx: p.x - n.x, dy: p.y - n.y, moved: false });
              }}
              onDragEnter={(e) => {
                if (
                  ["capability", "tool", "connector"].some((k) =>
                    e.dataTransfer.types.includes(`application/x-af-${k}`),
                  )
                )
                  setDropTarget(n.id);
              }}
              onDragLeave={(e) => {
                if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as globalThis.Node | null)) {
                  setDropTarget((d) => (d === n.id ? null : d));
                }
              }}
              style={{
                left: n.x,
                top: n.y,
                width: NODE_W,
                minHeight: NODE_H,
                borderColor:
                  isSel || isWireTarget || isDropTarget ? `var(${meta.token})` : undefined,
                boxShadow:
                  isWireTarget || isDropTarget
                    ? `0 0 0 3px color-mix(in srgb, var(${meta.token}) 30%, transparent)`
                    : isSel
                      ? `0 0 0 1px var(${meta.token})`
                      : undefined,
              }}
              className={`group/node focusable absolute flex cursor-grab flex-col rounded-lg border bg-surface transition-shadow active:cursor-grabbing ${
                isSel || isWireTarget || isDropTarget
                  ? "elev-2"
                  : "elev-1 border-line hover:border-line-strong"
              } ${flashNode === n.id ? "af-node-flash" : ""}`}
            >
              <span
                className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r-[2px]"
                style={{ background: `var(${meta.token})` }}
              />

              {/* Selection toolbar: the two actions people reach for, on the
                  node itself rather than three panels away. */}
              {isSel && !drag && (
                <div className="absolute -top-8 right-0 flex items-center gap-px rounded-md border border-line bg-surface p-px elev-2">
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => dispatch({ type: "duplicate-node", id: n.id })}
                    title="Duplicate (⌘D)"
                    className="focusable grid size-6 cursor-pointer place-items-center rounded-sm text-faint transition-colors hover:bg-raise hover:text-fg"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <rect x="9" y="9" width="12" height="12" rx="2" />
                      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
                    </svg>
                  </button>
                  <button
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => {
                      dispatch({ type: "delete-node", id: n.id });
                      onSelect(null);
                    }}
                    title="Delete (⌫)"
                    className="focusable grid size-6 cursor-pointer place-items-center rounded-sm text-faint transition-colors hover:bg-err-bg hover:text-err"
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
                      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                    </svg>
                  </button>
                </div>
              )}

              <div className="flex items-start gap-2 px-3 pt-2.5 pb-2 pl-4">
                <div className="flex min-w-0 grow flex-col gap-0.5">
                  <span className="truncate text-[13px] font-semibold text-fg">{n.label || n.id}</span>
                  <span
                    className="truncate font-mono text-[9.5px] tracking-[0.08em] uppercase"
                    style={{ color: `var(${meta.token})` }}
                  >
                    {meta.decides}
                  </span>
                </div>
                {isEntry && (
                  <span className="mt-0.5 shrink-0 rounded-[3px] border border-line-strong px-1 font-mono text-[9px] font-semibold text-dim">
                    IN
                  </span>
                )}
                {flag && (
                  <span
                    aria-label={flag === "error" ? "has errors" : "has warnings"}
                    className={`mt-1 size-2 shrink-0 rounded-[2px] ${flag === "error" ? "bg-err" : "bg-warn"}`}
                  />
                )}
              </div>

              <div className="mt-auto flex items-center gap-1.5 border-t border-line px-3 py-1.5 pl-4">
                {tools.length ? (
                  <span className="min-w-0 truncate font-mono text-[9.5px] text-dim" title={tools.join("\n")}>
                    {tools.map((t) => t.split(".")[0]).filter((v, i, a) => a.indexOf(v) === i).join(" · ")}
                  </span>
                ) : (
                  <span className="font-mono text-[9.5px] text-ghost">no capabilities</span>
                )}
                {tools.some((t) => BY_NAME.get(t)?.taints) && (
                  <span title="Reads content authored outside the system" className="shrink-0 font-mono text-[9px] font-semibold text-warn">
                    EXT
                  </span>
                )}
                {tools.some((t) => BY_NAME.get(t)?.is_sink) && (
                  <span title="Acts on the outside world" className="shrink-0 font-mono text-[9px] font-semibold text-err">
                    OUT
                  </span>
                )}
              </div>

              {/* Input port: a real, visible thing a wire can be aimed at. */}
              <span
                aria-hidden
                className={`absolute top-1/2 -left-[6px] size-3 -translate-y-1/2 rounded-full border-2 border-surface transition-colors ${
                  isWireTarget ? "" : "bg-line-strong"
                }`}
                style={isWireTarget ? { background: `var(${meta.token})` } : undefined}
              />

              {/* Output port. Drag to wire; click for the picker. Grows on
                  hover because a 3px target is a secret, not an affordance. */}
              <button
                aria-label={`Connect from ${n.label || n.id}`}
                title="Drag to connect — or click to add the next step"
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const p = toCanvas(e.clientX, e.clientY);
                  setWire({ from: n.id, x: p.x, y: p.y, over: null, overOut: null });
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  openPickerFrom(n.id, e);
                }}
                className="focusable absolute top-1/2 -right-[9px] grid size-[18px] -translate-y-1/2 cursor-crosshair place-items-center rounded-full border-2 border-surface bg-line-strong text-on-ink opacity-90 transition-[transform,background-color,opacity] duration-100 group-hover/node:opacity-100 hover:scale-125 hover:bg-fg"
              >
                {!hasOut && (
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--t-surface)" strokeWidth="3.5" strokeLinecap="round" aria-hidden>
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                )}
              </button>
            </div>
          );
        })}

        {/* Drop ghost: where a dragged harness or workflow will land. */}
        {ghost && (
          <div
            aria-hidden
            className="pointer-events-none absolute rounded-lg border-2 border-dashed border-line-strong bg-raise/30"
            style={{ left: ghost.x, top: ghost.y, width: NODE_W, height: NODE_H }}
          />
        )}
      </div>

      {dropHint && !dropTarget && (
        <div className="pointer-events-none absolute top-1/2 left-1/2 z-30 -translate-x-1/2 -translate-y-1/2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11.5px] font-medium text-dim elev-2">
          Drop on an agent
        </div>
      )}

      {system.nodes.length === 0 && (
        <Empty
          onPick={(k) => {
            const rect = surface.current?.getBoundingClientRect();
            if (!rect) return;
            const p = toCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2);
            onAddAt(
              k,
              Math.round((p.x - NODE_W / 2) / GRID) * GRID,
              Math.round((p.y - NODE_H / 2) / GRID) * GRID,
            );
          }}
        />
      )}

      {picker && (
        <Picker
          at={picker}
          onClose={() => setPicker(null)}
          onPick={(harness) => {
            if (picker.edge !== undefined) {
              dispatch({ type: "insert-on-edge", harness, edge: picker.edge });
            } else if (picker.from) {
              dispatch({ type: "add-node-connected", harness, x: picker.x, y: picker.y, from: picker.from });
            } else {
              onAddAt(harness, picker.x, picker.y);
            }
            setPicker(null);
          }}
        />
      )}

      <Controls
        zoom={zoom}
        zoomStep={(factor) => {
          const rect = surface.current?.getBoundingClientRect();
          if (rect) zoomBy(factor, rect.width / 2, rect.height / 2);
        }}
        fit={fit}
        tidy={tidy}
        count={system.nodes.length}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={() => dispatch({ type: "undo" })}
        onRedo={() => dispatch({ type: "redo" })}
        showKeys={showKeys}
        setShowKeys={setShowKeys}
      />
    </div>
  );
}

/* ═══════════════════ The picker ═══════════════════
   Appears where the wire was dropped. Three options, because there are three
   shapes — a taxonomy small enough that the picker never needs a search box. */

function Picker({
  at,
  onPick,
  onClose,
}: {
  at: PickerAt;
  onPick: (harness: HarnessKind) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as globalThis.Node)) onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [onClose]);

  // Clamp to the viewport so a drop near an edge does not open off-screen.
  const left = Math.min(at.sx, window.innerWidth - 248);
  const top = Math.min(at.sy, window.innerHeight - 210);

  return (
    <div
      ref={ref}
      style={{ position: "fixed", left, top }}
      className="af-pop z-40 flex w-[236px] flex-col gap-1 rounded-lg border border-line bg-surface p-1.5 elev-3"
    >
      <span className="px-1.5 pt-0.5 pb-1 font-mono text-[9.5px] tracking-[0.12em] text-faint uppercase">
        {at.edge !== undefined ? "Insert between" : "What happens next?"}
      </span>
      {HARNESS_ORDER.map((k) => {
        const meta = HARNESS[k];
        return (
          <button
            key={k}
            onClick={() => onPick(k)}
            className="focusable relative flex cursor-pointer flex-col gap-0.5 rounded-md py-1.5 pr-2 pl-3 text-left transition-colors hover:bg-raise"
          >
            <span
              className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-[2px]"
              style={{ background: `var(${meta.token})` }}
            />
            <span className="text-[12.5px] font-semibold text-fg">{meta.name}</span>
            <span className="text-[10.5px] leading-[1.45] text-faint">{meta.does}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ═══════════════════ Wires ═══════════════════ */

function Wires({
  system,
  byId,
  wire,
  zoom,
  selectedEdge,
  hoverEdge,
  onHoverEdge,
  onSelectEdge,
  onDeleteEdge,
  onInsertOnEdge,
}: {
  system: AgentSystem;
  byId: Map<string, { x: number; y: number }>;
  wire: Wire | null;
  zoom: number;
  selectedEdge: number | null;
  hoverEdge: number | null;
  onHoverEdge: (i: number | null) => void;
  onSelectEdge: (i: number) => void;
  onDeleteEdge: (i: number) => void;
  onInsertOnEdge: (i: number, screenX: number, screenY: number) => void;
}) {
  const from = wire ? byId.get(wire.from) : null;

  return (
    <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width={1} height={1}>
      <defs>
        <marker id="af-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L8 4 L0 8 z" fill="var(--t-line-strong)" />
        </marker>
        <marker id="af-arrow-hot" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L8 4 L0 8 z" fill="var(--t-fg)" />
        </marker>
      </defs>

      {system.edges.map((e, i) => {
        const a = byId.get(e.source);
        const b = byId.get(e.target);
        if (!a || !b) return null;

        const x1 = a.x + NODE_W;
        const y1 = a.y + NODE_H / 2;
        const x2 = b.x;
        const y2 = b.y + NODE_H / 2;
        const bend = Math.max(40, Math.abs(x2 - x1) * 0.45);
        const d = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
        const mid = { x: (x1 + x2) / 2, y: (y1 + y2) / 2 };
        const hot = hoverEdge === i || selectedEdge === i;

        return (
          <g
            key={`${e.source}-${e.target}-${i}`}
            className="pointer-events-auto"
            onPointerEnter={() => onHoverEdge(i)}
            onPointerLeave={() => onHoverEdge(null)}
          >
            <path
              d={d}
              fill="none"
              stroke={hot ? "var(--t-fg)" : "var(--t-line-strong)"}
              strokeWidth={hot ? 2 : 1.5}
              markerEnd={hot ? "url(#af-arrow-hot)" : "url(#af-arrow)"}
            />
            {/* Wide invisible hit area: hoverable without being thick. */}
            <path
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth="16"
              className="cursor-pointer"
              onPointerDown={(ev) => ev.stopPropagation()}
              onClick={(ev) => {
                ev.stopPropagation();
                onSelectEdge(i);
              }}
            />

            {/* Stays visible while hot, lifted clear of the ⊕/× controls. */}
            {(e.when || e.label) && (
              <g transform={`translate(${mid.x} ${mid.y - (hot ? 34 : 12)})`}>
                <rect
                  x={-((e.label || e.when || "").length * 3.1 + 8)}
                  y={-8}
                  width={(e.label || e.when || "").length * 6.2 + 16}
                  height={16}
                  rx={3}
                  fill="var(--t-surface)"
                  stroke="var(--t-line)"
                />
                <text textAnchor="middle" y={3.5} className="fill-dim font-mono" style={{ fontSize: 9.5 }}>
                  {e.label || e.when}
                </text>
              </g>
            )}

            {/* Midpoint controls, sized against zoom so they stay clickable
                zoomed out. Insert-between and remove — the two things anyone
                ever wants from a wire. */}
            {hot && (
              <g transform={`translate(${mid.x} ${mid.y}) scale(${1 / Math.max(zoom, 0.55)})`}>
                <g
                  className="cursor-pointer"
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onInsertOnEdge(i, ev.clientX, ev.clientY);
                  }}
                >
                  <circle cx={-13} r={10} fill="var(--t-surface)" stroke="var(--t-line-strong)" strokeWidth={1.25} />
                  <path d="M-17 0h8M-13 -4v8" stroke="var(--t-fg)" strokeWidth={1.75} strokeLinecap="round" fill="none">
                    <title>Insert a step here</title>
                  </path>
                </g>
                <g
                  className="cursor-pointer"
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onDeleteEdge(i);
                  }}
                >
                  <circle cx={13} r={10} fill="var(--t-surface)" stroke="var(--t-line-strong)" strokeWidth={1.25} />
                  <path d="M9.5 -3.5l7 7M16.5 -3.5l-7 7" stroke="var(--t-err)" strokeWidth={1.75} strokeLinecap="round" fill="none">
                    <title>Remove this connection</title>
                  </path>
                </g>
              </g>
            )}
          </g>
        );
      })}

      {wire && from && (
        <path
          d={`M ${from.x + NODE_W} ${from.y + NODE_H / 2} C ${from.x + NODE_W + 60} ${
            from.y + NODE_H / 2
          }, ${wire.x - 60} ${wire.y}, ${wire.x} ${wire.y}`}
          fill="none"
          stroke="var(--t-run)"
          strokeWidth="1.75"
          strokeDasharray="5 5"
        />
      )}
    </svg>
  );
}

/* ═══════════════════ Boundary cards ═══════════════════
   Inputs and outputs are not harnesses — nothing in them decides a model call
   — so they draw differently on purpose: dashed, quieter, attached by dashed
   links. The eye learns the grammar without a legend. */

function BoundaryCard({
  x,
  y,
  icon,
  title,
  sub,
  selected,
  onSelect,
  outIndex,
  wireOver = false,
}: {
  x: number;
  y: number;
  icon: string;
  title: string;
  sub: string;
  selected: boolean;
  onSelect: () => void;
  /** Set on output cards so the wire hit test can find them. */
  outIndex?: number;
  wireOver?: boolean;
}) {
  return (
    <button
      data-out-index={outIndex}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      style={{
        left: x,
        top: y,
        width: SYS_W,
        height: SYS_H,
        boxShadow: wireOver ? "0 0 0 3px color-mix(in srgb, var(--t-fg) 30%, transparent)" : undefined,
      }}
      className={`absolute flex cursor-pointer items-center gap-2.5 rounded-lg border border-dashed bg-surface/85 px-3 text-left transition-[border-color,box-shadow] ${
        wireOver
          ? "border-fg elev-2"
          : selected
            ? "border-fg elev-2 shadow-[0_0_0_1px_var(--t-fg)]"
            : "border-line-strong hover:border-fg/50"
      }`}
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-raise text-dim">
        <Icon name={icon} size={14} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="font-mono text-[9px] tracking-[0.1em] text-faint uppercase">{title}</span>
        <span className="truncate text-[12px] font-semibold text-fg">{sub}</span>
      </span>
    </button>
  );
}

/* ═══════════════════ Empty canvas ═══════════════════ */

function Empty({ onPick }: { onPick: (harness: HarnessKind) => void }) {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      <div className="flex max-w-[520px] flex-col gap-4 px-6 text-center">
        <p className="text-[14px] leading-[1.6] font-medium text-dim">
          A harness answers one question: what decides there will be another model call?
        </p>
        <div className="flex flex-col gap-1.5 text-left">
          {HARNESS_ORDER.map((k) => {
            const meta = HARNESS[k];
            return (
              <button
                key={k}
                onClick={() => onPick(k)}
                className="focusable pointer-events-auto relative flex cursor-pointer items-baseline gap-2.5 rounded-md border border-line bg-surface/70 py-1.5 pr-3 pl-3.5 text-left transition-[border-color,box-shadow] hover:border-line-strong hover:elev-1"
              >
                <span
                  className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-[2px]"
                  style={{ background: `var(${meta.token})` }}
                />
                <span className="w-[132px] shrink-0 text-[12.5px] font-semibold text-fg">
                  {meta.decides}
                </span>
                <span className="text-[11.5px] text-faint">{meta.does}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[11.5px] text-faint">
          There is no fourth answer. Drag one in from the left — then drag from a node&rsquo;s edge
          onto empty space, and the next step arrives already wired.
        </p>
      </div>
    </div>
  );
}

/* ═══════════════════ Controls ═══════════════════ */

const SHORTCUTS: [string, string][] = [
  ["Scroll", "pan"],
  ["⌘ scroll", "zoom"],
  ["Space drag", "pan"],
  ["⌘Z", "undo"],
  ["⇧⌘Z", "redo"],
  ["⌘D", "duplicate"],
  ["⌫", "delete"],
  ["↑↓←→", "nudge"],
  ["⌘0", "100%"],
  ["⌘1", "fit"],
  ["Double-click canvas", "add"],
];

function Controls({
  zoom,
  zoomStep,
  fit,
  tidy,
  count,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  showKeys,
  setShowKeys,
}: {
  zoom: number;
  /** Zoom by a factor about the viewport center — same anchor math as wheel. */
  zoomStep: (factor: number) => void;
  fit: () => void;
  tidy: () => void;
  count: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  showKeys: boolean;
  setShowKeys: (v: boolean) => void;
}) {
  const cluster = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showKeys) return;
    const onDown = (e: PointerEvent) => {
      if (!cluster.current?.contains(e.target as globalThis.Node)) setShowKeys(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [showKeys, setShowKeys]);

  return (
    <div ref={cluster} className="absolute right-3 bottom-3 flex items-center gap-px rounded-md border border-line bg-surface p-px elev-1">
      {showKeys && (
        <div className="af-pop absolute right-0 bottom-[calc(100%+8px)] flex w-[228px] flex-col gap-1 rounded-lg border border-line bg-surface p-2.5 elev-3">
          <span className="pb-1 font-mono text-[9.5px] tracking-[0.12em] text-faint uppercase">
            Gestures
          </span>
          {SHORTCUTS.map(([keys, does]) => (
            <span key={keys} className="flex items-center gap-2">
              <Kbd>{keys}</Kbd>
              <span className="text-[11px] text-dim">{does}</span>
            </span>
          ))}
        </div>
      )}
      <button
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo (⌘Z)"
        aria-label="Undo"
        className="focusable grid size-7 cursor-pointer place-items-center rounded-sm text-dim transition-colors hover:bg-raise hover:text-fg disabled:cursor-default disabled:opacity-35"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
        </svg>
      </button>
      <button
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo (⇧⌘Z)"
        aria-label="Redo"
        className="focusable grid size-7 cursor-pointer place-items-center rounded-sm text-dim transition-colors hover:bg-raise hover:text-fg disabled:cursor-default disabled:opacity-35"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m15 14 5-5-5-5" />
          <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
        </svg>
      </button>
      <span className="mx-px h-4 w-px bg-line" />
      <button
        onClick={tidy}
        disabled={count < 2}
        title="Tidy up — rank the graph left to right"
        className="focusable grid size-7 cursor-pointer place-items-center rounded-sm text-dim transition-colors hover:bg-raise hover:text-fg disabled:cursor-default disabled:opacity-35"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <rect x="3" y="4" width="7" height="6" rx="1.5" />
          <rect x="14" y="4" width="7" height="6" rx="1.5" />
          <rect x="8.5" y="14" width="7" height="6" rx="1.5" />
        </svg>
      </button>
      <span className="mx-px h-4 w-px bg-line" />
      <button
        onClick={() => zoomStep(1 / 1.2)}
        aria-label="Zoom out"
        title="Zoom out (⌘−)"
        className="focusable size-7 cursor-pointer rounded-sm text-[15px] leading-none font-medium text-dim transition-colors hover:bg-raise hover:text-fg"
      >
        −
      </button>
      <button
        onClick={fit}
        className="focusable h-7 cursor-pointer rounded-sm px-2 font-mono text-[11px] text-dim transition-colors hover:bg-raise hover:text-fg"
        title="Fit to view (⌘1)"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        onClick={() => zoomStep(1.2)}
        aria-label="Zoom in"
        title="Zoom in (⌘=)"
        className="focusable size-7 cursor-pointer rounded-sm text-[15px] leading-none font-medium text-dim transition-colors hover:bg-raise hover:text-fg"
      >
        +
      </button>
      <span className="mx-px h-4 w-px bg-line" />
      <IconButton
        label="Keyboard shortcuts"
        size="sm"
        onClick={() => setShowKeys(!showKeys)}
        className="rounded-sm"
      >
        <span className="text-[12px] font-semibold">?</span>
      </IconButton>
    </div>
  );
}
