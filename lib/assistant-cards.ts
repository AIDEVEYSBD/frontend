/**
 * What an in-chat card shows (components/assistant-cards.tsx): which record or
 * page an href in an answer names, and that record as the console's readers
 * answer it.
 *
 * The service's answers link only these forms (agentfactory/answers/blocks.py,
 * PAGES and RECORD_PAGES; a row's link is made by `record_href`, which quotes
 * the id with nothing kept safe):
 *   /findings?id=<id>      a finding           GET /api/findings/{id}
 *   /runs?id=<id>          a run               GET /api/runs/{run_id}, and its ledger row for the refusals
 *   /agent?id=<id>         an agent            GET /api/agents/{id}, else the attached agent of that id
 *   /applications/<id>     an application      GET /api/applications/{id}
 *   /workloads#use-cases   the use cases       GET /api/use-cases (no id: a gate, a use case link the list)
 *   /approvals             the gates           GET /api/approvals
 *   one of PAGES           a console page      its name and what it is for (lib/assistant.ts)
 * Anything else is not a link the service makes, and the card says so.
 *
 * A card's actions (actionsFor) go through the same writers the pages use, as
 * the signed-in person: the model never acts, a person clicks.
 *
 * A failed read is kept as the reader's own sentence (the service's reason
 * with the status), never turned into an empty card. A value the record does
 * not hold is null, never a zero.
 */

import { api, errorText, type RunRow } from "./api/client";
import { ask, type Finding } from "./api/pending";
import { getAgentDetail, type AgentLifecycleDetail } from "./api/l8";
import { listAttached } from "./api/l2";
import { getApplication, type Application } from "./api/l4";
import { answerGate, fleet, getFleet, listGates, type AnswerResult, type Gate, type PauseInfo } from "./api/l5";
import { killRefusalOf, killRun } from "./api/l7";
import type { Permission } from "./permissions";
import { PAGES as PAGE_INFO } from "./assistant";

/* ═══════════════════ the href ═══════════════════ */

export type CardKind = "finding" | "run" | "agent" | "application" | "use_cases" | "approvals" | "page" | "unknown";

export interface CardTarget {
  kind: CardKind;
  /** The record's id, decoded; "" for a list or a page. */
  id: string;
  /** The href as it arrived: what "Open page" opens. */
  href: string;
  /** The page's path as the service names it ("/configuration?tab=models" kept whole). */
  path: string;
}

/** The pages the service may link, with the name it gives each (agentfactory/answers/blocks.py PAGES). */
export const SERVICE_PAGES: Record<string, string> = {
  "/overview": "Overview", "/control": "Control", "/agents": "Agents", "/runs": "Runs", "/approvals": "Approvals",
  "/findings": "Findings", "/workloads": "Workloads", "/acceptance": "Acceptance", "/applications": "Applications",
  "/chat": "Chat", "/knowledge": "Knowledge", "/configuration": "Configuration", "/configuration?tab=models": "Models",
  "/finops": "Costs", "/compliance": "Compliance", "/guardrails": "Controls", "/evidence": "Evidence", "/policy": "Policy",
  "/lifecycle": "Lifecycle", "/datasets": "Datasets", "/iam": "People and agents", "/access": "Access log",
  "/explore": "Explore", "/dashboards": "Dashboards", "/outcomes": "Results", "/templates": "Templates", "/evals": "Quality",
  "/guardian": "Guardian", "/sessions": "Sessions", "/authorization": "Authorization servers", "/dependencies": "Resilience",
};

function decoded(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Which record or page an href names. */
export function resolveHref(href: string): CardTarget {
  const unknown: CardTarget = { kind: "unknown", id: "", href, path: href };
  if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//")) return unknown;
  const hashAt = href.indexOf("#");
  const hash = hashAt >= 0 ? href.slice(hashAt + 1) : "";
  const beforeHash = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const qAt = beforeHash.indexOf("?");
  const path = qAt >= 0 ? beforeHash.slice(0, qAt) : beforeHash;
  const query = new URLSearchParams(qAt >= 0 ? beforeHash.slice(qAt + 1) : "");
  const id = query.get("id") ?? "";

  if (path === "/findings" && id) return { kind: "finding", id, href, path };
  if (path === "/runs" && id) return { kind: "run", id, href, path };
  if ((path === "/agent" || path === "/agents") && id) return { kind: "agent", id, href, path };
  const app = /^\/applications\/([^/]+)$/.exec(path);
  if (app) return { kind: "application", id: decoded(app[1]), href, path };
  if (path === "/workloads" && (hash === "use-cases" || hash === "")) return { kind: "use_cases", id: "", href, path };
  if (path === "/approvals") return { kind: "approvals", id: "", href, path };
  // A page keeps its query when the service names it with one ("/configuration?tab=models").
  if (beforeHash in SERVICE_PAGES) return { kind: "page", id: "", href, path: beforeHash };
  if (path in SERVICE_PAGES || path in PAGE_INFO) return { kind: "page", id: "", href, path };
  return unknown;
}

/** A console page's name and what it is for. `shows` is null where lib/assistant.ts does not describe the page. */
export function pageCard(path: string): { title: string; shows: string | null; suggested: string[] } | null {
  const info = PAGE_INFO[path];
  const name = SERVICE_PAGES[path];
  if (!info && !name) return null;
  return { title: info?.title ?? name, shows: info?.shows ?? null, suggested: info?.suggested ?? [] };
}

/* ═══════════════════ the records ═══════════════════ */

export interface RunCard {
  id: string;
  agent: string;
  agentVersion: number | null;
  state: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** What the run recorded it spent, in US dollars; null when the record holds no cost. */
  cost: number | null;
  /** Calls with no price set: their cost is not in `cost`. */
  unpriced: number;
  toolCalls: number | null;
  /** From the run's ledger row; null when it could not be read, with the reason in `refusalsUnread`. */
  refusals: number | null;
  refusalsUnread: string;
  error: string;
  result: unknown;
  waitingOn: string;
  useCase: string;
  /** A kill asked of the run and not yet taken; null when none is on the record. */
  kill: { by: string; at: string; reason: string } | null;
}

export interface AgentCard {
  id: string;
  name: string;
  /** Saved on this deployment, or attached from outside it. */
  source: "saved" | "attached";
  description: string;
  version: number | null;
  deployedVersion: number | null;
  deployedAt: string | null;
  updatedAt: string | null;
  retired: boolean;
  /** "" when none is declared. */
  owner: string;
  steps: number | null;
  /** Attached only. */
  mode?: string;
  framework?: string;
  model?: string;
  blocked?: boolean;
  approval?: string;
  runs30d?: number | null;
  denials30d?: number | null;
  /** Saved only: the agent's pause or drain (null when it runs freely), or why the fleet could not be read. */
  hold?: { state: "ok"; paused: PauseInfo | null } | { state: "error"; reason: string };
}

export interface UseCaseRow {
  id: string;
  name: string;
  owner: string;
  workload: string;
  state: string;
  autonomy: string;
  dataClasses: string[];
  gates: number;
  registeredAt: string | null;
}

export interface UseCasesCard {
  rows: UseCaseRow[];
  /** The row the link's label names exactly; null when it names none. */
  picked: string | null;
}

export interface ApprovalsCard {
  count: number;
  pending: Gate[];
  closed: number;
  /** The run the link's label names exactly, when one waiting gate is on it. */
  picked: string | null;
  /** The answer already given on the run the label names, when no gate waits there. */
  answered: { run: string; approved: boolean; aborted: boolean; by: string; at: string; note: string } | null;
}

export type CardData =
  | { kind: "finding"; finding: Finding }
  | { kind: "run"; run: RunCard }
  | { kind: "agent"; agent: AgentCard }
  | { kind: "application"; application: Application }
  | { kind: "use_cases"; useCases: UseCasesCard }
  | { kind: "approvals"; approvals: ApprovalsCard }
  | { kind: "page"; page: { path: string; title: string; shows: string | null; suggested: string[] } };

/** What a card read answers: the record, or why there is none (`notFound` when the service said it is not there, `notBuilt` for a 501). */
export type CardLoad = { state: "ok"; data: CardData } | { state: "missing"; reason: string; notFound: boolean; notBuilt: boolean };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function missing(reason: string, status?: number): CardLoad {
  return { state: "missing", reason, notFound: status === 404, notBuilt: status === 501 };
}

function statusOf(e: unknown): number | undefined {
  return isObj(e) && typeof e.status === "number" ? e.status : undefined;
}

async function loadFinding(id: string): Promise<CardLoad> {
  const a = await ask<Finding>("finding", { params: { id } });
  if (a.state === "pending") return { state: "missing", reason: `not built: ${a.door.method} ${a.door.path}`, notFound: false, notBuilt: true };
  if (a.state === "error") return missing(a.message, a.status);
  return { state: "ok", data: { kind: "finding", finding: a.data } };
}

async function loadRun(id: string): Promise<CardLoad> {
  const { data, error, response } = await api.GET("/api/runs/{run_id}", { params: { path: { run_id: id } } });
  if (!data) return missing(errorText(error, response, "GET", "/api/runs/{run_id}"), response.status);
  const r = data as unknown as Record<string, unknown>;
  const spent = isObj(r.spent) ? r.spent : {};
  const agent = str(r.agent) || str(r.system);
  // The refusals are counted on the run's ledger row (the record carries none): one read of the agent's rows.
  // Three outcomes kept apart: the count, the row not listed, and the read refused or failed (its sentence).
  let refusals: number | null = null;
  let refusalsUnread = "";
  try {
    const rows = await api.GET("/api/runs", { params: { query: { agent } } });
    if (!rows.data) refusalsUnread = errorText(rows.error, rows.response, "GET", "/api/runs");
    else {
      const row = rows.data.runs.find((x: RunRow) => x.id === id);
      refusals = row ? num(row.denials) : null;
      if (!row) refusalsUnread = "the run is not listed in its agent's runs";
    }
  } catch (e) {
    refusalsUnread = (e as Error).message || "GET /api/runs did not answer";
  }
  return {
    state: "ok",
    data: {
      kind: "run",
      run: {
        id: str(r.id) || id,
        agent,
        agentVersion: num(r.agent_version),
        state: str(r.state),
        startedAt: strOrNull(r.started_at),
        finishedAt: strOrNull(r.finished_at),
        cost: num(spent.cost_usd),
        unpriced: Array.isArray(spent.unpriced) ? spent.unpriced.length : 0,
        toolCalls: num(r.toolCalls) ?? num(spent.tool_calls),
        refusals,
        refusalsUnread,
        error: str(r.error),
        result: r.result ?? null,
        waitingOn: str(r.waiting_on),
        useCase: str(r.use_case),
        kill: isObj(r.kill) ? { by: str(r.kill.by), at: str(r.kill.at), reason: str(r.kill.reason) } : null,
      },
    },
  };
}

async function loadAgent(id: string): Promise<CardLoad> {
  let savedError: unknown;
  try {
    const d: AgentLifecycleDetail = await getAgentDetail(id);
    // Whether the agent stands paused: the fleet's own read, as the Control page shows it.
    let hold: NonNullable<AgentCard["hold"]>;
    try {
      const f = await getFleet();
      hold = { state: "ok", paused: f.paused[d.id] ?? null };
    } catch (e) {
      hold = { state: "error", reason: (e as Error).message };
    }
    const meta = isObj(d.spec.metadata) ? d.spec.metadata : {};
    const inner = isObj(d.spec.spec) ? d.spec.spec : {};
    return {
      state: "ok",
      data: {
        kind: "agent",
        agent: {
          id: d.id,
          name: d.name || d.id,
          source: "saved",
          description: d.description,
          version: d.version,
          deployedVersion: d.deployed_version,
          deployedAt: d.deployed_at,
          updatedAt: d.updated_at,
          retired: d.retired !== null,
          owner: str(meta.owner),
          steps: Array.isArray(inner.nodes) ? inner.nodes.length : null,
          hold,
        },
      },
    };
  } catch (e) {
    savedError = e;
  }
  // Not saved here: an attached agent opens on the same page (components/agent-config.tsx does the same).
  if (statusOf(savedError) === 404) {
    try {
      const list = await listAttached();
      const found = (list.agents as unknown as Record<string, unknown>[]).find((a) => a.id === id && !a.detached_at);
      if (found) {
        const approval = isObj(found.approval) ? str(found.approval.state) : "";
        const owner = str(found.owner) || (isObj(found.attached_by) ? str(found.attached_by.name) || str(found.attached_by.email) : "");
        return {
          state: "ok",
          data: {
            kind: "agent",
            agent: {
              id,
              name: str(found.name) || id,
              source: "attached",
              description: "",
              version: null,
              deployedVersion: null,
              deployedAt: null,
              updatedAt: strOrNull(found.last_seen),
              retired: false,
              owner,
              steps: null,
              mode: str(found.mode),
              framework: str(found.framework),
              model: str(found.model),
              blocked: found.blocked === true,
              approval,
              runs30d: num(found.runs30d),
              denials30d: num(found.denials30d),
            },
          },
        };
      }
    } catch (e) {
      return missing(`${(savedError as Error).message}; the attached agents could not be read either: ${(e as Error).message}`, statusOf(e));
    }
  }
  return missing((savedError as Error)?.message || `the agent "${id}" could not be read`, statusOf(savedError));
}

async function loadApplication(id: string): Promise<CardLoad> {
  try {
    const app = await getApplication(id);
    // The reader keeps no sentence for a 404, only that the service answered it.
    if (!app) return missing(`the service answered 404 for the application "${id}" (GET /api/applications/{app_id})`, 404);
    return { state: "ok", data: { kind: "application", application: app } };
  } catch (e) {
    return missing((e as Error).message, statusOf(e));
  }
}

function ownerText(v: unknown): string {
  if (isObj(v)) return str(v.name) || str(v.email);
  return str(v);
}

async function loadUseCases(label: string): Promise<CardLoad> {
  const a = await ask<{ use_cases?: unknown[] }>("useCases");
  if (a.state === "pending") return { state: "missing", reason: `not built: ${a.door.method} ${a.door.path}`, notFound: false, notBuilt: true };
  if (a.state === "error") return missing(a.message, a.status);
  const rows: UseCaseRow[] = (Array.isArray(a.data.use_cases) ? a.data.use_cases : []).filter(isObj).map((u) => ({
    id: str(u.id),
    name: str(u.name) || str(u.id),
    owner: ownerText(u.owner),
    workload: str(u.workload),
    state: str(u.state),
    autonomy: str(u.autonomy),
    dataClasses: Array.isArray(u.data_classes) ? u.data_classes.filter((x): x is string => typeof x === "string") : [],
    gates: Array.isArray(u.gates) ? u.gates.length : 0,
    registeredAt: strOrNull(u.registered_at),
  }));
  const l = label.trim();
  const picked = l ? (rows.find((r) => r.id === l || r.name === l)?.id ?? null) : null;
  return { state: "ok", data: { kind: "use_cases", useCases: { rows, picked } } };
}

async function loadApprovals(label: string): Promise<CardLoad> {
  try {
    const inbox = await listGates();
    const l = label.trim();
    const picked = l ? (inbox.pending.find((g) => g.run === l)?.run ?? null) : null;
    // The closed list is newest first: the first decision on the named run is its latest.
    const done = !picked && l ? inbox.closed.filter(isObj).find((c) => c.run === l) : undefined;
    const answered = done
      ? { run: l, approved: done.approved === true, aborted: done.aborted === true, by: str(done.by_name) || str(done.by), at: str(done.at), note: str(done.note) }
      : null;
    return { state: "ok", data: { kind: "approvals", approvals: { count: inbox.count, pending: inbox.pending, closed: inbox.closed.length, picked, answered } } };
  } catch (e) {
    return missing((e as Error).message, statusOf(e));
  }
}

/** Read the record or page a target names. Never throws: a failed read is a `missing` with the reader's sentence. */
export async function loadCard(target: CardTarget, label = ""): Promise<CardLoad> {
  try {
    switch (target.kind) {
      case "finding":
        return await loadFinding(target.id);
      case "run":
        return await loadRun(target.id);
      case "agent":
        return await loadAgent(target.id);
      case "application":
        return await loadApplication(target.id);
      case "use_cases":
        return await loadUseCases(label);
      case "approvals":
        return await loadApprovals(label);
      case "page": {
        const p = pageCard(target.path);
        if (!p) return missing(`${target.path} is not a page of the console`);
        return { state: "ok", data: { kind: "page", page: { path: target.path, ...p } } };
      }
      default:
        return missing(`"${target.href}" is not a link to a record or a page of the console`);
    }
  } catch (e) {
    return missing((e as Error).message || "the read did not answer");
  }
}

/* ═══════════════════ the question ═══════════════════ */

/** The question "Ask about this" sends for a record. */
export function askAbout(data: CardData): string {
  switch (data.kind) {
    case "finding": {
      const f = data.finding;
      return `Tell me about finding ${f.id} ("${f.title}"): why it is ${f.severity}, what evidence supports it, and what should be done next.`;
    }
    case "run": {
      const r = data.run;
      return r.state === "failed" || r.state === "killed"
        ? `Why did run ${r.id} of ${r.agent} end ${r.state}, and what should change before it runs again?`
        : `Summarise run ${r.id} of ${r.agent}: what it did, what it cost, and what it found.`;
    }
    case "agent": {
      const a = data.agent;
      return a.source === "attached"
        ? `Tell me about the attached agent ${a.id}: what it may call, its gates, and its recent runs and refusals.`
        : `Tell me about agent ${a.id}: what it does, which version is deployed, and how its recent runs went.`;
    }
    case "application":
      return `Tell me about application ${data.application.id} ("${data.application.name}"): its policy, its usage and anything blocked.`;
    case "use_cases": {
      const picked = data.useCases.rows.find((r) => r.id === data.useCases.picked);
      return picked
        ? `Tell me about use case ${picked.id} ("${picked.name}"): its state, its gates and its recent runs and findings.`
        : "Which use cases are registered, in what state, and which ones have open findings?";
    }
    case "approvals":
      return data.approvals.count > 0 ? "Which gates are waiting for a person, on which runs, and since when?" : "Which gates were answered most recently, and by whom?";
    case "page":
      return data.page.suggested[0] ?? `What can I do on the ${data.page.title} page?`;
  }
}

/* ═══════════════════ the actions ═══════════════════ */

export interface CardAction {
  id: "status" | "kill" | "approval" | "pause" | "resume" | "approve" | "refuse";
  label: string;
  /** What it does, in a line. */
  what: string;
  /** The permission the console asks for before it offers the button (the service checks again). */
  permission: Permission | null;
  /** Asks once more inside the card before anything is sent. */
  confirm: boolean;
}

const ACTIONS: Partial<Record<CardKind, CardAction[]>> = {
  finding: [
    { id: "status", label: "Change status", what: "Sets the finding's status (open, confirmed, false positive, risk accepted, remediated), with a note kept in its history.", permission: "approve", confirm: false },
  ],
  run: [
    { id: "kill", label: "Kill", what: "Stops the run and everything it set off, with a reason; offered while the run is running or waiting at a gate.", permission: "run", confirm: true },
    { id: "approval", label: "Open its approval", what: "For a run waiting at a gate, opens the gate's card in the chat.", permission: null, confirm: false },
  ],
  agent: [
    { id: "pause", label: "Pause", what: "A saved agent: starts no new run of it and stops its runs in flight, with a reason.", permission: "run", confirm: true },
    { id: "resume", label: "Resume", what: "A paused saved agent: its runs start again, with a reason.", permission: "run", confirm: false },
  ],
  approvals: [
    { id: "approve", label: "Approve", what: "Answers a waiting yes-or-no gate yes, with an optional reason; the run goes on.", permission: "approve", confirm: false },
    { id: "refuse", label: "Refuse", what: "Answers a waiting yes-or-no gate no, with an optional reason; the run closes at the gate.", permission: "approve", confirm: true },
  ],
};

/** What a card of this kind lets a person do, for the thread to mention. Empty for a kind with no action. */
export function actionsFor(kind: CardKind): CardAction[] {
  return ACTIONS[kind] ?? [];
}

/** What an action answered: done, with the time the console heard it, or the service's sentence. */
export type ActionOutcome = { ok: true; at: Date; detail: string } | { ok: false; reason: string };

/** `POST /api/findings/{id}/status` with `{status, note}`, as the Findings page sends it. */
export async function changeFindingStatus(id: string, status: string, note: string): Promise<ActionOutcome> {
  const a = await ask<unknown>("findingTriage", { params: { id }, body: { status, note } });
  if (a.state === "pending") return { ok: false, reason: `not built: ${a.door.method} ${a.door.path}` };
  if (a.state === "error") return { ok: false, reason: a.message };
  return { ok: true, at: new Date(), detail: "" };
}

/** `POST /api/approvals/{run}` with a yes-or-no answer, as the Approvals page sends it. The second-person rule is the service's. */
export async function answerDecision(run: string, approved: boolean, note: string): Promise<ActionOutcome> {
  let r: AnswerResult;
  try {
    r = await answerGate(run, { approved }, note);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  if (!r.ok && r.state !== "closed") return { ok: false, reason: r.error || `the gate on ${run} was not answered` };
  return { ok: true, at: new Date(), detail: r.state ? `the run is now ${r.state.replace(/_/g, " ")}` : "" };
}

/** `POST /api/runs/{id}/kill` with `{reason}`, as the Runs page sends it. A 409 says nothing new was reached. */
export async function killFromCard(id: string, reason: string): Promise<ActionOutcome> {
  try {
    const r = await killRun(id, reason);
    const parts = [r.delivery === "tree" ? "it reached what the run set off" : "", r.reached.length > 1 ? `${r.reached.length} runs reached` : ""].filter(Boolean);
    return { ok: true, at: new Date(), detail: parts.join(", ") };
  } catch (e) {
    const refusal = killRefusalOf(e);
    return { ok: false, reason: refusal ? refusal.error : (e as Error).message };
  }
}

/** `POST /api/fleet` with `{action, agents: [id], reason}`, as the Control page sends it. */
export async function holdAgent(id: string, action: "pause" | "resume", reason: string): Promise<ActionOutcome> {
  try {
    const r = await fleet(action, [id], reason);
    const stopped = action === "pause" && r.killed.length ? `; ${r.killed.length} run${r.killed.length === 1 ? "" : "s"} in flight stopped` : "";
    const at = Date.parse(r.at);
    return { ok: true, at: Number.isNaN(at) ? new Date() : new Date(at), detail: stopped.replace(/^; /, "") };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}
