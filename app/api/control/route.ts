import { dbReady, query } from "@/lib/server/db";
import { permit } from "@/lib/server/auth";
import { backendConfigured, backendFetch } from "@/lib/server/backend";
import { readRuns, type RunRow } from "@/lib/server/runs";
import { budgetState, PERIODS, writeBudget, type Period } from "@/lib/server/budget";
import { peerRegistryOf } from "@/lib/api/l7b";
import { skillsOf } from "@/lib/peers";
import type { PartnerPeer } from "@/lib/peers";

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

/** A run row for the wire: the per-call attribution stays behind, FinOps reads it through its own route. */
function withoutCalls(r: RunRow): Omit<RunRow, "calls"> {
  const copy: Partial<RunRow> = { ...r };
  delete copy.calls;
  return copy as Omit<RunRow, "calls">;
}

/* ── liveness: the backend's run ledger carries a `live` flag per run ── */

/**
 * What is in flight right now, asked of the backend on the caller's behalf
 * (backend/CONTRACT.md `GET /api/runs`, the `live` flag). The console no
 * longer holds runtime processes, so it has no process table of its own;
 * without a backend the answer is honestly empty, not guessed from state
 * files that a crashed run leaves saying "running".
 */
async function liveRuns(req: Request): Promise<{ id: string; system: string; startedAt: string }[]> {
  if (!backendConfigured()) return [];
  try {
    const res = await backendFetch(req, "/api/runs", { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return [];
    const d = (await res.json()) as { runs?: { id: string; system: string; started: string; live?: boolean }[] };
    return (d.runs ?? []).filter((r) => r.live).map((r) => ({ id: r.id, system: r.system, startedAt: r.started }));
  } catch {
    return [];
  }
}


/* ── prices: the operator's per-model figures from the Configuration page ── */

import { assumedPrices, priceSheet as prices } from "@/lib/server/prices";
import { azureSpend } from "@/lib/server/azure-spend";

/* ── FinOps: what Azure billed for the resource, and the budget set here ── */

/* ── Partner agents: every A2A peer the estate names, as the peer registry holds it ── */

/**
 * The peers a workflow names (its `peers` bindings' config) and the peers
 * the registry holds (backend/CONTRACT.md "The peer registry"), as one list.
 * Since phase L7 (second round) a peer is spoken to only from the registry,
 * signed, and only once a person approved its pinned card, whatever URL a
 * spec carries; the console never fetches a peer's card itself (an unsigned
 * read is refused by every signed peer). A peer a spec names that the
 * registry does not hold is listed `unregistered`: the runtime refuses it.
 * Without a registry to read, the names are listed `unknown`.
 */
type PeerRow = PartnerPeer;

async function partnerPeers(
  req: Request,
  specs: { id: string; spec: { spec?: { tools?: { config?: { peers?: { name?: string; url?: string }[] } }[] } } }[],
): Promise<PeerRow[]> {
  const named = new Map<string, { url: string; agents: Set<string> }>();
  for (const s of specs) {
    for (const t of s.spec?.spec?.tools ?? []) {
      for (const p of t?.config?.peers ?? []) {
        const name = String(p?.name ?? "");
        if (!name) continue;
        const had = named.get(name) ?? { url: String(p?.url ?? ""), agents: new Set<string>() };
        had.agents.add(s.id);
        named.set(name, had);
      }
    }
  }
  let registry: ReturnType<typeof peerRegistryOf> | null = null;
  if (backendConfigured()) {
    try {
      const res = await backendFetch(req, "/api/peers", { signal: AbortSignal.timeout(5_000) });
      if (res.ok) registry = peerRegistryOf(await res.json());
    } catch {
      registry = null;
    }
  }
  const rows: PeerRow[] = [];
  for (const p of registry?.peers ?? []) {
    const uses = named.get(p.id);
    const card = p.card?.card ?? null;
    rows.push({
      name: p.id,
      title: (card && typeof card.name === "string" && card.name) || p.label,
      url: p.url,
      agent: uses ? [...uses.agents].join(", ") : "",
      status: p.status,
      skills: skillsOf(p.card).length,
      fetched: p.last_fetch?.ok ?? Boolean(p.card),
    });
  }
  for (const [name, n] of named) {
    if (registry?.peers.some((p) => p.id === name)) continue;
    rows.push({ name, title: name, url: n.url, agent: [...n.agents].join(", "), status: registry ? "unregistered" : "unknown", skills: 0, fetched: false });
  }
  const order = ["changed", "unregistered", "pending", "unknown", "approved"];
  return rows.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.name.localeCompare(b.name));
}

export async function GET(req: Request) {
  { const gate = await permit(req, "view"); if (gate) return gate; }
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

  const live = await liveRuns(req);
  const liveBySystem = new Map<string, number>();
  for (const l of live) liveBySystem.set(l.system, (liveBySystem.get(l.system) ?? 0) + 1);

  // Every run is priced. A run with a model that has no configured price is
  // costed at the estimate rate and counted beside the figure as estimated,
  // so the number is always there and the reader knows how firm it is.
  const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
  const unpriced = (rs: RunRow[]): number => rs.filter((r) => r.estimated > 0).length;

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
      unpriced7d: unpriced(recent),
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
  const modelAgg = new Map<string, { in: number; out: number; cost: number; runs: Set<string> }>();
  for (const r of runs.filter(inWeek)) {
    for (const b of r.byModel) {
      const agg = modelAgg.get(b.model) ?? { in: 0, out: 0, cost: 0, runs: new Set<string>() };
      agg.in += b.in;
      agg.out += b.out;
      agg.cost += b.cost;
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

  const peers = await partnerPeers(req, specRows);

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
      unpriced7d: unpriced(recent),
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
      unpriced7d: unpriced(recent),
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
    runs: runs.slice(0, 2000).map((r) => withoutCalls(r)),
    store: db ? "db" : "file (db unreachable)",
    costBasis: `configured price per model × journalled tokens; the scripted provider is zero${assumedPrices().length ? `; list price assumed for ${assumedPrices().join(", ")}` : ""}; any other unpriced model is estimated at the sheet's median rate and counted as estimated`,
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
