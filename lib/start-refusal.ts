import { errorText, type Answered } from "./api/client";
import { lockdownRefusalOf, lockdownRefusalText } from "./api/l5";
import { pausedRefusalOf } from "./api/l8b";
import { rateLimitOf, type RateLimit } from "./api/l7";
import { retiredOf } from "./api/l8";
import { pausedLine, retiredLine } from "./lifecycle";

/**
 * A start the platform refused (`POST /api/runs`), in the platform's own
 * words, for the places a run is started (the Runs page, a workload's first
 * run). The platform checks, before it writes anything, in this order:
 *
 *   423  the estate is locked down: `{error, control: "lockdown", lockdown}`
 *   409  the agent is paused, or draining: `{error, control: "paused", paused: {mode, reason, by, at}}`
 *   429  a rate limit: the `RateLimitRefusal` body (`{error, scope, limit, used, allowed, retry_after_s, ...}`)
 *
 * The sentence shown is the platform's `error`, as it wrote it; what the
 * body adds beside it (who set a lockdown, when, its audit event) follows.
 * A 409 for a retired agent keeps its own line. Anything else is the
 * platform's error with its status and address.
 */
export type StartRefusal =
  | { kind: "lockdown"; text: string }
  | { kind: "paused"; text: string }
  | { kind: "rate_limit"; text: string; limit: RateLimit }
  | { kind: "retired"; text: string }
  | { kind: "other"; text: string };

/**
 * The platform's `error` as one sentence, with a full stop at the end; ""
 * when the body has none. `raise` lifts the first letter, for a sentence
 * that begins with a word ("the estate is locked down…", "rate limit: …");
 * one that begins with an agent's id ("opc-gate is paused: …") keeps it as
 * written.
 */
export function platformSentence(body: unknown, raise = false): string {
  const said = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error.trim() : "";
  if (!said) return "";
  const text = raise ? said[0].toUpperCase() + said.slice(1) : said;
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

const when = (iso: string | null): string => {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(t) ? "" : new Date(t).toLocaleString();
};

export function startRefusalOf(agent: string, status: number, body: unknown, retryAfter: string | null, response: Answered): StartRefusal {
  const limit = rateLimitOf(status, body, retryAfter);
  if (limit) return { kind: "rate_limit", text: platformSentence(body, true) || limit.error, limit };
  const locked = lockdownRefusalOf(status, body);
  if (locked) {
    const said = platformSentence(body, true);
    if (!said) return { kind: "lockdown", text: lockdownRefusalText(locked) };
    const facts = [locked.by ? `Locked down by ${locked.by}` : "Locked down", when(locked.at) ? `at ${when(locked.at)}` : ""].filter(Boolean).join(" ");
    const audit = locked.audit_id !== null ? `; audit event #${locked.audit_id}` : "";
    return { kind: "lockdown", text: `${said} ${facts}${audit}.` };
  }
  const paused = pausedRefusalOf(status, body);
  if (paused) return { kind: "paused", text: platformSentence(body) || pausedLine(agent, paused) };
  const retired = status === 409 ? retiredOf((body as { retired?: unknown } | null | undefined)?.retired) : null;
  if (retired) return { kind: "retired", text: `${agent || "This agent"} is retired. ${retiredLine(retired)}` };
  return { kind: "other", text: errorText(body, response) };
}
