import { dbReady, query } from "@/lib/server/db";
import { isSelf, permit, session as whoIs, signer, ssoEnabled } from "@/lib/server/auth";
import { PERMISSIONS, PERMISSION_META, ROLE_PERMISSIONS, permissionsFor } from "@/lib/permissions";

/**
 * People on this deployment: everyone the SSO has signed in, provisioned by
 * `sub`. Until the SSO integration lands (see SSO_PLAN.md) the table is
 * empty and the response says so, rather than showing a pretend directory.
 * The role-to-permission mapping is included because it is the platform's
 * own; the roles themselves are assigned in the identity provider.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UserRow extends Record<string, unknown> {
  sub: string; email: string; email_verified: boolean; name: string; preferred_username: string; org_type: string; is_ey_employee: boolean;
  orgs: unknown; last_roles: unknown; last_app_roles: unknown; first_seen: string; last_seen: string; disabled_at: string | null; disabled_by: string | null; sessions: string;
}

export async function GET(req: Request) {
  { const gate = await permit(req, "iam"); if (gate) return gate; }
  const sso = {
    configured: Boolean(process.env.AUTOX_CLIENT_ID && process.env.AUTOX_CLIENT_SECRET),
    issuer: process.env.AUTOX_ISSUER ?? "https://sso.autogrc.cloud",
    demo_default_role: process.env.AUTH_DEMO_DEFAULT_ROLE ?? "",
  };
  const roles = Object.entries(ROLE_PERMISSIONS).map(([role, perms]) => ({ role, permissions: perms }));
  const meta = PERMISSIONS.map((p) => ({ permission: p, means: PERMISSION_META[p] }));
  if (!(await dbReady())) return Response.json({ users: [], events: [], sso, roles, permissions: meta, store: "db unreachable" });
  const users = await query<UserRow>(
    `SELECT u.*, (SELECT count(*) FROM sessions s WHERE s.sub = u.sub AND s.expires_at > now()) AS sessions
       FROM users u ORDER BY last_seen DESC`,
  );
  const events = await query<{ id: number; at: string; kind: string; sub: string | null; email: string | null; detail: unknown }>(
    "SELECT id, at, kind, sub, email, detail FROM auth_events ORDER BY at DESC LIMIT 50",
  );
  return Response.json({
    users: users.map((u) => {
      const appRoles = Array.isArray(u.last_app_roles) ? u.last_app_roles.map(String) : [];
      return {
        ...u,
        sessions: Number(u.sessions),
        last_app_roles: appRoles,
        last_roles: Array.isArray(u.last_roles) ? u.last_roles.map(String) : [],
        permissions: permissionsFor(appRoles, sso.demo_default_role),
      };
    }),
    events,
    sso,
    roles,
    permissions: meta,
    store: "db",
  });
}

/** The platform's own "access disabled", enforced after sign-in with a specific message. */
export async function PATCH(req: Request) {
  { const gate = await permit(req, "iam"); if (gate) return gate; }
  let body: { sub?: string; disabled?: boolean; by?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected {sub, disabled, by?}" }, { status: 400 });
  }
  const sub = String(body.sub ?? "");
  if (!sub || typeof body.disabled !== "boolean") return Response.json({ error: "send sub and disabled: true|false" }, { status: 400 });
  if (!(await dbReady())) return Response.json({ error: "the registry database is unreachable" }, { status: 503 });
  const me = await whoIs(req);
  // Nobody changes their own access: an administrator who could disable
  // themselves could also re-enable themselves, and neither should be a
  // one-person act. Another administrator does it, and the record says who.
  if (isSelf(me, sub)) return Response.json({ error: "you cannot change your own access; another administrator must do it" }, { status: 403 });
  const by = (ssoEnabled() && me && me.mode === "sso" ? signer(me) : String(body.by ?? "console")).slice(0, 120);
  const rows = await query<{ sub: string; disabled_at: string | null }>(
    body.disabled
      ? "UPDATE users SET disabled_at = now(), disabled_by = $2 WHERE sub = $1 RETURNING sub, disabled_at"
      : "UPDATE users SET disabled_at = NULL, disabled_by = NULL WHERE sub = $1 AND $2 = $2 RETURNING sub, disabled_at",
    [sub, by],
  );
  if (!rows.length) return Response.json({ error: "no such user" }, { status: 404 });
  if (body.disabled) await query("DELETE FROM sessions WHERE sub = $1", [sub]);
  await query("INSERT INTO auth_events (kind, sub, detail) VALUES ($1, $2, $3)", [body.disabled ? "disabled" : "enabled", sub, JSON.stringify({ by })]);
  return Response.json({ user: rows[0] });
}


/** Sign a person out everywhere: their sessions go; their record and roles stay. */
export async function DELETE(req: Request) {
  { const gate = await permit(req, "iam"); if (gate) return gate; }
  const sub = new URL(req.url).searchParams.get("sub") ?? "";
  if (!sub) return Response.json({ error: "which user?" }, { status: 400 });
  if (!(await dbReady())) return Response.json({ error: "the registry database is unreachable" }, { status: 503 });
  const me = await whoIs(req);
  if (isSelf(me, sub)) return Response.json({ error: "to end your own sessions, use Sign out in the header" }, { status: 403 });
  const rows = await query<{ id: string }>("DELETE FROM sessions WHERE sub = $1 RETURNING id", [sub]);
  await query("INSERT INTO auth_events (kind, sub, detail) VALUES ('sign_out', $1, $2)", [sub, JSON.stringify({ by: me ? signer(me) : "console", everywhere: true, sessions: rows.length })]);
  return Response.json({ signedOut: rows.length });
}
