import { describe, expect, it } from "vitest";
import { PUBLIC_ROUTES, readPermissionFor } from "@/lib/route-policy";
import { handlersOf, isMachine, routeFiles } from "./routes";

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
    expect(files.length).toBeGreaterThan(40);
    expect(handlers.length).toBeGreaterThan(files.length);
  });

  it("names only real files in PUBLIC_ROUTES", () => {
    for (const file of Object.keys(PUBLIC_ROUTES)) {
      expect(files, `${file} is in PUBLIC_ROUTES but does not exist`).toContain(file);
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
