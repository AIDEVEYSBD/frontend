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

/**
 * Route files that are machine doors: API keys, never sessions. The trigger,
 * webhook and worker doors, and since phase L6 the SDK door, are the
 * backend's (BACKEND_PREFIXES below), so no route file answers for them
 * here; proxy.ts still exempts their URLs from the cookie gate.
 */
export const MACHINE_ROUTE_PREFIXES = ["app/api/a2a/", "app/api/mcp/server/"];

/**
 * Reads gated above "view", by file prefix. Every other GET is a viewer's to
 * make; the IAM register (people, sessions, the non-human identity register
 * and its findings) is read only by those who administer access. The IAM
 * doors are the backend's now, which gates them the same way; the rule
 * stays here for any console route that reappears under the prefix.
 */
export const STRICT_READS: Record<string, string> = { "app/api/iam/": "iam" };

/**
 * URL prefixes the backend owns (backend/CONTRACT.md). With BACKEND_ORIGIN
 * set, proxy.ts forwards a request under one of these to the backend before
 * anything else happens to it; no route file under app/api may answer for
 * them (tests/routes.test.ts checks). Slice 1 was the runs door and the
 * health check; slice 2 the trigger, webhook, queue and worker doors; slice
 * 3 approvals, agents, authoring, drafts, the roster, keys, attached agents,
 * IAM and the vault; phase L3 the screener; phase L4 the applications
 * register, the OpenAI-compatible gateway, the retrieval door and the
 * chatbots built here (`/api/apps`); phase L5 the attention queue, the
 * fleet and lockdown doors and the external answer door (`/api/answer`).
 * The L5 doors beneath existing prefixes (`/api/approvals/{run}/links`,
 * `/api/runs/{id}/steer`, `/api/runs/{id}/artefacts.zip`) travel with them.
 * Phase L6 the MCP registry (`/api/mcp`, with its approve and rescan doors
 * beneath it), less the platform's own MCP server at `/api/mcp/server`,
 * which CONSOLE_UNDER_BACKEND keeps here; and the SDK door (`/api/sdk`: the
 * description, the live run doors under `/api/sdk/runs` and the 1.4
 * upload and poll), which an attached agent opens with its scoped key.
 * The close-out after L6 added the ports' own health doors
 * (`/api/ports/{name}/health`), which an attention row's health action reads.
 * Phase L7 (first round) the dependency map with its blast radius
 * (`/api/dependencies`, `/api/dependencies/{node}/blast-radius`), drift per
 * agent (`/api/drift`) and the guardian (`/api/guardian`, with its actions
 * beneath it); the run tree (`/api/runs/{id}/tree`) and the kill that
 * reaches it travel with `/api/runs`. Every one is a console door behind
 * the cookie.
 */
export const BACKEND_PREFIXES = [
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
];

/**
 * The doors a machine opens with an API key (or, for a webhook, the spec's
 * own secret), so the cookie gate in proxy.ts never stands in front of them:
 * the backend's trigger, webhook and worker doors; the L4 gateway, retrieval
 * and chatbot doors (application keys); the backend's SDK door (phase L6),
 * which an attached agent opens with the key scoped to it and where a
 * console session is refused; the console's A2A and platform-MCP doors; the
 * external answer door, which an outside participant opens with the signed
 * link token in its path (phase L5).
 * Sign-in itself is open too, or nobody could start. An entry ending in "/"
 * matches anything beneath it; a bare entry matches itself and anything
 * beneath it.
 */
export const MACHINE_DOORS = [
  "/api/trigger/",
  "/api/webhooks/",
  "/api/worker/",
  "/api/gateway/",
  "/api/retrieval/",
  "/api/apps/",
  "/api/sdk/",
  "/api/sdk",
  "/api/a2a",
  "/api/mcp/server",
  "/api/auth/",
  "/api/answer/",
];

/** Whether a URL path is a machine door: exempt from the session cookie, guarded by its own key. */
export function isMachineDoor(pathname: string): boolean {
  return MACHINE_DOORS.some((d) => (d.endsWith("/") ? pathname.startsWith(d) : pathname === d || pathname.startsWith(`${d}/`)));
}

/**
 * Pages a person may open without a session: the landing page, sign-in and
 * its refusal, and the external answer page (`/answer/{token}`), where an
 * outside participant answers one gate with a signed link and nothing else.
 * The chrome (header, nav, assistant) is withheld on the same list.
 */
export const OPEN_PAGES = ["/", "/login", "/no-access"];
export const OPEN_PREFIXES = ["/answer/", "/_next/", "/logos/", "/media/", "/.well-known/", "/favicon.ico", "/icon.svg"];

/** Whether a page path (never an API path) is open without a session cookie. */
export function isOpenPage(pathname: string): boolean {
  if (pathname.startsWith("/api/")) return false;
  return OPEN_PAGES.includes(pathname) || OPEN_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * Console routes that live under a backend-owned prefix on purpose. The
 * authoring conversation is the console's own loop (it talks to Foundry for
 * the chat and to the backend's reference and propose doors for every
 * runtime step), so it stays in Next at /api/author/chat while the rest of
 * /api/author is the backend's. The platform's own MCP server is the
 * console's too (it serves the console tools the assistant shares), so it
 * stays at /api/mcp/server while the registry of servers this deployment
 * connects to, /api/mcp and everything else beneath it, is the backend's
 * (phase L6). An exact path, never a prefix: anything beneath it is still
 * forwarded.
 */
export const CONSOLE_UNDER_BACKEND = ["/api/author/chat", "/api/mcp/server"];

/** Whether a URL path is one the backend owns: the prefix itself, or anything beneath it, less the console's named exceptions. */
export function isBackendPath(pathname: string): boolean {
  if (CONSOLE_UNDER_BACKEND.includes(pathname)) return false;
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
