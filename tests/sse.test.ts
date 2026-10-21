import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SseParser, parseSse } from "@/lib/api/sse";
import { decodeRunEvent, type RunEvent } from "@/lib/api/client";

/**
 * The run event stream, parsed from a recording.
 *
 * tests/fixtures/run-events.sse is `GET /api/runs/{id}/events` as the
 * backend answered it for a finished run (controls-testing, killed by the
 * operator): five journal entries replayed from the file, then `event: end`.
 * The same decoding runs on every EventSource message in the console.
 */

const FIXTURE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "run-events.sse"), "utf-8");

function decodeAll(text: string): RunEvent[] {
  return parseSse(text)
    .map((e) => decodeRunEvent(e.event, e.data))
    .filter((e): e is RunEvent => e !== null);
}

describe("the recorded stream", () => {
  it("is five entries then an end", () => {
    const frames = parseSse(FIXTURE);
    expect(frames.map((f) => f.event)).toEqual(["entry", "entry", "entry", "entry", "entry", "end"]);
  });

  it("decodes each entry as a journal entry, without the wire's type tag", () => {
    const events = decodeAll(FIXTURE);
    const entries = events.filter((e) => e.type === "entry");
    expect(entries).toHaveLength(5);
    const first = entries[0];
    if (first.type !== "entry") throw new Error("not an entry");
    expect(first.entry.kind).toBe("run.start");
    expect(first.entry.id).toBe("4dabb94f1c3f");
    expect(first.entry.t).toBe(0);
    expect(first.entry.data).toEqual({ system: "controls-testing", spec_digest: "04c680ce3174e59b" });
    expect("type" in first.entry).toBe(false);
    // The tool call's because-chain points at the step that made it.
    const call = entries[2];
    if (call.type !== "entry") throw new Error("not an entry");
    expect(call.entry.kind).toBe("tool.call");
    expect(call.entry.because).toEqual(["12ef90a77d60"]);
    expect(call.entry.node).toBe("register");
  });

  it("decodes the end with the settled state", () => {
    const last = decodeAll(FIXTURE).at(-1);
    expect(last).toEqual({ type: "end", end: { state: "killed", error: "killed by operator", result: {}, suspension: null } });
  });

  it("keeps the entries in journal order", () => {
    const ts = decodeAll(FIXTURE).flatMap((e) => (e.type === "entry" ? [e.entry.t] : []));
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    expect(ts.at(-1)).toBe(4569);
  });
});

describe("the parser", () => {
  it("completes frames across chunk boundaries, however the bytes arrive", () => {
    const whole = parseSse(FIXTURE);
    for (const size of [1, 7, 64, 1000]) {
      const p = new SseParser();
      const out = [];
      for (let i = 0; i < FIXTURE.length; i += size) out.push(...p.feed(FIXTURE.slice(i, i + size)));
      out.push(...p.end());
      expect(out, `chunk size ${size}`).toEqual(whole);
    }
  });

  it("ignores keepalive comments and joins multi-line data", () => {
    const text = ': keepalive\n\nevent: entry\ndata: {"t":1,\ndata: "kind":"note","id":"a1"}\n\n: keepalive\n\nevent: end\ndata: {"state":"done"}\n\n';
    const frames = parseSse(text);
    expect(frames).toEqual([
      { event: "entry", data: '{"t":1,\n"kind":"note","id":"a1"}' },
      { event: "end", data: '{"state":"done"}' },
    ]);
    const events = frames.map((f) => decodeRunEvent(f.event, f.data));
    expect(events[0]).toEqual({ type: "entry", entry: { t: 1, kind: "note", id: "a1" } });
    expect(events[1]).toEqual({ type: "end", end: { state: "done", error: "", result: {}, suspension: null } });
  });

  it("names a frame without an event field 'message', and drops one without data", () => {
    expect(parseSse("data: hello\n\nevent: ping\n\nid: 7\ndata: x\n\n")).toEqual([
      { event: "message", data: "hello" },
      { event: "message", data: "x", id: "7" },
    ]);
  });

  it("accepts CRLF line endings", () => {
    expect(parseSse("event: end\r\ndata: {\"state\":\"done\"}\r\n\r\n")).toEqual([{ event: "end", data: '{"state":"done"}' }]);
  });

  it("holds a trailing frame that never got its blank line until end()", () => {
    const p = new SseParser();
    expect(p.feed('event: end\ndata: {"state":"failed"}')).toEqual([]);
    expect(p.end()).toEqual([{ event: "end", data: '{"state":"failed"}' }]);
  });
});

describe("decodeRunEvent", () => {
  it("refuses what is not an entry or an end", () => {
    expect(decodeRunEvent("entry", "not json")).toBeNull();
    expect(decodeRunEvent("entry", '{"t":1}')).toBeNull();
    expect(decodeRunEvent("message", '{"kind":"note","id":"x"}')).toBeNull();
    expect(decodeRunEvent("end", "[]")).toEqual({ type: "end", end: { state: "unknown", error: "", result: {}, suspension: null } });
  });

  it("carries a suspension through the end", () => {
    const end = decodeRunEvent("end", '{"state":"suspended","suspension":{"kind":"approval","node":"gate","approvers":["ops"],"prompt":"Release?"}}');
    expect(end).toEqual({
      type: "end",
      end: { state: "suspended", error: "", result: {}, suspension: { kind: "approval", node: "gate", approvers: ["ops"], prompt: "Release?" } },
    });
  });
});
