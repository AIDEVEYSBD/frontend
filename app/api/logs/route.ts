import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";

/**
 * Log export: every journal entry of every recorded run, flattened to NDJSON —
 * one event per line, enriched with run id, system and an absolute timestamp.
 * This is the shape a SIEM actually ingests (Splunk HEC, Sentinel, Chronicle
 * all eat NDJSON), so "download logs" here is the same stream a forwarder
 * would ship.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUNS = path.resolve(process.cwd(), "..", "runtime", "workspace", "runs");

export async function GET() {
  let files: string[] = [];
  try {
    files = (await readdir(RUNS)).filter((f) => f.endsWith(".json"));
  } catch {
    return new Response("", { status: 200 });
  }

  const lines: string[] = [];
  for (const f of files) {
    try {
      const full = path.join(RUNS, f);
      const [raw, st] = await Promise.all([readFile(full, "utf-8"), stat(full)]);
      const run = JSON.parse(raw);
      const endedAt = st.mtime.getTime();
      const entries: { t: number; [k: string]: unknown }[] = run?.journal?.entries ?? [];
      const duration = Number(run?.journal?.duration_ms ?? entries[entries.length - 1]?.t ?? 0);
      for (const e of entries) {
        lines.push(
          JSON.stringify({
            // Absolute wall-clock, reconstructed from the file's end time and
            // the entry's monotonic offset — labelled so, never passed off as
            // a recorded timestamp.
            ts_approx: new Date(endedAt - duration + Number(e.t ?? 0)).toISOString(),
            run: f.replace(/\.json$/, ""),
            system: run?.system ?? "",
            state: run?.state ?? "",
            ...e,
          }),
        );
      }
    } catch {
      /* torn write — skip the file, keep the export */
    }
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(lines.join("\n") + "\n", {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "content-disposition": `attachment; filename="agent-factory-journal-${stamp}.ndjson"`,
    },
  });
}
