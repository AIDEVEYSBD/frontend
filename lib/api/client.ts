import createClient from "openapi-fetch";
import type { components, paths } from "./backend";

/**
 * The backend, from the console.
 *
 * `lib/api/backend.d.ts` is generated from backend/openapi.json (`npm run
 * gen:api`) and committed, so a checkout without the backend still
 * typechecks. Every call here is same-origin: proxy.ts forwards the
 * backend-owned prefixes (lib/route-policy.ts BACKEND_PREFIXES) to
 * BACKEND_ORIGIN with the runtime key attached and the session cookie
 * forwarded, so the browser never learns where the backend lives and the
 * cookie never leaves this origin.
 */

export type Schemas = components["schemas"];
export type RunRow = Schemas["RunRow"];
export type RunState = Schemas["RunState"];
export type JournalEntry = Schemas["JournalEntry"];
export type Suspension = Schemas["Suspension"];
export type ErrorBody = Schemas["ErrorBody"];
export type BudgetRefusal = Schemas["BudgetRefusal"];

/**
 * `fetch` is resolved on every call, never captured when this module loads:
 * the console's guard (components/chrome.tsx) wraps `window.fetch` once the
 * page is up, so a 401 from any door sends the person to sign in and a 403
 * says what was refused, the same for a call through this client as for a
 * plain fetch. A test stubs the global the same way.
 */
export const api = createClient<paths>({ baseUrl: "", credentials: "include", fetch: (request: Request) => globalThis.fetch(request) });

/**
 * A request's URL as the console's path when it is on the console's own
 * origin (`/api/keys?x=1`), else as given. A plain `fetch("/api/...")` names
 * the path already; the generated client sends a `Request`, whose URL the
 * browser has made absolute. The fetch guard in components/chrome.tsx reads
 * both through this.
 */
export function consolePath(url: string, origin: string = typeof window === "undefined" ? "" : window.location.origin): string {
  if (url.startsWith("/")) return url;
  try {
    const u = new URL(url);
    return origin && u.origin === origin ? `${u.pathname}${u.search}` : url;
  } catch {
    return url;
  }
}

/** What a failed answer is read from: its status, and the address it came from when the response carries one. */
export interface Answered {
  status: number;
  statusText?: string;
  url?: string;
}

/** The address an answer came from, as the console's path without its query. */
function addressOf(response: Answered | undefined, path?: string): string {
  const p = path ?? (response?.url ? consolePath(response.url) : "");
  return p.split("?")[0];
}

/** The sentence every "not built" answer becomes, wherever it was asked. `notBuiltDoorOf` reads it back. */
export function notBuiltText(method: string | undefined, path: string): string {
  return `not built yet: the platform answers 501 to ${method ? `${method} ` : ""}${path}`;
}

const NOT_BUILT_SENTENCE = /not built yet: the platform answers 501 to (?:(GET|POST|PUT|PATCH|DELETE) )?(\/[^\s,;)]*[^\s,;).])/;

/** The method and address a "not built" message names, or null when the message is another failure. */
export function notBuiltDoorOf(message: unknown): { method: string; path: string } | null {
  if (typeof message !== "string") return null;
  const m = NOT_BUILT_SENTENCE.exec(message);
  return m ? { method: m[1] ?? "", path: m[2] } : null;
}

/**
 * A failed answer in one line that names its status and its address.
 *
 * A 501 is the platform's "not built" and reads as `notBuiltText`. A body
 * with an `error` is the backend's own sentence, followed by the status and
 * the address. Anything else (a page, a proxy's plain text, an empty body)
 * means the backend did not answer the request, and says so with the status.
 * openapi-fetch hands back `error` as the parsed body when the status is
 * 4xx/5xx; the proxy's own refusals (401 sign in, 403 cross-origin) carry
 * the same `{error}` shape.
 */
export function errorText(error: unknown, response?: Answered, method?: string, path?: string): string {
  const at = addressOf(response, path);
  const where = [method, at].filter(Boolean).join(" ");
  if (response?.status === 501) return notBuiltText(method, at || "this address");
  let said = "";
  if (error && typeof error === "object" && "error" in error) {
    const e = (error as { error?: unknown }).error;
    if (typeof e === "string" && e) said = e;
  }
  if (said) return response ? `${said} (${response.status}${where ? ` from ${where}` : ""})` : said;
  if (response) return `the backend did not answer${where ? ` ${where}` : ""} (${response.status}${response.statusText ? ` ${response.statusText}` : ""})`;
  // No answer at all: a plain message a caller passed in.
  if (typeof error === "string" && error.trim() && !error.trimStart().startsWith("<")) return error.slice(0, 300);
  return "the request failed";
}

/* ═══════════════════ The run event stream ═══════════════════ */

/** The `end` frame: the run's settled state once the stream closes. */
export interface RunEnd {
  state: string;
  error: string;
  result: Record<string, unknown>;
  suspension: Suspension | null;
}

export type RunEvent = { type: "entry"; entry: JournalEntry } | { type: "end"; end: RunEnd };

/**
 * One frame of `GET /api/runs/{id}/events` as a typed event, or null for a
 * frame that is not one (a stray message, malformed JSON). The backend
 * marks each entry with `type: "entry"` as the CLI's JSONL does; the field
 * is dropped here because the event name already says it.
 */
export function decodeRunEvent(event: string, data: string): RunEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (event === "entry") {
    if (typeof obj.kind !== "string" || typeof obj.id !== "string") return null;
    const { type: _type, ...entry } = obj;
    void _type;
    return { type: "entry", entry: { ...entry, t: Number(entry.t ?? 0) } as JournalEntry };
  }
  if (event === "end") {
    return {
      type: "end",
      end: {
        state: String(obj.state ?? "unknown"),
        error: String(obj.error ?? ""),
        result: obj.result && typeof obj.result === "object" ? (obj.result as Record<string, unknown>) : {},
        suspension: obj.suspension && typeof obj.suspension === "object" ? (obj.suspension as Suspension) : null,
      },
    };
  }
  return null;
}

export interface RunEventHandlers {
  onEntry: (entry: JournalEntry) => void;
  onEnd: (end: RunEnd) => void;
  /** The stream could not be opened or was lost for good; the run itself may still be going. The message names the status. */
  onError?: (message: string) => void;
  /** The connection dropped and the browser is trying again (true), or it is back (false). */
  onReconnecting?: (reconnecting: boolean) => void;
  /** A frame arrived that could not be read; the running count of such frames. */
  onDropped?: (count: number) => void;
}

/**
 * Follow a run: replay from the start, then live, until `end`.
 *
 * An EventSource reconnects on its own when a proxy drops the connection,
 * and the backend answers every (re)connection with the whole journal so
 * far, so entries are deduplicated by id here. The caller is told while the
 * browser is reconnecting, told how many frames could not be read, and told
 * when the stream is lost for good, with the status the address answered.
 * The stream is closed on `end`: the backend closes its side then, and an
 * EventSource left open would reconnect and replay forever.
 *
 * Returns the function that closes the stream; call it on unmount.
 */
export function subscribeRunEvents(runId: string, handlers: RunEventHandlers): () => void {
  const url = `/api/runs/${encodeURIComponent(runId)}/events`;
  const es = new EventSource(url, { withCredentials: true });
  const seen = new Set<string>();
  let closed = false;
  let dropped = 0;
  let reconnecting = false;
  const close = () => {
    if (closed) return;
    closed = true;
    es.close();
  };
  const drop = () => {
    dropped += 1;
    handlers.onDropped?.(dropped);
  };
  es.onopen = () => {
    if (!reconnecting) return;
    reconnecting = false;
    handlers.onReconnecting?.(false);
  };
  es.addEventListener("entry", (ev) => {
    const decoded = decodeRunEvent("entry", (ev as MessageEvent<string>).data);
    if (!decoded || decoded.type !== "entry") return drop();
    if (seen.has(decoded.entry.id)) return;
    seen.add(decoded.entry.id);
    handlers.onEntry(decoded.entry);
  });
  es.addEventListener("end", (ev) => {
    const decoded = decodeRunEvent("end", (ev as MessageEvent<string>).data);
    close();
    if (decoded && decoded.type === "end") handlers.onEnd(decoded.end);
    else {
      drop();
      handlers.onError?.(`the live stream for run ${runId} ended with a closing frame that could not be read`);
    }
  });
  // A frame under no event name the console knows is counted, never silently passed over.
  es.onmessage = () => drop();
  es.onerror = () => {
    if (closed) return;
    // CONNECTING: the browser is retrying on its own. Say so until it is back.
    if (es.readyState !== EventSource.CLOSED) {
      if (!reconnecting) {
        reconnecting = true;
        handlers.onReconnecting?.(true);
      }
      return;
    }
    // CLOSED: the address refused (401, 404, 5xx, not an event stream) and nothing more will come. Ask it once more for its status.
    closed = true;
    if (reconnecting) handlers.onReconnecting?.(false);
    const ctl = new AbortController();
    globalThis
      .fetch(url, { credentials: "include", cache: "no-store", signal: ctl.signal })
      .then((r) => {
        ctl.abort();
        handlers.onError?.(r.ok ? `the live stream for run ${runId} closed and the browser stopped retrying (GET ${url} answers ${r.status})` : `the live stream for run ${runId} was lost: GET ${url} answered ${r.status}`);
      })
      .catch(() => handlers.onError?.(`the live stream for run ${runId} was lost: GET ${url} did not answer`));
  };
  return close;
}
