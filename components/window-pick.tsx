"use client";

/**
 * The time window a figure is cut over. One picker for the whole console:
 * a page carries a global window, and any card may override it; a card on
 * the page window shows the choice in the quiet style so an override is
 * visible at a glance.
 */

export type Win = "24h" | "7d" | "30d" | "90d" | "all";

export const WINDOWS: { id: Win; label: string; ms: number }[] = [
  { id: "24h", label: "24h", ms: 86_400_000 },
  { id: "7d", label: "7d", ms: 7 * 86_400_000 },
  { id: "30d", label: "30d", ms: 30 * 86_400_000 },
  { id: "90d", label: "90d", ms: 90 * 86_400_000 },
  { id: "all", label: "All", ms: Infinity },
];

export const winMs = (w: Win) => WINDOWS.find((x) => x.id === w)!.ms;
export const nextWin = (w: Win): Win => WINDOWS[(WINDOWS.findIndex((x) => x.id === w) + 1) % WINDOWS.length].id;

export function WindowPick({ value, onChange, inherited }: { value: Win; onChange: (w: Win) => void; inherited?: boolean }) {
  return (
    <span className="inline-flex items-center gap-px rounded-sm border border-line bg-canvas p-px" role="radiogroup" aria-label="Window">
      {WINDOWS.map((w) => (
        <button
          key={w.id}
          type="button"
          role="radio"
          aria-checked={value === w.id}
          onClick={(e) => {
            e.stopPropagation();
            onChange(w.id);
          }}
          className={`focusable rounded-[3px] px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
            value === w.id ? (inherited ? "bg-raise text-fg" : "bg-ink text-on-ink") : "text-faint hover:text-fg"
          }`}
          title={inherited && value === w.id ? "Following the page window" : undefined}
        >
          {w.label}
        </button>
      ))}
    </span>
  );
}
