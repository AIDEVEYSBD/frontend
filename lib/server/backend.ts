/**
 * The backend, from a Next route handler.
 *
 * A console route that still exists while its domain moves (the eval
 * runner, the configuration read, the authoring conversation) needs the
 * backend's answer on the caller's behalf. The call carries the caller's own
 * credentials — session cookie, API key, internal header — so the backend's
 * `session()` sees the same identity the console saw, and adds the runtime
 * key the way proxy.ts does. Nothing here invents an identity, and nothing
 * in the console spawns the runtime: every run, check, draft and vault read
 * is a request here.
 */

const FORWARDED = ["cookie", "authorization", "x-api-key", "x-internal-auth"] as const;

export function backendOrigin(): string {
  return (process.env.BACKEND_ORIGIN ?? "").replace(/\/+$/, "");
}

export function backendConfigured(): boolean {
  return Boolean(backendOrigin());
}

/** The 503 a route answers when the domain it needs has moved to a backend this deployment has not named. */
export function backendMissing(): Response {
  return Response.json(
    { error: "BACKEND_ORIGIN is not set on this deployment; runs, agents, approvals, drafts, keys and the vault are served by the backend (backend/CONTRACT.md)" },
    { status: 503 },
  );
}

/** The backend's `{error}` body, or a plain reading of the status, for a route that relays a refusal. */
export async function backendError(res: Response, fallback = "the backend refused"): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  const e = typeof body.error === "string" && body.error ? body.error : "";
  return e || `${fallback} (${res.status})`;
}

export async function backendFetch(req: Request, path: string, init: RequestInit = {}): Promise<Response> {
  const origin = backendOrigin();
  if (!origin) throw new Error("BACKEND_ORIGIN is not set");
  const headers = new Headers(init.headers ?? {});
  for (const h of FORWARDED) {
    const v = req.headers.get(h);
    if (v && !headers.has(h)) headers.set(h, v);
  }
  const key = process.env.RUNTIME_KEY ?? "";
  if (key) headers.set("x-runtime-key", key);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${origin}${path}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(30_000) });
}
