/**
 * Group claims from the identity provider, for role routing (plan L5:
 * approvers are roles resolved from SSO groups).
 *
 * A gate names roles, never people. The backend checks a person against a
 * gate's approvers with the session's app roles, its role claims and its
 * group claims together (backend/app/auth.py `roles_of`, reading the
 * `sessions.groups` column), so a group the identity provider puts a person
 * in (`dlp-leads`, `risk-office`) can answer a gate that names it. The
 * console writes that column when the session is created at sign-in and
 * again on every refresh whose tokens carry the claim.
 *
 * The claim is `groups` by default. A provider that puts groups elsewhere is
 * named with AUTH_GROUPS_CLAIM: a claim name (`roles`, `cognito:groups`,
 * `https://example.com/groups`, read as a literal key first) or a dotted
 * path into a nested claim (`realm_access.roles`). Values are taken as the
 * provider sends them, trimmed: names or ids (Entra ID sends object ids), a
 * list or a single string (comma separated is several), or objects with a
 * name. A gate must name a group exactly as the provider spells it.
 */

export const DEFAULT_GROUPS_CLAIM = "groups";

/** At most this many groups are kept on a session, each at most this long: a token is not a store. */
export const MAX_GROUPS = 200;
export const MAX_GROUP_LENGTH = 256;

/** The claim groups are read from: AUTH_GROUPS_CLAIM when set, else `groups`. */
export function groupsClaimName(env: Record<string, string | undefined> = process.env): string {
  return (env.AUTH_GROUPS_CLAIM ?? "").trim() || DEFAULT_GROUPS_CLAIM;
}

/** The claim's value: the literal key first (claim names carry `:`, `/` and `.`), then a dotted path into nested objects. */
function claimValue(claims: Record<string, unknown>, claim: string): unknown {
  if (Object.hasOwn(claims, claim)) return claims[claim];
  if (!claim.includes(".")) return undefined;
  let at: unknown = claims;
  for (const part of claim.split(".")) {
    if (!at || typeof at !== "object" || Array.isArray(at) || !Object.hasOwn(at, part)) return undefined;
    at = (at as Record<string, unknown>)[part];
  }
  return at;
}

function groupName(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    for (const k of ["name", "displayName", "value", "id"]) if (typeof o[k] === "string" && (o[k] as string).trim()) return (o[k] as string).trim();
  }
  return "";
}

/**
 * The groups a token's claims carry under `claim`, de-duplicated in the
 * order given; null when the claim is absent (or the claims are), which
 * says nothing, as against an empty list, which says "no groups".
 */
export function groupsFrom(claims: Record<string, unknown> | null | undefined, claim: string = DEFAULT_GROUPS_CLAIM): string[] | null {
  if (!claims || typeof claims !== "object") return null;
  const raw = claimValue(claims, claim);
  if (raw === undefined || raw === null) return null;
  const items = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [raw];
  const out: string[] = [];
  for (const item of items) {
    const name = groupName(item);
    if (!name || name.length > MAX_GROUP_LENGTH || out.includes(name)) continue;
    out.push(name);
    if (out.length >= MAX_GROUPS) break;
  }
  return out;
}

/**
 * Entra ID's "groups overage": a person in more groups than fit in a token
 * gets `_claim_names.groups` pointing at Microsoft Graph instead of the list.
 * The console does not call Graph; the sign-in event says the list was
 * withheld, so a gate that names one of those groups is explained.
 */
export function groupsOverage(claims: Record<string, unknown> | null | undefined, claim: string = DEFAULT_GROUPS_CLAIM): boolean {
  const names = claims && typeof claims === "object" ? (claims as Record<string, unknown>)._claim_names : undefined;
  return Boolean(names && typeof names === "object" && Object.hasOwn(names as object, claim));
}

/** A new session's groups: the ID token's and the access token's together; none when neither carries the claim. */
export function sessionGroups(idClaims: Record<string, unknown> | null | undefined, accessClaims: Record<string, unknown> | null | undefined, claim: string = DEFAULT_GROUPS_CLAIM): string[] {
  const a = groupsFrom(idClaims, claim) ?? [];
  const b = groupsFrom(accessClaims, claim) ?? [];
  return [...new Set([...a, ...b])].slice(0, MAX_GROUPS);
}

/**
 * A refreshed session's groups: what the new tokens carry, together; null
 * to keep what the session has when neither carries the claim (a refresh
 * answer often has no ID token, and an access token may never carry
 * groups). The session ends twelve hours after sign-in at the latest, so a
 * group removed at the provider stops counting by then either way.
 */
export function refreshedGroups(idClaims: Record<string, unknown> | null | undefined, accessClaims: Record<string, unknown> | null | undefined, claim: string = DEFAULT_GROUPS_CLAIM): string[] | null {
  const a = groupsFrom(idClaims, claim);
  const b = groupsFrom(accessClaims, claim);
  if (a === null && b === null) return null;
  return [...new Set([...(a ?? []), ...(b ?? [])])].slice(0, MAX_GROUPS);
}
