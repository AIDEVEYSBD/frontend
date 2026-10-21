import { createHash } from "node:crypto";

/**
 * The index-integrity digest.
 *
 * An admission is the only act that is supposed to change what a namespace
 * believes. So every admission records a digest of the namespace as it
 * stood when the admission finished: which documents are admitted, how
 * many chunks each holds, and which admission rows exist. On every read the
 * same digest is recomputed from the live tables; a mismatch means the
 * index changed by some other hand (a direct write, a restore from an older
 * backup, a migration that dropped rows), and the page says so in those
 * words. Pure over the parts so a test needs no database.
 */

export interface DigestParts {
  namespace: string;
  /** Every admitted document with the number of chunks it holds in the index. */
  documents: { id: string; chunks: number }[];
  /** Every admission row's id, admitted or refused. */
  admissions: (number | string)[];
}

/** The canonical form: sorted, so row order from the database cannot move the digest. */
export function canonical(parts: DigestParts): string {
  const documents = [...parts.documents].map((d) => ({ id: String(d.id), chunks: Number(d.chunks) || 0 })).sort((a, b) => a.id.localeCompare(b.id));
  const admissions = [...parts.admissions].map(String).sort((a, b) => (Number(a) - Number(b)) || a.localeCompare(b));
  return JSON.stringify({ namespace: parts.namespace, documents, admissions });
}

export function indexDigest(parts: DigestParts): string {
  return createHash("sha256").update(canonical(parts)).digest("hex");
}
