import path from "node:path";
import { readFile } from "node:fs/promises";

/**
 * Prices per token, from the deployment configuration. Foundry publishes no
 * price sheet, so the operator records cost per million tokens beside each
 * offered model on the Configuration page. The scripted provider is
 * genuinely free; a model with no recorded price is unknown, never zero.
 */

const ROOT = path.resolve(process.cwd(), "..", "runtime");

/**
 * Published list prices per million tokens for models the platform itself
 * calls (the console assistant, the knowledge answer loop, the reranker's
 * fallback) so their cost is never "unknown" just because nobody typed a
 * price. An operator's figure on the Configuration page always wins; these
 * only fill a gap, and the cost basis says when they did.
 */
const LIST_PRICES: Record<string, { in: number; out: number }> = {
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4.1": { in: 2, out: 8 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "text-embedding-3-small": { in: 0.02, out: 0 },
  "text-embedding-3-large": { in: 0.13, out: 0 },
};

/** Models whose price came from the list above rather than the operator, as of the last sheet read. */
let assumed: string[] = [];
export function assumedPrices(): string[] {
  return assumed;
}

let cache: { at: number; map: Map<string, { in: number; out: number }> } | null = null;

/** The price sheet, as every caller passes it around. */
export type Sheet = Map<string, { in: number; out: number }>;

export async function priceSheet(): Promise<Map<string, { in: number; out: number }> | null> {
  if (cache && Date.now() - cache.at < 30_000) return cache.map;
  try {
    const raw = JSON.parse(await readFile(path.join(ROOT, "workspace", "config.json"), "utf-8"));
    const map = new Map<string, { in: number; out: number }>();
    for (const m of raw.models ?? []) {
      if (typeof m.price_in === "number" || typeof m.price_out === "number") {
        map.set(String(m.id), { in: Number(m.price_in ?? 0) / 1_000_000, out: Number(m.price_out ?? 0) / 1_000_000 });
      }
    }
    assumed = [];
    for (const [id, p] of Object.entries(LIST_PRICES)) {
      if (!map.has(id)) {
        map.set(id, { in: p.in / 1_000_000, out: p.out / 1_000_000 });
        assumed.push(id);
      }
    }
    cache = { at: Date.now(), map };
    return map;
  } catch {
    return cache?.map ?? null;
  }
}

export function costOf(model: string, tokens: { in: number; out: number }, sheet: Map<string, { in: number; out: number }> | null): number | null {
  if (model === "scripted") return 0;
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
