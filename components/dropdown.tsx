"use client";

import { useState, type ReactNode } from "react";
import { Kbd } from "./ui";
import { Checkbox } from "./forms";
import { useDismiss } from "./dismiss";

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
        type="button"
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
          {options.map((o) => (
            <div key={o} className="rounded-sm px-2 py-1.5 transition-colors hover:bg-raise">
              <Checkbox label={o} checked={selected.includes(o)} onChange={() => toggle(o)} />
            </div>
          ))}
          <div className="my-1 h-px bg-line" />
          <button
            type="button"
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
        type="button"
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
              type="button"
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
                type="button"
                role="menuitem"
                className="focusable w-full cursor-pointer rounded-sm px-2 py-1.5 text-left text-[13px] text-err transition-colors hover:bg-raise"
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
