import type { Span, Trace } from "@/lib/server/trace";

/**
 * Traces, in the shape Langfuse reads.
 *
 * Langfuse ingests OpenTelemetry over HTTP at `/api/public/otel/v1/traces`,
 * authenticated with Basic auth over the project's public and secret keys, and
 * maps spans onto its own model through two attribute namespaces: `langfuse.*`
 * for the things only it has (observation type, level, cost details) and the
 * OpenTelemetry GenAI conventions `gen_ai.*` for model, tokens and parameters.
 * A span carrying `gen_ai.*` becomes a generation; everything else nests around
 * it as an observation.
 *
 * We emit exactly that, from our own journal, which is what lets us say this is
 * Langfuse-compatible and then show somebody the payload. The same conventions
 * are read by Azure Monitor, Grafana Tempo and anything else that speaks OTLP,
 * so the claim is not a lock-in either — it is the standard, with Langfuse's
 * extensions where the standard has no opinion.
 *
 * Nothing here is a second source of truth. The journal remains the record;
 * this is a projection of it, sent on request.
 */

const OBSERVATION_TYPE: Record<Span["kind"], string> = {
  trace: "span",
  agent: "agent",
  generation: "generation",
  tool: "tool",
  guardrail: "guardrail",
  event: "event",
};

type AttrValue = { stringValue: string } | { intValue: string } | { doubleValue: number } | { boolValue: boolean };

function attr(key: string, value: string | number | boolean): { key: string; value: AttrValue } {
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { key, value: { intValue: String(value) } }
      : { key, value: { doubleValue: value } };
  }
  return { key, value: { stringValue: value } };
}

/** Hex ids of the width OTLP requires: 16 bytes for a trace, 8 for a span. */
function hex(seed: string, bytes: number): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < seed.length; i++) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + seed.charCodeAt(i) + i, 0x85ebca6b) >>> 0;
  }
  let out = "";
  let a = h1;
  let b = h2;
  while (out.length < bytes * 2) {
    a = Math.imul(a ^ (a >>> 15), 0x2545f491) >>> 0;
    b = Math.imul(b ^ (b >>> 13), 0x9e3779b1) >>> 0;
    // `>>> 0` matters: XOR yields a signed 32-bit int in JavaScript, and a
    // negative one stringifies with a minus sign, which is not hex and which
    // a collector rejects outright.
    out += ((a ^ b) >>> 0).toString(16).padStart(8, "0");
  }
  return out.slice(0, bytes * 2);
}

/**
 * One trace as an OTLP/HTTP JSON request body, with Langfuse's attribute
 * mapping applied. `startedAt` anchors the run's relative milliseconds to wall
 * clock, because a trace with no absolute time cannot be correlated with
 * anything else the client runs.
 */
export function toOtlp(
  trace: Trace,
  opts: { service?: string; environment?: string; release?: string } = {},
): Record<string, unknown> {
  const base = Date.parse(trace.startedAt) || Date.now();
  const traceId = hex(trace.id, 16);
  const nano = (ms: number) => String((base + ms) * 1_000_000);

  const spans = trace.spans.map((s) => {
    const attrs: { key: string; value: AttrValue }[] = [
      attr("langfuse.observation.type", OBSERVATION_TYPE[s.kind]),
      attr("langfuse.observation.level", s.level),
      attr("langfuse.environment", opts.environment ?? "production"),
    ];

    if (s.parent === null) {
      // Trace-level attributes ride on the root span, which is where Langfuse
      // reads them from.
      attrs.push(
        attr("langfuse.trace.name", trace.agent || trace.id),
        attr("langfuse.session.id", trace.id),
        attr("langfuse.trace.tags", JSON.stringify([trace.agent, trace.state].filter(Boolean))),
        attr("langfuse.trace.metadata.run_id", trace.id),
        attr("langfuse.trace.metadata.state", trace.state),
        attr("langfuse.trace.metadata.refusals", trace.totals.refusals),
      );
      if (opts.release) attrs.push(attr("langfuse.release", opts.release));
    }

    if (s.node) attrs.push(attr("langfuse.observation.metadata.node", s.node));
    if (s.statusMessage) attrs.push(attr("langfuse.observation.status_message", s.statusMessage));
    if (s.control) attrs.push(attr("langfuse.observation.metadata.control", s.control));
    if (s.derived) attrs.push(attr("langfuse.observation.metadata.duration_derived", true));
    if (s.input) attrs.push(attr("langfuse.observation.input", s.input));
    if (s.output) attrs.push(attr("langfuse.observation.output", s.output));

    if (s.kind === "generation") {
      // The GenAI conventions are what make this a generation in Langfuse, and
      // what make the same span legible to any other OTLP consumer.
      attrs.push(
        attr("gen_ai.system", "azure.ai.foundry"),
        attr("gen_ai.operation.name", "chat"),
        attr("gen_ai.request.model", s.model ?? ""),
        attr("gen_ai.response.model", s.model ?? ""),
        attr("gen_ai.usage.input_tokens", s.tokensIn ?? 0),
        attr("gen_ai.usage.output_tokens", s.tokensOut ?? 0),
      );
      if (s.cost !== null && s.cost !== undefined) {
        attrs.push(
          attr("gen_ai.usage.cost", s.cost),
          attr("langfuse.observation.cost_details", JSON.stringify({ total: s.cost })),
        );
      }
    }

    if (s.kind === "tool" && s.tool) attrs.push(attr("gen_ai.tool.name", s.tool));

    return {
      traceId,
      spanId: hex(s.id, 8),
      ...(s.parent ? { parentSpanId: hex(s.parent, 8) } : {}),
      name: s.name,
      kind: 1, // SPAN_KIND_INTERNAL
      startTimeUnixNano: nano(s.start),
      endTimeUnixNano: nano(s.start + Math.max(s.duration, 0)),
      attributes: attrs,
      status: s.level === "ERROR" ? { code: 2, message: s.statusMessage ?? "" } : { code: 0 },
    };
  });

  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            attr("service.name", opts.service ?? "agent-factory"),
            attr("deployment.environment", opts.environment ?? "production"),
          ],
        },
        scopeSpans: [{ scope: { name: "agentfactory.journal", version: "1" }, spans }],
      },
    ],
  };
}

export interface Destination {
  /** e.g. https://cloud.langfuse.com — the signal path is appended. */
  host: string;
  publicKey: string;
  secretKey: string;
}

/** Where traces are sent, when the deployment has been told. */
export function destination(): Destination | null {
  const host = process.env.LANGFUSE_HOST ?? "";
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY ?? "";
  const secretKey = process.env.LANGFUSE_SECRET_KEY ?? "";
  if (!host || !publicKey || !secretKey) return null;
  return { host: host.replace(/\/$/, ""), publicKey, secretKey };
}

/** Post one OTLP body. Returns what the collector said, unembellished. */
export async function send(body: unknown, to: Destination): Promise<{ ok: boolean; status: number; detail: string }> {
  const auth = Buffer.from(`${to.publicKey}:${to.secretKey}`).toString("base64");
  try {
    const res = await fetch(`${to.host}/api/public/otel/v1/traces`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${auth}`,
        "x-langfuse-ingestion-version": "4",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const detail = (await res.text()).slice(0, 400);
    return { ok: res.ok, status: res.status, detail };
  } catch (e) {
    return { ok: false, status: 0, detail: (e as Error).message };
  }
}
