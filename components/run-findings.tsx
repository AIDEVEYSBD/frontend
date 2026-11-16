"use client";

import Link from "next/link";
import { Button } from "./ui";
import { NotConnected, useDoor } from "./pending";
import { FindingStatusMark, SEVERITIES, SEVERITY_META, SeverityTag, bySeverityThenRecent, count, severityMeta } from "./finding-marks";
import type { Finding, FindingList } from "@/lib/api/pending";

/**
 * The results workspace of one run (feature 2.5): the findings it reported,
 * grouped by severity, each with its status and a link to the finding, and a
 * link to the Findings page filtered to this run. Compact, for the run page.
 * It reads `GET /api/findings?run=`; until that door answers it says so in
 * one small panel and shows no row.
 */

const LIMIT = 200;

export function RunFindings({ run }: { run: string }) {
  const { answer } = useDoor<FindingList>("findings", { query: { run, limit: LIMIT }, skip: !run });
  const all = `/findings?run=${encodeURIComponent(run)}`;

  if (answer?.state === "pending") {
    return (
      <NotConnected compact door={answer.door}>
        The findings this run reported, grouped by severity, with the status of each.
      </NotConnected>
    );
  }

  const rows: Finding[] = answer?.state === "ok" && Array.isArray(answer.data?.findings) ? [...answer.data.findings].sort(bySeverityThenRecent) : [];
  const total = answer?.state === "ok" && typeof answer.data?.total === "number" ? answer.data.total : rows.length;
  // Known severities in their order, then any the vocabulary does not know.
  const groups = [...SEVERITIES, ...[...new Set(rows.map((f) => f.severity as string))].filter((s) => !(s in SEVERITY_META))]
    .map((s) => ({ severity: s, items: rows.filter((f) => f.severity === s) }))
    .filter((g) => g.items.length > 0);

  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-md border border-line bg-surface" data-run-findings={run}>
      <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-raise/55 px-3 py-1.5">
        <span className="text-[12px] font-semibold text-fg">Findings</span>
        {answer?.state === "ok" && (
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="tnum text-[11px] text-faint">{count(total)} reported</span>
            {groups.map((g) => (
              <span key={g.severity} className="flex items-center gap-1 text-[11px] text-dim">
                <span className="tnum font-semibold text-fg">{count(g.items.length)}</span>
                {severityMeta(g.severity).label.toLowerCase()}
              </span>
            ))}
          </span>
        )}
        <span className="grow" />
        <Button size="sm" variant="solid" tone="neutral" href={all}>
          Open in Findings
        </Button>
      </div>

      {answer === null && <p className="px-3 py-2.5 text-[11.5px] text-faint">Reading the findings…</p>}
      {answer?.state === "error" && <p className="px-3 py-2.5 text-[11.5px] text-err">Could not read this run&rsquo;s findings: {answer.message}</p>}
      {answer?.state === "ok" && rows.length === 0 && <p className="px-3 py-2.5 text-[11.5px] text-faint">This run reported no findings.</p>}

      {groups.map((g) => (
        <div key={g.severity} className="flex flex-col border-b border-line last:border-b-0">
          <div className="flex items-center gap-2 bg-canvas px-3 py-1.5">
            <SeverityTag severity={g.severity} />
            <span className="tnum text-[11px] text-faint">{count(g.items.length)}</span>
          </div>
          <ul className="flex flex-col">
            {g.items.map((f) => (
              <li key={f.id} className="border-t border-line">
                <Link href={`${all}&id=${encodeURIComponent(f.id)}`} className="focusable flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5 hover:bg-raise/50">
                  <span className="min-w-0 grow basis-[60%] text-[12px] font-medium break-words text-fg">{f.title || f.id}</span>
                  <FindingStatusMark status={f.status} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {answer?.state === "ok" && total > rows.length && (
        <p className="border-t border-line px-3 py-1.5 text-[11px] text-faint">
          The first {count(rows.length)} of {count(total)} are listed here; the Findings page has the rest.
        </p>
      )}
    </section>
  );
}
