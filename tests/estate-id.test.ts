import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ESTATE_COLUMN, REGISTRY_SCHEMA } from "@/lib/server/db";
import { MIGRATIONS, SCHEMA } from "@/lib/server/knowledge-db";
import { FRONTEND } from "./routes";

/**
 * Every table carries an estate id (plan L2), the console's as well as the
 * backend's, declared the way the backend declares it (backend/app/db.py):
 * `estate_id text NOT NULL DEFAULT 'default'`, in the CREATE TABLE so a fresh
 * database has it from the first statement, and in an `ADD COLUMN IF NOT
 * EXISTS` so a database an earlier console created gains it.
 *
 * This reads the source: every CREATE TABLE under lib/ and app/ is found and
 * held to both, so a table added later without the column fails here. The
 * statements themselves are run against Postgres by tests/registry-db.test.ts
 * (AGENTFACTORY_DB_DSN) and tests/knowledge-db.test.ts (KNOWLEDGE_DB_DSN).
 */

const COLUMN = /\bestate_id\s+text\s+NOT\s+NULL\s+DEFAULT\s+'default'/;
const alterFor = (table: string) => new RegExp(`ALTER\\s+TABLE\\s+${table}\\s+ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+estate_id\\s+text\\s+NOT\\s+NULL\\s+DEFAULT\\s+'default'`);

/** Every `CREATE TABLE [IF NOT EXISTS] name ( ... )` in a text, with its column list (parentheses balanced). */
function createTables(text: string): { table: string; body: string }[] {
  const out: { table: string; body: string }[] = [];
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][a-z0-9_]*)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < text.length && depth > 0; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
    }
    out.push({ table: m[1], body: text.slice(m.index + m[0].length, i - 1) });
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  return (readdirSync(path.join(FRONTEND, dir), { recursive: true }) as string[])
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .map((f) => path.join(dir, f).split(path.sep).join("/"));
}

const files = [...sourceFiles("lib"), ...sourceFiles("app")].filter((f) => !f.endsWith(".d.ts"));
const found = files.flatMap((file) => createTables(readFileSync(path.join(FRONTEND, file), "utf-8")).map((t) => ({ ...t, file })));

describe("estate_id on the console's tables", () => {
  it("declares the column as the backend does", () => {
    expect(ESTATE_COLUMN).toBe("estate_id text NOT NULL DEFAULT 'default'");
    expect(ESTATE_COLUMN).toMatch(COLUMN);
  });

  it("finds every table the console creates", () => {
    const tables = found.map((t) => t.table).sort();
    // The registry (lib/server/db.ts) and the knowledge index (lib/server/knowledge-db.ts).
    expect(tables).toEqual(
      [
        "workflows", "settings", "runs", "eval_sets", "eval_runs", "trigger_jobs", "api_keys", "attached_agents",
        "users", "sessions", "auth_events", "nhi_owners", "run_metrics",
        "sources", "documents", "sections", "chunks", "admissions",
      ].sort(),
    );
    expect(new Set(found.map((t) => t.file))).toEqual(new Set(["lib/server/db.ts", "lib/server/knowledge-db.ts"]));
  });

  for (const t of found) {
    it(`${t.table} (${t.file}) has estate_id in its CREATE TABLE and an ALTER for an older database`, () => {
      expect(t.body, `CREATE TABLE ${t.table} in ${t.file} has no ${ESTATE_COLUMN}`).toMatch(COLUMN);
      const text = readFileSync(path.join(FRONTEND, t.file), "utf-8");
      expect(text, `${t.file} never adds estate_id to an existing ${t.table}`).toMatch(alterFor(t.table));
    });
  }

  it("runs the ALTERs after the CREATEs, so an older database is migrated in the same pass", () => {
    for (const table of ["eval_sets", "eval_runs", "run_metrics", "sessions"]) {
      const created = REGISTRY_SCHEMA.search(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`));
      const altered = REGISTRY_SCHEMA.search(alterFor(table));
      expect(created).toBeGreaterThan(-1);
      expect(altered).toBeGreaterThan(created);
    }
    // The knowledge index: CREATEs in SCHEMA, the ALTERs in MIGRATIONS, which runs after it (knowledgeReady).
    for (const table of ["sources", "documents", "sections", "chunks", "admissions"]) {
      expect(SCHEMA).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\(`));
      expect(MIGRATIONS).toMatch(alterFor(table));
    }
  });

  it("gives a session its group claims column, as the backend reads it", () => {
    const sessions = createTables(REGISTRY_SCHEMA).find((t) => t.table === "sessions");
    expect(sessions?.body).toMatch(/\bgroups\s+jsonb\s+NOT\s+NULL\s+DEFAULT\s+'\[\]'::jsonb/);
    expect(REGISTRY_SCHEMA).toMatch(/ALTER TABLE sessions ADD COLUMN IF NOT EXISTS groups jsonb NOT NULL DEFAULT '\[\]'::jsonb/);
  });
});
