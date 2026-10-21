"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Mono, Status, Tag } from "./ui";
import { hueFor } from "@/lib/hue";
import { soon } from "@/lib/soon";
import { clearAttention, listAttention, type AttentionItem } from "@/lib/api/l5";
import { ATTENTION_LABEL, attentionVerb, countdown, orderAttention } from "@/lib/gates";
import { useNow } from "./gate-form";

/**
 * What needs a person, ranked.
 *
 * The backend's attention door (`GET /api/attention`) folds every open
 * question into one queue: gates by deadline and blast radius, refusals
 * that stopped a run, budget breaches, dead letters, failing health. Each
 * row carries the one action that clears it, and that is the only button
 * on the row: answer, replay, acknowledge, or open. The rank is severity ×
 * age; lib/gates.ts orderAttention holds the order between reads.
 */

const KIND_TONE: Record<AttentionItem["kind"], "warn" | "err" | "queue" | "run"> = {
  gate: "warn",
  refusal: "err",
  budget: "err",
  dead_letter: "queue",
  health: "err",
};

const RISK_TONE: Record<string, "err" | "warn" | "neutral"> = { destructive: "err", risky: "warn", write: "warn", read: "neutral" };

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

  const act = async (item: AttentionItem) => {
    const a = item.action;
    if (a.kind === "answer") {
      if (item.run && onAnswer(item.run)) return;
      if (item.run) onOpenRun(item.run);
      return;
    }
    if (a.kind === "open") {
      if (a.href) router.push(a.href);
      else if (item.run) onOpenRun(item.run);
      else router.push(`/runs?agent=${encodeURIComponent(item.agent)}`);
      return;
    }
    setBusy(item.id);
    try {
      await clearAttention(item);
      onNotice(`${attentionVerb(item)}: ${item.title}`);
      reload();
    } catch (e) {
      onNotice(`${attentionVerb(item)} refused: ${(e as Error).message.slice(0, 140)}`);
    } finally {
      setBusy(null);
    }
  };

  const worst = items?.[0];
  return (
    <section className="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
      <div data-hue={hueFor("attention queue")} className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-raise/55 px-3">
        <span className="text-[12px] font-semibold">Attention</span>
        {worst && (
          <span className="relative flex size-2">
            <span className={`absolute inline-flex size-2 animate-ping rounded-full opacity-60 ${worst.severity >= 4 ? "bg-err" : "bg-warn"}`} />
            <span className={`relative inline-flex size-2 rounded-full ${worst.severity >= 4 ? "bg-err" : "bg-warn"}`} />
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
          const br = it.blast_radius;
          return (
            <div key={it.id} className="flex items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
              <span className="tnum w-5 shrink-0 text-right font-mono text-[10px] text-ghost">{i + 1}</span>
              <Status tone={KIND_TONE[it.kind]}>{ATTENTION_LABEL[it.kind]}</Status>
              <button
                type="button"
                onClick={() => (it.run ? onOpenRun(it.run) : router.push(`/runs?agent=${encodeURIComponent(it.agent)}`))}
                className="focusable flex min-w-0 grow cursor-pointer flex-col text-left"
              >
                <span className="truncate text-[12px] font-medium text-fg">{it.title || `${it.kind} on ${it.agent}`}</span>
                <span className="truncate font-mono text-[9.5px] text-faint">
                  {it.agent}
                  {it.run ? ` · ${it.run}` : it.job ? ` · job ${it.job}` : ""}
                  {it.detail ? ` · ${it.detail}` : ""}
                </span>
              </button>
              <span className="hidden shrink-0 items-center gap-2 sm:flex">
                {br && (
                  <Tag tone={RISK_TONE[br.risk] ?? "neutral"}>
                    {br.sinks} sink{br.sinks === 1 ? "" : "s"} · {br.risk}
                  </Tag>
                )}
                {it.deadline && <span className={`tnum font-mono text-[10px] ${dl.overdue ? "text-err" : dl.soon ? "text-warn" : "text-faint"}`}>{dl.overdue ? dl.text : `${dl.text} left`}</span>}
                <span className="tnum font-mono text-[10px] text-faint" title={it.since ? new Date(it.since).toLocaleString() : ""}>
                  {ago(it.age_s)} old
                </span>
                <span className="tnum font-mono text-[10px] text-ghost">S{Math.round(it.severity)}</span>
              </span>
              <Button
                size="sm"
                variant={it.action.kind === "open" ? "outline" : "solid"}
                tone={it.action.kind === "answer" ? "warn" : it.action.kind === "replay" ? "ink" : "neutral"}
                permission={it.action.kind === "answer" ? "approve" : it.action.kind === "open" ? undefined : "run"}
                loading={busy === it.id}
                onClick={() => act(it)}
              >
                {attentionVerb(it)}
              </Button>
            </div>
          );
        })}
        {items && items.length === 0 && !error && (
          <p className="px-3 py-3 text-[12px] text-faint">Nothing waiting. Gates, stopped runs, budget breaches, dead letters and failing health land here with the action that clears them.</p>
        )}
      </div>
    </section>
  );
}
