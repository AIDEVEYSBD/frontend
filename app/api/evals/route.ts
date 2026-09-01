import path from "node:path";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dbReady, query } from "@/lib/server/db";
import { EVALS_DIR, validateSet, type EvalCase } from "@/lib/server/evals";

/**
 * Eval sets: the benchmark a team ships beside its agent.
 *
 * A set is cases — real inputs with checkable expectations — bound to one
 * agent. Uploading is separate from running: the set is a durable artifact
 * (DB + workspace file), and every run of it is recorded against the spec
 * digest it ran under, so "the agent got better" is a claim with two
 * measurements behind it, not a feeling.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!(await dbReady())) return Response.json({ sets: [], store: "db unreachable" });

  if (id) {
    const sets = await query<{ id: string; agent: string; name: string; model: string; cases: EvalCase[] }>(
      "SELECT id, agent, name, model, cases FROM eval_sets WHERE id = $1",
      [id],
    );
    if (!sets.length) return Response.json({ error: `no eval set "${id}"` }, { status: 404 });
    const runs = await query(
      `SELECT id, model, digest, passed, total, results, at FROM eval_runs
       WHERE set_id = $1 ORDER BY at DESC LIMIT 20`,
      [id],
    );
    return Response.json({ set: sets[0], runs });
  }

  const sets = await query<{ id: string; agent: string; name: string; model: string; n: number }>(
    `SELECT s.id, s.agent, s.name, s.model, jsonb_array_length(s.cases) AS n FROM eval_sets s ORDER BY s.updated_at DESC`,
  );
  const latest = await query<{ set_id: string; passed: number; total: number; model: string; at: string }>(
    `SELECT DISTINCT ON (set_id) set_id, passed, total, model, at FROM eval_runs ORDER BY set_id, at DESC`,
  );
  const byId = new Map(latest.map((l) => [l.set_id, l]));
  return Response.json({
    sets: sets.map((s) => ({ ...s, latest: byId.get(s.id) ?? null })),
  });
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = (await req.json()).set;
  } catch {
    return Response.json({ error: "send { set: {...} }" }, { status: 400 });
  }
  const set = validateSet(raw);
  if (typeof set === "string") return Response.json({ error: set }, { status: 422 });

  if (!(await dbReady())) return Response.json({ error: "the registry database is unreachable" }, { status: 503 });
  const agents = await query("SELECT id FROM workflows WHERE id = $1", [set.agent]);
  if (!agents.length) {
    return Response.json({ error: `no saved agent "${set.agent}" — save the workflow first` }, { status: 422 });
  }

  await query(
    `INSERT INTO eval_sets (id, agent, name, model, cases, updated_at) VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (id) DO UPDATE SET agent = EXCLUDED.agent, name = EXCLUDED.name,
       model = EXCLUDED.model, cases = EXCLUDED.cases, updated_at = now()`,
    [set.id, set.agent, set.name, set.model ?? "", JSON.stringify(set.cases)],
  );
  // Write-through: the set lives beside the workspace like everything durable.
  await mkdir(EVALS_DIR, { recursive: true });
  await writeFile(path.join(EVALS_DIR, `${set.id}.json`), JSON.stringify(set, null, 2) + "\n");

  return Response.json({ saved: true, id: set.id, cases: set.cases.length });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^[a-z][a-z0-9-]{0,62}$/.test(id)) return Response.json({ error: "which set?" }, { status: 400 });
  if (await dbReady()) {
    await query("DELETE FROM eval_sets WHERE id = $1", [id]);
    await query("DELETE FROM eval_runs WHERE set_id = $1", [id]);
  }
  await unlink(path.join(EVALS_DIR, `${id}.json`)).catch(() => {});
  return Response.json({ removed: true });
}
