/**
 * The stages a source passes through, as an explanation.
 *
 * This file describes how the knowledge pipeline is built: what happens to a
 * source between its address and an agent's question. The Knowledge page
 * draws it so a reader knows what "fetched", "staged", "admitted" and
 * "indexed" mean there. It is a description of the stages and nothing more:
 * it says nothing about what this deployment is running, has fetched or
 * holds. Those are read from the index and shown beside it, never here.
 */

export interface Stage {
  id: string;
  label: string;
  detail: string;
}

export interface Lane {
  id: string;
  name: string;
  purpose: string;
  stages: Stage[];
}

/** The knowledge lane: documents, made retrievable. */
export const KNOWLEDGE_LANE: Lane = {
  id: "knowledge",
  name: "Knowledge sources",
  purpose: "Standards, regulation and an organisation's own documents, made retrievable so an answer can cite where it came from.",
  stages: [
    {
      id: "curated",
      label: "Register",
      detail: "Sources added to this corpus, each with its licence.",
    },
    {
      id: "fetch",
      label: "Fetch",
      detail: "Fetched from its address and normalised to one document.",
    },
    {
      id: "sections",
      label: "Documents to sections",
      detail: "Headings found first, so a citation names its section.",
    },
    {
      id: "chunks",
      label: "Sections to chunks",
      detail: "Each section split by paragraph, with an overlap.",
    },
    {
      id: "metadata",
      label: "Metadata per chunk",
      detail: "CVE, CWE and control references, extracted by rule.",
    },
    {
      id: "lexical",
      label: "Lexical index",
      detail: "A term index: the keyword half of hybrid retrieval.",
    },
    {
      id: "hitl",
      label: "Admission by a person",
      detail: "Waits, staged, until a person admits or refuses it.",
    },
    {
      id: "embedding",
      label: "Embedding model",
      detail: "Each admitted chunk is embedded with the question's model.",
    },
    {
      id: "pgvector",
      label: "Vector index",
      detail: "Admitted chunks and embeddings; only these can be retrieved.",
    },
  ],
};

/** What happens when an agent asks a question. */
export const RETRIEVAL_STAGES: Stage[] = [
  {
    id: "hybrid",
    label: "Hybrid search",
    detail: "Dense and lexical rankings, fused by reciprocal rank.",
  },
  {
    id: "adjacent",
    label: "Top-k and adjacent chunks",
    detail: "Neighbouring chunks come with each hit as context.",
  },
  {
    id: "rerank",
    label: "Reranking",
    detail: "A second pass scores each candidate against the question directly.",
  },
  {
    id: "guardrails",
    label: "Exclusions",
    detail: "Removed sources and unadmitted documents are left out.",
  },
];
