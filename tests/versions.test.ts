import { describe, expect, it } from "vitest";
import { api } from "@/lib/api/client";
import { budgetLines, defaultPair, diffCounts, diffSections, duration, versionRows, type DiffLine, type SpecDiff, type VersionList } from "@/lib/versions";

/**
 * Plan L2: "every deploy creates a version row; the console shows the diff
 * between two versions in spec vocabulary". lib/versions.ts reads the
 * backend's comparison as a reviewer says it: nodes, edges and guards,
 * tools, grants, gates, budgets and the policy, each added, removed or
 * changed. The responses below were captured from the backend's own app
 * (backend/app with its in-memory registry): five saves of one workflow
 * (`guarded`, from backend/tests/test_agents.py, then a version that drops a
 * node, adds a gate and a tool, scopes a grant and sets a budget and an
 * injection filter, then a model and a label, then a layout-only save), the
 * third deployed, and the diffs between them. When the door changes,
 * capture again and replace the fixture.
 */

interface Fixture {
  status: number;
  body: unknown;
}

const FX: Record<string, Fixture> = {
  "agents_versions": {"status": 200, "body": {"id": "guarded", "versions": [{"version": 1, "digest": "9cd5c9d27e78b877", "saved_by": "Asha Rao", "saved_at": "2026-10-21T08:23:23.483Z", "deployed": false, "deployed_at": null, "nodes": 2, "tools": ["notify.send", "retrieval.search"], "name": "Tiny"}, {"version": 2, "digest": "0010000000000000", "saved_by": "Asha Rao", "saved_at": "2026-10-21T08:23:23.485Z", "deployed": false, "deployed_at": null, "nodes": 3, "tools": ["notify.send", "store.put"], "name": "Tiny"}, {"version": 3, "digest": "0019000000000000", "saved_by": "Asha Rao", "saved_at": "2026-10-21T08:23:23.486Z", "deployed": true, "deployed_at": "2026-10-21T08:23:23.488Z", "nodes": 2, "tools": ["notify.send", "ticket.open"], "name": "Guarded escalation"}, {"version": 4, "digest": "09393203285e6633", "saved_by": "Asha Rao", "saved_at": "2026-10-21T08:23:23.489Z", "deployed": false, "deployed_at": null, "nodes": 2, "tools": ["notify.send", "ticket.open"], "name": "Guarded escalation"}, {"version": 5, "digest": "09393203285e6633", "saved_by": "Asha Rao", "saved_at": "2026-10-21T08:23:23.491Z", "deployed": false, "deployed_at": null, "nodes": 2, "tools": ["notify.send", "ticket.open"], "name": "Guarded escalation"}], "count": 5, "latest": 5, "deployed": 3}},
  "agents_diff_1_2": {"status": 200, "body": {"id": "guarded", "from": {"version": 1, "digest": "9cd5c9d27e78b877"}, "to": {"version": 2, "digest": "0010000000000000"}, "same": false, "metadata": [], "system": [], "nodes": {"added": [{"id": "log", "label": "Log", "harness": "sequence"}], "removed": [], "changed": [{"id": "decide", "label": "Decide", "harness": "sequence", "attributes": ["steps"], "steps": {"added": [], "removed": ["fetch"], "changed": [{"id": "judge", "attributes": ["prompt"]}]}, "changes": []}]}, "edges": {"added": [{"source": "notify", "target": "log", "when": "", "label": ""}], "removed": []}, "guards": [{"where": "edge", "source": "decide", "target": "notify", "node": "", "step": "", "from": "verdict == \"escalate\"", "to": "verdict == \"escalate\" or verdict == \"urgent\""}], "grants": [{"node": "decide", "added": [], "removed": ["retrieval.search"], "scope_changed": []}, {"node": "log", "added": ["store.put"], "removed": [], "scope_changed": []}], "gates": {"added": [], "removed": [], "changed": [{"at_or_above": "risky", "approvers": ["dlp-lead", "ciso"], "nodes": [], "on_timeout": "escalate", "timeout_s": 86400.0, "attributes": ["approvers"], "changes": [{"field": "approvers", "from": ["dlp-lead"], "to": ["dlp-lead", "ciso"]}]}]}, "tools": {"added": [{"name": "store.put", "risk": "write", "server": "store"}], "removed": [{"name": "retrieval.search", "risk": "read", "server": "retrieval"}], "changed": []}, "policy": [], "summary": ["node log added (sequence)", "node decide changed: steps", "edge notify → log added", "guard on decide → notify changed: verdict == \"escalate\" → verdict == \"escalate\" or verdict == \"urgent\"", "grant retrieval.search removed from decide", "grant store.put added to log", "gate at risky changed: approvers", "tool store.put added (write)", "tool retrieval.search removed"]}},
  "agents_diff_2_3": {"status": 200, "body": {"id": "guarded", "from": {"version": 2, "digest": "0010000000000000"}, "to": {"version": 3, "digest": "0019000000000000"}, "same": false, "metadata": [{"field": "name", "from": "Tiny", "to": "Guarded escalation"}, {"field": "description", "from": null, "to": "Decide, notify the SOC, keep a log."}], "system": [], "nodes": {"added": [], "removed": [{"id": "log", "label": "Log", "harness": "sequence"}], "changed": [{"id": "notify", "label": "Notify", "harness": "sequence", "attributes": ["steps"], "steps": {"added": ["ticket"], "removed": [], "changed": []}, "changes": []}]}, "edges": {"added": [], "removed": [{"source": "notify", "target": "log", "when": "", "label": ""}]}, "guards": [], "grants": [{"node": "log", "added": [], "removed": ["store.put"], "scope_changed": []}, {"node": "notify", "added": ["ticket.open"], "removed": [], "scope_changed": ["notify.send"]}], "gates": {"added": [{"at_or_above": "write", "approvers": ["records-lead"], "nodes": ["notify"], "on_timeout": "escalate", "timeout_s": 86400.0}], "removed": [], "changed": [{"at_or_above": "risky", "approvers": ["dlp-lead", "ciso"], "nodes": [], "on_timeout": "abort", "timeout_s": 7200.0, "attributes": ["on_timeout", "timeout_s"], "changes": [{"field": "on_timeout", "from": "escalate", "to": "abort"}, {"field": "timeout_s", "from": 86400.0, "to": 7200.0}]}]}, "tools": {"added": [{"name": "ticket.open", "risk": "write", "server": "tickets"}], "removed": [{"name": "store.put", "risk": "write", "server": "store"}], "changed": [{"name": "notify.send", "risk": "destructive", "server": "notify", "attributes": ["risk"]}]}, "policy": [{"field": "injection", "from": {"patterns": [], "prohibited_actions": [], "action": "block"}, "to": {"patterns": ["ignore previous instructions"], "prohibited_actions": ["wire money"], "action": "flag"}}, {"field": "block_tainted_sinks", "from": true, "to": false}, {"field": "budget", "from": null, "to": {"tool_calls": 500, "cost_usd": 5.0, "wall_clock_s": 900.0}}], "summary": ["metadata.name changed", "metadata.description changed", "node log removed (sequence)", "node notify changed: steps", "edge notify → log removed", "grant store.put removed from log", "grant ticket.open added to notify", "scope of notify.send on notify changed", "gate at write added on notify", "gate at risky changed: on_timeout, timeout_s", "tool ticket.open added (write)", "tool store.put removed", "tool notify.send changed: risk", "policy.injection changed", "policy.block_tainted_sinks changed", "policy.budget changed"]}},
  "agents_diff_3_4": {"status": 200, "body": {"id": "guarded", "from": {"version": 3, "digest": "0019000000000000"}, "to": {"version": 4, "digest": "09393203285e6633"}, "same": false, "metadata": [], "system": [], "nodes": {"added": [], "removed": [], "changed": [{"id": "notify", "label": "Notify the SOC", "harness": "sequence", "attributes": ["label", "model"], "steps": null, "changes": [{"field": "model", "from": null, "to": "gpt-4o"}, {"field": "label", "from": "Notify", "to": "Notify the SOC"}]}]}, "edges": {"added": [], "removed": []}, "guards": [], "grants": [], "gates": {"added": [], "removed": [], "changed": []}, "tools": {"added": [], "removed": [], "changed": []}, "policy": [{"field": "budget", "from": {"tool_calls": 500, "cost_usd": 5.0, "wall_clock_s": 900.0}, "to": {"tool_calls": 200, "tokens": 200000, "cost_usd": 2.5}}], "summary": ["node notify changed: label, model", "policy.budget changed"]}},
  "agents_diff_4_5": {"status": 200, "body": {"id": "guarded", "from": {"version": 4, "digest": "09393203285e6633"}, "to": {"version": 5, "digest": "09393203285e6633"}, "same": true, "metadata": [], "system": [], "nodes": {"added": [], "removed": [], "changed": []}, "edges": {"added": [], "removed": []}, "guards": [], "grants": [], "gates": {"added": [], "removed": [], "changed": []}, "tools": {"added": [], "removed": [], "changed": []}, "policy": [], "summary": []}},
  "agents_diff_missing": {"status": 404, "body": {"error": "\"guarded\" has no version 9"}},
};

const diff = (name: string) => FX[name].body as SpecDiff;
const lines = (d: SpecDiff) => Object.fromEntries(diffSections(d).map((s) => [s.id, s.lines.map((l: DiffLine) => `${l.op} ${l.subject} · ${l.detail}`)]));

/** The generated client's per-request options that answer with a fixture. */
const replay = (name: string) => ({
  baseUrl: "http://console.test",
  fetch: async () => new Response(JSON.stringify(FX[name].body), { status: FX[name].status, headers: { "content-type": "application/json" } }),
});

describe("the version list", () => {
  it("newest first: who saved it, when, its digest, and whether it is deployed, deployed before, or a draft", () => {
    const rows = versionRows(FX.agents_versions.body as VersionList);
    expect(rows.map((r) => [r.version, r.status, r.latest])).toEqual([
      [5, "draft", true],
      [4, "draft", false],
      [3, "deployed", false],
      [2, "draft", false],
      [1, "draft", false],
    ]);
    expect(rows.every((r) => r.saved_by === "Asha Rao" && r.saved_at.endsWith("Z") && r.digest.length === 16)).toBe(true);
    expect(rows.find((r) => r.version === 3)!.deployed_at).toBe("2026-10-21T08:23:23.488Z");
    // A layout-only save repeats the digest before it: it runs the same.
    expect(rows.map((r) => r.sameAs)).toEqual([4, null, null, null, null]);
  });

  it("opens on what is deployed against the latest save, else the latest against the one before", () => {
    const list = FX.agents_versions.body as VersionList;
    expect(defaultPair(list)).toEqual({ from: 3, to: 5 });
    expect(defaultPair({ ...list, deployed: 5 })).toEqual({ from: 4, to: 5 });
    expect(defaultPair({ ...list, deployed: null })).toEqual({ from: 4, to: 5 });
    expect(defaultPair({ ...list, versions: list.versions.slice(0, 1), latest: 1, deployed: null, count: 1 })).toBeNull();
  });

  it("a version deployed before the current deployment says so", () => {
    const list = FX.agents_versions.body as VersionList;
    const later = { ...list, deployed: 5, versions: list.versions.map((v) => (v.version === 5 ? { ...v, deployed: true } : v)) };
    expect(versionRows(later).map((r) => [r.version, r.status])).toEqual([[5, "deployed"], [4, "draft"], [3, "deployed earlier"], [2, "draft"], [1, "draft"]]);
  });
});

describe("a diff in spec vocabulary", () => {
  it("v1 → v2: a node and its edge added, a step removed and a prompt reworded, a guard widened, a tool and its grant swapped, an approver added", () => {
    const d = diff("agents_diff_1_2");
    expect(d.same).toBe(false);
    expect(lines(d)).toEqual({
      nodes: ['added node log · sequence, "Log"', "changed node decide · steps: removed fetch; judge changed (prompt)"],
      edges: ["added edge notify → log · always taken"],
      guards: ['changed guard on decide → notify · verdict == "escalate" → verdict == "escalate" or verdict == "urgent"'],
      tools: ["added tool store.put · write, server store", "removed tool retrieval.search · was read, server retrieval"],
      grants: ["removed grant retrieval.search · from node decide", "added grant store.put · to node log"],
      gates: ["changed gate at risky · approvers dlp-lead → dlp-lead, ciso"],
    });
    expect(diffSections(d).map((s) => s.title)).toEqual(["Nodes", "Edges", "Guards", "Tools", "Grants", "Gates"]);
    expect(diffCounts(diffSections(d))).toEqual({ added: 4, removed: 2, changed: 3 });
  });

  it("v2 → v3: the name, a node gone with its edge and grant, a tool's risk, a scope, a gate added and one changed, a budget set, the injection filter and the sink rule", () => {
    expect(lines(diff("agents_diff_2_3"))).toEqual({
      metadata: ['changed name · "Tiny" → "Guarded escalation"', 'added description · "Decide, notify the SOC, keep a log."'],
      nodes: ['removed node log · sequence, "Log"', "changed node notify · steps: added ticket"],
      edges: ["removed edge notify → log · was always taken"],
      tools: ["added tool ticket.open · write, server tickets", "removed tool store.put · was write, server store", "changed tool notify.send · risk (now destructive) changed"],
      grants: ["removed grant store.put · from node log", "added grant ticket.open · to node notify", "changed scope of notify.send · on node notify: the arguments it may take changed"],
      gates: ["added gate at write on notify · approvers records-lead; on timeout escalate after 1 d", "changed gate at risky · on timeout escalate → abort; timeout 1 d → 2 h"],
      budget: ["changed tool calls per run · 200 (the default) → 500", "added cost limit per run · $5.00 (unlimited before)", "added wall clock limit per run · 15 min (unlimited before)"],
      policy: [
        'added injection pattern · "ignore previous instructions"',
        'added prohibited action · "wire money"',
        "changed on an injection · refuse the step → flag it and go on to a gate",
        "changed tainted data reaching a sink · refused outright → gated, as any risky call is",
      ],
    });
  });

  it("deployed (v3) → v4: a model and a label with both values; the budget limit by limit", () => {
    const d = diff("agents_diff_3_4");
    expect(d.from.version).toBe(3);
    expect(lines(d)).toEqual({
      nodes: ['changed node notify · model (none) → "gpt-4o"; label "Notify" → "Notify the SOC"'],
      budget: [
        "changed tool calls per run · 500 → 200",
        "added tokens limit per run · 200,000 (unlimited before)",
        "changed cost limit per run · $5.00 → $2.50",
        "removed wall clock limit per run · was 15 min; unlimited now",
      ],
    });
  });

  it("v4 → v5: layout only, so the digests are equal and nothing is listed", () => {
    const d = diff("agents_diff_4_5");
    expect(d.same).toBe(true);
    expect(d.from.digest).toBe(d.to.digest);
    expect(diffSections(d)).toEqual([]);
  });

  it("is never a JSON diff: every line names a thing in the spec, and no line carries a raw document", () => {
    for (const name of ["agents_diff_1_2", "agents_diff_2_3", "agents_diff_3_4"]) {
      for (const s of diffSections(diff(name))) {
        for (const l of s.lines) {
          expect(`${l.subject} ${l.detail}`, `${name} ${s.id}`).not.toMatch(/[{}[\]]|"(from|to|field)":/);
          expect(l.subject).toMatch(/^(node|edge|guard|tool|grant|scope|gate|name|description|injection|prohibited|on an injection|tainted|tool calls|tokens|cost|wall clock|entry|trigger|outputs|evals)/);
        }
      }
    }
  });
});

describe("budgets, limit by limit", () => {
  it("no budget on either side is the runtime's default: nothing to say", () => {
    expect(budgetLines(null, null)).toEqual([]);
    expect(budgetLines(undefined, { tool_calls: 200 })).toEqual([]);
  });

  it("a limit set, dropped or moved; tool calls against the default", () => {
    expect(budgetLines(null, { tokens: 1000 })).toEqual([{ op: "added", subject: "tokens limit per run", detail: "1,000 (unlimited before)" }]);
    expect(budgetLines({ cost_usd: 1, tool_calls: 50 }, null)).toEqual([
      { op: "changed", subject: "tool calls per run", detail: "50 → 200 (the default)" },
      { op: "removed", subject: "cost limit per run", detail: "was $1.00; unlimited now" },
    ]);
    expect(budgetLines({ wall_clock_s: 90 }, { wall_clock_s: 7200 })).toEqual([{ op: "changed", subject: "wall clock limit per run", detail: "90 s → 2 h" }]);
  });

  it("durations read as the spec's timeouts do", () => {
    expect([duration(90), duration(900), duration(7200), duration(86400), duration(129600)]).toEqual(["90 s", "15 min", "2 h", "1 d", "36 h"]);
  });
});

describe("the doors, through the generated client", () => {
  it("GET /api/agents/{agent}/versions and /diff answer the shapes the page reads", async () => {
    const versions = await api.GET("/api/agents/{agent}/versions", { params: { path: { agent: "guarded" } }, ...replay("agents_versions") });
    expect(versions.data!.count).toBe(5);
    expect(versions.data!.deployed).toBe(3);
    const d = await api.GET("/api/agents/{agent}/diff", { params: { path: { agent: "guarded" }, query: { from: "1", to: "2" } }, ...replay("agents_diff_1_2") });
    expect(diffSections(d.data!).length).toBe(6);
  });

  it("a version that does not exist is a 404 the page shows as the backend says it", async () => {
    const { data, error, response } = await api.GET("/api/agents/{agent}/diff", { params: { path: { agent: "guarded" }, query: { from: "1", to: "9" } }, ...replay("agents_diff_missing") });
    expect(data).toBeUndefined();
    expect(response.status).toBe(404);
    expect(error).toEqual({ error: '"guarded" has no version 9' });
  });
});
