import { Pool } from "pg";

/**
 * AgentFactoryDB — the registry.
 *
 * Postgres holds what must survive anything: saved workflows, deployment
 * settings, the run index. The runtime's workspace files become a materialised
 * view — every DB write writes through to the file the Python runtime reads,
 * so `agent.invoke` keeps working without the runtime growing a database
 * driver it does not need. One writer (this control plane), one reader path
 * per consumer.
 *
 * Every accessor degrades honestly: if the container is down, routes fall back
 * to the files and say so in their response, because a registry that fails
 * closed during a demo teaches the wrong lesson about the architecture.
 */

const pool = new Pool({
  host: process.env.AGENTFACTORY_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.AGENTFACTORY_DB_PORT ?? 5455),
  database: process.env.AGENTFACTORY_DB_NAME ?? "agentfactory",
  user: process.env.AGENTFACTORY_DB_USER ?? "agentfactory",
  password: process.env.AGENTFACTORY_DB_PASSWORD ?? "agentfactory-dev",
  max: 4,
  connectionTimeoutMillis: 2500,
});

let ready: Promise<boolean> | null = null;

/** True when the schema exists and the pool answers. Cached per process. */
export function dbReady(): Promise<boolean> {
  if (!ready) {
    ready = (async () => {
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS workflows (
            id          text PRIMARY KEY,
            name        text NOT NULL DEFAULT '',
            description text NOT NULL DEFAULT '',
            spec        jsonb NOT NULL,
            updated_at  timestamptz NOT NULL DEFAULT now()
          );
          CREATE TABLE IF NOT EXISTS settings (
            key        text PRIMARY KEY,
            value      jsonb NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now()
          );
          CREATE TABLE IF NOT EXISTS runs (
            id      text PRIMARY KEY,
            system  text NOT NULL DEFAULT '',
            state   text NOT NULL DEFAULT '',
            summary jsonb NOT NULL DEFAULT '{}'::jsonb,
            run     jsonb NOT NULL,
            at      timestamptz NOT NULL DEFAULT now()
          );
          CREATE TABLE IF NOT EXISTS eval_sets (
            id         text PRIMARY KEY,
            agent      text NOT NULL,
            name       text NOT NULL DEFAULT '',
            cases      jsonb NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now()
          );
          ALTER TABLE eval_sets ADD COLUMN IF NOT EXISTS model text NOT NULL DEFAULT '';
          ALTER TABLE eval_sets ADD COLUMN IF NOT EXISTS labels jsonb;
          CREATE TABLE IF NOT EXISTS eval_runs (
            id      text PRIMARY KEY,
            set_id  text NOT NULL,
            agent   text NOT NULL,
            model   text NOT NULL DEFAULT '',
            digest  text NOT NULL DEFAULT '',
            passed  int  NOT NULL DEFAULT 0,
            total   int  NOT NULL DEFAULT 0,
            results jsonb NOT NULL DEFAULT '[]'::jsonb,
            at      timestamptz NOT NULL DEFAULT now()
          );
          ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS matrix jsonb;
          ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS summary jsonb;
          CREATE TABLE IF NOT EXISTS trigger_jobs (
            id           text PRIMARY KEY,
            agent        text NOT NULL,
            external_id  text,
            source       text NOT NULL DEFAULT 'api',
            input        jsonb NOT NULL,
            model        text NOT NULL DEFAULT '',
            priority     int  NOT NULL DEFAULT 5,
            status       text NOT NULL DEFAULT 'queued',
            attempts     int  NOT NULL DEFAULT 0,
            max_attempts int  NOT NULL DEFAULT 3,
            claimed_by   text,
            lease_until  timestamptz,
            run_id       text,
            result       jsonb,
            error        text,
            created_at   timestamptz NOT NULL DEFAULT now(),
            started_at   timestamptz,
            finished_at  timestamptz
          );
          CREATE UNIQUE INDEX IF NOT EXISTS trigger_jobs_external
            ON trigger_jobs (agent, external_id) WHERE external_id IS NOT NULL;
          CREATE INDEX IF NOT EXISTS trigger_jobs_claim ON trigger_jobs (status, priority, created_at);
          CREATE TABLE IF NOT EXISTS api_keys (
            id         text PRIMARY KEY,
            name       text NOT NULL,
            agent      text,
            key_hash   text NOT NULL UNIQUE,
            prefix     text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            last_used  timestamptz,
            revoked_at timestamptz
          );
          ALTER TABLE workflows ADD COLUMN IF NOT EXISTS deployed_at timestamptz;
          CREATE TABLE IF NOT EXISTS attached_agents (
            id         text PRIMARY KEY,
            name       text NOT NULL,
            mode       text NOT NULL DEFAULT 'sdk',   -- sdk | a2a
            framework  text NOT NULL DEFAULT '',
            language   text NOT NULL DEFAULT '',
            owner      text NOT NULL DEFAULT '',
            card_url   text NOT NULL DEFAULT '',
            key_id     text,
            key_prefix text NOT NULL DEFAULT '',
            demo       boolean NOT NULL DEFAULT false,
            created_at timestamptz NOT NULL DEFAULT now(),
            last_seen  timestamptz
          );
          ALTER TABLE attached_agents ADD COLUMN IF NOT EXISTS grants jsonb NOT NULL DEFAULT '[]'::jsonb;
          ALTER TABLE attached_agents ADD COLUMN IF NOT EXISTS gate_at text NOT NULL DEFAULT '';
          ALTER TABLE attached_agents ADD COLUMN IF NOT EXISTS injection text NOT NULL DEFAULT 'block';
          ALTER TABLE attached_agents ADD COLUMN IF NOT EXISTS blocked boolean NOT NULL DEFAULT false;
          -- Identity: people provisioned from the SSO (keyed on sub, never email), their
          -- sessions, the auth trail, and the human owner of every non-human identity.
          -- Created ahead of the SSO integration so the IAM page has its shape; see SSO_PLAN.md.
          CREATE TABLE IF NOT EXISTS users (
            sub                text PRIMARY KEY,
            email              text NOT NULL DEFAULT '',
            email_verified     boolean NOT NULL DEFAULT false,
            name               text NOT NULL DEFAULT '',
            preferred_username text NOT NULL DEFAULT '',
            org_type           text NOT NULL DEFAULT '',
            is_ey_employee     boolean NOT NULL DEFAULT false,
            orgs               jsonb NOT NULL DEFAULT '[]'::jsonb,
            last_roles         jsonb NOT NULL DEFAULT '[]'::jsonb,
            last_app_roles     jsonb NOT NULL DEFAULT '[]'::jsonb,
            first_seen         timestamptz NOT NULL DEFAULT now(),
            last_seen          timestamptz NOT NULL DEFAULT now(),
            disabled_at        timestamptz,
            disabled_by        text
          );
          CREATE TABLE IF NOT EXISTS sessions (
            id                 text PRIMARY KEY,
            sub                text NOT NULL REFERENCES users(sub) ON DELETE CASCADE,
            id_token           text NOT NULL,
            access_token       text NOT NULL,
            access_expires_at  timestamptz NOT NULL,
            refresh_token      text,
            roles              jsonb NOT NULL DEFAULT '[]'::jsonb,
            app_roles          jsonb NOT NULL DEFAULT '[]'::jsonb,
            created_at         timestamptz NOT NULL DEFAULT now(),
            last_seen          timestamptz NOT NULL DEFAULT now(),
            expires_at         timestamptz NOT NULL
          );
          CREATE INDEX IF NOT EXISTS sessions_sub ON sessions (sub);
          CREATE TABLE IF NOT EXISTS auth_events (
            id       bigserial PRIMARY KEY,
            at       timestamptz NOT NULL DEFAULT now(),
            kind     text NOT NULL,
            sub      text,
            email    text,
            detail   jsonb NOT NULL DEFAULT '{}'::jsonb
          );
          CREATE TABLE IF NOT EXISTS nhi_owners (
            kind          text NOT NULL,
            id            text NOT NULL,
            owner         text NOT NULL DEFAULT '',
            owner_sub     text,
            purpose       text NOT NULL DEFAULT '',
            review_due_at timestamptz,
            updated_at    timestamptz NOT NULL DEFAULT now(),
            updated_by    text NOT NULL DEFAULT '',
            PRIMARY KEY (kind, id)
          );
          CREATE TABLE IF NOT EXISTS run_metrics (
            id          text PRIMARY KEY,
            system      text NOT NULL DEFAULT '',
            state       text NOT NULL DEFAULT '',
            at          timestamptz NOT NULL,
            duration_ms bigint NOT NULL DEFAULT 0,
            tokens_in   bigint NOT NULL DEFAULT 0,
            tokens_out  bigint NOT NULL DEFAULT 0,
            cost        numeric,          -- NULL means genuinely unknown, never zero
            denials     int NOT NULL DEFAULT 0,
            models      jsonb NOT NULL DEFAULT '[]'::jsonb,
            artifacts   jsonb NOT NULL DEFAULT '[]'::jsonb
          );
        `);
        return true;
      } catch {
        ready = null; // retry on the next call — the container may be starting
        return false;
      }
    })();
  }
  return ready;
}

export async function query<T extends Record<string, unknown>>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}
