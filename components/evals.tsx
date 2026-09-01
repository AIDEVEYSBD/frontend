"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button, Mono, Status } from "./ui";
import { Icon } from "./builder/icons";
import { useModels } from "@/lib/use-models";
import { Pick } from "./select";
import { fromDocument, inputKeysOf, type Kind } from "@/lib/spec";

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
  latest: { passed: number; total: number; model: string; at: string } | null;
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
}

interface CaseResult {
  id: string;
  note: string;
  passed: boolean;
  state: string;
  error: string;
  checks: { kind: string; ok: boolean; note: string }[];
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
  at: string;
}

interface FullSet {
  id: string;
  agent: string;
  name: string;
  model: string;
  cases: EvalCase[];
}

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

/* ── CSV round-trip: template out, filled sheet back in ──
   One row per case; check columns are optional and skip when empty. */

const csvEscape = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

function csvTemplate(inputKeys: { name: string }[]): string {
  const head = [
    "id",
    "note",
    ...inputKeys.map((k) => `input:${k.name}`),
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
    "text the result must include",
    "",
    "recorded.disposition",
    "escalate",
    "done",
  ];
  return [head.join(","), example.map(csvEscape).join(",")].join("\n") + "\n";
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
    return {
      id: slug(get(col("id")) || `case-${n + 1}`),
      note: get(col("note")),
      input: Object.fromEntries(inputCols.map(({ key, i }) => [key, get(i)])),
      checks: checks.length ? checks : [{ kind: "state", equals: "done" }],
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
            <Button size="sm" variant="outline" onClick={() => setBuilding("new")}>
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

function blankCase(n: number, keys: { name: string }[]): EvalCase {
  return {
    id: `case-${n}`,
    note: "",
    input: Object.fromEntries(keys.map((k) => [k.name, ""])),
    checks: [{ kind: "contains", value: "" }],
  };
}

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

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const set = {
        id: initial?.id ?? slug(name || `${agent}-bench`),
        agent,
        name: name || `${agent} benchmark`,
        model,
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
            <button
              onClick={() => {
                const blob = new Blob([csvTemplate(inputKeys)], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${agent}-benchmark-template.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              title="A spreadsheet with this agent's input columns — fill a row per case, upload it back"
              className="focusable cursor-pointer rounded-sm text-[11px] text-faint transition-colors hover:text-fg"
            >
              CSV template
            </button>
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
            <button
              onClick={() => csvRef.current?.click()}
              className="focusable cursor-pointer rounded-sm text-[11px] text-faint transition-colors hover:text-fg"
            >
              Upload CSV
            </button>
          </>
        )}
        <button
          onClick={() => {
            setShowJson((v) => !v);
            setJsonText(JSON.stringify({ id: initial?.id, agent, name, model, cases }, null, 2));
          }}
          className="focusable cursor-pointer rounded-sm text-[11px] text-faint transition-colors hover:text-fg"
        >
          {showJson ? "Back to the form" : "Edit as JSON"}
        </button>
        <Button size="sm" variant="quiet" onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>

      {showJson ? (
        <>
          <textarea
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            rows={14}
            spellCheck={false}
            className="focusable w-full resize-y rounded-md border border-line bg-canvas px-3 py-2.5 font-mono text-[11.5px] leading-[1.6] text-fg"
          />
          <div className="flex items-center gap-3">
            {error && <span className="text-[11.5px] text-err">{error}</span>}
            <span className="grow" />
            <Button size="sm" variant="outline" onClick={importJson}>
              Apply to the form
            </Button>
          </div>
        </>
      ) : (
        <>
          {/* who and how */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-dim">Agent under test</span>
              <Pick
                value={agent}
                onChange={setAgent}
                options={[
                  { value: "", label: "Choose an agent…" },
                  ...agents.map((a) => ({ value: a.id, label: a.name })),
                ]}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-dim">Benchmark name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Disposition accuracy"
                className="focusable h-8 rounded-md border border-line bg-canvas px-2.5 text-[12.5px] text-fg placeholder:text-ghost"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-dim">Runs on</span>
              <Pick
                value={model}
                onChange={setModel}
                options={[
                  { value: "", label: "Deployment default model" },
                  ...models.map((m) => ({ value: m.id, label: m.label })),
                ]}
              />
            </label>
          </div>

          {!agent && (
            <p className="text-[12px] text-faint">
              Pick the agent first — its spec names the inputs each case needs, so the form builds
              itself.
            </p>
          )}

          {/* the cases */}
          {agent &&
            cases.map((c, i) => (
              <div key={i} className="flex flex-col gap-3 rounded-md border border-line bg-canvas/60 p-3">
                <div className="flex items-center gap-2.5">
                  <span className="grid size-6 shrink-0 place-items-center rounded-md bg-raise font-mono text-[10.5px] text-dim">
                    {i + 1}
                  </span>
                  <input
                    value={c.id}
                    onChange={(e) => patchCase(i, { id: slug(e.target.value) })}
                    className="focusable w-44 rounded-md border border-line bg-canvas px-2 py-1 font-mono text-[11px] text-fg"
                    aria-label="Case id"
                  />
                  <input
                    value={c.note ?? ""}
                    onChange={(e) => patchCase(i, { note: e.target.value })}
                    placeholder="What this case proves (shown in results)"
                    className="focusable min-w-0 grow rounded-md border border-line bg-canvas px-2 py-1 text-[12px] text-fg placeholder:text-ghost"
                    aria-label="Case note"
                  />
                  <button
                    onClick={() =>
                      setCases((cs) => [
                        ...cs.slice(0, i + 1),
                        { ...structuredClone(c), id: `${c.id}-copy` },
                        ...cs.slice(i + 1),
                      ])
                    }
                    title="Duplicate case"
                    className="focusable cursor-pointer rounded-sm p-1 text-faint transition-colors hover:text-fg"
                  >
                    <Icon name="layers" size={13} />
                  </button>
                  <button
                    onClick={() => setCases((cs) => cs.filter((_, j) => j !== i))}
                    title="Remove case"
                    disabled={cases.length === 1}
                    className="focusable cursor-pointer rounded-sm p-1 text-faint transition-colors hover:text-err disabled:opacity-30"
                  >
                    <Icon name="cross" size={13} />
                  </button>
                </div>

                {/* inputs, derived from the spec */}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(inputKeys.length ? inputKeys : [{ name: "input", kind: "string" as Kind }]).map(
                    (k) => (
                      <label key={k.name} className="flex flex-col gap-1">
                        <span className="font-mono text-[10px] text-faint">{k.name}</span>
                        <textarea
                          value={String(c.input[k.name] ?? "")}
                          onChange={(e) =>
                            patchCase(i, { input: { ...c.input, [k.name]: e.target.value } })
                          }
                          rows={2}
                          className="focusable resize-y rounded-md border border-line bg-canvas px-2.5 py-1.5 text-[12px] leading-[1.5] text-fg"
                        />
                      </label>
                    ),
                  )}
                </div>

                {/* checks */}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10.5px] font-semibold tracking-wide text-dim uppercase">
                    Passes when
                  </span>
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
                          <input
                            value={ch.path ?? ""}
                            onChange={(e) =>
                              patchCase(i, {
                                checks: c.checks.map((x, y) => (y === j ? { ...x, path: e.target.value } : x)),
                              })
                            }
                            placeholder="result path, e.g. recorded.disposition"
                            className="focusable w-64 rounded-md border border-line bg-canvas px-2 py-1 font-mono text-[11px] text-fg placeholder:text-ghost"
                          />
                          <input
                            value={String(ch.equals ?? "")}
                            onChange={(e) =>
                              patchCase(i, {
                                checks: c.checks.map((x, y) => (y === j ? { ...x, equals: e.target.value } : x)),
                              })
                            }
                            placeholder="expected value"
                            className="focusable w-44 rounded-md border border-line bg-canvas px-2 py-1 text-[12px] text-fg placeholder:text-ghost"
                          />
                        </>
                      )}
                      {(ch.kind === "contains" || ch.kind === "not_contains") && (
                        <input
                          value={ch.value ?? ""}
                          onChange={(e) =>
                            patchCase(i, {
                              checks: c.checks.map((x, y) => (y === j ? { ...x, value: e.target.value } : x)),
                            })
                          }
                          placeholder="text to look for in the result"
                          className="focusable min-w-0 grow rounded-md border border-line bg-canvas px-2 py-1 text-[12px] text-fg placeholder:text-ghost"
                        />
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
                      <button
                        onClick={() =>
                          patchCase(i, { checks: c.checks.filter((_, y) => y !== j) })
                        }
                        disabled={c.checks.length === 1}
                        title="Remove check"
                        className="focusable cursor-pointer rounded-sm p-1 text-faint transition-colors hover:text-err disabled:opacity-30"
                      >
                        <Icon name="cross" size={12} />
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() =>
                      patchCase(i, { checks: [...c.checks, { kind: "contains", value: "" }] })
                    }
                    className="focusable w-fit cursor-pointer rounded-sm text-[11px] font-medium text-dim transition-colors hover:text-fg"
                  >
                    + another check
                  </button>
                </div>
              </div>
            ))}

          {agent && (
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCases((cs) => [...cs, blankCase(cs.length + 1, inputKeys)])}
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
  const [detail, setDetail] = useState<{ runs: HistoryRow[] } | null>(null);
  const [live, setLive] = useState<{ done: number; total: number; cases: CaseResult[] } | null>(null);
  const [runError, setRunError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [override, setOverride] = useState("");
  const { models } = useModels();

  const modelLabel = (id: string) =>
    id ? (models.find((m) => m.id === id)?.label ?? id) : "deployment default";

  useEffect(() => {
    if (!open) return;
    let stop = false;
    fetch(`/api/evals?id=${encodeURIComponent(row.id)}`)
      .then((r) => r.json())
      .then((d) => !stop && setDetail({ runs: d.runs ?? [] }))
      .catch(() => !stop && setDetail({ runs: [] }));
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row.id, live === null]);

  const run = async () => {
    setLive({ done: 0, total: row.n, cases: [] });
    setRunError("");
    try {
      const res = await fetch("/api/evals/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ set_id: row.id, ...(override ? { model: override } : {}) }),
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
          if (e.type === "case.done") {
            setLive((s) => s && { ...s, done: s.done + 1, cases: [...s.cases, e as CaseResult] });
          }
        }
      }
    } catch (e) {
      setRunError((e as Error).message);
    } finally {
      setLive(null);
      onChanged();
    }
  };

  const score = row.latest;
  const pct = score ? Math.round((score.passed / Math.max(1, score.total)) * 100) : null;

  return (
    <section className="overflow-hidden rounded-md border border-line bg-surface">
      <button
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
                className="block h-full rounded-full bg-run transition-[width] duration-300"
                style={{ width: `${(live.done / Math.max(1, live.total)) * 100}%` }}
              />
            </span>
            <Mono className="text-[10.5px] text-dim">
              {live.done}/{live.total}
            </Mono>
          </span>
        ) : score ? (
          <span className="flex items-center gap-2">
            <span className={`tnum text-[15px] font-semibold ${pct === 100 ? "text-ok" : pct! >= 60 ? "text-warn" : "text-err"}`}>
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
            <Button size="sm" variant="solid" tone="ink" disabled={!!live} loading={!!live} onClick={run}>
              {live ? "Measuring…" : "Run the benchmark"}
            </Button>
            <span className="text-[11px] text-faint">on</span>
            <div className="w-64">
              <Pick
                value={override}
                onChange={setOverride}
                options={[
                  { value: "", label: `Set default — ${modelLabel(row.model)}` },
                  ...models.map((m) => ({ value: m.id, label: m.label })),
                ]}
              />
            </div>
            <span className="grow" />
            <Button size="sm" variant="quiet" onClick={onEdit}>
              Edit
            </Button>
            <button
              onClick={async () => {
                if (!confirmDelete) {
                  setConfirmDelete(true);
                  setTimeout(() => setConfirmDelete(false), 3000);
                  return;
                }
                await fetch(`/api/evals?id=${encodeURIComponent(row.id)}`, { method: "DELETE" });
                onChanged();
              }}
              className={`focusable cursor-pointer rounded-sm text-[11px] transition-colors ${
                confirmDelete ? "font-semibold text-err" : "text-faint hover:text-err"
              }`}
            >
              {confirmDelete ? "Click again — history goes too" : "Delete set"}
            </button>
          </div>

          {runError && (
            <p className="rounded-md border border-err-line bg-err-bg px-3 py-2 text-[12px] text-err">
              The benchmark run failed — {runError}
            </p>
          )}

          {live && live.cases.length > 0 && <CaseTable cases={live.cases} />}

          {!live && detail?.runs.length ? (
            <div className="flex flex-col gap-3">
              <CaseTable cases={detail.runs[0].results} />
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-dim">History</span>
                {detail.runs.map((h) => (
                  <div key={h.id} className="flex items-center gap-3 text-[11.5px]">
                    <span className={`tnum font-semibold ${h.passed === h.total ? "text-ok" : "text-warn"}`}>
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
            onClick={() => setOpenCase(openCase === c.id ? null : c.id)}
            className="focusable flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-raise/40"
          >
            <span className={`size-1.5 shrink-0 rounded-[2px] ${c.passed ? "bg-ok" : "bg-err"}`} />
            <span className="min-w-0 grow truncate text-[12.5px] font-medium text-fg">{c.id}</span>
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
              <Link
                href={`/runs?id=${encodeURIComponent(c.run_file)}`}
                className="focusable mt-1 flex w-fit items-center gap-1.5 rounded-sm text-[11px] font-medium text-dim hover:text-fg"
              >
                <Icon name="pulse" size={11} />
                Open the run behind this score →
              </Link>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
