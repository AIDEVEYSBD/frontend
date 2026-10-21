import path from "node:path";
import { validateLabels, type Labels } from "@/lib/metrics";

/**
 * Eval-set shapes and validation, for the console's eval-set door
 * (/api/evals). Running a set, and grading its cases, is the backend's since
 * phase L8 (`POST /api/agents/{id}/evals/run`, backend/app/evals.py with the
 * console's grading ported to backend/app/grading.py): a deploy gate trusts
 * only a score the backend produced itself, so the console's runner and its
 * grader are retired.
 */

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
