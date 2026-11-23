"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Status } from "./ui";
import { hueFor } from "@/lib/hue";
import type { OfferReading } from "@/lib/workloads";

/**
 * The pieces the workload screens share: a card with a header bar, a
 * workload's state as the door gave it, a short list, and a pair of facts.
 * Presentational; none of them reads a door.
 */

export function Card({ title, hue, meta, action, children, pad = true }: { title: string; /** What the header's hue follows, when the title alone would not say. */ hue?: string; meta?: ReactNode; action?: ReactNode; children: ReactNode; pad?: boolean }) {
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
      <div data-hue={hueFor((hue ?? title).toLowerCase())} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-raise/55 px-4 py-2.5">
        <span className="text-[13px] font-semibold tracking-[-0.005em] text-fg">{title}</span>
        {meta && <span className="text-[11px] text-faint">{meta}</span>}
        {action && (
          <>
            <span className="grow" />
            {action}
          </>
        )}
      </div>
      <div className={pad ? "flex flex-col gap-4 p-4" : "flex flex-col"}>{children}</div>
    </section>
  );
}

/** A workload's state, as the workloads door gave it. */
export function OfferMark({ reading, chip = false }: { reading: OfferReading; chip?: boolean }) {
  // Why it cannot be started, in the platform's words, on hover; the cards and the set-up step say it in full.
  return (
    <span title={reading.why || undefined} className="inline-flex">
      <Status tone={reading.tone} chip={chip}>
        {reading.label}
      </Status>
    </span>
  );
}

/** The agent that runs a workload, as a link to its configuration. */
export function AgentLink({ agent }: { agent: string }) {
  return (
    <Link href={`/agent?id=${encodeURIComponent(agent)}`} className="focusable rounded-sm font-mono text-[11px] break-all text-dim underline decoration-line-strong underline-offset-2 hover:text-fg hover:decoration-fg">
      {agent}
    </Link>
  );
}

/** A short list of plain lines, each with the small square mark. */
export function Lines({ items, empty }: { items: string[]; empty?: string }) {
  if (!items.length) return empty ? <p className="text-[12px] leading-[1.55] text-faint">{empty}</p> : null;
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((x, i) => (
        <li key={`${x}-${i}`} className="flex gap-2 text-[12.5px] leading-[1.5] text-mist">
          <span className="mt-[7px] size-1 shrink-0 rounded-[1px] bg-faint" />
          <span className="min-w-0 break-words">{x}</span>
        </li>
      ))}
    </ul>
  );
}

/** Keys and values in two columns; a row is shown even when its value is "not given", so the reader sees what was asked. */
export function Facts({ items }: { items: { k: string; v: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-5 gap-y-2 sm:grid-cols-[minmax(140px,max-content)_minmax(0,1fr)]">
      {items.map((x) => (
        <div key={x.k} className="contents">
          <dt className="text-[11.5px] leading-[1.6] text-faint">{x.k}</dt>
          <dd className="min-w-0 text-[12.5px] leading-[1.55] break-words text-fg">{x.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A value that was not given: said, not left blank. */
export function NotGiven({ children = "Not given" }: { children?: ReactNode }) {
  return <span className="text-[12px] text-faint">{children}</span>;
}

/** One quiet line under a panel: where a statement comes from, or what it waits on. */
export function Note({ children, tone = "faint" }: { children: ReactNode; tone?: "faint" | "err" }) {
  return <p className={`max-w-[86ch] text-[11.5px] leading-[1.55] ${tone === "err" ? "text-err" : "text-faint"}`}>{children}</p>;
}

/** A link in running text. */
export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="focusable rounded-sm text-fg underline decoration-line-strong underline-offset-2 hover:decoration-fg">
      {children}
    </Link>
  );
}
