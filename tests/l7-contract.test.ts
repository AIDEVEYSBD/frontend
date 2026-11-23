import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { api, type Schemas } from "@/lib/api/client";
import * as l5 from "@/lib/api/l5";
import * as l7 from "@/lib/api/l7";
import { ATTENTION_LABEL, attentionVerb, driftFirstSeen, sideChannelOf } from "@/lib/gates";
import { alreadySummary, byAgentRows, figuresLine, inFlightNodes, killSummary, nodeHref, reachedGroups, reachedStateText, refusalLine, refusalSplit, treeRows, treeSummary } from "@/lib/run-tree";
import { rateLimitText } from "@/lib/rate-limit";
import { adjacency, blastCountsLine, blastIds, blastRefusalText, edgeLook, groupByLayer, healthOf, pathText } from "@/lib/dependencies";
import { driftVerdict, orderDrift, sideText, statText, thresholdText } from "@/lib/drift";
import { KillAlreadyView, KillReceiptView, RunTreeBody } from "@/components/run-tree";
import { BlastView } from "@/components/dependencies";
import { AgentCard } from "@/components/drift";
import { AttentionLinks } from "@/components/attention";

/**
 * The L7 contract (first round), held from the console's side.
 *
 * Every response below was captured from the backend's own app, driven
 * in-process through its doors (the scratchpad script that builds each state
 * reuses backend/tests/l7.py and the test_l7_*.py fixtures without editing
 * them): an orchestrator fanning out to two in-process sub-runs that a
 * delegation refusal stops inside, a worker's child with a peer call and a
 * refusal of its own, an SDK grandchild still running, a peer's report
 * sharing the trace; a kill of an orchestrator held inside its sub-run's
 * model call, with a worker child, a queued child, SDK children and an SDK
 * grandchild, then the kill again once the orchestrator had ended
 * (`delivery: tree`), then once nothing was in flight (409); 429s from the
 * runs door (agent and tree scope) and the trigger door; the dependency map
 * of three agents sharing a pending MCP server, one invoking another, a peer,
 * a chatbot on the gateway, an agent sharing the server's name and a model
 * whose id carries a slash; drift for a shifted agent, a steady one and one
 * with too few runs; the guardian off, set, merged, holding a worker's run,
 * blocking an SDK run, and raising two verdicts it could not act on; and the
 * attention list carrying drift, guardian and side-channel items beside an
 * L5 refusal. Re-captured after the backend's L7 polish, which added: the
 * runs-list figures on each record of the tree (`listed`) and the tree's
 * `how`; a second kill that answers 409 `KillRefused {error, already}` while
 * everything is still stopping, and 202 `delivery: tree` with `already` once
 * something new joined; a dead-lettered job's `state: failed`; side channels
 * that name records (the sub-run under `data`), one with a writer that was
 * itself a sub-run; a drift item that ages from its first sighting
 * (`data.first_seen`); the guardian's PUT refusing in plain words with
 * `field`, and `field` on every validation 400; `data.at` on the guardian's
 * notes; a refused root start naming no tree; and the blast radius of an id
 * with a slash. Inlined trimmed: run records keep their journals and the facts
 * the pages read. Each test calls the real client (lib/api/l7.ts, l5.ts,
 * the generated client for the runs door) with fetch stubbed, then the
 * helpers and components the pages render with, and checks that what the
 * page shows comes through. When a door changes, capture it again and
 * replace the fixture.
 */

interface Fixture {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

const FX: Record<string, Fixture> = {
  "tree_root": {"status": 200, "body": {"root": "triage-2026-10-21T11-41-14-x0yu", "asked": "triage-2026-10-21T11-41-14-x0yu", "trace_id": "t-dc497b2c8af741ba", "nodes": [{"run": "triage-2026-10-21T11-41-14-x0yu", "agent": "triage", "source": "console", "state": "done", "parent": null, "depth": 0, "cost": 0.0, "tokens": 0, "tool_calls": 2, "refusals": 0, "peer": null, "kind": "run", "link": "root", "started_at": "2026-10-21T11:41:14.284Z", "finished_at": "2026-10-21T11:41:14.292Z", "error": "", "estimated": false, "total": {"cost": 0.00385, "tokens": 1210, "tool_calls": 3, "refusals": 3}, "listed": {"cost": 0.00035, "tokens": 110, "tool_calls": 2, "refusals": 2}}, {"run": "casework-sub-8b6e472bae", "agent": "casework", "source": "console", "state": "failed", "parent": "triage-2026-10-21T11-41-14-x0yu", "depth": 1, "cost": 0.000175, "tokens": 55, "tool_calls": 0, "refusals": 1, "peer": null, "kind": "sub_run", "link": "journal", "started_at": null, "finished_at": null, "error": "delegation: records.write is granted by this agent's spec but not by 'triage', which delegated this work, and delegation only narrows (it holds: agent.invoke)", "estimated": false, "total": {"cost": 0.000175, "tokens": 55, "tool_calls": 0, "refusals": 1}, "listed": null}, {"run": "casework-sub-c842c6619f", "agent": "casework", "source": "console", "state": "failed", "parent": "triage-2026-10-21T11-41-14-x0yu", "depth": 1, "cost": 0.000175, "tokens": 55, "tool_calls": 0, "refusals": 1, "peer": null, "kind": "sub_run", "link": "journal", "started_at": null, "finished_at": null, "error": "delegation: records.write is granted by this agent's spec but not by 'triage', which delegated this work, and delegation only narrows (it holds: agent.invoke)", "estimated": false, "total": {"cost": 0.000175, "tokens": 55, "tool_calls": 0, "refusals": 1}, "listed": null}, {"run": "vetting-2026-10-21T11-41-14-67396e", "agent": "vetting", "source": "worker", "state": "done", "parent": "triage-2026-10-21T11-41-14-x0yu", "depth": 1, "cost": 0.0035, "tokens": 1100, "tool_calls": 1, "refusals": 1, "peer": null, "kind": "run", "link": "parent", "started_at": "2026-10-21T11:41:14.343Z", "finished_at": "2026-10-21T11:41:14.347Z", "error": "", "estimated": false, "total": {"cost": 0.0035, "tokens": 1100, "tool_calls": 1, "refusals": 1}, "listed": {"cost": 0.0035, "tokens": 1100, "tool_calls": 1, "refusals": 1}}, {"run": "peer:vendor-bot/t-77", "agent": "vendor-bot", "source": "peer", "state": "submitted", "parent": "vetting-2026-10-21T11-41-14-67396e", "depth": 2, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": {"name": "vendor-bot", "task_id": "t-77", "state": "submitted", "calls": 1, "refused": 0, "failed": 0, "tools": ["peer.send"], "replied": false}, "kind": "peer", "link": "journal", "started_at": null, "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}, "listed": null}, {"run": "vendor-desk-r1", "agent": "vendor-desk", "source": "sdk", "state": "running", "parent": "vetting-2026-10-21T11-41-14-67396e", "depth": 2, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "run", "link": "parent", "started_at": "2026-10-21T12:00:00Z", "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}, "listed": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}, {"run": "ext-report-1", "agent": "ext", "source": "a2a", "state": "done", "parent": "triage-2026-10-21T11-41-14-x0yu", "depth": 1, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "run", "link": "trace", "started_at": "2026-10-21T11:41:14.274Z", "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}, "listed": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}], "rollup": {"cost": 0.00385, "tokens": 1210, "tool_calls": 3, "refusals": 3, "by_agent": {"triage": {"cost": 0.0, "tokens": 0, "tool_calls": 2, "refusals": 0, "nodes": 1}, "casework": {"cost": 0.00035, "tokens": 110, "tool_calls": 0, "refusals": 2, "nodes": 2}, "vetting": {"cost": 0.0035, "tokens": 1100, "tool_calls": 1, "refusals": 1, "nodes": 1}, "peer:vendor-bot": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 1}, "vendor-desk": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 1}, "ext": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 1}}}, "count": 7, "truncated": false, "how": "cost, tokens, tool_calls, refusals: the node's own entries only, so nothing is counted twice; listed: what a record's row in the runs list shows (its whole journal, its in-process sub-runs folded in; null for a sub-run or a peer leaf); total: the node and everything under it. The root's total and the rollup are the runs list's rows summed over the records in the tree"}},
  "tree_from_grandchild": {"status": 200, "body": {"root": "triage-2026-10-21T11-41-14-x0yu", "asked": "vendor-desk-r1", "trace_id": "t-dc497b2c8af741ba", "nodes": [{"run": "triage-2026-10-21T11-41-14-x0yu", "agent": "triage", "source": "console", "state": "done", "parent": null, "depth": 0, "cost": 0.0, "tokens": 0, "tool_calls": 2, "refusals": 0, "peer": null, "kind": "run", "link": "root", "started_at": "2026-10-21T11:41:14.284Z", "finished_at": "2026-10-21T11:41:14.292Z", "error": "", "estimated": false, "total": {"cost": 0.00385, "tokens": 1210, "tool_calls": 3, "refusals": 3}, "listed": {"cost": 0.00035, "tokens": 110, "tool_calls": 2, "refusals": 2}}, {"run": "casework-sub-8b6e472bae", "agent": "casework", "source": "console", "state": "failed", "parent": "triage-2026-10-21T11-41-14-x0yu", "depth": 1, "cost": 0.000175, "tokens": 55, "tool_calls": 0, "refusals": 1, "peer": null, "kind": "sub_run", "link": "journal", "started_at": null, "finished_at": null, "error": "delegation: records.write is granted by this agent's spec but not by 'triage', which delegated this work, and delegation only narrows (it holds: agent.invoke)", "estimated": false, "total": {"cost": 0.000175, "tokens": 55, "tool_calls": 0, "refusals": 1}, "listed": null}, {"run": "casework-sub-c842c6619f", "agent": "casework", "source": "console", "state": "failed", "parent": "triage-2026-10-21T11-41-14-x0yu", "depth": 1, "cost": 0.000175, "tokens": 55, "tool_calls": 0, "refusals": 1, "peer": null, "kind": "sub_run", "link": "journal", "started_at": null, "finished_at": null, "error": "delegation: records.write is granted by this agent's spec but not by 'triage', which delegated this work, and delegation only narrows (it holds: agent.invoke)", "estimated": false, "total": {"cost": 0.000175, "tokens": 55, "tool_calls": 0, "refusals": 1}, "listed": null}, {"run": "vetting-2026-10-21T11-41-14-67396e", "agent": "vetting", "source": "worker", "state": "done", "parent": "triage-2026-10-21T11-41-14-x0yu", "depth": 1, "cost": 0.0035, "tokens": 1100, "tool_calls": 1, "refusals": 1, "peer": null, "kind": "run", "link": "parent", "started_at": "2026-10-21T11:41:14.343Z", "finished_at": "2026-10-21T11:41:14.347Z", "error": "", "estimated": false, "total": {"cost": 0.0035, "tokens": 1100, "tool_calls": 1, "refusals": 1}, "listed": {"cost": 0.0035, "tokens": 1100, "tool_calls": 1, "refusals": 1}}, {"run": "peer:vendor-bot/t-77", "agent": "vendor-bot", "source": "peer", "state": "submitted", "parent": "vetting-2026-10-21T11-41-14-67396e", "depth": 2, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": {"name": "vendor-bot", "task_id": "t-77", "state": "submitted", "calls": 1, "refused": 0, "failed": 0, "tools": ["peer.send"], "replied": false}, "kind": "peer", "link": "journal", "started_at": null, "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}, "listed": null}, {"run": "vendor-desk-r1", "agent": "vendor-desk", "source": "sdk", "state": "running", "parent": "vetting-2026-10-21T11-41-14-67396e", "depth": 2, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "run", "link": "parent", "started_at": "2026-10-21T12:00:00Z", "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}, "listed": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}, {"run": "ext-report-1", "agent": "ext", "source": "a2a", "state": "done", "parent": "triage-2026-10-21T11-41-14-x0yu", "depth": 1, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "run", "link": "trace", "started_at": "2026-10-21T11:41:14.274Z", "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}, "listed": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}], "rollup": {"cost": 0.00385, "tokens": 1210, "tool_calls": 3, "refusals": 3, "by_agent": {"triage": {"cost": 0.0, "tokens": 0, "tool_calls": 2, "refusals": 0, "nodes": 1}, "casework": {"cost": 0.00035, "tokens": 110, "tool_calls": 0, "refusals": 2, "nodes": 2}, "vetting": {"cost": 0.0035, "tokens": 1100, "tool_calls": 1, "refusals": 1, "nodes": 1}, "peer:vendor-bot": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 1}, "vendor-desk": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 1}, "ext": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 1}}}, "count": 7, "truncated": false, "how": "cost, tokens, tool_calls, refusals: the node's own entries only, so nothing is counted twice; listed: what a record's row in the runs list shows (its whole journal, its in-process sub-runs folded in; null for a sub-run or a peer leaf); total: the node and everything under it. The root's total and the rollup are the runs list's rows summed over the records in the tree"}},
  "tree_scoped": {"status": 200, "body": {"root": "vetting-2026-10-21T11-41-14-67396e", "asked": "vetting-2026-10-21T11-41-14-67396e", "trace_id": "t-dc497b2c8af741ba", "nodes": [{"run": "vetting-2026-10-21T11-41-14-67396e", "agent": "vetting", "source": "worker", "state": "done", "parent": null, "depth": 0, "cost": 0.0035, "tokens": 1100, "tool_calls": 1, "refusals": 1, "peer": null, "kind": "run", "link": "root", "started_at": "2026-10-21T11:41:14.343Z", "finished_at": "2026-10-21T11:41:14.347Z", "error": "", "estimated": false, "total": {"cost": 0.0035, "tokens": 1100, "tool_calls": 1, "refusals": 1}, "listed": {"cost": 0.0035, "tokens": 1100, "tool_calls": 1, "refusals": 1}}, {"run": "peer:vendor-bot/t-77", "agent": "vendor-bot", "source": "peer", "state": "submitted", "parent": "vetting-2026-10-21T11-41-14-67396e", "depth": 1, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": {"name": "vendor-bot", "task_id": "t-77", "state": "submitted", "calls": 1, "refused": 0, "failed": 0, "tools": ["peer.send"], "replied": false}, "kind": "peer", "link": "journal", "started_at": null, "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}, "listed": null}, {"run": "vendor-desk-r1", "agent": "vendor-desk", "source": "sdk", "state": "running", "parent": "vetting-2026-10-21T11-41-14-67396e", "depth": 1, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "run", "link": "parent", "started_at": "2026-10-21T12:00:00Z", "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}, "listed": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}], "rollup": {"cost": 0.0035, "tokens": 1100, "tool_calls": 1, "refusals": 1, "by_agent": {"vetting": {"cost": 0.0035, "tokens": 1100, "tool_calls": 1, "refusals": 1, "nodes": 1}, "peer:vendor-bot": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 1}, "vendor-desk": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 1}}}, "count": 3, "truncated": false, "how": "cost, tokens, tool_calls, refusals: the node's own entries only, so nothing is counted twice; listed: what a record's row in the runs list shows (its whole journal, its in-process sub-runs folded in; null for a sub-run or a peer leaf); total: the node and everything under it. The root's total and the rollup are the runs list's rows summed over the records in the tree"}},
  "tree_scoped_403": {"status": 403, "body": {"error": "this key is scoped to \"vetting\""}},
  "tree_404": {"status": 404, "body": {"error": "no run \"no-such-run\""}},
  "tree_in_flight": {"status": 200, "body": {"root": "triage-2026-10-21T11-41-14-9vz3", "asked": "triage-2026-10-21T11-41-14-9vz3", "trace_id": "t-d17c5a96f89a4c7c", "nodes": [{"run": "triage-2026-10-21T11-41-14-9vz3", "agent": "triage", "source": "console", "state": "running", "parent": null, "depth": 0, "cost": 0.00035, "tokens": 110, "tool_calls": 1, "refusals": 0, "peer": null, "kind": "run", "link": "root", "started_at": "2026-10-21T11:41:14.399Z", "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.00035, "tokens": 110, "tool_calls": 1, "refusals": 0}, "listed": {"cost": 0.00035, "tokens": 110, "tool_calls": 1, "refusals": 0}}, {"run": "casework-sub-0652fb2dd3", "agent": "casework", "source": "console", "state": "running", "parent": "triage-2026-10-21T11-41-14-9vz3", "depth": 1, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "sub_run", "link": "journal", "started_at": null, "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}, "listed": null}, {"run": "vendor-desk-k1", "agent": "vendor-desk", "source": "sdk", "state": "running", "parent": "triage-2026-10-21T11-41-14-9vz3", "depth": 1, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "run", "link": "parent", "started_at": "2026-10-21T12:00:00Z", "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}, "listed": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}, {"run": "vetting-2026-10-21T11-41-14-b6fec2", "agent": "vetting", "source": "worker", "state": "running", "parent": "triage-2026-10-21T11-41-14-9vz3", "depth": 1, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "run", "link": "parent", "started_at": "2026-10-21T11:41:14.408Z", "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}, "listed": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}, {"run": "vendor-desk-k2", "agent": "vendor-desk", "source": "sdk", "state": "running", "parent": "vetting-2026-10-21T11-41-14-b6fec2", "depth": 2, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "run", "link": "parent", "started_at": "2026-10-21T12:00:00Z", "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}, "listed": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}], "rollup": {"cost": 0.00035, "tokens": 110, "tool_calls": 1, "refusals": 0, "by_agent": {"triage": {"cost": 0.00035, "tokens": 110, "tool_calls": 1, "refusals": 0, "nodes": 1}, "casework": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 1}, "vendor-desk": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 2}, "vetting": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 1}}}, "count": 5, "truncated": false, "how": "cost, tokens, tool_calls, refusals: the node's own entries only, so nothing is counted twice; listed: what a record's row in the runs list shows (its whole journal, its in-process sub-runs folded in; null for a sub-run or a peer leaf); total: the node and everything under it. The root's total and the rollup are the runs list's rows summed over the records in the tree"}},
  "tree_after_kill": {"status": 200, "body": {"root": "triage-2026-10-21T11-41-14-9vz3", "asked": "triage-2026-10-21T11-41-14-9vz3", "trace_id": "t-d17c5a96f89a4c7c", "nodes": [{"run": "triage-2026-10-21T11-41-14-9vz3", "agent": "triage", "source": "console", "state": "killed", "parent": null, "depth": 0, "cost": 0.00035, "tokens": 110, "tool_calls": 1, "refusals": 0, "peer": null, "kind": "run", "link": "root", "started_at": "2026-10-21T11:41:14.399Z", "finished_at": "2026-10-21T11:41:14.450Z", "error": "killed by operator: runaway tree", "estimated": false, "total": {"cost": 0.000525, "tokens": 165, "tool_calls": 1, "refusals": 0}, "listed": {"cost": 0.0005250000000000001, "tokens": 165, "tool_calls": 1, "refusals": 0}}, {"run": "casework-sub-0652fb2dd3", "agent": "casework", "source": "console", "state": "killed", "parent": "triage-2026-10-21T11-41-14-9vz3", "depth": 1, "cost": 0.000175, "tokens": 55, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "sub_run", "link": "journal", "started_at": null, "finished_at": null, "error": "runaway tree; whatever was in flight was abandoned and nothing after it ran (by Asha Rao)", "estimated": false, "total": {"cost": 0.000175, "tokens": 55, "tool_calls": 0, "refusals": 0}, "listed": null}, {"run": "vendor-desk-k1", "agent": "vendor-desk", "source": "sdk", "state": "running", "parent": "triage-2026-10-21T11-41-14-9vz3", "depth": 1, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "run", "link": "parent", "started_at": "2026-10-21T12:00:00Z", "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}, "listed": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}, {"run": "vetting-2026-10-21T11-41-14-b6fec2", "agent": "vetting", "source": "worker", "state": "running", "parent": "triage-2026-10-21T11-41-14-9vz3", "depth": 1, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "run", "link": "parent", "started_at": "2026-10-21T11:41:14.408Z", "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}, "listed": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}, {"run": "vendor-desk-k2", "agent": "vendor-desk", "source": "sdk", "state": "running", "parent": "vetting-2026-10-21T11-41-14-b6fec2", "depth": 2, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "run", "link": "parent", "started_at": "2026-10-21T12:00:00Z", "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}, "listed": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}], "rollup": {"cost": 0.000525, "tokens": 165, "tool_calls": 1, "refusals": 0, "by_agent": {"triage": {"cost": 0.00035, "tokens": 110, "tool_calls": 1, "refusals": 0, "nodes": 1}, "casework": {"cost": 0.000175, "tokens": 55, "tool_calls": 0, "refusals": 0, "nodes": 1}, "vendor-desk": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 2}, "vetting": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 1}}}, "count": 5, "truncated": false, "how": "cost, tokens, tool_calls, refusals: the node's own entries only, so nothing is counted twice; listed: what a record's row in the runs list shows (its whole journal, its in-process sub-runs folded in; null for a sub-run or a peer leaf); total: the node and everything under it. The root's total and the rollup are the runs list's rows summed over the records in the tree"}},
  "tree_rate_limited_fanout": {"status": 200, "body": {"root": "sweep-2026-10-21T11-41-14-3p2j", "asked": "sweep-2026-10-21T11-41-14-3p2j", "trace_id": "t-8976ed04ca374439", "nodes": [{"run": "sweep-2026-10-21T11-41-14-3p2j", "agent": "sweep", "source": "console", "state": "done", "parent": null, "depth": 0, "cost": 0.0, "tokens": 0, "tool_calls": 4, "refusals": 2, "peer": null, "kind": "run", "link": "root", "started_at": "2026-10-21T11:41:14.560Z", "finished_at": "2026-10-21T11:41:14.563Z", "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 4, "refusals": 2}, "listed": {"cost": 0.0, "tokens": 0, "tool_calls": 4, "refusals": 2}}, {"run": "casework-sub-e10733bb26", "agent": "casework", "source": "console", "state": "done", "parent": "sweep-2026-10-21T11-41-14-3p2j", "depth": 1, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "sub_run", "link": "journal", "started_at": null, "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}, "listed": null}, {"run": "casework-sub-c0d5b8a6ec", "agent": "casework", "source": "console", "state": "done", "parent": "sweep-2026-10-21T11-41-14-3p2j", "depth": 1, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "sub_run", "link": "journal", "started_at": null, "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}, "listed": null}], "rollup": {"cost": 0.0, "tokens": 0, "tool_calls": 4, "refusals": 2, "by_agent": {"sweep": {"cost": 0.0, "tokens": 0, "tool_calls": 4, "refusals": 2, "nodes": 1}, "casework": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 2}}}, "count": 3, "truncated": false, "how": "cost, tokens, tool_calls, refusals: the node's own entries only, so nothing is counted twice; listed: what a record's row in the runs list shows (its whole journal, its in-process sub-runs folded in; null for a sub-run or a peer leaf); total: the node and everything under it. The root's total and the rollup are the runs list's rows summed over the records in the tree"}},
  "trigger_child_202": {"status": 202, "body": {"job": "67396e57-bfce-4379-a754-2bca929f9b04", "agent": "vetting", "status": "queued", "external_id": null, "source": "local", "attempts": 0, "max_attempts": 3, "run_id": null, "trace_id": "t-dc497b2c8af741ba", "result": null, "error": null, "dead": false, "claimed_by": null, "lease_until": null, "created_at": "2026-10-21T11:41:14.338Z", "started_at": null, "finished_at": null, "status_url": "/api/trigger/vetting/jobs/67396e57-bfce-4379-a754-2bca929f9b04", "run_url": null, "parent_run": "triage-2026-10-21T11-41-14-x0yu", "duplicate": false, "retried": false, "note": null, "lockdown": null}},
  "kill_tree_202": {"status": 202, "body": {"run": "triage-2026-10-21T11-41-14-9vz3", "state": "running", "kill": {"reason": "runaway tree", "by": "Asha Rao", "at": "2026-10-21T11:41:14.441Z"}, "delivery": "in-process", "reached": [{"run": "triage-2026-10-21T11-41-14-9vz3", "agent": "triage", "source": "console", "kind": "run", "delivery": "in-process", "parent": null, "depth": 0, "state": "running", "peer": null, "task_id": null, "error": null, "kill": null}, {"run": "casework-sub-0652fb2dd3", "agent": "casework", "source": "console", "kind": "sub_run", "delivery": "shared-cancel", "parent": "triage-2026-10-21T11-41-14-9vz3", "depth": 1, "state": "running", "peer": null, "task_id": null, "error": null, "kill": null}, {"run": "5ece12c5-3a85-40e3-becf-5a6b04905fc8", "agent": "vetting", "source": "local", "kind": "job", "delivery": "queue", "parent": "triage-2026-10-21T11-41-14-9vz3", "depth": 1, "state": "failed", "peer": null, "task_id": null, "error": null, "kill": null}, {"run": "vendor-desk-k1", "agent": "vendor-desk", "source": "sdk", "kind": "run", "delivery": "sdk", "parent": "triage-2026-10-21T11-41-14-9vz3", "depth": 1, "state": "running", "peer": null, "task_id": null, "error": null, "kill": null}, {"run": "vetting-2026-10-21T11-41-14-b6fec2", "agent": "vetting", "source": "worker", "kind": "run", "delivery": "worker", "parent": "triage-2026-10-21T11-41-14-9vz3", "depth": 1, "state": "running", "peer": null, "task_id": null, "error": null, "kill": null}, {"run": "vendor-desk-k2", "agent": "vendor-desk", "source": "sdk", "kind": "run", "delivery": "sdk", "parent": "vetting-2026-10-21T11-41-14-b6fec2", "depth": 2, "state": "running", "peer": null, "task_id": null, "error": null, "kill": null}], "already": []}},
  "kill_again_already_409": {"status": 409, "body": {"error": "run \"triage-2026-10-21T11-41-14-9vz3\" was already killed by Asha Rao (runaway tree) and stops at its next checkpoint; 3 more runs in its tree are stopping on an earlier kill too", "already": [{"run": "triage-2026-10-21T11-41-14-9vz3", "agent": "triage", "source": "console", "kind": "run", "delivery": "in-process", "parent": null, "depth": 0, "state": "running", "peer": null, "task_id": null, "error": null, "kill": {"reason": "runaway tree", "by": "Asha Rao", "at": "2026-10-21T11:41:14.441Z"}}, {"run": "casework-sub-0652fb2dd3", "agent": "casework", "source": "console", "kind": "sub_run", "delivery": "shared-cancel", "parent": "triage-2026-10-21T11-41-14-9vz3", "depth": 1, "state": "running", "peer": null, "task_id": null, "error": null, "kill": {"reason": "runaway tree", "by": "Asha Rao", "at": "2026-10-21T11:41:14.441Z"}}, {"run": "vendor-desk-k1", "agent": "vendor-desk", "source": "sdk", "kind": "run", "delivery": "sdk", "parent": "triage-2026-10-21T11-41-14-9vz3", "depth": 1, "state": "running", "peer": null, "task_id": null, "error": null, "kill": {"reason": "runaway tree", "by": "Asha Rao", "at": "2026-10-21T11:41:14.442Z"}}, {"run": "vetting-2026-10-21T11-41-14-b6fec2", "agent": "vetting", "source": "worker", "kind": "run", "delivery": "worker", "parent": "triage-2026-10-21T11-41-14-9vz3", "depth": 1, "state": "running", "peer": null, "task_id": null, "error": null, "kill": {"reason": "runaway tree", "by": "Asha Rao", "at": "2026-10-21T11:41:14.443Z"}}, {"run": "vendor-desk-k2", "agent": "vendor-desk", "source": "sdk", "kind": "run", "delivery": "sdk", "parent": "vetting-2026-10-21T11-41-14-b6fec2", "depth": 2, "state": "running", "peer": null, "task_id": null, "error": null, "kill": {"reason": "runaway tree", "by": "Asha Rao", "at": "2026-10-21T11:41:14.444Z"}}]}},
  "kill_tree_delivery_tree": {"status": 202, "body": {"run": "triage-2026-10-21T11-41-14-9vz3", "state": "killed", "kill": {"reason": "the late one", "by": "Asha Rao", "at": "2026-10-21T11:41:14.493Z"}, "delivery": "tree", "reached": [{"run": "vendor-desk-k3", "agent": "vendor-desk", "source": "sdk", "kind": "run", "delivery": "sdk", "parent": "triage-2026-10-21T11-41-14-9vz3", "depth": 1, "state": "running", "peer": null, "task_id": null, "error": null, "kill": null}], "already": [{"run": "vendor-desk-k1", "agent": "vendor-desk", "source": "sdk", "kind": "run", "delivery": "sdk", "parent": "triage-2026-10-21T11-41-14-9vz3", "depth": 1, "state": "running", "peer": null, "task_id": null, "error": null, "kill": {"reason": "runaway tree", "by": "Asha Rao", "at": "2026-10-21T11:41:14.442Z"}}, {"run": "vetting-2026-10-21T11-41-14-b6fec2", "agent": "vetting", "source": "worker", "kind": "run", "delivery": "worker", "parent": "triage-2026-10-21T11-41-14-9vz3", "depth": 1, "state": "running", "peer": null, "task_id": null, "error": null, "kill": {"reason": "runaway tree", "by": "Asha Rao", "at": "2026-10-21T11:41:14.443Z"}}, {"run": "vendor-desk-k2", "agent": "vendor-desk", "source": "sdk", "kind": "run", "delivery": "sdk", "parent": "vetting-2026-10-21T11-41-14-b6fec2", "depth": 2, "state": "running", "peer": null, "task_id": null, "error": null, "kill": {"reason": "runaway tree", "by": "Asha Rao", "at": "2026-10-21T11:41:14.444Z"}}]}},
  "kill_409": {"status": 409, "body": {"error": "run \"triage-2026-10-21T11-41-14-9vz3\" is killed, not in flight", "already": []}},
  "kill_worker_202": {"status": 202, "body": {"run": "vetting-2026-10-21T11-41-14-30c772", "state": "running", "kill": {"reason": "stop both", "by": "Asha Rao", "at": "2026-10-21T11:41:14.522Z"}, "delivery": "worker", "reached": [{"run": "vetting-2026-10-21T11-41-14-30c772", "agent": "vetting", "source": "worker", "kind": "run", "delivery": "worker", "parent": null, "depth": 0, "state": "running", "peer": null, "task_id": null, "error": null, "kill": null}, {"run": "vetting-2026-10-21T11-41-14-6f9c1a", "agent": "vetting", "source": "worker", "kind": "run", "delivery": "worker", "parent": "vetting-2026-10-21T11-41-14-30c772", "depth": 1, "state": "running", "peer": null, "task_id": null, "error": null, "kill": null}], "already": []}},
  "runs_429_agent": {"status": 429, "body": {"error": "rate limit: 2 runs started for tiny in the last minute, 2 allowed (run_starts_per_minute); retry in 60s", "control": "rate_limit", "scope": "agent", "limit": "run_starts_per_minute", "used": 2, "allowed": 2, "retry_after_s": 60, "agent": "tiny", "tree": "", "kind": "start"}, "headers": {"retry-after": "60"}},
  "runs_429_tree": {"status": 429, "body": {"error": "rate limit: tree t-07a7adcf663e4340 started or queued 2 runs in the last minute, 2 allowed (tree_per_minute); retry in 60s", "control": "rate_limit", "scope": "tree", "limit": "tree_per_minute", "used": 2, "allowed": 2, "retry_after_s": 60, "agent": "tiny", "tree": "t-07a7adcf663e4340", "kind": "start"}, "headers": {"retry-after": "60"}},
  "trigger_429_agent": {"status": 429, "body": {"error": "rate limit: 1 jobs enqueued for tiny in the last minute, 1 allowed (enqueues_per_minute); retry in 60s", "control": "rate_limit", "scope": "agent", "limit": "enqueues_per_minute", "used": 1, "allowed": 1, "retry_after_s": 60, "agent": "tiny", "tree": "", "kind": "enqueue"}, "headers": {"retry-after": "60"}},
  "deps_7d": {"status": 200, "body": {"window": "7d", "since": "2026-10-14T11:41:14.663Z", "until": "2026-10-21T11:41:14.663Z", "nodes": [{"id": "agent:alpha", "kind": "agent", "label": "Tiny", "health": "ok", "declared": true, "observed": true, "count": 1, "failures": 0, "detail": ""}, {"id": "agent:beta", "kind": "agent", "label": "Tiny", "health": "ok", "declared": true, "observed": true, "count": 1, "failures": 0, "detail": ""}, {"id": "agent:casedesk", "kind": "agent", "label": "Tiny", "health": "idle", "declared": true, "observed": false, "count": 0, "failures": 0, "detail": ""}, {"id": "agent:delta", "kind": "agent", "label": "Tiny", "health": "ok", "declared": true, "observed": true, "count": 1, "failures": 0, "detail": ""}, {"id": "agent:gamma", "kind": "agent", "label": "Tiny", "health": "ok", "declared": true, "observed": true, "count": 1, "failures": 0, "detail": ""}, {"id": "agent:slashy", "kind": "agent", "label": "Tiny", "health": "idle", "declared": true, "observed": false, "count": 0, "failures": 0, "detail": ""}, {"id": "application:policy-chat", "kind": "application", "label": "Policy Chat", "health": "ok", "declared": true, "observed": true, "count": 1, "failures": 0, "detail": "chatbot"}, {"id": "connector:notify", "kind": "connector", "label": "notify", "health": "idle", "declared": true, "observed": false, "count": 0, "failures": 0, "detail": ""}, {"id": "connector:records", "kind": "connector", "label": "records", "health": "ok", "declared": true, "observed": true, "count": 1, "failures": 0, "detail": ""}, {"id": "model:gpt-4o", "kind": "model", "label": "gpt-4o", "health": "ok", "declared": true, "observed": true, "count": 2, "failures": 0, "detail": ""}, {"id": "model:gpt-4o-mini", "kind": "model", "label": "gpt-4o-mini", "health": "ok", "declared": true, "observed": true, "count": 1, "failures": 0, "detail": ""}, {"id": "model:meta/llama-3-70b", "kind": "model", "label": "meta/llama-3-70b", "health": "idle", "declared": true, "observed": false, "count": 0, "failures": 0, "detail": ""}, {"id": "peer:vendor-bot", "kind": "peer", "label": "vendor-bot", "health": "ok", "declared": true, "observed": true, "count": 1, "failures": 0, "detail": ""}, {"id": "server:casedesk", "kind": "server", "label": "Case desk", "health": "pending", "declared": true, "observed": true, "count": 3, "failures": 1, "detail": "MCP pin pending"}, {"id": "tool:casedesk.lookup", "kind": "tool", "label": "casedesk.lookup", "health": "degraded", "declared": true, "observed": true, "count": 3, "failures": 1, "detail": ""}, {"id": "tool:notify.send", "kind": "tool", "label": "notify.send", "health": "idle", "declared": true, "observed": false, "count": 0, "failures": 0, "detail": ""}, {"id": "tool:records.query", "kind": "tool", "label": "records.query", "health": "ok", "declared": true, "observed": true, "count": 1, "failures": 0, "detail": ""}], "edges": [{"from": "agent:alpha", "to": "tool:casedesk.lookup", "kind": "calls", "count": 1, "cost": 0.0, "failures": 0, "refusals": 0, "last_at": "2026-10-21T10:41:14.630Z", "declared": true, "observed": true, "evidence": "both"}, {"from": "agent:beta", "to": "tool:casedesk.lookup", "kind": "calls", "count": 1, "cost": 0.0, "failures": 1, "refusals": 0, "last_at": "2026-10-21T10:41:14.629Z", "declared": true, "observed": true, "evidence": "both"}, {"from": "agent:beta", "to": "tool:records.query", "kind": "calls", "count": 1, "cost": 0.0, "failures": 0, "refusals": 0, "last_at": "2026-10-21T10:41:14.634Z", "declared": true, "observed": true, "evidence": "both"}, {"from": "agent:casedesk", "to": "tool:casedesk.lookup", "kind": "calls", "count": 0, "cost": 0.0, "failures": 0, "refusals": 0, "last_at": null, "declared": true, "observed": false, "evidence": "declared"}, {"from": "agent:gamma", "to": "tool:casedesk.lookup", "kind": "calls", "count": 1, "cost": 0.0, "failures": 0, "refusals": 0, "last_at": "2026-10-21T11:36:14.629Z", "declared": true, "observed": true, "evidence": "both"}, {"from": "agent:gamma", "to": "tool:notify.send", "kind": "calls", "count": 0, "cost": 0.0, "failures": 0, "refusals": 0, "last_at": null, "declared": true, "observed": false, "evidence": "declared"}, {"from": "agent:delta", "to": "peer:vendor-bot", "kind": "peer", "count": 1, "cost": 0.0, "failures": 0, "refusals": 0, "last_at": "2026-10-21T11:11:14.275Z", "declared": true, "observed": true, "evidence": "both"}, {"from": "connector:notify", "to": "tool:notify.send", "kind": "serves", "count": 0, "cost": 0.0, "failures": 0, "refusals": 0, "last_at": null, "declared": true, "observed": false, "evidence": "declared"}, {"from": "connector:records", "to": "tool:records.query", "kind": "serves", "count": 1, "cost": 0.0, "failures": 0, "refusals": 0, "last_at": "2026-10-21T10:41:14.634Z", "declared": true, "observed": true, "evidence": "both"}, {"from": "server:casedesk", "to": "tool:casedesk.lookup", "kind": "serves", "count": 3, "cost": 0.0, "failures": 1, "refusals": 0, "last_at": "2026-10-21T11:36:14.629Z", "declared": true, "observed": true, "evidence": "both"}, {"from": "agent:alpha", "to": "agent:beta", "kind": "sub_run", "count": 1, "cost": 8.4e-06, "failures": 0, "refusals": 0, "last_at": "2026-10-21T10:41:14.628Z", "declared": true, "observed": true, "evidence": "both"}, {"from": "agent:alpha", "to": "model:gpt-4o", "kind": "uses_model", "count": 1, "cost": 0.00035, "failures": 0, "refusals": 0, "last_at": "2026-10-21T10:41:14.629Z", "declared": true, "observed": true, "evidence": "both"}, {"from": "agent:beta", "to": "model:gpt-4o-mini", "kind": "uses_model", "count": 1, "cost": 8.4e-06, "failures": 0, "refusals": 0, "last_at": "2026-10-21T10:41:14.636Z", "declared": true, "observed": true, "evidence": "both"}, {"from": "agent:casedesk", "to": "model:gpt-4o", "kind": "uses_model", "count": 0, "cost": 0.0, "failures": 0, "refusals": 0, "last_at": null, "declared": true, "observed": false, "evidence": "declared"}, {"from": "agent:delta", "to": "model:gpt-4o", "kind": "uses_model", "count": 0, "cost": 0.0, "failures": 0, "refusals": 0, "last_at": null, "declared": true, "observed": false, "evidence": "declared"}, {"from": "agent:gamma", "to": "model:gpt-4o", "kind": "uses_model", "count": 0, "cost": 0.0, "failures": 0, "refusals": 0, "last_at": null, "declared": true, "observed": false, "evidence": "declared"}, {"from": "agent:slashy", "to": "model:meta/llama-3-70b", "kind": "uses_model", "count": 0, "cost": 0.0, "failures": 0, "refusals": 0, "last_at": null, "declared": true, "observed": false, "evidence": "declared"}, {"from": "application:policy-chat", "to": "model:gpt-4o", "kind": "uses_model", "count": 1, "cost": 0.0001, "failures": 0, "refusals": 0, "last_at": "2026-10-21T10:41:14.628Z", "declared": true, "observed": true, "evidence": "both"}], "counts": {"nodes": 17, "edges": 18, "seen": 11, "declared_only": 7}, "how": "edges point from what depends to what it depends on (serves: from a server to the tool it serves); declared comes from the specs, seen from the journals in the window"}},
  "deps_400": {"status": 400, "body": {"error": "window is a number and a unit: 30m, 24h, 7d", "field": "window"}},
  "deps_scoped": {"status": 200, "body": {"window": "7d", "since": "2026-10-14T11:41:14.704Z", "until": "2026-10-21T11:41:14.704Z", "nodes": [{"id": "agent:alpha", "kind": "agent", "label": "Tiny", "health": "ok", "declared": true, "observed": true, "count": 1, "failures": 0, "detail": ""}, {"id": "agent:beta", "kind": "agent", "label": "Tiny", "health": "ok", "declared": true, "observed": true, "count": 1, "failures": 0, "detail": ""}, {"id": "model:gpt-4o", "kind": "model", "label": "gpt-4o", "health": "ok", "declared": true, "observed": true, "count": 2, "failures": 0, "detail": ""}, {"id": "tool:casedesk.lookup", "kind": "tool", "label": "casedesk.lookup", "health": "degraded", "declared": true, "observed": true, "count": 3, "failures": 1, "detail": ""}], "edges": [{"from": "agent:alpha", "to": "tool:casedesk.lookup", "kind": "calls", "count": 1, "cost": 0.0, "failures": 0, "refusals": 0, "last_at": "2026-10-21T10:41:14.630Z", "declared": true, "observed": true, "evidence": "both"}, {"from": "agent:alpha", "to": "agent:beta", "kind": "sub_run", "count": 1, "cost": 8.4e-06, "failures": 0, "refusals": 0, "last_at": "2026-10-21T10:41:14.628Z", "declared": true, "observed": true, "evidence": "both"}, {"from": "agent:alpha", "to": "model:gpt-4o", "kind": "uses_model", "count": 1, "cost": 0.00035, "failures": 0, "refusals": 0, "last_at": "2026-10-21T10:41:14.629Z", "declared": true, "observed": true, "evidence": "both"}], "counts": {"nodes": 4, "edges": 3, "seen": 3, "declared_only": 0}, "how": "edges point from what depends to what it depends on (serves: from a server to the tool it serves); declared comes from the specs, seen from the journals in the window"}},
  "blast_server": {"status": 200, "body": {"node": {"id": "server:casedesk", "kind": "server", "label": "Case desk", "health": "pending", "declared": true, "observed": true, "count": 3, "failures": 1, "detail": "MCP pin pending"}, "window": "7d", "agents": [{"id": "agent:alpha", "agent": "alpha", "how": "direct", "via": ["server:casedesk", "tool:casedesk.lookup", "agent:alpha"]}, {"id": "agent:beta", "agent": "beta", "how": "direct", "via": ["server:casedesk", "tool:casedesk.lookup", "agent:beta"]}, {"id": "agent:casedesk", "agent": "casedesk", "how": "direct", "via": ["server:casedesk", "tool:casedesk.lookup", "agent:casedesk"]}, {"id": "agent:gamma", "agent": "gamma", "how": "direct", "via": ["server:casedesk", "tool:casedesk.lookup", "agent:gamma"]}], "runs_in_flight": [{"run": "gamma-r1", "agent": "gamma", "state": "running", "source": "console", "uses": "direct", "called": true}], "applications": [{"id": "alpha", "name": "Tiny", "class": "multi_agent", "source": "workflow", "via": "agent:alpha"}, {"id": "beta", "name": "Tiny", "class": "agent", "source": "workflow", "via": "agent:beta"}, {"id": "casedesk", "name": "Tiny", "class": "agent", "source": "workflow", "via": "agent:casedesk"}, {"id": "gamma", "name": "Tiny", "class": "agent", "source": "workflow", "via": "agent:gamma"}], "counts": {"direct": 4, "transitive": 0, "agents": 4, "runs_in_flight": 1, "applications": 4}, "how": "a tool fails with the server serving it; an agent fails with any tool, model, peer or sub-agent it depends on; an application fails with its models and with the agent it is. direct: reached without passing through another agent"}},
  "blast_tool_transitive": {"status": 200, "body": {"node": {"id": "tool:records.query", "kind": "tool", "label": "records.query", "health": "ok", "declared": true, "observed": true, "count": 1, "failures": 0, "detail": ""}, "window": "7d", "agents": [{"id": "agent:beta", "agent": "beta", "how": "direct", "via": ["tool:records.query", "agent:beta"]}, {"id": "agent:alpha", "agent": "alpha", "how": "transitive", "via": ["tool:records.query", "agent:beta", "agent:alpha"]}], "runs_in_flight": [], "applications": [{"id": "alpha", "name": "Tiny", "class": "multi_agent", "source": "workflow", "via": "agent:alpha"}, {"id": "beta", "name": "Tiny", "class": "agent", "source": "workflow", "via": "agent:beta"}], "counts": {"direct": 1, "transitive": 1, "agents": 2, "runs_in_flight": 0, "applications": 2}, "how": "a tool fails with the server serving it; an agent fails with any tool, model, peer or sub-agent it depends on; an application fails with its models and with the agent it is. direct: reached without passing through another agent"}},
  "blast_model_bare": {"status": 200, "body": {"node": {"id": "model:gpt-4o", "kind": "model", "label": "gpt-4o", "health": "ok", "declared": true, "observed": true, "count": 2, "failures": 0, "detail": ""}, "window": "7d", "agents": [{"id": "agent:alpha", "agent": "alpha", "how": "direct", "via": ["model:gpt-4o", "agent:alpha"]}, {"id": "agent:casedesk", "agent": "casedesk", "how": "direct", "via": ["model:gpt-4o", "agent:casedesk"]}, {"id": "agent:delta", "agent": "delta", "how": "direct", "via": ["model:gpt-4o", "agent:delta"]}, {"id": "agent:gamma", "agent": "gamma", "how": "direct", "via": ["model:gpt-4o", "agent:gamma"]}], "runs_in_flight": [{"run": "gamma-r1", "agent": "gamma", "state": "running", "source": "console", "uses": "direct", "called": false}], "applications": [{"id": "policy-chat", "name": "Policy Chat", "class": "chatbot", "source": "application", "via": "application:policy-chat"}, {"id": "alpha", "name": "Tiny", "class": "multi_agent", "source": "workflow", "via": "agent:alpha"}, {"id": "casedesk", "name": "Tiny", "class": "agent", "source": "workflow", "via": "agent:casedesk"}, {"id": "delta", "name": "Tiny", "class": "multi_agent", "source": "workflow", "via": "agent:delta"}, {"id": "gamma", "name": "Tiny", "class": "agent", "source": "workflow", "via": "agent:gamma"}], "counts": {"direct": 4, "transitive": 0, "agents": 4, "runs_in_flight": 1, "applications": 5}, "how": "a tool fails with the server serving it; an agent fails with any tool, model, peer or sub-agent it depends on; an application fails with its models and with the agent it is. direct: reached without passing through another agent"}},
  "blast_agent": {"status": 200, "body": {"node": {"id": "agent:beta", "kind": "agent", "label": "Tiny", "health": "ok", "declared": true, "observed": true, "count": 1, "failures": 0, "detail": ""}, "window": "7d", "agents": [{"id": "agent:alpha", "agent": "alpha", "how": "direct", "via": ["agent:beta", "agent:alpha"]}], "runs_in_flight": [], "applications": [{"id": "alpha", "name": "Tiny", "class": "multi_agent", "source": "workflow", "via": "agent:alpha"}, {"id": "beta", "name": "Tiny", "class": "agent", "source": "workflow", "via": "agent:beta"}], "counts": {"direct": 1, "transitive": 0, "agents": 1, "runs_in_flight": 0, "applications": 2}, "how": "a tool fails with the server serving it; an agent fails with any tool, model, peer or sub-agent it depends on; an application fails with its models and with the agent it is. direct: reached without passing through another agent"}},
  "blast_peer": {"status": 200, "body": {"node": {"id": "peer:vendor-bot", "kind": "peer", "label": "vendor-bot", "health": "ok", "declared": true, "observed": true, "count": 1, "failures": 0, "detail": ""}, "window": "7d", "agents": [{"id": "agent:delta", "agent": "delta", "how": "direct", "via": ["peer:vendor-bot", "agent:delta"]}], "runs_in_flight": [], "applications": [{"id": "delta", "name": "Tiny", "class": "multi_agent", "source": "workflow", "via": "agent:delta"}], "counts": {"direct": 1, "transitive": 0, "agents": 1, "runs_in_flight": 0, "applications": 1}, "how": "a tool fails with the server serving it; an agent fails with any tool, model, peer or sub-agent it depends on; an application fails with its models and with the agent it is. direct: reached without passing through another agent"}},
  "blast_404": {"status": 404, "body": {"error": "no node \"tool:nothing\" in the dependency map; ids are <kind>:<name>, e.g. tool:casedesk.lookup"}},
  "blast_409": {"status": 409, "body": {"error": "\"casedesk\" names 2 nodes: agent:casedesk, server:casedesk; ask by id", "candidates": ["agent:casedesk", "server:casedesk"]}},
  "blast_slash_encoded": {"status": 200, "body": {"node": {"id": "model:meta/llama-3-70b", "kind": "model", "label": "meta/llama-3-70b", "health": "idle", "declared": true, "observed": false, "count": 0, "failures": 0, "detail": ""}, "window": "7d", "agents": [{"id": "agent:slashy", "agent": "slashy", "how": "direct", "via": ["model:meta/llama-3-70b", "agent:slashy"]}], "runs_in_flight": [], "applications": [{"id": "slashy", "name": "Tiny", "class": "agent", "source": "workflow", "via": "agent:slashy"}], "counts": {"direct": 1, "transitive": 0, "agents": 1, "runs_in_flight": 0, "applications": 1}, "how": "a tool fails with the server serving it; an agent fails with any tool, model, peer or sub-agent it depends on; an application fails with its models and with the agent it is. direct: reached without passing through another agent"}},
  "blast_slash_raw": {"status": 200, "body": {"node": {"id": "model:meta/llama-3-70b", "kind": "model", "label": "meta/llama-3-70b", "health": "idle", "declared": true, "observed": false, "count": 0, "failures": 0, "detail": ""}, "window": "7d", "agents": [{"id": "agent:slashy", "agent": "slashy", "how": "direct", "via": ["model:meta/llama-3-70b", "agent:slashy"]}], "runs_in_flight": [], "applications": [{"id": "slashy", "name": "Tiny", "class": "agent", "source": "workflow", "via": "agent:slashy"}], "counts": {"direct": 1, "transitive": 0, "agents": 1, "runs_in_flight": 0, "applications": 1}, "how": "a tool fails with the server serving it; an agent fails with any tool, model, peer or sub-agent it depends on; an application fails with its models and with the agent it is. direct: reached without passing through another agent"}},
  "blast_slash_bare_encoded": {"status": 200, "body": {"node": {"id": "model:meta/llama-3-70b", "kind": "model", "label": "meta/llama-3-70b", "health": "idle", "declared": true, "observed": false, "count": 0, "failures": 0, "detail": ""}, "window": "7d", "agents": [{"id": "agent:slashy", "agent": "slashy", "how": "direct", "via": ["model:meta/llama-3-70b", "agent:slashy"]}], "runs_in_flight": [], "applications": [{"id": "slashy", "name": "Tiny", "class": "agent", "source": "workflow", "via": "agent:slashy"}], "counts": {"direct": 1, "transitive": 0, "agents": 1, "runs_in_flight": 0, "applications": 1}, "how": "a tool fails with the server serving it; an agent fails with any tool, model, peer or sub-agent it depends on; an application fails with its models and with the agent it is. direct: reached without passing through another agent"}},
  "blast_slash_404": {"status": 404, "body": {"error": "no node \"model:meta/nothing\" in the dependency map; ids are <kind>:<name>, e.g. tool:casedesk.lookup"}},
  "blast_scoped_403": {"status": 403, "body": {"error": "this key is scoped to \"alpha\"; the blast radius reaches every agent"}},
  "drift_all": {"status": 200, "body": {"agents": [{"agent": "intake", "recent": {"since": "2026-10-20T11:41:14.756Z", "until": "2026-10-21T11:41:14.756Z", "runs": 6}, "baseline": {"since": "2026-09-20T11:41:14.756Z", "until": "2026-10-20T11:41:14.756Z", "runs": 22}, "enough": true, "says": "no measure past its threshold", "drifted": false, "outcome_field": null, "measures": [{"name": "disposition_mix", "kind": "mix", "statistic": "jensen_shannon", "distance": 0.0, "z": null, "threshold": 0.2, "drifted": false, "enough": true, "says": "Jensen–Shannon distance 0.000 within 0.2", "recent": {"counts": {"state:done": 6}, "shares": {"state:done": 1.0}, "n": 6}, "baseline": {"counts": {"state:done": 22}, "shares": {"state:done": 1.0}, "n": 22}, "field": "state"}, {"name": "confidence", "kind": "mean", "statistic": "welch_z", "distance": null, "z": null, "threshold": 2.0, "drifted": false, "enough": false, "says": "no run's result carries a confidence", "recent": {}, "baseline": {}, "field": null}, {"name": "cost_per_run", "kind": "mean", "statistic": "welch_z", "distance": 0.0, "z": 0.0, "threshold": 2.0, "drifted": false, "enough": true, "says": "z +0.00 within ±2", "recent": {"mean": 0.00325, "sd": 0.0, "n": 6}, "baseline": {"mean": 0.00325, "sd": 0.0, "n": 22}, "field": null}, {"name": "tool_mix", "kind": "mix", "statistic": "jensen_shannon", "distance": 0.0, "z": null, "threshold": 0.2, "drifted": false, "enough": true, "says": "Jensen–Shannon distance 0.000 within 0.2", "recent": {"counts": {"records.query": 6}, "shares": {"records.query": 1.0}, "n": 6}, "baseline": {"counts": {"records.query": 22}, "shares": {"records.query": 1.0}, "n": 22}, "field": null}, {"name": "refusal_rate", "kind": "rate", "statistic": "proportion_z", "distance": 0.0, "z": 0.0, "threshold": 2.0, "drifted": false, "enough": true, "says": "z +0.00 within ±2", "recent": {"rate": 0.0, "runs_with": 0, "n": 6}, "baseline": {"rate": 0.0, "runs_with": 0, "n": 22}, "field": null}]}, {"agent": "scribe", "recent": {"since": "2026-10-20T11:41:14.756Z", "until": "2026-10-21T11:41:14.756Z", "runs": 3}, "baseline": {"since": "2026-09-20T11:41:14.756Z", "until": "2026-10-20T11:41:14.756Z", "runs": 4}, "enough": false, "says": "not enough runs: 3 in the last 24 h (need 5) and 4 in the 30 days before (need 20)", "drifted": false, "outcome_field": null, "measures": []}, {"agent": "triage", "recent": {"since": "2026-10-20T11:41:14.756Z", "until": "2026-10-21T11:41:14.756Z", "runs": 8}, "baseline": {"since": "2026-09-20T11:41:14.756Z", "until": "2026-10-20T11:41:14.756Z", "runs": 24}, "enough": true, "says": "shifted: tool_mix", "drifted": true, "outcome_field": "disposition", "measures": [{"name": "disposition_mix", "kind": "mix", "statistic": "jensen_shannon", "distance": 0.0, "z": null, "threshold": 0.2, "drifted": false, "enough": true, "says": "Jensen–Shannon distance 0.000 within 0.2", "recent": {"counts": {"benign": 6, "escalate": 2}, "shares": {"benign": 0.75, "escalate": 0.25}, "n": 8}, "baseline": {"counts": {"benign": 18, "escalate": 6}, "shares": {"benign": 0.75, "escalate": 0.25}, "n": 24}, "field": "disposition"}, {"name": "confidence", "kind": "mean", "statistic": "welch_z", "distance": 0.367, "z": -0.367, "threshold": 2.0, "drifted": false, "enough": true, "says": "z -0.37 within ±2", "recent": {"mean": 0.7975, "sd": 0.01669046, "n": 8}, "baseline": {"mean": 0.8, "sd": 0.01668115, "n": 24}, "field": null}, {"name": "cost_per_run", "kind": "mean", "statistic": "welch_z", "distance": 0.0, "z": 0.0, "threshold": 2.0, "drifted": false, "enough": true, "says": "z +0.00 within ±2", "recent": {"mean": 0.003625, "sd": 0.0, "n": 8}, "baseline": {"mean": 0.003625, "sd": 0.00010426, "n": 24}, "field": null}, {"name": "tool_mix", "kind": "mix", "statistic": "jensen_shannon", "distance": 1.0, "z": null, "threshold": 0.2, "drifted": true, "enough": true, "says": "Jensen–Shannon distance 1.000 past 0.2", "recent": {"counts": {"mail.send": 8, "web.fetch": 8}, "shares": {"mail.send": 0.5, "web.fetch": 0.5}, "n": 16}, "baseline": {"counts": {"records.query": 24}, "shares": {"records.query": 1.0}, "n": 24}, "field": null}, {"name": "refusal_rate", "kind": "rate", "statistic": "proportion_z", "distance": 0.0, "z": 0.0, "threshold": 2.0, "drifted": false, "enough": true, "says": "z +0.00 within ±2", "recent": {"rate": 0.0, "runs_with": 0, "n": 8}, "baseline": {"rate": 0.0, "runs_with": 0, "n": 24}, "field": null}]}], "count": 3, "now": "2026-10-21T11:41:14.756Z", "thresholds": {"mix_js": 0.2, "mean_z": 2.0}, "min_runs": {"recent": 5, "baseline": 20}, "windows": {"recent_h": 24.0, "baseline_d": 30.0}}},
  "drift_scribe": {"status": 200, "body": {"agents": [{"agent": "scribe", "recent": {"since": "2026-10-20T11:41:14.776Z", "until": "2026-10-21T11:41:14.776Z", "runs": 3}, "baseline": {"since": "2026-09-20T11:41:14.776Z", "until": "2026-10-20T11:41:14.776Z", "runs": 4}, "enough": false, "says": "not enough runs: 3 in the last 24 h (need 5) and 4 in the 30 days before (need 20)", "drifted": false, "outcome_field": null, "measures": []}], "count": 1, "now": "2026-10-21T11:41:14.776Z", "thresholds": {"mix_js": 0.2, "mean_z": 2.0}, "min_runs": {"recent": 5, "baseline": 20}, "windows": {"recent_h": 24.0, "baseline_d": 30.0}}},
  "drift_400": {"status": 400, "body": {"error": "agent must be an agent id", "field": "agent"}},
  "attention_l7": {"status": 200, "body": {"items": [{"id": "side_channel:clerk:scribe:2026-10-20", "kind": "side_channel", "severity": 6, "age_s": 78074.8, "rank": 11.42, "title": "clerk read what scribe wrote: two agents coordinating through a shared store", "detail": "1 read on 2026-10-20, 1 refused, a tainted value crossed; keys case/42; written in scribe-r1, read in boss-r1 (sub-run clerk-sub-0a1b2c3d4e)", "agent": "clerk", "run": "boss-r1", "job": "", "since": "2026-10-20T14:00:00Z", "deadline": null, "holds": "", "action": {"method": "GET", "path": "/api/runs/boss-r1", "body": null, "says": "review both runs; if the coordination is not by design, set policy.memory.cross_agent to refuse on the reader's spec"}, "agents": ["scribe", "clerk"], "runs": ["scribe-r1", "boss-r1"], "data": {"day": "2026-10-20", "writer": {"agent": "scribe", "run": "scribe-r1", "sub_run": null}, "reader": {"agent": "clerk", "run": "boss-r1", "sub_run": "clerk-sub-0a1b2c3d4e"}, "reads": 1, "refused": 1, "tainted": true, "keys": ["case/42"], "both_ways": false, "sub_runs": ["clerk-sub-0a1b2c3d4e"]}}, {"id": "side_channel:reader:scribe:2026-10-20", "kind": "side_channel", "severity": 5, "age_s": 84674.8, "rank": 9.9, "title": "reader read what scribe wrote: two agents coordinating through a shared store", "detail": "3 reads on 2026-10-20; keys case/42, case/43 (both ways); written in scribe-r1, read in reader-r1", "agent": "reader", "run": "reader-r1", "job": "", "since": "2026-10-20T12:10:00Z", "deadline": null, "holds": "", "action": {"method": "GET", "path": "/api/runs/reader-r1", "body": null, "says": "review both runs; if the coordination is not by design, set policy.memory.cross_agent to refuse on the reader's spec"}, "agents": ["scribe", "reader"], "runs": ["scribe-r1", "reader-r1", "scribe-r2"], "data": {"day": "2026-10-20", "writer": {"agent": "scribe", "run": "scribe-r1", "sub_run": null}, "reader": {"agent": "reader", "run": "reader-r1", "sub_run": null}, "reads": 3, "refused": 0, "tainted": false, "keys": ["case/42", "case/43"], "both_ways": true, "sub_runs": []}}, {"id": "side_channel:auditor:drafter:2026-10-20", "kind": "side_channel", "severity": 5, "age_s": 70874.8, "rank": 9.1, "title": "auditor read what drafter wrote: two agents coordinating through a shared store", "detail": "1 read on 2026-10-20; keys draft/7; written in chief-r1 (sub-run drafter-sub-9f8e7d6c5b), read in auditor-r1", "agent": "auditor", "run": "auditor-r1", "job": "", "since": "2026-10-20T16:00:00Z", "deadline": null, "holds": "", "action": {"method": "GET", "path": "/api/runs/auditor-r1", "body": null, "says": "review both runs; if the coordination is not by design, set policy.memory.cross_agent to refuse on the reader's spec"}, "agents": ["drafter", "auditor"], "runs": ["chief-r1", "auditor-r1"], "data": {"day": "2026-10-20", "writer": {"agent": "drafter", "run": "chief-r1", "sub_run": "drafter-sub-9f8e7d6c5b"}, "reader": {"agent": "auditor", "run": "auditor-r1", "sub_run": null}, "reads": 1, "refused": 0, "tainted": false, "keys": ["draft/7"], "both_ways": false, "sub_runs": ["drafter-sub-9f8e7d6c5b"]}}, {"id": "guardian:g-778714089df24ab4", "kind": "guardian", "severity": 8, "age_s": 0.0, "rank": 8.0, "title": "vendor-desk: the guardian blocked run vendor-desk-g1", "detail": "it is sending case data to an outside address (confidence 0.95, gpt-4o-mini)", "agent": "vendor-desk", "run": "vendor-desk-g1", "job": "", "since": "2026-10-21T11:41:14Z", "deadline": null, "holds": "", "action": {"method": "GET", "path": "/api/runs/vendor-desk-g1", "body": null, "says": "review the run the guardian stopped, and its reason"}, "agents": ["vendor-desk"], "runs": ["vendor-desk-g1"], "data": {"verdict": "block", "confidence": 0.95, "reason": "it is sending case data to an outside address", "model": "gpt-4o-mini", "action": "block", "outcome": "acted", "why": ""}}, {"id": "guardian:g-3e8bff46523b4c61", "kind": "guardian", "severity": 7, "age_s": 0.0, "rank": 7.0, "title": "vetting: the guardian held run vetting-2026-10-21T11-41-14-f6b539 at its next gate", "detail": "the run is moving money, which vetting never does (confidence 0.90, gpt-4o-mini)", "agent": "vetting", "run": "vetting-2026-10-21T11-41-14-f6b539", "job": "", "since": "2026-10-21T11:41:14Z", "deadline": null, "holds": "", "action": {"method": "GET", "path": "/api/approvals", "body": null, "says": "the run waits for a person at its next call at or above write: answer it in the inbox"}, "agents": ["vetting"], "runs": ["vetting-2026-10-21T11-41-14-f6b539"], "data": {"verdict": "hold", "confidence": 0.9, "reason": "the run is moving money, which vetting never does", "model": "gpt-4o-mini", "action": "hold", "outcome": "acted", "why": ""}}, {"id": "guardian:g-7e0acba468a54c11", "kind": "guardian", "severity": 7, "age_s": 0.0, "rank": 7.0, "title": "vendor-desk: the guardian would block run vendor-desk-g2", "detail": "it is sending case data to an outside address (confidence 0.95, gpt-4o-mini); not acted on: block is not among what the guardian may do (may: hold)", "agent": "vendor-desk", "run": "vendor-desk-g2", "job": "", "since": "2026-10-21T11:41:14Z", "deadline": null, "holds": "", "action": {"method": "POST", "path": "/api/runs/vendor-desk-g2/kill", "body": {"reason": "guardian: it is sending case data to an outside address"}, "says": "the guardian did not act (block is not among what the guardian may do (may: hold)): kill the run if you agree"}, "agents": ["vendor-desk"], "runs": ["vendor-desk-g2"], "data": {"verdict": "block", "confidence": 0.95, "reason": "it is sending case data to an outside address", "model": "gpt-4o-mini", "action": "block", "outcome": "attention", "why": "block is not among what the guardian may do (may: hold)"}}, {"id": "guardian:g-b96faf8630504882", "kind": "guardian", "severity": 7, "age_s": 0.0, "rank": 7.0, "title": "vendor-desk: the guardian would hold run vendor-desk-g3", "detail": "the run is moving money, which vetting never does (confidence 0.90, gpt-4o-mini); not acted on: confidence 0.90 is under the minimum of 0.99", "agent": "vendor-desk", "run": "vendor-desk-g3", "job": "", "since": "2026-10-21T11:41:14Z", "deadline": null, "holds": "", "action": {"method": "POST", "path": "/api/runs/vendor-desk-g3/steer", "body": {"hold_at_next_gate": true}, "says": "the guardian did not act (confidence 0.90 is under the minimum of 0.99): hold the run at its next gate if you agree"}, "agents": ["vendor-desk"], "runs": ["vendor-desk-g3"], "data": {"verdict": "hold", "confidence": 0.9, "reason": "the run is moving money, which vetting never does", "model": "gpt-4o-mini", "action": "hold", "outcome": "attention", "why": "confidence 0.90 is under the minimum of 0.99"}}, {"id": "refusal:intake-refused-1", "kind": "refusal", "severity": 6, "age_s": 0.0, "rank": 6.0, "title": "intake: a refusal stopped run intake-refused-1", "detail": "egress: refused", "agent": "intake", "run": "intake-refused-1", "job": "", "since": "2026-10-21T11:41:14Z", "deadline": null, "holds": "", "action": {"method": "POST", "path": "/api/runs", "body": {"agent": "intake", "input": {}}, "says": "review the refusal on the journal (GET /api/runs/{id}); start the run again once the policy or the input is right"}, "agents": [], "runs": [], "data": null}, {"id": "drift:triage", "kind": "drift", "severity": 5, "age_s": 10800.6, "rank": 5.63, "title": "triage: drift in tool_mix", "detail": "tool_mix Jensen–Shannon distance 1.000 past 0.2 (8 runs in the last day against 24 before)", "agent": "triage", "run": "", "job": "", "since": "2026-10-21T08:41:14.274Z", "deadline": null, "holds": "", "action": {"method": "GET", "path": "/api/drift?agent=triage", "body": null, "says": "see what moved against the baseline; review the recent runs, and the spec or the model if the shift is not the world's"}, "agents": ["triage"], "runs": [], "data": {"measures": [{"name": "tool_mix", "kind": "mix", "statistic": "jensen_shannon", "distance": 1.0, "z": null, "threshold": 0.2, "drifted": true, "enough": true, "says": "Jensen–Shannon distance 1.000 past 0.2", "recent": {"counts": {"mail.send": 8, "web.fetch": 8}, "shares": {"mail.send": 0.5, "web.fetch": 0.5}, "n": 16}, "baseline": {"counts": {"records.query": 24}, "shares": {"records.query": 1.0}, "n": 24}, "field": null}], "recent": {"since": "2026-10-20T11:41:14.850Z", "until": "2026-10-21T11:41:14.850Z", "runs": 8}, "baseline": {"since": "2026-09-20T11:41:14.850Z", "until": "2026-10-20T11:41:14.850Z", "runs": 24}, "outcome_field": "disposition", "first_seen": "2026-10-21T08:41:14.274Z"}}, {"id": "drift:intake", "kind": "drift", "severity": 5, "age_s": 0.0, "rank": 5.0, "title": "intake: drift in disposition_mix", "detail": "disposition_mix Jensen–Shannon distance 0.275 past 0.2 (7 runs in the last day against 22 before)", "agent": "intake", "run": "", "job": "", "since": "2026-10-21T11:41:14.850Z", "deadline": null, "holds": "", "action": {"method": "GET", "path": "/api/drift?agent=intake", "body": null, "says": "see what moved against the baseline; review the recent runs, and the spec or the model if the shift is not the world's"}, "agents": ["intake"], "runs": [], "data": {"measures": [{"name": "disposition_mix", "kind": "mix", "statistic": "jensen_shannon", "distance": 0.2746, "z": null, "threshold": 0.2, "drifted": true, "enough": true, "says": "Jensen–Shannon distance 0.275 past 0.2", "recent": {"counts": {"state:done": 6, "state:failed": 1}, "shares": {"state:done": 0.8571, "state:failed": 0.1429}, "n": 7}, "baseline": {"counts": {"state:done": 22}, "shares": {"state:done": 1.0}, "n": 22}, "field": "state"}], "recent": {"since": "2026-10-20T11:41:14.850Z", "until": "2026-10-21T11:41:14.850Z", "runs": 7}, "baseline": {"since": "2026-09-20T11:41:14.850Z", "until": "2026-10-20T11:41:14.850Z", "runs": 22}, "outcome_field": null, "first_seen": "2026-10-21T11:41:14.850Z"}}], "count": 10, "how": "rank = severity × (1 + min(age in hours, 48) / 24); each item carries the action that clears it"}},
  "attention_scoped_clerk": {"status": 200, "body": {"items": [{"id": "side_channel:clerk:scribe:2026-10-20", "kind": "side_channel", "severity": 6, "age_s": 78074.9, "rank": 11.42, "title": "clerk read what scribe wrote: two agents coordinating through a shared store", "detail": "1 read on 2026-10-20, 1 refused, a tainted value crossed; keys case/42; written in scribe-r1, read in boss-r1 (sub-run clerk-sub-0a1b2c3d4e)", "agent": "clerk", "run": "boss-r1", "job": "", "since": "2026-10-20T14:00:00Z", "deadline": null, "holds": "", "action": {"method": "GET", "path": "/api/runs/boss-r1", "body": null, "says": "review both runs; if the coordination is not by design, set policy.memory.cross_agent to refuse on the reader's spec"}, "agents": ["scribe", "clerk"], "runs": ["scribe-r1", "boss-r1"], "data": {"day": "2026-10-20", "writer": {"agent": "scribe", "run": "scribe-r1", "sub_run": null}, "reader": {"agent": "clerk", "run": "boss-r1", "sub_run": "clerk-sub-0a1b2c3d4e"}, "reads": 1, "refused": 1, "tainted": true, "keys": ["case/42"], "both_ways": false, "sub_runs": ["clerk-sub-0a1b2c3d4e"]}}], "count": 1, "how": "rank = severity × (1 + min(age in hours, 48) / 24); each item carries the action that clears it"}},
  "run_sub_run_id_404": {"status": 404, "body": {"error": "no run \"clerk-sub-0a1b2c3d4e\""}},
};

function fx(name: string): Fixture {
  const f = FX[name];
  if (!f) throw new Error(`no fixture ${name}`);
  return f;
}

const respond = (f: Fixture) =>
  new Response(f.body === null ? null : JSON.stringify(f.body), { status: f.status, headers: { "content-type": "application/json", ...(f.headers ?? {}) } });

/** Stub fetch to answer each call with the next named fixture; returns what was asked. */
function serve(...names: string[]) {
  const queue = names.map(fx);
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, method: String(init.method ?? "GET"), body: init.body === undefined ? undefined : JSON.parse(String(init.body)) });
      const f = queue.shift();
      if (!f) throw new Error(`no fixture left for ${url}`);
      return respond(f);
    }),
  );
  return calls;
}

/** The generated client's per-request options that answer with a fixture: what the Runs page calls. */
const replay = (name: string) => ({ baseUrl: "http://console.test", fetch: async () => respond(fx(name)) });

/** The DoorError a refused call rejects with. */
const refused = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error("expected the door to refuse");
    },
    (e: unknown) => {
      expect(e).toBeInstanceOf(l5.DoorError);
      return e as l5.DoorError;
    },
  );

/** What a person reads in rendered markup: tags gone, entities decoded, space collapsed. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));

afterEach(() => vi.unstubAllGlobals());

const ROOT = "triage-2026-10-21T11-41-14-x0yu";
const SUB1 = "casework-sub-8b6e472bae";
const SUB2 = "casework-sub-c842c6619f";
const CHILD = "vetting-2026-10-21T11-41-14-67396e";
const PEER = "peer:vendor-bot/t-77";
const SDK = "vendor-desk-r1";
const EXT = "ext-report-1";

async function tree(name = "tree_root") {
  serve(name);
  const t = await l7.getRunTree(ROOT);
  return { t, by: Object.fromEntries(t.nodes.map((n) => [n.run, n])) };
}

describe("GET /api/runs/{id}/tree", () => {
  it("one trace from the orchestrator down: records, in-process sub-runs, a peer leaf, each with its own figures", async () => {
    const calls = serve("tree_root");
    const t = await l7.getRunTree(ROOT);
    expect(calls).toEqual([{ url: `/api/runs/${ROOT}/tree`, method: "GET", body: undefined }]);
    expect(t).toMatchObject({ root: ROOT, asked: ROOT, trace_id: "t-dc497b2c8af741ba", count: 7, truncated: false });
    expect(Object.fromEntries(t.nodes.map((n) => [n.run, [n.kind, n.link, n.state, n.source, n.parent, n.depth]]))).toEqual({
      [ROOT]: ["run", "root", "done", "console", null, 0],
      [SUB1]: ["sub_run", "journal", "failed", "console", ROOT, 1],
      [SUB2]: ["sub_run", "journal", "failed", "console", ROOT, 1],
      [CHILD]: ["run", "parent", "done", "worker", ROOT, 1],
      [PEER]: ["peer", "journal", "submitted", "peer", CHILD, 2],
      [SDK]: ["run", "parent", "running", "sdk", CHILD, 2],
      [EXT]: ["run", "trace", "done", "a2a", ROOT, 1],
    });
    const by = Object.fromEntries(t.nodes.map((n) => [n.run, n]));
    // Own figures only: the orchestrator fanned out; the model calls were its sub-runs'.
    expect(by[ROOT]).toMatchObject({ cost: 0, tokens: 0, tool_calls: 2, refusals: 0, started_at: "2026-10-21T11:41:14.284Z", finished_at: "2026-10-21T11:41:14.292Z" });
    // A sub-run has no clock of its own, and its refusal (delegation only narrows) is its own.
    expect(by[SUB1]).toMatchObject({ cost: 0.000175, tokens: 55, tool_calls: 0, refusals: 1, started_at: null, finished_at: null });
    expect(by[SUB1].error).toContain("delegation: records.write is granted by this agent's spec but not by 'triage'");
    expect(by[CHILD]).toMatchObject({ cost: 0.0035, tokens: 1100, tool_calls: 1, refusals: 1 });
    // The peer's call was counted where it was made; its leaf counts zero and carries the call.
    expect(by[PEER]).toMatchObject({ cost: 0, tool_calls: 0, agent: "vendor-bot" });
    // No cancel landed on it (L8 polish names one under `cancel`; this capture predates the field).
    expect(by[PEER].peer).toEqual({ name: "vendor-bot", task_id: "t-77", state: "submitted", calls: 1, refused: 0, failed: 0, tools: ["peer.send"], replied: false, cancel: null });
    // Totals: each node and everything under it; the root's is the rollup.
    expect(by[ROOT].total).toEqual({ cost: 0.00385, tokens: 1210, tool_calls: 3, refusals: 3 });
    expect(by[CHILD].total).toEqual({ cost: 0.0035, tokens: 1100, tool_calls: 1, refusals: 1 });
    expect(t.rollup).toMatchObject({ cost: 0.00385, tokens: 1210, tool_calls: 3, refusals: 3 });
    expect(t.rollup.by_agent.casework).toEqual({ cost: 0.00035, tokens: 110, tool_calls: 0, refusals: 2, nodes: 2 });
    expect(t.rollup.by_agent["peer:vendor-bot"]).toEqual({ cost: 0, tokens: 0, tool_calls: 0, refusals: 0, nodes: 1 });
  });

  it("each record carries its runs-list row (listed); the root's total and the rollup are those rows summed; the backend says which is which", async () => {
    const { t, by } = await tree();
    expect(t.how).toMatch(/^cost, tokens, tool_calls, refusals: the node's own entries only/);
    expect(t.how).toContain("The root's total and the rollup are the runs list's rows summed over the records in the tree");
    // A record's row covers its whole journal: the orchestrator's sub-runs folded in.
    expect([by[ROOT].cost, by[ROOT].listed]).toEqual([0, { cost: 0.00035, tokens: 110, tool_calls: 2, refusals: 2 }]);
    expect(by[CHILD].listed).toEqual({ cost: 0.0035, tokens: 1100, tool_calls: 1, refusals: 1 });
    // A sub-run and a peer leaf have no row.
    expect([by[SUB1].listed, by[PEER].listed]).toEqual([null, null]);
    const records = t.nodes.filter((n) => n.kind === "run");
    const summed = records.reduce((a, n) => ({ cost: a.cost + (n.listed?.cost ?? 0), tokens: a.tokens + (n.listed?.tokens ?? 0), tool_calls: a.tool_calls + (n.listed?.tool_calls ?? 0), refusals: a.refusals + (n.listed?.refusals ?? 0) }), { cost: 0, tokens: 0, tool_calls: 0, refusals: 0 });
    expect({ ...summed, cost: Math.round(summed.cost * 1e8) / 1e8 }).toEqual({ cost: t.rollup.cost, tokens: t.rollup.tokens, tool_calls: t.rollup.tool_calls, refusals: t.rollup.refusals });
    expect(by[ROOT].total).toEqual({ cost: t.rollup.cost, tokens: t.rollup.tokens, tool_calls: t.rollup.tool_calls, refusals: t.rollup.refusals });
  });

  it("laid out depth-first under the root, siblings in the backend's order; only a record links to a run page", async () => {
    const { t, by } = await tree();
    expect(treeRows(t).map((r) => [r.node.run, r.level, r.last, r.guides, r.children, r.descendants, r.record])).toEqual([
      [ROOT, 0, true, [], 4, 6, true],
      [SUB1, 1, false, [], 0, 0, false],
      [SUB2, 1, false, [], 0, 0, false],
      [CHILD, 1, false, [], 2, 2, true],
      [PEER, 2, false, [true], 0, 0, false],
      [SDK, 2, true, [true], 0, 0, true],
      [EXT, 1, true, [], 0, 0, true],
    ]);
    expect([nodeHref(by[SUB1]), nodeHref(by[PEER]), nodeHref(by[CHILD])]).toEqual([null, null, `/runs?id=${CHILD}`]);
  });

  it("the rollup says where the refusals were: 3 refusals, 2 in sub-runs, 1 in a child run", async () => {
    const { t } = await tree();
    expect(refusalSplit(t)).toEqual({ total: 3, root: 0, subRuns: 2, children: 1 });
    expect(refusalLine(t)).toBe("3 refusals: 2 in sub-runs, 1 in a child run");
    expect(treeSummary(t)).toBe("4 runs, 2 sub-runs, 1 peer task · $0.0039 · 1.2k tokens · 3 tool calls · 3 refusals: 2 in sub-runs, 1 in a child run");
    expect(byAgentRows(t).map((a) => [a.label, a.peer, a.nodes, a.refusals])).toEqual([
      ["vetting", false, 1, 1],
      ["casework", false, 2, 2],
      ["ext", false, 1, 0],
      ["vendor-bot", true, 1, 0],
      ["triage", false, 1, 0],
      ["vendor-desk", false, 1, 0],
    ]);
    expect(figuresLine(t.rollup)).toBe("$0.0039 · 1.2k tokens · 3 tool calls · 3 refusals");
  });

  it("rendered: every node with its kind, state and own figures, the totals, the rollup; no link to a sub-run or a peer", async () => {
    const { t } = await tree();
    const html = renderToStaticMarkup(createElement(RunTreeBody, { tree: t }));
    const text = textOf(html);
    for (const s of ["orchestrator", "triage", "sub-run", "casework", SUB1, "child run", "vetting", "peer task", "vendor-bot", "task t-77", "1 call (peer.send)", "no reply read", "same trace", "ext", "Running", "Complete", "Failed"]) expect(text, s).toContain(s);
    // A sub-run's own figures, to the precision its cost needs.
    expect(text).toContain(`${SUB1} Failed $0.00017 · 55 tokens · 0 tool calls · 1 refusal`);
    expect(text).toContain("$0.0035 · 1.1k tokens · 1 tool call · 1 refusal");
    expect(text).toContain("with 6 under it: $0.0039 · 1.2k tokens · 3 refusals");
    // The orchestrator's own figures are nothing (its work ran in sub-runs); its runs-list row folds them in, so it is shown beside.
    expect(text).toContain("$0 · 0 tokens · 2 tool calls with 6 under it: $0.0039 · 1.2k tokens · 3 refusals in the runs list: $0.00035 · 110 tokens · 2 tool calls · 2 refusals");
    // A record whose row says what its own figures say is not repeated.
    expect(text.match(/in the runs list:/g)).toHaveLength(1);
    expect(text).toContain("Rolled up to the orchestrator · as the runs list shows them $0.0039 · 1.2k tokens · 3 tool calls · 3 refusals 3 refusals: 2 in sub-runs, 1 in a child run");
    expect(html).toContain(`title="${t.how}"`.replace(/'/g, "&#x27;"));
    expect(text).toContain("delegation: records.write is granted by this agent's spec");
    expect(hrefs(html).sort()).toEqual([ROOT, CHILD, SDK, EXT].map((r) => `/runs?id=${r}`).sort());
  });

  it("asked from the grandchild: the same tree, that run marked, the orchestrator named above it", async () => {
    serve("tree_from_grandchild");
    const t = await l7.getRunTree(SDK);
    expect([t.root, t.asked, t.count]).toEqual([ROOT, SDK, 7]);
    expect(treeRows(t).filter((r) => r.asked).map((r) => r.node.run)).toEqual([SDK]);
    const text = textOf(renderToStaticMarkup(createElement(RunTreeBody, { tree: t })));
    expect(text).toContain(`This run is part of a larger tree: the orchestrator is triage · ${ROOT} (this one sits 2 levels below it).`);
    expect(text).toContain("this run");
  });

  it("a key scoped to one agent: its run as the root, no walk up; 403 for the orchestrator's; 404 for none", async () => {
    serve("tree_scoped", "tree_scoped_403", "tree_404");
    const t = await l7.getRunTree(CHILD);
    expect([t.root, t.asked]).toEqual([CHILD, CHILD]);
    expect(t.nodes.map((n) => [n.run, n.kind, n.parent, n.depth])).toEqual([
      [CHILD, "run", null, 0],
      [PEER, "peer", CHILD, 1],
      [SDK, "run", CHILD, 1],
    ]);
    const e403 = await refused(l7.getRunTree(ROOT));
    expect([e403.status, e403.message]).toEqual([403, 'this key is scoped to "vetting"']);
    const e404 = await refused(l7.getRunTree("no-such-run"));
    expect([e404.status, e404.message]).toEqual([404, 'no run "no-such-run"']);
  });

  it("in flight, then killed: what a kill reaches, and the sub-run killed on its parent's cancel", async () => {
    serve("tree_in_flight", "tree_after_kill");
    const live = await l7.getRunTree("triage-2026-10-21T11-41-14-9vz3");
    expect(inFlightNodes(live).map((n) => [n.run, n.kind])).toEqual([
      ["triage-2026-10-21T11-41-14-9vz3", "run"],
      ["casework-sub-0652fb2dd3", "sub_run"],
      ["vendor-desk-k1", "run"],
      ["vetting-2026-10-21T11-41-14-b6fec2", "run"],
      ["vendor-desk-k2", "run"],
    ]);
    const after = await l7.getRunTree("triage-2026-10-21T11-41-14-9vz3");
    const by = Object.fromEntries(after.nodes.map((n) => [n.run, n]));
    expect([by["triage-2026-10-21T11-41-14-9vz3"].state, by["triage-2026-10-21T11-41-14-9vz3"].error]).toEqual(["killed", "killed by operator: runaway tree"]);
    expect(by["casework-sub-0652fb2dd3"].state).toBe("killed");
    expect(by["casework-sub-0652fb2dd3"].error).toMatch(/^runaway tree; whatever was in flight was abandoned/);
    // The children take the kill where they run; until they do, they are what a second kill reaches.
    expect(inFlightNodes(after).map((n) => n.run)).toEqual(["vendor-desk-k1", "vetting-2026-10-21T11-41-14-b6fec2", "vendor-desk-k2"]);
  });

  it("a fan-out past the tree's rate limit: the refusals are the orchestrator's own", async () => {
    serve("tree_rate_limited_fanout");
    const t = await l7.getRunTree("sweep-2026-10-21T11-41-14-3p2j");
    expect(t.nodes.map((n) => n.kind)).toEqual(["run", "sub_run", "sub_run"]);
    expect(refusalLine(t)).toBe("2 refusals in the orchestrator");
  });

  it("a child enqueued on the trigger door names its parent and joins its trace", () => {
    expect(fx("trigger_child_202").body).toMatchObject({ parent_run: ROOT, trace_id: "t-dc497b2c8af741ba", status: "queued" });
  });
});

const KROOT = "triage-2026-10-21T11-41-14-9vz3";

describe("POST /api/runs/{id}/kill reaches the tree", () => {
  it("202: the run in-process, its sub-run on its cancel, its children where they run, a queued child dead-lettered", async () => {
    const calls = serve("kill_tree_202");
    const r = await l7.killRun(KROOT, "runaway tree");
    expect(calls).toEqual([{ url: `/api/runs/${KROOT}/kill`, method: "POST", body: { reason: "runaway tree" } }]);
    expect(r).toMatchObject({ run: KROOT, state: "running", delivery: "in-process", kill: { reason: "runaway tree", by: "Asha Rao", at: "2026-10-21T11:41:14.441Z" } });
    expect(r.reached.map((x) => [x.run, x.kind, x.delivery, x.parent, x.depth, x.state])).toEqual([
      [KROOT, "run", "in-process", null, 0, "running"],
      ["casework-sub-0652fb2dd3", "sub_run", "shared-cancel", KROOT, 1, "running"],
      ["5ece12c5-3a85-40e3-becf-5a6b04905fc8", "job", "queue", KROOT, 1, "failed"],
      ["vendor-desk-k1", "run", "sdk", KROOT, 1, "running"],
      ["vetting-2026-10-21T11-41-14-b6fec2", "run", "worker", KROOT, 1, "running"],
      ["vendor-desk-k2", "run", "sdk", "vetting-2026-10-21T11-41-14-b6fec2", 2, "running"],
    ]);
    expect(reachedGroups(r).map((g) => [g.delivery, g.runs.map((x) => x.run)])).toEqual([
      ["in-process", [KROOT]],
      ["shared-cancel", ["casework-sub-0652fb2dd3"]],
      ["worker", ["vetting-2026-10-21T11-41-14-b6fec2"]],
      ["sdk", ["vendor-desk-k1", "vendor-desk-k2"]],
      ["queue", ["5ece12c5-3a85-40e3-becf-5a6b04905fc8"]],
    ]);
    expect(killSummary(r)).toBe(
      "Kill requested by Asha Rao: the run stopped here; 1 sub-run on its cancel, 1 worker run on its next heartbeat, 2 SDK runs on their next control poll, 1 queued job dead-lettered.",
    );
    // The receipt the Runs page shows: every run reached, how, and a link only for a record.
    const html = renderToStaticMarkup(createElement(KillReceiptView, { receipt: r }));
    const text = textOf(html);
    expect(text).toContain("Kill reached 6");
    for (const s of ["an in-process sub-run, stopped with the run it runs in", "a queued child job: dead-lettered, so it never starts", "an attached agent's run: its SDK takes the kill on its next control poll", "a worker's run: the kill waits on its row and lands on its next heartbeat", "job 5ece12c5-3a85-40e3-becf-5a6b04905fc8", "reason: runaway tree", "dead-lettered, now failed"]) expect(text, s).toContain(s);
    // The first kill of a tree stops nothing twice: nothing was already stopping.
    expect([r.already, r.reached.every((x) => x.kill === null)]).toEqual([[], true]);
    expect(hrefs(html).sort()).toEqual([KROOT, "vendor-desk-k1", "vendor-desk-k2", "vetting-2026-10-21T11-41-14-b6fec2"].map((x) => `/runs?id=${x}`).sort());
  });

  it("a second kill while everything is still stopping: 409 `KillRefused`, read and shown as already being stopped, never as an error", async () => {
    serve("kill_again_already_409");
    const e = await refused(l7.killRun(KROOT, "again"));
    const refusal = l7.killRefusalOf(e);
    expect(refusal?.error).toBe(`run "${KROOT}" was already killed by Asha Rao (runaway tree) and stops at its next checkpoint; 3 more runs in its tree are stopping on an earlier kill too`);
    expect(refusal?.already.map((x) => [x.run, x.kind, x.delivery, x.state, x.kill?.reason, x.kill?.by])).toEqual([
      [KROOT, "run", "in-process", "running", "runaway tree", "Asha Rao"],
      ["casework-sub-0652fb2dd3", "sub_run", "shared-cancel", "running", "runaway tree", "Asha Rao"],
      ["vendor-desk-k1", "run", "sdk", "running", "runaway tree", "Asha Rao"],
      ["vetting-2026-10-21T11-41-14-b6fec2", "run", "worker", "running", "runaway tree", "Asha Rao"],
      ["vendor-desk-k2", "run", "sdk", "running", "runaway tree", "Asha Rao"],
    ]);
    expect(alreadySummary(refusal!)).toBe(
      "Already being stopped: an earlier kill by Asha Rao (runaway tree) reached 4 runs and 1 sub-run in this tree, still stopping at their next checkpoint. Nothing new to reach, so nothing was sent again.",
    );
    const html = renderToStaticMarkup(createElement(KillAlreadyView, { refusal: refusal! }));
    const text = textOf(html);
    for (const s of ["Already being stopped", "stopping on the kill by Asha Rao (runaway tree) at 2026-10-21 11:41:14 UTC", "still running"]) expect(text, s).toContain(s);
    expect(text).not.toMatch(/refused|error/i);
    // Any other refusal is not this.
    expect(l7.killRefusalOf(new l5.DoorError("no such run", 404, {}))).toBeNull();
  });

  it("something new joined the tree since: 202 delivered `tree`, only the newcomer reached, the rest listed as already stopping", async () => {
    serve("kill_tree_delivery_tree");
    const r = await l7.killRun(KROOT, "the late one");
    expect([r.delivery, r.state, r.reached.map((x) => [x.run, x.delivery, x.kill])]).toEqual(["tree", "killed", [["vendor-desk-k3", "sdk", null]]]);
    expect(r.already.map((x) => [x.run, x.delivery, x.kill?.reason])).toEqual([
      ["vendor-desk-k1", "sdk", "runaway tree"],
      ["vetting-2026-10-21T11-41-14-b6fec2", "worker", "runaway tree"],
      ["vendor-desk-k2", "sdk", "runaway tree"],
    ]);
    expect(killSummary(r)).toBe(
      "The run itself had already ended (killed); the kill by Asha Rao reached what it set off: 1 SDK run on its next control poll. 3 more are already stopping on an earlier kill by Asha Rao (runaway tree), and were not sent another.",
    );
    expect(r.already.map(reachedStateText)).toEqual(["still running", "still running", "still running"]);
    const text = textOf(renderToStaticMarkup(createElement(KillReceiptView, { receipt: r })));
    for (const s of ["Kill reached 1", "Already stopping on an earlier kill, not sent another", "vendor-desk-k3", "stopping on the kill by Asha Rao (runaway tree)"]) expect(text, s).toContain(s);
  });

  it("once nothing is in flight: 409 with nothing already stopping, the backend's own sentence", async () => {
    serve("kill_409");
    const e = await refused(l7.killRun(KROOT, "third"));
    const refusal = l7.killRefusalOf(e);
    expect(refusal).toEqual({ error: `run "${KROOT}" is killed, not in flight`, already: [] });
    expect(alreadySummary(refusal!)).toBe(`run "${KROOT}" is killed, not in flight`);
  });

  it("a worker's run: delivered on its heartbeat, with its child by parent link", async () => {
    serve("kill_worker_202");
    const r = await l7.killRun("vetting-2026-10-21T11-41-14-30c772", "stop both");
    expect([r.delivery, r.reached.map((x) => [x.run, x.delivery, x.depth])]).toEqual([
      "worker",
      [
        ["vetting-2026-10-21T11-41-14-30c772", "worker", 0],
        ["vetting-2026-10-21T11-41-14-6f9c1a", "worker", 1],
      ],
    ]);
    expect(killSummary(r)).toBe("Kill requested by Asha Rao: the run on its worker's next heartbeat; 1 worker run on its next heartbeat.");
  });
});

describe("429 where runs and triggers start", () => {
  it("POST /api/runs, the agent's limit: scope, limit, figures and Retry-After, through the generated client the Runs page calls", async () => {
    const { data, error, response } = await api.POST("/api/runs", { body: { agent: "tiny", input: { case: "C-3" }, provider: "scripted", model: "" }, ...replay("runs_429_agent") });
    expect(data).toBeUndefined();
    expect([response.status, response.headers.get("retry-after")]).toEqual([429, "60"]);
    const rl = l7.rateLimitOf(response.status, error, response.headers.get("retry-after"));
    expect(rl).toEqual({
      error: "rate limit: 2 runs started for tiny in the last minute, 2 allowed (run_starts_per_minute); retry in 60s",
      scope: "agent",
      limit: "run_starts_per_minute",
      used: 2,
      allowed: 2,
      retry_after_s: 60,
      agent: "tiny",
      // A refused root start names no tree: the trace minted for it never started.
      tree: "",
      kind: "start",
    });
    expect(rateLimitText(rl!)).toBe("Rate limited for agent tiny: runs started per minute, 2 used of 2 allowed (run_starts_per_minute). Retry in 1 min.");
    // Counting down from when it was read.
    expect(rateLimitText(rl!, 1_000, 43_500)).toBe("Rate limited for agent tiny: runs started per minute, 2 used of 2 allowed (run_starts_per_minute). Retry in 18 s.");
    expect(rateLimitText(rl!, 1_000, 62_000)).toMatch(/It can be started again now\.$/);
  });

  it("the tree's limit: everything one trace started in the minute", async () => {
    const { error, response } = await api.POST("/api/runs", { body: { agent: "tiny", input: { case: "C-3" }, provider: "scripted", model: "", parent_run: "tiny-r1" }, ...replay("runs_429_tree") });
    const rl = l7.rateLimitOf(response.status, error, response.headers.get("retry-after"))!;
    expect([rl.scope, rl.limit, rl.used, rl.allowed, rl.tree]).toEqual(["tree", "tree_per_minute", 2, 2, "t-07a7adcf663e4340"]);
    expect(rateLimitText(rl)).toBe("Rate limited for the tree t-07a7adcf663e4340: runs, sub-runs and jobs per minute in one tree, 2 used of 2 allowed (tree_per_minute). Retry in 1 min.");
  });

  it("the trigger door's limit; the header stands in for a body without the wait; any other status is no rate limit", () => {
    const f = fx("trigger_429_agent");
    const rl = l7.rateLimitOf(f.status, f.body, f.headers?.["retry-after"])!;
    expect([rl.limit, rl.kind, rl.tree, rl.used, rl.allowed]).toEqual(["enqueues_per_minute", "enqueue", "", 1, 1]);
    expect(rateLimitText(rl)).toBe("Rate limited for agent tiny: jobs queued per minute, 1 used of 1 allowed (enqueues_per_minute). Retry in 1 min.");
    const { retry_after_s: _gone, ...bare } = f.body as Record<string, unknown>;
    void _gone;
    expect(l7.rateLimitOf(429, bare, "17")!.retry_after_s).toBe(17);
    expect(l7.rateLimitOf(429, {}, null)!.retry_after_s).toBe(60);
    expect(l7.rateLimitOf(423, f.body, "17")).toBeNull();
  });


  it("a 429 through an L7 door keeps its Retry-After on the error", async () => {
    serve("runs_429_agent");
    const e = await refused(l7.getDrift());
    expect(e.status).toBe(429);
    expect(l7.rateLimitOfError(e)).toMatchObject({ scope: "agent", limit: "run_starts_per_minute", retry_after_s: 60 });
    expect(l7.rateLimitOfError(new Error("x"))).toBeNull();
  });
});

describe("GET /api/dependencies", () => {
  async function map() {
    const calls = serve("deps_7d");
    const m = await l7.getDependencies("7d");
    return { m, calls, edge: (from: string, to: string, kind: string) => m.edges.find((e) => e.from === from && e.to === to && e.kind === kind)! };
  }

  it("every kind of node with its health; every edge with count, cost, failures and declared/seen evidence", async () => {
    const { m, calls, edge } = await map();
    expect(calls[0].url).toBe("/api/dependencies?window=7d");
    expect([m.window, m.counts]).toEqual(["7d", { nodes: 17, edges: 18, seen: 11, declared_only: 7 }]);
    expect(new Set(m.nodes.map((n) => n.kind))).toEqual(new Set(["agent", "tool", "server", "peer", "connector", "model", "application"]));
    const by = Object.fromEntries(m.nodes.map((n) => [n.id, n]));
    expect(by["server:casedesk"]).toMatchObject({ label: "Case desk", health: "pending", detail: "MCP pin pending", count: 3, failures: 1 });
    expect(by["tool:casedesk.lookup"]).toMatchObject({ health: "degraded", count: 3, failures: 1 });
    expect(by["application:policy-chat"]).toMatchObject({ label: "Policy Chat", detail: "chatbot", health: "ok" });
    expect(by["model:meta/llama-3-70b"]).toMatchObject({ health: "idle", declared: true, observed: false });
    // An agent's label is its spec's name, which several share: the map names it by its id.
    expect([by["agent:alpha"].label, by["agent:beta"].label]).toEqual(["Tiny", "Tiny"]);
    expect(edge("agent:beta", "tool:casedesk.lookup", "calls")).toMatchObject({ count: 1, failures: 1, evidence: "both" });
    expect(edge("agent:gamma", "tool:notify.send", "calls")).toMatchObject({ count: 0, evidence: "declared", last_at: null });
    expect(edge("agent:alpha", "agent:beta", "sub_run")).toMatchObject({ count: 1, cost: 8.4e-6, evidence: "both" });
    expect(edge("server:casedesk", "tool:casedesk.lookup", "serves")).toMatchObject({ count: 3, failures: 1 });
    expect(edge("agent:delta", "peer:vendor-bot", "peer")).toMatchObject({ count: 1, evidence: "both" });
    expect(edge("application:policy-chat", "model:gpt-4o", "uses_model")).toMatchObject({ cost: 0.0001, evidence: "both" });
    // A connector reached only inside an in-process sub-run is read off the sub-agent's bindings: seen, counted, healthy.
    expect(edge("connector:records", "tool:records.query", "serves")).toMatchObject({ count: 1, failures: 0, evidence: "both" });
    expect(by["connector:records"]).toMatchObject({ health: "ok", count: 1, observed: true });
    expect(by["connector:notify"]).toMatchObject({ health: "idle", observed: false });
  });

  it("laid out in the direction of dependence: applications, agents, what agents reach, what serves it", async () => {
    const { m } = await map();
    expect(groupByLayer(m).map((c) => [c.key, c.count, c.groups.map((g) => [g.kind, g.nodes.map((n) => n.id)])])).toEqual([
      ["applications", 1, [["application", ["application:policy-chat"]]]],
      ["agents", 6, [["agent", ["agent:alpha", "agent:beta", "agent:casedesk", "agent:delta", "agent:gamma", "agent:slashy"]]]],
      [
        "reached",
        7,
        [
          ["model", ["model:gpt-4o", "model:gpt-4o-mini", "model:meta/llama-3-70b"]],
          ["peer", ["peer:vendor-bot"]],
          ["tool", ["tool:casedesk.lookup", "tool:notify.send", "tool:records.query"]],
        ],
      ],
      ["serving", 3, [["server", ["server:casedesk"]], ["connector", ["connector:notify", "connector:records"]]]],
    ]);
  });

  it("a node's neighbourhood: a tool depends on the server serving it, and the agents on the tool; how each edge is drawn", async () => {
    const { m, edge } = await map();
    const tool = adjacency(m, "tool:casedesk.lookup");
    expect(tool.dependsOn.map((x) => [x.other, x.edge.kind])).toEqual([["server:casedesk", "serves"]]);
    expect(tool.dependedOnBy.map((x) => x.other)).toEqual(["agent:alpha", "agent:beta", "agent:gamma", "agent:casedesk"]);
    const server = adjacency(m, "server:casedesk");
    expect([server.dependsOn, server.dependedOnBy.map((x) => x.other)]).toEqual([[], ["tool:casedesk.lookup"]]);
    expect(adjacency(m, "agent:alpha").dependsOn.map((x) => x.other)).toEqual(["agent:beta", "model:gpt-4o", "tool:casedesk.lookup"]);
    expect(edgeLook(edge("agent:beta", "tool:casedesk.lookup", "calls")).tone).toBe("err");
    expect(edgeLook(edge("agent:gamma", "tool:notify.send", "calls"))).toMatchObject({ dash: "4 4", tone: "line" });
    expect(edgeLook(edge("agent:alpha", "model:gpt-4o", "uses_model"))).toMatchObject({ dash: undefined, tone: "line" });
    expect([healthOf("pending"), healthOf("degraded").tone, healthOf("idle").tone]).toEqual([{ tone: "warn", label: "pin pending approval" }, "warn", "neutral"]);
  });

  it("a bad window is a 400 naming the field; a scoped key sees its agent's neighbourhood", async () => {
    serve("deps_400", "deps_scoped");
    const e = await refused(l7.getDependencies("7 days"));
    expect([e.status, e.field, e.message]).toEqual([400, "window", "window is a number and a unit: 30m, 24h, 7d"]);
    const scoped = await l7.getDependencies();
    expect(scoped.nodes.map((n) => n.id)).toEqual(["agent:alpha", "agent:beta", "model:gpt-4o", "tool:casedesk.lookup"]);
  });
});

describe("GET /api/dependencies/{node}/blast-radius", () => {
  async function byIdOfMap() {
    serve("deps_7d");
    const m = await l7.getDependencies();
    return new Map(m.nodes.map((n) => [n.id, n]));
  }

  it("a shared server: every agent on it with the path, the run in flight that already called it, the applications", async () => {
    const byId = await byIdOfMap();
    const calls = serve("blast_server");
    const b = await l7.getBlastRadius("server:casedesk", "7d");
    expect(calls[0].url).toBe("/api/dependencies/server%3Acasedesk/blast-radius?window=7d");
    expect(b.node).toMatchObject({ id: "server:casedesk", kind: "server", health: "pending" });
    expect(b.agents.map((a) => [a.agent, a.how])).toEqual([["alpha", "direct"], ["beta", "direct"], ["casedesk", "direct"], ["gamma", "direct"]]);
    const gamma = b.agents.find((a) => a.agent === "gamma")!;
    expect(gamma.via).toEqual(["server:casedesk", "tool:casedesk.lookup", "agent:gamma"]);
    expect(pathText(gamma.via, byId)).toBe("Case desk → casedesk.lookup → gamma");
    expect(b.runs_in_flight).toEqual([{ run: "gamma-r1", agent: "gamma", state: "running", source: "console", uses: "direct", called: true }]);
    expect(b.applications.map((a) => [a.id, a.class, a.source])).toEqual([["alpha", "multi_agent", "workflow"], ["beta", "agent", "workflow"], ["casedesk", "agent", "workflow"], ["gamma", "agent", "workflow"]]);
    expect(blastCountsLine(b)).toBe("4 agents (4 direct, 0 through another agent) · 1 run in flight · 4 applications");
    expect([...blastIds(b)].sort()).toEqual(["agent:alpha", "agent:beta", "agent:casedesk", "agent:gamma", "server:casedesk", "tool:casedesk.lookup"]);
    const html = renderToStaticMarkup(createElement(BlastView, { blast: b, byId, onPick: () => {} }));
    const text = textOf(html);
    for (const s of ["4 agents (4 direct, 0 through another agent)", "Case desk → casedesk.lookup → gamma", "already called it", "its agent depends on it directly", "multi-agent system", "workflow"]) expect(text, s).toContain(s);
    expect(hrefs(html)).toEqual(["/runs?id=gamma-r1"]);
  });

  it("through another agent: a tool only beta calls fails alpha too, which invokes beta", async () => {
    const byId = await byIdOfMap();
    serve("blast_tool_transitive");
    const b = await l7.getBlastRadius("tool:records.query");
    expect(b.agents.map((a) => [a.agent, a.how, pathText(a.via, byId)])).toEqual([
      ["beta", "direct", "records.query → beta"],
      ["alpha", "transitive", "records.query → beta → alpha"],
    ]);
    expect(blastCountsLine(b)).toBe("2 agents (1 direct, 1 through another agent) · 0 runs in flight · 2 applications");
    expect(textOf(renderToStaticMarkup(createElement(BlastView, { blast: b, byId, onPick: () => {} })))).toContain("through another agent");
  });

  it("a model by its bare name, a peer, an agent: who fails with each", async () => {
    serve("blast_model_bare", "blast_peer", "blast_agent");
    const model = await l7.getBlastRadius("gpt-4o");
    expect(model.node.id).toBe("model:gpt-4o");
    expect(model.applications[0]).toEqual({ id: "policy-chat", name: "Policy Chat", class: "chatbot", source: "application", via: "application:policy-chat" });
    expect(model.runs_in_flight.map((r) => [r.run, r.uses, r.called])).toEqual([["gamma-r1", "direct", false]]);
    const peer = await l7.getBlastRadius("peer:vendor-bot");
    expect(peer.agents.map((a) => [a.agent, a.how, a.via])).toEqual([["delta", "direct", ["peer:vendor-bot", "agent:delta"]]]);
    const agent = await l7.getBlastRadius("agent:beta");
    expect(agent.agents.map((a) => [a.agent, a.how])).toEqual([["alpha", "direct"]]);
  });

  it("an id with a slash is asked like any other: the path keeps the slash, each segment encoded; one the map lacks is the door's own 404", async () => {
    const calls = serve("blast_slash_encoded", "blast_slash_404");
    const b = await l7.getBlastRadius("model:meta/llama-3-70b");
    expect(calls[0].url).toBe("/api/dependencies/model%3Ameta/llama-3-70b/blast-radius?window=7d");
    expect([b.node.id, b.agents.map((a) => a.agent), b.counts]).toEqual(["model:meta/llama-3-70b", ["slashy"], { direct: 1, transitive: 0, agents: 1, runs_in_flight: 0, applications: 1 }]);
    // Raw, %2F-encoded and by its bare name, the backend answers the same.
    for (const name of ["blast_slash_raw", "blast_slash_bare_encoded"]) expect((fx(name).body as { node: { id: string } }).node.id, name).toBe("model:meta/llama-3-70b");
    const e = await refused(l7.getBlastRadius("model:meta/nothing"));
    expect([e.status, e.message]).toEqual([404, 'no node "model:meta/nothing" in the dependency map; ids are <kind>:<name>, e.g. tool:casedesk.lookup']);
    expect(calls[1].url).toBe("/api/dependencies/model%3Ameta/nothing/blast-radius?window=7d");
  });

  it("refusals: 404, 409 with its candidates, 403 for a key scoped to one agent", async () => {
    serve("blast_404", "blast_409", "blast_scoped_403");
    const e404 = await refused(l7.getBlastRadius("tool:nothing"));
    expect(blastRefusalText(e404.status, e404.message)).toBe('no node "tool:nothing" in the dependency map; ids are <kind>:<name>, e.g. tool:casedesk.lookup. The map may have moved since it was read; read it again.');
    const e409 = await refused(l7.getBlastRadius("casedesk"));
    expect([e409.status, l7.candidatesOf(e409)]).toEqual([409, ["agent:casedesk", "server:casedesk"]]);
    const e403 = await refused(l7.getBlastRadius("server:casedesk"));
    expect(e403.message).toBe('this key is scoped to "alpha"; the blast radius reaches every agent');
    expect(blastRefusalText(403, e403.message)).toMatch(/^A blast radius reaches every agent, so a key scoped to one agent cannot ask for it\./);
  });
});

describe("GET /api/drift", () => {
  async function drift() {
    const calls = serve("drift_all");
    const r = await l7.getDrift();
    const agent = (name: string) => r.agents.find((a) => a.agent === name)!;
    const measure = (name: string, m: string) => agent(name).measures.find((x) => x.name === m)!;
    return { r, calls, agent, measure };
  }

  it("per agent, drifted first, then compared, then too few runs; the thresholds and windows it was read with", async () => {
    const { r, calls } = await drift();
    expect(calls[0].url).toBe("/api/drift");
    expect(orderDrift(r.agents).map((a) => [a.agent, a.drifted, a.enough])).toEqual([["triage", true, true], ["intake", false, true], ["scribe", false, false]]);
    expect([r.thresholds, r.min_runs, r.windows, r.count]).toEqual([{ mix_js: 0.2, mean_z: 2 }, { recent: 5, baseline: 20 }, { recent_h: 24, baseline_d: 30 }, 3]);
  });

  it("each measure: the statistic, the distance or z, the threshold, recent against baseline", async () => {
    const { agent, measure } = await drift();
    expect(agent("triage")).toMatchObject({ says: "shifted: tool_mix", outcome_field: "disposition", recent: { runs: 8 }, baseline: { runs: 24 } });
    const tool = measure("triage", "tool_mix");
    expect([statText(tool), thresholdText(tool), sideText(tool, tool.recent), sideText(tool, tool.baseline), tool.drifted]).toEqual(["1.000", "past 0.2", "mail.send 50% · web.fetch 50% (n 16)", "records.query 100% (n 24)", true]);
    const disp = measure("triage", "disposition_mix");
    expect([statText(disp), sideText(disp, disp.recent), disp.field]).toEqual(["0.000", "benign 75% · escalate 25% (n 8)", "disposition"]);
    const conf = measure("triage", "confidence");
    expect([statText(conf), thresholdText(conf), sideText(conf, conf.recent), sideText(conf, conf.baseline)]).toEqual(["z −0.37", "past ±2", "0.80 ± 0.02 (n 8)", "0.80 ± 0.02 (n 24)"]);
    const cost = measure("triage", "cost_per_run");
    expect([statText(cost), sideText(cost, cost.recent), sideText(cost, cost.baseline)]).toEqual(["z +0.00", "$0.0036 ± $0 (n 8)", "$0.0036 ± $0.0001 (n 24)"]);
    const rate = measure("triage", "refusal_rate");
    expect([statText(rate), sideText(rate, rate.recent)]).toEqual(["z +0.00", "0% of runs (0 of 8)"]);
    expect(driftVerdict(agent("triage"))).toEqual({ tone: "err", label: "Drifted", detail: "shifted: Tool mix" });
  });

  it("identical costs in both windows are no shift: z 0 within ±2 (the backend guards a spread of rounding error), both means shown", async () => {
    const { measure } = await drift();
    const cost = measure("intake", "cost_per_run");
    expect([cost.drifted, cost.z, cost.distance, statText(cost), cost.says]).toEqual([false, 0, 0, "z +0.00", "z +0.00 within ±2"]);
    expect(sideText(cost, cost.recent)).toBe(sideText(cost, cost.baseline).replace("(n 22)", "(n 6)"));
    const conf = measure("intake", "confidence");
    expect([conf.enough, statText(conf), conf.says, sideText(conf, conf.recent)]).toEqual([false, "—", "no run's result carries a confidence", "—"]);
  });

  it("too few runs: says so, carries no measures", async () => {
    const { agent } = await drift();
    expect(agent("scribe").measures).toEqual([]);
    expect(driftVerdict(agent("scribe"))).toEqual({ tone: "neutral", label: "Not enough runs", detail: "not enough runs: 3 in the last 24 h (need 5) and 4 in the 30 days before (need 20)" });
  });

  it("rendered: every measure with its statistic, value, threshold, both sides and verdict; too few runs said once", async () => {
    const { r, agent } = await drift();
    const text = textOf(renderToStaticMarkup(createElement(AgentCard, { drift: agent("triage"), windows: r.windows, single: false })));
    for (const s of ["Drifted", "shifted: Tool mix", "8 runs in the last 24 h against 24 in the 30 days before", "Tool mix", "Jensen–Shannon distance", "1.000", "past 0.2", "mail.send 50% · web.fetch 50% (n 16)", "records.query 100% (n 24)", "Welch's z", "z −0.37", "two-proportion z", "drifted", "within", "the result's disposition (the spec's outcome field)"]) expect(text, s).toContain(s);
    const thin = textOf(renderToStaticMarkup(createElement(AgentCard, { drift: agent("scribe"), windows: r.windows, single: true })));
    expect(thin).toContain("Not enough runs not enough runs: 3 in the last 24 h (need 5) and 4 in the 30 days before (need 20)");
  });

  it("one agent by name; a bad name is a 400 naming the field", async () => {
    const calls = serve("drift_scribe", "drift_400");
    const one = await l7.getDrift("scribe");
    expect([calls[0].url, one.agents.map((a) => a.agent)]).toEqual(["/api/drift?agent=scribe", ["scribe"]]);
    const e = await refused(l7.getDrift("Not An Id"));
    expect([e.status, e.field, e.message]).toEqual([400, "agent", "agent must be an agent id"]);
  });
});

describe("GET /api/attention: drift, the guardian and side channels", () => {
  async function rows() {
    serve("attention_l7");
    const items = await l5.listAttention();
    return { items, by: (id: string) => items.find((i) => i.id === id)! };
  }

  it("the new kinds with agents, runs and data, each with the console's lever; the L5 kinds carry none", async () => {
    const { items, by } = await rows();
    expect(items.map((i) => [i.kind, i.action.kind, attentionVerb(i)])).toEqual([
      ["side_channel", "open", "Open"],
      ["side_channel", "open", "Open"],
      ["side_channel", "open", "Open"],
      ["guardian", "open", "Open"],
      ["guardian", "open", "Open"],
      ["guardian", "kill", "Kill…"],
      ["guardian", "hold", "Hold"],
      ["refusal", "open", "Open"],
      ["drift", "open", "Open"],
      ["drift", "open", "Open"],
    ]);
    expect(items.map((i) => ATTENTION_LABEL[i.kind])).toContain("side channel");
    // Drift opens the agent's drift page, never re-reads the API door it names.
    expect(by("drift:triage").action).toMatchObject({ method: "GET", path: "/api/drift?agent=triage", href: "/drift?agent=triage" });
    expect(by("drift:triage")).toMatchObject({ agents: ["triage"], runs: [], data: { outcome_field: "disposition", recent: { runs: 8 }, baseline: { runs: 24 } } });
    expect((by("drift:triage").data!.measures as { name: string }[]).map((m) => m.name)).toEqual(["tool_mix"]);
    // A refusal (L5) carries no links of the new kind.
    expect(by("refusal:intake-refused-1")).toMatchObject({ agents: [], runs: [], data: null });
  });

  it("a drift ages from when it was first seen: since, age and rank count from that sighting, which the row says", async () => {
    const { by } = await rows();
    const triage = by("drift:triage");
    // First seen three hours before the reading (the backend keeps the sighting on its `drift_seen` row).
    expect([triage.since, triage.data?.first_seen, driftFirstSeen(triage)]).toEqual(["2026-10-21T08:41:14.274Z", "2026-10-21T08:41:14.274Z", "2026-10-21T08:41:14.274Z"]);
    expect([Math.round(triage.age_s / 60), triage.rank, l5.rankOf(triage.severity, triage.age_s)]).toEqual([180, 5.63, 5.63]);
    // One seen for the first time at this reading is new.
    expect([by("drift:intake").age_s, by("drift:intake").rank]).toEqual([0, 5]);
    // The window is still the window: the last day before the reading.
    expect(String((triage.data?.recent as { since: string }).since) > triage.since).toBe(false);
    expect(textOf(renderToStaticMarkup(createElement(AttentionLinks, { item: triage })))).toBe("drifting since first seen 2026-10-21 08:41:14 UTC");
    expect([driftFirstSeen(by("refusal:intake-refused-1")), driftFirstSeen({ kind: "drift", data: null })]).toEqual([null, null]);
  });

  it("a verdict the guardian could not act on offers the person's lever: the kill with its reason to start from, or the hold", async () => {
    const { by } = await rows();
    const kill = by("guardian:g-7e0acba468a54c11");
    expect(kill.action).toMatchObject({ kind: "kill", method: "POST", path: "/api/runs/vendor-desk-g2/kill", body: { reason: "guardian: it is sending case data to an outside address" } });
    expect(kill.data).toMatchObject({ verdict: "block", outcome: "attention", why: "block is not among what the guardian may do (may: hold)" });
    const hold = by("guardian:g-b96faf8630504882");
    expect(hold.action).toMatchObject({ kind: "hold", method: "POST", path: "/api/runs/vendor-desk-g3/steer", body: { hold_at_next_gate: true } });
    // What it acted on opens the run.
    expect(by("guardian:g-778714089df24ab4")).toMatchObject({ severity: 8, run: "vendor-desk-g1", action: { kind: "open", path: "/api/runs/vendor-desk-g1" } });
    expect(l5.openableRun(by("guardian:g-3e8bff46523b4c61"))).toBe("vetting-2026-10-21T11-41-14-f6b539");
  });

  it("a side channel names records at both ends, opens the reader's, and mentions a sub-run inside either", async () => {
    const { by } = await rows();
    const pair = by("side_channel:reader:scribe:2026-10-20");
    expect(pair).toMatchObject({ agents: ["scribe", "reader"], runs: ["scribe-r1", "reader-r1", "scribe-r2"], run: "reader-r1", data: { reads: 3, both_ways: true, keys: ["case/42", "case/43"] } });
    expect(l5.openableRun(pair)).toBe("reader-r1");
    // A read inside an in-process sub-run: the item names the record holding it, the sub-run under data.
    const clerk = by("side_channel:clerk:scribe:2026-10-20");
    expect([clerk.run, clerk.action.path, clerk.runs, l5.openableRun(clerk)]).toEqual(["boss-r1", "/api/runs/boss-r1", ["scribe-r1", "boss-r1"], "boss-r1"]);
    expect(sideChannelOf(clerk)).toEqual({
      writer: { agent: "scribe", run: "scribe-r1", sub_run: null },
      reader: { agent: "clerk", run: "boss-r1", sub_run: "clerk-sub-0a1b2c3d4e" },
      sub_runs: ["clerk-sub-0a1b2c3d4e"],
      reads: 1,
      refused: 1,
      tainted: true,
      keys: ["case/42"],
      both_ways: false,
    });
    expect(clerk).toMatchObject({ severity: 6, data: { refused: 1, tainted: true } });
    // The sub-run is mentioned, never linked: no door serves it.
    expect(fx("run_sub_run_id_404").status).toBe(404);
    const html = renderToStaticMarkup(createElement(AttentionLinks, { item: clerk }));
    expect(textOf(html)).toBe("scribe wrote in scribe-r1 · clerk read in boss-r1 (sub-run clerk-sub-0a1b2c3d4e)");
    expect(hrefs(html)).toEqual(["/runs?id=scribe-r1", "/runs?id=boss-r1"]);
    // A writer that was itself a sub-run is resolved to the record holding it the same way.
    const drafted = by("side_channel:auditor:drafter:2026-10-20");
    expect([drafted.run, drafted.runs, sideChannelOf(drafted)?.writer, sideChannelOf(drafted)?.sub_runs]).toEqual([
      "auditor-r1",
      ["chief-r1", "auditor-r1"],
      { agent: "drafter", run: "chief-r1", sub_run: "drafter-sub-9f8e7d6c5b" },
      ["drafter-sub-9f8e7d6c5b"],
    ]);
    expect(textOf(renderToStaticMarkup(createElement(AttentionLinks, { item: drafted })))).toBe("drafter wrote in chief-r1 (sub-run drafter-sub-9f8e7d6c5b) · auditor read in auditor-r1");
    // A key scoped to the reader sees the channels it is part of.
    serve("attention_scoped_clerk");
    expect((await l5.listAttention()).map((i) => [i.id, i.run])).toEqual([["side_channel:clerk:scribe:2026-10-20", "boss-r1"]]);
  });
});

describe("the console's shapes and the generated client agree", () => {
  /** Every field the console names is the backend's, with a type the backend's admits (as tests/l6-contract.test.ts holds L6). */
  type FieldsAgree<Hand, Gen> = { [K in keyof Hand]-?: K extends keyof Gen ? (Exclude<Hand[K], undefined> extends Gen[K] ? true : false) : false }[keyof Hand];
  type Agrees<Hand, Gen> = [FieldsAgree<Hand, Gen>] extends [true] ? true : false;

  it("field by field, for every shape lib/api/l7.ts reads and sends", () => {
    expectTypeOf<Agrees<l7.TreeNode, Schemas["TreeNode"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.Figures, Schemas["Figures"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.PeerInfo, Schemas["PeerInfo"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.AgentFigures, Schemas["AgentFigures"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.TreeRollup, Schemas["TreeRollup"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.RunTree, Schemas["RunTree"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.Reached, Schemas["ReachedRun"]>>().toEqualTypeOf<true>();
    // `settled` (stopped at once, no worker held it) is ahead of the generated types.
    expectTypeOf<Agrees<Omit<l7.KillReceipt, "delivery">, Schemas["RunKilled"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.DepNode, Schemas["DepNode"]>>().toEqualTypeOf<true>();
    // `unpriced` (the models a model edge's unpriced calls were on) is ahead of the generated types.
    expectTypeOf<Agrees<Omit<l7.DepEdge, "unpriced">, Schemas["DepEdge"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<Omit<l7.DepMap, "edges">, Omit<Schemas["DependencyMap"], "edges">>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.BlastAgent, Schemas["BlastAgent"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.BlastRun, Schemas["BlastRun"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.BlastApplication, Schemas["BlastApplication"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.BlastRadius, Schemas["BlastRadius"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.DriftWindow, Schemas["DriftWindow"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.DriftMeasure, Schemas["DriftMeasure"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.AgentDrift, Schemas["AgentDrift"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.DriftReport, Schemas["DriftReport"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<Pick<l5.AttentionItem, "agents" | "runs" | "data">, Schemas["AttentionItem"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.KillRefusal, Schemas["KillRefused"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.KillInfo, Schemas["KillInfo"]>>().toEqualTypeOf<true>();
    // The 429 is the backend's typed `RateLimitRefusal`; the console's names stay open to a limit a newer backend adds.
    expectTypeOf<Agrees<Omit<l7.RateLimit, "limit" | "kind">, Schemas["RateLimitRefusal"]>>().toEqualTypeOf<true>();
    expectTypeOf<Schemas["RateLimitRefusal"]["limit"]>().toMatchTypeOf<l7.RateLimit["limit"]>();
    expectTypeOf<Schemas["RateLimitRefusal"]["kind"]>().toMatchTypeOf<l7.RateLimit["kind"]>();
    expectTypeOf<l7.RateLimitName>().toEqualTypeOf<Schemas["RateLimitFigures"]["limit"]>();
    expectTypeOf<Exclude<l7.KillDelivery, "settled">>().toEqualTypeOf<Schemas["RunKilled"]["delivery"]>();
    expectTypeOf<l7.TreeNodeKind>().toEqualTypeOf<Schemas["TreeNode"]["kind"]>();
    expectTypeOf<l7.MeasureName>().toEqualTypeOf<Schemas["DriftMeasure"]["name"]>();
    // The check bites: a field the backend does not serve is caught.
    expectTypeOf<Agrees<{ cost_usd: number }, Schemas["TreeNode"]>>().toEqualTypeOf<false>();
  });
});
