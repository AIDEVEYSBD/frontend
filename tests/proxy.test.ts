import { describe, expect, it } from "vitest";
import { BACKEND_PREFIXES, CONSOLE_UNDER_BACKEND, MACHINE_DOORS, OPEN_PAGES, OPEN_PREFIXES, isBackendPath, isMachineDoor, isOpenPage, upstreamFor } from "@/lib/route-policy";

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
    ]) {
      expect(BACKEND_PREFIXES, `${p} is the backend's`).toContain(p);
    }
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
    // The console's own A2A alias of the gateway stays in Next.
    expect(isBackendPath("/api/a2a/gateway/v1/chat/completions")).toBe(false);
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
    expect(isBackendPath("/api/sdk/runs")).toBe(false);
    expect(isBackendPath("/api/a2a")).toBe(false);
    expect(isBackendPath("/api/mcp/server")).toBe(false);
    expect(isBackendPath("/api/control")).toBe(false);
    expect(isBackendPath("/api/configuration")).toBe(false);
    expect(isBackendPath("/api/evals/run")).toBe(false);
    expect(isBackendPath("/runs")).toBe(false);
  });

  // The authoring conversation is the console's loop; only its runtime steps
  // (reference, propose) are the backend's. The exception is the exact path.
  it("keeps the console's named exceptions in Next, and only those", () => {
    expect(CONSOLE_UNDER_BACKEND).toContain("/api/author/chat");
    expect(isBackendPath("/api/author/chat")).toBe(false);
    expect(isBackendPath("/api/author/chat/x")).toBe(true);
    expect(isBackendPath("/api/author")).toBe(true);
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
  });

  it("sends every other API path to RUNTIME_ORIGIN when that is set", () => {
    expect(upstreamFor("/api/control", "", BOTH)).toEqual({ to: "runtime", url: "https://agentruntime.autogrc.cloud/api/control" });
    expect(upstreamFor("/api/evals/run", "", BOTH)).toEqual({ to: "runtime", url: "https://agentruntime.autogrc.cloud/api/evals/run" });
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
    expect(upstreamFor("/api/evals/run", "", { backendOrigin: "http://localhost:8000" })).toEqual({ to: "next" });
    expect(upstreamFor("/api/author/chat", "", { backendOrigin: "http://localhost:8000" })).toEqual({ to: "next" });
  });

  it("keeps everything in Next with neither origin", () => {
    expect(upstreamFor("/api/runs", "", {})).toEqual({ to: "next" });
    expect(upstreamFor("/api/agents", "", {})).toEqual({ to: "next" });
    expect(upstreamFor("/api/control", "", { backendOrigin: "", runtimeOrigin: "" })).toEqual({ to: "next" });
  });

  it("never forwards a page", () => {
    expect(upstreamFor("/runs", "?id=r-1", BOTH)).toEqual({ to: "next" });
    expect(upstreamFor("/", "", BOTH)).toEqual({ to: "next" });
    expect(upstreamFor("/api", "", BOTH)).toEqual({ to: "next" });
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
  it("names the backend's keyed doors and the console's own", () => {
    for (const d of ["/api/trigger/", "/api/webhooks/", "/api/worker/", "/api/gateway/", "/api/retrieval/", "/api/apps/", "/api/sdk/", "/api/sdk", "/api/a2a", "/api/mcp/server", "/api/auth/", "/api/answer/"]) {
      expect(MACHINE_DOORS, `${d} is a machine door`).toContain(d);
    }
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
