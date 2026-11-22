import { describe, expect, it } from "vitest";
import { DEFAULT_NAMESPACE, NAMESPACE_RE, parseNamespace } from "@/lib/knowledge";
import { adjacentQuery, denseQuery, lexicalQuery, staleQuery } from "@/lib/server/knowledge-sql";

/**
 * Namespace isolation, proved without a database.
 *
 * Retrieval is where a leak would be silent, so the statements in
 * lib/server/knowledge-sql.ts are built as pure functions and read here:
 * every one carries `namespace = $n` with the namespace in that parameter
 * slot, and its joins match on namespace too. The knowledge addresses
 * themselves are answered by the platform service, which holds its own
 * queries to the same rule (dev/smoke/knowledge.py there).
 */

const NS = "engagement-7";

/** The placeholder the namespace predicate names, and the value in that slot. */
function namespaceSlot(sql: string, params: unknown[]): unknown {
  const m = sql.match(/\bnamespace = \$(\d+)/);
  expect(m, `no "namespace = $n" predicate in:\n${sql}`).not.toBeNull();
  return params[Number(m![1]) - 1];
}

/** Every $n in the statement has a parameter, and every parameter is used. */
function placeholdersMatch(sql: string, params: unknown[]): void {
  const used = new Set([...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
  expect(Math.max(...used)).toBe(params.length);
  for (let i = 1; i <= params.length; i++) expect(used.has(i), `$${i} is passed but never used`).toBe(true);
}

describe("the namespace rule", () => {
  it("defaults when nothing is named, and only then", () => {
    expect(parseNamespace(undefined)).toBe(DEFAULT_NAMESPACE);
    expect(parseNamespace(null)).toBe(DEFAULT_NAMESPACE);
    expect(parseNamespace("")).toBe(DEFAULT_NAMESPACE);
    expect(parseNamespace("   ")).toBe(DEFAULT_NAMESPACE);
    expect(parseNamespace(" acme-2026 ")).toBe("acme-2026");
    expect(parseNamespace("a")).toBe("a");
    expect(parseNamespace("7up")).toBe("7up");
    expect(parseNamespace("a".repeat(63))).toBe("a".repeat(63));
  });

  it("refuses anything outside ^[a-z0-9][a-z0-9-]{0,62}$", () => {
    for (const bad of ["-lead", "Upper", "with space", "under_score", "dot.ted", "a".repeat(64), "sl/ash", "é", "a;drop"]) {
      expect(parseNamespace(bad), bad).toBeNull();
      expect(NAMESPACE_RE.test(bad), bad).toBe(false);
    }
  });
});

describe("the search statements", () => {
  const vector = [0.1, 0.2, 0.3];

  for (const scoped of [null, ["owasp-top10", "nist-800-53"]]) {
    const label = scoped ? "scoped to sources" : "unscoped";

    it(`dense, ${label}: filters chunks on the namespace and joins on it`, () => {
      const q = denseQuery(NS, vector, 20, scoped);
      expect(namespaceSlot(q.sql, q.params)).toBe(NS);
      expect(q.sql).toMatch(/\bc\.namespace = \$\d+/);
      expect(q.sql).toMatch(/JOIN sources s ON s\.namespace = c\.namespace AND s\.id = c\.source_id/);
      expect(q.sql).toMatch(/JOIN documents d ON d\.namespace = c\.namespace AND d\.id = c\.document_id/);
      expect(q.sql).toContain("d.status = 'admitted'");
      expect(q.sql).toContain("s.enabled");
      expect(q.sql.includes("c.source_id = ANY(")).toBe(Boolean(scoped));
      placeholdersMatch(q.sql, q.params);
      expect(q.params).toContain("[0.1,0.2,0.3]");
    });

    it(`lexical, ${label}: filters chunks on the namespace and joins on it`, () => {
      const q = lexicalQuery(NS, "prompt | injection", 20, scoped);
      expect(namespaceSlot(q.sql, q.params)).toBe(NS);
      expect(q.sql).toMatch(/\bc\.namespace = \$\d+/);
      expect(q.sql).toMatch(/JOIN sources s ON s\.namespace = c\.namespace AND s\.id = c\.source_id/);
      expect(q.sql).toMatch(/JOIN documents d ON d\.namespace = c\.namespace AND d\.id = c\.document_id/);
      expect(q.sql).toContain("d.status = 'admitted'");
      expect(q.sql.includes("c.source_id = ANY(")).toBe(Boolean(scoped));
      placeholdersMatch(q.sql, q.params);
      expect(q.params).toContain("prompt | injection");
    });
  }

  it("adjacency: filters on the namespace before the (document, ordinal) pairs", () => {
    for (const n of [1, 3]) {
      const pairs = Array.from({ length: n }, (_, i) => ({ document_id: `doc-${i}`, ordinal: i + 1 }));
      const q = adjacentQuery(NS, pairs);
      expect(namespaceSlot(q.sql, q.params)).toBe(NS);
      expect(q.sql).toMatch(/WHERE namespace = \$1 AND \(document_id, ordinal\) IN \(/);
      placeholdersMatch(q.sql, q.params);
      expect(q.params.slice(1)).toEqual(pairs.flatMap((p) => [p.document_id, p.ordinal]));
    }
  });

  it("puts the namespace in the first slot of every statement", () => {
    for (const q of [denseQuery(NS, vector, 5, null), lexicalQuery(NS, "x", 5, null), adjacentQuery(NS, [{ document_id: "d", ordinal: 0 }]), staleQuery(NS)]) {
      expect(q.params[0]).toBe(NS);
    }
  });

  it("staleness: reads one namespace's admitted documents, its catalogue and its own later fetches", () => {
    const q = staleQuery(NS);
    expect(namespaceSlot(q.sql, q.params)).toBe(NS);
    expect(q.sql).toMatch(/WHERE d\.namespace = \$1 AND d\.status = 'admitted'/);
    // The source and the later fetch are this corpus's, never another engagement's copy.
    expect(q.sql).toMatch(/JOIN sources s ON s\.namespace = d\.namespace AND s\.id = d\.source_id/);
    expect(q.sql).toMatch(/x\.namespace = d\.namespace AND x\.source_id = d\.source_id/);
    expect(q.sql).toContain("x.fetched_at > d.fetched_at");
    placeholdersMatch(q.sql, q.params);
  });
});
