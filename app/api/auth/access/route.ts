import { permit, iapEnabled, iapRoles, defaultRole } from "@/lib/server/auth";
import { googleIdentity } from "@/lib/server/google";

/**
 * Who Google IAP lets through to this console.
 *
 * IAP keeps an access list on the service it fronts (and on the levels above
 * it: every service of that kind in the region, every IAP resource in the
 * project). A principal on any of them with the "IAP-secured Web App User"
 * role may open the console. This reads those three lists with the server's
 * own Google identity and joins each entry to the console role the
 * deployment's mapping gives it (IAP_ROLE_MAP).
 *
 * What it can and cannot say: an entry is a person, a group, a whole domain
 * or a service account, exactly as it was granted. A group or a domain is
 * one entry; its members are not listed here, because that is the directory's
 * to answer, not IAP's. A role granted on the whole project through project
 * IAM is not read either. The answer says which levels it read.
 *
 * The server's service account needs `iap.webServices.getIamPolicy`,
 * `iap.webTypes.getIamPolicy` and `iap.web.getIamPolicy`. Without them the
 * list is not readable and the answer says so; nothing is guessed.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACCESSOR = "roles/iap.httpsResourceAccessor";
const API = (process.env.IAP_API_ENDPOINT || "https://iap.googleapis.com").replace(/\/+$/, "");

export interface IapPrincipal {
  /** As IAM writes it: user:a@b.com, group:g@b.com, domain:b.com, serviceAccount:… */
  member: string;
  kind: "person" | "group" | "domain" | "service_account" | "other";
  name: string;
  /** Where the grant sits. */
  level: "service" | "kind" | "project";
  /** The console role the mapping gives this entry; null when it gives none (the person is let in by Google and refused by the console), and for a group, where it is decided per person at sign-in. */
  role: string | null;
  /** True when the role is the default because the mapping names no role for this entry. */
  defaulted: boolean;
  /** An IAM condition on the grant, in its own words, when there is one. */
  condition?: string;
}
export interface IapAccessAnswer {
  /** IAP sign-in is on for this deployment. */
  enabled: boolean;
  /** The access lists were read. */
  readable: boolean;
  /** The IAP resource this console sits behind, as IAP names it. */
  resource: string;
  /** Which levels answered. */
  levels: { level: IapPrincipal["level"]; label: string; read: boolean }[];
  principals: IapPrincipal[];
  /** Entries the role mapping names that IAP does not let through at any level read. */
  mappedOnly: string[];
  checkedAt: string;
}

/** The IAP resources that govern access, nearest first, from the audience IAP's assertions carry. */
function resourcesOf(audience: string): { level: IapPrincipal["level"]; label: string; name: string }[] {
  let m = audience.match(/^\/projects\/(\d+)\/locations\/([^/]+)\/services\/([^/]+)$/);
  if (m) {
    return [
      { level: "service", label: "This service", name: `projects/${m[1]}/iap_web/cloud_run-${m[2]}/services/${m[3]}` },
      { level: "kind", label: `Every Cloud Run service in ${m[2]}`, name: `projects/${m[1]}/iap_web/cloud_run-${m[2]}` },
      { level: "project", label: "Every IAP resource in the project", name: `projects/${m[1]}/iap_web` },
    ];
  }
  m = audience.match(/^\/projects\/(\d+)\/global\/backendServices\/([^/]+)$/);
  if (m) {
    return [
      { level: "service", label: "This backend service", name: `projects/${m[1]}/iap_web/compute/services/${m[2]}` },
      { level: "kind", label: "Every backend service in the project", name: `projects/${m[1]}/iap_web/compute` },
      { level: "project", label: "Every IAP resource in the project", name: `projects/${m[1]}/iap_web` },
    ];
  }
  return [];
}

let cache: { at: number; value: IapAccessAnswer } | null = null;

export async function GET(req: Request) {
  { const gate = await permit(req, "identity"); if (gate) return gate; }
  const now = new Date().toISOString();
  const empty: IapAccessAnswer = { enabled: iapEnabled(), readable: false, resource: "", levels: [], principals: [], mappedOnly: [], checkedAt: now };
  if (!iapEnabled()) return Response.json(empty);
  if (cache && Date.now() - cache.at < 120_000 && new URL(req.url).searchParams.get("fresh") !== "1") return Response.json(cache.value);

  const resources = resourcesOf(process.env.IAP_AUDIENCE ?? "");
  const who = await googleIdentity();
  if (!resources.length || !who) {
    console.warn(`[iap-access] ${!who ? "no Google identity on this server" : "IAP_AUDIENCE is not a Cloud Run service or a backend service"}`);
    return Response.json({ ...empty, resource: resources[0]?.name ?? "" });
  }

  let map: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(process.env.IAP_ROLE_MAP || "{}") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) map = Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k.trim().toLowerCase(), v]));
  } catch {
    /* names nobody */
  }
  const roleOfKey = (key: string): string | null => {
    const hit = map[key];
    const roles = Array.isArray(hit) ? hit.map(String) : typeof hit === "string" ? [hit] : [];
    return roles.map((r) => r.trim()).filter(Boolean).join(", ") || null;
  };

  const principals: IapPrincipal[] = [];
  const seen = new Set<string>();
  const levels: IapAccessAnswer["levels"] = [];
  for (const r of resources) {
    let read = false;
    try {
      const res = await fetch(`${API}/v1/${r.name}:getIamPolicy`, {
        method: "POST",
        headers: { authorization: `Bearer ${who.token}`, "content-type": "application/json" },
        body: JSON.stringify({ options: { requestedPolicyVersion: 3 } }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`answered ${res.status}`);
      const policy = (await res.json()) as { bindings?: { role?: string; members?: string[]; condition?: { title?: string; expression?: string } }[] };
      read = true;
      for (const b of policy.bindings ?? []) {
        if (b.role !== ACCESSOR) continue;
        for (const member of b.members ?? []) {
          if (seen.has(member)) continue;
          seen.add(member);
          const [type, ...rest] = member.split(":");
          const name = rest.join(":");
          const kind: IapPrincipal["kind"] = type === "user" ? "person" : type === "group" ? "group" : type === "domain" ? "domain" : type === "serviceAccount" ? "service_account" : "other";
          let role: string | null = null;
          let defaulted = false;
          if (kind === "person") {
            const mapped = iapRoles(name.toLowerCase()).join(", ");
            role = mapped || defaultRole() || null;
            defaulted = !mapped && Boolean(role);
          } else if (kind === "domain") {
            const mapped = roleOfKey(`@${name.toLowerCase()}`);
            role = mapped || defaultRole() || null;
            defaulted = !mapped && Boolean(role);
          }
          const condition = b.condition?.title || b.condition?.expression;
          principals.push({ member, kind, name: name || member, level: r.level, role, defaulted, ...(condition ? { condition } : {}) });
        }
      }
    } catch (e) {
      console.warn(`[iap-access] ${r.name}: ${(e as Error).message} (as ${who.account || who.source})`);
    }
    levels.push({ level: r.level, label: r.label, read });
  }

  const granted = new Set(principals.map((p) => (p.kind === "person" ? p.name.toLowerCase() : p.kind === "domain" ? `@${p.name.toLowerCase()}` : "")));
  const domains = principals.filter((p) => p.kind === "domain").map((p) => `@${p.name.toLowerCase()}`);
  const mappedOnly = Object.keys(map).filter((k) => !granted.has(k) && !(k.includes("@") && !k.startsWith("@") && domains.includes(k.slice(k.lastIndexOf("@")))));
  const order = { person: 0, group: 1, domain: 2, service_account: 3, other: 4 } as const;
  principals.sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
  const value: IapAccessAnswer = { enabled: true, readable: levels.some((l) => l.read), resource: resources[0].name, levels, principals, mappedOnly: levels.some((l) => l.read) && !principals.some((p) => p.kind === "group") ? mappedOnly : [], checkedAt: now };
  if (value.readable) cache = { at: Date.now(), value };
  return Response.json(value);
}
