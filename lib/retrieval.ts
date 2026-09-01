/**
 * Retrieval source definitions, as the builder edits them.
 *
 * Mirrors `runtime/agentfactory/retrieval.py` — same kinds, same fields, same
 * meanings. The whole structure lands in the spec under the retrieval tool's
 * `config`, which is why editing a source changes the system's digest: two
 * agents with different sources are different agents.
 */

export type SourceKind = "folder" | "documents" | "vector" | "tavily" | "images" | "tool";

export interface RetrievalSource {
  kind: SourceKind;
  name: string;
  enabled?: boolean;
  /** Cross-source weight applied after within-source normalisation. */
  weight?: number;
  /** Builder layout: the agent node this connector card hangs beneath. The
      runtime ignores it — it filters config to the fields each source owns. */
  attached_to?: string;

  // folder · documents · images
  root?: string;

  // vector
  url?: string;
  collection?: string;
  api_key?: string;
  embed_url?: string;
  embed_model?: string;
  floor?: number;

  // tavily
  depth?: "basic" | "advanced";
  include_domains?: string[];
  exclude_domains?: string[];

  // tool
  method?: "POST" | "GET";
  headers?: Record<string, string>;
  query_field?: string;
  results_path?: string;
  mapping?: Record<string, string>;
}

export const SOURCE_META: Record<
  SourceKind,
  { label: string; blurb: string; needsKey?: string }
> = {
  folder: {
    label: "Folder",
    blurb: "Plain files on the deployment's disk, keyword-ranked. No index, no service, always works.",
  },
  documents: {
    label: "Documents",
    blurb: "PDF, DOCX and HTML, unpacked to text first. An unreadable file is reported, never silently empty.",
  },
  vector: {
    label: "Vector index",
    blurb: "Qdrant, Chroma or anything with a compatible search endpoint, similarity-ranked.",
  },
  tavily: {
    label: "Web (Tavily)",
    blurb: "The live web, returned as extracted content rather than links. The most hostile source, and the most used.",
    needsKey: "tavily",
  },
  images: {
    label: "Images",
    blurb: "Pictures, found via sidecar text or filename — never a caption invented at search time. Fetch returns the actual image.",
  },
  tool: {
    label: "External tool",
    blurb: "Somebody else's search API: map three field names and it ranks alongside everything else.",
  },
};

/** A new source of a kind, with the defaults the runtime documents. */
export function newSource(kind: SourceKind, taken: Set<string>): RetrievalSource {
  let name = kind === "tavily" ? "web" : kind;
  let i = 2;
  while (taken.has(name)) name = `${kind}-${i++}`;

  switch (kind) {
    case "folder":
      return { kind, name, root: "documents", weight: 1 };
    case "documents":
      return { kind, name, root: "documents", weight: 1 };
    case "images":
      return { kind, name, root: "images", weight: 1 };
    case "vector":
      return { kind, name, url: "", collection: "", api_key: "${secret:vector-db}", weight: 1 };
    case "tavily":
      return { kind, name, depth: "basic", api_key: "${secret:tavily}", weight: 1 };
    case "tool":
      return {
        kind,
        name,
        url: "",
        method: "POST",
        query_field: "query",
        results_path: "results",
        headers: { authorization: "Bearer ${secret:my-service}" },
        weight: 1,
      };
  }
}

/** The vault keys a source list depends on — `${secret:x}` wherever it appears. */
export function keysNeeded(sources: RetrievalSource[]): string[] {
  const out = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      for (const m of v.matchAll(/\$\{secret:([a-zA-Z0-9_-]+)\}/g)) out.add(m[1]);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  sources.filter((s) => s.enabled !== false).forEach(walk);
  return [...out];
}
