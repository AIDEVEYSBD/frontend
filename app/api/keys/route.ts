import { randomUUID } from "node:crypto";
import { dbReady, query } from "@/lib/server/db";
import { hashKey, mintKey, type KeyRow } from "@/lib/server/keys";

/** API keys: list (never the secret), create (secret shown once), revoke. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await dbReady())) return Response.json({ keys: [], store: "db unreachable" });
  const keys = await query<KeyRow>(
    "SELECT id, name, agent, prefix, created_at, last_used, revoked_at FROM api_keys ORDER BY created_at DESC",
  );
  return Response.json({ keys, mode: keys.some((k) => !k.revoked_at) ? "key" : "open" });
}

export async function POST(req: Request) {
  let body: { name?: string; agent?: string | null };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected a JSON body: {name, agent?}" }, { status: 400 });
  }
  const name = String(body.name ?? "").trim();
  if (!name) return Response.json({ error: "a key needs a name (who holds it)" }, { status: 400 });
  const agent = body.agent ? String(body.agent).trim() : null;
  if (agent && !/^[a-z][a-z0-9-]{0,62}$/.test(agent)) return Response.json({ error: "bad agent id" }, { status: 400 });
  if (!(await dbReady())) return Response.json({ error: "the registry database is unreachable" }, { status: 503 });

  const { key, prefix } = mintKey();
  const id = randomUUID();
  await query("INSERT INTO api_keys (id, name, agent, key_hash, prefix) VALUES ($1, $2, $3, $4, $5)", [id, name, agent, hashKey(key), prefix]);
  return Response.json({
    id, name, agent, prefix, key,
    note: "This is the only time the key is shown. Send it as Authorization: Bearer <key>.",
  });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return Response.json({ error: "which key?" }, { status: 400 });
  if (!(await dbReady())) return Response.json({ error: "the registry database is unreachable" }, { status: 503 });
  await query("UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [id]);
  return Response.json({ revoked: true });
}
