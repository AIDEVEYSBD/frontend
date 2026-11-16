"use client";

import { useEffect, useMemo, useState } from "react";
import { Mono, Status, Tag } from "./ui";
import { usePageFacts } from "./assistant";
import { MCP_ENDPOINT } from "@/lib/site";
import { hueFor } from "@/lib/hue";
import { CONNECTOR_DEFS } from "@/lib/connections";
import { AttachedAgents } from "./attached-agents";
import { ToolServers } from "./tool-servers";
import { useMcp } from "@/lib/use-mcp";
import { STATUS_META } from "@/lib/mcp-registry";
import { Pick } from "./select";
import { soon } from "@/lib/soon";
import type { AttachedAgent } from "@/lib/attached";
import { JOB_STATUS_META, queueTotals } from "@/lib/queue";

/**
 * Configuration: everything this deployment is set up with, in one place.
 *
 * The page answers "what is wired, what does it reach, and who signs". It
 * shows only what exists on this deployment: the connections the saved
 * workflows configure (read from their documents by /api/configuration,
 * with usage counted from the run journals), the registered tool servers,
 * the attached agents, the models offered, the vault's names and the
 * ingress keys. Nothing here comes from a catalogue: a deployment with no
 * workflow shows no connection, and a read that fails shows an error and
 * no rows.
 *
 * A figure appears only when it was measured. A connection that is
 * configured and never called says "never called"; there is no health or
 * last-sync figure, because nothing measures one.
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
  { id: "egress", label: "Egress allowlist" },
  { id: "agents", label: "Third-party agents" },
  { id: "mcp", label: "MCP server" },
  { id: "registry", label: "Tool servers" },
  { id: "sources", label: "Connected sources" },
  { id: "tools", label: "Tool registry" },
  { id: "gates", label: "Where a person signs" },
  { id: "models", label: "Models" },
  { id: "credentials", label: "Credentials" },
  { id: "ingress", label: "Ingress" },
];

/**
 * Whether a source is offline or live, from its kind (7.4): a file or a
 * folder handed over is offline; a connection read when the run asks is
 * live. A kind this table does not know is read from what it configures
 * (a path or a root against a URL or a DSN), and is not stated otherwise.
 */
const OFFLINE_KINDS = new Set(["file", "folder", "documents", "images"]);
const LIVE_KINDS = new Set(["vector", "tavily", "tool", "postgres", "rest", "sql", "db", "http", "git", "a2a", "slack", "smtp", "webhook", "events"]);
function modeOf(s: { kind: string; settings: string[] }): "offline" | "live" | null {
  if (OFFLINE_KINDS.has(s.kind)) return "offline";
  if (LIVE_KINDS.has(s.kind)) return "live";
  if (s.settings.some((k) => ["url", "dsn", "endpoint", "api_key"].includes(k))) return "live";
  if (s.settings.some((k) => ["path", "root"].includes(k))) return "offline";
  return null;
}
const MODE_MEANS = { offline: "A file or folder handed over: read from disk, not from a system.", live: "A connection read when the run asks." };

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
  const [mcp, setMcp] = useState<{ endpoint: string; transport: string; auth: string; tools: { name: string; description: string; action: boolean }[]; client: Record<string, unknown> } | null>(null);
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const [attached, setAttached] = useState<AttachedAgent[]>([]);
  // The MCP registry is the backend's (phase L6); read once for the panel and the page facts.
  const registry = useMcp();

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
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (stop) return;
        // A refusal or a fault answers without the record: say so, and show no rows.
        if (!r.ok || !d || !Array.isArray(d.sources)) setFailed(true);
        else setData(d);
      })
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

  /* The connections the saved workflows configure, as the record lists them:
     a named instance of a backend on a tool binding, with the calls the run
     journals hold for that tool. Nothing is added to this list. */
  const rows = useMemo(
    () =>
      sources.map((s) => {
        const def = CONNECTOR_DEFS.find((c) => c.server === s.server && c.kind === s.kind);
        return {
          key: `${s.agent}:${s.server}:${s.slot}:${s.name}`,
          name: s.name,
          kindLabel: def?.label ?? s.kind,
          what: def?.blurb ?? "",
          wiring: `${s.server}.${s.slot} · ${s.kind}${s.usesVault ? " · vault credential" : ""}`,
          mode: modeOf(s),
          tool: s.tool,
          risk: s.risk,
          heldBy: s.agentName,
          agent: s.agent,
          node: s.node,
          calls: s.calls,
          lastUsed: s.lastUsed,
          taints: s.taints,
          sink: s.sink,
        };
      }),
    [sources],
  );

  // What the in-console assistant is told about this page: the record as read, and nothing derived from a catalogue.
  usePageFacts(
    data
      ? {
          deployment: data.deployment,
          egressAllowlist: data.deployment.egress,
          connections: { total: rows.length, calledAtLeastOnce: used, offline: rows.filter((r) => r.mode === "offline").length, live: rows.filter((r) => r.mode === "live").length },
          connectionList: rows.map((r) => ({ name: r.name, kind: r.kindLabel, mode: r.mode ?? "not stated", heldBy: r.heldBy, calls: r.calls })),
          tools: data.tools.length,
          gates: data.gates,
          models: data.models.map((m) => m.id),
          defaultModel: data.defaultModel,
          agentFactoryMcp: { endpoint: MCP_ENDPOINT, tools: mcp ? mcp.tools.map((t) => t.name) : "described at the endpoint" },
          toolServers: registry.servers
            ? {
                twoPersonApproval: registry.twoPerson,
                servers: registry.servers.map((s) => ({ id: s.id, label: s.label, status: STATUS_META[s.status].label, tools: s.pin?.tools.length ?? 0, pin: s.pin?.digest ?? null, lastScan: s.last_scan?.at ?? null, hits: s.last_scan?.hits.length ?? 0 })),
              }
            : "reading the registry",
          // As the attached-agents door answers: the figures are the backend's, measured from the run record.
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
    return rows.filter((r) => !term || r.name.toLowerCase().includes(term) || r.kindLabel.toLowerCase().includes(term) || r.heldBy.toLowerCase().includes(term) || r.tool.toLowerCase().includes(term));
  }, [rows, q]);

  return (
    <div className="min-h-full">
      {/* The same frame as the control pane: full width to the same cap, the same gutter, so the two pages line up at every size. */}
      <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-5 px-5 py-7">
        <header className="flex flex-col gap-1.5">
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Configuration</h1>
          <p className="max-w-[80ch] text-[12.5px] leading-[1.6] text-faint">
            The systems, tools and services this deployment&rsquo;s workflows are set up with: what each
            reaches, at what risk, and whether it has been called. Everything here is read from the saved
            workflows, the run records and the registries; credential values are never displayed.
          </p>
        </header>

        {/* ── the strip ── */}
        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Workflows", value: data ? String(data.deployment.workflows) : "—", sub: data ? `${data.deployment.deployed} deployed` : "" },
            { label: "Connections", value: data ? String(rows.length) : "—", sub: data ? `${used} called at least once` : "" },
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
          <p className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err">
            The configuration could not be read, so the deployment, connections, tools, gates, models, credentials and ingress below show nothing.
          </p>
        )}

        {/* ── deployment ── */}
        <Panel id="deployment" folded={Boolean(folded["deployment"])} onToggle={() => toggle("deployment")} title="Deployment" caption="Where this deployment keeps its records and what it sends model calls to.">
          <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
            {[
              { k: "Registry", v: !data ? "—" : data.deployment.registry === "postgres" ? "Postgres" : "Workspace files" },
              { k: "Model gateway", v: !data ? "—" : data.deployment.gateway === "not configured" ? "Not configured" : data.deployment.gateway },
              { k: "Gateway resource", v: !data ? "—" : data.deployment.endpoint?.replace(/^https:\/\//, "") || "None set", mono: Boolean(data?.deployment.endpoint) },
              { k: "Billing feed", v: !data ? "—" : data.deployment.billing ? "Connected" : "Not connected" },
            ].map((f) => (
              <div key={f.k} className="flex flex-col gap-0.5 bg-surface px-4 py-2.5">
                <span className="text-[10.5px] text-ghost">{f.k}</span>
                <span className={`truncate text-[12px] text-fg ${f.mono ? "font-mono text-[11px]" : ""}`}>{f.v}</span>
              </div>
            ))}
          </div>
        </Panel>

        {/* ── egress: the hosts outbound requests may reach (9.6) ── */}
        <Panel
          id="egress"
          folded={Boolean(folded["egress"])}
          onToggle={() => toggle("egress")}
          title="Egress allowlist"
          caption="The hosts an outbound request from a run may reach: a web fetch, a webhook output, a notify transport that calls a URL, an A2A peer, a tool server spoken to over HTTP. A listed host also covers its subdomains. A request to any other host is refused and the refusal is recorded against the egress control, naming the host."
          meta={data ? <span className="tnum text-[10.5px] font-normal text-faint">{data.deployment.egress.length === 1 ? "1 host" : `${data.deployment.egress.length} hosts`}</span> : undefined}
        >
          <div className="flex flex-col gap-2 px-4 py-3">
            {!data && !failed && <span className="text-[11.5px] text-faint">Reading the deployment&hellip;</span>}
            {failed && <span className="text-[11.5px] text-faint">The allowlist could not be read.</span>}
            {data && data.deployment.egress.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {data.deployment.egress.map((h) => (
                  <span key={h} className="rounded-sm border border-line bg-raise px-2 py-1 font-mono text-[11px] text-fg">
                    {h}
                  </span>
                ))}
              </div>
            )}
            {data && data.deployment.egress.length === 0 && (
              <span className="text-[12px] text-dim">No host is listed for this deployment.</span>
            )}
            {data && (
              <span className="max-w-[92ch] text-[11px] leading-[1.55] text-faint">
                Beside this list, a request reaches only the host registered for its own path: an approved tool server&rsquo;s URL, a configured peer&rsquo;s, a configured notify
                transport&rsquo;s. {data.deployment.egress.length === 0 ? "With no host listed, a web fetch or a webhook output reaches nothing. " : ""}The list is the deployment&rsquo;s own setting
                and is not edited here.
              </span>
            )}
          </div>
        </Panel>

        {/* ── third-party agents: attached over the SDK or A2A ── */}
        <Panel
          id="agents"
          folded={Boolean(folded["agents"])}
          onToggle={() => toggle("agents")}
          title="Third-party agents"
          caption="Agents built elsewhere (a client's own, a vendor's, another team's), attached to this control plane so they run under the same journal, cost accounting and guardrails as the deployment's own. Two ways in: the Agent Factory SDK for an agent whose code you own, and A2A for one whose code cannot change, where the factory stands between the agent and everything it reaches."
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
                Reading tools accept any active key. Starting a workflow needs a key scoped to that workflow, exactly as the trigger endpoint does, because the same key is forwarded to it. Until the first key is minted the server refuses every call, like ingress.
              </span>
            </div>
          </div>
        </Panel>

        {/* ── the MCP registry: tool servers, admitted, pinned and approved ── */}
        <Panel
          id="registry"
          folded={Boolean(folded["registry"])}
          onToggle={() => toggle("registry")}
          title="Tool servers"
          caption="The MCP servers that carry a team's own tools to its agents. Registering is admission, not trust: the server is started once, every tool's name, description and schema is screened, and the tool list is pinned by its digest. Nothing attaches to a run until a person approves the pin, and a rescan that finds a different list marks the server changed and detaches it until someone approves again. Environment and header values stay with the registry; only their names are shown."
          meta={
            registry.servers && registry.servers.some((x) => STATUS_META[x.status].alarming) ? (
              <Tag tone="err" solid>
                {registry.servers.filter((x) => STATUS_META[x.status].alarming).length} need attention
              </Tag>
            ) : (
              <Tag tone="ok" solid>MCP</Tag>
            )
          }
        >
          <ToolServers servers={registry.servers} twoPerson={registry.twoPerson} error={registry.error} refresh={registry.refresh} />
        </Panel>

        {/* ── sources: the load-bearing table ── */}
        <Panel
          id="sources"
          folded={Boolean(folded["sources"])}
          onToggle={() => toggle("sources")}
          title="Connected sources"
          caption={
            data
              ? `${rows.length === 1 ? "1 connection" : `${rows.length} connections`} configured in the workflows saved on this deployment, ${used} called at least once · ${data.deployment.runs} runs on record. A connection is a named instance of a backend on a tool: the agent holding it knows the verb, never the product. Mode says whether it is offline (a file or folder handed over) or live (read from a system when the run asks). Reaches says whether it returns untrusted content, acts outside the system, or both. Calls and last used are counted from the run journals; there is no health figure, because nothing measures one. Credentials are named in the vault and never held in the workflow.`
              : failed
                ? "not read"
                : "reading the workflows…"
          }
        >
          {data && rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by name, kind, tool or workflow"
                aria-label="Search connections"
                className="focusable h-7 w-64 max-w-full rounded-sm border border-line bg-canvas px-2 text-[11.5px] text-fg placeholder:text-ghost"
              />
              <span className="grow" />
              <span className="tnum text-[10.5px] text-faint">{shown.length === rows.length ? `${rows.length} listed` : `showing ${shown.length} of ${rows.length}`}</span>
            </div>
          )}

          {!data && !failed && <p className="px-4 py-3 text-[11.5px] text-faint">Reading the workflows&hellip;</p>}
          {failed && <p className="px-4 py-3 text-[11.5px] text-faint">The connections could not be read.</p>}
          {data && rows.length === 0 && (
            <p className="px-4 py-6 text-[12px] leading-[1.55] text-dim">
              No workflow on this deployment configures a connection yet. A connection appears here once a saved workflow names one.
            </p>
          )}

          {data && rows.length > 0 && (
            <div className="max-h-[560px] overflow-x-auto overflow-y-auto">
              <table className="w-full min-w-[980px] border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-surface">
                  <tr className="border-b border-line text-[10.5px] text-faint">
                    <th className="px-4 py-2.5 font-medium">Source</th>
                    <th className="px-3 py-2.5 font-medium">Mode</th>
                    <th className="px-3 py-2.5 font-medium">Tool</th>
                    <th className="px-3 py-2.5 font-medium">Held by</th>
                    <th className="px-3 py-2.5 text-right font-medium">Calls</th>
                    <th className="px-3 py-2.5 font-medium">Last used</th>
                    <th className="px-3 py-2.5 font-medium">Reaches</th>
                    <th className="px-3 py-2.5 font-medium">Use</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.key} className="border-b border-line align-top transition-colors last:border-0 hover:bg-raise/50">
                      <td className="max-w-[420px] px-4 py-2.5">
                        <span className="flex min-w-0 flex-col">
                          <span className="flex flex-wrap items-baseline gap-2">
                            <span className="font-mono text-[12px] font-medium text-fg">{r.name}</span>
                            <span className="text-[11px] text-dim">{r.kindLabel}</span>
                          </span>
                          {r.what && <span className="break-words text-[11px] text-faint">{r.what}</span>}
                          <span className="mt-0.5 break-words font-mono text-[10.5px] leading-[1.5] text-ghost">{r.wiring}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {r.mode ? (
                          <span title={MODE_MEANS[r.mode]}>
                            <Tag tone={r.mode === "live" ? "run" : "neutral"}>{r.mode === "live" ? "Live" : "Offline"}</Tag>
                          </span>
                        ) : (
                          <span className="text-[11px] text-ghost" title="The kind of this source does not say whether it is a file handed over or a connection.">
                            not stated
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="flex flex-col gap-0.5">
                          <span className="font-mono text-[11px] text-dim">{r.tool}</span>
                          <Status tone={RISK_TONE[r.risk] ?? "neutral"}>{r.risk}</Status>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-[11.5px]">
                        <span className="flex flex-col">
                          <span className="text-dim">{r.heldBy}</span>
                          <span className="font-mono text-[10px] text-ghost">{r.node ? `${r.agent} · ${r.node}` : r.agent}</span>
                        </span>
                      </td>
                      <td className="tnum px-3 py-2.5 text-right font-mono text-[11.5px] text-dim">{r.calls.toLocaleString("en-GB")}</td>
                      <td className="tnum px-3 py-2.5 whitespace-nowrap text-[11.5px] text-dim">{ago(r.lastUsed)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <span className="flex gap-1">
                          {r.taints && <Tag tone="warn">untrusted content</Tag>}
                          {r.sink && <Tag tone="err">acts outside</Tag>}
                          {!r.taints && !r.sink && <span className="text-[11px] text-ghost">inside only</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <Status tone={r.calls > 0 ? "ok" : "neutral"}>{r.calls > 0 ? "Called" : "Never called"}</Status>
                      </td>
                    </tr>
                  ))}
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-3 text-[11.5px] text-faint">
                        Nothing matches that search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {/* ── tools ── */}
        <Panel
          id="tools"
          folded={Boolean(folded["tools"])}
          onToggle={() => toggle("tools")}
          title="Tool registry"
          caption="Every tool granted to a workflow, with the risk it was registered at. Risk is declared on the tool and read as a lookup at call time, never inferred while a run is in flight."
        >
          <div className="max-h-[420px] overflow-x-auto overflow-y-auto">
            <table className="w-full min-w-[820px] border-collapse text-[11.5px]">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-line text-left text-[10.5px] text-faint">
                  <th className="px-4 py-2 font-medium">Tool</th>
                  <th className="px-3 py-2 font-medium">Workflow</th>
                  <th className="px-3 py-2 font-medium">Risk</th>
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
                {data && tools.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-3 text-faint">
                      No workflow on this deployment holds a tool yet.
                    </td>
                  </tr>
                )}
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
              {data && data.models.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-3 text-faint">
                      No model is offered on this deployment yet. Models are offered on Settings.
                    </td>
                  </tr>
                )}
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
                  No keys. Every machine door (trigger, SDK, A2A, MCP server) refuses until the first one is minted.
                </span>
              )}
            </div>
            <div className="flex flex-col bg-surface">
              <span className="border-b border-line px-4 py-2 text-[10.5px] text-ghost">Queue</span>
              {queueTotals({ all: data?.queue ?? {} }, Object.keys(data?.queue ?? {}).length > 0).map((q) => (
                <span key={q.status} className="flex items-center justify-between border-b border-line px-4 py-2 last:border-0" title={JOB_STATUS_META[q.status as keyof typeof JOB_STATUS_META]?.means}>
                  <span className="text-[11.5px] text-faint">{q.label}</span>
                  <span className="tnum text-[12px]">{q.count}</span>
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
