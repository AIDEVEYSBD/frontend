import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { dbReady, query } from "@/lib/server/db";
import { activeRuns } from "@/lib/server/active-runs";

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

const ROOT = path.resolve(process.cwd(), "..", "runtime");
const RUNS = path.join(ROOT, "workspace", "runs");

/* ── prices, cached; a missing sheet degrades to "cost unknown" ── */

let priceCache: { at: number; map: Map<string, { in: number; out: number }> } | null = null;

async function prices(): Promise<Map<string, { in: number; out: number }> | null> {
  if (priceCache && Date.now() - priceCache.at < 600_000) return priceCache.map;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const map = new Map<string, { in: number; out: number }>();
    for (const m of data.data ?? []) {
      map.set(String(m.id), {
        in: Number(m.pricing?.prompt ?? 0),
        out: Number(m.pricing?.completion ?? 0),
      });
    }
    priceCache = { at: Date.now(), map };
    return map;
  } catch {
    return priceCache?.map ?? null;
  }
}

/* ── FinOps: the gateway's own balance, cached; a set budget from settings ── */

let creditCache: { at: number; data: { total: number; used: number } | null } | null = null;

async function openrouterKey(): Promise<string> {
  try {
    const vault = JSON.parse(
      await readFile(path.join(ROOT, "workspace", "vault.json"), "utf-8"),
    );
    const v = vault?.keys?.openrouter?.value;
    if (typeof v === "string" && v) return v;
  } catch {
    /* fall through */
  }
  return process.env.OPENROUTER_API_KEY ?? process.env.OPEN_ROUTER_API_KEY ?? "";
}

async function liveCredits(): Promise<{ total: number; used: number } | null> {
  if (creditCache && Date.now() - creditCache.at < 300_000) return creditCache.data;
  try {
    const key = await openrouterKey();
    if (!key) throw new Error("no key");
    const res = await fetch("https://openrouter.ai/api/v1/credits", {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const d = await res.json();
    creditCache = {
      at: Date.now(),
      data: { total: Number(d.data?.total_credits ?? 0), used: Number(d.data?.total_usage ?? 0) },
    };
  } catch {
    creditCache = { at: Date.now(), data: creditCache?.data ?? null };
  }
  return creditCache.data;
}

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

interface RunRow {
  id: string;
  system: string;
  state: string;
  at: string;
  ms: number;
  entries: number;
  cost: number | null;
  tokens: { in: number; out: number };
  models: string[];
  suspendedAt: string;
  denials: number;
  modelCalls: number;
  toolCalls: number;
  artifacts: number;
  artifactNames: string[];
  /** Model → token/cost share inside this run, for the drill-down. */
  byModel: { model: string; in: number; out: number; cost: number | null }[];
}

async function readRuns(sheet: Map<string, { in: number; out: number }> | null): Promise<RunRow[]> {
  let files: string[] = [];
  try {
    files = (await readdir(RUNS)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const rows: RunRow[] = [];
  for (const f of files) {
    try {
      const full = path.join(RUNS, f);
      const [raw, st] = await Promise.all([readFile(full, "utf-8"), stat(full)]);
      const run = JSON.parse(raw);
      const entries: { kind: string; node?: string; title?: string; data?: Record<string, unknown> }[] =
        run?.journal?.entries ?? [];
      let denials = 0;
      let modelCalls = 0;
      let toolCalls = 0;
      const artifactNames: string[] = [];
      const perModel = new Map<string, { in: number; out: number }>();
      for (const e of entries) {
        if (e.kind === "denied" || e.kind === "contract.breach") denials += 1;
        if (e.kind === "tool.call") toolCalls += 1;
        if (e.kind === "tool.result") {
          const v = (e.data?.value ?? {}) as Record<string, unknown>;
          if (v.written === true && v.where) {
            const name = String(v.where).split("/").pop() ?? "";
            if (name && !artifactNames.includes(name)) artifactNames.push(name);
          }
        }
        if (e.kind !== "model.call") continue;
        modelCalls += 1;
        // Journals written before the runtime recorded the resolved model
        // titled these entries just "model" — attribute honestly, not wrongly.
        let model = String(e.title ?? "");
        if (!model || model === "model") model = "unattributed (older journal)";
        const tk = (e.data?.tokens ?? {}) as { in?: number; out?: number };
        const agg = perModel.get(model) ?? { in: 0, out: 0 };
        agg.in += Number(tk.in ?? 0);
        agg.out += Number(tk.out ?? 0);
        perModel.set(model, agg);
      }

      const costOf = (model: string, tk: { in: number; out: number }): number | null => {
        if (model.startsWith("ollama/") || model === "scripted") return 0; // genuinely free
        const p = sheet?.get(model);
        return p ? tk.in * p.in + tk.out * p.out : null; // unknown, not zero
      };
      const byModel = [...perModel.entries()].map(([model, tk]) => ({
        model,
        in: tk.in,
        out: tk.out,
        cost: costOf(model, tk),
      }));
      const cost = byModel.some((b) => b.cost === null)
        ? null
        : byModel.reduce((s, b) => s + (b.cost as number), 0);

      rows.push({
        id: f.replace(/\.json$/, ""),
        system: String(run?.system ?? ""),
        state: String(run?.state ?? "unknown"),
        at: st.mtime.toISOString(),
        ms: Number(run?.journal?.duration_ms ?? 0),
        entries: entries.length,
        cost,
        tokens: {
          in: byModel.reduce((s, b) => s + b.in, 0),
          out: byModel.reduce((s, b) => s + b.out, 0),
        },
        models: byModel.map((b) => b.model),
        suspendedAt: run?.state === "suspended" ? String(run?.suspension?.node ?? "") : "",
        denials,
        modelCalls,
        toolCalls,
        artifacts: artifactNames.length,
        artifactNames,
        byModel,
      });
    } catch {
      /* torn write — skip */
    }
  }
  rows.sort((a, b) => (a.at < b.at ? 1 : -1));
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
  let evalsByAgent = new Map<string, { passed: number; total: number; at: string; digest: string; model: string }[]>();
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

  const sum = (xs: (number | null)[]): number | null =>
    xs.some((x) => x === null) ? null : xs.reduce((a: number, b) => a + (b as number), 0);

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
      local: model.startsWith("ollama/") || model === "scripted",
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
      .filter((r) => (s.spec?.spec?.nodes ?? []).length > 0),
  );

  /* ── FinOps: live balance + the budget someone set ── */
  const credits = await liveCredits();
  let budget: number | null = null;
  if (db) {
    const b = await query<{ value: { budget_usd?: number } }>("SELECT value FROM settings WHERE key = 'finops'");
    budget = b[0]?.value?.budget_usd ?? null;
  }

  const peers = await pingPeers(specRows);

  const recent = runs.filter(inWeek);
  return Response.json({
    posture,
    routing,
    peers,
    finops: {
      credits,
      budget,
      spend7d: sum(recent.map((r) => r.cost)),
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
    runs: runs.slice(0, 150).map(({ byModel, ...r }) => ({ ...r, byModel })),
    store: db ? "db" : "file (db unreachable)",
    costBasis: sheet
      ? "openrouter price sheet × journalled tokens; local models are zero"
      : "price sheet unreachable — cloud costs unknown",
  });
}

/** Set the FinOps budget. One number, stored where every setting lives. */
export async function POST(req: Request) {
  let body: { budget_usd?: number };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "send { budget_usd }" }, { status: 400 });
  }
  const budget = Number(body.budget_usd);
  if (!Number.isFinite(budget) || budget < 0) {
    return Response.json({ error: "budget_usd must be a non-negative number" }, { status: 400 });
  }
  if (!(await dbReady())) return Response.json({ error: "the registry database is unreachable" }, { status: 503 });
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('finops', $1, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [{ budget_usd: budget }],
  );
  return Response.json({ saved: true, budget_usd: budget });
}
