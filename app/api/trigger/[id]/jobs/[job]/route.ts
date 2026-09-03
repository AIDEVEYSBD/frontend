import { dbReady, query } from "@/lib/server/db";
import { jobView } from "../../route";

/** One job on the trigger queue: its status, and the run's result once done. */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; job: string }> }) {
  const { id, job } = await ctx.params;
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(id) || !/^[a-zA-Z0-9-]{1,64}$/.test(job)) {
    return Response.json({ error: "bad id" }, { status: 400 });
  }
  if (!(await dbReady())) return Response.json({ error: "the registry database is unreachable" }, { status: 503 });
  const rows = await query<Parameters<typeof jobView>[1]>(
    "SELECT id, agent, external_id, source, status, attempts, run_id, result, error, created_at, started_at, finished_at FROM trigger_jobs WHERE id = $1 AND agent = $2",
    [job, id],
  );
  if (!rows.length) return Response.json({ error: `no job "${job}" for "${id}"` }, { status: 404 });
  return Response.json(jobView(id, rows[0]));
}
