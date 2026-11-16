/**
 * Doors the console is built for and the backend does not have yet.
 *
 * Some screens here are ahead of the door they read. Each of them asks
 * through this module, which names the door, its method and the shape it
 * expects: this file is the contract the backend builds to. Until a door
 * answers, `ask` says so (`state: "pending"`) and the screen tells the person
 * it is not connected on this deployment. No screen invents a record.
 *
 * When a door arrives:
 *   1. its path prefix joins BACKEND_PREFIXES in lib/route-policy.ts (unless
 *      it already sits under one), so proxy.ts forwards it;
 *   2. nothing else changes: the screen already reads the shape below.
 *
 * How "not there yet" is told from "not found": a path nobody serves is
 * answered 404 or 405 with no `error` field (the console's own 404 page, or
 * the backend's `{"detail": "Not Found"}`); the backend's own refusals always
 * carry `{error}`. 501 is also read as "not yet".
 *
 * Fields that existing doors will gain are optional members of the types
 * below (`owner` on a run row, `agents` on a run row, `provider` on a model
 * call, `max_data_class` on a provider). The screen shows them when present.
 */

export type DoorId = keyof typeof DOORS;

export interface Door {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  /** What the door is for, in the words the screen uses when it is not connected. */
  purpose: string;
  /** Rows of featurelist-working.md this door serves. */
  rows: string[];
}

export const DOORS = {
  /* ── who sees what ── */
  accessLog: { method: "GET", path: "/api/access-log", purpose: "The record of who opened which run, evidence pack, deliverable or document, and when", rows: ["10.9"] },
  runAuthority: { method: "GET", path: "/api/runs/{id}/authority", purpose: "The authority a run was started under: what its caller granted and what was narrowed", rows: ["1.5"] },

  /* ── inputs ── */
  datasets: { method: "GET", path: "/api/datasets", purpose: "The datasets and uploads available as run inputs", rows: ["8.1", "7.4"] },
  datasetCreate: { method: "POST", path: "/api/datasets", purpose: "Uploading a dataset (multipart: file, name, kind, data_class)", rows: ["8.2"] },
  dataset: { method: "GET", path: "/api/datasets/{id}", purpose: "One dataset, its files and where it has been used", rows: ["8.1"] },
  datasetDelete: { method: "DELETE", path: "/api/datasets/{id}", purpose: "Removing a dataset", rows: ["8.1"] },

  /* ── knowledge for the client (the console's own server will serve these) ── */
  knowledgeSourceAdd: { method: "POST", path: "/api/knowledge/sources", purpose: "Adding a knowledge source", rows: ["8.3"] },
  knowledgeUpload: { method: "POST", path: "/api/knowledge/documents", purpose: "Uploading a document into a knowledge namespace (multipart)", rows: ["8.3"] },
  knowledgeSourceClass: { method: "PATCH", path: "/api/knowledge/sources/{id}", purpose: "Setting a knowledge source's data class and who is entitled to it", rows: ["8.7"] },

  /* ── findings ── */
  findings: { method: "GET", path: "/api/findings", purpose: "Findings, by run, agent, workload, severity or status", rows: ["11.1", "2.5"] },
  finding: { method: "GET", path: "/api/findings/{id}", purpose: "One finding with its evidence and history", rows: ["11.2", "11.3"] },
  findingTriage: { method: "POST", path: "/api/findings/{id}/status", purpose: "Changing a finding's status, with a note", rows: ["2.5"] },
  findingsSummary: { method: "GET", path: "/api/findings/summary", purpose: "Outcomes per workload: findings by severity and status", rows: ["2.4"] },

  /* ── acceptance ── */
  acceptance: { method: "GET", path: "/api/acceptance", purpose: "The acceptance record of each use case", rows: ["12.5"] },
  acceptanceSign: { method: "POST", path: "/api/acceptance/{use_case}/sign", purpose: "Signing a use case's acceptance", rows: ["12.5"] },

  /* ── workloads ── */
  workloads: { method: "GET", path: "/api/workloads", purpose: "The approved workloads this deployment offers, with the inputs and gates each takes", rows: ["2.1", "W1", "W2", "W3", "W4"] },

  /* ── chat ── */
  chatStart: { method: "POST", path: "/api/chat/requests", purpose: "Submitting a request to a workload from chat, under the person's own permissions", rows: ["2.3"] },
} as const satisfies Record<string, Door>;

/* ═══════════════════ shapes ═══════════════════ */

export type DataClass = "public" | "internal" | "confidential" | "restricted";
export const DATA_CLASSES: DataClass[] = ["public", "internal", "confidential", "restricted"];

/** Who a record belongs to. Existing rows (runs, deliverables) gain it as an optional `owner`. */
export interface Owner {
  sub: string;
  name: string;
  email?: string;
  team?: string;
}
export type Scope = "mine" | "team" | "all";

/** GET /api/access-log?subject=&kind=&id=&since=&limit= */
export interface AccessEvent {
  at: string;
  who: Owner;
  action: "viewed" | "downloaded" | "exported";
  kind: "run" | "evidence" | "deliverable" | "document" | "dataset" | "finding";
  id: string;
  label?: string;
  /** The run the record belongs to, when it has one. */
  run?: string;
}
export interface AccessLog {
  events: AccessEvent[];
  total: number;
}

/** GET /api/runs/{id}/authority */
export interface RunAuthority {
  run: string;
  /** The run that started this one, and the agent it ran as; absent for a run a person or a trigger started. */
  caller?: { run: string; agent: string };
  started_by?: Owner;
  /** What the run may use: its own grants, cut down to what its caller held. */
  grants: { tool: string; scope?: Record<string, string[]>; from: "spec" | "caller" }[];
  /** What its spec asked for and the caller did not hold. */
  narrowed: { tool: string; reason: string }[];
  max_data_class?: DataClass;
  gates: { name: string; approvers: string[] }[];
}

export type DatasetKind = "code" | "firewall_export" | "telemetry" | "document" | "other";
export const DATASET_KINDS: { id: DatasetKind; label: string; hint: string }[] = [
  { id: "code", label: "Code snapshot", hint: "An archive of a repository, for analysis" },
  { id: "firewall_export", label: "Firewall export", hint: "Rules, objects, NAT and topology" },
  { id: "telemetry", label: "Telemetry extract", hint: "Security events for a time window" },
  { id: "document", label: "Document", hint: "Rules of engagement, inventories, other papers" },
  { id: "other", label: "Other", hint: "Anything else a workload takes" },
];

/** GET /api/datasets → { datasets }, GET /api/datasets/{id} → Dataset */
export interface Dataset {
  id: string;
  name: string;
  kind: DatasetKind;
  /** Offline: a file handed over. Live: read from a connection when the run asks. */
  mode: "offline" | "live";
  data_class: DataClass;
  status: "processing" | "ready" | "failed";
  error?: string;
  size_bytes?: number;
  files?: number;
  digest?: string;
  /** The connection a live dataset reads from. */
  connection?: string;
  owner?: Owner;
  created_at: string;
  /** Runs that took it as an input. */
  used_by?: { run: string; agent: string; at: string }[];
}
export interface DatasetList {
  datasets: Dataset[];
}
/** How a run names a dataset in its input: the value of the field is this object. */
export interface DatasetRef {
  $dataset: string;
}

export type Workload = "sast" | "pentest" | "firewall" | "threat_hunt";
export const WORKLOADS: { id: Workload; name: string; line: string }[] = [
  { id: "sast", name: "Static code analysis", line: "Find and validate vulnerabilities in a code snapshot" },
  { id: "pentest", name: "Penetration testing", line: "Test agreed targets inside signed rules of engagement" },
  { id: "firewall", name: "Firewall rule review", line: "Review rules, objects and NAT for risk and propose changes" },
  { id: "threat_hunt", name: "Threat hunting", line: "Investigate telemetry against threat intelligence" },
];

export type Severity = "critical" | "high" | "medium" | "low" | "info";
export const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];
export type FindingStatus = "open" | "confirmed" | "false_positive" | "accepted" | "remediated";
export const FINDING_STATUSES: FindingStatus[] = ["open", "confirmed", "false_positive", "accepted", "remediated"];

/** Evidence under a finding: a journal entry of the run that produced it. */
export interface EvidenceLink {
  run: string;
  entry: string;
  label: string;
  kind?: "tool" | "model" | "retrieval" | "gate" | "deliverable";
}

/** What differs per workload. Every member is optional: a panel shows what it is given. */
export interface SastDetail {
  file?: string;
  line_start?: number;
  line_end?: number;
  cwe?: string;
  rule?: string;
  snippet?: string;
  attack_path?: { file: string; line?: number; note: string }[];
  validation?: { state: "validated" | "not_reproduced" | "not_attempted"; method?: string; note?: string };
}
export interface PentestDetail {
  target?: string;
  interface?: string;
  technique?: string;
  steps?: string[];
  impact?: string;
  rollback?: string;
  retest?: { state: "pending" | "passed" | "failed"; at?: string };
}
export interface FirewallDetail {
  rule_id?: string;
  device?: string;
  action?: string;
  source?: string;
  destination?: string;
  service?: string;
  usage?: { hits?: number; last_hit?: string };
  risk?: string;
  proposal?: { change: string; expires?: string; rollback?: string };
  limitations?: string;
}
export interface ThreatHuntDetail {
  hypothesis?: string;
  verdict?: string;
  indicators?: string[];
  telemetry?: { source: string; window?: string }[];
  coverage?: string;
}

/** GET /api/findings?run=&agent=&workload=&severity=&status=&scope=&limit= → { findings, total } */
export interface Finding {
  id: string;
  run: string;
  agent: string;
  workload: Workload | string;
  title: string;
  severity: Severity;
  status: FindingStatus;
  confidence?: number;
  summary?: string;
  recommendation?: string;
  evidence: EvidenceLink[];
  detail?: SastDetail & PentestDetail & FirewallDetail & ThreatHuntDetail & Record<string, unknown>;
  owner?: Owner;
  created_at: string;
  updated_at?: string;
  history?: { at: string; by: string; from: FindingStatus | null; to: FindingStatus; note?: string }[];
}
export interface FindingList {
  findings: Finding[];
  total: number;
}

/** POST /api/findings/{id}/status: a change of status always carries a note. */
export interface FindingTriage {
  status: FindingStatus;
  note: string;
}

/** GET /api/findings/summary?window=7d */
export interface FindingsSummary {
  window: string;
  workloads: {
    workload: Workload | string;
    runs: number;
    last_run?: { id: string; at: string; state: string };
    by_severity: Partial<Record<Severity, number>>;
    by_status: Partial<Record<FindingStatus, number>>;
  }[];
}

/** GET /api/acceptance → { use_cases } */
export interface Acceptance {
  use_case: Workload | string;
  agent: string;
  status: "not_started" | "in_test" | "accepted" | "accepted_with_issues" | "rejected";
  criteria: { id: string; text: string; metric?: string; threshold?: number; result?: number; met?: boolean }[];
  /** The eval run the results came from. */
  eval_run?: string;
  issues: { id: string; text: string; severity: Severity; state: "open" | "closed" }[];
  signoffs: { role: string; by?: string; at?: string; decision?: "accepted" | "rejected"; note?: string }[];
}
export interface AcceptanceList {
  use_cases: Acceptance[];
}

/** POST /api/acceptance/{use_case}/sign: the role signing (when the record names sign-off roles), the decision, a note. */
export interface AcceptanceSign {
  role?: string;
  decision: "accepted" | "rejected";
  note: string;
}

/** GET /api/workloads → { workloads } */
export interface WorkloadOffer {
  id: Workload | string;
  name: string;
  /** The deployed agent that runs it; absent while none is deployed. */
  agent?: string;
  status: "available" | "not_deployed";
  inputs: { name: string; label: string; kind: "dataset" | "text" | "date_range" | "list" | "choice" | "bool"; dataset_kind?: DatasetKind; choices?: string[]; required?: boolean; help?: string }[];
  gates: { name: string; role: string; when: string }[];
}
export interface WorkloadList {
  workloads: WorkloadOffer[];
}

/** POST /api/chat/requests: a request to a workload, made in words. */
export interface ChatRequest {
  workload: Workload | string;
  message: string;
}
/** What comes back: the run it started, or what it still needs before it can start one. */
export interface ChatRequestAnswer {
  id?: string;
  state?: "started" | "needs_input" | "refused";
  run?: string;
  reply?: string;
  /** Inputs the workload takes that the message did not give. */
  missing?: string[];
}

/* ═══════════════════ asking ═══════════════════ */

export type Answer<T> = { state: "ok"; data: T } | { state: "pending"; door: Door } | { state: "error"; message: string; status?: number };

/** A door's path with its `{name}` parts filled and a query added. */
export function doorUrl(door: Door, params: Record<string, string> = {}, query: Record<string, string | number | undefined> = {}): string {
  const path = door.path.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(params[k] ?? ""));
  const q = Object.entries(query).filter(([, v]) => v !== undefined && v !== "");
  return q.length ? `${path}?${q.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&")}` : path;
}

/**
 * Ask a door. `pending` when nothing serves it yet, `error` when it is there
 * and refused or failed, `ok` with the body otherwise. Never throws.
 */
export async function ask<T>(
  id: DoorId,
  opts: { params?: Record<string, string>; query?: Record<string, string | number | undefined>; body?: unknown; form?: FormData } = {},
): Promise<Answer<T>> {
  const door: Door = DOORS[id];
  const init: RequestInit = { method: door.method, cache: "no-store" };
  if (opts.form) init.body = opts.form;
  else if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
    init.headers = { "content-type": "application/json" };
  }
  let res: Response;
  try {
    res = await globalThis.fetch(doorUrl(door, opts.params, opts.query), init);
  } catch (e) {
    return { state: "error", message: (e as Error).message || "the request did not reach the server" };
  }
  let body: unknown = null;
  try {
    body = await res.clone().json();
  } catch {
    /* not JSON: the console's own 404 page, or an empty answer */
  }
  const said = body && typeof body === "object" && "error" in body ? String((body as { error?: unknown }).error ?? "") : "";
  if (res.status === 501 || ((res.status === 404 || res.status === 405) && !said)) return { state: "pending", door };
  if (!res.ok) return { state: "error", message: said || `the server answered ${res.status}`, status: res.status };
  return { state: "ok", data: body as T };
}
