import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLockup } from "./brand";
import { NavIcon, type NavIconName } from "./nav-icons";
import { WorkFlow } from "./landing-flow";

/**
 * The page in front of the console.
 *
 * It says what the console is for and how work in it is controlled, and
 * nothing about what has happened in it: no figures, no results, no cases.
 * Every link goes to a page of the console. Drawn the way ABB draws a page:
 * white ground, black type, space, and red only for the wordmark, the rule
 * above a headline and the one action.
 */

const CONSOLE = "/overview";

/* ═══════════════════ Pieces ═══════════════════ */

const WRAP = "mx-auto w-full max-w-[1240px] px-6 sm:px-10";

/** The short red rule that sits above a headline. */
function Rule() {
  return <span aria-hidden className="block h-[3px] w-10 bg-brand" />;
}

/** The page's one action. `primary` is the red one; the header carries the ink one. */
function OpenConsole({ primary = false, size = "lg" }: { primary?: boolean; size?: "sm" | "lg" }) {
  return (
    <Link
      href={CONSOLE}
      className={`focusable inline-flex w-fit items-center justify-center rounded-sm font-medium whitespace-nowrap transition-[filter] duration-100 hover:brightness-[1.08] active:brightness-95 ${
        size === "lg" ? "h-12 gap-2.5 px-6 text-[15px]" : "h-9 gap-2 px-4 text-[13px]"
      } ${primary ? "bg-brand text-on-brand" : "bg-ink text-on-ink"}`}
    >
      Open console
      <NavIcon name="arrow-right" size={size === "lg" ? 16 : 14} />
    </Link>
  );
}

/** A section's headline on the left and what it introduces on the right. */
function Head({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid gap-x-10 gap-y-5 lg:grid-cols-12 lg:items-end">
      <div className="flex flex-col gap-6 lg:col-span-6">
        <Rule />
        <h2 className="max-w-[18ch] text-[30px] leading-[1.08] font-semibold tracking-[-0.028em] text-fg sm:text-[38px]">{title}</h2>
      </div>
      <p className="max-w-[58ch] text-[15.5px] leading-[1.6] text-dim lg:col-span-6">{children}</p>
    </div>
  );
}

/* ═══════════════════ Header ═══════════════════ */

export function LandingHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface">
      <div className={`${WRAP} flex h-16 items-center gap-4`}>
        <Link href="/" aria-label="Agent Factory" className="focusable rounded-sm">
          <BrandLockup height={17} />
        </Link>
        <span className="grow" />
        <OpenConsole size="sm" />
      </div>
    </header>
  );
}

/* ═══════════════════ Hero ═══════════════════ */

export function Hero() {
  return (
    <section className="bg-surface">
      <div className={`${WRAP} flex flex-col pt-20 pb-20 sm:pt-28 sm:pb-24 lg:pt-36 lg:pb-32`}>
        <Rule />
        <h1 className="mt-9 text-[42px] leading-[1.02] font-semibold tracking-[-0.035em] text-fg sm:text-[58px] lg:text-[76px]">
          <span className="block">Four security workloads.</span>
          <span className="block">One set of controls.</span>
        </h1>
        <p className="mt-9 max-w-[60ch] text-[17px] leading-[1.6] text-dim lg:text-[19px]">
          Agent Factory is the console for static code analysis, penetration testing, firewall rule review and threat hunting carried out by
          agents, each on a dataset a person hands over. Every one of them works behind the same controls: approval by named roles, limits
          enforced outside the model, and a journal of every decision that can be verified.
        </p>
        <div className="mt-11">
          <OpenConsole primary />
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════ The four workloads ═══════════════════ */

interface Workload {
  name: string;
  icon: NavIconName;
  /** What a person hands over. */
  given: string;
  /** What the agent does with it. */
  does: string;
  /** Where a person decides. */
  decides: string;
  /** What comes out. */
  out: string;
}

const WORKLOADS: Workload[] = [
  {
    name: "Static code analysis",
    icon: "file-code",
    given: "The source code to be analysed.",
    does: "Reads the code for vulnerabilities and traces the paths by which each could be reached.",
    decides: "A reviewer confirms a finding or sets it aside as a false positive.",
    out: "Findings in order of priority, each with remediation guidance, and a report.",
  },
  {
    name: "Penetration testing",
    icon: "crosshair",
    given: "Signed rules of engagement, the permitted targets, the test window and an inventory of assets.",
    does: "Tests the permitted targets one at a time and keeps the evidence for what it finds.",
    decides: "Scope and methods are approved before testing starts. The report is signed off when it ends.",
    out: "A report ranked by risk, with guidance on remediation, rollback and retest.",
  },
  {
    name: "Firewall rule review",
    icon: "brick-wall",
    given: "Exports of the rules, objects, address translation and topology.",
    does: "Works out the effective policy and marks the rules that carry risk, with the evidence for each.",
    decides: "The owner of a rule and a security approver accept or refuse each proposed change.",
    out: "Proposals to narrow a rule or limit it in time, each with rollback guidance.",
  },
  {
    name: "Threat hunting",
    icon: "radar",
    given: "Security telemetry and threat intelligence, as an offline extract or from an approved live source.",
    does: "Investigates suspicious activity in the telemetry and writes an assessment of what it found.",
    decides: "A reviewer accepts or rejects each assessment before it is reported.",
    out: "Assessments linked to the telemetry beneath them, and a report.",
  },
];

const FACETS: { key: keyof Pick<Workload, "given" | "does" | "decides" | "out">; label: string }[] = [
  { key: "given", label: "A person hands over" },
  { key: "does", label: "The agent" },
  { key: "decides", label: "A person decides" },
  { key: "out", label: "What comes out" },
];

function WorkloadName({ w }: { w: Workload }) {
  return (
    <Link href="/workloads" className="focusable group flex w-fit items-center gap-3 self-start rounded-sm text-fg">
      <span className="grid size-9 shrink-0 place-items-center border border-line-strong bg-surface">
        <NavIcon name={w.icon} size={17} />
      </span>
      <span className="text-[16px] leading-tight font-semibold tracking-[-0.01em] underline-offset-4 group-hover:underline">{w.name}</span>
      <NavIcon name="arrow-right" size={14} className="text-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-fg" />
    </Link>
  );
}

export function Workloads() {
  return (
    <section id="workloads" className="scroll-mt-16 border-t border-line bg-surface">
      <div className={`${WRAP} flex flex-col gap-14 py-20 lg:py-28`}>
        <Head title="The four workloads">
          Each workload is an agent the console runs on a dataset a person hands over, with its own approvals, findings and report. Where a
          workload is not yet connected on a deployment, its screens say so and show no records.
        </Head>

        {/* Wide: a table, one workload to a row. */}
        <div className="hidden lg:block">
          <div className="grid grid-cols-[1.15fr_1fr_1fr_1fr_1fr] gap-x-8 border-t-2 border-fg py-3.5 text-[12px] font-medium text-faint">
            <span>Workload</span>
            {FACETS.map((f) => (
              <span key={f.key}>{f.label}</span>
            ))}
          </div>
          {WORKLOADS.map((w) => (
            <div key={w.name} className="grid grid-cols-[1.15fr_1fr_1fr_1fr_1fr] gap-x-8 border-t border-line py-8">
              <WorkloadName w={w} />
              {FACETS.map((f) => (
                <p key={f.key} className="pt-[7px] text-[14px] leading-[1.55] text-mist">
                  {w[f.key]}
                </p>
              ))}
            </div>
          ))}
          <div className="border-t border-line" />
        </div>

        {/* Narrow: the same four facts under each workload. */}
        <div className="flex flex-col lg:hidden">
          {WORKLOADS.map((w) => (
            <div key={w.name} className="flex flex-col gap-6 border-t-2 border-fg py-8">
              <WorkloadName w={w} />
              <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
                {FACETS.map((f) => (
                  <div key={f.key} className="flex flex-col gap-1.5">
                    <dt className="text-[12px] font-medium text-faint">{f.label}</dt>
                    <dd className="text-[14px] leading-[1.55] text-mist">{w[f.key]}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════ How work is controlled ═══════════════════
   Grouped as the console's navigation is, each line a page of it. */

interface Area {
  group: string;
  /** What the group is for, in one line. */
  line: string;
  pages: { href: string; label: string; what: string }[];
}

const AREAS: Area[] = [
  {
    group: "Operations",
    line: "What is running, and what is waiting for a person.",
    pages: [
      { href: "/overview", label: "Overview", what: "Runs, spend and the items that need a person, over one period." },
      { href: "/runs", label: "Runs", what: "Each run step by step, with its limits and the control that stops it." },
      { href: "/approvals", label: "Approvals", what: "The gates where a named role decides before a consequential step." },
    ],
  },
  {
    group: "Agents",
    line: "What each agent is permitted to do.",
    pages: [
      { href: "/workloads", label: "Workloads", what: "The four workloads, each with its set-up, findings and report." },
      { href: "/workflows", label: "Workflows", what: "An agent's steps, its gates and their approvers, its step limit and its budget." },
      { href: "/evals", label: "Evals", what: "Evaluation of an agent on recorded runs, before a version is released." },
      { href: "/acceptance", label: "Acceptance", what: "The acceptance record of each workload: criteria, results and sign-off by role." },
    ],
  },
  {
    group: "Identity",
    line: "Who may do what.",
    pages: [{ href: "/iam", label: "People and agents", what: "Sign-in with roles. A role carries permissions, and an action a role lacks is refused." }],
  },
  {
    group: "Connections",
    line: "What an agent can reach.",
    pages: [
      { href: "/configuration", label: "Configuration", what: "The approved tool catalogue, the grants for each step and the routing to approved models." },
      { href: "/knowledge", label: "Knowledge", what: "Curated sources, each admitted by a person before an agent can read it." },
      { href: "/datasets", label: "Datasets", what: "What a person hands over to a workload: uploads and approved datasets." },
    ],
  },
  {
    group: "Security and Policy",
    line: "The rules, and the record that they held.",
    pages: [
      { href: "/guardrails", label: "Controls", what: "The controls applied to every agent, enforced outside the model." },
      { href: "/policy", label: "Policy", what: "Policy changed by review: proposed, approved by someone else, then applied." },
      { href: "/findings", label: "Findings", what: "Each finding with the journal entries and evidence beneath it." },
      { href: "/evidence", label: "Evidence", what: "The journal assembled for an assessor, with the verification of each run cited." },
    ],
  },
  {
    group: "Observability",
    line: "What was used, and what it cost.",
    pages: [
      { href: "/finops", label: "FinOps", what: "Model spend by provider, agent and step, against the budgets set." },
      { href: "/observability/tools", label: "Tool calls", what: "Every tool call: when, by which agent, at which step, and how it ended." },
    ],
  },
];

export function Controls() {
  return (
    <section id="controls" className="scroll-mt-16 border-t border-line bg-surface">
      <div className={`${WRAP} flex flex-col gap-14 py-20 lg:py-28`}>
        <Head title="How work is controlled">
          The same controls stand around every workload. They are set out here as the console sets them out, and each line opens the page
          that holds it.
        </Head>

        {/* Columns, so the groups keep the navigation's order reading down and no group leaves a hole beside a longer one. */}
        <div className="-mb-14 gap-x-10 sm:columns-2 lg:columns-3">
          {AREAS.map((a) => (
            <div key={a.group} className="mb-14 flex break-inside-avoid flex-col border-t-2 border-fg pt-5">
              <h3 className="text-[17px] font-semibold tracking-[-0.015em] text-fg">{a.group}</h3>
              <p className="mt-1.5 mb-5 text-[13.5px] text-faint">{a.line}</p>
              <ul className="flex flex-col">
                {a.pages.map((p) => (
                  <li key={p.href} className="border-t border-line">
                    <Link href={p.href} className="focusable group flex flex-col gap-1 rounded-sm py-4">
                      <span className="flex items-center gap-2 text-[14.5px] font-medium text-fg">
                        <span className="underline-offset-4 group-hover:underline">{p.label}</span>
                        <NavIcon name="arrow-right" size={13} className="text-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-fg" />
                      </span>
                      <span className="text-[13.5px] leading-[1.55] text-dim">{p.what}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════ How a piece of work moves ═══════════════════ */

export function Passage() {
  return (
    <section id="passage" className="scroll-mt-16 border-t border-line bg-canvas">
      <div className={`${WRAP} flex flex-col gap-14 py-20 lg:py-28`}>
        <Head title="How a piece of work moves through it">
          The same passage for every workload: a request with its dataset, the agent&rsquo;s steps, a gate where a named role decides, then the
          findings and the report. The journal runs beneath all of it.
        </Head>
        <WorkFlow />
      </div>
    </section>
  );
}

/* ═══════════════════ Closing ═══════════════════ */

export function Closing() {
  return (
    <section className="border-t border-line bg-surface">
      <div className={`${WRAP} flex flex-col gap-10 py-24 lg:flex-row lg:items-end lg:gap-16 lg:py-32`}>
        <div className="flex flex-col gap-7">
          <Rule />
          <p className="text-[32px] leading-[1.08] font-semibold tracking-[-0.03em] text-fg sm:text-[44px]">The console starts empty.</p>
          <p className="-mt-2 max-w-[44ch] text-[17px] leading-[1.6] text-dim lg:text-[19px]">It shows what was done in it, and nothing else.</p>
        </div>
        <span className="grow" />
        <OpenConsole primary />
      </div>
    </section>
  );
}

/* ═══════════════════ Footer ═══════════════════ */

export function LandingFooter() {
  return (
    <footer className="border-t border-line bg-canvas">
      <div className={`${WRAP} flex flex-col gap-12 py-14 lg:flex-row lg:gap-16`}>
        <div className="shrink-0 lg:w-[220px]">
          <BrandLockup height={17} />
        </div>
        <nav aria-label="The console" className="grid grow grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3 lg:grid-cols-6">
          {AREAS.map((a) => (
            <div key={a.group} className="flex flex-col gap-3">
              <span className="text-[12px] font-semibold text-fg">{a.group}</span>
              {a.pages.map((p) => (
                <Link key={p.href} href={p.href} className="focusable w-fit rounded-sm text-[13px] text-dim underline-offset-4 hover:text-fg hover:underline">
                  {p.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </div>
    </footer>
  );
}
