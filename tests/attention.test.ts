import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { attentionOf } from "@/lib/api/l5";
import { ATTENTION_LABEL, attentionVerb, orderAttention } from "@/lib/gates";

/**
 * The attention queue's reading order (lib/gates.ts orderAttention), over
 * a fixture shaped like `GET /api/attention`: six rows the backend ranked
 * by severity × age, handed over out of order. The panel shows them by rank,
 * the nearer deadline first among equals, then the older row.
 */

const FIXTURE = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "attention.json"), "utf-8")) as { items: unknown[] };

describe("the attention queue", () => {
  const rows = FIXTURE.items.map(attentionOf);

  it("reads the fixture as the six kinds, each with the action that clears it", () => {
    expect(rows.map((r) => r.kind)).toEqual(["health", "gate", "gate", "budget", "dead_letter", "refusal"]);
    expect(rows.map((r) => r.action.kind)).toEqual(["acknowledge", "answer", "answer", "open", "replay", "open"]);
    expect(rows.map(attentionVerb)).toEqual(["Acknowledge", "Answer", "Answer", "Open", "Replay", "Open"]);
    expect(rows.map((r) => ATTENTION_LABEL[r.kind])).toEqual(["health", "gate", "gate", "budget", "dead letter", "refusal"]);
  });

  it("orders by rank, then the nearer deadline, then age", () => {
    // Shuffled on purpose: the backend's order is not relied on.
    const shuffled = [rows[5], rows[3], rows[1], rows[0], rows[4], rows[2]];
    expect(orderAttention(shuffled).map((r) => r.id)).toEqual([
      "health:soc-stub", // rank 21600
      "gate:run-counsel-0017", // rank 14400, deadline 10:30
      "gate:run-aegis-0442", // rank 14400, deadline 12:00
      "dead_letter:job-9a1", // rank 3000, older (1500 s)
      "budget:aegis", // rank 3000, newer (600 s)
      "refusal:run-aegis-0440", // rank 900
    ]);
  });

  it("does not reorder the input", () => {
    const before = rows.map((r) => r.id);
    orderAttention(rows);
    expect(rows.map((r) => r.id)).toEqual(before);
  });

  it("carries the blast radius and deadline the backend laid out", () => {
    const gate = rows.find((r) => r.id === "gate:run-aegis-0442")!;
    expect(gate.blast_radius).toEqual({ sinks: 2, risk: "destructive", agents: 1 });
    expect(gate.deadline).toBe("2026-10-21T12:00:00Z");
    expect(gate.run).toBe("run-aegis-0442");
    const dead = rows.find((r) => r.id === "dead_letter:job-9a1")!;
    expect(dead.job).toBe("job-9a1");
    expect(dead.blast_radius).toBeNull();
  });

  it("fills in what a sparse row leaves out: an id, a rank from severity × age, an action from the kind", () => {
    const r = attentionOf({ kind: "dead_letter", job: "j-1", agent: "aegis", severity: 2, age_s: 10 });
    expect(r.id).toBe("dead_letter:j-1");
    expect(r.rank).toBe(20);
    expect(r.action.kind).toBe("replay");
    expect(attentionOf({ kind: "gate", run: "r-1", agent: "a" }).action.kind).toBe("answer");
    expect(attentionOf({ kind: "nonsense", agent: "a" }).kind).toBe("health");
  });
});
