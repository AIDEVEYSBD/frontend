import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Plan L5: approvers are roles resolved from SSO groups. The backend checks
 * a gate's approvers against the session's app roles, role claims and group
 * claims (`sessions.groups`); the console writes that column when it creates
 * the session at sign-in and when a refresh's tokens carry the claim, and
 * leaves `roles` and `app_roles` as they were. The database, the identity
 * provider's discovery and the token verification are stubbed: what is
 * held is what the console writes.
 */

const sql: { text: string; params: unknown[] }[] = [];
let rows: Record<string, unknown>[] = [];

vi.mock("@/lib/server/db", () => ({
  dbReady: async () => true,
  query: async (text: string, params: unknown[] = []) => {
    sql.push({ text, params });
    if (/^\s*SELECT s\.id/.test(text)) return rows;
    if (/^\s*SELECT refresh_token/.test(text)) return [{ refresh_token: "rt-1", access_expires_at: new Date(Date.now() - 1000).toISOString() }];
    return [];
  },
}));

// A JWT access token is verified against the provider's keys; here its payload is whatever the test says.
let accessPayload: Record<string, unknown> = {};
vi.mock("jose", () => ({
  decodeJwt: (t: string) => {
    if (!t.startsWith("jwt.")) throw new Error("not a JWT");
    return accessPayload;
  },
  createRemoteJWKSet: () => ({}),
  jwtVerify: async () => ({ payload: accessPayload }),
}));

let refreshAnswer: { access_token: string; id_claims?: Record<string, unknown> } = { access_token: "jwt.refreshed" };
vi.mock("openid-client", () => ({
  discovery: async () => ({ serverMetadata: () => ({ jwks_uri: "https://sso.example/jwks" }) }),
  ClientSecretPost: () => ({}),
  refreshTokenGrant: async () => ({
    access_token: refreshAnswer.access_token,
    refresh_token: "rt-2",
    id_token: refreshAnswer.id_claims ? "id.refreshed" : undefined,
    claims: () => refreshAnswer.id_claims,
    expiresIn: () => 600,
  }),
}));

import { DEFAULT_GROUPS_CLAIM, MAX_GROUPS, groupsClaimName, groupsFrom, groupsOverage, refreshedGroups, sessionGroups } from "@/lib/sso-groups";
import { batchable, gateAccess } from "@/lib/gates";
import { gateOf } from "@/lib/api/l5";
import { createSession, session, sessionCookie } from "@/lib/server/auth";

const ENV = { AUTOX_CLIENT_ID: "agentfactory", AUTOX_CLIENT_SECRET: "client-secret", AUTH_SECRET: "a-test-secret-of-some-length" };

beforeEach(() => {
  sql.length = 0;
  rows = [];
  accessPayload = {};
  refreshAnswer = { access_token: "jwt.refreshed" };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("reading the group claim", () => {
  it("is `groups` unless AUTH_GROUPS_CLAIM names another", () => {
    expect(DEFAULT_GROUPS_CLAIM).toBe("groups");
    expect(groupsClaimName({})).toBe("groups");
    expect(groupsClaimName({ AUTH_GROUPS_CLAIM: "  cognito:groups " })).toBe("cognito:groups");
    expect(groupsClaimName({ AUTH_GROUPS_CLAIM: "" })).toBe("groups");
  });

  it("takes a list, a single string, a comma-separated string, or objects with a name; trimmed and de-duplicated", () => {
    expect(groupsFrom({ groups: ["dlp-leads", " risk-office ", "dlp-leads", ""] })).toEqual(["dlp-leads", "risk-office"]);
    expect(groupsFrom({ groups: "dlp-leads" })).toEqual(["dlp-leads"]);
    expect(groupsFrom({ groups: "dlp-leads, risk-office" })).toEqual(["dlp-leads", "risk-office"]);
    expect(groupsFrom({ groups: [{ name: "dlp-leads" }, { displayName: "Risk Office" }, { id: "6e8a…" }, 42, null] })).toEqual(["dlp-leads", "Risk Office", "6e8a…", "42"]);
    // Entra ID sends object ids: kept as sent.
    expect(groupsFrom({ groups: ["0b4f0c5e-1111-4d8e-9a3a-6a0c2f1e7d20"] })).toEqual(["0b4f0c5e-1111-4d8e-9a3a-6a0c2f1e7d20"]);
  });

  it("says nothing when the claim is absent, and none when it is an empty list", () => {
    expect(groupsFrom({ sub: "x" })).toBeNull();
    expect(groupsFrom(null)).toBeNull();
    expect(groupsFrom({ groups: null })).toBeNull();
    expect(groupsFrom({ groups: [] })).toEqual([]);
  });

  it("reads another claim by its literal name first, then as a dotted path into a nested one", () => {
    expect(groupsFrom({ "cognito:groups": ["approvers"] }, "cognito:groups")).toEqual(["approvers"]);
    expect(groupsFrom({ "https://example.com/groups": ["approvers"] }, "https://example.com/groups")).toEqual(["approvers"]);
    expect(groupsFrom({ realm_access: { roles: ["dlp-lead", "offline_access"] } }, "realm_access.roles")).toEqual(["dlp-lead", "offline_access"]);
    expect(groupsFrom({ realm_access: { roles: ["x"] } }, "realm_access.missing")).toBeNull();
  });

  it("keeps at most MAX_GROUPS, and drops a value too long to be a group", () => {
    const many = Array.from({ length: MAX_GROUPS + 50 }, (_, i) => `g-${i}`);
    expect(groupsFrom({ groups: many })).toHaveLength(MAX_GROUPS);
    expect(groupsFrom({ groups: ["ok", "x".repeat(300)] })).toEqual(["ok"]);
  });

  it("notes Entra ID's overage: the list withheld in favour of a Graph pointer", () => {
    expect(groupsOverage({ _claim_names: { groups: "src1" }, _claim_sources: { src1: {} } })).toBe(true);
    expect(groupsOverage({ groups: ["a"] })).toBe(false);
  });

  it("joins the ID token's and the access token's; a refresh that carries neither keeps the session's", () => {
    expect(sessionGroups({ groups: ["a", "b"] }, { groups: ["b", "c"] })).toEqual(["a", "b", "c"]);
    expect(sessionGroups({ sub: "x" }, null)).toEqual([]);
    expect(refreshedGroups(undefined, { scope: "openid" })).toBeNull();
    expect(refreshedGroups(undefined, { groups: [] })).toEqual([]);
    expect(refreshedGroups({ groups: ["a"] }, null)).toEqual(["a"]);
  });
});

describe("a group answers a gate that names it", () => {
  const gate = gateOf({ run: "r1", agent: "dlp", node: "review", approvers: ["dlp-leads"], shape: "decision" });

  it("passes on a group as the backend's roles_of does, and the refusal lists the groups held", () => {
    expect(gateAccess({ roles: [], appRoles: ["operator"], groups: ["dlp-leads"] }, gate.approvers)).toEqual({ ok: true, reason: "" });
    const no = gateAccess({ roles: [], appRoles: ["operator"], groups: ["finance"] }, gate.approvers);
    expect(no.ok).toBe(false);
    expect(no.reason).toBe("Only dlp-leads may answer this gate (or an administrator). Your roles: operator, finance.");
    // A session from an older console carries no groups: the roles alone decide, as before.
    expect(gateAccess({ roles: [], appRoles: ["operator"] }, gate.approvers).ok).toBe(false);
  });

  it("a batch of gates naming the group is the group member's to answer", () => {
    const second = gateOf({ run: "r2", agent: "dlp", node: "review", approvers: ["dlp-leads"], shape: "decision" });
    expect(batchable([gate, second], { roles: [], appRoles: ["viewer"], groups: ["dlp-leads"] })).toEqual({ ok: true, reason: "" });
  });
});

/** The INSERT into sessions, as the console sent it. */
const insert = () => {
  const s = sql.find((q) => /^\s*INSERT INTO sessions/.test(q.text));
  expect(s, "no INSERT INTO sessions").toBeDefined();
  const cols = s!.text.match(/\(([^)]*)\) VALUES/)![1].split(",").map((c) => c.trim());
  return Object.fromEntries(cols.map((c, i) => [c, s!.params[i]]));
};

describe("sign-in stores the groups on the session row", () => {
  const claims = { sub: "autox|alice", email: "alice@ey.com", name: "Alice", "autox:roles": ["ey-staff"], groups: ["dlp-leads", "risk-office"] };

  it("from the ID token, beside the roles and app roles, which are written as before", async () => {
    accessPayload = { "autox:app_roles": ["operator"], "autox:roles": ["ey-staff"] };
    const made = await createSession(claims, { id_token: "id.1", access_token: "jwt.1", refresh_token: "rt-1", expires_in: 600 });
    const row = insert();
    expect(JSON.parse(row.groups as string)).toEqual(["dlp-leads", "risk-office"]);
    expect(JSON.parse(row.roles as string)).toEqual(["ey-staff"]);
    expect(JSON.parse(row.app_roles as string)).toEqual(["operator"]);
    expect(made).toMatchObject({ appRoles: ["operator"], jwt: true, groups: ["dlp-leads", "risk-office"], groupsClaim: "groups", groupsOverage: false });
    // The users row still records the app roles, and nothing else moved.
    expect(sql.find((q) => /UPDATE users SET last_app_roles/.test(q.text))?.params).toEqual(["autox|alice", JSON.stringify(["operator"])]);
  });

  it("from the access token too, and from the claim AUTH_GROUPS_CLAIM names", async () => {
    vi.stubEnv("AUTH_GROUPS_CLAIM", "realm_access.roles");
    accessPayload = { "autox:app_roles": ["viewer"], realm_access: { roles: ["approvers"] } };
    const made = await createSession({ sub: "autox|bob", realm_access: { roles: ["dlp-lead"] } } as never, { id_token: "id.2", access_token: "jwt.2" });
    expect(JSON.parse(insert().groups as string)).toEqual(["dlp-lead", "approvers"]);
    expect(made.groupsClaim).toBe("realm_access.roles");
  });

  it("an opaque access token and no claim: an empty list, never a failed sign-in", async () => {
    const made = await createSession({ sub: "autox|carol" }, { id_token: "id.3", access_token: "opaque-token" });
    expect(JSON.parse(insert().groups as string)).toEqual([]);
    expect(made).toMatchObject({ jwt: false, groups: [] });
  });
});

describe("a refresh rewrites the groups only when the new tokens carry them", () => {
  const row = (id: string) => ({
    id,
    sub: "autox|alice",
    id_token: "id.0",
    access_token: "jwt.0",
    access_expires_at: new Date(Date.now() - 1000).toISOString(),
    refresh_token: "rt-1",
    roles: ["ey-staff"],
    app_roles: ["operator"],
    groups: ["dlp-leads"],
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    name: "Alice",
    email: "alice@ey.com",
    org_type: "EY",
    is_ey_employee: true,
    disabled_at: null,
  });

  const signedIn = async (id: string) => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
    rows = [row(id)];
    const cookie = (await sessionCookie(id, new Date(Date.now() + 3_600_000))).split(";")[0];
    return session(new Request("https://agentfactory.example/api/auth/session", { headers: { cookie } }));
  };
  const update = () => sql.find((q) => /^\s*UPDATE sessions SET access_token/.test(q.text))!;

  it("the refreshed tokens' groups replace the stored ones; roles and app roles as the tokens say, as before", async () => {
    accessPayload = { "autox:app_roles": ["operator"], "autox:roles": ["ey-staff"], groups: ["dlp-leads", "ciso-office"] };
    const s = await signedIn("sess-1");
    const u = update();
    expect(u.text).toContain("groups=COALESCE($8::jsonb, groups)");
    expect(u.params[7]).toBe(JSON.stringify(["dlp-leads", "ciso-office"]));
    expect(u.params[5]).toBe(JSON.stringify(["ey-staff"]));
    expect(u.params[6]).toBe(JSON.stringify(["operator"]));
    // The session read back carries the row's groups to the console (and the backend reads the same column).
    expect(s?.groups).toEqual(["dlp-leads"]);
  });

  it("tokens without the claim keep what sign-in stored", async () => {
    accessPayload = { "autox:app_roles": ["operator"] };
    await signedIn("sess-2");
    expect(update().params[7]).toBeNull();
  });
});
