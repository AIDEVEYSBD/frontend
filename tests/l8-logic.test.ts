import { afterEach, describe, expect, it, vi } from "vitest";
import { REGISTRY_SCHEMA } from "@/lib/server/db";
import { DELETE_CONSOLE_HISTORY, LATEST_DONE_PER_SET, SET_HISTORY } from "@/lib/server/eval-sql";
import * as l5 from "@/lib/api/l5";
import * as l8 from "@/lib/api/l8";
import { reachedOf } from "@/lib/api/l7";
import {
  authorsOf,
  benchmarkLine,
  canOverride,
  conditionLabel,
  draftBanner,
  draftToLoad,
  findingHref,
  gatedSaveLine,
  inboundLine,
  itemLine,
  latestReviewOf,
  overrideBody,
  overrideChoices,
  overrideOutcome,
  overrideProblem,
  retireProblem,
  reviewAccess,
  rollbackProblem,
  rollbackTargets,
  runFlagOf,
  runFlagsOf,
  savedLine,
  shortDigest,
  spineOf,
  stageLabel,
  whenText,
} from "@/lib/lifecycle";
import { historyRowOf, isBackendRow, lastComparison, liveOf, mergeHistory, rowStateText, settleOf, thresholdText, throttleOf, type HistoryRow } from "@/lib/evals";
import { JOB_STATUS_META, jobLine, taintLine, taintOf } from "@/lib/queue";
import { driftBenchmarkOf, overrideOfAttention, pauseOf, redirectGuidanceOf, rollbackOfAttention } from "@/lib/gates";
import { mayText, outcomeText } from "@/lib/guardian";
import { answerOf, peerCancelLine, peerTaskLine, reachedStateText } from "@/lib/run-tree";
import { benchmarkEvalLine, driftVerdict } from "@/lib/drift";

/**
 * What the console decides about the L8 shapes on its own (phase L8, first
 * round), held without a browser and without a backend: the spine, the
 * gate's override, a review's access, rollback targets, retirement, drafts,
 * the eval page's readings of the backend's runner, the console's eval SQL
 * on the shared table, the L8 attention levers, the guardian's redirect,
 * a job's taint and a peer's answer to a cancel. tests/l8-contract.test.ts
 * holds the same functions against the backend's captured answers.
 */

afterEach(() => vi.unstubAllGlobals());

describe("times and digests, as the console prints them", () => {
  it("a record's time to the second, in UTC; a digest short", () => {
    expect([whenText("2026-10-21T14:19:46.293Z"), whenText("2026-10-21T14:19:46Z"), whenText(""), whenText(null)]).toEqual(["2026-10-21 14:19:46 UTC", "2026-10-21 14:19:46 UTC", "", ""]);
    expect([shortDigest("90df2dfa5e202811"), shortDigest("sha256:d54fe85d6e25e058188e")]).toEqual(["90df2dfa", "sha256:d54fe85d6e25"]);
    expect([stageLabel("canary"), stageLabel("shadow_mode"), conditionLabel("regression"), conditionLabel("new_rule")]).toEqual(["Canary", "shadow mode", "No regression", "new rule"]);
  });
});

describe("the spine", () => {
  const stage = (s: string, lit: boolean, record: Record<string, unknown> | null = null) => ({ stage: s, lit, at: lit ? "2026-10-21T10:00:00.000Z" : null, by: lit ? "Ada" : "", digest: "d1", version: lit ? 1 : null, record });

  it("in the backend's order whatever order it arrives in; a stage a newer backend adds comes last", () => {
    const l = { digest: "d1", deployed: null, retired: null, stages: [stage("shadow", false), stage("retired", false), stage("designed", true, { version: 1 }), stage("deployed", false)] };
    expect(spineOf(l).map((s) => [s.stage, s.label, s.tone])).toEqual([
      ["designed", "Designed", "ok"],
      ["deployed", "Deployed", "neutral"],
      ["retired", "Retired", "neutral"],
      ["shadow", "shadow", "neutral"],
    ]);
    expect(spineOf(l)[0]).toMatchObject({ who: "by Ada · 2026-10-21 10:00:00 UTC", note: "version 1 saved" });
    expect(spineOf(l)[1].needs).toBe("a production deployment row of this digest");
  });

  it("a review without a note; a deploy whose record cannot say whether it runs", () => {
    const l = { digest: "d1", deployed: null, retired: null, stages: [stage("reviewed", true, { verdict: "approved", note: "" }), stage("deployed", true, { kind: "deploy" })] };
    expect(spineOf(l).map((s) => s.note)).toEqual(["approved", ""]);
  });
});

describe("the gate's override", () => {
  const refusal = { unmet: [{ condition: "review", detail: "", items: [] }, { condition: "eval", detail: "", items: [] }, { condition: "novel", detail: "", items: [] }] };

  it("the choices are the unmet ones the console knows, in the gate's order", () => {
    expect(overrideChoices(refusal)).toEqual(["eval", "review"]);
  });

  it("a reason is required, and naming none passes nothing; the body names the conditions only when some are picked", () => {
    expect(overrideProblem({ reason: " ", all: true, picked: [] })).toMatch(/needs a reason/);
    expect(overrideProblem({ reason: "x", all: false, picked: [] })).toMatch(/pick the conditions/);
    expect(overrideProblem({ reason: "x", all: false, picked: ["eval"] })).toBe("");
    expect(overrideBody({ reason: "  hotfix  ", all: true, picked: ["eval"] })).toEqual({ reason: "hotfix" });
    expect(overrideBody({ reason: "hotfix", all: false, picked: ["review", "eval"] })).toEqual({ reason: "hotfix", conditions: ["eval", "review"] });
    expect(overrideOutcome({ reason: "x", all: false, picked: ["eval"] }, refusal)).toEqual({ passes: ["eval"], holds: ["review", "novel"] });
    expect(overrideOutcome({ reason: "x", all: true, picked: [] }, refusal)).toEqual({ passes: ["review", "eval", "novel"], holds: [] });
  });

  it("only an administrator overrides", () => {
    expect([canOverride({ appRoles: ["administrator"] }), canOverride({ appRoles: ["operator"] }), canOverride(null), canOverride({})]).toEqual([true, false, false, false]);
  });

  it("an item the gate read, in a line, whatever kind it is", () => {
    expect(itemLine({ id: "ev-1", digest: "abcdef0123456789", version: null, set: "s", passed: 1, total: 4, score: 0.25, threshold: null })).toBe("abcdef01: 1/4 (0.2500) on s · ev-1");
    expect(itemLine({ verdict: "approved", by: "Rui", at: "", note: "" })).toBe("approved by Rui");
    expect(itemLine({ kind: "drift", ref: "drift:triage", detail: "tool mix moved" })).toBe("drift drift:triage: tool mix moved");
    expect(itemLine({ id: "x-1" })).toBe("x-1");
    expect([findingHref({ kind: "drift", ref: "drift:x" }), findingHref({ kind: "peer", ref: "" }), findingHref({ kind: "nothing" })]).toEqual(["/drift", "/configuration#peers", null]);
  });
});

describe("reviews", () => {
  const versions = [
    { version: 1, digest: "d1", saved_by: "Ada <ada@ey.com>" },
    { version: 2, digest: "d2", saved_by: "Bo <bo@ey.com>" },
    { version: 3, digest: "d1", saved_by: "Cy <cy@ey.com>" },
    { version: 4, digest: "d1", saved_by: "Ada <ada@ey.com>" },
  ];

  it("the authors of a digest: everyone who saved a version carrying it, once each", () => {
    expect(authorsOf(versions, "d1")).toEqual(["Ada <ada@ey.com>", "Cy <cy@ey.com>"]);
    expect(authorsOf(versions, "d9")).toEqual([]);
  });

  it("separation of duties first, administrator or not; then the role, from any of the claims the backend reads", () => {
    const authors = authorsOf(versions, "d1");
    expect(reviewAccess({ name: "Cy", email: "cy@ey.com", appRoles: ["administrator"] }, authors, "policy-reviewer").ok).toBe(false);
    expect(reviewAccess({ name: "Bo", email: "bo@ey.com", appRoles: ["administrator"] }, authors, "policy-reviewer").ok).toBe(true);
    expect(reviewAccess({ name: "Bo", email: "bo@ey.com", roles: ["risk-board"] }, authors, "risk-board").ok).toBe(true);
    expect(reviewAccess({ name: "Bo", email: "bo@ey.com", appRoles: ["policy-reviewer"] }, authors, "policy-reviewer").ok).toBe(true);
    expect(reviewAccess({ name: "Bo", email: "bo@ey.com" }, authors, "policy-reviewer")).toEqual({ ok: false, reason: 'a policy review needs the "policy-reviewer" role (or an administrator); yours: none' });
  });

  it("the newest review of a digest", () => {
    const reviews = [{ id: "r3", digest: "d2" }, { id: "r2", digest: "d1" }, { id: "r1", digest: "d1" }];
    expect([latestReviewOf(reviews, "d1")?.id, latestReviewOf(reviews, "d9")]).toEqual(["r2", null]);
  });
});

describe("rollback and retirement", () => {
  const d = (id: string, environment: string, version: number, kind = "deploy", at = "2026-10-21T10:00:00Z") => ({ id, agent: "a", environment, version, digest: `d${version}`, kind, by: "Ada", at, reason: "", override: null, decision: "", eval_run: "", review: "", previous: null, flagged: [], current: false });

  it("a rollback may name any version that ran in production, less what runs now, each once, the newest first", () => {
    const list = {
      deployments: [d("4", "production", 1, "rollback", "2026-10-21T13:00:00Z"), d("3", "staging", 5), d("2", "production", 3), d("1", "production", 1)],
      current: { production: d("4", "production", 1, "rollback") },
      adopted: null,
    };
    expect(rollbackTargets(list).map((t) => [t.version, t.how])).toEqual([[3, "deploy"]]);
    // With nothing current but an adopted version, the adopted one is what runs.
    expect(rollbackTargets({ deployments: [d("2", "production", 3)], current: {}, adopted: { version: 3, digest: "d3", deployment: null, adopted: true } })).toEqual([]);
  });

  it("what the doors would refuse before anything is sent", () => {
    expect([rollbackProblem(null, "x"), rollbackProblem(1, " "), rollbackProblem(1, "x")]).toEqual(["pick a version that ran in production before", expect.stringMatching(/needs a reason/), ""]);
    expect(retireProblem("triage", "", "", [])).toBe("a retirement needs a reason");
    expect(retireProblem("triage", "x", "triage", ["triage"])).toBe("the replacement is another agent, not this one");
    expect(retireProblem("triage", "x", "ghost", ["triage", "next"])).toBe('no saved agent "ghost"');
    expect([retireProblem("triage", "x", "next", ["next"]), retireProblem("triage", "x", "", ["next"])]).toEqual(["", ""]);
  });

  it("a run nobody flagged reads as such", () => {
    expect([runFlagOf({}), runFlagOf(null), runFlagOf({ review: { flag: "" } })]).toEqual([null, null, null]);
    const f = runFlagsOf({ journal: { entries: [{ kind: "a2a.message", data: { direction: "out" } }] } });
    // L8 (second round) added the shadow mark and the canary assignment: neither on a plain run.
    expect(f).toEqual({ review: null, taint: null, inbound: null, eval: null, job: "", shadow: false, canary: null });
    expect(inboundLine({ peer: "", digest: "", bytes: 0, screen: "", task: "", signed: false })).toBe("Message from peer an A2A caller: 0 bytes, no digest, screened ?.");
  });
});

describe("drafts", () => {
  it("what a save did; the version the builder edits; the banner over a draft", () => {
    expect(savedLine({ draft: true, version: 4 }, null)).toBe("Saved version 4 as a draft. Production keeps running the deployed version until a deploy.");
    expect(gatedSaveLine({ draft: false, version: 1 })).toBe("Version 1 is saved, and is what runs until the agent's first deploy passes the gate.");
    expect([draftToLoad({ version: 2, spec_version: 1 }), draftToLoad({ version: 2, spec_version: 2 }), draftToLoad({ version: null, spec_version: null }), draftToLoad({ version: 3 })]).toEqual([2, null, null, 3]);
    expect([draftBanner({ version: 2, deployed_version: 2 }), draftBanner({ version: 2, deployed_version: null })]).toEqual(["", ""]);
  });

  it("the benchmark in a line: under its threshold, none, measured against another version", () => {
    const b = { score: 0.5, passed: 1, total: 2, threshold: 0.6, passed_threshold: false, model: "gpt-4o", set: "s", digest: "abcdef0123", matches_deployed: false, at: "", id: "ev-1", version: 2, deployed: { version: 1, digest: "x" } };
    expect(benchmarkLine(b)).toBe("1/2 (0.500) on s, under the threshold 0.6 · model gpt-4o · measured version 2 (abcdef01), not what production runs (version 1)");
    expect(benchmarkLine({ ...b, threshold: null, passed_threshold: null, score: null })).toBe("1/2 on s, no threshold · model gpt-4o · measured version 2 (abcdef01), not what production runs (version 1)");
  });
});

describe("the eval page's readings of the backend's runner", () => {
  const view = (over: Partial<l8.EvalRunView> = {}): l8.EvalRunView => ({ ...l8.evalRunViewOf({ id: "ev-1", state: "running", progress: { done: 0, total: 2, passed: 0 } }), ...over });
  const rl = l8.rateLimitedOf({ index: 1, id: "b", model: "default", attempt: 2, of: 5, wait_s: 30, text: "rate limit: x", limit: { scope: "tree", limit: "tree_per_minute", used: 9, allowed: 9, retry_after_s: 30, agent: "a", tree: "t-1", kind: "start" } })!;

  it("a rate limit is a wait only while the case it names has not started", () => {
    expect(rl.limit).toMatchObject({ scope: "tree", error: "rate limit: x", retry_after_s: 30 });
    const waiting = view({ progress: { done: 1, total: 2, passed: 1, current: { index: 1, id: "b", model: "default", run: "" }, rate_limited: rl } });
    expect(throttleOf(waiting)).toBe(rl);
    expect(throttleOf({ ...waiting, progress: { ...waiting.progress, current: { index: 1, id: "b", model: "default", run: "r-1" } } })).toBeNull();
    expect(throttleOf({ ...waiting, progress: { ...waiting.progress, current: { index: 0, id: "a", model: "default", run: "" } } })).toBeNull();
    expect(throttleOf({ ...waiting, state: "done" })).toBeNull();
  });

  it("the live reading follows the first row not over, then the last; a comparison's failed rows are named", () => {
    const a = view({ id: "a", state: "done", model: "m1" });
    const b = view({ id: "b", state: "running", model: "m2" });
    expect(liveOf([a, b])).toMatchObject({ id: "b", model: "m2", leg: 2, legs: 2 });
    expect(liveOf([a, { ...b, state: "failed", error: "interrupted" }])).toMatchObject({ id: "b", leg: 2 });
    expect(liveOf([])).toBeNull();
    expect(settleOf([a, { ...b, state: "failed" }]).failed.map((v) => v.id)).toEqual(["b"]);
    expect(settleOf([a]).comparison).toBeNull();
  });

  it("the threshold in words, in every state", () => {
    expect(thresholdText({ threshold: null, passed_threshold: null })).toBe("no threshold: not the spec's own suite");
    expect(thresholdText({ threshold: 0.9, passed_threshold: null, state: "done" })).toBe("threshold 0.9");
    expect(thresholdText({ threshold: 0.9, passed_threshold: null, state: "queued" })).toBe("threshold 0.9, still measuring");
  });

  it("a view read defensively: an unknown state reads failed, a missing model is the default, a case's expected only when labeled", () => {
    const v = l8.evalRunViewOf({ id: "ev-x", state: "exploded", results: [{ id: "c", passed: true, expected: null }] });
    expect([v.state, v.model, v.results[0].expected, v.results[0].predicted, v.comparison, v.progress.current]).toEqual(["failed", "default", null, null, null, null]);
    expect(l8.comparisonOf({ models: [] })).toBeNull();
    expect(l8.isEvalOver({ state: "queued" })).toBe(false);
  });
});

describe("following an eval", () => {
  const answer = (...bodies: (Record<string, unknown> | number)[]) => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        const b = bodies.shift();
        // A proxy's own failure: no body of the backend's.
        if (typeof b === "number") return new Response("", { status: b });
        return new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    return urls;
  };

  it("a read that fails is tried again; only `misses` failures in a row end it", async () => {
    answer(502, { id: "ev-1", state: "running" }, { id: "ev-1", state: "done", passed: 1, total: 1 });
    const [v] = await l8.followEval(["ev-1"], { sleep: async () => {}, misses: 2 });
    expect([v.state, v.passed]).toEqual(["done", 1]);
    answer(502, 502);
    await expect(l8.followEval(["ev-1"], { sleep: async () => {}, misses: 2 })).rejects.toThrow(/answered 502.*BACKEND_ORIGIN/);
  });

  it("several rows, each read until over and not after; stopping returns what was read", async () => {
    const urls = answer({ id: "a", state: "done" }, { id: "b", state: "running" }, { id: "b", state: "done" });
    const views = await l8.followEval(["a", "b"], { sleep: async () => {} });
    expect(views.map((v) => [v.id, v.state])).toEqual([["a", "done"], ["b", "done"]]);
    expect(urls).toEqual(["/api/evals/runs/a", "/api/evals/runs/b", "/api/evals/runs/b"]);
    answer({ id: "a", state: "running" });
    let n = 0;
    const partial = await l8.followEval(["a"], { sleep: async () => {}, stopped: () => n++ > 0 });
    expect(partial.map((v) => v.state)).toEqual(["running"]);
  });

  it("every door's request, encoded", () => {
    expect(l8.L8.startEval("a b", { set: "s" })).toEqual({ method: "POST", path: "/api/agents/a%20b/evals/run", body: { set: "s" } });
    expect(l8.L8.lifecycle("triage", "d1")).toEqual({ method: "GET", path: "/api/agents/triage/lifecycle?digest=d1" });
    expect(l8.L8.lifecycle("triage")).toEqual({ method: "GET", path: "/api/agents/triage/lifecycle" });
    expect(l8.L8.deployments("triage", "staging").path).toBe("/api/agents/triage/deployments?environment=staging");
    expect(l8.L8.reviews("triage", "d1").path).toBe("/api/agents/triage/reviews?digest=d1");
    expect(l8.L8.save({ a: 1 })).toEqual({ method: "POST", path: "/api/agents", body: { spec: { a: 1 } } });
    expect(l8.L8.save({ a: 1 }, { deploy: true, override: { reason: "r" } }).body).toEqual({ spec: { a: 1 }, deploy: true, override: { reason: "r" } });
    expect(l8.L8.version("triage", 2).path).toBe("/api/agents/triage/versions/2");
  });

  it("a refusal that is not the gate's, or not a retirement, reads as neither", () => {
    const other = new l5.DoorError("no", 409, { error: "no", field: "set" });
    expect([l8.gateRefusalOf(other), l8.retiredRefusalOf(other), l8.gateRefusalOf(new Error("x"))]).toEqual([null, null, null]);
    expect(l8.retiredOf({})).toBeNull();
  });
});

describe("the eval-set history on the shared table", () => {
  const row = (over: Record<string, unknown>): HistoryRow => historyRowOf({ id: "r", model: "m", digest: "d", passed: 1, total: 2, results: [], at: "2026-10-21T10:00:00Z", ...over });

  it("a row the console's runner wrote before L8 reads finished, by nobody, never the gate's", () => {
    const old = historyRowOf({ id: "ev-old", model: "gpt-4o", passed: "3", total: 3, results: [], summary: { batch_id: "ev-old" }, at: "2026-09-01T00:00:00Z" });
    expect([old.state, old.by, old.threshold, old.passed_threshold, old.passed, isBackendRow(old)]).toEqual(["done", "", null, null, 3, false]);
    expect(isBackendRow(row({ summary: { version_digest: "d" } }))).toBe(true);
  });

  it("a row still running or failed says so; a finished one says nothing", () => {
    expect([rowStateText(row({ state: "running", results: [{ id: "a" }] })), rowStateText(row({ state: "failed", error: "interrupted" })), rowStateText(row({ state: "queued" })), rowStateText(row({}))]).toEqual(["running 1/2", "failed: interrupted", "queued", ""]);
  });

  it("the last comparison: a backend batch reads its recommendation; a console batch is rebuilt; a batch still running, or with one leg, is not one", () => {
    const leg = (id: string, model: string, cost: number, at: string, extra: Record<string, unknown> = {}) =>
      row({ id, model, passed: 2, total: 2, at, summary: { batch_id: "b-1", compare: true, incumbent: "big", cost_per_case: cost, avg_ms: 10, ...extra } });
    const rebuilt = lastComparison([leg("1", "big", 0.01, "2026-10-21T10:00:00Z"), leg("2", "small", 0.001, "2026-10-21T10:00:01Z")]);
    expect([rebuilt?.incumbent, rebuilt?.recommended, rebuilt?.rationale]).toEqual(["big", "small", "small clears the incumbent's quality within 0.02 at 90% lower cost per case."]);
    const running = lastComparison([leg("1", "big", 0.01, "2026-10-21T10:00:00Z"), { ...leg("2", "small", 0.001, "2026-10-21T10:00:01Z"), state: "running" }]);
    expect(running).toBeNull();
    const backend = lastComparison([
      leg("1", "big", 0.01, "2026-10-21T10:00:00Z", {
        version_digest: "vd",
        comparison: { batch_id: "b-1", incumbent: "big", recommended: null, rationale: "keep it", runs: ["1", "2"], models: [{ model: "big", run_id: "1" }, { model: "small", run_id: "2" }] },
      }),
    ]);
    expect([backend?.recommended, backend?.rationale, backend?.digest, backend?.runs]).toEqual([null, "keep it", "vd", ["1", "2"]]);
  });

  it("what this card saw finish is shown until the history read holds it, newest first, each once", () => {
    const a = row({ id: "a", at: "2026-10-21T10:00:00Z" });
    const b = row({ id: "b", at: "2026-10-21T11:00:00Z" });
    expect(mergeHistory([a], [b, a]).map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("the set's headline is its latest finished eval: the SQL skips every row that is not done; the history lists them all, with the backend's columns", () => {
    expect(LATEST_DONE_PER_SET).toMatch(/WHERE state = 'done'/);
    expect(LATEST_DONE_PER_SET).toMatch(/DISTINCT ON \(set_id\)/);
    for (const col of ["threshold", "passed_threshold", "by"]) expect(LATEST_DONE_PER_SET).toContain(col);
    expect(SET_HISTORY).not.toMatch(/state = 'done'/);
    for (const col of ["state", "threshold", "passed_threshold", "by", "version", "finished_at", "error"]) expect(SET_HISTORY).toContain(col);
  });

  it("deleting a set keeps the backend's eval records: only rows without the version they measured go", () => {
    expect(DELETE_CONSOLE_HISTORY).toMatch(/^DELETE FROM eval_runs WHERE set_id = \$1 AND /);
    expect(DELETE_CONSOLE_HISTORY).toContain("coalesce(summary->>'version_digest', '') = ''");
  });

  it("the console's schema adds the backend's columns to the shared table, declared exactly as the backend declares them", () => {
    for (const ddl of [
      "ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS threshold double precision;",
      "ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS passed_threshold boolean;",
      "ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS by text NOT NULL DEFAULT '';",
      "ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS state text NOT NULL DEFAULT 'done';",
      "ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS version int;",
      "ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS finished_at timestamptz;",
      "ALTER TABLE eval_runs ADD COLUMN IF NOT EXISTS error text NOT NULL DEFAULT '';",
    ]) {
      expect(REGISTRY_SCHEMA, ddl).toContain(ddl);
    }
    expect(REGISTRY_SCHEMA.indexOf("ADD COLUMN IF NOT EXISTS state")).toBeGreaterThan(REGISTRY_SCHEMA.indexOf("CREATE TABLE IF NOT EXISTS eval_runs"));
  });
});

describe("the L8 attention levers, sparse", () => {
  it("a steer carrying guidance is a redirect, without one a hold; a drift with the fleet's pause is a pause, its link the drift page", () => {
    expect(l5.attentionOf({ kind: "guardian", run: "r", action: { method: "POST", path: "/api/runs/r/steer", body: { guidance: "stay on it" } } }).action.kind).toBe("redirect");
    expect(l5.attentionOf({ kind: "guardian", run: "r", action: { method: "POST", path: "/api/runs/r/steer", body: { hold_at_next_gate: true } } }).action.kind).toBe("hold");
    const drift = l5.attentionOf({ kind: "drift", agent: "a b", action: { method: "POST", path: "/api/fleet", body: { action: "pause", agents: ["a b"], reason: "drift" } }, data: { review: { method: "GET", path: "/api/drift?agent=a%20b" } } });
    expect([drift.action.kind, drift.action.href]).toEqual(["pause", "/drift?agent=a%20b"]);
    // A fleet action that is not a pause is not this lever.
    expect(l5.attentionOf({ kind: "drift", agent: "a", action: { method: "POST", path: "/api/fleet", body: { action: "drain" } } }).action.kind).toBe("open");
  });

  it("the lifecycle page for an override or a rollback: the agent decoded, the digest kept, the deployments for a rollback", () => {
    expect(l5.lifecycleHref("/api/agents/a%20b/lifecycle?digest=d1", "")).toBe("/lifecycle?agent=a+b&digest=d1");
    expect(l5.lifecycleHref("/api/agents/triage/deployments", "")).toBe("/lifecycle?agent=triage#deployments");
    expect(l5.lifecycleHref("/api/elsewhere", "fallback")).toBe("/lifecycle?agent=fallback");
    expect(l5.lifecycleHref("/api/elsewhere", "")).toBe("/lifecycle");
    expect(l5.attentionOf({ kind: "rollback", agent: "x", action: { method: "GET", path: "/api/agents/x/deployments" } }).action).toMatchObject({ kind: "open", href: "/lifecycle?agent=x#deployments" });
  });

  it("each reader reads only its own kind", () => {
    const gate = l5.attentionOf({ kind: "gate", run: "r", action: { method: "POST", path: "/api/approvals/r" } });
    expect([pauseOf(gate), redirectGuidanceOf(gate), driftBenchmarkOf(gate), overrideOfAttention(gate), rollbackOfAttention(gate)]).toEqual([null, "", null, null, null]);
    const bare = l5.attentionOf({ kind: "drift", agent: "a", action: { method: "POST", path: "/api/fleet", body: { action: "pause" } } });
    expect(pauseOf(bare)).toEqual({ agents: ["a"], reason: "" });
  });
});

describe("the guardian's redirect, in words", () => {
  it("every combination of what it may do, and what it raises", () => {
    expect(mayText(["block", "redirect"])).toBe("block (kill) a run, or redirect it with its reason as guidance; a hold is raised for a person");
    expect(mayText(["redirect", "hold"])).toBe("hold a run at its next gate, or redirect it with its reason as guidance; a block is raised for a person");
    expect(outcomeText({ outcome: "acted", action: "redirect", why: "" })).toBe("Redirected: its reason went to the run as guidance for its next model call");
    expect(outcomeText({ outcome: "attention", action: "redirect", why: "" })).toBe("Raised for a person: it would redirect the run, but it may not act");
  });

  it("a guardian note of a redirect without guidance keeps its reason", () => {
    expect(l5.operatorOf({ kind: "note", title: "Guardian: redirected the run", data: { control: "guardian", action: "redirect", reason: "stay on it" } })).toMatchObject({ action: "Guardian redirected the run", detail: "stay on it" });
  });
});

describe("a job's taint and its cancel, a peer's answer", () => {
  it("a taint's parts and its sentence; a job in a line", () => {
    expect([taintOf(null), taintOf(" "), taintOf("upload")]).toEqual([null, null, { source: "upload", kind: "upload", from: "" }]);
    expect(taintLine(taintOf("a2a:")!)).toBe("Untrusted input: an A2A task (taint a2a:). Its input is marked tainted, so a sink it reaches is gated as any outside text is.");
    expect(taintLine(taintOf("upload")!)).toBe("Untrusted input (taint upload): a sink it reaches is gated as any outside text is.");
    expect(jobLine({ status: "failed", source: "api", attempts: 3, max_attempts: 3, error: "boom", dead: true, taint: "x:y" })).toBe("dead letters · from api · attempt 3 of 3 · boom · tainted (x:y)");
    expect(JOB_STATUS_META.cancelled.means).toMatch(/retired/);
  });

  it("a receipt from before the split carries the answer in state; one after, in answered_state; a delivered cancel naming no state asks again", () => {
    const old = reachedOf({ run: "peer:p/t", kind: "peer_task", delivery: "a2a", state: "canceled", peer: "p", task_id: "t" });
    expect([answerOf(old), peerTaskLine(old), reachedStateText(old)]).toEqual(["canceled", "task t at p: cancelled, the peer answered canceled", "answered canceled"]);
    const unknown = reachedOf({ run: "peer:p/t", kind: "peer_task", delivery: "a2a", state: "working", answered_state: "unknown", peer: "p", task_id: "t" });
    expect([answerOf(unknown), peerTaskLine(unknown), reachedStateText(unknown)]).toEqual(["unknown", "task t at p: the cancel was delivered and the peer named no state; a later kill asks again", "answered without a state"]);
    const refusedTask = reachedOf({ run: "peer:p/t", kind: "peer_task", delivery: "a2a-refused", state: "working", peer: "p", task_id: "t", error: "401" });
    expect(answerOf(refusedTask)).toBe("");
    expect([peerCancelLine(null), peerCancelLine({ cancel: null }), peerCancelLine({ cancel: { state: "", by: "", reason: "", delivery: "a2a" } })]).toEqual(["", "", "cancelled over A2A; the peer answered without a state"]);
  });
});

describe("drift against the benchmark", () => {
  it("drifted against the benchmark reads drifted though the trailing windows are thin; not drifted and thin reads not enough", () => {
    const m = (name: "benchmark_outcomes" | "tool_mix", drifted: boolean) => ({ name, kind: "mix" as const, statistic: "jensen_shannon" as const, distance: 0.5, z: null, threshold: 0.2, drifted, enough: true, says: "", recent: {}, baseline: {}, field: null });
    const ev = { id: "ev-1", digest: "abcdef0123", version: null, set: "s", at: "", cases: 1, labeled: false };
    expect(driftVerdict({ enough: false, drifted: true, measures: [], says: "", benchmark: { eval: ev, enough: true, says: "", drifted: true, measures: [m("benchmark_outcomes", true)] } })).toEqual({ tone: "err", label: "Drifted", detail: "shifted: Outcomes vs benchmark" });
    expect(driftVerdict({ enough: false, drifted: false, measures: [], says: "thin", benchmark: null }).label).toBe("Not enough runs");
    expect(benchmarkEvalLine(ev)).toBe("ev-1 · abcdef01 on s, 1 case");
  });
});
