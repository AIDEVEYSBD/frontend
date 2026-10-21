"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Mono, Status, Tag } from "./ui";
import { KillDialog } from "./kill-dialog";
import { hueFor } from "@/lib/hue";
import { soon } from "@/lib/soon";
import { clearAttention, listAttention, looksLikeRecordId, openableRun, portHealthLine, steerRun, type AttentionItem, type PortHealth } from "@/lib/api/l5";
import { killRun, rateLimitOfError } from "@/lib/api/l7";
import { ATTENTION_LABEL, HOLDS_LABEL, URGENT_SEVERITY, attentionVerb, countdown, orderAttention } from "@/lib/gates";
import { killSummary } from "@/lib/run-tree";
import { rateLimitText } from "@/lib/rate-limit";
import { useNow } from "./gate-form";

/**
 * What needs a person, ranked.
 *
 * The backend's attention door (`GET /api/attention`) folds every open
 * question into one queue: gates by deadline and what they hold (a sink or
 * a destructive call outranks a note), refusals that stopped a run, budget
 * breaches, dead letters, failing ports. Each row carries the action that
 * clears it, `{method, path, body, says}`, and that is the only button on
 * the row: answer the gate, replay the dead letter, re-read the health
 * door, or open the page or the run. The rank is severity (1 to 10) × an
 * age weight; lib/gates.ts orderAttention holds the order between reads.
 * A failing port's row re-reads that port's own check (`GET
 * /api/ports/{name}/health`) and keeps what it answered under the row.
 *
 * L7 adds three kinds. Drift opens the agent's drift page. The guardian's
 * acts open the run; a verdict it could not act on offers the lever a
 * person would pull, the kill (its dialog filled in with the guardian's
 * reason, still the person's to change) or the hold at the next gate. A
 * side channel links both agents and both runs; a reader inside an
 * in-process sub-run is named by the sub-run's id, which is no record, so
 * that one is shown and not linked.
 */

const KIND_TONE: Record<AttentionItem["kind"], "warn" | "err" | "queue" | "run"> = {
  gate: "warn",
  refusal: "err",
  budget: "err",
  dead_letter: "queue",
  health: "err",
  drift: "warn",
  guardian: "err",
  side_channel: "warn",
};

/** The agents and runs an L7 item links, under its title: each run a link when it is a record. */
export function AttentionLinks({ item }: { item: AttentionItem }) {
  const agents = item.agents.length > 1 ? item.agents : [];
  const runs = item.runs.length > 1 || (item.runs.length === 1 && item.runs[0] !== item.run) ? item.runs : [];
  if (!agents.length && !runs.length) return null;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px]">
      {agents.length > 0 && <span className="text-faint">{item.kind === "side_channel" ? `${agents[0]} wrote · ${agents.slice(1).join(", ")} read` : agents.join(", ")}</span>}
      {runs.map((r) =>
        looksLikeRecordId(r) ? (
          <Link key={r} href={`/runs?id=${encodeURIComponent(r)}`} className="focusable rounded-sm font-mono text-dim hover:underline">
            {r}
          </Link>
        ) : (
          <span key={r} className="font-mono text-ghost" title="An in-process sub-run: it has no record of its own; its entries are in its parent's journal.">
            {r} (sub-run)
          </span>
        ),
      )}
    </span>
  );
}

const HOLDS_TONE: Record<string, "err" | "warn"> = { sink: "err", destructive: "err", risky: "warn", write: "warn" };

const ago = (s: number) => (s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : s < 86400 ? `${Math.round(s / 3600)}h` : `${Math.round(s / 86400)}d`);

export function useAttention(active = true, everyMs = 5000) {
  const [items, setItems] = useState<AttentionItem[] | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    listAttention()
      .then((rows) => {
        setItems(orderAttention(rows));
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
  return { items, error, reload: load };
}

export function AttentionPanel({
  onAnswer,
  onOpenRun,
  onNotice,
}: {
  /** Open the inbox dialog for a run's gate. Resolves false when the gate is not in the inbox (yet). */
  onAnswer: (run: string) => boolean;
  onOpenRun: (run: string) => void;
  onNotice: (text: string) => void;
}) {
  const router = useRouter();
  const { items, error, reload } = useAttention();
  const now = useNow();
  const [busy, setBusy] = useState<string | null>(null);
  /* What a re-read port answered, by row: kept under the row until the row clears. */
  const [checked, setChecked] = useState<Record<string, PortHealth>>({});
  /* A kill the guardian would have made, taken up by a person: the dialog, the guardian's reason to start from. */
  const [killAsk, setKillAsk] = useState<AttentionItem | null>(null);

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
    if (a.kind === "hold") {
      if (!item.run) return onNotice(a.says || item.title);
      setBusy(item.id);
      try {
        const r = await steerRun(item.run, { hold_at_next_gate: true });
        onNotice(`Held ${r.run} at its next gate (${r.delivery}); a person answers it there.`);
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
              onNotice(refusedText(item, e));
            } finally {
              setBusy(null);
              setKillAsk(null);
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
          {items === null ? "reading the queue…" : items.length ? `${items.length} thing${items.length === 1 ? "" : "s"} need a person · ranked by severity × age` : "nothing needs a person"}
        </span>
        <span className="grow" />
        <Mono className="text-[10px] text-ghost">{error ? "queue unreachable" : "every 5 s"}</Mono>
      </div>
      {error && items?.length === 0 && <p className="px-3 py-2 text-[11.5px] text-err">{error}</p>}
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
                  variant={it.action.kind === "open" ? "outline" : "solid"}
                  tone={it.action.kind === "answer" || it.action.kind === "hold" ? "warn" : it.action.kind === "kill" ? "err" : it.action.kind === "replay" ? "ink" : "neutral"}
                  permission={it.action.kind === "answer" ? "approve" : it.action.kind === "replay" || it.action.kind === "kill" || it.action.kind === "hold" ? "run" : undefined}
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
          <p className="px-3 py-3 text-[12px] text-faint">Nothing waiting. Gates, stopped runs, budget breaches, dead letters, failing health, drift, the guardian&rsquo;s verdicts and agents coordinating through a shared store land here with the action that clears them.</p>
        )}
      </div>
    </section>
  );
}
