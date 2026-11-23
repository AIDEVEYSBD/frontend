"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Mono, Status, Tag, type Tone } from "./ui";
import { Failure } from "./pending";
import { ago } from "./identity-shared";
import { errorText } from "@/lib/api/client";
import { machineLine } from "@/lib/site";
import { useMachineOrigin } from "@/lib/use-session";

/**
 * What has arrived from outside, and the schedules (`GET /api/ingress`).
 *
 * Arrivals: the newest runs started by the trigger door (an API key), a
 * webhook, or a schedule, each with the run's status as the platform reads
 * it, who it was started as and the sending system's own name for itself.
 * Schedules: every deployed agent with a cron trigger, its next due time and
 * its last fires, a refused fire with the platform's reason. A schedule
 * fires only while a worker process runs; the answer says when none does.
 *
 * Above them, where outside systems post: the trigger and webhook doors
 * beneath the platform's own address (the session's machineOrigin), never
 * the console's, whose sign-in they cannot pass.
 */

type Arrival = {
  job: string;
  agent: string;
  status: "queued" | "running" | "done" | "failed" | "suspended" | "cancelled";
  source: string;
  door: "trigger" | "webhook" | "schedule";
  run_id: string;
  created_at: string;
  external_id: string | null;
  label: string | null;
  error: string | null;
  started_as: { kind: string; sub: string; name: string };
};

type Fire = {
  due_at: string;
  missed: number;
  outcome: "started" | "refused" | "claimed, not settled";
  started_as: string | null;
  run: string | null;
  refused_status: number | null;
  refused: string | null;
};

type Schedule = { agent: string; name: string; cron: string; next_due: string | null; seen: boolean; problem: string | null; fires: Fire[] };

type IngressView = { arrivals: Arrival[]; schedules: Schedule[]; workers_alive: number; clock: string };

const STATUS_TONE: Record<Arrival["status"], Tone> = { queued: "queue", running: "run", done: "ok", failed: "err", suspended: "warn", cancelled: "neutral" };
const DOOR_LABEL: Record<Arrival["door"], string> = { trigger: "API key", webhook: "webhook", schedule: "schedule" };
const SHOWN = 20;

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" }) + " UTC" : "";
}

export function IngressActivity() {
  const [view, setView] = useState<IngressView | null>(null);
  const [failed, setFailed] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const machine = useMachineOrigin();

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/ingress", { cache: "no-store" });
      const body = await r.json().catch(() => null);
      if (!r.ok || !body || !Array.isArray(body.arrivals)) {
        setFailed(errorText(body, r, "GET", "/api/ingress"));
        return;
      }
      setView(body as IngressView);
      setFailed("");
      setNow(Date.now());
    } catch (e) {
      setFailed(errorText((e as Error).message));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col border-t border-line bg-surface">
      <span className="flex items-center justify-between border-b border-line px-4 py-2">
        <span className="text-[10.5px] text-ghost">Arrived from outside</span>
        <Button size="sm" variant="solid" tone="neutral" loading={busy} onClick={() => void load()}>
          Read again
        </Button>
      </span>
      <div className="flex flex-col gap-1 border-b border-line px-4 py-2.5 text-[11.5px] leading-[1.55]">
        {machine ? (
          <>
            <span className="text-faint">Outside systems post to the platform&rsquo;s own address, outside the console&rsquo;s sign-in:</span>
            <span className="flex flex-wrap items-baseline gap-x-3">
              <Mono className="text-[11px] text-fg">POST {machine}/api/trigger/&lt;agent&gt;</Mono>
              <span className="text-faint">an agent started by an API call, with an API key bound to it</span>
            </span>
            <span className="flex flex-wrap items-baseline gap-x-3">
              <Mono className="text-[11px] text-fg">POST {machine}/api/webhooks/&lt;agent&gt;</Mono>
              <span className="text-faint">an agent started by a webhook, signed with the secret its trigger names, or with an API key</span>
            </span>
          </>
        ) : (
          <span className={machine === undefined ? "text-faint" : "text-warn"}>{machineLine(machine, "", "outside systems cannot reach the trigger and webhook doors")}</span>
        )}
      </div>
      {failed && (
        <div className="px-4 py-3">
          <Failure what="What has arrived could not be read" message={failed} />
        </div>
      )}
      {!view && !failed && <p className="px-4 py-3 text-[11.5px] text-faint">Reading what has arrived…</p>}
      {view && view.arrivals.length === 0 && (
        <p className="px-4 py-3 text-[11.5px] text-faint">No run has been started from outside: none by an API key, a webhook or a schedule.</p>
      )}
      {view && view.arrivals.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-[12px]">
            <thead>
              <tr className="border-b border-line text-[10.5px] text-faint">
                <th className="py-2 pr-3 pl-4 font-medium">Agent</th>
                <th className="px-3 py-2 font-medium">Came by</th>
                <th className="px-3 py-2 font-medium">Started as</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="py-2 pr-4 pl-3 font-medium">Arrived</th>
              </tr>
            </thead>
            <tbody>
              {view.arrivals.slice(0, SHOWN).map((a) => (
                <tr key={a.job} className="border-b border-line align-top last:border-0">
                  <td className="py-2 pr-3 pl-4">
                    <span className="flex flex-col">
                      <Link href={`/runs?id=${encodeURIComponent(a.run_id)}`} className="focusable rounded-sm text-fg underline">
                        {a.agent}
                      </Link>
                      <Mono className="text-[10.5px] text-faint">{a.job}</Mono>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-dim">
                    <span className="flex flex-col gap-0.5">
                      <span>
                        <Tag>{DOOR_LABEL[a.door]}</Tag>
                      </span>
                      {a.label && <span className="text-[11px] text-faint">sent by {a.label}</span>}
                      {a.external_id && <Mono className="text-[10.5px] text-faint">id {a.external_id}</Mono>}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-dim">{a.started_as.name}</td>
                  <td className="px-3 py-2">
                    <span className="flex flex-col gap-0.5">
                      <Status tone={STATUS_TONE[a.status] ?? "neutral"}>{a.status}</Status>
                      {a.error && <span className="max-w-[260px] text-[11px] leading-[1.4] text-err">{a.error}</span>}
                    </span>
                  </td>
                  <td className="tnum py-2 pr-4 pl-3 whitespace-nowrap text-dim" title={when(a.created_at)}>
                    {ago(a.created_at, now)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {view.arrivals.length > SHOWN && (
            <p className="border-t border-line px-4 py-2 text-[11px] text-faint">The newest {SHOWN} of the {view.arrivals.length} read are shown.</p>
          )}
        </div>
      )}

      <span className="border-y border-line px-4 py-2 text-[10.5px] text-ghost">Schedules</span>
      {view && (
        <p className={`border-b border-line px-4 py-2 text-[11.5px] leading-[1.5] ${view.workers_alive ? "text-faint" : "text-warn"}`}>{view.clock}</p>
      )}
      {view && view.schedules.length === 0 && (
        <p className="px-4 py-3 text-[11.5px] text-faint">No deployed agent has a cron trigger, so nothing starts on a schedule.</p>
      )}
      {view?.schedules.map((s) => (
        <div key={s.agent} className="flex flex-col gap-1.5 border-b border-line px-4 py-2.5 last:border-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] text-fg">{s.name}</span>
            <Mono className="text-[11px]">{s.cron}</Mono>
            {s.problem ? (
              <span className="text-[11px] text-err">{s.problem}</span>
            ) : (
              <span className="text-[11px] text-faint">
                next due {when(s.next_due)}
                {s.seen ? "" : " (worked out now: no worker's clock has seen this schedule yet)"}
              </span>
            )}
          </span>
          {s.fires.length === 0 && <span className="text-[11px] text-faint">It has not fired yet.</span>}
          {s.fires.map((f) => (
            <span key={f.due_at} className="flex flex-wrap items-baseline gap-2 text-[11px]">
              <span className="tnum text-dim">{when(f.due_at)}</span>
              {f.outcome === "started" && f.run && (
                <Link href={`/runs?id=${encodeURIComponent(f.run)}`} className="focusable rounded-sm text-fg underline">
                  started as {f.started_as}
                </Link>
              )}
              {f.outcome === "refused" && (
                <span className="text-err">
                  refused ({f.refused_status}): {f.refused}
                </span>
              )}
              {f.outcome === "claimed, not settled" && <span className="text-warn">claimed, and the process stopped before it started a run</span>}
              {f.missed > 0 && <span className="text-faint">({f.missed} earlier due {f.missed === 1 ? "time" : "times"} passed while no worker ran)</span>}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
