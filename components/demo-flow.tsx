"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Button, Mono, Status, Tag } from "./ui";
import { CAT } from "./charts";
import { BrandMark } from "./brand";

/* ═══════════════════ Model ═══════════════════ */

type Phase = "build" | "run" | "results";
type Mode = "agentic" | "visual";

interface DemoNode {
  id: string;
  label: string;
  kind: string;
  c: number;
  tools: { name: string; c: number }[];
  /** Percentage of the canvas, so the graph scales with its container. */
  x: number;
  y: number;
}

const START: DemoNode[] = [
  { id: "intake", label: "Intake", kind: "extraction", c: 1, x: 8, y: 18, tools: [{ name: "Microsoft Purview", c: 2 }, { name: "Outlook", c: 3 }] },
  { id: "enrich", label: "Enrich", kind: "extraction", c: 1, x: 31, y: 18, tools: [{ name: "Entra ID", c: 2 }, { name: "CyberArk", c: 2 }] },
  { id: "history", label: "History", kind: "research", c: 2, x: 31, y: 63, tools: [{ name: "Splunk", c: 5 }] },
  { id: "adjudicate", label: "Adjudicate", kind: "decision", c: 5, x: 55, y: 18, tools: [{ name: "SharePoint", c: 1 }, { name: "Archer", c: 5 }] },
  { id: "draft", label: "Disposition", kind: "drafting", c: 3, x: 78, y: 18, tools: [{ name: "ServiceNow", c: 2 }] },
  { id: "approve", label: "Approve", kind: "gate", c: 8, x: 78, y: 63, tools: [{ name: "Teams", c: 3 }] },
];

const EDGES: [string, string][] = [
  ["intake", "enrich"],
  ["enrich", "history"],
  ["enrich", "adjudicate"],
  ["history", "adjudicate"],
  ["adjudicate", "draft"],
  ["draft", "approve"],
];

const PROMPT =
  "Review our DLP triage SOP. Route any case involving regulated data to the DLP lead for approval.";

const LOGS = [
  { t: "00:06", kind: "tool", text: 'purview.alerts.fetch(alert="DLP-4417")', meta: "1 alert · 0.6s" },
  { t: "00:20", kind: "tool", text: 'entra.user.lookup(upn="a.rao")', meta: "200 · 0.4s" },
  { t: "00:38", kind: "reason", text: "Four files tagged CONFIDENTIAL sent to an external address. The sender sits in Vendor Management, checking whether the recipient is a contracted processor." },
  { t: "00:52", kind: "ev", text: "Recipient domain resolved", meta: "northwind-payroll.com · DSA-112" },
  { t: "01:26", kind: "tool", text: 'splunk.search(actor="a.rao", window="30d")', meta: "14 events · 0.9s" },
  { t: "02:28", kind: "reason", text: "The transfer matches the monthly payroll pattern under data-sharing agreement DSA-112, checking the agreement is current and the files are in its scope." },
  { t: "03:26", kind: "ev", text: "Agreement current, files in scope", meta: "DSA-112 §2 · renewed May 2026" },
  { t: "03:52", kind: "dec", text: "Sanctioned transfer, benign", meta: "confidence 0.93" },
  { t: "05:18", kind: "tool", text: "draft.write(template=disposition-memo)", meta: "4 citations" },
];

const LOG_TONE: Record<string, string> = {
  tool: "bg-c2",
  reason: "bg-run",
  ev: "bg-c3",
  dec: "bg-ok",
};

/**
 * Reduced motion must never change what the FIRST render produces ,
 * the server cannot know it, so any render-time branch on it is a
 * hydration mismatch (React then discards the subtree and its event
 * handlers). It is read here only to decide what the effect does after
 * hydration: skip straight to the finished state, or animate to it.
 */
const MQ = "(prefers-reduced-motion: reduce)";

function subscribeMotion(cb: () => void) {
  if (typeof window === "undefined") return () => {};
  const m = window.matchMedia(MQ);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}

function useReducedMotion() {
  return useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia(MQ).matches,
    () => false,
  );
}

/** Starts a demo when it reaches the viewport, not when it mounts. */
function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return { ref, seen };
}

/* ═══════════════════ Shell ═══════════════════ */

const STEPS: { key: Phase; label: string }[] = [
  { key: "build", label: "Design workflow" },
  { key: "run", label: "Monitor execution" },
  { key: "results", label: "Review output" },
];

export function DemoFlow() {
  const [phase, setPhase] = useState<Phase>("build");
  const [mode, setMode] = useState<Mode>("agentic");

  const reset = useCallback(() => {
    setPhase("build");
    setMode("agentic");
  }, []);

  return (
    <div className="flex flex-col gap-5">
      {/* Progress: the three phases, always visible so the demo has a shape. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {STEPS.map((s, i) => {
          const idx = STEPS.findIndex((x) => x.key === phase);
          const state = i < idx ? "done" : i === idx ? "active" : "todo";
          return (
            <div key={s.key} className="flex items-center gap-2">
              <button
                onClick={() => i <= idx && setPhase(s.key)}
                disabled={i > idx}
                className={`focusable flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12.5px] transition-colors disabled:cursor-not-allowed ${
                  state === "active"
                    ? "border-transparent bg-ink font-semibold text-on-ink"
                    : state === "done"
                      ? "border-line text-dim hover:bg-raise"
                      : "border-dashed border-line text-ghost"
                }`}
              >
                <span
                  className={`grid size-4 place-items-center rounded-xs font-mono text-[9.5px] ${
                    state === "active" ? "bg-on-ink/20" : "bg-raise"
                  }`}
                >
                  {i + 1}
                </span>
                {s.label}
              </button>
              {i < STEPS.length - 1 && <span className="h-px w-4 bg-line-strong" />}
            </div>
          );
        })}

        <div className="grow" />
        {phase !== "build" && (
          <Button size="sm" variant="quiet" onClick={reset}>
            Restart demonstration
          </Button>
        )}
      </div>

      <div key={phase} className="af-swap">
        {phase === "build" && (
          <BuildPhase mode={mode} setMode={setMode} onRun={() => setPhase("run")} />
        )}
        {phase === "run" && <RunPhase onDone={() => setPhase("results")} />}
        {phase === "results" && <ResultsPhase />}
      </div>
    </div>
  );
}

/* ═══════════════════ Phase 1, build ═══════════════════ */

function BuildPhase({
  mode,
  setMode,
  onRun,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  onRun: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1 self-start rounded-md border border-line bg-raise p-px">
        {(
          [
            ["agentic", "Agentic builder"],
            ["visual", "Visual builder"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setMode(k)}
            aria-pressed={mode === k}
            className={`focusable cursor-pointer rounded-sm px-3 py-1.5 text-[12.5px] transition-colors ${
              mode === k
                ? "bg-surface font-semibold text-fg shadow-[var(--shadow-1)]"
                : "font-medium text-faint hover:text-dim"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div key={mode} className="af-swap">
        {mode === "agentic" ? <AgenticBuilder onSend={onRun} /> : <VisualBuilder onRun={onRun} />}
      </div>
    </div>
  );
}

/* ── Agentic: types the prompt, then waits for a real click ── */

function AgenticBuilder({ onSend }: { onSend: () => void }) {
  const reduce = useReducedMotion();
  const { ref, seen } = useInView<HTMLDivElement>();
  const [typed, setTyped] = useState(0);
  const done = typed >= PROMPT.length;

  useEffect(() => {
    if (reduce) {
      // Post-hydration, in a frame callback, not a render-time branch.
      const f = requestAnimationFrame(() => setTyped(PROMPT.length));
      return () => cancelAnimationFrame(f);
    }
    // Wait until the demo is on screen, so the visitor actually sees it type.
    if (!seen) return;
    const id = setInterval(() => {
      setTyped((n) => {
        if (n >= PROMPT.length) {
          clearInterval(id);
          return n;
        }
        return n + 2;
      });
    }, 24);
    return () => clearInterval(id);
  }, [reduce, seen]);

  return (
    <div ref={ref} className="overflow-hidden rounded-lg border border-line bg-surface elev-2">
      <div className="flex items-center gap-2 border-b border-line bg-raise/60 px-3 py-2">
        <span className="text-[12px] font-medium">Describe the process</span>
        <div className="grow" />
        <Mono className="text-[10.5px] text-faint">{done ? "ready to send" : "typing…"}</Mono>
      </div>

      <div className="flex min-h-[430px] flex-col gap-3 p-4">
        <div className="flex items-start gap-2.5">
          <span className="grid size-6 shrink-0 place-items-center rounded-sm border border-line bg-raise text-[9.5px] font-medium text-dim">
            SR
          </span>
          <div className="min-h-[92px] grow rounded-md border border-line-strong bg-field px-3 py-2.5 text-[15px] leading-[1.6] text-fg">
            {PROMPT.slice(0, typed)}
            {!done && (
              <span className="af-caret ml-px inline-block h-[14px] w-[6px] translate-y-[2px] bg-run" />
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-line pt-3">
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 rounded-sm border border-line bg-raise px-2 py-1 text-[11px] text-dim">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2h9l5 5v15H6z" />
              </svg>
              DLP-Triage-SOP.pdf
            </span>
            <span className="text-[11.5px] text-faint">attached</span>
          </div>

          <div className="grow" />

          {/* The demo stops here on purpose: the next phase needs a real click. */}
          <span className="relative">
            {done && (
              <span className="af-halo pointer-events-none absolute -inset-1.5 rounded-lg border border-run" />
            )}
            <Button
              tone="ink"
              variant="solid"
              disabled={!done}
              onClick={onSend}
              className="relative"
            >
              Send
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h13M12 5l7 7-7 7" />
              </svg>
            </Button>
          </span>
        </div>

        {done && (
          <div className="af-swap flex flex-col gap-2.5 rounded-md border border-line bg-raise/40 p-3">
            <span className="text-[11.5px] font-medium text-dim">
              Source materials reviewed before a workflow is proposed
            </span>
            <div className="flex flex-col divide-y divide-line">
              {[
                ["DLP-Triage-SOP.pdf", "22 pages · process requirements"],
                ["Data-sharing agreements.xlsx", "approved transfer conditions"],
                ["Escalation matrix.xlsx", "approval roles and thresholds"],
              ].map(([n, d]) => (
                <div key={n} className="flex items-baseline gap-2 py-1.5">
                  <span className="truncate text-[12px] text-mist">{n}</span>
                  <span className="grow truncate text-[11px] text-faint">{d}</span>
                </div>
              ))}
            </div>
            <span className="text-[11.5px] text-faint">
              Submit to generate a proposed graph and evaluation cases, followed by an initial run.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Visual: a real draggable canvas ── */

function VisualBuilder({ onRun }: { onRun: () => void }) {
  const [nodes, setNodes] = useState<DemoNode[]>(START);
  const [drag, setDrag] = useState<string | null>(null);
  const [moved, setMoved] = useState(false);
  const board = useRef<HTMLDivElement>(null);
  const offset = useRef({ x: 0, y: 0 });

  const at = (id: string) => nodes.find((n) => n.id === id)!;

  const onDown = (e: React.PointerEvent, id: string) => {
    const rect = board.current?.getBoundingClientRect();
    if (!rect) return;
    const n = at(id);
    offset.current = {
      x: ((e.clientX - rect.left) / rect.width) * 100 - n.x,
      y: ((e.clientY - rect.top) / rect.height) * 100 - n.y,
    };
    setDrag(id);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const rect = board.current?.getBoundingClientRect();
    if (!rect) return;
    const x = ((e.clientX - rect.left) / rect.width) * 100 - offset.current.x;
    const y = ((e.clientY - rect.top) / rect.height) * 100 - offset.current.y;
    setMoved(true);
    setNodes((prev) =>
      prev.map((n) =>
        n.id === drag
          ? { ...n, x: Math.max(3, Math.min(88, x)), y: Math.max(6, Math.min(80, y)) }
          : n,
      ),
    );
  };

  const stop = () => setDrag(null);

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface elev-2">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/60 px-3 py-2">
        <span className="text-[12px] font-medium">DLP Triage</span>
        <Tag>6 harnesses</Tag>
        <div className="grow" />
        <span className="text-[11px] text-faint">
          {moved ? "Layout updated for this demonstration" : "Drag a node to adjust the layout"}
        </span>
        <Button size="sm" tone="ink" variant="solid" onClick={onRun}>
          Start workflow
        </Button>
      </div>

      <div
        ref={board}
        onPointerMove={onMove}
        onPointerUp={stop}
        onPointerLeave={stop}
        className={`relative h-[386px] w-full bg-[radial-gradient(circle_at_1px_1px,var(--t-line-strong)_1px,transparent_0)] [background-size:16px_16px] ${
          drag ? "cursor-grabbing select-none" : ""
        }`}
      >
        <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
          {EDGES.map(([a, b]) => {
            const A = at(a);
            const B = at(b);
            const x1 = A.x + 9;
            const y1 = A.y + 8;
            const x2 = B.x;
            const y2 = B.y + 8;
            const m = x1 + (x2 - x1) / 2;
            return (
              <path
                key={`${a}-${b}`}
                d={`M ${x1} ${y1} C ${m} ${y1}, ${m} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke="var(--t-line-strong)"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>

        {nodes.map((n) => (
          <div
            key={n.id}
            onPointerDown={(e) => onDown(e, n.id)}
            style={{ left: `${n.x}%`, top: `${n.y}%`, width: "18%" }}
            className={`absolute flex touch-none select-none flex-col gap-1.5 rounded-md border bg-surface p-2 transition-shadow ${
              drag === n.id ? "border-run elev-3" : "border-line elev-1 hover:border-line-strong"
            } ${drag === n.id ? "cursor-grabbing" : "cursor-grab"}`}
          >
            <div className="flex items-center gap-1.5">
              <span className="size-2 shrink-0 rounded-[2px]" style={{ background: CAT[n.c] }} />
              <span className="truncate text-[11.5px] font-medium">{n.label}</span>
            </div>
            <span className="truncate text-[9.5px] text-faint">{n.kind}</span>

            {/* Which systems this node actually reaches. */}
            <div className="flex flex-wrap gap-1 border-t border-line pt-1.5">
              {n.tools.map((t) => (
                <span
                  key={t.name}
                  className="inline-flex items-center gap-1 rounded-xs border border-line bg-raise px-1 py-px text-[9px] text-dim"
                >
                  <BrandMark name={t.name} size={9} />
                  {t.name}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════ Phase 2, the agent working ═══════════════════ */

function RunPhase({ onDone }: { onDone: () => void }) {
  const reduce = useReducedMotion();
  const { ref, seen } = useInView<HTMLDivElement>();
  const [n, setN] = useState(0);
  const [notice, setNotice] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduce) {
      // Land on the finished state rather than replaying it faster.
      const f = requestAnimationFrame(() => {
        setN(LOGS.length);
        setNotice(true);
      });
      return () => cancelAnimationFrame(f);
    }
    if (!seen) return;
    const id = setInterval(() => {
      setN((v) => {
        if (v >= LOGS.length) {
          clearInterval(id);
          return v;
        }
        return v + 1;
      });
    }, 620);
    return () => clearInterval(id);
  }, [reduce, seen]);

  useEffect(() => {
    if (reduce) return;
    if (n >= LOGS.length) {
      const t = setTimeout(() => setNotice(true), 500);
      return () => clearTimeout(t);
    }
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [n, reduce]);

  const pct = Math.round((Math.min(n, LOGS.length) / LOGS.length) * 100);

  return (
    <div ref={ref} className="relative overflow-hidden rounded-lg border border-line bg-surface elev-2">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/60 px-3 py-2">
        <span className="text-[12px] font-medium">DLP-4417 · A. Rao</span>
        {n < LOGS.length ? (
          <Status tone="run">running</Status>
        ) : (
          <Status tone="ok">complete</Status>
        )}
        <div className="grow" />
        <Mono className="text-[11px] text-faint">{pct}%</Mono>
      </div>

      <span className="block h-0.5 w-full bg-sunken">
        <span
          className="block h-full bg-run transition-[width] duration-500 ease-[var(--ease-out)]"
          style={{ width: `${pct}%` }}
        />
      </span>

      <div ref={scroller} className="h-[300px] overflow-y-auto p-4">
        <div className="flex flex-col gap-3">
          {LOGS.slice(0, n).map((l) => (
            <div key={l.t} className="af-chip flex gap-3">
              <Mono className="w-9 shrink-0 pt-px text-[10.5px] text-ghost">{l.t}</Mono>
              {l.kind === "reason" ? (
                <p className="max-w-[62ch] text-[12.5px] leading-[1.6] text-mist">{l.text}</p>
              ) : l.kind === "tool" ? (
                <div className="flex min-w-0 grow items-center justify-between gap-3 rounded-md border border-line bg-raise px-2.5 py-1.5">
                  <Mono className="truncate text-[11.5px] text-mist">{l.text}</Mono>
                  <Mono className="shrink-0 text-[10px] text-ok">{l.meta}</Mono>
                </div>
              ) : (
                <div className="flex min-w-0 items-baseline gap-2">
                  <span className={`mt-1.5 size-1.5 shrink-0 rounded-[2px] ${LOG_TONE[l.kind]}`} />
                  <span className="text-[12.5px] text-fg">{l.text}</span>
                  <Mono className="truncate text-[10.5px] text-ghost">{l.meta}</Mono>
                </div>
              )}
            </div>
          ))}

          {n < LOGS.length && (
            <div className="flex items-center gap-2 pl-12 text-[11.5px] text-faint">
              <span className="af-dots flex gap-0.5">
                <span className="size-1 rounded-[1px] bg-run" />
                <span className="size-1 rounded-[1px] bg-run" />
                <span className="size-1 rounded-[1px] bg-run" />
              </span>
              Processing
            </div>
          )}
        </div>
      </div>

      {/* The notification is the handoff into phase three. */}
      {notice && (
        <button
          onClick={onDone}
          className="af-notice focusable absolute right-4 bottom-4 flex w-[300px] cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface p-3 text-left elev-3 transition-colors hover:border-line-strong"
        >
          <span className="mt-px shrink-0 text-ok">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M8 12.5l2.5 2.5L16 9.5" />
            </svg>
          </span>
          <span className="flex min-w-0 grow flex-col gap-0.5">
            <span className="text-[12.5px] font-medium">
              DLP triage completed for DLP-4417
            </span>
            <span className="text-[11.5px] text-faint">
              Benign, authorized transfer · 4 citations · pending approval
            </span>
            <span className="mt-1 text-[11.5px] font-medium text-run">Review output →</span>
          </span>
        </button>
      )}
    </div>
  );
}

/* ═══════════════════ Phase 3, the result ═══════════════════ */

const SOURCES: Record<string, { locator: string; quote: string; doc: string }> = {
  "1": {
    locator: "DLP policy SAP-09 · clause 3.1",
    quote:
      "Transfers of material tagged CONFIDENTIAL to external recipients are prohibited unless the recipient is a contracted processor under a current data-sharing agreement.",
    doc: "DLP policy SAP-09.pdf",
  },
  "2": {
    locator: "Alert DLP-4417 · evidence",
    quote: "Four attachments tagged CONFIDENTIAL; recipient payroll@northwind-payroll.com; sent 27 Aug 2026, 21:14.",
    doc: "Alert DLP-4417.json",
  },
  "3": {
    locator: "Data-sharing agreement DSA-112 · §2",
    quote:
      "Northwind Payroll Ltd is an approved processor of employee payroll data, including salary and identifier fields, for the term ending 31 May 2027.",
    doc: "DSA-112.pdf",
  },
  "4": {
    locator: "Telemetry · 30-day actor history",
    quote: "Monthly transfer to northwind-payroll.com on or about the 27th, matching the payroll cycle, in each of the last six months.",
    doc: "splunk-extract-a.rao.csv",
  },
};

const RESULT = [
  { text: "Triage of alert DLP-4417 is complete. The recommended disposition is benign, authorized transfer." },
  { text: "The alert was triggered as designed: four files classified as CONFIDENTIAL were sent to an external address, which clause 3.1 prohibits by default.", cite: "1" },
  { text: "The recipient resolves to Northwind Payroll, and the transfer occurred on the payroll cycle date.", cite: "2" },
  { text: "Northwind Payroll is an approved processor for this data under agreement DSA-112, which remains current through May 2027.", cite: "3" },
  { text: "The actor's 30-day history aligns with the same monthly transfer over the previous six months, supporting the assessment of authorized processing rather than exfiltration.", cite: "4" },
];

/** Source popover: portalled and viewport-clamped, so a panel edge cannot clip it. */
function SourceCite({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const src = SOURCES[id];

  const place = useCallback(() => {
    const a = anchor.current?.getBoundingClientRect();
    if (!a) return;
    const W = 300;
    const H = pop.current?.offsetHeight ?? 180;
    const PAD = 12;
    let left = a.left + a.width / 2 - W / 2;
    left = Math.max(PAD, Math.min(left, window.innerWidth - W - PAD));
    let top = a.bottom + 8;
    if (top + H > window.innerHeight - PAD) top = Math.max(PAD, a.top - H - 8);
    setPos({ top, left });
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!anchor.current?.contains(t) && !pop.current?.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={anchor}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Source: ${src.locator}`}
        className={`focusable ml-0.5 cursor-pointer rounded-[3px] px-1 py-px align-super font-mono text-[9px] transition-colors ${
          open ? "bg-run text-on-solid" : "bg-raise text-run hover:bg-run hover:text-on-solid"
        }`}
      >
        {id}
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
              <Mono className="truncate text-[10.5px] text-c3">{src.locator}</Mono>
            </div>
            <p className="border-l-2 border-line-strong pl-2.5 text-[12px] leading-[1.55] text-mist">
              {src.quote}
            </p>
            <div className="flex items-center justify-between gap-2 border-t border-line pt-2">
              <span className="min-w-0 truncate text-[10.5px] text-faint">{src.doc}</span>
              <Link
                href="/runs"
                className="focusable flex shrink-0 items-center gap-1 rounded-sm text-[11px] font-medium text-fg hover:underline"
              >
                Review source
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M7 17L17 7M9 7h8v8" />
                </svg>
              </Link>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function ResultsPhase() {
  const [approved, setApproved] = useState(false);

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface elev-2">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/60 px-3 py-2">
        <span className="text-[12px] font-medium">Disposition memo · DLP-4417</span>
        {approved ? (
          <Status tone="ok">approved and issued</Status>
        ) : (
          <Status tone="warn">pending approval</Status>
        )}
        <div className="grow" />
        <Mono className="text-[11px] text-faint">4 cited · 0 unsupported</Mono>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,260px)]">
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:border-r lg:border-b-0">
          {RESULT.map((r, i) => (
            <p key={i} className="af-in max-w-[62ch] text-[13px] leading-[1.65] text-mist" style={{ animationDelay: `${i * 60}ms` }}>
              {r.text}
              {r.cite && <SourceCite id={r.cite} />}
            </p>
          ))}
        </div>

        <div className="flex flex-col divide-y divide-line">
          {[
            ["Disposition", "Benign, authorized"],
            ["Confidence", "0.93"],
            ["Duration", "6m 32s"],
            ["Cost", "$1.12"],
            ["Controls", "12 of 12 passed"],
          ].map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
              <span className="text-[11.5px] text-faint">{k}</span>
              <span className="tnum text-[12.5px] font-medium">{v}</span>
            </div>
          ))}

          <div className="flex flex-col gap-2 p-3">
            {approved ? (
              <div className="af-swap flex flex-col gap-2">
                <div className="flex items-start gap-2 rounded-md border border-ok-line bg-ok-bg p-2.5">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-px shrink-0 text-ok">
                    <path d="M4 13l5 5 11-13" />
                  </svg>
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[12px] font-medium text-fg">Issued to R. Alvarez</span>
                    <span className="text-[11px] text-dim">
                      Reviewer approval recorded in the audit trail
                    </span>
                  </div>
                </div>
                <Button variant="outline" full onClick={() => setApproved(false)}>
                  Reset approval
                </Button>
              </div>
            ) : (
              <Button tone="ok" variant="solid" full onClick={() => setApproved(true)}>
                Approve and issue
              </Button>
            )}
            <Button variant="outline" full href="/runs?id=news-briefing-sample">
              Review an example run
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
