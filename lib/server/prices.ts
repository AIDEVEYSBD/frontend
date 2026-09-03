/**
 * The gateway's price sheet, cached for ten minutes. Prices are per token
 * (OpenRouter publishes per-token USD). Local `ollama/` models and the
 * scripted provider are genuinely free; an unknown model is unknown, never
 * zero.
 */

let cache: { at: number; map: Map<string, { in: number; out: number }> } | null = null;

export async function priceSheet(): Promise<Map<string, { in: number; out: number }> | null> {
  if (cache && Date.now() - cache.at < 600_000) return cache.map;
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    const map = new Map<string, { in: number; out: number }>();
    for (const m of data.data ?? []) {
      map.set(String(m.id), { in: Number(m.pricing?.prompt ?? 0), out: Number(m.pricing?.completion ?? 0) });
    }
    cache = { at: Date.now(), map };
    return map;
  } catch {
    return cache?.map ?? null;
  }
}

export function costOf(model: string, tokens: { in: number; out: number }, sheet: Map<string, { in: number; out: number }> | null): number | null {
  if (model.startsWith("ollama/") || model === "scripted") return 0;
  const p = sheet?.get(model);
  return p ? tokens.in * p.in + tokens.out * p.out : null;
}

/** Token usage and model calls recorded in one run's journal. */
export function usageOf(run: { journal?: { entries?: { kind: string; title?: string; data?: Record<string, unknown> }[]; duration_ms?: number } } | null): {
  calls: number;
  tokens: { in: number; out: number };
  byModel: Record<string, { in: number; out: number; calls: number }>;
} {
  const out = { calls: 0, tokens: { in: 0, out: 0 }, byModel: {} as Record<string, { in: number; out: number; calls: number }> };
  for (const e of run?.journal?.entries ?? []) {
    if (e.kind !== "model.call") continue;
    const tk = (e.data?.tokens ?? {}) as { in?: number; out?: number };
    const model = String(e.title || "model");
    const agg = out.byModel[model] ?? { in: 0, out: 0, calls: 0 };
    agg.in += Number(tk.in ?? 0);
    agg.out += Number(tk.out ?? 0);
    agg.calls += 1;
    out.byModel[model] = agg;
    out.calls += 1;
    out.tokens.in += Number(tk.in ?? 0);
    out.tokens.out += Number(tk.out ?? 0);
  }
  return out;
}
