"use client";

import { useId, useState, type ReactNode } from "react";
import { Pick } from "./select";
import { FieldContext, useField } from "./field-context";

/* ═══════════════════ Field wrapper ═══════════════════
   A field is a label, a control, and one line of help or error. The label
   is bound to the control through context, so no caller has to thread ids
   by hand, and the error line describes the control to assistive tech. */

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
  /** Override the generated id when the control already has one. */
  htmlFor?: string;
}) {
  const generated = useId();
  const id = htmlFor ?? generated;
  const msgId = `${id}-msg`;
  const hasMsg = !!(error || hint);

  return (
    <FieldContext.Provider value={{ id, describedBy: hasMsg ? msgId : undefined, invalid: !!error }}>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-[12.5px] font-medium text-mist">
          {label}
        </label>
        {children}
        {error ? (
          <span id={msgId} role="alert" className="flex items-center gap-1.5 text-[11.5px] text-err">
            <ErrorGlyph size={12} />
            {error}
          </span>
        ) : hint ? (
          <span id={msgId} className="text-[11.5px] text-faint">
            {hint}
          </span>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

function ErrorGlyph({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5" />
      <path d="M12 16.5v.01" />
    </svg>
  );
}

const fieldBase =
  "w-full rounded-md border bg-field px-3 text-[13px] text-fg transition-[border-color,box-shadow] duration-100 ease-[var(--ease-out)] placeholder:text-ghost focus:outline-none focus-visible:border-fg focus-visible:ring-2 focus-visible:ring-fg/15 disabled:cursor-not-allowed disabled:bg-raise disabled:text-ghost";

const invalidRing = "border-err focus-visible:border-err focus-visible:ring-err/20";

/* ═══════════════════ Text inputs ═══════════════════ */

export function Input({
  placeholder,
  defaultValue,
  value,
  onChange,
  disabled,
  invalid,
  prefix,
  id,
  name,
  type = "text",
  mono = false,
  "aria-label": ariaLabel,
  autoComplete,
}: {
  placeholder?: string;
  defaultValue?: string;
  /** Controlled form: pass `value` and `onChange`. */
  value?: string;
  onChange?: (v: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  prefix?: ReactNode;
  id?: string;
  name?: string;
  type?: "text" | "password" | "email" | "url" | "number" | "search";
  mono?: boolean;
  "aria-label"?: string;
  autoComplete?: string;
}) {
  const field = useField();
  const resolvedId = id ?? field?.id;
  const bad = invalid ?? field?.invalid ?? false;
  const shared = {
    id: resolvedId,
    name,
    type,
    defaultValue,
    value,
    onChange: onChange ? (e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value) : undefined,
    placeholder,
    disabled,
    autoComplete,
    "aria-label": ariaLabel,
    "aria-invalid": bad || undefined,
    "aria-describedby": field?.describedBy,
  };

  if (prefix) {
    return (
      <div
        className={`flex h-9 items-center rounded-md border bg-field pl-3 transition-colors focus-within:border-fg focus-within:ring-2 focus-within:ring-fg/15 ${
          bad ? "border-err focus-within:border-err focus-within:ring-err/20" : "border-line-strong"
        } ${disabled ? "cursor-not-allowed bg-raise" : ""}`}
      >
        <span className="shrink-0 text-[13px] text-faint">{prefix}</span>
        <input
          {...shared}
          className={`h-full w-full bg-transparent px-2 text-[13px] text-fg placeholder:text-ghost focus:outline-none disabled:cursor-not-allowed disabled:text-ghost ${mono ? "font-mono text-[12.5px]" : ""}`}
        />
        {bad && (
          <span className="pr-2.5 text-err">
            <ErrorGlyph />
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        {...shared}
        className={`h-9 ${fieldBase} ${bad ? `${invalidRing} pr-9` : "border-line-strong"} ${mono ? "font-mono text-[12.5px]" : ""}`}
      />
      {bad && (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-err">
          <ErrorGlyph />
        </span>
      )}
    </div>
  );
}

export function Textarea({
  placeholder,
  defaultValue,
  value,
  onChange,
  rows = 3,
  disabled,
  invalid,
  id,
  name,
  mono = false,
  "aria-label": ariaLabel,
}: {
  placeholder?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (v: string) => void;
  rows?: number;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  name?: string;
  mono?: boolean;
  "aria-label"?: string;
}) {
  const field = useField();
  const bad = invalid ?? field?.invalid ?? false;
  return (
    <div className="relative">
      <textarea
        id={id ?? field?.id}
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-invalid={bad || undefined}
        aria-describedby={field?.describedBy}
        className={`resize-y py-2 leading-[1.55] ${fieldBase} ${bad ? `${invalidRing} pr-9` : "border-line-strong"} ${mono ? "font-mono text-[12px]" : ""}`}
      />
      {bad && (
        <span className="pointer-events-none absolute top-2.5 right-3 text-err">
          <ErrorGlyph />
        </span>
      )}
    </div>
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
  value,
  onChange,
  disabled,
  loading,
  invalid,
  id,
  "aria-label": ariaLabel,
}: {
  options: string[];
  defaultValue?: string;
  value?: string;
  onChange?: (v: string) => void;
  disabled?: boolean;
  loading?: boolean;
  invalid?: boolean;
  id?: string;
  "aria-label"?: string;
}) {
  const [own, setOwn] = useState(defaultValue ?? options[0] ?? "");
  const current = value ?? own;
  return (
    <Pick
      size="md"
      id={id}
      value={current}
      onChange={(v) => {
        if (value === undefined) setOwn(v);
        onChange?.(v);
      }}
      options={options.map((o) => ({ value: o, label: o }))}
      disabled={disabled}
      loading={loading}
      invalid={invalid}
      aria-label={ariaLabel}
    />
  );
}

/* ═══════════════════ Choice controls ═══════════════════ */

export function Checkbox({
  label,
  defaultChecked,
  checked,
  onChange,
  disabled,
  indeterminate,
  "aria-label": ariaLabel,
}: {
  label?: string;
  defaultChecked?: boolean;
  /** Controlled form: pass `checked` and `onChange`; otherwise it keeps its own state. */
  checked?: boolean;
  onChange?: (on: boolean) => void;
  disabled?: boolean;
  indeterminate?: boolean;
  "aria-label"?: string;
}) {
  const id = useId();
  const [own, setOwn] = useState(!!defaultChecked);
  const on = checked ?? own;
  const mixed = indeterminate && !on;
  const flip = () => {
    if (checked === undefined) setOwn((v) => !v);
    onChange?.(!on);
  };

  return (
    <div className="flex items-center gap-2.5">
      <button
        id={id}
        type="button"
        role="checkbox"
        aria-checked={mixed ? "mixed" : on}
        aria-label={label ? undefined : ariaLabel}
        disabled={disabled}
        onClick={flip}
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
      {label && (
        <label
          htmlFor={id}
          className={`cursor-pointer text-[13px] ${disabled ? "text-ghost" : "text-mist"}`}
        >
          {label}
        </label>
      )}
    </div>
  );
}

type RadioOption = string | { value: string; label?: string; disabled?: boolean };

export function Radio({
  options,
  defaultValue,
  value,
  onChange,
  name,
  disabled,
}: {
  options: RadioOption[];
  defaultValue?: string;
  value?: string;
  onChange?: (v: string) => void;
  name: string;
  disabled?: boolean;
}) {
  const base = useId();
  const opts = options.map((o) => (typeof o === "string" ? { value: o, label: o, disabled: false } : { label: o.value, disabled: false, ...o }));
  const [own, setOwn] = useState(defaultValue ?? opts[0]?.value ?? "");
  const current = value ?? own;
  const pick = (v: string) => {
    if (value === undefined) setOwn(v);
    onChange?.(v);
  };
  const enabled = opts.filter((o) => !o.disabled && !disabled);

  // Arrow keys move the selection within the group, the way a native radio
  // does, so the group is one tab stop rather than one per option.
  const onKey = (e: React.KeyboardEvent) => {
    if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(e.key)) return;
    e.preventDefault();
    const i = enabled.findIndex((o) => o.value === current);
    const dir = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
    const next = enabled[(i + dir + enabled.length) % enabled.length];
    if (!next) return;
    pick(next.value);
    (document.getElementById(`${base}-${next.value}`) as HTMLElement | null)?.focus();
  };

  return (
    <div className="flex flex-col gap-2.5" role="radiogroup" aria-label={name} onKeyDown={onKey}>
      {opts.map((o) => {
        const id = `${base}-${o.value}`;
        const off = disabled || o.disabled;
        const on = current === o.value;
        return (
          <div key={o.value} className="flex items-center gap-2.5">
            <button
              id={id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={off}
              tabIndex={on || (!enabled.some((x) => x.value === current) && enabled[0]?.value === o.value) ? 0 : -1}
              onClick={() => pick(o.value)}
              className={`focusable grid size-4 shrink-0 cursor-pointer place-items-center rounded-full border transition-all duration-100 disabled:cursor-not-allowed disabled:opacity-40 ${
                on ? "border-ink" : "border-line-strong bg-field"
              }`}
            >
              {on && <span className="size-2 rounded-full bg-ink" />}
            </button>
            <label htmlFor={id} className={`cursor-pointer text-[13px] ${off ? "text-ghost" : "text-mist"}`}>
              {o.label}
            </label>
          </div>
        );
      })}
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
        type="button"
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
          type="button"
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
            type="button"
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
