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

@af.tool("records.query", risk="read")            # asked of the policy engine before it runs
def lookup_vendor(vendor_id: str) -> dict:
    return vendors.get(vendor_id)

@af.tool("notify.send", risk="write", sink=True)   # tainted input can never reach this
def email_owner(to: str, body: str) -> None:
    mail.send(to, body)

with af.run(input={"vendor_id": "V-1042"}) as run:
    profile = lookup_vendor("V-1042")                                  # tool.call → tool.result
    reply = llm.chat.completions.create(model="gpt-4o", messages=msgs)  # model.call
    if run.gate("Close the review", approvers=["ciso"]):                # suspends; answered in the console
        email_owner(profile["owner"], reply.choices[0].message.content)
    run.result({"disposition": "closed"})`,

  typescript: (c) => `import { AgentFactory } from "@agentfactory/sdk";
import OpenAI from "openai";

const af = new AgentFactory({
  endpoint: "${PUBLIC_ORIGIN}",
  apiKey: "${KEY(c)}",                       // scoped to this agent
  agent: "${c.agent}",
});

// Every completion through this client is journalled: model, tokens, latency, cost.
const llm = af.instrument(new OpenAI());

const lookupVendor = af.tool("records.query", { risk: "read" }, async (id: string) => vendors.get(id));
const emailOwner = af.tool("notify.send", { risk: "write", sink: true }, async (to: string, body: string) => mail.send(to, body));

await af.run({ vendor_id: "V-1042" }, async (run) => {
  const profile = await lookupVendor("V-1042");                                      // tool.call → tool.result
  const reply = await llm.chat.completions.create({ model: "gpt-4o", messages });     // model.call
  if (await run.gate("Close the review", { approvers: ["ciso"] })) {                 // suspends; answered in the console
    await emailOwner(profile.owner, reply.choices[0].message.content);
  }
  run.result({ disposition: "closed" });
});`,

  java: (c) => `import com.ey.agentfactory.AgentFactory;
import com.ey.agentfactory.AgentFactory.*;

AgentFactory af = AgentFactory.builder()
    .endpoint("${PUBLIC_ORIGIN}")
    .apiKey("${KEY(c)}")                       // scoped to this agent
    .agent("${c.agent}")
    .build();

try (Run run = af.run(Map.of("vendor_id", "V-1042"))) {
    // Every tool call journalled at its declared risk; TAINTS marks the result untrusted.
    Vendor profile = run.tool("records.query", Risk.READ, Run.TAINTS, "V-1042", () -> vendors.get("V-1042"));

    // Every model call journalled: model, tokens in and out, latency → cost.
    ModelReply reply = run.model("gpt-4o", () -> {
        var r = llm.call(prompt);
        return new ModelReply(r.text(), "gpt-4o", r.promptTokens(), r.completionTokens());
    });

    if (run.gate("Close the review", List.of("ciso"))) {               // suspends; answered in the console
        // SINK: a tainted argument is refused before the call; this one is clean.
        run.tool("notify.send", Risk.WRITE, Run.SINK, List.of(owners, reply.text), () -> mail.send(owners, reply.text));
    }
    run.result(Map.of("disposition", "closed"));
}`,

  csharp: (c) => `using AgentFactory.Sdk;

var af = new AgentFactoryClient(new AgentFactoryOptions
{
    Endpoint = "${PUBLIC_ORIGIN}",
    ApiKey   = "${KEY(c)}",                     // scoped to this agent
    Agent    = "${c.agent}",
});

await using var run = af.StartRun(new { vendor_id = "V-1042" });

// Every tool call journalled at its declared risk; Taints marks the result untrusted.
var profile = await run.ToolAsync("records.query", Risk.Read, ToolFlags.Taints, "V-1042", () => vendors.GetAsync("V-1042"));

// Every model call journalled: model, tokens in and out, latency → cost.
var reply = await run.ModelAsync("gpt-4o", async () =>
{
    var r = await kernel.InvokePromptAsync(prompt);
    return new ModelReply(r.ToString(), "gpt-4o", r.PromptTokens, r.CompletionTokens);
});

if (await run.GateAsync("Close the review", new[] { "ciso" }))         // suspends; answered in the console
    // Sink: a tainted argument is refused before the call; this one is clean.
    await run.ToolAsync("notify.send", Risk.Write, ToolFlags.Sink, new object[] { owners, reply.Text }, () => mail.SendAsync(owners, reply.Text));

run.Result(new { disposition = "closed" });`,

  go: (c) => `import af "github.com/ey/agentfactory-go"

client := af.New(af.Options{
    Endpoint: "${PUBLIC_ORIGIN}",
    APIKey:   "${KEY(c)}",                    // scoped to this agent
    Agent:    "${c.agent}",
})

run := client.Run(ctx, map[string]any{"vendor_id": "V-1042"})
defer run.Close()

// Every model call goes through run.Model: model, tokens, latency → cost.
reply, err := run.Model(ctx, "gpt-4o", func() (af.ModelReply, error) {
    r, err := llm.Chat(ctx, prompt)
    return af.ModelReply{Text: r.Text, TokensIn: r.Usage.Prompt, TokensOut: r.Usage.Completion}, err
})

lookupVendor := af.Tool(client, "records.query", af.Read, af.Taints, vendors.Get)   // result marked untrusted
emailOwner := af.Tool(client, "notify.send", af.Write, af.Sink, mail.Send)          // refuses a tainted argument

profile, _ := lookupVendor(run, "V-1042")                                          // tool.call → tool.result
if ok, _ := run.Gate(ctx, "Close the review", []string{"ciso"}); ok {              // suspends; answered in the console
    emailOwner(run, "tprm-owners@example.com", reply.Text)
}
run.Result(map[string]any{"disposition": "closed"})`,
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
    body: "Name it, say who owns it, and give the factory its agent card URL. A key scoped to this agent is minted at the same time; every door below checks it. Then grant it tools and set its gate in the registry's policy editor — an agent starts with nothing.",
    snippet: (c) => `POST ${ENDPOINTS.origin}/api/attached      { "name": "…", "mode": "a2a", "card_url": "…" }
→    { "agent": "${c.agent}", "key": "${KEY(c)}" }
PATCH ${ENDPOINTS.origin}/api/attached     { "id": "${c.agent}", "grants": ["aegis-registry.get_warden_rules"], "gate_at": "write" }`,
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
    body: "The factory reads the agent's card and hands it tasks through the peer connector: peer.send, then peer.result, with the reply marked untrusted until a node validates it. The factory is a peer too: its card lists the deployed workflows as skills, and tasks/send at the tasks door puts a task on the trigger queue for a worker to run under the policy engine.",
    snippet: (c) => `POST ${ENDPOINTS.tasks}
{ "jsonrpc": "2.0", "id": 1, "method": "tasks/send",
  "params": { "id": "${c.agent}-task-1", "metadata": { "workflow": "aegis-dlp-triage" },
              "message": { "role": "user", "parts": [{ "type": "data", "data": { "…": "the workflow's input" } }] } } }
→ { "result": { "id": "…", "status": { "state": "submitted" } } }      then tasks/get until completed
GET  ${ENDPOINTS.card}   the factory's own card`,
    lang: "http",
  },
];

/* ═══════════════════ The registry row ═══════════════════ */

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
  /** Measured from the run record for a live agent; demonstration figures for a seeded one. */
  runs30d: number;
  cost30d: number | null;
  denials30d: number;
  gates30d: number | null;
  p50ms: number | null;
}

/**
 * Agents shown on a fresh deployment, so the panel reads as an estate that is
 * already attached rather than a form waiting for its first entry. Seeded
 * once into the registry and deletable like any other row; their activity is
 * demonstration data from lib/demo-activity and never measured.
 */
export const SEED_AGENTS: Pick<AttachedAgent, "id" | "name" | "mode" | "framework" | "language" | "owner" | "card_url">[] = [
  { id: "vendor-risk-copilot", name: "Vendor Risk Copilot", mode: "sdk", framework: "langgraph", language: "python", owner: "Third-Party Risk", card_url: "" },
  { id: "now-assist-incident-agent", name: "Now Assist Incident Agent", mode: "a2a", framework: "now-assist", language: "", owner: "Service Management", card_url: "https://grc-dev.service-now.com/api/now/a2a/.well-known/agent.json" },
  { id: "policy-qa-assistant", name: "Policy Q&A Assistant", mode: "sdk", framework: "semantic-kernel", language: "csharp", owner: "Risk and Compliance", card_url: "" },
  { id: "access-review-agent", name: "Access Review Agent", mode: "a2a", framework: "copilot-studio", language: "", owner: "Identity and Access", card_url: "https://copilotstudio.microsoft.com/environments/grc-prod/bots/access-review/.well-known/agent.json" },
  { id: "threat-intel-summariser", name: "Threat Intel Summariser", mode: "sdk", framework: "crewai", language: "python", owner: "Security Operations", card_url: "" },
];

export function slugOf(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^[^a-z]+/, "")
    .slice(0, 63);
}
