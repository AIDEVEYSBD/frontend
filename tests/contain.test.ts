import { describe, expect, it } from "vitest";
import { CONTROL_LABELS, CONTROLS, controlLabel, explainControl } from "@/lib/guardrails";
import { GROUPINGS } from "@/lib/control-domains";
import { shortDigest } from "@/lib/digest";
import { exitText, sandboxFacts, sandboxLine, sandboxOfEntry, sandboxRunOf } from "@/lib/sandbox";
import { summarise } from "@/lib/run-fold";
import { isSdkRun, runSourceOf } from "@/lib/api/l6";

/**
 * "Connect and contain" on the console's side (phase L6): the controls the
 * registry and the runtime name get human words and a register row, an
 * isolated `sandbox.execute` reads as its isolator, exit, time, truncation
 * and manifest before its output, and a run an attached agent opened
 * through the SDK is told apart from the platform's own.
 */

describe("the L6 controls", () => {
  it("say what fired in words a reviewer reads", () => {
    expect(controlLabel("supply_chain")).toBe("Tool server not approved or its tools changed");
    expect(controlLabel("two_person")).toBe("A second person must approve");
    expect(controlLabel("screener")).toBe("A tool's name, description or schema failed screening");
    expect(controlLabel("egress")).toBe("Host outside the egress allowlist");
    for (const [key, label] of Object.entries(CONTROL_LABELS)) {
      expect(label, `${key} reads as words, not its key`).not.toBe(key);
      expect(label).not.toMatch(/_/);
    }
  });

  it("resolve to a row in the register", () => {
    expect(explainControl("supply_chain")).toMatchObject({ id: "AF-IN-05", name: "Tool supply-chain pinning" });
    expect(explainControl("two_person")).toMatchObject({ id: "AF-HO-04", name: "Two-person tool admission" });
    expect(explainControl("screener")).toMatchObject({ id: "AF-DP-04", name: "Content screening" });
    expect(explainControl("egress")).toMatchObject({ id: "AF-AC-04" });
  });

  it("leave the existing keys where they were", () => {
    expect(explainControl("capability").id).toBe("AF-AC-01");
    expect(explainControl("injection.action").id).toBe("AF-AC-03");
    expect(explainControl("injection.input").id).toBe("AF-DP-04");
    expect(explainControl("contract.breach").id).toBe("AF-IN-01");
    expect(explainControl("AF-RS-03").name).toBe("Operator termination");
    // A key the register does not know reads as itself, with no row behind it.
    expect(explainControl("classifier.credential")).toEqual({ name: "classifier.credential", decides: "" });
    expect(controlLabel("capability")).toBe("Capability restriction");
    expect(controlLabel("something.new")).toBe("something.new");
  });

  it("keeps every register id unique and placed in every framework's domains", () => {
    const ids = CONTROLS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of GROUPINGS) {
      for (const id of ids) {
        expect(g.of[id], `${id} has a ${g.short} domain`).toBeTruthy();
        expect(g.domains.some((d) => d.id === g.of[id]), `${id}'s ${g.short} domain exists`).toBe(true);
      }
    }
  });
});

const MANIFEST = "sha256:4b1d0c9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a2b1c";
const RESULT = { exit: 0, stdout: "42\n", stderr: "", truncated: false, isolator: "docker", manifest_digest: MANIFEST, duration_ms: 1234 };

describe("an isolated sandbox.execute", () => {
  it("reads the result the runtime journals", () => {
    expect(sandboxRunOf(RESULT)).toEqual(RESULT);
    expect(sandboxRunOf(JSON.stringify(RESULT))).toEqual(RESULT);
  });

  it("is not one without an isolator, or without an exit or a manifest", () => {
    expect(sandboxRunOf({ exit: 0, stdout: "x" })).toBeNull();
    expect(sandboxRunOf({ isolator: "docker" })).toBeNull();
    expect(sandboxRunOf("sandbox.execute has no isolation attached in this deployment")).toBeNull();
    expect(sandboxRunOf(null)).toBeNull();
    // Stopped by the isolator before it exited: no exit, but the manifest says what ran.
    expect(sandboxRunOf({ isolator: "runsc", manifest_digest: MANIFEST, exit: null, truncated: true })).toMatchObject({ exit: null, truncated: true, isolator: "runsc" });
  });

  it("says itself in one line", () => {
    expect(sandboxLine(sandboxRunOf(RESULT)!)).toBe("exit 0 · docker · 1.2 s");
    expect(sandboxLine(sandboxRunOf({ ...RESULT, exit: 137, truncated: true, duration_ms: 30_000, isolator: "runsc" })!)).toBe("exit 137 · runsc · 30.0 s · output truncated");
    expect(sandboxLine(sandboxRunOf({ ...RESULT, duration_ms: 87 })!)).toBe("exit 0 · docker · 87 ms");
    expect(exitText(sandboxRunOf({ isolator: "docker", manifest_digest: MANIFEST })!)).toBe("no exit");
  });

  it("lays out the isolator, exit, duration, truncation and the manifest digest, shortened with the full value kept", () => {
    const facts = sandboxFacts(sandboxRunOf({ ...RESULT, exit: 2, truncated: true })!);
    expect(facts.map((f) => f.k)).toEqual(["Isolator", "Exit", "Duration", "Output", "Manifest"]);
    expect(facts.find((f) => f.k === "Exit")).toMatchObject({ v: "2", tone: "err" });
    expect(facts.find((f) => f.k === "Output")).toMatchObject({ v: "truncated at the bound", tone: "warn" });
    expect(facts.find((f) => f.k === "Manifest")).toEqual({ k: "Manifest", v: "sha256:4b1d0c9e8f7a…", full: MANIFEST });
  });

  it("is found on a tool result of sandbox.execute, or on an entry of its own, and nowhere else", () => {
    expect(sandboxOfEntry({ kind: "tool.result", data: { tool: "sandbox.execute", value: RESULT } })).toEqual(RESULT);
    expect(sandboxOfEntry({ kind: "note", title: "sandbox.execute", data: { ...RESULT } })).toEqual(RESULT);
    expect(sandboxOfEntry({ kind: "tool.result", data: { tool: "engine.run", value: RESULT } })).toBeNull();
    // The refusal with no isolator attached renders as the error it always was.
    expect(sandboxOfEntry({ kind: "error", data: { tool: "sandbox.execute" }, title: "sandbox.execute" })).toBeNull();
  });

  it("reads as its exit in the agents view, not as its keys", () => {
    expect(summarise(RESULT)).toBe("exit 0 · docker · 1.2 s");
    expect(summarise({ results: [1, 2] })).toBe("2 results");
  });
});

describe("digests, short", () => {
  it("keeps the algorithm and twelve hex digits", () => {
    expect(shortDigest(MANIFEST)).toBe("sha256:4b1d0c9e8f7a…");
    expect(shortDigest("sha256:abc")).toBe("sha256:abc");
    expect(shortDigest("0123456789abcdef0123")).toBe("0123456789ab…");
    expect(shortDigest("")).toBe("");
  });
});

describe("a run's source", () => {
  it("reads it as the backend's source_of does: the reporting door, else the named source, else a worker's job", () => {
    expect(runSourceOf({ id: "r", source: "sdk" })).toBe("sdk");
    expect(runSourceOf({ id: "r", reported_by: { mode: "sdk", key: "af_12" } })).toBe("sdk");
    expect(runSourceOf({ id: "r", reported_by: { mode: "a2a", door: "broker" } })).toBe("a2a");
    expect(runSourceOf({ id: "r", reported_by: { mode: "gateway", door: "gateway" } })).toBe("gateway");
    // `reported_by.mode` decides first (backend/app/ledger.py source_of): the door that reported the run.
    expect(runSourceOf({ id: "r", source: "worker", reported_by: { mode: "sdk" } })).toBe("sdk");
    // A record a worker claimed from the queue names its job.
    expect(runSourceOf({ id: "r", job: "929e8d72", worker: "w1" })).toBe("worker");
    expect(runSourceOf({ id: "r" })).toBe("");
    expect(runSourceOf(null)).toBe("");
  });

  it("marks only a run the SDK opened as an SDK run", () => {
    expect(isSdkRun({ source: "sdk" })).toBe(true);
    expect(isSdkRun({ reported_by: { mode: "sdk" } })).toBe(true);
    expect(isSdkRun({ source: "console" })).toBe(false);
    expect(isSdkRun({ reported_by: { mode: "a2a" } })).toBe(false);
    expect(isSdkRun({})).toBe(false);
  });
});
