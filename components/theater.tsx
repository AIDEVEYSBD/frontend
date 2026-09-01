"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CITATIONS,
  DOCUMENTS,
  EVENTS,
  NODES,
  RUN_END,
  at,
  clock,
  type EventKind,
  type TraceEvent,
} from "@/lib/trace";
import { Kbd, Mono, Status, Tag } from "./ui";
import { Thinking } from "./loaders";

/* ═══════════════════ Event vocabulary ═══════════════════ */

const KIND: Record<EventKind, { dot: string; text: string; label: string }> = {
  start: { dot: "bg-faint", text: "text-dim", label: "start" },
  tool: { dot: "bg-c2", text: "text-c2", label: "tool" },
  reason: { dot: "bg-run", text: "text-run", label: "reasoning" },
  evidence: { dot: "bg-c3", text: "text-c3", label: "evidence" },
  write: { dot: "bg-c1", text: "text-c1", label: "writing" },
  decision: { dot: "bg-ok", text: "text-ok", label: "decision" },
  escalate: { dot: "bg-warn", text: "text-warn", label: "escalation" },
  done: { dot: "bg-faint", text: "text-dim", label: "step done" },
};

/* ═══════════════════ Playback ═══════════════════ */

/**
 * `?t=` opens the run at a timestamp, paused — so a reviewer can be sent
 * straight to the moment a decision was made rather than a whole replay.
 */
function initial() {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("t");
  if (raw === null) return null;
  const v = Number(raw);
  return Number.isFinite(v) ? Math.max(0, Math.min(RUN_END, v)) : null;
}

function usePlayback() {
  const deep = typeof window === "undefined" ? null : initial();
  const [t, setT] = useState(deep ?? 0);
  const [playing, setPlaying] = useState(deep === null);
  const [speed, setSpeed] = useState(4);
  const raf = useRef(0);
  const last = useRef(0);

  useEffect(() => {
    if (!playing) return;
    last.current = performance.now();

    const tick = (now: number) => {
      const dt = (now - last.current) / 1000;
      last.current = now;
      setT((prev) => {
        const next = prev + dt * speed;
        if (next >= RUN_END) {
          setPlaying(false);
          return RUN_END;
        }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };

    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing, speed]);

  const seek = useCallback((v: number) => {
    setT(Math.max(0, Math.min(RUN_END, v)));
  }, []);

  const step = useCallback((dir: 1 | -1) => {
    setPlaying(false);
    setT((prev) => {
      const marks = EVENTS.map((e) => e.t);
      const next =
        dir > 0
          ? marks.find((m) => m > prev + 0.01)
          : [...marks].reverse().find((m) => m < prev - 0.01);
      return next ?? (dir > 0 ? RUN_END : 0);
    });
  }, []);

  return { t, setT: seek, playing, setPlaying, speed, setSpeed, step };
}

/* ═══════════════════ Theater ═══════════════════ */

export function RunTheater({ keyboard = true }: { keyboard?: boolean } = {}) {
  const { t, setT, playing, setPlaying, speed, setSpeed, step } = usePlayback();
  // `?cite=c3` opens straight onto one source, for sending a reviewer to
  // the exact clause a decision rests on.
  const [openCite, setOpenCite] = useState<string | null>(
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("cite"),
  );
  const state = at(t);

  useEffect(() => {
    // An embedded theater must not steal space/arrows from page scrolling.
    if (!keyboard) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
      if (e.code === "ArrowRight") {
        e.preventDefault();
        step(1);
      }
      if (e.code === "ArrowLeft") {
        e.preventDefault();
        step(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keyboard, setPlaying, step]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Header t={t} state={state} />

      <div className="grid min-h-0 grow grid-cols-1 md:grid-cols-[minmax(150px,190px)_minmax(0,1fr)] xl:grid-cols-[minmax(160px,200px)_minmax(0,1fr)_minmax(280px,340px)]">
        <Graph t={t} state={state} />
        <Transcript state={state} />
        <Artifact state={state} openCite={openCite} setOpenCite={setOpenCite} />
      </div>

      <Timeline
        t={t}
        setT={setT}
        playing={playing}
        setPlaying={setPlaying}
        speed={speed}
        setSpeed={setSpeed}
        step={step}
      />
    </div>
  );
}

/* ═══════════════════ Header ═══════════════════ */

function Header({ t, state }: { t: number; state: ReturnType<typeof at> }) {
  // Status follows the trace, not the clock: the run is awaiting a human
  // from the moment it escalates, not when the timeline happens to end.
  const escalated = state.events.some((e) => e.kind === "escalate");
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-surface px-4 py-2.5">
      <div className="flex items-center gap-2 text-[12px]">
        <span className="text-faint">Aviva Claims</span>
        <span className="text-ghost">/</span>
        <Mono className="text-[11.5px] text-faint">run 4128</Mono>
      </div>
      <span className="text-[13px] font-semibold tracking-[-0.01em]">
        CL-88213 · R. Alvarez
      </span>
      {escalated ? (
        <Status tone="warn">Awaiting approval</Status>
      ) : t === 0 ? (
        <Status tone="queue">Queued</Status>
      ) : (
        <Status tone="run">Running</Status>
      )}

      <div className="grow" />

      <div className="flex items-center gap-3 font-mono text-[11.5px] text-dim">
        <span className="tnum">{clock(t)}</span>
        <span className="text-ghost">·</span>
        <span className="tnum">${state.cost.toFixed(2)}</span>
        <span className="text-ghost">·</span>
        <span className="tnum">
          {state.confidence ? `conf ${state.confidence.toFixed(2)}` : "conf —"}
        </span>
      </div>
    </header>
  );
}

/* ═══════════════════ Graph rail ═══════════════════ */

function Graph({ t, state }: { t: number; state: ReturnType<typeof at> }) {
  return (
    <aside className="flex min-h-0 min-w-0 flex-col gap-1 overflow-y-auto border-b border-line bg-raise/60 p-3 md:border-r md:border-b-0">
      <span className="px-1 pb-1.5 text-[11px] text-faint">Workflow</span>

      {NODES.map((n, i) => {
        const s = state.nodeState(n);
        const progress =
          s === "active" ? Math.min(1, (t - n.from) / (n.to - n.from)) : s === "done" ? 1 : 0;
        const last = i === NODES.length - 1;

        return (
          <div key={n.id} className="flex gap-2.5">
            {/* Spine: the run's path, filling as it advances. */}
            <div className="flex w-3 shrink-0 flex-col items-center pt-1.5">
              <span
                className={`size-2.5 shrink-0 rounded-[2px] border-2 transition-colors duration-200 ${
                  s === "done"
                    ? "border-ok bg-ok"
                    : s === "active"
                      ? "border-run bg-surface"
                      : "border-line-strong bg-surface"
                }`}
              />
              {!last && (
                <span className="relative my-1 w-px grow bg-line">
                  <span
                    className="absolute inset-x-0 top-0 bg-ok transition-[height] duration-200"
                    style={{ height: `${s === "done" ? 100 : 0}%` }}
                  />
                </span>
              )}
            </div>

            <div className={`flex min-w-0 grow flex-col gap-1 ${last ? "pb-1" : "pb-4"}`}>
              <span
                className={`truncate text-[12.5px] transition-colors ${
                  s === "active"
                    ? "font-semibold text-fg"
                    : s === "done"
                      ? "text-mist"
                      : "text-faint"
                }`}
              >
                {n.label}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-[10.5px] text-ghost">{n.kind}</span>
                {s === "active" && <Thinking height={8} />}
              </div>
              {s === "active" && (
                <span className="mt-0.5 block h-0.5 overflow-hidden rounded-[2px] bg-sunken">
                  <span
                    className="block h-full rounded-[2px] bg-run"
                    style={{ width: `${progress * 100}%` }}
                  />
                </span>
              )}
            </div>
          </div>
        );
      })}
    </aside>
  );
}

/* ═══════════════════ Transcript ═══════════════════ */

function Transcript({ state }: { state: ReturnType<typeof at> }) {
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const count = state.events.length;

  /**
   * Follow the run only while the reader is already at the bottom. Once
   * they scroll up to re-read something, new events stop yanking the
   * view away from them.
   */
  useEffect(() => {
    const el = scroller.current;
    if (!el || !pinned.current) return;
    el.scrollTop = el.scrollHeight;
  }, [count]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  return (
    <section className="flex min-h-0 min-w-0 flex-col border-b border-line xl:border-r xl:border-b-0">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-raise/60 px-4">
        <span className="text-[12px] font-semibold">{state.node.label}</span>
        <Tag>{state.node.kind}</Tag>
        <div className="grow" />
        <Mono className="text-[11px] text-faint">{count} events</Mono>
      </div>

      <div
        ref={scroller}
        onScroll={onScroll}
        className="flex min-h-0 grow flex-col gap-3.5 overflow-y-auto px-4 py-4"
      >
        {state.events.map((e) => (
          <EventRow key={`${e.t}-${e.title}`} e={e} />
        ))}
      </div>
    </section>
  );
}

function EventRow({ e }: { e: TraceEvent }) {
  const k = KIND[e.kind];

  if (e.kind === "reason") {
    return (
      <div className="flex gap-3">
        <Mono className="w-9 shrink-0 pt-0.5 text-[10.5px] text-ghost">{clock(e.t)}</Mono>
        <div className="flex min-w-0 flex-col gap-1">
          <span className={`text-[10.5px] font-medium ${k.text}`}>{k.label}</span>
          <p className="max-w-[62ch] text-[13px] leading-[1.6] text-mist">{e.title}</p>
        </div>
      </div>
    );
  }

  if (e.kind === "tool") {
    return (
      <div className="flex gap-3">
        <Mono className="w-9 shrink-0 pt-2 text-[10.5px] text-ghost">{clock(e.t)}</Mono>
        <div className="min-w-0 grow rounded-md border border-line bg-raise px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <Mono className="truncate text-[11.5px] text-mist">{e.title}</Mono>
            {e.meta && <Mono className="shrink-0 text-[10.5px] text-ok">{e.meta}</Mono>}
          </div>
          {e.detail && (
            <div className="mt-1 truncate text-[11.5px] text-faint">→ {e.detail}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3">
      <Mono className="w-9 shrink-0 text-[10.5px] text-ghost">{clock(e.t)}</Mono>
      <div className="flex min-w-0 items-baseline gap-2">
        <span className={`mt-1.5 size-1.5 shrink-0 rounded-[2px] ${k.dot}`} />
        <span className="text-[12.5px] text-fg">{e.title}</span>
        {e.detail && <span className="truncate text-[11.5px] text-faint">{e.detail}</span>}
        {e.meta && <Mono className="shrink-0 text-[10.5px] text-ghost">{e.meta}</Mono>}
      </div>
    </div>
  );
}

/* ═══════════════════ Artifact + provenance ═══════════════════ */

function Artifact({
  state,
  openCite,
  setOpenCite,
}: {
  state: ReturnType<typeof at>;
  openCite: string | null;
  setOpenCite: (v: string | null) => void;
}) {
  return (
    <aside className="flex min-h-0 min-w-0 flex-col md:col-span-2 xl:col-span-1">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-raise/60 px-4">
        <span className="truncate text-[12px] font-semibold">Coverage confirmation</span>
        <div className="grow" />
        <Mono className="shrink-0 text-[11px] text-faint">
          {state.segments.filter((s) => s.cite).length} cited
        </Mono>
      </div>

      <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto px-4 py-4">
        {state.segments.length === 0 && (
          <span className="text-[12px] text-ghost">
            Nothing written yet — the draft begins once coverage is decided.
          </span>
        )}

        {state.segments.map((s) => (
          <p key={s.t} className="text-[13px] leading-[1.65] text-mist">
            {s.text}
            {s.cite && (
              <CiteMarker
                id={s.cite}
                open={openCite === s.cite}
                onToggle={() => setOpenCite(openCite === s.cite ? null : s.cite!)}
                onClose={() => setOpenCite(null)}
              />
            )}
          </p>
        ))}

        {state.segments.length > 0 && (
          <span className="mt-1 text-[11.5px] text-faint">
            {state.citations.length} sources support this draft. Click any marker to read the
            clause it rests on.
          </span>
        )}
      </div>
    </aside>
  );
}

/**
 * A citation marker and its source popover.
 *
 * Click, not hover: the source has to stay put while it is being read.
 * A hover-triggered panel disappears the moment the reader moves toward
 * it, which is precisely when they need it.
 */
function CiteMarker({
  id,
  open,
  onToggle,
  onClose,
}: {
  id: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const cite = CITATIONS.find((c) => c.id === id);
  const doc = cite ? DOCUMENTS.find((d) => d.id === cite.doc) : null;

  /**
   * The panel this lives in scrolls and clips, so the popover is
   * portalled to the body and positioned against the viewport. It is
   * centred on the marker, clamped to the viewport on both axes, and
   * flipped above when there is no room below — a popover that opens
   * off-screen is worse than no popover.
   */
  const place = useCallback(() => {
    const a = anchor.current?.getBoundingClientRect();
    if (!a) return;
    const W = 300;
    const H = pop.current?.offsetHeight ?? 190;
    const PAD = 12;

    let left = a.left + a.width / 2 - W / 2;
    left = Math.max(PAD, Math.min(left, window.innerWidth - W - PAD));

    let top = a.bottom + 8;
    if (top + H > window.innerHeight - PAD) top = Math.max(PAD, a.top - H - 8);

    setPos({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    // Follow the anchor rather than dismissing: the reader asked for this
    // source and may well scroll while reading it.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!anchor.current?.contains(t) && !pop.current?.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!cite || !doc) return null;

  return (
    <>
      <button
        ref={anchor}
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`Source: ${cite.locator}`}
        className={`focusable ml-0.5 cursor-pointer rounded-[3px] px-1 py-px align-super font-mono text-[9px] transition-colors ${
          open ? "bg-run text-on-solid" : "bg-raise text-run hover:bg-run hover:text-on-solid"
        }`}
      >
        {id.replace("c", "")}
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={pop}
            role="dialog"
            style={{
              position: "fixed",
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              width: 300,
              visibility: pos ? "visible" : "hidden",
            }}
            className="af-pop z-[70] flex flex-col gap-2 rounded-lg border border-line bg-surface p-3 text-left elev-3"
          >
            <div className="flex items-center gap-1.5">
              <span className="size-1.5 shrink-0 rounded-[2px] bg-c3" />
              <Mono className="truncate text-[10.5px] text-c3">{cite.locator}</Mono>
            </div>

            <p className="border-l-2 border-line-strong pl-2.5 text-[12px] leading-[1.55] text-mist">
              {cite.quote}
            </p>

            <div className="flex items-center justify-between gap-2 border-t border-line pt-2">
              <span className="min-w-0 truncate text-[10.5px] text-faint">{doc.name}</span>
              <a
                href="#"
                className="focusable flex shrink-0 items-center gap-1 rounded-sm text-[11px] font-medium text-fg hover:underline"
              >
                Read at source
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M7 17L17 7M9 7h8v8" />
                </svg>
              </a>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/* ═══════════════════ Timeline ═══════════════════ */

function Timeline({
  t,
  setT,
  playing,
  setPlaying,
  speed,
  setSpeed,
  step,
}: {
  t: number;
  setT: (v: number) => void;
  playing: boolean;
  setPlaying: (f: (p: boolean) => boolean) => void;
  speed: number;
  setSpeed: (v: number) => void;
  step: (d: 1 | -1) => void;
}) {
  const pct = (t / RUN_END) * 100;

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-line bg-raise/60 px-4 py-3">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "Pause" : "Play"}
          className="focusable grid size-8 shrink-0 cursor-pointer place-items-center rounded-md bg-ink text-on-ink transition-opacity hover:opacity-90"
        >
          {playing ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M8 5.5v13l11-6.5z" />
            </svg>
          )}
        </button>

        <div className="flex items-center gap-1">
          <button
            onClick={() => step(-1)}
            aria-label="Previous event"
            className="focusable grid size-7 cursor-pointer place-items-center rounded-md text-faint transition-colors hover:bg-raise hover:text-fg"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M17 5.5v13L8 12z" />
              <rect x="5" y="5" width="2" height="14" rx="1" />
            </svg>
          </button>
          <button
            onClick={() => step(1)}
            aria-label="Next event"
            className="focusable grid size-7 cursor-pointer place-items-center rounded-md text-faint transition-colors hover:bg-raise hover:text-fg"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M7 5.5v13L16 12z" />
              <rect x="17" y="5" width="2" height="14" rx="1" />
            </svg>
          </button>
        </div>

        <Mono className="tnum shrink-0 text-[11.5px] text-dim">
          {clock(t)} <span className="text-ghost">/ {clock(RUN_END)}</span>
        </Mono>

        {/* Scrubber: node bands underneath, event ticks on top. */}
        <div className="relative flex h-8 grow items-center">
          <div className="absolute inset-x-0 top-1.5 flex h-2 overflow-hidden rounded-[2px]">
            {NODES.map((n, i) => (
              <span
                key={n.id}
                title={n.label}
                className="h-full border-r border-surface last:border-0"
                style={{
                  width: `${((n.to - n.from) / RUN_END) * 100}%`,
                  background: `var(--t-c${(i % 10) + 1})`,
                  opacity: t >= n.from ? 0.65 : 0.16,
                }}
              />
            ))}
          </div>

          <div className="absolute inset-x-0 top-4 h-3">
            {EVENTS.map((e) => (
              <span
                key={`${e.t}-${e.title}`}
                title={e.title}
                className={`absolute top-0 h-2 w-px ${KIND[e.kind].dot} ${
                  t >= e.t ? "opacity-90" : "opacity-25"
                }`}
                style={{ left: `${(e.t / RUN_END) * 100}%` }}
              />
            ))}
          </div>

          {/* Playhead */}
          <span
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-fg"
            style={{ left: `${pct}%` }}
          >
            <span className="absolute -top-0.5 left-1/2 size-2 -translate-x-1/2 rotate-45 bg-fg" />
          </span>

          <input
            type="range"
            min={0}
            max={RUN_END}
            step={0.5}
            value={t}
            onChange={(e) => setT(Number(e.target.value))}
            aria-label="Scrub run"
            className="focusable absolute inset-x-0 top-0 h-8 w-full cursor-pointer appearance-none bg-transparent"
          />
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {[1, 4, 16].map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`focusable cursor-pointer rounded-sm px-1.5 py-0.5 font-mono text-[10.5px] transition-colors ${
                speed === s ? "bg-raise font-medium text-fg" : "text-faint hover:text-dim"
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="flex items-center gap-1.5 text-[10.5px] text-faint">
          <Kbd>space</Kbd> play
        </span>
        <span className="flex items-center gap-1.5 text-[10.5px] text-faint">
          <Kbd>←</Kbd>
          <Kbd>→</Kbd> step event
        </span>
        <div className="grow" />
        {(["tool", "reason", "evidence", "decision", "escalate"] as EventKind[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5 text-[10.5px] text-faint">
            <span className={`size-1.5 rounded-[2px] ${KIND[k].dot}`} />
            {KIND[k].label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════ Compact embed for the spec page ═══════════════════ */

export function TheaterFrame() {
  return (
    <div className="h-[640px] overflow-hidden rounded-lg border border-line bg-surface elev-1">
      <RunTheater keyboard={false} />
    </div>
  );
}


