import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { SOURCES } from "@/lib/knowledge";

/**
 * Namespace isolation against a live index.
 *
 * Skipped unless KNOWLEDGE_DB_DSN names a pgvector database:
 *
 *   docker compose up -d vectors
 *   KNOWLEDGE_DB_DSN=postgres://knowledge:knowledge-dev@127.0.0.1:5458/knowledge npm test -- tests/knowledge-db
 *
 * A document is staged and admitted in one namespace through the routes
 * themselves (fetch with the text supplied, then admit); a search in a
 * second namespace, whose register has been seeded so the join to sources
 * cannot be what empties it, finds nothing; the same search in the first
 * finds the document. The embedding call is stubbed with one fixed vector,
 * so no model gateway is needed and the dense half of the search still
 * runs; the auth module is stubbed so the test needs no session and writes
 * no audit rows to the registry. Everything the test wrote is deleted after.
 */

const DSN = process.env.KNOWLEDGE_DB_DSN ?? "";

const VECTOR = [1, ...Array<number>(1535).fill(0)];

vi.mock("@/lib/server/embed", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/server/embed")>();
  return { ...real, embed: async (inputs: string[]) => inputs.map(() => VECTOR), embeddingReady: () => true };
});

vi.mock("@/lib/server/auth", () => ({
  permit: async () => null,
  session: async () => null,
  ssoEnabled: () => false,
  signer: () => "tests",
  internalHeaders: () => ({}),
}));

const stamp = randomUUID().slice(0, 8);
const NS_A = `t-${stamp}-a`;
const NS_B = `t-${stamp}-b`;
const WORD = `zebrafish${stamp}`;
const TEXT =
  `# Quarantine of ${WORD}\n\n` +
  `The ${WORD} tank is kept apart from the main system for fourteen days, and every reading of its water is written to the log before anyone decides to admit it. ` +
  `Nothing from the ${WORD} tank reaches the main system without that record.\n\n` +
  `## Decision\n\n` +
  `A person admits the ${WORD} on the record, by name, or refuses it on the record, by name; the system never admits on its own, and the decision is kept whatever happens to the tank afterwards.`;

const post = (path: string, body: unknown) =>
  new Request(`http://test${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe.skipIf(!DSN)("one corpus per namespace, on a live index", () => {
  let db: typeof import("@/lib/server/knowledge-db");
  let fetchRoute: typeof import("@/app/api/knowledge/fetch/route");
  let admitRoute: typeof import("@/app/api/knowledge/admit/route");
  let documentRoute: typeof import("@/app/api/knowledge/document/route");
  let statusRoute: typeof import("@/app/api/knowledge/route");
  let staleRoute: typeof import("@/app/api/knowledge/stale/route");
  let search: typeof import("@/app/api/knowledge/search/route").search;
  let documentId = "";

  beforeAll(async () => {
    db = await import("@/lib/server/knowledge-db");
    expect(await db.knowledgeReady(), `the index at ${DSN} did not come up`).toBe(true);
    fetchRoute = await import("@/app/api/knowledge/fetch/route");
    admitRoute = await import("@/app/api/knowledge/admit/route");
    documentRoute = await import("@/app/api/knowledge/document/route");
    statusRoute = await import("@/app/api/knowledge/route");
    staleRoute = await import("@/app/api/knowledge/stale/route");
    search = (await import("@/app/api/knowledge/search/route")).search;
    // Both namespaces have a register, so the only difference between them
    // is what was admitted where.
    await db.seedNamespace(NS_A);
    await db.seedNamespace(NS_B);
  }, 60_000);

  afterAll(async () => {
    if (!db) return;
    const both = [NS_A, NS_B];
    await db.kq("DELETE FROM admissions WHERE namespace = ANY($1)", [both]);
    await db.kq("DELETE FROM chunks WHERE namespace = ANY($1)", [both]);
    await db.kq("DELETE FROM sections WHERE namespace = ANY($1)", [both]);
    await db.kq("DELETE FROM documents WHERE namespace = ANY($1)", [both]);
    await db.kq("DELETE FROM sources WHERE namespace = ANY($1)", [both]);
    await db.knowledgeClose();
  });

  it("stages and admits a document in namespace a", async () => {
    const source = SOURCES.find((s) => s.licence === "open" && s.family !== "internal")!;
    const staged = await fetchRoute.POST(post("/api/knowledge/fetch", { source: source.id, namespace: NS_A, title: "Zebrafish", text: TEXT }));
    const s = await staged.json();
    expect(staged.status, JSON.stringify(s)).toBe(200);
    expect(s.staged).toBe(true);
    expect(s.namespace).toBe(NS_A);
    expect(s.chunks).toBeGreaterThan(0);
    documentId = s.document;

    // The same id, named from the other namespace, is not there to admit.
    const wrong = await admitRoute.POST(post("/api/knowledge/admit", { document: documentId, namespace: NS_B, admit: true, by: "tests" }));
    expect(wrong.status).toBe(404);

    const admitted = await admitRoute.POST(post("/api/knowledge/admit", { document: documentId, namespace: NS_A, admit: true, by: "tests", note: "isolation test" }));
    const a = await admitted.json();
    expect(admitted.status, JSON.stringify(a)).toBe(200);
    expect(a.admitted).toBe(true);
    expect(a.namespace).toBe(NS_A);
  }, 60_000);

  it("finds nothing in namespace b", async () => {
    const r = await search({ query: `${WORD} quarantine tank`, namespace: NS_B, rerank: false });
    expect(r.namespace).toBe(NS_B);
    expect(r.stages.dense).toBe(0);
    expect(r.stages.lexical).toBe(0);
    expect(r.hits).toHaveLength(0);
    expect(r.context).toHaveLength(0);
  }, 30_000);

  it("finds the document in namespace a, with every hit and neighbour from it", async () => {
    const r = await search({ query: `${WORD} quarantine tank`, namespace: NS_A, rerank: false });
    expect(r.namespace).toBe(NS_A);
    expect(r.stages.dense).toBeGreaterThan(0);
    expect(r.stages.lexical).toBeGreaterThan(0);
    expect(r.hits.length).toBeGreaterThan(0);
    for (const h of r.hits) expect(h.documentId).toBe(documentId);
    for (const c of r.context) expect(c.document_id).toBe(documentId);
  }, 30_000);

  it("reads the document only from its own namespace", async () => {
    const miss = await documentRoute.GET(new Request(`http://test/api/knowledge/document?id=${documentId}&namespace=${NS_B}`));
    expect(miss.status).toBe(404);
    const hit = await documentRoute.GET(new Request(`http://test/api/knowledge/document?id=${documentId}&namespace=${NS_A}`));
    expect(hit.status).toBe(200);
    const d = await hit.json();
    expect(d.namespace).toBe(NS_A);
    expect(d.status).toBe("admitted");
    expect(d.sections.length).toBeGreaterThan(0);
  });

  it("counts each namespace's own documents, and lists both", async () => {
    const a = await (await statusRoute.GET(new Request(`http://test/api/knowledge?namespace=${NS_A}`))).json();
    const b = await (await statusRoute.GET(new Request(`http://test/api/knowledge?namespace=${NS_B}`))).json();
    expect(a.namespace).toBe(NS_A);
    expect(a.totals.admitted).toBe(1);
    expect(a.totals.chunks).toBeGreaterThan(0);
    expect(b.namespace).toBe(NS_B);
    expect(b.totals.documents).toBe(0);
    expect(b.totals.chunks).toBe(0);
    const list = await (await statusRoute.GET(new Request("http://test/api/knowledge?namespaces=1"))).json();
    expect(list.namespaces).toContain("default");
    expect(list.namespaces).toContain(NS_A);
    expect(list.namespaces).toContain(NS_B);
  }, 30_000);

  it("carries the estate id on every table, defaulted as the backend's are", async () => {
    const cols = await db.kq<{ table_name: string; is_nullable: string; column_default: string }>(
      `SELECT table_name, is_nullable, column_default FROM information_schema.columns
        WHERE table_schema = current_schema() AND column_name = 'estate_id'
          AND table_name IN ('sources', 'documents', 'sections', 'chunks', 'admissions') ORDER BY table_name`,
    );
    expect(cols.map((c) => c.table_name)).toEqual(["admissions", "chunks", "documents", "sections", "sources"]);
    for (const c of cols) expect([c.is_nullable, c.column_default], c.table_name).toEqual(["NO", "'default'::text"]);
    const [doc] = await db.kq<{ estate_id: string }>("SELECT estate_id FROM documents WHERE namespace = $1 AND id = $2", [NS_A, documentId]);
    expect(doc.estate_id).toBe("default");
  });

  it("names the admitted copy stale once a later fetch of its source differs, in its own namespace only", async () => {
    const current = await (await staleRoute.GET(new Request(`http://test/api/knowledge/stale?namespace=${NS_A}`))).json();
    expect(current).toMatchObject({ ready: true, namespaces: [NS_A], checked: 1 });
    expect(current.stale.filter((d: { reasons: { kind: string }[] }) => d.reasons.some((r) => r.kind === "changed"))).toEqual([]);

    const source = SOURCES.find((s) => s.licence === "open" && s.family !== "internal")!;
    const staged = await fetchRoute.POST(post("/api/knowledge/fetch", { source: source.id, namespace: NS_A, title: "Zebrafish, revised", text: `${TEXT}\n\nRevised: the quarantine of the ${WORD} now lasts twenty-one days, and the log is reviewed weekly by a second person.` }));
    expect(staged.status).toBe(200);
    const newer = (await staged.json()).document as string;

    const a = await (await staleRoute.GET(new Request(`http://test/api/knowledge/stale?namespace=${NS_A}&namespace=${NS_B}`))).json();
    const changed = a.stale.find((d: { id: string }) => d.id === documentId);
    expect(changed, JSON.stringify(a)).toBeDefined();
    expect(changed.namespace).toBe(NS_A);
    expect(changed.reasons[0]).toMatchObject({ kind: "changed", newer: { id: newer, status: "staged" } });
    // The other corpus has nothing admitted, so nothing to be stale.
    expect(a.stale.every((d: { namespace: string }) => d.namespace === NS_A)).toBe(true);
  }, 60_000);
});
