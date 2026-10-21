import type { GuardianAct, GuardianAction, GuardianPatch, GuardianView } from "./api/l7";

/**
 * The guardian's limits as a form, and what it did as lines. The guardian
 * is a supervisory model the backend runs over each covered run's
 * trajectory: within the limits a person sets it may hold a run at its next
 * gate or block (kill) it; outside them it only raises attention. Pure:
 * components/guardian.tsx renders these, tests/l7-logic.test.ts holds them.
 */

/** What the form holds; numbers stay text until saved, so a half-typed value is not lost. */
export interface GuardianForm {
  enabled: boolean;
  model: string;
  /** Every agent ("*"), or the ids listed. */
  allAgents: boolean;
  agents: string[];
  hold: boolean;
  block: boolean;
  max_actions_per_hour: string;
  min_confidence: string;
  rubric: string;
  every_entries: string;
  every_s: string;
}

export function formOf(v: GuardianView): GuardianForm {
  return {
    enabled: v.enabled,
    model: v.model,
    allAgents: v.agents === "*",
    agents: v.agents === "*" ? [] : [...v.agents],
    hold: v.may.includes("hold"),
    block: v.may.includes("block"),
    max_actions_per_hour: String(v.max_actions_per_hour),
    min_confidence: String(v.min_confidence),
    rubric: v.rubric,
    every_entries: String(v.every_entries),
    every_s: String(v.every_s),
  };
}

const AGENT_ID = /^[a-z][a-z0-9-]{0,62}$/;

/** What the backend would refuse, by field, before anything is sent (its limits: GuardianConfig in backend/app/guardian.py). */
export function formProblems(f: GuardianForm): Partial<Record<keyof GuardianForm, string>> {
  const out: Partial<Record<keyof GuardianForm, string>> = {};
  const int = (s: string) => (/^\s*\d+\s*$/.test(s) ? Number(s) : NaN);
  const max = int(f.max_actions_per_hour);
  if (!Number.isInteger(max) || max < 0 || max > 10_000) out.max_actions_per_hour = "a whole number from 0 to 10,000";
  const conf = Number(f.min_confidence);
  if (f.min_confidence.trim() === "" || !Number.isFinite(conf) || conf < 0 || conf > 1) out.min_confidence = "a number from 0 to 1";
  const every = int(f.every_entries);
  if (!Number.isInteger(every) || every < 1 || every > 10_000) out.every_entries = "a whole number from 1 to 10,000";
  const secs = Number(f.every_s);
  if (f.every_s.trim() === "" || !Number.isFinite(secs) || secs < 0.1 || secs > 86_400) out.every_s = "seconds, from 0.1 to 86,400";
  if (f.rubric.length > 4000) out.rubric = "at most 4,000 characters";
  if (f.model.length > 200) out.model = "at most 200 characters";
  const bad = f.allAgents ? [] : f.agents.filter((a) => !AGENT_ID.test(a));
  if (bad.length) out.agents = `not an agent id: ${bad.join(", ")}`;
  return out;
}

/** The limits the guardian's `PUT` names when it refuses one (`400 {error, field}`), as the form lays them out; `body` is the request as a whole. */
export const GUARDIAN_FIELDS = ["enabled", "model", "agents", "may", "max_actions_per_hour", "min_confidence", "rubric", "every_entries", "every_s", "body"] as const;
export type GuardianField = (typeof GUARDIAN_FIELDS)[number];

/** The form's field a refusal names, or null when it names none the form shows (the message then stands alone). */
export function refusedField(field: string | undefined): GuardianField | null {
  return (GUARDIAN_FIELDS as readonly string[]).includes(field ?? "") ? (field as GuardianField) : null;
}

/**
 * The `PUT` body: only what changed. The door merges (a field left out
 * keeps its value) and writes one audit event naming what changed, so
 * sending the untouched fields would only blur that record.
 */
export function patchOf(before: GuardianView, f: GuardianForm): GuardianPatch {
  const out: GuardianPatch = {};
  if (f.enabled !== before.enabled) out.enabled = f.enabled;
  if (f.model.trim() !== before.model) out.model = f.model.trim();
  const agents: string[] | "*" = f.allAgents ? "*" : [...new Set(f.agents.map((a) => a.trim()).filter(Boolean))];
  const same = agents === "*" ? before.agents === "*" : before.agents !== "*" && agents.length === before.agents.length && agents.every((a, i) => a === (before.agents as string[])[i]);
  if (!same) out.agents = agents;
  const may: GuardianAct[] = [...(f.hold ? (["hold"] as const) : []), ...(f.block ? (["block"] as const) : [])];
  if (may.length !== before.may.length || may.some((m) => !before.may.includes(m))) out.may = may;
  const max = Number(f.max_actions_per_hour);
  if (max !== before.max_actions_per_hour) out.max_actions_per_hour = max;
  const conf = Number(f.min_confidence);
  if (conf !== before.min_confidence) out.min_confidence = conf;
  if (f.rubric !== before.rubric) out.rubric = f.rubric;
  const every = Number(f.every_entries);
  if (every !== before.every_entries) out.every_entries = every;
  const secs = Number(f.every_s);
  if (secs !== before.every_s) out.every_s = secs;
  return out;
}

/** Who it watches, in words. */
export function coverageText(v: Pick<GuardianView, "enabled" | "agents">): string {
  if (!v.enabled) return "off: it judges no run";
  if (v.agents === "*") return "every agent's runs";
  if (!v.agents.length) return "on, but no agent is named: it judges no run";
  return `the runs of ${v.agents.join(", ")}`;
}

/** What it may do on its own. */
export function mayText(may: readonly GuardianAct[]): string {
  if (!may.length) return "nothing on its own: every verdict is raised for a person";
  if (may.length === 2) return "hold a run at its next gate, or block (kill) it";
  return may[0] === "hold" ? "hold a run at its next gate; a block is raised for a person" : "block (kill) a run; a hold is raised for a person";
}

/** The hourly cap against what it did in the last hour. */
export function capText(v: Pick<GuardianView, "actions_last_hour" | "max_actions_per_hour">): string {
  if (v.max_actions_per_hour === 0) return `${v.actions_last_hour} acts in the last hour; the cap is 0, so it acts on nothing`;
  return `${v.actions_last_hour} of ${v.max_actions_per_hour} acts in the last hour`;
}

/** When it judges a run. */
export function cadenceText(v: Pick<GuardianView, "every_entries" | "every_s">): string {
  return `every ${v.every_entries} new entr${v.every_entries === 1 ? "y" : "ies"}, or after ${v.every_s} s with at least one`;
}

/** What it did with one verdict, in a line: acted (the hold or the kill landed), or raised for a person and why. */
export function outcomeText(a: Pick<GuardianAction, "outcome" | "action" | "why">): string {
  if (a.outcome === "acted") return a.action === "block" ? "Blocked: the run and what it set off were killed" : "Held: the run waits for a person at its next gate";
  return `Raised for a person: it would ${a.action === "block" ? "block" : "hold"} the run, but ${a.why || "it may not act"}`;
}

/** The verdict with its confidence: "block · 0.95". */
export const verdictText = (a: Pick<GuardianAction, "verdict" | "confidence">): string => `${a.verdict || "?"} · ${a.confidence.toFixed(2)}`;
