"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Mono, Status, Tag } from "./ui";
import { Field, Textarea } from "./forms";
import { api, errorText, type RunRow } from "@/lib/api/client";
import { auditLine, fleet, FLEET_ACTIONS, getFleet, inFlight, setLockdown, type FleetAction, type FleetResult, type LockdownState, type PauseInfo } from "@/lib/api/l5";
import type { Owner } from "@/lib/api/pending";

/**
 * One form for stopping things.
 *
 * Stopping every run in flight, stopping the runs of the agents ticked in
 * the estate list, and locking the estate down are three sizes of the same
 * decision, so they are one dialog in three steps: what to stop and why;
 * the impact, read fresh from the run ledger at that moment; and, once
 * confirmed, what the door answered it reached. Nothing is sent before the
 * confirm, and what is sent is what the three separate buttons sent before:
 * `POST /api/runs/kill-all {reason}`, `POST /api/fleet {action: "kill",
 * agents, reason}`, `POST /api/lockdown {on: true, reason}`.
 *
 * The same two doors also hold work back and let it go again, so the form
 * offers that too, in the same three steps: pausing the ticked agents,
 * draining them (running work finishes, nothing new starts), resuming them
 * (`POST /api/fleet {action: "pause" | "drain" | "resume"}`, the run
 * permission) and lifting the lockdown (`POST /api/lockdown {on: false}`,
 * which the door gives to configure, as it does switching it on).
 */

export type StopScope = "all" | "agents" | "lockdown" | "pause" | "drain" | "resume" | "unlock";

/** The fleet action a choice sends; null for the two that are not fleet actions on agents. */
const FLEET_OF: Partial<Record<StopScope, FleetAction>> = { agents: "kill", pause: "pause", drain: "drain", resume: "resume" };
/** Choices whose runs in flight are stopped, and choices that leave them to finish. */
const STOPS_RUNS: StopScope[] = ["all", "agents", "pause"];
const READS_RUNS: StopScope[] = ["all", "agents", "pause", "lockdown", "drain"];

export type StopOutcome =
  | { scope: "all"; killed: string[]; by: string; at: string; reason: string }
  | { scope: "agents"; result: FleetResult }
  | { scope: "lockdown"; state: LockdownState };

/** The one-line notice a page shows behind the form once the door has answered. */
export function stopNotice(o: StopOutcome): string {
  if (o.scope === "all") return `Kill switch thrown on ${o.killed.length} run${o.killed.length === 1 ? "" : "s"}`;
  if (o.scope === "agents") {
    const r = o.result;
    const n = `${r.agents.length} agent${r.agents.length === 1 ? "" : "s"}`;
    if (r.action === "pause") return `Paused ${n}: nothing new starts for them${r.killed.length ? ` · ${r.killed.length} run${r.killed.length === 1 ? "" : "s"} killed` : ""}${auditLine(r.audit_id)}`;
    if (r.action === "drain") return `Draining ${n}: running work finishes, nothing new starts${auditLine(r.audit_id)}`;
    if (r.action === "resume") return `Resumed ${n}: starts and claims are accepted again${auditLine(r.audit_id)}`;
    return `Killed runs on ${r.agents.length} agent${r.agents.length === 1 ? "" : "s"}${r.killed.length ? ` · ${r.killed.length} run${r.killed.length === 1 ? "" : "s"} killed` : ""}${auditLine(r.audit_id)}`;
  }
  if (!o.state.on) return `Lockdown lifted${auditLine(o.state.audit_id)}`;
  return `Lockdown on: nothing new starts or is claimed until it is lifted${auditLine(o.state.audit_id)}`;
}

/** What a lockdown does and does not do, in the words the lockdown switch has always used. */
const LOCKDOWN_WILL = [
  "Until this is lifted, no worker claims queued work and no run starts (a start is refused).",
  "A run resumed meanwhile waits for a person at every tool call above read and every sink.",
  "One audit event names the controls.",
];
const LOCKDOWN_WILL_NOT = [
  "The trigger, webhook and cron doors keep accepting work, which waits on the queue.",
  "Runs already in flight finish as they started, so the queue drains.",
];

/** What lifting a lockdown does, in the words the lockdown switch has always used. */
const UNLOCK_WILL = ["Workers claim the queue again and runs start.", "Gates and sinks return to what each agent's spec says.", "One audit event records who lifted it and why."];

/** A fleet action in the fleet bar's own words, as a sentence: "Kills every run in flight for these agents ...". */
const fleetWhat = (id: FleetAction): string => ((w: string) => (w ? `${w[0].toUpperCase()}${w.slice(1)}.` : ""))(FLEET_ACTIONS.find((a) => a.id === id)?.what ?? "");
const KILL_WHAT = fleetWhat("kill");
const fleetVerb = (id: FleetAction): string => FLEET_ACTIONS.find((a) => a.id === id)?.verb ?? "";

/** A run row with the owner the runs door will gain; shown when present. */
type Row = RunRow & { owner?: Owner };

function clock(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const runHref = (id: string) => `/runs?id=${encodeURIComponent(id)}`;

const STEPS: { id: "what" | "review" | "done"; label: string }[] = [
  { id: "what", label: "What to do" },
  { id: "review", label: "Review impact" },
  { id: "done", label: "What was reached" },
];

export function StopForm({
  initial,
  agents: givenAgents,
  names,
  lockdown,
  onDone,
  onClose,
}: {
  /** The choice the form opens on: the button that opened it. */
  initial: StopScope;
  /** The agents ticked in the estate list; empty when none are. */
  agents: string[];
  names: (id: string) => string;
  /** The lockdown as last read; null while it has not been read. */
  lockdown: LockdownState | null;
  /** Called as soon as the door answers, so the page behind can re-read. The form stays open on the answer. */
  onDone: (outcome: StopOutcome) => void;
  onClose: () => void;
}) {
  // The selection as it stood when the form opened: the page clears its ticks once the door answers.
  const [agents] = useState(() => [...givenAgents]);
  const [labels] = useState(() => Object.fromEntries(givenAgents.map((id) => [id, names(id)])));
  const [scope, setScope] = useState<StopScope>(initial);
  const [reason, setReason] = useState("");
  const [missing, setMissing] = useState(false);
  const [step, setStep] = useState<"what" | "review" | "done">("what");
  const [runs, setRuns] = useState<Row[] | null>(null);
  const [runsError, setRunsError] = useState("");
  const [readAt, setReadAt] = useState("");
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [outcome, setOutcome] = useState<StopOutcome | null>(null);
  /** The runs listed at review when confirm was pressed, to set beside what the door reached. */
  const [listed, setListed] = useState<string[] | null>(null);
  /** Which agents stand paused or draining, read at review before a resume; null until it is read. */
  const [held, setHeld] = useState<Record<string, PauseInfo> | null>(null);
  const [heldError, setHeldError] = useState("");

  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const idle = useRef(true);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    idle.current = !busy;
  }, [busy]);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("textarea")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && idle.current) {
        e.preventDefault();
        close.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, []);

  const unticked = agents.length ? "" : "No agents are ticked in the estate list.";
  const off: Record<StopScope, string> = {
    all: "",
    agents: unticked,
    lockdown: lockdown === null ? "The lockdown state has not been read yet." : lockdown.on ? "The estate is already locked down." : "",
    pause: unticked,
    drain: unticked,
    resume: unticked,
    unlock: lockdown === null ? "The lockdown state has not been read yet." : lockdown.on ? "" : "The estate is not locked down.",
  };
  const action = FLEET_OF[scope] ?? null;
  const locks = scope === "lockdown" || scope === "unlock";
  const agentList = agents.map((id) => labels[id] ?? id).join(", ");

  /* The ledger, read now: every run in flight, whoever drives it. */
  const readRuns = useCallback(async () => {
    setReading(true);
    try {
      const { data, error, response } = await api.GET("/api/runs");
      if (!data) throw new Error(errorText(error, response));
      setRuns(inFlight(data.runs as Row[]));
      setRunsError("");
      setReadAt(new Date().toISOString());
    } catch (e) {
      setRuns(null);
      setRunsError((e as Error).message);
    } finally {
      setReading(false);
    }
  }, []);

  /* Who is held now, read fresh before a resume. */
  const readHeld = useCallback(async () => {
    setReading(true);
    try {
      setHeld((await getFleet()).paused);
      setHeldError("");
      setReadAt(new Date().toISOString());
    } catch (e) {
      setHeld(null);
      setHeldError((e as Error).message);
    } finally {
      setReading(false);
    }
  }, []);

  const review = () => {
    if (!reason.trim()) {
      setMissing(true);
      return;
    }
    if (off[scope]) return;
    setFailure("");
    setReadAt("");
    setStep("review");
    if (READS_RUNS.includes(scope)) void readRuns();
    if (scope === "resume") void readHeld();
  };

  const mine = (rows: Row[] | null): Row[] => {
    if (!rows) return [];
    if (!action) return rows;
    const set = new Set(agents);
    return rows.filter((r) => set.has(r.agent) || set.has(r.system));
  };
  const affected = mine(runs);

  const confirm = async () => {
    const text = reason.trim();
    setBusy(true);
    setFailure("");
    setListed(runs && STOPS_RUNS.includes(scope) ? affected.map((r) => r.id) : null);
    try {
      let o: StopOutcome;
      if (scope === "all") {
        const { data, error, response } = await api.POST("/api/runs/kill-all", { body: { reason: text } });
        if (!data) throw new Error(errorText(error, response));
        o = { scope: "all", killed: data.killed, by: data.kill?.by ?? "", at: data.kill?.at ?? "", reason: data.kill?.reason ?? text };
      } else if (action) {
        o = { scope: "agents", result: await fleet(action, agents, text) };
      } else {
        o = { scope: "lockdown", state: await setLockdown(scope === "lockdown", text) };
      }
      setOutcome(o);
      setStep("done");
      onDone(o);
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const options: { id: StopScope; title: string; line: string }[] = [
    { id: "all", title: "Every run in flight", line: "In-process and on workers. Each is cancelled before its next model or tool call; every journal records the reason and your name." },
    { id: "agents", title: "The selected agents' runs", line: agents.length ? `${agentList}. ${KILL_WHAT}` : KILL_WHAT },
    { id: "lockdown", title: "Lock the estate down", line: "Nothing new starts or is claimed until it is lifted. Runs already in flight finish as they started." },
    { id: "pause", title: "Pause the selected agents", line: "Nothing new starts for them and their runs in flight are killed, until they are resumed." },
    { id: "drain", title: "Drain the selected agents", line: "Nothing new starts for them and their runs in flight finish, until they are resumed." },
    { id: "resume", title: "Resume the selected agents", line: "Lifts a pause or a drain: starts and queue claims are accepted again." },
    { id: "unlock", title: "Lift the lockdown", line: "Workers claim the queue again and runs start." },
  ];
  const these = agents.length === 1 ? "this agent" : "these agents";
  const confirmLabel: Record<StopScope, string> = {
    all: "Stop every run",
    agents: `Stop ${agents.length === 1 ? "this agent's" : "these agents'"} runs`,
    lockdown: "Lock down",
    pause: `Pause ${these}`,
    drain: `Drain ${these}`,
    resume: `Resume ${these}`,
    unlock: "Lift lockdown",
  };
  /** What a refusal is called, per choice. */
  const refused: Record<StopScope, string> = { all: "Stop refused", agents: "Stop refused", lockdown: "Lockdown refused", pause: "Pause refused", drain: "Drain refused", resume: "Resume refused", unlock: "Lifting the lockdown refused" };
  /** Letting work go again is not a stop: its confirm is the ink button, the rest stay red. */
  const releases = scope === "resume" || scope === "unlock";
  const permission = locks ? "configure" : "run";
  const done = outcome?.scope === "agents" ? outcome.result.action : null;
  const reached = outcome ? (outcome.scope === "all" ? outcome.killed : outcome.scope === "agents" ? outcome.result.killed : []) : [];
  const notReached = listed && outcome && outcome.scope !== "lockdown" ? listed.filter((id) => !reached.includes(id)) : [];
  const doneTitle = !outcome ? "" : outcome.scope === "lockdown" ? (outcome.state.on ? "The estate is locked down" : "The lockdown is lifted") : done && done !== "kill" ? fleetVerb(done) : "Stopped";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-canvas/70 p-4" onClick={busy ? undefined : onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="af-stop-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-[640px] flex-col overflow-hidden rounded-xl border border-line bg-surface elev-3 af-pop"
      >
        <div className="flex shrink-0 flex-col gap-2 border-b border-line px-5 py-3.5">
          <h3 id="af-stop-title" className="text-[16px] font-semibold tracking-tight">
            {step === "done" ? doneTitle : "Stop, pause or resume"}
          </h3>
          <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px]">
            {STEPS.map((s, i) => (
              <li key={s.id} aria-current={step === s.id ? "step" : undefined} className={`flex items-center gap-1.5 ${step === s.id ? "font-semibold text-fg" : "text-faint"}`}>
                <span className={`tnum grid size-4 place-items-center rounded-[3px] text-[10px] ${step === s.id ? "bg-ink text-on-ink" : "border border-line bg-raise text-dim"}`}>{i + 1}</span>
                {s.label}
              </li>
            ))}
          </ol>
        </div>

        <div className="flex min-h-0 grow flex-col gap-4 overflow-y-auto px-5 py-4">
          {step === "what" && (
            <>
              <div role="radiogroup" aria-label="What to do" className="grid gap-2 sm:grid-cols-2">
                {options.map((o) => {
                  const on = scope === o.id;
                  const why = off[o.id];
                  return (
                    <button
                      key={o.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={Boolean(why)}
                      onClick={() => setScope(o.id)}
                      className={`focusable flex items-start gap-3 rounded-md border px-3 py-2.5 text-left transition-colors ${FLEET_OF[o.id] && o.id !== "agents" || o.id === "unlock" ? "" : "sm:col-span-2"} ${on && !why ? "border-fg bg-raise/60" : "border-line bg-surface hover:bg-raise/40"} ${why ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                    >
                      <span className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border ${on && !why ? "border-ink" : "border-line-strong"}`}>{on && !why && <span className="size-2 rounded-full bg-ink" />}</span>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-[13px] font-medium text-fg">{o.title}</span>
                        <span className="text-[12px] leading-[1.5] text-dim">{o.line}</span>
                        {why && <span className="text-[11.5px] text-warn">{why}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
              <Field label="Reason" error={missing ? "This needs a reason; it is recorded with your name." : undefined} hint={missing ? undefined : "Recorded with your name: in each run's journal for a kill, in the audit event for a fleet action or a lockdown."}>
                <Textarea
                  rows={2}
                  value={reason}
                  onChange={(v) => {
                    setReason(v);
                    setMissing(false);
                  }}
                  placeholder="Why."
                />
              </Field>
            </>
          )}

          {step === "review" && (
            <>
              <div className="flex flex-col gap-1 rounded-md border border-line bg-canvas px-3 py-2.5">
                <span className="text-[13px] font-medium text-fg">{options.find((o) => o.id === scope)?.title}</span>
                {action && <span className="text-[12px] leading-[1.5] text-dim">{agentList}</span>}
                <span className="text-[12px] leading-[1.5] text-dim">Reason: {reason.trim()}</span>
              </div>

              {scope === "lockdown" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-medium text-faint">It will</span>
                    <ul className="flex flex-col gap-1.5">
                      {LOCKDOWN_WILL.map((l) => (
                        <li key={l} className="flex items-start gap-2 text-[12.5px] leading-[1.5] text-fg">
                          <span className="mt-[7px] size-1.5 shrink-0 rounded-[2px] bg-err" />
                          {l}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-medium text-faint">It will not</span>
                    <ul className="flex flex-col gap-1.5">
                      {LOCKDOWN_WILL_NOT.map((l) => (
                        <li key={l} className="flex items-start gap-2 text-[12.5px] leading-[1.5] text-fg">
                          <span className="mt-[7px] size-1.5 shrink-0 rounded-[2px] bg-faint" />
                          {l}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              {action && action !== "kill" && (
                <p className="text-[12.5px] leading-[1.55] text-fg">
                  {fleetWhat(action)} {action === "resume" ? "" : "It holds until the agents are resumed. "}One audit event records the action, the reason and your name.
                </p>
              )}

              {scope === "unlock" && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] font-medium text-faint">It will</span>
                  <ul className="flex flex-col gap-1.5">
                    {UNLOCK_WILL.map((l) => (
                      <li key={l} className="flex items-start gap-2 text-[12.5px] leading-[1.5] text-fg">
                        <span className="mt-[7px] size-1.5 shrink-0 rounded-[2px] bg-ink" />
                        {l}
                      </li>
                    ))}
                  </ul>
                  {lockdown?.on && (lockdown.by || lockdown.reason) && (
                    <span className="pt-1 text-[12px] leading-[1.5] text-dim">
                      The lockdown was set{lockdown.by ? ` by ${lockdown.by}` : ""}
                      {lockdown.at ? ` at ${clock(lockdown.at)}` : ""}
                      {lockdown.reason ? `. Reason: ${lockdown.reason}` : ""}
                    </span>
                  )}
                </div>
              )}

              {scope === "resume" && (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12.5px] font-semibold text-fg">How these agents stand now</span>
                    <span className="grow" />
                    {readAt && <span className="text-[11px] text-faint">read {clock(readAt)}</span>}
                    <Button size="sm" variant="solid" tone="neutral" onClick={() => void readHeld()} loading={reading} disabled={busy}>
                      Read again
                    </Button>
                  </div>
                  {heldError && (
                    <p className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err">
                      Which agents are paused or draining could not be read: {heldError}. Confirming still sends the resume.
                    </p>
                  )}
                  {!held && !heldError && <p className="text-[12px] text-faint">Reading which agents are paused or draining…</p>}
                  {held && (
                    <ul className="flex flex-col overflow-hidden rounded-md border border-line">
                      {agents.map((id) => {
                        const p = held[id];
                        return (
                          <li key={id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line px-3 py-2 last:border-b-0">
                            <span className="text-[12.5px] font-medium text-fg">{labels[id] ?? id}</span>
                            {p ? <Status tone="warn">{p.mode === "drain" ? "Draining" : "Paused"}</Status> : <span className="text-[12px] text-faint">not paused or draining</span>}
                            {p && (
                              <span className="min-w-0 text-[12px] leading-[1.5] text-dim">
                                {p.by ? `by ${p.by}` : ""}
                                {p.at ? ` at ${clock(p.at)}` : ""}
                                {p.reason ? `${p.by || p.at ? ". " : ""}Reason: ${p.reason}` : ""}
                              </span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {held && agents.every((id) => !held[id]) && <p className="text-[12px] leading-[1.5] text-dim">None of these agents is paused or draining right now. Confirming still sends the resume; the door answers how they stand.</p>}
                </div>
              )}

              {READS_RUNS.includes(scope) && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] font-semibold text-fg">
                    {STOPS_RUNS.includes(scope) ? "Runs in flight that will be stopped" : "Runs in flight, which will finish as they started"}
                  </span>
                  {runs && <span className="tnum text-[12px] text-faint">{affected.length}</span>}
                  <span className="grow" />
                  {readAt && <span className="text-[11px] text-faint">read {clock(readAt)}</span>}
                  <Button size="sm" variant="solid" tone="neutral" onClick={() => void readRuns()} loading={reading} disabled={busy}>
                    Read again
                  </Button>
                </div>
                {runsError && (
                  <p className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err">
                    The runs in flight could not be read: {runsError}. Nothing is listed; the door still answers what it reached.
                  </p>
                )}
                {!runs && !runsError && <p className="text-[12px] text-faint">Reading the runs in flight…</p>}
                {runs && affected.length === 0 && (
                  <p className="rounded-md border border-line bg-surface px-3 py-2 text-[12px] leading-[1.5] text-dim">
                    {action ? "None of these agents has a run in flight right now." : "Nothing is in flight right now."}
                    {(scope === "all" || scope === "agents") && " Confirming still sends the stop; the door answers what it reached."}
                    {(scope === "pause" || scope === "drain") && " Confirming still closes them to new work."}
                  </p>
                )}
                {runs && affected.length > 0 && <RunList rows={affected} />}
              </div>
              )}

              {failure && (
                <p role="alert" className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[12px] leading-[1.5] text-err">
                  {refused[scope]}: {failure}
                </p>
              )}
            </>
          )}

          {step === "done" && outcome && (
            <>
              {outcome.scope === "lockdown" ? (
                <div className="flex flex-col gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <Status tone={outcome.state.on ? "err" : "neutral"}>{outcome.state.on ? "Lockdown on" : "Lockdown off"}</Status>
                    <span className="text-[12px] text-dim">
                      {outcome.state.by ? `set by ${outcome.state.by}` : ""}
                      {outcome.state.at ? ` at ${clock(outcome.state.at)}` : ""}
                      {auditLine(outcome.state.audit_id)}
                    </span>
                  </span>
                  <span className="text-[12px] leading-[1.5] text-dim">Reason: {outcome.state.reason}</span>
                  {!outcome.state.on ? (
                    <span className="text-[12.5px] leading-[1.5] text-fg">Workers claim the queue again and runs start. Gates and sinks are back to what each agent&rsquo;s spec says.</span>
                  ) : outcome.state.controls.length > 0 ? (
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-medium text-faint">Controls now in force, as the door answered</span>
                      <ul className="flex flex-col gap-1">
                        {outcome.state.controls.map((c) => (
                          <li key={c} className="flex items-start gap-2 text-[12.5px] leading-[1.5] text-fg">
                            <span className="mt-[7px] size-1.5 shrink-0 rounded-[2px] bg-err" />
                            {c}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <span className="text-[12px] text-faint">The door named no controls in its answer.</span>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {outcome.scope === "agents" && done && done !== "kill" && (
                    <ul className="flex flex-col overflow-hidden rounded-md border border-line">
                      {outcome.result.agents.map((id) => {
                        const p = outcome.result.paused[id];
                        return (
                          <li key={id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-b border-line px-3 py-2 last:border-b-0">
                            <span className="text-[12.5px] font-medium text-fg">{labels[id] ?? id}</span>
                            {p ? <Status tone="warn">{p.mode === "drain" ? "Draining" : "Paused"}</Status> : <Status tone="ok">Accepting work</Status>}
                            <span className="text-[12px] text-dim">{p ? (p.mode === "drain" ? "running work finishes, nothing new starts" : "nothing new starts") : "starts and claims are accepted"}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {(!done || done === "kill" || done === "pause") && (
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="tnum text-[22px] leading-none font-semibold tracking-[-0.02em]">{reached.length}</span>
                    <span className="text-[13px] text-fg">run{reached.length === 1 ? "" : "s"} reached, as the door answered</span>
                  </span>
                  )}
                  <span className="text-[12px] leading-[1.5] text-dim">
                    {outcome.scope === "all"
                      ? `${outcome.by ? `By ${outcome.by}` : "Sent"}${outcome.at ? ` at ${clock(outcome.at)}` : ""}. Reason: ${outcome.reason}`
                      : `${outcome.result.by ? `By ${outcome.result.by}` : "Sent"}${outcome.result.at ? ` at ${clock(outcome.result.at)}` : ""} for ${outcome.result.agents.map((id) => labels[id] ?? id).join(", ")}${auditLine(outcome.result.audit_id)}. Reason: ${outcome.result.reason}`}
                  </span>
                  {reached.length > 0 && (
                    <ul className="flex flex-col overflow-hidden rounded-md border border-line">
                      {reached.map((id) => (
                        <li key={id} className="flex items-center gap-2 border-b border-line px-3 py-1.5 last:border-b-0">
                          <span className="size-1.5 shrink-0 rounded-[2px] bg-err" />
                          <Link href={runHref(id)} className="focusable min-w-0 truncate rounded-sm font-mono text-[11.5px] text-fg hover:underline">
                            {id}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  {reached.length === 0 && (!done || done === "kill" || done === "pause") && <p className="text-[12px] text-dim">The door answered that it reached no run.</p>}
                  {notReached.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[11.5px] leading-[1.5] text-warn">
                        {notReached.length} run{notReached.length === 1 ? "" : "s"} listed at review {notReached.length === 1 ? "is" : "are"} not in the door&rsquo;s answer.
                      </span>
                      <span className="flex flex-wrap gap-1.5">
                        {notReached.map((id) => (
                          <Link key={id} href={runHref(id)} className="focusable rounded-sm border border-line bg-raise px-1.5 py-0.5 font-mono text-[10.5px] text-dim hover:underline">
                            {id}
                          </Link>
                        ))}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
          {step === "what" && (
            <>
              <Button variant="solid" tone="err" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="solid" tone="ink" size="sm" permission={permission} onClick={review} disabled={Boolean(off[scope])}>
                Review impact
              </Button>
            </>
          )}
          {step === "review" && (
            <>
              <Button variant="solid" tone="neutral" size="sm" onClick={() => setStep("what")} disabled={busy}>
                Back
              </Button>
              <span className="grow" />
              <Button variant="solid" tone="err" size="sm" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button variant="solid" tone={releases ? "ink" : "err"} size="sm" permission={permission} onClick={() => void confirm()} loading={busy}>
                {confirmLabel[scope]}
              </Button>
            </>
          )}
          {step === "done" && (
            <Button variant="solid" tone="err" size="sm" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The runs a stop will reach: agent, when it started, who started it when the ledger says. */
function RunList({ rows }: { rows: Row[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full min-w-[480px] border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-line bg-raise/55 text-left text-[10.5px] text-faint">
            <th className="px-3 py-1.5 font-medium">Agent</th>
            <th className="px-3 py-1.5 font-medium">Run</th>
            <th className="px-3 py-1.5 font-medium">Started</th>
            <th className="px-3 py-1.5 font-medium">By</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b border-line align-top last:border-b-0">
              <td className="px-3 py-1.5">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium text-fg">{r.agent || r.system}</span>
                  {r.shadow && <Tag>shadow</Tag>}
                  {r.state === "suspended" && <Tag tone="warn">at a gate</Tag>}
                </span>
              </td>
              <td className="max-w-[200px] px-3 py-1.5">
                <Mono className="block truncate text-[11px]">{r.id}</Mono>
              </td>
              <td className="tnum px-3 py-1.5 whitespace-nowrap text-dim">{clock(r.started)}</td>
              <td className="px-3 py-1.5 text-dim">{r.owner?.name || r.owner?.email || (r.source ? `via ${r.source}` : "")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
