import * as oidc from "openid-client";
import { CALLBACK_URL, IAP_HEADER, RESOURCE, SCOPE, authEvent, createIapSession, defaultRole, iapEnabled, loginCookie, provider, sessionCookie, ssoEnabled, verifyIap } from "@/lib/server/auth";
import { dbReady } from "@/lib/server/db";

/**
 * Start a sign-in: PKCE verifier, state and nonce go into a short-lived
 * signed cookie with where to return to, and the browser is sent to the
 * identity provider. Every request here is a fresh authorization, which is
 * what the "no access" page's button relies on.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Google IAP has already signed the person in: read who they are from its
 * signed header, create the session, and send them on. A request that
 * arrives without the header did not come through IAP, and is told so.
 */
async function iapSignIn(req: Request, next: string): Promise<Response> {
  const go = (location: string, cookie?: string) => {
    const headers = new Headers({ location, "cache-control": "no-store" });
    if (cookie) headers.append("set-cookie", cookie);
    return new Response(null, { status: 302, headers });
  };
  const assertion = req.headers.get(IAP_HEADER);
  if (!assertion) {
    await authEvent("denied", null, null, { stage: "iap", error: "no IAP assertion on the request" });
    return go("/no-access?reason=iap-missing");
  }
  let who;
  try {
    who = await verifyIap(assertion);
  } catch (e) {
    await authEvent("denied", null, null, { stage: "iap", error: String((e as Error).message ?? e).slice(0, 300) });
    return go("/no-access?reason=iap-invalid");
  }
  if (!(await dbReady())) {
    await authEvent("provision_failed", who.sub, who.email || null, { error: "registry database unreachable" });
    return go("/no-access?reason=provisioning");
  }
  let made;
  try {
    made = await createIapSession(who);
  } catch (e) {
    await authEvent("provision_failed", who.sub, who.email || null, { error: String((e as Error).message ?? e).slice(0, 300) });
    return go("/no-access?reason=provisioning");
  }
  if (!made.appRoles.length) await authEvent("denied", who.sub, who.email || null, { note: "no role mapped for this person; default role applied", role: defaultRole(), via: "iap" });
  await authEvent("sign_in", who.sub, who.email || null, { app_roles: made.appRoles, via: "iap" });
  return go(next, await sessionCookie(made.id, made.expiresAt));
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = url.searchParams.get("next") ?? "/overview";
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/overview";
  if (iapEnabled()) return iapSignIn(req, safeNext);
  if (!ssoEnabled()) {
    return Response.json({ error: "Sign-in is not configured on this deployment: set IAP_AUDIENCE (Google IAP) or AUTOX_CLIENT_ID and AUTOX_CLIENT_SECRET, with AUTH_SECRET." }, { status: 503 });
  }

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
