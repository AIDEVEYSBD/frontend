import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { SignJWT, importPKCS8 } from "jose";

/**
 * The Google identity this console's own server runs as, without a client
 * library: the same three sources Google's libraries try, in the order the
 * backend's identity port tries them (backend/app/ports/identity.py), under
 * the same variable names.
 *
 *   GCP_TOKEN              a bearer token handed in (a test, a short check)
 *   the metadata server    the workload's service account on GKE or Cloud Run
 *   a credentials file     GCP_CREDENTIALS_FILE, GOOGLE_APPLICATION_CREDENTIALS,
 *                          or the file `gcloud auth application-default login`
 *                          leaves on a laptop; a service-account key or a
 *                          person's refresh token
 *
 * Nothing here throws to a page: no identity is an answer (`null`), and the
 * caller says the connection is not there.
 */

const SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const METADATA_HOST = process.env.GCP_METADATA_HOST || process.env.GCE_METADATA_HOST || "metadata.google.internal";

export interface GoogleIdentity {
  token: string;
  /** Where the token came from. */
  source: "token" | "metadata" | "file";
  /** The service account or person the token acts as, when it can be read. */
  account: string;
  project: string;
  /** The region the workload runs in, when the metadata server says. */
  region: string;
}

let held: { at: number; expires: number; value: GoogleIdentity } | null = null;
/** No identity was found: remembered briefly so a page load does not wait on the metadata server every time. */
let missedAt = 0;

async function metadata(pathname: string, ms = 1500): Promise<string> {
  const res = await fetch(`http://${METADATA_HOST}/computeMetadata/v1/${pathname}`, { headers: { "Metadata-Flavor": "Google" }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`metadata answered ${res.status}`);
  return (await res.text()).trim();
}

async function fromMetadata(): Promise<{ value: GoogleIdentity; ttl: number } | null> {
  try {
    const raw = JSON.parse(await metadata("instance/service-accounts/default/token")) as { access_token?: string; expires_in?: number };
    if (!raw.access_token) return null;
    const [account, project, zone, runRegion] = await Promise.all([
      metadata("instance/service-accounts/default/email").catch(() => ""),
      metadata("project/project-id").catch(() => ""),
      metadata("instance/zone").catch(() => ""),
      metadata("instance/region").catch(() => ""),
    ]);
    // GKE answers a zone (projects/1/zones/europe-west4-a); Cloud Run a region (projects/1/regions/europe-west4).
    const z = zone.split("/").pop() ?? "";
    const region = (runRegion.split("/").pop() ?? "") || z.replace(/-[a-z]$/, "");
    return { value: { token: raw.access_token, source: "metadata", account, project, region }, ttl: Number(raw.expires_in ?? 300) };
  } catch {
    return null;
  }
}

interface KeyFile { type?: string; client_email?: string; private_key?: string; token_uri?: string; project_id?: string; client_id?: string; client_secret?: string; refresh_token?: string; quota_project_id?: string; account?: string }

async function fromFile(): Promise<{ value: GoogleIdentity; ttl: number } | null> {
  const candidates = [process.env.GCP_CREDENTIALS_FILE, process.env.GOOGLE_APPLICATION_CREDENTIALS, path.join(os.homedir(), ".config", "gcloud", "application_default_credentials.json")].filter(Boolean) as string[];
  for (const file of candidates) {
    let key: KeyFile;
    try {
      key = JSON.parse(await readFile(file, "utf-8")) as KeyFile;
    } catch {
      continue;
    }
    try {
      const uri = key.token_uri || "https://oauth2.googleapis.com/token";
      let body: URLSearchParams | null = null;
      if (key.type === "service_account" && key.client_email && key.private_key) {
        const assertion = await new SignJWT({ scope: SCOPE })
          .setProtectedHeader({ alg: "RS256", typ: "JWT" })
          .setIssuer(key.client_email)
          .setAudience(uri)
          .setIssuedAt()
          .setExpirationTime("55m")
          .sign(await importPKCS8(key.private_key, "RS256"));
        body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion });
      } else if (key.type === "authorized_user" && key.refresh_token && key.client_id && key.client_secret) {
        body = new URLSearchParams({ grant_type: "refresh_token", refresh_token: key.refresh_token, client_id: key.client_id, client_secret: key.client_secret });
      }
      if (!body) continue;
      const res = await fetch(uri, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const raw = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!raw.access_token) continue;
      return {
        value: { token: raw.access_token, source: "file", account: key.client_email || key.account || "", project: key.project_id || key.quota_project_id || "", region: "" },
        ttl: Number(raw.expires_in ?? 300),
      };
    } catch {
      continue;
    }
  }
  return null;
}

/** The identity, or null when this server has none. Held until a minute before the token lapses. */
export async function googleIdentity(): Promise<GoogleIdentity | null> {
  const now = Date.now();
  if (held && now < held.expires) return held.value;
  if (!held && missedAt && now - missedAt < 60_000) return null;
  let got: { value: GoogleIdentity; ttl: number } | null = null;
  if (process.env.GCP_TOKEN) got = { value: { token: process.env.GCP_TOKEN, source: "token", account: "", project: "", region: "" }, ttl: 300 };
  got = got ?? (await fromMetadata()) ?? (await fromFile());
  if (!got) {
    held = null;
    missedAt = now;
    return null;
  }
  const value: GoogleIdentity = {
    ...got.value,
    project: process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || got.value.project,
    region: process.env.REGION || process.env.GOOGLE_CLOUD_REGION || got.value.region,
  };
  held = { at: now, expires: now + Math.max(30, got.ttl - 60) * 1000, value };
  missedAt = 0;
  return value;
}
