import { dbReady, query } from "@/lib/server/db";
import { assumedPrices, priceSheet } from "@/lib/server/prices";
import { readRuns } from "@/lib/server/runs";
import { azureSpend } from "@/lib/server/azure-spend";
import { readConfig } from "@/app/api/config/route";
import { permit } from "@/lib/server/auth";
import { budgetState, PERIODS, writeBudget, type Period } from "@/lib/server/budget";

/**
 * FinOps: the primary records behind every cost figure, in one read.
 *
 * The page does its own arithmetic over windows and filters, so the route
 * returns the raw material rather than a set of pre-cut totals: every model
 * call attributed to the node that made it, the price sheet and providers it
 * is costed against, the workflow specs whose steps are being routed, and
 * the eval evidence that says which cheaper model held the line on quality.
 * A number on the page is always reproducible from what this returns.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SpecRow {
  [k: string]: unknown;
  id: string;
  name: string;
  deployed_at: string | null;
  spec: {
    spec?: {
      nodes?: { id: string; harness?: string; model?: string; model_class?: string; purpose?: string; description?: string; emits?: unknown }[];
      tools?: { name?: string; risk?: string; is_sink?: boolean }[];
      policy?: { grants?: { node: string; tools: string[] }[]; gates?: { at_or_above?: string }[] };
    };
  };
}

export async function GET() {
  const sheet = await priceSheet();
  const [runs, cfg, azure] = await Promise.all([readRuns(sheet), readConfig(), azureSpend()]);
  const db = await dbReady();

  let specs: SpecRow[] = [];
  let evals: Record<string, unknown>[] = [];
  const budgetNow = await budgetState();
  if (db) {
    specs = await query<SpecRow>("SELECT id, name, deployed_at, spec FROM workflows ORDER BY updated_at DESC");
    const rows = await query<{ id: string; agent: string; model: string; passed: number; total: number; at: string; summary: Record<string, unknown> | null }>(
      "SELECT id, agent, model, passed, total, at, summary FROM eval_runs ORDER BY at DESC LIMIT 120",
    );
    evals = rows.map((r) => ({
      id: r.id,
      agent: r.agent,
      model: r.model,
      passed: r.passed,
      total: r.total,
      at: r.at,
      batch_id: r.summary?.batch_id ?? r.id,
      compare: Boolean(r.summary?.compare),
      forced: Boolean(r.summary?.forced),
      incumbent: r.summary?.incumbent ?? null,
      cost_per_case: typeof r.summary?.cost_per_case === "number" ? r.summary.cost_per_case : null,
      cost_total: typeof r.summary?.cost_total === "number" ? r.summary.cost_total : null,
      avg_ms: typeof r.summary?.avg_ms === "number" ? r.summary.avg_ms : null,
      tokens: r.summary?.tokens ?? null,
    }));
  }

  // Each workflow's steps, with what the spec says about them: which tools
  // the step may call and how risky the riskiest is, and whether a person
  // stands between the step and its sinks. That is what decides whether a
  // step is a candidate for a smaller or local model.
  const RISK_RANK: Record<string, number> = { read: 1, write: 2, risky: 3, destructive: 4 };
  const agents = specs.map((s) => {
    const tools = new Map((s.spec?.spec?.tools ?? []).map((t) => [String(t.name), t]));
    const grants = new Map((s.spec?.spec?.policy?.grants ?? []).map((g) => [g.node, g.tools ?? []]));
    const gated = (s.spec?.spec?.policy?.gates ?? []).length > 0;
    return {
      id: s.id,
      name: s.name,
      deployed: Boolean(s.deployed_at),
      gated,
      nodes: (s.spec?.spec?.nodes ?? []).map((n) => {
        const granted = grants.get(n.id) ?? [];
        const risk = granted.reduce((m, name) => Math.max(m, RISK_RANK[String(tools.get(name)?.risk ?? "read")] ?? 1), 0);
        return {
          id: n.id,
          harness: n.harness ?? "sequence",
          model: n.model ?? "",
          model_class: n.model_class ?? "",
          purpose: String(n.purpose ?? n.description ?? ""),
          tools: granted.length,
          risk: risk === 4 ? "destructive" : risk === 3 ? "risky" : risk === 2 ? "write" : risk === 1 ? "read" : "none",
          sinks: granted.filter((name) => tools.get(name)?.is_sink).length,
          structured: Boolean(n.emits),
        };
      }),
    };
  });

  const calls = runs.flatMap((r) =>
    r.calls.map((c) => ({ run: r.id, system: r.system, at: r.at, state: r.state, ...c })),
  );

  return Response.json({
    now: new Date().toISOString(),
    config: cfg,
    agents,
    runs: runs.map(({ calls: _c, byModel: _b, artifactNames: _a, ...r }) => r),
    calls: calls.slice(0, 40_000),
    evals,
    azure,
    budget: budgetNow.budget_usd,
    period: budgetNow.period,
    budgetState: budgetNow,
    costBasis: sheet
      ? `configured price per model × journalled tokens; local providers are $0 per token and priced by the hour${assumedPrices().length ? `; list price assumed for ${assumedPrices().join(", ")} until one is set on the Configuration page` : ""}`
      : "price sheet unreachable — cloud costs unknown",
  });
}

/** The budget (an amount per period), and nothing else: routes are written through /api/config. */
export async function POST(req: Request) {
  { const gate = await permit(req, "configure"); if (gate) return gate; }
  let body: { budget_usd?: number | null; period?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "send { budget_usd, period }" }, { status: 400 });
  }
  const budget = body.budget_usd === null || body.budget_usd === undefined ? null : Number(body.budget_usd);
  if (budget !== null && !(budget >= 0)) return Response.json({ error: "budget_usd must be a non-negative number" }, { status: 400 });
  const period = (PERIODS as string[]).includes(String(body.period)) ? (body.period as Period) : "month";
  if (await dbReady()) await writeBudget({ budget_usd: budget, period });
  return Response.json({ budget_usd: budget, period, state: await budgetState() });
}
