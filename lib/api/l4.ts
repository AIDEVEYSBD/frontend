import { answerOf, type Answer } from "@/lib/answer-blocks";
import type { DataClass } from "./pending";
import { api, errorText, type Schemas } from "./client";

/**
 * The applications register, the model gateway and a person's chat with a
 * chatbot, as the service answers them (agentfactory/applications/,
 * api/routes/applications.py, apps_chat.py, gateway.py).
 *
 * Calls go through the generated client on its typed paths. The service's
 * answers carry more than the generated schemas (a policy's data class,
 * budget and rate, a removed application, a conversation the service keeps),
 * so each answer is read here field by field into the console's own shape.
 * A figure the service answers null (a cost with no price set, a latency
 * with no answered call) stays null: it is never read as 0.
 */

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const num = (v: unknown): number => numOrNull(v) ?? 0;

export type ApplicationClass = "chatbot" | "rag" | "agent" | "multi_agent";
export type Autonomy = "L0" | "L1" | "L2" | "L3" | "L4" | "L5";
export type BudgetPeriod = "day" | "week" | "month";
/** How a chatbot answers a person in the console's chat: in text, or in text and blocks (agentfactory/answers in the backend). */
export type AnswerMode = "text" | "blocks";
/** The windows the metrics address cuts. */
export type MetricsWindow = "24h" | "7d" | "30d" | "90d" | "all";

export const CLASS_LABEL: Record<ApplicationClass, string> = {
  chatbot: "Chatbot",
  rag: "RAG app",
  agent: "Agent",
  multi_agent: "Multi-agent system",
};

export const AUTONOMY_LABEL: Record<Autonomy, string> = {
  L0: "L0 · answers only",
  L1: "L1 · retrieves",
  L2: "L2 · suggests actions",
  L3: "L3 · acts with approval",
  L4: "L4 · acts, reviewed after",
  L5: "L5 · acts unsupervised",
};
export const AUTONOMIES = Object.keys(AUTONOMY_LABEL) as Autonomy[];

/** An autonomy tier in words; none declared says so. */
export const autonomyLabel = (a: Autonomy | null): string => (a ? AUTONOMY_LABEL[a] : "not declared");

/** An application's budget: an amount in US dollars per calendar period in UTC (a week starts on Monday). */
export interface AppBudget {
  amount_usd: number;
  period: BudgetPeriod;
}

/**
 * An application's policy as the service stores it (agentfactory/applications/policy.py).
 * `models` are in order and chat uses the first; `knowledge_stores` are a
 * RAG app's (recorded; nothing retrieves from them through the service
 * yet); `data_class` is the most sensitive class it handles, and every model
 * call is resolved with it; `rate_per_minute` and `budget` are null for no
 * limit. `system_prompt` is a chatbot's prompt in force ("" for none).
 * `answers` is how a chatbot answers in the console's chat: text, or text and
 * blocks asked of the model as structured output and validated by the
 * service. It does not touch the gateway's OpenAI-compatible addresses.
 */
export interface Policy {
  models: string[];
  knowledge_stores: string[];
  data_class: DataClass;
  rate_per_minute: number | null;
  budget: AppBudget | null;
  system_prompt: string;
  answers: AnswerMode;
}

/** The fields a registration or a change sends, under the service's own names only. */
export type PolicyWire = Partial<Policy>;

export interface Application {
  id: string;
  name: string;
  description: string;
  class: ApplicationClass;
  /** The tier declared for it; recorded and checked by nothing (the register's `not_built`). */
  autonomy: Autonomy | null;
  owner: string;
  /** The key's prefix; never the key. Empty for an agent. */
  key_prefix: string;
  /** A registered chatbot or RAG app (`application`), or a deployed agent (`workflow`), listed and never changed here. */
  source: "application" | "workflow";
  /** An agent's row carries no policy: `policy` is then empty and is never shown. */
  policy: Policy;
  blocked: boolean;
  block: { reason: string; by: string; at: string } | null;
  created_at: string;
  created_by: string;
  removed_at: string | null;
  removed_by: string;
}

/** The register, and what it records that nothing carries out (`not_built_says`, keyed by `not_built`). */
export interface Register {
  rows: Application[];
  notBuilt: Record<string, string>;
}

/** What the register shows beside a registered application, read from its own addresses over 30 days. */
export interface Activity {
  last_seen: string | null;
  cost: number | null;
  /** Answered calls that had no price set: in no cost figure. */
  unpriced: number;
  completions: number;
  controls_fired: number;
  /** The addresses could not be read; the figures above are unknown, not zero. */
  unknown: boolean;
}

export interface ModelMix {
  model: string;
  completions: number;
  cost: number | null;
  unpriced: number;
  tokens: { in: number; out: number };
}

/** `GET /api/applications/{id}/metrics`: what the completions journalled in a window say. */
export interface ApplicationMetrics {
  window: MetricsWindow;
  since: string;
  until: string;
  /** Every call journalled, answered or refused. */
  completions: number;
  answered: number;
  refusals: number;
  refusals_by_reason: Record<string, number>;
  conversations: number;
  principals: number;
  /** The priced calls' sum; null when every answered call had no price set; 0 when no model answered. */
  cost: number | null;
  priced: number;
  unpriced: number;
  model_answered: number;
  tokens: { in: number; out: number };
  /** The model call's latency over the calls a model answered; null when none did. */
  latency: { p50: number | null; p95: number | null };
  /** Screening verdicts that flagged or blocked, by control. */
  screened: Record<string, number>;
  blocked: number;
  flagged: number;
  models: ModelMix[];
  basis: string;
}

export interface ConversationRow {
  id: string;
  /** A person's chat the service keeps (held by `principal`), or a conversation the application named through the gateway. */
  kept: boolean;
  /** The person who holds a kept conversation; the end user the application named otherwise ("" when none). */
  principal: string;
  started: string;
  last: string;
  completions: number;
  refusals: number;
  cost: number | null;
  unpriced: number;
  models: string[];
  tokens: { in: number; out: number };
}

export interface Turn {
  at: string;
  role: "user" | "assistant" | "system";
  /** Masked by the service with the journal's rules. */
  content: string;
  model: string;
  tokens: { in: number; out: number } | null;
  cost: number | null;
  /** A model answered and its model had no price set. */
  unpriced: boolean;
  latency_ms: number | null;
  /** The first screening verdict that flagged or blocked. */
  screened: { control: string; action: "block" | "flag" } | null;
  refused: boolean;
  /** The journalled outcome: `ok`, or the refusal's code. */
  outcome: string;
  /** Why it was refused, as journalled. */
  reason: string;
  /** The completion the turn is recorded as. */
  completion: string;
  /** A chatbot's answer in blocks, as journalled (masked); null for a text reply and for every turn but the answer. */
  answer: Answer | null;
}

export interface Conversation {
  conversation: ConversationRow;
  turns: Turn[];
}

export interface NewApplication {
  name: string;
  class: "chatbot" | "rag";
  owner: string;
  autonomy: Autonomy | null;
  policy: PolicyWire;
}

export interface Minted {
  application: Application;
  /** Shown once. */
  key: string;
  note: string;
  /** The system prompt version the registration recorded; null when it registered none. */
  system_prompt: PromptVersion | null;
}

/** One version of a chatbot's system prompt (`SystemPromptVersion`): every change is a new version, signed. */
export interface PromptVersion {
  id: string;
  version: number;
  prompt: string;
  /** `sha256:<hex>` of the text. */
  digest: string;
  chars: number;
  set_by: string;
  set_at: string;
  /** When the next version replaced it; null while it is in force. */
  retired_at: string | null;
  current: boolean;
  /** Whether the leak check compares replies against it: only the prompt in force, when it is not empty. */
  guarded: boolean;
  /** Recorded on first sight from a prompt registered before versions were kept. */
  adopted: boolean;
}

/** The leak check's reach over earlier versions, in days and versions, with the service's own sentence. */
export interface LeakCheck {
  window_days: number;
  max_versions: number;
  says: string;
}

/** `GET /api/applications/{id}/system-prompts`: every version, newest first. */
export interface PromptHistory {
  application: string;
  /** The current version's id; null when none was ever registered. */
  current: string | null;
  versions: PromptVersion[];
  count: number;
  leak_check: LeakCheck;
  /** Why the application has none (a RAG app), when the service says. */
  says: string;
}

/** A journalled outcome in words (the gateway's refusal codes, agentfactory/applications/gateway.py); one not named here is shown as sent. */
const OUTCOME_WORDS: Record<string, string> = {
  ok: "answered",
  application_blocked: "the application is blocked",
  model_not_allowed: "a model its policy does not list",
  model_not_cleared: "no model cleared for its data class",
  model_not_offered: "a model this deployment does not offer",
  rate_limited: "over its rate limit",
  model_unpriced: "a call with no price (a model with no price set, or an embedding), under its budget or the deployment's",
  spend_uncounted: "spend that cannot be counted against its budget",
  over_budget: "its budget, or the deployment's, is spent",
  screener_unavailable: "the screener could not answer",
  prompt_screened: "the prompt was refused by screening",
  response_screened: "the reply was withheld by screening",
  system_prompt_leaked: "the reply repeated the registered system prompt",
  upstream_unavailable: "the model could not be called",
  upstream_error: "the model did not answer",
  answer_invalid: "the answer's blocks did not validate",
  answer_cut: "the answer was cut off",
};
export const outcomeWords = (outcome: string): string => OUTCOME_WORDS[outcome] ?? outcome.replace(/_/g, " ");

/* ═══════════════════ reading the answers ═══════════════════ */

const PERIODS: BudgetPeriod[] = ["day", "week", "month"];
const CLASSES: DataClass[] = ["public", "internal", "confidential", "restricted"];

function budgetOf(v: unknown): AppBudget | null {
  const b = rec(v);
  const amount = numOrNull(b.amount_usd);
  return amount !== null && PERIODS.includes(b.period as BudgetPeriod) ? { amount_usd: amount, period: b.period as BudgetPeriod } : null;
}

export function policyOf(v: unknown): Policy {
  const p = rec(v);
  return {
    models: strs(p.models),
    knowledge_stores: strs(p.knowledge_stores),
    data_class: CLASSES.includes(p.data_class as DataClass) ? (p.data_class as DataClass) : "internal",
    rate_per_minute: numOrNull(p.rate_per_minute),
    budget: budgetOf(p.budget),
    system_prompt: str(p.system_prompt),
    answers: p.answers === "blocks" ? "blocks" : "text",
  };
}

export function applicationOf(v: ApplicationView | Rec): Application {
  const a = rec(v);
  const block = a.block ? rec(a.block) : null;
  const by = rec(a.created_by);
  const cls = (["chatbot", "rag", "agent", "multi_agent"].includes(str(a.class)) ? a.class : "agent") as ApplicationClass;
  return {
    id: str(a.id),
    name: str(a.name) || str(a.id),
    description: str(a.description),
    class: cls,
    autonomy: AUTONOMIES.includes(a.autonomy as Autonomy) ? (a.autonomy as Autonomy) : null,
    owner: str(a.owner),
    key_prefix: str(a.key_prefix),
    source: a.source === "application" ? "application" : "workflow",
    policy: policyOf(a.policy),
    blocked: a.blocked === true,
    block: block ? { reason: str(block.reason), by: str(block.by), at: str(block.at) } : null,
    created_at: str(a.created_at),
    created_by: str(by.email) || str(by.name) || str(by.sub),
    removed_at: str(a.removed_at) || null,
    removed_by: str(a.removed_by),
  };
}

export function metricsOf(v: unknown): ApplicationMetrics {
  const m = rec(v);
  const tokens = rec(m.tokens);
  const latency = rec(m.latency_ms);
  const counts = (x: unknown): Record<string, number> => Object.fromEntries(Object.entries(rec(x)).map(([k, n]) => [k, num(n)]));
  return {
    window: str(m.window) as MetricsWindow,
    since: str(m.since),
    until: str(m.until),
    completions: num(m.completions),
    answered: num(m.answered),
    refusals: num(m.refusals),
    refusals_by_reason: counts(m.refusals_by_reason),
    conversations: num(m.conversations),
    principals: num(m.principals),
    cost: numOrNull(m.cost),
    priced: num(m.priced),
    unpriced: num(m.unpriced),
    model_answered: num(m.model_answered),
    tokens: { in: num(tokens.in), out: num(tokens.out) },
    latency: { p50: numOrNull(latency.p50), p95: numOrNull(latency.p95) },
    screened: counts(m.screened),
    blocked: num(m.blocked),
    flagged: num(m.flagged),
    models: (Array.isArray(m.models) ? m.models : []).map((x) => {
      const r = rec(x);
      const t = rec(r.tokens);
      return { model: str(r.model), completions: num(r.completions), cost: numOrNull(r.cost), unpriced: num(r.unpriced), tokens: { in: num(t.in), out: num(t.out) } };
    }),
    basis: str(m.basis),
  };
}

export function conversationRowOf(v: unknown): ConversationRow {
  const c = rec(v);
  const t = rec(c.tokens);
  return {
    id: str(c.id),
    kept: c.kept === true,
    principal: str(c.principal),
    started: str(c.started),
    last: str(c.last) || str(c.started),
    completions: num(c.completions),
    refusals: num(c.refusals),
    cost: numOrNull(c.cost),
    unpriced: num(c.unpriced),
    models: strs(c.models),
    tokens: { in: num(t.in), out: num(t.out) },
  };
}

/**
 * A conversation's completions, flattened into turns: the turns the caller
 * sent (masked), then the answer with the figures journalled for it. A
 * completion whose outcome is not `ok` was refused, and carries the reason.
 */
export function turnsOf(v: unknown): Turn[] {
  const out: Turn[] = [];
  for (const raw of Array.isArray(rec(v).completions) ? (rec(v).completions as unknown[]) : []) {
    const c = rec(raw);
    const verdict = (Array.isArray(c.verdicts) ? c.verdicts : []).map(rec).find((x) => x.action === "block" || x.action === "flag");
    const outcome = str(c.outcome);
    const blank = { model: "", tokens: null, cost: null, unpriced: false, latency_ms: null, screened: null, refused: false, outcome: "", reason: "", completion: str(c.id), answer: null };
    for (const t of Array.isArray(c.turns) ? c.turns : []) {
      const turn = rec(t);
      const role = turn.role === "assistant" ? "assistant" : turn.role === "system" || turn.role === "developer" ? "system" : "user";
      out.push({ at: str(c.at), role, content: str(turn.content), ...blank });
    }
    const tk = c.tokens ? rec(c.tokens) : null;
    out.push({
      at: str(c.at),
      role: "assistant",
      content: str(c.response),
      model: str(c.model),
      tokens: tk ? { in: num(tk.in), out: num(tk.out) } : null,
      cost: numOrNull(c.cost),
      unpriced: c.unpriced === true,
      latency_ms: numOrNull(c.latency_ms),
      screened: verdict ? { control: str(verdict.control), action: verdict.action === "block" ? "block" : "flag" } : null,
      refused: outcome !== "ok",
      outcome,
      reason: str(c.reason),
      completion: str(c.id),
      answer: answerOf(c.answer),
    });
  }
  return out;
}

export function promptVersionOf(v: SystemPromptVersionView | Rec): PromptVersion {
  const p = rec(v);
  return {
    id: str(p.id),
    version: num(p.version),
    prompt: str(p.prompt),
    digest: str(p.digest),
    chars: num(p.chars),
    set_by: str(p.set_by),
    set_at: str(p.set_at),
    retired_at: str(p.retired_at) || null,
    current: p.current === true,
    guarded: p.guarded === true,
    adopted: p.adopted === true,
  };
}

/** The history, newest version first whatever order it arrived in. */
export function promptHistoryOf(v: SystemPromptHistoryView | Rec): PromptHistory {
  const h = rec(v);
  const versions = (Array.isArray(h.versions) ? h.versions : []).map((x) => promptVersionOf(rec(x))).sort((a, b) => b.version - a.version);
  const leak = rec(h.leak_check);
  return {
    application: str(h.application),
    current: str(h.current) || null,
    versions,
    count: typeof h.count === "number" ? h.count : versions.length,
    leak_check: { window_days: num(leak.window_days), max_versions: num(leak.max_versions), says: str(leak.says) },
    says: str(h.says),
  };
}

/** The leak check's reach as the page states it beside the versions. */
export function leakWindowLine(c: LeakCheck): string {
  if (!c.window_days && !c.max_versions) return c.says;
  return `Responses are checked against the current prompt and every version retired in the last ${c.window_days} day${c.window_days === 1 ? "" : "s"}, at most the ${c.max_versions} most recent.`;
}

/** The generated schemas the typed paths answer with; each is read through the functions above. */
type ApplicationView = Schemas["ApplicationView"];
type SystemPromptVersionView = Schemas["SystemPromptVersion"];
type SystemPromptHistoryView = Schemas["SystemPromptHistory"];

/* ═══════════════════ calls ═══════════════════ */

function fail(error: unknown, response: Response): Error {
  return new Error(errorText(error, response));
}

/** The register: registered applications by name, then the deployed agents. */
export async function readRegister(): Promise<Register> {
  const { data, error, response } = await api.GET("/api/applications", { params: { query: {} } });
  if (!data) throw fail(error, response);
  const d = rec(data);
  const says = rec(d.not_built_says);
  return {
    rows: (Array.isArray(d.applications) ? d.applications : []).map((a) => applicationOf(rec(a))),
    notBuilt: Object.fromEntries(strs(d.not_built).map((k) => [k, str(says[k]) || k])),
  };
}

export async function listApplications(): Promise<Application[]> {
  return (await readRegister()).rows;
}

export async function getApplication(id: string): Promise<Application | null> {
  const { data, error, response } = await api.GET("/api/applications/{app_id}", { params: { path: { app_id: id } } });
  if (!data) {
    if (response.status === 404) return null;
    throw fail(error, response);
  }
  return applicationOf(rec(data));
}

/** `POST /api/applications`: the policy goes under the service's own names, and nothing else is sent. */
export async function createApplication(body: NewApplication): Promise<Minted> {
  const { data, error, response } = await api.POST("/api/applications", {
    body: { name: body.name, class: body.class, owner: body.owner, autonomy: body.autonomy, policy: body.policy as unknown as Schemas["PolicyView"] },
  });
  if (!data) throw fail(error, response);
  const d = rec(data);
  return { application: applicationOf(rec(d.application)), key: str(d.key), note: str(d.note), system_prompt: d.system_prompt ? promptVersionOf(rec(d.system_prompt)) : null };
}

/** `PATCH /api/applications`: only what is sent changes; a policy is merged field by field. */
export async function patchApplication(
  id: string,
  patch: { blocked?: boolean; blocked_reason?: string; owner?: string; name?: string; autonomy?: Autonomy | null; policy?: PolicyWire },
): Promise<Application> {
  const body = { id, ...patch } as Schemas["ApplicationPatch"];
  const { data, error, response } = await api.PATCH("/api/applications", { body });
  if (!data) throw fail(error, response);
  return applicationOf(rec(rec(data).application));
}

/**
 * A new system prompt for a chatbot: `PATCH /api/applications` with the prompt
 * alone. A changed prompt is a new version, signed by the person signed in;
 * the answer names the version recorded, null when the text was the same.
 */
export async function setSystemPrompt(id: string, prompt: string): Promise<{ application: Application; recorded: PromptVersion | null }> {
  const { data, error, response } = await api.PATCH("/api/applications", { body: { id, policy: { system_prompt: prompt } } });
  if (!data) throw fail(error, response);
  const d = rec(data);
  return { application: applicationOf(rec(d.application)), recorded: d.system_prompt ? promptVersionOf(rec(d.system_prompt)) : null };
}

/** `GET /api/applications/{id}/system-prompts`; null for a row that is not a registered application (a deployed agent: 404). */
export async function systemPrompts(id: string): Promise<PromptHistory | null> {
  const { data, error, response } = await api.GET("/api/applications/{app_id}/system-prompts", { params: { path: { app_id: id } } });
  if (!data) {
    if (response.status === 404) return null;
    throw fail(error, response);
  }
  return promptHistoryOf(rec(data));
}

/** `DELETE /api/applications?id=`: takes it off the register and revokes its key. Its completions stay. */
export async function deleteApplication(id: string): Promise<void> {
  const { data, error, response } = await api.DELETE("/api/applications", { params: { query: { id } } });
  if (!data) throw fail(error, response);
}

export async function applicationMetrics(id: string, window: MetricsWindow): Promise<ApplicationMetrics> {
  const query = { window } as { window?: "24h" | "7d" | "30d" };
  const { data, error, response } = await api.GET("/api/applications/{app_id}/metrics", { params: { path: { app_id: id }, query } });
  if (!data) throw fail(error, response);
  return metricsOf(data);
}

export async function listConversations(id: string, limit = 200): Promise<ConversationRow[]> {
  const { data, error, response } = await api.GET("/api/applications/{app_id}/conversations", { params: { path: { app_id: id }, query: { limit } } });
  if (!data) throw fail(error, response);
  return (Array.isArray(rec(data).conversations) ? (rec(data).conversations as unknown[]) : []).map(conversationRowOf);
}

export async function getConversation(id: string, cid: string): Promise<Conversation> {
  const { data, error, response } = await api.GET("/api/applications/{app_id}/conversations/{cid}", { params: { path: { app_id: id, cid } } });
  if (!data) throw fail(error, response);
  return { conversation: conversationRowOf(data), turns: turnsOf(data) };
}

/**
 * What the register shows beside a registered application: last seen, cost
 * and controls fired over 30 days, from its own metrics and conversations
 * addresses. One that cannot be read leaves the figures unknown, never zero.
 */
export async function activityOf(id: string): Promise<Activity> {
  try {
    const [m, c] = await Promise.all([applicationMetrics(id, "30d"), listConversations(id, 1)]);
    const screened = Object.values(m.screened).reduce((a, b) => a + b, 0);
    return { last_seen: c[0]?.last || null, cost: m.cost, unpriced: m.unpriced, completions: m.completions, controls_fired: m.refusals + screened, unknown: false };
  } catch {
    return { last_seen: null, cost: null, unpriced: 0, completions: 0, controls_fired: 0, unknown: true };
  }
}

/* ═══════════════════ the gateway, for an application's own code ═══════════════════ */

/** The gateway's path. An application calls it beneath the machine origin (lib/site.ts), never the console's. */
export const GATEWAY_PATH = "/api/gateway/v1";

export interface SnippetContext {
  key: string;
  model: string;
  /** The gateway's full address: the machine origin and GATEWAY_PATH. */
  base: string;
}

const KEY = (c: SnippetContext) => c.key || "<application key>";

/**
 * The OpenAI SDK pointed at the gateway. The gateway takes the key and
 * nothing else; `user` is journalled (masked) as the end user, and
 * `X-Conversation-Id` groups calls into a conversation the register replays.
 */
export const SNIPPETS = {
  python: (c: SnippetContext) => `from openai import OpenAI

client = OpenAI(base_url="${c.base}", api_key="${KEY(c)}")

reply = client.chat.completions.create(
    model="${c.model}",
    messages=[{"role": "user", "content": "Summarise our password policy."}],
    user="alice@example.com",                          # the end user, journalled masked
    extra_headers={"X-Conversation-Id": "ticket-4711"},  # optional: groups calls into a conversation
)
print(reply.choices[0].message.content)
# Refusals: 400 screened or a leaked system prompt, 402 budget, 403 a model the policy does not list
# or not cleared for its data class, 423 blocked, 429 rate limit (with Retry-After).
# tools (type function) and stream=True pass through; each tool call and tool result is screened and journalled, and a
# stream arrives whole, after screening, not token by token. n above 1 and /responses are not built.`,

  typescript: (c: SnippetContext) => `import OpenAI from "openai";

const client = new OpenAI({ baseURL: "${c.base}", apiKey: "${KEY(c)}" });

const reply = await client.chat.completions.create(
  {
    model: "${c.model}",
    messages: [{ role: "user", content: "Summarise our password policy." }],
    user: "alice@example.com", // the end user, journalled masked
  },
  { headers: { "X-Conversation-Id": "ticket-4711" } }, // optional: groups calls into a conversation
);
console.log(reply.choices[0].message.content);
// Refusals: 400 screened or a leaked system prompt, 402 budget, 403 a model the policy does not list
// or not cleared for its data class, 423 blocked, 429 rate limit (with Retry-After).
// tools (type function) and stream: true pass through; each tool call and tool result is screened and journalled, and a
// stream arrives whole, after screening, not token by token. n above 1 and /responses are not built.`,
} as const;
