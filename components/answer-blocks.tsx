"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { BlockBoundary } from "./block-boundary";
import { BlockChart } from "./assistant-charts";
import { readWords, type Answer, type BarsBlock, type Block, type BlockFormat, type BlockSource, type ChartBlock, type Origin, type StepsBlock, type TableBlock, type TilesBlock, type Value } from "@/lib/answer-blocks";

/**
 * One renderer for answers as blocks, used by both chats: the console
 * assistant (components/assistant-thread.tsx, the drawer and the full page)
 * and a registered chatbot on the Chat page (components/chat-pane.tsx).
 *
 * The console assistant's blocks were filled by the service from its own
 * records: each carries a quiet one-line footer naming the read it came from
 * and when, and a tile, a row, a bar or a link opens the record or page
 * behind it. When the chat gives `onNavigate`, that opening is the chat's to
 * do (it draws the record as a card in the conversation) and nothing here
 * navigates; without it, the link is an ordinary link. A chatbot's blocks hold
 * the chatbot's own words; they are marked as written by it and link nothing
 * but console pages.
 *
 * Colour carries meaning (app/globals.css, the answer blocks block): a
 * severity, a state or a kind of event is drawn in its tone, matched on the
 * exact word under a column or tile whose label says it is one; where nothing
 * is meant, figures and series take the categorical slots in a fixed order.
 *
 * The console assistant's blocks the service refused, and what its reads
 * withheld from its model, arrive for the record (the service keeps both with
 * the exchange) and are not drawn; the text still answers. A block that
 * arrived and this console could not read is shown where it would have been,
 * in red, with the reason. A value that is null in the record is shown as
 * "none" (an amount in US dollars as "no price set", which is what a null cost
 * means on this platform), never as 0.
 */

/** Opens the record or page an href names: the chat draws it as a card in the conversation. */
export type Navigate = (href: string, label?: string) => void;

/* ═══════════════════ values ═══════════════════ */

function money(n: number): string {
  if (n === 0) return "$0.00";
  if (Math.abs(n) < 0.01) return `$${n.toFixed(6).replace(/0+$/, "")}`;
  return `$${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A moment in the reader's local time: "26 Nov, 16:59". */
function when(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * A moment in a column whose moments all fall on one local day: the time with seconds, "16:59:34", and with
 * milliseconds, "16:59:34.091", when seconds alone would show two rows the same.
 */
function clock(iso: string, ms = false): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", ...(ms ? { fractionalSecondDigits: 3 } : {}) });
}

/** The one local day every moment in a list falls on ("26 Nov"), or null when they span more than one. */
function oneDay(isos: string[]): string | null {
  const days = new Set<string>();
  for (const iso of isos) {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return null;
    days.add(new Date(t).toDateString());
  }
  if (days.size !== 1) return null;
  return new Date(Date.parse(isos[0])).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** A value in words for its format. */
export function valueText(v: Value, format: BlockFormat | null): string {
  if (v === null) return format === "usd" ? "no price set" : "none";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return format === "usd" ? money(v) : v.toLocaleString("en-GB", { maximumFractionDigits: 6 });
  if (format === "time") return when(v);
  return v;
}

/** An axis tick: short, "10K" past ten thousand. */
function tickText(v: number, format: BlockFormat | null): string {
  const compact = Math.abs(v) >= 10_000 ? v.toLocaleString("en-GB", { notation: "compact", maximumFractionDigits: 1 }) : v.toLocaleString("en-GB", { maximumFractionDigits: 2 });
  return format === "usd" ? `$${compact}` : compact;
}

/* ═══════════════════ meaning ═══════════════════ */

export type Tone = "red" | "orange" | "amber" | "green" | "blue" | "teal" | "violet" | "olive" | "magenta" | "slate";

/** The categorical slots, in their fixed order, for a figure or a series that means nothing by its colour. */
const SLOTS: Tone[] = ["blue", "amber", "teal", "violet", "olive", "magenta"];

/** A finding's severity (the service's findings and alerts: critical, high, medium, low, info). */
const SEVERITY: Record<string, Tone> = { critical: "red", high: "orange", medium: "amber", low: "teal", info: "slate" };

/**
 * The states and statuses the service's records hold (runs, findings, gates, approvals, documents, syncs), by what
 * each means to the reader: finished well, stopped badly, waiting on someone, in flight or open, looked at, set aside.
 */
const STATE: Record<string, Tone> = {
  done: "green", approved: "green", applied: "green", admitted: "green", ingested: "green", published: "green", remediated: "green", resolved: "green", synced: "green", connected: "green", continued: "green", passed: "green", ok: "green", succeeded: "green", healthy: "green", active: "green", allowed: "green",
  failed: "red", killed: "red", refused: "red", rejected: "red", error: "red", blocked: "red", denied: "red", unreachable: "red", stopped: "red", expired: "red", revoked: "red",
  suspended: "amber", awaiting_approval: "amber", pending: "amber", needs_input: "amber", waiting: "amber", held: "amber", changed: "amber", staged: "amber", paused: "amber",
  running: "blue", open: "blue", started: "blue", claimed: "blue", reviewed: "blue", in_progress: "blue",
  confirmed: "violet", triaged: "violet",
  closed: "slate", dismissed: "slate", false_positive: "slate", accepted: "slate", superseded: "slate", withdrawn: "slate", rolled_back: "slate", never_synced: "slate", draft: "slate", queued: "slate", skipped: "slate",
};

/** A journal event or a step by its kind, "tool.call" by "tool": an event that went wrong is red whatever its kind. */
function kindTone(v: string): Tone | null {
  const w = v.toLowerCase();
  if (/refus|fail|error|denied|block|kill/.test(w)) return "red";
  const head = w.split(/[.\s:_-]/)[0];
  // A tool's call and its result are told apart, so a journal reads as call, result, call.
  if (w === "tool.result") return "teal";
  const KIND: Record<string, Tone> = { tool: "blue", model: "violet", gate: "amber", approval: "amber", node: "slate", run: "olive", classifier: "magenta", guard: "magenta", guardrail: "magenta", budget: "olive", step: "slate" };
  return KIND[head] ?? null;
}

const word = (v: string) => v.trim().toLowerCase().replace(/[\s-]+/g, "_");
const SEVERITY_LABEL = /\b(severity|risk|priority)\b/i;
const STATE_LABEL = /\b(state|status|outcome|decision|verdict|result)\b/i;
const KIND_LABEL = /\b(event|kind)\b/i;

/** The tone a value carries under a column or tile with this label, or null when it carries none. */
export function toneOf(v: Value, label: string): Tone | null {
  if (typeof v !== "string" || !v.trim()) return null;
  if (SEVERITY_LABEL.test(label)) return SEVERITY[word(v)] ?? "slate";
  if (STATE_LABEL.test(label)) return STATE[word(v)] ?? SEVERITY[word(v)] ?? (v.length <= 24 ? "slate" : null);
  if (KIND_LABEL.test(label)) return kindTone(v);
  return null;
}

/** A count whose label names something gone wrong, or a severity: what its figure means. Zero failures is good. */
function countTone(v: number | null, label: string): Tone | null {
  if (v === null) return null;
  const sev = /^(critical|high|medium|low)\b/i.exec(label.trim());
  if (sev) return v > 0 ? SEVERITY[sev[1].toLowerCase()] : "slate";
  if (/\b(fail|failed|failures?|errors?|refus\w*|killed|denied|blocked|breach\w*|violations?)\b/i.test(label)) return v > 0 ? "red" : "green";
  return null;
}

const plain = (v: string) => v.replace(/_/g, " ");

/** A state, a severity or a kind as a chip in its tone. */
export function Chip({ tone, children, mono = false }: { tone: Tone; children: ReactNode; mono?: boolean }) {
  return (
    <span className={`ask-chip ${mono ? "font-mono font-medium" : ""}`} data-tone={tone}>
      <span className="truncate">{children}</span>
    </span>
  );
}

/* ═══════════════════ small parts ═══════════════════ */

function Chevron({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`ask-chevron shrink-0 ${className}`}>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      <path d="M3 8h9.5M8.5 4l4 4-4 4" />
    </svg>
  );
}

/**
 * Something that opens the record or page an href names. With `onNavigate` it is a button the chat answers (a
 * card in the conversation) and nothing navigates; without it, an ordinary link.
 */
function Go({ href, label, onNavigate, className, children, tone, meaning }: { href: string; label: string; onNavigate?: Navigate; className: string; children: ReactNode; tone?: Tone; meaning?: boolean }) {
  const data = { "data-tone": tone, "data-meaning": meaning ? "" : undefined, "data-href": href };
  if (onNavigate)
    return (
      <button type="button" {...data} title={`Show ${label} here`} onClick={() => onNavigate(href, label)} className={`focusable cursor-pointer text-left ${className}`}>
        {children}
      </button>
    );
  return (
    <Link {...data} href={href} title={`Open ${label}`} className={`focusable ${className}`}>
      {children}
    </Link>
  );
}

function ValueView({ v, format }: { v: Value; format: BlockFormat | null }) {
  if (v === null) return <span className="text-ghost italic">{valueText(v, format)}</span>;
  if (format === "id" && typeof v === "string")
    return (
      <span className="ask-id" title={v}>
        {v}
      </span>
    );
  return <span className={typeof v === "number" ? "tnum" : undefined}>{valueText(v, format)}</span>;
}

/**
 * A question to send as the next message: a choice, a follow-up or a
 * suggested question. A pill on a solid tint, and it wraps, since a question
 * can be longer than a button's single line; `full` lays it out as a row.
 */
export function AskButton({ text, onSend, disabled = false, full = false }: { text: string; onSend: (t: string) => void; disabled?: boolean; full?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSend(text)}
      className={`ask-pill focusable group inline-flex min-h-7 cursor-pointer items-center gap-1.5 px-3 py-1 text-left text-[12px] leading-[1.4] font-medium break-words transition-[background-color,opacity] duration-100 disabled:pointer-events-none disabled:opacity-45 ${full ? "w-full justify-between rounded-lg" : "max-w-full rounded-full"}`}
    >
      <span className="min-w-0">{text}</span>
      <Arrow />
    </button>
  );
}

/* ═══════════════════ the frame ═══════════════════ */

const GLYPH: Record<string, { tone: Tone; path: string }> = {
  tiles: { tone: "blue", path: "M3 3h4v4H3zM9 3h4v4H9zM3 9h4v4H3zM9 9h4v4H9z" },
  table: { tone: "teal", path: "M2.5 3.5h11M2.5 6.5h11M2.5 9.5h11M2.5 12.5h11" },
  bars: { tone: "violet", path: "M3 4h8M3 8h5M3 12h10" },
  chart: { tone: "magenta", path: "M2.5 12 6 8l3 2.5L13.5 4" },
  steps: { tone: "olive", path: "M4 3v10M4 4.5h0M4 8h0M4 11.5h0M7 4.5h6M7 8h6M7 11.5h6" },
};

function Frame({ title, source, origin, children, kind, badge }: { title: string | null; source: BlockSource | null; origin: Origin; children: ReactNode; kind: string; badge?: ReactNode }) {
  const g = GLYPH[kind];
  return (
    <section data-block={kind} className="ask-card min-w-0 overflow-hidden">
      {(title || badge) && (
        <header className="ask-head flex min-w-0 items-center gap-2 px-3 py-2">
          {g && (
            <span className="ask-glyph grid size-5 shrink-0 place-items-center rounded-[5px]" data-tone={g.tone} aria-hidden>
              <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth={kind === "tiles" ? 0 : 1.9} strokeLinecap="round" strokeLinejoin="round">
                <path d={g.path} fill={kind === "tiles" ? "currentColor" : "none"} />
              </svg>
            </span>
          )}
          <h4 className="line-clamp-2 min-w-0 flex-1 text-[12px] leading-[1.35] font-semibold break-words text-fg" title={title ?? undefined}>
            {title}
          </h4>
          {badge}
        </header>
      )}
      {children}
      <SourceLine source={source} origin={origin} />
    </section>
  );
}

const SHOWN_NOTE = /^\d[\d,]* of \d[\d,]* (rows |records )?shown\.?$/i;

function SourceLine({ source, origin }: { source: BlockSource | null; origin: Origin }) {
  if (origin.kind === "chatbot") return null;
  if (!source) return null;
  const at = source.reads.map((r) => r.at).sort().at(-1) ?? "";
  // The header's chip already says how many rows are shown.
  const note = source.note && !SHOWN_NOTE.test(source.note.trim()) ? source.note : null;
  const text = `From ${source.reads.map((r) => `${r.id} ${readWords(r)}`).join(" and ")}${at ? ` · read ${when(at)}` : ""}${note ? ` · ${note}` : ""}`;
  return (
    <p data-source title={text} className="flex min-w-0 items-center gap-1.5 border-t border-[var(--ask-line)] px-3 py-1.5 text-[10px] leading-[1.45] text-faint">
      <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden className="shrink-0">
        <ellipse cx="8" cy="4" rx="5" ry="2" />
        <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4M3 8c0 1.1 2.2 2 5 2s5-.9 5-2" />
      </svg>
      <span className="min-w-0 truncate">{text}</span>
    </p>
  );
}

/* ═══════════════════ the seven blocks ═══════════════════ */

function Tiles({ b, origin, onNavigate, wide }: { b: TilesBlock; origin: Origin; onNavigate?: Navigate; wide: boolean }) {
  let slot = 0;
  return (
    <Frame title={b.title} source={b.source} origin={origin} kind="tiles">
      <div className={`grid gap-2 p-2.5 ${wide ? "grid-cols-[repeat(auto-fit,minmax(128px,1fr))]" : "grid-cols-[repeat(auto-fit,minmax(112px,1fr))]"}`}>
        {b.items.map((t, i) => {
          const meant = toneOf(t.value, t.label) ?? (typeof t.value === "number" || t.value === null ? countTone(t.value as number | null, t.label) : null);
          // A figure that means nothing by its colour takes the next slot; past the sixth it stays slate.
          const tone: Tone = meant ?? SLOTS[slot++] ?? "slate";
          const isNumber = typeof t.value === "number";
          const figure =
            t.value === null ? (
              <span className="text-[15px] font-medium text-ghost italic">{valueText(null, t.format)}</span>
            ) : isNumber ? (
              <span className="ask-figure text-[22px] leading-none font-semibold tracking-[-0.02em] text-fg">{valueText(t.value, t.format)}</span>
            ) : t.format === "id" ? (
              <span className="ask-id max-w-full self-start text-[11.5px]">{String(t.value)}</span>
            ) : meant ? (
              <span className="ask-figure flex items-center gap-1.5 text-[18px] leading-tight font-semibold tracking-[-0.01em] capitalize">
                <span className="size-2 shrink-0 rounded-full" style={{ background: "var(--ask-tone)" }} aria-hidden />
                <span className="truncate">{plain(valueText(t.value, t.format))}</span>
              </span>
            ) : (
              // A long name ("google/gemini-4-argon") may break after a slash, never inside a word.
              <span className="ask-figure line-clamp-2 text-[13px] leading-[1.3] font-semibold break-words text-fg">
                {valueText(t.value, t.format)
                  .split("/")
                  .flatMap((part, k) => (k ? [<wbr key={k} />, `/${part}`] : [part]))}
              </span>
            );
          const body = (
            <>
              <span className="flex min-w-0 items-center justify-between gap-1">
                <span className="truncate text-[10.5px] font-medium text-dim">{t.label}</span>
                {t.href && <Chevron className="-mr-1" />}
              </span>
              <span className="min-w-0" title={valueText(t.value, t.format)}>
                {figure}
              </span>
            </>
          );
          const cls = "ask-tile flex min-h-[64px] min-w-0 flex-col justify-between gap-2 px-3 pt-3 pb-2.5 transition-[background-color] duration-100";
          return t.href ? (
            <Go key={i} href={t.href} label={t.label} onNavigate={onNavigate} className={cls} tone={tone} meaning={Boolean(meant)}>
              {body}
            </Go>
          ) : (
            <div key={i} className={cls} data-tone={tone} data-meaning={meant ? "" : undefined}>
              {body}
            </div>
          );
        })}
      </div>
    </Frame>
  );
}

const NUMERIC = (f: BlockFormat | null) => f === "usd" || f === "number";
const TITLE_LABEL = /\b(title|name|summary|description|what|finding title)\b/i;

function Table({ b, origin, onNavigate, wide }: { b: TableBlock; origin: Origin; onNavigate?: Navigate; wide: boolean }) {
  const router = useRouter();
  const cols = b.columns;
  const textAt = (r: TableBlock["rows"][number], k: number) => (typeof r.cells[k] === "string" ? (r.cells[k] as string) : "");
  const avgLen = (k: number) => (b.rows.length ? b.rows.reduce((n, r) => n + textAt(r, k).length, 0) / b.rows.length : 0);
  // How each column is drawn: a chip (a severity, a state, a kind), a moment, an id, a number, or text.
  const chipCol = cols.map((c, k) => b.rows.some((r) => toneOf(r.cells[k], c.label) !== null));
  const titleCol = cols.findIndex((c, k) => (c.format === "text" || c.format === null) && !chipCol[k] && (TITLE_LABEL.test(c.label) || avgLen(k) > 28));
  const idCol = cols.findIndex((c) => c.format === "id");
  const days = cols.map((c, k) => (c.format === "time" ? oneDay(b.rows.map((r) => r.cells[k]).filter((v): v is string => typeof v === "string")) : null));
  const ms = cols.map((_, k) => {
    if (!days[k]) return false;
    const seconds = b.rows.map((r) => r.cells[k]).filter((v): v is string => typeof v === "string").map((v) => clock(v));
    return new Set(seconds).size < seconds.length;
  });
  const anyOpens = b.rows.some((r) => r.href);
  // A small table reads as a table even in the narrow drawer; a wide one becomes a list of records there.
  const fits = wide || (cols.length <= 4 && (titleCol < 0 || avgLen(titleCol) <= 32));

  const labelOf = (r: TableBlock["rows"][number]) => {
    const pick = [titleCol, idCol, 0].find((k) => k >= 0 && r.cells[k] !== null && r.cells[k] !== undefined);
    return pick === undefined ? "this row" : valueText(r.cells[pick], cols[pick]?.format ?? null);
  };
  const go = (r: TableBlock["rows"][number]) => {
    if (!r.href) return;
    if (onNavigate) onNavigate(r.href, labelOf(r));
    else router.push(r.href);
  };

  const cell = (v: Value, k: number) => {
    const c = cols[k];
    const tone = toneOf(v, c?.label ?? "");
    if (tone && typeof v === "string") return <Chip tone={tone} mono={KIND_LABEL.test(c.label) && v.includes(".")}>{plain(v)}</Chip>;
    if (c?.format === "time" && typeof v === "string") return <span className="tnum whitespace-nowrap text-dim">{days[k] ? clock(v, ms[k]) : when(v)}</span>;
    return <ValueView v={v} format={c?.format ?? null} />;
  };

  const shown = b.total !== null && b.total > b.rows.length;
  const badge = shown ? (
    <Chip tone="amber">
      {b.rows.length.toLocaleString("en-GB")} of {b.total!.toLocaleString("en-GB")} shown
    </Chip>
  ) : b.rows.length > 0 ? (
    <span className="tnum shrink-0 text-[10.5px] text-faint">
      {b.rows.length.toLocaleString("en-GB")} {b.rows.length === 1 ? "row" : "rows"}
    </span>
  ) : null;

  const cap = wide ? undefined : { maxHeight: "min(22rem, 54vh)" };

  const table = (
    <div className={`af-list overflow-x-auto ${fits ? "" : "hidden @xl:block"}`} style={cap}>
      <table className="ask-table w-full border-separate border-spacing-0 text-[11.5px]">
        <thead>
          <tr className="text-left text-[10.5px] text-dim">
            {cols.map((c, k) => (
              <th key={k} scope="col" className={`px-3 py-1.5 font-semibold whitespace-nowrap ${NUMERIC(c.format) ? "text-right" : ""}`}>
                {c.label}
                {days[k] && <span className="ml-1 font-normal text-faint">· {days[k]}</span>}
              </th>
            ))}
            {anyOpens && (
              <th className="w-6 px-1" aria-label="Opens">
                <span className="sr-only">Opens</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {b.rows.map((r, i) => (
            <tr
              key={i}
              data-row={i}
              data-opens={r.href ? "" : undefined}
              data-href={r.href ?? undefined}
              role={r.href ? (onNavigate ? "button" : "link") : undefined}
              tabIndex={r.href ? 0 : undefined}
              onClick={r.href ? () => go(r) : undefined}
              onKeyDown={r.href ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), go(r)) : undefined}
              title={r.href ? `${onNavigate ? "Show" : "Open"} ${labelOf(r)}${onNavigate ? " here" : ""}` : undefined}
              className={`align-top ${r.href ? "focusable cursor-pointer" : ""}`}
            >
              {r.cells.map((c, k) => (
                <td
                  key={k}
                  className={`border-b border-[var(--ask-line)] px-3 py-1.5 text-fg ${NUMERIC(cols[k]?.format) ? "text-right whitespace-nowrap" : ""} ${k === titleCol ? "min-w-[12rem] break-words" : cols[k]?.format === "id" ? (wide ? "max-w-[16rem]" : "max-w-[11rem]") : "max-w-[16rem] break-words"}`}
                >
                  {cell(c, k)}
                </td>
              ))}
              {anyOpens && <td className="border-b border-[var(--ask-line)] px-1 py-1.5 align-middle">{r.href && <Chevron />}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  // The narrow drawer: each row a record, its id and chips on top, its title beneath, the rest as small facts.
  const others = cols.map((_, k) => k).filter((k) => k !== 0 && k !== titleCol && !chipCol[k]);
  const list = fits ? null : (
    <ul className="ask-rows af-list @xl:hidden" style={cap}>
      {b.rows.map((r, i) => {
        const facts = (
          <>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {titleCol !== 0 && <span className="min-w-0 font-medium text-fg">{cell(r.cells[0] ?? null, 0)}</span>}
                {cols.map((_, k) => (chipCol[k] && k !== 0 ? <span key={k}>{cell(r.cells[k] ?? null, k)}</span> : null))}
              </span>
              {titleCol >= 0 && <span className="leading-[1.45] font-medium break-words text-fg">{cell(r.cells[titleCol] ?? null, titleCol)}</span>}
              {others.length > 0 && (
                <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-faint">
                  {others.map((k) => (
                    <span key={k} className="flex min-w-0 max-w-full items-baseline gap-1">
                      <span className="shrink-0">{cols[k]?.label}</span>
                      <span className="min-w-0 truncate text-dim">{cell(r.cells[k] ?? null, k)}</span>
                    </span>
                  ))}
                </span>
              )}
            </span>
            {r.href && <Chevron className="mt-0.5" />}
          </>
        );
        return (
          <li key={i} data-row={i} data-opens={r.href ? "" : undefined} className="border-b border-[var(--ask-line)] text-[11.5px] last:border-b-0">
            {r.href ? (
              <Go href={r.href} label={labelOf(r)} onNavigate={onNavigate} className="flex w-full min-w-0 items-start gap-2 px-3 py-2">
                {facts}
              </Go>
            ) : (
              <div className="flex min-w-0 items-start gap-2 px-3 py-2">{facts}</div>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <Frame title={b.title} source={b.source} origin={origin} kind="table" badge={badge}>
      {b.rows.length === 0 ? (
        <p className="px-3 py-3 text-[11.5px] text-faint">There are none.</p>
      ) : (
        <>
          {list}
          {table}
        </>
      )}
    </Frame>
  );
}

function Bars({ b, origin, onNavigate, wide }: { b: BarsBlock; origin: Origin; onNavigate?: Navigate; wide: boolean }) {
  const max = Math.max(0, ...b.items.map((i) => i.value ?? 0));
  return (
    <Frame title={b.title} source={b.source} origin={origin} kind="bars">
      <div className="flex flex-col gap-0.5 px-1.5 py-2">
        {b.items.map((it, i) => {
          // One series, one colour; a bar whose label is a severity or a state takes that tone instead.
          const meant = SEVERITY[word(it.label)] ?? STATE[word(it.label)] ?? null;
          const fill = `var(--ask-${meant ?? "blue"})`;
          const ratio = it.value !== null && max > 0 ? Math.max(0, it.value) / max : 0;
          const row = (
            <>
              <span className="flex min-w-0 items-center gap-1.5 text-fg" title={it.label}>
                {meant && <span className="size-2 shrink-0 rounded-full" style={{ background: fill }} aria-hidden />}
                <span className={`truncate ${meant ? "capitalize" : ""}`}>{it.label}</span>
              </span>
              <span className="flex min-w-0 items-center gap-2">
                {it.value !== null && (
                  <span
                    className="block h-[11px] shrink-0 rounded-r-[4px]"
                    title={`${it.label}: ${valueText(it.value, b.format)}`}
                    style={{ width: `calc((100% - 5.5rem) * ${ratio})`, minWidth: it.value ? 3 : 0, background: fill }}
                  />
                )}
                <span className="tnum shrink-0 text-[11px] font-semibold text-fg">
                  <ValueView v={it.value} format={b.format} />
                </span>
              </span>
              {it.href ? <Chevron /> : <span />}
            </>
          );
          const cls = `grid w-full items-center gap-2.5 rounded-sm px-1.5 py-[5px] text-[11.5px] ${wide ? "grid-cols-[minmax(0,14rem)_1fr_14px]" : "grid-cols-[minmax(0,8.5rem)_1fr_14px]"}`;
          return it.href ? (
            <Go key={i} href={it.href} label={it.label} onNavigate={onNavigate} className={`${cls} hover:bg-[var(--ask-info-bg)]`}>
              {row}
            </Go>
          ) : (
            <div key={i} className={cls}>
              {row}
            </div>
          );
        })}
      </div>
    </Frame>
  );
}

function Chart({ b, origin, wide }: { b: ChartBlock; origin: Origin; wide: boolean }) {
  return (
    <Frame title={b.title} source={b.source} origin={origin} kind="chart">
      <div className="px-3 pt-2.5 pb-2">
        <BlockChart x={b.x} series={b.series} fmt={(v) => valueText(v, b.format)} tick={(v) => tickText(v, b.format)} height={wide ? 230 : 172} />
      </div>
    </Frame>
  );
}

function StepIcon({ tone }: { tone: Tone }) {
  const path = tone === "green" ? "M4.5 8.2 7 10.5l4.5-5" : tone === "red" ? "M5.5 5.5l5 5M10.5 5.5l-5 5" : tone === "amber" ? "M8 4.8v3.6M8 11h0" : null;
  if (!path) return <span className="size-[5px] rounded-full bg-[var(--ask-surface)]" />;
  return (
    <svg viewBox="0 0 16 16" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  );
}

function Steps({ b, origin }: { b: StepsBlock; origin: Origin }) {
  return (
    <Frame title={b.title} source={b.source} origin={origin} kind="steps">
      <ol className="flex flex-col px-3 py-3">
        {b.steps.map((s, i) => {
          const tone: Tone = (s.state && (STATE[word(s.state)] ?? SEVERITY[word(s.state)] ?? kindTone(s.state))) || kindTone(s.label) || "blue";
          return (
            <li key={i} data-step={i} className="relative grid grid-cols-[18px_minmax(0,1fr)_auto] gap-x-2.5 pb-3.5 text-[11.5px] last:pb-0">
              {i < b.steps.length - 1 && <span className="ask-rail absolute top-[22px] bottom-[2px] left-[8.5px] w-px" aria-hidden />}
              <span className="ask-dot relative z-[1] mt-px grid size-[18px] place-items-center rounded-full" data-tone={tone}>
                <StepIcon tone={tone} />
              </span>
              <span className="flex min-w-0 flex-col gap-0.5 pt-px">
                <span className="font-semibold break-words text-fg">{s.label}</span>
                {s.detail && <span className="leading-[1.45] break-words text-dim">{s.detail}</span>}
              </span>
              <span className="flex flex-col items-end gap-1 pt-px">
                {s.state && <Chip tone={tone}>{plain(s.state)}</Chip>}
                {s.at && <span className="tnum text-[10px] whitespace-nowrap text-faint">{when(s.at)}</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </Frame>
  );
}

function AskNext({ label, options, onSend, busy, kind }: { label: string; options: string[]; onSend: (t: string) => void; busy: boolean; kind: "choices" | "followups" }) {
  return (
    <div {...(kind === "choices" ? { "data-block": "choices" } : { "data-followups": "" })} className="flex flex-col gap-1.5 pt-0.5">
      <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.06em] text-faint uppercase">
        <span className="h-[3px] w-3 rounded-full bg-[var(--ask-blue)]" aria-hidden />
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <AskButton key={o} text={o} onSend={onSend} disabled={busy} />
        ))}
      </div>
    </div>
  );
}

export function BlockView({ b, origin, onSend, onNavigate, busy, wide = false }: { b: Block; origin: Origin; onSend: (text: string) => void; onNavigate?: Navigate; busy: boolean; wide?: boolean }) {
  switch (b.type) {
    case "tiles":
      return <Tiles b={b} origin={origin} onNavigate={onNavigate} wide={wide} />;
    case "table":
      return <Table b={b} origin={origin} onNavigate={onNavigate} wide={wide} />;
    case "bars":
      return <Bars b={b} origin={origin} onNavigate={onNavigate} wide={wide} />;
    case "chart":
      return <Chart b={b} origin={origin} wide={wide} />;
    case "steps":
      return <Steps b={b} origin={origin} />;
    case "links":
      return (
        <div data-block="links" className="flex flex-col gap-1.5">
          {b.title && <span className="text-[11px] font-medium text-dim">{b.title}</span>}
          <div className="flex flex-wrap gap-1.5">
            {b.links.map((l, i) => (
              <Go key={i} href={l.href} label={l.label} onNavigate={onNavigate} className="ask-action inline-flex h-8 max-w-full items-center gap-1.5 rounded-md px-3 text-[12px] font-semibold transition-[filter] duration-100">
                <span className="truncate">{l.label}</span>
                <Arrow />
              </Go>
            ))}
          </div>
        </div>
      );
    case "choices":
      return <AskNext kind="choices" label={b.title ?? "Ask next"} options={b.options} onSend={onSend} busy={busy} />;
  }
}

/* ═══════════════════ an answer ═══════════════════ */

/**
 * The blocks of one answer, those this console could not read, and its
 * follow-up questions. The text is drawn by the chat itself, above this.
 * `onSend` sends a choice or a follow-up as the next message. `onNavigate`,
 * when given, is called with the href and a label for everything that opens
 * a record or page (a tile, a row, a bar, a link) instead of navigating: the
 * chat draws that record as a card in the conversation. `wide` is the full
 * page: tiles in one row, tables as tables at full width, taller charts.
 */
export function AnswerBlocks({
  answer,
  origin,
  onSend,
  onNavigate,
  busy = false,
  followups = true,
  wide = false,
}: {
  answer: Answer;
  origin: Origin;
  onSend: (text: string) => void;
  onNavigate?: Navigate;
  busy?: boolean;
  followups?: boolean;
  wide?: boolean;
}) {
  const fellBack = origin.kind === "chatbot" && answer.replyFormat && answer.replyFormat !== "json_schema";
  // Only blocks this console could not read (lib/answer-blocks.ts `answerOf`); the service's refusals are not read.
  const refused = answer.refused;
  if (!answer.blocks.length && !refused.length && !(followups && answer.followups.length) && !fellBack) return null;
  return (
    <div className="@container flex min-w-0 flex-col gap-2.5">
      {origin.kind === "chatbot" && answer.blocks.length > 0 && (
        <p className="text-[10.5px] leading-[1.45] text-faint">Written by {origin.name}, not read from this platform&rsquo;s records.</p>
      )}
      {fellBack && <p className="text-[10.5px] leading-[1.45] text-warn">Answered as plain JSON ({answer.replyFormat}), checked by the service.</p>}
      {answer.blocks.map((b, i) => (
        <BlockBoundary key={i} what={`The ${b.type} block`}>
          <BlockView b={b} origin={origin} onSend={onSend} onNavigate={onNavigate} busy={busy} wide={wide} />
        </BlockBoundary>
      ))}
      {refused.map((r, i) => (
        <div key={`refused-${i}`} role="alert" data-refused={r.block} className="ask-error relative overflow-hidden rounded-md py-1.5 pr-3 pl-4 text-[11.5px] leading-[1.5]">
          <span className="absolute inset-y-0 left-0 w-[3px] bg-[var(--ask-red)]" aria-hidden />
          <span className="font-semibold text-[var(--ask-err)]">{r.block === "followups" ? "The follow-up questions were refused." : `A ${r.block} block was refused.`}</span> <span className="text-dim">{r.reason}</span>
        </div>
      ))}
      {followups && answer.followups.length > 0 && <AskNext kind="followups" label="Ask next" options={answer.followups} onSend={onSend} busy={busy} />}
    </div>
  );
}
