"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Layout effect in the browser, no-op during SSR. */
const useBrowserLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/**
 * Reveals content once as it enters the viewport. Deliberately small —
 * 10px and 260ms. The purpose is to give scrolling a sense of the page
 * assembling, not to make the reader wait for content they can see.
 * Never replays: re-animating on scroll-back is a gimmick.
 */
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  /**
   * Starts visible. The hidden state is applied in a layout effect —
   * before paint, so there is no flash — and only once we know scripting
   * and IntersectionObserver are both available. If either is missing,
   * or motion is reduced, the content simply stays visible rather than
   * being stranded at opacity 0.
   */
  const [armed, setArmed] = useState(false);
  const [shown, setShown] = useState(true);

  useBrowserLayoutEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion() || typeof IntersectionObserver === "undefined") return;

    setArmed(true);
    setShown(false);

    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          return;
        }
        /**
         * Reverses on the way back up: an element that has left below the
         * viewport resets so it plays again on re-entry. Elements that
         * leave upward are left alone — fading content as it scrolls off
         * the top reads as a glitch, not an effect.
         */
        if (entry.boundingClientRect.top > 0) setShown(false);
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={
        armed
          ? {
              opacity: shown ? 1 : 0,
              transform: shown ? "none" : "translateY(10px)",
              transition: `opacity 260ms var(--ease-out) ${delay}ms, transform 260ms var(--ease-out) ${delay}ms`,
              willChange: shown ? "auto" : "opacity, transform",
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

/**
 * Bounded demonstration of the reveal, with its own scroll container.
 *
 * The reveal is a deliberate, local device — a newly streaming list, a
 * panel of results arriving — not a page-wide treatment. Applying it to
 * every section makes a reader wait on content that is already there,
 * which is why it lives in a card here rather than on the document.
 */
export function RevealShowcase({
  items,
}: {
  items: { title: string; meta: string }[];
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState<Set<number>>(new Set());
  const [armed, setArmed] = useState(false);

  useBrowserLayoutEffect(() => {
    const root = scroller.current;
    if (!root || reducedMotion() || typeof IntersectionObserver === "undefined") return;

    setArmed(true);
    const io = new IntersectionObserver(
      (entries) => {
        setVisible((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const i = Number((e.target as HTMLElement).dataset.i);
            if (e.isIntersecting) next.add(i);
            // Reverse: reset only what left below, so scrolling back replays it.
            else if (e.boundingClientRect.top > 0) next.delete(i);
          }
          return next;
        });
      },
      { root, rootMargin: "0px 0px -18% 0px", threshold: 0.15 },
    );

    root.querySelectorAll("[data-i]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface elev-1">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <span className="text-[12.5px] font-medium">Scroll inside this card</span>
        <span className="text-[11px] text-faint">reveals, and reverses on the way back</span>
      </div>

      <div ref={scroller} className="h-[300px] overflow-y-auto">
        <div className="flex flex-col divide-y divide-line">
          {items.map((it, i) => {
            const shown = !armed || visible.has(i);
            return (
              <div
                key={it.title}
                data-i={i}
                className="flex items-center gap-3 px-4 py-4"
                style={{
                  opacity: shown ? 1 : 0,
                  transform: shown ? "none" : "translateY(10px)",
                  transition:
                    "opacity 260ms var(--ease-out), transform 260ms var(--ease-out)",
                }}
              >
                <span className="tnum w-6 shrink-0 font-mono text-[11px] text-ghost">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="flex min-w-0 grow flex-col">
                  <span className="truncate text-[13px] font-medium">{it.title}</span>
                  <span className="truncate text-[11.5px] text-faint">{it.meta}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Scroll container with a hairline progress rail. The rail is the one
 * piece of persistent chrome that responds to scroll — on a long
 * specification it answers "how much is left" without a scrollbar.
 */
export function ScrollArea({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const max = el.scrollHeight - el.clientHeight;
        setProgress(max > 0 ? Math.min(1, el.scrollTop / max) : 0);
      });
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="relative h-full min-h-0">
      <div className="absolute inset-x-0 top-0 z-10 h-px bg-line">
        <div
          className="h-full origin-left bg-fg"
          style={{ transform: `scaleX(${progress})`, transition: "transform 90ms linear" }}
        />
      </div>
      <div ref={ref} className={`h-full overflow-y-auto ${className}`}>
        {children}
      </div>
    </div>
  );
}
