import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

// The generated client as the browser has it, but on an absolute origin: Node
// cannot build a Request for a bare path, and the page's own origin is what
// the browser resolves "" against.
vi.mock("@/lib/api/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api/client")>();
  const { default: createClient } = await import("openapi-fetch");
  return { ...real, api: createClient<import("@/lib/api/backend").paths>({ baseUrl: "http://console.test", credentials: "include", fetch: (r: Request) => globalThis.fetch(r) }) };
});

import * as l2 from "@/lib/api/l2";
import * as l4 from "@/lib/api/l4";
import { consolePath } from "@/lib/api/client";

/**
 * Plan L2: "the OpenAPI document generates the client they use", for the
 * runs, queue, approvals, agents, keys, attached agents, IAM and vault pages.
 *
 * Each door those pages use (lib/api/l2.ts) is called with fetch stubbed and
 * held to the request the hand-typed fetch made: the same method, path,
 * query and body, and a refusal that carries the backend's message.
 */

/* ═══════════════════ the doors, against a stubbed fetch ═══════════════════ */

interface Sent {
  method: string;
  url: string;
  body: unknown;
}

/** Answer every call with `status` and `body`; returns what was sent. */
function answer(status: number, body: unknown) {
  const sent: Sent[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (req: Request) => {
      const text = await req.text();
      sent.push({ method: req.method, url: req.url.replace("http://console.test", ""), body: text ? JSON.parse(text) : undefined });
      return new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    }),
  );
  return sent;
}

afterEach(() => vi.unstubAllGlobals());

describe("lib/api/l2.ts sends what the pages used to send", () => {
  it("agents: list, the export's document, retire, deploy, versions and a diff", async () => {
    let sent = answer(200, { agents: [{ id: "tiny", name: "Tiny", nodes: 1 }], count: 1, store: "db" });
    expect(await l2.listAgents()).toEqual([{ id: "tiny", name: "Tiny", nodes: 1 }]);
    expect(sent).toEqual([{ method: "GET", url: "/api/agents", body: undefined }]);

    sent = answer(200, { agents: [], count: 1, store: "db", spec: { metadata: { id: "tiny" } } });
    expect(await l2.agentDocument("tiny")).toEqual({ metadata: { id: "tiny" } });
    expect(sent[0]).toEqual({ method: "GET", url: "/api/agents?id=tiny", body: undefined });

    sent = answer(200, { removed: true, id: "tiny", versions: 3 });
    expect(await l2.retireAgent("tiny")).toMatchObject({ removed: true });
    expect(sent[0]).toMatchObject({ method: "DELETE", url: "/api/agents/tiny" });

    sent = answer(200, { deployed: true, id: "tiny", digest: "0019000000000000", store: "db", at: "2026-10-21T08:23:23.488Z", version: 3, steps: [] });
    expect((await l2.deployAgent("tiny")).digest).toBe("0019000000000000");
    expect(sent[0]).toMatchObject({ method: "POST", url: "/api/agents/tiny/deploy" });

    sent = answer(200, { id: "tiny", versions: [], count: 0, latest: null, deployed: null });
    await l2.listVersions("tiny");
    expect(sent[0]).toMatchObject({ method: "GET", url: "/api/agents/tiny/versions" });

    sent = answer(200, { id: "tiny", from: { version: 1, digest: "a" }, to: { version: 2, digest: "b" }, same: false, nodes: {}, edges: {}, gates: {}, tools: {} });
    await l2.diffVersions("tiny", 1, "latest");
    expect(sent[0]).toMatchObject({ method: "GET", url: "/api/agents/tiny/diff?from=1&to=latest" });

    sent = answer(200, { runs: [{ id: "r1", system: "tiny", state: "done", at: "2026-10-21T08:00:00Z" }], count: 1 });
    expect((await l2.listRuns()).map((r) => r.id)).toEqual(["r1"]);
    expect(sent[0]).toMatchObject({ method: "GET", url: "/api/runs" });
  });

  it("keys: list, mint (shown once) and revoke", async () => {
    let sent = answer(200, { keys: [], mode: "open", store: "db" });
    await l2.listKeys();
    expect(sent[0]).toMatchObject({ method: "GET", url: "/api/keys" });
    const minted = `af_1234_${randomBytes(12).toString("hex")}`; // made for this run
    sent = answer(200, { id: "k2", name: "intake", agent: "tiny", prefix: "af_1234", created_at: "2026-10-21T08:00:00Z", key: minted });
    expect((await l2.mintKey("intake", "tiny")).key).toBe(minted);
    expect(sent[0]).toEqual({ method: "POST", url: "/api/keys", body: { name: "intake", agent: "tiny" } });
    sent = answer(200, { id: "k1", revoked: true, revoked_at: "2026-10-21T08:00:00Z" });
    await l2.revokeKey("k1");
    expect(sent[0]).toMatchObject({ method: "DELETE", url: "/api/keys/k1" });
  });

  it("attached agents: list, the grantable tools, attach, policy, detach", async () => {
    let sent = answer(200, { agents: [], store: "db" });
    await l2.listAttached();
    expect(sent[0]).toMatchObject({ method: "GET", url: "/api/attached" });
    sent = answer(200, { tools: [{ name: "crm.lookup", server: "crm", label: "CRM", tool: "lookup", description: "", risk: "read" }] });
    expect((await l2.attachableTools()).map((t) => t.name)).toEqual(["crm.lookup"]);
    expect(sent[0]).toMatchObject({ method: "GET", url: "/api/attached/registry" });
    sent = answer(201, { agent: { id: "copilot" }, key: "af_k", note: "" });
    await l2.attachAgent({ name: "Copilot", mode: "a2a", framework: "copilot-studio", language: "", owner: "Risk", card_url: "https://example.com/.well-known/agent.json" });
    expect(sent[0]).toEqual({ method: "POST", url: "/api/attached", body: { name: "Copilot", mode: "a2a", framework: "copilot-studio", language: "", owner: "Risk", card_url: "https://example.com/.well-known/agent.json" } });
    sent = answer(200, { agent: { id: "copilot" } });
    await l2.setAttachedPolicy({ id: "copilot", blocked: true });
    expect(sent[0]).toEqual({ method: "PATCH", url: "/api/attached", body: { id: "copilot", blocked: true } });
    sent = answer(200, { detached: "copilot", keyRevoked: true });
    await l2.detachAgent("copilot");
    expect(sent[0]).toMatchObject({ method: "DELETE", url: "/api/attached?id=copilot" });
  });

  it("IAM: the register, people, an owner, a disconnection, sign-out everywhere, access", async () => {
    let sent = answer(200, { identities: [], findings: [], counts: { total: 0, byKind: {}, findings: 0, unowned: 0 }, store: "db" });
    await l2.readIdentities();
    expect(sent[0]).toMatchObject({ method: "GET", url: "/api/iam/identities" });
    sent = answer(200, { users: [], events: [], sso: { configured: false, issuer: "", demo_default_role: "" }, roles: [], permissions: [], store: "db" });
    await l2.readUsers();
    expect(sent[0]).toMatchObject({ method: "GET", url: "/api/iam/users" });
    sent = answer(200, { owner: { owner: "Risk", purpose: "", updated_at: "", updated_by: "" } });
    await l2.setIdentityOwner({ kind: "api_key", id: "k1", owner: "Risk", purpose: "intake", review_due_at: null, by: "Asha Rao" });
    expect(sent[0]).toEqual({ method: "PATCH", url: "/api/iam/identities", body: { kind: "api_key", id: "k1", owner: "Risk", purpose: "intake", review_due_at: null, by: "Asha Rao" } });
    sent = answer(200, { disconnected: "crm" });
    await l2.disconnectIdentity("mcp_server", "crm");
    expect(sent[0]).toMatchObject({ method: "DELETE", url: "/api/iam/identities?kind=mcp_server&id=crm" });
    sent = answer(200, { signedOut: 2 });
    await l2.signOutUser("iap|alice");
    expect(sent[0]).toMatchObject({ method: "DELETE", url: `/api/iam/users?sub=${encodeURIComponent("iap|alice")}` });
    sent = answer(200, { user: { sub: "iap|alice", disabled_at: "2026-10-21T08:00:00Z" } });
    await l2.setUserAccess("iap|alice", true, "Asha Rao");
    expect(sent[0]).toEqual({ method: "PATCH", url: "/api/iam/users", body: { sub: "iap|alice", disabled: true, by: "Asha Rao" } });
  });

  it("the vault: list, set (masked back) and remove", async () => {
    let sent = answer(200, { keys: [{ name: "tavily", label: "", value: "tvly…1234", used_by: [], set: true, last_used: "", created: "" }] });
    expect((await l2.listVault()).keys.map((k) => k.name)).toEqual(["tavily"]);
    expect(sent[0]).toMatchObject({ method: "GET", url: "/api/vault" });
    sent = answer(200, { key: { name: "tavily", label: "search", value: "tvly…1234", used_by: [], set: true, last_used: "", created: "" } });
    await l2.setVaultKey("tavily", "tvly-secret-1234", "search");
    expect(sent[0]).toEqual({ method: "POST", url: "/api/vault", body: { name: "tavily", value: "tvly-secret-1234", label: "search" } });
    sent = answer(200, { name: "tavily", removed: true });
    await l2.removeVaultKey("tavily");
    expect(sent[0]).toMatchObject({ method: "DELETE", url: "/api/vault?name=tavily" });
  });

  it("the queue: read, with the panel's figures defaulted where the door leaves them out", async () => {
    const sent = answer(200, { agents: { tiny: { queued: 2, running: 1 } }, workers: [{ name: "w1", running: 1, lease_until: null }], last_hour: {}, depth: 3, dead_letters: [], scheduler: true, schedules: [] });
    expect(await l2.readQueue()).toEqual({ agents: { tiny: { queued: 2, running: 1 } }, workers: [{ name: "w1", running: 1, lease_until: "" }], last_hour: { finished: 0, failed: 0, avg_ms: null }, depth: 3, dead_letters: [] });
    expect(sent[0]).toMatchObject({ method: "GET", url: "/api/queue" });
  });

  it("a refusal carries the backend's message; a door nobody answers says where to look", async () => {
    answer(403, { error: 'this needs the "configure" permission; your roles: viewer' });
    await expect(l2.setVaultKey("x", "y", "")).rejects.toThrow('this needs the "configure" permission; your roles: viewer');
    answer(404, { error: 'no saved agent "ghost"' });
    await expect(l2.deployAgent("ghost")).rejects.toThrow('no saved agent "ghost"');
    answer(502, null);
    await expect(l2.listKeys()).rejects.toThrow(/answered 502.*BACKEND_ORIGIN/);
  });
});

describe("the console's fetch guard reads a generated client's request", () => {
  it("a Request's absolute URL on this origin is the console path; another origin's is left alone", () => {
    expect(consolePath("/api/keys", "https://agentfactory.example")).toBe("/api/keys");
    expect(consolePath("https://agentfactory.example/api/keys/k1?x=1", "https://agentfactory.example")).toBe("/api/keys/k1?x=1");
    expect(consolePath("https://elsewhere.example/api/keys", "https://agentfactory.example")).toBe("https://elsewhere.example/api/keys");
    expect(consolePath("not a url", "https://agentfactory.example")).toBe("not a url");
  });
});

describe("lib/api/l4.ts: the system prompt doors", () => {
  const version = (n: number, current: boolean) => ({ id: `sp-${n}`, version: n, prompt: `prompt ${n}`, digest: `sha256:${String(n).repeat(64)}`, chars: 8, set_by: "Asha Rao", set_at: `2026-10-21T08:0${n}:00Z`, retired_at: current ? null : "2026-10-21T08:02:00Z", current, guarded: true, adopted: false });

  it("reads the history newest first, and a row with none (a workflow) as none", async () => {
    let sent = answer(200, { application: "versioned", current: "sp-2", versions: [version(1, false), version(2, true)], count: 2, leak_check: { window_days: 30, max_versions: 20, says: "…" } });
    const h = await l4.systemPrompts("versioned");
    expect(sent[0]).toMatchObject({ method: "GET", url: "/api/applications/versioned/system-prompts" });
    expect(h?.versions.map((v) => v.version)).toEqual([2, 1]);
    sent = answer(404, { error: '"tiny" is not a registered application; only a registered chatbot or RAG application has a system prompt' });
    expect(await l4.systemPrompts("tiny")).toBeNull();
    expect(sent[0].url).toBe("/api/applications/tiny/system-prompts");
  });

  it("a change goes as the prompt alone (the door merges it over the policy) and names the version it recorded", async () => {
    const application = { id: "versioned", name: "Versioned", class: "chatbot", autonomy: "L0", owner: "", source: "application", key_prefix: "af_1", policy: { system_prompt: "prompt 2" }, created_at: "", blocked: false, description: "", estate_id: "default" };
    let sent = answer(200, { application, system_prompt: version(2, true) });
    const r = await l4.setSystemPrompt("versioned", "prompt 2");
    expect(sent[0]).toEqual({ method: "PATCH", url: "/api/applications", body: { id: "versioned", policy: { system_prompt: "prompt 2" } } });
    expect(r.recorded?.version).toBe(2);
    expect(r.application.policy.system_prompt).toBe("prompt 2");
    sent = answer(200, { application, system_prompt: null });
    expect((await l4.setSystemPrompt("versioned", "prompt 2")).recorded).toBeNull();
    answer(403, { error: 'this needs the "configure" permission; your roles: viewer' });
    await expect(l4.setSystemPrompt("versioned", "x")).rejects.toThrow('this needs the "configure" permission');
  });
});
