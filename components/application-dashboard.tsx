"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Failure } from "./pending";
import {
  CLASS_LABEL,
  applicationMetrics,
  autonomyLabel,
  deleteApplication,
  getApplication,
  getConversation,
  listConversations,
  outcomeWords,
  patchApplication,
  type AnswerMode,
  type Application,
  type ApplicationMetrics,
  type Conversation,
  type ConversationRow,
  type Turn,
} from "@/lib/api/l4";
import { fmtMs } from "@/lib/run-fold";
import { agentHref } from "@/lib/agent-link";
import { WindowPick, winMs, type Win } from "./window-pick";
import { Button, Mono, Status, Tag } from "./ui";
import { CAT, Donut, RankBar } from "./charts";
import { DrillModal, DrillTable } from "./drill";
import { ControlRef, resolveControl } from "./control-ref";
import { Skeleton } from "./loaders";
import { usePageFacts } from "./assistant";
import { SystemPromptPanel } from "./system-prompts";
import { ANSWERS_HINT, ANSWER_OPTIONS, costLine, money, policyLine } from "./applications";
import { Pick } from "./select";

/**
 * One registered application's dashboard.
 *
 * Every figure is read from the completions the gateway journalled for it,
 * through its metrics address, over the page window; every figure opens the
 * conversations behind it, and every conversation replays turn by turn with
 * the screening and refusals it met. A cost is the sum over the calls whose
 * model had a price set; calls with none are counted apart, never as $0.
 * Blocking the application makes the gateway refuse every call until it is
 * lifted; removing it revokes its key and keeps its records.
 */

const ms = (v: number | null) => (v === null ? "none answered" : fmtMs(v));
const when = (iso: string) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "unknown");
const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n));

type Drill =
  | { kind: "kpi"; which: "volume" | "cost" | "p50" | "p95" | "refusals" | "screened" }
  | { kind: "control"; control: string }
  | { kind: "reason"; reason: string }
  | { kind: "model"; model: string };

const ROLE_LABEL: Record<Turn["role"], string> = { user: "user", assistant: "answer", system: "system" };
const ROLE_TONE: Record<Turn["role"], string> = { user: "text-dim", assistant: "text-run", system: "text-ghost" };

const controlLabel = (key: string) => {
  const c = resolveControl(key);
  return c ? `${c.id} ${c.title}` : key;
};

/** What the register says of a RAG app's knowledge stores (`not_built_says.retrieval`, agentfactory/applications/register.py). */
const RETRIEVAL_NOT_BUILT = "nothing retrieves from them through this service yet";

export function ApplicationDashboard({ id }: { id: string }) {
  const [now] = useState(() => Date.now());
  const [app, setApp] = useState<Application | null | undefined>(undefined);
  const [error, setError] = useState("");
  const [win, setWin] = useState<Win>("7d");
  // Loaded figures carry the window they were cut over, so a change of window reads as "loading" without a reset inside the effect.
  const [metricsFor, setMetricsFor] = useState<{ win: Win; metrics: ApplicationMetrics } | null>(null);
  const [allConvs, setAllConvs] = useState<ConversationRow[] | null>(null);
  const metrics = metricsFor?.win === win ? metricsFor.metrics : null;
  const [drill, setDrill] = useState<Drill | null>(null);
  const [open, setOpen] = useState<Conversation | null>(null);
  const [opening, setOpening] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);

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

  const registered = app?.source === "application";

  useEffect(() => {
    if (!registered) return;
    let stop = false;
    applicationMetrics(id, win)
      .then((m) => !stop && setMetricsFor({ win, metrics: m }))
      .catch((e: Error) => !stop && setError(e.message));
    return () => {
      stop = true;
    };
  }, [id, win, registered]);

  useEffect(() => {
    if (!registered) return;
    let stop = false;
    listConversations(id)
      .then((c) => !stop && setAllConvs(c))
      .catch((e: Error) => {
        if (stop) return;
        setAllConvs([]);
        setError(e.message);
      });
    return () => {
      stop = true;
    };
  }, [id, registered]);

  // The conversations address lists every conversation; the page window cuts the list by last activity.
  const convs = useMemo(() => (allConvs ? allConvs.filter((c) => win === "all" || now - new Date(c.last || c.started).getTime() <= winMs(win)) : null), [allConvs, win, now]);

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

  const remove = async () => {
    if (!app) return;
    setBusy(true);
    try {
      await deleteApplication(app.id);
      setRemoving(false);
      loadApp();
    } catch (e) {
      setError((e as Error).message);
      setRemoving(false);
    } finally {
      setBusy(false);
    }
  };

  const screened = useMemo(() => Object.entries(metrics?.screened ?? {}).sort((a, b) => b[1] - a[1]), [metrics]);
  const screenedTotal = screened.reduce((s, [, n]) => s + n, 0);
  const reasons = useMemo(() => Object.entries(metrics?.refusals_by_reason ?? {}).sort((a, b) => b[1] - a[1]), [metrics]);
  const models = useMemo(() => (metrics?.models ?? []).slice().sort((a, b) => b.completions - a.completions), [metrics]);

  usePageFacts({
    application: app ? { id: app.id, name: app.name, class: app.class, autonomy: app.autonomy, owner: app.owner, blocked: app.blocked, removed: app.removed_at, policy: registered ? app.policy : null } : app === null ? "not found" : "loading",
    window: win,
    metrics: metrics
      ? { completions: metrics.completions, answered: metrics.answered, conversations: metrics.conversations, principals: metrics.principals, cost: metrics.cost, unpriced: metrics.unpriced, latency: metrics.latency, refusals: metrics.refusals, screened: metrics.screened }
      : registered ? "loading" : "not a registered application",
    conversations: convs ? convs.length : "loading",
  });

  /* The records behind a figure: the conversations, cut and ordered for the question asked. */
  const drillRows = useMemo((): { title: string; subtitle: string; rows: ConversationRow[] } => {
    const all = convs ?? [];
    if (!drill) return { title: "", subtitle: "", rows: [] };
    if (drill.kind === "kpi") {
      switch (drill.which) {
        case "volume":
          return { title: "Conversations", subtitle: `${metrics?.completions ?? 0} calls over ${win} from ${metrics?.principals ?? 0} principals. Calls that named no conversation are counted in the figure and are in no row below.`, rows: all };
        case "cost":
          return { title: "Cost by conversation", subtitle: `The sum over calls whose model had a price set${metrics?.unpriced ? `; ${metrics.unpriced} answered call${metrics.unpriced === 1 ? "" : "s"} had no price set and are in no sum` : ""}.`, rows: [...all].sort((a, b) => (b.cost ?? -1) - (a.cost ?? -1)) };
        case "p50":
        case "p95":
          return { title: "Latency", subtitle: `The model call's latency over the calls a model answered: p50 ${ms(metrics?.latency.p50 ?? null)}, p95 ${ms(metrics?.latency.p95 ?? null)}. The conversations, most recent first.`, rows: all };
        case "refusals":
          return { title: "Refused", subtitle: "Conversations in which at least one call was refused.", rows: all.filter((c) => c.refusals > 0) };
        case "screened":
          return { title: "Screened", subtitle: `${metrics?.blocked ?? 0} refused by screening and ${metrics?.flagged ?? 0} let through with a flag over ${win}. Open a conversation to see the turn the screener matched.`, rows: all };
      }
    }
    if (drill.kind === "control") {
      return { title: controlLabel(drill.control), subtitle: `${metrics?.screened[drill.control] ?? 0} hits over ${win}. Open a conversation to see the turn the control matched.`, rows: all };
    }
    if (drill.kind === "reason") return { title: `Refused: ${outcomeWords(drill.reason)}`, subtitle: `${metrics?.refusals_by_reason[drill.reason] ?? 0} refusals over ${win}. Conversations with at least one refusal.`, rows: all.filter((x) => x.refusals > 0) };
    return { title: drill.model, subtitle: `${metrics?.models.find((m) => m.model === drill.model)?.completions ?? 0} calls over ${win}.`, rows: all.filter((x) => x.models.includes(drill.model)) };
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
        {error ? (
          <Failure what={`Application ${id} could not be read`} message={error} />
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line-strong px-6 py-12 text-center">
            <span className="text-[14px] font-medium">No application {id}</span>
            <span className="max-w-[42ch] text-[12.5px] leading-[1.55] text-dim">The register holds no application or deployed agent by that id.</span>
          </div>
        )}
        <div>
          <Button variant="solid" tone="ink" size="sm" href="/applications">Back to the register</Button>
        </div>
      </div>
    );
  }
  if (!registered) {
    return (
      <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-5 px-5 py-7" data-hue="blue">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line-strong px-6 py-12 text-center">
          <span className="text-[14px] font-medium">{app.name} is a deployed agent</span>
          <span className="max-w-[56ch] text-[12.5px] leading-[1.55] text-dim">Its model calls are runs, read on the Runs page, and its spend is on the Costs page. The register journals no completions for an agent.</span>
          <span className="flex gap-2">
            <Button variant="solid" tone="ink" size="sm" href={agentHref(app.id)}>Open the agent</Button>
            <Button variant="solid" tone="neutral" size="sm" href="/applications">Back to the register</Button>
          </span>
        </div>
      </div>
    );
  }

  const removed = Boolean(app.removed_at);
  const tiles: { id: Extract<Drill, { kind: "kpi" }>["which"]; label: string; value: string; sub: string; tone?: "warn" | "err" | "run" }[] = [
    { id: "volume", label: "Calls", value: metrics ? metrics.completions.toLocaleString("en-GB") : "…", sub: metrics ? `${metrics.answered} answered · ${metrics.conversations} conversations · ${metrics.principals} principals` : "" },
    { id: "cost", label: "Cost", value: metrics ? (metrics.cost === null ? "no price set" : money(metrics.cost)) : "…", sub: metrics ? `${tokens(metrics.tokens.in + metrics.tokens.out)} tokens${metrics.unpriced ? ` · ${metrics.unpriced} with no price set, not in it` : ""}` : "", tone: metrics?.unpriced ? "warn" : undefined },
    { id: "p50", label: "Latency p50", value: metrics ? ms(metrics.latency.p50) : "…", sub: "the model call, answered calls" },
    { id: "p95", label: "Latency p95", value: metrics ? ms(metrics.latency.p95) : "…", sub: "the slow tail" },
    { id: "refusals", label: "Refusals", value: metrics ? metrics.refusals.toLocaleString("en-GB") : "…", sub: reasons.length ? reasons.map(([r, n]) => `${outcomeWords(r)} ${n}`).slice(0, 2).join(" · ") : "none in the window", tone: metrics?.refusals ? "err" : undefined },
    { id: "screened", label: "Screened hits", value: metrics ? screenedTotal.toLocaleString("en-GB") : "…", sub: metrics ? `${metrics.blocked} refused · ${metrics.flagged} flagged` : "", tone: screenedTotal ? "warn" : undefined },
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
              <Tag tone={app.class === "rag" ? "ok" : "queue"}>{CLASS_LABEL[app.class]}</Tag>
              <span className="text-[11.5px] text-faint">autonomy {autonomyLabel(app.autonomy)}</span>
              {removed ? <Status tone="neutral" chip>removed</Status> : app.blocked ? <Status tone="err" chip>blocked</Status> : <Status tone="ok" chip>admitted</Status>}
            </span>
            <p className="max-w-[86ch] text-[12.5px] leading-[1.55] text-dim">
              Owner {app.owner || "not recorded"} · key {app.key_prefix}… · {policyLine(app.policy)} · models {app.policy.models.join(", ")}
              {app.class === "chatbot" ? (app.policy.system_prompt ? " · a registered system prompt" : " · no registered system prompt") : ""}
              {app.created_by ? ` · registered by ${app.created_by}` : ""}
            </p>
            {app.class === "rag" && (
              <p className="max-w-[86ch] text-[12px] leading-[1.55] text-faint">
                Knowledge stores {app.policy.knowledge_stores.join(", ")}: recorded, and {RETRIEVAL_NOT_BUILT}. The application calls the gateway with its own instructions.
              </p>
            )}
            {app.class === "chatbot" && !removed && <AnswerSetting app={app} onChanged={setApp} />}
            {removed && (
              <p className="text-[12px] leading-[1.55] text-faint">
                Removed {when(app.removed_at ?? "")}
                {app.removed_by ? ` by ${app.removed_by}` : ""}; its key is revoked. Its calls and conversations stay on the record.
              </p>
            )}
            {!removed && app.blocked && app.block && (
              <p className="text-[12px] leading-[1.55] text-err">
                Blocked by {app.block.by || "someone not recorded"} {app.block.at ? `on ${when(app.block.at)}` : ""}: {app.block.reason || "no reason was given"}. The gateway refuses every call.
              </p>
            )}
          </div>
          <span className="grow" />
          <div className="flex flex-col items-end gap-1">
            <span className="text-[10.5px] text-faint">Window</span>
            <WindowPick value={win} onChange={setWin} />
          </div>
          {!removed && (
            <span className="flex items-center gap-2">
              {app.class === "chatbot" && (
                <Button variant="solid" tone="ink" href={`/chat?app=${encodeURIComponent(app.id)}`}>
                  Chat with it
                </Button>
              )}
              <Button variant="solid" tone={app.blocked ? "ok" : "err"} permission="configure" loading={busy && !removing} onClick={toggleBlock}>
                {app.blocked ? "Unblock" : "Block"}
              </Button>
              <Button variant="solid" tone="err" permission="configure" onClick={() => setRemoving(true)}>
                Remove
              </Button>
            </span>
          )}
        </header>

        {error && <Failure what="Part of this application could not be read" message={error} />}

        {/* ── the band ── */}
        <div className="grid grid-cols-2 overflow-hidden rounded-md border border-line bg-surface sm:grid-cols-3 xl:grid-cols-6">
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
              <span className="tnum text-[22px] leading-none font-semibold tracking-[-0.02em]" style={t.tone && t.id !== "cost" ? { color: `var(--color-${t.tone})` } : undefined}>{t.value}</span>
              <span className={`truncate text-[10px] ${t.id === "cost" && t.tone ? "text-warn" : "text-ghost"}`}>{t.sub}</span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.3fr_1fr]">
          {/* ── screened by control ── */}
          <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
            <div className="flex w-full items-start gap-3 border-b border-line bg-raise/55 px-4 py-2.5">
              <span className="text-[12.5px] font-semibold tracking-[-0.005em]">Screened hits by control</span>
              <span className="text-[11px] leading-[1.55] text-faint">what the screener matched on prompts and replies, and the leak check · click a control</span>
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
                <RankBar
                  data={reasons.map(([code, value], i) => ({ label: outcomeWords(code), value, color: CAT[(i + 7) % CAT.length], meta: String(value) }))}
                  onPick={(label) => {
                    const code = reasons.find(([c]) => outcomeWords(c) === label)?.[0];
                    if (code) setDrill({ kind: "reason", reason: code });
                  }}
                />
              </div>
            )}
          </section>

          {/* ── model mix ── */}
          <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
            <div className="flex w-full items-start gap-3 border-b border-line bg-raise/55 px-4 py-2.5">
              <span className="text-[12.5px] font-semibold tracking-[-0.005em]">Model mix</span>
              <span className="text-[11px] leading-[1.55] text-faint">calls by model, with their cost</span>
            </div>
            <div className="flex flex-col gap-3 p-4">
              {!metrics && <Skeleton lines={3} />}
              {metrics && models.length === 0 && <p className="text-[11.5px] text-faint">No call reached a model over {win}.</p>}
              {models.length > 0 && (
                <>
                  <Donut data={models.map((m, i) => ({ label: m.model, value: m.completions, color: CAT[i % CAT.length] }))} size={120} onPick={(label) => setDrill({ kind: "model", model: label })} />
                  <div className="flex flex-col border-t border-line pt-2">
                    {models.map((m, i) => (
                      <button key={m.model} type="button" onClick={() => setDrill({ kind: "model", model: m.model })} className="focusable flex items-center gap-2 rounded-sm px-1 py-1 text-left hover:bg-raise/60">
                        <span className="size-2 shrink-0 rounded-[2px]" style={{ background: CAT[i % CAT.length] }} />
                        <Mono className="grow truncate text-[11px] text-mist">{m.model}</Mono>
                        <span className="tnum text-[10.5px] text-faint">
                          {m.completions} · {tokens(m.tokens.in + m.tokens.out)} tokens · {costLine(m.cost, m.unpriced)}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>
        </div>

        {/* ── the system prompt, version by version ── */}
        <SystemPromptPanel app={app} onApplication={setApp} />

        {/* ── conversations ── */}
        <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
          <div className="flex w-full items-start gap-3 border-b border-line bg-raise/55 px-4 py-2.5">
            <span className="text-[12.5px] font-semibold tracking-[-0.005em]">Conversations</span>
            <span className="text-[11px] leading-[1.55] text-faint">
              {convs ? `${convs.length} last active within ${win} · a person's chat from the console, or a conversation the application named (X-Conversation-Id) · open one to replay it, masked` : "reading…"}
            </span>
          </div>
          <ConversationTable rows={convs ?? []} loaded={Boolean(convs)} opening={opening} onOpen={openConversation} />
        </section>

        <p className="pb-2 text-[10.5px] text-ghost">{metrics?.basis || "figures are counted from the completions the gateway journalled"}</p>
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
          subtitle={`${open.conversation.kept ? `${open.conversation.principal || "a person not recorded"}'s chat from the console` : `named by the application${open.conversation.principal ? `, end user ${open.conversation.principal}` : ""}`} · started ${when(open.conversation.started)} · ${open.conversation.completions} calls · secrets and personal data masked as journalled`}
          onClose={() => setOpen(null)}
          actions={
            <span className="flex items-center gap-2">
              {open.conversation.refusals > 0 && <Tag tone="err">{open.conversation.refusals} refused</Tag>}
              <span className="tnum text-[11px] text-faint">{costLine(open.conversation.cost, open.conversation.unpriced)}</span>
            </span>
          }
        >
          <div className="flex flex-col gap-3 p-4">
            {open.turns.length === 0 && <p className="text-[11.5px] text-faint">No call is on the record for this conversation.</p>}
            {open.turns.map((t, i) => (
              <div key={`${t.completion}-${t.role}-${i}`} className={`flex gap-3 ${t.role === "assistant" ? "rounded-md border border-line bg-raise/40 p-3" : ""}`}>
                <span className={`w-20 shrink-0 pt-0.5 text-[10.5px] font-medium ${ROLE_TONE[t.role]}`}>{ROLE_LABEL[t.role]}</span>
                <div className="flex min-w-0 grow flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2 text-[10.5px] text-faint">
                    <span>{when(t.at)}</span>
                    {t.model && <Mono className="text-[10.5px]">{t.model}</Mono>}
                    {t.tokens && <span className="tnum">{t.tokens.in} in · {t.tokens.out} out</span>}
                    {t.latency_ms !== null && <span className="tnum">{fmtMs(t.latency_ms)}</span>}
                    {t.role === "assistant" && !t.refused && <span className="tnum">{t.cost !== null ? money(t.cost) : t.unpriced ? "no price set" : ""}</span>}
                    {t.refused && <Tag tone="err">refused: {outcomeWords(t.outcome)}</Tag>}
                    {t.screened && (
                      <span className="flex items-center gap-1.5">
                        <Tag tone={t.screened.action === "block" ? "err" : "warn"}>{t.screened.action === "block" ? "screened and refused" : "screened and flagged"}</Tag>
                        {resolveControl(t.screened.control) ? <ControlRef control={t.screened.control} /> : <Mono className="text-[10px]">{t.screened.control}</Mono>}
                      </span>
                    )}
                    {t.role === "assistant" && <Mono className="text-[10px] text-ghost">{t.completion}</Mono>}
                  </span>
                  <p className="max-w-[80ch] text-[12.5px] leading-[1.6] whitespace-pre-wrap text-mist">{t.content || <span className="text-ghost">{t.refused ? t.reason || "no answer: refused" : "(empty)"}</span>}</p>
                </div>
              </div>
            ))}
          </div>
        </DrillModal>
      )}

      {removing && (
        <DrillModal
          title={`Remove ${app.name}?`}
          subtitle="It leaves the register and its key is revoked at once: the gateway refuses every call that carries it. Its calls, conversations and prompt versions stay on the record."
          onClose={() => !busy && setRemoving(false)}
        >
          <div className="flex justify-end gap-2 p-4">
            <Button variant="solid" tone="neutral" size="sm" disabled={busy} onClick={() => setRemoving(false)}>
              Keep it
            </Button>
            <Button
              variant="solid"
              tone="err"
              size="sm"
              permission="configure"
              loading={busy}
              onClick={remove}
            >
              Remove and revoke the key
            </Button>
          </div>
        </DrillModal>
      )}
    </div>
  );
}

function ConversationTable({ rows, loaded, opening, onOpen }: { rows: ConversationRow[]; loaded: boolean; opening: string; onOpen: (id: string) => void }) {
  return (
    <div className="overflow-x-auto">
      <DrillTable
        columns={[
          { label: "Conversation", cell: (c) => <span className="flex flex-col"><Mono className="text-[11px] text-fg">{c.id}</Mono><span className="text-[10px] text-ghost">{opening === c.id ? "opening…" : c.kept ? "a person's chat" : "named by the application"}</span></span> },
          { label: "Principal", cell: (c) => <span className="text-dim">{c.principal || <span className="text-ghost">none named</span>}</span> },
          { label: "Started", cell: (c) => <span className="whitespace-nowrap text-dim">{when(c.started)}</span> },
          { label: "Last", cell: (c) => <span className="whitespace-nowrap text-dim">{when(c.last)}</span> },
          { label: "Calls", cell: (c) => c.completions.toLocaleString("en-GB"), right: true },
          { label: "Models", cell: (c) => <Mono className="text-[10.5px]">{c.models.join(", ") || "—"}</Mono> },
          { label: "Tokens", cell: (c) => tokens(c.tokens.in + c.tokens.out), right: true },
          { label: "Cost", cell: (c) => costLine(c.cost, c.unpriced), right: true },
          { label: "Refused", cell: (c) => <span className={c.refusals ? "text-err" : "text-ghost"}>{c.refusals}</span>, right: true },
        ]}
        rows={rows}
        keyOf={(c) => c.id}
        onRow={(c) => onOpen(c.id)}
        empty={loaded ? "No conversation was active in this window." : "Reading…"}
      />
    </div>
  );
}

/**
 * How a chatbot answers a person in the console's chat (its policy's
 * `answers`), changed by a person with `configure`: `PATCH /api/applications`
 * with that one policy field. Anyone else sees it and cannot change it; the
 * service refuses them all the same.
 */
function AnswerSetting({ app, onChanged }: { app: Application; onChanged: (a: Application) => void }) {
  const [want, setWant] = useState<AnswerMode>(app.policy.answers);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      onChanged(await patchApplication(app.id, { policy: { answers: want } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex max-w-[86ch] flex-col gap-1.5" data-setting="answers">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-medium text-fg">Answers in the console&rsquo;s chat</span>
        <span className="w-44">
          <Pick value={want} onChange={setWant} options={ANSWER_OPTIONS} aria-label="Answers in the console's chat" />
        </span>
        <Button size="sm" variant="solid" tone="ink" permission="configure" loading={saving} disabled={want === app.policy.answers} onClick={save}>
          Save
        </Button>
      </span>
      <span className="text-[11.5px] leading-[1.5] text-faint">{ANSWERS_HINT}</span>
      {error && (
        <span role="alert" className="text-[11.5px] leading-[1.5] text-err">
          Not changed: {error}
        </span>
      )}
    </div>
  );
}
