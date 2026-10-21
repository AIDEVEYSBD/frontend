/**
 * Where embeddings come from, read from configuration.
 *
 * Provider-neutral: any OpenAI-compatible `/embeddings` endpoint serves,
 * named by EMBEDDING_ENDPOINT. Without one, the endpoint is derived from the
 * model gateway's FOUNDRY_ENDPOINT as before, so a deployment that set only
 * Foundry keeps working. The key is EMBEDDING_API_KEY, else the vault's
 * `embedding` entry, else the gateway's own key. The model is EMBEDDING_MODEL.
 * Pure over the environment so a test covers every shape without touching
 * the process.
 */

export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

export interface EmbedConfig {
  /** The full URL a POST goes to, ending in /embeddings; empty when nothing is configured. */
  endpoint: string;
  key: string;
  model: string;
  /** Where the endpoint came from. */
  endpointSource: "embedding" | "foundry" | "none";
  keySource: "embedding" | "vault" | "foundry" | "none";
}

export type Env = Record<string, string | undefined>;

/** Normalise an endpoint a person typed: a base, a chat URL or the embeddings URL itself all land on /embeddings. */
export function embeddingsUrl(raw: string): string {
  let u = raw.trim().replace(/\/+$/, "");
  if (!u) return "";
  if (/\/embeddings$/i.test(u)) return u;
  u = u.replace(/\/chat\/completions$/i, "").replace(/\/completions$/i, "").replace(/\/responses$/i, "");
  return `${u}/embeddings`;
}

export function embedConfig(env: Env, vaultKey = ""): EmbedConfig {
  const own = (env.EMBEDDING_ENDPOINT ?? "").trim();
  const foundry = (env.FOUNDRY_ENDPOINT ?? "").trim();
  const endpoint = own ? embeddingsUrl(own) : foundry ? embeddingsUrl(foundry) : "";
  const endpointSource: EmbedConfig["endpointSource"] = own ? "embedding" : foundry ? "foundry" : "none";

  const ownKey = (env.EMBEDDING_API_KEY ?? "").trim();
  const foundryKey = (env.FOUNDRY_API_KEY ?? env.AZURE_AI_KEY ?? "").trim();
  const key = ownKey || vaultKey || foundryKey;
  const keySource: EmbedConfig["keySource"] = ownKey ? "embedding" : vaultKey ? "vault" : foundryKey ? "foundry" : "none";

  const model = (env.EMBEDDING_MODEL ?? "").trim() || DEFAULT_EMBEDDING_MODEL;
  return { endpoint, key, model, endpointSource, keySource };
}

/** The host a status line may name; never the key, never the path's secrets. */
export function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "";
  }
}
