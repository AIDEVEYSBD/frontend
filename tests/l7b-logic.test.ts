import { describe, expect, it } from "vitest";
import { attentionOf } from "@/lib/api/l5";
import { reachedOf } from "@/lib/api/l7";
import { PEERS, breakerPath, breakersOf, peerOf, peerRegistryOf, type Peer, type PeerCard } from "@/lib/api/l7b";
import { peerTaskLine, reachedKindLabel } from "@/lib/run-tree";
import {
  EMPTY_PEER_FORM,
  PEER_STATUS_META,
  approvePeerAccess,
  cardChange,
  cardChangeLine,
  fetchLine,
  orderPeers,
  peerBody,
  peerCounts,
  peerFormProblem,
  secretNameOf,
  skillsOf,
  slugOfLabel,
} from "@/lib/peers";
import { breakerOfAttention, breakerTarget, closesText, endedText, openBreakers, openingLine, pastOpenings, secondsLeft, spanText, thresholdsLine, whyText } from "@/lib/breakers";
import { JOB_STATUSES, countOf, queueTotals } from "@/lib/queue";

/**
 * The pure logic the L7 second-round pages render with, on shapes built
 * here: the peer register's form, statuses, access and card changes; the
 * breakers in words; the queue's statuses; and the mappings' defences.
 * tests/l7b-contract.test.ts holds the same helpers against captured
 * responses; these hold the cases a capture does not reach.
 */

const card = (digest: string, body: Record<string, unknown> | null = { name: "Peer", skills: [] }): PeerCard => ({ digest, card: body, at: "2026-10-21T10:00:00Z" });
const peer = (over: Partial<Peer> = {}): Peer => ({ ...peerOf({ id: "p", label: "P", url: "https://peer.example/a2a", secret_name: "p-a2a", agent: "agent-factory", status: "pending" }), ...over });

describe("a peer's registration form", () => {
  it("a secret is its vault name, or ${secret:name}, lowercased; anything else is no name", () => {
    expect(["soc-stub-a2a", "${secret:SOC_Stub}", "Upper", "  padded  "].map(secretNameOf)).toEqual(["soc-stub-a2a", "soc_stub", "upper", "padded"]);
    expect(["s3cr3t value!", "${env:TOKEN}", "a".repeat(65), "", "${secret:}", "sk-live/abc"].map(secretNameOf)).toEqual(["", "", "", "", "", ""]);
  });

  it("the id the backend derives from a label", () => {
    expect(["SOC triage peer", "  42 Peers!! ", "Ünïcode name", "", "a".repeat(80)].map(slugOfLabel)).toEqual(["soc-triage-peer", "peers", "n-code-name", "", "a".repeat(63)]);
  });

  it("names its first problem, the way the backend refuses it", () => {
    const ok = { ...EMPTY_PEER_FORM, label: "SOC peer", url: "https://peer.example/a2a", secret_name: "soc-a2a" };
    expect(peerFormProblem(ok)).toBe("");
    expect(peerFormProblem(EMPTY_PEER_FORM)).toBe("Name the peer.");
    expect(peerFormProblem({ ...ok, label: "", id: "Bad-Id" })).toMatch(/An id starts with a lowercase letter/);
    expect(peerFormProblem({ ...ok, label: "!!!" })).toBe("Name the peer.");
    expect(peerFormProblem({ ...ok, url: "" })).toBe("Give the peer's A2A endpoint, an http(s) URL.");
    expect(peerFormProblem({ ...ok, url: "ftp://peer.example/a2a" })).toBe("Give the peer's A2A endpoint, an http(s) URL.");
    expect(peerFormProblem({ ...ok, url: "https://token@peer.example/a2a" })).toMatch(/carries no credentials/);
    expect(peerFormProblem({ ...ok, url: "https://peer.example/a2a?token=x" })).toMatch(/no query or fragment/);
    expect(peerFormProblem({ ...ok, url: "https://peer.example/a2a#card" })).toMatch(/no query or fragment/);
    expect(peerFormProblem({ ...ok, secret_name: "" })).toBe("Name the vault secret the two sides share.");
    expect(peerFormProblem({ ...ok, secret_name: "pasted secret value" })).toMatch(/never the secret itself/);
    expect(peerFormProblem({ ...ok, agent: "Not An Id" })).toBe('"Not An Id" is not an agent id.');
    expect(peerFormProblem({ ...ok, id: "soc", agent: "dlp-triage-v3" })).toBe("");
  });

  it("sends the contract's body: trimmed, blank optional fields left out", () => {
    const blank = { data_class: "", max_data_class: "" };
    expect(peerBody({ label: " SOC ", id: " ", url: " https://p.example/a2a ", secret_name: " ${secret:soc} ", agent: "", ...blank })).toEqual({ label: "SOC", url: "https://p.example/a2a", secret_name: "${secret:soc}" });
    expect(peerBody({ label: "", id: "soc", url: "https://p.example/a2a", secret_name: "soc", agent: "triage", ...blank })).toEqual({ label: "", id: "soc", url: "https://p.example/a2a", secret_name: "soc", agent: "triage" });
    expect(peerBody({ label: "", id: "soc", url: "https://p.example/a2a", secret_name: "soc", agent: "", data_class: "confidential", max_data_class: "internal" })).toEqual({ label: "", id: "soc", url: "https://p.example/a2a", secret_name: "soc", data_class: "confidential", max_data_class: "internal" });
  });
});

describe("a peer's status, card and access", () => {
  it("only a changed card is an alarm; the list reads alarms first, then what waits, then what serves", () => {
    expect(Object.entries(PEER_STATUS_META).map(([k, m]) => [k, m.alarming, m.tone])).toEqual([
      ["approved", false, "ok"],
      ["pending", false, "warn"],
      ["changed", true, "err"],
    ]);
    const list = [peer({ id: "b", label: "Same", status: "approved" }), peer({ id: "a", label: "Same", status: "approved" }), peer({ id: "c", label: "Alpha", status: "changed" }), peer({ id: "d", label: "Zed", status: "pending", card: card("sha256:d") })];
    expect(orderPeers(list).map((p) => p.id)).toEqual(["c", "d", "a", "b"]);
    expect(peerCounts(list)).toEqual({ approved: 2, pending: 1, changed: 1, no_card: 3 });
  });

  it("the skills a card lists, defended against a card that is not one", () => {
    expect(skillsOf(card("d", { skills: [{ id: "a", tags: ["x", 2] }, { name: "Named only" }, {}, "junk"] }))).toEqual([
      { id: "a", name: "a", description: "", tags: ["x", "2"] },
      { id: "", name: "Named only", description: "", tags: [] },
    ]);
    expect([skillsOf(null), skillsOf(card("d", null)), skillsOf(card("d", { skills: "many" }))]).toEqual([[], [], []]);
  });

  it("what moved on a card: fields, skills added, removed and rewritten; digests alone when a body is missing", () => {
    const before = card("sha256:old", { name: "Peer", url: "https://p", skills: [{ id: "triage", name: "Triage", description: "classifies" }, { id: "gone", name: "Gone" }] });
    const after = card("sha256:new", { name: "Peer", url: "https://q", version: "2", skills: [{ id: "triage", name: "Triage", description: "classifies and forwards" }, { id: "new" }, { id: "more" }] });
    const c = cardChange({ previous_card: before, card: after });
    expect(c).toEqual({ from: "sha256:old", to: "sha256:new", fields: ["url", "version"], added: ["new", "more"], removed: ["gone"], rewritten: ["triage"] });
    expect(cardChangeLine(c!)).toBe("url, version changed; skill triage rewritten; skills new, more added; skill gone removed");
    expect(cardChange({ previous_card: null, card: after })).toBeNull();
    expect(cardChange({ previous_card: card("sha256:new"), card: after })).toBeNull();
    // A card read back from the runtime's file has its digest only: nothing is claimed about what moved.
    expect(cardChange({ previous_card: card("sha256:old", null), card: after })).toEqual({ from: "sha256:old", to: "sha256:new", fields: [], added: [], removed: [], rewritten: [] });
    expect(cardChangeLine({ from: "a", to: "b", fields: [], added: [], removed: [], rewritten: [] })).toBe("");
  });

  it("who may approve: never twice, never without a card, never the registrant when two people must", () => {
    const pending = peer({ card: card("sha256:x"), added_by: "Asha Rao" });
    const me = { name: "Asha Rao", email: "", sub: "" };
    expect(approvePeerAccess(pending, me, false)).toEqual({ ok: true, reason: "" });
    // Local mode signs with the bare name, and the name decides.
    expect(approvePeerAccess(pending, me, true)).toEqual({ ok: false, reason: "a second person must approve" });
    expect(approvePeerAccess(pending, { name: "Bo", email: "bo@example.com" }, true)).toEqual({ ok: true, reason: "" });
    // An entry adopted from the runtime's file names nobody: anyone may.
    expect(approvePeerAccess({ ...pending, added_by: "" }, me, true)).toEqual({ ok: true, reason: "" });
    expect(approvePeerAccess({ ...pending, status: "approved" }, me, false).reason).toBe("the card is already approved");
    expect(approvePeerAccess({ ...pending, card: null }, me, false).reason).toBe("no agent card is pinned yet: rescan once the peer answers");
    expect(approvePeerAccess({ ...pending, status: "changed" }, me, false).ok).toBe(true);
  });

  it("the last fetch in words, with what to do next", () => {
    expect(fetchLine({ last_fetch: null, card: null })).toEqual({ ok: false, text: "never fetched" });
    expect(fetchLine({ last_fetch: null, card: card("d") })).toEqual({ ok: true, text: "no fetch on record" });
    expect(fetchLine({ last_fetch: null, card: card("d", null), adopted: { at: "t", from: "peers.json" } })).toEqual({ ok: true, text: "no fetch on record; the card was read back from the runtime's file" });
    const at = { at: "t", by: "b", digest: "", control: "" };
    expect(fetchLine({ last_fetch: { ...at, ok: true, error: "" }, card: card("d") }).text).toBe("the card was read, signed, and its signature checked");
    expect(fetchLine({ last_fetch: { ...at, ok: false, error: "the answer is not signed", control: "a2a_auth" }, card: null }).text).toBe("the answer is not signed (a2a_auth)");
    expect(fetchLine({ last_fetch: { ...at, ok: false, error: "", control: "egress" }, card: null }).text).toBe("the fetch failed (egress)");
    expect(fetchLine({ last_fetch: { ...at, ok: false, error: "peer 'x' timed out", control: "" }, card: null }).text).toBe("peer 'x' timed out; rescan once it answers");
  });
});

describe("the registry's answers, read defensively", () => {
  it("a peer row: unknown status pending, the label from the id, no card without a digest, junk dropped", () => {
    const p = peerOf({ id: "x", status: "trusted", card: { card: { name: "no digest" } }, previous_card: "nope", approvals: "none", last_fetch: { ok: "yes" }, adopted: { at: "t", from: "peers.json" } });
    expect(p).toEqual({
      id: "x",
      label: "x",
      url: "",
      secret_name: "",
      agent: "",
      status: "pending",
      data_class: "",
      max_data_class: "",
      card: null,
      previous_card: null,
      approvals: [],
      added_by: "",
      added_at: "",
      last_fetch: { at: "", by: "", ok: false, digest: "", error: "", control: "" },
      adopted: { at: "t", from: "peers.json" },
    });
    expect(peerRegistryOf({ peers: [{ id: "a" }, { label: "no id" }, null], two_person: "yes" })).toMatchObject({ count: 1, two_person: false });
    expect(peerRegistryOf(null)).toEqual({ peers: [], count: 0, two_person: false });
  });

  it("an id or a breaker name is one path segment, encoded", () => {
    expect([PEERS.approve("a/b").path, PEERS.rescan("x y").path, PEERS.remove("p").method]).toEqual(["/api/peers/a%2Fb/approve", "/api/peers/x%20y/rescan", "DELETE"]);
    expect([breakerPath("peer:soc-stub"), breakerPath("notify.send"), breakerPath("odd/name#1")]).toEqual(["/api/breakers/peer%3Asoc-stub", "/api/breakers/notify.send", "/api/breakers/odd%2Fname%231"]);
  });

  it("the breakers: an opening listed twice in the same second is one; a second apart they are two; junk in the open set dropped", () => {
    const o = (name: string, opened_at: string, open = true) => ({ name, why: "calls", count: 4, opened_at, until: "2026-10-21T11:09:59Z", open, closed_at: "", calls: 3, window_s: 60, failures: 2, cooldown_s: 300 });
    const v = breakersOf({
      open: { "notify.send": "2026-10-21T11:09:59Z", bogus: 7 },
      thresholds: { calls: 3, window_s: 60 },
      openings: [o("notify.send", "2026-10-21T11:04:59Z"), o("notify.send", "2026-10-21T11:04:59.512Z"), o("notify.send", "2026-10-21T11:05:00Z", false), o("", "x"), o("odd", "not a date"), o("odd", "not a date")],
    });
    expect(v.open).toEqual({ "notify.send": "2026-10-21T11:09:59Z" });
    expect(v.thresholds).toEqual({ calls: 3, window_s: 60, failures: 0, cooldown_s: 0 });
    expect(v.openings.map((x) => [x.name, x.opened_at])).toEqual([
      ["notify.send", "2026-10-21T11:04:59Z"],
      ["notify.send", "2026-10-21T11:05:00Z"],
      ["odd", "not a date"],
    ]);
    expect(breakersOf(undefined)).toEqual({ open: {}, thresholds: { calls: 0, window_s: 0, failures: 0, cooldown_s: 0 }, openings: [] });
  });
});

describe("the breakers in words", () => {
  const NOW = Date.parse("2026-10-21T11:05:00Z");

  it("what a breaker guards; a span of seconds; why it opened", () => {
    expect([breakerTarget("peer:soc-stub"), breakerTarget("notify.send")]).toEqual([
      { kind: "peer", label: "soc-stub" },
      { kind: "tool", label: "notify.send" },
    ]);
    expect([0, 59, 60, 61, 300, 3600, 5400, -5, 59.6].map(spanText)).toEqual(["0 s", "59 s", "1 min", "1 min 1 s", "5 min", "1 h", "1 h 30 min", "0 s", "1 min"]);
    expect([whyText("calls"), whyText("probe"), whyText("surge"), whyText("")]).toEqual(["too many calls across the estate", "failed again after its cooldown", "surge", "opened"]);
    expect(openingLine({ why: "probe", count: 1, calls: 3, window_s: 60, failures: 2 })).toBe("the one call let through after the cooldown failed");
    expect(openingLine({ why: "surge", count: 3, calls: 3, window_s: 60, failures: 2 })).toBe("3 (surge)");
  });

  it("the thresholds, with either rule off, or both", () => {
    expect(thresholdsLine({ calls: 0, window_s: 60, failures: 4, cooldown_s: 90 })).toBe("Opens on 4 failed calls in a row; stays open 1 min 30 s, then lets one call through.");
    expect(thresholdsLine({ calls: 0, window_s: 60, failures: 0, cooldown_s: 300 })).toBe("Never opens: both the call and the failure thresholds are off; stays open 5 min, then lets one call through.");
  });

  it("when it closes on its own, and how an opening ended", () => {
    expect([secondsLeft("2026-10-21T11:09:59Z", NOW), secondsLeft("not a date", NOW), secondsLeft("2026-10-21T11:00:00Z", NOW)]).toEqual([299, 0, 0]);
    expect([closesText("2026-10-21T11:09:59Z", NOW), closesText("2026-10-21T11:00:00Z", NOW)]).toEqual(["closes on its own in 4 min 59 s", "closing now"]);
    expect(endedText({ open: false, closed_at: "", until: "2026-10-21T11:00:00Z" }, NOW)).toBe("closed on its own 2026-10-21 11:00:00 UTC");
    expect(endedText({ open: true, closed_at: "", until: "2026-10-21T11:05:30Z" }, NOW)).toBe("closes on its own in 30 s");
  });

  it("what is open now, each with the opening still open behind it; the openings that are over", () => {
    const base = { why: "calls", count: 4, calls: 3, window_s: 60, failures: 2, cooldown_s: 300, closed_at: "", run: "", agent: "", source: "" };
    const view = {
      open: { "peer:a": "2026-10-21T11:09:00Z", "notify.send": "2026-10-21T11:10:00Z", lonely: "2026-10-21T11:08:00Z" },
      openings: [
        { ...base, name: "peer:a", opened_at: "2026-10-21T11:04:00Z", until: "2026-10-21T11:09:00Z", open: true, why: "failures" },
        { ...base, name: "peer:a", opened_at: "2026-10-21T10:00:00Z", until: "2026-10-21T10:05:00Z", open: false, closed_at: "2026-10-21T10:01:00Z" },
        { ...base, name: "notify.send", opened_at: "2026-10-21T11:05:00Z", until: "2026-10-21T11:10:00Z", open: true },
      ],
    };
    expect(openBreakers(view).map((b) => [b.name, b.target.kind, b.opening?.opened_at ?? null])).toEqual([
      ["notify.send", "tool", "2026-10-21T11:05:00Z"],
      ["peer:a", "peer", "2026-10-21T11:04:00Z"],
      ["lonely", "tool", null],
    ]);
    expect(pastOpenings(view).map((o) => o.opened_at)).toEqual(["2026-10-21T10:00:00Z"]);
  });

  it("the breaker an attention row names: its data first, else the door's last segment, decoded when it can be", () => {
    expect(breakerOfAttention({ data: { name: "peer:soc-stub" }, action: { path: "/api/breakers/other" } })).toBe("peer:soc-stub");
    expect(breakerOfAttention({ data: null, action: { path: "/api/breakers/peer:soc-stub" } })).toBe("peer:soc-stub");
    expect(breakerOfAttention({ data: {}, action: { path: "/api/breakers/peer%3Asoc-stub" } })).toBe("peer:soc-stub");
    expect(breakerOfAttention({ data: null, action: { path: "/api/breakers/bad%E0%A4%A" } })).toBe("bad%E0%A4%A");
    expect(breakerOfAttention({ data: null, action: { path: "/api/breakers" } })).toBe("");
  });

  it("an attention row of kind breaker: the close while it names the DELETE, the Breakers page otherwise", () => {
    const row = (method: string, path: string) => attentionOf({ id: "breaker:x:t", kind: "breaker", severity: 7, title: "t", action: { method, path, says: "s" } }).action;
    expect([row("DELETE", "/api/breakers/notify.send").kind, row("GET", "/api/breakers").kind, row("GET", "/api/breakers").href, row("DELETE", "/api/breakers").kind]).toEqual(["close", "open", "/breakers", "open"]);
  });
});

describe("the queue's statuses", () => {
  it("in reading order, `cancelled` among them; a status a newer backend adds comes last; zeros kept only when asked", () => {
    expect(JOB_STATUSES).toEqual(["queued", "running", "suspended", "done", "failed", "cancelled"]);
    const agents = { a: { queued: 2, running: 0, done: 5, failed: 1, cancelled: 1, dead: 0, paused: 3, oldest_queued: "2026-10-21T10:00:00Z" }, b: { queued: 1, cancelled: 2 } };
    expect(queueTotals(agents).map((t) => [t.status, t.label, t.count])).toEqual([
      ["queued", "queued", 3],
      ["done", "done", 5],
      ["failed", "failed", 1],
      ["cancelled", "cancelled", 3],
      ["paused", "paused", 3],
    ]);
    expect(queueTotals({}, true).map((t) => t.count)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect([countOf(agents.b, "cancelled"), countOf(agents.b, "running"), countOf(undefined, "queued"), countOf({ queued: Number.NaN }, "queued")]).toEqual([2, 0, 0, 0]);
  });
});

describe("a peer task in a kill's receipt", () => {
  it("read with its peer, task and error; null for every other row", () => {
    const r = reachedOf({ run: "peer:x/t", agent: "x", kind: "peer_task", delivery: "a2a", state: "canceled", peer: "x", task_id: "t" });
    expect([r.kind, r.peer, r.task_id, r.error]).toEqual(["peer_task", "x", "t", null]);
    expect([reachedOf({ run: "r", kind: "run" }).peer, reachedOf({ run: "r", kind: "teleport" }).kind]).toEqual([null, "run"]);
    expect(reachedKindLabel(r)).toBe("peer task");
    expect(peerTaskLine(r)).toBe("task t at x: cancelled, the peer answered canceled");
    expect(peerTaskLine({ ...r, task_id: null, peer: null, delivery: "a2a-refused", error: null, state: "" })).toBe("a task at x: not cancelled");
    expect(peerTaskLine(reachedOf({ run: "r", kind: "run", delivery: "in-process" }))).toBe("");
  });
});
