import { describe, expect, it } from "vitest";
import { BACKEND_PREFIXES, CONSOLE_UNDER_BACKEND, PUBLIC_ROUTES, isBackendPath, readPermissionFor } from "@/lib/route-policy";
import { handlersOf, isMachine, routeFiles, urlOf } from "./routes";

/**
 * Every exported HTTP handler under app/api (and the agent card) is guarded.
 *
 * A console route calls permit(req, <permission>) as its first act, GET with
 * "view" (or the stricter read STRICT_READS names, as for IAM); a machine
 * door calls authenticate() or admit() from lib/server; and the only
 * handlers that do neither are the ones PUBLIC_ROUTES names, with a reason.
 * This reads the source, so a route added without a guard fails here before
 * it is ever deployed.
 */

const files = routeFiles();
const handlers = files.flatMap(handlersOf);

describe("route coverage", () => {
  it("finds the routes", () => {
    // What remains in Next after phase L2: knowledge, evals, FinOps, control,
    // the assistant, observability, the MCP registry and server, the model
    // gateway, the SDK and A2A doors, sign-in, and the authoring chat.
    expect(files.length).toBeGreaterThan(25);
    expect(handlers.length).toBeGreaterThan(files.length);
  });

  it("names only real files in PUBLIC_ROUTES", () => {
    for (const file of Object.keys(PUBLIC_ROUTES)) {
      expect(files, `${file} is in PUBLIC_ROUTES but does not exist`).toContain(file);
    }
  });

  // A path the backend owns is forwarded by proxy.ts before Next routes it,
  // so a route file under one would be dead with BACKEND_ORIGIN set and a
  // different API without it. The runs door went this way first; approvals,
  // agents, deploy, authoring, drafts, the roster, keys, attached agents,
  // IAM, the vault, the trigger and the queue followed in phase L2.
  it("has no route file under a backend-owned prefix", () => {
    expect(BACKEND_PREFIXES.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(isBackendPath(urlOf(file)), `${file} answers for ${urlOf(file)}, which BACKEND_PREFIXES (lib/route-policy.ts) hands to the backend`).toBe(false);
    }
  });

  // The one console route kept under a backend prefix on purpose must exist,
  // or the exception is a hole the router keeps open for nothing.
  it("keeps every CONSOLE_UNDER_BACKEND path as a real console route", () => {
    for (const p of CONSOLE_UNDER_BACKEND) {
      const file = `app${p}/route.ts`;
      expect(files, `${p} is in CONSOLE_UNDER_BACKEND but ${file} does not exist`).toContain(file);
    }
  });

  for (const h of handlers) {
    const where = `${h.file} ${h.method}`;
    it(`${where} is guarded`, () => {
      expect(
        h.guard.kind,
        `${where}: no permit(req, ...), authenticate(...) or admit(...) call in the handler body, and the file is not in PUBLIC_ROUTES (lib/route-policy.ts)`,
      ).not.toBe("none");

      if (isMachine(h.file)) {
        expect(h.guard.kind, `${where}: a machine door must call authenticate() or admit()`).toBe("machine");
        return;
      }
      if (h.guard.kind === "public") return;

      expect(h.guard.kind, `${where}: a console route must call permit(req, "<permission>")`).toBe("permit");
      if (h.guard.kind !== "permit") return;
      expect(h.guard.first, `${where}: permit(req, ...) must be the handler's first statement`).toBe(true);
      if (h.method === "GET" || h.method === "HEAD") {
        const expected = readPermissionFor(h.file);
        expect(h.guard.permission, `${where}: a read is gated on "${expected}" (lib/route-policy.ts STRICT_READS says which reads need more than view)`).toBe(expected);
      }
    });
  }
});
