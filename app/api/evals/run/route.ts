import { spawn } from "node:child_process";
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { dbReady, query } from "@/lib/server/db";
import { grade, loadSet } from "@/lib/server/evals";
import { registerRun } from "@/lib/server/active-runs";
import { derive, emptyMatrix, tally } from "@/lib/metrics";

/**
 * Run an eval set: every case is a REAL run of the agent — same runtime, same
 * journal, same policy engine — graded deterministically against the case's
 * checks. No mocked passes: a case's run appears in the run history like any
 * other, and the recorded result carries the spec digest it measured.
 *
 * Cases run sequentially. An eval is a measurement; measurements that race a
 * shared workspace measure the race.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = path.resolve(process.cwd(), "..", "runtime");

export async function POST(req: Request) {
  let body: { set_id?: string; model?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "send { set_id }" }, { status: 400 });
  }
  if (!body.set_id) return Response.json({ error: "send { set_id }" }, { status: 400 });

  const set = await loadSet(body.set_id);
  if (!set) return Response.json({ error: `no eval set "${body.set_id}"` }, { status: 404 });

  const specPath = path.join(ROOT, "workspace", "agents", `${set.agent}.json`);
  try {
    await readFile(specPath);
  } catch {
    return Response.json({ error: `agent "${set.agent}" is not in the registry` }, { status: 422 });
  }

  // Explicit request beats the set's own default beats the deployment default.
  const model = body.model || set.model || "";
  const runsDir = path.join(ROOT, "workspace", "runs");
  await mkdir(runsDir, { recursive: true });
  const evalRunId = `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (obj: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          open = false; // viewer left — keep running; results still persist
        }
      };

      send({ type: "opened", set: set.id, agent: set.agent, total: set.cases.length });

      const results: unknown[] = [];
      let passed = 0;
      let digest = "";
      // A labeled set accumulates the confusion matrix as it goes; every
      // metric is derived from these counts, never stored separately.
      const matrix = set.labels ? emptyMatrix(set.labels.space) : null;

      for (let i = 0; i < set.cases.length; i++) {
        const c = set.cases[i];
        const started = Date.now();
        send({ type: "case.start", index: i, id: c.id, note: c.note ?? "" });

        const statePath = path.join(runsDir, `${evalRunId}-${c.id}.json`);
        const args = [
          "-m", "agentfactory", "run",
          "--spec", specPath,
          "--state", statePath,
          "--provider", "openrouter",
          ...(model ? ["--model", model] : []),
          "--input", JSON.stringify(c.input),
        ];

        const outcome = await new Promise<{ state: string; result: unknown; error: string }>((resolve) => {
          const child = spawn("python3", args, { cwd: ROOT, env: { ...process.env, PYTHONUNBUFFERED: "1" } });
          registerRun({ id: `${evalRunId}-${c.id}`, system: set.agent, startedAt: new Date().toISOString(), child });
          let stderr = "";
          child.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
          child.stdout.on("data", () => {}); // journal streams to the state file; we grade the record
          child.on("close", async () => {
            try {
              const run = JSON.parse(await readFile(statePath, "utf-8"));
              digest = run?.spec_digest ?? digest;
              resolve({ state: run?.state ?? "unknown", result: run?.result ?? null, error: run?.error ?? "" });
            } catch {
              resolve({ state: "failed", result: null, error: stderr.trim().split("\n").slice(-3).join(" ") || "no state file" });
            }
          });
          child.on("error", (e) => resolve({ state: "failed", result: null, error: e.message }));
        });

        const labeled = set.labels && c.expected !== undefined ? { labels: set.labels, expected: c.expected } : undefined;
        const verdict = grade(c.checks, outcome.state, outcome.result, labeled);
        if (verdict.passed) passed += 1;
        if (matrix && labeled) tally(matrix, labeled.expected, verdict.predicted);
        const record = {
          id: c.id,
          note: c.note ?? "",
          passed: verdict.passed,
          state: outcome.state,
          error: outcome.error,
          checks: verdict.detail,
          ...(labeled ? { expected: labeled.expected, predicted: verdict.predicted } : {}),
          duration_ms: Date.now() - started,
          run_file: path.basename(statePath, ".json"),
        };
        results.push(record);
        send({ type: "case.done", index: i, ...record });
      }

      // The measurement is recorded whether anyone watched it or not.
      try {
        if (await dbReady()) {
          await query(
            `INSERT INTO eval_runs (id, set_id, agent, model, digest, passed, total, results, matrix)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              evalRunId, set.id, set.agent, model || "default", digest, passed, set.cases.length,
              JSON.stringify(results), matrix ? JSON.stringify(matrix) : null,
            ],
          );
        }
      } catch {
        /* the stream already carries the results */
      }

      send({
        type: "done",
        run_id: evalRunId,
        passed,
        total: set.cases.length,
        digest,
        ...(matrix ? { matrix, metrics: derive(matrix, set.labels?.positive) } : {}),
      });
      try {
        controller.close();
      } catch {
        /* closed by disconnect */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
