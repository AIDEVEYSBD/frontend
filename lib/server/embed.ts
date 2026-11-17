import path from "node:path";
import { readFile } from "node:fs/promises";
import { embedConfig, endpointHost, type EmbedConfig } from "@/lib/embed-config";
import { RUNTIME_ROOT } from "@/lib/server/paths";

/**
 * Embeddings, from any OpenAI-compatible `/embeddings` endpoint.
 *
 * One rule governs this file: the model that indexes a chunk must be the model
 * that embeds the query. A mismatch there produces confident, wrong neighbours
 * and no error at all, which is the worst failure a retrieval system has. So
 * the model name is recorded with the index and read back rather than assumed,
 * and the dimension is read from the provider's first answer rather than
 * typed in: a provider that says 1024 when the column holds 1536 is caught
 * at the re-embed, not at the first wrong search.
 *
 * Configuration (lib/embed-config.ts): EMBEDDING_ENDPOINT, EMBEDDING_API_KEY
 * (or the vault's `embedding` entry), EMBEDDING_MODEL; without them the
 * model gateway's own endpoint and key serve, as before.
 */

/** Width of the pgvector column (`chunks.embedding vector(1536)`). A provider that answers another width needs the column changed. */
export const COLUMN_DIMENSIONS = 1536;
/** @deprecated the column's width; use COLUMN_DIMENSIONS. */
export const DIMENSIONS = COLUMN_DIMENSIONS;

const VAULT = path.resolve(RUNTIME_ROOT, "workspace", "vault.json");

/** The vault's `embedding` entry, when the file is readable. The backend's encrypted vault is not read here; set EMBEDDING_API_KEY there. */
async function vaultKey(): Promise<string> {
  try {
    const vault = JSON.parse(await readFile(VAULT, "utf-8")) as { keys?: Record<string, { value?: unknown }> };
    const v = vault.keys?.embedding?.value;
    return typeof v === "string" ? v : "";
  } catch {
    return "";
  }
}

/** The configuration as the environment alone states it (synchronous; the vault is consulted by `config()`). */
export function envConfig(): EmbedConfig {
  return embedConfig(process.env);
}

export async function config(): Promise<EmbedConfig> {
  return embedConfig(process.env, await vaultKey());
}

export function embeddingModel(): string {
  return envConfig().model;
}

/** Whether the environment names an endpoint and a key. A vault-only key is seen by `embeddingStatus()`. */
export function embeddingReady(): boolean {
  const c = envConfig();
  return Boolean(c.endpoint && c.key);
}

/** The dimension the provider last answered with, per model. Null until the first call of this process. */
const seenDimensions = new Map<string, number>();

export function embeddingDimension(model = embeddingModel()): number | null {
  return seenDimensions.get(model) ?? null;
}

export interface EmbeddingStatus {
  ready: boolean;
  model: string;
  /** The provider's host, never its path or key. */
  host: string;
  endpointSource: EmbedConfig["endpointSource"];
  keySource: EmbedConfig["keySource"];
  /** The dimension this process has seen the model answer with; null until an embedding call has happened. */
  dimension: number | null;
  columnDimensions: number;
}

export async function embeddingStatus(): Promise<EmbeddingStatus> {
  const c = await config();
  return {
    ready: Boolean(c.endpoint && c.key),
    model: c.model,
    host: endpointHost(c.endpoint),
    endpointSource: c.endpointSource,
    keySource: c.keySource,
    dimension: embeddingDimension(c.model),
    columnDimensions: COLUMN_DIMENSIONS,
  };
}

/**
 * Embed a batch. Returns one vector per input, in order.
 *
 * Batches are capped because a request that carries a whole document is a
 * request that times out on the one document you most wanted indexed. The
 * dimension of the first vector back is recorded for the model, and every
 * later vector in the batch is held to it.
 */
export async function embed(inputs: string[]): Promise<number[][]> {
  const c = await config();
  if (!c.endpoint || !c.key) {
    throw new Error("no embedding endpoint configured: set EMBEDDING_ENDPOINT and EMBEDDING_API_KEY (or FOUNDRY_ENDPOINT and FOUNDRY_API_KEY)");
  }

  const out: number[][] = [];
  for (let i = 0; i < inputs.length; i += 16) {
    const batch = inputs.slice(i, i + 16);
    const res = await fetch(c.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "api-key": c.key, authorization: `Bearer ${c.key}` },
      body: JSON.stringify({ model: c.model, input: batch }),
      signal: AbortSignal.timeout(60_000),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(String(data?.error?.message ?? `embedding HTTP ${res.status}`).slice(0, 300));
    }
    const rows = (data.data ?? []) as { index: number; embedding: number[] }[];
    rows.sort((a, b) => a.index - b.index);
    for (const r of rows) {
      if (!Array.isArray(r.embedding) || !r.embedding.length) throw new Error("the embedding endpoint returned an empty vector");
      const dim = seenDimensions.get(c.model);
      if (dim === undefined) seenDimensions.set(c.model, r.embedding.length);
      else if (dim !== r.embedding.length) throw new Error(`the embedding endpoint answered ${r.embedding.length} dimensions for ${c.model} after answering ${dim}`);
      out.push(r.embedding);
    }
  }
  return out;
}

/**
 * Split text into retrievable pieces.
 *
 * Paragraph-first, because a chunk that straddles a clause boundary cites the
 * wrong clause. Long paragraphs are split on sentences rather than mid-word,
 * and an overlap carries context across the seam so a definition at the end of
 * one chunk still reaches the sentence that uses it.
 */
export function chunk(text: string, target = 1400, overlap = 160): string[] {
  const paras = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  const pieces: string[] = [];
  let buf = "";

  const flush = () => {
    const t = buf.trim();
    if (t) pieces.push(t);
    buf = "";
  };

  for (const p of paras) {
    if (p.length > target) {
      flush();
      const sentences = p.split(/(?<=[.!?])\s+/);
      let s = "";
      for (const sentence of sentences) {
        if ((s + " " + sentence).length > target && s) {
          pieces.push(s.trim());
          s = s.slice(Math.max(0, s.length - overlap)) + " " + sentence;
        } else {
          s = s ? `${s} ${sentence}` : sentence;
        }
      }
      if (s.trim()) pieces.push(s.trim());
      continue;
    }
    if ((buf + "\n\n" + p).length > target && buf) flush();
    buf = buf ? `${buf}\n\n${p}` : p;
  }
  flush();
  return pieces.filter((p) => p.length > 40);
}


/**
 * Split a document into sections before chunking it.
 *
 * A chunk that straddles a heading cites the wrong clause, and a citation that
 * names the wrong clause is worse than no citation. So headings are found
 * first and chunking happens inside each one, which is also what lets a hit
 * say "under Detection and Response" rather than "offset 4,200".
 */
export function sections(text: string): { heading: string; body: string }[] {
  const lines = text.split(/\n/);
  const out: { heading: string; body: string }[] = [];
  let buf: string[] = [];
  // Headings nest. A section's heading is its own line under its parent,
  // "LLM01 Prompt Injection › Description", so a parent that carries no
  // prose of its own (a title followed at once by a sub-heading) is not
  // lost, and a citation can name the item as well as the clause.
  const stack: string[] = [];

  const levelOf = (line: string): number => {
    const t = line.trim();
    if (t.length < 3 || t.length > 120) return 0;
    const md = /^(#{1,6})\s/.exec(t);
    if (md) return md[1].length;                                          // markdown
    if (/^\d+(\.\d+)*[.)]?\s+\S/.test(t) && t.length < 90) return 4; // 4.2 Something
    if (/^[A-Z][A-Za-z0-9 ,&'\-()/]+$/.test(t) && !t.endsWith(".") && t.split(" ").length <= 12) {
      return 4; // Title Case line with no full stop
    }
    return 0;
  };

  const heading = () => stack.filter(Boolean).slice(-2).join(" › ");

  const flush = () => {
    const body = buf.join("\n").trim();
    if (body.length > 80) out.push({ heading: heading(), body });
    buf = [];
  };

  for (const line of lines) {
    const level = levelOf(line);
    if (level) {
      flush();
      stack.length = Math.max(0, level - 1);
      stack[level - 1] = line.trim().replace(/^#{1,6}\s*/, "");
      continue;
    }
    buf.push(line);
  }
  flush();

  // A document with no discernible structure is one section, which is honest
  // rather than inventing headings that are not there.
  return out.length ? out : [{ heading: "", body: text }];
}

/**
 * Metadata for one chunk, derived rather than guessed.
 *
 * Everything here is extracted from the text by rule: identifiers a security
 * reader would search for, the kind of passage it is, and its shape. No model
 * is asked to summarise, because a summary that drifts from the passage is a
 * citation that misleads.
 */
export function metadata(body: string, heading: string): Record<string, unknown> {
  const refs = {
    cve: [...new Set(body.match(/CVE-\d{4}-\d{4,7}/gi) ?? [])].slice(0, 12),
    cwe: [...new Set(body.match(/CWE-\d{1,4}/gi) ?? [])].slice(0, 12),
    controls: [...new Set(body.match(/\b(?:AC|AU|CA|CM|CP|IA|IR|MA|MP|PE|PL|PS|RA|SA|SC|SI|SR)-\d{1,2}(?:\(\d+\))?/g) ?? [])].slice(0, 12),
    owasp: [...new Set(body.match(/\b(?:LLM|ASI|A)\d{2}\b/g) ?? [])].slice(0, 12),
    urls: [...new Set(body.match(/https?:\/\/[^\s)<>"]+/g) ?? [])].slice(0, 6),
  };
  const kind = /\|\s*-{2,}|\t.*\t/.test(body)
    ? "table"
    : /^\s*[-*\u2022]\s/m.test(body)
      ? "list"
      : "prose";
  return {
    heading,
    kind,
    words: body.split(/\s+/).length,
    refs: Object.fromEntries(Object.entries(refs).filter(([, v]) => v.length)),
  };
}
