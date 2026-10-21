/**
 * Which API routes may answer without a signed-in person.
 *
 * Every handler under app/api is one of three things: a console route,
 * which calls permit() with the permission it needs as its first act; a
 * machine door, which authenticates an API key (authenticate from
 * lib/server/keys.ts); or one of the few routes below, open because they are
 * how a person gets a session in the first place. tests/routes.test.ts holds
 * every handler to that, so a new route cannot ship unguarded by accident.
 * The factory's agent card was the one open route outside app/api; since
 * phase L7 (second round) the backend serves it, signed, to a registered
 * caller only (BACKEND_PATHS below).
 *
 * Paths are relative to frontend/.
 */

export const PUBLIC_ROUTES: Record<string, string> = {
  "app/api/auth/login/route.ts": "starts the sign-in; nobody has a session yet",
  "app/api/auth/callback/route.ts": "the identity provider's return leg; this is where the session is created",
  "app/api/auth/logout/route.ts": "ends whatever session the cookie names; without one there is nothing to end",
  "app/api/auth/session/route.ts": "answers who is signed in, or 401; the console's first question on every page",
};

/**
 * Route files that are machine doors: API keys, never sessions. The trigger,
 * webhook and worker doors, since phase L6 the SDK door and since phase L7
 * (second round) the A2A doors, are the backend's (BACKEND_PREFIXES below),
 * so no route file answers for them here; proxy.ts still exempts their URLs
 * from the cookie gate. The platform's own MCP server is the one left.
 */
export const MACHINE_ROUTE_PREFIXES = ["app/api/mcp/server/"];

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
 * the cookie. Phase L7 (second round) the A2A doors, whole (`/api/a2a`: the
 * signed tasks door and the card beneath it, the tool broker at
 * `/api/a2a/mcp/{agent}`, the model gateway alias at `/api/a2a/gateway/...`),
 * which are machine doors and are forwarded byte for byte
 * (PASSTHROUGH_DOORS); the peer registry (`/api/peers`, with its approve and
 * rescan doors beneath it) and the estate's breakers (`/api/breakers`, with
 * the close beneath it), console doors behind the cookie. The agent card at
 * the root is the backend's too, outside `/api` (BACKEND_PATHS). Phase L8
 * (first round) moved the eval runner to the backend: an eval is started at
 * `/api/agents/{id}/evals/run` (with the lifecycle doors beneath
 * `/api/agents`: reviews, deploy, deployments, the spine, rollback, retire,
 * the benchmark, a version's document) and read at `/api/evals/runs/{id}`,
 * the one prefix beneath `/api/evals` that is the backend's; the eval sets
 * and their history (`/api/evals` itself) stay the console's. Phase L8
 * (second round) the templates (`/api/templates`, with the certify door
 * beneath it), the deliverables (`/api/deliverables`, with one
 * deliverable's file beneath it), the registers (`/api/registers`, with a
 * register's items beneath it) and the eval sets as the backend reads them
 * (`/api/eval-sets/{id}`), every one a console door behind the cookie; the
 * canary, the lineage and an agent's eval sets travel with `/api/agents`,
 * the queue's jobs (`/api/queue/jobs`) with `/api/queue`. The console's own
 * eval-set door (`/api/evals`) is a different prefix and stays here.
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
  "/api/a2a",
  "/api/peers",
  "/api/breakers",
  "/api/evals/runs",
  "/api/templates",
  "/api/deliverables",
  "/api/registers",
  "/api/eval-sets",
];

/**
 * Paths the backend owns outside `/api` (phase L7, second round): the
 * factory's agent card at the well-known path, where a peer reads it signed
 * (the backend also serves it beneath the tasks door, at
 * `/api/a2a/.well-known/agent.json`). Exact paths: nothing else under
 * `/.well-known` is the backend's.
 */
export const BACKEND_PATHS = ["/.well-known/agent.json"];

/**
 * The A2A doors, which proxy.ts forwards byte for byte (lib/passthrough.ts)
 * rather than rewrites: everything under `/api/a2a` and the card at the
 * root. A2A is signed end to end: a request's signature covers its method,
 * its raw path and query, its body and its x-af-* headers, and the answer's
 * x-af-signature covers its status and body, so the path, query, body and
 * headers go on as received and the answer comes back as sent, never
 * re-encoded or compressed on the way. An entry matches itself and anything
 * beneath it.
 */
export const PASSTHROUGH_DOORS = ["/api/a2a", "/.well-known/agent.json"];

/** Whether proxy.ts forwards a path byte for byte (an A2A door), not by a rewrite. */
export function isPassthroughPath(pathname: string): boolean {
  return PASSTHROUGH_DOORS.some((d) => pathname === d || pathname.startsWith(`${d}/`));
}

/**
 * The doors a machine opens with an API key (or, for a webhook, the spec's
 * own secret), so the cookie gate in proxy.ts never stands in front of them:
 * the backend's trigger, webhook and worker doors; the L4 gateway, retrieval
 * and chatbot doors (application keys); the backend's SDK door (phase L6),
 * which an attached agent opens with the key scoped to it and where a
 * console session is refused; the backend's A2A doors (phase L7, second
 * round: the signed tasks door, the broker and the gateway alias with an
 * attached agent's scoped key) and the agent card at the root, which a peer
 * reads signed; the console's platform-MCP door; the external answer door,
 * which an outside participant opens with the signed link token in its path
 * (phase L5). Sign-in itself is open too, or nobody could start. An entry
 * ending in "/" matches anything beneath it; a bare entry matches itself and
 * anything beneath it. The peer registry and the breakers are a person's
 * (configure), so they are not here.
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
  "/.well-known/agent.json",
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

/** Whether a URL path is one the backend owns: the prefix itself, or anything beneath it, less the console's named exceptions; or one of its exact paths outside `/api`. */
export function isBackendPath(pathname: string): boolean {
  if (BACKEND_PATHS.includes(pathname)) return true;
  if (CONSOLE_UNDER_BACKEND.includes(pathname)) return false;
  return BACKEND_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export type Upstream = { to: "backend"; url: string } | { to: "runtime"; url: string } | { to: "next" };

/**
 * Where proxy.ts sends an API request (or one of the backend's paths outside
 * `/api`, the agent card). Pure: the environment comes in as arguments so
 * the decision can be tested without one.
 *
 * - A backend-owned path goes to BACKEND_ORIGIN when that is set, whatever
 *   RUNTIME_ORIGIN says.
 * - Otherwise, with RUNTIME_ORIGIN set (the Vercel console), every API path
 *   and the agent card go to the control plane behind the tunnel.
 * - Otherwise the request is answered by this Next server; every other page
 *   path always is.
 *
 * The URL is the origin with the path and query concatenated as received:
 * never decoded, never rebuilt from parts.
 */
export function upstreamFor(pathname: string, search: string, env: { backendOrigin?: string; runtimeOrigin?: string }): Upstream {
  if (!pathname.startsWith("/api/") && !BACKEND_PATHS.includes(pathname)) return { to: "next" };
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
