"use client";

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Button, Mono, Status, Tag } from "./ui";
import { CAT } from "./charts";
import { BrandMark } from "./brand";
import Image from "next/image";

/* ═══════════════════ In-view hook ═══════════════════ */

function useInView<T extends HTMLElement>(once = true) {
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
          if (once) io.disconnect();
        } else if (!once) setSeen(false);
      },
      { threshold: 0.25, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [once]);

  return { ref, seen };
}

/**
 * Reduced motion is read for effects only. Branching render output on it
 * desynchronises server and client HTML, and React responds by throwing
 * the subtree away, taking its event handlers with it.
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

/* ═══════════════════ Count-up statistic ═══════════════════ */

export function CountUp({
  to,
  suffix = "",
  prefix = "",
  duration = 900,
  decimals = 0,
}: {
  to: number;
  suffix?: string;
  prefix?: string;
  duration?: number;
  decimals?: number;
}) {
  const { ref, seen } = useInView<HTMLSpanElement>();
  const reduce = useReducedMotion();
  /**
   * Renders the true figure until the animation is armed. A statistic
   * that reads 0 because scripting has not run yet is worse than one
   * that never animates, it is wrong rather than merely static.
   */
  const [armed, setArmed] = useState(false);
  const [v, setV] = useState(0);

  useEffect(() => {
    if (!seen || reduce) return;
    let raf = 0;
    let t0 = 0;
    const tick = (now: number) => {
      if (!t0) {
        t0 = now;
        setArmed(true);
      }
      const p = Math.min(1, (now - t0) / duration);
      // ease-out-cubic: fast commitment, gentle settle
      setV(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [seen, reduce, to, duration]);

  return (
    <span ref={ref} className="tnum">
      {prefix}
      {(armed ? v : to).toFixed(decimals)}
      {suffix}
    </span>
  );
}

/* ═══════════════════ Reveal ═══════════════════ */

/**
 * Ships visible and is hidden only once scripting confirms it can
 * animate, applied before paint, so there is no flash. Content that
 * depends on JS to become visible is content that disappears when JS
 * fails.
 */
export function Rise({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const [armed, setArmed] = useState(false);
  const [seen, setSeen] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || reduce || typeof IntersectionObserver === "undefined") return;

    setArmed(true);
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduce]);

  return (
    <div
      ref={ref}
      className={className}
      style={
        armed
          ? {
              opacity: seen ? 1 : 0,
              transform: seen ? "none" : "translateY(14px)",
              transition: `opacity 500ms var(--ease-out) ${delay}ms, transform 500ms var(--ease-out) ${delay}ms`,
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

/* ═══════════════════ Scroll chrome ═══════════════════ */

/** Reading progress for the whole document, one hairline, no chrome. */
export function ScrollProgress() {
  const [p, setP] = useState(0);

  useEffect(() => {
    let frame = 0;
    const on = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        setP(max > 0 ? Math.min(1, window.scrollY / max) : 0);
      });
    };
    window.addEventListener("scroll", on, { passive: true });
    on();
    return () => {
      window.removeEventListener("scroll", on);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-px bg-transparent">
      <div
        className="h-full origin-left bg-fg/70"
        style={{ transform: `scaleX(${p})`, transition: "transform 80ms linear" }}
      />
    </div>
  );
}

/**
 * Holds a section in view while the reader works through it.
 *
 * This is a sticky pin, not scroll-jacking: scroll direction, velocity
 * and the scrollbar all behave normally. The section simply stays put
 * for a defined distance, then releases and the page carries on.
 */
export function Pin({
  children,
  height = "190vh",
}: {
  children: React.ReactNode;
  height?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [p, setP] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const on = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const r = el.getBoundingClientRect();
        const span = r.height - window.innerHeight;
        setP(span > 0 ? Math.max(0, Math.min(1, -r.top / span)) : 0);
      });
    };
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    on();
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div ref={ref} style={{ height }} className="relative">
      <div className="sticky top-0 flex min-h-screen flex-col justify-center py-10">
        {children}
        {/* How much of the pin is left, so the hold never feels like a stall. */}
        <div className="mt-5 flex items-center gap-3">
          <span className="h-0.5 grow overflow-hidden rounded-[1px] bg-line">
            <span
              className="block h-full origin-left bg-fg/60"
              style={{ transform: `scaleX(${p})` }}
            />
          </span>
          <span className="shrink-0 text-[10.5px] text-faint">
            {p > 0.92 ? "continue scrolling" : "scroll to explore"}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Reveals children one after another rather than as a block. */
export function Stagger({
  children,
  step = 70,
  className = "",
}: {
  children: React.ReactNode;
  step?: number;
  className?: string;
}) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <div className={className}>
      {items.map((c, i) => (
        <Rise key={i} delay={i * step}>
          {c}
        </Rise>
      ))}
    </div>
  );
}

/* ═══════════════════ Live workflow canvas ═══════════════════ */

const NODES = [
  { id: "intake", label: "Intake", kind: "extraction", c: 1, x: 0, y: 0 },
  { id: "extract", label: "Extract", kind: "extraction", c: 1, x: 1, y: 0 },
  { id: "prior", label: "History", kind: "research", c: 2, x: 1, y: 1 },
  { id: "validate", label: "Validate", kind: "decision", c: 5, x: 2, y: 0 },
  { id: "draft", label: "Draft", kind: "drafting", c: 3, x: 3, y: 0 },
  { id: "approve", label: "Approve", kind: "gate", c: 8, x: 3, y: 1 },
];

const EDGES: [number, number][] = [
  [0, 1],
  [1, 2],
  [1, 3],
  [2, 3],
  [3, 4],
  [4, 5],
];

const ORDER = [0, 1, 2, 3, 4, 5];

/**
 * The hero canvas actually runs. Nodes light in dependency order and the
 * edge feeding the active node carries a travelling dash, the product's
 * core idea (work moving through a graph) shown rather than described.
 */
export function LiveCanvas({ interactive = true }: { interactive?: boolean }) {
  const { ref, seen } = useInView<HTMLDivElement>(false);
  const reduce = useReducedMotion();
  const [step, setStep] = useState(-1);
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    if (reduce) {
      // Show the finished graph instead of looping.
      const f = requestAnimationFrame(() => setStep(ORDER.length - 1));
      return () => cancelAnimationFrame(f);
    }
    if (!seen) return;
    let i = -1;
    const id = setInterval(() => {
      i = i + 1 > ORDER.length ? 0 : i + 1;
      setStep(i);
    }, 900);
    return () => clearInterval(id);
  }, [seen, reduce]);

  const COLS = 4;
  const ROWS = 2;
  const cw = 100 / COLS;
  const rh = 100 / ROWS;
  const cx = (n: { x: number }) => n.x * cw + cw / 2;
  const cy = (n: { y: number }) => n.y * rh + rh / 2;

  const state = (i: number) => (step > i ? "done" : step === i ? "active" : "idle");

  return (
    <div
      ref={ref}
      className="relative overflow-hidden rounded-lg border border-line bg-surface elev-2"
    >
      <div className="flex items-center gap-2 border-b border-line bg-raise/60 px-3 py-2">
        <span className="text-[12px] font-medium">DLP Triage</span>
        <Tag tone="ok" solid>
          deployed
        </Tag>
        <div className="grow" />
        <Status tone="run">{step >= 0 && step < ORDER.length ? "running" : "idle"}</Status>
      </div>

      <div className="relative aspect-[16/7] w-full bg-[radial-gradient(circle_at_1px_1px,var(--t-line-strong)_1px,transparent_0)] [background-size:16px_16px]">
        <svg
          className="absolute inset-0 size-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          {EDGES.map(([a, b]) => {
            const A = NODES[a];
            const B = NODES[b];
            const x1 = cx(A) + cw * 0.34;
            const y1 = cy(A);
            const x2 = cx(B) - cw * 0.34;
            const y2 = cy(B);
            const m = x1 + (x2 - x1) / 2;
            const d = `M ${x1} ${y1} C ${m} ${y1}, ${m} ${y2}, ${x2} ${y2}`;
            const flowing = step === b;
            return (
              <g key={`${a}-${b}`}>
                <path
                  d={d}
                  fill="none"
                  stroke={step > a ? "var(--t-line-strong)" : "var(--t-line)"}
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
                {flowing && (
                  <path
                    d={d}
                    fill="none"
                    stroke="var(--t-run)"
                    strokeWidth="2"
                    strokeDasharray="5 8"
                    vectorEffect="non-scaling-stroke"
                    className="af-flow"
                  />
                )}
              </g>
            );
          })}
        </svg>

        {NODES.map((n, i) => {
          const st = state(i);
          const lit = hover === n.id;
          return (
            <div
              key={n.id}
              onMouseEnter={() => interactive && setHover(n.id)}
              onMouseLeave={() => interactive && setHover(null)}
              className={`absolute flex -translate-x-1/2 -translate-y-1/2 flex-col justify-center gap-0.5 rounded-md border bg-surface px-2 py-1.5 transition-all duration-300 ease-[var(--ease-out)] ${
                st === "active"
                  ? "border-run elev-2"
                  : st === "done"
                    ? "border-line elev-1"
                    : "border-dashed border-line"
              } ${lit ? "scale-[1.04] elev-2" : ""}`}
              style={{ left: `${cx(n)}%`, top: `${cy(n)}%`, width: `${cw * 0.68}%` }}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="size-2 shrink-0 rounded-[2px] transition-opacity duration-300"
                  style={{ background: CAT[n.c], opacity: st === "idle" ? 0.35 : 1 }}
                />
                <span
                  className={`truncate text-[11px] font-medium transition-colors ${
                    st === "idle" ? "text-faint" : "text-fg"
                  }`}
                >
                  {n.label}
                </span>
              </div>
              <span className="truncate text-[9.5px] text-faint">{n.kind}</span>

              {st === "active" && (
                <span className="absolute inset-x-0 -bottom-px h-0.5 overflow-hidden rounded-b-md">
                  <span className="af-node-fill block h-full bg-run" />
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════ Builder switch ═══════════════════ */

export function BuilderSwitch() {
  const [mode, setMode] = useState<"canvas" | "agentic">("canvas");

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-1 self-start rounded-md border border-line bg-raise p-px">
        {(
            [
              ["canvas", "Visual builder"],
              ["agentic", "Agentic builder"],
            ] as const
          ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setMode(k)}
            aria-pressed={mode === k}
            className={`focusable cursor-pointer rounded-sm px-3 py-1.5 text-[13px] transition-colors duration-150 ${
              mode === k
                ? "bg-surface font-semibold text-fg shadow-[var(--shadow-1)]"
                : "font-medium text-faint hover:text-dim"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:gap-14">
        <div className="flex flex-col gap-4">
          <h3 className="text-[19px] leading-[1.2] font-semibold tracking-[-0.02em]">
            {mode === "canvas"
              ? "Drag harnesses onto a canvas and wire the edges."
              : "Describe the process. Review the graph it proposes."}
          </h3>
          <p className="text-[14px] leading-[1.65] text-mist">
            {mode === "canvas"
              ? "For the engineer who already knows the process. Branching, parallel fan-out, retries and approval gates are node types, not code you write and maintain."
              : "For the partner who knows the outcome. Upload the SOP, paste the policy, or record an expert talking it through. It proposes the workflow, writes the eval cases, and shows its work before anything runs."}
          </p>
          <ul className="flex flex-col gap-2.5 border-t border-line pt-4">
            {(mode === "canvas"
              ? [
                  ["Typed edges", "A node cannot be wired to one it cannot feed"],
                  ["Config, not code", "Thresholds, retries and gates are fields"],
                  ["Versioned", "Every change is a diff you can review and roll back"],
                ]
              : [
                  ["Reads your documents", "SOPs, policies, transcripts, recordings"],
                  ["Writes its own evals", "Cases generated from the edge cases it found"],
                  ["Nothing runs unreviewed", "You approve the graph before it deploys"],
                ]
            ).map(([h, d]) => (
              <li key={h} className="flex gap-2.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-ok">
                  <path d="M4 13l5 5 11-13" />
                </svg>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[12.5px] font-medium">{h}</span>
                  <span className="text-[11.5px] text-faint">{d}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div key={mode} className="af-swap">
          {mode === "canvas" ? <LiveCanvas /> : <AgenticBuild />}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ Agentic build, typed out ═══════════════════ */

const PROMPT =
  "Here is our first-notice-of-loss SOP. Anything over £10,000 needs partner sign-off.";

export function AgenticBuild() {
  const { ref, seen } = useInView<HTMLDivElement>(false);
  const reduce = useReducedMotion();
  const [typed, setTyped] = useState(0);
  const [built, setBuilt] = useState(-1);

  useEffect(() => {
    if (reduce) {
      const f = requestAnimationFrame(() => {
        setTyped(PROMPT.length);
        setBuilt(NODES.length);
      });
      return () => cancelAnimationFrame(f);
    }
    if (!seen) return;

    const type = setInterval(() => {
      setTyped((n) => {
        if (n >= PROMPT.length) {
          clearInterval(type);
          return n;
        }
        return n + 2;
      });
    }, 26);

    const build = setTimeout(() => {
      let i = 0;
      const grow = setInterval(() => {
        i += 1;
        setBuilt(i);
        if (i > NODES.length) clearInterval(grow);
      }, 260);
    }, 1500);

    return () => {
      clearInterval(type);
      clearTimeout(build);
    };
  }, [seen, reduce]);

  return (
    <div
      ref={ref}
      className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-2"
    >
      <div className="flex items-center gap-2 border-b border-line bg-raise/60 px-3 py-2">
        <span className="text-[12px] font-medium">Build from a document</span>
        <div className="grow" />
        <Mono className="text-[10.5px] text-faint">
          {built >= NODES.length ? "ready" : "drafting"}
        </Mono>
      </div>

      <div className="flex min-h-[228px] flex-col gap-3 p-3">
        <div className="flex items-start gap-2.5">
          <span className="grid size-6 shrink-0 place-items-center rounded-sm border border-line bg-raise text-[9.5px] font-medium text-dim">
            SR
          </span>
          <p className="rounded-md border border-line bg-raise/50 px-2.5 py-2 text-[12px] leading-[1.55] text-mist">
            {PROMPT.slice(0, typed)}
            {typed < PROMPT.length && (
              <span className="af-caret ml-px inline-block h-[13px] w-[6px] translate-y-[2px] bg-run" />
            )}
          </p>
        </div>

        {built >= 0 && (
          <div className="af-swap flex flex-col gap-2 rounded-md border border-line bg-raise/30 p-2.5">
            <span className="text-[11.5px] text-dim">Proposed workflow</span>
            <div className="flex flex-wrap gap-1.5">
              {NODES.slice(0, built).map((n, i) => (
                <span
                  key={n.id}
                  className="af-chip inline-flex items-center gap-1.5 rounded-sm border border-line bg-surface px-1.5 py-1 text-[11px]"
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <span className="size-1.5 rounded-[2px]" style={{ background: CAT[n.c] }} />
                  {n.label}
                </span>
              ))}
            </div>
            {built >= NODES.length && (
              <div className="af-swap flex items-center gap-2 border-t border-line pt-2">
                <Status tone="ok">18 eval cases written</Status>
                <div className="grow" />
                <Button size="sm" variant="solid" tone="ink">
                  Review graph
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════ Integration explorer ═══════════════════ */

const GROUPS = [
  { name: "Detection & response", c: 1, items: ["Microsoft Sentinel", "Microsoft Defender", "Splunk", "CrowdStrike", "SentinelOne", "Palo Alto Networks", "Fortinet", "Cisco", "Check Point", "Trend Micro", "Sophos", "Darktrace", "Elastic", "Sumo Logic"] },
  { name: "Data protection & network", c: 4, items: ["Microsoft Purview", "Forcepoint", "Zscaler", "Netskope", "Proofpoint", "Mimecast", "Cloudflare", "Akamai", "F5"] },
  { name: "GRC & audit", c: 5, items: ["ServiceNow", "Archer", "OneTrust", "AuditBoard", "MetricStream", "LogicGate", "Vanta", "Drata", "Hyperproof", "Workiva", "Diligent", "Jira", "Confluence"] },
  { name: "Identity & secrets", c: 8, items: ["Okta", "Entra ID", "Ping Identity", "Auth0", "SailPoint", "Duo", "CyberArk", "BeyondTrust", "Delinea", "JumpCloud", "1Password", "HashiCorp Vault"] },
  { name: "Vulnerability & code", c: 2, items: ["Qualys", "Tenable", "Rapid7", "Wiz", "Snyk", "Veracode", "Semgrep", "Checkmarx", "Sonar", "JFrog", "Aqua Security", "Orca Security", "GitHub", "GitLab", "Bitbucket", "Azure DevOps"] },
  { name: "Third-party risk", c: 6, items: ["BitSight", "SecurityScorecard", "UpGuard", "RiskRecon", "Panorays"] },
  { name: "Business systems", c: 9, items: ["SAP", "Salesforce", "Oracle", "NetSuite", "Workday", "Dynamics 365", "Coupa", "Concur", "Stripe", "QuickBooks", "Xero", "Bloomberg", "Refinitiv", "Guidewire", "Duck Creek"] },
  { name: "Documents & data", c: 3, items: ["SharePoint", "OneDrive", "Google Drive", "Box", "Dropbox", "iManage", "DocuSign", "Adobe Sign", "Amazon S3", "Azure Blob", "Snowflake", "Databricks", "BigQuery", "Redshift", "Postgres", "SQL Server", "MongoDB", "Elasticsearch", "Kafka", "Fivetran", "dbt", "Tableau", "Power BI", "Notion"] },
  { name: "Cloud & DevOps", c: 7, items: ["Google Cloud", "Kubernetes", "Docker", "Terraform", "Ansible", "Jenkins", "CircleCI", "Datadog", "Grafana", "New Relic", "PagerDuty", "UiPath"] },
  { name: "Communication & ITSM", c: 0, items: ["Outlook", "Gmail", "Slack", "Teams", "Zoom", "Webex", "Zendesk", "Intercom", "Genesys", "Five9", "Twilio", "Asana", "Monday.com", "Smartsheet"] },
];

const ALL = GROUPS.flatMap((g) => g.items.map((i) => ({ name: i, group: g.name, c: g.c })));

export function IntegrationExplorer() {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<string | null>(null);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return ALL.filter(
      (i) =>
        (!group || i.group === group) && (!term || i.name.toLowerCase().includes(term)),
    );
  }, [q, group]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <svg
            className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-faint"
            width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search connectors"
            aria-label="Search connectors"
            className="h-9 w-[220px] rounded-md border border-line-strong bg-field pr-3 pl-8 text-[13px] text-fg placeholder:text-ghost focus:border-fg focus:ring-2 focus:ring-fg/15 focus:outline-none"
          />
        </div>

        <button
          onClick={() => setGroup(null)}
          className={`focusable cursor-pointer rounded-md border px-2.5 py-1.5 text-[12.5px] transition-colors ${
            group === null
              ? "border-transparent bg-ink font-medium text-on-ink"
              : "border-line text-dim hover:bg-raise"
          }`}
        >
          All
        </button>

        {GROUPS.map((g) => (
          <button
            key={g.name}
            onClick={() => setGroup(group === g.name ? null : g.name)}
            className={`focusable flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12.5px] transition-colors ${
              group === g.name
                ? "border-transparent bg-ink font-medium text-on-ink"
                : "border-line text-dim hover:bg-raise"
            }`}
          >
            <span className="size-2 rounded-[2px]" style={{ background: CAT[g.c] }} />
            {g.name}
          </button>
        ))}

        <div className="grow" />
        <Mono className="text-[11.5px] text-faint">
          {shown.length} of {ALL.length}
        </Mono>
      </div>

      {shown.length > 0 ? (
        // The wall keeps a constant visible height (about nine rows) and
        // scrolls vertically once the catalog outruns it. Tile width stays
        // responsive.
        <div className="max-h-[378px] overflow-y-auto overscroll-y-contain rounded-lg border border-line">
          <div className="grid grid-cols-2 gap-px bg-line sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            {shown.map((i) => (
              <div
                key={i.name}
                className="af-in flex items-center gap-2.5 bg-surface px-3 py-2.5 transition-colors hover:bg-raise"
              >
                <BrandMark name={i.name} size={16} />
                <span className="truncate text-[12.5px]">{i.name}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-line bg-surface px-3 py-8 text-center text-[12.5px] text-faint">
          No connector matches “{q}”. Additional connectors are released regularly, and
          the External-tool connector supports integration with API-enabled systems.
        </div>
      )}
    </div>
  );
}

/* ═══════════════════ Hero carousel ═══════════════════ */

const HERO_IMAGES = [
  "/media/hero-racks.jpg",
  "/media/hero-globe.jpg",
  "/media/hero-datacenter.jpg",
  "/media/hero-circuit.jpg",
  "/media/hero-city.jpg",
  "/media/hero-board.jpg",
];

export function HeroCarousel() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % HERO_IMAGES.length), 7000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <div className="absolute inset-0" aria-hidden>
        {HERO_IMAGES.map((src, i) => (
          <Image
            key={src}
            src={src}
            alt=""
            fill
            priority={i === 0}
            sizes="100vw"
            className={`object-cover [transition:opacity_1.6s_ease,transform_8s_linear] ${
              i === idx ? "scale-[1.06] opacity-100" : "scale-100 opacity-0"
            }`}
          />
        ))}
      </div>
      <div className="absolute right-5 bottom-6 z-10 flex gap-1.5 sm:right-8 lg:right-12 2xl:right-20">
        {HERO_IMAGES.map((src, i) => (
          <button
            key={src}
            onClick={() => setIdx(i)}
            aria-label={`Show image ${i + 1}`}
            className={`focusable h-1 cursor-pointer rounded-full transition-all ${
              i === idx ? "w-6 bg-fg" : "w-3 bg-fg/25 hover:bg-fg/50"
            }`}
          />
        ))}
      </div>
    </>
  );
}
