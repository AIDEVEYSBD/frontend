"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Button, Status } from "./ui";
import { Banner, EmptyState } from "./overlays";
import { GroupHeader } from "./page-tabs";
import { NotConnected, NotConnectedNote, useDoor } from "./pending";
import { DigestChip } from "./digest-chip";
import { RunLink, SeverityTag, acceptanceStatusMeta, count, shortWhen, workloadName } from "./finding-marks";
import { CloseIssueDialog, CriteriaDialog, DIRECTION_WORDS, IssueDialog, ResultDialog, SignDialog } from "./acceptance-dialogs";
import { hueFor } from "@/lib/hue";
import { useSession } from "@/lib/use-session";
import { WORKLOADS, type Acceptance, type AcceptanceCriterion, type AcceptanceIssue, type AcceptanceList, type AcceptanceSignoff, type UseCaseList } from "@/lib/api/pending";

/**
 * Acceptance (feature 12.5): the record of each use case's acceptance.
 *
 * One section per record, as `GET /api/acceptance` returns it. A record is
 * opened for a registered use case (keyed by the workload the use case uses)
 * by a person with `configure`, who sets its criteria and names the one
 * person who signs each accountable role (`PUT /api/acceptance/{use_case}`).
 * Results are entered by people against a finished run of the use case, and
 * the platform works out whether each criterion is met from its threshold and
 * direction; issues are opened and closed with who did it; and each role is
 * signed by the person it names, and by nobody else.
 *
 * A signature binds to the record as it stood when it was signed (`digest`):
 * one the platform marks `stale` signed an earlier version and does not
 * count. The page reports the record and decides nothing: a use case reads
 * as accepted only when its record's status says so, a criterion as met only
 * when the record says so. The writes are in components/acceptance-dialogs.tsx.
 */

const DECISION: Record<"accepted" | "rejected", { label: string; tone: "ok" | "err" }> = {
  accepted: { label: "Accepted", tone: "ok" },
  rejected: { label: "Rejected", tone: "err" },
};

const CRITERIA_HEAD = ["Criterion", "Metric", "Threshold", "Result", "Met", "Measured on", ""];
const SIGNOFF_HEAD = ["Role", "Signed by", "Decision", ""];

const figure = (v: unknown): string => (typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("en-GB", { maximumFractionDigits: 4 }) : "");
const who = (p: { email: string; name?: string } | undefined): string => (p ? p.name || p.email : "");
const same = (a: string | undefined, b: string | undefined): boolean => Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

function Rows({ head, right = [], min = 640, children }: { head: string[]; right?: number[]; min?: number; children?: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full border-collapse text-[11.5px]" style={{ minWidth: min }}>
        <thead>
          <tr className="border-b border-line bg-raise/40 text-left text-[10.5px] text-faint last:border-b-0">
            {head.map((h, i) => (
              <th key={`${h}-${i}`} className={`px-3 py-1.5 font-medium whitespace-nowrap ${right.includes(i) ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        {children && <tbody>{children}</tbody>}
      </table>
    </div>
  );
}

function Block({ title, meta, action, children }: { title: string; meta?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[12px] font-semibold text-fg">{title}</span>
        {meta && <span className="tnum text-[11px] text-faint">{meta}</span>}
        {action && (
          <>
            <span className="grow" />
            {action}
          </>
        )}
      </span>
      {children}
    </div>
  );
}

/** Whether a criterion is met, as the record says: met, not met, or why there is no verdict. */
function Met({ c }: { c: AcceptanceCriterion }) {
  if (c.met === true) return <Status tone="ok">Met</Status>;
  if (c.met === false) return <Status tone="err">Not met</Status>;
  if (typeof c.threshold !== "number") return <Status tone="neutral">No threshold set</Status>;
  if (typeof c.result !== "number") return <Status tone="neutral">No result yet</Status>;
  return <Status tone="neutral">Not stated</Status>;
}

/** Where a criterion's result came from: the run, who entered it and when, and their note; or the evaluation that wrote it. */
function Measured({ c }: { c: AcceptanceCriterion }) {
  if (!c.run && !c.eval_run && !c.entered_by && !c.measured_at) return <span className="text-faint">nothing entered</span>;
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      {c.run && (
        <span className="break-all">
          <RunLink run={c.run} />
        </span>
      )}
      {c.eval_run && (
        <span className="text-dim">
          from eval run{" "}
          <Link href="/evals" className="focusable rounded-sm font-mono text-[10.5px] text-dim underline decoration-line-strong underline-offset-2 hover:text-fg">
            {c.eval_run}
          </Link>
        </span>
      )}
      {(c.entered_by || c.measured_at) && (
        <span className="text-[10.5px] text-faint" title={[c.entered_by?.email, c.measured_at].filter(Boolean).join(" · ")}>
          {c.entered_by ? `entered by ${who(c.entered_by)}` : "entered"}
          {c.measured_at ? `, ${shortWhen(c.measured_at)}` : ""}
        </span>
      )}
      {c.note && <span className="text-[11px] break-words text-dim">{c.note}</span>}
    </span>
  );
}

/** Who opened an issue and when, and who closed it, when, and why. */
function IssueTrail({ i }: { i: AcceptanceIssue }) {
  return (
    <span className="flex flex-col gap-0.5 text-[10.5px] text-faint">
      <span title={i.opened_by?.email}>
        opened{i.opened_by ? ` by ${who(i.opened_by)}` : ""}
        {i.opened_at ? `, ${shortWhen(i.opened_at)}` : ""}
      </span>
      {i.state === "closed" && (
        <span title={i.closed_by?.email}>
          closed{i.closed_by ? ` by ${who(i.closed_by)}` : ""}
          {i.closed_at ? `, ${shortWhen(i.closed_at)}` : ""}
          {i.note ? `: ${i.note}` : ""}
        </span>
      )}
    </span>
  );
}

/** A role's decision: none, a decision that counts, or one given on an earlier version of the record, which does not. */
function SignoffDecision({ s }: { s: AcceptanceSignoff }) {
  if (!s.decision || !DECISION[s.decision]) return <Status tone="neutral">Not signed</Status>;
  const d = DECISION[s.decision];
  if (s.stale)
    return (
      <span className="flex flex-col gap-0.5" data-stale="true">
        <span className="text-[11px] text-faint line-through decoration-faint">{d.label}</span>
        <span className="text-[10.5px] leading-[1.45] text-warn">signed an earlier version of this record; it does not count</span>
      </span>
    );
  return (
    <span className="flex flex-col gap-0.5">
      <Status tone={d.tone}>{d.label}</Status>
      {s.by && !same(s.by, s.person?.email) && s.by !== s.person?.name && <span className="text-[10.5px] text-faint">by {s.by}</span>}
    </span>
  );
}

/* ═══════════════════ one use case ═══════════════════ */

type Open = { kind: "criteria" } | { kind: "result"; criterion: AcceptanceCriterion } | { kind: "issue" } | { kind: "close"; issue: AcceptanceIssue } | { kind: "sign"; signoff: AcceptanceSignoff } | null;

/** One use case's record, with the writes a person may make on it. `me` is the signed-in person's email: the roles naming it can be signed. */
export function AcceptanceRecord({ record, name, me, onChanged }: { record: Acceptance; name?: string; me: string; onChanged: () => void }) {
  const r = record;
  const [open, setOpen] = useState<Open>(null);
  const criteria = Array.isArray(r.criteria) ? r.criteria : [];
  const issues = Array.isArray(r.issues) ? r.issues : [];
  const signoffs = Array.isArray(r.signoffs) ? r.signoffs : [];
  const status = acceptanceStatusMeta(r.status);
  const met = criteria.filter((c) => c.met === true).length;
  const notMet = criteria.filter((c) => c.met === false).length;
  const unstated = criteria.length - met - notMet;
  const openIssues = issues.filter((i) => i.state === "open").length;
  // Only a signature on the record as it stands counts; one given on an earlier version is shown and not counted.
  const signed = signoffs.filter((s) => s.decision && !s.stale).length;
  const stale = signoffs.filter((s) => s.decision && s.stale).length;
  const done = () => {
    setOpen(null);
    onChanged();
  };

  return (
    <section id={r.use_case} className="flex min-w-0 scroll-mt-4 flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1" data-use-case={r.use_case}>
      <div data-hue={hueFor("approval")} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-raise/55 px-4 py-2.5">
        <span className="text-[13px] font-semibold tracking-[-0.005em] text-fg">{name || workloadName(r.use_case)}</span>
        <span className="font-mono text-[10.5px] text-faint">{r.use_case}</span>
        {r.agent && <span className="font-mono text-[10.5px] break-all text-faint">{r.agent}</span>}
        <span className="grow" />
        {r.digest && (
          <span className="flex items-center gap-1.5">
            <span className="text-[11px] text-faint">Record</span>
            <DigestChip digest={r.digest} label="Record digest" />
          </span>
        )}
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-faint">Record status</span>
          <Status tone={status.tone} chip>
            {status.label}
          </Status>
        </span>
        <Button size="sm" variant="solid" tone="neutral" permission="configure" onClick={() => setOpen({ kind: "criteria" })}>
          Set criteria and sign-off
        </Button>
      </div>

      <div className="flex flex-col gap-5 p-4">
        <Block
          title="Criteria"
          meta={criteria.length ? [`${count(met)} met`, `${count(notMet)} not met`, unstated ? `${count(unstated)} without a verdict` : ""].filter(Boolean).join(" · ") : undefined}
        >
          {criteria.length === 0 ? (
            <p className="text-[12px] text-faint">The record lists no criteria.</p>
          ) : (
            <Rows head={CRITERIA_HEAD} right={[2, 3]} min={980}>
              {criteria.map((c) => (
                <tr key={c.id} className="border-b border-line align-top last:border-0">
                  <td className="max-w-[420px] px-3 py-2">
                    <span className="text-[12px] break-words text-fg">{c.text}</span>
                    <div className="font-mono text-[10.5px] text-faint">{c.id}</div>
                  </td>
                  <td className="px-3 py-2 text-dim">{c.metric ?? ""}</td>
                  <td className="tnum px-3 py-2 text-right whitespace-nowrap text-dim">
                    {typeof c.threshold === "number" ? (
                      `${c.direction ? `${DIRECTION_WORDS[c.direction]} ` : ""}${figure(c.threshold)}`
                    ) : (
                      <span className="text-faint">none</span>
                    )}
                  </td>
                  <td className="tnum px-3 py-2 text-right font-medium text-fg">{figure(c.result) || <span className="font-normal text-faint">none</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Met c={c} />
                  </td>
                  <td className="max-w-[260px] px-3 py-2">
                    <Measured c={c} />
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Button size="sm" variant="solid" tone="neutral" permission="configure" onClick={() => setOpen({ kind: "result", criterion: c })}>
                      Enter a result
                    </Button>
                  </td>
                </tr>
              ))}
            </Rows>
          )}
          {r.eval_run && (
            <p className="text-[11.5px] text-faint">
              Results written by eval run{" "}
              <Link href="/evals" className="focusable rounded-sm font-mono text-[10.5px] text-dim underline decoration-line-strong underline-offset-2 hover:text-fg">
                {r.eval_run}
              </Link>
              .
            </p>
          )}
        </Block>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          <Block
            title="Issues"
            meta={issues.length ? `${count(openIssues)} open of ${count(issues.length)}` : undefined}
            action={
              <Button size="sm" variant="solid" tone="neutral" permission="configure" onClick={() => setOpen({ kind: "issue" })}>
                Open an issue
              </Button>
            }
          >
            {issues.length === 0 ? (
              <p className="text-[12px] text-faint">The record lists no issues.</p>
            ) : (
              <ul className="flex flex-col overflow-hidden rounded-md border border-line">
                {issues.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-line px-3 py-2 last:border-b-0">
                    <span className="flex w-14 shrink-0">
                      <SeverityTag severity={i.severity} />
                    </span>
                    <span className="flex min-w-0 grow basis-[50%] flex-col gap-0.5">
                      <span className="text-[12px] break-words text-fg">{i.text}</span>
                      <span className="font-mono text-[10.5px] text-faint">{i.id}</span>
                      <IssueTrail i={i} />
                    </span>
                    <span className="flex flex-col items-end gap-1.5">
                      {i.state === "closed" ? <Status tone="ok">Closed</Status> : <Status tone="warn">Open</Status>}
                      {i.state === "open" && (
                        <Button size="sm" variant="solid" tone="neutral" permission="configure" onClick={() => setOpen({ kind: "close", issue: i })}>
                          Close
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Block>

          <Block title="Sign-offs" meta={signoffs.length ? `${count(signed)} of ${count(signoffs.length)} roles signed${stale ? ` · ${count(stale)} on an earlier version, not counted` : ""}` : undefined}>
            {signoffs.length === 0 ? (
              <p className="text-[12px] text-faint">The record names no sign-off roles.</p>
            ) : (
              <Rows head={SIGNOFF_HEAD} min={560}>
                {signoffs.map((s, i) => {
                  const mine = same(s.person?.email, me);
                  const counts = Boolean(s.decision) && !s.stale;
                  return (
                    <tr key={`${s.role}-${i}`} className="border-b border-line align-top last:border-0">
                      <td className="px-3 py-2 text-[12px] font-medium text-fg">{s.role}</td>
                      <td className="px-3 py-2">
                        <span className="flex min-w-0 flex-col">
                          {s.person?.name && <span className="text-dim">{s.person.name}</span>}
                          <span className="font-mono text-[10.5px] break-words text-faint">{s.person?.email || "no person named"}</span>
                        </span>
                      </td>
                      <td className="max-w-[300px] px-3 py-2">
                        <span className="flex flex-col gap-0.5">
                          <SignoffDecision s={s} />
                          {s.at && (
                            <span className="tnum text-[10.5px] text-faint" title={s.at}>
                              {shortWhen(s.at)}
                            </span>
                          )}
                          {s.note && <span className="text-[11px] break-words text-dim">{s.note}</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {mine ? (
                          <Button size="sm" variant="solid" tone="ink" permission="approve" onClick={() => setOpen({ kind: "sign", signoff: s })}>
                            {counts ? "Sign again" : "Sign"}
                          </Button>
                        ) : (
                          <span className="text-[11px] break-words text-faint">{counts ? `signed by ${s.person?.email ?? ""}` : s.decision ? `to be signed again by ${s.person?.email ?? ""}` : `to be signed by ${s.person?.email ?? ""}`}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </Rows>
            )}
          </Block>
        </div>
      </div>

      {open?.kind === "criteria" && <CriteriaDialog record={r} name={name} choices={[]} onDone={done} onClose={() => setOpen(null)} />}
      {open?.kind === "result" && <ResultDialog record={r} criterion={open.criterion} onDone={done} onClose={() => setOpen(null)} />}
      {open?.kind === "issue" && <IssueDialog record={r} name={name} onDone={done} onClose={() => setOpen(null)} />}
      {open?.kind === "close" && <CloseIssueDialog record={r} issue={open.issue} onDone={done} onClose={() => setOpen(null)} />}
      {open?.kind === "sign" && <SignDialog record={r} name={name} signoff={open.signoff} onDone={done} onClose={() => setOpen(null)} />}
    </section>
  );
}

/* ═══════════════════ the page ═══════════════════ */

export function AcceptanceView() {
  const { answer, reload } = useDoor<AcceptanceList>("acceptance");
  // A record is opened for a registered use case: the register says which exist, by the workload each uses.
  const { answer: registered } = useDoor<UseCaseList>("useCases");
  const { session } = useSession();
  const [opening, setOpening] = useState(false);
  const [opened, setOpened] = useState("");

  const order = (id: string) => {
    const i = WORKLOADS.findIndex((w) => w.id === id);
    return i < 0 ? WORKLOADS.length : i;
  };
  const records = useMemo(
    () => (answer?.state === "ok" && Array.isArray(answer.data?.use_cases) ? [...answer.data.use_cases].sort((a, b) => order(a.use_case) - order(b.use_case) || a.use_case.localeCompare(b.use_case)) : []),
    [answer],
  );
  const useCases = registered?.state === "ok" && Array.isArray(registered.data?.use_cases) ? registered.data.use_cases : null;
  const nameOf = (key: string) => useCases?.find((u) => u.workload === key)?.name;
  const choices = useMemo(() => {
    if (!useCases || answer?.state !== "ok") return [];
    const have = new Set(records.map((r) => r.use_case));
    return useCases.filter((u) => u.workload && !have.has(u.workload)).map((u) => ({ key: u.workload, name: u.name }));
  }, [useCases, records, answer]);
  const canOpen = answer?.state === "ok" && choices.length > 0;
  const why =
    answer?.state !== "ok"
      ? "The acceptance records have not been read."
      : registered?.state !== "ok"
        ? "The registered use cases have not been read."
        : choices.length === 0
          ? useCases && useCases.length
            ? "Every registered use case already has a record: change one from its own section."
            : "No use case is registered."
          : undefined;

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-5 px-5 py-7" data-hue="amber">
      <GroupHeader
        group="quality"
        tab="acceptance"
        actions={
          <Button size="sm" variant="solid" tone="ink" permission="configure" disabled={!canOpen} title={why} onClick={() => setOpening(true)}>
            Set criteria and sign-off
          </Button>
        }
      >
        Each use case&rsquo;s criteria, results, issues and sign-offs.
      </GroupHeader>

      {opened && (
        <Banner tone="ok" title="Record saved" action={<Button size="sm" variant="solid" tone="neutral" onClick={() => setOpened("")}>Dismiss</Button>}>
          The acceptance record of {nameOf(opened) ?? workloadName(opened)} is open below.
        </Banner>
      )}

      {registered?.state === "pending" && (
        <p className="text-[11.5px] leading-[1.5] text-faint">
          Registered use cases: <NotConnectedNote door={registered.door} />
        </p>
      )}
      {registered?.state === "error" && (
        <p className="text-[11.5px] leading-[1.5] text-err" role="alert">
          The registered use cases could not be read: {registered.message}
        </p>
      )}
      {answer?.state === "ok" && records.length > 0 && choices.length > 0 && (
        <p className="text-[11.5px] leading-[1.5] text-faint">
          {choices.length === 1 ? "One registered use case has" : `${count(choices.length)} registered use cases have`} no acceptance record yet: {choices.map((c) => c.name).join(", ")}.
        </p>
      )}

      {answer === null && <p className="text-[12px] text-faint">Reading the acceptance records…</p>}

      {answer?.state === "error" && (
        <Banner tone="err" title="Could not read the acceptance records" action={<Button size="sm" variant="solid" tone="neutral" onClick={reload}>Try again</Button>}>
          {answer.message}
        </Banner>
      )}

      {answer?.state === "pending" && (
        <>
          <NotConnected door={answer.door} />
          <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
            <div data-hue={hueFor("approval")} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-raise/55 px-4 py-2.5">
              <span className="text-[13px] font-semibold tracking-[-0.005em] text-fg">A use case&rsquo;s record</span>
              <span className="text-[11px] text-faint">none read</span>
            </div>
            <div className="flex flex-col gap-5 p-4">
              <Block title="Criteria">
                <Rows head={CRITERIA_HEAD} right={[2, 3]} min={980} />
              </Block>
              <Block title="Sign-offs">
                <Rows head={SIGNOFF_HEAD} min={560} />
              </Block>
            </div>
          </section>
        </>
      )}

      {answer?.state === "ok" &&
        records.length === 0 &&
        (useCases && useCases.length === 0 ? (
          <EmptyState
            title="No use case is registered"
            detail="Register one on the Workloads page."
            action={
              <Button size="sm" variant="solid" tone="neutral" href="/workloads#use-cases">
                Open Use cases
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No acceptance record yet"
            detail={choices.length ? "Open one with “Set criteria and sign-off”." : undefined}
          />
        ))}

      {records.map((r) => (
        <AcceptanceRecord key={r.use_case} record={r} name={nameOf(r.use_case)} me={session?.email ?? ""} onChanged={reload} />
      ))}

      {opening && (
        <CriteriaDialog
          record={null}
          choices={choices}
          onDone={(key) => {
            setOpening(false);
            setOpened(key);
            reload();
          }}
          onClose={() => setOpening(false)}
        />
      )}
    </div>
  );
}
