import type { ReactNode } from "react";
import { hueFor } from "@/lib/hue";

/**
 * A card with a header, as the lifecycle and deliverables pages draw one.
 * The subject's hue goes on the header and nowhere else (lib/hue.ts).
 */
export function Section({ id, title, hue, meta, action, children }: { id?: string; title: string; /** What the hue follows, when the title alone would not say. */ hue?: string; meta?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="flex min-w-0 scroll-mt-4 flex-col overflow-hidden rounded-md border border-line bg-surface">
      <div data-hue={hueFor((hue ?? title).toLowerCase())} className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/55 px-4 py-2">
        <span className="text-[12.5px] font-semibold text-fg">{title}</span>
        {meta && <span className="text-[11px] text-faint">{meta}</span>}
        {action && (
          <>
            <span className="grow" />
            {action}
          </>
        )}
      </div>
      <div className="flex flex-col gap-3 p-4">{children}</div>
    </section>
  );
}

/** A row of counted facts. The figures stay in the ink: a number's meaning is in its label, not its colour. */
export function Figures({ items }: { items: { k: string; v: ReactNode }[] }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-md border border-line bg-line" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(110px, 1fr))` }}>
      {items.map((x) => (
        <div key={x.k} className="flex flex-col gap-0.5 bg-surface px-3 py-2">
          <span className="tnum text-[15px] leading-none font-semibold text-fg">{x.v}</span>
          <span className="text-[10px] text-faint">{x.k}</span>
        </div>
      ))}
    </div>
  );
}

/** A page's title and what it is for. */
export function PageHeader({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end gap-3">
      <div className="flex max-w-[86ch] min-w-0 flex-col gap-1.5">
        <h1 className="text-[24px] font-semibold tracking-[-0.02em]">{title}</h1>
        <p className="text-[13.5px] leading-relaxed text-dim">{children}</p>
      </div>
      {action && (
        <>
          <span className="grow" />
          {action}
        </>
      )}
    </header>
  );
}

/** A collapsed block of JSON, for what a reader only sometimes needs. */
export function JsonDetails({ label, value }: { label: string; value: unknown }) {
  return (
    <details>
      <summary className="focusable cursor-pointer text-[10.5px] text-ghost">{label}</summary>
      <pre className="mt-1 max-h-56 overflow-auto rounded-sm border border-line bg-canvas px-2 py-1.5 font-mono text-[10px] leading-[1.5] whitespace-pre-wrap text-faint">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
