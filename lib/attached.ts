/**
 * Third-party agents attached to the factory.
 *
 * An agent built elsewhere — a client's own, a vendor's, another team's — is
 * attached so it runs under the same journal as the factory's own agents,
 * which is what puts it on the control pane, in the theater and under the
 * controls with nothing else changing. Two ways in:
 *
 *   sdk   the agent's code is ours to change: the SDK journals every model
 *         call, tool call, refusal and gate from inside the process
 *   a2a   the agent's code cannot change: it registers its agent card, its
 *         model calls and tools are routed through the factory, and it
 *         receives its work over A2A
 *
 * Everything the page shows about an attached agent — snippets, steps,
 * frameworks — is described here once, so the panel renders from a table and
 * the describing endpoints answer from the same one.
 */

import { PUBLIC_ORIGIN } from "./site";

export type AttachMode = "sdk" | "a2a";
export type Language = "python" | "typescript" | "java" | "csharp" | "go";

export const MODE_META: Record<AttachMode, { label: string; blurb: string; enforcement: string }> = {
  sdk: {
    label: "Agent Factory SDK",
    blurb: "For an agent whose code you own. A few lines wrap the model client and the tools; the journal, the policy engine and the gates come with them.",
    enforcement: "in-process guard",
  },
  a2a: {
    label: "A2A",
    blurb: "For an agent whose code cannot change. Register its card, point its model endpoint and tool configuration at the factory, and hand it work over A2A.",
    enforcement: "model + tool gateway",
  },
};

export const LANGUAGES: { id: Language; label: string; install: string }[] = [
  { id: "python", label: "Python", install: "pip install agentfactory  (sdk/python in this repo)" },
  { id: "typescript", label: "TypeScript", install: "npm install @agentfactory/sdk  (sdk/typescript in this repo)" },
  { id: "java", label: "Java", install: "sdk/java — reference client, single file, no dependencies" },
  { id: "csharp", label: "C#", install: "sdk/csharp — reference client, single file, no dependencies" },
  { id: "go", label: "Go", install: "go get github.com/ey/agentfactory-go  (sdk/go in this repo)" },
];

export interface Framework {
  id: string;
  label: string;
  /** The SDK language a team using this framework usually writes in. */
  language?: Language;
  /** Products whose agents are configured, not coded: A2A is the only way in. */
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

/** What lands in the journal from an attached agent, and where it then shows. */
export const RECORDED: { kind: string; what: string }[] = [
  { kind: "model.call", what: "model, tokens in and out, latency — priced against the model sheet, so cost is a measurement" },
  { kind: "tool.call · tool.result", what: "every tool with its arguments and result, at the risk it was declared" },
  { kind: "denied", what: "a call the policy engine refused, and the rule that refused it" },
  { kind: "gate.open · gate.answer", what: "who was asked, who answered, when, and the note they left" },
  { kind: "taint", what: "untrusted content marked at entry, and every value derived from it" },
  { kind: "run.start · run.end", what: "state, result and duration, so a run is a record and never a stream that ended" },
];

export const SHOWN_ON: { page: string; what: string }[] = [
  { page: "Control", what: "spend, activity, latency and denials beside the factory's own agents" },
  { page: "Runs", what: "every run replayable in the theater, decision by decision" },
  { page: "Controls", what: "refusals, gates and taint counted from the record" },
  { page: "Roster", what: "the agent on the payroll with its derived autonomy" },
  { page: "Observability", what: "traces in OpenTelemetry GenAI form, exportable to Langfuse or any OTLP collector" },
];

/* ═══════════════════ Endpoints an attached agent talks to ═══════════════════ */

export const ENDPOINTS = {
  origin: PUBLIC_ORIGIN,
  sdk: `${PUBLIC_ORIGIN}/api/sdk`,
  ingest: `${PUBLIC_ORIGIN}/api/sdk/runs`,
  gateway: `${PUBLIC_ORIGIN}/api/a2a/gateway/v1`,
  broker: (agent: string) => `${PUBLIC_ORIGIN}/api/a2a/mcp/${agent || "<agent>"}`,
  tasks: `${PUBLIC_ORIGIN}/api/a2a`,
  card: `${PUBLIC_ORIGIN}/.well-known/agent.json`,
};

/* ═══════════════════ SDK snippets ═══════════════════ */

export interface SnippetContext {
  agent: string;
  key: string;
}

const KEY = (c: SnippetContext) => c.key || "<api key>";

/*
 * The names in angle brackets are placeholders for the agent's own: its
 * input, its tools, the model it calls, the role that answers its gate.
 * Nothing in a snippet names a product, an agent or a record.
 */
export const SNIPPETS: Record<Language, (c: SnippetContext) => string> = {
  python: (c) => `from agentfactory import AgentFactory, Denied
from openai import OpenAI

af = AgentFactory(
    endpoint="${PUBLIC_ORIGIN}",
    api_key="${KEY(c)}",                     # scoped to this agent
    agent="${c.agent}",
)

# Every completion through this client is journalled: model, tokens, latency, cost.
llm = af.instrument(OpenAI())

@af.tool("<read-tool-name>", risk="read")              # asked of the policy engine before it runs
def look_up(record_id: str) -> dict:
    ...                                                # your own code

@af.tool("<sink-tool-name>", risk="write", sink=True)  # tainted input can never reach this
def send(to: str, body: str) -> None:
    ...                                                # your own code

with af.run(input={"<input-field>": "<value>"}) as run:
    record = look_up("<record-id>")                                         # tool.call → tool.result
    reply = llm.chat.completions.create(model="<model-id>", messages=msgs)  # model.call
    if run.gate("<what is being approved>", approvers=["<approver-role>"]):  # suspends; answered in the console
        send("<recipient>", reply.choices[0].message.content)
    run.result({"<result-field>": "<value>"})`,

  typescript: (c) => `import { AgentFactory } from "@agentfactory/sdk";
import OpenAI from "openai";

const af = new AgentFactory({
  endpoint: "${PUBLIC_ORIGIN}",
  apiKey: "${KEY(c)}",                       // scoped to this agent
  agent: "${c.agent}",
});

// Every completion through this client is journalled: model, tokens, latency, cost.
const llm = af.instrument(new OpenAI());

const lookUp = af.tool("<read-tool-name>", { risk: "read" }, async (id: string) => readRecord(id));               // your own code
const send = af.tool("<sink-tool-name>", { risk: "write", sink: true }, async (to: string, body: string) => deliver(to, body));

await af.run({ "<input-field>": "<value>" }, async (run) => {
  const record = await lookUp("<record-id>");                                              // tool.call → tool.result
  const reply = await llm.chat.completions.create({ model: "<model-id>", messages });      // model.call
  if (await run.gate("<what is being approved>", { approvers: ["<approver-role>"] })) {    // suspends; answered in the console
    await send("<recipient>", reply.choices[0].message.content);
  }
  run.result({ "<result-field>": "<value>" });
});`,

  java: (c) => `import com.ey.agentfactory.AgentFactory;
import com.ey.agentfactory.AgentFactory.*;

AgentFactory af = AgentFactory.builder()
    .endpoint("${PUBLIC_ORIGIN}")
    .apiKey("${KEY(c)}")                       // scoped to this agent
    .agent("${c.agent}")
    .build();

try (Run run = af.run(Map.of("<input-field>", "<value>"))) {
    // Every tool call journalled at its declared risk; TAINTS marks the result untrusted.
    var record = run.tool("<read-tool-name>", Risk.READ, Run.TAINTS, "<record-id>", () -> readRecord("<record-id>"));

    // Every model call journalled: model, tokens in and out, latency → cost.
    ModelReply reply = run.model("<model-id>", () -> {
        var r = llm.call(prompt);
        return new ModelReply(r.text(), "<model-id>", r.promptTokens(), r.completionTokens());
    });

    if (run.gate("<what is being approved>", List.of("<approver-role>"))) {   // suspends; answered in the console
        // SINK: a tainted argument is refused before the call; this one is clean.
        run.tool("<sink-tool-name>", Risk.WRITE, Run.SINK, List.of("<recipient>", reply.text), () -> deliver("<recipient>", reply.text));
    }
    run.result(Map.of("<result-field>", "<value>"));
}`,

  csharp: (c) => `using AgentFactory.Sdk;

var af = new AgentFactoryClient(new AgentFactoryOptions
{
    Endpoint = "${PUBLIC_ORIGIN}",
    ApiKey   = "${KEY(c)}",                     // scoped to this agent
    Agent    = "${c.agent}",
});

await using var run = af.StartRun(new Dictionary<string, object> { ["<input-field>"] = "<value>" });

// Every tool call journalled at its declared risk; Taints marks the result untrusted.
var record = await run.ToolAsync("<read-tool-name>", Risk.Read, ToolFlags.Taints, "<record-id>", () => ReadRecordAsync("<record-id>"));

// Every model call journalled: model, tokens in and out, latency → cost.
var reply = await run.ModelAsync("<model-id>", async () =>
{
    var r = await kernel.InvokePromptAsync(prompt);
    return new ModelReply(r.ToString(), "<model-id>", r.PromptTokens, r.CompletionTokens);
});

if (await run.GateAsync("<what is being approved>", new[] { "<approver-role>" }))   // suspends; answered in the console
    // Sink: a tainted argument is refused before the call; this one is clean.
    await run.ToolAsync("<sink-tool-name>", Risk.Write, ToolFlags.Sink, new object[] { "<recipient>", reply.Text }, () => DeliverAsync("<recipient>", reply.Text));

run.Result(new Dictionary<string, object> { ["<result-field>"] = "<value>" });`,

  go: (c) => `import af "github.com/ey/agentfactory-go"

client := af.New(af.Options{
    Endpoint: "${PUBLIC_ORIGIN}",
    APIKey:   "${KEY(c)}",                    // scoped to this agent
    Agent:    "${c.agent}",
})

run := client.Run(ctx, map[string]any{"<input-field>": "<value>"})
defer run.Close()

// Every model call goes through run.Model: model, tokens, latency → cost.
reply, err := run.Model(ctx, "<model-id>", func() (af.ModelReply, error) {
    r, err := llm.Chat(ctx, prompt)
    return af.ModelReply{Text: r.Text, TokensIn: r.Usage.Prompt, TokensOut: r.Usage.Completion}, err
})

lookUp := af.Tool(client, "<read-tool-name>", af.Read, af.Taints, readRecord)   // result marked untrusted
send := af.Tool(client, "<sink-tool-name>", af.Write, af.Sink, deliver)         // refuses a tainted argument

record, _ := lookUp(run, "<record-id>")                                          // tool.call → tool.result
if ok, _ := run.Gate(ctx, "<what is being approved>", []string{"<approver-role>"}); ok {   // suspends; answered in the console
    send(run, "<recipient>", reply.Text)
}
run.Result(map[string]any{"<result-field>": "<value>"})`,
};

/* ═══════════════════ A2A setup ═══════════════════ */

export interface A2AStep {
  title: string;
  body: string;
  snippet?: (c: SnippetContext) => string;
  lang?: "env" | "json" | "http";
}

export const A2A_STEPS: A2AStep[] = [
  {
    title: "Register the agent",
    body: "Name it, say who owns it, and give the factory its agent card URL. A key scoped to this agent is minted at the same time; every door below checks it. Then propose its tools and its gate in the registry's policy editor, which someone other than you approves (an agent starts with nothing), and name the vault secret it signs its A2A requests with.",
    snippet: (c) => `POST ${ENDPOINTS.origin}/api/attached      { "name": "…", "mode": "a2a", "card_url": "…" }
→    { "agent": "${c.agent}", "key": "${KEY(c)}" }
POST ${ENDPOINTS.origin}/api/policy/changes  { "target": { "kind": "attached", "id": "${c.agent}" }, "proposed": { "grants": ["<tool-name>"], "gate_at": "write" }, "reason": "…" }
PATCH ${ENDPOINTS.origin}/api/attached     { "id": "${c.agent}", "secret_name": "${c.agent}-a2a" }`,
    lang: "http",
  },
  {
    title: "Route its model calls through the factory",
    body: "Point the agent's OpenAI-compatible base URL at the model gateway and give it the key. Every completion is forwarded to the deployment's own model resource and journalled with model, tokens and latency, priced from the model sheet. User and tool turns are screened before they leave; a blocked agent gets no answer. Streaming works; send x-agentfactory-run to group calls into one run.",
    snippet: (c) => `# OpenAI SDKs, LangChain, LlamaIndex, Vercel AI, Spring AI — anything that honours these
OPENAI_BASE_URL=${ENDPOINTS.gateway}
OPENAI_API_KEY=${KEY(c)}

# Azure OpenAI SDKs
AZURE_OPENAI_ENDPOINT=${ENDPOINTS.gateway}
AZURE_OPENAI_API_KEY=${KEY(c)}`,
    lang: "env",
  },
  {
    title: "Route its tools through the factory",
    body: "Point the agent's MCP configuration at the broker. It serves exactly the registry tools the agent was granted, through the policy engine: an ungranted tool is refused and the refusal recorded, a call at or above the gate risk waits for a person on the control pane, and every call lands in the journal. The MCP session is the run.",
    snippet: (c) => `{
  "mcpServers": {
    "agent-factory": {
      "url": "${ENDPOINTS.broker(c.agent)}",
      "headers": { "Authorization": "Bearer ${KEY(c)}" }
    }
  }
}`,
    lang: "json",
  },
  {
    title: "Exchange work over A2A",
    body: "Every A2A request is signed, both ways, under a secret the two sides share and the vault holds by name: the agent signs as its id with the secret named in its policy, and checks the signature on every answer before reading it. The factory hands the agent tasks through the peer connector (peer.send, then peer.result, the reply marked untrusted until a node validates it) once its endpoint is registered under Peers and a person has approved its pinned card. The factory is a peer too: its card, served signed, lists the deployed workflows as skills, and tasks/send at the tasks door puts a task on the trigger queue for a worker to run under the policy engine.",
    snippet: (c) => `POST ${ENDPOINTS.tasks}
x-af-agent: ${c.agent}
x-af-timestamp: <unix seconds>      x-af-nonce: <16 random bytes, hex>
x-af-signature: <base64url HMAC-SHA256, under the shared secret, of
                 POST\\n/api/a2a\\ntimestamp\\nnonce\\nsha256hex(body)\\nx-af-delegation>
{ "jsonrpc": "2.0", "id": 1, "method": "tasks/send",
  "params": { "id": "${c.agent}-task-1", "metadata": { "workflow": "<workflow-id>" },
              "message": { "role": "user", "parts": [{ "type": "data", "data": { "…": "the workflow's input" } }] } } }
→ { "result": { "id": "…", "status": { "state": "submitted" } } }      then tasks/get until completed
  x-af-signature on the answer: status\\nyour nonce\\nsha256hex(body), verified before it is read
GET  ${ENDPOINTS.card}   the factory's own card, signed the same way`,
    lang: "http",
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
  /** The vault name of the secret it signs its A2A requests with (phase L7); "" when it has none, and then the tasks door does not hear it. Never the value. */
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

export function slugOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 63);
}
