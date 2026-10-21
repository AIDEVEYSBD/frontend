import { permit, session as whoIs, signer, ssoEnabled } from "@/lib/server/auth";
import path from "node:path";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dbReady, query } from "@/lib/server/db";
import { authenticate } from "@/lib/server/keys";
import { backendConfigured, backendFetch, backendMissing } from "@/lib/server/backend";

/**
 * Human gates, answered over the API.
 *
 * A run that reaches an `await` node stops and exposes an interface: who may
 * answer, what they are being asked, and what happens if nobody does. Until
 * somebody answers, the run is suspended and its queue job is parked — which
 * is the point of the control, not a defect.
 *
 * GET lists what is waiting and what each run has decided so far; POST
 * approves or refuses. A runtime run is resumed by the backend
 * (`POST /api/runs/{id}/resume`, backend/CONTRACT.md): this route forwards
 * the answer with the caller's own credentials, so the backend signs it with
 * the same identity the console saw and `by` is never typed. A run an
 * attached agent reported over the SDK has no spec to resume; its answer is
 * written onto the record for the agent to pick up. deploy/vm/hil.py and the
 * ApproveDialog both post here with the same body as before.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = path.resolve(process.cwd(), "..", "runtime");
const RUNS = path.join(ROOT, "workspace", "runs");

interface JournalEntry { kind: string; node?: string; title?: string; detail?: string; data?: Record<string, unknown> }
interface RunDoc {
  id?: string;
  system?: string;
  state?: string;
  error?: string;
  result?: Record<string, unknown>;
  suspension?: {
    kind?: string;
    node?: string;
    approvers?: string[];
    prompt?: string;
    timeout_s?: number;
    on_timeout?: string;
    resume?: Record<string, unknown>;
  };
  journal?: { entries?: JournalEntry[]; duration_ms?: number };
  /** Set on a run an attached agent reported over the SDK; there is no spec to resume. */
  reported_by?: { mode?: string };
  answer?: Record<string, unknown>;
}

/**
 * What the gate is being asked to sign off. A person answering needs the
 * decision and the reasoning under it, not the whole journal — so this is the
 * last thing the run emitted before it stopped, trimmed.
 */
function contextOf(run: RunDoc): Record<string, unknown> {
  const entries = run.journal?.entries ?? [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.kind !== "node.exit") continue;
    const emitted = (e.data?.emitted ?? {}) as Record<string, unknown>;
    const keep: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(emitted)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") keep[k] = v;
    }
    if (Object.keys(keep).length) return keep;
  }
  return {};
}

async function pending(agent?: string): Promise<Record<string, unknown>[]> {
  await mkdir(RUNS, { recursive: true });
  const out = new Map<string, Record<string, unknown>>();

  const add = async (id: string, run: RunDoc, at: string) => {
    if (run.state !== "suspended" || !run.suspension) return;
    if (agent && run.system !== agent) return;
    out.set(id, {
      run: id,
      agent: run.system ?? "",
      node: run.suspension.node ?? "",
      kind: run.suspension.kind ?? "approval",
      asks: run.suspension.prompt ?? "",
      approvers: run.suspension.approvers ?? [],
      timeout_s: run.suspension.timeout_s ?? null,
      on_timeout: run.suspension.on_timeout ?? "",
      waiting_since: at,
      decided: contextOf(run),
    });
  };

  // The state files are what the runtime resumes from, so they are the list.
  const files = (await readdir(RUNS).catch(() => [])).filter((f) => f.endsWith(".json"));
  for (const f of files) {
    try {
      const full = path.join(RUNS, f);
      const [raw, st] = await Promise.all([readFile(full, "utf-8"), stat(full)]);
      await add(path.basename(f, ".json"), JSON.parse(raw) as RunDoc, st.mtime.toISOString());
    } catch {
      /* a half-written run file is not an approval */
    }
  }

  // Queue jobs know which caller is still waiting on an answer.
  if (await dbReady()) {
    try {
      const rows = await query<{ id: string; run_id: string; external_id: string | null; source: string }>(
        "SELECT id, run_id, external_id, source FROM trigger_jobs WHERE status = 'suspended' AND run_id IS NOT NULL",
      );
      for (const r of rows) {
        const item = out.get(r.run_id);
        if (item) item.job = { id: r.id, external_id: r.external_id, source: r.source };
      }
    } catch {
      /* the queue is optional context, never the reason a gate cannot be answered */
    }
  }

  return [...out.values()].sort((a, b) => String(a.waiting_since).localeCompare(String(b.waiting_since)));
}

export async function GET(req: Request) {
  { const gate = await permit(req, "view"); if (gate) return gate; }
  const url = new URL(req.url);
  const agent = url.searchParams.get("agent") ?? undefined;
  const items = await pending(agent);
  return Response.json({
    pending: items,
    count: items.length,
    how: 'POST {"run": "<run id>", "approved": true, "by": "you@ey.com", "note": "why"} to answer one. '
      + 'POST {"agent": "<id>", "all": true, "approved": ..., "by": ...} to answer every gate waiting for that agent.',
  });
}

/** Deliver one answer to an SDK-reported run: onto the record, for the agent to pick up. */
async function answerSdk(
  runId: string,
  statePath: string,
  run: RunDoc,
  answer: { approved: boolean; by: string; note: string },
): Promise<Record<string, unknown>> {
  const at = new Date().toISOString();
  const entries = run.journal?.entries ?? [];
  const last = entries.length ? Number((entries[entries.length - 1] as { t?: number }).t ?? 0) : 0;
  entries.push({
    kind: "gate.answer",
    node: run.suspension?.node ?? "",
    title: `${answer.approved ? "Approved" : "Refused"} by ${answer.by}`,
    detail: answer.note,
    data: { approved: answer.approved, by: answer.by, note: answer.note, at, delivered: "to the agent's SDK" },
    ...({ t: last, id: Math.random().toString(16).slice(2, 14), because: [], tainted: false } as object),
  } as JournalEntry);
  const after: RunDoc = {
    ...run,
    // Running again from the agent's side; its next report settles the state.
    // A refusal is final either way, so the record closes on it here.
    state: answer.approved ? "running" : "failed",
    error: answer.approved ? "" : `Gate refused by ${answer.by}${answer.note ? `: ${answer.note}` : ""}`,
    answer: { ...answer, at },
    journal: { ...(run.journal ?? {}), entries },
  };
  try {
    await writeFile(statePath, JSON.stringify(after, null, 2));
  } catch (e) {
    return { run: runId, ok: false, error: `could not write the answer: ${(e as Error).message}` };
  }
  if (await dbReady()) {
    try {
      await query(
        `INSERT INTO runs (id, system, state, summary, run, at) VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, summary = EXCLUDED.summary, run = EXCLUDED.run, at = now()`,
        [
          runId,
          after.system ?? "",
          after.state ?? "running",
          JSON.stringify({
            duration_ms: after.journal?.duration_ms ?? last,
            entries: entries.length,
            model_calls: entries.filter((e) => e.kind === "model.call").length,
            tool_calls: entries.filter((e) => e.kind === "tool.call").length,
            denied: entries.filter((e) => e.kind === "denied" || e.kind === "contract.breach").length,
            source: `sdk · approval by ${answer.by}`,
          }),
          JSON.stringify(after),
        ],
      );
    } catch {
      /* the state file carries the answer either way */
    }
  }
  return { run: runId, ok: true, state: after.state, error: after.error ?? "", result: null, delivered: "the agent's SDK is polling for this answer" };
}

/** The backend's refusal when the workflow's spec moved after the run suspended. */
const STALE_SPEC = /different version of the spec/i;

/**
 * A gate the backend will not resume because the spec changed still received
 * an answer, and a decision somebody signed must not evaporate. The run is
 * closed with the decision on it rather than left waiting for a resume that
 * can never happen: the record says who answered, what, and why it could not
 * go on.
 */
async function closeAtGate(
  runId: string,
  statePath: string,
  run: RunDoc,
  answer: { approved: boolean; by: string; note: string },
  why: string,
): Promise<RunDoc> {
  const at = new Date().toISOString();
  const closed: RunDoc & Record<string, unknown> = {
    ...run,
    state: "closed",
    error: `Gate ${answer.approved ? "approved" : "refused"} by ${answer.by}; the run could not continue (${why}). Closed at the gate.`,
    answer: { ...answer, at, continued: false },
  };
  const entries = closed.journal?.entries ?? [];
  entries.push({
    kind: "gate.answer",
    node: run.suspension?.node ?? "",
    title: `${answer.approved ? "Approved" : "Refused"} by ${answer.by}`,
    detail: answer.note || why,
    data: { approved: answer.approved, by: answer.by, note: answer.note, at, continued: false, reason: why },
  });
  closed.journal = { ...(closed.journal ?? {}), entries };
  try {
    await writeFile(statePath, JSON.stringify(closed, null, 2));
  } catch {
    return run;
  }
  if (await dbReady()) {
    try {
      await query(
        `INSERT INTO runs (id, system, state, summary, run, at) VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, summary = EXCLUDED.summary, run = EXCLUDED.run, at = now()`,
        [
          runId,
          closed.system ?? "",
          "closed",
          JSON.stringify({
            duration_ms: closed.journal?.duration_ms ?? 0,
            entries: entries.length,
            model_calls: entries.filter((e) => e.kind === "model.call").length,
            tool_calls: entries.filter((e) => e.kind === "tool.call").length,
            denied: entries.filter((e) => e.kind === "denied" || e.kind === "contract.breach").length,
            source: `approval by ${answer.by}`,
          }),
          JSON.stringify(closed),
        ],
      );
      await query(
        `UPDATE trigger_jobs SET status = 'failed', error = $2, finished_at = now() WHERE run_id = $1 AND status = 'suspended'`,
        [runId, closed.error ?? ""],
      );
    } catch {
      /* the run itself is recorded in its state file either way */
    }
  }
  return closed;
}

/** Deliver one answer and report what the run did next. */
async function answerOne(
  req: Request,
  runId: string,
  answer: { approved: boolean; by: string; note: string },
): Promise<Record<string, unknown>> {
  const statePath = path.join(RUNS, `${runId}.json`);
  let run: RunDoc;
  try {
    run = JSON.parse(await readFile(statePath, "utf-8")) as RunDoc;
  } catch {
    return { run: runId, ok: false, error: "no run state on this deployment to resume" };
  }
  if (run.state !== "suspended") return { run: runId, ok: false, error: `run is ${run.state}, not suspended` };

  // A run an attached agent reported over the SDK, or one the tool broker holds
  // open at a gate, has no spec here to resume.
  // The answer is written onto the record, signed; the agent's own process,
  // which is polling for it, reads it and carries on — or stops, on a refusal.
  if (run.reported_by?.mode === "sdk" || run.reported_by?.mode === "a2a") return answerSdk(runId, statePath, run, answer);

  // Everything else resumes on the backend, under the caller's own identity;
  // the backend writes `by` from that identity, never from this body.
  let res: Response;
  try {
    res = await backendFetch(req, `/api/runs/${encodeURIComponent(runId)}/resume`, {
      method: "POST",
      body: JSON.stringify({ answer: { approved: answer.approved }, note: answer.note }),
    });
  } catch (e) {
    return { run: runId, ok: false, state: "suspended", error: `the backend could not be reached: ${(e as Error).message}` };
  }
  const body = (await res.json().catch(() => ({}))) as { run?: string; state?: string; error?: string };
  if (res.ok) {
    return {
      run: runId,
      ok: true,
      state: body.state ?? "running",
      error: "",
      result: null,
      continuing: true,
      delivered: "the backend resumed the run; its state settles as it runs",
    };
  }
  const why = String(body.error ?? `the backend answered ${res.status}`);
  if (res.status === 409 && STALE_SPEC.test(why)) {
    const closed = await closeAtGate(runId, statePath, run, answer, why);
    return { run: runId, ok: false, state: closed.state ?? "suspended", error: closed.error || why, result: null };
  }
  return { run: runId, ok: false, state: run.state, error: why, result: null };
}

export async function POST(req: Request) {
  { const gate = await permit(req, "approve"); if (gate) return gate; }
  let body: {
    run?: string;
    runs?: string[];
    all?: boolean;
    agent?: string;
    approved?: boolean;
    by?: string;
    note?: string;
    limit?: number;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'expected {"run": "<id>", "approved": true, "by": "you@ey.com"}' }, { status: 400 });
  }

  if (typeof body.approved !== "boolean") {
    return Response.json({ error: "send approved: true or approved: false — a gate is not answered by silence" }, { status: 400 });
  }
  if (!backendConfigured()) return backendMissing();
  // With sign-in on, the record carries the SSO identity, never a typed name.
  // The backend signs a resumed run from the forwarded credentials itself;
  // this `by` is what an SDK record gets and what the response reports.
  const me = await whoIs(req);
  const by = ssoEnabled() && me && me.mode === "sso" ? signer(me) : String(body.by ?? "").trim();
  if (!by) {
    return Response.json({ error: "send by: who is answering. An approval nobody signed is not an approval." }, { status: 400 });
  }
  const note = String(body.note ?? "").slice(0, 2000);

  let targets: string[] = [];
  if (body.run) targets = [String(body.run)];
  else if (Array.isArray(body.runs) && body.runs.length) targets = body.runs.map(String);
  else if (body.all) {
    if (!body.agent) return Response.json({ error: "answering every waiting gate needs an explicit agent" }, { status: 400 });
    const items = await pending(String(body.agent));
    targets = items.map((i) => String(i.run));
  } else {
    return Response.json({ error: "name a run, a list of runs, or all: true with an agent" }, { status: 400 });
  }
  if (!targets.every((t) => /^[a-zA-Z0-9._-]+$/.test(t))) {
    return Response.json({ error: "bad run id" }, { status: 400 });
  }
  const limit = Math.max(1, Math.min(200, Number(body.limit ?? 50)));
  const capped = targets.slice(0, limit);

  // A key is honoured when one is presented, and scoped to the agent whose
  // gate is being answered, so an integration cannot sign off another
  // workflow's decisions. It is not *required*, because the console has no
  // key to present: a person answering from the screen is admitted by the
  // "approve" permission checked above, and what carries the accountability
  // is the signature — `by` is mandatory and lands in the run record.
  const presented = Boolean(
    req.headers.get("authorization") || req.headers.get("x-api-key"),
  );
  let agentForAuth = body.agent ?? "";
  if (!agentForAuth && capped.length) {
    try {
      const first = JSON.parse(await readFile(path.join(RUNS, `${capped[0]}.json`), "utf-8")) as RunDoc;
      agentForAuth = first.system ?? "";
    } catch {
      /* the run is missing; answerOne reports that per run */
    }
  }
  if (presented) {
    const auth = await authenticate(req, agentForAuth);
    if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  }

  const answer = { approved: body.approved, by, note };
  const results: Record<string, unknown>[] = [];
  for (const runId of capped) results.push(await answerOne(req, runId, answer));

  return Response.json({
    answered: results.filter((r) => r.ok).length,
    of: capped.length,
    remaining: targets.length - capped.length,
    approved: body.approved,
    by,
    results,
  });
}
