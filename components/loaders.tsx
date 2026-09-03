/**
 * Progress indicators. Restrained by design — no glow, no colored
 * bloom. Each names a kind of work so the viewer knows what is
 * happening, but the visual weight stays low enough to sit inside a
 * dense data view without shouting.
 */

/** Model is reasoning. Three bars, staggered. */
export function Thinking({ height = 12 }: { height?: number }) {
  return (
    <span
      className="inline-flex items-end gap-[2px] text-run"
      style={{ height }}
      role="status"
      aria-label="Working"
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="af-bar w-[2px] origin-bottom rounded-[2px] bg-current"
          style={{ height, animationDelay: `${i * 140}ms` }}
        />
      ))}
    </span>
  );
}

/** Indeterminate progress — queued work, long batches. */
export function Indeterminate({ className = "" }: { className?: string }) {
  return (
    <span
      role="progressbar"
      aria-label="Working"
      className={`block h-[3px] w-full overflow-hidden rounded-[2px] bg-sunken ${className}`}
    >
      <span className="af-indeterminate block h-full w-1/4 rounded-[2px] bg-run" />
    </span>
  );
}

/** Determinate arc — eval suites, batch runs. */
export function Ring({
  value,
  size = 36,
  tone = "run",
}: {
  value: number;
  size?: number;
  tone?: "run" | "ok";
}) {
  const stroke = 2.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          className="stroke-line"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          className={tone === "ok" ? "stroke-ok" : "stroke-run"}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value)}
          style={{ transition: "stroke-dashoffset 260ms var(--ease-out)" }}
        />
      </svg>
      <span className="tnum absolute font-mono text-[10px] text-dim">
        {Math.round(value * 100)}
      </span>
    </span>
  );
}

/** Content placeholder while an artifact is written. */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  const widths = ["100%", "86%", "68%", "92%"];
  return (
    <span className="flex w-full flex-col gap-1.5" aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <span
          key={i}
          className="af-pulse block h-2 rounded-xs bg-raise"
          style={{ width: widths[i % widths.length], animationDelay: `${i * 120}ms` }}
        />
      ))}
    </span>
  );
}
