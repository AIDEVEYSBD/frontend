"use client";

import { ControlsInForce } from "./controls-in-force";
import { GATE_TIMEOUT_LINE, GATE_TIMEOUT_SHORT } from "@/lib/gates";
import { AgentHeader, AgentStatus } from "./agent-header";
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Mono, Status, Tag, type Tone } from "./ui";
import { Banner } from "./overlays";
import { Section } from "./section";
import { Pick } from "./select";
import { DigestChip } from "./digest-chip";
import { useSession } from "@/lib/use-session";
import { HARNESS, RISK, RISK_ORDER, type HarnessKind, type Risk } from "@/lib/spec";
import { DATA_CLASS_TONE } from "@/lib/bom";
import { retiredLine } from "@/lib/lifecycle";
import { editableDocument, retiredRefusalOf, saveAgent, type AgentSaved, type EditableDocument } from "@/lib/api/l8";
import { runBlockers, unsupportedHeading, unsupportedReason } from "@/lib/unsupported";
import { UnsupportedParts } from "./unsupported";
import {
  NEW_GATE,
  arr,
  changed,
  fieldsOf,
  gateProblems,
  gatesOf,
  grantsOf,
  obj,
  pendingOf,
  stepsOf,
  str,
  withEdits,
  type BudgetKey,
  type Doc,
  type FieldSpec,
  type GateDraft,
  type StepRow,
} from "./agent-document";

/**
 * One agent's configuration, as a form.
 *
 * What an operator may manage for an agent lives here: the per-run budget,
 * each step's bounds, the gates and who answers them. The tools each step
 * was granted are shown beside them, read only. Everyone who may view sees
 * all of it; with the deploy permission the limits, bounds and gate fields
 * can be changed, and Save writes a new version through the agents door
 * (`POST /api/agents`, lib/api/l8.ts `saveAgent`). A save is never a
 * deploy: the page says so and points at the Versions tab (/lifecycle),
 * where the gate is.
 *
 * The form holds only what was typed (`edits`, keyed by field) beside the
 * document as loaded; what is saved is a copy of that document with the
 * changed fields set (components/agent-document.tsx), so a field the form
 * did not change is never written.
 */

const INPUT =
  "h-8 w-full rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-fg placeholder:text-ghost focus:outline-none focus-visible:border-fg focus-visible:ring-2 focus-visible:ring-fg/15";
const BAD = "border-err focus-visible:border-err focus-visible:ring-err/20";

const RISK_TONE: Record<string, Tone> = { read: "ok", write: "neutral", risky: "warn", destructive: "err" };
const riskLabel = (r: string) => (RISK[r as Risk] ? RISK[r as Risk].label : r || "undeclared");
const harnessName = (h: string) => (HARNESS[h as HarnessKind] ? HARNESS[h as HarnessKind].name : h);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

const UNANSWERED = [
  { value: "escalate", label: "Escalate to the next role" },
  { value: "abort", label: "End the run as failed" },
];

/* ═══════════════════ form primitives ═══════════════════ */

/** A labelled value: the control when the person may change it, the plain value when they may not. */
function Cell({ label, hint, error, edited, children, className = "" }: { label: string; hint?: ReactNode; error?: string; edited?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <span className="flex items-center gap-2">
        <span className="text-[12.5px] font-medium text-mist">{label}</span>
        {edited && <span className="text-[10.5px] font-medium text-queue">changed</span>}
      </span>
      {children}
      {error ? (
        <span role="alert" className="text-[11.5px] text-err">
          {error}
        </span>
      ) : hint ? (
        <span className="text-[11.5px] leading-[1.5] text-faint">{hint}</span>
      ) : null}
    </div>
  );
}

function TextValue({
  value,
  onChange,
  edit,
  label,
  placeholder,
  unset = "Not set",
  mono = false,
  invalid = false,
  numeric = false,
}: {
  value: string;
  onChange: (v: string) => void;
  edit: boolean;
  label: string;
  placeholder?: string;
  /** What a reader sees when the document carries no value. */
  unset?: string;
  mono?: boolean;
  invalid?: boolean;
  numeric?: boolean;
}) {
  if (!edit) {
    return value ? (
      <span className={`break-words text-fg ${mono ? "font-mono text-[12px]" : "text-[13px]"} ${numeric ? "tnum" : ""}`}>{value}</span>
    ) : (
      <span className="text-[12.5px] text-faint">{unset}</span>
    );
  }
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={label}
      aria-invalid={invalid || undefined}
      inputMode={numeric ? "decimal" : undefined}
      spellCheck={false}
      autoComplete="off"
      className={`${INPUT} ${mono || numeric ? "font-mono text-[12px]" : ""} ${invalid ? BAD : ""}`}
    />
  );
}

function ChoiceValue({ value, onChange, edit, label, options }: { value: string; onChange: (v: string) => void; edit: boolean; label: string; options: { value: string; label: string }[] }) {
  const known = options.some((o) => o.value === value) ? options : [...options, { value, label: value || "not set" }];
  if (!edit) return <span className="text-[13px] text-fg">{known.find((o) => o.value === value)?.label ?? value}</span>;
  return <Pick value={value} onChange={onChange} options={known} aria-label={label} />;
}

/** The form's state over the field registry. */
interface Form {
  edit: boolean;
  value: (key: string) => string;
  set: (key: string, v: string) => void;
  edited: (key: string) => boolean;
  problem: (key: string) => string;
}

function FieldText({ form, k, label, hint, placeholder, unset, mono, numeric, className }: { form: Form; k: string; label: string; hint?: ReactNode; placeholder?: string; unset?: string; mono?: boolean; numeric?: boolean; className?: string }) {
  const error = form.problem(k);
  return (
    <Cell label={label} hint={hint} error={error} edited={form.edited(k)} className={className}>
      <TextValue value={form.value(k)} onChange={(v) => form.set(k, v)} edit={form.edit} label={label} placeholder={placeholder} unset={unset} mono={mono} numeric={numeric} invalid={Boolean(error)} />
    </Cell>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="max-w-[110ch] text-[11.5px] leading-[1.6] text-faint">{children}</p>;
}

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-sm bg-raise px-1 font-mono text-[11px] text-dim">{children}</code>;
}

/* ═══════════════════ sections ═══════════════════ */

const BUDGET: { key: BudgetKey; label: string; hint: string; unset: string; placeholder?: string }[] = [
  { key: "cost_usd", label: "Cost (USD)", hint: "Tokens at the price set for each model on the Models tab, checked after each model reply.", unset: "No limit set" },
  { key: "tokens", label: "Tokens", hint: "Counted from every model reply, in and out, and checked after each reply.", unset: "No limit set" },
  { key: "tool_calls", label: "Tool calls", hint: "Kept in the document and not counted: tool steps are not built on this deployment.", unset: "Not counted", placeholder: "200" },
  { key: "wall_clock_s", label: "Wall clock (seconds)", hint: "From the run's start, checked between steps. Time spent waiting at a gate is not counted.", unset: "No limit set" },
];

function Limits({ form }: { form: Form }) {
  const wall = Number(form.value("budget.wall_clock_s"));
  return (
    <Section title="Limits" hue="budget" meta="what one run may spend">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {BUDGET.map((b) => (
          <FieldText
            key={b.key}
            form={form}
            k={`budget.${b.key}`}
            label={b.label}
            numeric
            placeholder={b.placeholder}
            unset={b.unset}
            hint={b.key === "wall_clock_s" && Number.isFinite(wall) && wall >= 60 ? `${b.hint} ${Math.round((wall / 60) * 10) / 10} minutes.` : b.hint}
          />
        ))}
      </div>
      <Hint>
        One tally for the whole run, across every step. Tokens and cost are checked after each model reply (the call that crosses the line has been made and is in the journal), wall-clock time between steps. Reaching a limit ends the run as failed, naming the limit. Leave a field empty for no limit.
      </Hint>
    </Section>
  );
}

function Bounds({ form, steps }: { form: Form; steps: StepRow[] }) {
  return (
    <Section title="Bounds" hue="run" meta="how far each step and the agent as a whole may go">
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full min-w-[820px] border-collapse text-[11.5px]">
          <thead>
            <tr className="border-b border-line text-left text-[10.5px] text-faint">
              <th className="px-4 py-2 font-medium">Step</th>
              <th className="px-3 py-2 font-medium">What decides the next call</th>
              <th className="w-[150px] px-3 py-2 font-medium">Step limit</th>
              <th className="px-3 py-2 font-medium">Stop condition</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((s) => {
              const loop = s.harness === "delegate";
              const limit = `step.${s.id}.max_steps`;
              const stop = `step.${s.id}.stop_when`;
              return (
                <tr key={s.id} className="border-b border-line align-top last:border-0">
                  <td className="px-4 py-2.5">
                    <span className="flex flex-col gap-0.5">
                      <span className="text-[12px] font-medium text-fg">{s.label}</span>
                      <span className="font-mono text-[10.5px] text-faint">{s.id}</span>
                      {s.fanout && (
                        <span className="text-[10.5px] text-faint">
                          Once per item of <Code>{s.fanout.over}</Code>
                          {s.fanout.max_parallel !== null ? `, ${s.fanout.max_parallel} at a time` : ""}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="flex flex-col gap-0.5">
                      <span className="text-dim">{harnessName(s.harness)}</span>
                      {s.model && <span className="text-[10.5px] text-faint">{s.model}</span>}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {loop ? (
                      <span className="text-faint">Not built: delegate steps do not run on this deployment</span>
                    ) : s.harness === "sequence" ? (
                      <span className="text-faint">{plural(s.fixed, "fixed step")}</span>
                    ) : (
                      <span className="text-faint">One wait</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {loop ? (
                      <span className="text-faint">Not built</span>
                    ) : s.harness === "sequence" ? (
                      <span className="text-faint">Ends after its last step</span>
                    ) : (
                      <span className="text-faint">Resumes when {s.waits === "approval" ? "a person answers" : s.waits ? `its ${s.waits} answers` : "it is answered"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {steps.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-3 text-faint">
                  The document has no steps.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Hint>
        A fixed sequence runs its steps in order and a wait step resumes when it is answered; the engine also caps how many times one run may enter the same step. A step where the model decides (a delegate step) and a tool step are not built on this deployment.
      </Hint>
    </Section>
  );
}

function GateCard({ index, gate, base, edit, stepLabel, onChange, onRemove }: { index: number; gate: GateDraft; base: GateDraft | null; edit: boolean; stepLabel: (id: string) => string; onChange: (patch: Partial<GateDraft>) => void; onRemove: () => void }) {
  const bad = base && !gateDiffers(base, gate) ? {} : gateProblems(gate);
  const was = (key: "at_or_above" | "when" | "approvers" | "escalate_to" | "on_timeout" | "timeout_h", kind: FieldSpec["kind"]) => (base ? changed(kind, base[key], gate[key]) : false);
  return (
    <div className="flex flex-col gap-3 rounded-md border border-line bg-canvas p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold text-fg">Gate {index + 1}</span>
        {!base && <Tag tone="queue">new</Tag>}
        <span className="text-[11.5px] text-dim">
          Guards tool calls {gate.nodes.length ? `from ${gate.nodes.map(stepLabel).join(", ")}` : "from every step"}
        </span>
        <span className="grow" />
        {edit && (
          <Button size="sm" variant="solid" tone="err" onClick={onRemove}>
            Remove
          </Button>
        )}
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[220px_minmax(0,1.4fr)_minmax(0,1fr)]">
        <Cell label="Risk floor" edited={was("at_or_above", "choice")} error={bad.at_or_above} hint="A call to a tool declared at this risk or above waits here.">
          <ChoiceValue value={gate.at_or_above} onChange={(v) => onChange({ at_or_above: v })} edit={edit} label={`Risk floor of gate ${index + 1}`} options={RISK_ORDER.map((r) => ({ value: r, label: `${RISK[r].label} and above` }))} />
        </Cell>
        <Cell label="Condition" edited={was("when", "text")} hint="The gate applies only when this holds. Empty means always.">
          <TextValue value={gate.when} onChange={(v) => onChange({ when: v })} edit={edit} label={`Condition of gate ${index + 1}`} mono placeholder="always" unset="Always" />
        </Cell>
        <Cell label="Approver roles" edited={was("approvers", "roles")} error={bad.approvers} hint="Roles, separated by commas. Never a person's name.">
          <TextValue value={gate.approvers} onChange={(v) => onChange({ approvers: v })} edit={edit} label={`Approver roles of gate ${index + 1}`} mono unset="None named" invalid={Boolean(bad.approvers)} />
        </Cell>
        <Cell label="Unanswered after (hours)" edited={was("timeout_h", "number")} error={bad.timeout_h} hint="24 when the document sets none.">
          <TextValue value={gate.timeout_h} onChange={(v) => onChange({ timeout_h: v })} edit={edit} label={`Hours gate ${index + 1} waits`} numeric placeholder="24" unset="24 (the default)" invalid={Boolean(bad.timeout_h)} />
        </Cell>
        <Cell label="Then" edited={was("on_timeout", "choice")} hint="A gate never opens by itself when nobody answers.">
          <ChoiceValue value={gate.on_timeout} onChange={(v) => onChange({ on_timeout: v })} edit={edit} label={`What gate ${index + 1} does unanswered`} options={UNANSWERED} />
        </Cell>
        <Cell label="Escalates to" edited={was("escalate_to", "roles")} hint="The roles an unanswered gate walks to, in order. When the chain is spent the run ends as failed.">
          <TextValue value={gate.escalate_to} onChange={(v) => onChange({ escalate_to: v })} edit={edit} label={`Escalation roles of gate ${index + 1}`} mono unset="Nobody further" />
        </Cell>
      </div>
    </div>
  );
}

const gateDiffers = (a: GateDraft, b: GateDraft) =>
  changed("choice", a.at_or_above, b.at_or_above) || changed("text", a.when, b.when) || changed("roles", a.approvers, b.approvers) || changed("roles", a.escalate_to, b.escalate_to) || changed("choice", a.on_timeout, b.on_timeout) || changed("number", a.timeout_h, b.timeout_h);

function Gates({ form, doc, steps, baseGates, gates, setGates }: { form: Form; doc: Doc; steps: StepRow[]; baseGates: GateDraft[]; gates: GateDraft[]; setGates: (update: (g: GateDraft[]) => GateDraft[]) => void }) {
  const stepLabel = (id: string) => steps.find((s) => s.id === id)?.label ?? id;
  const approvals = steps.filter((s) => s.harness === "await" && s.waits === "approval");
  const edges = arr(obj(doc.spec).edges).map(obj);
  return (
    <Section
      title="Gates"
      meta="where a person decides before the agent goes on"
    >
      {/* Gates on tool calls are kept in the document and shown, never offered for adding: tool steps are not built on this deployment, so no such gate is consulted. */}
      {gates.length > 0 && <span className="text-[12px] font-semibold text-fg">On tool calls</span>}
      {gates.length > 0 && <p className="text-[12.5px] text-dim">The document declares gates on tool calls. They are kept as written and not consulted: tool steps are not built on this deployment.</p>}
      {gates.map((g, i) => (
        <GateCard
          key={g.src === null ? `new-${i}` : `gate-${g.src}`}
          index={i}
          gate={g}
          base={g.src === null ? null : baseGates[g.src]}
          edit={form.edit}
          stepLabel={stepLabel}
          onChange={(patch) => setGates((list) => list.map((x, j) => (j === i ? { ...x, ...patch } : x)))}
          onRemove={() => setGates((list) => list.filter((_, j) => j !== i))}
        />
      ))}
      <span className="mt-1 text-[12px] font-semibold text-fg">Approval steps</span>
      <p className="text-[11.5px] leading-[1.55] text-faint">{GATE_TIMEOUT_LINE}</p>
      {approvals.length === 0 && <p className="text-[12.5px] text-dim">This agent has no step that waits for a person.</p>}
      {approvals.map((s) => {
        const into = edges.filter((e) => str(e.target) === s.id);
        const k = (name: string) => `await.${s.id}.${name}`;
        return (
          <div key={s.id} className="flex flex-col gap-3 rounded-md border border-line bg-canvas p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-semibold text-fg">{s.label}</span>
              <span className="font-mono text-[10.5px] text-faint">{s.id}</span>
              <span className="text-[11.5px] text-dim">Every run that reaches this step waits here, whatever the risk.</span>
            </div>
            {into.length > 0 && (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-faint">
                Reached from
                {into.map((e, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    <span className="text-dim">{stepLabel(str(e.source))}</span>
                    {str(e.when) ? <Code>{str(e.when)}</Code> : <span>always</span>}
                  </span>
                ))}
              </span>
            )}
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <FieldText form={form} k={k("target")} label="Approver roles" mono unset="Anyone with the approve permission" hint="Roles, separated by commas. Never the person who started the run, nor the author of its version." />
              <FieldText form={form} k={k("timeout_h")} label="Unanswered after (hours)" numeric placeholder="24" unset="No deadline" hint={GATE_TIMEOUT_SHORT} />
              <Cell label="Then" edited={form.edited(k("on_timeout"))} hint="A gate never proceeds by itself.">
                <ChoiceValue value={form.value(k("on_timeout"))} onChange={(v) => form.set(k("on_timeout"), v)} edit={form.edit} label={`What ${s.label} does unanswered`} options={UNANSWERED} />
              </Cell>
              <FieldText form={form} k={k("escalate_to")} label="Escalates to" mono unset="Nobody further" hint="Roles, in order. When the chain is spent the run ends as failed." />
            </div>
          </div>
        );
      })}
    </Section>
  );
}

function Tools({ doc }: { doc: Doc }) {
  const grants = useMemo(() => grantsOf(doc), [doc]);
  const total = grants.reduce((n, g) => n + g.tools.length, 0);
  const scope = (rows: [string, string[]][]) =>
    rows.map(([path, values]) => (
      <span key={path} className="break-words font-mono text-[10.5px] text-dim">
        {path}: {values.length ? values.join(", ") : "nothing"}
      </span>
    ));
  return (
    <Section title="Tools" meta={`${plural(total, "grant")} across ${plural(grants.length, "step")} · read only`}>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full min-w-[820px] border-collapse text-[11.5px]">
          <thead>
            <tr className="border-b border-line text-left text-[10.5px] text-faint">
              <th className="px-4 py-2 font-medium">Tool</th>
              <th className="px-3 py-2 font-medium">Risk</th>
              <th className="px-3 py-2 font-medium">Scope</th>
              <th className="px-3 py-2 font-medium">Marks</th>
            </tr>
          </thead>
          <tbody>
            {grants.map((g) => [
              <tr key={`${g.step}:head`} className="border-b border-line bg-raise/40">
                <td colSpan={4} className="px-4 py-1.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[12px] font-medium text-fg">{g.label}</span>
                    <span className="font-mono text-[10.5px] text-faint">{g.step}</span>
                    <span className="text-[10.5px] text-faint">{g.tools.length ? plural(g.tools.length, "tool") : "no tools granted"}</span>
                    {g.maxDataClass && <Tag tone={DATA_CLASS_TONE[g.maxDataClass] ?? "neutral"}>reads up to {g.maxDataClass}</Tag>}
                  </span>
                </td>
              </tr>,
              ...g.tools.map((t) => (
                <tr key={`${g.step}:${t.name}`} className="border-b border-line align-top last:border-0">
                  <td className="px-4 py-2">
                    <span className="flex flex-col gap-0.5">
                      <span className="font-mono text-[11px] text-fg">{t.name}</span>
                      {t.summary && <span className="max-w-[60ch] text-[10.5px] leading-[1.45] text-faint">{t.summary}</span>}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{t.registered ? <Status tone={RISK_TONE[t.risk] ?? "neutral"}>{riskLabel(t.risk)}</Status> : <span className="text-warn">not registered in this document</span>}</td>
                  <td className="px-3 py-2">
                    <span className="flex flex-col gap-0.5">
                      {scope(t.scope)}
                      {t.narrowed.length > 0 && <span className="text-[10.5px] text-faint">Narrowed for this step:</span>}
                      {scope(t.narrowed)}
                      {t.scope.length === 0 && t.narrowed.length === 0 && <span className="text-faint">Not limited</span>}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex flex-wrap gap-1">
                      {t.taints && <Tag tone="warn">untrusted output</Tag>}
                      {t.sink && <Tag tone="err">acts outside</Tag>}
                      {t.impact.map((i) => (
                        <Tag key={i}>impact: {i}</Tag>
                      ))}
                      {t.dataClass && <Tag tone={DATA_CLASS_TONE[t.dataClass] ?? "neutral"}>returns {t.dataClass}</Tag>}
                      {t.maxDataClass && <Tag tone={DATA_CLASS_TONE[t.maxDataClass] ?? "neutral"}>takes up to {t.maxDataClass}</Tag>}
                      {!t.taints && !t.sink && !t.impact.length && !t.dataClass && !t.maxDataClass && <span className="text-faint">None</span>}
                    </span>
                  </td>
                </tr>
              )),
            ])}
            {grants.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-3 text-faint">
                  The document has no steps.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Hint>The grants, risks and scopes the document declares, as written. They are not applied: tool steps are not built on this deployment, so no step calls a tool.</Hint>
    </Section>
  );
}

/**
 * Fallback models (5.5), ahead of its backend for a workflow: the spec has
 * no field for them (runtime/agentfactory/spec.py) and a failed model call
 * is retried on the same endpoint. The field is shown, disabled, and says so.
 */
function Fallbacks({ steps }: { steps: StepRow[] }) {
  const named = [...new Set(steps.map((s) => s.model).filter(Boolean))];
  return (
    <Section title="Fallback models" hue="model" meta="what a step calls when its model fails">
      <Cell label="If a model fails, try" className="max-w-[520px]">
        <input disabled aria-label="Fallback models, separated by commas" className={`${INPUT} cursor-not-allowed bg-raise font-mono text-[12px] text-ghost`} />
      </Cell>
      <span className="text-[11.5px] leading-[1.5] text-faint" data-pending="spec.policy.fallbacks">
        Not connected on this deployment: a workflow&rsquo;s document has no fallback field the runtime reads. A model call that fails is retried on the same endpoint, and the field stays disabled until the runtime takes one.
      </span>
      {named.length > 0 && <span className="text-[11.5px] text-faint">The steps of this agent name: {named.join(", ")}. A step that names none takes the deployment&rsquo;s default.</span>}
    </Section>
  );
}

/* ═══════════════════ the page for one agent ═══════════════════ */

/** What the Configuration tab is, under the agent's header. */
const ABOUT = "What one run may spend, how far each step may go, where a person decides, and the tools each step was granted. A change is saved as a new version and deployed from the Versions tab.";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-surface px-4 py-2.5">
      <span className="text-[10.5px] text-faint">{label}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-2 text-[12.5px] font-medium text-fg">{children}</span>
    </div>
  );
}

/** What a save did, in a line: saved, never deployed. */
function savedText(saved: AgentSaved, running: number | null): string {
  const v = saved.version !== null ? `Version ${saved.version}` : "This version";
  if (saved.draft || running !== null) return `${v} is saved, not deployed. Production keeps running ${running !== null ? `version ${running}` : "its deployed version"} until this one is deployed from the Versions tab.`;
  return `${v} is saved, not deployed. The agent has no deployment yet.`;
}

function AgentForm({ edit, saved, onSaved }: { edit: EditableDocument; saved: AgentSaved | null; onSaved: (s: AgentSaved) => void }) {
  const a = edit.agent;
  const doc = edit.spec as Doc;
  const { session, loaded } = useSession();
  const canEdit = Boolean(loaded && session?.permissions.includes("deploy"));

  const fields = useMemo(() => fieldsOf(doc), [doc]);
  const baseGates = useMemo(() => gatesOf(doc), [doc]);
  const steps = useMemo(() => stepsOf(doc), [doc]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [gates, setGates] = useState<GateDraft[]>(baseGates);
  const [saving, setSaving] = useState(false);
  const [refusal, setRefusal] = useState("");

  const form: Form = {
    edit: canEdit,
    value: (key) => edits[key] ?? fields.get(key)?.base ?? "",
    set: (key, v) => setEdits((e) => ({ ...e, [key]: v })),
    edited: (key) => {
      const f = fields.get(key);
      return Boolean(f && edits[key] !== undefined && changed(f.kind, f.base, edits[key]));
    },
    problem: (key) => {
      const f = fields.get(key);
      return f && edits[key] !== undefined && changed(f.kind, f.base, edits[key]) ? f.check(edits[key]) : "";
    },
  };
  const pending = pendingOf(fields, edits, baseGates, gates);
  const dirty = pending.changes.length > 0;

  const save = async () => {
    setSaving(true);
    setRefusal("");
    try {
      onSaved(await saveAgent(withEdits(doc, fields, edits, baseGates, gates)));
    } catch (e) {
      const gone = retiredRefusalOf(e);
      setRefusal(gone ? `${a.id} is retired. ${retiredLine(gone)}` : (e as Error).message || "The save was refused.");
    } finally {
      setSaving(false);
    }
  };
  const discard = () => {
    setEdits({});
    setGates(baseGates);
    setRefusal("");
  };

  const enc = encodeURIComponent(a.id);
  const meta = obj(doc.metadata);
  return (
    <>
      <AgentHeader
        tab="configuration"
        id={a.id}
        agent={a}
        actions={
          <>
            <Button size="sm" variant="solid" tone="neutral" href={`/evals?agent=${enc}`}>
              Evaluate
            </Button>
            <Button size="sm" variant="solid" tone="ink" href={`/runs?agent=${enc}`} permission="run" disabled={Boolean(a.retired) || runBlockers(a.unsupported, a.version, a.deployed_version).length > 0} title={runBlockers(a.unsupported, a.version, a.deployed_version).length ? unsupportedReason(a.unsupported) : undefined}>
              Run
            </Button>
          </>
        }
      >
        {ABOUT}
      </AgentHeader>

      {!a.retired && <UnsupportedParts parts={a.unsupported} heading={unsupportedHeading(a.version, a.deployed_version)} />}


      <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-2 xl:grid-cols-4">
        {a.description && (
          <div className="flex min-w-0 flex-col gap-1 bg-surface px-4 py-2.5 sm:col-span-2 xl:col-span-4">
            <span className="text-[10.5px] text-faint">What it does</span>
            <p className="line-clamp-3 max-w-[130ch] text-[12.5px] leading-[1.6] text-dim" title={a.description}>
              {a.description}
            </p>
          </div>
        )}
        <Fact label="Agent id">
          <Mono className="break-all text-fg">{a.id}</Mono>
          {str(meta.owner) && <span className="text-[11px] font-normal text-faint">owner {str(meta.owner)}</span>}
        </Fact>
        <Fact label="Latest saved">
          <span>{a.version !== null ? `Version ${a.version}` : "No version number on record"}</span>
          <DigestChip digest={a.digest} label="Digest of the latest save" />
        </Fact>
        <Fact label="Production runs">
          {a.deployed_version !== null ? (
            <>
              <span>Version {a.deployed_version}</span>
              <DigestChip digest={a.deployed_digest} label="Digest production runs" />
            </>
          ) : (
            <span className="font-normal text-dim">Nothing deployed</span>
          )}
        </Fact>
        <Fact label="State">
          <AgentStatus agent={a} />
          {str(meta.autonomy) && <span className="text-[11px] font-normal text-faint">autonomy {str(meta.autonomy)}</span>}
        </Fact>
      </div>

      {a.retired && (
        <Banner tone="err" title="This agent is retired">
          {retiredLine(a.retired)}
        </Banner>
      )}
      {edit.draft && (
        <Banner tone="neutral" title={`This page shows draft version ${edit.version ?? "?"}, the latest save`}>
          Production runs version {a.deployed_version ?? "?"}. A save here adds another draft; nothing production runs changes until a version is deployed from the Versions tab.
        </Banner>
      )}
      {loaded && !canEdit && <p className="rounded-md border border-line bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-faint">Read only. Changing the limits, bounds and gates needs the &ldquo;deploy&rdquo; permission.</p>}

      <Limits form={form} />
      <Bounds form={form} steps={steps} />
      <Gates form={form} doc={doc} steps={steps} baseGates={baseGates} gates={gates} setGates={(update) => setGates(update)} />
      <Tools doc={doc} />
      <Fallbacks steps={steps} />

      {/* The save bar stops short of the corner the console's Ask button floats in. */}
      {canEdit && (dirty || saved || refusal) && (
        <div className="sticky bottom-3 z-10 mr-[104px] flex flex-col gap-2 rounded-lg border border-line-strong bg-surface px-4 py-3 elev-3" role="region" aria-label="Save">
          {refusal && (
            <p role="alert" className="text-[12.5px] leading-[1.55] whitespace-pre-wrap text-err">
              <span className="font-medium">The save was refused.</span> {refusal}
            </p>
          )}
          {!dirty && saved && !refusal && (
            <div className="flex flex-wrap items-center gap-3">
              <Status tone="queue">Saved, not deployed</Status>
              <span className="min-w-0 text-[12.5px] leading-[1.55] text-dim">{savedText(saved, a.deployed_version)} Deploy it from the Versions tab.</span>
              <span className="grow" />
              <Button size="sm" variant="solid" tone="ink" href={`/lifecycle?agent=${enc}`}>
                Open Versions
              </Button>
            </div>
          )}
          {dirty && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[12.5px] font-medium text-fg">{plural(pending.changes.length, "change")} to save as a new version</span>
                <span className="text-[11.5px] leading-[1.5] text-faint">{pending.changes.join(" · ")}</span>
                {pending.problems.map((p) => (
                  <span key={p} className="text-[11.5px] text-err">
                    {p}
                  </span>
                ))}
              </span>
              <span className="grow" />
              <Button size="sm" variant="solid" tone="err" onClick={discard} disabled={saving}>
                Discard
              </Button>
              <Button size="sm" variant="solid" tone="ink" permission="deploy" onClick={save} loading={saving} disabled={pending.problems.length > 0}>
                Save new version
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Mount point for the controls-in-force panel of this agent (another builder's). */}
      <div data-slot="controls-in-force" data-agent={a.id} className="flex flex-col gap-2">
        {edit.draft && (
          <p className="text-[11.5px] leading-[1.5] text-faint">
            The controls below are read from the latest save, version {edit.version ?? "?"}. Production runs version {a.deployed_version ?? "?"}.
          </p>
        )}
        <ControlsInForce agent={a.id} />
      </div>
    </>
  );
}

function AgentConfig({ id }: { id: string }) {
  const [state, setState] = useState<{ edit: EditableDocument; n: number } | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<AgentSaved | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    editableDocument(id)
      .then((edit) => {
        if (!live) return;
        setError("");
        setState({ edit, n: tick });
      })
      .catch((e: Error) => live && setError(e.message || "the agents door did not answer"));
    return () => {
      live = false;
    };
  }, [id, tick]);

  if (!state) {
    return (
      <>
        <AgentHeader tab="configuration" id={id} agent={null}>
          {ABOUT}
        </AgentHeader>
        {error ? (
          <Banner tone="err" title="This agent could not be read" action={<Button size="sm" variant="solid" tone="neutral" href="/agents">All agents</Button>}>
            {error}
          </Banner>
        ) : (
          <p className="text-[12px] text-faint">Reading the agent&hellip;</p>
        )}
      </>
    );
  }
  return (
    <>
      {error && (
        <Banner tone="err" title="The agent could not be read again">
          {error}
        </Banner>
      )}
      {/* Keyed by the load, so a save's fresh document starts a fresh form. */}
      <AgentForm
        key={state.n}
        edit={state.edit}
        saved={saved}
        onSaved={(s) => {
          setSaved(s);
          setTick((t) => t + 1);
        }}
      />
    </>
  );
}

/** With no agent named the address is a redirect to the list (app/agent/page.tsx); a link that drops the id mid-session goes the same way. */
function ToTheList() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/agents");
  }, [router]);
  return null;
}

function AgentPage() {
  const id = useSearchParams().get("id");
  return (
    <div className="min-h-full" data-hue="blue">
      <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-5 px-5 py-7">{id ? <AgentConfig key={id} id={id} /> : <ToTheList />}</div>
    </div>
  );
}

export function AgentConfigView() {
  return (
    <Suspense>
      <AgentPage />
    </Suspense>
  );
}
