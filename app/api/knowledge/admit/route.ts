import { ensureAnnIndex, knowledgeReady, kq, stampAdmission } from "@/lib/server/knowledge-db";
import { permit, session as whoIs, signer, ssoEnabled } from "@/lib/server/auth";
import { embed, embeddingDimension, embeddingModel } from "@/lib/server/embed";
import { NAMESPACE_RULE, parseNamespace } from "@/lib/knowledge";

/**
 * The gate on the knowledge base.
 *
 * Fetching stages content. This admits it, and admission is what makes it
 * retrievable: the chunks are embedded and become searchable at the moment a
 * person says so, not before. Refusing is equally recorded, because a source
 * that was considered and declined is a decision somebody may need to defend.
 *
 * `by` is mandatory. An anonymous change to what the estate believes is worse
 * than no change at all — it is the one edit nobody can trace when an agent
 * later cites something it should not have.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  { const gate = await permit(req, "configure"); if (gate) return gate; }
  let body: { document?: string; namespace?: string; admit?: boolean; by?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'expected {"document": "<id>", "admit": true, "by": "you@ey.com"}' }, { status: 400 });
  }

  const documentId = String(body.document ?? "");
  const me = await whoIs(req);
  const by = ssoEnabled() && me && me.mode === "sso" ? signer(me) : String(body.by ?? "").trim();
  const note = String(body.note ?? "").slice(0, 2000);
  if (!documentId) return Response.json({ error: "which document?" }, { status: 400 });
  const namespace = parseNamespace(body.namespace ?? new URL(req.url).searchParams.get("namespace"));
  if (!namespace) return Response.json({ error: NAMESPACE_RULE }, { status: 400 });
  if (typeof body.admit !== "boolean") {
    return Response.json({ error: "send admit: true or admit: false" }, { status: 400 });
  }
  if (!by) {
    return Response.json(
      { error: "send by: who is admitting this. An anonymous change to what the estate believes is not traceable." },
      { status: 400 },
    );
  }
  if (!(await knowledgeReady())) {
    return Response.json({ error: "the knowledge index is unreachable" }, { status: 503 });
  }

  const [doc] = await kq<{ id: string; source_id: string; title: string; status: string; chunks: number }>(
    "SELECT id, source_id, title, status, chunks FROM documents WHERE id = $1 AND namespace = $2",
    [documentId, namespace],
  );
  if (!doc) return Response.json({ error: `no staged document "${documentId}" in namespace "${namespace}"` }, { status: 404 });
  if (doc.status !== "staged") {
    return Response.json({ error: `that document is already ${doc.status}` }, { status: 409 });
  }

  /* ── refused ── */
  if (!body.admit) {
    await kq("DELETE FROM chunks WHERE document_id = $1 AND namespace = $2", [documentId, namespace]);
    await kq(
      "UPDATE documents SET status = 'rejected', decided_at = now(), decided_by = $2, note = $3 WHERE id = $1 AND namespace = $4",
      [documentId, by, note, namespace],
    );
    const [refusal] = await kq<{ id: string }>(
      "INSERT INTO admissions (namespace, document_id, source_id, admitted, by_whom, note, chunks) VALUES ($5,$1,$2,false,$3,$4,0) RETURNING id",
      [documentId, doc.source_id, by, note, namespace],
    );
    // A refusal changes nothing retrievable, but it is an admission row, so
    // the digest the next read checks against is the one after it.
    await stampAdmission(namespace, refusal.id, "", 0);
    return Response.json({
      document: documentId,
      namespace,
      admitted: false,
      by,
      note: "Refused. The staged chunks were discarded; the decision is on the record.",
    });
  }

  /* ── admitted: embed, then make retrievable ── */
  const pieces = await kq<{ id: string; body: string }>(
    "SELECT id, body FROM chunks WHERE document_id = $1 AND namespace = $2 ORDER BY ordinal",
    [documentId, namespace],
  );
  if (!pieces.length) return Response.json({ error: "nothing staged against that document" }, { status: 409 });

  let vectors: number[][];
  try {
    vectors = await embed(pieces.map((p) => p.body));
  } catch (e) {
    return Response.json(
      { error: `admission stopped before indexing — the embedding call failed: ${(e as Error).message}` },
      { status: 502 },
    );
  }
  if (vectors.length !== pieces.length) {
    return Response.json({ error: "the embedding endpoint returned a different number of vectors than chunks" }, { status: 502 });
  }

  for (const [i, p] of pieces.entries()) {
    await kq("UPDATE chunks SET embedding = $2, indexed_at = now() WHERE id = $1 AND namespace = $3", [
      p.id,
      `[${vectors[i].join(",")}]`,
      namespace,
    ]);
  }

  // Older versions of the same source stop being the answer once a newer one
  // is admitted, rather than competing with it in the index. Within this
  // corpus only: another engagement's copy of the source is its own.
  await kq(
    `UPDATE documents SET status = 'superseded'
      WHERE namespace = $3 AND source_id = $1 AND status = 'admitted' AND id <> $2`,
    [doc.source_id, documentId, namespace],
  );
  await kq(
    `DELETE FROM chunks WHERE namespace = $1
        AND document_id IN (SELECT id FROM documents WHERE namespace = $1 AND status = 'superseded')`,
    [namespace],
  );
  await kq(
    "UPDATE documents SET status = 'admitted', decided_at = now(), decided_by = $2, note = $3 WHERE id = $1 AND namespace = $4",
    [documentId, by, note, namespace],
  );
  const [admission] = await kq<{ id: string }>(
    "INSERT INTO admissions (namespace, document_id, source_id, admitted, by_whom, note, chunks) VALUES ($6,$1,$2,true,$3,$4,$5) RETURNING id",
    [documentId, doc.source_id, by, note, pieces.length, namespace],
  );
  // The admission records what embedded the index and the digest of the
  // namespace as it now stands; the status read checks against it.
  const dimensions = vectors[0]?.length ?? embeddingDimension() ?? 0;
  const digest = await stampAdmission(namespace, admission.id, embeddingModel(), dimensions);
  await ensureAnnIndex();

  return Response.json({
    document: documentId,
    namespace,
    admitted: true,
    by,
    chunks: pieces.length,
    model: embeddingModel(),
    dimensions,
    digest,
    note: `Admitted and indexed. ${pieces.length} chunks are now retrievable; any earlier version of this source was superseded.`,
  });
}
