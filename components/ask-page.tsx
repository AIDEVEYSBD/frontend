"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Button } from "./ui";
import { NavIcon, type NavIconName } from "./nav-icons";
import { AssistantThread } from "./assistant-thread";
import { useAssistant } from "@/lib/use-assistant";
import { useSession } from "@/lib/use-session";
import { PAGES } from "@/lib/assistant";

/**
 * The assistant on a full page (/ask).
 *
 * The same conversation as the drawer (lib/use-assistant.ts keeps it for the
 * browser session), drawn by the same thread (components/assistant-thread.tsx)
 * at its widest. A record an answer names opens as a card inside the
 * conversation; nothing on this page navigates except a card's own
 * "Open page".
 *
 * Empty, the page greets the person by the first name the platform gave for
 * them and offers questions grouped by what they are about. Every question is
 * one of the pages' own suggestions in lib/assistant.ts; questions that only
 * make sense on their page ("this page", "this step") are left out.
 */

interface Topic {
  title: string;
  icon: NavIconName;
  /** The categorical colour: the chatbot block's token in app/globals.css, with the answer-block tone beneath it. */
  colour: string;
  /** The pages whose suggestions this topic offers, taken in turn. */
  pages: string[];
}

const TOPICS: Topic[] = [
  { title: "What is running", icon: "activity", colour: "var(--ask-cat-1, var(--t-ab-blue))", pages: ["/control", "/runs", "/approvals", "/overview"] },
  { title: "Findings and results", icon: "file-check", colour: "var(--ask-cat-2, var(--t-ab-amber))", pages: ["/findings", "/workloads", "/outcomes", "/deliverables"] },
  { title: "Agents", icon: "bot", colour: "var(--ask-cat-3, var(--t-ab-teal))", pages: ["/agents", "/evals", "/lifecycle"] },
  { title: "Security and policy", icon: "shield", colour: "var(--ask-cat-4, var(--t-ab-violet))", pages: ["/policy", "/guardian", "/guardrails", "/breakers"] },
  { title: "Costs and models", icon: "wallet", colour: "var(--ask-cat-5, var(--t-ab-olive))", pages: ["/finops", "/configuration"] },
  { title: "Saros and its records", icon: "badge-check", colour: "var(--ask-cat-6, var(--t-ab-magenta))", pages: ["/ask", "/iam", "/evidence", "/knowledge"] },
];

/** A question bound to the page it is asked on. */
const PAGE_BOUND = /\b(this|here)\b/i;
const PER_TOPIC = 3;

/** Each topic's questions: its pages' suggestions taken in turn, each question offered once across the page. */
function topicQuestions(): { topic: Topic; questions: string[] }[] {
  const seen = new Set<string>();
  return TOPICS.map((topic) => {
    const queues = topic.pages.map((p) => (PAGES[p]?.suggested ?? []).filter((q) => !PAGE_BOUND.test(q)));
    const questions: string[] = [];
    while (questions.length < PER_TOPIC && queues.some((q) => q.length)) {
      for (const queue of queues) {
        while (queue.length && seen.has(queue[0]!)) queue.shift();
        const next = queue.shift();
        if (next && questions.length < PER_TOPIC) {
          questions.push(next);
          seen.add(next);
        }
      }
    }
    return { topic, questions };
  }).filter((t) => t.questions.length);
}

const GROUPS = topicQuestions();
const ACCENT = "var(--ask-accent, var(--color-brand))";
const MARK: CSSProperties = { background: `linear-gradient(135deg, ${ACCENT}, var(--ask-cat-6, var(--t-ab-magenta)))` };

export function AskPage() {
  const chat = useAssistant();
  const { session } = useSession();
  const [draft, setDraft] = useState("");
  // Stored turns arrive after the first paint; the greeting waits for them so a conversation never flashes the empty page.
  const [mounted, setMounted] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  const cannot = chat.cannot;
  // A touch screen would raise its keyboard over the greeting; there the person taps the composer when they want it.
  const focusComposer = () => {
    if (window.matchMedia("(pointer: fine)").matches) input.current?.focus();
  };
  const empty = chat.turns.length === 0;
  const first = session?.name?.trim().split(/\s+/)[0];

  // The store tells its subscribers about the saved turns in a microtask after hydration; a task later they are in.
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 0);
    focusComposer();
    return () => clearTimeout(t);
  }, []);

  // A new conversation starts at the top of the greeting, not where the last one was scrolled to.
  useEffect(() => {
    if (empty) scroller.current?.scrollTo({ top: 0 });
  }, [empty]);

  // The composer grows with what is typed, up to a few lines.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  const send = (text: string) => {
    const q = text.trim();
    if (!q || chat.busy || cannot) return;
    chat.ask(q);
    setDraft("");
  };

  const fresh = () => {
    chat.reset();
    setDraft("");
    focusComposer();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas" data-page="ask">
      <header className="flex h-14 shrink-0 items-center justify-end gap-3 border-b border-line bg-surface px-4 max-lg:h-12 sm:px-6">
        {/* Below lg the console's own top bar already names the page; the mark and title stay for a wide screen. */}
        <span className="grid size-8 shrink-0 place-items-center rounded-lg text-white max-lg:hidden" style={MARK}>
          <NavIcon name="sparkles" size={16} />
        </span>
        <div className="flex min-w-0 grow flex-col leading-tight max-lg:sr-only">
          <h1 className="text-[15px] font-semibold tracking-[-0.01em] text-fg">Assistant</h1>
          <p className="truncate text-[11.5px] text-faint">Reads this deployment&rsquo;s records with your permissions</p>
        </div>
        <Button variant="solid" tone="neutral" size="md" onClick={fresh} disabled={empty && !draft} title="Start again; the record of this conversation is kept">
          <NavIcon name="plus" size={14} />
          <span className="max-sm:hidden">New conversation</span>
          <span className="sm:hidden">New</span>
        </Button>
      </header>

      {/* The thread follows the end of the conversation itself (components/assistant-thread.tsx); this is the box it scrolls in. */}
      <div ref={scroller} className="min-h-0 grow overflow-x-hidden overflow-y-auto overscroll-contain">
        {cannot && (
          <div className="mx-auto w-full max-w-[960px] px-4 pt-5 sm:px-8">
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-err-line bg-err-bg px-3.5 py-2.5 text-[12.5px] leading-[1.55] text-err">
              <NavIcon name="circle-alert" size={15} className="mt-px shrink-0" />
              {cannot}
            </p>
          </div>
        )}

        {!mounted ? null : empty ? (
          <Welcome name={first} disabled={Boolean(cannot) || chat.busy} onAsk={send} />
        ) : (
          <div className="mx-auto w-full max-w-[960px] px-4 pt-6 pb-10 sm:px-8 sm:pt-8">
            <AssistantThread chat={chat} size="page" />
          </div>
        )}
      </div>

      <footer className="shrink-0 border-t border-line bg-surface pt-3 pb-3 sm:pb-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
          className="mx-auto w-full max-w-[960px] px-3 sm:px-8"
        >
          <div className="flex items-end gap-2 rounded-2xl border border-line-strong bg-canvas p-2 pl-4 elev-2 transition-[border-color,box-shadow] duration-150 focus-within:border-[color:color-mix(in_oklab,var(--color-ink)_45%,var(--color-line))] focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-ink)_10%,transparent)]">
            <textarea
              ref={input}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(draft);
                }
              }}
              rows={1}
              disabled={Boolean(cannot)}
              aria-label="Question to the assistant"
              placeholder={cannot ? "The assistant cannot answer: see above" : "Ask about this deployment…"}
              className="max-h-[200px] min-h-[44px] grow resize-none bg-transparent py-[11px] text-[14px] leading-[1.5] text-fg outline-none placeholder:text-ghost disabled:cursor-not-allowed"
            />
            <Button type="submit" variant="solid" tone="ink" size="lg" loading={chat.busy} disabled={Boolean(cannot) || !draft.trim()}>
              Send
              <NavIcon name="arrow-right" size={15} />
            </Button>
          </div>
          <p className="mt-1.5 text-center text-[11px] text-faint max-sm:hidden">Enter sends · Shift+Enter starts a new line</p>
        </form>
      </footer>
    </div>
  );
}

/** The empty page: a greeting, and the questions grouped by what they are about. */
function Welcome({ name, disabled, onAsk }: { name: string | undefined; disabled: boolean; onAsk: (q: string) => void }) {
  return (
    <div className="@container mx-auto flex w-full max-w-[1120px] flex-col gap-8 px-4 pt-10 pb-10 sm:px-8 sm:pt-16">
      <div className="af-fade-up flex flex-col items-center gap-3 text-center">
        <span className="grid size-12 place-items-center rounded-2xl text-white elev-2" style={MARK}>
          <NavIcon name="sparkles" size={24} />
        </span>
        <h2 className="text-[26px] leading-tight font-semibold tracking-[-0.02em] text-fg max-sm:text-[21px]">
          What would you like to know{name ? `, ${name}` : ""}?
        </h2>
        <p className="max-w-[520px] text-[13.5px] leading-[1.55] text-dim">Every answer is read from this deployment&rsquo;s records, and any record it names opens here as a card.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 @[620px]:grid-cols-2 @[960px]:grid-cols-3">
        {GROUPS.map(({ topic, questions }, i) => (
          <section
            key={topic.title}
            aria-label={topic.title}
            style={{ "--tc": topic.colour, animationDelay: `${60 + i * 50}ms` } as CSSProperties}
            className="af-fade-up relative flex flex-col overflow-hidden rounded-xl border border-[color:color-mix(in_oklab,var(--tc)_28%,var(--color-line))] bg-[color:color-mix(in_oklab,var(--tc)_5%,var(--color-surface))] elev-1"
          >
            <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ background: "var(--tc)" }} />
            <div className="flex items-center gap-2.5 px-4 pt-4 pb-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg text-white" style={{ background: "var(--tc)" }}>
                <NavIcon name={topic.icon} size={16} />
              </span>
              <h3 className="text-[13.5px] font-semibold tracking-[-0.005em] text-fg">{topic.title}</h3>
            </div>
            <div className="flex grow flex-col gap-1.5 px-3 pb-3">
              {questions.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={disabled}
                  onClick={() => onAsk(q)}
                  className="focusable group flex min-h-[40px] cursor-pointer items-center gap-2.5 rounded-lg border border-[color:color-mix(in_oklab,var(--tc)_16%,var(--color-line))] bg-surface px-3 py-2 text-left text-[13px] leading-[1.4] text-fg transition-[background-color,border-color] duration-100 hover:border-[color:color-mix(in_oklab,var(--tc)_45%,var(--color-line))] hover:bg-[color:color-mix(in_oklab,var(--tc)_10%,var(--color-surface))] disabled:cursor-default disabled:opacity-50 disabled:hover:bg-surface"
                >
                  <span className="min-w-0 grow">{q}</span>
                  <span className="shrink-0 text-[color:var(--tc)] transition-transform duration-150 group-hover:translate-x-0.5">
                    <NavIcon name="arrow-right" size={14} />
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
