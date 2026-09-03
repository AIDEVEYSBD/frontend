import { randomUUID } from "node:crypto";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { dbReady, query } from "@/lib/server/db";
import { authenticate } from "@/lib/server/keys";

/**
 * The API trigger: an external system posts an input by agent id.
 *
 * Nothing runs inside this request. The input becomes a job on the trigger
 * queue and the caller gets 202 with a status URL; a worker
 * (`python3 -m agentfactory worker`) claims it, runs the graph with warm
 * plugin hosts, and writes the outcome back onto the job. That is what makes
 * the endpoint a standing intake rather than a function call: a burst of ten
 * thousand posts is ten thousand rows, drained at whatever rate the workers
 * and the model provider sustain, and a restart resumes what was claimed.
 *
 * Idempotency is by (agent, external_id): the same alert posted twice is one
 * job, and the second caller is told so. `wait: true` blocks up to two
 * minutes for callers that want the result in one round trip.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = path.resolve(process.cwd(), "..", "runtime");
const ID = /^[a-z][a-z0-9-]{0,62}$/;

interface SpecDoc {
  metadata?: { id?: string; name?: string };
  spec?: {
    entry?: string;
    trigger?: { kind?: string };
    nodes?: { id: string; expects?: { name: string; kind: string; required?: boolean; note?: string }[] }[];
  };
}

interface JobRow extends Record<string, unknown> {
  id: string;
  agent: string;
  external_id: string | null;
  source: string;
  status: string;
  attempts: number;
  run_id: string | null;
  result: unknown;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

async function loadSpec(id: string): Promise<SpecDoc | null> {
  try {
    if (await dbReady()) {
      const rows = await query<{ spec: SpecDoc }>("SELECT spec FROM workflows WHERE id = $1", [id]);
      if (rows.length) return rows[0].spec;
    }
  } catch {
    /* fall through to the file */
  }
  try {
    return JSON.parse(await readFile(path.join(ROOT, "workspace", "agents", `${id}.json`), "utf-8"));
  } catch {
    return null;
  }
}

export function jobView(agent: string, j: JobRow) {
  return {
    job_id: j.id,
    agent,
    status: j.status,
    external_id: j.external_id,
    source: j.source,
    attempts: j.attempts,
    run_id: j.run_id,
    result: j.result ?? null,
    error: j.error ?? null,
    created_at: j.created_at,
    started_at: j.started_at,
    finished_at: j.finished_at,
    status_url: `/api/trigger/${agent}/jobs/${j.id}`,
    run_url: j.run_id ? `/runs?id=${encodeURIComponent(j.run_id)}` : null,
  };
}

const JOB_COLS = "id, agent, external_id, source, status, attempts, run_id, result, error, created_at, started_at, finished_at";

/** Describe what this trigger accepts: the entry node's declared inputs. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
  const doc = await loadSpec(id);
  if (!doc) return Response.json({ error: `no saved agent "${id}"` }, { status: 404 });
  const entry = doc.spec?.nodes?.find((n) => n.id === doc.spec?.entry);
  return Response.json({
    id,
    name: doc.metadata?.name ?? id,
    trigger: doc.spec?.trigger?.kind ?? "prompt",
    accepts: (entry?.expects ?? []).map((f) => ({ name: f.name, kind: f.kind, required: f.required !== false, note: f.note ?? "" })),
    usage: `POST /api/trigger/${id} with JSON {"input": {...}, "external_id": "<your id>", "wait": false} and Authorization: Bearer <key>`,
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return Response.json({ error: "bad id" }, { status: 400 });

  const auth = await authenticate(req, id);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  let body: { input?: Record<string, unknown>; external_id?: string; source?: string; model?: string; priority?: number; wait?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected a JSON body: {\"input\": {...}}" }, { status: 400 });
  }
  const input = body.input && typeof body.input === "object" ? body.input : null;
  if (!input) return Response.json({ error: "send {\"input\": {...}} matching the entry node's contract (GET this URL to see it)" }, { status: 400 });

  const doc = await loadSpec(id);
  if (!doc) return Response.json({ error: `no saved agent "${id}"` }, { status: 404 });
  const kind = doc.spec?.trigger?.kind ?? "prompt";
  if (kind !== "api" && kind !== "webhook") {
    return Response.json(
      { error: `"${id}" is triggered by ${kind}, not by API. Set trigger.kind to "api" or "webhook" in the builder to expose it here.` },
      { status: 409 },
    );
  }

  const externalId = body.external_id ? String(body.external_id).slice(0, 200) : null;
  const jobId = randomUUID();
  const priority = Number.isFinite(body.priority) ? Math.max(0, Math.min(9, Number(body.priority))) : 5;
  const source = String(body.source ?? (auth.mode === "key" ? auth.key?.name ?? "api" : "api")).slice(0, 80);

  const inserted = await query<JobRow>(
    `INSERT INTO trigger_jobs (id, agent, external_id, source, input, model, priority)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (agent, external_id) WHERE external_id IS NOT NULL DO NOTHING
     RETURNING ${JOB_COLS}`,
    [jobId, id, externalId, source, JSON.stringify(input), body.model ?? "", priority],
  );

  let job: JobRow;
  let duplicate = false;
  let retried = false;
  if (inserted.length) {
    job = inserted[0];
  } else {
    const existing = await query<JobRow>(`SELECT ${JOB_COLS} FROM trigger_jobs WHERE agent = $1 AND external_id = $2`, [id, externalId]);
    if (!existing.length) return Response.json({ error: "could not enqueue" }, { status: 500 });
    job = existing[0];
    if (job.status === "failed") {
      // A failed job is not a delivered one. Posting the same id again is the
      // caller asking for another attempt, with whatever input it sends now.
      const requeued = await query<JobRow>(
        `UPDATE trigger_jobs SET status = 'queued', attempts = 0, error = NULL, result = NULL, run_id = NULL,
                input = $3, source = $4, priority = $5, started_at = NULL, finished_at = NULL, lease_until = NULL
         WHERE id = $1 AND agent = $2 RETURNING ${JOB_COLS}`,
        [job.id, id, JSON.stringify(input), source, priority],
      );
      job = requeued[0] ?? job;
      retried = true;
    } else {
      duplicate = true;
    }
  }

  if (body.wait && !["done", "failed", "suspended"].includes(job.status)) {
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      const rows = await query<JobRow>(`SELECT ${JOB_COLS} FROM trigger_jobs WHERE id = $1`, [job.id]);
      if (rows.length) job = rows[0];
      if (["done", "failed", "suspended"].includes(job.status)) break;
    }
  }

  const finished = ["done", "failed", "suspended"].includes(job.status);
  return Response.json(
    { ...jobView(id, job), duplicate, retried, auth: auth.mode, ...(body.wait && !finished ? { note: "still running after 120s; poll status_url" } : {}) },
    { status: duplicate || finished ? 200 : 202 },
  );
}
