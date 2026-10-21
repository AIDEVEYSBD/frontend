"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Banner } from "./overlays";
import { api, type Schemas } from "@/lib/api/client";
import { hasRunFlags, inboundLine, runFlagLine, type RunFlags } from "@/lib/lifecycle";
import { jobLine, taintLine } from "@/lib/queue";

/**
 * What a run's record says about it beyond its journal (phase L8), above
 * the transcript:
 *
 * - a rollback's flag (`review: {flag: "rolled_back", from, to, reason, by,
 *   at}`): the run is of a version someone rolled back from, and wants a
 *   person's review;
 * - the taint of its input (`taint: {source, input}`): an A2A task's text,
 *   untrusted, with the message the task brought in as the journal records
 *   it, and the job it ran for (`GET /api/trigger/{agent}/jobs/{job}`: its
 *   source, attempts, and its own `taint`);
 * - the eval it is a case of (`eval: {id, case, set}`), which drift leaves
 *   out of production's windows.
 */
export function RunFlagsBanner({ flags, agent }: { flags: RunFlags; agent: string }) {
  const [job, setJob] = useState<Schemas["JobView"] | null>(null);
  useEffect(() => {
    if (!flags.job || !agent || !flags.taint) return;
    let stop = false;
    api
      .GET("/api/trigger/{agent}/jobs/{job_id}", { params: { path: { agent, job_id: flags.job } } })
      .then(({ data }) => {
        if (!stop && data) setJob(data);
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [flags.job, flags.taint, agent]);

  if (!hasRunFlags(flags)) return null;
  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-line bg-canvas px-4 py-2.5">
      {flags.review && (
        <Banner tone="warn" title={flags.review.flag === "rolled_back" ? "Flagged for review: its version was rolled back" : "Flagged for review"}>
          {runFlagLine(flags.review)}
          {agent && (
            <>
              {" "}
              <Link href={`/lifecycle?agent=${encodeURIComponent(agent)}#deployments`} className="focusable rounded-sm font-medium text-fg underline">
                The deployments
              </Link>
            </>
          )}
        </Banner>
      )}
      {flags.taint && (
        <Banner tone="warn" title="Untrusted input">
          {taintLine(flags.taint)}
          {flags.inbound && <span className="mt-0.5 block font-mono text-[11px] text-faint">{inboundLine(flags.inbound)}</span>}
          {job && <span className="mt-0.5 block font-mono text-[11px] text-faint">Job {job.job}: {jobLine(job)}</span>}
        </Banner>
      )}
      {flags.eval && (
        <Banner tone="neutral" title={`A case of eval ${flags.eval.id}`}>
          Case <span className="font-mono">{flags.eval.case}</span> of the set{" "}
          <Link href={`/evals?set=${encodeURIComponent(flags.eval.set)}`} className="focusable rounded-sm font-mono text-fg underline">
            {flags.eval.set}
          </Link>
          , run by the backend&rsquo;s eval runner. Drift leaves an eval&rsquo;s runs out of production&rsquo;s windows.
        </Banner>
      )}
    </div>
  );
}
