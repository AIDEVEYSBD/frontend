"use client";

import { useEffect, useRef, useState } from "react";
import { TOOL_CARDS, TOOL_BY_ID, type ToolCard } from "@/lib/catalogue";
import { CONNECTOR_DEFS, type ConnectorDef } from "@/lib/connections";
import { VENDORS, VENDOR_GROUPS, type Vendor } from "@/lib/vendors";
import { toolOf, type McpServer, type McpTool } from "@/lib/use-mcp";
import { HARNESS, HARNESS_ORDER, OUTPUT_META, TRIGGER_META, type AgentSystem } from "@/lib/spec";
import type { HarnessKind } from "@/lib/spec";
import { Icon } from "./icons";
import { Button, IconButton } from "../ui";
import { Skeleton } from "../loaders";
import { Area, Row, Text } from "./controls";
import { ConnectorMark, Grip, RiskPill, ServerMark, Tile, ToolMark, cardRisk, cardVerbs } from "./marks";
import { BrandMark } from "../brand";

/**
 * The left rail: everything that can land on the canvas. One category shows at
 * a time, chosen from an icon strip — the rail is a toolbox with tabs, not a
 * scroll of accordions. A search above the strip cuts across all of them.
 *
 * Every card is draggable and every card says so the same way: a grip at its
 * right edge, a grab cursor, and a category intro that names the gesture. Drag
 * payloads carry a type-prefixed mime so the canvas can tell an agent from a
 * connector without either knowing the other's internals.
 */

interface SavedAgent {
  id: string;
  name: string;
  description: string;
  nodes: number;
}

function dragPayload(e: React.DragEvent, kind: string, value: string) {
  e.dataTransfer.setData(`application/x-af-${kind}`, value);
  e.dataTransfer.effectAllowed = "copy";
}

type Cat = "agents" | "tools" | "connectors" | "system" | "workflows";

const CATS: { id: Cat; label: string; icon: string }[] = [
  { id: "agents", label: "Agents", icon: "bot" },
  { id: "tools", label: "Tools", icon: "chip" },
  { id: "connectors", label: "Connectors", icon: "plug" },
  { id: "system", label: "System", icon: "api" },
  { id: "workflows", label: "Workflows", icon: "workflow" },
];

/** One card chrome for everything that can be picked up and dropped on an agent. */
const CARD =
  "focusable group relative flex cursor-grab items-center gap-2.5 rounded-md border border-line bg-surface text-left transition-[border-color,box-shadow] hover:border-line-strong hover:elev-1 active:cursor-grabbing";

/** A server's label without its trailing qualifier: "Aegis directory (Entra ID
 *  stand-in)" reads as "Aegis directory" beside a mark that already says the
 *  rest. The full label stays in the tooltip. */
function shortLabel(label: string): string {
  const bare = label.replace(/\s*\([^()]*\)\s*$/, "").trim();
  return bare || label;
}

/** A capability verb — what the card lets an agent do, one word each. */
function Verb({ children }: { children: string }) {
  return (
    <span className="rounded-[3px] bg-raise px-1 py-px font-mono text-[9px] leading-[1.5] text-dim">
      {children}
    </span>
  );
}

export function Palette({
  system,
  onAdd,
  refreshTick,
  selected = null,
  onGrant,
  mcp,
}: {
  system: AgentSystem;
  onAdd: (harness: HarnessKind) => void;
  /** Bumped by the shell after a save so the workflow rail refreshes. */
  refreshTick: number;
  /** The selected node, when the shell supports click-to-grant. */
  selected?: string | null;
  /** Clicking a card grants it with the same payload the drag would carry. */
  onGrant?: (kind: "tool" | "connector" | "system" | "harness" | "workflow" | "custom", payload: string) => void;
  /** The connected MCP servers, owned by the shell so the canvas and the
      inspector draw the same marks the rail does. */
  mcp: { servers: McpServer[] | null; refresh: () => void };
}) {
  const [cat, setCat] = useState<Cat>("agents");
  const [saved, setSaved] = useState<SavedAgent[] | null>(null);
  const [query, setQuery] = useState("");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const { servers: mcpServers, refresh: refreshMcp } = mcp;

  useEffect(() => {
    let stop = false;
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d) => !stop && setSaved(d.agents ?? []))
      .catch(() => !stop && setSaved([]));
    return () => {
      stop = true;
    };
  }, [refreshTick]);

  // Grant targeting lives with the shell; the prop is accepted so the rail's
  // contract is stable while click-to-grant rolls out.
  void selected;

  const harnessCard = (k: HarnessKind) => {
    const meta = HARNESS[k];
    return (
      <button
        key={k}
        type="button"
        onClick={() => onAdd(k)}
        draggable
        onDragStart={(e) => dragPayload(e, "harness", k)}
        title={meta.name}
        className="focusable group relative flex cursor-grab items-center gap-2.5 rounded-md border border-line bg-surface py-2 pr-6 pl-3.5 text-left transition-[border-color,box-shadow] hover:border-line-strong hover:elev-1 active:cursor-grabbing"
      >
        <span
          className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r-[2px]"
          style={{ background: `var(${meta.token})` }}
        />
        <Tile hue={meta.token} size={28}>
          <Icon name="bot" size={15} />
        </Tile>
        <span className="flex min-w-0 grow flex-col gap-px">
          <span className="text-[12.5px] font-semibold text-fg">{meta.name}</span>
          <span className="truncate text-[10.5px] text-faint">{meta.does}</span>
        </span>
        <Grip />
      </button>
    );
  };

  /* A built-in tool: its glyph in its own hue, the verbs it grants, and the
     risk of the riskiest one — a card that shows what it does and how much it
     can hurt has said the useful part. */
  const toolCard = (t: ToolCard) => {
    const risk = cardRisk(t);
    return (
      <button
        key={t.id}
        type="button"
        draggable
        onDragStart={(e) => dragPayload(e, "tool", t.id)}
        onClick={onGrant ? () => onGrant("tool", t.id) : undefined}
        title={t.label}
        className={`${CARD} py-2 pr-6 pl-2.5`}
      >
        <ToolMark card={t} size={26} />
        <span className="flex min-w-0 grow flex-col gap-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[12.5px] leading-tight font-semibold text-fg">{t.label}</span>
            <span className="grow" />
            <RiskPill risk={risk} />
          </span>
          <span className="flex flex-wrap gap-1">
            {cardVerbs(t).map((v) => (
              <Verb key={v}>{v}</Verb>
            ))}
          </span>
        </span>
        <Grip />
      </button>
    );
  };

  /* A team's own tool. The card carries the whole binding, so dropping it is
     the same gesture as a built-in card and needs nothing else to exist. The
     mark is the server's: a vendor logo when the server names one, else a
     tile in a hue keyed to the server id. */
  const customCard = (s: McpServer, t: McpTool, showServer = false) => {
    const tool = toolOf(s, t);
    const payload = JSON.stringify(tool);
    return (
      <button
        key={tool.name}
        type="button"
        draggable
        onDragStart={(e) => dragPayload(e, "custom", payload)}
        onClick={onGrant ? () => onGrant("custom", payload) : undefined}
        title={tool.name}
        className={`${CARD} py-1.5 pr-6 pl-2.5`}
      >
        <ServerMark id={s.id} label={s.label} size={24} />
        <span className="flex min-w-0 grow flex-col gap-px">
          <span className="truncate font-mono text-[11px] leading-[1.5] font-medium text-fg">{t.name}</span>
          <span className="flex items-center gap-2">
            <span className="min-w-0 truncate text-[10px] text-faint">
              {showServer ? shortLabel(s.label) : t.description || `on ${shortLabel(s.label)}`}
            </span>
            <span className="grow" />
            <RiskPill risk={tool.risk} />
          </span>
        </span>
        <Grip />
      </button>
    );
  };

  const connectorCard = (c: ConnectorDef) => (
    <button
      key={`${c.tool}:${c.kind}`}
      type="button"
      draggable
      onDragStart={(e) => dragPayload(e, "connector", JSON.stringify({ tool: c.tool, kind: c.kind }))}
      onClick={onGrant ? () => onGrant("connector", JSON.stringify({ tool: c.tool, kind: c.kind })) : undefined}
      title={c.label}
      className={`${CARD} py-1.5 pr-6 pl-2.5`}
    >
      <ConnectorMark def={c} size={26} />
      <span className="flex min-w-0 grow flex-col">
        <span className="truncate text-[12px] font-medium text-fg">{c.label}</span>
        <span className="truncate text-[10px] text-faint">{c.blurb}</span>
      </span>
      <Grip />
    </button>
  );

  /* A vendor from the catalogue. It attaches the backend that product speaks
     through, named after the product — so the spec reads `splunk` while the
     runtime still only knows "a log API". Nothing here claims a bespoke
     integration exists; the card says which backend it lands as. */
  const vendorCard = (v: Vendor) => {
    const def = CONNECTOR_DEFS.find((c) => c.tool === v.tool && c.kind === v.kind);
    const payload = JSON.stringify({ tool: v.tool, kind: v.kind, name: v.slug });
    return (
      <button
        key={v.name}
        type="button"
        draggable
        onDragStart={(e) => dragPayload(e, "connector", payload)}
        onClick={onGrant ? () => onGrant("connector", payload) : undefined}
        title={`${v.name} — attaches as ${def?.label ?? v.kind}`}
        className={`${CARD} py-1.5 pr-6 pl-2.5`}
      >
        <span className="grid size-[26px] shrink-0 place-items-center rounded-md bg-raise">
          <BrandMark name={v.name} size={15} />
        </span>
        <span className="flex min-w-0 grow flex-col">
          <span className="truncate text-[12px] font-medium text-fg">{v.name}</span>
          <span className="truncate text-[10px] text-faint">via {def?.label ?? v.kind}</span>
        </span>
        <Grip />
      </button>
    );
  };

  const systemCard = (side: "input" | "output") => {
    const input = side === "input";
    return (
      <button
        key={side}
        type="button"
        draggable
        onDragStart={(e) => dragPayload(e, "system", side)}
        onClick={onGrant ? () => onGrant("system", side) : undefined}
        title={input ? "Input" : "Output"}
        className="focusable group relative flex cursor-grab items-center gap-2.5 rounded-md border border-dashed border-line-strong bg-surface py-2 pr-6 pl-2.5 text-left transition-colors hover:border-fg/40 active:cursor-grabbing"
      >
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-raise text-dim">
          <Icon name={input ? "prompt" : "response"} size={13} />
        </span>
        <span className="flex min-w-0 grow flex-col">
          <span className="text-[11.5px] font-medium text-fg">{input ? "Input" : "Output"}</span>
          <span className="truncate text-[9.5px] text-faint">
            {input ? "Prompt · API · schedule · webhook" : "Response · document · JSON · webhook"}
          </span>
        </span>
        <Grip />
      </button>
    );
  };

  const workflowCard = (a: SavedAgent) => {
    const self = a.id === system.id;
    return (
      <button
        key={a.id}
        type="button"
        draggable={!self}
        onDragStart={(e) => dragPayload(e, "workflow", JSON.stringify({ id: a.id, name: a.name }))}
        onClick={onGrant && !self ? () => onGrant("workflow", JSON.stringify({ id: a.id, name: a.name })) : undefined}
        title={a.name}
        className={`focusable group relative flex items-center gap-2.5 rounded-md border border-line bg-surface py-2 pl-2.5 text-left transition-[border-color,box-shadow] hover:border-line-strong hover:elev-1 ${
          self ? "pr-2 opacity-45" : "cursor-grab pr-6 active:cursor-grabbing"
        }`}
      >
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-raise text-dim">
          <Icon name="workflow" size={13} />
        </span>
        <span className="flex min-w-0 grow flex-col">
          <span className="truncate text-[11.5px] font-medium text-fg">{a.name}</span>
          <span className="truncate font-mono text-[9.5px] text-faint">
            {a.id} · {a.nodes} node{a.nodes === 1 ? "" : "s"}
            {self ? " · this one, can't call itself" : ""}
          </span>
        </span>
        {!self && <Grip />}
      </button>
    );
  };

  const q = query.trim().toLowerCase();
  const hit = (...parts: (string | undefined)[]) => parts.some((p) => p?.toLowerCase().includes(q));
  const [catalogueOpen, setCatalogueOpen] = useState(false);

  const found = q
    ? {
        agents: HARNESS_ORDER.filter((k) => hit(HARNESS[k].name, HARNESS[k].does)),
        tools: TOOL_CARDS.filter((t) => hit(t.label, t.blurb, ...t.capabilities)),
        custom: (mcpServers ?? []).flatMap((s) =>
          s.tools.filter((t) => hit(t.name, t.description, s.label, s.id)).map((t) => [s, t] as const),
        ),
        connectors: CONNECTOR_DEFS.filter((c) => hit(c.label, c.blurb, c.tool, c.kind)),
        vendors: VENDORS.filter((v) => hit(v.name, v.group)),
        system: (["input", "output"] as const).filter((s) =>
          hit(s, ...Object.values(s === "input" ? TRIGGER_META : OUTPUT_META).map((m) => m.label)),
        ),
        workflows: (saved ?? []).filter((a) => hit(a.name, a.id)),
      }
    : null;

  const cap = (label: string) => <span className="pt-1 text-[11px] font-medium text-faint">{label}</span>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Search ── */}
      <div className="shrink-0 border-b border-line p-2">
        <Text
          value={query}
          onChange={setQuery}
          onKeyDown={(e) => e.key === "Escape" && setQuery("")}
          placeholder="Search cards…"
          aria-label="Search cards"
          leading={<Icon name="search" size={13} />}
        />
      </div>

      {/* ── Category strip ── */}
      <div role="tablist" aria-label="Card categories" className="grid shrink-0 grid-cols-5 gap-0.5 border-b border-line bg-raise/40 p-1">
        {CATS.map((c, i) => {
          const active = cat === c.id;
          return (
            <button
              key={c.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => setCat(c.id)}
              onKeyDown={(e) => {
                if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
                e.preventDefault();
                const next = (i + (e.key === "ArrowRight" ? 1 : -1) + CATS.length) % CATS.length;
                setCat(CATS[next].id);
                tabRefs.current[next]?.focus();
              }}
              title={c.label}
              className={`focusable flex cursor-pointer flex-col items-center gap-1 rounded-md px-1 py-1.5 transition-colors ${
                active
                  ? "bg-surface text-fg shadow-[var(--shadow-1)]"
                  : "text-faint hover:bg-surface/60 hover:text-dim"
              }`}
            >
              <Icon name={c.icon} size={15} />
              <span className={`text-[9.5px] leading-none ${active ? "font-semibold" : "font-medium"}`}>
                {c.label}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex min-h-0 grow flex-col gap-2.5 overflow-y-auto p-2.5">
        {found ? (
          <>
            {found.agents.length > 0 && cap("Agents")}
            {found.agents.length > 0 && (
              <div className="flex flex-col gap-1.5">{found.agents.map(harnessCard)}</div>
            )}
            {found.tools.length > 0 && cap("Tools")}
            {found.tools.length > 0 && (
              <div className="flex flex-col gap-1.5">{found.tools.map(toolCard)}</div>
            )}
            {found.custom.length > 0 && cap("Custom tools")}
            {found.custom.length > 0 && (
              <div className="flex flex-col gap-1.5">{found.custom.map(([s, t]) => customCard(s, t, true))}</div>
            )}
            {found.connectors.length > 0 && cap("Connectors")}
            {found.connectors.length > 0 && (
              <div className="flex flex-col gap-1.5">{found.connectors.map(connectorCard)}</div>
            )}
            {found.vendors.length > 0 && cap("Catalogue")}
            {found.vendors.length > 0 && (
              <div className="flex flex-col gap-1.5">{found.vendors.slice(0, 40).map(vendorCard)}</div>
            )}
            {found.system.length > 0 && cap("System")}
            {found.system.length > 0 && (
              <div className="flex flex-col gap-1.5">{found.system.map(systemCard)}</div>
            )}
            {found.workflows.length > 0 && cap("Workflows")}
            {found.workflows.length > 0 && (
              <div className="flex flex-col gap-1.5">{found.workflows.map(workflowCard)}</div>
            )}
            {found.agents.length + found.tools.length + found.custom.length + found.connectors.length + found.vendors.length + found.system.length + found.workflows.length === 0 && (
              <p className="text-[11px] text-faint">Nothing matches &ldquo;{query.trim()}&rdquo;.</p>
            )}
          </>
        ) : (
          <>
            {cat === "agents" && (
              <>
                <p className="text-[11.5px] leading-[1.5] text-faint">
                  The three shapes an agent can take — named by what decides the next model call.
                  Drag one onto the canvas, or click it to add.
                </p>
                <div className="flex flex-col gap-1.5">{HARNESS_ORDER.map(harnessCard)}</div>
              </>
            )}

            {cat === "tools" && (
              <>
                <p className="text-[11.5px] leading-[1.5] text-faint">
                  Drop one onto an agent, or click it to grant the selected agent. What a tool
                  reaches is decided by connectors and configuration — the agent only knows the
                  verb.
                </p>
                <div className="flex flex-col gap-1.5">{TOOL_CARDS.map(toolCard)}</div>

                {cap("Custom tools · MCP")}
                <p className="text-[11.5px] leading-[1.5] text-faint">
                  Your team&rsquo;s own tools, served over MCP. Connect a server once and every
                  tool it lists becomes a card here; the same server is attached at run time.
                </p>
                {mcpServers === null && <Skeleton lines={2} />}
                {(mcpServers ?? []).map((s) => (
                  <McpServerRail key={s.id} server={s} onChanged={refreshMcp}>
                    <div className="flex flex-col gap-1.5">{s.tools.map((t) => customCard(s, t))}</div>
                  </McpServerRail>
                ))}
                <McpConnect onConnected={refreshMcp} />
              </>
            )}

            {cat === "connectors" && (
              <>
                <p className="text-[11.5px] leading-[1.5] text-faint">
                  What the tools plug into. Drop one onto an agent (or click it to attach to the
                  selected agent) and it snaps in beneath, granting the owning tool as it lands —
                  the agent never learns which backend it was.
                </p>
                {["retrieval", "records", "events", "notify", "peer", "compute", "code"].map((tool) => {
                  const defs = CONNECTOR_DEFS.filter((c) => c.tool === tool);
                  if (!defs.length) return null;
                  const card = TOOL_BY_ID.get(tool);
                  return (
                    <div key={tool} className="flex flex-col gap-1.5">
                      <span className="flex items-center gap-1.5 pt-1">
                        {card && <ToolMark card={card} size={16} />}
                        <span className="text-[11px] font-medium text-faint">{card?.label ?? tool}</span>
                      </span>
                      <div className="flex flex-col gap-1.5">{defs.map(connectorCard)}</div>
                    </div>
                  );
                })}

                {/* ── The catalogue ──
                   The same list the site advertises, grouped the same way. A
                   card here is a named instance of one of the backends above,
                   not a separate integration, and it says which one it lands
                   as. Collapsed by default: this rail is for building, and 134
                   logos would bury the ten things that actually connect. */}
                <div className="flex flex-col gap-1.5 border-t border-line pt-3">
                  <button
                    type="button"
                    onClick={() => setCatalogueOpen((v) => !v)}
                    className="focusable flex items-center gap-1.5 rounded-sm text-left"
                  >
                    <span
                      className="grid size-3.5 shrink-0 place-items-center text-dim transition-transform"
                      style={{ transform: catalogueOpen ? "rotate(90deg)" : "none" }}
                      aria-hidden
                    >
                      <svg viewBox="0 0 16 16" width="9" height="9" fill="none">
                        <path d="M5.5 3.5 10.5 8l-5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </span>
                    <span className="text-[11px] font-medium text-fg">Catalogue</span>
                    <span className="text-[10px] text-faint">{VENDORS.length} systems</span>
                  </button>
                  <p className="text-[11px] leading-[1.5] text-faint">
                    Every system we advertise. Each one attaches the backend it speaks through,
                    named after the product, so a spec reads <span className="font-mono">splunk</span>{" "}
                    while the agent still only knows the verb.
                  </p>
                  {catalogueOpen &&
                    VENDOR_GROUPS.map((g) => (
                      <div key={g.name} className="flex flex-col gap-1.5">
                        <span className="flex items-center gap-1.5 pt-1">
                          <span
                            className="size-2 shrink-0 rounded-[3px]"
                            style={{ background: `var(--t-c${g.c})` }}
                          />
                          <span className="text-[11px] font-medium text-faint">{g.name}</span>
                          <span className="text-[10px] text-ghost">{g.items.length}</span>
                        </span>
                        <div className="flex flex-col gap-1.5">
                          {VENDORS.filter((v) => v.group === g.name).map(vendorCard)}
                        </div>
                      </div>
                    ))}
                </div>
              </>
            )}

            {cat === "system" && (
              <>
                <p className="text-[11.5px] leading-[1.5] text-faint">
                  The workflow&rsquo;s boundary: how a run starts, and what happens to the result.
                </p>
                <div className="flex flex-col gap-1.5">
                  {systemCard("input")}
                  {systemCard("output")}
                </div>
              </>
            )}

            {cat === "workflows" && (
              <>
                <p className="text-[11.5px] leading-[1.5] text-faint">
                  Saved agents, callable as steps. Drop one in, or click it, and this workflow runs
                  it — chaining is a real sub-run, not a picture of one.
                </p>
                {saved === null && <Skeleton lines={4} />}
                {saved?.length === 0 && (
                  <p className="text-[11px] text-faint">
                    Nothing saved yet. Build something and press Save — it appears here for every
                    other workflow to use.
                  </p>
                )}
                <div className="flex flex-col gap-1.5">{(saved ?? []).map(workflowCard)}</div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════ custom tools over MCP ═══════════════════ */

/** A square icon action for the server header — small enough that the
 *  header keeps room for the name it exists to show. */
function RailBtn({
  label,
  onClick,
  disabled = false,
  loading = false,
  tone = "neutral",
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: "neutral" | "err";
  children: React.ReactNode;
}) {
  // Destructive from the first click: solid err, never a hover tint.
  return (
    <IconButton
      size="sm"
      label={label}
      onClick={onClick}
      disabled={disabled}
      loading={loading}
      className={`shrink-0 rounded-sm ${tone === "err" ? "!bg-err text-on-solid" : ""}`}
    >
      {children}
    </IconButton>
  );
}

function McpServerRail({
  server,
  onChanged,
  children,
}: {
  server: McpServer;
  onChanged: () => void;
  children: React.ReactNode;
}) {
  const [busy, setBusy] = useState<"refresh" | "remove" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(true);

  const refresh = async () => {
    setBusy("refresh");
    setError("");
    try {
      const r = await fetch("/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: server.id, refresh: true }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(String(d.error ?? r.status));
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirm) {
      setConfirm(true);
      setTimeout(() => setConfirm(false), 3000);
      return;
    }
    setBusy("remove");
    await fetch(`/api/mcp?id=${encodeURIComponent(server.id)}`, { method: "DELETE" });
    setBusy(null);
    onChanged();
  };

  const n = server.tools.length;

  return (
    <div className="flex flex-col gap-1.5">
      {/* The header is the server's identity: its mark, its name, how many
          tools it lists. It folds, because thirteen servers of three tools
          each is a rail nobody can scan otherwise. */}
      <div className="-mx-1 flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title={server.label}
          className="focusable flex min-w-0 grow cursor-pointer items-center gap-2 rounded-sm py-1 pr-1 pl-1 text-left transition-colors hover:bg-raise/70"
        >
          <svg
            width="8"
            height="8"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`shrink-0 text-ghost transition-transform duration-150 ${open ? "rotate-90" : ""}`}
            aria-hidden
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
          <ServerMark id={server.id} label={server.label} size={20} />
          <span className="min-w-0 truncate text-[11.5px] font-semibold text-fg">{shortLabel(server.label)}</span>
          <span className="tnum shrink-0 rounded-[3px] bg-raise px-1 font-mono text-[9.5px] leading-[1.6] text-dim">
            {n}
          </span>
        </button>
        <RailBtn
          label="Refresh — ask the server for its tools again"
          onClick={refresh}
          disabled={!!busy}
          loading={busy === "refresh"}
        >
          <Icon name="refresh" size={11} />
        </RailBtn>
        {confirm ? (
          <Button
            size="sm"
            variant="solid"
            tone="err"
            disabled={!!busy}
            loading={busy === "remove"}
            onClick={remove}
          >
            Remove server and its tools?
          </Button>
        ) : (
          <RailBtn label={`Remove ${server.label}`} onClick={remove} disabled={!!busy} tone="err">
            <Icon name="cross" size={11} strokeWidth={2.25} />
          </RailBtn>
        )}
      </div>
      {error && <p className="text-[10px] text-err">{error}</p>}
      {open && children}
    </div>
  );
}

function McpConnect({ onConnected }: { onConnected: () => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [command, setCommand] = useState("");
  const [env, setEnv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const connect = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label, command, env }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(String(d.error ?? r.status));
      setLabel("");
      setCommand("");
      setEnv("");
      setOpen(false);
      onConnected();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button size="sm" variant="outline" permission="configure" className="self-start" onClick={() => setOpen(true)}>
        <Icon name="server" size={13} />
        Connect an MCP server
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-line bg-surface p-2.5">
      <span className="text-[11.5px] font-medium text-fg">Connect an MCP server</span>
      <Row label="Name" tight>
        <Text value={label} onChange={setLabel} placeholder="Risk engine" aria-label="Name" />
      </Row>
      <Row label="Command that starts it (stdio)" tight>
        <Text
          mono
          value={command}
          onChange={setCommand}
          placeholder="python3 tools/risk_server.py"
          aria-label="Command that starts it"
        />
      </Row>
      <Row label="Environment, one KEY=VALUE per line (optional)" tight>
        <Area
          mono
          rows={2}
          spellCheck={false}
          value={env}
          onChange={setEnv}
          placeholder={"API_BASE=https://…\nAPI_KEY=${secret:risk-key}"}
          aria-label="Environment variables"
        />
      </Row>
      <p className="text-[10px] leading-[1.5] text-faint">
        The server is started once now to list its tools, then again by the runtime whenever an
        agent that holds one of them runs. It runs beside the runtime, never inside it.
      </p>
      {error && <p className="text-[10px] leading-[1.4] text-err">{error}</p>}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="solid" tone="err" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <span className="grow" />
        <Button size="sm" variant="solid" tone="ink" permission="configure" disabled={busy || !command.trim()} loading={busy} onClick={connect}>
          {busy ? "Discovering tools…" : "Connect"}
        </Button>
      </div>
    </div>
  );
}
