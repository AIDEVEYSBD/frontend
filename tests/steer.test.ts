import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HOLD_AT_GATE_REASON, followsLive, steerOffer } from "@/lib/steer";
import { SteerPanel } from "@/components/steer";
import { GateMeta } from "@/components/gate-form";
import { gateOf } from "@/lib/api/l5";

/**
 * Two things a contract check found.
 *
 * The steering panel was hidden whenever a run stood at a gate, though the
 * backend takes a steer on an SDK run there (its agent's control poll is
 * listening either way). It shows for an SDK run at a gate, with the hold
 * at the next gate not offered and the reason given; a run of any other
 * kind at a gate is suspended and cannot be steered, so it shows nothing.
 *
 * The gate dialog's meta line said "Deadline" twice for a gate with none
 * ("Deadline no deadline"): the label is shown only beside a countdown.
 */

const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("steering a run", () => {
  it("a running run offers every lever, wherever it came from", () => {
    for (const source of ["", "worker", "sdk"]) {
      expect(steerOffer({ state: "running", atGate: false, source }), source || "in-process").toEqual({ show: true, hold: { allowed: true, reason: "" } });
    }
  });

  it("an SDK run at a gate is steered too, without the hold, and says why", () => {
    const offer = steerOffer({ state: "suspended", atGate: true, source: "sdk" });
    expect(offer).toEqual({ show: true, hold: { allowed: false, reason: HOLD_AT_GATE_REASON } });
    expect(offer.hold.reason).toMatch(/already held for a person/);
    // The stream may not have said "suspended" yet when the gate is on screen.
    expect(steerOffer({ state: "running", atGate: true, source: "sdk" }).hold.allowed).toBe(false);
  });

  it("any other run at a gate, and a settled one, offers nothing: the door would answer 409", () => {
    for (const source of ["", "worker", "a2a"]) expect(steerOffer({ state: "suspended", atGate: true, source }).show, source || "in-process").toBe(false);
    for (const state of ["done", "failed", "killed", "closed"]) expect(steerOffer({ state, atGate: false, source: "sdk" }).show, state).toBe(false);
  });

  it("the panel at an SDK gate: guidance and the model still go, the hold switch is off and says why", () => {
    const html = renderToStaticMarkup(createElement(SteerPanel, { runId: "sdk-run-1", holdBlocked: HOLD_AT_GATE_REASON }));
    expect(textOf(html)).toContain(HOLD_AT_GATE_REASON);
    expect(textOf(html)).toContain("Send guidance");
    expect(textOf(html)).toContain("Model for the next model call");
    expect(html).toMatch(/<button[^>]*role="switch"[^>]*disabled=""/);
    // Running, the switch is live and the usual hint stands.
    const running = renderToStaticMarkup(createElement(SteerPanel, { runId: "sdk-run-1" }));
    expect(running).not.toMatch(/<button[^>]*role="switch"[^>]*disabled=""/);
    expect(textOf(running)).toContain("even if no gate names it");
  });

  it("a run page follows an SDK run its agent holds open at a gate, and replays everything settled", () => {
    expect(followsLive({ state: "running", source: "" })).toBe(true);
    expect(followsLive({ state: "suspended", source: "sdk", finished_at: null })).toBe(true);
    expect(followsLive({ state: "suspended", source: "sdk", finished_at: "2026-10-21T08:00:00Z" })).toBe(false);
    expect(followsLive({ state: "suspended", source: "" })).toBe(false);
    expect(followsLive({ state: "done", source: "sdk" })).toBe(false);
  });
});

describe("the gate dialog names the deadline once", () => {
  const base = { run: "r1", agent: "a", node: "n", shape: "decision", approvers: ["dlp-lead"], waiting_since: "2026-10-21T06:42:43Z" };
  const now = Date.parse("2026-10-21T08:00:00Z");
  const deadlines = (html: string) => (textOf(html).match(/deadline/gi) ?? []).length;

  it("with a deadline: the label and the countdown", () => {
    const html = renderToStaticMarkup(createElement(GateMeta, { gate: gateOf({ ...base, deadline: "2026-10-22T06:42:43Z" }), now }));
    expect(deadlines(html)).toBe(1);
    expect(textOf(html)).toMatch(/Deadline 22h 42m left/);
  });

  it("without one: only that there is none", () => {
    const gate = gateOf(base);
    expect(gate.deadline).toBeNull();
    const html = renderToStaticMarkup(createElement(GateMeta, { gate, now }));
    expect(deadlines(html)).toBe(1);
    expect(textOf(html)).toContain("no deadline");
  });
});
