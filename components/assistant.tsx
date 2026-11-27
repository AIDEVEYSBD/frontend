"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, IconButton } from "./ui";
import { useSession } from "@/lib/use-session";
import { pageFor } from "@/lib/assistant";
import { useAssistant, type AssistantChat } from "@/lib/use-assistant";
import { ASK, AssistantThread, SparkIcon, tint } from "./assistant-thread";

/**
 * The console assistant: a round launcher at the bottom right of every page,
 * and the drawer it opens above it. The full page at /ask shows the same
 * conversation (lib/use-assistant.ts), so the launcher and the drawer are not
 * drawn there.
 *
 * It answers questions about what the console shows from the platform
 * service's own records (`GET` and `POST /api/assistant`): the service reads
 * them itself with the asking person's permissions and can change nothing.
 * An answer is a few sentences in the model's own words and blocks (figures,
 * a table whose rows open their records, bars, a chart, steps, links,
 * choices) that the service filled from the reads it made in the same turn.
 * A record or page an answer points to opens as a card inside the
 * conversation (components/assistant-thread.tsx); the card's "Open page"
 * button is what leaves the chat. The drawer sends the conversation and the
 * page's path and title, nothing else. Every question and its answer, or why
 * there is none, is kept by the service with who asked.
 *
 * The launcher never covers a control of the page: it moves up past one that
 * sits in its corner (a sticky bar's buttons, a table's last row), and when
 * no free place is near, it folds into a narrow tab at the window's edge.
 *
 * The floating drawer closes on Escape and on a click outside it. "Embed"
 * docks it on the right of the page as a full-height sidebar instead: the
 * page's main column makes room for it (the marked "ask dock" rule in
 * app/globals.css, keyed on `data-ask-dock` on the root element), and a click
 * on the page leaves it open. Below 1024 px wide the dock is the floating
 * drawer again. "Go to" opens the same conversation on the full page.
 *
 * The drawer's size is kept in this browser for the session; whether it is
 * docked (and the dock open) is kept in this browser's local storage.
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

const SIZE_STORE = "af.assistant.size";
/** "open" or "closed" while the assistant is docked; absent while it floats. */
const DOCK_STORE = "saros.ask.dock";
/** The dock's width; the "ask dock" rule in app/globals.css gives the main column the same right margin. */
const DOCK_WIDTH = 420;
/** The narrowest window the dock is offered on; below it, the floating drawer. Matches the "ask dock" rule's media query. */
const DOCK_MEDIA = "(min-width: 1024px)";

/** Whether the window is wide enough for the dock, followed as it resizes. False on the server and the first render. */
function useWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(DOCK_MEDIA);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

/** What a click outside the drawer may land on without closing it: a dialog, a menu or a popover opened from it. */
const KEEPS_OPEN = '[data-assistant], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], dialog, [data-radix-popper-content-wrapper]';

/** The full page's address: the launcher and the drawer are not drawn on it. */
function onAskPage(path: string): boolean {
  return path === "/ask" || path.startsWith("/ask/");
}

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

/** Where the launcher sits now, checked again as the page scrolls, resizes or changes; held still while `frozen` (the drawer is open, or nothing is drawn). */
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

/** The launcher at the bottom right, and the drawer it opens. Nothing on the full page (/ask). */
export function Assistant() {
  const pathname = usePathname() || "/";
  const onAsk = onAskPage(pathname);
  const chat = useAssistant();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [size, setSize] = useState<"compact" | "expanded">("compact");
  const [dock, setDock] = useState(false);
  const wide = useWide();
  // Docked only where the window is wide enough; below it the same choice shows the floating drawer.
  const docked = dock && wide && !onAsk;
  const launcher = useRef<HTMLButtonElement>(null);
  const spot = useClearSpot(open || onAsk);
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(SIZE_STORE) === "expanded") setSize("expanded");
    } catch {
      /* the small size */
    }
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(DOCK_STORE);
    } catch {
      /* floating */
    }
    if (saved === "open" || saved === "closed") {
      setDock(true);
      // A dock left open stays open across reloads, where the window is wide enough for it.
      if (saved === "open" && !onAskPage(window.location.pathname) && window.matchMedia(DOCK_MEDIA).matches) setOpen(true);
    }
  }, []);

  // While docked, remember whether the dock is open; floating, forget it.
  useEffect(() => {
    try {
      if (dock) localStorage.setItem(DOCK_STORE, open ? "open" : "closed");
      else localStorage.removeItem(DOCK_STORE);
    } catch {
      /* held for this page only */
    }
  }, [dock, open]);

  // The page's main column makes room for an open dock (the "ask dock" rule in app/globals.css).
  const shifted = docked && open;
  useEffect(() => {
    const root = document.documentElement;
    if (shifted) root.setAttribute("data-ask-dock", "1");
    else root.removeAttribute("data-ask-dock");
    return () => root.removeAttribute("data-ask-dock");
  }, [shifted]);

  const toggleDock = useCallback(() => {
    setDock((d) => !d);
    setOpen(true);
  }, []);

  const resize = useCallback((next: "compact" | "expanded") => {
    setSize(next);
    try {
      sessionStorage.setItem(SIZE_STORE, next);
    } catch {
      /* held for this page only */
    }
  }, []);

  // Moving to another page (a card's "Open page", the sidebar) shows that page: the large floating drawer steps back to
  // the small size and a narrow window closes it; the dock stays as it is. Arriving on the full page closes the drawer,
  // so it is not open on the way back unless docked.
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    if (onAsk) {
      if (!dock) setOpen(false);
    } else if (docked) return;
    else if (window.innerWidth < 640) setOpen(false);
    else if (size === "expanded") resize("compact");
  }, [pathname, onAsk, dock, docked, size, resize]);

  const close = useCallback(() => {
    setOpen(false);
    launcher.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // A dialog or a menu above the drawer takes Escape first.
      if (document.querySelector('[role="dialog"]:not([data-assistant]), [role="menu"]')) return;
      // The dock is part of the page: Escape closes it only from inside it.
      if (docked && !(document.activeElement instanceof Element && document.activeElement.closest('[data-assistant="panel"]'))) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, docked, close]);

  // A click outside the floating drawer closes it. Not while docked, and not a click in a dialog, a menu or a popover
  // (one opened from an in-chat card), nor on an element the click itself removed.
  useEffect(() => {
    if (!open || docked) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Element) || !t.isConnected) return;
      if (t.closest(KEEPS_OPEN)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, docked]);

  if (onAsk || !chat.availability.checked) return null;
  const panelBottom = (spot.tab ? HOME : spot.lift) + LAUNCHER + 12;
  const folded = spot.tab && !open;
  return (
    <>
      {mounted && (
        <AssistantPanel chat={chat} open={open} onClose={close} size={size} onResize={resize} bottom={panelBottom} docked={docked} canDock={wide} onDock={toggleDock} />
      )}
      {/* The open dock has its own Close; the launcher would sit on its composer. */}
      {!shifted && <button
        ref={launcher}
        type="button"
        data-assistant="launcher"
        data-spot={spot.tab ? "tab" : String(spot.lift)}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Close the assistant" : "Open the assistant"}
        title={open ? "Close the assistant" : "Ask the assistant"}
        style={folded ? { right: spot.edge, bottom: HOME, width: TAB_WIDTH, height: LAUNCHER } : { right: HOME, bottom: spot.lift, width: LAUNCHER, height: LAUNCHER }}
        className={`focusable fixed z-50 grid place-items-center bg-ink text-on-ink elev-3 transition-[bottom,right,width,border-radius,filter,transform] duration-150 ease-out hover:brightness-110 ${
          folded ? "rounded-l-md" : "rounded-full hover:-translate-y-0.5"
        }`}
      >
        {folded ? (
          <span className="h-5 w-[3px] rounded-full bg-on-ink/80" aria-hidden />
        ) : open ? (
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <SparkIcon size={21} />
        )}
        {/* An answer is coming while the drawer is closed. */}
        {chat.busy && !open && !folded && (
          <span className="af-pulse absolute top-0.5 right-0.5 size-3 rounded-full ring-2 ring-[var(--t-canvas)]" style={{ background: ASK.accent }} aria-hidden />
        )}
      </button>}
    </>
  );
}

function AssistantPanel({
  chat,
  open,
  onClose,
  size,
  onResize,
  bottom,
  docked,
  canDock,
  onDock,
}: {
  chat: AssistantChat;
  open: boolean;
  onClose: () => void;
  size: "compact" | "expanded";
  onResize: (s: "compact" | "expanded") => void;
  bottom: number;
  /** Docked on the right of the page as a full-height sidebar. */
  docked: boolean;
  /** The window is wide enough to dock. */
  canDock: boolean;
  /** Dock the drawer, or float the dock again. */
  onDock: () => void;
}) {
  const pathname = usePathname() || "/";
  const page = pageFor(pathname);
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const { session: me } = useSession();
  const expanded = size === "expanded" && !docked;
  const { turns, busy, cannot } = chat;

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 50);
  }, [open]);

  const send = (text: string) => {
    if (busy || cannot || !text.trim()) return;
    chat.ask(text);
    setDraft("");
  };

  const first = me?.name?.split(/\s+/)[0];

  return (
    <section
      aria-label="Assistant"
      data-assistant="panel"
      data-size={docked ? "docked" : size}
      inert={!open}
      style={docked ? { width: DOCK_WIDTH, background: ASK.surface2 } : { bottom, background: ASK.surface2 }}
      className={
        docked
          ? `fixed inset-y-0 right-0 z-40 flex flex-col overflow-hidden border-l border-line-strong elev-2 transition-[opacity,transform] duration-200 ease-out ${
              open ? "visible translate-x-0 opacity-100" : "pointer-events-none invisible translate-x-6 opacity-0"
            }`
          : `fixed right-6 z-40 flex origin-bottom-right flex-col overflow-hidden rounded-2xl border border-line-strong elev-3 transition-[opacity,transform,width,height] duration-200 ease-out max-sm:right-3 max-sm:h-[calc(100dvh-92px)] max-sm:w-[calc(100vw-1.5rem)] ${
              expanded ? "h-[calc(100dvh-104px)] w-[min(860px,calc(100vw-3rem))]" : "h-[min(700px,calc(100dvh-112px))] w-[440px]"
            } ${open ? "visible translate-y-0 scale-100 opacity-100" : "pointer-events-none invisible translate-y-2 scale-[0.96] opacity-0"}`
      }
    >
      <header className="relative flex h-14 shrink-0 items-center gap-2 border-b pr-2.5 pl-3.5" style={{ background: ASK.surface, borderColor: ASK.line }}>
        <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${ASK.accent} 0%, ${ASK.accent} 35%, ${ASK.cat(1)} 70%, ${ASK.cat(3)} 100%)` }} aria-hidden />
        <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: ASK.accent, color: ASK.onAccent }}>
          <SparkIcon size={15} />
        </span>
        <span className="flex min-w-0 grow flex-col leading-tight">
          <span className="text-[13.5px] font-semibold tracking-[-0.01em]">Assistant</span>
          <span className="truncate text-[11px] text-faint max-[400px]:hidden">on {page.info.title}</span>
        </span>
        <IconButton size="sm" label="New conversation" disabled={!turns.length} onClick={chat.reset}>
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
          </svg>
        </IconButton>
        {!docked && (
          <IconButton size="sm" label={expanded ? "Make the panel smaller" : "Make the panel larger"} className="max-sm:hidden" onClick={() => onResize(expanded ? "compact" : "expanded")}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              {expanded ? <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" /> : <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />}
            </svg>
          </IconButton>
        )}
        {canDock && (
          <Button size="sm" variant="solid" tone="neutral" onClick={onDock} title={docked ? "Float the assistant over the page again" : "Dock the assistant on the right of the page"}>
            {docked ? "Undock" : "Embed"}
          </Button>
        )}
        {/* Button's link form takes no title, so the link is drawn here with the solid ink look. */}
        <Link
          href="/ask"
          title="Open full page"
          aria-label="Go to the full page"
          className="focusable inline-flex h-7 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-sm border border-transparent bg-ink px-2.5 text-[12px] font-medium whitespace-nowrap text-on-ink transition-[filter] duration-100 select-none hover:brightness-[1.08] active:brightness-95"
        >
          Go to
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M7 17L17 7M9 7h8v8" />
          </svg>
        </Link>
        <Button size="sm" variant="solid" tone="err" onClick={onClose}>
          Close
        </Button>
      </header>

      <div className="min-h-0 grow overflow-x-hidden overflow-y-auto overscroll-contain px-4 py-4">
        <div className={`flex flex-col gap-4 ${expanded ? "mx-auto max-w-[780px]" : ""}`}>
          {cannot && (
            <p role="alert" className="rounded-xl px-3.5 py-2.5 text-[12px] leading-[1.55]" style={{ background: ASK.errBg, color: ASK.err, boxShadow: `inset 0 0 0 1px ${tint(ASK.err, 35)}` }}>
              {cannot}
            </p>
          )}
          {turns.length === 0 && !cannot && (
            <div className="af-fade-up flex flex-col gap-4 pt-2">
              <div className="flex flex-col gap-1">
                <h2 className="text-[17px] font-semibold tracking-[-0.015em]">{first ? `Hi ${first}, what would you like to know?` : "What would you like to know?"}</h2>
                <p className="text-[12.5px] leading-[1.55] text-dim">Ask about Saros or this deployment. Answers come from its records, read with your permissions.</p>
              </div>
              <Suggestions items={page.info.suggested} onSend={send} />
            </div>
          )}
          <AssistantThread chat={chat} size={expanded ? "large" : "compact"} />
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
        className="shrink-0 border-t p-3"
        style={{ background: ASK.surface, borderColor: ASK.line }}
      >
        <div className={`flex items-end gap-2 rounded-xl border bg-field p-1.5 pl-3 transition-[border-color,box-shadow] focus-within:border-line-strong ${expanded ? "mx-auto max-w-[780px]" : ""}`} style={{ borderColor: ASK.line }}>
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
            rows={2}
            disabled={Boolean(cannot)}
            aria-label="Question to the assistant"
            placeholder={cannot ? "The assistant cannot answer: see above" : `Ask about ${page.info.title.toLowerCase()}…`}
            className="min-h-[40px] grow resize-none bg-transparent py-1.5 text-[13px] leading-[1.5] text-fg outline-none placeholder:text-ghost disabled:cursor-not-allowed"
          />
          <SendButton busy={busy} disabled={Boolean(cannot) || !draft.trim()} />
        </div>
      </form>
    </section>
  );
}

/** The page's suggested questions, as chips each tinted with one of the categorical colours. */
function Suggestions({ items, onSend }: { items: string[]; onSend: (t: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5" data-suggestions>
      {items.map((s, k) => {
        const c = ASK.cat(k + 1);
        return (
          <button
            key={s}
            type="button"
            onClick={() => onSend(s)}
            className="focusable group flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[12.5px] leading-[1.4] font-medium text-fg transition-[filter,transform] duration-100 hover:brightness-[0.97] active:scale-[0.99] dark:hover:brightness-110"
            style={{ background: tint(c, 11), boxShadow: `inset 0 0 0 1px ${tint(c, 30)}` }}
          >
            <span className="size-2 shrink-0 rounded-full" style={{ background: c }} aria-hidden />
            <span className="min-w-0 grow break-words">{s}</span>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke={c} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 transition-transform duration-100 group-hover:translate-x-0.5" aria-hidden>
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        );
      })}
    </div>
  );
}

function SendButton({ busy, disabled }: { busy: boolean; disabled: boolean }) {
  return (
    <button
      type="submit"
      aria-label="Send"
      title="Send (Enter)"
      disabled={busy || disabled}
      aria-busy={busy || undefined}
      className="focusable grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg bg-ink text-on-ink transition-[filter,opacity] duration-100 hover:brightness-[1.08] active:brightness-95 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {busy ? (
        <span className="af-spin inline-block size-4 rounded-full border-2 border-on-ink/30 border-t-on-ink" aria-hidden />
      ) : (
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      )}
    </button>
  );
}
