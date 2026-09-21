import * as oidc from "openid-client";
import { CALLBACK_URL, RESOURCE, SCOPE, loginCookie, provider, ssoEnabled } from "@/lib/server/auth";

/**
 * Start a sign-in: PKCE verifier, state and nonce go into a short-lived
 * signed cookie with where to return to, and the browser is sent to the
 * identity provider. Every request here is a fresh authorization, which is
 * what the "no access" page's button relies on.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!ssoEnabled()) {
    return Response.json({ error: "Sign-in is not configured on this deployment: set AUTOX_CLIENT_ID, AUTOX_CLIENT_SECRET and AUTH_SECRET." }, { status: 503 });
  }
  const url = new URL(req.url);
  const next = url.searchParams.get("next") ?? "/control";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/control";

  const verifier = oidc.randomPKCECodeVerifier();
  const challenge = await oidc.calculatePKCECodeChallenge(verifier);
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();

  const cfg = await provider();
  const target = oidc.buildAuthorizationUrl(cfg, {
    redirect_uri: CALLBACK_URL,
    scope: SCOPE,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    nonce,
    prompt: "consent",
    resource: RESOURCE,
  });

  return new Response(null, {
    status: 302,
    headers: { location: target.href, "set-cookie": await loginCookie({ v: verifier, s: state, n: nonce, next: safeNext }), "cache-control": "no-store" },
  });
}
