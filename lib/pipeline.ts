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
      detail: "The sources a person added to this corpus, each with its licence, which governs whether its text may be held at all.",
    },
    {
      id: "fetch",
      label: "Fetch",
      detail: "A person asks for a source to be fetched from its address. An index page is followed to the pages under it, and the result is normalised to one document.",
    },
    {
      id: "sections",
      label: "Documents to sections",
      detail: "Headings are found before chunking, so a citation can name the section it came from and not a byte offset.",
    },
    {
      id: "chunks",
      label: "Sections to chunks",
      detail: "Each section is split by paragraph, with an overlap, so a definition still reaches the sentence that uses it.",
    },
    {
      id: "metadata",
      label: "Metadata per chunk",
      detail: "Identifiers a security reader searches for (CVE, CWE, control references) are extracted by rule, not summarised by a model.",
    },
    {
      id: "lexical",
      label: "Lexical index",
      detail: "A term index built at ingestion: the keyword half of hybrid retrieval.",
    },
    {
      id: "hitl",
      label: "Admission by a person",
      detail: "A fetched document waits, staged, until a person admits or refuses it. The admission records who decided and why.",
    },
    {
      id: "embedding",
      label: "Embedding model",
      detail: "On admission each chunk is embedded. The same model embeds a question, because a mismatch between the two is silent.",
    },
    {
      id: "pgvector",
      label: "Vector index",
      detail: "The admitted chunks with their embeddings, one corpus per namespace. Only what is here can be retrieved.",
    },
  ],
};

/** What happens when an agent asks a question. */
export const RETRIEVAL_STAGES: Stage[] = [
  {
    id: "hybrid",
    label: "Hybrid search",
    detail: "Dense similarity finds passages that mean the same thing; lexical ranking finds those that say the same words. The two rankings are fused by reciprocal rank.",
  },
  {
    id: "adjacent",
    label: "Top-k and adjacent chunks",
    detail: "The chunks either side of a hit come with it as context, because a clause is rarely self-contained.",
  },
  {
    id: "rerank",
    label: "Reranking",
    detail: "A second pass scores each candidate against the question directly.",
  },
  {
    id: "guardrails",
    label: "Exclusions",
    detail: "A source removed from the register and a document nobody admitted are left out in the query itself.",
  },
];
