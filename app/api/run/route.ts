import { spawn } from "node:child_process";
import { permit, session as whoIs, signer, ssoEnabled } from "@/lib/server/auth";
import path from "node:path";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dbReady, query } from "@/lib/server/db";
import { registerRun } from "@/lib/server/active-runs";
import { budgetGate } from "@/lib/server/budget";
import { tmpdir } from "node:os";

/**
 * Run a spec.
 *
 * The builder POSTs the document it is holding; this hands it to the runtime
 * and streams the journal back line by line as server-sent events. What comes
 * back is not a summary written for the console — it is the same JSONL the
 * control plane would consume in a real deployment, rendered.
 *
 * The runtime is a separate process on purpose. It is Python, it is the thing
 * that actually gets containerised and deployed into a client's account, and
 * nothing about it should depend on a Next.js server being in front of it. This
 * route is a demonstration harness, not part of the architecture.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROOT = path.resolve(process.cwd(), "..", "runtime");

export async function POST(req: Request) {
  { const gate = await permit(req, "run"); if (gate) return gate; }
  let body: {
    spec?: unknown;
    input?: Record<string, unknown>;
    model?: string;
    provider?: "foundry" | "scripted";
    answer?: Record<string, unknown>;
    stateFile?: string;
  };

  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected a JSON body" }, { status: 400 });
  }

  if (!body.spec) {
    return Response.json({ error: "no spec supplied" }, { status: 400 });
  }

  // The budget is a stop, not a chart. A run that would start past it does not start.
  // Resuming a suspended run with an answer is not a new start and is not held.
  if (!body.answer) {
    const over = await budgetGate();
    if (over) return Response.json({ error: over.error, budget: over.budget }, { status: 402 });
  }

  // The spec goes to a file rather than argv: it is large, and a document that
  // has been through a shell is a document that can be quoted wrong.
  const dir = await mkdtemp(path.join(tmpdir(), "af-run-"));
  const specPath = path.join(dir, "spec.json");
  // Runs persist into the workspace so the Runs page can show them afterwards
  // — a run that vanishes when the panel closes never happened, as far as
  // anyone reviewing later is concerned.
  const runsDir = path.join(ROOT, "workspace", "runs");
  await mkdir(runsDir, { recursive: true });
  const specId = (body.spec as { metadata?: { id?: string } })?.metadata?.id ?? "run";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const statePath =
    body.stateFile || path.join(runsDir, `${specId}-${stamp}-${Math.random().toString(36).slice(2, 6)}.json`);
  await writeFile(specPath, JSON.stringify(body.spec, null, 2));

  const resuming = Boolean(body.answer && body.stateFile);
  const args = [
    "-m",
    "agentfactory",
    resuming ? "resume" : "run",
    "--spec",
    specPath,
    "--state",
    statePath,
    "--provider",
    body.provider ?? "foundry",
    "--model",
    body.model || process.env.AF_MODEL || "",
    resuming ? "--answer" : "--input",
    JSON.stringify(resuming ? body.answer : (body.input ?? {})),
  ];

  const child = spawn("python3", args, {
    cwd: ROOT,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });

  // On the books the moment it exists — the kill switch can only reach what
  // is registered.
  registerRun({
    id: path.basename(statePath, ".json"),
    system: String(specId),
    startedAt: new Date().toISOString(),
    child,
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let open = true;
      const send = (obj: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          open = false; // viewer went away mid-write — the run continues
        }
      };

      // Same reason as the eval stream: a single model call can outlast a
      // proxy's idle timeout, and a dropped connection reads as a dead run.
      const beat = setInterval(() => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(": keepalive\n\n"));
        } catch {
          open = false;
        }
      }, 15_000);

      send({ type: "opened", stateFile: statePath });

      // stdout is JSONL. Buffer across chunk boundaries — a journal entry
      // carrying a long tool result will not arrive in one piece.
      let buffered = "";
      child.stdout.on("data", (chunk: Buffer) => {
        buffered += chunk.toString();
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            send(JSON.parse(line));
          } catch {
            send({ type: "log", message: line });
          }
        }
      });

      // Anything on stderr is a real failure — a traceback, a missing key.
      // Surfacing it verbatim beats "the run failed" with nothing attached.
      let errors = "";
      child.stderr.on("data", (chunk: Buffer) => {
        errors += chunk.toString();
      });

      child.on("error", (e) => {
        send({
          type: "error",
          message:
            `could not start the runtime (${e.message}). ` +
            `Check that python3 is on PATH and that ${ROOT} exists.`,
        });
        clearInterval(beat);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });

      child.on("close", async (code) => {
        // The finished run joins the registry index. Best effort — the state
        // file remains the record of truth either way.
        try {
          if (await dbReady()) {
            const run = JSON.parse(await readFile(statePath, "utf-8"));
            const entries: { kind: string }[] = run?.journal?.entries ?? [];
            await query(
              `INSERT INTO runs (id, system, state, summary, run, at)
               VALUES ($1, $2, $3, $4, $5, now())
               ON CONFLICT (id) DO UPDATE SET
                 state = EXCLUDED.state, summary = EXCLUDED.summary,
                 run = EXCLUDED.run, at = now()`,
              [
                path.basename(statePath, ".json"),
                run?.system ?? "",
                run?.state ?? "unknown",
                {
                  duration_ms: run?.journal?.duration_ms ?? 0,
                  entries: entries.length,
                  model_calls: entries.filter((e) => e.kind === "model.call").length,
                  tool_calls: entries.filter((e) => e.kind === "tool.call").length,
                  denied: entries.filter((e) => e.kind === "denied" || e.kind === "contract.breach").length,
                },
                run,
              ],
            );
          }
        } catch {
          /* no state file (early failure) or db away — the stream already told the user */
        }
        if (buffered.trim()) {
          try {
            send(JSON.parse(buffered));
          } catch {
            send({ type: "log", message: buffered });
          }
        }
        if (code !== 0 && errors.trim()) {
          send({ type: "error", message: errors.trim().split("\n").slice(-12).join("\n") });
        }
        send({ type: "closed", code });
        clearInterval(beat);
        try {
          controller.close();
        } catch {
          /* already closed by a disconnect */
        }
      });
    },
    cancel() {
      // A closed tab is not a kill decision. The run continues server-side,
      // stays on the active-runs register, and persists when it finishes —
      // the kill switch at /api/kill is the only thing that stops it.
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
