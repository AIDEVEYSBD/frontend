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

export const PERMISSIONS = ["view", "identity", "run", "approve", "deploy", "configure", "iam"] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_META: Record<Permission, string> = {
  view: "Read every page: control, runs, evals, knowledge, controls, configuration.",
  identity: "Read the identity pages: people and agents, sessions, authorization servers and the access log.",
  run: "Start workflows and evals from the console.",
  approve: "Answer human gates; the answer is signed with the person's SSO identity.",
  deploy: "Save, deploy and retire workflows.",
  configure: "Models, credentials, API keys, attached agents, knowledge admissions.",
  iam: "Change identity: grant and revoke, keys, owners, ending sessions.",
};

/**
 * The roles of this console, as the GUI access matrix names them.
 *
 *   platform_admin     every screen, and every action the matrix gives the
 *                      role: write, execute and second-person approval
 *   auditor            reads every screen, the identity register and the
 *                      audit trail included, and changes nothing
 *   use_case_reviewer  no access to this console; they work in the
 *   analyst            workloads' own consoles
 *
 * The matrix gives one admin role different letters per screen (R, W, E, H).
 * Those say which actions a screen has, not different admins: every action
 * here already asks for the permission it needs, so an auditor sees each one
 * disabled with the reason. `administrator` is the same role under the name
 * it had before the matrix; `operator` and `viewer` are not in the matrix and
 * are kept only so a deployment that already names them keeps working.
 */
export const ROLE_PERMISSIONS: Record<string, readonly Permission[]> = {
  platform_admin: ["view", "identity", "run", "approve", "deploy", "configure", "iam"],
  administrator: ["view", "identity", "run", "approve", "deploy", "configure", "iam"],
  auditor: ["view", "identity"],
  use_case_reviewer: [],
  analyst: [],
  operator: ["view", "run", "approve"],
  viewer: ["view"],
  // Read-only under the names the AutoX admin gave it for this client.
  npr_viewer: ["view"],
  af_viewer: ["view"],
};

/** A role as a person reads it. */
export const ROLE_LABEL: Record<string, string> = {
  platform_admin: "Platform admin",
  administrator: "Platform admin",
  auditor: "Auditor",
  use_case_reviewer: "Use-case reviewer",
  analyst: "Analyst",
  operator: "Operator",
  viewer: "Viewer",
};
export const roleLabel = (role: string): string => ROLE_LABEL[role] ?? role;

/**
 * The permissions a set of app roles grants. `defaultRole` is the role applied
 * when a signed-in user carries no app roles at all. This console names none
 * (lib/server/auth.ts defaultRole), so a person nobody has given a role holds
 * no permission and cannot open it.
 */
export function permissionsFor(appRoles: readonly string[], defaultRole = ""): Permission[] {
  const roles = appRoles.length ? appRoles : defaultRole ? [defaultRole] : [];
  const out = new Set<Permission>();
  for (const r of roles) for (const p of ROLE_PERMISSIONS[r] ?? []) out.add(p);
  return PERMISSIONS.filter((p) => out.has(p));
}

export function can(permissions: readonly Permission[], needed: Permission): boolean {
  return permissions.includes(needed);
}
