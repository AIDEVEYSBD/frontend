/**
 * Which API routes may answer without a signed-in person.
 *
 * Every handler under app/api (and the agent card) is one of three things:
 * a console route, which calls permit() with the permission it needs as its
 * first act; a machine door, which authenticates an API key (authenticate or
 * admit from lib/server); or one of the few routes below, open because they
 * are how a person gets a session in the first place, or how a peer
 * discovers the factory. tests/routes.test.ts holds every handler to that,
 * so a new route cannot ship unguarded by accident.
 *
 * Paths are relative to frontend/.
 */

export const PUBLIC_ROUTES: Record<string, string> = {
  "app/api/auth/login/route.ts": "starts the sign-in; nobody has a session yet",
  "app/api/auth/callback/route.ts": "the identity provider's return leg; this is where the session is created",
  "app/api/auth/logout/route.ts": "ends whatever session the cookie names; without one there is nothing to end",
  "app/api/auth/session/route.ts": "answers who is signed in, or 401; the console's first question on every page",
  "app/.well-known/agent.json/route.ts": "the factory's A2A agent card: discovery is public by design, and it carries only deployed workflow names",
};

/** Route files that are machine doors: API keys, never sessions. */
export const MACHINE_ROUTE_PREFIXES = ["app/api/trigger/", "app/api/a2a/", "app/api/sdk/", "app/api/mcp/server/"];

/**
 * Reads gated above "view", by file prefix. Every other GET is a viewer's to
 * make; the IAM register (people, sessions, the non-human identity register
 * and its findings) is read only by those who administer access.
 */
export const STRICT_READS: Record<string, string> = { "app/api/iam/": "iam" };

/**
 * URL prefixes the backend owns (backend/CONTRACT.md). With BACKEND_ORIGIN
 * set, proxy.ts forwards a request under one of these to the backend before
 * anything else happens to it; no route file under app/api may answer for
 * them (tests/routes.test.ts checks). Slice 2 adds /api/trigger,
 * /api/webhooks, /api/queue and /api/worker here.
 */
export const BACKEND_PREFIXES = ["/api/runs", "/api/healthz"];

/** Whether a URL path is one the backend owns: the prefix itself, or anything beneath it. */
export function isBackendPath(pathname: string): boolean {
  return BACKEND_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export type Upstream = { to: "backend"; url: string } | { to: "runtime"; url: string } | { to: "next" };

/**
 * Where proxy.ts sends an API request. Pure: the environment comes in as
 * arguments so the decision can be tested without one.
 *
 * - A backend-owned path goes to BACKEND_ORIGIN when that is set, whatever
 *   RUNTIME_ORIGIN says.
 * - Otherwise, with RUNTIME_ORIGIN set (the Vercel console), every API path
 *   goes to the control plane behind the tunnel.
 * - Otherwise the request is answered by this Next server.
 */
export function upstreamFor(pathname: string, search: string, env: { backendOrigin?: string; runtimeOrigin?: string }): Upstream {
  if (!pathname.startsWith("/api/")) return { to: "next" };
  const backend = (env.backendOrigin ?? "").replace(/\/+$/, "");
  const runtime = (env.runtimeOrigin ?? "").replace(/\/+$/, "");
  if (backend && isBackendPath(pathname)) return { to: "backend", url: `${backend}${pathname}${search}` };
  if (runtime) return { to: "runtime", url: `${runtime}${pathname}${search}` };
  return { to: "next" };
}

export function isMachineRoute(file: string): boolean {
  return MACHINE_ROUTE_PREFIXES.some((p) => file.startsWith(p));
}

export function isPublicRoute(file: string): boolean {
  return Object.hasOwn(PUBLIC_ROUTES, file);
}

/** The permission a console route's GET must be gated on. */
export function readPermissionFor(file: string): string {
  for (const [prefix, permission] of Object.entries(STRICT_READS)) if (file.startsWith(prefix)) return permission;
  return "view";
}
