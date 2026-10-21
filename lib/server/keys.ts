import { createHash, randomBytes } from "node:crypto";
import { dbReady, query } from "@/lib/server/db";

/**
 * API keys for the machine doors: the trigger, the SDK, the A2A doors and
 * the platform's own MCP server.
 *
 * A key is shown once at creation and stored only as a SHA-256 hash. A key
 * may be scoped to one agent or left open to all. With no active key at all
 * every machine door refuses: a deployment that has minted nothing has
 * admitted nobody, and the refusal says where the first key is minted.
 */

export interface KeyRow extends Record<string, unknown> {
  id: string;
  name: string;
  agent: string | null;
  prefix: string;
  created_at: string;
  last_used: string | null;
  revoked_at: string | null;
}

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export function mintKey(): { key: string; prefix: string } {
  const key = `af_${randomBytes(24).toString("hex")}`;
  return { key, prefix: key.slice(0, 11) };
}

export type AuthOutcome =
  | { ok: true; mode: "key"; key: KeyRow }
  | { ok: false; status: 401 | 403 | 503; error: string };

export const NO_KEYS_YET = "no API key has been minted on this deployment, so every machine door is closed; mint one on the Configuration page (API keys) and send it as Authorization: Bearer <key>";

/**
 * Authenticate a request for one agent. An empty `agent` means the door has
 * no scope of its own (a read, or a door that learns the agent from the key),
 * so a scoped key passes and the caller reads `key.agent` to find out whose.
 */
export async function authenticate(req: Request, agent: string): Promise<AuthOutcome> {
  if (!(await dbReady())) return { ok: false, status: 503, error: "the registry database is unreachable; the queue needs it" };
  const active = await query<{ n: string }>("SELECT count(*) AS n FROM api_keys WHERE revoked_at IS NULL");
  if (Number(active[0]?.n ?? 0) === 0) return { ok: false, status: 401, error: NO_KEYS_YET };

  const header = req.headers.get("authorization") ?? "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const presented = bearer || req.headers.get("x-api-key")?.trim() || "";
  if (!presented) return { ok: false, status: 401, error: "an API key is required: Authorization: Bearer <key>" };

  const rows = await query<KeyRow>(
    "SELECT id, name, agent, prefix, created_at, last_used, revoked_at FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL",
    [hashKey(presented)],
  );
  if (!rows.length) return { ok: false, status: 401, error: "unknown or revoked API key" };
  const key = rows[0];
  if (key.agent && agent && key.agent !== agent) return { ok: false, status: 403, error: `this key is scoped to "${key.agent}"` };
  query("UPDATE api_keys SET last_used = now() WHERE id = $1", [key.id]).catch(() => {});
  return { ok: true, mode: "key", key };
}
