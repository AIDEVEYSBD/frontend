"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Banner } from "./overlays";
import { Tag } from "./ui";
import { api, type Schemas } from "@/lib/api/client";
import { hasRunFlags, inboundLine, runFlagLine, whenText, type CanaryAssignment, type RunFlags } from "@/lib/lifecycle";
import { jobLine } from "@/lib/queue";
import { runMarkersOf, shareText, type MarkedRun } from "@/lib/canary";

/** A canary arm in one line of data: the canary, the share, the other arm, or why a shadow could not mirror the run. */
function canaryLine(c: CanaryAssignment): string {
  const ver = (p: { version: number | null } | null) => (p ? `version ${p.version ?? "?"}` : "nothing deployed");
  if (c.variant === "candidate") return `Canary ${c.id}${c.share !== null ? ` · ${shareText(c.share)} of new starts` : ""} · production ${ver(c.production)}.`;
  if (c.mode === "shadow" && c.shadow_refused) return `Shadow ${c.id} could not mirror it: ${c.shadow_refused}.`;
  if (c.mode === "shadow") return `Mirrored by canary ${c.id}${!c.shadow_run && c.shadow_job ? ` (job ${c.shadow_job})` : ""}.`;
  return `Canary ${c.id} · candidate ${ver(c.candidate)}.`;
}

/**
 * A run's marks wherever runs are listed (phase L8, second round, from the
 * backend's RunRow): a shadow run (a canary's mirror, counted in no
 * production figure), the canary arm it ran on, a rollback's review flag,
 * untrusted input, an eval's case. Each says itself in its title.
 */
export function RunMarkers({ run }: { run: MarkedRun }) {
  const marks = runMarkersOf(run);
  if (!marks.length) return null;
  return (
    <span className="inline-flex shrink-0 flex-wrap items-center gap-1">
      {marks.map((m) => (
        <span key={m.kind} title={m.title} className="inline-flex">
          <Tag tone={m.tone}>{m.label}</Tag>
        </span>
      ))}
    </span>
  );
}

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
 *   out of production's windows;
 * - (L8, second round) a shadow run (`shadow: true`): a canary's candidate
 *   mirroring a production run, whose calls at or above write and calls
 *   that act outside were recorded, not made; and the canary arm a run used
 *   (`canary`).
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
      {flags.shadow && (
        <Banner tone="neutral" title="A shadow run: nothing at or above write was carried out">
          {flags.canary ? `${flags.canary.version !== null ? `Version ${flags.canary.version}` : "The candidate"}${flags.canary.id ? ` · canary ${flags.canary.id}` : ""}.` : null}
          {flags.canary?.of && (
            <>
              {" "}
              <Link href={`/runs?id=${encodeURIComponent(flags.canary.of)}`} className="focusable rounded-sm font-medium text-fg underline">
                The production run it mirrors
              </Link>
            </>
          )}
          {agent && (
            <>
              {flags.canary ? " · " : null}
              <Link href={`/lifecycle?agent=${encodeURIComponent(agent)}#canary`} className="focusable rounded-sm font-medium text-fg underline">
                The canary
              </Link>
            </>
          )}
        </Banner>
      )}
      {!flags.shadow && flags.canary && (
        <Banner tone="neutral" title={flags.canary.variant === "candidate" ? `Canary: version ${flags.canary.version ?? "?"} ran this` : "Production, beside a canary"}>
          {canaryLine(flags.canary)}
          {flags.canary.shadow_run && (
            <>
              {" "}
              <Link href={`/runs?id=${encodeURIComponent(flags.canary.shadow_run)}`} className="focusable rounded-sm font-medium text-fg underline">
                Its shadow run
              </Link>
            </>
          )}
        </Banner>
      )}
      {flags.review && (
        <Banner tone="warn" title={flags.review.flag === "rolled_back" ? "Flagged for review: its version was rolled back" : "Flagged for review"}>
          {flags.review.flag === "rolled_back"
            ? `Version ${flags.review.from.version ?? "?"} rolled back to ${flags.review.to.version ?? "?"} by ${flags.review.by || "someone"}${flags.review.at ? ` ${whenText(flags.review.at)}` : ""}${flags.review.reason ? `: ${flags.review.reason}` : ""}.`
            : runFlagLine(flags.review)}
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
          {flags.taint.kind === "a2a" ? `From an A2A task${flags.taint.from ? ` sent by ${flags.taint.from}` : ""} (taint ${flags.taint.source}).` : `Taint ${flags.taint.source}.`}
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
          .
        </Banner>
      )}
    </div>
  );
}
