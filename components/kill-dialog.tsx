"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./ui";
import { Field, Textarea } from "./forms";

/**
 * The kill switch asks why.
 *
 * A kill is an operator decision the runtime journals with its reason and
 * who threw it (`data.control = "kill"`), and the backend refuses one with
 * no reason. So the switch is a small dialog, not a bare button: it names
 * what it is about to stop, takes the reason, and fires on confirm. Escape
 * and the backdrop cancel; nothing is sent until the reason is typed.
 */
export function KillDialog({
  title,
  what,
  confirm = "Kill run",
  busy = false,
  initialReason = "",
  onConfirm,
  onClose,
}: {
  title: string;
  /** What is about to stop, in one line. */
  what: string;
  confirm?: string;
  busy?: boolean;
  /** A reason to start from (the guardian's, when a person takes up a kill it could not make); still the person's to change. */
  initialReason?: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState(initialReason);
  const [missing, setMissing] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  // The parent re-renders on its own clock (the Control page every 4 s); the
  // close handler is read through a ref so focus is taken once, on open,
  // and given back once, on close — not on every tick.
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
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="af-kill-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] rounded-xl border border-line bg-surface elev-3 af-pop"
      >
        <div className="flex flex-col gap-3 p-5 pb-4">
          <div className="flex flex-col gap-1.5">
            <h3 id="af-kill-title" className="text-[16px] font-semibold tracking-tight">
              {title}
            </h3>
            <p className="text-[13px] leading-[1.55] text-dim">{what}</p>
          </div>
          <Field
            label="Reason"
            error={missing ? "A kill needs a reason; it goes into the run's journal with your name." : undefined}
            hint={missing ? undefined : "Written into the journal with your name, on the kill entry."}
          >
            <Textarea
              rows={2}
              value={reason}
              onChange={(v) => {
                setReason(v);
                setMissing(false);
              }}
              placeholder="Why this run is being stopped."
              disabled={busy}
            />
          </Field>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <Button variant="solid" tone="err" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="solid" tone="err" size="sm" permission="run" onClick={fire} loading={busy}>
            {confirm}
          </Button>
        </div>
      </div>
    </div>
  );
}
