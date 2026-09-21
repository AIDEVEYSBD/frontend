import path from "node:path";
import { permit } from "@/lib/server/auth";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dbReady, query } from "@/lib/server/db";
import { FOUNDRY_ID, KINDS, type Provider, type ProviderKind } from "@/lib/providers";

/**
 * Deployment configuration: the providers this factory reaches, the models it
 * offers from them, and how steps are routed to models.
 *
 * The full catalogue is hundreds of models; a builder dropdown with hundreds of
 * entries is a way of choosing nothing. Whoever runs the factory picks the
 * short list here once, and every model dropdown in the builder shows exactly
 * that list. Stored beside the runtime's workspace so the CLI and UI agree.
 *
 * Routing has four layers, lowest first: the deployment default, the tier
 * defaults (small / medium / large), the node's own choice in its spec, and
 * the operator's per-node routes set on the FinOps page. The runtime resolves
 * them in that order; a forced model for a measurement outranks them all.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE = path.resolve(process.cwd(), "..", "runtime", "workspace", "config.json");

const CLASSES = ["small", "medium", "large"] as const;
type ModelClass = (typeof CLASSES)[number];

export interface OfferedModel {
  id: string;
  label: string;
  class?: ModelClass;
  price_in?: number;
  price_out?: number;
  /** Provider id; absent means the built-in Foundry gateway. */
  provider?: string;
  /** The id the endpoint knows this model by, when it differs from the offered id. */
  served_as?: string;
}

export interface DeployConfig {
  models: OfferedModel[];
  default_model: string;
  class_defaults: Partial<Record<ModelClass, string>>;
  providers: Provider[];
  /** "<workflow id>/<node id>" → model id. */
  node_routes: Record<string, string>;
}

const DEFAULTS: DeployConfig = {
  models: [],
  default_model: "",
  class_defaults: {},
  providers: [],
  node_routes: {},
};

/** The Foundry gateway from the environment, always listed so the estate view is complete. */
function builtin(): Provider {
  return {
    id: FOUNDRY_ID,
    label: "Azure AI Foundry",
    kind: "foundry",
    endpoint: process.env.FOUNDRY_ENDPOINT ?? "",
    key_ref: "foundry",
    local: false,
  };
}

function withBuiltin(cfg: DeployConfig): DeployConfig {
  const providers = cfg.providers.some((p) => p.id === FOUNDRY_ID) ? cfg.providers : [builtin(), ...cfg.providers];
  return { ...DEFAULTS, ...cfg, providers };
}

async function readFileConfig(): Promise<DeployConfig> {
  try {
    const raw = JSON.parse(await readFile(FILE, "utf-8"));
    if (Array.isArray(raw.models)) return { ...DEFAULTS, ...raw };
  } catch {
    /* first run — defaults */
  }
  return DEFAULTS;
}

export async function readConfig(): Promise<DeployConfig> {
  if (await dbReady()) {
    const rows = await query<{ value: DeployConfig }>("SELECT value FROM settings WHERE key = 'models'");
    if (rows.length) return withBuiltin({ ...DEFAULTS, ...rows[0].value });
  }
  return withBuiltin(await readFileConfig());
}

export async function GET() {
  const cfg = await readConfig();
  return Response.json({ ...cfg, store: (await dbReady()) ? "db" : "file" });
}

const num = (v: unknown) => (v === "" || v === null || v === undefined ? undefined : Number.isFinite(Number(v)) ? Number(v) : undefined);

function cleanProviders(raw: unknown): Provider[] {
  if (!Array.isArray(raw)) return [];
  const kinds = new Set(KINDS.map((k) => k.value));
  const out: Provider[] = [];
  for (const p of raw as Record<string, unknown>[]) {
    const id = String(p?.id ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
    if (!id || out.some((x) => x.id === id)) continue;
    const kind = (kinds.has(String(p.kind) as ProviderKind) ? String(p.kind) : "custom") as ProviderKind;
    const known = KINDS.find((k) => k.value === kind)!;
    out.push({
      id,
      label: String(p.label || id),
      kind,
      endpoint: String(p.endpoint ?? "").trim(),
      ...(p.key_ref ? { key_ref: String(p.key_ref).trim() } : {}),
      local: p.local === undefined ? known.local : Boolean(p.local),
      ...(num(p.hourly_usd) !== undefined ? { hourly_usd: num(p.hourly_usd) } : {}),
      ...(p.models_url ? { models_url: String(p.models_url).trim() } : {}),
    });
  }
  return out;
}

export async function POST(req: Request) {
  { const gate = await permit(req, "configure"); if (gate) return gate; }
  let body: Partial<DeployConfig> & { models?: Record<string, unknown>[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }
  const current = await readConfig();
  // A partial write (only routes, only providers) keeps the rest as it is.
  const rawModels = Array.isArray(body.models) ? body.models : (current.models as unknown as Record<string, unknown>[]);
  if (!Array.isArray(rawModels) || rawModels.length === 0) {
    return Response.json({ error: "at least one model must stay selected" }, { status: 400 });
  }
  const providers = body.providers !== undefined ? cleanProviders(body.providers) : current.providers;
  const providerIds = new Set(providers.map((p) => p.id));
  // A model's class is a capability tier (small / medium / large) the router
  // and the eval comparison read. It is metadata the operator asserts, never
  // inferred from the name. The class default is the model a node that asks
  // for "a small model" actually gets in this deployment.
  // Providers publish no price sheet, so cost per million tokens is operator
  // metadata on the offered model. Absent means unknown, never zero — except
  // on a local provider, where the token price is genuinely zero and the
  // hardware hour carries the cost.
  const models: OfferedModel[] = rawModels
    .filter((m) => m?.id)
    .map((m) => {
      const provider = m.provider && providerIds.has(String(m.provider)) ? String(m.provider) : undefined;
      const local = provider ? providers.find((p) => p.id === provider)?.local : false;
      return {
        id: String(m.id),
        label: String(m.label || m.id),
        ...(m.class && (CLASSES as readonly string[]).includes(String(m.class)) ? { class: m.class as ModelClass } : {}),
        ...(local ? { price_in: 0, price_out: 0 } : {
          ...(num(m.price_in) !== undefined ? { price_in: num(m.price_in) } : {}),
          ...(num(m.price_out) !== undefined ? { price_out: num(m.price_out) } : {}),
        }),
        ...(provider && provider !== FOUNDRY_ID ? { provider } : {}),
        ...(m.served_as ? { served_as: String(m.served_as) } : {}),
      };
    });
  const ids = new Set(models.map((m) => m.id));
  const class_defaults: Partial<Record<ModelClass, string>> = {};
  const wantDefaults = body.class_defaults ?? current.class_defaults;
  for (const c of CLASSES) {
    const want = wantDefaults?.[c];
    if (want && ids.has(want)) class_defaults[c] = want;
    else {
      const first = models.find((m) => m.class === c);
      if (first) class_defaults[c] = first.id;
    }
  }
  const node_routes: Record<string, string> = {};
  const wantRoutes = body.node_routes ?? current.node_routes ?? {};
  for (const [k, v] of Object.entries(wantRoutes)) {
    if (v && ids.has(String(v)) && /^[^/]+\/[^/]+$/.test(k)) node_routes[k] = String(v);
  }
  const wantDefault = body.default_model ?? current.default_model;
  const config: DeployConfig = {
    models,
    default_model: wantDefault && ids.has(wantDefault) ? wantDefault : (models[0]?.id ?? ""),
    class_defaults,
    // The built-in gateway is implied; only what the operator added is stored.
    providers: providers.filter((p) => p.id !== FOUNDRY_ID),
    node_routes,
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
  return Response.json(withBuiltin(config));
}
