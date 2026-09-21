import { CONSOLE_TOOLS, runTool } from "@/lib/server/console-tools";
import { authenticate } from "@/lib/server/keys";
import { MCP_ENDPOINT } from "@/lib/site";

/**
 * Agent Factory as an MCP server.
 *
 * Model Context Protocol over Streamable HTTP: a client POSTs JSON-RPC
 * requests here and reads JSON responses. It exposes the platform to other
 * agents and to desktop clients the same way the platform exposes a client's
 * estate to its own agents: a tool list, each call authenticated, each call
 * journalled by the API it lands on. Reading is open to any active key;
 * starting a workflow needs a key scoped to that workflow, exactly as the
 * trigger endpoint requires, because the same key is forwarded to it.
 *
 * GET describes the server for the console and for people configuring a
 * client. (The registry of servers this deployment connects to is /api/mcp.)
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROTOCOL = "2025-06-18";
const SERVER = { name: "agent-factory", title: "Agent Factory", version: "0.1.0" };

interface Rpc { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }

function ok(id: Rpc["id"], result: unknown) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result });
}
function fail(id: Rpc["id"], code: number, message: string, status = 200) {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });
}

function origin(req: Request): string {
  return process.env.ASSISTANT_SELF_ORIGIN || new URL(req.url).origin;
}

export async function GET() {
  const endpoint = MCP_ENDPOINT;
  return Response.json({
    server: SERVER,
    protocolVersion: PROTOCOL,
    transport: "streamable-http",
    endpoint,
    auth: "Authorization: Bearer <api key> (the same keys as /api/trigger; reading needs any active key, trigger_workflow needs a key scoped to that workflow; open until the first key is minted)",
    tools: CONSOLE_TOOLS.map((t) => ({ name: t.name, description: t.description, action: Boolean(t.action), inputSchema: t.inputSchema })),
    client: {
      claude: { mcpServers: { "agent-factory": { type: "http", url: endpoint, headers: { Authorization: "Bearer <api key>" } } } },
      cursor: { mcpServers: { "agent-factory": { url: endpoint, headers: { Authorization: "Bearer <api key>" } } } },
    },
  });
}

export async function POST(req: Request) {
  let body: Rpc | Rpc[];
  try {
    body = await req.json();
  } catch {
    return fail(null, -32700, "parse error", 400);
  }
  if (Array.isArray(body)) return fail(null, -32600, "batch requests are not supported", 400);
  const { id, method, params = {} } = body;
  if (!method) return fail(id, -32600, "invalid request: method missing", 400);

  // Notifications carry no id and expect no body.
  if (method.startsWith("notifications/")) return new Response(null, { status: 202 });

  switch (method) {
    case "initialize":
      return ok(id, {
        protocolVersion: PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER,
        instructions:
          "Agent Factory, EY's platform for building, securing and operating AI agents. Read the deployment with the status, controls, knowledge, gates and run tools; start a workflow with trigger_workflow. Every call runs under the platform's policy engine and is journalled.",
      });
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, {
        tools: CONSOLE_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: { readOnlyHint: !t.action, destructiveHint: false, openWorldHint: false, title: t.name.replace(/_/g, " ") },
        })),
      });
    case "tools/call": {
      const name = String(params.name ?? "");
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const tool = CONSOLE_TOOLS.find((t) => t.name === name);
      if (!tool) return fail(id, -32602, `unknown tool ${name}`);

      // Reading needs any active key once keys exist; acting is checked by
      // the trigger endpoint itself, against the workflow named in the call.
      const auth = await authenticate(req, tool.action ? String(args.workflow ?? "") : "");
      if (!auth.ok && !(tool.action && auth.status === 403)) {
        return ok(id, { content: [{ type: "text", text: JSON.stringify({ error: auth.error }) }], isError: true });
      }
      const header = req.headers.get("authorization") ?? (req.headers.get("x-api-key") ? `Bearer ${req.headers.get("x-api-key")}` : undefined);
      const text = await runTool(origin(req), name, args, header ?? undefined);
      let isError = false;
      try {
        isError = Boolean((JSON.parse(text) as { error?: unknown }).error);
      } catch {
        /* text is not JSON, which is fine */
      }
      return ok(id, { content: [{ type: "text", text }], isError });
    }
    case "resources/list":
      return ok(id, { resources: [] });
    case "prompts/list":
      return ok(id, { prompts: [] });
    default:
      return fail(id, -32601, `method not found: ${method}`);
  }
}
