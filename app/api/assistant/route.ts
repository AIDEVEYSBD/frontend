import { systemPrompt } from "@/lib/server/assistant-prompt";
import { pageFor } from "@/lib/assistant";
import { READ_TOOLS, clip, runTool } from "@/lib/server/console-tools";
import { internalHeaders } from "@/lib/server/auth";

const TOOLS = READ_TOOLS.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.inputSchema } }));

/**
 * The console assistant.
 *
 * One streaming turn: the conversation so far, the page the person is on and
 * the live facts that page loaded, against the platform's standing knowledge.
 * The model can read the deployment through a small set of read-only tools
 * (the same APIs the pages call) so that counts, spend, firings and index
 * numbers come from the record rather than from memory. It cannot act.
 *
 * The response is server-sent events: text deltas as they arrive, a note
 * when a tool is consulted, and a final done marker. Tool calls are resolved
 * inside the stream, so the person sees the model reading before it answers.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Msg { role: "user" | "assistant"; content: string }
interface PageCtx { path: string; title?: string; facts?: Record<string, unknown> }

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }

function pageMessage(page: PageCtx, snapshot: string): string {
  const { path, info } = pageFor(page.path || "/");
  const facts = page.facts && Object.keys(page.facts).length ? `\nLive facts this page has loaded: ${clip(page.facts, 2500)}` : "";
  return `The person is on ${info.title} (${path}). ${info.shows}${facts}\n\nLive reading of the deployment, taken just now. Answer from it directly and draw charts from it; call a tool only when something you need is not here, and do so without asking. Never mention that you hold a snapshot or reading; speak as the platform: ${snapshot}`;
}

/**
 * A compact reading of the deployment taken before every turn, so the
 * numbers in an answer are right even when the model decides not to call a
 * tool. Each read has its own short timeout; a slow one is simply absent.
 */
async function snapshot(origin: string): Promise<string> {
  const read = async (path: string) => {
    try {
      const res = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(6_000), headers: internalHeaders() });
      return (await res.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  };
  const [control, guard, knowledge, gates] = await Promise.all([read("/api/control"), read("/api/guardrails"), read("/api/knowledge"), read("/api/approvals")]);
  const runs = (control?.runs as Record<string, unknown>[] | undefined) ?? [];
  const byState: Record<string, number> = {};
  const byAgent: Record<string, { runs: number; cost: number; tokensIn: number; tokensOut: number }> = {};
  const byDay: Record<string, { runs: number; cost: number }> = {};
  let allTimeCost = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  for (const r of runs) {
    const st = String(r.state);
    byState[st] = (byState[st] ?? 0) + 1;
    const cost = Number(r.cost) || 0;
    const tk = (r.tokens as { in?: number; out?: number } | undefined) ?? {};
    allTimeCost += cost;
    tokensIn += Number(tk.in) || 0;
    tokensOut += Number(tk.out) || 0;
    const a = String(r.system ?? "");
    byAgent[a] = byAgent[a] ?? { runs: 0, cost: 0, tokensIn: 0, tokensOut: 0 };
    byAgent[a].runs += 1;
    byAgent[a].cost += cost;
    byAgent[a].tokensIn += Number(tk.in) || 0;
    byAgent[a].tokensOut += Number(tk.out) || 0;
    const day = String(r.at ?? "").slice(0, 10);
    if (day) {
      byDay[day] = byDay[day] ?? { runs: 0, cost: 0 };
      byDay[day].runs += 1;
      byDay[day].cost += cost;
    }
  }
  const round = (n: number) => Math.round(n * 10000) / 10000;
  for (const a of Object.values(byAgent)) a.cost = round(a.cost);
  const spendByDay = Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b)).slice(-14).map(([day, v]) => ({ day, runs: v.runs, cost: round(v.cost) }));
  const finops = control?.finops as Record<string, unknown> | undefined;
  const days = ((control?.days as Record<string, unknown>[] | undefined) ?? []).slice(-7).map((d) => ({ day: d.day, runs: d.runs, cost: d.cost, denials: d.denials, kills: d.kills }));
  return clip({
    gatesAwaitingAPerson: gates ? gates.count : "unavailable",
    controlPane: control
      ? {
          last7Days: { totals: control.totals, byDay: days },
          runsInFlight: (control.live as unknown[] | undefined)?.length ?? 0,
          allTime: {
            runsOnRecord: runs.length,
            runsByState: byState,
            journalledSpendUSD: round(allTimeCost),
            tokens: { in: tokensIn, out: tokensOut },
            byAgent,
            spendByDay,
            costBasis: control.costBasis,
          },
          finops: finops ? { budgetUSD: finops.budget, spend7dUSD: finops.spend7d, azureBilling: (finops.azure as Record<string, unknown> | undefined)?.configured ? { mtd: (finops.azure as Record<string, unknown>).mtd, last7d: (finops.azure as Record<string, unknown>).last7d, currency: (finops.azure as Record<string, unknown>).currency } : "not connected on this deployment; journalled spend is the figure to quote" } : undefined,
        }
      : "unavailable",
    controls: guard
      ? {
          runJournalsExamined: guard.runs,
          totalControlFirings: Object.values((guard.counts as Record<string, number> | undefined) ?? {}).reduce((a, b) => a + b, 0),
          firingsByControl: guard.counts,
          firingKeyMeaning: "keys are journal control keys; in prose and chart labels use the register title they map to (capability = AF-AC-01 Capability restriction, scope = AF-AC-02 Scope limitation, injection.action = AF-DP-02 Sink protection, egress = AF-AC-04 Egress restriction, taint = AF-DP-01 Untrusted content marking, gate = AF-HO-01 Authorisation gate, injection.input = AF-DP-04 Content screening, contract.breach = AF-IN-01 Typed interface enforcement, depth = AF-RS-02 Delegation depth limit)",
          posture: guard.posture,
          latestFirings: ((guard.recent as Record<string, unknown>[] | undefined) ?? []).slice(0, 3).map((r) => ({ control: r.control, agent: r.agent, node: r.node, title: r.title })),
        }
      : "unavailable",
    knowledge: knowledge ? { totals: knowledge.totals, index: knowledge.index, staged: (knowledge.staged as unknown[] | undefined)?.length ?? 0 } : "unavailable",
  }, 9000);
}

export async function POST(req: Request) {
  const endpoint = process.env.FOUNDRY_ENDPOINT ?? "";
  const key = process.env.FOUNDRY_API_KEY || process.env.AZURE_AI_KEY || "";
  const model = process.env.ASSISTANT_MODEL ?? "gpt-4o";
  if (!endpoint || !key) {
    return Response.json({ error: "The assistant needs the model gateway: FOUNDRY_ENDPOINT and FOUNDRY_API_KEY are not set." }, { status: 503 });
  }

  let body: { messages?: Msg[]; page?: PageCtx };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected {messages, page}" }, { status: 400 });
  }
  const history = (body.messages ?? []).filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-16);
  if (!history.length || history[history.length - 1].role !== "user") {
    return Response.json({ error: "the last message must be from the user" }, { status: 400 });
  }
  const origin = process.env.ASSISTANT_SELF_ORIGIN || new URL(req.url).origin;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt() },
    { role: "system", content: pageMessage(body.page ?? { path: "/" }, await snapshot(origin)) },
    ...history.map((m) => (m.role === "user" ? { role: "user" as const, content: m.content } : { role: "assistant" as const, content: m.content })),
  ];

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        for (let round = 0; round < 4; round++) {
          const call = () =>
            fetch(endpoint, {
              method: "POST",
              headers: { "content-type": "application/json", "api-key": key, authorization: `Bearer ${key}` },
              body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: round < 3 ? "auto" : "none", stream: true, max_tokens: 1600, temperature: 0.2 }),
              signal: AbortSignal.timeout(90_000),
            });
          let res: Response;
          try {
            res = await call();
            if (res.status >= 500 || res.status === 429) {
              await new Promise((r) => setTimeout(r, 1200));
              res = await call();
            }
          } catch {
            await new Promise((r) => setTimeout(r, 1200));
            res = await call();
          }
          if (!res.ok || !res.body) {
            const text = await res.text().catch(() => "");
            let msg = `gateway HTTP ${res.status}`;
            try { msg = String(JSON.parse(text)?.error?.message ?? msg); } catch { /* keep the status */ }
            send({ error: msg.slice(0, 300) });
            break;
          }

          // Read the SSE stream: text deltas go straight out; tool-call
          // fragments accumulate by index until the turn finishes.
          let content = "";
          const calls = new Map<number, ToolCall>();
          let finish = "";
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let nl: number;
            while ((nl = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, nl).trim();
              buf = buf.slice(nl + 1);
              if (!line.startsWith("data:")) continue;
              const payload = line.slice(5).trim();
              if (payload === "[DONE]") continue;
              let j: { choices?: { delta?: { content?: string; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: string | null }[] };
              try { j = JSON.parse(payload); } catch { continue; }
              const ch = j.choices?.[0];
              if (!ch) continue;
              if (ch.delta?.content) {
                content += ch.delta.content;
                send({ delta: ch.delta.content });
              }
              for (const tc of ch.delta?.tool_calls ?? []) {
                const cur = calls.get(tc.index) ?? { id: "", type: "function" as const, function: { name: "", arguments: "" } };
                if (tc.id) cur.id = tc.id;
                if (tc.function?.name) cur.function.name += tc.function.name;
                if (tc.function?.arguments) cur.function.arguments += tc.function.arguments;
                calls.set(tc.index, cur);
              }
              if (ch.finish_reason) finish = ch.finish_reason;
            }
          }

          if (finish === "tool_calls" && calls.size) {
            const list = [...calls.values()];
            messages.push({ role: "assistant", content: content || null, tool_calls: list });
            for (const call of list) {
              let args: Record<string, unknown> = {};
              try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* the tool sees no args */ }
              send({ tool: call.function.name, args });
              const result = await runTool(origin, call.function.name, args);
              messages.push({ role: "tool", tool_call_id: call.id, content: result });
            }
            continue;
          }
          if (finish === "length") send({ delta: "\n\n(The answer was cut short by the length limit.)" });
          break;
        }
      } catch (e) {
        send({ error: String((e as Error).message ?? e).slice(0, 300) });
      } finally {
        send({ done: true });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" },
  });
}
