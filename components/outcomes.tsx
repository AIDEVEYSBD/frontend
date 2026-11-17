"use client";

import { QUIET } from "@/lib/quiet";
import { useState } from "react";
import Link from "next/link";
import { Button, Status } from "./ui";
import { Banner } from "./overlays";
import { PageHeader } from "./section";
import { WindowPick, type Win } from "./window-pick";
import { NotConnected, useDoor } from "./pending";
import { FINDING_STATUSES, FindingStatusMark, RunLink, SEVERITIES, SeverityBar, count, runStateMeta, shortWhen } from "./finding-marks";
import { hueFor } from "@/lib/hue";
import { WORKLOADS, type FindingsSummary } from "@/lib/api/pending";

/**
 * The outcome dashboard (feature 2.4): each security workload over a time
 * window. One card per workload: how many runs, the last run and how it
 * ended, the findings by severity as one bar with its figures, the findings
 * by status, and links to the Findings page filtered to what a figure counts.
 *
 * The four workloads are the product's structure, so their cards are always
 * here; a workload the summary has nothing for says it has no runs yet. A
 * workload the summary names and this console does not know gets a card too,
 * under the id it came with. The figures are `GET /api/findings/summary`'s
 * and nothing is derived beyond adding a card's severities into its total.
 */

type Entry = FindingsSummary["workloads"][number];

const WINDOW_WORDS: Record<Win, string> = {
  "24h": "in the last 24 hours",
  "7d": "in the last 7 days",
  "30d": "in the last 30 days",
  "90d": "in the last 90 days",
  all: "on record",
};

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

function Cell({ figure, label, href }: { figure: string; label: React.ReactNode; href?: string }) {
  const inner = (
    <>
      <span className="tnum text-[17px] leading-none font-semibold tracking-[-0.01em] text-fg">{figure}</span>
      <span className="text-[10.5px] text-faint">{label}</span>
    </>
  );
  const cls = "flex min-w-0 flex-col gap-1.5 bg-surface px-3 py-2.5";
  return href ? (
    <Link href={href} className={`focusable ${cls} hover:bg-raise/50`}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

function WorkloadCard({ id, name, line, entry, state, win }: { id: string; name: string; line: string; entry: Entry | undefined; state: "reading" | "ok" | "pending" | "error"; win: Win }) {
  const findingsHref = `/findings?workload=${encodeURIComponent(id)}`;
  const bySeverity = entry?.by_severity ?? {};
  const byStatus = entry?.by_status ?? {};
  const total = SEVERITIES.reduce((a, s) => a + n(bySeverity[s]), 0);
  const runs = n(entry?.runs);
  const last = entry?.last_run;
  const nothing = !entry || (runs === 0 && total === 0 && !last);

  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1" data-workload={id}>
      <div data-hue={hueFor("finding")} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-raise/55 px-4 py-2.5">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[13px] font-semibold tracking-[-0.005em] text-fg">{name}</span>
          {line && <span className="text-[11px] leading-[1.5] text-faint">{line}</span>}
        </span>
        <span className="grow" />
        <Button size="sm" variant="solid" tone="neutral" href={findingsHref}>
          Findings
        </Button>
      </div>

      <div className="flex flex-col gap-4 p-4">
        {state === "reading" && <p className="text-[12px] text-faint">Reading the summary…</p>}
        {state === "pending" && <p className="text-[12px] text-faint">No figures: the summary is not connected on this deployment.</p>}
        {state === "error" && <p className="text-[12px] text-faint">{QUIET ? "No figures: the summary is not connected on this deployment." : "No figures: the summary could not be read."}</p>}
        {state === "ok" && nothing && <p className="text-[12px] text-faint">No runs yet{win === "all" ? "" : " in this window"}.</p>}
        {state === "ok" && !nothing && (
          <>
            <div className="grid grid-cols-[repeat(2,minmax(0,150px))_minmax(0,1fr)] gap-px overflow-hidden rounded-md border border-line bg-line">
              <Cell figure={count(runs)} label={`run${runs === 1 ? "" : "s"} ${WINDOW_WORDS[win]}`} />
              <Cell figure={count(total)} label={`finding${total === 1 ? "" : "s"}`} href={findingsHref} />
              <div className="flex min-w-0 flex-col justify-center gap-1 bg-surface px-3 py-2.5">
                <span className="text-[10.5px] text-faint">Last run</span>
                {last?.id ? (
                  <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                    <Status tone={runStateMeta(last.state).tone}>{runStateMeta(last.state).label}</Status>
                    <span className="min-w-0 break-all">
                      <RunLink run={last.id} />
                    </span>
                    {last.at && (
                      <span className="tnum text-[11px] text-faint" title={last.at}>
                        {shortWhen(last.at)}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-[11.5px] text-faint">None named by the summary.</span>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold text-dim">Findings by severity</span>
              {total === 0 ? <p className="text-[12px] text-faint">No findings {WINDOW_WORDS[win]}.</p> : <SeverityBar counts={bySeverity} href={(s) => `${findingsHref}&severity=${s}`} />}
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold text-dim">Findings by status</span>
              <div className="@container">
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line @min-[340px]:grid-cols-3 @min-[530px]:grid-cols-5">
                  {FINDING_STATUSES.map((s) => (
                    <Cell key={s} figure={count(n(byStatus[s]))} label={<FindingStatusMark status={s} />} href={`${findingsHref}&status=${s}`} />
                  ))}
                  {/* Fills the last row where five figures do not divide into the columns, so no bare gap shows. */}
                  <span className="bg-surface @min-[340px]:col-span-1 @min-[530px]:hidden" aria-hidden />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

export function OutcomesView() {
  const [win, setWin] = useState<Win>("7d");
  const { answer, reload } = useDoor<FindingsSummary>("findingsSummary", { query: { window: win } });
  const entries: Entry[] = answer?.state === "ok" && Array.isArray(answer.data?.workloads) ? answer.data.workloads : [];
  const state = answer === null ? "reading" : answer.state;
  const known = new Set<string>(WORKLOADS.map((w) => w.id));
  const others = entries.filter((e) => e && typeof e.workload === "string" && !known.has(e.workload));

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-5 px-5 py-7" data-hue="red">
      <PageHeader
        title="Outcomes"
        action={
          <span className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-faint">Window</span>
            <WindowPick value={win} onChange={setWin} />
          </span>
        }
      >
        What each security workload produced over the window: its runs, how the last one ended, and its findings by severity and by status. A figure opens the findings it counts.
      </PageHeader>

      {answer?.state === "pending" && <NotConnected door={answer.door} />}
      {answer?.state === "error" && (
        <Banner tone="err" title="Could not read the summary" action={<Button size="sm" variant="solid" tone="neutral" onClick={reload}>Try again</Button>}>
          {answer.message}
        </Banner>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {WORKLOADS.map((w) => (
          <WorkloadCard key={w.id} id={w.id} name={w.name} line={w.line} entry={entries.find((e) => e?.workload === w.id)} state={state} win={win} />
        ))}
        {others.map((e) => (
          <WorkloadCard key={e.workload} id={e.workload} name={e.workload} line="" entry={e} state={state} win={win} />
        ))}
      </div>
    </div>
  );
}
