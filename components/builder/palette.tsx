"use client";

import { useEffect, useRef, useState } from "react";
import { TOOL_CARDS, TOOL_BY_ID } from "@/lib/catalogue";
import { CONNECTOR_DEFS } from "@/lib/connections";
import { toolOf, useMcp, type McpServer, type McpTool } from "@/lib/use-mcp";
import { RISK } from "@/lib/spec";
import { HARNESS, HARNESS_ORDER, OUTPUT_META, TRIGGER_META, type AgentSystem } from "@/lib/spec";
import type { HarnessKind } from "@/lib/spec";
import { Icon } from "./icons";
import { Button } from "../ui";

/**
 * The left rail: everything that can land on the canvas. One category shows at
 * a time, chosen from an icon strip — the rail is a toolbox with tabs, not a
 * scroll of accordions. A search above the strip cuts across all of them.
 *
 * Every card is draggable and every card says so the same way. Drag payloads
 * carry a type-prefixed mime so the canvas can tell an agent from a connector
 * without either knowing the other's internals.
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

export function Palette({
  system,
  onAdd,
  refreshTick,
  selected = null,
  onGrant,
}: {
  system: AgentSystem;
  onAdd: (harness: HarnessKind) => void;
  /** Bumped by the shell after a save so the workflow rail refreshes. */
  refreshTick: number;
  /** The selected node, when the shell supports click-to-grant. */
  selected?: string | null;
  /** Clicking a card grants it with the same payload the drag would carry. */
  onGrant?: (kind: "tool" | "connector" | "system" | "harness" | "workflow" | "custom", payload: string) => void;
}) {
  const [cat, setCat] = useState<Cat>("agents");
  const [saved, setSaved] = useState<SavedAgent[] | null>(null);
  const [query, setQuery] = useState("");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const { servers: mcp, refresh: refreshMcp } = useMcp();

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
        onClick={() => onAdd(k)}
        draggable
        onDragStart={(e) => dragPayload(e, "harness", k)}
        title="Drag onto the canvas, or click to add"
        className="focusable group relative flex cursor-grab items-center gap-2.5 rounded-md border border-line bg-surface py-2 pr-2.5 pl-3.5 text-left transition-[border-color,box-shadow] hover:border-line-strong hover:elev-1 active:cursor-grabbing"
      >
        <span
          className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r-[2px]"
          style={{ background: `var(${meta.token})` }}
        />
        <span
          className="grid size-7 shrink-0 place-items-center rounded-md"
          style={{ background: `var(${meta.tint})`, color: `var(${meta.token})` }}
        >
          <Icon name="bot" size={15} />
        </span>
        <span className="flex min-w-0 flex-col gap-px">
          <span className="text-[12.5px] font-semibold text-fg">{meta.name}</span>
          <span className="truncate text-[10.5px] text-faint">{meta.does}</span>
        </span>
      </button>
    );
  };

  const toolCard = (t: (typeof TOOL_CARDS)[number]) => (
    <button
      key={t.id}
      draggable
      onDragStart={(e) => dragPayload(e, "tool", t.id)}
      onClick={onGrant ? () => onGrant("tool", t.id) : undefined}
      title={`${t.blurb}\n\nDrag onto an agent to grant it.`}
      className="focusable flex cursor-grab flex-col items-start gap-1.5 rounded-md border border-line bg-surface px-2.5 py-2 text-left transition-[border-color,box-shadow] hover:border-line-strong hover:elev-1 active:cursor-grabbing"
    >
      <span className="grid size-6 place-items-center rounded-md bg-raise text-dim">
        <Icon name={t.icon} size={13} />
      </span>
      <span className="text-[11.5px] leading-tight font-medium text-fg">{t.label}</span>
      <span className="w-full truncate text-[9.5px] text-faint">{t.blurb}</span>
    </button>
  );

  /* A team's own tool. The card carries the whole binding, so dropping it is
     the same gesture as a built-in card and needs nothing else to exist. */
  const customCard = (s: McpServer, t: McpTool) => {
    const tool = toolOf(s, t);
    const payload = JSON.stringify(tool);
    return (
      <button
        key={tool.name}
        draggable
        onDragStart={(e) => dragPayload(e, "custom", payload)}
        onClick={onGrant ? () => onGrant("custom", payload) : undefined}
        title={`${t.description || t.name}\n\n${tool.name} · ${RISK[tool.risk].label}: ${RISK[tool.risk].means}\n\nDrag onto an agent to grant it.`}
        className="focusable flex cursor-grab flex-col items-start gap-1.5 rounded-md border border-line bg-surface px-2.5 py-2 text-left transition-[border-color,box-shadow] hover:border-line-strong hover:elev-1 active:cursor-grabbing"
      >
        <span className="flex w-full items-center gap-1.5">
          <span className="grid size-6 place-items-center rounded-md bg-raise text-dim">
            <Icon name="plug" size={13} />
          </span>
          <span className="grow" />
          <span
            className="rounded-[3px] px-1 py-px font-mono text-[8.5px] tracking-wide uppercase"
            style={{ color: `var(${RISK[tool.risk].tone})`, background: `color-mix(in oklab, var(${RISK[tool.risk].tone}) 12%, transparent)` }}
          >
            {tool.risk}
          </span>
        </span>
        <span className="w-full truncate font-mono text-[11px] leading-tight font-medium text-fg">{t.name}</span>
        <span className="w-full truncate text-[9.5px] text-faint">{t.description || `on ${s.label}`}</span>
      </button>
    );
  };

  const connectorCard = (c: (typeof CONNECTOR_DEFS)[number]) => (
    <button
      key={`${c.tool}:${c.kind}`}
      draggable
      onDragStart={(e) => dragPayload(e, "connector", JSON.stringify({ tool: c.tool, kind: c.kind }))}
      onClick={onGrant ? () => onGrant("connector", JSON.stringify({ tool: c.tool, kind: c.kind })) : undefined}
      title={`${c.blurb}.\n\nDrag onto an agent — it grants ${c.tool} and attaches beneath.`}
      className="focusable flex cursor-grab items-center gap-2 rounded-md border border-line bg-surface px-2 py-1.5 text-left transition-[border-color,box-shadow] hover:border-line-strong hover:elev-1 active:cursor-grabbing"
    >
      <span
        className="grid size-6 shrink-0 place-items-center rounded-md"
        style={{ background: `color-mix(in srgb, ${c.hex} 14%, transparent)`, color: c.hex }}
      >
        <Icon name={c.icon} size={13} />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[11.5px] font-medium text-fg">{c.label}</span>
        <span className="truncate text-[9.5px] text-faint">{c.blurb}</span>
      </span>
    </button>
  );

  const systemCard = (side: "input" | "output") => {
    const input = side === "input";
    return (
      <button
        key={side}
        draggable
        onDragStart={(e) => dragPayload(e, "system", side)}
        onClick={onGrant ? () => onGrant("system", side) : undefined}
        title={Object.values(input ? TRIGGER_META : OUTPUT_META).map((m) => m.label).join(" · ")}
        className="focusable flex cursor-grab items-center gap-2.5 rounded-md border border-dashed border-line-strong bg-surface px-2.5 py-2 text-left transition-colors hover:border-fg/40 active:cursor-grabbing"
      >
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-raise text-dim">
          <Icon name={input ? "prompt" : "response"} size={13} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-[11.5px] font-medium text-fg">{input ? "Input" : "Output"}</span>
          <span className="truncate text-[9.5px] text-faint">
            {input ? "Prompt · API · schedule · webhook" : "Response · document · JSON · webhook"}
          </span>
        </span>
      </button>
    );
  };

  const workflowCard = (a: SavedAgent) => {
    const self = a.id === system.id;
    return (
      <button
        key={a.id}
        draggable={!self}
        onDragStart={(e) => dragPayload(e, "workflow", JSON.stringify({ id: a.id, name: a.name }))}
        onClick={onGrant && !self ? () => onGrant("workflow", JSON.stringify({ id: a.id, name: a.name })) : undefined}
        title={self ? "This workflow can't call itself." : `${a.description || a.name}\n\nDrag in to run it as a step.`}
        className={`focusable flex items-center gap-2.5 rounded-md border border-line bg-surface px-2.5 py-2 text-left transition-[border-color,box-shadow] hover:border-line-strong hover:elev-1 ${
          self ? "opacity-45" : "cursor-grab active:cursor-grabbing"
        }`}
      >
        <span className="grid size-6 shrink-0 place-items-center rounded-md bg-run-bg text-run">
          <Icon name="workflow" size={13} />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[11.5px] font-medium text-fg">{a.name}</span>
          <span className="truncate font-mono text-[9.5px] text-faint">
            {a.id} · {a.nodes} node{a.nodes === 1 ? "" : "s"}
            {self ? " · this one" : ""}
          </span>
        </span>
      </button>
    );
  };

  const q = query.trim().toLowerCase();
  const hit = (...parts: (string | undefined)[]) => parts.some((p) => p?.toLowerCase().includes(q));
  const found = q
    ? {
        agents: HARNESS_ORDER.filter((k) => hit(HARNESS[k].name, HARNESS[k].does)),
        tools: TOOL_CARDS.filter((t) => hit(t.label, t.blurb)),
        custom: (mcp ?? []).flatMap((s) => s.tools.filter((t) => hit(t.name, t.description, s.label)).map((t) => [s, t] as const)),
        connectors: CONNECTOR_DEFS.filter((c) => hit(c.label, c.blurb, c.tool)),
        system: (["input", "output"] as const).filter((s) =>
          hit(s, ...Object.values(s === "input" ? TRIGGER_META : OUTPUT_META).map((m) => m.label)),
        ),
        workflows: (saved ?? []).filter((a) => hit(a.name, a.id)),
      }
    : null;

  const cap = (label: string) => (
    <span className="pt-1 font-mono text-[9px] tracking-[0.14em] text-ghost uppercase">{label}</span>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Search ── */}
      <div className="relative shrink-0 border-b border-line p-2">
        <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-ghost">
          <Icon name="search" size={13} />
        </span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && setQuery("")}
          placeholder="Search cards…"
          className="h-8 w-full rounded-md border border-line-strong bg-field pr-2.5 pl-7 text-[13px] text-fg transition-[border-color,box-shadow] duration-100 ease-[var(--ease-out)] placeholder:text-ghost focus:outline-none focus-visible:border-fg focus-visible:ring-2 focus-visible:ring-fg/15"
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
              <div className="grid grid-cols-2 gap-1.5">{found.tools.map(toolCard)}</div>
            )}
            {found.custom.length > 0 && cap("Custom tools")}
            {found.custom.length > 0 && (
              <div className="grid grid-cols-2 gap-1.5">{found.custom.map(([s, t]) => customCard(s, t))}</div>
            )}
            {found.connectors.length > 0 && cap("Connectors")}
            {found.connectors.length > 0 && (
              <div className="grid grid-cols-2 gap-1.5">{found.connectors.map(connectorCard)}</div>
            )}
            {found.system.length > 0 && cap("System")}
            {found.system.length > 0 && (
              <div className="flex flex-col gap-1.5">{found.system.map(systemCard)}</div>
            )}
            {found.workflows.length > 0 && cap("Workflows")}
            {found.workflows.length > 0 && (
              <div className="flex flex-col gap-1.5">{found.workflows.map(workflowCard)}</div>
            )}
            {found.agents.length + found.tools.length + found.custom.length + found.connectors.length + found.system.length + found.workflows.length === 0 && (
              <p className="text-[11px] text-faint">Nothing matches &ldquo;{query.trim()}&rdquo;.</p>
            )}
          </>
        ) : (
          <>
            {cat === "agents" && (
              <>
                <p className="text-[11.5px] leading-[1.5] text-faint">
                  The three shapes an agent can take — named by what decides the next model call.
                </p>
                <div className="flex flex-col gap-1.5">{HARNESS_ORDER.map(harnessCard)}</div>
              </>
            )}

            {cat === "tools" && (
              <>
                <p className="text-[11.5px] leading-[1.5] text-faint">
                  Drop one onto an agent. What a tool reaches is decided by connectors and
                  configuration — the agent only knows the verb.
                </p>
                <div className="grid grid-cols-2 gap-1.5">{TOOL_CARDS.map(toolCard)}</div>

                {cap("Custom tools · MCP")}
                <p className="text-[11.5px] leading-[1.5] text-faint">
                  Your team&rsquo;s own tools, served over MCP. Connect a server once and every
                  tool it lists becomes a card here; the same server is attached at run time.
                </p>
                {mcp === null && <div className="h-[46px] animate-pulse rounded-md bg-raise" />}
                {(mcp ?? []).map((s) => (
                  <McpServerRail key={s.id} server={s} onChanged={refreshMcp}>
                    <div className="grid grid-cols-2 gap-1.5">{s.tools.map((t) => customCard(s, t))}</div>
                  </McpServerRail>
                ))}
                <McpConnect onConnected={refreshMcp} />
              </>
            )}

            {cat === "connectors" && (
              <>
                <p className="text-[11.5px] leading-[1.5] text-faint">
                  What the tools plug into. Drop one onto an agent and it snaps in beneath, granting
                  the owning tool as it lands — the agent never learns which backend it was.
                </p>
                {["retrieval", "records", "events", "notify", "peer", "compute", "code"].map((tool) => {
                  const defs = CONNECTOR_DEFS.filter((c) => c.tool === tool);
                  if (!defs.length) return null;
                  return (
                    <div key={tool} className="flex flex-col gap-1.5">
                      {cap(TOOL_BY_ID.get(tool)?.label ?? tool)}
                      <div className="grid grid-cols-2 gap-1.5">{defs.map(connectorCard)}</div>
                    </div>
                  );
                })}
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
                  Saved agents, callable as steps. Drop one in and this workflow runs it — chaining is
                  a real sub-run, not a picture of one.
                </p>
                {saved === null && (
                  <div className="flex flex-col gap-1.5">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-[46px] animate-pulse rounded-md bg-raise" />
                    ))}
                  </div>
                )}
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

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 truncate text-[11px] font-medium text-fg">{server.label}</span>
        <span className="shrink-0 font-mono text-[9.5px] text-ghost">
          {server.id} · {server.tools.length}
        </span>
        <span className="grow" />
        <span title={`Ask the server for its tools again.\n${server.command} ${server.args.join(" ")}`}>
          <Button size="sm" variant="quiet" disabled={!!busy} loading={busy === "refresh"} onClick={refresh}>
            Refresh
          </Button>
        </span>
        <Button size="sm" variant="quiet" tone={confirm ? "err" : "neutral"} disabled={!!busy} onClick={remove}>
          {confirm ? "Sure?" : "Remove"}
        </Button>
      </div>
      {error && <p className="text-[10px] text-err">{error}</p>}
      {children}
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
      <button
        onClick={() => setOpen(true)}
        className="focusable flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-line-strong bg-surface px-2.5 py-2 text-left text-[11.5px] font-medium text-dim transition-colors hover:border-fg hover:text-fg"
      >
        <span className="grid size-6 place-items-center rounded-md bg-raise">
          <Icon name="plug" size={13} />
        </span>
        Connect an MCP server
      </button>
    );
  }

  const field = "focusable w-full rounded-md border border-line bg-canvas px-2 py-1.5 font-mono text-[11px] text-fg placeholder:text-ghost";
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-surface p-2.5">
      <span className="text-[11.5px] font-medium text-fg">Connect an MCP server</span>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold text-dim">Name</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Risk engine" className={field} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold text-dim">Command that starts it (stdio)</span>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="python3 tools/risk_server.py"
          className={field}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] font-semibold text-dim">Environment, one KEY=VALUE per line (optional)</span>
        <textarea
          value={env}
          onChange={(e) => setEnv(e.target.value)}
          rows={2}
          spellCheck={false}
          placeholder={"API_BASE=https://…\nAPI_KEY=${secret:risk-key}"}
          className={`${field} resize-y`}
        />
      </label>
      <p className="text-[10px] leading-[1.5] text-faint">
        The server is started once now to list its tools, then again by the runtime whenever an
        agent that holds one of them runs. It runs beside the runtime, never inside it.
      </p>
      {error && <p className="text-[10px] leading-[1.4] text-err">{error}</p>}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="quiet" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <span className="grow" />
        <Button size="sm" variant="solid" tone="ink" disabled={busy || !command.trim()} loading={busy} onClick={connect}>
          {busy ? "Discovering tools…" : "Connect"}
        </Button>
      </div>
    </div>
  );
}
