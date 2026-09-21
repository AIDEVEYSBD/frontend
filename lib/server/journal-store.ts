import { randomBytes } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dbReady, query } from "@/lib/server/db";

/**
 * Where a run record lands, for everything that is not the runtime itself.
 *
 * The runtime writes its own state files. The SDK ingest, the model gateway,
 * the tool broker and the A2A task door all produce journals too, and they
 * all land here: a file in the workspace, which is what the console reads,
 * and a row in the registry, which is what the control pane aggregates. One
 * writer, so a run reported through any door looks exactly like a run the
 * runtime made — which is the whole point of the journal being the contract.
 */

export const RUNS = path.resolve(process.cwd(), "..", "runtime", "workspace", "runs");

export interface Entry {
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

export interface RunRecord {
  id: string;
  system: string;
  spec_digest: string;
  state: string;
  values: Record<string, unknown>;
  skipped: string[];
  visits: Record<string, number>;
  suspension: Record<string, unknown> | null;
  error: string;
  result: Record<string, unknown>;
  journal: { run_id: string; system: string; spec_digest: string; duration_ms: number; entries: Entry[] };
  reported_by: { mode: string; door?: string; key?: string };
  answer?: Record<string, unknown>;
}

export const entryId = () => randomBytes(6).toString("hex");

export function entry(t: number, kind: string, node: string, title = "", detail = "", data: Record<string, unknown> = {}, tainted = false): Entry {
  return { t: Math.max(0, Math.round(t)), kind, node, title, detail, data, because: [], id: entryId(), tainted };
}

export function newRunId(agent: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `${agent}-${stamp}-${randomBytes(2).toString("hex")}`;
}

export function newRecord(agent: string, door: string, id = newRunId(agent), key?: string): RunRecord {
  const runId = id;
  return {
    id: runId,
    system: agent,
    spec_digest: door,
    state: "running",
    values: {},
    skipped: [],
    visits: {},
    suspension: null,
    error: "",
    result: {},
    journal: { run_id: runId, system: agent, spec_digest: door, duration_ms: 0, entries: [] },
    reported_by: { mode: "a2a", door, ...(key ? { key } : {}) },
  };
}

export async function readRecord(id: string): Promise<RunRecord | null> {
  try {
    return JSON.parse(await readFile(path.join(RUNS, `${id}.json`), "utf-8")) as RunRecord;
  } catch {
    return null;
  }
}

function summary(r: RunRecord, source: string) {
  const es = r.journal.entries;
  return {
    duration_ms: r.journal.duration_ms,
    entries: es.length,
    model_calls: es.filter((e) => e.kind === "model.call").length,
    tool_calls: es.filter((e) => e.kind === "tool.call").length,
    denied: es.filter((e) => e.kind === "denied" || e.kind === "contract.breach").length,
    source,
  };
}

/** Write the record: file first (the record of truth), then the registry row. */
export async function writeRecord(r: RunRecord, source = r.reported_by.door ?? r.reported_by.mode): Promise<void> {
  r.journal.duration_ms = r.journal.entries.length ? r.journal.entries[r.journal.entries.length - 1].t : 0;
  await mkdir(RUNS, { recursive: true });
  await writeFile(path.join(RUNS, `${r.id}.json`), JSON.stringify(r, null, 2));
  if (await dbReady()) {
    try {
      await query(
        `INSERT INTO runs (id, system, state, summary, run, at) VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, summary = EXCLUDED.summary, run = EXCLUDED.run, at = now()`,
        [r.id, r.system, r.state, JSON.stringify(summary(r, source)), JSON.stringify(r)],
      );
      await query("UPDATE attached_agents SET last_seen = now() WHERE id = $1", [r.system]);
    } catch {
      /* the file is the record either way */
    }
  }
}

/**
 * Append to an existing run of the same agent — a caller that names a run
 * (the `x-agentfactory-run` header) groups its calls into one record.
 * Returns null when the run is not this agent's, so nobody writes into
 * another agent's journal.
 */
export async function openForAppend(agent: string, runId: string): Promise<RunRecord | null> {
  const r = await readRecord(runId);
  if (!r || r.system !== agent) return null;
  if (r.state !== "running" && r.state !== "done") return null;
  // A finished run that receives more work is running again; the record says so.
  const es = r.journal.entries;
  if (es.length && es[es.length - 1].kind === "run.end") es.pop();
  r.state = "running";
  return r;
}
