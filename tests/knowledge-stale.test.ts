import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Plan L4: "the per-application view shows hit rate, unanswerable questions,
 * stale documents and grounding rate". What stale means is
 * lib/knowledge-stale.ts: an admitted copy is behind its source when a later
 * fetch of the same source differs from it, when the catalogue moved the
 * source's address, or when it is older than the source's cadence allows.
 * The route reads one namespace per statement (held to the namespace rule in
 * tests/knowledge-namespace.test.ts); here the index is stubbed, and
 * tests/knowledge-db.test.ts runs the same route against a live one.
 */

let ready = true;
const asked: { sql: string; params: unknown[] }[] = [];
let byNamespace: Record<string, Record<string, unknown>[]> = {};

vi.mock("@/lib/server/knowledge-db", () => ({
  knowledgeReady: async () => ready,
  kq: async (sql: string, params: unknown[] = []) => {
    asked.push({ sql, params });
    return byNamespace[String(params[0])] ?? [];
  },
}));
vi.mock("@/lib/server/auth", () => ({ permit: async () => null }));

import { cadenceDays, corporaOf, staleDocuments, stalenessOf, type AdmittedCopy, type StaleReport } from "@/lib/knowledge-stale";
import { DEFAULT_NAMESPACE, SOURCES } from "@/lib/knowledge";
import { GET } from "@/app/api/knowledge/stale/route";

const NOW = Date.parse("2026-10-21T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const copy = (over: Partial<AdmittedCopy> = {}): AdmittedCopy => ({
  id: "doc-1",
  namespace: "default",
  source_id: "nvd",
  source: "National Vulnerability Database",
  title: "NVD feed",
  url: "https://services.nvd.nist.gov/rest/json/cves/2.0",
  source_url: "https://services.nvd.nist.gov/rest/json/cves/2.0",
  cadence: "Monthly",
  fetched_at: daysAgo(3),
  decided_at: daysAgo(3),
  newer: null,
  ...over,
});

beforeEach(() => {
  ready = true;
  asked.length = 0;
  byNamespace = {};
});

describe("what a cadence allows", () => {
  it("reads the periods the catalogue names, and no age for a cadence without one", () => {
    expect([cadenceDays("Daily"), cadenceDays("Weekly"), cadenceDays("Monthly"), cadenceDays("Quarterly"), cadenceDays("Twice a year"), cadenceDays("Annual")]).toEqual([1, 7, 31, 92, 183, 366]);
    // A continuous feed counts as weekly.
    expect(cadenceDays("Continuous")).toBe(7);
    for (const c of ["Major revisions", "On amendment", "Periodic", "On circular", "Revisions", "Revisions and errata", "On revision", "On release", "Every few years", ""]) expect(cadenceDays(c), c).toBeNull();
  });

  it("knows every cadence in the catalogue, either as a period or as none", () => {
    const named = new Set(SOURCES.map((s) => s.cadence));
    const periods = [...named].filter((c) => cadenceDays(c) !== null).sort();
    expect(periods).toEqual(["Annual", "Continuous", "Daily", "Monthly", "Quarterly", "Twice a year"]);
  });
});

describe("whether a copy is stale against its source", () => {
  it("a current copy has nothing to say", () => {
    expect(stalenessOf(copy(), NOW)).toEqual([]);
  });

  it("changed: a later fetch differs, waiting for review or refused", () => {
    const waiting = stalenessOf(copy({ newer: { id: "doc-2", status: "staged", fetched_at: daysAgo(1) } }), NOW);
    expect(waiting).toEqual([{ kind: "changed", detail: "the source has changed: a later fetch (2026-10-20) differs from this copy and is waiting for review", newer: { id: "doc-2", status: "staged", fetched_at: daysAgo(1) } }]);
    const refused = stalenessOf(copy({ newer: { id: "doc-3", status: "rejected", fetched_at: daysAgo(2) } }), NOW);
    expect(refused[0].detail).toBe("the source has changed: a later fetch (2026-10-19) differs from this copy and was refused, so the corpus keeps this older text");
  });

  it("moved: the catalogue now fetches the source from elsewhere (a list of addresses compared as a list)", () => {
    expect(stalenessOf(copy({ source_url: "https://example.org/new" }), NOW).map((r) => r.kind)).toEqual(["moved"]);
    expect(stalenessOf(copy({ url: "https://a  https://b", source_url: "https://a https://b" }), NOW)).toEqual([]);
    // A source the catalogue no longer has an address for says nothing about where it moved.
    expect(stalenessOf(copy({ source_url: "" }), NOW)).toEqual([]);
  });

  it("overdue: older than the cadence allows; a cadence without a period never is", () => {
    const old = stalenessOf(copy({ fetched_at: daysAgo(40) }), NOW);
    expect(old).toEqual([{ kind: "overdue", detail: "fetched 40 days ago; the publisher changes it monthly, so a copy is due every 31 days", age_days: 40, limit_days: 31 }]);
    expect(stalenessOf(copy({ fetched_at: daysAgo(31) }), NOW)).toEqual([]);
    expect(stalenessOf(copy({ cadence: "Major revisions", fetched_at: daysAgo(900) }), NOW)).toEqual([]);
    expect(stalenessOf(copy({ cadence: "Continuous", fetched_at: daysAgo(8) }), NOW).map((r) => r.kind)).toEqual(["overdue"]);
  });

  it("lists the stale ones only, most certain first: changed, then moved, then the most overdue", () => {
    const list = staleDocuments(
      [
        copy({ id: "current" }),
        copy({ id: "overdue-a", fetched_at: daysAgo(45) }),
        copy({ id: "overdue-b", fetched_at: daysAgo(90) }),
        copy({ id: "moved", source_url: "https://example.org/new" }),
        copy({ id: "changed", newer: { id: "n", status: "staged", fetched_at: daysAgo(1) } }),
      ],
      NOW,
    );
    expect(list.map((d) => d.id)).toEqual(["changed", "moved", "overdue-b", "overdue-a"]);
    expect(list.find((d) => d.id === "overdue-b")!.age_days).toBe(90);
  });
});

describe("the corpora an application reads", () => {
  it("as the retrieval door decides: the namespaces its policy lists; a RAG app listing none, the default; anything else listing none, nothing", () => {
    expect(corporaOf({ class: "rag", policy: { namespaces: ["acme-2026", " acme-2026 ", "default"] } })).toEqual(["acme-2026", "default"]);
    expect(corporaOf({ class: "rag", policy: { namespaces: [] } })).toEqual([DEFAULT_NAMESPACE]);
    expect(corporaOf({ class: "chatbot", policy: { namespaces: ["hr"] } })).toEqual(["hr"]);
    expect(corporaOf({ class: "chatbot", policy: { namespaces: [] } })).toEqual([]);
    expect(corporaOf({ class: "agent", policy: { namespaces: [] } })).toEqual([]);
  });
});

/** The row the route's statement answers, for one admitted document. */
const row = (id: string, namespace: string, over: Record<string, unknown> = {}) => ({
  id,
  namespace,
  source_id: "nvd",
  source: "National Vulnerability Database",
  title: `${id} title`,
  url: "https://nvd.example/feed",
  source_url: "https://nvd.example/feed",
  cadence: "Continuous",
  fetched_at: new Date(Date.now() - 2 * 86_400_000),
  decided_at: new Date(Date.now() - 2 * 86_400_000),
  newer_id: null,
  newer_status: null,
  newer_fetched_at: null,
  ...over,
});

const read = async (qs: string) => {
  const res = await GET(new Request(`http://test/api/knowledge/stale${qs}`));
  return { status: res.status, body: (await res.json()) as StaleReport & { error?: string } };
};

describe("GET /api/knowledge/stale", () => {
  it("reads each namespace on its own statement and answers the stale copies across them", async () => {
    byNamespace = {
      default: [row("doc-a", "default"), row("doc-b", "default", { newer_id: "doc-c", newer_status: "staged", newer_fetched_at: new Date() })],
      "acme-2026": [row("doc-d", "acme-2026", { fetched_at: new Date(Date.now() - 30 * 86_400_000) })],
    };
    const { status, body } = await read("?namespace=default&namespace=acme-2026");
    expect(status).toBe(200);
    expect(body).toMatchObject({ ready: true, namespaces: ["default", "acme-2026"], checked: 3 });
    expect(body.stale.map((d) => [d.id, d.namespace, d.reasons.map((r) => r.kind)])).toEqual([
      ["doc-b", "default", ["changed"]],
      ["doc-d", "acme-2026", ["overdue"]],
    ]);
    expect(asked.map((q) => q.params)).toEqual([["default"], ["acme-2026"]]);
    expect(body.basis).toContain("admitted documents only");
  });

  it("no namespace named is the default; a bad one is refused before anything is read", async () => {
    await read("");
    expect(asked.map((q) => q.params)).toEqual([["default"]]);
    asked.length = 0;
    const bad = await read("?namespace=Bad%20One");
    expect(bad.status).toBe(400);
    expect(asked).toEqual([]);
  });

  it("an unreachable index answers that the count is unknown, never zero", async () => {
    ready = false;
    const { status, body } = await read("?namespace=default");
    expect(status).toBe(200);
    expect(body).toMatchObject({ ready: false, checked: 0, stale: [] });
    expect(body.error).toMatch(/unknown/);
  });
});
