"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, IconButton, Label, Mono, Tag } from "./ui";
import { Icon } from "./builder/icons";
import { useModels } from "@/lib/use-models";
import { Pick, PickMany } from "./select";
import { Field, Input, Switch, Textarea } from "./forms";
import { Banner } from "./overlays";
import { fromDocument, inputKeysOf, type Kind } from "@/lib/spec";
import { derive, labeledTemplate, INVALID, type Labels, type Matrix, type Reducer } from "@/lib/metrics";
import { TriangleGlyph, bestOf, logScore } from "./tradeoff";
import { CAT } from "./charts";

/**
 * Evals: build a benchmark beside an agent, run it, keep the score.
 *
 * The builder is a form, not a JSON pasting exercise: pick the agent and the
 * case inputs are derived from its own spec, checks are chosen from a menu,
 * and the default model is part of the set — so "run the benchmark" means
 * the same thing every time. Every case is a real run — same runtime, same
 * journal, same policy engine — graded deterministically, and every score is
 * stamped with the spec digest it measured.
 */

/* ═══════════════════ shapes ═══════════════════ */

interface SetRow {
  id: string;
  agent: string;
  name: string;
  model: string;
  n: number;
  labeled?: boolean;
  latest: { passed: number; total: number; model: string; at: string; matrix?: Matrix | null } | null;
}

interface Check {
  kind: "contains" | "not_contains" | "field" | "state";
  value?: string;
  path?: string;
  equals?: unknown;
}

interface EvalCase {
  id: string;
  note?: string;
  input: Record<string, unknown>;
  checks: Check[];
  expected?: string;
}

interface CaseResult {
  id: string;
  note: string;
  passed: boolean;
  state: string;
  error: string;
  checks: { kind: string; ok: boolean; note: string }[];
  expected?: string;
  predicted?: string | null;
  duration_ms: number;
  run_file: string;
}

interface HistoryRow {
  id: string;
  model: string;
  digest: string;
  passed: number;
  total: number;
  results: CaseResult[];
  matrix?: Matrix | null;
  summary?: {
    batch_id?: string; forced?: boolean; compare?: boolean; tier?: "small" | "medium" | "large" | null;
    avg_ms?: number; tokens?: { in: number; out: number }; model_calls?: number;
    cost_total?: number | null; cost_per_case?: number | null; incumbent?: string;
  } | null;
  at: string;
}

interface FullSet {
  id: string;
  agent: string;
  name: string;
  model: string;
  labels?: Labels;
  cases: EvalCase[];
}

const REDUCER_KINDS = [
  { value: "field", label: "Read a result field" },
  { value: "threshold", label: "Bucket a number by cut points" },
  { value: "match", label: "Match a pattern per label" },
] as const;

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

const CHECK_KINDS = [
  { value: "contains", label: "Result contains" },
  { value: "not_contains", label: "Result must not contain" },
  { value: "field", label: "Field equals" },
  { value: "state", label: "Run ends as" },
] as const;

const STATE_OPTS = [
  { value: "done", label: "done" },
  { value: "failed", label: "failed" },
  { value: "suspended", label: "suspended (awaiting a person)" },
  { value: "killed", label: "killed" },
];

const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "benchmark";

/**
 * A comma-separated list that commits on blur rather than per keystroke, so
 * a trailing ", " survives typing. The text re-seeds when the committed
 * value changes underneath it (JSON import, toggling labels).
 */
function ListInput({
  value,
  onCommit,
  placeholder,
}: {
  value: string;
  onCommit: (text: string) => void;
  placeholder?: string;
}) {
  const [text, setText] = useState(value);
  const [seed, setSeed] = useState(value);
  if (seed !== value) {
    setSeed(value);
    setText(value);
  }
  return (
    <div onBlur={() => onCommit(text)}>
      <Input mono value={text} onChange={setText} placeholder={placeholder} />
    </div>
  );
}

/** A check or cross beside a pass/fail word, so the state survives without colour. */
function MarkGlyph({ ok }: { ok: boolean }) {
  return (
    <svg
      width="9"
      height="9"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mr-1 inline-block -translate-y-px"
      aria-hidden
    >
      {ok ? <path d="M4 13l5 5 11-13" /> : <path d="M6 6l12 12M18 6L6 18" />}
    </svg>
  );
}

/* ── CSV round-trip: template out, filled sheet back in ──
   One row per case; check columns are optional and skip when empty. */

const csvEscape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function csvTemplate(inputKeys: { name: string }[], labels?: Labels): string {
  const head = [
    "id",
    "note",
    ...inputKeys.map((k) => `input:${k.name}`),
    ...(labels ? ["expected"] : []),
    "check_contains",
    "check_not_contains",
    "check_field_path",
    "check_field_equals",
    "check_state",
  ];
  const example = [
    "first-case",
    "What this case proves",
    ...inputKeys.map(() => "the input for this case"),
    ...(labels ? [labels.positive ?? labels.space[0]] : []),
    labels ? "" : "text the result must include",
    "",
    labels ? "" : "recorded.disposition",
    labels ? "" : "escalate",
    labels ? "" : "done",
  ];
  const rows = [head.join(","), example.map(csvEscape).join(",")];
  if (labels) {
    rows.push(
      [
        "second-case", "The other side of the boundary",
        ...inputKeys.map(() => "the input for this case"),
        labels.space.find((l) => l !== (labels.positive ?? labels.space[0])) ?? labels.space[1],
        "", "", "", "", "",
      ].map(csvEscape).join(","),
    );
  }
  return rows.join("\n") + "\n";
}

/** Minimal quote-aware CSV parser — enough for the template it hands out. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

function casesFromCsv(text: string): EvalCase[] | string {
  const rows = parseCsv(text);
  if (rows.length < 2) return "the sheet needs a header row and at least one case row";
  const head = rows[0].map((h) => h.trim());
  const col = (name: string) => head.indexOf(name);
  const inputCols = head
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h.startsWith("input:"))
    .map(({ h, i }) => ({ key: h.slice(6), i }));
  if (!inputCols.length) return "no input:<field> columns found — download the template for this agent first";

  return rows.slice(1).map((r, n) => {
    const get = (i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
    const checks: Check[] = [];
    if (get(col("check_contains"))) checks.push({ kind: "contains", value: get(col("check_contains")) });
    if (get(col("check_not_contains"))) checks.push({ kind: "not_contains", value: get(col("check_not_contains")) });
    if (get(col("check_field_path"))) {
      checks.push({ kind: "field", path: get(col("check_field_path")), equals: get(col("check_field_equals")) });
    }
    if (get(col("check_state"))) checks.push({ kind: "state", equals: get(col("check_state")) });
    const expected = get(col("expected"));
    return {
      id: slug(get(col("id")) || `case-${n + 1}`),
      note: get(col("note")),
      input: Object.fromEntries(inputCols.map(({ key, i }) => [key, get(i)])),
      // A labeled row needs no check; an unlabeled one must at least finish.
      checks: checks.length ? checks : expected ? [] : [{ kind: "state", equals: "done" }],
      ...(expected ? { expected } : {}),
    };
  });
}

/* ═══════════════════ page ═══════════════════ */

export function Evals() {
  const params = useSearchParams();
  const [sets, setSets] = useState<SetRow[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(params.get("set"));
  const [building, setBuilding] = useState<FullSet | "new" | null>(
    params.get("agent") ? "new" : null,
  );

  const refresh = useCallback(async () => {
    try {
      const d = await (await fetch("/api/evals")).json();
      setSets(d.sets ?? []);
    } catch {
      setSets([]);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-8">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">Evals</h1>
          <p className="max-w-[66ch] text-[12.5px] leading-[1.55] text-dim">
            A benchmark lives beside its agent. Every case is a real run — same runtime, same
            journal, same guardrails — graded deterministically, and every score is stamped with
            the spec digest it measured.
          </p>
        </div>
        <span className="grow" />
        {!building && (
          <Button variant="solid" tone="ink" size="sm" onClick={() => setBuilding("new")}>
            New benchmark
          </Button>
        )}
      </div>

      {building && (
        <SetBuilder
          initial={building === "new" ? null : building}
          presetAgent={params.get("agent")}
          onDone={(id) => {
            setBuilding(null);
            refresh();
            if (id) setOpenId(id);
          }}
        />
      )}

      <div className="mt-6 flex flex-col gap-3">
        {sets === null && <p className="text-[12.5px] text-faint">Reading the benchmarks…</p>}
        {sets?.length === 0 && !building && (
          <div className="flex flex-col items-start gap-3 rounded-md border border-dashed border-line-strong bg-surface px-5 py-6">
            <p className="text-[13px] font-medium text-fg">No benchmarks yet.</p>
            <p className="max-w-[60ch] text-[12px] leading-[1.6] text-dim">
              Pick an agent, describe what a right answer looks like, and every future change to
              that agent can be measured instead of eyeballed.
            </p>
            <Button size="sm" variant="solid" onClick={() => setBuilding("new")}>
              Build the first one
            </Button>
          </div>
        )}
        {(sets ?? []).map((s) => (
          <SetCard
            key={s.id}
            row={s}
            open={openId === s.id}
            onToggle={() => setOpenId(openId === s.id ? null : s.id)}
            onChanged={refresh}
            onEdit={async () => {
              const d = await (await fetch(`/api/evals?id=${encodeURIComponent(s.id)}`)).json();
              if (d.set) setBuilding(d.set as FullSet);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════ the set builder ═══════════════════ */

interface AgentOpt {
  id: string;
  name: string;
}

function blankCase(n: number, keys: { name: string }[], labels?: Labels | null): EvalCase {
  return {
    id: `case-${n}`,
    note: "",
    input: Object.fromEntries(keys.map((k) => [k.name, ""])),
    checks: labels ? [] : [{ kind: "contains", value: "" }],
    ...(labels ? { expected: labels.space[0] } : {}),
  };
}

const blankLabels = (): Labels => ({
  space: ["negative", "positive"],
  positive: "positive",
  reducer: { kind: "field", path: "" },
});

function SetBuilder({
  initial,
  presetAgent,
  onDone,
}: {
  initial: FullSet | null;
  presetAgent: string | null;
  onDone: (id: string | null) => void;
}) {
  const { models } = useModels();
  const [agents, setAgents] = useState<AgentOpt[]>([]);
  const [agent, setAgent] = useState(initial?.agent ?? presetAgent ?? "");
  const [name, setName] = useState(initial?.name ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  const [labels, setLabels] = useState<Labels | null>(initial?.labels ?? null);
  const [cases, setCases] = useState<EvalCase[]>(initial?.cases ?? []);
  const [inputKeys, setInputKeys] = useState<{ name: string; kind: Kind }[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const csvRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d) => setAgents((d.agents ?? []).map((a: AgentOpt) => ({ id: a.id, name: a.name }))))
      .catch(() => setAgents([]));
  }, []);

  /* The agent's spec names its own inputs — derive the case form from it. */
  useEffect(() => {
    if (!agent) {
      setInputKeys([]);
      return;
    }
    let stop = false;
    fetch(`/api/agents?id=${encodeURIComponent(agent)}`)
      .then((r) => r.json())
      .then((d) => {
        if (stop || !d.spec) return;
        const keys = inputKeysOf(fromDocument(d.spec));
        setInputKeys(keys);
        setCases((cs) =>
          cs.length
            ? cs.map((c) => ({
                ...c,
                input: { ...Object.fromEntries(keys.map((k) => [k.name, ""])), ...c.input },
              }))
            : [blankCase(1, keys)],
        );
        setName((n) => n || `${d.spec?.metadata?.name ?? agent} benchmark`);
      })
      .catch(() => !stop && setInputKeys([]));
    return () => {
      stop = true;
    };
  }, [agent]);

  const patchCase = (i: number, patch: Partial<EvalCase>) =>
    setCases((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  /* Turning labels on gives every case a default expected label; turning
     them off strips it and restores a check so the case still grades. */
  const toggleLabels = (on: boolean) => {
    if (on) {
      const l = blankLabels();
      setLabels(l);
      setCases((cs) => cs.map((c) => ({ ...c, expected: c.expected ?? l.space[0] })));
    } else {
      setLabels(null);
      setCases((cs) =>
        cs.map((c) => {
          const { expected: _drop, ...rest } = c;
          void _drop;
          return { ...rest, checks: rest.checks.length ? rest.checks : [{ kind: "contains", value: "" }] };
        }),
      );
    }
  };

  const patchLabels = (patch: Partial<Labels>) => setLabels((l) => l && { ...l, ...patch });

  const setSpace = (text: string) => {
    const space = text.split(",").map((s) => s.trim()).filter(Boolean);
    setLabels((l) => {
      if (!l) return l;
      const positive = l.positive && space.includes(l.positive) ? l.positive : undefined;
      const reducer: Reducer =
        l.reducer.kind === "threshold"
          ? { ...l.reducer, cuts: l.reducer.cuts.slice(0, Math.max(0, space.length - 1)) }
          : l.reducer.kind === "match"
            ? { kind: "match", patterns: Object.fromEntries(space.map((s) => [s, l.reducer.kind === "match" ? (l.reducer.patterns[s] ?? "") : ""])) }
            : l.reducer;
      return { ...l, space, positive, reducer };
    });
  };

  const download = (filename: string, text: string, type: string) => {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const set = {
        id: initial?.id ?? slug(name || `${agent}-bench`),
        agent,
        name: name || `${agent} benchmark`,
        model,
        ...(labels ? { labels: { ...labels, positive: labels.positive || undefined } } : {}),
        cases: cases.map((c, i) => ({
          ...c,
          id: c.id.trim() || `case-${i + 1}`,
          checks: c.checks.filter(
            (ch) => ch.kind === "state" || (ch.kind === "field" ? ch.path : ch.value),
          ),
        })),
      };
      const res = await fetch("/api/evals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ set }),
      });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(String(d.error ?? res.status));
      onDone(d.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const importJson = () => {
    try {
      const s = JSON.parse(jsonText) as FullSet;
      if (s.agent) setAgent(s.agent);
      if (s.name) setName(s.name);
      if (s.model) setModel(s.model);
      setLabels(s.labels ?? null);
      if (Array.isArray(s.cases)) setCases(s.cases);
      setShowJson(false);
      setError("");
    } catch (e) {
      setError(`not valid JSON — ${(e as Error).message}`);
    }
  };

  return (
    <div className="mt-5 flex flex-col gap-4 rounded-md border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[13.5px] font-semibold text-fg">
          {initial ? `Edit — ${initial.name}` : "New benchmark"}
        </span>
        <span className="grow" />
        {agent && (
          <>
            <Button
              size="sm"
              variant="solid"
              onClick={() =>
                download(`${agent}-benchmark-template.csv`, csvTemplate(inputKeys, labels ?? undefined), "text/csv")
              }
            >
              CSV template
            </Button>
            <Button
              size="sm"
              variant="solid"
              onClick={() =>
                download(
                  `${agent}-labeled-benchmark-template.json`,
                  JSON.stringify(labeledTemplate(agent, inputKeys.map((k) => k.name)), null, 2) + "\n",
                  "application/json",
                )
              }
            >
              Labeled template
            </Button>
            <input
              ref={csvRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const parsed = casesFromCsv(await f.text());
                if (typeof parsed === "string") setError(parsed);
                else {
                  setCases(parsed);
                  setError("");
                }
                e.target.value = "";
              }}
            />
            <Button size="sm" variant="solid" onClick={() => csvRef.current?.click()}>
              Upload CSV
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="solid"
          onClick={() => {
            setShowJson((v) => !v);
            setJsonText(JSON.stringify({ id: initial?.id, agent, name, model, ...(labels ? { labels } : {}), cases }, null, 2));
          }}
        >
          {showJson ? "Back to the form" : "Edit as JSON"}
        </Button>
        <Button size="sm" variant="solid" tone="err" onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
      {agent && (
        <p className="text-[11px] leading-[1.5] text-faint">
          CSV template — a spreadsheet with this agent&apos;s input columns; fill a row per case and upload it
          back. Labeled template — label space, positive class, reducer, and cases with expected labels; fill it,
          then paste it into Edit as JSON.
        </p>
      )}

      {showJson ? (
        <>
          <Textarea value={jsonText} onChange={setJsonText} rows={14} mono aria-label="Benchmark as JSON" />
          <div className="flex items-center gap-3">
            {error && <span className="text-[11.5px] text-err">{error}</span>}
            <span className="grow" />
            <Button size="sm" variant="solid" onClick={importJson}>
              Apply to the form
            </Button>
          </div>
        </>
      ) : (
        <>
          {/* who and how */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Agent under test">
              <Pick
                value={agent}
                onChange={setAgent}
                options={[
                  { value: "", label: "Choose an agent…" },
                  ...agents.map((a) => ({ value: a.id, label: a.name })),
                ]}
              />
            </Field>
            <Field label="Benchmark name">
              <Input value={name} onChange={setName} placeholder="Disposition accuracy" />
            </Field>
            <Field label="Runs on">
              <Pick
                value={model}
                onChange={setModel}
                options={[
                  { value: "", label: "Deployment default model" },
                  ...models.map((m) => ({ value: m.id, label: m.label })),
                ]}
              />
            </Field>
          </div>

          {!agent && (
            <p className="text-[12px] text-faint">
              Pick the agent first — its spec names the inputs each case needs, so the form builds
              itself.
            </p>
          )}

          {/* the label template: space, positive class, reducer */}
          {agent && (
            <div className="flex flex-col gap-3 rounded-md border border-line bg-canvas/60 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <Switch label="Labeled benchmark" checked={!!labels} onChange={toggleLabels} />
                <span className="text-[11.5px] text-faint">
                  Each case carries a ground-truth label. Runs return a confusion matrix; precision,
                  recall and F1 are derived from it.
                </span>
              </div>

              {labels && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <Field label="Label space, in order">
                      <ListInput value={labels.space.join(", ")} onCommit={setSpace} placeholder="low, medium, high" />
                    </Field>
                  </div>
                  <Field label="Positive class (for F1)">
                    <Pick
                      value={labels.positive ?? ""}
                      onChange={(v) => patchLabels({ positive: v || undefined })}
                      options={[
                        { value: "", label: "None — report macro-F1" },
                        ...labels.space.map((s) => ({ value: s, label: s })),
                      ]}
                    />
                  </Field>
                  <Field label="Output becomes a label by">
                    <Pick
                      value={labels.reducer.kind}
                      onChange={(kind) =>
                        patchLabels({
                          reducer:
                            kind === "threshold"
                              ? { kind: "threshold", path: "", cuts: labels.space.slice(1).map((_, i) => i + 1) }
                              : kind === "match"
                                ? { kind: "match", patterns: Object.fromEntries(labels.space.map((s) => [s, ""])) }
                                : { kind: "field", path: "" },
                        })
                      }
                      options={REDUCER_KINDS.map((k) => ({ value: k.value, label: k.label }))}
                    />
                  </Field>
                  {(labels.reducer.kind === "field" || labels.reducer.kind === "threshold") && (
                    <Field label="Result path">
                      <Input
                        mono
                        value={labels.reducer.path}
                        onChange={(v) => patchLabels({ reducer: { ...labels.reducer, path: v } as Reducer })}
                        placeholder="recorded.disposition"
                      />
                    </Field>
                  )}
                  {labels.reducer.kind === "threshold" && (
                    <Field label={`Cut points (${labels.space.length - 1}, ascending)`}>
                      <ListInput
                        value={labels.reducer.cuts.join(", ")}
                        onCommit={(text) =>
                          patchLabels({
                            reducer: {
                              kind: "threshold",
                              path: labels.reducer.kind === "threshold" ? labels.reducer.path : "",
                              cuts: text.split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n)),
                            },
                          })
                        }
                        placeholder="0.33, 0.66"
                      />
                    </Field>
                  )}
                  {labels.reducer.kind === "match" && (
                    <div className="flex flex-col gap-1.5 sm:col-span-3">
                      <span className="text-[11px] font-semibold text-dim">
                        One regular expression per label, tested in order against the result text
                      </span>
                      {labels.space.map((s) => (
                        <div key={s} className="flex items-center gap-2">
                          <Mono className="w-28 shrink-0 truncate text-[11px] text-dim">{s}</Mono>
                          <div className="min-w-0 grow">
                            <Input
                              mono
                              value={labels.reducer.kind === "match" ? (labels.reducer.patterns[s] ?? "") : ""}
                              onChange={(v) =>
                                patchLabels({
                                  reducer: {
                                    kind: "match",
                                    patterns: {
                                      ...(labels.reducer.kind === "match" ? labels.reducer.patterns : {}),
                                      [s]: v,
                                    },
                                  },
                                })
                              }
                              placeholder={`\\b${s}\\b`}
                              aria-label={`Pattern for ${s}`}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* the cases */}
          {agent &&
            cases.map((c, i) => (
              <div key={i} className="flex flex-col gap-3 rounded-md border border-line bg-canvas/60 p-3">
                <div className="flex items-center gap-2.5">
                  <span className="grid size-6 shrink-0 place-items-center rounded-md bg-raise font-mono text-[10.5px] text-dim">
                    {i + 1}
                  </span>
                  <div className="w-44 shrink-0">
                    <Input mono value={c.id} onChange={(v) => patchCase(i, { id: slug(v) })} aria-label="Case id" />
                  </div>
                  <div className="min-w-0 grow">
                    <Input
                      value={c.note ?? ""}
                      onChange={(v) => patchCase(i, { note: v })}
                      placeholder="What this case proves (shown in results)"
                      aria-label="Case note"
                    />
                  </div>
                  <IconButton
                    size="sm"
                    label="Duplicate case"
                    className="hover:text-fg"
                    onClick={() =>
                      setCases((cs) => [
                        ...cs.slice(0, i + 1),
                        { ...structuredClone(c), id: `${c.id}-copy` },
                        ...cs.slice(i + 1),
                      ])
                    }
                  >
                    <Icon name="layers" size={13} />
                  </IconButton>
                  <IconButton
                    size="sm"
                    label="Remove case"
                    className="hover:text-err"
                    disabled={cases.length === 1}
                    onClick={() => setCases((cs) => cs.filter((_, j) => j !== i))}
                  >
                    <Icon name="cross" size={13} />
                  </IconButton>
                </div>

                {/* inputs, derived from the spec */}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(inputKeys.length ? inputKeys : [{ name: "input", kind: "string" as Kind }]).map(
                    (k) => (
                      <Field key={k.name} label={k.name}>
                        <Textarea
                          value={String(c.input[k.name] ?? "")}
                          onChange={(v) => patchCase(i, { input: { ...c.input, [k.name]: v } })}
                          rows={2}
                        />
                      </Field>
                    ),
                  )}
                </div>

                {/* ground truth, when the set is labeled */}
                {labels && (
                  <div className="flex items-center gap-2">
                    <Label>Expected label</Label>
                    <div className="w-52">
                      <Pick
                        value={c.expected ?? labels.space[0]}
                        onChange={(v) => patchCase(i, { expected: v })}
                        options={labels.space.map((s) => ({ value: s, label: s }))}
                        aria-label="Expected label"
                      />
                    </div>
                  </div>
                )}

                {/* checks */}
                <div className="flex flex-col gap-1.5">
                  <Label>{labels ? "Also passes only when" : "Passes when"}</Label>
                  {c.checks.map((ch, j) => (
                    <div key={j} className="flex flex-wrap items-center gap-2">
                      <div className="w-52">
                        <Pick
                          value={ch.kind}
                          onChange={(kind) =>
                            patchCase(i, {
                              checks: c.checks.map((x, y) =>
                                y === j
                                  ? kind === "state"
                                    ? { kind: "state" as const, equals: "done" }
                                    : kind === "field"
                                      ? { kind: "field" as const, path: "", equals: "" }
                                      : { kind: kind as Check["kind"], value: "" }
                                  : x,
                              ),
                            })
                          }
                          options={CHECK_KINDS.map((k) => ({ value: k.value, label: k.label }))}
                        />
                      </div>
                      {ch.kind === "field" && (
                        <>
                          <div className="w-64">
                            <Input
                              mono
                              value={ch.path ?? ""}
                              onChange={(v) =>
                                patchCase(i, {
                                  checks: c.checks.map((x, y) => (y === j ? { ...x, path: v } : x)),
                                })
                              }
                              placeholder="result path, e.g. recorded.disposition"
                              aria-label="Result path"
                            />
                          </div>
                          <div className="w-44">
                            <Input
                              value={String(ch.equals ?? "")}
                              onChange={(v) =>
                                patchCase(i, {
                                  checks: c.checks.map((x, y) => (y === j ? { ...x, equals: v } : x)),
                                })
                              }
                              placeholder="expected value"
                              aria-label="Expected value"
                            />
                          </div>
                        </>
                      )}
                      {(ch.kind === "contains" || ch.kind === "not_contains") && (
                        <div className="min-w-0 grow">
                          <Input
                            value={ch.value ?? ""}
                            onChange={(v) =>
                              patchCase(i, {
                                checks: c.checks.map((x, y) => (y === j ? { ...x, value: v } : x)),
                              })
                            }
                            placeholder="text to look for in the result"
                            aria-label="Text to look for in the result"
                          />
                        </div>
                      )}
                      {ch.kind === "state" && (
                        <div className="w-64">
                          <Pick
                            value={String(ch.equals ?? "done")}
                            onChange={(v) =>
                              patchCase(i, {
                                checks: c.checks.map((x, y) => (y === j ? { ...x, equals: v } : x)),
                              })
                            }
                            options={STATE_OPTS}
                          />
                        </div>
                      )}
                      <IconButton
                        size="sm"
                        label="Remove check"
                        className="hover:text-err"
                        disabled={c.checks.length === 1 && !labels}
                        onClick={() =>
                          patchCase(i, { checks: c.checks.filter((_, y) => y !== j) })
                        }
                      >
                        <Icon name="cross" size={12} />
                      </IconButton>
                    </div>
                  ))}
                  <Button
                    size="sm"
                    variant="solid"
                    className="self-start"
                    onClick={() =>
                      patchCase(i, { checks: [...c.checks, { kind: "contains", value: "" }] })
                    }
                  >
                    Add a check
                  </Button>
                </div>
              </div>
            ))}

          {agent && (
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                variant="solid"
                onClick={() => setCases((cs) => [...cs, blankCase(cs.length + 1, inputKeys, labels)])}
              >
                Add a case
              </Button>
              <span className="grow" />
              {error && <span className="max-w-[44ch] truncate text-[11.5px] text-err">{error}</span>}
              <Button
                size="sm"
                variant="solid"
                tone="ink"
                disabled={!agent || !cases.length || busy}
                loading={busy}
                onClick={save}
              >
                {initial ? "Save changes" : "Save benchmark"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ═══════════════════ one set ═══════════════════ */

function SetCard({
  row,
  open,
  onToggle,
  onChanged,
  onEdit,
}: {
  row: SetRow;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
  onEdit: () => void;
}) {
  const [detail, setDetail] = useState<{ runs: HistoryRow[]; labels?: Labels } | null>(null);
  const [live, setLive] = useState<{ done: number; total: number; cases: CaseResult[] } | null>(null);
  const [runError, setRunError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [override, setOverride] = useState("");
  const [compare, setCompare] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [cmp, setCmp] = useState<CompareResult | null>(null);
  const [liveModel, setLiveModel] = useState<string | null>(null);
  const [viewModel, setViewModel] = useState<string | null>(null);
  const { models, defaultModel } = useModels();

  /* The incumbent is what the benchmark runs on today; it is always in the
     comparison. The default pick is its tier and the one below, which is the
     question people actually ask ("can something cheaper do this?"). */
  const incumbent = override || row.model || defaultModel;
  const tierOf = (id: string) => models.find((m) => m.id === id)?.class;
  const TIERS = ["small", "medium", "large"] as const;
  const pickTiers = (tiers: readonly string[]) =>
    [...new Set([incumbent, ...models.filter((m) => m.class && tiers.includes(m.class)).map((m) => m.id)])];
  const tierBelow = () => {
    const t = tierOf(incumbent);
    if (!t) return models.map((m) => m.id);
    const i = TIERS.indexOf(t);
    return pickTiers(i > 0 ? [t, TIERS[i - 1]] : [t]);
  };
  const enableCompare = (on: boolean) => {
    setCompare(on);
    if (on) setPicked(tierBelow());
  };

  const modelLabel = (id: string) =>
    id ? (models.find((m) => m.id === id)?.label ?? id) : "deployment default";

  useEffect(() => {
    if (!open) return;
    let stop = false;
    fetch(`/api/evals?id=${encodeURIComponent(row.id)}`)
      .then((r) => r.json())
      .then((d) => !stop && setDetail({ runs: d.runs ?? [], labels: d.set?.labels ?? undefined }))
      .catch(() => !stop && setDetail({ runs: [] }));
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row.id, live === null]);

  const run = async () => {
    setLive({ done: 0, total: row.n, cases: [] });
    setRunError("");
    setCmp(null);
    setLiveModel(null);
    try {
      const res = await fetch("/api/evals/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          set_id: row.id,
          ...(override ? { model: override } : {}),
          ...(compare ? { compare: { models: picked } } : {}),
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(String((d as { error?: string }).error ?? `HTTP ${res.status}`));
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("no stream");
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const e = JSON.parse(line.slice(6));
          if (e.type === "model.start") {
            // A comparison runs the suite once per candidate; the live table
            // starts over for each so it never mixes two models' cases.
            setLiveModel(String(e.model));
            setLive((s) => s && { ...s, done: 0, cases: [] });
          } else if (e.type === "case.done") {
            setLive((s) => s && { ...s, done: s.done + 1, cases: [...s.cases, e as CaseResult] });
          } else if (e.type === "compare") {
            setCmp(e as CompareResult);
          }
        }
      }
    } catch (e) {
      setRunError((e as Error).message);
    } finally {
      setLive(null);
      setLiveModel(null);
      onChanged();
    }
  };

  const useModel = async (id: string) => {
    const d = await (await fetch(`/api/evals?id=${encodeURIComponent(row.id)}`)).json();
    if (!d.set) return;
    await fetch("/api/evals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ set: { ...d.set, model: id } }),
    });
    onChanged();
  };

  const activeCmp = cmp ?? lastComparison(detail?.runs ?? [], detail?.labels?.positive);
  /* Which compared model's run is on screen: the one picked, else the
     recommendation, else the incumbent, else the latest run of all. */
  const viewRun = (() => {
    if (!activeCmp || !detail?.runs.length) return null;
    const want = viewModel ?? activeCmp.recommended ?? activeCmp.incumbent;
    const m = activeCmp.models.find((x) => x.model === want) ?? activeCmp.models[0];
    const r = m?.run_id ? detail.runs.find((x) => x.id === m.run_id) : undefined;
    return r ? { ...r, model: m.model } : null;
  })();
  const shownRun = viewRun ?? detail?.runs[0] ?? null;

  const score = row.latest;
  const pct = score ? Math.round((score.passed / Math.max(1, score.total)) * 100) : null;
  const headline = score?.matrix ? derive(score.matrix, detail?.labels?.positive) : null;

  return (
    <section className="overflow-hidden rounded-md border border-line bg-surface">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="focusable flex w-full cursor-pointer items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-raise/40"
      >
        <span className="flex min-w-0 grow flex-col gap-0.5">
          <span className="text-[13.5px] font-semibold text-fg">{row.name}</span>
          <span className="truncate font-mono text-[10.5px] text-faint">
            benchmarks <span className="text-dim">{row.agent}</span> · {row.n} case
            {row.n === 1 ? "" : "s"} · runs on {modelLabel(row.model)}
          </span>
        </span>
        {live ? (
          <span className="flex items-center gap-2.5">
            <span className="h-1.5 w-32 overflow-hidden rounded-full bg-raise">
              <span
                className="block h-full rounded-full bg-run transition-[width] duration-[260ms] ease-[var(--ease-out)]"
                style={{ width: `${(live.done / Math.max(1, live.total)) * 100}%` }}
              />
            </span>
            <Mono className="text-[10.5px] text-dim">
              {live.done}/{live.total}
            </Mono>
          </span>
        ) : score ? (
          <span className="flex items-center gap-2">
            {headline && (
              <span className="flex items-baseline gap-1">
                <span className="text-[10px] text-faint">F1</span>
                <span className={`tnum text-[15px] font-semibold ${headline.headlineF1 >= 0.9 ? "text-ok" : headline.headlineF1 >= 0.6 ? "text-warn" : "text-err"}`}>
                  {headline.headlineF1.toFixed(3)}
                </span>
              </span>
            )}
            <span className={`tnum ${headline ? "text-[11.5px] text-dim" : "text-[15px] font-semibold"} ${!headline && pct === 100 ? "text-ok" : !headline && pct! >= 60 ? "text-warn" : !headline ? "text-err" : ""}`}>
              {score.passed}/{score.total}
            </span>
            <span className="text-[10.5px] text-ghost">{ago(score.at)}</span>
          </span>
        ) : (
          <span className="text-[11px] text-faint">never run</span>
        )}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`} aria-hidden>
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t border-line px-4 py-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <Button size="sm" variant="solid" tone="ink" disabled={!!live || (compare && picked.length < 2)} loading={!!live} onClick={run}>
              {live ? "Measuring…" : compare ? `Compare ${picked.length} models` : "Run the benchmark"}
            </Button>
            <span className="text-[11px] text-faint">on</span>
            <div className="w-64">
              <Pick
                value={override}
                onChange={setOverride}
                options={[
                  { value: "", label: `Set default — ${modelLabel(row.model)}` },
                  ...models.map((m) => ({ value: m.id, label: m.class ? `${m.label} · ${m.class}` : m.label })),
                ]}
              />
            </div>
            <span className="ml-2 flex items-center gap-2">
              <Switch label="Compare models" checked={compare} onChange={enableCompare} disabled={!!live} />
              {compare && (
                <div className="w-72">
                  <PickMany
                    values={picked}
                    onChange={setPicked}
                    disabled={!!live}
                    aria-label="Models to compare"
                    placeholder="Pick the models to compare"
                    summary={(c) => `${c.length} model${c.length === 1 ? "" : "s"}: ${c.map((x) => x.label).join(", ")}`}
                    options={models.map((m) => ({
                      value: m.id,
                      label: m.label,
                      note: [m.class, m.id === incumbent ? "incumbent" : ""].filter(Boolean).join(" · "),
                      locked: m.id === incumbent,
                    }))}
                  />
                </div>
              )}
              {compare && (
                <span className="flex items-center gap-1.5">
                  {([
                    ["Same tier", () => setPicked(pickTiers([tierOf(incumbent) ?? ""]))],
                    ["One below", () => setPicked(tierBelow())],
                    ["All", () => setPicked(models.map((m) => m.id))],
                  ] as [string, () => void][]).map(([label, fn]) => (
                    <Button key={label} size="sm" variant="quiet" disabled={!!live} onClick={fn}>
                      {label}
                    </Button>
                  ))}
                </span>
              )}
            </span>
            <span className="grow" />
            <Button size="sm" variant="solid" onClick={onEdit}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="solid"
              tone="err"
              onClick={async () => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  setTimeout(() => setConfirmDelete(false), 3000);
                  return;
                }
                await fetch(`/api/evals?id=${encodeURIComponent(row.id)}`, { method: "DELETE" });
                onChanged();
              }}
            >
              {confirmDelete ? "Click again — history goes too" : "Delete set"}
            </Button>
          </div>

          {runError && (
            <Banner tone="err" title="The benchmark run failed">
              {runError}
            </Banner>
          )}

          {live && liveModel && (
            <p className="text-[11.5px] text-dim">
              Measuring <span className="font-mono text-fg">{modelLabel(liveModel === "default" ? "" : liveModel)}</span>
              {compare ? ", every model call pinned to it" : ""}
            </p>
          )}
          {live && live.cases.length > 0 && <CaseTable cases={live.cases} />}
          {!live && activeCmp && (
            <>
              <Recommendation cmp={activeCmp} models={models} onUse={useModel} currentModel={row.model} onChanged={onChanged} agent={row.agent} />
              <ComparePanel cmp={activeCmp} models={models} onUse={useModel} currentModel={row.model} />
            </>
          )}

          {!live && detail?.runs.length ? (
            <div className="flex flex-col gap-3">
              {activeCmp && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold text-dim">Results for</span>
                  <div className="w-72">
                    <Pick
                      value={viewRun?.model ?? ""}
                      onChange={setViewModel}
                      options={activeCmp.models
                        .filter((m) => m.run_id && detail.runs.some((r) => r.id === m.run_id))
                        .map((m) => ({
                          value: m.model,
                          label: `${modelLabel(m.model === "default" ? "" : m.model)}${m.model === activeCmp.recommended ? " · recommended" : m.model === activeCmp.incumbent ? " · incumbent" : ""}`,
                        }))}
                    />
                  </div>
                  <span className="text-[10.5px] text-faint">the matrix and the cases below are this model's run</span>
                </div>
              )}
              {shownRun?.matrix && (
                <ConfusionPanel matrix={shownRun.matrix} positive={detail.labels?.positive} />
              )}
              <CaseTable cases={shownRun?.results ?? []} />
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-dim">History</span>
                {detail.runs.map((h) => (
                  <div key={h.id} className="flex items-center gap-3 text-[11.5px]">
                    {h.matrix && (
                      <span className="tnum font-semibold text-fg">
                        F1 {derive(h.matrix, detail.labels?.positive).headlineF1.toFixed(3)}
                      </span>
                    )}
                    <span className={`tnum ${h.matrix ? "text-dim" : "font-semibold"} ${!h.matrix && h.passed === h.total ? "text-ok" : !h.matrix ? "text-warn" : ""}`}>
                      {h.passed}/{h.total}
                    </span>
                    <Mono className="text-[10px] text-faint">{modelLabel(h.model === "default" ? "" : h.model)}</Mono>
                    <Mono className="text-[10px] text-ghost">spec {h.digest.slice(0, 8)}</Mono>
                    <span className="text-[10px] text-ghost">{ago(h.at)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : !live ? (
            <p className="text-[12px] text-faint">
              Never run. The first run sets the baseline — every later score compares against it.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

function CaseTable({ cases }: { cases: CaseResult[] }) {
  const [openCase, setOpenCase] = useState<string | null>(null);
  return (
    <div className="overflow-hidden rounded-md border border-line">
      {cases.map((c) => (
        <div key={c.id} className="border-b border-line last:border-b-0">
          <button
            type="button"
            onClick={() => setOpenCase(openCase === c.id ? null : c.id)}
            className="focusable flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-raise/40"
          >
            <span className={`size-1.5 shrink-0 rounded-[2px] ${c.passed ? "bg-ok" : "bg-err"}`} />
            <span className="min-w-0 grow truncate text-[12.5px] font-medium text-fg">{c.id}</span>
            {c.expected !== undefined && (
              <Mono className="hidden shrink-0 text-[10.5px] sm:inline">
                <span className="text-dim">{c.expected}</span>
                <span className="text-ghost"> → </span>
                <span className={c.predicted === c.expected ? "text-ok" : "text-err"}>
                  <MarkGlyph ok={c.predicted === c.expected} />
                  {c.predicted ?? INVALID}
                </span>
              </Mono>
            )}
            {c.note && <span className="hidden truncate text-[11px] text-faint sm:inline">{c.note}</span>}
            <Mono className="shrink-0 text-[10px] text-ghost">{(c.duration_ms / 1000).toFixed(1)}s</Mono>
            <span className={`shrink-0 text-[11px] font-semibold ${c.passed ? "text-ok" : "text-err"}`}>
              {c.passed ? "pass" : "fail"}
            </span>
          </button>
          {openCase === c.id && (
            <div className="flex flex-col gap-1.5 border-t border-line bg-sunken/20 px-3 py-2.5">
              {c.checks.map((ch, i) => (
                <span key={i} className="flex items-baseline gap-2 font-mono text-[10.5px] leading-[1.5]">
                  <span className={`size-1.5 shrink-0 translate-y-[-1px] rounded-[2px] ${ch.ok ? "bg-ok" : "bg-err"}`} />
                  <span className={ch.ok ? "text-ok" : "text-err"}>{ch.kind}</span>
                  <span className="min-w-0 text-dim">{ch.note}</span>
                </span>
              ))}
              {c.error && <span className="font-mono text-[10.5px] text-err">{c.error}</span>}
              <Button
                size="sm"
                variant="solid"
                className="mt-1 self-start"
                href={`/runs?id=${encodeURIComponent(c.run_file)}`}
              >
                <Icon name="pulse" size={11} />
                Open the run behind this score
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ═══════════════════ confusion matrix + derived metrics ═══════════════════ */

/**
 * The matrix is the primitive; everything else is a view over it. Rows are
 * what the case expected, columns what the agent produced, with a final
 * column for outputs that resolved to no label. Cell shading scales within
 * each row so a rare class reads as clearly as a common one.
 */
function ConfusionPanel({ matrix, positive }: { matrix: Matrix; positive?: string }) {
  const m = derive(matrix, positive);
  const n = matrix.labels.length;
  const cols = [...matrix.labels, INVALID];
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[auto_minmax(0,1fr)]">
      <div className="overflow-x-auto rounded-md border border-line bg-canvas/60 p-3">
        <div className="mb-2 flex items-baseline gap-2">
          <span className="text-[11px] font-semibold text-dim">Confusion matrix</span>
          <span className="text-[10.5px] text-faint">rows expected · columns produced</span>
        </div>
        <table className="tnum border-separate border-spacing-0.5 text-[11px]">
          <thead>
            <tr>
              <th />
              {cols.map((c, j) => (
                <th
                  key={c}
                  className={`px-1.5 pb-1 text-center font-mono text-[10px] font-medium ${j === n ? "text-ghost" : "text-dim"}`}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.counts.map((row, i) => {
              const rowMax = Math.max(1, ...row);
              return (
                <tr key={matrix.labels[i]}>
                  <th className="pr-2 text-right font-mono text-[10px] font-medium text-dim">{matrix.labels[i]}</th>
                  {row.map((v, j) => {
                    const diag = i === j;
                    const a = v === 0 ? 0 : 0.12 + 0.55 * (v / rowMax);
                    return (
                      <td
                        key={j}
                        className={`size-9 rounded-[3px] text-center align-middle ${diag ? "font-semibold text-fg ring-1 ring-inset ring-line-strong" : "text-dim"}`}
                        style={{
                          background:
                            v === 0
                              ? "transparent"
                              : diag
                                ? `color-mix(in oklab, var(--t-ok) ${Math.round(a * 100)}%, transparent)`
                                : `color-mix(in oklab, var(--t-err) ${Math.round(a * 100)}%, transparent)`,
                        }}
                        title={`expected ${matrix.labels[i]}, produced ${cols[j]}: ${v}`}
                      >
                        {v}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex min-w-0 flex-col gap-2 rounded-md border border-line bg-canvas/60 p-3">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
          <span className="flex items-baseline gap-1.5">
            <span className="text-[10.5px] text-faint">{m.headlineKind === "positive" ? `F1 · ${positive}` : "macro-F1"}</span>
            <span className="tnum text-[18px] font-semibold text-fg">{m.headlineF1.toFixed(3)}</span>
          </span>
          {[
            ["accuracy", pct(m.accuracy)],
            ["macro-F1", m.macroF1.toFixed(3)],
            ["micro-F1", m.microF1.toFixed(3)],
            ["cases", String(m.total)],
            ["no label", String(m.invalid)],
          ].map(([k, v]) => (
            <span key={k} className="flex items-baseline gap-1.5">
              <span className="text-[10.5px] text-faint">{k}</span>
              <span className="tnum text-[12.5px] font-medium text-fg">{v}</span>
            </span>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="tnum w-full text-[11px]">
            <thead>
              <tr className="text-left text-[10px] text-faint">
                <th className="py-1 pr-3 font-medium">class</th>
                {["TP", "FP", "TN", "FN", "precision", "recall", "F1", "support"].map((h) => (
                  <th key={h} className="py-1 pr-3 text-right font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.classes.map((c) => (
                <tr key={c.label} className={`border-t border-line ${c.label === positive ? "font-medium text-fg" : "text-dim"}`}>
                  <td className="py-1 pr-3 font-mono text-[10.5px]">{c.label}</td>
                  <td className="py-1 pr-3 text-right">{c.tp}</td>
                  <td className="py-1 pr-3 text-right">{c.fp}</td>
                  <td className="py-1 pr-3 text-right">{c.tn}</td>
                  <td className="py-1 pr-3 text-right">{c.fn}</td>
                  <td className="py-1 pr-3 text-right">{c.precision.toFixed(3)}</td>
                  <td className="py-1 pr-3 text-right">{c.recall.toFixed(3)}</td>
                  <td className="py-1 pr-3 text-right">{c.f1.toFixed(3)}</td>
                  <td className="py-1 pr-3 text-right">{c.support}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════ model comparison ═══════════════════ */

interface ModelSummary {
  model: string;
  run_id?: string;
  tier: "small" | "medium" | "large" | null;
  passed: number;
  total: number;
  pass_rate: number;
  headline_f1: number | null;
  macro_f1: number | null;
  invalid: number;
  avg_ms: number;
  tokens: { in: number; out: number };
  model_calls: number;
  cost_total: number | null;
  cost_per_case: number | null;
}

interface CompareResult {
  batch_id: string;
  incumbent: string;
  models: ModelSummary[];
  recommended: string | null;
  rationale: string;
  /** Spec digest the comparison measured, so a stale one reads as stale. */
  digest?: string;
  at?: string;
}

const fmtCost = (c: number | null) =>
  c === null ? "unknown" : c === 0 ? "$0" : c < 0.0005 ? "<$0.001" : c < 0.01 ? `$${c.toFixed(4)}` : `$${c.toFixed(3)}`;
const fmtMs = (ms: number) => (ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}m` : `${(ms / 1000).toFixed(1)}s`);

/**
 * The same benchmark, one model at a time, with every model call pinned to
 * that model. Cost and time are relative to the best candidate on a log
 * scale, accuracy is the headline metric as measured. The recommendation is
 * the cheapest model that clears the incumbent's quality within a small
 * margin with no invalid outputs; it is a recommendation, never a switch.
 */
function ComparePanel({
  cmp,
  models,
  onUse,
  currentModel,
}: {
  cmp: CompareResult;
  models: { id: string; label: string; class?: string }[];
  onUse: (id: string) => void;
  currentModel: string;
}) {
  const label = (id: string) => models.find((m) => m.id === id)?.label ?? id;
  const bestCost = bestOf(cmp.models.map((m) => m.cost_per_case));
  const bestMs = bestOf(cmp.models.map((m) => m.avg_ms));
  const quality = (m: ModelSummary) => m.headline_f1 ?? m.pass_rate;
  const rows = [...cmp.models].sort((a, b) => quality(b) - quality(a) || (a.cost_per_case ?? Infinity) - (b.cost_per_case ?? Infinity));
  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-line">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/55 px-3 py-2">
        <span className="text-[12px] font-semibold">Model comparison</span>
        <span className="text-[11px] text-faint">{cmp.models.length} models, every call pinned, same cases</span>
        {cmp.digest && <Mono className="text-[10px] text-ghost">spec {cmp.digest.slice(0, 8)}{cmp.at ? ` · ${ago(cmp.at)}` : ""}</Mono>}
        <span className="grow" />
        {cmp.recommended && (
          <span className="text-[11px] text-dim">
            recommended <span className="font-mono text-fg">{label(cmp.recommended)}</span>
          </span>
        )}
      </div>
      {rows.map((m, i) => {
        const color = CAT[i % CAT.length];
        const score = {
          accuracy: quality(m),
          cost: logScore(m.cost_per_case, bestCost),
          time: logScore(m.avg_ms, bestMs),
        };
        const isInc = m.model === cmp.incumbent;
        const isRec = m.model === cmp.recommended;
        const stats = [
          { k: m.headline_f1 !== null ? "F1" : "pass", v: m.headline_f1 !== null ? m.headline_f1.toFixed(3) : `${Math.round(m.pass_rate * 100)}%`, sub: `${m.passed}/${m.total}${m.invalid ? ` · ${m.invalid} no label` : ""}`, s: score.accuracy },
          { k: "cost / case", v: fmtCost(m.cost_per_case), sub: `${(m.tokens.in / 1000).toFixed(1)}k in · ${(m.tokens.out / 1000).toFixed(1)}k out`, s: score.cost },
          { k: "avg time", v: fmtMs(m.avg_ms), sub: `${m.model_calls} model calls`, s: score.time },
        ];
        return (
          <div key={m.model} className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-3 border-b border-line px-3 py-2.5 last:border-b-0">
            <TriangleGlyph score={score} color={color} size={88} />
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="size-2 shrink-0 rounded-[2px]" style={{ background: color }} />
                <span className="min-w-0 truncate font-mono text-[11.5px] font-medium text-fg" title={m.model}>{label(m.model)}</span>
                {m.tier && <Tag>{m.tier}</Tag>}
                {isInc && <Tag>incumbent</Tag>}
                {isRec && <Tag tone="ok">recommended</Tag>}
                {m.invalid > 0 && <Tag tone="warn">{m.invalid} invalid</Tag>}
                <span className="grow" />
                {!isInc && m.model !== currentModel && m.model !== "default" && (
                  <Button size="sm" variant="quiet" onClick={() => onUse(m.model)}>
                    Use for this benchmark
                  </Button>
                )}
              </div>
              {stats.map((row) => (
                <span key={row.k} className="grid grid-cols-[72px_minmax(0,1fr)_auto] items-center gap-x-2">
                  <span className="text-[10px] text-faint">{row.k}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-raise">
                    <span className="block h-full rounded-full" style={{ width: `${Math.round((row.s ?? 0) * 100)}%`, background: row.s === null ? "transparent" : color }} />
                  </span>
                  <span className="flex items-baseline gap-1 whitespace-nowrap">
                    <span className="tnum w-16 text-right text-[11.5px] font-semibold text-fg">{row.v}</span>
                    <span className="w-28 truncate text-[9.5px] text-ghost">{row.sub}</span>
                  </span>
                </span>
              ))}
            </div>
          </div>
        );
      })}
      <p className="border-t border-line px-3 py-2 text-[11px] leading-[1.5] text-dim">{cmp.rationale}</p>
    </div>
  );
}


/**
 * The most recent comparison, rebuilt from history: every run that shares
 * the latest batch id, one per model. Cost and tokens come from the stored
 * summary; older rows without one show cost as unknown rather than zero.
 */
function lastComparison(runs: HistoryRow[], positive?: string): CompareResult | null {
  const batches = new Map<string, HistoryRow[]>();
  for (const r of runs) {
    const b = r.summary?.batch_id;
    if (!b || !r.summary?.compare) continue;
    batches.set(b, [...(batches.get(b) ?? []), r]);
  }
  // The newest batch with at least two legs. A batch whose other legs failed
  // (a refused model, a stopped run) is not a comparison, and must not hide
  // the last one that was.
  const latest = [...batches.values()]
    .filter((rows) => rows.length >= 2)
    .sort((a, b) => new Date(b[0].at).getTime() - new Date(a[0].at).getTime())[0];
  if (!latest) return null;
  const models: ModelSummary[] = latest.map((r) => {
    const m = r.matrix ? derive(r.matrix, positive) : null;
    const durations = (r.results ?? []).map((c) => c.duration_ms);
    return {
      model: r.model,
      run_id: r.id,
      tier: r.summary?.tier ?? null,
      passed: r.passed,
      total: r.total,
      pass_rate: r.passed / Math.max(1, r.total),
      headline_f1: m?.headlineF1 ?? null,
      macro_f1: m?.macroF1 ?? null,
      invalid: m?.invalid ?? 0,
      avg_ms: r.summary?.avg_ms ?? Math.round(durations.reduce((a, b) => a + b, 0) / Math.max(1, durations.length)),
      tokens: r.summary?.tokens ?? { in: 0, out: 0 },
      model_calls: r.summary?.model_calls ?? 0,
      cost_total: r.summary?.cost_total ?? null,
      cost_per_case: r.summary?.cost_per_case ?? null,
    };
  });
  const incumbent = latest[0].summary?.incumbent ?? models[0].model;
  const quality = (m: ModelSummary) => m.headline_f1 ?? m.pass_rate;
  const inc = models.find((m) => m.model === incumbent) ?? models[0];
  const eligible = models
    .filter((m) => quality(m) >= quality(inc) - 0.02 && m.invalid === 0 && m.cost_per_case !== null)
    .sort((a, b) => (a.cost_per_case as number) - (b.cost_per_case as number) || a.avg_ms - b.avg_ms);
  const best = eligible[0] ?? null;
  return {
    batch_id: latest[0].summary?.batch_id ?? "",
    digest: latest[0].digest,
    at: latest[0].at,
    incumbent: inc.model,
    models,
    recommended: best?.model ?? null,
    rationale: best
      ? best.model === inc.model
        ? "The incumbent is already the cheapest model that clears the bar."
        : `${best.model} clears the incumbent's quality within 0.02${inc.cost_per_case && best.cost_per_case !== null ? ` at ${Math.round((1 - best.cost_per_case / inc.cost_per_case) * 100)}% lower cost per case` : ""}.`
      : "No candidate cleared the incumbent's quality with a known cost; keep the incumbent.",
  };
}


/**
 * The decision the comparison was run for, stated once and made actionable:
 * which model to use, why in the terms a person weighs (quality, cost, time
 * against the incumbent), and the two things they can do about it. A
 * recommendation, never a switch: both actions are explicit clicks.
 */
function Recommendation({
  cmp,
  models,
  onUse,
  currentModel,
  onChanged,
  agent,
}: {
  cmp: CompareResult;
  models: { id: string; label: string; class?: string }[];
  onUse: (id: string) => void;
  currentModel: string;
  onChanged: () => void;
  /** The workflow this benchmark measures; the recommendation can become its model. */
  agent: string;
}) {
  const [busy, setBusy] = useState(false);
  const label = (id: string) => models.find((m) => m.id === id)?.label ?? id;
  const inc = cmp.models.find((m) => m.model === cmp.incumbent) ?? cmp.models[0];
  const rec = cmp.recommended ? cmp.models.find((m) => m.model === cmp.recommended) ?? null : null;
  const quality = (m: ModelSummary) => m.headline_f1 ?? m.pass_rate;
  const q = (m: ModelSummary) => (m.headline_f1 !== null ? `F1 ${m.headline_f1.toFixed(3)}` : `${Math.round(m.pass_rate * 100)}% pass`);
  const pctDelta = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : Math.round(((a - b) / b) * 100));

  /* Make the recommendation the workflow's own model: every node that calls
     a model is pinned to it, and tier routing on those nodes is cleared so
     the choice is explicit in the saved spec. The benchmark's model is left
     alone; that is the other button. */
  const [applied, setApplied] = useState(false);
  const makeWorkflowDefault = async () => {
    if (!rec) return;
    setBusy(true);
    try {
      const d = await (await fetch(`/api/agents?id=${encodeURIComponent(agent)}`)).json();
      if (!d.spec) throw new Error(String(d.error ?? "no spec"));
      const spec = d.spec as { spec: { nodes: Record<string, unknown>[] } };
      spec.spec.nodes = spec.spec.nodes.map((n) => {
        const callsModel = n.harness === "delegate" || (Array.isArray(n.steps) && (n.steps as { action?: string }[]).some((st) => st.action === "model"));
        if (!callsModel) return n;
        const next: Record<string, unknown> = { ...n, model: rec.model };
        delete next.model_class;
        return next;
      });
      const res = await fetch("/api/agents", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spec }) });
      if (!res.ok) throw new Error(String((await res.json()).error ?? res.status));
      setApplied(true);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  if (!rec) {
    return (
      <div className="flex flex-col gap-1 rounded-md border border-warn-line bg-warn-bg px-3 py-2.5">
        <span className="text-[12.5px] font-semibold text-warn">Keep {label(inc.model)} for now</span>
        <span className="text-[11.5px] leading-[1.5] text-dim">{cmp.rationale}</span>
      </div>
    );
  }
  const same = rec.model === inc.model;
  const dq = quality(rec) - quality(inc);
  const dCost = pctDelta(rec.cost_per_case, inc.cost_per_case);
  const dTime = pctDelta(rec.avg_ms, inc.avg_ms);
  const reasons = same
    ? [`${q(inc)} on this benchmark`, "no cheaper model in the comparison clears that quality", `${fmtCost(inc.cost_per_case)} per case`]
    : [
        dq >= 0 ? `quality ${dq === 0 ? "matches" : "beats"} the incumbent (${q(rec)} vs ${q(inc)})` : `quality within 0.02 of the incumbent (${q(rec)} vs ${q(inc)})`,
        dCost === null ? `${fmtCost(rec.cost_per_case)} per case` : dCost < 0 ? `${Math.abs(dCost)}% cheaper per case (${fmtCost(rec.cost_per_case)} vs ${fmtCost(inc.cost_per_case)})` : `${dCost}% more per case`,
        dTime === null ? `${fmtMs(rec.avg_ms)} per case` : dTime <= 0 ? `${Math.abs(dTime)}% faster (${fmtMs(rec.avg_ms)} vs ${fmtMs(inc.avg_ms)})` : `${dTime}% slower (${fmtMs(rec.avg_ms)} vs ${fmtMs(inc.avg_ms)})`,
        `${rec.invalid === 0 ? "no invalid outputs" : `${rec.invalid} invalid outputs`} across ${rec.total} cases`,
      ];
  return (
    <div className="flex flex-col gap-2 rounded-md border border-ok-line bg-ok-bg px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone="ok" solid>recommended</Tag>
        <span className="text-[13px] font-semibold text-fg">
          {same ? "Keep" : "Use"} {label(rec.model)}
        </span>
        {rec.tier && <Tag>{rec.tier}</Tag>}
        <span className="grow" />
        {!same && rec.model !== currentModel && (
          <Button size="sm" variant="solid" tone="ink" onClick={() => onUse(rec.model)}>
            Use for this benchmark
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={busy || applied} loading={busy} onClick={makeWorkflowDefault}>
          {applied ? "Workflow updated" : "Make it the workflow's model"}
        </Button>
      </div>
      <ul className="flex flex-col gap-0.5 pl-4 text-[11.5px] leading-[1.5] text-dim">
        {reasons.map((r) => (
          <li key={r} className="list-disc">{r}</li>
        ))}
      </ul>
      <span className="text-[10.5px] text-faint">
        Every call was pinned to each model on the same {rec.total} cases. Making it the workflow&rsquo;s model pins every model-calling node of {agent} to it in the saved spec (tier routing on those nodes is cleared); the benchmark&rsquo;s own model changes only with the other button. Both are explicit: nothing switches on its own.
      </span>
    </div>
  );
}
