/**
 * Roles are names the SSO issues; permissions are what this platform lets a
 * role do. The mapping lives here and nowhere else, so a role renamed in the
 * identity provider is a one-line change, and so the IAM page can show the
 * mapping as the single source of what a role means on this deployment.
 *
 * The SSO guide's rule that shapes this file: read `autox:app_roles` from the
 * JWT access token for every request, map through this table, and never keep
 * the verdict longer than that token lives.
 */

export const PERMISSIONS = ["view", "run", "approve", "deploy", "configure", "iam"] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_META: Record<Permission, string> = {
  view: "Read every page: control, runs, evals, knowledge, controls, configuration.",
  run: "Start workflows and evals from the console.",
  approve: "Answer human gates; the answer is signed with the person's SSO identity.",
  deploy: "Save, deploy and retire workflows.",
  configure: "Models, credentials, API keys, attached agents, knowledge admissions.",
  iam: "The IAM page: people, sessions, and the non-human identity register.",
};

/** App roles as the SSO admin is expected to name them. Rename here if the admin chose differently. */
export const ROLE_PERMISSIONS: Record<string, readonly Permission[]> = {
  administrator: ["view", "run", "approve", "deploy", "configure", "iam"],
  operator: ["view", "run", "approve"],
  viewer: ["view"],
};

/**
 * The permissions a set of app roles grants. `demoDefault` is the role applied
 * when a signed-in user carries no app roles at all — a deliberate,
 * demo-only deviation from the guide (an unassigned user should see the
 * "not assigned" page); it is read from AUTH_DEMO_DEFAULT_ROLE and must be
 * unset on any client deployment.
 */
export function permissionsFor(appRoles: readonly string[], demoDefault = ""): Permission[] {
  const roles = appRoles.length ? appRoles : demoDefault ? [demoDefault] : [];
  const out = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r] ?? []) out.add(p);
  return PERMISSIONS.filter((p) => out.has(p));
}

export function can(permissions: readonly Permission[], needed: Permission): boolean {
  return permissions.includes(needed);
}
