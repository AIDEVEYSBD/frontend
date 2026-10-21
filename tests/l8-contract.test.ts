import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// The generated client as the browser has it, but on an absolute origin (as
// tests/generated-client.test.ts does): Node cannot build a Request for a
// bare path. The job door and the queue read through it.
vi.mock("@/lib/api/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api/client")>();
  const { default: createClient } = await import("openapi-fetch");
  return { ...real, api: createClient<import("@/lib/api/backend").paths>({ baseUrl: "http://console.test", credentials: "include", fetch: (r: Request) => globalThis.fetch(r) }) };
});

import { api, type Schemas } from "@/lib/api/client";
import * as l2 from "@/lib/api/l2";
import * as l5 from "@/lib/api/l5";
import * as l7 from "@/lib/api/l7";
import * as l8 from "@/lib/api/l8";
import { ACTION_LABEL, ATTENTION_LABEL, attentionVerb, driftBenchmarkLine, driftBenchmarkOf, overrideOfAttention, pauseOf, redirectGuidanceOf, rollbackOfAttention } from "@/lib/gates";
import { compareFromView, historyRowFromView, lastComparison, liveOf, mergeHistory, settleOf, thresholdText, throttleOf } from "@/lib/evals";
import {
  authorsOf,
  benchmarkLine,
  draftBanner,
  draftToLoad,
  gateSummary,
  gatedSaveLine,
  itemLine,
  findingHref,
  overrideBody,
  overrideChoices,
  overrideLine,
  overrideOutcome,
  retiredLine,
  reviewAccess,
  reviewRefusalText,
  rollbackLine,
  rollbackTargets,
  runFlagLine,
  runFlagOf,
  runFlagsOf,
  savedLine,
  spineHeadline,
  spineOf,
} from "@/lib/lifecycle";
import { formOf, mayOf, mayText, outcomeText, patchOf } from "@/lib/guardian";
import { driftVerdict } from "@/lib/drift";
import { jobLine, taintOf } from "@/lib/queue";
import { answerOf, peerCancelLine, peerTaskLine, reachedStateText } from "@/lib/run-tree";
import { rateLimitText } from "@/lib/rate-limit";
import { CaseTable, ComparePanel } from "@/components/evals";
import { GatePanel, DeployedReceipt } from "@/components/deploy-gate";
import { BenchmarkView, DeploymentsView, LifecycleIndexView, RetiredView, ReviewsView, RollbackReceipt, SpineView } from "@/components/lifecycle";
import { RunFlagsBanner } from "@/components/run-flags";
import { AgentCard } from "@/components/drift";
import { KillReceiptView, RunTreeBody } from "@/components/run-tree";

/**
 * The L8 contract (first round), held from the console's side.
 *
 * Every response below was captured from the backend's own app at commit
 * 65fe17a (a snapshot of backend/ and runtime/, so nothing was read from a
 * tree being edited), driven in-process through its doors with a TestClient:
 * the scratchpad capture reuses backend/tests/l8.py and the test_l8_*.py
 * fixtures without editing them. An eval started and read while a case's
 * model call was held, then done; a comparison of two priced models; a
 * case's start held by a rate limit, read while the runner waited, and one
 * refused past its retries; a lockdown landing mid-eval; every refusal the
 * eval door names. Ada (administrator) authors, Rui (operator with the
 * policy-reviewer group) reviews, Oli (operator) reads: the author refused
 * her own review, Oli refused for the role, Rui asking for changes then
 * approving; the gate refusing with nothing on record, passing on its own
 * records, refusing a draft, an override that named too little, a blank
 * reason, a non-administrator's override and the administrator's; the gate
 * refusing a regression, findings, no suite and a missing set; a draft
 * saved once deployed, its document by version; deployments per
 * environment; the spine at every stage; a rollback with its flagged runs;
 * a retirement and the 409 at every door after; the attention kinds
 * override and rollback; drift's pause and its benchmark; the guardian's
 * redirect, acted and outside its limits; an A2A task tainted, its run, and
 * one withdrawn; a kill whose peer cancel answered. Inlined as captured.
 * Each test calls the real client (lib/api/l8.ts, and l7.ts, l5.ts, the
 * generated client lib/api/l2.ts reads through) with fetch stubbed, then the
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
  "eval_start_202": {"status": 202, "body": {"id": "ev-mvi781bk-81b8", "runs": ["ev-mvi781bk-81b8"], "batch_id": "ev-mvi781bk-81b8", "agent": "triage", "set": "triage-bench", "digest": "90df2dfa5e202811", "version": 1, "total": 3, "dataset": true, "threshold": 0.6, "models": ["default"], "compare": false, "status_url": "/api/evals/runs/ev-mvi781bk-81b8"}},
  "eval_view_running": {"status": 200, "body": {"id": "ev-mvi781bk-81b8", "agent": "triage", "set": "triage-bench", "set_name": "triage benchmark", "digest": "90df2dfa5e202811", "version": 1, "version_digest": "90df2dfa5e202811", "model": "default", "forced": false, "by": "Chandresh Singh", "at": "2026-10-21T14:19:45.968Z", "finished_at": null, "state": "running", "error": "", "progress": {"done": 1, "total": 3, "passed": 1, "current": {"index": 1, "id": "b", "model": "default", "run": "triage-2026-10-21T14-19-45-ej7e"}, "rate_limited": null}, "passed": 1, "total": 3, "score": null, "threshold": 0.6, "passed_threshold": null, "dataset": true, "labeled": false, "matrix": null, "metrics": null, "headline_f1": null, "macro_f1": null, "invalid": 0, "results": [{"id": "a", "note": "exfil", "passed": true, "state": "done", "error": "", "checks": [{"kind": "label", "ok": true, "note": "disposition = \"ESCALATE\"; label \"ESCALATE\", expected \"ESCALATE\""}], "expected": "ESCALATE", "predicted": "ESCALATE", "duration_ms": 6, "run_file": "triage-2026-10-21T14-19-45-f5py", "outcome": "ESCALATE"}], "summary": {"batch_id": "ev-mvi781bk-81b8", "forced": false, "compare": false, "incumbent": "default", "set_name": "triage benchmark", "dataset": true, "version_digest": "90df2dfa5e202811", "positive": "ESCALATE", "progress": {"current": {"index": 1, "id": "b", "model": "default", "run": "triage-2026-10-21T14-19-45-ej7e"}, "rate_limited": null}, "heartbeat": "2026-10-21T14:19:45.975Z"}, "comparison": null, "status_url": "/api/evals/runs/ev-mvi781bk-81b8"}},
  "eval_view_done": {"status": 200, "body": {"id": "ev-mvi781bk-81b8", "agent": "triage", "set": "triage-bench", "set_name": "triage benchmark", "digest": "90df2dfa5e202811", "version": 1, "version_digest": "90df2dfa5e202811", "model": "default", "forced": false, "by": "Chandresh Singh", "at": "2026-10-21T14:19:45.968Z", "finished_at": "2026-10-21T14:19:45.980Z", "state": "done", "error": "", "progress": {"done": 3, "total": 3, "passed": 2, "current": null, "rate_limited": null}, "passed": 2, "total": 3, "score": 0.6666666666666666, "threshold": 0.6, "passed_threshold": true, "dataset": true, "labeled": true, "matrix": {"labels": ["AUTO_CLOSE", "ANALYST_REVIEW", "ESCALATE"], "counts": [[1, 0, 0, 0], [0, 0, 0, 0], [0, 1, 1, 0]]}, "metrics": {"total": 3, "invalid": 0, "accuracy": 0.6666666666666666, "macroF1": 0.5555555555555555, "microF1": 0.6666666666666666, "classes": [{"label": "AUTO_CLOSE", "tp": 1, "fp": 0, "tn": 2, "fn": 0, "precision": 1.0, "recall": 1.0, "f1": 1.0, "support": 1}, {"label": "ANALYST_REVIEW", "tp": 0, "fp": 1, "tn": 2, "fn": 0, "precision": 0.0, "recall": 0, "f1": 0, "support": 0}, {"label": "ESCALATE", "tp": 1, "fp": 0, "tn": 1, "fn": 1, "precision": 1.0, "recall": 0.5, "f1": 0.6666666666666666, "support": 2}], "positive": {"label": "ESCALATE", "tp": 1, "fp": 0, "tn": 1, "fn": 1, "precision": 1.0, "recall": 0.5, "f1": 0.6666666666666666, "support": 2}, "headlineF1": 0.6666666666666666, "headlineKind": "positive"}, "headline_f1": 0.6666666666666666, "macro_f1": 0.5555555555555555, "invalid": 0, "results": [{"id": "a", "note": "exfil", "passed": true, "state": "done", "error": "", "checks": [{"kind": "label", "ok": true, "note": "disposition = \"ESCALATE\"; label \"ESCALATE\", expected \"ESCALATE\""}], "expected": "ESCALATE", "predicted": "ESCALATE", "duration_ms": 6, "run_file": "triage-2026-10-21T14-19-45-f5py", "outcome": "ESCALATE"}, {"id": "b", "note": "routine", "passed": true, "state": "done", "error": "", "checks": [{"kind": "label", "ok": true, "note": "disposition = \"AUTO_CLOSE\"; label \"AUTO_CLOSE\", expected \"AUTO_CLOSE\""}], "expected": "AUTO_CLOSE", "predicted": "AUTO_CLOSE", "duration_ms": 4, "run_file": "triage-2026-10-21T14-19-45-ej7e", "outcome": "AUTO_CLOSE"}, {"id": "c", "note": "unclear", "passed": false, "state": "done", "error": "", "checks": [{"kind": "label", "ok": false, "note": "disposition = \"ANALYST_REVIEW\"; label \"ANALYST_REVIEW\", expected \"ESCALATE\""}, {"kind": "contains", "ok": true, "note": "\"review\" found in result"}], "expected": "ESCALATE", "predicted": "ANALYST_REVIEW", "duration_ms": 1, "run_file": "triage-2026-10-21T14-19-45-ocs6", "outcome": "ANALYST_REVIEW"}], "summary": {"batch_id": "ev-mvi781bk-81b8", "forced": false, "compare": false, "incumbent": "default", "set_name": "triage benchmark", "dataset": true, "version_digest": "90df2dfa5e202811", "positive": "ESCALATE", "tier": null, "avg_ms": 4, "tokens": {"in": 3000, "out": 300}, "model_calls": 3, "cost_total": 0.0039, "cost_per_case": 0.0013, "progress": {"current": null, "rate_limited": null}}, "comparison": null, "status_url": "/api/evals/runs/ev-mvi781bk-81b8"}},
  "run_eval_case": {"status": 200, "body": {"id": "triage-2026-10-21T14-19-45-f5py", "system": "triage", "spec_digest": "90df2dfa5e202811", "trace_id": "t-9c5ea810fce74b7d", "state": "done", "values": {"$input": {"incident": "INC-1"}, "decide": {"disposition": "ESCALATE"}}, "skipped": [], "visits": {"decide": 1}, "spent": {"tool_calls": 0, "tokens": 1100, "cost_usd": 0.0, "wall_clock_s": 0.0}, "suspension": null, "error": "", "result": {"disposition": "ESCALATE"}, "journal": {"run_id": "triage-2026-10-21T14-19-45-f5py", "system": "triage", "spec_digest": "90df2dfa5e202811", "duration_ms": 0, "entries": [{"t": 0, "kind": "run.start", "node": "", "title": "Run triage-2026-10-21T14-19-45-f5py", "detail": "", "data": {"system": "triage", "spec_digest": "90df2dfa5e202811", "trace_id": "t-9c5ea810fce74b7d"}, "because": [], "id": "15ddd2fde972", "tainted": false}, {"t": 0, "kind": "node.enter", "node": "decide", "title": "Decide", "detail": "sequence · 1 steps", "data": {"inputs": {"incident": "INC-1"}}, "because": [], "id": "6cb297ead617", "tainted": false}, {"t": 0, "kind": "model.call", "node": "decide", "title": "model", "detail": "ESCALATE", "data": {"prompt": "Triage INC-1", "intents": [], "tokens": {"in": 1000, "out": 100}, "ms": 0}, "because": ["6cb297ead617"], "id": "a5d3d235042b", "tainted": false}, {"t": 0, "kind": "node.exit", "node": "decide", "title": "Decide complete", "detail": "", "data": {"emitted": {"disposition": "ESCALATE"}}, "because": ["6cb297ead617", "a5d3d235042b"], "id": "8936f09c467f", "tainted": false}, {"t": 0, "kind": "run.end", "node": "", "title": "Run complete", "detail": "1 nodes ran, 0 skipped, 0 refused actions", "data": {"result": {"disposition": "ESCALATE"}, "skipped": [], "denied": 0}, "because": [], "id": "ee61b86d8c76", "tainted": false}]}, "started_at": "2026-10-21T14:19:45.968Z", "finished_at": "2026-10-21T14:19:45.973Z", "agent": null, "spec": {"apiVersion": "agentfactory/v1", "kind": "AgentSystem", "metadata": {"id": "triage", "name": "Triage", "description": "Triage an incident."}, "spec": {"entry": "decide", "nodes": [{"id": "decide", "harness": "sequence", "label": "Decide", "expects": [{"name": "incident", "kind": "string"}], "emits": [{"name": "disposition", "kind": "string"}], "steps": [{"action": "model", "prompt": "Triage {{incident}}", "emits": "disposition"}]}], "edges": [], "evals": {"dataset": "triage-bench", "compare": "disposition", "threshold": 0.6}}}, "provider": "foundry", "model": "", "kill": null, "eval": {"id": "ev-mvi781bk-81b8", "case": "a", "set": "triage-bench"}}},
  "eval_compare_202": {"status": 202, "body": {"id": "ev-mvi781dp-x4ik-gpt-4o", "runs": ["ev-mvi781dp-x4ik-gpt-4o", "ev-mvi781dp-x4ik-gpt-4o-mini"], "batch_id": "ev-mvi781dp-x4ik", "agent": "triage", "set": "triage-bench", "digest": "90df2dfa5e202811", "version": 1, "total": 3, "dataset": true, "threshold": 0.6, "models": ["gpt-4o", "gpt-4o-mini"], "compare": true, "status_url": "/api/evals/runs/ev-mvi781dp-x4ik-gpt-4o"}},
  "eval_compare_view_0": {"status": 200, "body": {"id": "ev-mvi781dp-x4ik-gpt-4o", "agent": "triage", "set": "triage-bench", "set_name": "triage benchmark", "digest": "5c204b10c1213b30", "version": 1, "version_digest": "90df2dfa5e202811", "model": "gpt-4o", "forced": true, "by": "Chandresh Singh", "at": "2026-10-21T14:19:46.046Z", "finished_at": "2026-10-21T14:19:46.053Z", "state": "done", "error": "", "progress": {"done": 3, "total": 3, "passed": 2, "current": null, "rate_limited": null}, "passed": 2, "total": 3, "score": 0.6666666666666666, "threshold": null, "passed_threshold": null, "dataset": true, "labeled": true, "matrix": {"labels": ["AUTO_CLOSE", "ANALYST_REVIEW", "ESCALATE"], "counts": [[1, 0, 0, 0], [0, 0, 0, 0], [0, 1, 1, 0]]}, "metrics": {"total": 3, "invalid": 0, "accuracy": 0.6666666666666666, "macroF1": 0.5555555555555555, "microF1": 0.6666666666666666, "classes": [{"label": "AUTO_CLOSE", "tp": 1, "fp": 0, "tn": 2, "fn": 0, "precision": 1.0, "recall": 1.0, "f1": 1.0, "support": 1}, {"label": "ANALYST_REVIEW", "tp": 0, "fp": 1, "tn": 2, "fn": 0, "precision": 0.0, "recall": 0, "f1": 0, "support": 0}, {"label": "ESCALATE", "tp": 1, "fp": 0, "tn": 1, "fn": 1, "precision": 1.0, "recall": 0.5, "f1": 0.6666666666666666, "support": 2}], "positive": {"label": "ESCALATE", "tp": 1, "fp": 0, "tn": 1, "fn": 1, "precision": 1.0, "recall": 0.5, "f1": 0.6666666666666666, "support": 2}, "headlineF1": 0.6666666666666666, "headlineKind": "positive"}, "headline_f1": 0.6666666666666666, "macro_f1": 0.5555555555555555, "invalid": 0, "results": [{"id": "a", "note": "exfil", "passed": true, "state": "done", "error": "", "checks": [{"kind": "label", "ok": true, "note": "disposition = \"ESCALATE\"; label \"ESCALATE\", expected \"ESCALATE\""}], "expected": "ESCALATE", "predicted": "ESCALATE", "duration_ms": 3, "run_file": "triage-2026-10-21T14-19-46-yva6", "outcome": "ESCALATE"}, {"id": "b", "note": "routine", "passed": true, "state": "done", "error": "", "checks": [{"kind": "label", "ok": true, "note": "disposition = \"AUTO_CLOSE\"; label \"AUTO_CLOSE\", expected \"AUTO_CLOSE\""}], "expected": "AUTO_CLOSE", "predicted": "AUTO_CLOSE", "duration_ms": 1, "run_file": "triage-2026-10-21T14-19-46-gdp5", "outcome": "AUTO_CLOSE"}, {"id": "c", "note": "unclear", "passed": false, "state": "done", "error": "", "checks": [{"kind": "label", "ok": false, "note": "disposition = \"ANALYST_REVIEW\"; label \"ANALYST_REVIEW\", expected \"ESCALATE\""}, {"kind": "contains", "ok": true, "note": "\"review\" found in result"}], "expected": "ESCALATE", "predicted": "ANALYST_REVIEW", "duration_ms": 1, "run_file": "triage-2026-10-21T14-19-46-sh1k", "outcome": "ANALYST_REVIEW"}], "summary": {"batch_id": "ev-mvi781dp-x4ik", "forced": true, "compare": true, "incumbent": "gpt-4o", "set_name": "triage benchmark", "dataset": true, "version_digest": "90df2dfa5e202811", "positive": "ESCALATE", "tier": "large", "avg_ms": 2, "tokens": {"in": 3000, "out": 300}, "model_calls": 3, "cost_total": 0.0105, "cost_per_case": 0.0035, "progress": {"current": null, "rate_limited": null}}, "comparison": {"batch_id": "ev-mvi781dp-x4ik", "incumbent": "gpt-4o", "models": [{"model": "gpt-4o", "forced": true, "tier": "large", "run_id": "ev-mvi781dp-x4ik-gpt-4o", "passed": 2, "total": 3, "pass_rate": 0.6666666666666666, "headline_f1": 0.6666666666666666, "macro_f1": 0.5555555555555555, "invalid": 0, "avg_ms": 2, "tokens": {"in": 3000, "out": 300}, "model_calls": 3, "cost_total": 0.0105, "cost_per_case": 0.0035, "matrix": {"labels": ["AUTO_CLOSE", "ANALYST_REVIEW", "ESCALATE"], "counts": [[1, 0, 0, 0], [0, 0, 0, 0], [0, 1, 1, 0]]}, "metrics": {"total": 3, "invalid": 0, "accuracy": 0.6666666666666666, "macroF1": 0.5555555555555555, "microF1": 0.6666666666666666, "classes": [{"label": "AUTO_CLOSE", "tp": 1, "fp": 0, "tn": 2, "fn": 0, "precision": 1.0, "recall": 1.0, "f1": 1.0, "support": 1}, {"label": "ANALYST_REVIEW", "tp": 0, "fp": 1, "tn": 2, "fn": 0, "precision": 0.0, "recall": 0, "f1": 0, "support": 0}, {"label": "ESCALATE", "tp": 1, "fp": 0, "tn": 1, "fn": 1, "precision": 1.0, "recall": 0.5, "f1": 0.6666666666666666, "support": 2}], "positive": {"label": "ESCALATE", "tp": 1, "fp": 0, "tn": 1, "fn": 1, "precision": 1.0, "recall": 0.5, "f1": 0.6666666666666666, "support": 2}, "headlineF1": 0.6666666666666666, "headlineKind": "positive"}}, {"model": "gpt-4o-mini", "forced": true, "tier": "small", "run_id": "ev-mvi781dp-x4ik-gpt-4o-mini", "passed": 2, "total": 3, "pass_rate": 0.6666666666666666, "headline_f1": 0.6666666666666666, "macro_f1": 0.5555555555555555, "invalid": 0, "avg_ms": 2, "tokens": {"in": 3000, "out": 300}, "model_calls": 3, "cost_total": 0.0006299999999999999, "cost_per_case": 0.00020999999999999998, "matrix": {"labels": ["AUTO_CLOSE", "ANALYST_REVIEW", "ESCALATE"], "counts": [[1, 0, 0, 0], [0, 0, 0, 0], [0, 1, 1, 0]]}, "metrics": {"total": 3, "invalid": 0, "accuracy": 0.6666666666666666, "macroF1": 0.5555555555555555, "microF1": 0.6666666666666666, "classes": [{"label": "AUTO_CLOSE", "tp": 1, "fp": 0, "tn": 2, "fn": 0, "precision": 1.0, "recall": 1.0, "f1": 1.0, "support": 1}, {"label": "ANALYST_REVIEW", "tp": 0, "fp": 1, "tn": 2, "fn": 0, "precision": 0.0, "recall": 0, "f1": 0, "support": 0}, {"label": "ESCALATE", "tp": 1, "fp": 0, "tn": 1, "fn": 1, "precision": 1.0, "recall": 0.5, "f1": 0.6666666666666666, "support": 2}], "positive": {"label": "ESCALATE", "tp": 1, "fp": 0, "tn": 1, "fn": 1, "precision": 1.0, "recall": 0.5, "f1": 0.6666666666666666, "support": 2}, "headlineF1": 0.6666666666666666, "headlineKind": "positive"}}], "recommended": "gpt-4o-mini", "rationale": "gpt-4o-mini clears the incumbent's quality within 0.02 at 94% lower cost per case.", "runs": ["ev-mvi781dp-x4ik-gpt-4o", "ev-mvi781dp-x4ik-gpt-4o-mini"]}, "status_url": "/api/evals/runs/ev-mvi781dp-x4ik-gpt-4o"}},
  "eval_compare_view_1": {"status": 200, "body": {"id": "ev-mvi781dp-x4ik-gpt-4o-mini", "agent": "triage", "set": "triage-bench", "set_name": "triage benchmark", "digest": "1db505af487b1261", "version": 1, "version_digest": "90df2dfa5e202811", "model": "gpt-4o-mini", "forced": true, "by": "Chandresh Singh", "at": "2026-10-21T14:19:46.046Z", "finished_at": "2026-10-21T14:19:46.060Z", "state": "done", "error": "", "progress": {"done": 3, "total": 3, "passed": 2, "current": null, "rate_limited": null}, "passed": 2, "total": 3, "score": 0.6666666666666666, "threshold": null, "passed_threshold": null, "dataset": true, "labeled": true, "matrix": {"labels": ["AUTO_CLOSE", "ANALYST_REVIEW", "ESCALATE"], "counts": [[1, 0, 0, 0], [0, 0, 0, 0], [0, 1, 1, 0]]}, "metrics": {"total": 3, "invalid": 0, "accuracy": 0.6666666666666666, "macroF1": 0.5555555555555555, "microF1": 0.6666666666666666, "classes": [{"label": "AUTO_CLOSE", "tp": 1, "fp": 0, "tn": 2, "fn": 0, "precision": 1.0, "recall": 1.0, "f1": 1.0, "support": 1}, {"label": "ANALYST_REVIEW", "tp": 0, "fp": 1, "tn": 2, "fn": 0, "precision": 0.0, "recall": 0, "f1": 0, "support": 0}, {"label": "ESCALATE", "tp": 1, "fp": 0, "tn": 1, "fn": 1, "precision": 1.0, "recall": 0.5, "f1": 0.6666666666666666, "support": 2}], "positive": {"label": "ESCALATE", "tp": 1, "fp": 0, "tn": 1, "fn": 1, "precision": 1.0, "recall": 0.5, "f1": 0.6666666666666666, "support": 2}, "headlineF1": 0.6666666666666666, "headlineKind": "positive"}, "headline_f1": 0.6666666666666666, "macro_f1": 0.5555555555555555, "invalid": 0, "results": [{"id": "a", "note": "exfil", "passed": true, "state": "done", "error": "", "checks": [{"kind": "label", "ok": true, "note": "disposition = \"ESCALATE\"; label \"ESCALATE\", expected \"ESCALATE\""}], "expected": "ESCALATE", "predicted": "ESCALATE", "duration_ms": 2, "run_file": "triage-2026-10-21T14-19-46-fxe1", "outcome": "ESCALATE"}, {"id": "b", "note": "routine", "passed": true, "state": "done", "error": "", "checks": [{"kind": "label", "ok": true, "note": "disposition = \"AUTO_CLOSE\"; label \"AUTO_CLOSE\", expected \"AUTO_CLOSE\""}], "expected": "AUTO_CLOSE", "predicted": "AUTO_CLOSE", "duration_ms": 2, "run_file": "triage-2026-10-21T14-19-46-gtvz", "outcome": "AUTO_CLOSE"}, {"id": "c", "note": "unclear", "passed": false, "state": "done", "error": "", "checks": [{"kind": "label", "ok": false, "note": "disposition = \"ANALYST_REVIEW\"; label \"ANALYST_REVIEW\", expected \"ESCALATE\""}, {"kind": "contains", "ok": true, "note": "\"review\" found in result"}], "expected": "ESCALATE", "predicted": "ANALYST_REVIEW", "duration_ms": 2, "run_file": "triage-2026-10-21T14-19-46-a7by", "outcome": "ANALYST_REVIEW"}], "summary": {"batch_id": "ev-mvi781dp-x4ik", "forced": true, "compare": true, "incumbent": "gpt-4o", "set_name": "triage benchmark", "dataset": true, "version_digest": "90df2dfa5e202811", "positive": "ESCALATE", "tier": "small", "avg_ms": 2, "tokens": {"in": 3000, "out": 300}, "model_calls": 3, "cost_total": 0.0006299999999999999, "cost_per_case": 0.00020999999999999998, "progress": {"current": null, "rate_limited": null}}, "comparison": {"batch_id": "ev-mvi781dp-x4ik", "incumbent": "gpt-4o", "models": [{"model": "gpt-4o", "forced": true, "tier": "large", "run_id": "ev-mvi781dp-x4ik-gpt-4o", "passed": 2, "total": 3, "pass_rate": 0.6666666666666666, "headline_f1": 0.6666666666666666, "macro_f1": 0.5555555555555555, "invalid": 0, "avg_ms": 2, "tokens": {"in": 3000, "out": 300}, "model_calls": 3, "cost_total": 0.0105, "cost_per_case": 0.0035, "matrix": {"labels": ["AUTO_CLOSE", "ANALYST_REVIEW", "ESCALATE"], "counts": [[1, 0, 0, 0], [0, 0, 0, 0], [0, 1, 1, 0]]}, "metrics": {"total": 3, "invalid": 0, "accuracy": 0.6666666666666666, "macroF1": 0.5555555555555555, "microF1": 0.6666666666666666, "classes": [{"label": "AUTO_CLOSE", "tp": 1, "fp": 0, "tn": 2, "fn": 0, "precision": 1.0, "recall": 1.0, "f1": 1.0, "support": 1}, {"label": "ANALYST_REVIEW", "tp": 0, "fp": 1, "tn": 2, "fn": 0, "precision": 0.0, "recall": 0, "f1": 0, "support": 0}, {"label": "ESCALATE", "tp": 1, "fp": 0, "tn": 1, "fn": 1, "precision": 1.0, "recall": 0.5, "f1": 0.6666666666666666, "support": 2}], "positive": {"label": "ESCALATE", "tp": 1, "fp": 0, "tn": 1, "fn": 1, "precision": 1.0, "recall": 0.5, "f1": 0.6666666666666666, "support": 2}, "headlineF1": 0.6666666666666666, "headlineKind": "positive"}}, {"model": "gpt-4o-mini", "forced": true, "tier": "small", "run_id": "ev-mvi781dp-x4ik-gpt-4o-mini", "passed": 2, "total": 3, "pass_rate": 0.6666666666666666, "headline_f1": 0.6666666666666666, "macro_f1": 0.5555555555555555, "invalid": 0, "avg_ms": 2, "tokens": {"in": 3000, "out": 300}, "model_calls": 3, "cost_total": 0.0006299999999999999, "cost_per_case": 0.00020999999999999998, "matrix": {"labels": ["AUTO_CLOSE", "ANALYST_REVIEW", "ESCALATE"], "counts": [[1, 0, 0, 0], [0, 0, 0, 0], [0, 1, 1, 0]]}, "metrics": {"total": 3, "invalid": 0, "accuracy": 0.6666666666666666, "macroF1": 0.5555555555555555, "microF1": 0.6666666666666666, "classes": [{"label": "AUTO_CLOSE", "tp": 1, "fp": 0, "tn": 2, "fn": 0, "precision": 1.0, "recall": 1.0, "f1": 1.0, "support": 1}, {"label": "ANALYST_REVIEW", "tp": 0, "fp": 1, "tn": 2, "fn": 0, "precision": 0.0, "recall": 0, "f1": 0, "support": 0}, {"label": "ESCALATE", "tp": 1, "fp": 0, "tn": 1, "fn": 1, "precision": 1.0, "recall": 0.5, "f1": 0.6666666666666666, "support": 2}], "positive": {"label": "ESCALATE", "tp": 1, "fp": 0, "tn": 1, "fn": 1, "precision": 1.0, "recall": 0.5, "f1": 0.6666666666666666, "support": 2}, "headlineF1": 0.6666666666666666, "headlineKind": "positive"}}], "recommended": "gpt-4o-mini", "rationale": "gpt-4o-mini clears the incumbent's quality within 0.02 at 94% lower cost per case.", "runs": ["ev-mvi781dp-x4ik-gpt-4o", "ev-mvi781dp-x4ik-gpt-4o-mini"]}, "status_url": "/api/evals/runs/ev-mvi781dp-x4ik-gpt-4o-mini"}},
  "eval_view_rate_limited": {"status": 200, "body": {"id": "ev-mvi781fd-bc8m", "agent": "triage", "set": "triage-bench", "set_name": "triage benchmark", "digest": "90df2dfa5e202811", "version": 1, "version_digest": "90df2dfa5e202811", "model": "default", "forced": false, "by": "Chandresh Singh", "at": "2026-10-21T14:19:46.105Z", "finished_at": null, "state": "running", "error": "", "progress": {"done": 1, "total": 2, "passed": 1, "current": {"index": 1, "id": "b", "model": "default", "run": ""}, "rate_limited": {"index": 1, "id": "b", "model": "default", "attempt": 1, "of": 5, "wait_s": 60, "text": "rate limit: 1 runs started for triage in the last minute, 1 allowed (run_starts_per_minute); retry in 60s", "limit": {"scope": "agent", "limit": "run_starts_per_minute", "used": 1, "allowed": 1, "retry_after_s": 60, "agent": "triage", "tree": "", "kind": "start"}}}, "passed": 1, "total": 2, "score": null, "threshold": 0.6, "passed_threshold": null, "dataset": true, "labeled": false, "matrix": null, "metrics": null, "headline_f1": null, "macro_f1": null, "invalid": 0, "results": [{"id": "a", "note": "exfil", "passed": true, "state": "done", "error": "", "checks": [{"kind": "label", "ok": true, "note": "disposition = \"ESCALATE\"; label \"ESCALATE\", expected \"ESCALATE\""}], "expected": "ESCALATE", "predicted": "ESCALATE", "duration_ms": 1, "run_file": "triage-2026-10-21T14-19-46-o2lq", "outcome": "ESCALATE"}], "summary": {"batch_id": "ev-mvi781fd-bc8m", "forced": false, "compare": false, "incumbent": "default", "set_name": "triage benchmark", "dataset": true, "version_digest": "90df2dfa5e202811", "positive": "ESCALATE", "progress": {"current": {"index": 1, "id": "b", "model": "default", "run": ""}, "rate_limited": {"index": 1, "id": "b", "model": "default", "attempt": 1, "of": 5, "wait_s": 60, "text": "rate limit: 1 runs started for triage in the last minute, 1 allowed (run_starts_per_minute); retry in 60s", "limit": {"scope": "agent", "limit": "run_starts_per_minute", "used": 1, "allowed": 1, "retry_after_s": 60, "agent": "triage", "tree": "", "kind": "start"}}}, "heartbeat": "2026-10-21T14:19:46.107Z"}, "comparison": null, "status_url": "/api/evals/runs/ev-mvi781fd-bc8m"}},
  "eval_view_rate_limited_done": {"status": 200, "body": {"id": "ev-mvi781fd-bc8m", "agent": "triage", "set": "triage-bench", "set_name": "triage benchmark", "digest": "90df2dfa5e202811", "version": 1, "version_digest": "90df2dfa5e202811", "model": "default", "forced": false, "by": "Chandresh Singh", "at": "2026-10-21T14:19:46.105Z", "finished_at": "2026-10-21T14:19:46.111Z", "state": "done", "error": "", "progress": {"done": 2, "total": 2, "passed": 2, "current": null, "rate_limited": {"index": 1, "id": "b", "model": "default", "attempt": 2, "of": 5, "wait_s": 1, "text": "rate limit: 1 runs started for triage in the last minute, 1 allowed (run_starts_per_minute); retry in 1s", "limit": {"scope": "agent", "limit": "run_starts_per_minute", "used": 1, "allowed": 1, "retry_after_s": 1, "agent": "triage", "tree": "", "kind": "start"}}}, "passed": 2, "total": 2, "score": 1.0, "threshold": 0.6, "passed_threshold": true, "dataset": true, "labeled": true, "matrix": {"labels": ["AUTO_CLOSE", "ANALYST_REVIEW", "ESCALATE"], "counts": [[1, 0, 0, 0], [0, 0, 0, 0], [0, 0, 1, 0]]}, "metrics": {"total": 2, "invalid": 0, "accuracy": 1.0, "macroF1": 0.6666666666666666, "microF1": 1.0, "classes": [{"label": "AUTO_CLOSE", "tp": 1, "fp": 0, "tn": 1, "fn": 0, "precision": 1.0, "recall": 1.0, "f1": 1.0, "support": 1}, {"label": "ANALYST_REVIEW", "tp": 0, "fp": 0, "tn": 2, "fn": 0, "precision": 0, "recall": 0, "f1": 0, "support": 0}, {"label": "ESCALATE", "tp": 1, "fp": 0, "tn": 1, "fn": 0, "precision": 1.0, "recall": 1.0, "f1": 1.0, "support": 1}], "positive": {"label": "ESCALATE", "tp": 1, "fp": 0, "tn": 1, "fn": 0, "precision": 1.0, "recall": 1.0, "f1": 1.0, "support": 1}, "headlineF1": 1.0, "headlineKind": "positive"}, "headline_f1": 1.0, "macro_f1": 0.6666666666666666, "invalid": 0, "results": [{"id": "a", "note": "exfil", "passed": true, "state": "done", "error": "", "checks": [{"kind": "label", "ok": true, "note": "disposition = \"ESCALATE\"; label \"ESCALATE\", expected \"ESCALATE\""}], "expected": "ESCALATE", "predicted": "ESCALATE", "duration_ms": 1, "run_file": "triage-2026-10-21T14-19-46-o2lq", "outcome": "ESCALATE"}, {"id": "b", "note": "routine", "passed": true, "state": "done", "error": "", "checks": [{"kind": "label", "ok": true, "note": "disposition = \"AUTO_CLOSE\"; label \"AUTO_CLOSE\", expected \"AUTO_CLOSE\""}], "expected": "AUTO_CLOSE", "predicted": "AUTO_CLOSE", "duration_ms": 4, "run_file": "triage-2026-10-21T14-19-46-hw88", "outcome": "AUTO_CLOSE"}], "summary": {"batch_id": "ev-mvi781fd-bc8m", "forced": false, "compare": false, "incumbent": "default", "set_name": "triage benchmark", "dataset": true, "version_digest": "90df2dfa5e202811", "positive": "ESCALATE", "tier": null, "avg_ms": 3, "tokens": {"in": 2000, "out": 200}, "model_calls": 2, "cost_total": 0.0026, "cost_per_case": 0.0013, "progress": {"current": null, "rate_limited": {"index": 1, "id": "b", "model": "default", "attempt": 2, "of": 5, "wait_s": 1, "text": "rate limit: 1 runs started for triage in the last minute, 1 allowed (run_starts_per_minute); retry in 1s", "limit": {"scope": "agent", "limit": "run_starts_per_minute", "used": 1, "allowed": 1, "retry_after_s": 1, "agent": "triage", "tree": "", "kind": "start"}}}}, "comparison": null, "status_url": "/api/evals/runs/ev-mvi781fd-bc8m"}},
  "eval_view_refused_past_retries": {"status": 200, "body": {"id": "ev-mvi781h1-gcoy", "agent": "triage", "set": "triage-bench", "set_name": "triage benchmark", "digest": "90df2dfa5e202811", "version": 1, "version_digest": "90df2dfa5e202811", "model": "default", "forced": false, "by": "Chandresh Singh", "at": "2026-10-21T14:19:46.165Z", "finished_at": "2026-10-21T14:19:46.169Z", "state": "done", "error": "", "progress": {"done": 2, "total": 2, "passed": 1, "current": null, "rate_limited": {"index": 1, "id": "b", "model": "default", "attempt": 2, "of": 2, "wait_s": 60, "text": "rate limit: 1 runs started for triage in the last minute, 1 allowed (run_starts_per_minute); retry in 60s", "limit": {"scope": "agent", "limit": "run_starts_per_minute", "used": 1, "allowed": 1, "retry_after_s": 60, "agent": "triage", "tree": "", "kind": "start"}}}, "passed": 1, "total": 2, "score": 0.5, "threshold": 0.6, "passed_threshold": false, "dataset": true, "labeled": true, "matrix": {"labels": ["AUTO_CLOSE", "ANALYST_REVIEW", "ESCALATE"], "counts": [[0, 0, 0, 1], [0, 0, 0, 0], [0, 0, 1, 0]]}, "metrics": {"total": 2, "invalid": 1, "accuracy": 0.5, "macroF1": 0.3333333333333333, "microF1": 0.5, "classes": [{"label": "AUTO_CLOSE", "tp": 0, "fp": 0, "tn": 1, "fn": 1, "precision": 0, "recall": 0.0, "f1": 0, "support": 1}, {"label": "ANALYST_REVIEW", "tp": 0, "fp": 0, "tn": 2, "fn": 0, "precision": 0, "recall": 0, "f1": 0, "support": 0}, {"label": "ESCALATE", "tp": 1, "fp": 0, "tn": 1, "fn": 0, "precision": 1.0, "recall": 1.0, "f1": 1.0, "support": 1}], "positive": {"label": "ESCALATE", "tp": 1, "fp": 0, "tn": 1, "fn": 0, "precision": 1.0, "recall": 1.0, "f1": 1.0, "support": 1}, "headlineF1": 1.0, "headlineKind": "positive"}, "headline_f1": 1.0, "macro_f1": 0.3333333333333333, "invalid": 1, "results": [{"id": "a", "note": "exfil", "passed": true, "state": "done", "error": "", "checks": [{"kind": "label", "ok": true, "note": "disposition = \"ESCALATE\"; label \"ESCALATE\", expected \"ESCALATE\""}], "expected": "ESCALATE", "predicted": "ESCALATE", "duration_ms": 2, "run_file": "triage-2026-10-21T14-19-46-vm9g", "outcome": "ESCALATE"}, {"id": "b", "note": "routine", "passed": false, "state": "failed", "error": "refused at the start, past 2 retries: rate limit: 1 runs started for triage in the last minute, 1 allowed (run_starts_per_minute); retry in 60s", "checks": [{"kind": "label", "ok": false, "note": "run ended failed; label none, expected \"AUTO_CLOSE\""}, {"kind": "state", "ok": false, "note": "run ended failed"}], "expected": "AUTO_CLOSE", "predicted": null, "duration_ms": 0, "run_file": "", "outcome": "state:failed"}], "summary": {"batch_id": "ev-mvi781h1-gcoy", "forced": false, "compare": false, "incumbent": "default", "set_name": "triage benchmark", "dataset": true, "version_digest": "90df2dfa5e202811", "positive": "ESCALATE", "tier": null, "avg_ms": 1, "tokens": {"in": 1000, "out": 100}, "model_calls": 1, "cost_total": 0.0013, "cost_per_case": 0.00065, "progress": {"current": null, "rate_limited": {"index": 1, "id": "b", "model": "default", "attempt": 2, "of": 2, "wait_s": 60, "text": "rate limit: 1 runs started for triage in the last minute, 1 allowed (run_starts_per_minute); retry in 60s", "limit": {"scope": "agent", "limit": "run_starts_per_minute", "used": 1, "allowed": 1, "retry_after_s": 60, "agent": "triage", "tree": "", "kind": "start"}}}}, "comparison": null, "status_url": "/api/evals/runs/ev-mvi781h1-gcoy"}},
  "eval_view_lockdown_mid": {"status": 200, "body": {"id": "ev-mvi781in-tsek", "agent": "triage", "set": "triage-bench", "set_name": "triage benchmark", "digest": "90df2dfa5e202811", "version": 1, "version_digest": "90df2dfa5e202811", "model": "default", "forced": false, "by": "Chandresh Singh", "at": "2026-10-21T14:19:46.223Z", "finished_at": "2026-10-21T14:19:46.244Z", "state": "done", "error": "", "progress": {"done": 3, "total": 3, "passed": 1, "current": null, "rate_limited": null}, "passed": 1, "total": 3, "score": 0.3333333333333333, "threshold": 0.6, "passed_threshold": false, "dataset": true, "labeled": true, "matrix": {"labels": ["AUTO_CLOSE", "ANALYST_REVIEW", "ESCALATE"], "counts": [[0, 0, 0, 1], [0, 0, 0, 0], [0, 0, 1, 1]]}, "metrics": {"total": 3, "invalid": 2, "accuracy": 0.3333333333333333, "macroF1": 0.2222222222222222, "microF1": 0.3333333333333333, "classes": [{"label": "AUTO_CLOSE", "tp": 0, "fp": 0, "tn": 2, "fn": 1, "precision": 0, "recall": 0.0, "f1": 0, "support": 1}, {"label": "ANALYST_REVIEW", "tp": 0, "fp": 0, "tn": 3, "fn": 0, "precision": 0, "recall": 0, "f1": 0, "support": 0}, {"label": "ESCALATE", "tp": 1, "fp": 0, "tn": 1, "fn": 1, "precision": 1.0, "recall": 0.5, "f1": 0.6666666666666666, "support": 2}], "positive": {"label": "ESCALATE", "tp": 1, "fp": 0, "tn": 1, "fn": 1, "precision": 1.0, "recall": 0.5, "f1": 0.6666666666666666, "support": 2}, "headlineF1": 0.6666666666666666, "headlineKind": "positive"}, "headline_f1": 0.6666666666666666, "macro_f1": 0.2222222222222222, "invalid": 2, "results": [{"id": "a", "note": "exfil", "passed": true, "state": "done", "error": "", "checks": [{"kind": "label", "ok": true, "note": "disposition = \"ESCALATE\"; label \"ESCALATE\", expected \"ESCALATE\""}], "expected": "ESCALATE", "predicted": "ESCALATE", "duration_ms": 20, "run_file": "triage-2026-10-21T14-19-46-eb0p", "outcome": "ESCALATE"}, {"id": "b", "note": "routine", "passed": false, "state": "failed", "error": "the estate is locked down: breach drill (by Chandresh Singh, 2026-10-21T14:19:46.241Z). Nothing starts until it is lifted with POST /api/lockdown {\"on\": false}.", "checks": [{"kind": "label", "ok": false, "note": "run ended failed; label none, expected \"AUTO_CLOSE\""}, {"kind": "state", "ok": false, "note": "run ended failed"}], "expected": "AUTO_CLOSE", "predicted": null, "duration_ms": 0, "run_file": "", "outcome": "state:failed"}, {"id": "c", "note": "unclear", "passed": false, "state": "failed", "error": "the estate is locked down: breach drill (by Chandresh Singh, 2026-10-21T14:19:46.241Z). Nothing starts until it is lifted with POST /api/lockdown {\"on\": false}.", "checks": [{"kind": "label", "ok": false, "note": "run ended failed; label none, expected \"ESCALATE\""}, {"kind": "contains", "ok": false, "note": "\"review\" missing in result"}, {"kind": "state", "ok": false, "note": "run ended failed"}], "expected": "ESCALATE", "predicted": null, "duration_ms": 0, "run_file": "", "outcome": "state:failed"}], "summary": {"batch_id": "ev-mvi781in-tsek", "forced": false, "compare": false, "incumbent": "default", "set_name": "triage benchmark", "dataset": true, "version_digest": "90df2dfa5e202811", "positive": "ESCALATE", "tier": null, "avg_ms": 7, "tokens": {"in": 1000, "out": 100}, "model_calls": 1, "cost_total": 0.0013, "cost_per_case": 0.0004333333333333333, "progress": {"current": null, "rate_limited": null}}, "comparison": null, "status_url": "/api/evals/runs/ev-mvi781in-tsek"}},
  "eval_404_digest": {"status": 404, "body": {"error": "no version of \"triage\" carries digest 0000000000000000", "field": "digest"}},
  "eval_404_set": {"status": 404, "body": {"error": "no eval set \"nowhere\"", "field": "set"}},
  "eval_409_other_set": {"status": 409, "body": {"error": "eval set \"their-bench\" benchmarks \"someone-else\", not \"triage\"", "field": "set"}},
  "eval_400_no_suite": {"status": 400, "body": {"error": "name the set to run: the spec declares no eval suite (spec.evals.dataset)", "field": "set"}},
  "eval_404_agent": {"status": 404, "body": {"error": "no saved agent \"nobody\""}},
  "eval_run_404": {"status": 404, "body": {"error": "no eval run \"ev-nothing\""}},
  "eval_423_lockdown": {"status": 423, "body": {"error": "the estate is locked down: incident (by Chandresh Singh, 2026-10-21T14:19:46.038Z). Nothing starts until it is lifted with POST /api/lockdown {\"on\": false}.", "lockdown": {"on": true, "reason": "incident", "by": "Chandresh Singh", "at": "2026-10-21T14:19:46.038Z", "controls": ["queue: no worker claims a job while it lasts; the queue drains as the runs in flight finish", "doors: the trigger, webhook and cron doors still enqueue, so no event is lost (the answer says the lockdown holds the job); POST /api/runs answers 423", "gates: every tool call above read waits for a human (control lockdown) in a run in flight when the switch lands (from its next call), in a run resumed while it lasts, and in a job claimed as the switch landed", "sinks: every call to a sink in those runs is held the same way, whatever its risk"], "audit_id": 11}}},
  "eval_409_paused": {"status": 409, "body": {"error": "\"triage\" is paused: noisy (by Chandresh Singh, 2026-10-21T14:19:46.041Z). Resume it with POST /api/fleet {action: \"resume\"}.", "paused": {"mode": "pause", "reason": "noisy", "by": "Chandresh Singh", "at": "2026-10-21T14:19:46.041Z"}}},
  "eval_409_retired": {"status": 409, "body": {"error": "\"triage\" is retired: superseded by the next triage (by Ada <ada@ey.com>, 2026-10-21T14:19:46.440Z). It takes no new runs or triggers; its runs and versions stay readable. Its replacement is \"triage-next\".", "control": "retired", "retired": {"id": "rt-b0376f9f80274f3a", "agent": "triage", "reason": "superseded by the next triage", "replacement": "triage-next", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.440Z"}}},
  "evals_benchmark_404_none": {"status": 404, "body": {"error": "no eval of \"triage\" is on record on triage-bench; run one with POST /api/agents/triage/evals/run"}},
  "benchmark_200_undeployed": {"status": 200, "body": {"score": 0.6666666666666666, "passed": 2, "total": 3, "threshold": 0.6, "passed_threshold": true, "model": "default", "set": "triage-bench", "digest": "90df2dfa5e202811", "matches_deployed": false, "at": "2026-10-21T14:19:45.980Z", "id": "ev-mvi781bk-81b8", "version": 1, "deployed": null}},
  "benchmark_200_after_compare": {"status": 200, "body": {"score": 0.6666666666666666, "passed": 2, "total": 3, "threshold": 0.6, "passed_threshold": true, "model": "default", "set": "triage-bench", "digest": "90df2dfa5e202811", "matches_deployed": false, "at": "2026-10-21T14:19:45.980Z", "id": "ev-mvi781bk-81b8", "version": 1, "deployed": null}},
  "benchmark_200_matches": {"status": 200, "body": {"score": 0.6666666666666666, "passed": 2, "total": 3, "threshold": 0.6, "passed_threshold": true, "model": "default", "set": "triage-bench", "digest": "90df2dfa5e202811", "matches_deployed": true, "at": "2026-10-21T14:19:46.317Z", "id": "ev-mvi781l4-vr69", "version": 1, "deployed": {"version": 1, "digest": "90df2dfa5e202811"}}},
  "review_403_sod": {"status": 403, "body": {"error": "Ada <ada@ey.com> saved version 1 of \"triage\" (digest 90df2dfa5e202811): its author may not review it; another policy reviewer signs", "control": "separation_of_duties", "authors": ["Ada <ada@ey.com>"]}},
  "review_403_missing_role": {"status": 403, "body": {"error": "a policy review needs the \"policy-reviewer\" role; your roles: operator", "missing_role": "policy-reviewer"}},
  "review_403_viewer": {"status": 403, "body": {"error": "this needs the \"approve\" permission; your roles: viewer"}},
  "review_404_digest": {"status": 404, "body": {"error": "no version of \"triage\" carries digest 0000000000000000", "field": "digest"}},
  "review_400_verdict": {"status": 400, "body": {"error": "bad request: body.verdict: Input should be 'approved' or 'changes_requested'", "field": "verdict"}},
  "review_201_changes": {"status": 201, "body": {"id": "rv-367d1e5ec9704003", "agent": "triage", "digest": "90df2dfa5e202811", "version": 1, "verdict": "changes_requested", "note": "say why the threshold is 0.6", "by": "Rui <rui@ey.com>", "at": "2026-10-21T14:19:46.306Z", "authors": ["Ada <ada@ey.com>"]}},
  "review_201_approved": {"status": 201, "body": {"id": "rv-55746879f41e44d6", "agent": "triage", "digest": "90df2dfa5e202811", "version": 1, "verdict": "approved", "note": "policy holds", "by": "Rui <rui@ey.com>", "at": "2026-10-21T14:19:46.308Z", "authors": ["Ada <ada@ey.com>"]}},
  "reviews_list": {"status": 200, "body": {"agent": "triage", "reviews": [{"id": "rv-55746879f41e44d6", "agent": "triage", "digest": "90df2dfa5e202811", "version": 1, "verdict": "approved", "note": "policy holds", "by": "Rui <rui@ey.com>", "at": "2026-10-21T14:19:46.308Z", "authors": ["Ada <ada@ey.com>"]}, {"id": "rv-367d1e5ec9704003", "agent": "triage", "digest": "90df2dfa5e202811", "version": 1, "verdict": "changes_requested", "note": "say why the threshold is 0.6", "by": "Rui <rui@ey.com>", "at": "2026-10-21T14:19:46.306Z", "authors": ["Ada <ada@ey.com>"]}], "count": 2, "role": "policy-reviewer"}},
  "deploy_409_nothing": {"status": 409, "body": {"error": "the promotion gate is not met for \"triage\" version 1 (90df2dfa5e202811): eval, review", "unmet": [{"condition": "eval", "detail": "no eval of 90df2dfa5e202811 on triage-bench is on record: run POST /api/agents/triage/evals/run", "items": []}, {"condition": "review", "detail": "no policy review of 90df2dfa5e202811 is on record: a reviewer who did not author it approves it at POST /api/agents/triage/reviews", "items": []}], "conditions": [{"condition": "eval", "met": false, "detail": "no eval of 90df2dfa5e202811 on triage-bench is on record: run POST /api/agents/triage/evals/run", "items": [], "overridden": false}, {"condition": "review", "met": false, "detail": "no policy review of 90df2dfa5e202811 is on record: a reviewer who did not author it approves it at POST /api/agents/triage/reviews", "items": [], "overridden": false}, {"condition": "findings", "met": true, "detail": "nothing open for triage", "items": [], "overridden": false}, {"condition": "regression", "met": true, "detail": "nothing is deployed to production yet: no predecessor to compare", "items": [], "overridden": false}], "agent": "triage", "version": 1, "digest": "90df2dfa5e202811", "environment": "production", "decision": "gd-53914e4463784d23"}},
  "deploy_409_changes_requested": {"status": 409, "body": {"error": "the promotion gate is not met for \"triage\" version 1 (90df2dfa5e202811): eval, review", "unmet": [{"condition": "eval", "detail": "no eval of 90df2dfa5e202811 on triage-bench is on record: run POST /api/agents/triage/evals/run", "items": []}, {"condition": "review", "detail": "the latest review of 90df2dfa5e202811, by Rui <rui@ey.com>, requested changes: say why the threshold is 0.6", "items": [{"id": "rv-367d1e5ec9704003", "agent": "triage", "digest": "90df2dfa5e202811", "version": 1, "verdict": "changes_requested", "note": "say why the threshold is 0.6", "by": "Rui <rui@ey.com>", "by_sub": "autox|rui@ey.com", "authors": ["Ada <ada@ey.com>"], "at": "2026-10-21T14:19:46.306Z"}]}], "conditions": [{"condition": "eval", "met": false, "detail": "no eval of 90df2dfa5e202811 on triage-bench is on record: run POST /api/agents/triage/evals/run", "items": [], "overridden": false}, {"condition": "review", "met": false, "detail": "the latest review of 90df2dfa5e202811, by Rui <rui@ey.com>, requested changes: say why the threshold is 0.6", "items": [{"id": "rv-367d1e5ec9704003", "agent": "triage", "digest": "90df2dfa5e202811", "version": 1, "verdict": "changes_requested", "note": "say why the threshold is 0.6", "by": "Rui <rui@ey.com>", "by_sub": "autox|rui@ey.com", "authors": ["Ada <ada@ey.com>"], "at": "2026-10-21T14:19:46.306Z"}], "overridden": false}, {"condition": "findings", "met": true, "detail": "nothing open for triage", "items": [], "overridden": false}, {"condition": "regression", "met": true, "detail": "nothing is deployed to production yet: no predecessor to compare", "items": [], "overridden": false}], "agent": "triage", "version": 1, "digest": "90df2dfa5e202811", "environment": "production", "decision": "gd-fe40a9e0da474996"}},
  "deploy_200": {"status": 200, "body": {"deployed": true, "id": "triage", "digest": "90df2dfa5e202811", "version": 1, "store": "file (db unreachable)", "at": "2026-10-21T14:19:46.348Z", "steps": [{"step": "validate", "ms": 0}, {"step": "gate", "ms": 0}, {"step": "register", "ms": 0}], "environment": "production", "deployment": "dp-9ac1778f1fe943f8", "decision": "gd-5b754c7f50894ab1", "conditions": [{"condition": "eval", "met": true, "detail": "2/3 on triage-bench (0.6667) is at or above the threshold 0.6", "items": [{"id": "ev-mvi781l4-vr69", "digest": "90df2dfa5e202811", "version": 1, "set": "triage-bench", "passed": 2, "total": 3, "score": 0.6666666666666666, "threshold": 0.6, "at": "2026-10-21T14:19:46.317Z"}], "overridden": false}, {"condition": "review", "met": true, "detail": "approved by Rui <rui@ey.com> at 2026-10-21T14:19:46.308Z", "items": [{"id": "rv-55746879f41e44d6", "agent": "triage", "digest": "90df2dfa5e202811", "version": 1, "verdict": "approved", "note": "policy holds", "by": "Rui <rui@ey.com>", "by_sub": "autox|rui@ey.com", "authors": ["Ada <ada@ey.com>"], "at": "2026-10-21T14:19:46.308Z"}], "overridden": false}, {"condition": "findings", "met": true, "detail": "nothing open for triage", "items": [], "overridden": false}, {"condition": "regression", "met": true, "detail": "nothing is deployed to production yet: no predecessor to compare", "items": [], "overridden": false}], "override": null}},
  "deploy_409_v2": {"status": 409, "body": {"error": "the promotion gate is not met for \"triage\" version 2 (9a1150cc0d8cc86e): eval, review, regression", "unmet": [{"condition": "eval", "detail": "no eval of 9a1150cc0d8cc86e on triage-bench is on record: run POST /api/agents/triage/evals/run", "items": []}, {"condition": "review", "detail": "no policy review of 9a1150cc0d8cc86e is on record: a reviewer who did not author it approves it at POST /api/agents/triage/reviews", "items": []}, {"condition": "regression", "detail": "no score for 9a1150cc0d8cc86e to set against the deployed predecessor's 0.6667 (version 1)", "items": [{"id": "ev-mvi781l4-vr69", "digest": "90df2dfa5e202811", "version": 1, "set": "triage-bench", "passed": 2, "total": 3, "score": 0.6666666666666666, "threshold": 0.6, "at": "2026-10-21T14:19:46.317Z"}]}], "conditions": [{"condition": "eval", "met": false, "detail": "no eval of 9a1150cc0d8cc86e on triage-bench is on record: run POST /api/agents/triage/evals/run", "items": [], "overridden": false}, {"condition": "review", "met": false, "detail": "no policy review of 9a1150cc0d8cc86e is on record: a reviewer who did not author it approves it at POST /api/agents/triage/reviews", "items": [], "overridden": false}, {"condition": "findings", "met": true, "detail": "nothing open for triage", "items": [], "overridden": false}, {"condition": "regression", "met": false, "detail": "no score for 9a1150cc0d8cc86e to set against the deployed predecessor's 0.6667 (version 1)", "items": [{"id": "ev-mvi781l4-vr69", "digest": "90df2dfa5e202811", "version": 1, "set": "triage-bench", "passed": 2, "total": 3, "score": 0.6666666666666666, "threshold": 0.6, "at": "2026-10-21T14:19:46.317Z"}], "overridden": false}], "agent": "triage", "version": 2, "digest": "9a1150cc0d8cc86e", "environment": "production", "decision": "gd-63ea32e1e1d44e70"}},
  "deploy_409_override_partial": {"status": 409, "body": {"error": "the promotion gate is not met for \"triage\" version 2 (9a1150cc0d8cc86e): eval, regression", "unmet": [{"condition": "eval", "detail": "no eval of 9a1150cc0d8cc86e on triage-bench is on record: run POST /api/agents/triage/evals/run", "items": []}, {"condition": "regression", "detail": "no score for 9a1150cc0d8cc86e to set against the deployed predecessor's 0.6667 (version 1)", "items": [{"id": "ev-mvi781l4-vr69", "digest": "90df2dfa5e202811", "version": 1, "set": "triage-bench", "passed": 2, "total": 3, "score": 0.6666666666666666, "threshold": 0.6, "at": "2026-10-21T14:19:46.317Z"}]}], "conditions": [{"condition": "eval", "met": false, "detail": "no eval of 9a1150cc0d8cc86e on triage-bench is on record: run POST /api/agents/triage/evals/run", "items": [], "overridden": false}, {"condition": "review", "met": false, "detail": "no policy review of 9a1150cc0d8cc86e is on record: a reviewer who did not author it approves it at POST /api/agents/triage/reviews", "items": [], "overridden": true}, {"condition": "findings", "met": true, "detail": "nothing open for triage", "items": [], "overridden": false}, {"condition": "regression", "met": false, "detail": "no score for 9a1150cc0d8cc86e to set against the deployed predecessor's 0.6667 (version 1)", "items": [{"id": "ev-mvi781l4-vr69", "digest": "90df2dfa5e202811", "version": 1, "set": "triage-bench", "passed": 2, "total": 3, "score": 0.6666666666666666, "threshold": 0.6, "at": "2026-10-21T14:19:46.317Z"}], "overridden": false}], "agent": "triage", "version": 2, "digest": "9a1150cc0d8cc86e", "environment": "production", "decision": "gd-827510735f8b4e91"}},
  "deploy_400_override_reason": {"status": 400, "body": {"error": "override.reason: an override needs a reason", "field": "override.reason"}},
  "deploy_403_override": {"status": 403, "body": {"error": "an override of the promotion gate is an administrator's, with a reason", "control": "override"}},
  "deploy_403_viewer": {"status": 403, "body": {"error": "this needs the \"deploy\" permission; your roles: viewer"}},
  "deploy_200_override": {"status": 200, "body": {"deployed": true, "id": "triage", "digest": "9a1150cc0d8cc86e", "version": 2, "store": "file (db unreachable)", "at": "2026-10-21T14:19:46.371Z", "steps": [{"step": "validate", "ms": 0}, {"step": "gate", "ms": 0}, {"step": "register", "ms": 0}], "environment": "production", "deployment": "dp-c1ad4a58de7b4036", "decision": "gd-d88af9436bf84bce", "conditions": [{"condition": "eval", "met": false, "detail": "no eval of 9a1150cc0d8cc86e on triage-bench is on record: run POST /api/agents/triage/evals/run", "items": [], "overridden": true}, {"condition": "review", "met": false, "detail": "no policy review of 9a1150cc0d8cc86e is on record: a reviewer who did not author it approves it at POST /api/agents/triage/reviews", "items": [], "overridden": true}, {"condition": "findings", "met": true, "detail": "nothing open for triage", "items": [], "overridden": false}, {"condition": "regression", "met": false, "detail": "no score for 9a1150cc0d8cc86e to set against the deployed predecessor's 0.6667 (version 1)", "items": [{"id": "ev-mvi781l4-vr69", "digest": "90df2dfa5e202811", "version": 1, "set": "triage-bench", "passed": 2, "total": 3, "score": 0.6666666666666666, "threshold": 0.6, "at": "2026-10-21T14:19:46.317Z"}], "overridden": true}], "override": {"reason": "hotfix for INC-77", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.370Z", "passed": ["eval", "review", "regression"], "unmet": [{"condition": "eval", "detail": "no eval of 9a1150cc0d8cc86e on triage-bench is on record: run POST /api/agents/triage/evals/run"}, {"condition": "review", "detail": "no policy review of 9a1150cc0d8cc86e is on record: a reviewer who did not author it approves it at POST /api/agents/triage/reviews"}, {"condition": "regression", "detail": "no score for 9a1150cc0d8cc86e to set against the deployed predecessor's 0.6667 (version 1)"}], "audit_id": 26}}},
  "deploy_409_regression": {"status": 409, "body": {"error": "the promotion gate is not met for \"triage\" version 2 (b7cbc25cb31426b8): regression", "unmet": [{"condition": "regression", "detail": "b7cbc25cb31426b8 scores 0.3333 on triage-bench, below the deployed predecessor's 0.6667 (version 1)", "items": [{"id": "ev-mvi781qn-prb7", "digest": "b7cbc25cb31426b8", "version": 2, "set": "triage-bench", "passed": 1, "total": 3, "score": 0.3333333333333333, "threshold": 0.3, "at": "2026-10-21T14:19:46.518Z"}, {"id": "ev-mvi781pj-rwhl", "digest": "6c4d235c2ff0584a", "version": 1, "set": "triage-bench", "passed": 2, "total": 3, "score": 0.6666666666666666, "threshold": 0.3, "at": "2026-10-21T14:19:46.477Z"}]}], "conditions": [{"condition": "eval", "met": true, "detail": "1/3 on triage-bench (0.3333) is at or above the threshold 0.3", "items": [{"id": "ev-mvi781qn-prb7", "digest": "b7cbc25cb31426b8", "version": 2, "set": "triage-bench", "passed": 1, "total": 3, "score": 0.3333333333333333, "threshold": 0.3, "at": "2026-10-21T14:19:46.518Z"}], "overridden": false}, {"condition": "review", "met": true, "detail": "approved by Rui <rui@ey.com> at 2026-10-21T14:19:46.545Z", "items": [{"id": "rv-b604ed39ed1944b7", "agent": "triage", "digest": "b7cbc25cb31426b8", "version": 2, "verdict": "approved", "note": "policy holds", "by": "Rui <rui@ey.com>", "by_sub": "autox|rui@ey.com", "authors": ["Ada <ada@ey.com>"], "at": "2026-10-21T14:19:46.545Z"}], "overridden": false}, {"condition": "findings", "met": true, "detail": "nothing open for triage", "items": [], "overridden": false}, {"condition": "regression", "met": false, "detail": "b7cbc25cb31426b8 scores 0.3333 on triage-bench, below the deployed predecessor's 0.6667 (version 1)", "items": [{"id": "ev-mvi781qn-prb7", "digest": "b7cbc25cb31426b8", "version": 2, "set": "triage-bench", "passed": 1, "total": 3, "score": 0.3333333333333333, "threshold": 0.3, "at": "2026-10-21T14:19:46.518Z"}, {"id": "ev-mvi781pj-rwhl", "digest": "6c4d235c2ff0584a", "version": 1, "set": "triage-bench", "passed": 2, "total": 3, "score": 0.6666666666666666, "threshold": 0.3, "at": "2026-10-21T14:19:46.477Z"}], "overridden": false}], "agent": "triage", "version": 2, "digest": "b7cbc25cb31426b8", "environment": "production", "decision": "gd-d054ec50954d4c7f"}},
  "deploy_200_override_regression": {"status": 200, "body": {"deployed": true, "id": "triage", "digest": "b7cbc25cb31426b8", "version": 2, "store": "file (db unreachable)", "at": "2026-10-21T14:19:46.550Z", "steps": [{"step": "validate", "ms": 0}, {"step": "gate", "ms": 1}, {"step": "register", "ms": 0}], "environment": "production", "deployment": "dp-4a98a85789314466", "decision": "gd-6a5c2b87f7fd4465", "conditions": [{"condition": "eval", "met": true, "detail": "1/3 on triage-bench (0.3333) is at or above the threshold 0.3", "items": [{"id": "ev-mvi781qn-prb7", "digest": "b7cbc25cb31426b8", "version": 2, "set": "triage-bench", "passed": 1, "total": 3, "score": 0.3333333333333333, "threshold": 0.3, "at": "2026-10-21T14:19:46.518Z"}], "overridden": false}, {"condition": "review", "met": true, "detail": "approved by Rui <rui@ey.com> at 2026-10-21T14:19:46.545Z", "items": [{"id": "rv-b604ed39ed1944b7", "agent": "triage", "digest": "b7cbc25cb31426b8", "version": 2, "verdict": "approved", "note": "policy holds", "by": "Rui <rui@ey.com>", "by_sub": "autox|rui@ey.com", "authors": ["Ada <ada@ey.com>"], "at": "2026-10-21T14:19:46.545Z"}], "overridden": false}, {"condition": "findings", "met": true, "detail": "nothing open for triage", "items": [], "overridden": false}, {"condition": "regression", "met": false, "detail": "b7cbc25cb31426b8 scores 0.3333 on triage-bench, below the deployed predecessor's 0.6667 (version 1)", "items": [{"id": "ev-mvi781qn-prb7", "digest": "b7cbc25cb31426b8", "version": 2, "set": "triage-bench", "passed": 1, "total": 3, "score": 0.3333333333333333, "threshold": 0.3, "at": "2026-10-21T14:19:46.518Z"}, {"id": "ev-mvi781pj-rwhl", "digest": "6c4d235c2ff0584a", "version": 1, "set": "triage-bench", "passed": 2, "total": 3, "score": 0.6666666666666666, "threshold": 0.3, "at": "2026-10-21T14:19:46.477Z"}], "overridden": true}], "override": {"reason": "the old one escalated too much", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.548Z", "passed": ["regression"], "unmet": [{"condition": "regression", "detail": "b7cbc25cb31426b8 scores 0.3333 on triage-bench, below the deployed predecessor's 0.6667 (version 1)"}], "audit_id": 15}}},
  "deploy_409_findings": {"status": 409, "body": {"error": "the promotion gate is not met for \"triage\" version 1 (84a460ab8ddc150f): eval, review, findings", "unmet": [{"condition": "eval", "detail": "spec.evals.dataset names the eval set 'triage-bench', which does not exist", "items": []}, {"condition": "review", "detail": "no policy review of 84a460ab8ddc150f is on record: a reviewer who did not author it approves it at POST /api/agents/triage/reviews", "items": []}, {"condition": "findings", "detail": "5 open findings for triage: tool server crm is pending, not approved; peer vendor-bot is not in the peer registry, so it is not approved; triage: the guardian would block run triage-r1; triage read what scribe wrote: two agents coordinating through a shared store; the estate's breaker on notify.send is open until 2026-10-21T14:24:46Z", "items": [{"kind": "server", "ref": "crm", "detail": "tool server crm is pending, not approved"}, {"kind": "peer", "ref": "vendor-bot", "detail": "peer vendor-bot is not in the peer registry, so it is not approved"}, {"kind": "guardian", "ref": "guardian:g-b328206ab73b4cb4", "detail": "triage: the guardian would block run triage-r1"}, {"kind": "side_channel", "ref": "side_channel:scribe:triage:2026-10-21", "detail": "triage read what scribe wrote: two agents coordinating through a shared store"}, {"kind": "breaker", "ref": "notify.send", "detail": "the estate's breaker on notify.send is open until 2026-10-21T14:24:46Z"}]}], "conditions": [{"condition": "eval", "met": false, "detail": "spec.evals.dataset names the eval set 'triage-bench', which does not exist", "items": [], "overridden": false}, {"condition": "review", "met": false, "detail": "no policy review of 84a460ab8ddc150f is on record: a reviewer who did not author it approves it at POST /api/agents/triage/reviews", "items": [], "overridden": false}, {"condition": "findings", "met": false, "detail": "5 open findings for triage: tool server crm is pending, not approved; peer vendor-bot is not in the peer registry, so it is not approved; triage: the guardian would block run triage-r1; triage read what scribe wrote: two agents coordinating through a shared store; the estate's breaker on notify.send is open until 2026-10-21T14:24:46Z", "items": [{"kind": "server", "ref": "crm", "detail": "tool server crm is pending, not approved"}, {"kind": "peer", "ref": "vendor-bot", "detail": "peer vendor-bot is not in the peer registry, so it is not approved"}, {"kind": "guardian", "ref": "guardian:g-b328206ab73b4cb4", "detail": "triage: the guardian would block run triage-r1"}, {"kind": "side_channel", "ref": "side_channel:scribe:triage:2026-10-21", "detail": "triage read what scribe wrote: two agents coordinating through a shared store"}, {"kind": "breaker", "ref": "notify.send", "detail": "the estate's breaker on notify.send is open until 2026-10-21T14:24:46Z"}], "overridden": false}, {"condition": "regression", "met": true, "detail": "nothing is deployed to production yet: no predecessor to compare", "items": [], "overridden": false}], "agent": "triage", "version": 1, "digest": "84a460ab8ddc150f", "environment": "production", "decision": "gd-fd4a9e0f82c94c71"}},
  "deploy_409_no_suite": {"status": 409, "body": {"error": "the promotion gate is not met for \"bare\" version 1 (ebae6895733c1ab8): eval, review", "unmet": [{"condition": "eval", "detail": "the spec declares no eval suite: set spec.evals.dataset to the eval set it is measured on, and spec.evals.threshold", "items": []}, {"condition": "review", "detail": "no policy review of ebae6895733c1ab8 is on record: a reviewer who did not author it approves it at POST /api/agents/bare/reviews", "items": []}], "conditions": [{"condition": "eval", "met": false, "detail": "the spec declares no eval suite: set spec.evals.dataset to the eval set it is measured on, and spec.evals.threshold", "items": [], "overridden": false}, {"condition": "review", "met": false, "detail": "no policy review of ebae6895733c1ab8 is on record: a reviewer who did not author it approves it at POST /api/agents/bare/reviews", "items": [], "overridden": false}, {"condition": "findings", "met": true, "detail": "nothing open for bare", "items": [], "overridden": false}, {"condition": "regression", "met": true, "detail": "nothing is deployed to production yet: no predecessor to compare", "items": [], "overridden": false}], "agent": "bare", "version": 1, "digest": "ebae6895733c1ab8", "environment": "production", "decision": "gd-fa702eebacb04e61"}},
  "deploy_409_missing_set": {"status": 409, "body": {"error": "the promotion gate is not met for \"lost\" version 1 (adb75a0077cad284): eval, review", "unmet": [{"condition": "eval", "detail": "spec.evals.dataset names the eval set 'missing-set', which does not exist", "items": []}, {"condition": "review", "detail": "no policy review of adb75a0077cad284 is on record: a reviewer who did not author it approves it at POST /api/agents/lost/reviews", "items": []}], "conditions": [{"condition": "eval", "met": false, "detail": "spec.evals.dataset names the eval set 'missing-set', which does not exist", "items": [], "overridden": false}, {"condition": "review", "met": false, "detail": "no policy review of adb75a0077cad284 is on record: a reviewer who did not author it approves it at POST /api/agents/lost/reviews", "items": [], "overridden": false}, {"condition": "findings", "met": true, "detail": "nothing open for lost", "items": [], "overridden": false}, {"condition": "regression", "met": true, "detail": "nothing is deployed to production yet: no predecessor to compare", "items": [], "overridden": false}], "agent": "lost", "version": 1, "digest": "adb75a0077cad284", "environment": "production", "decision": "gd-58e270fa52e745b6"}},
  "save_deploy_409": {"status": 409, "body": {"error": "the promotion gate is not met for \"triage\" version 3 (91e6d338933ab31e): eval, review, regression", "unmet": [{"condition": "eval", "detail": "no eval of 91e6d338933ab31e on triage-bench is on record: run POST /api/agents/triage/evals/run", "items": []}, {"condition": "review", "detail": "no policy review of 91e6d338933ab31e is on record: a reviewer who did not author it approves it at POST /api/agents/triage/reviews", "items": []}, {"condition": "regression", "detail": "no score for 91e6d338933ab31e to set against the deployed predecessor's 0.6667 (version 1)", "items": [{"id": "ev-mvi781l4-vr69", "digest": "90df2dfa5e202811", "version": 1, "set": "triage-bench", "passed": 2, "total": 3, "score": 0.6666666666666666, "threshold": 0.6, "at": "2026-10-21T14:19:46.317Z"}]}], "conditions": [{"condition": "eval", "met": false, "detail": "no eval of 91e6d338933ab31e on triage-bench is on record: run POST /api/agents/triage/evals/run", "items": [], "overridden": false}, {"condition": "review", "met": false, "detail": "no policy review of 91e6d338933ab31e is on record: a reviewer who did not author it approves it at POST /api/agents/triage/reviews", "items": [], "overridden": false}, {"condition": "findings", "met": true, "detail": "nothing open for triage", "items": [], "overridden": false}, {"condition": "regression", "met": false, "detail": "no score for 91e6d338933ab31e to set against the deployed predecessor's 0.6667 (version 1)", "items": [{"id": "ev-mvi781l4-vr69", "digest": "90df2dfa5e202811", "version": 1, "set": "triage-bench", "passed": 2, "total": 3, "score": 0.6666666666666666, "threshold": 0.6, "at": "2026-10-21T14:19:46.317Z"}], "overridden": false}], "agent": "triage", "version": 3, "digest": "91e6d338933ab31e", "environment": "production", "decision": "gd-cd28dffbbcc54394", "saved": {"saved": true, "id": "triage", "digest": "91e6d338933ab31e", "version": 3, "store": "file (db unreachable)", "deployed": false, "deployed_at": "2026-10-21T14:19:46.416Z", "draft": true}}},
  "deploy_staging_200": {"status": 200, "body": {"deployed": true, "id": "triage", "digest": "9a1150cc0d8cc86e", "version": 2, "store": "file (db unreachable)", "at": "2026-10-21T14:19:46.430Z", "steps": [{"step": "validate", "ms": 0}, {"step": "register", "ms": 0}], "environment": "staging", "deployment": "dp-dc8632958c214ced", "decision": "", "conditions": [], "override": null}},
  "deploy_400_canary": {"status": 400, "body": {"error": "environment: canary is configured with PUT /api/agents/triage/canary, not deployed to", "field": "environment"}},
  "save_v1_200": {"status": 200, "body": {"saved": true, "id": "triage", "digest": "90df2dfa5e202811", "version": 1, "store": "file (db unreachable)", "deployed": false, "deployed_at": null, "draft": false}},
  "save_v2_draft": {"status": 200, "body": {"saved": true, "id": "triage", "digest": "9a1150cc0d8cc86e", "version": 2, "store": "file (db unreachable)", "deployed": false, "deployed_at": "2026-10-21T14:19:46.348Z", "draft": true}},
  "agent_detail_draft": {"status": 200, "body": {"id": "triage", "name": "Triage", "description": "Triage an incident.", "spec": {"apiVersion": "agentfactory/v1", "kind": "AgentSystem", "metadata": {"id": "triage", "name": "Triage", "description": "Triage an incident."}, "spec": {"entry": "decide", "nodes": [{"id": "decide", "harness": "sequence", "label": "Decide", "expects": [{"name": "incident", "kind": "string"}], "emits": [{"name": "disposition", "kind": "string"}], "steps": [{"action": "model", "prompt": "Triage {{incident}}", "emits": "disposition"}]}], "edges": [], "evals": {"dataset": "triage-bench", "compare": "disposition", "threshold": 0.6}}}, "store": "file (db unreachable)", "updated_at": "2026-10-21T14:19:46.353Z", "deployed_at": "2026-10-21T14:19:46.348Z", "version": 2, "digest": "9a1150cc0d8cc86e", "deployed_version": 1, "deployed_digest": "90df2dfa5e202811", "spec_version": 1, "retired": null}},
  "versions_draft": {"status": 200, "body": {"id": "triage", "versions": [{"version": 1, "digest": "90df2dfa5e202811", "saved_by": "Ada <ada@ey.com>", "saved_at": "2026-10-21T14:19:46.293Z", "deployed": true, "deployed_at": "2026-10-21T14:19:46.348Z", "nodes": 1, "tools": [], "name": "Triage"}, {"version": 2, "digest": "9a1150cc0d8cc86e", "saved_by": "Ada <ada@ey.com>", "saved_at": "2026-10-21T14:19:46.353Z", "deployed": false, "deployed_at": null, "nodes": 1, "tools": [], "name": "Triage"}], "count": 2, "latest": 2, "deployed": 1}},
  "version_2_doc": {"status": 200, "body": {"version": 2, "digest": "9a1150cc0d8cc86e", "saved_by": "Ada <ada@ey.com>", "saved_at": "2026-10-21T14:19:46.353Z", "deployed": false, "deployed_at": null, "nodes": 1, "tools": [], "name": "Triage", "id": "triage", "spec": {"apiVersion": "agentfactory/v1", "kind": "AgentSystem", "metadata": {"id": "triage", "name": "Triage", "description": "Triage an incident."}, "spec": {"entry": "decide", "nodes": [{"id": "decide", "harness": "sequence", "label": "Decide", "expects": [{"name": "incident", "kind": "string"}], "emits": [{"name": "disposition", "kind": "string"}], "steps": [{"action": "model", "prompt": "Triage again {{incident}}", "emits": "disposition"}]}], "edges": [], "evals": {"dataset": "triage-bench", "compare": "disposition", "threshold": 0.6}}}, "current": false}},
  "version_1_doc": {"status": 200, "body": {"version": 1, "digest": "90df2dfa5e202811", "saved_by": "Ada <ada@ey.com>", "saved_at": "2026-10-21T14:19:46.293Z", "deployed": true, "deployed_at": "2026-10-21T14:19:46.348Z", "nodes": 1, "tools": [], "name": "Triage", "id": "triage", "spec": {"apiVersion": "agentfactory/v1", "kind": "AgentSystem", "metadata": {"id": "triage", "name": "Triage", "description": "Triage an incident."}, "spec": {"entry": "decide", "nodes": [{"id": "decide", "harness": "sequence", "label": "Decide", "expects": [{"name": "incident", "kind": "string"}], "emits": [{"name": "disposition", "kind": "string"}], "steps": [{"action": "model", "prompt": "Triage {{incident}}", "emits": "disposition"}]}], "edges": [], "evals": {"dataset": "triage-bench", "compare": "disposition", "threshold": 0.6}}}, "current": true}},
  "version_404": {"status": 404, "body": {"error": "\"triage\" has no version 9"}},
  "save_adopted_draft": {"status": 200, "body": {"saved": true, "id": "legacy", "digest": "380a78cfdc44f7af", "version": 2, "store": "file (db unreachable)", "deployed": false, "deployed_at": "2026-10-21T14:19:46.576Z", "draft": true}},
  "agent_detail_adopted": {"status": 200, "body": {"id": "legacy", "name": "Triage", "description": "Triage an incident.", "spec": {"apiVersion": "agentfactory/v1", "kind": "AgentSystem", "metadata": {"id": "legacy", "name": "Triage", "description": "Triage an incident."}, "spec": {"entry": "decide", "nodes": [{"id": "decide", "harness": "sequence", "label": "Decide", "expects": [{"name": "incident", "kind": "string"}], "emits": [{"name": "disposition", "kind": "string"}], "steps": [{"action": "model", "prompt": "Triage {{incident}}", "emits": "disposition"}]}], "edges": [], "evals": {"dataset": "triage-bench", "compare": "disposition", "threshold": 0.6}}}, "store": "file (db unreachable)", "updated_at": "2026-10-21T14:19:46.594Z", "deployed_at": "2026-10-21T14:19:46.576Z", "version": 2, "digest": "380a78cfdc44f7af", "deployed_version": 1, "deployed_digest": "ec1f94e0afad135a", "spec_version": 1, "retired": null}},
  "deployments_adopted": {"status": 200, "body": {"agent": "legacy", "deployments": [], "count": 0, "current": {}, "adopted": {"version": 1, "digest": "ec1f94e0afad135a", "deployment": null, "adopted": true}}},
  "lifecycle_adopted": {"status": 200, "body": {"agent": "legacy", "digest": "ec1f94e0afad135a", "version": 1, "current": "designed", "stages": [{"stage": "designed", "lit": true, "at": "2026-10-21T14:19:46.576Z", "by": "Chandresh Singh", "digest": "ec1f94e0afad135a", "version": 1, "record": {"version": 1, "digest": "ec1f94e0afad135a", "saved_by": "Chandresh Singh", "saved_at": "2026-10-21T14:19:46.576Z"}}, {"stage": "reviewed", "lit": false, "at": null, "by": "", "digest": "ec1f94e0afad135a", "version": null, "record": null}, {"stage": "approved", "lit": false, "at": null, "by": "", "digest": "ec1f94e0afad135a", "version": null, "record": null}, {"stage": "canary", "lit": false, "at": null, "by": "", "digest": "ec1f94e0afad135a", "version": null, "record": null}, {"stage": "deployed", "lit": false, "at": null, "by": "", "digest": "ec1f94e0afad135a", "version": null, "record": null}, {"stage": "retired", "lit": false, "at": null, "by": "", "digest": "", "version": null, "record": null}], "deployed": {"version": 1, "digest": "ec1f94e0afad135a", "deployment": null, "adopted": true}, "retired": null}},
  "lifecycle_designed": {"status": 200, "body": {"agent": "triage", "digest": "90df2dfa5e202811", "version": 1, "current": "designed", "stages": [{"stage": "designed", "lit": true, "at": "2026-10-21T14:19:46.293Z", "by": "Ada <ada@ey.com>", "digest": "90df2dfa5e202811", "version": 1, "record": {"version": 1, "digest": "90df2dfa5e202811", "saved_by": "Ada <ada@ey.com>", "saved_at": "2026-10-21T14:19:46.293Z"}}, {"stage": "reviewed", "lit": false, "at": null, "by": "", "digest": "90df2dfa5e202811", "version": null, "record": null}, {"stage": "approved", "lit": false, "at": null, "by": "", "digest": "90df2dfa5e202811", "version": null, "record": null}, {"stage": "canary", "lit": false, "at": null, "by": "", "digest": "90df2dfa5e202811", "version": null, "record": null}, {"stage": "deployed", "lit": false, "at": null, "by": "", "digest": "90df2dfa5e202811", "version": null, "record": null}, {"stage": "retired", "lit": false, "at": null, "by": "", "digest": "", "version": null, "record": null}], "deployed": null, "retired": null}},
  "lifecycle_reviewed": {"status": 200, "body": {"agent": "triage", "digest": "90df2dfa5e202811", "version": 1, "current": "reviewed", "stages": [{"stage": "designed", "lit": true, "at": "2026-10-21T14:19:46.293Z", "by": "Ada <ada@ey.com>", "digest": "90df2dfa5e202811", "version": 1, "record": {"version": 1, "digest": "90df2dfa5e202811", "saved_by": "Ada <ada@ey.com>", "saved_at": "2026-10-21T14:19:46.293Z"}}, {"stage": "reviewed", "lit": true, "at": "2026-10-21T14:19:46.308Z", "by": "Rui <rui@ey.com>", "digest": "90df2dfa5e202811", "version": 1, "record": {"id": "rv-55746879f41e44d6", "agent": "triage", "digest": "90df2dfa5e202811", "version": 1, "verdict": "approved", "note": "policy holds", "by": "Rui <rui@ey.com>", "by_sub": "autox|rui@ey.com", "authors": ["Ada <ada@ey.com>"], "at": "2026-10-21T14:19:46.308Z"}}, {"stage": "approved", "lit": false, "at": null, "by": "", "digest": "90df2dfa5e202811", "version": null, "record": null}, {"stage": "canary", "lit": false, "at": null, "by": "", "digest": "90df2dfa5e202811", "version": null, "record": null}, {"stage": "deployed", "lit": false, "at": null, "by": "", "digest": "90df2dfa5e202811", "version": null, "record": null}, {"stage": "retired", "lit": false, "at": null, "by": "", "digest": "", "version": null, "record": null}], "deployed": null, "retired": null}},
  "lifecycle_deployed": {"status": 200, "body": {"agent": "triage", "digest": "90df2dfa5e202811", "version": 1, "current": "deployed", "stages": [{"stage": "designed", "lit": true, "at": "2026-10-21T14:19:46.293Z", "by": "Ada <ada@ey.com>", "digest": "90df2dfa5e202811", "version": 1, "record": {"version": 1, "digest": "90df2dfa5e202811", "saved_by": "Ada <ada@ey.com>", "saved_at": "2026-10-21T14:19:46.293Z"}}, {"stage": "reviewed", "lit": true, "at": "2026-10-21T14:19:46.308Z", "by": "Rui <rui@ey.com>", "digest": "90df2dfa5e202811", "version": 1, "record": {"id": "rv-55746879f41e44d6", "agent": "triage", "digest": "90df2dfa5e202811", "version": 1, "verdict": "approved", "note": "policy holds", "by": "Rui <rui@ey.com>", "by_sub": "autox|rui@ey.com", "authors": ["Ada <ada@ey.com>"], "at": "2026-10-21T14:19:46.308Z"}}, {"stage": "approved", "lit": true, "at": "2026-10-21T14:19:46.347Z", "by": "Ada <ada@ey.com>", "digest": "90df2dfa5e202811", "version": 1, "record": {"id": "gd-5b754c7f50894ab1", "agent": "triage", "digest": "90df2dfa5e202811", "version": 1, "environment": "production", "passed": true, "unmet": [], "override": null, "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.347Z"}}, {"stage": "canary", "lit": false, "at": null, "by": "", "digest": "90df2dfa5e202811", "version": null, "record": null}, {"stage": "deployed", "lit": true, "at": "2026-10-21T14:19:46.347Z", "by": "Ada <ada@ey.com>", "digest": "90df2dfa5e202811", "version": 1, "record": {"id": "dp-9ac1778f1fe943f8", "agent": "triage", "environment": "production", "version": 1, "digest": "90df2dfa5e202811", "kind": "deploy", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.347Z", "reason": "", "override": null, "decision": "gd-5b754c7f50894ab1", "eval_run": "ev-mvi781l4-vr69", "review": "rv-55746879f41e44d6", "previous": null, "flagged": [], "current": true}}, {"stage": "retired", "lit": false, "at": null, "by": "", "digest": "", "version": null, "record": null}], "deployed": {"version": 1, "digest": "90df2dfa5e202811", "deployment": {"id": "dp-9ac1778f1fe943f8", "agent": "triage", "environment": "production", "version": 1, "digest": "90df2dfa5e202811", "kind": "deploy", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.347Z", "reason": "", "override": null, "decision": "gd-5b754c7f50894ab1", "eval_run": "ev-mvi781l4-vr69", "review": "rv-55746879f41e44d6", "previous": null, "flagged": []}, "adopted": false}, "retired": null}},
  "lifecycle_draft": {"status": 200, "body": {"agent": "triage", "digest": "9a1150cc0d8cc86e", "version": 2, "current": "designed", "stages": [{"stage": "designed", "lit": true, "at": "2026-10-21T14:19:46.353Z", "by": "Ada <ada@ey.com>", "digest": "9a1150cc0d8cc86e", "version": 2, "record": {"version": 2, "digest": "9a1150cc0d8cc86e", "saved_by": "Ada <ada@ey.com>", "saved_at": "2026-10-21T14:19:46.353Z"}}, {"stage": "reviewed", "lit": false, "at": null, "by": "", "digest": "9a1150cc0d8cc86e", "version": null, "record": null}, {"stage": "approved", "lit": false, "at": null, "by": "", "digest": "9a1150cc0d8cc86e", "version": null, "record": null}, {"stage": "canary", "lit": false, "at": null, "by": "", "digest": "9a1150cc0d8cc86e", "version": null, "record": null}, {"stage": "deployed", "lit": false, "at": null, "by": "", "digest": "9a1150cc0d8cc86e", "version": null, "record": null}, {"stage": "retired", "lit": false, "at": null, "by": "", "digest": "", "version": null, "record": null}], "deployed": {"version": 1, "digest": "90df2dfa5e202811", "deployment": {"id": "dp-9ac1778f1fe943f8", "agent": "triage", "environment": "production", "version": 1, "digest": "90df2dfa5e202811", "kind": "deploy", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.347Z", "reason": "", "override": null, "decision": "gd-5b754c7f50894ab1", "eval_run": "ev-mvi781l4-vr69", "review": "rv-55746879f41e44d6", "previous": null, "flagged": []}, "adopted": false}, "retired": null}},
  "lifecycle_overridden": {"status": 200, "body": {"agent": "triage", "digest": "9a1150cc0d8cc86e", "version": 2, "current": "deployed", "stages": [{"stage": "designed", "lit": true, "at": "2026-10-21T14:19:46.353Z", "by": "Ada <ada@ey.com>", "digest": "9a1150cc0d8cc86e", "version": 2, "record": {"version": 2, "digest": "9a1150cc0d8cc86e", "saved_by": "Ada <ada@ey.com>", "saved_at": "2026-10-21T14:19:46.353Z"}}, {"stage": "reviewed", "lit": false, "at": null, "by": "", "digest": "9a1150cc0d8cc86e", "version": null, "record": null}, {"stage": "approved", "lit": true, "at": "2026-10-21T14:19:46.370Z", "by": "Ada <ada@ey.com>", "digest": "9a1150cc0d8cc86e", "version": 2, "record": {"id": "gd-d88af9436bf84bce", "agent": "triage", "digest": "9a1150cc0d8cc86e", "version": 2, "environment": "production", "passed": true, "unmet": [], "override": {"reason": "hotfix for INC-77", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.370Z", "passed": ["eval", "review", "regression"], "unmet": [{"condition": "eval", "detail": "no eval of 9a1150cc0d8cc86e on triage-bench is on record: run POST /api/agents/triage/evals/run"}, {"condition": "review", "detail": "no policy review of 9a1150cc0d8cc86e is on record: a reviewer who did not author it approves it at POST /api/agents/triage/reviews"}, {"condition": "regression", "detail": "no score for 9a1150cc0d8cc86e to set against the deployed predecessor's 0.6667 (version 1)"}], "audit_id": 26}, "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.370Z"}}, {"stage": "canary", "lit": false, "at": null, "by": "", "digest": "9a1150cc0d8cc86e", "version": null, "record": null}, {"stage": "deployed", "lit": true, "at": "2026-10-21T14:19:46.370Z", "by": "Ada <ada@ey.com>", "digest": "9a1150cc0d8cc86e", "version": 2, "record": {"id": "dp-c1ad4a58de7b4036", "agent": "triage", "environment": "production", "version": 2, "digest": "9a1150cc0d8cc86e", "kind": "deploy", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.370Z", "reason": "", "override": {"reason": "hotfix for INC-77", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.370Z", "passed": ["eval", "review", "regression"], "unmet": [{"condition": "eval", "detail": "no eval of 9a1150cc0d8cc86e on triage-bench is on record: run POST /api/agents/triage/evals/run"}, {"condition": "review", "detail": "no policy review of 9a1150cc0d8cc86e is on record: a reviewer who did not author it approves it at POST /api/agents/triage/reviews"}, {"condition": "regression", "detail": "no score for 9a1150cc0d8cc86e to set against the deployed predecessor's 0.6667 (version 1)"}], "audit_id": 26}, "decision": "gd-d88af9436bf84bce", "eval_run": "", "review": "", "previous": {"version": 1, "digest": "90df2dfa5e202811", "deployment": "dp-9ac1778f1fe943f8", "adopted": false}, "flagged": [], "current": true}}, {"stage": "retired", "lit": false, "at": null, "by": "", "digest": "", "version": null, "record": null}], "deployed": {"version": 2, "digest": "9a1150cc0d8cc86e", "deployment": {"id": "dp-c1ad4a58de7b4036", "agent": "triage", "environment": "production", "version": 2, "digest": "9a1150cc0d8cc86e", "kind": "deploy", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.370Z", "reason": "", "override": {"reason": "hotfix for INC-77", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.370Z", "passed": ["eval", "review", "regression"], "unmet": [{"condition": "eval", "detail": "no eval of 9a1150cc0d8cc86e on triage-bench is on record: run POST /api/agents/triage/evals/run"}, {"condition": "review", "detail": "no policy review of 9a1150cc0d8cc86e is on record: a reviewer who did not author it approves it at POST /api/agents/triage/reviews"}, {"condition": "regression", "detail": "no score for 9a1150cc0d8cc86e to set against the deployed predecessor's 0.6667 (version 1)"}], "audit_id": 26}, "decision": "gd-d88af9436bf84bce", "eval_run": "", "review": "", "previous": {"version": 1, "digest": "90df2dfa5e202811", "deployment": "dp-9ac1778f1fe943f8", "adopted": false}, "flagged": []}, "adopted": false}, "retired": null}},
  "lifecycle_after_rollback": {"status": 200, "body": {"agent": "triage", "digest": "9a1150cc0d8cc86e", "version": 2, "current": "deployed", "stages": [{"stage": "designed", "lit": true, "at": "2026-10-21T14:19:46.353Z", "by": "Ada <ada@ey.com>", "digest": "9a1150cc0d8cc86e", "version": 2, "record": {"version": 2, "digest": "9a1150cc0d8cc86e", "saved_by": "Ada <ada@ey.com>", "saved_at": "2026-10-21T14:19:46.353Z"}}, {"stage": "reviewed", "lit": false, "at": null, "by": "", "digest": "9a1150cc0d8cc86e", "version": null, "record": null}, {"stage": "approved", "lit": true, "at": "2026-10-21T14:19:46.370Z", "by": "Ada <ada@ey.com>", "digest": "9a1150cc0d8cc86e", "version": 2, "record": {"id": "gd-d88af9436bf84bce", "agent": "triage", "digest": "9a1150cc0d8cc86e", "version": 2, "environment": "production", "passed": true, "unmet": [], "override": {"reason": "hotfix for INC-77", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.370Z", "passed": ["eval", "review", "regression"], "unmet": [{"condition": "eval", "detail": "no eval of 9a1150cc0d8cc86e on triage-bench is on record: run POST /api/agents/triage/evals/run"}, {"condition": "review", "detail": "no policy review of 9a1150cc0d8cc86e is on record: a reviewer who did not author it approves it at POST /api/agents/triage/reviews"}, {"condition": "regression", "detail": "no score for 9a1150cc0d8cc86e to set against the deployed predecessor's 0.6667 (version 1)"}], "audit_id": 26}, "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.370Z"}}, {"stage": "canary", "lit": false, "at": null, "by": "", "digest": "9a1150cc0d8cc86e", "version": null, "record": null}, {"stage": "deployed", "lit": true, "at": "2026-10-21T14:19:46.370Z", "by": "Ada <ada@ey.com>", "digest": "9a1150cc0d8cc86e", "version": 2, "record": {"id": "dp-c1ad4a58de7b4036", "agent": "triage", "environment": "production", "version": 2, "digest": "9a1150cc0d8cc86e", "kind": "deploy", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.370Z", "reason": "", "override": {"reason": "hotfix for INC-77", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.370Z", "passed": ["eval", "review", "regression"], "unmet": [{"condition": "eval", "detail": "no eval of 9a1150cc0d8cc86e on triage-bench is on record: run POST /api/agents/triage/evals/run"}, {"condition": "review", "detail": "no policy review of 9a1150cc0d8cc86e is on record: a reviewer who did not author it approves it at POST /api/agents/triage/reviews"}, {"condition": "regression", "detail": "no score for 9a1150cc0d8cc86e to set against the deployed predecessor's 0.6667 (version 1)"}], "audit_id": 26}, "decision": "gd-d88af9436bf84bce", "eval_run": "", "review": "", "previous": {"version": 1, "digest": "90df2dfa5e202811", "deployment": "dp-9ac1778f1fe943f8", "adopted": false}, "flagged": [], "current": false}}, {"stage": "retired", "lit": false, "at": null, "by": "", "digest": "", "version": null, "record": null}], "deployed": {"version": 1, "digest": "90df2dfa5e202811", "deployment": {"id": "dp-38e9898f4fc04820", "agent": "triage", "environment": "production", "version": 1, "digest": "90df2dfa5e202811", "kind": "rollback", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.415Z", "reason": "v2 escalates everything", "override": null, "decision": "", "eval_run": "ev-mvi781l4-vr69", "review": "", "previous": {"version": 2, "digest": "9a1150cc0d8cc86e", "deployment": "dp-c1ad4a58de7b4036", "adopted": false}, "flagged": ["triage-2026-10-21T14-19-46-tuqz", "triage-2026-10-21T14-19-46-uxdd"]}, "adopted": false}, "retired": null}},
  "lifecycle_v1": {"status": 200, "body": {"agent": "triage", "digest": "90df2dfa5e202811", "version": 1, "current": "deployed", "stages": [{"stage": "designed", "lit": true, "at": "2026-10-21T14:19:46.293Z", "by": "Ada <ada@ey.com>", "digest": "90df2dfa5e202811", "version": 1, "record": {"version": 1, "digest": "90df2dfa5e202811", "saved_by": "Ada <ada@ey.com>", "saved_at": "2026-10-21T14:19:46.293Z"}}, {"stage": "reviewed", "lit": true, "at": "2026-10-21T14:19:46.308Z", "by": "Rui <rui@ey.com>", "digest": "90df2dfa5e202811", "version": 1, "record": {"id": "rv-55746879f41e44d6", "agent": "triage", "digest": "90df2dfa5e202811", "version": 1, "verdict": "approved", "note": "policy holds", "by": "Rui <rui@ey.com>", "by_sub": "autox|rui@ey.com", "authors": ["Ada <ada@ey.com>"], "at": "2026-10-21T14:19:46.308Z"}}, {"stage": "approved", "lit": true, "at": "2026-10-21T14:19:46.347Z", "by": "Ada <ada@ey.com>", "digest": "90df2dfa5e202811", "version": 1, "record": {"id": "gd-5b754c7f50894ab1", "agent": "triage", "digest": "90df2dfa5e202811", "version": 1, "environment": "production", "passed": true, "unmet": [], "override": null, "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.347Z"}}, {"stage": "canary", "lit": false, "at": null, "by": "", "digest": "90df2dfa5e202811", "version": null, "record": null}, {"stage": "deployed", "lit": true, "at": "2026-10-21T14:19:46.415Z", "by": "Ada <ada@ey.com>", "digest": "90df2dfa5e202811", "version": 1, "record": {"id": "dp-38e9898f4fc04820", "agent": "triage", "environment": "production", "version": 1, "digest": "90df2dfa5e202811", "kind": "rollback", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.415Z", "reason": "v2 escalates everything", "override": null, "decision": "", "eval_run": "ev-mvi781l4-vr69", "review": "", "previous": {"version": 2, "digest": "9a1150cc0d8cc86e", "deployment": "dp-c1ad4a58de7b4036", "adopted": false}, "flagged": ["triage-2026-10-21T14-19-46-tuqz", "triage-2026-10-21T14-19-46-uxdd"], "current": true}}, {"stage": "retired", "lit": false, "at": null, "by": "", "digest": "", "version": null, "record": null}], "deployed": {"version": 1, "digest": "90df2dfa5e202811", "deployment": {"id": "dp-38e9898f4fc04820", "agent": "triage", "environment": "production", "version": 1, "digest": "90df2dfa5e202811", "kind": "rollback", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.415Z", "reason": "v2 escalates everything", "override": null, "decision": "", "eval_run": "ev-mvi781l4-vr69", "review": "", "previous": {"version": 2, "digest": "9a1150cc0d8cc86e", "deployment": "dp-c1ad4a58de7b4036", "adopted": false}, "flagged": ["triage-2026-10-21T14-19-46-tuqz", "triage-2026-10-21T14-19-46-uxdd"]}, "adopted": false}, "retired": null}},
  "lifecycle_retired": {"status": 200, "body": {"agent": "triage", "digest": "91e6d338933ab31e", "version": 3, "current": "retired", "stages": [{"stage": "designed", "lit": true, "at": "2026-10-21T14:19:46.433Z", "by": "Ada <ada@ey.com>", "digest": "91e6d338933ab31e", "version": 3, "record": {"version": 3, "digest": "91e6d338933ab31e", "saved_by": "Ada <ada@ey.com>", "saved_at": "2026-10-21T14:19:46.433Z"}}, {"stage": "reviewed", "lit": false, "at": null, "by": "", "digest": "91e6d338933ab31e", "version": null, "record": null}, {"stage": "approved", "lit": false, "at": null, "by": "", "digest": "91e6d338933ab31e", "version": null, "record": null}, {"stage": "canary", "lit": false, "at": null, "by": "", "digest": "91e6d338933ab31e", "version": null, "record": null}, {"stage": "deployed", "lit": false, "at": null, "by": "", "digest": "91e6d338933ab31e", "version": null, "record": null}, {"stage": "retired", "lit": true, "at": "2026-10-21T14:19:46.440Z", "by": "Ada <ada@ey.com>", "digest": "", "version": null, "record": {"id": "rt-b0376f9f80274f3a", "agent": "triage", "reason": "superseded by the next triage", "replacement": "triage-next", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.440Z"}}], "deployed": {"version": 1, "digest": "90df2dfa5e202811", "deployment": {"id": "dp-38e9898f4fc04820", "agent": "triage", "environment": "production", "version": 1, "digest": "90df2dfa5e202811", "kind": "rollback", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.415Z", "reason": "v2 escalates everything", "override": null, "decision": "", "eval_run": "ev-mvi781l4-vr69", "review": "", "previous": {"version": 2, "digest": "9a1150cc0d8cc86e", "deployment": "dp-c1ad4a58de7b4036", "adopted": false}, "flagged": ["triage-2026-10-21T14-19-46-tuqz", "triage-2026-10-21T14-19-46-uxdd"]}, "adopted": false}, "retired": {"id": "rt-b0376f9f80274f3a", "agent": "triage", "reason": "superseded by the next triage", "replacement": "triage-next", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.440Z"}}},
  "lifecycle_404_digest": {"status": 404, "body": {"error": "no version of \"triage\" carries digest 0000000000000000", "field": "digest"}},
  "deployments_one": {"status": 200, "body": {"agent": "triage", "deployments": [{"id": "dp-9ac1778f1fe943f8", "agent": "triage", "environment": "production", "version": 1, "digest": "90df2dfa5e202811", "kind": "deploy", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.347Z", "reason": "", "override": null, "decision": "gd-5b754c7f50894ab1", "eval_run": "ev-mvi781l4-vr69", "review": "rv-55746879f41e44d6", "previous": null, "flagged": [], "current": true}], "count": 1, "current": {"production": {"id": "dp-9ac1778f1fe943f8", "agent": "triage", "environment": "production", "version": 1, "digest": "90df2dfa5e202811", "kind": "deploy", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.347Z", "reason": "", "override": null, "decision": "gd-5b754c7f50894ab1", "eval_run": "ev-mvi781l4-vr69", "review": "rv-55746879f41e44d6", "previous": null, "flagged": [], "current": true}}, "adopted": null}},
  "deployments_after_rollback": {"status": 200, "body": {"agent": "triage", "deployments": [{"id": "dp-38e9898f4fc04820", "agent": "triage", "environment": "production", "version": 1, "digest": "90df2dfa5e202811", "kind": "rollback", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.415Z", "reason": "v2 escalates everything", "override": null, "decision": "", "eval_run": "ev-mvi781l4-vr69", "review": "", "previous": {"version": 2, "digest": "9a1150cc0d8cc86e", "deployment": "dp-c1ad4a58de7b4036", "adopted": false}, "flagged": ["triage-2026-10-21T14-19-46-tuqz", "triage-2026-10-21T14-19-46-uxdd"], "current": true}, {"id": "dp-c1ad4a58de7b4036", "agent": "triage", "environment": "production", "version": 2, "digest": "9a1150cc0d8cc86e", "kind": "deploy", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.370Z", "reason": "", "override": {"reason": "hotfix for INC-77", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.370Z", "passed": ["eval", "review", "regression"], "unmet": [{"condition": "eval", "detail": "no eval of 9a1150cc0d8cc86e on triage-bench is on record: run POST /api/agents/triage/evals/run"}, {"condition": "review", "detail": "no policy review of 9a1150cc0d8cc86e is on record: a reviewer who did not author it approves it at POST /api/agents/triage/reviews"}, {"condition": "regression", "detail": "no score for 9a1150cc0d8cc86e to set against the deployed predecessor's 0.6667 (version 1)"}], "audit_id": 26}, "decision": "gd-d88af9436bf84bce", "eval_run": "", "review": "", "previous": {"version": 1, "digest": "90df2dfa5e202811", "deployment": "dp-9ac1778f1fe943f8", "adopted": false}, "flagged": [], "current": false}, {"id": "dp-9ac1778f1fe943f8", "agent": "triage", "environment": "production", "version": 1, "digest": "90df2dfa5e202811", "kind": "deploy", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.347Z", "reason": "", "override": null, "decision": "gd-5b754c7f50894ab1", "eval_run": "ev-mvi781l4-vr69", "review": "rv-55746879f41e44d6", "previous": null, "flagged": [], "current": false}], "count": 3, "current": {"production": {"id": "dp-38e9898f4fc04820", "agent": "triage", "environment": "production", "version": 1, "digest": "90df2dfa5e202811", "kind": "rollback", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.415Z", "reason": "v2 escalates everything", "override": null, "decision": "", "eval_run": "ev-mvi781l4-vr69", "review": "", "previous": {"version": 2, "digest": "9a1150cc0d8cc86e", "deployment": "dp-c1ad4a58de7b4036", "adopted": false}, "flagged": ["triage-2026-10-21T14-19-46-tuqz", "triage-2026-10-21T14-19-46-uxdd"], "current": true}}, "adopted": null}},
  "deployments_envs": {"status": 200, "body": {"agent": "triage", "deployments": [{"id": "dp-dc8632958c214ced", "agent": "triage", "environment": "staging", "version": 2, "digest": "9a1150cc0d8cc86e", "kind": "deploy", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.430Z", "reason": "", "override": null, "decision": "", "eval_run": "", "review": "", "previous": null, "flagged": [], "current": true}, {"id": "dp-38e9898f4fc04820", "agent": "triage", "environment": "production", "version": 1, "digest": "90df2dfa5e202811", "kind": "rollback", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.415Z", "reason": "v2 escalates everything", "override": null, "decision": "", "eval_run": "ev-mvi781l4-vr69", "review": "", "previous": {"version": 2, "digest": "9a1150cc0d8cc86e", "deployment": "dp-c1ad4a58de7b4036", "adopted": false}, "flagged": ["triage-2026-10-21T14-19-46-tuqz", "triage-2026-10-21T14-19-46-uxdd"], "current": true}, {"id": "dp-c1ad4a58de7b4036", "agent": "triage", "environment": "production", "version": 2, "digest": "9a1150cc0d8cc86e", "kind": "deploy", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.370Z", "reason": "", "override": {"reason": "hotfix for INC-77", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.370Z", "passed": ["eval", "review", "regression"], "unmet": [{"condition": "eval", "detail": "no eval of 9a1150cc0d8cc86e on triage-bench is on record: run POST /api/agents/triage/evals/run"}, {"condition": "review", "detail": "no policy review of 9a1150cc0d8cc86e is on record: a reviewer who did not author it approves it at POST /api/agents/triage/reviews"}, {"condition": "regression", "detail": "no score for 9a1150cc0d8cc86e to set against the deployed predecessor's 0.6667 (version 1)"}], "audit_id": 26}, "decision": "gd-d88af9436bf84bce", "eval_run": "", "review": "", "previous": {"version": 1, "digest": "90df2dfa5e202811", "deployment": "dp-9ac1778f1fe943f8", "adopted": false}, "flagged": [], "current": false}, {"id": "dp-9ac1778f1fe943f8", "agent": "triage", "environment": "production", "version": 1, "digest": "90df2dfa5e202811", "kind": "deploy", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.347Z", "reason": "", "override": null, "decision": "gd-5b754c7f50894ab1", "eval_run": "ev-mvi781l4-vr69", "review": "rv-55746879f41e44d6", "previous": null, "flagged": [], "current": false}], "count": 4, "current": {"staging": {"id": "dp-dc8632958c214ced", "agent": "triage", "environment": "staging", "version": 2, "digest": "9a1150cc0d8cc86e", "kind": "deploy", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.430Z", "reason": "", "override": null, "decision": "", "eval_run": "", "review": "", "previous": null, "flagged": [], "current": true}, "production": {"id": "dp-38e9898f4fc04820", "agent": "triage", "environment": "production", "version": 1, "digest": "90df2dfa5e202811", "kind": "rollback", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.415Z", "reason": "v2 escalates everything", "override": null, "decision": "", "eval_run": "ev-mvi781l4-vr69", "review": "", "previous": {"version": 2, "digest": "9a1150cc0d8cc86e", "deployment": "dp-c1ad4a58de7b4036", "adopted": false}, "flagged": ["triage-2026-10-21T14-19-46-tuqz", "triage-2026-10-21T14-19-46-uxdd"], "current": true}}, "adopted": null}},
  "rollback_400_reason": {"status": 400, "body": {"error": "bad request: body.reason: String should have at least 1 character", "field": "reason"}},
  "rollback_404_version": {"status": 404, "body": {"error": "\"triage\" has no version 9", "field": "to_version"}},
  "rollback_200": {"status": 200, "body": {"agent": "triage", "environment": "production", "from": {"version": 2, "digest": "9a1150cc0d8cc86e"}, "to": {"version": 1, "digest": "90df2dfa5e202811"}, "reason": "v2 escalates everything", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.415Z", "flagged": ["triage-2026-10-21T14-19-46-tuqz", "triage-2026-10-21T14-19-46-uxdd"], "count": 2, "deployment": {"id": "dp-38e9898f4fc04820", "agent": "triage", "environment": "production", "version": 1, "digest": "90df2dfa5e202811", "kind": "rollback", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.415Z", "reason": "v2 escalates everything", "override": null, "decision": "", "eval_run": "ev-mvi781l4-vr69", "review": "", "previous": {"version": 2, "digest": "9a1150cc0d8cc86e", "deployment": "dp-c1ad4a58de7b4036", "adopted": false}, "flagged": ["triage-2026-10-21T14-19-46-tuqz", "triage-2026-10-21T14-19-46-uxdd"], "current": true}, "audit_id": 33}},
  "rollback_409_already": {"status": 409, "body": {"error": "version 1 is what production runs now", "field": "to_version"}},
  "rollback_409_never": {"status": 409, "body": {"error": "version 3 of \"triage\" was never deployed: a rollback reinstates a version that ran in production; deploy it through the gate instead", "field": "to_version"}},
  "rollback_409_retired": {"status": 409, "body": {"error": "\"triage\" is retired: superseded by the next triage (by Ada <ada@ey.com>, 2026-10-21T14:19:46.440Z). It takes no new runs or triggers; its runs and versions stay readable. Its replacement is \"triage-next\".", "control": "retired", "retired": {"id": "rt-b0376f9f80274f3a", "agent": "triage", "reason": "superseded by the next triage", "replacement": "triage-next", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.440Z"}}},
  "run_flagged": {"status": 200, "body": {"id": "triage-2026-10-21T14-19-46-tuqz", "system": "triage", "spec_digest": "9a1150cc0d8cc86e", "trace_id": "t-4bc8e2e03dcc41e8", "state": "done", "values": {"$input": {"incident": "INC-1"}, "decide": {"disposition": "ESCALATE"}}, "skipped": [], "visits": {"decide": 1}, "spent": {"tool_calls": 0, "tokens": 1100, "cost_usd": 0.0, "wall_clock_s": 0.017}, "suspension": null, "error": "", "result": {"disposition": "ESCALATE"}, "journal": {"run_id": "triage-2026-10-21T14-19-46-tuqz", "system": "triage", "spec_digest": "9a1150cc0d8cc86e", "duration_ms": 16, "entries": [{"t": 0, "kind": "run.start", "node": "", "title": "Run triage-2026-10-21T14-19-46-tuqz", "detail": "", "data": {"system": "triage", "spec_digest": "9a1150cc0d8cc86e", "trace_id": "t-4bc8e2e03dcc41e8"}, "because": [], "id": "fa6dbee57565", "tainted": false}, {"t": 0, "kind": "node.enter", "node": "decide", "title": "Decide", "detail": "sequence · 1 steps", "data": {"inputs": {"incident": "INC-1"}}, "because": [], "id": "5e046e18613b", "tainted": false}, {"t": 16, "kind": "model.call", "node": "decide", "title": "scripted", "detail": "ESCALATE", "data": {"prompt": "Triage again INC-1", "intents": [], "tokens": {"in": 1000, "out": 100}, "ms": 0}, "because": ["5e046e18613b"], "id": "04c8c3917800", "tainted": false}, {"t": 16, "kind": "node.exit", "node": "decide", "title": "Decide complete", "detail": "", "data": {"emitted": {"disposition": "ESCALATE"}}, "because": ["5e046e18613b", "04c8c3917800"], "id": "7898c7861a15", "tainted": false}, {"t": 16, "kind": "run.end", "node": "", "title": "Run complete", "detail": "1 nodes ran, 0 skipped, 0 refused actions", "data": {"result": {"disposition": "ESCALATE"}, "skipped": [], "denied": 0}, "because": [], "id": "41bb368149d0", "tainted": false}]}, "started_at": "2026-10-21T14:19:46.391Z", "finished_at": "2026-10-21T14:19:46.409Z", "agent": "triage", "spec": {"apiVersion": "agentfactory/v1", "kind": "AgentSystem", "metadata": {"id": "triage", "name": "Triage", "description": "Triage an incident."}, "spec": {"entry": "decide", "nodes": [{"id": "decide", "harness": "sequence", "label": "Decide", "expects": [{"name": "incident", "kind": "string"}], "emits": [{"name": "disposition", "kind": "string"}], "steps": [{"action": "model", "prompt": "Triage again {{incident}}", "emits": "disposition"}]}], "edges": [], "evals": {"dataset": "triage-bench", "compare": "disposition", "threshold": 0.6}}}, "provider": "scripted", "model": "scripted", "kill": null, "review": {"flag": "rolled_back", "from": {"version": 2, "digest": "9a1150cc0d8cc86e"}, "to": {"version": 1, "digest": "90df2dfa5e202811"}, "reason": "v2 escalates everything", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.415Z"}}},
  "retire_400_replacement": {"status": 400, "body": {"error": "replacement: another agent's id", "field": "replacement"}},
  "retire_404_replacement": {"status": 404, "body": {"error": "replacement: no saved agent \"nobody\"", "field": "replacement"}},
  "retire_400_reason": {"status": 400, "body": {"error": "bad request: body.reason: String should have at least 1 character", "field": "reason"}},
  "retire_201": {"status": 201, "body": {"agent": "triage", "reason": "superseded by the next triage", "replacement": "triage-next", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.440Z", "cancelled_jobs": [], "audit_id": 45}},
  "retire_409_again": {"status": 409, "body": {"error": "\"triage\" is retired: superseded by the next triage (by Ada <ada@ey.com>, 2026-10-21T14:19:46.440Z). It takes no new runs or triggers; its runs and versions stay readable. Its replacement is \"triage-next\".", "control": "retired", "retired": {"id": "rt-b0376f9f80274f3a", "agent": "triage", "reason": "superseded by the next triage", "replacement": "triage-next", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.440Z"}}},
  "deploy_409_retired": {"status": 409, "body": {"error": "\"triage\" is retired: superseded by the next triage (by Ada <ada@ey.com>, 2026-10-21T14:19:46.440Z). It takes no new runs or triggers; its runs and versions stay readable. Its replacement is \"triage-next\".", "control": "retired", "retired": {"id": "rt-b0376f9f80274f3a", "agent": "triage", "reason": "superseded by the next triage", "replacement": "triage-next", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.440Z"}}},
  "runs_409_retired": {"status": 409, "body": {"error": "\"triage\" is retired: superseded by the next triage (by Ada <ada@ey.com>, 2026-10-21T14:19:46.440Z). It takes no new runs or triggers; its runs and versions stay readable. Its replacement is \"triage-next\".", "control": "retired", "retired": {"id": "rt-b0376f9f80274f3a", "agent": "triage", "reason": "superseded by the next triage", "replacement": "triage-next", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.440Z"}}},
  "agents_list_retired": {"status": 200, "body": {"agents": [{"id": "triage-next", "name": "Triage", "description": "Triage an incident.", "nodes": 1, "trigger": "prompt", "updated_at": "2026-10-21T14:19:46.436Z", "deployed_at": null, "version": 1, "digest": "5c64fd68190042d6", "deployed_version": null, "deployed_digest": "", "retired": null}, {"id": "triage", "name": "Triage", "description": "Triage an incident.", "nodes": 1, "trigger": "prompt", "updated_at": "2026-10-21T14:19:46.433Z", "deployed_at": "2026-10-21T14:19:46.416Z", "version": 3, "digest": "91e6d338933ab31e", "deployed_version": 1, "deployed_digest": "90df2dfa5e202811", "retired": {"id": "rt-b0376f9f80274f3a", "agent": "triage", "reason": "superseded by the next triage", "replacement": "triage-next", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.440Z"}}], "count": 2, "store": "file (db unreachable)", "spec": null}},
  "agent_detail_retired": {"status": 200, "body": {"id": "triage", "name": "Triage", "description": "Triage an incident.", "spec": {"apiVersion": "agentfactory/v1", "kind": "AgentSystem", "metadata": {"id": "triage", "name": "Triage", "description": "Triage an incident."}, "spec": {"entry": "decide", "nodes": [{"id": "decide", "harness": "sequence", "label": "Decide", "expects": [{"name": "incident", "kind": "string"}], "emits": [{"name": "disposition", "kind": "string"}], "steps": [{"action": "model", "prompt": "Triage {{incident}}", "emits": "disposition"}]}], "edges": [], "evals": {"dataset": "triage-bench", "compare": "disposition", "threshold": 0.6}}}, "store": "file (db unreachable)", "updated_at": "2026-10-21T14:19:46.433Z", "deployed_at": "2026-10-21T14:19:46.416Z", "version": 3, "digest": "91e6d338933ab31e", "deployed_version": 1, "deployed_digest": "90df2dfa5e202811", "spec_version": 1, "retired": {"id": "rt-b0376f9f80274f3a", "agent": "triage", "reason": "superseded by the next triage", "replacement": "triage-next", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.440Z"}}},
  "retire_201_jobs": {"status": 201, "body": {"agent": "intake", "reason": "replaced by triage", "replacement": "triage", "by": "Chandresh Singh", "at": "2026-10-21T14:19:46.618Z", "cancelled_jobs": ["1e4e9411-10e0-425f-9a3a-f18fcbcd4259"], "audit_id": 5}},
  "job_cancelled_retired": {"status": 200, "body": {"job": "1e4e9411-10e0-425f-9a3a-f18fcbcd4259", "agent": "intake", "status": "cancelled", "external_id": null, "source": "ops", "attempts": 0, "max_attempts": 3, "run_id": null, "trace_id": "", "result": null, "error": null, "dead": false, "claimed_by": null, "lease_until": null, "created_at": "2026-10-21T14:19:46.614Z", "started_at": null, "finished_at": "2026-10-21T14:19:46.618Z", "status_url": "/api/trigger/intake/jobs/1e4e9411-10e0-425f-9a3a-f18fcbcd4259", "run_url": null, "parent_run": null, "cancel_reason": "the agent was retired by Chandresh Singh: replaced by triage", "taint": null}},
  "trigger_409_retired": {"status": 409, "body": {"error": "\"intake\" is retired: replaced by triage (by Chandresh Singh, 2026-10-21T14:19:46.618Z). It takes no new runs or triggers; its runs and versions stay readable. Its replacement is \"triage\".", "control": "retired", "retired": {"id": "rt-ffc70fb1fccb48fc", "agent": "intake", "reason": "replaced by triage", "replacement": "triage", "by": "Chandresh Singh", "at": "2026-10-21T14:19:46.618Z"}}},
  "queue_after_retire": {"status": 200, "body": {"depth": 0, "oldest_age_s": null, "agents": {"intake": {"queued": 0, "running": 0, "done": 0, "failed": 0, "suspended": 0, "cancelled": 1, "dead": 0, "oldest_queued": null}}, "workers": [], "dead_letters": [], "schedules": [], "last_hour": {"finished": 0, "failed": 0, "avg_ms": null}, "scheduler": false}},
  "attention_override": {"status": 200, "body": {"items": [{"id": "override:dp-c1ad4a58de7b4036", "kind": "override", "severity": 6, "age_s": 0.0, "rank": 6.0, "title": "triage: version 2 deployed past the promotion gate by Ada <ada@ey.com> (eval, review, regression)", "detail": "reason: hotfix for INC-77; eval: no eval of 9a1150cc0d8cc86e on triage-bench is on record: run POST /api/agents/triage/evals/run; review: no policy review of 9a1150cc0d8cc86e is on record: a reviewer who did not author it approves it at POST /api/agents/triage/reviews; regression: no score for 9a1150cc0d8cc86e to set against the deployed predecessor's 0.6667 (version 1)", "agent": "triage", "run": "", "job": "", "since": "2026-10-21T14:19:46.370Z", "deadline": null, "holds": "", "action": {"method": "GET", "path": "/api/agents/triage/lifecycle?digest=9a1150cc0d8cc86e", "body": null, "says": "review what the override passed: run the eval, sign the review, or close the findings, so the gate holds on its own records"}, "agents": ["triage"], "runs": [], "data": {"deployment": "dp-c1ad4a58de7b4036", "version": 2, "digest": "9a1150cc0d8cc86e", "environment": "production", "override": {"reason": "hotfix for INC-77", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.370Z", "passed": ["eval", "review", "regression"], "unmet": [{"condition": "eval", "detail": "no eval of 9a1150cc0d8cc86e on triage-bench is on record: run POST /api/agents/triage/evals/run"}, {"condition": "review", "detail": "no policy review of 9a1150cc0d8cc86e is on record: a reviewer who did not author it approves it at POST /api/agents/triage/reviews"}, {"condition": "regression", "detail": "no score for 9a1150cc0d8cc86e to set against the deployed predecessor's 0.6667 (version 1)"}], "audit_id": 26}, "decision": "gd-d88af9436bf84bce"}}], "count": 1, "how": "rank = severity × (1 + min(age in hours, 48) / 24); each item carries the action that clears it"}},
  "attention_rollback": {"status": 200, "body": {"items": [{"id": "override:dp-c1ad4a58de7b4036", "kind": "override", "severity": 6, "age_s": 0.0, "rank": 6.0, "title": "triage: version 2 deployed past the promotion gate by Ada <ada@ey.com> (eval, review, regression)", "detail": "reason: hotfix for INC-77; eval: no eval of 9a1150cc0d8cc86e on triage-bench is on record: run POST /api/agents/triage/evals/run; review: no policy review of 9a1150cc0d8cc86e is on record: a reviewer who did not author it approves it at POST /api/agents/triage/reviews; regression: no score for 9a1150cc0d8cc86e to set against the deployed predecessor's 0.6667 (version 1)", "agent": "triage", "run": "", "job": "", "since": "2026-10-21T14:19:46.370Z", "deadline": null, "holds": "", "action": {"method": "GET", "path": "/api/agents/triage/lifecycle?digest=9a1150cc0d8cc86e", "body": null, "says": "review what the override passed: run the eval, sign the review, or close the findings, so the gate holds on its own records"}, "agents": ["triage"], "runs": [], "data": {"deployment": "dp-c1ad4a58de7b4036", "version": 2, "digest": "9a1150cc0d8cc86e", "environment": "production", "override": {"reason": "hotfix for INC-77", "by": "Ada <ada@ey.com>", "at": "2026-10-21T14:19:46.370Z", "passed": ["eval", "review", "regression"], "unmet": [{"condition": "eval", "detail": "no eval of 9a1150cc0d8cc86e on triage-bench is on record: run POST /api/agents/triage/evals/run"}, {"condition": "review", "detail": "no policy review of 9a1150cc0d8cc86e is on record: a reviewer who did not author it approves it at POST /api/agents/triage/reviews"}, {"condition": "regression", "detail": "no score for 9a1150cc0d8cc86e to set against the deployed predecessor's 0.6667 (version 1)"}], "audit_id": 26}, "decision": "gd-d88af9436bf84bce"}}, {"id": "rollback:dp-38e9898f4fc04820", "kind": "rollback", "severity": 6, "age_s": 0.0, "rank": 6.0, "title": "triage: rolled back from version 2 to 1; 2 runs flagged", "detail": "reason: v2 escalates everything; by Ada <ada@ey.com>", "agent": "triage", "run": "", "job": "", "since": "2026-10-21T14:19:46.415Z", "deadline": null, "holds": "", "action": {"method": "GET", "path": "/api/agents/triage/deployments", "body": null, "says": "review the flagged runs of the version rolled back from (review.flag: rolled_back on each)"}, "agents": ["triage"], "runs": ["triage-2026-10-21T14-19-46-tuqz", "triage-2026-10-21T14-19-46-uxdd"], "data": {"deployment": "dp-38e9898f4fc04820", "from": {"version": 2, "digest": "9a1150cc0d8cc86e", "deployment": "dp-c1ad4a58de7b4036", "adopted": false}, "to": {"version": 1, "digest": "90df2dfa5e202811"}, "flagged": ["triage-2026-10-21T14-19-46-tuqz", "triage-2026-10-21T14-19-46-uxdd"], "reason": "v2 escalates everything"}}], "count": 2, "how": "rank = severity × (1 + min(age in hours, 48) / 24); each item carries the action that clears it"}},
  "attention_drift_pause": {"status": 200, "body": {"items": [{"id": "drift:triage", "kind": "drift", "severity": 5, "age_s": 0.0, "rank": 5.0, "title": "triage: drift in tool_mix", "detail": "tool_mix Jensen–Shannon distance 1.000 past 0.2 (8 runs in the last day against 24 before)", "agent": "triage", "run": "", "job": "", "since": "2026-10-21T14:19:46.659Z", "deadline": null, "holds": "", "action": {"method": "POST", "path": "/api/fleet", "body": {"action": "pause", "agents": ["triage"], "reason": "drift: tool_mix moved past their thresholds"}, "says": "if the shift is not the world's, pause triage through the fleet door (POST /api/fleet, action pause) and review its recent runs (GET /api/drift?agent=triage); nothing pauses it on its own"}, "agents": ["triage"], "runs": [], "data": {"measures": [{"name": "tool_mix", "kind": "mix", "statistic": "jensen_shannon", "distance": 1.0, "z": null, "threshold": 0.2, "drifted": true, "enough": true, "says": "Jensen–Shannon distance 1.000 past 0.2", "recent": {"counts": {"mail.send": 8, "web.fetch": 8}, "shares": {"mail.send": 0.5, "web.fetch": 0.5}, "n": 16}, "baseline": {"counts": {"records.query": 24}, "shares": {"records.query": 1.0}, "n": 24}, "field": null}], "recent": {"since": "2026-10-20T14:19:46.659Z", "until": "2026-10-21T14:19:46.659Z", "runs": 8}, "baseline": {"since": "2026-09-20T14:19:46.659Z", "until": "2026-10-20T14:19:46.659Z", "runs": 24}, "outcome_field": "disposition", "first_seen": "2026-10-21T14:19:46.659Z", "benchmark": null, "review": {"method": "GET", "path": "/api/drift?agent=triage"}}}], "count": 1, "how": "rank = severity × (1 + min(age in hours, 48) / 24); each item carries the action that clears it"}},
  "fleet_pause_from_drift": {"status": 200, "body": {"action": "pause", "agents": ["triage"], "reason": "drift: tool_mix moved past their thresholds", "by": "Chandresh Singh", "at": "2026-10-21T14:19:46.676Z", "killed": [], "paused": {"triage": {"mode": "pause", "reason": "drift: tool_mix moved past their thresholds", "by": "Chandresh Singh", "at": "2026-10-21T14:19:46.676Z"}}, "audit_id": 2}},
  "drift_benchmark": {"status": 200, "body": {"agents": [{"agent": "triage", "recent": {"since": "2026-10-20T14:19:46.755Z", "until": "2026-10-21T14:19:46.755Z", "runs": 6}, "baseline": {"since": "2026-09-20T14:19:46.755Z", "until": "2026-10-20T14:19:46.755Z", "runs": 0}, "enough": false, "says": "not enough runs: 6 in the last 24 h (need 5) and 0 in the 30 days before (need 20); shifted from the benchmark: benchmark_outcomes, benchmark_labels", "drifted": true, "outcome_field": "disposition", "measures": [], "benchmark": {"eval": {"id": "ev-mvi781vw-mp7l", "digest": "90df2dfa5e202811", "version": 1, "set": "triage-bench", "at": "2026-10-21T14:19:46.706Z", "cases": 3, "labeled": true}, "enough": true, "says": "shifted from the benchmark: benchmark_outcomes, benchmark_labels", "drifted": true, "measures": [{"name": "benchmark_outcomes", "kind": "mix", "statistic": "jensen_shannon", "distance": 0.6776, "z": null, "threshold": 0.2, "drifted": true, "enough": true, "says": "Jensen–Shannon distance 0.678 from the outcomes on the benchmark, past 0.2", "recent": {"counts": {"ESCALATE": 6}, "shares": {"ESCALATE": 1.0}, "n": 6}, "baseline": {"counts": {"ESCALATE": 1, "AUTO_CLOSE": 1, "ANALYST_REVIEW": 1}, "shares": {"ESCALATE": 0.3333, "AUTO_CLOSE": 0.3333, "ANALYST_REVIEW": 0.3333}, "n": 3}, "field": null}, {"name": "benchmark_labels", "kind": "mix", "statistic": "jensen_shannon", "distance": 0.4369, "z": null, "threshold": 0.2, "drifted": true, "enough": true, "says": "Jensen–Shannon distance 0.437 from the benchmark's labels, past 0.2", "recent": {"counts": {"ESCALATE": 6}, "shares": {"ESCALATE": 1.0}, "n": 6}, "baseline": {"counts": {"ESCALATE": 2, "AUTO_CLOSE": 1}, "shares": {"ESCALATE": 0.6667, "AUTO_CLOSE": 0.3333}, "n": 3}, "field": null}]}}], "count": 1, "now": "2026-10-21T14:19:46.755Z", "thresholds": {"mix_js": 0.2, "mean_z": 2.0}, "min_runs": {"recent": 5, "baseline": 20}, "windows": {"recent_h": 24.0, "baseline_d": 30.0}}},
  "attention_drift_benchmark": {"status": 200, "body": {"items": [{"id": "override:dp-2fb5cb0104d24e22", "kind": "override", "severity": 6, "age_s": 0.0, "rank": 6.0, "title": "triage: version 1 deployed past the promotion gate by Chandresh Singh (review)", "detail": "reason: drift under test; review: no policy review of 90df2dfa5e202811 is on record: a reviewer who did not author it approves it at POST /api/agents/triage/reviews", "agent": "triage", "run": "", "job": "", "since": "2026-10-21T14:19:46.729Z", "deadline": null, "holds": "", "action": {"method": "GET", "path": "/api/agents/triage/lifecycle?digest=90df2dfa5e202811", "body": null, "says": "review what the override passed: run the eval, sign the review, or close the findings, so the gate holds on its own records"}, "agents": ["triage"], "runs": [], "data": {"deployment": "dp-2fb5cb0104d24e22", "version": 1, "digest": "90df2dfa5e202811", "environment": "production", "override": {"reason": "drift under test", "by": "Chandresh Singh", "at": "2026-10-21T14:19:46.729Z", "passed": ["review"], "unmet": [{"condition": "review", "detail": "no policy review of 90df2dfa5e202811 is on record: a reviewer who did not author it approves it at POST /api/agents/triage/reviews"}], "audit_id": 5}, "decision": "gd-ccc5ecf7c94a4adb"}}, {"id": "drift:triage", "kind": "drift", "severity": 5, "age_s": 0.0, "rank": 5.0, "title": "triage: drift in benchmark_outcomes, benchmark_labels", "detail": "benchmark_outcomes Jensen–Shannon distance 0.678 from the outcomes on the benchmark, past 0.2; benchmark_labels Jensen–Shannon distance 0.437 from the benchmark's labels, past 0.2 (6 runs in the last day against 0 before)", "agent": "triage", "run": "", "job": "", "since": "2026-10-21T14:19:46.757Z", "deadline": null, "holds": "", "action": {"method": "POST", "path": "/api/fleet", "body": {"action": "pause", "agents": ["triage"], "reason": "drift: benchmark_outcomes, benchmark_labels moved past their thresholds"}, "says": "if the shift is not the world's, pause triage through the fleet door (POST /api/fleet, action pause) and review its recent runs (GET /api/drift?agent=triage); nothing pauses it on its own"}, "agents": ["triage"], "runs": [], "data": {"measures": [{"name": "benchmark_outcomes", "kind": "mix", "statistic": "jensen_shannon", "distance": 0.6776, "z": null, "threshold": 0.2, "drifted": true, "enough": true, "says": "Jensen–Shannon distance 0.678 from the outcomes on the benchmark, past 0.2", "recent": {"counts": {"ESCALATE": 6}, "shares": {"ESCALATE": 1.0}, "n": 6}, "baseline": {"counts": {"ESCALATE": 1, "AUTO_CLOSE": 1, "ANALYST_REVIEW": 1}, "shares": {"ESCALATE": 0.3333, "AUTO_CLOSE": 0.3333, "ANALYST_REVIEW": 0.3333}, "n": 3}, "field": null}, {"name": "benchmark_labels", "kind": "mix", "statistic": "jensen_shannon", "distance": 0.4369, "z": null, "threshold": 0.2, "drifted": true, "enough": true, "says": "Jensen–Shannon distance 0.437 from the benchmark's labels, past 0.2", "recent": {"counts": {"ESCALATE": 6}, "shares": {"ESCALATE": 1.0}, "n": 6}, "baseline": {"counts": {"ESCALATE": 2, "AUTO_CLOSE": 1}, "shares": {"ESCALATE": 0.6667, "AUTO_CLOSE": 0.3333}, "n": 3}, "field": null}], "recent": {"since": "2026-10-20T14:19:46.757Z", "until": "2026-10-21T14:19:46.757Z", "runs": 6}, "baseline": {"since": "2026-09-20T14:19:46.757Z", "until": "2026-10-20T14:19:46.757Z", "runs": 0}, "outcome_field": "disposition", "first_seen": "2026-10-21T14:19:46.757Z", "benchmark": {"id": "ev-mvi781vw-mp7l", "digest": "90df2dfa5e202811", "version": 1, "set": "triage-bench", "at": "2026-10-21T14:19:46.706Z", "cases": 3, "labeled": true}, "review": {"method": "GET", "path": "/api/drift?agent=triage"}}}], "count": 2, "how": "rank = severity × (1 + min(age in hours, 48) / 24); each item carries the action that clears it"}},
  "guardian_put_redirect": {"status": 200, "body": {"enabled": true, "model": "", "agents": ["triage"], "may": ["redirect"], "max_actions_per_hour": 10, "min_confidence": 0.8, "rubric": "", "every_entries": 1, "every_s": 15.0, "set_by": "Chandresh Singh", "set_at": "2026-10-21T14:19:46.825Z", "audit_id": 2, "actions_last_hour": 0, "stats": {"evaluations": 0, "ok": 0, "acted": 0, "attention": 0, "unparseable": 0, "errors": 0, "repeated": 0, "watching": 0}}},
  "guardian_view_redirect": {"status": 200, "body": {"enabled": true, "model": "", "agents": ["triage"], "may": ["redirect"], "max_actions_per_hour": 10, "min_confidence": 0.8, "rubric": "", "every_entries": 1, "every_s": 15.0, "set_by": "Chandresh Singh", "set_at": "2026-10-21T14:19:46.825Z", "audit_id": 2, "actions_last_hour": 1, "stats": {"evaluations": 3, "ok": 1, "acted": 1, "attention": 0, "unparseable": 0, "errors": 0, "repeated": 1, "watching": 1}}},
  "guardian_actions_redirected": {"status": 200, "body": {"actions": [{"id": "g-2cc0431ee28043d8", "at": "2026-10-21T14:19:46.828Z", "run": "triage-2026-10-21T14-19-46-67hd", "agent": "triage", "verdict": "redirect", "confidence": 0.9, "reason": "stay on the case: summarise the incident, do not draft an email", "model": "(deployment default)", "action": "redirect", "outcome": "acted", "why": "", "entries": 3, "source": "console"}], "count": 1}},
  "attention_guardian_redirected": {"status": 200, "body": {"items": [{"id": "guardian:g-2cc0431ee28043d8", "kind": "guardian", "severity": 7, "age_s": 0.0, "rank": 7.0, "title": "triage: the guardian redirected run triage-2026-10-21T14-19-46-67hd", "detail": "stay on the case: summarise the incident, do not draft an email (confidence 0.90, (deployment default))", "agent": "triage", "run": "triage-2026-10-21T14-19-46-67hd", "job": "", "since": "2026-10-21T14:19:46Z", "deadline": null, "holds": "", "action": {"method": "GET", "path": "/api/runs/triage-2026-10-21T14-19-46-67hd", "body": null, "says": "the run reads the guardian's reason as guidance at its next model call: review where it went"}, "agents": ["triage"], "runs": ["triage-2026-10-21T14-19-46-67hd"], "data": {"verdict": "redirect", "confidence": 0.9, "reason": "stay on the case: summarise the incident, do not draft an email", "model": "(deployment default)", "action": "redirect", "outcome": "acted", "why": ""}}], "count": 1, "how": "rank = severity × (1 + min(age in hours, 48) / 24); each item carries the action that clears it"}},
  "run_guardian_redirected": {"status": 200, "body": {"id": "triage-2026-10-21T14-19-46-67hd", "system": "triage", "spec_digest": "396e494c51119eac", "trace_id": "t-8cb07abba73042bb", "state": "done", "values": {"$input": {"incident": "INC-1"}, "decide": {"summary": "summary"}}, "skipped": [], "visits": {"decide": 1}, "spent": {"tool_calls": 0, "tokens": 0, "cost_usd": 0.0, "wall_clock_s": 0.002}, "suspension": null, "error": "", "result": {"summary": "summary"}, "journal": {"run_id": "triage-2026-10-21T14-19-46-67hd", "system": "triage", "spec_digest": "396e494c51119eac", "duration_ms": 1, "entries": [{"t": 0, "kind": "run.start", "node": "", "title": "Run triage-2026-10-21T14-19-46-67hd", "detail": "", "data": {"system": "triage", "spec_digest": "396e494c51119eac", "trace_id": "t-8cb07abba73042bb"}, "because": [], "id": "503302e6f3f3", "tainted": false}, {"t": 0, "kind": "node.enter", "node": "decide", "title": "Decide", "detail": "sequence · 3 steps", "data": {"inputs": {"incident": "INC-1"}}, "because": [], "id": "5ebd77d2b973", "tainted": false}, {"t": 0, "kind": "model.call", "node": "decide", "title": "scripted", "detail": "Drafting an email to the customer first", "data": {"prompt": "Plan for INC-1", "intents": [], "tokens": {"in": 0, "out": 0}, "ms": 0}, "because": ["5ebd77d2b973"], "id": "71673cd1d43a", "tainted": false}, {"t": 0, "kind": "note", "node": "", "title": "Guardian: redirected the run", "detail": "stay on the case: summarise the incident, do not draft an email", "data": {"control": "guardian", "verdict": "redirect", "action": "redirect", "model": "(deployment default)", "confidence": 0.9, "reason": "stay on the case: summarise the incident, do not draft an email", "by": "guardian", "delivery": "in-process", "at": "2026-10-21T14:19:46.828Z", "guidance": "The guardian redirects this run: stay on the case: summarise the incident, do not draft an email"}, "because": [], "id": "383551055c1d", "tainted": false}, {"t": 1, "kind": "model.call", "node": "decide", "title": "scripted", "detail": "Drafting an email to the customer first", "data": {"prompt": "Confirm the plan", "intents": [], "tokens": {"in": 0, "out": 0}, "ms": 1}, "because": ["5ebd77d2b973", "71673cd1d43a"], "id": "4b599a00fa92", "tainted": false}, {"t": 1, "kind": "note", "node": "decide", "title": "Operator guidance", "detail": "The guardian redirects this run: stay on the case: summarise the incident, do not draft an email", "data": {"control": "operator.guidance", "by": "guardian", "text": "The guardian redirects this run: stay on the case: summarise the incident, do not draft an email"}, "because": ["5ebd77d2b973", "71673cd1d43a", "4b599a00fa92"], "id": "d4b64faa8112", "tainted": false}, {"t": 1, "kind": "model.call", "node": "decide", "title": "scripted", "detail": "summary", "data": {"prompt": "Summarise the outcome\n\n[Operator guidance from guardian]\nThe guardian redirects this run: stay on the case: summarise the incident, do not draft an email\n[End operator guidance]", "intents": [], "tokens": {"in": 0, "out": 0}, "ms": 0}, "because": ["5ebd77d2b973", "71673cd1d43a", "4b599a00fa92"], "id": "f8b8264b414f", "tainted": false}, {"t": 1, "kind": "node.exit", "node": "decide", "title": "Decide complete", "detail": "", "data": {"emitted": {"summary": "summary"}}, "because": ["5ebd77d2b973", "71673cd1d43a", "4b599a00fa92", "f8b8264b414f"], "id": "05ead802c36e", "tainted": false}, {"t": 1, "kind": "run.end", "node": "", "title": "Run complete", "detail": "1 nodes ran, 0 skipped, 0 refused actions", "data": {"result": {"summary": "summary"}, "skipped": [], "denied": 0}, "because": [], "id": "1d10d8c42974", "tainted": false}]}, "started_at": "2026-10-21T14:19:46.826Z", "finished_at": "2026-10-21T14:19:46.828Z", "agent": null, "spec": {"apiVersion": "agentfactory/v1", "kind": "AgentSystem", "metadata": {"id": "triage", "name": "Triage", "description": "Triage an incident."}, "spec": {"entry": "decide", "nodes": [{"id": "decide", "harness": "sequence", "label": "Decide", "expects": [{"name": "incident", "kind": "string"}], "emits": [{"name": "summary", "kind": "string"}], "steps": [{"action": "model", "prompt": "Plan for {{incident}}", "emits": "plan"}, {"action": "model", "prompt": "Confirm the plan", "emits": "checked"}, {"action": "model", "prompt": "Summarise the outcome", "emits": "summary"}]}], "edges": []}}, "provider": "scripted", "model": "scripted", "kill": null, "steer": [{"by": "guardian", "at": "2026-10-21T14:19:46.827Z", "guidance": "The guardian redirects this run: stay on the case: summarise the incident, do not draft an email"}]}},
  "guardian_actions_would_redirect": {"status": 200, "body": {"actions": [{"id": "g-597196ba895b45c7", "at": "2026-10-21T14:19:46.913Z", "run": "vetting-2026-10-21T14-19-46-491706", "agent": "vetting", "verdict": "redirect", "confidence": 0.9, "reason": "stay on the case: summarise the incident, do not draft an email", "model": "(deployment default)", "action": "redirect", "outcome": "attention", "why": "redirect is not among what the guardian may do (may: hold)", "entries": 1, "source": "worker"}], "count": 1}},
  "attention_guardian_would_redirect": {"status": 200, "body": {"items": [{"id": "guardian:g-597196ba895b45c7", "kind": "guardian", "severity": 7, "age_s": 0.0, "rank": 7.0, "title": "vetting: the guardian would redirect run vetting-2026-10-21T14-19-46-491706", "detail": "stay on the case: summarise the incident, do not draft an email (confidence 0.90, (deployment default)); not acted on: redirect is not among what the guardian may do (may: hold)", "agent": "vetting", "run": "vetting-2026-10-21T14-19-46-491706", "job": "", "since": "2026-10-21T14:19:46Z", "deadline": null, "holds": "", "action": {"method": "POST", "path": "/api/runs/vetting-2026-10-21T14-19-46-491706/steer", "body": {"guidance": "The guardian redirects this run: stay on the case: summarise the incident, do not draft an email"}, "says": "the guardian did not act (redirect is not among what the guardian may do (may: hold)): steer the run with its reason if you agree"}, "agents": ["vetting"], "runs": ["vetting-2026-10-21T14-19-46-491706"], "data": {"verdict": "redirect", "confidence": 0.9, "reason": "stay on the case: summarise the incident, do not draft an email", "model": "(deployment default)", "action": "redirect", "outcome": "attention", "why": "redirect is not among what the guardian may do (may: hold)"}}], "count": 1, "how": "rank = severity × (1 + min(age in hours, 48) / 24); each item carries the action that clears it"}},
  "steer_redirect": {"status": 202, "body": {"run": "vetting-2026-10-21T14-19-46-491706", "state": "running", "steer": {"guidance": "The guardian redirects this run: stay on the case: summarise the incident, do not draft an email", "hold_at_next_gate": null, "model": null, "by": "Chandresh Singh", "at": "2026-10-21T14:19:46.916Z"}, "delivery": "worker"}},
  "guardian_put_400_may": {"status": 400, "body": {"error": "may lists what the guardian may do on its own: hold, block, redirect", "field": "may"}},
  "job_tainted": {"status": 200, "body": {"job": "0c23b70c-b749-4bd7-b2e9-16c1eb830f94", "agent": "vetting", "status": "queued", "external_id": "a2a:vendor-bot:t-9", "source": "a2a · vendor-bot", "attempts": 0, "max_attempts": 3, "run_id": null, "trace_id": "", "result": null, "error": null, "dead": false, "claimed_by": null, "lease_until": null, "created_at": "2026-10-21T14:19:46.971Z", "started_at": null, "finished_at": null, "status_url": "/api/trigger/vetting/jobs/0c23b70c-b749-4bd7-b2e9-16c1eb830f94", "run_url": null, "parent_run": null, "cancel_reason": null, "taint": "a2a:vendor-bot"}},
  "job_tainted_running": {"status": 200, "body": {"job": "0c23b70c-b749-4bd7-b2e9-16c1eb830f94", "agent": "vetting", "status": "running", "external_id": "a2a:vendor-bot:t-9", "source": "a2a · vendor-bot", "attempts": 1, "max_attempts": 3, "run_id": "vetting-2026-10-21T14-19-46-0c23b7", "trace_id": "t-4f06bb1eb98c4db6", "result": null, "error": null, "dead": false, "claimed_by": "w1", "lease_until": "2026-10-21T14:39:46.973Z", "created_at": "2026-10-21T14:19:46.971Z", "started_at": "2026-10-21T14:19:46.973Z", "finished_at": null, "status_url": "/api/trigger/vetting/jobs/0c23b70c-b749-4bd7-b2e9-16c1eb830f94", "run_url": "/runs?id=vetting-2026-10-21T14-19-46-0c23b7", "parent_run": null, "cancel_reason": null, "taint": "a2a:vendor-bot"}},
  "run_tainted": {"status": 200, "body": {"id": "vetting-2026-10-21T14-19-46-0c23b7", "system": "vetting", "spec_digest": "0000000000000000", "trace_id": "t-test", "state": "done", "values": {}, "skipped": [], "visits": {}, "spent": {}, "suspension": null, "error": "", "result": {"verdict": "benign", "note": "PAYROLL attached"}, "journal": {"run_id": "vetting-2026-10-21T14-19-46-0c23b7", "system": "vetting", "spec_digest": "0000000000000000", "duration_ms": 9, "entries": [{"t": 0, "kind": "run.start", "node": "", "title": "run.start", "detail": "", "data": {}, "because": [], "id": "vetting-2026-10-21T14-19-46-0c23b7-s", "tainted": false}, {"t": 5, "kind": "model.call", "node": "decide", "title": "gpt-4o", "detail": "", "data": {"tokens": {"in": 10, "out": 2}, "ms": 5, "intents": []}, "because": [], "id": "vetting-2026-10-21T14-19-46-0c23b7-m", "tainted": false}, {"t": 9, "kind": "run.end", "node": "", "title": "run.end", "detail": "", "data": {}, "because": [], "id": "vetting-2026-10-21T14-19-46-0c23b7-e", "tainted": false}, {"t": 0, "kind": "a2a.message", "node": "", "title": "Message from peer vendor-bot", "detail": "23 bytes from vendor-bot", "data": {"direction": "in", "peer": "vendor-bot", "digest": "sha256:d54fe85d6e25e058188e792d01fd6307004e86b9d85ca3441303fc53472a8536", "bytes": 23, "screen": "allow", "signed": true, "door": "a2a", "method": "tasks/send", "workflow": "vetting", "task": "t-9", "delegated": false}, "because": [], "id": "3860490b8440", "tainted": true}]}, "started_at": "2026-10-21T14:19:46.973Z", "finished_at": "2026-10-21T14:19:46.977Z", "agent": "vetting", "spec": {"apiVersion": "agentfactory/v1", "kind": "AgentSystem", "metadata": {"id": "vetting", "name": "Tiny"}, "spec": {"entry": "decide", "nodes": [{"id": "decide", "harness": "sequence", "label": "Decide", "expects": [{"name": "case", "kind": "string"}], "emits": [{"name": "verdict", "kind": "string"}], "steps": [{"action": "model", "prompt": "Decide on {{case}}", "emits": "verdict"}]}], "edges": [], "trigger": {"kind": "api", "config": {}}}}, "provider": null, "model": null, "kill": null, "job": "0c23b70c-b749-4bd7-b2e9-16c1eb830f94", "worker": "w1", "taint": {"source": "a2a:vendor-bot", "input": true}}},
  "job_cancelled_reason": {"status": 200, "body": {"job": "7bf75a8e-7c5d-45d5-9a7d-f137c88ac753", "agent": "vetting", "status": "cancelled", "external_id": null, "source": "a2a · vendor-bot", "attempts": 0, "max_attempts": 3, "run_id": null, "trace_id": "", "result": null, "error": null, "dead": false, "claimed_by": null, "lease_until": null, "created_at": "2026-10-21T14:19:46.982Z", "started_at": null, "finished_at": "2026-10-21T14:19:46.983Z", "status_url": "/api/trigger/vetting/jobs/7bf75a8e-7c5d-45d5-9a7d-f137c88ac753", "run_url": null, "parent_run": null, "cancel_reason": "canceled by the caller over A2A", "taint": "a2a:vendor-bot"}},
  "queue_cancelled_reason": {"status": 200, "body": {"depth": 0, "oldest_age_s": null, "agents": {"vetting": {"queued": 0, "running": 0, "done": 1, "failed": 0, "suspended": 0, "cancelled": 1, "dead": 0, "oldest_queued": null}}, "workers": [], "dead_letters": [], "schedules": [], "last_hour": {"finished": 1, "failed": 0, "avg_ms": 5}, "scheduler": false}},
  "tree_before_kill": {"status": 200, "body": {"root": "vetting-2026-10-21T14-19-47-8ce89e", "asked": "vetting-2026-10-21T14-19-47-8ce89e", "trace_id": "t-b07cfb8528484cf5", "nodes": [{"run": "vetting-2026-10-21T14-19-47-8ce89e", "agent": "vetting", "source": "worker", "state": "running", "parent": null, "depth": 0, "cost": 0.0, "tokens": 0, "tool_calls": 2, "refusals": 0, "peer": null, "kind": "run", "link": "root", "started_at": "2026-10-21T14:19:47.069Z", "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 2, "refusals": 0}, "listed": {"cost": 0.0, "tokens": 0, "tool_calls": 2, "refusals": 0}}, {"run": "peer:soc-stub/t-77", "agent": "soc-stub", "source": "peer", "state": "submitted", "parent": "vetting-2026-10-21T14-19-47-8ce89e", "depth": 1, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": {"name": "soc-stub", "task_id": "t-77", "state": "submitted", "calls": 1, "refused": 0, "failed": 0, "tools": ["peer.send"], "replied": false, "cancel": null}, "kind": "peer", "link": "journal", "started_at": null, "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}, "listed": null}, {"run": "peer:soc-stub/t-79", "agent": "soc-stub", "source": "peer", "state": "working", "parent": "vetting-2026-10-21T14-19-47-8ce89e", "depth": 1, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": {"name": "soc-stub", "task_id": "t-79", "state": "working", "calls": 1, "refused": 0, "failed": 0, "tools": ["peer.send"], "replied": false, "cancel": null}, "kind": "peer", "link": "journal", "started_at": null, "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}, "listed": null}], "rollup": {"cost": 0.0, "tokens": 0, "tool_calls": 2, "refusals": 0, "by_agent": {"vetting": {"cost": 0.0, "tokens": 0, "tool_calls": 2, "refusals": 0, "nodes": 1}, "peer:soc-stub": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 2}}}, "count": 3, "truncated": false, "how": "cost, tokens, tool_calls, refusals: the node's own entries only, so nothing is counted twice; listed: what a record's row in the runs list shows (its whole journal, its in-process sub-runs folded in; null for a sub-run or a peer leaf); total: the node and everything under it. The root's total and the rollup are the runs list's rows summed over the records in the tree"}},
  "kill_answered_202": {"status": 202, "body": {"run": "vetting-2026-10-21T14-19-47-8ce89e", "state": "running", "kill": {"reason": "stop", "by": "Chandresh Singh", "at": "2026-10-21T14:19:47.074Z"}, "delivery": "worker", "reached": [{"run": "vetting-2026-10-21T14-19-47-8ce89e", "agent": "vetting", "source": "worker", "kind": "run", "delivery": "worker", "parent": null, "depth": 0, "state": "running", "answered_state": null, "peer": null, "task_id": null, "error": null, "kill": null}, {"run": "peer:soc-stub/t-77", "agent": "soc-stub", "source": "peer", "kind": "peer_task", "delivery": "a2a", "parent": "vetting-2026-10-21T14-19-47-8ce89e", "depth": 1, "state": "submitted", "answered_state": "canceled", "peer": "soc-stub", "task_id": "t-77", "error": null, "kill": null}, {"run": "peer:soc-stub/t-79", "agent": "soc-stub", "source": "peer", "kind": "peer_task", "delivery": "a2a-refused", "parent": "vetting-2026-10-21T14-19-47-8ce89e", "depth": 1, "state": "working", "answered_state": null, "peer": "soc-stub", "task_id": "t-79", "error": "peer 'soc-stub' refused tasks/cancel: task not found", "kill": null}], "already": []}},
  "tree_after_kill": {"status": 200, "body": {"root": "vetting-2026-10-21T14-19-47-8ce89e", "asked": "vetting-2026-10-21T14-19-47-8ce89e", "trace_id": "t-b07cfb8528484cf5", "nodes": [{"run": "vetting-2026-10-21T14-19-47-8ce89e", "agent": "vetting", "source": "worker", "state": "running", "parent": null, "depth": 0, "cost": 0.0, "tokens": 0, "tool_calls": 2, "refusals": 0, "peer": null, "kind": "run", "link": "root", "started_at": "2026-10-21T14:19:47.069Z", "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 2, "refusals": 0}, "listed": {"cost": 0.0, "tokens": 0, "tool_calls": 2, "refusals": 0}}, {"run": "peer:soc-stub/t-77", "agent": "soc-stub", "source": "peer", "state": "canceled", "parent": "vetting-2026-10-21T14-19-47-8ce89e", "depth": 1, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": {"name": "soc-stub", "task_id": "t-77", "state": "canceled", "calls": 1, "refused": 0, "failed": 0, "tools": ["peer.send"], "replied": false, "cancel": {"state": "canceled", "by": "Chandresh Singh", "reason": "stop", "delivery": "a2a"}}, "kind": "peer", "link": "journal", "started_at": null, "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}, "listed": null}, {"run": "peer:soc-stub/t-79", "agent": "soc-stub", "source": "peer", "state": "working", "parent": "vetting-2026-10-21T14-19-47-8ce89e", "depth": 1, "cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "peer": {"name": "soc-stub", "task_id": "t-79", "state": "working", "calls": 1, "refused": 0, "failed": 0, "tools": ["peer.send"], "replied": false, "cancel": null}, "kind": "peer", "link": "journal", "started_at": null, "finished_at": null, "error": "", "estimated": false, "total": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0}, "listed": null}], "rollup": {"cost": 0.0, "tokens": 0, "tool_calls": 2, "refusals": 0, "by_agent": {"vetting": {"cost": 0.0, "tokens": 0, "tool_calls": 2, "refusals": 0, "nodes": 1}, "peer:soc-stub": {"cost": 0.0, "tokens": 0, "tool_calls": 0, "refusals": 0, "nodes": 2}}}, "count": 3, "truncated": false, "how": "cost, tokens, tool_calls, refusals: the node's own entries only, so nothing is counted twice; listed: what a record's row in the runs list shows (its whole journal, its in-process sub-runs folded in; null for a sub-run or a peer leaf); total: the node and everything under it. The root's total and the rollup are the runs list's rows summed over the records in the tree"}},
};

function fx(name: string): Fixture {
  const f = FX[name];
  if (!f) throw new Error(`no fixture ${name}`);
  return f;
}

/** A fixture's body, as an object. */
const body = (name: string) => fx(name).body as Record<string, unknown>;

const respond = (f: Fixture) =>
  new Response(f.body === null ? null : JSON.stringify(f.body), { status: f.status, headers: { "content-type": "application/json", ...(f.headers ?? {}) } });

interface Call {
  url: string;
  method: string;
  body: unknown;
}

/**
 * Stub fetch to answer each call with the next named fixture; returns what
 * was asked. A plain fetch (lib/api/l8.ts, l7.ts, l5.ts) passes a path and
 * an init; the generated client (lib/api/l2.ts) passes a Request on the
 * console's origin. Both are read the same way.
 */
function serve(...names: string[]) {
  const queue = names.map(fx);
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | Request, init: RequestInit = {}) => {
      const req = typeof input === "string" ? null : input;
      const url = req ? req.url.replace("http://console.test", "") : (input as string);
      const text = req ? await req.text() : init.body === undefined ? "" : String(init.body);
      calls.push({ url, method: req ? req.method : String(init.method ?? "GET"), body: text ? JSON.parse(text) : undefined });
      const f = queue.shift();
      if (!f) throw new Error(`no fixture left for ${url}`);
      return respond(f);
    }),
  );
  return calls;
}

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
    .replace(/&rsquo;/g, "’")
    .replace(/\s+/g, " ")
    .trim();
const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
const render = (el: Parameters<typeof renderToStaticMarkup>[0]) => {
  const html = renderToStaticMarkup(el);
  return { html, text: textOf(html) };
};

afterEach(() => vi.unstubAllGlobals());

const V1 = "90df2dfa5e202811";
const V2 = "9a1150cc0d8cc86e";
const V3 = "91e6d338933ab31e";
const ADA = { name: "Ada", email: "ada@ey.com", sub: "autox|ada@ey.com", roles: [], appRoles: ["administrator"], groups: [] };
const RUI = { name: "Rui", email: "rui@ey.com", sub: "autox|rui@ey.com", roles: [], appRoles: ["operator"], groups: ["policy-reviewer"] };
const OLI = { name: "Oli", email: "oli@ey.com", sub: "autox|oli@ey.com", roles: [], appRoles: ["operator"], groups: [] };

describe("evals on the backend: started, followed, done", () => {
  it("202 at once; followed while a case runs, then done: results, the matrix, the metrics, the threshold met, who started it", async () => {
    const calls = serve("eval_start_202", "eval_view_running", "eval_view_done");
    const started = await l8.startEval("triage", { set: "triage-bench" });
    expect(started).toMatchObject({ id: "ev-mvi781bk-81b8", runs: ["ev-mvi781bk-81b8"], set: "triage-bench", digest: V1, version: 1, total: 3, dataset: true, threshold: 0.6, models: ["default"], compare: false, status_url: "/api/evals/runs/ev-mvi781bk-81b8" });
    const seen: l8.EvalRunView[] = [];
    const slept: number[] = [];
    const [done] = await l8.followEval(started.runs, { onView: (v) => seen.push(v), everyMs: 1500, sleep: async (ms) => void slept.push(ms) });
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ["POST", "/api/agents/triage/evals/run", { set: "triage-bench" }],
      ["GET", "/api/evals/runs/ev-mvi781bk-81b8", undefined],
      ["GET", "/api/evals/runs/ev-mvi781bk-81b8", undefined],
    ]);
    expect(slept).toEqual([1500]);
    // While a case runs: the graded cases so far, the case running now with its run, no score, the threshold not judged.
    const running = seen[0];
    expect([running.state, running.score, running.passed_threshold, running.threshold, running.results.map((r) => r.id)]).toEqual(["running", null, null, 0.6, ["a"]]);
    expect(running.progress).toEqual({ done: 1, total: 3, passed: 1, current: { index: 1, id: "b", model: "default", run: "triage-2026-10-21T14-19-45-ej7e" }, rate_limited: null });
    // The backend says a labeled run is labeled only once its matrix is written, at the end; the page reads labels off the cases.
    expect([running.labeled, running.matrix, running.results[0].expected]).toEqual([false, null, "ESCALATE"]);
    expect(liveOf([running])).toMatchObject({ id: "ev-mvi781bk-81b8", model: "default", done: 1, total: 3, passed: 1, throttle: null, leg: 1, legs: 1 });
    expect(thresholdText(running)).toBe("threshold 0.6, still measuring");
    // Done: everything graded, the score against the threshold, who started it.
    expect([done.state, done.passed, done.total, done.score, done.passed_threshold, done.by, done.finished_at]).toEqual(["done", 2, 3, 2 / 3, true, "Chandresh Singh", "2026-10-21T14:19:45.980Z"]);
    expect([done.labeled, done.matrix, done.headline_f1, done.metrics?.headlineKind, done.invalid]).toEqual([true, { labels: ["AUTO_CLOSE", "ANALYST_REVIEW", "ESCALATE"], counts: [[1, 0, 0, 0], [0, 0, 0, 0], [0, 1, 1, 0]] }, 2 / 3, "positive", 0]);
    expect(done.results.map((r) => [r.id, r.passed, r.predicted, r.outcome])).toEqual([
      ["a", true, "ESCALATE", "ESCALATE"],
      ["b", true, "AUTO_CLOSE", "AUTO_CLOSE"],
      ["c", false, "ANALYST_REVIEW", "ANALYST_REVIEW"],
    ]);
    expect(thresholdText(done)).toBe("at or above the threshold 0.6");
    expect(done.summary).toMatchObject({ batch_id: "ev-mvi781bk-81b8", forced: false, compare: false, model_calls: 3, version_digest: V1 });
    // The page's case table: each case, its checks, the label against the expected one, the run behind the score.
    const { text, html } = render(createElement(CaseTable, { cases: done.results }));
    for (const s of ["a", "b", "c", "exfil", "routine", "unclear", "pass", "fail", "ESCALATE", "ANALYST_REVIEW"]) expect(text, s).toContain(s);
    expect(html).not.toContain("null");
  });

  it("a case's run is a real record, tagged as the eval's: the run page says which case of which set", async () => {
    serve("run_eval_case");
    const { data } = await api.GET("/api/runs/{run_id}", { params: { path: { run_id: "triage-2026-10-21T14-19-45-f5py" } } });
    const flags = runFlagsOf(data);
    expect(flags).toMatchObject({ eval: { id: "ev-mvi781bk-81b8", case: "a", set: "triage-bench" }, review: null, taint: null, inbound: null });
    const { text, html } = render(createElement(RunFlagsBanner, { flags, agent: "triage" }));
    expect(text).toContain("A case of eval ev-mvi781bk-81b8");
    expect(text).toContain("Drift leaves an eval’s runs out of production’s windows");
    expect(hrefs(html)).toEqual(["/evals?set=triage-bench"]);
  });

  it("a comparison: a row per candidate, every call pinned; the recommendation the backend made, on every row once done", async () => {
    const calls = serve("eval_compare_202", "eval_compare_view_0", "eval_compare_view_1");
    const started = await l8.startEval("triage", { set: "triage-bench", compare: { models: ["gpt-4o", "gpt-4o-mini"] } });
    expect(started).toMatchObject({ compare: true, models: ["gpt-4o", "gpt-4o-mini"], runs: ["ev-mvi781dp-x4ik-gpt-4o", "ev-mvi781dp-x4ik-gpt-4o-mini"], batch_id: "ev-mvi781dp-x4ik" });
    const views = await l8.followEval(started.runs, { sleep: async () => {} });
    expect(calls.map((c) => c.url)).toEqual(["/api/agents/triage/evals/run", "/api/evals/runs/ev-mvi781dp-x4ik-gpt-4o", "/api/evals/runs/ev-mvi781dp-x4ik-gpt-4o-mini"]);
    expect(calls[0].body).toEqual({ set: "triage-bench", compare: { models: ["gpt-4o", "gpt-4o-mini"] } });
    // Each row a forced model: never the gate's eval, so no threshold; the version both measured.
    expect(views.map((v) => [v.model, v.forced, v.threshold, v.passed_threshold, v.version_digest, v.digest === V1])).toEqual([
      ["gpt-4o", true, null, null, V1, false],
      ["gpt-4o-mini", true, null, null, V1, false],
    ]);
    expect(thresholdText({ ...views[0] })).toBe("no threshold: a forced model is a comparison, never the gate's eval");
    const { comparison, failed } = settleOf(views);
    expect(failed).toEqual([]);
    expect(comparison).toMatchObject({ batch_id: "ev-mvi781dp-x4ik", incumbent: "gpt-4o", recommended: "gpt-4o-mini", runs: started.runs, digest: V1 });
    expect(comparison?.rationale).toBe("gpt-4o-mini clears the incumbent's quality within 0.02 at 94% lower cost per case.");
    expect(comparison?.models.map((m) => [m.model, m.tier, m.run_id, m.passed, m.total])).toEqual([
      ["gpt-4o", "large", "ev-mvi781dp-x4ik-gpt-4o", 2, 3],
      ["gpt-4o-mini", "small", "ev-mvi781dp-x4ik-gpt-4o-mini", 2, 3],
    ]);
    expect(compareFromView(views[0])?.recommended).toBe("gpt-4o-mini");
    // Read back from the shared table later, the console's history carries the same recommendation.
    const history = views.map(historyRowFromView);
    expect(lastComparison(history)?.recommended).toBe("gpt-4o-mini");
    expect(lastComparison(mergeHistory([], history))?.rationale).toBe(comparison?.rationale);
    const models = [
      { id: "gpt-4o", label: "GPT-4o", class: "large" },
      { id: "gpt-4o-mini", label: "GPT-4o mini", class: "small" },
    ];
    const { text } = render(createElement(ComparePanel, { cmp: comparison!, models, onUse: () => {}, currentModel: "" }));
    for (const s of ["Model comparison", "2 models, every call pinned, same cases", "recommended", "GPT-4o mini", "incumbent", "F1", "cost / case", "94% lower cost per case"]) expect(text, s).toContain(s);
  });

  it("a rate limit the runner waits on: said while it waits, kept on the row afterwards as the record, never a wait any more", async () => {
    serve("eval_view_rate_limited", "eval_view_rate_limited_done");
    const waiting = await l8.getEvalRun("ev-mvi781fd-bc8m");
    const t = throttleOf(waiting);
    expect(t).toMatchObject({ index: 1, id: "b", attempt: 1, of: 5, wait_s: 60 });
    expect(t?.limit).toEqual({
      error: "rate limit: 1 runs started for triage in the last minute, 1 allowed (run_starts_per_minute); retry in 60s",
      scope: "agent",
      limit: "run_starts_per_minute",
      used: 1,
      allowed: 1,
      retry_after_s: 60,
      agent: "triage",
      tree: "",
      kind: "start",
    });
    expect(rateLimitText(t!.limit)).toBe("Rate limited for agent triage: runs started per minute, 1 used of 1 allowed (run_starts_per_minute). Retry in 1 min.");
    expect(liveOf([waiting])?.throttle?.attempt).toBe(1);
    const over = await l8.getEvalRun("ev-mvi781fd-bc8m");
    expect([over.state, over.passed, over.progress.rate_limited?.attempt]).toEqual(["done", 2, 2]);
    expect(throttleOf(over)).toBeNull();
  });

  it("a case refused past the retries, and a lockdown landing mid-eval: the cases fail in the door's own words, with no run", async () => {
    serve("eval_view_refused_past_retries", "eval_view_lockdown_mid");
    const refusedCase = (await l8.getEvalRun("ev-mvi781h1-gcoy")).results[1];
    expect([refusedCase.state, refusedCase.run_file]).toEqual(["failed", ""]);
    expect(refusedCase.error).toBe("refused at the start, past 2 retries: rate limit: 1 runs started for triage in the last minute, 1 allowed (run_starts_per_minute); retry in 60s");
    const mid = await l8.getEvalRun("ev-mvi781in-tsek");
    expect(mid.results.map((r) => [r.id, r.state, r.run_file === ""])).toEqual([
      ["a", "done", false],
      ["b", "failed", true],
      ["c", "failed", true],
    ]);
    expect(mid.results[1].error).toMatch(/^the estate is locked down: breach drill \(by Chandresh Singh, .*\)\. Nothing starts until it is lifted/);
    expect([mid.score, mid.passed_threshold]).toEqual([1 / 3, false]);
    expect(thresholdText(mid)).toBe("under the threshold 0.6");
  });

  it("what refuses an eval before anything is measured: the field, another agent's set, no suite, the lockdown, a pause, a retirement", async () => {
    serve("eval_404_digest", "eval_404_set", "eval_409_other_set", "eval_400_no_suite", "eval_404_agent", "eval_run_404", "eval_423_lockdown", "eval_409_paused", "eval_409_retired");
    const digest = await refused(l8.startEval("triage", { digest: "0".repeat(16) }));
    expect([digest.status, digest.field, digest.message]).toEqual([404, "digest", 'no version of "triage" carries digest 0000000000000000']);
    const set = await refused(l8.startEval("triage", { set: "nowhere" }));
    expect([set.status, set.field]).toEqual([404, "set"]);
    const other = await refused(l8.startEval("triage", { set: "their-bench" }));
    expect([other.status, other.field, other.message]).toEqual([409, "set", 'eval set "their-bench" benchmarks "someone-else", not "triage"']);
    const bare = await refused(l8.startEval("bare"));
    expect([bare.status, bare.field, bare.message]).toEqual([400, "set", "name the set to run: the spec declares no eval suite (spec.evals.dataset)"]);
    expect((await refused(l8.startEval("nobody"))).status).toBe(404);
    expect((await refused(l8.getEvalRun("ev-nothing"))).message).toBe('no eval run "ev-nothing"');
    const locked = await refused(l8.startEval("triage"));
    expect([locked.status, l5.lockdownRefusalOf(locked.status, locked.body)?.reason]).toEqual([423, "incident"]);
    const paused = await refused(l8.startEval("triage"));
    expect([paused.status, (paused.body.paused as { reason: string }).reason]).toEqual([409, "noisy"]);
    const gone = await refused(l8.startEval("triage"));
    expect(l8.retiredRefusalOf(gone)).toMatchObject({ agent: "triage", reason: "superseded by the next triage", replacement: "triage-next", by: "Ada <ada@ey.com>" });
    expect(l8.retiredRefusalOf(paused)).toBeNull();
  });

  it("the benchmark: none on record (null), the latest eval when nothing is deployed, still the plain eval after a comparison, then what production runs", async () => {
    serve("evals_benchmark_404_none", "benchmark_200_undeployed", "benchmark_200_after_compare", "benchmark_200_matches");
    expect(await l8.getBenchmark("triage")).toBeNull();
    const first = (await l8.getBenchmark("triage"))!;
    expect([first.id, first.matches_deployed, first.deployed]).toEqual(["ev-mvi781bk-81b8", false, null]);
    expect(benchmarkLine(first)).toBe("2/3 (0.667) on triage-bench, at or above the threshold 0.6 · model default · measured version 1 (90df2dfa), nothing is deployed yet");
    // A comparison measures models, not the digest: never the benchmark.
    expect((await l8.getBenchmark("triage"))?.id).toBe("ev-mvi781bk-81b8");
    const matches = (await l8.getBenchmark("triage"))!;
    expect([matches.id, matches.matches_deployed, matches.deployed]).toEqual(["ev-mvi781l4-vr69", true, { version: 1, digest: V1 }]);
    expect(benchmarkLine(matches)).toBe("2/3 (0.667) on triage-bench, at or above the threshold 0.6 · model default · measured version 1 (90df2dfa), what production runs");
    const { text } = render(createElement(BenchmarkView, { benchmark: matches, agent: "triage" }));
    expect(text).toContain("0.667");
    expect(text).toContain("at or above its threshold");
    expect(text).not.toContain("not what production runs");
  });
});

describe("policy reviews: signed by a reviewer who did not author the version", () => {
  it("the author is refused (403 separation_of_duties, naming the authors), and told so before the click", async () => {
    serve("review_403_sod");
    const e = await refused(l8.submitReview("triage", { digest: V1, verdict: "approved", note: "mine is fine" }));
    expect([e.status, e.control, e.body.authors]).toEqual([403, "separation_of_duties", ["Ada <ada@ey.com>"]]);
    expect(reviewRefusalText(e)).toBe(
      `Separation of duties: the author of a version may not review it (authors: Ada <ada@ey.com>). Another policy reviewer signs. Ada <ada@ey.com> saved version 1 of "triage" (digest ${V1}): its author may not review it; another policy reviewer signs`,
    );
    const authors = authorsOf((body("versions_draft").versions as { digest: string; saved_by: string }[]), V1);
    expect(authors).toEqual(["Ada <ada@ey.com>"]);
    // An administrator is still refused her own version; the reviewer is not.
    expect(reviewAccess(ADA, authors, "policy-reviewer")).toEqual({ ok: false, reason: "you saved this version (Ada <ada@ey.com>): its author may not review it; another policy reviewer signs" });
    expect(reviewAccess(RUI, authors, "policy-reviewer")).toEqual({ ok: true, reason: "" });
    expect(reviewAccess(null, authors, "policy-reviewer").ok).toBe(false);
  });

  it("without the reviewer role (403 missing_role), as a viewer (403 approve), a digest no version carries (404), a verdict it does not know (400)", async () => {
    serve("review_403_missing_role", "review_403_viewer", "review_404_digest", "review_400_verdict");
    const role = await refused(l8.submitReview("triage", { digest: V1, verdict: "approved" }));
    expect([role.status, role.missingRole]).toEqual([403, "policy-reviewer"]);
    expect(reviewRefusalText(role)).toBe('Only a holder of the "policy-reviewer" role (or an administrator) signs a policy review. a policy review needs the "policy-reviewer" role; your roles: operator');
    expect(reviewAccess(OLI, ["Ada <ada@ey.com>"], "policy-reviewer")).toEqual({ ok: false, reason: 'a policy review needs the "policy-reviewer" role (or an administrator); yours: operator' });
    const viewer = await refused(l8.submitReview("triage", { digest: V1, verdict: "approved" }));
    expect([viewer.status, viewer.message]).toEqual([403, 'this needs the "approve" permission; your roles: viewer']);
    const digest = await refused(l8.submitReview("triage", { digest: "0".repeat(16), verdict: "approved" }));
    expect([digest.status, digest.field]).toEqual([404, "digest"]);
    const verdict = await refused(l8.submitReview("triage", { digest: V1, verdict: "maybe" as l8.Verdict }));
    expect([verdict.status, verdict.field]).toEqual([400, "verdict"]);
  });

  it("201 for a request for changes, then an approval; the list newest first with the role", async () => {
    const calls = serve("review_201_changes", "review_201_approved", "reviews_list");
    const changes = await l8.submitReview("triage", { digest: V1, verdict: "changes_requested", note: "say why the threshold is 0.6" });
    expect(changes).toMatchObject({ verdict: "changes_requested", by: "Rui <rui@ey.com>", version: 1, authors: ["Ada <ada@ey.com>"], note: "say why the threshold is 0.6" });
    const approved = await l8.submitReview("triage", { digest: V1, verdict: "approved", note: "policy holds" });
    expect([approved.id, approved.verdict]).toEqual(["rv-55746879f41e44d6", "approved"]);
    const list = await l8.listReviews("triage");
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ["POST", "/api/agents/triage/reviews", { digest: V1, verdict: "changes_requested", note: "say why the threshold is 0.6" }],
      ["POST", "/api/agents/triage/reviews", { digest: V1, verdict: "approved", note: "policy holds" }],
      ["GET", "/api/agents/triage/reviews", undefined],
    ]);
    expect([list.count, list.role, list.reviews.map((r) => r.verdict)]).toEqual([2, "policy-reviewer", ["approved", "changes_requested"]]);
    const { text } = render(createElement(ReviewsView, { list }));
    for (const s of ["Approved", "Changes requested", "Rui <rui@ey.com>", "version 1", "policy holds", "say why the threshold is 0.6", "authored by Ada <ada@ey.com>"]) expect(text, s).toContain(s);
  });
});

describe("the promotion gate on a deploy to production", () => {
  it("refused with nothing on record: every unmet condition with its detail, every condition, the decision; the dialog shows them and the override to an administrator", async () => {
    const calls = serve("deploy_409_nothing");
    const e = await refused(l8.deploy("triage"));
    expect(calls).toEqual([{ url: "/api/agents/triage/deploy", method: "POST", body: {} }]);
    const r = l8.gateRefusalOf(e)!;
    expect([r.agent, r.version, r.digest, r.environment, r.decision.startsWith("gd-"), r.saved]).toEqual(["triage", 1, V1, "production", true, null]);
    expect(r.unmet.map((u) => u.condition)).toEqual(["eval", "review"]);
    expect(r.conditions.map((c) => [c.condition, c.met, c.overridden])).toEqual([
      ["eval", false, false],
      ["review", false, false],
      ["findings", true, false],
      ["regression", true, false],
    ]);
    expect(gateSummary(r)).toBe("The promotion gate holds version 1 (90df2dfa) for production: eval, policy review unmet. Nothing that runs changed.");
    expect(overrideChoices(r)).toEqual(["eval", "review"]);
    const admin = render(createElement(GatePanel, { refusal: r, agent: "triage", admin: true, busy: false, error: "", onOverride: () => {} }));
    for (const s of ["The promotion gate refused this deploy", "Unmet", "Eval", "Policy review", "no eval of 90df2dfa5e202811 on triage-bench is on record", "The rest of the gate", "Open findings", "nothing open for triage", "No regression", "Deploy past the gate", "Pass every unmet condition (eval, policy review)", "Deploy with override"]) {
      expect(admin.text, s).toContain(s);
    }
    expect(hrefs(admin.html)).toEqual(expect.arrayContaining(["/evals?agent=triage", "/lifecycle?agent=triage#reviews"]));
    const viewer = render(createElement(GatePanel, { refusal: r, agent: "triage", admin: false, busy: false, error: "", onOverride: () => {} }));
    expect(viewer.text).toContain("Only an administrator may deploy past the gate, with a reason.");
    expect(viewer.text).not.toContain("Deploy with override");
  });

  it("a review asking for changes holds the review condition, the review its item", async () => {
    serve("deploy_409_changes_requested");
    const r = l8.gateRefusalOf(await refused(l8.deploy("triage")))!;
    const review = r.unmet.find((u) => u.condition === "review")!;
    expect(review.detail).toBe("the latest review of 90df2dfa5e202811, by Rui <rui@ey.com>, requested changes: say why the threshold is 0.6");
    expect(review.items.map(itemLine)).toEqual([expect.stringMatching(/^changes requested by Rui <rui@ey\.com> 2026-10-21 14:19:46 UTC: say why the threshold is 0\.6$/)]);
  });

  it("passed on its own records: 200 with the steps, the deployment, the decision, every condition met and what it read", async () => {
    serve("deploy_200");
    const d = await l8.deploy("triage");
    expect([d.deployed, d.version, d.digest, d.environment, d.deployment, d.decision, d.override]).toEqual([true, 1, V1, "production", "dp-9ac1778f1fe943f8", "gd-5b754c7f50894ab1", null]);
    expect(d.steps.map((s) => s.step)).toEqual(["validate", "gate", "register"]);
    expect(d.conditions.every((c) => c.met && !c.overridden)).toBe(true);
    expect(itemLine(d.conditions[0].items[0])).toBe("version 1: 2/3 (0.6667) on triage-bench, threshold 0.6 · ev-mvi781l4-vr69");
    const { text } = render(createElement(DeployedReceipt, { d }));
    expect(text).toContain("Version 1 deployed to production");
    expect(text).toContain("The promotion gate passed on its own records.");
  });

  it("an override: one naming too little is refused again; a blank reason 400; a non-administrator 403; an administrator's passes, recorded", async () => {
    const calls = serve("deploy_409_v2", "deploy_409_override_partial", "deploy_400_override_reason", "deploy_403_override", "deploy_403_viewer", "deploy_200_override");
    const first = l8.gateRefusalOf(await refused(l8.deploy("triage")))!;
    expect(first.unmet.map((u) => u.condition)).toEqual(["eval", "review", "regression"]);
    expect(first.unmet[2].detail).toBe("no score for 9a1150cc0d8cc86e to set against the deployed predecessor's 0.6667 (version 1)");
    // Naming only the review passes it; the eval and the regression still hold the deploy.
    const partial = { reason: "reviewed offline", all: false, picked: ["review" as const] };
    expect(overrideOutcome(partial, first)).toEqual({ passes: ["review"], holds: ["eval", "regression"] });
    const again = l8.gateRefusalOf(await refused(l8.deploy("triage", { override: overrideBody(partial) })))!;
    expect(again.unmet.map((u) => u.condition)).toEqual(["eval", "regression"]);
    expect(again.conditions.filter((c) => c.overridden).map((c) => c.condition)).toEqual(["review"]);
    const blank = await refused(l8.deploy("triage", { override: { reason: "   " } }));
    expect([blank.status, blank.field]).toEqual([400, "override.reason"]);
    const operator = await refused(l8.deploy("triage", { override: { reason: "not mine to give" } }));
    expect([operator.status, operator.control, operator.message]).toEqual([403, "override", "an override of the promotion gate is an administrator's, with a reason"]);
    const viewer = await refused(l8.deploy("triage"));
    expect([viewer.status, viewer.message]).toEqual([403, 'this needs the "deploy" permission; your roles: viewer']);
    const all = { reason: "hotfix for INC-77", all: true, picked: [] };
    const d = await l8.deploy("triage", { override: overrideBody(all) });
    expect(calls.map((c) => c.body)).toEqual([{}, { override: { reason: "reviewed offline", conditions: ["review"] } }, { override: { reason: "   " } }, { override: { reason: "not mine to give" } }, {}, { override: { reason: "hotfix for INC-77" } }]);
    expect([d.version, d.deployment, d.override?.passed, d.override?.by, d.override?.audit_id]).toEqual([2, "dp-c1ad4a58de7b4036", ["eval", "review", "regression"], "Ada <ada@ey.com>", 26]);
    expect(d.conditions.filter((c) => c.overridden).map((c) => c.condition)).toEqual(["eval", "review", "regression"]);
    expect(overrideLine(d.override!)).toBe("Override by Ada <ada@ey.com> 2026-10-21 14:19:46 UTC: passed Eval, Policy review, No regression. Reason: hotfix for INC-77 · audit event #26");
    expect(render(createElement(DeployedReceipt, { d })).text).toContain("passed Eval, Policy review, No regression");
  });

  it("the conditions the first story left met: a regression, open findings, no suite, a set that does not exist", async () => {
    serve("deploy_409_regression", "deploy_200_override_regression", "deploy_409_findings", "deploy_409_no_suite", "deploy_409_missing_set");
    const regression = l8.gateRefusalOf(await refused(l8.deploy("triage")))!;
    expect(regression.unmet.map((u) => u.condition)).toEqual(["regression"]);
    expect(regression.unmet[0].detail).toMatch(/^[0-9a-f]{16} scores 0\.3333 on triage-bench, below the deployed predecessor's 0\.6667 \(version 1\)$/);
    expect(regression.unmet[0].items.map(itemLine)).toEqual([
      expect.stringMatching(/^version 2: 1\/3 \(0\.3333\) on triage-bench, threshold 0\.3 · ev-/),
      expect.stringMatching(/^version 1: 2\/3 \(0\.6667\) on triage-bench, threshold 0\.3 · ev-/),
    ]);
    const passed = await l8.deploy("triage", { override: { reason: "the old one escalated too much", conditions: ["regression"] } });
    expect(passed.override?.passed).toEqual(["regression"]);
    const findings = l8.gateRefusalOf(await refused(l8.deploy("triage")))!;
    expect(findings.unmet.map((u) => u.condition)).toEqual(["eval", "review", "findings"]);
    const items = findings.unmet[2].items;
    expect(items.map((i) => [i.kind, findingHref(i)])).toEqual([
      ["server", "/configuration"],
      ["peer", "/peers#peer-vendor-bot"],
      ["guardian", "/guardian"],
      ["side_channel", null],
      ["breaker", "/breakers"],
    ]);
    expect(itemLine(items[0])).toBe("server crm: tool server crm is pending, not approved");
    expect(findings.unmet[0].detail).toBe("spec.evals.dataset names the eval set 'triage-bench', which does not exist");
    const html = render(createElement(GatePanel, { refusal: findings, agent: "triage", admin: true, busy: false, error: "", onOverride: () => {} })).html;
    expect(hrefs(html)).toEqual(expect.arrayContaining(["/configuration", "/peers#peer-vendor-bot", "/guardian", "/breakers"]));
    const bare = l8.gateRefusalOf(await refused(l8.deploy("bare")))!;
    expect(bare.unmet[0].detail).toBe("the spec declares no eval suite: set spec.evals.dataset to the eval set it is measured on, and spec.evals.threshold");
    const lost = l8.gateRefusalOf(await refused(l8.deploy("lost")))!;
    expect(lost.unmet[0].detail).toBe("spec.evals.dataset names the eval set 'missing-set', which does not exist");
  });

  it("saving with deploy: true refused at the gate: the 409 carries the version saved, as a draft", async () => {
    const calls = serve("save_deploy_409");
    const e = await refused(l8.saveAgent({ metadata: { id: "triage" } }, { deploy: true }));
    expect(calls[0]).toEqual({ url: "/api/agents", method: "POST", body: { spec: { metadata: { id: "triage" } }, deploy: true } });
    const r = l8.gateRefusalOf(e)!;
    expect([r.version, r.digest, r.saved?.version, r.saved?.draft, r.saved?.digest]).toEqual([3, V3, 3, true, V3]);
    expect(gateSummary(r)).toBe("The promotion gate holds version 3 (91e6d338) for production: eval, policy review, no regression unmet. Version 3 is saved as a draft; nothing that runs changed.");
    expect(gatedSaveLine(r.saved!)).toBe("Version 3 is saved as a draft. Production keeps running its deployed version until a deploy passes the gate.");
  });

  it("another environment is recorded, not gated; canary is not deployed to", async () => {
    serve("deploy_staging_200", "deploy_400_canary");
    const d = await l8.deploy("triage", { environment: "staging", version: 2 });
    expect([d.environment, d.version, d.decision, d.conditions, d.steps.map((s) => s.step)]).toEqual(["staging", 2, "", [], ["validate", "register"]]);
    expect(render(createElement(DeployedReceipt, { d })).text).toContain("Recorded for that environment; production runs what it ran.");
    const canary = await refused(l8.deploy("triage", { environment: "canary" }));
    expect([canary.status, canary.field]).toEqual([400, "environment"]);
  });
});

describe("drafts: what runs stays until a deploy", () => {
  it("a save before the first deploy is what runs; once deployed a save is a draft, and the builder edits it", async () => {
    const calls = serve("save_v1_200", "save_v2_draft", "agent_detail_draft", "version_2_doc");
    const first = await l8.saveAgent({ metadata: { id: "triage" } });
    expect([first.version, first.draft]).toEqual([1, false]);
    expect(savedLine(first, null)).toBe("Saved version 1. The agent is not deployed yet, so the save is what runs.");
    const draft = await l8.saveAgent({ metadata: { id: "triage" } });
    expect([draft.version, draft.draft, draft.deployed]).toEqual([2, true, false]);
    expect(savedLine(draft, 1)).toBe("Saved version 2 as a draft. Production keeps running version 1 until a deploy.");
    const edit = await l8.editableDocument("triage");
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["POST", "/api/agents"],
      ["POST", "/api/agents"],
      ["GET", "/api/agents/triage"],
      ["GET", "/api/agents/triage/versions/2"],
    ]);
    expect([edit.version, edit.draft, edit.agent.spec_version, edit.agent.deployed_version, edit.agent.deployed_digest]).toEqual([2, true, 1, 1, V1]);
    // The document that runs is version 1's; the one edited is the draft's.
    const nodes = (s: Record<string, unknown>) => ((s.spec as { nodes: { steps: { prompt: string }[] }[] }).nodes[0].steps[0].prompt);
    expect([nodes(edit.agent.spec), nodes(edit.spec)]).toEqual(["Triage {{incident}}", "Triage again {{incident}}"]);
    expect(draftToLoad(edit.agent)).toBe(2);
    expect(draftBanner(edit.agent)).toBe("Editing draft version 2. Production runs version 1; a save stays a draft until it is deployed through the promotion gate.");
  });

  it("a version's document by number: what runs is `current`; a version that is not there is 404", async () => {
    serve("version_1_doc", "version_404");
    const v1 = await l8.getVersionDocument("triage", 1);
    expect([v1.version, v1.digest, v1.current, v1.deployed, v1.saved_by]).toEqual([1, V1, true, true, "Ada <ada@ey.com>"]);
    expect((await refused(l8.getVersionDocument("triage", 9))).message).toBe('"triage" has no version 9');
  });

  it("an agent deployed before deployments were recorded (adopted): its save is a draft too; production's version is named, no row lights its spine", async () => {
    serve("save_adopted_draft", "agent_detail_adopted", "deployments_adopted", "lifecycle_adopted");
    const saved = await l8.saveAgent({ metadata: { id: "legacy" } });
    expect([saved.version, saved.draft]).toEqual([2, true]);
    const detail = await l8.getAgentDetail("legacy");
    expect([detail.version, detail.spec_version, detail.deployed_version]).toEqual([2, 1, 1]);
    const list = await l8.listDeployments("legacy");
    expect([list.deployments, list.current, list.adopted?.adopted, list.adopted?.version, list.adopted?.deployment]).toEqual([[], {}, true, 1, null]);
    expect(rollbackTargets(list)).toEqual([]);
    const text = render(createElement(DeploymentsView, { list })).text;
    expect(text).toContain("Production runs version 1");
    expect(text).toContain("deployed before deployments were recorded");
    const spine = await l8.getLifecycle("legacy");
    expect(spineOf(spine).find((s) => s.stage === "deployed")).toMatchObject({ lit: false, tone: "neutral", note: "production runs this digest (version 1), deployed before deployments were recorded: no deployment row lights it" });
    expect(spineHeadline(spine)).toMatch(/^Version 1 \([0-9a-f]{8}\): designed\. Production runs it\.$/);
  });
});

describe("the lifecycle spine: each stage lit only by its own record", () => {
  it("designed, then reviewed, then approved and deployed: who and when, the furthest lit", async () => {
    serve("lifecycle_designed", "lifecycle_reviewed", "lifecycle_deployed");
    const designed = await l8.getLifecycle("triage");
    expect(designed.stages.map((s) => s.stage)).toEqual(["designed", "reviewed", "approved", "canary", "deployed", "retired"]);
    expect(spineOf(designed).map((s) => [s.stage, s.lit])).toEqual([
      ["designed", true],
      ["reviewed", false],
      ["approved", false],
      ["canary", false],
      ["deployed", false],
      ["retired", false],
    ]);
    expect(spineOf(designed)[0]).toMatchObject({ who: "by Ada <ada@ey.com> · 2026-10-21 14:19:46 UTC", note: "version 1 saved", tone: "ok" });
    expect(spineHeadline(designed)).toBe("Version 1 (90df2dfa): designed. Nothing is deployed to production.");
    const reviewed = await l8.getLifecycle("triage");
    expect(spineOf(reviewed)[1]).toMatchObject({ lit: true, who: "by Rui <rui@ey.com> · 2026-10-21 14:19:46 UTC", note: "approved: policy holds" });
    const deployed = await l8.getLifecycle("triage");
    expect([deployed.current, deployed.deployed?.version, deployed.deployed?.adopted]).toEqual(["deployed", 1, false]);
    const lit = spineOf(deployed);
    expect(lit.filter((s) => s.lit).map((s) => s.stage)).toEqual(["designed", "reviewed", "approved", "deployed"]);
    expect(lit[2].note).toBe("the gate passed on its own records");
    expect(lit[4].note).toBe("what production runs now");
    expect(spineHeadline(deployed)).toBe("Version 1 (90df2dfa): deployed. Production runs it.");
    const { text } = render(createElement(SpineView, { lifecycle: deployed }));
    for (const s of ["Designed", "Reviewed", "Approved", "Canary", "Deployed", "Retired", "by Rui <rui@ey.com>", "waiting on a canary deployment of this digest beside production", "what production runs now"]) expect(text, s).toContain(s);
  });

  it("a draft's spine is its own: designed only, while production runs the first", async () => {
    serve("lifecycle_draft");
    const l = await l8.getLifecycle("triage");
    expect([l.digest, l.version, l.current, l.deployed?.version]).toEqual([V2, 2, "designed", 1]);
    expect(spineHeadline(l)).toBe("Version 2 (9a1150cc): designed. Production runs version 1 (90df2dfa).");
  });

  it("an override lights approved, said as one; a version rolled back from stays deployed, no longer what runs", async () => {
    serve("lifecycle_overridden", "lifecycle_after_rollback", "lifecycle_v1", "lifecycle_404_digest");
    const over = spineOf(await l8.getLifecycle("triage"));
    expect(over.find((s) => s.stage === "approved")).toMatchObject({ lit: true, tone: "warn", note: "passed by an administrator's override (eval, review, regression): hotfix for INC-77" });
    expect(over.find((s) => s.stage === "reviewed")?.lit).toBe(false);
    const after = await l8.getLifecycle("triage");
    const deployed = spineOf(after).find((s) => s.stage === "deployed")!;
    expect([after.current, deployed.lit, deployed.tone]).toEqual(["deployed", true, "warn"]);
    expect(deployed.note).toBe("deployed past the gate by override: hotfix for INC-77; no longer what production runs (version 1 runs now)");
    const v1 = spineOf(await l8.getLifecycle("triage", V1)).find((s) => s.stage === "deployed")!;
    expect(v1.note).toBe("reinstated by a rollback: v2 escalates everything; what production runs now");
    const missing = await refused(l8.getLifecycle("triage", "0".repeat(16)));
    expect([missing.status, missing.field]).toEqual([404, "digest"]);
  });
});

describe("deployments per environment, and rollback with the runs it flags", () => {
  it("per environment, newest first, what each runs now; a rollback names what it replaced and what it flagged", async () => {
    const calls = serve("deployments_one", "deployments_after_rollback", "deployments_envs");
    const one = await l8.listDeployments("triage");
    expect([one.count, one.current.production?.version, one.adopted]).toEqual([1, 1, null]);
    expect(rollbackTargets(one)).toEqual([]);
    const after = await l8.listDeployments("triage");
    expect(after.deployments.map((d) => [d.kind, d.version, d.current, Boolean(d.override), d.flagged.length])).toEqual([
      ["rollback", 1, true, false, 2],
      ["deploy", 2, false, true, 0],
      ["deploy", 1, false, false, 0],
    ]);
    expect(rollbackTargets(after).map((t) => [t.version, t.how])).toEqual([[2, "deploy"]]);
    const envs = await l8.listDeployments("triage");
    expect(calls.map((c) => c.url)).toEqual(["/api/agents/triage/deployments", "/api/agents/triage/deployments", "/api/agents/triage/deployments"]);
    expect(Object.keys(envs.current).sort()).toEqual(["production", "staging"]);
    const { text, html } = render(createElement(DeploymentsView, { list: envs }));
    for (const s of ["production", "runs version 1", "staging", "runs version 2", "recorded only: what production runs does not move", "rollback", "Reason: v2 escalates everything", "2 runs of version 2 flagged:", "Override by Ada <ada@ey.com>"]) expect(text, s).toContain(s);
    expect(hrefs(html)).toEqual(["/runs?id=triage-2026-10-21T14-19-46-tuqz", "/runs?id=triage-2026-10-21T14-19-46-uxdd"]);
  });

  it("rollback: 400 a reason, 404 a version, 200 with the flagged runs; again 409; a version never deployed 409", async () => {
    const calls = serve("rollback_400_reason", "rollback_404_version", "rollback_200", "rollback_409_already", "rollback_409_never");
    expect((await refused(l8.rollback("triage", { to_version: 1, reason: "" }))).field).toBe("reason");
    expect((await refused(l8.rollback("triage", { to_version: 9, reason: "x" }))).field).toBe("to_version");
    const r = await l8.rollback("triage", { to_version: 1, reason: "v2 escalates everything" });
    expect([r.from, r.to, r.count, r.flagged, r.deployment.kind, r.deployment.current, r.deployment.previous?.version, r.audit_id]).toEqual([
      { version: 2, digest: V2 },
      { version: 1, digest: V1 },
      2,
      ["triage-2026-10-21T14-19-46-tuqz", "triage-2026-10-21T14-19-46-uxdd"],
      "rollback",
      true,
      2,
      33,
    ]);
    expect(rollbackLine(r)).toBe("Rolled back from version 2 to 1 by Ada <ada@ey.com>: v2 escalates everything. 2 runs of version 2 flagged for review.");
    const { html } = render(createElement(RollbackReceipt, { r }));
    expect(hrefs(html)).toEqual(["/runs?id=triage-2026-10-21T14-19-46-tuqz", "/runs?id=triage-2026-10-21T14-19-46-uxdd"]);
    expect((await refused(l8.rollback("triage", { to_version: 1, reason: "again" }))).message).toBe("version 1 is what production runs now");
    expect((await refused(l8.rollback("triage", { to_version: 3, reason: "x" }))).message).toBe('version 3 of "triage" was never deployed: a rollback reinstates a version that ran in production; deploy it through the gate instead');
    expect(calls[2].body).toEqual({ to_version: 1, reason: "v2 escalates everything" });
  });

  it("a flagged run says so on the run page: the version rolled back from, by whom, why", async () => {
    serve("run_flagged");
    const { data } = await api.GET("/api/runs/{run_id}", { params: { path: { run_id: "triage-2026-10-21T14-19-46-tuqz" } } });
    const flag = runFlagOf(data)!;
    expect(flag).toEqual({ flag: "rolled_back", from: { version: 2, digest: V2 }, to: { version: 1, digest: V1 }, reason: "v2 escalates everything", by: "Ada <ada@ey.com>", at: "2026-10-21T14:19:46.415Z" });
    expect(runFlagLine(flag)).toBe("This run is of version 2, which Ada <ada@ey.com> rolled back to version 1 2026-10-21 14:19:46 UTC: v2 escalates everything. Review what it did.");
    const { text, html } = render(createElement(RunFlagsBanner, { flags: runFlagsOf(data), agent: "triage" }));
    expect(text).toContain("Flagged for review: its version was rolled back");
    expect(hrefs(html)).toEqual(["/lifecycle?agent=triage#deployments"]);
  });
});

describe("retirement: refused new work everywhere, its records kept", () => {
  it("the replacement must be another saved agent; a reason is required; 201; then 409 retired at every door", async () => {
    serve("retire_400_replacement", "retire_404_replacement", "retire_400_reason", "retire_201", "retire_409_again", "deploy_409_retired", "rollback_409_retired", "runs_409_retired");
    expect((await refused(l8.retire("triage", { reason: "x", replacement: "triage" }))).field).toBe("replacement");
    expect((await refused(l8.retire("triage", { reason: "x", replacement: "nobody" }))).message).toBe('replacement: no saved agent "nobody"');
    expect((await refused(l8.retire("triage", { reason: "" }))).field).toBe("reason");
    const r = await l8.retire("triage", { reason: "superseded by the next triage", replacement: "triage-next" });
    expect([r.agent, r.replacement, r.by, r.cancelled_jobs, r.audit_id]).toEqual(["triage", "triage-next", "Ada <ada@ey.com>", [], 45]);
    for (const p of [l8.retire("triage", { reason: "twice" }), l8.deploy("triage", { override: { reason: "bring it back" } }), l8.rollback("triage", { to_version: 2, reason: "bring it back" })]) {
      const e = await refused(p);
      expect([e.status, e.control, l8.retiredRefusalOf(e)?.replacement]).toEqual([409, "retired", "triage-next"]);
      expect(l8.gateRefusalOf(e)).toBeNull();
    }
    // The runs door, through the generated client the Runs page uses.
    const { error, response } = await api.POST("/api/runs", { body: { agent: "triage", input: { incident: "INC-9" }, provider: "scripted", model: "" } });
    expect(response.status).toBe(409);
    const gone = l8.retiredOf((error as { retired?: unknown }).retired)!;
    expect(retiredLine(gone)).toBe("Retired by Ada <ada@ey.com> 2026-10-21 14:19:46 UTC: superseded by the next triage. Replaced by triage-next. It takes no new runs or triggers; its runs and versions stay readable.");
  });

  it("retired where the agent appears: the list, the detail, the spine; the replacement linked", async () => {
    serve("agents_list_retired", "agent_detail_retired", "lifecycle_retired");
    const agents = await l2.listAgents();
    expect(agents.map((a) => [a.id, l8.retiredOf(a.retired)?.replacement ?? null])).toEqual([
      ["triage-next", null],
      ["triage", "triage-next"],
    ]);
    const index = render(createElement(LifecycleIndexView, { agents }));
    for (const s of ["triage-next", "Not deployed", "Retired", "superseded by the next triage · replaced by triage-next"]) expect(index.text, s).toContain(s);
    const detail = await l8.getAgentDetail("triage");
    expect([detail.retired?.reason, detail.deployed_version, detail.version]).toEqual(["superseded by the next triage", 1, 3]);
    const spine = await l8.getLifecycle("triage");
    expect(spine.current).toBe("retired");
    expect(spineOf(spine).find((s) => s.stage === "retired")).toMatchObject({ lit: true, tone: "err", note: "superseded by the next triage; replaced by triage-next" });
    expect(spineHeadline(spine)).toBe("Retired 2026-10-21 14:19:46 UTC by Ada <ada@ey.com>; replaced by triage-next.");
    const { html, text } = render(createElement(RetiredView, { retired: spine.retired! }));
    expect(text).toContain("Its replacement, triage-next");
    expect(hrefs(html)).toEqual(["/lifecycle?agent=triage-next"]);
  });

  it("its queued jobs are cancelled with the reason under cancel_reason, never error; its trigger 409; the queue counts it", async () => {
    serve("retire_201_jobs", "job_cancelled_retired", "trigger_409_retired", "queue_after_retire");
    const r = await l8.retire("intake", { reason: "replaced by triage", replacement: "triage" });
    expect(r.cancelled_jobs).toEqual(["1e4e9411-10e0-425f-9a3a-f18fcbcd4259"]);
    const { data: job } = await api.GET("/api/trigger/{agent}/jobs/{job_id}", { params: { path: { agent: "intake", job_id: r.cancelled_jobs[0] } } });
    expect([job?.status, job?.error, job?.cancel_reason, job?.taint]).toEqual(["cancelled", null, "the agent was retired by Chandresh Singh: replaced by triage", null]);
    expect(jobLine(job!)).toBe("cancelled · from ops · attempt 0 of 3 · withdrawn: the agent was retired by Chandresh Singh: replaced by triage");
    const { error, response } = await api.POST("/api/trigger/{agent}", { params: { path: { agent: "intake" } }, body: { input: { case: "C-4" }, model: "", wait: false } });
    expect([response.status, (error as { control?: string }).control]).toEqual([409, "retired"]);
    const q = await l2.readQueue();
    expect([q.agents.intake?.cancelled, q.last_hour.finished]).toEqual([1, 0]);
  });
});

describe("GET /api/attention: the L8 kinds", () => {
  it("override: opens the lifecycle at the digest; says what it passed and why", async () => {
    serve("attention_override");
    const [item] = await l5.listAttention();
    expect([item.kind, item.severity, item.action.kind, item.action.href, ATTENTION_LABEL[item.kind], attentionVerb(item)]).toEqual(["override", 6, "open", `/lifecycle?agent=triage&digest=${V2}`, "override", "Open"]);
    expect(item.title).toBe("triage: version 2 deployed past the promotion gate by Ada <ada@ey.com> (eval, review, regression)");
    expect(overrideOfAttention(item)).toEqual({ reason: "hotfix for INC-77", by: "Ada <ada@ey.com>", passed: ["eval", "review", "regression"], version: 2, environment: "production" });
    expect(l5.openableRun(item)).toBeNull();
  });

  it("rollback: opens the deployments; the runs it flagged are the row's runs", async () => {
    serve("attention_rollback");
    const items = await l5.listAttention();
    const item = items.find((i) => i.kind === "rollback")!;
    expect([item.action.kind, item.action.href, item.title]).toEqual(["open", "/lifecycle?agent=triage#deployments", "triage: rolled back from version 2 to 1; 2 runs flagged"]);
    expect(rollbackOfAttention(item)).toEqual({ from: 2, to: 1, reason: "v2 escalates everything", flagged: ["triage-2026-10-21T14-19-46-tuqz", "triage-2026-10-21T14-19-46-uxdd"] });
    expect(item.runs).toEqual(["triage-2026-10-21T14-19-46-tuqz", "triage-2026-10-21T14-19-46-uxdd"]);
    expect(l5.L8_ATTENTION_KINDS).toEqual(["override", "rollback"]);
  });

  it("drift: the action is the fleet door's pause for a person, the drift report the row's link; the pause sent with the backend's reason", async () => {
    const calls = serve("attention_drift_pause", "fleet_pause_from_drift");
    const [item] = await l5.listAttention();
    expect([item.kind, item.action.kind, item.action.method, item.action.path, item.action.href, attentionVerb(item)]).toEqual(["drift", "pause", "POST", "/api/fleet", "/drift?agent=triage", "Pause agent…"]);
    expect(item.action.says).toContain("nothing pauses it on its own");
    const p = pauseOf(item)!;
    expect(p).toEqual({ agents: ["triage"], reason: "drift: tool_mix moved past their thresholds" });
    expect(driftBenchmarkOf(item)).toBeNull();
    const r = await l5.fleet("pause", p.agents, p.reason);
    expect(calls[1]).toEqual({ url: "/api/fleet", method: "POST", body: { action: "pause", agents: ["triage"], reason: "drift: tool_mix moved past their thresholds" } });
    expect([r.action, r.paused.triage?.reason]).toEqual(["pause", "drift: tool_mix moved past their thresholds"]);
  });

  it("drift against the benchmark: the item names the eval; the drift report's benchmark block, drifted though the trailing windows are thin", async () => {
    serve("attention_drift_benchmark", "drift_benchmark");
    const items = await l5.listAttention();
    const drift = items.find((i) => i.kind === "drift")!;
    const b = driftBenchmarkOf(drift)!;
    expect(b).toEqual({ id: "ev-mvi781vw-mp7l", digest: V1, version: 1, set: "triage-bench", at: expect.stringMatching(/^2026-10-21T/), cases: 3, labeled: true });
    expect(driftBenchmarkLine(b)).toBe("against the benchmark ev-mvi781vw-mp7l (version 1, triage-bench, 3 cases, labeled)");
    const report = await l7.getDrift("triage");
    const a = report.agents[0];
    expect([a.enough, a.drifted, a.measures, a.benchmark?.enough, a.benchmark?.drifted]).toEqual([false, true, [], true, true]);
    expect(a.benchmark?.measures.map((m) => [m.name, m.drifted])).toEqual([
      ["benchmark_outcomes", true],
      ["benchmark_labels", true],
    ]);
    expect(driftVerdict(a)).toEqual({ tone: "err", label: "Drifted", detail: "shifted: Outcomes vs benchmark, Outcomes vs benchmark labels" });
    const { text } = render(createElement(AgentCard, { drift: a, windows: report.windows, single: true }));
    for (const s of ["Drifted", "Against the benchmark", "ev-mvi781vw-mp7l · version 1 (90df2dfa) on triage-bench, 3 cases, labeled", "Outcomes vs benchmark", "Outcomes vs benchmark labels", "ESCALATE 100%"]) expect(text, s).toContain(s);
  });
});

describe("the guardian's redirect", () => {
  it("in its limits: the PUT, the view, the form round trip", async () => {
    const calls = serve("guardian_put_redirect", "guardian_view_redirect", "guardian_put_400_may");
    const put = await l7.setGuardian({ enabled: true, agents: ["triage"], may: ["redirect"], every_entries: 1 });
    expect(calls[0].body).toEqual({ enabled: true, agents: ["triage"], may: ["redirect"], every_entries: 1 });
    expect(put.may).toEqual(["redirect"]);
    const v = await l7.getGuardian();
    const f = formOf(v);
    expect([f.hold, f.block, f.redirect, mayOf(f)]).toEqual([false, false, true, ["redirect"]]);
    expect(patchOf(v, { ...f, hold: true })).toEqual({ may: ["hold", "redirect"] });
    expect(mayText(v.may)).toBe("redirect a run, its reason handed to it as guidance; a hold or a block is raised for a person");
    expect(mayText(["hold", "block", "redirect"])).toBe("hold a run at its next gate, block (kill) it, or redirect it with its reason as guidance");
    const bad = await refused(l7.setGuardian({ may: ["steer" as l7.GuardianAct] }));
    expect([bad.status, bad.field, bad.message]).toEqual([400, "may", "may lists what the guardian may do on its own: hold, block, redirect"]);
  });

  it("acted: the action, the attention row opens the run, the run's own note carries the guidance it was handed", async () => {
    serve("guardian_actions_redirected", "attention_guardian_redirected", "run_guardian_redirected");
    const { actions } = await l7.listGuardianActions();
    expect([actions[0].action, actions[0].outcome, actions[0].verdict]).toEqual(["redirect", "acted", "redirect"]);
    expect(outcomeText(actions[0])).toBe("Redirected: its reason went to the run as guidance for its next model call");
    const [item] = await l5.listAttention();
    expect([item.kind, item.action.kind, item.title]).toEqual(["guardian", "open", "triage: the guardian redirected run triage-2026-10-21T14-19-46-67hd"]);
    const { data } = await api.GET("/api/runs/{run_id}", { params: { path: { run_id: "triage-2026-10-21T14-19-46-67hd" } } });
    const note = (data!.journal.entries as unknown as { kind: string; title?: string; detail?: string; data?: Record<string, unknown> }[]).find((e) => e.data?.control === "guardian")!;
    expect(l5.operatorOf(note)).toEqual({
      action: "Guardian redirected the run",
      by: "guardian",
      at: "2026-10-21T14:19:46.828Z",
      detail: "The guardian redirects this run: stay on the case: summarise the incident, do not draft an email — confidence 0.90 · (deployment default) · delivered in-process",
    });
  });

  it("outside its limits: the row's lever is the steer it would have sent, with the guidance; a person sends it", async () => {
    const calls = serve("guardian_actions_would_redirect", "attention_guardian_would_redirect", "steer_redirect");
    const { actions } = await l7.listGuardianActions();
    expect(outcomeText(actions[0])).toBe("Raised for a person: it would redirect the run, but redirect is not among what the guardian may do (may: hold)");
    const [item] = await l5.listAttention();
    expect([item.action.kind, item.action.method, item.action.path, attentionVerb(item), ACTION_LABEL.redirect]).toEqual(["redirect", "POST", "/api/runs/vetting-2026-10-21T14-19-46-491706/steer", "Redirect…", "Redirect…"]);
    const guidance = redirectGuidanceOf(item);
    expect(guidance).toBe("The guardian redirects this run: stay on the case: summarise the incident, do not draft an email");
    const r = await l5.steerRun(item.run!, { guidance });
    expect(calls[2]).toEqual({ url: "/api/runs/vetting-2026-10-21T14-19-46-491706/steer", method: "POST", body: { guidance } });
    expect([r.delivery, r.applied.guidance]).toEqual(["worker", guidance]);
  });
});

describe("jobs and kills: taint, cancel_reason, answered_state", () => {
  const JOB = "0c23b70c-b749-4bd7-b2e9-16c1eb830f94";

  it("an A2A task's job carries its taint: untrusted input; its run says so, with the message the task brought in", async () => {
    serve("job_tainted", "job_tainted_running", "run_tainted");
    const { data: queued } = await api.GET("/api/trigger/{agent}/jobs/{job_id}", { params: { path: { agent: "vetting", job_id: JOB } } });
    expect([queued?.status, queued?.taint, queued?.source, queued?.external_id]).toEqual(["queued", "a2a:vendor-bot", "a2a · vendor-bot", "a2a:vendor-bot:t-9"]);
    expect(taintOf(queued?.taint)).toEqual({ source: "a2a:vendor-bot", kind: "a2a", from: "vendor-bot" });
    expect(jobLine(queued!)).toBe("queued · from a2a · vendor-bot · attempt 0 of 3 · untrusted input from vendor-bot");
    const { data: running } = await api.GET("/api/trigger/{agent}/jobs/{job_id}", { params: { path: { agent: "vetting", job_id: JOB } } });
    expect([running?.status, running?.run_url, running?.taint]).toEqual(["running", "/runs?id=vetting-2026-10-21T14-19-46-0c23b7", "a2a:vendor-bot"]);
    const { data: run } = await api.GET("/api/runs/{run_id}", { params: { path: { run_id: "vetting-2026-10-21T14-19-46-0c23b7" } } });
    const flags = runFlagsOf(run);
    expect([flags.taint?.source, flags.job, flags.inbound?.peer, flags.inbound?.task, flags.inbound?.screen, flags.inbound?.bytes, flags.inbound?.signed]).toEqual(["a2a:vendor-bot", JOB, "vendor-bot", "t-9", "allow", 23, true]);
    const { text } = render(createElement(RunFlagsBanner, { flags, agent: "vetting" }));
    expect(text).toContain("Untrusted input");
    expect(text).toContain("an A2A task sent by vendor-bot (taint a2a:vendor-bot)");
    expect(text).toContain("Message from peer vendor-bot (task t-9): 23 bytes, sha256:d54fe85d6e25, screened allow, signed.");
  });

  it("a job its caller withdrew: cancelled, the reason under cancel_reason, the error empty; the queue counts it and the last hour does not", async () => {
    serve("job_cancelled_reason", "queue_cancelled_reason");
    const { data: job } = await api.GET("/api/trigger/{agent}/jobs/{job_id}", { params: { path: { agent: "vetting", job_id: "7bf75a8e-7c5d-45d5-9a7d-f137c88ac753" } } });
    expect([job?.status, job?.error, job?.cancel_reason, job?.taint]).toEqual(["cancelled", null, "canceled by the caller over A2A", "a2a:vendor-bot"]);
    expect(jobLine(job!)).toBe("cancelled · from a2a · vendor-bot · attempt 0 of 3 · withdrawn: canceled by the caller over A2A · untrusted input from vendor-bot");
    const q = await l2.readQueue();
    expect([q.agents.vetting?.cancelled, q.agents.vetting?.done, q.last_hour.finished]).toEqual([1, 1, 1]);
  });

  it("a kill's peer cancel: the peer's answer under answered_state, the state this side last saw under state; the tree's peer node carries the cancel", async () => {
    const run = "vetting-2026-10-21T14-19-47-8ce89e";
    serve("tree_before_kill", "kill_answered_202", "tree_after_kill");
    const before = await l7.getRunTree(run);
    expect(before.nodes.filter((n) => n.kind === "peer").map((n) => [n.peer?.task_id, n.state, n.peer?.cancel])).toEqual([
      ["t-77", "submitted", null],
      ["t-79", "working", null],
    ]);
    const r = await l7.killRun(run, "stop");
    const by = Object.fromEntries(r.reached.map((x) => [x.task_id ?? x.run, x]));
    expect([by["t-77"].delivery, by["t-77"].state, by["t-77"].answered_state, answerOf(by["t-77"])]).toEqual(["a2a", "submitted", "canceled", "canceled"]);
    expect([by["t-79"].delivery, by["t-79"].state, by["t-79"].answered_state]).toEqual(["a2a-refused", "working", null]);
    expect(by[run].answered_state).toBeNull();
    expect(peerTaskLine(by["t-77"])).toBe("task t-77 at soc-stub: cancelled, the peer answered canceled (last seen submitted)");
    expect(peerTaskLine(by["t-79"])).toBe("task t-79 at soc-stub: not cancelled: peer 'soc-stub' refused tasks/cancel: task not found (last seen working)");
    expect([reachedStateText(by["t-77"]), reachedStateText(by["t-79"])]).toEqual(["answered canceled", "last seen working"]);
    const receipt = render(createElement(KillReceiptView, { receipt: r })).text;
    for (const s of ["task t-77", "answered canceled", "last seen submitted", "task not found"]) expect(receipt, s).toContain(s);
    const after = await l7.getRunTree(run);
    const peers = after.nodes.filter((n) => n.kind === "peer");
    expect(peers.map((n) => [n.peer?.task_id, n.state, n.peer?.cancel])).toEqual([
      ["t-77", "canceled", { state: "canceled", by: "Chandresh Singh", reason: "stop", delivery: "a2a" }],
      ["t-79", "working", null],
    ]);
    expect(peerCancelLine(peers[0].peer)).toBe("cancelled over A2A by Chandresh Singh (stop); the peer answered canceled");
    expect(render(createElement(RunTreeBody, { tree: after })).text).toContain("cancelled over A2A by Chandresh Singh (stop); the peer answered canceled");
  });
});

describe("the console's shapes and the generated client agree", () => {
  /** Every field the console names is the backend's, with a type the backend's admits (as tests/l7b-contract.test.ts holds the second round). */
  type FieldsAgree<Hand, Gen> = { [K in keyof Hand]-?: K extends keyof Gen ? (Exclude<Hand[K], undefined> extends Gen[K] ? true : false) : false }[keyof Hand];
  type Agrees<Hand, Gen> = [FieldsAgree<Hand, Gen>] extends [true] ? true : false;

  it("field by field, for every shape lib/api/l8.ts reads and sends", () => {
    expectTypeOf<Agrees<l8.EvalRunStarted, Schemas["EvalRunStarted"]>>().toEqualTypeOf<true>();
    // The matrix and the metrics are lib/metrics.ts's own shapes, which the backend types as open objects.
    expectTypeOf<Agrees<Omit<l8.EvalRunView, "matrix" | "metrics">, Schemas["EvalRunView"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l8.EvalProgress, Schemas["EvalProgress"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l8.EvalCaseResult, Schemas["EvalCaseResult"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l8.EvalCheck, Schemas["EvalCheck"]>>().toEqualTypeOf<true>();
    // compare's scope has a default the backend applies (class); the generator types a defaulted field as required, so the console's optional scope is held apart.
    expectTypeOf<Agrees<Omit<l8.EvalRequest, "compare">, Schemas["EvalRunRequest"]>>().toEqualTypeOf<true>();
    expectTypeOf<NonNullable<l8.EvalRequest["compare"]>["scope"]>().toEqualTypeOf<Schemas["EvalCompare"]["scope"] | undefined>();
    expectTypeOf<NonNullable<l8.EvalRequest["compare"]>["models"]>().toEqualTypeOf<Schemas["EvalCompare"]["models"]>();
    expectTypeOf<Agrees<l8.Benchmark, Schemas["Benchmark"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l8.Review, Schemas["ReviewView"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l8.ReviewList, Schemas["ReviewList"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l8.ReviewRequest, Schemas["ReviewRequest"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l8.Condition, Schemas["Condition"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l8.Unmet, Schemas["Unmet"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<Omit<l8.GateRefusal, "saved">, Schemas["GateRefusal"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l8.DeployRequest, Schemas["DeployBody"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l8.OverrideRequest, Schemas["OverrideBody"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l8.Deployed, Schemas["AgentDeployed"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l8.Deployment, Schemas["DeploymentView"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l8.DeploymentList, Schemas["DeploymentList"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l8.Stage, Schemas["Stage"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l8.Lifecycle, Schemas["Lifecycle"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l8.RollbackRequest, Schemas["RollbackRequest"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l8.RollbackResult, Schemas["RollbackResult"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l8.RetireRequest, Schemas["RetireRequest"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l8.Retirement, Schemas["RetirementView"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l8.VersionDocument, Schemas["VersionDocument"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l8.AgentSaved, Schemas["AgentSaved"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l8.AgentLifecycleDetail, Schemas["AgentDetail"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.Reached, Schemas["ReachedRun"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.PeerInfo, Schemas["PeerInfo"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.AgentDrift, Schemas["AgentDrift"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.BenchmarkDrift, Schemas["BenchmarkDrift"]>>().toEqualTypeOf<true>();
    expectTypeOf<Agrees<l7.GuardianAction, Schemas["GuardianAction"]>>().toEqualTypeOf<true>();
    // The names the console narrows to, and the backend's own enumerations.
    expectTypeOf<l7.GuardianAct>().toEqualTypeOf<Schemas["GuardianAction"]["action"]>();
    expectTypeOf<l8.Verdict>().toEqualTypeOf<Schemas["ReviewRequest"]["verdict"]>();
    expectTypeOf<NonNullable<l8.OverrideRequest["conditions"]>[number]>().toEqualTypeOf<NonNullable<Schemas["OverrideBody"]["conditions"]>[number]>();
    expectTypeOf<l8.EvalState>().toMatchTypeOf<Schemas["EvalRunView"]["state"]>();
    expectTypeOf<Schemas["JobView"]["taint"]>().toEqualTypeOf<string | null | undefined>();
    expectTypeOf<Schemas["JobView"]["cancel_reason"]>().toEqualTypeOf<string | null | undefined>();
    // The check bites: a field the backend does not serve is caught.
    expectTypeOf<Agrees<{ approved_by: string }, Schemas["ReviewView"]>>().toEqualTypeOf<false>();
  });

  it("every name the backend serves is one the console knows", () => {
    expect(l8.STAGE_NAMES).toEqual(["designed", "reviewed", "approved", "canary", "deployed", "retired"]);
    expect(l8.CONDITION_NAMES).toEqual(["eval", "review", "findings", "regression"]);
    expect(l8.VERDICTS).toEqual(["approved", "changes_requested"]);
    expect(l7.GUARDIAN_ACTS).toEqual(["hold", "block", "redirect"]);
    expect(l7.MEASURE_NAMES).toEqual(expect.arrayContaining(["benchmark_outcomes", "benchmark_labels"]));
    for (const name of ["lifecycle_deployed", "lifecycle_retired"]) {
      for (const s of (body(name).stages as { stage: string }[])) expect(l8.STAGE_NAMES, s.stage).toContain(s.stage);
    }
    for (const c of (body("deploy_409_nothing").conditions as { condition: string }[])) expect(l8.CONDITION_NAMES).toContain(c.condition);
  });
});
