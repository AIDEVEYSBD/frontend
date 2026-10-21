"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TOOL_CARDS, TOOL_BY_ID, type ToolCard } from "@/lib/catalogue";
import { CONNECTOR_DEFS, type ConnectorDef } from "@/lib/connections";
import { VENDORS, VENDOR_GROUPS, type Vendor } from "@/lib/vendors";
import { toolOf, type McpServer, type McpTool } from "@/lib/use-mcp";
import { pinnedTools, railOf, type HeldServer } from "@/lib/mcp-registry";
import { HARNESS, HARNESS_ORDER, OUTPUT_META, TRIGGER_META, type AgentSystem } from "@/lib/spec";
import type { HarnessKind } from "@/lib/spec";
import { Icon } from "./icons";
import { Button } from "../ui";
import { Skeleton } from "../loaders";
import { AddServerForm, ServerStatusTag } from "../tool-servers";
import { Text } from "./controls";
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
  /** The registered MCP servers, owned by the shell so the canvas and the
      inspector draw the same marks the rail does. Only an approved server's
      pinned tools are offered; the rest are listed held, with the reason. */
  mcp: { servers: McpServer[] | null; error?: string; refresh: () => void };
}) {
  const [cat, setCat] = useState<Cat>("agents");
  const [saved, setSaved] = useState<SavedAgent[] | null>(null);
  const [query, setQuery] = useState("");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const { servers: mcpServers, refresh: refreshMcp } = mcp;
  const rail = railOf(mcpServers);

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
        custom: rail.usable.flatMap((s) =>
          pinnedTools(s).filter((t) => hit(t.name, t.description, s.label, s.id)).map((t) => [s, t] as const),
        ),
        // A held server that matches says why its tools are not on offer.
        held: rail.held.filter((h) => hit(h.server.label, h.server.id, ...pinnedTools(h.server).map((t) => t.name))),
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
            {found.custom.length + found.held.length > 0 && cap("Custom tools")}
            {found.custom.length > 0 && (
              <div className="flex flex-col gap-1.5">{found.custom.map(([s, t]) => customCard(s, t, true))}</div>
            )}
            {found.held.length > 0 && (
              <div className="flex flex-col gap-1.5">{found.held.map((h) => <HeldServerRow key={h.server.id} held={h} />)}</div>
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
            {found.agents.length + found.tools.length + found.custom.length + found.held.length + found.connectors.length + found.vendors.length + found.system.length + found.workflows.length === 0 && (
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
                  Your team&rsquo;s own tools, served over MCP. A registered server&rsquo;s tools
                  become cards here once a person approves its pinned tool list; the same pin is
                  what attaches at run time. Approve, rescan and remove servers under{" "}
                  <Link href="/configuration#registry" target="_blank" className="focusable rounded-sm font-medium text-fg underline decoration-line-strong underline-offset-2 hover:decoration-fg">
                    Configuration · Tool servers
                  </Link>
                  .
                </p>
                {mcpServers === null && <Skeleton lines={2} />}
                {mcp.error && <p className="text-[10.5px] leading-[1.4] text-err">{mcp.error}</p>}
                {rail.usable.map((s) => (
                  <McpServerRail key={s.id} server={s}>
                    <div className="flex flex-col gap-1.5">{pinnedTools(s).map((t) => customCard(s, t))}</div>
                  </McpServerRail>
                ))}
                {rail.held.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <span className="pt-1 text-[10.5px] font-medium text-faint">Held back · not attachable</span>
                    {rail.held.map((h) => (
                      <HeldServerRow key={h.server.id} held={h} />
                    ))}
                  </div>
                )}
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

function McpServerRail({ server, children }: { server: McpServer; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  const n = pinnedTools(server).length;

  return (
    <div className="flex flex-col gap-1.5">
      {/* The header is the server's identity: its mark, its name, how many
          tools its approved pin lists. It folds, because thirteen servers of
          three tools each is a rail nobody can scan otherwise. Approving,
          rescanning and removing live in Configuration, beside the pin and
          the scan they act on. */}
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
      </div>
      {open && children}
    </div>
  );
}

/** A server whose tools are not on offer: not draggable, saying why in one line. */
function HeldServerRow({ held }: { held: HeldServer }) {
  const { server, reason } = held;
  return (
    <div className="flex items-start gap-2 rounded-md border border-dashed border-line-strong bg-surface py-1.5 pr-2 pl-2.5" title={`${server.label}: ${reason}`} aria-disabled="true">
      <span className="opacity-50">
        <ServerMark id={server.id} label={server.label} size={20} />
      </span>
      <span className="flex min-w-0 grow flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-[11.5px] font-medium text-faint">{shortLabel(server.label)}</span>
          <span className="grow" />
          <ServerStatusTag status={server.status} />
        </span>
        <span className="line-clamp-2 text-[10px] leading-[1.45] text-faint">{reason}</span>
      </span>
    </div>
  );
}

function McpConnect({ onConnected }: { onConnected: () => void }) {
  const [open, setOpen] = useState(false);
  const [admitted, setAdmitted] = useState("");

  if (!open) {
    return (
      <div className="flex flex-col gap-1.5">
        {admitted && (
          <p className="text-[10.5px] leading-[1.45] text-faint">
            {admitted} is registered and pending: its tools appear here once its pin is approved in Configuration.
          </p>
        )}
        <Button size="sm" variant="solid" tone="neutral" permission="configure" className="self-start" onClick={() => setOpen(true)}>
          <Icon name="server" size={13} />
          Register an MCP server
        </Button>
      </div>
    );
  }

  return (
    <AddServerForm
      stacked
      onCancel={() => setOpen(false)}
      onRefused={onConnected}
      onAdded={(s) => {
        setAdmitted(s.label || s.id);
        setOpen(false);
        onConnected();
      }}
    />
  );
}
