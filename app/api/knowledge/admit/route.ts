import { ensureAnnIndex, knowledgeReady, kq } from "@/lib/server/knowledge-db";
import { permit, session as whoIs, signer, ssoEnabled } from "@/lib/server/auth";
import { embed, embeddingModel } from "@/lib/server/embed";

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
  let body: { document?: string; admit?: boolean; by?: string; note?: string };
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
    "SELECT id, source_id, title, status, chunks FROM documents WHERE id = $1",
    [documentId],
  );
  if (!doc) return Response.json({ error: `no staged document "${documentId}"` }, { status: 404 });
  if (doc.status !== "staged") {
    return Response.json({ error: `that document is already ${doc.status}` }, { status: 409 });
  }

  /* ── refused ── */
  if (!body.admit) {
    await kq("DELETE FROM chunks WHERE document_id = $1", [documentId]);
    await kq(
      "UPDATE documents SET status = 'rejected', decided_at = now(), decided_by = $2, note = $3 WHERE id = $1",
      [documentId, by, note],
    );
    await kq(
      "INSERT INTO admissions (document_id, source_id, admitted, by_whom, note, chunks) VALUES ($1,$2,false,$3,$4,0)",
      [documentId, doc.source_id, by, note],
    );
    return Response.json({
      document: documentId,
      admitted: false,
      by,
      note: "Refused. The staged chunks were discarded; the decision is on the record.",
    });
  }

  /* ── admitted: embed, then make retrievable ── */
  const pieces = await kq<{ id: string; body: string }>(
    "SELECT id, body FROM chunks WHERE document_id = $1 ORDER BY ordinal",
    [documentId],
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
    await kq("UPDATE chunks SET embedding = $2, indexed_at = now() WHERE id = $1", [
      p.id,
      `[${vectors[i].join(",")}]`,
    ]);
  }

  // Older versions of the same source stop being the answer once a newer one
  // is admitted, rather than competing with it in the index.
  await kq(
    `UPDATE documents SET status = 'superseded'
      WHERE source_id = $1 AND status = 'admitted' AND id <> $2`,
    [doc.source_id, documentId],
  );
  await kq("DELETE FROM chunks WHERE document_id IN (SELECT id FROM documents WHERE status = 'superseded')");
  await kq(
    "UPDATE documents SET status = 'admitted', decided_at = now(), decided_by = $2, note = $3 WHERE id = $1",
    [documentId, by, note],
  );
  await kq(
    "INSERT INTO admissions (document_id, source_id, admitted, by_whom, note, chunks) VALUES ($1,$2,true,$3,$4,$5)",
    [documentId, doc.source_id, by, note, pieces.length],
  );
  await ensureAnnIndex();

  return Response.json({
    document: documentId,
    admitted: true,
    by,
    chunks: pieces.length,
    model: embeddingModel(),
    note: `Admitted and indexed. ${pieces.length} chunks are now retrievable; any earlier version of this source was superseded.`,
  });
}
