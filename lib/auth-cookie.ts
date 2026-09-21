/**
 * The session cookie's shape, shared by the middleware (edge) and the
 * runtime (node): `id.exp.sig`, where `sig` is an HMAC over `id.exp` with
 * AUTH_SECRET. Verifying it needs no database, which is what lets the
 * console on Vercel decide "signed in or not" before proxying anything.
 * Everything that needs the person behind the id loads the session row.
 *
 * Web Crypto only, so the same code runs in both places.
 */

export const SESSION_COOKIE = "af_session";
export const LOGIN_COOKIE = "af_auth";

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function sign(payload: string, secret: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await key(secret), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

/** The payload if the signature holds, else null. Constant-time on the signature. */
export async function verify(token: string, secret: string): Promise<string | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64url(await crypto.subtle.sign("HMAC", await key(secret), enc.encode(payload)));
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? payload : null;
}

/** Parse a session cookie into its id when the signature holds and it has not expired. */
export async function readSessionCookie(value: string | undefined, secret: string): Promise<{ id: string; exp: number } | null> {
  if (!value) return null;
  const payload = await verify(value, secret);
  if (!payload) return null;
  const [id, expText] = payload.split(".");
  const exp = Number(expText);
  if (!id || !Number.isFinite(exp) || exp * 1000 < Date.now()) return null;
  return { id, exp };
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}
