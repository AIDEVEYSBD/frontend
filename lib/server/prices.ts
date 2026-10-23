import path from "node:path";
import { readFile } from "node:fs/promises";

/**
 * Prices per token, from the deployment configuration. Foundry publishes no
 * price sheet, so the operator records cost per million tokens beside each
 * offered model on the Configuration page. The scripted provider is
 * genuinely free. A model with no recorded price is costed at an estimate
 * (the published list price when one is known, else the sheet's own median
 * rate) and the figure is marked as estimated: a cost is never "unknown",
 * because an unknown cost is one nobody can budget, route or stop.
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

/** The rate an unpriced model is estimated at: the median of what is configured, else a published mid-market rate. */
const ESTIMATE_DEFAULT = { in: 1.0 / 1_000_000, out: 3.0 / 1_000_000 };

export function estimateRate(sheet: Sheet | null): { in: number; out: number } {
  const rows = sheet ? [...sheet.entries()].filter(([id]) => !assumed.includes(id)).map(([, p]) => p) : [];
  if (!rows.length) return ESTIMATE_DEFAULT;
  const med = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };
  return { in: med(rows.map((r) => r.in)), out: med(rows.map((r) => r.out)) };
}

/** Whether a model's cost comes from a configured or published price rather than the estimate. */
export function isPriced(model: string, sheet: Sheet | null): boolean {
  return model === "scripted" || Boolean(sheet?.has(model));
}

export async function priceSheet(): Promise<Sheet> {
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
    if (cache) return cache.map;
    // No configuration at all: the published list prices still make a sheet.
    const map = new Map<string, { in: number; out: number }>();
    assumed = [];
    for (const [id, p] of Object.entries(LIST_PRICES)) {
      map.set(id, { in: p.in / 1_000_000, out: p.out / 1_000_000 });
      assumed.push(id);
    }
    return map;
  }
}

/** The cost of a call. Never null: an unpriced model is costed at the estimate rate. */
export function costOf(model: string, tokens: { in: number; out: number }, sheet: Sheet | null): number {
  if (model === "scripted") return 0;
  const p = sheet?.get(model) ?? estimateRate(sheet);
  return tokens.in * p.in + tokens.out * p.out;
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
