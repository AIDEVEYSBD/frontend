"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Status, Tag } from "./ui";
import { Pick } from "./select";
import { soon } from "@/lib/soon";
import { listJobs, type JobList, type JobQuery, type JobView } from "@/lib/api/l2";
import { JOB_STATUSES, JOB_STATUS_META, canaryArmOf, taintOf } from "@/lib/queue";
import { whenText } from "@/lib/lifecycle";

/**
 * The trigger queue's jobs themselves (phase L8, second round: `GET
 * /api/queue/jobs`), under the queue's counts on the Control page: newest
 * first, by status and agent. A cancelled job says why (`cancel_reason`: its
 * A2A caller withdrew it, its agent was retired, its canary ended), never as
 * an error; a dead letter says it failed for good; a shadow job says which
 * production job it mirrors; a job claimed while a canary stood says which
 * arm it ran on; a job an A2A caller sent says its input is untrusted. Read
 * through the generated client (lib/api/l2.ts listJobs).
 */

const TONE: Record<string, "warn" | "run" | "ok" | "err" | "neutral"> = { warn: "warn", run: "run", ok: "ok", err: "err", neutral: "neutral" };

/** The jobs, newest first. Presentational, so tests render it from a captured list. */
export function JobsListView({ jobs }: { jobs: JobView[] }) {
  if (!jobs.length) return <p className="px-3 py-3 text-[11.5px] text-faint">No job matches.</p>;
  return (
    <ul className="flex flex-col">
      {jobs.map((j) => {
        const meta = JOB_STATUS_META[j.dead ? "dead" : j.status] ?? { label: j.status, tone: "neutral" };
        const arm = canaryArmOf(j);
        const taint = taintOf(j.taint);
        return (
          <li key={j.job} className="flex flex-col gap-0.5 border-b border-line px-3 py-1.5 text-[11px] last:border-b-0">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-fg">{j.agent}</span>
              {j.run_id ? (
                <Link href={`/runs?id=${encodeURIComponent(j.run_id)}`} className="focusable rounded-sm font-mono text-dim hover:underline">
                  {j.job.slice(0, 8)}
                </Link>
              ) : (
                <span className="font-mono text-ghost">{j.job.slice(0, 8)}</span>
              )}
              <Status tone={TONE[meta.tone] ?? "neutral"}>{meta.label}</Status>
              {j.shadow && <Tag tone="queue">shadow</Tag>}
              {!j.shadow && j.canary && <Tag tone={j.canary.variant === "candidate" ? "run" : "neutral"}>{j.canary.variant === "candidate" ? "canary" : "production arm"}</Tag>}
              {taint && <Tag tone="warn">untrusted input</Tag>}
              <span className="grow" />
              <span className="text-[10px] text-faint">{whenText(j.finished_at ?? j.created_at)}</span>
            </span>
            <span className="text-[10.5px] text-faint">
              from {j.source || "an unnamed source"} · attempt {j.attempts} of {j.max_attempts}
            </span>
            {j.status === "cancelled" && j.cancel_reason && <span className="text-[10.5px] text-dim">Withdrawn: {j.cancel_reason}</span>}
            {j.status !== "cancelled" && j.error && <span className={`text-[10.5px] ${j.dead ? "text-err" : "text-dim"}`}>{j.error}</span>}
            {arm && <span className="text-[10.5px] text-faint">{arm}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** The jobs list with its filters, re-read on each change and every `everyMs`. */
export function JobsList({ agents, everyMs = 8000 }: { agents: string[]; everyMs?: number }) {
  const [status, setStatus] = useState<string>("");
  const [agent, setAgent] = useState("");
  const [list, setList] = useState<JobList | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const q: JobQuery = { limit: 50 };
      if (status) q.status = status as JobQuery["status"];
      if (agent) q.agent = agent;
      setList(await listJobs(q));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [status, agent]);
  useEffect(() => soon(load), [load]);
  useEffect(() => {
    const id = setInterval(() => void load(), everyMs);
    return () => clearInterval(id);
  }, [load, everyMs]);
  return (
    <div className="flex flex-col border-t border-line">
      <div className="flex flex-wrap items-center gap-2 px-3 pt-2 pb-1.5">
        <span className="text-[10px] text-faint">jobs{list ? ` · ${list.count} shown` : ""}</span>
        <span className="grow" />
        <span className="flex items-center gap-0.5">
          {["", ...JOB_STATUSES].map((s) => (
            <button
              key={s || "all"}
              type="button"
              onClick={() => setStatus(s)}
              aria-pressed={status === s}
              title={s ? JOB_STATUS_META[s as keyof typeof JOB_STATUS_META]?.means : "every status"}
              className={`focusable cursor-pointer rounded-sm px-1.5 py-0.5 text-[10.5px] transition-colors ${status === s ? "bg-raise font-semibold text-fg" : "font-medium text-faint hover:text-dim"}`}
            >
              {s ? (JOB_STATUS_META[s as keyof typeof JOB_STATUS_META]?.label ?? s) : "all"}
            </button>
          ))}
        </span>
        {agents.length > 0 && (
          <div className="w-36">
            <Pick value={agent} onChange={setAgent} options={[{ value: "", label: "every agent" }, ...agents.map((a) => ({ value: a, label: a }))]} />
          </div>
        )}
      </div>
      {error && <p className="px-3 pb-2 text-[11px] text-err">{error}</p>}
      {list ? <JobsListView jobs={list.jobs} /> : !error && <p className="px-3 pb-2 text-[11px] text-faint">Reading the jobs…</p>}
    </div>
  );
}
