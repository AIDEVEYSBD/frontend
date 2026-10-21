/**
 * Redaction, the console's half.
 *
 * The runtime masks every live secret on its way into the journal
 * (runtime/agentfactory/vault.py `redact`): a value the vault holds is
 * replaced with MASK wherever it appears. This module applies the same rule
 * to anything the console reads back out, for the deployments where the
 * journal was written by a door that had no vault (the gateway, the SDK
 * ingest) and as a second line everywhere else. Two layers:
 *
 *   1. the live values this process knows (the environment's keys and the
 *      vault's), replaced exactly, as the runtime does;
 *   2. the shapes a secret takes (factory keys, bearer tokens, JWTs,
 *      `api_key=…` pairs), masked even when the value is not one we hold,
 *      because an excerpt quoted from a prompt may carry somebody else's.
 *
 * The mask is the runtime's, so a reader greps for one string.
 */

export const MASK = "••••redacted••••";

/** Shapes a secret takes in text. Each replaces only the secret, keeping the label that names it. */
const SHAPES: { rx: RegExp; sub: string }[] = [
  // Factory keys, as lib/server/keys.ts mints them.
  { rx: /\baf_[a-f0-9]{24,}\b/g, sub: MASK },
  // OpenAI-style keys.
  { rx: /\bsk-[A-Za-z0-9_-]{16,}\b/g, sub: MASK },
  // Three base64url segments: a JWT.
  { rx: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, sub: MASK },
  // Bearer tokens in a header or a quoted request.
  { rx: /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{16,}/gi, sub: `$1 ${MASK}` },
  // key: value or key=value pairs whose key names a secret.
  { rx: /\b(api[-_]?key|x-api-key|authorization|password|passwd|secret|token|client[-_]secret)\b(\s*[:=]\s*)(["']?)([^\s"',;]{8,})/gi, sub: `$1$2$3${MASK}` },
];

function escapeRx(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Mask secrets in a string. `live` is the values this process holds
 * (lib/server/redact.ts gathers them); anything shorter than 8 characters
 * is ignored, as the runtime ignores it, because masking "abc" would eat
 * the text.
 */
export function redactText(text: string, live: readonly string[] = []): string {
  if (!text) return text;
  let out = text;
  for (const secret of live) {
    if (!secret || secret.length < 8) continue;
    if (out.includes(secret)) out = out.replace(new RegExp(escapeRx(secret), "g"), MASK);
  }
  for (const { rx, sub } of SHAPES) out = out.replace(rx, sub);
  return out;
}

/** Mask secrets in any JSON-shaped value, recursively. Keys are kept; only strings change. */
export function redactValue<T>(value: T, live: readonly string[] = []): T {
  if (typeof value === "string") return redactText(value, live) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, live)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactValue(v, live);
    return out as T;
  }
  return value;
}
