import path from "node:path";
import { readFile } from "node:fs/promises";
import { dbReady, query } from "@/lib/server/db";
import { reduce, validateLabels, type Labels } from "@/lib/metrics";

/** Shared eval-set shapes and loading — used by /api/evals and /api/evals/run. */

export const EVALS_DIR = path.resolve(process.cwd(), "..", "runtime", "workspace", "evals");

export interface Check {
  kind: "contains" | "not_contains" | "field" | "state";
  value?: string;
  path?: string;
  equals?: unknown;
}

export interface EvalCase {
  id: string;
  note?: string;
  input: Record<string, unknown>;
  checks: Check[];
  /** Ground-truth label, when the set declares a label space. */
  expected?: string;
}

export interface EvalSet {
  id: string;
  agent: string;
  name: string;
  /** Default model this benchmark runs on; empty = deployment default. */
  model?: string;
  /** Label space, positive class and reducer for a labeled benchmark. */
  labels?: Labels;
  cases: EvalCase[];
}

export function validateSet(raw: unknown): EvalSet | string {
  const s = raw as { id?: string; agent?: string; name?: string; model?: string; labels?: unknown; cases?: unknown[] };
  if (!s || typeof s !== "object") return "the set must be a JSON object";
  if (!s.agent || typeof s.agent !== "string") return "the set needs `agent` — which saved agent it benchmarks";
  if (!Array.isArray(s.cases) || !s.cases.length) return "the set needs a non-empty `cases` array";
  const id = String(s.id ?? "").trim() || `${s.agent}-evals`;
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(id)) return "`id` must be kebab-case";

  const labels = validateLabels(s.labels);
  if (typeof labels === "string") return labels;

  const cases: EvalCase[] = [];
  for (let i = 0; i < s.cases.length; i++) {
    const c = s.cases[i] as Partial<EvalCase>;
    if (!c || typeof c !== "object") return `case ${i} is not an object`;
    if (!c.input || typeof c.input !== "object") return `case ${i} needs an \`input\` object`;
    const checks = Array.isArray(c.checks) ? c.checks : [];
    const expected = c.expected !== undefined && c.expected !== "" ? String(c.expected) : undefined;
    if (expected !== undefined && !labels) return `case ${i} has \`expected\` but the set declares no \`labels\``;
    if (labels && expected === undefined) return `case ${i} needs \`expected\` — one of ${labels.space.join(", ")}`;
    if (labels && !labels.space.includes(expected!)) {
      return `case ${i}: expected ${JSON.stringify(expected)} is not in the label space`;
    }
    if (!checks.length && !labels) return `case ${i} needs at least one check`;
    for (const ch of checks) {
      if (!["contains", "not_contains", "field", "state"].includes(String(ch.kind))) {
        return `case ${i}: unknown check kind ${JSON.stringify(ch.kind)} — use contains, not_contains, field, or state`;
      }
      if ((ch.kind === "contains" || ch.kind === "not_contains") && typeof ch.value !== "string") {
        return `case ${i}: a ${ch.kind} check needs a string \`value\``;
      }
      if (ch.kind === "field" && (typeof ch.path !== "string" || !("equals" in ch))) {
        return `case ${i}: a field check needs \`path\` and \`equals\``;
      }
    }
    cases.push({
      id: String(c.id ?? `case-${i + 1}`),
      note: c.note ? String(c.note) : undefined,
      input: c.input as Record<string, unknown>,
      checks: checks as Check[],
      ...(expected !== undefined ? { expected } : {}),
    });
  }
  return {
    id,
    agent: s.agent,
    name: String(s.name ?? id),
    model: String(s.model ?? ""),
    ...(labels ? { labels } : {}),
    cases,
  };
}

export async function loadSet(id: string): Promise<EvalSet | null> {
  if (await dbReady()) {
    const rows = await query<EvalSet & Record<string, unknown>>(
      "SELECT id, agent, name, model, labels, cases FROM eval_sets WHERE id = $1",
      [id],
    );
    if (rows.length) {
      const r = rows[0];
      if (!r.labels) delete (r as { labels?: unknown }).labels;
      return r;
    }
  }
  try {
    return JSON.parse(await readFile(path.join(EVALS_DIR, `${id}.json`), "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Grade one finished run against a case's checks and, for a labeled set, its
 * expected label. Deterministic on purpose: the reducer is declared config,
 * never a model's opinion.
 */
export function grade(
  checks: Check[],
  runState: string,
  result: unknown,
  labeled?: { labels: Labels; expected: string },
): { passed: boolean; predicted: string | null; detail: { kind: string; ok: boolean; note: string }[] } {
  const blob = JSON.stringify(result ?? "").toLowerCase();
  let predicted: string | null = null;
  const detail: { kind: string; ok: boolean; note: string }[] = [];
  if (labeled) {
    const r = runState === "done" ? reduce(result, labeled.labels) : { label: null, note: `run ended ${runState}` };
    predicted = r.label;
    detail.push({
      kind: "label",
      ok: predicted === labeled.expected,
      note: `${r.note}; label ${predicted === null ? "none" : JSON.stringify(predicted)}, expected ${JSON.stringify(labeled.expected)}`,
    });
  }
  detail.push(...checks.map((ch) => {
    if (ch.kind === "state") {
      const want = String(ch.equals ?? "done");
      return { kind: "state", ok: runState === want, note: `run ended ${runState}, wanted ${want}` };
    }
    if (ch.kind === "contains") {
      const ok = blob.includes(String(ch.value).toLowerCase());
      return { kind: "contains", ok, note: `"${ch.value}" ${ok ? "found" : "missing"} in result` };
    }
    if (ch.kind === "not_contains") {
      const ok = !blob.includes(String(ch.value).toLowerCase());
      return { kind: "not_contains", ok, note: `"${ch.value}" ${ok ? "absent" : "present"} in result` };
    }
    // field: dot-path into the result object
    let at: unknown = result;
    for (const part of String(ch.path).split(".")) {
      at = at && typeof at === "object" ? (at as Record<string, unknown>)[part] : undefined;
    }
    const ok = String(at ?? "").toLowerCase() === String(ch.equals ?? "").toLowerCase();
    return { kind: "field", ok, note: `${ch.path} = ${JSON.stringify(at)}, wanted ${JSON.stringify(ch.equals)}` };
  }));
  // A run that did not finish fails unless a state check says otherwise.
  if (!checks.some((c) => c.kind === "state") && runState !== "done") {
    detail.push({ kind: "state", ok: false, note: `run ended ${runState}` });
  }
  return { passed: detail.every((d) => d.ok), predicted, detail };
}
