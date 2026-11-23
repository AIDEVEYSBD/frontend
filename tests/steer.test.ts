import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { followsLive, steerOffer } from "@/lib/steer";
import { SteerPanel } from "@/components/steer";
import { GateMeta } from "@/components/gate-form";
import { gateOf } from "@/lib/api/l5";

/**
 * Two things a contract check found.
 *
 * The steering panel was hidden whenever a run stood at a gate. The
 * platform takes a lever while a run is running or waiting at a gate (the
 * lever waits for the run's next step after the gate) and refuses one only
 * for a run that has ended, so the panel shows at a gate too, with every
 * lever, the hold applying to the next tool call at or above write after
 * the gate.
 *
 * The gate dialog's meta line said "Deadline" twice for a gate with none
 * ("Deadline no deadline"): the label is shown only beside a countdown.
 */

const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("steering a run", () => {
  it("a running run offers the panel", () => {
    expect(steerOffer({ state: "running", atGate: false })).toEqual({ show: true, atGate: false });
  });

  it("a run at a gate offers the panel too, every lever waiting for its next step", () => {
    expect(steerOffer({ state: "suspended", atGate: true })).toEqual({ show: true, atGate: true });
    // The stream may not have said "suspended" yet when the gate is on screen.
    expect(steerOffer({ state: "running", atGate: true })).toEqual({ show: true, atGate: true });
  });

  it("a settled run offers nothing: the platform answers 409", () => {
    for (const state of ["done", "failed", "killed", "closed"]) expect(steerOffer({ state, atGate: false }).show, state).toBe(false);
  });

  it("the panel at a gate: guidance, the hold and the model, each said to wait for the step after the gate", () => {
    const html = textOf(renderToStaticMarkup(createElement(SteerPanel, { runId: "run-1", atGate: true })));
    expect(html).toContain("Send guidance");
    expect(html).toContain("Ask for a hold");
    expect(html).toContain("Model for the next model call");
    expect(html).toContain("after the gate");
    const running = textOf(renderToStaticMarkup(createElement(SteerPanel, { runId: "run-1" })));
    expect(running).toContain("even if no gate names it");
  });

  it("a run page follows a run that is running or waits at a gate, and replays everything settled", () => {
    expect(followsLive({ state: "running", source: "" })).toBe(true);
    expect(followsLive({ state: "suspended", source: "", finished_at: null })).toBe(true);
    expect(followsLive({ state: "suspended", source: "sdk", finished_at: "2026-10-21T08:00:00Z" })).toBe(false);
    expect(followsLive({ state: "done", source: "" })).toBe(false);
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
