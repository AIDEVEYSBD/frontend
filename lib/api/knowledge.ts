import { errorText } from "./client";
import type { StaleReport } from "../knowledge-stale";

/**
 * Reads of the knowledge addresses that more than one page makes. The
 * platform service answers them (the console forwards every /api request to
 * it), so these are plain same-origin reads.
 */

/** `GET /api/knowledge/stale`: the admitted documents stale against their source, in the namespaces named. */
export async function readStaleDocuments(namespaces: readonly string[]): Promise<StaleReport> {
  const qs = namespaces.map((n) => `namespace=${encodeURIComponent(n)}`).join("&");
  const res = await fetch(`/api/knowledge/stale${qs ? `?${qs}` : ""}`, { cache: "no-store", credentials: "include" });
  const body = (await res.json().catch(() => null)) as StaleReport | { error?: string } | null;
  if (!res.ok || !body || !("stale" in body)) throw new Error(errorText(body, res));
  return body;
}
