/**
 * A content digest, short enough for a row.
 *
 * Digests here are `sha256:<64 hex>`: a tool server's pin, a scan, a
 * sandbox's copy-in manifest. A row shows the algorithm and the first
 * twelve hex digits, which is plenty to tell two apart by eye; the full
 * value stays one hover or one copy away wherever the short one is shown.
 */
export function shortDigest(digest: string, keep = 12): string {
  const d = digest.trim();
  if (!d) return "";
  const colon = d.indexOf(":");
  const algo = colon > 0 ? d.slice(0, colon + 1) : "";
  const hex = colon > 0 ? d.slice(colon + 1) : d;
  return hex.length > keep ? `${algo}${hex.slice(0, keep)}…` : d;
}
