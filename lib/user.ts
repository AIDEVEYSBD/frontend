/**
 * What the console shows in place of a person when it could not read who is
 * signed in. The platform always knows (it checks the sign-in on every
 * request, and refuses anything it cannot attribute), so this only appears
 * while the session is being read or when reading it failed. It never names
 * anyone and never suggests that sign-in is switched off.
 */
export const CURRENT_USER = {
  name: "Not signed in",
  role: "The platform has not confirmed who you are",
  initials: "?",
};
