import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_NAMESPACE, NAMESPACE_RE, parseNamespace } from "@/lib/knowledge";
import { adjacentQuery, denseQuery, lexicalQuery } from "@/lib/server/knowledge-sql";
import { FRONTEND } from "./routes";

/**
 * Namespace isolation, proved without a database.
 *
 * Retrieval is where a leak would be silent, so the statements the search
 * route runs are built as pure functions and read here: every one carries
 * `namespace = $n` with the namespace in that parameter slot, and its joins
 * match on namespace too. The second half reads every knowledge route's
 * source and holds every statement passed to kq() to the word, so a query
 * added without the predicate fails here before it ships.
 * tests/knowledge-db.test.ts proves the same thing against a live index.
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
    for (const q of [denseQuery(NS, vector, 5, null), lexicalQuery(NS, "x", 5, null), adjacentQuery(NS, [{ document_id: "d", ordinal: 0 }])]) {
      expect(q.params[0]).toBe(NS);
    }
  });
});

describe("every knowledge route's statements", () => {
  const dir = path.join(FRONTEND, "app", "api", "knowledge");
  const files = (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => path.basename(f) === "route.ts")
    .map((f) => path.join("app", "api", "knowledge", f).split(path.sep).join("/"))
    .sort();

  it("finds the routes", () => {
    expect(files).toEqual([
      "app/api/knowledge/admit/route.ts",
      "app/api/knowledge/answer/route.ts",
      "app/api/knowledge/document/route.ts",
      "app/api/knowledge/fetch/route.ts",
      "app/api/knowledge/reembed/route.ts",
      "app/api/knowledge/route.ts",
      "app/api/knowledge/search/route.ts",
    ]);
  });

  // The search route builds its statements in lib/server/knowledge-sql.ts
  // (held above); every other route writes its SQL inline, and each of those
  // statements names the namespace column.
  for (const file of files) {
    it(`${file}: every statement passed to kq() names the namespace`, () => {
      const text = readFileSync(path.join(FRONTEND, file), "utf-8");
      const calls = [...text.matchAll(/\bkq(?:<[\s\S]*?>)?\(\s*(`[\s\S]*?`|"(?:[^"\\]|\\.)*")/g)];
      const builders = (text.match(/\b(?:denseQuery|lexicalQuery|adjacentQuery)\(/g) ?? []).length;
      expect(calls.length + builders, `${file} runs no SQL?`).toBeGreaterThan(0);
      for (const [, sql] of calls) {
        expect(sql, `${file}:\n${sql}`).toMatch(/\bnamespace\b/);
      }
    });
  }
});
