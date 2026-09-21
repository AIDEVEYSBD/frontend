import { execFile } from "node:child_process";
import { permit, session as whoIs, signer, ssoEnabled } from "@/lib/server/auth";
import path from "node:path";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { dbReady, query } from "@/lib/server/db";

/**
 * Saved agents — the registry, backed by AgentFactoryDB.
 *
 * Postgres is authoritative; every save writes through to the runtime's
 * workspace file so `agent.invoke` can chain workflows without the Python
 * side growing a database driver. If the database is unreachable the routes
 * fall back to the files and say so — degraded, never silently different.
 *
 * Every save is validated by `agentfactory check` first. A registry holding
 * an agent the runtime would refuse poisons every workflow that chains it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = path.resolve(process.cwd(), "..", "runtime");
const DIR = path.join(ROOT, "workspace", "agents");
const exec = promisify(execFile);

interface SpecDoc {
  metadata?: { id?: string; name?: string; description?: string };
  spec?: { nodes?: unknown[] };
}

const summarise = (id: string, doc: SpecDoc) => ({
  id: doc?.metadata?.id ?? id,
  name: doc?.metadata?.name ?? id,
  description: doc?.metadata?.description ?? "",
  nodes: doc?.spec?.nodes?.length ?? 0,
});

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  const db = await dbReady();

  if (id) {
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(id)) {
      return Response.json({ error: "bad id" }, { status: 400 });
    }
    if (db) {
      const rows = await query<{ spec: SpecDoc }>("SELECT spec FROM workflows WHERE id = $1", [id]);
      if (rows.length) return Response.json({ spec: rows[0].spec, store: "db" });
    }
    try {
      const doc = JSON.parse(await readFile(path.join(DIR, `${id}.json`), "utf-8"));
      return Response.json({ spec: doc, store: db ? "file" : "file (db unreachable)" });
    } catch {
      return Response.json({ error: `no saved agent "${id}"` }, { status: 404 });
    }
  }

  if (db) {
    const rows = await query<{ id: string; spec: SpecDoc }>(
      "SELECT id, spec FROM workflows ORDER BY updated_at DESC",
    );
    // Files that predate the database (or were dropped in by hand) are
    // adopted into the registry on sight, so nothing saved ever goes missing.
    try {
      await mkdir(DIR, { recursive: true });
      const known = new Set(rows.map((r) => r.id));
      for (const f of (await readdir(DIR)).filter((f) => f.endsWith(".json"))) {
        const fid = f.replace(/\.json$/, "");
        if (known.has(fid)) continue;
        try {
          const doc = JSON.parse(await readFile(path.join(DIR, f), "utf-8")) as SpecDoc;
          await query(
            `INSERT INTO workflows (id, name, description, spec) VALUES ($1, $2, $3, $4)
             ON CONFLICT (id) DO NOTHING`,
            [fid, doc?.metadata?.name ?? fid, doc?.metadata?.description ?? "", doc],
          );
          rows.push({ id: fid, spec: doc });
        } catch {
          /* unreadable file — leave it out rather than guess */
        }
      }
    } catch {
      /* workspace unavailable; the DB list stands alone */
    }
    return Response.json({ agents: rows.map((r) => summarise(r.id, r.spec)), store: "db" });
  }

  // Fallback: the files, plainly labelled.
  try {
    await mkdir(DIR, { recursive: true });
    const agents = [];
    for (const f of (await readdir(DIR)).filter((f) => f.endsWith(".json"))) {
      try {
        const doc = JSON.parse(await readFile(path.join(DIR, f), "utf-8"));
        agents.push(summarise(f.replace(/\.json$/, ""), doc));
      } catch {
        /* skip torn files */
      }
    }
    return Response.json({ agents, store: "file (db unreachable)" });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  { const gate = await permit(req, "deploy"); if (gate) return gate; }
  let body: { spec?: SpecDoc };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }
  const id = body.spec?.metadata?.id;
  if (!body.spec || !id || !/^[a-z][a-z0-9-]{0,62}$/.test(id)) {
    return Response.json({ error: "the spec needs a valid metadata.id" }, { status: 400 });
  }

  // Write-through first: the file is what the runtime validates and chains.
  await mkdir(DIR, { recursive: true });
  const file = path.join(DIR, `${id}.json`);
  await writeFile(file, JSON.stringify(body.spec, null, 2) + "\n");

  try {
    await exec("python3", ["-m", "agentfactory", "check", "--spec", file], {
      cwd: ROOT,
      timeout: 15_000,
    });
  } catch (e) {
    await unlink(file).catch(() => {});
    const msg = (e as { stdout?: string }).stdout ?? (e as Error).message;
    return Response.json({ error: `the runtime refused this spec — ${msg.slice(0, 400)}` }, { status: 422 });
  }

  let store = "file (db unreachable)";
  if (await dbReady()) {
    await query(
      `INSERT INTO workflows (id, name, description, spec, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, description = EXCLUDED.description,
         spec = EXCLUDED.spec, updated_at = now()`,
      [id, body.spec.metadata?.name ?? id, body.spec.metadata?.description ?? "", body.spec],
    );
    store = "db";
  }

  return Response.json({ saved: true, id, store });
}

export async function DELETE(req: Request) {
  { const gate = await permit(req, "deploy"); if (gate) return gate; }
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^[a-z][a-z0-9-]{0,62}$/.test(id)) {
    return Response.json({ error: "which agent?" }, { status: 400 });
  }
  if (await dbReady()) {
    await query("DELETE FROM workflows WHERE id = $1", [id]);
  }
  await unlink(path.join(DIR, `${id}.json`)).catch(() => {});
  return Response.json({ removed: true });
}
