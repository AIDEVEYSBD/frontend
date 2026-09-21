import path from "node:path";
import { readFile } from "node:fs/promises";
import { authenticate } from "@/lib/server/keys";

/**
 * One SDK-reported run, as the agent's own process sees it.
 *
 * The agent polls this while it waits at a gate: the moment a person answers
 * on the control pane the answer is on the record, and the agent carries on.
 * Only the agent the run belongs to may read it, under its own key.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUNS = path.resolve(process.cwd(), "..", "runtime", "workspace", "runs");

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[a-z][a-z0-9-]{0,62}-[A-Za-z0-9._-]{1,80}$/.test(id)) return Response.json({ error: "bad run id" }, { status: 400 });
  let run: { system?: string; state?: string; answer?: unknown; suspension?: unknown; error?: string; reported_by?: { mode?: string } };
  try {
    run = JSON.parse(await readFile(path.join(RUNS, `${id}.json`), "utf-8"));
  } catch {
    return Response.json({ error: `no run "${id}"` }, { status: 404 });
  }
  const agent = String(run.system ?? "");
  const auth = await authenticate(req, agent);
  if (!auth.ok) return Response.json({ error: auth.error }, { status: auth.status });
  return Response.json({
    id,
    agent,
    state: run.state ?? "unknown",
    answer: run.answer ?? null,
    suspension: run.suspension ?? null,
    error: run.error ?? "",
    reported_by: run.reported_by?.mode ?? "sdk",
  });
}
