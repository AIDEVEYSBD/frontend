import { DEFAULT_NAMESPACE } from "./knowledge";

/**
 * Which admitted documents are stale against their source: the shape of what
 * `GET /api/knowledge/stale` answers.
 *
 * The platform service works it out (agentfactory/knowledge/health.py) from
 * three signals, and gives each stale copy the reasons that apply:
 *
 *   changed  a later fetch of the same source in the same corpus differs
 *            from the admitted copy: the publisher has moved on, and the
 *            newer text is waiting for a person, or was refused and the
 *            corpus kept the older one.
 *   moved    the source is now fetched from a different address than the
 *            copy was fetched from.
 *   overdue  longer ago than the source's interval allows since the copy was
 *            fetched or a later fetch found the source unchanged. A source
 *            with no interval is never overdue by age.
 */

/** One admitted copy: the document, its source, and the newest later fetch of the same source. */
export interface AdmittedCopy {
  id: string;
  namespace: string;
  source_id: string;
  /** The source's name. */
  source: string;
  title: string;
  /** Where this copy was fetched from. */
  url: string;
  /** Where the source is fetched from now. */
  source_url: string;
  cadence: string;
  fetched_at: string;
  /** When it was admitted. */
  decided_at: string | null;
  /** The newest fetch of the same source after this one, with a different text; null when there is none. */
  newer: { id: string; status: string; fetched_at: string } | null;
}

export type StaleReason =
  | { kind: "changed"; detail: string; newer: { id: string; status: string; fetched_at: string } }
  | { kind: "moved"; detail: string; from: string; to: string }
  | { kind: "overdue"; detail: string; age_days: number; limit_days: number };

export interface StaleDocument extends AdmittedCopy {
  reasons: StaleReason[];
  /** Whole days since this copy was fetched. */
  age_days: number;
}

/**
 * The corpora an application retrieves from: the namespaces its policy
 * lists; a RAG application that lists none reads the default one only;
 * anything else that lists none retrieves from nothing.
 */
export function corporaOf(app: { class: string; policy: { namespaces: readonly string[] } }): string[] {
  const listed = [...new Set(app.policy.namespaces.map((n) => n.trim()).filter(Boolean))];
  if (listed.length) return listed;
  return app.class === "rag" ? [DEFAULT_NAMESPACE] : [];
}

/** What `GET /api/knowledge/stale` answers. */
export interface StaleReport {
  /** False when the knowledge index could not be read: the count is unknown, not zero. */
  ready: boolean;
  namespaces: string[];
  /** Admitted documents checked across those namespaces. */
  checked: number;
  stale: StaleDocument[];
  error?: string;
  basis: string;
}
