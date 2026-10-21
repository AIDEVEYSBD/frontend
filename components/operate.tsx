"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Status } from "./ui";
import { Field, Switch, Textarea } from "./forms";
import { fleet, FLEET_ACTIONS, getLockdown, setLockdown, type FleetAction, type FleetResult, type LockdownState } from "@/lib/api/l5";
import { soon } from "@/lib/soon";

/**
 * Operating the estate: fleet actions on chosen agents, and the lockdown.
 *
 * Both are operator decisions the backend journals as one audit event with
 * a reason and who, so each is a dialog that names what it is about to do
 * and takes the reason before anything is sent (the shape of
 * components/kill-dialog.tsx). Fleet needs the run permission, lockdown
 * configure; the buttons say so when the person lacks it.
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
export function FleetBar({ agents, names, onDone, onClear }: { agents: string[]; names: (id: string) => string; onDone: (r: FleetResult) => void; onClear: () => void }) {
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
        <Button key={a.id} size="sm" variant="solid" tone={a.tone} permission="run" onClick={() => setAsk(a.id)} disabled={agents.length === 0}>
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
export function LockdownSwitch({ state, onChanged, onNotice }: { state: LockdownState | null; onChanged: (s: LockdownState) => void; onNotice: (text: string) => void }) {
  const [ask, setAsk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const on = Boolean(state?.on);
  const fire = async (reason: string) => {
    if (ask === null) return;
    setBusy(true);
    try {
      const s = await setLockdown(ask, reason);
      onChanged(s);
      onNotice(ask ? "Lockdown on: gates read-only, queue paused, sinks held" : "Lockdown lifted");
      setAsk(null);
    } catch (e) {
      onNotice(`Lockdown refused: ${(e as Error).message.slice(0, 140)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="flex items-center gap-2 rounded-md border border-line bg-surface px-2 py-1" title={on ? `Lockdown on · ${state?.reason ?? ""}` : "Lockdown off"}>
      <Switch checked={on} onChange={(next) => setAsk(next)} disabled={state === null} label={on ? "Lockdown on" : "Lockdown"} />
      {ask !== null && (
        <ReasonDialog
          title={ask ? "Lock the estate down?" : "Lift the lockdown?"}
          what={
            ask
              ? "Every gate threshold becomes read-only for new and resumed runs, the trigger queue pauses, and every sink is held until this is lifted. One audit event names the controls."
              : `Gates, the queue and the sinks return to their specs. The lockdown was set${state?.by ? ` by ${state.by}` : ""}${state?.reason ? ` because: ${state.reason}` : ""}.`
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
        Every call above read gates, the queue is paused and every sink is held.
        {state.reason ? ` Reason: ${state.reason}.` : ""}
        {state.by ? ` Set by ${state.by}` : ""}
        {state.at ? ` at ${new Date(state.at).toLocaleString()}` : ""}
        {state.controls.length ? ` · controls: ${state.controls.join(", ")}` : ""}
      </span>
    </div>
  );
}
