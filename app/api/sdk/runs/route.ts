import { randomBytes } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dbReady, query } from "@/lib/server/db";
import { authenticate } from "@/lib/server/keys";

/**
 * A run, reported by an attached agent.
 *
 * The SDK sends the run record it assembled in-process — the same shape the
 * runtime writes for its own runs — and it lands in the same two places: a
 * file in the workspace and a row in the registry. From that moment the run
 * is on the control pane, replayable in the theater and counted by the
 * controls, because nothing downstream knows or cares where a journal came
 * from. Entries are normalised, never rewritten: a missing id gets one, a
 * missing clock gets the previous entry's, and that is the extent of it.
 *
 * A run may arrive more than once under the same id: once as `suspended`
 * when it reaches a gate, and again when it finishes. The later record
 * replaces the earlier one, and only the agent the run belongs to may
 * replace it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUNS = path.resolve(process.cwd(), "..", "runtime", "workspace", "runs");
const ID = /^[a-z][a-z0-9-]{0,62}$/;
const STATES = new Set(["running", "suspended", "done", "failed", "killed"]);

interface Entry {
  t: number;
  kind: string;
  node: string;
  title: string;
  detail: string;
  data: Record<string, unknown>;
  because: string[];
  id: string;
  tainted: boolean;
}

function normalise(raw: unknown, previous: number): Entry | null {
  if (!raw || typeof raw !== "object") return null;
  const e = raw as Record<string, unknown>;
  const kind = String(e.kind ?? "").trim();
  if (!kind) return null;
  return {
    t: Number.isFinite(Number(e.t)) ? Math.max(previous, Math.round(Number(e.t))) : previous,
    kind,
    node: String(e.node ?? ""),
    title: String(e.title ?? ""),
    detail: String(e.detail ?? ""),
    data: e.data && typeof e.data === "object" ? (e.data as Record<string, unknown>) : {},
    because: Array.isArray(e.because) ? e.because.map(String) : [],
    id: typeof e.id === "string" && e.id ? e.id : randomBytes(6).toString("hex"),
    tainted: Boolean(e.tainted),
  };
}

export async function POST(req: Request) {
  let body: { agent?: string; run?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected a JSON body: { agent, run }" }, { status: 400 });
  }
  const agent = String(body.agent ?? "");
  if (!ID.test(agent)) return Response.json({ error: "agent must be the attached agent's id" }, { status: 400 });
  const auth = await authenticate(req, agent);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });

  const run = body.run ?? {};
  const journal = (run.journal ?? {}) as { entries?: unknown[] };
  const entries: Entry[] = [];
  let clock = 0;
  for (const raw of journal.entries ?? []) {
    const e = normalise(raw, clock);
    if (!e) continue;
    clock = e.t;
    entries.push(e);
  }
  if (!entries.length) return Response.json({ error: "run.journal.entries is empty — a run with no record is not a run" }, { status: 400 });
  if (entries[0].kind !== "run.start") entries.unshift({ t: 0, kind: "run.start", node: "", title: agent, detail: "reported by the agent's SDK", data: { system: agent, spec_digest: "sdk" }, because: [], id: randomBytes(6).toString("hex"), tainted: false });
  const state = STATES.has(String(run.state)) ? String(run.state) : "done";
  const suspended = state === "suspended" && run.suspension && typeof run.suspension === "object";
  if (!suspended && state !== "running" && entries[entries.length - 1].kind !== "run.end") {
    entries.push({ t: clock, kind: "run.end", node: "", title: state, detail: "", data: { state }, because: [], id: randomBytes(6).toString("hex"), tainted: false });
  }

  // The SDK names its run so it can report the same run twice; the id must
  // carry the agent's own prefix, and an existing record must be this agent's.
  const own = typeof run.id === "string" && new RegExp(`^${agent}-[A-Za-z0-9._-]{1,80}$`).test(run.id) ? run.id : "";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runId = own || `${agent}-${stamp}-${randomBytes(2).toString("hex")}`;
  await mkdir(RUNS, { recursive: true });
  const file = path.join(RUNS, `${runId}.json`);
  let previous: { system?: string; answer?: unknown } | null = null;
  try {
    previous = JSON.parse(await readFile(file, "utf-8"));
  } catch {
    /* first report of this run */
  }
  if (previous && previous.system !== agent) return Response.json({ error: `run "${runId}" belongs to another agent` }, { status: 403 });

  const record = {
    id: runId,
    system: agent,
    spec_digest: "sdk",
    state,
    values: run.values && typeof run.values === "object" ? run.values : {},
    skipped: [],
    visits: {},
    suspension: null,
    error: String(run.error ?? ""),
    result: run.result && typeof run.result === "object" ? run.result : {},
    journal: { run_id: runId, system: agent, spec_digest: "sdk", duration_ms: clock, entries },
    reported_by: { mode: "sdk", key: auth.mode === "key" ? auth.key?.prefix : "open" },
    ...(suspended ? { suspension: run.suspension } : {}),
    // A gate answered in the console stays on the record across the agent's own reports.
    ...(previous?.answer && !suspended ? { answer: previous.answer } : {}),
  };

  await writeFile(file, JSON.stringify(record, null, 2));
  if (await dbReady()) {
    await query(
      `INSERT INTO runs (id, system, state, summary, run, at) VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, summary = EXCLUDED.summary, run = EXCLUDED.run, at = now()`,
      [
        runId,
        agent,
        state,
        {
          duration_ms: clock,
          entries: entries.length,
          model_calls: entries.filter((e) => e.kind === "model.call").length,
          tool_calls: entries.filter((e) => e.kind === "tool.call").length,
          denied: entries.filter((e) => e.kind === "denied" || e.kind === "contract.breach").length,
          source: "sdk",
        },
        record,
      ],
    );
    await query("UPDATE attached_agents SET last_seen = now() WHERE id = $1", [agent]).catch(() => {});
  }
  return Response.json({ run_id: runId, state, entries: entries.length, run_url: `/runs?id=${encodeURIComponent(runId)}` }, { status: 201 });
}
