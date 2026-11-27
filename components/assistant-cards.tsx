"use client";

import Link from "next/link";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { answerDecision, askAbout, changeFindingStatus, holdAgent, killFromCard, loadCard, resolveHref, type ActionOutcome, type AgentCard, type ApprovalsCard, type CardData, type CardKind, type CardLoad, type RunCard, type UseCasesCard } from "@/lib/assistant-cards";
import { FINDING_STATUSES, type Finding, type FindingStatus } from "@/lib/api/pending";
import type { Application } from "@/lib/api/l4";
import type { Gate } from "@/lib/api/l5";
import { gateAccess } from "@/lib/gates";
import { followsLive } from "@/lib/steer";
import { useSession } from "@/lib/use-session";
import { Button } from "./ui";
import { Pick } from "./select";
import { Textarea } from "./forms";
import { FINDING_STATUS_META } from "./finding-marks";

/**
 * A record or page drawn inside the conversation, where an answer's tile,
 * table row or link was clicked: the chat is never left. The card reads the
 * record through the console's readers (lib/assistant-cards.ts) and shows its
 * key facts; "Open page" is the one control that leaves for the console page,
 * and a link inside the card (a finding's run) opens in the card itself, with
 * a way back.
 *
 * Colours are the chat's tokens (`--ask-*`, app/globals.css), each with a
 * fallback to the console's own, so the card reads in both themes before and
 * after the chat block is loaded.
 */

/* ═══════════════════ colour ═══════════════════ */

type ToneName = "critical" | "high" | "medium" | "low" | "info" | "ok" | "warn" | "err" | "run" | "violet" | "slate";

/** A tone's mark (a dot, a bar), its tint (a chip's fill, mixed into the surface: never transparent) and its ink (text on the tint). */
const TONES: Record<ToneName, { mark: string; bg: string; ink: string }> = {
  critical: tone("--ask-sev-critical", "red", "--t-err"),
  high: tone("--ask-sev-high", "orange", "--t-warn"),
  medium: tone("--ask-sev-medium", "amber", "--t-run"),
  low: tone("--ask-sev-low", "teal", "--t-ok"),
  info: tone("--ask-sev-info", "slate", "--t-fg-3"),
  ok: tone("--ask-ok", "green", "--t-ok"),
  warn: tone("--ask-warn", "amber", "--t-warn"),
  err: tone("--ask-err", "red", "--t-err"),
  run: tone("--ask-info", "blue", "--t-queue"),
  violet: tone(null, "violet", "--t-queue"),
  slate: tone("--ask-sev-info", "slate", "--t-fg-3"),
};

/**
 * The chat's tokens name a tone's ink plainly (`--ask-ok`), its mark with `-mark` and its tint with `-bg`; the
 * hue itself is `--ask-<hue>`. Each falls back to the answer-block hues, then to the console's own state colour.
 */
function tone(named: string | null, hue: string, base: string): { mark: string; bg: string; ink: string } {
  const hueMark = `var(--ask-${hue}, var(--t-ab-${hue}, var(${base})))`;
  const hueInk = `var(--ask-${hue}-ink, var(--t-ab-${hue}-ink, var(--t-fg)))`;
  const mark = named ? `var(${named}-mark, ${hueMark})` : hueMark;
  const mixed = `color-mix(in srgb, ${mark} 13%, var(--ask-surface, var(--t-surface)))`;
  return { mark, bg: named ? `var(${named}-bg, ${mixed})` : mixed, ink: named ? `var(${named}, ${hueInk})` : hueInk };
}

/** Text on a solid tone (a kind's icon, the Ask button): white in light mode, near-black in dark, as the chat's action button. */
const ON_SOLID = "var(--ask-on-action, #ffffff)";

/** Each kind of card has its own colour: a categorical slot, never red (red means a failure or a refusal). */
const KIND: Record<CardKind, { label: string; colour: string; button: string; icon: ReactNode }> = {
  finding: { label: "Finding", colour: "var(--ask-cat-6, var(--ask-magenta, var(--t-c6)))", button: "var(--ask-magenta-ink, var(--t-ab-magenta-ink, var(--t-ink)))", icon: <IconShield /> },
  run: { label: "Run", colour: "var(--ask-cat-1, var(--ask-blue, var(--t-c1)))", button: "var(--ask-blue-ink, var(--t-ab-blue-ink, var(--t-ink)))", icon: <IconPlay /> },
  agent: { label: "Agent", colour: "var(--ask-cat-4, var(--ask-violet, var(--t-c4)))", button: "var(--ask-violet-ink, var(--t-ab-violet-ink, var(--t-ink)))", icon: <IconBot /> },
  application: { label: "Application", colour: "var(--ask-cat-5, var(--ask-olive, var(--t-c5)))", button: "var(--ask-olive-ink, var(--t-ab-olive-ink, var(--t-ink)))", icon: <IconApp /> },
  use_cases: { label: "Use cases", colour: "var(--ask-cat-3, var(--ask-teal, var(--t-c3)))", button: "var(--ask-teal-ink, var(--t-ab-teal-ink, var(--t-ink)))", icon: <IconStack /> },
  approvals: { label: "Approvals", colour: "var(--ask-cat-2, var(--ask-amber, var(--t-c2)))", button: "var(--ask-amber-ink, var(--t-ab-amber-ink, var(--t-ink)))", icon: <IconGate /> },
  page: { label: "Console page", colour: "var(--ask-slate, var(--t-ab-slate, var(--t-fg-3)))", button: "var(--ask-slate-ink, var(--t-ab-slate-ink, var(--t-ink)))", icon: <IconPage /> },
  unknown: { label: "Link", colour: "var(--ask-err-mark, var(--ask-red, var(--t-err)))", button: "var(--ask-red-ink, var(--t-ab-red-ink, var(--t-ink)))", icon: <IconPage /> },
};

const SEVERITY_TONE: Record<string, ToneName> = { critical: "critical", high: "high", medium: "medium", low: "low", info: "info" };
/** The Findings page's words (components/finding-marks.tsx) in the answer blocks' tones (components/answer-blocks.tsx STATE), so a row and the card it opens agree. */
const FINDING_STATUS: Record<string, { tone: ToneName; label: string }> = {
  open: { tone: "run", label: FINDING_STATUS_META.open.label },
  confirmed: { tone: "violet", label: FINDING_STATUS_META.confirmed.label },
  false_positive: { tone: "slate", label: FINDING_STATUS_META.false_positive.label },
  accepted: { tone: "slate", label: FINDING_STATUS_META.accepted.label },
  remediated: { tone: "ok", label: FINDING_STATUS_META.remediated.label },
};
const RUN_STATE: Record<string, { tone: ToneName; label: string }> = {
  done: { tone: "ok", label: "Complete" },
  failed: { tone: "err", label: "Failed" },
  killed: { tone: "err", label: "Killed by operator" },
  suspended: { tone: "warn", label: "Awaiting approval" },
  running: { tone: "run", label: "Running" },
  closed: { tone: "slate", label: "Closed at the gate" },
};
const USE_CASE_STATE: Record<string, ToneName> = { approved: "ok", draft: "slate", pending: "warn", submitted: "warn", retired: "slate", rejected: "err" };

/* ═══════════════════ values ═══════════════════ */

function when(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function took(from: string | null, to: string | null): string | null {
  if (!from || !to) return null;
  const ms = Date.parse(to) - Date.parse(from);
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}

function money(n: number): string {
  if (n === 0) return "$0.00";
  if (Math.abs(n) < 0.01) return `$${n.toFixed(6).replace(/0+$/, "")}`;
  return `$${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** One line on what a page is for: the description's first sentence. */
function firstSentence(s: string): string {
  const m = /^(.+?[.!?])(\s|$)/.exec(s.trim());
  return m ? m[1] : s;
}

function words(s: string): string {
  return s.replace(/_/g, " ");
}

/* ═══════════════════ pieces ═══════════════════ */

function Chip({ t, children, title }: { t: ToneName; children: ReactNode; title?: string }) {
  const c = TONES[t];
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-[11px] leading-none font-semibold whitespace-nowrap"
      style={{ background: c.bg, color: c.ink, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${c.mark} 30%, transparent)` }}
    >
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: c.mark }} />
      {children}
    </span>
  );
}

function PlainChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-line bg-raise px-2 py-[3px] text-[11px] leading-none font-medium whitespace-nowrap text-mist">
      {children}
    </span>
  );
}

function None({ children = "none" }: { children?: ReactNode }) {
  return <span className="text-ghost italic">{children}</span>;
}

function Fact({ label, children, mono = false, wide = false }: { label: string; children: ReactNode; mono?: boolean; wide?: boolean }) {
  return (
    <div className={`min-w-0 ${wide ? "col-span-full" : ""}`}>
      <dt className="text-[10.5px] font-medium tracking-[0.04em] text-dim uppercase">{label}</dt>
      <dd className={`mt-0.5 text-[12.5px] leading-snug break-words text-fg ${mono ? "font-mono text-[11.5px]" : ""}`}>{children ?? <None />}</dd>
    </div>
  );
}

function Facts({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-3">{children}</dl>;
}

function Note({ label, t, children }: { label: string; t: ToneName; children: ReactNode }) {
  const c = TONES[t];
  return (
    <div className="rounded-md border-l-[3px] px-3 py-2" style={{ borderColor: c.mark, background: c.bg }}>
      <div className="text-[10.5px] font-semibold tracking-[0.04em] uppercase" style={{ color: c.ink }}>
        {label}
      </div>
      <div className="mt-0.5 text-[12.5px] leading-relaxed text-fg">{children}</div>
    </div>
  );
}

/** A link inside a card that opens its record in the card, not on a page. */
function Inner({ onOpen, children }: { onOpen: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onOpen} className="focusable cursor-pointer text-left font-mono text-[11.5px] break-all underline decoration-dotted underline-offset-2 hover:decoration-solid" style={{ color: TONES.run.ink }}>
      {children}
    </button>
  );
}

/* ═══════════════════ the card ═══════════════════ */

export function InChatCard({ href, label, onClose, onSend }: { href: string; label?: string; onClose: () => void; onSend: (text: string) => void }) {
  /** The card's own trail: a link inside the card opens here, and Back returns. */
  const [trail, setTrail] = useState<{ href: string; label?: string }[]>([{ href, label }]);
  const at = trail[trail.length - 1];
  const target = resolveHref(at.href);
  const [load, setLoad] = useState<{ key: string; tick: number; value: CardLoad } | null>(null);
  /** Bumped to re-read the record: after an action, or Try again. The last read stays shown meanwhile. */
  const [tick, setTick] = useState(0);
  /** The one line an action left ("Approved by you, 14:02"), for the record it was taken on. */
  const [done, setDone] = useState<{ key: string; text: string } | null>(null);
  const key = `${at.href}\u0000${at.label ?? ""}`;

  useEffect(() => {
    setTrail([{ href, label }]);
  }, [href, label]);

  useEffect(() => {
    let live = true;
    loadCard(resolveHref(at.href), at.label ?? "").then((value) => {
      if (live) setLoad({ key, tick, value });
    });
    return () => {
      live = false;
    };
  }, [at.href, at.label, key, tick]);

  const kind = KIND[target.kind];
  const ready = load && load.key === key ? load.value : null;
  const rereading = Boolean(ready && load && load.tick !== tick);
  const data = ready?.state === "ok" ? ready.data : null;
  const open = (h: string, l?: string) => setTrail((t) => [...t, { href: h, label: l }]);
  const acted = (text: string) => {
    setDone({ key, text });
    setTick((n) => n + 1);
  };
  const title = data ? titleOf(data) : at.label || target.id || kind.label;

  return (
    <article
      className="af-fade-up w-full max-w-[760px] overflow-hidden rounded-lg border bg-surface"
      style={{ borderColor: `color-mix(in srgb, ${kind.colour} 34%, var(--ask-line, var(--t-line)))`, background: "var(--ask-surface, var(--t-surface))", boxShadow: "0 1px 2px rgb(0 0 0 / 0.06), 0 6px 18px -10px rgb(0 0 0 / 0.18)" }}
      aria-label={`${kind.label}: ${title}`}
    >
      <header
        className="flex items-start gap-3 px-3.5 py-3"
        style={{ background: `color-mix(in srgb, ${kind.colour} 13%, var(--ask-surface, var(--t-surface)))`, borderBottom: `1px solid color-mix(in srgb, ${kind.colour} 28%, var(--ask-line, var(--t-line)))` }}
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-md" style={{ background: kind.colour, color: ON_SOLID }} aria-hidden>
          {kind.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {trail.length > 1 && (
              <button
                type="button"
                onClick={() => setTrail((t) => t.slice(0, -1))}
                className="focusable inline-flex cursor-pointer items-center gap-1 rounded bg-surface px-1.5 py-0.5 text-[10.5px] font-semibold text-fg hover:brightness-95"
                aria-label="Back to the previous card"
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M10 3 5 8l5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                Back
              </button>
            )}
            <span className="text-[10.5px] font-semibold tracking-[0.06em] uppercase" style={{ color: `color-mix(in srgb, ${kind.colour} 70%, var(--t-fg))` }}>
              {kind.label}
            </span>
            {target.id && <span className="truncate font-mono text-[10.5px] text-dim">{target.id}</span>}
          </div>
          <h3 className="mt-0.5 text-[14.5px] leading-snug font-semibold text-fg">{title}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close this card"
          title="Close"
          className="focusable grid size-7 shrink-0 cursor-pointer place-items-center rounded-md bg-surface text-fg transition-[filter] hover:brightness-95"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="space-y-3 px-3.5 py-3" aria-busy={rereading || undefined}>
        {done && done.key === key && (
          <div className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-[12px] font-semibold" style={{ background: TONES.ok.bg, color: TONES.ok.ink }} role="status">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="m3 8.5 3.2 3L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="min-w-0">{done.text}</span>
            {rereading && <span className="ml-auto text-[11px] font-medium opacity-80">re-reading…</span>}
          </div>
        )}
        {!ready ? <Skeleton /> : ready.state === "missing" ? <Missing load={ready} kind={target.kind} onRetry={() => setTick((n) => n + 1)} /> : <Body data={ready.data} open={open} onSend={onSend} acted={acted} />}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t px-3.5 py-2.5" style={{ borderColor: "var(--ask-line, var(--t-line))", background: "var(--ask-surface-2, var(--t-canvas))" }}>
        {target.kind !== "unknown" && (
          <Link
            href={at.href}
            className="focusable inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12.5px] font-semibold whitespace-nowrap transition-[filter] hover:brightness-[1.08] active:brightness-95"
            style={{ background: "var(--ask-action, var(--t-ab-link, var(--t-ink)))", color: "var(--ask-on-action, var(--t-ab-on-link, var(--t-on-ink)))" }}
          >
            Open page
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M6 3h7v7M13 3 4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        )}
        {data && (
          <button
            type="button"
            onClick={() => onSend(askAbout(data))}
            className="focusable inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-3 text-[12.5px] font-semibold whitespace-nowrap transition-[filter] hover:brightness-[1.08] active:brightness-95"
            style={{ background: kind.button, color: ON_SOLID }}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
            Ask about this
          </button>
        )}
      </footer>
    </article>
  );
}

function titleOf(d: CardData): string {
  switch (d.kind) {
    case "finding":
      return d.finding.title || d.finding.id;
    case "run":
      return d.run.agent ? `${d.run.agent} run` : d.run.id;
    case "agent":
      return d.agent.name;
    case "application":
      return d.application.name || d.application.id;
    case "use_cases":
      return d.useCases.picked ? (d.useCases.rows.find((r) => r.id === d.useCases.picked)?.name ?? "Registered use cases") : "Registered use cases";
    case "approvals":
      return d.approvals.count > 0 ? `${d.approvals.count} gate${d.approvals.count === 1 ? "" : "s"} waiting` : "No gate waiting";
    case "page":
      return d.page.title;
  }
}

function Skeleton() {
  const bar = (w: string) => <div className="af-pulse h-3 rounded bg-raise" style={{ width: w }} />;
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      <div className="flex gap-2">
        <div className="af-pulse h-5 w-16 rounded-full bg-raise" />
        <div className="af-pulse h-5 w-20 rounded-full bg-raise" />
      </div>
      {bar("92%")}
      {bar("70%")}
      <div className="grid grid-cols-3 gap-4 pt-1">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-1.5">
            {bar("50%")}
            {bar("80%")}
          </div>
        ))}
      </div>
    </div>
  );
}

function Missing({ load, kind, onRetry }: { load: Extract<CardLoad, { state: "missing" }>; kind: CardKind; onRetry: () => void }) {
  const head = load.notBuilt ? "Not built" : load.notFound ? "Not found" : kind === "unknown" ? "Not a console link" : "Could not be read";
  return (
    <div className="space-y-2.5" role="alert">
      <Note label={head} t={load.notBuilt ? "slate" : "err"}>
        {load.reason}
      </Note>
      {!load.notFound && !load.notBuilt && kind !== "unknown" && (
        <button type="button" onClick={onRetry} className="focusable inline-flex h-7 cursor-pointer items-center rounded-md bg-raise px-2.5 text-[12px] font-semibold text-fg hover:brightness-95">
          Try again
        </button>
      )}
    </div>
  );
}

function Body({ data, open, onSend, acted }: { data: CardData; open: (href: string, label?: string) => void; onSend: (text: string) => void; acted: (text: string) => void }) {
  switch (data.kind) {
    case "finding":
      return (
        <>
          <FindingBody f={data.finding} open={open} />
          <StatusAction f={data.finding} acted={acted} />
        </>
      );
    case "run":
      return (
        <>
          <RunBody r={data.run} open={open} />
          <RunActions r={data.run} open={open} acted={acted} />
        </>
      );
    case "agent":
      return (
        <>
          <AgentBody a={data.agent} />
          <HoldAction a={data.agent} acted={acted} />
        </>
      );
    case "application":
      return <ApplicationBody a={data.application} />;
    case "use_cases":
      return <UseCasesBody u={data.useCases} />;
    case "approvals":
      return <ApprovalsBody g={data.approvals} open={open} acted={acted} />;
    case "page":
      return (
        <div className="space-y-2.5">
          {data.page.shows && <p className="line-clamp-2 text-[12.5px] leading-relaxed text-mist">{firstSentence(data.page.shows)}</p>}
          {data.page.suggested.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {data.page.suggested.slice(0, 3).map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => onSend(q)}
                  className="focusable cursor-pointer rounded-full border border-line bg-raise px-2.5 py-1 text-left text-[11.5px] font-medium text-fg hover:brightness-95"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
      );
  }
}

/* ═══════════════════ one card per kind ═══════════════════ */

function FindingBody({ f, open }: { f: Finding; open: (href: string, label?: string) => void }) {
  const st = FINDING_STATUS[f.status] ?? { tone: "slate" as ToneName, label: words(f.status) };
  const d = f.detail ?? {};
  const file = typeof d.file === "string" && d.file ? d.file : null;
  const lines = typeof d.line_start === "number" ? (typeof d.line_end === "number" && d.line_end !== d.line_start ? `${d.line_start}–${d.line_end}` : `${d.line_start}`) : null;
  const target = [d.target, d.rule_id, d.device].find((x) => typeof x === "string" && x) as string | undefined;
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip t={SEVERITY_TONE[f.severity] ?? "info"}>{words(f.severity).replace(/^./, (c) => c.toUpperCase())}</Chip>
        <Chip t={st.tone}>{st.label}</Chip>
        {f.workload && <PlainChip>{words(String(f.workload))}</PlainChip>}
        {typeof f.confidence === "number" && <PlainChip>{Math.round(f.confidence <= 1 ? f.confidence * 100 : f.confidence)}% confidence</PlainChip>}
      </div>
      {f.summary && <p className="line-clamp-5 text-[12.5px] leading-relaxed text-fg">{f.summary}</p>}
      <Facts>
        {file && (
          <Fact label="File and line" mono wide>
            {file}
            {lines ? `:${lines}` : ""}
          </Fact>
        )}
        {typeof d.cwe === "string" && d.cwe && <Fact label="CWE">{d.cwe}</Fact>}
        {typeof d.rule === "string" && d.rule && <Fact label="Rule" mono>{d.rule}</Fact>}
        {target && <Fact label="Target">{target}</Fact>}
        <Fact label="Agent">{f.agent || null}</Fact>
        <Fact label="Run">{f.run ? <Inner onOpen={() => open(`/runs?id=${encodeURIComponent(f.run)}`, f.run)}>{f.run}</Inner> : null}</Fact>
        <Fact label="Found">{when(f.created_at)}</Fact>
        {f.updated_at && f.updated_at !== f.created_at && <Fact label="Updated">{when(f.updated_at)}</Fact>}
        <Fact label="Owner">{f.owner?.name || f.owner?.email || null}</Fact>
        <Fact label="Evidence">{f.evidence?.length ? `${f.evidence.length} journal entr${f.evidence.length === 1 ? "y" : "ies"}` : null}</Fact>
      </Facts>
      {f.recommendation && (
        <Note label="Recommendation" t="ok">
          {f.recommendation}
        </Note>
      )}
    </>
  );
}

function resultText(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && Object.keys(v as object).length === 0) return null;
  const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
  return s.length > 900 ? `${s.slice(0, 900)}\n…` : s;
}

function RunBody({ r, open }: { r: RunCard; open: (href: string, label?: string) => void }) {
  const st = RUN_STATE[r.state] ?? { tone: "slate" as ToneName, label: words(r.state) || "No state recorded" };
  const result = resultText(r.result);
  const cost =
    r.cost === null ? (
      <None>not recorded</None>
    ) : (
      <>
        {money(r.cost)}
        {r.unpriced > 0 && <span className="text-dim"> + {r.unpriced} call{r.unpriced === 1 ? "" : "s"} with no price set</span>}
      </>
    );
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip t={st.tone}>{st.label}</Chip>
        {r.refusals !== null && r.refusals > 0 && <Chip t="err">{r.refusals} refused</Chip>}
        {r.waitingOn && <Chip t="warn">Waiting on {r.waitingOn}</Chip>}
      </div>
      <Facts>
        <Fact label="Agent">
          {r.agent ? (
            <Inner onOpen={() => open(`/agent?id=${encodeURIComponent(r.agent)}`, r.agent)}>
              {r.agent}
              {r.agentVersion !== null ? ` · v${r.agentVersion}` : ""}
            </Inner>
          ) : null}
        </Fact>
        <Fact label="Started">{when(r.startedAt)}</Fact>
        <Fact label="Ended">{when(r.finishedAt) ?? (r.state === "running" || r.state === "suspended" ? <None>not yet</None> : null)}</Fact>
        <Fact label="Took">{took(r.startedAt, r.finishedAt) ?? (!r.finishedAt && (r.state === "running" || r.state === "suspended") ? <None>not yet</None> : null)}</Fact>
        <Fact label="Cost">{cost}</Fact>
        <Fact label="Tool calls">{r.toolCalls === null ? null : r.toolCalls.toLocaleString("en-GB")}</Fact>
        <Fact label="Refusals">{r.refusals === null ? <span title={r.refusalsUnread} className="text-ghost italic">not read: {r.refusalsUnread || "no count"}</span> : r.refusals.toLocaleString("en-GB")}</Fact>
        {r.useCase && <Fact label="Use case">{r.useCase}</Fact>}
      </Facts>
      {r.error && (
        <Note label={r.state === "killed" ? "Why it was stopped" : "Error"} t="err">
          <span className="line-clamp-4">{r.error}</span>
        </Note>
      )}
      {result && (
        <div>
          <div className="text-[10.5px] font-medium tracking-[0.04em] text-dim uppercase">Result</div>
          <pre className="mt-1 max-h-[8.5rem] overflow-hidden rounded-md border border-line bg-sunken px-2.5 py-2 font-mono text-[11px] leading-[1.45] whitespace-pre-wrap text-fg">{result}</pre>
        </div>
      )}
    </>
  );
}

function AgentBody({ a }: { a: AgentCard }) {
  const deployed = a.deployedVersion !== null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip t={a.source === "saved" ? "violet" : "run"}>{a.source === "saved" ? "Saved here" : "Attached"}</Chip>
        {a.source === "saved" && (a.retired ? <Chip t="slate">Retired</Chip> : deployed ? <Chip t="ok">Deployed v{a.deployedVersion}</Chip> : <Chip t="warn">Not deployed</Chip>)}
        {a.source === "saved" && deployed && a.version !== null && a.version !== a.deployedVersion && <Chip t="warn">Draft v{a.version}</Chip>}
        {a.hold?.state === "ok" && a.hold.paused && (
          <Chip t="warn" title={[a.hold.paused.reason, a.hold.paused.by].filter(Boolean).join(" · ")}>
            {a.hold.paused.mode === "drain" ? "Draining" : "Paused"}
          </Chip>
        )}
        {a.blocked && <Chip t="err">Blocked</Chip>}
        {a.approval &&<Chip t={a.approval === "approved" ? "ok" : "warn"}>Policy {words(a.approval)}</Chip>}
      </div>
      {a.description && <p className="line-clamp-3 text-[12.5px] leading-relaxed text-mist">{a.description}</p>}
      <Facts>
        {a.source === "saved" ? (
          <>
            <Fact label="Latest version">{a.version === null ? null : `v${a.version}`}</Fact>
            <Fact label="Deployed">{deployed ? `v${a.deployedVersion} · ${when(a.deployedAt) ?? "time not recorded"}` : <None>not deployed</None>}</Fact>
            <Fact label="Updated">{when(a.updatedAt)}</Fact>
            <Fact label="Owner">{a.owner || <None>none declared</None>}</Fact>
            <Fact label="Steps">{a.steps}</Fact>
          </>
        ) : (
          <>
            <Fact label="Mode">{a.mode || null}</Fact>
            <Fact label="Framework">{a.framework || null}</Fact>
            <Fact label="Model">{a.model || null}</Fact>
            <Fact label="Owner">{a.owner || <None>none declared</None>}</Fact>
            <Fact label="Runs, 30 days">{a.runs30d ?? null}</Fact>
            <Fact label="Refusals, 30 days">{a.denials30d ?? null}</Fact>
            <Fact label="Last seen">{when(a.updatedAt)}</Fact>
          </>
        )}
      </Facts>
    </>
  );
}

function ApplicationBody({ a }: { a: Application }) {
  const models = a.policy?.models ?? [];
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip t="violet">{words(String(a.class))}</Chip>
        {a.blocked ? <Chip t="err">Blocked</Chip> : <Chip t="ok">Allowed</Chip>}
        {a.removed_at && <Chip t="slate">Removed</Chip>}
      </div>
      {a.description && <p className="line-clamp-3 text-[12.5px] leading-relaxed text-mist">{a.description}</p>}
      <Facts>
        <Fact label="Owner">{a.owner || null}</Fact>
        <Fact label="Kind">{a.source === "workflow" ? "Deployed agent" : "Registered application"}</Fact>
        {a.source !== "workflow" && <Fact label="Models">{models.length ? models.join(", ") : null}</Fact>}
        {a.source !== "workflow" && <Fact label="Data class">{a.policy?.data_class || null}</Fact>}
        <Fact label="Registered">{when(a.created_at)}</Fact>
      </Facts>
      {a.block && (
        <Note label="Blocked" t="err">
          {a.block.reason}
        </Note>
      )}
    </>
  );
}

function UseCasesBody({ u }: { u: UseCasesCard }) {
  if (u.rows.length === 0) return <p className="text-[12.5px] text-mist">There are no registered use cases.</p>;
  const rows = [...u.rows].sort((x, y) => (x.id === u.picked ? -1 : y.id === u.picked ? 1 : 0)).slice(0, 6);
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <PlainChip>{u.rows.length} registered</PlainChip>
        {Object.entries(u.rows.reduce<Record<string, number>>((m, r) => ((m[r.state] = (m[r.state] ?? 0) + 1), m), {})).map(([s, n]) => (
          <Chip key={s} t={USE_CASE_STATE[s] ?? "slate"}>
            {n} {words(s)}
          </Chip>
        ))}
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-md border border-line">
        {rows.map((r) => (
          <li key={r.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 px-3 py-2" style={r.id === u.picked ? { background: TONES.low.bg } : undefined}>
            <span className="truncate text-[12.5px] font-semibold text-fg">{r.name}</span>
            <Chip t={USE_CASE_STATE[r.state] ?? "slate"}>{words(r.state) || "no state"}</Chip>
            <span className="truncate text-[11.5px] text-dim">
              {[words(r.workload), r.autonomy && `autonomy ${r.autonomy}`, r.owner && `owner ${r.owner}`, `${r.gates} gate${r.gates === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}
            </span>
          </li>
        ))}
      </ul>
      {u.rows.length > rows.length && <p className="text-[11.5px] text-dim">and {u.rows.length - rows.length} more on the page</p>}
    </>
  );
}

function ApprovalsBody({ g, open, acted }: { g: ApprovalsCard; open: (href: string, label?: string) => void; acted: (text: string) => void }) {
  const rows = [...g.pending].sort((x, y) => (x.run === g.picked ? -1 : y.run === g.picked ? 1 : 0)).slice(0, 5);
  /** The gate whose answer is open: the one the link named, else the only one waiting. */
  const [answering, setAnswering] = useState<string | null>(g.picked ?? (g.pending.length === 1 ? g.pending[0].run : null));
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip t={g.count > 0 ? "warn" : "ok"}>{g.count > 0 ? `${g.count} waiting for a person` : "Nothing waiting"}</Chip>
        <PlainChip>{g.closed} answered</PlainChip>
      </div>
      {g.answered && (
        <Note label={`The gate on ${g.answered.run}`} t={g.answered.approved ? "ok" : "err"}>
          {g.answered.aborted ? "Closed" : g.answered.approved ? "Approved" : "Refused"}
          {g.answered.by ? ` by ${g.answered.by}` : ""}
          {g.answered.at ? `, ${when(g.answered.at)}` : ""}
          {g.answered.note ? `: ${g.answered.note}` : ""}
        </Note>
      )}
      {rows.length === 0 ? (
        <p className="text-[12.5px] text-mist">No gate is waiting for a person.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-md border border-line">
          {rows.map((gate) => (
            <li key={`${gate.run}:${gate.node}`} className="space-y-0.5 px-3 py-2" style={gate.run === g.picked ? { background: TONES.medium.bg } : undefined}>
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-[12.5px] font-semibold text-fg">{gate.asks || `${gate.agent} · ${gate.node}`}</span>
                {gate.deadline && <Chip t="warn">due {when(gate.deadline)}</Chip>}
              </div>
              <div className="flex flex-wrap items-center gap-x-2 text-[11.5px] text-dim">
                <span>{gate.agent}</span>
                <span>·</span>
                <Inner onOpen={() => open(`/runs?id=${encodeURIComponent(gate.run)}`, gate.run)}>{gate.run}</Inner>
                {gate.waiting_since && <span>· waiting since {when(gate.waiting_since)}</span>}
                {gate.approvers.length > 0 && <span>· {gate.approvers.map(words).join(", ")}</span>}
              </div>
              {answering === gate.run ? (
                <GateAnswer gate={gate} acted={acted} onCancel={() => setAnswering(null)} />
              ) : (
                <div className="pt-1.5">
                  <Button size="sm" variant="solid" tone="warn" permission="approve" onClick={() => setAnswering(gate.run)}>
                    Answer
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {g.pending.length > rows.length && <p className="text-[11.5px] text-dim">and {g.pending.length - rows.length} more on the page</p>}
    </>
  );
}

/* ═══════════════════ actions ═══════════════════
   Each goes through the writer the page uses, as the signed-in person; the
   buttons carry the page's permission (Button's `permission`: disabled, with
   the reason, without it) and the service checks again. A destructive one
   asks once more here, never with a browser dialog. */

function clock(at: Date): string {
  return at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function doneText(what: string, o: Extract<ActionOutcome, { ok: true }>): string {
  return `${what} by you, ${clock(o.at)}${o.detail ? `; ${o.detail}` : ""}`;
}

function ActionBox({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-2 rounded-md border p-2.5" style={{ borderColor: "var(--ask-line, var(--t-line))", background: "var(--ask-surface-2, var(--t-canvas))" }}>
      {children}
    </div>
  );
}

function Refused({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p className="text-[11.5px] leading-snug" style={{ color: TONES.err.ink }} role="alert">
      {text}
    </p>
  );
}

function StatusAction({ f, acted }: { f: Finding; acted: (text: string) => void }) {
  const [opened, setOpened] = useState(false);
  const [to, setTo] = useState<FindingStatus | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const options = FINDING_STATUSES.filter((s) => s !== f.status);

  if (!opened) {
    return (
      <div>
        <Button size="sm" variant="solid" tone="ink" permission="approve" onClick={() => setOpened(true)}>
          Change status
        </Button>
      </div>
    );
  }
  const submit = async () => {
    if (!to || !note.trim()) return;
    setBusy(true);
    setError("");
    const o = await changeFindingStatus(f.id, to, note.trim());
    setBusy(false);
    if (!o.ok) return setError(o.reason);
    setOpened(false);
    setTo("");
    setNote("");
    acted(doneText(`Status set to ${FINDING_STATUS_META[to].label}`, o));
  };
  return (
    <ActionBox>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-2">
        <Pick<FindingStatus | "">
          value={to}
          onChange={setTo}
          disabled={busy}
          aria-label="New status"
          options={[{ value: "", label: "Choose a status" }, ...options.map((s) => ({ value: s, label: FINDING_STATUS_META[s].label }))]}
        />
        <Textarea value={note} onChange={setNote} rows={1} disabled={busy} placeholder="Why the status changes (kept in its history)" aria-label="Note" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="solid" tone="ink" permission="approve" disabled={!to || !note.trim()} loading={busy} onClick={submit}>
          Change status
        </Button>
        <Button size="sm" variant="solid" tone="err" disabled={busy} onClick={() => (setOpened(false), setError(""))}>
          Cancel
        </Button>
      </div>
      <Refused text={error} />
    </ActionBox>
  );
}

function RunActions({ r, open, acted }: { r: RunCard; open: (href: string, label?: string) => void; acted: (text: string) => void }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // In flight: running, or waiting at a gate and not ended (lib/steer.ts, as the Runs page decides).
  const live = followsLive({ state: r.state, finished_at: r.finishedAt });
  if (!live) return null;

  const fire = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    setError("");
    const o = await killFromCard(r.id, reason.trim());
    setBusy(false);
    if (!o.ok) return setError(o.reason);
    setAsking(false);
    setReason("");
    acted(doneText("Kill sent", o));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {r.state === "suspended" && (
          <Button size="sm" variant="solid" tone="warn" onClick={() => open("/approvals", r.id)}>
            Open its approval
          </Button>
        )}
        {r.kill ? (
          <Button size="sm" variant="solid" tone="err" disabled title={`Asked by ${r.kill.by || "someone"}${r.kill.at ? ` at ${when(r.kill.at)}` : ""}: ${r.kill.reason}`}>
            Already being stopped
          </Button>
        ) : (
          !asking && (
            <Button size="sm" variant="solid" tone="err" permission="run" onClick={() => setAsking(true)}>
              Kill run
            </Button>
          )
        )}
      </div>
      {asking && !r.kill && (
        <ActionBox>
          <p className="text-[12px] font-semibold text-fg">Stop this run and everything it set off?</p>
          <Textarea value={reason} onChange={setReason} rows={1} disabled={busy} placeholder="Why it is stopped (required, journalled)" aria-label="Reason" />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="solid" tone="err" permission="run" disabled={!reason.trim()} loading={busy} onClick={fire}>
              Kill run
            </Button>
            <Button size="sm" variant="solid" tone="err" disabled={busy} onClick={() => (setAsking(false), setError(""))}>
              Cancel
            </Button>
          </div>
          <Refused text={error} />
        </ActionBox>
      )}
      {!asking && <Refused text={error} />}
    </div>
  );
}

function HoldAction({ a, acted }: { a: AgentCard; acted: (text: string) => void }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (a.source !== "saved" || !a.hold || a.retired) return null;
  if (a.hold.state === "error") return <Refused text={`Whether it is paused could not be read: ${a.hold.reason}`} />;
  const paused = a.hold.paused !== null;
  const action = paused ? "resume" : "pause";

  const fire = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    setError("");
    const o = await holdAgent(a.id, action, reason.trim());
    setBusy(false);
    if (!o.ok) return setError(o.reason);
    setAsking(false);
    setReason("");
    acted(doneText(paused ? "Resumed" : "Paused", o));
  };

  if (!asking) {
    return (
      <div>
        <Button size="sm" variant="solid" tone={paused ? "ink" : "warn"} permission="run" onClick={() => setAsking(true)}>
          {paused ? "Resume" : "Pause"}
        </Button>
      </div>
    );
  }
  return (
    <ActionBox>
      <p className="text-[12px] font-semibold text-fg">{paused ? "Let its runs start again?" : "Start no new run of it and stop its runs in flight?"}</p>
      <Textarea value={reason} onChange={setReason} rows={1} disabled={busy} placeholder="Why (required, kept with the audit event)" aria-label="Reason" />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="solid" tone={paused ? "ink" : "warn"} permission="run" disabled={!reason.trim()} loading={busy} onClick={fire}>
          {paused ? "Resume" : "Pause agent"}
        </Button>
        <Button size="sm" variant="solid" tone="err" disabled={busy} onClick={() => (setAsking(false), setError(""))}>
          Cancel
        </Button>
      </div>
      <Refused text={error} />
    </ActionBox>
  );
}

function GateAnswer({ gate, acted, onCancel }: { gate: Gate; acted: (text: string) => void; onCancel: () => void }) {
  const { session: me, loaded } = useSession();
  const [note, setNote] = useState("");
  const [refusing, setRefusing] = useState(false);
  const [busy, setBusy] = useState<"approve" | "refuse" | null>(null);
  const [error, setError] = useState("");
  // The roles the gate names, as the Approvals page checks them before a click; the service decides (and keeps the second-person rule).
  const access = loaded ? gateAccess(me ? { roles: me.roles, appRoles: me.appRoles, groups: me.groups ?? [] } : null, gate.approvers) : { ok: true, reason: "" };

  if (gate.shape !== "decision") {
    return <p className="pt-1 text-[11.5px] text-dim">This gate takes {gate.shape === "form" ? "a form" : "a verdict per item"}: answer it on the Approvals page.</p>;
  }
  const answer = async (approved: boolean) => {
    setBusy(approved ? "approve" : "refuse");
    setError("");
    const o = await answerDecision(gate.run, approved, note.trim());
    setBusy(null);
    if (!o.ok) return setError(o.reason);
    acted(doneText(approved ? "Approved" : "Refused", o));
  };
  return (
    <div className="pt-1.5">
      <ActionBox>
        <Textarea value={note} onChange={setNote} rows={1} disabled={Boolean(busy)} placeholder="Reason (optional; recorded with the answer)" aria-label="Reason" />
        {refusing ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold text-fg">Refuse? The run closes at this gate.</span>
            <Button size="sm" variant="solid" tone="err" permission="approve" disabled={!access.ok} loading={busy === "refuse"} onClick={() => answer(false)}>
              Refuse
            </Button>
            <Button size="sm" variant="solid" tone="err" disabled={Boolean(busy)} onClick={() => setRefusing(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="solid" tone="ink" permission="approve" disabled={!access.ok || Boolean(busy)} loading={busy === "approve"} onClick={() => answer(true)}>
              Approve
            </Button>
            <Button size="sm" variant="solid" tone="err" permission="approve" disabled={!access.ok || Boolean(busy)} onClick={() => setRefusing(true)}>
              Refuse
            </Button>
            <Button size="sm" variant="solid" tone="err" disabled={Boolean(busy)} onClick={onCancel}>
              Cancel
            </Button>
          </div>
        )}
        {!access.ok && <Refused text={access.reason} />}
        <Refused text={error} />
      </ActionBox>
    </div>
  );
}

/* ═══════════════════ icons ═══════════════════ */

const ICON: CSSProperties = { width: 16, height: 16 };

function IconShield() {
  return (
    <svg viewBox="0 0 16 16" fill="none" style={ICON} aria-hidden>
      <path d="M8 1.8 13 3.6v4.1c0 3-2.1 5.3-5 6.5-2.9-1.2-5-3.5-5-6.5V3.6z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8 5.2v3.2M8 10.6v.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function IconPlay() {
  return (
    <svg viewBox="0 0 16 16" fill="none" style={ICON} aria-hidden>
      <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6.6 5.4v5.2L10.8 8z" fill="currentColor" />
    </svg>
  );
}
function IconBot() {
  return (
    <svg viewBox="0 0 16 16" fill="none" style={ICON} aria-hidden>
      <rect x="2.5" y="4.5" width="11" height="8.5" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 2v2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="6" cy="8.6" r="1" fill="currentColor" />
      <circle cx="10" cy="8.6" r="1" fill="currentColor" />
    </svg>
  );
}
function IconApp() {
  return (
    <svg viewBox="0 0 16 16" fill="none" style={ICON} aria-hidden>
      <rect x="2" y="2.5" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M2 6h12" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
function IconStack() {
  return (
    <svg viewBox="0 0 16 16" fill="none" style={ICON} aria-hidden>
      <path d="M8 2 14 5 8 8 2 5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="m2 8 6 3 6-3M2 11l6 3 6-3" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}
function IconGate() {
  return (
    <svg viewBox="0 0 16 16" fill="none" style={ICON} aria-hidden>
      <path d="M3 13V5.5a5 5 0 0 1 10 0V13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M2 13h12M6 9.2l1.6 1.6L10.5 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconPage() {
  return (
    <svg viewBox="0 0 16 16" fill="none" style={ICON} aria-hidden>
      <path d="M4 1.8h5.2L12.5 5v9.2H4z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M6.3 8.5h4M6.3 11h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
