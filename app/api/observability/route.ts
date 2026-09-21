import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { priceSheet } from "@/lib/server/prices";
import { toTrace, type Trace } from "@/lib/server/trace";
import { destination } from "@/lib/server/langfuse";

/**
 * Observability, computed from the journals this platform already writes.
 *
 * There is no separate telemetry pipeline and no agent SDK to install: a run
 * records what it did, and a trace is that record projected into spans. So the
 * numbers here cannot drift from the evidence, and a trace exists for every run
 * ever made — including the ones from before anybody thought to turn tracing on.
 *
 * `?run=<id>` returns one trace with its spans. Without it, the estate: recent
 * traces, latency distribution, where the time and the money actually go, and
 * what failed.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = path.resolve(process.cwd(), "..", "runtime");
const RUNS = path.join(ROOT, "workspace", "runs");

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const want = url.searchParams.get("run");
  const agentFilter = url.searchParams.get("agent") ?? "";
  const sheet = await priceSheet();

  let files: string[] = [];
  try {
    files = (await readdir(RUNS)).filter((f) => f.endsWith(".json"));
  } catch {
    return Response.json({ traces: [], error: "no run directory on this deployment" });
  }

  /* One trace, in full. */
  if (want) {
    if (!/^[A-Za-z0-9._-]+$/.test(want)) return Response.json({ error: "bad run id" }, { status: 400 });
    try {
      const full = path.join(RUNS, `${want}.json`);
      const [raw, st] = await Promise.all([readFile(full, "utf-8"), stat(full)]);
      const trace = toTrace(want, JSON.parse(raw), st.mtime.toISOString(), sheet);
      return Response.json({ trace, exporter: exporterState() });
    } catch {
      return Response.json({ error: `no recorded run "${want}"` }, { status: 404 });
    }
  }

  /* The estate. Traces are summarised; the spans stay behind the per-run read,
     because shipping every span of every run to draw a list is how an
     observability page becomes the slowest thing you own. */
  const summaries: (Omit<Trace, "spans"> & { spans: number })[] = [];
  for (const f of files) {
    try {
      const full = path.join(RUNS, f);
      const [raw, st] = await Promise.all([readFile(full, "utf-8"), stat(full)]);
      const doc = JSON.parse(raw);
      if (agentFilter && doc.system !== agentFilter) continue;
      const t = toTrace(f.replace(/\.json$/, ""), doc, st.mtime.toISOString(), sheet);
      const { spans, ...rest } = t;
      summaries.push({ ...rest, spans: spans.length });
    } catch {
      /* a run file that will not parse is not a trace */
    }
  }
  summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  const durations = summaries.map((t) => t.durationMs).sort((a, b) => a - b);
  const byModel = new Map<string, { calls: number; tokensIn: number; tokensOut: number; cost: number | null; ms: number }>();
  const byAgent = new Map<string, { runs: number; ms: number; cost: number | null; failed: number }>();

  for (const t of summaries) {
    const a = byAgent.get(t.agent) ?? { runs: 0, ms: 0, cost: 0 as number | null, failed: 0 };
    a.runs += 1;
    a.ms += t.durationMs;
    a.cost = a.cost === null || t.totals.cost === null ? null : a.cost + t.totals.cost;
    if (t.state === "failed") a.failed += 1;
    byAgent.set(t.agent, a);
  }

  /* Model mix needs the spans, so it is computed over the most recent window
     rather than the whole history — stated, not silently truncated. */
  const window = summaries.slice(0, 60);
  for (const s of window) {
    try {
      const raw = await readFile(path.join(RUNS, `${s.id}.json`), "utf-8");
      const t = toTrace(s.id, JSON.parse(raw), s.startedAt, sheet);
      for (const span of t.spans) {
        if (span.kind !== "generation") continue;
        const m = byModel.get(span.model ?? "") ?? { calls: 0, tokensIn: 0, tokensOut: 0, cost: 0 as number | null, ms: 0 };
        m.calls += 1;
        m.tokensIn += span.tokensIn ?? 0;
        m.tokensOut += span.tokensOut ?? 0;
        m.ms += span.duration;
        m.cost = m.cost === null || span.cost === null || span.cost === undefined ? null : m.cost + span.cost;
        byModel.set(span.model ?? "", m);
      }
    } catch {
      /* already counted in the summary */
    }
  }

  const states = summaries.reduce<Record<string, number>>((acc, t) => {
    acc[t.state] = (acc[t.state] ?? 0) + 1;
    return acc;
  }, {});

  return Response.json({
    traces: summaries.slice(0, 200),
    total: summaries.length,
    states,
    latency: {
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      p99: percentile(durations, 99),
      max: durations[durations.length - 1] ?? 0,
    },
    byModel: Object.fromEntries(byModel),
    byAgent: Object.fromEntries(byAgent),
    modelWindow: window.length,
    exporter: exporterState(),
    basis:
      "every figure is projected from the run journals; a trace exists for every run, including those made before tracing was added",
  });
}

function exporterState() {
  const to = destination();
  return {
    configured: Boolean(to),
    host: to?.host ?? "",
    protocol: "OTLP/HTTP JSON · OpenTelemetry GenAI conventions with Langfuse attribute mapping",
    missing: to
      ? []
      : ["LANGFUSE_HOST", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SECRET_KEY"].filter((k) => !process.env[k]),
  };
}
