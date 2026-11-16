"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Status } from "./ui";
import { Field, Switch, Textarea } from "./forms";
import { auditLine, fleet, FLEET_ACTIONS, getFleet, getLockdown, setLockdown, type FleetAction, type FleetResult, type FleetState, type LockdownState } from "@/lib/api/l5";
import { soon } from "@/lib/soon";

/**
 * Operating the estate: fleet actions on chosen agents, and the lockdown.
 *
 * Both are operator decisions the backend journals as one audit event with
 * a reason and who, so each is a dialog that names what it is about to do
 * and takes the reason before anything is sent (the shape of
 * components/kill-dialog.tsx). The two that stop work, killing the ticked
 * agents' runs and switching the lockdown on, go to the one stop form
 * (components/stop-form.tsx) when the page gives a way to open it; pause,
 * resume, drain and lifting the lockdown keep the reason dialog here. Fleet
 * needs the run permission, lockdown configure; the buttons say so when the
 * person lacks it. Which agents stand paused or draining is the backend's
 * to say (`GET /api/fleet`).
 */

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
          <Field label="Reason" error={missing ? "This needs a reason; it goes into the audit event with your name." : undefined} hint={missing ? undefined : "Written into the audit event with your name."}>
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
          what={`${list}. ${action.label} ${action.what}. One audit event records the action, the reason and your name.${error ? ` Last attempt: ${error}` : ""}`}
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

/** Which agents are paused or draining (`GET /api/fleet`), re-read every `everyMs` while `active`; null until the first read lands. */
export function useFleet(active = true, everyMs = 8000) {
  const [state, setState] = useState<FleetState | null>(null);
  const load = useCallback(() => {
    getFleet()
      .then(setState)
      .catch(() => {});
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
  return { fleet: state, reload: load };
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
      onNotice(`${ask ? "Lockdown on: nothing new starts or is claimed until it is lifted" : "Lockdown lifted"}${auditLine(s.audit_id)}`);
      setAsk(null);
    } catch (e) {
      onNotice(`Lockdown refused: ${(e as Error).message.slice(0, 140)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="flex items-center gap-2 rounded-md border border-line bg-surface px-2 py-1" title={on ? `Lockdown on · ${state?.reason ?? ""}` : "Lockdown off"}>
      <Switch checked={on} onChange={(next) => (next && onLockDown ? onLockDown() : setAsk(next))} disabled={state === null} label={on ? "Lockdown on" : "Lockdown"} />
      {ask !== null && (
        <ReasonDialog
          title={ask ? "Lock the estate down?" : "Lift the lockdown?"}
          what={
            ask
              ? "Until this is lifted, no worker claims queued work and no run starts (a start is refused). The trigger, webhook and cron doors keep accepting work, which waits on the queue. A run resumed meanwhile waits for a person at every tool call above read and every sink. Runs already in flight finish as they started, so the queue drains. One audit event names the controls."
              : `Workers claim the queue again, runs start, and gates and sinks return to their specs. The lockdown was set${state?.by ? ` by ${state.by}` : ""}${state?.reason ? ` because: ${state.reason}` : ""}.`
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
        Nothing new starts or is claimed; work is still accepted and waits on the queue, and a resumed run waits for a person above read and at every sink.
        {state.reason ? ` Reason: ${state.reason}.` : ""}
        {state.by ? ` Set by ${state.by}` : ""}
        {state.at ? ` at ${new Date(state.at).toLocaleString()}` : ""}
        {state.audit_id !== null ? ` · audit event #${state.audit_id}` : ""}
      </span>
      {state.controls.length > 0 && (
        <ul className="flex w-full flex-col gap-0.5 text-[11.5px] leading-[1.5] text-faint">
          {state.controls.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
