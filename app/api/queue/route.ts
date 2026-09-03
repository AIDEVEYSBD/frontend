import { dbReady, query } from "@/lib/server/db";

/**
 * The trigger queue, as numbers: depth and age per agent, runs in flight,
 * workers holding live leases. What the control pane charts, and what an
 * external system can poll before deciding whether to push more.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!(await dbReady())) return Response.json({ error: "the registry database is unreachable" }, { status: 503 });
  const byAgent = await query<{ agent: string; status: string; n: string; oldest: string | null }>(
    `SELECT agent, status, count(*) AS n, min(created_at) AS oldest
       FROM trigger_jobs WHERE status IN ('queued', 'running') OR finished_at > now() - interval '1 hour'
       GROUP BY agent, status ORDER BY agent, status`,
  );
  const workers = await query<{ claimed_by: string; n: string; until: string }>(
    `SELECT claimed_by, count(*) AS n, max(lease_until) AS until FROM trigger_jobs
       WHERE status = 'running' AND lease_until > now() AND claimed_by IS NOT NULL GROUP BY claimed_by`,
  );
  const recent = await query<{ n: string; avg_ms: string | null; failed: string }>(
    `SELECT count(*) AS n,
            avg(extract(epoch FROM (finished_at - started_at)) * 1000) AS avg_ms,
            count(*) FILTER (WHERE status = 'failed') AS failed
       FROM trigger_jobs WHERE finished_at > now() - interval '1 hour'`,
  );
  const agents: Record<string, Record<string, number> & { oldest_queued?: string | null }> = {};
  for (const r of byAgent) {
    agents[r.agent] ??= {};
    agents[r.agent][r.status] = Number(r.n);
    if (r.status === "queued") agents[r.agent].oldest_queued = r.oldest;
  }
  return Response.json({
    agents,
    workers: workers.map((w) => ({ name: w.claimed_by, running: Number(w.n), lease_until: w.until })),
    last_hour: { finished: Number(recent[0]?.n ?? 0), failed: Number(recent[0]?.failed ?? 0), avg_ms: recent[0]?.avg_ms ? Math.round(Number(recent[0].avg_ms)) : null },
  });
}
