/**
 * The one test for a link the console did not write itself: a link in model
 * text (an answer, a chat reply, the assistant), an address a fetched
 * document came from, a passage's origin, an answer block's page, or a
 * `next` parameter after sign-in.
 *
 * Two kinds of link pass:
 *
 * - A page of this console: a path beginning with one "/". It is resolved
 *   against a stand-in origin and kept only if it is still on that origin,
 *   and what is returned is the resolved path, query and fragment, never the
 *   raw text. A raw-text test such as `startsWith("/") && !startsWith("//")`
 *   lets `/\evil.example/login` through: a browser reads the backslash as a
 *   slash, so the link leaves the site in the same tab.
 * - Another site, over https only, with no user name or password in the
 *   address (`https://console@evil.example` reads as this console and goes
 *   to evil.example). It is opened in a new tab with no opener and no
 *   referrer (components/safe-link.tsx).
 *
 * Everything else (`javascript:`, `data:`, plain http, a relative path, an
 * address that does not parse) is refused with the reason, and the caller
 * shows it as text, not as a link.
 *
 * Pure, no React: the server's login page imports `consolePath` as well.
 */

/** A stand-in origin. `.invalid` is reserved (RFC 2606), so it never names a real host. */
const HERE = "https://console.invalid";

export type LinkVerdict =
  | { kind: "page"; href: string }
  | { kind: "external"; href: string }
  /** `brief` is the reason in a few words, shown beside the text; `reason` is the sentence. */
  | { kind: "refused"; raw: string; reason: string; brief: string };

/** A path inside this console, resolved; null for anything that would leave it or is not a path. */
export function consolePath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/")) return null;
  let url: URL;
  try {
    url = new URL(raw, HERE);
  } catch {
    return null;
  }
  if (url.origin !== HERE) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** What a link may be: a console page, an https site, or refused with the reason. */
export function safeLink(raw: unknown): LinkVerdict {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { kind: "refused", raw: String(raw ?? ""), reason: "the link has no address", brief: "no address" };
  if (text.startsWith("/")) {
    const page = consolePath(text);
    return page !== null ? { kind: "page", href: page } : { kind: "refused", raw: text, reason: "the address leaves this console", brief: "leaves the console" };
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { kind: "refused", raw: text, reason: "the address is not a console page or a full https address", brief: "not a full address" };
  }
  const scheme = url.protocol.replace(/:$/, "");
  if (scheme !== "https") return { kind: "refused", raw: text, reason: `only https addresses are opened from the console, and this one is ${scheme}`, brief: `${scheme} address` };
  if (url.username || url.password) return { kind: "refused", raw: text, reason: "the address carries a user name or password", brief: "carries a user name" };
  return { kind: "external", href: url.href };
}
