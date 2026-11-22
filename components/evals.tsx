"use client";
import { useDoorOff } from "@/lib/use-doors";
import { errorText, notBuiltText } from "@/lib/api/client";
import { ask } from "@/lib/api/pending";
import { Failure } from "./pending";

import { useCallback, useEffect, useRef, useState } from "react";
import { soon } from "@/lib/soon";
import { useSearchParams } from "next/navigation";
import { Button, IconButton, Label, Mono, Tag } from "./ui";
import { Icon } from "./builder/icons";
import { useModels } from "@/lib/use-models";
import { Pick, PickMany } from "./select";
import { Field, Input, Switch, Textarea } from "./forms";
import { Banner } from "./overlays";
import { GroupHeader } from "./page-tabs";
import { fromDocument, inputKeysOf, type Kind } from "@/lib/spec";
import { derive, labeledTemplate, INVALID, type Labels, type Matrix, type Reducer } from "@/lib/metrics";
import { TriangleGlyph, bestOf, logScore } from "./tradeoff";
import { CAT, Legend } from "./charts";
import { RateLimitNote } from "./rate-limit";
import type { RateLimit } from "@/lib/api/l7";
import { listAgents } from "@/lib/api/l2";
import { editableDocument, followEval, retiredOf, retiredRefusalOf, saveAgent, startEval, type EvalCaseResult, type EvalRunView, type ModelSummary, type Retired } from "@/lib/api/l8";
import { historyRowFromView, historyRowOf, lastComparison, liveOf, mergeHistory, mergeSetRows, rowStateText, settleOf, thresholdText, thresholdTone, throttleOf, type CompareResult, type HistoryRow, type SetRow } from "@/lib/evals";
import { getEvalSet, listEvalSets, type EvalSetDocument } from "@/lib/api/l8b";
import { retiredLine, savedLine } from "@/lib/lifecycle";

/**
 * Evals: build a benchmark beside an agent, run it, keep the score.
 *
 * The builder is a form, not a JSON pasting exercise: pick the agent and the
 * case inputs are derived from its own spec, checks are chosen from a menu,
 * and the default model is part of the set — so "run the benchmark" means
 * the same thing every time. Every case is a real run — same runtime, same
 * journal, same policy engine — graded deterministically, and every score is
 * stamped with the spec digest it measured.
 *
 * Phase L8: the runner is the backend's. "Run the benchmark" starts an eval
 * with `POST /api/agents/{id}/evals/run` and follows it by reading `GET
 * /api/evals/runs/{id}` (lib/api/l8.ts followEval): the live table, a rate
 * limit a case waits on, and a comparison's recommendation are read off the
 * eval's view. A deploy gate trusts only a score the backend produced
 * itself, so the score carries the spec's threshold and whether it was met,
 * and who started it. Phase L8 (second round): the sets are read as the
 * backend's runner reads them, through `GET /api/agents/{id}/eval-sets`
 * (agent by agent: the shared table, then the workspace files, with the one
 * each spec names as its suite) and `GET /api/eval-sets/{id}` (a set with
 * its cases), lib/api/l8b.ts. A set's history and its latest finished score
 * stay the console's read of the shared `eval_runs` table (/api/evals: the
 * backend has no door that lists them), and saving or deleting a set stays
 * the console's door too: the backend has none.
 */

/* ═══════════════════ shapes ═══════════════════ */

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

type CaseResult = EvalCaseResult;

interface FullSet {
  id: string;
  agent: string;
  name: string;
  model: string;
  labels?: Labels;
  cases: EvalCase[];
}

/** A set as the backend's door answers it, as the builder and the save take it. */
const fullSetOf = (d: EvalSetDocument): FullSet => ({
  id: d.id,
  agent: d.agent,
  name: d.name,
  model: d.model,
  ...(d.labels ? { labels: d.labels as unknown as Labels } : {}),
  cases: d.cases as unknown as EvalCase[],
});

/**
 * One set with its cases: as the backend's runner reads it (`GET
 * /api/eval-sets/{id}`), else, with no backend to ask, the console's own
 * read of the shared table; null when neither has it.
 */
async function readSet(id: string): Promise<FullSet | null> {
  try {
    return fullSetOf(await getEvalSet(id));
  } catch {
    try {
      const d = await (await fetch(`/api/evals?id=${encodeURIComponent(id)}`)).json();
      return d.set ? (d.set as FullSet) : null;
    } catch {
      return null;
    }
  }
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

/* ═══════════════════ typed inputs ═══════════════════ */

/**
 * What a case's input field is worth, typed to the entry node's contract.
 * Text is what a form or a sheet gives us; the workflow's intake expects a
 * bool, a number or an object where it says so. Only the unambiguous
 * readings convert; anything else is kept as typed and the runtime refuses
 * it with the real reason rather than guessing.
 */
function typedValue(kind: Kind, raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const text = raw.trim();
  if (kind === "string") return raw;
  if (text === "") return undefined;
  if (kind === "bool") {
    if (/^(true|yes|on|1)$/i.test(text)) return true;
    if (/^(false|no|off|0)$/i.test(text)) return false;
    return raw;
  }
  if (kind === "number") {
    const n = Number(text);
    return Number.isFinite(n) ? n : raw;
  }
  if (kind === "object" || kind === "list" || kind === "any") {
    if (!/^[[{]/.test(text) && kind !== "any") return raw;
    try {
      const v: unknown = JSON.parse(text);
      if (kind === "object" && (v === null || typeof v !== "object" || Array.isArray(v))) return raw;
      if (kind === "list" && !Array.isArray(v)) return raw;
      return v;
    } catch {
      return raw;
    }
  }
  return raw;
}

/** A case's input with every declared field typed; blank optional fields drop out. */
function typedInput(input: Record<string, unknown>, keys: { name: string; kind: Kind }[]): Record<string, unknown> {
  const kinds = new Map(keys.map((k) => [k.name, k.kind]));
  const out: Record<string, unknown> = {};
  for (const [name, raw] of Object.entries(input)) {
    const v = typedValue(kinds.get(name) ?? "string", raw);
    if (v !== undefined) out[name] = v;
  }
  return out;
}

/** The editor shows every field as text; objects and lists as their JSON. */
function fieldText(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  return JSON.stringify(v, null, 2);
}

/** The starting value a new case gets for a field: false for a bool, nothing otherwise. */
function blankValue(kind: Kind): unknown {
  return kind === "bool" ? false : "";
}

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

function casesFromCsv(text: string, keys: { name: string; kind: Kind }[] = []): EvalCase[] | string {
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
      input: typedInput(Object.fromEntries(inputCols.map(({ key, i }) => [key, get(i)])), keys),
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

  /* Which agents are retired (L8): their benchmarks still read, and take no new eval. */
  const [retired, setRetired] = useState<Record<string, Retired>>({});
  /* Each read that failed, with its reason: while any is set, an empty list means "not read", never "none created". */
  const [failures, setFailures] = useState<{ what: string; message: string }[]>([]);
  const refresh = useCallback(async () => {
    const failed: { what: string; message: string }[] = [];
    // The latest finished score per set: the history of eval runs (GET /api/evals).
    let consoleRows: SetRow[] = [];
    const history = await ask<{ sets?: SetRow[] }>("evals");
    if (history.state === "ok") consoleRows = Array.isArray(history.data?.sets) ? history.data.sets! : [];
    else failed.push({ what: "The evaluation history could not be read", message: history.state === "pending" ? notBuiltText(history.door.method, history.door.path) : history.message });
    // The sets themselves, as the backend's runner reads them, agent by agent.
    let agents: Awaited<ReturnType<typeof listAgents>> = [];
    try {
      agents = await listAgents();
    } catch (e) {
      failed.push({ what: "The agents could not be read, so their benchmarks were not asked for", message: (e as Error).message });
    }
    try {
      setSets(mergeSetRows(await listEvalSets(agents.map((a) => a.id)), consoleRows));
    } catch (e) {
      setSets(consoleRows);
      failed.push({ what: "The benchmarks could not be read", message: (e as Error).message });
    }
    setFailures(failed);
    const out: Record<string, Retired> = {};
    for (const a of agents) {
      const r = retiredOf(a.retired);
      if (r) out[a.id] = r;
    }
    setRetired(out);
  }, []);

  useEffect(() => soon(refresh), [refresh]);

  return (
    <div className="mx-auto w-full max-w-[1520px] px-5 py-7" data-hue="indigo">
      <GroupHeader
        group="quality"
        tab="evals"
        actions={
          !building ? (
            <Button variant="solid" tone="ink" size="sm" onClick={() => setBuilding("new")}>
              New benchmark
            </Button>
          ) : undefined
        }
      >
        Evaluate an agent on representative cases, graded by fixed checks and tied to the exact version assessed. Each part below says whether the platform builds it yet.
      </GroupHeader>

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
        {failures.map((f) => (
          <Failure key={f.what} what={f.what} message={f.message} />
        ))}
        {sets?.length === 0 && !building && failures.length === 0 && (
          <div className="flex flex-col items-start gap-3 rounded-md border border-dashed border-line-strong bg-surface px-5 py-6">
            <p className="text-[13px] font-medium text-fg">No evaluations have been created.</p>
            <p className="max-w-[60ch] text-[12px] leading-[1.6] text-dim">
              Select an agent and define the expected outcomes for representative cases. Future
              changes can then be assessed against the same evidence-based benchmark.
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
            retired={retired[s.agent] ?? null}
            open={openId === s.id}
            onToggle={() => setOpenId(openId === s.id ? null : s.id)}
            onChanged={refresh}
            onEdit={async () => {
              // The set as the backend's runner reads it: the shared table, else its workspace file.
              const d = await readSet(s.id);
              if (d) setBuilding(d);
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
  /** L8: a retired agent's benchmark may still be edited; it takes no new eval. */
  retired: boolean;
}

function blankCase(n: number, keys: { name: string; kind?: Kind }[], labels?: Labels | null): EvalCase {
  return {
    id: `case-${n}`,
    note: "",
    input: Object.fromEntries(keys.map((k) => [k.name, blankValue(k.kind ?? "string")])),
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
      .then((d) => setAgents((d.agents ?? []).map((a: { id: string; name: string; retired?: unknown }) => ({ id: a.id, name: a.name, retired: Boolean(retiredOf(a.retired)) }))))
      .catch(() => setAgents([]));
  }, []);

  /* The agent's spec names its own inputs — derive the case form from it.
     A change of agent clears the keys during render; the fetch below refills them. */
  const [keysFor, setKeysFor] = useState(agent);
  if (agent !== keysFor) {
    setKeysFor(agent);
    setInputKeys([]);
  }
  useEffect(() => {
    if (!agent) return;
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

  const saveDoor = useDoorOff("POST", "/api/evals");
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
          input: typedInput(c.input, inputKeys),
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
      const d = await res.json().catch(() => null);
      if (!res.ok || !d || d.error) throw new Error(errorText(d, res, "POST", "/api/evals"));
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
                const parsed = casesFromCsv(await f.text(), inputKeys);
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
            {error && <Failure inline message={error} />}
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
                  ...agents.map((a) => ({ value: a.id, label: a.retired ? `${a.name} (retired)` : a.name })),
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
                  {(inputKeys.length ? inputKeys : [{ name: "input", kind: "string" as Kind }]).map((k) =>
                    k.kind === "bool" ? (
                      <Field key={k.name} label={`${k.name} · bool`}>
                        <div className="flex h-9 items-center">
                          <Switch
                            label={c.input[k.name] === true || String(c.input[k.name]).toLowerCase() === "true" ? "true" : "false"}
                            checked={c.input[k.name] === true || String(c.input[k.name]).toLowerCase() === "true"}
                            onChange={(on) => patchCase(i, { input: { ...c.input, [k.name]: on } })}
                          />
                        </div>
                      </Field>
                    ) : k.kind === "number" ? (
                      <Field key={k.name} label={`${k.name} · number`}>
                        <Input
                          mono
                          value={fieldText(c.input[k.name])}
                          onChange={(v) => patchCase(i, { input: { ...c.input, [k.name]: v } })}
                          invalid={fieldText(c.input[k.name]).trim() !== "" && !Number.isFinite(Number(fieldText(c.input[k.name])))}
                        />
                      </Field>
                    ) : k.kind === "object" || k.kind === "list" ? (
                      <Field key={k.name} label={`${k.name} · ${k.kind} as JSON`}>
                        <Textarea
                          mono
                          value={fieldText(c.input[k.name])}
                          onChange={(v) => patchCase(i, { input: { ...c.input, [k.name]: v } })}
                          rows={3}
                          placeholder={k.kind === "list" ? "[ ... ]" : "{ ... }"}
                          invalid={typeof c.input[k.name] === "string" && c.input[k.name] !== "" && typeof typedValue(k.kind, c.input[k.name]) === "string"}
                        />
                      </Field>
                    ) : (
                      <Field key={k.name} label={k.name}>
                        <Textarea
                          value={fieldText(c.input[k.name])}
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
              {error && <Failure inline className="max-w-[44ch] truncate" message={error} />}
              <Button
                size="sm"
                variant="solid"
                tone="ink"
                permission="configure"
                disabled={!agent || !cases.length || busy || saveDoor.off}
                title={saveDoor.why}
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

/** A rate limit a case's start waits on, as the card shows it: the limit with the runner's own wait, when it was read, and which case. */
interface Throttled {
  limit: RateLimit;
  at: number;
  caseId: string;
  attempt: number;
  of: number;
  /** The eval row it was read on. */
  run: string;
}

function SetCard({
  row,
  retired,
  open,
  onToggle,
  onChanged,
  onEdit,
}: {
  row: SetRow;
  /** The agent it benchmarks is retired (L8): its history reads, and it takes no new eval. */
  retired: Retired | null;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
  onEdit: () => void;
}) {
  const [detail, setDetail] = useState<{ runs: HistoryRow[]; labels?: Labels } | null>(null);
  /* The eval being followed: one view per row the request wrote (one, or one per candidate), in the order started; null when none is. */
  const [views, setViews] = useState<EvalRunView[] | null>(null);
  /* What finished in this card, kept until the set's history read holds it. */
  const [seen, setSeen] = useState<HistoryRow[]>([]);
  const [runError, setRunError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [override, setOverride] = useState("");
  const [compare, setCompare] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [cmp, setCmp] = useState<CompareResult | null>(null);
  const [viewModel, setViewModel] = useState<string | null>(null);
  /** A case's start the backend refused for a rate limit (429): its runner waits the time it gave and tries again. */
  const [throttled, setThrottled] = useState<Throttled | null>(null);
  const { models, defaultModel } = useModels();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const running = views !== null;
  const live = views ? liveOf(views) : null;

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
    // The set's labels from the backend's door; its history from the console's read of the shared table.
    Promise.all([
      getEvalSet(row.id).catch(() => null),
      fetch(`/api/evals?id=${encodeURIComponent(row.id)}`)
        .then((r) => r.json())
        .catch(() => ({})),
    ])
      .then(([set, d]) => {
        if (stop) return;
        const labels = (set?.labels as unknown as Labels | null) ?? (d as { set?: { labels?: Labels } }).set?.labels ?? undefined;
        setDetail({ runs: (Array.isArray((d as { runs?: unknown[] }).runs) ? (d as { runs: unknown[] }).runs : []).map(historyRowOf), labels });
      })
      .catch(() => !stop && setDetail({ runs: [] }));
    return () => {
      stop = true;
    };
    // `running` re-reads the history once an eval this card followed is over.
  }, [open, row.id, running]);

  /* Start on the backend, then follow every row it wrote until each is over.
     A comparison's rows run one after another; the live table follows the
     candidate measured now. Leaving the page stops the following, not the
     eval: it runs on, and its rows land in the history. */
  const run = async () => {
    setViews([]);
    setRunError("");
    setCmp(null);
    setThrottled(null);
    try {
      const started = await startEval(row.agent, {
        set: row.id,
        ...(override ? { model: override } : {}),
        ...(compare ? { compare: { models: picked } } : {}),
      });
      const latest = new Map<string, EvalRunView>();
      const final = await followEval(started.runs, {
        everyMs: 1500,
        stopped: () => !mounted.current,
        onView: (v) => {
          latest.set(v.id, v);
          if (!mounted.current) return;
          setViews(started.runs.map((id) => latest.get(id)).filter((x): x is EvalRunView => Boolean(x)));
          const t = throttleOf(v);
          setThrottled((cur) =>
            t
              ? cur && cur.run === v.id && cur.caseId === t.id && cur.attempt === t.attempt
                ? cur
                : { limit: { ...t.limit, retry_after_s: t.wait_s }, at: Date.now(), caseId: t.id, attempt: t.attempt, of: t.of, run: v.id }
              : cur && cur.run === v.id
                ? null
                : cur,
          );
        },
      });
      if (!mounted.current) return;
      const { comparison, failed } = settleOf(final);
      setSeen((s) => mergeHistory(s, final.map(historyRowFromView)));
      if (comparison) setCmp(comparison);
      if (failed.length) setRunError(failed.map((v) => `${modelLabel(v.model === "default" ? "" : v.model)}: ${v.error || "the eval failed"}`).join("; "));
    } catch (e) {
      const gone = retiredRefusalOf(e);
      setRunError(gone ? `${row.agent} is retired. ${retiredLine(gone)}` : (e as Error).message);
    } finally {
      if (mounted.current) {
        setViews(null);
        setThrottled(null);
        onChanged();
      }
    }
  };

  const useModel = async (id: string) => {
    // Read through the backend's door; the save stays the console's (the backend has no door that writes a set).
    const d = await readSet(row.id);
    if (!d) return;
    await fetch("/api/evals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ set: { ...d, model: id } }),
    });
    onChanged();
  };

  const runs = detail ? mergeHistory(detail.runs, seen) : seen;
  const activeCmp = cmp ?? lastComparison(runs, detail?.labels?.positive);
  /* Which compared model's run is on screen: the one picked, else the
     recommendation, else the incumbent, else the latest run of all. */
  const viewRun = (() => {
    if (!activeCmp || !runs.length) return null;
    const want = viewModel ?? activeCmp.recommended ?? activeCmp.incumbent;
    const m = activeCmp.models.find((x) => x.model === want) ?? activeCmp.models[0];
    const r = m?.run_id ? runs.find((x) => x.id === m.run_id) : undefined;
    return r ? { ...r, model: m.model } : null;
  })();
  const shownRun = viewRun ?? runs.find((r) => r.state === "done") ?? runs[0] ?? null;

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
          <span className="flex items-center gap-2">
            <span className="text-[13.5px] font-semibold text-fg">{row.name}</span>
            {retired && <Tag>agent retired</Tag>}
            {/* L8, second round: the set the agent's spec names as its suite; its threshold gates a deploy. */}
            {row.suite && <Tag tone="run">the spec&rsquo;s suite</Tag>}
            {row.source === "file" && <Tag>workspace file</Tag>}
          </span>
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
        ) : running ? (
          <span className="text-[11px] text-faint">starting…</span>
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
            {score.threshold !== null && score.threshold !== undefined && (
              <Tag tone={thresholdTone({ passed_threshold: score.passed_threshold ?? null })}>
                {score.passed_threshold === true ? "met" : score.passed_threshold === false ? "under" : "threshold"} {score.threshold}
              </Tag>
            )}
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
          {retired && (
            <Banner tone="neutral" title={`${row.agent} is retired`}>
              {retiredLine(retired)} Its history stays readable; a new eval is refused.
            </Banner>
          )}
          <div className="flex flex-wrap items-center gap-2.5">
            <Button size="sm" variant="solid" tone="ink" permission="run" disabled={running || Boolean(retired) || (compare && picked.length < 2)} loading={running} onClick={run}>
              {running ? "Measuring…" : compare ? `Compare ${picked.length} models` : "Run the benchmark"}
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
              <Switch label="Compare models" checked={compare} onChange={enableCompare} disabled={running} />
              {compare && (
                <div className="w-72">
                  <PickMany
                    values={picked}
                    onChange={setPicked}
                    disabled={running}
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
                    <Button key={label} size="sm" variant="solid" disabled={running} onClick={fn}>
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
              permission="configure"
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
              {confirmDelete ? "Click again — the set goes; the backend's eval records stay" : "Delete set"}
            </Button>
          </div>

          {runError && (
            <Banner tone="err" title="The benchmark run failed">
              {runError}
            </Banner>
          )}

          {live && (
            <p className="text-[11.5px] text-dim">
              Measuring <span className="font-mono text-fg">{modelLabel(live.model === "default" ? "" : live.model)}</span>
              {live.legs > 1 ? `, candidate ${live.leg} of ${live.legs}, every model call pinned to it` : ""}
              <span className="text-faint"> · on the backend, each case a real run · {live.passed} passed so far</span>
            </p>
          )}
          {running && throttled && (
            <div className="flex flex-col gap-1">
              <RateLimitNote limit={throttled.limit} readAt={throttled.at} />
              <span className="text-[11px] text-faint">
                Case <span className="font-mono text-dim">{throttled.caseId}</span> waits and is started again (attempt {throttled.attempt} of {throttled.of}); a case refused past that is recorded as refused, naming the limit.
              </span>
            </div>
          )}
          {live && live.cases.length > 0 && <CaseTable cases={live.cases} />}
          {!running && activeCmp && (
            <>
              <Recommendation cmp={activeCmp} models={models} onUse={useModel} currentModel={row.model} onChanged={onChanged} agent={row.agent} />
              <ComparePanel cmp={activeCmp} models={models} onUse={useModel} currentModel={row.model} />
            </>
          )}

          {!running && runs.length ? (
            <div className="flex flex-col gap-3">
              {activeCmp && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold text-dim">Results for</span>
                  <div className="w-72">
                    <Pick
                      value={viewRun?.model ?? ""}
                      onChange={setViewModel}
                      options={activeCmp.models
                        .filter((m) => m.run_id && runs.some((r) => r.id === m.run_id))
                        .map((m) => ({
                          value: m.model,
                          label: `${modelLabel(m.model === "default" ? "" : m.model)}${m.model === activeCmp.recommended ? " · recommended" : m.model === activeCmp.incumbent ? " · incumbent" : ""}`,
                        }))}
                    />
                  </div>
                  <span className="text-[10.5px] text-faint">the matrix and the cases below are this model&rsquo;s run</span>
                </div>
              )}
              {shownRun && (
                <span className="flex flex-wrap items-center gap-2 text-[11px] text-dim">
                  <Tag tone={thresholdTone(shownRun)}>{thresholdText({ ...shownRun, forced: Boolean(shownRun.summary?.forced) })}</Tag>
                  {shownRun.by && <span>started by {shownRun.by}</span>}
                  {shownRun.version !== null && <Mono className="text-[10px] text-faint">version {shownRun.version}</Mono>}
                </span>
              )}
              {shownRun?.matrix && (
                <ConfusionPanel matrix={shownRun.matrix} positive={detail?.labels?.positive} />
              )}
              <CaseTable cases={shownRun?.results ?? []} />
              <ScoreTrend runs={runs} modelLabel={(id) => modelLabel(id === "default" ? "" : id)} />
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-dim">History</span>
                {runs.map((h) => (
                  <div key={h.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px]">
                    {h.matrix && h.state === "done" && (
                      <span className="tnum font-semibold text-fg">
                        F1 {derive(h.matrix, detail?.labels?.positive).headlineF1.toFixed(3)}
                      </span>
                    )}
                    <span className={`tnum ${h.matrix ? "text-dim" : "font-semibold"} ${!h.matrix && h.passed === h.total ? "text-ok" : !h.matrix ? "text-warn" : ""}`}>
                      {h.passed}/{h.total}
                    </span>
                    {rowStateText(h) && <Tag tone={h.state === "failed" ? "err" : "run"}>{rowStateText(h)}</Tag>}
                    {h.threshold !== null && h.state === "done" && (
                      <span className={`text-[10.5px] ${h.passed_threshold === true ? "text-ok" : h.passed_threshold === false ? "text-err" : "text-faint"}`}>
                        {h.passed_threshold === true ? "met" : h.passed_threshold === false ? "under" : "threshold"} {h.threshold}
                      </span>
                    )}
                    <Mono className="text-[10px] text-faint">{modelLabel(h.model === "default" ? "" : h.model)}</Mono>
                    <Mono className="text-[10px] text-ghost">spec {h.digest.slice(0, 8)}</Mono>
                    {h.by && <span className="text-[10px] text-faint">by {h.by}</span>}
                    <span className="text-[10px] text-ghost">{ago(h.at)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : !running ? (
            <p className="text-[12px] text-faint">
              Never run. The first run sets the baseline — every later score compares against it.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** Finished runs the score chart draws, most recent last. */
const TREND_RUNS = 24;

const dayText = (iso: string) => (Number.isNaN(Date.parse(iso)) ? "" : new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }));

/**
 * Pass rate over time for one set: a point per finished eval run, oldest
 * first, with the threshold as a line. LineChart's shape (components/charts.tsx:
 * labels outside a stretched plot, hairline grid), on a fixed 0 to 100 axis
 * with a point and its facts per run. One run is not a trend, so the chart
 * starts at the second.
 */
function ScoreTrend({ runs, modelLabel }: { runs: HistoryRow[]; modelLabel: (id: string) => string }) {
  const finished = runs.filter((r) => r.state === "done" && r.total > 0).sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id));
  if (finished.length === 0) return null;
  if (finished.length === 1) {
    return <p className="text-[11.5px] leading-[1.5] text-faint">One finished run is not a trend. The pass rate over time is drawn once this set has been run a second time.</p>;
  }
  const shown = finished.slice(-TREND_RUNS);
  const pct = (r: HistoryRow) => (r.passed / r.total) * 100;
  const asPct = (t: number) => (t <= 1 ? t * 100 : t);
  const thresholds = shown.filter((r) => r.threshold !== null).map((r) => asPct(r.threshold as number));
  const threshold = thresholds.length ? thresholds[thresholds.length - 1] : null;
  const differing = new Set(thresholds.map((t) => t.toFixed(2))).size > 1;
  const x = (i: number) => (i / (shown.length - 1)) * 100;
  const color = CAT[1];
  const ticks = [100, 75, 50, 25, 0];
  const height = 150;
  // Runs on one day are told apart by the time.
  const oneDay = dayText(shown[0].at) === dayText(shown[shown.length - 1].at);
  const endText = (iso: string) => (oneDay && !Number.isNaN(Date.parse(iso)) ? `${dayText(iso)}, ${new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : dayText(iso));
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line px-3 py-2.5">
      <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-[11px] font-semibold text-dim">Pass rate over time</span>
        <span className="text-[10.5px] text-faint">
          {shown.length === finished.length ? `${shown.length} finished runs` : `the ${shown.length} most recent of ${finished.length} finished runs`}, oldest first
        </span>
      </span>
      <div className="flex">
        <div className="relative w-9 shrink-0" style={{ height }}>
          {ticks.map((t) => (
            <span key={t} className="tnum absolute left-0 -translate-y-1/2 font-mono text-[9.5px] leading-none text-faint" style={{ top: `${100 - t}%` }}>
              {t}%
            </span>
          ))}
        </div>
        <div className="relative mr-2 ml-1 min-w-0 grow" style={{ height }}>
          {ticks.map((t) => (
            <span key={t} className="absolute inset-x-0 border-t" style={{ top: `${100 - t}%`, borderColor: t === 0 ? "var(--t-fg-4)" : "var(--t-line)" }} />
          ))}
          <svg className="absolute inset-0 block size-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            {threshold !== null && <line x1="0" x2="100" y1={100 - threshold} y2={100 - threshold} stroke="var(--t-fg-3)" strokeWidth="1.25" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />}
            <polyline points={shown.map((r, i) => `${x(i)},${100 - pct(r)}`).join(" ")} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          {shown.map((r, i) => {
            const v = pct(r);
            const own = r.threshold === null ? null : asPct(r.threshold);
            return (
              <span key={r.id} tabIndex={0} className="group focusable absolute grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full" style={{ left: `${x(i)}%`, top: `${100 - v}%` }} aria-label={`${dayText(r.at)}: ${Math.round(v)}% passed, ${r.passed} of ${r.total}`}>
                <span className="size-2 rounded-full ring-2 ring-surface" style={{ background: color }} />
                <span
                  role="tooltip"
                  className={`pointer-events-none absolute z-20 hidden w-max max-w-[240px] flex-col gap-0.5 rounded-md border border-line bg-surface px-2.5 py-2 text-left elev-3 group-hover:flex group-focus:flex ${v > 55 ? "top-full mt-1" : "bottom-full mb-1"} ${x(i) > 50 ? "right-0" : "left-0"}`}
                >
                  <span className="tnum text-[12px] font-semibold text-fg">
                    {Math.round(v)}% passed <span className="font-normal text-faint">· {r.passed}/{r.total}</span>
                  </span>
                  <span className="text-[10.5px] text-dim">
                    {new Date(r.at).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} · {ago(r.at)}
                  </span>
                  <span className="text-[10.5px] text-faint">{own === null ? "no threshold applied to this run" : `${r.passed_threshold === true ? "met" : r.passed_threshold === false ? "under" : "against"} its threshold of ${Math.round(own)}%`}</span>
                  <span className="font-mono text-[10px] text-faint">
                    {modelLabel(r.model)} · spec {r.digest.slice(0, 8)}
                  </span>
                </span>
              </span>
            );
          })}
        </div>
      </div>
      <div className="mr-2 ml-10 flex justify-between font-mono text-[9.5px] text-faint">
        <span>{endText(shown[0].at)}</span>
        <span>{endText(shown[shown.length - 1].at)}</span>
      </div>
      <Legend
        items={[
          { label: "Pass rate per run", color },
          ...(threshold !== null ? [{ label: `Threshold ${Math.round(threshold)}%${differing ? ", the latest: it differed between runs" : ""}`, color: "var(--t-fg-3)", dashed: true }] : []),
        ]}
      />
      {threshold === null && <span className="text-[10.5px] text-ghost">No run in this history carried a threshold, so none is drawn.</span>}
    </div>
  );
}

/** A run's cases, graded: what passed, what each check said, the label against the expected one, and the run behind each score. */
export function CaseTable({ cases }: { cases: CaseResult[] }) {
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
            {c.expected != null && (
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
export function ComparePanel({
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
                  <Button size="sm" variant="solid" onClick={() => onUse(m.model)}>
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
     alone; that is the other button. It edits the latest save (a draft, once
     the agent is deployed), and saving is never gated: a deployed agent keeps
     running its version until the draft is deployed through the gate. */
  const [applied, setApplied] = useState("");
  const [applyError, setApplyError] = useState("");
  const makeWorkflowDefault = async () => {
    if (!rec) return;
    setBusy(true);
    setApplyError("");
    try {
      const edit = await editableDocument(agent);
      const spec = structuredClone(edit.spec) as { spec?: { nodes?: Record<string, unknown>[] } };
      if (!spec.spec || !Array.isArray(spec.spec.nodes)) throw new Error(`the registry holds no document for "${agent}"`);
      spec.spec.nodes = spec.spec.nodes.map((n) => {
        const callsModel = n.harness === "delegate" || (Array.isArray(n.steps) && (n.steps as { action?: string }[]).some((st) => st.action === "model"));
        if (!callsModel) return n;
        const next: Record<string, unknown> = { ...n, model: rec.model };
        delete next.model_class;
        return next;
      });
      const saved = await saveAgent(spec as Record<string, unknown>);
      setApplied(savedLine(saved, edit.agent.deployed_version));
      onChanged();
    } catch (e) {
      const gone = retiredRefusalOf(e);
      setApplyError(gone ? `${agent} is retired. ${retiredLine(gone)}` : (e as Error).message);
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
        <Button size="sm" variant="solid" permission="deploy" disabled={busy || Boolean(applied)} loading={busy} onClick={makeWorkflowDefault}>
          {applied ? "Saved" : "Make it the workflow's model"}
        </Button>
      </div>
      {applied && <span className="text-[11.5px] text-dim">{applied}</span>}
      {applyError && (<span className="text-[11.5px] text-err">{applyError}</span>)}
      <ul className="flex flex-col gap-0.5 pl-4 text-[11.5px] leading-[1.5] text-dim">
        {reasons.map((r) => (
          <li key={r} className="list-disc">{r}</li>
        ))}
      </ul>
      <span className="text-[10.5px] text-faint">
        Every call was pinned to each model on the same {rec.total} cases. Making it the workflow&rsquo;s model pins every model-calling node of {agent} to it in a new saved version (tier routing on those nodes is cleared); once the agent is deployed that version is a draft, and production keeps running until it is deployed through the promotion gate. The benchmark&rsquo;s own model changes only with the other button. Both are explicit: nothing switches on its own.
      </span>
    </div>
  );
}
