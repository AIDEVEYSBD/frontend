import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { ENDPOINTS } from "@/lib/attached";

/**
 * The factory's own agent card.
 *
 * A2A peers discover the factory the way the factory discovers them: one
 * document at a well-known path saying what it can do. The skills are the
 * deployed workflows, read from the registry directory, so the card can never
 * advertise a workflow that does not exist.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENTS = path.resolve(process.cwd(), "..", "runtime", "workspace", "agents");

export async function GET() {
  const skills: { id: string; name: string; description: string; tags: string[] }[] = [];
  try {
    for (const f of (await readdir(AGENTS)).filter((f) => f.endsWith(".json")).sort()) {
      try {
        const doc = JSON.parse(await readFile(path.join(AGENTS, f), "utf-8"));
        const id = String(doc?.metadata?.id ?? f.replace(/\.json$/, ""));
        skills.push({
          id,
          name: String(doc?.metadata?.name ?? id),
          description: String(doc?.metadata?.description ?? ""),
          tags: ["workflow", String(doc?.spec?.trigger?.kind ?? "prompt")],
        });
      } catch {
        /* a half-written file; the card skips it */
      }
    }
  } catch {
    /* no registry directory yet */
  }
  return Response.json({
    name: "Agent Factory",
    description: "A control plane for agentic systems: composable harnesses, a policy engine, a journal of every decision, and the workflows deployed on this instance as skills.",
    url: ENDPOINTS.tasks,
    version: "0.1.0",
    provider: { organization: "EY", url: ENDPOINTS.origin },
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: true },
    authentication: { schemes: ["bearer"] },
    defaultInputModes: ["application/json", "text/plain"],
    defaultOutputModes: ["application/json"],
    skills,
  });
}
