import { Pool } from "pg";

/**
 * The knowledge index.
 *
 * A separate database from the registry, on pgvector, because what an agent is
 * allowed to believe is a different asset from what the platform is configured
 * with — different retention, different backup, and a different blast radius if
 * either is wrong.
 *
 * The schema is small on purpose. A source is something a person curated. A
 * document is one fetch of that source, staged and awaiting a decision. A chunk
 * is a retrievable piece of an admitted document, with its embedding. Nothing
 * becomes retrievable without an admission row naming who admitted it, which is
 * the whole control this page exists to show.
 */

const pool = new Pool({
  host: process.env.KNOWLEDGE_DB_HOST ?? "127.0.0.1",
  port: Number(process.env.KNOWLEDGE_DB_PORT ?? 5458),
  database: process.env.KNOWLEDGE_DB_NAME ?? "knowledge",
  user: process.env.KNOWLEDGE_DB_USER ?? "knowledge",
  password: process.env.KNOWLEDGE_DB_PASSWORD ?? "knowledge-dev",
  max: 4,
  connectionTimeoutMillis: 2500,
});

const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS vector;

-- A curated source. Seeded from the catalogue, editable by a curator.
CREATE TABLE IF NOT EXISTS sources (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  publisher   text NOT NULL DEFAULT '',
  family      text NOT NULL DEFAULT '',
  licence     text NOT NULL DEFAULT 'open',
  use_for     text NOT NULL DEFAULT '',
  url         text NOT NULL DEFAULT '',
  cadence     text NOT NULL DEFAULT '',
  enabled     boolean NOT NULL DEFAULT true,
  added_at    timestamptz NOT NULL DEFAULT now()
);

-- One fetch of a source. Staged until somebody admits it.
CREATE TABLE IF NOT EXISTS documents (
  id          text PRIMARY KEY,
  source_id   text NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  title       text NOT NULL DEFAULT '',
  url         text NOT NULL DEFAULT '',
  -- staged | admitted | rejected | superseded
  status      text NOT NULL DEFAULT 'staged',
  bytes       integer NOT NULL DEFAULT 0,
  chunks      integer NOT NULL DEFAULT 0,
  -- sha256 of the fetched text: a re-fetch that matches is not a new version
  digest      text NOT NULL DEFAULT '',
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  decided_at  timestamptz,
  decided_by  text NOT NULL DEFAULT '',
  note        text NOT NULL DEFAULT '',
  excerpt     text NOT NULL DEFAULT ''
);

-- A section of a document: the heading it sits under. Chunks belong to one,
-- so a citation can say which clause it came from rather than an offset.
CREATE TABLE IF NOT EXISTS sections (
  id          bigserial PRIMARY KEY,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal     integer NOT NULL,
  heading     text NOT NULL DEFAULT '',
  bytes       integer NOT NULL DEFAULT 0
);

-- A retrievable piece of an admitted document.
CREATE TABLE IF NOT EXISTS chunks (
  id          bigserial PRIMARY KEY,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  section_id  bigint REFERENCES sections(id) ON DELETE SET NULL,
  source_id   text NOT NULL,
  ordinal     integer NOT NULL,
  heading     text NOT NULL DEFAULT '',
  body        text NOT NULL,
  tokens      integer NOT NULL DEFAULT 0,
  -- Metadata derived per chunk at ingestion: entities, references and the
  -- kind of passage it is. Read back on retrieval so a hit can be explained.
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding   vector(1536),
  -- The lexical half of hybrid retrieval. Postgres' own text search, so BM25-
  -- style ranking needs no second service and cannot drift from the vectors.
  lexeme      tsvector,
  indexed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chunks_source ON chunks (source_id);
CREATE INDEX IF NOT EXISTS chunks_lexeme ON chunks USING gin (lexeme);
CREATE INDEX IF NOT EXISTS documents_status ON documents (status);

-- Every admission and rejection, kept whatever happens to the document.
CREATE TABLE IF NOT EXISTS admissions (
  id          bigserial PRIMARY KEY,
  document_id text NOT NULL,
  source_id   text NOT NULL,
  admitted    boolean NOT NULL,
  by_whom     text NOT NULL,
  note        text NOT NULL DEFAULT '',
  chunks      integer NOT NULL DEFAULT 0,
  at          timestamptz NOT NULL DEFAULT now()
);
`;

const MIGRATIONS = `
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS section_id bigint;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS heading text NOT NULL DEFAULT '';
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS lexeme tsvector;
UPDATE chunks SET lexeme = to_tsvector('english', body) WHERE lexeme IS NULL;
CREATE INDEX IF NOT EXISTS chunks_lexeme ON chunks USING gin (lexeme);
ALTER TABLE documents ADD COLUMN IF NOT EXISTS text text NOT NULL DEFAULT '';
ALTER TABLE documents ADD COLUMN IF NOT EXISTS parts integer NOT NULL DEFAULT 1;
-- What the fetch pulled and what the cleaning pass removed, for the reviewer.
ALTER TABLE documents ADD COLUMN IF NOT EXISTS pages jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS cleaning jsonb;
`;

let ready: Promise<boolean> | null = null;

/**
 * True once the schema exists.
 *
 * Success is cached; failure is not. The app and the store start together, so
 * the first read can easily land while the database is still coming up — and a
 * memoised `false` would leave the page reporting an unreachable index until
 * somebody restarted the container, long after the store was fine.
 */
export function knowledgeReady(): Promise<boolean> {
  if (!ready) {
    ready = pool
      .query(SCHEMA)
      .then(() => pool.query(MIGRATIONS))
      .then(() => true)
      .catch(() => {
        ready = null; // try again on the next request
        return false;
      });
  }
  return ready;
}

export async function kq<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(sql, params);
  return res.rows as T[];
}

/** An ANN index is worth building only once there is enough in the table for
 *  it to beat a scan. Below that, a sequential scan over a few thousand rows
 *  is faster and exact. */
export async function ensureAnnIndex(): Promise<void> {
  const [{ n }] = await kq<{ n: string }>("SELECT count(*) AS n FROM chunks");
  if (Number(n) < 2000) return;
  await kq(
    "CREATE INDEX IF NOT EXISTS chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops)",
  ).catch(() => {});
}
