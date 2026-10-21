import { errorText } from "./client";
import type { StaleReport } from "../knowledge-stale";

/**
 * The console's own knowledge routes, called from a page. The knowledge
 * pipeline (sources, fetch, admission, the index) lives in this console, not
 * on the backend, so these are plain same-origin reads of `app/api/knowledge`,
 * not doors of the generated client.
 */

/** `GET /api/knowledge/stale`: the admitted documents stale against their source, in the namespaces named. */
export async function readStaleDocuments(namespaces: readonly string[]): Promise<StaleReport> {
  const qs = namespaces.map((n) => `namespace=${encodeURIComponent(n)}`).join("&");
  const res = await fetch(`/api/knowledge/stale${qs ? `?${qs}` : ""}`, { cache: "no-store", credentials: "include" });
  const body = (await res.json().catch(() => null)) as StaleReport | { error?: string } | null;
  if (!res.ok || !body || !("stale" in body)) throw new Error(errorText(body, res));
  return body;
}
