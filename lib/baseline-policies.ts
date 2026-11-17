import { CONTROLS, type Reference } from "@/lib/guardrails";

/**
 * The baseline policy set: what the platform does before anyone has changed
 * a setting.
 *
 * Every line here is a default that lives in code (the runtime's policy
 * engine and spec defaults, the backend's settings), read out of it and
 * written in words. Nothing is an aspiration and nothing is a sample: a
 * deployment that has made no policy change behaves exactly like this. That
 * is why it can be shown with nothing connected, and why it is the one set
 * of content this console ships with.
 *
 * Each policy names the catalogue controls (lib/guardrails.ts) that carry it,
 * and takes its standards references from them, so a citation is stated once
 * and in one place. `kind` says how firmly it holds:
 *
 *   fixed    the engine does it for every agent; no setting loosens it
 *   default  a setting with this value until a policy change says otherwise
 *   off      nothing happens until someone turns it on or sets a value
 *
 * `changes` is the only way the default moves: a policy change (proposed,
 * approved by a second person, applied), or the agent's own definition
 * through a new version and its review.
 */

export type BaselineKind = "fixed" | "default" | "off";
export type BaselineArea = "Access" | "Data" | "Human oversight" | "Resilience" | "Integrity" | "Identity and records";

export interface BaselinePolicy {
  id: string;
  area: BaselineArea;
  name: string;
  /** What the policy requires, in one or two sentences. */
  requires: string;
  kind: BaselineKind;
  /** The values it ships with: a name and what it is set to. */
  settings: { name: string; value: string }[];
  /** How the default changes. */
  changes: "policy change" | "agent version" | "deployment setting" | "cannot be changed";
  /** Catalogue controls that carry it. */
  controls: string[];
}

export const BASELINE_AREAS: { area: BaselineArea; purpose: string }[] = [
  { area: "Access", purpose: "What an agent may reach, and on whose authority." },
  { area: "Data", purpose: "What untrusted content may become, what is screened, and what is kept out of records." },
  { area: "Human oversight", purpose: "Which decisions wait for a person, and who may change the rules." },
  { area: "Resilience", purpose: "How far one run, one agent or one failing tool can go." },
  { area: "Integrity", purpose: "That what runs is what was approved." },
  { area: "Identity and records", purpose: "Where secrets are, and what is kept." },
];

export const BASELINE: BaselinePolicy[] = [
  /* ── Access ── */
  {
    id: "BP-01",
    area: "Access",
    name: "Least-privilege tool access",
    requires: "A step may call only the tools granted to it, with arguments inside the limits declared for the tool. A step with no grant can call nothing.",
    kind: "fixed",
    settings: [
      { name: "Tool not granted to the step", value: "refused" },
      { name: "Argument outside the tool's declared scope", value: "refused" },
      { name: "Step with no grant", value: "no tools" },
    ],
    changes: "agent version",
    controls: ["AF-AC-01", "AF-AC-02", "AF-AC-05"],
  },
  {
    id: "BP-02",
    area: "Access",
    name: "Outbound network allowlist",
    requires: "A run may reach only the hosts on the allowlist, over http or https. Private addresses are refused, proxies are never used and every redirect is checked again.",
    kind: "default",
    settings: [
      { name: "Allowlist", value: "empty: only hosts an administrator registered are reachable" },
      { name: "Private and internal addresses", value: "refused" },
      { name: "Redirect to another origin", value: "checked again, credentials stripped" },
    ],
    changes: "deployment setting",
    controls: ["AF-AC-04"],
  },
  {
    id: "BP-03",
    area: "Access",
    name: "Delegation never widens authority",
    requires: "Work handed to another agent runs with no more than the agent handing it over could do, and is held to that agent's stricter approval gates.",
    kind: "fixed",
    settings: [
      { name: "Delegation depth", value: "3 levels" },
      { name: "A delegate asking for more than its caller holds", value: "refused" },
    ],
    changes: "agent version",
    controls: ["AF-AC-06", "AF-RS-02"],
  },
  {
    id: "BP-04",
    area: "Access",
    name: "Third-party agents start with nothing",
    requires: "An agent built elsewhere and attached to this platform holds no tool grant until someone gives it one, and what it sends is screened.",
    kind: "default",
    settings: [
      { name: "Tool grants at attachment", value: "none" },
      { name: "Screening of what it sends", value: "block" },
      { name: "Approval threshold for its calls", value: "not set" },
    ],
    changes: "policy change",
    controls: ["AF-AC-01", "AF-AU-03"],
  },

  /* ── Data ── */
  {
    id: "BP-05",
    area: "Data",
    name: "Untrusted content cannot drive an action",
    requires: "Content that came from outside is marked untrusted, and the mark follows everything built from it. A marked value reaching a tool that acts outside the platform is refused.",
    kind: "default",
    settings: [
      { name: "Untrusted content at a tool that acts outside", value: "refused" },
      { name: "Model reply built from untrusted input", value: "marked untrusted" },
      { name: "Marks that cannot be restored after a pause", value: "treated as untrusted" },
    ],
    changes: "agent version",
    controls: ["AF-DP-01", "AF-DP-02"],
  },
  {
    id: "BP-06",
    area: "Data",
    name: "Prompt and response screening",
    requires: "Prompts built from untrusted content, every model reply and every call that acts outside are screened for instruction override, jailbreak attempts and leaked credentials before they go further.",
    kind: "default",
    settings: [
      { name: "Instruction override and jailbreak phrases", value: "block" },
      { name: "Credential or private key in a reply", value: "block" },
      { name: "Weaker signals (role override, exfiltration, hidden text, encoded content)", value: "flag at two or more" },
      { name: "Screener cannot be reached", value: "block" },
      { name: "Runs taken from the queue by a worker", value: "screened against the agent's and the estate's own phrases; none are set by default" },
      { name: "With Google Model Armor: unsafe content, injection, malicious links", value: "block" },
      { name: "With Google Model Armor: sensitive data", value: "flag, naming the type" },
    ],
    changes: "policy change",
    controls: ["AF-DP-04"],
  },
  {
    id: "BP-07",
    area: "Data",
    name: "Secrets and personal data kept out of records",
    requires: "What a run writes to its record is redacted first. Secrets are removed whatever the data class; personal data is removed from internal data upwards.",
    kind: "default",
    settings: [
      { name: "Keys, tokens, passwords, private keys", value: "redacted at every data class" },
      { name: "Email addresses, phone numbers, payment card numbers, Aadhaar and PAN numbers", value: "redacted from internal data upwards" },
      { name: "Content with no data class", value: "read as internal" },
      { name: "Vault values in a record", value: "masked" },
    ],
    changes: "policy change",
    controls: ["AF-ID-02", "AF-DP-06"],
  },
  {
    id: "BP-08",
    area: "Data",
    name: "Data class ceiling",
    requires: "Data keeps the class it was given, and a step, a tool or a peer agent may not be handed data above the class it is cleared for.",
    kind: "default",
    settings: [
      { name: "Classes", value: "public, internal, confidential, restricted" },
      { name: "Tool with no declared class, in an agent that uses classes", value: "internal" },
      { name: "Task from another agent with no stated class", value: "restricted" },
      { name: "Result above the step's ceiling", value: "withheld" },
    ],
    changes: "agent version",
    controls: ["AF-DP-06", "AF-DP-05"],
  },

  /* ── Human oversight ── */
  {
    id: "BP-09",
    area: "Human oversight",
    name: "Approval gates never pass by themselves",
    requires: "Where an agent declares a gate, the action waits for a named person. A gate nobody answers is escalated; it is never taken as approval.",
    kind: "fixed",
    settings: [
      { name: "Unanswered gate", value: "escalates after 24 hours, unless the gate sets another period" },
      { name: "Gate with no named approver", value: "the agent's owner" },
      { name: "A gate set to proceed on timeout", value: "refused when the agent is saved" },
    ],
    changes: "agent version",
    controls: ["AF-HO-01", "AF-HO-02"],
  },
  {
    id: "BP-10",
    area: "Human oversight",
    name: "Mass-action gate",
    requires: "Repeated calls to the same tool that acts outside the platform stop and wait for a person once they pass a count, across the whole run and its sub-runs.",
    kind: "default",
    settings: [{ name: "Calls to one outside-acting tool before a person is asked", value: "10 per run" }],
    changes: "agent version",
    controls: ["AF-RS-04"],
  },
  {
    id: "BP-11",
    area: "Human oversight",
    name: "Two people to change a policy",
    requires: "A policy change is proposed by one person and approved by another. An emergency rollback by one administrator is allowed, recorded as such and raised for review.",
    kind: "fixed",
    settings: [
      { name: "Approving your own proposal", value: "refused" },
      { name: "With sign-in switched off", value: "there is one operator and no second person, so the check does not apply" },
      { name: "Emergency rollback", value: "one administrator, raised for 7 days" },
      { name: "Record of every change", value: "kept in the audit trail" },
    ],
    changes: "cannot be changed",
    controls: ["AF-HO-04", "AF-HO-02"],
  },
  {
    id: "BP-12",
    area: "Human oversight",
    name: "Autonomy tiers",
    requires: "An agent is released at a tier from L0 to L5, and each tier adds controls the agent must have before it can be promoted.",
    kind: "default",
    settings: [
      { name: "L0 Assist", value: "a person takes every action that matters" },
      { name: "L1 Supervised", value: "a named owner; every destructive call waits for a person" },
      { name: "L2 Bounded", value: "its own budget; risky calls wait for a person" },
      { name: "L3 Conditional", value: "every write and outside-acting call behind a gate; watched by the guardian" },
      { name: "L4 High", value: "untrusted content refused at outside-acting tools; data classes declared; limits outside the model; an evaluation suite" },
      { name: "L5 Full", value: "an approved review for every deployment; owner attestation every 30 days" },
      { name: "Owner attestation period for any agent", value: "90 days" },
    ],
    changes: "policy change",
    controls: ["AF-HO-01"],
  },
  {
    id: "BP-13",
    area: "Human oversight",
    name: "Supervisory model (guardian)",
    requires: "A second model may watch runs and hold, block or redirect them. It acts only above a confidence threshold and only a limited number of times an hour.",
    kind: "off",
    settings: [
      { name: "Guardian", value: "off until enabled" },
      { name: "Confidence needed to act", value: "0.8" },
      { name: "Actions per hour", value: "10 at most" },
    ],
    changes: "policy change",
    controls: ["AF-RS-03"],
  },

  /* ── Resilience ── */
  {
    id: "BP-14",
    area: "Resilience",
    name: "Execution budget and bounds",
    requires: "Every run has a ceiling on what it may consume, counted across its sub-runs, and every loop has a bound. A run that reaches one stops.",
    kind: "default",
    settings: [
      { name: "Tool calls per run", value: "200" },
      { name: "Tokens, cost and elapsed time", value: "not capped until the agent declares a budget" },
      { name: "Steps inside one delegating step", value: "12" },
      { name: "Visits to one step in a cycle", value: "8" },
      { name: "Parallel branches", value: "4" },
      { name: "Time allowed for one tool call", value: "60 seconds" },
    ],
    changes: "agent version",
    controls: ["AF-RS-01"],
  },
  {
    id: "BP-15",
    area: "Resilience",
    name: "Circuit breakers",
    requires: "A tool that acts outside the platform, or a peer agent, that is called too often or fails too often is cut off for a cooling period, for one agent and across the whole estate.",
    kind: "default",
    settings: [
      { name: "One agent: calls to one outside-acting tool or peer", value: "20 in 60 seconds" },
      { name: "One agent: failures", value: "5" },
      { name: "Whole estate: calls to one outside-acting tool or peer", value: "200 in 60 seconds" },
      { name: "Whole estate: failures", value: "10" },
      { name: "Cooling period", value: "5 minutes" },
    ],
    changes: "policy change",
    controls: ["AF-RS-01"],
  },
  {
    id: "BP-16",
    area: "Resilience",
    name: "Rate limits",
    requires: "Each agent is limited in how many runs it may start and queue each minute, and a whole tree of runs has a limit of its own.",
    kind: "default",
    settings: [
      { name: "Run starts per agent", value: "120 a minute" },
      { name: "Sub-runs per agent", value: "300 a minute" },
      { name: "Queued requests per agent", value: "3,000 a minute" },
      { name: "Starts within one tree of runs", value: "200 a minute" },
    ],
    changes: "policy change",
    controls: ["AF-RS-01"],
  },
  {
    id: "BP-17",
    area: "Resilience",
    name: "Stop and lockdown",
    requires: "An operator can stop any run, and the stop is honoured before the next tool call, model call or step. A lockdown holds every write and every outside-acting call across the estate for a person.",
    kind: "fixed",
    settings: [
      { name: "Stop", value: "checked before every tool call, model call and step" },
      { name: "Lockdown", value: "off until switched on" },
      { name: "While locked down", value: "writes and outside-acting calls wait for a person; new runs are refused" },
    ],
    changes: "cannot be changed",
    controls: ["AF-RS-03"],
  },

  /* ── Integrity ── */
  {
    id: "BP-18",
    area: "Integrity",
    name: "Tool servers and peers are pinned",
    requires: "A tool server or a peer agent is used only in the form a person approved. One that was never approved, or whose tool list changed since, is refused until it is approved again.",
    kind: "fixed",
    settings: [
      { name: "Tool server with no approved pin", value: "refused" },
      { name: "Tool list changed after approval", value: "detached until approved again" },
      { name: "Tool description that tries to override, conceal or exfiltrate", value: "refused at admission" },
    ],
    changes: "cannot be changed",
    controls: ["AF-IN-05", "AF-HO-04"],
  },
  {
    id: "BP-19",
    area: "Integrity",
    name: "Unsafe designs do not load",
    requires: "An agent definition is checked before it is saved. One that would let untrusted content reach an outside-acting tool in the same step, or that reaches into safety or control systems, is refused.",
    kind: "fixed",
    settings: [
      { name: "A step holding both an untrusted-content tool and an outside-acting tool", value: "refused" },
      { name: "Tools that write to operational technology or touch a safety system", value: "refused" },
      { name: "Tools that read operational technology", value: "read-only, never outside-acting" },
      { name: "Step inputs and outputs", value: "type-checked; a mismatch is recorded as a breach" },
    ],
    changes: "cannot be changed",
    controls: ["AF-IN-02", "AF-IN-01"],
  },
  {
    id: "BP-20",
    area: "Integrity",
    name: "Isolated code execution",
    requires: "Code an agent runs is run in isolation or not at all: no network, no write access, no privileges, and small limits on memory, processes and time.",
    kind: "fixed",
    settings: [
      { name: "No isolation available", value: "code is not run" },
      { name: "Network", value: "none" },
      { name: "File system", value: "read-only" },
      { name: "Memory, processes, time", value: "256 MB, 64, 30 seconds" },
    ],
    changes: "cannot be changed",
    controls: ["AF-IN-04"],
  },

  /* ── Identity and records ── */
  {
    id: "BP-21",
    area: "Identity and records",
    name: "Credentials by reference",
    requires: "An agent definition names a credential and never contains one. The value is read from the vault at the moment of the call and is masked wherever a record might show it.",
    kind: "fixed",
    settings: [
      { name: "Credential in an agent definition", value: "a name only" },
      { name: "When the value is read", value: "at the call" },
      { name: "Value in a record", value: "masked" },
    ],
    changes: "cannot be changed",
    controls: ["AF-ID-02"],
  },
  {
    id: "BP-22",
    area: "Identity and records",
    name: "Record retention",
    requires: "Runs, their journals, evaluations, deliverables and the audit trail are kept until a retention period is set for them. Records needed as evidence are never swept.",
    kind: "off",
    settings: [
      { name: "Retention period", value: "none set: records are kept" },
      { name: "Runs still running or waiting", value: "never deleted" },
      { name: "Runs whose record fails verification", value: "kept as evidence" },
    ],
    changes: "policy change",
    controls: ["AF-AU-01", "AF-AU-02"],
  },
];

const CONTROL_BY_ID = new Map(CONTROLS.map((c) => [c.id, c]));

/** The standards a policy answers to: the references of the controls that carry it, each once. */
export function referencesOf(p: BaselinePolicy): Reference[] {
  const seen = new Set<string>();
  const out: Reference[] = [];
  for (const id of p.controls) {
    for (const r of CONTROL_BY_ID.get(id)?.references ?? []) {
      const key = `${r.std}|${r.ref}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
  }
  return out;
}

/** A policy's controls as the catalogue names them; an id the catalogue does not hold is left out. */
export function controlsOf(p: BaselinePolicy): { id: string; title: string }[] {
  return p.controls.flatMap((id) => {
    const c = CONTROL_BY_ID.get(id);
    return c ? [{ id: c.id, title: c.title }] : [];
  });
}

export const KIND_LABEL: Record<BaselineKind, string> = { fixed: "Always on", default: "Default setting", off: "Off until set" };
export const KIND_MEANS: Record<BaselineKind, string> = {
  fixed: "The engine does this for every agent. No setting loosens it.",
  default: "Set to this value until it is changed.",
  off: "Nothing happens until someone turns it on or sets a value.",
};
export const CHANGES_LABEL: Record<BaselinePolicy["changes"], string> = {
  "policy change": "A policy change: proposed by one person, approved by another.",
  "agent version": "The agent's own definition: a new version and its review.",
  "deployment setting": "A deployment setting, made where the platform is deployed.",
  "cannot be changed": "It is part of the platform and has no setting.",
};
