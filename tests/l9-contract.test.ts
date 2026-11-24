import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The generated client as the browser has it, but on an absolute origin (as
// tests/generated-client.test.ts does): Node cannot build a Request for a bare path.
vi.mock("@/lib/api/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api/client")>();
  const { default: createClient } = await import("openapi-fetch");
  return { ...real, api: createClient<import("@/lib/api/backend").paths>({ baseUrl: "http://console.test", credentials: "include", fetch: (r: Request) => globalThis.fetch(r) }) };
});

// Who is signed in, for what a viewer may not do.
const me = vi.hoisted(() => ({ session: null as null | { name: string; email: string; sub: string; sso: boolean; roles: string[]; groups: string[]; appRoles: string[]; permissions: string[] } }));
vi.mock("@/lib/use-session", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/use-session")>();
  return { ...real, useSession: () => ({ session: me.session, loaded: true, can: (p: string) => Boolean(me.session?.permissions.includes(p)), signOut: async () => {} }) };
});

import type { Schemas } from "@/lib/api/client";
import * as l2 from "@/lib/api/l2";
import * as l5 from "@/lib/api/l5";
import * as l7 from "@/lib/api/l7";
import * as l8 from "@/lib/api/l8";
import * as l9 from "@/lib/api/l9";
import { attachedSplit, byIdLine, changeLine, changeSummary, diffCells, diffOf, draftOf, effectiveAt, effectiveProblem, fieldsOf, movesOf, parseProposal, patchOf, proposedField, proposedLine, signedBy, simWindowOf, simulationGaps, simulationLine, targetLine, targetQuery } from "@/lib/policy";
import { CHAIN_META, ledgerHeadline, ledgerNotes, packChainLine, verifyLine } from "@/lib/chain";
import { decisionEntry, hasProvenance, provenanceOf } from "@/lib/provenance";
import { requirementState, tierLine, tierTag } from "@/lib/autonomy";
import { attestationLine, deployedNote, diffLine, dueLine, mayAttest, ownerLine, standingState } from "@/lib/attestations";
import { frameworkLine, isUnmapped, unmappedLine, viewCounts } from "@/lib/frameworks";
import { EMPTY_PACK_FORM, decisionLine, noFiringLine, packLine, packProblem, packQuery, stampLine } from "@/lib/evidence";
import { classLines, chosenLine, impactLine, modelLine } from "@/lib/bom";
import { conditionLabel, itemLine, overrideChoices } from "@/lib/lifecycle";
import { fromDocument, toDocument, validate } from "@/lib/spec";
import type { LineageEntry } from "@/lib/lineage";
import { ChangeDetail, ChangesListView, SimulationView, TargetRules } from "@/components/policy";
import { LedgerBreaks, LedgerWalk, RetentionPanel, RunChainView } from "@/components/chain";
import { EvidencePackView } from "@/components/evidence";
import { AttestationRow, StandingsTable } from "@/components/attestations";
import { AutonomyPanelView } from "@/components/autonomy";
import { BomView } from "@/components/bom";
import { FrameworkViewPanel } from "@/components/frameworks";
import { ProvenanceChain } from "@/components/provenance";
import { LifecycleIndexView } from "@/components/lifecycle";
import { PeerRow } from "@/components/peers";
import { peerRegistryOf } from "@/lib/api/l7b";
import { peerClassLine } from "@/lib/peers";
import { explainControl } from "@/lib/guardrails";
import { declaredTierLabel } from "@/lib/autonomy";

/**
 * The L9 contract, held from the console's side.
 *
 * L5's console was written from the contract's text and replaying the real
 * backend through it then failed 12 of 14 checks, so this phase went the other
 * way: tests/fixtures/l9-captures.json holds every L9 door's real answers,
 * captured from the backend's own app (driven through its doors in-process by
 * backend/scripts/console_l9_capture.py) before any of lib/api/l9.ts was
 * written and again as the doors moved, including the
 * empty states, the refusals (403, 409 naming the door, 400, 404) and every
 * reading of the chain. Each test stubs fetch with those answers and calls the
 * real client, and the last test fails if any capture was not replayed. When a
 * door changes, capture it again and replace the fixture.
 */

/** Vault entries' names, as a peer or an attached agent names the secret it signs with: names only, never values. */
const VAULT = { x: "x-a2a", soc: "soc-a2a" } as const;
const FX = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "l9-captures.json"), "utf-8")) as Record<string, { status: number; body: unknown; headers?: Record<string, string>; bytes?: number }>;
// The vault name peer "soc" was captured with, put back here: in a JSON file a scanner takes any "secret_name" value for a secret.
(FX["peers.classed"].body as { peers: { secret_name: string }[] }).peers[0].secret_name = VAULT.soc;

const replayed = new Set<string>();

const body = <T = Record<string, unknown>,>(name: string): T => {
  replayed.add(name);
  return FX[name].body as T;
};

interface Sent {
  method: string;
  url: string;
  body: unknown;
}
let sent: Sent[] = [];

/** The next fetches answer with these captures, in order. */
function serve(...names: string[]) {
  const queue = [...names];
  vi.stubGlobal("fetch", async (input: Request | string, init?: RequestInit) => {
    // A door of an earlier phase is a plain fetch on a bare path.
    const r = typeof input === "string" ? new Request(`http://console.test${input}`, init) : input;
    const u = new URL(r.url);
    const text = await r.clone().text();
    sent.push({ method: r.method, url: `${u.pathname}${u.search}`, body: text ? JSON.parse(text) : undefined });
    const name = queue.shift();
    if (!name) throw new Error(`no capture left for ${r.method} ${u.pathname}`);
    replayed.add(name);
    const fx = FX[name];
    return new Response(fx.body === null ? "binary" : JSON.stringify(fx.body), { status: fx.status, headers: fx.headers ?? { "content-type": "application/json" } });
  });
}

async function refused(p: Promise<unknown>): Promise<l5.DoorError> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(l5.DoorError);
  return e as l5.DoorError;
}

const html = (el: ReactElement) => renderToStaticMarkup(el);
const ADA = { name: "Ada", email: "ada@example.com" };
const BEN = { name: "Ben", email: "ben@example.com" };
const admin = { name: "Ben", email: "ben@example.com", sub: "iap|ben@example.com", sso: true, roles: [], groups: [], appRoles: ["administrator"], permissions: ["view", "run", "approve", "deploy", "configure", "iam"] };
const viewer = { ...admin, name: "Owen", email: "owen@example.com", sub: "iap|owen@example.com", appRoles: ["viewer"], permissions: ["view"] };

beforeEach(() => {
  sent = [];
  me.session = admin;
});
afterEach(() => vi.unstubAllGlobals());

/* ═══════════════════ policy as reviewed change ═══════════════════ */

describe("the targets", () => {
  it("reads every kind, its fields and labels, and the estate's rules now", async () => {
    serve("targets.viewer");
    const t = await l9.listPolicyTargets();
    expect(sent[0]).toMatchObject({ method: "GET", url: "/api/policy/targets" });
    expect(t.door).toBe("POST /api/policy/changes");
    expect(t.targets.map((x) => x.kind)).toEqual(["attached", "guardian", "breakers", "rate_limits", "screener", "retention", "redaction", "autonomy_tiers", "attestation", "peer"]);
    const guardian = t.targets.find((x) => x.kind === "guardian");
    expect(guardian?.replaces).toBe("PUT /api/guardian");
    expect(guardian?.labels.max_actions_per_hour).toBe("guardian's hourly cap");
    expect(guardian?.current?.enabled).toBe(false);
    expect(t.targets.find((x) => x.kind === "attached")?.current).toBeNull();
    expect(t.targets.find((x) => x.kind === "rate_limits")?.ids).toBe("estate_or_agent");
    expect(t.targets.find((x) => x.kind === "redaction")?.enforced).toMatch(/^runtime/);
  });

  it("reads them again once rules have moved, and shows a redaction set", async () => {
    serve("targets.after", "targets.redaction_set");
    expect((await l9.listPolicyTargets()).targets.find((x) => x.kind === "guardian")?.current?.max_actions_per_hour).toBe(10);
    const red = (await l9.listPolicyTargets()).targets.find((x) => x.kind === "redaction");
    expect(red?.current?.internal).toEqual(["email"]);
    const out = html(createElement(TargetRules, { target: red as l9.TargetKind }));
    expect(out).toContain("redacted from internal up");
    expect(out).toContain("email");
  });

  it("makes each target a form from what the door serves: the kind read from the rules it holds", async () => {
    serve("targets.viewer");
    const { targets } = await l9.listPolicyTargets();
    const of = (k: string) => targets.find((x) => x.kind === k) as l9.TargetKind;
    const kinds = (k: string, cur: Record<string, unknown> | null) => Object.fromEntries(fieldsOf(of(k), cur).map((f) => [f.name, f.kind]));
    expect(kinds("breakers", of("breakers").current)).toEqual({ calls: "number", window_s: "number", failures: "number", cooldown_s: "number" });
    expect(kinds("screener", of("screener").current)).toEqual({ fail_open: "bool", patterns: "list" });
    expect(kinds("retention", of("retention").current).runs).toBe("number");
    expect(kinds("redaction", of("redaction").current).patterns).toBe("json");
    expect(kinds("autonomy_tiers", of("autonomy_tiers").current).L3).toBe("list");
    expect(kinds("attached", null)).toEqual({ grants: "list", gate_at: "choice" });
    expect(kinds("attestation", null)).toEqual({ period_days: "number" });
    expect(kinds("guardian", of("guardian").current).agents).toBe("list");
    // Every field the door names has a kind and a label.
    for (const t of targets) for (const f of fieldsOf(t, t.current)) expect(f.label, `${t.kind}.${f.name}`).toBeTruthy();
  });

  it("proposes only what moved, in the door's own field names, and a number stays a number", async () => {
    serve("targets.viewer");
    const { targets } = await l9.listPolicyTargets();
    const b = targets.find((x) => x.kind === "breakers") as l9.TargetKind;
    const fields = fieldsOf(b, b.current);
    const draft = draftOf(fields, b.current);
    expect(patchOf(fields, draft, b.current).patch).toEqual({});
    expect(patchOf(fields, { ...draft, calls: "7" }, b.current).patch).toEqual({ calls: 7 });
    expect(patchOf(fields, { ...draft, calls: "many" }, b.current).problems.calls).toBe("a number, please");
    const r = targets.find((x) => x.kind === "retention") as l9.TargetKind;
    const rf = fieldsOf(r, r.current);
    const rd = draftOf(rf, r.current);
    expect(patchOf(rf, { ...rd, runs: "365" }, r.current).patch).toEqual({ runs: 365 });
    const j = targets.find((x) => x.kind === "redaction") as l9.TargetKind;
    const jf = fieldsOf(j, j.current);
    const jd = draftOf(jf, j.current);
    expect(patchOf(jf, { ...jd, patterns: '{"employee_id": "EMP-\\\\d{6}"}' }, j.current).patch).toEqual({ patterns: { employee_id: "EMP-\\d{6}" } });
    expect(patchOf(jf, { ...jd, patterns: "[1]" }, j.current).problems.patterns).toBe("a JSON object, please");
    // A guardian watching every agent goes back as the string.
    const g = targets.find((x) => x.kind === "guardian") as l9.TargetKind;
    const gf = fieldsOf(g, g.current);
    expect(patchOf(gf, { ...draftOf(gf, g.current), agents: ["*"] }, g.current).patch).toEqual({ agents: "*" });
  });
});

describe("the changes", () => {
  it("reads an empty history as empty, and says so", async () => {
    serve("changes.empty");
    const l = await l9.listPolicyChanges();
    expect(l).toEqual({ changes: [], count: 0, states: {} });
    expect(html(createElement(ChangesListView, { list: l }))).toContain("No policy change is on record");
    expect(html(createElement(ChangesListView, { list: l, filtered: true }))).toContain("No change matches");
  });

  it("filters by target and state on the door's own query", async () => {
    serve("changes.by_target", "changes.by_state");
    const a = await l9.listPolicyChanges({ target: "guardian" });
    const b = await l9.listPolicyChanges({ state: "applied" });
    expect(sent[0].url).toBe("/api/policy/changes?target=guardian");
    expect(sent[1].url).toBe("/api/policy/changes?state=applied");
    expect(a.changes.every((c) => c.target.kind === "guardian")).toBe(true);
    expect(b.changes.every((c) => c.state === "applied")).toBe(true);
    expect(b.states.applied).toBe(b.count);
  });

  it("names the field of a bad filter, and a change that is not on record", async () => {
    serve("changes.bad_state", "changes.bad_target", "change.not_found");
    expect((await refused(l9.listPolicyChanges({ state: "nonsense" as l9.ChangeState }))).field).toBe("state");
    expect((await refused(l9.listPolicyChanges({ target: "nonsense" }))).field).toBe("target");
    const e = await refused(l9.getPolicyChange("pc-0000000000000000"));
    expect(e.status).toBe(404);
    expect(e.message).toContain("no policy change");
  });

  it("sends a proposal as the door takes it and reads the pending change with its diff", async () => {
    serve("propose.pending");
    const c = await l9.proposePolicyChange({ target: { kind: "guardian" }, proposed: { max_actions_per_hour: 15 }, reason: "more room" });
    expect(sent[0]).toMatchObject({ method: "POST", url: "/api/policy/changes" });
    expect(sent[0].body).toEqual({ target: { kind: "guardian", id: "" }, proposed: { max_actions_per_hour: 15 }, effective_at: null, reason: "more room" });
    expect(c.state).toBe("pending");
    expect(c.target).toEqual({ kind: "guardian", id: "estate" });
    expect(c.diff.summary).toEqual(["guardian's hourly cap: 10 → 15"]);
    expect(c.diff.changes[0]).toEqual({ field: "max_actions_per_hour", label: "guardian's hourly cap", from: 10, to: 15, added: null, removed: null, changed: null });
    expect(c.before).toBeNull();
    expect(c.audit_id).toEqual(expect.any(Number));
    expect(diffCells(c.diff.changes[0])).toEqual({ from: "10", to: "15" });
    expect(changeLine(c)).toBe("Waiting for someone other than Ada <ada@example.com> to review it; applied at once on approval.");
    expect(proposedLine(c)).toContain("Someone other than you reviews it");
    expect(targetLine(c.target)).toBe("Guardian");
    expect(targetQuery(c.target)).toBe("guardian");
  });

  it("reads each target's proposal in its own vocabulary", () => {
    const list = l9.policyChangeOf(body("propose.pending.list"));
    expect(list.diff.changes[0].added).toEqual(["add me"]);
    expect(list.diff.changes[0].removed).toEqual(["drop me"]);
    expect(diffCells(list.diff.changes[0])).toEqual({ from: "removes drop me", to: "adds add me" });
    const named = l9.policyChangeOf(body("propose.pending.redaction"));
    expect(named.diff.changes.find((c) => c.field === "patterns")?.added).toEqual(["employee_id"]);
    expect(named.diff.changes.find((c) => c.field === "patterns")?.changed).toEqual([]);
    expect(diffCells(named.diff.changes.find((c) => c.field === "patterns") as l9.DiffChange).to).toBe("adds employee_id");
    expect(l9.policyChangeOf(body("propose.pending.redaction2")).diff.summary).toContain("redacted from internal up email added");
    const r = l9.policyChangeOf(body("propose.pending.retention"));
    expect(diffCells(r.diff.changes[0]).from).toBe("unset");
    expect(r.diff.summary).toEqual(["runs kept (days): unset → 365", "journals kept (days): unset → 180"]);
    const rate = l9.policyChangeOf(body("propose.pending.rate"));
    expect(targetLine(rate.target)).toBe("Rate limits, tiny");
    expect(targetQuery(rate.target)).toBe("rate_limits:tiny");
    expect(l9.policyChangeOf(body("propose.pending.tiers")).proposed).toEqual({ attestation_within_days: 14 });
    expect(l9.policyChangeOf(body("propose.pending.attestation")).proposed).toEqual({ period_days: 30 });
    const att = l9.policyChangeOf(body("propose.pending.attached"));
    expect(att.diff.summary.some((s) => s.includes("gate risk: never → write for copilot"))).toBe(true);
    expect(diffCells(att.diff.changes.find((c) => c.field === "gate_at") as l9.DiffChange).from).toBe("none");
    const eff = l9.policyChangeOf(body("propose.pending.effective"));
    expect(eff.effective_at).toBeTruthy();
    expect(changeLine(eff)).toContain("once approved");
    const mixed = l9.policyChangeListOf(body("changes.mixed"));
    expect(mixed.states.pending).toBe(mixed.count);
    expect(html(createElement(ChangesListView, { list: mixed, selected: mixed.changes[0].id }))).toContain(mixed.changes[0].id);
  });

  it("says what was refused: who, what, and which field", async () => {
    serve(
      "propose.refused.viewer", "propose.refused.operator", "propose.refused.unsigned", "propose.refused.key", "propose.refused.kind", "propose.refused.spec", "propose.refused.id", "propose.refused.ghost",
      "propose.refused.field", "propose.refused.value", "propose.refused.nothing", "propose.refused.effective", "propose.refused.same", "propose.refused.no_reason", "propose.refused.blank_reason", "propose.refused.grant",
    );
    const go = () => refused(l9.proposePolicyChange({ target: { kind: "breakers" }, proposed: { calls: 3 }, reason: "x" }));
    const viewerE = await go();
    expect(viewerE.status).toBe(403);
    expect(viewerE.message).toContain('needs the "configure" permission; your roles: viewer');
    expect((await go()).message).toContain("your roles: operator");
    const unsigned = await go();
    expect(unsigned.status).toBe(401);
    expect(unsigned.body.reauth).toBe(true);
    expect((await go()).message).toContain("your roles: none");
    expect((await go()).field).toBe("target.kind");
    const spec = await go();
    expect(spec.field).toBe("target.kind");
    expect(spec.message).toContain("POST /api/agents");
    expect((await go()).field).toBe("target.id");
    const ghost = await go();
    expect(ghost.status).toBe(404);
    expect(ghost.field).toBe("target.id");
    const field = await go();
    expect(field.field).toBe("proposed.nope");
    expect(proposedField(field)).toBe("nope");
    expect(proposedField(await go())).toBe("calls");
    const nothing = await go();
    expect(nothing.field).toBe("proposed");
    expect(proposedField(nothing)).toBeNull();
    expect((await go()).field).toBe("effective_at");
    expect((await go()).message).toContain("the proposal changes nothing");
    expect((await go()).field).toBe("reason");
    expect((await go()).field).toBe("reason");
    expect(proposedField(await go())).toBe("grants");
  });

  it("approves, and an approved change with a time waits for it", async () => {
    serve("approve.applied", "approve.scheduled");
    const c = await l9.approvePolicyChange("pc-1", "agreed");
    expect(sent[0]).toMatchObject({ method: "POST", url: "/api/policy/changes/pc-1/approve", body: { note: "agreed" } });
    expect(c.state).toBe("applied");
    expect(c.applied_by).toBe("Ben <ben@example.com>");
    expect(c.note).toBe("agreed");
    expect(c.before?.max_actions_per_hour).toBe(10);
    expect(c.after?.max_actions_per_hour).toBe(15);
    expect(c.applied_diff?.summary).toEqual(["guardian's hourly cap: 10 → 15"]);
    expect(c.history.map((h) => h.state)).toEqual(["pending", "approved", "applied"]);
    expect(diffOf(c)).toBe(c.applied_diff);
    const held = await l9.approvePolicyChange("pc-2");
    expect(held.state).toBe("approved");
    expect(held.applied_at).toBeNull();
    expect(changeLine(held)).toContain("the scheduler applies it at");
    const applied = l9.policyChangeOf(body("change.applied_by_scheduler"));
    expect(applied.applied_by).toBe("scheduler");
    expect(applied.approved_by).toBe("Ben <ben@example.com>");
    expect(l9.policyChangeOf(body("approve.applied.attached")).after?.gate_at).toBe("write");
    expect(l9.policyChangeOf(body("approve.applied.redaction")).state).toBe("applied");
  });

  it("refuses the proposer, a viewer, a change already moved, and shows the state it is in", async () => {
    serve("approve.refused.proposer", "approve.refused.viewer", "approve.refused.twice", "approve.refused.rejected", "reject.refused.applied", "reject.refused.no_reason", "rollback.refused.pending", "rollback.refused.no_reason", "rollback.refused.viewer", "rollback.refused.again");
    const own = await refused(l9.approvePolicyChange("pc-1"));
    expect(own.status).toBe(403);
    expect(own.control).toBe("separation_of_duties");
    expect(own.body.proposed_by).toBe("Ada <ada@example.com>");
    expect((await refused(l9.approvePolicyChange("pc-1"))).message).toContain("your roles: viewer");
    const twice = await refused(l9.approvePolicyChange("pc-1"));
    expect(twice.status).toBe(409);
    expect(twice.body.state).toBe("applied");
    expect((await refused(l9.approvePolicyChange("pc-1"))).body.state).toBe("rejected");
    expect((await refused(l9.rejectPolicyChange("pc-1", "no"))).body.state).toBe("applied");
    expect((await refused(l9.rejectPolicyChange("pc-1", ""))).field).toBe("reason");
    expect((await refused(l9.rollbackPolicyChange("pc-1", "undo"))).body.state).toBe("pending");
    expect((await refused(l9.rollbackPolicyChange("pc-1", ""))).field).toBe("reason");
    expect((await refused(l9.rollbackPolicyChange("pc-1", "undo"))).status).toBe(403);
    expect((await refused(l9.rollbackPolicyChange("pc-1", "again"))).body.state).toBe("rolled_back");
  });

  it("rejects with a reason, and reads the closed change", async () => {
    serve("reject.done");
    const c = await l9.rejectPolicyChange("pc-1", "too tight for the batch window");
    expect(sent[0]).toMatchObject({ url: "/api/policy/changes/pc-1/reject", body: { reason: "too tight for the batch window" } });
    expect(c.state).toBe("rejected");
    expect(changeSummary(c)).toBe("breaker calls threshold: 200 → 7");
    expect(c.reject_reason).toBe("too tight for the batch window");
    expect(changeLine(c)).toBe("Rejected by Ben <ben@example.com>: too tight for the batch window");
  });

  it("rolls back as a recorded emergency, and links the two changes", async () => {
    serve("rollback.done");
    const back = await l9.rollbackPolicyChange("pc-1", "the cap let a run through");
    expect(back.emergency).toBe(true);
    expect(back.state).toBe("applied");
    expect(back.rollback_of).toBeTruthy();
    expect(changeLine(back)).toContain("Emergency rollback by Ada <ada@example.com>");
    const undone = l9.policyChangeOf(body("change.rolled_back"));
    expect(undone.state).toBe("rolled_back");
    expect(undone.rolled_back_by).toBe(back.id);
    expect(undone.rolled_back_at).toBeTruthy();
    const row = l9.policyChangeOf(body("change.rollback_row"));
    expect(row.note).toBe("emergency rollback: no second person");
    const out = html(createElement(ChangeDetail, { change: back, who: ADA }));
    expect(out).toContain("emergency");
    expect(out).toContain(`/policy?change=${back.rollback_of}`);
    expect(html(createElement(ChangeDetail, { change: undone, who: ADA }))).toContain(`/policy?change=${back.id}`);
  });

  it("says why a change failed when it fell due", () => {
    const c = l9.policyChangeOf(body("change.failed"));
    expect(c.state).toBe("failed");
    expect(c.error).toBe('no attached agent "copilot"');
    expect(changeLine(c)).toContain('Failed when it fell due: no attached agent "copilot"');
  });

  it("offers each move only where the change allows it, and the proposer never the approval", () => {
    const pending = l9.policyChangeOf(body("propose.pending"));
    expect(signedBy(pending.proposed_by, ADA)).toBe(true);
    expect(signedBy(pending.proposed_by, BEN)).toBe(false);
    expect(signedBy(pending.proposed_by, null)).toBe(false);
    expect(movesOf(pending, ADA).approve).toEqual({ open: false, why: "you proposed it: its proposer may not approve it; another administrator does" });
    expect(movesOf(pending, BEN).approve.open).toBe(true);
    expect(movesOf(pending, BEN).rollback.open).toBe(false);
    const applied = l9.policyChangeOf(body("approve.applied"));
    expect(movesOf(applied, BEN).rollback.open).toBe(true);
    expect(movesOf(applied, BEN).approve.open).toBe(false);
    expect(movesOf(applied, BEN).reject.open).toBe(false);
    const held = l9.policyChangeOf(body("approve.scheduled"));
    expect(movesOf(held, BEN).reject.open).toBe(true);
  });

  it("renders a viewer's moves disabled, and an administrator's enabled", () => {
    const pending = l9.policyChangeOf(body("propose.pending"));
    const button = (out: string, name: string) => new RegExp(`<button[^>]*>${name}`).exec(out)?.[0] ?? "";
    const off = 'disabled=""';
    me.session = viewer;
    const asViewer = html(createElement(ChangeDetail, { change: pending, who: { name: "Owen", email: "owen@example.com" } }));
    expect(button(asViewer, "Approve")).toContain(off);
    expect(button(asViewer, "Approve")).toContain('Needs the &quot;configure&quot; permission');
    expect(button(asViewer, "Reject")).toContain(off);
    me.session = admin;
    const asAdmin = html(createElement(ChangeDetail, { change: pending, who: BEN }));
    expect(button(asAdmin, "Approve")).not.toContain(off);
    expect(button(asAdmin, "Reject")).not.toContain(off);
    const asProposer = html(createElement(ChangeDetail, { change: pending, who: ADA }));
    expect(button(asProposer, "Approve")).toContain(off);
    expect(asProposer).toContain("its proposer may not approve it");
    const applied = html(createElement(ChangeDetail, { change: l9.policyChangeOf(body("approve.applied")), who: BEN }));
    expect(button(applied, "Emergency rollback")).toContain("bg-err");
    expect(button(applied, "Emergency rollback")).toContain("text-on-solid");
  });

  it("takes an effective time in the person's zone and refuses one that has passed", () => {
    expect(effectiveAt("")).toBeNull();
    expect(effectiveAt("2030-01-02T03:04")).toBe(new Date("2030-01-02T03:04").toISOString());
    expect(effectiveProblem("")).toBe("");
    expect(effectiveProblem("2000-01-01T00:00")).toContain("that time has passed");
    expect(effectiveProblem("2999-01-01T00:00")).toBe("");
  });
});

describe("the direct writes the door replaced", () => {
  it("shows the 409 and carries the door and the proposal", async () => {
    serve("direct.attached.grants", "direct.attached.gate", "direct.attached.both");
    const g = body<{ error: string }>("direct.guardian");
    expect(g.error).toBe("guardian is a policy target: it changes only through a reviewed policy change (POST /api/policy/changes), approved by someone other than its proposer");
    const read = l9.directWriteRefusalOf(409, g);
    expect(read?.door).toBe("POST /api/policy/changes");
    expect(read?.proposal.proposed).toEqual({ enabled: true, max_actions_per_hour: 9 });
    expect(read?.target).toEqual({ kind: "guardian", id: "estate" });
    const a = await refused(l2.setAttachedPolicy({ id: "copilot", grants: ["crm.lookup"] }).catch((e: Error & { status?: number }) => Promise.reject(new l5.DoorError(e.message, 409, {}))));
    expect(a.message).toContain("attached copilot is a policy target");
    await expect(l2.setAttachedPolicy({ id: "copilot", gate_at: "write" })).rejects.toThrow("POST /api/policy/changes");
    await expect(l2.setAttachedPolicy({ id: "copilot", grants: ["crm.lookup"], gate_at: "write", injection: "flag" })).rejects.toThrow("it changes only through a reviewed policy change");
    expect(l9.directWriteRefusalOf(409, body("direct.attached.both"))?.proposal.proposed).toEqual({ gate_at: "write", grants: ["crm.lookup"] });
    expect(l9.directWriteRefusalOf(409, { control: "paused" })).toBeNull();
    expect(l9.directWriteRefusalOf(403, body("direct.guardian"))).toBeNull();
  });

  it("keeps what is still the attached door's, and sends grants and the gate to review", async () => {
    serve("attached.list", "direct.attached.injection", "attached.list.after");
    const row = (await l2.listAttached()).agents[0];
    expect(row.grants).toEqual([]);
    const draft = { grants: ["crm.lookup"], gate_at: "write", injection: "block", secret_name: "" };
    const split = attachedSplit(row, draft);
    expect(split.reviewed).toEqual({ grants: ["crm.lookup"], gate_at: "write" });
    expect(split.direct).toEqual({ injection: "block" });
    await l2.setAttachedPolicy({ id: row.id, ...split.direct } as l2.PolicyPatch);
    expect(Object.keys(sent[1].body as object).sort()).toEqual(["id", "injection"]);
    expect(attachedSplit(row, { grants: [], gate_at: "", injection: row.injection, secret_name: "" })).toEqual({ reviewed: {}, direct: {} });
    expect(attachedSplit(row, { grants: [], gate_at: "", injection: row.injection, secret_name: VAULT.x }).direct).toEqual({ secret_name: VAULT.x });
    const after = (await l2.listAttached()).agents[0];
    expect(after.grants).toEqual(["crm.lookup", "crm.update"]);
    expect(after.gate_at).toBe("write");
  });


  it("calls neither door from a page: the guardian proposes, and the attached editor sends only its own fields", () => {
    const src = (f: string) => readFileSync(path.join(__dirname, "..", f), "utf-8");
    expect(src("components/guardian.tsx")).not.toMatch(/setGuardian/);
    expect(src("components/guardian.tsx")).toContain("proposePolicyChange");
    expect(src("components/attached-agents.tsx")).toContain("attachedSplit");
    expect(src("lib/attached.ts")).toContain("/api/policy/changes");
    expect(src("lib/attached.ts")).not.toMatch(/PATCH[^\n]*"grants"/);
  });
});

/* ═══════════════════ simulation ═══════════════════ */

describe("simulation", () => {
  it("sends what is proposed and reads a call newly refused", async () => {
    serve("simulate.refused_row");
    const r = await l9.simulatePolicy({ agent: "acts", proposed: { grants: [{ node: "act", tools: [] }] }, window: "7d" });
    expect(sent[0]).toMatchObject({ method: "POST", url: "/api/policy/simulate", body: FX["simulate.refused_row"] && { agent: "acts", window: "7d" } });
    expect(r.runs).toBe(1);
    expect(r.summary).toEqual({ newly_refused: 1, newly_gated: 0, newly_allowed: 0 });
    expect(r.changed[0]).toMatchObject({ tool: "store.put", node: "act", was: "allowed", would_be: "refused", control: "capability", redacted_args: null });
    expect(r.target).toEqual({ kind: "spec", id: "acts" });
    expect(simulationLine(r)).toBe("1 recorded call in 1 run ruled again: 1 newly refused.");
  });

  it("reads each ruling and the window, and renders the table", () => {
    const gated = l9.simulationOf(body("simulate.gated"));
    expect(gated.changed[0].would_be).toBe("gated");
    expect(gated.window.from).toBeTruthy();
    const allowed = l9.simulationOf(body("simulate.allowed"));
    expect(allowed.changed[0].was).toBe("refused");
    expect(allowed.summary.newly_allowed).toBe(1);
    const attached = l9.simulationOf(body("simulate.attached"));
    expect(attached.target.kind).toBe("attached");
    expect(attached.calls).toBe(3);
    const out = html(createElement(SimulationView, { result: attached }));
    expect(out).toContain("crm.update");
    expect(out).toContain("/runs?id=copilot-b1");
    expect(out).toContain("nothing was executed");
  });

  it("says when nothing would change and when no run was in the window", () => {
    const none = l9.simulationOf(body("simulate.nothing"));
    expect(simulationLine(none)).toBe("1 recorded call in 1 run ruled again: nothing would change.");
    const empty = l9.simulationOf(body("simulate.empty_window"));
    expect(empty.runs).toBe(0);
    expect(simulationLine(empty)).toBe("No run in that window to rule again.");
    expect(simulationGaps(empty)).toEqual([]);
  });

  it("says a run was ruled on its redacted record", () => {
    const r = l9.simulationOf(body("simulate.redacted"));
    expect(r.changed[0].redacted_args).toEqual(["data.args.key"]);
    expect(html(createElement(SimulationView, { result: r }))).toContain("Ruled on the redacted record: data.args.key");
  });

  it("names what it left out", () => {
    const r = l9.simulationOf({ ...body<Record<string, unknown>>("simulate.nothing"), excluded: { shadow: 1, no_spec: 2, no_journal: 1 }, truncated: true, skipped: [{ tool: "x" }] });
    expect(simulationGaps(r)).toEqual(["1 shadow run left out: a mirror executes nothing above read", "2 runs left out: the spec it ran under is not on record", "1 run left out: its journal is gone", "1 call could not be ruled again", "The limit left older runs out; widen it, or narrow the window"]);
  });

  it("refuses by name: a target that decides nothing per call, a bad window, a proposal that does not load", async () => {
    serve("simulate.refused.kind", "simulate.refused.window", "simulate.refused.no_window", "simulate.refused.no_subject", "simulate.refused.agent", "simulate.refused.proposal", "simulate.refused.fixed_step", "simulate.refused.grant");
    const go = () => refused(l9.simulatePolicy({ agent: "acts", proposed: {}, window: "7d" }));
    const kind = await go();
    expect(kind.field).toBe("target.kind");
    expect(kind.message).toContain("guardian decides nothing per call");
    expect((await go()).field).toBe("window");
    expect((await go()).field).toBe("window");
    expect((await go()).field).toBe("agent");
    expect((await go()).status).toBe(404);
    const bad = await go();
    expect(bad.field).toBe("proposed");
    expect(bad.body.path).toBe("$.spec.policy.grants");
    const fixed = await go();
    expect(String(fixed.body.path)).toContain("steps[put]");
    expect(fixed.message).toContain("not granted");
    expect((await go()).field).toBe("proposed.grants");
  });

  it("builds the window and reads the proposal as typed", () => {
    expect(simWindowOf("7d", "", "")).toBe("7d");
    const w = simWindowOf("period", "2026-10-01T00:00", "2026-10-02T00:00") as { from: string; to: string };
    expect(w.from).toBe(new Date("2026-10-01T00:00").toISOString());
    expect(parseProposal("{not json")).toEqual({ problem: "the proposal is not valid JSON" });
    expect(parseProposal("[]")).toMatchObject({ problem: expect.stringContaining("a JSON object") });
    expect(parseProposal('{"grants": []}')).toEqual({ proposed: { grants: [] } });
  });
});

/* ═══════════════════ the chain ═══════════════════ */

describe("a run's chain", () => {
  it("reads ok", async () => {
    serve("run_verify.ok");
    const v = await l9.verifyRun("run-1");
    expect(sent[0].url).toBe("/api/runs/run-1/verify");
    expect(v).toMatchObject({ chain: "ok", valid: true, anchored: true, broken_at: null, pending: 0, tombstone: null, previous: "", entries: 5 });
    expect(v.recorded?.seq).toBe(1);
    expect(v.recorded?.anchor).toBe(v.anchor);
    expect(verifyLine(v)).toBe("Every entry hashes to the next and the last is anchored in the ledger. Anchor 1 in the ledger.");
    expect(l9.runVerificationOf(body("run_verify.answered")).chain).toBe("ok");
  });

  it("reads broken, says where, and is not valid", () => {
    const v = l9.runVerificationOf(body("run_verify.broken"));
    expect(v).toMatchObject({ chain: "broken", valid: false, anchored: false, broken_at: 1 });
    expect(verifyLine(v)).toBe("At entry 1: entry 1 is not what was written: its hash does not match its content. Anchor 1 in the ledger.");
  });

  it("reads entries cut off the end, past the last one left", () => {
    const v = l9.runVerificationOf(body("run_verify.broken_cut"));
    expect(v.broken_at).toBe(v.entries);
    expect(verifyLine(v)).toContain("Past entry 2:");
    expect(verifyLine(v)).toContain("entries were cut off the end");
  });

  it("reads unanchored, with the note waiting outside the chain", () => {
    const v = l9.runVerificationOf(body("run_verify.unanchored"));
    expect(v).toMatchObject({ chain: "unanchored", valid: true, anchored: false, pending: 1, recorded: null });
    expect(verifyLine(v)).toBe("The run is still being written. 1 note waits outside the chain until the run rests.");
  });

  it("reads unchained as never valid", () => {
    const v = l9.runVerificationOf(body("run_verify.unchained"));
    expect(v).toMatchObject({ chain: "unchained", valid: false, anchor: "", broken_at: null });
    expect(verifyLine(v)).toContain("No entry carries a hash");
  });

  it("reads tombstoned, for a deleted run and for a deleted journal", () => {
    const run = l9.runVerificationOf(body("run_verify.tombstoned"));
    expect(run).toMatchObject({ chain: "tombstoned", valid: true, anchored: true });
    expect(run.tombstone?.class).toBe("runs");
    expect(run.tombstone?.tombstone).toMatch(/^ts-/);
    expect(run.tombstone?.digest).toMatch(/^sha256:/);
    const journal = l9.runVerificationOf(body("run_verify.tombstoned_journal"));
    expect(journal.tombstone?.class).toBe("journals");
    expect(journal.tombstone?.count).toBe(5);
    expect(verifyLine(journal)).toContain("Retention deleted 5 entries of this journal");
  });

  it("answers 404 for no such run", async () => {
    serve("run_verify.not_found");
    expect((await refused(l9.verifyRun("no-such-run"))).status).toBe(404);
  });

  it("has a word and a tone for every reading", () => {
    for (const c of l9.CHAIN_STATES) expect(CHAIN_META[c].label).toBeTruthy();
    expect(CHAIN_META.broken.tone).toBe("err");
    expect(CHAIN_META.unchained.tone).toBe("neutral");
  });
});

describe("the ledger", () => {
  it("reads an empty ledger as empty, not as verified", async () => {
    serve("ledger.empty");
    const l = await l9.verifyLedger();
    expect(sent[0].url).toBe("/api/ledger/verify");
    expect(l).toMatchObject({ valid: true, anchors: 0, runs: 0, head: null, first_break: null, breaks: [], walk: [], truncated: false });
    expect(ledgerHeadline(l).title).toBe("Nothing anchored in this view");
  });

  it("walks the rows, and counts a run from before the chain without failing", async () => {
    serve("ledger.ok", "ledger.scoped");
    const l = await l9.verifyLedger({ agent: "tiny", limit: 5, from: "2026-01-01T00:00:00Z" });
    expect(sent[0].url).toContain("agent=tiny");
    expect(sent[0].url).toContain("from=2026-01-01");
    expect(l.valid).toBe(true);
    expect(l.counts).toEqual({ ok: 2, broken: 0, unanchored: 0, unchained: 1, tombstoned: 0 });
    expect(l.walk.map((r) => [r.seq, r.chain, r.kind])).toEqual([
      [1, "ok", "run"],
      [2, "ok", "run"],
    ]);
    expect(l.head?.seq).toBe(2);
    expect(ledgerHeadline(l).title).toBe("The ledger verifies");
    expect(ledgerNotes(l)).toEqual(["1 run is from before the chain: counted, never verified"]);
    expect((await l9.verifyLedger({ agent: "tiny", limit: 1 })).anchors).toBeGreaterThan(0);
  });

  it("names a broken run, and where", () => {
    const l = l9.ledgerOf(body("ledger.broken"));
    expect(l.valid).toBe(false);
    expect(l.first_break).toMatchObject({ seq: 1, broken_at: 1 });
    expect(l.walk[0]).toMatchObject({ chain: "broken", broken_at: 1 });
    expect(l.counts.broken).toBe(1);
    const head = ledgerHeadline(l);
    expect(head.tone).toBe("err");
    expect(head.title).toBe("The ledger does not verify");
  });

  it("names a gap, and a genesis no row holds, which are no one run's reading", () => {
    const l = l9.ledgerOf(body("ledger.gap"));
    expect(l.valid).toBe(false);
    expect(l.breaks).toHaveLength(3);
    expect(l.breaks[1]).toMatchObject({ seq: 3, broken_at: null, reason: "anchors 2 to 2 are missing from the ledger" });
    expect(l.breaks[2].reason).toContain("no earlier row of the ledger holds");
  });

  it("reads a tombstone's row beside the run it stands in for", () => {
    const l = l9.ledgerOf(body("ledger.tombstoned"));
    expect(l.valid).toBe(true);
    expect(l.counts.tombstoned).toBe(1);
    expect(l.walk.map((r) => r.kind)).toEqual(["run", "run", "tombstone"]);
  });

  it("counts a run in flight with no row, without failing the walk", () => {
    const l = l9.ledgerOf(body("ledger.with_running"));
    expect(l).toMatchObject({ valid: true, anchors: 0 });
    expect(l.counts.unanchored).toBe(1);
    expect(ledgerHeadline(l).line).toContain("have no row yet");
    expect(ledgerNotes(l)).toEqual(["1 run has no anchor yet"]);
  });

  it("names the field of a bad walk", async () => {
    serve("ledger.bad_from", "ledger.bad_order", "ledger.bad_agent");
    expect((await refused(l9.verifyLedger({ from: "soon" }))).field).toBe("from");
    expect((await refused(l9.verifyLedger({ from: "b", to: "a" }))).message).toBe("from is before to");
    expect((await refused(l9.verifyLedger({ agent: "Not An Agent" }))).field).toBe("agent");
  });
});

describe("retention", () => {
  it("reads no rule as keeping everything", async () => {
    serve("retention.empty");
    const r = await l9.getRetention();
    expect(r.rules).toEqual({ auth_events: null, deliverables: null, evals: null, journals: null, runs: null });
    expect(r.tombstones).toEqual([]);
  });

  it("reads the rules, the last sweep and what it left", async () => {
    serve("retention.rules_no_stones", "retention.with_tombstones");
    expect((await l9.getRetention()).rules.runs).toBe(30);
    const r = await l9.getRetention({ class: "runs" });
    expect(sent[1].url).toBe("/api/retention?class=runs");
    expect(r.tombstones[0]).toMatchObject({ class: "runs", by: "retention" });
    expect(r.tombstones[0].id).toMatch(/^ts-/);
    expect(r.last_sweep[0]).toMatchObject({ class: "runs", deleted: 1 });
  });

  it("names a class that is not one", async () => {
    serve("retention.bad_class");
    expect((await refused(l9.getRetention({ class: "nonsense" }))).field).toBe("class");
  });
});

/* ═══════════════════ rules per target ═══════════════════ */

describe("rules held per id", () => {
  const targets = () => l9.targetKindsOf(body("targets.by_id")).targets;
  const of = (kind: string) => targets().find((t) => t.kind === kind) as l9.TargetKind;

  it("lists each id's own rules beside the estate's", () => {
    expect(of("rate_limits").by_id.tiny.run_starts_per_minute).toBe(2);
    expect(of("rate_limits").current?.run_starts_per_minute).not.toBe(2);
    expect(of("attestation").by_id).toEqual({ tiny: { period_days: 30 } });
    expect(of("peer").by_id.soc).toEqual({ data_class: "confidential", max_data_class: "internal" });
    const out = html(createElement(TargetRules, { target: of("rate_limits") }));
    expect(out).toContain("tiny");
    expect(out).toContain("run starts per minute 2");
    expect(byIdLine(of("peer"), { data_class: "", max_data_class: "internal" })).toBe("highest class the peer takes internal");
    expect(byIdLine(of("rate_limits"), { run_starts_per_minute: null })).toBe("nothing of its own");
  });

  it("reads an agent's own rate limits, says what a blank inherits, and clears one", async () => {
    serve("target.rate_limits");
    const read = await l9.getPolicyTarget("rate_limits", "tiny");
    expect(sent[0]).toMatchObject({ method: "GET", url: "/api/policy/targets/rate_limits/tiny" });
    expect(read.current.run_starts_per_minute).toBe(2);
    const estate = read.inherits?.run_starts_per_minute;
    expect(typeof estate).toBe("number");
    const fields = fieldsOf(of("rate_limits"), read.current, read.inherits);
    const limit = fields.find((f) => f.name === "run_starts_per_minute");
    expect(limit?.kind).toBe("number");
    expect(limit?.hint).toBe(`empty inherits the estate's: ${String(estate)}`);
    const draft = draftOf(fields, read.current);
    expect(draft.run_starts_per_minute).toBe("2");
    // Blanking the box clears it: null, which the door reads as inherit.
    expect(patchOf(fields, { ...draft, run_starts_per_minute: "" }, read.current).patch).toEqual({ run_starts_per_minute: null });
  });

  it("reads the other per-id doors, and refuses by name", async () => {
    serve("target.attestation", "target.peer", "target.not_found", "target.bad_kind");
    expect((await l9.getPolicyTarget("attestation", "tiny")).current).toEqual({ period_days: 30 });
    const peer = await l9.getPolicyTarget("peer", "soc");
    expect(peer.current).toEqual({ data_class: "confidential", max_data_class: "internal" });
    expect(peer.inherits).toBeNull();
    const fields = fieldsOf(of("peer"), peer.current);
    expect(fields.map((f) => f.kind)).toEqual(["choice", "choice"]);
    expect(fields[1].choices?.map((c) => c.value)).toEqual(["", "public", "internal", "confidential", "restricted"]);
    expect((await refused(l9.getPolicyTarget("peer", "ghost"))).status).toBe(404);
    expect((await refused(l9.getPolicyTarget("nonsense", "x"))).field).toBe("target.kind");
  });

  it("proposes a peer's classes as a reviewed change, which the Peers page shows", () => {
    const c = l9.policyChangeOf(body("propose.pending.peer"));
    expect(c.state).toBe("pending");
    expect(c.target).toEqual({ kind: "peer", id: "soc" });
    expect(targetLine(c.target)).toBe("Peer data classes, soc");
    const { peers } = peerRegistryOf(body("peers.classed"));
    expect(peers[0]).toMatchObject({ data_class: "confidential", max_data_class: "internal" });
    expect(peerClassLine(peers[0])).toBe("Returns confidential · takes up to internal");
    expect(peerClassLine({ data_class: "", max_data_class: "" })).toBe("Returns undeclared · takes no limit here");
    const out = html(createElement(PeerRow, { peer: peers[0], twoPerson: false, me: null, onChanged: () => {} }));
    expect(out).toContain("Returns confidential");
  });
});


/* ═══════════════════ the catalogue and evidence ═══════════════════ */

describe("the controls catalogue", () => {
  it("reads every control with its mappings, and a mapping's source", async () => {
    serve("controls");
    const c = await l9.getControls();
    expect(c.count).toBe(31);
    expect(c.controls).toHaveLength(31);
    // The four the runtime fires that used to count toward nothing.
    for (const [key, id] of [["limit", "AF-AC-05"], ["delegation", "AF-AC-06"], ["data_class", "AF-DP-06"], ["mass_action", "AF-RS-04"]]) {
      expect(c.controls.find((x) => x.journal === key)?.id).toBe(id);
      expect(explainControl(key).id, key).toBe(id);
    }
    expect(c.controls.find((x) => x.journal === "data_class")?.frameworks.eu_ai_act[0].ref).toBe("Art. 10");
    // The report gate is an authorisation gate, and counts where one does.
    expect(explainControl("report").id).toBe("AF-HO-01");
    const gate = c.controls.find((x) => x.id === "AF-HO-01") as l9.CatalogueControl;
    expect(gate.title).toBe("Authorisation gate");
    expect(gate.journal).toBe("gate");
    expect(gate.frameworks.eu_ai_act[0]).toMatchObject({ ref: "Art. 14", source: "console" });
    expect(gate.frameworks.dpdp).toEqual([]);
    expect(c.controls.find((x) => x.id === "AF-AC-01")?.frameworks.eu_ai_act[0].basis).toContain("key practice");
    expect(c.controls.find((x) => x.id === "AF-AC-01")?.frameworks.eu_ai_act[0].quote.length).toBeGreaterThan(0);
    expect(c.frameworks.map((f) => f.id)).toEqual(expect.arrayContaining(["nist_800_53", "csf_2_0", "iso_27001", "iso_42001", "eu_ai_act", "nist_ai_rmf", "gdpr", "dpdp", "sebi", "rbi"]));
    expect(c.families.length).toBeGreaterThan(0);
  });
});

describe("evidence packs", () => {
  it("reads an empty pack, and says a control that never fired is not evidence it works", async () => {
    serve("evidence.empty");
    const p = await l9.getEvidence({ control: "AF-HO-01" });
    expect(sent[0].url).toBe("/api/evidence?control=AF-HO-01");
    expect(p.controls[0].id).toBe("AF-HO-01");
    expect(p.firings).toEqual([]);
    expect(p.chain).toEqual({ status: "no_runs", runs: 0, counts: {}, broken: [], reason: "" });
    expect(noFiringLine(p)).toContain("not evidence it works");
    expect(packChainLine(p.chain)).toMatchObject({ title: "No run to verify", tone: "neutral" });
  });

  it("says a framework with nothing mapped gives a pack that means nothing", () => {
    const p = l9.evidencePackOf(body("evidence.framework_unmapped"));
    expect(p.pack.framework).toBe("dpdp");
    expect(p.controls).toEqual([]);
    expect(p.chain.status).toBe("no_runs");
  });

  it("reads a pack whole: firings, signed decisions, policy, identities, the runs and their chain", () => {
    const p = l9.evidencePackOf(body("evidence.control"));
    expect(p.firings[0]).toMatchObject({ kind: "gate.open", key: "gate", control_ids: ["AF-HO-01"], agent: "gated", label: "Authorisation gate", node: "review" });
    expect(p.decisions[0]).toMatchObject({ approved: true, controls: ["gate"], control_ids: ["AF-HO-01"], via: "resume", note: "fine" });
    expect(p.decisions[0].digest).toMatch(/^sha256:/);
    expect(p.policy.versions[0]).toMatchObject({ agent: "gated", deployed: false });
    expect(p.identities[0].acted_as).toContain("signed a decision");
    expect(p.runs[0]).toMatchObject({ chain: "ok", anchored: true, valid: true });
    expect(p.counts).toMatchObject({ firings: 1, decisions: 1, runs: 1, by_key: { gate: 1 } });
    expect(packLine(p)).toBe("1 firing · 1 signed decision · 1 run · 1 policy version · 0 policy changes · 1 identity");
    expect(decisionLine(p.decisions[0])).toContain("Approved by Asha Rao");
  });

  it("reads a framework's pack", () => {
    const p = l9.evidencePackOf(body("evidence.framework"));
    expect(p.pack.framework).toBe("eu_ai_act");
    expect(p.pack.agent).toBe("gated");
    expect(p.controls.length).toBeGreaterThan(1);
  });

  it("says a pack with a broken run is broken, and a firing counts against its row", () => {
    const p = l9.evidencePackOf(body("evidence.broken"));
    expect(p.chain.status).toBe("broken");
    expect(p.chain.broken[0].broken_at).toBe(0);
    expect(p.runs[0]).toMatchObject({ chain: "broken", valid: false });
    expect(p.firings[0]).toMatchObject({ key: "limit", label: "Argument limit", control_ids: ["AF-AC-05"] });
    expect(p.controls.map((c) => c.id)).toEqual(["AF-AC-05"]);
  });

  it("never reads an outage as ok or as an empty period, and says why", () => {
    const p = l9.evidencePackOf(body("evidence.unavailable"));
    expect(p.chain.status).toBe("unavailable");
    expect(p.chain.reason).toContain("could not be read");
    expect(packChainLine(p.chain)).toMatchObject({ title: "The run records could not be read", tone: "err" });
    expect(noFiringLine(p)).toContain("could not be read");
  });

  it("shows the chain's signer when a record's copy was forged, and says the run is broken", async () => {
    const p = l9.evidencePackOf(body("evidence.forged"));
    expect(p.chain.status).toBe("broken");
    expect(p.chain.broken[0].reason).toContain("decisions[0].by");
    const d = p.decisions[0];
    expect(d.by).toBe("Asha Rao");
    expect(d.disagrees).toEqual([{ field: "by", record: "Mallory <mallory@evil.example>", chain: "Asha Rao" }]);
    expect(stampLine(d)).toBe("The record's copy disagrees with the chain on by: this is the chain's");
    expect(p.identities.map((i) => i.identity)).not.toContain("Mallory <mallory@evil.example>");
    serve("run_verify.disputed");
    const v = await l9.verifyRun("x");
    expect(v.chain).toBe("broken");
    expect(verifyLine(v)).toContain("disagrees with what the chain says");
    expect(l9.decisionsOf(body("run_doc.disputed"))[0]).toMatchObject({ by: "Asha Rao", chained: true });
  });

  it("carries a report gate's approval in the authorisation gate's pack, read from the chain", () => {
    const p = l9.evidencePackOf(body("evidence.report_in_gate_pack"));
    expect(p.decisions[0]).toMatchObject({ controls: ["report"], control_ids: ["AF-HO-01"], chained: true });
    expect(stampLine(p.decisions[0])).toBe("Read from the hash chain");
    expect(p.firings.some((f) => f.key === "report" && f.label === "A deliverable held for a person's review")).toBe(true);
  });

  it("never reads a run from before the chain as ok", () => {
    const p = l9.evidencePackOf(body("evidence.partial"));
    expect(p.chain.status).toBe("partial");
    expect(p.runs[0].chain).toBe("unchained");
  });

  it("reads the policy in force, an emergency among it, and who proposed what", () => {
    const p = l9.evidencePackOf(body("evidence.policy_changes"));
    expect(p.policy.changes.map((c) => c.emergency)).toEqual([false, true]);
    expect(p.policy.changes[1].rollback_of).toBe(p.policy.changes[0].id);
    expect(p.policy.changes[0].summary).toEqual(["guardian's hourly cap: 10 → 7"]);
    expect(p.identities.find((i) => i.identity === "Ben <ben@example.com>")?.acted_as).toEqual(["approved a policy change"]);
  });

  it("refuses by name", async () => {
    serve("evidence.refused.none", "evidence.refused.framework", "evidence.refused.control", "evidence.refused.from", "evidence.refused.order", "evidence.refused.format", "evidence.refused.unsigned");
    expect((await refused(l9.getEvidence({}))).field).toBe("control");
    expect((await refused(l9.getEvidence({ framework: "nope" }))).field).toBe("framework");
    expect((await refused(l9.getEvidence({ control: "not a control!" }))).field).toBe("control");
    expect((await refused(l9.getEvidence({ control: "gate", from: "soon" }))).field).toBe("from");
    expect((await refused(l9.getEvidence({ control: "gate", from: "b", to: "a" }))).message).toBe("from is before to");
    expect((await refused(l9.getEvidence({ control: "gate" }))).field).toBe("format");
    expect((await refused(l9.getEvidence({ control: "kill" }))).status).toBe(401);
  });

  it("downloads the zip with its name and its manifest's SHA-256", async () => {
    serve("evidence.zip");
    const f = await l9.downloadEvidence({ control: "AF-HO-01" });
    expect(sent[0].url).toBe("/api/evidence?control=AF-HO-01&format=zip");
    const h = FX["evidence.zip"].headers as Record<string, string>;
    expect(f.filename).toMatch(/^evidence-AF-HO-01-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(f.sha256).toBe(h["x-evidence-manifest-sha256"]);
    expect(f.blob).toBeInstanceOf(Blob);
  });

  it("builds the door's query from the form", () => {
    expect(packProblem(EMPTY_PACK_FORM)).toBe("Name a control or a framework.");
    expect(packProblem({ ...EMPTY_PACK_FORM, key: "limit" })).toBe("");
    expect(packQuery({ ...EMPTY_PACK_FORM, control: "AF-HO-01", key: "limit" })).toEqual({ control: "limit" });
    expect(packQuery({ ...EMPTY_PACK_FORM, framework: "eu_ai_act", from: "2026-10-01", to: "2026-10-02", agent: "gated" })).toEqual({ framework: "eu_ai_act", from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T23:59:59.000Z", agent: "gated" });
  });
});

/* ═══════════════════ attestations ═══════════════════ */

describe("attestations", () => {
  it("reads an empty estate, and a deployed agent nobody has attested", async () => {
    serve("standings.empty", "standings.never");
    expect(await l9.listStandings()).toEqual({ agents: [], count: 0, overdue: 0 });
    expect(html(createElement(StandingsTable, { rows: [] }))).toContain("No agent is deployed");
    const s = await l9.listStandings();
    expect(s.agents[0]).toMatchObject({ agent: "triage", last: null, overdue: false, period_days: 90 });
    expect(s.agents[0].owner).toEqual({ owner: "owen@example.com", owner_sub: "", source: "spec" });
    expect(standingState(s.agents[0])).toEqual({ label: "Never attested", tone: "warn" });
  });

  it("reads a standing that is current, and one overdue", async () => {
    serve("standings.current", "standings.overdue", "standings.overdue_only");
    const now = await l9.listStandings();
    expect(standingState(now.agents[0])).toEqual({ label: "Current", tone: "ok" });
    const late = await l9.listStandings();
    expect(late.overdue).toBe(1);
    expect(standingState(late.agents[0])).toEqual({ label: "Overdue", tone: "err" });
    expect(html(createElement(StandingsTable, { rows: late.agents }))).toContain("Overdue");
    await l9.listStandings(true);
    expect(sent[2].url).toBe("/api/attestations?overdue=true");
  });

  it("reads an agent's list before and after anyone attests", async () => {
    serve("attestations.none", "attestations.two", "attestations.not_found");
    const none = await l9.listAttestations("triage");
    expect(none).toMatchObject({ count: 0, last_at: null, overdue: false, period_days: 90 });
    expect(dueLine(none)).toContain("Next due");
    expect(ownerLine(none.owner)).toBe("owen@example.com (the spec)");
    const two = await l9.listAttestations("triage");
    expect(two.attestations.map((a) => a.as_role)).toEqual(["administrator", "owner"]);
    expect((await refused(l9.listAttestations("ghost"))).status).toBe(404);
  });

  it("sends the owner's word, reads the first with no diff, and the next with the spec's", async () => {
    serve("attest.first", "attest.second_with_diff");
    const first = await l9.attestAgent("triage", { statement: "still does what was approved", digest: "d1" });
    expect(sent[0]).toMatchObject({ method: "POST", url: "/api/agents/triage/attestations", body: { statement: "still does what was approved", digest: "d1" } });
    expect(first).toMatchObject({ as_role: "owner", previous: null, diff: null, matches_deployed: true });
    expect(diffLine(first)).toBe("The first attestation: nothing to compare.");
    expect(deployedNote(first)).toBeNull();
    expect(attestationLine(first)).toContain("Owen <owen@example.com> as owner");
    const next = await l9.attestAgent("triage", { statement: "reviewed the prompt change", digest: "d2" });
    expect(next.diff?.same).toBe(false);
    expect(next.diff?.summary).toEqual(["node decide changed: steps"]);
    expect(next.previous?.by).toBe("Owen <owen@example.com>");
    expect(deployedNote(next)?.tone).toBe("warn");
    expect(diffLine(next)).toContain("Changed since Owen <owen@example.com> attested version 1");
    const out = html(createElement(AttestationRow, { a: next }));
    expect(out).toContain("Version 1");
    expect(out).toContain("Version 2");
    expect(out).toContain("decide");
    expect(attestationLine(next)).toContain("as administrator, for the owner");
  });

  it("names who may, and refuses a key its word", async () => {
    serve("attest.refused.not_owner", "attest.refused.digest", "attest.refused.blank", "attest.refused.key");
    const go = () => refused(l9.attestAgent("triage", { statement: "yes", digest: "d" }));
    const other = await go();
    expect(other.control).toBe("attestation_owner");
    expect(other.message).toBe("only triage's owner (owen@example.com) or an administrator attests it");
    expect((await go()).field).toBe("digest");
    expect((await go()).field).toBe("statement");
    expect((await go()).message).toContain("an API key cannot give it");
  });

  it("says who may attest before the door is asked", () => {
    const owner = { owner: "owen@example.com", owner_sub: "", source: "spec" };
    const s = (x: object) => ({ ...viewer, ...x }) as never;
    expect(mayAttest(s({}), owner).may).toBe(true); // Owen, the owner.
    expect(mayAttest(s({ email: "oli@example.com", name: "Oli" }), owner)).toEqual({ may: false, why: "only the owner, owen@example.com, or an administrator attests this agent" });
    expect(mayAttest(s({ email: "oli@example.com", appRoles: ["administrator"] }), owner).may).toBe(true);
    expect(mayAttest(null, owner).may).toBe(false);
    expect(mayAttest(s({ email: "oli@example.com", sso: false }), owner).may).toBe(true); // Local mode: the console's operator.
    expect(ownerLine({ owner: "", owner_sub: "", source: "none" })).toContain("no owner on record");
  });
});

/* ═══════════════════ autonomy tiers ═══════════════════ */

describe("autonomy tiers", () => {
  it("reads the tiers, the requirements and who judges each", async () => {
    serve("tiers", "tiers.after_change");
    const t = await l9.getAutonomyTiers();
    expect(sent[0].url).toBe("/api/autonomy-tiers");
    expect(t.tiers.map((x) => x.tier)).toEqual([...l9.TIERS]);
    expect(t.agent).toBeNull();
    const l3 = t.tiers[3];
    expect(l3).toMatchObject({ name: "Conditional", doc_name: "Act-with-approval", adds: ["gate_writes_and_sinks", "guardian"] });
    expect(t.requirements).toHaveLength(12);
    expect(t.requirements.find((r) => r.id === "guardian")?.judged_by).toBe("backend");
    expect(t.attestation_within_days).toBe(30);
    expect((await l9.getAutonomyTiers()).attestation_within_days).toBe(14);
  });

  it("names each control an agent lacks", async () => {
    serve("tiers.agent_missing");
    const t = await l9.getAutonomyTiers("triage");
    expect(sent[0].url).toBe("/api/autonomy-tiers?agent=triage");
    const a = t.agent as l9.AgentTier;
    expect(a).toMatchObject({ tier: "L3", name: "Conditional", met: false, missing: ["owner", "budget", "gate_writes_and_sinks", "guardian"], pending: [] });
    expect(a.requires.find((r) => r.requirement === "guardian")).toMatchObject({ met: false, judged_by: "backend" });
    expect(tierTag(a)).toEqual({ label: "L3: 4 missing", tone: "err" });
    expect(tierLine(a, t.requirements)).toBe("L3 (Conditional): 4 of 6 controls missing (an accountable owner; a declared budget; every write and every sink gated; guardian).".replace("guardian", t.requirements.find((r) => r.id === "guardian")?.title.toLowerCase() ?? "guardian").replace("every write and every sink gated", t.requirements.find((r) => r.id === "gate_writes_and_sinks")?.title.toLowerCase() ?? ""));
    expect(requirementState({ met: false }).label).toBe("missing");
    expect(requirementState({ met: null }).label).toBe("not judged yet");
    const out = html(createElement(AutonomyPanelView, { tiers: t }));
    expect(out).toContain("4 missing");
    expect(out).toContain("policy.budget is not declared");
    expect(out).toContain('href="/guardian"');
  });

  it("reads an agent that meets its tier, and what production runs against what was saved", async () => {
    serve("tiers.agent_met");
    const a = (await l9.getAutonomyTiers("triage")).agent as l9.AgentTier;
    expect(a).toMatchObject({ tier: "L1", name: "Supervised", met: true, missing: [] });
    expect(tierLine(a)).toBe("L1 (Supervised): all 2 controls met.");
    expect(tierTag(a)).toEqual({ label: "L1", tone: "neutral" });
    const deployed = l9.autonomyTiersOf(body("tiers.agent_missing_deployed")).agent as l9.AgentTier;
    expect(deployed.version).toBe(1);
    expect(deployed.met).toBe(false);
  });

  it("answers 404 for an agent never saved", async () => {
    serve("tiers.not_found");
    expect((await refused(l9.getAutonomyTiers("ghost"))).status).toBe(404);
  });

  it("makes autonomy a condition of the promotion gate: named, itemised and overridable", () => {
    const r = l8.gateRefusalBodyOf(body("deploy.refused.autonomy"));
    expect(r.unmet.map((u) => u.condition)).toEqual(["autonomy"]);
    expect(conditionLabel("autonomy")).toBe("Autonomy tier");
    expect(overrideChoices(r)).toEqual(["autonomy"]);
    const items = r.unmet[0].items;
    expect(items.map((i) => i.requirement)).toEqual(["owner", "budget", "gate_writes_and_sinks", "guardian"]);
    expect(itemLine(items[1])).toBe("L3 budget: L3 requires a declared budget: policy.budget is not declared (the platform default applies)");
    expect(l8.CONDITION_NAMES).toContain("autonomy");
    expect(body<{ conditions: unknown[] }>("deploy.override.autonomy").conditions).toHaveLength(5);
    const passed = l8.deployedOf(body("deploy.override.autonomy"));
    expect(passed.override?.passed).toEqual(["autonomy"]);
    expect(l8.lifecycleOf(body("agent.lifecycle")).deployed).toBeNull();
    const after = l8.lifecycleOf(body("agent.lifecycle.autonomy"));
    expect(after.deployed?.version).toBe(1);
    expect(after.current).toBe("designed");
  });
});

/* ═══════════════════ the record: a spec's L9 fields ═══════════════════ */

describe("a spec's L9 fields", () => {
  it("survive the Builder: opened and saved, a tier, a class, a limit and a budget are all still there", () => {
    const doc = body<{ spec: { metadata: Record<string, unknown>; spec: { policy: Record<string, unknown>; tools: Record<string, unknown>[] } } }>("agent.version_spec").spec;
    doc.spec.policy = { ...doc.spec.policy, budget: { tool_calls: 5 }, limits: [{ tool: "store.put", arg: "key", max: 10 }], mass_action: { max: 3 }, redaction: { all: ["email"] } };
    const back = toDocument(fromDocument(doc)) as typeof doc;
    expect(back.metadata.autonomy).toBe("L1");
    expect(back.metadata.owner).toBe("owen@example.com");
    expect(back.spec.policy.budget).toEqual({ tool_calls: 5 });
    expect(back.spec.policy.limits).toEqual([{ tool: "store.put", arg: "key", max: 10 }]);
    expect(back.spec.policy.mass_action).toEqual({ max: 3 });
    expect(back.spec.policy.redaction).toEqual({ all: ["email"] });
    const tools = Object.fromEntries(back.spec.tools.map((t) => [t.name, t]));
    expect(tools["crm.lookup"].data_class).toBe("confidential");
    expect(tools["store.put"].max_data_class).toBe("internal");
    expect((tools["retrieval.search"].config as { sources: { data_class: string }[] }).sources[0].data_class).toBe("restricted");
    expect((tools["peer.send"].config as { peers: { max_data_class: string }[] }).peers[0].max_data_class).toBe("public");
  });


  it("refuses the OT boundary in the Builder as the parser refuses it", async () => {
    serve("spec.refused.ot_write", "spec.refused.sis", "spec.refused.tier");
    const s = fromDocument(body<{ spec: unknown }>("agent.version_spec").spec);
    const bad = validate({ ...s, tools: [...s.tools, { name: "plc.write", server: "plc", risk: "write", impact: ["ot_write"] }, { name: "plc.trip", server: "plc", risk: "read", impact: ["sis"] }] });
    expect(bad.filter((p) => p.severity === "error" && p.title.includes("out of an agent's reach")).map((p) => p.title)).toEqual(["plc.write is out of an agent's reach", "plc.trip is out of an agent's reach"]);
    expect(validate(s).some((p) => p.title.includes("out of an agent's reach"))).toBe(false);
    const post = async () => {
      const r = await globalThis.fetch(new Request("http://console.test/api/agents", { method: "POST", body: "{}" }));
      return (await r.json()) as { error: string; path: string };
    };
    expect((await post()).path).toBe("$.spec.tools[0].impact");
    expect((await post()).error).toContain("is tagged 'sis'");
    expect((await post()).error).toContain("'L9' is not an autonomy tier");
  });

  it("reads what a saved agent is made of through its door", async () => {
    serve("agents.list", "agent.versions");
    const agents = await l2.listAgents();
    expect(agents[0]).toMatchObject({ id: "triage", version: 2 });
    // The agents door carries the tier, so the Lifecycle index asks nothing per agent.
    expect(agents[0].autonomy).toBe("L1");
    expect(declaredTierLabel(agents[0].autonomy)).toBe("Tier L1");
    expect(sent).toHaveLength(1);
    expect(html(createElement(LifecycleIndexView, { agents }))).toContain("Tier L1");
    const v = await l2.listVersions("boxed");
    expect(v.versions[0].tools).toContain("store.put");
  });
});

/* ═══════════════════ provenance ═══════════════════ */

type Doc = { id: string; journal: { entries: (LineageEntry & { hash?: string })[] }; decisions?: unknown; result?: unknown };

describe("signed decisions", () => {
  it("reads the stamped answer on the resume door and on the record", () => {
    const r = l9.resumeDecisionOf(body("resume.stamped")) as l9.SignedDecision;
    expect(r).toMatchObject({ approved: true, controls: ["gate"], control_ids: ["AF-HO-01"], via: "resume", shape: "decision", node: "review" });
    expect(r.digest).toMatch(/^sha256:/);
    const doc = body<Doc>("run_doc.answered");
    const d = l9.decisionsOf(doc);
    expect(d).toHaveLength(1);
    expect(d[0].run).toBe(doc.id);
    expect(d[0].agent).toBe("gated");
    expect(l9.resumeDecisionOf({ state: "running" })).toBeNull();
    expect(l9.decisionsOf(body("run_doc.suspended"))).toEqual([]);
  });
});

describe("the provenance chain", () => {
  it("runs from the prompt to the result through a gate's answer, joining what the runtime leaves uncited", () => {
    const doc = body<Doc>("run_doc.answered");
    const entries = doc.journal.entries;
    const decision = l9.decisionsOf(doc)[0];
    const root = decisionEntry(entries, decision);
    expect(root?.kind).toBe("gate.answer");
    const chain = provenanceOf(entries, root?.id as string);
    const kinds = chain.steps.map((s) => s.entry.kind);
    // Journal order, prompt to result.
    expect(kinds[0]).toBe("run.start");
    expect(kinds.indexOf("model.call")).toBeLessThan(kinds.indexOf("suspend"));
    expect(kinds.indexOf("suspend")).toBeLessThan(kinds.indexOf("gate.answer"));
    expect(kinds[kinds.length - 1]).toBe("run.end");
    const model = chain.steps.find((s) => s.entry.kind === "model.call");
    expect(model?.said).toBe("Prompt: Decide on C-1\nAnswer: benign");
    expect(chain.steps.find((s) => s.entry.kind === "node.enter")?.said).toContain("C-1");
    expect(chain.steps.find((s) => s.entry.kind === "suspend")?.said).toContain("Presented:");
    expect(chain.steps.find((s) => s.entry.kind === "run.end")?.said).toBe('Result: {"approved":true}');
    // Every step is a citation the runtime wrote: nothing is joined by position.
    expect(chain.steps.filter((s) => s.link === "joined")).toEqual([]);
    expect(chain.joined).toBe(0);
    expect(chain.steps.find((s) => s.root)?.link).toBe("root");
    expect(chain.missing).toEqual([]);
    const out = html(createElement(ProvenanceChain, { chain }));
    expect(out).toContain("this decision");
    expect(out).not.toContain("joined by position");
  });

  it("still joins a record from before the runtime cited across a resume, and marks each join", () => {
    const doc = body<Doc>("run_doc.answered.older");
    const entries = doc.journal.entries;
    const root = decisionEntry(entries, l9.decisionsOf(doc)[0]);
    const chain = provenanceOf(entries, root?.id as string);
    const kinds = chain.steps.map((s) => s.entry.kind);
    expect(kinds[0]).toBe("run.start");
    expect(kinds[kinds.length - 1]).toBe("run.end");
    expect(chain.steps.filter((s) => s.link === "joined").map((s) => s.entry.kind)).toEqual(["run.start", "suspend", "run.end"]);
    expect(chain.joined).toBe(3);
    expect(html(createElement(ProvenanceChain, { chain }))).toContain("joined by position");
  });

  it("runs from a model's tool call, whose own citations reach the prompt", () => {
    const entries = body<Doc>("run_doc.delegate").journal.entries;
    const call = entries.find((e) => e.kind === "tool.call") as LineageEntry;
    expect(hasProvenance(call)).toBe(true);
    const chain = provenanceOf(entries, call.id);
    const kinds = chain.steps.map((s) => s.entry.kind);
    expect(kinds).toContain("model.call");
    expect(kinds).toContain("tool.call");
    expect(chain.steps.find((s) => s.root)?.said).toContain("k-C-1");
    expect(kinds[kinds.length - 1]).toBe("run.end");
  });

  it("explains a refusal down to its control and its class", () => {
    const entries = body<Doc>("run_doc.data_class").journal.entries;
    const denied = entries.find((e) => e.kind === "denied") as LineageEntry;
    expect(denied.data?.control).toBe("data_class");
    const chain = provenanceOf(entries, denied.id);
    expect(chain.steps.find((s) => s.root)?.role).toBe("refusal");
    expect(chain.steps.map((s) => s.entry.kind)).toContain("run.start");
    expect(html(createElement(ProvenanceChain, { chain }))).toContain("Data class");
  });

  it("stands at a gate still open, with no answer yet and no result", () => {
    const entries = body<Doc>("run_doc.suspended").journal.entries;
    const open = entries.find((e) => e.kind === "gate.open") as LineageEntry;
    const chain = provenanceOf(entries, open.id);
    expect(chain.steps.map((s) => s.entry.kind)).not.toContain("run.end");
    expect(chain.steps.map((s) => s.entry.kind)).toContain("model.call");
  });

  it("shows what the chain hashed: the redacted form, and which rule", () => {
    const entries = body<Doc>("run_doc.redacted").journal.entries;
    const model = entries.find((e) => e.kind === "model.call") as LineageEntry;
    const chain = provenanceOf(entries, model.id);
    expect(JSON.stringify(chain.steps.map((s) => s.said))).not.toContain("priya@");
    expect(html(createElement(ProvenanceChain, { chain }))).toContain("redacted: email");
  });

  it("has nothing to walk once retention deleted the journal, and says so for an id it does not hold", () => {
    const entries = body<Doc>("run_doc.tombstoned_journal").journal.entries;
    expect(entries.map((e) => e.kind)).toEqual(["tombstone"]);
    expect(provenanceOf(entries, "gone").root).toBeNull();
    expect(html(createElement(ProvenanceChain, { chain: provenanceOf(entries, "gone") }))).toContain("not on this run");
  });

  it("reports a citation the record does not hold, rather than dropping it", () => {
    const entries = [{ id: "a", t: 0, kind: "model.call", because: ["zzz"] }];
    expect(provenanceOf(entries, "a").missing).toEqual(["zzz"]);
  });

  it("answers 404 for a run retention deleted whole, while its chain still answers", async () => {
    serve("run_doc.deleted");
    const r = await globalThis.fetch(new Request("http://console.test/api/runs/x"));
    expect(r.status).toBe(404);
  });

  it("finds no chain field on a run's row: the chain is read per run", async () => {
    serve("runs.list");
    const rows = await l2.listRuns();
    expect(rows[0]).not.toHaveProperty("chain");
  });
});

/* ═══════════════════ attention ═══════════════════ */

describe("attention", () => {
  const items = (name: string) => body<{ items: unknown[] }>(name).items.map(l5.attentionOf);

  it("opens an emergency rollback's change, and never treats it as a failing port", () => {
    const it0 = items("attention.policy_rollback")[0];
    expect(it0.kind).toBe("policy_rollback");
    expect(it0.action.kind).toBe("open");
    expect(it0.action.href).toMatch(/^\/policy\?change=pc-/);
    expect(l9.rollbackAttentionOf(it0)).toMatchObject({ rollback_of: expect.stringMatching(/^pc-/) });
    expect(l9.rollbackAttentionOf(items("attention.attestation")[0])).toBeNull();
  });

  it("opens an overdue attestation on the agent's page, for the owner to read the diff", () => {
    const it0 = items("attention.attestation")[0];
    expect(it0.kind).toBe("attestation");
    expect(it0.agent).toBe("triage");
    expect(it0.action).toMatchObject({ kind: "open", href: "/attestations?agent=triage" });
  });

  it("keeps opening the lifecycle for an override of the autonomy condition", () => {
    expect(items("attention.override_autonomy")[0]).toMatchObject({ kind: "override", action: { kind: "open" } });
  });
});

/* ═══════════════════ the AI-BOM ═══════════════════ */

describe("the AI-BOM", () => {
  it("reads what an agent is made of, with the classes on its tools, sources and peers", async () => {
    serve("bom");
    const b = await l9.getBom("boxed", 1);
    expect(sent[0].url).toBe("/api/agents/boxed/bom?version=1");
    expect(b).toMatchObject({ agent: "boxed", autonomy: "L1", owner: "owen@example.com", deployed: false, production: null, count: { models: 1, tools: 4, servers: 4, peers: 1 } });
    expect(b.models[0]).toMatchObject({ model: "gpt-4o", nodes: ["act"], chosen_by: ["node"] });
    expect(b.models[0].route).toMatchObject({ provider: "vertex-1", kind: "vertex", served_as: "gemini-x", local: false });
    expect(modelLine(b.models[0])).toContain("served as gemini-x");
    expect(chosenLine(b.models[0])).toBe("the node");
    const tools = Object.fromEntries(b.tools.map((t) => [t.name, t]));
    expect(tools["crm.lookup"].data_class).toBe("confidential");
    expect(tools["store.put"].max_data_class).toBe("internal");
    expect(tools["retrieval.search"].sources).toEqual([{ name: "hr", data_class: "restricted" }]);
    expect(tools["peer.send"].peers).toEqual([{ name: "soc", max_data_class: "public" }]);
    expect(classLines(tools["store.put"])).toEqual({ reads: "undeclared", takes: "internal" });
    expect(impactLine({ impact: ["ot_read"] })).toBe("reads replicated OT data only");
    const crm = b.servers.find((s) => s.id === "crm") as l9.BomServer;
    expect(crm).toMatchObject({ server_info: { name: "crm-mcp", version: "2.1.0" }, status: "approved", tools: ["crm.lookup"], builtin: false });
    expect(crm.url).toBe("https://***@crm.example/mcp");
    expect(b.peers[0].card_digest).toMatch(/^sha256:/);
    expect(b.digests.spec).toBe(b.digest);
    expect(b.digests.tool_lists.crm).toMatch(/^sha256:/);
    const out = html(createElement(BomView, { bom: b }));
    expect(out).toContain("confidential");
    expect(out).toContain("restricted");
    expect(out).toContain("crm-mcp 2.1.0");
    expect(out).not.toContain("secret");
  });

  it("reads an agent with nothing but a default model", () => {
    const b = l9.bomOf(body("bom.minimal"));
    expect(b.autonomy).toBe("L0");
    expect(b.tools).toEqual([]);
    expect(b.models[0]).toMatchObject({ model: "", chosen_by: ["default (none configured)"] });
    const out = html(createElement(BomView, { bom: b }));
    expect(out).toContain("the deployment&#x27;s default");
    expect(out).toContain("It holds no tools");
    expect(out).toContain("none on record");
  });

  it("downloads CycloneDX", async () => {
    serve("bom.cyclonedx");
    const f = await l9.downloadCycloneDx("boxed");
    expect(sent[0].url).toBe("/api/agents/boxed/bom?format=cyclonedx");
    expect(f.filename).toBe("boxed.cdx.json");
    const doc = JSON.parse(await f.blob.text()) as { bomFormat: string; specVersion: string };
    expect(doc).toMatchObject({ bomFormat: "CycloneDX", specVersion: "1.6" });
  });

  it("refuses by name", async () => {
    serve("bom.not_found", "bom.refused.version", "bom.refused.format");
    expect((await refused(l9.getBom("ghost"))).status).toBe(404);
    expect((await refused(l9.getBom("boxed", 9))).field).toBe("version");
    expect((await refused(l9.downloadCycloneDx("boxed"))).field).toBe("format");
  });
});

/* ═══════════════════ regulatory views ═══════════════════ */

describe("framework views", () => {
  it("lists every framework and which have nothing mapped", async () => {
    serve("frameworks");
    const f = await l9.listFrameworks();
    expect(f).toHaveLength(13);
    const unmapped = f.filter(isUnmapped).map((x) => x.id);
    expect(unmapped).toEqual(["dpdp", "sebi", "rbi"]);
    expect(frameworkLine(f.find((x) => x.id === "eu_ai_act") as l9.FrameworkInfo)).toBe("7 obligations");
    expect(frameworkLine(f.find((x) => x.id === "dpdp") as l9.FrameworkInfo)).toBe("no obligations mapped");
    expect(f.find((x) => x.id === "iso_27001")?.corpus?.licence).toBe("licensed");
    expect(f.find((x) => x.id === "data_guardrails")?.short).toBe("Data guardrails");
  });

  it("maps each agent to its obligations with the evidence that meets each", async () => {
    serve("frameworks.eu_ai_act");
    const v = await l9.getFrameworkView("eu_ai_act", { from: "2026-10-01T00:00:00Z" });
    expect(sent[0].url).toBe("/api/frameworks/eu_ai_act/view?from=2026-10-01T00%3A00%3A00Z");
    const a = v.agents[0];
    expect(a).toMatchObject({ agent: "acts", kind: "workflow", autonomy: "L0" });
    expect(a.summary).toEqual({ configured: 4, evidenced: 1, not_applicable: 2 });
    expect(a.obligations.find((o) => o.ref === "Art. 10")).toMatchObject({ name: "Data (C9)", status: "not_applicable" });
    const human = a.obligations.find((o) => o.controls.some((c) => c.id === "AF-HO-01"));
    expect(human?.status).toBe("evidenced");
    const gate = human?.controls.find((c) => c.id === "AF-HO-01");
    expect(gate).toMatchObject({ firings: 1, configuration: "declared" });
    expect(gate?.latest).toBeTruthy();
    expect(viewCounts(v)).toEqual({ evidenced: 1, configured: 4, not_evidenced: 0, not_applicable: 2 });
  });

  it("reads one agent through another framework", () => {
    const v = l9.regulatoryViewOf(body("frameworks.nist"));
    expect(v.framework.id).toBe("nist_800_53");
    expect(v.agents[0].obligations.length).toBeGreaterThan(0);
  });

  for (const [name, regulator, why] of [
    ["dpdp", "Digital Personal Data Protection Act 2023", "DPDP Act"],
    ["sebi", "SEBI Cybersecurity and Cyber Resilience Framework", "SEBI's CSCRF"],
    ["rbi", "RBI Cyber Security Framework", "RBI's Cyber Security Framework"],
  ]) {
    it(`says plainly that nothing of ${name} is mapped, rather than looking empty`, async () => {
      serve(`frameworks.${name}`);
      const v = await l9.getFrameworkView(name);
      expect(isUnmapped(v.framework)).toBe(true);
      expect(v.agents[0].obligations).toEqual([]);
      expect(v.agents[0].summary).toEqual({});
      expect(unmappedLine(v.framework)).toContain(why);
    });
  }

  it("reads an estate with no agents", () => {
    const v = l9.regulatoryViewOf(body("frameworks.empty_estate"));
    expect(v.count).toBe(0);
  });

  it("refuses by name", async () => {
    serve("frameworks.not_found", "frameworks.bad_agent", "frameworks.bad_period");
    const nope = await refused(l9.getFrameworkView("nope"));
    expect(nope.status).toBe(404);
    expect(nope.message).toContain("no framework");
    expect((await refused(l9.getFrameworkView("eu_ai_act", { agent: "Not An Agent" }))).field).toBe("agent");
    expect((await refused(l9.getFrameworkView("eu_ai_act", { from: "soon" }))).field).toBe("from");
  });
});

/* ═══════════════════ a refusal with no backend behind it ═══════════════════ */

describe("a door nobody answers", () => {
  it("says the backend has not named it, rather than printing a page", async () => {
    vi.stubGlobal("fetch", async () => new Response("<!doctype html><title>404</title>", { status: 404, headers: { "content-type": "text/html" } }));
    const e = await refused(l9.listPolicyChanges());
    expect(e.message).toContain("this door is served by the backend");
    expect(e.message).not.toContain("<!doctype");
  });
});

/* ═══════════════════ what the types say ═══════════════════ */

describe("the generated document", () => {
  // Every key of `Mine` is a key of `Theirs` with a type it accepts.
  type Agrees<Mine, Theirs> = keyof Mine extends keyof Theirs ? ({ [K in keyof Mine]: Mine[K] extends NonNullable<Theirs[K & keyof Theirs]> | null | undefined ? true : false }[keyof Mine] extends true ? true : false) : false;

  it("agrees with the console's shapes where it types them", () => {
    expectTypeOf<Agrees<Pick<l9.PolicyChange, "id" | "reason" | "proposed_by" | "proposed_at" | "error" | "emergency">, Schemas["PolicyChangeView"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<Pick<l9.RunVerification, "run" | "valid" | "anchor" | "anchored" | "chain">, Schemas["RunVerification"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<Pick<l9.LedgerVerification, "valid" | "anchors" | "runs" | "truncated">, Schemas["LedgerVerification"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<Pick<l9.SimulationResult, "runs" | "calls" | "truncated">, Schemas["SimulationResult"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<Pick<l9.AgentTier, "agent" | "digest" | "tier" | "name" | "met">, Schemas["AgentTier"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<Pick<l9.AiBom, "agent" | "name" | "autonomy" | "digest" | "deployed">, Schemas["AiBom"]>>().toEqualTypeOf<true>();
    expect(true).toBe(true);
  });
});

/* ═══════════════════ the console's standing rules ═══════════════════ */

describe("the pages of this phase", () => {
  const FILES = ["components/policy.tsx", "components/chain.tsx", "components/evidence.tsx", "components/attestations.tsx", "components/frameworks.tsx", "components/bom.tsx", "components/autonomy.tsx", "components/provenance.tsx", "components/section.tsx"];
  const src = (f: string) => readFileSync(path.join(__dirname, "..", f), "utf-8");

  it("never name a host", () => {
    for (const f of [...FILES, "lib/policy.ts", "lib/chain.ts", "lib/evidence.ts", "lib/frameworks.ts", "lib/attestations.ts", "lib/autonomy.ts", "lib/bom.ts", "lib/provenance.ts"]) {
      expect(src(f), f).not.toMatch(/localhost|127\.0\.0\.1|window\.location\.(origin|host)/);
    }
  });

  it("keep every button solid, and every KPI figure in the ink", () => {
    for (const f of FILES) {
      const s = src(f);
      expect(s, f).not.toMatch(/variant="outline"/);
      expect(s, f).not.toMatch(/<Button(?![^>]*variant=)[^>]*>/);
    }
    expect(src("components/section.tsx")).toContain('font-semibold text-fg">{x.v}');
  });

  it("are reached from the navigation", () => {
    const chrome = src("components/chrome.tsx");
    for (const p of ["/policy", "/evidence", "/attestations", "/frameworks", "/ledger", "/bom"]) expect(chrome).toContain(`href: "${p}"`);
  });
});

/* ═══════════════════ the point of the capture ═══════════════════ */

describe("the capture", () => {
  it("was replayed whole", () => {
    expect(Object.keys(FX).filter((k) => !replayed.has(k))).toEqual([]);
  });
});
