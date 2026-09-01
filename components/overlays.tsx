import type { ReactNode } from "react";
import { Avatar, Button, Kbd, Mono, Spinner, type Tone } from "./ui";

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
}: {
  title: string;
  detail?: string;
  tone?: Tone;
  loading?: boolean;
}) {
  return (
    <div className="flex w-full max-w-[380px] items-start gap-3 rounded-lg border border-line bg-surface p-3 elev-3">
      <span className={`mt-px shrink-0 ${ICON_TONE[tone]}`}>
        {loading ? <Spinner size={15} /> : <BannerGlyph tone={tone} />}
      </span>
      <div className="flex min-w-0 grow flex-col gap-0.5">
        <span className="text-[13px] font-medium">{title}</span>
        {detail && <span className="text-[12px] text-dim">{detail}</span>}
      </div>
      <button
        aria-label="Dismiss"
        className="focusable -m-1 shrink-0 cursor-pointer rounded-sm p-1 text-faint transition-colors hover:text-fg"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
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

/* ═══════════════════ Menu (static specimen) ═══════════════════ */

export function Menu() {
  return (
    <div className="w-[220px] rounded-lg border border-line bg-surface p-1 elev-3">
      {[
        { label: "Open canvas", kbd: "O" },
        { label: "Duplicate workflow", kbd: "D" },
        { label: "Run evals", kbd: "E" },
      ].map((i) => (
        <button
          key={i.label}
          className="focusable flex w-full cursor-pointer items-center justify-between rounded-sm px-2 py-1.5 text-[13px] text-mist transition-colors hover:bg-raise hover:text-fg"
        >
          {i.label}
          <Kbd>{i.kbd}</Kbd>
        </button>
      ))}
      <div className="my-1 h-px bg-line" />
      <button className="focusable flex w-full cursor-pointer items-center justify-between rounded-sm px-2 py-1.5 text-[13px] text-err transition-colors hover:bg-err-bg">
        Delete workflow
      </button>
    </div>
  );
}

/* ═══════════════════ Dialog (static specimen) ═══════════════════ */

export function Dialog() {
  return (
    <div className="w-full max-w-[420px] rounded-xl border border-line bg-surface elev-3">
      <div className="flex flex-col gap-1.5 p-5 pb-4">
        <h3 className="text-[16px] font-semibold tracking-tight">Deploy DLP Triage?</h3>
        <p className="text-[13px] leading-[1.55] text-dim">
          This publishes 7 harnesses to production. The eval suite passed at 96.4% on 84
          cases. Runs already in flight finish on the current version.
        </p>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
        <Button variant="quiet" size="sm">
          Cancel
        </Button>
        <Button tone="ink" variant="solid" size="sm">
          Deploy
        </Button>
      </div>
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

export function Pagination() {
  return (
    <div className="flex items-center justify-between gap-4">
      <Mono className="text-[11.5px] text-faint">1–4 of 214</Mono>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="outline">
          Previous
        </Button>
        {["1", "2", "3"].map((n, i) => (
          <button
            key={n}
            aria-current={i === 0 ? "page" : undefined}
            className={`focusable size-7 cursor-pointer rounded-sm text-[12px] transition-colors ${
              i === 0 ? "bg-ink font-medium text-on-ink" : "text-dim hover:bg-raise"
            }`}
          >
            {n}
          </button>
        ))}
        <Button size="sm" variant="outline">
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
