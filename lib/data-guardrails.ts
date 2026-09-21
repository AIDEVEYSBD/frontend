/**
 * Agentic AI data security guardrails.
 *
 * The enterprise control framework this platform is assessed against: the
 * 25 guardrails the platform implements, over data governance, the database
 * and vector store, retrieval and ingestion, agent identity and memory, and
 * output and assurance. Each carries its priority, the risk it addresses, the
 * accountable owner, the evidence an assessor asks for, and the release gate
 * that must hold before production. Guardrails the platform has no control
 * for (encryption at rest, retention, incident response and the like) are
 * not listed: what the deploying organisation retains is stated on the
 * register view instead.
 *
 * `responsibility` is the useful column and is deliberately conservative:
 *
 *   platform  the platform enforces it, and names the control that does
 *   shared    the platform does part of it; the deployment completes it
 *   client    kept in the type for imports; no listed guardrail carries it
 *
 * The core principle the framework opens with is worth keeping in view while
 * reading it: the model is not a trusted enforcement point. Authentication,
 * authorisation, filtering, validation and transaction control belong to
 * deterministic services outside the model — which is the same argument this
 * platform's own control register makes.
 */

export type Priority = "Critical" | "High";
export type Responsibility = "platform" | "shared" | "client";

export interface Guardrail {
  id: string;
  domain: string;
  area: string;
  guardrail: string;
  priority: Priority;
  risk: string;
  owner: string;
  evidence: string;
  gate: string;
  sources: string[];
  /** Platform control identifiers that implement this, from the control register. */
  implementedBy: string[];
  responsibility: Responsibility;
}

export const SCOPE =
  "Data governance, PostgreSQL and vector stores, RAG ingestion and retrieval, agent identity, tools and memory, output validation, audit and release assurance.";

export const CORE_PRINCIPLE =
  "The model is not a trusted security enforcement point. Authentication, authorisation, filtering, validation and transaction controls are enforced by deterministic services outside the model.";

export const EXECUTIVE_TAKEAWAY =
  "Authenticate every actor, authorise every retrieval, validate every tool call, constrain every action, and audit every material decision.";

export const POLICY_SET = [
  "Acceptable Use & Data Classification",
  "Data Source Approval & Provenance",
  "RAG & Vector Security",
  "PostgreSQL Hardening",
  "Agent Identity & Least Agency",
  "Prompt, Context & Memory",
  "Output Validation & DLP",
  "Logging & Monitoring",
  "Security Testing & Release Gates",
  "AI Incident Response",
];

export const GUARDRAILS: Guardrail[] = [
  {
    id: "DG-03",
    domain: "Data Governance & Lifecycle",
    area: "Data minimization",
    guardrail: "Expose only the minimum fields, chunks, conversation history and user attributes required for the current task.",
    priority: "Critical",
    risk: "Over-retrieval; privacy leakage",
    owner: "AI Product Owner",
    evidence: "Field allow-lists; chunk limits; context budget",
    gate: "Context contains only necessary and authorized data",
    sources: ["https://cheatsheetseries.owasp.org/cheatsheets/RAG_Security_Cheat_Sheet.html"],
    implementedBy: ["AF-AC-02"],
    responsibility: "shared",
  },
  {
    id: "DG-05",
    domain: "Data Governance & Lifecycle",
    area: "Provenance and integrity",
    guardrail: "Record source identity, owner, classification, timestamp, checksum, version, approval status and transformation lineage for every indexed object.",
    priority: "Critical",
    risk: "Data poisoning; untrusted sources",
    owner: "Data Engineering / Security",
    evidence: "Signed manifests; hashes; lineage records",
    gate: "All indexed objects have verifiable provenance",
    sources: ["https://www.cisa.gov/resources-tools/resources/ai-data-security-best-practices-securing-data-used-train-operate-ai-systems", "https://cheatsheetseries.owasp.org/cheatsheets/RAG_Security_Cheat_Sheet.html"],
    implementedBy: ["AF-IN-03", "AF-AU-01"],
    responsibility: "shared",
  },
  {
    id: "DB-01",
    domain: "PostgreSQL & Vector Store",
    area: "Workload identities",
    guardrail: "Use separate identities for users, agents, ingestion, retrieval, administration, migrations and monitoring.",
    priority: "Critical",
    risk: "Privilege abuse; poor attribution",
    owner: "IAM / Database Team",
    evidence: "Service accounts; workload identity; role inventory",
    gate: "No shared runtime or administrator credentials",
    sources: ["https://www.postgresql.org/docs/current/database-roles.html", "https://csrc.nist.gov/pubs/sp/800/207/final"],
    implementedBy: ["AF-ID-01"],
    responsibility: "shared",
  },
  {
    id: "DB-02",
    domain: "PostgreSQL & Vector Store",
    area: "Least privilege",
    guardrail: "Runtime agents must not own objects, create roles, alter schemas, bypass RLS or access unrestricted administration. Retrieval roles should be read-only.",
    priority: "Critical",
    risk: "Excessive agency; destructive actions",
    owner: "Database Team / IAM",
    evidence: "GRANT review; role tests; privilege reports",
    gate: "Application identities have only required privileges",
    sources: ["https://www.postgresql.org/docs/current/ddl-rowsecurity.html", "https://www.postgresql.org/docs/current/database-roles.html", "https://genai.owasp.org/llmrisk/llm062025-excessive-agency/"],
    implementedBy: ["AF-AC-01", "AF-AC-02"],
    responsibility: "shared",
  },
  {
    id: "DB-03",
    domain: "PostgreSQL & Vector Store",
    area: "Credential security",
    guardrail: "Prefer short-lived credentials, workload identity or certificate authentication. Store unavoidable secrets in a vault and rotate automatically.",
    priority: "Critical",
    risk: "Credential theft",
    owner: "IAM / Platform",
    evidence: "Vault integration; rotation logs; certificate policy",
    gate: "No static credentials in code, prompts or configuration files",
    sources: ["https://www.postgresql.org/docs/current/auth-cert.html", "https://csrc.nist.gov/pubs/sp/800/207/final"],
    implementedBy: ["AF-ID-02"],
    responsibility: "shared",
  },
  {
    id: "DB-09",
    domain: "PostgreSQL & Vector Store",
    area: "Private network access",
    guardrail: "Restrict databases to approved workloads using private connectivity, firewall rules, service endpoints and workload-level policies.",
    priority: "High",
    risk: "External exposure; lateral movement",
    owner: "Cloud / Network Security",
    evidence: "Private endpoint; allow-list; exposure scan",
    gate: "Databases are not publicly reachable",
    sources: ["https://csrc.nist.gov/pubs/sp/800/207/final"],
    implementedBy: ["AF-AC-04"],
    responsibility: "platform",
  },
  {
    id: "RP-01",
    domain: "Retrieval & Ingestion",
    area: "Approved sources and connectors",
    guardrail: "Allow-list repositories, file types, connectors and content owners. Treat internal and external content as untrusted.",
    priority: "Critical",
    risk: "Supply-chain compromise; poisoning",
    owner: "Data Engineering / AppSec",
    evidence: "Connector inventory; source allow-list",
    gate: "Only approved sources can enter production indexes",
    sources: ["https://cheatsheetseries.owasp.org/cheatsheets/RAG_Security_Cheat_Sheet.html", "https://www.cisa.gov/resources-tools/resources/ai-data-security-best-practices-securing-data-used-train-operate-ai-systems"],
    implementedBy: ["AF-DP-01"],
    responsibility: "shared",
  },
  {
    id: "RP-02",
    domain: "Retrieval & Ingestion",
    area: "Content scanning",
    guardrail: "Scan documents for malware, embedded objects, scripts, macros, suspicious URLs, hidden text and adversarial instructions.",
    priority: "Critical",
    risk: "Malware; indirect prompt injection",
    owner: "Security Engineering",
    evidence: "Malware scan; content-disarm; injection detector",
    gate: "Unsafe objects are quarantined before indexing",
    sources: ["https://cheatsheetseries.owasp.org/cheatsheets/RAG_Security_Cheat_Sheet.html"],
    implementedBy: ["AF-DP-04"],
    responsibility: "shared",
  },
  {
    id: "RP-03",
    domain: "Retrieval & Ingestion",
    area: "Quarantine and approval",
    guardrail: "Quarantine new or materially changed content until automated controls and, for sensitive collections, human approval complete.",
    priority: "High",
    risk: "Poisoned knowledge base",
    owner: "Content Owner / Security",
    evidence: "Quarantine queue; approval log",
    gate: "Unapproved content cannot be retrieved in production",
    sources: ["https://cheatsheetseries.owasp.org/cheatsheets/RAG_Security_Cheat_Sheet.html", "https://atlas.mitre.org/"],
    implementedBy: ["AF-HO-03"],
    responsibility: "platform",
  },
  {
    id: "RP-05",
    domain: "Retrieval & Ingestion",
    area: "Change and revocation handling",
    guardrail: "Delete or rebuild indexed content when a source is deleted, reclassified, expired or loses approval.",
    priority: "High",
    risk: "Stale or unauthorized content",
    owner: "Data Engineering",
    evidence: "Event-driven re-index; tombstones; reconciliation",
    gate: "Source changes propagate within defined SLA",
    sources: ["https://cheatsheetseries.owasp.org/cheatsheets/RAG_Security_Cheat_Sheet.html"],
    implementedBy: ["AF-DP-05"],
    responsibility: "shared",
  },
  {
    id: "RP-06",
    domain: "Retrieval & Ingestion",
    area: "Permission-aware retrieval",
    guardrail: "Authenticate the requester, resolve current entitlements, filter eligible content before semantic search and revalidate before sending chunks to the model.",
    priority: "Critical",
    risk: "Cross-tenant leakage; over-retrieval",
    owner: "IAM / Retrieval Service Owner",
    evidence: "Pre-filter query; authorization logs; negative tests",
    gate: "Authorization occurs before and after retrieval",
    sources: ["https://cheatsheetseries.owasp.org/cheatsheets/RAG_Security_Cheat_Sheet.html", "https://csrc.nist.gov/pubs/sp/800/207/final"],
    implementedBy: ["AF-DP-05"],
    responsibility: "shared",
  },
  {
    id: "RP-07",
    domain: "Retrieval & Ingestion",
    area: "Context constraints",
    guardrail: "Apply chunk-count, token, sensitivity, classification and result-size limits. Use default-deny behavior on missing or conflicting metadata.",
    priority: "Critical",
    risk: "Context flooding; sensitive disclosure",
    owner: "AI Platform",
    evidence: "Context budget; limits; fail-closed tests",
    gate: "Oversized or policy-conflicting context is rejected",
    sources: ["https://cheatsheetseries.owasp.org/cheatsheets/RAG_Security_Cheat_Sheet.html"],
    implementedBy: ["AF-AC-02", "AF-RS-01"],
    responsibility: "shared",
  },
  {
    id: "RP-08",
    domain: "Retrieval & Ingestion",
    area: "Source attribution",
    guardrail: "Attach immutable source identifiers and provenance to retrieved content and material responses.",
    priority: "High",
    risk: "Misinformation; audit failure",
    owner: "AI Product / Data Engineering",
    evidence: "Citations; source IDs; signed metadata",
    gate: "Material responses are traceable to approved sources",
    sources: ["https://cheatsheetseries.owasp.org/cheatsheets/RAG_Security_Cheat_Sheet.html"],
    implementedBy: ["AF-AU-01"],
    responsibility: "shared",
  },
  {
    id: "RP-09",
    domain: "Retrieval & Ingestion",
    area: "Prompt-injection containment",
    guardrail: "Separate system instructions, user input, retrieved data, tool output and memory. Mark retrieved content as data, not executable instruction.",
    priority: "Critical",
    risk: "Direct and indirect prompt injection",
    owner: "AppSec / AI Engineering",
    evidence: "Prompt boundaries; policy layer; adversarial tests",
    gate: "Retrieved instructions cannot override control-plane policy",
    sources: ["https://cheatsheetseries.owasp.org/cheatsheets/RAG_Security_Cheat_Sheet.html", "https://atlas.mitre.org/"],
    implementedBy: ["AF-DP-01", "AF-DP-02"],
    responsibility: "platform",
  },
  {
    id: "RP-10",
    domain: "Retrieval & Ingestion",
    area: "Secret exclusion",
    guardrail: "Never place credentials, tokens, connection strings, private keys, privileged schemas or sensitive hidden policies into model context.",
    priority: "Critical",
    risk: "Secret exposure; hidden-context leakage",
    owner: "Security Engineering",
    evidence: "Secret scanning; context redaction",
    gate: "No secrets are exposed to the model or logs",
    sources: ["https://www.cisa.gov/resources-tools/resources/ai-data-security-best-practices-securing-data-used-train-operate-ai-systems", "https://genai.owasp.org/initiatives/agentic-security-initiative/"],
    implementedBy: ["AF-ID-02"],
    responsibility: "platform",
  },
  {
    id: "AG-01",
    domain: "Agent Identity, Tools & Memory",
    area: "Unique identity and purpose",
    guardrail: "Assign each agent a unique workload identity, approved purpose, explicit data boundary and accountable owner.",
    priority: "Critical",
    risk: "Identity abuse; shadow agents",
    owner: "IAM / AI Governance",
    evidence: "Agent registry; identity mapping; owner attestation",
    gate: "Every production agent is registered and attributable",
    sources: ["https://genai.owasp.org/initiatives/agentic-security-initiative/", "https://csrc.nist.gov/pubs/sp/800/207/final"],
    implementedBy: ["AF-ID-03", "AF-IN-03"],
    responsibility: "shared",
  },
  {
    id: "AG-02",
    domain: "Agent Identity, Tools & Memory",
    area: "Tool allow-listing",
    guardrail: "Expose narrow business functions rather than unrestricted SQL, shell, HTTP, file or API tools. Remove unused tools.",
    priority: "Critical",
    risk: "Tool misuse; code execution",
    owner: "AI Engineering / AppSec",
    evidence: "Tool catalog; allow-list; schema validation",
    gate: "Only approved, narrowly scoped tools are callable",
    sources: ["https://genai.owasp.org/llmrisk/llm062025-excessive-agency/", "https://genai.owasp.org/initiatives/agentic-security-initiative/"],
    implementedBy: ["AF-AC-01", "AF-AC-03", "AF-IN-04"],
    responsibility: "platform",
  },
  {
    id: "AG-03",
    domain: "Agent Identity, Tools & Memory",
    area: "Least agency",
    guardrail: "Constrain functionality, permissions and autonomy. Define maximum task duration, steps, spend, records affected and data volume.",
    priority: "Critical",
    risk: "Excessive agency; denial of wallet",
    owner: "AI Product / Security",
    evidence: "Runtime policy; quotas; loop controls",
    gate: "Limits prevent uncontrolled execution and consumption",
    sources: ["https://genai.owasp.org/llmrisk/llm062025-excessive-agency/"],
    implementedBy: ["AF-AC-02", "AF-RS-01", "AF-RS-02"],
    responsibility: "shared",
  },
  {
    id: "AG-04",
    domain: "Agent Identity, Tools & Memory",
    area: "Human approval",
    guardrail: "Require approval for sensitive disclosure, external communication, entitlement changes, material writes/deletes, high-impact decisions and bulk exports.",
    priority: "Critical",
    risk: "Irreversible or high-impact action",
    owner: "Business Owner / Risk",
    evidence: "Approval workflow; segregation of duties",
    gate: "High-risk actions cannot execute autonomously",
    sources: ["https://genai.owasp.org/llmrisk/llm062025-excessive-agency/"],
    implementedBy: ["AF-HO-01", "AF-DP-02"],
    responsibility: "shared",
  },
  {
    id: "AG-06",
    domain: "Agent Identity, Tools & Memory",
    area: "Memory isolation",
    guardrail: "Separate short-term context from persistent memory; bind memory to tenant and subject; validate before reuse.",
    priority: "Critical",
    risk: "Cross-context leakage; memory poisoning",
    owner: "AI Platform / Privacy",
    evidence: "Tenant keys; memory ACLs; validation pipeline",
    gate: "One user or tenant cannot access another’s memory",
    sources: ["https://genai.owasp.org/initiatives/agentic-security-initiative/"],
    implementedBy: ["AF-DP-03"],
    responsibility: "platform",
  },
  {
    id: "AG-08",
    domain: "Agent Identity, Tools & Memory",
    area: "Inter-agent trust",
    guardrail: "Treat agent-to-agent messages, shared memory and tool responses as untrusted; authenticate peers and validate message schemas.",
    priority: "High",
    risk: "Insecure inter-agent communication",
    owner: "AI Platform / AppSec",
    evidence: "mTLS or signed messages; schema validation",
    gate: "Peer identity and message integrity are verified",
    sources: ["https://genai.owasp.org/initiatives/agentic-security-initiative/"],
    implementedBy: ["AF-AU-03", "AF-ID-03"],
    responsibility: "platform",
  },
  {
    id: "OM-02",
    domain: "Output, Monitoring & Assurance",
    area: "Deterministic output validation",
    guardrail: "Validate SQL, API parameters, file paths, URLs and structured output before execution by downstream systems.",
    priority: "Critical",
    risk: "Injection; unsafe execution",
    owner: "AppSec / Application Owner",
    evidence: "Schema validation; parameterized interfaces; allow-lists",
    gate: "Free-text model output never executes directly",
    sources: ["https://cheatsheetseries.owasp.org/cheatsheets/RAG_Security_Cheat_Sheet.html", "https://genai.owasp.org/llmrisk/llm062025-excessive-agency/"],
    implementedBy: ["AF-IN-01"],
    responsibility: "platform",
  },
  {
    id: "OM-03",
    domain: "Output, Monitoring & Assurance",
    area: "Tamper-resistant audit logging",
    guardrail: "Log identity, agent/model/policy version, source IDs, authorization decision, tools, affected records, approvals and policy actions, while redacting secrets.",
    priority: "High",
    risk: "Repudiation; weak forensics",
    owner: "SOC / Platform",
    evidence: "Central audit trail; access controls; retention",
    gate: "Material activity is reconstructable without logging excessive data",
    sources: ["https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf", "https://cheatsheetseries.owasp.org/cheatsheets/RAG_Security_Cheat_Sheet.html"],
    implementedBy: ["AF-AU-01", "AF-AU-02", "AF-HO-02"],
    responsibility: "shared",
  },
  {
    id: "OM-05",
    domain: "Output, Monitoring & Assurance",
    area: "Security testing and release gates",
    guardrail: "Perform threat modeling, authorization testing, prompt-injection tests, poisoning tests, agent red teaming and regression testing before release and material change.",
    priority: "Critical",
    risk: "Undetected design weakness",
    owner: "Product Security / AI Governance",
    evidence: "Test evidence; threat model; red-team report",
    gate: "No critical findings remain open at production release",
    sources: ["https://atlas.mitre.org/", "https://genai.owasp.org/initiatives/agentic-security-initiative/", "https://nvlpubs.nist.gov/nistpubs/ai/NIST.AI.600-1.pdf"],
    implementedBy: ["AF-IN-02"],
    responsibility: "platform",
  },
  {
    id: "OM-06",
    domain: "Output, Monitoring & Assurance",
    area: "Resilience and shutdown",
    guardrail: "Implement rate limits, loop controls, budget limits, circuit breakers, rollback, agent revocation and an emergency kill switch.",
    priority: "Critical",
    risk: "Cascading failure; unbounded consumption",
    owner: "Platform / SRE",
    evidence: "Runbooks; kill-switch test; chaos testing",
    gate: "Agent can be contained and stopped promptly",
    sources: ["https://genai.owasp.org/initiatives/agentic-security-initiative/"],
    implementedBy: ["AF-RS-01", "AF-RS-02", "AF-RS-03"],
    responsibility: "shared",
  },
];

export const DOMAINS = [...new Set(GUARDRAILS.map((g) => g.domain))];
export const GUARDRAIL_BY_ID = new Map(GUARDRAILS.map((g) => [g.id, g]));

/** Framework controls a given platform control contributes to. */
export function guardrailsFor(controlId: string): Guardrail[] {
  return GUARDRAILS.filter((g) => g.implementedBy.includes(controlId));
}

