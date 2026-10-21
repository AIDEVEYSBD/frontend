import { permit } from "@/lib/server/auth";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { dbReady, query } from "@/lib/server/db";
import { grade, loadSet } from "@/lib/server/evals";
import { derive, emptyMatrix, tally } from "@/lib/metrics";
import { costOf, priceSheet, usageOf } from "@/lib/server/prices";
import { backendConfigured, backendError, backendFetch, backendMissing } from "@/lib/server/backend";
import { lockdownRefusalOf, lockdownRefusalText } from "@/lib/api/l5";
import { rateLimitOf, type RateLimit } from "@/lib/api/l7";
import { rateLimitText } from "@/lib/rate-limit";

/**
 * Run an eval set: every case is a REAL run of the agent — same runtime, same
 * journal, same policy engine — graded deterministically against the case's
 * checks. No mocked passes: a case's run appears in the run history like any
 * other, and the recorded result carries the spec digest it measured.
 *
 * Each case is started on the backend (`POST /api/runs`, backend/CONTRACT.md)
 * under the caller's own identity, so it sits under the budget gate and the
 * kill switch like any other run, and its record is read back from
 * `GET /api/runs/{id}` once the state settles. Grading stays here: the
 * checks, the confusion matrix and the comparison are the console's.
 *
 * Cases run sequentially. An eval is a measurement; measurements that race a
 * shared workspace measure the race.
 *
 * A start refused for a rate limit (429, phase L7: the agent's run starts
 * per minute, or the tree's) is not a failed case: the stream says so
 * (`rate_limited`, with the scope, the limit, the figures and the wait), the
 * runner waits the `Retry-After` the backend gave and starts the case
 * again, up to RATE_RETRIES times or RATE_WAIT_MS of waiting in all; only
 * then is the case recorded as refused, naming the limit.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONFIG = path.resolve(process.cwd(), "..", "runtime", "workspace", "config.json");

type ModelClass = "small" | "medium" | "large";
const TIERS: ModelClass[] = ["small", "medium", "large"];

interface DeployConfig {
  models: { id: string; label: string; class?: ModelClass }[];
  default_model: string;
  class_defaults?: Partial<Record<ModelClass, string>>;
}

async function deployConfig(): Promise<DeployConfig> {
  try {
    const raw = JSON.parse(await readFile(CONFIG, "utf-8"));
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

/* ── the runs, on the backend ── */

/** The run state as `GET /api/runs/{id}` answers it: what the grader reads. */
interface RunDoc {
  id?: string;
  state?: string;
  error?: string;
  result?: Record<string, unknown> | null;
  spec_digest?: string;
  journal?: { entries?: { kind: string; title?: string; data?: Record<string, unknown> }[]; duration_ms?: number };
}

/** A run that will not change again: the backend's terminal states, and a gate nobody will answer inside a benchmark. */
const SETTLED = new Set(["done", "failed", "killed", "closed", "suspended"]);

/** How long one case may take before it is recorded as unsettled. */
const CASE_DEADLINE_MS = 20 * 60_000;

/** How many times a case's start is retried after a rate limit, and how long the runner waits for them in all. */
const RATE_RETRIES = 5;
const RATE_WAIT_MS = 6 * 60_000;

type Node = Record<string, unknown>;

/**
 * Every node that calls a model pinned to one candidate, with tier routing
 * cleared, so the whole run measures that model and nothing routed around
 * it. This is what `--force-model` did for the CLI, expressed in the spec
 * the backend runs; `model` on `POST /api/runs` is only the run's default.
 */
function pinned(doc: Record<string, unknown>, model: string): Record<string, unknown> {
  const spec = (doc.spec ?? {}) as Record<string, unknown>;
  const nodes = Array.isArray(spec.nodes) ? (spec.nodes as Node[]) : [];
  return {
    ...doc,
    spec: {
      ...spec,
      nodes: nodes.map((n) => {
        const callsModel = n.harness === "delegate" || (Array.isArray(n.steps) && (n.steps as { action?: string }[]).some((s) => s.action === "model"));
        if (!callsModel) return n;
        const next: Node = { ...n, model };
        delete next.model_class;
        return next;
      }),
    },
  };
}

async function startRun(req: Request, body: Record<string, unknown>): Promise<{ id: string } | { error: string } | { limited: RateLimit }> {
  let res: Response;
  try {
    res = await backendFetch(req, "/api/runs", { method: "POST", body: JSON.stringify(body) });
  } catch (e) {
    return { error: `the backend could not be reached: ${(e as Error).message}` };
  }
  if (res.status === 429) {
    // A rate limit started nothing: the caller waits and starts the case again.
    const body = await res.json().catch(() => ({}));
    const limited = rateLimitOf(429, body, res.headers.get("retry-after"));
    if (limited) return { limited };
  }
  if (res.status === 423) {
    // A lockdown refuses every start; the case says why, as the run page does.
    const body = await res.json().catch(() => ({}));
    const locked = lockdownRefusalOf(423, body);
    return { error: locked ? lockdownRefusalText(locked) : String((body as { error?: unknown }).error ?? "the estate is locked down") };
  }
  if (!res.ok) return { error: await backendError(res, "the backend refused to start the run") };
  const d = (await res.json().catch(() => ({}))) as { run?: string };
  if (!d.run) return { error: "the backend started no run" };
  return { id: d.run };
}

/** Read the run back until its state settles; a missed poll is not a failed run. */
async function settle(req: Request, id: string): Promise<RunDoc | null> {
  const deadline = Date.now() + CASE_DEADLINE_MS;
  let last: RunDoc | null = null;
  for (;;) {
    try {
      const res = await backendFetch(req, `/api/runs/${encodeURIComponent(id)}`);
      if (res.ok) last = (await res.json()) as RunDoc;
    } catch {
      /* the next poll reads it */
    }
    if (last && SETTLED.has(String(last.state))) return last;
    if (Date.now() > deadline) return last;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

export async function POST(req: Request) {
  { const gate = await permit(req, "run"); if (gate) return gate; }
  let body: { set_id?: string; model?: string; compare?: { scope?: "class" | "below" | "all"; models?: string[] } };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "send { set_id }" }, { status: 400 });
  }
  if (!body.set_id) return Response.json({ error: "send { set_id }" }, { status: 400 });
  if (!backendConfigured()) return backendMissing();

  const set = await loadSet(body.set_id);
  if (!set) return Response.json({ error: `no eval set "${body.set_id}"` }, { status: 404 });

  // The agent must be in the registry; the backend's answer also carries
  // the document a comparison pins its candidates into.
  let agentDoc: Record<string, unknown>;
  try {
    const res = await backendFetch(req, `/api/agents/${encodeURIComponent(set.agent)}`);
    if (res.status === 404) return Response.json({ error: `agent "${set.agent}" is not in the registry` }, { status: 422 });
    if (!res.ok) return Response.json({ error: await backendError(res, "the backend could not read the agent") }, { status: 502 });
    agentDoc = ((await res.json()) as { spec?: Record<string, unknown> }).spec ?? {};
  } catch (e) {
    return Response.json({ error: `the backend could not be reached: ${(e as Error).message}` }, { status: 502 });
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

      // A case can run for minutes with nothing to say, and a proxy in front
      // of this (Cloudflare's edge cuts an idle response at 100s) will drop
      // the connection long before the first result. A comment line every
      // fifteen seconds keeps it open; SSE clients ignore it.
      const beat = setInterval(() => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          open = false;
        }
      }, 15_000);

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

        // A forced candidate travels as the pinned document; a plain run
        // names the deployed agent so the record carries its digest.
        const request: Record<string, unknown> =
          candidate.forced && model
            ? { spec: pinned(agentDoc, model), input: c.input, provider: "foundry", model }
            : { agent: set.agent, input: c.input, provider: "foundry", ...(model ? { model } : {}) };

        let runId = "";
        const outcome = await (async (): Promise<{ state: string; result: unknown; error: string }> => {
          let started = await startRun(req, request);
          let waited = 0;
          for (let attempt = 1; "limited" in started && attempt <= RATE_RETRIES && waited < RATE_WAIT_MS; attempt++) {
            const rl = started.limited;
            const wait = Math.min(rl.retry_after_s * 1000, RATE_WAIT_MS - waited);
            send({ type: "rate_limited", index: i, id: c.id, model: model || "default", attempt, of: RATE_RETRIES, wait_s: Math.ceil(wait / 1000), text: rateLimitText(rl), limit: rl });
            await new Promise((r) => setTimeout(r, wait));
            waited += wait;
            started = await startRun(req, request);
          }
          if ("limited" in started) return { state: "failed", result: null, error: `refused at the start, past ${RATE_RETRIES} retries: ${rateLimitText(started.limited)}` };
          if ("error" in started) return { state: "failed", result: null, error: started.error };
          runId = started.id;
          const run = await settle(req, runId);
          if (!run) return { state: "failed", result: null, error: `run ${runId} could not be read back from the backend` };
          if (!SETTLED.has(String(run.state))) {
            return { state: String(run.state ?? "unknown"), result: null, error: `run ${runId} did not settle within ${CASE_DEADLINE_MS / 60_000} minutes; it is still on the backend` };
          }
          digest = run.spec_digest ?? digest;
          const u = usageOf(run);
          tokensIn += u.tokens.in;
          tokensOut += u.tokens.out;
          modelCalls += u.calls;
          if (cost !== null) {
            let acc: number | null = cost;
            for (const [m, tk] of Object.entries(u.byModel)) {
              const price = costOf(m, tk, sheet);
              if (price === null || acc === null) {
                acc = null; // one unknown price makes the total unknown, never zero
                break;
              }
              acc += price;
            }
            cost = acc;
          }
          return { state: run.state ?? "unknown", result: run.result ?? null, error: run.error ?? "" };
        })();

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
          // The run's id on the backend: what the page links to under /runs.
          run_file: runId,
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
      clearInterval(beat);
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
