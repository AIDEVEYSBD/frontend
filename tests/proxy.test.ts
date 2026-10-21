import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  BACKEND_PATHS,
  BACKEND_PREFIXES,
  CONSOLE_UNDER_BACKEND,
  MACHINE_DOORS,
  OPEN_PAGES,
  OPEN_PREFIXES,
  PASSTHROUGH_DOORS,
  isBackendPath,
  isMachineDoor,
  isOpenPage,
  isPassthroughPath,
  upstreamFor,
} from "@/lib/route-policy";
import { answerHeaders, forwardHeaders, noTransform } from "@/lib/passthrough";

/**
 * The path router's decision (proxy.ts), as a pure function of the path and
 * the two origins. The environment is passed in, so each deployment shape
 * is a case here: laptop with the backend, Vercel with the tunnel, both,
 * neither.
 */

const BOTH = { backendOrigin: "http://localhost:8000", runtimeOrigin: "https://agentruntime.autogrc.cloud" };

describe("backend-owned paths", () => {
  it("names every door backend/CONTRACT.md gives the backend", () => {
    for (const p of [
      "/api/runs",
      "/api/healthz",
      "/api/approvals",
      "/api/agents",
      "/api/author",
      "/api/drafts",
      "/api/roster",
      "/api/keys",
      "/api/attached",
      "/api/iam",
      "/api/vault",
      "/api/trigger",
      "/api/webhooks",
      "/api/queue",
      "/api/worker",
      "/api/screener",
      "/api/applications",
      "/api/gateway",
      "/api/retrieval",
      "/api/apps",
      "/api/attention",
      "/api/fleet",
      "/api/lockdown",
      "/api/answer",
      "/api/mcp",
      "/api/sdk",
      "/api/ports",
      "/api/dependencies",
      "/api/drift",
      "/api/guardian",
      "/api/a2a",
      "/api/peers",
      "/api/breakers",
      "/api/evals/runs",
    ]) {
      expect(BACKEND_PREFIXES, `${p} is the backend's`).toContain(p);
    }
    expect(BACKEND_PATHS).toEqual(["/.well-known/agent.json"]);
  });

  // Phase L7 (second round): the A2A doors move to the backend whole (the
  // signed tasks door and the card beneath it, the tool broker, the model
  // gateway alias), machine doors forwarded byte for byte; the agent card at
  // the root is the backend's too, though it is not under /api.
  it("hands every A2A door to the backend, outside the cookie, forwarded byte for byte", () => {
    for (const p of [
      "/api/a2a",
      "/api/a2a/.well-known/agent.json",
      "/api/a2a/mcp/vendor-copilot",
      "/api/a2a/mcp/vendor%2Dcopilot",
      "/api/a2a/gateway/v1/chat/completions",
      "/api/a2a/gateway/v1/models",
      "/api/a2a/gateway",
      "/api/a2a/anything/else",
    ]) {
      expect(isBackendPath(p), `${p} is the backend's`).toBe(true);
      expect(isMachineDoor(p), `${p} is opened with a signature or a key, never a cookie`).toBe(true);
      expect(isPassthroughPath(p), `${p} is forwarded byte for byte`).toBe(true);
      expect(upstreamFor(p, "", BOTH)).toEqual({ to: "backend", url: `http://localhost:8000${p}` });
      expect(upstreamFor(p, "", { backendOrigin: "http://localhost:8000" })).toEqual({ to: "backend", url: `http://localhost:8000${p}` });
    }
    expect(PASSTHROUGH_DOORS).toEqual(["/api/a2a", "/.well-known/agent.json"]);
    // Siblings are none of it.
    for (const p of ["/api/a2ax", "/api/a2", "/api/a2a-tasks"]) {
      expect(isBackendPath(p), p).toBe(false);
      expect(isPassthroughPath(p), p).toBe(false);
      expect(isMachineDoor(p), p).toBe(false);
    }
    // The query travels as received: concatenated, never decoded or rebuilt.
    expect(upstreamFor("/api/a2a", "?trace=a%2Fb%3Dc&x=%7e", BOTH)).toEqual({ to: "backend", url: "http://localhost:8000/api/a2a?trace=a%2Fb%3Dc&x=%7e" });
    // Behind the tunnel (Vercel) they go where every API path goes; with neither origin, nothing here answers them.
    expect(upstreamFor("/api/a2a", "", { runtimeOrigin: "https://agentruntime.autogrc.cloud" })).toEqual({ to: "runtime", url: "https://agentruntime.autogrc.cloud/api/a2a" });
    expect(upstreamFor("/api/a2a/mcp/x", "", {})).toEqual({ to: "next" });
  });

  it("routes the agent card at the root, the one backend path outside /api, and nothing else under /.well-known", () => {
    const card = "/.well-known/agent.json";
    expect(isBackendPath(card)).toBe(true);
    expect(isMachineDoor(card)).toBe(true);
    expect(isPassthroughPath(card)).toBe(true);
    expect(upstreamFor(card, "", BOTH)).toEqual({ to: "backend", url: `http://localhost:8000${card}` });
    expect(upstreamFor(card, "", { backendOrigin: "http://localhost:8000/" })).toEqual({ to: "backend", url: `http://localhost:8000${card}` });
    expect(upstreamFor(card, "", { runtimeOrigin: "https://agentruntime.autogrc.cloud" })).toEqual({ to: "runtime", url: `https://agentruntime.autogrc.cloud${card}` });
    expect(upstreamFor(card, "", {})).toEqual({ to: "next" });
    for (const p of ["/.well-known/other.json", "/.well-known/agent.jsonx", "/.well-known", "/well-known/agent.json"]) {
      expect(isBackendPath(p), p).toBe(false);
      expect(upstreamFor(p, "", BOTH), p).toEqual({ to: "next" });
    }
    // Still an open path for a page request, as every /.well-known path is.
    expect(isOpenPage(card)).toBe(true);
  });

  // Phase L7 (second round): the peer registry and the estate's breakers are
  // a person's doors (view to read, configure to change), behind the cookie.
  it("hands the peer registry and the breakers to the backend, behind the cookie, rewritten as every console door is", () => {
    for (const p of [
      "/api/peers",
      "/api/peers/soc-stub",
      "/api/peers/soc-stub/approve",
      "/api/peers/soc-stub/rescan",
      "/api/breakers",
      "/api/breakers/notify.send",
      "/api/breakers/peer%3Asoc-stub",
    ]) {
      expect(isBackendPath(p), `${p} is the backend's`).toBe(true);
      expect(isMachineDoor(p), `${p} needs a session`).toBe(false);
      expect(isPassthroughPath(p), `${p} is rewritten`).toBe(false);
      expect(upstreamFor(p, "", BOTH)).toEqual({ to: "backend", url: `http://localhost:8000${p}` });
    }
    for (const p of ["/api/peersx", "/api/peer", "/api/breakersx", "/api/breaker/x"]) expect(isBackendPath(p), p).toBe(false);
  });

  // Phase L7 (first round): the dependency map and its blast radius, drift
  // per agent and the guardian are new prefixes; the run tree and the kill
  // that reaches it sit under /api/runs, already forwarded. Console doors,
  // behind the cookie.
  it("hands the L7 doors to the backend, behind the cookie", () => {
    for (const p of [
      "/api/dependencies",
      "/api/dependencies/server:casedesk/blast-radius",
      "/api/dependencies/model%3Agpt-4o/blast-radius",
      "/api/drift",
      "/api/guardian",
      "/api/guardian/actions",
      "/api/runs/triage-2026-10-21T09-42-38-plh8/tree",
      "/api/runs/triage-2026-10-21T09-42-38-plh8/kill",
    ]) {
      expect(isBackendPath(p), `${p} is the backend's`).toBe(true);
      expect(isMachineDoor(p), `${p} needs a session`).toBe(false);
      expect(upstreamFor(p, "", BOTH)).toEqual({ to: "backend", url: `http://localhost:8000${p}` });
    }
    // The window and the filters travel.
    expect(upstreamFor("/api/dependencies", "?window=7d", { backendOrigin: "http://localhost:8000" })).toEqual({ to: "backend", url: "http://localhost:8000/api/dependencies?window=7d" });
    // A node id with a slash goes as a path (the door's route is `/{node:path}/blast-radius`), its encoding kept.
    expect(upstreamFor("/api/dependencies/model%3Ameta/llama-3-70b/blast-radius", "?window=7d", BOTH)).toEqual({ to: "backend", url: "http://localhost:8000/api/dependencies/model%3Ameta/llama-3-70b/blast-radius?window=7d" });
    expect(upstreamFor("/api/drift", "?agent=triage", BOTH)).toEqual({ to: "backend", url: "http://localhost:8000/api/drift?agent=triage" });
    expect(upstreamFor("/api/guardian/actions", "?run=r-1&limit=50", BOTH)).toEqual({ to: "backend", url: "http://localhost:8000/api/guardian/actions?run=r-1&limit=50" });
    // Siblings are not.
    for (const p of ["/api/dependenciesx", "/api/driftwood", "/api/guardians", "/api/dependency"]) expect(isBackendPath(p), p).toBe(false);
    // Without a backend named, they have no answer here; behind the tunnel they go where every console route goes.
    expect(upstreamFor("/api/guardian", "", {})).toEqual({ to: "next" });
    expect(upstreamFor("/api/drift", "", { runtimeOrigin: "https://agentruntime.autogrc.cloud" })).toEqual({ to: "runtime", url: "https://agentruntime.autogrc.cloud/api/drift" });
  });

  // The close-out after L6: a port's own health check, which the attention
  // queue's health row names as its action. A console door, behind the cookie.
  it("hands the port health doors to the backend, behind the cookie", () => {
    for (const p of ["/api/ports", "/api/ports/billing/health", "/api/ports/telemetry/health", "/api/ports/identity/health"]) {
      expect(isBackendPath(p), `${p} is the backend's`).toBe(true);
      expect(isMachineDoor(p), `${p} needs a session`).toBe(false);
      expect(upstreamFor(p, "", BOTH)).toEqual({ to: "backend", url: `http://localhost:8000${p}` });
      expect(upstreamFor(p, "", { backendOrigin: "http://localhost:8000" })).toEqual({ to: "backend", url: `http://localhost:8000${p}` });
    }
    expect(isBackendPath("/api/portsx")).toBe(false);
    expect(isBackendPath("/api/port/billing/health")).toBe(false);
  });

  // Phase L6: the SDK door is the backend's, whole: the description, the
  // live run doors (open, entries, gate, the control long-poll, finish) and
  // the 1.4 upload and poll. An attached agent opens it with the key scoped
  // to it, so the cookie gate never stands in front of it, and the backend
  // refuses a console session there (401).
  it("hands the SDK door to the backend, and lets it through without a cookie", () => {
    for (const p of ["/api/sdk", "/api/sdk/runs", "/api/sdk/runs/x", "/api/sdk/runs/x/control", "/api/sdk/runs/x/entries", "/api/sdk/runs/x/gate", "/api/sdk/runs/x/finish"]) {
      expect(isBackendPath(p), `${p} is the backend's`).toBe(true);
      expect(isMachineDoor(p), `${p} needs no cookie`).toBe(true);
      expect(upstreamFor(p, "", BOTH)).toEqual({ to: "backend", url: `http://localhost:8000${p}` });
      expect(upstreamFor(p, "", { backendOrigin: "http://localhost:8000" })).toEqual({ to: "backend", url: `http://localhost:8000${p}` });
    }
    // The long-poll keeps its wait.
    expect(upstreamFor("/api/sdk/runs/x/control", "?wait=25", BOTH)).toEqual({ to: "backend", url: "http://localhost:8000/api/sdk/runs/x/control?wait=25" });
    // A sibling is neither.
    expect(isBackendPath("/api/sdkx")).toBe(false);
    expect(isMachineDoor("/api/sdkx")).toBe(false);
    // The platform's own MCP server is still the console's, and still a machine door.
    expect(isBackendPath("/api/mcp/server")).toBe(false);
    expect(isMachineDoor("/api/mcp/server")).toBe(true);
    expect(upstreamFor("/api/mcp/server", "", { backendOrigin: "http://localhost:8000" })).toEqual({ to: "next" });
  });

  // Phase L6: the MCP registry moves to the backend with its approve and
  // rescan doors beneath it. The platform's own MCP server stays on the
  // console (the exact path only), and the A2A tool broker under /api/a2a
  // is not the registry at all (it followed in L7's second round).
  it("hands the MCP registry to the backend, and keeps the platform's own MCP server here", () => {
    expect(isBackendPath("/api/mcp")).toBe(true);
    expect(isBackendPath("/api/mcp/risk-engine")).toBe(true);
    expect(isBackendPath("/api/mcp/risk-engine/approve")).toBe(true);
    expect(isBackendPath("/api/mcp/risk-engine/rescan")).toBe(true);
    expect(isBackendPath("/api/mcp/server")).toBe(false);
    expect(isBackendPath("/api/mcp/server/x")).toBe(true);
    expect(isBackendPath("/api/mcpx")).toBe(false);
    expect(upstreamFor("/api/mcp", "", BOTH)).toEqual({ to: "backend", url: "http://localhost:8000/api/mcp" });
    expect(upstreamFor("/api/mcp/risk-engine/approve", "", BOTH)).toEqual({ to: "backend", url: "http://localhost:8000/api/mcp/risk-engine/approve" });
    expect(upstreamFor("/api/mcp/risk-engine", "", { backendOrigin: "http://localhost:8000" })).toEqual({ to: "backend", url: "http://localhost:8000/api/mcp/risk-engine" });
    // The platform's MCP server never goes to the backend: with only the
    // backend named it stays in Next; behind the tunnel it goes where every
    // other console route goes.
    expect(upstreamFor("/api/mcp/server", "", { backendOrigin: "http://localhost:8000" })).toEqual({ to: "next" });
    expect(upstreamFor("/api/mcp/server", "", BOTH)).toEqual({ to: "runtime", url: "https://agentruntime.autogrc.cloud/api/mcp/server" });
    // The A2A tool broker is not the registry, and since L7's second round it is the backend's too.
    expect(upstreamFor("/api/a2a/mcp/vendor-copilot", "", { backendOrigin: "http://localhost:8000" })).toEqual({ to: "backend", url: "http://localhost:8000/api/a2a/mcp/vendor-copilot" });
  });

  // Phase L5: the attention queue, the fleet and lockdown doors and the
  // external answer door are new prefixes; the links, steer and artefact
  // bundle doors sit under prefixes already forwarded.
  it("hands the L5 doors to the backend", () => {
    expect(isBackendPath("/api/attention")).toBe(true);
    expect(isBackendPath("/api/attention/health:x/acknowledge")).toBe(true);
    expect(isBackendPath("/api/fleet")).toBe(true);
    expect(isBackendPath("/api/lockdown")).toBe(true);
    expect(isBackendPath("/api/answer/tok-1")).toBe(true);
    expect(isBackendPath("/api/approvals/run-1/links")).toBe(true);
    expect(isBackendPath("/api/runs/run-1/steer")).toBe(true);
    expect(isBackendPath("/api/runs/run-1/artefacts.zip")).toBe(true);
    expect(isBackendPath("/api/attentionx")).toBe(false);
    expect(isBackendPath("/api/fleets")).toBe(false);
    expect(isBackendPath("/api/answers")).toBe(false);
    expect(upstreamFor("/api/attention", "", BOTH)).toEqual({ to: "backend", url: "http://localhost:8000/api/attention" });
    expect(upstreamFor("/api/fleet", "", BOTH)).toEqual({ to: "backend", url: "http://localhost:8000/api/fleet" });
    expect(upstreamFor("/api/lockdown", "", BOTH)).toEqual({ to: "backend", url: "http://localhost:8000/api/lockdown" });
    expect(upstreamFor("/api/answer/tok-1", "", BOTH)).toEqual({ to: "backend", url: "http://localhost:8000/api/answer/tok-1" });
    expect(upstreamFor("/api/runs/run-1/artefacts.zip", "", BOTH)).toEqual({ to: "backend", url: "http://localhost:8000/api/runs/run-1/artefacts.zip" });
    expect(upstreamFor("/api/approvals/run-1/links", "", BOTH)).toEqual({ to: "backend", url: "http://localhost:8000/api/approvals/run-1/links" });
    expect(upstreamFor("/api/runs/run-1/steer", "", BOTH)).toEqual({ to: "backend", url: "http://localhost:8000/api/runs/run-1/steer" });
  });

  // Phase L4: the register, the OpenAI-compatible gateway, the retrieval
  // door and the chatbots built here all move to the backend together.
  it("hands the L4 doors to the backend, and only those", () => {
    expect(isBackendPath("/api/applications")).toBe(true);
    expect(isBackendPath("/api/applications/app-1/metrics")).toBe(true);
    expect(isBackendPath("/api/applications/app-1/conversations/c-1")).toBe(true);
    expect(isBackendPath("/api/gateway/v1/chat/completions")).toBe(true);
    expect(isBackendPath("/api/gateway/v1/embeddings")).toBe(true);
    expect(isBackendPath("/api/retrieval/search")).toBe(true);
    expect(isBackendPath("/api/retrieval/answer")).toBe(true);
    expect(isBackendPath("/api/apps/app-1/chat")).toBe(true);
    expect(isBackendPath("/api/applicationsx")).toBe(false);
    expect(isBackendPath("/api/appsx")).toBe(false);
    expect(isBackendPath("/api/app")).toBe(false);
    // The attached agents' alias of the gateway is the backend's since L7's second round.
    expect(isBackendPath("/api/a2a/gateway/v1/chat/completions")).toBe(true);
    expect(upstreamFor("/api/gateway/v1/chat/completions", "", BOTH)).toEqual({ to: "backend", url: "http://localhost:8000/api/gateway/v1/chat/completions" });
    expect(upstreamFor("/api/applications/app-1/metrics", "?window=7d", BOTH)).toEqual({ to: "backend", url: "http://localhost:8000/api/applications/app-1/metrics?window=7d" });
  });

  it("matches the prefix itself and anything beneath it, never a sibling", () => {
    expect(isBackendPath("/api/runs")).toBe(true);
    expect(isBackendPath("/api/runs/abc-1/events")).toBe(true);
    expect(isBackendPath("/api/runs/kill-all")).toBe(true);
    expect(isBackendPath("/api/healthz")).toBe(true);
    expect(isBackendPath("/api/approvals")).toBe(true);
    expect(isBackendPath("/api/approvals/run-1")).toBe(true);
    expect(isBackendPath("/api/agents/aegis/deploy")).toBe(true);
    expect(isBackendPath("/api/agents/aegis/diff")).toBe(true);
    expect(isBackendPath("/api/author/reference")).toBe(true);
    expect(isBackendPath("/api/author/propose")).toBe(true);
    expect(isBackendPath("/api/keys/k-1")).toBe(true);
    expect(isBackendPath("/api/attached/registry")).toBe(true);
    expect(isBackendPath("/api/iam/users")).toBe(true);
    expect(isBackendPath("/api/iam/identities")).toBe(true);
    expect(isBackendPath("/api/trigger/aegis/jobs/j-1")).toBe(true);
    expect(isBackendPath("/api/webhooks/aegis")).toBe(true);
    expect(isBackendPath("/api/worker/claim")).toBe(true);
    expect(isBackendPath("/api/queue/jobs/j-1/replay")).toBe(true);
    expect(isBackendPath("/api/screener")).toBe(true);
    expect(isBackendPath("/api/screener/health")).toBe(true);
    expect(isBackendPath("/api/screenerx")).toBe(false);
    expect(isBackendPath("/api/runsx")).toBe(false);
    expect(isBackendPath("/api/agentsx")).toBe(false);
    expect(isBackendPath("/api/sdk/runs")).toBe(true);
    expect(isBackendPath("/api/sdkx")).toBe(false);
    expect(isBackendPath("/api/a2a")).toBe(true);
    expect(isBackendPath("/api/mcp/server")).toBe(false);
    expect(isBackendPath("/api/control")).toBe(false);
    expect(isBackendPath("/api/configuration")).toBe(false);
    // Phase L8: the eval runner is the backend's (its reads at /api/evals/runs); the eval sets stay the console's.
    expect(isBackendPath("/api/evals")).toBe(false);
    expect(isBackendPath("/api/evals/run")).toBe(false);
    expect(isBackendPath("/api/evals/runs/ev-mvi66ddb-df7a")).toBe(true);
    expect(isBackendPath("/api/evals/runs")).toBe(true);
    expect(isBackendPath("/api/evals/runsx")).toBe(false);
    expect(isBackendPath("/api/agents/aegis/evals/run")).toBe(true);
    expect(isBackendPath("/runs")).toBe(false);
  });

  // The authoring conversation is the console's loop; only its runtime steps
  // (reference, propose) are the backend's. The platform's own MCP server is
  // the console's; the registry around it is the backend's. Each exception
  // is the exact path.
  it("keeps the console's named exceptions in Next, and only those", () => {
    expect(CONSOLE_UNDER_BACKEND).toEqual(["/api/author/chat", "/api/mcp/server"]);
    expect(isBackendPath("/api/author/chat")).toBe(false);
    expect(isBackendPath("/api/author/chat/x")).toBe(true);
    expect(isBackendPath("/api/author")).toBe(true);
    expect(isBackendPath("/api/mcp/server")).toBe(false);
    expect(isBackendPath("/api/mcp/serverx")).toBe(true);
    expect(isBackendPath("/api/mcp")).toBe(true);
  });
});

describe("upstreamFor", () => {
  it("sends a backend-owned path to BACKEND_ORIGIN, with the search string, whatever RUNTIME_ORIGIN says", () => {
    expect(upstreamFor("/api/runs", "?agent=aegis", BOTH)).toEqual({ to: "backend", url: "http://localhost:8000/api/runs?agent=aegis" });
    expect(upstreamFor("/api/runs/r-1/events", "", BOTH)).toEqual({ to: "backend", url: "http://localhost:8000/api/runs/r-1/events" });
    expect(upstreamFor("/api/runs/r-1/kill", "", { backendOrigin: "http://localhost:8000" })).toEqual({
      to: "backend",
      url: "http://localhost:8000/api/runs/r-1/kill",
    });
    expect(upstreamFor("/api/approvals", "?agent=x", BOTH)).toEqual({ to: "backend", url: "http://localhost:8000/api/approvals?agent=x" });
    expect(upstreamFor("/api/agents/aegis/deploy", "", BOTH)).toEqual({ to: "backend", url: "http://localhost:8000/api/agents/aegis/deploy" });
    expect(upstreamFor("/api/vault", "?name=foundry", { backendOrigin: "http://localhost:8000" })).toEqual({
      to: "backend",
      url: "http://localhost:8000/api/vault?name=foundry",
    });
    expect(upstreamFor("/api/screener/health", "", BOTH)).toEqual({ to: "backend", url: "http://localhost:8000/api/screener/health" });
    expect(upstreamFor("/api/evals/runs/ev-1", "", BOTH)).toEqual({ to: "backend", url: "http://localhost:8000/api/evals/runs/ev-1" });
    expect(upstreamFor("/api/agents/aegis/evals/run", "", BOTH)).toEqual({ to: "backend", url: "http://localhost:8000/api/agents/aegis/evals/run" });
  });

  it("sends every other API path to RUNTIME_ORIGIN when that is set", () => {
    expect(upstreamFor("/api/control", "", BOTH)).toEqual({ to: "runtime", url: "https://agentruntime.autogrc.cloud/api/control" });
    expect(upstreamFor("/api/evals", "?id=triage-bench", BOTH)).toEqual({ to: "runtime", url: "https://agentruntime.autogrc.cloud/api/evals?id=triage-bench" });
    expect(upstreamFor("/api/author/chat", "", BOTH)).toEqual({ to: "runtime", url: "https://agentruntime.autogrc.cloud/api/author/chat" });
    expect(upstreamFor("/api/approvals", "?agent=x", { runtimeOrigin: "https://agentruntime.autogrc.cloud" })).toEqual({
      to: "runtime",
      url: "https://agentruntime.autogrc.cloud/api/approvals?agent=x",
    });
  });

  it("falls back to RUNTIME_ORIGIN for a backend path only when BACKEND_ORIGIN is unset", () => {
    expect(upstreamFor("/api/runs", "", { runtimeOrigin: "https://agentruntime.autogrc.cloud" })).toEqual({
      to: "runtime",
      url: "https://agentruntime.autogrc.cloud/api/runs",
    });
  });

  it("keeps a non-backend path in Next when only BACKEND_ORIGIN is set", () => {
    expect(upstreamFor("/api/control", "", { backendOrigin: "http://localhost:8000" })).toEqual({ to: "next" });
    expect(upstreamFor("/api/configuration", "", { backendOrigin: "http://localhost:8000" })).toEqual({ to: "next" });
    expect(upstreamFor("/api/evals", "", { backendOrigin: "http://localhost:8000" })).toEqual({ to: "next" });
    expect(upstreamFor("/api/author/chat", "", { backendOrigin: "http://localhost:8000" })).toEqual({ to: "next" });
  });

  it("keeps everything in Next with neither origin", () => {
    expect(upstreamFor("/api/runs", "", {})).toEqual({ to: "next" });
    expect(upstreamFor("/api/agents", "", {})).toEqual({ to: "next" });
    expect(upstreamFor("/api/control", "", { backendOrigin: "", runtimeOrigin: "" })).toEqual({ to: "next" });
  });

  it("never forwards a page; the agent card is no page", () => {
    expect(upstreamFor("/runs", "?id=r-1", BOTH)).toEqual({ to: "next" });
    expect(upstreamFor("/peers", "", BOTH)).toEqual({ to: "next" });
    expect(upstreamFor("/breakers", "", BOTH)).toEqual({ to: "next" });
    expect(upstreamFor("/", "", BOTH)).toEqual({ to: "next" });
    expect(upstreamFor("/api", "", BOTH)).toEqual({ to: "next" });
    expect(upstreamFor("/.well-known/agent.json", "", BOTH)).toEqual({ to: "backend", url: "http://localhost:8000/.well-known/agent.json" });
  });

  it("tolerates a trailing slash on either origin", () => {
    expect(upstreamFor("/api/runs", "", { backendOrigin: "http://localhost:8000/" })).toEqual({ to: "backend", url: "http://localhost:8000/api/runs" });
    expect(upstreamFor("/api/control", "", { runtimeOrigin: "https://x.example//" })).toEqual({ to: "runtime", url: "https://x.example/api/control" });
  });
});

/**
 * The cookie gate's exemptions (proxy.ts). A machine door is opened with an
 * API key, an application key or a webhook secret; a session cookie never
 * stands in front of it. Everything else under /api needs the cookie once
 * AUTH_SECRET is set. The register itself (/api/applications) is a console
 * route: a person reads and changes it, so it is not a door.
 */
describe("machine doors", () => {
  it("names the backend's keyed doors (the SDK door since L6, the A2A doors and the card since L7) and the console's own", () => {
    for (const d of ["/api/trigger/", "/api/webhooks/", "/api/worker/", "/api/gateway/", "/api/retrieval/", "/api/apps/", "/api/sdk/", "/api/sdk", "/api/a2a", "/api/mcp/server", "/api/auth/", "/api/answer/", "/.well-known/agent.json"]) {
      expect(MACHINE_DOORS, `${d} is a machine door`).toContain(d);
    }
    // The peer registry and the breakers are a person's.
    expect(MACHINE_DOORS).not.toContain("/api/peers");
    expect(MACHINE_DOORS).not.toContain("/api/breakers");
  });

  // The external answer door is opened with the signed link token in its
  // path; the session cookie never stands in front of it. The other L5
  // doors are a person's: attention, fleet, lockdown, links, steer, the
  // artefact bundle all need the cookie.
  it("exempts the external answer door and only that of the L5 doors", () => {
    expect(isMachineDoor("/api/answer/tok-1")).toBe(true);
    expect(isMachineDoor("/api/answer")).toBe(false);
    expect(isMachineDoor("/api/answers/x")).toBe(false);
    expect(isMachineDoor("/api/attention")).toBe(false);
    expect(isMachineDoor("/api/fleet")).toBe(false);
    expect(isMachineDoor("/api/lockdown")).toBe(false);
    expect(isMachineDoor("/api/approvals/run-1/links")).toBe(false);
    expect(isMachineDoor("/api/runs/run-1/steer")).toBe(false);
    expect(isMachineDoor("/api/runs/run-1/artefacts.zip")).toBe(false);
  });

  it("exempts the L4 doors from the cookie gate", () => {
    expect(isMachineDoor("/api/gateway/v1/chat/completions")).toBe(true);
    expect(isMachineDoor("/api/gateway/v1/embeddings")).toBe(true);
    expect(isMachineDoor("/api/retrieval/search")).toBe(true);
    expect(isMachineDoor("/api/retrieval/answer")).toBe(true);
    expect(isMachineDoor("/api/apps/app-1/chat")).toBe(true);
    expect(isMachineDoor("/api/trigger/aegis")).toBe(true);
    expect(isMachineDoor("/api/webhooks/aegis")).toBe(true);
    expect(isMachineDoor("/api/worker/claim")).toBe(true);
    expect(isMachineDoor("/api/a2a")).toBe(true);
    expect(isMachineDoor("/api/a2a/gateway/v1/chat/completions")).toBe(true);
    expect(isMachineDoor("/api/mcp/server")).toBe(true);
    expect(isMachineDoor("/api/sdk")).toBe(true);
    expect(isMachineDoor("/api/sdk/runs")).toBe(true);
    expect(isMachineDoor("/api/auth/login")).toBe(true);
  });

  it("keeps the register, the console routes and every page behind the cookie", () => {
    expect(isMachineDoor("/api/applications")).toBe(false);
    expect(isMachineDoor("/api/applications/app-1/metrics")).toBe(false);
    expect(isMachineDoor("/api/gateway")).toBe(false);
    expect(isMachineDoor("/api/gatewayx/v1")).toBe(false);
    expect(isMachineDoor("/api/retrieval")).toBe(false);
    expect(isMachineDoor("/api/apps")).toBe(false);
    expect(isMachineDoor("/api/appsx/chat")).toBe(false);
    expect(isMachineDoor("/api/mcp")).toBe(false);
    expect(isMachineDoor("/api/mcp/serverx")).toBe(false);
    // The registry's doors are a person's (configure), so the cookie gate stands in front of them.
    expect(isMachineDoor("/api/mcp/risk-engine/approve")).toBe(false);
    expect(isMachineDoor("/api/mcp/risk-engine/rescan")).toBe(false);
    expect(isMachineDoor("/api/a2ax")).toBe(false);
    expect(isMachineDoor("/api/runs")).toBe(false);
    expect(isMachineDoor("/api/guardrails")).toBe(false);
    expect(isMachineDoor("/api/knowledge/reembed")).toBe(false);
    expect(isMachineDoor("/applications")).toBe(false);
    expect(isMachineDoor("/")).toBe(false);
  });
});

/**
 * The pages the cookie gate leaves open (proxy.ts, through
 * lib/route-policy.ts): the landing page, sign-in and its refusal, and the
 * external answer page, where an outside participant uses a signed link and
 * has no session. The chrome stays off the same list. Everything else is a
 * console page and needs the cookie.
 */
describe("open pages", () => {
  it("names the landing page, sign-in, no-access and the external answer page", () => {
    expect(OPEN_PAGES).toEqual(["/", "/login", "/no-access"]);
    expect(OPEN_PREFIXES).toContain("/answer/");
  });

  it("opens the external answer page and the static assets, nothing else", () => {
    expect(isOpenPage("/")).toBe(true);
    expect(isOpenPage("/login")).toBe(true);
    expect(isOpenPage("/no-access")).toBe(true);
    expect(isOpenPage("/answer/tok-1")).toBe(true);
    expect(isOpenPage("/answer/")).toBe(true);
    expect(isOpenPage("/_next/static/x.js")).toBe(true);
    expect(isOpenPage("/favicon.ico")).toBe(true);
    expect(isOpenPage("/answer")).toBe(false);
    expect(isOpenPage("/answers/tok-1")).toBe(false);
    expect(isOpenPage("/control")).toBe(false);
    expect(isOpenPage("/runs")).toBe(false);
    expect(isOpenPage("/loginx")).toBe(false);
  });

  it("never opens an API path, whatever it is called", () => {
    expect(isOpenPage("/api/answer/tok-1")).toBe(false);
    expect(isOpenPage("/api/auth/login")).toBe(false);
    expect(isOpenPage("/api/")).toBe(false);
  });
});

/**
 * proxy.ts itself, with fetch stubbed as the upstream: what reaches the
 * backend for a signed A2A request, and what comes back. A2A signatures
 * cover the raw path and query, the body and the x-af-* headers on the way
 * in, and the status and body on the way out (backend/CONTRACT.md "A2A,
 * both ways"), so every byte of those must arrive as it was sent. The
 * environment is read when proxy.ts loads, so each case loads it afresh.
 */
describe("the proxy, end to end, for the signed A2A doors", () => {
  const BACKEND = "http://backend.test:8000";
  const PUBLIC = "https://agentfactory.autogrc.cloud";
  const enc = (s: string) => new TextEncoder().encode(s);
  const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function load(env: Record<string, string>) {
    vi.resetModules();
    for (const k of ["BACKEND_ORIGIN", "RUNTIME_ORIGIN", "RUNTIME_KEY", "AUTH_SECRET"]) vi.stubEnv(k, env[k] ?? "");
    return (await import("@/proxy")).proxy;
  }

  interface Reached {
    url: string;
    method: string;
    headers: Headers;
    body: Uint8Array | null;
  }

  /** The upstream: records what reached it, answers with `answer`. */
  function upstream(answer: () => Response) {
    const reached: Reached[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init: RequestInit = {}) => {
        const body = init.body === undefined || init.body === null ? null : new Uint8Array(init.body as ArrayBuffer);
        reached.push({ url: String(url), method: String(init.method), headers: new Headers(init.headers), body });
        return answer();
      }),
    );
    return reached;
  }

  // A body a JSON round trip would change: key order, spacing, escapes, non-ASCII, a trailing newline.
  const BODY = enc('{"jsonrpc":"2.0",  "method":"tasks/send","id":7,"params":{"message":{"parts":[{"type":"text","text":"caf\\u00e9 ✓ \\/x"}]}}}\n');
  const SIGNED = {
    "x-af-agent": "vendor-bot",
    "x-af-timestamp": "1792570000",
    "x-af-nonce": "0123456789abcdef0123456789abcdef",
    "x-af-signature": "q1w2e3-r4t5_y6u7i8o9p0",
    "x-af-delegation": "eyJncmFudHMiOltdLCJkZXB0aCI6MX0",
    "content-type": "application/json",
  };
  const ANSWER = enc('{"jsonrpc": "2.0", "id": 7, "result": {"id": "job-1", "status": {"state": "submitted"}}}');
  const ANSWER_SIGNATURE = "c2lnbmVkLW92ZXItc3RhdHVz_bm9uY2UtYm9keQ";

  it("sends a percent-encoded path, its query, the body bytes and every x-af-* header on unchanged, and the signed answer back unchanged", async () => {
    const proxy = await load({ BACKEND_ORIGIN: BACKEND, RUNTIME_KEY: "rk-test", AUTH_SECRET: "auth-test" });
    const reached = upstream(
      () => new Response(ANSWER, { status: 200, headers: { "content-type": "application/json", "x-af-signature": ANSWER_SIGNATURE, "content-length": String(ANSWER.length) } }),
    );
    const path = "/api/a2a/mcp/vendor%2Dcopilot%3Adesk?trace=a%2Fb%3Dc&x=%7e";
    const res = await proxy(new NextRequest(`${PUBLIC}${path}`, { method: "POST", headers: { ...SIGNED, "accept-encoding": "gzip, br", connection: "keep-alive" }, body: BODY }));

    expect(reached).toHaveLength(1);
    const r = reached[0];
    // The path and the query exactly as received: nothing decoded, nothing re-encoded, the hex case kept.
    expect(r.url).toBe(`${BACKEND}${path}`);
    expect(`${new URL(r.url).pathname}${new URL(r.url).search}`).toBe(path);
    expect(r.method).toBe("POST");
    // The body as the bytes it arrived as.
    expect(r.body && same(r.body, BODY)).toBe(true);
    // Every x-af-* header as sent; the runtime key added; the upstream asked for the body as it signs it.
    for (const [k, v] of Object.entries(SIGNED)) expect(r.headers.get(k), k).toBe(v);
    expect(r.headers.get("x-runtime-key")).toBe("rk-test");
    expect(r.headers.get("accept-encoding")).toBe("identity");
    expect([r.headers.get("host"), r.headers.get("connection")]).toEqual([null, null]);

    // The answer: the status, its signature and its bytes as the backend sent them, never compressed on the way.
    expect(res.status).toBe(200);
    expect(res.headers.get("x-af-signature")).toBe(ANSWER_SIGNATURE);
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-transform");
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(same(new Uint8Array(await res.arrayBuffer()), ANSWER)).toBe(true);
  });

  it("forwards the tasks door and the agent card without a session, with sign-in on", async () => {
    const proxy = await load({ BACKEND_ORIGIN: BACKEND, AUTH_SECRET: "auth-test" });
    const card = enc('{"name":"Agent Factory","url":"https://agentfactory.autogrc.cloud/api/a2a","skills":[]}');
    const reached = upstream(() => new Response(card, { status: 200, headers: { "content-type": "application/json", "x-af-signature": "card-sig", "cache-control": "private" } }));
    for (const path of ["/.well-known/agent.json", "/api/a2a/.well-known/agent.json"]) {
      const res = await proxy(new NextRequest(`${PUBLIC}${path}`, { headers: { "x-af-agent": "soc-stub", "x-af-signature": "sig", "x-af-nonce": "ab".repeat(16), "x-af-timestamp": "1792570000" } }));
      expect(res.status, path).toBe(200);
      expect(res.headers.get("x-af-signature")).toBe("card-sig");
      // What the upstream said about caching is kept; no-transform is added.
      expect(res.headers.get("cache-control")).toBe("private, no-transform");
      expect(same(new Uint8Array(await res.arrayBuffer()), card)).toBe(true);
    }
    expect(reached.map((r) => [r.method, r.url, r.body, r.headers.get("x-af-agent")])).toEqual([
      ["GET", `${BACKEND}/.well-known/agent.json`, null, "soc-stub"],
      ["GET", `${BACKEND}/api/a2a/.well-known/agent.json`, null, "soc-stub"],
    ]);
    // A tasks post from a peer carries no cookie either.
    const res = await proxy(new NextRequest(`${PUBLIC}/api/a2a`, { method: "POST", headers: SIGNED, body: BODY }));
    expect(res.status).toBe(200);
    expect(reached.at(-1)?.url).toBe(`${BACKEND}/api/a2a`);
  });

  it("passes a refusal, a 204 and a backend that does not answer through as such", async () => {
    const proxy = await load({ BACKEND_ORIGIN: BACKEND });
    const refusal = enc('{"error": "the request\'s signature does not match", "control": "a2a_auth"}');
    let answer = () => new Response(refusal, { status: 401, headers: { "content-type": "application/json", "x-af-signature": "refusal-sig" } });
    upstream(() => answer());
    let res = await proxy(new NextRequest(`${PUBLIC}/api/a2a`, { method: "POST", headers: SIGNED, body: BODY }));
    expect([res.status, res.headers.get("x-af-signature")]).toEqual([401, "refusal-sig"]);
    expect(same(new Uint8Array(await res.arrayBuffer()), refusal)).toBe(true);
    // The broker closing a session: 204, no body.
    answer = () => new Response(null, { status: 204 });
    res = await proxy(new NextRequest(`${PUBLIC}/api/a2a/mcp/vendor-copilot`, { method: "DELETE", headers: { authorization: "Bearer af_x", "mcp-session-id": "run-1" } }));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    // Nobody home.
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    res = await proxy(new NextRequest(`${PUBLIC}/api/a2a`, { method: "POST", headers: SIGNED, body: BODY }));
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toMatch(/served by the backend, which did not answer/);
  });

  it("forwards to the tunnel the same way when only RUNTIME_ORIGIN is set (the Vercel console)", async () => {
    const proxy = await load({ RUNTIME_ORIGIN: "https://agentruntime.autogrc.cloud", RUNTIME_KEY: "rk-test" });
    const reached = upstream(() => new Response(ANSWER, { status: 200, headers: { "x-af-signature": ANSWER_SIGNATURE } }));
    const res = await proxy(new NextRequest(`${PUBLIC}/api/a2a`, { method: "POST", headers: SIGNED, body: BODY }));
    expect(reached.map((r) => [r.url, r.headers.get("x-runtime-key"), r.headers.get("x-af-signature")])).toEqual([["https://agentruntime.autogrc.cloud/api/a2a", "rk-test", SIGNED["x-af-signature"]]]);
    expect(res.headers.get("x-af-signature")).toBe(ANSWER_SIGNATURE);
  });

  it("keeps the peer registry and the breakers behind the cookie, and rewrites them as every console door is", async () => {
    let proxy = await load({ BACKEND_ORIGIN: BACKEND, AUTH_SECRET: "auth-test" });
    const reached = upstream(() => new Response("{}"));
    for (const path of ["/api/peers", "/api/breakers", "/api/peers/soc-stub/approve"]) {
      const res = await proxy(new NextRequest(`${PUBLIC}${path}`, { method: path.endsWith("approve") ? "POST" : "GET" }));
      expect(res.status, path).toBe(401);
    }
    proxy = await load({ BACKEND_ORIGIN: BACKEND });
    const res = await proxy(new NextRequest(`${PUBLIC}/api/breakers/peer%3Asoc-stub`, { method: "DELETE" }));
    expect(res.headers.get("x-middleware-rewrite")).toBe(`${BACKEND}/api/breakers/peer%3Asoc-stub`);
    // A rewrite, so nothing was fetched here.
    expect(reached).toEqual([]);
  });

  it("the header rules, read alone", () => {
    const fwd = forwardHeaders(new Headers({ host: "agentfactory.autogrc.cloud", "x-af-agent": "a", "accept-encoding": "br", expect: "100-continue", "transfer-encoding": "chunked", cookie: "af_session=x" }), { key: "k" });
    expect([...fwd.entries()].sort()).toEqual([
      ["accept-encoding", "identity"],
      ["cookie", "af_session=x"],
      ["x-af-agent", "a"],
      ["x-runtime-key", "k"],
    ]);
    const back = answerHeaders(new Headers({ "x-af-signature": "s", "content-encoding": "gzip", "content-length": "12", "cache-control": "no-store", "content-type": "application/json" }));
    expect([...back.entries()].sort()).toEqual([
      ["cache-control", "no-store, no-transform"],
      ["content-type", "application/json"],
      ["x-af-signature", "s"],
    ]);
    expect([noTransform(null), noTransform("no-transform"), noTransform("max-age=0, No-Transform"), noTransform("public")]).toEqual(["no-transform", "no-transform", "max-age=0, No-Transform", "public, no-transform"]);
  });
});
