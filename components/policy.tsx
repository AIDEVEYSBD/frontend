"use client";
import { useDoorOff } from "@/lib/use-doors";
import { Failure } from "./pending";

import { PolicyBaseline } from "./policy-baseline";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Mono, Status, Tag } from "./ui";
import { Banner } from "./overlays";
import { Field, Input, Switch, Textarea } from "./forms";
import { Pick } from "./select";
import { ChipEditor } from "./gate-form";
import { ControlMark } from "./control-ref";
import { TextDialog } from "./text-dialog";
import { Figures, JsonDetails, Section } from "./section";
import { GroupHeader } from "./page-tabs";
import { soon } from "@/lib/soon";
import { useSession } from "@/lib/use-session";
import { agentDocument, listAgents, type AgentSummary } from "@/lib/api/l2";
import { DoorError, auditLine } from "@/lib/api/l5";
import {
  CHANGE_STATES,
  approvePolicyChange,
  getPolicyChange,
  getPolicyTarget,
  listPolicyChanges,
  listPolicyTargets,
  proposePolicyChange,
  rejectPolicyChange,
  rollbackPolicyChange,
  simulatePolicy,
  type ChangeState,
  type PolicyChange,
  type PolicyChangeList,
  type PolicyDiff,
  type PolicyTarget,
  type SimulationResult,
  type TargetKind,
  type TargetKinds,
} from "@/lib/api/l9";
import {
  CHANGE_STATE_META,
  RULING_META,
  SIM_WINDOWS,
  TARGET_LABEL,
  changeLine,
  changeSummary,
  diffCells,
  diffOf,
  draftOf,
  effectiveAt,
  effectiveProblem,
  byIdLine,
  fieldsOf,
  movesOf,
  parseProposal,
  patchOf,
  proposedField,
  proposedLine,
  simWindowOf,
  simulationGaps,
  simulationLine,
  targetLabel,
  targetLine,
  targetQuery,
  type Draft,
  type ProposalField,
  type Who,
} from "@/lib/policy";
import { whenText } from "@/lib/lifecycle";

/**
 * Policy as reviewed change.
 *
 * A policy target is a set of rules that decides what runs may do: the
 * estate's rate limits on starting runs, the breakers' thresholds, the
 * guardian's limits, and the release threshold (the estate's, or one
 * agent's own). None is written directly: a person proposes a change (with
 * its diff in the target's own words, and when it should take effect),
 * someone other than the proposer approves it, and it applies at its time.
 * An applied change can be rolled back in one step: a change back, applied
 * at once with no second person, recorded as an emergency and raised on the
 * attention queue. Targets later phases own (an attached agent's grants,
 * peers, retention) are listed as not built. A definition's own `policy`
 * block keeps its path through versions and reviews, and is what the
 * simulation decides again, with the run engine's own decision, over the
 * calls the journals recorded; nothing a simulation does executes.
 *
 * Every move needs the configure permission and a person; the auditor reads
 * all of it and may simulate. The doors are lib/api/l9.ts; the words and the
 * form are lib/policy.ts.
 */

function DiffTable({ diff }: { diff: PolicyDiff }) {
  if (!diff.changes.length) return <p className="text-[11.5px] text-faint">Nothing moves.</p>;
  return (
    <div className="af-list overflow-x-auto rounded-md border border-line">
      <table className="w-full min-w-[420px] border-collapse text-[11.5px]">
        <thead>
          <tr className="border-b border-line bg-raise/40 text-left text-[10.5px] text-faint">
            <th className="px-3 py-1.5 font-medium">Rule</th>
            <th className="px-3 py-1.5 font-medium">Now</th>
            <th className="px-3 py-1.5 font-medium">Proposed</th>
          </tr>
        </thead>
        <tbody>
          {diff.changes.map((c) => {
            const cells = diffCells(c);
            return (
              <tr key={c.field} className="border-b border-line align-top last:border-0">
                <td className="px-3 py-1.5 text-fg">{c.label}</td>
                <td className="max-w-[320px] px-3 py-1.5 font-mono text-[10.5px] break-words text-dim">{cells.from}</td>
                <td className="max-w-[320px] px-3 py-1.5 font-mono text-[10.5px] break-words text-fg">{cells.to}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ChangeStatus({ state }: { state: ChangeState }) {
  const m = CHANGE_STATE_META[state];
  return <Status tone={m.tone}>{m.label}</Status>;
}

/** One change: its diff, why, who has had it, and the moves it still allows. Each move goes to its door and the answer replaces the change. */
export function ChangeDetail({ change, who, onMoved }: { change: PolicyChange; who: Who | null; onMoved?: (c: PolicyChange, extra?: string) => void }) {
  const c = change;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [ask, setAsk] = useState<"reject" | "rollback" | null>(null);
  const moves = movesOf(c, who);
  const moved = async (what: string, run: () => Promise<PolicyChange>) => {
    setBusy(what);
    setError("");
    try {
      const next = await run();
      setAsk(null);
      onMoved?.(next);
    } catch (e) {
      setAsk(null);
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };
  const asked = diffOf(c) !== c.diff && c.diff.summary.join("|") !== c.applied_diff?.summary.join("|");
  return (
    <div className="flex flex-col gap-3">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-semibold text-fg">{targetLine(c.target)}</span>
        <ChangeStatus state={c.state} />
        {c.emergency && <Tag tone="err">emergency</Tag>}
        <span className="grow" />
        <Mono className="text-[10.5px] text-faint">
          {c.id}
          {auditLine(c.audit_id)}
        </Mono>
      </span>
      <p className="text-[11.5px] leading-[1.55] text-dim">{changeLine(c)}</p>
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold text-dim">Why</span>
        <p className="text-[12px] leading-[1.55] text-fg">{c.reason}</p>
      </div>
      <DiffTable diff={diffOf(c)} />
      {asked && <p className="text-[11px] text-warn">The rules moved between proposal and application; this is the diff as applied. As proposed: {c.diff.summary.join("; ")}.</p>}
      {c.effective_at && <p className="text-[11px] text-faint">Effective {whenText(c.effective_at)}.</p>}
      {c.rollback_of && (
        <p className="text-[11px] text-faint">
          Rolls back{" "}
          <Link href={`/policy?change=${encodeURIComponent(c.rollback_of)}`} className="focusable rounded-sm font-mono hover:underline">
            {c.rollback_of}
          </Link>
          .
        </p>
      )}
      {c.rolled_back_by && (
        <p className="text-[11px] text-faint">
          Rolled back by{" "}
          <Link href={`/policy?change=${encodeURIComponent(c.rolled_back_by)}`} className="focusable rounded-sm font-mono hover:underline">
            {c.rolled_back_by}
          </Link>
          .
        </p>
      )}

      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold text-dim">History</span>
        <ol className="flex flex-col gap-0.5">
          {c.history.map((h, i) => (
            <li key={`${h.state}-${i}`} className="text-[11px] leading-[1.5] text-faint">
              <span className="font-medium text-dim">{CHANGE_STATE_META[h.state as ChangeState]?.label ?? h.state}</span> {h.by ? `by ${h.by}` : ""} {whenText(h.at)}
              {h.note ? `: ${h.note}` : ""}
            </li>
          ))}
        </ol>
      </div>
      {(c.before || c.after) && <JsonDetails label="The rules before and after" value={{ before: c.before, after: c.after }} />}

      {(c.state === "pending" || c.state === "approved" || c.state === "applied") && (
        <div className="flex flex-col gap-2 border-t border-line pt-3">
          {c.state === "pending" && (
            <Field label="Approval note" hint="optional; kept on the change">
              <Input value={note} onChange={setNote} />
            </Field>
          )}
          <span className="flex flex-wrap items-center gap-2">
            {c.state === "pending" && (
              <Button size="sm" variant="solid" tone="ink" permission="configure" disabled={!moves.approve.open} loading={busy === "approve"} onClick={() => moved("approve", () => approvePolicyChange(c.id, note.trim()))}>
                Approve
              </Button>
            )}
            {moves.reject.open && (
              <Button size="sm" variant="solid" tone="err" permission="configure" onClick={() => setAsk("reject")}>
                Reject…
              </Button>
            )}
            {moves.rollback.open && (
              <Button size="sm" variant="solid" tone="err" permission="configure" onClick={() => setAsk("rollback")}>
                Emergency rollback…
              </Button>
            )}
            {c.state === "pending" && !moves.approve.open && <span className="text-[11px] text-faint">{moves.approve.why}.</span>}
          </span>
        </div>
      )}
      {error && (<p className="text-[11.5px] text-err">{error}</p>)}
      {ask === "reject" && (
        <TextDialog
          title={`Reject ${c.id}?`}
          what={`Closes it for good: ${changeSummary(c)}.`}
          label="Why"
          hint="Kept on the change, for whoever proposed it"
          missing="A rejection needs a reason."
          confirm="Reject"
          tone="err"
          permission="configure"
          busy={busy === "reject"}
          onConfirm={(reason) => moved("reject", () => rejectPolicyChange(c.id, reason))}
          onClose={() => setAsk(null)}
        />
      )}
      {ask === "rollback" && (
        <TextDialog
          title={`Roll back ${c.id}?`}
          what={`Puts the rules back at once, with no second person: ${changeSummary(c)} is undone. It is recorded as an emergency and raised as attention for review.`}
          label="Why"
          hint="Who reviews this reads it first"
          missing="A rollback needs a reason."
          confirm="Roll back now"
          tone="err"
          permission="configure"
          busy={busy === "rollback"}
          onConfirm={(reason) => moved("rollback", () => rollbackPolicyChange(c.id, reason))}
          onClose={() => setAsk(null)}
        />
      )}
    </div>
  );
}

/** The changes, newest first. Presentational. */
export function ChangesListView({ list, selected, onSelect, filtered = false }: { list: PolicyChangeList; selected?: string | null; onSelect?: (id: string) => void; filtered?: boolean }) {
  if (!list.changes.length) {
    return <p className="text-[12px] text-faint">{filtered ? "No change matches." : "No policy change is on record. A proposal below starts the history; rules set before this door stand as they were."}</p>;
  }
  return (
    <ul className="flex flex-col overflow-hidden rounded-md border border-line">
      {list.changes.map((c) => (
        <li key={c.id} className={`border-b border-line last:border-b-0 ${selected === c.id ? "bg-raise/50" : ""}`}>
          <button type="button" onClick={() => onSelect?.(c.id)} className="focusable flex w-full cursor-pointer flex-col gap-0.5 px-3 py-2 text-left hover:bg-raise/40">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] font-semibold text-fg">{targetLine(c.target)}</span>
              <ChangeStatus state={c.state} />
              {c.emergency && <Tag tone="err">emergency</Tag>}
              <span className="grow" />
              <span className="text-[10.5px] text-faint">{whenText(c.proposed_at)}</span>
            </span>
            <span className="truncate text-[11px] text-dim">{changeSummary(c)}</span>
            <span className="truncate text-[10.5px] text-faint">
              {c.proposed_by} · <Mono className="text-[10px]">{c.id}</Mono>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The changes open on one target, for a page that proposes from its own form
 * (the guardian, an attached agent): what is already waiting, and where to
 * review it. Renders nothing when none is.
 */
export function OpenChanges({ target, tick = 0 }: { target: PolicyTarget; tick?: number }) {
  const [open, setOpen] = useState<PolicyChange[]>([]);
  /** Why the changes waiting on review were not read: said, never taken as "none waiting". */
  const [failed, setFailed] = useState("");
  const query = targetQuery(target);
  useEffect(() => {
    let stop = false;
    listPolicyChanges({ target: query })
      .then((l) => {
        if (stop) return;
        setOpen(l.changes.filter((c) => c.state === "pending" || c.state === "approved"));
        setFailed("");
      })
      .catch((e) => {
        if (stop) return;
        setOpen([]);
        setFailed((e as Error).message);
      });
    return () => {
      stop = true;
    };
  }, [query, tick]);
  if (failed) return <Failure inline message={`Whether a change to this is waiting on review could not be read: ${failed}`} />;
  if (!open.length) return null;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-line bg-raise/30 px-3 py-2">
      <span className="text-[11px] font-semibold text-dim">Waiting on review</span>
      {open.map((c) => (
        <Link key={c.id} href={`/policy?change=${encodeURIComponent(c.id)}`} className="focusable flex flex-wrap items-center gap-2 rounded-sm text-[11px] text-dim hover:underline">
          <ChangeStatus state={c.state} />
          <span>{changeSummary(c)}</span>
          <span className="text-faint">by {c.proposed_by}</span>
        </Link>
      ))}
    </div>
  );
}

/** Why a change, and when it takes effect: what every proposal carries besides its fields. */
export function ProposalNote({ reason, onReason, effective, onEffective, disabled }: { reason: string; onReason: (v: string) => void; effective: string; onEffective: (v: string) => void; disabled?: boolean }) {
  const late = effectiveProblem(effective);
  return (
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_240px]">
      <Field label="Why" hint="the reviewer reads this; it stays on the change">
        <Textarea rows={2} value={reason} onChange={onReason} disabled={disabled} placeholder="What changed, and why now" />
      </Field>
      <Field label="Effective" error={late || undefined} hint="your local time; empty applies it on approval">
        <Input type="datetime-local" value={effective} onChange={onEffective} disabled={disabled} />
      </Field>
    </div>
  );
}

function FieldEditor({ field, value, onChange, error, disabled }: { field: ProposalField; value: Draft[string]; onChange: (v: Draft[string]) => void; error?: string; disabled?: boolean }) {
  if (field.kind === "bool") {
    return (
      <div className="flex flex-col gap-1">
        <Switch label={field.label} checked={value === true} onChange={onChange} disabled={disabled} />
        {error && <span className="text-[11px] text-err">{error}</span>}
      </div>
    );
  }
  if (field.kind === "list") {
    return (
      <Field label={field.label} hint={field.hint} error={error}>
        <ChipEditor values={Array.isArray(value) ? value : []} onChange={onChange} disabled={disabled} invalid={Boolean(error)} />
      </Field>
    );
  }
  if (field.kind === "choice") {
    return (
      <Field label={field.label} hint={field.hint} error={error}>
        <Pick value={String(value)} onChange={onChange} options={field.choices ?? []} disabled={disabled} />
      </Field>
    );
  }
  if (field.kind === "json" || field.kind === "longtext") {
    return (
      <Field label={field.label} hint={field.hint} error={error}>
        <Textarea rows={3} mono={field.kind === "json"} value={String(value)} onChange={onChange} disabled={disabled} />
      </Field>
    );
  }
  return (
    <Field label={field.label} hint={field.hint} error={error}>
      <Input type={field.kind === "number" ? "number" : "text"} value={String(value)} onChange={onChange} disabled={disabled} />
    </Field>
  );
}

const ACT_CHOICES = [
  { value: "hold", label: "hold its next call at or above write" },
  { value: "stop", label: "stop the run" },
  { value: "raise", label: "only raise it for a person" },
];

/** The fields of this backend's targets the lib's reading of a value gets wrong: the guardian's acts are a choice, and an empty limit is off. */
function fieldsFor(target: TargetKind, current: Record<string, unknown> | null, inherits: Record<string, unknown> | null): ProposalField[] {
  return fieldsOf(target, current, inherits).map((f) => {
    if (target.kind !== "guardian") return f;
    if (f.name.startsWith("on_")) return { ...f, kind: "choice", choices: ACT_CHOICES, hint: undefined };
    if (f.kind === "number") return { ...f, hint: "empty switches this limit off" };
    return f;
  });
}

/** The rules a target holds now, for one of its ids, and what a null in them inherits. */
async function currentOf(target: TargetKind, id: string): Promise<{ rules: Record<string, unknown> | null; inherits: Record<string, unknown> | null }> {
  if (target.ids === "estate" || id === "estate") return { rules: target.current, inherits: null };
  const read = await getPolicyTarget(target.kind, id);
  return { rules: read.current, inherits: read.inherits };
}

/** The proposal form for one target: its fields read from the door, with what it refused marked on them. */
function ProposalFields({ target, id, current, inherits, onProposed }: { target: TargetKind; id: string; current: Record<string, unknown> | null; inherits: Record<string, unknown> | null; onProposed: (c: PolicyChange) => void }) {
  const { can, loaded } = useSession();
  const editable = !loaded || can("configure");
  const fields = useMemo(() => fieldsFor(target, current, inherits), [target, current, inherits]);
  const [draft, setDraft] = useState<Draft>(() => draftOf(fields, current));
  const [reason, setReason] = useState("");
  const [effective, setEffective] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [refused, setRefused] = useState<{ field: string; error: string } | null>(null);
  const [sim, setSim] = useState<SimulationResult | null>(null);
  const proposeDoor = useDoorOff("POST", "/api/policy/changes");
  const { patch, problems } = patchOf(fields, draft, current);
  const changed = Object.keys(patch);
  const blocked = !changed.length || Object.keys(problems).length > 0 || !reason.trim() || Boolean(effectiveProblem(effective));
  const propose = async () => {
    setBusy(true);
    setError("");
    setRefused(null);
    try {
      const c = await proposePolicyChange({ target: { kind: target.kind, id }, proposed: patch, effective_at: effectiveAt(effective), reason: reason.trim() });
      setReason("");
      setEffective("");
      setSim(null);
      onProposed(c);
    } catch (e) {
      const field = proposedField(e);
      if (field) setRefused({ field, error: (e as Error).message });
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      {!editable && <p className="text-[11.5px] text-warn">Proposing a change needs the configure permission; the form is shown as it stands.</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {fields.map((f) => (
          <FieldEditor
            key={f.name}
            field={f}
            value={draft[f.name]}
            onChange={(v) => {
              setDraft((d) => ({ ...d, [f.name]: v }));
              setRefused(null);
            }}
            error={problems[f.name] ?? (refused?.field === f.name ? refused.error : undefined)}
            disabled={!editable}
          />
        ))}
      </div>
      <ProposalNote reason={reason} onReason={setReason} effective={effective} onEffective={setEffective} disabled={!editable} />
      <span className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="solid" tone="ink" permission="configure" disabled={blocked || proposeDoor.off} title={proposeDoor.why} loading={busy} onClick={propose}>
          {changed.length ? `Propose ${changed.length} change${changed.length === 1 ? "" : "s"}` : "No changes"}
        </Button>
        {changed.length > 0 && !reason.trim() && <span className="text-[11px] text-faint">A change needs a reason.</span>}
        {changed.length > 0 && reason.trim() && <span className="text-[11px] text-faint">Sends only {changed.join(", ")}; the rest keep their value.</span>}
      </span>
      {error && (<p className="text-[11.5px] text-err">{error}</p>)}
      {sim && <SimulationView result={sim} />}
    </div>
  );
}

function ProposeForm({ targets, agents, agentsError = "", kind, onKind, onProposed }: { targets: TargetKind[]; agents: AgentSummary[]; agentsError?: string; kind: string; onKind: (k: string) => void; onProposed: (c: PolicyChange) => void }) {
  const target = targets.find((t) => t.kind === kind) ?? targets[0];
  const [id, setId] = useState("estate");
  const [current, setCurrent] = useState<{ key: string; rules: Record<string, unknown> | null; inherits: Record<string, unknown> | null } | null>(null);
  const [error, setError] = useState("");
  // A target is the estate's, the estate's or one saved agent's, or one approved attached agent's (listed in the target's by_id).
  const needs = target?.ids ?? "estate";
  const options =
    needs === "agent"
      ? agents.map((a) => ({ value: a.id, label: a.name }))
      : needs === "estate_or_agent"
        ? [{ value: "estate", label: "The estate" }, ...agents.map((a) => ({ value: a.id, label: a.name }))]
        : needs === "attached"
          ? Object.keys(target?.by_id ?? {}).map((a) => ({ value: a, label: a }))
          : [];
  const picked = needs === "estate" ? "estate" : options.some((o) => o.value === id) ? id : (options[0]?.value ?? "");
  const key = `${kind}:${picked}`;
  useEffect(() => {
    if (!target || !picked) return;
    let stop = false;
    currentOf(target, picked)
      .then((read) => {
        if (stop) return;
        setCurrent({ key, ...read });
        setError("");
      })
      .catch((e) => {
        if (!stop) setError((e as Error).message);
      });
    return () => {
      stop = true;
    };
  }, [target, picked, key]);
  if (!target) return null;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Target" hint={target.what}>
          <Pick value={kind} onChange={onKind} options={targets.map((t) => ({ value: t.kind, label: targetLabel(t.kind) }))} />
        </Field>
        {needs !== "estate" && (
          <Field label={needs === "estate_or_agent" ? "The estate, or one agent" : "Agent"} hint={options.length ? undefined : agentsError ? `the agents could not be read: ${agentsError}` : "none on record"}>
            <Pick value={picked} onChange={setId} options={options} disabled={!options.length} />
          </Field>
        )}
      </div>
      {error && (<p className="text-[11.5px] text-err">{error}</p>)}
      {current?.key === key && <ProposalFields key={key} target={target} id={picked} current={current.rules} inherits={current.inherits} onProposed={onProposed} />}
    </div>
  );
}

/** What a simulation found. Presentational. */
export function SimulationView({ result }: { result: SimulationResult }) {
  const r = result;
  const gaps = simulationGaps(r);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-fg">{simulationLine(r)}</p>
      <Figures
        items={[
          { k: "runs ruled", v: r.runs },
          { k: "calls ruled", v: r.calls },
          { k: "newly refused", v: r.summary.newly_refused },
          { k: "newly gated", v: r.summary.newly_gated },
          { k: "newly allowed", v: r.summary.newly_allowed },
        ]}
      />
      <p className="text-[10.5px] text-faint">
        {r.target.kind === "spec" ? `${r.target.id}'s policy` : targetLine(r.target)} · {whenText(r.window.from)} to {whenText(r.window.to)} · nothing was executed
      </p>
      {r.changed.length > 0 && (
        <div className="af-list overflow-x-auto rounded-md border border-line">
          <table className="w-full min-w-[860px] border-collapse text-[11.5px]">
            <thead>
              <tr className="border-b border-line bg-raise/40 text-left text-[10.5px] text-faint">
                <th className="px-3 py-1.5 font-medium">Run</th>
                <th className="px-3 py-1.5 font-medium">Tool</th>
                <th className="px-3 py-1.5 font-medium">Was</th>
                <th className="px-3 py-1.5 font-medium">Would be</th>
                <th className="px-3 py-1.5 font-medium">Control</th>
                <th className="px-3 py-1.5 font-medium">Why</th>
              </tr>
            </thead>
            <tbody>
              {r.changed.map((c) => (
                <tr key={`${c.run}:${c.entry}`} className="border-b border-line align-top last:border-0">
                  <td className="px-3 py-1.5">
                    <Link href={`/runs?id=${encodeURIComponent(c.run)}`} className="focusable rounded-sm font-mono text-[10.5px] text-dim hover:underline">
                      {c.run}
                    </Link>
                    <span className="block font-mono text-[10px] text-ghost">
                      {c.node} · {c.entry}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 font-mono text-[10.5px] text-mist">{c.tool}</td>
                  <td className="px-3 py-1.5">
                    <Status tone={RULING_META[c.was].tone}>{RULING_META[c.was].label}</Status>
                  </td>
                  <td className="px-3 py-1.5">
                    <Status tone={RULING_META[c.would_be].tone}>{RULING_META[c.would_be].label}</Status>
                  </td>
                  <td className="px-3 py-1.5">
                    <ControlMark control={c.control} />
                  </td>
                  <td className="max-w-[360px] px-3 py-1.5 leading-[1.5] text-dim">
                    {c.reason}
                    {c.redacted_args && <span className="block text-[10.5px] text-faint">Ruled on the redacted record: {c.redacted_args.join(", ")}.</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {r.notes.map((n) => (
        <p key={n} className="text-[11px] text-faint">
          {n}
        </p>
      ))}
      {gaps.map((g) => (
        <p key={g} className="text-[11px] text-warn">
          {g}.
        </p>
      ))}
    </div>
  );
}

/** Rule the recorded calls again under a proposal. It writes nothing, so a viewer may run it. */
function SimulatePanel({ agents, agentsError = "", preset, quiet = false }: { agents: AgentSummary[] | null; agentsError?: string; preset: string | null; quiet?: boolean }) {
  const simDoor = useDoorOff("POST", "/api/policy/simulate");
  const subject = "agent" as const;
  const [id, setId] = useState(preset ?? "");
  const [span, setSpan] = useState("7d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  /** Each of these belongs to one subject: picking another leaves them behind. */
  const [policy, setPolicy] = useState<{ key: string; text?: string; error?: string } | null>(null);
  const [edited, setEdited] = useState<{ key: string; text: string } | null>(null);
  const [outcome, setOutcome] = useState<{ key: string; result?: SimulationResult; error?: string; door?: boolean } | null>(null);
  const options = (agents ?? []).map((a) => ({ value: a.id, label: a.name }));
  const picked = options.some((o) => o.value === id) ? id : (options[0]?.value ?? "");
  const key = `${subject}:${picked}`;
  useEffect(() => {
    if (!picked) return;
    let stop = false;
    agentDocument(picked)
      .then((doc) => {
        if (!stop) setPolicy({ key: `agent:${picked}`, text: JSON.stringify((doc as { spec?: { policy?: unknown } }).spec?.policy ?? {}, null, 2) });
      })
      .catch((e) => {
        if (!stop) setPolicy({ key: `agent:${picked}`, error: (e as Error).message });
      });
    return () => {
      stop = true;
    };
  }, [picked]);
  // The proposal starts from the rules as they stand: a person edits what they mean to change.
  const seed = policy?.key === key ? (policy.text ?? "") : "";
  const text = edited?.key === key ? edited.text : seed;
  const run = async () => {
    const parsed = parseProposal(text);
    if ("problem" in parsed) {
      setOutcome({ key, error: parsed.problem });
      return;
    }
    setBusy(true);
    setOutcome(null);
    try {
      const w = simWindowOf(span, from, to);
      setOutcome({ key, result: await simulatePolicy({ agent: picked, proposed: parsed.proposed, window: w }) });
    } catch (e) {
      const at = e instanceof DoorError && typeof e.body.path === "string" ? ` (${e.body.path})` : "";
      setOutcome({ key, error: `${(e as Error).message}${at}`, door: true });
    } finally {
      setBusy(false);
    }
  };
  const shown = outcome?.key === key ? outcome : null;
  const error = shown?.error || (policy?.key === key ? policy.error : "");
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="What is proposed for" hint="simulating an attached agent's proposed policy is not built">
          <Pick value={subject} onChange={() => undefined} options={[{ value: "agent", label: "A saved agent's policy" }]} />
        </Field>
        <Field label="Agent" hint={options.length || quiet || agents === null ? undefined : agentsError ? `the agents could not be read: ${agentsError}` : "none on record"}>
          <Pick value={picked} onChange={setId} options={options} disabled={!options.length} loading={agents === null} />
        </Field>
        <Field label="Over" hint="runs that started in it">
          <Pick value={span} onChange={setSpan} options={SIM_WINDOWS} />
        </Field>
      </div>
      {span === "period" && (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="From">
            <Input type="datetime-local" value={from} onChange={setFrom} />
          </Field>
          <Field label="To">
            <Input type="datetime-local" value={to} onChange={setTo} />
          </Field>
        </div>
      )}
      <Field label="Proposed" hint="the policy block as it stands: edit it, or paste a whole definition">
        <Textarea rows={8} mono value={text} onChange={(v) => setEdited({ key, text: v })} />
      </Field>
      <span className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="solid" tone="ink" disabled={!picked || !text.trim() || simDoor.off} title={simDoor.why} loading={busy} onClick={run}>
          Simulate
        </Button>
        <span className="text-[11px] text-faint">{simDoor.off ? simDoor.why : "Each recorded call is decided again by the run engine's own decision. Nothing is executed or written."}</span>
      </span>
      {error && <Failure inline message={error} />}
      {shown?.result && <SimulationView result={shown.result} />}
    </div>
  );
}

/** One estate target's rules as they stand. Presentational. */
export function TargetRules({ target, onPropose }: { target: TargetKind; onPropose?: (kind: string) => void }) {
  const rows = Object.entries(target.current ?? {}).filter(([k]) => target.fields.includes(k));
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-line px-3 py-2">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold text-fg">{targetLabel(target.kind)}</span>
        {target.replaces && <span className="text-[10.5px] text-faint">replaces {target.replaces}</span>}
        <span className="grow" />
        {onPropose && (
          <Button size="sm" variant="solid" tone="neutral" permission="configure" onClick={() => onPropose(target.kind)}>
            Propose
          </Button>
        )}
      </span>
      <p className="text-[11px] leading-[1.5] text-faint">{target.what}</p>
      {Object.keys(target.by_id).length > 0 && (
        <div className="af-list flex flex-col">
          {Object.entries(target.by_id).map(([id, rules]) => (
            <p key={id} className="text-[11px] leading-[1.5] text-dim">
              <Mono className="text-[10.5px] text-fg">{id}</Mono>: {byIdLine(target, rules)}
            </p>
          ))}
        </div>
      )}
      {target.current ? (
        <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[11px]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="truncate text-dim" title={k}>
                {target.labels[k] ?? k}
              </dt>
              <dd className="truncate font-mono text-[10.5px] text-fg" title={JSON.stringify(v)}>
                {v === null ? "unset" : typeof v === "string" ? v || "none" : JSON.stringify(v)}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        !Object.keys(target.by_id).length && <p className="text-[11px] text-ghost">{target.ids === "peer" ? "Set per peer: pick one to propose." : "Set per agent: pick one to propose."}</p>
      )}
    </div>
  );
}

const STATE_OPTIONS = [{ value: "", label: "Every state" }, ...CHANGE_STATES.map((s) => ({ value: s, label: CHANGE_STATE_META[s].label }))];

function PolicyPage() {
  const params = useSearchParams();
  const router = useRouter();
  const { session } = useSession();
  const who: Who | null = session ? { name: session.name, email: session.email } : null;
  const selected = params.get("change");
  const preset = params.get("simulate");
  const [targets, setTargets] = useState<TargetKinds | null>(null);
  const [targetsError, setTargetsError] = useState("");
  /** Why the agents were not read: the pickers say so instead of "none on record". */
  const [agentsError, setAgentsError] = useState("");
  /** Targets later phases own, as the targets door names them (the typed read leaves them out). */
  const [notBuilt, setNotBuilt] = useState<{ kind: string; what: string; why: string }[]>([]);
  const [list, setList] = useState<PolicyChangeList | null>(null);
  const [change, setChange] = useState<PolicyChange | null>(null);
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [state, setState] = useState("");
  const [target, setTarget] = useState("");
  const [kind, setKind] = useState("");
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [notice, setNotice] = useState("");
  const proposeAt = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    listPolicyChanges({ state: (state || undefined) as ChangeState | undefined, target: target || undefined })
      .then((l) => {
        setList(l);
        setError("");
      })
      .catch((e) => setError((e as Error).message));
    listPolicyTargets()
      .then((t) => {
        setTargets(t);
        setTargetsError("");
      })
      .catch((e) => {
        setError((e as Error).message);
        setTargetsError((e as Error).message);
      });
    fetch("/api/policy/targets", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setNotBuilt(Array.isArray(d?.not_built) ? d.not_built : []))
      .catch(() => setNotBuilt([]));
  }, [state, target]);
  useEffect(() => {
    const cancel = soon(load);
    const id = setInterval(load, 10000);
    return () => {
      cancel();
      clearInterval(id);
    };
  }, [load]);
  useEffect(() => {
    listAgents()
      .then((a) => {
        setAgents(a);
        setAgentsError("");
      })
      .catch((e) => {
        setAgents([]);
        setAgentsError((e as Error).message);
      });
  }, []);
  useEffect(() => {
    if (!selected) return;
    let stop = false;
    getPolicyChange(selected)
      .then((c) => {
        if (stop) return;
        setChange(c);
        setDetailError("");
      })
      .catch((e) => {
        if (stop) return;
        setChange(null);
        setDetailError((e as Error).message);
      });
    return () => {
      stop = true;
    };
  }, [selected]);

  const open = (id: string) => router.push(`/policy?change=${encodeURIComponent(id)}`);
  const pending = list ? (list.states.pending ?? 0) : null;
  const waiting = list ? (list.states.approved ?? 0) : null;
  // A policy door that did not answer: its failure is shown first, and every section says it was not read.
  const quietDown = Boolean(error) && !list && !targets;
  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7">
      <GroupHeader group="controls" tab="policy">
        The rules that decide what runs may do change here: proposed with a diff, approved by someone other than the proposer, applied at their effective time, and rolled back at once in an emergency. A
        spec&rsquo;s own policy keeps its path through versions and reviews; simulate it here first.
      </GroupHeader>

      {/* The policy door's failure comes first, above the catalogue, so the first screenful shows it. */}
      {error && (
        <Banner tone="err" title="Could not read the policy door">
          {error}
        </Banner>
      )}

      {/* The catalogue a deployment starts with: shown whether or not the policy door answers, and said to be a catalogue while it does not. */}
      <PolicyBaseline rules={targets ? targets.targets.map((t) => ({ kind: t.kind, current: t.current })) : null} rulesError={targetsError} />
      {notice && (
        <Banner tone="ok" title="Proposed">
          {notice}
        </Banner>
      )}

      <>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Section title="Changes" hue="approvals" meta={list ? `${list.count} shown · ${pending} awaiting review · ${waiting} approved, not yet effective` : error ? "not read" : "reading…"}>
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-56">
              <Field label="State">
                <Pick value={state} onChange={setState} options={STATE_OPTIONS} />
              </Field>
            </div>
            <div className="w-56">
              <Field label="Target">
                <Pick value={target} onChange={setTarget} options={[{ value: "", label: "Every target" }, ...Object.entries(TARGET_LABEL).map(([value, label]) => ({ value, label }))]} />
              </Field>
            </div>
          </div>
          {list ? <ChangesListView list={list} selected={selected} onSelect={open} filtered={Boolean(state || target)} /> : error ? <p className="text-[12px] text-faint">Not read.</p> : <p className="text-[12px] text-faint">Reading the history…</p>}
        </Section>
        <Section title="Change" hue="approvals" meta={selected ?? "pick one to review it"}>
          {detailError && (<p className="text-[11.5px] text-err">{detailError}</p>)}
          {!selected && <p className="text-[12px] text-faint">{quietDown ? "Not read." : "Nothing picked. A change waiting on you is in the list."}</p>}
          {selected && change?.id === selected && (
            <ChangeDetail
              key={`${change.id}:${change.state}`}
              change={change}
              who={who}
              onMoved={(c) => {
                if (c.id === change.id) setChange(c);
                else open(c.id);
                load();
              }}
            />
          )}
        </Section>
      </div>

      <div ref={proposeAt}>
        <Section id="propose" title="Propose a change" hue="approvals" meta="it waits for someone other than you">
          {targets ? (
            <ProposeForm
              targets={targets.targets}
              agents={agents ?? []}
              agentsError={agentsError}
              kind={kind || targets.targets[0]?.kind || ""}
              onKind={setKind}
              onProposed={(c) => {
                setNotice(proposedLine(c));
                load();
                open(c.id);
              }}
            />
          ) : error ? (
            <p className="text-[12px] text-faint">Not read.</p>
          ) : (
            <p className="text-[12px] text-faint">Reading the targets…</p>
          )}
        </Section>
      </div>

      <Section id="simulate" title="Simulate" hue="run" meta="rule what already happened under what is proposed">
        <SimulatePanel key={preset ?? ""} agents={agents} agentsError={agentsError} preset={preset} quiet={quietDown} />
      </Section>

      <Section title="The rules now" hue="guardrail" meta={targets ? `every change goes through ${targets.door}` : undefined}>
        {targets ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {targets.targets.map((t) => (
              <TargetRules
                key={t.kind}
                target={t}
                onPropose={(k) => {
                  setKind(k);
                  proposeAt.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              />
            ))}
          </div>
        ) : error ? (
          <p className="text-[12px] text-faint">Not read.</p>
        ) : (
          <p className="text-[12px] text-faint">Reading…</p>
        )}
        {notBuilt.length > 0 && (
          <div className="mt-3 flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-dim">Not built</span>
            {notBuilt.map((t) => (
              <p key={t.kind} className="text-[11px] leading-[1.5] text-faint">
                <span className="text-dim">{targetLabel(t.kind)}</span>: {t.what}; {t.why}.
              </p>
            ))}
          </div>
        )}
      </Section>
      </>
    </div>
  );
}

export function PolicyView() {
  return (
    <Suspense>
      <PolicyPage />
    </Suspense>
  );
}
