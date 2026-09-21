import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, readSessionCookie } from "@/lib/auth-cookie";

/**
 * The seam between the console and the control plane.
 *
 * Two deployments share this file and pick a mode from the environment:
 *
 *   RUNTIME_ORIGIN set (Vercel): every /api request is proxied to the
 *   control plane behind the tunnel, at request time, with the shared secret
 *   attached. The pages stay same-origin and unchanged.
 *
 *   RUNTIME_KEY set, no origin (the container): every /api request must carry
 *   that secret, except the trigger endpoint, which has its own API keys and
 *   is the one door external systems are meant to use. With neither set the
 *   API is open, which is right for a laptop and wrong for anything public.
 *
 * With AUTH_SECRET set, sign-in is on: a page needs a valid session cookie
 * or is sent to /login, and a console API route needs it or answers 401.
 * The cookie is verified here without a database (an HMAC over id and
 * expiry), which is what lets the Vercel side decide before proxying. The
 * machine doors keep their own API keys and stay outside the sign-in.
 */

const ORIGIN = process.env.RUNTIME_ORIGIN?.replace(/\/+$/, "") ?? "";
const KEY = process.env.RUNTIME_KEY ?? "";
const HEADER = "x-runtime-key";
const AUTH_SECRET = process.env.AUTH_SECRET ?? "";
const INTERNAL_HEADER = "x-internal-auth";
const PUBLIC_ORIGIN = (process.env.NEXT_PUBLIC_ORIGIN ?? process.env.PUBLIC_ORIGIN ?? "https://agentfactory.autogrc.cloud").replace(/\/+$/, "");

const MACHINE_DOORS = ["/api/trigger/", "/api/sdk/", "/api/sdk", "/api/a2a", "/api/mcp/server", "/api/auth/"];
const OPEN_PAGES = ["/", "/login", "/no-access"];
const OPEN_PREFIXES = ["/_next/", "/logos/", "/media/", "/.well-known/", "/favicon.ico", "/icon.svg"];

function machineDoor(pathname: string): boolean {
  return MACHINE_DOORS.some((d) => (d.endsWith("/") ? pathname.startsWith(d) : pathname === d || pathname.startsWith(`${d}/`)));
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (AUTH_SECRET && !(isApi && machineDoor(pathname)) && request.headers.get(INTERNAL_HEADER) !== AUTH_SECRET) {
    const open = !isApi && (OPEN_PAGES.includes(pathname) || OPEN_PREFIXES.some((p) => pathname.startsWith(p)));
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

  if (!isApi) return NextResponse.next();

  if (ORIGIN) {
    const target = new URL(`${pathname}${search}`, `${ORIGIN}/`);
    const headers = new Headers(request.headers);
    if (KEY) headers.set(HEADER, KEY);
    headers.delete("host");
    return NextResponse.rewrite(target, { request: { headers } });
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
