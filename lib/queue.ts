import type { Schemas } from "./api/client";

/**
 * The trigger queue's statuses as the queue views read them (the Control
 * page's queue panel, the Ingress panel on Configuration). Phase L7 (second
 * round) added `cancelled`: a queued job its A2A caller withdrew with
 * `tasks/cancel` (the caller itself, or the kill of the caller's run, which
 * cancels every task the run handed on), finished without ever running. A
 * job dead-lettered by its parent's kill is `failed` and dead, never
 * `cancelled`. Pure: tests/l7b-logic.test.ts holds it.
 */

export type JobStatus = Schemas["JobView"]["status"];

/** Every status a job can hold, in the order a reader scans: what waits, what runs, what ended. */
export const JOB_STATUSES: JobStatus[] = ["queued", "running", "suspended", "done", "failed", "cancelled"];

export type QueueTone = "warn" | "run" | "ok" | "err" | "neutral";

export const JOB_STATUS_META: Record<JobStatus | "dead", { label: string; tone: QueueTone; means: string }> = {
  queued: { label: "queued", tone: "warn", means: "waiting for a worker to claim it" },
  running: { label: "running", tone: "run", means: "a worker holds its lease and is running it" },
  suspended: { label: "at a gate", tone: "warn", means: "its run waits for a person; the job is finished" },
  done: { label: "done", tone: "ok", means: "its run finished" },
  failed: { label: "failed", tone: "err", means: "its run failed, or every attempt did" },
  cancelled: { label: "cancelled", tone: "neutral", means: "withdrawn over A2A by the caller that sent it, before a worker claimed it; it never ran" },
  dead: { label: "dead letters", tone: "err", means: "failed for good, or dead-lettered by its parent run's kill; a person may replay it" },
};

/** The count of one status for one agent's row, 0 when the backend left it out (an older backend has no `cancelled`). */
export const countOf = (row: Partial<Record<string, unknown>> | undefined, status: string): number => {
  const n = row?.[status];
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
};

/**
 * The queue across every agent, status by status, in reading order: the
 * known statuses first, then any count a newer backend adds. A status at
 * zero is kept when `all` is set, so the view's columns hold still.
 */
export function queueTotals(agents: Record<string, Partial<Record<string, unknown>>>, all = false): { status: string; label: string; tone: QueueTone; count: number }[] {
  const totals = new Map<string, number>();
  for (const row of Object.values(agents)) {
    for (const [k, v] of Object.entries(row ?? {})) {
      if (typeof v === "number" && Number.isFinite(v)) totals.set(k, (totals.get(k) ?? 0) + v);
    }
  }
  const known: string[] = [...JOB_STATUSES, "dead"];
  const order = [...known, ...[...totals.keys()].filter((k) => !known.includes(k)).sort()];
  return order
    .filter((s) => (all && known.includes(s)) || (totals.get(s) ?? 0) > 0)
    .map((s) => {
      const meta = JOB_STATUS_META[s as JobStatus | "dead"];
      return { status: s, label: meta?.label ?? s.replace(/_/g, " "), tone: meta?.tone ?? "neutral", count: totals.get(s) ?? 0 };
    });
}
