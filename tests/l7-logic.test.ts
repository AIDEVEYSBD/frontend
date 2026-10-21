import { describe, expect, it } from "vitest";
import { attentionOf, operatorOf } from "@/lib/api/l5";
import { blastOf, depMapOf, killReceiptOf, nodePath, rateLimitOf, treeNodeOf, treeOf, type RunTree, type TreeNode } from "@/lib/api/l7";
import { byAgentRows, deliveryText, fmtUsd, inFlightNodes, isRecordReached, killSummary, nodeKindLabel, reachedGroups, reachedKindLabel, refusalLine, treeRows, treeSummary } from "@/lib/run-tree";
import { limitText, rateLimitText, scopeText, secondsLeft, waitText } from "@/lib/rate-limit";
import { adjacency, blastCountsLine, blastIds, blastRefusalText, drawnEnds, edgeLook, groupByLayer, nameOf, nodeTitle, pathText } from "@/lib/dependencies";
import { driftVerdict, orderDrift, sideText, statText, thresholdText, windowsLine } from "@/lib/drift";
import { cadenceText, capText, coverageText, formOf, formProblems, mayText, patchOf } from "@/lib/guardian";

/**
 * The pure logic the L7 pages render with, on shapes built here: the run
 * tree's outline and rollup, the kill's receipt, a rate limit in words, the
 * dependency map's layers and a node's neighbourhood, the blast radius in
 * words, drift's figures and the guardian's form. tests/l7-contract.test.ts
 * holds the same helpers against captured responses; these hold the cases
 * a capture does not reach (deeper trees, torn records, odd figures).
 */

const node = (run: string, parent: string | null, over: Partial<TreeNode> = {}): TreeNode =>
  treeNodeOf({ run, agent: run.split("-")[0], source: "console", state: "done", parent, depth: 0, kind: "run", link: parent ? "parent" : "root", ...over });

const tree = (nodes: TreeNode[], over: Partial<RunTree> = {}): RunTree => ({ ...treeOf({ root: nodes[0]?.run ?? "", asked: nodes[0]?.run ?? "", nodes: [] }), nodes, count: nodes.length, ...over });

describe("the run tree's outline", () => {
  it("draws guide lines for every ancestor with siblings still to come", () => {
    // root ─┬─ a ─┬─ a1 ── a1x
    //       │     └─ a2
    //       └─ b ─── b1
    const t = tree([node("root", null), node("a", "root"), node("b", "root"), node("a1", "a"), node("a2", "a"), node("a1x", "a1"), node("b1", "b")]);
    expect(treeRows(t).map((r) => [r.node.run, r.level, r.guides, r.last, r.children, r.descendants])).toEqual([
      ["root", 0, [], true, 2, 6],
      ["a", 1, [], false, 2, 3],
      ["a1", 2, [true], false, 1, 1],
      ["a1x", 3, [true, true], true, 0, 0],
      ["a2", 2, [true], true, 0, 0],
      ["b", 1, [], true, 1, 1],
      ["b1", 2, [false], true, 0, 0],
    ]);
  });

  it("hangs a node whose parent the tree does not hold under the root, and draws a cycle once", () => {
    const t = tree([node("root", null), node("lost", "cut-by-the-limit"), node("x", "y"), node("y", "x")]);
    const rows = treeRows(t);
    // x and y name each other: neither reaches the root, so the walk takes x up under it and y beneath x.
    expect(rows.map((r) => [r.node.run, r.level, r.stray])).toEqual([
      ["root", 0, false],
      ["lost", 1, true],
      ["x", 1, false],
      ["y", 2, false],
    ]);
    // Every node shows exactly once.
    expect(new Set(rows.map((r) => r.node.run)).size).toBe(4);
  });

  it("finds the root when the answer names none, and an empty tree has no rows", () => {
    const nodes = [node("child", "top"), node("top", null)];
    expect(treeRows({ root: "", asked: "", nodes }).map((r) => r.node.run)).toEqual(["top", "child"]);
    expect(treeRows({ root: "", asked: "", nodes: [] })).toEqual([]);
  });

  it("names each kind of node", () => {
    expect([
      nodeKindLabel(node("r", null)),
      nodeKindLabel(node("c", "r")),
      nodeKindLabel(node("t", "r", { link: "trace" })),
      nodeKindLabel(node("s", "r", { kind: "sub_run", link: "journal" })),
      nodeKindLabel(node("p", "r", { kind: "peer", link: "journal" })),
    ]).toEqual(["orchestrator", "child run", "same trace", "sub-run", "peer task"]);
  });

  it("a node with no total stands for itself; odd values read as nothing", () => {
    const n = treeNodeOf({ run: "x", agent: "a", source: "sdk", state: "running", cost: 0.5, tokens: "lots", tool_calls: 2, refusals: null, kind: "weird", link: "nowhere" });
    expect([n.kind, n.link, n.tokens, n.refusals, n.total]).toEqual(["run", "root", 0, 0, { cost: 0.5, tokens: 0, tool_calls: 2, refusals: 0 }]);
  });
});

describe("the rollup in words", () => {
  const refused = (n: number, over: Partial<TreeNode> = {}) => ({ refusals: n, ...over });
  it("says where the refusals were", () => {
    expect(refusalLine(tree([node("r", null)]))).toBe("no refusals");
    expect(refusalLine(tree([node("r", null, refused(1))]))).toBe("1 refusal in the orchestrator");
    expect(refusalLine(tree([node("r", null), node("c", "r", refused(1)), node("d", "r", refused(1))]))).toBe("2 refusals in child runs");
    expect(refusalLine(tree([node("r", null, refused(2)), node("s", "r", refused(3, { kind: "sub_run" }))]))).toBe("5 refusals: 2 in the orchestrator, 3 in sub-runs");
  });

  it("the summary counts records, sub-runs and peer tasks apart", () => {
    const t = tree([node("r", null), node("s", "r", { kind: "sub_run" }), node("p", "r", { kind: "peer" })], {
      rollup: { cost: 0.0123, tokens: 12_345, tool_calls: 1, refusals: 0, by_agent: {} },
    });
    expect(treeSummary(t)).toBe("1 run, 1 sub-run, 1 peer task · $0.01 · 12k tokens · 1 tool call · no refusals");
  });

  it("by agent: the costliest first, a peer marked", () => {
    const t = tree([node("r", null)], {
      rollup: {
        cost: 0,
        tokens: 0,
        tool_calls: 0,
        refusals: 0,
        by_agent: {
          b: { cost: 0.1, tokens: 1, tool_calls: 0, refusals: 0, nodes: 1 },
          "peer:x": { cost: 0, tokens: 0, tool_calls: 0, refusals: 0, nodes: 2 },
          a: { cost: 0.1, tokens: 1, tool_calls: 0, refusals: 4, nodes: 1 },
        },
      },
    });
    expect(byAgentRows(t).map((r) => [r.key, r.label, r.peer])).toEqual([
      ["a", "a", false],
      ["b", "b", false],
      ["peer:x", "x", true],
    ]);
  });

  it("in flight: running records and starting sub-runs, never a peer leaf or a run at a gate", () => {
    const t = tree([node("r", null, { state: "killed" }), node("s", "r", { kind: "sub_run", state: "starting" }), node("p", "r", { kind: "peer", state: "running" }), node("g", "r", { state: "suspended" }), node("w", "r", { state: "running" })]);
    expect(inFlightNodes(t).map((n) => n.run)).toEqual(["s", "w"]);
  });

  it("dollars at the precision a run needs", () => {
    expect([fmtUsd(0), fmtUsd(0.00004), fmtUsd(0.000175), fmtUsd(0.0123), fmtUsd(12.345), fmtUsd(1234.5), fmtUsd(Number.NaN)]).toEqual(["$0", "<$0.0001", "$0.00017", "$0.01", "$12.35", "$1,235", "$0"]);
  });
});

describe("the kill's receipt", () => {
  it("a lone run: nothing else in flight; delivered to an SDK", () => {
    const r = killReceiptOf({ run: "x", state: "running", kill: { reason: "stop", by: "Ann", at: "t" }, delivery: "sdk", reached: [{ run: "x", agent: "a", kind: "run", delivery: "sdk", depth: 0, state: "running" }] });
    expect(killSummary(r)).toBe("Kill requested by Ann: the run on its SDK's next control poll; nothing else in flight in its tree.");
  });

  it("a delivery a newer backend names is counted, shown last, in its own words", () => {
    const r = killReceiptOf({
      run: "x",
      state: "running",
      kill: { reason: "stop", by: "", at: "t" },
      delivery: "in-process",
      reached: [
        { run: "x", agent: "a", kind: "run", delivery: "in-process" },
        { run: "p1", agent: "peer", kind: "run", delivery: "a2a-cancel", depth: 1 },
        { run: "q", agent: "a", kind: "job", delivery: "queue", depth: 1 },
      ],
    });
    expect(killSummary(r)).toBe("Kill requested: the run stopped here; 1 queued job dead-lettered, 1 more.");
    expect(reachedGroups(r).map((g) => g.delivery)).toEqual(["in-process", "queue", "a2a-cancel"]);
    expect(deliveryText("a2a-cancel")).toBe("delivered: a2a-cancel");
  });

  it("a peer's task the kill reaches over A2A: counted, labelled, never linked as a run", () => {
    // The shape the backend's A2A round answers with (tests/l7b-contract.test.ts holds the captured one): kind peer_task, delivery a2a or a2a-refused.
    const r = killReceiptOf({
      run: "x",
      state: "running",
      kill: { reason: "stop", by: "Ann", at: "t" },
      delivery: "in-process",
      reached: [
        { run: "x", agent: "a", kind: "run", delivery: "in-process" },
        { run: "peer:vendor-bot/t-77", agent: "vendor-bot", source: "peer", kind: "peer_task", delivery: "a2a-refused", depth: 1, peer: "vendor-bot", task_id: "t-77", error: "no peer registered" },
      ],
    });
    const peer = r.reached[1];
    expect([isRecordReached(peer), reachedKindLabel(peer), deliveryText(peer.delivery)]).toEqual([false, "peer task", "a peer's task: the cancel could not be delivered, or the peer said no"]);
    expect(killSummary(r)).toBe("Kill requested by Ann: the run stopped here; 1 peer task the cancel did not reach.");
    expect(reachedGroups(r).map((g) => g.delivery)).toEqual(["in-process", "a2a-refused"]);
  });

  it("an unknown delivery of the run itself is read as in-process; a reached entry without a run is dropped", () => {
    const r = killReceiptOf({ run: "x", kill: {}, delivery: "teleport", reached: [{ agent: "a" }] });
    expect([r.delivery, r.reached]).toEqual(["in-process", []]);
  });
});

describe("a rate limit in words", () => {
  it("whose, which, how many, when", () => {
    expect([waitText(0), waitText(59), waitText(60), waitText(75)]).toEqual(["now", "59 s", "1 min", "1 min 15 s"]);
    expect([limitText("sub_runs_per_minute"), limitText("brand_new_limit")]).toEqual(["sub-runs per minute", "brand new limit"]);
    expect([scopeText({ scope: "tree", agent: "a", tree: "" }), scopeText({ scope: "agent", agent: "", tree: "t" })]).toEqual(["the tree", "agent unknown"]);
    expect(secondsLeft(10_000, 10_500)).toBe(0);
    const rl = rateLimitOf(429, { scope: "agent", limit: "sub_runs_per_minute", used: 300, allowed: 300, retry_after_s: 0.4, agent: "casework" })!;
    // Never less than a second.
    expect(rl.retry_after_s).toBe(1);
    expect(rateLimitText(rl)).toBe("Rate limited for agent casework: sub-runs per minute, 300 used of 300 allowed (sub_runs_per_minute). Retry in 1 s.");
  });
});

describe("the dependency map's layout", () => {
  const map = depMapOf({
    nodes: [
      { id: "agent:zed", kind: "agent", label: "Zed", health: "ok" },
      { id: "agent:amy", kind: "agent", label: "amy", health: "idle" },
      { id: "tool:mail.send", kind: "tool", label: "mail.send", health: "ok" },
      { id: "server:mailer", kind: "server", label: "Mailer", health: "changed" },
      { id: "connector:web", kind: "connector", label: "web", health: "idle" },
      { id: "model:gpt-4o", kind: "model", label: "gpt-4o", health: "ok" },
    ],
    edges: [
      { from: "agent:zed", to: "tool:mail.send", kind: "calls", count: 120, failures: 0, refusals: 0, declared: false, observed: true },
      { from: "server:mailer", to: "tool:mail.send", kind: "serves", count: 120, declared: true, observed: true },
      { from: "agent:amy", to: "agent:zed", kind: "sub_run", count: 0, declared: true, observed: false },
      { from: "agent:zed", to: "model:gpt-4o", kind: "uses_model", count: 3, refusals: 1, declared: true, observed: true },
    ],
  });

  it("four columns in the direction of dependence; an empty column stays, its groups by kind and name", () => {
    const cols = groupByLayer(map);
    expect(cols.map((c) => [c.key, c.count, c.groups.map((g) => g.nodes.map((n) => n.id))])).toEqual([
      ["applications", 0, []],
      ["agents", 2, [["agent:amy", "agent:zed"]]],
      ["reached", 2, [["model:gpt-4o"], ["tool:mail.send"]]],
      ["serving", 2, [["server:mailer"], ["connector:web"]]],
    ]);
    expect(groupByLayer({ nodes: [] }).map((c) => c.groups.length)).toEqual([0, 0, 0, 0]);
  });

  it("names: an agent by its id with its spec name beside it; anything else by its label", () => {
    expect(nodeTitle({ id: "agent:zed", kind: "agent", label: "Zed" })).toEqual({ title: "zed", subtitle: "Zed" });
    expect(nodeTitle({ id: "server:mailer", kind: "server", label: "Mailer" })).toEqual({ title: "Mailer", subtitle: "mailer" });
    expect(nodeTitle({ id: "model:meta/llama-3-70b", kind: "model", label: "meta/llama-3-70b" })).toEqual({ title: "meta/llama-3-70b", subtitle: "" });
    expect([nameOf("tool:a.b"), nameOf("bare")]).toEqual(["a.b", "bare"]);
  });

  it("edges: seen without a spec is amber, a refusal red, declared and unused dashed; the busier the thicker", () => {
    const [seen, serves, declared, refused] = map.edges;
    expect(edgeLook(seen)).toMatchObject({ tone: "warn", dash: undefined });
    expect(edgeLook(declared)).toMatchObject({ tone: "line", dash: "4 4", width: 1 });
    expect(edgeLook(refused).tone).toBe("err");
    expect(edgeLook(seen).width).toBeGreaterThan(edgeLook(refused).width);
    expect(edgeLook({ evidence: "both", failures: 0, refusals: 0, count: 1e9 }).width).toBe(3.5);
    // A `serves` edge is drawn the way dependence runs: from the tool to its server.
    expect(drawnEnds(serves)).toEqual({ from: "tool:mail.send", to: "server:mailer" });
    expect(drawnEnds(seen)).toEqual({ from: "agent:zed", to: "tool:mail.send" });
  });

  it("a server's neighbourhood: the tools it serves depend on it", () => {
    expect(adjacency(map, "server:mailer")).toMatchObject({ dependsOn: [], dependedOnBy: [{ other: "tool:mail.send" }] });
    expect(adjacency(map, "agent:zed").dependsOn.map((x) => x.other)).toEqual(["tool:mail.send", "model:gpt-4o"]);
    expect(adjacency(map, "agent:zed").dependedOnBy.map((x) => x.other)).toEqual(["agent:amy"]);
  });
});

describe("the blast radius in words", () => {
  const b = blastOf({
    node: { id: "model:gpt-4o", kind: "model", label: "gpt-4o", health: "ok" },
    agents: [{ id: "agent:solo", via: ["model:gpt-4o", "agent:solo"] }],
    runs_in_flight: [],
    applications: [{ id: "chat", class: "chatbot", source: "application", via: "application:chat" }],
  });

  it("counts read off the lists when the answer carries none; one of each in the singular", () => {
    expect(b.counts).toEqual({ direct: 1, transitive: 0, agents: 1, runs_in_flight: 0, applications: 1 });
    expect(b.agents[0]).toEqual({ id: "agent:solo", agent: "solo", how: "direct", via: ["model:gpt-4o", "agent:solo"] });
    expect(blastCountsLine(b)).toBe("1 agent (1 direct, 0 through another agent) · 0 runs in flight · 1 application");
    expect(blastCountsLine(blastOf({ node: {}, counts: { agents: 0, direct: 0, transitive: 0, runs_in_flight: 2, applications: 0 } }))).toBe("no agent · 2 runs in flight · 0 applications");
  });

  it("paths by name, falling back to the id's name for a node the map does not hold; what it lights up", () => {
    expect(pathText(["model:gpt-4o", "agent:solo"], new Map())).toBe("gpt-4o → solo");
    expect([...blastIds(b)].sort()).toEqual(["agent:solo", "application:chat", "model:gpt-4o"]);
  });

  it("any id is asked, slashes and all, encoded as a path; refusals in the reader's words", () => {
    expect([nodePath("model:openai/gpt-4o"), nodePath("server:casedesk"), nodePath("tool:a b/c?d")]).toEqual(["model%3Aopenai/gpt-4o", "server%3Acasedesk", "tool%3Aa%20b/c%3Fd"]);
    expect(blastRefusalText(500, "the backend answered 500")).toBe("the backend answered 500");
    expect(blastRefusalText(404, "")).toBe("No such node. The map may have moved since it was read; read it again.");
  });
});

describe("drift's figures", () => {
  const m = (over: Record<string, unknown>) => ({ name: "cost_per_run", kind: "mean", statistic: "welch_z", distance: null, z: null, threshold: 2, drifted: false, enough: true, says: "", recent: {}, baseline: {}, field: null, ...over }) as Parameters<typeof statText>[0] & Parameters<typeof sideText>[0];

  it("a z the data cannot bound, a negative one, a mix with no distance", () => {
    expect(statText(m({ z: 99 }))).toBe("z +99 (no spread)");
    expect(statText(m({ z: -99 }))).toBe("z −99 (no spread)");
    expect(statText(m({ z: -2.456 }))).toBe("z −2.46");
    expect(statText(m({ kind: "mix", distance: null }))).toBe("—");
    expect(thresholdText({ kind: "rate", threshold: 2 })).toBe("past ±2");
  });

  it("a mix keeps its three largest shares and says how many more", () => {
    const side = { counts: { a: 4, b: 3, c: 2, d: 1 }, shares: { a: 0.4, b: 0.3, c: 0.2, d: 0.1 }, n: 10 };
    expect(sideText(m({ kind: "mix", name: "tool_mix" }), side)).toBe("a 40% · b 30% · c 20% · +1 more (n 10)");
    expect(sideText(m({ kind: "rate", name: "refusal_rate" }), { rate: 0.125, runs_with: 1, n: 8 })).toBe("13% of runs (1 of 8)");
    expect(sideText(m({ kind: "mean", name: "confidence" }), { mean: 0.8125, sd: 0.05, n: 4 })).toBe("0.81 ± 0.05 (n 4)");
    expect(sideText(m({ kind: "mix", name: "tool_mix" }), {})).toBe("—");
  });

  it("windows from the report, the verdict, and the reading order", () => {
    const w = { recent: { since: "", until: "", runs: 1 }, baseline: { since: "", until: "", runs: 30 } };
    expect(windowsLine(w, { recent_h: 6, baseline_d: 14 })).toBe("1 run in the last 6 h against 30 in the 14 days before");
    expect(driftVerdict({ enough: true, drifted: true, measures: [], says: "shifted: x" })).toEqual({ tone: "err", label: "Drifted", detail: "shifted: x" });
    expect(driftVerdict({ enough: true, drifted: false, measures: [], says: "" })).toEqual({ tone: "ok", label: "Within thresholds", detail: "no measure past its threshold" });
    const a = (agent: string, drifted: boolean, enough: boolean) => ({ agent, drifted, enough, says: "", outcome_field: null, measures: [], ...w });
    expect(orderDrift([a("c", false, false), a("b", false, true), a("z", true, true), a("a", true, true)]).map((x) => x.agent)).toEqual(["a", "z", "b", "c"]);
  });
});

describe("the guardian's form", () => {
  const view = { enabled: true, model: "", agents: ["triage"] as string[] | "*", may: ["hold"] as ("hold" | "block")[], max_actions_per_hour: 10, min_confidence: 0.8, rubric: "", every_entries: 5, every_s: 15, set_by: "", set_at: "", audit_id: null, actions_last_hour: 0, stats: { evaluations: 0, ok: 0, acted: 0, attention: 0, unparseable: 0, errors: 0, repeated: 0, watching: 0 } };

  it("refuses before sending what the door would refuse", () => {
    const f = formOf(view);
    expect(formProblems(f)).toEqual({});
    expect(Object.keys(formProblems({ ...f, max_actions_per_hour: "1.5", min_confidence: "", every_entries: "0", every_s: "0.05", agents: ["Bad Id"], rubric: "x".repeat(4001) })).sort()).toEqual(["agents", "every_entries", "every_s", "max_actions_per_hour", "min_confidence", "rubric"]);
    // Every agent: the ids typed are not read.
    expect(formProblems({ ...f, allAgents: true, agents: ["Bad Id"] })).toEqual({});
  });

  it("sends a reordered agent list as a change, and trims", () => {
    expect(patchOf({ ...view, agents: ["a", "b"] }, { ...formOf({ ...view, agents: ["a", "b"] }), agents: ["b", "a"] })).toEqual({ agents: ["b", "a"] });
    expect(patchOf(view, { ...formOf(view), model: "  gpt-4o  ", agents: [" triage ", "triage"] })).toEqual({ model: "gpt-4o" });
    expect(patchOf(view, { ...formOf(view), hold: false })).toEqual({ may: [] });
  });

  it("says what it watches, what it may do, its cap and its cadence", () => {
    expect([coverageText({ enabled: false, agents: "*" }), coverageText({ enabled: true, agents: [] }), coverageText({ enabled: true, agents: "*" }), coverageText({ enabled: true, agents: ["a", "b"] })]).toEqual([
      "off: it judges no run",
      "on, but no agent is named: it judges no run",
      "every agent's runs",
      "the runs of a, b",
    ]);
    expect([mayText([]), mayText(["block"]), mayText(["hold", "block"])]).toEqual([
      "nothing on its own: every verdict is raised for a person",
      "block (kill) a run; a hold is raised for a person",
      "hold a run at its next gate, or block (kill) it",
    ]);
    expect(capText({ actions_last_hour: 3, max_actions_per_hour: 0 })).toBe("3 acts in the last hour; the cap is 0, so it acts on nothing");
    expect(cadenceText({ every_entries: 1, every_s: 0.5 })).toBe("every 1 new entry, or after 0.5 s with at least one");
  });
});

describe("attention rows of the L7 kinds, sparse", () => {
  it("a drift row without a query names its own agent's page; a guardian row's door decides its lever", () => {
    expect(attentionOf({ kind: "drift", agent: "triage", action: { method: "GET", path: "/api/drift" } }).action).toMatchObject({ kind: "open", href: "/drift?agent=triage" });
    expect(attentionOf({ kind: "drift", action: { method: "GET", path: "/api/drift?agent=%E0%A4%A" } }).action.href).toBe("/drift");
    expect(attentionOf({ kind: "guardian", run: "r", action: { method: "POST", path: "/api/runs/r/kill", body: { reason: "guardian: x" } } }).action.kind).toBe("kill");
    expect(attentionOf({ kind: "guardian", run: "r", action: { method: "POST", path: "/api/runs/r/steer" } }).action.kind).toBe("hold");
    expect(attentionOf({ kind: "side_channel", run: "r", action: { method: "GET", path: "/api/runs/r" } }).action).toMatchObject({ kind: "open", href: undefined });
    // An L5 kind keeps its own reading: a GET is a re-check.
    expect(attentionOf({ kind: "health", action: { method: "GET", path: "/api/ports/store/health" } }).action.kind).toBe("check");
    expect(attentionOf({ kind: "drift", agents: "not a list", runs: [1, "r-2"], data: [1] })).toMatchObject({ agents: [], runs: ["1", "r-2"], data: null });
  });

  it("a guardian note with no action names itself by its title", () => {
    expect(operatorOf({ kind: "note", title: "Guardian: watching", data: { control: "guardian" } })).toEqual({ action: "Guardian: watching", by: "guardian", at: "", detail: "" });
    // The steer's own hold, signed by the guardian, reads as the operator lever it is.
    expect(operatorOf({ kind: "note", data: { control: "operator.hold", by: "guardian" } })).toMatchObject({ action: "Held for a person", by: "guardian" });
  });
});
