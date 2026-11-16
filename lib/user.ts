/**
 * Who is at the console when nobody has signed in.
 *
 * With sign-in switched off (a laptop, or a deployment locked by its runtime
 * key alone) there is no person to name, so what gets written into
 * approvals, admissions and gate answers is this stand-in, which says so. A
 * signed-in session always takes its place; every caller goes through here
 * rather than asking the person to type their name.
 */
export const CURRENT_USER = {
  name: "Local operator",
  role: "Sign-in is off",
  initials: "LO",
};
