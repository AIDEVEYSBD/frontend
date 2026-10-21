import { Pool } from "pg";
import { DEFAULT_NAMESPACE, SOURCES } from "@/lib/knowledge";
import { indexDigest, type DigestParts } from "./knowledge-digest";

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
 *
 * Every table carries a namespace: one corpus per engagement, in one store.
 * A source is curated per namespace (the same catalogue entry can be enabled
 * for one client and off for another), so its key is (namespace, id); a
 * document's id is unique on its own, and its sections, chunks and admissions
 * carry the namespace as well, so the search predicate reads the chunk row
 * and never depends on a join to know which corpus it is in. Every table
 * also carries `estate_id`, the tenancy column every table in the platform
 * has (lib/server/db.ts ESTATE_COLUMN), above the namespace.
 */

const pool = new Pool({
  // One connection string (tests, a managed database) or the parts.
  ...(process.env.KNOWLEDGE_DB_DSN
    ? { connectionString: process.env.KNOWLEDGE_DB_DSN }
    : {
        host: process.env.KNOWLEDGE_DB_HOST ?? "127.0.0.1",
        port: Number(process.env.KNOWLEDGE_DB_PORT ?? 5458),
        database: process.env.KNOWLEDGE_DB_NAME ?? "knowledge",
        user: process.env.KNOWLEDGE_DB_USER ?? "knowledge",
        password: process.env.KNOWLEDGE_DB_PASSWORD ?? "knowledge-dev",
      }),
  // Retrieval runs several searches at once and the reranker keeps the CPU
  // busy between them; a connection that has to be opened in that window
  // takes seconds, not milliseconds. Pool enough clients for a round of
  // searches, keep them warm between questions, and never give up on a
  // handshake in the time a rerank batch takes.
  max: 8,
  idleTimeoutMillis: 300_000,
  connectionTimeoutMillis: 20_000,
});

export const SCHEMA = `
CREATE EXTENSION IF NOT EXISTS vector;

-- A curated source, per namespace. Seeded from the catalogue, editable by a curator.
CREATE TABLE IF NOT EXISTS sources (
  namespace   text NOT NULL DEFAULT 'default',
  id          text NOT NULL,
  name        text NOT NULL,
  publisher   text NOT NULL DEFAULT '',
  family      text NOT NULL DEFAULT '',
  licence     text NOT NULL DEFAULT 'open',
  use_for     text NOT NULL DEFAULT '',
  url         text NOT NULL DEFAULT '',
  cadence     text NOT NULL DEFAULT '',
  enabled     boolean NOT NULL DEFAULT true,
  added_at    timestamptz NOT NULL DEFAULT now(),
  estate_id   text NOT NULL DEFAULT 'default',
  PRIMARY KEY (namespace, id)
);

-- One fetch of a source. Staged until somebody admits it.
CREATE TABLE IF NOT EXISTS documents (
  id          text PRIMARY KEY,
  namespace   text NOT NULL DEFAULT 'default',
  source_id   text NOT NULL,
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
  excerpt     text NOT NULL DEFAULT '',
  estate_id   text NOT NULL DEFAULT 'default',
  CONSTRAINT documents_namespace_source_fkey
    FOREIGN KEY (namespace, source_id) REFERENCES sources (namespace, id) ON DELETE CASCADE
);

-- A section of a document: the heading it sits under. Chunks belong to one,
-- so a citation can say which clause it came from rather than an offset.
CREATE TABLE IF NOT EXISTS sections (
  id          bigserial PRIMARY KEY,
  namespace   text NOT NULL DEFAULT 'default',
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  ordinal     integer NOT NULL,
  heading     text NOT NULL DEFAULT '',
  bytes       integer NOT NULL DEFAULT 0,
  estate_id   text NOT NULL DEFAULT 'default'
);

-- A retrievable piece of an admitted document.
CREATE TABLE IF NOT EXISTS chunks (
  id          bigserial PRIMARY KEY,
  namespace   text NOT NULL DEFAULT 'default',
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
  indexed_at  timestamptz NOT NULL DEFAULT now(),
  estate_id   text NOT NULL DEFAULT 'default'
);

CREATE INDEX IF NOT EXISTS chunks_lexeme ON chunks USING gin (lexeme);

-- Every admission and rejection, kept whatever happens to the document.
CREATE TABLE IF NOT EXISTS admissions (
  id          bigserial PRIMARY KEY,
  namespace   text NOT NULL DEFAULT 'default',
  document_id text NOT NULL,
  source_id   text NOT NULL,
  admitted    boolean NOT NULL,
  by_whom     text NOT NULL,
  note        text NOT NULL DEFAULT '',
  chunks      integer NOT NULL DEFAULT 0,
  at          timestamptz NOT NULL DEFAULT now(),
  estate_id   text NOT NULL DEFAULT 'default'
);
`;

/*
 * Idempotent on every start. An index built before namespaces has every
 * row in 'default', which the column defaults give it; the one structural
 * change is the key on sources, from id to (namespace, id), and the
 * documents foreign key that follows it. That swap runs once, guarded by
 * what pg_constraint says the key is, and the new foreign key is added NOT
 * VALID so a legacy orphan (a document whose catalogue entry was renamed)
 * cannot stop the whole index from coming up.
 */
export const MIGRATIONS = `
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

-- Namespaces: one corpus per engagement.
ALTER TABLE sources    ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default';
ALTER TABLE documents  ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default';
ALTER TABLE sections   ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default';
ALTER TABLE chunks     ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default';
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS namespace text NOT NULL DEFAULT 'default';

DO $$
DECLARE
  pk text;
  fk record;
BEGIN
  -- Sources keyed by id alone: re-key to (namespace, id). Any foreign key
  -- onto the old key has to go first; the composite one is added below.
  SELECT conname INTO pk FROM pg_constraint
   WHERE conrelid = 'sources'::regclass AND contype = 'p' AND array_length(conkey, 1) = 1;
  IF pk IS NOT NULL THEN
    FOR fk IN SELECT conname FROM pg_constraint
               WHERE conrelid = 'documents'::regclass AND confrelid = 'sources'::regclass AND contype = 'f' LOOP
      EXECUTE format('ALTER TABLE documents DROP CONSTRAINT %I', fk.conname);
    END LOOP;
    EXECUTE format('ALTER TABLE sources DROP CONSTRAINT %I', pk);
    ALTER TABLE sources ADD CONSTRAINT sources_pkey PRIMARY KEY (namespace, id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'documents'::regclass AND conname = 'documents_namespace_source_fkey') THEN
    ALTER TABLE documents ADD CONSTRAINT documents_namespace_source_fkey
      FOREIGN KEY (namespace, source_id) REFERENCES sources (namespace, id) ON DELETE CASCADE NOT VALID;
  END IF;
END $$;

-- What embedded the admitted chunks, written on the admission, and the
-- integrity digest of the namespace as it stood when the admission finished
-- (lib/server/knowledge-digest.ts); the status read recomputes and compares.
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS model text NOT NULL DEFAULT '';
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS dimensions integer NOT NULL DEFAULT 0;
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS index_digest text NOT NULL DEFAULT '';

-- The tenancy column every table carries (plan L2), as the backend declares
-- it: an index built before it gets the column, and its rows the default.
ALTER TABLE sources    ADD COLUMN IF NOT EXISTS estate_id text NOT NULL DEFAULT 'default';
ALTER TABLE documents  ADD COLUMN IF NOT EXISTS estate_id text NOT NULL DEFAULT 'default';
ALTER TABLE sections   ADD COLUMN IF NOT EXISTS estate_id text NOT NULL DEFAULT 'default';
ALTER TABLE chunks     ADD COLUMN IF NOT EXISTS estate_id text NOT NULL DEFAULT 'default';
ALTER TABLE admissions ADD COLUMN IF NOT EXISTS estate_id text NOT NULL DEFAULT 'default';

-- Every read filters on namespace first; these are the shapes the routes ask for.
CREATE INDEX IF NOT EXISTS documents_namespace_status ON documents (namespace, status);
CREATE INDEX IF NOT EXISTS documents_namespace_source ON documents (namespace, source_id);
CREATE INDEX IF NOT EXISTS sections_namespace_document ON sections (namespace, document_id);
CREATE INDEX IF NOT EXISTS chunks_namespace_source ON chunks (namespace, source_id);
CREATE INDEX IF NOT EXISTS chunks_namespace_document ON chunks (namespace, document_id, ordinal);
CREATE INDEX IF NOT EXISTS admissions_namespace_at ON admissions (namespace, at DESC);
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

/** Close the pool: tests, and nothing else, call this. */
export async function knowledgeClose(): Promise<void> {
  await pool.end();
}

/**
 * Fill gaps in a namespace's register from the catalogue.
 *
 * Idempotent: the catalogue in lib/knowledge.ts is the register's source of
 * truth for what a source is and where it is fetched from, so a change there
 * (a better URL, a corrected licence) reaches every deployment on the next
 * read. A namespace's own curation (which sources it enabled), its fetched
 * documents and its admissions are never touched by the seed. A namespace
 * comes into being the first time it is seeded.
 */
export async function seedNamespace(namespace: string): Promise<void> {
  const params: unknown[] = [namespace];
  const rows = SOURCES.map((s) => {
    const b = params.length;
    params.push(s.id, s.name, s.publisher, s.family, s.licence, s.use, s.url, s.cadence);
    return `($1,$${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`;
  });
  await kq(
    `INSERT INTO sources (namespace, id, name, publisher, family, licence, use_for, url, cadence)
     VALUES ${rows.join(",")}
     ON CONFLICT (namespace, id) DO UPDATE SET name = EXCLUDED.name, publisher = EXCLUDED.publisher, family = EXCLUDED.family,
       licence = EXCLUDED.licence, use_for = EXCLUDED.use_for, url = EXCLUDED.url, cadence = EXCLUDED.cadence`,
    params,
  );
}

/** The namespaces that exist: any with a register or a document, the default always among them. */
export async function listNamespaces(): Promise<string[]> {
  const rows = await kq<{ namespace: string }>(
    `SELECT namespace FROM sources UNION SELECT namespace FROM documents ORDER BY 1`,
  );
  const names = new Set<string>([DEFAULT_NAMESPACE, ...rows.map((r) => r.namespace)]);
  return [...names].sort((a, b) => (a === DEFAULT_NAMESPACE ? -1 : b === DEFAULT_NAMESPACE ? 1 : a.localeCompare(b)));
}

/** An ANN index is worth building only once there is enough in the table for
 *  it to beat a scan. Below that, a sequential scan over a few thousand rows
 *  is faster and exact. The index spans every namespace; the search filters
 *  on namespace within it. */
export async function ensureAnnIndex(): Promise<void> {
  const [{ n }] = await kq<{ n: string }>("SELECT count(*) AS n FROM chunks");
  if (Number(n) < 2000) return;
  await kq(
    "CREATE INDEX IF NOT EXISTS chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops)",
  ).catch(() => {});
}

/* ── index integrity ── */


/**
 * The parts the integrity digest is computed over, read from the live
 * tables for one namespace: every admitted document with the chunks it
 * holds, and every admission row. One read for the status route, the
 * admission and the re-embed, so the stored digest and the recomputed one
 * can only differ when the tables did.
 */
export async function digestParts(namespace: string): Promise<DigestParts> {
  const documents = await kq<{ id: string; chunks: string }>(
    `SELECT d.id, (SELECT count(*) FROM chunks c WHERE c.namespace = d.namespace AND c.document_id = d.id) AS chunks
       FROM documents d WHERE d.namespace = $1 AND d.status = 'admitted' ORDER BY d.id`,
    [namespace],
  );
  const admissions = await kq<{ id: string }>("SELECT id FROM admissions WHERE namespace = $1 ORDER BY id", [namespace]);
  return { namespace, documents: documents.map((d) => ({ id: d.id, chunks: Number(d.chunks) })), admissions: admissions.map((a) => a.id) };
}

export async function namespaceDigest(namespace: string): Promise<string> {
  return indexDigest(await digestParts(namespace));
}

/** Stamp the digest of the namespace as it stands now on one admission row (the one that just changed it). */
export async function stampAdmission(namespace: string, admissionId: number | string, model: string, dimensions: number): Promise<string> {
  const digest = await namespaceDigest(namespace);
  await kq("UPDATE admissions SET index_digest = $3, model = $4, dimensions = $5 WHERE namespace = $1 AND id = $2", [namespace, admissionId, digest, model, dimensions]);
  return digest;
}

export interface Integrity {
  ok: boolean | null;
  /** The digest the latest admission stored; empty when no admission has stamped one yet. */
  expected: string;
  /** The digest of the tables as they stand. */
  actual: string;
  /** The admission the expectation comes from. */
  admission: { id: string; at: string; by_whom: string; model: string; dimensions: number } | null;
  note: string;
}

/** Recompute the digest and compare it with the one the latest admission stored. */
export async function integrityOf(namespace: string): Promise<Integrity> {
  const [latest] = await kq<{ id: string; at: string; by_whom: string; model: string; dimensions: number; index_digest: string }>(
    "SELECT id, at, by_whom, model, dimensions, index_digest FROM admissions WHERE namespace = $1 ORDER BY id DESC LIMIT 1",
    [namespace],
  );
  const actual = await namespaceDigest(namespace);
  if (!latest) return { ok: null, expected: "", actual, admission: null, note: "nothing has been admitted in this namespace yet, so there is no expectation to check against" };
  if (!latest.index_digest) {
    return { ok: null, expected: "", actual, admission: { id: latest.id, at: latest.at, by_whom: latest.by_whom, model: latest.model, dimensions: Number(latest.dimensions) }, note: "the latest admission predates the integrity digest; the next admission or re-embed records one" };
  }
  const ok = latest.index_digest === actual;
  return {
    ok,
    expected: latest.index_digest,
    actual,
    admission: { id: latest.id, at: latest.at, by_whom: latest.by_whom, model: latest.model, dimensions: Number(latest.dimensions) },
    note: ok ? "the index matches the state the latest admission recorded" : "index changed outside admission: the documents, chunk counts or admission rows differ from what the latest admission recorded",
  };
}
