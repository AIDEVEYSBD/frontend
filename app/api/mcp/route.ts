import { discover, envLines, loadServers, saveServers, shellWords, type McpServer } from "@/lib/server/mcp";
import { permit } from "@/lib/server/auth";

/**
 * The registry of custom MCP servers this deployment has connected.
 *
 * GET lists them with the tools each announced. POST with a label, a command
 * line and KEY=VALUE env lines starts the server once, completes the MCP
 * handshake, records the tools it lists and stops it, so the builder shows
 * exactly what a run will get; POST with an id and `refresh` repeats the
 * discovery for a server already connected. DELETE removes one. The
 * registry is written to the database and mirrored to the runtime's
 * mcp.json, which is the copy the runtime reads.
 *
 * The platform's own MCP server, for outside clients, lives at /api/mcp/server.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

function slug(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "server";
}

export async function GET() {
  const servers = await loadServers();
  return Response.json({ servers, count: servers.length });
}

export async function POST(req: Request) {
  { const gate = await permit(req, "configure"); if (gate) return gate; }
  let body: { id?: string; refresh?: boolean; label?: string; command?: string; env?: string | Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'expected {"label", "command", "env"} or {"id", "refresh": true}' }, { status: 400 });
  }
  const servers = await loadServers();

  if (body.id && body.refresh) {
    const id = String(body.id);
    const existing = servers.find((s) => s.id === id);
    if (!existing) return Response.json({ error: `no server "${id}"` }, { status: 404 });
    try {
      const tools = await discover(existing.command, existing.args, existing.env);
      const updated: McpServer = { ...existing, tools, discovered_at: new Date().toISOString() };
      await saveServers(servers.map((s) => (s.id === id ? updated : s)));
      return Response.json({ server: updated, tools: tools.length });
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 502 });
    }
  }

  const label = String(body.label ?? "").trim();
  const line = String(body.command ?? "").trim();
  if (!label || !line) return Response.json({ error: "a label and a command line are needed" }, { status: 400 });
  const [command, ...args] = shellWords(line);
  if (!command) return Response.json({ error: "the command line is empty" }, { status: 400 });
  const env = typeof body.env === "string" ? envLines(body.env) : (body.env ?? {});
  let id = slug(label);
  if (!ID.test(id)) id = `server-${Date.now().toString(36)}`;
  if (servers.some((s) => s.id === id)) id = `${id}-${Date.now().toString(36).slice(-4)}`;

  try {
    const tools = await discover(command, args, env);
    const server: McpServer = { id, label, command, args, env, tools, discovered_at: new Date().toISOString() };
    await saveServers([...servers, server]);
    return Response.json({ server, tools: tools.length });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function DELETE(req: Request) {
  { const gate = await permit(req, "configure"); if (gate) return gate; }
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return Response.json({ error: "which server?" }, { status: 400 });
  const servers = await loadServers();
  if (!servers.some((s) => s.id === id)) return Response.json({ error: `no server "${id}"` }, { status: 404 });
  await saveServers(servers.filter((s) => s.id !== id));
  return Response.json({ removed: id });
}
