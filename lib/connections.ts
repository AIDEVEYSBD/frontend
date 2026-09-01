/**
 * Connections: every tool's pluggable backends, described once.
 *
 * This is the retrieval pattern made uniform. Each tool card that connects to
 * the outside declares a config *slot* on its binding (`sources`, `backends`,
 * `transports`, `engines`, `roots`), and each connector kind describes the
 * fields a person configures. The builder renders all of them from this table
 * — adding a connector kind is a row here plus its runtime class, never new UI.
 */

import { TOOL_BY_ID } from "./catalogue";
import type { AgentSystem } from "./spec";
import { newSource, SOURCE_META, type RetrievalSource } from "./retrieval";

export interface FieldDef {
  key: string;
  label: string;
  hint?: string;
  mono?: boolean;
  kind?: "text" | "number" | "bool" | "csv";
  placeholder?: string;
  /** The runtime refuses the connection without this at deploy time. */
  required?: boolean;
}

export interface ConnectorDef {
  /** Tool card this connector configures. */
  tool: string;
  /** Server whose binding carries the config. */
  server: string;
  /** Config key holding the list. */
  slot: string;
  kind: string;
  label: string;
  blurb: string;
  icon: string;
  hex: string;
  fields: FieldDef[];
  defaults: Record<string, unknown>;
}

const DSN_HINT = "Vault references welcome: postgres://user:${secret:db-pass}@host:5455/db";

export const CONNECTOR_DEFS: ConnectorDef[] = [
  /* ── retrieval: the original six, unchanged in behaviour ── */
  ...(["folder", "documents", "vector", "tavily", "images", "tool"] as const).map((kind) => ({
    tool: "retrieval",
    server: "retrieval",
    slot: "sources",
    kind,
    label: SOURCE_META[kind].label,
    blurb: SOURCE_META[kind].blurb.split(".")[0],
    icon: { folder: "folder", documents: "file", vector: "vector", tavily: "globe", images: "image", tool: "plug" }[kind],
    hex: { folder: "#5C7CFA", documents: "#0B7285", vector: "#7048E8", tavily: "#2F6BFF", images: "#E8590C", tool: "#087F5B" }[kind],
    fields: (
      {
        folder: [{ key: "root", label: "Root", mono: true, hint: "Relative paths resolve in the workspace." }],
        documents: [{ key: "root", label: "Root", mono: true }],
        images: [{ key: "root", label: "Root", mono: true }],
        vector: [
          { key: "url", label: "Search endpoint", mono: true, required: true },
          { key: "collection", label: "Collection", mono: true },
          { key: "api_key", label: "API key", mono: true, placeholder: "${secret:vector-db}" },
          { key: "embed_url", label: "Embedding endpoint", mono: true, hint: "Blank when the index embeds server-side." },
        ],
        tavily: [
          { key: "api_key", label: "API key", mono: true, placeholder: "${secret:tavily}" },
          { key: "depth", label: "Depth", mono: true, hint: "basic or advanced" },
          { key: "include_domains", label: "Only these domains", kind: "csv" as const, mono: true },
        ],
        tool: [
          { key: "url", label: "Endpoint", mono: true, required: true },
          { key: "query_field", label: "Query field", mono: true },
          { key: "results_path", label: "Results path", mono: true },
        ],
      } as Record<string, FieldDef[]>
    )[kind],
    defaults: newSource(kind, new Set()) as unknown as Record<string, unknown>,
  })),

  /* ── records: registers ── */
  {
    tool: "records", server: "records", slot: "backends", kind: "postgres",
    label: "Postgres", blurb: "A register table or view", icon: "database", hex: "#336791",
    fields: [
      { key: "dsn", label: "Connection", mono: true, hint: DSN_HINT, required: true },
      { key: "table", label: "Table", mono: true, required: true },
      { key: "columns", label: "Column map", mono: true, hint: 'JSON: {"id": "id", "type": "kind", "name": "title"}' },
      { key: "writable", label: "Writable", kind: "bool", hint: "A register an agent can write is a decision." },
    ],
    defaults: { kind: "postgres", name: "register-db", dsn: "postgresql://user:${secret:records-db}@host:5432/db", table: "", columns: { id: "id", type: "type" } },
  },
  {
    tool: "records", server: "records", slot: "backends", kind: "rest",
    label: "REST register", blurb: "Any HTTP system of record", icon: "plug", hex: "#087F5B",
    fields: [
      { key: "url", label: "Query URL", mono: true, required: true },
      { key: "rows_path", label: "Rows path", mono: true, hint: "Dotted path to the row list." },
      { key: "write_url", label: "Write URL", mono: true, hint: "Blank keeps it read-only." },
    ],
    defaults: { kind: "rest", name: "grc-api", url: "", rows_path: "" },
  },

  /* ── events: telemetry ── */
  {
    tool: "events", server: "events", slot: "sources", kind: "postgres",
    label: "Postgres events", blurb: "An events table, time-windowed", icon: "database", hex: "#336791",
    fields: [
      { key: "dsn", label: "Connection", mono: true, hint: DSN_HINT, required: true },
      { key: "table", label: "Table", mono: true, required: true },
      { key: "time_column", label: "Time column", mono: true },
    ],
    defaults: { kind: "postgres", name: "audit-db", dsn: "postgresql://user:${secret:events-db}@host:5432/db", table: "", time_column: "at" },
  },
  {
    tool: "events", server: "events", slot: "sources", kind: "rest",
    label: "Log API", blurb: "SIEM or log platform over HTTP", icon: "pulse", hex: "#E8590C",
    fields: [
      { key: "url", label: "Query URL", mono: true, required: true },
      { key: "rows_path", label: "Rows path", mono: true },
    ],
    defaults: { kind: "rest", name: "siem", url: "", rows_path: "events" },
  },

  /* ── notify: transports ── */
  {
    tool: "notify", server: "notify", slot: "transports", kind: "slack",
    label: "Slack", blurb: "Incoming webhook", icon: "bell", hex: "#4A154B",
    fields: [
      { key: "webhook", label: "Webhook", mono: true, placeholder: "${secret:slack-webhook}", hint: "The URL is the credential — keep it in the vault." },
      { key: "matches", label: "Delivers to", kind: "csv", mono: true, hint: "Recipients this transport claims, e.g. #sec-*" },
    ],
    defaults: { kind: "slack", name: "slack", webhook: "${secret:slack-webhook}", matches: ["#*"] },
  },
  {
    tool: "notify", server: "notify", slot: "transports", kind: "smtp",
    label: "Mail", blurb: "Through your relay", icon: "bell", hex: "#0B7285",
    fields: [
      { key: "host", label: "Relay host", mono: true, required: true },
      { key: "port", label: "Port", kind: "number" },
      { key: "sender", label: "From", mono: true },
      { key: "matches", label: "Delivers to", kind: "csv", mono: true, hint: "e.g. *@your-org.example" },
    ],
    defaults: { kind: "smtp", name: "mail", host: "", port: 587, sender: "agent-factory@your-org.example", matches: ["*@your-org.example"] },
  },
  {
    tool: "notify", server: "notify", slot: "transports", kind: "webhook",
    label: "Webhook", blurb: "Pagers, Teams, ticket hooks", icon: "webhook", hex: "#087F5B",
    fields: [
      { key: "url", label: "URL", mono: true, required: true },
      { key: "matches", label: "Delivers to", kind: "csv", mono: true },
    ],
    defaults: { kind: "webhook", name: "hook", url: "", matches: ["*"] },
  },

  /* ── peers: someone else's agent, spoken to over A2A ── */
  {
    tool: "peer", server: "peers", slot: "peers", kind: "a2a",
    label: "A2A agent", blurb: "Any agent speaking Agent2Agent", icon: "bot", hex: "#B54708",
    fields: [
      { key: "name", label: "Name", mono: true, hint: "How workflows address this peer.", required: true },
      { key: "url", label: "URL", mono: true, placeholder: "https://agent.vendor.example", required: true,
        hint: "The A2A endpoint. Its card is read from /.well-known/agent.json." },
      { key: "timeout_s", label: "Timeout (s)", kind: "number" },
    ],
    defaults: { kind: "a2a", name: "peer", url: "", timeout_s: 60 },
  },

  /* ── compute: a team's own engine ── */
  {
    tool: "compute", server: "engines", slot: "engines", kind: "http",
    label: "Custom engine", blurb: "Your deterministic service, one URL", icon: "chip", hex: "#7048E8",
    fields: [
      { key: "name", label: "Engine name", mono: true, hint: "How agents call it: engine.run(engine: name)" },
      { key: "url", label: "URL", mono: true, required: true },
    ],
    defaults: { name: "my-engine", url: "" },
  },

  /* ── code: repositories ── */
  {
    tool: "code", server: "code", slot: "roots", kind: "git",
    label: "Git repository", blurb: "Cloned shallow on first read", icon: "code", hex: "#F05033",
    fields: [
      { key: "name", label: "Root name", mono: true, hint: "Paths address it as name:path/in/repo" },
      { key: "url", label: "Repository URL", mono: true, required: true },
    ],
    defaults: { kind: "git", name: "repo", url: "" },
  },
];

export const CONNECTOR_DEF = new Map(CONNECTOR_DEFS.map((c) => [`${c.tool}:${c.kind}`, c]));

/** Every configured connection across every binding, in one stable order. */
export interface Connection {
  def: ConnectorDef;
  entry: Record<string, unknown>;
  /** Index within its own slot list — what patch/remove address. */
  index: number;
  attached_to?: string;
}

export function listConnections(system: AgentSystem): Connection[] {
  const out: Connection[] = [];
  const slots = new Map<string, ConnectorDef[]>();
  for (const d of CONNECTOR_DEFS) {
    const key = `${d.server}:${d.slot}`;
    slots.set(key, [...(slots.get(key) ?? []), d]);
  }
  const seenBinding = new Set<string>();
  for (const t of system.tools) {
    for (const [key, defs] of slots) {
      const [server, slot] = key.split(":");
      if (t.server !== server || seenBinding.has(key)) continue;
      const list = (t.config?.[slot] as Record<string, unknown>[] | undefined) ?? [];
      if (!Array.isArray(list)) continue;
      seenBinding.add(key);
      list.forEach((entry, index) => {
        const kind = String(entry.kind ?? defs[0]?.kind ?? "");
        const def = defs.find((d) => d.kind === kind) ?? defs[0];
        if (!def) return;
        out.push({
          def,
          entry,
          index,
          attached_to: typeof entry.attached_to === "string" ? entry.attached_to : undefined,
        });
      });
    }
  }
  return out;
}

/** The binding a slot's config lives on — first tool of that server. */
export function bindingFor(system: AgentSystem, server: string): string | undefined {
  return system.tools.find((t) => t.server === server)?.name;
}

export function toolCardForConnector(def: ConnectorDef) {
  return TOOL_BY_ID.get(def.tool);
}
