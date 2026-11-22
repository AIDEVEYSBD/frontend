/**
 * Model endpoints: where a model id is actually served from.
 *
 * The endpoints a deployment can send a model call to are set when the
 * platform is deployed: Vertex AI, reached with the platform's own Google
 * identity, and any OpenAI-compatible endpoint the deployment names. The
 * service lists them in `GET /api/config`; the console shows them and does
 * not add, change or remove one. Every offered model names the endpoint it
 * is called on.
 */

export type ProviderKind = "vertex" | "openai";

export interface Provider {
  id: string;
  label: string;
  kind: ProviderKind;
  /** The endpoint's base address. It carries no credential. */
  endpoint: string;
  /** Set by the deployment, not from the console. */
  builtin?: boolean;
  /** Served on hardware this deployment already pays for: token prices are zero, the hour has a cost. No endpoint answers this yet; the Costs page reads it. */
  local?: boolean;
  /** Fully loaded hourly cost of the hardware behind a local endpoint, for the Costs page's calculator. */
  hourly_usd?: number;
  /** Whether the endpoint answered the platform's last call to it (made within the last minute of the read). Absent on an older platform. */
  connected?: boolean;
  /** When that call was made. */
  checked_at?: string | null;
  /** Why the endpoint did not answer, when it did not. */
  error?: string | null;
  /** Where the endpoint's model list came from: the endpoint's own list, or a setting that names the models (`MODEL_NAMES`). */
  listed_from?: string | null;
}

const KIND_LABEL: Record<ProviderKind, string> = {
  vertex: "Google Vertex AI",
  openai: "OpenAI-compatible",
};

/** How a kind of endpoint is named on screen; a kind this console does not know is shown as it was answered. */
export function kindOf(kind: string): { label: string } {
  return { label: KIND_LABEL[kind as ProviderKind] ?? kind };
}

