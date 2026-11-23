"use client";
import { Failure } from "./pending";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Mono, Status, Tag } from "./ui";
import { GroupHeader } from "./page-tabs";
import { RunSourceTag } from "./run-source";
import { useNow } from "./gate-form";
import { hueFor } from "@/lib/hue";
import { soon } from "@/lib/soon";
import { looksLikeRecordId } from "@/lib/api/l5";
import { closeBreaker, getBreakers, type BreakerOpening, type BreakerOpeningMore, type BreakersRead } from "@/lib/api/l7b";
import { breakerTarget, closesText, endedText, openBreakers, openingLine, spanText, thresholdsLine, whyText, type OpenBreaker } from "@/lib/breakers";

/**
 * The estate's breakers (`GET /api/breakers`, agentfactory/control/breakers.py):
 * breakers on the tools that act outside, across every run on every worker.
 * A tool whose calls fail too many times in a row, or that is called too
 * often across the estate within the window, is cut off for the cooldown:
 * every run is refused a call of it until then. After a cooldown that ran
 * out on its own, the first call is a probe, and a failure there opens it
 * again at once.
 *
 * The view: what is open now, each with the opening behind it and when it
 * closes on its own; the thresholds every breaker is judged by, which are
 * the deployment's settings (changing them by policy is not built); and the
 * newest openings, how each ended. Closing one by hand (`DELETE
 * /api/breakers/{name}`) needs the configure permission and is on the audit
 * trail; a viewer reads all of it.
 */

const WHY_TONE: Record<string, "err" | "warn"> = { calls: "warn", failures: "err", probe: "err" };

function RunLink({ run }: { run: string }) {
  if (!run) return <span className="text-ghost">—</span>;
  return looksLikeRecordId(run) ? (
    <Link href={`/runs?id=${encodeURIComponent(run)}`} className="focusable min-w-0 truncate rounded-sm font-mono text-[10.5px] text-dim hover:underline">
      {run}
    </Link>
  ) : (
    <Mono className="min-w-0 truncate text-[10.5px] text-faint">{run}</Mono>
  );
}

function TargetTag({ name }: { name: string }) {
  const t = breakerTarget(name);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <Tag tone={t.kind === "peer" ? "run" : "neutral"}>{t.kind === "peer" ? "peer" : "tool"}</Tag>
      {t.kind === "peer" ? (
        <Link href={`/configuration#peer-${encodeURIComponent(t.label)}`} className="focusable min-w-0 truncate rounded-sm font-mono text-[12px] font-semibold text-fg hover:underline" title={`${t.label} in the peer registry`}>
          {t.label}
        </Link>
      ) : (
        <Mono className="min-w-0 truncate text-[12px] font-semibold text-fg">{t.label}</Mono>
      )}
    </span>
  );
}

/** One breaker open now: what it guards, why it opened, when it closes on its own, and the close by hand. */
export function OpenBreakerRow({ breaker: b, now, onClosed, onRefresh }: { breaker: OpenBreaker; now: number; onClosed: (name: string) => void; onRefresh: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const o = b.opening;
  const close = async () => {
    setBusy(true);
    setError("");
    try {
      await closeBreaker(b.name);
      setConfirming(false);
      onClosed(b.name);
    } catch (e) {
      setError((e as Error).message);
      // Closed elsewhere, or on its own (404): read the view again.
      onRefresh();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="relative flex flex-col gap-2 border-b border-line bg-err-bg/30 px-4 py-3 last:border-0">
      <span className="absolute inset-y-0 left-0 w-[3px] bg-err" aria-hidden />
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        <TargetTag name={b.name} />
        <Tag tone="err" solid>
          Open
        </Tag>
        {o && (
          <span title={o.why} className="inline-flex">
            <Tag tone={WHY_TONE[o.why] ?? "warn"}>{whyText(o.why)}</Tag>
          </span>
        )}
        <span className="tnum font-mono text-[10.5px] text-faint" title={`until ${b.until}`}>
          {closesText(b.until, now)}
        </span>
        <span className="grow" />
        {confirming ? (
          <span className="inline-flex items-center gap-1.5">
            <Button size="sm" variant="solid" tone="ink" permission="configure" loading={busy} onClick={close}>
              Close now
            </Button>
            <Button size="sm" variant="solid" tone="neutral" onClick={() => setConfirming(false)}>
              Keep it open
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="solid" tone="ink" permission="configure" onClick={() => setConfirming(true)}>
            Close by hand
          </Button>
        )}
      </div>
      {confirming && (
        <span className="-mt-0.5 self-end text-[11px] text-warn">Every run may call it again at once; it opens again when its calls or failures pass the thresholds.</span>
      )}
      {o ? (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-dim">
          <span>{openingLine(o)}.</span>
          <span className="text-faint">Seen on</span>
          <RunLink run={o.run} />
          {o.agent && <span className="text-faint">of {o.agent}</span>}
          {o.source && <RunSourceTag run={{ source: o.source }} />}
        </span>
      ) : (
        <span className="text-[11px] text-faint">Open, but the opening behind it is not among the openings listed.</span>
      )}
      {error && (<span className="text-[11.5px] text-err">{error}</span>)}
    </div>
  );
}

/** The recent openings, newest first, and how each ended. */
export function OpeningsTable({ openings, now }: { openings: (BreakerOpening & Partial<BreakerOpeningMore>)[]; now: number }) {
  if (!openings.length) return <p className="px-4 py-3 text-[11.5px] text-faint">No breaker has opened on this estate.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-[11.5px]">
        <thead>
          <tr className="border-b border-line text-left text-[10.5px] text-faint">
            <th className="px-4 py-2 font-medium">Breaker</th>
            <th className="px-3 py-2 font-medium">Why</th>
            <th className="px-3 py-2 font-medium">Opened</th>
            <th className="px-3 py-2 font-medium">Ended</th>
            <th className="px-3 py-2 font-medium">Seen on</th>
          </tr>
        </thead>
        <tbody>
          {openings.map((o) => (
            <tr key={`${o.name}@${o.opened_at}`} className="border-b border-line align-top last:border-0">
              <td className="px-4 py-2">
                <TargetTag name={o.name} />
              </td>
              <td
                className="min-w-[200px] px-3 py-2"
                title={`Judged by: ${o.calls ? `${o.calls} calls in ${spanText(o.window_s)}` : "calls off"}; ${o.failures ? `${o.failures} failures in a row` : "failures off"}; open ${spanText(o.cooldown_s)}`}
              >
                <span className="flex flex-col gap-0.5">
                  <span className={o.why === "calls" ? "text-warn" : "text-err"}>{whyText(o.why)}</span>
                  <span className="text-[10.5px] text-faint">{openingLine(o)}</span>
                </span>
              </td>
              <td className="tnum px-3 py-2 font-mono text-[10.5px] whitespace-nowrap text-dim">{o.opened_at.replace("T", " ").replace(/Z$/, " UTC")}</td>
              <td className="px-3 py-2">{o.open ? <Status tone="err">{closesText(o.until, now)}</Status> : <span className="text-[11px] text-faint">{endedText(o, now)}</span>}</td>
              <td className="px-3 py-2">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <RunLink run={o.run} />
                  <span className="text-[10.5px] text-faint">
                    {o.agent || "—"}
                    {o.source ? ` · ${o.source}` : ""}
                  </span>
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The view's body, from one read: presentational, so tests render it from a captured view. */
export function BreakersBody({ view, now, onClosed, onRefresh }: { view: BreakersRead; now: number; onClosed: (name: string) => void; onRefresh: () => void }) {
  const open = openBreakers(view);
  const t = view.thresholds;
  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-4">
        <section className="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
          <div data-hue={hueFor("breaker refusals")} className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/55 px-4 py-2.5">
            <span className="text-[12px] font-semibold">Open now</span>
            <span className="text-[11px] text-faint">{open.length ? `${open.length} open: every run is refused a call of ${open.length === 1 ? "it" : "each"} until it closes` : "none: every tool may be called"}</span>
          </div>
          {open.map((b) => (
            <OpenBreakerRow key={b.name} breaker={b} now={now} onClosed={onClosed} onRefresh={onRefresh} />
          ))}
          {open.length === 0 && <p className="px-4 py-3 text-[11.5px] text-faint">No estate breaker is open.</p>}
        </section>
        <section className="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
          <div data-hue={hueFor("activity")} className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/55 px-4 py-2.5">
            <span className="text-[12px] font-semibold">Recent openings</span>
            <span className="text-[11px] text-faint">{view.openings.length ? `newest first; the ${view.openings.length} most recent${view.truncated ? ", older ones not listed" : ""}` : "newest first"}</span>
          </div>
          <OpeningsTable openings={view.openings} now={now} />
        </section>
      </div>
      <section className="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
        <div data-hue={hueFor("control thresholds")} className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/55 px-4 py-2.5">
          <span className="text-[12px] font-semibold">Thresholds</span>
        </div>
        <div className="grid grid-cols-2 gap-px bg-line">
          {[
            { k: "Calls in the window", v: t.calls ? String(t.calls) : "off" },
            { k: "Window", v: spanText(t.window_s) },
            { k: "Failures in a row", v: t.failures ? String(t.failures) : "off" },
            { k: "Open for", v: spanText(t.cooldown_s) },
          ].map((f) => (
            <div key={f.k} className="flex flex-col gap-0.5 bg-surface px-4 py-2.5">
              <span className="text-[10.5px] text-ghost">{f.k}</span>
              <span className="tnum text-[16px] leading-none font-semibold text-fg">{f.v}</span>
            </div>
          ))}
        </div>
        <p className="border-t border-line px-4 py-2.5 text-[11.5px] leading-[1.55] text-dim">{thresholdsLine(t)}</p>
        <p className="border-t border-line px-4 py-2.5 text-[11px] leading-[1.55] text-faint">
          Counted per tool that acts outside, by its name, across every run on every worker. A refusal (by policy, the host, the allow list or the vault) is never a failure and is not counted. The deployment sets these:{" "}
          <Mono className="text-[10.5px]">BREAKER_FAILURES</Mono>, <Mono className="text-[10.5px]">BREAKER_CALLS</Mono>, <Mono className="text-[10.5px]">BREAKER_WINDOW_SECONDS</Mono> and{" "}
          <Mono className="text-[10.5px]">BREAKER_COOLDOWN_SECONDS</Mono>; 0 turns a rule off, and a cooldown of 0 turns breakers off. Changing them by policy is not built: it is a later phase.
        </p>
      </section>
    </div>
  );
}


export function Breakers() {
  const now = useNow();
  const [view, setView] = useState<BreakersRead | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(() => {
    getBreakers()
      .then((v) => {
        setView(v);
        setError("");
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => {
    const cancel = soon(load);
    const id = setInterval(load, 5000);
    return () => {
      cancel();
      clearInterval(id);
    };
  }, [load]);
  const open = view ? Object.keys(view.open).length : 0;
  return (
    <div className="mx-auto w-full max-w-[1520px] px-5 py-7" data-hue="red">
      <GroupHeader group="resilience" tab="breakers" meta={view && <Status tone={open ? "err" : "ok"}>{open ? `${open} open` : "none open"}</Status>}>
        Breakers on the tools that act outside, across every run: a tool whose calls fail too many times in a row, or that is called too often across the estate within the window, is cut off
        for its cooldown, and every run is refused a call of it until then. After the cooldown the first call is a probe, and a failure opens the breaker again at once. A person with the configure
        permission may close one by hand once what it calls is mended.
      </GroupHeader>
      {error && <Failure className="mt-4" what="The breakers could not be read" message={error} />}
      {notice && <p className="mt-4 text-[12px] text-ok">{notice}</p>}
      <div className="mt-5">
        {view ? (
          <BreakersBody
            view={view}
            now={now}
            onClosed={(name) => {
              const t = breakerTarget(name);
              setNotice(`The breaker on ${t.kind === "peer" ? `the peer ${t.label}` : t.label} was closed: every run may call it again at once.`);
              load();
            }}
            onRefresh={load}
          />
        ) : (
          // A view that could not be read: the failure above says why; nothing is drawn as if it were read.
          error ? (
            <p className="text-[12px] text-faint">Not read.</p>
          ) : (
            <p className="text-[12px] text-faint">Reading the breakers…</p>
          )
        )}
      </div>
    </div>
  );
}
