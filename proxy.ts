import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readSessionCookie } from "@/lib/auth-cookie";
import { isMachineDoor, isOpenPage, isPassthroughPath, upstreamFor } from "@/lib/route-policy";
import { passthrough } from "@/lib/passthrough";

/**
 * The seam between the console and the control plane.
 *
 * Three variables shape it, and every deployment sets some of them:
 *
 *   BACKEND_ORIGIN set: the API paths the backend owns (BACKEND_PREFIXES in
 *   lib/route-policy.ts: runs, approvals, agents, authoring, drafts, roster,
 *   keys, attached agents, IAM, the vault, the trigger, webhook, queue and
 *   worker doors, the applications register with its gateway, retrieval and
 *   chatbot doors, the attention, fleet, lockdown and external answer doors,
 *   the MCP registry (not the platform's own MCP server at /api/mcp/server,
 *   which stays here), the SDK door, the ports' health doors, the L7 doors
 *   (the dependency map, drift, the guardian, the peer registry, the
 *   estate's breakers, and the A2A doors with the agent card at
 *   /.well-known/agent.json), the L8 doors (the eval runner's reads at
 *   /api/evals/runs, the templates, the deliverables, the registers and the
 *   eval sets at /api/eval-sets; the lifecycle, canary and lineage doors
 *   travel with /api/agents), and the health check) are forwarded
 *   there at request time, with the shared secret attached and the session
 *   cookie forwarded. This happens before, and independently of, the
 *   RUNTIME_ORIGIN rewrite below. The local backend is `http://localhost:8000`
 *   (backend/CONTRACT.md). Without BACKEND_ORIGIN those paths have no
 *   answer here: the console serves pages and the domains that have not
 *   moved yet (frontend/README.md lists them).
 *
 *   The A2A doors (PASSTHROUGH_DOORS) are signed end to end, so they are
 *   not rewritten: lib/passthrough.ts sends the path, query, body and
 *   headers on as received and the signed answer back as sent, uncompressed.
 *
 *   RUNTIME_ORIGIN set (Vercel): every other /api request is proxied to the
 *   control plane behind the tunnel, at request time, with the shared secret
 *   attached. The pages stay same-origin and unchanged.
 *
 *   RUNTIME_KEY set, no origin (the container): every /api request must carry
 *   that secret, except the trigger endpoint, which has its own API keys and
 *   is the one door external systems are meant to use. With neither origin
 *   nor key set the API is open, which is right for a laptop and wrong for
 *   anything public.
 *
 * With AUTH_SECRET set, sign-in is on: a page needs a valid session cookie
 * or is sent to /login, and a console API route needs it or answers 401.
 * The cookie is verified here without a database (an HMAC over id and
 * expiry), which is what lets the Vercel side decide before proxying. The
 * machine doors keep their own API keys and stay outside the sign-in. The
 * backend verifies the same cookie again and loads the session itself.
 */

const ORIGIN = process.env.RUNTIME_ORIGIN?.replace(/\/+$/, "") ?? "";
const BACKEND = process.env.BACKEND_ORIGIN?.replace(/\/+$/, "") ?? "";
const KEY = process.env.RUNTIME_KEY ?? "";
const HEADER = "x-runtime-key";
const AUTH_SECRET = process.env.AUTH_SECRET ?? "";
const INTERNAL_HEADER = "x-internal-auth";
const PUBLIC_ORIGIN = (process.env.NEXT_PUBLIC_ORIGIN ?? process.env.PUBLIC_ORIGIN ?? "https://agentfactory.autogrc.cloud").replace(/\/+$/, "");

// The doors a machine opens with an API key (or, for a webhook, the spec's
// own secret; for the external answer door, the signed link token; for the
// A2A doors, a signature under a shared secret), so the cookie gate never
// stands in front of them: the backend's trigger, webhook and worker doors,
// the L4 gateway, retrieval and chatbot doors (application keys), the L5
// answer door, the L6 SDK door (an attached agent's scoped key), the L7 A2A
// doors and the agent card at the root, and the console's platform-MCP door.
// The list is MACHINE_DOORS in lib/route-policy.ts, so tests/proxy.test.ts
// holds it. Sign-in itself is open too, or nobody could start; so is the
// external answer page, which is where that token is used (OPEN_PAGES and
// OPEN_PREFIXES there, held by the same test).

const machineDoor = isMachineDoor;

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (AUTH_SECRET && !machineDoor(pathname) && request.headers.get(INTERNAL_HEADER) !== AUTH_SECRET) {
    const open = !isApi && isOpenPage(pathname);
    if (!open) {
      const cookie = await readSessionCookie(request.cookies.get(SESSION_COOKIE)?.value, AUTH_SECRET);
      if (!cookie) {
        if (isApi) return NextResponse.json({ error: "sign in to continue", reauth: true }, { status: 401 });
        const to = new URL("/login", request.url);
        to.searchParams.set("next", `${pathname}${search}`);
        return NextResponse.redirect(to);
      }
      // A cookie-authenticated write must come from the console's own origin.
      // SameSite=Lax already withholds the cookie from cross-site posts; this
      // is the second lock on the same door.
      if (isApi && request.method !== "GET" && request.method !== "HEAD") {
        const origin = request.headers.get("origin") ?? "";
        const allowed = [PUBLIC_ORIGIN, `${request.nextUrl.protocol}//${request.headers.get("host") ?? request.nextUrl.host}`];
        if (origin && !allowed.includes(origin.replace(/\/+$/, ""))) {
          return NextResponse.json({ error: "cross-origin writes are refused" }, { status: 403 });
        }
      }
    }
  }

  // The path router: a backend-owned path to BACKEND_ORIGIN, else everything
  // to RUNTIME_ORIGIN when that is set. Either way the request's own headers
  // travel (the session cookie among them) with the runtime key added. The
  // agent card is the one page path that is routed; every other page is
  // served here.
  const upstream = upstreamFor(pathname, search, { backendOrigin: BACKEND, runtimeOrigin: ORIGIN });
  if (!isApi && upstream.to === "next") return NextResponse.next();
  if (upstream.to !== "next") {
    // A2A is signed end to end: forwarded byte for byte, never rewritten.
    if (isPassthroughPath(pathname)) return passthrough(request, upstream.url, { key: KEY, keyHeader: HEADER });
    const headers = new Headers(request.headers);
    if (KEY) headers.set(HEADER, KEY);
    headers.delete("host");
    return NextResponse.rewrite(new URL(upstream.url), { request: { headers } });
  }

  if (KEY && !pathname.startsWith("/api/trigger/")) {
    const presented = request.headers.get(HEADER) ?? "";
    if (presented !== KEY) {
      return NextResponse.json(
        { error: "this control plane is reachable only through its console; the trigger endpoint accepts API keys" },
        { status: 401 },
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/((?!_next/|logos/|media/|favicon.ico|icon.svg).*)"],
};
