import * as oidc from "openid-client";
import { CALLBACK_URL, RESOURCE, authEvent, clearLoginCookie, createSession, provision, provider, readLoginCookie, sessionCookie, ssoEnabled, type IdClaims } from "@/lib/server/auth";
import { dbReady } from "@/lib/server/db";
import { PUBLIC_ORIGIN } from "@/lib/site";

/**
 * The return from the identity provider. The code is exchanged with the
 * resource indicator on this leg too, so the access token is a JWT that
 * carries the person's roles in this application; the ID token is verified
 * against the nonce the sign-in stored; the person is provisioned by `sub`;
 * the session is created and its cookie set on the console's origin.
 *
 * Three failures get three different pages, as the guide requires: not
 * assigned, provisioning failed, and the plain sign-in error.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function to(path: string, extra: Record<string, string> = {}): Response {
  return new Response(null, { status: 302, headers: { location: `${PUBLIC_ORIGIN}${path}`, "cache-control": "no-store", ...extra } });
}

export async function GET(req: Request) {
  if (!ssoEnabled()) return to("/login?error=unconfigured");
  const pending = await readLoginCookie(req);
  if (!pending) return to("/login?error=expired", { "set-cookie": clearLoginCookie() });

  const incoming = new URL(req.url);
  const current = new URL(`${CALLBACK_URL}${incoming.search}`);
  let claims: IdClaims;
  let tokens: Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;
  try {
    const cfg = await provider();
    tokens = await oidc.authorizationCodeGrant(
      cfg,
      current,
      { pkceCodeVerifier: pending.v, expectedState: pending.s, expectedNonce: pending.n, idTokenExpected: true },
      { resource: RESOURCE },
    );
    const c = tokens.claims();
    if (!c?.sub) throw new Error("the ID token carried no subject");
    claims = c as unknown as IdClaims;
  } catch (e) {
    await authEvent("denied", null, null, { stage: "token", error: String((e as Error).message ?? e).slice(0, 300) });
    return to(`/login?error=${encodeURIComponent("exchange")}`, { "set-cookie": clearLoginCookie() });
  }

  if (!(await dbReady())) {
    await authEvent("provision_failed", claims.sub, claims.email ?? null, { error: "registry database unreachable" });
    return to("/no-access?reason=provisioning", { "set-cookie": clearLoginCookie() });
  }
  try {
    await provision(claims);
  } catch (e) {
    await authEvent("provision_failed", claims.sub, claims.email ?? null, { error: String((e as Error).message ?? e).slice(0, 300) });
    return to("/no-access?reason=provisioning", { "set-cookie": clearLoginCookie() });
  }

  const made = await createSession(claims, { id_token: tokens.id_token ?? "", access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_in: tokens.expiresIn() });
  const demo = process.env.AUTH_DEMO_DEFAULT_ROLE ?? "";
  if (!made.appRoles.length) {
    if (demo) {
      await authEvent("denied", claims.sub, claims.email ?? null, { note: "no app roles in the access token; demo default role applied", role: demo, jwt: made.jwt });
    } else {
      await authEvent("denied", claims.sub, claims.email ?? null, { note: "no app roles in the access token", jwt: made.jwt });
      return to("/no-access?reason=unassigned", { "set-cookie": clearLoginCookie() });
    }
  }
  await authEvent("sign_in", claims.sub, claims.email ?? null, { app_roles: made.appRoles, jwt: made.jwt, refresh: Boolean(tokens.refresh_token) });

  const headers = new Headers({ location: `${PUBLIC_ORIGIN}${pending.next}`, "cache-control": "no-store" });
  headers.append("set-cookie", await sessionCookie(made.id, made.expiresAt));
  headers.append("set-cookie", clearLoginCookie());
  return new Response(null, { status: 302, headers });
}
