import { describe, expect, it } from "vitest";
import { handlersOf, isMachine, routeFiles, urlOf } from "./routes";

/**
 * Walks every route as a viewer against a running console.
 *
 * Skipped unless WALK_BASE_URL is set. Run it in two shells, from frontend/:
 *
 *   AUTH_LOCAL_ROLE=viewer npx next dev -p 3100
 *   WALK_BASE_URL=http://localhost:3100 npm test -- tests/http-walk
 *
 * (Not BASE_URL: Vitest hands Vite's base path, "/", to every worker under
 * that name and overwrites whatever the shell set.) Next refuses a second
 * dev server while one is running for this directory, so stop any other
 * first, and never point this at a server whose session is not a viewer:
 * the walk POSTs to every write route, and only a viewer is refused at the
 * gate before a body is read.
 *
 * In local mode (no SSO configured) every request is the console's operator
 * holding the role AUTH_LOCAL_ROLE names, so the walk shows a viewer's view:
 * no GET answers 403 (except the IAM reads, which STRICT_READS gates on
 * "iam"), every console write gated above "view" answers 403, and a write
 * gated on "view" (a read that takes a body) does not. Machine doors and the
 * public routes are walked but not asserted; without a key they answer 401,
 * and that is a different test.
 */

const BASE = (process.env.WALK_BASE_URL ?? "").replace(/\/+$/, "");

describe.skipIf(!BASE)("every route, walked as a viewer", () => {
  for (const file of routeFiles()) {
    for (const h of handlersOf(file)) {
      const url = urlOf(file);
      it(`${h.method} ${url}`, async () => {
        const res = await fetch(`${BASE}${url}`, {
          method: h.method,
          headers: { "content-type": "application/json" },
          body: h.method === "GET" || h.method === "HEAD" ? undefined : "{}",
          redirect: "manual",
        });
        await res.arrayBuffer().catch(() => undefined);
        if (isMachine(file) || h.guard.kind !== "permit") return;
        if (h.method === "GET" || h.method === "HEAD") {
          if (h.guard.permission === "view") expect(res.status, `${h.method} ${url}: a viewer may read this`).not.toBe(403);
          else expect(res.status, `${h.method} ${url}: a read gated on "${h.guard.permission}", which a viewer lacks`).toBe(403);
          return;
        }
        if (h.guard.permission === "view") {
          expect(res.status, `${h.method} ${url}: gated on "view", so a viewer passes the gate`).not.toBe(403);
        } else {
          expect(res.status, `${h.method} ${url}: gated on "${h.guard.permission}", which a viewer lacks`).toBe(403);
        }
      });
    }
  }
});
