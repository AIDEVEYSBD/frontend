import { permit } from "@/lib/server/auth";

/**
 * Where the consoles this one hands off to live.
 *
 * Each security workload has a console of its own, where a run is set up.
 * This console links to it and does not embed it. The addresses are a
 * deployment's to give, at run time, so one that is not live yet is simply
 * not named and the button that would open it says so:
 *
 *   WORKLOAD_URLS={"sast":"https://…","pentest":"https://…","firewall":"https://…","threat_hunt":"https://…"}
 *
 * A key is a workload id (lib/api/pending.ts WORKLOADS). Only http and https
 * addresses are kept; anything else is dropped, never guessed at.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface ConsoleLinks { workloads: Record<string, string> }

export async function GET(req: Request) {
  { const gate = await permit(req, "view"); if (gate) return gate; }
  const workloads: Record<string, string> = {};
  try {
    const parsed = JSON.parse(process.env.WORKLOAD_URLS || "{}") as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value !== "string") continue;
        try {
          const u = new URL(value.trim());
          if (u.protocol === "https:" || u.protocol === "http:") workloads[id.trim()] = u.toString();
        } catch {
          /* not an address */
        }
      }
    }
  } catch {
    /* names nothing */
  }
  return Response.json({ workloads } satisfies ConsoleLinks, { headers: { "cache-control": "no-store" } });
}
