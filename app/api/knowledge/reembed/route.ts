import { ensureAnnIndex, knowledgeReady, kq, listNamespaces, stampAdmission } from "@/lib/server/knowledge-db";
import { permit, session as whoIs, signer, signInOn } from "@/lib/server/auth";
import { COLUMN_DIMENSIONS, config, embed, embeddingDimension } from "@/lib/server/embed";
import { NAMESPACE_RULE, parseNamespace } from "@/lib/knowledge";

/**
 * Re-embed a namespace with the current provider.
 *
 * The embedding model is part of the index: a chunk embedded by one model
 * and a query embedded by another are not comparable, and the search would
 * not say so. So when the provider or model changes, every admitted chunk
 * in the namespace is embedded again, and the admission record says which
 * model and dimension the index now holds.
 *
 * The pgvector column is fixed at COLUMN_DIMENSIONS. A provider that
 * answers another width is refused, with the change that would be needed,
 * unless `force` is sent: then the column is altered to the new width,
 * which empties every namespace's vectors (the column is shared), this
 * namespace is re-embedded, and the others are named as needing the same.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  { const gate = await permit(req, "configure"); if (gate) return gate; }
  let body: { namespace?: string; force?: boolean; by?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'expected {"namespace": "<name>", "force": false}' }, { status: 400 });
  }
  const namespace = parseNamespace(body.namespace ?? new URL(req.url).searchParams.get("namespace"));
  if (!namespace) return Response.json({ error: NAMESPACE_RULE }, { status: 400 });
  const force = body.force === true;
  const me = await whoIs(req);
  const by = (signInOn() && me && me.mode === "sso" ? signer(me) : String(body.by ?? "").trim()) || (me ? signer(me) : "") || "console";
  if (!(await knowledgeReady())) return Response.json({ error: "the knowledge index is unreachable" }, { status: 503 });

  const provider = await config();
  if (!provider.endpoint || !provider.key) {
    return Response.json({ error: "no embedding provider is configured: set EMBEDDING_ENDPOINT and EMBEDDING_API_KEY (or the gateway's FOUNDRY_ENDPOINT and FOUNDRY_API_KEY)" }, { status: 503 });
  }

  // Every chunk of every admitted document in the namespace, in a stable order.
  const pieces = await kq<{ id: string; body: string; document_id: string }>(
    `SELECT c.id::text AS id, c.body, c.document_id FROM chunks c
       JOIN documents d ON d.namespace = c.namespace AND d.id = c.document_id
      WHERE c.namespace = $1 AND d.status = 'admitted' ORDER BY c.document_id, c.ordinal`,
    [namespace],
  );
  if (!pieces.length) return Response.json({ error: `nothing is admitted in namespace "${namespace}", so there is nothing to re-embed` }, { status: 409 });

  // The provider's dimension is learnt from its first answer: embed the
  // first chunk alone before committing the rest of the batch.
  let probe: number[][];
  try {
    probe = await embed([pieces[0].body]);
  } catch (e) {
    return Response.json({ error: `the embedding call failed before anything changed: ${(e as Error).message}` }, { status: 502 });
  }
  const dimension = probe[0]?.length ?? 0;
  if (!dimension) return Response.json({ error: "the embedding endpoint returned an empty vector" }, { status: 502 });

  // The column's width is one fact for every namespace: the vector type is shared.
  const [{ width }] = await kq<{ width: string | null }>(
    `SELECT regexp_replace(format_type(a.atttypid, a.atttypmod), '[^0-9]', '', 'g') AS width
       FROM pg_attribute a WHERE a.attrelid = 'chunks'::regclass AND a.attname = 'embedding' -- shared by every namespace`,
  );
  const columnWidth = Number(width) || COLUMN_DIMENSIONS;
  const others = (await listNamespaces()).filter((n) => n !== namespace);

  if (dimension !== columnWidth && !force) {
    return Response.json(
      {
        error: `the provider's model "${provider.model}" answers ${dimension} dimensions and the index column holds ${columnWidth}; nothing was changed`,
        dimension,
        columnDimensions: columnWidth,
        model: provider.model,
        mustChange: [
          `the pgvector column: ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(${dimension}) (lib/server/knowledge-db.ts declares vector(${COLUMN_DIMENSIONS}))`,
          "the ANN index chunks_embedding, which is built over the column and has to be dropped and rebuilt",
          others.length ? `every other namespace (${others.join(", ")}): the column is shared, so their vectors are emptied and each needs this re-embed too` : "no other namespace exists, so only this one needs re-embedding",
          "lib/server/embed.ts COLUMN_DIMENSIONS, so the status page reports the new width",
        ],
        hint: "send force: true to alter the column and re-embed this namespace now; the other namespaces must be re-embedded afterwards or their searches return nothing",
      },
      { status: 409 },
    );
  }

  let altered = false;
  if (dimension !== columnWidth) {
    // The column is shared by every namespace; its width is one fact.
    await kq("DROP INDEX IF EXISTS chunks_embedding -- the ANN index spans every namespace");
    await kq(`ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(${dimension}) USING NULL -- empties every namespace's vectors`);
    altered = true;
  }

  // Embed in order, write as each batch returns: a failure midway leaves
  // the earlier chunks on the new model and the later on the old, which
  // the admission row below records so a retry is one click.
  const vectors: number[][] = [...probe];
  try {
    const rest = await embed(pieces.slice(1).map((p) => p.body));
    vectors.push(...rest);
  } catch (e) {
    return Response.json({ error: `re-embedding stopped after the probe: ${(e as Error).message}` }, { status: 502 });
  }
  if (vectors.length !== pieces.length) return Response.json({ error: "the embedding endpoint returned a different number of vectors than chunks" }, { status: 502 });

  for (const [i, p] of pieces.entries()) {
    await kq("UPDATE chunks SET embedding = $3, indexed_at = now() WHERE namespace = $1 AND id = $2::bigint", [namespace, p.id, `[${vectors[i].join(",")}]`]);
  }

  // The act is on the record as an admission of the whole namespace: who,
  // when, which model, which width, and the digest the index now has.
  const documents = [...new Set(pieces.map((p) => p.document_id))];
  const [row] = await kq<{ id: string }>(
    `INSERT INTO admissions (namespace, document_id, source_id, admitted, by_whom, note, chunks)
     VALUES ($1, $2, $3, true, $4, $5, $6) RETURNING id`,
    [namespace, documents.length === 1 ? documents[0] : "*", "*", by, `re-embedded ${documents.length} documents with ${provider.model} (${dimension}d)${altered ? `; the column was widened to ${dimension}` : ""}`, pieces.length],
  );
  const digest = await stampAdmission(namespace, row.id, provider.model, dimension);
  await ensureAnnIndex();

  return Response.json({
    namespace,
    by,
    model: provider.model,
    dimension,
    seen: embeddingDimension(provider.model),
    chunks: pieces.length,
    documents: documents.length,
    altered,
    digest,
    needsReembed: altered ? others : [],
    note: altered
      ? `Re-embedded ${pieces.length} chunks; the column now holds ${dimension}-dimension vectors${others.length ? `, and ${others.join(", ")} must be re-embedded before their searches answer again` : ""}.`
      : `Re-embedded ${pieces.length} chunks across ${documents.length} documents with ${provider.model}.`,
  });
}
