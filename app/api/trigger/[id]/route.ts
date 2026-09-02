import { spawn } from "node:child_process";
import path from "node:path";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dbReady, query } from "@/lib/server/db";
import { registerRun } from "@/lib/server/active-runs";

/**
 * The API trigger, made real.
 *
 * A spec can declare `trigger.kind: api` or `webhook`, which means "another
 * system POSTs the input to this agent's endpoint". This is that endpoint.
 * An external system (a DLP console, a ticketing hook, an emulator standing in
 * for either) posts an input by agent id and gets the run's result back as
 * JSON. No spec in the body, no stream to parse, nothing the caller has to
 * know about the platform beyond the entry node's contract, which GET
 * describes.
 *
 * The run is a normal run: same runtime, same journal, same registry, visible
 * on the Runs page and counted by the control plane. Only the transport
 * differs from the builder's streaming route.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = path.resolve(process.cwd(), "..", "runtime");
const AGENTS = path.join(ROOT, "workspace", "agents");
const ID = /^[a-z][a-z0-9-]{0,62}$/;

interface SpecDoc {
  metadata?: { id?: string; name?: string };
  spec?: {
    entry?: string;
    trigger?: { kind?: string };
    nodes?: { id: string; expects?: { name: string; kind: string; required?: boolean; note?: string }[] }[];
  };
}

async function loadSpec(id: string): Promise<SpecDoc | null> {
  // The database is authoritative when it answers; the workspace file is the
  // same document written through, so a database that dropped after startup
  // degrades to the file rather than refusing an external system's alert.
  try {
    if (await dbReady()) {
      const rows = await query<{ spec: SpecDoc }>("SELECT spec FROM workflows WHERE id = $1", [id]);
      if (rows.length) return rows[0].spec;
    }
  } catch {
    /* fall through to the file */
  }
  try {
    return JSON.parse(await readFile(path.join(AGENTS, `${id}.json`), "utf-8"));
  } catch {
    return null;
  }
}

async function defaultModel(): Promise<string> {
  try {
    const c = JSON.parse(await readFile(path.join(ROOT, "workspace", "config.json"), "utf-8"));
    if (c?.default_model) return String(c.default_model);
  } catch {
    /* no config yet */
  }
  return process.env.AF_MODEL || "anthropic/claude-sonnet-4.5";
}

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
    usage: `POST /api/trigger/${id} with JSON {"input": {...}}`,
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID.test(id)) return Response.json({ error: "bad id" }, { status: 400 });

  let body: { input?: Record<string, unknown>; model?: string; source?: string };
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

  const dir = await mkdtemp(path.join(tmpdir(), "af-trigger-"));
  const specPath = path.join(dir, "spec.json");
  await writeFile(specPath, JSON.stringify(doc, null, 2));
  const runsDir = path.join(ROOT, "workspace", "runs");
  await mkdir(runsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const runId = `${id}-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
  const statePath = path.join(runsDir, `${runId}.json`);
  const model = body.model || (await defaultModel());
  const started = Date.now();

  const args = ["-m", "agentfactory", "run", "--spec", specPath, "--state", statePath,
    "--provider", "openrouter", "--model", model, "--input", JSON.stringify(input)];
  const child = spawn("python3", args, { cwd: ROOT, env: { ...process.env, PYTHONUNBUFFERED: "1" } });
  registerRun({ id: runId, system: id, startedAt: new Date().toISOString(), child });

  let stderr = "";
  child.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
  child.stdout.on("data", () => {}); // the journal is written to the state file; the caller gets the record

  const code = await new Promise<number | null>((resolve) => {
    child.on("close", resolve);
    child.on("error", () => resolve(-1));
  });

  let run: { state?: string; result?: unknown; error?: string; journal?: { entries?: { kind: string }[]; duration_ms?: number }; system?: string } | null = null;
  try {
    run = JSON.parse(await readFile(statePath, "utf-8"));
  } catch {
    run = null;
  }

  // Join the registry index, exactly as a builder-launched run does.
  try {
    if (run && (await dbReady())) {
      const entries = run.journal?.entries ?? [];
      await query(
        `INSERT INTO runs (id, system, state, summary, run, at) VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, summary = EXCLUDED.summary, run = EXCLUDED.run, at = now()`,
        [runId, run.system ?? id, run.state ?? "unknown", {
          duration_ms: run.journal?.duration_ms ?? Date.now() - started,
          entries: entries.length,
          model_calls: entries.filter((e) => e.kind === "model.call").length,
          tool_calls: entries.filter((e) => e.kind === "tool.call").length,
          denied: entries.filter((e) => e.kind === "denied" || e.kind === "contract.breach").length,
          source: body.source ?? "api",
        }, run],
      );
    }
  } catch {
    /* the state file remains the record */
  }

  if (!run) {
    return Response.json(
      { run_id: runId, state: "failed", error: stderr.trim().split("\n").slice(-6).join("\n") || `runtime exited ${code}` },
      { status: 500 },
    );
  }
  return Response.json({
    run_id: runId,
    agent: id,
    state: run.state ?? "unknown",
    result: run.result ?? null,
    error: run.error ?? null,
    duration_ms: Date.now() - started,
    journal_entries: run.journal?.entries?.length ?? 0,
    run_url: `/runs?id=${encodeURIComponent(runId)}`,
  });
}
