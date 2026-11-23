import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { attentionOf, rankOf } from "@/lib/api/l5";
import { ATTENTION_LABEL, attentionVerb, orderAttention } from "@/lib/gates";

/**
 * The attention queue's reading order (lib/gates.ts orderAttention), over
 * a fixture in the shape `GET /api/attention` serves (backend/app/
 * attention.py AttentionItem): seven rows the backend ranked by severity ×
 * age weight, handed over out of order. The panel shows them by rank, the
 * nearer deadline first among equals, then the older row, then the id.
 * tests/l5-contract.test.ts holds the shape itself against a captured
 * response.
 */

const FIXTURE = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "attention.json"), "utf-8")) as { items: unknown[] };

describe("the attention queue", () => {
  const rows = FIXTURE.items.map(attentionOf);

  it("reads the fixture as the five kinds, each with the action that clears it", () => {
    expect(rows.map((r) => r.kind)).toEqual(["health", "gate", "gate", "budget", "dead_letter", "dead_letter", "refusal"]);
    expect(rows.map((r) => r.action.kind)).toEqual(["check", "answer", "answer", "open", "replay", "replay", "open"]);
    expect(rows.map(attentionVerb)).toEqual(["Re-check", "Answer", "Answer", "Open", "Replay", "Replay", "Open"]);
    expect(rows.map((r) => ATTENTION_LABEL[r.kind])).toEqual(["health", "gate", "gate", "budget", "dead letter", "dead letter", "refusal"]);
  });

  it("orders by rank, then the nearer deadline, then age, then id", () => {
    // Shuffled on purpose: the backend's order is not relied on.
    const shuffled = [rows[6], rows[3], rows[1], rows[0], rows[5], rows[4], rows[2]];
    expect(orderAttention(shuffled).map((r) => r.id)).toEqual([
      "refusal:harbor-0440", // rank 12
      "gate:counsel-0017", // rank 9.38, deadline 10:30
      "gate:harbor-0442", // rank 9.38, deadline 10:45
      "budget", // rank 8, no deadline, as old as the next: by id
      "health:telemetry", // rank 8
      "dead_letter:job-9a1", // rank 6, older (50 h)
      "dead_letter:job-7c2", // rank 6, 48 h
    ]);
  });

  it("does not reorder the input", () => {
    const before = rows.map((r) => r.id);
    orderAttention(rows);
    expect(rows.map((r) => r.id)).toEqual(before);
  });

  it("carries what a gate holds, its deadline, and the door or page that clears each row", () => {
    const gate = rows.find((r) => r.id === "gate:counsel-0017")!;
    expect(gate.holds).toBe("write");
    expect(gate.deadline).toBe("2026-10-21T10:30:00Z");
    expect(gate.run).toBe("counsel-0017");
    expect(gate.action).toMatchObject({ method: "POST", path: "/api/approvals/counsel-0017" });
    const dead = rows.find((r) => r.id === "dead_letter:job-9a1")!;
    expect(dead.job).toBe("job-9a1");
    expect(dead.run).toBeNull();
    expect(dead.holds).toBe("");
    expect(dead.action).toMatchObject({ method: "POST", path: "/api/queue/jobs/job-9a1/replay", body: null });
    expect(rows.find((r) => r.kind === "budget")!.action.href).toBe("/finops");
    // A refusal's door starts the run again; the queue opens the run instead.
    const refusal = rows.find((r) => r.kind === "refusal")!;
    expect(refusal.action.href).toBeUndefined();
    expect(refusal.action.says).toContain("review the refusal");
  });

  it("fills in what a sparse row leaves out: an id, the backend's rank, an action from the kind", () => {
    const r = attentionOf({ kind: "dead_letter", job: "j-1", agent: "harbor", severity: 2, age_s: 10 });
    expect(r.id).toBe("dead_letter:j-1");
    expect(r.rank).toBe(rankOf(2, 10));
    expect(rankOf(2, 10)).toBe(2);
    expect(rankOf(6, 86400)).toBe(12);
    expect(rankOf(2, 200 * 3600)).toBe(6); // the age weight stops at 48 h
    // No door named: nothing is called, the row only opens.
    expect(r.action.kind).toBe("open");
    expect(attentionOf({ kind: "gate", run: "r-1", agent: "a" }).action.kind).toBe("answer");
    expect(attentionOf({ kind: "nonsense", agent: "a" }).kind).toBe("health");
  });
});
