"use client";
import { Failure } from "./pending";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Status, Tag } from "./ui";
import { Checkbox, Field, Input } from "./forms";
import { Pick } from "./select";
import { ChipEditor } from "./gate-form";
import { OpenChanges, ProposalNote } from "./policy";
import { hueFor } from "@/lib/hue";
import { soon } from "@/lib/soon";
import { useSession } from "@/lib/use-session";
import { errorText } from "@/lib/api/client";
import { listAgents } from "@/lib/api/l2";
import { DoorError } from "@/lib/api/l5";
import { proposePolicyChange, type PolicyChange } from "@/lib/api/l9";
import { effectiveAt, effectiveProblem, proposedField, proposedLine } from "@/lib/policy";

/**
 * The guardian: a watcher that holds runs in flight to limits a person set
 * (tool calls per run, cost per run, refused calls per run). Past a limit it
 * does what the person chose for that limit: holds the run's next call at or
 * above write for a person, stops the run, or only raises it on the attention
 * queue. It also raises, rather than acts, when it cannot decide: a run whose
 * cost is unknown because a model has no price set. Every act is signed
 * "guardian" on the run's record. With no limit set it does nothing.
 *
 * The limits change only through a reviewed policy change (`POST
 * /api/policy/changes`, target `guardian`): someone other than the proposer
 * approves it on the Policy page, and `PUT /api/guardian` answers 409 naming
 * that door. `GET /api/guardian` and `GET /api/guardian/actions` are read
 * here as the backend writes them (its guardian is not the model judge
 * lib/api/l7.ts describes).
 */

type Act = "hold" | "stop" | "raise";
const ACTS: { value: Act; label: string }[] = [
  { value: "hold", label: "Hold its next call at or above write for a person" },
  { value: "stop", label: "Stop the run" },
  { value: "raise", label: "Only raise it for a person" },
];
const LIMITS = [
  { name: "tool_calls_per_run", on: "on_tool_calls", label: "Tool calls one run may make", unit: "calls", hint: "a whole number; empty is off" },
  { name: "cost_per_run_usd", on: "on_cost", label: "What one run may cost, in US dollars", unit: "USD", hint: "above 0; empty is off" },
  { name: "refusals_per_run", on: "on_refusals", label: "Refused calls one run may have", unit: "refusals", hint: "a whole number; empty is off" },
] as const;
type LimitName = (typeof LIMITS)[number]["name"];
type OnName = (typeof LIMITS)[number]["on"];

interface Rules {
  tool_calls_per_run: number | null;
  cost_per_run_usd: number | null;
  refusals_per_run: number | null;
  on_tool_calls: Act;
  on_cost: Act;
  on_refusals: Act;
  agents: string[] | "*";
}

interface View {
  enabled: boolean;
  rules: Rules;
  says: string;
  change: string;
  set_at: string | null;
  set_by: string;
  every_s: number;
  watching: number;
  actions_last_hour: number;
  counts: { acted: number; attention: number; failed: number };
}

interface Action {
  id: string;
  at: string;
  run: string;
  agent: string;
  limit: string;
  measured: number | null;
  limit_value: number;
  action: Act;
  outcome: "acted" | "attention" | "failed";
  why: string;
  change: string;
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const act = (v: unknown): Act => (v === "hold" || v === "stop" ? v : "raise");

function viewOf(v: unknown): View {
  const o = obj(v);
  const r = obj(o.rules);
  const c = obj(o.counts);
  return {
    enabled: o.enabled === true,
    rules: {
      tool_calls_per_run: num(r.tool_calls_per_run), cost_per_run_usd: num(r.cost_per_run_usd), refusals_per_run: num(r.refusals_per_run),
      on_tool_calls: act(r.on_tool_calls), on_cost: act(r.on_cost), on_refusals: act(r.on_refusals),
      agents: r.agents === "*" ? "*" : Array.isArray(r.agents) ? r.agents.filter((a): a is string => typeof a === "string") : "*",
    },
    says: str(o.says), change: str(o.change), set_at: str(o.set_at) || null, set_by: str(o.set_by), every_s: num(o.every_s) ?? 0,
    watching: num(o.watching) ?? 0, actions_last_hour: num(o.actions_last_hour) ?? 0,
    counts: { acted: num(c.acted) ?? 0, attention: num(c.attention) ?? 0, failed: num(c.failed) ?? 0 },
  };
}

function actionOf(v: unknown): Action {
  const o = obj(v);
  const outcome = o.outcome === "acted" || o.outcome === "failed" ? o.outcome : "attention";
  return { id: str(o.id), at: str(o.at), run: str(o.run), agent: str(o.agent), limit: str(o.limit), measured: num(o.measured), limit_value: num(o.limit_value) ?? 0,
           action: act(o.action), outcome, why: str(o.why), change: str(o.change) };
}

async function read<T>(path: string, parse: (v: unknown) => T): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  const d: unknown = await res.json().catch(() => null);
  if (!res.ok || !d || obj(d).error) throw new Error(errorText(d, res, "GET", path.split("?")[0]));
  return parse(d);
}

/** What the form holds: text for the numbers until sent, so a half-typed value is not lost. */
interface Form {
  limits: Record<LimitName, string>;
  acts: Record<OnName, Act>;
  every: boolean;
  agents: string[];
}

function formOf(r: Rules): Form {
  return {
    limits: { tool_calls_per_run: r.tool_calls_per_run === null ? "" : String(r.tool_calls_per_run), cost_per_run_usd: r.cost_per_run_usd === null ? "" : String(r.cost_per_run_usd),
              refusals_per_run: r.refusals_per_run === null ? "" : String(r.refusals_per_run) },
    acts: { on_tool_calls: r.on_tool_calls, on_cost: r.on_cost, on_refusals: r.on_refusals },
    every: r.agents === "*",
    agents: r.agents === "*" ? [] : r.agents,
  };
}

/** The fields that moved, as the policy door takes them, and what is wrong before anything is sent. */
function patchOf(r: Rules, f: Form): { patch: Record<string, unknown>; problems: Record<string, string> } {
  const patch: Record<string, unknown> = {};
  const problems: Record<string, string> = {};
  for (const l of LIMITS) {
    const text = f.limits[l.name].trim();
    const value = text === "" ? null : Number(text);
    if (value !== null && (!Number.isFinite(value) || value <= 0 || (l.name !== "cost_per_run_usd" && !Number.isInteger(value)))) {
      problems[l.name] = l.name === "cost_per_run_usd" ? "a number above 0, or empty for off" : "a whole number of 1 or more, or empty for off";
      continue;
    }
    if (value !== r[l.name]) patch[l.name] = value;
    if (f.acts[l.on] !== r[l.on]) patch[l.on] = f.acts[l.on];
  }
  const agents = f.every ? "*" : f.agents;
  if (!f.every && !f.agents.length) problems.agents = "name at least one agent, or watch every agent";
  else if (JSON.stringify(agents) !== JSON.stringify(r.agents)) patch.agents = agents;
  return { patch, problems };
}

function ago(iso: string | null): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!iso || Number.isNaN(t)) return iso || "never";
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

type Filter = "all" | "acted" | "attention";

export function Guardian() {
  const { can, loaded } = useSession();
  const editable = !loaded || can("configure");
  const [view, setView] = useState<View | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [dirty, setDirty] = useState(false);
  const [actions, setActions] = useState<Action[] | null>(null);
  const [known, setKnown] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [actionsError, setActionsError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<PolicyChange | null>(null);
  const [saveError, setSaveError] = useState("");
  const [reason, setReason] = useState("");
  const [effective, setEffective] = useState("");
  const [proposals, setProposals] = useState(0);
  const [refused, setRefused] = useState<{ field: string; error: string } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const dirtyRef = useRef(false);

  const load = useCallback(() => {
    read("/api/guardian", viewOf)
      .then((v) => {
        setView(v);
        setError("");
        setForm((f) => (f && dirtyRef.current ? f : formOf(v.rules)));
      })
      .catch((e) => setError((e as Error).message));
    read("/api/guardian/actions?limit=200", (d) => (Array.isArray(obj(d).actions) ? (obj(d).actions as unknown[]) : []).map(actionOf))
      .then((a) => {
        setActions(a);
        setActionsError("");
      })
      .catch((e) => setActionsError((e as Error).message));
  }, []);
  useEffect(() => {
    const cancel = soon(load);
    const id = setInterval(load, 5000);
    listAgents()
      .then((rows) => setKnown(rows.map((a) => a.id)))
      .catch((e) => setError(`The agents could not be read: ${(e as Error).message}`));
    return () => {
      cancel();
      clearInterval(id);
    };
  }, [load]);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const edit = (next: Form) => {
    setForm(next);
    setDirty(true);
    setSaved(null);
    setSaveError("");
    setRefused(null);
  };
  const { patch, problems } = view && form ? patchOf(view.rules, form) : { patch: {}, problems: {} as Record<string, string> };
  const changed = Object.keys(patch);
  const problemOf = (field: string): string | undefined => problems[field] ?? (refused?.field === field ? refused.error : undefined);
  const blocked = !changed.length || Object.keys(problems).length > 0 || !reason.trim() || Boolean(effectiveProblem(effective));

  const propose = async () => {
    if (!view || !form || blocked) return;
    setSaving(true);
    setSaveError("");
    try {
      const c = await proposePolicyChange({ target: { kind: "guardian" }, proposed: patch, effective_at: effectiveAt(effective), reason: reason.trim() });
      setForm(formOf(view.rules));
      setDirty(false);
      setReason("");
      setEffective("");
      setSaved(c);
      setProposals((n) => n + 1);
    } catch (e) {
      const field = e instanceof DoorError && e.status === 400 ? proposedField(e) : null;
      if (field) {
        setRefused({ field, error: (e as Error).message });
        setSaveError(`Not proposed: ${field.replace(/_/g, " ")} is marked above.`);
      } else setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const shown = (actions ?? []).filter((a) => filter === "all" || (filter === "acted" ? a.outcome === "acted" : a.outcome !== "acted"));
  const quietDown = Boolean(error) && !view;
  const locked = !editable || quietDown;
  const f = form;

  return (
    <div className="mx-auto w-full max-w-[1520px] px-5 py-7" data-hue="red">
      <header className="flex flex-wrap items-end gap-4">
        <div className="flex max-w-[86ch] flex-col gap-1.5">
          <span className="flex items-center gap-3">
            <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">Guardian</h1>
            {view && <Status tone={view.enabled ? "ok" : "neutral"}>{view.enabled ? "watching" : "no limit set"}</Status>}
          </span>
          <p className="text-[12.5px] leading-[1.6] text-dim">Holds runs in flight to the limits set here.</p>
        </div>
      </header>

      {error && <Failure className="mt-4" what="The guardian could not be read" message={error} />}
      {actionsError && <Failure className="mt-2" what="The guardian's actions could not be read" message={actionsError} />}

      <div className="mt-5 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
          <div data-hue={hueFor("approvals person")} className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/55 px-4 py-2.5">
            <span className="text-[12px] font-semibold">Limits</span>
            <span className="text-[11px] text-faint">
              {view ? (view.change ? `set by policy change ${view.change}, approved by ${view.set_by}, ${ago(view.set_at)}` : "never set: no limit") : quietDown ? "not read" : "reading…"}
            </span>
          </div>
          {quietDown ? (
            <p className="px-4 py-4 text-[12px] text-faint">Not read.</p>
          ) : !f || !view ? (
            <p className="px-4 py-4 text-[12px] text-faint">Reading the guardian&rsquo;s limits…</p>
          ) : (
            <div className="flex flex-col gap-4 px-4 py-4">
              {!editable && <p className="text-[11.5px] text-warn">Proposing needs the configure permission.</p>}
              {editable && <p className="text-[11px] text-faint">Changes go to review on the Policy page.</p>}
              <OpenChanges target={{ kind: "guardian", id: "estate" }} tick={proposals} />
              {LIMITS.map((l) => (
                <div key={l.name} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
                  <Field label={l.label} error={problemOf(l.name)} hint={l.hint}>
                    <Input type="number" value={f.limits[l.name]} onChange={(v) => edit({ ...f, limits: { ...f.limits, [l.name]: v } })} disabled={locked} />
                  </Field>
                  <Field label="Past it" error={problemOf(l.on)}>
                    <Pick value={f.acts[l.on]} onChange={(v) => edit({ ...f, acts: { ...f.acts, [l.on]: act(v) } })} options={ACTS} disabled={locked} />
                  </Field>
                </div>
              ))}
              <div className="flex flex-col gap-2">
                <span className="text-[12.5px] font-medium text-mist">Agents it watches</span>
                <Checkbox label="Every agent" checked={f.every} onChange={(on) => edit({ ...f, every: on })} disabled={locked} />
                {!f.every && (
                  <>
                    <ChipEditor values={f.agents} onChange={(v) => edit({ ...f, agents: v })} disabled={locked} placeholder="Agent ids, Enter after each" invalid={Boolean(problemOf("agents"))} />
                    {problemOf("agents") && <span className="text-[11px] text-err">{problemOf("agents")}</span>}
                    {editable && known.filter((k) => !f.agents.includes(k)).length > 0 && (
                      <span className="flex flex-wrap items-center gap-1">
                        <span className="text-[10.5px] text-ghost">add</span>
                        {known
                          .filter((k) => !f.agents.includes(k))
                          .slice(0, 12)
                          .map((k) => (
                            <Button key={k} size="sm" variant="solid" tone="neutral" permission="configure" onClick={() => edit({ ...f, agents: [...f.agents, k] })}>
                              {k}
                            </Button>
                          ))}
                      </span>
                    )}
                  </>
                )}
              </div>
              {changed.length > 0 && <ProposalNote reason={reason} onReason={setReason} effective={effective} onEffective={setEffective} disabled={locked} />}
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <Button variant="solid" tone="ink" size="sm" permission="configure" disabled={blocked} loading={saving} onClick={propose}>
                  {changed.length ? `Propose ${changed.length} change${changed.length === 1 ? "" : "s"}` : "No changes"}
                </Button>
                {dirty && (
                  <Button
                    variant="solid"
                    tone="err"
                    size="sm"
                    onClick={() => {
                      setForm(formOf(view.rules));
                      setDirty(false);
                    }}
                  >
                    Discard
                  </Button>
                )}
                {changed.length > 0 && <span className="text-[11px] text-faint">{reason.trim() ? `Proposes only ${changed.join(", ")}; the rest keep their value.` : "A change needs a reason."}</span>}
                {saved && (
                  <Link href={`/policy?change=${encodeURIComponent(saved.id)}`} className="focusable rounded-sm text-[11.5px] text-ok hover:underline">
                    {proposedLine(saved)}
                  </Link>
                )}
                {saveError && <Failure inline message={saveError} />}
              </div>
            </div>
          )}
        </section>

        <section className="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
          <div data-hue={hueFor("activity")} className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/55 px-4 py-2.5">
            <span className="text-[12px] font-semibold">On record</span>
            <span className="text-[11px] text-faint">{view ? (view.enabled ? `watching ${view.watching} run${view.watching === 1 ? "" : "s"} in flight` : "watching nothing") : ""}</span>
          </div>
          {view ? (
            <div className="grid grid-cols-2 gap-px bg-line">
              {[
                { k: "acted", v: view.counts.acted, tone: view.counts.acted ? "text-err" : "" },
                { k: "raised for a person", v: view.counts.attention, tone: view.counts.attention ? "text-warn" : "" },
                { k: "could not act", v: view.counts.failed, tone: view.counts.failed ? "text-err" : "" },
                { k: "in the last hour", v: view.actions_last_hour, tone: "" },
              ].map((x) => (
                <div key={x.k} className="flex flex-col gap-0.5 bg-surface px-3 py-2">
                  <span className={`tnum text-[15px] leading-none font-semibold ${x.tone}`}>{x.v}</span>
                  <span className="text-[10px] text-faint">{x.k}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-4 py-4 text-[12px] text-faint">{quietDown ? "Not read." : "Reading…"}</p>
          )}
        </section>
      </div>

      <section className="mt-4 flex flex-col overflow-hidden rounded-md border border-line bg-surface">
        <div data-hue={hueFor("guardrail")} className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/55 px-4 py-2.5">
          <span className="text-[12px] font-semibold">What it did</span>
          <span className="text-[11px] text-faint">{actions ? `${actions.length} on record, newest first` : actionsError ? "not read" : "reading…"}</span>
          <span className="grow" />
          <span role="radiogroup" aria-label="Show" className="inline-flex items-center gap-px rounded-md border border-line bg-raise p-px">
            {(["all", "acted", "attention"] as Filter[]).map((x) => (
              <button
                key={x}
                type="button"
                role="radio"
                aria-checked={filter === x}
                onClick={() => setFilter(x)}
                className={`focusable cursor-pointer rounded-sm px-2 py-0.5 text-[11px] transition-colors ${filter === x ? "bg-surface font-semibold text-fg shadow-[var(--shadow-1)]" : "font-medium text-faint hover:text-dim"}`}
              >
                {x === "all" ? "All" : x === "acted" ? "Acted" : "Raised, or could not act"}
              </button>
            ))}
          </span>
        </div>
        <div className="overflow-x-auto">
          {shown.length > 0 && <GuardianActionsTable actions={shown} />}
          {!actions && actionsError && <p className="px-4 py-4 text-[12px] text-faint">Not read.</p>}
          {actions && shown.length === 0 && <p className="px-4 py-4 text-[12px] text-faint">{actions.length ? "None of this kind." : "The guardian has not acted on any run yet."}</p>}
        </div>
      </section>
    </div>
  );
}

/** What the guardian did, as rows: when, the run (a link), the limit and what was measured, what it did, and why. Each row is read as the backend writes it. */
export function GuardianActionsTable({ actions }: { actions: readonly object[] }) {
  return (
    <table className="w-full min-w-[980px] border-collapse text-[11.5px]">
      <thead>
        <tr className="border-b border-line bg-raise/40 text-left text-[10.5px] text-faint">
          <th className="px-4 py-1.5 font-medium">When</th>
          <th className="px-3 py-1.5 font-medium">Run</th>
          <th className="px-3 py-1.5 font-medium">Limit</th>
          <th className="px-3 py-1.5 font-medium">What it did</th>
          <th className="px-4 py-1.5 font-medium">Why</th>
        </tr>
      </thead>
      <tbody>
        {actions.map(actionOf).map((a) => (
          <tr key={a.id} className="border-b border-line align-top last:border-0">
            <td className="px-4 py-2 whitespace-nowrap text-dim" title={a.at}>
              {ago(a.at)}
            </td>
            <td className="px-3 py-2">
              <span className="flex flex-col gap-0.5">
                <span className="text-fg">{a.agent}</span>
                <Link href={`/runs?id=${encodeURIComponent(a.run)}`} className="focusable rounded-sm font-mono text-[10.5px] text-dim hover:underline">
                  {a.run}
                </Link>
              </span>
            </td>
            <td className="px-3 py-2 whitespace-nowrap">
              <span className="font-mono text-[10.5px] text-dim">{a.limit}</span>
              <span className="block text-[10.5px] text-faint">{a.measured === null ? "not measurable" : a.measured} of {a.limit_value}</span>
            </td>
            <td className="px-3 py-2 whitespace-nowrap">
              <span className="flex flex-col gap-0.5">
                <Tag tone={a.action === "stop" ? "err" : a.action === "hold" ? "warn" : "neutral"}>{a.action}</Tag>
                <Status tone={a.outcome === "acted" ? "err" : "warn"}>{a.outcome === "acted" ? "acted" : a.outcome === "failed" ? "could not act" : "raised for a person"}</Status>
              </span>
            </td>
            <td className="max-w-[520px] px-4 py-2 leading-[1.5] text-fg">{a.why}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
