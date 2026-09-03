import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";

/* ═══════════════════ Tone system ═══════════════════
   A tone names a meaning, not a colour. Every component that can carry
   meaning accepts the same six, so a reader learns the vocabulary once. */

/**
 * `media` is the one tone that does not follow the theme: it sits on a
 * photograph under a fixed dark scrim, so it is the light canvas and ink in
 * both modes. The Photography section of the design page carves this out.
 */
export type Tone = "ink" | "run" | "ok" | "warn" | "err" | "queue" | "neutral" | "media";

const TEXT: Record<Tone, string> = {
  ink: "text-fg",
  run: "text-run",
  ok: "text-ok",
  warn: "text-warn",
  err: "text-err",
  queue: "text-queue",
  neutral: "text-dim",
  media: "text-[#fbfaf9]",
};

const DOT: Record<Tone, string> = {
  ink: "bg-fg",
  run: "bg-run",
  ok: "bg-ok",
  warn: "bg-warn",
  err: "bg-err",
  queue: "bg-queue",
  neutral: "bg-faint",
  media: "bg-[#fbfaf9]",
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
  media: "bg-[#fbfaf9] text-[#1a1917]",
};

/** Secondary: a filled surface with a hairline. Never transparent, and the
 *  hover is a neutral step, never a tone tint. */
const OUTLINE: Record<Tone, string> = {
  ink: "border-line-strong text-fg",
  run: "border-run-line text-run",
  ok: "border-ok-line text-ok",
  warn: "border-warn-line text-warn",
  err: "border-err-line text-err",
  queue: "border-queue-line text-queue",
  neutral: "border-line text-fg",
  media: "border-[#fbfaf9]/70 text-[#fbfaf9]",
};

/** Tertiary: filled on the raise step, text at full contrast for the mode. */
const QUIET: Record<Tone, string> = {
  ink: "text-fg",
  run: "text-run",
  ok: "text-ok",
  warn: "text-warn",
  err: "text-err",
  queue: "text-queue",
  neutral: "text-fg",
  media: "text-[#fbfaf9]",
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
  // Every variant is a solid fill: buttons are never transparent, and the
  // text always contrasts the mode.
  const look =
    variant === "solid"
      ? `${SOLID[tone]} border border-transparent hover:brightness-[1.08] active:brightness-95`
      : variant === "outline"
        ? `border bg-surface ${OUTLINE[tone]} hover:bg-raise active:brightness-95`
        : `border border-transparent bg-raise ${QUIET[tone]} hover:brightness-[1.08] active:brightness-95`;
  const base = `focusable inline-flex cursor-pointer items-center justify-center font-medium whitespace-nowrap transition-[background-color,border-color,filter,opacity] duration-100 ease-[var(--ease-out)] select-none ${SIZES[size]} ${look} ${full ? "w-full" : ""} ${className}`;

  if (href) {
    // A link with button looks. Disabled or loading, it stops being a link
    // so the six states hold here too.
    if (disabled || loading) {
      return (
        <span aria-disabled="true" aria-busy={loading || undefined} className={`${base} pointer-events-none opacity-40`}>
          {loading && <Spinner size={size === "sm" ? 11 : 13} />}
          {children}
        </span>
      );
    }
    return (
      <Link href={href} className={base}>
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
      className={`${base} disabled:pointer-events-none disabled:opacity-40`}
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
  disabled = false,
  loading = false,
  className = "",
  onClick,
}: {
  children: ReactNode;
  label: string;
  tone?: Tone;
  size?: "sm" | "md";
  disabled?: boolean;
  loading?: boolean;
  className?: string;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`focusable inline-grid cursor-pointer place-items-center rounded-md border border-transparent bg-raise transition-[filter,opacity] duration-100 hover:brightness-[1.08] active:brightness-95 disabled:pointer-events-none disabled:opacity-40 ${
        tone === "neutral" ? "text-fg" : TEXT[tone]
      } ${
        size === "sm" ? "size-7" : "size-9"
      } ${className}`}
    >
      {loading ? <Spinner size={size === "sm" ? 11 : 13} /> : children}
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
        className={`block h-full rounded-[2px] transition-[width] duration-[260ms] ease-[var(--ease-out)] ${DOT[tone]}`}
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
