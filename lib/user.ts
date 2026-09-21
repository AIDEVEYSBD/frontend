/**
 * Who is at the console.
 *
 * There is no sign-in on this deployment yet, so the identity that gets
 * written into approvals, admissions and gate answers is the operator this
 * console is issued to. When the deployment moves behind a sign-in this is
 * where the session's identity is read from; every caller already goes
 * through here rather than asking the person to type their name.
 */
export const CURRENT_USER = {
  name: "Chandresh Singh",
  role: "Approver",
  initials: "CS",
};
