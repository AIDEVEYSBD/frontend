import type { NextConfig } from "next";

/**
 * This Next server serves the console's pages and nothing else. proxy.ts
 * sends every /api request, and the agent card at /.well-known/agent.json, to
 * the platform's service at BACKEND_ORIGIN with its headers unchanged; the
 * service decides who the person is and what they may do. There is no API
 * here, so there are no rewrites.
 */

/**
 * Sent with every page, so a page cannot be framed by another site (an
 * approver lured into clicking Approve, Refuse or Kill inside a hostile
 * frame), a response is never sniffed into another type, and no console
 * address leaks to another site in the Referer.
 *
 * - `frame-ancestors 'none'` and `X-Frame-Options: DENY` (the older form):
 *   no site, this one included, may frame a page. The console frames none of
 *   its own pages.
 * - The policy carries no script-src or default-src: the root layout runs one
 *   inline script (components/inline-script.tsx), and the development server
 *   evaluates code. `object-src 'none'` and `base-uri 'self'` restrict
 *   nothing the console uses.
 * - `Referrer-Policy: same-origin`: nothing is sent to another site, as with
 *   `no-referrer`. Under `no-referrer` the Fetch standard ("append a request
 *   `Origin` header", step 4.1: a POST whose mode is not "cors") sends
 *   `Origin: null` on a form's own POST, which proxy.ts would refuse as a
 *   cross-origin write. fetch() keeps the real Origin, and the console posts
 *   with fetch() today; `same-origin` keeps a form's post working too.
 * - `Strict-Transport-Security` without includeSubDomains: the console's own
 *   host only. A browser ignores it over plain http, as in development.
 *
 * Not on /api or /.well-known: those answers are the service's own, and
 * proxy.ts passes them back as the service sent them.
 */
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

const nextConfig: NextConfig = {
  devIndicators: false,
  experimental: {
    // Next's proxy drops an upstream that stays silent this long (30 s by
    // default). Paths the service owns can hold longer: a slow model call on
    // the gateway, a long-poll on the SDK door. Cloud Run's own limit is an hour.
    proxyTimeout: 3_600_000,
  },
  async headers() {
    return [{ source: "/((?!api/|\\.well-known/).*)", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
