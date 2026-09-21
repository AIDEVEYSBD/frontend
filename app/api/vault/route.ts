import { execFile } from "node:child_process";
import { permit, session as whoIs, signer, ssoEnabled } from "@/lib/server/auth";
import path from "node:path";
import { promisify } from "node:util";

/**
 * The key vault, over HTTP.
 *
 * Thin on purpose: every operation shells to `python3 -m agentfactory vault`,
 * so the CLI, the UI and the runtime read the same store and cannot drift.
 * Values only ever leave here masked — the one consumer of a live key is the
 * runtime, at the moment a tool is called, and it reads the store directly.
 *
 * Not encrypted at rest. Deliberate for the prototype, and the UI says so
 * rather than implying otherwise; a real deployment puts a KMS behind the
 * vault's read/write and keeps every interface here.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = path.resolve(process.cwd(), "..", "runtime");
const exec = promisify(execFile);

async function vault(args: string[]): Promise<{ ok: boolean; lines: unknown[]; error?: string }> {
  try {
    const { stdout } = await exec("python3", ["-m", "agentfactory", "vault", ...args], {
      cwd: ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      timeout: 15_000,
    });
    const lines = stdout
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return { raw: l };
        }
      });
    return { ok: true, lines };
  } catch (e) {
    return { ok: false, lines: [], error: (e as Error).message.slice(0, 400) };
  }
}

export async function GET() {
  const out = await vault(["list"]);
  if (!out.ok) return Response.json({ error: out.error }, { status: 500 });
  return Response.json({ keys: out.lines });
}

export async function POST(req: Request) {
  { const gate = await permit(req, "configure"); if (gate) return gate; }
  let body: { name?: string; value?: string; label?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }
  if (!body.name?.trim() || !body.value) {
    return Response.json({ error: "a key needs a name and a value" }, { status: 400 });
  }
  const out = await vault([
    "set",
    "--name",
    body.name.trim(),
    "--value",
    body.value,
    ...(body.label ? ["--label", body.label] : []),
  ]);
  if (!out.ok) return Response.json({ error: out.error }, { status: 500 });
  return Response.json({ key: out.lines[0] ?? null });
}

export async function DELETE(req: Request) {
  { const gate = await permit(req, "configure"); if (gate) return gate; }
  const name = new URL(req.url).searchParams.get("name")?.trim();
  if (!name) return Response.json({ error: "which key?" }, { status: 400 });
  const out = await vault(["rm", "--name", name]);
  if (!out.ok) return Response.json({ error: out.error }, { status: 500 });
  return Response.json({ removed: true });
}
