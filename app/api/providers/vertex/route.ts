import { permit } from "@/lib/server/auth";
import { googleIdentity } from "@/lib/server/google";

/**
 * What the Vertex connection can see, read with this server's own Google
 * identity (lib/server/google.ts): the models each publisher lists in Model
 * Garden, and what the project itself has registered and deployed.
 *
 * It is a detection, nothing more. A model listed here is not offered to
 * agents, is not routed to and has not been called; offering one is the
 * configuration door's business (app/api/config/route.ts). The answer is the
 * same shape whether or not there is a connection, so a page can show the
 * list when there is one and nothing when there is not.
 *
 *   GCP_PROJECT, REGION     override what the identity itself says
 *   VERTEX_PUBLISHERS       the publishers to list (default below)
 *   VERTEX_ENDPOINT         the API's address, for a private endpoint
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PUBLISHERS = (process.env.VERTEX_PUBLISHERS || "google,anthropic,meta,mistralai").split(",").map((s) => s.trim()).filter(Boolean);
const PUBLISHER_LABEL: Record<string, string> = { google: "Google", anthropic: "Anthropic", meta: "Meta", mistralai: "Mistral AI", ai21: "AI21 Labs", deepseek: "DeepSeek", qwen: "Qwen", openai: "OpenAI" };
const STAGE: Record<string, string> = { GA: "GA", PUBLIC_PREVIEW: "preview", PRIVATE_PREVIEW: "private preview", EXPERIMENTAL: "experimental" };

export interface VertexModel { id: string; name: string; label: string; version?: string; stage?: string }
export interface VertexGroup { id: string; label: string; kind: "publisher" | "deployed" | "registered"; models: VertexModel[]; /** Why this group could not be read, when it could not. */ error?: string }
export interface VertexAnswer {
  connected: boolean;
  /** How this server holds its Google identity: the workload's own, a credentials file, or a token handed in. */
  source: "metadata" | "file" | "token" | null;
  account: string;
  project: string;
  region: string;
  groups: VertexGroup[];
  total: number;
  checkedAt: string;
}

let cache: { at: number; value: VertexAnswer } | null = null;

type Row = Record<string, unknown>;

/** Every page of one list call, up to a ceiling; the items are under `key`. */
async function list(url: string, key: string, headers: Record<string, string>): Promise<Row[]> {
  const out: Row[] = [];
  let token = "";
  for (let page = 0; page < 6; page++) {
    const u = new URL(url);
    u.searchParams.set("pageSize", "200");
    if (token) u.searchParams.set("pageToken", token);
    const res = await fetch(u, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      let why = `answered ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { status?: string } };
        if (body.error?.status) why = `${why} ${body.error.status}`;
      } catch {
        /* no JSON body */
      }
      throw new Error(why);
    }
    const data = (await res.json()) as Record<string, unknown>;
    if (Array.isArray(data[key])) out.push(...(data[key] as Row[]));
    token = typeof data.nextPageToken === "string" ? data.nextPageToken : "";
    if (!token) break;
  }
  return out;
}

const tail = (name: unknown) => String(name ?? "").split("/").pop() ?? "";

export async function GET(req: Request) {
  { const gate = await permit(req, "view"); if (gate) return gate; }
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  if (cache && !fresh && Date.now() - cache.at < 300_000) return Response.json(cache.value);

  const who = await googleIdentity();
  if (!who) {
    // The page stays silent about this; the log is where whoever deploys reads why.
    console.warn("[vertex] no Google identity on this server: no metadata server answered and no credentials file was found");
    return Response.json({ connected: false, source: null, account: "", project: "", region: "", groups: [], total: 0, checkedAt: new Date().toISOString() } satisfies VertexAnswer);
  }
  const host = (process.env.VERTEX_ENDPOINT || (who.region ? `https://${who.region}-aiplatform.googleapis.com` : "https://aiplatform.googleapis.com")).replace(/\/+$/, "");
  const bearer = { authorization: `Bearer ${who.token}` };
  // A person's credential needs a project to bill the call to; a workload's own identity carries one.
  const billed = who.project ? { ...bearer, "x-goog-user-project": who.project } : bearer;
  const first = who.source === "file" ? billed : bearer;
  const second = who.source === "file" ? bearer : billed;
  const read = async (url: string, key: string) => {
    try {
      return await list(url, key, first);
    } catch (e) {
      if (first === second || !/ 40[03]/.test(` ${(e as Error).message}`)) throw e;
      return list(url, key, second);
    }
  };

  const jobs: Promise<VertexGroup>[] = PUBLISHERS.map(async (p) => {
    const group: VertexGroup = { id: p, label: PUBLISHER_LABEL[p] ?? p, kind: "publisher", models: [] };
    try {
      const rows = await read(`${host}/v1beta1/publishers/${encodeURIComponent(p)}/models`, "publisherModels");
      const seen = new Set<string>();
      for (const r of rows) {
        const id = tail(r.name);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        group.models.push({ id, name: String(r.name), label: id, ...(r.versionId ? { version: String(r.versionId) } : {}), ...(STAGE[String(r.launchStage)] ? { stage: STAGE[String(r.launchStage)] } : {}) });
      }
      group.models.sort((a, b) => a.id.localeCompare(b.id));
    } catch (e) {
      group.error = (e as Error).message;
    }
    return group;
  });

  if (who.project && who.region) {
    const base = `${host}/v1/projects/${encodeURIComponent(who.project)}/locations/${encodeURIComponent(who.region)}`;
    jobs.push(
      (async () => {
        const group: VertexGroup = { id: "deployed", label: "Deployed in this project", kind: "deployed", models: [] };
        try {
          for (const r of await read(`${base}/endpoints`, "endpoints")) {
            const deployed = Array.isArray(r.deployedModels) ? (r.deployedModels as Row[]) : [];
            group.models.push({ id: tail(r.name), name: String(r.name), label: String(r.displayName || tail(r.name)), ...(deployed.length ? { version: `${deployed.length} model${deployed.length === 1 ? "" : "s"}` } : {}) });
          }
        } catch (e) {
          group.error = (e as Error).message;
        }
        return group;
      })(),
      (async () => {
        const group: VertexGroup = { id: "registered", label: "Registered in this project", kind: "registered", models: [] };
        try {
          for (const r of await read(`${base}/models`, "models")) {
            group.models.push({ id: tail(r.name), name: String(r.name), label: String(r.displayName || tail(r.name)), ...(r.versionId ? { version: String(r.versionId) } : {}) });
          }
        } catch (e) {
          group.error = (e as Error).message;
        }
        return group;
      })(),
    );
  }

  const groups = await Promise.all(jobs);
  for (const g of groups) if (g.error) console.warn(`[vertex] ${g.kind === "publisher" ? `publishers/${g.id}` : g.id}: ${g.error} (as ${who.account || who.source}, project ${who.project || "unknown"}, ${host})`);
  const total = groups.reduce((n, g) => n + g.models.length, 0);
  // The identity is there, but if every list was refused nothing was detected: the page then has nothing to show.
  const value: VertexAnswer = { connected: groups.some((g) => !g.error), source: who.source, account: who.account, project: who.project, region: who.region, groups, total, checkedAt: new Date().toISOString() };
  if (value.connected) cache = { at: Date.now(), value };
  return Response.json(value);
}
