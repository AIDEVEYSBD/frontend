import type { CanaryArm, CanaryCondition, CanaryMode, CanaryRefusal, CanaryRequest, CanaryView } from "./api/l8b";
import { conditionLabel, shortDigest, whenText, type CanaryAssignment } from "./lifecycle";
import { taintOf } from "./queue";

/**
 * Canary and shadow as the console says them (phase 8): the form that
 * starts one beside production, what the backend would refuse before
 * anything is sent, the live report in a person's words (for a shadow, the
 * disagreement rate on the compared field with its examples and how the
 * calls compared; each arm's outcomes and cost; what is pending and why pairs
 * were skipped), the deploy conditions as the canary reads them (a shadow
 * does not need the release threshold), a refusal, a run's marks wherever
 * runs are listed, and a shadow run's `would_call` entries. The backend decides every one of these again;
 * these say it, or stop a click before it gets that far. Pure:
 * components/canary.tsx renders these, tests/l8b-logic.test.ts and
 * tests/l8b-contract.test.ts hold them.
 */

const s_ = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const o_ = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const v_ = (p: { version: number | null; digest: string } | null | undefined) => (p ? `version ${p.version ?? "?"}${p.digest ? ` (${shortDigest(p.digest)})` : ""}` : "nothing deployed");

export const MODE_LABEL: Record<CanaryMode, string> = { canary: "Canary", shadow: "Shadow" };

/** What each mode does, in a line. */
export const MODE_MEANS: Record<CanaryMode, string> = {
  canary: "a share of the agent's new starts runs the candidate instead of production (never a sub-run or an evaluation's run); each run records which it ran, and both arms' outcomes are shown",
  shadow: "a share of production runs is mirrored by a candidate run on the same input: its reads and model calls are made, its calls at or above write and calls that act outside are recorded as would-call instead, it asks no one, and each pair's outcomes and calls are compared",
};

/* ═══════════════════ the form ═══════════════════ */

/** The start form: the candidate, its share as a percentage, the mode, and an optional end. */
export interface CanaryForm {
  version: number | null;
  /** A percentage, as typed: "10" is a tenth. */
  share: string;
  mode: CanaryMode;
  /** "" for none; else a time a Date parses (a `datetime-local` value, or ISO 8601). */
  until: string;
}

export const EMPTY_CANARY: CanaryForm = { version: null, share: "10", mode: "canary", until: "" };

/** The share as the door takes it, (0, 1], from a percentage typed in (0, 100]; null when it is not one. */
export function shareOf(text: string): number | null {
  const t = text.trim().replace(/%$/, "").trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  if (!(n > 0 && n <= 100)) return null;
  return Math.round(n * 1000) / 100_000;
}

/** A share as a person reads it: `50%`. */
export const shareText = (share: number): string => pct(share);

/**
 * What the backend would refuse before anything is sent: no candidate, the
 * version production runs (409 `field: version`), a share outside (0, 100]%
 * (400 `field: share`), an end that is not in the future (400 `field: until`).
 */
export function canaryProblem(f: CanaryForm, ctx: { production: number | null; now: number }): string {
  if (f.version === null) return "pick a saved version to run beside production";
  if (ctx.production === null) return "nothing is deployed to production yet: a canary runs beside production";
  if (f.version === ctx.production) return `version ${f.version} is what production runs: pick another version`;
  if (shareOf(f.share) === null) return "the share is a percentage above 0 and at most 100";
  if (f.until.trim()) {
    const t = Date.parse(f.until);
    if (Number.isNaN(t)) return "the end is not a time";
    if (t <= ctx.now) return "the end must be in the future: the canary ends itself then";
  }
  return "";
}

/** The request the form makes; call only once canaryProblem says nothing. */
export function canaryBody(f: CanaryForm): CanaryRequest {
  const body: CanaryRequest = { version: f.version ?? 0, share: shareOf(f.share) ?? 0, mode: f.mode };
  if (f.until.trim()) body.until = new Date(Date.parse(f.until)).toISOString();
  return body;
}

/* ═══════════════════ the report ═══════════════════ */

/** The canary in a line: the candidate, what it takes or mirrors, beside what, until when, and whether it stands. */
export function canaryHeadline(c: CanaryView): string {
  const who = `Version ${c.version ?? "?"} (${shortDigest(c.digest)})`;
  const beside = c.production ? ` beside production's ${v_(c.production)}` : "";
  const what = c.mode === "shadow" ? `mirrors ${shareText(c.share)} of production runs in shadow mode${beside}` : `takes ${shareText(c.share)} of new starts${beside}`;
  const until = c.until ? `, until ${whenText(c.until)}` : "";
  const started = `Configured by ${c.by || "someone"} ${whenText(c.at)}.`;
  if (c.active) return `${who} ${what}${until}. ${started}`;
  const ended = c.ended ? ` Ended ${whenText(c.ended.at)}${c.ended.reason ? `: ${c.ended.reason}` : ""}.` : " It no longer stands.";
  return `${who} ${c.mode === "shadow" ? "mirrored" : "took"} ${shareText(c.share)} of ${c.mode === "shadow" ? "production runs" : "new starts"}${beside}. ${started}${ended}`;
}

/** Production moved since the canary was configured (a deploy or a rollback): the comparison is against what ran then. */
export function productionMoved(c: Pick<CanaryView, "production" | "production_now">): string {
  if (!c.production || !c.production_now) return "";
  if (c.production.digest === c.production_now.digest) return "";
  return `Production runs ${v_(c.production_now)} now; this canary was configured beside ${v_(c.production)}.`;
}

/** The disagreement rate in words: pairs compared and how many disagree, on which field; canary mode compares no pairs. */
export function rateText(c: Pick<CanaryView, "mode" | "compared" | "disagreements" | "rate" | "field" | "pending">): string {
  if (c.mode !== "shadow") return "Canary mode compares no pairs: each arm's own outcomes are below.";
  const on = c.field ? `on ${c.field}` : "on the whole result";
  if (!c.compared) return c.pending ? `No pair compared yet ${on}: ${plural(c.pending, "pair")} still in flight.` : `No pair compared yet ${on}.`;
  const rate = c.rate ?? c.disagreements / c.compared;
  return `${c.disagreements} of ${plural(c.compared, "compared pair")} disagree ${on} (${pct(rate)}).`;
}

/** Why a pair is skipped, not counted, in a person's words. */
export const SKIP_WHY: Record<string, string> = {
  candidate_refused: "the candidate would not start on that input, so there is no shadow run (the production run says why)",
  stand_in: "the shadow only had a stand-in to compare (it failed on a would-call placeholder, or the compared field is one)",
  await: "the shadow ended at an await node: a shadow run asks no one",
  budget: "the shadow ended at a budget instead of pausing for a person: a shadow run asks no one",
  interrupted: "the shadow ended at a call whose worker died: a shadow run asks no one whether it happened",
  killed: "either run was stopped",
};

/** What is pending and what was skipped, in a line; "" when nothing is. */
export function pendingSkippedText(c: Pick<CanaryView, "pending" | "skipped" | "skipped_why">): string {
  const parts: string[] = [];
  if (c.pending) parts.push(`${plural(c.pending, "pair")} pending: either side still in flight`);
  if (c.skipped) {
    const why = Object.entries(c.skipped_why)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${n} because ${SKIP_WHY[k] ?? k.replace(/_/g, " ")}`);
    parts.push(`${plural(c.skipped, "pair")} skipped, not counted${why.length ? `: ${why.join("; ")}` : ""}`);
  }
  return parts.join(". ");
}

/** An outcome as compared: the field's value, or a run that did not finish done (`state:failed`). */
export function outcomeLabel(o: string): string {
  return o.startsWith("state:") ? `run ${o.slice(6)}` : o || "(empty)";
}

/** Each outcome either arm reached, with both arms' counts and shares: the most frequent first. */
export function armRows(arms: { candidate: CanaryArm; production: CanaryArm }): { outcome: string; label: string; candidate: number; production: number; candidateShare: number | null; productionShare: number | null }[] {
  const keys = [...new Set([...Object.keys(arms.candidate.outcomes), ...Object.keys(arms.production.outcomes)])];
  const share = (n: number, of: number) => (of ? n / of : null);
  return keys
    .map((k) => {
      const c = arms.candidate.outcomes[k] ?? 0;
      const p = arms.production.outcomes[k] ?? 0;
      return { outcome: k, label: outcomeLabel(k), candidate: c, production: p, candidateShare: share(c, arms.candidate.finished), productionShare: share(p, arms.production.finished) };
    })
    .sort((a, b) => b.candidate + b.production - (a.candidate + a.production) || a.outcome.localeCompare(b.outcome));
}

/** One arm in a line: its runs, how many finished, and what they cost (unknown once one used a model with no price set). */
export function armLine(arm: CanaryArm): string {
  const cost = typeof arm.cost_usd === "number" ? `$${arm.cost_usd.toFixed(4)}` : arm.cost_usd === null ? "cost unknown (a model with no price set)" : "cost not read";
  return `${plural(arm.runs, "run")}, ${arm.finished} finished, ${cost}`;
}

/** How a shadow's compared pairs' calls compared, in a line; "" for a canary. */
export function callsText(c: Pick<CanaryView, "mode" | "calls">): string {
  if (c.mode !== "shadow" || !c.calls) return "";
  if (!c.calls.compared) return "No pair's calls compared yet.";
  return `${c.calls.differ} of ${plural(c.calls.compared, "compared pair")} called differently (a tool or its arguments); ${c.calls.same} called the same tools with the same arguments.`;
}

/** A condition as the canary reads it: met, unmet and holding the canary, or unmet and only shown (regression). */
export function conditionSays(c: Pick<CanaryCondition, "met" | "required" | "overridden">): { text: string; tone: "ok" | "err" | "warn" } {
  if (c.met) return { text: c.overridden ? "met by override" : "met", tone: "ok" };
  if (c.required) return { text: "unmet: holds the canary", tone: "err" };
  return { text: "unmet: read and shown, not required", tone: "warn" };
}

/** The conditions in the gate's order, each with its label and what it says for the canary. */
export function canaryConditionRows(conditions: readonly CanaryCondition[]): { condition: string; label: string; detail: string; required: boolean; met: boolean; says: string; tone: "ok" | "err" | "warn" }[] {
  return conditions.map((c) => {
    const says = conditionSays(c);
    return { condition: c.condition, label: conditionLabel(c.condition), detail: c.detail, required: c.required, met: c.met, says: says.text, tone: says.tone };
  });
}

/** The gate's refusal of a candidate, in a line. */
export function canaryRefusalText(r: Pick<CanaryRefusal, "version" | "digest" | "environment" | "unmet">): string {
  const what = r.version !== null ? `version ${r.version} (${shortDigest(r.digest)})` : shortDigest(r.digest);
  const unmet = r.unmet.map((u) => conditionLabel(u.condition).toLowerCase());
  return `The deploy conditions hold ${what} back from ${r.environment}: ${unmet.length ? unmet.join(", ") : "nothing"} unmet. A canary runs only a version that meets production's conditions; a shadow needs all but the release threshold. Nothing changed: what stands, stands.`;
}

/** Any other refusal of the canary door, in a person's words; the backend's message when nothing more is known. */
export function canaryErrorText(e: { status: number; message: string; field?: string; control?: string }): string {
  if (e.status === 409 && e.control === "retired") return `The agent is retired: no canary runs beside it. ${e.message}`;
  if (e.status === 409 && e.field === "version") return `${e.message}. A canary runs a saved version other than production's, beside a production deployment.`;
  if (e.status === 404 && e.field === "version") return `${e.message}.`;
  if (e.status === 400 && e.field === "share") return "The share is above 0 and at most 100%.";
  if (e.status === 400 && e.field === "until") return "The end must be in the future: the canary ends itself then.";
  if (e.status === 400 && e.field === "mode") return "The mode is canary or shadow.";
  return e.message;
}

/* ═══════════════════ a run's marks ═══════════════════ */

export type MarkerKind = "shadow" | "canary" | "review" | "taint" | "eval";

/** One mark a run carries wherever runs are listed. */
export interface RunMarker {
  kind: MarkerKind;
  label: string;
  tone: "queue" | "warn" | "neutral" | "run";
  /** The mark, in a sentence, for the title. */
  title: string;
}

/** What a run row (or record) carries beyond its state: the backend's RunRow fields since L8's second round. */
export interface MarkedRun {
  shadow?: boolean | null;
  review?: Record<string, unknown> | null;
  taint?: Record<string, unknown> | null;
  eval?: Record<string, unknown> | null;
  canary?: Record<string, unknown> | null;
}

/** The marks a run carries, in reading order: shadow first (it changes what every other figure means), then canary, review, taint, eval. */
export function runMarkersOf(row: MarkedRun): RunMarker[] {
  const out: RunMarker[] = [];
  const c = o_(row.canary);
  const version = typeof c.version === "number" ? c.version : null;
  if (row.shadow === true) {
    out.push({
      kind: "shadow",
      label: "shadow",
      tone: "queue",
      title: `A shadow run${version !== null ? ` of version ${version}` : ""}${s_(c.of) ? `, mirroring production run ${s_(c.of)}` : ""}: its calls at or above write and calls that act outside were recorded, not made.`,
    });
  } else if (s_(c.id)) {
    const candidate = s_(c.variant) === "candidate";
    const refused = s_(c.shadow_refused);
    out.push({
      kind: "canary",
      label: candidate ? `canary${version !== null ? ` v${version}` : ""}` : s_(c.mode) === "shadow" ? (refused ? "not mirrored" : "mirrored") : "production arm",
      tone: candidate ? "run" : "neutral",
      title: candidate
        ? `This run used the candidate${version !== null ? `, version ${version},` : ""} of canary ${s_(c.id)} instead of production's version.`
        : s_(c.mode) === "shadow"
          ? refused
            ? `The shadow ${s_(c.id)} drew this run and could not mirror it: the candidate would not start on its input (${refused}).`
            : `Production's run, mirrored in shadow mode${s_(c.shadow_run) ? ` by ${s_(c.shadow_run)}` : s_(c.shadow_job) ? ` by job ${s_(c.shadow_job)}` : ""} (canary ${s_(c.id)}).`
          : `Production's arm of canary ${s_(c.id)}${version !== null ? `: it ran version ${version}` : ""}.`,
    });
  }
  const r = o_(row.review);
  if (s_(r.flag)) out.push({ kind: "review", label: r.flag === "rolled_back" ? "rolled back" : `flagged: ${s_(r.flag).replace(/_/g, " ")}`, tone: "warn", title: `Flagged for review${s_(r.reason) ? `: ${s_(r.reason)}` : ""}${s_(r.by) ? ` (by ${s_(r.by)})` : ""}.` });
  const t = taintOf(s_(o_(row.taint).source));
  if (t) out.push({ kind: "taint", label: "untrusted input", tone: "warn", title: `Its input came from outside the estate (taint ${t.source}).` });
  const ev = o_(row.eval);
  if (s_(ev.id)) out.push({ kind: "eval", label: "eval case", tone: "neutral", title: `Case ${s_(ev.case) || "?"} of eval ${s_(ev.id)} on ${s_(ev.set) || "its set"}: drift leaves it out of production's windows.` });
  return out;
}

/** A run's canary in a sentence, for the run page. */
export function canaryRunLine(a: CanaryAssignment, shadow: boolean): string {
  const v = a.version !== null ? `version ${a.version}` : "the candidate";
  if (shadow) {
    return `A shadow run of ${v}${a.id ? ` (canary ${a.id})` : ""}${a.of ? `, mirroring production run ${a.of} on the same input` : ""}. Its reads and model calls were made; each call at or above write and each call that acts outside is journalled as would-call with its arguments, not made, so it wrote no deliverable or finding. It asks no one, so it ends where a run would wait for a person. Its cost is its own and counts toward spend and budgets; it counts toward no rate limit, drift window or results summary, and never waits on the Approvals list.`;
  }
  if (a.variant === "candidate") return `This run used the candidate, ${v}, of canary ${a.id}${a.share !== null ? ` (${shareText(a.share)} of new starts)` : ""}, instead of production's ${v_(a.production)}.`;
  if (a.mode === "shadow" && a.shadow_refused) return `Production's run (${v}). The shadow ${a.id} drew it and could not mirror it: the candidate ${v_(a.candidate)} would not start on its input (${a.shadow_refused}).`;
  if (a.mode === "shadow") return `Production's run (${v}), mirrored in shadow mode by ${a.shadow_run ? `run ${a.shadow_run}` : a.shadow_job ? `job ${a.shadow_job}` : "a shadow"} of the candidate ${v_(a.candidate)} (canary ${a.id}).`;
  return `Production's arm of canary ${a.id}: it ran ${v}, beside the candidate ${v_(a.candidate)}.`;
}

/* ═══════════════════ a shadow run's journal ═══════════════════ */

/** A call a shadow run did not make (`would_call`): the tool, its arguments, its risk, and why it was held. */
export interface WouldCall {
  tool: string;
  args: Record<string, unknown>;
  risk: string;
  sink: boolean;
  /** `sink` (it acts outside), `above_read` (at or above write), or `gate` (the decision would have held it for a person). */
  reason: string;
  note: string;
}

export function wouldCallOf(e: { kind: string; data?: Record<string, unknown> | null }): WouldCall | null {
  if (e.kind !== "would_call") return null;
  const d = o_(e.data);
  const ph = o_(d.placeholder);
  return { tool: s_(d.tool) || s_(ph.would_call), args: o_(d.args), risk: s_(d.risk), sink: d.sink === true, reason: s_(d.reason), note: s_(ph.note) };
}

/** A would-call in a line: what it would have called, and why it did not. */
export function wouldCallLine(w: WouldCall): string {
  const why = w.reason === "gate" ? "a gate would have held it" : w.reason === "sink" || w.sink ? "it acts outside" : w.reason === "above_read" ? "at or above write" : w.reason.replace(/_/g, " ") || "held";
  return `Would have called ${w.tool || "a tool"}${w.risk ? ` (${w.risk}, ${why})` : ` (${why})`}: not made, as a shadow run carries out nothing at or above write and nothing that acts outside.`;
}
