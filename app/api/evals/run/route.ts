import { spawn } from "node:child_process";
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { dbReady, query } from "@/lib/server/db";
import { grade, loadSet } from "@/lib/server/evals";
import { registerRun } from "@/lib/server/active-runs";
import { derive, emptyMatrix, tally } from "@/lib/metrics";
import { costOf, priceSheet, usageOf } from "@/lib/server/prices";

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

type ModelClass = "small" | "medium" | "large";
const TIERS: ModelClass[] = ["small", "medium", "large"];

interface DeployConfig {
  models: { id: string; label: string; class?: ModelClass }[];
  default_model: string;
  class_defaults?: Partial<Record<ModelClass, string>>;
}

async function deployConfig(): Promise<DeployConfig> {
  try {
    const raw = JSON.parse(await readFile(path.join(ROOT, "workspace", "config.json"), "utf-8"));
    if (Array.isArray(raw.models)) return raw;
  } catch {
    /* no config yet */
  }
  return { models: [], default_model: "" };
}

/**
 * The candidate models for a comparison. The incumbent is the model the
 * benchmark runs on today; its tier anchors the scope: the same tier ("can
 * another model of this size do it?"), one tier below ("can something
 * cheaper do it?"), or everything offered. Models with no tier are only
 * candidates under "all".
 */
function candidates(cfg: DeployConfig, incumbent: string, scope: "class" | "below" | "all", explicit?: string[]): string[] {
  if (explicit?.length) return [...new Set([incumbent, ...explicit].filter(Boolean))];
  const tierOf = (id: string) => cfg.models.find((m) => m.id === id)?.class;
  const t = tierOf(incumbent);
  const pick = (tiers: ModelClass[]) => cfg.models.filter((m) => m.class && tiers.includes(m.class)).map((m) => m.id);
  let list: string[];
  if (scope === "all" || !t) list = cfg.models.map((m) => m.id);
  else if (scope === "below") list = pick([t, ...(TIERS.indexOf(t) > 0 ? [TIERS[TIERS.indexOf(t) - 1]] : [])]);
  else list = pick([t]);
  return [...new Set([incumbent, ...list].filter(Boolean))];
}

export async function POST(req: Request) {
  let body: { set_id?: string; model?: string; compare?: { scope?: "class" | "below" | "all"; models?: string[] } };
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
  const cfg = await deployConfig();
  const model = body.model || set.model || "";
  const incumbent = model || cfg.default_model || "";
  // A comparison pins every model call to one candidate, so what is measured
  // is that model and nothing routed around it. A plain run leaves routing
  // alone: it measures the agent as configured.
  const models: { id: string; forced: boolean }[] = body.compare
    ? candidates(cfg, incumbent, body.compare.scope ?? "class", body.compare.models).map((id) => ({ id, forced: true }))
    : [{ id: model, forced: false }];
  const sheet = body.compare ? await priceSheet() : null;
  const runsDir = path.join(ROOT, "workspace", "runs");
  await mkdir(runsDir, { recursive: true });
  const batchId = `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
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

      send({
        type: "opened", set: set.id, agent: set.agent, total: set.cases.length,
        models: models.map((m) => m.id || "default"), compare: Boolean(body.compare),
      });

      const summaries: Record<string, unknown>[] = [];
      for (const candidate of models) {
      const model = candidate.id;
      const evalRunId = models.length > 1 ? `${batchId}-${model.replace(/[^a-z0-9]+/gi, "-").slice(-24)}` : batchId;
      send({ type: "model.start", model: model || "default", forced: candidate.forced, run_id: evalRunId });
      const results: unknown[] = [];
      let passed = 0;
      let digest = "";
      let tokensIn = 0;
      let tokensOut = 0;
      let modelCalls = 0;
      let cost: number | null = 0;
      let msTotal = 0;
      // A labeled set accumulates the confusion matrix as it goes; every
      // metric is derived from these counts, never stored separately.
      const matrix = set.labels ? emptyMatrix(set.labels.space) : null;

      for (let i = 0; i < set.cases.length; i++) {
        const c = set.cases[i];
        const started = Date.now();
        send({ type: "case.start", index: i, id: c.id, note: c.note ?? "", model: model || "default" });

        const statePath = path.join(runsDir, `${evalRunId}-${c.id}.json`);
        const args = [
          "-m", "agentfactory", "run",
          "--spec", specPath,
          "--state", statePath,
          "--provider", "openrouter",
          ...(model ? ["--model", model] : []),
          ...(candidate.forced && model ? ["--force-model", model] : []),
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
              const u = usageOf(run);
              tokensIn += u.tokens.in;
              tokensOut += u.tokens.out;
              modelCalls += u.calls;
              if (cost !== null) {
                let acc: number | null = cost;
                for (const [m, tk] of Object.entries(u.byModel)) {
                  const c = costOf(m, tk, sheet);
                  if (c === null || acc === null) {
                    acc = null; // one unknown price makes the total unknown, never zero
                    break;
                  }
                  acc += c;
                }
                cost = acc;
              }
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
        msTotal += record.duration_ms;
        results.push(record);
        send({ type: "case.done", index: i, model: model || "default", ...record });
      }

      // The measurement is recorded whether anyone watched it or not.
      try {
        if (await dbReady()) {
          await query(
            `INSERT INTO eval_runs (id, set_id, agent, model, digest, passed, total, results, matrix, summary)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              evalRunId, set.id, set.agent, model || "default", digest, passed, set.cases.length,
              JSON.stringify(results), matrix ? JSON.stringify(matrix) : null,
              JSON.stringify({
                batch_id: batchId, forced: candidate.forced, compare: Boolean(body.compare),
                tier: cfg.models.find((m) => m.id === model)?.class ?? null,
                avg_ms: Math.round(msTotal / Math.max(1, set.cases.length)),
                tokens: { in: tokensIn, out: tokensOut }, model_calls: modelCalls,
                cost_total: cost, cost_per_case: cost === null ? null : cost / Math.max(1, set.cases.length),
                incumbent: incumbent || "default",
              }),
            ],
          );
        }
      } catch {
        /* the stream already carries the results */
      }

      const metrics = matrix ? derive(matrix, set.labels?.positive) : null;
      const summary = {
        model: model || "default",
        forced: candidate.forced,
        tier: cfg.models.find((m) => m.id === model)?.class ?? null,
        run_id: evalRunId,
        passed,
        total: set.cases.length,
        pass_rate: passed / Math.max(1, set.cases.length),
        headline_f1: metrics?.headlineF1 ?? null,
        macro_f1: metrics?.macroF1 ?? null,
        invalid: metrics?.invalid ?? 0,
        avg_ms: Math.round(msTotal / Math.max(1, set.cases.length)),
        tokens: { in: tokensIn, out: tokensOut },
        model_calls: modelCalls,
        cost_total: cost,
        cost_per_case: cost === null ? null : cost / Math.max(1, set.cases.length),
        ...(matrix ? { matrix, metrics } : {}),
      };
      summaries.push(summary);
      send({ type: "done", ...summary, digest });
      }

      if (models.length > 1) {
        // The recommendation: the cheapest candidate that clears the
        // incumbent's quality within a small margin and produced no invalid
        // outputs. Expressed as deltas, because that is what a person
        // deciding a switch actually weighs.
        const score = (x: Record<string, unknown>) => (x.headline_f1 as number | null) ?? (x.pass_rate as number);
        const inc = summaries.find((x) => x.model === (incumbent || "default")) ?? summaries[0];
        const floor = score(inc) - 0.02;
        const eligible = summaries.filter((x) => score(x) >= floor && (x.invalid as number) === 0 && x.cost_per_case !== null);
        eligible.sort((a, b) => (a.cost_per_case as number) - (b.cost_per_case as number) || (a.avg_ms as number) - (b.avg_ms as number));
        const best = eligible[0] ?? null;
        send({
          type: "compare",
          batch_id: batchId,
          incumbent: inc.model,
          models: summaries,
          recommended: best ? best.model : null,
          rationale: best
            ? best.model === inc.model
              ? "The incumbent is already the cheapest model that clears the bar."
              : `${best.model} clears the incumbent's quality within 0.02 at ${inc.cost_per_case && best.cost_per_case !== null ? Math.round((1 - (best.cost_per_case as number) / (inc.cost_per_case as number)) * 100) : "?"}% lower cost per case.`
            : "No candidate cleared the incumbent's quality with a known cost; keep the incumbent.",
        });
      }
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
