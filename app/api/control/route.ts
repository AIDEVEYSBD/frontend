import path from "node:path";
import { dbReady, query } from "@/lib/server/db";
import { permit } from "@/lib/server/auth";
import { activeRuns } from "@/lib/server/active-runs";
import { readRuns, type RunRow } from "@/lib/server/runs";
import { budgetState, PERIODS, writeBudget, type Period } from "@/lib/server/budget";

/**
 * The control plane's one read: everything about the estate, computed from
 * primary records. Costs come from journalled token counts × the gateway's
 * own price sheet (local models are genuinely zero); activity comes from run
 * files the runtime wrote; liveness comes from the process registry. Nothing
 * on the dashboard is typed in, and anything unknowable is reported as
 * unknowable rather than estimated silently.
 *
 * The response carries enough primary detail (every recent run, per-model
 * totals, per-agent history) for the dashboard to answer a click on ANY
 * number with the records behind it — a figure you cannot drill into is a
 * figure you have to take on faith, which is the opposite of this product.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


/* ── prices: the operator's per-model figures from the Configuration page ── */

import { assumedPrices, priceSheet as prices } from "@/lib/server/prices";
import { azureSpend } from "@/lib/server/azure-spend";

/* ── FinOps: what Azure billed for the resource, and the budget set here ── */

/* ── Partner agents: every A2A peer in the estate, card-pinged live ── */

let peerCache: { at: number; rows: { agent: string; name: string; url: string; up: boolean; title: string; skills: number }[] } | null = null;

async function pingPeers(
  specs: { id: string; spec: { spec?: { tools?: { config?: { peers?: { name?: string; url?: string }[] } }[] } } }[],
): Promise<NonNullable<typeof peerCache>["rows"]> {
  if (peerCache && Date.now() - peerCache.at < 60_000) return peerCache.rows;
  const found = new Map<string, { agent: string; name: string; url: string }>();
  for (const s of specs) {
    for (const t of s.spec?.spec?.tools ?? []) {
      for (const p of t?.config?.peers ?? []) {
        if (p?.url) found.set(`${p.name}@${p.url}`, { agent: s.id, name: String(p.name ?? "peer"), url: String(p.url) });
      }
    }
  }
  const rows = await Promise.all(
    [...found.values()].map(async (p) => {
      try {
        const res = await fetch(p.url.replace(/\/$/, "") + "/.well-known/agent.json", {
          signal: AbortSignal.timeout(1_500),
        });
        if (!res.ok) throw new Error(String(res.status));
        const card = await res.json();
        return { ...p, up: true, title: String(card.name ?? p.name), skills: (card.skills ?? []).length };
      } catch {
        return { ...p, up: false, title: p.name, skills: 0 };
      }
    }),
  );
  peerCache = { at: Date.now(), rows };
  return rows;
}

export async function GET() {
  const sheet = await prices();
  const runs = await readRuns(sheet);

  // The deets, durably: every run's tokens/cost/time land in Postgres so any
  // reporting tool can query them without parsing journals. The journal stays
  // the source of truth; this is its indexed shadow.
  if (await dbReady()) {
    try {
      for (const r of runs.slice(0, 200)) {
        await query(
          `INSERT INTO run_metrics (id, system, state, at, duration_ms, tokens_in, tokens_out, cost, denials, models, artifacts)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (id) DO UPDATE SET
             state = EXCLUDED.state, duration_ms = EXCLUDED.duration_ms,
             tokens_in = EXCLUDED.tokens_in, tokens_out = EXCLUDED.tokens_out,
             cost = EXCLUDED.cost, denials = EXCLUDED.denials,
             models = EXCLUDED.models, artifacts = EXCLUDED.artifacts`,
          [r.id, r.system, r.state, r.at, r.ms, r.tokens.in, r.tokens.out, r.cost,
           r.denials, JSON.stringify(r.byModel), JSON.stringify(r.artifactNames)],
        );
      }
    } catch {
      /* metrics mirror is best-effort; the page still renders from journals */
    }
  }
  const week = Date.now() - 7 * 86_400_000;
  const inWeek = (r: RunRow) => new Date(r.at).getTime() >= week;

  // Registry: deployed stamps + eval history per agent. The raw specs feed
  // the posture, routing and partner-agent derivations too.
  let agentsMeta: { id: string; name: string; description: string; deployed_at: string | null; nodes: number }[] = [];
  const evalsByAgent = new Map<string, { passed: number; total: number; at: string; digest: string; model: string }[]>();
  interface SpecRow {
    [k: string]: unknown;
    id: string;
    name: string;
    description: string;
    deployed_at: string | null;
    spec: {
      spec?: {
        nodes?: { id: string; model?: string; harness?: string }[];
        tools?: { name?: string; risk?: string; is_sink?: boolean; taints?: boolean; config?: { peers?: { name?: string; url?: string }[] } }[];
        policy?: { grants?: { node: string; tools: string[] }[]; gates?: { at_or_above?: string }[] };
      };
    };
  }
  let specRows: SpecRow[] = [];
  const db = await dbReady();
  if (db) {
    const rows = await query<SpecRow>(
      "SELECT id, name, description, deployed_at, spec FROM workflows ORDER BY updated_at DESC",
    );
    specRows = rows;
    agentsMeta = rows.map((r) => ({
      id: r.id, name: r.name, description: r.description,
      deployed_at: r.deployed_at, nodes: r.spec?.spec?.nodes?.length ?? 0,
    }));
    const evals = await query<{ agent: string; passed: number; total: number; at: string; digest: string; model: string }>(
      `SELECT agent, passed, total, at, digest, model FROM eval_runs ORDER BY at DESC LIMIT 200`,
    );
    for (const e of evals) {
      const list = evalsByAgent.get(e.agent) ?? [];
      if (list.length < 12) list.push(e);
      evalsByAgent.set(e.agent, list);
    }
  }

  const live = activeRuns();
  const liveBySystem = new Map<string, number>();
  for (const l of live) liveBySystem.set(l.system, (liveBySystem.get(l.system) ?? 0) + 1);

  // A total over what can be priced. A run journalled under a model with no
  // recorded price is counted beside the figure, never folded in as zero and
  // never allowed to blank the whole estate's number.
  const sum = (xs: (number | null)[]): number | null =>
    xs.every((x) => x === null) ? null : xs.reduce((a: number, b) => a + (b ?? 0), 0);
  const unpriced = (xs: (number | null)[]): number => xs.filter((x) => x === null).length;

  const agents = agentsMeta.map((a) => {
    const mine = runs.filter((r) => r.system === a.id);
    const recent = mine.filter(inWeek);
    return {
      ...a,
      active: liveBySystem.get(a.id) ?? 0,
      pending: mine.filter((r) => r.state === "suspended").length,
      runs7d: recent.length,
      runsTotal: mine.length,
      lastRun: mine[0]?.at ?? null,
      lastState: mine[0]?.state ?? null,
      avgMs7d: recent.length ? Math.round(recent.reduce((s, r) => s + r.ms, 0) / recent.length) : null,
      cost7d: sum(recent.map((r) => r.cost)),
      unpriced7d: unpriced(recent.map((r) => r.cost)),
      tokens7d: recent.reduce((s, r) => s + r.tokens.in + r.tokens.out, 0),
      models: [...new Set(recent.flatMap((r) => r.models))],
      /** Last 14 runs, newest last — the health tick strip. */
      ticks: mine.slice(0, 14).reverse().map((r) => ({ id: r.id, state: r.state, at: r.at })),
      evals: evalsByAgent.get(a.id) ?? [],
    };
  });

  // 14-day series for every KPI that has a time shape.
  const days: {
    day: string;
    runs: number;
    cost: number | null;
    denials: number;
    kills: number;
    avgMs: number | null;
    ids: string[];
  }[] = [];
  for (let d = 13; d >= 0; d--) {
    const key = new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
    const inDay = runs.filter((r) => r.at.slice(0, 10) === key);
    days.push({
      day: key,
      runs: inDay.length,
      cost: sum(inDay.map((r) => r.cost)),
      denials: inDay.reduce((s, r) => s + r.denials, 0),
      kills: inDay.filter((r) => r.state === "killed").length,
      avgMs: inDay.length ? Math.round(inDay.reduce((s, r) => s + r.ms, 0) / inDay.length) : null,
      ids: inDay.map((r) => r.id),
    });
  }

  // Model mix: where the tokens actually went, local vs cloud.
  const modelAgg = new Map<string, { in: number; out: number; cost: number | null; runs: Set<string> }>();
  for (const r of runs.filter(inWeek)) {
    for (const b of r.byModel) {
      const agg = modelAgg.get(b.model) ?? { in: 0, out: 0, cost: 0, runs: new Set<string>() };
      agg.in += b.in;
      agg.out += b.out;
      agg.cost = agg.cost === null || b.cost === null ? (b.cost === null ? null : agg.cost) : agg.cost + b.cost;
      if (b.cost === null) agg.cost = null;
      agg.runs.add(r.id);
      modelAgg.set(b.model, agg);
    }
  }
  const models = [...modelAgg.entries()]
    .map(([model, a]) => ({
      model,
      local: model === "scripted",
      tokens: a.in + a.out,
      in: a.in,
      out: a.out,
      cost: a.cost,
      runs: a.runs.size,
    }))
    .sort((a, b) => b.tokens - a.tokens);

  /* ── Least-privilege posture: grants × declared risk × gates, per spec ── */
  const RISK_RANK: Record<string, number> = { read: 1, write: 2, risky: 3, destructive: 4 };
  const posture = {
    grants: 0,
    byRisk: { read: 0, write: 0, risky: 0, destructive: 0 } as Record<string, number>,
    sinks: 0,
    gatedSinks: 0,
    ungated: [] as { agent: string; node: string; tool: string }[],
    taintSplits: 0,
  };
  for (const s of specRows) {
    const tools = new Map((s.spec?.spec?.tools ?? []).map((t) => [String(t.name), t]));
    const gates = s.spec?.spec?.policy?.gates ?? [];
    for (const g of s.spec?.spec?.policy?.grants ?? []) {
      for (const toolName of g.tools ?? []) {
        posture.grants += 1;
        const t = tools.get(toolName);
        const risk = String(t?.risk ?? "read");
        posture.byRisk[risk] = (posture.byRisk[risk] ?? 0) + 1;
        if (t?.taints) posture.taintSplits += 1;
        if (t?.is_sink) {
          posture.sinks += 1;
          const gated = gates.some((x) => (RISK_RANK[x.at_or_above ?? "write"] ?? 2) <= (RISK_RANK[risk] ?? 1));
          if (gated) posture.gatedSinks += 1;
          else posture.ungated.push({ agent: s.id, node: g.node, tool: toolName });
        }
      }
    }
  }

  /* ── Model gateway: which node routes where, across the estate ── */
  const routing = specRows.flatMap((s) =>
    (s.spec?.spec?.nodes ?? [])
      .map((n) => ({ agent: s.id, node: n.id, model: n.model || null }))
      .filter(() => (s.spec?.spec?.nodes ?? []).length > 0),
  );

  /* ── FinOps: billed spend from Azure Cost Management + the budget someone set ── */
  const azure = await azureSpend();
  const budgetNow = await budgetState();
  const budget = budgetNow.budget_usd;

  const peers = await pingPeers(specRows);

  const recent = runs.filter(inWeek);
  return Response.json({
    posture,
    routing,
    peers,
    finops: {
      azure,
      budget,
      period: budgetNow.period,
      /** Spend against the budget in the current rolling period; the enforcement figure. */
      budgetState: budgetNow,
      spend7d: sum(recent.map((r) => r.cost)),
      unpriced7d: unpriced(recent.map((r) => r.cost)),
    },
    ledger: {
      entries: runs.reduce((s, r) => s + r.entries, 0),
      runs: runs.length,
      lastWrite: runs[0]?.at ?? null,
    },
    totals: {
      deployed: agents.filter((a) => a.deployed_at).length,
      registered: agents.length,
      active: live.length,
      pending: runs.filter((r) => r.state === "suspended").length,
      runs7d: recent.length,
      cost7d: sum(recent.map((r) => r.cost)),
      unpriced7d: unpriced(recent.map((r) => r.cost)),
      tokens7d: recent.reduce((s, r) => s + r.tokens.in + r.tokens.out, 0),
      denials7d: recent.reduce((s, r) => s + r.denials, 0),
      kills7d: recent.filter((r) => r.state === "killed").length,
      avgMs7d: recent.length ? Math.round(recent.reduce((s, r) => s + r.ms, 0) / recent.length) : null,
    },
    agents,
    live,
    days,
    models,
    /** Every recent run, newest first — the substance behind every click. */
    runs: runs.slice(0, 2000).map(({ calls, ...r }) => r),
    store: db ? "db" : "file (db unreachable)",
    costBasis: sheet
      ? `configured price per model × journalled tokens; the scripted provider is zero${assumedPrices().length ? `; list price assumed for ${assumedPrices().join(", ")} until one is set on the Configuration page` : ""}`
      : "price sheet unreachable — cloud costs unknown",
  });
}

/** Set the spend budget: an amount per period, stored where every setting lives. */
export async function POST(req: Request) {
  { const gate = await permit(req, "configure"); if (gate) return gate; }
  let body: { budget_usd?: number | null; period?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "send { budget_usd, period }" }, { status: 400 });
  }
  const budget = body.budget_usd === null || body.budget_usd === undefined ? null : Number(body.budget_usd);
  if (budget !== null && (!Number.isFinite(budget) || budget < 0)) {
    return Response.json({ error: "budget_usd must be a non-negative number, or null to clear it" }, { status: 400 });
  }
  const period = (PERIODS as string[]).includes(String(body.period)) ? (body.period as Period) : "month";
  if (!(await dbReady())) return Response.json({ error: "the registry database is unreachable" }, { status: 503 });
  await writeBudget({ budget_usd: budget, period });
  return Response.json({ saved: true, budget_usd: budget, period, state: await budgetState() });
}
