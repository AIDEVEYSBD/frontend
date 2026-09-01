"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Kbd } from "./ui";

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return ref;
}

const Chevron = ({ open }: { open: boolean }) => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`shrink-0 text-faint transition-transform duration-150 ease-[var(--ease-out)] ${
      open ? "rotate-180" : ""
    }`}
    aria-hidden
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const surface =
  "absolute z-30 mt-1.5 min-w-full rounded-lg border border-line bg-surface p-1 elev-3 origin-top";

/* ═══════════════════ Select dropdown ═══════════════════ */

export function Dropdown({
  options,
  defaultValue,
  label,
  width = 200,
}: {
  options: string[];
  defaultValue?: string;
  label?: string;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(defaultValue ?? options[0]);
  const ref = useDismiss(open, () => setOpen(false));

  return (
    <div className="relative" ref={ref} style={{ width }}>
      <button
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="focusable flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-line-strong bg-field px-3 text-[13px] transition-colors duration-100 hover:bg-raise"
      >
        <span className="flex min-w-0 items-baseline gap-1.5">
          {label && <span className="shrink-0 text-faint">{label}</span>}
          <span className="truncate text-fg">{value}</span>
        </span>
        <Chevron open={open} />
      </button>

      {open && (
        <div role="listbox" className={surface}>
          {options.map((o) => (
            <button
              key={o}
              role="option"
              aria-selected={o === value}
              onClick={() => {
                setValue(o);
                setOpen(false);
              }}
              className={`focusable flex w-full cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-raise ${
                o === value ? "font-medium text-fg" : "text-mist"
              }`}
            >
              <span className="truncate">{o}</span>
              {o === value && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M4 13l5 5 11-13" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════ Multi-select filter ═══════════════════ */

export function FilterMenu({
  label,
  options,
  defaultSelected = [],
}: {
  label: string;
  options: string[];
  defaultSelected?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(defaultSelected);
  const ref = useDismiss(open, () => setOpen(false));

  const toggle = (o: string) =>
    setSelected((s) => (s.includes(o) ? s.filter((x) => x !== o) : [...s, o]));

  return (
    <div className="relative" ref={ref}>
      <button
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="focusable flex h-9 cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-field px-3 text-[13px] transition-colors duration-100 hover:bg-raise"
      >
        <span className="text-faint">{label}</span>
        <span className="text-fg">{selected.length ? `${selected.length} selected` : "Any"}</span>
        <Chevron open={open} />
      </button>

      {open && (
        <div className={`${surface} w-[220px]`}>
          {options.map((o) => {
            const on = selected.includes(o);
            return (
              <button
                key={o}
                onClick={() => toggle(o)}
                className="focusable flex w-full cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-[13px] text-mist transition-colors hover:bg-raise"
              >
                <span
                  className={`grid size-3.5 shrink-0 place-items-center rounded-xs border ${
                    on ? "border-ink bg-ink text-on-ink" : "border-line-strong"
                  }`}
                >
                  {on && (
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M4 13l5 5 11-13" />
                    </svg>
                  )}
                </span>
                <span className="truncate">{o}</span>
              </button>
            );
          })}
          <div className="my-1 h-px bg-line" />
          <button
            onClick={() => setSelected([])}
            className="focusable w-full cursor-pointer rounded-sm px-2 py-1.5 text-left text-[12.5px] text-faint transition-colors hover:bg-raise hover:text-fg"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════ Action menu ═══════════════════ */

export function ActionMenu({
  items,
  destructive,
  trigger,
  align = "right",
}: {
  items: { label: string; kbd?: string }[];
  destructive?: string;
  trigger?: ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));

  return (
    <div className="relative" ref={ref}>
      <button
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Row actions"
        onClick={() => setOpen((v) => !v)}
        className="focusable grid size-7 cursor-pointer place-items-center rounded-md text-faint transition-colors hover:bg-raise hover:text-fg"
      >
        {trigger ?? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <circle cx="12" cy="5" r="1.7" />
            <circle cx="12" cy="12" r="1.7" />
            <circle cx="12" cy="19" r="1.7" />
          </svg>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={`${surface} w-[210px] ${align === "right" ? "right-0" : "left-0"}`}
        >
          {items.map((i) => (
            <button
              key={i.label}
              role="menuitem"
              className="focusable flex w-full cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-left text-[13px] text-mist transition-colors hover:bg-raise hover:text-fg"
            >
              {i.label}
              {i.kbd && <Kbd>{i.kbd}</Kbd>}
            </button>
          ))}
          {destructive && (
            <>
              <div className="my-1 h-px bg-line" />
              <button
                role="menuitem"
                className="focusable w-full cursor-pointer rounded-sm px-2 py-1.5 text-left text-[13px] text-err transition-colors hover:bg-err-bg"
              >
                {destructive}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
