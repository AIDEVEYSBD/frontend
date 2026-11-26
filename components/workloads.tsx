"use client";

import { useConsoleLinks } from "@/lib/use-links";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "./ui";
import { Banner, EmptyState } from "./overlays";
import { PageHeader } from "./section";
import { NavIcon } from "./nav-icons";
import { NotConnected, useDoor } from "./pending";
import { AgentLink, Lines, OfferMark } from "./workload-parts";
import { WorkloadSetup } from "./workload-setup";
import { WorkloadAcceptance, WorkloadFindings, WorkloadReport } from "./workload-tabs";
import { UseCases } from "./use-cases";
import { WORKLOADS, type Answer, type WorkloadList } from "@/lib/api/pending";
import {
  WORKLOAD_TABS,
  formOf,
  gatesOf,
  isKnownWorkload,
  otherOffers,
  profileOf,
  readOffer,
  stepOf,
  tabOf,
  workloadHref,
  type InputValue,
  type InputValues,
  type OfferReading,
  type WorkloadProfile,
} from "@/lib/workloads";

/**
 * Workloads: the four security workloads this console controls.
 *
 * `/workloads` shows them as cards, always: what each is, its state as the
 * workloads door gives it (available with the agent that runs it, not
 * deployed, or not connected), what a person hands over, where a person
 * decides, what comes out, and the way into its set-up.
 * `/workloads?id=<workload>` is one workload, with its tabs kept in the
 * address (`&tab=`): the guided set-up (`&step=`), its findings, where its
 * reports are and its acceptance record.
 *
 * The door is `GET /api/workloads` (lib/api/pending.ts). No screen here says
 * a workload ran, found or was accepted anything unless a door said so.
 */

/* ═══════════════════ the four, as cards ═══════════════════ */

function Column({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-[11px] font-semibold text-dim">{title}</span>
      <Lines items={items} empty={empty} />
    </div>
  );
}

function WorkloadCard({ profile, reading }: { profile: WorkloadProfile; reading: OfferReading }) {
  const form = formOf(profile, reading);
  const gates = gatesOf(profile, reading);
  // The door's own words once it names the inputs and gates; the product's until then.
  const handsOver = form.from === "door" ? form.inputs.map((i) => i.label) : profile.handsOver;
  const decides = gates.from === "door" && gates.gates.length ? gates.gates.map((g) => [g.name, g.role].filter(Boolean).join(": ")) : profile.decides;
  // The workload's own console, where a run is set up; absent until the deployment gives its address.
  const { links, error: linksError } = useConsoleLinks();
  const url = links?.workloads[profile.id] ?? "";

  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1" data-workload={profile.id}>
      <div data-hue="blue" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-raise/55 px-4 py-2.5">
        <NavIcon name={profile.icon} size={15} className="text-dim" />
        <span className="text-[13px] font-semibold tracking-[-0.005em] text-fg">{profile.name}</span>
        <span className="grow" />
        <OfferMark reading={reading} chip />
      </div>

      <div className="flex grow flex-col gap-4 p-4">
        {profile.line && <p className="text-[13px] leading-[1.5] text-mist">{profile.line}.</p>}
        <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-3">
          <Column title="You hand over" items={handsOver} empty={form.from === "door" ? "Nothing: it takes no input." : "Not named by the control plane."} />
          <Column title="A person decides" items={decides} empty={gates.from === "door" ? "No gate is listed." : "Not named by the control plane."} />
          <Column title="What comes out" items={profile.produces} empty="Not described for this workload." />
        </div>
        <p className="text-[10.5px] leading-[1.5] text-faint">As specified, not as deployed.</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-4 py-3">
        <span className="flex min-w-0 grow basis-[45%] flex-wrap items-baseline gap-x-1.5 text-[12px] leading-[1.5] text-dim">
          {reading.state === "available" ? (
            <>
              Run by <AgentLink agent={reading.agent} />
            </>
          ) : reading.offer ? (
            // Listed and not available: the status is on the chip, and the platform's reason is said here.
            <span>
              {reading.why}
              {linksError ? <span className="text-err"> The console addresses could not be read: {linksError}</span> : null}
            </span>
          ) : linksError ? (
            <span className="text-err">The console addresses could not be read: {linksError}</span>
          ) : (
            reading.short
          )}
        </span>
        <Button size="sm" variant="solid" tone="neutral" href={workloadHref(profile.id, { tab: "findings" })}>
          Findings and report
        </Button>
        {/* A run is set up in the workload's own console, which this one opens and does not embed. Until a deployment names its address, it is not live. */}
        <span className="flex items-center gap-2" title={url ? undefined : linksError ? `The console addresses could not be read: ${linksError}` : links ? `The ${profile.name.toLowerCase()} console is not live yet.` : "Reading the console addresses…"}>
          <Button size="sm" variant="solid" tone="ink" disabled={!url} onClick={() => url && window.open(url, "_blank", "noopener,noreferrer")}>
            Set up a run
            {url && <NavIcon name="external-link" size={12} className="ml-1.5" />}
          </Button>
        </span>
      </div>
    </section>
  );
}

function Index({ answer, reload }: { answer: Answer<WorkloadList> | null; reload: () => void }) {
  const others = otherOffers(answer);
  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-5 px-5 py-7" data-hue="blue">
      <PageHeader title="Workloads">The four security workloads, and whether this deployment offers each.</PageHeader>

      {answer?.state === "error" && (
        <Banner
          tone="err"
          title="Could not read the workloads"
          action={
            <Button size="sm" variant="solid" tone="neutral" onClick={reload}>
              Try again
            </Button>
          }
        >
          {answer.message}
        </Banner>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {WORKLOADS.map((w) => {
          const reading = readOffer(answer, w.id);
          return <WorkloadCard key={w.id} profile={profileOf(w.id, reading.offer)} reading={reading} />;
        })}
        {others.map((o) => {
          const reading = readOffer(answer, o.id);
          return <WorkloadCard key={o.id} profile={profileOf(o.id, o)} reading={reading} />;
        })}
      </div>

      {answer?.state === "pending" && <NotConnected door={answer.door} />}

      <UseCases workloads={answer} calm={answer?.state === "pending"} />
    </div>
  );
}

/* ═══════════════════ one workload ═══════════════════ */

function One({ id, answer, reload }: { id: string; answer: Answer<WorkloadList> | null; reload: () => void }) {
  const params = useSearchParams();
  const tab = tabOf(params.get("tab"));
  const step = stepOf(params.get("step"));
  const run = params.get("run") ?? "";
  const finding = params.get("finding") ?? "";
  const reading = readOffer(answer, id);
  const profile = profileOf(id, reading.offer);
  // What the person has given so far: kept here, so it survives a change of step or tab.
  const [values, setValues] = useState<InputValues>({});
  const onValue = (name: string, v: InputValue) => setValues((prev) => ({ ...prev, [name]: v }));

  const unknown = !isKnownWorkload(id) && !reading.offer && answer !== null;

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-5 px-5 py-7" data-hue="blue" data-workload={id}>
      <div className="flex flex-col gap-2">
        <Link href="/workloads" className="focusable flex w-fit items-center gap-1.5 rounded-sm text-[12px] font-medium text-dim hover:text-fg">
          <NavIcon name="chevron-right" size={12} className="rotate-180" />
          Workloads
        </Link>
        <PageHeader
          title={profile.name}
          action={
            !unknown && (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {reading.state === "available" && (
                  <span className="flex items-baseline gap-1.5 text-[12px] text-dim">
                    Run by <AgentLink agent={reading.agent} />
                  </span>
                )}
                <OfferMark reading={reading} chip />
              </span>
            )
          }
        >
          {profile.line ? `${profile.line}.` : unknown ? "This console does not know a workload by this name." : "A workload the control plane lists."}
        </PageHeader>
      </div>

      {unknown ? (
        <EmptyState
          title="No such workload"
          detail={`Nothing called "${id}" is listed.`}
          action={
            <Button size="sm" variant="solid" tone="neutral" href="/workloads">
              Back to Workloads
            </Button>
          }
        />
      ) : (
        <>
          {answer?.state === "error" && (
            <Banner
              tone="err"
              title="Could not read the workloads"
              action={
                <Button size="sm" variant="solid" tone="neutral" onClick={reload}>
                  Try again
                </Button>
              }
            >
              {answer.message}
            </Banner>
          )}

          <nav aria-label="Workload sections" className="flex items-center gap-5 overflow-x-auto border-b border-line">
            {WORKLOAD_TABS.map((t) => {
              const on = t.id === tab;
              return (
                <Link
                  key={t.id}
                  href={workloadHref(id, { tab: t.id, run: t.id === "setup" ? run : undefined, step: t.id === "setup" ? step : undefined })}
                  aria-current={on ? "page" : undefined}
                  className={`focusable relative -mb-px shrink-0 pb-2.5 text-[13px] transition-colors duration-100 ${on ? "font-medium text-fg" : "text-faint hover:text-dim"}`}
                >
                  {t.label}
                  {on && <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-[2px] bg-fg" />}
                </Link>
              );
            })}
          </nav>

          {tab === "setup" && <WorkloadSetup profile={profile} reading={reading} values={values} onValue={onValue} step={step} run={run} />}
          {tab === "findings" && <WorkloadFindings profile={profile} selected={finding} />}
          {tab === "report" && <WorkloadReport reading={reading} />}
          {tab === "acceptance" && <WorkloadAcceptance profile={profile} />}
        </>
      )}
    </div>
  );
}

function WorkloadsPage() {
  const id = useSearchParams().get("id");
  const { answer, reload } = useDoor<WorkloadList>("workloads");
  if (!id) return <Index answer={answer} reload={reload} />;
  return <One key={id} id={id} answer={answer} reload={reload} />;
}

export function WorkloadsView() {
  return (
    <Suspense>
      <WorkloadsPage />
    </Suspense>
  );
}
