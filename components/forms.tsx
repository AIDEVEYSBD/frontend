"use client";

import { useId, useState, type ReactNode } from "react";
import { Pick } from "./select";

/* ═══════════════════ Field wrapper ═══════════════════ */

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-[12.5px] font-medium text-mist">
        {label}
      </label>
      {children}
      {error ? (
        <span className="text-[11.5px] text-err">{error}</span>
      ) : hint ? (
        <span className="text-[11.5px] text-faint">{hint}</span>
      ) : null}
    </div>
  );
}

const fieldBase =
  "w-full rounded-md border bg-field px-3 text-[13px] text-fg transition-[border-color,box-shadow] duration-100 ease-[var(--ease-out)] placeholder:text-ghost focus:outline-none focus-visible:border-fg focus-visible:ring-2 focus-visible:ring-fg/15 disabled:cursor-not-allowed disabled:bg-raise disabled:text-ghost";

/* ═══════════════════ Text inputs ═══════════════════ */

export function Input({
  placeholder,
  defaultValue,
  disabled,
  invalid,
  prefix,
  id,
}: {
  placeholder?: string;
  defaultValue?: string;
  disabled?: boolean;
  invalid?: boolean;
  prefix?: ReactNode;
  id?: string;
}) {
  if (prefix) {
    return (
      <div
        className={`flex h-9 items-center rounded-md border bg-field pl-3 transition-colors focus-within:border-fg focus-within:ring-2 focus-within:ring-fg/15 ${
          invalid ? "border-err" : "border-line-strong"
        }`}
      >
        <span className="shrink-0 text-[13px] text-faint">{prefix}</span>
        <input
          id={id}
          defaultValue={defaultValue}
          placeholder={placeholder}
          disabled={disabled}
          className="h-full w-full bg-transparent px-2 text-[13px] text-fg placeholder:text-ghost focus:outline-none"
        />
      </div>
    );
  }

  return (
    <input
      id={id}
      defaultValue={defaultValue}
      placeholder={placeholder}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      className={`h-9 ${fieldBase} ${invalid ? "border-err focus-visible:border-err focus-visible:ring-err/20" : "border-line-strong"}`}
    />
  );
}

export function Textarea({
  placeholder,
  defaultValue,
  rows = 3,
}: {
  placeholder?: string;
  defaultValue?: string;
  rows?: number;
}) {
  return (
    <textarea
      rows={rows}
      defaultValue={defaultValue}
      placeholder={placeholder}
      className={`resize-y border-line-strong py-2 leading-[1.55] ${fieldBase}`}
    />
  );
}

/**
 * The design page's select is the same component the builder uses.
 *
 * There is exactly one dropdown in this system, and it is ours — a native
 * `<select>` opens the operating system's list, which ignores every token here
 * and is the one element that makes the rest look unfinished next to it.
 */
export function Select({
  options,
  defaultValue,
  disabled,
}: {
  options: string[];
  defaultValue?: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(defaultValue ?? options[0] ?? "");

  if (disabled) {
    return (
      <div className="flex h-9 w-full cursor-not-allowed items-center gap-2 rounded-md border border-line-strong bg-raise px-3 text-[13px] text-ghost">
        <span className="min-w-0 grow truncate">{value}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>
    );
  }

  return (
    <Pick
      size="md"
      value={value}
      onChange={setValue}
      options={options.map((o) => ({ value: o, label: o }))}
    />
  );
}

/* ═══════════════════ Choice controls ═══════════════════ */

export function Checkbox({
  label,
  defaultChecked,
  disabled,
  indeterminate,
}: {
  label: string;
  defaultChecked?: boolean;
  disabled?: boolean;
  indeterminate?: boolean;
}) {
  const id = useId();
  const [on, setOn] = useState(!!defaultChecked);
  const mixed = indeterminate && !on;

  return (
    <div className="flex items-center gap-2.5">
      <button
        id={id}
        role="checkbox"
        aria-checked={mixed ? "mixed" : on}
        disabled={disabled}
        onClick={() => setOn((v) => !v)}
        className={`focusable grid size-4 shrink-0 cursor-pointer place-items-center rounded-xs border transition-all duration-100 ease-[var(--ease-out)] disabled:cursor-not-allowed disabled:opacity-40 ${
          on || mixed ? "border-ink bg-ink text-on-ink" : "border-line-strong bg-field"
        }`}
      >
        {mixed ? (
          <svg width="9" height="9" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="4" strokeLinecap="round">
            <path d="M5 12h14" />
          </svg>
        ) : on ? (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 13l5 5 11-13" />
          </svg>
        ) : null}
      </button>
      <label
        htmlFor={id}
        className={`cursor-pointer text-[13px] ${disabled ? "text-ghost" : "text-mist"}`}
      >
        {label}
      </label>
    </div>
  );
}

export function Radio({
  options,
  defaultValue,
  name,
}: {
  options: string[];
  defaultValue?: string;
  name: string;
}) {
  const [value, setValue] = useState(defaultValue ?? options[0]);
  return (
    <div className="flex flex-col gap-2.5" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <div key={o} className="flex items-center gap-2.5">
          <button
            role="radio"
            aria-checked={value === o}
            onClick={() => setValue(o)}
            className={`focusable grid size-4 shrink-0 cursor-pointer place-items-center rounded-full border transition-all duration-100 ${
              value === o ? "border-ink" : "border-line-strong bg-field"
            }`}
          >
            {value === o && <span className="size-2 rounded-full bg-ink" />}
          </button>
          <span className="cursor-pointer text-[13px] text-mist" onClick={() => setValue(o)}>
            {o}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Switch({
  label,
  defaultChecked,
  checked,
  onChange,
  disabled,
}: {
  label?: string;
  defaultChecked?: boolean;
  /** Controlled form: pass `checked` and `onChange`; otherwise it keeps its own state. */
  checked?: boolean;
  onChange?: (on: boolean) => void;
  disabled?: boolean;
}) {
  const [own, setOwn] = useState(!!defaultChecked);
  const on = checked ?? own;
  const flip = () => {
    if (checked === undefined) setOwn((v) => !v);
    onChange?.(!on);
  };
  return (
    <div className="flex items-center gap-2.5">
      <button
        role="switch"
        aria-checked={on}
        aria-label={label ?? "Toggle"}
        disabled={disabled}
        onClick={flip}
        className={`focusable relative h-5 w-9 shrink-0 cursor-pointer rounded-sm border transition-colors duration-150 ease-[var(--ease-out)] disabled:cursor-not-allowed disabled:opacity-40 ${
          on ? "border-ink bg-ink" : "border-line-strong bg-raise"
        }`}
      >
        <span
          className={`absolute top-1/2 h-3.5 w-3 -translate-y-1/2 rounded-[2px] transition-[left] duration-150 ease-[var(--ease-out)] ${
            on ? "left-[19px] bg-on-ink" : "left-[2px] bg-faint"
          }`}
        />
      </button>
      {label && <span className="text-[13px] text-mist">{label}</span>}
    </div>
  );
}

/* ═══════════════════ Segmented & tabs ═══════════════════ */

export function Segmented({
  options,
  defaultValue,
}: {
  options: string[];
  defaultValue?: string;
}) {
  const [value, setValue] = useState(defaultValue ?? options[0]);
  return (
    <div
      role="radiogroup"
      className="inline-flex items-center gap-px rounded-md border border-line bg-raise p-px"
    >
      {options.map((o) => (
        <button
          key={o}
          role="radio"
          aria-checked={value === o}
          onClick={() => setValue(o)}
          className={`focusable cursor-pointer rounded-sm px-2.5 py-1 text-[12.5px] transition-colors duration-100 ${
            value === o
              ? "bg-surface font-medium text-fg shadow-[var(--shadow-1)]"
              : "text-faint hover:text-dim"
          }`}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

/**
 * `panels` is a plain map rather than a render prop, so a Server
 * Component can pass its content straight in — functions cannot cross
 * that boundary, JSX can.
 */
export function Tabs({
  tabs,
  panels,
}: {
  tabs: string[];
  panels?: Record<string, ReactNode>;
}) {
  const [active, setActive] = useState(tabs[0]);
  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" className="flex items-center gap-5 border-b border-line">
        {tabs.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={active === t}
            onClick={() => setActive(t)}
            className={`focusable relative -mb-px cursor-pointer pb-2.5 text-[13px] transition-colors duration-100 ${
              active === t
                ? "font-medium text-fg"
                : "text-faint hover:text-dim"
            }`}
          >
            {t}
            {active === t && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-[2px] bg-fg" />}
          </button>
        ))}
      </div>
      {panels?.[active]}
    </div>
  );
}
