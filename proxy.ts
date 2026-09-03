import { NextResponse, type NextRequest } from "next/server";

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
 */

const ORIGIN = process.env.RUNTIME_ORIGIN?.replace(/\/+$/, "") ?? "";
const KEY = process.env.RUNTIME_KEY ?? "";
const HEADER = "x-runtime-key";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

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
  matcher: "/api/:path*",
};
