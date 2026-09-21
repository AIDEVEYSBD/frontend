/**
 * Context and RAG engineering, as an architecture.
 *
 * This file is the solution design: the two pipelines that put context in
 * front of an agent, the stages each passes through, and which of them this
 * deployment runs today. It is drawn on the Knowledge page as a diagram,
 * because an architecture is best argued as a picture and worst argued as
 * prose.
 *
 * `state` is the honest part and is never decoration:
 *
 *   live     running in this deployment; the page shows measured figures
 *   design   specified, not yet built here
 *
 * A stage marked live is one somebody can test in the room. A stage marked
 * design is a commitment about where this goes, which is a legitimate thing
 * for an architecture to say and an illegitimate thing for a dashboard to
 * imply. Keeping the two apart is what lets the diagram be shown to a client
 * without a caveat.
 */

export type StageState = "live" | "design";

export interface Stage {
  id: string;
  label: string;
  detail: string;
  state: StageState;
  /** Salient-feature numbers from the architecture, for cross-reference. */
  features?: number[];
}

export interface Lane {
  id: string;
  name: string;
  purpose: string;
  stages: Stage[];
}

/** The telemetry lane: security tooling, parsed into structured facts. */
export const TELEMETRY_LANE: Lane = {
  id: "telemetry",
  name: "Tools and telemetry",
  purpose:
    "Findings and posture from the security estate, landed as structured records an agent can query rather than prose it has to read.",
  stages: [
    {
      id: "connectors",
      label: "Source connectors",
      detail: "Scheduled pulls from each tool's API, with the credential held in the vault and never in a workflow.",
      state: "design",
      features: [1],
    },
    {
      id: "parsers",
      label: "Predefined parsers",
      detail:
        "Python parsers per tool, so a Wiz finding and an MDE alert arrive with the same shape. Written once, versioned with the platform.",
      state: "design",
      features: [4],
    },
    {
      id: "bronze",
      label: "Bronze",
      detail: "Raw payloads in a folder structure mirroring the source schema, with archival policy attached.",
      state: "design",
      features: [3, 6],
    },
    {
      id: "silver",
      label: "Silver",
      detail: "Transformed to a common columnar structure, still one row per source record.",
      state: "design",
      features: [3, 6],
    },
    {
      id: "gold",
      label: "Gold · managed Postgres",
      detail:
        "Fact and dimension tables, schema separation and row level security. This is what an agent queries when it asks about the estate.",
      state: "design",
      features: [3, 6],
    },
  ],
};

/** The knowledge lane: authority documents, made retrievable. */
export const KNOWLEDGE_LANE: Lane = {
  id: "knowledge",
  name: "Knowledge sources",
  purpose:
    "Standards, regulation and the client's own policy, curated and made retrievable so an answer can cite an authority rather than a recollection.",
  stages: [
    {
      id: "curated",
      label: "Curated register",
      detail:
        "Internal and external sources chosen for the agents being deployed, each carrying its licence, which governs whether its text may be held at all.",
      state: "live",
      features: [1],
    },
    {
      id: "fetch",
      label: "Periodic fetch",
      detail: "A scheduled pull per source on its own cadence. On demand today; the schedule is the next piece.",
      state: "design",
      features: [2],
    },
    {
      id: "sections",
      label: "Documents to sections",
      detail:
        "Headings are found before chunking, so a citation can name the clause it came from rather than a byte offset.",
      state: "live",
      features: [2],
    },
    {
      id: "chunks",
      label: "Sections to chunks",
      detail: "Paragraph-first splitting with overlap, so a definition still reaches the sentence that uses it.",
      state: "live",
      features: [2],
    },
    {
      id: "metadata",
      label: "Metadata per chunk",
      detail:
        "Identifiers a security reader searches for — CVE, CWE, control references — extracted by rule rather than summarised by a model.",
      state: "live",
      features: [2],
    },
    {
      id: "lexical",
      label: "Lexical index",
      detail: "A term index built at ingestion, which is the keyword half of hybrid retrieval.",
      state: "live",
      features: [2],
    },
    {
      id: "embedding",
      label: "Embedding model",
      detail: "The same model indexes a chunk and embeds a query; a mismatch there is silent and ruinous.",
      state: "live",
      features: [2],
    },
    {
      id: "hitl",
      label: "Human in the loop",
      detail:
        "Nothing becomes retrievable until a person admits it, and the admission records who and why. Optional per source by design.",
      state: "live",
      features: [5],
    },
    {
      id: "pgvector",
      label: "pgvector",
      detail:
        "The index itself. Schema separation, row level security and encryption in transit and at rest are the deployment's to configure.",
      state: "live",
      features: [3, 6],
    },
  ],
};

/** What happens when an agent asks a question. */
export const RETRIEVAL_STAGES: Stage[] = [
  {
    id: "hybrid",
    label: "Hybrid search",
    detail:
      "Dense similarity finds passages that mean the same thing; lexical ranking finds those that say the same words. Fused by reciprocal rank.",
    state: "live",
    features: [2],
  },
  {
    id: "adjacent",
    label: "Top-k and adjacent chunks",
    detail: "The chunks either side of a hit come with it as context, because a clause is rarely self-contained.",
    state: "live",
    features: [2],
  },
  {
    id: "rerank",
    label: "Reranking",
    detail: "A second pass scores each candidate against the question directly, which the first two rankers never ask.",
    state: "live",
    features: [2],
  },
  {
    id: "guardrails",
    label: "Data security guardrails",
    detail:
      "Disabled sources and unadmitted documents are excluded in the query. Identity-scoped access and row level security are the deployment's to configure.",
    state: "design",
    features: [3],
  },
];

/** The salient features, numbered as the architecture numbers them. */
export const FEATURES: { n: number; text: string; state: StageState }[] = [
  { n: 1, text: "Curated list of internal and external sources, chosen for the agents planned for deployment", state: "live" },
  { n: 2, text: "Vector ingestion pipeline with an agentic retrieval system", state: "live" },
  { n: 3, text: "Data security guardrails against access misuse, with policy-driven data access", state: "design" },
  { n: 4, text: "Predefined data parsers for known security tools", state: "design" },
  { n: 5, text: "Optional human in the loop to validate the accuracy of vector ingestion", state: "live" },
  { n: 6, text: "Hardened infrastructure as code templates to provision the target cloud environment", state: "design" },
];

/** Security tooling the telemetry lane is designed around. */
export const TELEMETRY_SOURCES: { name: string; kind: string; contributes: string }[] = [
  { name: "Wiz", kind: "Cloud security", contributes: "Cloud findings, misconfiguration and attack paths" },
  { name: "Microsoft Defender", kind: "Endpoint", contributes: "Endpoint alerts, device posture and vulnerabilities" },
  { name: "HackerOne", kind: "Bug bounty", contributes: "Externally reported findings and their triage state" },
  { name: "BitSight", kind: "Third-party risk", contributes: "Vendor security ratings and observed issues" },
  { name: "Proofpoint", kind: "Email security", contributes: "Message threats, campaigns and user reporting" },
  { name: "Akamai", kind: "Edge and WAF", contributes: "Edge events, blocked requests and bot traffic" },
  { name: "Invicti", kind: "Application scanning", contributes: "Web application findings with proof" },
  { name: "DigiCert", kind: "Certificates", contributes: "Certificate inventory and expiry" },
  { name: "BeyondTrust", kind: "Privileged access", contributes: "Privileged sessions and entitlements" },
  { name: "CyberArk", kind: "Secrets and PAM", contributes: "Vaulted credentials and session records" },
  { name: "Brinqa", kind: "Risk aggregation", contributes: "Consolidated findings and risk scoring" },
  { name: "Qualys", kind: "Vulnerability scanning", contributes: "Host and application vulnerability detections" },
];
