"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { errorText } from "@/lib/api/client";
import { Meter, Status, Tag, type Tone } from "./ui";
import { api } from "@/lib/api/client";
import { fmtUsd } from "@/lib/run-tree";
import { useRunTree } from "./run-tree";
import { notBuilt, readRunRowsNotBuilt } from "@/lib/not-built";

/**
 * What a run was held to, and what it spent against it.
 *
 * Two readings of one spec, on a single run's page: the bounds (each step's
 * step limit and stop condition, the delegation depth, the wall clock, a
 * re-entry cap when the spec carries one) and the spend (cost, tokens and
 * tool calls beside the ceiling in `policy.budget`). Every figure says where
 * it came from. The spec is the record's own copy when the record holds one;
 * otherwise the agent's spec as it is today, with the two digests compared,
 * because a limit shown for a run it did not govern is worse than none.
 *
 * A run that reaches a cost budget (its own, the deployment's period budget
 * or its use case's) pauses until a person decides on the Approvals page.
 * The journal says so ("Paused at its budget", "Budget decision", both with
 * `data.control: "budget"`), and while a hold for the run is waiting the
 * strip says the run waits on a decision on its budget.
 */

type Rec = Record<string, unknown>;
const obj = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A journal entry, as far as these panels read it. */
export interface LimitEntry {
  id: string;
  t: number;
  kind: string;
  node?: string;
  title?: string;
  detail?: string;
  /** The entries this one rests on: a result, refusal or failure cites the call it closes. */
  because?: string[];
  data?: Rec;
}

/** What the run record says beside its journal. Every member may be empty: an older record holds none of it. */
export interface RunFacts {
  /** The spec document stored with the run, when the record holds one. */
  spec: unknown;
  /**
   * `spec` is the agent's latest saved version as this page loaded it to start the run, not the copy the platform
   * stored with the run (which is the deployed version, or a canary candidate).
   */
  specLoaded?: boolean;
  specDigest: string;
  /** The runtime's own meter (`tool_calls`, `tokens`, `cost_usd`, `wall_clock_s`); empty on a record written before it. */
  spent: Rec;
  /** How many times each step was entered. */
  visits: Record<string, number>;
  provider: string;
  model: string;
  dataClass: string;
  startedAt: string;
  finishedAt: string;
}

/**
 * What the runtime applies when a spec says nothing (`runtime/agentfactory/spec.py`:
 * `Budget.tool_calls`, `Delegation.max_depth`, `Node.max_steps`). Named as
 * defaults wherever they are shown, never as the spec's own word.
 */
const RUNTIME_DEFAULT = { tool_calls: 200, max_depth: 3, max_steps: 12, max_visits: 8 } as const;

/* ═══════════════════ the spec a run is read against ═══════════════════ */

/** The `spec` section of a document, whichever way it arrived (a whole document, or the section itself). */
export function specBody(doc: unknown): Rec | null {
  const d = obj(doc);
  const inner = obj(d.spec);
  if (Array.isArray(inner.nodes)) return inner;
  if (Array.isArray(d.nodes)) return d;
  return null;
}

export interface RunSpec {
  body: Rec | null;
  /**
   * `record`: the copy stored with the run. `loaded`: the agent's latest saved version as the page loaded it to start
   * the run. `agent`: the agent's spec as it is today. `none`: neither could be read.
   */
  from: "record" | "loaded" | "agent" | "none";
  loading: boolean;
  /** The digest of the agent's spec today, when that is what is shown. */
  agentDigest: string;
  runDigest: string;
  system: string;
}

/** The spec to read a run against: its own copy, else the agent's spec today. */
export function useRunSpec(recordSpec: unknown, system: string, runDigest: string, loaded = false): RunSpec {
  const own = specBody(recordSpec);
  const [fetched, setFetched] = useState<{ system: string; body: Rec | null; digest: string } | null>(null);
  useEffect(() => {
    if (own || !system) return;
    let live = true;
    api
      .GET("/api/agents", { params: { query: { id: system } } })
      .then(({ data }) => {
        if (!live) return;
        const d = obj(data);
        setFetched({ system, body: specBody(d.spec), digest: str(obj(arr(d.agents)[0]).digest) });
      })
      .catch(() => {
        if (live) setFetched({ system, body: null, digest: "" });
      });
    return () => {
      live = false;
    };
  }, [own, system]);
  if (own) return { body: own, from: loaded ? "loaded" : "record", loading: false, agentDigest: "", runDigest, system };
  const mine = fetched && fetched.system === system ? fetched : null;
  if (!mine) return { body: null, from: "none", loading: Boolean(system), agentDigest: "", runDigest, system };
  return { body: mine.body, from: mine.body ? "agent" : "none", loading: false, agentDigest: mine.digest, runDigest, system };
}

const short = (d: string) => d.slice(0, 8);

/** Where the limits shown came from, and whether they are the run's own. */
export function specLine(s: RunSpec): { tone: Tone; text: string } {
  if (s.loading) return { tone: "neutral", text: "Reading the spec…" };
  // The run's own copy needs no caption.
  if (s.from === "record") return { tone: "neutral", text: "" };
  if (s.from === "loaded") return { tone: "warn", text: "The agent's latest saved version; the run may use another." };
  if (s.from === "none") return { tone: "warn", text: "No spec for this run; journalled figures only." };
  if (s.runDigest && s.agentDigest && s.runDigest === s.agentDigest) {
    return { tone: "neutral", text: `The agent's spec today, same digest as the run (${short(s.runDigest)}).` };
  }
  if (s.runDigest && s.agentDigest) {
    return { tone: "warn", text: `The agent's spec today; changed since the run (${short(s.runDigest)} → ${short(s.agentDigest)}).` };
  }
  return { tone: "warn", text: "The agent's spec today; the run's digest cannot be compared." };
}

/* ═══════════════════ what stopped the run ═══════════════════ */

export type StopKind = "tool_calls" | "tokens" | "cost_usd" | "wall_clock_s" | "max_steps" | "reentry";

export interface Stopped {
  kind: StopKind;
  /** The step it stopped at, for a step limit or a re-entry cap. */
  node: string;
  /** The limit the runtime named, when it named one. */
  limit: number | null;
  /** The runtime's own sentence. */
  text: string;
}

const STOP_WORD: Record<StopKind, string> = {
  tool_calls: "tool call ceiling",
  tokens: "token ceiling",
  cost_usd: "cost ceiling",
  wall_clock_s: "wall-clock limit",
  max_steps: "step limit",
  reentry: "re-entry cap",
};

/** The limit that ended a run, read from the runtime's own sentence: the run's error, or a refusal against the budget control. */
export function stoppedBy(error: string, entries: LimitEntry[]): Stopped | null {
  const said = [error, ...entries.filter((e) => e.kind === "denied" && e.data?.control === "budget").map((e) => e.detail ?? "")].filter(Boolean);
  for (const text of said) {
    let m = text.match(/exceeded its budget of (\d+) tool calls/);
    if (m) return { kind: "tool_calls", node: "", limit: Number(m[1]), text };
    m = text.match(/exceeded its budget of (\d+) tokens/);
    if (m) return { kind: "tokens", node: "", limit: Number(m[1]), text };
    m = text.match(/exceeded its budget of \$([\d.eE+-]+)/);
    if (m) return { kind: "cost_usd", node: "", limit: Number(m[1]), text };
    m = text.match(/exceeded its budget of ([\d.eE+-]+)s wall-clock/);
    if (m) return { kind: "wall_clock_s", node: "", limit: Number(m[1]), text };
    m = text.match(/^(.+?) did not settle within (\d+) steps/);
    if (m) return { kind: "max_steps", node: m[1], limit: Number(m[2]), text };
    m = text.match(/^(.+?) re-entered more than (\d+) times/);
    if (m) return { kind: "reentry", node: m[1], limit: Number(m[2]), text };
  }
  return null;
}

/* ═══════════════════ bounds ═══════════════════ */

export interface StepBound {
  id: string;
  label: string;
  harness: string;
  /** Model calls one entry of the step may make; null where the step has no loop to bound. */
  maxSteps: number | null;
  /** `journal`: what the run recorded on entering the step. `spec`: the spec's word. `default`: the runtime's default. */
  maxFrom: "journal" | "spec" | "default" | "";
  stopWhen: string;
  /** False when the runtime journalled that it could not read the condition, so only the step limit held. */
  stopEnforced: boolean;
  /** The most model calls any one entry of the step made. */
  used: number;
  /** Times the run entered it. */
  entered: number;
  /** Steps listed, for a sequence. */
  listed: number;
  /** An await step's wait: how long, and what happens after. */
  wait: { timeout_s: number | null; on_timeout: string } | null;
}

/** Each step's bounds: the spec's nodes, or (with no spec) the steps the journal entered. */
export function stepBounds(spec: Rec | null, entries: LimitEntry[], visits: Record<string, number>): StepBound[] {
  // What the run itself recorded: the delegate harness journals its limit on entry.
  const journalled = new Map<string, { max: number | null; stop: string; label: string }>();
  const unenforced = new Set<string>();
  const used = new Map<string, number>();
  const entered = new Map<string, number>();
  const current = new Map<string, number>();
  for (const e of entries) {
    const node = e.node ?? "";
    if (!node) continue;
    if (e.kind === "node.enter") {
      entered.set(node, (entered.get(node) ?? 0) + 1);
      current.set(node, 0);
      const d = e.detail ?? "";
      const max = d.match(/max (\d+) steps/);
      const stop = d.match(/stop when (.+)$/);
      if (!journalled.has(node) || max) journalled.set(node, { max: max ? Number(max[1]) : null, stop: stop ? stop[1] : "", label: str(e.title) });
    } else if (e.kind === "model.call") {
      const n = (current.get(node) ?? 0) + 1;
      current.set(node, n);
      used.set(node, Math.max(used.get(node) ?? 0, n));
    } else if (e.kind === "note" && e.data?.enforced === false && e.data?.stop_when) {
      unenforced.add(node);
    }
  }
  const row = (id: string, n: Rec): StepBound => {
    const harness = str(n.harness);
    const j = journalled.get(id);
    const specMax = num(n.max_steps);
    const delegate = harness === "delegate" || (!harness && j?.max != null);
    const iface = obj(n.interface);
    return {
      id,
      label: str(n.label) || j?.label || id,
      harness,
      maxSteps: delegate ? (j?.max ?? specMax ?? RUNTIME_DEFAULT.max_steps) : null,
      maxFrom: !delegate ? "" : j?.max != null ? "journal" : specMax !== null ? "spec" : "default",
      stopWhen: str(n.stop_when) || j?.stop || "",
      stopEnforced: !unenforced.has(id),
      used: used.get(id) ?? 0,
      entered: visits[id] ?? entered.get(id) ?? 0,
      listed: arr(n.steps).length,
      wait: harness === "await" ? { timeout_s: num(iface.timeout_s), on_timeout: str(iface.on_timeout) } : null,
    };
  };
  if (spec) return arr(spec.nodes).map((n) => row(str(obj(n).id), obj(n)));
  return [...journalled.keys()].map((id) => row(id, {}));
}

const dur = (s: number): string => {
  if (s < 1) return `${Math.round(s * 1000)} ms`;
  if (s < 90) return `${Number(s.toFixed(1))} s`;
  if (s < 5400) return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
  if (s < 172_800) return `${Number((s / 3600).toFixed(1))} h`;
  return `${Number((s / 86_400).toFixed(1))} d`;
};

/* ═══════════════════ spend ═══════════════════ */

export interface SpendRow {
  key: "tool_calls" | "tokens" | "cost_usd" | "wall_clock_s";
  label: string;
  /** null when the record cannot say. */
  used: number | null;
  usedText: string;
  ceiling: number | null;
  ceilingText: string;
  /** Where the used figure and the ceiling came from. */
  basis: string;
  stopped: boolean;
}

/** The run's spend beside the spec's budget. `cost` is the ledger's price for the run's own entries; null while it is not known. */
export function spendRows(
  spec: Rec | null,
  facts: RunFacts,
  entries: LimitEntry[],
  cost: number | null,
  stopped: Stopped | null,
  /** False when the platform names tool calls as not built: the row is left out and the panel says why. */ toolCalls = true,
  /** The run's cost budget as a person raised it on a budget decision; null when it was not raised. */ raisedCost: number | null = null,
  /**
   * What the run tree said of `cost`: `priced` (a figure), `unpriced` (the ledger has a call with no price set, and
   * these models are the ones named), or `unread` (the tree was not read, so `cost` is not known either way).
   */ costFrom: { state: "priced" | "unread" } | { state: "unpriced"; models: string[] } = { state: cost === null ? "unread" : "priced" },
): SpendRow[] {
  const budget = obj(obj(spec?.policy).budget);
  const metered = (k: string) => num(facts.spent[k]);
  let tokens = 0;
  for (const e of entries) {
    if (e.kind !== "model.call") continue;
    const tk = obj(e.data?.tokens);
    tokens += (num(tk.in) ?? 0) + (num(tk.out) ?? 0);
  }
  const started = Date.parse(facts.startedAt);
  const finished = Date.parse(facts.finishedAt);
  const clocked = !Number.isNaN(started) && !Number.isNaN(finished) && finished >= started ? (finished - started) / 1000 : null;
  const journalClock = entries.length ? entries[entries.length - 1].t / 1000 : null;
  const ceiling = (k: SpendRow["key"]) => num(budget[k]);
  const none = spec ? "no ceiling set" : "ceiling not known: no spec";

  const calls = metered("tool_calls");
  const toolCallsInJournal = entries.filter((e) => e.kind === "tool.call").length;
  const callCeiling = ceiling("tool_calls") ?? (spec ? RUNTIME_DEFAULT.tool_calls : null);
  const tok = metered("tokens");
  const usd = metered("cost_usd") ?? cost;
  // The models a call used with no price set (`spent.unpriced`): while any is named, the run has no cost figure.
  const unpriced = [
    ...new Set([...(Array.isArray(facts.spent.unpriced) ? (facts.spent.unpriced as unknown[]).map(String) : []), ...(costFrom.state === "unpriced" && metered("cost_usd") === null ? costFrom.models : [])]),
  ];
  // The ledger's figure is null for a call with no price set: "no price set", even when the models are not named here.
  const ledgerUnpriced = metered("cost_usd") === null && costFrom.state === "unpriced";
  const wall = metered("wall_clock_s") ?? clocked ?? journalClock;
  const callRow: SpendRow = {
    key: "tool_calls",
    label: "Tool calls",
    used: calls ?? toolCallsInJournal,
    usedText: (calls ?? toolCallsInJournal).toLocaleString("en-GB"),
    ceiling: callCeiling,
    ceilingText: callCeiling === null ? none : ceiling("tool_calls") === null ? `${callCeiling.toLocaleString("en-GB")}, the runtime default` : callCeiling.toLocaleString("en-GB"),
    basis: calls !== null ? "counted by the runtime (spent.tool_calls)" : "the journal's recorded calls; a call refused before it was recorded is not among them",
    stopped: stopped?.kind === "tool_calls",
  };
  return [
    {
      key: "tokens",
      label: "Tokens",
      used: tok ?? tokens,
      usedText: (tok ?? tokens).toLocaleString("en-GB"),
      ceiling: ceiling("tokens"),
      ceilingText: ceiling("tokens") === null ? none : (ceiling("tokens") as number).toLocaleString("en-GB"),
      basis: tok !== null ? "counted by the runtime, checked after each model reply" : "in and out, summed from the journal's model calls",
      stopped: stopped?.kind === "tokens",
    },
    {
      key: "cost_usd",
      label: "Cost",
      used: usd,
      usedText:
        usd === null || unpriced.length
          ? unpriced.length
            ? `not priced: ${unpriced.join(", ")} ${unpriced.length === 1 ? "has" : "have"} no price set`
            : ledgerUnpriced
              ? "no price set"
              : costFrom.state === "unread"
                ? "not read"
                : "not priced"
          : fmtUsd(usd),
      ceiling: raisedCost ?? ceiling("cost_usd"),
      ceilingText: raisedCost !== null ? `${fmtUsd(raisedCost)}, raised on a budget decision` : ceiling("cost_usd") === null ? none : fmtUsd(ceiling("cost_usd") as number),
      basis: unpriced.length
        ? "a model call used a model with no price set on the Models tab, so the platform keeps no cost figure for this run"
        : metered("cost_usd") !== null
          ? "counted by the runtime at the prices set on the Models tab"
          : cost !== null
            ? "priced as the ledger prices it"
            : ledgerUnpriced
              ? "a model call in this run or a run below it had no price set on the Models tab, so the ledger keeps no cost figure"
              : costFrom.state === "unread"
                ? "the run tree, which carries the ledger's price, could not be read"
                : "the platform keeps no cost figure for this run",
      stopped: stopped?.kind === "cost_usd",
    },
    {
      key: "wall_clock_s",
      label: "Wall clock",
      used: wall,
      usedText: wall === null ? "not recorded" : dur(wall),
      ceiling: ceiling("wall_clock_s"),
      ceilingText: ceiling("wall_clock_s") === null ? none : dur(ceiling("wall_clock_s") as number),
      basis: metered("wall_clock_s") !== null ? "counted by the runtime, checked between steps" : clocked !== null ? "from the record's start and finish" : "the journal's clock, which restarts when a run resumes",
      stopped: stopped?.kind === "wall_clock_s",
    },
    ...(toolCalls ? [callRow] : []),
  ];
}

/* ═══════════════════ budget pauses ═══════════════════ */

/** One pause at a budget, from the journal, and the decision that ended it when the journal holds one. */
export interface BudgetPause {
  hold: string;
  scope: string;
  key: string;
  amount: number | null;
  spent: number | null;
  detail: string;
  /** A "continue" decision (a stop is recorded as the run's stop, not as a note). */
  decided: { raise_to: number | null; by: string; note: string } | null;
}

/** An amount to the millionth of a dollar the service records, so a budget of $0.000001 is not shown as $0. */
const usd = (n: number) => (Math.abs(n) < 0.01 ? `$${n.toFixed(6).replace(/0+$/, "").replace(/\.$/, ".00")}` : fmtUsd(n));

/** The run's pauses at a budget: each "Paused at its budget" note, with the "Budget decision" note for the same hold. */
export function budgetPauses(entries: LimitEntry[]): BudgetPause[] {
  const out: BudgetPause[] = [];
  for (const e of entries) {
    const d = e.data ?? {};
    if (e.kind !== "note" || d.control !== "budget" || !str(d.hold)) continue;
    if (d.decision === "continue") {
      const p = out.find((x) => x.hold === str(d.hold));
      if (p) p.decided = { raise_to: num(d.raise_to_usd), by: str(d.by), note: str(d.note) };
      continue;
    }
    out.push({ hold: str(d.hold), scope: str(d.scope), key: str(d.key), amount: num(d.amount_usd), spent: num(d.spent_usd), detail: e.detail ?? "", decided: null });
  }
  return out;
}

const budgetWords = (p: BudgetPause) => (p.scope === "run" ? "its own budget" : p.scope === "deployment" ? "the deployment's period budget" : p.scope === "use_case" ? `the period budget of the use case ${p.key}` : "a budget");

/**
 * Whether the run's latest pause still waits on a person: the waiting holds
 * (`GET /api/budget/holds?state=waiting`) are read when the journal holds a
 * pause with no decision after it, and again as the journal grows.
 */
function useWaitingHold(runId: string | undefined, pauses: BudgetPause[]): { waiting: Rec | null; error: string } {
  const open = pauses.length > 0 && !pauses[pauses.length - 1].decided ? pauses[pauses.length - 1].hold : "";
  const [found, setFound] = useState<{ hold: string; waiting: Rec | null; error: string } | null>(null);
  useEffect(() => {
    if (!open || !runId) return;
    let live = true;
    fetch("/api/budget/holds?state=waiting")
      .then(async (r) => {
        const d = (await r.json().catch(() => null)) as Rec | null;
        if (!r.ok || !d || !Array.isArray(d.holds)) throw new Error(errorText(d, r, "GET", "/api/budget/holds"));
        return (d.holds as Rec[]).find((h) => h.run === runId && h.id === open) ?? null;
      })
      .then((h) => live && setFound({ hold: open, waiting: h, error: "" }))
      .catch((e: Error) => live && setFound({ hold: open, waiting: null, error: e.message }));
    return () => {
      live = false;
    };
  }, [open, runId]);
  return found && found.hold === open ? { waiting: found.waiting, error: found.error } : { waiting: null, error: "" };
}

function BudgetPauses({ pauses, hold, stoppedText }: { pauses: BudgetPause[]; hold: { waiting: Rec | null; error: string }; stoppedText: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-line px-4 py-2 text-[11.5px] leading-[1.5]">
      {pauses.map((p, i) => {
        const last = i === pauses.length - 1;
        return (
          <p key={p.hold} className="text-dim">
            <span className="font-medium text-fg">Paused at {budgetWords(p)}</span>
            {p.amount !== null && p.spent !== null ? ` (${usd(p.spent)} spent of ${usd(p.amount)})` : ""}.{" "}
            {p.decided ? (
              <span>
                {p.decided.by || "A person"} let it go on: {p.scope === "run" ? `its budget raised to ${p.decided.raise_to !== null ? usd(p.decided.raise_to) : "an amount not recorded"}` : `until the period's spend reaches ${p.decided.raise_to !== null ? usd(p.decided.raise_to) : "an amount not recorded"}`}
                {p.decided.note ? `. ${p.decided.note}` : ""}.
              </span>
            ) : last && hold.waiting ? (
              <span className="text-warn">
                Waits for a budget decision on <Link href="/approvals" className="underline">Approvals</Link>.
              </span>
            ) : last && stoppedText ? (
              <span className="text-err">{stoppedText[0].toUpperCase() + stoppedText.slice(1)}.</span>
            ) : last && hold.error ? (
              <span className="text-err">Whether it still waits could not be read: {hold.error}</span>
            ) : (
              <span className="text-faint">{p.detail}</span>
            )}
          </p>
        );
      })}
    </div>
  );
}

/* ═══════════════════ the strip the panels sit in ═══════════════════ */

/** A collapsible strip under the theater, in the trace panel's idiom: a line that says the gist, a body on request. */
export function RunStrip({ title, summary, mark, open, onToggle, children }: { title: string; summary: ReactNode; mark?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="shrink-0 border-t border-line bg-surface">
      <button type="button" onClick={onToggle} aria-expanded={open} className="focusable flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 px-4 py-1.5 text-left hover:bg-raise/40">
        <span className="grid size-3.5 shrink-0 place-items-center text-dim transition-transform" style={{ transform: open ? "rotate(90deg)" : "none" }} aria-hidden>
          <svg viewBox="0 0 16 16" width="9" height="9" fill="none">
            <path d="M5.5 3.5 10.5 8l-5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="shrink-0 text-[11.5px] font-medium">{title}</span>
        <span className="min-w-0 text-[10.5px] text-faint">{summary}</span>
        {mark}
      </button>
      {open && children}
    </div>
  );
}

const TH = "px-3 py-1 text-left text-[10px] font-medium text-faint";
const TD = "px-3 py-1.5 align-top text-[11.5px]";

function StoppedMark({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex shrink-0">
      <Tag tone="err" solid>
        {children}
      </Tag>
    </span>
  );
}

/** The bounds table: each step, then the run-wide limits. Presentational. */
export function BoundsView({ spec, steps, stopped, visits }: { spec: Rec | null; steps: StepBound[]; stopped: Stopped | null; visits: Record<string, number> }) {
  const policy = obj(spec?.policy);
  const depth = num(obj(policy.delegation).max_depth);
  const wall = num(obj(policy.budget).wall_clock_s);
  // A re-entry cap, should a spec carry one: on the policy, or on a step.
  const reentry = num(policy.max_visits) ?? num(obj(policy.reentry).max);
  const most = Object.entries(visits).sort((a, b) => b[1] - a[1])[0];
  const unknown = "not known: no spec";
  return (
    <div className="flex min-w-0 flex-col">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th className={TH}>Step</th>
              <th className={TH}>Step limit</th>
              <th className={TH}>Used</th>
              <th className={TH}>Stop condition</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((s) => {
              const hit = (stopped?.kind === "max_steps" || stopped?.kind === "reentry") && stopped.node === s.id;
              const nodeCap = num(obj(arr(spec?.nodes).find((n) => obj(n).id === s.id)).max_visits);
              return (
                <tr key={s.id} className={`border-b border-line/70 last:border-b-0 ${hit ? "bg-err-bg/60" : ""}`}>
                  <td className={TD}>
                    <span className="block font-medium text-fg">{s.label}</span>
                    <span className="font-mono text-[10px] whitespace-nowrap text-ghost">
                      {s.id}
                      {s.harness ? ` · ${s.harness}` : ""}
                    </span>
                  </td>
                  <td className={`${TD} text-dim`}>
                    {s.maxSteps !== null ? (
                      <>
                        <span className="tnum text-fg">{s.maxSteps}</span> model call{s.maxSteps === 1 ? "" : "s"}
                        <span className="block text-[10px] text-faint">{s.maxFrom === "journal" ? "as the run journalled on entry" : s.maxFrom === "spec" ? "from the spec" : "runtime default, the spec sets none"}</span>
                      </>
                    ) : s.wait ? (
                      <>
                        Waits for a person{s.wait.timeout_s !== null ? `, up to ${dur(s.wait.timeout_s)}` : ""}
                        {s.wait.timeout_s !== null && <span className="block text-[10px] text-faint">then: {s.wait.on_timeout === "escalate" ? "escalates; fails when no role is left" : "the run fails"}</span>}
                      </>
                    ) : s.harness === "sequence" ? (
                      <>
                        No loop to bound
                        <span className="block text-[10px] text-faint">
                          runs its {s.listed} listed step{s.listed === 1 ? "" : "s"} once
                        </span>
                      </>
                    ) : s.harness ? (
                      <span className="text-faint">Not set</span>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                    {nodeCap !== null && <span className="block text-[10px] text-faint">re-entry cap {nodeCap}</span>}
                  </td>
                  <td className={`${TD} text-dim`}>
                    {s.entered === 0 ? (
                      <span className="text-faint">not reached</span>
                    ) : s.maxSteps !== null ? (
                      <span className="flex min-w-[96px] flex-col gap-1">
                        <span className="tnum">
                          <span className="text-fg">{s.used}</span> of {s.maxSteps}
                        </span>
                        <Meter value={s.used / s.maxSteps} tone={hit ? "err" : s.used / s.maxSteps >= 0.8 ? "warn" : "run"} />
                        {s.entered > 1 && <span className="text-[10px] text-faint">most in one of {s.entered} entries</span>}
                      </span>
                    ) : (
                      <span className="tnum">
                        entered {s.entered === 1 ? "once" : `${s.entered} times`}
                        {s.used ? ` · ${s.used} model call${s.used === 1 ? "" : "s"}` : ""}
                      </span>
                    )}
                    {hit && (
                      <span className="mt-1 block">
                        <StoppedMark>stopped the run</StoppedMark>
                      </span>
                    )}
                  </td>
                  <td className={`${TD} text-dim`}>
                    {s.stopWhen ? (
                      <>
                        <code className="font-mono text-[11px] break-words text-fg">{s.stopWhen}</code>
                        {!s.stopEnforced && <span className="block text-[10px] text-warn">unreadable: only the step limit held</span>}
                      </>
                    ) : s.maxSteps !== null ? (
                      <span className="text-faint">Not set</span>
                    ) : (
                      <span className="text-ghost">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {steps.length === 0 && (
              <tr>
                <td colSpan={4} className={`${TD} text-faint`}>
                  No step known.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 border-t border-line px-3 py-2.5 sm:grid-cols-3">
        <div className="flex flex-col gap-0.5">
          <dt className="flex items-center gap-2 text-[10px] font-medium text-faint">
            Wall clock
            {stopped?.kind === "wall_clock_s" && <StoppedMark>stopped the run</StoppedMark>}
          </dt>
          <dd className="text-[11.5px] text-dim">
            {!spec ? <span className="text-faint">{unknown}</span> : wall !== null ? <span className="tnum text-fg">{dur(wall)}</span> : "Not set"}
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="flex items-center gap-2 text-[10px] font-medium text-faint">
            Re-entry cap
            {stopped?.kind === "reentry" && <StoppedMark>stopped the run</StoppedMark>}
          </dt>
          <dd className="text-[11.5px] text-dim">
            {reentry !== null ? (
              <>
                <span className="tnum text-fg">{reentry}</span> entries of one step
              </>
            ) : stopped?.kind === "reentry" && stopped.limit !== null ? (
              <>
                <span className="tnum text-fg">{stopped.limit}</span>, the runtime&rsquo;s cap
                <span className="block text-[10px] text-faint">the runtime stopped {stopped.node} after {stopped.limit} entries</span>
              </>
            ) : (
              <>
                <span className="tnum text-fg">{RUNTIME_DEFAULT.max_visits}</span> entries of one step, the runtime&rsquo;s cap
              </>
            )}
            {most && most[1] > 0 && <span className="block text-[10px] text-faint">most entries of one step in this run: {most[1]} ({most[0]})</span>}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** Used of allowed, with a meter where there is a ceiling. Presentational. */
export function SpendView({ rows }: { rows: SpendRow[] }) {
  return (
    <ul className="flex min-w-0 flex-col">
      {rows.map((r) => {
        const ratio = r.used !== null && r.ceiling ? r.used / r.ceiling : null;
        return (
          <li key={r.key} className={`flex flex-col gap-1 border-b border-line/70 px-4 py-2 last:border-b-0 ${r.stopped ? "bg-err-bg/60" : ""}`}>
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[11px] font-medium text-dim">{r.label}</span>
              {r.stopped && <StoppedMark>stopped the run</StoppedMark>}
              <span className="grow" />
              <span className="tnum text-[12px] text-dim">
                <span className={`font-semibold ${r.used === null ? "text-faint" : "text-fg"}`}>{r.usedText}</span>
                {r.ceiling !== null ? ` of ${r.ceilingText}` : ` · ${r.ceilingText}`}
              </span>
            </span>
            {ratio !== null && <Meter value={ratio} tone={r.stopped ? "err" : ratio >= 0.8 ? "warn" : "run"} />}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The strip on a run's page: bounds on the left, spend against the ceiling
 * on the right. It opens by itself when a limit ended the run, because then
 * it is the answer to why the run stopped.
 */
export function RunLimitsPanel({
  runId,
  spec,
  facts,
  entries,
  error,
  live,
  open: asked = null,
  onToggle,
}: {
  runId?: string;
  spec: RunSpec;
  facts: RunFacts;
  entries: LimitEntry[];
  /** The run's error, as the record or the stream gave it. */
  error: string;
  /** The run is in flight: the figures are so far. */
  live: boolean;
  /** Whether the strip is open, when the page decides (it keeps one of its strips open at a time); null leaves it to the strip. */
  open?: boolean | null;
  onToggle?: (open: boolean) => void;
}) {
  const stopped = stoppedBy(error, entries);
  const [chosen, setChosen] = useState<boolean | null>(null);
  // The ledger's price for this run's own entries: the run tree's node for it.
  const { tree } = useRunTree(runId, live);
  const own = tree?.nodes.find((n) => n.run === tree.asked);
  // The record's row (its sub-runs folded in) when the tree has it, else its own figure. A null there is a call with no
  // price set: it never falls through to a priced figure that leaves that call out.
  const cost = own ? (own.listed ? own.listed.cost : own.cost) : null;
  const costFrom = !own ? { state: "unread" as const } : cost === null ? { state: "unpriced" as const, models: own.unpriced } : { state: "priced" as const };
  /** The run ledger's not-built list: tool calls are neither made nor counted while it names them. */
  const [ledgerNotBuilt, setLedgerNotBuilt] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    // A failed read names nothing as not built: the strip shows the calls it counted, as it would with the list read.
    void readRunRowsNotBuilt().then((r) => alive && setLedgerNotBuilt(r.ok ? r.list : []));
    return () => {
      alive = false;
    };
  }, []);
  // Left out only while the ledger names a run's tool calls as not built and this run shows none: a run that made a call,
  // or was stopped by its tool-call ceiling, always shows the row.
  const toolCallsUnbuilt = notBuilt(ledgerNotBuilt, "toolCalls") && !entries.some((e) => e.kind === "tool.call") && stopped?.kind !== "tool_calls";
  const pauses = budgetPauses(entries);
  const hold = useWaitingHold(runId, pauses);
  const waitingOnBudget = Boolean(hold.waiting);
  // A stop decided on a budget hold ends the run as a kill does: "killed by operator: stopped at its budget by <who>: <reason>".
  const budgetStop = error.match(/stopped at its budget by .+$/)?.[0] ?? "";
  const stoppedAtBudget = Boolean(budgetStop);
  const raised = [...pauses].reverse().find((p) => p.scope === "run" && p.decided?.raise_to != null)?.decided?.raise_to ?? null;
  const rows = spendRows(spec.body, facts, entries, cost, stopped, !toolCallsUnbuilt, raised, costFrom);
  // Left to itself, the strip opens when a limit ended the run, or while it waits on a decision on its budget.
  const open = asked ?? chosen ?? (Boolean(stopped) || waitingOnBudget);
  const steps = stepBounds(spec.body, entries, facts.visits);
  const tokRow = rows[0];
  const usd = rows[1];
  const from = specLine(spec);
  return (
    <RunStrip
      title="Limits and spend"
      open={open}
      onToggle={() => {
        setChosen(!open);
        onToggle?.(!open);
      }}
      summary={
        <>
          {tokRow.usedText}
          {tokRow.ceiling !== null ? ` of ${tokRow.ceilingText}` : ""} tokens · {usd.usedText}
          {usd.ceiling !== null ? ` of ${usd.ceilingText}` : usd.used !== null ? `, ${usd.ceilingText}` : ""}
          {live ? " · so far" : ""}
        </>
      }
      mark={stopped ? <Status tone="err">stopped by its {STOP_WORD[stopped.kind]}</Status> : waitingOnBudget ? <Status tone="warn">waiting on a decision on its budget</Status> : stoppedAtBudget ? <Status tone="err">stopped on a budget decision</Status> : undefined}
    >
      <div className="max-h-[320px] overflow-y-auto border-t border-line">
        {from.text && <p className={`border-b border-line px-4 py-1.5 text-[11px] leading-[1.5] ${from.tone === "warn" ? "text-warn" : "text-faint"}`}>{from.text}</p>}
        {pauses.length > 0 && <BudgetPauses pauses={pauses} hold={hold} stoppedText={budgetStop} />}
        {stopped && (
          <p className="border-b border-line bg-err-bg/60 px-4 py-1.5 text-[11.5px] leading-[1.5] text-err">
            This run was stopped by its {STOP_WORD[stopped.kind]}
            {stopped.node ? ` at ${stopped.node}` : ""}: {stopped.text}
          </p>
        )}
        <div className="grid gap-px bg-line lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="min-w-0 bg-surface" aria-label="Bounds">
            <h3 className="border-b border-line px-3 py-1.5 text-[11px] font-semibold text-dim">Bounds this run was under</h3>
            <BoundsView spec={spec.body} steps={steps} stopped={stopped} visits={facts.visits} />
          </section>
          <section className="min-w-0 bg-surface" aria-label="Spend against ceiling">
            <h3 className="border-b border-line px-4 py-1.5 text-[11px] font-semibold text-dim">
              Spend against ceiling{live ? " · so far" : ""}
            </h3>
            <SpendView rows={rows} />
            {toolCallsUnbuilt && <p className="px-4 py-2 text-[10px] leading-[1.45] text-faint">Tool calls: not built</p>}
          </section>
        </div>
      </div>
    </RunStrip>
  );
}
