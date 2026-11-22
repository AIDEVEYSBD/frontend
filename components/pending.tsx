"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { DOORS, ask, type Answer, type Door, type DoorId } from "@/lib/api/pending";

/**
 * A screen whose address the platform has not built yet (lib/api/pending.ts).
 *
 * `useDoor` asks once and again on `reload`; `NotConnected` is what a panel
 * shows when the platform answers 501 "not built": what the panel is for,
 * that the platform does not do it yet, and the address it would call. It is
 * never a stand-in record.
 */

export function useDoor<T>(
  id: DoorId,
  opts: { params?: Record<string, string>; query?: Record<string, string | number | undefined>; skip?: boolean } = {},
): { answer: Answer<T> | null; reload: () => void } {
  const [answer, setAnswer] = useState<Answer<T> | null>(null);
  const [tick, setTick] = useState(0);
  const key = JSON.stringify([opts.params ?? {}, opts.query ?? {}]);
  useEffect(() => {
    if (opts.skip) return;
    let live = true;
    const [params, query] = JSON.parse(key) as [Record<string, string>, Record<string, string | number | undefined>];
    ask<T>(id, { params, query }).then((a) => {
      if (live) setAnswer(a);
    });
    return () => {
      live = false;
    };
  }, [id, key, tick, opts.skip]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { answer, reload };
}

/** What a panel shows while its door is not there. `door` is an id or the door itself (from a pending answer). */
export function NotConnected({ door, title, children, compact = false }: { door: DoorId | Door; title?: string; children?: ReactNode; compact?: boolean }) {
  const d: Door = typeof door === "string" ? DOORS[door] : door;
  return (
    <div className={`flex flex-col gap-1.5 rounded-lg border border-dashed border-line-strong bg-surface ${compact ? "px-4 py-3" : "px-6 py-8"}`} data-pending={d.path}>
      <span className="flex items-center gap-2">
        <span className="size-1.5 shrink-0 rounded-[2px] bg-faint" />
        <span className="text-[13px] font-semibold text-fg">{title ?? "Not built yet"}</span>
      </span>
      <p className="max-w-[64ch] text-[12.5px] leading-[1.55] text-dim">{children ?? `${d.purpose}.`}</p>
      <p className="text-[11.5px] leading-[1.5] text-faint">
        The platform answers{" "}
        <span className="font-mono text-[11px] text-dim">
          {d.method} {d.path}
        </span>{" "}
        with 501, not built. Nothing here is shown until it does.
      </p>
    </div>
  );
}

/** One line for a form or a field whose door is not there. */
export function NotConnectedNote({ door }: { door: DoorId | Door }) {
  const d: Door = typeof door === "string" ? DOORS[door] : door;
  return (
    <span className="text-[11.5px] leading-[1.5] text-faint" data-pending={d.path}>
      Not built yet: the platform answers 501 to{" "}
      <span className="font-mono text-[11px] text-dim">
        {d.method} {d.path}
      </span>
      .
    </span>
  );
}
