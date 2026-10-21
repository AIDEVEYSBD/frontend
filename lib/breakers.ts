import type { BreakerOpening, BreakerThresholds, BreakersView } from "./api/l7b";

/**
 * The estate's breakers as the console reads them (phase L7, second round):
 * what each one guards, why it opened, the thresholds in words, and what is
 * open now with the opening behind it. Pure: components/breakers.tsx
 * renders these, tests/l7b-logic.test.ts holds them.
 *
 * The backend counts every sink call and every peer call it hears of, from
 * the engine's runs, the worker door and the SDK door, across all runs: past
 * `calls` in `window_s`, or after `failures` in a row, the breaker opens for
 * `cooldown_s`, is served to every worker on its claim and heartbeat, and
 * refuses the call in every run (`control: breaker`, `scope: estate`). After
 * the cooldown it lets one call through; a failure there opens it again at
 * once (`why: probe`). A person may close it by hand (configure).
 */

/** What a breaker guards: a sink tool, or a peer (`peer:<name>`). */
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
  probe: "failed again after its cooldown",
};

export const whyText = (why: string): string => WHY_TEXT[why] ?? (why || "opened");

/** What opened it, with the figures it was judged by: `4 calls within 60 s, past the 3 allowed`. */
export function openingLine(o: Pick<BreakerOpening, "why" | "count" | "calls" | "window_s" | "failures">): string {
  if (o.why === "calls") return `${o.count} calls within ${spanText(o.window_s)}, past the ${o.calls} allowed`;
  if (o.why === "failures") return `${o.count} calls failed in a row (it opens at ${o.failures})`;
  if (o.why === "probe") return "the one call let through after the cooldown failed";
  return o.count ? `${o.count} (${o.why || "opened"})` : o.why || "opened";
}

/** The thresholds in a sentence; a threshold of 0 is off. */
export function thresholdsLine(t: BreakerThresholds): string {
  const rules = [t.calls ? `more than ${t.calls} calls to one sink or peer within ${spanText(t.window_s)}, across every run` : "", t.failures ? `${t.failures} failed calls in a row` : ""].filter(Boolean);
  const opens = rules.length ? `Opens on ${rules.join(", or on ")}` : "Never opens: both the call and the failure thresholds are off";
  return `${opens}; stays open ${spanText(t.cooldown_s)}, then lets one call through.`;
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
export function endedText(o: Pick<BreakerOpening, "open" | "closed_at" | "until">, now: number): string {
  if (o.open) return closesText(o.until, now);
  if (o.closed_at) return `closed by hand ${o.closed_at.replace("T", " ").replace(/Z$/, " UTC")}`;
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
