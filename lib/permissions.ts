/**
 * The permissions the platform's service grants, by name, with what each
 * lets a person do. The service decides who holds which (its role map, read
 * on every request) and answers each person's permissions on the session;
 * the console only names them and greys out what a person may not do.
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
 * Whether a person holds the role that may do everything: answer any gate
 * that is not their own, review, override. One place, so a check elsewhere
 * never names a role itself.
 */
export function isPlatformAdmin(appRoles: readonly string[] | undefined | null): boolean {
  return Boolean(appRoles?.some((r) => r === "platform_admin" || r === "administrator"));
}

/**
 * The roles of this console, as the GUI access matrix names them. Which
 * permissions each carries is the service's (identity/roles.py), answered on
 * the session and on the IAM page; the console holds no copy.
 *
 *   platform_admin     every screen, and every action the matrix gives the
 *                      role: write, execute and second-person approval
 *   auditor            reads every screen, the identity register and the
 *                      audit trail included, and changes nothing
 *   use_case_reviewer  no access to this console; they work in the
 *   analyst            workloads' own consoles
 */

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
