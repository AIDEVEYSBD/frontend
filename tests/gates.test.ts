import { describe, expect, it } from "vitest";
import { SAMPLE_SIZE, allowedVerdicts, batchCount, batchable, bulkVerdict, checkField, countdown, emptyForm, gateAccess, nextSample, sampleGates, validateForm, validateVerdicts } from "@/lib/gates";
import { deadlineOf, gateFromSuspension, gateOf, itemOf, type Gate, type GateField, type VerdictItem } from "@/lib/api/l5";

/**
 * What the console decides about a gate before the backend does
 * (lib/gates.ts): a form checked by kind, the verdicts an item may still
 * take, who may press Submit, and how a gate row is normalised from the
 * inbox. The backend validates again on resume; these are the rules the
 * dialog applies first.
 */

const FIELDS: GateField[] = [
  { name: "approved", kind: "bool", required: true },
  { name: "note", kind: "string" },
  { name: "amount", kind: "number", required: true },
  { name: "residual_risk", kind: "choice", choices: ["low", "medium", "high"], required: true },
  { name: "owners", kind: "list", required: true },
  { name: "extra", kind: "object" },
];

describe("form validation by kind", () => {
  it("starts empty: text for text, nothing for bool and choice, an empty list for list", () => {
    expect(emptyForm(FIELDS)).toEqual({ approved: undefined, note: "", amount: "", residual_risk: undefined, owners: [], extra: "" });
  });

  it("string: required needs text; optional blank is omitted; whitespace is trimmed", () => {
    expect(checkField({ name: "x", kind: "string", required: true }, "  ")).toEqual({ error: "x is required" });
    expect(checkField({ name: "x", kind: "string" }, "")).toEqual({});
    expect(checkField({ name: "x", kind: "string" }, "  hello ")).toEqual({ value: "hello" });
  });

  it("number: must parse as a finite number", () => {
    expect(checkField({ name: "amount", kind: "number", required: true }, "")).toEqual({ error: "amount is required" });
    expect(checkField({ name: "amount", kind: "number" }, "12.5")).toEqual({ value: 12.5 });
    expect(checkField({ name: "amount", kind: "number" }, "twelve")).toEqual({ error: "amount must be a number" });
    expect(checkField({ name: "amount", kind: "number" }, "Infinity")).toEqual({ error: "amount must be a number" });
  });

  it("bool: required needs an explicit yes or no; optional unset is omitted", () => {
    expect(checkField({ name: "approved", kind: "bool", required: true }, undefined)).toEqual({ error: "approved needs a yes or a no" });
    expect(checkField({ name: "approved", kind: "bool", required: true }, false)).toEqual({ value: false });
    expect(checkField({ name: "approved", kind: "bool" }, undefined)).toEqual({});
  });

  it("choice: must be one of the choices", () => {
    const f: GateField = { name: "residual_risk", kind: "choice", choices: ["low", "medium", "high"], required: true };
    expect(checkField(f, undefined)).toEqual({ error: "residual_risk needs a choice" });
    expect(checkField(f, "critical")).toEqual({ error: "residual_risk must be one of low, medium, high" });
    expect(checkField(f, "high")).toEqual({ value: "high" });
  });

  it("list: required needs at least one entry; blanks are dropped", () => {
    expect(checkField({ name: "owners", kind: "list", required: true }, [])).toEqual({ error: "owners needs at least one entry" });
    expect(checkField({ name: "owners", kind: "list", required: true }, [" a ", "", "b"])).toEqual({ value: ["a", "b"] });
    expect(checkField({ name: "owners", kind: "list" }, [])).toEqual({ value: [] });
  });

  it("object: valid JSON, an object, not empty when required", () => {
    expect(checkField({ name: "extra", kind: "object" }, "{not json")).toEqual({ error: "extra is not valid JSON" });
    expect(checkField({ name: "extra", kind: "object" }, "[1,2]")).toEqual({ error: "extra must be a JSON object" });
    expect(checkField({ name: "extra", kind: "object", required: true }, "{}")).toEqual({ error: "extra must not be empty" });
    expect(checkField({ name: "extra", kind: "object" }, '{"a": 1}')).toEqual({ value: { a: 1 } });
    expect(checkField({ name: "extra", kind: "object" }, "")).toEqual({});
  });

  it("a whole form: every error named, nothing sent until all pass, optional blanks left out", () => {
    const bad = validateForm(FIELDS, emptyForm(FIELDS));
    expect(bad.ok).toBe(false);
    expect(Object.keys(bad.errors).sort()).toEqual(["amount", "approved", "owners", "residual_risk"]);

    const good = validateForm(FIELDS, { approved: true, note: "", amount: "5000", residual_risk: "low", owners: ["alice"], extra: "" });
    expect(good.ok).toBe(true);
    expect(good.errors).toEqual({});
    expect(good.answer).toEqual({ approved: true, amount: 5000, residual_risk: "low", owners: ["alice"] });
  });
});

const VERDICTS = ["acknowledged", "accepted", "remediated", "disputed", "withdrawn"];
const TRANSITIONS = { accepted: ["remediated", "withdrawn"], disputed: ["accepted", "withdrawn"], remediated: [] as string[] };
const ITEMS: VerdictItem[] = [
  { id: "g-1", title: "Gap 1", verdict: null, fields: {} },
  { id: "g-2", title: "Gap 2", verdict: "accepted", fields: {} },
  { id: "g-3", title: "Gap 3", verdict: "disputed", fields: {} },
  { id: "g-4", title: "Gap 4", verdict: "acknowledged", fields: {} },
  { id: "g-5", title: "Gap 5", verdict: "remediated", fields: {} },
];

describe("verdict transitions", () => {
  it("an item without a verdict may take any", () => {
    expect(allowedVerdicts(null, VERDICTS, TRANSITIONS)).toEqual(VERDICTS);
  });

  it("an item with a verdict may stay, or move where its transitions say", () => {
    expect(allowedVerdicts("accepted", VERDICTS, TRANSITIONS)).toEqual(["accepted", "remediated", "withdrawn"]);
    expect(allowedVerdicts("disputed", VERDICTS, TRANSITIONS)).toEqual(["disputed", "accepted", "withdrawn"]);
  });

  it("a verdict the transitions do not name is unconstrained; an empty list is terminal", () => {
    expect(allowedVerdicts("acknowledged", VERDICTS, TRANSITIONS)).toEqual(VERDICTS);
    expect(allowedVerdicts("remediated", VERDICTS, TRANSITIONS)).toEqual(["remediated"]);
  });

  it("a move the transitions name to a verdict the gate does not offer is dropped", () => {
    expect(allowedVerdicts("accepted", ["accepted", "withdrawn"], TRANSITIONS)).toEqual(["accepted", "withdrawn"]);
  });

  it("every item needs a verdict, each one allowed from where it is", () => {
    const missing = validateVerdicts(ITEMS, VERDICTS, TRANSITIONS, {});
    expect(missing.ok).toBe(false);
    expect(missing.errors).toEqual({ "g-1": "needs a verdict" });

    const bad = validateVerdicts(ITEMS, VERDICTS, TRANSITIONS, { "g-1": "accepted", "g-2": "disputed", "g-5": "accepted" });
    expect(bad.ok).toBe(false);
    expect(bad.errors["g-2"]).toBe("accepted may only move to remediated, withdrawn");
    expect(bad.errors["g-5"]).toBe("remediated may only move to nothing");

    const good = validateVerdicts(ITEMS, VERDICTS, TRANSITIONS, { "g-1": "acknowledged", "g-2": "remediated", "g-3": "accepted" });
    expect(good.ok).toBe(true);
    expect(good.answer).toEqual({ verdicts: { "g-1": "acknowledged", "g-2": "remediated", "g-3": "accepted", "g-4": "acknowledged", "g-5": "remediated" } });
  });

  it("bulk-set moves every item the transitions allow and leaves the rest", () => {
    const next = bulkVerdict(ITEMS, VERDICTS, TRANSITIONS, { "g-3": "accepted" }, "withdrawn");
    expect(next).toEqual({ "g-1": "withdrawn", "g-2": "withdrawn", "g-3": "withdrawn", "g-4": "withdrawn" });
    const stay = bulkVerdict(ITEMS, VERDICTS, TRANSITIONS, {}, "remediated");
    expect(stay).toEqual({ "g-1": "remediated", "g-2": "remediated", "g-4": "remediated", "g-5": "remediated" });
  });
});

describe("who may answer", () => {
  it("a gate with no approvers is anyone's", () => {
    expect(gateAccess({ roles: [], appRoles: ["viewer"] }, [])).toEqual({ ok: true, reason: "" });
  });

  it("a named role in either list passes", () => {
    expect(gateAccess({ roles: ["legal-counsel"], appRoles: ["operator"] }, ["legal-counsel"]).ok).toBe(true);
    expect(gateAccess({ roles: [], appRoles: ["tprm-lead"] }, ["legal-counsel", "tprm-lead"]).ok).toBe(true);
  });

  it("an administrator passes every gate", () => {
    expect(gateAccess({ roles: [], appRoles: ["administrator"] }, ["legal-counsel"]).ok).toBe(true);
  });

  it("nobody else does, and the reason names the approvers and the roles held", () => {
    const a = gateAccess({ roles: ["analyst"], appRoles: ["operator"] }, ["legal-counsel", "vp-procurement"]);
    expect(a.ok).toBe(false);
    expect(a.reason).toBe("Only legal-counsel, vp-procurement may answer this gate (or an administrator). Your roles: analyst, operator.");
    expect(gateAccess({ roles: [], appRoles: [] }, ["legal-counsel"]).reason).toContain("Your roles: none.");
  });

  it("an unknown session cannot answer a gated gate", () => {
    expect(gateAccess(null, ["legal-counsel"]).ok).toBe(false);
    expect(gateAccess(null, []).ok).toBe(true);
  });

  it("a batch must be one agent, one shape, and every gate the person's to answer", () => {
    const base = gateOf({ run: "r-1", agent: "harbor", node: "gate", shape: "decision", approvers: ["tprm-lead"] });
    const two = gateOf({ ...base, run: "r-2" });
    const who = { roles: ["tprm-lead"], appRoles: ["operator"] };
    expect(batchable([base], who).ok).toBe(false);
    expect(batchable([base, two], who).ok).toBe(true);
    expect(batchable([base, gateOf({ ...two, agent: "counsel" })], who).reason).toContain("one agent");
    expect(batchable([base, gateOf({ ...two, shape: "form" })], who).reason).toContain("one shape");
    expect(batchable([base, gateOf({ ...two, approvers: ["legal-counsel"] })], who).reason).toContain("r-2: Only legal-counsel");
  });
});

describe("the gate row, normalised", () => {
  it("defaults every field a form could trip on, and reads the shape from the interface's answer block too", () => {
    const g: Gate = gateOf({ run: "r-1", agent: "harbor", node: "n", answer: { shape: "verdicts", verdicts: ["a", "b"], register: "gaps" }, items: [{ id: "x", severity: "high", verdict: "a" }, "bare"] });
    expect(g.shape).toBe("verdicts");
    expect(g.verdicts).toEqual(["a", "b"]);
    expect(g.register).toBe("gaps");
    expect(g.items).toEqual([
      { id: "x", title: "x", verdict: "a", fields: { severity: "high" } },
      { id: "bare", title: "bare", verdict: null, fields: {} },
    ]);
    expect(g.fields).toEqual([]);
    expect(g.chain).toEqual([]);
    expect(g.external).toEqual({ allowed: false });
    expect(g.evidence).toEqual({ decided: {}, presented: {}, tainted_by: [], trail: [] });
    expect(g.escalations).toBe(0);
    expect(g.next).toEqual({ approve: "", refuse: "" });
    expect(g.deadline).toBeNull();
  });

  it("an item with no id takes its index", () => {
    expect(itemOf({ title: "T" }, 2)).toEqual({ id: "3", title: "T", verdict: null, fields: { title: "T" } });
  });

  it("the deadline is the backend's instant, or waiting_since plus timeout_s", () => {
    expect(deadlineOf("2026-10-21T12:00:00Z", "2026-10-21T09:00:00Z", 3600)).toBe("2026-10-21T12:00:00Z");
    expect(deadlineOf(undefined, "2026-10-21T09:00:00Z", 3600)).toBe("2026-10-21T10:00:00.000Z");
    expect(deadlineOf(undefined, "2026-10-21T09:00:00Z", null)).toBeNull();
  });

  it("older evidence (decided on the row) is laid out as evidence.decided", () => {
    const g = gateOf({ run: "r", agent: "a", node: "n", decided: { disposition: "ESCALATE", risk_score: 0.9 }, escalate_to: ["vp"], external: { allowed: true } });
    expect(g.evidence.decided).toEqual({ disposition: "ESCALATE", risk_score: 0.9 });
    expect(g.chain).toEqual(["vp"]);
    expect(g.external.allowed).toBe(true);
  });

  it("a live run's suspension makes a gate the theater can answer", () => {
    const g = gateFromSuspension("run-9", "harbor", { node: "approve", approvers: ["tprm-lead"], prompt: "Escalate?", deadline: "2026-10-21T12:00:00Z", shape: "decision" });
    expect(g.run).toBe("run-9");
    expect(g.agent).toBe("harbor");
    expect(g.asks).toBe("Escalate?");
    expect(g.approvers).toEqual(["tprm-lead"]);
    expect(g.deadline).toBe("2026-10-21T12:00:00Z");
  });
});

describe("the countdown", () => {
  const now = Date.parse("2026-10-21T10:00:00Z");
  it("reads the time left, flags the last hour, and says overdue", () => {
    expect(countdown("2026-10-23T14:30:00Z", now)).toEqual({ text: "2d 4h", overdue: false, soon: false });
    expect(countdown("2026-10-21T13:12:00Z", now)).toEqual({ text: "3h 12m", overdue: false, soon: false });
    expect(countdown("2026-10-21T10:08:00Z", now)).toEqual({ text: "8m", overdue: false, soon: true });
    expect(countdown("2026-10-21T08:00:00Z", now)).toEqual({ text: "overdue 2h 0m", overdue: true, soon: true });
    expect(countdown(null, now)).toEqual({ text: "no deadline", overdue: false, soon: false });
  });
});

describe("a batch's sample", () => {
  /** A seeded source of randomness (mulberry32), so a sample is repeatable here. */
  const seeded = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const runs = Array.from({ length: 12 }, (_, i) => `run-${String(i + 1).padStart(2, "0")}`);

  it("shows three, picked at random, distinct, in the batch's order", () => {
    expect(SAMPLE_SIZE).toBe(3);
    const s = sampleGates(runs, SAMPLE_SIZE, seeded(7));
    expect(s).toHaveLength(3);
    expect(new Set(s).size).toBe(3);
    expect(s.every((r) => runs.includes(r))).toBe(true);
    expect([...s].sort()).toEqual(s);
    // The same seed, the same sample; another seed, another.
    expect(sampleGates(runs, SAMPLE_SIZE, seeded(7))).toEqual(s);
    expect(sampleGates(runs, SAMPLE_SIZE, seeded(8))).not.toEqual(s);
  });

  it("shows every gate when the batch has three or fewer", () => {
    expect(sampleGates(["a", "b"], SAMPLE_SIZE, seeded(1))).toEqual(["a", "b"]);
    expect(sampleGates(["a", "b", "c"], SAMPLE_SIZE, seeded(1))).toEqual(["a", "b", "c"]);
    expect(nextSample(["a", "b", "c"], ["a", "b", "c"], ["a", "b", "c"], SAMPLE_SIZE, seeded(1))).toEqual({ sample: ["a", "b", "c"], seen: ["a", "b", "c"] });
  });

  it("is not biased to the front of the batch: over many draws every gate is shown about as often", () => {
    const rng = seeded(42);
    const hits = new Map<string, number>(runs.map((r) => [r, 0]));
    for (let i = 0; i < 4000; i++) for (const r of sampleGates(runs, SAMPLE_SIZE, rng)) hits.set(r, hits.get(r)! + 1);
    // 4000 draws × 3 of 12 = 1000 each on average.
    for (const [r, n] of hits) {
      expect(n, r).toBeGreaterThan(850);
      expect(n, r).toBeLessThan(1150);
    }
  });

  it("'show another' shows gates not read yet, until every one has been, then starts a round away from the one on screen", () => {
    const rng = seeded(3);
    let cur = sampleGates(runs, SAMPLE_SIZE, rng);
    let seen = [...cur];
    const rounds: string[][] = [cur];
    for (let i = 0; i < 3; i++) {
      const n = nextSample(runs, cur, seen, SAMPLE_SIZE, rng);
      expect(n.sample.some((r) => seen.includes(r)), `round ${i + 2} repeated a gate before every gate was shown`).toBe(false);
      cur = n.sample;
      seen = n.seen;
      rounds.push(cur);
    }
    // Four samples of three cover all twelve, once each.
    expect(new Set(rounds.flat()).size).toBe(12);
    expect(seen.sort()).toEqual([...runs].sort());
    // Every gate read: the next sample avoids the three on screen.
    const again = nextSample(runs, cur, seen, SAMPLE_SIZE, rng);
    expect(again.sample).toHaveLength(3);
    expect(again.sample.some((r) => cur.includes(r))).toBe(false);
  });

  it("with too few unread gates left, fills the sample from those already read", () => {
    const five = ["a", "b", "c", "d", "e"];
    const n = nextSample(five, ["a", "b", "c"], ["a", "b", "c"], SAMPLE_SIZE, seeded(9));
    expect(n.sample).toHaveLength(3);
    expect(n.sample).toEqual(expect.arrayContaining(["d", "e"]));
    expect(n.seen.sort()).toEqual(five);
  });

  it("counts what the dialog says: the gates, the shared answer's share, those on their own, the sample and what was read", () => {
    expect(batchCount(runs, [], ["run-01", "run-05", "run-09"])).toEqual({ total: 12, shared: 12, own: 0, sampled: 3, seen: 3 });
    expect(batchCount(runs, ["run-02", "run-03", "ghost"], ["run-01", "run-05", "run-09"], ["run-01", "run-05", "run-09", "run-10", "run-11", "run-12"])).toEqual({ total: 12, shared: 10, own: 2, sampled: 3, seen: 6 });
    expect(batchCount(["a", "b"], ["a", "b"], ["a", "b"])).toEqual({ total: 2, shared: 0, own: 2, sampled: 2, seen: 2 });
  });
});
