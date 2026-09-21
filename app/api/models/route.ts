import path from "node:path";
import { readFile } from "node:fs/promises";

/**
 * What a spec can name: the deployments on the Foundry resource, listed
 * through its data plane.
 * Proxied so the page works inside a tenancy whose browsers cannot reach the
 * internet, and cached briefly because deployments change rarely.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = path.resolve(process.cwd(), "..", "runtime");

let cache: { at: number; rows: unknown[] } | null = null;

async function foundry(): Promise<{ endpoint: string; key: string }> {
  let key = process.env.FOUNDRY_API_KEY ?? process.env.AZURE_AI_KEY ?? "";
  try {
    const vault = JSON.parse(await readFile(path.join(ROOT, "workspace", "vault.json"), "utf-8"));
    key = vault?.keys?.foundry?.value || key;
  } catch {
    /* no vault yet */
  }
  return { endpoint: process.env.FOUNDRY_ENDPOINT ?? "", key };
}

export async function GET() {
  if (cache && Date.now() - cache.at < 120_000) {
    return Response.json({ models: cache.rows, cached: true, source: "foundry deployments" });
  }
  const { endpoint, key } = await foundry();
  if (!endpoint || !key) {
    return Response.json({ models: [], error: "FOUNDRY_ENDPOINT and FOUNDRY_API_KEY are not set" });
  }
  try {
    const host = endpoint.split("/openai/")[0];
    const res = await fetch(`${host}/openai/deployments?api-version=2023-03-15-preview`, {
      headers: { "api-key": key },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Foundry returned ${res.status}`);
    const data = await res.json();
    const rows = (data.data ?? [])
      .filter((d: Record<string, unknown>) => d.id && (d.status === "succeeded" || !d.status))
      .map((d: Record<string, unknown>) => ({
        id: String(d.id),
        label: String(d.model && d.model !== d.id ? `${d.id} (${d.model})` : d.id),
        context: 0,
        price: 0,
        deployment: String(d.model ?? ""),
      }));
    cache = { at: Date.now(), rows };
    return Response.json({ models: rows, source: "foundry deployments" });
  } catch (e) {
    return Response.json({ error: `could not list the Foundry deployments — ${(e as Error).message}`, models: [] }, { status: 502 });
  }
}
