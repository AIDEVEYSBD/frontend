import { DEFAULT_NAMESPACE } from "./knowledge";

/**
 * Which admitted documents are stale against their source.
 *
 * The knowledge pipeline keeps three things about every copy it holds that
 * say how current it is, and this reads all three:
 *
 *   changed  a later fetch of the same source in the same corpus differs
 *            from the admitted copy (a fetch byte-identical to one on record
 *            is never staged, so any later row is a different text): the
 *            publisher has moved on, and the newer text is waiting for a
 *            person, or was refused and the corpus kept the older one.
 *   moved    the catalogue now fetches the source from a different address
 *            than the copy was fetched from.
 *   overdue  the copy is older than the source's own cadence allows (the
 *            catalogue's "how often the publisher changes it"): daily,
 *            weekly, monthly, quarterly, twice a year, annual; a continuous
 *            feed counts as weekly. A cadence that names no period (on
 *            amendment, on release, major revisions, periodic) is never
 *            overdue by age: only a later fetch can show it changed.
 *
 * Pure: the route (app/api/knowledge/stale) reads the rows, and
 * tests/knowledge-stale.test.ts holds every rule without a database.
 */

const DAY = 86_400_000;

/** How many days a copy of a source may age before it is due again, from the catalogue's cadence; null when the cadence names no period. */
export function cadenceDays(cadence: string): number | null {
  const c = cadence.trim().toLowerCase();
  if (!c) return null;
  if (/\bdaily\b|\bevery day\b/.test(c)) return 1;
  if (/\bcontinuous(ly)?\b/.test(c)) return 7;
  if (/\bweekly\b|\bevery week\b/.test(c)) return 7;
  if (/\bmonthly\b|\bevery month\b/.test(c)) return 31;
  if (/\bquarterly\b/.test(c)) return 92;
  if (/\btwice a year\b|\bsemi-?annual(ly)?\b|\bbiannual(ly)?\b/.test(c)) return 183;
  if (/\bannual(ly)?\b|\byearly\b|\bevery year\b/.test(c)) return 366;
  return null;
}

/** One admitted copy, as the route reads it: the document, its source in the catalogue, and the newest later fetch of the same source. */
export interface AdmittedCopy {
  id: string;
  namespace: string;
  source_id: string;
  /** The source's name in the catalogue; the id when the source is gone. */
  source: string;
  title: string;
  /** Where this copy was fetched from. */
  url: string;
  /** Where the catalogue fetches the source from now. */
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

/** One URL list as the catalogue writes it (space separated is one document), for comparison. */
const urls = (s: string) => s.trim().split(/\s+/).filter(Boolean).join(" ");

const day = (iso: string) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toISOString().slice(0, 10) : "an unknown date");

/** Why a copy is stale against its source; empty when it is current on every signal the pipeline keeps. */
export function stalenessOf(copy: AdmittedCopy, now: number): StaleReason[] {
  const out: StaleReason[] = [];
  if (copy.newer) {
    const when = day(copy.newer.fetched_at);
    const status =
      copy.newer.status === "staged"
        ? "is waiting for review"
        : copy.newer.status === "rejected"
          ? "was refused, so the corpus keeps this older text"
          : copy.newer.status === "superseded"
            ? "was admitted and later replaced"
            : `is ${copy.newer.status}`;
    out.push({ kind: "changed", detail: `the source has changed: a later fetch (${when}) differs from this copy and ${status}`, newer: copy.newer });
  }
  const from = urls(copy.url);
  const to = urls(copy.source_url);
  if (from && to && from !== to) {
    out.push({ kind: "moved", detail: "the catalogue now fetches this source from a different address than this copy came from", from, to });
  }
  const limit = cadenceDays(copy.cadence);
  const fetched = Date.parse(copy.fetched_at);
  if (limit !== null && !Number.isNaN(fetched)) {
    const age = Math.floor((now - fetched) / DAY);
    if (age > limit) out.push({ kind: "overdue", detail: `fetched ${age} days ago; the publisher changes it ${copy.cadence.trim().toLowerCase()}, so a copy is due every ${limit} day${limit === 1 ? "" : "s"}`, age_days: age, limit_days: limit });
  }
  return out;
}

const RANK: Record<StaleReason["kind"], number> = { changed: 0, moved: 1, overdue: 2 };

/** The stale copies among those given, most certain first (a changed source, then a moved one, then the most overdue). */
export function staleDocuments(copies: readonly AdmittedCopy[], now: number): StaleDocument[] {
  const out: StaleDocument[] = [];
  for (const c of copies) {
    const reasons = stalenessOf(c, now);
    if (!reasons.length) continue;
    const fetched = Date.parse(c.fetched_at);
    out.push({ ...c, reasons, age_days: Number.isNaN(fetched) ? 0 : Math.max(0, Math.floor((now - fetched) / DAY)) });
  }
  const worst = (d: StaleDocument) => Math.min(...d.reasons.map((r) => RANK[r.kind]));
  return out.sort((a, b) => worst(a) - worst(b) || b.age_days - a.age_days || a.namespace.localeCompare(b.namespace) || a.id.localeCompare(b.id));
}

/**
 * The corpora an application retrieves from, as the retrieval door decides
 * it (backend/app/retrieval.py `namespace_allowed`): the namespaces its
 * policy lists; a RAG application that lists none reads the default one
 * only; anything else that lists none retrieves from nothing.
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

export const STALE_BASIS =
  "admitted documents only; stale when a later fetch of the same source differs, when the catalogue moved the source's address, or when the copy is older than the source's cadence (a continuous feed counts as weekly; a cadence with no period is judged by later fetches alone)";
