import { admit, type AgentPolicy } from "@/lib/server/attached";
import { entry, newRecord, readRecord, writeRecord, type RunRecord } from "@/lib/server/journal-store";
import { callTool, registryTools, riskOf, RISK_ORDER, type Granted } from "@/lib/server/mcp-call";
import { policyOf } from "@/lib/server/attached";
import { ENDPOINTS } from "@/lib/attached";

/**
 * The tool broker: one MCP server per attached agent, serving exactly the
 * registry tools that agent has been granted, through the policy engine.
 *
 *   tools/list   the grants, with the upstream's own descriptions and hints
 *   tools/call   refused when ungranted (and recorded); stopped for a person
 *                when at or above the agent's gate risk; otherwise forwarded
 *                to the registered server and journalled as a tool call
 *
 * Sessions: `initialize` opens a run and returns it as Mcp-Session-Id, the
 * header MCP clients echo on every later request, so a session's calls land
 * in one record. DELETE closes it. A call with no session is its own run.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROTOCOL = "2025-06-18";
const GATE_WAIT_MS = 110_000;

interface Rpc { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }

const ok = (id: Rpc["id"], result: unknown, headers: Record<string, string> = {}) =>
  Response.json({ jsonrpc: "2.0", id: id ?? null, result }, { headers });
const fail = (id: Rpc["id"], code: number, message: string, status = 200) =>
  Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });
const toolError = (id: Rpc["id"], message: string, headers: Record<string, string> = {}) =>
  ok(id, { content: [{ type: "text", text: JSON.stringify({ error: message }) }], isError: true }, headers);

async function grantedTools(agent: AgentPolicy): Promise<Granted[]> {
  const all = await registryTools();
  const set = new Set(agent.grants);
  return all.filter((g) => set.has(g.name));
}

/** The run this request writes into: the session's, or a fresh one for a lone call. */
async function recordFor(agent: AgentPolicy, session: string, keyPrefix: string | undefined): Promise<{ rec: RunRecord; owned: boolean } | null> {
  if (session) {
    const rec = await readRecord(session);
    if (!rec || rec.system !== agent.id) return null;
    if (rec.state === "done" && rec.journal.entries.at(-1)?.kind === "run.end") rec.journal.entries.pop();
    rec.state = "running";
    return { rec, owned: false };
  }
  const rec = newRecord(agent.id, "broker", undefined, keyPrefix);
  rec.journal.entries.push(entry(0, "run.start", "", agent.id, "through the tool broker", { system: agent.id, door: "broker" }));
  return { rec, owned: true };
}

export async function GET(_req: Request, ctx: { params: Promise<{ agent: string }> }) {
  const { agent } = await ctx.params;
  const policy = await policyOf(agent);
  const grants = policy ? await grantedTools(policy) : [];
  return Response.json({
    door: "tool broker",
    agent,
    attached: Boolean(policy),
    url: ENDPOINTS.broker(agent),
    protocol: `Model Context Protocol ${PROTOCOL}, Streamable HTTP, JSON-RPC 2.0`,
    auth: "Authorization: Bearer <api key> — a key scoped to this agent",
    gate_at: policy?.gate_at || "never",
    blocked: policy?.blocked ?? false,
    tools: grants.map((g) => ({ name: g.name, risk: riskOf(g.tool), server: g.server.label })),
    client: { mcpServers: { "agent-factory": { url: ENDPOINTS.broker(agent), headers: { Authorization: "Bearer <api key>" } } } },
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ agent: string }> }) {
  const { agent } = await ctx.params;
  const door = await admit(req, agent);
  if (!door.ok) return Response.json({ error: door.error }, { status: door.status });
  const session = req.headers.get("mcp-session-id") ?? "";
  const rec = session ? await readRecord(session) : null;
  if (!rec || rec.system !== agent) return Response.json({ error: "no such session" }, { status: 404 });
  if (rec.state !== "done" && rec.state !== "failed" && rec.state !== "killed") {
    rec.journal.entries.push(entry(rec.journal.duration_ms, "run.end", "", "done", "session closed by the agent", { state: "done" }));
    rec.state = "done";
    rec.suspension = null;
    await writeRecord(rec);
  }
  return new Response(null, { status: 204 });
}

export async function POST(req: Request, ctx: { params: Promise<{ agent: string }> }) {
  const { agent: agentId } = await ctx.params;
  let body: Rpc | Rpc[];
  try {
    body = await req.json();
  } catch {
    return fail(null, -32700, "parse error", 400);
  }
  if (Array.isArray(body)) return fail(null, -32600, "batch requests are not supported", 400);
  const { id, method, params = {} } = body;
  if (!method) return fail(id, -32600, "invalid request: method missing", 400);
  if (method.startsWith("notifications/")) return new Response(null, { status: 202 });

  const door = await admit(req, agentId);
  if (!door.ok) return fail(id, door.status === 423 ? -32001 : -32000, door.error, door.status);
  const { agent, auth } = door;
  const keyPrefix = auth.mode === "key" ? auth.key?.prefix : "open";
  const session = req.headers.get("mcp-session-id") ?? "";

  switch (method) {
    case "initialize": {
      const rec = newRecord(agent.id, "broker", undefined, keyPrefix);
      rec.journal.entries.push(entry(0, "run.start", "", agent.id, "MCP session opened through the tool broker", { system: agent.id, door: "broker" }));
      await writeRecord(rec);
      return ok(
        id,
        {
          protocolVersion: String(params.protocolVersion ?? PROTOCOL),
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "agent-factory-broker", title: `Agent Factory · ${agent.name}`, version: "0.1.0" },
          instructions: `Tools granted to ${agent.name} on this deployment, served through the policy engine. Every call is journalled; calls at or above ${agent.gate_at || "no"} risk wait for a person.`,
        },
        { "mcp-session-id": rec.id },
      );
    }
    case "ping":
      return ok(id, {});
    case "tools/list": {
      const grants = await grantedTools(agent);
      return ok(id, {
        tools: grants.map((g) => ({
          name: g.name,
          description: g.tool.description,
          inputSchema: g.tool.inputSchema,
          annotations: { title: g.tool.name.replace(/_/g, " "), ...(g.tool.annotations ?? {}) },
        })),
      });
    }
    case "tools/call": {
      const name = String(params.name ?? "");
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const opened = await recordFor(agent, session, keyPrefix);
      if (!opened) return fail(id, -32000, "unknown session for this agent", 404);
      const { rec, owned } = opened;
      const started = Date.now();
      const base = rec.journal.duration_ms;
      const at = () => base + (Date.now() - started);
      const node = "tools";
      const close = async (state: "done" | "failed", error = "") => {
        if (owned) {
          rec.journal.entries.push(entry(at(), "run.end", "", state, error, { state }));
          rec.state = state;
          rec.error = error;
        }
        await writeRecord(rec);
      };
      const headers = session ? { "mcp-session-id": session } : { "mcp-session-id": rec.id };

      const grants = await grantedTools(agent);
      const granted = grants.find((g) => g.name === name);
      if (!granted) {
        rec.journal.entries.push(entry(at(), "denied", node, name, "tool not granted to this agent", { control: "capability", tool: name, args }));
        await close(owned ? "failed" : "done", owned ? "tool not granted" : "");
        return toolError(id, `${name} is not granted to ${agent.id}; the refusal is on run ${rec.id}`, headers);
      }
      const risk = riskOf(granted.tool);
      rec.journal.entries.push(entry(at(), "tool.call", node, name, "", { args, risk, server: granted.server.id }));

      // A call at or above the gate risk stops here until a person answers on the control pane.
      if (agent.gate_at && RISK_ORDER.indexOf(risk) >= RISK_ORDER.indexOf(agent.gate_at)) {
        const prompt = `${agent.name} asks to call ${name} (${risk})`;
        rec.journal.entries.push(entry(at(), "gate.open", node, prompt, `at or above ${agent.gate_at}`, { tool: name, risk, args }));
        rec.journal.entries.push(entry(at(), "suspend", node, "awaiting a person", prompt));
        rec.state = "suspended";
        rec.suspension = { kind: "approval", node, approvers: [], prompt, timeout_s: GATE_WAIT_MS / 1000, on_timeout: "abort", resume: {} };
        await writeRecord(rec);
        const deadline = Date.now() + GATE_WAIT_MS;
        let answer: Record<string, unknown> | undefined;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 1500));
          const now = await readRecord(rec.id);
          if (now?.answer) {
            answer = now.answer;
            // The console wrote the answer onto the record; the resume goes in
            // front of it, at the moment the broker actually picked it up.
            const es = now.journal.entries;
            const i = es.map((e) => e.kind).lastIndexOf("gate.answer");
            const resume = entry(at(), "resume", node, "answered", `by ${String(answer.by ?? "")}`);
            if (i >= 0) {
              es[i].t = resume.t;
              es.splice(i, 0, resume);
            } else es.push(resume);
            rec.journal.entries = es;
            rec.answer = answer;
            break;
          }
        }
        // Whatever the answer, the session is live again; only a lone call closes.
        rec.suspension = null;
        rec.state = "running";
        rec.error = "";
        if (!answer) {
          rec.journal.entries.push(entry(at(), "gate.answer", node, "Nobody answered", `${GATE_WAIT_MS / 1000}s passed`, { approved: false, timed_out: true }));
          await close("failed", "gate timed out");
          return toolError(id, `nobody answered the gate for ${name} within ${GATE_WAIT_MS / 1000}s; the call was not made`, headers);
        }
        if (!answer.approved) {
          await close("failed", `refused by ${String(answer.by ?? "")}`);
          return toolError(id, `${name} refused by ${String(answer.by ?? "someone")}${answer.note ? `: ${String(answer.note)}` : ""}`, headers);
        }
      }

      try {
        const r = await callTool(granted.server, granted.tool.name, args);
        const tainted = Boolean((granted.tool.annotations as { openWorldHint?: boolean } | undefined)?.openWorldHint);
        rec.journal.entries.push(entry(at(), "tool.result", node, name, r.isError ? "the tool reported an error" : "", { value: r.text.slice(0, 4000), isError: r.isError, duration_ms: r.duration_ms }, tainted));
        if (tainted) rec.journal.entries.push(entry(at(), "taint", node, "untrusted content", `returned by ${name}`, { tool: name }, true));
        await close("done");
        return ok(id, { content: r.content, isError: r.isError }, headers);
      } catch (e) {
        rec.journal.entries.push(entry(at(), "error", node, name, (e as Error).message, { tool: name }));
        await close("failed", (e as Error).message);
        return toolError(id, `${name} failed: ${(e as Error).message}`, headers);
      }
    }
    case "resources/list":
      return ok(id, { resources: [] });
    case "prompts/list":
      return ok(id, { prompts: [] });
    default:
      return fail(id, -32601, `method not found: ${method}`);
  }
}
