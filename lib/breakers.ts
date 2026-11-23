import type { BreakerOpening, BreakerThresholds, BreakersView } from "./api/l7b";

/**
 * The estate's breakers as the console reads them: what each one guards,
 * why it opened, the thresholds in words, and what is open now with the
 * opening behind it. Pure: components/breakers.tsx renders these,
 * tests/l7b-logic.test.ts holds them.
 *
 * The platform (agentfactory/control/breakers.py) counts the outcome of
 * every call of a tool that acts outside, across every run on every worker.
 * A breaker opens on a tool when `failures` calls of it fail in a row, or
 * when more than `calls` calls of it are made within `window_s`; it stays
 * open for `cooldown_s`, and every run is refused a call of the tool until
 * then. After a cooldown that ran out on its own, the first call is a
 * probe: a failure opens it again at once (`why: probe`). A refusal (by
 * policy, the host, the allow list or the vault) is never a failure and is
 * not counted. A person with configure may close one by hand. The
 * thresholds are the deployment's settings `BREAKER_FAILURES`,
 * `BREAKER_CALLS`, `BREAKER_WINDOW_SECONDS` and `BREAKER_COOLDOWN_SECONDS`
 * (0 turns a rule off; a cooldown of 0 turns breakers off); changing them
 * by policy is not built.
 */

/** What a breaker guards: a tool, by its name; a `peer:<name>` (which an earlier platform opened breakers on) reads as that peer. */
export function breakerTarget(name: string): { kind: "tool" | "peer"; label: string } {
  return name.startsWith("peer:") ? { kind: "peer", label: name.slice(5) } : { kind: "tool", label: name };
}

/** A span of seconds as a reader wants it: `45 s`, `5 min`, `1 h 30 min`. */
export function spanText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m} min ${r} s` : `${m} min`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Why it opened, in the reader's words. */
export const WHY_TEXT: Record<string, string> = {
  calls: "too many calls across the estate",
  failures: "failures in a row",
  probe: "the first call after its cooldown failed",
};

export const whyText = (why: string): string => WHY_TEXT[why] ?? (why || "opened");

/** What opened it: the platform's own sentence when the opening carries one, else one built from the figures it was judged by (`4 calls within 60 s, past the 3 allowed`). */
export function openingLine(o: Pick<BreakerOpening, "why" | "count" | "calls" | "window_s" | "failures"> & { why_words?: string }): string {
  if (o.why_words) return o.why_words;
  if (o.why === "calls") return `${o.count} calls within ${spanText(o.window_s)}, past the ${o.calls} allowed`;
  if (o.why === "failures") return `${o.count} calls failed in a row (it opens at ${o.failures})`;
  if (o.why === "probe") return "the first call after its cooldown failed";
  return o.count ? `${o.count} (${o.why || "opened"})` : o.why || "opened";
}

/** The thresholds in a sentence: a rule of 0 is off, a window of 0 turns the calls rule off, a cooldown of 0 turns breakers off. */
export function thresholdsLine(t: BreakerThresholds): string {
  if (!t.cooldown_s) return "Breakers are off: with a cooldown of 0, none opens.";
  const rules = [t.calls && t.window_s ? `more than ${t.calls} calls of one tool across the estate within ${spanText(t.window_s)}` : "", t.failures ? `${t.failures} failed calls of one tool in a row` : ""].filter(Boolean);
  const opens = rules.length ? `Opens on ${rules.join(", or on ")}` : "Never opens: the calls and the failures rules are both off";
  return `${opens}; stays open ${spanText(t.cooldown_s)}, and the first call after that is a probe: if it fails, the breaker opens again at once.`;
}

/** Seconds until `until`, from `now` (epoch ms); 0 once it has passed or when it cannot be read. */
export function secondsLeft(until: string, now: number): number {
  const t = Date.parse(until);
  return Number.isNaN(t) ? 0 : Math.max(0, Math.round((t - now) / 1000));
}

/** When it closes on its own, in words. */
export function closesText(until: string, now: number): string {
  const left = secondsLeft(until, now);
  return left > 0 ? `closes on its own in ${spanText(left)}` : "closing now";
}

export interface OpenBreaker {
  name: string;
  until: string;
  target: ReturnType<typeof breakerTarget>;
  /** The opening behind it (the newest still open), when the list carries one. */
  opening: BreakerOpening | null;
}

/** What is open now, as every worker is served it, each with the opening that opened it; the soonest to close last. */
export function openBreakers(view: Pick<BreakersView, "open" | "openings">): OpenBreaker[] {
  return Object.entries(view.open)
    .map(([name, until]) => ({ name, until, target: breakerTarget(name), opening: view.openings.find((o) => o.name === name && o.open) ?? view.openings.find((o) => o.name === name) ?? null }))
    .sort((a, b) => Date.parse(b.until) - Date.parse(a.until) || a.name.localeCompare(b.name));
}

/** The openings that are over: closed by hand, or past their cooldown. */
export function pastOpenings(view: Pick<BreakersView, "openings">): BreakerOpening[] {
  return view.openings.filter((o) => !o.open);
}

/** How an opening ended, or that it has not. */
export function endedText(o: Pick<BreakerOpening, "open" | "closed_at" | "until"> & { closed_by?: string }, now: number): string {
  if (o.open) return closesText(o.until, now);
  if (o.closed_at) return `closed by hand${o.closed_by ? ` by ${o.closed_by}` : ""} ${o.closed_at.replace("T", " ").replace(/Z$/, " UTC")}`;
  return `closed on its own ${o.until.replace("T", " ").replace(/Z$/, " UTC")}`;
}

/**
 * The breaker an attention row names: its `data.name` (the opening the
 * backend laid out), else the last segment of the close door it names
 * (`DELETE /api/breakers/{name}`, unencoded: `peer:soc-stub`). "" when the
 * row names none.
 */
export function breakerOfAttention(item: { data: Record<string, unknown> | null; action: { path: string } }): string {
  const named = item.data && typeof item.data.name === "string" ? item.data.name : "";
  if (named) return named;
  const m = /^\/api\/breakers\/(.+)$/.exec(item.action.path);
  if (!m) return "";
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}
