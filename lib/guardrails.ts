/**
 * The control catalogue.
 *
 * Written the way a control is written: an identifier, a statement of what the
 * platform shall do, how it is implemented, and what evidence it produces. Not
 * a description of a feature — a reviewer should be able to lift a row of this
 * into a control matrix unchanged.
 *
 * The references say where each control comes from. That direction matters: we
 * are not scoring ourselves against somebody's top ten, we are stating what is
 * enforced and citing the standards that informed it. A standard is a source,
 * not an examiner.
 *
 * Everything here corresponds to code that runs. The `journal` key is the
 * string the policy engine writes when the control fires, which is how the
 * Guardrails page counts real firings rather than asserting coverage.
 */

export interface Reference {
  /** Short standard name, as a reviewer would cite it. */
  std: string;
  /** The clause, article or entry. */
  ref: string;
  /** What that entry is called. */
  name: string;
}

export interface Control {
  /** Catalogue identifier, stable across releases. */
  id: string;
  family: string;
  title: string;
  /** The control statement, in the register a control register expects. */
  statement: string;
  /** How this deployment satisfies the statement. */
  implementation: string;
  /** What the control leaves behind for an auditor. */
  evidence: string;
  /** The string the engine journals when this fires; "—" when it acts outside a run. */
  journal: string;
  /** Position in the policy engine, or null when it is not evaluated per call. */
  order: number | null;
  references: Reference[];
}

const ASI = (ref: string, name: string): Reference => ({ std: "OWASP Agentic", ref, name });
const LLM = (ref: string, name: string): Reference => ({ std: "OWASP LLM", ref, name });
const NIST = (ref: string, name: string): Reference => ({ std: "NIST AI RMF", ref, name });
const ISO = (ref: string, name: string): Reference => ({ std: "ISO/IEC 42001", ref, name });
const EU = (ref: string, name: string): Reference => ({ std: "EU AI Act", ref, name });

export const FAMILIES = [
  { id: "AC", name: "Access control", purpose: "What an agent may reach, and on whose authority." },
  { id: "DP", name: "Data protection", purpose: "What untrusted content may become, and where it may go." },
  { id: "HO", name: "Human oversight", purpose: "Which decisions a person takes, and how that is recorded." },
  { id: "IN", name: "Integrity", purpose: "That what runs is what was approved, and that values are what they claim." },
  { id: "RS", name: "Resilience", purpose: "That one bad decision stays local and bounded." },
  { id: "AU", name: "Accountability", purpose: "That every decision can be reconstructed afterwards." },
  { id: "ID", name: "Identity and credentials", purpose: "Who is acting, on whose authority, and where the secrets are." },
];

export const CONTROLS: Control[] = [
  /* ── Access control ── */
  {
    id: "AF-AC-01",
    family: "AC",
    title: "Capability restriction",
    statement:
      "An agent shall invoke only the tools explicitly granted to the step invoking them. A tool that has not been granted shall not be reachable by any path.",
    implementation:
      "Tools are granted per step when the workflow is authored. The policy engine resolves the grant before every call and refuses an ungranted tool as its first check.",
    evidence: "A refusal entry naming the step, the tool, and the grants it holds instead.",
    journal: "capability",
    order: 1,
    references: [
      ASI("ASI02", "Tool misuse and exploitation"),
      LLM("LLM03", "Excessive agency"),
      NIST("MANAGE", "Risks are prioritised and acted upon"),
      ISO("A.9", "Use of AI systems"),
    ],
  },
  {
    id: "AF-AC-02",
    family: "AC",
    title: "Scope limitation",
    statement:
      "Where a tool is granted, its arguments shall be constrained to the limits declared at registration, and may be narrowed further for an individual step.",
    implementation:
      "Argument constraints are declared on the tool binding and validated at the tool boundary on every call, before the call is made.",
    evidence: "A refusal entry naming the constraint violated and the value that violated it.",
    journal: "scope",
    order: 2,
    references: [
      ASI("ASI02", "Tool misuse and exploitation"),
      LLM("LLM03", "Excessive agency"),
      ISO("A.9", "Use of AI systems"),
    ],
  },
  {
    id: "AF-AC-03",
    family: "AC",
    title: "Prohibited actions",
    statement:
      "The authoring team shall be able to declare actions that are never permitted, and those actions shall be refused irrespective of any grant.",
    implementation:
      "A prohibited-action list on the workflow policy, matched against the tool and its arguments before execution.",
    evidence: "A refusal entry naming the prohibition that matched.",
    journal: "injection.action",
    order: 3,
    references: [ASI("ASI02", "Tool misuse and exploitation"), NIST("GOVERN", "Policies and procedures are in place")],
  },
  {
    id: "AF-AC-04",
    family: "AC",
    title: "Egress restriction",
    statement:
      "Network destinations reachable during a run shall be restricted to an allowlist, and any host not on the list shall be refused.",
    implementation:
      "A per-deployment host allowlist enforced inside the retrieval and fetch capabilities. Deny by default: an empty list permits nothing.",
    evidence: "A refusal entry naming the host and the allowlist in force.",
    journal: "egress",
    order: 7,
    references: [
      ASI("ASI05", "Unexpected code execution"),
      LLM("LLM02", "Sensitive information disclosure"),
      EU("Art. 15", "Accuracy, robustness and cybersecurity"),
    ],
  },

  /* ── Data protection ── */
  {
    id: "AF-DP-01",
    family: "DP",
    title: "Untrusted content marking",
    statement:
      "Content originating outside the system shall be marked untrusted at the point of retrieval, and the mark shall travel with every value derived from it.",
    implementation:
      "Tools declare whether they return externally authored content. Marks propagate through derivation rather than attaching to the call.",
    evidence: "A marking entry naming the source that introduced the content.",
    journal: "taint",
    order: 4,
    references: [
      ASI("ASI01", "Agent goal hijack"),
      ASI("ASI06", "Memory and context poisoning"),
      LLM("LLM08", "Hidden context exposure"),
      ISO("A.7", "Data for AI systems"),
    ],
  },
  {
    id: "AF-DP-02",
    family: "DP",
    title: "Sink protection",
    statement:
      "An action taking effect outside the system shall not proceed on arguments derived from untrusted content unless a person authorises it.",
    implementation:
      "Tools declare whether they act outside the system. Where marked content reaches one, the call is refused or gated according to the workflow policy.",
    evidence: "A refusal or gate entry naming the source the arguments derive from.",
    journal: "taint",
    order: 4,
    references: [
      ASI("ASI01", "Agent goal hijack"),
      LLM("LLM01", "Prompt injection"),
      LLM("LLM02", "Sensitive information disclosure"),
      EU("Art. 15", "Accuracy, robustness and cybersecurity"),
    ],
  },
  {
    id: "AF-DP-03",
    family: "DP",
    title: "Durable memory protection",
    statement:
      "State persisting between runs shall be protected as an action taking effect outside the system.",
    implementation:
      "The durable store is registered as a sink, so untrusted content cannot be written into state that later runs treat as established fact.",
    evidence: "A refusal entry where a write derives from marked content.",
    journal: "taint",
    order: 4,
    references: [ASI("ASI06", "Memory and context poisoning"), LLM("LLM08", "Hidden context exposure")],
  },
  {
    id: "AF-DP-04",
    family: "DP",
    title: "Content screening",
    statement:
      "Untrusted content entering a run shall be screened for known instruction-injection patterns before a model reads it.",
    implementation:
      "Pattern screening on the workflow policy, applied to marked content on the way in. Scoped deliberately: it catches known attempts, and the controls above it do not depend on it.",
    evidence: "A refusal entry naming the pattern that matched.",
    journal: "injection.input",
    order: 6,
    references: [ASI("ASI01", "Agent goal hijack"), LLM("LLM01", "Prompt injection")],
  },

  /* ── Human oversight ── */
  {
    id: "AF-HO-01",
    family: "HO",
    title: "Authorisation gate",
    statement:
      "Actions at or above a declared risk classification shall not proceed until a nominated person authorises them.",
    implementation:
      "Risk is declared when a tool is registered and read as a lookup at call time, never inferred during the run. The workflow declares the threshold and the approvers.",
    evidence: "A gate entry recording the question, the approvers it was put to, and what happens if nobody answers.",
    journal: "gate",
    order: 5,
    references: [
      ASI("ASI09", "Human-agent trust exploitation"),
      LLM("LLM03", "Excessive agency"),
      EU("Art. 14", "Human oversight"),
      ISO("A.9", "Use of AI systems"),
      NIST("MANAGE", "Mechanisms for human intervention"),
    ],
  },
  {
    id: "AF-HO-02",
    family: "HO",
    title: "Attributable authorisation",
    statement:
      "An authorisation shall record who gave it and on what basis, and shall not be recordable anonymously.",
    implementation:
      "The approval interface requires an identity and accepts a rationale; both are written to the run record before the run continues.",
    evidence: "An answer entry carrying the approver's identity, their note and the timestamp.",
    journal: "gate",
    order: 5,
    references: [EU("Art. 14", "Human oversight"), EU("Art. 12", "Record-keeping"), ISO("A.9", "Use of AI systems")],
  },

  {
    id: "AF-HO-03",
    family: "HO",
    title: "Corpus admission",
    statement:
      "Content fetched for the knowledge base shall be quarantined until a person admits it, and shall not be retrievable before that decision is recorded against a named individual.",
    implementation:
      "Fetching stages a document and splits it; nothing is embedded or searchable until admission. Refusals discard the staged content and are recorded with the same weight as admissions.",
    evidence: "An admission record naming who admitted or refused the document, when, and why.",
    journal: "—",
    order: null,
    references: [
      ASI("ASI06", "Memory and context poisoning"),
      LLM("LLM05", "Data and model poisoning"),
      ISO("A.7", "Data for AI systems"),
      EU("Art. 14", "Human oversight"),
    ],
  },
  {
    id: "AF-DP-05",
    family: "DP",
    title: "Retrieval scope enforcement",
    statement:
      "A retrieval shall return only content from sources that are enabled and documents that are admitted, and the restriction shall be applied in the query rather than to its results.",
    implementation:
      "Source and document state are conditions of the search itself, so disabling a source takes effect on the next question rather than the next reindex. Superseded versions are removed from the index when a newer one is admitted.",
    evidence: "The query predicate, and the superseding record on each replaced document.",
    journal: "—",
    order: null,
    references: [
      LLM("LLM02", "Sensitive information disclosure"),
      LLM("LLM08", "Hidden context exposure"),
      ISO("A.7", "Data for AI systems"),
    ],
  },

  /* ── Identity and credentials ── */
  {
    id: "AF-ID-01",
    family: "ID",
    title: "Ingress authentication",
    statement:
      "Work posted to the platform shall present a key, and a key issued for one workflow shall not be able to start another.",
    implementation:
      "Keys are minted per caller and optionally scoped to a workflow; the trigger endpoint authenticates before it reads the request, and a scoped key presented against a different workflow is refused.",
    evidence: "The key's prefix, name and scope on every queued job, and a 401 or 403 in the access record where it was refused.",
    journal: "—",
    order: null,
    references: [
      ASI("ASI03", "Identity and privilege abuse"),
      NIST("GOVERN", "Roles and responsibilities are defined"),
      ISO("A.9", "Use of AI systems"),
    ],
  },
  {
    id: "AF-ID-02",
    family: "ID",
    title: "Credential reference, never embedding",
    statement:
      "A workflow shall reference credentials by name, and a credential's value shall never appear in a workflow, a prompt, or a run record.",
    implementation:
      "Connectors carry a vault reference such as ${secret:name}. The runtime resolves it at the tool boundary, after the call has been journalled, so the record holds the reference and the model never holds the value.",
    evidence: "Vault references in every deployed workflow; no resolved value in any journal entry.",
    journal: "—",
    order: null,
    references: [
      ASI("ASI03", "Identity and privilege abuse"),
      LLM("LLM02", "Sensitive information disclosure"),
      LLM("LLM08", "Hidden context exposure"),
    ],
  },
  {
    id: "AF-ID-03",
    family: "ID",
    title: "Agent identity assertion",
    statement:
      "A call from one agent to another shall carry the calling workflow's identity and version, so the receiving party can distinguish one agent from another and one version from the next.",
    implementation:
      "Every A2A request carries the workflow id and its content digest as headers alongside the bearer credential. A shared, anonymous identity is the shape privilege abuse takes in multi-agent systems.",
    evidence: "The identity headers on each outbound peer request, and the digest they carry matching the deployed workflow.",
    journal: "—",
    order: null,
    references: [
      ASI("ASI03", "Identity and privilege abuse"),
      ASI("ASI07", "Insecure inter-agent communication"),
      ISO("A.10", "Third-party relationships"),
    ],
  },

  /* ── Integrity ── */
  {
    id: "AF-IN-01",
    family: "IN",
    title: "Typed interface enforcement",
    statement:
      "A value passing between steps shall conform to the interface the receiving step declares, and shall be rejected at the boundary where it does not.",
    implementation:
      "Every step declares what it expects and what it emits. Interfaces are checked when the workflow is parsed and again when data actually moves.",
    evidence: "A breach entry naming the field and the expectation it failed.",
    journal: "contract.breach",
    order: 9,
    references: [LLM("LLM10", "Improper output handling"), ASI("ASI08", "Cascading failures")],
  },
  {
    id: "AF-IN-02",
    family: "IN",
    title: "Design-time validation",
    statement: "A workflow that cannot be shown safe by inspection shall not be deployable.",
    implementation:
      "The parser refuses unreachable steps, mistyped edges, a planned call to an ungranted tool, a gate with no approver, a fan-out over a list nothing produces, and any single step holding both a tool that returns untrusted content and a tool that acts outside the system.",
    evidence: "A parse failure naming the exact field, recorded against the deployment attempt.",
    journal: "—",
    order: null,
    references: [
      ASI("ASI02", "Tool misuse and exploitation"),
      ISO("A.6.2", "AI system life cycle"),
      NIST("MAP", "Context and risks are identified"),
    ],
  },
  {
    id: "AF-IN-03",
    family: "IN",
    title: "Version integrity",
    statement:
      "A run shall be bound to the exact version of the workflow that started it, and shall not continue under a different one.",
    implementation:
      "Each workflow carries a content digest. A suspended run refuses to resume when the digest has changed, rather than attributing one configuration's decisions to another.",
    evidence: "The digest on every run record, and a refusal to resume where it differs.",
    journal: "—",
    order: null,
    references: [
      ASI("ASI04", "Agentic supply chain"),
      LLM("LLM04", "Supply chain"),
      ISO("A.6.2", "AI system life cycle"),
      EU("Art. 12", "Record-keeping"),
    ],
  },
  {
    id: "AF-IN-04",
    family: "IN",
    title: "Execution isolation requirement",
    statement: "A capability that executes supplied code shall refuse to operate unless isolation is attached.",
    implementation:
      "The sandbox capability declines rather than executing unisolated, and says so in the run record. This is the one place the platform prefers to fail than to proceed.",
    evidence: "A tool error stating that no isolation is attached to this deployment.",
    journal: "—",
    order: null,
    references: [ASI("ASI05", "Unexpected code execution"), EU("Art. 15", "Accuracy, robustness and cybersecurity")],
  },

  /* ── Resilience ── */
  {
    id: "AF-RS-01",
    family: "RS",
    title: "Execution budget",
    statement:
      "Every run shall be bounded in reasoning steps, tool invocations and tokens, and exhausting a budget shall be recorded distinctly from finding nothing.",
    implementation:
      "A step budget per reasoning node, a tool-call ceiling per run, and a token ceiling per completion. Exhaustion ends the run with a stated reason.",
    evidence: "An exit entry stating the budget that was exhausted.",
    journal: "—",
    order: 10,
    references: [
      LLM("LLM06", "Unbounded consumption"),
      ASI("ASI08", "Cascading failures"),
      NIST("MEASURE", "Performance is tracked"),
    ],
  },
  {
    id: "AF-RS-02",
    family: "RS",
    title: "Delegation depth limit",
    statement:
      "An agent invoking another agent shall be limited in depth, so a failure cannot propagate indefinitely through a chain.",
    implementation: "Three levels, enforced by the runtime; the fourth invocation is refused.",
    evidence: "A refusal entry naming the depth already reached.",
    journal: "depth",
    order: 8,
    references: [ASI("ASI08", "Cascading failures"), ASI("ASI10", "Rogue agents")],
  },
  {
    id: "AF-RS-03",
    family: "RS",
    title: "Operator termination",
    statement:
      "An operator shall be able to terminate any run in flight, and the termination shall be recorded as a decision rather than a fault.",
    implementation:
      "A kill switch over the live-run registry signals the runtime; the runtime traps it, journals the termination and persists the partial record.",
    evidence: "A run recorded as killed, naming the operator action.",
    journal: "—",
    order: null,
    references: [
      ASI("ASI10", "Rogue agents"),
      EU("Art. 14", "Human oversight"),
      NIST("MANAGE", "Mechanisms to supersede or deactivate"),
    ],
  },

  /* ── Accountability ── */
  {
    id: "AF-AU-01",
    family: "AU",
    title: "Decision record",
    statement:
      "Every decision, refusal, authorisation and tool result shall be recorded with the evidence it rested on, and retained with the run.",
    implementation:
      "The runtime writes a journal entry for each, carrying the identifiers of the entries it derived from, so any conclusion can be followed to the evidence beneath it.",
    evidence: "The run journal itself, which is the artefact an auditor is given.",
    journal: "—",
    order: null,
    references: [
      EU("Art. 12", "Record-keeping"),
      ISO("A.6.2", "AI system life cycle"),
      NIST("MEASURE", "Results are documented"),
      LLM("LLM07", "Misinformation"),
    ],
  },
  {
    id: "AF-AU-02",
    family: "AU",
    title: "Nothing silently dropped",
    statement:
      "A step skipped, a search that found nothing, and a partial result shall each be recorded distinctly, and shall not be presented identically.",
    implementation:
      "Skips record the guard that was false; empty results record that something looked; partial fan-outs record the count attempted against the count returned.",
    evidence: "Entries distinguishing these three outcomes on the face of the record.",
    journal: "—",
    order: null,
    references: [EU("Art. 12", "Record-keeping"), NIST("MEASURE", "Results are documented")],
  },
  {
    id: "AF-AU-03",
    family: "AU",
    title: "Inter-agent authentication",
    statement:
      "A call to an agent outside this deployment shall be authenticated, and that agent's response shall be treated as untrusted content.",
    implementation:
      "Peer connections carry a bearer credential resolved from the vault. Handing work to a peer is registered as a sink; a peer's reply is marked untrusted on arrival.",
    evidence: "The credential reference on the connector, and a marking entry on every peer response.",
    journal: "taint",
    order: 4,
    references: [
      ASI("ASI07", "Insecure inter-agent communication"),
      ASI("ASI03", "Identity and privilege abuse"),
      ISO("A.10", "Third-party relationships"),
    ],
  },
];

/** The standards cited above, and why each is in the catalogue. */
export const STANDARDS: { std: string; title: string; note: string }[] = [
  {
    std: "OWASP Agentic",
    title: "OWASP Top 10 for Agentic Applications, 2026",
    note: "Published December 2025 for systems that plan, hold memory, call tools and act with delegated authority. The closest published work to what this platform builds.",
  },
  {
    std: "OWASP LLM",
    title: "OWASP Top 10 for LLM Applications, 2026",
    note: "Reissued August 2026. Excessive agency rose to third and hidden context exposure replaced system prompt leakage; this catalogue addresses both directly.",
  },
  {
    std: "NIST AI RMF",
    title: "NIST AI Risk Management Framework, AI 100-1",
    note: "The govern, map, measure and manage functions. The run record is the measure and manage evidence.",
  },
  {
    std: "ISO/IEC 42001",
    title: "ISO/IEC 42001 AI management systems",
    note: "Annex A control objectives, principally the AI system life cycle, data, use of AI systems, and third-party relationships.",
  },
  {
    std: "EU AI Act",
    title: "Regulation (EU) 2024/1689",
    note: "Article 12 record-keeping, Article 14 human oversight, Article 15 robustness and cybersecurity.",
  },
];

/**
 * What the deploying organisation retains. A responsibility split, not a gap
 * list: these are controls that cannot be implemented from inside the platform,
 * and every serious control document states them rather than leaving a reviewer
 * to discover them.
 */
export const CLIENT_RESPONSIBILITIES = [
  {
    title: "Agent identity and credential lifecycle",
    body: "Agents act with credentials the deployment holds. Issuing a distinct identity per agent, scoping it, and rotating it are functions of the client's identity provider.",
    references: [ASI("ASI03", "Identity and privilege abuse")],
  },
  {
    title: "Provenance of models and plugin servers",
    body: "The workflow is pinned by digest. What it loads — model deployments and plugin servers — is governed by the client's own supply-chain assurance, including any bill of materials and signature policy.",
    references: [ASI("ASI04", "Agentic supply chain"), LLM("LLM04", "Supply chain")],
  },
  {
    title: "Governance of the retrieved corpora",
    body: "Agents retrieve from the client's systems. The integrity of those systems, and of any index built over them, remains under the client's existing data controls.",
    references: [LLM("LLM05", "Data and model poisoning"), LLM("LLM09", "Vector and embedding weaknesses")],
  },
  {
    title: "Sampling review of automated dispositions",
    body: "Where a workflow disposes of work without a person, periodic review of a sample is the compensating control for the residual risk below.",
    references: [EU("Art. 14", "Human oversight")],
  },
];

/** The residual risk statement, at the same weight as the controls. */
export const RESIDUAL_RISK = {
  title: "Residual risk: a steered but permitted decision",
  body:
    "No control in this catalogue prevents a decision that breaks no rule and is nonetheless wrong — auto-closing a real incident, or recording an unimplemented control as implemented. Nothing leaves, no allowlist breaks, and the difference between the harmful action and the correct one is only whether the reasoning was sound. The compensating controls are the decision record, which makes the reasoning reviewable, and sampling review of automated dispositions, which is why that review is a security control rather than quality assurance.",
};

/**
 * What fired, for the surfaces that show a refusal rather than describe a
 * control: the theater's journal and the control pane's denials. The journal
 * writes the engine's own control string; this maps it back to the catalogue.
 */
export function explainControl(control: string): { name: string; decides: string; id?: string } {
  const c = CONTROLS.find((x) => x.journal === control);
  if (c) return { name: c.title, decides: c.statement, id: c.id };
  if (control === "contract.breach") {
    const t = CONTROLS.find((x) => x.id === "AF-IN-01")!;
    return { name: t.title, decides: t.statement, id: t.id };
  }
  return { name: control, decides: "" };
}
