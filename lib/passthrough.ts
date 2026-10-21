/**
 * The A2A doors, forwarded byte for byte (phase L7, second round).
 *
 * A2A is signed end to end (backend/CONTRACT.md, "A2A, both ways"): a
 * caller's x-af-signature covers the method, the request target as it went
 * on the request line (the raw path and query), the timestamp, the nonce,
 * the SHA-256 of the body and the x-af-delegation header; the backend's
 * answer is signed over its status, the request's nonce and its body. A
 * rewrite would hand the request to Next's own proxy, which rebuilds the
 * query from its parsed form, gzips the answer when the caller accepts it,
 * and drops an upstream that stays silent for 30 seconds (the tool broker
 * holds a call at a gate for up to 110). So proxy.ts hands the A2A doors
 * (lib/route-policy.ts PASSTHROUGH_DOORS) here, and this forwards:
 *
 *   - the path and query exactly as the console received them, on the
 *     upstream origin (lib/route-policy.ts upstreamFor concatenates them),
 *     never decoded or rebuilt;
 *   - the body as the bytes it arrived as, never parsed;
 *   - every request header, the x-af-* ones among them, less the ones a
 *     connection owns, with `accept-encoding: identity` so the upstream
 *     sends its body as it signed it, and the runtime key when one is set;
 *   - the answer's status, every header (x-af-signature among them) less the
 *     ones a connection owns, and its body as the bytes the upstream sent,
 *     with `cache-control: no-transform` added: Next's compression, and any
 *     CDN in front of the console, leave a no-transform answer as it is.
 *
 * What Next does before proxy.ts runs is outside this: it parses the
 * request URL (a `.` or `..` segment is resolved) and re-serialises a query
 * string from its parsed form. Every A2A door is called without a query.
 */

/** Request headers a connection owns, or that this forward sets itself. */
export const REQUEST_DROPS = ["host", "connection", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer", "upgrade", "expect", "content-length", "accept-encoding"] as const;

/** Response headers a connection owns. `content-encoding` goes too: fetch hands over a decoded body. */
export const RESPONSE_DROPS = ["connection", "keep-alive", "proxy-connection", "transfer-encoding", "te", "trailer", "upgrade", "content-length", "content-encoding"] as const;

/** Statuses that carry no body. */
const NO_BODY = new Set([101, 103, 204, 205, 304]);

export interface PassthroughOptions {
  /** The runtime key the backend expects (`x-runtime-key`), when the API is closed. */
  key?: string;
  keyHeader?: string;
}

/** `cache-control` with `no-transform` in it, keeping whatever the upstream said. */
export function noTransform(cacheControl: string | null): string {
  const cc = (cacheControl ?? "").trim();
  if (/(^|,)\s*no-transform\s*(,|$)/i.test(cc)) return cc;
  return cc ? `${cc}, no-transform` : "no-transform";
}

/** The headers the upstream gets: the request's own, less what a connection owns. */
export function forwardHeaders(incoming: Headers, opts: PassthroughOptions = {}): Headers {
  const headers = new Headers(incoming);
  for (const h of REQUEST_DROPS) headers.delete(h);
  headers.set("accept-encoding", "identity");
  if (opts.key) headers.set(opts.keyHeader ?? "x-runtime-key", opts.key);
  return headers;
}

/** The headers the caller gets back: the upstream's own, less what a connection owns, never transformed on the way. */
export function answerHeaders(upstream: Headers): Headers {
  const headers = new Headers(upstream);
  for (const h of RESPONSE_DROPS) headers.delete(h);
  headers.set("cache-control", noTransform(upstream.get("cache-control")));
  return headers;
}

/**
 * Forward one request to `url` and answer with what came back. A backend
 * that does not answer is a 502 in the shape every door refuses with.
 */
export async function passthrough(request: Request, url: string, opts: PassthroughOptions = {}): Promise<Response> {
  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
  let upstream: Response;
  try {
    upstream = await fetch(url, { method, headers: forwardHeaders(request.headers, opts), body, redirect: "manual", cache: "no-store" });
  } catch (e) {
    return Response.json(
      { error: `the A2A doors are served by the backend, which did not answer: ${(e as Error).message}` },
      { status: 502, headers: { "cache-control": "no-store, no-transform" } },
    );
  }
  const empty = NO_BODY.has(upstream.status) || method === "HEAD";
  return new Response(empty ? null : upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: answerHeaders(upstream.headers) });
}
