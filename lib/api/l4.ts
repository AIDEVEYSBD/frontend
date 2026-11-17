import { PUBLIC_ORIGIN } from "@/lib/site";
import { api, errorText, type Schemas } from "./client";

/**
 * The L4 doors (backend/CONTRACT.md, "L4: applications, the gateway and the
 * retrieval door"), through the generated client.
 *
 * lib/api/backend.d.ts carries the register's paths since the backend
 * landed them (`npm run gen:api`), so every call here is `api.GET(...)` on
 * a typed path and the wire shapes are the backend's own schemas. What this
 * module adds is the console's reading of them: the figures a row shows
 * beside its policy (activity, cost, controls fired) come from the
 * application's own metrics and conversations doors, and a conversation's
 * completions are flattened into turns the replay drawer can show. The
 * retrieval door and the chatbot door are not in the document yet; their
 * URLs are named here for the snippets only.
 */

export type ApplicationView = Schemas["ApplicationView"];
export type PolicyView = Schemas["PolicyView"];
export type MetricsView = Schemas["MetricsView"];
export type ConversationRowView = Schemas["ConversationRow"];
export type ConversationView = Schemas["ConversationView"];
export type CompletionView = Schemas["CompletionView"];
export type RegisterRequest = Schemas["RegisterRequest"];
export type ApplicationPatch = Schemas["ApplicationPatch"];
export type SystemPromptVersionView = Schemas["SystemPromptVersion"];
export type SystemPromptHistoryView = Schemas["SystemPromptHistory"];

export type ApplicationClass = ApplicationView["class"];
export type Autonomy = ApplicationView["autonomy"];
export type ScreenPolicy = PolicyView["screen"];
/** The windows the metrics door cuts; the page's 90d and All are clamped to 30d. */
export type MetricsWindow = MetricsView["window"];

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

/** Limits as the contract names them, per application and per principal. */
export interface Limits {
  requests_per_minute: number | null;
  tokens_per_day: number | null;
  cost_per_day_usd: number | null;
}

export interface Policy {
  screen: ScreenPolicy;
  /** The header the principal arrives in; default x-principal. */
  principal_header: string;
  /** Refuse a request that carries no principal. */
  principal_required: boolean;
  limits: Limits;
  /** The same three, applied to each principal separately. */
  principal_limits: Limits;
  /** The model a caller that names none gets; empty means the deployment default. */
  model: string;
  /** Allowed models; empty means the policy's model only. */
  models: string[];
  /** What a RAG app may retrieve from. */
  namespaces: string[];
  /** Principal → namespaces, "*" for all. */
  entitlements: Record<string, string[]>;
  /** A registered prompt the gateway injects; the app sends none. */
  system_prompt: string;
}

export interface Application {
  id: string;
  name: string;
  description: string;
  class: ApplicationClass;
  autonomy: Autonomy;
  owner: string;
  /** The key's prefix as the register shows it; never the key. Empty for a workflow. */
  key_prefix: string;
  policy: Policy;
  blocked: boolean;
  created_at: string;
  /** Where the row comes from: the applications table, a workflow, an attached agent. */
  source: ApplicationView["source"];
  estate_id: string;
}

/** What the register shows beside a row, read from its own doors over 30 days. */
export interface Activity {
  last_seen: string | null;
  cost: number | null;
  completions: number;
  controls_fired: number;
  /** The doors could not be read; the figures above are unknown, not zero. */
  unknown: boolean;
}

export interface ModelMix {
  model: string;
  completions: number;
  cost: number;
  tokens: { in: number; out: number };
}

export interface ApplicationMetrics {
  window: MetricsWindow;
  since: string;
  until: string;
  /** Completions journalled in the window. */
  volume: number;
  requests: number;
  conversations: number;
  principals: number;
  cost: number | null;
  unpriced: number;
  tokens: { in: number; out: number };
  latency: { p50: number | null; p95: number | null };
  refusals: number;
  refusals_by_reason: Record<string, number>;
  /** Screened hits by control (the journal key or the catalogue id). */
  screened: Record<string, number>;
  blocked: number;
  flagged: number;
  streamed: number;
  models: ModelMix[];
  /** What the retrieval door journalled in the window (the backend's `RagMetrics`); null when the application retrieved nothing in it. */
  rag: RagFigures | null;
  basis: string;
}

/**
 * The retrieval door's figures for one application over the window: hit
 * rate over the retrievals it was entitled to, answers whose grounding
 * verdict was empty or ungrounded, and grounded answers over answers that
 * produced text. Rates are null when there is nothing to divide by.
 */
export interface RagFigures {
  retrievals: number;
  searches: number;
  answers: number;
  /** Retrievals refused because the principal had no entitlement to the namespace. */
  refused: number;
  hits: number;
  hit_rate: number | null;
  answered: number;
  unanswerable: number;
  grounded: number;
  partial: number;
  grounding_rate: number | null;
  /** Retrievals per namespace. */
  namespaces: Record<string, number>;
}

export interface ConversationRow {
  id: string;
  principal: string;
  started: string;
  last: string;
  /** Completions in the conversation. */
  turns: number;
  cost: number | null;
  refusals: number;
  /** Screened completions; the row does not carry it, so null until the conversation is opened. */
  screened: number | null;
  models: string[];
  tokens: { in: number; out: number };
}

export interface Turn {
  at: string;
  role: "user" | "assistant" | "system" | "tool" | "retrieval";
  /** Redacted by the backend with the journal's rules. */
  content: string;
  model: string;
  tokens: { in: number; out: number } | null;
  cost: number | null;
  latency_ms: number | null;
  screened: { control: string; action: "block" | "flag" } | null;
  refused: boolean;
  outcome: string;
  /** The journal this turn is recorded in, for the lineage drawer. */
  run: string;
  entry: string;
  /** Passages a retrieval turn returned, by document title. */
  passages: { title: string; namespace: string; excerpt: string }[];
}

export interface Conversation {
  conversation: ConversationRow;
  turns: Turn[];
}

export interface NewApplication {
  name: string;
  class: RegisterRequest["class"];
  owner: string;
  autonomy?: Autonomy;
  policy: Partial<Policy>;
}

export interface Minted {
  application: Application;
  /** Shown once. */
  key: string;
  note: string;
  /** The system prompt version the registration recorded; null when it registered none. */
  system_prompt: PromptVersion | null;
}

/**
 * One version of a registered application's system prompt (the backend's
 * `SystemPromptVersion`): every change is a new version, signed, and an
 * earlier one is still checked for leaks for a while after it is retired.
 */
export interface PromptVersion {
  id: string;
  version: number;
  prompt: string;
  /** `sha256:<hex>` of the text. */
  digest: string;
  chars: number;
  /** Who set it; "" for a prompt registered before versions were kept (adopted). */
  set_by: string;
  set_at: string;
  /** When the next version replaced it; null while it is current. */
  retired_at: string | null;
  current: boolean;
  /** Whether the leak check still compares responses against it. */
  guarded: boolean;
  /** Recorded on first sight from a prompt registered before versions were kept. */
  adopted: boolean;
}

/** The leak check's reach over earlier versions, in days and versions, with the backend's own sentence. */
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
}

/* ═══════════════════ mapping ═══════════════════ */

const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const num = (v: unknown): number => numOrNull(v) ?? 0;

function limits(v: { requests_per_minute?: number | null; tokens_per_day?: number | null; cost_per_day_usd?: number | null } | undefined): Limits {
  return { requests_per_minute: numOrNull(v?.requests_per_minute), tokens_per_day: numOrNull(v?.tokens_per_day), cost_per_day_usd: numOrNull(v?.cost_per_day_usd) };
}

export function policyOf(v: PolicyView | null | undefined): Policy {
  const p = v ?? ({} as Partial<PolicyView>);
  return {
    screen: p.screen === "flag" ? "flag" : "block",
    principal_header: p.principal_header || "x-principal",
    principal_required: Boolean(p.principal_required),
    limits: limits(p.limits),
    principal_limits: limits(p.limits?.principal),
    model: p.model ?? "",
    models: p.models ?? [],
    namespaces: p.namespaces ?? [],
    entitlements: p.entitlements ?? {},
    system_prompt: p.system_prompt ?? "",
  };
}

/** The policy as the register stores it, from the console's shape; unset fields take the door's defaults. */
export function policyToWire(p: Partial<Policy>): PolicyView {
  const lim = p.limits ?? { requests_per_minute: null, tokens_per_day: null, cost_per_day_usd: null };
  const pl = p.principal_limits ?? { requests_per_minute: null, tokens_per_day: null, cost_per_day_usd: null };
  return {
    screen: p.screen ?? "block",
    principal_header: p.principal_header || "x-principal",
    principal_required: p.principal_required ?? false,
    limits: { ...lim, principal: pl },
    model: p.model ?? "",
    models: p.models ?? [],
    namespaces: p.namespaces ?? [],
    entitlements: p.entitlements ?? {},
    system_prompt: p.system_prompt ?? "",
  };
}

export function applicationOf(v: ApplicationView): Application {
  return {
    id: v.id,
    name: v.name || v.id,
    description: v.description ?? "",
    class: v.class,
    autonomy: v.autonomy,
    owner: v.owner ?? "",
    key_prefix: v.key_prefix ?? "",
    policy: policyOf(v.policy),
    blocked: Boolean(v.blocked),
    created_at: v.created_at ?? "",
    source: v.source,
    estate_id: v.estate_id || "default",
  };
}

export function ragOf(r: NonNullable<MetricsView["rag"]>): RagFigures {
  return {
    retrievals: num(r.retrievals),
    searches: num(r.searches),
    answers: num(r.answers),
    refused: num(r.refused),
    hits: num(r.hits),
    hit_rate: numOrNull(r.hit_rate),
    answered: num(r.answered),
    unanswerable: num(r.unanswerable),
    grounded: num(r.grounded),
    partial: num(r.partial),
    grounding_rate: numOrNull(r.grounding_rate),
    namespaces: Object.fromEntries(Object.entries(r.namespaces ?? {}).map(([k, v]) => [k, num(v)])),
  };
}

export function metricsOf(m: MetricsView): ApplicationMetrics {
  return {
    window: m.window,
    since: m.since,
    until: m.until,
    volume: num(m.completions),
    requests: num(m.requests),
    conversations: num(m.conversations),
    principals: num(m.principals),
    // Every completion priced at the gateway; unpriced ones are counted, not folded into zero.
    cost: m.unpriced > 0 && m.completions > 0 && m.unpriced >= m.completions ? null : num(m.cost),
    unpriced: num(m.unpriced),
    tokens: { in: num(m.tokens?.in), out: num(m.tokens?.out) },
    latency: { p50: numOrNull(m.latency_ms?.p50), p95: numOrNull(m.latency_ms?.p95) },
    refusals: num(m.refusals),
    refusals_by_reason: m.refusals_by_reason ?? {},
    screened: m.screened ?? {},
    blocked: num(m.blocked),
    flagged: num(m.flagged),
    streamed: num(m.streamed),
    models: (m.models ?? []).map((x) => ({ model: x.model, completions: num(x.completions), cost: num(x.cost), tokens: { in: num(x.tokens?.in), out: num(x.tokens?.out) } })),
    rag: m.rag ? ragOf(m.rag) : null,
    basis: `journalled completions between ${m.since} and ${m.until}; cost from the gateway's price sheet (${m.unpriced} unpriced)${m.rag ? "; retrieval figures from the retrieval door's journalled searches and answers" : ""}`,
  };
}

export function conversationRowOf(c: ConversationRowView): ConversationRow {
  return {
    id: c.id,
    principal: c.principal ?? "",
    started: c.started ?? "",
    last: c.last ?? c.started ?? "",
    turns: num(c.completions),
    cost: numOrNull(c.cost),
    refusals: num(c.refusals),
    screened: null,
    models: c.models ?? [],
    tokens: { in: num(c.tokens?.in), out: num(c.tokens?.out) },
  };
}

const REFUSED = /block|refus|denied|limit|budget|rate/i;

/**
 * A conversation's completions, flattened into turns: the prompt's turns as
 * the caller sent them (redacted by the backend), then the answer with the
 * figures the gateway journalled for it. A completion the screener matched
 * carries the control; one the gateway refused carries no answer.
 */
export function turnsOf(c: ConversationView): Turn[] {
  const out: Turn[] = [];
  for (const comp of c.completions ?? []) {
    const verdict = (comp.verdicts ?? []).find((v) => v && typeof v === "object" && typeof (v as { control?: unknown }).control === "string") as { control?: string; action?: string } | undefined;
    const control = comp.control || verdict?.control || "";
    const refused = REFUSED.test(comp.outcome ?? "");
    const action: "block" | "flag" = refused || /block/i.test(String(verdict?.action ?? "")) ? "block" : "flag";
    for (const t of comp.turns ?? []) {
      const role = (["user", "assistant", "system", "tool", "retrieval"].includes(t.role) ? t.role : t.role === "developer" ? "system" : "user") as Turn["role"];
      out.push({ at: comp.at, role, content: t.content ?? "", model: "", tokens: null, cost: null, latency_ms: null, screened: null, refused: false, outcome: "", run: comp.run_id ?? "", entry: comp.id ?? "", passages: [] });
    }
    out.push({
      at: comp.at,
      role: "assistant",
      content: comp.response ?? "",
      model: comp.model ?? "",
      tokens: comp.tokens ? { in: num(comp.tokens.in), out: num(comp.tokens.out) } : null,
      cost: numOrNull(comp.cost),
      latency_ms: numOrNull(comp.latency_ms),
      screened: control ? { control, action } : null,
      refused,
      outcome: comp.outcome ?? "",
      run: comp.run_id ?? "",
      entry: comp.id ?? "",
      passages: [],
    });
  }
  return out;
}

export function promptVersionOf(v: SystemPromptVersionView): PromptVersion {
  return {
    id: v.id,
    version: num(v.version),
    prompt: v.prompt ?? "",
    digest: v.digest ?? "",
    chars: num(v.chars),
    set_by: v.set_by ?? "",
    set_at: v.set_at ?? "",
    retired_at: v.retired_at ?? null,
    current: Boolean(v.current),
    guarded: Boolean(v.guarded),
    adopted: Boolean(v.adopted),
  };
}

/** The history, newest version first whatever order it arrived in. */
export function promptHistoryOf(h: SystemPromptHistoryView): PromptHistory {
  const versions = (h.versions ?? []).map(promptVersionOf).sort((a, b) => b.version - a.version);
  return {
    application: h.application,
    current: h.current ?? null,
    versions,
    count: typeof h.count === "number" ? h.count : versions.length,
    leak_check: { window_days: num(h.leak_check?.window_days), max_versions: num(h.leak_check?.max_versions), says: h.leak_check?.says ?? "" },
  };
}

/** The leak check's window as the page states it beside the versions. */
export function leakWindowLine(c: LeakCheck): string {
  if (!c.window_days && !c.max_versions) return c.says;
  return `Responses are checked against the current prompt and every version retired in the last ${c.window_days} day${c.window_days === 1 ? "" : "s"}, at most the ${c.max_versions} most recent.`;
}

/* ═══════════════════ calls ═══════════════════ */

function fail(error: unknown, response: Response): Error {
  const text = errorText(error, response);
  if (/answered (404|502|503)/.test(text)) return new Error(`${text}: the applications register is served by the backend; this deployment may not have named it (BACKEND_ORIGIN)`);
  return new Error(text);
}

export async function listApplications(cls?: ApplicationClass): Promise<Application[]> {
  const { data, error, response } = await api.GET("/api/applications", { params: { query: cls ? { class: cls } : {} } });
  if (!data) throw fail(error, response);
  return data.applications.map(applicationOf);
}

export async function getApplication(id: string): Promise<Application | null> {
  const { data, error, response } = await api.GET("/api/applications/{app_id}", { params: { path: { app_id: id } } });
  if (!data) {
    if (response.status === 404) return null;
    throw fail(error, response);
  }
  return applicationOf(data);
}

export async function createApplication(body: NewApplication): Promise<Minted> {
  const { data, error, response } = await api.POST("/api/applications", {
    body: { name: body.name, class: body.class, owner: body.owner, autonomy: body.autonomy ?? null, policy: policyToWire(body.policy) },
  });
  if (!data) throw fail(error, response);
  return { application: applicationOf(data.application), key: data.key, note: data.note, system_prompt: data.system_prompt ? promptVersionOf(data.system_prompt) : null };
}

export async function patchApplication(id: string, patch: { blocked?: boolean; owner?: string; name?: string; policy?: Partial<Policy>; autonomy?: Autonomy }): Promise<Application> {
  const body: ApplicationPatch = { id };
  if (patch.blocked !== undefined) body.blocked = patch.blocked;
  if (patch.owner !== undefined) body.owner = patch.owner;
  if (patch.name !== undefined) body.name = patch.name;
  if (patch.autonomy !== undefined) body.autonomy = patch.autonomy;
  if (patch.policy !== undefined) body.policy = policyToWire(patch.policy);
  const { data, error, response } = await api.PATCH("/api/applications", { body });
  if (!data) throw fail(error, response);
  return applicationOf(data.application);
}

/**
 * Register a new system prompt for an application: `PATCH /api/applications`
 * with the prompt alone (the door merges a policy patch field by field, so
 * nothing else on the policy moves). A changed prompt is a new version,
 * signed by the session; the answer names the version recorded, null when
 * the text was the same.
 */
export async function setSystemPrompt(id: string, prompt: string): Promise<{ application: Application; recorded: PromptVersion | null }> {
  const { data, error, response } = await api.PATCH("/api/applications", { body: { id, policy: { system_prompt: prompt } } });
  if (!data) throw fail(error, response);
  return { application: applicationOf(data.application), recorded: data.system_prompt ? promptVersionOf(data.system_prompt) : null };
}

/** `GET /api/applications/{id}/system-prompts`; null for a row that is not a registered application (a workflow, an attached agent: 404). */
export async function systemPrompts(id: string): Promise<PromptHistory | null> {
  const { data, error, response } = await api.GET("/api/applications/{app_id}/system-prompts", { params: { path: { app_id: id } } });
  if (!data) {
    if (response.status === 404) return null;
    throw fail(error, response);
  }
  return promptHistoryOf(data);
}

export async function deleteApplication(id: string): Promise<void> {
  const { data, error, response } = await api.DELETE("/api/applications", { params: { query: { id } } });
  if (!data) throw fail(error, response);
}

/** The page's window, as the metrics door accepts it: 90d and All are cut at 30 days. */
export function metricsWindow(win: string): MetricsWindow {
  return win === "24h" || win === "7d" ? win : "30d";
}

export async function applicationMetrics(id: string, window: MetricsWindow): Promise<ApplicationMetrics> {
  const { data, error, response } = await api.GET("/api/applications/{app_id}/metrics", { params: { path: { app_id: id }, query: { window } } });
  if (!data) throw fail(error, response);
  return metricsOf(data);
}

export async function listConversations(id: string, limit = 200): Promise<ConversationRow[]> {
  const { data, error, response } = await api.GET("/api/applications/{app_id}/conversations", { params: { path: { app_id: id }, query: { limit } } });
  if (!data) throw fail(error, response);
  return data.conversations.map(conversationRowOf);
}

export async function getConversation(id: string, cid: string): Promise<Conversation> {
  const { data, error, response } = await api.GET("/api/applications/{app_id}/conversations/{cid}", { params: { path: { app_id: id, cid } } });
  if (!data) throw fail(error, response);
  const turns = turnsOf(data);
  const answers = turns.filter((t) => t.role === "assistant");
  const costs = answers.map((t) => t.cost).filter((c): c is number => c !== null);
  return {
    conversation: {
      id: data.id,
      principal: data.principal ?? "",
      started: data.started ?? "",
      last: data.last ?? data.started ?? "",
      turns: data.completions?.length ?? 0,
      cost: costs.length ? costs.reduce((a, b) => a + b, 0) : null,
      refusals: answers.filter((t) => t.refused).length,
      screened: answers.filter((t) => t.screened).length,
      models: [...new Set(answers.map((t) => t.model).filter(Boolean))],
      tokens: answers.reduce((s, t) => ({ in: s.in + (t.tokens?.in ?? 0), out: s.out + (t.tokens?.out ?? 0) }), { in: 0, out: 0 }),
    },
    turns,
  };
}

/**
 * What the register shows beside a row: last seen, cost and controls fired
 * over 30 days, from the row's own metrics and conversations doors. A door
 * that cannot be read leaves the figures unknown rather than zero.
 */
export async function activityOf(id: string): Promise<Activity> {
  try {
    const [m, c] = await Promise.all([applicationMetrics(id, "30d"), listConversations(id, 1)]);
    const screened = Object.values(m.screened).reduce((a, b) => a + b, 0);
    return { last_seen: c[0]?.last || null, cost: m.cost, completions: m.volume, controls_fired: m.refusals + screened, unknown: false };
  } catch {
    return { last_seen: null, cost: null, completions: 0, controls_fired: 0, unknown: true };
  }
}

/* ═══════════════════ snippets ═══════════════════ */

export const GATEWAY_URL = `${PUBLIC_ORIGIN}/api/gateway/v1`;
export const RETRIEVAL_URL = `${PUBLIC_ORIGIN}/api/retrieval`;

export interface SnippetContext {
  key: string;
  principalHeader: string;
  model: string;
  namespace: string;
}

const KEY = (c: SnippetContext) => c.key || "<application key>";

export const SNIPPETS = {
  python: (c: SnippetContext) => `from openai import OpenAI

client = OpenAI(
    base_url="${GATEWAY_URL}",
    api_key="${KEY(c)}",
    default_headers={"${c.principalHeader}": "alice@example.com"},  # who is asking
)

reply = client.chat.completions.create(
    model="${c.model || "MODEL_ID"}",
    messages=[{"role": "user", "content": "Summarise our password policy."}],
)
print(reply.choices[0].message.content)
# A screened prompt is refused with HTTP 400 naming the control; a rate limit is 429, a spent budget 402.`,

  typescript: (c: SnippetContext) => `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${GATEWAY_URL}",
  apiKey: "${KEY(c)}",
  defaultHeaders: { "${c.principalHeader}": "alice@example.com" }, // who is asking
});

const reply = await client.chat.completions.create({
  model: "${c.model || "MODEL_ID"}",
  messages: [{ role: "user", content: "Summarise our password policy." }],
});
console.log(reply.choices[0].message.content);
// A screened prompt is refused with HTTP 400 naming the control; a rate limit is 429, a spent budget 402.`,

  retrieval: (c: SnippetContext) => `curl -X POST ${RETRIEVAL_URL}/search \\
  -H "Authorization: Bearer ${KEY(c)}" \\
  -H "${c.principalHeader}: alice@example.com" \\
  -H "content-type: application/json" \\
  -d '{"query": "retention period for audit logs", "namespace": "${c.namespace || "default"}", "conversation": "conv-1"}'
# Passages are screened before they return; the namespace must be in the policy and the principal's entitlements.
# POST ${RETRIEVAL_URL}/answer with the same body returns citations and a grounding verdict.`,

  retrievalPython: (c: SnippetContext) => `import requests

r = requests.post(
    "${RETRIEVAL_URL}/search",
    headers={"Authorization": "Bearer ${KEY(c)}", "${c.principalHeader}": "alice@example.com"},
    json={"query": "retention period for audit logs", "namespace": "${c.namespace || "default"}", "conversation": "conv-1"},
)
for passage in r.json()["passages"]:
    print(passage["title"], passage["body"][:120])`,
} as const;
