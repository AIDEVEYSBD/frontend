import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import type { Sheet } from "./prices";

/**
 * The run ledger, read from the journals the runtime wrote.
 *
 * One reader for every page that reports on runs (Control, FinOps, the
 * assistant), so a figure on one page is the same figure on another. Each
 * run comes back with its model calls attributed to the node that made
 * them, because the question FinOps has to answer is not "what did this run
 * cost" but "which step of which workflow is the money going to".
 */

const ROOT = path.resolve(process.cwd(), "..", "runtime");
const RUNS = path.join(ROOT, "workspace", "runs");

export interface CallRow {
  /** Node id inside the workflow that made the call. */
  node: string;
  model: string;
  in: number;
  out: number;
  ms: number;
  cost: number | null;
  /** Whether the reply carried tool intents — a step that drives tools. */
  tools: number;
}

export interface RunRow {
  id: string;
  system: string;
  state: string;
  at: string;
  ms: number;
  entries: number;
  cost: number | null;
  tokens: { in: number; out: number };
  models: string[];
  suspendedAt: string;
  denials: number;
  modelCalls: number;
  toolCalls: number;
  artifacts: number;
  artifactNames: string[];
  /** Model → token/cost share inside this run, for the drill-down. */
  byModel: { model: string; in: number; out: number; cost: number | null }[];
  /** Every model call, attributed to its node. */
  calls: CallRow[];
}

export function costOf(model: string, tk: { in: number; out: number }, sheet: Sheet | null): number | null {
  if (model === "scripted") return 0; // genuinely free
  const p = sheet?.get(model);
  return p ? tk.in * p.in + tk.out * p.out : null; // unknown, not zero
}

let cache: { at: number; key: string; rows: RunRow[] } | null = null;

export async function readRuns(sheet: Sheet | null): Promise<RunRow[]> {
  let files: string[] = [];
  try {
    files = (await readdir(RUNS)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const rows: RunRow[] = [];
  for (const f of files) {
    try {
      const full = path.join(RUNS, f);
      const [raw, st] = await Promise.all([readFile(full, "utf-8"), stat(full)]);
      const run = JSON.parse(raw);
      const entries: { kind: string; node?: string; title?: string; data?: Record<string, unknown> }[] =
        run?.journal?.entries ?? [];
      let denials = 0;
      let modelCalls = 0;
      let toolCalls = 0;
      const artifactNames: string[] = [];
      const perModel = new Map<string, { in: number; out: number }>();
      const calls: CallRow[] = [];
      for (const e of entries) {
        if (e.kind === "denied" || e.kind === "contract.breach") denials += 1;
        if (e.kind === "tool.call") toolCalls += 1;
        if (e.kind === "tool.result") {
          const v = (e.data?.value ?? {}) as Record<string, unknown>;
          if (v.written === true && v.where) {
            const name = String(v.where).split("/").pop() ?? "";
            if (name && !artifactNames.includes(name)) artifactNames.push(name);
          }
        }
        if (e.kind !== "model.call") continue;
        modelCalls += 1;
        // Journals written before the runtime recorded the resolved model
        // titled these entries just "model" — attribute honestly, not wrongly.
        let model = String(e.title ?? "");
        if (!model || model === "model") model = "unattributed (older journal)";
        const tk = (e.data?.tokens ?? {}) as { in?: number; out?: number };
        const agg = perModel.get(model) ?? { in: 0, out: 0 };
        agg.in += Number(tk.in ?? 0);
        agg.out += Number(tk.out ?? 0);
        perModel.set(model, agg);
        const one = { in: Number(tk.in ?? 0), out: Number(tk.out ?? 0) };
        calls.push({
          node: String(e.node ?? ""),
          model,
          ...one,
          ms: Number(e.data?.ms ?? 0),
          cost: costOf(model, one, sheet),
          tools: Array.isArray(e.data?.intents) ? (e.data!.intents as unknown[]).length : 0,
        });
      }

      const byModel = [...perModel.entries()].map(([model, tk]) => ({
        model,
        in: tk.in,
        out: tk.out,
        cost: costOf(model, tk, sheet),
      }));
      const cost = byModel.some((b) => b.cost === null)
        ? null
        : byModel.reduce((s, b) => s + (b.cost as number), 0);

      rows.push({
        id: f.replace(/\.json$/, ""),
        system: String(run?.system ?? ""),
        state: String(run?.state ?? "unknown"),
        at: st.mtime.toISOString(),
        ms: Number(run?.journal?.duration_ms ?? 0),
        entries: entries.length,
        cost,
        tokens: {
          in: byModel.reduce((s, b) => s + b.in, 0),
          out: byModel.reduce((s, b) => s + b.out, 0),
        },
        models: byModel.map((b) => b.model),
        suspendedAt: run?.state === "suspended" ? String(run?.suspension?.node ?? "") : "",
        denials,
        modelCalls,
        toolCalls,
        artifacts: artifactNames.length,
        artifactNames,
        byModel,
        calls,
      });
    } catch {
      /* torn write — skip */
    }
  }
  rows.sort((a, b) => (a.at < b.at ? 1 : -1));
  cache = { at: Date.now(), key: String(files.length), rows };
  return rows;
}

/** The last read, if one happened recently — for callers that can tolerate a few seconds of age. */
export function recentRuns(maxAgeMs = 5_000): RunRow[] | null {
  return cache && Date.now() - cache.at < maxAgeMs ? cache.rows : null;
}
