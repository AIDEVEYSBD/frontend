import { activeRuns, killAll, killRun } from "@/lib/server/active-runs";

/**
 * The kill switch.
 *
 * GET lists what is actually in flight; POST throws the switch for one run or
 * all of them. The runtime traps the signal, journals "killed by operator",
 * and writes the state file — so a kill shows up in the record as a decision
 * someone made, never as a run that mysteriously stopped.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ active: activeRuns() });
}

export async function POST(req: Request) {
  let body: { id?: string; all?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "send { id } or { all: true }" }, { status: 400 });
  }

  if (body.all) {
    const killed = killAll();
    return Response.json({ killed });
  }
  if (body.id) {
    const ok = killRun(body.id);
    return ok
      ? Response.json({ killed: [body.id] })
      : Response.json({ error: `no live run "${body.id}" — it may have already finished` }, { status: 404 });
  }
  return Response.json({ error: "send { id } or { all: true }" }, { status: 400 });
}
