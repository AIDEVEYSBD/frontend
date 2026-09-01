/**
 * The OpenRouter catalogue, proxied.
 *
 * Proxied rather than fetched from the browser so the page works inside a
 * tenancy whose browsers cannot reach the internet, and cached for ten minutes
 * because the catalogue changes weekly, not per keystroke.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cache: { at: number; rows: unknown[] } | null = null;

/** Models the local Ollama daemon serves — free, on-machine, listed first. */
async function localModels(): Promise<unknown[]> {
  try {
    const res = await fetch("http://localhost:11434/api/tags", {
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models ?? [])
      .filter((m: { name?: string }) => m.name && !String(m.name).includes("embed"))
      .map((m: { name: string }) => ({
        id: `ollama/${m.name}`,
        label: `${m.name} (local)`,
        context: 0,
        price: 0,
        local: true,
      }));
  } catch {
    return []; // daemon not running — the catalogue stands alone
  }
}

export async function GET() {
  const local = await localModels();
  if (cache && Date.now() - cache.at < 600_000) {
    return Response.json({ models: [...local, ...cache.rows], cached: true });
  }
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`OpenRouter returned ${res.status}`);
    const data = await res.json();
    const rows = (data.data ?? [])
      .map((m: Record<string, unknown>) => ({
        id: String(m.id ?? ""),
        label: String(m.name ?? m.id ?? ""),
        context: Number(m.context_length ?? 0),
        // Prices per million tokens — prompt for the picker, both for cost math.
        price: Number((m.pricing as Record<string, unknown>)?.prompt ?? 0) * 1_000_000,
        price_out: Number((m.pricing as Record<string, unknown>)?.completion ?? 0) * 1_000_000,
      }))
      .filter((m: { id: string }) => m.id);
    cache = { at: Date.now(), rows };
    return Response.json({ models: [...local, ...rows] });
  } catch (e) {
    if (local.length) return Response.json({ models: local, degraded: "catalogue unreachable" });
    return Response.json(
      { error: `could not reach the OpenRouter catalogue — ${(e as Error).message}`, models: [] },
      { status: 502 },
    );
  }
}
