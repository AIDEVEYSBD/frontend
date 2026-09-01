import path from "node:path";
import { mkdir, readdir, readFile, unlink } from "node:fs/promises";

/**
 * Drafts: specs the agent-builder authored, awaiting a person.
 *
 * A draft is deliberately not a registry entry. `spec.propose` validated it
 * with the deployment parser and parked it here; it becomes an agent only when
 * a person opens it on the canvas, reads it, and presses Save. Authoring and
 * authorising are different powers, and this directory is the line between
 * them.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIR = path.resolve(process.cwd(), "..", "runtime", "workspace", "drafts");

export async function GET(req: Request) {
  await mkdir(DIR, { recursive: true });
  const id = new URL(req.url).searchParams.get("id");

  if (id) {
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
    try {
      const doc = JSON.parse(await readFile(path.join(DIR, `${id}.json`), "utf-8"));
      return Response.json({ spec: doc });
    } catch {
      return Response.json({ error: `no draft "${id}"` }, { status: 404 });
    }
  }

  const drafts = [];
  for (const f of (await readdir(DIR)).filter((f) => f.endsWith(".json"))) {
    try {
      const doc = JSON.parse(await readFile(path.join(DIR, f), "utf-8"));
      drafts.push({
        id: f.replace(/\.json$/, ""),
        name: doc?.metadata?.name ?? f,
        description: doc?.metadata?.description ?? "",
      });
    } catch {
      /* torn write — skip */
    }
  }
  return Response.json({ drafts });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^[a-z][a-z0-9-]{0,62}$/.test(id)) {
    return Response.json({ error: "which draft?" }, { status: 400 });
  }
  await unlink(path.join(DIR, `${id}.json`)).catch(() => {});
  return Response.json({ removed: true });
}
