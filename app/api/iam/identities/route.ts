import path from "node:path";
import { permit, session as whoIs, signer, ssoEnabled } from "@/lib/server/auth";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile } from "node:fs/promises";
import { dbReady, query } from "@/lib/server/db";
import { loadServers, saveServers } from "@/lib/server/mcp";
import { registryTools, riskOf, RISK_ORDER, type Risk } from "@/lib/server/mcp-call";
import { agentActivityFor } from "@/lib/demo-activity";

/**
 * The non-human identity register.
 *
 * Every principal that is not a person and can act on this deployment, in one
 * list: workflows, attached agents, MCP servers, API keys and vault
 * credentials. Nothing here is a new source of truth — each row is read from
 * the record that already governs it (the registry tables, the MCP registry,
 * the vault, the run metrics) and joined to the one thing this page adds: a
 * human owner, a purpose and a review date per identity, in `nhi_owners`.
 *
 * Findings are computed on every read from the same records, so a key that
 * was never used, a credential nothing references, or a server no workflow
 * holds is visible the moment it is true and gone the moment it is fixed.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = path.resolve(process.cwd(), "..", "runtime");
const AGENTS = path.join(ROOT, "workspace", "agents");
const exec = promisify(execFile);
const ID = /^[A-Za-z0-9._:@+-]{1,120}$/;

type Kind = "workflow" | "attached_agent" | "mcp_server" | "api_key" | "vault_credential";
const KINDS: Kind[] = ["workflow", "attached_agent", "mcp_server", "api_key", "vault_credential"];

interface Owner extends Record<string, unknown> { owner: string; owner_sub: string | null; purpose: string; review_due_at: string | null; updated_at: string; updated_by: string }

interface Identity {
  kind: Kind;
  id: string;
  name: string;
  description: string;
  /** What authenticates or authorises this identity, in words. */
  credential: string;
  /** What it may reach, in words. */
  privileges: string;
  risk: Risk | "";
  status: string;
  created_at: string | null;
  last_used: string | null;
  runs30d: number | null;
  owner: Owner | null;
  href: string | null;
  /** Kind-specific facts the page draws from. */
  facts: Record<string, unknown>;
}

interface Finding {
  id: string;
  severity: "warn" | "err" | "info";
  identity: { kind: Kind; id: string; name: string };
  title: string;
  detail: string;
  /** What the page can do about it, mapped onto existing endpoints. */
  action?: { label: string; op: "revoke_key" | "rotate_key" | "block_agent" | "gate_agent" | "disconnect_server" | "remove_secret" | "assign_owner" | "open_builder" };
}

interface SpecDoc {
  metadata?: { id?: string; name?: string; description?: string };
  spec?: {
    trigger?: { kind?: string };
    tools?: { name: string; server?: string; risk?: string; scope?: unknown }[];
    policy?: { grants?: Record<string, { tools?: string[] }> | { node: string; tools: string[] }[]; gates?: { at_or_above?: string; approvers?: string[] }[] };
    nodes?: unknown[];
  };
}

const SECRET = /\$\{secret:([A-Za-z0-9_-]+)\}/g;

function maxRisk(risks: (string | undefined)[]): Risk | "" {
  let best = -1;
  for (const r of risks) {
    const i = RISK_ORDER.indexOf((r ?? "") as Risk);
    if (i > best) best = i;
  }
  return best < 0 ? "" : RISK_ORDER[best];
}

async function workflows(): Promise<{ id: string; name: string; description: string; spec: SpecDoc; deployed_at: string | null; updated_at: string | null }[]> {
  if (await dbReady()) {
    try {
      const rows = await query<{ id: string; name: string; description: string; spec: SpecDoc; deployed_at: string | null; updated_at: string | null }>(
        "SELECT id, name, description, spec, deployed_at, updated_at FROM workflows ORDER BY updated_at DESC",
      );
      if (rows.length) return rows;
    } catch {
      /* files below */
    }
  }
  const out = [];
  try {
    for (const f of (await readdir(AGENTS)).filter((x) => x.endsWith(".json"))) {
      try {
        const spec = JSON.parse(await readFile(path.join(AGENTS, f), "utf-8")) as SpecDoc;
        out.push({ id: String(spec.metadata?.id ?? f.replace(/\.json$/, "")), name: String(spec.metadata?.name ?? ""), description: String(spec.metadata?.description ?? ""), spec, deployed_at: null, updated_at: null });
      } catch {
        /* skip */
      }
    }
  } catch {
    /* none */
  }
  return out;
}

async function vaultKeys(): Promise<{ name: string; label: string; used_by: string[]; created: string; last_used: string; set: boolean }[]> {
  try {
    const { stdout } = await exec("python3", ["-m", "agentfactory", "vault", "list"], { cwd: ROOT, timeout: 20_000 });
    return stdout
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
      .filter((k) => k && typeof k.name === "string");
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  { const gate = await permit(req, "iam"); if (gate) return gate; }
  const db = await dbReady();
  const [wfs, servers, granted, vault] = await Promise.all([workflows(), loadServers(), registryTools(), vaultKeys()]);

  // ── measured activity ──
  const runsBySystem = new Map<string, { runs: number; last: string | null; denials: number }>();
  const callsByTool = new Map<string, { n: number; last: string | null }>();
  const owners = new Map<string, Owner>();
  let keys: { id: string; name: string; agent: string | null; prefix: string; created_at: string; last_used: string | null; revoked_at: string | null }[] = [];
  let attached: { id: string; name: string; mode: string; framework: string; owner: string; key_prefix: string; grants: unknown; gate_at: string; injection: string; blocked: boolean; created_at: string; last_seen: string | null; demo: boolean }[] = [];
  if (db) {
    try {
      for (const r of await query<{ system: string; runs: string; last: string | null; denials: string }>(
        "SELECT system, count(*) AS runs, max(at) AS last, coalesce(sum(denials), 0) AS denials FROM run_metrics WHERE at > now() - interval '30 days' GROUP BY system",
      ))
        runsBySystem.set(r.system, { runs: Number(r.runs), last: r.last, denials: Number(r.denials) });
      for (const r of await query<{ tool: string; n: string; last: string | null }>(
        `SELECT e->>'title' AS tool, count(*) AS n, max(r.at) AS last
           FROM runs r, jsonb_array_elements(r.run->'journal'->'entries') e
          WHERE r.at > now() - interval '30 days' AND e->>'kind' = 'tool.call' GROUP BY 1`,
      ))
        callsByTool.set(r.tool, { n: Number(r.n), last: r.last });
      for (const o of await query<Owner & { kind: string; id: string }>("SELECT kind, id, owner, owner_sub, purpose, review_due_at, updated_at, updated_by FROM nhi_owners"))
        owners.set(`${o.kind}:${o.id}`, { owner: o.owner, owner_sub: o.owner_sub, purpose: o.purpose, review_due_at: o.review_due_at, updated_at: o.updated_at, updated_by: o.updated_by });
      keys = await query("SELECT id, name, agent, prefix, created_at, last_used, revoked_at FROM api_keys ORDER BY created_at DESC");
      attached = await query("SELECT id, name, mode, framework, owner, key_prefix, grants, gate_at, injection, blocked, created_at, last_seen, demo FROM attached_agents ORDER BY created_at DESC");
    } catch {
      /* degraded: the rows below carry what could be read */
    }
  }
  const ownerOf = (kind: Kind, id: string) => owners.get(`${kind}:${id}`) ?? null;

  // Binding name → server id, from every spec, so a runtime journal's tool title maps to its server.
  const bindingServer = new Map<string, string>();
  const serverRefs = new Map<string, Set<string>>();
  const secretRefs = new Map<string, Set<string>>();
  for (const w of wfs) {
    for (const t of w.spec.spec?.tools ?? []) {
      if (t.server) {
        bindingServer.set(t.name, t.server);
        if (!serverRefs.has(t.server)) serverRefs.set(t.server, new Set());
        serverRefs.get(t.server)!.add(w.id);
      }
    }
    for (const m of JSON.stringify(w.spec).matchAll(SECRET)) {
      if (!secretRefs.has(m[1])) secretRefs.set(m[1], new Set());
      secretRefs.get(m[1])!.add(w.id);
    }
  }
  for (const s of servers) for (const m of JSON.stringify(s.env ?? {}).matchAll(SECRET)) {
    if (!secretRefs.has(m[1])) secretRefs.set(m[1], new Set());
    secretRefs.get(m[1])!.add(`mcp:${s.id}`);
  }
  const callsByServer = new Map<string, { n: number; last: string | null }>();
  for (const [tool, c] of callsByTool) {
    const server = servers.find((s) => tool.startsWith(`${s.id}.`))?.id ?? bindingServer.get(tool);
    if (!server) continue;
    const agg = callsByServer.get(server) ?? { n: 0, last: null };
    agg.n += c.n;
    if (!agg.last || (c.last && c.last > agg.last)) agg.last = c.last;
    callsByServer.set(server, agg);
  }

  const identities: Identity[] = [];
  const findings: Finding[] = [];
  const push = (f: Omit<Finding, "id">) => findings.push({ id: `${f.identity.kind}:${f.identity.id}:${f.title}`.replace(/\s+/g, "-").toLowerCase(), ...f });

  // ── workflows ──
  for (const w of wfs) {
    const tools = w.spec.spec?.tools ?? [];
    const gates = w.spec.spec?.policy?.gates ?? [];
    const gateAt = gates.map((g) => g.at_or_above).filter(Boolean).sort((a, b) => RISK_ORDER.indexOf(a as Risk) - RISK_ORDER.indexOf(b as Risk))[0] ?? "";
    const risk = maxRisk(tools.map((t) => t.risk));
    const stats = runsBySystem.get(w.id);
    const secrets = [...secretRefs.entries()].filter(([, by]) => by.has(w.id)).map(([n]) => n);
    identities.push({
      kind: "workflow",
      id: w.id,
      name: w.name || w.id,
      description: w.description,
      credential: secrets.length ? `runs as the platform; resolves ${secrets.map((s) => `\${secret:${s}}`).join(", ")} at call time` : "runs as the platform; no standing credential of its own",
      privileges: `${tools.length} tool${tools.length === 1 ? "" : "s"} · ${gateAt ? `gate at ${gateAt}` : "no gate"} · trigger ${w.spec.spec?.trigger?.kind ?? "prompt"}`,
      risk,
      status: w.deployed_at ? "deployed" : "saved",
      created_at: w.updated_at,
      last_used: stats?.last ?? null,
      runs30d: stats?.runs ?? 0,
      owner: ownerOf("workflow", w.id),
      href: `/builder?load=${encodeURIComponent(w.id)}`,
      facts: { tools: tools.length, gate: gateAt, trigger: w.spec.spec?.trigger?.kind ?? "prompt", denials30d: stats?.denials ?? 0, secrets },
    });
    if (risk && RISK_ORDER.indexOf(risk) >= RISK_ORDER.indexOf("risky") && !gateAt)
      push({ severity: "err", identity: { kind: "workflow", id: w.id, name: w.name || w.id }, title: "Risky tools without a gate", detail: `Holds a ${risk} tool and declares no human gate; every action runs on the agent's own authority.`, action: { label: "Open in builder", op: "open_builder" } });
    if (w.deployed_at && !stats?.runs)
      push({ severity: "info", identity: { kind: "workflow", id: w.id, name: w.name || w.id }, title: "Deployed but idle", detail: "No run in the last 30 days. An identity nobody exercises is one nobody would notice being misused." });
    for (const s of secrets) if (!vault.some((k) => k.name === s && k.set))
      push({ severity: "err", identity: { kind: "workflow", id: w.id, name: w.name || w.id }, title: `Dangling credential reference \${secret:${s}}`, detail: "The workflow references a vault name that is not set on this deployment; the tool call will fail naming the key." });
  }

  // ── attached agents ──
  for (const a of attached) {
    const grants = Array.isArray(a.grants) ? a.grants.map(String) : [];
    const risk = maxRisk(grants.map((g) => { const t = granted.find((x) => x.name === g); return t ? riskOf(t.tool) : undefined; }));
    const stats = a.demo ? { runs: agentActivityFor(a.id, a.mode as "sdk" | "a2a").runs30d, last: agentActivityFor(a.id, a.mode as "sdk" | "a2a").lastSeen, denials: 0 } : runsBySystem.get(a.id);
    identities.push({
      kind: "attached_agent",
      id: a.id,
      name: a.name,
      description: `${a.mode === "sdk" ? "Attached over the SDK" : "Attached over A2A"} · ${a.framework}`,
      credential: `API key ${a.key_prefix}… scoped to this agent`,
      privileges: `${grants.length} tool${grants.length === 1 ? "" : "s"} granted · ${a.gate_at ? `gate at ${a.gate_at}` : "no gate"} · injection ${a.injection}`,
      risk,
      status: a.blocked ? "blocked" : "active",
      created_at: a.created_at,
      last_used: stats?.last ?? a.last_seen,
      runs30d: stats?.runs ?? 0,
      owner: ownerOf("attached_agent", a.id) ?? (a.owner ? { owner: a.owner, owner_sub: null, purpose: "", review_due_at: null, updated_at: a.created_at, updated_by: "attach form" } : null),
      href: "/configuration#agents",
      facts: { mode: a.mode, grants, gate_at: a.gate_at, injection: a.injection, blocked: a.blocked, demo: a.demo },
    });
    if (!a.blocked && grants.some((g) => { const t = granted.find((x) => x.name === g); return t && RISK_ORDER.indexOf(riskOf(t.tool)) >= RISK_ORDER.indexOf("write"); }) && !a.gate_at)
      push({ severity: "warn", identity: { kind: "attached_agent", id: a.id, name: a.name }, title: "Write tools without a gate", detail: "Granted a tool that acts outside the system and no gate risk is set; the broker will forward such calls without a person.", action: { label: "Gate at write", op: "gate_agent" } });
    if (!a.blocked && a.mode === "a2a" && grants.length === 0)
      push({ severity: "info", identity: { kind: "attached_agent", id: a.id, name: a.name }, title: "No tools granted", detail: "The broker lists nothing for this agent, so every tool call is refused and recorded. Grant what it needs in its policy." });
  }

  // ── MCP servers ──
  for (const s of servers) {
    const risks = s.tools.map((t) => riskOf(t));
    const refs = serverRefs.get(s.id) ?? new Set<string>();
    const grantedTo = attached.filter((a) => (Array.isArray(a.grants) ? a.grants : []).some((g) => String(g).startsWith(`${s.id}.`))).map((a) => a.id);
    const calls = callsByServer.get(s.id);
    const env = Object.keys(s.env ?? {});
    identities.push({
      kind: "mcp_server",
      id: s.id,
      name: s.label || s.id,
      description: `${s.command} ${s.args.join(" ")}`.slice(0, 160),
      credential: env.length ? `runs with ${env.length} environment value${env.length === 1 ? "" : "s"} (${env.join(", ")})` : "runs with no credential of its own",
      privileges: `${s.tools.length} tool${s.tools.length === 1 ? "" : "s"} · ${risks.filter((r) => r === "read").length} read · ${risks.filter((r) => r !== "read").length} write or above · held by ${refs.size} workflow${refs.size === 1 ? "" : "s"}, ${grantedTo.length} attached agent${grantedTo.length === 1 ? "" : "s"}`,
      risk: maxRisk(risks),
      status: refs.size || grantedTo.length ? "in use" : "unreferenced",
      created_at: s.discovered_at ?? null,
      last_used: calls?.last ?? null,
      runs30d: calls?.n ?? 0,
      owner: ownerOf("mcp_server", s.id),
      href: null,
      facts: { tools: s.tools.map((t) => t.name), workflows: [...refs], attached: grantedTo, calls30d: calls?.n ?? 0 },
    });
    if (!refs.size && !grantedTo.length)
      push({ severity: "warn", identity: { kind: "mcp_server", id: s.id, name: s.label || s.id }, title: "Connected but held by nothing", detail: "No workflow binds this server and no attached agent is granted its tools. A reachable capability nobody uses is attack surface with no owner.", action: { label: "Disconnect", op: "disconnect_server" } });
  }

  // ── API keys ──
  const dayMs = 86_400_000;
  for (const k of keys) {
    const ageDays = (Date.now() - new Date(k.created_at).getTime()) / dayMs;
    const scoped = k.agent ? `scoped to ${k.agent}` : "any workflow";
    identities.push({
      kind: "api_key",
      id: k.id,
      name: k.name,
      description: k.revoked_at ? `revoked ${new Date(k.revoked_at).toISOString().slice(0, 10)}` : scoped,
      credential: `bearer key ${k.prefix}… · stored as a SHA-256 hash`,
      privileges: k.agent ? `trigger, SDK and A2A doors for ${k.agent}` : "trigger any workflow · read the MCP server · answer gates with a signature",
      risk: k.agent ? "write" : "risky",
      status: k.revoked_at ? "revoked" : "active",
      created_at: k.created_at,
      last_used: k.last_used,
      runs30d: null,
      owner: ownerOf("api_key", k.id),
      href: "/configuration#ingress",
      facts: { agent: k.agent, prefix: k.prefix, revoked_at: k.revoked_at },
    });
    if (k.revoked_at) continue;
    if (!k.last_used && ageDays > 7)
      push({ severity: "warn", identity: { kind: "api_key", id: k.id, name: k.name }, title: "Never used", detail: `Minted ${Math.round(ageDays)} days ago and never presented. A live credential nobody uses should not exist.`, action: { label: "Revoke", op: "revoke_key" } });
    if (ageDays > 90)
      push({ severity: "warn", identity: { kind: "api_key", id: k.id, name: k.name }, title: "Older than 90 days", detail: "Rotation is due: mint a replacement, move the holder onto it, revoke this one.", action: { label: "Rotate", op: "rotate_key" } });
    if (!k.agent)
      push({ severity: "info", identity: { kind: "api_key", id: k.id, name: k.name }, title: "Not scoped to one agent", detail: "This key can start any workflow. Prefer a key per integration, scoped to the one workflow it drives." });
  }

  // ── vault credentials ──
  for (const v of vault) {
    const refs = secretRefs.get(v.name) ?? new Set<string>();
    identities.push({
      kind: "vault_credential",
      id: v.name,
      name: v.label || v.name,
      description: v.set ? `\${secret:${v.name}}` : `\${secret:${v.name}} · no value set`,
      credential: "stored in the workspace vault; resolved into tool arguments at call time, never into prompts",
      privileges: refs.size ? `referenced by ${[...refs].join(", ")}` : "referenced by nothing",
      risk: "",
      status: v.set ? (refs.size ? "in use" : "unreferenced") : "unset",
      created_at: v.created || null,
      last_used: v.last_used || null,
      runs30d: null,
      owner: ownerOf("vault_credential", v.name),
      href: "/settings",
      facts: { referenced_by: [...refs], declared_users: v.used_by, set: v.set },
    });
    if (v.set && !refs.size)
      push({ severity: "warn", identity: { kind: "vault_credential", id: v.name, name: v.label || v.name }, title: "Credential nothing references", detail: "No workflow or MCP server names this secret. Remove it, or record why it is kept.", action: { label: "Remove", op: "remove_secret" } });
  }

  // ── ownership ──
  const unowned = identities.filter((i) => !i.owner && i.status !== "revoked");
  if (unowned.length)
    findings.unshift({
      id: "ownership",
      severity: "warn",
      identity: { kind: "workflow", id: "", name: "" },
      title: `${unowned.length} identit${unowned.length === 1 ? "y has" : "ies have"} no owner`,
      detail: "Every non-human identity needs a named person who answers for it. Assign owners from the register; the finding clears as the last one is assigned.",
    });

  const counts: Record<string, number> = {};
  for (const i of identities) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
  return Response.json({
    identities,
    findings,
    counts: { total: identities.length, byKind: counts, findings: findings.length, unowned: unowned.length },
    store: db ? "db" : "db unreachable",
    basis: "Rows are read from the registry, the MCP registry, the vault and the run record on every request; owners and purposes come from the register's own table. Nothing on this page is a stored verdict.",
  });
}

/** Set the human owner, purpose and review date of one identity. */
export async function PATCH(req: Request) {
  { const gate = await permit(req, "iam"); if (gate) return gate; }
  const me = await whoIs(req);
  let body: { kind?: string; id?: string; owner?: string; owner_sub?: string | null; purpose?: string; review_due_at?: string | null; by?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected a JSON body: {kind, id, owner?, owner_sub?, purpose?, review_due_at?}" }, { status: 400 });
  }
  const kind = String(body.kind ?? "") as Kind;
  const id = String(body.id ?? "");
  if (!KINDS.includes(kind) || !ID.test(id)) return Response.json({ error: "bad kind or id" }, { status: 400 });
  if (!(await dbReady())) return Response.json({ error: "the registry database is unreachable" }, { status: 503 });
  const owner = String(body.owner ?? "").trim().slice(0, 120);
  const purpose = String(body.purpose ?? "").trim().slice(0, 400);
  const review = body.review_due_at ? new Date(String(body.review_due_at)) : null;
  if (review && Number.isNaN(review.getTime())) return Response.json({ error: "review_due_at must be a date" }, { status: 400 });
  const rows = await query<Owner>(
    `INSERT INTO nhi_owners (kind, id, owner, owner_sub, purpose, review_due_at, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, now(), $7)
     ON CONFLICT (kind, id) DO UPDATE SET owner = EXCLUDED.owner, owner_sub = EXCLUDED.owner_sub, purpose = EXCLUDED.purpose,
       review_due_at = EXCLUDED.review_due_at, updated_at = now(), updated_by = EXCLUDED.updated_by
     RETURNING owner, owner_sub, purpose, review_due_at, updated_at, updated_by`,
    [kind, id, owner, body.owner_sub ?? null, purpose, review ? review.toISOString() : null, (ssoEnabled() && me && me.mode === "sso" ? signer(me) : String(body.by ?? "console")).slice(0, 120)],
  );
  return Response.json({ owner: rows[0] });
}

/** Disconnect an MCP server from the registry (the one identity with no endpoint of its own). */
export async function DELETE(req: Request) {
  { const gate = await permit(req, "iam"); if (gate) return gate; }
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind");
  const id = url.searchParams.get("id") ?? "";
  if (kind !== "mcp_server" || !ID.test(id)) return Response.json({ error: "only kind=mcp_server is removed here; keys, agents and secrets have their own endpoints" }, { status: 400 });
  const servers = await loadServers();
  if (!servers.some((s) => s.id === id)) return Response.json({ error: `no MCP server "${id}"` }, { status: 404 });
  await saveServers(servers.filter((s) => s.id !== id));
  return Response.json({ disconnected: id });
}
