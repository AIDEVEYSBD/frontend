/**
 * The shapes of the answers the platform service gives that more than one
 * console file reads. The service is the only place these addresses are
 * answered; the console forwards to it and reads what comes back.
 */

/** One model in `GET /api/providers/vertex`. */
export interface VertexModel { id: string; name: string; label: string; version?: string; stage?: string }

/** A publisher's models, or what the project itself has deployed or registered. */
export interface VertexGroup { id: string; label: string; kind: "publisher" | "deployed" | "registered"; models: VertexModel[]; /** Why this group could not be read, when it could not. */ error?: string }

/** `GET /api/providers/vertex`: what the platform's own Google identity can see on Vertex AI. The same shape with or without a connection. */
export interface VertexAnswer {
  connected: boolean;
  /** How the service holds its Google identity: the workload's own, a credentials file, or a token handed in. */
  source: "metadata" | "file" | "token" | null;
  account: string;
  project: string;
  region: string;
  groups: VertexGroup[];
  total: number;
  checkedAt: string;
}

/** `GET /api/links`: the address of each workload's own console, by workload id (lib/api/pending.ts WORKLOADS). One not named is not live. */
export interface ConsoleLinks { workloads: Record<string, string> }
