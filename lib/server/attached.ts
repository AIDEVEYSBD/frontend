import { dbReady, query } from "@/lib/server/db";
import { authenticate, type AuthOutcome } from "@/lib/server/keys";
import type { Risk } from "@/lib/server/mcp-call";

/**
 * An attached agent's standing policy, read by every door it comes through.
 *
 *   grants     the registry tools it may call, as server.tool
 *   gate_at    the risk at which a call stops for a person ('' = never)
 *   injection  'block' refuses a screened prompt, 'flag' records it and goes on
 *   blocked    the kill switch: every door refuses until it is lifted
 */

export interface AgentPolicy {
  id: string;
  name: string;
  mode: "sdk" | "a2a";
  grants: string[];
  gate_at: "" | Risk;
  injection: "block" | "flag";
  blocked: boolean;
}

export async function policyOf(agent: string): Promise<AgentPolicy | null> {
  if (!(await dbReady())) return null;
  const rows = await query<{ id: string; name: string; mode: "sdk" | "a2a"; grants: unknown; gate_at: string; injection: string; blocked: boolean }>(
    "SELECT id, name, mode, grants, gate_at, injection, blocked FROM attached_agents WHERE id = $1",
    [agent],
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    mode: r.mode,
    grants: Array.isArray(r.grants) ? r.grants.map(String) : [],
    gate_at: (["read", "write", "risky", "destructive"].includes(r.gate_at) ? r.gate_at : "") as AgentPolicy["gate_at"],
    injection: r.injection === "flag" ? "flag" : "block",
    blocked: Boolean(r.blocked),
  };
}

export type Door =
  | { ok: true; agent: AgentPolicy; auth: AuthOutcome & { ok: true } }
  | { ok: false; status: number; error: string };

/**
 * Who is at the door. The key names the agent, and nothing else does: the
 * identity is the one the key was scoped to when the agent was attached. A
 * path that names an agent must name the key's agent. An unscoped key is a
 * caller, not an agent, and is refused here — a header the caller writes
 * is not an identity.
 */
export async function admit(req: Request, agentFromPath = ""): Promise<Door> {
  const auth = await authenticate(req, agentFromPath);
  if (!auth.ok) return { ok: false, status: auth.status, error: auth.error };
  const id = auth.key.agent ?? "";
  if (!id) {
    return { ok: false, status: 401, error: "this door admits an attached agent by the key minted when it was attached (scoped to it); the key presented is not scoped to any agent" };
  }
  if (agentFromPath && id !== agentFromPath) return { ok: false, status: 403, error: `this key is scoped to "${id}"` };
  const agent = await policyOf(id);
  if (!agent) return { ok: false, status: 404, error: `"${id}" is not an attached agent — attach it on the Configuration page first` };
  if (agent.blocked) return { ok: false, status: 423, error: `"${id}" is blocked by an operator; every door refuses until the block is lifted` };
  return { ok: true, agent, auth };
}
