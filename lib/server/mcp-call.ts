import { spawn } from "node:child_process";
import path from "node:path";
import { loadServers, type McpServer, type McpTool } from "@/lib/server/mcp";

/**
 * Calling one tool on one registered MCP server, from the control plane.
 *
 * Mirrors the runtime's MCPHost handshake exactly — initialize, initialized,
 * tools/call — so what the broker returns to an attached agent is what a
 * workflow node would have received. The server is started for the call and
 * stopped after it: correct first, and the pool the worker keeps warm is the
 * optimisation to reach for when the broker carries volume.
 */

const ROOT = path.resolve(process.cwd(), "..", "runtime");

export interface Granted {
  server: McpServer;
  tool: McpTool;
  /** server.tool, the name the agent sees */
  name: string;
}

/** Every tool the registry offers, as `server.tool`. */
export async function registryTools(): Promise<Granted[]> {
  const out: Granted[] = [];
  for (const server of await loadServers()) for (const tool of server.tools) out.push({ server, tool, name: `${server.id}.${tool.name}` });
  return out;
}

export type Risk = "read" | "write" | "risky" | "destructive";
export const RISK_ORDER: Risk[] = ["read", "write", "risky", "destructive"];

/** Risk from the tool's own annotations, the way the roster derives it. */
export function riskOf(tool: McpTool): Risk {
  const a = (tool.annotations ?? {}) as { readOnlyHint?: boolean; destructiveHint?: boolean };
  if (a.destructiveHint) return "destructive";
  if (a.readOnlyHint) return "read";
  return "write";
}

export interface CallResult {
  content: unknown[];
  isError: boolean;
  text: string;
  duration_ms: number;
}

export function callTool(server: McpServer, tool: string, args: Record<string, unknown>, timeoutMs = 60_000): Promise<CallResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(server.command, server.args, { cwd: ROOT, env: { ...process.env, ...server.env }, stdio: ["pipe", "pipe", "pipe"] });
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
        /* gone */
      }
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(`${server.id} did not answer within ${timeoutMs / 1000}s${stderr ? ` — ${stderr.trim().split("\n").slice(-2).join(" ")}` : ""}`))), timeoutMs);
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
    child.on("error", (e) => finish(() => reject(new Error(`could not start ${server.id}: ${e.message}`))));
    child.on("exit", (code) => {
      if (!settled) finish(() => reject(new Error(`${server.id} exited (${code ?? "signal"}) before answering${stderr ? ` — ${stderr.trim().split("\n").slice(-2).join(" ")}` : ""}`)));
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
          continue;
        }
        if (typeof msg.id === "number" && pending.has(msg.id)) {
          pending.get(msg.id)!(msg);
          pending.delete(msg.id);
        }
      }
    });
    (async () => {
      await send("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "agent-factory-broker", version: "1" } }, true);
      await send("notifications/initialized", {}, false);
      const r = (await send("tools/call", { name: tool, arguments: args }, true)) as { content?: unknown[]; isError?: boolean };
      const content = Array.isArray(r?.content) ? r.content : [];
      const text = content
        .map((c) => (c && typeof c === "object" && (c as { type?: string }).type === "text" ? String((c as { text?: string }).text ?? "") : ""))
        .filter(Boolean)
        .join("\n");
      finish(() => resolve({ content, isError: Boolean(r?.isError), text, duration_ms: Date.now() - started }));
    })().catch((e: Error) => finish(() => reject(e)));
  });
}
