"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AUTONOMY_LABEL,
  CLASS_LABEL,
  applicationMetrics,
  getApplication,
  getConversation,
  listConversations,
  metricsWindow,
  patchApplication,
  type Application,
  type ApplicationMetrics,
  type Conversation,
  type ConversationRow,
  type Turn,
} from "@/lib/api/l4";
import { fmtMs } from "@/lib/run-fold";
import { WindowPick, winMs, type Win } from "./window-pick";
import { Button, Mono, Status, Tag } from "./ui";
import { CAT, Donut, RankBar } from "./charts";
import { DrillModal, DrillTable } from "./drill";
import { ControlRef, resolveControl } from "./control-ref";
import { LineageDrawer } from "./lineage";
import { Skeleton } from "./loaders";
import { usePageFacts } from "./assistant";

/**
 * One application's dashboard.
 *
 * Every figure is read from journalled calls through the application's
 * metrics door, cut over the page window; every figure opens the
 * conversations behind it; every conversation replays turn by turn with
 * the screening and refusals it met, and any turn opens its lineage. The
 * block switch is the kill switch: every door refuses until it is lifted.
 */

const money = (c: number | null) => (c === null ? "unknown" : c === 0 ? "$0.00" : c < 0.005 ? "<$0.01" : c < 100 ? `$${c.toFixed(2)}` : `$${Math.round(c).toLocaleString("en-GB")}`);
const ms = (v: number | null) => (v === null ? "unknown" : fmtMs(v));
const when = (iso: string) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "unknown");
const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n));

type Drill =
  | { kind: "kpi"; which: "volume" | "cost" | "p50" | "p95" | "refusals" | "screened" | "hit" | "unanswerable" | "grounding" }
  | { kind: "control"; control: string }
  | { kind: "reason"; reason: string }
  | { kind: "model"; model: string };

const ROLE_LABEL: Record<Turn["role"], string> = { user: "user", assistant: "assistant", system: "system prompt", tool: "tool", retrieval: "retrieval" };
const ROLE_TONE: Record<Turn["role"], string> = { user: "text-dim", assistant: "text-run", system: "text-ghost", tool: "text-c2", retrieval: "text-c10" };

const controlLabel = (key: string) => {
  const c = resolveControl(key);
  return c ? `${c.id} ${c.title}` : key;
};

export function ApplicationDashboard({ id }: { id: string }) {
  const [now] = useState(() => Date.now());
  const [app, setApp] = useState<Application | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [win, setWin] = useState<Win>("7d");
  // Loaded figures carry the window they were cut over, so a change of
  // window reads as "loading" without a reset inside the effect.
  const [metricsFor, setMetricsFor] = useState<{ win: Win; metrics: ApplicationMetrics } | null>(null);
  const [allConvs, setAllConvs] = useState<ConversationRow[] | null>(null);
  const metrics = metricsFor?.win === win ? metricsFor.metrics : null;
  const [drill, setDrill] = useState<Drill | null>(null);
  const [open, setOpen] = useState<Conversation | null>(null);
  const [opening, setOpening] = useState("");
  const [lineage, setLineage] = useState<{ run: string; entry: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const loadApp = useCallback(() => {
    getApplication(id)
      .then(setApp)
      .catch((e: Error) => {
        setApp(null);
        setError(e.message);
      });
  }, [id]);
  useEffect(() => {
    loadApp();
  }, [loadApp]);

  useEffect(() => {
    let stop = false;
    applicationMetrics(id, metricsWindow(win))
      .then((m) => !stop && setMetricsFor({ win, metrics: m }))
      .catch((e: Error) => !stop && setError(e.message));
    return () => {
      stop = true;
    };
  }, [id, win]);

  useEffect(() => {
    let stop = false;
    listConversations(id)
      .then((c) => !stop && setAllConvs(c))
      .catch(() => !stop && setAllConvs([]));
    return () => {
      stop = true;
    };
  }, [id]);

  // The conversations door lists everything; the page window cuts the list.
  const convs = useMemo(() => (allConvs ? allConvs.filter((c) => win === "all" || now - new Date(c.last || c.started).getTime() <= winMs(win)) : null), [allConvs, win, now]);
  const clamped = win === "90d" || win === "all";

  const openConversation = async (cid: string) => {
    setOpening(cid);
    try {
      setOpen(await getConversation(id, cid));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOpening("");
    }
  };

  const toggleBlock = async () => {
    if (!app) return;
    setBusy(true);
    try {
      setApp(await patchApplication(app.id, { blocked: !app.blocked }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const isRag = app?.class === "rag";
  const screened = useMemo(() => Object.entries(metrics?.screened ?? {}).sort((a, b) => b[1] - a[1]), [metrics]);
  const screenedTotal = screened.reduce((s, [, n]) => s + n, 0);
  const reasons = useMemo(() => Object.entries(metrics?.refusals_by_reason ?? {}).sort((a, b) => b[1] - a[1]), [metrics]);
  const models = useMemo(() => (metrics?.models ?? []).slice().sort((a, b) => b.completions - a.completions), [metrics]);

  usePageFacts({
    application: app ? { id: app.id, name: app.name, class: app.class, autonomy: app.autonomy, owner: app.owner, blocked: app.blocked, policy: app.policy } : app === null ? "not found" : "loading",
    window: win,
    metrics: metrics
      ? { completions: metrics.volume, conversations: metrics.conversations, principals: metrics.principals, cost: metrics.cost, latency: metrics.latency, refusals: metrics.refusals, screened: metrics.screened, models: metrics.models.map((m) => [m.model, m.completions]) }
      : "loading",
    conversations: convs ? convs.length : "loading",
  });

  /* The records behind a figure: the conversations, cut and ordered for the question asked. */
  const drillRows = useMemo((): { title: string; subtitle: string; rows: ConversationRow[] } => {
    const all = convs ?? [];
    if (!drill) return { title: "", subtitle: "", rows: [] };
    if (drill.kind === "kpi") {
      switch (drill.which) {
        case "volume":
          return { title: "Conversations", subtitle: `${metrics?.volume ?? 0} completions over ${win} from ${metrics?.principals ?? 0} principals, grouped by conversation.`, rows: all };
        case "cost":
          return { title: "Cost by conversation", subtitle: `Priced from journalled tokens${metrics?.unpriced ? `; ${metrics.unpriced} completions are unpriced` : ""}.`, rows: [...all].sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1)) };
        case "p50":
        case "p95":
          return { title: "Latency", subtitle: `p50 ${ms(metrics?.latency.p50 ?? null)} · p95 ${ms(metrics?.latency.p95 ?? null)} over every journalled completion. The conversations, most recent first.`, rows: all };
        case "refusals":
          return { title: "Refused", subtitle: "Conversations in which at least one completion was refused: a screened prompt under block, a limit, a spent budget.", rows: all.filter((c) => c.refusals > 0) };
        case "screened":
          return { title: "Screened", subtitle: `${metrics?.blocked ?? 0} blocked and ${metrics?.flagged ?? 0} flagged over ${win}. The row does not carry the screened count; open a conversation to see the turn the screener matched.`, rows: all };
        case "hit":
          return { title: "Retrieval hit rate", subtitle: "The metrics door does not report retrieval figures yet. The conversations, most recent first.", rows: all };
        case "unanswerable":
          return { title: "Unanswerable", subtitle: "The metrics door does not report retrieval figures yet. The conversations, most recent first.", rows: all };
        case "grounding":
          return { title: "Grounding rate", subtitle: "The metrics door does not report retrieval figures yet. The conversations, most recent first.", rows: all };
      }
    }
    if (drill.kind === "control") {
      return { title: controlLabel(drill.control), subtitle: `${metrics?.screened[drill.control] ?? 0} hits over ${win}. Open a conversation to see the turn the control matched.`, rows: all };
    }
    if (drill.kind === "reason") return { title: `Refused: ${drill.reason}`, subtitle: `${metrics?.refusals_by_reason[drill.reason] ?? 0} refusals over ${win}. Conversations with at least one refusal.`, rows: all.filter((x) => x.refusals > 0) };
    return { title: drill.model, subtitle: `${metrics?.models.find((m) => m.model === drill.model)?.completions ?? 0} completions over ${win}.`, rows: all.filter((x) => x.models.includes(drill.model)) };
  }, [drill, convs, metrics, win]);

  if (app === undefined) {
    return (
      <div className="mx-auto w-full max-w-[1520px] px-5 py-7">
        <Skeleton lines={4} />
      </div>
    );
  }
  if (app === null) {
    return (
      <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-5 px-5 py-7" data-hue="blue">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line-strong px-6 py-12 text-center">
          <span className="text-[14px] font-medium">No application {id}</span>
          <span className="max-w-[42ch] text-[12.5px] leading-[1.55] text-dim">{error || "The register holds no row by that id. It may have been removed, or the backend serving the register is not reachable from here."}</span>
          <Button variant="solid" tone="ink" size="sm" href="/applications">Back to the register</Button>
        </div>
      </div>
    );
  }

  const tiles: { id: Extract<Drill, { kind: "kpi" }>["which"]; label: string; value: string; sub: string; tone?: "warn" | "err" | "run" }[] = [
    { id: "volume", label: "Completions", value: metrics ? metrics.volume.toLocaleString("en-GB") : "…", sub: metrics ? `${metrics.conversations} conversations · ${metrics.principals} principals` : "" },
    { id: "cost", label: "Cost", value: metrics ? money(metrics.cost) : "…", sub: metrics ? `${tokens(metrics.tokens.in + metrics.tokens.out)} tokens${metrics.unpriced ? ` · ${metrics.unpriced} unpriced` : ""}` : "" },
    { id: "p50", label: "Latency p50", value: metrics ? ms(metrics.latency.p50) : "…", sub: "gateway to answer" },
    { id: "p95", label: "Latency p95", value: metrics ? ms(metrics.latency.p95) : "…", sub: "the slow tail" },
    { id: "refusals", label: "Refusals", value: metrics ? metrics.refusals.toLocaleString("en-GB") : "…", sub: reasons.length ? reasons.map(([r, n]) => `${r} ${n}`).slice(0, 2).join(" · ") : "screened, limited or over budget", tone: metrics?.refusals ? "err" : undefined },
    { id: "screened", label: "Screened hits", value: metrics ? screenedTotal.toLocaleString("en-GB") : "…", sub: metrics ? `${metrics.blocked} blocked · ${metrics.flagged} flagged` : "", tone: screenedTotal ? "warn" : undefined },
    ...(isRag
      ? ([
          { id: "hit", label: "Retrieval hit rate", value: metrics ? (metrics.rag ? `${Math.round((metrics.rag.hit_rate ?? 0) * 100)}%` : "unknown") : "…", sub: metrics?.rag ? `${metrics.rag.searches} searches` : "not reported by the metrics door yet" },
          { id: "unanswerable", label: "Unanswerable", value: metrics ? (metrics.rag ? String(metrics.rag.unanswerable) : "unknown") : "…", sub: metrics?.rag ? "no passage cleared the bar" : "not reported by the metrics door yet", tone: metrics?.rag?.unanswerable ? "warn" : undefined },
          { id: "grounding", label: "Grounding rate", value: metrics ? (metrics.rag ? `${Math.round((metrics.rag.grounding_rate ?? 0) * 100)}%` : "unknown") : "…", sub: metrics?.rag ? "answers judged grounded" : "not reported by the metrics door yet" },
        ] as const)
      : []),
  ];

  return (
    <div className="min-h-full" data-hue="blue">
      <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-5 px-5 py-7">
        <header className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-2 text-[11px] text-faint">
              <Link href="/applications" className="focusable hover:text-fg">Applications</Link>
              <span>/</span>
              <Mono className="text-[10.5px]">{app.id}</Mono>
            </span>
            <span className="flex flex-wrap items-center gap-3">
              <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">{app.name}</h1>
              <Tag tone={app.class === "rag" ? "ok" : app.class === "chatbot" ? "queue" : "run"}>{CLASS_LABEL[app.class]}</Tag>
              <span className="text-[11.5px] text-faint">{AUTONOMY_LABEL[app.autonomy]}</span>
              {app.blocked ? <Status tone="err" chip>blocked</Status> : <Status tone="ok" chip>admitted</Status>}
            </span>
            <p className="max-w-[72ch] text-[12.5px] leading-[1.55] text-dim">
              Owner {app.owner || "unassigned"} · identity {app.key_prefix ? `${app.key_prefix}…` : "the workflow's own"} · screening {app.policy.screen}
              {app.policy.principal_required ? " · principal required" : ""}
              {app.policy.namespaces.length ? ` · retrieves from ${app.policy.namespaces.join(", ")}` : ""}
              {app.policy.models.length ? ` · models ${app.policy.models.join(", ")}` : app.policy.model ? ` · model ${app.policy.model}` : " · the deployment's default model"}
              {app.policy.system_prompt ? " · a registered system prompt" : ""}
              {app.description ? ` · ${app.description}` : ""}
            </p>
          </div>
          <span className="grow" />
          <div className="flex flex-col items-end gap-1">
            <span className="text-[10.5px] text-faint">{clamped ? "Window · figures cut at 30 days" : "Window"}</span>
            <WindowPick value={win} onChange={setWin} />
          </div>
          {app.source === "application" ? (
            <Button variant="solid" tone={app.blocked ? "ok" : "err"} permission="configure" loading={busy} onClick={toggleBlock}>
              {app.blocked ? "Unblock" : "Block"}
            </Button>
          ) : (
            <Button variant="solid" tone="ink" href={app.source === "attached" ? "/configuration#agents" : `/workflows?id=${encodeURIComponent(app.id)}`}>
              {app.source === "attached" ? "Attached-agent policy" : "Open workflow"}
            </Button>
          )}
        </header>

        {error && <p className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err">{error}</p>}

        {/* ── the band ── */}
        <div className={`grid grid-cols-2 overflow-hidden rounded-md border border-line bg-surface sm:grid-cols-3 ${isRag ? "xl:grid-cols-9" : "xl:grid-cols-6"}`}>
          {tiles.map((t) => (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => setDrill({ kind: "kpi", which: t.id })}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setDrill({ kind: "kpi", which: t.id });
                }
              }}
              aria-pressed={drill?.kind === "kpi" && drill.which === t.id}
              className={`focusable -mr-px -mb-px flex cursor-pointer flex-col gap-1 border-r border-b border-line px-3 py-2.5 text-left transition-colors ${drill?.kind === "kpi" && drill.which === t.id ? "bg-raise/80" : "hover:bg-raise/50"}`}
            >
              <span className="truncate text-[10.5px] text-faint">{t.label}</span>
              <span className="tnum text-[22px] leading-none font-semibold tracking-[-0.02em]" style={t.tone ? { color: `var(--color-${t.tone})` } : undefined}>{t.value}</span>
              <span className="truncate text-[10px] text-ghost">{t.sub}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.3fr_1fr]">
          {/* ── screened by control ── */}
          <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
            <div className="flex w-full items-start gap-3 border-b border-line bg-raise/55 px-4 py-2.5">
              <span className="text-[12.5px] font-semibold tracking-[-0.005em]">Screened hits by control</span>
              <span className="text-[11px] leading-[1.55] text-faint">what the screener matched on prompts and responses · click a control</span>
              <span className="grow" />
              <Button size="sm" variant="quiet" href="/guardrails?view=watch">Open the watch</Button>
            </div>
            <div className="p-4">
              {!metrics && <Skeleton lines={3} />}
              {metrics && screened.length === 0 && <p className="text-[11.5px] text-faint">The screener matched nothing over {win}.</p>}
              {screened.length > 0 && (
                <RankBar
                  data={screened.map(([key, value], i) => ({ label: controlLabel(key), value, color: CAT[(i + 6) % CAT.length], meta: String(value) }))}
                  onPick={(label) => {
                    const key = screened.find(([k]) => controlLabel(k) === label)?.[0];
                    if (key) setDrill({ kind: "control", control: key });
                  }}
                />
              )}
            </div>
            {reasons.length > 0 && (
              <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
                <span className="text-[10.5px] font-medium tracking-[0.04em] text-ghost uppercase">Refusals by reason</span>
                <RankBar data={reasons.map(([label, value], i) => ({ label, value, color: CAT[(i + 7) % CAT.length], meta: String(value) }))} onPick={(label) => setDrill({ kind: "reason", reason: label })} />
              </div>
            )}
          </section>

          {/* ── model mix ── */}
          <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
            <div className="flex w-full items-start gap-3 border-b border-line bg-raise/55 px-4 py-2.5">
              <span className="text-[12.5px] font-semibold tracking-[-0.005em]">Model mix</span>
              <span className="text-[11px] leading-[1.55] text-faint">completions by model, with their cost</span>
            </div>
            <div className="flex flex-col gap-3 p-4">
              {!metrics && <Skeleton lines={3} />}
              {metrics && models.length === 0 && <p className="text-[11.5px] text-faint">Nothing yet.</p>}
              {models.length > 0 && (
                <>
                  <Donut data={models.map((m, i) => ({ label: m.model, value: m.completions, color: CAT[i % CAT.length] }))} size={120} onPick={(label) => setDrill({ kind: "model", model: label })} />
                  <div className="flex flex-col border-t border-line pt-2">
                    {models.map((m, i) => (
                      <button key={m.model} type="button" onClick={() => setDrill({ kind: "model", model: m.model })} className="focusable flex items-center gap-2 rounded-sm px-1 py-1 text-left hover:bg-raise/60">
                        <span className="size-2 shrink-0 rounded-[2px]" style={{ background: CAT[i % CAT.length] }} />
                        <Mono className="grow truncate text-[11px] text-mist">{m.model}</Mono>
                        <span className="tnum text-[10.5px] text-faint">{m.completions} · {tokens(m.tokens.in + m.tokens.out)} tokens · {money(m.cost)}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>
        </div>

        {/* ── conversations ── */}
        <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
          <div className="flex w-full items-start gap-3 border-b border-line bg-raise/55 px-4 py-2.5">
            <span className="text-[12.5px] font-semibold tracking-[-0.005em]">Conversations</span>
            <span className="text-[11px] leading-[1.55] text-faint">{convs ? `${convs.length} last active within ${win} · open one to replay its turns, redacted` : "reading…"}</span>
          </div>
          <ConversationTable rows={convs ?? []} loaded={Boolean(convs)} opening={opening} onOpen={openConversation} />
        </section>

        <p className="pb-2 text-[10.5px] text-ghost">{metrics?.basis ?? "figures come from journalled calls, never estimates"}</p>
      </div>

      {drill && (
        <DrillModal
          title={drillRows.title}
          subtitle={drillRows.subtitle}
          count={drillRows.rows.length}
          onClose={() => setDrill(null)}
          actions={drill.kind === "control" && resolveControl(drill.control) ? <ControlRef control={drill.control} size="md" /> : undefined}
        >
          <ConversationTable rows={drillRows.rows} loaded opening={opening} onOpen={openConversation} />
        </DrillModal>
      )}

      {open && (
        <DrillModal
          title={`Conversation ${open.conversation.id}`}
          subtitle={`${open.conversation.principal || "no principal"} · started ${when(open.conversation.started)} · ${open.conversation.turns} completions · secrets and personal data redacted as in the journals`}
          onClose={() => setOpen(null)}
          actions={
            <span className="flex items-center gap-2">
              {open.conversation.refusals > 0 && <Tag tone="err">{open.conversation.refusals} refused</Tag>}
              {(open.conversation.screened ?? 0) > 0 && <Tag tone="warn">{open.conversation.screened} screened</Tag>}
              <span className="tnum text-[11px] text-faint">{money(open.conversation.cost)}</span>
            </span>
          }
        >
          <div className="flex flex-col gap-3 p-4">
            {open.turns.length === 0 && <p className="text-[11.5px] text-faint">No turn is on the record for this conversation.</p>}
            {open.turns.map((t, i) => (
              <div key={`${t.entry}-${t.role}-${i}`} className={`flex gap-3 ${t.role === "assistant" ? "rounded-md border border-line bg-raise/40 p-3" : ""}`}>
                <span className={`w-20 shrink-0 pt-0.5 text-[10.5px] font-medium ${ROLE_TONE[t.role]}`}>{ROLE_LABEL[t.role]}</span>
                <div className="flex min-w-0 grow flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 text-[10.5px] text-faint">
                    <span>{when(t.at)}</span>
                    {t.model && <Mono className="text-[10.5px]">{t.model}</Mono>}
                    {t.tokens && <span className="tnum">{t.tokens.in} in · {t.tokens.out} out</span>}
                    {t.latency_ms !== null && <span className="tnum">{fmtMs(t.latency_ms)}</span>}
                    {t.cost !== null && <span className="tnum">{money(t.cost)}</span>}
                    {t.refused && <Tag tone="err">refused{t.outcome ? ` · ${t.outcome}` : ""}</Tag>}
                    {t.screened && (
                      <span className="flex items-center gap-1.5">
                        <Tag tone={t.screened.action === "block" ? "err" : "warn"}>{t.screened.action === "block" ? "screened and blocked" : "screened and flagged"}</Tag>
                        {resolveControl(t.screened.control) ? <ControlRef control={t.screened.control} /> : <Mono className="text-[10px]">{t.screened.control}</Mono>}
                      </span>
                    )}
                    <span className="grow" />
                    {t.role === "assistant" && t.run && t.entry && (
                      <Button size="sm" variant="quiet" onClick={() => setLineage({ run: t.run, entry: t.entry })}>Lineage</Button>
                    )}
                  </span>
                  <p className="max-w-[80ch] text-[12.5px] leading-[1.6] whitespace-pre-wrap text-mist">{t.content || <span className="text-ghost">{t.refused ? "(no answer: refused)" : "(empty)"}</span>}</p>
                  {t.passages.length > 0 && (
                    <div className="flex flex-col gap-1 border-t border-line pt-2">
                      <span className="text-[10px] font-medium tracking-[0.04em] text-ghost uppercase">Passages returned · {t.passages.length}</span>
                      {t.passages.map((p, j) => (
                        <span key={j} className="text-[11px] leading-[1.5] text-faint">
                          <span className="font-medium text-fg">{p.title || "untitled"}</span>
                          {p.namespace && <Mono className="ml-1.5 text-[10px]">{p.namespace}</Mono>}
                          {p.excerpt && <span className="block line-clamp-2">{p.excerpt}</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </DrillModal>
      )}

      {lineage && <LineageDrawer runId={lineage.run} entryId={lineage.entry} onClose={() => setLineage(null)} />}
    </div>
  );
}

function ConversationTable({ rows, loaded, opening, onOpen }: { rows: ConversationRow[]; loaded: boolean; opening: string; onOpen: (id: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <DrillTable
        columns={[
          { label: "Conversation", cell: (c) => <span className="flex flex-col"><Mono className="text-[11px] text-fg">{c.id}</Mono>{opening === c.id && <span className="text-[10px] text-ghost">opening…</span>}</span> },
          { label: "Principal", cell: (c) => <span className="text-dim">{c.principal || <span className="text-ghost">none</span>}</span> },
          { label: "Started", cell: (c) => <span className="whitespace-nowrap text-dim">{when(c.started)}</span> },
          { label: "Last", cell: (c) => <span className="whitespace-nowrap text-dim">{when(c.last)}</span> },
          { label: "Completions", cell: (c) => c.turns.toLocaleString("en-GB"), right: true },
          { label: "Models", cell: (c) => <Mono className="text-[10.5px]">{c.models.join(", ") || "—"}</Mono> },
          { label: "Tokens", cell: (c) => tokens(c.tokens.in + c.tokens.out), right: true },
          { label: "Cost", cell: (c) => money(c.cost), right: true },
          { label: "Refused", cell: (c) => <span className={c.refusals ? "text-err" : "text-ghost"}>{c.refusals}</span>, right: true },
        ]}
        rows={rows}
        keyOf={(c) => c.id}
        onRow={(c) => onOpen(c.id)}
        empty={loaded ? "No conversation on the record for this window." : "Reading…"}
      />
    </div>
  );
}
