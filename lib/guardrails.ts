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
  {
    id: "AF-AC-05",
    family: "AC",
    title: "Argument limit",
    statement:
      "A limit declared on a tool's argument shall be enforced outside the model, and a call outside it shall be refused before it runs, whatever the model said.",
    implementation:
      "The workflow policy names a tool, an argument and a minimum, a maximum or a closed set of values. The policy engine compares the plain value after scope, before anything executes.",
    evidence: "A refusal entry naming the tool, the argument and the limit it broke.",
    journal: "limit",
    order: 2,
    references: [
      ASI("ASI02", "Tool misuse and exploitation"),
      ASI("ASI09", "Human-agent trust exploitation"),
      LLM("LLM03", "Excessive agency"),
      ISO("A.9", "Use of AI systems"),
    ],
  },
  {
    id: "AF-AC-06",
    family: "AC",
    title: "Delegation ceiling",
    statement:
      "Work handed to another agent shall run with no more than the party handing it could do: delegation shall narrow what a delegate may do, never widen it.",
    implementation:
      "A sub-run runs under its caller's effective grants, argument scopes and gate floor, and a peer's task under the signed envelope that carries them. A tool outside them, an argument outside their scope and work past the tree's depth cap are refused.",
    evidence: "A refusal entry naming the tool or the depth, and the envelope on the run's record.",
    journal: "delegation",
    order: 2,
    references: [
      ASI("ASI02", "Tool misuse and exploitation"),
      ASI("ASI03", "Identity and privilege abuse"),
      ASI("ASI07", "Insecure inter-agent communication"),
      LLM("LLM03", "Excessive agency"),
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
    id: "AF-HO-04",
    family: "HO",
    title: "Two-person tool admission",
    statement:
      "Where the deployment requires it, a tool server shall not be approved by the person who registered it.",
    implementation:
      "With two-person approval on, the MCP registry refuses an approval signed by the server's own registrant and names this control, so admitting a server to runs takes two people.",
    evidence: "Each server's registrant beside the approvals on its pin, and the refused approval in the access record.",
    // The registry refuses outside any run, naming `two_person` (an alias below).
    journal: "—",
    order: null,
    references: [
      EU("Art. 14", "Human oversight"),
      NIST("GOVERN", "Roles and responsibilities are defined"),
      ASI("ASI04", "Agentic supply chain"),
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
  {
    id: "AF-DP-06",
    family: "DP",
    title: "Data class ceiling",
    statement:
      "Content shall carry the data class of its source, and shall not reach a sink, an output or a peer cleared for a lower class.",
    implementation:
      "Tools, retrieval sources and peers declare a class, and the mark travels with every value derived from the content, as taint does. A sink, a webhook output or a peer whose limit is lower refuses it, a grant may cap what its step reads, and a task handed to a peer carries its class in the signed envelope.",
    evidence: "A refusal entry naming the class carried and the limit in force.",
    journal: "data_class",
    order: 3,
    references: [LLM("LLM02", "Sensitive information disclosure"), ISO("A.7", "Data for AI systems")],
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
  {
    id: "AF-IN-05",
    family: "IN",
    title: "Tool supply-chain pinning",
    statement:
      "A tool server shall reach a run only under the tool list a person approved, and a server whose tool list differs from the approved one shall not attach until it is approved again.",
    implementation:
      "Registering starts the server once, screens every tool's name, description and schema, and pins the tool list by SHA-256 digest; the server stays pending until a person approves the pin. The runtime refuses to attach a server whose pin is not approved or whose live tool list differs from it, and a rescan that finds a different list marks the server changed and detaches it.",
    evidence: "The registry's pin, scans and approvals for every server, and a refusal entry naming the server wherever an unapproved or changed one was asked for.",
    journal: "supply_chain",
    order: null,
    references: [
      ASI("ASI04", "Agentic supply chain"),
      LLM("LLM04", "Supply chain"),
      ISO("A.10", "Third-party relationships"),
    ],
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
    journal: "budget",
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
    // The runtime stamps the kill entry with this catalogue id, so the
    // Guardrails page counts terminations like any other firing.
    journal: "kill",
    order: null,
    references: [
      ASI("ASI10", "Rogue agents"),
      EU("Art. 14", "Human oversight"),
      NIST("MANAGE", "Mechanisms to supersede or deactivate"),
    ],
  },
  {
    id: "AF-RS-04",
    family: "RS",
    title: "Mass-action gate",
    statement:
      "A run issuing more calls of one sink than its policy allows shall wait for a person at the next one, so that one bad decision cannot act at scale.",
    implementation:
      "The runtime counts each sink's calls per run, across a suspension. Every call past the policy's maximum, ten by default, is gated, on top of the circuit breakers.",
    evidence: "A gate entry naming the sink, the count reached and the limit.",
    journal: "mass_action",
    order: 5,
    references: [
      ASI("ASI08", "Cascading failures"),
      LLM("LLM03", "Excessive agency"),
      EU("Art. 14", "Human oversight"),
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
 * writes the engine's own control string — a journal key for a refusal, the
 * catalogue id for a kill or a marking — and this maps either back.
 */
export function explainControl(control: string): { name: string; decides: string; id?: string } {
  const alias = Object.hasOwn(ALIASES, control) ? ALIASES[control] : PREFIX_ALIASES.find(([p]) => control.startsWith(p))?.[1];
  const c =
    CONTROLS.find((x) => x.id === control) ??
    CONTROLS.find((x) => x.journal === control) ??
    (alias ? CONTROLS.find((x) => x.id === alias) : undefined);
  if (c) return { name: c.title, decides: c.statement, id: c.id };
  return { name: control, decides: "" };
}

/**
 * Keys that name a register row other than by its journal key. A typed
 * interface breach is journalled by its kind; the MCP registry's refusals
 * happen outside any run (phase L6): `screener` when a tool's name,
 * description or schema read as an injection at admission (and
 * `screener.unavailable` when the screener could not judge, so nothing was
 * admitted), `two_person` when the server's own registrant tried to
 * approve it. The hits themselves name the screener's tool rules
 * (backend/README.md): `classifier.tool` for weak signals together. The report
 * gate is an authorisation gate that names what it holds: `report` counts
 * where `gate` counts, so its approvals reach every pack `gate`'s do.
 */
const ALIASES: Record<string, string> = {
  "contract.breach": "AF-IN-01",
  report: "AF-HO-01",
  screener: "AF-DP-04",
  "screener.unavailable": "AF-DP-04",
  "classifier.tool": "AF-DP-04",
  two_person: "AF-HO-04",
};

/**
 * Families of keys that name one register row: the local screener's
 * tool-poisoning rules (`poisoning.override`, `.concealment`,
 * `.credentials`, `.exfiltration`, `.hidden`, `.shadowing`, `.name`) and
 * Model Armor's verdicts on a tool (`modelarmor.tool.<filter>`), all of them
 * content screening applied to what a tool tells a model about itself.
 */
const PREFIX_ALIASES: [string, string][] = [
  ["poisoning.", "AF-DP-04"],
  ["modelarmor.tool", "AF-DP-04"],
  // A screener's verdict on what a tool returned, before a model reads it (phase2-contract.md §4 step 33):
  // content screening of a result, the same register row as the definition's own patterns on it.
  ["classifier.result", "AF-DP-04"],
  ["modelarmor.result", "AF-DP-04"],
];

/**
 * A firing in a line, for the places that show one by its key rather than
 * its register row: the MCP registry's refusals and screener hits, a tool
 * server the builder holds back, a call the runtime would not attach. A key
 * with no line of its own reads as its control's title; an unknown key as
 * itself.
 */
export const CONTROL_LABELS: Record<string, string> = {
  supply_chain: "Tool server not approved or its tools changed",
  report: "A deliverable held for a person's review",
  two_person: "A second person must approve",
  screener: "A tool's name, description or schema failed screening",
  "screener.unavailable": "The screener could not judge, so nothing was admitted",
  egress: "Host outside the egress allowlist",
  "poisoning.override": "Tool text overrides the agent's instructions",
  "poisoning.concealment": "Tool text hides a step from the user",
  "poisoning.credentials": "Tool text reaches for credentials",
  "poisoning.exfiltration": "Tool text sends data to an outside address",
  "poisoning.hidden": "Hidden instructions in tool text",
  "poisoning.shadowing": "Tool text reshapes other tools",
  "poisoning.name": "Tool name outside the MCP character set",
  "classifier.tool": "Tool text reads as instructions to the model",
  // L7, second round: the A2A doors' refusals and the estate's breakers, outside the register's rows.
  a2a_auth: "A2A request not signed by the caller it names",
  replay: "A2A request replayed: its nonce was seen before",
  breaker: "A circuit breaker is open on that tool or peer",
  "poisoning.jailbreak": "Tool text tries to talk the model out of its rules",
  /*
   * Strings the engine writes on a run's entries that name no register row
   * (phase2-contract.md §1, "unknown to the console"). Each gets a line in
   * plain words, so a refusal, a hold or a note never shows a bare key.
   */
  lockdown: "The estate is locked down: a call that writes or acts outside waits for a person",
  "operator.hold": "An operator asked that the next call that writes wait for a person",
  "operator.guidance": "An operator's guidance for the next step",
  "operator.model": "An operator changed the model for the next call",
  "operator.steer": "An operator steered the run",
  "gate.escalated": "A gate went unanswered and moved to the next approver",
  rate_limit: "A rate limit refused the call",
  retired: "The agent called is retired",
  side_channel: "A value another agent wrote was read",
  isolation: "Isolated execution refused the job",
  "classifier.prompt": "The screener judged what a model was about to read",
  "classifier.response": "The screener judged a model's reply",
  "classifier.sink": "The screener judged what a tool acting outside was to be sent",
  "classifier.credential": "The screener found a credential in a reply",
  "classifier.result": "The screener judged what a tool returned",
  stale: "A gate was closed because what it was asked about changed",
  "model.request": "A model call was made",
  "worker.takeover": "Another worker took the run over",
  "worker.interrupted": "The worker stopped before a call's answer was recorded",
  "worker.abandoned": "No worker carried the run on",
  not_available: "A service the run needed did not answer",
  // The tool-server registry's refusal of an approval by someone who is not a platform admin.
  role: "Only a platform admin may do this",
};

/** Model Armor's questions, as its verdict keys name them: `modelarmor.<question>.<filter>`. */
const ARMOR_QUESTION: Record<string, string> = {
  tool: "tool text",
  prompt: "what a model was about to read",
  response: "a model's reply",
  sink: "what a tool acting outside was to be sent",
  result: "what a tool returned",
};

export function controlLabel(key: string): string {
  if (Object.hasOwn(CONTROL_LABELS, key)) return CONTROL_LABELS[key];
  // Model Armor names the question and the filter that matched: `modelarmor.tool.pi_and_jailbreak`.
  const armor = /^modelarmor\.(tool|prompt|response|sink|result)(?:\.(.+))?$/.exec(key);
  if (armor) return `Model Armor flagged ${ARMOR_QUESTION[armor[1]]}${armor[2] ? ` (${armor[2].replace(/_/g, " ")})` : ""}`;
  // An operator's action the list above does not name.
  if (key.startsWith("operator.")) return `An operator's action (${key.slice("operator.".length).replace(/[._]/g, " ")})`;
  return explainControl(key).name;
}
