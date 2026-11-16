import path from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import { DEFAULT_NAMESPACE, NAMESPACE_RULE, SOURCES, parseNamespace } from "@/lib/knowledge";
import { ensureAnnIndex, integrityOf, knowledgeReady, kq, listNamespaces, seedNamespace } from "@/lib/server/knowledge-db";
import { COLUMN_DIMENSIONS, embeddingStatus } from "@/lib/server/embed";
import { permit } from "@/lib/server/auth";

/**
 * The knowledge base, as it actually stands, for one namespace.
 *
 * `sources` is the namespace's register: the sources a person there has
 * enabled. `catalogue` is everything else the namespace knows of, switched
 * off: the public catalogue (lib/knowledge.ts), offered on the first read of
 * a namespace and joined to the register one source at a time, by a person
 * (the POST below). A new deployment, or a new engagement, has an empty
 * register. Everything after that (what has been fetched, what is waiting
 * for a person, what is indexed) is read from the index itself, for that
 * namespace only.
 *
 * `?namespaces=1` answers with the namespaces that exist instead, for the
 * picker. Retrieval activity comes from the run journals rather than a
 * counter, so a source nobody queries is visible as exactly that.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = path.resolve(process.cwd(), "..", "runtime");
const RUNS = path.join(ROOT, "workspace", "runs");

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

export async function GET(req: Request) {
  { const gate = await permit(req, "view"); if (gate) return gate; }
  const url = new URL(req.url);
  const namespace = parseNamespace(url.searchParams.get("namespace"));
  if (!namespace) return Response.json({ error: NAMESPACE_RULE }, { status: 400 });

  if (url.searchParams.get("namespaces")) {
    const ready = await knowledgeReady();
    return Response.json({ ready, namespaces: ready ? await listNamespaces() : [DEFAULT_NAMESPACE] });
  }

  const embedding = await embeddingStatus();
  const index = {
    store: "pgvector",
    model: embedding.model,
    dimensions: COLUMN_DIMENSIONS,
    embeddingReady: embedding.ready,
    embedding,
  };

  if (!(await knowledgeReady())) {
    // The same shape, with nothing in it. A degraded response that omits half
    // its fields turns a missing container into a client-side crash, and the
    // page can no longer tell anyone what is wrong.
    return Response.json({
      ready: false,
      namespace,
      namespaces: [DEFAULT_NAMESPACE],
      error:
        "The vector store is not reachable, so nothing is indexed. KNOWLEDGE_DB_HOST names where it is.",
      // Which sources this namespace enabled is in the store, so the register
      // is unknown here and nothing stands in for it: the catalogue is only
      // ever an offer.
      sources: [],
      catalogue: SOURCES.map((s) => ({
        id: s.id,
        name: s.name,
        publisher: s.publisher,
        family: s.family,
        licence: s.licence,
        use_for: s.use,
        url: s.url,
        cadence: s.cadence,
        enabled: false,
        documents: "0",
        staged: "0",
        chunks: "0",
        last_admitted: null,
      })),
      staged: [],
      admissions: [],
      totals: { chunks: 0, documents: 0, admitted: 0, tokens: 0, sources: 0 },
      index: { ...index, integrity: null },
      retrieval: { calls: 0, byAgent: {}, lastAt: null },
      basis: "the store is unreachable, so the register, the documents and the index could not be read; the catalogue is the public list a source can be added from",
    });
  }
  await seedNamespace(namespace);
  await ensureAnnIndex();

  const rows = await kq<{ enabled: boolean }>(
    `SELECT s.*,
            (SELECT count(*) FROM documents d WHERE d.namespace = s.namespace AND d.source_id = s.id AND d.status = 'admitted') AS documents,
            (SELECT count(*) FROM documents d WHERE d.namespace = s.namespace AND d.source_id = s.id AND d.status = 'staged')   AS staged,
            (SELECT count(*) FROM chunks c WHERE c.namespace = s.namespace AND c.source_id = s.id)                              AS chunks,
            (SELECT max(d.decided_at) FROM documents d WHERE d.namespace = s.namespace AND d.source_id = s.id AND d.status = 'admitted') AS last_admitted
       FROM sources s WHERE s.namespace = $1 ORDER BY s.family, s.name`,
    [namespace],
  );
  // The register is what a person enabled; the rest is offered, not held.
  const sources = rows.filter((s) => s.enabled);
  const catalogue = rows.filter((s) => !s.enabled);

  const staged = await kq(
    `SELECT id, source_id, title, url, bytes, chunks, digest, fetched_at, excerpt
       FROM documents WHERE namespace = $1 AND status = 'staged' ORDER BY fetched_at DESC LIMIT 50`,
    [namespace],
  );

  const admissions = await kq(
    `SELECT a.*, d.title FROM admissions a LEFT JOIN documents d ON d.namespace = a.namespace AND d.id = a.document_id
      WHERE a.namespace = $1 ORDER BY a.at DESC LIMIT 25`,
    [namespace],
  );
  // Recomputed on every read and compared with what the latest admission
  // stored: a difference is the index having changed outside admission.
  const integrity = await integrityOf(namespace);

  const [totals] = await kq<{ chunks: string; documents: string; admitted: string; tokens: string }>(
    `SELECT (SELECT count(*) FROM chunks WHERE namespace = $1) AS chunks,
            (SELECT count(*) FROM documents WHERE namespace = $1) AS documents,
            (SELECT count(*) FROM documents WHERE namespace = $1 AND status = 'admitted') AS admitted,
            (SELECT coalesce(sum(tokens),0) FROM chunks WHERE namespace = $1) AS tokens`,
    [namespace],
  );

  return Response.json({
    ready: true,
    namespace,
    namespaces: await listNamespaces(),
    sources,
    catalogue,
    staged,
    admissions,
    totals: {
      chunks: Number(totals.chunks),
      documents: Number(totals.documents),
      admitted: Number(totals.admitted),
      tokens: Number(totals.tokens),
      sources: sources.length,
    },
    index: { ...index, integrity },
    retrieval: await retrievalActivity(),
    basis:
      `sources are those a person enabled for the "${namespace}" namespace, and the catalogue is what is offered and not enabled; document, chunk and admission counts are read from that namespace of the index; retrieval activity is counted from run journals; the integrity digest is recomputed on this read and compared with the latest admission's`,
  });
}

/** Enable or disable a source for retrieval, in one namespace. Curation, not deletion. */
export async function POST(req: Request) {
  { const gate = await permit(req, "configure"); if (gate) return gate; }
  let body: { id?: string; namespace?: string; enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }
  if (!body.id || typeof body.enabled !== "boolean") {
    return Response.json({ error: "send { id, enabled }" }, { status: 400 });
  }
  const namespace = parseNamespace(body.namespace ?? new URL(req.url).searchParams.get("namespace"));
  if (!namespace) return Response.json({ error: NAMESPACE_RULE }, { status: 400 });
  if (!(await knowledgeReady())) return Response.json({ error: "the knowledge index is unreachable" }, { status: 503 });
  await kq("UPDATE sources SET enabled = $2 WHERE id = $1 AND namespace = $3", [body.id, body.enabled, namespace]);
  return Response.json({ id: body.id, namespace, enabled: body.enabled });
}
