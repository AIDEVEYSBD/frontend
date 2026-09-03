"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, IconButton, Mono } from "../ui";

/**
 * The deploy theater: the moment a document becomes part of the estate,
 * staged honestly. Every act maps to a real step the /api/deploy call
 * performs — parser seal, registry write — and the final state shows the
 * real digest that now identifies this agent. The choreography never lies:
 * if the parser refuses, the theater shows the refusal, not a success scene.
 *
 * All art is procedural JSX/SVG; all sound is synthesized in WebAudio at
 * click time (the click is the gesture that unlocks audio). Reduced-motion
 * viewers get the same truth with the theatrics stripped.
 */

type Act = "seal" | "validate" | "ship" | "live" | "refused";

interface Deployed {
  id: string;
  digest: string;
  store: string;
  steps: { step: string; ms: number }[];
}

/* ── procedural sound: three cues, synthesized, nothing fetched ── */

function makeSound(muted: () => boolean) {
  let ctx: AudioContext | null = null;
  const ensure = () => {
    if (!ctx) ctx = new (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    return ctx;
  };
  const blip = (freq: number, dur: number, gain: number, type: OscillatorType = "sine", when = 0) => {
    if (muted()) return;
    try {
      const c = ensure();
      const t = c.currentTime + when;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(c.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    } catch {
      /* audio unavailable — the theater plays silent */
    }
  };
  return {
    tick: () => blip(1320, 0.07, 0.05, "triangle"),
    thunk: () => {
      blip(140, 0.16, 0.14, "sine");
      blip(90, 0.2, 0.1, "sine", 0.01);
    },
    live: () => {
      // A quiet resolving triad — arrival, not fanfare.
      blip(523.25, 0.5, 0.05);
      blip(659.25, 0.5, 0.045, "sine", 0.09);
      blip(783.99, 0.7, 0.04, "sine", 0.18);
    },
    refuse: () => blip(196, 0.35, 0.08, "square"),
  };
}

/* ── the theater ── */

export function DeployTheater({
  doc,
  onClose,
}: {
  doc: unknown;
  /** `refused` lets the shell surface the problems rail after a refusal. */
  onClose: (deployed: boolean, refused?: boolean) => void;
}) {
  const router = useRouter();
  const [act, setAct] = useState<Act>("seal");
  const [result, setResult] = useState<Deployed | null>(null);
  const [refusal, setRefusal] = useState("");
  const [typedDigest, setTypedDigest] = useState("");
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem("af-deploy-muted") === "1";
    } catch {
      return false;
    }
  });
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const sound = useMemo(() => makeSound(() => mutedRef.current), []);
  const reduce = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  const meta = (doc as { metadata?: { id?: string; name?: string } })?.metadata ?? {};
  const nodes = ((doc as { spec?: { nodes?: { id: string }[] } })?.spec?.nodes ?? []).map((n) => n.id);

  /* One real request; the acts choreograph around its truth. Cancel and
     unmount abort it — a cancelled deploy must not land later anyway. */
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    let stop = false;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const minDwell = (ms: number) => new Promise((r) => setTimeout(r, reduce ? 0 : ms));

    (async () => {
      const request = fetch("/api/deploy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ spec: doc }),
        signal: ctrl.signal,
      })
        .then(async (r) => ({ ok: r.ok, body: await r.json() }))
        .catch((e) => ({ ok: false, body: { error: (e as Error).message } }));

      sound.tick();
      await minDwell(1050);
      if (stop) return;
      setAct("validate");
      sound.tick();
      await minDwell(1150);
      if (stop) return;

      const { ok, body } = await request;
      if (stop) return;
      if (!ok || body.error) {
        setRefusal(String(body.error ?? "the deploy failed"));
        setAct("refused");
        sound.refuse();
        return;
      }
      setAct("ship");
      sound.thunk();
      await minDwell(1250);
      if (stop) return;
      setResult(body as Deployed);
      setAct("live");
      sound.live();
    })();

    return () => {
      stop = true;
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* The digest types itself in once known. */
  useEffect(() => {
    if (act !== "live" || !result?.digest) return;
    if (reduce) {
      setTypedDigest(result.digest);
      return;
    }
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      setTypedDigest(result.digest.slice(0, i));
      if (i >= result.digest.length) clearInterval(id);
    }, 34);
    return () => clearInterval(id);
  }, [act, result, reduce]);

  const escape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(act === "live", act === "refused");
    },
    [onClose, act],
  );
  useEffect(() => {
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [escape]);

  const stageIndex = { seal: 0, validate: 1, ship: 2, live: 3, refused: 1 }[act];

  // Dialog semantics: focus lands inside on mount and Tab cycles within.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    (panel.querySelector<HTMLElement>("button, [href]") ?? panel).focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusables = panel.querySelectorAll<HTMLElement>("button, [href], input, textarea");
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", trap);
    return () => window.removeEventListener("keydown", trap);
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Deploying the workflow"
      className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/94"
    >
      <style>{`
        @keyframes af-dep-dash { to { stroke-dashoffset: 0; } }
        @keyframes af-dep-rise { from { transform: translateY(10px); opacity: 0; } to { transform: none; opacity: 1; } }
        .af-dep-rise { animation: af-dep-rise 260ms var(--ease-out) both; }
        @media (prefers-reduced-motion: reduce) {
          .af-dep-rise { animation: none; }
        }
      `}</style>

      <div ref={panelRef} className="af-dep-rise flex w-[min(560px,92vw)] flex-col gap-5 rounded-lg border border-line bg-surface p-6 elev-3">
        {/* progress */}
        <div className="flex items-center gap-2">
          {["Seal", "Validate", "Ship", "Live"].map((s, i) => (
            <div key={s} className="flex grow items-center gap-2">
              <span
                className={`text-[11px] font-medium transition-colors duration-200 ease-[var(--ease-out)] ${
                  act === "refused" && i === 1
                    ? "text-err"
                    : i <= stageIndex
                      ? "text-fg"
                      : "text-ghost"
                }`}
              >
                {act === "refused" && i === 1 ? "Refused" : s}
              </span>
              {i < 3 && (
                <span className="relative h-px grow overflow-hidden rounded bg-line">
                  <span
                    className="absolute inset-y-0 left-0 bg-fg transition-[width] duration-[260ms] ease-[var(--ease-out)]"
                    style={{ width: i < stageIndex ? "100%" : "0%" }}
                  />
                </span>
              )}
            </div>
          ))}
          <IconButton
            size="sm"
            label={muted ? "Unmute" : "Mute"}
            onClick={() => {
              const next = !muted;
              setMuted(next);
              try {
                localStorage.setItem("af-deploy-muted", next ? "1" : "0");
              } catch {
                /* fine */
              }
            }}
            className="ml-2 shrink-0 rounded-sm"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M11 5 6 9H2v6h4l5 4z" />
              {muted ? <path d="M22 9l-6 6M16 9l6 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M18.4 5.6a9 9 0 0 1 0 12.8" />}
            </svg>
          </IconButton>
        </div>

        {/* stage */}
        <div className="relative grid h-[240px] place-items-center overflow-hidden rounded-md border border-line bg-sunken/30">
          {act !== "refused" ? (
            <svg viewBox="0 0 320 200" className="h-full w-full" aria-hidden>
              {/* the platform rail the container lands on */}
              <line x1="40" y1="168" x2="280" y2="168" stroke="var(--color-line-strong)" strokeWidth="1.5" />
              {[70, 130, 190, 250].map((x) => (
                <line key={x} x1={x} y1="168" x2={x - 10} y2="178" stroke="var(--color-line)" strokeWidth="1" />
              ))}

              {/* ACT 1+2 — the document, being sealed and checked */}
              <g
                style={{
                  transition: "transform 260ms var(--ease-out), opacity 260ms var(--ease-out)",
                  transform: act === "seal" || act === "validate" ? "translate(0,0)" : "translate(0,26px) scale(0.22)",
                  transformOrigin: "160px 96px",
                  opacity: act === "seal" || act === "validate" ? 1 : 0,
                }}
              >
                <rect x="118" y="34" width="84" height="108" rx="5" fill="var(--color-surface)" stroke="var(--color-line-strong)" strokeWidth="1.5" />
                {[52, 66, 80, 94, 108].map((y, i) => (
                  <line
                    key={y}
                    x1="130"
                    y1={y}
                    x2={i === 4 ? 162 : 190}
                    y2={y}
                    stroke="var(--color-line-strong)"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeDasharray="70"
                    strokeDashoffset={reduce ? 0 : 70}
                    style={{ animation: reduce ? undefined : `af-dep-dash 260ms var(--ease-out) ${120 + i * 110}ms forwards` }}
                  />
                ))}
                {/* the node graph inside the document lights up during validate */}
                {nodes.slice(0, 5).map((_, i, all) => {
                  const x = 134 + (i * 52) / Math.max(1, all.length - 1);
                  return (
                    <circle
                      key={i}
                      cx={x}
                      cy={126}
                      r="3.4"
                      fill={act === "validate" ? "var(--color-run)" : "var(--color-line-strong)"}
                      style={{ transition: `fill 260ms var(--ease-out) ${i * 140}ms` }}
                    />
                  );
                })}
              </g>

              {/* ACT 3+4 — the container */}
              <g
                style={{
                  transition: "transform 260ms var(--ease-out), opacity 260ms var(--ease-out)",
                  transform: act === "ship" || act === "live" ? "translate(0,0)" : "translate(0,18px)",
                  opacity: act === "ship" || act === "live" ? 1 : 0,
                }}
              >
                {/* container body — once live it settles into a static ok stroke */}
                <rect x="112" y="106" width="96" height="56" rx="4" fill="var(--color-surface)" stroke={act === "live" ? "var(--color-ok)" : "var(--color-line-strong)"} strokeWidth="1.8" style={{ transition: "stroke 260ms var(--ease-out)" }} />
                {[126, 140, 154, 168, 182, 196].map((x) => (
                  <line key={x} x1={x} y1="112" x2={x} y2="156" stroke="var(--color-line)" strokeWidth="1.2" />
                ))}
                {/* lid */}
                <rect
                  x="108"
                  y="98"
                  width="104"
                  height="12"
                  rx="3"
                  fill="var(--color-raise)"
                  stroke={act === "live" ? "var(--color-ok)" : "var(--color-line-strong)"}
                  strokeWidth="1.8"
                  style={{
                    transition: "transform 260ms var(--ease-out) 150ms, stroke 260ms var(--ease-out)",
                    transform: act === "ship" && !reduce ? "translateY(-14px)" : "translateY(0)",
                  }}
                />
                {/* the runtime label on the box */}
                <text x="160" y="138" textAnchor="middle" fontFamily="var(--font-plex-mono)" fontSize="9" fill={act === "live" ? "var(--color-ok)" : "var(--color-dim)"} style={{ transition: "fill 260ms var(--ease-out)" }}>
                  runtime
                </text>
                {act === "live" && (
                  <g>
                    <circle cx="204" cy="102" r="7" fill="var(--color-ok)" />
                    <path d="M200.5 102l2.4 2.4 4.4-4.6" stroke="var(--t-on-solid)" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </g>
                )}
              </g>
            </svg>
          ) : (
            <div className="flex max-w-[85%] flex-col items-center gap-2.5 text-center">
              <span className="grid size-9 place-items-center rounded-md bg-err text-on-solid">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </span>
              <p className="text-[13px] font-semibold text-fg">The parser refused it.</p>
              <p className="font-mono text-[11px] leading-[1.6] break-all text-err">{refusal}</p>
            </div>
          )}
        </div>

        {/* caption */}
        <div className="flex min-h-[40px] flex-col gap-1">
          {act === "seal" && (
            <p className="text-[12.5px] text-dim">
              Sealing <span className="font-semibold text-fg">{meta.name ?? meta.id}</span> — the
              document is the whole agent, and its digest is about to become its identity.
            </p>
          )}
          {act === "validate" && (
            <p className="text-[12.5px] text-dim">
              The deployment parser walks every node, edge, grant and gate — the same rules the
              runtime enforces, refused here rather than discovered at a client.
            </p>
          )}
          {act === "ship" && (
            <p className="text-[12.5px] text-dim">
              Into the container: the runtime&rsquo;s registry receives the document, and
              AgentFactoryDB stamps it deployed.
            </p>
          )}
          {act === "live" && result && (
            <div className="flex flex-col gap-1">
              <p className="text-[12.5px] text-fg">
                <span className="font-semibold text-ok">Live.</span> Callable by other workflows,
                visible on the control plane, running under the journal.
              </p>
              <Mono className="text-[10.5px] text-faint">
                digest {typedDigest || "…"} · {result.store} ·{" "}
                {result.steps.map((s) => `${s.step} ${s.ms}ms`).join(" · ")}
              </Mono>
            </div>
          )}
          {act === "refused" && (
            <p className="text-[12.5px] text-dim">
              Nothing shipped. Fix the named field on the canvas — the refusal is the same answer
              the runtime would give.
            </p>
          )}
        </div>

        {/* actions */}
        <div className="flex items-center gap-2">
          <span className="grow" />
          {act === "live" ? (
            <>
              <Button size="sm" variant="outline" onClick={() => onClose(true)}>
                Back to canvas
              </Button>
              <Button size="sm" variant="solid" tone="ink" onClick={() => router.push("/control")}>
                See it on Control
              </Button>
            </>
          ) : act === "refused" ? (
            <Button size="sm" variant="solid" tone="ink" onClick={() => onClose(false, true)}>
              Back to canvas
            </Button>
          ) : act === "ship" ? null : (
            // Past "ship" the registry write is already underway — nothing
            // honest is left to cancel, so the button goes away entirely.
            <Button
              size="sm"
              variant="solid"
              tone="err"
              onClick={() => {
                abortRef.current?.abort();
                onClose(false);
              }}
            >
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
