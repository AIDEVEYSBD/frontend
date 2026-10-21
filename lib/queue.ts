import type { Schemas } from "./api/client";

/**
 * The trigger queue's statuses as the queue views read them (the Control
 * page's queue panel, the Ingress panel on Configuration). Phase L7 (second
 * round) added `cancelled`: a queued job its A2A caller withdrew with
 * `tasks/cancel` (the caller itself, or the kill of the caller's run, which
 * cancels every task the run handed on), finished without ever running. A
 * job dead-lettered by its parent's kill is `failed` and dead, never
 * `cancelled`. Phase L8: a retirement cancels the agent's queued jobs too,
 * and a cancelled job's reason is `cancel_reason`, never `error`; a job an
 * A2A caller sent carries `taint` (`a2a:<caller>`): its input is outside
 * text, and only a worker that applies the taint runs it. Pure:
 * tests/l7b-logic.test.ts and tests/l8-logic.test.ts hold it.
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
  cancelled: { label: "cancelled", tone: "neutral", means: "withdrawn before a worker claimed it, so it never ran: by the A2A caller that sent it, or because its agent was retired (the job's cancel_reason says which)" },
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

/* ═══════════════════ one job (L8: its taint and its cancel's reason) ═══════════════════ */

/** A taint as the backend names it: `a2a:<caller>`, the source of a job's input (or a run's). */
export interface Taint {
  /** As named: `a2a:vendor-bot`. */
  source: string;
  /** The kind of source before the colon (`a2a`), or the whole name when it has none. */
  kind: string;
  /** Who it came from: the caller after the colon, or "". */
  from: string;
}

/** A taint's parts, or null for none. */
export function taintOf(source: string | null | undefined): Taint | null {
  const t = (source ?? "").trim();
  if (!t) return null;
  const i = t.indexOf(":");
  return i === -1 ? { source: t, kind: t, from: "" } : { source: t, kind: t.slice(0, i), from: t.slice(i + 1) };
}

/** A taint in a person's words: what the input is, and what holds it. */
export function taintLine(t: Taint): string {
  if (t.kind === "a2a") return `Untrusted input: an A2A task${t.from ? ` sent by ${t.from}` : ""} (taint ${t.source}). Its input is marked tainted, so a sink it reaches is gated as any outside text is.`;
  return `Untrusted input (taint ${t.source}): a sink it reaches is gated as any outside text is.`;
}

/** One job in a line: its status, then why it was withdrawn, why it failed, or what its input is. */
export function jobLine(job: Pick<Schemas["JobView"], "status" | "source" | "attempts" | "max_attempts" | "error" | "dead"> & { cancel_reason?: string | null; taint?: string | null }): string {
  const meta = JOB_STATUS_META[job.dead ? "dead" : job.status];
  const parts = [`${meta?.label ?? job.status}`, `from ${job.source || "an unnamed source"}`, `attempt ${job.attempts} of ${job.max_attempts}`];
  if (job.status === "cancelled" && job.cancel_reason) parts.push(`withdrawn: ${job.cancel_reason}`);
  else if (job.error) parts.push(job.error);
  const t = taintOf(job.taint);
  if (t) parts.push(t.kind === "a2a" ? `untrusted input from ${t.from || t.source}` : `tainted (${t.source})`);
  return parts.join(" · ");
}
