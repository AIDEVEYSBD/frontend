import { WORKLOADS, type Answer, type DatasetRef, type Door, type WorkloadList, type WorkloadOffer } from "@/lib/api/pending";
import { explainControl } from "@/lib/guardrails";

/**
 * The four security workloads, as the product is structured.
 *
 * Each workload is a deployed agent that a person runs on what they hand
 * over. What a workload takes, where a person decides and what comes out are
 * the client's requirements, so they are written here as the default set-up:
 * the form a person is shown, disabled, until `GET /api/workloads`
 * (lib/api/pending.ts) names the inputs and gates of the agent that is
 * actually deployed. The door's answer always replaces the default.
 *
 * Nothing here is a record: no target, file, rule or finding is named, and no
 * line says a workload ran or found anything. The second half reads a run's
 * record into the plain words the "First run" step uses.
 */

export type WorkloadInput = WorkloadOffer["inputs"][number];
export type WorkloadGate = WorkloadOffer["gates"][number];
export type WorkloadIcon = "file-code" | "crosshair" | "brick-wall" | "radar" | "shield-check";

export interface WorkloadProfile {
  id: string;
  name: string;
  line: string;
  icon: WorkloadIcon;
  /** What a person hands over. */
  handsOver: string[];
  /** Where a person decides. */
  decides: string[];
  /** What comes out. */
  produces: string[];
  /** The default set-up form, shown until the door names the inputs. */
  inputs: WorkloadInput[];
  /** The gates the requirements name; a role left empty is named by the deployed agent. */
  gates: WorkloadGate[];
  /** What a person decides once a run has finished. */
  afterwards: string;
  /** What an approver is asked to approve before anything runs, when the workload has such a gate. */
  approval?: { gate: string; scope: string; methods: string };
}

const TRIAGE = "Each finding is then triaged by a person on the Findings page: confirmed, marked a false positive, accepted or remediated, with a note.";

const PROFILES: Record<string, Omit<WorkloadProfile, "id" | "name" | "line">> = {
  sast: {
    icon: "file-code",
    handsOver: ["A code snapshot"],
    decides: ["On each finding: confirmed, or marked a false positive"],
    produces: ["Vulnerabilities and candidate attack paths, validated", "Prioritised findings with remediation guidance", "A report"],
    inputs: [{ name: "code", label: "Code snapshot", kind: "dataset", dataset_kind: "code", required: true, help: "An archive of the repository to analyse." }],
    gates: [],
    afterwards: TRIAGE,
  },
  pentest: {
    icon: "crosshair",
    handsOver: ["Signed rules of engagement", "The allowed targets", "The test window", "The asset and interface inventory"],
    decides: ["Scope and methods, before anything runs", "Sign-offs on the report"],
    produces: ["Execution target by target, with evidence", "A risk-ranked report", "Remediation, rollback and retest guidance"],
    inputs: [
      { name: "rules_of_engagement", label: "Signed rules of engagement", kind: "dataset", dataset_kind: "document", required: true, help: "The signed document the test is held to." },
      { name: "targets", label: "Allowed targets", kind: "list", required: true, help: "Nothing outside this list is in scope." },
      { name: "window", label: "Test window", kind: "date_range", required: true, help: "Testing takes place between these two times." },
      { name: "inventory", label: "Asset and interface inventory", kind: "dataset", dataset_kind: "document", required: true, help: "The assets and interfaces the targets belong to." },
    ],
    gates: [
      { name: "Scope and methods", role: "", when: "Before anything runs" },
      { name: "Report sign-offs", role: "", when: "When the report is ready" },
    ],
    afterwards: TRIAGE,
    approval: {
      gate: "Scope and methods",
      scope: "The scope is what is handed over on the first step: the rules of engagement, the allowed targets, the test window and the inventory.",
      methods: "The methods are the ones the agent proposes for these targets, within the signed rules of engagement. The approver reads them at the gate, and nothing is executed before the answer.",
    },
  },
  firewall: {
    icon: "brick-wall",
    handsOver: ["Approved exports of rules, objects, NAT and topology", "Usage and context, where available"],
    decides: ["The rule owner, on a proposed change", "A security approver, on a proposed change"],
    produces: ["Effective policy and rule risks, with evidence", "Narrowed or time-bound changes, as proposals", "Rollback guidance and stated limitations"],
    inputs: [
      { name: "export", label: "Approved export", kind: "dataset", dataset_kind: "firewall_export", required: true, help: "Rules, objects, NAT and topology, as approved for review." },
      { name: "usage", label: "Usage and context", kind: "dataset", required: false, help: "Hit counts, logs or change context, where available." },
    ],
    gates: [
      { name: "Proposed changes: the owner's decision", role: "Rule owner", when: "When the review proposes a change" },
      { name: "Proposed changes: the security decision", role: "Security approver", when: "When the review proposes a change" },
    ],
    afterwards: TRIAGE,
  },
  threat_hunt: {
    icon: "radar",
    handsOver: ["Security telemetry", "Threat intelligence", "As an offline extract, or through an approved live connection"],
    decides: ["On each assessment, on the shared review and report screens"],
    produces: ["An investigation of suspicious activity", "Assessments, on the shared review and report screens"],
    inputs: [
      { name: "telemetry", label: "Security telemetry", kind: "dataset", dataset_kind: "telemetry", required: true, help: "An offline extract, or a dataset that reads through an approved live connection." },
      { name: "threat_intelligence", label: "Threat intelligence", kind: "dataset", required: false, help: "The intelligence the telemetry is investigated against." },
    ],
    gates: [],
    afterwards: "Each assessment is then reviewed by a person on the shared screens: Findings for the assessment, Deliverables for the report.",
  },
};

/** A workload's product structure. One the product does not know (the door may list more) has only what the door says. */
export function profileOf(id: string, offer?: WorkloadOffer | null): WorkloadProfile {
  const known = WORKLOADS.find((w) => w.id === id);
  const p = PROFILES[id];
  if (known && p) return { id, name: known.name, line: known.line, ...p };
  return { id, name: offer?.name || id, line: "", icon: "shield-check", handsOver: [], decides: [], produces: [], inputs: [], gates: [], afterwards: "" };
}

export const isKnownWorkload = (id: string): boolean => WORKLOADS.some((w) => w.id === id);

/* ═══════════════════ the address ═══════════════════ */

export const WORKLOAD_TABS = [
  { id: "setup", label: "Set up" },
  { id: "findings", label: "Findings" },
  { id: "report", label: "Report" },
  { id: "acceptance", label: "Acceptance" },
] as const;
export type WorkloadTab = (typeof WORKLOAD_TABS)[number]["id"];

export const SETUP_STEPS = [
  { id: "inputs", label: "What it runs on" },
  { id: "gates", label: "Who decides" },
  { id: "limits", label: "Limits" },
  { id: "review", label: "Review and start" },
  { id: "first-run", label: "First run" },
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number]["id"];

export const tabOf = (v: string | null): WorkloadTab => WORKLOAD_TABS.find((t) => t.id === v)?.id ?? "setup";
export const stepOf = (v: string | null): SetupStep => SETUP_STEPS.find((s) => s.id === v)?.id ?? "inputs";

/** `/workloads?id=&tab=&step=&run=&finding=`; the default tab and step are left out. */
export function workloadHref(id: string, q: { tab?: WorkloadTab; step?: SetupStep; run?: string; finding?: string } = {}): string {
  const p = new URLSearchParams({ id });
  if (q.tab && q.tab !== "setup") p.set("tab", q.tab);
  if (q.step && q.step !== "inputs") p.set("step", q.step);
  if (q.run) p.set("run", q.run);
  if (q.finding) p.set("finding", q.finding);
  return `/workloads?${p.toString()}`;
}

/* ═══════════════════ what the door says ═══════════════════ */

/** `runs_outside`: an attached agent runs it, written and run outside the platform; it opens its own runs, so none is started here. */
export type OfferState = "reading" | "pending" | "error" | "available" | "not_deployed" | "not_listed" | "runs_outside";
export type OfferTone = "neutral" | "ok" | "err" | "queue";

export interface OfferReading {
  state: OfferState;
  label: string;
  tone: OfferTone;
  /** Why a run cannot be started, in a sentence; empty when it can. */
  why: string;
  /** The same in a few words, for a card. */
  short: string;
  offer: WorkloadOffer | null;
  agent: string;
  /** The attached agent that runs it, when one does (the door's `attached`); empty otherwise. */
  attached: string;
  door?: Door;
}

const words = (raw: string): string => {
  const s = raw.replace(/_/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "";
};

/** One workload's state, from the workloads door's answer. */
export function readOffer(answer: Answer<WorkloadList> | null, id: string): OfferReading {
  const none = { offer: null, agent: "", attached: "" };
  if (answer === null) return { state: "reading", label: "Reading", tone: "neutral", why: "The control plane has not answered yet.", short: "", ...none };
  if (answer.state === "pending") return { state: "pending", label: "Not built", tone: "neutral", why: "The platform does not answer the workloads address yet, so no agent is named to run it.", short: "No agent is named to run it yet.", door: answer.door, ...none };
  if (answer.state === "error") return { state: "error", label: "Could not be read", tone: "err", why: `The workloads could not be read: ${answer.message}`, short: "Its state could not be read.", ...none };
  const list = Array.isArray(answer.data?.workloads) ? answer.data.workloads : [];
  const offer = list.find((w) => w && w.id === id) ?? null;
  if (!offer) return { state: "not_listed", label: "Not offered", tone: "neutral", why: "The control plane does not list this workload on this deployment.", short: "Not listed by the control plane.", ...none };
  const agent = typeof offer.agent === "string" ? offer.agent : "";
  const attached = typeof offer.attached === "string" ? offer.attached : "";
  if (offer.status === "available" && attached) {
    // An attached agent runs outside the platform and opens its own runs through the SDK: the platform refuses a start of it, so none is offered here.
    const why = `Run by the attached agent ${attached}, written and run outside the platform: it opens its own runs through the SDK, so a run is not started from this page. Its runs and findings are filed under this workload.`;
    return { state: "runs_outside", label: "Attached agent", tone: "ok", why, short: why, offer, agent: "", attached };
  }
  if (offer.status === "available") {
    // `available` means the workload's agent is deployed. The platform does not name that agent, so a run is not started from this page; chat starts one by the workload's name.
    if (!agent) return { state: "not_deployed", label: "Deployed", tone: "ok", why: "The platform says this workload's agent is deployed and does not name the agent, so a run is not started from this page.", short: "Its agent is deployed; it is not named here.", offer, agent, attached };
    return { state: "available", label: "Available", tone: "ok", why: "", short: "", offer, agent, attached };
  }
  // Not available: the status in words, and the platform's own reason (no deployed agent, no use case, a use case not yet approved).
  const said = typeof offer.reason === "string" && offer.reason.trim() ? offer.reason.trim() : "";
  const known = offer.status === "not_deployed";
  const why = said ? `${said[0].toUpperCase()}${said.slice(1)}.` : known ? "No agent is deployed to run this workload yet." : `The control plane reports this workload as ${words(String(offer.status)).toLowerCase() || "not available"}, and gives no reason.`;
  return { state: "not_deployed", label: known ? "Not deployed" : words(String(offer.status).replace(/^use_case_/, "use case ")) || "Not available", tone: "queue", why, short: why, offer, agent, attached };
}

/** The offers the door lists beyond the four the product knows. */
export function otherOffers(answer: Answer<WorkloadList> | null): WorkloadOffer[] {
  if (answer?.state !== "ok" || !Array.isArray(answer.data?.workloads)) return [];
  return answer.data.workloads.filter((w) => w && typeof w.id === "string" && !isKnownWorkload(w.id));
}

/** The form a person fills in: the door's inputs once it names them, the default until then. */
export function formOf(profile: WorkloadProfile, r: OfferReading): { inputs: WorkloadInput[]; from: "door" | "default"; open: boolean } {
  const said = r.offer && Array.isArray(r.offer.inputs) ? r.offer.inputs.filter((i) => i && typeof i.name === "string") : null;
  if (said && (said.length > 0 || r.state === "available")) return { inputs: said, from: "door", open: r.state === "available" };
  return { inputs: profile.inputs, from: "default", open: false };
}

/** The gates: the door's once it names them, the requirements' until then. An attached agent's are its approved policy's. */
export function gatesOf(profile: WorkloadProfile, r: OfferReading): { gates: WorkloadGate[]; from: "door" | "default" } {
  const said = r.offer && Array.isArray(r.offer.gates) ? r.offer.gates.filter((g) => g && typeof g.name === "string") : null;
  if (said && (said.length > 0 || r.state === "available" || r.state === "runs_outside")) return { gates: said, from: "door" };
  return { gates: profile.gates, from: "default" };
}

/* ═══════════════════ what a person gives ═══════════════════ */

export interface DateRange {
  from: string;
  to: string;
}
/** A dataset is its id, a list is its text (one entry per line), a time window is two local date-times. */
export type InputValue = string | boolean | DateRange | null;
export type InputValues = Record<string, InputValue>;

export function emptyValue(i: WorkloadInput): InputValue {
  if (i.kind === "bool") return false;
  if (i.kind === "date_range") return { from: "", to: "" };
  if (i.kind === "dataset") return null;
  return "";
}

export const valueOf = (i: WorkloadInput, values: InputValues): InputValue => (i.name in values ? values[i.name] : emptyValue(i));

export const listOf = (text: string): string[] =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

const rangeOf = (v: InputValue): DateRange => (v && typeof v === "object" ? v : { from: "", to: "" });

export function isGiven(i: WorkloadInput, v: InputValue): boolean {
  if (i.kind === "bool") return true;
  if (i.kind === "date_range") return Boolean(rangeOf(v).from && rangeOf(v).to);
  if (i.kind === "list") return typeof v === "string" && listOf(v).length > 0;
  return typeof v === "string" && v.trim() !== "";
}

/** What stops a start, input by input, each as a sentence: a required one not given, a window that ends before it starts. */
export function inputProblems(inputs: WorkloadInput[], values: InputValues): { name: string; problem: string }[] {
  const out: { name: string; problem: string }[] = [];
  for (const i of inputs) {
    const v = valueOf(i, values);
    if (i.kind === "date_range") {
      const r = rangeOf(v);
      if (r.from && r.to && Date.parse(r.to) <= Date.parse(r.from)) {
        out.push({ name: i.name, problem: `${i.label}: the end is not after the start.` });
        continue;
      }
      if ((r.from || r.to) && !(r.from && r.to)) {
        out.push({ name: i.name, problem: `${i.label}: both a start and an end are needed.` });
        continue;
      }
    }
    if (i.required && !isGiven(i, v)) out.push({ name: i.name, problem: `${i.label}: required, and not given yet.` });
  }
  return out;
}

const iso = (local: string): string => {
  const t = Date.parse(local);
  return Number.isNaN(t) ? local : new Date(t).toISOString();
};

/**
 * The run's `input`, as `POST /api/runs` takes it: a dataset as `{"$dataset": id}`,
 * a list as its entries, a time window as `{from, to}` in UTC. An optional
 * input that was not given is left out.
 */
export function toRunInput(inputs: WorkloadInput[], values: InputValues): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const i of inputs) {
    const v = valueOf(i, values);
    if (!isGiven(i, v)) continue;
    if (i.kind === "dataset") out[i.name] = { $dataset: String(v) } satisfies DatasetRef;
    else if (i.kind === "list") out[i.name] = listOf(String(v));
    else if (i.kind === "date_range") out[i.name] = { from: iso(rangeOf(v).from), to: iso(rangeOf(v).to) };
    else if (i.kind === "bool") out[i.name] = v === true;
    else out[i.name] = String(v).trim();
  }
  return out;
}

/** A local date-time as the person typed it, readable: `2026-11-17 09:00`. */
export const localWhen = (v: string): string => v.replace("T", " ");

/* ═══════════════════ reading a first run ═══════════════════ */

/** The five places a first run can be. */
export const RUN_PHASES = [
  { id: "started", label: "Started", means: "The agent is working. Nothing is needed from you." },
  { id: "gate", label: "Waiting at a gate", means: "The run has stopped for a person's answer and goes no further until it has one." },
  { id: "refused", label: "Refused", means: "A control refused a step, or the run was refused or closed at a gate. The run's record names which." },
  { id: "failed", label: "Failed", means: "The run ended with an error, or an operator stopped it." },
  { id: "finished", label: "Finished", means: "The run completed. Its findings and its report are where the links point." },
] as const;
export type RunPhase = (typeof RUN_PHASES)[number]["id"];

interface EntryLike {
  id?: string;
  kind?: string;
  node?: string;
  title?: string;
  detail?: string;
  data?: Record<string, unknown>;
}

/** The part of a run's record (`GET /api/runs/{id}`) the first-run step reads. */
export interface RunLike {
  state?: string;
  error?: string;
  agent?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  suspension?: { node?: string; approvers?: string[]; prompt?: string; deadline?: string | null } | null;
  kill?: { by?: string; reason?: string; at?: string } | null;
  /** The signed answers its gates were given, oldest first. */
  decisions?: Record<string, unknown>[] | null;
  journal?: { entries?: EntryLike[] } | null;
}

export interface Refusal {
  /** The control's key as the journal wrote it. */
  control: string;
  /** The control's name in the register, or the key when the register does not know it. */
  name: string;
  /** What the control decides, in the register's words; empty when unknown. */
  decides: string;
  tool: string;
  node: string;
  detail: string;
  entry: string;
  times: number;
}

export interface RunReading {
  phase: RunPhase | "other";
  /** The run's state word as the record carries it. */
  state: string;
  error: string;
  /** Steps a control refused, most recent first, the same refusal counted once. */
  refusals: Refusal[];
  gate: { node: string; approvers: string[]; prompt: string; deadline: string } | null;
  /** How the gate was answered, when the journal says. */
  answer: { title: string; detail: string } | null;
  /** The last gate answer when it was not an approval: who refused, or closed the run there. */
  person: { by: string; at: string; note: string; node: string; closed: boolean } | null;
  kill: { by: string; reason: string; at: string } | null;
  /** The latest thing the journal recorded. */
  last: { title: string; node: string } | null;
  entries: number;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function readRun(run: RunLike): RunReading {
  const state = str(run.state);
  const entries = Array.isArray(run.journal?.entries) ? run.journal.entries : [];

  const refusals: Refusal[] = [];
  for (const e of [...entries].reverse()) {
    if (e.kind !== "denied" && e.kind !== "contract.breach") continue;
    const control = str(e.data?.control) || (e.kind === "contract.breach" ? "contract.breach" : "denied");
    const detail = str(e.detail);
    const tool = str(e.data?.tool);
    const same = refusals.find((r) => r.control === control && r.detail === detail && r.tool === tool);
    if (same) {
      same.times += 1;
      continue;
    }
    const why = control === "denied" ? { name: "A control", decides: "" } : explainControl(control);
    refusals.push({ control, name: why.name, decides: why.decides, tool, node: str(e.node), detail, entry: str(e.id), times: 1 });
  }

  const answered = [...entries].reverse().find((e) => e.kind === "gate.answer");
  const lastEntry = entries.length ? entries[entries.length - 1] : null;
  const decision = Array.isArray(run.decisions) && run.decisions.length ? run.decisions[run.decisions.length - 1] : null;
  const ended = state === "failed" || state === "closed";
  const person = ended && decision && decision.approved === false ? { by: str(decision.by), at: str(decision.at), note: str(decision.note), node: str(decision.node), closed: decision.aborted === true } : null;
  const g = run.suspension;

  const phase: RunReading["phase"] =
    state === "running"
      ? "started"
      : state === "suspended"
        ? "gate"
        : state === "done"
          ? "finished"
          : state === "closed"
            ? "refused"
            : state === "failed"
              ? refusals.length || person
                ? "refused"
                : "failed"
              : state === "killed"
                ? "failed"
                : "other";

  return {
    phase,
    state,
    error: str(run.error),
    refusals,
    gate: state === "suspended" && g ? { node: str(g.node), approvers: Array.isArray(g.approvers) ? g.approvers.filter((a) => typeof a === "string") : [], prompt: str(g.prompt), deadline: str(g.deadline) } : null,
    answer: answered ? { title: str(answered.title), detail: str(answered.detail) } : null,
    person,
    kill: run.kill ? { by: str(run.kill.by), reason: str(run.kill.reason), at: str(run.kill.at) } : null,
    last: lastEntry ? { title: str(lastEntry.title) || str(lastEntry.kind), node: str(lastEntry.node) } : null,
    entries: entries.length,
  };
}

/** Whether the record can still change: a run under way, or one waiting for an answer. */
export const runIsOpen = (state: string): boolean => state === "running" || state === "suspended";
