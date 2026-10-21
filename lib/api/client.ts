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

export const api = createClient<paths>({ baseUrl: "", credentials: "include" });

/**
 * The message in an error the backend answered with, or a plain reading of
 * the status. openapi-fetch hands back `error` as the parsed body when the
 * status is 4xx/5xx; the proxy's own refusals (401 sign in, 403 cross-origin)
 * carry the same `{error}` shape.
 */
export function errorText(error: unknown, response?: { status: number; statusText?: string }): string {
  if (error && typeof error === "object" && "error" in error) {
    const e = (error as { error?: unknown }).error;
    if (typeof e === "string" && e) return e;
  }
  if (typeof error === "string" && error.trim()) return error.slice(0, 300);
  if (response) return `the backend answered ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
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
  /** The stream could not be opened or was lost for good; the run itself may still be going. */
  onError?: (message: string) => void;
}

/**
 * Follow a run: replay from the start, then live, until `end`.
 *
 * An EventSource reconnects on its own when a proxy drops the connection,
 * and the backend answers every (re)connection with the whole journal so
 * far, so entries are deduplicated by id here and a reconnect is invisible
 * to the caller. The stream is closed on `end`: the backend closes its side
 * then, and an EventSource left open would reconnect and replay forever.
 *
 * Returns the function that closes the stream; call it on unmount.
 */
export function subscribeRunEvents(runId: string, handlers: RunEventHandlers): () => void {
  const url = `/api/runs/${encodeURIComponent(runId)}/events`;
  const es = new EventSource(url, { withCredentials: true });
  const seen = new Set<string>();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    es.close();
  };
  es.addEventListener("entry", (ev) => {
    const decoded = decodeRunEvent("entry", (ev as MessageEvent<string>).data);
    if (!decoded || decoded.type !== "entry") return;
    if (seen.has(decoded.entry.id)) return;
    seen.add(decoded.entry.id);
    handlers.onEntry(decoded.entry);
  });
  es.addEventListener("end", (ev) => {
    const decoded = decodeRunEvent("end", (ev as MessageEvent<string>).data);
    close();
    if (decoded && decoded.type === "end") handlers.onEnd(decoded.end);
  });
  es.onerror = () => {
    // CONNECTING means it is retrying on its own; CLOSED means the server
    // refused (401, 404, not an event stream) and nothing more will come.
    if (closed || es.readyState !== EventSource.CLOSED) return;
    closed = true;
    handlers.onError?.(`the event stream for run ${runId} could not be opened — the run may not exist, or you may need to sign in again`);
  };
  return close;
}
