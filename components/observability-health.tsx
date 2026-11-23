"use client";
import { Failure } from "./pending";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Status, Tag } from "./ui";
import { Figures, Section } from "./section";
import { GroupHeader } from "./page-tabs";
import { Pick } from "./select";
import { soon } from "@/lib/soon";
import { whenText } from "@/lib/lifecycle";
import { getHealth, type Latency, type PlatformHealth } from "@/lib/api/assurance";

/**
 * Platform health, counted by the platform from its own records when asked
 * (`GET /api/observability/health`): runs that failed, the queue, model and
 * tool calls with their error rates and latency, breakers open, agents held,
 * the lockdown, the attention queue, and where telemetry is sent. A rate or a
 * latency with nothing to count says so instead of showing a number. Each
 * dependency is checked only on request, since the model endpoint and
 * embeddings checks make a real model call. Read on request, never polled.
 */

const WINDOWS = [
  { value: "1", label: "Last hour" },
  { value: "24", label: "Last 24 hours" },
  { value: "168", label: "Last 7 days" },
  { value: "720", label: "Last 30 days" },
];

const unknown = (why: string | null) => (
  <span className="text-[12px] font-normal text-faint" title={why ?? undefined}>
    unknown
  </span>
);

const rate = (r: number | null, why: string | null) => (r === null ? unknown(why) : `${(r * 100).toFixed(r < 0.1 ? 1 : 0)}%`);
const ms = (v: number | null, l: Latency) => (v === null ? unknown(l.why) : `${v} ms`);

function Why({ items }: { items: (string | null)[] }) {
  const said = items.filter((x): x is string => Boolean(x));
  if (!said.length) return null;
  return <p className="text-[11px] leading-[1.5] text-faint">{said.map((s) => `${s.charAt(0).toUpperCase()}${s.slice(1)}.`).join(" ")}</p>;
}

/** Every figure of one answer. Presentational. */
export function HealthView({ h }: { h: PlatformHealth }) {
  const m = h.model_calls;
  const t = h.tool_calls;
  const q = h.queue;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11px] text-faint">
        Counted from {whenText(h.window.from)} to {whenText(h.window.to)}.
      </p>
      <Section title="Runs" meta="ended in the window, and in flight now">
        <Figures
          items={[
            { k: "failed", v: h.runs.failed },
            { k: "stopped", v: h.runs.killed },
            { k: "done", v: h.runs.done },
            { k: "running now", v: h.runs.running_now },
            { k: "waiting for a person now", v: h.runs.waiting_now },
          ]}
        />
        {h.runs.latest_failures.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {h.runs.latest_failures.map((f) => (
              <li key={f.run} className="flex flex-wrap items-baseline gap-2 text-[11.5px]">
                <span className="whitespace-nowrap text-faint">{whenText(f.at)}</span>
                <Link href={`/runs?id=${encodeURIComponent(f.run)}`} className="focusable rounded-sm font-mono text-[10.5px] text-dim hover:underline">
                  {f.run}
                </Link>
                <span className="text-fg">{f.agent}</span>
                <span className="min-w-0 break-words text-err">{f.error}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-faint">No run failed in the window.</p>
        )}
      </Section>
      <Section title="Queue and workers" meta="now">
        <Figures
          items={[
            { k: "waiting to be taken", v: q.due },
            { k: "oldest waiting", v: q.oldest_due_waiting_s === null ? unknown(q.why_no_wait) : `${Math.round(q.oldest_due_waiting_s)} s` },
            { k: "held by a worker", v: q.claimed },
            { k: "lease lapsed", v: q.lease_lapsed },
            { k: "given up in the window", v: q.failed_in_window },
            { k: "live worker processes", v: h.workers.live.length },
          ]}
        />
        <Why items={[q.oldest_due_waiting_s === null ? q.why_no_wait : null, h.workers.live.length ? null : `no worker process renewed its heartbeat in the last ${h.workers.within_s} seconds, so nothing takes queued work`]} />
      </Section>
      <Section title="Model calls" meta="started, answered and failed, from the run journals">
        <Figures
          items={[
            { k: "started", v: m.started },
            { k: "answered", v: m.answered },
            { k: "failed", v: m.failed },
            { k: "no answer recorded", v: m.unanswered },
            { k: "error rate", v: rate(m.error_rate, m.why_no_rate) },
            { k: "p50", v: ms(m.latency.p50_ms, m.latency) },
            { k: "p95", v: ms(m.latency.p95_ms, m.latency) },
          ]}
        />
        <Why items={[m.why_no_rate, m.latency.why]} />
      </Section>
      <Section title="Tool calls" meta="each paired with its outcome through the entry it cites">
        <Figures
          items={[
            { k: "called", v: t.called },
            { k: "returned", v: t.returned },
            { k: "refused", v: t.refused },
            { k: "failed", v: t.failed },
            { k: "no outcome recorded", v: t.open },
            { k: "error rate", v: rate(t.error_rate, t.why_no_rate) },
            { k: "p50", v: ms(t.latency.p50_ms, t.latency) },
            { k: "p95", v: ms(t.latency.p95_ms, t.latency) },
          ]}
        />
        <Why items={[t.why_no_rate, t.latency.why]} />
      </Section>
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section title="Controls" meta="breakers, held agents and the lockdown, now">
          <div className="flex flex-col gap-1.5 text-[11.5px]">
            {h.controls.lockdown ? (
              <p className="text-err">
                The estate is locked down: {h.controls.lockdown.reason} (by {h.controls.lockdown.by}, {whenText(h.controls.lockdown.at)}).
              </p>
            ) : (
              <p className="text-faint">The estate is not locked down.</p>
            )}
            {h.controls.breakers_open.length ? (
              h.controls.breakers_open.map((b) => (
                <p key={b.tool} className="text-dim">
                  <Status tone="err">breaker open</Status> {b.tool}, until {whenText(b.until)}
                </p>
              ))
            ) : (
              <p className="text-faint">No breaker is open.</p>
            )}
            {h.controls.agents_held.length ? (
              h.controls.agents_held.map((a) => (
                <p key={a.agent} className="text-dim">
                  <Tag tone="warn">{a.mode === "drain" ? "draining" : "paused"}</Tag> {a.agent}: {a.reason} (by {a.by})
                </p>
              ))
            ) : (
              <p className="text-faint">No agent is paused or draining.</p>
            )}
          </div>
        </Section>
        <Section title="Alerts" meta={`${h.alerts.count} waiting for a person`}>
          {h.alerts.items.length ? (
            <ul className="flex flex-col gap-1 text-[11.5px]">
              {h.alerts.items.slice(0, 12).map((a) => (
                <li key={a.id} className="flex flex-wrap items-baseline gap-2">
                  <Tag tone={a.severity >= 8 ? "err" : a.severity >= 5 ? "warn" : "neutral"}>{a.kind}</Tag>
                  <span className="text-fg">{a.title}</span>
                  <span className="min-w-0 break-words text-faint">{a.detail}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-faint">Nothing is waiting for a person.</p>
          )}
          <p className="text-[11px] text-faint">
            From {h.alerts.source}
            {h.alerts.not_built.length ? `; not built there: ${h.alerts.not_built.join(", ")}` : ""}.{" "}
            <Link href="/control" className="focusable rounded-sm underline">
              Control room
            </Link>
          </p>
        </Section>
      </div>
      <Section title="Telemetry" meta="what leaves the service">
        <div className="flex flex-col gap-1 text-[11.5px] leading-[1.5]">
          <p className={h.telemetry.traces.configured ? "text-dim" : "text-faint"}>
            Traces: {h.telemetry.traces.configured ? `sent on request to ${h.telemetry.traces.destination}` : h.telemetry.traces.reason}.
          </p>
          <p className={h.telemetry.logs.configured ? "text-dim" : "text-faint"}>
            Logs:{" "}
            {h.telemetry.logs.configured
              ? `the audit trail is forwarded to ${h.telemetry.logs.destination}; through row ${h.telemetry.logs.forwarded_through ?? "none"}, ${h.telemetry.logs.behind ?? "an unknown number of"} behind${h.telemetry.logs.last_at ? `, last sent ${whenText(h.telemetry.logs.last_at)}` : ""}`
              : h.telemetry.logs.reason}
            .
          </p>
          {h.telemetry.logs.last_error && <p className="text-err">The last forwarding failed: {h.telemetry.logs.last_error}</p>}
          {h.telemetry.not_shown && <p className="text-faint">{`${h.telemetry.not_shown.charAt(0).toUpperCase()}${h.telemetry.not_shown.slice(1)}.`}</p>}
        </div>
      </Section>
    </div>
  );
}

/** Each dependency's own check, as answered. Presentational. */
function Dependencies({ h }: { h: PlatformHealth }) {
  if (!h.dependencies.checked) return <p className="text-[12px] text-faint">{h.dependencies.why ? `Not checked: ${h.dependencies.why}.` : "Not checked."}</p>;
  return (
    <ul className="flex flex-col gap-1 text-[11.5px]">
      {h.dependencies.ports.map((p) => (
        <li key={p.port} className="flex flex-wrap items-baseline gap-2">
          <Status tone={p.ok === true ? "ok" : p.ok === false ? "err" : "warn"}>{p.port}</Status>
          <span className="text-faint">{p.implementation}</span>
          <span className={`min-w-0 break-words ${p.ok === false || !p.ran ? "text-err" : "text-dim"}`}>{p.ran ? p.detail : `the check could not be made: ${p.detail}`}</span>
        </li>
      ))}
    </ul>
  );
}

function HealthPage() {
  const [hours, setHours] = useState("24");
  const [health, setHealth] = useState<PlatformHealth | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const read = useCallback(
    (dependencies: boolean) => {
      (dependencies ? setChecking : setBusy)(true);
      getHealth({ hours: Number(hours), dependencies })
        .then((h) => {
          setHealth(h);
          setError("");
        })
        .catch((e) => setError((e as Error).message))
        .finally(() => (dependencies ? setChecking : setBusy)(false));
    },
    [hours],
  );
  useEffect(() => soon(() => read(false)), [read]);
  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7">
      <GroupHeader
        group="resilience"
        tab="health"
        actions={
          <span className="flex items-center gap-2">
            <span className="w-[170px]">
              <Pick aria-label="Window" value={hours} onChange={setHours} options={WINDOWS} />
            </span>
            <Button size="sm" variant="solid" tone="neutral" loading={busy} onClick={() => read(false)}>
              Count again
            </Button>
          </span>
        }
      >
        Failures, the queue, model and tool calls, the controls holding work back and what waits for a person, counted by the platform from its own records when you ask.
      </GroupHeader>
      {error && <Failure what="Platform health could not be read" message={error} />}
      {health ? <HealthView h={health} /> : !error && <p className="text-[12px] text-faint">Counting…</p>}
      <Section
        title="Dependencies"
        meta="each checked now, on request"
        action={
          <Button size="sm" variant="solid" tone="neutral" loading={checking} onClick={() => read(true)}>
            Check each dependency
          </Button>
        }
      >
        {health ? <Dependencies h={health} /> : <p className="text-[12px] text-faint">{error ? "Not read." : "Reading…"}</p>}
      </Section>
    </div>
  );
}

export function PlatformHealthView() {
  return (
    <Suspense>
      <HealthPage />
    </Suspense>
  );
}
