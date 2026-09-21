import { randomUUID } from "node:crypto";
import { permit, session as whoIs, signer, ssoEnabled } from "@/lib/server/auth";
import { dbReady, query } from "@/lib/server/db";
import { hashKey, mintKey } from "@/lib/server/keys";
import { agentActivityFor } from "@/lib/demo-activity";
import { FRAMEWORK_BY_ID, SEED_AGENTS, slugOf, type AttachMode, type AttachedAgent } from "@/lib/attached";
import { registryTools, riskOf } from "@/lib/server/mcp-call";

/**
 * Third-party agents attached to this control plane.
 *
 * A row is an agent built elsewhere that reports into the same journal as
 * the factory's own: over the SDK from inside its process, or over A2A with
 * its model calls and tools routed through the factory. Attaching mints an
 * API key scoped to the agent — the key its SDK or gateway configuration
 * carries — shown once, like every key here.
 *
 * Activity is measured from the run record for an agent that has one. The
 * seeded agents carry demonstration activity, and the row says which it is
 * to the code even though the page draws both the same.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ID = /^[a-z][a-z0-9-]{0,62}$/;
const COLS = "id, name, mode, framework, language, owner, card_url, key_prefix, demo, created_at, last_seen, grants, gate_at, injection, blocked";

interface Row extends Record<string, unknown> {
  id: string;
  name: string;
  mode: AttachMode;
  framework: string;
  language: string;
  owner: string;
  card_url: string;
  key_prefix: string;
  demo: boolean;
  created_at: string;
  last_seen: string | null;
  grants: unknown;
  gate_at: string;
  injection: string;
  blocked: boolean;
}

const RISKS = ["read", "write", "risky", "destructive"];

function policyView(r: Row): Pick<AttachedAgent, "grants" | "gate_at" | "injection" | "blocked"> {
  return {
    grants: Array.isArray(r.grants) ? r.grants.map(String) : [],
    gate_at: (RISKS.includes(r.gate_at) ? r.gate_at : "") as AttachedAgent["gate_at"],
    injection: r.injection === "flag" ? "flag" : "block",
    blocked: Boolean(r.blocked),
  };
}

/** Fill the registry once, so the panel shows an attached estate on first read. */
async function seed(): Promise<void> {
  const done = await query<{ value: unknown }>("SELECT value FROM settings WHERE key = 'attached.seeded'");
  if (done.length) return;
  for (const s of SEED_AGENTS) {
    const prefix = `af_${hashKey(`seed:${s.id}`).slice(0, 8)}`;
    await query(
      `INSERT INTO attached_agents (id, name, mode, framework, language, owner, card_url, key_prefix, demo, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, now() - interval '1 day' * $9)
       ON CONFLICT (id) DO NOTHING`,
      [s.id, s.name, s.mode, s.framework, s.language, s.owner, s.card_url, prefix, 20 + (hashKey(s.id).charCodeAt(0) % 120)],
    );
  }
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('attached.seeded', 'true'::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
  );
}

async function view(rows: Row[]): Promise<AttachedAgent[]> {
  // Measured activity, for the agents that have any.
  const live = rows.filter((r) => !r.demo).map((r) => r.id);
  const measured = new Map<string, { runs: number; cost: number | null; denials: number; last: string | null; p50: number | null }>();
  if (live.length) {
    const stats = await query<{ system: string; runs: string; cost: string | null; unpriced: string; denials: string; last: string | null; p50: string | null }>(
      `SELECT system, count(*) AS runs, sum(cost) AS cost, count(*) FILTER (WHERE cost IS NULL) AS unpriced,
              sum(denials) AS denials, max(at) AS last,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50
         FROM run_metrics WHERE system = ANY($1) AND at > now() - interval '30 days' GROUP BY system`,
      [live],
    );
    for (const s of stats) {
      measured.set(s.system, {
        runs: Number(s.runs),
        cost: Number(s.unpriced) > 0 ? null : Number(s.cost ?? 0),
        denials: Number(s.denials ?? 0),
        last: s.last,
        p50: s.p50 === null ? null : Number(s.p50),
      });
    }
  }
  return rows.map((r) => {
    if (r.demo) {
      const a = agentActivityFor(r.id, r.mode);
      return { ...r, ...policyView(r), last_seen: a.lastSeen, runs30d: a.runs30d, cost30d: a.cost30d, denials30d: a.denials30d, gates30d: a.gates30d, p50ms: a.p50ms };
    }
    const m = measured.get(r.id);
    return {
      ...r,
      ...policyView(r),
      last_seen: m?.last ?? r.last_seen,
      runs30d: m?.runs ?? 0,
      cost30d: m ? m.cost : 0,
      denials30d: m?.denials ?? 0,
      gates30d: null,
      p50ms: m?.p50 ?? null,
    };
  });
}

export async function GET(req: Request) {
  // The tools an agent can be granted: the registry, as server.tool with risk.
  if (new URL(req.url).searchParams.has("registry")) {
    const tools = await registryTools();
    return Response.json({
      tools: tools.map((g) => ({ name: g.name, server: g.server.id, label: g.server.label, tool: g.tool.name, description: g.tool.description, risk: riskOf(g.tool) })),
    });
  }
  if (!(await dbReady())) {
    // No registry: show the seeded estate so the page still reads, and say so.
    const rows: Row[] = SEED_AGENTS.map((s) => ({ ...s, key_prefix: "af_……", demo: true, created_at: new Date().toISOString(), last_seen: null, grants: [], gate_at: "", injection: "block", blocked: false }));
    const agents = rows.map((r) => {
      const a = agentActivityFor(r.id, r.mode);
      return { ...r, ...policyView(r), last_seen: a.lastSeen, runs30d: a.runs30d, cost30d: a.cost30d, denials30d: a.denials30d, gates30d: a.gates30d, p50ms: a.p50ms };
    });
    return Response.json({ agents, store: "db unreachable" });
  }
  await seed();
  const rows = await query<Row>(`SELECT ${COLS} FROM attached_agents ORDER BY created_at DESC`);
  return Response.json({ agents: await view(rows), store: "db" });
}

export async function POST(req: Request) {
  { const gate = await permit(req, "configure"); if (gate) return gate; }
  let body: { id?: string; name?: string; mode?: string; framework?: string; language?: string; owner?: string; card_url?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected a JSON body: {name, mode, framework?, language?, owner?, card_url?}" }, { status: 400 });
  }
  const name = String(body.name ?? "").trim().slice(0, 80);
  if (!name) return Response.json({ error: "the agent needs a name" }, { status: 400 });
  const id = String(body.id || slugOf(name));
  if (!ID.test(id)) return Response.json({ error: `"${id}" is not a valid agent id (lowercase letters, digits, dashes)` }, { status: 400 });
  const mode: AttachMode = body.mode === "a2a" ? "a2a" : "sdk";
  const framework = String(body.framework ?? "custom");
  if (!FRAMEWORK_BY_ID.has(framework)) return Response.json({ error: `unknown framework "${framework}"` }, { status: 400 });
  const language = mode === "sdk" ? String(body.language ?? "python") : "";
  const owner = String(body.owner ?? "").trim().slice(0, 80);
  const cardUrl = mode === "a2a" ? String(body.card_url ?? "").trim().slice(0, 500) : "";
  if (mode === "a2a" && cardUrl && !/^https?:\/\//.test(cardUrl)) return Response.json({ error: "the agent card URL must be http(s)" }, { status: 400 });
  if (!(await dbReady())) return Response.json({ error: "the registry database is unreachable" }, { status: 503 });

  const taken = await query<{ id: string }>("SELECT id FROM attached_agents WHERE id = $1", [id]);
  if (taken.length) return Response.json({ error: `an agent "${id}" is already attached` }, { status: 409 });

  // The key the agent will carry: scoped to it, stored hashed, shown once.
  const { key, prefix } = mintKey();
  const keyId = randomUUID();
  await query("INSERT INTO api_keys (id, name, agent, key_hash, prefix) VALUES ($1, $2, $3, $4, $5)", [keyId, `${name} · attached agent`, id, hashKey(key), prefix]);
  const rows = await query<Row>(
    `INSERT INTO attached_agents (id, name, mode, framework, language, owner, card_url, key_id, key_prefix)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${COLS}`,
    [id, name, mode, framework, language, owner, cardUrl, keyId, prefix],
  );
  const [agent] = await view(rows);
  return Response.json({ agent, key, note: "This is the only time the key is shown. The agent sends it as Authorization: Bearer <key>." });
}

/** The agent's standing policy: grants, gate risk, injection action, the block. */
export async function PATCH(req: Request) {
  { const gate = await permit(req, "configure"); if (gate) return gate; }
  let body: { id?: string; grants?: unknown; gate_at?: string; injection?: string; blocked?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected a JSON body: {id, grants?, gate_at?, injection?, blocked?}" }, { status: 400 });
  }
  const id = String(body.id ?? "");
  if (!ID.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
  if (!(await dbReady())) return Response.json({ error: "the registry database is unreachable" }, { status: 503 });
  const sets: string[] = [];
  const vals: unknown[] = [id];
  if (Array.isArray(body.grants)) {
    const known = new Set((await registryTools()).map((g) => g.name));
    const grants = body.grants.map(String).filter((g) => known.has(g));
    vals.push(JSON.stringify([...new Set(grants)]));
    sets.push(`grants = $${vals.length}::jsonb`);
  }
  if (typeof body.gate_at === "string") {
    if (body.gate_at && !RISKS.includes(body.gate_at)) return Response.json({ error: `gate_at must be one of ${RISKS.join(", ")} or empty` }, { status: 400 });
    vals.push(body.gate_at);
    sets.push(`gate_at = $${vals.length}`);
  }
  if (typeof body.injection === "string") {
    if (!["block", "flag"].includes(body.injection)) return Response.json({ error: "injection must be block or flag" }, { status: 400 });
    vals.push(body.injection);
    sets.push(`injection = $${vals.length}`);
  }
  if (typeof body.blocked === "boolean") {
    vals.push(body.blocked);
    sets.push(`blocked = $${vals.length}`);
  }
  if (!sets.length) return Response.json({ error: "nothing to change" }, { status: 400 });
  const rows = await query<Row>(`UPDATE attached_agents SET ${sets.join(", ")} WHERE id = $1 RETURNING ${COLS}`, vals);
  if (!rows.length) return Response.json({ error: `no attached agent "${id}"` }, { status: 404 });
  const [agent] = await view(rows);
  return Response.json({ agent });
}

export async function DELETE(req: Request) {
  { const gate = await permit(req, "configure"); if (gate) return gate; }
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!ID.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
  if (!(await dbReady())) return Response.json({ error: "the registry database is unreachable" }, { status: 503 });
  const rows = await query<{ key_id: string | null }>("DELETE FROM attached_agents WHERE id = $1 RETURNING key_id", [id]);
  if (!rows.length) return Response.json({ error: `no attached agent "${id}"` }, { status: 404 });
  if (rows[0].key_id) await query("UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [rows[0].key_id]);
  return Response.json({ detached: id, keyRevoked: Boolean(rows[0].key_id) });
}
