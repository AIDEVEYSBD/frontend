import path from "node:path";
import { readFile } from "node:fs/promises";
import { redactText, redactValue } from "@/lib/redact";
import { RUNTIME_ROOT } from "@/lib/server/paths";

/**
 * The live secrets this process holds, for redaction on the way out.
 *
 * The same overlay the runtime's vault reads (FOUNDRY_API_KEY, every
 * `*_API_KEY`, `*_TOKEN`, `*_SECRET` in the environment) plus the vault
 * file's values when the console can read it. Read once per process and
 * refreshed every few minutes: a key rotated in the vault is masked on the
 * next read, and a route never pays a file read per journal.
 */

const VAULT = path.resolve(RUNTIME_ROOT, "workspace", "vault.json");
const SECRET_ENV = /(_API_KEY|_TOKEN|_SECRET|_PASSWORD|^AUTH_SECRET$|^RUNTIME_KEY$|^VAULT_KEY$)$/;

let cache: { at: number; values: string[] } | null = null;

export async function liveSecrets(maxAgeMs = 180_000): Promise<string[]> {
  if (cache && Date.now() - cache.at < maxAgeMs) return cache.values;
  const values = new Set<string>();
  for (const [k, v] of Object.entries(process.env)) {
    if (SECRET_ENV.test(k) && v && v.length >= 8) values.add(v);
  }
  try {
    const vault = JSON.parse(await readFile(VAULT, "utf-8")) as { keys?: Record<string, { value?: unknown }> };
    for (const k of Object.values(vault.keys ?? {})) {
      if (typeof k?.value === "string" && k.value.length >= 8) values.add(k.value);
    }
  } catch {
    /* no vault file on this deployment; the environment overlay still applies */
  }
  cache = { at: Date.now(), values: [...values] };
  return cache.values;
}

export async function redact(text: string): Promise<string> {
  return redactText(text, await liveSecrets());
}

export async function redactDeep<T>(value: T): Promise<T> {
  return redactValue(value, await liveSecrets());
}
