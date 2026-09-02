"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mono } from "./ui";

/**
 * The architecture, told as a descent.
 *
 * Cold open: the assembled machine. The scroll pulls it apart into layers;
 * each layer answers the question the previous one raised; at the bottom the
 * stack snaps back together, annotated. Structure borrowed from how Nolan
 * builds a third act; voice kept flat and verb-led.
 *
 * The visual language, stated once and used everywhere in this scene:
 *   planes   , the layers themselves: hairline slabs, one accent edge each
 *   the deck , the stack tilts to near-iso; the FOCUSED plane counter-rotates
 *               to face the camera, so the layer being discussed always reads
 *               as flat, sharp UI while the rest recede as texture
 *   vignettes, each beat shows what that layer *does*, as a looping motion
 *               sketch in the app's own grammar: hairlines that draw, dots
 *               that travel, rows that type in, meters that fill. Abstractions
 *               of real behaviour, never fictional UI.
 */

export interface Layer {
  id: string;
  question: string;
  headline: string;
  support: string;
  /** Real, shipped features, the chips drawn on the layer plane. */
  chips: string[];
  token: string;
}

export const LAYERS: Layer[] = [
  {
    id: "experience",
    question: "Who builds the workflows?",
    headline: "Your teams describe the process. The factory assembles it.",
    support:
      "Compose approved harnesses on a visual canvas or describe the process in plain language and let the builder draft it. Every draft passes the same validation as a deployment, so teams ship workflows quickly without unmanaged development.",
    chips: ["Canvas", "Agent builder", "Deploy theater"],
    token: "--t-c1",
  },
  {
    id: "lifecycle",
    question: "How does a workflow reach production?",
    headline: "Every stage earns its promotion.",
    support:
      "Design, benchmark, deployment and monitoring each leave their own stamp, and the registry keeps a live inventory of agents, models and tools. Readiness is shown by record, not asserted, so teams promote work on results rather than assumptions.",
    chips: ["Registry", "Benchmarks", "Deploy stamps"],
    token: "--t-c2",
  },
  {
    id: "workplane",
    question: "What did the agent actually do?",
    headline: "Every action writes its own record.",
    support:
      "Execution journals capture what ran, what was read, what changed and which artifacts were produced, with provenance attached to each step. Any run can be reconstructed in full, whether the question comes from an engineer, a reviewer or a regulator.",
    chips: ["Journal", "Provenance", "Artifacts"],
    token: "--t-c3",
  },
  {
    id: "control",
    question: "How do people stay in control?",
    headline: "Approval before. Intervention during. Cost visibility throughout.",
    support:
      "Higher-risk steps pause at defined gates for human decision, and the decision is recorded with its rationale. Any run can be stopped mid-flight, with the intervention kept in the journal. Budgets and evals are enforced at runtime, not reviewed after the fact.",
    chips: ["Gates", "Kill switch", "FinOps", "Evals"],
    token: "--t-warn",
  },
  {
    id: "knowledge",
    question: "What can an agent reach?",
    headline: "Access is granted per node, never assumed.",
    support:
      "Each node declares the retrieval sources, records and engines it may use, and nothing else is reachable. Untrusted content is tainted at entry and cannot flow into restricted actions until policy clears it.",
    chips: ["Retrieval", "Records", "Engines", "Taint rules"],
    token: "--t-c5",
  },
  {
    id: "partners",
    question: "What about external agents?",
    headline: "External agents work under the same rules, without exception.",
    support:
      "Partner agents connect over A2A, are identified by their agent card and inherit the same journal, permission and taint rules as native harnesses. Their replies stay marked untrusted until validated.",
    chips: ["A2A discover", "Hand-off", "Tainted replies"],
    token: "--t-c6",
  },
  {
    id: "models",
    question: "Where does the reasoning run?",
    headline: "Each task runs on the model its sensitivity requires.",
    support:
      "Nodes state their model requirements and the router decides where execution happens. Sensitive work can be pinned to locally hosted models, routine work sent to frontier models, and the choice is governed by policy and cost rather than by convention.",
    chips: ["Per-node routing", "Local models", "Frontier models"],
    token: "--t-c7",
  },
  {
    id: "foundations",
    question: "What does it all stand on?",
    headline: "Governance is the foundation, not a feature.",
    support:
      "Identity, policy and audit sit beneath every layer, with secrets resolved only at the moment of the call, prompt-injection filtering on every input and a runtime built to run inside your own tenancy.",
    chips: ["Vault", "Injection filters", "Your tenancy"],
    token: "--t-c9",
  },
];

export const OPENING = {
  headline: "An AI agent has just finished a piece of work.",
  support: "Every step it took, every source it touched and every decision along the way is already on the record.",
  cue: "Explore the architecture",
};

export const TURN = {
  headline: "Autonomy without inspection is unmanaged risk.",
  support: "Agent Factory is built to be inspected, layer by layer.",
};

export const MERGE = {
  headline: "One architecture, fully accountable.",
  support: "Each layer contributes the record, oversight and operational controls that enterprise agents require, whatever the workflow.",
  final: "Designed to be inspected.",
  finalSupport: "Deployed in your tenancy. Governed by design.",
};

/* ═══════════════════ Vignettes ═══════════════════
   One per layer: what the layer does, as motion. Shared grammar, 300×150
   viewBox, hairline strokes, the layer's token as the only accent, mono
   micro-labels. Animations run only while the beat is active and never under
   reduced motion. */

function Vignette({ layer, active }: { layer: Layer; active: boolean }) {
  const A = `var(${layer.token})`;
  const common = {
    stroke: "var(--color-line-strong)",
    fill: "none",
    strokeWidth: 1.2,
  } as const;

  return (
    <div
      data-vg={active || undefined}
      className="af-vg relative mt-2 w-full max-w-[500px] overflow-hidden rounded-md border border-line bg-surface"
    >
      <svg viewBox="0 0 300 150" className="block w-full" aria-hidden>
        {layer.id === "experience" && (
          <g>
            {/* a wire draws, a node arrives already connected */}
            <rect x="24" y="56" width="64" height="34" rx="5" {...common} />
            <text x="56" y="76" textAnchor="middle" className="af-vg-label">retrieve</text>
            <path d="M88 73 C 118 73, 128 73, 158 73" stroke={A} strokeWidth="1.4" fill="none"
              strokeDasharray="80" strokeDashoffset="80" className="af-vg-draw" />
            <g className="af-vg-pop">
              <rect x="158" y="56" width="64" height="34" rx="5" fill="var(--color-surface)" stroke={A} strokeWidth="1.4" />
              <text x="190" y="76" textAnchor="middle" className="af-vg-label">assess</text>
            </g>
            <circle cx="88" cy="73" r="2.5" fill={A} />
            <circle cx="158" cy="73" r="2.5" fill={A} className="af-vg-pop" />
            <text x="24" y="34" className="af-vg-micro">configure visually or describe the process</text>
            <g className="af-vg-late">
              <rect x="236" y="56" width="40" height="34" rx="5" {...common} strokeDasharray="3 3" />
              <text x="256" y="76" textAnchor="middle" className="af-vg-label">file</text>
            </g>
          </g>
        )}

        {layer.id === "lifecycle" && (
          <g>
            {["Design", "Test", "Deploy", "Observe"].map((s, i) => (
              <g key={s}>
                <line x1={52 + i * 60} y1="75" x2={92 + i * 60} y2="75" stroke="var(--color-line)" strokeWidth="1.2" />
                <circle cx={40 + i * 60} cy="75" r="6" fill="var(--color-surface)" stroke="var(--color-line-strong)" strokeWidth="1.2"
                  className="af-vg-stage" style={{ animationDelay: `${i * 0.7}s` }} />
                <circle cx={40 + i * 60} cy="75" r="6" fill={A} opacity="0"
                  className="af-vg-stagefill" style={{ animationDelay: `${i * 0.7}s` }} />
                <text x={40 + i * 60} y="98" textAnchor="middle" className="af-vg-micro">{s}</text>
              </g>
            ))}
            <text x="24" y="34" className="af-vg-micro">each stage supported by its own record</text>
          </g>
        )}

        {layer.id === "workplane" && (
          <g>
            {[0, 1, 2, 3].map((i) => (
              <g key={i} className="af-vg-row" style={{ animationDelay: `${i * 0.8}s` }}>
                <text x="24" y={48 + i * 24} className="af-vg-micro">{`0:${(12 + i * 9).toString().padStart(2, "0")}`}</text>
                <circle cx="58" cy={44 + i * 24} r="2.2" fill={i === 3 ? A : "var(--color-line-strong)"} />
                <rect x="68" y={40 + i * 24} height="8" rx="2" fill="var(--color-raise)"
                  className="af-vg-bar" style={{ animationDelay: `${i * 0.8}s`, width: 90 + (i % 3) * 46 }} />
              </g>
            ))}
            <text x="24" y="24" className="af-vg-micro">execution journal updated in real time</text>
          </g>
        )}

        {layer.id === "control" && (
          <g>
            <path d="M24 75 H 200" stroke={A} strokeWidth="1.4" strokeDasharray="5 5" className="af-vg-run" />
            <g className="af-vg-kill">
              <rect x="200" y="60" width="76" height="30" rx="5" fill="var(--color-surface)" stroke="var(--t-err)" strokeWidth="1.4" />
              <circle cx="214" cy="75" r="3" fill="var(--t-err)" />
              <text x="224" y="79" className="af-vg-label" style={{ fill: "var(--t-err)" }}>killed</text>
            </g>
            <text x="24" y="34" className="af-vg-micro">intervention retained as a decision record</text>
            <g>
              <rect x="24" y="108" width="180" height="5" rx="2.5" fill="var(--color-raise)" />
              <rect x="24" y="108" height="5" rx="2.5" fill={A} className="af-vg-meter" />
              <text x="212" y="114" className="af-vg-micro">budget</text>
            </g>
          </g>
        )}

        {layer.id === "knowledge" && (
          <g>
            <g className="af-vg-slide">
              <rect x="24" y="58" width="72" height="32" rx="5" {...common} />
              <text x="60" y="74" textAnchor="middle" className="af-vg-label">document</text>
              <rect x="30" y="80" width="26" height="9" rx="2" fill="var(--t-warn)" opacity="0.85" />
              <text x="43" y="87" textAnchor="middle" className="af-vg-tag">EXT</text>
            </g>
            <line x1="170" y1="42" x2="170" y2="108" stroke="var(--t-err)" strokeWidth="1.4" className="af-vg-wall" />
            <text x="170" y="126" textAnchor="middle" className="af-vg-micro">taint rule</text>
            <rect x="204" y="58" width="72" height="32" rx="5" {...common} />
            <text x="240" y="78" textAnchor="middle" className="af-vg-label">notify.send</text>
            <text x="24" y="34" className="af-vg-micro">untrusted content is restricted by policy</text>
          </g>
        )}

        {layer.id === "partners" && (
          <g>
            <rect x="24" y="58" width="64" height="34" rx="5" fill="var(--color-surface)" stroke={A} strokeWidth="1.4" />
            <text x="56" y="78" textAnchor="middle" className="af-vg-label">factory</text>
            <rect x="212" y="58" width="64" height="34" rx="5" {...common} />
            <text x="244" y="78" textAnchor="middle" className="af-vg-label">peer</text>
            <path d="M88 68 H 212" stroke="var(--color-line-strong)" strokeWidth="1" strokeDasharray="3 4" />
            <circle r="3" fill={A} className="af-vg-out"><title>task</title></circle>
            <circle r="3" fill="var(--t-warn)" className="af-vg-back" />
            <g className="af-vg-late">
              <rect x="120" y="96" width="60" height="12" rx="2.5" fill="var(--warn-bg, transparent)" stroke="var(--t-warn)" strokeWidth="0.8" />
              <text x="150" y="105" textAnchor="middle" className="af-vg-tag" style={{ fill: "var(--t-warn)" }}>tainted reply</text>
            </g>
            <text x="24" y="34" className="af-vg-micro">A2A, recorded, permissioned and controllable</text>
          </g>
        )}

        {layer.id === "models" && (
          <g>
            {/* The caption owns the top row; the fork lives below it. */}
            <text x="24" y="26" className="af-vg-micro">routing aligned with workflow requirements</text>
            <rect x="24" y="70" width="60" height="34" rx="5" {...common} />
            <text x="54" y="90" textAnchor="middle" className="af-vg-label">node</text>
            <path d="M84 80 C 120 66, 150 60, 190 60" {...common} strokeDasharray="4 4" />
            <path d="M84 94 C 120 110, 150 116, 190 116" stroke={A} strokeWidth="1.4" fill="none" strokeDasharray="4 4" />
            <circle r="2.6" fill={A} className="af-vg-route" />
            <rect x="190" y="46" width="86" height="28" rx="5" {...common} />
            <text x="233" y="63" textAnchor="middle" className="af-vg-label">frontier</text>
            <rect x="190" y="102" width="86" height="28" rx="5" fill="var(--color-surface)" stroke={A} strokeWidth="1.4" />
            <text x="233" y="119" textAnchor="middle" className="af-vg-label">local model</text>
          </g>
        )}

        {layer.id === "foundations" && (
          <g>
            <text x="24" y="26" className="af-vg-micro">resolved only at the moment of the call</text>
            {/* The spec holds a reference… */}
            <rect x="24" y="58" width="122" height="36" rx="5" {...common} strokeDasharray="3 3" />
            <text x="85" y="80" textAnchor="middle" className="af-vg-code" style={{ fontSize: 11 }}>{"${secret:api-key}"}</text>
            <path d="M146 76 H 170" stroke={A} strokeWidth="1.4" strokeDasharray="4 4" />
            {/* …the vault fills a password field, dot by dot, never the value. */}
            <g>
              <rect x="170" y="54" width="106" height="44" rx="6" fill="var(--color-surface)" stroke={A} strokeWidth="1.4" />
              <text x="180" y="68" className="af-vg-micro" style={{ fontSize: 8 }}>api-key</text>
              {[0, 1, 2, 3, 4, 5, 6, 7].map((d) => (
                <circle
                  key={d}
                  cx={184 + d * 11}
                  cy="84"
                  r="2.6"
                  fill="var(--color-fg)"
                  className="af-vg-dot"
                  style={{ animationDelay: `${0.5 + d * 0.22}s` }}
                />
              ))}
              <rect x={180} y="78" width="1.5" height="12" fill={A} className="af-vg-caret" />
            </g>
            <path d="M24 118 H 276" stroke={A} strokeWidth="1.4" strokeDasharray="252" strokeDashoffset="252" className="af-vg-draw" />
            <text x="24" y="136" className="af-vg-micro">deployed within your security perimeter</text>
          </g>
        )}
      </svg>
    </div>
  );
}

/* ═══════════════════ The scene ═══════════════════ */

const N = LAYERS.length;
const HOLD_IN = 0.07;
const EXPLODE = 0.13;
const MERGE_SPAN = 0.11;
const HOLD_OUT = 0.07;

const seg = (p: number, a: number, b: number) => Math.min(1, Math.max(0, (p - a) / (b - a)));
const ease = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

const ENHANCE_QUERIES = ["(min-width: 768px)", "(prefers-reduced-motion: no-preference)"];
function subscribeEnhanced(cb: () => void) {
  const mqs = ENHANCE_QUERIES.map((q) => window.matchMedia(q));
  mqs.forEach((m) => m.addEventListener("change", cb));
  return () => mqs.forEach((m) => m.removeEventListener("change", cb));
}
function getEnhanced() {
  return ENHANCE_QUERIES.every((q) => window.matchMedia(q).matches);
}

export function ArchitectureStory() {
  const section = useRef<HTMLElement>(null);
  const [beat, setBeat] = useState(-1); // -1 opening · 0..N-1 layers · N merge
  // The scroll-driven deck only runs where it fits: a viewport at least
  // 768px wide (the sticky 100dvh stage cannot hold deck + copy + vignette
  // on a phone) and no reduced-motion preference. Everything else gets the
  // static, fully stacked telling. Server snapshot is false so the static
  // version is what hydrates.
  const enhanced = useSyncExternalStore(subscribeEnhanced, getEnhanced, () => false);
  const beatRef = useRef(-1);

  const setBeatIfChanged = useCallback((b: number) => {
    if (beatRef.current !== b) {
      beatRef.current = b;
      setBeat(b);
    }
  }, []);

  useEffect(() => {
    if (!enhanced) return;
    const el = section.current;
    if (!el) return;
    let raf = 0;

    const drive = () => {
      raf = 0;
      const r = el.getBoundingClientRect();
      const p = seg(-r.top, 0, r.height - window.innerHeight);

      const explodeIn = ease(seg(p, HOLD_IN, HOLD_IN + EXPLODE));
      const mergeOut = ease(seg(p, 1 - HOLD_OUT - MERGE_SPAN, 1 - HOLD_OUT));
      const explode = explodeIn * (1 - mergeOut);

      const t = seg(p, HOLD_IN + EXPLODE, 1 - HOLD_OUT - MERGE_SPAN) * N;
      const idx = Math.min(N - 1, Math.floor(t));
      const local = t - idx;
      const focus = Math.min(N - 1, idx + ease(seg(local, 0.7, 1)));

      el.style.setProperty("--explode", explode.toFixed(4));
      const layersEls = el.querySelectorAll<HTMLElement>("[data-arch-layer]");
      const assembly = layersEls[0]?.parentElement;
      const assemblyH = assembly?.offsetHeight ?? 0;
      const P = 1400; // must match the viewport's perspective
      const LIFT_Z = 560;
      const tX = ((54 * explode) * Math.PI) / 180;
      const tZ = ((-40 * explode) * Math.PI) / 180;
      layersEls.forEach((l, i) => {
        const rawDist = Math.abs(i - focus);
        const dist = Math.min(1, rawDist);
        const lift = (1 - dist) * explode;
        l.style.setProperty("--dim", (dist * explode).toFixed(3));
        l.style.setProperty("--lift", lift.toFixed(3));
        // Neighbours step back to make room, the focused card pops out of a
        // gap, it never squats on top of another plane.
        const push = Math.sign(i - focus) * Math.max(0, 2.1 - rawDist) * 44 * explode;
        l.style.setProperty("--push", push.toFixed(2));

        // Pin the flattened card at its own slot: model the FULL transform ,
        // including the slot translateZ along the tilted normal, which is the
        // dominant up-screen mover, then counter-translate in the flattened
        // frame so the projected centre lands at (0, yoff). Exact at lift=1.
        if (lift > 0.001) {
          const yoff = l.offsetTop + l.offsetHeight / 2 - assemblyH / 2;
          const zslot = ((N - 1) / 2 - i) * 60 * explode + push;
          // p' = Rx(tX) · Rz(tZ) · (0, yoff, zslot)
          const x1 = -yoff * Math.sin(tZ);
          const y1 = yoff * Math.cos(tZ);
          const cx = x1;
          const cy = y1 * Math.cos(tX) - zslot * Math.sin(tX);
          const cz = y1 * Math.sin(tX) + zslot * Math.cos(tX);
          const S = 1 - 0.20 * explode; // must match the assembly scale
          const f = P / Math.max(120, P - S * (cz + LIFT_Z * lift));
          l.style.setProperty("--fx", ((0 - cx) * lift).toFixed(2));
          l.style.setProperty("--fy", ((yoff / f - cy) * lift).toFixed(2));
        } else {
          l.style.setProperty("--fx", "0");
          l.style.setProperty("--fy", "0");
        }
      });

      setBeatIfChanged(explode > 0.5 ? Math.round(focus) : p < 0.5 ? -1 : N);
    };

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(drive);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
      // Leave no driver state behind so the static telling renders clean.
      el.style.removeProperty("--explode");
      el.querySelectorAll<HTMLElement>("[data-arch-layer]").forEach((l) => {
        for (const v of ["--dim", "--lift", "--push", "--fx", "--fy"]) l.style.removeProperty(v);
      });
      setBeatIfChanged(-1);
    };
  }, [enhanced, setBeatIfChanged]);

  return (
    <section
      ref={section}
      id="platform"
      data-enhanced={enhanced || undefined}
      className="af-arch relative border-b border-line"
      aria-label="Agent Factory platform architecture"
    >
      <style>{`
        .af-arch[data-enhanced] { height: 900vh; }
        .af-arch { --slabmix: 52%; --slabbase: #ffffff; --shadowa: 0.14; }
        :root[data-theme="dark"] .af-arch { --slabmix: 48%; --slabbase: #131211; --shadowa: 0.45; }
        @media (prefers-color-scheme: dark) {
          :root:not([data-theme="light"]) .af-arch { --slabmix: 48%; --slabbase: #131211; --shadowa: 0.45; }
        }
        .af-arch[data-enhanced] .af-arch-stage {
          position: sticky; top: 0; height: 100dvh; overflow: clip;
        }
        .af-arch-viewport { perspective: 1400px; }
        .af-arch-assembly {
          transform-style: preserve-3d;
          transform:
            rotateX(calc(var(--tiltX, 54deg) * var(--explode, 0)))
            rotateZ(calc(var(--tiltZ, -40deg) * var(--explode, 0)))
            scale(calc(1 - 0.20 * var(--explode, 0)));
        }
        /* The focused plane counter-rotates to face the camera, the layer
           under discussion is always flat, sharp, and readable, while the
           rest of the deck recedes as texture. Counter order is the reverse
           of the assembly's (Rz then Rx), scaled by how focused it is. */
        /* Order is the whole trick (rotate FIRST, then translateZ): after the
           counter-rotation the card's local Z is the screen normal, so the
           lift moves it straight OUT of the screen, past every tilted
           corner (max ~500px), with zero up-screen drift. The inverse scale
           cancels the perspective growth (about 1.25x at P=1400, S=0.8), so
           the lifted card lands at roughly 1.05x its slot width and stays
           inside its own column at every width from 768px up. */
        .af-arch [data-arch-layer] {
          transform-style: preserve-3d;
          transform:
            translateZ(calc((var(--zbase, 0) * var(--explode, 0) + var(--push, 0)) * 1px))
            rotateZ(calc(var(--tiltZ, -40deg) * -1 * var(--lift, 0)))
            rotateX(calc(var(--tiltX, 54deg) * -1 * var(--lift, 0)))
            translate(calc(var(--fx, 0) * 1px), calc(var(--fy, 0) * 1px))
            translateZ(calc(var(--lift, 0) * 560px))
            scale(calc(1 - 0.16 * var(--lift, 0)));
        }
        /* Slabs are SOLID, depth reads through brightness and saturation,
           never through see-through planes. */
        .af-arch-skin {
          opacity: 1;
          filter:
            brightness(calc(1 - 0.52 * var(--dim, 0)))
            saturate(calc(1 - 0.55 * var(--dim, 0)))
            blur(calc(var(--dim, 0) * 0.8px));
          box-shadow: 0 calc(var(--lift, 0) * 18px) calc(var(--lift, 0) * 44px) rgb(0 0 0 / calc(var(--lift, 0) * var(--shadowa, 0.45)));
        }
        /* Chips exist only on the card facing you; tilted slabs stay clean. */
        .af-arch-chips { opacity: calc(var(--lift, 0) * var(--lift, 0)); }
        .af-arch:not([data-enhanced]) .af-arch-chips { opacity: 1; }
        .af-arch [data-arch-layer]::after {
          content: ""; position: absolute; inset: 4% 6%;
          transform: translateZ(-1px);
          background: radial-gradient(closest-side, rgb(0 0 0 / 0.30), transparent 72%);
          opacity: calc(var(--explode, 0) * (1 - var(--dim, 0) * 0.5));
          filter: blur(calc(10px + var(--dim, 0) * 6px));
          pointer-events: none;
        }
        .af-arch-beat { grid-area: 1 / 1; opacity: 0; transform: translateY(12px);
          transition: opacity .35s var(--ease-out), transform .35s var(--ease-out); pointer-events: none; }
        .af-arch-beat[data-active] { opacity: 1; transform: none; transition-delay: .08s; pointer-events: auto; }
        .af-arch-note { opacity: 0; transform: translateY(6px); transition: opacity .4s var(--ease-out), transform .4s var(--ease-out); }
        .af-arch-note[data-on] { opacity: 1; transform: none; }

        /* ── vignette grammar ── */
        .af-vg-label { font: 600 11px var(--font-plex, sans-serif); fill: var(--color-fg); }
        .af-vg-micro { font: 500 9.5px var(--font-plex-mono, monospace); fill: var(--color-faint); }
        .af-vg-tag { font: 700 7.5px var(--font-plex-mono, monospace); fill: var(--color-surface); }
        .af-vg-code { font: 500 13px var(--font-plex-mono, monospace); fill: var(--color-fg); }
        .af-vg [class*="af-vg-"] { animation-play-state: paused; }
        [data-vg] [class*="af-vg-"] { animation-play-state: running; }
        .af-vg-draw   { animation: afvg-draw 2.4s var(--ease-out) infinite; }
        .af-vg-pop    { animation: afvg-pop 2.4s var(--ease-out) infinite; transform-origin: center; }
        .af-vg-late   { animation: afvg-late 4.8s ease infinite; }
        .af-vg-stage  { animation: none; }
        .af-vg-stagefill { animation: afvg-fill 4.2s ease infinite; }
        .af-vg-row    { opacity: 0; animation: afvg-row 4.8s ease infinite; }
        .af-vg-bar    { animation: afvg-bar 4.8s var(--ease-out) infinite; }
        .af-vg-run    { animation: afvg-dashrun 1.1s linear infinite; }
        .af-vg-kill   { opacity: 0; animation: afvg-late 4.8s ease infinite; }
        .af-vg-meter  { width: 0; animation: afvg-meter 4.8s var(--ease-out) infinite; }
        .af-vg-slide  { animation: afvg-slide 4.2s ease infinite; }
        .af-vg-wall   { opacity: .35; animation: afvg-wall 4.2s ease infinite; }
        .af-vg-out    { offset-path: path("M88 68 H 212"); animation: afvg-travel 4.6s ease infinite; }
        .af-vg-back   { offset-path: path("M212 82 H 88"); animation: afvg-travel 4.6s ease infinite; animation-delay: 2.3s; }
        .af-vg-route  { offset-path: path("M84 82 C 120 100, 150 106, 190 106"); animation: afvg-travel 3.2s ease infinite; }
        .af-vg-dot { opacity: 0; animation: afvg-dot 4.6s steps(1, end) infinite; }
        .af-vg-caret { opacity: 0; animation: afvg-caret 1s steps(1, end) infinite; }
        [data-vg] .af-vg-caret { opacity: 1; animation: afvg-caret 1.05s steps(1, end) infinite; }
        .af-vg-secret { animation: afvg-secret 4.2s ease infinite; }
        .af-vg-masked { opacity: 0; animation: afvg-masked 4.2s ease infinite; }
        @keyframes afvg-draw   { 0% { stroke-dashoffset: 220; } 45%, 100% { stroke-dashoffset: 0; } }
        @keyframes afvg-pop    { 0%, 30% { opacity: 0; transform: scale(.92); } 55%, 100% { opacity: 1; transform: scale(1); } }
        @keyframes afvg-late   { 0%, 55% { opacity: 0; } 75%, 100% { opacity: 1; } }
        @keyframes afvg-fill   { 0%, 12% { opacity: 0; } 24%, 100% { opacity: 1; } }
        @keyframes afvg-row    { 0%, 8% { opacity: 0; } 18%, 100% { opacity: 1; } }
        @keyframes afvg-bar    { 0%, 8% { transform: scaleX(0); } 30%, 100% { transform: scaleX(1); } }
        @keyframes afvg-dashrun{ to { stroke-dashoffset: -10; } }
        @keyframes afvg-meter  { 0% { width: 0; } 60%, 100% { width: 118px; } }
        @keyframes afvg-slide  { 0%, 10% { transform: translateX(0); } 45% { transform: translateX(64px); } 60% { transform: translateX(52px); } 100% { transform: translateX(52px); } }
        @keyframes afvg-wall   { 40% { opacity: .35; } 50% { opacity: 1; } 65%, 100% { opacity: .5; } }
        @keyframes afvg-travel { 0% { offset-distance: 0%; opacity: 0; } 10% { opacity: 1; } 45% { offset-distance: 100%; opacity: 1; } 50%, 100% { offset-distance: 100%; opacity: 0; } }
        @keyframes afvg-dot { 0% { opacity: 0; } 8% { opacity: 1; } 88% { opacity: 1; } 94%, 100% { opacity: 0; } }
        @keyframes afvg-caret { 0%, 49% { opacity: 1; } 50%, 100% { opacity: 0; } }
        @keyframes afvg-secret { 0%, 40% { opacity: 1; } 55%, 100% { opacity: 0; } }
        @keyframes afvg-masked { 0%, 40% { opacity: 0; } 55%, 100% { opacity: 1; } }
        @media (prefers-reduced-motion: reduce) {
          .af-vg [class*="af-vg-"] { animation: none !important; opacity: 1 !important; }
        }

        @media (max-width: 767px) {
          .af-arch { --tiltX: 0deg; --tiltZ: 0deg; }
          .af-arch-skin { filter: none !important; }
        }
        /* Short viewports get compact beats so nothing clips inside the
           100dvh stage. */
        @media (max-height: 880px) {
          .af-arch h2 { font-size: clamp(24px, 3vw, 34px) !important; }
          .af-arch h3 { font-size: clamp(20px, 2.4vw, 28px) !important; }
          .af-arch .af-vg { max-width: 360px; }
          .af-arch-beat { gap: 0.6rem; }
        }
        .af-arch:not([data-enhanced]) .af-arch-beat { opacity: 1; transform: none; position: static; pointer-events: auto; }
        .af-arch:not([data-enhanced]) .af-arch-copy { display: flex; flex-direction: column; gap: 2.5rem; }
        .af-arch:not([data-enhanced]) .af-arch-stage > div { align-items: start; }
        .af-arch:not([data-enhanced]) .af-arch-viewport { position: sticky; top: 4.5rem; }
        @media (max-width: 767px) {
          .af-arch:not([data-enhanced]) .af-arch-viewport { position: static; }
        }
      `}</style>

      <div className="af-arch-stage flex flex-col justify-center px-5 py-14 sm:px-8 lg:px-12 2xl:px-20">
        <div className="grid w-full grid-cols-1 items-center gap-10 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-16">
          {/* ── The deck ── */}
          <div className="af-arch-viewport relative mx-auto w-full max-w-[600px]">
            <div className="af-arch-assembly flex flex-col gap-1.5">
              {LAYERS.map((layer, i) => {
                return (
                  <div
                    key={layer.id}
                    data-arch-layer
                    className="relative"
                    style={{ "--zbase": ((N - 1) / 2 - i) * 60 } as React.CSSProperties}
                  >
                    <div
                      className="af-arch-skin relative flex items-center gap-2.5 rounded-md border px-3.5 py-3"
                      style={{
                        // Truly solid: the slab IS the layer's colour, edge to
                        // edge, with contrasting type, the slide's own grammar.
                        background: `color-mix(in srgb, var(${layer.token}) var(--slabmix, 100%), var(--slabbase, #131211))`,
                        borderColor: `color-mix(in srgb, var(${layer.token}) var(--slabmix, 100%), var(--slabbase, #131211))`,
                        color: "var(--color-fg)",
                      }}
                    >
                      <span className="w-[112px] shrink-0 text-[12.5px] leading-[1.25] font-semibold capitalize">
                        {layer.id === "workplane" ? "Work plane" : layer.id}
                      </span>
                      <span className="af-arch-chips flex min-w-0 grow flex-wrap gap-1">
                        {layer.chips.map((c) => (
                          <span
                            key={c}
                            className="rounded-sm px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap"
                            style={{
                              background: "color-mix(in srgb, var(--color-fg) 14%, transparent)",
                              color: "var(--color-fg)",
                            }}
                          >
                            {c}
                          </span>
                        ))}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Merge annotations: the cold open, made readable. */}
            <div className="pointer-events-none absolute inset-0">
              {[
                { label: "journal entry no. 29", x: "0%", y: "30%" },
                { label: "approval recorded by reviewer", x: "56%", y: "12%" },
                { label: "classified on entry", x: "4%", y: "70%" },
                { label: "usage recorded", x: "60%", y: "52%" },
                { label: "routed to local model", x: "28%", y: "92%" },
              ].map((a) => (
                <span
                  key={a.label}
                  data-on={beat === N || undefined}
                  className="af-arch-note absolute rounded-sm border border-ok-line bg-ok-bg px-1.5 py-0.5 font-mono text-[9.5px] text-ok"
                  style={{ left: a.x, top: a.y }}
                >
                  {a.label}
                </span>
              ))}
            </div>
          </div>

          {/* ── The story column ── */}
          <div className="af-arch-copy grid">
            <div className="af-arch-beat flex flex-col gap-4" data-active={beat === -1 || undefined}>
              <h2 className="max-w-[16ch] text-[clamp(30px,3.9vw,50px)] leading-[1.06] font-semibold tracking-[-0.03em]">
                {OPENING.headline}
              </h2>
              <p className="max-w-[50ch] text-[16.5px] leading-[1.6] text-mist">{OPENING.support}</p>
              <p className="max-w-[46ch] border-l-2 border-line-strong pl-3 text-[14.5px] leading-[1.6] text-dim">
                <span className="font-semibold text-fg">{TURN.headline}</span> {TURN.support}
              </p>
              {enhanced && (
                <span className="flex items-center gap-2 pt-1 text-[11.5px] text-faint">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 4v14M6 12l6 6 6-6" />
                  </svg>
                  {OPENING.cue}
                </span>
              )}
            </div>

            {LAYERS.map((layer, i) => (
              <div key={layer.id} className="af-arch-beat flex flex-col gap-3.5" data-active={beat === i || undefined}>
                <span className="flex items-center gap-2.5">
                  <Mono className="text-[11.5px] text-ghost">
                    {String(i + 1).padStart(2, "0")} / {String(N).padStart(2, "0")}
                  </Mono>
                  <span className="text-[13px] font-medium text-faint">{layer.question}</span>
                </span>
                <h3 className="max-w-[18ch] text-[clamp(26px,3.2vw,42px)] leading-[1.1] font-semibold tracking-[-0.025em]">
                  {layer.headline}
                </h3>
                <p className="max-w-[54ch] text-[15.5px] leading-[1.65] text-mist">{layer.support}</p>
                <Vignette layer={layer} active={enhanced ? beat === i : true} />
              </div>
            ))}

            <div className="af-arch-beat flex flex-col gap-4" data-active={beat === N || undefined}>
              <h2 className="max-w-[16ch] text-[clamp(30px,3.9vw,50px)] leading-[1.06] font-semibold tracking-[-0.03em]">
                {MERGE.headline}
              </h2>
              <p className="max-w-[50ch] text-[16.5px] leading-[1.6] text-mist">{MERGE.support}</p>
              <p className="pt-2 text-[23px] font-semibold tracking-[-0.02em] text-fg">{MERGE.final}</p>
              <p className="text-[13px] text-dim">{MERGE.finalSupport}</p>
            </div>

            {enhanced && (
              <div className="pointer-events-none col-start-1 row-start-1 -mt-12 flex items-center gap-1.5 self-start">
                {[-1, ...LAYERS.map((_, i) => i), N].map((b) => (
                  <span
                    key={b}
                    className={`h-[3px] rounded-full transition-all duration-300 ${
                      beat === b ? "w-5 bg-fg" : "w-[10px] bg-line-strong"
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
