"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "./ui";
import { CURRENT_USER } from "@/lib/user";
import { useSession } from "@/lib/use-session";
import { toolLabel, type AssistantChat, type Turn } from "@/lib/use-assistant";
import { AnswerBlocks } from "./answer-blocks";
import { InChatCard } from "./assistant-cards";
import { Markdown } from "./markdown";

/**
 * The conversation itself, drawn the same way in the drawer (compact and
 * large) and on the full page: each question, the steps the service took to
 * answer it, its words, its blocks, the records opened from them as cards in
 * the conversation, and why an answer failed.
 *
 * It has no empty state and no availability notice: the drawer and the page
 * draw those around it. It follows the bottom as an answer streams in, unless
 * the person has scrolled up to read, and brings a card into view when one
 * is opened.
 */

/** The chatbot's colours (app/globals.css, the marked chatbot block), each falling back to the console's own token. */
export const ASK = {
  accent: "var(--ask-accent, var(--t-brand, var(--t-ink)))",
  onAccent: "var(--ask-on-accent, var(--t-on-brand, var(--t-on-ink)))",
  surface: "var(--ask-surface, var(--t-surface))",
  surface2: "var(--ask-surface-2, var(--t-canvas))",
  line: "var(--ask-line, var(--t-line))",
  ok: "var(--ask-ok, var(--t-ok))",
  okBg: "var(--ask-ok-bg, var(--t-ok-bg))",
  info: "var(--ask-info, var(--t-queue))",
  infoBg: "var(--ask-info-bg, var(--t-queue-bg))",
  err: "var(--ask-err, var(--t-err))",
  errBg: "var(--ask-err-bg, var(--t-err-bg))",
  cat: (n: number) => `var(--ask-cat-${((n - 1) % 6) + 1}, var(--t-queue))`,
} as const;

/** A tone mixed into the surface: a solid tint in both themes, never transparent. */
export function tint(color: string, pct: number): string {
  return `color-mix(in oklab, ${color} ${pct}%, ${ASK.surface})`;
}

type Size = "compact" | "large" | "page";

const TEXT: Record<Size, string> = {
  compact: "text-[13px] leading-[1.6]",
  large: "text-[13.5px] leading-[1.62]",
  page: "text-[14.5px] leading-[1.65]",
};

export function AssistantThread({ chat, size }: { chat: AssistantChat; size: Size }) {
  const { session: me } = useSession();
  const initials = me?.initials ?? CURRENT_USER.initials;
  const end = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const known = useRef<Set<string> | null>(null);
  const cardEls = useRef(new Map<string, HTMLDivElement>());
  const { turns, busy } = chat;
  const last = turns[turns.length - 1];

  // Whether the person is reading near the bottom: only then does a streaming answer pull the view down.
  useEffect(() => {
    const el = probe.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => {
      atBottom.current = e.isIntersecting;
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // A new turn always comes into view; a streaming one only while the person is near the bottom.
  const count = turns.length;
  const growth = last ? `${last.content.length}:${last.tools?.length ?? 0}:${last.answer ? 1 : 0}:${last.error ? 1 : 0}` : "";
  const seenCount = useRef<number | null>(null);
  useLayoutEffect(() => {
    const first = seenCount.current === null;
    const added = !first && count > (seenCount.current ?? 0);
    seenCount.current = count;
    if (first) {
      end.current?.scrollIntoView({ block: "end" });
      return;
    }
    if (added || (busy && atBottom.current)) end.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [count, growth, busy]);

  // A card just opened comes into view; the cards already there when the thread appears do not move it.
  useEffect(() => {
    const keys = new Set<string>();
    turns.forEach((t, i) => t.cards?.forEach((c) => keys.add(`${i}|${c.href}`)));
    if (known.current) {
      for (const k of keys) {
        if (!known.current.has(k)) cardEls.current.get(k)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
    known.current = keys;
  }, [turns]);

  return (
    <div data-thread={size} className={`relative flex min-w-0 flex-col ${size === "page" ? "gap-8" : size === "large" ? "gap-6" : "gap-5"} ${TEXT[size]}`}>
      {turns.map((t, i) =>
        t.role === "user" ? (
          <UserTurn key={i} t={t} size={size} initials={initials} />
        ) : (
          <div key={i} data-turn="assistant" className="flex min-w-0 items-start gap-2.5">
            <Mark size={size} />
            <div className="flex min-w-0 grow flex-col gap-2.5">
              <Working t={t} live={busy && i === turns.length - 1} />
              {t.content && (
                <div
                  className={`af-fade-up min-w-0 rounded-2xl rounded-tl-md border text-fg ${size === "page" ? "px-4.5 py-3.5" : "px-3.5 py-2.5"}`}
                  style={{ background: ASK.surface, borderColor: ASK.line, boxShadow: "var(--shadow-1)" }}
                >
                  <Markdown text={t.content} />
                </div>
              )}
              {t.answer && (
                <AnswerBlocks
                  answer={t.answer}
                  origin={{ kind: "platform" }}
                  onSend={chat.ask}
                  onNavigate={(href: string, label?: string) => chat.openCard(i, href, label)}
                  wide={size === "page"}
                  busy={busy || Boolean(chat.cannot)}
                  followups={i === turns.length - 1}
                />
              )}
              {(t.cards ?? []).map((c) => {
                const key = `${i}|${c.href}`;
                return (
                  <div
                    key={c.href}
                    data-card-slot={c.href}
                    className="af-pop min-w-0 scroll-my-3"
                    ref={(el) => {
                      if (el) cardEls.current.set(key, el);
                      else cardEls.current.delete(key);
                    }}
                  >
                    <InChatCard href={c.href} label={c.label} onClose={() => chat.closeCard(i, c.href)} onSend={chat.ask} />
                  </div>
                );
              })}
              {t.error && <ErrorCard text={t.error} canRetry={i === turns.length - 1 && !busy} disabled={Boolean(chat.cannot)} onRetry={chat.retry} />}
            </div>
          </div>
        ),
      )}
      <div ref={probe} aria-hidden className="pointer-events-none absolute bottom-0 left-0 h-28 w-px" />
      <div ref={end} aria-hidden className="h-0 scroll-mb-4" />
    </div>
  );
}

/* ── a question ── */

function UserTurn({ t, size, initials }: { t: Turn; size: Size; initials: string }) {
  return (
    <div className="af-fade-up flex items-start justify-end gap-2.5" data-turn="user">
      <div
        className={`rounded-2xl rounded-tr-md bg-ink whitespace-pre-wrap break-words text-on-ink ${size === "page" ? "max-w-[min(72%,720px)] px-4 py-2.5" : "max-w-[85%] px-3.5 py-2"}`}
        style={{ boxShadow: "var(--shadow-1)" }}
      >
        {t.content}
      </div>
      <span
        className={`grid shrink-0 place-items-center rounded-full font-semibold ${size === "page" ? "size-8 text-[11px]" : "size-7 text-[10px]"}`}
        style={{ background: tint(ASK.cat(1), 18), color: ASK.cat(1), boxShadow: `inset 0 0 0 1px ${tint(ASK.cat(1), 35)}` }}
        aria-hidden
      >
        {initials}
      </span>
    </div>
  );
}

/** The assistant's mark beside each answer: the brand colour. */
function Mark({ size }: { size: Size }) {
  const box = size === "page" ? "size-8" : "size-7";
  return (
    <span className={`grid ${box} shrink-0 place-items-center rounded-full`} style={{ background: ASK.accent, color: ASK.onAccent }} aria-hidden>
      <SparkIcon size={size === "page" ? 15 : 13} />
    </span>
  );
}

/* ── the working row ── */

/**
 * The steps the service took, as their frames arrived: a spinner on the step
 * under way, a tick on each one a later frame has followed. Before the first
 * frame it says it is waiting for the service. Once the answer is in, it folds
 * into one line that opens the list again.
 */
function Working({ t, live }: { t: Turn; live: boolean }) {
  const tools = t.tools ?? [];
  const working = live && !t.error;
  const replied = Boolean(t.content || t.answer);
  const [open, setOpen] = useState(false);

  if (!tools.length) {
    if (!working || replied) return null;
    return (
      <div className="af-fade-up flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-[12px] font-medium" style={{ background: ASK.infoBg, color: ASK.info }} role="status">
        <Dots />
        Waiting for the service
      </div>
    );
  }

  const running = working && !replied;
  const stepDone = (k: number) => k < tools.length - 1 || replied;
  const shown = running || open;

  return (
    <div
      className="w-full max-w-[520px] overflow-hidden rounded-xl text-[12px]"
      style={{ background: tint(ASK.info, 7), boxShadow: `inset 0 0 0 1px ${tint(ASK.info, 22)}` }}
      data-working={running ? "running" : "done"}
      role={running ? "status" : undefined}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={running}
        aria-expanded={shown}
        className="focusable flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left font-medium disabled:cursor-default"
        style={{ color: ASK.info }}
      >
        {running ? <Ring /> : stepDone(tools.length - 1) ? <Tick /> : <Stopped />}
        <span className="min-w-0 grow truncate">
          {running
            ? toolLabel(tools[tools.length - 1])
            : `${tools.length} ${tools.length === 1 ? "step" : "steps"} ${stepDone(tools.length - 1) ? "taken" : "before it stopped"}`}
        </span>
        {!running && (
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`} aria-hidden>
            <path d="M6 9l6 6 6-6" />
          </svg>
        )}
      </button>
      {shown && (
        <ol className="flex flex-col gap-1 px-3 pt-0.5 pb-2">
          {tools.map((name, k) => (
            <li key={k} className="af-fade-up flex items-center gap-2 text-fg" data-step={name} data-done={stepDone(k) || undefined}>
              {stepDone(k) ? <Tick /> : running ? <Ring /> : <Stopped />}
              <span className={stepDone(k) ? "text-dim" : "font-medium"}>{toolLabel(name)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Tick() {
  return (
    <span className="af-pop grid size-4 shrink-0 place-items-center rounded-full" style={{ background: ASK.ok, color: "var(--t-on-solid)" }} aria-label="done">
      <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    </span>
  );
}

function Ring() {
  return (
    <span
      className="af-spin inline-block size-4 shrink-0 rounded-full border-2"
      style={{ borderColor: tint(ASK.info, 30), borderTopColor: ASK.info }}
      aria-label="under way"
    />
  );
}

/** A step whose answer never came (the reply failed before a later frame). */
function Stopped() {
  return <span className="grid size-4 shrink-0 place-items-center" aria-label="stopped"><span className="size-2 rounded-full bg-faint" /></span>;
}

function Dots() {
  return (
    <span className="flex items-center gap-[3px]" aria-hidden>
      {[0, 1, 2].map((d) => (
        <span key={d} className="af-pulse size-[5px] rounded-full" style={{ background: "currentColor", animationDelay: `${d * 180}ms` } as CSSProperties} />
      ))}
    </span>
  );
}

/* ── a failed answer ── */

function ErrorCard({ text, canRetry, disabled, onRetry }: { text: string; canRetry: boolean; disabled: boolean; onRetry: () => void }) {
  return (
    <div
      role="alert"
      data-error
      className="af-fade-up flex items-start gap-3 rounded-xl px-3.5 py-3"
      style={{ background: ASK.errBg, boxShadow: `inset 0 0 0 1px ${tint(ASK.err, 35)}` }}
    >
      <span className="grid size-6 shrink-0 place-items-center rounded-full text-[13px] font-bold" style={{ background: ASK.err, color: "var(--t-on-solid)" }} aria-hidden>
        !
      </span>
      <div className="flex min-w-0 grow flex-col gap-0.5">
        <span className="text-[12.5px] font-semibold" style={{ color: ASK.err }}>
          No answer
        </span>
        <span className="text-[12px] leading-[1.5] break-words text-dim">{text}</span>
      </div>
      {canRetry && (
        <Button size="sm" variant="solid" tone="ink" disabled={disabled} onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function SparkIcon({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" />
      <path d="M19 15l.9 2.6L22.5 18.5l-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9z" opacity=".7" />
    </svg>
  );
}
