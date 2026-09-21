"use client";

import { useEffect, useMemo, useState } from "react";
import { Mono, Status, Tag } from "./ui";
import { BrandMark } from "./brand";
import { SURFACE_LABEL, VENDORS, VENDOR_GROUPS, type Surface } from "@/lib/vendors";
import { activityFor, compact, type Activity } from "@/lib/demo-activity";
import { usePageFacts } from "./assistant";
import { MCP_ENDPOINT } from "@/lib/site";
import { hueFor } from "@/lib/hue";
import { CONNECTOR_DEFS } from "@/lib/connections";
import { TOOL_BY_ID } from "@/lib/catalogue";
import { AttachedAgents } from "./attached-agents";
import { Pick } from "./select";
import { soon } from "@/lib/soon";
import type { AttachedAgent } from "@/lib/attached";

/**
 * Configuration: everything this factory is set up with, in one place.
 *
 * The shape follows the question a reviewer actually asks — not "what settings
 * exist" but "what is wired, what does it reach, and who signs". So the page
 * leads with the connected sources table: every backend configured across every
 * deployed workflow, which agent holds it, whether it returns untrusted content
 * or acts outside the system, and whether anything has ever called it.
 *
 * A control appears here only when it changes something, and a figure appears
 * only when it was measured. A source that is configured but never called says
 * "never" rather than being quietly omitted, because a source nobody reads is
 * the most common kind of wrong configuration.
 */

interface Source {
  name: string;
  kind: string;
  tool: string;
  server: string;
  slot: string;
  agent: string;
  agentName: string;
  node: string;
  taints: boolean;
  sink: boolean;
  risk: string;
  calls: number;
  lastUsed: string | null;
  settings: string[];
  usesVault: boolean;
}

interface Data {
  deployment: {
    registry: string;
    gateway: string;
    endpoint: string;
    runs: number;
    workflows: number;
    deployed: number;
    egress: string[];
    billing: boolean;
  };
  models: { id: string; label: string; class?: string; price_in?: number; price_out?: number }[];
  defaultModel: string;
  classDefaults: Record<string, string>;
  sources: Source[];
  tools: {
    tool: string;
    agent: string;
    agentName: string;
    risk: string;
    taints: boolean;
    sink: boolean;
    scoped: boolean;
    summary: string;
    calls: number;
    lastUsed: string | null;
  }[];
  gates: { agent: string; agentName: string; atOrAbove: string; approvers: string[] }[];
  vaultKeys: string[];
  apiKeys: { name: string; agent: string | null; prefix: string; last_used: string | null; revoked_at: string | null }[];
  queue: Record<string, number>;
  basis: string;
}

const SECTIONS = [
  { id: "deployment", label: "Deployment" },
  { id: "agents", label: "Third-party agents" },
  { id: "mcp", label: "MCP server" },
  { id: "sources", label: "Connected sources" },
  { id: "tools", label: "Tool registry" },
  { id: "gates", label: "Where a person signs" },
  { id: "models", label: "Models" },
  { id: "credentials", label: "Credentials" },
  { id: "ingress", label: "Ingress" },
];

const KIND_SURFACE: Record<string, Surface> = { rest: "api", http: "api", documents: "files", webhook: "webhook", events: "events", sql: "db", db: "db" };

/** The wire between a product and an agent, in three words. */
function Interface({ surface, nativeMcp, note }: { surface: Surface; nativeMcp: boolean; note?: string }) {
  if (nativeMcp) {
    return (
      <span className="flex flex-col gap-1" title={note}>
        <span className="flex items-center gap-1.5">
          <Tag tone="run" solid>Native MCP</Tag>
        </span>
        <span className="max-w-[220px] truncate text-[10px] text-ghost">{note || "vendor's MCP server"} · security layer in between</span>
      </span>
    );
  }
  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5">
        <Tag>{SURFACE_LABEL[surface]}</Tag>
        <span className="text-[10px] text-ghost">→</span>
        <Tag tone="ok" solid>Served as MCP</Tag>
      </span>
      <span className="text-[10px] text-ghost">Agent Factory hosts the MCP; security layer in between</span>
    </span>
  );
}

const RISK_TONE: Record<string, "ok" | "warn" | "err" | "neutral"> = {
  read: "ok",
  write: "warn",
  risky: "err",
};

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function Configuration() {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [agent, setAgent] = useState<string>("");
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const [wiring, setWiring] = useState<"all" | "wired" | "available">("all");
  const [mcp, setMcp] = useState<{ endpoint: string; transport: string; auth: string; tools: { name: string; description: string; action: boolean }[]; client: Record<string, unknown> } | null>(null);
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const [attached, setAttached] = useState<AttachedAgent[]>([]);

  useEffect(() => {
    // The remembered folds are read after the first paint, so the server and
    // the client render the same page and the folds settle a tick later.
    const cancel = soon(() => {
      try {
        const saved = localStorage.getItem("af.config.folds");
        if (saved) setFolded(JSON.parse(saved));
      } catch {
        /* fresh */
      }
    });
    fetch("/api/mcp/server").then((r) => r.json()).then(setMcp).catch(() => {});
    return cancel;
  }, []);
  const toggle = (id: string) => {
    setFolded((f) => {
      const next = { ...f, [id]: !f[id] };
      try {
        localStorage.setItem("af.config.folds", JSON.stringify(next));
      } catch {
        /* fine */
      }
      return next;
    });
  };
  const expand = (id: string) => setFolded((f) => (f[id] ? { ...f, [id]: false } : f));

  useEffect(() => {
    let stop = false;
    fetch("/api/configuration")
      .then((r) => r.json())
      .then((d) => !stop && setData(d))
      .catch(() => !stop && setFailed(true));
    return () => {
      stop = true;
    };
  }, []);

  const agents = useMemo(
    () => [...new Set((data?.sources ?? []).map((s) => s.agent))].sort(),
    [data],
  );
  const sources = useMemo(() => (data?.sources ?? []).filter((s) => !agent || s.agent === agent), [data, agent]);
  const tools = useMemo(() => (data?.tools ?? []).filter((t) => !agent || t.agent === agent), [data, agent]);
  const used = sources.filter((s) => s.calls > 0).length;

  /* Every connector this factory offers, in one table: the ones actually wired
     into a workflow first, carrying their real usage from the journals, then the
     rest of the advertised catalogue as connected estate-wide, carrying the
     estate activity from lib/demo-activity. The two are never mixed: a wired
     row's counts are measured, an estate row's are demonstration. */
  const rows = useMemo(() => {
    const defOf = (tool: string, kind: string) =>
      CONNECTOR_DEFS.find((c) => c.tool === tool && c.kind === kind);
    const grantsOf = (tool: string) => TOOL_BY_ID.get(tool)?.capabilities ?? [];

    const wiredRows = sources.map((s) => {
      const vendor = VENDORS.find((v) => v.slug === s.name);
      const def = defOf(s.tool, s.kind);
      return {
        key: `w:${s.agent}:${s.server}:${s.name}`,
        wired: true,
        brand: vendor?.name ?? s.name,
        product: vendor?.name ?? s.name,
        group: vendor?.group ?? "Configured in this estate",
        kindLabel: vendor?.group ?? def?.label ?? s.kind,
        contributes: def?.blurb ?? `${s.tool} backend`,
        ingest: `${s.server}.${s.slot} · ${s.kind}${s.usesVault ? " · vault credential" : ""}`,
        grants: grantsOf(s.tool),
        heldBy: s.agentName,
        node: s.node,
        calls: s.calls,
        lastUsed: s.lastUsed,
        taints: s.taints,
        sink: s.sink,
        activity: null as Activity | null,
        surface: (vendor?.surface ?? KIND_SURFACE[s.kind] ?? "api") as Surface,
        nativeMcp: vendor?.nativeMcp ?? false,
        nativeMcpNote: vendor?.nativeMcpNote ?? "",
      };
    });

    const claimed = new Set(wiredRows.map((r) => r.product.toLowerCase()));
    const availableRows = VENDORS.filter((v) => !claimed.has(v.name.toLowerCase())).map((v) => {
      const def = defOf(v.tool, v.kind);
      const card = TOOL_BY_ID.get(v.tool);
      return {
        key: `a:${v.slug}`,
        wired: false,
        brand: v.name,
        product: v.name,
        group: v.group,
        kindLabel: v.group,
        contributes: def?.blurb ?? card?.blurb ?? "",
        ingest: `${v.tool}.${v.kind} · attaches as ${def?.label ?? v.kind}`,
        grants: grantsOf(v.tool),
        heldBy: "",
        node: "",
        calls: 0,
        lastUsed: null as string | null,
        taints: Boolean(card && ["retrieval", "events", "peer", "code"].includes(v.tool)),
        sink: Boolean(card && ["notify", "records", "peer"].includes(v.tool)),
        activity: activityFor(v.slug, v.group) as Activity | null,
        surface: v.surface,
        nativeMcp: v.nativeMcp,
        nativeMcpNote: v.nativeMcpNote,
      };
    });

    /* The catalogue reads first — it is what someone came to this page to see.
       Connectors that belong to no advertised product are this deployment's own
       plumbing, so they sit at the end where they belong rather than pushing
       the catalogue down. A wired row that IS a catalogue product keeps its
       place in the catalogue, because that is the point of wiring one. */
    const order = new Map(VENDOR_GROUPS.map((g, i) => [g.name, i]));
    const catalogued = [...wiredRows, ...availableRows].filter((r) => order.has(r.group));
    const own = wiredRows.filter((r) => !order.has(r.group));
    catalogued.sort(
      (a, b) =>
        (order.get(a.group) ?? 99) - (order.get(b.group) ?? 99) ||
        Number(b.wired) - Number(a.wired) ||
        a.product.localeCompare(b.product),
    );
    return [...catalogued, ...own];
  }, [sources]);

  const wired = rows.filter((r) => r.wired);
  usePageFacts(
    data
      ? {
          deployment: data.deployment,
          connectors: { total: rows.length, wiredIntoWorkflows: wired.length, calledAtLeastOnce: used },
          wired: wired.map((r) => ({ product: r.product, heldBy: r.heldBy, calls: r.calls })),
          degraded: rows.filter((r) => r.activity && r.activity.health !== "healthy").map((r) => ({ product: r.product, health: r.activity!.health })),
          tools: data.tools.length,
          gates: data.gates,
          models: data.models.map((m) => m.id),
          defaultModel: data.defaultModel,
          interfaces: { servedAsMcp: rows.filter((r) => !r.nativeMcp).length, nativeMcpBrokered: rows.filter((r) => r.nativeMcp).length },
          agentFactoryMcp: { endpoint: MCP_ENDPOINT, tools: mcp ? mcp.tools.map((t) => t.name) : "described at the endpoint" },
          thirdPartyAgents: {
            total: attached.length,
            overSdk: attached.filter((a) => a.mode === "sdk").length,
            overA2a: attached.filter((a) => a.mode === "a2a").length,
            agents: attached.map((a) => ({ name: a.name, id: a.id, mode: a.mode, framework: a.framework, owner: a.owner, runs30d: a.runs30d, cost30d: a.cost30d, denials30d: a.denials30d })),
          },
        }
      : null,
  );
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (wiring === "all" || (wiring === "wired") === r.wired) &&
        (!group || r.group === group) &&
        (!term ||
          r.product.toLowerCase().includes(term) ||
          r.kindLabel.toLowerCase().includes(term) ||
          r.grants.some((g) => g.toLowerCase().includes(term))),
    );
  }, [rows, q, group, wiring]);

  return (
    <div className="min-h-full">
      {/* The same frame as the control pane: full width to the same cap, the same gutter, so the two pages line up at every size. */}
      <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-5 px-5 py-7">
        <header className="flex flex-col gap-1.5">
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Configuration</h1>
          <p className="max-w-[80ch] text-[12.5px] leading-[1.6] text-faint">
            Review the systems, tools and services available to deployed workflows, including
            their scope, risk and observed use. This view is derived from current workflow and run
            records; protected credential values are never displayed.
          </p>
        </header>

        {/* ── the strip ── */}
        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Workflows", value: data ? String(data.deployment.workflows) : "—", sub: data ? `${data.deployment.deployed} deployed` : "" },
            { label: "Connectors", value: data ? String(rows.length) : "—", sub: data ? `${wired.length} wired into workflows · ${rows.length - wired.length} connected estate-wide` : "" },
            { label: "Tools granted", value: data ? String(data.tools.length) : "—", sub: "across all workflows" },
            { label: "Models offered", value: data ? String(data.models.length) : "—", sub: data?.defaultModel ?? "" },
            { label: "Credentials", value: data ? String(data.vaultKeys.length) : "—", sub: "in the vault" },
            { label: "Runs on record", value: data ? String(data.deployment.runs) : "—", sub: "the basis for usage" },
          ].map((k) => (
            <div key={k.label} className="flex flex-col gap-0.5 bg-surface px-3 py-2.5">
              <span className="tnum text-[17px] leading-none font-semibold">{k.value}</span>
              <span className="text-[10.5px] text-faint">{k.label}</span>
              {k.sub && <span className="truncate text-[9.5px] text-ghost">{k.sub}</span>}
            </div>
          ))}
        </section>

        {/* ── anchors ── */}
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-y border-line py-2">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={() => expand(s.id)}
              className="focusable rounded-sm text-[11.5px] text-faint transition-colors hover:text-fg"
            >
              {s.label}
            </a>
          ))}
          <span className="grow" />
          {agents.length > 1 && (
            <span className="flex items-center gap-1.5">
              <span className="text-[10.5px] text-ghost">workflow</span>
              <span className="block w-[200px]">
                <Pick value={agent} onChange={setAgent} options={[{ value: "", label: "all" }, ...agents.map((a) => ({ value: a, label: a }))]} aria-label="Workflow" />
              </span>
            </span>
          )}
        </nav>

        {failed && (
          <p className="text-[12px] text-err">The configuration could not be read from the runtime.</p>
        )}

        {/* ── deployment ── */}
        <Panel id="deployment" folded={Boolean(folded["deployment"])} onToggle={() => toggle("deployment")} title="Deployment" caption="Where this factory runs and what it talks to.">
          <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
            {[
              { k: "Registry", v: data?.deployment.registry === "postgres" ? "Postgres" : "Workspace files" },
              { k: "Model gateway", v: data?.deployment.gateway ?? "—" },
              { k: "Resource", v: data?.deployment.endpoint?.replace(/^https:\/\//, "") ?? "—", mono: true },
              { k: "Billing feed", v: data?.deployment.billing ? "Azure Cost Management" : "not connected" },
            ].map((f) => (
              <div key={f.k} className="flex flex-col gap-0.5 bg-surface px-4 py-2.5">
                <span className="text-[10.5px] text-ghost">{f.k}</span>
                <span className={`truncate text-[12px] text-fg ${f.mono ? "font-mono text-[11px]" : ""}`}>{f.v}</span>
              </div>
            ))}
          </div>
        </Panel>

        {/* ── third-party agents: attached over the SDK or A2A ── */}
        <Panel
          id="agents"
          folded={Boolean(folded["agents"])}
          onToggle={() => toggle("agents")}
          title="Third-party agents"
          caption="Agents built elsewhere — a client's own, a vendor's, another team's — attached to this control plane so they run under the same journal, cost accounting, guardrails and theater as the factory's own. Two ways in: the Agent Factory SDK for an agent whose code you own, and A2A for one whose code cannot change, where the factory stands between the agent and everything it reaches."
          meta={
            <>
              <Tag tone="run" solid>SDK</Tag>
              <Tag tone="queue" solid>A2A</Tag>
            </>
          }
        >
          <AttachedAgents onLoaded={(agents) => setAttached(agents)} />
        </Panel>

        {/* ── the platform as an MCP server ── */}
        <Panel
          id="mcp"
          folded={Boolean(folded["mcp"])}
          onToggle={() => toggle("mcp")}
          title="Agent Factory as an MCP server"
          caption="The platform exposes itself over the Model Context Protocol, so other agents, Claude, Cursor or a client's own tooling can read the estate and start workflows the same way the platform's agents reach a client's systems: tools behind a key, every call through the policy engine and into the journal."
          meta={<Tag tone="ok" solid>MCP</Tag>}
        >
          <div className="grid gap-px bg-line lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <div className="flex flex-col bg-surface">
              <div className="grid gap-px border-b border-line bg-line sm:grid-cols-3">
                {[
                  { k: "Endpoint", v: mcp?.endpoint ?? MCP_ENDPOINT, mono: true },
                  { k: "Transport", v: mcp ? "Streamable HTTP · JSON-RPC 2.0" : "—" },
                  { k: "Authentication", v: "Bearer API key · same keys as ingress" },
                ].map((f) => (
                  <div key={f.k} className="flex flex-col gap-0.5 bg-surface px-4 py-2.5">
                    <span className="text-[10.5px] text-ghost">{f.k}</span>
                    <span className={`truncate text-[12px] text-fg ${f.mono ? "font-mono text-[11px]" : ""}`}>{f.v}</span>
                  </div>
                ))}
              </div>
              <span className="border-b border-line px-4 py-2 text-[10.5px] text-ghost">Tools exposed</span>
              {(mcp?.tools ?? []).map((t) => (
                <span key={t.name} className="flex items-start gap-3 border-b border-line px-4 py-2 last:border-0">
                  <Mono className="w-[150px] shrink-0 pt-px text-[11px] text-fg">{t.name}</Mono>
                  <span className="min-w-0 grow text-[11px] leading-[1.5] text-faint">{t.description}</span>
                  <Tag tone={t.action ? "warn" : "neutral"}>{t.action ? "action" : "read"}</Tag>
                </span>
              ))}
              {!mcp && <span className="px-4 py-3 text-[11.5px] text-faint">Reading the server description…</span>}
            </div>
            <div className="flex flex-col bg-surface">
              <span className="border-b border-line px-4 py-2 text-[10.5px] text-ghost">Connect a client</span>
              <pre className="m-0 overflow-x-auto px-4 py-3 font-mono text-[10.5px] leading-[1.6] text-dim">
                {JSON.stringify((mcp?.client as { claude?: unknown } | undefined)?.claude ?? { mcpServers: { "agent-factory": { type: "http", url: MCP_ENDPOINT, headers: { Authorization: "Bearer <api key>" } } } }, null, 2)}
              </pre>
              <span className="border-t border-line px-4 py-2.5 text-[11px] leading-[1.55] text-faint">
                Reading tools accept any active key. Starting a workflow needs a key scoped to that workflow, exactly as the trigger endpoint does, because the same key is forwarded to it. Until the first key is minted the server is open, like ingress.
              </span>
            </div>
          </div>
        </Panel>

        {/* ── sources: the load-bearing table ── */}
        <Panel
          id="sources"
          folded={Boolean(folded["sources"])}
          onToggle={() => toggle("sources")}
          title="Connected sources"
          caption={
            data
              ? `${rows.length} connectors across the estate, ${wired.length} of them wired into workflows on this deployment and ${used} called at least once · ${data.deployment.runs} runs on record. A connector is a named instance of a backend: the agent holding it knows the verb, never the product, which is why the same workflow moves between clients unchanged. Interface says what the product itself exposes and how an agent reaches it: the platform serves every REST API, database, file store, event stream and webhook to agents as an MCP server, and where a vendor publishes its own MCP server the platform brokers it, with the security layer in between either way. Grants are the capabilities the connector brings with it. Reaches says whether it returns untrusted content, acts outside the system, or both. Credentials live in the vault and never in the workflow.`
              : "reading the registry…"
          }
        >
          {/* how a connector reaches an agent */}
          <div className="grid gap-px border-b border-line bg-line md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
            {[
              { k: "Existing APIs", v: "Served as MCP", n: rows.filter((r) => r.surface === "api" && !r.nativeMcp).length, d: "REST and webhook interfaces wrapped as MCP servers by the platform; the agent sees tools, never endpoints." },
              { k: "Databases and stores", v: "Served as MCP", n: rows.filter((r) => (r.surface === "db" || r.surface === "files" || r.surface === "events") && !r.nativeMcp).length, d: "SQL engines, file stores and event streams exposed as MCP tools with read-only roles and scoped queries." },
              { k: "Vendor MCP servers", v: "Brokered", n: rows.filter((r) => r.nativeMcp).length, d: "Where the vendor publishes an MCP server the platform connects to it directly, still through the security layer." },
              { k: "The security layer", v: "Always in between", n: null, d: "Policy engine (capability, scope, taint, gate), egress allowlist, credentials from the vault at call time, every call journalled." },
            ].map((x) => (
              <div key={x.k} className="flex flex-col gap-0.5 bg-surface px-4 py-2.5">
                <span className="flex items-baseline gap-2">
                  <span className="text-[11.5px] font-semibold text-fg">{x.k}</span>
                  <Tag tone={x.n === null ? "warn" : x.v === "Brokered" ? "run" : "ok"} solid>{x.v}</Tag>
                  {x.n !== null && <span className="tnum text-[10.5px] text-faint">{x.n}</span>}
                </span>
                <span className="text-[10.5px] leading-[1.45] text-faint">{x.d}</span>
              </div>
            ))}
          </div>

          {/* filters */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search connectors"
              className="focusable h-6 w-44 rounded-sm border border-line bg-canvas px-2 text-[11px] text-fg placeholder:text-ghost"
            />
            {(["all", "wired", "available"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setWiring(f)}
                className={`focusable rounded-sm px-1.5 py-0.5 text-[10.5px] transition-colors ${
                  wiring === f ? "bg-raise text-fg" : "text-faint hover:text-fg"
                }`}
              >
                {f === "available" ? "estate" : f === "wired" ? "in workflows" : f}
              </button>
            ))}
            <span className="mx-1 h-3 w-px bg-line" />
            <button
              type="button"
              onClick={() => setGroup("")}
              className={`focusable rounded-sm px-1.5 py-0.5 text-[10.5px] transition-colors ${
                group === "" ? "bg-raise text-fg" : "text-faint hover:text-fg"
              }`}
            >
              every kind
            </button>
            {VENDOR_GROUPS.map((g) => (
              <button
                key={g.name}
                type="button"
                onClick={() => setGroup(group === g.name ? "" : g.name)}
                className={`focusable flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10.5px] transition-colors ${
                  group === g.name ? "bg-raise text-fg" : "text-faint hover:text-fg"
                }`}
              >
                <span className="size-1.5 rounded-[2px]" style={{ background: `var(--t-c${g.c})` }} />
                {g.name}
              </button>
            ))}
          </div>

          <div className="max-h-[560px] overflow-x-auto overflow-y-auto">
            <table className="w-full min-w-[960px] border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-line text-[10.5px] text-faint">
                  <th className="px-4 py-2.5 font-medium">Source</th>
                  <th className="px-4 py-2.5 font-medium">Interface</th>
                  <th className="px-4 py-2.5 font-medium">Grants</th>
                  <th className="px-4 py-2.5 font-medium">Held by</th>
                  <th className="px-4 py-2.5 font-medium">Calls</th>
                  <th className="px-4 py-2.5 font-medium">Last used</th>
                  <th className="px-4 py-2.5 font-medium">Reaches</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.key} className="border-b border-line transition-colors last:border-0 hover:bg-raise">
                    <td className="max-w-[420px] px-4 py-3">
                      <span className="flex items-start gap-3">
                        <BrandMark name={r.brand} size={22} />
                        <span className="flex min-w-0 flex-col">
                          <span className="flex items-center gap-2 text-[13px] font-medium">
                            {r.product}
                            {r.wired && <Tag tone="ok">wired</Tag>}
                            <span className="text-[10px] font-normal text-ghost">{r.kindLabel}</span>
                          </span>
                          <span className="break-words text-[11px] text-faint">{r.contributes}</span>
                          <span className="mt-0.5 max-w-[380px] break-words font-mono text-[10.5px] leading-[1.5] text-ghost">
                            {r.ingest}
                          </span>
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Interface surface={r.surface} nativeMcp={r.nativeMcp} note={r.nativeMcpNote} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="flex flex-col gap-0.5">
                        {r.grants.map((g) => (
                          <span key={g} className="font-mono text-[10.5px] text-dim">
                            {g}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-[11.5px]">
                      {r.heldBy ? (
                        <span className="flex flex-col">
                          <span className="text-dim">{r.heldBy}</span>
                          {r.node && <span className="font-mono text-[10px] text-ghost">{r.node}</span>}
                        </span>
                      ) : r.activity ? (
                        <span className="flex flex-col">
                          <span className="text-dim">{r.activity.owner}</span>
                          <span className="font-mono text-[10px] text-ghost">{r.activity.instance} · every {r.activity.cadence >= 60 ? `${r.activity.cadence / 60} h` : `${r.activity.cadence} min`}</span>
                        </span>
                      ) : (
                        <span className="text-ghost">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {r.wired ? (
                        <span className="tnum font-mono text-[11.5px] text-dim">
                          {r.calls} <span className="font-sans text-faint">calls</span>
                        </span>
                      ) : r.activity ? (
                        <span className="flex flex-col">
                          <span className="tnum font-mono text-[11.5px] text-dim">
                            {compact(r.activity.calls30d)} <span className="font-sans text-faint">calls · 30 d</span>
                          </span>
                          <span className="tnum font-mono text-[10px] text-ghost">{compact(r.activity.records24h)} records · 24 h</span>
                        </span>
                      ) : (
                        <span className="text-ghost">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {r.wired ? (
                        <span className="tnum text-[12px] text-dim">{ago(r.lastUsed)}</span>
                      ) : r.activity ? (
                        <span className="flex flex-col">
                          <span className={`tnum text-[12px] ${r.activity.health === "healthy" ? "text-dim" : r.activity.health === "degraded" ? "text-warn" : "text-err"}`}>{ago(r.activity.lastSync)}</span>
                          <span className="text-[10px] text-ghost">connected {r.activity.ageDays} d</span>
                        </span>
                      ) : (
                        <span className="text-ghost">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="flex gap-1">
                        {r.taints && <Tag tone="warn">taints</Tag>}
                        {r.sink && <Tag tone="err">acts outside</Tag>}
                        {!r.taints && !r.sink && <span className="text-[11px] text-ghost">inside only</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {r.wired ? (
                        <Status tone={r.calls > 0 ? "ok" : "warn"}>{r.calls > 0 ? "In use" : "Never called"}</Status>
                      ) : r.activity ? (
                        <Status tone={r.activity.health === "healthy" ? "ok" : r.activity.health === "degraded" ? "warn" : "err"}>
                          {r.activity.health === "healthy" ? "Connected" : r.activity.health === "degraded" ? "Degraded" : "Reauthorise"}
                        </Status>
                      ) : (
                        <Status tone="neutral" dot={false}>
                          Available
                        </Status>
                      )}
                    </td>
                  </tr>
                ))}
                {data && shown.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-3 text-[11.5px] text-faint">
                      Nothing matches that filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2 border-t border-line px-4 py-2 text-[10.5px] text-ghost">
            <span>
              {shown.length === rows.length
                ? `${rows.length} connectors`
                : `showing ${shown.length} of ${rows.length}`}
            </span>
            <span className="grow" />
            <span>this estate&rsquo;s own connectors are listed last</span>
          </div>
        </Panel>

        {/* ── tools ── */}
        <Panel
          id="tools"
          folded={Boolean(folded["tools"])}
          onToggle={() => toggle("tools")}
          title="Tool registry"
          caption="Every tool granted to a workflow, with the risk it was registered at. Risk is declared here and read as a lookup at call time — never inferred while a run is in flight."
        >
          <div className="max-h-[420px] overflow-x-auto overflow-y-auto">
            <table className="w-full min-w-[820px] border-collapse text-[11.5px]">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-line text-left text-[10.5px] text-faint">
                  <th className="px-4 py-2 font-medium">Tool</th>
                  <th className="px-3 py-2 font-medium">Workflow</th>
                  <th className="px-3 py-2 font-medium">Risk</th>
                  <th className="px-3 py-2 font-medium">Interface</th>
                  <th className="px-3 py-2 font-medium">Properties</th>
                  <th className="px-3 py-2 font-medium">Calls</th>
                  <th className="px-3 py-2 font-medium">Last used</th>
                </tr>
              </thead>
              <tbody>
                {tools
                  .slice()
                  .sort((a, b) => b.calls - a.calls || a.tool.localeCompare(b.tool))
                  .map((t, i) => (
                    <tr key={`${t.agent}-${t.tool}-${i}`} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5 font-mono text-[11px]">{t.tool}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{t.agentName}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <Status tone={RISK_TONE[t.risk] ?? "neutral"}>{t.risk}</Status>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {(() => {
                          const kinds = [...new Set(sources.filter((x) => x.agent === t.agent && x.tool === t.tool).map((x) => SURFACE_LABEL[(VENDORS.find((v) => v.slug === x.name)?.surface ?? KIND_SURFACE[x.kind] ?? "api") as Surface]))];
                          return (
                            <span className="flex items-center gap-1.5">
                              <Tag tone="ok" solid>MCP</Tag>
                              <span className="text-[10.5px] text-faint">{kinds.length ? `over ${kinds.join(", ")}` : "in-process tool"}</span>
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex flex-wrap gap-1">
                          {t.taints && <Tag tone="warn">taints</Tag>}
                          {t.sink && <Tag tone="err">sink</Tag>}
                          {t.scoped && <Tag>scoped</Tag>}
                          {!t.taints && !t.sink && !t.scoped && <span className="text-ghost">—</span>}
                        </span>
                      </td>
                      <td className="tnum px-3 py-2.5">{t.calls || <span className="text-ghost">0</span>}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-faint">{ago(t.lastUsed)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* ── gates ── */}
        <Panel
          id="gates"
          folded={Boolean(folded["gates"])}
          onToggle={() => toggle("gates")}
          title="Where a person signs"
          caption="Per workflow: the risk level at which an action stops and waits for a human, and who may answer. A gate with no approver is refused at parse time, so every line here has a name behind it."
        >
          {(data?.gates ?? []).length === 0 && data && (
            <p className="px-4 py-3 text-[11.5px] text-faint">
              No workflow declares a gate. Every action runs on the agent&rsquo;s own authority.
            </p>
          )}
          {(data?.gates ?? []).map((g, i) => (
            <div key={`${g.agent}-${i}`} className="flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0">
              <span className="min-w-0 grow text-[12px]">{g.agentName}</span>
              <span className="text-[11.5px] text-faint">
                gates <Mono className="text-[11px]">{g.atOrAbove}</Mono> and above
              </span>
              <span className="shrink-0 text-[11px] text-faint">
                {g.approvers.length ? g.approvers.join(", ") : "nobody named"}
              </span>
            </div>
          ))}
        </Panel>

        {/* ── models ── */}
        <Panel
          id="models"
          folded={Boolean(folded["models"])}
          onToggle={() => toggle("models")}
          title="Models"
          caption="What teams may pick from, the tier each sits in, and the price cost figures are computed against. A model with no price makes its runs unpriced rather than free."
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[11.5px]">
              <thead>
                <tr className="border-b border-line text-left text-[10.5px] text-faint">
                  <th className="px-4 py-2 font-medium">Model</th>
                  <th className="px-3 py-2 font-medium">Tier</th>
                  <th className="px-3 py-2 font-medium">In · $/M</th>
                  <th className="px-3 py-2 font-medium">Out · $/M</th>
                  <th className="px-3 py-2 font-medium">Role</th>
                </tr>
              </thead>
              <tbody>
                {(data?.models ?? []).map((m) => {
                  const tiers = Object.entries(data?.classDefaults ?? {})
                    .filter(([, id]) => id === m.id)
                    .map(([t]) => t);
                  return (
                    <tr key={m.id} className="border-b border-line last:border-0">
                      <td className="px-4 py-2.5">
                        <span className="flex flex-col">
                          <span className="text-[12px] text-fg">{m.label}</span>
                          <span className="font-mono text-[10px] text-faint">{m.id}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">{m.class ?? <span className="text-ghost">unassigned</span>}</td>
                      <td className="tnum px-3 py-2.5">{m.price_in ?? <span className="text-ghost">unpriced</span>}</td>
                      <td className="tnum px-3 py-2.5">{m.price_out ?? <span className="text-ghost">unpriced</span>}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="flex flex-wrap gap-1">
                          {m.id === data?.defaultModel && <Tag tone="ok">run default</Tag>}
                          {tiers.map((t) => (
                            <Tag key={t}>{t} tier</Tag>
                          ))}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>

        {/* ── credentials ── */}
        <Panel
          id="credentials"
          folded={Boolean(folded["credentials"])}
          onToggle={() => toggle("credentials")}
          title="Credentials"
          caption="What the vault holds, by name. A connector referencing one of these carries the reference in the spec and never the value, which is what makes a workflow safe to export."
        >
          <div className="flex flex-wrap gap-1.5 px-4 py-3">
            {(data?.vaultKeys ?? []).map((k) => (
              <span key={k} className="rounded-sm border border-line bg-raise px-2 py-1 font-mono text-[11px] text-fg">
                {k}
              </span>
            ))}
            {data && data.vaultKeys.length === 0 && (
              <span className="text-[11.5px] text-faint">The vault is empty.</span>
            )}
          </div>
        </Panel>

        {/* ── ingress ── */}
        <Panel
          id="ingress"
          folded={Boolean(folded["ingress"])}
          onToggle={() => toggle("ingress")}
          title="Ingress"
          caption="Who may post work to this factory, and what is in the queue. A key scoped to one workflow cannot start another."
        >
          <div className="grid gap-px bg-line sm:grid-cols-2">
            <div className="flex flex-col bg-surface">
              <span className="border-b border-line px-4 py-2 text-[10.5px] text-ghost">API keys</span>
              {(data?.apiKeys ?? []).map((k) => (
                <span key={k.prefix} className="flex items-center gap-2 border-b border-line px-4 py-2 last:border-0">
                  <Mono className="text-[10.5px] text-faint">{k.prefix}…</Mono>
                  <span className="min-w-0 grow truncate text-[11.5px]">{k.name}</span>
                  <span className="shrink-0 text-[10.5px] text-faint">{k.agent ?? "any workflow"}</span>
                  {k.revoked_at ? <Status tone="err">revoked</Status> : <Status tone="ok">active</Status>}
                </span>
              ))}
              {data && data.apiKeys.length === 0 && (
                <span className="px-4 py-2 text-[11.5px] text-faint">
                  No keys. The trigger endpoint is open until the first one is minted.
                </span>
              )}
            </div>
            <div className="flex flex-col bg-surface">
              <span className="border-b border-line px-4 py-2 text-[10.5px] text-ghost">Queue</span>
              {Object.entries(data?.queue ?? {}).map(([k, v]) => (
                <span key={k} className="flex items-center justify-between border-b border-line px-4 py-2 last:border-0">
                  <span className="text-[11.5px] text-faint">{k}</span>
                  <span className="tnum text-[12px]">{v}</span>
                </span>
              ))}
              {data && Object.keys(data.queue).length === 0 && (
                <span className="px-4 py-2 text-[11.5px] text-faint">The queue is empty.</span>
              )}
            </div>
          </div>
        </Panel>
        <p className="pb-4 text-[10.5px] text-ghost">{data?.basis ?? ""}</p>
      </div>
    </div>
  );
}

function Panel({
  id,
  title,
  caption,
  children,
  folded = false,
  onToggle,
  meta,
}: {
  id: string;
  title: string;
  caption: string;
  children: React.ReactNode;
  folded?: boolean;
  onToggle?: () => void;
  meta?: React.ReactNode;
}) {
  return (
    <section id={id} className="flex scroll-mt-4 flex-col overflow-hidden rounded-md border border-line bg-surface">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!folded}
        aria-controls={`${id}-body`}
        data-hue={hueFor(title)}
        className={`focusable flex w-full items-start gap-3 bg-raise/55 px-4 py-2.5 text-left transition-colors hover:bg-raise ${folded ? "" : "border-b border-line"}`}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`mt-0.5 shrink-0 text-faint transition-transform ${folded ? "-rotate-90" : ""}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
        <span className="flex min-w-0 grow flex-col gap-0.5">
          <span className="flex items-center gap-2 text-[12px] font-semibold">
            {title}
            {meta}
          </span>
          {!folded && <span className="max-w-[92ch] text-[11px] leading-[1.55] text-faint">{caption}</span>}
        </span>
        <span className="shrink-0 pt-0.5 text-[10.5px] text-ghost">{folded ? "show" : "hide"}</span>
      </button>
      <div id={`${id}-body`} hidden={folded}>
        {children}
      </div>
    </section>
  );
}
