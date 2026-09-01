import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dbReady, query } from "@/lib/server/db";

/**
 * Deployment configuration: which OpenRouter models this factory offers.
 *
 * The full catalogue is hundreds of models; a builder dropdown with hundreds of
 * entries is a way of choosing nothing. Whoever runs the factory picks the
 * short list here once, and every model dropdown in the builder shows exactly
 * that list. Stored beside the runtime's workspace so the CLI and UI agree.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE = path.resolve(process.cwd(), "..", "runtime", "workspace", "config.json");

const DEFAULTS = {
  models: [
    { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5" },
    { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5" },
  ],
  default_model: "anthropic/claude-sonnet-4.5",
};

async function read(): Promise<typeof DEFAULTS> {
  try {
    const raw = JSON.parse(await readFile(FILE, "utf-8"));
    if (Array.isArray(raw.models) && raw.models.length) return { ...DEFAULTS, ...raw };
  } catch {
    /* first run — defaults */
  }
  return DEFAULTS;
}

export async function GET() {
  if (await dbReady()) {
    const rows = await query<{ value: typeof DEFAULTS }>(
      "SELECT value FROM settings WHERE key = 'models'",
    );
    if (rows.length) return Response.json({ ...rows[0].value, store: "db" });
  }
  return Response.json(await read());
}

export async function POST(req: Request) {
  let body: { models?: { id: string; label: string }[]; default_model?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.models) || body.models.length === 0) {
    return Response.json({ error: "at least one model must stay selected" }, { status: 400 });
  }
  const config = {
    models: body.models
      .filter((m) => m?.id)
      .map((m) => ({ id: String(m.id), label: String(m.label || m.id) })),
    default_model:
      body.default_model && body.models.some((m) => m.id === body.default_model)
        ? body.default_model
        : body.models[0].id,
  };
  // DB is authoritative; the file is the runtime-side materialised view.
  if (await dbReady()) {
    await query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('models', $1, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [config],
    );
  }
  await mkdir(path.dirname(FILE), { recursive: true });
  await writeFile(FILE, JSON.stringify(config, null, 2) + "\n");
  return Response.json(config);
}
