import path from "node:path";
import { readFile, realpath } from "node:fs/promises";

/**
 * Download one artifact a run produced.
 *
 * Addressed by basename only and resolved strictly inside the workspace outbox
 * — this route serves files to a browser, and a file server that takes paths
 * takes traversals. Symlinks are resolved before the containment check, or a
 * link inside the outbox pointing outside it would defeat the whole rule.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OUTBOX = path.resolve(process.cwd(), "..", "runtime", "workspace", "outbox");

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  md: "text/markdown; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  json: "application/json",
  csv: "text/csv; charset=utf-8",
  html: "text/html; charset=utf-8",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export async function GET(req: Request) {
  const name = new URL(req.url).searchParams.get("name") ?? "";
  if (!name || name !== path.basename(name) || name.startsWith(".")) {
    return Response.json({ error: "artifacts are addressed by filename" }, { status: 400 });
  }
  try {
    const resolved = await realpath(path.join(OUTBOX, name));
    if (!resolved.startsWith(OUTBOX + path.sep)) {
      return Response.json({ error: "outside the outbox" }, { status: 403 });
    }
    const raw = await readFile(resolved);
    const ext = path.extname(name).slice(1).toLowerCase();
    return new Response(new Uint8Array(raw), {
      headers: {
        "content-type": MIME[ext] ?? "application/octet-stream",
        "content-disposition": `attachment; filename="${name.replace(/"/g, "")}"`,
        "cache-control": "no-store",
      },
    });
  } catch {
    return Response.json({ error: `no artifact "${name}"` }, { status: 404 });
  }
}
