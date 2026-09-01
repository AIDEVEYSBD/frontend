"use client";

import { useLayoutEffect, useSyncExternalStore } from "react";

export type Theme = "light" | "dark" | "system";

/**
 * Runs before paint to stamp the theme, so there is no flash of the
 * wrong palette. Inlined in <head> — must stay dependency-free.
 */
export const themeScript = `
(function(){try{
  var t = localStorage.getItem('af-theme') || 'system';
  if (t !== 'system') document.documentElement.setAttribute('data-theme', t);
}catch(e){}})();
`;

/**
 * The theme lives outside React — the inline script sets it before the
 * first paint, so React subscribes to it rather than owning it. This
 * also keeps the toggle off the read-storage-in-an-effect path, which
 * causes a cascading render on every mount.
 */
const listeners = new Set<() => void>();
let current: Theme | null = null;

function read(): Theme {
  if (current === null) {
    try {
      current = (localStorage.getItem("af-theme") as Theme) ?? "system";
    } catch {
      current = "system";
    }
  }
  return current;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function apply(theme: Theme) {
  current = theme;
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("af-theme", theme);
  } catch {
    /* storage unavailable — theme still applies for this session */
  }
  listeners.forEach((l) => l());
}

const OPTIONS: { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "system", label: "Auto" },
  { value: "dark", label: "Dark" },
];

export function ThemeToggle() {
  // Server and first client render agree on "system"; the store takes over after.
  const theme = useSyncExternalStore(subscribe, read, () => "system" as Theme);

  // Strict Mode's dev remount resets <html> to the attributes React manages,
  // clearing what the pre-paint script stamped. Re-apply before paint from
  // the same source the script read. A no-op in production.
  useLayoutEffect(() => {
    const t = read();
    if (t !== "system") document.documentElement.setAttribute("data-theme", t);
  }, []);

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      className="flex items-center gap-px rounded-sm border border-line bg-raise p-px"
    >
      {OPTIONS.map((opt) => {
        const active = theme === opt.value;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={active}
            onClick={() => apply(opt.value)}
            className={`focusable cursor-pointer rounded-xs px-2 py-1 text-[11px] transition-colors duration-100 ${
              active
                ? "bg-surface text-fg shadow-[var(--shadow-1)]"
                : "text-faint hover:text-dim"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
