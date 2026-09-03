"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Spinner } from "./ui";
import { useField } from "./field-context";

/**
 * `useLayoutEffect` warns when React renders on the server, and this component
 * is server-rendered inside pages that are. The measuring pass genuinely needs
 * to run before paint on the client — otherwise the list flashes at the wrong
 * position — so it stays a layout effect there and degrades to a plain effect
 * where there is no layout to read.
 */
const useMeasure = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * A select that is ours, not the operating system's.
 *
 * A native `<select>` renders its list with the platform's own chrome — a
 * different typeface, a different focus ring, and in dark mode usually a white
 * sheet. One of those on a page is enough to make everything around it look
 * unfinished, because it is the one element the design system visibly does not
 * reach.
 *
 * The list is portalled to `document.body` rather than positioned inside the
 * trigger's parent. That is load-bearing: this control lives in the inspector
 * rail, which is an `overflow-y-auto` container, and anything absolutely
 * positioned inside one of those is clipped by it. Portalling means measuring
 * and repositioning by hand, including on ancestor scroll, which is what the
 * effects below are doing.
 */
export function Pick<T extends string>({
  value,
  onChange,
  options,
  size = "sm",
  disabled = false,
  loading = false,
  invalid,
  id: givenId,
  "aria-label": ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  size?: "sm" | "md";
  disabled?: boolean;
  /** The options are still arriving; the trigger shows a spinner and cannot open. */
  loading?: boolean;
  invalid?: boolean;
  id?: string;
  "aria-label"?: string;
}) {
  const field = useField();
  const bad = invalid ?? field?.invalid ?? false;
  const inert = disabled || loading;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const listId = useId();
  const id = givenId ?? field?.id;

  const selected = options.find((o) => o.value === value);
  const height = size === "md" ? "h-9" : "h-8";

  /* Measure against the viewport and flip up when there is no room below. */
  const place = useCallback(() => {
    const t = trigger.current?.getBoundingClientRect();
    if (!t) return;
    const wanted = Math.min(options.length * 30 + 8, 280);
    const below = window.innerHeight - t.bottom - 8;
    const up = below < wanted && t.top > below;
    setBox({
      left: Math.max(8, Math.min(t.left, window.innerWidth - t.width - 8)),
      top: up ? Math.max(8, t.top - wanted - 4) : t.bottom + 4,
      width: t.width,
      up,
    });
  }, [options.length]);

  useMeasure(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;

    // `capture` catches scrolls on ancestor containers, not just the window —
    // without it the list detaches from its trigger the moment the rail moves.
    const reposition = () => place();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);

    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!trigger.current?.contains(t) && !list.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);

    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [open, place]);

  /* Keep the highlighted row in view when arrowing through a long list. */
  useEffect(() => {
    if (!open) return;
    list.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const commit = (i: number) => {
    const o = options[i];
    if (o) onChange(o.value);
    setOpen(false);
    trigger.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (inert) return;
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        setActive(Math.max(0, options.findIndex((o) => o.value === value)));
        setOpen(true);
      }
      return;
    }

    switch (e.key) {
      case "Escape":
        e.preventDefault();
        setOpen(false);
        trigger.current?.focus();
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        commit(active);
        break;
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => Math.min(options.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(options.length - 1);
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        // Typeahead. Resets after a pause, so "re" then later "n" starts over.
        if (e.key.length === 1) {
          const now = Date.now();
          typed.current.text = now - typed.current.at > 700 ? e.key : typed.current.text + e.key;
          typed.current.at = now;
          const hit = options.findIndex((o) =>
            o.label.toLowerCase().startsWith(typed.current.text.toLowerCase()),
          );
          if (hit >= 0) setActive(hit);
        }
    }
  };

  return (
    <>
      <button
        ref={trigger}
        id={id}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        aria-invalid={bad || undefined}
        aria-describedby={field?.describedBy}
        aria-busy={loading || undefined}
        disabled={inert}
        onClick={() => {
          setActive(Math.max(0, options.findIndex((o) => o.value === value)));
          setOpen((v) => !v);
        }}
        onKeyDown={onKey}
        className={`focusable flex w-full cursor-pointer items-center gap-2 rounded-md border bg-field px-2.5 text-left text-[13px] transition-colors duration-100 active:brightness-95 disabled:cursor-not-allowed disabled:bg-raise disabled:text-ghost disabled:hover:border-line-strong ${height} ${
          bad ? "border-err hover:border-err" : "border-line-strong hover:border-fg/40"
        } ${open ? "border-fg" : ""}`}
      >
        <span className={`min-w-0 grow truncate ${selected?.label && !inert ? "text-fg" : "text-ghost"}`}>
          {selected?.label ?? options[0]?.label ?? ""}
        </span>
        {loading ? (
          <span className="shrink-0 text-faint"><Spinner size={11} /></span>
        ) : (
        <svg
          width="11"
          height="11"
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
        )}
      </button>

      {open && box && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={list}
              id={listId}
              role="listbox"
              tabIndex={-1}
              onKeyDown={onKey}
              style={{
                position: "fixed",
                left: box.left,
                top: box.top,
                minWidth: box.width,
                maxHeight: 280,
              }}
              className={`z-[60] overflow-y-auto rounded-md border border-line bg-surface p-1 elev-3 ${
                box.up ? "af-pop-up" : "af-pop"
              }`}
            >
              {options.map((o, i) => {
                const isSel = o.value === value;
                return (
                  <div
                    key={o.value || `blank-${i}`}
                    id={`${listId}-${i}`}
                    data-i={i}
                    role="option"
                    aria-selected={isSel}
                    onPointerEnter={() => setActive(i)}
                    onClick={() => commit(i)}
                    className={`flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-[12.5px] transition-colors ${
                      i === active ? "bg-raise" : ""
                    } ${isSel ? "font-medium text-fg" : "text-mist"}`}
                  >
                    <span className="min-w-0 grow truncate">{o.label}</span>
                    {isSel && (
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0"
                        aria-hidden
                      >
                        <path d="M4 13l5 5 11-13" />
                      </svg>
                    )}
                  </div>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/* ═══════════════════ PickMany ═══════════════════ */

/**
 * The same dropdown, choosing several. Rows are checkboxes, the trigger
 * summarises the choice, and the list stays open while the person ticks.
 * Portalled like `Pick`, for the same reason: it has to escape scrolling
 * containers without being clipped by them.
 */
export function PickMany<T extends string>({
  values,
  onChange,
  options,
  placeholder = "Choose…",
  summary,
  size = "sm",
  disabled = false,
  "aria-label": ariaLabel,
}: {
  values: T[];
  onChange: (v: T[]) => void;
  options: { value: T; label: string; note?: string; locked?: boolean }[];
  placeholder?: string;
  /** Custom trigger text for the current selection. */
  summary?: (chosen: { value: T; label: string }[]) => string;
  size?: "sm" | "md";
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const height = size === "md" ? "h-9" : "h-8";
  const chosen = options.filter((o) => values.includes(o.value));
  const text = chosen.length === 0 ? placeholder : summary ? summary(chosen) : chosen.map((o) => o.label).join(", ");

  const place = useCallback(() => {
    const t = trigger.current?.getBoundingClientRect();
    if (!t) return;
    const wanted = Math.min(options.length * 34 + 48, 320);
    const below = window.innerHeight - t.bottom - 8;
    const up = below < wanted && t.top > below;
    setBox({
      left: Math.max(8, Math.min(t.left, window.innerWidth - Math.max(t.width, 280) - 8)),
      top: up ? Math.max(8, t.top - wanted - 4) : t.bottom + 4,
      width: Math.max(t.width, 280),
      up,
    });
  }, [options.length]);

  useMeasure(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const reposition = () => place();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!trigger.current?.contains(t) && !list.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [open, place]);

  const toggle = (v: T) => {
    const o = options.find((x) => x.value === v);
    if (!o || o.locked) return;
    onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    switch (e.key) {
      case "Escape":
      case "Tab":
        setOpen(false);
        trigger.current?.focus();
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (options[active]) toggle(options[active].value);
        break;
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => Math.min(options.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKey}
        className={`focusable flex w-full cursor-pointer items-center gap-2 rounded-md border bg-field px-2.5 text-left text-[13px] transition-colors duration-100 active:brightness-95 disabled:cursor-not-allowed disabled:bg-raise disabled:text-ghost ${height} border-line-strong hover:border-fg/40 ${open ? "border-fg" : ""}`}
      >
        <span className={`min-w-0 grow truncate ${chosen.length && !disabled ? "text-fg" : "text-ghost"}`}>{text}</span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-faint transition-transform duration-150 ease-[var(--ease-out)] ${open ? "rotate-180" : ""}`} aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && box && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={list}
              id={listId}
              role="listbox"
              aria-multiselectable
              tabIndex={-1}
              onKeyDown={onKey}
              style={{ position: "fixed", left: box.left, top: box.top, minWidth: box.width, maxHeight: 320 }}
              className={`z-[60] flex flex-col overflow-hidden rounded-md border border-line bg-surface elev-3 ${box.up ? "af-pop-up" : "af-pop"}`}
            >
              <div className="overflow-y-auto p-1">
                {options.map((o, i) => {
                  const on = values.includes(o.value);
                  return (
                    <div
                      key={o.value}
                      data-i={i}
                      role="option"
                      aria-selected={on}
                      aria-disabled={o.locked || undefined}
                      onPointerEnter={() => setActive(i)}
                      onClick={() => toggle(o.value)}
                      className={`flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-[12.5px] transition-colors ${o.locked ? "cursor-default" : "cursor-pointer"} ${i === active ? "bg-raise" : ""} ${on ? "text-fg" : "text-mist"}`}
                    >
                      <span
                        className={`grid size-4 shrink-0 place-items-center rounded-[3px] border transition-colors ${on ? "border-fg bg-fg" : "border-line-strong bg-field"} ${o.locked ? "opacity-60" : ""}`}
                        aria-hidden
                      >
                        {on && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--t-on-ink)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        )}
                      </span>
                      <span className="min-w-0 grow truncate">{o.label}</span>
                      {o.note && <span className="shrink-0 font-mono text-[10px] text-faint">{o.note}</span>}
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center gap-3 border-t border-line px-2.5 py-1.5 text-[11px]">
                <button type="button" onClick={() => onChange(options.map((o) => o.value))} className="focusable cursor-pointer rounded-sm text-dim hover:text-fg">All</button>
                <button type="button" onClick={() => onChange(options.filter((o) => o.locked).map((o) => o.value))} className="focusable cursor-pointer rounded-sm text-dim hover:text-fg">None</button>
                <span className="grow" />
                <span className="text-faint">{chosen.length} of {options.length}</span>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
