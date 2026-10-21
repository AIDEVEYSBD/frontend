import { internalHeaders } from "@/lib/server/auth";
import { NAMESPACE_RULE, parseNamespace } from "@/lib/knowledge";
import { rateLimitOf } from "@/lib/api/l7";
import { rateLimitText } from "@/lib/rate-limit";
/**
 * The console's tools, as one catalogue.
 *
 * Both the assistant and the platform's own MCP server expose the same
 * read-only tools over the same APIs the pages call, so a person asking in
 * the console and an agent connecting over MCP see one deployment, described
 * one way. The action tools (starting a workflow) are offered only over MCP,
 * where an API key stands behind the call.
 */

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  action?: boolean;
}

export const CONSOLE_TOOLS: ToolDef[] = [
  {
    name: "platform_status",
    description: "Live totals for this deployment: deployed workflows, runs in flight, gates awaiting a person, runs and spend over the last days, latency, denials and kills, the most recent runs.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "control_firings",
    description: "How often each control has fired across all run journals, by control and by agent, the most recent firings with their reasons, and the posture (workflows, tools, tainting connectors, sinks, gated workflows).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "knowledge_status",
    description: "The knowledge base: curated sources with licence and indexing state, what is staged awaiting a person, index totals (documents, chunks, tokens), the embedding model and store, and the admission record.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "search_knowledge",
    description: "Run the platform's retrieval over the admitted corpus: hybrid search over meaning and words, a cross-encoder rerank against the question, adjacent chunks and the guardrails in the query. Use it for questions about standards, frameworks, threats and guidance that the curated sources cover; cite the source and heading of each passage you rely on. Corpora are namespaced per engagement; without a namespace the default corpus is searched.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The question, in natural language." },
        namespace: { type: "string", description: "Which corpus to search: an engagement's namespace (lowercase letters, digits, hyphens). Omit for the default corpus." },
      },
      required: ["query"],
    },
  },
  {
    name: "configuration",
    description: "What the estate is wired to: connectors in use with calls and last use, the tool registry with risk, where a person signs, models and prices, vault keys, ingress keys and the queue.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "pending_gates",
    description: "Gates awaiting a person right now: which run, which agent and node, what is being asked, what the run decided so far.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "run_record",
    description: "One run's record by id: state, duration, cost, the journal entries (model calls, tool calls, refusals, gates) and the result.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "The run id." } }, required: ["id"] },
  },
  {
    name: "list_workflows",
    description: "The workflows deployed on this platform: id, name, description, the steps each has and the tools each is granted.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "trigger_workflow",
    description: "Start a deployed workflow with an input document. The job is queued, runs under the platform's policy engine, and its run id is returned; read it back with run_record. Requires an API key scoped to the workflow.",
    inputSchema: {
      type: "object",
      properties: {
        workflow: { type: "string", description: "The workflow id, as listed by list_workflows." },
        input: { type: "object", description: "The input document the workflow declares." },
        external_id: { type: "string", description: "Your own id for this piece of work; the same id posted twice is one job." },
      },
      required: ["workflow", "input"],
    },
    action: true,
  },
];

export const READ_TOOLS = CONSOLE_TOOLS.filter((t) => !t.action);

/** Keep a tool result inside a sensible token budget without losing its shape. */
export function clip(value: unknown, max = 7000): string {
  const text = JSON.stringify(value);
  if (text.length <= max) return text;
  return text.slice(0, max) + `… [truncated ${text.length - max} characters]`;
}

async function readApi(origin: string, path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${origin}${path}`, { ...init, signal: AbortSignal.timeout(25_000), headers: { "content-type": "application/json", ...internalHeaders(), ...(init?.headers ?? {}) } });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: `HTTP ${res.status}`, body: text.slice(0, 300) };
  }
}

/**
 * Run one tool against the console's own APIs.
 *
 * `auth` is the caller's credential, forwarded only to the action tools so
 * a workflow starts under the key that asked for it, never under the
 * console's own standing.
 */
export async function runTool(origin: string, name: string, args: Record<string, unknown>, auth?: string): Promise<string> {
  try {
    switch (name) {
      case "platform_status": {
        const d = (await readApi(origin, "/api/control")) as Record<string, unknown>;
        return clip({ totals: d.totals, live: d.live, days: d.days, latency: d.latency, runs: (d.runs as unknown[] | undefined)?.slice(0, 12), peers: d.peers, spend: d.spend ?? d.finops });
      }
      case "control_firings": {
        const d = (await readApi(origin, "/api/guardrails")) as Record<string, unknown>;
        return clip({ runs: d.runs, counts: d.counts, byAgent: d.byAgent, recent: (d.recent as unknown[] | undefined)?.slice(0, 12), posture: d.posture });
      }
      case "knowledge_status": {
        const d = (await readApi(origin, "/api/knowledge")) as Record<string, unknown>;
        const sources = ((d.sources as Record<string, unknown>[] | undefined) ?? []).map((s) => ({ name: s.name, publisher: s.publisher, family: s.family, licence: s.licence, chunks: s.chunks, last_admitted: s.last_admitted }));
        return clip({ ready: d.ready, totals: d.totals, index: d.index, staged: d.staged, admissions: (d.admissions as unknown[] | undefined)?.slice(0, 10), sources });
      }
      case "search_knowledge": {
        const namespace = parseNamespace(args.namespace);
        if (!namespace) return JSON.stringify({ error: NAMESPACE_RULE });
        const d = (await readApi(origin, "/api/knowledge/search", { method: "POST", body: JSON.stringify({ query: String(args.query ?? ""), namespace, limit: 4 }) })) as Record<string, unknown>;
        const hits = ((d.hits as Record<string, unknown>[] | undefined) ?? []).map((h) => ({ source: h.source, heading: h.heading, url: h.url, score: h.score, refs: (h.meta as { refs?: unknown } | undefined)?.refs, body: String(h.body ?? "").slice(0, 900) }));
        return clip({ namespace, stages: d.stages, rerankModel: d.rerankModel, note: d.note, error: d.error, hits }, 9000);
      }
      case "configuration": {
        const d = (await readApi(origin, "/api/configuration")) as Record<string, unknown>;
        return clip({ deployment: d.deployment, models: d.models, defaultModel: d.defaultModel, sources: d.sources, tools: d.tools, gates: d.gates, vaultKeys: d.vaultKeys, apiKeys: d.apiKeys, queue: d.queue });
      }
      case "pending_gates": {
        const d = (await readApi(origin, "/api/approvals")) as Record<string, unknown>;
        return clip({ count: d.count, pending: d.pending });
      }
      case "run_record": {
        const id = String(args.id ?? "").trim();
        if (!/^[a-zA-Z0-9._-]+$/.test(id)) return JSON.stringify({ error: "bad run id" });
        const d = (await readApi(origin, `/api/runs/${encodeURIComponent(id)}`)) as Record<string, unknown>;
        const run = (d.run ?? d) as Record<string, unknown>;
        const journal = run.journal as { entries?: Record<string, unknown>[] } | undefined;
        return clip({
          id: run.id ?? id,
          system: run.system,
          state: run.state,
          error: run.error,
          suspension: run.suspension,
          result: run.result,
          entries: (journal?.entries ?? []).map((e) => ({ kind: e.kind, node: e.node, title: e.title, detail: e.detail, control: (e.data as { control?: string } | undefined)?.control })),
        }, 9000);
      }
      case "list_workflows": {
        const d = (await readApi(origin, "/api/agents")) as Record<string, unknown> | Record<string, unknown>[];
        const list = (Array.isArray(d) ? d : ((d as Record<string, unknown>).agents as Record<string, unknown>[] | undefined) ?? []) as Record<string, unknown>[];
        const out: unknown[] = [];
        for (const a of list.slice(0, 12)) {
          const id = String(a.id ?? "");
          let doc: Record<string, unknown> = {};
          try {
            doc = ((await readApi(origin, `/api/agents?id=${encodeURIComponent(id)}`)) as { spec?: Record<string, unknown> }).spec ?? {};
          } catch {
            /* the summary still lists it */
          }
          const meta = (doc.metadata as Record<string, unknown> | undefined) ?? {};
          const inner = (doc.spec as Record<string, unknown> | undefined) ?? {};
          const rawNodes = inner.nodes;
          const nodes = (Array.isArray(rawNodes) ? rawNodes : rawNodes && typeof rawNodes === "object" ? Object.values(rawNodes) : []) as Record<string, unknown>[];
          out.push({
            id,
            name: meta.name ?? a.name,
            description: meta.description ?? a.description,
            owner: meta.owner,
            entry: inner.entry,
            steps: nodes.map((n) => ({ id: n.id, label: n.label, harness: n.harness, steps: Array.isArray(n.steps) ? n.steps.length : undefined })),
            tools: Array.isArray(inner.tools) ? inner.tools.map((t) => (typeof t === "string" ? t : (t as { name?: string; id?: string }).name ?? (t as { id?: string }).id)) : inner.tools && typeof inner.tools === "object" ? Object.keys(inner.tools) : undefined,
            trigger: inner.trigger,
          });
        }
        return clip(out, 9000);
      }
      case "trigger_workflow": {
        const id = String(args.workflow ?? "").trim();
        if (!/^[a-zA-Z0-9._-]+$/.test(id)) return JSON.stringify({ error: "bad workflow id" });
        const res = await fetch(`${origin}/api/trigger/${encodeURIComponent(id)}`, {
          method: "POST",
          signal: AbortSignal.timeout(25_000),
          headers: { "content-type": "application/json", ...internalHeaders(), ...(auth ? { authorization: auth } : {}) },
          body: JSON.stringify({ input: args.input ?? {}, external_id: args.external_id, source: "mcp" }),
        });
        const text = await res.text();
        let d: unknown;
        try {
          d = JSON.parse(text);
        } catch {
          d = { error: `HTTP ${res.status}`, body: text.slice(0, 300) };
        }
        // A rate limit (429, L7) queued nothing: said first, with when to try
        // again (the body's retry_after_s, the Retry-After header otherwise).
        const limited = rateLimitOf(res.status, d, res.headers.get("retry-after"));
        if (limited) return clip({ rate_limited: rateLimitText(limited), retry_after_s: limited.retry_after_s, ...(d as Record<string, unknown>) });
        // During a lockdown the door still enqueues, and its answer carries
        // `lockdown: {reason, by, at, says}`: the job waits on the queue and
        // no worker claims it until the lockdown is lifted. Said first, so
        // the caller cannot read the 202 as the run having started.
        const hold = d && typeof d === "object" ? (d as { lockdown?: { says?: unknown } | null }).lockdown : null;
        return clip(hold && typeof hold === "object" ? { held_by_lockdown: String(hold.says ?? "the estate is locked down; the job waits on the queue"), ...(d as Record<string, unknown>) } : d);
      }
      default:
        return JSON.stringify({ error: `no such tool ${name}` });
    }
  } catch (e) {
    return JSON.stringify({ error: (e as Error).message });
  }
}
