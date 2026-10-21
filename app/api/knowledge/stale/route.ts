import { NAMESPACE_RULE, parseNamespace } from "@/lib/knowledge";
import { STALE_BASIS, staleDocuments, type AdmittedCopy, type StaleReport } from "@/lib/knowledge-stale";
import { knowledgeReady, kq } from "@/lib/server/knowledge-db";
import { staleQuery } from "@/lib/server/knowledge-sql";
import { permit } from "@/lib/server/auth";

/**
 * The admitted documents that are stale against their source, in the
 * namespaces asked for: `?namespace=a&namespace=b` (none: the default).
 * The per-application view asks for the corpora an application retrieves
 * from; lib/knowledge-stale.ts says what stale means. A namespace is read on
 * its own statement (lib/server/knowledge-sql.ts staleQuery), so one corpus
 * never answers for another. An unreachable index answers `ready: false`:
 * the count is unknown, not zero.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_NAMESPACES = 20;

interface Row {
  id: string;
  namespace: string;
  source_id: string;
  source: string;
  title: string;
  url: string;
  source_url: string;
  cadence: string;
  fetched_at: string | Date;
  decided_at: string | Date | null;
  newer_id: string | null;
  newer_status: string | null;
  newer_fetched_at: string | Date | null;
}

const iso = (v: string | Date | null): string => (v instanceof Date ? v.toISOString() : v ? String(v) : "");

export async function GET(req: Request) {
  { const gate = await permit(req, "view"); if (gate) return gate; }
  const url = new URL(req.url);
  const asked = url.searchParams.getAll("namespace");
  const parsed = (asked.length ? asked : [""]).map(parseNamespace);
  if (parsed.some((n) => n === null)) return Response.json({ error: NAMESPACE_RULE }, { status: 400 });
  const namespaces = [...new Set(parsed as string[])];
  if (namespaces.length > MAX_NAMESPACES) return Response.json({ error: `at most ${MAX_NAMESPACES} namespaces at once` }, { status: 400 });

  if (!(await knowledgeReady())) {
    const report: StaleReport = { ready: false, namespaces, checked: 0, stale: [], error: "the knowledge index is unreachable, so whether its documents are current is unknown", basis: STALE_BASIS };
    return Response.json(report);
  }

  const copies: AdmittedCopy[] = [];
  for (const namespace of namespaces) {
    const q = staleQuery(namespace);
    const rows = await kq<Row>(q.sql, q.params);
    for (const r of rows) {
      copies.push({
        id: r.id,
        namespace: r.namespace,
        source_id: r.source_id,
        source: r.source,
        title: r.title,
        url: r.url,
        source_url: r.source_url,
        cadence: r.cadence,
        fetched_at: iso(r.fetched_at),
        decided_at: iso(r.decided_at) || null,
        newer: r.newer_id ? { id: r.newer_id, status: r.newer_status ?? "", fetched_at: iso(r.newer_fetched_at) } : null,
      });
    }
  }

  const report: StaleReport = { ready: true, namespaces, checked: copies.length, stale: staleDocuments(copies, Date.now()), basis: STALE_BASIS };
  return Response.json(report);
}
