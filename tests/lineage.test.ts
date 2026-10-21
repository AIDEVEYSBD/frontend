import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lineageOf, taintedEntries, type LineageEntry } from "@/lib/lineage";

/**
 * The taint lineage walk, over the recorded runtime journal in
 * tests/fixtures/watch-journal.json:
 *
 *   r0 ─ n1 ─ c1 ─ t1 (tainted) ─ m1 (taint mark)
 *             │      └───────────── mc1 (model, tainted) ─ c2 (mail.send, sink) ─ d1 (refused: taint)
 *             │                      └─────────────────── d2 (refused: egress)
 *             │                      └─────────────────── d3 (refused: capability)
 *             └─ r1 (run.end)
 *   o1 cites an id the record does not hold.
 */

const FIXTURE = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "watch-journal.json"), "utf-8")) as {
  runtime: { journal: { entries: LineageEntry[] } };
};
const ENTRIES = FIXTURE.runtime.journal.entries;
const ids = (hops: { entry: LineageEntry }[]) => hops.map((h) => h.entry.id);

describe("lineageOf", () => {
  it("walks because backwards from a refusal to the untrusted content and the run start, nearest first, journal order within a hop", () => {
    const l = lineageOf(ENTRIES, "d1");
    expect(l.root?.id).toBe("d1");
    expect(ids(l.upstream)).toEqual(["c2", "mc1", "n1", "t1", "r0", "c1"]);
    expect(l.upstream.map((h) => h.depth)).toEqual([1, 2, 3, 3, 4, 4]);
    expect(l.upstream[0].via).toBe("d1");
    expect(l.upstream.find((h) => h.entry.id === "t1")?.via).toBe("mc1");
    expect(l.taintedUpstream).toBe(true);
    expect(l.downstream).toEqual([]);
    expect(l.missing).toEqual([]);
  });

  it("walks forwards from the tainted tool result to everything it fed, and names the sinks and refusals it reached", () => {
    const l = lineageOf(ENTRIES, "t1");
    expect(ids(l.downstream)).toEqual(["m1", "mc1", "c2", "d2", "d3", "d1"]);
    expect(l.downstream.map((h) => h.depth)).toEqual([1, 1, 2, 2, 2, 3]);
    expect(l.downstream.find((h) => h.entry.id === "d1")?.via).toBe("c2");
    expect(l.sinks.map((e) => e.id)).toEqual(["c2", "d2", "d3", "d1"]);
    expect(ids(l.upstream)).toEqual(["c1", "n1", "r0"]);
  });

  it("reports an id named in because that the record does not hold, instead of dropping it", () => {
    const l = lineageOf(ENTRIES, "o1");
    expect(l.upstream).toEqual([]);
    expect(l.missing).toEqual(["zzz-missing"]);
    expect(l.taintedUpstream).toBe(false);
  });

  it("answers an unknown id with an empty lineage", () => {
    const l = lineageOf(ENTRIES, "nope");
    expect(l.root).toBeNull();
    expect(l.upstream).toEqual([]);
    expect(l.downstream).toEqual([]);
  });

  it("does not loop on a malformed cycle", () => {
    const cyclic: LineageEntry[] = [
      { id: "a", t: 0, kind: "note", because: ["b"] },
      { id: "b", t: 1, kind: "note", because: ["a"] },
      { id: "c", t: 2, kind: "note", because: ["b"] },
    ];
    const l = lineageOf(cyclic, "a");
    expect(ids(l.upstream)).toEqual(["b"]);
    expect(ids(l.downstream)).toEqual(["b", "c"]);
  });

  it("honours the cap in each direction", () => {
    const chain: LineageEntry[] = Array.from({ length: 50 }, (_, i) => ({ id: `e${i}`, t: i, kind: "note", because: i ? [`e${i - 1}`] : [] }));
    const l = lineageOf(chain, "e25", 5);
    expect(l.upstream).toHaveLength(5);
    expect(l.downstream).toHaveLength(5);
    expect(ids(l.upstream)).toEqual(["e24", "e23", "e22", "e21", "e20"]);
    expect(ids(l.downstream)).toEqual(["e26", "e27", "e28", "e29", "e30"]);
  });
});

describe("taintedEntries", () => {
  it("is what the transcript's Taints filter lists: marks and everything carrying taint", () => {
    expect(taintedEntries(ENTRIES).map((e) => e.id)).toEqual(["t1", "m1", "mc1", "c2", "d1", "d2"]);
  });
});
