import path from "node:path";
import { readFile } from "node:fs/promises";
import { permit } from "@/lib/server/auth";
import { modelsUrl, type ProviderKind } from "@/lib/providers";

/**
 * Ask a provider what it serves.
 *
 * Every provider kind has a list endpoint: Foundry's deployments, Ollama's
 * tags, and `/models` for everything speaking the OpenAI dialect (vLLM, LM
 * Studio, Vertex, Bedrock, Anthropic). The credential is read from the vault
 * by name and never leaves the server; the caller gets ids and labels back.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = path.resolve(process.cwd(), "..", "runtime");

async function secret(ref: string): Promise<string> {
  if (!ref) return "";
  try {
    const vault = JSON.parse(await readFile(path.join(ROOT, "workspace", "vault.json"), "utf-8"));
    const v = vault?.keys?.[ref]?.value;
    if (v) return String(v);
  } catch {
    /* no vault yet */
  }
  if (ref === "foundry") return process.env.FOUNDRY_API_KEY ?? process.env.AZURE_AI_KEY ?? "";
  return process.env[ref] ?? "";
}

export async function POST(req: Request) {
  { const gate = await permit(req, "configure"); if (gate) return gate; }
  let body: { kind?: ProviderKind; endpoint?: string; key_ref?: string; models_url?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "send { kind, endpoint, key_ref }" }, { status: 400 });
  }
  const kind = (body.kind ?? "custom") as ProviderKind;
  const endpoint = String(body.endpoint ?? "").trim() || (kind === "foundry" ? (process.env.FOUNDRY_ENDPOINT ?? "") : "");
  if (!endpoint) return Response.json({ error: "the provider has no endpoint" }, { status: 400 });
  const key = await secret(String(body.key_ref ?? (kind === "foundry" ? "foundry" : "")));
  const url = modelsUrl({ kind, endpoint, models_url: body.models_url });
  const headers: Record<string, string> = {};
  if (key) {
    headers.authorization = `Bearer ${key}`;
    if (kind === "foundry") headers["api-key"] = key;
  }
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`${res.status} from ${url}`);
    const data = await res.json();
    let rows: { id: string; label: string; meta?: string }[] = [];
    if (kind === "foundry") {
      rows = (data.data ?? [])
        .filter((d: Record<string, unknown>) => d.id && (d.status === "succeeded" || !d.status))
        .map((d: Record<string, unknown>) => ({ id: String(d.id), label: String(d.model && d.model !== d.id ? `${d.id} (${d.model})` : d.id), meta: "deployment" }));
    } else if (kind === "ollama" && Array.isArray(data.models)) {
      rows = data.models.map((m: Record<string, unknown>) => ({
        id: String(m.name ?? m.model),
        label: String(m.name ?? m.model),
        meta: [(m.details as Record<string, unknown>)?.parameter_size, (m.details as Record<string, unknown>)?.quantization_level].filter(Boolean).join(" · "),
      }));
    } else {
      const list = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : Array.isArray(data) ? data : [];
      rows = list
        .filter((m: Record<string, unknown>) => m && (m.id || m.name))
        .map((m: Record<string, unknown>) => ({
          id: String(m.id ?? m.name),
          label: String(m.display_name ?? m.id ?? m.name),
          meta: m.owned_by ? String(m.owned_by) : m.max_model_len ? `${Math.round(Number(m.max_model_len) / 1000)}k ctx` : undefined,
        }));
    }
    return Response.json({ models: rows, url, authenticated: Boolean(key) });
  } catch (e) {
    return Response.json({ error: `could not list models — ${(e as Error).message}`, url, models: [] }, { status: 502 });
  }
}
