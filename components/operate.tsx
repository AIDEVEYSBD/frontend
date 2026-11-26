"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Mono, Status } from "./ui";
import { Checkbox, Field, Switch, Textarea } from "./forms";
import { Failure } from "./pending";
import { auditLine, fleet, FLEET_ACTIONS, getFleet, getLockdown, setLockdown, type FleetAction, type FleetResult, type FleetState, type LockdownState } from "@/lib/api/l5";
import { listAgents, type AgentSummary } from "@/lib/api/l2";
import { hueFor } from "@/lib/hue";
import { soon } from "@/lib/soon";

/**
 * Operating the estate: fleet actions on chosen agents, and the lockdown.
 *
 * Both are operator decisions the platform records as one audit event with
 * a reason and who, so each is a dialog that names what it is about to do
 * and takes the reason before anything is sent (the shape of
 * components/kill-dialog.tsx). The two that stop work, stopping the ticked
 * agents' runs and switching the lockdown on, go to the one stop form
 * (components/stop-form.tsx) when the page gives a way to open it; pause,
 * resume, drain and lifting the lockdown keep the reason dialog here. Fleet
 * actions need the run permission, the lockdown configure (to lock and to
 * lift); the buttons say so when the person lacks it. Which agents stand
 * paused or draining is the platform's to say (`GET /api/fleet`).
 */

/** What a lockdown holds while it is on, as the platform carries it out (agentfactory/control/lockdown.py). */
export const LOCKDOWN_HOLDS = "Every start is refused; runs in flight go on with writes held.";

/** Each fleet action's consequence, in one short line. */
export const FLEET_LINE: Record<FleetAction, string> = {
  pause: "Nothing new starts; their runs in flight stop, until resumed.",
  resume: "Their runs start again.",
  drain: "Nothing new starts; their runs in flight finish, until resumed.",
  kill: "Stops their runs in flight; new runs still start.",
};

/* ═══════════════════ a reason dialog ═══════════════════ */

function ReasonDialog({
  title,
  what,
  confirm,
  tone,
  permission,
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string;
  what: string;
  confirm: string;
  tone: "ink" | "warn" | "err";
  permission: "run" | "configure";
  busy?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [missing, setMissing] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("textarea")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
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
  const fire = () => {
    const text = reason.trim();
    if (!text) {
      setMissing(true);
      return;
    }
    onConfirm(text);
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-canvas/70 p-4" onClick={busy ? undefined : onClose}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="af-reason-title" onClick={(e) => e.stopPropagation()} className="w-full max-w-[460px] rounded-xl border border-line bg-surface elev-3 af-pop">
        <div className="flex flex-col gap-3 p-5 pb-4">
          <div className="flex flex-col gap-1.5">
            <h3 id="af-reason-title" className="text-[16px] font-semibold tracking-tight">
              {title}
            </h3>
            <p className="text-[13px] leading-[1.55] text-dim">{what}</p>
          </div>
          <Field label="Reason" error={missing ? "This needs a reason." : undefined} hint={missing ? undefined : "Written into the audit event with your name."}>
            <Textarea
              rows={2}
              value={reason}
              onChange={(v) => {
                setReason(v);
                setMissing(false);
              }}
              placeholder="Why."
              disabled={busy}
            />
          </Field>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <Button variant="solid" tone="err" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="solid" tone={tone} size="sm" permission={permission} onClick={fire} loading={busy}>
            {confirm}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ fleet ═══════════════════ */

/** The four fleet buttons for a selection of agents; each opens the reason dialog, then posts to `/api/fleet`. */
export function FleetBar({
  agents,
  names,
  onDone,
  onClear,
  onStop,
}: {
  agents: string[];
  names: (id: string) => string;
  onDone: (r: FleetResult) => void;
  onClear: () => void;
  /** Opens the stop form (components/stop-form.tsx) for these agents; when given, Kill goes there instead of the reason dialog. */
  onStop?: () => void;
}) {
  const [ask, setAsk] = useState<FleetAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const action = FLEET_ACTIONS.find((a) => a.id === ask) ?? null;
  const list = agents.map(names).join(", ");

  const fire = async (reason: string) => {
    if (!ask) return;
    setBusy(true);
    setError("");
    try {
      const r = await fleet(ask, agents, reason);
      setAsk(null);
      onDone(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <span className="text-[11px] text-faint">
        {agents.length} selected
      </span>
      {FLEET_ACTIONS.map((a) => (
        <Button key={a.id} size="sm" variant="solid" tone={a.tone} permission="run" onClick={() => (a.id === "kill" && onStop ? onStop() : setAsk(a.id))} disabled={agents.length === 0}>
          {a.label}
        </Button>
      ))}
      <Button size="sm" variant="quiet" onClick={onClear}>
        Clear
      </Button>
      {ask && action && (
        <ReasonDialog
          title={`${action.label} ${agents.length} agent${agents.length === 1 ? "" : "s"}?`}
          what={`${list}. ${FLEET_LINE[action.id]}${error ? ` Last attempt: ${error}` : ""}`}
          confirm={`${action.label} ${agents.length === 1 ? "agent" : `${agents.length} agents`}`}
          tone={action.tone}
          permission="run"
          busy={busy}
          onConfirm={fire}
          onClose={() => {
            if (!busy) {
              setAsk(null);
              setError("");
            }
          }}
        />
      )}
    </span>
  );
}

/**
 * Which agents are paused or draining, and the runs in flight per agent
 * (`GET /api/fleet`), re-read every `everyMs` while `active`; null until the
 * first read lands. A failed read keeps the last state and says why in
 * `error`, which a page shows: no mark is drawn as if the read had answered.
 */
export function useFleet(active = true, everyMs = 8000) {
  const [state, setState] = useState<FleetState | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    getFleet()
      .then((s) => {
        setState(s);
        setError("");
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => {
    if (!active) return;
    const cancel = soon(load);
    const id = setInterval(load, everyMs);
    return () => {
      cancel();
      clearInterval(id);
    };
  }, [active, everyMs, load]);
  return { fleet: state, error, reload: load };
}

/** Every saved agent (`GET /api/agents`), read once while `active` and again on `reload`; null until the first read lands. */
export function useAgentList(active = true) {
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    listAgents()
      .then((rows) => {
        setAgents(rows);
        setError("");
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => {
    if (!active) return;
    return soon(load);
  }, [active, load]);
  return { agents, error, reload: load };
}

/** Runs in flight across the estate, from `GET /api/fleet` `live` (running or waiting at a gate); null until it is read. */
export function liveTotal(state: FleetState | null): number | null {
  return state ? Object.values(state.live).reduce((n, k) => n + k, 0) : null;
}

/**
 * The agents, to hold back and let go: every saved agent (`GET /api/agents`)
 * with its hold and its runs in flight (`GET /api/fleet` `paused` and
 * `live`), each with a tick box for the fleet bar. For the Control page
 * while its estate read (`GET /api/control`) is not drawn: the fleet
 * controls do not depend on that read, and nothing here is cut from it.
 */
export function FleetPanel({
  agents,
  agentsError,
  fleet: state,
  fleetError,
  selected,
  onSelect,
  onDone,
  onStop,
}: {
  agents: AgentSummary[] | null;
  agentsError: string;
  fleet: FleetState | null;
  fleetError: string;
  selected: Set<string>;
  onSelect: (next: Set<string>) => void;
  onDone: (r: FleetResult) => void;
  /** Opens the stop form for the ticked agents (their runs, or a pause, drain or resume). */
  onStop: () => void;
}) {
  const rows = agents ?? [];
  const name = (id: string) => rows.find((a) => a.id === id)?.name || id;
  const tick = (id: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(id);
    else next.delete(id);
    onSelect(next);
  };
  return (
    <section className="flex h-fit flex-col overflow-hidden rounded-md border border-line bg-surface">
      <div data-hue={hueFor("Estate")} className="flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b border-line bg-raise/55 px-3 py-1.5">
        <span className="text-[12px] font-semibold">Agents</span>
        <span className="truncate text-[11px] text-faint">{selected.size ? "pause, resume, drain or stop the runs of the agents ticked" : "tick rows for a fleet action"}</span>
        <span className="grow" />
        {selected.size > 0 && <FleetBar agents={[...selected]} names={name} onDone={onDone} onClear={() => onSelect(new Set())} onStop={onStop} />}
      </div>
      {agentsError && <Failure className="m-3" what="The agents could not be read" message={agentsError} />}
      {fleetError && <Failure className="m-3" what={state ? "The agent holds stopped answering" : "The agent holds could not be read"} message={fleetError} />}
      {agents === null && !agentsError && <p className="px-4 py-3 text-[12px] text-faint">Reading the agents…</p>}
      {agents && rows.length === 0 && <p className="px-4 py-3 text-[12px] text-faint">There are no saved agents.</p>}
      {rows.length > 0 && (
        <div className="max-h-[560px] overflow-auto">
          <div className="sticky top-0 z-10 grid grid-cols-[28px_minmax(170px,1fr)_150px_96px] items-center gap-3 border-b border-line bg-surface px-4 py-2">
            <Checkbox aria-label="Select every agent" checked={selected.size === rows.length} indeterminate={selected.size > 0 && selected.size < rows.length} onChange={(on) => onSelect(on ? new Set(rows.map((a) => a.id)) : new Set())} />
            {["Agent", "Hold", "In flight"].map((h) => (
              <span key={h} className="text-[11px] font-semibold text-dim">
                {h}
              </span>
            ))}
          </div>
          {rows.map((a) => {
            const hold = state?.paused[a.id];
            const live = state ? (state.live[a.id] ?? 0) : null;
            return (
              <div key={a.id} className={`grid grid-cols-[28px_minmax(170px,1fr)_150px_96px] items-start gap-3 border-b border-line px-4 py-2.5 last:border-b-0 ${selected.has(a.id) ? "bg-raise/40" : ""}`}>
                <span className="pt-0.5">
                  <Checkbox aria-label={`Select ${a.name || a.id}`} checked={selected.has(a.id)} onChange={(on) => tick(a.id, on)} />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[13px] font-semibold text-fg">{a.name || a.id}</span>
                  <Mono className="truncate text-[10px] text-faint">
                    {a.id}
                    {a.retired ? " · retired" : a.deployed_version ? ` · deployed v${a.deployed_version}` : " · saved, not deployed"}
                  </Mono>
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  {!state ? (
                    <span className="text-[11px] text-faint">{fleetError ? "not read" : "reading…"}</span>
                  ) : hold ? (
                    <>
                      <span className="self-start">
                        <Status tone="warn">{hold.mode === "drain" ? "Draining" : "Paused"}</Status>
                      </span>
                      <span className="text-[10.5px] leading-[1.45] text-dim">
                        {hold.reason}
                        {hold.by ? ` · ${hold.by}` : ""}
                        {hold.at && !Number.isNaN(Date.parse(hold.at)) ? ` · ${new Date(hold.at).toLocaleString()}` : ""}
                      </span>
                    </>
                  ) : (
                    <span className="text-[11.5px] text-faint">none</span>
                  )}
                </span>
                <span className={`tnum text-[12.5px] ${live ? "font-semibold text-run" : "text-faint"}`}>{live === null ? "—" : live}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ═══════════════════ lockdown ═══════════════════ */

export function useLockdown(active = true, everyMs = 8000) {
  const [state, setState] = useState<LockdownState | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    getLockdown()
      .then((s) => {
        setState(s);
        setError("");
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => {
    if (!active) return;
    const cancel = soon(load);
    const id = setInterval(load, everyMs);
    return () => {
      cancel();
      clearInterval(id);
    };
  }, [active, everyMs, load]);
  return { lockdown: state, error, reload: load, setState };
}

/** The switch in the header: on or off, each through the reason dialog, `POST /api/lockdown`. */
export function LockdownSwitch({
  state,
  onChanged,
  onNotice,
  onLockDown,
}: {
  state: LockdownState | null;
  onChanged: (s: LockdownState) => void;
  onNotice: (text: string) => void;
  /** Opens the stop form (components/stop-form.tsx) on the lockdown; when given, switching on goes there. Lifting keeps the reason dialog. */
  onLockDown?: () => void;
}) {
  const [ask, setAsk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const on = Boolean(state?.on);
  const fire = async (reason: string) => {
    if (ask === null) return;
    setBusy(true);
    try {
      const s = await setLockdown(ask, reason);
      onChanged(s);
      onNotice(`${ask ? "Lockdown on" : "Lockdown lifted"}${auditLine(s.audit_id)}`);
      setAsk(null);
    } catch (e) {
      onNotice(`Lockdown refused: ${(e as Error).message.slice(0, 140)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="flex items-center gap-2 rounded-md border border-line bg-surface px-2 py-1" title={on ? `Lockdown on · ${state?.reason ?? ""}` : state === null ? "The lockdown has not been read yet" : "Lockdown off"}>
      <Switch checked={on} onChange={(next) => (next && onLockDown ? onLockDown() : setAsk(next))} disabled={state === null} label={on ? "Lockdown on" : "Lockdown"} />
      {ask !== null && (
        <ReasonDialog
          title={ask ? "Lock the estate down?" : "Lift the lockdown?"}
          what={
            ask
              ? LOCKDOWN_HOLDS
              : `The lockdown was set${state?.by ? ` by ${state.by}` : ""}${state?.reason ? ` because: ${state.reason}` : ""}. Runs start again.`
          }
          confirm={ask ? "Lock down" : "Lift lockdown"}
          tone={ask ? "err" : "ink"}
          permission="configure"
          busy={busy}
          onConfirm={fire}
          onClose={() => !busy && setAsk(null)}
        />
      )}
    </span>
  );
}

/** The banner that stays while the lockdown is on. */
export function LockdownBanner({ state }: { state: LockdownState | null }) {
  if (!state?.on) return null;
  return (
    <div role="status" className="relative flex flex-wrap items-center gap-x-4 gap-y-1.5 overflow-hidden rounded-lg border border-line bg-surface px-4 py-3 pl-5 elev-1">
      <span className="absolute inset-y-0 left-0 w-[3px] bg-err" />
      <Status tone="err">Lockdown</Status>
      <span className="text-[13px] font-medium text-fg">The estate is locked down</span>
      <span className="min-w-0 text-[12.5px] leading-[1.5] text-dim">
        {state.reason ? `Reason: ${state.reason}.` : ""}
        {state.by ? ` Set by ${state.by}` : ""}
        {state.at ? ` at ${new Date(state.at).toLocaleString()}` : ""}
        {state.audit_id !== null ? ` · audit event #${state.audit_id}` : ""}
      </span>
    </div>
  );
}
