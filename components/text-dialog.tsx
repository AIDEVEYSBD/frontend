"use client";

import { useEffect, useRef, useState } from "react";
import { Button, type Tone } from "./ui";
import { Field, Textarea } from "./forms";
import type { Permission } from "@/lib/permissions";

/**
 * A lever a person pulls with a sentence: pause an agent with the reason
 * the fleet door records, steer a run with guidance the run reads at its
 * next model call. The backend proposed the text (the drift item's reason,
 * the guardian's guidance); it is still the person's to change, and nothing
 * is sent until it is there. Escape and the backdrop cancel; Cancel is
 * solid red, as every cancel is.
 */
export function TextDialog({
  title,
  what,
  label,
  hint,
  missing: missingText,
  initial = "",
  confirm,
  tone = "ink",
  permission,
  busy = false,
  onConfirm,
  onClose,
}: {
  title: string;
  /** What is about to happen, in a line or two. */
  what: string;
  label: string;
  hint: string;
  /** Said when confirm is pressed with nothing typed. */
  missing: string;
  initial?: string;
  confirm: string;
  tone?: Tone;
  permission?: Permission;
  busy?: boolean;
  onConfirm: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);
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
    const t = text.trim();
    if (!t) {
      setMissing(true);
      return;
    }
    onConfirm(t);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-canvas/70 p-4" onClick={busy ? undefined : onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="af-text-dialog-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[480px] rounded-xl border border-line bg-surface elev-3 af-pop"
      >
        <div className="flex flex-col gap-3 p-5 pb-4">
          <div className="flex flex-col gap-1.5">
            <h3 id="af-text-dialog-title" className="text-[16px] font-semibold tracking-tight">
              {title}
            </h3>
            <p className="text-[13px] leading-[1.55] text-dim">{what}</p>
          </div>
          <Field label={label} error={missing ? missingText : undefined} hint={missing ? undefined : hint}>
            <Textarea
              rows={3}
              value={text}
              onChange={(v) => {
                setText(v);
                setMissing(false);
              }}
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
