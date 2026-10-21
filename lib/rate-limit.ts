import type { RateLimit, RateLimitName } from "./api/l7";

/**
 * A rate limit, as the place that started the work says it (lib/api/l7.ts
 * rateLimitOf reads the 429, typed by the backend as `RateLimitRefusal`;
 * rateLimitOfRpc reads the A2A door's JSON-RPC 429). Pure: the Runs page,
 * the eval runner and the attention queue use these,
 * tests/l7-logic.test.ts holds them.
 */

/** The limit's name in words, for every limit the backend's document names. */
export const LIMIT_TEXT: Record<RateLimitName, string> = {
  run_starts_per_minute: "runs started per minute",
  sub_runs_per_minute: "sub-runs per minute",
  enqueues_per_minute: "jobs queued per minute",
  tree_per_minute: "runs, sub-runs and jobs per minute in one tree",
};

/** A limit in words; one a newer backend names reads as itself. */
export const limitText = (limit: string): string => (Object.hasOwn(LIMIT_TEXT, limit) ? LIMIT_TEXT[limit as RateLimitName] : limit.replace(/_/g, " "));

/** Whose limit ruled: the agent's own, or the tree's (everything one trace set off; `tree` is "" when the event joined none). */
export function scopeText(rl: Pick<RateLimit, "scope" | "agent" | "tree">): string {
  return rl.scope === "tree" ? `the tree${rl.tree ? ` ${rl.tree}` : ""}` : `agent ${rl.agent || "unknown"}`;
}

/** When the work may be started again, as an instant: the moment the refusal was read, plus the seconds the backend gave. */
export function retryAt(rl: Pick<RateLimit, "retry_after_s">, readAt: number): number {
  return readAt + Math.max(1, rl.retry_after_s) * 1000;
}

/** Seconds left until `at`, never below zero. */
export const secondsLeft = (at: number, now: number): number => Math.max(0, Math.ceil((at - now) / 1000));

/** "1 min 5 s", "42 s", "now". */
export function waitText(seconds: number): string {
  if (seconds <= 0) return "now";
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}

/**
 * The refusal in one sentence a person reads where the run was started:
 * the scope, the limit, the figures and when to retry (counting down from
 * `readAt` when `now` is given).
 */
export function rateLimitText(rl: RateLimit, readAt?: number, now?: number): string {
  const left = readAt !== undefined && now !== undefined ? secondsLeft(retryAt(rl, readAt), now) : rl.retry_after_s;
  const who = scopeText(rl);
  const figures = `${limitText(rl.limit)}, ${rl.used} used of ${rl.allowed} allowed${rl.limit ? ` (${rl.limit})` : ""}`;
  const when = left > 0 ? `Retry in ${waitText(left)}.` : "It can be started again now.";
  return `Rate limited for ${who}: ${figures}. ${when}`;
}
