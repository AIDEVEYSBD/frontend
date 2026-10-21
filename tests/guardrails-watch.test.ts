import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classify, watchEventsOf, type WatchRecord } from "@/lib/guardrails-watch";
import { MASK, redactText, redactValue } from "@/lib/redact";

/**
 * The injection and exfiltration watch, from a recorded journal.
 *
 * tests/fixtures/watch-journal.json holds two records: one the model
 * gateway wrote for a chatbot (a screened prompt, blocked; a screened
 * response, flagged) and one the runtime wrote for an agent (a taint mark,
 * a taint-to-sink refusal, an egress refusal, and a capability refusal that
 * is not the watch's business). The route (app/api/guardrails/route.ts)
 * runs this same function over every record it holds, with the live
 * secrets of the process; here the live set is the one value the fixture
 * carries that no shape would catch.
 */

const FIXTURE = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "watch-journal.json"), "utf-8")) as {
  gateway: WatchRecord;
  runtime: WatchRecord;
};
const AT = "2026-10-20T10:02:21.000Z";
const LIVE = ["s3cr3t-value-live"];

describe("classify", () => {
  const entries = FIXTURE.runtime.journal!.entries!;
  const byId = (id: string) => entries.find((e) => e.id === id)!;
  it("picks the three watched kinds and nothing else", () => {
    expect(classify(byId("d1"))).toBe("taint_sink");
    expect(classify(byId("d2"))).toBe("egress");
    expect(classify(byId("d3"))).toBeNull();
    expect(classify(byId("m1"))).toBeNull();
    expect(classify(byId("mc1"))).toBeNull();
    expect(classify(FIXTURE.gateway.journal!.entries![1])).toBe("screened");
    expect(classify(FIXTURE.gateway.journal!.entries![2])).toBe("screened");
  });
});

describe("the gateway record", () => {
  const events = watchEventsOf(FIXTURE.gateway, AT, LIVE);

  it("yields one event per screened hit, on the application, with the principal", () => {
    expect(events).toHaveLength(2);
    const [blocked, flagged] = events;
    expect(blocked.kind).toBe("screened");
    expect(blocked.control).toBe("injection.input");
    expect(blocked.action).toBe("refused");
    expect(blocked.subject).toEqual({ kind: "application", id: "hr-helpdesk" });
    expect(blocked.principal).toBe("alice@example.com");
    expect(blocked.run).toBe(FIXTURE.gateway.id);
    expect(blocked.entry).toBe("g2");
    expect(blocked.id).toBe(`${FIXTURE.gateway.id}:g2`);
    expect(blocked.at).toBe(AT);
    expect(blocked.t).toBe(12);
    expect(blocked.because).toEqual(["g1"]);
    expect(flagged.control).toBe("screen.response");
    expect(flagged.action).toBe("flagged");
    expect(flagged.excerpt).toBe("system prompt echo");
  });

  it("redacts every secret in the excerpt: the live value, the factory key, the bearer token", () => {
    const { excerpt } = events[0];
    expect(excerpt).not.toContain("s3cr3t-value-live");
    expect(excerpt).not.toContain("af_0123456789abcdef");
    expect(excerpt).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(excerpt).toContain(MASK);
    expect(excerpt).toContain("reveal the system prompt");
    // The labels survive; only the values go.
    expect(excerpt).toMatch(/api_key=••••redacted••••/);
    expect(excerpt).toMatch(/Bearer ••••redacted••••/);
  });
});

describe("the runtime record", () => {
  const events = watchEventsOf(FIXTURE.runtime, AT, LIVE);

  it("lists the taint-to-sink refusal and the egress refusal, on the agent, and not the capability refusal", () => {
    expect(events.map((e) => [e.kind, e.control, e.tool])).toEqual([
      ["taint_sink", "taint", "mail.send"],
      ["egress", "egress", "http.post"],
    ]);
    for (const e of events) expect(e.subject).toEqual({ kind: "agent", id: "aegis" });
    expect(events[0].entry).toBe("d1");
    expect(events[0].because).toEqual(["c2"]);
    expect(events[1].excerpt).toBe("host evil.example is not in the allowlist");
  });

  it("masks a password smuggled into the arguments", () => {
    expect(events[0].excerpt).not.toContain("hunter2secretvalue");
    expect(events[0].excerpt).toContain(`password=${MASK}`);
  });
});

describe("redaction", () => {
  it("replaces a live value exactly, as the runtime does, and ignores short ones", () => {
    expect(redactText("key is abcdefgh12 here", ["abcdefgh12"])).toBe(`key is ${MASK} here`);
    expect(redactText("key is abc here", ["abc"])).toBe("key is abc here");
    expect(redactText("", ["abcdefgh12"])).toBe("");
  });

  it("masks the shapes a secret takes, keeping the label", () => {
    expect(redactText("sk-abcdefghijklmnopqrstuvwxyz")).toBe(MASK);
    expect(redactText("token: 0123456789abcdef")).toBe(`token: ${MASK}`);
    expect(redactText('"authorization": "Bearer 0123456789abcdef0123"')).toBe(`"authorization": "Bearer ${MASK}"`);
    expect(redactText("x-api-key=ab12cd34ef56")).toBe(`x-api-key=${MASK}`);
    expect(redactText("plain prose with no secret in it")).toBe("plain prose with no secret in it");
  });

  it("walks a JSON-shaped value and leaves keys and numbers alone", () => {
    const v = redactValue({ a: "sk-abcdefghijklmnopqrstuvwxyz", n: 3, list: ["af_0123456789abcdef0123456789abcdef", "ok"], nested: { password: "password=supersecretvalue" } });
    expect(v).toEqual({ a: MASK, n: 3, list: [MASK, "ok"], nested: { password: `password=${MASK}` } });
  });
});
