/**
 * Model providers: where a model id is actually served from.
 *
 * A deployment can offer models from more than one place — the Foundry
 * gateway, a Vertex or Bedrock OpenAI-compatible endpoint, a vLLM or Ollama
 * box in the client's own rack. A provider is an endpoint, a way of
 * authenticating to it, and whether it is local (metered by the hour, not
 * by the token). Every offered model names its provider; the runtime routes
 * each call to that provider's endpoint with that provider's key.
 */

export type ProviderKind = "foundry" | "openai" | "vllm" | "ollama" | "lmstudio" | "vertex" | "bedrock" | "anthropic" | "custom";

export interface Provider {
  id: string;
  label: string;
  kind: ProviderKind;
  /** The chat-completions URL the runtime posts to, e.g. http://gpu-1:8000/v1/chat/completions. */
  endpoint: string;
  /** Name of the vault key holding the credential; empty for unauthenticated local servers. */
  key_ref?: string;
  /** Served on hardware this deployment already pays for: token prices are zero, the hour has a cost. */
  local?: boolean;
  /** Fully loaded hourly cost of the hardware behind a local endpoint, for the calculator. */
  hourly_usd?: number;
  /** Where the runtime discovers what the endpoint serves. Derived from kind when blank. */
  models_url?: string;
}

export const KINDS: { value: ProviderKind; label: string; hint: string; local: boolean; example: string }[] = [
  { value: "foundry", label: "Azure AI Foundry", hint: "Deployments on an Azure AI resource; api-key header.", local: false, example: "https://<resource>.openai.azure.com/openai/v1/chat/completions" },
  { value: "vertex", label: "Google Vertex AI", hint: "The OpenAI-compatible endpoint of a Vertex project; bearer token.", local: false, example: "https://<region>-aiplatform.googleapis.com/v1/projects/<p>/locations/<region>/endpoints/openapi/chat/completions" },
  { value: "bedrock", label: "Amazon Bedrock", hint: "Bedrock's OpenAI-compatible endpoint; bearer API key.", local: false, example: "https://bedrock-runtime.<region>.amazonaws.com/openai/v1/chat/completions" },
  { value: "anthropic", label: "Anthropic", hint: "The OpenAI-compatible endpoint; bearer API key.", local: false, example: "https://api.anthropic.com/v1/chat/completions" },
  { value: "openai", label: "OpenAI-compatible", hint: "Any server speaking the chat-completions API; bearer token.", local: false, example: "https://<host>/v1/chat/completions" },
  { value: "vllm", label: "vLLM (local)", hint: "A vLLM server on your own hardware; usually no key.", local: true, example: "http://<gpu-host>:8000/v1/chat/completions" },
  { value: "ollama", label: "Ollama (local)", hint: "Ollama's OpenAI-compatible endpoint; no key.", local: true, example: "http://<host>:11434/v1/chat/completions" },
  { value: "lmstudio", label: "LM Studio (local)", hint: "LM Studio's local server; no key.", local: true, example: "http://<host>:1234/v1/chat/completions" },
  { value: "custom", label: "Custom", hint: "Anything else that answers chat completions.", local: false, example: "https://<host>/chat/completions" },
];

export function kindOf(kind: string) {
  return KINDS.find((k) => k.value === kind) ?? KINDS[KINDS.length - 1];
}

/** The base ("…/v1") of a chat-completions endpoint, for model discovery. */
export function baseOf(endpoint: string): string {
  return endpoint.replace(/\/(chat\/completions|completions|responses)\/?$/, "").replace(/\/$/, "");
}

/** Where a provider lists what it serves. */
export function modelsUrl(p: Pick<Provider, "kind" | "endpoint" | "models_url">): string {
  if (p.models_url) return p.models_url;
  const base = baseOf(p.endpoint);
  if (p.kind === "foundry") return `${p.endpoint.split("/openai/")[0]}/openai/deployments?api-version=2023-03-15-preview`;
  if (p.kind === "ollama") return `${base.replace(/\/v1$/, "")}/api/tags`;
  return `${base}/models`;
}

/** The built-in provider every deployment starts with: the Foundry gateway from the environment. */
export const FOUNDRY_ID = "foundry";
