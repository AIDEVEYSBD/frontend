import { randomUUID } from "node:crypto";
import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { dbReady, query } from "@/lib/server/db";
import { authenticate } from "@/lib/server/keys";
import { ENDPOINTS, FRAMEWORKS } from "@/lib/attached";

/**
 * The A2A door: the factory as an agent other agents can hand work to.
 *
 *   tasks/send    a message names a workflow (metadata.workflow, or the
 *                 skill id from the card) and carries its input; the task
 *                 becomes a job on the trigger queue, exactly as an API
 *                 trigger would, and a worker runs it under the policy
 *                 engine with everything journalled
 *   tasks/get     the job's state in A2A terms, and the result as an
 *                 artifact once the run is done
 *   tasks/cancel  a queued task is withdrawn; a running one is not
 *
 * GET on any path describes the door. The factory's own card is at
 * /.well-known/agent.json and lists the deployed workflows as skills.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENTS = path.resolve(process.cwd(), "..", "runtime", "workspace", "agents");
const ID = /^[a-z][a-z0-9-]{0,62}$/;

interface Rpc { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> }
interface Part { type?: string; kind?: string; text?: string; data?: unknown }
interface JobRow extends Record<string, unknown> {
  id: string; agent: string; external_id: string | null; source: string; status: string; attempts: number;
  run_id: string | null; result: unknown; error: string | null; created_at: string; started_at: string | null; finished_at: string | null;
}
const JOB_COLS = "id, agent, external_id, source, status, attempts, run_id, result, error, created_at, started_at, finished_at";

const ok = (id: Rpc["id"], result: unknown) => Response.json({ jsonrpc: "2.0", id: id ?? null, result });
const fail = (id: Rpc["id"], code: number, message: string, status = 200) => Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } }, { status });

async function workflows(): Promise<{ id: string; name: string; trigger: string }[]> {
  const out: { id: string; name: string; trigger: string }[] = [];
  try {
    for (const f of (await readdir(AGENTS)).filter((f) => f.endsWith(".json"))) {
      try {
        const doc = JSON.parse(await readFile(path.join(AGENTS, f), "utf-8"));
        out.push({ id: String(doc?.metadata?.id ?? f.replace(/\.json$/, "")), name: String(doc?.metadata?.name ?? ""), trigger: String(doc?.spec?.trigger?.kind ?? "prompt") });
      } catch {
        /* skip a torn file */
      }
    }
  } catch {
    /* no registry yet */
  }
  return out;
}

/** A job, in A2A's vocabulary. */
function task(j: JobRow, sessionId?: string) {
  const state =
    j.status === "queued" ? "submitted"
    : j.status === "running" ? "working"
    : j.status === "suspended" ? "input-required"
    : j.status === "done" ? "completed"
    : j.status === "cancelled" ? "canceled"
    : "failed";
  const artifacts = j.status === "done" ? [{ name: "result", parts: [{ type: "data", data: j.result ?? {} }] }] : [];
  return {
    id: j.id,
    sessionId: sessionId ?? j.id,
    status: {
      state,
      timestamp: j.finished_at ?? j.started_at ?? j.created_at,
      ...(j.status === "failed" && j.error ? { message: { role: "agent", parts: [{ type: "text", text: j.error }] } } : {}),
      ...(j.status === "suspended" ? { message: { role: "agent", parts: [{ type: "text", text: "the run is waiting for a person at a gate; it continues when they answer on the control pane" }] } } : {}),
    },
    artifacts,
    metadata: { workflow: j.agent, run_id: j.run_id, status_url: `/api/trigger/${j.agent}/jobs/${j.id}`, run_url: j.run_id ? `/runs?id=${encodeURIComponent(j.run_id)}` : null },
  };
}

export async function GET(_req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path: p } = await ctx.params;
  const [door, ...rest] = p ?? [];
  if (door === "gateway") return Response.json({ door: "model gateway", url: ENDPOINTS.gateway, describe: `${ENDPOINTS.gateway}/chat/completions` });
  if (door === "mcp") return Response.json({ door: "tool broker", agent: rest[0] ?? "<agent>", url: ENDPOINTS.broker(rest[0] ?? "") });
  const wfs = await workflows();
  return Response.json({
    door: "tasks",
    url: ENDPOINTS.tasks,
    protocol: "A2A JSON-RPC 2.0: tasks/send, tasks/get, tasks/cancel",
    card: ENDPOINTS.card,
    auth: "Authorization: Bearer <api key> — any key while reading; a key scoped to the workflow to send it work (open until the first key is minted)",
    send: { method: "tasks/send", params: { id: "<your task id, optional>", message: { role: "user", parts: [{ type: "data", data: { "…": "the workflow's input" } }] }, metadata: { workflow: "<skill id>" } } },
    skills: wfs.map((w) => ({ id: w.id, name: w.name, trigger: w.trigger, accepts_tasks: w.trigger === "api" || w.trigger === "webhook" })),
    frameworks: FRAMEWORKS.filter((f) => f.a2aOnly).map((f) => f.label),
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path: p } = await ctx.params;
  if ((p ?? []).length) return Response.json({ error: "POST the tasks door at /api/a2a; the gateway and broker have their own paths" }, { status: 404 });
  let body: Rpc | Rpc[];
  try {
    body = await req.json();
  } catch {
    return fail(null, -32700, "parse error", 400);
  }
  if (Array.isArray(body)) return fail(null, -32600, "batch requests are not supported", 400);
  const { id, method, params = {} } = body;
  if (!method) return fail(id, -32600, "invalid request: method missing", 400);
  if (!(await dbReady())) return fail(id, -32000, "the registry database is unreachable; the queue needs it", 503);

  switch (method) {
    case "tasks/send": {
      const meta = (params.metadata ?? {}) as Record<string, unknown>;
      const wfs = await workflows();
      let workflow = String(meta.workflow ?? meta.skill ?? meta.skillId ?? "");
      if (!workflow) {
        const callable = wfs.filter((w) => w.trigger === "api" || w.trigger === "webhook");
        if (callable.length === 1) workflow = callable[0].id;
        else return fail(id, -32602, `name the workflow in metadata.workflow; skills that accept tasks: ${callable.map((w) => w.id).join(", ") || "none"}`);
      }
      if (!ID.test(workflow)) return fail(id, -32602, "bad workflow id");
      const wf = wfs.find((w) => w.id === workflow);
      if (!wf) return fail(id, -32602, `no workflow "${workflow}" on this deployment`);
      if (wf.trigger !== "api" && wf.trigger !== "webhook") return fail(id, -32602, `"${workflow}" is triggered by ${wf.trigger}, not by a task; set its trigger to api in the builder`);

      const auth = await authenticate(req, workflow);
      if (!auth.ok) return fail(id, -32000, auth.error, auth.status);

      const message = (params.message ?? {}) as { parts?: Part[] };
      const parts = Array.isArray(message.parts) ? message.parts : [];
      const data = parts.find((x) => (x.type ?? x.kind) === "data" && x.data && typeof x.data === "object")?.data as Record<string, unknown> | undefined;
      const text = parts.filter((x) => (x.type ?? x.kind) === "text" && typeof x.text === "string").map((x) => x.text).join("\n");
      const input: Record<string, unknown> = { ...(data ?? {}), ...(text && !data ? { text } : {}) };
      if (!Object.keys(input).length) return fail(id, -32602, "the message needs a data part with the workflow's input, or a text part");

      const externalId = params.id ? `a2a:${String(params.id).slice(0, 190)}` : null;
      const source = auth.mode === "key" ? `a2a · ${auth.key?.name ?? "key"}` : "a2a";
      const jobId = randomUUID();
      const inserted = await query<JobRow>(
        `INSERT INTO trigger_jobs (id, agent, external_id, source, input, model, priority)
         VALUES ($1, $2, $3, $4, $5, '', 5)
         ON CONFLICT (agent, external_id) WHERE external_id IS NOT NULL DO NOTHING
         RETURNING ${JOB_COLS}`,
        [jobId, workflow, externalId, source, JSON.stringify(input)],
      );
      let job = inserted[0];
      if (!job) {
        const existing = await query<JobRow>(`SELECT ${JOB_COLS} FROM trigger_jobs WHERE agent = $1 AND external_id = $2`, [workflow, externalId]);
        if (!existing.length) return fail(id, -32000, "could not enqueue");
        job = existing[0];
      }
      return ok(id, task(job, params.sessionId ? String(params.sessionId) : undefined));
    }
    case "tasks/get": {
      const taskId = String(params.id ?? "");
      if (!/^[a-zA-Z0-9-]{1,64}$/.test(taskId)) return fail(id, -32602, "bad task id");
      const rows = await query<JobRow>(`SELECT ${JOB_COLS} FROM trigger_jobs WHERE id = $1`, [taskId]);
      if (!rows.length) return fail(id, -32001, `no task "${taskId}"`);
      const auth = await authenticate(req, rows[0].agent);
      if (!auth.ok) return fail(id, -32000, auth.error, auth.status);
      return ok(id, task(rows[0]));
    }
    case "tasks/cancel": {
      const taskId = String(params.id ?? "");
      if (!/^[a-zA-Z0-9-]{1,64}$/.test(taskId)) return fail(id, -32602, "bad task id");
      const rows = await query<JobRow>(`SELECT ${JOB_COLS} FROM trigger_jobs WHERE id = $1`, [taskId]);
      if (!rows.length) return fail(id, -32001, `no task "${taskId}"`);
      const auth = await authenticate(req, rows[0].agent);
      if (!auth.ok) return fail(id, -32000, auth.error, auth.status);
      if (rows[0].status !== "queued") return fail(id, -32002, `task is ${rows[0].status}; only a queued task can be canceled`);
      const updated = await query<JobRow>(`UPDATE trigger_jobs SET status = 'cancelled', error = 'canceled by the caller over A2A', finished_at = now() WHERE id = $1 AND status = 'queued' RETURNING ${JOB_COLS}`, [taskId]);
      return ok(id, task(updated[0] ?? rows[0]));
    }
    default:
      return fail(id, -32601, `method not found: ${method}`);
  }
}
