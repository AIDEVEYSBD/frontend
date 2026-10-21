import { describe, expect, it } from "vitest";
import { canonical, indexDigest } from "@/lib/server/knowledge-digest";

/**
 * The index-integrity digest: the same namespace state yields the same
 * digest whatever order the rows arrive in, and any change to what is
 * admitted, how many chunks it holds or which admissions exist changes it.
 */

const BASE = { namespace: "default", documents: [{ id: "nist-800-53-v5", chunks: 412 }, { id: "owasp-llm-2026", chunks: 38 }], admissions: [1, 2, 3] };

describe("indexDigest", () => {
  it("is a sha256 hex string over the canonical form", () => {
    expect(indexDigest(BASE)).toMatch(/^[a-f0-9]{64}$/);
    expect(canonical(BASE)).toBe('{"namespace":"default","documents":[{"id":"nist-800-53-v5","chunks":412},{"id":"owasp-llm-2026","chunks":38}],"admissions":["1","2","3"]}');
  });

  it("ignores row order and the types the database hands back", () => {
    const shuffled = { namespace: "default", documents: [{ id: "owasp-llm-2026", chunks: "38" as unknown as number }, { id: "nist-800-53-v5", chunks: 412 }], admissions: ["3", 1, "2"] };
    expect(indexDigest(shuffled)).toBe(indexDigest(BASE));
  });

  it("changes when a document, a chunk count, an admission or the namespace changes", () => {
    const d = indexDigest(BASE);
    expect(indexDigest({ ...BASE, documents: [BASE.documents[0]] })).not.toBe(d);
    expect(indexDigest({ ...BASE, documents: [BASE.documents[0], { id: "owasp-llm-2026", chunks: 37 }] })).not.toBe(d);
    expect(indexDigest({ ...BASE, admissions: [1, 2] })).not.toBe(d);
    expect(indexDigest({ ...BASE, admissions: [1, 2, 3, 4] })).not.toBe(d);
    expect(indexDigest({ ...BASE, namespace: "acme" })).not.toBe(d);
  });
});
