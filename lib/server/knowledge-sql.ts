/**
 * The SQL the search route runs, built as pure functions.
 *
 * Retrieval is the one place a namespace leak would be invisible: a chunk
 * from another engagement's corpus would come back ranked and cited like any
 * other, and nobody reading the answer could tell. So every statement here
 * carries `namespace = $n` on the chunks table itself (the row says which
 * corpus it belongs to; the predicate never depends on a join to say so),
 * and the joins to sources and documents match on namespace as well, because
 * a source is curated per namespace and shares its id across them.
 *
 * The builders return the statement with its parameters, so the placeholder
 * positions cannot drift from the values. tests/knowledge-namespace.test.ts
 * reads the strings and holds every one of them to the predicate.
 */

export interface Query {
  sql: string;
  params: unknown[];
}

const SELECT = `c.id::text AS id, c.body, c.ordinal, c.heading, c.document_id, c.source_id, c.meta,
                s.name AS source, s.publisher, d.url, d.title`;

/* A source is keyed (namespace, id), so the join must say which namespace's
   row it wants, or a source enabled in one corpus would stand in for every
   other. Documents are keyed by id alone, but the match is made all the same:
   a document and its chunks are one corpus. */
const JOINS = `FROM chunks c
       JOIN sources s ON s.namespace = c.namespace AND s.id = c.source_id
       JOIN documents d ON d.namespace = c.namespace AND d.id = c.document_id`;

/** Disabled sources, unadmitted documents and other corpora are excluded in the query, never filtered after. */
const GUARD = `c.namespace = $1 AND c.embedding IS NOT NULL AND s.enabled AND d.status = 'admitted'`;

/** Nearest chunks by cosine distance to the query vector. */
export function denseQuery(namespace: string, vector: number[], limit: number, sources: string[] | null): Query {
  return {
    sql: `SELECT ${SELECT}, 1 - (c.embedding <=> $2::vector) AS similarity, NULL::float AS lexical
       ${JOINS}
      WHERE ${GUARD} ${sources ? "AND c.source_id = ANY($4)" : ""}
      ORDER BY c.embedding <=> $2::vector LIMIT $3`,
    params: sources ? [namespace, `[${vector.join(",")}]`, limit, sources] : [namespace, `[${vector.join(",")}]`, limit],
  };
}

/** Chunks matching the OR of the query's terms, ranked by cover density. */
export function lexicalQuery(namespace: string, tsquery: string, limit: number, sources: string[] | null): Query {
  return {
    sql: `SELECT ${SELECT}, NULL::float AS similarity, ts_rank_cd(c.lexeme, to_tsquery('english', $2)) AS lexical
       ${JOINS}
      WHERE ${GUARD} AND c.lexeme @@ to_tsquery('english', $2)
        ${sources ? "AND c.source_id = ANY($4)" : ""}
      ORDER BY lexical DESC LIMIT $3`,
    params: sources ? [namespace, tsquery, limit, sources] : [namespace, tsquery, limit],
  };
}

/** The chunks either side of a hit, by (document, ordinal) pairs, as context. */
export function adjacentQuery(namespace: string, pairs: { document_id: string; ordinal: number }[]): Query {
  const tuples = pairs.map((_, i) => `($${i * 2 + 2}, $${i * 2 + 3})`).join(",");
  return {
    sql: `SELECT document_id, ordinal, heading, body FROM chunks
          WHERE namespace = $1 AND (document_id, ordinal) IN (${tuples})`,
    params: [namespace, ...pairs.flatMap((p) => [p.document_id, p.ordinal])],
  };
}

/**
 * Every admitted document in one namespace, with what says whether it is
 * still current (lib/knowledge-stale.ts): where it was fetched from and
 * when, the source's cadence and address in the catalogue, and the newest
 * later fetch of the same source in the same corpus whose text differs.
 * The source and the later fetch are matched on namespace too: another
 * engagement's copy of the source is its own.
 */
export function staleQuery(namespace: string): Query {
  return {
    sql: `SELECT d.id, d.namespace, d.source_id, d.title, d.url, d.fetched_at, d.decided_at,
                 coalesce(s.name, d.source_id) AS source, coalesce(s.url, '') AS source_url, coalesce(s.cadence, '') AS cadence,
                 n.id AS newer_id, n.status AS newer_status, n.fetched_at AS newer_fetched_at
            FROM documents d
            LEFT JOIN sources s ON s.namespace = d.namespace AND s.id = d.source_id
            LEFT JOIN LATERAL (
              SELECT x.id, x.status, x.fetched_at FROM documents x
               WHERE x.namespace = d.namespace AND x.source_id = d.source_id AND x.id <> d.id
                 AND x.fetched_at > d.fetched_at AND x.digest <> d.digest
               ORDER BY x.fetched_at DESC LIMIT 1
            ) n ON true
           WHERE d.namespace = $1 AND d.status = 'admitted'
           ORDER BY d.source_id, d.fetched_at DESC`,
    params: [namespace],
  };
}
