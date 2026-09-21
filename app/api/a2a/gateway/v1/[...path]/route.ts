import { admit } from "@/lib/server/attached";
import { defaultModel, foundry } from "@/lib/server/foundry";
import { screen, untrustedText } from "@/lib/server/injection";
import { entry, newRecord, openForAppend, writeRecord, type RunRecord } from "@/lib/server/journal-store";
import { ENDPOINTS } from "@/lib/attached";

/**
 * The model gateway: an OpenAI-compatible endpoint an attached agent points
 * its base URL at. Every request is forwarded to the deployment's own model
 * resource and journalled as a model call — model, tokens in and out,
 * latency — so the agent's spend is a measurement on the control pane and
 * its reasoning replays in the theater. Prompts are screened before they
 * leave; a blocked agent gets no answer at all.
 *
 * Grouping: a caller that sends `x-agentfactory-run: <run id>` appends to
 * that run (its own runs only). Without it each request is one run, and the
 * response carries `x-agentfactory-run` so the next request can join it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set(["chat/completions", "completions", "embeddings", "responses"]);

function oaiError(status: number, message: string, code: string) {
  return Response.json({ error: { message, type: "agentfactory_policy", code, param: null } }, { status });
}

function contentText(json: Record<string, unknown>): string {
  try {
    const choice = (json.choices as { message?: { content?: unknown }; text?: string }[] | undefined)?.[0];
    if (choice?.message && typeof choice.message.content === "string") return choice.message.content;
    if (typeof choice?.text === "string") return choice.text;
    if (typeof json.output_text === "string") return json.output_text;
    const output = json.output as { content?: { text?: string }[] }[] | undefined;
    if (Array.isArray(output)) return output.flatMap((o) => (o.content ?? []).map((c) => c.text ?? "")).join("");
  } catch {
    /* not a shape we know */
  }
  return "";
}

function tokensOf(usage: Record<string, unknown> | undefined): { in: number; out: number } {
  const u = usage ?? {};
  return {
    in: Number(u.prompt_tokens ?? u.input_tokens ?? 0) || 0,
    out: Number(u.completion_tokens ?? u.output_tokens ?? 0) || 0,
  };
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const sub = path.join("/");
  if (sub === "models") {
    const fx = await foundry();
    if (!fx) return oaiError(503, "the model gateway has no upstream configured", "no_upstream");
    const up = await fetch(`${fx.base}/models`, { headers: { "api-key": fx.key, authorization: `Bearer ${fx.key}` } });
    return new Response(await up.text(), { status: up.status, headers: { "content-type": "application/json" } });
  }
  return Response.json({
    door: "model gateway",
    url: ENDPOINTS.gateway,
    paths: [...ALLOWED].map((p) => `POST ${ENDPOINTS.gateway}/${p}`),
    auth: "Authorization: Bearer <api key> — the key minted when the agent was attached",
    grouping: "send x-agentfactory-run: <run id> to append to one of the agent's runs; the response carries the run id either way",
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const sub = path.join("/");
  if (!ALLOWED.has(sub)) return oaiError(404, `no such path ${sub}; the gateway serves ${[...ALLOWED].join(", ")}`, "unknown_path");

  const door = await admit(req);
  if (!door.ok) return oaiError(door.status, door.error, door.status === 423 ? "agent_blocked" : "not_admitted");
  const { agent, auth } = door;

  const fx = await foundry();
  if (!fx) return oaiError(503, "the model gateway has no upstream configured (FOUNDRY_ENDPOINT / FOUNDRY_API_KEY)", "no_upstream");

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return oaiError(400, "expected a JSON body", "bad_request");
  }
  if (!body.model) body.model = await defaultModel();
  const stream = sub !== "embeddings" && body.stream === true;
  if (stream && sub === "chat/completions") {
    // The usage chunk is how a streamed answer gets priced; ask for it.
    body.stream_options = { ...((body.stream_options as Record<string, unknown>) ?? {}), include_usage: true };
  }

  // The record this call lands in.
  const named = req.headers.get("x-agentfactory-run") ?? "";
  let record: RunRecord | null = named ? await openForAppend(agent.id, named) : null;
  if (named && !record) return oaiError(404, `run "${named}" is not one of this agent's open runs`, "unknown_run");
  const started = Date.now();
  const base = record ? record.journal.duration_ms : 0;
  const at = () => base + (Date.now() - started);
  if (!record) {
    record = newRecord(agent.id, "gateway", undefined, auth.mode === "key" ? auth.key?.prefix : "open");
    record.journal.entries.push(entry(0, "run.start", "", agent.id, "through the model gateway", { system: agent.id, door: "gateway" }));
  }
  const rec = record;
  const node = "model";

  // Screening: user and tool turns are untrusted; the system prompt is the agent's own.
  const hit = screen(untrustedText(body));
  if (hit.hit) {
    rec.journal.entries.push(
      entry(at(), "denied", node, "injection filter", `prompt matched ${hit.pattern}`, { control: "injection.input", pattern: hit.pattern, excerpt: hit.excerpt, action: agent.injection }),
    );
    if (agent.injection === "block") {
      rec.journal.entries.push(entry(at(), "run.end", "", "failed", "prompt refused by the injection filter", { state: "failed" }));
      rec.state = "failed";
      rec.error = "prompt refused by the injection filter";
      await writeRecord(rec);
      return oaiError(403, `refused by the injection filter: the prompt matched ${hit.pattern}. The refusal is on run ${rec.id}.`, "injection_blocked");
    }
  }

  const model = String(body.model ?? "");
  let up: Response;
  try {
    up = await fetch(`${fx.base}/${sub}`, {
      method: "POST",
      headers: { "content-type": "application/json", "api-key": fx.key, authorization: `Bearer ${fx.key}`, accept: stream ? "text/event-stream" : "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    rec.journal.entries.push(entry(at(), "error", node, model || "model", `upstream unreachable: ${(e as Error).message}`, { model }));
    rec.journal.entries.push(entry(at(), "run.end", "", "failed", "upstream unreachable", { state: "failed" }));
    rec.state = "failed";
    rec.error = "upstream unreachable";
    await writeRecord(rec);
    return oaiError(502, `the model resource did not answer: ${(e as Error).message}`, "upstream_unreachable");
  }

  const headers = new Headers({ "x-agentfactory-run": rec.id, "cache-control": "no-cache" });

  if (!up.ok) {
    const text = await up.text();
    rec.journal.entries.push(entry(at(), "error", node, model || "model", `upstream HTTP ${up.status}: ${text.slice(0, 300)}`, { model, status: up.status }));
    rec.journal.entries.push(entry(at(), "run.end", "", "failed", `upstream HTTP ${up.status}`, { state: "failed" }));
    rec.state = "failed";
    rec.error = `upstream HTTP ${up.status}`;
    await writeRecord(rec);
    headers.set("content-type", up.headers.get("content-type") ?? "application/json");
    return new Response(text, { status: up.status, headers });
  }

  const finish = async (usedModel: string, usage: Record<string, unknown> | undefined, text: string, extra: Record<string, unknown> = {}) => {
    const t = at();
    rec.journal.entries.push(
      entry(t, "model.call", node, usedModel || model || "model", text.slice(0, 600), {
        model: usedModel || model,
        tokens: tokensOf(usage),
        duration_ms: Date.now() - started,
        gateway: true,
        path: sub,
        ...(sub === "embeddings" ? { embeddings: true } : {}),
        ...extra,
      }),
    );
    rec.journal.entries.push(entry(t, "run.end", "", "done", "", { state: "done" }));
    rec.state = "done";
    await writeRecord(rec);
  };

  if (!stream) {
    const text = await up.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text);
    } catch {
      /* passthrough of a non-JSON body */
    }
    await finish(String(json.model ?? ""), json.usage as Record<string, unknown> | undefined, contentText(json), {
      messages: Array.isArray(body.messages) ? (body.messages as unknown[]).length : undefined,
    });
    headers.set("content-type", "application/json");
    return new Response(text, { status: 200, headers });
  }

  // Streaming: pass every byte through untouched, read the usage and text off the side.
  let usage: Record<string, unknown> | undefined;
  let usedModel = "";
  let text = "";
  let pending = "";
  const decoder = new TextDecoder();
  const scan = (chunk: string) => {
    pending += chunk;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload) as Record<string, unknown>;
        if (j.usage && typeof j.usage === "object") usage = j.usage as Record<string, unknown>;
        if (typeof j.model === "string" && j.model) usedModel = j.model;
        const delta = (j.choices as { delta?: { content?: string } }[] | undefined)?.[0]?.delta?.content;
        if (typeof delta === "string" && text.length < 2000) text += delta;
        if (typeof j.delta === "string" && text.length < 2000) text += j.delta; // responses API text deltas
      } catch {
        /* a partial or non-JSON line */
      }
    }
  };
  const tap = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk);
      scan(decoder.decode(chunk, { stream: true }));
    },
    async flush() {
      scan("\n");
      await finish(usedModel, usage, text, { streamed: true, messages: Array.isArray(body.messages) ? (body.messages as unknown[]).length : undefined });
    },
  });
  headers.set("content-type", up.headers.get("content-type") ?? "text/event-stream; charset=utf-8");
  return new Response(up.body!.pipeThrough(tap), { status: 200, headers });
}
