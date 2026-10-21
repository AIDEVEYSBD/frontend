import { afterEach, describe, expect, it, vi } from "vitest";
import * as l5 from "@/lib/api/l5";
import { allowedVerdicts, chainOf, declaresNote, HOLDS_LABEL, orderAttention, refusalErrors, URGENT_SEVERITY, validateForm, validateVerdicts } from "@/lib/gates";
import { PUBLIC_ORIGIN } from "@/lib/site";

/**
 * The L5 contract, held from the console's side.
 *
 * lib/api/l5.ts was written against backend/CONTRACT.md before the backend
 * served the doors, and the backend that landed named and nested several
 * things differently: the escalation count, verdict items under `item`,
 * the evidence trail, the attention action and `holds`, the steer receipt,
 * the fleet result, the external door's flat body. Nothing failed; panels
 * went blank. Every response below was captured from the backend's own app
 * (backend/app, driven through its test fixtures: suspended decision, form
 * and verdicts gates, an escalation by the scheduler's tick, a held write,
 * a minted and spent link, the attention list, in-process and worker
 * steers, fleet actions and the lockdown, ledger rows in flight) and is
 * inlined here trimmed, with fields the console does not read left out.
 * Each test stubs fetch with them and calls the real client, so a renamed
 * or re-nested field fails here instead of in front of a reviewer. When a
 * door changes, capture its response again (the backend's
 * tests/test_l5_gates.py and tests/test_l5_operations.py build each state)
 * and replace the fixture.
 */

interface Fixture {
  status: number;
  body: unknown;
}

const FX: Record<string, Fixture> = {
  "approvals_list": {
    "status": 200,
    "body": {
      "pending": [
        {
          "run": "gated-2026-10-21T06-42-43-5m6k", "agent": "gated", "node": "review", "kind": "approval", "asks": "Analyst review", "approvers": ["dlp-lead"],
          "timeout_s": 86400.0, "on_timeout": "escalate", "waiting_since": "2026-10-21T06:42:43.315Z", "shape": "decision", "fields": [], "items": [],
          "verdicts": [], "transitions": {}, "chain": [], "escalations": 0, "deadline": "2026-10-22T06:42:43Z", "external": false,
          "decided": {"verdict": "benign"},
          "evidence": {
            "decided": {"verdict": "benign"}, "presented": {"verdict": "benign"}, "tainted_by": [],
            "trail": [
              {
                "id": "c4f68925e6bb", "t": 0, "kind": "node.enter", "node": "decide", "title": "Decide", "detail": "sequence · 1 steps", "tool": "",
                "summary": "sequence · 1 steps", "tainted": false
              },
              {
                "id": "53931b2d402d", "t": 0, "kind": "model.call", "node": "decide", "title": "scripted", "detail": "benign", "tool": "",
                "summary": "scripted answered \"benign\"", "tainted": false
              },
              {
                "id": "043801dc9510", "t": 0, "kind": "suspend", "node": "review", "title": "Analyst review", "detail": "awaiting approval from dlp-lead",
                "tool": "", "summary": "awaiting approval from dlp-lead", "tainted": false
              }
            ]
          },
          "next": {
            "approve": "the decision is emitted by review and the run ends done with it as the result",
            "refuse": "the run ends failed: refused by the signer, with the note on the journal"
          },
          "source": "console", "job": null, "warning": ""
        },
        {
          "run": "formed-2026-10-21T06-42-43-alog", "agent": "formed", "node": "review", "kind": "approval", "asks": "Risk review", "approvers": ["risk-lead"],
          "timeout_s": 3600.0, "on_timeout": "escalate", "waiting_since": "2026-10-21T06:42:43.433Z", "shape": "form",
          "fields": [{"name": "residual_risk", "kind": "choice", "required": true, "choices": ["low", "medium", "high"]}, {"name": "note", "kind": "string"}],
          "items": [], "verdicts": [], "transitions": {}, "chain": ["vp-risk", "cro"], "escalations": 0, "deadline": "2026-10-21T07:42:43Z", "external": true,
          "decided": {"verdict": "benign"},
          "evidence": {
            "decided": {"verdict": "benign"}, "presented": {"verdict": "benign"}, "tainted_by": [],
            "trail": [
              {
                "id": "b60f4e4b46ab", "t": 0, "kind": "node.enter", "node": "decide", "title": "Decide", "detail": "sequence · 1 steps", "tool": "",
                "summary": "sequence · 1 steps", "tainted": false
              },
              {
                "id": "233b5ffcac8e", "t": 0, "kind": "model.call", "node": "decide", "title": "scripted", "detail": "benign", "tool": "",
                "summary": "scripted answered \"benign\"", "tainted": false
              },
              {
                "id": "590d8bce8c66", "t": 0, "kind": "suspend", "node": "review", "title": "Risk review", "detail": "awaiting approval from risk-lead",
                "tool": "", "summary": "awaiting approval from risk-lead", "tainted": false
              }
            ]
          },
          "next": {
            "approve": "the decision is emitted by review and the run ends done with it as the result",
            "refuse": "the run ends failed: refused by the signer, with the note on the journal"
          },
          "source": "console", "job": null, "warning": ""
        },
        {
          "run": "verdicted-2026-10-21T06-42-43-opmx", "agent": "verdicted", "node": "triage", "kind": "approval", "asks": "Gap triage",
          "approvers": ["tprm-lead"], "timeout_s": 86400.0, "on_timeout": "escalate", "waiting_since": "2026-10-21T06:42:43.555Z", "shape": "verdicts",
          "fields": [],
          "items": [
            {"id": "g1", "index": 0, "verdict": null, "item": {"id": "g1", "title": "No MFA on the admin portal"}},
            {"id": "g2", "index": 1, "verdict": "accepted", "item": {"id": "g2", "title": "TLS 1.0 still offered", "verdict": "accepted"}}
          ],
          "verdicts": ["acknowledged", "accepted", "disputed"], "transitions": {"accepted": ["disputed"]}, "chain": [], "escalations": 0,
          "deadline": "2026-10-22T06:42:43Z", "external": false, "decided": {},
          "evidence": {
            "decided": {},
            "presented": {"gaps": [{"id": "g1", "title": "No MFA on the admin portal"}, {"id": "g2", "title": "TLS 1.0 still offered", "verdict": "accepted"}]},
            "tainted_by": [],
            "trail": [
              {
                "id": "45ec407c4ff7", "t": 0, "kind": "suspend", "node": "triage", "title": "Gap triage", "detail": "awaiting approval from tprm-lead",
                "tool": "", "summary": "awaiting approval from tprm-lead", "tainted": false
              }
            ]
          },
          "next": {
            "approve": "the decision is emitted by triage and the run ends done with it as the result",
            "refuse": "the run ends failed: refused by the signer, with the note on the journal"
          },
          "source": "console", "job": null, "warning": ""
        },
        {
          "run": "formed-2026-10-21T06-42-43-2nm3", "agent": "formed", "node": "review", "kind": "approval", "asks": "Risk review", "approvers": ["vp-risk"],
          "timeout_s": 3600.0, "on_timeout": "escalate", "waiting_since": "2026-10-21T06:42:43.612Z", "shape": "form",
          "fields": [{"name": "residual_risk", "kind": "choice", "required": true, "choices": ["low", "medium", "high"]}, {"name": "note", "kind": "string"}],
          "items": [], "verdicts": [], "transitions": {}, "chain": ["vp-risk", "cro"], "escalations": 1, "deadline": "2026-10-21T07:42:43Z", "external": true,
          "decided": {"verdict": "benign"},
          "evidence": {
            "decided": {"verdict": "benign"}, "presented": {"verdict": "benign"}, "tainted_by": [],
            "trail": [
              {
                "id": "d1ec48c4b511", "t": 0, "kind": "suspend", "node": "review", "title": "Risk review", "detail": "awaiting approval from risk-lead",
                "tool": "", "summary": "awaiting approval from risk-lead", "tainted": false
              }
            ]
          },
          "next": {
            "approve": "the decision is emitted by review and the run ends done with it as the result",
            "refuse": "the run ends failed: refused by the signer, with the note on the journal"
          },
          "source": "console", "job": null, "warning": ""
        }
      ],
      "count": 4, "closed": []
    }
  },
  "approvals_list_held_call": {
    "status": 200,
    "body": {
      "pending": [
        {
          "run": "holdme-2026-10-21T06-42-43-3pq4", "agent": "holdme", "node": "decide", "kind": "approval",
          "asks": "records.write — held by Chandresh Singh: the next call at or above write waits for a human", "approvers": ["owner"], "timeout_s": 86400.0,
          "on_timeout": "escalate", "waiting_since": "2026-10-21T06:42:43.992Z", "shape": "decision", "fields": [], "items": [], "verdicts": [],
          "transitions": {}, "chain": [], "escalations": 0, "deadline": "2026-10-22T06:42:43Z", "external": false, "decided": {},
          "evidence": {
            "decided": {}, "presented": {}, "tainted_by": [],
            "trail": [
              {
                "id": "af2084180f73", "t": 2, "kind": "model.call", "node": "decide", "title": "scripted", "detail": "one", "tool": "",
                "summary": "scripted answered \"one\"", "tainted": false
              },
              {
                "id": "6733821fdeb7", "t": 2, "kind": "gate.open", "node": "decide", "title": "Awaiting a human decision on records.write",
                "detail": "held by Chandresh Singh: the next call at or above write waits for a human", "tool": "records.write",
                "summary": "held by Chandresh Singh: the next call at or above write waits for a human", "tainted": false
              }
            ]
          },
          "next": {"approve": "records.write is called in decide and the node continues", "refuse": "records.write is refused and the run ends failed"},
          "source": "console", "job": null, "warning": ""
        }
      ],
      "count": 1, "closed": []
    }
  },
  "run_suspended_escalated": {
    "status": 200,
    "body": {
      "suspension": {
        "kind": "approval", "node": "review", "approvers": ["vp-risk"], "prompt": "Risk review", "timeout_s": 3600.0, "on_timeout": "escalate",
        "resume": {"inputs": {"verdict": "benign"}}, "shape": "form",
        "fields": [{"name": "residual_risk", "kind": "choice", "required": true, "choices": ["low", "medium", "high"]}, {"name": "note", "kind": "string"}],
        "items": [], "verdicts": [], "transitions": {}, "chain": ["vp-risk", "cro"], "escalations": 1, "deadline": "2026-10-21T07:42:43Z", "external": true
      }
    }
  },
  "approvals_answer_ok": {
    "status": 200,
    "body": {
      "run": "verdicted-2026-10-21T06-42-43-opmx", "ok": true, "state": "running", "error": "", "result": null, "continuing": true,
      "delivered": "the run resumed in-process; its state settles as it runs"
    }
  },
  "approvals_answer_400_form": {"status": 400, "body": {"error": "residual_risk: 'extreme' is not one of ['low', 'medium', 'high']", "field": "residual_risk"}},
  "approvals_answer_400_verdicts": {"status": 400, "body": {"error": "verdicts.g2: 'accepted' may only move to ['disputed'], not 'acknowledged'", "field": "verdicts.g2"}},
  "approvals_answer_400_decision": {"status": 400, "body": {"error": "approved: is required — a gate is not answered by silence", "field": "approved"}},
  "approvals_answer_403_role": {
    "status": 403,
    "body": {"error": "answering this gate needs the \"risk-lead\" role; your roles: operator", "missing_role": "risk-lead", "approvers": ["risk-lead"]}
  },
  "approvals_answer_403_key": {
    "status": 403,
    "body": {
      "error": "an API key scoped to \"formed\" cannot answer that agent's gates: a person answers them in the console or through a signed link",
      "control": "self_approval"
    }
  },
  "approvals_batch": {
    "status": 200,
    "body": {
      "answered": 2, "of": 3, "remaining": 0, "approved": true, "by": "Chandresh Singh",
      "results": [
        {
          "run": "gated-2026-10-21T06-42-43-5m6k", "ok": true, "state": "running", "error": "", "result": null, "continuing": true,
          "delivered": "the run resumed in-process; its state settles as it runs"
        },
        {
          "run": "gated-2026-10-21T06-42-43-vl7h", "ok": true, "state": "running", "error": "", "result": null, "continuing": true,
          "delivered": "the run resumed in-process; its state settles as it runs"
        },
        {
          "run": "formed-2026-10-21T06-42-43-2nm3", "ok": false, "state": "suspended", "error": "residual_risk: is required", "result": null,
          "continuing": false, "delivered": ""
        }
      ]
    }
  },
  "approvals_batch_400": {"status": 400, "body": {"error": "send approved: true or approved: false — a gate is not answered by silence"}},
  "link_minted": {
    "status": 201,
    "body": {
      "url": "/answer/f92bc7463cf2406c.1792568563.hnSnvT0vel8iktKFCNV1zBJ2XugCf2jKFdzRXjAEaWY",
      "path": "/api/answer/f92bc7463cf2406c.1792568563.hnSnvT0vel8iktKFCNV1zBJ2XugCf2jKFdzRXjAEaWY",
      "token": "f92bc7463cf2406c.1792568563.hnSnvT0vel8iktKFCNV1zBJ2XugCf2jKFdzRXjAEaWY", "run": "formed-2026-10-21T06-42-43-alog",
      "gate": "review#590d8bce8c66", "email": "counsel@vendor.com", "expires_at": "2026-10-21T07:42:43Z", "deadline": "2026-10-21T07:42:43Z",
      "by": "Chandresh Singh"
    }
  },
  "link_409": {"status": 409, "body": {"error": "the gate at triage does not allow an external answer (interface.external.allowed is not set)"}},
  "link_403_role": {
    "status": 403,
    "body": {"error": "answering this gate needs the \"risk-lead\" role; your roles: operator", "missing_role": "risk-lead", "approvers": ["risk-lead"]}
  },
  "answer_post_ok": {
    "status": 200,
    "body": {
      "run": "formed-2026-10-21T06-42-43-alog", "ok": true, "state": "running", "by": "external:counsel@vendor.com",
      "delivered": "the run resumed; its state settles as it runs"
    }
  },
  "answer_post_400": {"status": 400, "body": {"error": "residual_risk: 'extreme' is not one of ['low', 'medium', 'high']", "field": "residual_risk"}},
  "answer_get_410": {"status": 410, "body": {"error": "this link was used on 2026-10-21T06:42:43Z; ask the approver for another"}},
  "answer_post_410": {"status": 410, "body": {"error": "this link was used on 2026-10-21T06:42:43Z; ask the approver for another"}},
  "answer_get_404": {"status": 404, "body": {"error": "no such link"}},
  "steer_in_process": {
    "status": 202,
    "body": {
      "run": "twostep-2026-10-21T06-42-43-iels", "state": "running",
      "steer": {
        "guidance": "Prefer the conservative reading", "hold_at_next_gate": null, "model": "gpt-4o-mini", "by": "Chandresh Singh",
        "at": "2026-10-21T06:42:43.952Z"
      },
      "delivery": "in-process"
    }
  },
  "steer_hold": {
    "status": 202,
    "body": {
      "run": "holdme-2026-10-21T06-42-43-3pq4", "state": "running",
      "steer": {"guidance": null, "hold_at_next_gate": true, "model": null, "by": "Chandresh Singh", "at": "2026-10-21T06:42:43.990Z"}, "delivery": "in-process"
    }
  },
  "steer_worker_merged": {
    "status": 202,
    "body": {
      "run": "tiny-2026-10-21T06-42-44-e6c4ec", "state": "running",
      "steer": {
        "guidance": "Check the sender's domain and the amount", "hold_at_next_gate": true, "model": "gpt-4o-mini", "by": "Chandresh Singh",
        "at": "2026-10-21T06:42:44.105Z"
      },
      "delivery": "worker"
    }
  },
  "steer_409": {"status": 409, "body": {"error": "run \"twostep-2026-10-21T06-42-43-iels\" is done, not in flight"}},
  "steer_400": {"status": 400, "body": {"error": "a steer sets at least one lever: guidance, hold_at_next_gate or model"}},
  "fleet_pause": {
    "status": 200,
    "body": {
      "action": "pause", "agents": ["tiny"], "reason": "connector incident INC-42", "by": "Chandresh Singh", "at": "2026-10-21T06:42:44.141Z", "killed": [],
      "paused": {"tiny": {"mode": "pause", "reason": "connector incident INC-42", "by": "Chandresh Singh", "at": "2026-10-21T06:42:44.141Z"}}
    }
  },
  "fleet_kill": {
    "status": 200,
    "body": {
      "action": "kill", "agents": ["twostep"], "reason": "runaway", "by": "Chandresh Singh", "at": "2026-10-21T06:42:44.151Z",
      "killed": ["twostep-2026-10-21T06-42-44-06v4"],
      "paused": {
        "tiny": {"mode": "pause", "reason": "connector incident INC-42", "by": "Chandresh Singh", "at": "2026-10-21T06:42:44.141Z"},
        "other": {"mode": "drain", "reason": "rolling the connector", "by": "Chandresh Singh", "at": "2026-10-21T06:42:44.142Z"}
      }
    }
  },
  "fleet_resume": {
    "status": 200,
    "body": {
      "action": "resume", "agents": ["other", "tiny"], "reason": "incident closed", "by": "Chandresh Singh", "at": "2026-10-21T06:42:44.178Z", "killed": [],
      "paused": {}
    }
  },
  "fleet_get": {
    "status": 200,
    "body": {
      "paused": {
        "tiny": {"mode": "pause", "reason": "connector incident INC-42", "by": "Chandresh Singh", "at": "2026-10-21T06:42:44.141Z"},
        "other": {"mode": "drain", "reason": "rolling the connector", "by": "Chandresh Singh", "at": "2026-10-21T06:42:44.142Z"}
      },
      "lockdown": {
        "on": true, "reason": "credential leak under investigation", "by": "Chandresh Singh", "at": "2026-10-21T06:42:44.148Z",
        "controls": [
          "gates: every tool call above read in a new or resumed run waits for a human (control lockdown)",
          "sinks: every call to a sink is held the same way, whatever its risk",
          "workers: every claim is served lockdown: true, so a worker starts its run locked down",
          "doors: the runs, trigger and webhook doors still accept work; it runs gated"
        ]
      },
      "live": {"twostep": 1}
    }
  },
  "fleet_get_empty": {"status": 200, "body": {"paused": {}, "lockdown": {"on": false, "reason": "", "by": "", "at": "", "controls": []}, "live": {}}},
  "fleet_404": {"status": 404, "body": {"error": "not in the registry: ghost"}},
  "lockdown_get_off": {"status": 200, "body": {"on": false, "reason": "", "by": "", "at": "", "controls": []}},
  "lockdown_post_on": {
    "status": 200,
    "body": {
      "on": true, "reason": "credential leak under investigation", "by": "Chandresh Singh", "at": "2026-10-21T06:42:44.148Z",
      "controls": [
        "gates: every tool call above read in a new or resumed run waits for a human (control lockdown)",
        "sinks: every call to a sink is held the same way, whatever its risk",
        "workers: every claim is served lockdown: true, so a worker starts its run locked down",
        "doors: the runs, trigger and webhook doors still accept work; it runs gated"
      ]
    }
  },
  "lockdown_400": {"status": 400, "body": {"error": "a lockdown needs a reason"}},
  "lockdown_post_off": {"status": 200, "body": {"on": false, "reason": "contained", "by": "Chandresh Singh", "at": "2026-10-21T06:42:44.179Z", "controls": []}},
  "answer_get": {
    "status": 200,
    "body": {
      "run": "formed-2026-10-21T06-42-43-alog", "agent": "formed", "node": "review", "asks": "Risk review", "shape": "form",
      "fields": [{"name": "residual_risk", "kind": "choice", "required": true, "choices": ["low", "medium", "high"]}, {"name": "note", "kind": "string"}],
      "items": [], "verdicts": [], "transitions": {}, "deadline": "2026-10-21T07:42:43Z", "expires_at": "2026-10-21T07:42:43Z", "email": "counsel@vendor.com",
      "decided": {"verdict": "benign"},
      "evidence": {
        "decided": {"verdict": "benign"}, "presented": {"verdict": "benign"}, "tainted_by": [],
        "trail": [
          {
            "id": "b60f4e4b46ab", "t": 0, "kind": "node.enter", "node": "decide", "title": "Decide", "detail": "sequence · 1 steps", "tool": "",
            "summary": "sequence · 1 steps", "tainted": false
          },
          {
            "id": "233b5ffcac8e", "t": 0, "kind": "model.call", "node": "decide", "title": "scripted", "detail": "benign", "tool": "",
            "summary": "scripted answered \"benign\"", "tainted": false
          },
          {
            "id": "590d8bce8c66", "t": 0, "kind": "suspend", "node": "review", "title": "Risk review", "detail": "awaiting approval from risk-lead", "tool": "",
            "summary": "awaiting approval from risk-lead", "tainted": false
          }
        ]
      },
      "next": {
        "approve": "the decision is emitted by review and the run ends done with it as the result",
        "refuse": "the run ends failed: refused by the signer, with the note on the journal"
      }
    }
  },
  "attention": {
    "status": 200,
    "body": {
      "items": [
        {
          "id": "refusal:refused-1", "kind": "refusal", "severity": 6, "age_s": 86400.9, "rank": 12.0, "title": "tiny: a refusal stopped run refused-1",
          "detail": "egress: denied: egress to evil.example is off the allowlist", "agent": "tiny", "run": "refused-1", "job": "",
          "since": "2026-10-20T06:42:43Z", "deadline": null, "holds": "",
          "action": {
            "method": "POST", "path": "/api/runs", "body": {"agent": "tiny", "input": {}},
            "says": "review the refusal on the journal (GET /api/runs/{id}); start the run again once the policy or the input is right"
          }
        },
        {
          "id": "gate:formed-2026-10-21T06-42-43-lq56", "kind": "gate", "severity": 9, "age_s": 0.1, "rank": 9.0,
          "title": "formed: Risk review waits on risk-lead", "detail": "due in 29 min, waiting since 2026-10-21T06:42:43.846Z", "agent": "formed",
          "run": "formed-2026-10-21T06-42-43-lq56", "job": "", "since": "2026-10-21T06:42:43.846Z", "deadline": "2026-10-21T07:12:43Z", "holds": "",
          "action": {
            "method": "POST", "path": "/api/approvals/formed-2026-10-21T06-42-43-lq56", "body": {"answer": {"residual_risk": "<choice>", "note": "<string>"}},
            "says": "answer the gate: a form: residual_risk (choice, required), note (string)"
          }
        },
        {
          "id": "budget", "kind": "budget", "severity": 8, "age_s": 0.0, "rank": 8.0, "title": "the day budget is spent: $0.00 of $0.00",
          "detail": "runs do not start and triggers answer 402 until the rolling period falls under the budget or it is raised", "agent": "", "run": "",
          "job": "", "since": "2026-10-20T06:42:43.940Z", "deadline": null, "holds": "",
          "action": {"method": "", "path": "/finops", "body": null, "says": "raise the budget or widen its period on the FinOps page (settings key finops)"}
        },
        {
          "id": "gate:sinky-2026-10-21T06-42-43-jv9x", "kind": "gate", "severity": 8, "age_s": 0.1, "rank": 8.0,
          "title": "sinky: Analyst review waits on dlp-lead", "detail": "due in 24.0 h, holds a sink, waiting since 2026-10-21T06:42:43.849Z", "agent": "sinky",
          "run": "sinky-2026-10-21T06-42-43-jv9x", "job": "", "since": "2026-10-21T06:42:43.849Z", "deadline": "2026-10-22T06:42:43Z", "holds": "sink",
          "action": {
            "method": "POST", "path": "/api/approvals/sinky-2026-10-21T06-42-43-jv9x", "body": {"approved": true, "note": "..."},
            "says": "answer the gate: approved: true or false, with a note"
          }
        },
        {
          "id": "health:telemetry", "kind": "health", "severity": 8, "age_s": 0.0, "rank": 8.0, "title": "the telemetry port is failing",
          "detail": "collector unreachable", "agent": "", "run": "", "job": "", "since": "", "deadline": null, "holds": "",
          "action": {
            "method": "GET", "path": "/api/healthz", "body": null,
            "says": "fix the telemetry port's configuration (PORT_TELEMETRY and what it needs) and check its health read"
          }
        },
        {
          "id": "dead_letter:3caa19d8-8776-4747-aaa7-543e1a4021f0", "kind": "dead_letter", "severity": 2, "age_s": 172800.0, "rank": 6.0,
          "title": "tiny: job 3caa19d8 failed for good after 3 attempts", "detail": "connector unreachable", "agent": "tiny", "run": "",
          "job": "3caa19d8-8776-4747-aaa7-543e1a4021f0", "since": "2026-10-19T06:42:43Z", "deadline": null, "holds": "",
          "action": {
            "method": "POST", "path": "/api/queue/jobs/3caa19d8-8776-4747-aaa7-543e1a4021f0/replay", "body": null,
            "says": "replay the job as a fresh attempt once the fault is mended"
          }
        }
      ],
      "count": 6
    }
  },
  "steer_journal_in_process": {
    "status": 200,
    "body": [
      {
        "t": 3, "kind": "note", "node": "decide", "title": "Operator guidance", "detail": "Prefer the conservative reading",
        "data": {"control": "operator.guidance", "by": "Chandresh Singh", "text": "Prefer the conservative reading"}, "id": "b4e44ce73349", "tainted": false
      },
      {
        "t": 3, "kind": "note", "node": "decide", "title": "Model set to gpt-4o-mini by the operator",
        "detail": "Chandresh Singh sent this call to gpt-4o-mini instead of scripted",
        "data": {"control": "operator.model", "by": "Chandresh Singh", "model": "gpt-4o-mini", "instead_of": "scripted"}, "id": "240ef9d0f3ed", "tainted": false
      }
    ]
  },
  "steer_hold_journal": {
    "status": 200,
    "body": [
      {
        "t": 2, "kind": "note", "node": "decide", "title": "Held at the operator's request",
        "detail": "records.write is write; Chandresh Singh asked that the next such call wait for a human",
        "data": {"control": "operator.hold", "by": "Chandresh Singh", "tool": "records.write"}, "id": "040cbed2578e", "tainted": false
      },
      {
        "t": 2, "kind": "gate.open", "node": "decide", "title": "Awaiting a human decision on records.write",
        "detail": "held by Chandresh Singh: the next call at or above write waits for a human",
        "data": {"tool": "records.write", "args": {"type": "finding", "fields": {"title": "x"}}, "control": "operator.hold", "approvers": ["owner"]},
        "id": "6733821fdeb7", "tainted": false
      }
    ]
  },
  "steer_journal_worker": {
    "status": 200,
    "body": [
      {
        "t": 0, "kind": "note", "node": "", "title": "Steered by Chandresh Singh",
        "detail": "guidance for the next prompt: Check the sender's domain first; hold at the next call at or above write",
        "data": {
          "control": "operator.steer", "by": "Chandresh Singh", "at": "2026-10-21T06:42:44.103Z", "guidance": "Check the sender's domain first",
          "hold_at_next_gate": true, "delivery": "worker"
        },
        "id": "97641bb4ec55", "tainted": false
      }
    ]
  },
  "runs_rows": {
    "status": 200,
    "body": {
      "runs": [
        {
          "id": "newcomer", "system": "fresh", "agent": "fresh", "state": "running", "at": "2026-10-21T06:42:44.183Z", "started": "2026-10-21T05:42:44Z",
          "finished": null, "live": false, "suspendedAt": "", "step": "triage", "step_ms": 3600188, "step_p95_ms": null, "stuck": false, "waiting_on": "model"
        },
        {
          "id": "tooling", "system": "tiny", "agent": "tiny", "state": "running", "at": "2026-10-21T06:42:44.183Z", "started": "2026-10-21T06:42:14Z",
          "finished": null, "live": false, "suspendedAt": "", "step": "decide", "step_ms": 30188, "step_p95_ms": 5000, "stuck": true, "waiting_on": "web.fetch"
        },
        {
          "id": "past-0", "system": "tiny", "agent": "tiny", "state": "done", "at": "2026-10-21T06:42:44.182Z", "started": "2026-10-21T06:42:44Z",
          "finished": "2026-10-21T06:42:44Z", "live": false, "suspendedAt": "", "step": "", "step_ms": 0, "step_p95_ms": null, "stuck": false, "waiting_on": ""
        },
        {
          "id": "slow-1", "system": "tiny", "agent": "tiny", "state": "running", "at": "2026-10-21T06:42:44.182Z", "started": "2026-10-21T06:32:44Z",
          "finished": null, "live": false, "suspendedAt": "", "step": "decide", "step_ms": 600188, "step_p95_ms": 5000, "stuck": true, "waiting_on": "model"
        }
      ],
      "count": 4
    }
  }
};

function fx(name: string): Fixture {
  const f = FX[name];
  if (!f) throw new Error(`no fixture ${name}`);
  return f;
}

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
      return new Response(JSON.stringify(f.body), { status: f.status, headers: { "content-type": "application/json" } });
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

afterEach(() => vi.unstubAllGlobals());

async function inbox() {
  serve("approvals_list");
  const box = await l5.listGates();
  const by = (pred: (g: l5.Gate) => boolean) => box.pending.find(pred)!;
  return {
    box,
    decision: by((g) => g.agent === "gated"),
    form: by((g) => g.agent === "formed" && g.escalations === 0),
    escalated: by((g) => g.agent === "formed" && g.escalations === 1),
    verdicts: by((g) => g.shape === "verdicts"),
  };
}

describe("GET /api/approvals", () => {
  it("a decision gate: approvers, deadline, the evidence trail and what each answer does next", async () => {
    const { box, decision: g } = await inbox();
    expect(box.count).toBe(box.pending.length);
    expect(g).toMatchObject({ shape: "decision", approvers: ["dlp-lead"], chain: [], escalations: 0, external: { allowed: false }, timeout_s: 86400, on_timeout: "escalate", asks: "Analyst review", source: "console", job: null, decided: { verdict: "benign" } });
    expect(g.deadline).toBe("2026-10-22T06:42:43Z");
    expect(g.evidence.decided).toEqual({ verdict: "benign" });
    expect(g.evidence.presented).toEqual({ verdict: "benign" });
    expect(g.evidence.trail.map((e) => e.kind)).toEqual(["node.enter", "model.call", "suspend"]);
    expect(g.evidence.trail[1]).toMatchObject({ node: "decide", summary: 'scripted answered "benign"', tainted: false });
    expect(g.next.approve).toBe("the decision is emitted by review and the run ends done with it as the result");
    expect(g.next.refuse).toBe("the run ends failed: refused by the signer, with the note on the journal");
  });

  it("a form gate: typed fields with options, the chain ahead, an external link allowed", async () => {
    const { form: g } = await inbox();
    expect(g.fields).toEqual([
      { name: "residual_risk", kind: "choice", required: true, choices: ["low", "medium", "high"], label: undefined, hint: undefined },
      { name: "note", kind: "string", required: false, choices: undefined, label: undefined, hint: undefined },
    ]);
    expect(g.external.allowed).toBe(true);
    expect(g.deadline).toBe("2026-10-21T07:42:43Z");
    expect(chainOf(g)).toEqual({ passedFirst: false, passed: [], current: ["risk-lead"], ahead: ["vp-risk", "cro"] });
    // The form names its own note: the dialog's separate note box would overwrite it.
    expect(declaresNote(g)).toBe(true);
    expect(validateForm(g.fields, { residual_risk: "medium", note: "" })).toEqual({ ok: true, errors: {}, answer: { residual_risk: "medium" } });
  });

  it("an escalated gate: a count of steps, the approvers replaced, the chain not trimmed", async () => {
    const { escalated: g } = await inbox();
    expect(g).toMatchObject({ approvers: ["vp-risk"], chain: ["vp-risk", "cro"], escalations: 1 });
    expect(chainOf(g)).toEqual({ passedFirst: true, passed: [], current: ["vp-risk"], ahead: ["cro"] });
  });

  it("a verdicts gate: items from the register entry under `item`, with ids, verdicts and the moves allowed", async () => {
    const { verdicts: g } = await inbox();
    expect(g.items).toEqual([
      { id: "g1", title: "No MFA on the admin portal", verdict: null, fields: { title: "No MFA on the admin portal" } },
      { id: "g2", title: "TLS 1.0 still offered", verdict: "accepted", fields: { title: "TLS 1.0 still offered" } },
    ]);
    expect(g.verdicts).toEqual(["acknowledged", "accepted", "disputed"]);
    expect(g.transitions).toEqual({ accepted: ["disputed"] });
    expect(allowedVerdicts(g.items[0].verdict, g.verdicts, g.transitions)).toEqual(["acknowledged", "accepted", "disputed"]);
    expect(allowedVerdicts(g.items[1].verdict, g.verdicts, g.transitions)).toEqual(["accepted", "disputed"]);
    // What the backend accepted for this gate, and what it refused (approvals_answer_400_verdicts).
    expect(validateVerdicts(g.items, g.verdicts, g.transitions, { g1: "acknowledged", g2: "disputed" }).answer).toEqual({ verdicts: { g1: "acknowledged", g2: "disputed" } });
    expect(validateVerdicts(g.items, g.verdicts, g.transitions, { g1: "acknowledged", g2: "acknowledged" }).ok).toBe(false);
  });

  it("a register entry that is a bare value is titled by it (the runtime's `_item`)", () => {
    expect(l5.itemOf({ id: "0", index: 0, verdict: null, item: "TLS 1.0 still offered" }, 0)).toEqual({ id: "0", title: "TLS 1.0 still offered", verdict: null, fields: {} });
  });

  it("a gate an operator's hold opened on a write: what approving does to the call", async () => {
    serve("approvals_list_held_call");
    const g = (await l5.listGates()).pending[0];
    expect(g).toMatchObject({ shape: "decision", approvers: ["owner"], node: "decide" });
    expect(g.asks).toContain("records.write");
    expect(g.next).toEqual({ approve: "records.write is called in decide and the node continues", refuse: "records.write is refused and the run ends failed" });
    expect(g.evidence.trail.at(-1)).toMatchObject({ kind: "gate.open", tool: "records.write" });
  });

  it("a run's suspension makes the same gate when the inbox has not caught up", () => {
    const s = fx("run_suspended_escalated").body as { suspension: Record<string, unknown> };
    const g = l5.gateFromSuspension("r-1", "formed", s.suspension);
    expect(g).toMatchObject({ run: "r-1", shape: "form", approvers: ["vp-risk"], chain: ["vp-risk", "cro"], escalations: 1, external: { allowed: true }, asks: "Risk review", deadline: "2026-10-21T07:42:43Z" });
    expect(g.fields.map((f) => f.name)).toEqual(["residual_risk", "note"]);
  });
});

describe("POST /api/approvals/{run} and the batch", () => {
  it("one gate: the answer and note go as the door reads them, the result comes back", async () => {
    const calls = serve("approvals_answer_ok");
    const r = await l5.answerGate("verdicted-1", { verdicts: { g1: "acknowledged", g2: "disputed" } }, "triaged");
    expect(calls[0]).toEqual({ url: "/api/approvals/verdicted-1", method: "POST", body: { answer: { verdicts: { g1: "acknowledged", g2: "disputed" } }, note: "triaged" } });
    expect(r).toEqual({ run: "verdicted-2026-10-21T06-42-43-opmx", ok: true, state: "running", continuing: true, delivered: "the run resumed in-process; its state settles as it runs", error: "" });
  });

  it("a decision carries approved at the top level too", async () => {
    const calls = serve("approvals_answer_ok");
    await l5.answerGate("gated-1", { approved: false }, "no");
    expect(calls[0].body).toEqual({ answer: { approved: false }, note: "no", approved: false });
  });

  it("a 400 names the field, and the dialog marks it where it was typed", async () => {
    const { form, verdicts, decision } = await inbox();
    serve("approvals_answer_400_form");
    let e = await refused(l5.answerGate("r", { residual_risk: "extreme" }, ""));
    expect([e.status, e.field, e.message]).toEqual([400, "residual_risk", "residual_risk: 'extreme' is not one of ['low', 'medium', 'high']"]);
    expect(refusalErrors(form, e.field, e.message)).toEqual({ residual_risk: "'extreme' is not one of ['low', 'medium', 'high']" });
    serve("approvals_answer_400_verdicts");
    e = await refused(l5.answerGate("r", { verdicts: { g1: "acknowledged", g2: "acknowledged" } }, ""));
    expect(e.field).toBe("verdicts.g2");
    expect(refusalErrors(verdicts, e.field, e.message)).toEqual({ g2: "'accepted' may only move to ['disputed'], not 'acknowledged'" });
    serve("approvals_answer_400_decision");
    e = await refused(l5.answerGate("r", { approved: true }, ""));
    expect(refusalErrors(decision, e.field, e.message)).toEqual({ decision: "is required — a gate is not answered by silence" });
  });

  it("a 403 names the missing role, or the control that refused a machine", async () => {
    serve("approvals_answer_403_role", "approvals_answer_403_key");
    let e = await refused(l5.answerGate("r", { residual_risk: "low" }, ""));
    expect([e.status, e.missingRole, e.approvers, e.message]).toEqual([403, "risk-lead", ["risk-lead"], 'answering this gate needs the "risk-lead" role; your roles: operator']);
    e = await refused(l5.answerGate("r", { residual_risk: "low" }, ""));
    expect([e.status, e.control]).toEqual([403, "self_approval"]);
  });

  it("a decision batch goes to the batch door with approved up front; a gate it cannot answer is a row", async () => {
    const calls = serve("approvals_batch");
    const b = await l5.answerGates(["a", "b", "c"], { approved: true }, "fine", "Chandresh Singh");
    expect(calls[0]).toEqual({ url: "/api/approvals", method: "POST", body: { runs: ["a", "b", "c"], answer: { approved: true }, note: "fine", by: "Chandresh Singh", approved: true } });
    expect(b).toMatchObject({ answered: 2, of: 3, remaining: 0, by: "Chandresh Singh" });
    expect(b.results.map((r) => r.ok)).toEqual([true, true, false]);
    expect(b.results[2]).toMatchObject({ state: "suspended", error: "residual_risk: is required" });
  });

  it("a form batch is answered gate by gate on the single door, which the batch door would refuse", async () => {
    serve("approvals_batch_400");
    expect((await refused(l5.answerGates(["a"], { approved: true }, "", "me"))).message).toBe("send approved: true or approved: false — a gate is not answered by silence");
    const calls = serve("approvals_answer_ok", "approvals_answer_400_form");
    const b = await l5.answerGates(["a", "b"], { residual_risk: "low" }, "", "me");
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(["POST /api/approvals/a", "POST /api/approvals/b"]);
    expect(b).toMatchObject({ answered: 1, of: 2, remaining: 0 });
    expect(b.results[1]).toMatchObject({ run: "b", ok: false, error: "residual_risk: 'extreme' is not one of ['low', 'medium', 'high']" });
  });
});

describe("links and the external answer door", () => {
  it("a minted link is shown as an address that works from outside", async () => {
    const calls = serve("link_minted");
    const m = await l5.mintLink("r", "Counsel@Vendor.com", 604800);
    expect(calls[0].body).toEqual({ email: "Counsel@Vendor.com", expires_s: 604800 });
    // The backend had no PUBLIC_ORIGIN, so it answered the page's path; the console's public origin goes before it.
    expect(m.url).toBe(`${PUBLIC_ORIGIN}/answer/f92bc7463cf2406c.1792568563.hnSnvT0vel8iktKFCNV1zBJ2XugCf2jKFdzRXjAEaWY`);
    expect(m).toMatchObject({ email: "counsel@vendor.com", expires_at: "2026-10-21T07:42:43Z", deadline: "2026-10-21T07:42:43Z" });
    expect(m.path).toBe("/api/answer/f92bc7463cf2406c.1792568563.hnSnvT0vel8iktKFCNV1zBJ2XugCf2jKFdzRXjAEaWY");
    expect(l5.absoluteLink("https://agentfactory.example/answer/t")).toBe("https://agentfactory.example/answer/t");
  });

  it("minting is refused for a gate that allows no outsider, and for someone who could not answer it", async () => {
    serve("link_409", "link_403_role");
    expect((await refused(l5.mintLink("r", "a@b.co"))).status).toBe(409);
    expect((await refused(l5.mintLink("r", "a@b.co"))).missingRole).toBe("risk-lead");
  });

  it("the external page reads the flat gate, the address it is bound to, and the link's expiry", async () => {
    serve("answer_get");
    const x = await l5.readExternalGate("t");
    expect(x).toMatchObject({ email: "counsel@vendor.com", answered_as: "external:counsel@vendor.com", expires_at: "2026-10-21T07:42:43Z" });
    expect(x.gate).toMatchObject({ run: "formed-2026-10-21T06-42-43-alog", agent: "formed", node: "review", shape: "form", asks: "Risk review", deadline: "2026-10-21T07:42:43Z" });
    expect(x.gate.fields.map((f) => [f.name, f.kind, f.required])).toEqual([["residual_risk", "choice", true], ["note", "string", false]]);
    expect(x.gate.evidence.trail).toHaveLength(3);
    expect(x.gate.next.approve).toBe("the decision is emitted by review and the run ends done with it as the result");
  });

  it("the external answer goes as {answer, note} and the result comes back", async () => {
    const calls = serve("answer_post_ok");
    const r = await l5.submitExternalAnswer("t", { residual_risk: "medium" }, "accepted with conditions");
    expect(calls[0]).toEqual({ url: "/api/answer/t", method: "POST", body: { answer: { residual_risk: "medium" }, note: "accepted with conditions" } });
    expect(r).toMatchObject({ run: "formed-2026-10-21T06-42-43-alog", ok: true, state: "running", delivered: "the run resumed; its state settles as it runs" });
  });

  it("a spent link is a 410, an unknown one a 404, a wrong answer a 400 naming the field", async () => {
    serve("answer_get_410", "answer_get_404", "answer_post_410", "answer_post_400");
    const gone = await refused(l5.readExternalGate("t"));
    expect([gone.status, gone.message]).toEqual([410, "this link was used on 2026-10-21T06:42:43Z; ask the approver for another"]);
    expect((await refused(l5.readExternalGate("nope"))).status).toBe(404);
    expect((await refused(l5.submitExternalAnswer("t", { residual_risk: "low" }, ""))).status).toBe(410);
    expect((await refused(l5.submitExternalAnswer("t", { residual_risk: "extreme" }, ""))).field).toBe("residual_risk");
  });
});

describe("GET /api/attention", () => {
  it("each row: kind, title, severity out of 10, rank, what a gate holds, and the action the console takes", async () => {
    serve("attention");
    const rows = await l5.listAttention();
    const by = (pred: (r: l5.AttentionItem) => boolean) => rows.find(pred)!;
    expect(rows.map((r) => r.kind)).toEqual(["refusal", "gate", "budget", "gate", "health", "dead_letter"]);
    expect(rows.every((r) => r.title.length > 0)).toBe(true);

    const refusal = by((r) => r.kind === "refusal");
    expect(refusal).toMatchObject({ severity: 6, rank: 12, run: "refused-1", agent: "tiny", action: { kind: "open", method: "POST", path: "/api/runs" } });
    // Its door starts the run again: the queue opens the run for a person to read first.
    expect(refusal.action.href).toBeUndefined();

    const gate = by((r) => r.agent === "formed");
    expect(gate).toMatchObject({ kind: "gate", severity: 9, rank: 9, holds: "", deadline: "2026-10-21T07:12:43Z", action: { kind: "answer", method: "POST", body: { answer: { residual_risk: "<choice>", note: "<string>" } } } });
    expect(gate.action.path).toBe(`/api/approvals/${gate.run}`);
    const sinky = by((r) => r.agent === "sinky");
    expect([sinky.severity, sinky.holds, HOLDS_LABEL[sinky.holds]]).toEqual([8, "sink", "holds a sink"]);

    expect(by((r) => r.kind === "budget").action).toEqual({ kind: "open", method: "", path: "/finops", body: null, says: "raise the budget or widen its period on the FinOps page (settings key finops)", href: "/finops" });
    expect(by((r) => r.kind === "health")).toMatchObject({ run: null, job: null, agent: "", action: { kind: "check", method: "GET", path: "/api/healthz" } });
    const dead = by((r) => r.kind === "dead_letter");
    expect(dead).toMatchObject({ run: null, severity: 2, rank: 6, age_s: 172800, action: { kind: "replay", method: "POST", body: null } });
    expect(dead.action.path).toBe(`/api/queue/jobs/${dead.job}/replay`);

    expect(rows.filter((r) => r.severity >= URGENT_SEVERITY).map((r) => r.kind)).toEqual(["gate", "budget", "gate", "health"]);
    expect(orderAttention(rows)[0].id).toBe("refusal:refused-1");
  });

  it("the door a row names is called with its method, and a page row is never called", async () => {
    serve("attention");
    const rows = await l5.listAttention();
    const dead = rows.find((r) => r.kind === "dead_letter")!;
    const health = rows.find((r) => r.kind === "health")!;
    const calls = serve("approvals_answer_ok", "approvals_answer_ok");
    await l5.clearAttention(dead);
    await l5.clearAttention(health);
    expect(calls).toEqual([
      { url: dead.action.path, method: "POST", body: undefined },
      { url: "/api/healthz", method: "GET", body: undefined },
    ]);
    await expect(l5.clearAttention(rows.find((r) => r.kind === "budget")!)).rejects.toThrow("names no door");
  });
});

describe("POST /api/runs/{id}/steer and the operator's journal", () => {
  it("an in-process run: the backend's receipt, who and when, and where it is delivered", async () => {
    const calls = serve("steer_in_process");
    const r = await l5.steerRun("r", { guidance: "Prefer the conservative reading", model: "gpt-4o-mini" });
    expect(calls[0].body).toEqual({ guidance: "Prefer the conservative reading", model: "gpt-4o-mini" });
    expect(r).toEqual({ run: "twostep-2026-10-21T06-42-43-iels", state: "running", applied: { guidance: "Prefer the conservative reading", model: "gpt-4o-mini" }, by: "Chandresh Singh", at: "2026-10-21T06:42:43.952Z", delivery: "in-process" });
  });

  it("a hold, and a worker's run whose steers merge until its next heartbeat", async () => {
    serve("steer_hold", "steer_worker_merged");
    expect((await l5.steerRun("r", { hold_at_next_gate: true })).applied).toEqual({ hold_at_next_gate: true });
    expect(await l5.steerRun("r", { guidance: "Check the sender's domain and the amount", model: "gpt-4o-mini" })).toMatchObject({
      delivery: "worker",
      applied: { guidance: "Check the sender's domain and the amount", hold_at_next_gate: true, model: "gpt-4o-mini" },
    });
  });

  it("a run not in flight is 409, an empty steer 400", async () => {
    serve("steer_409", "steer_400");
    const e = await refused(l5.steerRun("r", { guidance: "x" }));
    expect([e.status, e.message]).toEqual([409, 'run "twostep-2026-10-21T06-42-43-iels" is done, not in flight']);
    expect((await refused(l5.steerRun("r", {}))).status).toBe(400);
  });

  it("the journal's operator notes read as operator actions; the gate a hold opened stays a gate", () => {
    type E = { kind: string; title?: string; detail?: string; data?: Record<string, unknown> };
    expect((fx("steer_journal_in_process").body as E[]).map(l5.operatorOf)).toEqual([
      { action: "Guidance for the next step", by: "Chandresh Singh", at: "", detail: "Prefer the conservative reading" },
      { action: "Model for the next call: gpt-4o-mini", by: "Chandresh Singh", at: "", detail: "Chandresh Singh sent this call to gpt-4o-mini instead of scripted" },
    ]);
    const [hold, opened] = (fx("steer_hold_journal").body as E[]).map(l5.operatorOf);
    expect(hold).toEqual({ action: "Held for a person", by: "Chandresh Singh", at: "", detail: "records.write is write; Chandresh Singh asked that the next such call wait for a human" });
    expect(opened).toBeNull();
    expect((fx("steer_journal_worker").body as E[]).map(l5.operatorOf)).toEqual([
      { action: "Steered", by: "Chandresh Singh", at: "2026-10-21T06:42:44.103Z", detail: "guidance for the next prompt: Check the sender's domain first; hold at the next call at or above write" },
    ]);
    expect(l5.operatorOf({ kind: "note", data: {} })).toBeNull();
  });
});

describe("fleet and lockdown", () => {
  it("POST /api/fleet: who, when, the runs killed, every pause standing after it", async () => {
    const calls = serve("fleet_pause", "fleet_kill", "fleet_resume", "fleet_404");
    const p = await l5.fleet("pause", ["tiny"], "connector incident INC-42");
    expect(calls[0].body).toEqual({ action: "pause", agents: ["tiny"], reason: "connector incident INC-42" });
    expect(p).toEqual({
      action: "pause",
      agents: ["tiny"],
      reason: "connector incident INC-42",
      by: "Chandresh Singh",
      at: "2026-10-21T06:42:44.141Z",
      killed: [],
      paused: { tiny: { mode: "pause", reason: "connector incident INC-42", by: "Chandresh Singh", at: "2026-10-21T06:42:44.141Z" } },
    });
    const k = await l5.fleet("kill", ["twostep"], "runaway");
    expect(k.killed).toEqual(["twostep-2026-10-21T06-42-44-06v4"]);
    expect(Object.fromEntries(Object.entries(k.paused).map(([a, x]) => [a, x.mode]))).toEqual({ tiny: "pause", other: "drain" });
    expect((await l5.fleet("resume", ["tiny", "other"], "incident closed")).paused).toEqual({});
    expect((await refused(l5.fleet("pause", ["ghost"], "x"))).message).toBe("not in the registry: ghost");
  });

  it("GET /api/fleet: pauses and drains, the lockdown, and the runs in flight here", async () => {
    serve("fleet_get", "fleet_get_empty");
    const s = await l5.getFleet();
    expect(s.paused).toEqual({
      tiny: { mode: "pause", reason: "connector incident INC-42", by: "Chandresh Singh", at: "2026-10-21T06:42:44.141Z" },
      other: { mode: "drain", reason: "rolling the connector", by: "Chandresh Singh", at: "2026-10-21T06:42:44.142Z" },
    });
    expect(s.lockdown).toMatchObject({ on: true, reason: "credential leak under investigation", by: "Chandresh Singh" });
    expect(s.lockdown.controls).toHaveLength(4);
    expect(s.live).toEqual({ twostep: 1 });
    expect(await l5.getFleet()).toEqual({ paused: {}, lockdown: { on: false, reason: "", by: "", at: null, controls: [] }, live: {} });
  });

  it("the lockdown: off, on with its controls, a reason required, lifted with why", async () => {
    const calls = serve("lockdown_get_off", "lockdown_post_on", "lockdown_400", "lockdown_post_off");
    expect(await l5.getLockdown()).toEqual({ on: false, reason: "", by: "", at: null, controls: [] });
    const on = await l5.setLockdown(true, "credential leak under investigation");
    expect(calls[1].body).toEqual({ on: true, reason: "credential leak under investigation" });
    expect(on).toMatchObject({ on: true, reason: "credential leak under investigation", by: "Chandresh Singh", at: "2026-10-21T06:42:44.148Z" });
    expect(on.controls[3]).toBe("doors: the runs, trigger and webhook doors still accept work; it runs gated");
    expect((await refused(l5.setLockdown(true, ""))).message).toBe("a lockdown needs a reason");
    expect(await l5.setLockdown(false, "contained")).toEqual({ on: false, reason: "contained", by: "Chandresh Singh", at: "2026-10-21T06:42:44.179Z", controls: [] });
  });

  it("the fleet buttons say what the backend does: a pause kills what is in flight, a kill does not pause", () => {
    expect(l5.FLEET_ACTIONS.find((a) => a.id === "pause")!.what).toContain("kills every run");
    expect(l5.FLEET_ACTIONS.find((a) => a.id === "drain")!.what).toContain("lets every run in flight finish");
    expect(l5.FLEET_ACTIONS.find((a) => a.id === "kill")!.what).toContain("does not pause");
  });
});

describe("GET /api/runs rows", () => {
  it("in flight means live here or running anywhere; step, stuck and waiting_on explain each", () => {
    const rows = (fx("runs_rows").body as { runs: l5.RunRowL5[] }).runs;
    // None of these is driven in-process (`live` false): a worker's runs read running.
    expect(rows.every((r) => r.live === false)).toBe(true);
    expect(l5.inFlight(rows).map((r) => r.id).sort()).toEqual(["newcomer", "slow-1", "tooling"]);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by["slow-1"]).toMatchObject({ step: "decide", stuck: true, waiting_on: "model", step_p95_ms: 5000 });
    expect(by["slow-1"].step_ms).toBeGreaterThan(9 * 60_000);
    expect(by["tooling"]).toMatchObject({ step: "decide", stuck: true, waiting_on: "web.fetch", step_p95_ms: 5000 });
    expect(by["newcomer"]).toMatchObject({ step: "triage", stuck: false, waiting_on: "model", step_p95_ms: null });
    expect(by["past-0"]).toMatchObject({ state: "done", step: "", stuck: false, waiting_on: "", step_p95_ms: null });
  });
});
