"use client";

import { notBuilt, notBuiltOf } from "@/lib/not-built";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Status } from "./ui";
import { Banner } from "./overlays";
import { Figures } from "./section";
import { NotConnected, useDoor, Failure } from "./pending";
import { FindingDetail, hasFindingDetail } from "./finding-detail";
import { FindingStatusMark, RunLink, SeverityBar, SeverityTag, acceptanceStatusMeta, count, countBySeverity, shortWhen } from "./finding-marks";
import { DeliverablesListView } from "./deliverables";
import { Card, Note, TextLink } from "./workload-parts";
import { listDeliverables, type DeliverableList } from "@/lib/api/l8b";
import { soon } from "@/lib/soon";
import type { AcceptanceList, Finding, FindingList } from "@/lib/api/pending";
import { workloadHref, type OfferReading, type WorkloadProfile } from "@/lib/workloads";

/**
 * The three tabs beside the set-up: this workload's findings, where its
 * reports are, and its acceptance record, each in brief with a link to the
 * page that holds the whole of it.
 *
 * Findings and acceptance are ahead of their doors (lib/api/pending.ts): they
 * say so and show no row until the door answers. The report tab reads the
 * deliverables of the agent the workloads door names, through the door the
 * Deliverables page reads.
 */

const FINDINGS_LIMIT = 500;
const RECENT = 10;

function Block({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[11px] font-semibold text-dim">{title}</span>
        {meta !== undefined && <span className="tnum text-[11px] text-faint">{meta}</span>}
      </span>
      {children}
    </div>
  );
}

function Prose({ children }: { children: ReactNode }) {
  return <p className="max-w-[86ch] text-[12.5px] leading-[1.55] break-words whitespace-pre-wrap text-mist">{children}</p>;
}

const recentFirst = (a: Finding, b: Finding): number => (b.updated_at || b.created_at || "").localeCompare(a.updated_at || a.created_at || "");

/* ═══════════════════ findings ═══════════════════ */

function FindingBeside({ finding }: { finding: Finding }) {
  const f = finding;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-finding={f.id}>
      <div className="flex flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-2">
          <SeverityTag severity={f.severity} />
          <FindingStatusMark status={f.status} />
        </span>
        <span className="text-[14px] leading-[1.35] font-semibold break-words text-fg">{f.title || f.id}</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-faint">
          <span className="font-mono text-[10.5px] break-all">{f.id}</span>
          {f.run && (
            <span>
              run <RunLink run={f.run} />
            </span>
          )}
          {f.created_at && (
            <span className="tnum" title={f.created_at}>
              reported {shortWhen(f.created_at)}
            </span>
          )}
        </span>
      </div>
      {f.summary && (
        <Block title="Summary">
          <Prose>{f.summary}</Prose>
        </Block>
      )}
      {f.recommendation && (
        <Block title="Recommendation">
          <Prose>{f.recommendation}</Prose>
        </Block>
      )}
      {hasFindingDetail(f) ? <FindingDetail finding={f} /> : <Note>The finding carries no further detail.</Note>}
      <span>
        <Button size="sm" variant="solid" tone="ink" href={`/findings?id=${encodeURIComponent(f.id)}`}>
          Open the finding
        </Button>
      </span>
    </div>
  );
}

export function WorkloadFindings({ profile, selected }: { profile: WorkloadProfile; selected: string }) {
  const id = profile.id;
  const { answer, reload } = useDoor<FindingList>("findings", { query: { workload: id, limit: FINDINGS_LIMIT } });
  const all = `/findings?workload=${encodeURIComponent(id)}`;
  const openAll = (
    <Button size="sm" variant="solid" tone="neutral" href={all}>
      Open the full list
    </Button>
  );

  const rows: Finding[] = answer?.state === "ok" && Array.isArray(answer.data?.findings) ? answer.data.findings : [];
  const total = answer?.state === "ok" && typeof answer.data?.total === "number" ? answer.data.total : rows.length;
  const recent = [...rows].sort(recentFirst).slice(0, RECENT);
  const picked = selected ? (rows.find((f) => f.id === selected) ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      {answer?.state === "error" && (
        <Banner
          tone="err"
          title="Could not read this workload's findings"
          action={
            <Button size="sm" variant="solid" tone="neutral" onClick={reload}>
              Try again
            </Button>
          }
        >
          {answer.message}
        </Banner>
      )}

      <Card title="Findings by severity" meta={answer?.state === "ok" ? `${count(total)} reported for ${profile.name.toLowerCase()}` : undefined} action={openAll}>
        {answer === null && <p className="text-[12px] text-faint">Reading the findings&hellip;</p>}
        {answer?.state === "pending" && (
          <NotConnected compact door={answer.door}>
            What {profile.name.toLowerCase()} reported: the count at each severity, and the most recent findings with the detail of the one you pick.
          </NotConnected>
        )}
        {answer?.state === "error" && <Failure what="The findings could not be read" message={answer.message} />}
        {answer?.state === "ok" &&
          (rows.length === 0 ? (
            <p className="text-[12.5px] leading-[1.6] text-dim">
              {answer?.state === "ok" && notBuilt(notBuiltOf(answer.data), "producer") ? "Nothing produces findings yet: the platform names their producer as not built." : "No finding is on record for this workload."}
            </p>
          ) : (
            <>
              <SeverityBar counts={countBySeverity(rows)} href={(s) => `${all}&severity=${s}`} />
              {total > rows.length && (
                <Note>
                  The counts cover the {count(rows.length)} findings read here, of {count(total)} on record. The full list has the rest.
                </Note>
              )}
            </>
          ))}
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Card title="Most recent" hue="finding" meta={answer?.state === "ok" && rows.length ? `${count(recent.length)} of ${count(total)}` : undefined} pad={false}>
          {answer?.state !== "ok" && <p className="px-4 py-3 text-[12px] text-faint">{answer === null ? "Reading…" : answer.state === "pending" ? "Nothing is listed until the findings door answers." : "Not read."}</p>}
          {answer?.state === "ok" && rows.length === 0 && <p className="px-4 py-3 text-[12px] text-faint">Nothing to list yet.</p>}
          {recent.length > 0 && (
            <ul className="flex flex-col">
              {recent.map((f) => {
                const on = f.id === selected;
                return (
                  <li key={f.id} className={`flex items-center gap-2 border-b border-line pr-3 last:border-b-0 ${on ? "bg-raise/60" : ""}`}>
                    <Link
                      href={workloadHref(id, { tab: "findings", finding: f.id })}
                      scroll={false}
                      aria-current={on ? "true" : undefined}
                      className="focusable flex min-w-0 grow flex-wrap items-center gap-x-3 gap-y-1 py-2 pl-4 hover:bg-raise/40"
                    >
                      <span className="flex w-16 shrink-0">
                        <SeverityTag severity={f.severity} />
                      </span>
                      <span className="flex min-w-0 grow basis-[50%] flex-col gap-0.5">
                        <span className="text-[12px] font-medium break-words text-fg">{f.title || f.id}</span>
                        <span className="tnum text-[10.5px] text-faint" title={f.updated_at || f.created_at}>
                          {shortWhen(f.updated_at || f.created_at)}
                        </span>
                      </span>
                      <FindingStatusMark status={f.status} />
                    </Link>
                    <Button size="sm" variant="solid" tone="neutral" href={`/findings?id=${encodeURIComponent(f.id)}`}>
                      Open
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Finding" hue="finding" meta={picked ? undefined : "pick one from the list"}>
          {picked ? (
            <FindingBeside finding={picked} />
          ) : selected && answer?.state === "ok" ? (
            <Note>
              That finding is not among the ones read here. It may still be on <TextLink href={`/findings?id=${encodeURIComponent(selected)}`}>its own page</TextLink>.
            </Note>
          ) : (
            <p className="text-[12px] leading-[1.6] text-faint">The detail of a finding is shown here when you pick one: what it is, and the part that differs for {profile.name.toLowerCase()}.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ═══════════════════ report ═══════════════════ */

export function WorkloadReport({ profile, reading }: { profile: WorkloadProfile; reading: OfferReading }) {
  const router = useRouter();
  const agent = reading.agent;
  const [got, setGot] = useState<{ agent: string; list: DeliverableList | null; error: string } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!agent) return;
    let stop = false;
    const cancel = soon(() =>
      listDeliverables({ agent })
        .then((list) => !stop && setGot({ agent, list, error: "" }))
        .catch((e: Error) => !stop && setGot({ agent, list: null, error: e.message })),
    );
    return () => {
      stop = true;
      cancel();
    };
  }, [agent, tick]);

  const mine = got && got.agent === agent ? got : null;
  const allHref = agent ? `/deliverables?agent=${encodeURIComponent(agent)}` : "/deliverables";

  return (
    <Card
      title="Report"
      meta={agent ? "the deliverables of the agent that runs it" : undefined}
      action={
        <Button size="sm" variant="solid" tone="neutral" href={allHref}>
          Open Deliverables
        </Button>
      }
    >
      <p className="max-w-[86ch] text-[12.5px] leading-[1.6] text-dim">
        A report is a deliverable: a document a run wrote, kept with its state, its history and its file. The reports of {profile.name.toLowerCase()} are the deliverables of the agent that runs it.
      </p>

      {!agent && (
        <div className="flex flex-col gap-1 rounded-md border border-line bg-canvas px-3 py-2.5">
          <span className="max-w-[86ch] text-[12px] leading-[1.55] text-dim">
            {reading.state === "reading" ? "Reading the workloads…" : `Which agent that is cannot be said here. ${reading.why}`} Every deliverable on record, whichever agent wrote it, is on{" "}
            <TextLink href="/deliverables">Deliverables</TextLink>.
          </span>
        </div>
      )}

      {agent && (
        <>
          {!mine && <p className="text-[12px] text-faint">Reading the deliverables&hellip;</p>}
          {mine?.error && (
            <Banner
              tone="err"
              title="Could not read the agent's deliverables"
              action={
                <Button size="sm" variant="solid" tone="neutral" onClick={() => setTick((t) => t + 1)}>
                  Try again
                </Button>
              }
            >
              {mine.error}
            </Banner>
          )}
          {mine?.list &&
            (mine.list.deliverables.length === 0 ? (
              <p className="rounded-md border border-line bg-canvas px-3 py-2.5 text-[12px] leading-[1.55] text-dim">This agent has no deliverable on record. A report appears here once a run of the workload writes one.</p>
            ) : (
              <DeliverablesListView list={mine.list} onSelect={(d) => router.push(`/deliverables?agent=${encodeURIComponent(agent)}&id=${encodeURIComponent(d)}`)} />
            ))}
        </>
      )}
    </Card>
  );
}

/* ═══════════════════ acceptance ═══════════════════ */

export function WorkloadAcceptance({ profile }: { profile: WorkloadProfile }) {
  const id = profile.id;
  const { answer, reload } = useDoor<AcceptanceList>("acceptance");
  const record = answer?.state === "ok" && Array.isArray(answer.data?.use_cases) ? (answer.data.use_cases.find((u) => u && u.use_case === id) ?? null) : null;
  const href = `/acceptance#${encodeURIComponent(id)}`;

  const criteria = record && Array.isArray(record.criteria) ? record.criteria : [];
  const issues = record && Array.isArray(record.issues) ? record.issues : [];
  const signoffs = record && Array.isArray(record.signoffs) ? record.signoffs : [];
  const met = criteria.filter((c) => c.met === true).length;
  const open = issues.filter((i) => i.state === "open");
  // A signature given on an earlier version of the record (`stale`) does not count.
  const signed = signoffs.filter((s) => s.decision && !s.stale).length;
  const status = record ? acceptanceStatusMeta(record.status) : null;

  return (
    <Card
      title="Acceptance"
      hue="approval"
      meta={record?.agent ? <span className="font-mono text-[10.5px] break-all">{record.agent}</span> : undefined}
      action={
        <span className="flex flex-wrap items-center gap-3">
          {status && (
            <Status tone={status.tone} chip>
              {status.label}
            </Status>
          )}
          <Button size="sm" variant="solid" tone="neutral" href={record ? href : "/acceptance"}>
            Open Acceptance
          </Button>
        </span>
      }
    >
      {answer === null && <p className="text-[12px] text-faint">Reading the acceptance record&hellip;</p>}

      {answer?.state === "pending" && (
        <NotConnected compact door={answer.door}>
          This use case&rsquo;s acceptance record in brief: its status, how many criteria are met, the issues still open and who has signed.
        </NotConnected>
      )}

      {answer?.state === "error" && (
        <Banner
          tone="err"
          title="Could not read the acceptance record"
          action={
            <Button size="sm" variant="solid" tone="neutral" onClick={reload}>
              Try again
            </Button>
          }
        >
          {answer.message}
        </Banner>
      )}

      {answer?.state === "ok" && !record && <p className="text-[12.5px] leading-[1.6] text-dim">No acceptance record has been opened for {profile.name.toLowerCase()}.</p>}

      {record && (
        <>
          <Figures
            items={[
              { k: "Criteria met", v: criteria.length ? `${count(met)} of ${count(criteria.length)}` : "none listed" },
              { k: "Issues open", v: issues.length ? `${count(open.length)} of ${count(issues.length)}` : "none listed" },
              { k: "Roles signed", v: signoffs.length ? `${count(signed)} of ${count(signoffs.length)}` : "none named" },
            ]}
          />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Block title="Outstanding issues" meta={issues.length ? `${count(open.length)} open` : undefined}>
              {open.length === 0 ? (
                <Note>{issues.length ? "The record lists no open issue." : "The record lists no issues."}</Note>
              ) : (
                <ul className="flex flex-col overflow-hidden rounded-md border border-line">
                  {open.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-line px-3 py-2 last:border-b-0">
                      <span className="flex w-16 shrink-0">
                        <SeverityTag severity={i.severity} />
                      </span>
                      <span className="min-w-0 grow basis-[60%] text-[12px] break-words text-fg">{i.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Block>

            <Block title="Sign-offs" meta={signoffs.length ? `${count(signed)} of ${count(signoffs.length)} roles signed` : undefined}>
              {signoffs.length === 0 ? (
                <Note>The record names no sign-off roles.</Note>
              ) : (
                <ul className="flex flex-col overflow-hidden rounded-md border border-line">
                  {signoffs.map((s, i) => (
                    <li key={`${s.role}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2 last:border-b-0">
                      <span className="min-w-0 grow basis-[40%] text-[12px] font-medium break-words text-fg">{s.role}</span>
                      {s.by && <span className="text-[11.5px] text-dim">{s.by}</span>}
                      {s.at && (
                        <span className="tnum text-[11px] text-faint" title={s.at}>
                          {shortWhen(s.at)}
                        </span>
                      )}
                      {s.decision && s.stale ? <Status tone="warn">Signed an earlier version; does not count</Status> : s.decision === "accepted" ? <Status tone="ok">Accepted</Status> : s.decision === "rejected" ? <Status tone="err">Rejected</Status> : <Status tone="neutral">Not signed</Status>}
                    </li>
                  ))}
                </ul>
              )}
            </Block>
          </div>
          <Note>The criteria with their results and the runs they were measured on, the issues and the Sign control are on the Acceptance page.</Note>
        </>
      )}
    </Card>
  );
}
