import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { dbReady, query } from "@/lib/server/db";

/**
 * What the guardrails actually did, counted from the record.
 *
 * The page beside this describes the controls; this endpoint says how often
 * each one fired, on which agent, and shows the last few in their own words.
 * Every number is derived from run journals and deployed specs — there is no
 * counter incremented anywhere, because a counter can drift from the evidence
 * and the evidence is the thing a reviewer will ask for.
 *
 * A control that has never fired reports zero rather than being omitted. Zero
 * refusals and no coverage must never render the same.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = path.resolve(process.cwd(), "..", "runtime");
const RUNS = path.join(ROOT, "workspace", "runs");

interface Entry {
  kind: string;
  node?: string;
  title?: string;
  detail?: string;
  t?: number;
  data?: Record<string, unknown>;
}

interface Event {
  control: string;
  run: string;
  agent: string;
  node: string;
  title: string;
  detail: string;
  at: string;
}

interface SpecDoc {
  metadata?: { id?: string; name?: string };
  spec?: {
    nodes?: { id: string; label?: string }[];
    tools?: {
      name: string;
      risk?: string;
      taints?: boolean;
      is_sink?: boolean;
      scope?: Record<string, unknown>;
    }[];
    policy?: {
      gates?: { at_or_above?: string; approvers?: string[] }[];
      block_tainted_sinks?: boolean;
      injection?: { patterns?: string[]; prohibited?: unknown[] };
      grants?: Record<string, unknown>;
    };
  };
}

/** The journal kind, or the finer `control` the policy engine recorded. */
function controlOf(e: Entry): string {
  const named = (e.data as { control?: string } | undefined)?.control;
  if (named) return named;
  if (e.kind === "denied") return "capability";
  if (e.kind === "gate.open" || e.kind === "gate.answer") return "gate";
  if (e.kind === "taint") return "taint";
  if (e.kind === "contract.breach") return "contract.breach";
  return e.kind;
}

export async function GET() {
  const counts = new Map<string, number>();
  const byAgent = new Map<string, Map<string, number>>();
  const recent: Event[] = [];
  let runs = 0;
  let runsWithARefusal = 0;

  let files: string[] = [];
  try {
    files = (await readdir(RUNS)).filter((f) => f.endsWith(".json"));
  } catch {
    /* no runs yet on this deployment */
  }

  for (const f of files) {
    let doc: { system?: string; journal?: { entries?: Entry[] } };
    let at = "";
    try {
      const full = path.join(RUNS, f);
      const [raw, st] = await Promise.all([readFile(full, "utf-8"), stat(full)]);
      doc = JSON.parse(raw);
      at = st.mtime.toISOString();
    } catch {
      continue;
    }
    runs += 1;
    const agent = String(doc.system ?? "");
    let refusedHere = false;

    for (const e of doc.journal?.entries ?? []) {
      if (!["denied", "gate.open", "taint", "contract.breach"].includes(e.kind)) continue;
      const control = controlOf(e);
      counts.set(control, (counts.get(control) ?? 0) + 1);
      const perAgent = byAgent.get(agent) ?? new Map<string, number>();
      perAgent.set(control, (perAgent.get(control) ?? 0) + 1);
      byAgent.set(agent, perAgent);
      if (e.kind === "denied") refusedHere = true;
      recent.push({
        control,
        run: f.replace(/\.json$/, ""),
        agent,
        node: String(e.node ?? ""),
        title: String(e.title ?? ""),
        detail: String(e.detail ?? "").slice(0, 400),
        at,
      });
    }
    if (refusedHere) runsWithARefusal += 1;
  }

  recent.sort((a, b) => b.at.localeCompare(a.at));

  /* ── what the deployed workflows declare ──
     Counting the posture, not the traffic: how many tools taint, how many act
     outside the system, how many nodes hold a gate. A control that nothing
     declares is a control that can never fire, and the page should say so. */
  const posture = {
    agents: 0,
    tools: 0,
    tainting: 0,
    sinks: 0,
    scoped: 0,
    gatedWorkflows: 0,
    blockingTaintedSinks: 0,
    withInjectionPatterns: 0,
    byRisk: {} as Record<string, number>,
  };

  let specs: SpecDoc[] = [];
  if (await dbReady()) {
    try {
      const rows = await query<{ spec: SpecDoc }>("SELECT spec FROM workflows");
      specs = rows.map((r) => r.spec);
    } catch {
      /* fall through to the files */
    }
  }
  if (!specs.length) {
    try {
      const dir = path.join(ROOT, "workspace", "agents");
      for (const f of (await readdir(dir)).filter((x) => x.endsWith(".json"))) {
        try {
          specs.push(JSON.parse(await readFile(path.join(dir, f), "utf-8")));
        } catch {
          /* a spec that will not parse is not deployed either */
        }
      }
    } catch {
      /* no registry on this deployment */
    }
  }

  for (const doc of specs) {
    const s = doc.spec;
    if (!s) continue;
    posture.agents += 1;
    for (const t of s.tools ?? []) {
      posture.tools += 1;
      if (t.taints) posture.tainting += 1;
      if (t.is_sink) posture.sinks += 1;
      if (t.scope && Object.keys(t.scope).length) posture.scoped += 1;
      const risk = String(t.risk ?? "read");
      posture.byRisk[risk] = (posture.byRisk[risk] ?? 0) + 1;
    }
    const p = s.policy ?? {};
    if ((p.gates ?? []).length) posture.gatedWorkflows += 1;
    if (p.block_tainted_sinks) posture.blockingTaintedSinks += 1;
    if ((p.injection?.patterns ?? []).length || (p.injection?.prohibited ?? []).length) {
      posture.withInjectionPatterns += 1;
    }
  }

  return Response.json({
    runs,
    runsWithARefusal,
    counts: Object.fromEntries(counts),
    byAgent: Object.fromEntries([...byAgent].map(([a, m]) => [a, Object.fromEntries(m)])),
    recent: recent.slice(0, 40),
    posture,
    basis:
      "counted from run journals in the workspace and the deployed specs in the registry; a control that never fired reports zero",
  });
}
