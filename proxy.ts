import { NextResponse, type NextRequest } from "next/server";
import { PUBLIC_ORIGIN } from "@/lib/site";

/**
 * The seam between the console and the platform's service.
 *
 * This server serves the pages and nothing else. Every /api request, and the
 * agent card at /.well-known/agent.json, goes to the service at
 * BACKEND_ORIGIN with its headers unchanged, the signed assertion Google
 * Identity-Aware Proxy adds (x-goog-iap-jwt-assertion) among them. The
 * service verifies that assertion on every request against its own
 * IAP_AUDIENCE, decides who the person is and what they may do, and answers
 * sign-in itself (/api/auth/session, /api/auth/login). Nothing is decided
 * here and no session is kept here.
 *
 * BACKEND_ORIGIN is read at run time. Without it every request is answered
 * 503 with the reason: there is no console-only mode.
 *
 * The one check made before forwarding: a write must come from the
 * console's own origin, since IAP's own session rides on a cookie.
 */

const BACKEND = process.env.BACKEND_ORIGIN?.replace(/\/+$/, "") ?? "";

const NOT_CONFIGURED = "This console has no service to talk to: BACKEND_ORIGIN is not set on this deployment.";

function forwardToPlatform(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "OPTIONS") {
    const origin = (request.headers.get("origin") ?? "").replace(/\/+$/, "");
    const forwardedHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? request.nextUrl.host;
    const allowed = [PUBLIC_ORIGIN, `${request.nextUrl.protocol}//${forwardedHost}`, `https://${forwardedHost}`, `http://${forwardedHost}`];
    if (origin && !allowed.includes(origin)) return NextResponse.json({ error: "cross-origin writes are refused" }, { status: 403 });
  }
  const headers = new Headers(request.headers);
  headers.delete("host");
  return NextResponse.rewrite(new URL(`${BACKEND}${pathname}${search}`), { request: { headers } });
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (!BACKEND) {
    if (isApi) return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
    return new NextResponse(NOT_CONFIGURED, { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  }

  if (isApi || pathname === "/.well-known/agent.json") return forwardToPlatform(request);
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/((?!_next/|logos/|media/|favicon.ico|icon.svg).*)"],
};
