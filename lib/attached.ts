/**
 * Third-party agents attached to the factory.
 *
 * An agent built elsewhere — a client's own, a vendor's, another team's — is
 * attached so it runs under the same record, cost accounting, policy and gates
 * as the factory's own agents. It is attached with its policy (the tools it is
 * granted, its gates, its model routing and limits) and a key shown once, and a
 * second person approves the attachment before the key works. Then it reaches
 * the platform through three doors, each call naming the run it belongs to:
 *
 *   SDK runs   /api/sdk/runs: open a run of itself, report its steps, wait at a
 *              gate for a person, take a stop or a steer, finish
 *   gateway    /api/a2a/gateway/v1: its model calls, screened, priced, limited
 *              and recorded in the run
 *   broker     /api/a2a/mcp/<agent>: its tool calls over MCP, decided by the
 *              platform's own policy and made by the platform's tool host
 *
 * Two ways to attach, which differ only in who writes the calls:
 *
 *   sdk   the agent's code is ours to change: the Python or TypeScript SDK
 *         makes these calls
 *   a2a   the agent's code cannot change: point its OpenAI-compatible base URL
 *         at the gateway and its MCP configuration at the broker
 *
 * Everything the page shows about an attached agent — snippets, steps,
 * frameworks — is described here once.
 */

import { PUBLIC_ORIGIN } from "./site";
import { errorText } from "./api/client";

export type AttachMode = "sdk" | "a2a";
export type Language = "python" | "typescript" | "java" | "csharp" | "go";
/** The languages a tested SDK exists in. Go, Java and C# have a reference of the wire format only (sdk/WIRE.md). */
export type SnippetLanguage = "python" | "typescript";

export const MODE_META: Record<AttachMode, { label: string; blurb: string; enforcement: string }> = {
  sdk: {
    label: "Saros SDK",
    blurb: "For an agent whose code you own.",
    enforcement: "gateway + broker",
  },
  a2a: {
    label: "Gateway and broker",
    blurb: "For an agent whose code cannot change.",
    enforcement: "gateway + broker",
  },
};

/** The languages the panel offers a snippet in: the two SDKs that are tested against the platform. */
export const LANGUAGES: { id: SnippetLanguage; label: string; install: string }[] = [
  { id: "python", label: "Python", install: "pip install ./sdk/python   (agentfactory-sdk, standard library only)" },
  { id: "typescript", label: "TypeScript", install: "npm install ./sdk/typescript   (@agentfactory/sdk, Node 23.6 or later)" },
];

export const isSnippetLanguage = (l: string): l is SnippetLanguage => LANGUAGES.some((x) => x.id === l);

export interface Framework {
  id: string;
  label: string;
  /** The SDK language a team using this framework usually writes in. */
  language?: Language;
  /** Products whose agents are configured, not coded: only the gateway and the broker are open to them. */
  a2aOnly?: boolean;
}

export const FRAMEWORKS: Framework[] = [
  { id: "langgraph", label: "LangGraph", language: "python" },
  { id: "opencode", label: "OpenCode", language: "typescript" },
  { id: "claude-code", label: "Claude Code", language: "typescript" },
  { id: "openai-codex", label: "OpenAI Codex", language: "typescript" },
  { id: "goose", label: "Goose", language: "python" },
  { id: "aider", label: "Aider", language: "python" },
  { id: "openai-agents", label: "OpenAI Agents SDK", language: "python" },
  { id: "semantic-kernel", label: "Semantic Kernel", language: "csharp" },
  { id: "autogen", label: "AutoGen", language: "python" },
  { id: "crewai", label: "CrewAI", language: "python" },
  { id: "google-adk", label: "Google ADK", language: "python" },
  { id: "spring-ai", label: "Spring AI", language: "java" },
  { id: "vercel-ai", label: "Vercel AI SDK", language: "typescript" },
  { id: "copilot-studio", label: "Microsoft Copilot Studio", a2aOnly: true },
  { id: "bedrock-agents", label: "Amazon Bedrock Agents", a2aOnly: true },
  { id: "now-assist", label: "ServiceNow Now Assist", a2aOnly: true },
  { id: "agentforce", label: "Salesforce Agentforce", a2aOnly: true },
  { id: "google-secops", label: "Google SecOps agents", a2aOnly: true },
  { id: "wiz", label: "Wiz agents", a2aOnly: true },
  { id: "custom", label: "Custom / other" },
];

export const FRAMEWORK_BY_ID = new Map(FRAMEWORKS.map((f) => [f.id, f]));

/** What lands in a run's record from an attached agent, and who writes it. */
export const RECORDED: { kind: string; what: string }[] = [
  { kind: "run.start · run.end", what: "when the run opens and ends: state, result, duration" },
  { kind: "note · error", what: "steps and failures the agent reports, marked as its own" },
  { kind: "model.call", what: "each gateway call: model, tokens, latency, price" },
  { kind: "tool.call · tool.result", what: "each broker call: arguments, result, registered risk" },
  { kind: "denied", what: "a refused call, and the rule that refused it" },
  { kind: "gate.open · gate.answer · resume", what: "who was asked, who answered, when, and their note" },
  { kind: "taint", what: "untrusted content handed to the run" },
];

export const SHOWN_ON: { page: string; what: string }[] = [
  { page: "Runs", what: "every run, entry by entry, with a verifiable chain" },
  { page: "Approvals", what: "its gates and held tool calls" },
  { page: "Costs", what: "its model calls by model, agent, person and team" },
  { page: "Control", what: "pause, stop, steer and lockdown reach its runs" },
];

/* ═══════════════════ Endpoints an attached agent talks to ═══════════════════ */

/**
 * The doors an attached agent calls, as paths. A machine calls them beneath the machine origin the session answers
 * (lib/site.ts), never beneath the console's own: the console's sign-in stands in front of that, and the doors refuse it.
 */
export const PATHS = {
  ingest: "/api/sdk/runs",
  gateway: "/api/a2a/gateway/v1",
  broker: (agent: string) => `/api/a2a/mcp/${agent || "<agent>"}`,
  /** This platform's own A2A agent card (A2A 1.0's well-known path). */
  card: "/.well-known/agent-card.json",
};

/**
 * Where peers reach this platform over A2A, as `GET /api/a2a` answers it: the origin of the tasks door the backend
 * names under A2A_PUBLIC_URL, or null with the platform's reason when that setting is not set. A refusal is thrown.
 */
export async function readA2AOrigin(): Promise<{ origin: string | null; problem: string }> {
  const r = await fetch("/api/a2a", { cache: "no-store" });
  const j = (await r.json().catch(() => null)) as { endpoint?: unknown; endpoint_problem?: unknown } | null;
  if (!r.ok || !j) throw new Error(errorText(j, r, "GET", "/api/a2a"));
  const endpoint = typeof j.endpoint === "string" ? j.endpoint : "";
  return { origin: endpoint ? new URL(endpoint).origin : null, problem: typeof j.endpoint_problem === "string" ? j.endpoint_problem : "" };
}

/* ═══════════════════ SDK snippets ═══════════════════ */

export interface SnippetContext {
  agent: string;
  key: string;
  /** The machine origin the agent calls; a snippet that names a door is shown only when there is one. */
  origin: string;
}

const KEY = (c: SnippetContext) => c.key || "<agent key>";

/*
 * The names in angle brackets are placeholders for the agent's own: its
 * input, its tools, the role that answers its gate. Nothing in a snippet names
 * a product, an agent or a record.
 */
export const SNIPPETS: Record<SnippetLanguage, (c: SnippetContext) => string> = {
  python: (c) => `from agentfactory_sdk import AgentFactory, Killed, Refused

af = AgentFactory(
    endpoint="${c.origin}",
    api_key="${KEY(c)}",                     # this agent's key; it works once a second person approves
    agent="${c.agent}",
)

with af.run(input={"<input-field>": "<value>"}) as run:                       # run.start; refused during a lockdown or a pause
    run.step("<what the agent did>", node="<step>")                            # a note, marked as reported by the agent
    reply = run.chat([{"role": "user", "content": "<prompt>"}])                # model.call through the gateway, priced
    record = run.call_tool("<granted-tool>", {"<arg>": "<value>"})             # through the broker; waits here if it is gated
    if run.gate("<what is being approved>", approvers=["<approver-role>"])["approved"]:   # waits for a person on Approvals
        run.call_tool("<other-granted-tool>", {"<arg>": reply.text})
    run.result({"<result-field>": "<value>"})                                   # run.end, done; Killed and errors finish it too`,

  typescript: (c) => `import { AgentFactory } from "@agentfactory/sdk";

const af = new AgentFactory({
  endpoint: "${c.origin}",
  apiKey: "${KEY(c)}",                       // this agent's key; it works once a second person approves
  agent: "${c.agent}",
});

await af.run({ "<input-field>": "<value>" }, async (run) => {                   // run.start; refused during a lockdown or a pause
  await run.step("<what the agent did>", { node: "<step>" });                    // a note, marked as reported by the agent
  const reply = await run.chat([{ role: "user", content: "<prompt>" }]);         // model.call through the gateway, priced
  await run.callTool("<granted-tool>", { "<arg>": "<value>" });                  // through the broker; waits here if it is gated
  if ((await run.gate("<what is being approved>", { approvers: ["<approver-role>"] })).approved) {   // waits for a person
    await run.callTool("<other-granted-tool>", { "<arg>": reply.text });
  }
  run.result({ "<result-field>": "<value>" });                                   // run.end, done; a stop or an error finishes it too
});`,
};

/* ═══════════════════ Gateway and broker setup ═══════════════════ */

export interface A2AStep {
  title: string;
  body: string;
  snippet?: (c: SnippetContext) => string;
  lang?: "env" | "json" | "http";
  /** The snippet names a door the agent calls, beneath the machine origin: without one it is not shown. */
  machine?: boolean;
}

export const A2A_STEPS: A2AStep[] = [
  {
    title: "Attach the agent, and have it approved",
    body: "Attach it, set its policy, and have a second person approve it.",
    // People attach and approve, through the console and its sign-in: these are the console's addresses.
    snippet: (c) => `POST ${PUBLIC_ORIGIN}/api/attached                      { "name": "…", "mode": "a2a", "grants": ["<tool>"], "gate_at": "write" }
→    { "agent": { "id": "${c.agent}", "policy_digest": "sha256:…" }, "key": "${KEY(c)}" }
POST ${PUBLIC_ORIGIN}/api/attached/${c.agent}/approve   { "digest": "sha256:…" }      (someone else)`,
    lang: "http",
  },
  {
    title: "Open a run for the work",
    body: "Each piece of work is a run, opened with the agent's key.",
    snippet: (c) => `POST ${c.origin}${PATHS.ingest}                  Authorization: Bearer ${KEY(c)}
{ "run": { "input": { "…": "…" } } }       →  { "run_id": "<run id>" }
POST ${c.origin}${PATHS.ingest}/<run id>/finish   { "state": "done", "result": { … } }`,
    lang: "http",
    machine: true,
  },
  {
    title: "Route its model calls through the gateway",
    body: "Point its OpenAI-compatible base URL at the gateway, with its key.",
    snippet: (c) => `# OpenAI SDKs and anything that honours these
OPENAI_BASE_URL=${c.origin}${PATHS.gateway}
OPENAI_API_KEY=${KEY(c)}
# and, on each request: X-Agentfactory-Run: <run id>`,
    lang: "env",
    machine: true,
  },
  {
    title: "Route its tools through the broker",
    body: "Point its MCP configuration at the broker; each call names its run.",
    snippet: (c) => `{
  "mcpServers": {
    "agent-factory": {
      "url": "${c.origin}${PATHS.broker(c.agent)}",
      "headers": { "Authorization": "Bearer ${KEY(c)}", "X-Agentfactory-Run": "<run id>" }
    }
  }
}`,
    lang: "json",
    machine: true,
  },
];

/* ═══════════════════ The registry row ═══════════════════ */

export type AgentLimits = {
  requests_per_minute?: number;
  tokens_per_day?: number;
  cost_per_day_usd?: number;
};

export interface AttachedAgent {
  id: string;
  name: string;
  mode: AttachMode;
  framework: string;
  language: string;
  owner: string;
  card_url: string;
  key_prefix: string;
  demo: boolean;
  created_at: string;
  last_seen: string | null;
  /** Standing policy, enforced at the broker and the gateway. */
  grants: string[];
  gate_at: "" | "read" | "write" | "risky" | "destructive";
  injection: "block" | "flag";
  blocked: boolean;
  /** Always "": an attached agent does not sign A2A requests with a shared secret (the platform answers 501 for one). */
  secret_name: string;
  /** How the model gateway routes it: the default (a model, a tier, or "" for the deployment's), what it may name, what is tried when one fails. */
  model?: string;
  models?: string[];
  fallbacks?: string[];
  /** requests_per_minute, tokens_per_day, cost_per_day_usd; empty for none. */
  limits?: AgentLimits;
  /** Measured from the run record, as the door answers them. */
  runs30d: number;
  cost30d: number | null;
  denials30d: number;
  gates30d: number | null;
  p50ms: number | null;
}

/**
 * What the register answers beside the generated `AttachedAgentView` (ahead of lib/api/backend.d.ts): whether a
 * second person has approved the attachment (until then its key is refused at every door), who may not, and the
 * digest of the policy as it stands, which an approval names.
 */
export type AttachedRow = AttachedAgent & {
  approval?: { state: "awaiting" | "approved"; digest: string; by?: { sub?: string; email?: string; name?: string }; at?: string | null; proposed_by?: string[] };
  policy_digest?: string;
};

export function slugOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 63);
}
