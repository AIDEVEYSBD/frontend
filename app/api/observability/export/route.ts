import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { priceSheet } from "@/lib/server/prices";
import { toTrace } from "@/lib/server/trace";
import { destination, send, toOtlp } from "@/lib/server/langfuse";

/**
 * A run, as OpenTelemetry.
 *
 * GET returns the OTLP/HTTP JSON body for one run — the exact payload we would
 * post to a collector, so anybody can read it before trusting it. POST sends it
 * to the configured destination and reports what came back, unedited. There is
 * no queue and no buffering: this is a projection of a record that already
 * exists, so a failed send loses nothing.
 *
 * The attributes follow the OpenTelemetry GenAI conventions plus Langfuse's
 * mapping namespace, which is what makes the same payload readable by Langfuse,
 * Azure Monitor, Grafana Tempo or anything else speaking OTLP.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = path.resolve(process.cwd(), "..", "runtime");
const RUNS = path.join(ROOT, "workspace", "runs");

async function build(runId: string) {
  const full = path.join(RUNS, `${runId}.json`);
  const [raw, st, sheet] = await Promise.all([readFile(full, "utf-8"), stat(full), priceSheet()]);
  const trace = toTrace(runId, JSON.parse(raw), st.mtime.toISOString(), sheet);
  return {
    trace,
    body: toOtlp(trace, {
      service: process.env.OTEL_SERVICE_NAME ?? "agent-factory",
      environment: process.env.OTEL_ENVIRONMENT ?? "production",
      release: process.env.OTEL_RELEASE ?? "",
    }),
  };
}

function runIdOf(req: Request): string | null {
  const id = new URL(req.url).searchParams.get("run") ?? "";
  return /^[A-Za-z0-9._-]+$/.test(id) ? id : null;
}

export async function GET(req: Request) {
  const runId = runIdOf(req);
  if (!runId) return Response.json({ error: "send ?run=<run id>" }, { status: 400 });
  try {
    const { body, trace } = await build(runId);
    return Response.json({
      run: runId,
      spans: trace.spans.length,
      destination: destination()?.host ?? null,
      otlp: body,
    });
  } catch {
    return Response.json({ error: `no recorded run "${runId}"` }, { status: 404 });
  }
}

export async function POST(req: Request) {
  let body: { run?: string; runs?: string[]; limit?: number };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const fromQuery = runIdOf(req);
  const targets = (body.run ? [body.run] : (body.runs ?? (fromQuery ? [fromQuery] : []))).filter((r) =>
    /^[A-Za-z0-9._-]+$/.test(r),
  );
  if (!targets.length) return Response.json({ error: 'send {"run": "<run id>"} or {"runs": [...]}' }, { status: 400 });

  const to = destination();
  if (!to) {
    return Response.json(
      {
        error:
          "no destination configured. Set LANGFUSE_HOST, LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY — any OTLP collector that accepts Basic auth will do.",
      },
      { status: 503 },
    );
  }

  const results: { run: string; ok: boolean; status: number; spans: number; detail: string }[] = [];
  for (const runId of targets.slice(0, Math.max(1, Math.min(100, body.limit ?? 25)))) {
    try {
      const { body: otlp, trace } = await build(runId);
      const sent = await send(otlp, to);
      results.push({ run: runId, ok: sent.ok, status: sent.status, spans: trace.spans.length, detail: sent.detail });
    } catch {
      results.push({ run: runId, ok: false, status: 0, spans: 0, detail: "no recorded run" });
    }
  }

  return Response.json({
    sent: results.filter((r) => r.ok).length,
    of: results.length,
    destination: to.host,
    results,
  });
}
