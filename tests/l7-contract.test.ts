import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { api, type Schemas } from "@/lib/api/client";
import * as l5 from "@/lib/api/l5";
import * as l7 from "@/lib/api/l7";
import { ATTENTION_LABEL, attentionVerb } from "@/lib/gates";
import { byAgentRows, figuresLine, inFlightNodes, killSummary, nodeHref, reachedGroups, refusalLine, refusalSplit, treeRows, treeSummary } from "@/lib/run-tree";
import { rateLimitText } from "@/lib/rate-limit";
import { adjacency, blastAsk, blastCountsLine, blastIds, blastRefusalText, edgeLook, groupByLayer, healthOf, pathText } from "@/lib/dependencies";
import { driftVerdict, orderDrift, sideText, statText, thresholdText } from "@/lib/drift";
import { formOf, outcomeText, patchOf } from "@/lib/guardian";
import { KillReceiptView, RunTreeBody } from "@/components/run-tree";
import { BlastView } from "@/components/dependencies";
import { AgentCard } from "@/components/drift";
import { GuardianActionsTable } from "@/components/guardian";
import { AttentionLinks } from "@/components/attention";
import { runTool } from "@/lib/server/console-tools";

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
 * L5 refusal. Inlined trimmed: run records keep their journals and the facts
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
  "tree_root": {"status": 200, "body": {"root": "triage-2026-10-21T09-42-38-plh8", "asked": "triage-2026-10-21T09-42-38-plh8", "trace_id": "t-206d2951bdaf41a2", "nodes": [{"run": "triage-2026-10-21T09-42-38-plh8", "agent": "triage", "source": "console", "state": "done", "parent": null, "depth": 0, "cost": 0.0, "tokens": 0, "tool_calls": 2, "refusals": 0, "peer": null, "kind": "run", "link": "root", "started_at": "2026-10-21T09:42:38.741Z", "finished_at": "2026-10-21T09:42:38.749Z", "error": "", "estimated": false, "total": {"cost": 0.00385, "tokens": 1210, "tool_calls": 3, "refusals": 3}}, {"run": "casework-sub-090b0241b6", "agent": "casework", "source": "console", "state": "failed", "parent": "triage-2026-10-21T09-42-38-plh8", "depth": 1, "cost": 0.000175, "tokens": 55, "tool_calls": 0, "refusals": 1, "peer": null, "kind": "sub_run", "link": "journal", "started_at": null, "finished_at": null, "error": "delegation: records.write is granted by this agent's spec but not by 'triage', which delegated this work, and delegation only narrows (it holds: agent.invoke)", "estimated": false, "total": {"cost": 0.000175, "tokens": 55, "tool_calls": 0, "refusals": 1}}, {"run": "casework-sub-deecd878e9", "agent": "casework", "source": "console", "state": "failed", "parent": "triage-2026-10-21T09-42-38-plh8", "depth": 1, "cost": 0.000175, "tokens": 55, "tool_calls": 0, "refusals": 1, "peer": null, "kind": "sub_run", "link": "journal", "started_at": null, "finished_at": null, "error": "delegation: records.write is granted by this agent's spec but not by 'triage', which delegated this work, and delegation only narrows (it holds: agent.invoke)", "estimated": false, "total": {"cost": 0.000175, "tokens": 55, "tool_calls": 0, "refusals": 1}}, {"run": "vetting-2026-10-21T09-42-38-5c24d5", "agent": "vetting", "source": "worker", "state": "done", "parent": "triage-2026-10-21T09-42-38-plh8", "depth": 1, "cost": 0.0035, "tokens": 1100, "tool_calls": 1, "refusals": 1, "peer": null, "kind": "run", "link": "parent", "started_at": "2026-10-21T09:42:38.789Z", "finished_at": "2026-10-21T09:42:38.793Z", "error": "", "estimated": false, "total": {"cost": 0.0035, "tokens": 1100, "tool_calls": 1, "refusals": 1}}, {"run": "peer:vendor-bot/t-77", "agent": "vendor-bot", "source": "peer", "state": "submitted", "parent": "vetting-2026-10-21T09-42-38-5c24d5", "depth": 2, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": {"name": "vendor-bot", "task_id": "t-77", "state": "submitted", "calls": 1, "refused": 0, "failed": 0, "tools": ["peer.send"], "replied": false}, "kind": "peer", "link": "journal", "started_at": null, "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}, {"run": "vendor-desk-r1", "agent": "vendor-desk", "source": "sdk", "state": "running", "parent": "vetting-2026-10-21T09-42-38-5c24d5", "depth": 2, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "run", "link": "parent", "started_at": "2026-10-21T12:00:00Z", "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}, {"run": "ext-report-1", "agent": "ext", "source": "a2a", "state": "done", "parent": "triage-2026-10-21T09-42-38-plh8", "depth": 1, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "run", "link": "trace", "started_at": "2026-10-21T09:42:38.730Z", "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}], "rollup": {"cost": 0.00385, "tokens": 1210, "tool_calls": 3, "refusals": 3, "by_agent": {"triage": {"cost": 0.0, "tokens": 0, "tool_calls": 2, "refusals": 0, "nodes": 1}, "casework": {"cost": 0.00035, "tokens": 110, "tool_calls": 0, "refusals": 2, "nodes": 2}, "vetting": {"cost": 0.0035, "tokens": 1100, "tool_calls": 1, "refusals": 1, "nodes": 1}, "peer:vendor-bot": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 1}, "vendor-desk": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 1}, "ext": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 1}}}, "count": 7, "truncated": false}},
  "tree_from_grandchild": {"status": 200, "body": {"root": "triage-2026-10-21T09-42-38-plh8", "asked": "vendor-desk-r1", "trace_id": "t-206d2951bdaf41a2", "nodes": [{"run": "triage-2026-10-21T09-42-38-plh8", "agent": "triage", "source": "console", "state": "done", "parent": null, "depth": 0, "cost": 0.0, "tokens": 0, "tool_calls": 2, "refusals": 0, "peer": null, "kind": "run", "link": "root", "started_at": "2026-10-21T09:42:38.741Z", "finished_at": "2026-10-21T09:42:38.749Z", "error": "", "estimated": false, "total": {"cost": 0.00385, "tokens": 1210, "tool_calls": 3, "refusals": 3}}, {"run": "casework-sub-090b0241b6", "agent": "casework", "source": "console", "state": "failed", "parent": "triage-2026-10-21T09-42-38-plh8", "depth": 1, "cost": 0.000175, "tokens": 55, "tool_calls": 0, "refusals": 1, "peer": null, "kind": "sub_run", "link": "journal", "started_at": null, "finished_at": null, "error": "delegation: records.write is granted by this agent's spec but not by 'triage', which delegated this work, and delegation only narrows (it holds: agent.invoke)", "estimated": false, "total": {"cost": 0.000175, "tokens": 55, "tool_calls": 0, "refusals": 1}}, {"run": "casework-sub-deecd878e9", "agent": "casework", "source": "console", "state": "failed", "parent": "triage-2026-10-21T09-42-38-plh8", "depth": 1, "cost": 0.000175, "tokens": 55, "tool_calls": 0, "refusals": 1, "peer": null, "kind": "sub_run", "link": "journal", "started_at": null, "finished_at": null, "error": "delegation: records.write is granted by this agent's spec but not by 'triage', which delegated this work, and delegation only narrows (it holds: agent.invoke)", "estimated": false, "total": {"cost": 0.000175, "tokens": 55, "tool_calls": 0, "refusals": 1}}, {"run": "vetting-2026-10-21T09-42-38-5c24d5", "agent": "vetting", "source": "worker", "state": "done", "parent": "triage-2026-10-21T09-42-38-plh8", "depth": 1, "cost": 0.0035, "tokens": 1100, "tool_calls": 1, "refusals": 1, "peer": null, "kind": "run", "link": "parent", "started_at": "2026-10-21T09:42:38.789Z", "finished_at": "2026-10-21T09:42:38.793Z", "error": "", "estimated": false, "total": {"cost": 0.0035, "tokens": 1100, "tool_calls": 1, "refusals": 1}}, {"run": "peer:vendor-bot/t-77", "agent": "vendor-bot", "source": "peer", "state": "submitted", "parent": "vetting-2026-10-21T09-42-38-5c24d5", "depth": 2, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": {"name": "vendor-bot", "task_id": "t-77", "state": "submitted", "calls": 1, "refused": 0, "failed": 0, "tools": ["peer.send"], "replied": false}, "kind": "peer", "link": "journal", "started_at": null, "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}, {"run": "vendor-desk-r1", "agent": "vendor-desk", "source": "sdk", "state": "running", "parent": "vetting-2026-10-21T09-42-38-5c24d5", "depth": 2, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "run", "link": "parent", "started_at": "2026-10-21T12:00:00Z", "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}, {"run": "ext-report-1", "agent": "ext", "source": "a2a", "state": "done", "parent": "triage-2026-10-21T09-42-38-plh8", "depth": 1, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "run", "link": "trace", "started_at": "2026-10-21T09:42:38.730Z", "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}], "rollup": {"cost": 0.00385, "tokens": 1210, "tool_calls": 3, "refusals": 3, "by_agent": {"triage": {"cost": 0.0, "tokens": 0, "tool_calls": 2, "refusals": 0, "nodes": 1}, "casework": {"cost": 0.00035, "tokens": 110, "tool_calls": 0, "refusals": 2, "nodes": 2}, "vetting": {"cost": 0.0035, "tokens": 1100, "tool_calls": 1, "refusals": 1, "nodes": 1}, "peer:vendor-bot": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 1}, "vendor-desk": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 1}, "ext": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 1}}}, "count": 7, "truncated": false}},
  "tree_scoped": {"status": 200, "body": {"root": "vetting-2026-10-21T09-42-38-5c24d5", "asked": "vetting-2026-10-21T09-42-38-5c24d5", "trace_id": "t-206d2951bdaf41a2", "nodes": [{"run": "vetting-2026-10-21T09-42-38-5c24d5", "agent": "vetting", "source": "worker", "state": "done", "parent": null, "depth": 0, "cost": 0.0035, "tokens": 1100, "tool_calls": 1, "refusals": 1, "peer": null, "kind": "run", "link": "root", "started_at": "2026-10-21T09:42:38.789Z", "finished_at": "2026-10-21T09:42:38.793Z", "error": "", "estimated": false, "total": {"cost": 0.0035, "tokens": 1100, "tool_calls": 1, "refusals": 1}}, {"run": "peer:vendor-bot/t-77", "agent": "vendor-bot", "source": "peer", "state": "submitted", "parent": "vetting-2026-10-21T09-42-38-5c24d5", "depth": 1, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": {"name": "vendor-bot", "task_id": "t-77", "state": "submitted", "calls": 1, "refused": 0, "failed": 0, "tools": ["peer.send"], "replied": false}, "kind": "peer", "link": "journal", "started_at": null, "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}, {"run": "vendor-desk-r1", "agent": "vendor-desk", "source": "sdk", "state": "running", "parent": "vetting-2026-10-21T09-42-38-5c24d5", "depth": 1, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "run", "link": "parent", "started_at": "2026-10-21T12:00:00Z", "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}], "rollup": {"cost": 0.0035, "tokens": 1100, "tool_calls": 1, "refusals": 1, "by_agent": {"vetting": {"cost": 0.0035, "tokens": 1100, "tool_calls": 1, "refusals": 1, "nodes": 1}, "peer:vendor-bot": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 1}, "vendor-desk": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 1}}}, "count": 3, "truncated": false}},
  "tree_scoped_403": {"status": 403, "body": {"error": "this key is scoped to \"vetting\""}},
  "tree_404": {"status": 404, "body": {"error": "no run \"no-such-run\""}},
  "tree_in_flight": {"status": 200, "body": {"root": "triage-2026-10-21T09-42-38-425z", "asked": "triage-2026-10-21T09-42-38-425z", "trace_id": "t-742f732db42b49c4", "nodes": [{"run": "triage-2026-10-21T09-42-38-425z", "agent": "triage", "source": "console", "state": "running", "parent": null, "depth": 0, "cost": 0.00035, "tokens": 110, "tool_calls": 1, "refusals": 0, "peer": null, "kind": "run", "link": "root", "started_at": "2026-10-21T09:42:38.857Z", "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.00035, "tokens": 110, "tool_calls": 1, "refusals": 0}}, {"run": "casework-sub-fe87936cdf", "agent": "casework", "source": "console", "state": "running", "parent": "triage-2026-10-21T09-42-38-425z", "depth": 1, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "sub_run", "link": "journal", "started_at": null, "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}, {"run": "vendor-desk-k1", "agent": "vendor-desk", "source": "sdk", "state": "running", "parent": "triage-2026-10-21T09-42-38-425z", "depth": 1, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "run", "link": "parent", "started_at": "2026-10-21T12:00:00Z", "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}, {"run": "vetting-2026-10-21T09-42-38-125e07", "agent": "vetting", "source": "worker", "state": "running", "parent": "triage-2026-10-21T09-42-38-425z", "depth": 1, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "run", "link": "parent", "started_at": "2026-10-21T09:42:38.866Z", "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}, {"run": "vendor-desk-k2", "agent": "vendor-desk", "source": "sdk", "state": "running", "parent": "vetting-2026-10-21T09-42-38-125e07", "depth": 2, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "run", "link": "parent", "started_at": "2026-10-21T12:00:00Z", "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}], "rollup": {"cost": 0.00035, "tokens": 110, "tool_calls": 1, "refusals": 0, "by_agent": {"triage": {"cost": 0.00035, "tokens": 110, "tool_calls": 1, "refusals": 0, "nodes": 1}, "casework": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 1}, "vendor-desk": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 2}, "vetting": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 1}}}, "count": 5, "truncated": false}},
  "tree_after_kill": {"status": 200, "body": {"root": "triage-2026-10-21T09-42-38-425z", "asked": "triage-2026-10-21T09-42-38-425z", "trace_id": "t-742f732db42b49c4", "nodes": [{"run": "triage-2026-10-21T09-42-38-425z", "agent": "triage", "source": "console", "state": "killed", "parent": null, "depth": 0, "cost": 0.00035, "tokens": 110, "tool_calls": 1, "refusals": 0, "peer": null, "kind": "run", "link": "root", "started_at": "2026-10-21T09:42:38.857Z", "finished_at": "2026-10-21T09:42:38.906Z", "error": "killed by operator: runaway tree", "estimated": false, "total": {"cost": 0.000525, "tokens": 165, "tool_calls": 1, "refusals": 0}}, {"run": "casework-sub-fe87936cdf", "agent": "casework", "source": "console", "state": "killed", "parent": "triage-2026-10-21T09-42-38-425z", "depth": 1, "cost": 0.000175, "tokens": 55, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "sub_run", "link": "journal", "started_at": null, "finished_at": null, "error": "runaway tree; whatever was in flight was abandoned and nothing after it ran (by Chandresh Singh)", "estimated": false, "total": {"cost": 0.000175, "tokens": 55, "tool_calls": 0, "refusals": 0}}, {"run": "vendor-desk-k1", "agent": "vendor-desk", "source": "sdk", "state": "running", "parent": "triage-2026-10-21T09-42-38-425z", "depth": 1, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "run", "link": "parent", "started_at": "2026-10-21T12:00:00Z", "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}, {"run": "vetting-2026-10-21T09-42-38-125e07", "agent": "vetting", "source": "worker", "state": "running", "parent": "triage-2026-10-21T09-42-38-425z", "depth": 1, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "run", "link": "parent", "started_at": "2026-10-21T09:42:38.866Z", "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}, {"run": "vendor-desk-k2", "agent": "vendor-desk", "source": "sdk", "state": "running", "parent": "vetting-2026-10-21T09-42-38-125e07", "depth": 2, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "run", "link": "parent", "started_at": "2026-10-21T12:00:00Z", "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}], "rollup": {"cost": 0.000525, "tokens": 165, "tool_calls": 1, "refusals": 0, "by_agent": {"triage": {"cost": 0.00035, "tokens": 110, "tool_calls": 1, "refusals": 0, "nodes": 1}, "casework": {"cost": 0.000175, "tokens": 55, "tool_calls": 0, "refusals": 0, "nodes": 1}, "vendor-desk": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 2}, "vetting": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 1}}}, "count": 5, "truncated": false}},
  "tree_rate_limited_fanout": {"status": 200, "body": {"root": "sweep-2026-10-21T09-42-39-cazj", "asked": "sweep-2026-10-21T09-42-39-cazj", "trace_id": "t-78596e7e82674d2d", "nodes": [{"run": "sweep-2026-10-21T09-42-39-cazj", "agent": "sweep", "source": "console", "state": "done", "parent": null, "depth": 0, "cost": 0.0, "tokens": 0, "tool_calls": 4, "refusals": 2, "peer": null, "kind": "run", "link": "root", "started_at": "2026-10-21T09:42:39.000Z", "finished_at": "2026-10-21T09:42:39.004Z", "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 4, "refusals": 2}}, {"run": "casework-sub-929dd79cdd", "agent": "casework", "source": "console", "state": "done", "parent": "sweep-2026-10-21T09-42-39-cazj", "depth": 1, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "sub_run", "link": "journal", "started_at": null, "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}, {"run": "casework-sub-4fd2da8d68", "agent": "casework", "source": "console", "state": "done", "parent": "sweep-2026-10-21T09-42-39-cazj", "depth": 1, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": null, "kind": "sub_run", "link": "journal", "started_at": null, "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}}], "rollup": {"cost": 0.0, "tokens": 0, "tool_calls": 4, "refusals": 2, "by_agent": {"sweep": {"cost": 0.0, "tokens": 0, "tool_calls": 4, "refusals": 2, "nodes": 1}, "casework": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 2}}}, "count": 3, "truncated": false}},
  "trigger_child_202": {"status": 202, "body": {"job": "5c24d517-43dd-4d94-bd6b-8f77ea94a764", "agent": "vetting", "status": "queued", "external_id": null, "source": "local", "attempts": 0, "max_attempts": 3, "run_id": null, "trace_id": "t-206d2951bdaf41a2", "result": null, "error": null, "dead": false, "claimed_by": null, "lease_until": null, "created_at": "2026-10-21T09:42:38.784Z", "started_at": null, "finished_at": null, "status_url": "/api/trigger/vetting/jobs/5c24d517-43dd-4d94-bd6b-8f77ea94a764", "run_url": null, "parent_run": "triage-2026-10-21T09-42-38-plh8", "duplicate": false, "retried": false, "note": null, "lockdown": null}},
  "kill_tree_202": {"status": 202, "body": {"run": "triage-2026-10-21T09-42-38-425z", "state": "running", "kill": {"reason": "runaway tree", "by": "Chandresh Singh", "at": "2026-10-21T09:42:38.902Z"}, "delivery": "in-process", "reached": [{"run": "triage-2026-10-21T09-42-38-425z", "agent": "triage", "source": "console", "kind": "run", "delivery": "in-process", "parent": null, "depth": 0, "state": "running"}, {"run": "casework-sub-fe87936cdf", "agent": "casework", "source": "console", "kind": "sub_run", "delivery": "shared-cancel", "parent": "triage-2026-10-21T09-42-38-425z", "depth": 1, "state": "running"}, {"run": "f2e56509-96f1-4045-9143-78b36b6ed389", "agent": "vetting", "source": "local", "kind": "job", "delivery": "queue", "parent": "triage-2026-10-21T09-42-38-425z", "depth": 1, "state": "queued"}, {"run": "vendor-desk-k1", "agent": "vendor-desk", "source": "sdk", "kind": "run", "delivery": "sdk", "parent": "triage-2026-10-21T09-42-38-425z", "depth": 1, "state": "running"}, {"run": "vetting-2026-10-21T09-42-38-125e07", "agent": "vetting", "source": "worker", "kind": "run", "delivery": "worker", "parent": "triage-2026-10-21T09-42-38-425z", "depth": 1, "state": "running"}, {"run": "vendor-desk-k2", "agent": "vendor-desk", "source": "sdk", "kind": "run", "delivery": "sdk", "parent": "vetting-2026-10-21T09-42-38-125e07", "depth": 2, "state": "running"}]}},
  "kill_tree_delivery_tree": {"status": 202, "body": {"run": "triage-2026-10-21T09-42-38-425z", "state": "killed", "kill": {"reason": "again", "by": "Chandresh Singh", "at": "2026-10-21T09:42:38.941Z"}, "delivery": "tree", "reached": [{"run": "vendor-desk-k1", "agent": "vendor-desk", "source": "sdk", "kind": "run", "delivery": "sdk", "parent": "triage-2026-10-21T09-42-38-425z", "depth": 1, "state": "running"}, {"run": "vetting-2026-10-21T09-42-38-125e07", "agent": "vetting", "source": "worker", "kind": "run", "delivery": "worker", "parent": "triage-2026-10-21T09-42-38-425z", "depth": 1, "state": "running"}, {"run": "vendor-desk-k2", "agent": "vendor-desk", "source": "sdk", "kind": "run", "delivery": "sdk", "parent": "vetting-2026-10-21T09-42-38-125e07", "depth": 2, "state": "running"}]}},
  "kill_409": {"status": 409, "body": {"error": "run \"triage-2026-10-21T09-42-38-425z\" is killed, not in flight"}},
  "kill_worker_202": {"status": 202, "body": {"run": "vetting-2026-10-21T09-42-38-d5fe20", "state": "running", "kill": {"reason": "stop both", "by": "Chandresh Singh", "at": "2026-10-21T09:42:38.962Z"}, "delivery": "worker", "reached": [{"run": "vetting-2026-10-21T09-42-38-d5fe20", "agent": "vetting", "source": "worker", "kind": "run", "delivery": "worker", "parent": null, "depth": 0, "state": "running"}, {"run": "vetting-2026-10-21T09-42-38-2e73b1", "agent": "vetting", "source": "worker", "kind": "run", "delivery": "worker", "parent": "vetting-2026-10-21T09-42-38-d5fe20", "depth": 1, "state": "running"}]}},
  "runs_429_agent": {"status": 429, "body": {"error": "rate limit: 2 runs started for tiny in the last minute, 2 allowed (run_starts_per_minute); retry in 60s", "control": "rate_limit", "scope": "agent", "limit": "run_starts_per_minute", "used": 2, "allowed": 2, "retry_after_s": 60, "agent": "tiny", "tree": "t-dccf0d813751489e", "kind": "start"}, "headers": {"retry-after": "60"}},
  "runs_429_tree": {"status": 429, "body": {"error": "rate limit: tree t-06cfd0809f264728 started or queued 2 runs in the last minute, 2 allowed (tree_per_minute); retry in 60s", "control": "rate_limit", "scope": "tree", "limit": "tree_per_minute", "used": 2, "allowed": 2, "retry_after_s": 60, "agent": "tiny", "tree": "t-06cfd0809f264728", "kind": "start"}, "headers": {"retry-after": "60"}},
  "trigger_429_agent": {"status": 429, "body": {"error": "rate limit: 1 jobs enqueued for tiny in the last minute, 1 allowed (enqueues_per_minute); retry in 60s", "control": "rate_limit", "scope": "agent", "limit": "enqueues_per_minute", "used": 1, "allowed": 1, "retry_after_s": 60, "agent": "tiny", "tree": "", "kind": "enqueue"}, "headers": {"retry-after": "60"}},
  "deps_7d": {"status": 200, "body": {"window": "7d", "since": "2026-10-14T09:42:39.106Z", "until": "2026-10-21T09:42:39.106Z", "nodes": [{"id": "agent:alpha", "kind": "agent", "label": "Tiny", "health": "ok", "declared": true, "observed": true, "count": 1, "failures": 0, "detail": ""}, {"id": "agent:beta", "kind": "agent", "label": "Tiny", "health": "ok", "declared": true, "observed": true, "count": 1, "failures": 0, "detail": ""}, {"id": "agent:casedesk", "kind": "agent", "label": "Tiny", "health": "idle", "declared": true, "observed": false, "count": 0, "failures": 0, "detail": ""}, {"id": "agent:delta", "kind": "agent", "label": "Tiny", "health": "ok", "declared": true, "observed": true, "count": 1, "failures": 0, "detail": ""}, {"id": "agent:gamma", "kind": "agent", "label": "Tiny", "health": "ok", "declared": true, "observed": true, "count": 1, "failures": 0, "detail": ""}, {"id": "agent:slashy", "kind": "agent", "label": "Tiny", "health": "idle", "declared": true, "observed": false, "count": 0, "failures": 0, "detail": ""}, {"id": "application:policy-chat", "kind": "application", "label": "Policy Chat", "health": "ok", "declared": true, "observed": true, "count": 1, "failures": 0, "detail": "chatbot"}, {"id": "connector:notify", "kind": "connector", "label": "notify", "health": "idle", "declared": true, "observed": false, "count": 0, "failures": 0, "detail": ""}, {"id": "connector:records", "kind": "connector", "label": "records", "health": "idle", "declared": true, "observed": false, "count": 0, "failures": 0, "detail": ""}, {"id": "model:gpt-4o", "kind": "model", "label": "gpt-4o", "health": "ok", "declared": true, "observed": true, "count": 2, "failures": 0, "detail": ""}, {"id": "model:gpt-4o-mini", "kind": "model", "label": "gpt-4o-mini", "health": "ok", "declared": true, "observed": true, "count": 1, "failures": 0, "detail": ""}, {"id": "model:meta/llama-3-70b", "kind": "model", "label": "meta/llama-3-70b", "health": "idle", "declared": true, "observed": false, "count": 0, "failures": 0, "detail": ""}, {"id": "peer:vendor-bot", "kind": "peer", "label": "vendor-bot", "health": "ok", "declared": true, "observed": true, "count": 1, "failures": 0, "detail": ""}, {"id": "server:casedesk", "kind": "server", "label": "Case desk", "health": "pending", "declared": true, "observed": true, "count": 3, "failures": 1, "detail": "MCP pin pending"}, {"id": "tool:casedesk.lookup", "kind": "tool", "label": "casedesk.lookup", "health": "degraded", "declared": true, "observed": true, "count": 3, "failures": 1, "detail": ""}, {"id": "tool:notify.send", "kind": "tool", "label": "notify.send", "health": "idle", "declared": true, "observed": false, "count": 0, "failures": 0, "detail": ""}, {"id": "tool:records.query", "kind": "tool", "label": "records.query", "health": "ok", "declared": true, "observed": true, "count": 1, "failures": 0, "detail": ""}], "edges": [{"from": "agent:alpha", "to": "tool:casedesk.lookup", "kind": "calls", "count": 1, "cost": 0.0, "failures": 0, "refusals": 0, "last_at": "2026-10-21T08:42:39.071Z", "declared": true, "observed": true, "evidence": "both"}, {"from": "agent:beta", "to": "tool:casedesk.lookup", "kind": "calls", "count": 1, "cost": 0.0, "failures": 1, "refusals": 0, "last_at": "2026-10-21T08:42:39.070Z", "declared": true, "observed": true, "evidence": "both"}, {"from": "agent:beta", "to": "tool:records.query", "kind": "calls", "count": 1, "cost": 0.0, "failures": 0, "refusals": 0, "last_at": "2026-10-21T08:42:39.075Z", "declared": true, "observed": true, "evidence": "both"}, {"from": "agent:casedesk", "to": "tool:casedesk.lookup", "kind": "calls", "count": 0, "cost": 0.0, "failures": 0, "refusals": 0, "last_at": null, "declared": true, "observed": false, "evidence": "declared"}, {"from": "agent:gamma", "to": "tool:casedesk.lookup", "kind": "calls", "count": 1, "cost": 0.0, "failures": 0, "refusals": 0, "last_at": "2026-10-21T09:37:39.070Z", "declared": true, "observed": true, "evidence": "both"}, {"from": "agent:gamma", "to": "tool:notify.send", "kind": "calls", "count": 0, "cost": 0.0, "failures": 0, "refusals": 0, "last_at": null, "declared": true, "observed": false, "evidence": "declared"}, {"from": "agent:delta", "to": "peer:vendor-bot", "kind": "peer", "count": 1, "cost": 0.0, "failures": 0, "refusals": 0, "last_at": "2026-10-21T09:12:38.731Z", "declared": true, "observed": true, "evidence": "both"}, {"from": "connector:notify", "to": "tool:notify.send", "kind": "serves", "count": 0, "cost": 0.0, "failures": 0, "refusals": 0, "last_at": null, "declared": true, "observed": false, "evidence": "declared"}, {"from": "connector:records", "to": "tool:records.query", "kind": "serves", "count": 0, "cost": 0.0, "failures": 0, "refusals": 0, "last_at": null, "declared": true, "observed": false, "evidence": "declared"}, {"from": "server:casedesk", "to": "tool:casedesk.lookup", "kind": "serves", "count": 3, "cost": 0.0, "failures": 1, "refusals": 0, "last_at": "2026-10-21T09:37:39.070Z", "declared": true, "observed": true, "evidence": "both"}, {"from": "agent:alpha", "to": "agent:beta", "kind": "sub_run", "count": 1, "cost": 8.4e-06, "failures": 0, "refusals": 0, "last_at": "2026-10-21T08:42:39.069Z", "declared": true, "observed": true, "evidence": "both"}, {"from": "agent:alpha", "to": "model:gpt-4o", "kind": "uses_model", "count": 1, "cost": 0.00035, "failures": 0, "refusals": 0, "last_at": "2026-10-21T08:42:39.070Z", "declared": true, "observed": true, "evidence": "both"}, {"from": "agent:beta", "to": "model:gpt-4o-mini", "kind": "uses_model", "count": 1, "cost": 8.4e-06, "failures": 0, "refusals": 0, "last_at": "2026-10-21T08:42:39.077Z", "declared": true, "observed": true, "evidence": "both"}, {"from": "agent:casedesk", "to": "model:gpt-4o", "kind": "uses_model", "count": 0, "cost": 0.0, "failures": 0, "refusals": 0, "last_at": null, "declared": true, "observed": false, "evidence": "declared"}, {"from": "agent:delta", "to": "model:gpt-4o", "kind": "uses_model", "count": 0, "cost": 0.0, "failures": 0, "refusals": 0, "last_at": null, "declared": true, "observed": false, "evidence": "declared"}, {"from": "agent:gamma", "to": "model:gpt-4o", "kind": "uses_model", "count": 0, "cost": 0.0, "failures": 0, "refusals": 0, "last_at": null, "declared": true, "observed": false, "evidence": "declared"}, {"from": "agent:slashy", "to": "model:meta/llama-3-70b", "kind": "uses_model", "count": 0, "cost": 0.0, "failures": 0, "refusals": 0, "last_at": null, "declared": true, "observed": false, "evidence": "declared"}, {"from": "application:policy-chat", "to": "model:gpt-4o", "kind": "uses_model", "count": 1, "cost": 0.0001, "failures": 0, "refusals": 0, "last_at": "2026-10-21T08:42:39.069Z", "declared": true, "observed": true, "evidence": "both"}], "counts": {"nodes": 17, "edges": 18, "seen": 10, "declared_only": 8}, "how": "edges point from what depends to what it depends on (serves: from a server to the tool it serves); declared comes from the specs, seen from the journals in the window"}},
  "deps_400": {"status": 400, "body": {"error": "window is a number and a unit: 30m, 24h, 7d", "field": "window"}},
  "deps_scoped": {"status": 200, "body": {"window": "7d", "since": "2026-10-14T09:42:39.127Z", "until": "2026-10-21T09:42:39.127Z", "nodes": [{"id": "agent:alpha", "kind": "agent", "label": "Tiny", "health": "ok", "declared": true, "observed": true, "count": 1, "failures": 0, "detail": ""}, {"id": "agent:beta", "kind": "agent", "label": "Tiny", "health": "ok", "declared": true, "observed": true, "count": 1, "failures": 0, "detail": ""}, {"id": "model:gpt-4o", "kind": "model", "label": "gpt-4o", "health": "ok", "declared": true, "observed": true, "count": 2, "failures": 0, "detail": ""}, {"id": "tool:casedesk.lookup", "kind": "tool", "label": "casedesk.lookup", "health": "degraded", "declared": true, "observed": true, "count": 3, "failures": 1, "detail": ""}], "edges": [{"from": "agent:alpha", "to": "tool:casedesk.lookup", "kind": "calls", "count": 1, "cost": 0.0, "failures": 0, "refusals": 0, "last_at": "2026-10-21T08:42:39.071Z", "declared": true, "observed": true, "evidence": "both"}, {"from": "agent:alpha", "to": "agent:beta", "kind": "sub_run", "count": 1, "cost": 8.4e-06, "failures": 0, "refusals": 0, "last_at": "2026-10-21T08:42:39.069Z", "declared": true, "observed": true, "evidence": "both"}, {"from": "agent:alpha", "to": "model:gpt-4o", "kind": "uses_model", "count": 1, "cost": 0.00035, "failures": 0, "refusals": 0, "last_at": "2026-10-21T08:42:39.070Z", "declared": true, "observed": true, "evidence": "both"}], "counts": {"nodes": 4, "edges": 3, "seen": 3, "declared_only": 0}, "how": "edges point from what depends to what it depends on (serves: from a server to the tool it serves); declared comes from the specs, seen from the journals in the window"}},
  "blast_server": {"status": 200, "body": {"node": {"id": "server:casedesk", "kind": "server", "label": "Case desk", "health": "pending", "declared": true, "observed": true, "count": 3, "failures": 1, "detail": "MCP pin pending"}, "window": "7d", "agents": [{"id": "agent:alpha", "agent": "alpha", "how": "direct", "via": ["server:casedesk", "tool:casedesk.lookup", "agent:alpha"]}, {"id": "agent:beta", "agent": "beta", "how": "direct", "via": ["server:casedesk", "tool:casedesk.lookup", "agent:beta"]}, {"id": "agent:casedesk", "agent": "casedesk", "how": "direct", "via": ["server:casedesk", "tool:casedesk.lookup", "agent:casedesk"]}, {"id": "agent:gamma", "agent": "gamma", "how": "direct", "via": ["server:casedesk", "tool:casedesk.lookup", "agent:gamma"]}], "runs_in_flight": [{"run": "gamma-r1", "agent": "gamma", "state": "running", "source": "console", "uses": "direct", "called": true}], "applications": [{"id": "alpha", "name": "Tiny", "class": "multi_agent", "source": "workflow", "via": "agent:alpha"}, {"id": "beta", "name": "Tiny", "class": "agent", "source": "workflow", "via": "agent:beta"}, {"id": "casedesk", "name": "Tiny", "class": "agent", "source": "workflow", "via": "agent:casedesk"}, {"id": "gamma", "name": "Tiny", "class": "agent", "source": "workflow", "via": "agent:gamma"}], "counts": {"direct": 4, "transitive": 0, "agents": 4, "runs_in_flight": 1, "applications": 4}, "how": "a tool fails with the server serving it; an agent fails with any tool, model, peer or sub-agent it depends on; an application fails with its models and with the agent it is. direct: reached without passing through another agent"}},
  "blast_tool_transitive": {"status": 200, "body": {"node": {"id": "tool:records.query", "kind": "tool", "label": "records.query", "health": "ok", "declared": true, "observed": true, "count": 1, "failures": 0, "detail": ""}, "window": "7d", "agents": [{"id": "agent:beta", "agent": "beta", "how": "direct", "via": ["tool:records.query", "agent:beta"]}, {"id": "agent:alpha", "agent": "alpha", "how": "transitive", "via": ["tool:records.query", "agent:beta", "agent:alpha"]}], "runs_in_flight": [], "applications": [{"id": "alpha", "name": "Tiny", "class": "multi_agent", "source": "workflow", "via": "agent:alpha"}, {"id": "beta", "name": "Tiny", "class": "agent", "source": "workflow", "via": "agent:beta"}], "counts": {"direct": 1, "transitive": 1, "agents": 2, "runs_in_flight": 0, "applications": 2}, "how": "a tool fails with the server serving it; an agent fails with any tool, model, peer or sub-agent it depends on; an application fails with its models and with the agent it is. direct: reached without passing through another agent"}},
  "blast_model_bare": {"status": 200, "body": {"node": {"id": "model:gpt-4o", "kind": "model", "label": "gpt-4o", "health": "ok", "declared": true, "observed": true, "count": 2, "failures": 0, "detail": ""}, "window": "7d", "agents": [{"id": "agent:alpha", "agent": "alpha", "how": "direct", "via": ["model:gpt-4o", "agent:alpha"]}, {"id": "agent:casedesk", "agent": "casedesk", "how": "direct", "via": ["model:gpt-4o", "agent:casedesk"]}, {"id": "agent:delta", "agent": "delta", "how": "direct", "via": ["model:gpt-4o", "agent:delta"]}, {"id": "agent:gamma", "agent": "gamma", "how": "direct", "via": ["model:gpt-4o", "agent:gamma"]}], "runs_in_flight": [{"run": "gamma-r1", "agent": "gamma", "state": "running", "source": "console", "uses": "direct", "called": false}], "applications": [{"id": "policy-chat", "name": "Policy Chat", "class": "chatbot", "source": "application", "via": "application:policy-chat"}, {"id": "alpha", "name": "Tiny", "class": "multi_agent", "source": "workflow", "via": "agent:alpha"}, {"id": "casedesk", "name": "Tiny", "class": "agent", "source": "workflow", "via": "agent:casedesk"}, {"id": "delta", "name": "Tiny", "class": "multi_agent", "source": "workflow", "via": "agent:delta"}, {"id": "gamma", "name": "Tiny", "class": "agent", "source": "workflow", "via": "agent:gamma"}], "counts": {"direct": 4, "transitive": 0, "agents": 4, "runs_in_flight": 1, "applications": 5}, "how": "a tool fails with the server serving it; an agent fails with any tool, model, peer or sub-agent it depends on; an application fails with its models and with the agent it is. direct: reached without passing through another agent"}},
  "blast_agent": {"status": 200, "body": {"node": {"id": "agent:beta", "kind": "agent", "label": "Tiny", "health": "ok", "declared": true, "observed": true, "count": 1, "failures": 0, "detail": ""}, "window": "7d", "agents": [{"id": "agent:alpha", "agent": "alpha", "how": "direct", "via": ["agent:beta", "agent:alpha"]}], "runs_in_flight": [], "applications": [{"id": "alpha", "name": "Tiny", "class": "multi_agent", "source": "workflow", "via": "agent:alpha"}, {"id": "beta", "name": "Tiny", "class": "agent", "source": "workflow", "via": "agent:beta"}], "counts": {"direct": 1, "transitive": 0, "agents": 1, "runs_in_flight": 0, "applications": 2}, "how": "a tool fails with the server serving it; an agent fails with any tool, model, peer or sub-agent it depends on; an application fails with its models and with the agent it is. direct: reached without passing through another agent"}},
  "blast_peer": {"status": 200, "body": {"node": {"id": "peer:vendor-bot", "kind": "peer", "label": "vendor-bot", "health": "ok", "declared": true, "observed": true, "count": 1, "failures": 0, "detail": ""}, "window": "7d", "agents": [{"id": "agent:delta", "agent": "delta", "how": "direct", "via": ["peer:vendor-bot", "agent:delta"]}], "runs_in_flight": [], "applications": [{"id": "delta", "name": "Tiny", "class": "multi_agent", "source": "workflow", "via": "agent:delta"}], "counts": {"direct": 1, "transitive": 0, "agents": 1, "runs_in_flight": 0, "applications": 1}, "how": "a tool fails with the server serving it; an agent fails with any tool, model, peer or sub-agent it depends on; an application fails with its models and with the agent it is. direct: reached without passing through another agent"}},
  "blast_404": {"status": 404, "body": {"error": "no node \"tool:nothing\" in the dependency map; ids are <kind>:<name>, e.g. tool:casedesk.lookup"}},
  "blast_409": {"status": 409, "body": {"error": "\"casedesk\" names 2 nodes: agent:casedesk, server:casedesk; ask by id", "candidates": ["agent:casedesk", "server:casedesk"]}},
  "blast_slash_encoded": {"status": 404, "body": {"detail": "Not Found"}},
  "blast_scoped_403": {"status": 403, "body": {"error": "this key is scoped to \"alpha\"; the blast radius reaches every agent"}},
  "drift_all": {"status": 200, "body": {"agents": [{"agent": "intake", "recent": {"since": "2026-10-20T09:42:39.196Z", "until": "2026-10-21T09:42:39.196Z", "runs": 6}, "baseline": {"since": "2026-09-20T09:42:39.196Z", "until": "2026-10-20T09:42:39.196Z", "runs": 22}, "enough": true, "says": "shifted: cost_per_run", "drifted": true, "outcome_field": null, "measures": [{"name": "disposition_mix", "kind": "mix", "statistic": "jensen_shannon", "distance": 0.0, "z": null, "threshold": 0.2, "drifted": false, "enough": true, "says": "Jensen–Shannon distance 0.000 within 0.2", "recent": {"counts": {"state:done": 6}, "shares": {"state:done": 1.0}, "n": 6}, "baseline": {"counts": {"state:done": 22}, "shares": {"state:done": 1.0}, "n": 22}, "field": "state"}, {"name": "confidence", "kind": "mean", "statistic": "welch_z", "distance": null, "z": null, "threshold": 2.0, "drifted": false, "enough": false, "says": "no run's result carries a confidence", "recent": {}, "baseline": {}, "field": null}, {"name": "cost_per_run", "kind": "mean", "statistic": "welch_z", "distance": 2.2361, "z": 2.2361, "threshold": 2.0, "drifted": true, "enough": true, "says": "z +2.24 past ±2", "recent": {"mean": 0.00325, "sd": 0.0, "n": 6}, "baseline": {"mean": 0.00325, "sd": 0.0, "n": 22}, "field": null}, {"name": "tool_mix", "kind": "mix", "statistic": "jensen_shannon", "distance": 0.0, "z": null, "threshold": 0.2, "drifted": false, "enough": true, "says": "Jensen–Shannon distance 0.000 within 0.2", "recent": {"counts": {"records.query": 6}, "shares": {"records.query": 1.0}, "n": 6}, "baseline": {"counts": {"records.query": 22}, "shares": {"records.query": 1.0}, "n": 22}, "field": null}, {"name": "refusal_rate", "kind": "rate", "statistic": "proportion_z", "distance": 0.0, "z": 0.0, "threshold": 2.0, "drifted": false, "enough": true, "says": "z +0.00 within ±2", "recent": {"rate": 0.0, "runs_with": 0, "n": 6}, "baseline": {"rate": 0.0, "runs_with": 0, "n": 22}, "field": null}]}, {"agent": "scribe", "recent": {"since": "2026-10-20T09:42:39.196Z", "until": "2026-10-21T09:42:39.196Z", "runs": 3}, "baseline": {"since": "2026-09-20T09:42:39.196Z", "until": "2026-10-20T09:42:39.196Z", "runs": 4}, "enough": false, "says": "not enough runs: 3 in the last 24 h (need 5) and 4 in the 30 days before (need 20)", "drifted": false, "outcome_field": null, "measures": []}, {"agent": "triage", "recent": {"since": "2026-10-20T09:42:39.196Z", "until": "2026-10-21T09:42:39.196Z", "runs": 8}, "baseline": {"since": "2026-09-20T09:42:39.196Z", "until": "2026-10-20T09:42:39.196Z", "runs": 24}, "enough": true, "says": "shifted: tool_mix", "drifted": true, "outcome_field": "disposition", "measures": [{"name": "disposition_mix", "kind": "mix", "statistic": "jensen_shannon", "distance": 0.0, "z": null, "threshold": 0.2, "drifted": false, "enough": true, "says": "Jensen–Shannon distance 0.000 within 0.2", "recent": {"counts": {"benign": 6, "escalate": 2}, "shares": {"benign": 0.75, "escalate": 0.25}, "n": 8}, "baseline": {"counts": {"benign": 18, "escalate": 6}, "shares": {"benign": 0.75, "escalate": 0.25}, "n": 24}, "field": "disposition"}, {"name": "confidence", "kind": "mean", "statistic": "welch_z", "distance": 0.367, "z": -0.367, "threshold": 2.0, "drifted": false, "enough": true, "says": "z -0.37 within ±2", "recent": {"mean": 0.7975, "sd": 0.01669046, "n": 8}, "baseline": {"mean": 0.8, "sd": 0.01668115, "n": 24}, "field": null}, {"name": "cost_per_run", "kind": "mean", "statistic": "welch_z", "distance": 0.0, "z": 0.0, "threshold": 2.0, "drifted": false, "enough": true, "says": "z +0.00 within ±2", "recent": {"mean": 0.003625, "sd": 0.0, "n": 8}, "baseline": {"mean": 0.003625, "sd": 0.00010426, "n": 24}, "field": null}, {"name": "tool_mix", "kind": "mix", "statistic": "jensen_shannon", "distance": 1.0, "z": null, "threshold": 0.2, "drifted": true, "enough": true, "says": "Jensen–Shannon distance 1.000 past 0.2", "recent": {"counts": {"mail.send": 8, "web.fetch": 8}, "shares": {"mail.send": 0.5, "web.fetch": 0.5}, "n": 16}, "baseline": {"counts": {"records.query": 24}, "shares": {"records.query": 1.0}, "n": 24}, "field": null}, {"name": "refusal_rate", "kind": "rate", "statistic": "proportion_z", "distance": 0.0, "z": 0.0, "threshold": 2.0, "drifted": false, "enough": true, "says": "z +0.00 within ±2", "recent": {"rate": 0.0, "runs_with": 0, "n": 8}, "baseline": {"rate": 0.0, "runs_with": 0, "n": 24}, "field": null}]}], "count": 3, "now": "2026-10-21T09:42:39.196Z", "thresholds": {"mix_js": 0.2, "mean_z": 2.0}, "min_runs": {"recent": 5, "baseline": 20}, "windows": {"recent_h": 24.0, "baseline_d": 30.0}}},
  "drift_scribe": {"status": 200, "body": {"agents": [{"agent": "scribe", "recent": {"since": "2026-10-20T09:42:39.217Z", "until": "2026-10-21T09:42:39.217Z", "runs": 3}, "baseline": {"since": "2026-09-20T09:42:39.217Z", "until": "2026-10-20T09:42:39.217Z", "runs": 4}, "enough": false, "says": "not enough runs: 3 in the last 24 h (need 5) and 4 in the 30 days before (need 20)", "drifted": false, "outcome_field": null, "measures": []}], "count": 1, "now": "2026-10-21T09:42:39.217Z", "thresholds": {"mix_js": 0.2, "mean_z": 2.0}, "min_runs": {"recent": 5, "baseline": 20}, "windows": {"recent_h": 24.0, "baseline_d": 30.0}}},
  "drift_400": {"status": 400, "body": {"error": "agent must be an agent id", "field": "agent"}},
  "guardian_default": {"status": 200, "body": {"enabled": false, "model": "", "agents": [], "may": [], "max_actions_per_hour": 10, "min_confidence": 0.8, "rubric": "", "every_entries": 5, "every_s": 15.0, "set_by": "", "set_at": "", "audit_id": null, "actions_last_hour": 0, "stats": {"evaluations": 0, "ok": 0, "acted": 0, "attention": 0, "unparseable": 0, "errors": 0, "repeated": 0, "watching": 0}}},
  "guardian_put_enable": {"status": 200, "body": {"enabled": true, "model": "gpt-4o-mini", "agents": ["vetting", "vendor-desk"], "may": ["hold", "block"], "max_actions_per_hour": 10, "min_confidence": 0.8, "rubric": "Vetting and vendor review only: never move money, never send case data outside the firm.", "every_entries": 1, "every_s": 30.0, "set_by": "Chandresh Singh", "set_at": "2026-10-21T09:42:39.230Z", "audit_id": 2, "actions_last_hour": 0, "stats": {"evaluations": 0, "ok": 0, "acted": 0, "attention": 0, "unparseable": 0, "errors": 0, "repeated": 0, "watching": 0}}},
  "guardian_put_merge": {"status": 200, "body": {"enabled": true, "model": "gpt-4o-mini", "agents": ["vetting", "vendor-desk"], "may": ["hold"], "max_actions_per_hour": 10, "min_confidence": 0.8, "rubric": "Vetting and vendor review only: never move money, never send case data outside the firm.", "every_entries": 1, "every_s": 30.0, "set_by": "Chandresh Singh", "set_at": "2026-10-21T09:42:39.275Z", "audit_id": 10, "actions_last_hour": 2, "stats": {"evaluations": 2, "ok": 0, "acted": 2, "attention": 0, "unparseable": 0, "errors": 0, "repeated": 0, "watching": 1}}},
  "guardian_put_floor": {"status": 200, "body": {"enabled": true, "model": "gpt-4o-mini", "agents": ["vetting", "vendor-desk"], "may": ["hold"], "max_actions_per_hour": 10, "min_confidence": 0.99, "rubric": "Vetting and vendor review only: never move money, never send case data outside the firm.", "every_entries": 1, "every_s": 30.0, "set_by": "Chandresh Singh", "set_at": "2026-10-21T09:42:39.280Z", "audit_id": 14, "actions_last_hour": 2, "stats": {"evaluations": 3, "ok": 0, "acted": 2, "attention": 1, "unparseable": 0, "errors": 0, "repeated": 0, "watching": 2}}},
  "guardian_after": {"status": 200, "body": {"enabled": true, "model": "gpt-4o-mini", "agents": ["vetting", "vendor-desk"], "may": ["hold"], "max_actions_per_hour": 10, "min_confidence": 0.99, "rubric": "Vetting and vendor review only: never move money, never send case data outside the firm.", "every_entries": 1, "every_s": 30.0, "set_by": "Chandresh Singh", "set_at": "2026-10-21T09:42:39.280Z", "audit_id": 14, "actions_last_hour": 2, "stats": {"evaluations": 4, "ok": 0, "acted": 2, "attention": 2, "unparseable": 0, "errors": 0, "repeated": 0, "watching": 3}}},
  "guardian_actions": {"status": 200, "body": {"actions": [{"id": "g-f3679f23a6fb4eba", "at": "2026-10-21T09:42:39.284Z", "run": "vendor-desk-g3", "agent": "vendor-desk", "verdict": "hold", "confidence": 0.9, "reason": "the run is moving money, which vetting never does", "model": "gpt-4o-mini", "action": "hold", "outcome": "attention", "why": "confidence 0.90 is under the minimum of 0.99", "entries": 1, "source": "sdk"}, {"id": "g-4c15fdb1c6e441f6", "at": "2026-10-21T09:42:39.279Z", "run": "vendor-desk-g2", "agent": "vendor-desk", "verdict": "block", "confidence": 0.95, "reason": "it is sending case data to an outside address", "model": "gpt-4o-mini", "action": "block", "outcome": "attention", "why": "block is not among what the guardian may do (may: hold)", "entries": 1, "source": "sdk"}, {"id": "g-35e77e2ecd7b47f0", "at": "2026-10-21T09:42:39.271Z", "run": "vendor-desk-g1", "agent": "vendor-desk", "verdict": "block", "confidence": 0.95, "reason": "it is sending case data to an outside address", "model": "gpt-4o-mini", "action": "block", "outcome": "acted", "why": "", "entries": 1, "source": "sdk"}, {"id": "g-f36f7d69118d4bb3", "at": "2026-10-21T09:42:39.255Z", "run": "vetting-2026-10-21T09-42-39-807795", "agent": "vetting", "verdict": "hold", "confidence": 0.9, "reason": "the run is moving money, which vetting never does", "model": "gpt-4o-mini", "action": "hold", "outcome": "acted", "why": "", "entries": 2, "source": "worker"}], "count": 4}},
  "guardian_actions_run": {"status": 200, "body": {"actions": [{"id": "g-35e77e2ecd7b47f0", "at": "2026-10-21T09:42:39.271Z", "run": "vendor-desk-g1", "agent": "vendor-desk", "verdict": "block", "confidence": 0.95, "reason": "it is sending case data to an outside address", "model": "gpt-4o-mini", "action": "block", "outcome": "acted", "why": "", "entries": 1, "source": "sdk"}], "count": 1}},
  "guardian_actions_400": {"status": 400, "body": {"error": "run must be a run id"}},
  "guardian_put_400": {"status": 400, "body": {"error": "bad request: body.min_confidence: Input should be less than or equal to 1"}},
  "guardian_put_400_agents": {"status": 400, "body": {"error": "bad request: body.agents: Value error, agents: 'Not An Id' is not an agent id"}},
  "guardian_put_403": {"status": 403, "body": {"error": "this needs the \"configure\" permission; your roles: none"}},
  "guardian_put_all_agents": {"status": 200, "body": {"enabled": true, "model": "gpt-4o-mini", "agents": "*", "may": ["hold"], "max_actions_per_hour": 10, "min_confidence": 0.99, "rubric": "Vetting and vendor review only: never move money, never send case data outside the firm.", "every_entries": 1, "every_s": 30.0, "set_by": "Chandresh Singh", "set_at": "2026-10-21T09:42:39.291Z", "audit_id": 21, "actions_last_hour": 2, "stats": {"evaluations": 4, "ok": 0, "acted": 2, "attention": 2, "unparseable": 0, "errors": 0, "repeated": 0, "watching": 3}}},
  "worker_heartbeat_after_hold": {"status": 200, "body": {"job": "807795ff-2be1-4f79-a25d-1a2716f68471", "status": "running", "lease_until": "2026-10-21T10:02:39.256Z", "kill": null, "steer": {"guidance": null, "hold_at_next_gate": true, "model": null, "by": "guardian", "at": "2026-10-21T09:42:39.255Z"}, "lockdown": false}},
  "sdk_control_after_block": {"status": 200, "body": {"kill": {"reason": "guardian: it is sending case data to an outside address", "by": "guardian", "at": "2026-10-21T09:42:39.261Z"}, "answer": null, "steer": null}},
  "run_held_by_guardian": {"status": 200, "body": {"id": "vetting-2026-10-21T09-42-39-807795", "system": "vetting", "state": "running", "kill": null, "trace_id": "t-5f89ed561af54821", "journal": {"entries": [{"t": 0, "kind": "run.start", "node": "", "title": "run.start", "detail": "", "data": {}, "because": [], "id": "w0", "tainted": false}, {"t": 1, "kind": "tool.call", "node": "decide", "title": "payments.transfer", "detail": "", "data": {"tool": "payments.transfer", "args": {"amount": 9000, "to": "acct-77"}}, "because": [], "id": "w1", "tainted": false}, {"t": 1, "kind": "note", "node": "", "title": "Guardian: held at the next gate", "detail": "the run is moving money, which vetting never does", "data": {"control": "guardian", "verdict": "hold", "action": "hold", "model": "gpt-4o-mini", "confidence": 0.9, "reason": "the run is moving money, which vetting never does", "by": "guardian", "delivery": "worker"}, "because": [], "id": "4c579acb25e0", "tainted": false}]}}},
  "run_blocked_by_guardian": {"status": 200, "body": {"id": "vendor-desk-g1", "system": "vendor-desk", "state": "running", "kill": {"reason": "guardian: it is sending case data to an outside address", "by": "guardian", "at": "2026-10-21T09:42:39.261Z"}, "trace_id": "t-e881e5b41bc842ad", "reported_by": {"mode": "sdk", "protocol": "live", "key": "af_sdk_vend", "opened_at": "2026-10-21T09:42:39.258Z"}, "journal": {"entries": [{"t": 1, "kind": "tool.call", "node": "act", "title": "mail.send", "detail": "", "data": {"tool": "mail.send", "args": {"to": "drop@outside.example", "body": "case 42"}}, "because": [], "id": "a1", "tainted": false}, {"t": 1, "kind": "note", "node": "", "title": "Guardian: blocked the run", "detail": "it is sending case data to an outside address", "data": {"control": "guardian", "verdict": "block", "action": "block", "model": "gpt-4o-mini", "confidence": 0.95, "reason": "it is sending case data to an outside address", "by": "guardian", "delivery": "sdk"}, "because": [], "id": "507ccc4d8834", "tainted": false}]}}},
  "attention_l7": {"status": 200, "body": {"items": [{"id": "side_channel:clerk:scribe:2026-10-20", "kind": "side_channel", "severity": 6, "age_s": 70959.3, "rank": 10.93, "title": "clerk read what scribe wrote: two agents coordinating through a shared store", "detail": "1 read on 2026-10-20, 1 refused, a tainted value crossed; keys case/42; written in scribe-r1, read in clerk-sub-0a1b2c3d4e", "agent": "clerk", "run": "clerk-sub-0a1b2c3d4e", "job": "", "since": "2026-10-20T14:00:00Z", "deadline": null, "holds": "", "action": {"method": "GET", "path": "/api/runs/clerk-sub-0a1b2c3d4e", "body": null, "says": "review both runs; if the coordination is not by design, set policy.memory.cross_agent to refuse on the reader's spec"}, "agents": ["scribe", "clerk"], "runs": ["scribe-r1", "clerk-sub-0a1b2c3d4e"], "data": {"day": "2026-10-20", "writer": {"agent": "scribe", "run": "scribe-r1"}, "reader": {"agent": "clerk", "run": "clerk-sub-0a1b2c3d4e"}, "reads": 1, "refused": 1, "tainted": true, "keys": ["case/42"], "both_ways": false}}, {"id": "side_channel:reader:scribe:2026-10-20", "kind": "side_channel", "severity": 5, "age_s": 77559.3, "rank": 9.49, "title": "reader read what scribe wrote: two agents coordinating through a shared store", "detail": "3 reads on 2026-10-20; keys case/42, case/43 (both ways); written in scribe-r1, read in reader-r1", "agent": "reader", "run": "reader-r1", "job": "", "since": "2026-10-20T12:10:00Z", "deadline": null, "holds": "", "action": {"method": "GET", "path": "/api/runs/reader-r1", "body": null, "says": "review both runs; if the coordination is not by design, set policy.memory.cross_agent to refuse on the reader's spec"}, "agents": ["scribe", "reader"], "runs": ["scribe-r1", "reader-r1", "scribe-r2"], "data": {"day": "2026-10-20", "writer": {"agent": "scribe", "run": "scribe-r1"}, "reader": {"agent": "reader", "run": "reader-r1"}, "reads": 3, "refused": 0, "tainted": false, "keys": ["case/42", "case/43"], "both_ways": true}}, {"id": "guardian:g-35e77e2ecd7b47f0", "kind": "guardian", "severity": 8, "age_s": 0.0, "rank": 8.0, "title": "vendor-desk: the guardian blocked run vendor-desk-g1", "detail": "it is sending case data to an outside address (confidence 0.95, gpt-4o-mini)", "agent": "vendor-desk", "run": "vendor-desk-g1", "job": "", "since": "2026-10-21T09:42:39Z", "deadline": null, "holds": "", "action": {"method": "GET", "path": "/api/runs/vendor-desk-g1", "body": null, "says": "review the run the guardian stopped, and its reason"}, "agents": ["vendor-desk"], "runs": ["vendor-desk-g1"], "data": {"verdict": "block", "confidence": 0.95, "reason": "it is sending case data to an outside address", "model": "gpt-4o-mini", "action": "block", "outcome": "acted", "why": ""}}, {"id": "guardian:g-4c15fdb1c6e441f6", "kind": "guardian", "severity": 7, "age_s": 0.0, "rank": 7.0, "title": "vendor-desk: the guardian would block run vendor-desk-g2", "detail": "it is sending case data to an outside address (confidence 0.95, gpt-4o-mini); not acted on: block is not among what the guardian may do (may: hold)", "agent": "vendor-desk", "run": "vendor-desk-g2", "job": "", "since": "2026-10-21T09:42:39Z", "deadline": null, "holds": "", "action": {"method": "POST", "path": "/api/runs/vendor-desk-g2/kill", "body": {"reason": "guardian: it is sending case data to an outside address"}, "says": "the guardian did not act (block is not among what the guardian may do (may: hold)): kill the run if you agree"}, "agents": ["vendor-desk"], "runs": ["vendor-desk-g2"], "data": {"verdict": "block", "confidence": 0.95, "reason": "it is sending case data to an outside address", "model": "gpt-4o-mini", "action": "block", "outcome": "attention", "why": "block is not among what the guardian may do (may: hold)"}}, {"id": "guardian:g-f3679f23a6fb4eba", "kind": "guardian", "severity": 7, "age_s": 0.0, "rank": 7.0, "title": "vendor-desk: the guardian would hold run vendor-desk-g3", "detail": "the run is moving money, which vetting never does (confidence 0.90, gpt-4o-mini); not acted on: confidence 0.90 is under the minimum of 0.99", "agent": "vendor-desk", "run": "vendor-desk-g3", "job": "", "since": "2026-10-21T09:42:39Z", "deadline": null, "holds": "", "action": {"method": "POST", "path": "/api/runs/vendor-desk-g3/steer", "body": {"hold_at_next_gate": true}, "says": "the guardian did not act (confidence 0.90 is under the minimum of 0.99): hold the run at its next gate if you agree"}, "agents": ["vendor-desk"], "runs": ["vendor-desk-g3"], "data": {"verdict": "hold", "confidence": 0.9, "reason": "the run is moving money, which vetting never does", "model": "gpt-4o-mini", "action": "hold", "outcome": "attention", "why": "confidence 0.90 is under the minimum of 0.99"}}, {"id": "guardian:g-f36f7d69118d4bb3", "kind": "guardian", "severity": 7, "age_s": 0.0, "rank": 7.0, "title": "vetting: the guardian held run vetting-2026-10-21T09-42-39-807795 at its next gate", "detail": "the run is moving money, which vetting never does (confidence 0.90, gpt-4o-mini)", "agent": "vetting", "run": "vetting-2026-10-21T09-42-39-807795", "job": "", "since": "2026-10-21T09:42:39Z", "deadline": null, "holds": "", "action": {"method": "GET", "path": "/api/approvals", "body": null, "says": "the run waits for a person at its next call at or above write: answer it in the inbox"}, "agents": ["vetting"], "runs": ["vetting-2026-10-21T09-42-39-807795"], "data": {"verdict": "hold", "confidence": 0.9, "reason": "the run is moving money, which vetting never does", "model": "gpt-4o-mini", "action": "hold", "outcome": "acted", "why": ""}}, {"id": "refusal:intake-refused-1", "kind": "refusal", "severity": 6, "age_s": 0.0, "rank": 6.0, "title": "intake: a refusal stopped run intake-refused-1", "detail": "egress: refused", "agent": "intake", "run": "intake-refused-1", "job": "", "since": "2026-10-21T09:42:39Z", "deadline": null, "holds": "", "action": {"method": "POST", "path": "/api/runs", "body": {"agent": "intake", "input": {}}, "says": "review the refusal on the journal (GET /api/runs/{id}); start the run again once the policy or the input is right"}, "agents": [], "runs": [], "data": null}, {"id": "drift:intake", "kind": "drift", "severity": 5, "age_s": 0.0, "rank": 5.0, "title": "intake: drift in disposition_mix", "detail": "disposition_mix Jensen–Shannon distance 0.275 past 0.2 (7 runs in the last day against 22 before)", "agent": "intake", "run": "", "job": "", "since": "2026-10-20T09:42:39.292Z", "deadline": null, "holds": "", "action": {"method": "GET", "path": "/api/drift?agent=intake", "body": null, "says": "see what moved against the baseline; review the recent runs, and the spec or the model if the shift is not the world's"}, "agents": ["intake"], "runs": [], "data": {"measures": [{"name": "disposition_mix", "kind": "mix", "statistic": "jensen_shannon", "distance": 0.2746, "z": null, "threshold": 0.2, "drifted": true, "enough": true, "says": "Jensen–Shannon distance 0.275 past 0.2", "recent": {"counts": {"state:done": 6, "state:failed": 1}, "shares": {"state:done": 0.8571, "state:failed": 0.1429}, "n": 7}, "baseline": {"counts": {"state:done": 22}, "shares": {"state:done": 1.0}, "n": 22}, "field": "state"}], "recent": {"since": "2026-10-20T09:42:39.292Z", "until": "2026-10-21T09:42:39.292Z", "runs": 7}, "baseline": {"since": "2026-09-20T09:42:39.292Z", "until": "2026-10-20T09:42:39.292Z", "runs": 22}, "outcome_field": null}}, {"id": "drift:triage", "kind": "drift", "severity": 5, "age_s": 0.0, "rank": 5.0, "title": "triage: drift in tool_mix", "detail": "tool_mix Jensen–Shannon distance 1.000 past 0.2 (8 runs in the last day against 24 before)", "agent": "triage", "run": "", "job": "", "since": "2026-10-20T09:42:39.292Z", "deadline": null, "holds": "", "action": {"method": "GET", "path": "/api/drift?agent=triage", "body": null, "says": "see what moved against the baseline; review the recent runs, and the spec or the model if the shift is not the world's"}, "agents": ["triage"], "runs": [], "data": {"measures": [{"name": "tool_mix", "kind": "mix", "statistic": "jensen_shannon", "distance": 1.0, "z": null, "threshold": 0.2, "drifted": true, "enough": true, "says": "Jensen–Shannon distance 1.000 past 0.2", "recent": {"counts": {"mail.send": 8, "web.fetch": 8}, "shares": {"mail.send": 0.5, "web.fetch": 0.5}, "n": 16}, "baseline": {"counts": {"records.query": 24}, "shares": {"records.query": 1.0}, "n": 24}, "field": null}], "recent": {"since": "2026-10-20T09:42:39.292Z", "until": "2026-10-21T09:42:39.292Z", "runs": 8}, "baseline": {"since": "2026-09-20T09:42:39.292Z", "until": "2026-10-20T09:42:39.292Z", "runs": 24}, "outcome_field": "disposition"}}], "count": 9, "how": "rank = severity × (1 + min(age in hours, 48) / 24); each item carries the action that clears it"}},
  "attention_scoped_clerk": {"status": 200, "body": {"items": [{"id": "side_channel:clerk:scribe:2026-10-20", "kind": "side_channel", "severity": 6, "age_s": 70959.3, "rank": 10.93, "title": "clerk read what scribe wrote: two agents coordinating through a shared store", "detail": "1 read on 2026-10-20, 1 refused, a tainted value crossed; keys case/42; written in scribe-r1, read in clerk-sub-0a1b2c3d4e", "agent": "clerk", "run": "clerk-sub-0a1b2c3d4e", "job": "", "since": "2026-10-20T14:00:00Z", "deadline": null, "holds": "", "action": {"method": "GET", "path": "/api/runs/clerk-sub-0a1b2c3d4e", "body": null, "says": "review both runs; if the coordination is not by design, set policy.memory.cross_agent to refuse on the reader's spec"}, "agents": ["scribe", "clerk"], "runs": ["scribe-r1", "clerk-sub-0a1b2c3d4e"], "data": {"day": "2026-10-20", "writer": {"agent": "scribe", "run": "scribe-r1"}, "reader": {"agent": "clerk", "run": "clerk-sub-0a1b2c3d4e"}, "reads": 1, "refused": 1, "tainted": true, "keys": ["case/42"], "both_ways": false}}], "count": 1, "how": "rank = severity × (1 + min(age in hours, 48) / 24); each item carries the action that clears it"}},
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

const ROOT = "triage-2026-10-21T09-42-38-plh8";
const SUB1 = "casework-sub-090b0241b6";
const SUB2 = "casework-sub-deecd878e9";
const CHILD = "vetting-2026-10-21T09-42-38-5c24d5";
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
    expect(t).toMatchObject({ root: ROOT, asked: ROOT, trace_id: "t-206d2951bdaf41a2", count: 7, truncated: false });
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
    expect(by[ROOT]).toMatchObject({ cost: 0, tokens: 0, tool_calls: 2, refusals: 0, started_at: "2026-10-21T09:42:38.741Z", finished_at: "2026-10-21T09:42:38.749Z" });
    // A sub-run has no clock of its own, and its refusal (delegation only narrows) is its own.
    expect(by[SUB1]).toMatchObject({ cost: 0.000175, tokens: 55, tool_calls: 0, refusals: 1, started_at: null, finished_at: null });
    expect(by[SUB1].error).toContain("delegation: records.write is granted by this agent's spec but not by 'triage'");
    expect(by[CHILD]).toMatchObject({ cost: 0.0035, tokens: 1100, tool_calls: 1, refusals: 1 });
    // The peer's call was counted where it was made; its leaf counts zero and carries the call.
    expect(by[PEER]).toMatchObject({ cost: 0, tool_calls: 0, agent: "vendor-bot" });
    expect(by[PEER].peer).toEqual({ name: "vendor-bot", task_id: "t-77", state: "submitted", calls: 1, refused: 0, failed: 0, tools: ["peer.send"], replied: false });
    // Totals: each node and everything under it; the root's is the rollup.
    expect(by[ROOT].total).toEqual({ cost: 0.00385, tokens: 1210, tool_calls: 3, refusals: 3 });
    expect(by[CHILD].total).toEqual({ cost: 0.0035, tokens: 1100, tool_calls: 1, refusals: 1 });
    expect(t.rollup).toMatchObject({ cost: 0.00385, tokens: 1210, tool_calls: 3, refusals: 3 });
    expect(t.rollup.by_agent.casework).toEqual({ cost: 0.00035, tokens: 110, tool_calls: 0, refusals: 2, nodes: 2 });
    expect(t.rollup.by_agent["peer:vendor-bot"]).toEqual({ cost: 0, tokens: 0, tool_calls: 0, refusals: 0, nodes: 1 });
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
    expect(text).toContain("Rolled up to the orchestrator $0.0039 · 1.2k tokens · 3 tool calls · 3 refusals 3 refusals: 2 in sub-runs, 1 in a child run");
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
    const live = await l7.getRunTree("triage-2026-10-21T09-42-38-425z");
    expect(inFlightNodes(live).map((n) => [n.run, n.kind])).toEqual([
      ["triage-2026-10-21T09-42-38-425z", "run"],
      ["casework-sub-fe87936cdf", "sub_run"],
      ["vendor-desk-k1", "run"],
      ["vetting-2026-10-21T09-42-38-125e07", "run"],
      ["vendor-desk-k2", "run"],
    ]);
    const after = await l7.getRunTree("triage-2026-10-21T09-42-38-425z");
    const by = Object.fromEntries(after.nodes.map((n) => [n.run, n]));
    expect([by["triage-2026-10-21T09-42-38-425z"].state, by["triage-2026-10-21T09-42-38-425z"].error]).toEqual(["killed", "killed by operator: runaway tree"]);
    expect(by["casework-sub-fe87936cdf"].state).toBe("killed");
    expect(by["casework-sub-fe87936cdf"].error).toMatch(/^runaway tree; whatever was in flight was abandoned/);
    // The children take the kill where they run; until they do, they are what a second kill reaches.
    expect(inFlightNodes(after).map((n) => n.run)).toEqual(["vendor-desk-k1", "vetting-2026-10-21T09-42-38-125e07", "vendor-desk-k2"]);
  });

  it("a fan-out past the tree's rate limit: the refusals are the orchestrator's own", async () => {
    serve("tree_rate_limited_fanout");
    const t = await l7.getRunTree("sweep-2026-10-21T09-42-39-cazj");
    expect(t.nodes.map((n) => n.kind)).toEqual(["run", "sub_run", "sub_run"]);
    expect(refusalLine(t)).toBe("2 refusals in the orchestrator");
  });

  it("a child enqueued on the trigger door names its parent and joins its trace", () => {
    expect(fx("trigger_child_202").body).toMatchObject({ parent_run: ROOT, trace_id: "t-206d2951bdaf41a2", status: "queued" });
  });
});

const KROOT = "triage-2026-10-21T09-42-38-425z";

describe("POST /api/runs/{id}/kill reaches the tree", () => {
  it("202: the run in-process, its sub-run on its cancel, its children where they run, a queued child dead-lettered", async () => {
    const calls = serve("kill_tree_202");
    const r = await l7.killRun(KROOT, "runaway tree");
    expect(calls).toEqual([{ url: `/api/runs/${KROOT}/kill`, method: "POST", body: { reason: "runaway tree" } }]);
    expect(r).toMatchObject({ run: KROOT, state: "running", delivery: "in-process", kill: { reason: "runaway tree", by: "Chandresh Singh", at: "2026-10-21T09:42:38.902Z" } });
    expect(r.reached.map((x) => [x.run, x.kind, x.delivery, x.parent, x.depth, x.state])).toEqual([
      [KROOT, "run", "in-process", null, 0, "running"],
      ["casework-sub-fe87936cdf", "sub_run", "shared-cancel", KROOT, 1, "running"],
      ["f2e56509-96f1-4045-9143-78b36b6ed389", "job", "queue", KROOT, 1, "queued"],
      ["vendor-desk-k1", "run", "sdk", KROOT, 1, "running"],
      ["vetting-2026-10-21T09-42-38-125e07", "run", "worker", KROOT, 1, "running"],
      ["vendor-desk-k2", "run", "sdk", "vetting-2026-10-21T09-42-38-125e07", 2, "running"],
    ]);
    expect(reachedGroups(r).map((g) => [g.delivery, g.runs.map((x) => x.run)])).toEqual([
      ["in-process", [KROOT]],
      ["shared-cancel", ["casework-sub-fe87936cdf"]],
      ["worker", ["vetting-2026-10-21T09-42-38-125e07"]],
      ["sdk", ["vendor-desk-k1", "vendor-desk-k2"]],
      ["queue", ["f2e56509-96f1-4045-9143-78b36b6ed389"]],
    ]);
    expect(killSummary(r)).toBe(
      "Kill requested by Chandresh Singh: the run stopped here; 1 sub-run on its cancel, 1 worker run on its next heartbeat, 2 SDK runs on their next control poll, 1 queued job dead-lettered.",
    );
    // The receipt the Runs page shows: every run reached, how, and a link only for a record.
    const html = renderToStaticMarkup(createElement(KillReceiptView, { receipt: r }));
    const text = textOf(html);
    expect(text).toContain("Kill reached 6");
    for (const s of ["an in-process sub-run, stopped with the run it runs in", "a queued child job: dead-lettered, so it never starts", "an attached agent's run: its SDK takes the kill on its next control poll", "a worker's run: the kill waits on its row and lands on its next heartbeat", "job f2e56509-96f1-4045-9143-78b36b6ed389", "reason: runaway tree"]) expect(text, s).toContain(s);
    expect(hrefs(html).sort()).toEqual([KROOT, "vendor-desk-k1", "vendor-desk-k2", "vetting-2026-10-21T09-42-38-125e07"].map((x) => `/runs?id=${x}`).sort());
  });

  it("the run itself over, its tree not: 202 delivered `tree`; once nothing is in flight, 409", async () => {
    serve("kill_tree_delivery_tree", "kill_409");
    const r = await l7.killRun(KROOT, "again");
    expect([r.delivery, r.state, r.reached.map((x) => x.run)]).toEqual(["tree", "killed", ["vendor-desk-k1", "vetting-2026-10-21T09-42-38-125e07", "vendor-desk-k2"]]);
    expect(killSummary(r)).toBe("The run itself had already ended (killed); the kill by Chandresh Singh reached what it set off: 1 worker run on its next heartbeat, 2 SDK runs on their next control poll.");
    const e = await refused(l7.killRun(KROOT, "third"));
    expect([e.status, e.message]).toEqual([409, `run "${KROOT}" is killed, not in flight`]);
  });

  it("a worker's run: delivered on its heartbeat, with its child by parent link", async () => {
    serve("kill_worker_202");
    const r = await l7.killRun("vetting-2026-10-21T09-42-38-d5fe20", "stop both");
    expect([r.delivery, r.reached.map((x) => [x.run, x.delivery, x.depth])]).toEqual([
      "worker",
      [
        ["vetting-2026-10-21T09-42-38-d5fe20", "worker", 0],
        ["vetting-2026-10-21T09-42-38-2e73b1", "worker", 1],
      ],
    ]);
    expect(killSummary(r)).toBe("Kill requested by Chandresh Singh: the run on its worker's next heartbeat; 1 worker run on its next heartbeat.");
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
      tree: "t-dccf0d813751489e",
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
    expect([rl.scope, rl.limit, rl.used, rl.allowed, rl.tree]).toEqual(["tree", "tree_per_minute", 2, 2, "t-06cfd0809f264728"]);
    expect(rateLimitText(rl)).toBe("Rate limited for the tree t-06cfd0809f264728: runs, sub-runs and jobs per minute in one tree, 2 used of 2 allowed (tree_per_minute). Retry in 1 min.");
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

  it("the platform MCP server's trigger_workflow says the limit first, with when to try again", async () => {
    const calls = serve("trigger_429_agent");
    const out = JSON.parse(await runTool("http://console.test", "trigger_workflow", { workflow: "tiny", input: { case: "2" } }, "Bearer af_key"));
    expect(calls[0]).toMatchObject({ url: "http://console.test/api/trigger/tiny", method: "POST", body: { input: { case: "2" }, source: "mcp" } });
    expect(out).toMatchObject({
      rate_limited: "Rate limited for agent tiny: jobs queued per minute, 1 used of 1 allowed (enqueues_per_minute). Retry in 1 min.",
      retry_after_s: 60,
      control: "rate_limit",
      scope: "agent",
    });
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
    expect([m.window, m.counts]).toEqual(["7d", { nodes: 17, edges: 18, seen: 10, declared_only: 8 }]);
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

  it("refusals: 404, 409 with its candidates, 403 for a key scoped to one agent; a slash in the id is never sent", async () => {
    serve("blast_404", "blast_409", "blast_scoped_403");
    const e404 = await refused(l7.getBlastRadius("tool:nothing"));
    expect(blastRefusalText(e404.status, e404.message)).toBe('no node "tool:nothing" in the dependency map; ids are <kind>:<name>, e.g. tool:casedesk.lookup. The map may have moved since it was read; read it again.');
    const e409 = await refused(l7.getBlastRadius("casedesk"));
    expect([e409.status, l7.candidatesOf(e409)]).toEqual([409, ["agent:casedesk", "server:casedesk"]]);
    const e403 = await refused(l7.getBlastRadius("server:casedesk"));
    expect(e403.message).toBe('this key is scoped to "alpha"; the blast radius reaches every agent');
    expect(blastRefusalText(403, e403.message)).toMatch(/^A blast radius reaches every agent, so a key scoped to one agent cannot ask for it\./);
    // The router decodes %2F before it routes: the door never answers for such an id (a bare 404, not the door's).
    expect(fx("blast_slash_encoded")).toEqual({ status: 404, body: { detail: "Not Found" } });
    expect(blastAsk("model:meta/llama-3-70b")).toMatchObject({ ok: false });
    expect(blastAsk("server:casedesk")).toEqual({ ok: true });
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
    expect(orderDrift(r.agents).map((a) => [a.agent, a.drifted, a.enough])).toEqual([["intake", true, true], ["triage", true, true], ["scribe", false, false]]);
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

  it("identical costs in both windows read past ±2 (the backend's z on floating-point noise): both means are shown, so a reader sees it", async () => {
    const { measure } = await drift();
    const cost = measure("intake", "cost_per_run");
    expect([cost.drifted, cost.z, statText(cost)]).toEqual([true, 2.2361, "z +2.24"]);
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

describe("the guardian", () => {
  const RUBRIC = "Vetting and vendor review only: never move money, never send case data outside the firm.";

  it("off by default: no agents, may nothing, 10 acts an hour, confidence 0.8, every 5 entries or 15 s", async () => {
    serve("guardian_default");
    const v = await l7.getGuardian();
    expect(v).toEqual({
      enabled: false,
      model: "",
      agents: [],
      may: [],
      max_actions_per_hour: 10,
      min_confidence: 0.8,
      rubric: "",
      every_entries: 5,
      every_s: 15,
      set_by: "",
      set_at: "",
      audit_id: null,
      actions_last_hour: 0,
      stats: { evaluations: 0, ok: 0, acted: 0, attention: 0, unparseable: 0, errors: 0, repeated: 0, watching: 0 },
    });
  });

  it("a PUT sends only what changed, and the door merges: each answer is the whole view, with its audit event", async () => {
    serve("guardian_default");
    const v0 = await l7.getGuardian();
    const f0 = { ...formOf(v0), enabled: true, agents: ["vetting", "vendor-desk"], hold: true, block: true, model: "gpt-4o-mini", rubric: RUBRIC, every_entries: "1", every_s: "30" };
    const p0 = patchOf(v0, f0);
    expect(p0).toEqual({ enabled: true, model: "gpt-4o-mini", agents: ["vetting", "vendor-desk"], may: ["hold", "block"], rubric: RUBRIC, every_entries: 1, every_s: 30 });
    let calls = serve("guardian_put_enable");
    const v1 = await l7.setGuardian(p0);
    expect(calls).toEqual([{ url: "/api/guardian", method: "PUT", body: p0 }]);
    expect(v1).toMatchObject({ enabled: true, agents: ["vetting", "vendor-desk"], may: ["hold", "block"], model: "gpt-4o-mini", every_entries: 1, every_s: 30, set_by: "Chandresh Singh", audit_id: 2 });
    // It may only hold now: one field sent, the rest kept.
    const p1 = patchOf(v1, { ...formOf(v1), block: false });
    expect(p1).toEqual({ may: ["hold"] });
    calls = serve("guardian_put_merge");
    const v2 = await l7.setGuardian(p1);
    expect(calls[0].body).toEqual({ may: ["hold"] });
    expect(v2).toMatchObject({ may: ["hold"], rubric: RUBRIC, agents: ["vetting", "vendor-desk"], audit_id: 10, actions_last_hour: 2, stats: { evaluations: 2, acted: 2, watching: 1 } });
    const p2 = patchOf(v2, { ...formOf(v2), min_confidence: "0.99" });
    expect(p2).toEqual({ min_confidence: 0.99 });
    serve("guardian_put_floor");
    const v3 = await l7.setGuardian(p2);
    expect([v3.min_confidence, v3.audit_id]).toEqual([0.99, 14]);
    const p3 = patchOf(v3, { ...formOf(v3), allAgents: true });
    expect(p3).toEqual({ agents: "*" });
    serve("guardian_put_all_agents");
    expect((await l7.setGuardian(p3)).agents).toBe("*");
    // An untouched form sends nothing.
    expect(patchOf(v3, formOf(v3))).toEqual({});
  });

  it("what a person may not set: 400 in the door's words, caught by the form first; a machine key: 403", async () => {
    serve("guardian_put_400", "guardian_put_400_agents", "guardian_put_403");
    const e1 = await refused(l7.setGuardian({ min_confidence: 2 }));
    expect([e1.status, e1.message]).toEqual([400, "bad request: body.min_confidence: Input should be less than or equal to 1"]);
    const e2 = await refused(l7.setGuardian({ agents: ["Not An Id"] }));
    expect(e2.message).toBe("bad request: body.agents: Value error, agents: 'Not An Id' is not an agent id");
    const e3 = await refused(l7.setGuardian({ enabled: true }));
    expect([e3.status, e3.message]).toEqual([403, 'this needs the "configure" permission; your roles: none']);
  });

  it("what it did: acted or raised for a person, and why, newest first, each run linked", async () => {
    serve("guardian_actions", "guardian_after");
    const { actions, count } = await l7.listGuardianActions({ limit: 200 });
    expect(count).toBe(4);
    expect(actions.map((a) => [a.run, a.verdict, a.confidence, a.action, a.outcome, a.why, a.source, a.model])).toEqual([
      ["vendor-desk-g3", "hold", 0.9, "hold", "attention", "confidence 0.90 is under the minimum of 0.99", "sdk", "gpt-4o-mini"],
      ["vendor-desk-g2", "block", 0.95, "block", "attention", "block is not among what the guardian may do (may: hold)", "sdk", "gpt-4o-mini"],
      ["vendor-desk-g1", "block", 0.95, "block", "acted", "", "sdk", "gpt-4o-mini"],
      ["vetting-2026-10-21T09-42-39-807795", "hold", 0.9, "hold", "acted", "", "worker", "gpt-4o-mini"],
    ]);
    expect(actions.map(outcomeText)).toEqual([
      "Raised for a person: it would hold the run, but confidence 0.90 is under the minimum of 0.99",
      "Raised for a person: it would block the run, but block is not among what the guardian may do (may: hold)",
      "Blocked: the run and what it set off were killed",
      "Held: the run waits for a person at its next gate",
    ]);
    const html = renderToStaticMarkup(createElement(GuardianActionsTable, { actions }));
    const text = textOf(html);
    for (const s of ["attention only", "acted", "block · 0.95", "hold · 0.90", "it is sending case data to an outside address", "the run is moving money, which vetting never does", "gpt-4o-mini", "read 2 entries"]) expect(text, s).toContain(s);
    expect(hrefs(html)).toEqual(actions.map((a) => `/runs?id=${a.run}`));
    const view = await l7.getGuardian();
    expect([view.actions_last_hour, view.stats]).toEqual([2, { evaluations: 4, ok: 0, acted: 2, attention: 2, unparseable: 0, errors: 0, repeated: 0, watching: 3 }]);
  });

  it("one run's verdicts; a run id that is not one is a 400", async () => {
    const calls = serve("guardian_actions_run", "guardian_actions_400");
    const one = await l7.listGuardianActions({ run: "vendor-desk-g1" });
    expect([calls[0].url, one.actions.map((a) => a.id)]).toEqual(["/api/guardian/actions?run=vendor-desk-g1", ["g-35e77e2ecd7b47f0"]]);
    const e = await refused(l7.listGuardianActions({ run: "Not A Run" }));
    expect([e.status, e.message]).toEqual([400, "run must be a run id"]);
  });

  it("its notes in a run's journal read as operator actions, by the guardian; what it parked for the worker and the SDK", () => {
    type E = { kind: string; title?: string; detail?: string; data?: Record<string, unknown> };
    const held = (fx("run_held_by_guardian").body as { journal: { entries: E[] } }).journal.entries;
    expect(held.map(l5.operatorOf).filter(Boolean)).toEqual([
      { action: "Guardian held the run at its next gate", by: "guardian", at: "", detail: "the run is moving money, which vetting never does — confidence 0.90 · gpt-4o-mini · delivered worker" },
    ]);
    const blocked = (fx("run_blocked_by_guardian").body as { journal: { entries: E[] } }).journal.entries;
    expect(blocked.map(l5.operatorOf).filter(Boolean)).toEqual([
      { action: "Guardian blocked the run", by: "guardian", at: "", detail: "it is sending case data to an outside address — confidence 0.95 · gpt-4o-mini · delivered sdk" },
    ]);
    expect(fx("worker_heartbeat_after_hold").body).toMatchObject({ steer: { hold_at_next_gate: true, by: "guardian" }, kill: null });
    expect(fx("sdk_control_after_block").body).toMatchObject({ kill: { reason: "guardian: it is sending case data to an outside address", by: "guardian" } });
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
      ["guardian", "open", "Open"],
      ["guardian", "kill", "Kill…"],
      ["guardian", "hold", "Hold"],
      ["guardian", "open", "Open"],
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

  it("a verdict the guardian could not act on offers the person's lever: the kill with its reason to start from, or the hold", async () => {
    const { by } = await rows();
    const kill = by("guardian:g-4c15fdb1c6e441f6");
    expect(kill.action).toMatchObject({ kind: "kill", method: "POST", path: "/api/runs/vendor-desk-g2/kill", body: { reason: "guardian: it is sending case data to an outside address" } });
    expect(kill.data).toMatchObject({ verdict: "block", outcome: "attention", why: "block is not among what the guardian may do (may: hold)" });
    const hold = by("guardian:g-f3679f23a6fb4eba");
    expect(hold.action).toMatchObject({ kind: "hold", method: "POST", path: "/api/runs/vendor-desk-g3/steer", body: { hold_at_next_gate: true } });
    // What it acted on opens the run.
    expect(by("guardian:g-35e77e2ecd7b47f0")).toMatchObject({ severity: 8, run: "vendor-desk-g1", action: { kind: "open", path: "/api/runs/vendor-desk-g1" } });
    expect(l5.openableRun(by("guardian:g-f36f7d69118d4bb3"))).toBe("vetting-2026-10-21T09-42-39-807795");
  });

  it("a side channel links both agents and both runs; a reader inside a sub-run is shown, never linked", async () => {
    const { by } = await rows();
    const pair = by("side_channel:reader:scribe:2026-10-20");
    expect(pair).toMatchObject({ agents: ["scribe", "reader"], runs: ["scribe-r1", "reader-r1", "scribe-r2"], run: "reader-r1", data: { reads: 3, both_ways: true, keys: ["case/42", "case/43"] } });
    expect(l5.openableRun(pair)).toBe("reader-r1");
    const clerk = by("side_channel:clerk:scribe:2026-10-20");
    // The backend names the sub-run as the reader's run, and its door has no such record.
    expect([clerk.run, clerk.action.path, fx("run_sub_run_id_404").status]).toEqual(["clerk-sub-0a1b2c3d4e", "/api/runs/clerk-sub-0a1b2c3d4e", 404]);
    expect([l5.looksLikeRecordId("clerk-sub-0a1b2c3d4e"), l5.looksLikeRecordId("reader-r1")]).toEqual([false, true]);
    expect(l5.openableRun(clerk)).toBe("scribe-r1");
    expect(clerk).toMatchObject({ severity: 6, data: { refused: 1, tainted: true } });
    const html = renderToStaticMarkup(createElement(AttentionLinks, { item: clerk }));
    expect(textOf(html)).toBe("scribe wrote · clerk read scribe-r1 clerk-sub-0a1b2c3d4e (sub-run)");
    expect(hrefs(html)).toEqual(["/runs?id=scribe-r1"]);
    // A key scoped to the reader sees the channels it is part of.
    serve("attention_scoped_clerk");
    expect((await l5.listAttention()).map((i) => i.id)).toEqual(["side_channel:clerk:scribe:2026-10-20"]);
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
    expectTypeOf<Agrees<l7.KillReceipt, Schemas["RunKilled"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.DepNode, Schemas["DepNode"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.DepEdge, Schemas["DepEdge"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.DepMap, Schemas["DependencyMap"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.BlastAgent, Schemas["BlastAgent"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.BlastRun, Schemas["BlastRun"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.BlastApplication, Schemas["BlastApplication"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.BlastRadius, Schemas["BlastRadius"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.DriftWindow, Schemas["DriftWindow"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.DriftMeasure, Schemas["DriftMeasure"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.AgentDrift, Schemas["AgentDrift"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.DriftReport, Schemas["DriftReport"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.GuardianStats, Schemas["GuardianStats"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.GuardianView, Schemas["GuardianView"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.GuardianAction, Schemas["GuardianAction"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.GuardianPatch, Partial<Schemas["GuardianUpdate"]>>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<Pick<l5.AttentionItem, "agents" | "runs" | "data">, Schemas["AttentionItem"]>>().toEqualTypeOf<true>();
    expectTypeOf<l7.KillDelivery>().toEqualTypeOf<Schemas["RunKilled"]["delivery"]>();
    expectTypeOf<l7.TreeNodeKind>().toEqualTypeOf<Schemas["TreeNode"]["kind"]>();
    expectTypeOf<l7.MeasureName>().toEqualTypeOf<Schemas["DriftMeasure"]["name"]>();
    // The check bites: a field the backend does not serve is caught.
    expectTypeOf<Agrees<{ cost_usd: number }, Schemas["TreeNode"]>>().toEqualTypeOf<false>();
  });
});
