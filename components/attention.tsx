"use client";
import { Failure } from "./pending";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Mono, Status, Tag } from "./ui";
import { KillDialog } from "./kill-dialog";
import { hueFor } from "@/lib/hue";
import { soon } from "@/lib/soon";
import { auditLine, clearAttention, fleet, openableRun, portHealthLine, readAttention, setLockdown, steerRun, type AttentionItem, type PortHealth } from "@/lib/api/l5";
import { killRefusalOf, killRun, rateLimitOfError } from "@/lib/api/l7";
import { closeBreaker } from "@/lib/api/l7b";
import { breakerOfAttention, breakerTarget } from "@/lib/breakers";
import {
  ATTENTION_LABEL,
  HOLDS_LABEL,
  URGENT_SEVERITY,
  attentionVerb,
  countdown,
  driftBenchmarkLine,
  driftBenchmarkOf,
  driftFirstSeen,
  orderAttention,
  overrideOfAttention,
  pauseOf,
  redirectGuidanceOf,
  rollbackOfAttention,
  sideChannelOf,
  type ChannelEnd,
} from "@/lib/gates";
import { conditionLabel } from "@/lib/lifecycle";
import { TextDialog } from "./text-dialog";
import { alreadySummary, killSummary } from "@/lib/run-tree";
import { rateLimitText } from "@/lib/rate-limit";
import { useNow } from "./gate-form";

/**
 * What needs a person, ranked.
 *
 * The platform's attention queue (`GET /api/attention`) is worked out on
 * each read from what it holds, and raises five kinds of row today: a gate
 * waiting for a person, a run that failed or was stopped in the last 24
 * hours, a breaker open on a tool that acts outside, an agent paused or
 * draining, and the lockdown. The kinds it cannot raise yet are named in
 * the answer's `not_built` (budget breaches, drift), and the panel says so
 * rather than reading an empty queue as "nothing". Each row carries the
 * action that clears it, `{method, path, body, says}`, and that is the only
 * button on the row: answer the gate, open the run, close the breaker,
 * resume the agent or lift the lockdown (both with a reason; the panel sits
 * on the Control page those rows name). The rank is severity (1 to 10)
 * first, then age; lib/gates.ts orderAttention holds the order between
 * reads.
 *
 * The rest of this note is the kinds an earlier platform raised, which the
 * panel still reads when a row of one arrives. A failing port's row re-reads
 * that port's own check (`GET /api/ports/{name}/health`) and keeps what it
 * answered under the row.
 *
 * L7 adds three kinds. Drift opens the agent's drift page, and ages from
 * when the drift was first seen. The guardian's acts open the run; a
 * verdict it could not act on offers the lever a person would pull, the
 * kill (its dialog filled in with the guardian's reason, still the
 * person's to change) or the hold at the next gate. A side channel links
 * both agents and both records; a read or write inside an in-process
 * sub-run names the record holding it, and the sub-run is mentioned beside
 * it. An estate breaker that opened (the
 * second round) is red while it is open, with its close on the row (the
 * configure permission; the next call goes through on every worker), and
 * opens the Breakers page once it has closed.
 *
 * L8 adds two kinds and two levers. A deploy an administrator passed past
 * the promotion gate (`override`) and a rollback (`rollback`, with the runs
 * it flagged) open the agent's lifecycle page. A drift row's button is the
 * fleet door's pause, for a person to take (the run permission, the
 * backend's reason to start from); the drift report stays the row's link,
 * and a drift read against the benchmark names that eval. A redirect the
 * guardian could not make offers the steer it would have sent, its guidance
 * still the person's to change.
 *
 * L9 adds two kinds. An emergency rollback of a policy change opens that
 * change on the Policy page, for a person to review what skipped review; an
 * overdue attestation opens the agent's attestations, where the owner reads
 * the diff before attesting.
 */

const KIND_TONE: Record<AttentionItem["kind"], "warn" | "err" | "queue" | "run"> = {
  gate: "warn",
  run: "err",
  fleet: "warn",
  lockdown: "err",
  refusal: "err",
  budget: "err",
  dead_letter: "queue",
  health: "err",
  drift: "warn",
  guardian: "err",
  side_channel: "warn",
  breaker: "err",
  override: "warn",
  rollback: "warn",
  policy_rollback: "err",
  attestation: "warn",
};

const RunLink = ({ run }: { run: string }) => (
  <Link href={`/runs?id=${encodeURIComponent(run)}`} className="focusable rounded-sm font-mono text-dim hover:underline">
    {run}
  </Link>
);

/** One end of a side channel: who, in which record, and the sub-run inside it when there was one. */
function ChannelEndLine({ end, verb }: { end: ChannelEnd; verb: string }) {
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1">
      <span className="text-faint">
        {end.agent || "an agent"} {verb} in
      </span>
      {end.run ? <RunLink run={end.run} /> : <span className="text-ghost">a run not on the record</span>}
      {end.sub_run && (
        <span className="font-mono text-ghost" title="An in-process sub-run inside that record: it has no record of its own; its entries are in the record's journal.">
          (sub-run {end.sub_run})
        </span>
      )}
    </span>
  );
}

/** The agents and records an L7 item links, under its title: a side channel's two ends, a drift's first sighting, every other item's runs. */
export function AttentionLinks({ item }: { item: AttentionItem }) {
  const channel = sideChannelOf(item);
  if (channel) {
    return (
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
        <ChannelEndLine end={channel.writer} verb="wrote" />
        <span className="text-ghost">·</span>
        <ChannelEndLine end={channel.reader} verb="read" />
      </span>
    );
  }
  const first = driftFirstSeen(item);
  const bench = driftBenchmarkOf(item);
  const override = overrideOfAttention(item);
  const rollback = rollbackOfAttention(item);
  const agents = item.agents.length > 1 ? item.agents : [];
  const runs = item.runs.length > 1 || (item.runs.length === 1 && item.runs[0] !== item.run) ? item.runs : [];
  if (!agents.length && !runs.length && !first && !bench && !override && !rollback) return null;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px]">
      {first && <span className="text-faint">drifting since first seen {first.replace("T", " ").replace(/\.\d+Z$|Z$/, " UTC")}</span>}
      {bench && <span className="text-faint">{driftBenchmarkLine(bench)}</span>}
      {override && (
        <span className="text-faint">
          passed {override.passed.map(conditionLabel).join(", ") || "the unmet conditions"} by override{override.by ? ` (${override.by})` : ""}: {override.reason}
        </span>
      )}
      {rollback && (
        <span className="text-faint">
          version {rollback.from ?? "?"} → {rollback.to ?? "?"}: {rollback.reason}; flagged for review
        </span>
      )}
      {agents.length > 0 && <span className="text-faint">{agents.join(", ")}</span>}
      {runs.map((r) => (
        <RunLink key={r} run={r} />
      ))}
    </span>
  );
}

const HOLDS_TONE: Record<string, "err" | "warn"> = { sink: "err", destructive: "err", risky: "warn", write: "warn" };

/** The kinds the platform names in `not_built`, in words. */
const NOT_BUILT_KIND: Record<string, string> = { budget: "budget breaches", drift: "drift" };

const ago = (s: number) => (s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`);

export function useAttention(active = true, everyMs = 5000) {
  const [items, setItems] = useState<AttentionItem[] | null>(null);
  /** The kinds of row the platform names as not built, and whether it left out older ended runs, as the last read said. */
  const [notBuilt, setNotBuilt] = useState<string[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    readAttention()
      .then((list) => {
        setItems(orderAttention(list.items));
        setNotBuilt(list.not_built);
        setTruncated(list.truncated);
        setError("");
      })
      .catch((e) => {
        setItems((cur) => cur ?? []);
        setError((e as Error).message);
      });
  }, []);
  useEffect(() => {
    if (!active) return;
    const cancel = soon(load);
    const id = setInterval(load, everyMs);
    return () => {
      cancel();
      clearInterval(id);
    };
  }, [active, everyMs, load]);
  return { items, notBuilt, truncated, error, reload: load };
}

export function AttentionPanel({
  onAnswer,
  onOpenRun,
  onNotice,
  onLockdown,
}: {
  /** Open the inbox dialog for a run's gate. Resolves false when the gate is not in the inbox (yet). */
  onAnswer: (run: string) => boolean;
  onOpenRun: (run: string) => void;
  onNotice: (text: string) => void;
  /** The lockdown or an agent's hold changed from a row: the page reads them again. */
  onLockdown?: () => void;
}) {
  const router = useRouter();
  const { items, notBuilt, truncated, error, reload } = useAttention();
  const now = useNow();
  const [busy, setBusy] = useState<string | null>(null);
  /* What a re-read port answered, by row: kept under the row until the row clears. */
  const [checked, setChecked] = useState<Record<string, PortHealth>>({});
  /* A kill the guardian would have made, taken up by a person: the dialog, the guardian's reason to start from. */
  const [killAsk, setKillAsk] = useState<AttentionItem | null>(null);
  /* A drift's pause, a redirect the guardian could not make, a held agent's resume or the lockdown's lift: the dialog, the backend's text to start from. */
  const [textAsk, setTextAsk] = useState<AttentionItem | null>(null);

  const refusedText = (item: AttentionItem, e: unknown) => {
    const rl = rateLimitOfError(e);
    return `${attentionVerb(item)} refused: ${rl ? rateLimitText(rl) : (e as Error).message.slice(0, 140)}`;
  };

  const act = async (item: AttentionItem) => {
    const a = item.action;
    const run = openableRun(item);
    if (a.kind === "answer") {
      if (item.run && onAnswer(item.run)) return;
      if (item.run) onOpenRun(item.run);
      return;
    }
    if (a.kind === "open") {
      if (a.href) router.push(a.href);
      else if (run) onOpenRun(run);
      else if (item.agent) router.push(`/runs?agent=${encodeURIComponent(item.agent)}`);
      else onNotice(a.says || item.title);
      return;
    }
    if (a.kind === "kill") {
      setKillAsk(item);
      return;
    }
    if (a.kind === "pause" || a.kind === "redirect" || a.kind === "resume" || a.kind === "lift") {
      if ((a.kind === "pause" && !pauseOf(item)) || (a.kind === "redirect" && !item.run) || (a.kind === "resume" && !item.agent)) return onNotice(a.says || item.title);
      setTextAsk(item);
      return;
    }
    if (a.kind === "close") {
      const name = breakerOfAttention(item);
      if (!name) return onNotice(a.says || item.title);
      setBusy(item.id);
      try {
        await closeBreaker(name);
        const t = breakerTarget(name);
        onNotice(`Closed the breaker on ${t.kind === "peer" ? `the peer ${t.label}` : t.label}: every run may call it again at once. It opens again when its calls or failures pass the thresholds.`);
        reload();
      } catch (e) {
        onNotice(refusedText(item, e));
        reload();
      } finally {
        setBusy(null);
      }
      return;
    }
    if (a.kind === "hold") {
      if (!item.run) return onNotice(a.says || item.title);
      setBusy(item.id);
      try {
        const r = await steerRun(item.run, { hold_at_next_gate: true });
        onNotice(`Asked for a hold on ${r.run}: its next tool call at or above write waits for a person.`);
        reload();
      } catch (e) {
        onNotice(refusedText(item, e));
      } finally {
        setBusy(null);
      }
      return;
    }
    setBusy(item.id);
    try {
      const { health } = await clearAttention(item);
      if (health) setChecked((c) => ({ ...c, [item.id]: health }));
      // A re-read clears nothing by itself: the row goes once the port reads healthy.
      onNotice(
        health
          ? `${portHealthLine(health)}${health.ok === true ? " The row clears on the next read." : a.says ? ` To clear it: ${a.says}.` : ""}`
          : a.kind === "check"
            ? `Re-read. ${a.says ? `To clear it: ${a.says}.` : "The row clears once it reads healthy."}`
            : `${attentionVerb(item)}: ${item.title}`,
      );
      reload();
    } catch (e) {
      onNotice(refusedText(item, e));
    } finally {
      setBusy(null);
    }
  };

  const worst = items?.[0];
  /* A queue that was not read: the panel shows the failure, never "nothing needs a person". */
  const off = Boolean(error) && !items?.length;
  return (
    <section className="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
      {killAsk && killAsk.run && (
        <KillDialog
          title="Kill the run the guardian flagged?"
          what={`${killAsk.agent} · ${killAsk.run}. The guardian would have blocked it but did not act (${String(killAsk.data?.why ?? "outside its limits")}). The kill reaches the run and everything it set off.`}
          initialReason={String(killAsk.action.body?.reason ?? "")}
          busy={busy === killAsk.id}
          onClose={() => setKillAsk(null)}
          onConfirm={async (reason) => {
            const item = killAsk;
            setBusy(item.id);
            try {
              const r = await killRun(item.run!, reason);
              onNotice(killSummary(r));
              reload();
            } catch (e) {
              const refusal = killRefusalOf(e);
              onNotice(refusal?.already.length ? alreadySummary(refusal) : refusedText(item, e));
              reload();
            } finally {
              setBusy(null);
              setKillAsk(null);
            }
          }}
        />
      )}
      {textAsk && textAsk.action.kind === "pause" && (
        <TextDialog
          title={`Pause ${pauseOf(textAsk)?.agents.join(", ") || textAsk.agent}?`}
          what={`${textAsk.title}. Pausing starts no new run of it and lets no worker take up one that has not started; every run of it in flight, running or waiting at a gate, is stopped. It stays paused until a person resumes it.`}
          label="Reason"
          hint="Recorded on the pause, with your name, and audited."
          missing="A pause needs a reason."
          initial={pauseOf(textAsk)?.reason ?? ""}
          confirm="Pause"
          tone="warn"
          permission="run"
          busy={busy === textAsk.id}
          onClose={() => setTextAsk(null)}
          onConfirm={async (reason) => {
            const item = textAsk;
            const p = pauseOf(item);
            if (!p) return;
            setBusy(item.id);
            try {
              const r = await fleet("pause", p.agents, reason);
              onNotice(`Paused ${r.agents.join(", ")}${r.killed.length ? `; ${r.killed.length} run${r.killed.length === 1 ? "" : "s"} in flight stopped` : ""}. Resume it on the Control page once the drift is understood.`);
              reload();
            } catch (e) {
              onNotice(refusedText(item, e));
            } finally {
              setBusy(null);
              setTextAsk(null);
            }
          }}
        />
      )}
      {textAsk && textAsk.action.kind === "redirect" && textAsk.run && (
        <TextDialog
          title="Redirect the run the guardian flagged?"
          what={`${textAsk.agent} · ${textAsk.run}. The guardian would have redirected it but did not act (${String(textAsk.data?.why ?? "outside its limits")}). The run reads the guidance at its next model call.`}
          label="Guidance"
          hint="Handed to the run as a steer, signed with your name."
          missing="A redirect needs the guidance it sends."
          initial={redirectGuidanceOf(textAsk)}
          confirm="Send guidance"
          tone="warn"
          permission="run"
          busy={busy === textAsk.id}
          onClose={() => setTextAsk(null)}
          onConfirm={async (guidance) => {
            const item = textAsk;
            setBusy(item.id);
            try {
              const r = await steerRun(item.run!, { guidance });
              onNotice(`Sent guidance to ${r.run} (${r.delivery}); it reads it at its next model call.`);
              reload();
            } catch (e) {
              onNotice(refusedText(item, e));
            } finally {
              setBusy(null);
              setTextAsk(null);
            }
          }}
        />
      )}
      {textAsk && textAsk.action.kind === "resume" && textAsk.agent && (
        <TextDialog
          title={`Resume ${textAsk.agent}?`}
          what={`${textAsk.title}${textAsk.detail ? ` (${textAsk.detail})` : ""}. Resuming lifts the hold: its runs start again, and workers take up the ones waiting. One audit event records it, with the reason and your name.`}
          label="Reason"
          hint="Recorded on the resume, with your name, and audited."
          missing="A resume needs a reason."
          confirm="Resume"
          tone="ink"
          permission="run"
          busy={busy === textAsk.id}
          onClose={() => setTextAsk(null)}
          onConfirm={async (reason) => {
            const item = textAsk;
            setBusy(item.id);
            try {
              const r = await fleet("resume", [item.agent], reason);
              onNotice(`Resumed ${r.agents.join(", ")}: its runs start again${auditLine(r.audit_id)}`);
              onLockdown?.();
              reload();
            } catch (e) {
              onNotice(refusedText(item, e));
            } finally {
              setBusy(null);
              setTextAsk(null);
            }
          }}
        />
      )}
      {textAsk && textAsk.action.kind === "lift" && (
        <TextDialog
          title="Lift the lockdown?"
          what={`${textAsk.title}${textAsk.detail ? ` (${textAsk.detail})` : ""}. Lifting it lets runs start again and workers take up the runs waiting; tool calls go back to what each agent's policy says. One audit event records it, with the reason and your name.`}
          label="Reason"
          hint="Recorded on the lift, with your name, and audited."
          missing="Lifting the lockdown needs a reason."
          confirm="Lift lockdown"
          tone="ink"
          permission="configure"
          busy={busy === textAsk.id}
          onClose={() => setTextAsk(null)}
          onConfirm={async (reason) => {
            const item = textAsk;
            setBusy(item.id);
            try {
              const st = await setLockdown(false, reason);
              onNotice(`Lockdown lifted${auditLine(st.audit_id)}`);
              onLockdown?.();
              reload();
            } catch (e) {
              onNotice(refusedText(item, e));
            } finally {
              setBusy(null);
              setTextAsk(null);
            }
          }}
        />
      )}
      <div data-hue={hueFor("attention queue")} className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-raise/55 px-3">
        <span className="text-[12px] font-semibold">Attention</span>
        {worst && (
          <span className="relative flex size-2">
            <span className={`absolute inline-flex size-2 animate-ping rounded-full opacity-60 ${worst.severity >= URGENT_SEVERITY ? "bg-err" : "bg-warn"}`} />
            <span className={`relative inline-flex size-2 rounded-full ${worst.severity >= URGENT_SEVERITY ? "bg-err" : "bg-warn"}`} />
          </span>
        )}
        <span className="truncate text-[11px] text-faint">
          {off ? "" : items === null ? "reading the queue…" : items.length ? `${items.length} thing${items.length === 1 ? "" : "s"} need a person · ranked by severity, then age` : "nothing it raises needs a person"}
        </span>
        <span className="grow" />
        <Mono className="text-[10px] text-ghost">{error ? "" : "every 5 s"}</Mono>
      </div>
      {off && <Failure className="m-3" what="The attention queue could not be read" message={error} />}
      <div className="max-h-[320px] overflow-y-auto">
        {(items ?? []).map((it, i) => {
          const dl = countdown(it.deadline, now);
          return (
            <div key={it.id} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
              <span className="tnum w-5 shrink-0 text-right font-mono text-[10px] text-ghost">{i + 1}</span>
              <Status tone={KIND_TONE[it.kind]}>{ATTENTION_LABEL[it.kind]}</Status>
              <span className="flex min-w-0 grow flex-col">
                <button
                  type="button"
                  onClick={() => {
                    const run = openableRun(it);
                    if (run) onOpenRun(run);
                    else if (it.action.href) router.push(it.action.href);
                    else if (it.agent) router.push(`/runs?agent=${encodeURIComponent(it.agent)}`);
                    else onNotice(it.action.says || it.title);
                  }}
                  className="focusable flex min-w-0 cursor-pointer flex-col text-left"
                >
                  <span className="truncate text-[12px] font-medium text-fg">{it.title || `${it.kind} on ${it.agent}`}</span>
                  <span className="truncate font-mono text-[9.5px] text-faint">
                    {[it.agent, it.run ?? (it.job ? `job ${it.job}` : ""), it.detail].filter(Boolean).join(" · ")}
                  </span>
                  {checked[it.id] && (
                    <span className={`truncate text-[10.5px] ${checked[it.id].ok === true ? "text-ok" : checked[it.id].ok === false ? "text-err" : "text-faint"}`} title={JSON.stringify(checked[it.id].detail)}>
                      Read {checked[it.id].checked_at ? new Date(checked[it.id].checked_at).toLocaleTimeString() : "just now"}: {portHealthLine(checked[it.id])}
                    </span>
                  )}
                </button>
                {/* The agents and runs an L7 item links; links are not nested in the row's button. */}
                <AttentionLinks item={it} />
              </span>
              <span className="hidden shrink-0 items-center gap-2 sm:flex">
                {it.holds && <Tag tone={HOLDS_TONE[it.holds] ?? "warn"}>{HOLDS_LABEL[it.holds] ?? it.holds}</Tag>}
                {it.deadline && <span className={`tnum font-mono text-[10px] ${dl.overdue ? "text-err" : dl.soon ? "text-warn" : "text-faint"}`}>{dl.overdue ? dl.text : `${dl.text} left`}</span>}
                <span className="tnum font-mono text-[10px] text-faint" title={it.since ? new Date(it.since).toLocaleString() : ""}>
                  {ago(it.age_s)} old
                </span>
                <span className="tnum font-mono text-[10px] text-ghost">S{Math.round(it.severity)}/10</span>
              </span>
              {/* What clears it, in the backend's words, on the one button. */}
              <span className="shrink-0" title={it.action.says || undefined}>
                <Button
                  size="sm"
                  variant="solid"
                  tone={it.action.kind === "answer" || it.action.kind === "hold" || it.action.kind === "pause" || it.action.kind === "redirect" ? "warn" : it.action.kind === "kill" ? "err" : it.action.kind === "replay" || it.action.kind === "close" || it.action.kind === "resume" || it.action.kind === "lift" ? "ink" : "neutral"}
                  permission={
                    it.action.kind === "answer"
                      ? "approve"
                      : it.action.kind === "close" || it.action.kind === "lift"
                        ? "configure"
                        : it.action.kind === "replay" || it.action.kind === "kill" || it.action.kind === "hold" || it.action.kind === "pause" || it.action.kind === "redirect" || it.action.kind === "resume"
                          ? "run"
                          : undefined
                  }
                  loading={busy === it.id}
                  onClick={() => act(it)}
                >
                  {attentionVerb(it)}
                </Button>
              </span>
            </div>
          );
        })}
        {items && items.length === 0 && !error && (
          <p className="px-3 py-3 text-[12px] text-faint">
            Nothing waiting. The queue raises gates waiting for a person, runs that failed or were stopped in the last 24 hours, breakers open on a tool, agents paused or draining, and the lockdown, each with the action that clears it.
          </p>
        )}
      </div>
      {items && truncated && <p className="border-t border-line px-3 py-1.5 text-[11px] text-faint">More runs ended in the last 24 hours than the queue lists; the Runs page has them all.</p>}
      {items && notBuilt.length > 0 && (
        <p className="border-t border-line px-3 py-1.5 text-[11px] text-faint" data-not-built={notBuilt.join(",")}>
          Not built: {notBuilt.map((k) => NOT_BUILT_KIND[k] ?? k.replace(/_/g, " ")).join(" and ")} {notBuilt.length === 1 ? "is" : "are"} not raised here yet, so the queue says nothing about {notBuilt.length === 1 ? "it" : "them"}.
        </p>
      )}
    </section>
  );
}
