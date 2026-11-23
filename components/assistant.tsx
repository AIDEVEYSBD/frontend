"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Mono, Spinner } from "./ui";
import { CURRENT_USER } from "@/lib/user";
import { useSession } from "@/lib/use-session";
import { pageFor } from "@/lib/assistant";
import { answerOf, type Answer } from "@/lib/answer-blocks";
import { AnswerBlocks, AskButton } from "./answer-blocks";
import { Markdown } from "./markdown";

/**
 * The console assistant: a round launcher at the bottom right of every page,
 * and the panel it opens above it.
 *
 * It answers questions about what the console shows from the platform
 * service's own records (`GET` and `POST /api/assistant`): the service reads
 * them itself with the asking person's permissions and can change nothing.
 * An answer is a few sentences in the model's own words and blocks (figures,
 * a table whose rows open their records, bars, a chart, steps, links,
 * choices) that the service filled from the reads it made in the same turn;
 * each block names its read in a quiet footer (components/answer-blocks.tsx).
 * The drawer sends the conversation and the page's path and title, nothing
 * else. Every question and its answer, or why there is none, is kept by the
 * service with who asked.
 *
 * The launcher never covers a control of the page: it moves up past one that
 * sits in its corner (a sticky bar's buttons, a table's last row), and when
 * no free place is near, it folds into a narrow tab at the window's edge.
 *
 * The conversation and the panel's size are kept in this browser for the
 * session, so they survive moving between pages.
 */

/**
 * Pages call this with the figures they have loaded. The assistant does not
 * take them: it reads the service's records itself, as the person asking, so
 * what a browser holds is never passed off as a record. Kept so that the pages
 * that call it need no change; it does nothing.
 */
export function usePageFacts(next: Record<string, unknown> | null): void {
  void next;
}

/** What `GET /api/assistant` says: whether a model is offered, which, or why not; and the reads the service may make for this person. */
interface Availability {
  available: boolean;
  model: string | null;
  reason: string | null;
  reads: { name: string; description: string }[];
}

/* ── the conversation ── */

interface Turn { role: "user" | "assistant"; content: string; tools?: string[]; error?: string; answer?: Answer }

const STORE = "af.assistant";
const SIZE_STORE = "af.assistant.size";
const TOOL_LABEL: Record<string, string> = {
  overview: "reading the overview",
  agents: "reading the agents",
  runs: "reading the runs",
  run_record: "reading a run record",
  approvals: "reading the approval queue",
  attention: "reading the attention queue",
  knowledge: "reading the knowledge base",
  search_knowledge: "searching the knowledge passages",
  connectors: "reading the connectors",
  use_cases: "reading the use cases",
  findings: "reading the findings",
  acceptance: "reading the acceptance records",
  applications: "reading the applications",
  models: "reading the models offered",
  audit_trail: "reading the audit trail",
  show_tiles: "laying out figures",
  show_table: "laying out a table",
  show_bars: "laying out bars",
  show_chart: "drawing a chart",
  show_steps: "listing steps",
  show_links: "adding links",
  show_choices: "offering choices",
  suggest_followups: "suggesting questions",
};

/* ── where the launcher may sit ── */

const HOME = 24;
const LAUNCHER = 52;
const GAP = 8;
const LIFT_MOST = 180;
const TAB_WIDTH = 16;
// What a person clicks or types in. A focusable region that only scrolls (role region or group) is not one: it may sit under the launcher.
const CONTROLS =
  'a[href], button, input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [tabindex]:not([tabindex="-1"]):not([role="region"]):not([role="group"])';

interface Spot {
  /** Distance of the launcher's bottom edge from the window's bottom edge. */
  lift: number;
  /** Folded into a narrow tab at the window's edge, because no free place is near its corner. */
  tab: boolean;
  /** Distance of the tab from the window's right edge: the width of the page's scroll bar, so the tab never sits on it. */
  edge: number;
}

/** The page's controls that sit in a rectangle of the window (the assistant's own excepted), sampled on a grid. */
function controlsIn(x0: number, y0: number, x1: number, y1: number): DOMRect[] {
  const found = new Set<Element>();
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const x = x0 + ((x1 - x0) * i) / steps;
      // The bottom edge itself is not sampled: a control that starts exactly there is below the rectangle, not in it.
      const y = y0 + ((y1 - y0 - 1) * j) / steps;
      if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue;
      for (const el of document.elementsFromPoint(x, y)) {
        if (el.closest("[data-assistant]")) continue;
        const control = el.closest(CONTROLS);
        if (control && !control.closest("[data-assistant]")) found.add(control);
      }
    }
  }
  return [...found].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
}

/** The lowest place in the corner where no control of the page sits under the launcher; a tab at the edge when there is none near. */
function clearSpot(): Spot {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const main = document.querySelector("main");
  const edge = main ? Math.max(0, main.offsetWidth - main.clientWidth) : 0;
  const x0 = vw - HOME - LAUNCHER - GAP;
  const x1 = vw - HOME + GAP;
  let lift = HOME;
  while (lift - HOME <= LIFT_MOST) {
    const hits = controlsIn(x0, vh - lift - LAUNCHER - GAP, x1, vh - lift + GAP);
    if (!hits.length) return { lift, tab: false, edge };
    // Above the highest control found; always upward, so the search ends.
    lift = Math.max(lift + 1, Math.ceil(vh - Math.min(...hits.map((r) => r.top)) + GAP));
  }
  return { lift: HOME, tab: true, edge };
}

/** Where the launcher sits now, checked again as the page scrolls, resizes or changes; held still while `frozen` (the panel is open). */
function useClearSpot(frozen: boolean): Spot {
  const [spot, setSpot] = useState<Spot>({ lift: HOME, tab: false, edge: 0 });
  useEffect(() => {
    if (frozen) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      timer = null;
      const next = clearSpot();
      setSpot((prev) => (prev.lift === next.lift && prev.tab === next.tab && prev.edge === next.edge ? prev : next));
    };
    const soon = () => {
      if (timer === null) timer = setTimeout(check, 60);
    };
    check();
    document.addEventListener("scroll", soon, true);
    window.addEventListener("resize", soon);
    const watch = new MutationObserver(soon);
    watch.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden", "open"] });
    const tick = setInterval(soon, 1500);
    return () => {
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener("scroll", soon, true);
      window.removeEventListener("resize", soon);
      watch.disconnect();
      clearInterval(tick);
    };
  }, [frozen]);
  return spot;
}

/** The launcher at the bottom right, and the panel it opens. */
export function Assistant() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [size, setSize] = useState<"compact" | "expanded">("compact");
  const launcher = useRef<HTMLButtonElement>(null);
  // What the service said when asked whether the assistant can answer, or why that could not be read. Null until it has answered.
  const [state, setState] = useState<{ ok: Availability } | { failed: string } | null>(null);
  const spot = useClearSpot(open);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    let live = true;
    fetch("/api/assistant", { cache: "no-store" })
      .then(async (r) => {
        const d = (await r.json().catch(() => null)) as (Availability & { error?: string; phase?: number }) | null;
        if (!r.ok || !d) throw new Error(d?.error ? `${d.error}${d.error === "not built" && d.phase ? ` (phase ${d.phase})` : ""}` : `the server answered ${r.status}`);
        if (live) setState({ ok: d });
      })
      .catch((e: Error) => live && setState({ failed: e.message || "the request did not reach the server" }));
    try {
      if (sessionStorage.getItem(SIZE_STORE) === "expanded") setSize("expanded");
    } catch {
      /* the small size */
    }
    return () => {
      live = false;
    };
  }, []);

  const resize = (next: "compact" | "expanded") => {
    setSize(next);
    try {
      sessionStorage.setItem(SIZE_STORE, next);
    } catch {
      /* held for this page only */
    }
  };

  const close = useCallback(() => {
    setOpen(false);
    launcher.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // A dialog or a menu above the panel takes Escape first.
      if (document.querySelector('[role="dialog"]:not([data-assistant]), [role="menu"]')) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (state === null) return null;
  const cannot = "failed" in state ? `The assistant could not be reached: ${state.failed}` : state.ok.available ? null : state.ok.reason || "The assistant cannot answer on this deployment.";
  const panelBottom = (spot.tab ? HOME : spot.lift) + LAUNCHER + 12;
  return (
    <>
      {mounted && (
        <AssistantPanel
          open={open}
          onClose={close}
          cannot={cannot}
          size={size}
          onResize={resize}
          bottom={panelBottom}
          onNavigate={() => {
            // Opening a record from an answer shows it behind the panel: the large size steps back, and a narrow window closes the panel.
            if (window.innerWidth < 640) setOpen(false);
            else if (size === "expanded") resize("compact");
          }}
        />
      )}
      <button
        ref={launcher}
        type="button"
        data-assistant="launcher"
        data-spot={spot.tab ? "tab" : String(spot.lift)}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Close the assistant" : "Open the assistant"}
        title={open ? "Close the assistant" : "Ask the assistant"}
        style={spot.tab && !open ? { right: spot.edge, bottom: HOME, width: TAB_WIDTH, height: LAUNCHER } : { right: HOME, bottom: spot.lift, width: LAUNCHER, height: LAUNCHER }}
        className={`focusable fixed z-50 grid place-items-center bg-ink text-on-ink elev-3 transition-[bottom,right,width,border-radius,filter] duration-150 ease-out hover:brightness-110 ${
          spot.tab && !open ? "rounded-l-md" : "rounded-full"
        }`}
      >
        {spot.tab && !open ? (
          <span className="h-5 w-[3px] rounded-full bg-on-ink/80" aria-hidden />
        ) : open ? (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <SparkIcon size={21} />
        )}
      </button>
    </>
  );
}

function AssistantPanel({
  open,
  onClose,
  cannot,
  size,
  onResize,
  bottom,
  onNavigate,
}: {
  open: boolean;
  onClose: () => void;
  cannot: string | null;
  size: "compact" | "expanded";
  onResize: (s: "compact" | "expanded") => void;
  bottom: number;
  onNavigate: () => void;
}) {
  const pathname = usePathname();
  const page = pageFor(pathname);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const abort = useRef<AbortController | null>(null);
  const { session: me } = useSession();
  const expanded = size === "expanded";

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORE);
      if (saved) setTurns(JSON.parse(saved));
    } catch {
      /* fresh conversation */
    }
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(turns.slice(-30)));
    } catch {
      /* fine */
    }
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 50);
  }, [open]);

  const askFrom = useCallback(
    async (base: Turn[], text: string) => {
      const q = text.trim();
      if (!q) return;
      setDraft("");
      const history = [...base, { role: "user" as const, content: q }];
      setTurns([...history, { role: "assistant", content: "", tools: [] }]);
      setBusy(true);
      abort.current?.abort();
      const ac = new AbortController();
      abort.current = ac;
      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: history.map((t) => ({ role: t.role, content: t.content })),
            page: { path: pathname, title: page.info.title },
          }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          let msg = `HTTP ${res.status}`;
          try { msg = String((await res.json()).error ?? msg); } catch { /* keep */ }
          throw new Error(msg);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        const patch = (fn: (t: Turn) => Turn) =>
          setTurns((prev) => {
            const next = prev.slice();
            next[next.length - 1] = fn(next[next.length - 1]);
            return next;
          });
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, nl);
            buf = buf.slice(nl + 2);
            const line = chunk.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            let ev: { delta?: string; tool?: string; error?: string; done?: boolean; answer?: unknown };
            try { ev = JSON.parse(line.slice(5)); } catch { continue; }
            if (ev.delta) patch((t) => ({ ...t, content: t.content + ev.delta }));
            if (ev.tool) patch((t) => ({ ...t, tools: [...(t.tools ?? []), ev.tool!] }));
            if (ev.answer) {
              const a = answerOf(ev.answer);
              if (a) patch((t) => ({ ...t, answer: a }));
            }
            if (ev.error) patch((t) => ({ ...t, error: ev.error }));
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          setTurns((prev) => {
            const next = prev.slice();
            next[next.length - 1] = { ...next[next.length - 1], error: (e as Error).message };
            return next;
          });
        }
      } finally {
        setBusy(false);
      }
    },
    [pathname, page.info.title],
  );
  const ask = useCallback((text: string) => { if (!busy && !cannot) askFrom(turns, text); }, [askFrom, busy, turns, cannot]);

  const clear = () => {
    abort.current?.abort();
    setTurns([]);
    setBusy(false);
  };

  // Re-ask the last question: drop the failed answer and its question, then
  // send the question again so the record reads as one exchange.
  const retry = () => {
    const last = [...turns].reverse().find((t) => t.role === "user");
    if (!last) return;
    const idx = turns.lastIndexOf(last);
    const before = turns.slice(0, idx);
    setTurns(before);
    setTimeout(() => askFrom(before, last.content), 0);
  };

  return (
    <section
      aria-label="Assistant"
      data-assistant="panel"
      data-size={size}
      inert={!open}
      style={{ bottom }}
      className={`fixed right-6 z-40 flex origin-bottom-right flex-col overflow-hidden rounded-xl border border-line-strong bg-surface elev-3 transition-[opacity,transform,width,height] duration-200 ease-out max-sm:right-3 max-sm:h-[calc(100dvh-92px)] max-sm:w-[calc(100vw-1.5rem)] ${
        expanded ? "h-[calc(100dvh-104px)] w-[min(860px,calc(100vw-3rem))]" : "h-[min(700px,calc(100dvh-112px))] w-[440px]"
      } ${open ? "visible translate-y-0 scale-100 opacity-100" : "pointer-events-none invisible translate-y-2 scale-[0.96] opacity-0"}`}
    >
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line pr-2.5 pl-3.5">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-ink text-on-ink"><SparkIcon size={14} /></span>
        <span className="flex min-w-0 grow flex-col leading-tight">
          <span className="text-[13px] font-semibold">Assistant</span>
          <span className="truncate text-[11px] text-faint">reads this deployment&rsquo;s records · on {page.info.title}</span>
        </span>
        <Button size="sm" variant="solid" tone="neutral" disabled={!turns.length} onClick={clear} title="Start a new conversation; the record of this one is kept">
          New
        </Button>
        <span className="max-sm:hidden">
          <Button size="sm" variant="solid" tone="neutral" onClick={() => onResize(expanded ? "compact" : "expanded")} title={expanded ? "Make the panel small" : "Make the panel large"}>
            {expanded ? "Smaller" : "Larger"}
          </Button>
        </span>
        <Button size="sm" variant="solid" tone="err" onClick={onClose}>
          Close
        </Button>
      </header>

      <div ref={scroller} className="min-h-0 grow overflow-x-hidden overflow-y-auto overscroll-contain px-3.5 py-3.5">
        <div className={`flex flex-col gap-4 ${expanded ? "mx-auto max-w-[780px]" : ""}`}>
          {cannot && (
            <p role="alert" className="rounded-md border border-err-line bg-canvas px-3 py-2 text-[12px] leading-[1.55] text-err">{cannot}</p>
          )}
          {turns.length === 0 && !cannot && (
            <div className="flex flex-col gap-3">
              <p className="text-[12px] leading-[1.6] text-dim">
                Ask about what this console shows. Answers are read from this deployment&rsquo;s records with your
                permissions, and the assistant changes nothing. Figures in an answer&rsquo;s blocks are filled by the
                service from the records it read, and each block says which. Every question and answer is kept with your name.
              </p>
              <div className="flex flex-col gap-1.5">
                {page.info.suggested.map((s) => (
                  <AskButton key={s} text={s} onSend={ask} full />
                ))}
              </div>
            </div>
          )}
          {turns.map((t, i) =>
            t.role === "user" ? (
              <div key={i} className="flex items-start justify-end gap-2">
                <div className="max-w-[85%] rounded-lg rounded-tr-sm bg-ink px-3 py-2 text-[12.5px] leading-[1.55] whitespace-pre-wrap text-on-ink">{t.content}</div>
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-raise text-[9px] font-semibold text-fg">{me?.initials ?? CURRENT_USER.initials}</span>
              </div>
            ) : (
              <div key={i} className="flex items-start gap-2" data-turn="assistant">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink text-on-ink"><SparkIcon size={11} /></span>
                <div className="flex min-w-0 grow flex-col gap-2">
                  {(t.tools ?? []).length > 0 && (
                    <span className="flex flex-wrap gap-1">
                      {(t.tools ?? []).map((name, k) => (
                        <Mono key={k} className="rounded-sm bg-raise px-1.5 py-px text-[9.5px] text-faint">{TOOL_LABEL[name] ?? name}</Mono>
                      ))}
                    </span>
                  )}
                  {t.content ? (
                    <div className="rounded-lg rounded-tl-sm border border-line bg-canvas px-3 py-2 text-[12.5px] leading-[1.6] text-fg">
                      <Markdown text={t.content} />
                    </div>
                  ) : busy && i === turns.length - 1 && !t.error ? (
                    <span className="flex items-center gap-2 px-1 py-1 text-[11px] text-faint"><Spinner size={12} /> reading the records</span>
                  ) : null}
                  {t.answer && (
                    <AnswerBlocks answer={t.answer} origin={{ kind: "platform" }} onSend={ask} onNavigate={onNavigate} busy={busy || Boolean(cannot)} followups={i === turns.length - 1} />
                  )}
                  {t.error && (
                    <span role="alert" className="flex flex-wrap items-center gap-2 px-1 text-[11px] leading-[1.5] text-err">
                      {t.error}
                      {i === turns.length - 1 && !busy && (
                        <Button size="sm" variant="solid" tone="neutral" disabled={Boolean(cannot)} onClick={retry}>Try again</Button>
                      )}
                    </span>
                  )}
                </div>
              </div>
            ),
          )}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(draft);
        }}
        className="flex shrink-0 items-end gap-2 border-t border-line p-3"
      >
        <textarea
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              ask(draft);
            }
          }}
          rows={2}
          disabled={Boolean(cannot)}
          aria-label="Question to the assistant"
          placeholder={cannot ? "The assistant cannot answer: see above" : `Ask about ${page.info.title.toLowerCase()}…`}
          className="focusable min-h-[40px] grow resize-none rounded-md border border-line bg-canvas px-3 py-2 text-[12.5px] leading-[1.5] text-fg placeholder:text-ghost"
        />
        <Button size="sm" variant="solid" tone="ink" loading={busy} disabled={Boolean(cannot)} onClick={() => ask(draft)}>Send</Button>
      </form>
    </section>
  );
}

function SparkIcon({ size = 13 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z" />
      <path d="M19 15l.9 2.6L22.5 18.5l-2.6.9L19 22l-.9-2.6-2.6-.9 2.6-.9z" opacity=".7" />
    </svg>
  );
}
