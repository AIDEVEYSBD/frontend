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
    { id: "anthropic/claude-sonnet-4.5", label: "Claude Sonnet 4.5", class: "medium" as const },
    { id: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5", class: "small" as const },
  ],
  default_model: "anthropic/claude-sonnet-4.5",
  class_defaults: { small: "anthropic/claude-haiku-4.5", medium: "anthropic/claude-sonnet-4.5" } as Partial<Record<"small" | "medium" | "large", string>>,
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

const CLASSES = ["small", "medium", "large"] as const;
type ModelClass = (typeof CLASSES)[number];

export async function POST(req: Request) {
  let body: {
    models?: { id: string; label: string; class?: string }[];
    default_model?: string;
    class_defaults?: Partial<Record<ModelClass, string>>;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.models) || body.models.length === 0) {
    return Response.json({ error: "at least one model must stay selected" }, { status: 400 });
  }
  // A model's class is a capability tier (small / medium / large) the router
  // and the eval comparison read. It is metadata the operator asserts, never
  // inferred from the name. The class default is the model a node that asks
  // for "a small model" actually gets in this deployment.
  const models = body.models
    .filter((m) => m?.id)
    .map((m) => ({
      id: String(m.id),
      label: String(m.label || m.id),
      ...(m.class && (CLASSES as readonly string[]).includes(m.class) ? { class: m.class as ModelClass } : {}),
    }));
  const ids = new Set(models.map((m) => m.id));
  const class_defaults: Partial<Record<ModelClass, string>> = {};
  for (const c of CLASSES) {
    const want = body.class_defaults?.[c];
    if (want && ids.has(want)) class_defaults[c] = want;
    else {
      const first = models.find((m) => m.class === c);
      if (first) class_defaults[c] = first.id;
    }
  }
  const config = {
    models,
    default_model:
      body.default_model && ids.has(body.default_model) ? body.default_model : models[0].id,
    class_defaults,
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
