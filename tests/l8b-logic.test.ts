import { afterEach, describe, expect, it, vi } from "vitest";
import * as l5 from "@/lib/api/l5";
import * as l8b from "@/lib/api/l8b";
import {
  armRows,
  canaryBody,
  canaryConditionRows,
  canaryErrorText,
  canaryHeadline,
  canaryProblem,
  canaryRefusalText,
  canaryRunLine,
  conditionSays,
  outcomeLabel,
  pendingSkippedText,
  productionMoved,
  rateText,
  runMarkersOf,
  shareOf,
  shareText,
  wouldCallLine,
  wouldCallOf,
} from "@/lib/canary";
import { certifiedLine, certifyAccess, cutBody, cutParamsLine, cutProblem, driftLine, lineageLine, paramFields, paramsLine, templateLine, templateRefusalText, templateStateMeta } from "@/lib/templates";
import {
  deliverableQuery,
  deliverableStateMeta,
  fileLine,
  fileName,
  fileRefusalText,
  gateDeliverableLine,
  historyLine,
  registerItemLine,
  registerLine,
  reportGateNote,
  sinkOfAsk,
  sizeText,
  statesLine,
} from "@/lib/deliverables";
import { canaryArmOf, jobLine } from "@/lib/queue";
import { canaryAssignmentOf, pastOf, pausedLine, runFlagsOf, spineHeadline, spineOf } from "@/lib/lifecycle";
import { isShadow, productionRuns, shadowBesideLine, shadowRuns, shadowSpentLine, shadowSummary, spendSplit } from "@/lib/production";
import { mergeSetRows, type SetRow } from "@/lib/evals";

/**
 * What the console decides about the second round's L8 shapes on its own,
 * held without a browser and without a backend: what production's figures
 * count (a shadow run counts toward none of them), the canary's form and
 * report in words, a run's marks, a shadow's would-call entries, templates
 * (params, the cut, certification), deliverables and registers in words, a
 * job's canary arm, the spine's canary stage and `current`, the paused
 * refusal, the eval sets merged with the console's scores, and the client's
 * defensive reading and request building. tests/l8b-contract.test.ts holds
 * the same functions against the backend's captured answers.
 */

afterEach(() => vi.unstubAllGlobals());

const usd = (n: number) => `$${n.toFixed(2)}`;

describe("what production's figures count", () => {
  const rows = [
    { id: "p1", shadow: false, cost: 1, estimated: 0, at: "2026-10-21T10:00:00Z" },
    { id: "s1", shadow: true, cost: 5, estimated: 2, at: "2026-10-21T11:00:00Z" },
    { id: "p2", cost: 2, estimated: 1, at: "2026-10-21T12:00:00Z" },
    { id: "old", shadow: true, cost: 9, estimated: 0, at: "2026-10-01T00:00:00Z" },
  ];

  it("a shadow is only what its record says it is; production is everything else", () => {
    expect([isShadow({ shadow: true }), isShadow({ shadow: "true" }), isShadow({}), isShadow(null), isShadow(undefined)]).toEqual([true, false, false, false, false]);
    expect(productionRuns(rows).map((r) => r.id)).toEqual(["p1", "p2"]);
    expect(shadowRuns(rows).map((r) => r.id)).toEqual(["s1", "old"]);
  });

  it("the budget's split over a window: spent and unpriced from production only, the shadows' spend beside it", () => {
    expect(spendSplit(rows, new Date("2026-10-21T00:00:00Z"))).toEqual({ spent: 3, unpriced: 1, shadow_spent: 5, shadow_runs: 1 });
    expect(spendSplit(rows, new Date("2026-10-21T11:30:00Z"))).toEqual({ spent: 2, unpriced: 1, shadow_spent: 0, shadow_runs: 0 });
    expect(spendSplit([], new Date())).toEqual({ spent: 0, unpriced: 0, shadow_spent: 0, shadow_runs: 0 });
  });

  it("the shadows beside a figure, in a line; nothing when there are none", () => {
    expect(shadowSummary(rows)).toEqual({ runs: 2, cost: 14, ids: ["s1", "old"] });
    expect(shadowSummary(rows, new Date("2026-10-20T00:00:00Z"))).toEqual({ runs: 1, cost: 5, ids: ["s1"] });
    expect(shadowBesideLine({ runs: 1, cost: 5 }, usd)).toBe("1 shadow run ($5.00) left out: a canary's mirrors are not production's work");
    expect(shadowBesideLine({ runs: 2, cost: 14 }, usd)).toBe("2 shadow runs ($14.00) left out: a canary's mirrors are not production's work");
    expect(shadowBesideLine({ runs: 0, cost: 0 }, usd)).toBe("");
    expect([shadowSpentLine(0.5, usd), shadowSpentLine(0, usd), shadowSpentLine(undefined, usd), shadowSpentLine(null, usd)]).toEqual(["beside it, not in it: $0.50 spent by a canary's shadow runs", "", "", ""]);
  });
});

describe("the canary's form", () => {
  const now = Date.parse("2026-10-21T12:00:00Z");

  it("the share is a percentage in (0, 100], as typed; the door takes the fraction", () => {
    expect(["10", "10%", " 12.5 ", "100", "0.1", "50 %"].map(shareOf)).toEqual([0.1, 0.1, 0.125, 1, 0.001, 0.5]);
    expect(["0", "101", "-5", "abc", "", "1e2", "10.5.1"].map(shareOf)).toEqual([null, null, null, null, null, null, null]);
    expect([shareText(0.5), shareText(1), shareText(0.125), shareText(0.001)]).toEqual(["50%", "100%", "12.5%", "0.1%"]);
  });

  it("what the backend would refuse, before anything is sent", () => {
    const f = { version: 2, share: "10", mode: "shadow" as const, until: "" };
    expect(canaryProblem({ ...f, version: null }, { production: 1, now })).toBe("pick a saved version to run beside production");
    expect(canaryProblem({ ...f, until: "not a time" }, { production: 1, now })).toBe("the end is not a time");
    expect(canaryProblem({ ...f, until: "2026-10-21T12:00:00Z" }, { production: 1, now })).toBe("the end must be in the future: the canary ends itself then");
    expect(canaryProblem({ ...f, until: "2026-10-22T12:00:00Z" }, { production: 1, now })).toBe("");
    expect(canaryProblem({ ...f, share: "" }, { production: 1, now })).toBe("the share is a percentage above 0 and at most 100");
  });

  it("the request: the fraction, the mode, and an end only when one is given, in UTC", () => {
    expect(canaryBody({ version: 3, share: "25", mode: "canary", until: "" })).toEqual({ version: 3, share: 0.25, mode: "canary" });
    expect(canaryBody({ version: 3, share: "25", mode: "shadow", until: "2026-10-22T09:30:00Z" })).toEqual({ version: 3, share: 0.25, mode: "shadow", until: "2026-10-22T09:30:00.000Z" });
  });
});

describe("the canary's report, in words", () => {
  const view = (over: Partial<l8b.CanaryView> = {}): l8b.CanaryView => ({ ...l8b.canaryViewOf({ id: "cn-1", agent: "triage", version: 2, digest: "aaaaaaaabbbbbbbb", share: 0.25, mode: "shadow", by: "Ada", at: "2026-10-21T10:00:00Z", active: true }), ...over });

  it("the headline, standing or ended; an end the record does not explain", () => {
    expect(canaryHeadline(view())).toBe("Version 2 (aaaaaaaa) mirrors 25% of production runs in shadow mode. Configured by Ada 2026-10-21 10:00:00 UTC.");
    expect(canaryHeadline(view({ active: false }))).toBe("Version 2 (aaaaaaaa) mirrored 25% of production runs. Configured by Ada 2026-10-21 10:00:00 UTC. It no longer stands.");
    expect(canaryHeadline(view({ active: false, ended: { at: "2026-10-21T11:00:00Z", by: "", reason: "its until passed" } }))).toContain("Ended 2026-10-21 11:00:00 UTC: its until passed.");
  });

  it("production moved since the canary was configured; or not", () => {
    expect(productionMoved(view({ production: { version: 1, digest: "d1" }, production_now: { version: 3, digest: "d3" } }))).toBe("Production runs version 3 (d3) now; this canary was configured beside version 1 (d1).");
    expect(productionMoved(view({ production: { version: 1, digest: "d1" }, production_now: { version: 1, digest: "d1" } }))).toBe("");
    expect(productionMoved(view({ production: null, production_now: null }))).toBe("");
  });

  it("the rate: none compared and none pending; the whole result compared when the spec names no field", () => {
    expect(rateText({ mode: "shadow", compared: 0, disagreements: 0, rate: null, field: null, pending: 0 })).toBe("No pair compared yet on the whole result.");
    expect(rateText({ mode: "shadow", compared: 4, disagreements: 1, rate: null, field: "verdict", pending: 0 })).toBe("1 of 4 compared pairs disagree on verdict (25%).");
  });

  it("why pairs were skipped, each reason; nothing to say when nothing is pending or skipped", () => {
    expect(pendingSkippedText({ pending: 0, skipped: 0, skipped_why: {} })).toBe("");
    expect(pendingSkippedText({ pending: 2, skipped: 3, skipped_why: { await: 1, killed: 1, novel_reason: 1 } })).toBe(
      "2 pairs pending: either side still in flight. 3 pairs skipped, not counted: 1 because the shadow stopped at the spec's own await node: a shadow run asks no one; 1 because the shadow was killed; 1 because novel reason",
    );
  });

  it("outcomes and arms: a run that did not finish done reads as its state; shares only over what finished", () => {
    expect([outcomeLabel("state:killed"), outcomeLabel("ESCALATE"), outcomeLabel("")]).toEqual(["run killed", "ESCALATE", "(empty)"]);
    const rows = armRows({ candidate: { runs: 2, finished: 0, outcomes: {} }, production: { runs: 4, finished: 4, outcomes: { B: 2, A: 2 } } });
    expect(rows.map((r) => [r.outcome, r.candidate, r.production, r.candidateShare, r.productionShare])).toEqual([
      ["A", 0, 2, null, 0.5],
      ["B", 0, 2, null, 0.5],
    ]);
  });

  it("a condition as the canary reads it: met by override; the rows in the gate's order with their labels", () => {
    expect(conditionSays({ met: true, required: true, overridden: true })).toEqual({ text: "met by override", tone: "ok" });
    const rows = canaryConditionRows([l8b.canaryConditionOf({ condition: "findings", met: false, detail: "1 open", items: [] }), l8b.canaryConditionOf({ condition: "regression", met: false, required: true })]);
    expect(rows.map((r) => [r.label, r.required, r.says])).toEqual([
      ["Open findings", true, "unmet: holds the canary"],
      ["No regression", true, "unmet: holds the canary"],
    ]);
  });

  it("a refusal with no version named; the door's other refusals", () => {
    expect(canaryRefusalText({ version: null, digest: "abcdefabcdef", environment: "shadow", unmet: [] })).toBe(
      "The promotion gate holds abcdefab for shadow: nothing unmet. A canary or a shadow runs only a version that passed the gate, regression aside. Nothing changed: what stands, stands.",
    );
    expect(canaryErrorText({ status: 409, message: "triage is retired", control: "retired" })).toBe("The agent is retired: no canary runs beside it. triage is retired");
    expect(canaryErrorText({ status: 500, message: "boom" })).toBe("boom");
  });
});

describe("a run's marks", () => {
  it("each kind, alone and together: shadow first, then the canary arm, the flag, the taint, the eval", () => {
    expect(runMarkersOf({})).toEqual([]);
    const all = runMarkersOf({
      shadow: true,
      canary: { id: "cn-1", mode: "shadow", variant: "candidate", version: 2, of: "p-1" },
      review: { flag: "manual_check", reason: "", by: "" },
      taint: { source: "webhook", input: true },
      eval: { id: "ev-1", case: "a", set: "s" },
    });
    expect(all.map((m) => [m.kind, m.label, m.tone])).toEqual([
      ["shadow", "shadow", "queue"],
      ["review", "flagged: manual check", "warn"],
      ["taint", "untrusted input", "warn"],
      ["eval", "eval case", "neutral"],
    ]);
    expect(all[0].title).toBe("A shadow run of version 2, mirroring production run p-1: nothing above read executed, and it counts toward no production figure.");
    expect(all[2].title).toBe("Its input came from outside the estate (taint webhook).");
  });

  it("production's side of a canary: its arm in canary mode, mirrored in shadow mode", () => {
    expect(runMarkersOf({ canary: { id: "cn-1", mode: "canary", variant: "production", version: 1 } })[0]).toEqual({ kind: "canary", label: "production arm", tone: "neutral", title: "Production's arm of canary cn-1: it ran version 1." });
    expect(runMarkersOf({ canary: { id: "cn-2", mode: "shadow", variant: "production", shadow_run: "s-1" } })[0].title).toBe("Production's run, mirrored in shadow mode by s-1 (canary cn-2).");
    expect(runMarkersOf({ canary: { id: "cn-2", mode: "shadow", variant: "production", shadow_job: "j-1" } })[0].title).toBe("Production's run, mirrored in shadow mode by job j-1 (canary cn-2).");
    expect(runMarkersOf({ canary: { id: "cn-3", variant: "candidate" } })[0].label).toBe("canary");
  });

  it("the run page's line for each arm", () => {
    const a = canaryAssignmentOf({ id: "cn-1", mode: "canary", variant: "production", version: 1, candidate: { version: 2, digest: "aaaaaaaabbbb" } })!;
    expect(canaryRunLine(a, false)).toBe("Production's arm of canary cn-1: it ran version 1, beside the candidate version 2 (aaaaaaaa).");
    const c = canaryAssignmentOf({ id: "cn-1", variant: "candidate", version: 2 })!;
    expect(canaryRunLine(c, false)).toBe("This run used the candidate, version 2, of canary cn-1, instead of production's nothing deployed.");
    expect(canaryRunLine({ ...c, version: null, id: "" }, true)).toMatch(/^A shadow run of the candidate\. Nothing above read executed/);
  });

  it("a shadow's would-call: the tool and why it was held; anything else is not one", () => {
    expect(wouldCallOf({ kind: "tool.call", data: { tool: "x" } })).toBeNull();
    const w = wouldCallOf({ kind: "would_call", data: { placeholder: { would_call: "crm.update", note: "n" } } })!;
    expect(w).toEqual({ tool: "crm.update", args: {}, risk: "", sink: false, reason: "", note: "n" });
    expect(wouldCallLine(w)).toBe("Would have called crm.update (held): not executed, as a shadow run makes nothing above read.");
    expect(wouldCallLine({ ...w, tool: "", reason: "mutating_call" })).toBe("Would have called a tool (mutating call): not executed, as a shadow run makes nothing above read.");
  });
});

describe("templates", () => {
  const t = (over: Partial<l8b.TemplateView> = {}): l8b.TemplateView => ({ ...l8b.templateOf({ id: "tpl-1", name: "T", agent: "triage", version: 3, digest: "cccccccc11111111", state: "certified", by: "Ada", at: "2026-10-21T10:00:00Z", params: { b: null, a: "x", c: null } }), ...over });

  it("params: required first, then by name; in a line; none", () => {
    expect(paramFields(t().params).map((p) => [p.name, p.required])).toEqual([
      ["b", true],
      ["c", true],
      ["a", false],
    ]);
    expect([paramsLine(t().params), paramsLine({})]).toEqual(['b (required), c (required), a (default "x")', "no params"]);
  });

  it("the cut: what is refused before it is sent, and only the params the template takes, trimmed, empty ones left to their defaults", () => {
    expect(cutProblem(t(), { id: " ", values: {} }, [])).toBe("name the new agent: its id");
    expect(cutProblem(t(), { id: "new-one", values: { b: "1" } }, [])).toBe("the template needs c");
    expect(cutProblem(t(), { id: "new-one", values: { b: "1", c: " 2 " } }, ["other"])).toBe("");
    expect(cutBody("tpl-1", { id: " new-one ", values: { b: " 1 ", c: "2", a: "", stray: "z" } }, t().params)).toEqual({ from_template: "tpl-1", id: "new-one", params: { b: "1", c: "2" } });
  });

  it("who may certify: nobody unknown; an author never, administrator or not; an administrator otherwise; the role by any claim", () => {
    expect(certifyAccess(null, [], "template-certifier").ok).toBe(false);
    const admin = { name: "Ada", email: "ada@ey.com", appRoles: ["administrator"] };
    expect(certifyAccess(admin, ["Ada <ada@ey.com>"], "template-certifier").ok).toBe(false);
    expect(certifyAccess(admin, ["Ben <ben@ey.com>"], "template-certifier").ok).toBe(true);
    expect(certifyAccess({ name: "Ivy", email: "ivy@ey.com", roles: ["design-authority"] }, [], "design-authority").ok).toBe(true);
  });

  it("refusals the console does not know read as the backend's message; the lines", () => {
    expect(templateRefusalText({ status: 500, message: "boom", body: {} })).toBe("boom");
    expect(templateRefusalText({ status: 400, message: "m", field: "params", body: {} })).toBe("The template needs more params.");
    expect(templateLine(t())).toBe("Made by Ada 2026-10-21 10:00:00 UTC from triage version 3 (cccccccc) · 3 params · certified");
    expect([certifiedLine(t()), certifiedLine(t({ certified: { by: "Tia", at: null, note: "" } }))]).toEqual(["", "Certified by Tia"]);
    expect(cutParamsLine({ n: 3, o: { k: 1 }, s: "x" })).toBe('n = 3, o = {"k":1}, s = x');
    expect([templateStateMeta("pending").tone, templateStateMeta("revoked").label]).toEqual(["warn", "revoked"]);
  });

  it("a lineage deployed, and a drift flagged with nothing named", () => {
    const l = l8b.lineageOf({
      agent: "x",
      template: { id: "tpl-1", name: "T", state: "certified" },
      template_digest: "dddddddd",
      cut: { version: 1, digest: "e", params: {}, by: "Ada", at: "2026-10-21T10:00:00Z" },
      current: { version: 1, digest: "e" },
      deployed: { version: 1, digest: "e" },
      drifted: true,
      drift: { summary: [] },
    });
    expect(lineageLine(l)).toBe('Cut from template "T" (tpl-1) at digest dddddddd by Ada 2026-10-21 10:00:00 UTC, as version 1 with no params. Production runs version 1.');
    expect(driftLine(l)).toMatch(/^No drift/);
    expect(l8b.lineageOf({}).drift).toBeNull();
  });
});

describe("deliverables and registers, in words", () => {
  const step = (over: Partial<l8b.HistoryStep>): l8b.HistoryStep => ({ ...l8b.historyStepOf({}), state: "draft", ...over });

  it("the filters drop blanks; counts by state in order; a file's name from either separator; sizes", () => {
    expect(deliverableQuery({ state: " ", agent: " triage ", run: "" })).toEqual({ agent: "triage" });
    expect([statesLine({}), statesLine({ withdrawn: 1, novel: 2, draft: 3, zero: 0 })]).toEqual(["none", "3 draft · 1 withdrawn · 2 novel"]);
    expect([fileName("/a/b/c.md"), fileName("C:\\out\\r.pdf"), fileName("plain")]).toEqual(["c.md", "r.pdf", "plain"]);
    expect([sizeText(null), sizeText(1), sizeText(2048), sizeText(3 * 1024 * 1024)]).toEqual(["", "1 byte", "2.0 KB", "3.0 MB"]);
    expect([deliverableStateMeta("published").tone, deliverableStateMeta("archived").label]).toEqual(["ok", "archived"]);
  });

  it("each step of a history; an aborted withdrawal; a state a newer backend names", () => {
    expect(historyLine(step({ state: "withdrawn", aborted: true }))).toBe("Withdrawn (the run aborted)");
    expect(historyLine(step({ state: "reviewed", by: "Rui" }))).toBe("Reviewed by Rui");
    expect(historyLine(step({ state: "archived_by_policy", by: "ops", note: "old" }))).toBe("archived by policy by ops: old");
    expect(historyLine(step({ state: "draft" }))).toBe("Written");
  });

  it("a file's availability and a refused download, when the backend says nothing more", () => {
    expect(fileLine({ available: false, why: "quarantined", says: "" })).toBe("Not served: quarantined.");
    expect(fileLine({ available: false, why: "", says: "" })).toBe("Not served: the backend did not say why.");
    expect(fileRefusalText({ status: 502, message: "the backend answered 502", body: {} })).toBe("the backend answered 502");
  });

  it("the report gate: a deliverable whose state moved since the gate opened, one the registry does not hold; several, and the sink", () => {
    const d = l5.gateDeliverableOf({ id: "dlv-1", title: "R", state: "draft", current_state: "withdrawn", registered: false });
    expect(gateDeliverableLine(d)).toBe("report · draft, withdrawn now · not registered");
    expect(reportGateNote(2, "")).toBe("The run wrote these 2 deliverables and wants to call a sink. Approving reviews them, signed with your name; the sink then fires and publishes them. Refusing withdraws them: nothing leaves.");
    expect([sinkOfAsk("crm.update - a sink"), sinkOfAsk("")]).toEqual(["crm.update", ""]);
    expect(l5.gateOf({ run: "r" }).deliverables).toEqual([]);
    expect(l5.gateOf({ run: "r", control: "report", deliverables: [{ id: "" }, { id: "dlv-2" }] }).deliverables.map((x) => x.id)).toEqual(["dlv-2"]);
  });

  it("registers and their items in a line", () => {
    expect(registerLine({ name: "n", items: 2, states: { draft: 2 }, backends: [], agents: [], latest: null })).toBe("2 items · 2 draft");
    const item = l8b.registerItemOf({ id: "n/b/1", backend: "b", item: "1", run: "r2", state: "published", origin: "worker", history: [{ run: "r1" }, { run: "r2" }] });
    expect(registerItemLine(item)).toBe("b · published · last written by r2 (2 writes) · a worker");
  });
});

describe("a job's canary arm", () => {
  it("a shadow job, the candidate's job, production's mirrored job, production's arm; none", () => {
    expect(canaryArmOf({ shadow: true, canary: null })).toBe("shadow job: a worker running shadow mode claims it");
    expect(canaryArmOf({ canary: { id: "cn", variant: "candidate" } })).toBe("canary candidate");
    expect(canaryArmOf({ canary: { id: "cn", variant: "production", shadow_job: "0123456789" } })).toBe("production, mirrored by shadow job 01234567");
    expect(canaryArmOf({ canary: { id: "cn", variant: "production" } })).toBe("production arm of canary");
    expect([canaryArmOf({}), canaryArmOf({ canary: { variant: "candidate" } })]).toEqual(["", ""]);
    expect(jobLine({ status: "queued", source: "intake", attempts: 0, max_attempts: 3, error: null, dead: false, canary: { id: "cn", variant: "candidate", version: 2 } })).toBe("queued · from intake · attempt 0 of 3 · canary candidate (version 2)");
  });
});

describe("the spine's canary stage and `current`", () => {
  const stage = (s: string, lit: boolean, record: Record<string, unknown> | null = null) => ({ stage: s, lit, at: lit ? "2026-10-21T10:00:00.000Z" : null, by: lit ? "Ada" : "", digest: "d1", version: lit ? 1 : null, record });

  it("a canary stage lit by a shadow's deployment row with no reason; one whose record cannot say whether it stands", () => {
    const l = { digest: "d1", deployed: null, retired: null, current: "canary", stages: [stage("canary", true, { environment: "shadow", current: true })] };
    expect(spineOf(l)[0]).toMatchObject({ note: "shadow: a share of production runs, mirrored; mirroring production now", tone: "ok", now: true });
    const unknown = { digest: "d1", deployed: null, retired: null, stages: [stage("canary", true, { environment: "canary" })] };
    expect(spineOf(unknown)[0]).toMatchObject({ note: "canary: a share of queued and triggered starts", tone: "ok", now: false });
  });

  it("past stages are only those beyond `current` whose record no longer holds", () => {
    const stages = [stage("designed", true), stage("approved", true, { current: false }), stage("canary", true, { current: true }), stage("deployed", true, { current: false })];
    expect(pastOf({ stages, current: "approved" })).toEqual(["it was deployed, and production no longer runs it"]);
    expect(pastOf({ stages, current: null })).toEqual(["it was deployed, and production no longer runs it"]);
    expect(pastOf({ stages, current: "deployed" })).toEqual([]);
  });

  it("the headline names a shadow's own reason, and keeps the stage alone when the record gives none", () => {
    const shadow = { current: "canary", version: 2, digest: "d2d2d2d2d2", deployed: null, retired: null, stages: [stage("canary", true, { environment: "shadow", reason: "shadow: 0.2 of production runs, mirrored", current: true })] };
    expect(spineHeadline(shadow)).toBe("Version 2 (d2d2d2d2): canary (shadow: 0.2 of production runs, mirrored). Nothing is deployed to production.");
    expect(spineHeadline({ ...shadow, stages: [] })).toBe("Version 2 (d2d2d2d2): canary. Nothing is deployed to production.");
  });

  it("a run's shadow and canary on its record; an assignment with nothing to say is none", () => {
    expect(canaryAssignmentOf(null)).toBeNull();
    expect(canaryAssignmentOf({ mode: "canary" })).toBeNull();
    expect(canaryAssignmentOf({ id: "cn-1", share: 0.5, candidate: "not an object" })).toMatchObject({ id: "cn-1", mode: "canary", share: 0.5, candidate: null, production: null, version: null });
    const f = runFlagsOf({ shadow: true, canary: { id: "cn-1", variant: "candidate", of: "p-1" } });
    expect([f.shadow, f.canary?.of]).toEqual([true, "p-1"]);
  });

  it("a drain refuses as a pause does, and says so; a pause with no one named", () => {
    expect(pausedLine("triage", { mode: "drain", reason: "", by: "", at: "" })).toBe("triage is draining. It takes no new runs or triggers until it is resumed on the Control page.");
    expect(pausedLine("", { mode: "pause", reason: "x", by: "Ops", at: "" })).toBe("This agent is paused: x (by Ops). It takes no new runs or triggers until it is resumed on the Control page.");
  });
});

describe("the Evals page's set list", () => {
  const set = (id: string, updated_at: string | null, over: Partial<l8b.EvalSetSummary> = {}): l8b.EvalSetSummary => ({ ...l8b.evalSetSummaryOf({ id, agent: "a", name: id, count: 1, updated_at, source: updated_at ? "db" : "file" }), ...over });

  it("the backend's sets newest first, file sets after them, each once; the console's latest score on each; the console's own sets kept", () => {
    const latest = { passed: 1, total: 1, model: "m", at: "2026-10-21T10:00:00Z" };
    const consoleRows: SetRow[] = [{ id: "b", agent: "a", name: "b", model: "", n: 9, latest }, { id: "gone", agent: "x", name: "gone", model: "", n: 2, latest: null, source: "db" }];
    const rows = mergeSetRows([set("a", "2026-10-20T00:00:00Z"), set("f", null), set("b", "2026-10-21T00:00:00Z", { labels: { space: [] } }), set("a", "2026-10-22T00:00:00Z")], consoleRows);
    expect(rows.map((r) => [r.id, r.n, r.labeled ?? null, r.latest?.passed ?? null, r.source])).toEqual([
      ["b", 1, true, 1, "db"],
      ["a", 1, false, null, "db"],
      ["f", 1, false, null, "file"],
      ["gone", 2, null, null, "db"],
    ]);
    expect(mergeSetRows([], [])).toEqual([]);
  });
});

describe("the client reads defensively and builds its requests", () => {
  it("a canary view with nothing in it; a condition's required as the backend says it, else as the contract rules it", () => {
    const c = l8b.canaryViewOf({});
    expect([c.mode, c.active, c.ended, c.production, c.rate, c.arms, c.conditions, c.cancelled_jobs]).toEqual(["canary", false, null, null, null, { candidate: { runs: 0, finished: 0, outcomes: {} }, production: { runs: 0, finished: 0, outcomes: {} } }, [], []]);
    expect(l8b.canaryViewOf({ mode: "shadow", skipped_why: { stand_in: 2, bad: "x" } }).skipped_why).toEqual({ stand_in: 2 });
    expect([l8b.canaryConditionOf({ condition: "regression" }).required, l8b.canaryConditionOf({ condition: "eval" }).required, l8b.canaryConditionOf({ condition: "eval", required: false }).required]).toEqual([false, true, false]);
  });

  it("templates, deliverables, registers and eval sets with fields missing", () => {
    expect(l8b.templateOf({ id: "t", params: { n: 3, m: null } })).toMatchObject({ name: "t", state: "pending", certified: null, params: { n: "3", m: null } });
    const d = l8b.deliverableViewOf({ id: "d", history: [{ state: "draft" }, "x"], file: {} });
    expect([d.title, d.kind, d.origin, d.state, d.download, d.history.length, d.history[0].applied, d.file]).toEqual(["d", "report", "engine", "draft", null, 1, true, { available: false, why: "", says: "" }]);
    expect(l8b.deliverableListOf({ deliverables: [{ id: "" }, { id: "x" }] }).count).toBe(1);
    expect(l8b.registerListOf({ registers: [{ name: "" }, { name: "r", items: 2 }] })).toEqual({ registers: [{ name: "r", items: 2, states: {}, backends: [], agents: [], latest: null }], count: 1 });
    expect(l8b.registerItemsOf({ register: "r", items: [{ id: "r/b/1" }] }).items[0]).toMatchObject({ origin: "engine", state: "draft", history: [] });
    expect(l8b.evalSetListOf({ sets: [{ id: "s", labels: [] }] }).sets[0]).toMatchObject({ name: "s", labels: null, source: "db", suite: false });
    expect(l8b.agentCutOf({ id: "x", lineage: { template: "" } }).lineage).toBeNull();
    expect(l8b.lineageRefOf({ template: "tpl", template_digest: "d" })).toEqual({ template: "tpl", template_digest: "d" });
  });

  it("the paused refusal: a drain; anything that is not one", () => {
    expect(l8b.pausedRefusalOf(409, { control: "paused", paused: { mode: "drain", reason: "r", by: "b", at: "a" } })).toEqual({ mode: "drain", reason: "r", by: "b", at: "a" });
    expect(l8b.pausedRefusalOf(409, { paused: { reason: "legacy body" } })?.reason).toBe("legacy body");
    expect([l8b.pausedRefusalOf(409, { control: "retired" }), l8b.pausedRefusalOf(409, null)]).toEqual([null, null]);
  });

  it("every request, encoded", () => {
    expect(l8b.L8B.canary("a/b", "cn 1")).toEqual({ method: "GET", path: "/api/agents/a%2Fb/canary?id=cn+1" });
    expect(l8b.L8B.certify("tpl-1")).toEqual({ method: "POST", path: "/api/templates/tpl-1/certify", body: {} });
    expect(l8b.L8B.registerItems("bad name", { state: "draft", agent: "" })).toEqual({ method: "GET", path: "/api/registers/bad%20name/items?state=draft" });
    expect(l8b.L8B.deliverables({ limit: 5 })).toEqual({ method: "GET", path: "/api/deliverables?limit=5" });
    expect(l8b.L8B.evalSet("s/1").path).toBe("/api/eval-sets/s%2F1");
    expect(l8b.deliverableFileUrl("d 1")).toBe("/api/deliverables/d%201/file");
  });

  it("a 404 that is not the door's 'none on record' is a refusal, not a none", async () => {
    const answer = (status: number, body: unknown) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })));
    answer(404, { error: 'no saved agent "ghost"' });
    await expect(l8b.getCanary("ghost")).rejects.toThrow('no saved agent "ghost"');
    answer(404, { error: 'no saved agent "ghost"' });
    await expect(l8b.getLineage("ghost")).rejects.toThrow('no saved agent "ghost"');
    answer(404, { error: '"triage" was not cut from a template' });
    expect(await l8b.getLineage("triage")).toBeNull();
    answer(503, { error: "registry down" });
    await expect(l8b.listEvalSets(["a"])).rejects.toThrow("registry down");
    expect(l8b.canaryRefusalOf(new Error("x"))).toBeNull();
    expect(l8b.canaryRefusalOf(new l5.DoorError("x", 409, { field: "version" }))).toBeNull();
  });

  it("a page in place of an answer (no backend) says where the door is served", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>not found</html>", { status: 404 })));
    await expect(l8b.listTemplates()).rejects.toThrow("this door is served by the backend; this deployment may not have named it (BACKEND_ORIGIN)");
  });
});
