import { spawn } from "node:child_process";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dbReady, query } from "@/lib/server/db";

/**
 * Custom tools over MCP.
 *
 * A team builds whatever tool it needs, runs it as an MCP server, and connects
 * it here. The frontend's only job is discovery: start the server once, ask it
 * what tools it has, remember the answer. The runtime attaches the same server
 * at run time (runtime/agentfactory/tools.py, MCPHost) from the file this
 * module writes, so "connect a tool" is a config change on both sides and
 * never a release of either.
 */

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface McpServer {
  id: string;
  label: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  tools: McpTool[];
  discovered_at: string;
}

const ROOT = path.resolve(process.cwd(), "..", "runtime");
export const MCP_FILE = path.join(ROOT, "workspace", "mcp.json");

export async function loadServers(): Promise<McpServer[]> {
  if (await dbReady()) {
    const rows = await query<{ value: { servers?: McpServer[] } }>("SELECT value FROM settings WHERE key = 'mcp'");
    if (rows.length) return rows[0].value.servers ?? [];
  }
  try {
    const raw = JSON.parse(await readFile(MCP_FILE, "utf-8"));
    return Array.isArray(raw.servers) ? raw.servers : [];
  } catch {
    return [];
  }
}

export async function saveServers(servers: McpServer[]): Promise<void> {
  const value = { servers };
  if (await dbReady()) {
    await query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('mcp', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [value],
    );
  }
  // The runtime reads this file; the DB is authoritative for the UI.
  await mkdir(path.dirname(MCP_FILE), { recursive: true });
  await writeFile(MCP_FILE, JSON.stringify(value, null, 2) + "\n");
}

/** Split a command line the way a shell would for the simple cases. */
export function shellWords(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Parse KEY=VALUE lines into an env map. */
export function envLines(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return env;
}

/**
 * Start the server, complete the MCP handshake, list its tools, stop it.
 * Mirrors the runtime's MCPHost so what the builder shows is what a run gets.
 */
export function discover(
  command: string,
  args: string[],
  env: Record<string, string>,
  timeoutMs = 20000,
): Promise<McpTool[]> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      reject(new Error(`could not start ${command}: ${(e as Error).message}`));
      return;
    }
    let settled = false;
    let stderr = "";
    let buf = "";
    let nextId = 0;
    const pending = new Map<number, (r: { result?: unknown; error?: { message?: string } }) => void>();

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        /* already gone */
      }
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error(`the server did not answer within ${timeoutMs / 1000}s${stderr ? ` — ${stderr.trim().split("\n").slice(-2).join(" ")}` : ""}`))),
      timeoutMs,
    );

    const send = (method: string, params: unknown, withId: boolean) =>
      new Promise<unknown>((res, rej) => {
        const msg: Record<string, unknown> = { jsonrpc: "2.0", method, params };
        if (withId) {
          const id = ++nextId;
          msg.id = id;
          pending.set(id, (r) => (r.error ? rej(new Error(r.error.message ?? "MCP error")) : res(r.result)));
        }
        child.stdin!.write(JSON.stringify(msg) + "\n");
        if (!withId) res(undefined);
      });

    child.on("error", (e) => finish(() => reject(new Error(`could not start ${command}: ${e.message}`))));
    child.on("exit", (code) => {
      if (!settled) finish(() => reject(new Error(`the server exited (${code ?? "signal"}) before answering${stderr ? ` — ${stderr.trim().split("\n").slice(-2).join(" ")}` : ""}`)));
    });
    child.stderr!.on("data", (b: Buffer) => (stderr += b.toString()));
    child.stdout!.on("data", (b: Buffer) => {
      buf += b.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg: { id?: number; result?: unknown; error?: { message?: string } };
        try {
          msg = JSON.parse(line);
        } catch {
          continue; // stray output; the runtime ignores it too
        }
        if (typeof msg.id === "number" && pending.has(msg.id)) {
          pending.get(msg.id)!(msg);
          pending.delete(msg.id);
        }
      }
    });

    (async () => {
      await send(
        "initialize",
        { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "agent-factory-builder", version: "1" } },
        true,
      );
      await send("notifications/initialized", {}, false);
      const r = (await send("tools/list", {}, true)) as { tools?: McpTool[] };
      const tools = (r.tools ?? []).map((t) => ({
        name: String(t.name),
        description: String(t.description ?? ""),
        inputSchema: (t.inputSchema && typeof t.inputSchema === "object" ? t.inputSchema : { type: "object" }) as Record<string, unknown>,
        ...(t.annotations ? { annotations: t.annotations } : {}),
      }));
      finish(() => resolve(tools));
    })().catch((e: Error) => finish(() => reject(e)));
  });
}
