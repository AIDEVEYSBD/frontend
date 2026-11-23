/**
 * Doors the screens read through `ask`, each named once with its method,
 * its path and the shape the screen expects.
 *
 * Every door listed here is served by the service. `ask` reads the service's
 * own 501 (a part it names as not built) as `state: "pending"`, which the
 * screen says plainly; any other refusal or fault, a 404 or 405 among them,
 * is shown as the failure it is, with its status and reason. No screen
 * invents a record.
 *
 * Fields a door may leave out are optional members of the types below
 * (`owner` on a run row, `agents` on a run row, `provider` on a model call,
 * `max_data_class` on a provider). The screen shows them when present.
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
  acceptanceSet: { method: "PUT", path: "/api/acceptance/{use_case}", purpose: "Setting a use case's acceptance criteria and the person who signs each role", rows: ["12.5"] },
  acceptanceResult: { method: "POST", path: "/api/acceptance/{use_case}/results", purpose: "Entering a criterion's measured result against a finished run", rows: ["12.5"] },
  acceptanceIssue: { method: "POST", path: "/api/acceptance/{use_case}/issues", purpose: "Opening an issue on a use case's acceptance record", rows: ["12.5"] },
  acceptanceIssueClose: { method: "POST", path: "/api/acceptance/{use_case}/issues/{id}/close", purpose: "Closing an issue on a use case's acceptance record", rows: ["12.5"] },
  acceptanceSign: { method: "POST", path: "/api/acceptance/{use_case}/sign", purpose: "Signing a use case's acceptance", rows: ["12.5"] },
  /** The run list cut to one use case (`?use_case=<workload>`): the runs a result can be entered against. */
  useCaseRuns: { method: "GET", path: "/api/runs", purpose: "The runs of one use case, for entering a measured result against one of them", rows: ["12.5"] },

  /* ── workloads ── */
  workloads: { method: "GET", path: "/api/workloads", purpose: "The approved workloads this deployment offers, with the inputs and gates each takes", rows: ["2.1", "W1", "W2", "W3", "W4"] },

  /* ── chat ── */
  chatStart: { method: "POST", path: "/api/chat/requests", purpose: "Submitting a request to a workload from chat, under the person's own permissions", rows: ["2.3"] },

  /* ── sessions ── */
  sessions: { method: "GET", path: "/api/sessions", purpose: "Every live connection to this deployment: people signed in to the console, agents holding a key or a workload sign-in, and the connections held open to tool servers on their behalf", rows: ["1.1", "1.4"] },
  sessionEnd: { method: "POST", path: "/api/sessions/{id}/end", purpose: "Ending one session", rows: ["1.1", "1.4"] },
  sessionsEnd: { method: "POST", path: "/api/sessions/end", purpose: "Ending several sessions at once, or a client's registration and every session issued to it", rows: ["1.1", "1.4"] },

  /* ── authorization servers ── */
  authServers: { method: "GET", path: "/api/authorization-servers", purpose: "The outside issuers this deployment trusts: for a per-person token to a tool, and for the tokens an agent or worker exchanges for a short session", rows: ["1.4", "7.1"] },
  authServerAdd: { method: "POST", path: "/api/authorization-servers", purpose: "Adding an authorization server", rows: ["1.4", "7.1"] },
  authServerRemove: { method: "DELETE", path: "/api/authorization-servers/{id}", purpose: "Removing an authorization server", rows: ["1.4", "7.1"] },
  authServerProbe: { method: "POST", path: "/api/authorization-servers/probe", purpose: "Reading the metadata an issuer publishes, before it is added", rows: ["1.4", "7.1"] },

  /* ── retrieval access: the RAG kill switch (GUI access matrix 1.3) ── */
  retrievalAccess: { method: "GET", path: "/api/retrieval/access", purpose: "Which agent may read, write or delete in which knowledge store, whether retrieval from each store is on, and the history of every revocation", rows: ["GUI 1.3"] },
  retrievalRevoke: { method: "POST", path: "/api/retrieval/access/revoke", purpose: "Revoking an agent's read, write or delete access to a knowledge store, or to all of them", rows: ["GUI 1.3"] },
  retrievalRestore: { method: "POST", path: "/api/retrieval/access/restore", purpose: "Restoring access that was revoked", rows: ["GUI 1.3"] },
  retrieverDisable: { method: "POST", path: "/api/retrieval/stores/{id}/disable", purpose: "Switching retrieval from a data store off for every agent", rows: ["GUI 1.3"] },
  retrieverEnable: { method: "POST", path: "/api/retrieval/stores/{id}/enable", purpose: "Switching retrieval from a data store back on", rows: ["GUI 1.3"] },

  /* ── a run paused at its budget (GUI access matrix 1.12) ── */
  budgetHolds: { method: "GET", path: "/api/budget/holds", purpose: "Runs paused because they reached their budget, waiting for a person to decide whether they continue or stop", rows: ["GUI 1.12"] },
  budgetHoldDecide: { method: "POST", path: "/api/budget/holds/{id}/decide", purpose: "Deciding a run paused at its budget: continue with a raised budget, or stop", rows: ["GUI 1.12"] },

  /* ── compliance view: the catalogue against ABB's own control list (GUI access matrix 1.18) ── */
  compliance: { method: "GET", path: "/api/compliance", purpose: "The ABB ICL as loaded, which of its controls each catalogue control answers, and what this deployment has changed about a control", rows: ["GUI 1.18"] },
  complianceSave: { method: "PUT", path: "/api/compliance", purpose: "Saving the ICL mapping and the changes to controls", rows: ["GUI 1.18"] },
  iclLoad: { method: "POST", path: "/api/compliance/icl", purpose: "Loading ABB's control list (multipart: one field, `file`, a CSV of id, title, domain; the list takes its name from the file's)", rows: ["GUI 1.18"] },

  /* ── use-case onboarding and gate set-up (GUI access matrix 1.14) ── */
  useCases: { method: "GET", path: "/api/use-cases", purpose: "The registered use cases: who owns each, the data classes it handles, its autonomy level, the workload it uses and the gates where a person decides", rows: ["GUI 1.14"] },
  useCaseRegister: { method: "POST", path: "/api/use-cases", purpose: "Registering a use case with its owner, data classes, autonomy level, workload and gates", rows: ["GUI 1.14"] },
  useCase: { method: "PATCH", path: "/api/use-cases/{id}", purpose: "Changing a registered use case, or moving it on: sending a draft for approval, approving it", rows: ["GUI 1.14"] },

  /* ── screens first written for the console's own server, now read from the platform ── */
  control: { method: "GET", path: "/api/control", purpose: "The estate in one read: every agent with its runs, spend, gates, limits and the activity behind them", rows: [] },
  controlSave: { method: "POST", path: "/api/control", purpose: "Setting the deployment's budget for a period", rows: [] },
  guardrails: { method: "GET", path: "/api/guardrails", purpose: "The record of control firings, counted from the run journals, and the injection and exfiltration watch", rows: [] },
  controls: { method: "GET", path: "/api/controls", purpose: "Which controls of the catalogue this deployment enforces now, and how often each has fired", rows: [] },
  screenerHealth: { method: "GET", path: "/api/screener/health", purpose: "Whether the deployment's screener answers now: which one, whether it fails closed, and how long it takes", rows: [] },
  evals: { method: "GET", path: "/api/evals", purpose: "The evaluations created on this deployment, with the history of their runs", rows: [] },
  evalsSave: { method: "POST", path: "/api/evals", purpose: "Saving a benchmark", rows: [] },
  observability: { method: "GET", path: "/api/observability", purpose: "A run's trace: how long each step took and what it cost; and the tools ranked across runs", rows: [] },
  logs: { method: "GET", path: "/api/logs", purpose: "Every run's journal as one download", rows: [] },
  assistant: { method: "GET", path: "/api/assistant", purpose: "The console assistant", rows: [] },
  mcpServer: { method: "GET", path: "/api/mcp/server", purpose: "The platform's own MCP server: the tools it exposes to an MCP client", rows: [] },
  authAccess: { method: "GET", path: "/api/auth/access", purpose: "Who Google sign-in lets through to this console", rows: [] },

  /* ── cloud security findings (GUI access matrix 1.16) ── */
  cloudFindings: { method: "GET", path: "/api/security/findings", purpose: "The findings the cloud provider's security centre holds for this deployment's resources", rows: ["GUI 1.16"] },
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
  /** Fields whose feature is not built (`events[].who.team`). */
  not_built?: string[];
}

/** GET /api/runs/{id}/authority */
export interface RunAuthority {
  run: string;
  /** The run it was started under, and the agent that run ran as; absent for a run started on its own. */
  caller?: { run: string; agent: string };
  started_by?: Owner;
  /** What the starter held at the moment the run started: their roles and permissions, how they came in, and what kind of caller they were. */
  held?: { roles: string[]; permissions: string[]; via: string | null; kind: string | null };
  /** What the run may use: its own grants, cut down to what its caller held. */
  grants: { tool: string; scope?: Record<string, string[]>; from: "spec" | "caller" }[];
  /** What its spec asked for and the caller did not hold. */
  narrowed: { tool: string; reason: string }[];
  max_data_class?: DataClass;
  gates: { name: string; approvers: string[] }[];
  /**
   * The approved use case the run started under, as copied onto the run when it started; null when there is
   * none, and `use_case_note` then says why. Absent from an answer older than runs being bound to use cases.
   */
  use_case?: RunUseCase | null;
  /** Why the run has no use case, when `use_case` is null: "this agent runs no registered workload". */
  use_case_note?: string;
  /** Fields whose feature is not built: `grants`, `narrowed`, `gates[tool calls]`, `max_data_class`, `started_by.team`. */
  not_built?: string[];
}

/** The use case a run started under (`RunAuthority.use_case`). */
export interface RunUseCase {
  id: string;
  name: string;
  /** The workload it uses: the key the use case is known by on the results pages. */
  workload: string;
  data_classes: DataClass[];
  /** An autonomy tier, `L0` to `L5`. */
  autonomy: string;
  approved_by: { email: string; name: string };
  approved_at: string;
}

/** An API key a person answers for that is not revoked: holding them out does not stop it, because a key acts with its own authority. */
export interface LiveKey {
  id: string;
  name: string;
  prefix: string;
  agent: string | null;
  /** The person it belongs to, when the answer covers more than one. */
  owner_sub?: string;
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

/** POST /api/datasets answers the new dataset, bare or as `{dataset}`. */
export type DatasetCreated = Dataset | { dataset: Dataset };

/** POST /api/knowledge/sources */
export interface KnowledgeSourceAdd {
  name: string;
  url: string;
  publisher?: string;
  licence?: string;
  namespace: string;
  data_class?: DataClass;
}
/** PATCH /api/knowledge/sources/{id}; a source row then carries the same two optional fields. */
export interface KnowledgeSourceClass {
  data_class?: DataClass;
  /** Roles entitled to retrieve from the source; empty means everyone who may read the namespace. */
  entitled?: string[];
}
/** POST /api/knowledge/documents is multipart: `file`, `namespace`, `title`. */

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

/** Which side of its threshold a result must fall: at or above it, or at or below it. */
export type CriterionDirection = "at_least" | "at_most";

/**
 * GET /api/acceptance → { use_cases }. A record is keyed by the workload of a registered use case
 * (`use_case`). `digest` is the record as it stands (criteria with their results, open issues,
 * signers); a signature binds to the digest it signed, and one whose digest is no longer the
 * record's is `stale` and does not count. Fields are absent rather than blank or zero.
 */
export interface Acceptance {
  use_case: Workload | string;
  agent: string;
  status: "not_started" | "in_test" | "accepted" | "accepted_with_issues" | "rejected";
  digest: string;
  /**
   * `met` is worked out by the platform from the threshold and its direction; absent while there is no
   * result or no threshold. `run`, `entered_by`, `measured_at` and `note` say who entered the result
   * against which run; `eval_run` when an evaluation wrote it instead of a person.
   */
  criteria: {
    id: string;
    text: string;
    metric?: string;
    threshold?: number;
    direction?: CriterionDirection;
    result?: number;
    met?: boolean;
    run?: string;
    entered_by?: { email: string; name: string };
    measured_at?: string;
    note?: string;
    eval_run?: string;
  }[];
  issues: {
    id: string;
    text: string;
    severity: Severity;
    state: "open" | "closed";
    opened_by?: { email: string; name: string };
    opened_at: string;
    closed_by?: { email: string; name: string };
    closed_at?: string;
    note?: string;
  }[];
  /** One per role: the person named to sign it, and their decision once given. */
  signoffs: { role: string; person: { email: string; name?: string }; by?: string; at?: string; decision?: "accepted" | "rejected"; note?: string; stale?: boolean }[];
  /** The eval run the results came from, when an evaluation wrote them. */
  eval_run?: string;
}
export type AcceptanceCriterion = Acceptance["criteria"][number];
export type AcceptanceIssue = Acceptance["issues"][number];
export type AcceptanceSignoff = Acceptance["signoffs"][number];
export interface AcceptanceList {
  use_cases: Acceptance[];
}

/**
 * PUT /api/acceptance/{use_case} (configure): opens the record of a registered use case, or replaces its
 * criteria and signers. A criterion sent with the `id` it already has keeps its result; one sent without
 * an id is new; one left out is removed with its result. `direction` is required when `threshold` is
 * given. `person` is an email address; each role names one person.
 */
export interface AcceptanceSet {
  criteria: { id?: string; text: string; metric?: string; threshold?: number; direction?: CriterionDirection }[];
  signoffs: { role: string; person: string }[];
}

/** POST /api/acceptance/{use_case}/results (configure): a measured result, entered against a finished run of the use case. */
export interface AcceptanceResultEntry {
  criterion: string;
  result: number;
  run: string;
  note?: string;
}

/** POST /api/acceptance/{use_case}/issues (configure). */
export interface AcceptanceIssueOpen {
  text: string;
  severity: Severity;
}

/** POST /api/acceptance/{use_case}/issues/{id}/close (configure). */
export interface AcceptanceIssueClose {
  note?: string;
}

/** POST /api/acceptance/{use_case}/sign (approve): only the person a role names may sign it. A rejection carries a note. */
export interface AcceptanceSign {
  role: string;
  decision: "accepted" | "rejected";
  note: string;
}

/** GET /api/runs?use_case=<workload> → { runs }: the members of a run row the result picker shows. */
export interface UseCaseRun {
  id: string;
  agent: string;
  state: string;
  at: string;
  finished?: string | null;
  /** The use case the run started under, when the row carries it. */
  use_case?: string;
}
export interface UseCaseRunList {
  runs: UseCaseRun[];
}

/** GET /api/workloads → { workloads } */
export interface WorkloadOffer {
  id: Workload | string;
  name: string;
  /** The deployed agent that runs it; absent while none is deployed. */
  agent?: string;
  status: "available" | "not_deployed";
  /**
   * How each kind is sent in the run's input: `dataset` as a DatasetRef, `date_range` as
   * `{from, to}` in UTC ISO time, `list` as an array of strings, `choice` and `text` as a
   * string, `bool` as true or false.
   */
  inputs: { name: string; label: string; kind: "dataset" | "text" | "date_range" | "list" | "choice" | "bool"; dataset_kind?: DatasetKind; choices?: string[]; required?: boolean; help?: string }[];
  /** `shows` is what the approver is asked to look at before deciding (for a penetration test, the scope and the methods). */
  gates: { name: string; role: string; when: string; shows?: string }[];
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

export type SessionKind = "person" | "agent" | "tool_server";
export const SESSION_KINDS: SessionKind[] = ["person", "agent", "tool_server"];
export type SessionState = "active" | "idle" | "expired" | "revoked";
export const SESSION_STATES: SessionState[] = ["active", "idle", "expired", "revoked"];

/**
 * GET /api/sessions → { sessions, counts }: the live sessions, and those that ended lately
 * (expired, revoked) for as long as the control plane keeps them.
 *
 * `person`: someone signed in to the console. `agent`: an agent holding a key or a workload
 * sign-in. `tool_server`: a connection the platform holds open to a tool server on behalf of
 * a person or an agent.
 */
export interface Session {
  id: string;
  kind: SessionKind;
  /**
   * Who is behind it, by the id the identity register knows them by (a person's subject, an
   * agent's id). For a tool server connection: the person or agent it is held for, and `kind`
   * says which.
   */
  principal: { id: string; name: string; email?: string; kind?: "person" | "agent" };
  /** The person who answers for an agent. */
  owner?: Owner;
  /**
   * What they connected with: a browser, an SDK, a tool client, the platform itself. `kind` is
   * a short word the door chooses (`browser`, `api_key`, `workload`, `sdk`, `mcp_client`,
   * `platform`). `registration` is the id of the client's registration when it has one: ending
   * that ends every session issued to it.
   */
  client: { name: string; kind: string; registration?: string };
  /** What it is connected to: the console, the model gateway, a tool server. */
  target: { id: string; name: string; kind: "console" | "gateway" | "tool_server" | string };
  started_at: string;
  last_seen_at?: string | null;
  /** When it must be renewed; absent or null for one that does not lapse. */
  expires_at?: string | null;
  state: SessionState;
  /** The sign-in or authorization server that issued it; `server` is its id on the authorization servers door when it is one of those. */
  issued_by: { name: string; server?: string };
  ip?: string;
  /** What it did lately, newest first, when the door keeps it. */
  activity?: { at: string; action: string; detail?: string }[];
}
export interface SessionList {
  sessions: Session[];
  /** How many of each kind the control plane holds, which may be more than the rows it sent. */
  counts?: Partial<Record<SessionKind, number>>;
  /** Kinds and fields whose feature is not built (`tool_server`, `sessions[].owner.team`, `sessions[].ip`, `sessions[].activity`). */
  not_built?: string[];
}
/** POST /api/sessions/end: the sessions to end, or a client's registration to end with every session issued to it. */
export type SessionsEnd = { ids: string[] } | { client: string };
/** What POST /api/sessions/{id}/end and POST /api/sessions/end answer: the ids of the sessions that ended, and the keys of anyone held out, which keep working. */
export interface SessionsEnded {
  ended: string[];
  live_keys?: LiveKey[];
}

/** Upstream: gives a per-person token for a tool. Workload: its tokens are exchanged by an agent or worker for a short session. */
export type AuthServerPurpose = "upstream" | "workload";
/** How this deployment is registered with an upstream issuer: it registered itself, it is known by a metadata document it hosts, or a person entered a client id. */
export type AuthServerRegistration = "dynamic" | "metadata" | "manual";
export type AuthServerActsAs = "person" | "service_account";
export type AuthServerState = "connected" | "expired" | "unreachable";

/** GET /api/authorization-servers → { servers }. Who signs people in to the console is not one of these: the session door says that. */
export interface AuthServer {
  id: string;
  name: string;
  /** The issuer's address, as its metadata names it. */
  issuer: string;
  purpose: AuthServerPurpose;
  state: AuthServerState;
  /** Upstream only. */
  registration?: AuthServerRegistration;
  /** Upstream only: whether a tool is called as each person or as one service account. */
  acts_as?: AuthServerActsAs;
  /** Upstream only: the client id this deployment holds with the issuer. */
  client_id?: string;
  /** Upstream only: the tool servers that get their tokens from it. */
  tool_servers?: { id: string; name: string }[];
  /** Upstream only: the PKCE methods the issuer advertises (`code_challenge_methods_supported`); `S256` is the one expected. */
  pkce_methods?: string[];
  /** Workload only: the subjects admitted, each exact or a prefix ending in `*`. */
  subjects?: string[];
  /** Sessions it has issued that are still live. */
  sessions?: number;
  /** When the issuer was last reached. */
  checked_at?: string;
  added_at?: string;
  added_by?: Owner;
}
export interface AuthServerList {
  servers: AuthServer[];
}

/**
 * POST /api/authorization-servers/probe with { issuer }: what the issuer publishes at its
 * well-known addresses, under the names it publishes them by (RFC 8414, OpenID Connect
 * Discovery). Nothing is stored.
 */
export interface AuthServerProbe {
  issuer: string;
}
export interface AuthServerMetadata {
  issuer: string;
  /** The address the metadata was read from. */
  metadata_url?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  /** Present when the issuer lets a client register itself. */
  registration_endpoint?: string;
  jwks_uri?: string;
  code_challenge_methods_supported?: string[];
  grant_types_supported?: string[];
  scopes_supported?: string[];
  /** Whether the issuer accepts a client known by a metadata document the client hosts. */
  client_id_metadata_document_supported?: boolean;
}

/** POST /api/authorization-servers answers the new server, bare or as `{server}`. */
export interface AuthServerAdd {
  issuer: string;
  /** Taken from the issuer's address when blank. */
  name?: string;
  purpose: AuthServerPurpose;
  /** Upstream only. */
  registration?: AuthServerRegistration;
  acts_as?: AuthServerActsAs;
  /** Manual registration: the client id the issuer gave, and the vault reference (`${secret:name}`) of its secret when it has one. */
  client_id?: string;
  client_secret?: string;
  /** Workload only. */
  subjects?: string[];
}
export type AuthServerAdded = AuthServer | { server: AuthServer };

/* ═══════════════════ retrieval access (GUI access matrix 1.3) ═══════════════════ */

export type RetrievalRight = "read" | "write" | "delete";
export const RETRIEVAL_RIGHTS: RetrievalRight[] = ["read", "write", "delete"];

/** A knowledge store or data store an agent retrieves from. */
export interface RetrievalStore {
  id: string;
  name: string;
  /** What it is, in the deployment's words: a knowledge namespace, a vector store, a data store. */
  kind: string;
  data_class?: DataClass;
  /** Whether any agent may retrieve from it at all. */
  retrieval: "enabled" | "disabled";
  disabled_by?: Owner;
  disabled_at?: string;
  reason?: string;
}

/** What one agent holds in one store, and what of it has been revoked. */
export interface RetrievalGrant {
  agent: string;
  agent_name?: string;
  store: string;
  /** What its definition grants it. */
  rights: RetrievalRight[];
  /** What of that is revoked now. */
  revoked: RetrievalRight[];
  revoked_by?: Owner;
  revoked_at?: string;
  reason?: string;
}

export interface RetrievalEvent {
  at: string;
  who: Owner;
  action: "revoked" | "restored" | "disabled" | "enabled";
  agent?: string;
  store?: string;
  rights?: RetrievalRight[];
  reason?: string;
}

/** GET /api/retrieval/access */
export interface RetrievalAccess {
  stores: RetrievalStore[];
  grants: RetrievalGrant[];
  history: RetrievalEvent[];
}

/** POST /api/retrieval/access/revoke and /restore. With no `store`, every store the agent holds. */
export interface RetrievalChange {
  agent: string;
  store?: string;
  rights: RetrievalRight[];
  reason: string;
}

/** POST /api/retrieval/stores/{id}/disable and /enable. */
export interface RetrieverSwitch {
  reason: string;
}

/* ═══════════════════ a run paused at its budget (GUI access matrix 1.12) ═══════════════════ */

export type BudgetMeasure = "tool_calls" | "tokens" | "cost_usd" | "wall_clock_s";

export interface BudgetHold {
  id: string;
  run: string;
  agent: string;
  agent_name?: string;
  use_case?: string;
  /** Who started the run. */
  owner?: Owner;
  /** Which ceiling it reached. */
  measure: BudgetMeasure;
  limit: number;
  used: number;
  paused_at: string;
  state: "waiting" | "continued" | "stopped" | "expired";
  /** When the hold ends by itself; the run then stops. */
  expires_at?: string;
  decided_by?: Owner;
  decided_at?: string;
  /** The new ceiling, when it continued. */
  raised_to?: number;
  reason?: string;
}

/** GET /api/budget/holds?state= */
export interface BudgetHoldList {
  holds: BudgetHold[];
}

/** POST /api/budget/holds/{id}/decide. `raise_to` is required to continue and must be above what was used. */
export interface BudgetHoldDecision {
  decision: "continue" | "stop";
  raise_to?: number;
  reason: string;
}

/* ═══════════════════ compliance view (GUI access matrix 1.18) ═══════════════════ */

/** One control of ABB's own control list, as loaded. */
export interface IclControl {
  id: string;
  title: string;
  domain?: string;
  text?: string;
}

/** What this deployment has changed about a catalogue control. */
export interface ControlCustom {
  /** False when the deployment has recorded that the control does not apply to it. */
  applies: boolean;
  /** Why, or how it is met differently. */
  note?: string;
  /** Who answers for the control here. */
  owner?: string;
}

/** GET /api/compliance */
export interface Compliance {
  /** The list as loaded; null until one is. */
  icl: { name: string; version?: string; loaded_at?: string; loaded_by?: Owner; controls: IclControl[] } | null;
  /** Catalogue control id (lib/guardrails.ts) to the ICL controls it answers. */
  mapping: Record<string, string[]>;
  custom: Record<string, ControlCustom>;
  updated_at?: string;
  updated_by?: Owner;
}

/** PUT /api/compliance: only the parts sent are replaced. */
export interface ComplianceSave {
  mapping?: Record<string, string[]>;
  custom?: Record<string, ControlCustom>;
}

/* ═══════════════════ use cases (GUI access matrix 1.14) ═══════════════════ */

export type UseCaseState = "draft" | "awaiting_approval" | "approved";

/** A point where a run of the use case waits for a person. When nobody answers in time it escalates or stops; it never proceeds. */
export interface UseCaseGate {
  name: string;
  /** The role whose holders may answer the gate. */
  approver_role: string;
  /** What sends a run to this gate, in plain words. */
  threshold: string;
  /** How long the gate waits for an answer. */
  timeout_minutes: number;
  on_timeout: "escalate" | "stop";
  /** The role it goes to when it escalates. */
  escalate_to?: string;
}

export interface UseCase {
  id: string;
  name: string;
  owner: Owner;
  data_classes: DataClass[];
  /** An autonomy tier of the platform, `L0` to `L5` (lib/api/l9.ts TIERS). */
  autonomy: string;
  /** The workload it uses (a `Workload` id, or another the workloads door lists). */
  workload: string;
  gates: UseCaseGate[];
  state: UseCaseState;
  registered_at?: string;
  registered_by?: Owner;
  approved_at?: string;
  approved_by?: Owner;
}

/** GET /api/use-cases */
export interface UseCaseList {
  use_cases: UseCase[];
}

/** POST /api/use-cases. It is registered as a draft; `owner` is the email or name of the person who answers for it. */
export interface UseCaseRegistration {
  name: string;
  owner: string;
  data_classes: DataClass[];
  autonomy: string;
  workload: string;
  gates: UseCaseGate[];
}

/** PATCH /api/use-cases/{id}: only the parts sent change. `state` moves it on: a draft to awaiting approval, awaiting approval to approved. */
export type UseCaseChange = Partial<UseCaseRegistration> & { state?: UseCaseState };

/* ═══════════════════ cloud security findings (GUI access matrix 1.16) ═══════════════════ */

export interface CloudFinding {
  id: string;
  /** What it is about, in the security centre's words. */
  title: string;
  /** The security centre's own category for it. */
  category?: string;
  severity: Severity;
  /** The resource it was found on, as the provider names it. */
  resource: string;
  resource_type?: string;
  found_at: string;
  state: "active" | "muted" | "fixed";
  /** The finding in the provider's own console. */
  url?: string;
}

/** GET /api/security/findings?state=&severity=&limit= */
export interface CloudFindingList {
  /** The security centre the findings come from, as the deployment names it. */
  source?: string;
  /** When the security centre was last read. */
  read_at?: string;
  findings: CloudFinding[];
  /** How many findings match in all, as the security centre counts them; null when it does not say. */
  total?: number | null;
  /** The security centre holds more than this page of findings. */
  truncated?: boolean;
}

/* ═══════════════════ asking ═══════════════════ */

/**
 * What a door answered. A refusal keeps the platform's whole body in `body`
 * (its `error` is already in `message`), because some refusals carry more than
 * a sentence: `not_built` (a 409 for a feature not built), `needs` (what a
 * service account must hold), `levels`, or `ended` (what a batch did before it
 * was refused).
 */
export type Answer<T> = { state: "ok"; data: T } | { state: "pending"; door: Door } | { state: "error"; message: string; status?: number; body?: unknown };

/** A member of a refusal's body, when the refusal carried one. */
export function refusalField(answer: Answer<unknown> | null | undefined, name: string): unknown {
  if (!answer || answer.state !== "error" || !answer.body || typeof answer.body !== "object") return undefined;
  return (answer.body as Record<string, unknown>)[name];
}

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
  let parsed = true;
  try {
    body = await res.clone().json();
  } catch {
    parsed = false;
  }
  const said = body && typeof body === "object" && "error" in body ? String((body as { error?: unknown }).error ?? "") : "";
  // Only the platform's own "not built" answer reads as not built. A 404 or 405 is a fault (an address or a
  // method the platform does not know) and is shown as one, with its status.
  if (res.status === 501) return { state: "pending", door };
  const where = `${door.method} ${door.path}`;
  if (!res.ok) return { state: "error", message: said ? `${said} (${res.status} from ${where})` : `the backend did not answer ${where} (${res.status})`, status: res.status, body: said ? body : undefined };
  if (!parsed) return { state: "error", message: `${where} answered ${res.status} with a body that is not JSON`, status: res.status };
  return { state: "ok", data: body as T };
}
