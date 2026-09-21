import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { dbReady, query } from "@/lib/server/db";

/**
 * Everything this factory is configured with, in one read.
 *
 * The Configuration page answers one question: what is wired, and what does it
 * reach. So this assembles the record rather than a settings blob — the models
 * on offer, every connector configured across every deployed workflow, the
 * tools those workflows hold and at what risk, where a person has to sign, and
 * which credentials exist by name.
 *
 * Usage figures come from run journals, so a connector that is configured but
 * has never been called says so. A source nobody reads is the most common kind
 * of wrong configuration and it should be visible, not inferred from silence.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = path.resolve(process.cwd(), "..", "runtime");
const RUNS = path.join(ROOT, "workspace", "runs");

/** The config keys that hold a list of configured backends, per tool server. */
const SLOTS = ["sources", "backends", "transports", "engines", "roots", "peers"] as const;

interface ToolBinding {
  name: string;
  server?: string;
  risk?: string;
  taints?: boolean;
  is_sink?: boolean;
  summary?: string;
  scope?: Record<string, unknown>;
  config?: Record<string, unknown>;
}

interface SpecDoc {
  metadata?: { id?: string; name?: string; description?: string };
  spec?: {
    entry?: string;
    nodes?: { id: string; label?: string; harness?: string }[];
    tools?: ToolBinding[];
    trigger?: { kind?: string };
    policy?: {
      gates?: { at_or_above?: string; approvers?: string[]; nodes?: string[] }[];
      block_tainted_sinks?: boolean;
      injection?: { patterns?: string[]; prohibited?: unknown[] };
    };
  };
}

interface Source {
  name: string;
  kind: string;
  tool: string;
  server: string;
  slot: string;
  agent: string;
  agentName: string;
  node: string;
  taints: boolean;
  sink: boolean;
  risk: string;
  /** Tool calls recorded against the owning tool, all runs. */
  calls: number;
  lastUsed: string | null;
  /** Config keys set on this connector, names only — never values. */
  settings: string[];
  /** Whether a value references the vault rather than sitting in the spec. */
  usesVault: boolean;
}

export async function GET() {
  /* ── the deployed workflows ── */
  let specs: { id: string; doc: SpecDoc; deployed: string | null }[] = [];
  if (await dbReady()) {
    try {
      const rows = await query<{ id: string; spec: SpecDoc; deployed_at: string | null }>(
        "SELECT id, spec, deployed_at FROM workflows ORDER BY id",
      );
      specs = rows.map((r) => ({ id: r.id, doc: r.spec, deployed: r.deployed_at }));
    } catch {
      /* fall through to the files */
    }
  }
  if (!specs.length) {
    try {
      const dir = path.join(ROOT, "workspace", "agents");
      for (const f of (await readdir(dir)).filter((x) => x.endsWith(".json"))) {
        try {
          specs.push({
            id: f.replace(/\.json$/, ""),
            doc: JSON.parse(await readFile(path.join(dir, f), "utf-8")),
            deployed: null,
          });
        } catch {
          /* a spec that will not parse is not deployed either */
        }
      }
    } catch {
      /* nothing registered yet */
    }
  }

  /* ── how often each tool actually ran, and when it last did ── */
  const calls = new Map<string, number>();
  const lastUse = new Map<string, string>();
  let runs = 0;
  try {
    for (const f of (await readdir(RUNS)).filter((x) => x.endsWith(".json"))) {
      let doc: { system?: string; journal?: { entries?: { kind: string; data?: Record<string, unknown> }[] } };
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
      for (const e of doc.journal?.entries ?? []) {
        if (e.kind !== "tool.call") continue;
        const tool = String((e.data as { tool?: string } | undefined)?.tool ?? "");
        if (!tool) continue;
        const key = `${doc.system ?? ""}:${tool}`;
        calls.set(key, (calls.get(key) ?? 0) + 1);
        const prev = lastUse.get(key);
        if (!prev || at > prev) lastUse.set(key, at);
      }
    }
  } catch {
    /* no runs yet */
  }

  /* ── every configured connector, across every workflow ── */
  const sources: Source[] = [];
  const tools: {
    tool: string;
    agent: string;
    agentName: string;
    risk: string;
    taints: boolean;
    sink: boolean;
    scoped: boolean;
    summary: string;
    calls: number;
    lastUsed: string | null;
  }[] = [];
  const gates: { agent: string; agentName: string; atOrAbove: string; approvers: string[] }[] = [];

  for (const { id, doc } of specs) {
    const s = doc.spec;
    if (!s) continue;
    const agentName = doc.metadata?.name ?? id;

    for (const t of s.tools ?? []) {
      const key = `${id}:${t.name}`;
      tools.push({
        tool: t.name,
        agent: id,
        agentName,
        risk: String(t.risk ?? "read"),
        taints: Boolean(t.taints),
        sink: Boolean(t.is_sink),
        scoped: Boolean(t.scope && Object.keys(t.scope).length),
        summary: String(t.summary ?? ""),
        calls: calls.get(key) ?? 0,
        lastUsed: lastUse.get(key) ?? null,
      });

      for (const slot of SLOTS) {
        const list = (t.config?.[slot] as Record<string, unknown>[] | undefined) ?? [];
        if (!Array.isArray(list)) continue;
        for (const entry of list) {
          const settings = Object.keys(entry).filter(
            (k) => !["name", "kind", "attached_to"].includes(k) && entry[k] !== "" && entry[k] != null,
          );
          sources.push({
            name: String(entry.name ?? entry.kind ?? slot),
            kind: String(entry.kind ?? slot),
            tool: t.name.split(".")[0],
            server: String(t.server ?? ""),
            slot,
            agent: id,
            agentName,
            node: String(entry.attached_to ?? ""),
            taints: Boolean(t.taints),
            sink: Boolean(t.is_sink),
            risk: String(t.risk ?? "read"),
            calls: calls.get(key) ?? 0,
            lastUsed: lastUse.get(key) ?? null,
            settings,
            usesVault: JSON.stringify(entry).includes("${secret:"),
          });
        }
      }
    }

    for (const g of s.policy?.gates ?? []) {
      gates.push({
        agent: id,
        agentName,
        atOrAbove: String(g.at_or_above ?? "risky"),
        approvers: (g.approvers ?? []).map(String),
      });
    }
  }

  /* De-duplicate connectors that the same workflow declares twice under one
     binding — the table is a list of what is wired, not of every mention. */
  const seen = new Set<string>();
  const uniqueSources = sources.filter((s) => {
    const k = `${s.agent}:${s.server}:${s.slot}:${s.name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  /* ── models on offer ── */
  let models: { id: string; label: string; class?: string; price_in?: number; price_out?: number }[] = [];
  let defaultModel = "";
  let classDefaults: Record<string, string> = {};
  try {
    const raw = JSON.parse(await readFile(path.join(ROOT, "workspace", "config.json"), "utf-8"));
    models = raw.models ?? [];
    defaultModel = String(raw.default_model ?? "");
    classDefaults = raw.class_defaults ?? {};
  } catch {
    /* nothing configured yet */
  }

  /* ── credentials, by name only ── */
  let vaultKeys: string[] = [];
  try {
    const raw = JSON.parse(await readFile(path.join(ROOT, "workspace", "vault.json"), "utf-8"));
    const store = raw.keys ?? raw.secrets ?? raw;
    vaultKeys = Object.keys(store).filter((k) => !k.startsWith("_"));
  } catch {
    /* no vault on this deployment */
  }

  /* ── ingress keys and queue ── */
  let apiKeys: { name: string; agent: string | null; prefix: string; last_used: string | null; revoked_at: string | null }[] = [];
  let queue: Record<string, unknown> = {};
  if (await dbReady()) {
    try {
      apiKeys = await query("SELECT name, agent, prefix, last_used, revoked_at FROM api_keys ORDER BY created_at DESC");
    } catch {
      /* the table may not exist on an older deployment */
    }
    try {
      const rows = await query<{ status: string; n: string }>(
        "SELECT status, count(*) AS n FROM trigger_jobs GROUP BY status",
      );
      queue = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
    } catch {
      /* no queue table */
    }
  }

  return Response.json({
    deployment: {
      registry: (await dbReady()) ? "postgres" : "files",
      gateway: process.env.FOUNDRY_ENDPOINT ? "Azure AI Foundry" : "not configured",
      endpoint: (process.env.FOUNDRY_ENDPOINT ?? "").split("/openai/")[0],
      runs,
      workflows: specs.length,
      deployed: specs.filter((s) => s.deployed).length,
      egress: (process.env.AF_EGRESS ?? "").split(",").filter(Boolean),
      billing: Boolean(process.env.AZURE_SUBSCRIPTION_ID),
    },
    models,
    defaultModel,
    classDefaults,
    sources: uniqueSources,
    tools,
    gates,
    vaultKeys,
    apiKeys,
    queue,
    basis:
      "assembled from the deployed workflows, the run journals, the deployment configuration and the vault index; credentials appear by name only",
  });
}
