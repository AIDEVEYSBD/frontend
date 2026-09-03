"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Avatar, Button, IconButton, Kbd, Mono, Spinner, type Tone } from "./ui";
import { useDismiss } from "./dismiss";

/* ═══════════════════ Banner ═══════════════════
   Inline, in the flow. A solid tonal rule on the leading edge carries the
   meaning; the surface behind the text stays legible rather than tinted. */

const RULE: Record<string, string> = {
  run: "bg-run",
  ok: "bg-ok",
  warn: "bg-warn",
  err: "bg-err",
  queue: "bg-queue",
  neutral: "bg-faint",
};

const ICON_TONE: Record<string, string> = {
  run: "text-run",
  ok: "text-ok",
  warn: "text-warn",
  err: "text-err",
  queue: "text-queue",
  neutral: "text-dim",
};

export function Banner({
  tone = "neutral",
  title,
  children,
  action,
}: {
  tone?: Tone;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="relative flex gap-3 overflow-hidden rounded-lg border border-line bg-surface p-3.5 pl-4 elev-1">
      <span className={`absolute inset-y-0 left-0 w-[3px] ${RULE[tone]}`} />
      <span className={`mt-px shrink-0 ${ICON_TONE[tone]}`}>
        <BannerGlyph tone={tone} />
      </span>
      <div className="flex min-w-0 grow flex-col gap-1">
        <span className="text-[13px] font-medium text-fg">{title}</span>
        {children && (
          <span className="text-[12.5px] leading-[1.55] text-dim">{children}</span>
        )}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

function BannerGlyph({ tone }: { tone: string }) {
  const common = {
    width: 15,
    height: 15,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (tone === "ok")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M8 12.5l2.5 2.5L16 9.5" />
      </svg>
    );
  if (tone === "err" || tone === "warn")
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5v5.5" />
        <path d="M12 16.5v.01" />
      </svg>
    );
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <path d="M12 7.5v.01" />
    </svg>
  );
}

/* ═══════════════════ Toast ═══════════════════ */

export function Toast({
  title,
  detail,
  tone = "neutral",
  loading = false,
  onDismiss,
  duration = 6000,
}: {
  title: string;
  detail?: string;
  tone?: Tone;
  loading?: boolean;
  onDismiss?: () => void;
  /** Toasts expire. Milliseconds until `onDismiss` fires on its own; 0 keeps it. A loading toast never expires. */
  duration?: number;
}) {
  useEffect(() => {
    if (!onDismiss || loading || duration <= 0) return;
    const t = setTimeout(onDismiss, duration);
    return () => clearTimeout(t);
  }, [onDismiss, loading, duration]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex w-full max-w-[380px] items-start gap-3 rounded-lg border border-line bg-surface p-3 elev-3 af-pop"
    >
      <span className={`mt-px shrink-0 ${ICON_TONE[tone]}`}>
        {loading ? <Spinner size={15} /> : <BannerGlyph tone={tone} />}
      </span>
      <div className="flex min-w-0 grow flex-col gap-0.5">
        <span className="text-[13px] font-medium">{title}</span>
        {detail && <span className="text-[12px] text-dim">{detail}</span>}
      </div>
      <IconButton size="sm" label="Dismiss" className="-my-1 -mr-1 shrink-0" onClick={onDismiss}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </IconButton>
    </div>
  );
}

/* ═══════════════════ Tooltip (static specimen) ═══════════════════ */

export function Tooltip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex rounded-sm bg-ink px-2 py-1 text-[11.5px] font-medium text-on-ink elev-2">
      {children}
    </span>
  );
}

/* ═══════════════════ Menu ═══════════════════
   Floats at elev-3 with a hairline, dismisses on Escape and on a click
   outside whenever `onClose` is supplied. The destructive item sits last,
   after a rule, and its hover is the neutral raise step: hue is in the text. */

export interface MenuItem {
  label: string;
  kbd?: string;
  onSelect?: () => void;
  disabled?: boolean;
}

const DEFAULT_ITEMS: MenuItem[] = [
  { label: "Open canvas", kbd: "O" },
  { label: "Duplicate workflow", kbd: "D" },
  { label: "Run evals", kbd: "E" },
];

export function Menu({
  items = DEFAULT_ITEMS,
  destructive = { label: "Delete workflow" },
  onClose,
  className = "",
}: {
  items?: MenuItem[];
  destructive?: MenuItem | null;
  onClose?: () => void;
  className?: string;
}) {
  const ref = useDismiss<HTMLDivElement>(!!onClose, onClose ?? (() => {}));
  const row =
    "focusable flex w-full cursor-pointer items-center justify-between rounded-sm px-2 py-1.5 text-[13px] transition-colors duration-100 hover:bg-raise active:bg-sunken disabled:pointer-events-none disabled:opacity-40";
  return (
    <div ref={ref} role="menu" className={`w-[220px] rounded-lg border border-line bg-surface p-1 elev-3 ${className}`}>
      {items.map((i) => (
        <button
          key={i.label}
          type="button"
          role="menuitem"
          disabled={i.disabled}
          onClick={() => {
            i.onSelect?.();
            onClose?.();
          }}
          className={`${row} text-mist hover:text-fg`}
        >
          {i.label}
          {i.kbd && <Kbd>{i.kbd}</Kbd>}
        </button>
      ))}
      {destructive && (
        <>
          <div className="my-1 h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            disabled={destructive.disabled}
            onClick={() => {
              destructive.onSelect?.();
              onClose?.();
            }}
            className={`${row} text-err`}
          >
            {destructive.label}
            {destructive.kbd && <Kbd>{destructive.kbd}</Kbd>}
          </button>
        </>
      )}
    </div>
  );
}

/* ═══════════════════ Dialog ═══════════════════
   States the consequence before it asks. Escape and a click on the scrim
   close it; focus lands on the primary action and stays inside while open.
   Rendered inline (the design page specimen) or modal, over a scrim. */

export function Dialog({
  title = "Deploy DLP Triage?",
  children = "This publishes 7 harnesses to production. The eval suite passed at 96.4% on 84 cases. Runs already in flight finish on the current version.",
  confirm = "Deploy",
  cancel = "Cancel",
  tone = "ink",
  onConfirm,
  onClose,
  loading = false,
  modal = false,
}: {
  title?: string;
  children?: ReactNode;
  confirm?: string;
  cancel?: string;
  /** Tone of the confirming action; err for anything that destroys. */
  tone?: Tone;
  onConfirm?: () => void;
  onClose?: () => void;
  loading?: boolean;
  modal?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const live = !!onClose;
  useDismiss<HTMLDivElement>(live && modal, onClose ?? (() => {}), panel);

  // Focus the primary action on open, restore on close, and keep Tab inside.
  useEffect(() => {
    if (!live) return;
    const before = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input, textarea, [tabindex]:not([tabindex="-1"])') ?? [],
      );
    const primary = panel.current?.querySelector<HTMLElement>("[data-dialog-primary]");
    (primary ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !modal) {
        e.preventDefault();
        onClose?.();
        return;
      }
      if (e.key !== "Tab") return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, [live, modal, onClose]);

  const body = (
    <div
      ref={panel}
      role="dialog"
      aria-modal={modal || undefined}
      aria-labelledby="af-dialog-title"
      className={`w-full max-w-[420px] rounded-xl border border-line bg-surface elev-3 ${modal ? "af-pop" : ""}`}
    >
      <div className="flex flex-col gap-1.5 p-5 pb-4">
        <h3 id="af-dialog-title" className="text-[16px] font-semibold tracking-tight">
          {title}
        </h3>
        <p className="text-[13px] leading-[1.55] text-dim">{children}</p>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
        <Button variant="solid" tone="err" size="sm" onClick={onClose} disabled={loading}>
          {cancel}
        </Button>
        <span data-dialog-primary className="contents">
          <Button tone={tone} variant="solid" size="sm" onClick={onConfirm} loading={loading}>
            {confirm}
          </Button>
        </span>
      </div>
    </div>
  );

  if (!modal) return body;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-canvas/70 p-4">
      {body}
    </div>
  );
}

/* ═══════════════════ Empty state ═══════════════════ */

export function EmptyState({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line-strong px-6 py-12 text-center">
      <span className="text-faint">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 9h18M9 20V9" />
        </svg>
      </span>
      <div className="flex flex-col gap-1">
        <span className="text-[14px] font-medium">{title}</span>
        <span className="max-w-[42ch] text-[12.5px] leading-[1.55] text-dim">{detail}</span>
      </div>
      {action}
    </div>
  );
}

/* ═══════════════════ Navigation bits ═══════════════════ */

export function Breadcrumb({ path }: { path: string[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-[12.5px]">
      {path.map((p, i) => (
        <span key={p} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-ghost">/</span>}
          <span className={i === path.length - 1 ? "font-medium text-fg" : "text-faint"}>
            {p}
          </span>
        </span>
      ))}
    </nav>
  );
}

export function Pagination({
  page = 1,
  pages = 54,
  pageSize = 4,
  total = 214,
  onPage,
}: {
  page?: number;
  pages?: number;
  pageSize?: number;
  total?: number;
  onPage?: (p: number) => void;
}) {
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const start = Math.max(1, Math.min(page - 1, pages - 2));
  const shown = Array.from({ length: Math.min(3, pages) }, (_, i) => start + i);
  return (
    <div className="flex items-center justify-between gap-4">
      <Mono className="text-[11.5px] text-faint">
        {from}–{to} of {total}
      </Mono>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage?.(page - 1)}>
          Previous
        </Button>
        {shown.map((n) => (
          <button
            key={n}
            type="button"
            aria-current={n === page ? "page" : undefined}
            onClick={() => onPage?.(n)}
            className={`focusable size-7 cursor-pointer rounded-sm text-[12px] transition-colors duration-100 ${
              n === page ? "bg-ink font-medium text-on-ink" : "bg-raise text-fg hover:brightness-[1.08]"
            }`}
          >
            {n}
          </button>
        ))}
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => onPage?.(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

/* ═══════════════════ Assignee row ═══════════════════ */

export function ReviewerRow() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-surface p-3">
      <Avatar name="Sana Rahman" />
      <div className="flex min-w-0 grow flex-col">
        <span className="truncate text-[13px] font-medium">Sana Rahman</span>
        <span className="truncate text-[11.5px] text-faint">Engagement partner · approval gate</span>
      </div>
      <Button size="sm" tone="ok" variant="solid">
        Approve
      </Button>
    </div>
  );
}
