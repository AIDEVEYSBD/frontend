/**
 * Labeled evals: the general template and the math.
 *
 * A benchmark may declare a label space. Each case then carries the label it
 * expects, and a deterministic reducer maps the agent's raw output to the
 * label it produced. Counting matches gives an n×n confusion matrix, with one
 * extra column for outputs that resolved to no label at all; every metric
 * anyone asks for (per-class precision, recall, F1, accuracy, macro and micro
 * averages) is a pure function over that matrix. Nothing here touches the
 * runtime, so client and server derive identical numbers from identical
 * counts.
 */

export type Reducer =
  /** Read a dot-path from the result and match it to a label. */
  | { kind: "field"; path: string }
  /** Read a number from the result; ordered cut points bucket it into the
   *  label space (ascending). n labels need n-1 cuts. */
  | { kind: "threshold"; path: string; cuts: number[] }
  /** One regular expression per label, tested against the result text in
   *  label-space order; first match wins. */
  | { kind: "match"; patterns: Record<string, string> };

export interface Labels {
  /** The finite label space. Order matters for threshold and match reducers. */
  space: string[];
  /** The class F1 is reported against. Optional; macro-F1 is the headline otherwise. */
  positive?: string;
  reducer: Reducer;
}

export interface Matrix {
  labels: string[];
  /** counts[expected][predicted]; the final column is "no valid label". */
  counts: number[][];
}

export interface ClassMetrics {
  label: string;
  tp: number;
  fp: number;
  tn: number;
  fn: number;
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

export interface Metrics {
  total: number;
  invalid: number;
  accuracy: number;
  macroF1: number;
  microF1: number;
  classes: ClassMetrics[];
  /** The positive class's row when one is declared. */
  positive: ClassMetrics | null;
  /** Positive-class F1 when declared, macro-F1 otherwise. */
  headlineF1: number;
  headlineKind: "positive" | "macro";
}

export const INVALID = "no label";

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

function at(result: unknown, path: string): unknown {
  let cur: unknown = result;
  for (const part of path.split(".").filter(Boolean)) {
    cur = cur && typeof cur === "object" ? (cur as Record<string, unknown>)[part] : undefined;
  }
  return cur;
}

/** Map a raw result to a label in the space, or null when it resolves to none. */
export function reduce(result: unknown, labels: Labels): { label: string | null; note: string } {
  const r = labels.reducer;
  const space = labels.space;
  if (r.kind === "field") {
    const v = at(result, r.path);
    const hit = space.find((l) => norm(l) === norm(v));
    return { label: hit ?? null, note: `${r.path} = ${JSON.stringify(v ?? null)}` };
  }
  if (r.kind === "threshold") {
    const v = Number(at(result, r.path));
    if (!Number.isFinite(v)) return { label: null, note: `${r.path} is not a number` };
    let i = 0;
    while (i < r.cuts.length && v >= r.cuts[i]) i++;
    return { label: space[i] ?? null, note: `${r.path} = ${v}` };
  }
  const text = typeof result === "string" ? result : JSON.stringify(result ?? "");
  for (const l of space) {
    const p = r.patterns[l];
    if (!p) continue;
    try {
      if (new RegExp(p, "i").test(text)) return { label: l, note: `matched /${p}/i` };
    } catch {
      return { label: null, note: `bad pattern for ${l}` };
    }
  }
  return { label: null, note: "no pattern matched" };
}

export function emptyMatrix(labels: string[]): Matrix {
  return { labels, counts: labels.map(() => new Array(labels.length + 1).fill(0)) };
}

export function tally(m: Matrix, expected: string, predicted: string | null): void {
  const i = m.labels.indexOf(expected);
  if (i < 0) return;
  const j = predicted === null ? m.labels.length : m.labels.indexOf(predicted);
  m.counts[i][j < 0 ? m.labels.length : j] += 1;
}

const safe = (n: number, d: number) => (d > 0 ? n / d : 0);

export function derive(m: Matrix, positive?: string): Metrics {
  const n = m.labels.length;
  const total = m.counts.reduce((s, row) => s + row.reduce((a, b) => a + b, 0), 0);
  const invalid = m.counts.reduce((s, row) => s + row[n], 0);
  let trace = 0;
  const classes: ClassMetrics[] = m.labels.map((label, i) => {
    const tp = m.counts[i][i];
    const rowSum = m.counts[i].reduce((a, b) => a + b, 0);
    const colSum = m.counts.reduce((s, row) => s + row[i], 0);
    const fn = rowSum - tp;
    const fp = colSum - tp;
    const tn = total - tp - fn - fp;
    const precision = safe(tp, tp + fp);
    const recall = safe(tp, tp + fn);
    trace += tp;
    return {
      label, tp, fp, tn, fn, precision, recall,
      f1: safe(2 * precision * recall, precision + recall),
      support: rowSum,
    };
  });
  const sumTp = classes.reduce((s, c) => s + c.tp, 0);
  const sumFp = classes.reduce((s, c) => s + c.fp, 0) + invalid; // an invalid output is a false prediction
  const sumFn = classes.reduce((s, c) => s + c.fn, 0);
  const microP = safe(sumTp, sumTp + sumFp);
  const microR = safe(sumTp, sumTp + sumFn);
  const pos = positive ? (classes.find((c) => c.label === positive) ?? null) : null;
  const macroF1 = safe(classes.reduce((s, c) => s + c.f1, 0), classes.length);
  return {
    total,
    invalid,
    accuracy: safe(trace, total),
    macroF1,
    microF1: safe(2 * microP * microR, microP + microR),
    classes,
    positive: pos,
    headlineF1: pos ? pos.f1 : macroF1,
    headlineKind: pos ? "positive" : "macro",
  };
}

/** Validate a labels block from an uploaded set. Returns the block or an error. */
export function validateLabels(raw: unknown): Labels | string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const l = raw as Partial<Labels>;
  if (typeof l !== "object") return "`labels` must be an object";
  const space = Array.isArray(l.space) ? l.space.map((s) => String(s).trim()).filter(Boolean) : [];
  if (space.length < 2) return "`labels.space` needs at least two labels";
  if (new Set(space.map(norm)).size !== space.length) return "`labels.space` has duplicate labels";
  if (l.positive !== undefined && l.positive !== "" && !space.includes(String(l.positive))) {
    return `\`labels.positive\` (${JSON.stringify(l.positive)}) is not in the label space`;
  }
  const r = l.reducer as Partial<Reducer> | undefined;
  if (!r || typeof r !== "object") return "`labels.reducer` is required — how does the output become a label?";
  if (r.kind === "field") {
    if (!r.path) return "a field reducer needs `path`";
    return { space, positive: l.positive || undefined, reducer: { kind: "field", path: String(r.path) } };
  }
  if (r.kind === "threshold") {
    const cuts = Array.isArray(r.cuts) ? r.cuts.map(Number) : [];
    if (!r.path) return "a threshold reducer needs `path`";
    if (cuts.length !== space.length - 1 || cuts.some((c) => !Number.isFinite(c))) {
      return `a threshold reducer over ${space.length} labels needs exactly ${space.length - 1} numeric cuts`;
    }
    for (let i = 1; i < cuts.length; i++) if (cuts[i] <= cuts[i - 1]) return "threshold cuts must ascend";
    return { space, positive: l.positive || undefined, reducer: { kind: "threshold", path: String(r.path), cuts } };
  }
  if (r.kind === "match") {
    const patterns = r.patterns && typeof r.patterns === "object" ? r.patterns : {};
    const clean: Record<string, string> = {};
    for (const s of space) {
      const p = String((patterns as Record<string, unknown>)[s] ?? "").trim();
      if (!p) return `a match reducer needs a pattern for every label — missing ${JSON.stringify(s)}`;
      try {
        new RegExp(p, "i");
      } catch {
        return `the pattern for ${JSON.stringify(s)} is not a valid regular expression`;
      }
      clean[s] = p;
    }
    return { space, positive: l.positive || undefined, reducer: { kind: "match", patterns: clean } };
  }
  return "`labels.reducer.kind` must be field, threshold, or match";
}

/**
 * The general template handed to authors: a labeled benchmark with every
 * declaration the platform needs, filled with a neutral example.
 */
export function labeledTemplate(agent: string, inputKeys: string[]): object {
  const input = Object.fromEntries(inputKeys.map((k) => [k, `the ${k} for this case`]));
  return {
    id: `${agent || "agent"}-labeled-benchmark`,
    agent: agent || "your-agent-id",
    name: "Labeled benchmark",
    model: "",
    labels: {
      space: ["negative", "positive"],
      positive: "positive",
      reducer: { kind: "field", path: "recorded.disposition" },
    },
    cases: [
      { id: "clear-positive", note: "What this case proves", input, expected: "positive" },
      { id: "clear-negative", note: "The other side of the boundary", input, expected: "negative" },
    ],
    _guide: {
      "labels.space": "Every label the agent may produce, in order. Two or more. Any domain: pass/fail, low/medium/high, meets-spec/does-not.",
      "labels.positive": "Optional. The class F1 is reported against. Omit for macro-F1.",
      "labels.reducer": "How a raw result becomes a label. field: read a dot-path. threshold: {path, cuts:[...]} buckets a number into the space. match: {patterns:{label: regex}} tests the result text.",
      "cases[].expected": "The label this case's ground truth carries. Must be in labels.space.",
      "cases[].checks": "Optional extra deterministic checks; a case passes when its label matches and every check holds.",
    },
  };
}
