import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { dbReady, query } from "@/lib/server/db";

/**
 * The agent roster: every saved workflow as a programme stage, every node in
 * it as an agent on the payroll — purpose, autonomy, place in the hierarchy,
 * and when it last actually ran.
 *
 * Nothing here is typed in by hand. Purpose comes from the node's own persona
 * or plan; autonomy is DERIVED from what the spec grants (tool risk × gates),
 * because an autonomy label an author could set freely would be a caption,
 * not a control; liveness comes from the run records the runtime wrote.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const exec = promisify(execFile);
const ROOT = path.resolve(process.cwd(), "..", "runtime");
const AGENTS = path.join(ROOT, "workspace", "agents");
const RUNS = path.join(ROOT, "workspace", "runs");

/* ── tool risk, introspected from the runtime so the ladder cannot drift ── */

let riskCache: { at: number; map: Record<string, string> } | null = null;

async function riskMap(): Promise<Record<string, string>> {
  if (riskCache && Date.now() - riskCache.at < 600_000) return riskCache.map;
  const { stdout } = await exec(
    "python3",
    [
      "-c",
      "import json; from agentfactory.authoring import CAPABILITIES; " +
        "print(json.dumps({c['name']: c['risk'] for c in CAPABILITIES}))",
    ],
    { cwd: ROOT, timeout: 30_000 },
  );
  riskCache = { at: Date.now(), map: JSON.parse(stdout.trim()) };
  return riskCache.map;
}

const RISK_RANK: Record<string, number> = { read: 1, write: 2, risky: 3, destructive: 4 };

/* ── spec shapes (the parts the roster reads) ── */

interface Node {
  id: string;
  label?: string;
  harness: string;
  persona?: string;
  steps?: { id?: string; tool?: string; prompt?: string }[];
  fanout?: { over?: string };
  max_steps?: number;
  gate?: { approvers?: string[] };
}

interface Doc {
  metadata?: { id?: string; name?: string; description?: string };
  spec?: {
    entry?: string;
    nodes?: Node[];
    edges?: { source: string; target: string }[];
    policy?: {
      grants?: { node: string; tools: string[] }[];
      gates?: { at_or_above?: string }[];
    };
    trigger?: { kind?: string };
  };
}

/* ── derivations ── */

function purposeOf(n: Node): string {
  if (n.persona) {
    const first = n.persona.trim().split(/(?<=\.)\s/)[0] ?? "";
    return first.length > 160 ? first.slice(0, 157) + "…" : first;
  }
  if (n.steps?.length) {
    const chain = n.steps.map((s) => s.id ?? s.tool ?? "step").join(" → ");
    return `Fixed plan, ${n.steps.length} step${n.steps.length === 1 ? "" : "s"}: ${chain}`;
  }
  if (n.harness === "await") return "Suspends the run until a person or external system answers.";
  return n.label ?? n.id;
}

function autonomyOf(
  tools: string[],
  gates: { at_or_above?: string }[],
  risks: Record<string, string>,
): { level: string; bars: number; detail: string } {
  if (!tools.length) {
    return { level: "Advise", bars: 1, detail: "model output only — no tools granted" };
  }
  const worst = Math.max(...tools.map((t) => RISK_RANK[risks[t] ?? "read"] ?? 1));
  if (worst <= 1) {
    return { level: "Read-only", bars: 2, detail: "every granted tool only reads" };
  }
  const gated = gates.some((g) => (RISK_RANK[g.at_or_above ?? "write"] ?? 2) <= worst);
  if (gated) {
    return {
      level: "Act with approval",
      bars: 3,
      detail: "acts on the world behind an approval gate",
    };
  }
  return { level: "Act", bars: 4, detail: "acts on the world without a gate" };
}

/** BFS depth from the entry node — the hierarchy column. */
function stagesOf(entry: string | undefined, nodes: Node[], edges: { source: string; target: string }[]) {
  const depth = new Map<string, number>();
  if (entry) {
    depth.set(entry, 0);
    const queue = [entry];
    while (queue.length) {
      const at = queue.shift()!;
      for (const e of edges.filter((e) => e.source === at)) {
        if (!depth.has(e.target)) {
          depth.set(e.target, (depth.get(at) ?? 0) + 1);
          queue.push(e.target);
        }
      }
    }
  }
  return (id: string) => depth.get(id);
}

/* ── liveness, from the run records the runtime wrote ── */

interface Liveness {
  lastRun?: string;
  runs7d: number;
  pending: number;
  perNode: Map<string, { lastRun?: string; runs7d: number; pending: number }>;
}

async function liveness(): Promise<Map<string, Liveness>> {
  const out = new Map<string, Liveness>();
  const week = Date.now() - 7 * 24 * 3600 * 1000;
  let files: string[] = [];
  try {
    files = (await readdir(RUNS)).filter((f) => f.endsWith(".json"));
  } catch {
    return out;
  }
  for (const f of files) {
    try {
      const full = path.join(RUNS, f);
      const [raw, st] = await Promise.all([readFile(full, "utf-8"), stat(full)]);
      const run = JSON.parse(raw);
      const system = String(run?.system ?? "");
      if (!system) continue;
      const at = st.mtime.toISOString();
      const recent = st.mtime.getTime() >= week;
      const sys =
        out.get(system) ?? { lastRun: undefined, runs7d: 0, pending: 0, perNode: new Map() };
      if (!sys.lastRun || at > sys.lastRun) sys.lastRun = at;
      if (recent) sys.runs7d += 1;

      const suspendedAt =
        run?.state === "suspended" ? String(run?.suspension?.node ?? "") : "";
      if (suspendedAt) sys.pending += 1;

      const seen = new Set<string>();
      for (const e of run?.journal?.entries ?? []) {
        if (e?.kind === "node.enter" && e?.node) seen.add(String(e.node));
      }
      for (const nodeId of seen) {
        const n = sys.perNode.get(nodeId) ?? { lastRun: undefined, runs7d: 0, pending: 0 };
        if (!n.lastRun || at > n.lastRun) n.lastRun = at;
        if (recent) n.runs7d += 1;
        if (suspendedAt === nodeId) n.pending += 1;
        sys.perNode.set(nodeId, n);
      }
      out.set(system, sys);
    } catch {
      /* torn write — skip the file, not the roster */
    }
  }
  return out;
}

/* ── the roster ── */

export async function GET() {
  let docs: { id: string; doc: Doc }[] = [];
  let store = "file";
  if (await dbReady()) {
    const rows = await query<{ id: string; spec: Doc }>(
      "SELECT id, spec FROM workflows ORDER BY updated_at DESC",
    );
    docs = rows.map((r) => ({ id: r.id, doc: r.spec }));
    store = "db";
  } else {
    try {
      for (const f of (await readdir(AGENTS)).filter((f) => f.endsWith(".json"))) {
        try {
          docs.push({
            id: f.replace(/\.json$/, ""),
            doc: JSON.parse(await readFile(path.join(AGENTS, f), "utf-8")),
          });
        } catch {
          /* skip torn files */
        }
      }
      store = "file (db unreachable)";
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  let risks: Record<string, string> = {};
  try {
    risks = await riskMap();
  } catch {
    /* ladder degrades to grant-presence only; labelled below per node */
  }

  const live = await liveness();

  const groups = docs.map(({ id, doc }) => {
    const spec = doc.spec ?? {};
    const nodes = spec.nodes ?? [];
    const edges = spec.edges ?? [];
    const grants = spec.policy?.grants ?? [];
    const gates = spec.policy?.gates ?? [];
    const stageOf = stagesOf(spec.entry, nodes, edges);
    const sys = live.get(id);

    return {
      id,
      name: doc.metadata?.name ?? id,
      description: doc.metadata?.description ?? "",
      trigger: spec.trigger?.kind ?? "prompt",
      lastRun: sys?.lastRun ?? null,
      runs7d: sys?.runs7d ?? 0,
      pending: sys?.pending ?? 0,
      agents: nodes.map((n) => {
        const tools = grants.filter((g) => g.node === n.id).flatMap((g) => g.tools);
        const stage = stageOf(n.id);
        const nl = sys?.perNode.get(n.id);
        return {
          node: n.id,
          label: n.label ?? n.id,
          harness: n.harness,
          purpose: purposeOf(n),
          autonomy: autonomyOf(tools, gates, risks),
          tools,
          hierarchy: {
            stage: stage ?? null,
            of: nodes.length,
            fanout: Boolean(n.fanout),
            maxSteps: n.harness === "delegate" ? (n.max_steps ?? null) : null,
          },
          lastRun: nl?.lastRun ?? null,
          runs7d: nl?.runs7d ?? 0,
          pending: nl?.pending ?? 0,
        };
      }),
    };
  });

  return Response.json({ groups, store });
}
