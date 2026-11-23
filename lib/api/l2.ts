import { api, errorText, type RunRow, type Schemas } from "./client";

/**
 * The L2 doors the registry pages call, through the generated client.
 *
 * The Workflows page (agents, their versions and diffs, retire, deploy, the
 * run ledger beside each card), the IAM page (the identity register, people,
 * API keys, an attached agent's block and gate, a server's disconnection, a
 * vault credential's removal), the attached agents panel, the vault (the
 * Credentials panel on Configuration, the providers' key picker) and the queue on
 * Control. Each call is `api.GET(...)`/`api.POST(...)` on a path typed by
 * lib/api/backend.d.ts, which `npm run gen:api` writes from
 * backend/openapi.json; a refusal is an Error carrying the backend's own
 * message (`errorText`). tests/generated-client.test.ts holds those pages to
 * it: none of them calls a backend door with a hand-typed fetch.
 */

export type AgentSummary = Schemas["AgentSummary"];
export type AgentDetail = Schemas["AgentDetail"];
export type AgentDeployed = Schemas["AgentDeployed"];
export type AgentRetired = Schemas["AgentRetired"];
export type VersionList = Schemas["VersionList"];
export type VersionView = Schemas["VersionView"];
export type SpecDiff = Schemas["SpecDiff"];
export type KeyList = Schemas["KeyList"];
export type MintedKey = Schemas["MintedKey"];
export type AttachedList = Schemas["AttachedList"];
export type AttachRequest = Schemas["AttachRequest"];
export type PolicyPatch = Schemas["PolicyPatch"];
export type RegistryTool = Schemas["RegistryTool"];
export type IdentityRegister = Schemas["IdentityRegister"];
export type UsersView = Schemas["UsersView"];
export type OwnerRequest = Schemas["OwnerRequest"];
export type VaultList = Schemas["VaultList"];
export type VaultKeyView = Schemas["VaultKeyView"];
export type QueueView = Schemas["QueueView"];

/** The refusal a call rejects with: the backend's message with the status and the address, "not built" for a 501, or that the backend did not answer (lib/api/client.ts errorText). */
export function doorError(error: unknown, response: Response, method?: string): Error {
  return new Error(errorText(error, response, method));
}

/* ═══════════════════ agents ═══════════════════ */

/** `GET /api/agents`: every saved workflow, as the registry lists it. */
export async function listAgents(): Promise<AgentSummary[]> {
  const { data, error, response } = await api.GET("/api/agents");
  if (!data) throw doorError(error, response);
  return data.agents;
}

/** `GET /api/agents?id=`: one agent's spec document, as the export downloads it. */
export async function agentDocument(id: string): Promise<Record<string, unknown>> {
  const { data, error, response } = await api.GET("/api/agents", { params: { query: { id } } });
  if (!data) throw doorError(error, response);
  if (!data.spec) throw new Error(`the registry holds no document for "${id}"`);
  return data.spec;
}

/** `DELETE /api/agents/{agent}`: the registry row and the workspace file go; versions and runs stay. */
export async function retireAgent(id: string): Promise<AgentRetired> {
  const { data, error, response } = await api.DELETE("/api/agents/{agent}", { params: { path: { agent: id } } });
  if (!data) throw doorError(error, response);
  return data;
}

/** `POST /api/agents/{agent}/deploy`: the latest version marked deployed. */
export async function deployAgent(id: string): Promise<AgentDeployed> {
  const { data, error, response } = await api.POST("/api/agents/{agent}/deploy", { params: { path: { agent: id } } });
  if (!data) throw doorError(error, response);
  return data;
}

/** `GET /api/agents/{agent}/versions`: every saved version, oldest first. */
export async function listVersions(id: string): Promise<VersionList> {
  const { data, error, response } = await api.GET("/api/agents/{agent}/versions", { params: { path: { agent: id } } });
  if (!data) throw doorError(error, response);
  return data;
}

/** `GET /api/agents/{agent}/diff?from=&to=`: what changed between two versions (a number, `deployed` or `latest`), in spec vocabulary. */
export async function diffVersions(id: string, from: string | number, to: string | number): Promise<SpecDiff> {
  const { data, error, response } = await api.GET("/api/agents/{agent}/diff", { params: { path: { agent: id }, query: { from: String(from), to: String(to) } } });
  if (!data) throw doorError(error, response);
  return data;
}

/** `GET /api/runs`: the ledger, for the last run beside each card. */
export async function listRuns(): Promise<RunRow[]> {
  const { data, error, response } = await api.GET("/api/runs");
  if (!data) throw doorError(error, response);
  return data.runs;
}

/* ═══════════════════ API keys ═══════════════════ */

export async function listKeys(): Promise<KeyList> {
  const { data, error, response } = await api.GET("/api/keys");
  if (!data) throw doorError(error, response);
  return data;
}

/** A key as the list shows it, with when it stops working: its own expiry, or the deployment's longest lifetime counted from its minting, whichever is first. Ahead of the generated type. */
export type KeyRow = KeyList["keys"][number] & { expires_at?: string | null };

/**
 * `POST /api/keys`: the key is in the answer once and never again. `permissions`
 * left out mints the platform's default (view and run); a permission no key may
 * hold is refused by the platform with its reason, which this rejects with.
 * `expiresInDays` left out mints a key for the deployment's longest lifetime
 * (API_KEY_MAX_LIFETIME_DAYS); a number above it, or below one, is refused
 * with the allowed range in the platform's words.
 */
export async function mintKey(name: string, agent: string | null, permissions?: string[], expiresInDays?: number): Promise<MintedKey & { expires_at?: string | null }> {
  // `permissions` and `expires_in_days` are ahead of the generated request type (lib/api/backend.d.ts).
  const body = { name, agent, ...(permissions ? { permissions } : {}), ...(expiresInDays !== undefined ? { expires_in_days: expiresInDays } : {}) } as Schemas["MintKeyRequest"];
  const { data, error, response } = await api.POST("/api/keys", { body });
  if (!data) throw doorError(error, response);
  return data;
}

/** `DELETE /api/keys/{key_id}`: revoked; the row stays as the record of what it was. */
export async function revokeKey(id: string): Promise<Schemas["KeyRevoked"]> {
  const { data, error, response } = await api.DELETE("/api/keys/{key_id}", { params: { path: { key_id: id } } });
  if (!data) throw doorError(error, response);
  return data;
}

/* ═══════════════════ attached agents ═══════════════════ */

export async function listAttached(): Promise<AttachedList> {
  const { data, error, response } = await api.GET("/api/attached");
  if (!data) throw doorError(error, response);
  return data;
}

/** `GET /api/attached/registry`: the tools an attached agent can be granted. */
export async function attachableTools(): Promise<RegistryTool[]> {
  const { data, error, response } = await api.GET("/api/attached/registry");
  if (!data) throw doorError(error, response);
  return data.tools;
}

/** `POST /api/attached`: attach and mint the agent's scoped key, shown once. */
export async function attachAgent(body: AttachRequest): Promise<Schemas["Attached"]> {
  const { data, error, response } = await api.POST("/api/attached", { body });
  if (!data) throw doorError(error, response);
  return data;
}

/** What `PATCH /api/attached` takes: the generated `PolicyPatch` and, before approval, routing and limits too (ahead of lib/api/backend.d.ts). */
export type AttachedPatch = PolicyPatch & { model?: string; models?: string[]; fallbacks?: string[]; limits?: Record<string, number> };

/**
 * `PATCH /api/attached`: an attached agent's block and injection action at any time; before a second person has
 * approved the attachment, its whole policy (grants, gate, routing, limits), and whoever saves it cannot approve
 * it. After approval the reviewed fields answer 409 (`control: policy_change`): they are a policy target
 * (`proposePolicyChange`, lib/api/l9.ts). A shared A2A secret answers 501.
 */
export async function setAttachedPolicy(patch: AttachedPatch): Promise<Schemas["PolicyChanged"]> {
  const { data, error, response } = await api.PATCH("/api/attached", { body: patch as PolicyPatch });
  if (!data) throw doorError(error, response);
  return data;
}

/**
 * `POST /api/attached/{id}/approve`: a second person approves the attachment exactly as they read it (its
 * `policy_digest`); its key works from then. 403 for the person who attached it or changed its policy; 409 when
 * the policy changed since it was read. The address is ahead of lib/api/backend.d.ts, so it is called by hand.
 */
export async function approveAttached(id: string, digest: string): Promise<Schemas["PolicyChanged"]> {
  const path = `/api/attached/${encodeURIComponent(id)}/approve`;
  let response: Response;
  try {
    response = await fetch(path, { method: "POST", credentials: "include", cache: "no-store", headers: { "content-type": "application/json" }, body: JSON.stringify({ digest }) });
  } catch (e) {
    throw new Error(`POST ${path} could not be reached: ${(e as Error).message || "the request did not reach the server"}`);
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) throw new Error(errorText(body, response, "POST", path));
  return body as Schemas["PolicyChanged"];
}

/** `DELETE /api/attached?id=`: detached, and the key minted for it revoked. */
export async function detachAgent(id: string): Promise<Schemas["Detached"]> {
  const { data, error, response } = await api.DELETE("/api/attached", { params: { query: { id } } });
  if (!data) throw doorError(error, response);
  return data;
}

/* ═══════════════════ IAM ═══════════════════ */

export async function readIdentities(): Promise<IdentityRegister> {
  const { data, error, response } = await api.GET("/api/iam/identities");
  if (!data) throw doorError(error, response);
  return data;
}

export async function readUsers(): Promise<UsersView> {
  const { data, error, response } = await api.GET("/api/iam/users");
  if (!data) throw doorError(error, response);
  return data;
}

/** `PATCH /api/iam/identities`: the human owner, purpose and review date of one identity. */
export async function setIdentityOwner(body: OwnerRequest): Promise<Schemas["OwnerSet"]> {
  const { data, error, response } = await api.PATCH("/api/iam/identities", { body });
  if (!data) throw doorError(error, response);
  return data;
}

/** `DELETE /api/iam/identities?kind=&id=`: an MCP server disconnected from the registry. */
export async function disconnectIdentity(kind: string, id: string): Promise<Schemas["Disconnected"]> {
  const { data, error, response } = await api.DELETE("/api/iam/identities", { params: { query: { kind, id } } });
  if (!data) throw doorError(error, response);
  return data;
}

/**
 * `DELETE /api/iam/users?sub=`: a person signed out everywhere, which this
 * service does by holding them out. `revokeKeys` adds `revoke_keys=true`:
 * their API keys that still work are revoked in the same act, and the answer
 * lists them under `revoked_keys`.
 */
export async function signOutUser(sub: string, revokeKeys = false): Promise<Schemas["SignedOut"]> {
  // `revoke_keys` is ahead of the generated query type (lib/api/backend.d.ts).
  const query = (revokeKeys ? { sub, revoke_keys: true } : { sub }) as { sub: string };
  const { data, error, response } = await api.DELETE("/api/iam/users", { params: { query } });
  if (!data) throw doorError(error, response);
  return data;
}

/**
 * `PATCH /api/iam/users`: a person's access disabled or re-enabled (never
 * one's own). `revokeKeys`, sent only when holding a person out, revokes
 * their API keys that still work in the same act (`revoked_keys` in the
 * answer); the platform refuses it with `disabled: false`.
 */
export async function setUserAccess(sub: string, disabled: boolean, by: string, revokeKeys = false): Promise<Schemas["UserAccessChanged"]> {
  // `revoke_keys` is ahead of the generated request type (lib/api/backend.d.ts).
  const body = (disabled && revokeKeys ? { sub, disabled, by, revoke_keys: true } : { sub, disabled, by }) as { sub: string; disabled: boolean; by: string };
  const { data, error, response } = await api.PATCH("/api/iam/users", { body });
  if (!data) throw doorError(error, response);
  return data;
}

/* ═══════════════════ the vault ═══════════════════ */

export async function listVault(): Promise<VaultList> {
  const { data, error, response } = await api.GET("/api/vault");
  if (!data) throw doorError(error, response);
  return data;
}

/** `POST /api/vault`: set a credential by name; the answer carries it masked. */
export async function setVaultKey(name: string, value: string, label: string): Promise<Schemas["VaultKeySet"]> {
  const { data, error, response } = await api.POST("/api/vault", { body: { name, value, label } });
  if (!data) throw doorError(error, response);
  return data;
}

/** `DELETE /api/vault?name=` */
export async function removeVaultKey(name: string): Promise<Schemas["VaultRemoved"]> {
  const { data, error, response } = await api.DELETE("/api/vault", { params: { query: { name } } });
  if (!data) throw doorError(error, response);
  return data;
}

/* ═══════════════════ the queue ═══════════════════ */

/** The intake as the Control page's queue panel reads it. */
export interface QueueSummary {
  agents: Record<string, Schemas["AgentQueue"]>;
  workers: { name: string; running: number; lease_until: string }[];
  last_hour: { finished: number; failed: number; avg_ms: number | null };
  depth: number;
  dead_letters: Schemas["JobView"][];
}

export function queueOf(q: QueueView): QueueSummary {
  return {
    agents: q.agents ?? {},
    workers: (q.workers ?? []).map((w) => ({ name: w.name, running: w.running ?? 0, lease_until: w.lease_until ?? "" })),
    last_hour: { finished: q.last_hour?.finished ?? 0, failed: q.last_hour?.failed ?? 0, avg_ms: q.last_hour?.avg_ms ?? null },
    depth: q.depth ?? 0,
    dead_letters: q.dead_letters ?? [],
  };
}

/** `GET /api/queue`: depth by agent, running leases, dead letters, the last hour. */
export async function readQueue(): Promise<QueueSummary> {
  const { data, error, response } = await api.GET("/api/queue");
  if (!data) throw doorError(error, response);
  return queueOf(data);
}

export type JobView = Schemas["JobView"];
export type JobList = Schemas["JobList"];
export type JobQuery = NonNullable<NonNullable<import("./backend").operations["listQueueJobs"]["parameters"]["query"]>>;

/**
 * `GET /api/queue/jobs?status=&agent=&limit=` (L8, second round): the jobs
 * themselves, newest first: a cancelled one with its `cancel_reason`, a dead
 * letter, a shadow job and the canary assignment each job carries. 400
 * `field: status` for a status the queue does not hold; 403 for a key scoped
 * to another agent.
 */
export async function listJobs(query: JobQuery = {}): Promise<JobList> {
  const q: JobQuery = {};
  if (query.status) q.status = query.status;
  if (query.agent) q.agent = query.agent;
  if (query.limit !== undefined) q.limit = query.limit;
  const { data, error, response } = await api.GET("/api/queue/jobs", { params: { query: q } });
  if (!data) throw doorError(error, response);
  return { jobs: data.jobs ?? [], count: data.count ?? (data.jobs ?? []).length };
}
