import { describe, expect, it } from "vitest";
import { BACKEND_PREFIXES, isBackendPath, upstreamFor } from "@/lib/route-policy";

/**
 * The path router's decision (proxy.ts), as a pure function of the path and
 * the two origins. The environment is passed in, so each deployment shape
 * is a case here: laptop with the backend, Vercel with the tunnel, both,
 * neither.
 */

const BOTH = { backendOrigin: "http://localhost:8000", runtimeOrigin: "https://agentruntime.autogrc.cloud" };

describe("backend-owned paths", () => {
  it("names the runs door and the health check", () => {
    expect(BACKEND_PREFIXES).toContain("/api/runs");
    expect(BACKEND_PREFIXES).toContain("/api/healthz");
  });

  it("matches the prefix itself and anything beneath it, never a sibling", () => {
    expect(isBackendPath("/api/runs")).toBe(true);
    expect(isBackendPath("/api/runs/abc-1/events")).toBe(true);
    expect(isBackendPath("/api/runs/kill-all")).toBe(true);
    expect(isBackendPath("/api/healthz")).toBe(true);
    expect(isBackendPath("/api/runsx")).toBe(false);
    expect(isBackendPath("/api/sdk/runs")).toBe(false);
    expect(isBackendPath("/api/control")).toBe(false);
    expect(isBackendPath("/runs")).toBe(false);
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
  });

  it("sends every other API path to RUNTIME_ORIGIN when that is set", () => {
    expect(upstreamFor("/api/control", "", BOTH)).toEqual({ to: "runtime", url: "https://agentruntime.autogrc.cloud/api/control" });
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
    expect(upstreamFor("/api/approvals", "", { backendOrigin: "http://localhost:8000" })).toEqual({ to: "next" });
  });

  it("keeps everything in Next with neither origin", () => {
    expect(upstreamFor("/api/runs", "", {})).toEqual({ to: "next" });
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
