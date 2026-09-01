import path from "node:path";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { dbReady, query } from "@/lib/server/db";

/**
 * Recorded runs.
 *
 * A run file is the runtime's own serialisation — journal, values, result,
 * suspension — written as the run ended. This route reads them back for the
 * Runs page; it derives summaries, it never edits. The journal is an audit
 * record, and an audit record something else can rewrite is not one.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DIR = path.resolve(process.cwd(), "..", "runtime", "workspace", "runs");

interface JournalEntry {
  kind: string;
  node?: string;
  t: number;
  data?: Record<string, unknown>;
}

/** Files a run produced, pulled out of its own journal. */
function artifactsOf(entries: JournalEntry[]): { where: string; name: string; kind: string }[] {
  const out: { where: string; name: string; kind: string }[] = [];
  for (const e of entries) {
    const data = e.data ?? {};
    const value = (data.value ?? {}) as Record<string, unknown>;
    const where =
      (e.kind === "tool.result" && value.written === true && String(value.where ?? "")) ||
      (e.kind === "note" && String(data.where ?? "")) ||
      "";
    if (where && !out.some((a) => a.where === where)) {
      out.push({ where, name: path.basename(where), kind: path.extname(where).slice(1) || "file" });
    }
  }
  return out;
}

export async function GET(req: Request) {
  await mkdir(DIR, { recursive: true });
  const id = new URL(req.url).searchParams.get("id");
  const db = await dbReady();

  if (id) {
    if (!/^[a-zA-Z0-9._-]+$/.test(id)) return Response.json({ error: "bad id" }, { status: 400 });
    if (db) {
      const rows = await query<{ run: { journal?: { entries?: JournalEntry[] } } }>(
        "SELECT run FROM runs WHERE id = $1",
        [id],
      );
      if (rows.length) {
        return Response.json({
          run: rows[0].run,
          artifacts: artifactsOf(rows[0].run?.journal?.entries ?? []),
          store: "db",
        });
      }
    }
    try {
      const run = JSON.parse(await readFile(path.join(DIR, `${id}.json`), "utf-8"));
      return Response.json({
        run,
        artifacts: artifactsOf(run?.journal?.entries ?? []),
      });
    } catch {
      return Response.json({ error: `no recorded run "${id}"` }, { status: 404 });
    }
  }

  if (db) {
    const rows = await query<{
      id: string;
      system: string;
      state: string;
      at: string;
      summary: Record<string, number>;
    }>("SELECT id, system, state, at, summary FROM runs ORDER BY at DESC LIMIT 200");
    if (rows.length) {
      return Response.json({
        runs: rows.map((r) => ({
          id: r.id,
          system: r.system,
          state: r.state,
          at: r.at,
          duration_ms: r.summary?.duration_ms ?? 0,
          entries: r.summary?.entries ?? 0,
          model_calls: r.summary?.model_calls ?? 0,
          tool_calls: r.summary?.tool_calls ?? 0,
          denied: r.summary?.denied ?? 0,
          artifacts: 0,
        })),
        store: "db",
      });
    }
  }

  const files = (await readdir(DIR)).filter((f) => f.endsWith(".json"));
  const runs = [];
  for (const f of files) {
    try {
      const full = path.join(DIR, f);
      const [raw, st] = await Promise.all([readFile(full, "utf-8"), stat(full)]);
      const run = JSON.parse(raw);
      const entries: JournalEntry[] = run?.journal?.entries ?? [];
      runs.push({
        id: f.replace(/\.json$/, ""),
        run_id: run?.id ?? "",
        system: run?.system ?? "",
        state: run?.state ?? "unknown",
        at: st.mtime.toISOString(),
        duration_ms: run?.journal?.duration_ms ?? 0,
        entries: entries.length,
        model_calls: entries.filter((e) => e.kind === "model.call").length,
        tool_calls: entries.filter((e) => e.kind === "tool.call").length,
        denied: entries.filter((e) => e.kind === "denied" || e.kind === "contract.breach").length,
        artifacts: artifactsOf(entries).length,
      });
    } catch {
      /* a torn write mid-run; the list skips it rather than failing whole */
    }
  }
  runs.sort((a, b) => (a.at < b.at ? 1 : -1));
  return Response.json({ runs });
}
