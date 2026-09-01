"use client";

import { useState, type ReactNode } from "react";

export { Pick } from "../select";

/**
 * Controlled form primitives for the builder.
 *
 * The ones in `forms.tsx` are uncontrolled by design — they exist on the design
 * page to show the six states of a control, not to hold state. These carry the
 * same classes so the two are visually identical, and take value/onChange so
 * they can drive a document that has to round-trip to the runtime.
 */

const BASE =
  "w-full rounded-md border border-line-strong bg-field text-[13px] text-fg transition-[border-color,box-shadow] duration-100 ease-[var(--ease-out)] placeholder:text-ghost focus:outline-none focus-visible:border-fg focus-visible:ring-2 focus-visible:ring-fg/15 disabled:cursor-not-allowed disabled:bg-raise disabled:text-ghost";

export function Row({
  label,
  hint,
  children,
  tight = false,
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  tight?: boolean;
}) {
  return (
    <div className={`flex flex-col ${tight ? "gap-1" : "gap-1.5"}`}>
      <span className="text-[12px] font-medium text-mist">{label}</span>
      {children}
      {hint && <span className="text-[11px] leading-[1.5] text-faint">{hint}</span>}
    </div>
  );
}

export function Text({
  value,
  onChange,
  placeholder,
  mono = false,
  invalid = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  invalid?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      className={`h-8 px-2.5 ${BASE} ${mono ? "font-mono text-[12px]" : ""} ${
        invalid ? "border-err focus-visible:border-err focus-visible:ring-err/20" : ""
      }`}
    />
  );
}

export function Area({
  value,
  onChange,
  onBlur,
  placeholder,
  rows = 3,
  mono = false,
  invalid = false,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  rows?: number;
  mono?: boolean;
  invalid?: boolean;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={`resize-y px-2.5 py-1.5 leading-[1.55] ${BASE} ${mono ? "font-mono text-[12px]" : ""} ${
        invalid ? "border-err focus-visible:border-err focus-visible:ring-err/20" : ""
      }`}
    />
  );
}

/**
 * A comma-separated list edited as text. Local text is the source of truth
 * while typing — a trailing comma round-tripped through the array would be
 * eaten mid-keystroke — and the parsed array flows out on every change.
 */
export function CsvText({
  values,
  onValues,
  placeholder,
  mono = false,
  invalid = false,
}: {
  values: string[];
  onValues: (v: string[]) => void;
  placeholder?: string;
  mono?: boolean;
  invalid?: boolean;
}) {
  const parse = (t: string) => t.split(",").map((s) => s.trim()).filter(Boolean);
  const joined = values.join(", ");
  const [text, setText] = useState(joined);
  const [seen, setSeen] = useState(joined);
  // Re-seed only on an external change — never while our own edits echo back.
  if (joined !== seen) {
    setSeen(joined);
    if (parse(text).join(", ") !== joined) setText(joined);
  }
  return (
    <input
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onValues(parse(e.target.value));
      }}
      onBlur={() => setText(parse(text).join(", "))}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      className={`h-8 px-2.5 ${BASE} ${mono ? "font-mono text-[12px]" : ""} ${
        invalid ? "border-err focus-visible:border-err focus-visible:ring-err/20" : ""
      }`}
    />
  );
}

export function Num({
  value,
  onChange,
  min = 1,
  max = 999,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  // Local text so a half-typed or cleared value survives; clamp on commit only.
  const [text, setText] = useState(String(value));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (Number(text) !== value) setText(String(value));
  }
  const commit = () => {
    const v = Math.max(min, Math.min(max, Number(text) || min));
    setText(String(v));
    onChange(v);
  };
  return (
    <input
      type="number"
      value={text}
      min={min}
      max={max}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className={`tnum h-8 px-2.5 font-mono text-[12px] ${BASE}`}
    />
  );
}

export function Check({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <span
        className={`mt-px grid size-4 shrink-0 place-items-center rounded-[3px] border transition-colors ${
          checked ? "border-fg bg-fg" : "border-line-strong bg-field"
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="sr-only"
        />
        {checked && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--t-on-ink)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M20 6L9 17l-5-5" />
          </svg>
        )}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[12.5px] text-mist">{label}</span>
        {hint && <span className="text-[11px] leading-[1.5] text-faint">{hint}</span>}
      </span>
    </label>
  );
}

/**
 * A titled block in a side panel. The header is a disclosure: these panels get
 * long, and a rail where every card family is open at once is a rail nobody
 * can scan. Collapsed state is per-mount on purpose — a fresh page opens with
 * everything visible, which is the state that teaches.
 */
export function Section({
  title,
  count,
  children,
  action,
  defaultOpen = true,
}: {
  title: string;
  count?: number | string;
  children: ReactNode;
  action?: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="flex flex-col gap-2.5 border-t border-line px-4 py-3 first:border-t-0">
      <header className="-mx-1 flex items-center gap-2">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="focusable flex min-w-0 grow cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 text-left transition-colors hover:bg-raise/70"
        >
          <svg
            width="8"
            height="8"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`shrink-0 text-ghost transition-transform duration-150 ${open ? "rotate-90" : ""}`}
            aria-hidden
          >
            <path d="M9 6l6 6-6 6" />
          </svg>
          <h3 className="font-mono text-[10px] tracking-[0.14em] text-faint uppercase">{title}</h3>
          {count !== undefined && (
            <span className="tnum font-mono text-[10px] text-ghost">{count}</span>
          )}
        </button>
        {/* Actions live outside the toggle so adding never collapses. */}
        {open && action && <span className="shrink-0 px-1">{action}</span>}
      </header>
      {open && children}
    </section>
  );
}

/** A small square action button used inside panel headers and list rows. */
export function Mini({
  children,
  onClick,
  label,
  tone = "neutral",
}: {
  children: ReactNode;
  onClick: () => void;
  label: string;
  tone?: "neutral" | "err";
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`focusable grid size-6 shrink-0 cursor-pointer place-items-center rounded-sm border border-line transition-colors ${
        tone === "err" ? "text-faint hover:border-err-line hover:bg-err-bg hover:text-err" : "text-faint hover:bg-raise hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

export function Plus({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function Cross({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
