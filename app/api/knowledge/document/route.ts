import { knowledgeReady, kq } from "@/lib/server/knowledge-db";

/**
 * One fetched document, in full: what was fetched, how it was split, and the
 * identifiers found in it. This is what a person reviews before admitting it,
 * and what the register shows for anything already admitted.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) return Response.json({ error: "which document?" }, { status: 400 });
  if (!(await knowledgeReady())) return Response.json({ error: "the knowledge index is unreachable" }, { status: 503 });

  const [doc] = await kq<Record<string, unknown>>(
    `SELECT d.id, d.source_id, d.title, d.url, d.status, d.bytes, d.chunks, d.digest, d.fetched_at, d.decided_at, d.decided_by, d.note, d.text, d.parts, d.pages, d.cleaning,
            s.name AS source_name, s.publisher, s.family, s.licence, s.cadence, s.use_for
       FROM documents d LEFT JOIN sources s ON s.id = d.source_id WHERE d.id = $1`,
    [id],
  );
  if (!doc) return Response.json({ error: "no such document" }, { status: 404 });

  const sections = await kq<{ ordinal: number; heading: string; bytes: number; chunks: string }>(
    `SELECT s.ordinal, s.heading, s.bytes, (SELECT count(*) FROM chunks c WHERE c.section_id = s.id) AS chunks
       FROM sections s WHERE s.document_id = $1 ORDER BY s.ordinal`,
    [id],
  );

  // The references every chunk's metadata carries, counted across the document.
  const metas = await kq<{ meta: Record<string, unknown> }>("SELECT meta FROM chunks WHERE document_id = $1", [id]);
  const refs: Record<string, Map<string, number>> = {};
  const kinds: Record<string, number> = {};
  for (const { meta } of metas) {
    const r = (meta?.refs ?? {}) as Record<string, string[]>;
    for (const [k, vals] of Object.entries(r)) {
      if (k === "urls") continue;
      refs[k] = refs[k] ?? new Map();
      for (const v of vals ?? []) refs[k].set(v, (refs[k].get(v) ?? 0) + 1);
    }
    const kind = String(meta?.kind ?? "");
    if (kind) kinds[kind] = (kinds[kind] ?? 0) + 1;
  }
  const references = Object.fromEntries(
    Object.entries(refs).map(([k, m]) => [k, { distinct: m.size, top: [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([v]) => v) }]),
  );

  const sample = await kq<{ ordinal: number; heading: string; body: string; tokens: number; meta: Record<string, unknown> }>(
    "SELECT ordinal, heading, left(body, 280) AS body, tokens, meta FROM chunks WHERE document_id = $1 ORDER BY ordinal LIMIT 24",
    [id],
  );
  const text = String(doc.text ?? "");
  return Response.json({
    sample,
    ...doc,
    text: text || String((doc as { excerpt?: string }).excerpt ?? ""),
    fullTextHeld: Boolean(text),
    sections,
    references,
    kinds,
  });
}
