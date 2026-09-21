import Image from "next/image";
import { Button, Mono, Status, Tag } from "./ui";
import { CAT } from "./charts";
import {
  CountUp,
  HeroCarousel,
  IntegrationExplorer,
  Pin,
  Rise,
  Stagger,
} from "./landing-interactive";
import { DeployPanel } from "./deploy";
import { DemoFlow } from "./demo-flow";
import { AFMark } from "./brand";
import { ThemeToggle } from "./theme";
import { SurfaceGrain } from "./material";

/* ═══════════════════ Header ═══════════════════
   Deliberately linkless: the mark, the mode, and one door into the product. */

export function LandingHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface">
      <SurfaceGrain id="af-grain-landing" />
      <div className="relative flex h-14 w-full items-center gap-3 px-5 sm:px-8 lg:px-12 2xl:px-20">
        <span className="flex items-center gap-2.5">
          <span className="grid size-6 place-items-center rounded-md bg-ink text-on-ink">
            <AFMark size={15} />
          </span>
          <span className="text-[14px] font-semibold tracking-[-0.01em] text-fg">Agent Factory</span>
        </span>
        <div className="grow" />
        <ThemeToggle />
        <Button tone="ink" variant="solid" size="sm" href="/control">
          Open console
        </Button>
      </div>
    </header>
  );
}

export function LandingFooter() {
  return (
    <footer className="border-t border-line bg-raise/40">
      <div className="flex w-full flex-col items-start gap-3 border-b border-line px-5 py-10 sm:px-8 lg:flex-row lg:items-center lg:px-12 2xl:px-20">
        <div className="flex flex-col gap-1">
          <span className="text-[16px] font-semibold tracking-[-0.01em]">
            Explore Agent Factory with your team
          </span>
          <span className="text-[12.5px] text-dim">
            See how a priority cyber or risk process can move from design to governed operation.
          </span>
        </div>
        <div className="grow" />
        <Button
          tone="ink"
          variant="solid"
          size="md"
          href="mailto:hello@autogrc.cloud?subject=Agent%20Factory%20walkthrough"
        >
          Request a walkthrough
        </Button>
      </div>
      <div className="flex w-full flex-col gap-10 px-5 py-12 sm:px-8 lg:px-12 2xl:px-20">
        <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
          {(
            [
              ["Platform", [["Workflow builder", "/builder"], ["Agent builder", "/builder"], ["Control plane", "/control"], ["Runtime", null]]],
              ["Deploy", [["Terraform modules", "#deployment"], ["AWS", "#deployment"], ["Azure", "#deployment"], ["Google Cloud", "#deployment"]]],
              ["Governance", [["Provenance", "/runs"], ["Approval gates", "/runs"], ["Audit trail", "/runs"], ["Evals", "/evals"]]],
              ["Company", [["Case studies", null], ["Documentation", null], ["Status", null], ["Contact", "mailto:hello@autogrc.cloud"]]],
            ] as [string, [string, string | null][]][]
          ).map(([h, items]) => (
            <div key={h} className="flex flex-col gap-2.5">
              <span className="text-[12px] font-semibold">{h}</span>
              {items.map(([label, href]) =>
                href ? (
                  <a key={label} className="focusable w-fit rounded-sm text-[12.5px] text-dim transition-colors hover:text-fg" href={href}>
                    {label}
                  </a>
                ) : (
                  // Unlinked on purpose, a label with nowhere real to go is
                  // honest; a "#" is a dead end.
                  <span key={label} className="w-fit text-[12.5px] text-faint">
                    {label}
                  </span>
                ),
              )}
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-6">
          <span className="grid size-6 place-items-center rounded-md bg-ink text-on-ink">
            <AFMark size={15} />
          </span>
          <span className="text-[12px] text-faint">
            Agent Factory | EY
          </span>
          <div className="grow" />
          <Mono className="text-[11px] text-ghost">Governed workflows · Human oversight · Execution provenance</Mono>
        </div>
      </div>
    </footer>
  );
}

/* ═══════════════════ Section scaffolding ═══════════════════ */

export function Band({
  id,
  children,
  className = "",
}: {
  id?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    // Every band owns the screen the way the scroll scene does: a full
    // viewport minimum, growing past it only when the content genuinely
    // needs more. Content is pinned to a constant top offset so section
    // headers land at the same height on every screen.
    <section id={id} className={`flex min-h-screen items-start border-b border-line ${className}`}>
      <div className="w-full px-5 pt-14 pb-12 sm:px-8 lg:px-12 lg:pt-16 lg:pb-14 2xl:px-20">{children}</div>
    </section>
  );
}


/* ═══════════════════ Hero ═══════════════════ */

export function Hero() {
  return (
    <section className="relative flex min-h-screen items-center overflow-hidden border-b border-line">
      <HeroCarousel />
      {/* Scrim: canvas-tinted so the image recedes correctly in both themes. */}
      <div className="absolute inset-0 bg-gradient-to-r from-canvas via-canvas/85 to-canvas/35" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-canvas to-transparent" />

      <div className="relative w-full px-5 py-16 sm:px-8 lg:px-12 lg:py-20 2xl:px-20">
        <div className="flex max-w-[680px] flex-col justify-center gap-7">

          <h1 className="max-w-[15ch] text-[clamp(36px,5.4vw,60px)] leading-[1.03] font-semibold tracking-[-0.035em]">
            Transform cyber and risk operations with AI you can govern.
          </h1>

          <p className="max-w-[58ch] text-[16px] leading-[1.6] text-mist">
            Agent Factory helps organizations turn established cyber and GRC procedures into
            controlled, production-ready workflows. It brings together AI agents, enterprise
            data, deterministic tools and human oversight to improve operational capacity while
            maintaining accountability, traceability and control.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Button tone="ink" variant="solid" size="lg" href="/builder">
              Explore Agent Factory
            </Button>
            <Button variant="outline" size="lg" href="/runs">
              Review a workflow run
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-x-7 gap-y-3 border-t border-line pt-6">
            <div className="flex flex-col gap-0.5">
              <span className="text-[22px] leading-none font-semibold tracking-[-0.02em]">
                <CountUp to={3} />
              </span>
              <span className="text-[11.5px] text-faint">execution patterns for controlled workflows</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[22px] leading-none font-semibold tracking-[-0.02em]">
                <CountUp to={6} />
              </span>
              <span className="text-[11.5px] text-faint">layers of runtime protection</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[22px] leading-none font-semibold tracking-[-0.02em]">
                <CountUp to={1} />
              </span>
              <span className="text-[11.5px] text-faint">reviewable record for every run</span>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}

/* ═══════════════════ Workflow canvas mock ═══════════════════ */

const MOCK_NODES = [
  { label: "Intake", kind: "extraction", c: 1, x: 0, y: 0 },
  { label: "Enrich", kind: "extraction", c: 1, x: 1, y: 0 },
  { label: "History", kind: "research", c: 2, x: 1, y: 1 },
  { label: "Adjudicate", kind: "decision", c: 5, x: 2, y: 0 },
  { label: "Disposition", kind: "drafting", c: 3, x: 3, y: 0 },
  { label: "Approve", kind: "gate", c: 8, x: 3, y: 1 },
];

export function WorkflowMock() {
  // Positions are proportional, so the canvas fits whatever column it is
  // given instead of clipping at a fixed pixel width.
  const COLS = 4;
  const ROWS = 2;
  const cw = 100 / COLS;
  const rh = 100 / ROWS;
  const cx = (n: { x: number }) => n.x * cw + cw / 2;
  const cy = (n: { y: number }) => n.y * rh + rh / 2;

  return (
    <div className="relative overflow-hidden rounded-lg border border-line bg-surface elev-2">
      <div className="flex items-center gap-2 border-b border-line bg-raise/60 px-3 py-2">
        <span className="text-[12px] font-medium">DLP Triage</span>
        <Tag tone="ok" solid>
          deployed
        </Tag>
        <div className="grow" />
        <Status tone="run">2 running</Status>
      </div>

      <div className="relative aspect-[16/7] w-full bg-[radial-gradient(circle_at_1px_1px,var(--t-line-strong)_1px,transparent_0)] [background-size:16px_16px]">
        <svg
          className="absolute inset-0 size-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
        >
          {[
            [0, 1],
            [1, 2],
            [1, 3],
            [2, 3],
            [3, 4],
            [4, 5],
          ].map(([a, b]) => {
            const A = MOCK_NODES[a];
            const B = MOCK_NODES[b];
            const x1 = cx(A) + cw * 0.34;
            const y1 = cy(A);
            const x2 = cx(B) - cw * 0.34;
            const y2 = cy(B);
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

        {MOCK_NODES.map((n) => (
          <div
            key={n.label}
            className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col justify-center gap-0.5 rounded-md border border-line bg-surface px-2 py-1.5 elev-1"
            style={{
              left: `${cx(n)}%`,
              top: `${cy(n)}%`,
              width: `${cw * 0.68}%`,
            }}
          >
            <div className="flex items-center gap-1.5">
              <span className="size-2 shrink-0 rounded-[2px]" style={{ background: CAT[n.c] }} />
              <span className="truncate text-[11px] font-medium">{n.label}</span>
            </div>
            <span className="truncate text-[10.5px] text-faint">{n.kind}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════ Two builders ═══════════════════ */

export function Builders() {
  return (
    <section id="platform" className="border-b border-line">
      <div className="w-full px-5 sm:px-8 lg:px-12 2xl:px-20">
        {/* Pinned, not hijacked: the section holds its place for a fixed
            distance while the reader works through the three phases, then
            releases. Scroll direction and speed are untouched. */}
        <Pin height="205vh">
          <div className="flex flex-col gap-7">
            <Rise className="flex flex-col gap-4">
              <h2 className="max-w-[24ch] text-[clamp(24px,3.2vw,38px)] leading-[1.1] font-semibold tracking-[-0.03em]">
                Turn established procedures into governed workflows.
              </h2>
              <p className="max-w-[62ch] text-[15px] leading-[1.6] text-mist">
                Describe a process in plain language or configure it visually. Agent Factory
                translates the procedure into a structured workflow with defined inputs,
                outputs, permissions and review points, then records the evidence and decisions
                produced during execution.
              </p>
            </Rise>

            <Rise delay={80}>
              <DemoFlow />
            </Rise>
          </div>
        </Pin>
      </div>
    </section>
  );
}

/* ═══════════════════ Harnesses ═══════════════════ */

const HARNESS_ROWS = [
  ["Evidence extraction", "extraction", "Typed record + per-field citation", "Benchmark required", 1],
  ["Control research", "research", "Findings with source and recency", "Benchmark required", 2],
  ["Policy decision", "decision", "Disposition + governing clause", "Benchmark required", 5],
  ["Report drafting", "drafting", "Draft + change log", "Benchmark required", 3],
  ["Assessment review", "review", "Findings with severity", "Benchmark required", 4],
  ["Control mapping", "decision", "Framework crosswalk + rationale", "Benchmark required", 6],
  ["Vendor triage", "research", "Risk summary + evidence links", "Benchmark required", 7],
  ["Access certification", "review", "Entitlement findings + owner", "Benchmark required", 9],
  ["Incident summary", "drafting", "Timeline + affected assets", "Benchmark required", 0],
  ["Data classification", "extraction", "Label + matched policy terms", "Benchmark required", 2],
  ["Human approval", "gate", "Approval + reviewer identity", "Reviewer decision", 8],
] as const;

export function Harnesses() {
  return (
    <Band id="harnesses" className="bg-raise/25">
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:gap-16">
        <Rise className="flex flex-col gap-5">
          <h2 className="text-[clamp(24px,3vw,34px)] leading-[1.12] font-semibold tracking-[-0.03em]">
            Combine reusable capabilities with controlled execution patterns.
          </h2>
          <p className="text-[15px] leading-[1.6] text-mist">
            Reusable capabilities support activities such as evidence extraction, policy
            analysis and assessment review. Three execution patterns determine whether the
            next step is defined in advance, selected through inference or dependent on an
            external decision.
          </p>
          <p className="text-[13px] leading-[1.6] text-dim">
            Each capability has a declared contract for its inputs, outputs and permitted
            tools, helping teams assemble workflows without rebuilding the underlying runtime.
          </p>
        </Rise>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-left">
            <thead>
              <tr className="border-b border-line-strong">
                {["Capability", "Activity", "Returns", "Validation"].map((h) => (
                  <th key={h} className="pb-2.5 text-[11px] font-medium text-faint">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {HARNESS_ROWS.map(([name, kind, ret, pass, c]) => (
                <tr key={name} className="border-b border-line last:border-0">
                  <td className="py-3 pr-4">
                    <span className="flex items-center gap-2">
                      <span className="size-2 shrink-0 rounded-[2px]" style={{ background: CAT[c] }} />
                      <span className="text-[13px] font-medium">{name}</span>
                    </span>
                  </td>
                  <td className="py-3 pr-4">
                    <Tag>{kind}</Tag>
                  </td>
                  <td className="py-3 pr-4 text-[12.5px] text-dim">{ret}</td>
                  <td className="tnum py-3 font-mono text-[12px] text-dim">{pass}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Rise delay={80} className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          {
            title: "Declared contract",
            body: "Typed inputs and outputs, explicit tool permissions and defined exception paths establish what each capability can receive, use and return.",
            tags: ["inputs", "outputs", "tools", "exceptions"],
          },
          {
            title: "Evaluation before deployment",
            body: "Representative cases help teams assess quality, cost and execution time before promoting a workflow into production.",
            tags: ["representative cases", "deterministic grading"],
          },
          {
            title: "Versioned releases",
            body: "Version history and deployment records help teams understand what changed, what was tested and which specification produced an outcome.",
            tags: ["spec digest", "deployment record", "change history"],
          },
        ].map((c) => (
          <div key={c.title} className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-4">
            <span className="text-[13px] font-semibold">{c.title}</span>
            <p className="text-[12.5px] leading-[1.6] text-dim">{c.body}</p>
            <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
              {c.tags.map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
            </div>
          </div>
        ))}
      </Rise>
    </Band>
  );
}

/* ═══════════════════ Integrations ═══════════════════ */

export function Integrations() {
  return (
    <Band id="integrations">
      <div className="flex flex-col gap-10">
        <Rise className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="flex flex-col gap-5">
            <h2 className="max-w-[20ch] text-[clamp(24px,3vw,36px)] leading-[1.12] font-semibold tracking-[-0.03em]">
              Connect workflows to the systems your teams already use.
            </h2>
            <p className="max-w-[60ch] text-[15px] leading-[1.6] text-mist">
              Declared connector contracts provide governed access to enterprise data, records,
              tools and services. Each workflow receives only the capabilities and scope required
              for its purpose, helping organizations extend automation without creating
              unrestricted access to operational systems.
            </p>
          </div>

          <div className="flex gap-8">
            <div className="flex flex-col gap-0.5">
              <span className="text-[26px] leading-none font-semibold tracking-[-0.02em]">
                governed
              </span>
              <span className="text-[11.5px] text-faint">access through declared contracts</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[26px] leading-none font-semibold tracking-[-0.02em]">
                extensible
              </span>
              <span className="text-[11.5px] text-faint">for organization-specific systems</span>
            </div>
          </div>
        </Rise>

        <Rise delay={80}>
          <IntegrationExplorer />
        </Rise>
      </div>
    </Band>
  );
}

/* ═══════════════════ Deployment ═══════════════════ */
export function Deployment() {
  return (
    <Band id="deployment" className="bg-raise/25">
      <div className="grid grid-cols-1 items-stretch gap-10 lg:grid-cols-[minmax(0,460px)_minmax(0,1fr)] lg:gap-16">
        <Rise className="flex h-full flex-col gap-5">
          <h2 className="text-[clamp(24px,3vw,34px)] leading-[1.12] font-semibold tracking-[-0.03em]">
            Operate within your technology and control environment.
          </h2>
          <p className="text-[15px] leading-[1.6] text-mist">
            Agent Factory is designed for deployment within an organization&rsquo;s cloud
            environment. Workflows can use approved model endpoints, private data sources and
            existing operational systems while execution records remain within the
            organization&rsquo;s defined boundary.
          </p>

          <div className="mt-auto flex flex-col gap-2.5 border-t border-line pt-5">
            <Stagger className="flex flex-col gap-3.5">
              {([
              ["Controlled connectivity", "Connect workflows through approved network paths and interfaces"],
              ["Approved model access", "Route tasks to models made available by the organization"],
              ["Reviewable records", "Retain run activity, decisions and source references for oversight"],
            ] as const).map(([h, d]) => (
              <div key={h} className="flex gap-2.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 shrink-0 text-ok">
                  <path d="M4 13l5 5 11-13" />
                </svg>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[13.5px] font-medium">{h}</span>
                  <span className="text-[12.5px] text-faint">{d}</span>
                </div>
              </div>
            ))}
            </Stagger>
          </div>
        </Rise>

        <Rise delay={80} className="min-h-0 lg:h-full">
          <DeployPanel />
        </Rise>
      </div>

      {/* The planes that land in the tenancy, drawn from the reference
          architecture: what is provisioned, what executes, what persists,
          what governs, and how it connects outward. */}
      <Rise delay={120} className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          {
            title: "Build plane",
            body: "Reusable workflow patterns, connector definitions and evaluation capabilities support consistent design and validation.",
            tags: ["templates", "data adaptors", "IaC"],
          },
          {
            title: "Agent runtime",
            body: "Workers execute workflow specifications using approved models and tools under defined runtime limits and controls.",
            tags: ["ephemeral workers", "orchestrator", "approved tools"],
          },
          {
            title: "Work plane",
            body: "A durable registry and execution journal retain workflow state, provenance and the evidence associated with each run.",
            tags: ["execution ledger", "watchdog", "provenance"],
          },
          {
            title: "Control plane",
            body: "Identity, permissions, policy decisions, human review and operational intervention are applied across workflow execution.",
            tags: ["least privilege", "guardrails", "FinOps", "kill switch"],
          },
          {
            title: "Integration gateway",
            body: "Standard interfaces connect enterprise platforms while controls govern the information and actions that cross each boundary.",
            tags: ["MCP", "A2A", "REST", "webhooks"],
          },
          {
            title: "Model consumption",
            body: "Model routing can reflect task requirements, data sensitivity, organizational policy, performance and cost.",
            tags: ["model garden", "self-hosted", "frontier endpoints"],
          },
        ].map((c) => (
          <div key={c.title} className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-4">
            <span className="text-[13px] font-semibold">{c.title}</span>
            <p className="text-[12.5px] leading-[1.6] text-dim">{c.body}</p>
            <div className="mt-auto flex flex-wrap gap-1.5 pt-1">
              {c.tags.map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
            </div>
          </div>
        ))}
      </Rise>
    </Band>
  );
}

/* ═══════════════════ Security ═══════════════════ */

export function Security() {
  return (
    <Band id="security">
      <div className="flex flex-col gap-12">
        <Rise className="flex flex-col gap-5">
          <h2 className="max-w-[24ch] text-[clamp(24px,3vw,34px)] leading-[1.12] font-semibold tracking-[-0.03em]">
            Trace outcomes to the evidence and decisions behind them.
          </h2>
          <p className="max-w-[62ch] text-[15px] leading-[1.6] text-mist">
            Agent Factory maintains a reviewable record of workflow execution. Teams can examine
            which information was used, how it moved through the workflow, where controls were
            applied and when human judgment affected the outcome.
          </p>
        </Rise>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:gap-12">
          <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
            <div className="relative aspect-[16/9] w-full">
              <Image
                src="/media/teamwork.jpg"
                alt="Reviewers examining alert evidence together"
                fill
                sizes="(max-width: 1024px) 100vw, 700px"
                className="object-cover"
              />
              <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(8,8,7,0.05)_40%,rgba(8,8,7,0.85)_100%)]" />
              <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 p-5">
                <span className="text-[15px] font-semibold tracking-[-0.01em] text-white">
                  Review each run with end-to-end traceability
                </span>
                <span className="max-w-[46ch] text-[12.5px] leading-[1.5] text-white/75">
                  Examine the execution timeline and trace an outcome to the relevant policy,
                  business record, source material and reviewer decision.
                </span>
                <div className="pt-2">
                  <Button size="sm" variant="solid" tone="media" href="/runs">
                    Review a workflow run
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {[
              ["Least-privilege access", "Tools and data scope are assigned to individual workflow steps"],
              ["Human oversight", "Defined decisions can pause for review by authorized people"],
              ["Untrusted-content controls", "External content remains identified as it moves through a workflow"],
              ["Execution provenance", "Sources, tool activity, decisions and outputs are retained in the run record"],
              ["Operational intervention", "Authorized operators can stop active runs and record the intervention"],
            ].map(([h, d]) => (
              <div
                key={h}
                className="flex items-center gap-3 rounded-md border border-line bg-surface px-3.5 py-3"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-dim">
                  <path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
                <div className="flex min-w-0 grow flex-col">
                  <span className="text-[13.5px] font-medium">{h}</span>
                  <span className="truncate text-[11px] text-faint">{d}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Band>
  );
}

/* ═══════════════════ Closing CTA ═══════════════════ */

export function Closing() {
  return (
    <Band className="bg-raise/25">
      <Rise className="flex flex-col items-start gap-7">
        <h2 className="max-w-[18ch] text-[clamp(28px,4vw,44px)] leading-[1.06] font-semibold tracking-[-0.035em]">
          Explore how Agent Factory can support a priority cyber or risk workflow.
        </h2>
        <p className="max-w-[58ch] text-[15px] leading-[1.6] text-mist">
          Review a representative workflow from design through execution, including its
          permissions, evaluation results, human review points and final evidence record.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button tone="ink" variant="solid" size="lg" href="/builder">
            Explore Agent Factory
          </Button>
          <Button variant="outline" size="lg" href="#security">
            Review security and governance
          </Button>
        </div>
      </Rise>
    </Band>
  );
}
