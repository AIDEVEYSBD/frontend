import { knowledgeReady, kq } from "@/lib/server/knowledge-db";
import { embed, embeddingModel } from "@/lib/server/embed";
import { rerank } from "@/lib/server/rerank";

/**
 * Agentic retrieval: hybrid search, adjacency, reranking, guardrails.
 *
 * Four stages, in the order they matter.
 *
 *   1. Hybrid. Dense similarity finds passages that mean the same thing;
 *      lexical ranking finds the ones that say the same words. A control
 *      identifier like AC-2 or a CVE number has no useful embedding
 *      neighbourhood, and a question phrased differently from the text has no
 *      lexical overlap — running one without the other loses a whole class of
 *      answer. Scores are fused by reciprocal rank, which needs no calibration
 *      between two scales that are not comparable.
 *   2. Adjacency. A clause is rarely self-contained, so the chunks either side
 *      of a hit come with it, marked as context rather than as hits.
 *   3. Reranking. The fused order is cheap and approximate; a cross-encoder
 *      reads the question and each candidate together and scores them
 *      directly (lib/server/rerank.ts).
 *   4. Guardrails. Disabled sources, unadmitted documents and anything outside
 *      the caller's scope are excluded in the query rather than filtered after,
 *      so a curator's decision takes effect on the next question.
 */

/** Words that carry no retrieval signal and would match every chunk. */
const STOP = new Set(
  ("the a an and or of for to in on at by with from as is are was were be been being this that these those " +
   "what which who whom whose when where why how do does did can could should would may might must shall will " +
   "not no nor but if then than so such into over under about between during before after above below " +
   "any all some each other more most less least very also only just").split(" "),
);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Row {
  id: string;
  body: string;
  ordinal: number;
  heading: string;
  document_id: string;
  source_id: string;
  source: string;
  publisher: string;
  url: string;
  title: string;
  meta: Record<string, unknown>;
  similarity: number | null;
  lexical: number | null;
}

/** Reciprocal rank fusion. k dampens the top of each list so one confident
 *  ranker cannot drown the other. */
function fuse(dense: Row[], lexical: Row[], k = 60): Map<string, { row: Row; score: number; dense: number | null; lex: number | null }> {
  const out = new Map<string, { row: Row; score: number; dense: number | null; lex: number | null }>();
  dense.forEach((r, i) => {
    out.set(r.id, { row: r, score: 1 / (k + i + 1), dense: i + 1, lex: null });
  });
  lexical.forEach((r, i) => {
    const seen = out.get(r.id);
    if (seen) {
      seen.score += 1 / (k + i + 1);
      seen.lex = i + 1;
    } else {
      out.set(r.id, { row: r, score: 1 / (k + i + 1), dense: null, lex: i + 1 });
    }
  });
  return out;
}

export interface SearchOptions {
  query?: string;
  limit?: number;
  sources?: string[];
  floor?: number;
  adjacent?: boolean;
  rerank?: boolean;
}

export interface Hit {
  id: string;
  documentId: string;
  source: string;
  sourceId: string;
  publisher: string;
  title: string;
  heading: string;
  url: string;
  ordinal: number;
  similarity: number | null;
  lexicalRank: number | null;
  denseRank: number | null;
  score: number;
  /** The cross-encoder's own view of the passage, 0 to 1, when it ran. */
  relevance: number | null;
  meta: Record<string, unknown>;
  body: string;
}

export interface SearchResult {
  query: string;
  model: string;
  rerankModel: string | null;
  rerankKind: "cross-encoder" | "llm" | null;
  returned: number;
  stages: { dense: number; lexical: number; fused: number; reranked: number; adjacent: number };
  timings: { embed_ms: number; search_ms: number; rerank_ms: number; total_ms: number };
  floor: number;
  hits: Hit[];
  context: { document_id: string; ordinal: number; heading: string; body: string }[];
  note?: string;
}

export async function POST(req: Request) {
  let body: SearchOptions;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'expected {"query": "..."}' }, { status: 400 });
  }
  const query = String(body.query ?? "").trim();
  if (!query) return Response.json({ error: "send a query" }, { status: 400 });
  if (!(await knowledgeReady())) {
    return Response.json({ error: "the knowledge index is unreachable" }, { status: 503 });
  }
  try {
    return Response.json(await search({ ...body, query }));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

/** The retrieval pipeline as a function, so the answer route runs it in a loop. */
export async function search(body: SearchOptions & { query: string }): Promise<SearchResult> {
  const query = body.query;

  const limit = Math.max(1, Math.min(25, Number(body.limit ?? 8)));
  const floor = Number.isFinite(Number(body.floor)) ? Number(body.floor) : 0.15;
  const wantAdjacent = body.adjacent !== false;
  const wantRerank = body.rerank !== false;
  const scoped = Array.isArray(body.sources) && body.sources.length ? body.sources.map(String) : null;
  const pool = Math.max(limit * 3, 20);

  const started = Date.now();
  let vector: number[];
  try {
    [vector] = await embed([query]);
  } catch (e) {
    throw new Error(`the query could not be embedded: ${(e as Error).message}`);
  }
  const embeddedAt = Date.now();

  const SELECT = `c.id::text AS id, c.body, c.ordinal, c.heading, c.document_id, c.source_id, c.meta,
                  s.name AS source, s.publisher, d.url, d.title`;
  const GUARD = `c.embedding IS NOT NULL AND s.enabled AND d.status = 'admitted'`;

  const dense = await kq<Row>(
    `SELECT ${SELECT}, 1 - (c.embedding <=> $1::vector) AS similarity, NULL::float AS lexical
       FROM chunks c JOIN sources s ON s.id = c.source_id JOIN documents d ON d.id = c.document_id
      WHERE ${GUARD} ${scoped ? "AND c.source_id = ANY($3)" : ""}
      ORDER BY c.embedding <=> $1::vector LIMIT $2`,
    scoped ? [`[${vector.join(",")}]`, pool, scoped] : [`[${vector.join(",")}]`, pool],
  );

  /* The lexical query is OR over the query's terms, not AND.
     `websearch_to_tsquery` reads spaces as AND, so a natural question demands
     that every word appear in one chunk and almost always matches nothing —
     which is how a hybrid search quietly degrades to dense-only. OR with
     `ts_rank_cd` is the behaviour wanted here: a chunk carrying more of the
     terms, closer together, ranks higher. */
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9._-]+/i)
    .filter((t) => t.length > 2 && !STOP.has(t))
    .slice(0, 12);
  const lexical = terms.length
    ? await kq<Row>(
        `SELECT ${SELECT}, NULL::float AS similarity, ts_rank_cd(c.lexeme, to_tsquery('english', $1)) AS lexical
           FROM chunks c JOIN sources s ON s.id = c.source_id JOIN documents d ON d.id = c.document_id
          WHERE ${GUARD} AND c.lexeme @@ to_tsquery('english', $1)
            ${scoped ? "AND c.source_id = ANY($3)" : ""}
          ORDER BY lexical DESC LIMIT $2`,
        scoped ? [terms.join(" | "), pool, scoped] : [terms.join(" | "), pool],
      ).catch(() => [] as Row[])
    : [];

  const fused = [...fuse(dense, lexical).values()].sort((a, b) => b.score - a.score);
  const searchedAt = Date.now();

  /* ── rerank ── */
  let ranked: { row: Row; score: number; dense: number | null; lex: number | null; relevance: number | null }[] = fused
    .slice(0, Math.max(limit * 2, 12))
    .map((r) => ({ ...r, relevance: null }));
  let rerankModel: string | null = null;
  let rerankKind: "cross-encoder" | "llm" | null = null;
  if (wantRerank && ranked.length > 1) {
    const scored = await rerank(query, ranked.map((r) => r.row.body));
    if (scored) {
      rerankModel = scored.model;
      rerankKind = scored.kind;
      ranked = ranked
        .map((r, i) => ({ ...r, score: scored.scores[i] ?? 0, relevance: scored.scores[i] ?? 0 }))
        .sort((a, b) => b.score - a.score);
    }
  }
  const rerankedAt = Date.now();

  const top = ranked
    .filter((r) => (r.row.similarity === null ? true : Number(r.row.similarity) >= floor))
    .slice(0, limit);

  /* ── adjacency: the chunks either side, as context ── */
  let context: { document_id: string; ordinal: number; heading: string; body: string }[] = [];
  if (wantAdjacent && top.length) {
    const wanted = top.flatMap((r) => [
      { d: r.row.document_id, o: r.row.ordinal - 1 },
      { d: r.row.document_id, o: r.row.ordinal + 1 },
    ]);
    const have = new Set(top.map((r) => `${r.row.document_id}:${r.row.ordinal}`));
    const pairs = wanted.filter((w) => w.o >= 0 && !have.has(`${w.d}:${w.o}`));
    if (pairs.length) {
      context = await kq<{ document_id: string; ordinal: number; heading: string; body: string }>(
        `SELECT document_id, ordinal, heading, body FROM chunks
          WHERE (document_id, ordinal) IN (${pairs.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(",")})`,
        pairs.flatMap((p) => [p.d, p.o]),
      ).catch(() => []);
    }
  }

  return {
    query,
    model: embeddingModel(),
    rerankModel,
    rerankKind,
    returned: top.length,
    stages: {
      dense: dense.length,
      lexical: lexical.length,
      fused: fused.length,
      reranked: rerankModel ? ranked.length : 0,
      adjacent: context.length,
    },
    timings: {
      embed_ms: embeddedAt - started,
      search_ms: searchedAt - embeddedAt,
      rerank_ms: rerankedAt - searchedAt,
      total_ms: Date.now() - started,
    },
    floor,
    hits: top.map((r) => ({
      id: r.row.id,
      documentId: r.row.document_id,
      source: r.row.source,
      sourceId: r.row.source_id,
      publisher: r.row.publisher,
      title: r.row.title,
      heading: r.row.heading,
      url: r.row.url,
      ordinal: r.row.ordinal,
      similarity: r.row.similarity === null ? null : Number(Number(r.row.similarity).toFixed(4)),
      lexicalRank: r.lex,
      denseRank: r.dense,
      score: Number(r.score.toFixed(4)),
      relevance: r.relevance === null ? null : Number(r.relevance.toFixed(4)),
      meta: r.row.meta,
      body: r.row.body,
    })),
    context,
    note:
      top.length === 0 && dense.length > 0
        ? `Nothing cleared the similarity floor of ${floor}. The corpus has neighbours for this query but none close enough to cite.`
        : undefined,
  };
}
