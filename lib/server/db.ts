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
          ALTER TABLE workflows ADD COLUMN IF NOT EXISTS deployed_at timestamptz;
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
