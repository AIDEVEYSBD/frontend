/**
 * Pages that stand alone, without the console's chrome (header, navigation,
 * the Ask drawer): the landing page, sign-in and its refusal, and the
 * external answer page (`/answer/{token}`), where an outside participant
 * answers one gate with a signed link and nothing else.
 *
 * This decides layout only. Who may read or change anything is the
 * service's decision on every /api request (proxy.ts forwards them all).
 */
export const OPEN_PAGES = ["/", "/login", "/no-access"];
export const OPEN_PREFIXES = ["/answer/", "/_next/", "/logos/", "/media/", "/.well-known/", "/favicon.ico", "/icon.svg"];

/** Whether a page path (never an API path) stands alone, without the chrome. */
export function isOpenPage(pathname: string): boolean {
  if (pathname.startsWith("/api/")) return false;
  return OPEN_PAGES.includes(pathname) || OPEN_PREFIXES.some((p) => pathname.startsWith(p));
}
