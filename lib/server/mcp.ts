import path from "node:path";
import { readFile } from "node:fs/promises";
import { dbReady, query } from "@/lib/server/db";

/**
 * The MCP registry, as the console's side reads it.
 *
 * The registry is the backend's since phase L6 (backend/CONTRACT.md, "The
 * MCP registry door"): it starts a server once, screens every tool, pins the
 * tool list by digest, holds the server pending until a person approves the
 * pin, and writes both records, the `mcp` setting and the runtime's
 * `workspace/mcp.json`. The console only reads what it wrote, for the A2A
 * tool broker (lib/server/mcp-call.ts), which starts a registered server to
 * make one call. Nothing here hands a server's environment to a browser.
 *
 * Both shapes are read: an entry the registry pinned (`status`, and `pin`
 * with the approved tool list, or the file's `pin: {digest, status}`), and
 * an entry written before L6 (`tools` beside the command, no status). An
 * entry with no status is not approved: the runtime would not attach it
 * either, because registering was never trust.
 *
 * Since L6 an entry's `env` values may be vault references
 * (`${secret:name}`, `${env:NAME}`), which the backend resolves through its
 * secrets port each time it starts the server, and a stdio entry may carry
 * `isolate: {image?, network?}`, which the runtime honours by starting it in
 * a container. The console has neither a vault nor an isolator, so the
 * broker refuses such a server (brokerRefusal below) rather than start
 * something other than what a person approved.
 */

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export type McpStatus = "pending" | "approved" | "refused" | "changed";
const STATUSES: McpStatus[] = ["pending", "approved", "refused", "changed"];

export interface McpServer {
  id: string;
  label: string;
  /** stdio: a process this side starts; http: a server somebody else runs, at `url`. */
  transport: "stdio" | "http";
  command: string;
  args: string[];
  /** As the registry holds it: values, or vault references the backend resolves. Never sent to a browser. */
  env: Record<string, string>;
  url: string;
  /** The container a stdio server is registered to run in (runtime L6b); null when it runs as a plain process. */
  isolate: Record<string, unknown> | null;
  /** The pinned tool list, or the list a pre-L6 entry carried. */
  tools: McpTool[];
  status: McpStatus;
  /** The pin's digest; "" when the entry has none. */
  digest: string;
}

const ROOT = path.resolve(process.cwd(), "..", "runtime");
export const MCP_FILE = path.join(ROOT, "workspace", "mcp.json");

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function toolOf(v: unknown): McpTool | null {
  const t = obj(v);
  if (typeof t.name !== "string" || !t.name) return null;
  return {
    name: t.name,
    description: typeof t.description === "string" ? t.description : "",
    inputSchema: Object.keys(obj(t.inputSchema)).length ? obj(t.inputSchema) : { type: "object" },
    ...(Object.keys(obj(t.annotations)).length ? { annotations: obj(t.annotations) } : {}),
  };
}

/** One registry entry in either shape, as the broker needs it. */
export function serverOf(v: unknown): McpServer | null {
  const s = obj(v);
  if (typeof s.id !== "string" || !s.id) return null;
  const pin = obj(s.pin);
  const tools = Array.isArray(pin.tools) ? pin.tools : Array.isArray(s.tools) ? s.tools : [];
  const status = STATUSES.find((x) => x === s.status) ?? STATUSES.find((x) => x === pin.status) ?? "pending";
  const env: Record<string, string> = {};
  for (const [k, val] of Object.entries(obj(s.env))) if (typeof val === "string") env[k] = val;
  const command = typeof s.command === "string" ? s.command : "";
  const url = typeof s.url === "string" ? s.url : "";
  return {
    id: s.id,
    label: typeof s.label === "string" && s.label ? s.label : s.id,
    // The runtime's own reading: a registration with a url is called, not started.
    transport: s.transport === "http" || (url && !command) ? "http" : "stdio",
    command,
    args: Array.isArray(s.args) ? s.args.map(String) : [],
    env,
    url,
    isolate: s.isolate && typeof s.isolate === "object" && !Array.isArray(s.isolate) ? (s.isolate as Record<string, unknown>) : null,
    tools: tools.map(toolOf).filter((t): t is McpTool => t !== null),
    status,
    digest: typeof pin.digest === "string" ? pin.digest : "",
  };
}

/** The raw entries: the `mcp` setting when the registry saved one, else the runtime's file. */
async function rawServers(): Promise<unknown[]> {
  if (await dbReady()) {
    const rows = await query<{ value: { servers?: unknown[] } }>("SELECT value FROM settings WHERE key = 'mcp'");
    if (rows.length) return Array.isArray(rows[0].value?.servers) ? rows[0].value.servers : [];
  }
  try {
    const file = JSON.parse(await readFile(MCP_FILE, "utf-8"));
    return Array.isArray(file.servers) ? file.servers : [];
  } catch {
    return [];
  }
}

export async function loadServers(): Promise<McpServer[]> {
  return (await rawServers()).map(serverOf).filter((s): s is McpServer => s !== null);
}

/**
 * Whether a server may be reached at all: only an approved pin attaches, as
 * the runtime holds it (`control: supply_chain`). The broker refuses the
 * rest by that control, so an agent granted a tool on a server whose list
 * changed is told why, not that the tool vanished.
 */
export function attachable(server: McpServer): boolean {
  return server.status === "approved";
}

/** A reference the runtime's vault resolves when it starts a server: `${secret:name}`, `${env:NAME}` or `${env:NAME|default}`. */
const REFERENCE = /\$\{(?:secret|env):[^}]*\}/;

/**
 * Why the console's broker will not start this server, or "" when it can.
 *
 * The backend starts a registered server as a run meets it: its `${secret:…}`
 * and `${env:…}` references resolved through the secrets port, in a
 * container when the registration asks for `isolate`. The broker has
 * neither a vault nor an isolator, and a server started without them is not
 * the one a person approved: it would run with the literal reference as its
 * credential, or uncontained. So it is refused, by the supply-chain control,
 * naming the reason and the variables (never a value). An HTTP registration
 * is a server somebody else runs, and the broker only starts processes.
 */
export function brokerRefusal(server: McpServer): string {
  if (server.transport === "http") return `${server.label} is an HTTP server, and the console's tool broker only starts stdio servers`;
  if (server.isolate) return `${server.label} is registered to run in a container (isolate), and the console's tool broker has no isolator; it will not start it uncontained`;
  const refs = Object.entries(server.env)
    .filter(([, v]) => REFERENCE.test(v))
    .map(([k]) => k);
  if (refs.length) return `${server.label}'s environment holds vault references the console cannot resolve (${refs.join(", ")}); the console's tool broker has no vault and will not start it with the literal reference`;
  if (!server.command) return `${server.label} names no command to start`;
  return "";
}
