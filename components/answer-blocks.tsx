"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Button, Mono, Tag } from "./ui";
import { BlockBoundary } from "./block-boundary";
import { readWords, type Answer, type BarsBlock, type Block, type BlockFormat, type BlockSource, type ChartBlock, type Origin, type StepsBlock, type TableBlock, type TilesBlock, type Value } from "@/lib/answer-blocks";

/**
 * One renderer for answers as blocks, used by both chats: the console
 * assistant (components/assistant.tsx) and a registered chatbot on the Chat
 * page (components/chat-pane.tsx).
 *
 * The console assistant's blocks were filled by the service from its own
 * records: each carries a quiet footer naming the read it came from and when,
 * and a row, a bar or a tile opens the record or page behind it. A chatbot's
 * blocks hold the chatbot's own words; they are marked as written by it and
 * link nothing but console pages.
 *
 * A block the service refused, or one this console could not read, is shown
 * where it would have been, in red, with the reason. A value that is null in
 * the record is shown as "none" (an amount in US dollars as "no price set",
 * which is what a null cost means on this platform), never as 0.
 */

const SERIES = ["var(--t-c2)", "var(--t-c5)"];

/* ═══════════════════ values ═══════════════════ */

function money(n: number): string {
  if (n === 0) return "$0.00";
  if (Math.abs(n) < 0.01) return `$${n.toFixed(6).replace(/0+$/, "")}`;
  return `$${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function when(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** A value in words for its format. */
export function valueText(v: Value, format: BlockFormat | null): string {
  if (v === null) return format === "usd" ? "no price set" : "none";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number") return format === "usd" ? money(v) : v.toLocaleString("en-GB", { maximumFractionDigits: 6 });
  if (format === "time") return when(v);
  return v;
}

function ValueView({ v, format, big = false }: { v: Value; format: BlockFormat | null; big?: boolean }) {
  if (v === null) return <span className="text-ghost italic">{valueText(v, format)}</span>;
  if (format === "id" && typeof v === "string") return <Mono className={big ? "text-[14px]" : "text-[11px]"}>{v}</Mono>;
  return <span className={typeof v === "number" ? "tnum" : undefined}>{valueText(v, format)}</span>;
}

/**
 * A question to send as the next message: a choice, a follow-up or a
 * suggested question. Solid like every button of the console, and it wraps,
 * since a question can be longer than a button's single line.
 */
export function AskButton({ text, onSend, disabled = false, full = false }: { text: string; onSend: (t: string) => void; disabled?: boolean; full?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSend(text)}
      className={`focusable min-h-7 cursor-pointer rounded-sm border border-transparent bg-raise px-2.5 py-1 text-left text-[12px] leading-[1.4] font-medium break-words text-fg transition-[filter,opacity] duration-100 hover:brightness-[1.08] active:brightness-95 disabled:pointer-events-none disabled:opacity-40 ${full ? "w-full" : "max-w-full"}`}
    >
      {text}
    </button>
  );
}

/* ═══════════════════ the frame ═══════════════════ */

function Frame({ title, source, origin, children, kind }: { title: string | null; source: BlockSource | null; origin: Origin; children: ReactNode; kind: string }) {
  return (
    <section data-block={kind} className="min-w-0 overflow-hidden rounded-md border border-line bg-surface">
      {title && <h4 className="border-b border-line bg-raise/55 px-3 py-1.5 text-[11.5px] font-semibold text-fg">{title}</h4>}
      {children}
      <SourceLine source={source} origin={origin} />
    </section>
  );
}

function SourceLine({ source, origin }: { source: BlockSource | null; origin: Origin }) {
  if (origin.kind === "chatbot") return null;
  if (!source) return null;
  const at = source.reads.map((r) => r.at).sort().at(-1) ?? "";
  return (
    <p data-source className="border-t border-line px-3 py-1.5 text-[10px] leading-[1.45] text-faint">
      From {source.reads.map((r) => `${r.id} ${readWords(r)}`).join(" and ")}
      {at ? `, read ${when(at)}` : ""}
      {source.note ? ` · ${source.note}` : ""}
    </p>
  );
}

/* ═══════════════════ the seven blocks ═══════════════════ */

function Tiles({ b, origin, onNavigate }: { b: TilesBlock; origin: Origin; onNavigate?: () => void }) {
  return (
    <Frame title={b.title} source={b.source} origin={origin} kind="tiles">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))]">
        {b.items.map((t, i) => {
          const body = (
            <>
              <span className="truncate text-[10.5px] text-faint">{t.label}</span>
              <span className="text-[18px] leading-tight font-semibold tracking-[-0.02em] text-fg">
                <ValueView v={t.value} format={t.format} big />
              </span>
            </>
          );
          return t.href ? (
            <Link key={i} href={t.href} onClick={onNavigate} className="focusable -mr-px -mb-px flex min-w-0 flex-col gap-1 border-r border-b border-line px-3 py-2 hover:bg-raise">
              {body}
            </Link>
          ) : (
            <div key={i} className="-mr-px -mb-px flex min-w-0 flex-col gap-1 border-r border-b border-line px-3 py-2">
              {body}
            </div>
          );
        })}
      </div>
    </Frame>
  );
}

function Table({ b, origin, onNavigate }: { b: TableBlock; origin: Origin; onNavigate?: () => void }) {
  const router = useRouter();
  const go = (href: string) => {
    onNavigate?.();
    router.push(href);
  };
  return (
    <Frame title={b.title} source={b.source} origin={origin} kind="table">
      {b.rows.length > 0 && (
        // In a narrow panel each row is a record: its first cell as the title, the other cells as labelled facts beneath.
        <ul className="divide-y divide-line @xl:hidden">
          {b.rows.map((r, i) => {
            const facts = (
              <>
                <span className="block font-medium break-words text-fg">
                  <ValueView v={r.cells[0] ?? null} format={b.columns[0]?.format ?? null} />
                </span>
                <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-faint">
                  {r.cells.slice(1).map((c, k) => (
                    <span key={k} className="flex min-w-0 items-baseline gap-1">
                      <span className="shrink-0">{b.columns[k + 1]?.label}</span>
                      <span className="min-w-0 break-words text-dim">
                        <ValueView v={c} format={b.columns[k + 1]?.format ?? null} />
                      </span>
                    </span>
                  ))}
                </span>
              </>
            );
            return (
              <li key={i} data-row={i} className="text-[11.5px]">
                {r.href ? (
                  <Link href={r.href} onClick={onNavigate} className="focusable block px-3 py-1.5 hover:bg-raise">
                    {facts}
                  </Link>
                ) : (
                  <div className="px-3 py-1.5">{facts}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {b.rows.length === 0 ? (
        <p className="px-3 py-3 text-[11.5px] text-faint">There are none.</p>
      ) : (
        <div className="hidden overflow-x-auto @xl:block">
          <table className="w-full border-collapse text-[11.5px]">
            <thead>
              <tr className="border-b border-line text-left text-[10.5px] text-faint">
                {b.columns.map((c, i) => (
                  <th key={i} className={`px-3 py-1.5 font-medium whitespace-nowrap ${c.format === "usd" || c.format === "number" ? "text-right" : ""}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr
                  key={i}
                  role={r.href ? "link" : undefined}
                  tabIndex={r.href ? 0 : undefined}
                  onClick={r.href ? () => go(r.href!) : undefined}
                  onKeyDown={r.href ? (e) => e.key === "Enter" && go(r.href!) : undefined}
                  title={r.href ? `Open ${r.href}` : undefined}
                  className={`border-b border-line align-top last:border-b-0 ${r.href ? "focusable cursor-pointer hover:bg-raise" : ""}`}
                >
                  {r.cells.map((c, k) => (
                    <td key={k} className={`max-w-[280px] px-3 py-1.5 break-words text-fg ${b.columns[k]?.format === "usd" || b.columns[k]?.format === "number" ? "text-right" : ""}`}>
                      <ValueView v={c} format={b.columns[k]?.format ?? null} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {b.total !== null && b.total > b.rows.length && (
        <p className="border-t border-line px-3 py-1.5 text-[10.5px] text-warn">
          {b.rows.length.toLocaleString("en-GB")} of {b.total.toLocaleString("en-GB")} rows are shown.
        </p>
      )}
    </Frame>
  );
}

function Bars({ b, origin, onNavigate }: { b: BarsBlock; origin: Origin; onNavigate?: () => void }) {
  const max = Math.max(0, ...b.items.map((i) => i.value ?? 0));
  return (
    <Frame title={b.title} source={b.source} origin={origin} kind="bars">
      <div className="flex flex-col gap-0.5 px-2 py-2">
        {b.items.map((it, i) => {
          const row = (
            <>
              <span className="truncate text-fg" title={it.label}>{it.label}</span>
              <span className="h-[7px] overflow-hidden rounded-[2px] bg-raise">
                {it.value !== null && <span className="block h-full rounded-[2px]" style={{ width: max > 0 ? `${(it.value / max) * 100}%` : "0%", minWidth: it.value ? 3 : 0, background: SERIES[0] }} />}
              </span>
              <span className="text-right">
                <ValueView v={it.value} format={b.format} />
              </span>
            </>
          );
          const cls = "grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2.5 rounded-sm px-1.5 py-1 text-[11.5px]";
          return it.href ? (
            <Link key={i} href={it.href} onClick={onNavigate} className={`focusable ${cls} hover:bg-raise`}>
              {row}
            </Link>
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

function Chart({ b, origin }: { b: ChartBlock; origin: Origin }) {
  const known = b.series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const max = Math.max(0, ...known);
  const every = Math.max(1, Math.ceil(b.x.length / 8));
  return (
    <Frame title={b.title} source={b.source} origin={origin} kind="chart">
      <div className="flex flex-col gap-2 px-3 pt-3 pb-2">
        <div className="flex items-baseline justify-between text-[10px] text-faint">
          <span className="tnum">highest {valueText(max, b.format)}</span>
          {b.series.length > 1 && (
            <span className="flex gap-3">
              {b.series.map((s, k) => (
                <span key={k} className="flex items-center gap-1.5">
                  <span className="size-2 rounded-[2px]" style={{ background: SERIES[k] }} />
                  {s.label}
                </span>
              ))}
            </span>
          )}
        </div>
        <div className="flex h-[120px] items-end gap-[3px] border-b border-line-strong">
          {b.x.map((label, i) => (
            <div key={i} className="flex h-full min-w-0 flex-1 items-end justify-center gap-[2px]">
              {b.series.map((s, k) => {
                const v = s.values[i];
                return v === null ? (
                  <span key={k} title={`${label} · ${s.label}: none (no value in the record)`} className="h-[8px] w-full max-w-5 rounded-t-[2px] border border-dashed border-line-strong" />
                ) : (
                  <span key={k} title={`${label} · ${s.label}: ${valueText(v, b.format)}`} className="w-full max-w-5 rounded-t-[2px]" style={{ height: max > 0 ? `${(v / max) * 100}%` : "0%", minHeight: v ? 2 : 0, background: SERIES[k] }} />
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex gap-[3px]">
          {b.x.map((label, i) => (
            <span key={i} className="min-w-0 flex-1 truncate text-center text-[9.5px] text-faint">{i % every === 0 ? label.replace(/^week of /, "") : ""}</span>
          ))}
        </div>
        {b.series.length === 1 && <span className="text-[10px] text-faint">{b.series[0].label}</span>}
      </div>
    </Frame>
  );
}

function Steps({ b, origin }: { b: StepsBlock; origin: Origin }) {
  return (
    <Frame title={b.title} source={b.source} origin={origin} kind="steps">
      <ol className="flex flex-col divide-y divide-line">
        {b.steps.map((s, i) => (
          <li key={i} className="grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-2 px-3 py-1.5 text-[11.5px]">
            <span className="tnum pt-px text-[10.5px] text-faint">{i + 1}</span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="font-medium break-words text-fg">{s.label}</span>
              {s.detail && <span className="leading-[1.45] break-words text-dim">{s.detail}</span>}
            </span>
            <span className="flex flex-col items-end gap-0.5">
              {s.state && <Tag>{s.state}</Tag>}
              {s.at && <span className="tnum text-[10px] text-faint">{when(s.at)}</span>}
            </span>
          </li>
        ))}
      </ol>
    </Frame>
  );
}

export function BlockView({ b, origin, onSend, onNavigate, busy }: { b: Block; origin: Origin; onSend: (text: string) => void; onNavigate?: () => void; busy: boolean }) {
  switch (b.type) {
    case "tiles":
      return <Tiles b={b} origin={origin} onNavigate={onNavigate} />;
    case "table":
      return <Table b={b} origin={origin} onNavigate={onNavigate} />;
    case "bars":
      return <Bars b={b} origin={origin} onNavigate={onNavigate} />;
    case "chart":
      return <Chart b={b} origin={origin} />;
    case "steps":
      return <Steps b={b} origin={origin} />;
    case "links":
      return (
        <div data-block="links" className="flex flex-wrap gap-1.5">
          {b.links.map((l, i) => (
            <span key={i} onClick={onNavigate}>
              <Button size="sm" variant="solid" tone="neutral" href={l.href}>
                {l.label}
              </Button>
            </span>
          ))}
        </div>
      );
    case "choices":
      return (
        <div data-block="choices" className="flex flex-col gap-1.5">
          {b.title && <span className="text-[11px] font-medium text-dim">{b.title}</span>}
          <div className="flex flex-wrap gap-1.5">
            {b.options.map((o) => (
              <AskButton key={o} text={o} onSend={onSend} disabled={busy} />
            ))}
          </div>
        </div>
      );
  }
}

/* ═══════════════════ an answer ═══════════════════ */

/**
 * The blocks of one answer, its refusals and its follow-up questions. The text
 * is drawn by the chat itself, above this. `onSend` sends a choice or a
 * follow-up as the next message; `onNavigate` is called before a link opens a
 * page (the assistant steps its panel back to the small size).
 */
export function AnswerBlocks({ answer, origin, onSend, onNavigate, busy = false, followups = true }: { answer: Answer; origin: Origin; onSend: (text: string) => void; onNavigate?: () => void; busy?: boolean; followups?: boolean }) {
  const fellBack = origin.kind === "chatbot" && answer.replyFormat && answer.replyFormat !== "json_schema";
  if (!answer.blocks.length && !answer.refused.length && !(followups && answer.followups.length) && !fellBack) return null;
  return (
    <div className="@container flex min-w-0 flex-col gap-2">
      {origin.kind === "chatbot" && answer.blocks.length > 0 && (
        <p className="text-[10.5px] leading-[1.45] text-faint">
          Written by {origin.name}: these blocks are the chatbot&rsquo;s own words, not figures from this platform&rsquo;s records.
        </p>
      )}
      {fellBack && (
        <p className="text-[10.5px] leading-[1.45] text-warn">
          The model endpoint refused the answer&rsquo;s schema and was asked again for plain JSON ({answer.replyFormat}); the service checked the answer all the same.
        </p>
      )}
      {answer.blocks.map((b, i) => (
        <BlockBoundary key={i} what={`The ${b.type} block`}>
          <BlockView b={b} origin={origin} onSend={onSend} onNavigate={onNavigate} busy={busy} />
        </BlockBoundary>
      ))}
      {answer.refused.map((r, i) => (
        <div key={`refused-${i}`} role="alert" data-refused={r.block} className="relative overflow-hidden rounded-md border border-err-line bg-surface py-1.5 pr-3 pl-4 text-[11.5px] leading-[1.5]">
          <span className="absolute inset-y-0 left-0 w-[3px] bg-err" aria-hidden />
          <span className="font-semibold text-err">{r.block === "followups" ? "The follow-up questions were refused." : `A ${r.block} block was refused.`}</span> <span className="text-dim">{r.reason}</span>
        </div>
      ))}
      {followups && answer.followups.length > 0 && (
        <div data-followups className="flex flex-col gap-1.5 pt-1">
          <span className="text-[10px] font-medium tracking-[0.06em] text-faint uppercase">Ask next</span>
          <div className="flex flex-wrap gap-1.5">
            {answer.followups.map((q) => (
              <AskButton key={q} text={q} onSend={onSend} disabled={busy} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
