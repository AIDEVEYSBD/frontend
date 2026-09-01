import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";

/* ═══════════════════ Tone system ═══════════════════
   A tone names a meaning, not a colour. Every component that can carry
   meaning accepts the same six, so a reader learns the vocabulary once. */

export type Tone = "ink" | "run" | "ok" | "warn" | "err" | "queue" | "neutral";

const TEXT: Record<Tone, string> = {
  ink: "text-fg",
  run: "text-run",
  ok: "text-ok",
  warn: "text-warn",
  err: "text-err",
  queue: "text-queue",
  neutral: "text-dim",
};

const DOT: Record<Tone, string> = {
  ink: "bg-fg",
  run: "bg-run",
  ok: "bg-ok",
  warn: "bg-warn",
  err: "bg-err",
  queue: "bg-queue",
  neutral: "bg-faint",
};

/** Solid fills. Text is the theme's contrasting ground, never a tint. */
const SOLID: Record<Tone, string> = {
  ink: "bg-ink text-on-ink",
  run: "bg-run text-on-solid",
  ok: "bg-ok text-on-solid",
  warn: "bg-warn text-on-solid",
  err: "bg-err text-on-solid",
  queue: "bg-queue text-on-solid",
  neutral: "bg-raise text-fg",
};

const OUTLINE: Record<Tone, string> = {
  ink: "border-line-strong text-fg hover:bg-raise",
  run: "border-run-line text-run hover:bg-run-bg",
  ok: "border-ok-line text-ok hover:bg-ok-bg",
  warn: "border-warn-line text-warn hover:bg-warn-bg",
  err: "border-err-line text-err hover:bg-err-bg",
  queue: "border-queue-line text-queue hover:bg-queue-bg",
  neutral: "border-line text-dim hover:bg-raise hover:text-fg",
};

/* ═══════════════════ Run states ═══════════════════
   One shared vocabulary for a run's condition — every page that shows a run
   uses these tones and words, so "suspended" reads the same everywhere. */

export const RUN_STATE: Record<string, { tone: Tone; label: string }> = {
  done: { tone: "ok", label: "Complete" },
  failed: { tone: "err", label: "Failed" },
  suspended: { tone: "warn", label: "Awaiting approval" },
  killed: { tone: "err", label: "Killed by operator" },
  running: { tone: "run", label: "Running" },
};

/* ═══════════════════ Surfaces ═══════════════════ */

export function Panel({
  children,
  className = "",
  elevation = 1,
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  elevation?: 0 | 1 | 2 | 3;
  interactive?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border border-line bg-surface ${elevation ? `elev-${elevation}` : ""} ${
        interactive
          ? "transition-[border-color,box-shadow,transform] duration-200 ease-[var(--ease-out)] hover:-translate-y-px hover:border-line-strong hover:shadow-[var(--shadow-2)]"
          : ""
      } ${className}`}
    >
      {children}
    </div>
  );
}

/* ═══════════════════ Button ═══════════════════ */

const SIZES = {
  sm: "h-7 gap-1.5 px-2.5 text-[12px] rounded-sm",
  md: "h-9 gap-2 px-3.5 text-[13px] rounded-md",
  lg: "h-11 gap-2 px-5 text-[14px] rounded-md",
};

export function Button({
  children,
  tone = "neutral",
  variant = "outline",
  size = "md",
  disabled = false,
  loading = false,
  full = false,
  className = "",
  onClick,
  type = "button",
  href,
}: {
  children: ReactNode;
  tone?: Tone;
  variant?: "solid" | "outline" | "quiet";
  size?: keyof typeof SIZES;
  disabled?: boolean;
  loading?: boolean;
  full?: boolean;
  className?: string;
  onClick?: () => void;
  type?: "button" | "submit";
  /** Renders as a link with button looks — never a button nested in an anchor. */
  href?: string;
}) {
  const look =
    variant === "solid"
      ? `${SOLID[tone]} border border-transparent hover:brightness-[1.08] active:brightness-95`
      : variant === "outline"
        ? `border bg-transparent ${OUTLINE[tone]} active:brightness-95`
        : `border border-transparent bg-transparent ${TEXT[tone]} hover:bg-raise`;

  if (href) {
    return (
      <Link
        href={href}
        className={`focusable inline-flex cursor-pointer items-center justify-center font-medium whitespace-nowrap transition-[background-color,border-color,filter,opacity] duration-100 ease-[var(--ease-out)] select-none ${SIZES[size]} ${look} ${full ? "w-full" : ""} ${className}`}
      >
        {children}
      </Link>
    );
  }

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`focusable inline-flex cursor-pointer items-center justify-center font-medium whitespace-nowrap transition-[background-color,border-color,filter,opacity] duration-100 ease-[var(--ease-out)] select-none disabled:pointer-events-none disabled:opacity-40 ${SIZES[size]} ${look} ${full ? "w-full" : ""} ${className}`}
    >
      {loading && <Spinner size={size === "sm" ? 11 : 13} />}
      {children}
    </button>
  );
}

export function IconButton({
  children,
  label,
  tone = "neutral",
  size = "md",
  className = "",
  onClick,
}: {
  children: ReactNode;
  label: string;
  tone?: Tone;
  size?: "sm" | "md";
  className?: string;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`focusable inline-grid cursor-pointer place-items-center rounded-md border border-transparent transition-colors duration-100 hover:bg-raise ${TEXT[tone]} ${
        size === "sm" ? "size-7" : "size-9"
      } ${className}`}
    >
      {children}
    </button>
  );
}

/* ═══════════════════ Status & tags ═══════════════════ */

export function Status({
  children,
  tone = "neutral",
  dot = true,
  chip = false,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  chip?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-medium whitespace-nowrap ${TEXT[tone]} ${
        chip ? "rounded-sm border border-line bg-raise px-1.5 py-0.5" : ""
      }`}
    >
      {dot && <span className={`size-1.5 shrink-0 rounded-[2px] ${DOT[tone]}`} />}
      {children}
    </span>
  );
}

export function Tag({
  children,
  tone = "neutral",
  solid = false,
}: {
  children: ReactNode;
  tone?: Tone;
  solid?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-sm px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ${
        solid ? SOLID[tone] : `border border-line bg-raise ${TEXT[tone]}`
      }`}
    >
      {children}
    </span>
  );
}

/* ═══════════════════ Identity ═══════════════════ */

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <span
      className="inline-grid shrink-0 place-items-center rounded-sm border border-line bg-raise font-medium text-dim"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      title={name}
    >
      {initials}
    </span>
  );
}

/* ═══════════════════ Text bits ═══════════════════ */

export function Label({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-medium text-faint">{children}</span>;
}

export function Mono({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <code className={`tnum font-mono text-[12px] text-dim ${className}`}>{children}</code>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-grid h-5 min-w-5 place-items-center rounded-xs border border-line bg-raise px-1 font-sans text-[10.5px] font-medium text-dim shadow-[var(--shadow-1)]">
      {children}
    </kbd>
  );
}

/* ═══════════════════ Data ═══════════════════ */

export function Meter({ value, tone = "run" }: { value: number; tone?: Tone }) {
  return (
    <span
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="block h-1 w-full overflow-hidden rounded-[2px] bg-sunken"
    >
      <span
        className={`block h-full rounded-[2px] transition-[width] duration-500 ease-[var(--ease-out)] ${DOT[tone]}`}
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
      />
    </span>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="af-spin shrink-0" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path
        d="M12 3a9 9 0 0 1 9 9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
