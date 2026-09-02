import { discover, envLines, loadServers, saveServers, shellWords, type McpServer } from "@/lib/server/mcp";

/**
 * Custom tool servers: connect, list, refresh, remove.
 *
 * POST starts the server once to discover its tools and refuses to save a
 * server that will not answer — a dead entry in the palette is worse than an
 * honest error. The runtime picks the saved entry up from workspace/mcp.json.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

export async function GET() {
  return Response.json({ servers: await loadServers() });
}

export async function POST(req: Request) {
  let body: { id?: string; label?: string; command?: string; args?: string[]; env?: Record<string, string> | string; refresh?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  const servers = await loadServers();

  // Refresh re-discovers an existing server's tools.
  if (body.refresh && body.id) {
    const cur = servers.find((s) => s.id === body.id);
    if (!cur) return Response.json({ error: `no server "${body.id}"` }, { status: 404 });
    try {
      cur.tools = await discover(cur.command, cur.args, cur.env);
      cur.discovered_at = new Date().toISOString();
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 422 });
    }
    await saveServers(servers);
    return Response.json({ server: cur });
  }

  const line = String(body.command ?? "").trim();
  const words = shellWords(line);
  if (!words.length) return Response.json({ error: "give the command that starts the server" }, { status: 400 });
  const [command, ...parsedArgs] = words;
  const args = Array.isArray(body.args) && body.args.length ? body.args.map(String) : parsedArgs;
  const env = typeof body.env === "string" ? envLines(body.env) : (body.env ?? {});
  const label = String(body.label ?? "").trim() || command.split("/").pop() || "custom";
  const id = slug(String(body.id ?? "") || label);
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(id)) return Response.json({ error: "the server id must be kebab-case and start with a letter" }, { status: 400 });
  const RESERVED = new Set(["retrieval", "web", "records", "events", "code", "engines", "sandbox", "store", "notify", "peers", "documents", "agents", "spec"]);
  if (RESERVED.has(id)) return Response.json({ error: `"${id}" is a built-in server; choose another id` }, { status: 400 });

  let tools;
  try {
    tools = await discover(command, args, env);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
  if (!tools.length) return Response.json({ error: "the server answered but lists no tools" }, { status: 422 });

  const server: McpServer = { id, label, command, args, env, tools, discovered_at: new Date().toISOString() };
  const next = [...servers.filter((s) => s.id !== id), server];
  await saveServers(next);
  return Response.json({ server });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "which server?" }, { status: 400 });
  const servers = await loadServers();
  await saveServers(servers.filter((s) => s.id !== id));
  return Response.json({ removed: true });
}
