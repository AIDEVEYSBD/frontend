import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLockup } from "./brand";
import { NavIcon, type NavIconName } from "./nav-icons";
import { WorkFlow } from "./landing-flow";
import "./landing.css";

const WRAP = "mx-auto w-full max-w-[1240px] px-6 sm:px-10";
const PHOTO_SOURCE = "https://new.abb.com/news/detail/133078/abb-introduces-automation-extended-enabling-industrial-innovation-with-continuity";

function Rule() {
  return <span aria-hidden className="landing-rule block h-[3px] w-10 bg-brand" />;
}

function OpenConsole({ primary = false, size = "lg" }: { primary?: boolean; size?: "sm" | "lg" }) {
  return (
    <Link href="/overview" className={`landing-action focusable inline-flex w-fit shrink-0 items-center justify-center gap-2.5 rounded-sm font-medium whitespace-nowrap transition-[filter] hover:brightness-110 ${size === "lg" ? "min-h-12 px-6 text-[15px]" : "min-h-11 px-3 sm:px-4 text-[13px]"} ${primary ? "bg-brand text-on-brand" : "bg-ink text-on-ink"}`}>
      Open console <NavIcon name="arrow-right" size={16} />
    </Link>
  );
}

function Head({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div data-reveal className="grid gap-x-12 gap-y-6 lg:grid-cols-2 lg:items-end">
      <div className="flex flex-col gap-6">
        <Rule />
        <h2 className="max-w-[21ch] text-[32px] leading-[1.1] font-semibold tracking-[-0.03em] text-fg sm:text-[42px]">{title}</h2>
      </div>
      <p className="max-w-[58ch] text-[16px] leading-[1.7] text-dim">{children}</p>
    </div>
  );
}

export function LandingHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur-md">
      <a href="#main-content" className="focusable sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-4 focus:z-50 focus:bg-surface focus:p-4">Skip to content</a>
      <div className={`${WRAP} flex h-20 items-center justify-between gap-3`}>
        <Link href="/" aria-label="ABB Agent Factory home" className="focusable min-w-0 rounded-sm"><BrandLockup height={22} /></Link>
        <nav aria-label="On this page" className="hidden items-center gap-7 text-[13px] font-medium text-dim lg:flex">
          <a className="focusable py-3 hover:text-fg" href="#workloads">Security workloads</a>
          <a className="focusable py-3 hover:text-fg" href="#controls">Platform controls</a>
          <a className="focusable py-3 hover:text-fg" href="#passage">How it works</a>
        </nav>
        <OpenConsole size="sm" />
      </div>
    </header>
  );
}

export function Hero() {
  return (
    <section className="bg-surface">
      <div className={`${WRAP} grid gap-10 pt-12 pb-12 sm:pt-16 lg:grid-cols-[1.12fr_1fr] lg:items-center lg:gap-12 lg:pt-20 lg:pb-20`}>
        <div data-reveal>
          <div className="flex items-center gap-4"><Rule /><p className="text-[12px] font-semibold tracking-[0.12em] text-dim uppercase">AI for security operations</p></div>
          <h1 className="mt-8 text-[44px] leading-[1.04] font-semibold tracking-[-0.045em] text-fg sm:text-[62px] lg:text-[68px]">
            AI-powered security.<br /><span className="text-dim">Human-led control.</span>
          </h1>
          <p className="mt-7 max-w-[47ch] text-[17px] leading-[1.65] text-dim">
            Bring AI to security operations with clear accountability. Agent Factory brings four security workloads together, with defined approvals, controlled execution and traceable evidence.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-5">
            <OpenConsole primary />
            <a href="#workloads" className="landing-action focusable inline-flex min-h-11 items-center gap-2 text-[14px] font-medium text-fg">Explore workloads <NavIcon name="arrow-right" size={16} /></a>
          </div>
        </div>
        <figure data-reveal data-reveal-delay="120" className="min-w-0">
          <div className="landing-photo relative aspect-[5/4] overflow-hidden bg-canvas lg:aspect-[4/5]">
            <Image src="/images/landing/control-room.webp" alt="Two ABB specialists reviewing information in an industrial control room" fill sizes="(min-width: 1240px) 500px, (min-width: 1024px) 44vw, (min-width: 640px) calc(100vw - 80px), calc(100vw - 48px)" loading="eager" fetchPriority="high" className="object-cover object-[58%_center]" />
            <span aria-hidden className="absolute bottom-0 left-0 h-1 w-20 bg-brand" />
          </div>
          <figcaption className="mt-3 flex justify-between gap-4 text-[11px] text-faint"><span>Industrial expertise. Digital capability.</span><a href={PHOTO_SOURCE} className="focusable underline-offset-4 hover:underline">Image: ABB</a></figcaption>
        </figure>
      </div>
      <div className="border-t border-line">
        <div className={`${WRAP} grid gap-6 py-7 sm:grid-cols-3 sm:gap-8`}>
          {[
            ["Defined scope", "Approved data, tools and targets."],
            ["Human oversight", "Decisions at defined approval gates."],
            ["Traceable execution", "Evidence connected to every finding."],
          ].map(([title, text], i) => <div key={title} data-reveal data-reveal-delay={i * 80} className="flex gap-4"><span aria-hidden className="pt-1 font-mono text-[11px] text-faint">0{i + 1}</span><div><h2 className="text-[15px] font-semibold text-fg">{title}</h2><p className="mt-1 text-[13px] leading-relaxed text-dim">{text}</p></div></div>)}
        </div>
      </div>
    </section>
  );
}

interface Workload { name: string; icon: NavIconName; summary: string; input: string; review: string; output: string }
const WORKLOADS: Workload[] = [
  { name: "Static code analysis", icon: "file-code", summary: "Identify vulnerabilities in source code and assess potential attack paths.", input: "Source code submitted for analysis.", review: "Validate findings and resolve false positives.", output: "Prioritised findings with remediation guidance." },
  { name: "Penetration testing", icon: "crosshair", summary: "Assess security exposure within an explicitly approved scope.", input: "Rules of engagement, approved targets and test windows.", review: "Approve scope and methods before execution.", output: "Risk-ranked findings with test evidence and retest guidance." },
  { name: "Firewall rule review", icon: "brick-wall", summary: "Understand effective policy and identify rules that introduce risk.", input: "Rule sets, network objects, NAT and topology exports.", review: "Route proposed changes to owners and security approvers.", output: "Targeted rule changes with rollback guidance." },
  { name: "Threat hunting", icon: "radar", summary: "Investigate suspicious activity using telemetry and threat intelligence.", input: "Offline datasets or approved live sources.", review: "Validate assessments before reporting.", output: "Evidence-linked assessments and investigation reports." },
];

export function Workloads() {
  return (
    <section id="workloads" className="border-t border-line bg-surface">
      <div className={`${WRAP} flex flex-col gap-12 py-20 lg:py-24`}>
        <Head title="Four workloads. One coordinated approach.">From code analysis to threat hunting, bring security assessments into a shared operating model. Define the scope, review the findings and retain the evidence in one place.</Head>
        <div className="grid gap-5 md:grid-cols-2">
          {WORKLOADS.map((w, i) => (
            <article key={w.name} data-reveal data-reveal-delay={i % 2 * 90} className="landing-workload flex flex-col border border-line p-6 sm:p-8">
              <div className="mb-7 flex items-center justify-between"><NavIcon name={w.icon} size={28} /><span aria-hidden className="font-mono text-[12px] text-faint">0{i + 1}</span></div>
              <h3 className="text-[24px] leading-tight font-semibold tracking-[-0.025em] text-fg">{w.name}</h3>
              <p className="mt-3 max-w-[44ch] text-[15px] leading-[1.65] text-dim">{w.summary}</p>
              <dl className="mt-7 flex flex-col gap-4 border-t border-line pt-6">
                {[["Inputs", w.input], ["Human oversight", w.review], ["Deliverables", w.output]].map(([label, text]) => <div key={label} className="grid gap-1 sm:grid-cols-[120px_1fr] sm:gap-4"><dt className="text-[12px] font-semibold text-fg">{label}</dt><dd className="text-[13px] leading-[1.6] text-dim">{text}</dd></div>)}
              </dl>
              <Link href="/workloads" aria-label={`Explore ${w.name.toLowerCase()}`} className="landing-action focusable mt-7 flex min-h-11 w-fit items-center gap-3 text-[13px] font-semibold text-fg">Explore workload <NavIcon name="arrow-right" size={16} /></Link>
            </article>
          ))}
        </div>
        <p className="-mt-5 text-[12px] leading-relaxed text-faint">Workload availability depends on your deployment. The console identifies services that are not yet connected.</p>
      </div>
    </section>
  );
}

interface Area {
  group: string;
  /** What the group is for, in one line. */
  line: string;
  pages: { href: string; label: string; what: string }[];
}

const AREAS: Area[] = [
  {
    group: "Operations",
    line: "Keep operations in view.",
    pages: [
      { href: "/overview", label: "Overview", what: "Monitor runs, expenditure and outstanding actions in one view." },
      { href: "/runs", label: "Runs", what: "Follow execution, review limits and inspect individual steps." },
      { href: "/approvals", label: "Approvals", what: "Review and authorise actions at defined approval gates." },
    ],
  },
  {
    group: "Agents",
    line: "Configure agents with clear boundaries.",
    pages: [
      { href: "/workloads", label: "Workloads", what: "Configure security workloads and access their findings and reports." },
      { href: "/agents", label: "Agents", what: "Define execution steps, approval roles and resource limits." },
      { href: "/evals", label: "Evaluations", what: "Run benchmark cases against an agent version before release: each case is a new run." },
      { href: "/acceptance", label: "Acceptance", what: "Review acceptance criteria, results and accountable sign-off." },
    ],
  },
  {
    group: "Identity",
    line: "Assign access. Establish accountability.",
    pages: [
      { href: "/iam", label: "People and agents", what: "Manage role-based access for people and agents." },
      { href: "/sessions", label: "Sessions", what: "See every live connection, who is behind it, and end it when needed." },
      { href: "/authorization", label: "Authorization servers", what: "Decide which outside sign-in services the platform trusts." },
    ],
  },
  {
    group: "Connections",
    line: "Connect approved tools and information.",
    pages: [
      { href: "/configuration", label: "Configuration", what: "Manage approved tools, step-level permissions and model routing." },
      { href: "/knowledge", label: "Knowledge", what: "Give agents access to reviewed and approved knowledge sources." },
      { href: "/datasets", label: "Datasets", what: "Manage the uploads and approved datasets used by each workload." },
    ],
  },
  {
    group: "Security and Policy",
    line: "Apply policy. Retain the evidence.",
    pages: [
      { href: "/guardrails", label: "Controls", what: "Inspect the controls enforced independently of the model." },
      { href: "/policy", label: "Policy", what: "Review and independently approve policy changes before application." },
      { href: "/findings", label: "Findings", what: "Review findings alongside supporting evidence and execution records." },
      { href: "/evidence", label: "Evidence", what: "Access evidence packs and run verification records for assessment." },
    ],
  },
  {
    group: "Observability",
    line: "Understand activity and resource use.",
    pages: [
      { href: "/finops", label: "Costs", what: "Track model expenditure by person, team, agent and step against budgets." },
      { href: "/explore", label: "Explore", what: "Filter and read every recorded tool call, agent action and security event." },
      { href: "/dashboards", label: "Dashboards", what: "Read security posture, cost and workload results on fixed boards." },
    ],
  },
];

export function Controls() {
  return (
    <section id="controls" className="border-t border-line bg-canvas">
      <div className={`${WRAP} flex flex-col gap-12 py-20 lg:py-24`}>
        <Head title="Control at every stage.">Give teams a common framework for operating AI agents. Manage access, set execution limits and review decisions through controls enforced independently of the model.</Head>
        <div data-reveal className="grid overflow-hidden border border-line bg-surface lg:grid-cols-2">
          <figure className="flex min-w-0 flex-col">
            <div className="landing-photo relative min-h-60 grow overflow-hidden sm:min-h-72"><Image src="/images/landing/industrial-operations.webp" alt="ABB illustration of an industrial automation environment with connected control systems" fill sizes="(min-width: 1240px) 580px, (min-width: 1024px) 46vw, 100vw" className="object-cover" /></div>
            <figcaption className="px-5 py-3 text-[11px] text-faint">Industrial automation environment. <a href={PHOTO_SOURCE} className="focusable underline-offset-4 hover:underline">Image: ABB</a></figcaption>
          </figure>
          <div className="flex flex-col justify-center gap-5 p-7 sm:p-10">
            <Rule /><h3 className="max-w-[22ch] text-[28px] leading-[1.15] font-semibold tracking-[-0.025em] text-fg">Empower your people.<br />Keep decisions accountable.</h3>
            <p className="max-w-[48ch] text-[15px] leading-[1.7] text-dim">AI supports the assessment. Your teams define the scope, approve consequential actions and review the results. Budgets, permissions and stop controls establish the boundaries for execution.</p>
            <Link href="/approvals" className="landing-action focusable inline-flex min-h-11 w-fit items-center gap-3 text-[14px] font-semibold text-fg">Explore approvals <NavIcon name="arrow-right" size={16} /></Link>
          </div>
        </div>
        <div className="grid gap-x-10 gap-y-12 md:grid-cols-2 lg:grid-cols-3">
          {AREAS.map((a, i) => (
            <div key={a.group} data-reveal data-reveal-delay={i % 3 * 70} className="border-t-2 border-fg pt-5">
              <h3 className="text-[19px] font-semibold tracking-[-0.015em] text-fg">{a.group}</h3>
              <p className="mt-2 mb-5 text-[13px] leading-relaxed text-dim">{a.line}</p>
              <ul>{a.pages.map((p) => <li key={p.href} className="border-t border-line"><Link href={p.href} className="landing-action focusable group flex flex-col gap-1.5 rounded-sm py-4"><span className="flex items-center justify-between gap-2 text-[14px] font-medium text-fg"><span className="underline-offset-4 group-hover:underline">{p.label}</span><NavIcon name="arrow-right" size={14} /></span><span className="text-[13px] leading-[1.6] text-dim">{p.what}</span></Link></li>)}</ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Passage() {
  return (
    <section id="passage" className="border-t border-line bg-surface">
      <div className={`${WRAP} flex flex-col gap-12 py-20 lg:py-24`}>
        <Head title="From assessment to action.">Follow a consistent process from the initial request to the final report. Defined approval gates keep people involved, while the execution journal preserves the record for review.</Head>
        <WorkFlow />
      </div>
    </section>
  );
}

export function Closing() {
  return (
    <section className="border-t border-line bg-canvas">
      <div data-reveal className={`${WRAP} flex flex-col gap-9 py-20 lg:flex-row lg:items-end lg:justify-between lg:gap-16 lg:py-24`}>
        <div className="flex flex-col gap-6"><Rule /><h2 className="max-w-[23ch] text-[36px] leading-[1.1] font-semibold tracking-[-0.035em] text-fg sm:text-[48px]">Bring clarity to your security operations.</h2><p className="max-w-[48ch] text-[17px] leading-[1.65] text-dim">Access your workloads, review decisions and follow the evidence. All through one console.</p></div>
        <OpenConsole primary />
      </div>
    </section>
  );
}

export function LandingFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className={`${WRAP} flex flex-col gap-10 py-12`}>
        <div className="flex flex-wrap items-center justify-between gap-5"><BrandLockup height={24} /><p className="text-[13px] text-dim">AI-powered security. Human-led control.</p></div>
        <nav aria-label="The console" className="grid grid-cols-2 gap-x-8 gap-y-9 border-t border-line pt-9 sm:grid-cols-3 lg:grid-cols-6">
          {AREAS.map((a) => <div key={a.group} className="flex flex-col gap-3"><span className="text-[12px] font-semibold text-fg">{a.group}</span>{a.pages.map((p) => <Link key={p.href} href={p.href} className="focusable w-fit rounded-sm py-1 text-[13px] text-dim underline-offset-4 hover:text-fg hover:underline">{p.label}</Link>)}</div>)}
        </nav>
      </div>
    </footer>
  );
}
