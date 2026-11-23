"use client";

import { useEffect, useState } from "react";
import { Tag } from "./ui";
import { useNow } from "./gate-form";
import type { RateLimit } from "@/lib/api/l7";
import { rateLimitText, retryAt, secondsLeft, waitText } from "@/lib/rate-limit";

/**
 * A start the platform refused for a rate limit (429): whose limit ruled
 * (the agent's own, or the tree's: everything one trace set off in the
 * minute), which limit, the figures, and a countdown to when the work may
 * be started again. Shown where the work was started. `said` is the
 * platform's own sentence, shown in place of the one built from the
 * figures, with the countdown after it.
 */
export function RateLimitNote({ limit, readAt, said = "" }: { limit: RateLimit; readAt: number; said?: string }) {
  const now = useNow();
  const left = secondsLeft(retryAt(limit, readAt), now);
  return (
    <div role="alert" className="relative flex flex-wrap items-center gap-x-2.5 gap-y-1 overflow-hidden rounded-md border border-warn-line bg-warn-bg/40 px-3 py-2 pl-4">
      <span className="absolute inset-y-0 left-0 w-[3px] bg-warn" aria-hidden />
      <Tag tone="warn" solid>
        {limit.scope === "tree" ? "tree limit" : "agent limit"}
      </Tag>
      <span className="min-w-0 grow text-[12px] leading-[1.5] text-fg">{said ? `${said} ${left > 0 ? `${waitText(left)} left.` : "It can be started again now."}` : rateLimitText(limit, readAt, now)}</span>
      {left === 0 && <span className="text-[11px] font-medium text-ok">ready</span>}
    </div>
  );
}

/** Whether the countdown has run out, for a start button held until then. It ticks only while there is a limit to count down. */
export function useRetryReady(limit: RateLimit | null, readAt: number): { ready: boolean; left: number } {
  const until = limit ? retryAt(limit, readAt) : 0;
  const [now, setNow] = useState(readAt);
  useEffect(() => {
    if (!until) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [until]);
  if (!limit) return { ready: true, left: 0 };
  const left = secondsLeft(until, Math.max(now, readAt));
  return { ready: left === 0, left };
}
