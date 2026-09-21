import path from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import { SOURCES } from "@/lib/knowledge";
import { ensureAnnIndex, knowledgeReady, kq } from "@/lib/server/knowledge-db";
import { embeddingModel, embeddingReady } from "@/lib/server/embed";

/**
 * The knowledge base, as it actually stands.
 *
 * The curated list is seeded from the catalogue on first read, so a fresh
 * deployment has the corpus a GRC team would expect without anybody typing it
 * in. Everything after that — what has been fetched, what is waiting for a
 * person, what is indexed — is read from the index itself.
 *
 * Retrieval activity comes from the run journals rather than a counter, so a
 * source nobody queries is visible as exactly that.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = path.resolve(process.cwd(), "..", "runtime");
const RUNS = path.join(ROOT, "workspace", "runs");

/**
 * Fill gaps in the register from the catalogue.
 *
 * Idempotent: the catalogue in lib/knowledge.ts is the register's source of
 * truth for what a source is and where it is fetched from, so a change there
 * (a better URL, a corrected licence) reaches every deployment on the next
 * read. Fetched documents and admissions are never touched by the seed.
 */
async function seed(): Promise<void> {
  for (const s of SOURCES) {
    await kq(
      `INSERT INTO sources (id, name, publisher, family, licence, use_for, url, cadence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, publisher = EXCLUDED.publisher, family = EXCLUDED.family,
         licence = EXCLUDED.licence, use_for = EXCLUDED.use_for, url = EXCLUDED.url, cadence = EXCLUDED.cadence`,
      [s.id, s.name, s.publisher, s.family, s.licence, s.use, s.url, s.cadence],
    );
  }
}

/** How often agents actually searched, from the record. */
async function retrievalActivity(): Promise<{ calls: number; byAgent: Record<string, number>; lastAt: string | null }> {
  let calls = 0;
  const byAgent: Record<string, number> = {};
  let lastAt: string | null = null;
  try {
    for (const f of (await readdir(RUNS)).filter((x) => x.endsWith(".json"))) {
      try {
        const full = path.join(RUNS, f);
        const doc = JSON.parse(await readFile(full, "utf-8"));
        const entries = doc?.journal?.entries ?? [];
        let touched = false;
        for (const e of entries) {
          if (e.kind !== "tool.call") continue;
          const tool = String(e.data?.tool ?? "");
          if (!tool.startsWith("retrieval.")) continue;
          calls += 1;
          touched = true;
          const agent = String(doc.system ?? "");
          byAgent[agent] = (byAgent[agent] ?? 0) + 1;
        }
        // The run file is written as the run ends, so its clock is when the retrieval last happened.
        if (touched) {
          const at = (await stat(full)).mtime.toISOString();
          if (!lastAt || at > lastAt) lastAt = at;
        }
      } catch {
        /* unreadable run */
      }
    }
  } catch {
    /* no runs directory */
  }
  return { calls, byAgent, lastAt };
}

export async function GET() {
  if (!(await knowledgeReady())) {
    // The same shape, with nothing in it. A degraded response that omits half
    // its fields turns a missing container into a client-side crash, and the
    // page can no longer tell anyone what is wrong.
    return Response.json({
      ready: false,
      error:
        "The vector store is not reachable, so nothing is indexed. Start it with `docker compose up -d vectors`, or set KNOWLEDGE_DB_HOST to reach it.",
      sources: SOURCES.map((s) => ({
        id: s.id,
        name: s.name,
        publisher: s.publisher,
        family: s.family,
        licence: s.licence,
        use_for: s.use,
        url: s.url,
        cadence: s.cadence,
        enabled: true,
        documents: "0",
        staged: "0",
        chunks: "0",
        last_admitted: null,
      })),
      staged: [],
      admissions: [],
      totals: { chunks: 0, documents: 0, admitted: 0, tokens: 0, sources: SOURCES.length },
      index: {
        store: "pgvector",
        model: embeddingModel(),
        dimensions: 1536,
        embeddingReady: embeddingReady(),
      },
      retrieval: { calls: 0, byAgent: {}, lastAt: null },
      basis: "the curated catalogue this deployment seeds on first connection; nothing is indexed yet",
    });
  }
  await seed();
  await ensureAnnIndex();

  const sources = await kq(
    `SELECT s.*,
            (SELECT count(*) FROM documents d WHERE d.source_id = s.id AND d.status = 'admitted') AS documents,
            (SELECT count(*) FROM documents d WHERE d.source_id = s.id AND d.status = 'staged')   AS staged,
            (SELECT count(*) FROM chunks c WHERE c.source_id = s.id)                              AS chunks,
            (SELECT max(d.decided_at) FROM documents d WHERE d.source_id = s.id AND d.status = 'admitted') AS last_admitted
       FROM sources s ORDER BY s.family, s.name`,
  );

  const staged = await kq(
    `SELECT id, source_id, title, url, bytes, chunks, digest, fetched_at, excerpt
       FROM documents WHERE status = 'staged' ORDER BY fetched_at DESC LIMIT 50`,
  );

  const admissions = await kq(
    `SELECT a.*, d.title FROM admissions a LEFT JOIN documents d ON d.id = a.document_id
      ORDER BY a.at DESC LIMIT 25`,
  );

  const [totals] = await kq<{ chunks: string; documents: string; admitted: string; tokens: string }>(
    `SELECT (SELECT count(*) FROM chunks) AS chunks,
            (SELECT count(*) FROM documents) AS documents,
            (SELECT count(*) FROM documents WHERE status = 'admitted') AS admitted,
            (SELECT coalesce(sum(tokens),0) FROM chunks) AS tokens`,
  );

  return Response.json({
    ready: true,
    sources,
    staged,
    admissions,
    totals: {
      chunks: Number(totals.chunks),
      documents: Number(totals.documents),
      admitted: Number(totals.admitted),
      tokens: Number(totals.tokens),
      sources: sources.length,
    },
    index: {
      store: "pgvector",
      model: embeddingModel(),
      dimensions: 1536,
      embeddingReady: embeddingReady(),
    },
    retrieval: await retrievalActivity(),
    basis:
      "sources are the curated list; document, chunk and admission counts are read from the index; retrieval activity is counted from run journals",
  });
}

/** Enable or disable a source for retrieval. Curation, not deletion. */
export async function POST(req: Request) {
  let body: { id?: string; enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }
  if (!body.id || typeof body.enabled !== "boolean") {
    return Response.json({ error: "send { id, enabled }" }, { status: 400 });
  }
  if (!(await knowledgeReady())) return Response.json({ error: "the knowledge index is unreachable" }, { status: 503 });
  await kq("UPDATE sources SET enabled = $2 WHERE id = $1", [body.id, body.enabled]);
  return Response.json({ id: body.id, enabled: body.enabled });
}
