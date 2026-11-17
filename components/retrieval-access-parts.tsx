"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Status, type Tone } from "./ui";
import { Field, Textarea } from "./forms";
import type { Permission } from "@/lib/permissions";
import { RETRIEVAL_RIGHTS, type Owner, type RetrievalAccess, type RetrievalEvent, type RetrievalGrant, type RetrievalRight, type RetrievalStore } from "@/lib/api/pending";

/**
 * What the retrieval access page and its dialogs share: how a right, a
 * store and a change are worded, what an agent still holds, and the dialog
 * every change goes through (it says what stops and takes the reason).
 * Nothing here holds a record.
 */

/* ═══════════════════ words ═══════════════════ */

const RIGHT_PHRASE: Record<RetrievalRight, string> = { read: "read from", write: "write to", delete: "delete in" };

/** `a`, `a or b`, `a, b or c`. */
export function listOf(words: string[], last: "or" | "and" = "or"): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} ${last} ${words[words.length - 1]}`;
}

/** Rights in the page's order, whatever order they were sent in; a right the page does not know is left out. */
export const inOrder = (rights: readonly string[] | undefined): RetrievalRight[] => RETRIEVAL_RIGHTS.filter((r) => (rights ?? []).includes(r));

/** `read from, write to or delete in`, ready to take the store's name after it. */
export const rightsPhrase = (rights: RetrievalRight[], last: "or" | "and" = "or"): string => listOf(inOrder(rights).map((r) => RIGHT_PHRASE[r]), last);

/** What of its definition a grant still holds, and what of it is revoked. */
export const heldOf = (g: RetrievalGrant): RetrievalRight[] => inOrder(g.rights).filter((r) => !(g.revoked ?? []).includes(r));
export const revokedOf = (g: RetrievalGrant): RetrievalRight[] => inOrder(g.rights).filter((r) => (g.revoked ?? []).includes(r));

export const agentName = (g: Pick<RetrievalGrant, "agent" | "agent_name">): string => g.agent_name || g.agent;
export const ownerName = (o: Owner | undefined): string => (o ? o.name || o.email || o.sub : "");

/** The stores by id, and the name each agent goes by, as the door's answer gives them. */
export function namesOf(data: RetrievalAccess): { store: (id: string | undefined) => string; agent: (id: string | undefined) => string; storeById: Map<string, RetrievalStore> } {
  const storeById = new Map(data.stores.map((s) => [s.id, s]));
  const agents = new Map<string, string>();
  for (const g of data.grants) if (g.agent_name && !agents.has(g.agent)) agents.set(g.agent, g.agent_name);
  return {
    storeById,
    store: (id) => (id ? storeById.get(id)?.name || id : ""),
    agent: (id) => (id ? agents.get(id) || id : ""),
  };
}

/** What a change in the history was, in the page's words. */
export const EVENT_WORD: Record<RetrievalEvent["action"], { label: string; tone: Tone }> = {
  revoked: { label: "Revoked", tone: "err" },
  restored: { label: "Restored", tone: "ok" },
  disabled: { label: "Retrieval switched off", tone: "err" },
  enabled: { label: "Retrieval switched back on", tone: "ok" },
};

/* ═══════════════════ one right in one store ═══════════════════ */

/** A right as the list shows it: granted by the agent's definition, revoked now, or never granted. */
export function RightCell({ grant, right }: { grant: RetrievalGrant; right: RetrievalRight }) {
  if (!(grant.rights ?? []).includes(right)) return <span className="text-[11px] text-ghost">not granted</span>;
  if ((grant.revoked ?? []).includes(right)) return <Status tone="err">Revoked</Status>;
  return <Status tone="ok">Granted</Status>;
}

/** The names a confirm dialog lists: a store or an agent, and what it holds there. */
export function Affected({ rows }: { rows: { key: string; name: string; detail: string }[] }) {
  return (
    <span className="flex max-h-[168px] flex-col gap-1 overflow-y-auto rounded-sm border border-line bg-canvas px-2 py-1.5">
      {rows.map((r) => (
        <span key={r.key} className="flex flex-wrap items-baseline gap-x-2 text-[11.5px] leading-[1.5]">
          <span className="font-medium text-fg">{r.name}</span>
          <span className="text-faint">{r.detail}</span>
        </span>
      ))}
    </span>
  );
}

/* ═══════════════════ the dialog a change goes through ═══════════════════ */

/**
 * A change that is recorded with its reason. The dialog says what is about
 * to happen (`children`: the consequence, and any choice the change takes),
 * asks why, and fires on confirm. Nothing is sent until a reason is typed
 * and the choice above it is complete (`ready`). Escape and the backdrop
 * cancel; Cancel is solid red, as every cancel is.
 */
export function ReasonDialog({
  title,
  children,
  confirm,
  tone = "err",
  permission,
  busy = false,
  ready = true,
  onBlocked,
  hint = "Recorded in the history with your name.",
  missing = "A reason is needed. It is recorded in the history with your name.",
  placeholder,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirm: string;
  /** Tone of the confirming action: err for anything that takes something away. */
  tone?: Tone;
  permission?: Permission;
  busy?: boolean;
  /** Whether the choice above the reason is complete. */
  ready?: boolean;
  /** Confirm was pressed while the choice was not complete: the caller shows what is missing. */
  onBlocked?: () => void;
  hint?: string;
  /** Said when confirm is pressed with no reason typed. */
  missing?: string;
  placeholder?: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [noReason, setNoReason] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  // The page re-renders on its own clock; the handlers are read through refs so focus is taken once, on open.
  const close = useRef(onClose);
  const locked = useRef(busy);
  useEffect(() => {
    close.current = onClose;
    locked.current = busy;
  }, [onClose, busy]);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("input:not([disabled]), textarea")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (!locked.current) close.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, []);

  const fire = () => {
    const text = reason.trim();
    if (!text) setNoReason(true);
    if (!ready) onBlocked?.();
    if (!text || !ready) return;
    onConfirm(text);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-canvas/70 p-4" onClick={busy ? undefined : onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="af-reason-dialog-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-[480px] flex-col rounded-xl border border-line bg-surface elev-3 af-pop"
      >
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto p-5 pb-4">
          <h3 id="af-reason-dialog-title" className="text-[16px] font-semibold tracking-tight break-words">
            {title}
          </h3>
          <div className="flex flex-col gap-2.5 text-[13px] leading-[1.55] text-dim">{children}</div>
          <Field label="Reason" error={noReason ? missing : undefined} hint={noReason ? undefined : hint}>
            <Textarea
              rows={2}
              value={reason}
              onChange={(v) => {
                setReason(v);
                setNoReason(false);
              }}
              placeholder={placeholder}
              disabled={busy}
            />
          </Field>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-5 py-3">
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
