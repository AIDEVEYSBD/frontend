import { execFile } from "node:child_process";
import path from "node:path";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { dbReady, query } from "@/lib/server/db";

/**
 * Deploy: the workflow becomes part of the running estate.
 *
 * Concretely — and honestly — that means: the deployment parser seals the
 * document, the runtime container's registry receives it (file the runtime
 * reads + AgentFactoryDB row), and it is stamped `deployed_at`. From that
 * moment it appears on the control plane, is callable by other workflows, and
 * runs under everything the journal enforces. Each step reports its real
 * duration so the deploy theater choreographs the truth, not a loading bar.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = path.resolve(process.cwd(), "..", "runtime");
const DIR = path.join(ROOT, "workspace", "agents");
const exec = promisify(execFile);

export async function POST(req: Request) {
  let body: { spec?: { metadata?: { id?: string; name?: string; description?: string } } };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }
  const id = body.spec?.metadata?.id;
  if (!body.spec || !id || !/^[a-z][a-z0-9-]{0,62}$/.test(id)) {
    return Response.json({ error: "the spec needs a valid metadata.id" }, { status: 400 });
  }

  const steps: { step: string; ms: number }[] = [];
  let t = Date.now();
  const lap = (step: string) => {
    steps.push({ step, ms: Date.now() - t });
    t = Date.now();
  };

  // 1 — the runtime's parser is the seal. No spec ships that it refuses.
  await mkdir(DIR, { recursive: true });
  const file = path.join(DIR, `${id}.json`);
  await writeFile(file, JSON.stringify(body.spec, null, 2) + "\n");
  let digest = "";
  try {
    const { stdout } = await exec("python3", ["-m", "agentfactory", "check", "--spec", file], {
      cwd: ROOT,
      timeout: 20_000,
    });
    const verdict = JSON.parse(stdout.trim().split("\n").pop() ?? "{}");
    digest = String(verdict.digest ?? "");
  } catch (e) {
    await unlink(file).catch(() => {});
    const msg = (e as { stdout?: string }).stdout ?? (e as Error).message;
    return Response.json({ error: `the runtime refused this spec — ${msg.slice(0, 400)}` }, { status: 422 });
  }
  lap("validate");

  // 2 — the registry row, stamped deployed.
  let store = "file (db unreachable)";
  if (await dbReady()) {
    await query(
      `INSERT INTO workflows (id, name, description, spec, updated_at, deployed_at)
       VALUES ($1, $2, $3, $4, now(), now())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, description = EXCLUDED.description,
         spec = EXCLUDED.spec, updated_at = now(), deployed_at = now()`,
      [id, body.spec.metadata?.name ?? id, body.spec.metadata?.description ?? "", body.spec],
    );
    store = "db";
  }
  lap("register");

  return Response.json({
    deployed: true,
    id,
    digest,
    store,
    steps,
    at: new Date().toISOString(),
  });
}
