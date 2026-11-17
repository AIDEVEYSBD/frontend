import { randomBytes } from "node:crypto";
import * as oidc from "openid-client";
import { createRemoteJWKSet, jwtVerify, decodeJwt } from "jose";
import { dbReady, query } from "@/lib/server/db";
import { LOGIN_COOKIE, SESSION_COOKIE, readCookie, readSessionCookie, sign, verify } from "@/lib/auth-cookie";
import { PUBLIC_ORIGIN } from "@/lib/site";
import { CURRENT_USER } from "@/lib/user";
import { permissionsFor, type Permission } from "@/lib/permissions";
import { groupsClaimName, groupsOverage, refreshedGroups, sessionGroups } from "@/lib/sso-groups";

/**
 * Sign-in, sessions and the person behind a request.
 *
 * AutoX SSO (OpenID Connect, Authorization Code + PKCE) issues the identity;
 * this module keeps the server-side session, refreshes it, and answers the
 * one question every console route asks: who is this, and may they do that.
 *
 * Until the identity provider's credentials are configured, the console
 * runs in local mode: every request is the operator this console is issued
 * to (lib/user.ts), with every permission, and the IAM page says so. Setting
 * AUTOX_CLIENT_ID, AUTOX_CLIENT_SECRET and AUTH_SECRET switches sign-in on
 * with no other change. Nothing here caches an allow or deny verdict beyond
 * the token it came from: app roles are re-read on every refresh.
 *
 * The session also keeps the identity provider's group claims (`groups`,
 * or the claim AUTH_GROUPS_CLAIM names; lib/sso-groups.ts), which the
 * backend reads beside the roles when a gate's approvers are checked.
 *
 * Google Identity-Aware Proxy is the second way in (IAP_AUDIENCE with
 * AUTH_SECRET). IAP has already signed the person in before a request
 * reaches the console and says who they are in a signed header; the console
 * verifies that header, gives them a role from the deployment's own mapping
 * (IAP names a person, never a role) and keeps the same server-side session
 * the backend already trusts. Nothing behind the console changes.
 */

export const ISSUER = (process.env.AUTOX_ISSUER ?? "https://sso.autogrc.cloud").replace(/\/+$/, "");
export const RESOURCE = `${ISSUER}/api`;
export const CALLBACK_URL = `${PUBLIC_ORIGIN}/api/auth/callback`;
export const POST_LOGOUT_URL = `${PUBLIC_ORIGIN}/`;
export const SCOPE = "openid profile email orgs roles offline_access";
const SESSION_HOURS = 12;
const REFRESH_AHEAD_S = 60;

export function ssoEnabled(): boolean {
  return Boolean(process.env.AUTOX_CLIENT_ID && process.env.AUTOX_CLIENT_SECRET && process.env.AUTH_SECRET);
}

/* ── Google Identity-Aware Proxy ── */

/** The header IAP puts on every request it lets through: a JWT it signed, naming the person. */
export const IAP_HEADER = "x-goog-iap-jwt-assertion";
const IAP_ISSUER = "https://cloud.google.com/iap";
const IAP_KEYS = "https://www.gstatic.com/iap/verify/public_key-jwk";

/** IAP sign-in is on when the deployment names the audience its assertions carry (and can sign a session cookie). */
export function iapEnabled(): boolean {
  return Boolean(process.env.IAP_AUDIENCE && process.env.AUTH_SECRET);
}

/** Whether anyone has to sign in at all, by either way in. */
export function signInOn(): boolean {
  return ssoEnabled() || iapEnabled();
}

export interface IapIdentity { sub: string; email: string; domain: string }

let iapKeys: ReturnType<typeof createRemoteJWKSet> | null = null;

/**
 * The person an IAP assertion names, or a thrown error. Checked as Google
 * documents it: ES256, IAP's issuer, this deployment's audience (the backend
 * service or Cloud Run service IAP fronts), thirty seconds of clock skew,
 * against Google's published keys. IAP_JWKS_URL points at a mirror of those
 * keys for a network that cannot reach gstatic.com.
 */
export async function verifyIap(assertion: string): Promise<IapIdentity> {
  if (!iapKeys) iapKeys = createRemoteJWKSet(new URL(process.env.IAP_JWKS_URL || IAP_KEYS));
  const { payload } = await jwtVerify(assertion, iapKeys, {
    issuer: IAP_ISSUER,
    audience: process.env.IAP_AUDIENCE,
    algorithms: ["ES256"],
    clockTolerance: 30,
  });
  const sub = String(payload.sub ?? "");
  if (!sub) throw new Error("the assertion carried no subject");
  return { sub, email: String(payload.email ?? "").toLowerCase(), domain: String(payload.hd ?? "") };
}

/**
 * The roles a person signed in through IAP holds here. IAP_ROLE_MAP is JSON:
 * a key is an email address or "@domain", a value is a role or a list of
 * roles from lib/permissions.ts, for example
 *   {"alice@example.com": "administrator", "@example.com": ["operator"]}
 * The address wins over its domain. Someone the map does not name gets no
 * role, so the default role (viewer) is what they hold. A map that is not
 * valid JSON names nobody, which fails towards viewer, never towards more.
 */
export function iapRoles(email: string): string[] {
  let map: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(process.env.IAP_ROLE_MAP || "{}") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) map = parsed as Record<string, unknown>;
  } catch {
    /* names nobody */
  }
  const lower = Object.fromEntries(Object.entries(map).map(([k, v]) => [k.trim().toLowerCase(), v]));
  const at = email.lastIndexOf("@");
  const hit = lower[email] ?? (at >= 0 ? lower[email.slice(at)] : undefined);
  const roles = Array.isArray(hit) ? hit.map(String) : typeof hit === "string" ? [hit] : [];
  return roles.map((r) => r.trim()).filter(Boolean);
}
function secret(): string {
  return process.env.AUTH_SECRET ?? "";
}
/** Internal self-calls (the assistant, the MCP server) identify themselves with this. */
export const INTERNAL_HEADER = "x-internal-auth";
export function internalHeaders(): Record<string, string> {
  const key = process.env.RUNTIME_KEY;
  return { ...(signInOn() ? { [INTERNAL_HEADER]: secret() } : {}), ...(key ? { "x-runtime-key": key } : {}) };
}

/* ── the identity provider, discovered once ── */

let configPromise: Promise<oidc.Configuration> | null = null;
export function provider(): Promise<oidc.Configuration> {
  if (!configPromise) {
    configPromise = oidc
      .discovery(new URL(ISSUER), process.env.AUTOX_CLIENT_ID ?? "", undefined, oidc.ClientSecretPost(process.env.AUTOX_CLIENT_SECRET ?? ""))
      .catch((e) => {
        configPromise = null; // a cold identity provider is not a permanent failure
        throw e;
      });
  }
  return configPromise;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
async function appRolesFrom(accessToken: string): Promise<{ appRoles: string[]; roles: string[]; jwt: boolean; claims: Record<string, unknown> | null }> {
  // Opaque tokens are not JWTs; the guide says that is the symptom of the
  // resource indicator having reached only one leg. Recorded, not fatal.
  try {
    decodeJwt(accessToken);
  } catch {
    return { appRoles: [], roles: [], jwt: false, claims: null };
  }
  const cfg = await provider();
  const jwksUri = cfg.serverMetadata().jwks_uri;
  if (!jwks && jwksUri) jwks = createRemoteJWKSet(new URL(jwksUri));
  const { payload } = await jwtVerify(accessToken, jwks!, { issuer: ISSUER, audience: RESOURCE });
  const arr = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  // The verified payload comes back too: a provider may carry the group claims on the access token rather than the ID token.
  return { appRoles: arr(payload["autox:app_roles"]), roles: arr(payload["autox:roles"]), jwt: true, claims: payload as Record<string, unknown> };
}

/* ── events ── */

export async function authEvent(kind: string, sub: string | null, email: string | null, detail: Record<string, unknown> = {}): Promise<void> {
  if (!(await dbReady())) return;
  await query("INSERT INTO auth_events (kind, sub, email, detail) VALUES ($1,$2,$3,$4)", [kind, sub, email, JSON.stringify(detail)]).catch(() => {});
}

/* ── the login hand-off cookie ── */

export interface LoginState { v: string; s: string; n: string; next: string }

export async function loginCookie(state: LoginState): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + 300;
  const body = Buffer.from(JSON.stringify({ ...state, exp })).toString("base64url");
  const value = await sign(body, secret());
  return `${LOGIN_COOKIE}=${encodeURIComponent(value)}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=300${PUBLIC_ORIGIN.startsWith("https") ? "; Secure" : ""}`;
}

export async function readLoginCookie(req: Request): Promise<LoginState | null> {
  const raw = readCookie(req.headers.get("cookie"), LOGIN_COOKIE);
  if (!raw) return null;
  const body = await verify(raw, secret());
  if (!body) return null;
  try {
    const j = JSON.parse(Buffer.from(body, "base64url").toString()) as LoginState & { exp: number };
    if (j.exp * 1000 < Date.now()) return null;
    return j;
  } catch {
    return null;
  }
}

export function clearLoginCookie(): string {
  return `${LOGIN_COOKIE}=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/* ── sessions ── */

export interface Session {
  mode: "sso" | "local" | "internal";
  id: string;
  sub: string;
  name: string;
  email: string;
  initials: string;
  orgType: string;
  isEy: boolean;
  roles: string[];
  appRoles: string[];
  /** The identity provider's group claims, kept on the session row; roles for a gate's approvers, as app roles are. */
  groups: string[];
  permissions: Permission[];
  demoDefaultApplied: boolean;
  disabled: boolean;
  accessExpiresAt: string | null;
  expiresAt: string | null;
  reauth?: boolean;
  /** Which way the person came in, for a signed-in session: the OpenID Connect provider, or Google IAP. */
  via?: "oidc" | "iap";
}

function initialsOf(name: string, email: string): string {
  const src = name.trim() || email.split("@")[0];
  return src.split(/[\s._-]+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
}

/** With no identity provider, the operator's role can still be set for testing: AUTH_LOCAL_ROLE=viewer. */
function localSession(): Session {
  const role = process.env.AUTH_LOCAL_ROLE || "administrator";
  return {
    mode: "local",
    id: "local",
    sub: "local:operator",
    name: CURRENT_USER.name,
    email: "",
    initials: CURRENT_USER.initials,
    orgType: "",
    isEy: false,
    roles: [],
    appRoles: [role],
    groups: [],
    permissions: permissionsFor([role]),
    demoDefaultApplied: false,
    disabled: false,
    accessExpiresAt: null,
    expiresAt: null,
  };
}

function internalSession(): Session {
  return { ...localSession(), mode: "internal", id: "internal", sub: "internal:console", name: "Agent Factory console", initials: "AF", appRoles: [], permissions: ["view"] };
}

export function sessionCookie(id: string, expiresAt: Date): Promise<string> {
  const exp = Math.floor(expiresAt.getTime() / 1000);
  return sign(`${id}.${exp}`, secret()).then(
    (value) => `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, exp - Math.floor(Date.now() / 1000))}${PUBLIC_ORIGIN.startsWith("https") ? "; Secure" : ""}`,
  );
}
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${PUBLIC_ORIGIN.startsWith("https") ? "; Secure" : ""}`;
}

interface SessionRow extends Record<string, unknown> {
  id: string; sub: string; id_token: string; access_token: string; access_expires_at: string; refresh_token: string | null;
  roles: string[]; app_roles: string[]; groups?: string[]; expires_at: string; name: string; email: string; org_type: string; is_ey_employee: boolean; disabled_at: string | null;
}

/**
 * The role a signed-in person holds when nothing names one for them: none.
 * The access matrix gives this console to the platform admin and the auditor
 * only, so a person who is signed in but unassigned cannot open it.
 * AUTH_DEMO_DEFAULT_ROLE names a role for everyone unassigned, for a demo,
 * and must be unset on any client deployment. Local mode has its own default
 * (AUTH_LOCAL_ROLE, administrator) and is not affected.
 */
export function defaultRole(): string {
  return process.env.AUTH_DEMO_DEFAULT_ROLE || "";
}

function toSession(row: SessionRow, reauth = false): Session {
  const appRoles = Array.isArray(row.app_roles) ? row.app_roles : [];
  return {
    mode: "sso",
    id: row.id,
    sub: row.sub,
    name: row.name,
    email: row.email,
    initials: initialsOf(row.name, row.email),
    orgType: row.org_type,
    isEy: row.is_ey_employee,
    roles: Array.isArray(row.roles) ? row.roles : [],
    appRoles,
    groups: Array.isArray(row.groups) ? row.groups.map(String) : [],
    permissions: permissionsFor(appRoles, defaultRole()),
    demoDefaultApplied: appRoles.length === 0,
    disabled: Boolean(row.disabled_at),
    accessExpiresAt: row.access_expires_at,
    expiresAt: row.expires_at,
    reauth,
    // An IAP session holds no provider tokens: the assertion was checked at sign-in and is not kept.
    via: row.id_token ? "oidc" : "iap",
  };
}

async function loadRow(id: string): Promise<SessionRow | null> {
  const rows = await query<SessionRow>(
    `SELECT s.id, s.sub, s.id_token, s.access_token, s.access_expires_at, s.refresh_token, s.roles, s.app_roles, s.groups, s.expires_at,
            u.name, u.email, u.org_type, u.is_ey_employee, u.disabled_at
       FROM sessions s JOIN users u ON u.sub = s.sub WHERE s.id = $1 AND s.expires_at > now()`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Refresh, serialised per user across every instance: an advisory lock keyed
 * on the subject, the stored token re-read inside it, the rotated token
 * written before the lock is released. Two instances refreshing at once is
 * how a rotating refresh token gets its whole grant revoked.
 */
async function refreshRow(row: SessionRow): Promise<SessionRow | null> {
  if (!row.refresh_token) return null;
  await query("BEGIN");
  try {
    await query("SELECT pg_advisory_xact_lock(hashtext($1))", [row.sub]);
    const [fresh] = await query<SessionRow>("SELECT refresh_token, access_expires_at FROM sessions WHERE id = $1 FOR UPDATE", [row.id]);
    if (!fresh) {
      await query("COMMIT");
      return null;
    }
    if (new Date(fresh.access_expires_at).getTime() - Date.now() > REFRESH_AHEAD_S * 1000) {
      await query("COMMIT"); // another instance already refreshed
      return loadRow(row.id);
    }
    const cfg = await provider();
    const tokens = await oidc.refreshTokenGrant(cfg, fresh.refresh_token ?? row.refresh_token, { resource: RESOURCE });
    const claims = tokens.claims();
    const { appRoles, roles, claims: accessClaims } = await appRolesFrom(tokens.access_token);
    const idRoles = Array.isArray(claims?.["autox:roles"]) ? (claims!["autox:roles"] as unknown[]).map(String) : roles;
    // Groups as the new tokens carry them; neither carrying the claim keeps what sign-in stored.
    const groups = refreshedGroups(claims as Record<string, unknown> | undefined, accessClaims, groupsClaimName());
    const expires = new Date(Date.now() + (tokens.expiresIn() ?? 600) * 1000);
    await query(
      `UPDATE sessions SET access_token=$2, access_expires_at=$3, refresh_token=COALESCE($4, refresh_token), id_token=COALESCE($5, id_token), roles=$6, app_roles=$7, groups=COALESCE($8::jsonb, groups), last_seen=now() WHERE id=$1`,
      [row.id, tokens.access_token, expires.toISOString(), tokens.refresh_token ?? null, tokens.id_token ?? null, JSON.stringify(idRoles), JSON.stringify(appRoles), groups === null ? null : JSON.stringify(groups)],
    );
    await query("UPDATE users SET last_roles=$2, last_app_roles=$3, last_seen=now() WHERE sub=$1", [row.sub, JSON.stringify(idRoles), JSON.stringify(appRoles)]);
    await query("COMMIT");
    return loadRow(row.id);
  } catch (e) {
    await query("ROLLBACK").catch(() => {});
    // openid-client reports a token-endpoint refusal with a generic message
    // and the OAuth error code in `error`; the code is what decides whether
    // the grant is gone, and what makes the event readable afterwards.
    const err = e as { message?: string; error?: string; error_description?: string };
    const code = String(err.error ?? "");
    const msg = [code, err.error_description, err.message ?? String(e)].filter(Boolean).join(": ");
    await authEvent("refresh_failed", row.sub, row.email, { error: msg.slice(0, 300) });
    if (code === "invalid_grant" || /invalid_grant/i.test(msg)) {
      await query("DELETE FROM sessions WHERE id = $1", [row.id]).catch(() => {});
      return null;
    }
    // A transient failure: keep the session for what is left of the token.
    return row;
  }
}

/** The person behind a request, refreshed if their access token is about to lapse. */
export async function session(req: Request): Promise<Session | null> {
  if (!signInOn()) return localSession();
  if (req.headers.get(INTERNAL_HEADER) === secret()) return internalSession();
  const cookie = await readSessionCookie(readCookie(req.headers.get("cookie"), SESSION_COOKIE), secret());
  if (!cookie) return null;
  if (!(await dbReady())) return iapEnabled() ? iapHeaderSession(req, cookie) : null;
  let row = await loadRow(cookie.id);
  if (!row) return null;
  if (new Date(row.access_expires_at).getTime() - Date.now() < REFRESH_AHEAD_S * 1000) {
    const refreshed = await refreshRow(row);
    if (!refreshed) return { ...toSession(row, true), permissions: [] };
    row = refreshed;
  } else {
    query("UPDATE sessions SET last_seen = now() WHERE id = $1", [row.id]).catch(() => {});
  }
  return toSession(row);
}

/**
 * The session, or a Response to send back instead: 401 when nobody is
 * signed in (with `reauth` when the session died under them), 403 when the
 * person may not do this. Routes `throw` the response.
 */
export async function requirePermission(req: Request, permission: Permission): Promise<Session> {
  const s = await session(req);
  if (!s) throw Response.json({ error: "sign in to continue", reauth: true }, { status: 401 });
  if (s.reauth) throw Response.json({ error: "your session ended; sign in again", reauth: true }, { status: 401 });
  if (s.disabled) throw Response.json({ error: "your access to Agent Factory is disabled", disabled: true }, { status: 403 });
  if (!s.permissions.includes(permission)) {
    throw Response.json({ error: `this needs the "${permission}" permission; your roles: ${s.appRoles.join(", ") || "none"}` }, { status: 403 });
  }
  return s;
}

/**
 * The Response to send instead when the request may not proceed, else null.
 *
 * Every privileged call leaves a record: a mutating request that passes is
 * written as an `action` with who, what and where; a refusal is written as
 * `forbidden`. That is the audit trail the IAM page shows, and the reason a
 * reviewer can answer "who changed this" without reading server logs.
 */
export async function permit(req: Request, permission: Permission): Promise<Response | null> {
  const path = new URL(req.url).pathname;
  const mutating = req.method !== "GET" && req.method !== "HEAD";
  try {
    const s = await requirePermission(req, permission);
    if (mutating && s.mode !== "internal") {
      void authEvent("action", s.sub, s.email || null, { actor: signer(s), method: req.method, path, permission, mode: s.mode });
    }
    return null;
  } catch (e) {
    if (e instanceof Response) {
      if (e.status === 403) {
        const s = await session(req).catch(() => null);
        void authEvent("forbidden", s?.sub ?? null, s?.email || null, { actor: s ? signer(s) : "anonymous", method: req.method, path, permission, roles: s?.appRoles ?? [] });
      }
      return e;
    }
    throw e;
  }
}

/** Whether a request's subject is the person named: the one change nobody may make to themselves. */
export function isSelf(s: Session | null, sub: string): boolean {
  return Boolean(s && s.sub === sub);
}

/** Run a handler under a permission; a thrown Response is returned as the answer. */
export async function guarded(req: Request, permission: Permission, fn: (s: Session) => Promise<Response>): Promise<Response> {
  try {
    const s = await requirePermission(req, permission);
    return await fn(s);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

/** Who signed something, for records: the SSO identity when there is one. */
export function signer(s: Session): string {
  return s.email ? `${s.name || s.email} <${s.email}>` : s.name;
}

/* ── the callback's provisioning ── */

export interface IdClaims {
  sub: string; email?: string; email_verified?: boolean; name?: string; preferred_username?: string;
  "autox:org_type"?: string; "autox:is_ey_employee"?: boolean; "autox:orgs"?: unknown[]; "autox:roles"?: unknown[];
}

/** Provision by `sub`, re-link a verified email's retired row, else create. Never a gate. */
export async function provision(c: IdClaims): Promise<void> {
  const email = String(c.email ?? "");
  const verified = c.email_verified === true;
  const roles = Array.isArray(c["autox:roles"]) ? c["autox:roles"].map(String) : [];
  const orgs = Array.isArray(c["autox:orgs"]) ? c["autox:orgs"] : [];
  const fields = [c.sub, email, verified, String(c.name ?? ""), String(c.preferred_username ?? ""), String(c["autox:org_type"] ?? ""), c["autox:is_ey_employee"] === true, JSON.stringify(orgs), JSON.stringify(roles)];
  const [existing] = await query<{ sub: string }>("SELECT sub FROM users WHERE sub = $1", [c.sub]);
  if (existing) {
    await query(
      `UPDATE users SET email=$2, email_verified=$3, name=$4, preferred_username=$5, org_type=$6, is_ey_employee=$7, orgs=$8, last_roles=$9, last_seen=now() WHERE sub=$1`,
      fields,
    );
    return;
  }
  if (email && verified) {
    const [same] = await query<{ sub: string }>("SELECT sub FROM users WHERE lower(email) = lower($1) AND sub <> $2 ORDER BY last_seen DESC LIMIT 1", [email, c.sub]);
    if (same) {
      await query("DELETE FROM sessions WHERE sub = $1", [same.sub]);
      await query(
        `UPDATE users SET sub=$1, email=$2, email_verified=$3, name=$4, preferred_username=$5, org_type=$6, is_ey_employee=$7, orgs=$8, last_roles=$9, last_seen=now() WHERE sub=$10`,
        [...fields, same.sub],
      );
      await authEvent("relinked", c.sub, email, { from: same.sub, to: c.sub });
      return;
    }
  }
  await query(
    `INSERT INTO users (sub, email, email_verified, name, preferred_username, org_type, is_ey_employee, orgs, last_roles) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    fields,
  );
}

export async function createSession(
  c: IdClaims,
  tokens: { id_token: string; access_token: string; refresh_token?: string; expires_in?: number },
): Promise<{ id: string; expiresAt: Date; appRoles: string[]; jwt: boolean; groups: string[]; groupsClaim: string; groupsOverage: boolean }> {
  const id = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000);
  const { appRoles, roles, jwt, claims: accessClaims } = await appRolesFrom(tokens.access_token).catch(() => ({ appRoles: [] as string[], roles: [] as string[], jwt: false, claims: null }));
  const idRoles = Array.isArray(c["autox:roles"]) ? c["autox:roles"].map(String) : roles;
  // Role routing (plan L5): the provider's group claims, from either token, beside the roles; roles and app roles stay as they are.
  const claim = groupsClaimName();
  const idClaims = c as unknown as Record<string, unknown>;
  const groups = sessionGroups(idClaims, accessClaims, claim);
  const overage = groupsOverage(idClaims, claim) || groupsOverage(accessClaims, claim);
  await query(
    `INSERT INTO sessions (id, sub, id_token, access_token, access_expires_at, refresh_token, roles, app_roles, groups, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, c.sub, tokens.id_token, tokens.access_token, new Date(Date.now() + (tokens.expires_in ?? 600) * 1000).toISOString(), tokens.refresh_token ?? null, JSON.stringify(idRoles), JSON.stringify(appRoles), JSON.stringify(groups), expiresAt.toISOString()],
  );
  await query("UPDATE users SET last_app_roles = $2 WHERE sub = $1", [c.sub, JSON.stringify(appRoles)]);
  return { id, expiresAt, appRoles, jwt, groups, groupsClaim: claim, groupsOverage: overage };
}

/** A readable name from an address: "asha.rao@example.com" is "Asha Rao". */
function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  return local.split(/[._-]+/).filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");
}

/**
 * Behind IAP with no registry database (a console deployed on its own): the
 * person is read from the assertion IAP sends on every request, verified each
 * time, and their roles from the deployment's mapping at that moment. No row
 * is kept, so there is nothing to revoke here: access ends when IAP stops
 * letting the person through, or when the mapping changes. The cookie only
 * says a sign-in happened, which is what the page gate reads.
 */
async function iapHeaderSession(req: Request, cookie: { id: string; exp: number }): Promise<Session | null> {
  const assertion = req.headers.get(IAP_HEADER);
  if (!assertion) return null;
  let who: IapIdentity;
  try {
    who = await verifyIap(assertion);
  } catch {
    return null;
  }
  const appRoles = iapRoles(who.email);
  const name = nameFromEmail(who.email) || who.sub;
  const expiresAt = new Date(cookie.exp * 1000).toISOString();
  return {
    mode: "sso",
    id: cookie.id,
    sub: who.sub,
    name,
    email: who.email,
    initials: initialsOf(name, who.email),
    orgType: who.domain,
    isEy: false,
    roles: [],
    appRoles,
    groups: [],
    permissions: permissionsFor(appRoles, defaultRole()),
    demoDefaultApplied: appRoles.length === 0,
    disabled: false,
    accessExpiresAt: expiresAt,
    expiresAt,
    via: "iap",
  };
}

/** The cookie for a sign-in that keeps no row (see iapHeaderSession). */
export function createRowlessIapSession(who: IapIdentity): { id: string; expiresAt: Date; appRoles: string[] } {
  return { id: randomBytes(32).toString("hex"), expiresAt: new Date(Date.now() + SESSION_HOURS * 3600 * 1000), appRoles: iapRoles(who.email) };
}

/**
 * A session for a person IAP has signed in. The user row is provisioned as
 * for any sign-in; the session row holds no provider tokens and no refresh
 * token, and its "access" lapses with the session itself, so when it ends
 * the next request simply signs in again from the assertion IAP is still
 * sending. Roles are read from the deployment's mapping at this moment.
 */
export async function createIapSession(who: IapIdentity): Promise<{ id: string; expiresAt: Date; appRoles: string[] }> {
  const name = nameFromEmail(who.email);
  await provision({ sub: who.sub, email: who.email, email_verified: Boolean(who.email), name, preferred_username: who.email, "autox:org_type": who.domain });
  const id = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000);
  const appRoles = iapRoles(who.email);
  await query(
    `INSERT INTO sessions (id, sub, id_token, access_token, access_expires_at, refresh_token, roles, app_roles, groups, expires_at) VALUES ($1,$2,'','',$3,NULL,'[]',$4,'[]',$3)`,
    [id, who.sub, expiresAt.toISOString(), JSON.stringify(appRoles)],
  );
  await query("UPDATE users SET last_app_roles = $2 WHERE sub = $1", [who.sub, JSON.stringify(appRoles)]);
  return { id, expiresAt, appRoles };
}
