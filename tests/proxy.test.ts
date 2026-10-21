import { describe, expect, it } from "vitest";
import { BACKEND_PREFIXES, CONSOLE_UNDER_BACKEND, isBackendPath, upstreamFor } from "@/lib/route-policy";

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
    ]) {
      expect(BACKEND_PREFIXES, `${p} is the backend's`).toContain(p);
    }
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
