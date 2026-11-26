"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, type Tone } from "./ui";
import { Field, Input, Textarea } from "./forms";
import { Pick } from "./select";
import { Chips } from "./filters";
import { NotConnectedNote } from "./pending";
import { runStateMeta, shortWhen, workloadName } from "./finding-marks";
import type { Permission } from "@/lib/permissions";
import {
  SEVERITIES,
  ask,
  type Acceptance,
  type AcceptanceCriterion,
  type AcceptanceIssue,
  type AcceptanceIssueClose,
  type AcceptanceIssueOpen,
  type AcceptanceResultEntry,
  type AcceptanceSet,
  type AcceptanceSign,
  type AcceptanceSignoff,
  type CriterionDirection,
  type Door,
  type DoorId,
  type Severity,
  type UseCaseRun,
  type UseCaseRunList,
} from "@/lib/api/pending";

/**
 * The writes of the Acceptance page, one dialog each: setting a use case's
 * criteria and the person who signs each role (`PUT /api/acceptance/{use_case}`),
 * entering a criterion's measured result against a finished run
 * (`POST …/results`), opening and closing an issue (`POST …/issues`,
 * `POST …/issues/{id}/close`) and signing a role (`POST …/sign`).
 *
 * Each dialog sends what the person typed and nothing else. A refusal is
 * shown in the platform's own sentence (403 for a person a role does not
 * name, 404 for a use case that is not registered, 409 for a write the
 * record's state refuses); a 501 says the address is not built.
 */

/** The run states a result may be entered against: the run has finished. The engine names a completed run `done`, and one closed at a gate `closed`. */
const FINISHED = new Set(["done", "completed", "failed", "killed", "closed"]);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A number typed as text, or null when it is not one. A blank is not zero. */
function numberOf(text: string): number | null {
  const t = text.trim();
  if (!/^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** A field's error line, only while it applies. */
const need = (missing: boolean, text: string) => (missing ? text : undefined);

const figure = (v: number): string => v.toLocaleString("en-GB", { maximumFractionDigits: 4 });

export const DIRECTION_WORDS: Record<CriterionDirection, string> = { at_least: "at least", at_most: "at most" };

/** When a criterion is met, in words: "Met when the result is at least 0.9". */
export function metWhen(c: Pick<AcceptanceCriterion, "threshold" | "direction" | "metric">): string {
  if (typeof c.threshold !== "number") return "No threshold set.";
  const side = c.direction ? DIRECTION_WORDS[c.direction] : "against";
  return `Met when the result${c.metric ? ` (${c.metric})` : ""} is ${side} ${figure(c.threshold)}.`;
}

/* ═══════════════════ the frame ═══════════════════ */

/** What a write answered, as the footer says it: not built, refused, or nothing yet. */
type Outcome = { door: Door } | { error: string } | null;

async function send(id: DoorId, params: Record<string, string>, body: unknown): Promise<Outcome | "ok"> {
  const a = await ask<unknown>(id, { params, body });
  if (a.state === "pending") return { door: a.door };
  if (a.state === "error") return { error: a.message };
  return "ok";
}

/**
 * A titled panel over a scrim, with a body that scrolls and a footer for the
 * outcome and the two actions. Escape and a click on the scrim close it while
 * nothing is in flight. Cancel is solid red.
 */
function FormDialog({
  title,
  lead,
  width = "max-w-[560px]",
  busy,
  confirm,
  tone = "ink",
  permission,
  outcome,
  problem,
  onConfirm,
  onClose,
  children,
}: {
  title: string;
  lead?: ReactNode;
  width?: string;
  busy: boolean;
  confirm: string;
  tone?: Tone;
  permission: Permission;
  outcome: Outcome;
  /** Said under the form when confirm was pressed with something missing. */
  problem?: string;
  onConfirm: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const locked = useRef(busy);
  useEffect(() => {
    close.current = onClose;
    locked.current = busy;
  }, [onClose, busy]);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("input, textarea")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      if (!locked.current) close.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-canvas/70 p-4" onClick={busy ? undefined : onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[92vh] w-full ${width} flex-col overflow-hidden rounded-xl border border-line bg-surface elev-3 af-pop`}
      >
        <div className="flex shrink-0 flex-col gap-1 border-b border-line px-5 py-3.5">
          <h3 className="text-[16px] font-semibold tracking-tight">{title}</h3>
          {lead && <div className="text-[12.5px] leading-[1.5] text-dim">{lead}</div>}
        </div>
        <div className="flex min-h-0 grow flex-col gap-4 overflow-y-auto px-5 py-4">{children}</div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
          <span className="min-w-0 grow basis-[40%] text-[11.5px] leading-[1.5]">
            {outcome && "door" in outcome ? (
              <NotConnectedNote door={outcome.door} />
            ) : outcome && "error" in outcome ? (
              <span className="text-err" role="alert">
                Not saved: {outcome.error}
              </span>
            ) : problem ? (
              <span className="text-err">{problem}</span>
            ) : null}
          </span>
          <Button variant="solid" tone="err" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="solid" tone={tone} size="sm" permission={permission} onClick={onConfirm} loading={busy}>
            {confirm}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** One fact of the record a dialog acts on, above its form. */
function About({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-md border border-line bg-canvas px-3 py-2">
      <span className="text-[10.5px] text-faint">{k}</span>
      <span className="text-[12px] break-words text-fg">{children}</span>
    </div>
  );
}

/* ═══════════════════ criteria and sign-off ═══════════════════ */

interface CriterionDraft {
  key: number;
  /** The criterion's id on the record; sent back so its result is kept. Absent for a new one. */
  id?: string;
  text: string;
  metric: string;
  threshold: string;
  direction: CriterionDirection | "";
}
interface SignerDraft {
  key: number;
  role: string;
  person: string;
}

const DIRECTIONS: { value: CriterionDirection | ""; label: string }[] = [
  { value: "", label: "No direction" },
  { value: "at_least", label: "At least the threshold" },
  { value: "at_most", label: "At most the threshold" },
];

/**
 * Set a use case's criteria and the person who signs each role. With a
 * record, the form starts from it (each criterion keeps its id, so its
 * result is kept); without one, the person picks a registered use case that
 * has no record yet, and the record is opened.
 */
export function CriteriaDialog({
  record,
  name: recordName,
  choices,
  onDone,
  onClose,
}: {
  record: Acceptance | null;
  /** The registered use case's name, for the title; the workload's name when absent. */
  name?: string;
  /** Registered use cases with no record yet: `key` is the use case's workload, the record's key. */
  choices: { key: string; name: string }[];
  onDone: (useCase: string) => void;
  onClose: () => void;
}) {
  const next = useRef(1);
  const fresh = () => next.current++;
  const [key, setKey] = useState(record?.use_case ?? (choices.length === 1 ? choices[0].key : ""));
  const [criteria, setCriteria] = useState<CriterionDraft[]>(() =>
    record && record.criteria.length
      ? record.criteria.map((c) => ({
          key: fresh(),
          id: c.id,
          text: c.text,
          metric: c.metric ?? "",
          threshold: typeof c.threshold === "number" ? String(c.threshold) : "",
          direction: c.direction ?? "",
        }))
      : [{ key: fresh(), text: "", metric: "", threshold: "", direction: "" }],
  );
  const [signers, setSigners] = useState<SignerDraft[]>(() =>
    record && record.signoffs.length ? record.signoffs.map((s) => ({ key: fresh(), role: s.role, person: s.person?.email ?? "" })) : [{ key: fresh(), role: "", person: "" }],
  );
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const setCriterion = (k: number, patch: Partial<CriterionDraft>) => setCriteria((all) => all.map((c) => (c.key === k ? { ...c, ...patch } : c)));
  const setSigner = (k: number, patch: Partial<SignerDraft>) => setSigners((all) => all.map((s) => (s.key === k ? { ...s, ...patch } : s)));

  const thresholdBad = (c: CriterionDraft) => c.threshold.trim() !== "" && numberOf(c.threshold) === null;
  const directionMissing = (c: CriterionDraft) => c.threshold.trim() !== "" && !c.direction;
  const criterionOk = (c: CriterionDraft) => Boolean(c.text.trim()) && !thresholdBad(c) && !directionMissing(c);
  const roleCounts = new Map<string, number>();
  for (const s of signers) {
    const r = s.role.trim().toLowerCase();
    if (r) roleCounts.set(r, (roleCounts.get(r) ?? 0) + 1);
  }
  const roleTwice = (s: SignerDraft) => (roleCounts.get(s.role.trim().toLowerCase()) ?? 0) > 1;
  const signerOk = (s: SignerDraft) => Boolean(s.role.trim()) && !roleTwice(s) && EMAIL.test(s.person.trim());
  const ready = Boolean(key) && criteria.length > 0 && criteria.every(criterionOk) && signers.length > 0 && signers.every(signerOk);
  const removed = record ? record.criteria.filter((c) => !criteria.some((d) => d.id === c.id)) : [];
  const removedWithResult = removed.filter((c) => typeof c.result === "number").length;

  const save = async () => {
    setTried(true);
    if (!ready || busy) return;
    const body: AcceptanceSet = {
      criteria: criteria.map((c) => {
        const threshold = numberOf(c.threshold);
        return {
          ...(c.id ? { id: c.id } : {}),
          text: c.text.trim(),
          ...(c.metric.trim() ? { metric: c.metric.trim() } : {}),
          ...(threshold !== null && c.direction ? { threshold, direction: c.direction } : {}),
        };
      }),
      signoffs: signers.map((s) => ({ role: s.role.trim(), person: s.person.trim() })),
    };
    setBusy(true);
    setOutcome(null);
    const got = await send("acceptanceSet", { use_case: key }, body);
    setBusy(false);
    if (got === "ok") return onDone(key);
    setOutcome(got);
  };

  const name = key ? (recordName || choices.find((c) => c.key === key)?.name || workloadName(key)) : "";

  return (
    <FormDialog
      title={record ? `Criteria and sign-off: ${recordName || workloadName(record.use_case)}` : "Set criteria and sign-off"}
      width="max-w-[760px]"
      lead={record ? "Saving replaces the record; earlier signatures stop counting." : "Opens the acceptance record of a registered use case."}
      busy={busy}
      confirm={record ? "Save criteria and sign-off" : "Open the record"}
      permission="configure"
      outcome={outcome}
      problem={tried && !ready ? "Some fields above still need an answer." : undefined}
      onConfirm={() => void save()}
      onClose={onClose}
    >
      {record ? (
        <About k="Use case">
          {name} <span className="font-mono text-[10.5px] text-faint">{record.use_case}</span>
        </About>
      ) : choices.length === 0 ? (
        <p className="text-[12px] leading-[1.55] text-dim">Every registered use case has a record, or none is registered.</p>
      ) : (
        <Field label="Use case" error={need(tried && !key, "Choose the use case the record is for.")} hint={tried && !key ? undefined : "Use cases with no acceptance record yet."}>
          <Pick size="md" aria-label="Use case" value={key} onChange={setKey} options={[{ value: "", label: "Choose a use case" }, ...choices.map((c) => ({ value: c.key, label: `${c.name} (${c.key})` }))]} disabled={busy} invalid={tried && !key} />
        </Field>
      )}

      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] font-semibold text-fg">Criteria</span>
          <span className="text-[11.5px] text-faint">what must be true to accept the use case</span>
          <span className="grow" />
          <Button size="sm" variant="solid" tone="neutral" onClick={() => setCriteria((all) => [...all, { key: fresh(), text: "", metric: "", threshold: "", direction: "" }])} disabled={busy}>
            Add a criterion
          </Button>
        </div>
        {criteria.length === 0 && <p className="text-[12px] text-err">{tried ? "A record needs at least one criterion." : "No criterion yet: add one."}</p>}
        {criteria.map((c, i) => {
          const was = c.id ? record?.criteria.find((x) => x.id === c.id) : undefined;
          return (
            <div key={c.key} className="flex flex-col gap-3 rounded-md border border-line bg-canvas px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11.5px] font-medium text-dim">Criterion {i + 1}</span>
                {c.id ? <span className="font-mono text-[10.5px] text-faint">{c.id}</span> : <span className="text-[10.5px] text-faint">new</span>}
                {was && typeof was.result === "number" && <span className="text-[10.5px] text-faint">keeps its result, {figure(was.result)}</span>}
                <span className="grow" />
                <Button size="sm" variant="solid" tone="err" onClick={() => setCriteria((all) => all.filter((x) => x.key !== c.key))} disabled={busy}>
                  Remove criterion
                </Button>
              </div>
              <Field label="Criterion" error={need(tried && !c.text.trim(), "Say what has to be true.")}>
                <Textarea value={c.text} onChange={(v) => setCriterion(c.key, { text: v })} rows={2} disabled={busy} />
              </Field>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Metric" hint="Optional: what is measured.">
                  <Input value={c.metric} onChange={(v) => setCriterion(c.key, { metric: v })} disabled={busy} autoComplete="off" />
                </Field>
                <Field label="Threshold" error={need(tried && thresholdBad(c), "A number, or blank for none.")} hint={tried && thresholdBad(c) ? undefined : "Optional: blank sets none."}>
                  <Input value={c.threshold} onChange={(v) => setCriterion(c.key, { threshold: v })} disabled={busy} autoComplete="off" mono />
                </Field>
                <Field label="Direction" error={need(tried && directionMissing(c), "Required with a threshold.")}>
                  <Pick size="md" aria-label="Direction" value={c.direction} onChange={(v) => setCriterion(c.key, { direction: v })} options={DIRECTIONS} disabled={busy || c.threshold.trim() === ""} invalid={tried && directionMissing(c)} />
                </Field>
              </div>
            </div>
          );
        })}
        {removed.length > 0 && (
          <p className="text-[11.5px] leading-[1.5] text-warn">
            Saving removes {removed.length === 1 ? "one criterion" : `${removed.length} criteria`} from the record
            {removedWithResult ? `, ${removedWithResult === 1 ? "one of them" : `${removedWithResult} of them`} with ${removedWithResult === 1 ? "its" : "their"} result` : ""}.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] font-semibold text-fg">Sign-off</span>
          <span className="text-[11.5px] text-faint">each accountable role and the one person who signs it</span>
          <span className="grow" />
          <Button size="sm" variant="solid" tone="neutral" onClick={() => setSigners((all) => [...all, { key: fresh(), role: "", person: "" }])} disabled={busy}>
            Add a role
          </Button>
        </div>
        {signers.length === 0 && <p className="text-[12px] text-err">{tried ? "A record needs at least one role to sign it." : "No role yet: add one."}</p>}
        {signers.map((s) => (
          <div key={s.key} className="grid items-start gap-3 rounded-md border border-line bg-canvas px-3 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_max-content]">
            <Field label="Role" error={need(tried && !s.role.trim(), "Name the role.") ?? need(tried && roleTwice(s), "Each role is named once.")}>
              <Input value={s.role} onChange={(v) => setSigner(s.key, { role: v })} disabled={busy} autoComplete="off" />
            </Field>
            <Field label="Signed by" error={need(tried && !EMAIL.test(s.person.trim()), "The email address of the person who signs it.")} hint={tried && !EMAIL.test(s.person.trim()) ? undefined : "Their email address: only they can sign this role."}>
              <Input value={s.person} onChange={(v) => setSigner(s.key, { person: v })} disabled={busy} autoComplete="off" type="email" />
            </Field>
            <span className="flex h-full items-start pt-[26px]">
              <Button size="sm" variant="solid" tone="err" onClick={() => setSigners((all) => all.filter((x) => x.key !== s.key))} disabled={busy}>
                Remove role
              </Button>
            </span>
          </div>
        ))}
      </div>
    </FormDialog>
  );
}

/* ═══════════════════ a measured result ═══════════════════ */

/** Enter a criterion's measured result against a finished run of the use case. The platform works out whether it is met. */
export function ResultDialog({ record, criterion, onDone, onClose }: { record: Acceptance; criterion: AcceptanceCriterion; onDone: () => void; onClose: () => void }) {
  const [runs, setRuns] = useState<UseCaseRun[] | null>(null);
  const [runsOutcome, setRunsOutcome] = useState<Outcome>(null);
  const [run, setRun] = useState("");
  // Blank, not the result on record: a new measurement is typed, never carried over.
  const [result, setResult] = useState("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  useEffect(() => {
    let live = true;
    void ask<UseCaseRunList>("useCaseRuns", { query: { use_case: record.use_case } }).then((a) => {
      if (!live) return;
      if (a.state === "pending") return setRunsOutcome({ door: a.door });
      if (a.state === "error") return setRunsOutcome({ error: a.message });
      const rows = Array.isArray(a.data?.runs) ? a.data.runs : [];
      // Finished runs only; a row that names its use case must name this one.
      setRuns(rows.filter((r) => r && typeof r.id === "string" && FINISHED.has(r.state) && (!r.use_case || r.use_case === record.use_case)));
    });
    return () => {
      live = false;
    };
  }, [record.use_case]);

  const value = numberOf(result);
  const ready = value !== null && Boolean(run);
  const save = async () => {
    setTried(true);
    if (!ready || busy || value === null) return;
    const body: AcceptanceResultEntry = { criterion: criterion.id, result: value, run, ...(note.trim() ? { note: note.trim() } : {}) };
    setBusy(true);
    setOutcome(null);
    const got = await send("acceptanceResult", { use_case: record.use_case }, body);
    setBusy(false);
    if (got === "ok") return onDone();
    setOutcome(got);
  };

  const runLabel = (r: UseCaseRun) => [r.id, r.agent, runStateMeta(r.state).label, shortWhen(r.finished || r.at)].filter(Boolean).join(" · ");

  return (
    <FormDialog
      title="Enter a result"
      lead={metWhen(criterion)}
      busy={busy}
      confirm="Enter the result"
      permission="configure"
      outcome={outcome}
      problem={tried && !ready ? "Enter a number and pick the run." : undefined}
      onConfirm={() => void save()}
      onClose={onClose}
    >
      <About k={`Criterion ${criterion.id}`}>{criterion.text}</About>
      {typeof criterion.result === "number" && (
        <p className="text-[11.5px] leading-[1.5] text-faint">
          Replaces its current result, {figure(criterion.result)}
          {criterion.run ? ` on run ${criterion.run}` : ""}.
        </p>
      )}
      <Field label="Run it was measured on" error={need(tried && !run && runs !== null && runs.length > 0, "Pick the run.")} hint={runs && runs.length ? "Finished runs of this use case." : undefined}>
        {runsOutcome && "door" in runsOutcome ? (
          <NotConnectedNote door={runsOutcome.door} />
        ) : runsOutcome && "error" in runsOutcome ? (
          <span className="text-[11.5px] text-err" role="alert">
            The runs could not be read: {runsOutcome.error}
          </span>
        ) : runs === null ? (
          <span className="text-[11.5px] text-faint">Reading the runs of this use case…</span>
        ) : runs.length === 0 ? (
          <span className="text-[11.5px] leading-[1.5] text-dim">No finished run of this use case yet.</span>
        ) : (
          <Pick size="md" aria-label="Run it was measured on" value={run} onChange={setRun} options={[{ value: "", label: "Choose a run" }, ...runs.map((r) => ({ value: r.id, label: runLabel(r) }))]} disabled={busy} invalid={tried && !run} />
        )}
      </Field>
      <Field label={criterion.metric ? `Result (${criterion.metric})` : "Result"} error={need(tried && value === null, "A number.")}>
        <Input value={result} onChange={setResult} disabled={busy} autoComplete="off" mono />
      </Field>
      <Field label="Note" hint="Optional: how it was measured.">
        <Textarea value={note} onChange={setNote} rows={2} disabled={busy} />
      </Field>
    </FormDialog>
  );
}


/* ═══════════════════ issues ═══════════════════ */

export function IssueDialog({ record, name, onDone, onClose }: { record: Acceptance; name?: string; onDone: () => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [severity, setSeverity] = useState<Severity | "">("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const ready = Boolean(text.trim() && severity);

  const save = async () => {
    setTried(true);
    if (!ready || busy || !severity) return;
    const body: AcceptanceIssueOpen = { text: text.trim(), severity };
    setBusy(true);
    setOutcome(null);
    const got = await send("acceptanceIssue", { use_case: record.use_case }, body);
    setBusy(false);
    if (got === "ok") return onDone();
    setOutcome(got);
  };

  return (
    <FormDialog
      title={`Open an issue: ${name || workloadName(record.use_case)}`}
      lead="Recorded as open, with your name, until someone closes it."
      busy={busy}
      confirm="Open the issue"
      permission="configure"
      outcome={outcome}
      problem={tried && !ready ? "Say what the issue is and how severe it is." : undefined}
      onConfirm={() => void save()}
      onClose={onClose}
    >
      <Field label="Issue" error={need(tried && !text.trim(), "Say what the issue is.")}>
        <Textarea value={text} onChange={setText} rows={3} disabled={busy} />
      </Field>
      <Field label="Severity" error={need(tried && !severity, "Choose a severity.")}>
        <Pick size="md" aria-label="Severity" value={severity} onChange={setSeverity} options={[{ value: "" as const, label: "Choose a severity" }, ...SEVERITIES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))]} disabled={busy} invalid={tried && !severity} />
      </Field>
    </FormDialog>
  );
}

export function CloseIssueDialog({ record, issue, onDone, onClose }: { record: Acceptance; issue: AcceptanceIssue; onDone: () => void; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const save = async () => {
    if (busy) return;
    const body: AcceptanceIssueClose = note.trim() ? { note: note.trim() } : {};
    setBusy(true);
    setOutcome(null);
    const got = await send("acceptanceIssueClose", { use_case: record.use_case, id: issue.id }, body);
    setBusy(false);
    if (got === "ok") return onDone();
    setOutcome(got);
  };

  return (
    <FormDialog
      title="Close the issue"
      lead="Recorded as closed, with your name and the note."
      busy={busy}
      confirm="Close the issue"
      permission="configure"
      outcome={outcome}
      onConfirm={() => void save()}
      onClose={onClose}
    >
      <About k={`Issue ${issue.id} · ${issue.severity}`}>{issue.text}</About>
      <Field label="Note" hint="Optional: how it was resolved.">
        <Textarea value={note} onChange={setNote} rows={2} disabled={busy} />
      </Field>
    </FormDialog>
  );
}

/* ═══════════════════ signing ═══════════════════ */

type Decision = "accepted" | "rejected";

/** Sign one role of a record, as the person it names. */
export function SignDialog({ record, name, signoff, onDone, onClose }: { record: Acceptance; name?: string; signoff: AcceptanceSignoff; onDone: () => void; onClose: () => void }) {
  const [decision, setDecision] = useState<Decision | "">("");
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const noteNeeded = decision === "rejected";
  const ready = Boolean(decision) && (!noteNeeded || Boolean(note.trim()));

  const save = async () => {
    setTried(true);
    if (!ready || busy || !decision) return;
    const body: AcceptanceSign = { role: signoff.role, decision, note: note.trim() };
    setBusy(true);
    setOutcome(null);
    const got = await send("acceptanceSign", { use_case: record.use_case }, body);
    setBusy(false);
    if (got === "ok") return onDone();
    setOutcome(got);
  };

  return (
    <FormDialog
      title={`Sign ${name || workloadName(record.use_case)} as ${signoff.role}`}
      lead="Signs the record as it stands now; a signature is never changed."
      busy={busy}
      confirm={decision === "rejected" ? "Sign: reject" : decision === "accepted" ? "Sign: accept" : "Sign"}
      permission="approve"
      outcome={outcome}
      problem={tried && !ready ? (decision ? "A rejection needs a note that says why." : "Choose accept or reject.") : undefined}
      onConfirm={() => void save()}
      onClose={onClose}
    >
      {signoff.stale && <p className="text-[11.5px] leading-[1.5] text-warn">Your earlier signature was on an earlier version and does not count.</p>}
      <div className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-mist">Decision</span>
        <span className={`flex h-8 items-center ${busy ? "pointer-events-none opacity-40" : ""}`}>
          <Chips
            items={[
              { value: "accepted", label: "Accept", active: decision === "accepted" },
              { value: "rejected", label: "Reject", active: decision === "rejected" },
            ]}
            onToggle={(v) => setDecision(decision === v ? "" : (v as Decision))}
          />
        </span>
      </div>
      <Field label="Note" error={need(tried && noteNeeded && !note.trim(), "Required for a rejection.")} hint={noteNeeded ? undefined : "Kept with the signature."}>
        <Textarea value={note} onChange={setNote} rows={3} disabled={busy} placeholder="What the decision rests on" />
      </Field>
    </FormDialog>
  );
}
