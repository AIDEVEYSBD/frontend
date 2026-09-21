import path from "node:path";
import { readFile } from "node:fs/promises";

/**
 * The model gateway's own credentials, resolved the way every other route
 * resolves them: the vault's `foundry` key first, the environment second.
 * The endpoint is the resource's chat-completions URL; sibling OpenAI paths
 * are derived from it, the same way the embedder derives its own.
 */

const VAULT = path.resolve(process.cwd(), "..", "runtime", "workspace", "vault.json");
const CONFIG = path.resolve(process.cwd(), "..", "runtime", "workspace", "config.json");

export interface Foundry {
  /** .../openai/v1 */
  base: string;
  key: string;
}

export async function foundry(): Promise<Foundry | null> {
  const chat = (process.env.FOUNDRY_ENDPOINT ?? "").replace(/\/+$/, "");
  if (!chat) return null;
  let key = process.env.FOUNDRY_API_KEY ?? process.env.AZURE_AI_KEY ?? "";
  try {
    const vault = JSON.parse(await readFile(VAULT, "utf-8"));
    const v = vault?.keys?.foundry?.value;
    if (typeof v === "string" && v) key = v;
  } catch {
    /* no vault yet */
  }
  if (!key) return null;
  return { base: chat.replace(/\/chat\/completions$/, "").replace(/\/completions$/, ""), key };
}

/** The deployment's default model, for a caller that names none. */
export async function defaultModel(): Promise<string> {
  try {
    const cfg = JSON.parse(await readFile(CONFIG, "utf-8"));
    return String(cfg?.default_model ?? "");
  } catch {
    return "";
  }
}
