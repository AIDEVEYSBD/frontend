import { samePerson, type Access, type Me } from "./mcp-registry";
import { taintOf, type Taint } from "./queue";
import {
  CONDITION_NAMES,
  STAGE_NAMES,
  type AgentSaved,
  type Benchmark,
  type ConditionName,
  type DeploymentList,
  type GateRefusal,
  type Lifecycle,
  type OverrideRecord,
  type OverrideRequest,
  type Retired,
  type RollbackResult,
  type Stage,
  type StageName,
} from "./api/l8";

/**
 * An agent's lifecycle as the console says it (phase L8, first round): the
 * spine from designed to retired, each stage lit only by its own record;
 * the promotion gate's conditions and an administrator's override; who may
 * sign a policy review; which versions a rollback may reinstate; a
 * retirement; what a save did once the agent is deployed (a draft); and the
 * benchmark of what production runs. The backend decides every one of these
 * again (a 409 naming the unmet conditions, a 403 naming
 * `separation_of_duties` or `override` or the missing role, a 409 for a
 * retired agent); these say it in a person's words, or stop a click before
 * it gets that far. Pure: components/lifecycle.tsx and components/deploy-gate.tsx
 * render these, tests/l8-logic.test.ts and tests/l8-contract.test.ts hold
 * them.
 *
 * The second round: the spine's `canary` stage, lit by a deployment row in
 * environment `canary` or `shadow` (`record.current` while the canary
 * stands); a deployment made before L8 lighting `deployed` (`record.adopted`);
 * `current`, where the digest stands now (the furthest stage lit that still
 * holds), so a stage lit by a record that no longer holds (a canary ended, a
 * version rolled back from) reads as past; a run's shadow and canary marks;
 * a paused agent's refusal. tests/l8b-logic.test.ts and
 * tests/l8b-contract.test.ts hold these.
 */

/** An ISO time as the console prints a record's: `2026-10-21 13:50:29 UTC`; "" for none. */
export function whenText(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.replace("T", " ").replace(/\.\d+Z$|Z$/, " UTC");
}

/** A digest, short: the first eight characters, as the version history shows it. */
export const shortDigest = (d: string): string => (d.startsWith("sha256:") ? d.slice(0, 19) : d.slice(0, 8));

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const s_ = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const n_ = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const o_ = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/* ═══════════════════ the spine ═══════════════════ */

export const STAGE_LABEL: Record<StageName, string> = {
  designed: "Designed",
  reviewed: "Reviewed",
  approved: "Approved",
  canary: "Canary",
  deployed: "Deployed",
  retired: "Retired",
};

/** The record that lights each stage, in a line: what to look for when it is dark. */
export const STAGE_RECORD: Record<StageName, string> = {
  designed: "a saved version carrying this digest",
  reviewed: "an approving policy review of this digest, by someone who did not author it",
  approved: "a promotion-gate decision that passed for this digest",
  canary: "a canary deployment of this digest beside production",
  deployed: "a production deployment row of this digest",
  retired: "the agent's retirement",
};

export const stageLabel = (s: string): string => STAGE_LABEL[s as StageName] ?? s.replace(/_/g, " ");

/** past: lit by its own record, which no longer holds (a canary that ended): what happened, not where the digest stands. */
export type StageTone = "ok" | "warn" | "err" | "neutral" | "past";

/** One stage as the spine draws it: lit or dark, who and when, and what its record says. */
export interface SpineStage {
  stage: string;
  label: string;
  lit: boolean;
  /** `by Ada <ada@ey.com> · 2026-10-21 13:50:29 UTC`, or "" for a dark stage. */
  who: string;
  /** What the record says beyond who and when: the review's note, an override's reason, a rollback, that it no longer runs. */
  note: string;
  /** ok: lit by its own record; warn: lit by an override, or deployed and no longer running; err: retired; past: a canary that ended; neutral: dark. */
  tone: StageTone;
  /** The record to look for when it is dark. */
  needs: string;
  /** Where the digest stands now: the backend's `current`, the furthest stage lit that still holds. */
  now: boolean;
}

/** The spine in reading order: the backend's stages (STAGE_NAMES first, anything newer after), each with its line. */
export function spineOf(l: Pick<Lifecycle, "stages" | "deployed" | "digest" | "retired"> & { current?: string | null }): SpineStage[] {
  const order = (s: Stage) => {
    const i = STAGE_NAMES.indexOf(s.stage as StageName);
    return i === -1 ? STAGE_NAMES.length : i;
  };
  return [...l.stages]
    .sort((a, b) => order(a) - order(b))
    .map((s) => {
      const r = o_(s.record);
      const who = s.lit ? [s.by ? `by ${s.by}` : "", whenText(s.at)].filter(Boolean).join(" · ") : "";
      let note = "";
      let tone: StageTone = s.lit ? "ok" : "neutral";
      switch (s.stage) {
        case "designed":
          if (s.lit && s.version !== null) note = `version ${s.version} saved`;
          break;
        case "reviewed":
          if (s.lit) note = s_(r.note) ? `approved: ${s_(r.note)}` : "approved";
          break;
        case "approved": {
          const ov = o_(r.override);
          if (s.lit && s_(ov.reason)) {
            tone = "warn";
            note = `passed by an administrator's override (${(Array.isArray(ov.passed) ? ov.passed.map(s_) : []).join(", ") || "every unmet condition"}): ${s_(ov.reason)}`;
          } else if (s.lit) note = "the gate passed on its own records";
          break;
        }
        case "canary": {
          if (s.lit) {
            const env = s_(r.environment) || "canary";
            const parts: string[] = [];
            // The deployment row's own words: "canary: 0.5 of queued and triggered starts", "shadow: 1 of production runs, mirrored".
            parts.push(s_(r.reason) || (env === "shadow" ? "shadow: a share of production runs, mirrored" : "canary: a share of queued and triggered starts"));
            if (r.current === false) {
              tone = "past";
              parts.push(env === "shadow" ? "the shadow has ended" : "the canary has ended");
            } else if (r.current === true) parts.push(env === "shadow" ? "mirroring production now" : "taking its share now");
            note = parts.join("; ");
          }
          break;
        }
        case "deployed": {
          if (s.lit) {
            const parts: string[] = [];
            // Deployed before L8 kept deployment rows: the version marked deployed stands in for its deployment.
            if (r.adopted === true) parts.push("deployed before deployments were recorded (adopted)");
            if (s_(r.kind) === "rollback") parts.push(`reinstated by a rollback${s_(r.reason) ? `: ${s_(r.reason)}` : ""}`);
            if (s_(o_(r.override).reason)) parts.push(`deployed past the gate by override: ${s_(o_(r.override).reason)}`);
            if (r.current === false) {
              tone = "warn";
              const now = l.deployed;
              parts.push(`no longer what production runs${now?.version !== null && now?.version !== undefined ? ` (version ${now.version} runs now)` : ""}`);
            } else if (r.current === true) parts.push("what production runs now");
            note = parts.join("; ");
          } else if (l.deployed?.adopted && l.deployed.digest === l.digest) {
            note = `production runs this digest (version ${l.deployed.version ?? "?"}), deployed before deployments were recorded: no deployment row lights it`;
          }
          break;
        }
        case "retired":
          if (s.lit) {
            tone = "err";
            const ret = l.retired;
            note = ret ? `${ret.reason}${ret.replacement ? `; replaced by ${ret.replacement}` : ""}` : s_(r.reason);
          }
          break;
      }
      return { stage: s.stage, label: stageLabel(s.stage), lit: s.lit, who, note, tone, needs: STAGE_RECORD[s.stage as StageName] ?? "", now: Boolean(l.current) && s.stage === l.current };
    });
}

/**
 * The stages lit by a record that no longer holds, beyond where the digest
 * stands now, in a person's words: a canary that ended, a deployment
 * production no longer runs. The backend's `current` already steps back
 * past them; this says why.
 */
export function pastOf(l: Pick<Lifecycle, "stages" | "current">): string[] {
  const order = (stage: string) => STAGE_NAMES.indexOf(stage as StageName);
  const at = l.current ? order(l.current) : -1;
  const out: string[] = [];
  for (const s of l.stages) {
    if (!s.lit || order(s.stage) <= at) continue;
    const r = o_(s.record);
    if (r.current !== false) continue;
    if (s.stage === "canary") out.push(s_(r.environment) === "shadow" ? "its shadow beside production has ended" : "its canary has ended");
    else if (s.stage === "deployed") out.push("it was deployed, and production no longer runs it");
  }
  return out;
}

/** The spine's headline: where this digest stands, and what production runs beside it. */
export function spineHeadline(l: Pick<Lifecycle, "current" | "version" | "digest" | "deployed" | "retired"> & { stages?: Lifecycle["stages"] }): string {
  const v = l.version !== null ? `Version ${l.version} (${shortDigest(l.digest)})` : `Digest ${shortDigest(l.digest)}`;
  if (l.retired) return `Retired ${whenText(l.retired.at)} by ${l.retired.by}${l.retired.replacement ? `; replaced by ${l.retired.replacement}` : ""}.`;
  let stage = l.current ? stageLabel(l.current).toLowerCase() : "not yet designed";
  const stages = l.stages ?? [];
  if (l.current === "canary") {
    const reason = s_(o_(stages.find((s) => s.stage === "canary")?.record).reason).replace(/^canary: /, "");
    if (reason) stage = `canary (${reason})`;
  }
  const past = pastOf({ stages, current: l.current });
  if (past.length) stage = `${stage}; ${past.join("; ")}`;
  const running = l.deployed
    ? l.deployed.digest === l.digest
      ? " Production runs it."
      : ` Production runs version ${l.deployed.version ?? "?"} (${shortDigest(l.deployed.digest)})${l.deployed.adopted ? ", deployed before deployments were recorded" : ""}.`
    : " Nothing is deployed to production.";
  return `${v}: ${stage}.${running}`;
}

/* ═══════════════════ the promotion gate ═══════════════════ */

export const CONDITION_LABEL: Record<ConditionName, string> = {
  eval: "Eval",
  review: "Policy review",
  findings: "Open findings",
  regression: "No regression",
  autonomy: "Autonomy tier",
};

/** What each condition asks of exactly the digest being deployed. */
export const CONDITION_ASKS: Record<ConditionName, string> = {
  eval: "an eval of this digest on the spec's own suite, at or above its threshold, run by the backend",
  review: "an approving policy review by someone who did not author this version",
  findings: "nothing open for the agent: its tool servers and peers approved, no guardian, drift or side-channel attention, no breaker open on its sinks",
  regression: "a score not below the deployed predecessor's on the same suite",
  autonomy: "every control the tier its metadata.autonomy declares requires",
};

export const conditionLabel = (c: string): string => CONDITION_LABEL[c as ConditionName] ?? c.replace(/_/g, " ");

/** Where a finding's ref is looked at in the console, or null. */
export function findingHref(item: Record<string, unknown>): string | null {
  const ref = s_(item.ref);
  switch (s_(item.kind)) {
    case "peer":
      return ref ? `/peers#peer-${encodeURIComponent(ref)}` : "/peers";
    case "breaker":
      return "/breakers";
    case "guardian":
      return "/guardian";
    case "drift":
      return "/drift";
    case "server":
      return "/configuration";
    default:
      return null;
  }
}

/**
 * One item the gate read, in a line. An eval (the eval and regression
 * conditions): which version, the score and the threshold. A review: the
 * verdict, who, the note. A finding: its kind, what, and the backend's
 * sentence. Anything else: its detail, or its id.
 */
export function itemLine(item: Record<string, unknown>): string {
  if ("verdict" in item) {
    const verdict = s_(item.verdict) === "approved" ? "approved" : s_(item.verdict) === "changes_requested" ? "changes requested" : s_(item.verdict);
    return `${verdict} by ${s_(item.by) || "someone"}${whenText(s_(item.at)) ? ` ${whenText(s_(item.at))}` : ""}${s_(item.note) ? `: ${s_(item.note)}` : ""}`;
  }
  if ("score" in item || ("passed" in item && "total" in item)) {
    const v = n_(item.version);
    const score = n_(item.score);
    const th = n_(item.threshold);
    const who = v !== null ? `version ${v}` : s_(item.digest) ? shortDigest(s_(item.digest)) : "an eval";
    return `${who}: ${n_(item.passed) ?? 0}/${n_(item.total) ?? 0}${score !== null ? ` (${score.toFixed(4)})` : ""} on ${s_(item.set) || "its suite"}${th !== null ? `, threshold ${th}` : ""} · ${s_(item.id)}`;
  }
  if ("kind" in item && "ref" in item) return `${s_(item.kind).replace(/_/g, " ")} ${s_(item.ref)}: ${s_(item.detail)}`;
  // L9: one requirement of the agent's autonomy tier the gate found unmet.
  if ("requirement" in item) return `${s_(item.tier) ? `${s_(item.tier)} ` : ""}${s_(item.requirement).replace(/_/g, " ")}: ${s_(item.detail)}`;
  return s_(item.detail) || s_(item.id) || JSON.stringify(item);
}

/** The conditions an override may name: the refusal's unmet ones the console knows, in the gate's order. */
export function overrideChoices(r: Pick<GateRefusal, "unmet">): ConditionName[] {
  const unmet = new Set(r.unmet.map((u) => u.condition));
  return CONDITION_NAMES.filter((c) => unmet.has(c));
}

/** The override form: a reason, and either every unmet condition or the ones picked. */
export interface OverrideForm {
  reason: string;
  all: boolean;
  picked: ConditionName[];
}

export const EMPTY_OVERRIDE: OverrideForm = { reason: "", all: true, picked: [] };

/** What the backend would refuse before anything is sent: a reason is required (400 `override.reason`), and naming none of the unmet conditions passes nothing. */
export function overrideProblem(f: OverrideForm): string {
  if (!f.reason.trim()) return "an override needs a reason: it is recorded on the deployment, audited and raised as attention";
  if (!f.all && f.picked.length === 0) return "pick the conditions it passes, or pass every unmet one";
  return "";
}

/** The request's `override`: the reason, and the conditions named (left out to pass every unmet one). */
export function overrideBody(f: OverrideForm): OverrideRequest {
  return f.all ? { reason: f.reason.trim() } : { reason: f.reason.trim(), conditions: CONDITION_NAMES.filter((c) => f.picked.includes(c)) };
}

/** What the override would do: the conditions it passes, and the unmet ones that would still hold the deploy. */
export function overrideOutcome(f: OverrideForm, r: Pick<GateRefusal, "unmet">): { passes: string[]; holds: string[] } {
  const unmet = r.unmet.map((u) => u.condition);
  if (f.all) return { passes: unmet, holds: [] };
  return { passes: unmet.filter((c) => f.picked.includes(c as ConditionName)), holds: unmet.filter((c) => !f.picked.includes(c as ConditionName)) };
}

/** Who may override: an administrator only (the backend answers 403 `control: override` to anyone else). */
export function canOverride(who: { appRoles?: readonly string[] } | null): boolean {
  return Boolean(who?.appRoles?.includes("administrator"));
}

/** An override as the record keeps it, in a line. */
export function overrideLine(o: OverrideRecord): string {
  const passed = o.passed.length ? o.passed.map(conditionLabel).join(", ") : "nothing";
  return `Override by ${o.by || "an administrator"}${o.at ? ` ${whenText(o.at)}` : ""}: passed ${passed}. Reason: ${o.reason}${o.audit_id !== null ? ` · audit event #${o.audit_id}` : ""}`;
}

/** The gate's refusal in one line: which version, how many conditions unmet, and whether a draft was kept. */
export function gateSummary(r: GateRefusal): string {
  const what = r.version !== null ? `version ${r.version} (${shortDigest(r.digest)})` : shortDigest(r.digest);
  const unmet = r.unmet.map((u) => conditionLabel(u.condition).toLowerCase());
  const kept = r.saved ? ` Version ${r.saved.version ?? "?"} is saved${r.saved.draft ? " as a draft" : ""}; nothing that runs changed.` : " Nothing that runs changed.";
  return `The promotion gate holds ${what} for ${r.environment}: ${unmet.length ? unmet.join(", ") : "nothing"} unmet.${kept}`;
}

/* ═══════════════════ reviews ═══════════════════ */

export const VERDICT_LABEL: Record<string, string> = { approved: "Approved", changes_requested: "Changes requested" };
export const verdictLabel = (v: string): string => VERDICT_LABEL[v] ?? v.replace(/_/g, " ");

/** Who the console knows is here, for a review: the signature parts and every role the backend reads (app roles, role claims, group claims). */
export interface Reviewer extends Me {
  roles?: readonly string[];
  appRoles?: readonly string[];
  groups?: readonly string[];
}

/** Everyone who saved a version carrying the digest: the authors, none of whom may review it. */
export function authorsOf(versions: readonly { digest: string; saved_by: string }[], digest: string): string[] {
  return [...new Set(versions.filter((v) => v.digest === digest && v.saved_by.trim()).map((v) => v.saved_by))];
}

/**
 * Whether this person may sign a review of a digest: not its author
 * (separation of duties, administrator or not), and holding the reviewer
 * role (or an administrator). The backend refuses the same two ways (403
 * `control: separation_of_duties`, 403 `missing_role`); the approve
 * permission is the button's own check.
 */
export function reviewAccess(who: Reviewer | null, authors: readonly string[], role: string): Access {
  if (!who) return { ok: false, reason: "who you are is not known yet" };
  const mine = authors.find((a) => samePerson(a, who));
  if (mine) return { ok: false, reason: `you saved this version (${mine}): its author may not review it; another policy reviewer signs` };
  if (who.appRoles?.includes("administrator")) return { ok: true, reason: "" };
  const held = new Set([...(who.roles ?? []), ...(who.appRoles ?? []), ...(who.groups ?? [])]);
  if (held.has(role)) return { ok: true, reason: "" };
  return { ok: false, reason: `a policy review needs the "${role}" role (or an administrator); yours: ${[...held].join(", ") || "none"}` };
}

/** A refused review in a person's words: separation of duties names the authors, a missing role names the role. */
export function reviewRefusalText(e: { status: number; message: string; control?: string; missingRole?: string; body: Record<string, unknown> }): string {
  if (e.status === 403 && e.control === "separation_of_duties") {
    const authors = Array.isArray(e.body.authors) ? e.body.authors.map(s_).filter(Boolean) : [];
    return `Separation of duties: the author of a version may not review it${authors.length ? ` (authors: ${authors.join(", ")})` : ""}. Another policy reviewer signs. ${e.message}`;
  }
  if (e.status === 403 && e.missingRole) return `Only a holder of the "${e.missingRole}" role (or an administrator) signs a policy review. ${e.message}`;
  return e.message;
}

/** The newest review of a digest (the list is newest first), or null. */
export function latestReviewOf<T extends { digest: string }>(reviews: readonly T[], digest: string): T | null {
  return reviews.find((r) => r.digest === digest) ?? null;
}

/* ═══════════════════ rollback ═══════════════════ */

/** A version a rollback may reinstate: it ran in production before, and is not what runs now. */
export interface RollbackTarget {
  version: number;
  digest: string;
  /** When it last went to production. */
  at: string;
  /** How: a deploy, a rollback, or adopted (deployed before deployments were recorded). */
  how: string;
}

/**
 * The versions a rollback may name: every version with a production
 * deployment row (a deploy or a rollback), and one marked deployed before
 * rows were kept (`adopted`), less what production runs now; the newest
 * first, each once.
 */
export function rollbackTargets(list: Pick<DeploymentList, "deployments" | "current" | "adopted">): RollbackTarget[] {
  const running = list.current.production?.version ?? list.adopted?.version ?? null;
  const out = new Map<number, RollbackTarget>();
  for (const d of list.deployments) {
    if (d.environment !== "production" || d.version === null || d.version === running) continue;
    if (!out.has(d.version)) out.set(d.version, { version: d.version, digest: d.digest, at: d.at, how: d.kind });
  }
  return [...out.values()].sort((a, b) => b.version - a.version);
}

/** What the backend would refuse before anything is sent: a version to reinstate, and a reason (400 `field: reason`). */
export function rollbackProblem(toVersion: number | null, reason: string): string {
  if (toVersion === null) return "pick a version that ran in production before";
  if (!reason.trim()) return "a rollback needs a reason: it is recorded on the deployment and on every run it flags";
  return "";
}

/** A rollback's receipt in one line. */
export function rollbackLine(r: Pick<RollbackResult, "from" | "to" | "reason" | "count" | "by">): string {
  const flagged = r.count ? `${plural(r.count, "run")} of version ${r.from.version ?? "?"} flagged for review` : `no run of version ${r.from.version ?? "?"} to flag`;
  return `Rolled back from version ${r.from.version ?? "?"} to ${r.to.version ?? "?"}${r.by ? ` by ${r.by}` : ""}: ${r.reason}. ${flagged}.`;
}

/** A run's rollback flag (`review` on its record), or null for a run nobody flagged. */
export interface RunFlag {
  flag: string;
  from: { version: number | null; digest: string };
  to: { version: number | null; digest: string };
  reason: string;
  by: string;
  at: string;
}

export function runFlagOf(record: unknown): RunFlag | null {
  const r = o_(o_(record).review);
  if (!s_(r.flag)) return null;
  const p = (v: unknown) => ({ version: n_(o_(v).version), digest: s_(o_(v).digest) });
  return { flag: s_(r.flag), from: p(r.from), to: p(r.to), reason: s_(r.reason), by: s_(r.by), at: s_(r.at) };
}

/** A flag in a line, for the run page. */
export function runFlagLine(f: RunFlag): string {
  if (f.flag === "rolled_back") return `This run is of version ${f.from.version ?? "?"}, which ${f.by || "someone"} rolled back to version ${f.to.version ?? "?"}${f.at ? ` ${whenText(f.at)}` : ""}: ${f.reason}. Review what it did.`;
  return `Flagged ${f.flag.replace(/_/g, " ")}${f.by ? ` by ${f.by}` : ""}${f.reason ? `: ${f.reason}` : ""}.`;
}

/* ═══════════════════ retirement ═══════════════════ */

/** A retirement in one line, wherever the agent appears. */
export function retiredLine(r: Pick<Retired, "reason" | "replacement" | "by" | "at">): string {
  return `Retired${r.by ? ` by ${r.by}` : ""}${r.at ? ` ${whenText(r.at)}` : ""}: ${r.reason}.${r.replacement ? ` Replaced by ${r.replacement}.` : ""} It takes no new runs or triggers; its runs and versions stay readable.`;
}

/** A paused agent's refusal (409 `control: "paused"`) where the run was started: why, who, when, and how it ends. */
export function pausedLine(agent: string, p: { mode: string; reason: string; by: string; at: string }): string {
  const what = p.mode === "drain" ? "draining" : "paused";
  const who = [p.by ? `by ${p.by}` : "", whenText(p.at)].filter(Boolean).join(", ");
  return `${agent || "This agent"} is ${what}${p.reason ? `: ${p.reason}` : ""}${who ? ` (${who})` : ""}. It takes no new runs or triggers until it is resumed on the Control page.`;
}

/** What the backend would refuse before anything is sent: a reason (400), and a replacement that is another saved agent (400/404 `field: replacement`). */
export function retireProblem(agent: string, reason: string, replacement: string, saved: readonly string[]): string {
  if (!reason.trim()) return "a retirement needs a reason";
  const r = replacement.trim();
  if (!r) return "";
  if (r === agent) return "the replacement is another agent, not this one";
  if (saved.length && !saved.includes(r)) return `no saved agent "${r}"`;
  return "";
}

/* ═══════════════════ drafts ═══════════════════ */

/**
 * What a save did, in a line. Once an agent is deployed a save is a draft:
 * a version row and nothing else; production keeps running its version
 * until a deploy. Before that, the save is what runs.
 */
export function savedLine(saved: Pick<AgentSaved, "draft" | "version">, running: number | null): string {
  const v = saved.version !== null ? `version ${saved.version}` : "this version";
  if (saved.draft) return `Saved ${v} as a draft. Production keeps running ${running !== null ? `version ${running}` : "the deployed version"} until a deploy.`;
  return `Saved ${v}. The agent is not deployed yet, so the save is what runs.`;
}

/** A save whose deploy the gate held, in a line: the version is kept, and what runs did not move. */
export function gatedSaveLine(saved: Pick<AgentSaved, "draft" | "version">): string {
  const v = saved.version !== null ? `Version ${saved.version}` : "This version";
  return saved.draft
    ? `${v} is saved as a draft. Production keeps running its deployed version until a deploy passes the gate.`
    : `${v} is saved, and is what runs until the agent's first deploy passes the gate.`;
}

/**
 * The version whose document the builder edits: the latest save when it is
 * not what runs (a draft newer than the deployed version), else null (the
 * document `GET /api/agents/{id}` answers is the latest).
 */
export function draftToLoad(d: { version?: number | null; spec_version?: number | null }): number | null {
  const latest = d.version ?? null;
  if (latest === null) return null;
  return (d.spec_version ?? null) === latest ? null : latest;
}

/** The builder's banner over a draft: what is being edited against what runs. */
export function draftBanner(d: { version?: number | null; deployed_version?: number | null }): string {
  const latest = d.version ?? null;
  const running = d.deployed_version ?? null;
  if (latest === null || running === null || latest === running) return "";
  return `Editing draft version ${latest}. Production runs version ${running}; a save stays a draft until it is deployed through the promotion gate.`;
}

/* ═══════════════════ the benchmark ═══════════════════ */

/** The benchmark in one line: the score against the threshold, the model, and what it measured against what runs. */
export function benchmarkLine(b: Benchmark): string {
  const score = b.score !== null ? ` (${b.score.toFixed(3)})` : "";
  const th = b.threshold === null ? "no threshold" : b.passed_threshold === true ? `at or above the threshold ${b.threshold}` : b.passed_threshold === false ? `under the threshold ${b.threshold}` : `threshold ${b.threshold}`;
  const what = b.version !== null ? `version ${b.version} (${shortDigest(b.digest)})` : shortDigest(b.digest);
  const vs = b.matches_deployed
    ? "what production runs"
    : b.deployed
      ? `not what production runs (version ${b.deployed.version ?? "?"})`
      : "nothing is deployed yet";
  return `${b.passed}/${b.total}${score} on ${b.set}, ${th} · model ${b.model} · measured ${what}, ${vs}`;
}

/* ═══════════════════ what a run's record says about it ═══════════════════ */

/** The message an A2A task brought in, as the run's journal records it (`a2a.message`, direction in). */
export interface Inbound {
  peer: string;
  digest: string;
  bytes: number;
  /** allow, flag: what the screener said of it on the way in. */
  screen: string;
  task: string;
  signed: boolean;
}

/**
 * Which version a run used while a canary stood (phase L8, second round):
 * the record's (and its job's) `canary`. `variant` candidate: the canary's
 * version ran instead of production's (canary mode), or a shadow mirrored a
 * production run (`of`, `of_job`); production: production's arm, mirrored
 * by `shadow_run` or `shadow_job` in shadow mode.
 */
export interface CanaryAssignment {
  id: string;
  mode: string;
  variant: string;
  /** The version this run used. */
  version: number | null;
  digest: string;
  share: number | null;
  candidate: { version: number | null; digest: string } | null;
  production: { version: number | null; digest: string } | null;
  /** A shadow's production run, and its job on the queue. */
  of: string;
  of_job: string;
  /** A production run's mirror: its shadow run (in process) or shadow job (on the queue). */
  shadow_run: string;
  shadow_job: string;
}

export function canaryAssignmentOf(v: unknown): CanaryAssignment | null {
  const c = o_(v);
  if (!s_(c.id) && !s_(c.variant)) return null;
  const point = (x: unknown) => (x && typeof x === "object" ? { version: n_(o_(x).version), digest: s_(o_(x).digest) } : null);
  return {
    id: s_(c.id),
    mode: s_(c.mode) || "canary",
    variant: s_(c.variant),
    version: n_(c.version),
    digest: s_(c.digest),
    share: n_(c.share),
    candidate: point(c.candidate),
    production: point(c.production),
    of: s_(c.of),
    of_job: s_(c.of_job),
    shadow_run: s_(c.shadow_run),
    shadow_job: s_(c.shadow_job),
  };
}

/** What a run's record says beyond its journal: a rollback's flag, the taint of its input, the eval it is a case of, the job behind it. */
export interface RunFlags {
  review: RunFlag | null;
  /** `taint: {source, input}` on the record: its input came from outside the estate. */
  taint: Taint | null;
  inbound: Inbound | null;
  /** `eval: {id, case, set}`: a case of an eval, which drift leaves out. */
  eval: { id: string; case: string; set: string } | null;
  /** The trigger job it ran for (a worker's run). */
  job: string;
  /** A canary's shadow run (`shadow: true`): nothing above read executed, and it counts toward no production figure. */
  shadow: boolean;
  /** Which version it used while a canary stood. */
  canary: CanaryAssignment | null;
}

export function runFlagsOf(record: unknown): RunFlags {
  const r = o_(record);
  const taint = o_(r.taint);
  const ev = o_(r.eval);
  const entries = Array.isArray(o_(r.journal).entries) ? (o_(r.journal).entries as unknown[]) : [];
  const msg = entries.map(o_).find((e) => e.kind === "a2a.message" && o_(e.data).direction === "in");
  const d = o_(msg?.data);
  return {
    review: runFlagOf(r),
    taint: taintOf(s_(taint.source)),
    inbound: msg ? { peer: s_(d.peer) || s_(d.agent), digest: s_(d.digest), bytes: n_(d.bytes) ?? 0, screen: s_(d.screen), task: s_(d.task), signed: d.signed === true } : null,
    eval: s_(ev.id) ? { id: s_(ev.id), case: s_(ev.case), set: s_(ev.set) } : null,
    job: s_(r.job),
    shadow: r.shadow === true,
    canary: canaryAssignmentOf(r.canary),
  };
}

/** Whether a record carries anything RunFlagsBanner would say. */
export const hasRunFlags = (f: RunFlags): boolean => Boolean(f.review || f.taint || f.inbound || f.eval || f.shadow || f.canary);

/** The inbound message in a line: who sent it, its size and digest, and what the screener said. */
export function inboundLine(m: Inbound): string {
  return `Message from peer ${m.peer || "an A2A caller"}${m.task ? ` (task ${m.task})` : ""}: ${m.bytes} bytes, ${m.digest ? shortDigest(m.digest) : "no digest"}, screened ${m.screen || "?"}${m.signed ? ", signed" : ""}.`;
}
