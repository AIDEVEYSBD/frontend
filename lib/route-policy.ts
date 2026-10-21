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
