import { createHash, randomUUID } from "node:crypto";
import { LICENCE_NOTE, type Licence } from "@/lib/knowledge";
import { knowledgeReady, kq } from "@/lib/server/knowledge-db";
import { chunk, metadata, sections } from "@/lib/server/embed";
import { fetchSource, type Cleaning } from "@/lib/server/ingest";

/**
 * Fetch a curated source and stage it.
 *
 * The publisher's page, feed or catalogue is fetched as served, together with
 * the pages an index links to under its own path, normalised into one
 * markdown document (lib/server/ingest), stripped of site chrome, repeats
 * and fragments, split into sections and chunks, indexed lexically and
 * enriched with the identifiers a security reader searches for. The whole
 * document is kept, with the list of pages fetched and what the cleaning
 * removed, so the review shows what was fetched and what was left out.
 * Nothing is retrievable until a person admits it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { source?: string; url?: string; title?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'expected {"source": "<id>"}' }, { status: 400 });
  }
  const sourceId = String(body.source ?? "");
  if (!sourceId) return Response.json({ error: "which source?" }, { status: 400 });
  if (!(await knowledgeReady())) {
    return Response.json({ error: "the knowledge index is unreachable" }, { status: 503 });
  }

  const [source] = await kq<{ id: string; name: string; url: string; licence: string }>(
    "SELECT id, name, url, licence FROM sources WHERE id = $1",
    [sourceId],
  );
  if (!source) return Response.json({ error: `no source "${sourceId}"` }, { status: 404 });

  if (source.licence === "licensed") {
    return Response.json(
      {
        error: `${source.name} is licensed. ${LICENCE_NOTE[source.licence as Licence]} An agent may cite it by reference; the text is not held here.`,
      },
      { status: 409 },
    );
  }

  const url = String(body.url ?? source.url);
  let text = String(body.text ?? "");
  let title = String(body.title ?? source.name);
  let parts = 1;
  let pages: string[] = [url];
  let cleaning: Cleaning | null = null;
  let expanded = false;

  if (!text) {
    try {
      const fetched = await fetchSource(url, source.name);
      text = fetched.text;
      parts = fetched.parts;
      pages = fetched.pages;
      cleaning = fetched.cleaning;
      expanded = fetched.expanded;
      if (!body.title && fetched.title) title = fetched.title;
    } catch (e) {
      return Response.json({ error: `could not fetch ${url.split(/\s+/)[0]}: ${(e as Error).message}` }, { status: 502 });
    }
  }

  if (text.length < 200) {
    return Response.json({ error: "the fetch returned too little text to be worth staging" }, { status: 422 });
  }

  const digest = createHash("sha256").update(text).digest("hex");
  const [existing] = await kq<{ id: string; status: string }>(
    "SELECT id, status FROM documents WHERE source_id = $1 AND digest = $2 LIMIT 1",
    [sourceId, digest],
  );
  if (existing) {
    return Response.json({
      unchanged: true,
      document: existing.id,
      status: existing.status,
      note: "This fetch is byte-identical to one already on record, so nothing was staged.",
    });
  }

  /* Document → sections → chunks, which is the order that keeps a citation
     honest: a chunk knows the heading it sits under, so a hit can name the
     clause rather than a byte offset. */
  const split = sections(text);
  const id = `doc-${randomUUID().slice(0, 8)}`;

  await kq(
    `INSERT INTO documents (id, source_id, title, url, status, bytes, chunks, digest, excerpt, text, parts, pages, cleaning)
     VALUES ($1,$2,$3,$4,'staged',$5,0,$6,$7,$8,$9,$10,$11)`,
    [id, sourceId, title.slice(0, 300), url, text.length, digest, text.slice(0, 1200), text, parts, JSON.stringify(pages), cleaning ? JSON.stringify(cleaning) : null],
  );

  // Chunks are written in batches: a standard of six hundred clauses should
  // stage in seconds, not in a minute of round trips.
  const rows: unknown[][] = [];
  let ordinal = 0;
  for (const [si, part] of split.entries()) {
    const [section] = await kq<{ id: string }>(
      "INSERT INTO sections (document_id, ordinal, heading, bytes) VALUES ($1,$2,$3,$4) RETURNING id",
      [id, si, part.heading.slice(0, 300), part.body.length],
    );
    for (const piece of chunk(part.body)) {
      rows.push([id, section.id, sourceId, ordinal++, part.heading.slice(0, 300), piece, Math.ceil(piece.length / 4), JSON.stringify(metadata(piece, part.heading))]);
    }
  }
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const values = batch
      .map((_, k) => {
        const b = k * 8;
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},NULL,to_tsvector('english', $${b + 6}))`;
      })
      .join(",");
    await kq(
      `INSERT INTO chunks (document_id, section_id, source_id, ordinal, heading, body, tokens, meta, embedding, lexeme) VALUES ${values}`,
      batch.flat(),
    );
  }
  await kq("UPDATE documents SET chunks = $2 WHERE id = $1", [id, rows.length]);

  return Response.json({
    staged: true,
    document: id,
    title,
    url,
    bytes: text.length,
    parts,
    pages,
    expanded,
    cleaning,
    sections: split.length,
    chunks: rows.length,
    digest: digest.slice(0, 16),
    note: `Staged for review${expanded ? ` from ${pages.length} pages` : ""}. Nothing is retrievable until a person admits it.`,
  });
}
