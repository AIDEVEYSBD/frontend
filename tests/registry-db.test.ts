import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The identity provider is not called: a refresh answers with an ID token carrying a new group.
vi.mock("openid-client", () => ({
  discovery: async () => ({ serverMetadata: () => ({ jwks_uri: "https://sso.example/jwks" }) }),
  ClientSecretPost: () => ({}),
  refreshTokenGrant: async () => ({
    access_token: "opaque-access-2",
    refresh_token: "rt-2",
    id_token: "id-2",
    claims: () => ({ sub: "autox|grouped", groups: ["ciso-office"] }),
    expiresIn: () => 600,
  }),
}));

/**
 * The registry's schema against a live Postgres: a database an older console
 * created (tables without `estate_id`, sessions without `groups`, rows
 * already in them) is migrated by the same statement a fresh one is created
 * with, and every table ends with the column the backend declares.
 *
 * Skipped unless AGENTFACTORY_DB_DSN names a database to use:
 *
 *   AGENTFACTORY_DB_DSN=postgres://user:pass@127.0.0.1:5455/agentfactory npm test -- tests/registry-db
 *
 * Everything happens in a schema of its own (af_estate_<random>, the pool's
 * search_path pointed at it), dropped afterwards, so the database's own
 * tables are never touched.
 */

const DSN = process.env.AGENTFACTORY_DB_DSN ?? "";
const SCHEMA = `af_estate_${randomUUID().slice(0, 8).replace(/-/g, "")}`;

const REGISTRY_TABLES = [
  "workflows", "settings", "runs", "eval_sets", "eval_runs", "trigger_jobs", "api_keys", "attached_agents",
  "users", "sessions", "auth_events", "nhi_owners", "run_metrics",
];

/** The shapes an earlier console created: no estate_id anywhere, no groups on a session. */
const OLDER = `
  CREATE TABLE eval_runs (id text PRIMARY KEY, set_id text NOT NULL, agent text NOT NULL, model text NOT NULL DEFAULT '', digest text NOT NULL DEFAULT '',
    passed int NOT NULL DEFAULT 0, total int NOT NULL DEFAULT 0, results jsonb NOT NULL DEFAULT '[]'::jsonb, at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE run_metrics (id text PRIMARY KEY, system text NOT NULL DEFAULT '', state text NOT NULL DEFAULT '', at timestamptz NOT NULL,
    duration_ms bigint NOT NULL DEFAULT 0, tokens_in bigint NOT NULL DEFAULT 0, tokens_out bigint NOT NULL DEFAULT 0, cost numeric,
    denials int NOT NULL DEFAULT 0, models jsonb NOT NULL DEFAULT '[]'::jsonb, artifacts jsonb NOT NULL DEFAULT '[]'::jsonb);
  CREATE TABLE users (sub text PRIMARY KEY, email text NOT NULL DEFAULT '', email_verified boolean NOT NULL DEFAULT false, name text NOT NULL DEFAULT '',
    preferred_username text NOT NULL DEFAULT '', org_type text NOT NULL DEFAULT '', is_ey_employee boolean NOT NULL DEFAULT false,
    orgs jsonb NOT NULL DEFAULT '[]'::jsonb, last_roles jsonb NOT NULL DEFAULT '[]'::jsonb, last_app_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
    first_seen timestamptz NOT NULL DEFAULT now(), last_seen timestamptz NOT NULL DEFAULT now(), disabled_at timestamptz, disabled_by text);
  CREATE TABLE sessions (id text PRIMARY KEY, sub text NOT NULL REFERENCES users(sub) ON DELETE CASCADE, id_token text NOT NULL, access_token text NOT NULL,
    access_expires_at timestamptz NOT NULL, refresh_token text, roles jsonb NOT NULL DEFAULT '[]'::jsonb, app_roles jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(), last_seen timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL);
  INSERT INTO eval_runs (id, set_id, agent) VALUES ('er-1', 'set-1', 'tiny');
  INSERT INTO run_metrics (id, at) VALUES ('rm-1', now());
  INSERT INTO users (sub) VALUES ('autox|older');
  INSERT INTO sessions (id, sub, id_token, access_token, access_expires_at, expires_at) VALUES ('s-1', 'autox|older', 'i', 'a', now(), now() + interval '1 hour');
`;

describe.skipIf(!DSN)("the registry schema on a live Postgres", () => {
  let admin: Client;
  let db: typeof import("@/lib/server/db");

  beforeAll(async () => {
    admin = new Client({ connectionString: DSN });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${SCHEMA}`);
    await admin.query(`SET search_path TO ${SCHEMA}`);
    await admin.query(OLDER);
    // The module's pool reads the DSN when it is imported: point it at the scratch schema first.
    const url = new URL(DSN);
    url.searchParams.set("options", `-c search_path=${SCHEMA}`);
    process.env.AGENTFACTORY_DB_DSN = url.toString();
    db = await import("@/lib/server/db");
  }, 30_000);

  afterAll(async () => {
    await db?.dbClose().catch(() => {});
    await admin?.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
    await admin?.end().catch(() => {});
  });

  it("migrates an older database in one pass", async () => {
    expect(await db.dbReady()).toBe(true);
    const cols = await admin.query<{ table_name: string; is_nullable: string; column_default: string; data_type: string }>(
      `SELECT table_name, is_nullable, column_default, data_type FROM information_schema.columns
        WHERE table_schema = $1 AND column_name = 'estate_id' ORDER BY table_name`,
      [SCHEMA],
    );
    expect(cols.rows.map((r) => r.table_name).sort()).toEqual([...REGISTRY_TABLES].sort());
    for (const c of cols.rows) {
      expect(c.data_type, c.table_name).toBe("text");
      expect(c.is_nullable, c.table_name).toBe("NO");
      expect(c.column_default, c.table_name).toBe("'default'::text");
    }
  });

  it("gives rows that were already there the default estate", async () => {
    for (const [table, id] of [["eval_runs", "er-1"], ["run_metrics", "rm-1"], ["sessions", "s-1"]]) {
      const r = await admin.query<{ estate_id: string }>(`SELECT estate_id FROM ${table} WHERE id = $1`, [id]);
      expect(r.rows[0]?.estate_id, table).toBe("default");
    }
    const u = await admin.query<{ estate_id: string }>("SELECT estate_id FROM users WHERE sub = 'autox|older'");
    expect(u.rows[0]?.estate_id).toBe("default");
  });

  it("adds the group claims column to an older session table, empty for existing sessions", async () => {
    const r = await admin.query<{ groups: unknown }>("SELECT groups FROM sessions WHERE id = 's-1'");
    expect(r.rows[0]?.groups).toEqual([]);
  });

  it("is idempotent: the same statement runs again on the migrated database", async () => {
    const { REGISTRY_SCHEMA } = db;
    await admin.query(REGISTRY_SCHEMA);
    await admin.query(REGISTRY_SCHEMA);
    const n = await admin.query<{ n: string }>(
      "SELECT count(*) AS n FROM information_schema.columns WHERE table_schema = $1 AND column_name = 'estate_id'",
      [SCHEMA],
    );
    expect(Number(n.rows[0].n)).toBe(REGISTRY_TABLES.length);
  });

  it("writes new rows into the default estate without naming it", async () => {
    await db.query("INSERT INTO run_metrics (id, at) VALUES ('rm-2', now())");
    const [row] = await db.query<{ estate_id: string }>("SELECT estate_id FROM run_metrics WHERE id = 'rm-2'");
    expect(row.estate_id).toBe("default");
  });

  it("a sign-in writes the group claims on the session row, roles beside them; a refresh that carries groups rewrites them", async () => {
    vi.stubEnv("AUTOX_CLIENT_ID", "agentfactory");
    vi.stubEnv("AUTOX_CLIENT_SECRET", "client-secret");
    vi.stubEnv("AUTH_SECRET", "a-test-secret-of-some-length");
    try {
      const auth = await import("@/lib/server/auth");
      await auth.provision({ sub: "autox|grouped", email: "grouped@ey.com", email_verified: true, name: "Grouped", "autox:roles": ["ey-staff"] });
      // An access token already lapsed, so the next read refreshes it.
      const made = await auth.createSession({ sub: "autox|grouped", "autox:roles": ["ey-staff"], groups: ["dlp-leads", "risk-office"] } as never, { id_token: "id-1", access_token: "opaque-access-1", refresh_token: "rt-1", expires_in: -60 });
      const signed = await admin.query<{ groups: unknown; roles: unknown; app_roles: unknown; estate_id: string }>("SELECT groups, roles, app_roles, estate_id FROM sessions WHERE id = $1", [made.id]);
      expect(signed.rows[0]).toEqual({ groups: ["dlp-leads", "risk-office"], roles: ["ey-staff"], app_roles: [], estate_id: "default" });

      const cookie = (await auth.sessionCookie(made.id, made.expiresAt)).split(";")[0];
      const s = await auth.session(new Request("https://agentfactory.example/api/auth/session", { headers: { cookie } }));
      expect(s?.groups).toEqual(["ciso-office"]);
      const refreshed = await admin.query<{ groups: unknown; refresh_token: string }>("SELECT groups, refresh_token FROM sessions WHERE id = $1", [made.id]);
      expect(refreshed.rows[0]).toEqual({ groups: ["ciso-office"], refresh_token: "rt-2" });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
