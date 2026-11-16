import { iapEnabled, session, signInOn } from "@/lib/server/auth";
import { clearSessionCookie } from "@/lib/server/auth";

/**
 * The signed-in person, for the console: identity, roles in this app, the
 * permissions they map to, and whether the session needs a fresh sign-in.
 * Refreshes the access token first when it is about to lapse.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const s = await session(req);
  if (!s) return Response.json({ signedIn: false, sso: signInOn() }, { status: 401, headers: { "cache-control": "no-store" } });
  if (s.reauth) return Response.json({ signedIn: false, reauth: true, sso: true }, { status: 401, headers: { "set-cookie": clearSessionCookie(), "cache-control": "no-store" } });
  return Response.json(
    {
      signedIn: true,
      sso: s.mode === "sso",
      mode: s.mode,
      via: s.via ?? null,
      // Behind IAP, signing out of the console alone signs straight back in; the button is offered only when the deployment names where IAP's own sign-out is.
      canSignOut: s.mode === "sso" && (!iapEnabled() || Boolean(process.env.IAP_SIGNOUT_URL)),
      sub: s.sub,
      name: s.name,
      email: s.email,
      initials: s.initials,
      orgType: s.orgType,
      isEy: s.isEy,
      roles: s.roles,
      appRoles: s.appRoles,
      groups: s.groups,
      permissions: s.permissions,
      demoDefaultApplied: s.demoDefaultApplied,
      disabled: s.disabled,
      accessExpiresAt: s.accessExpiresAt,
      expiresAt: s.expiresAt,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
