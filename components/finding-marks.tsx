"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { RUN_STATE, Status, Tag, type Tone } from "./ui";
import { FINDING_STATUSES, SEVERITIES, WORKLOADS, type Acceptance, type Finding, type FindingStatus, type Severity } from "@/lib/api/pending";

/**
 * The words and tones of findings, in one place.
 *
 * Findings, the results workspace on a run, the outcome dashboard and the
 * acceptance records all name a severity and a status. They read them here,
 * so "High" and "Confirmed" look and read the same on all four. A tone never
 * stands alone: every mark is a word, and the square or the bar segment only
 * repeats what the word says.
 *
 * Severity is a classification (a tag): critical and high in the error tone,
 * medium in the warning tone, low and info neutral. Critical is the filled
 * tag, so it is told from high without relying on the hue.
 * Status is a state (a word with a square mark).
 */

export const SEVERITY_META: Record<Severity, { label: string; tone: Tone; solid: boolean; bar: string }> = {
  critical: { label: "Critical", tone: "err", solid: true, bar: "bg-err" },
  high: { label: "High", tone: "err", solid: false, bar: "bg-err/55" },
  medium: { label: "Medium", tone: "warn", solid: false, bar: "bg-warn" },
  low: { label: "Low", tone: "neutral", solid: false, bar: "bg-ghost/60" },
  info: { label: "Info", tone: "neutral", solid: false, bar: "bg-line-strong" },
};

export const FINDING_STATUS_META: Record<FindingStatus, { label: string; tone: Tone; means: string }> = {
  open: { label: "Open", tone: "warn", means: "Reported by a run and not yet looked at" },
  confirmed: { label: "Confirmed", tone: "err", means: "A person agreed it is real; not yet fixed" },
  false_positive: { label: "False positive", tone: "neutral", means: "A person judged it not to be a real issue" },
  accepted: { label: "Risk accepted", tone: "neutral", means: "Real, and left as it is by decision" },
  remediated: { label: "Remediated", tone: "ok", means: "Reported as fixed" },
};

export const ACCEPTANCE_STATUS_META: Record<Acceptance["status"], { label: string; tone: Tone }> = {
  not_started: { label: "Not started", tone: "neutral" },
  in_test: { label: "In test", tone: "run" },
  accepted: { label: "Accepted", tone: "ok" },
  accepted_with_issues: { label: "Accepted with issues", tone: "warn" },
  rejected: { label: "Rejected", tone: "err" },
};

const words = (raw: string): string => {
  const s = raw.replace(/_/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "Unknown";
};

/** A value the vocabulary does not know is shown as it came, in the neutral tone. */
export const severityMeta = (s: string) => SEVERITY_META[s as Severity] ?? { label: words(s), tone: "neutral" as Tone, solid: false, bar: "bg-line-strong" };
export const findingStatusMeta = (s: string) => FINDING_STATUS_META[s as FindingStatus] ?? { label: words(s), tone: "neutral" as Tone, means: "" };
export const acceptanceStatusMeta = (s: string) => ACCEPTANCE_STATUS_META[s as Acceptance["status"]] ?? { label: words(s), tone: "neutral" as Tone };
export const runStateMeta = (s: string) => RUN_STATE[s] ?? { label: words(s), tone: "neutral" as Tone };

/** Most severe first; an unknown severity sorts last. */
export const severityRank = (s: string): number => {
  const i = SEVERITIES.indexOf(s as Severity);
  return i < 0 ? SEVERITIES.length : i;
};

/** The order every list of findings takes: severity, then the most recent first. */
export function bySeverityThenRecent(a: Finding, b: Finding): number {
  const d = severityRank(a.severity) - severityRank(b.severity);
  if (d) return d;
  return (b.updated_at || b.created_at || "").localeCompare(a.updated_at || a.created_at || "");
}

export function countBySeverity(findings: readonly Finding[]): Record<Severity, number> {
  const out: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) if (f.severity in out) out[f.severity] += 1;
  return out;
}

/** A workload's name as the product says it; an id it does not know is shown as it came. */
export const workloadName = (id: string): string => WORKLOADS.find((w) => w.id === id)?.name ?? id;

/** `2026-11-17 09:12`, in UTC as recorded; the full stamp is the caller's `title`. */
export const shortWhen = (iso: string | null | undefined): string => (iso ? iso.replace("T", " ").slice(0, 16) : "");

export const count = (n: number): string => n.toLocaleString("en-GB");

export function SeverityTag({ severity }: { severity: string }) {
  const m = severityMeta(severity);
  // The filled tag keeps a border of its own colour, so it stands exactly as tall as the bordered ones beside it.
  if (m.solid) return <span className="inline-flex items-center rounded-sm border border-err bg-err px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap text-on-solid">{m.label}</span>;
  return <Tag tone={m.tone}>{m.label}</Tag>;
}

export function FindingStatusMark({ status }: { status: string }) {
  const m = findingStatusMeta(status);
  return <Status tone={m.tone}>{m.label}</Status>;
}

/** A run's id as a link to the run, optionally at one journal entry. */
export function RunLink({ run, entry, children }: { run: string; entry?: string; children?: ReactNode }) {
  const href = `/runs?id=${encodeURIComponent(run)}${entry ? `&entry=${encodeURIComponent(entry)}` : ""}`;
  return (
    <Link href={href} onClick={(e) => e.stopPropagation()} className="focusable rounded-sm font-mono text-[10.5px] text-dim underline decoration-line-strong underline-offset-2 hover:text-fg hover:decoration-fg">
      {children ?? run}
    </Link>
  );
}

/**
 * Findings by severity as one stacked bar with its legend. The legend carries
 * the word and the figure for every severity, so the bar adds proportion and
 * nothing else. `href` makes each legend entry a link to the findings behind it.
 */
export function SeverityBar({ counts, href }: { counts: Partial<Record<Severity, number>>; href?: (s: Severity) => string }) {
  const n = (s: Severity) => Math.max(0, Number(counts[s]) || 0);
  const total = SEVERITIES.reduce((a, s) => a + n(s), 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-2.5 w-full gap-px overflow-hidden rounded-[2px] bg-raise" role="img" aria-label={SEVERITIES.map((s) => `${SEVERITY_META[s].label} ${n(s)}`).join(", ")}>
        {SEVERITIES.filter((s) => n(s) > 0).map((s) => (
          <span key={s} className={`h-full ${SEVERITY_META[s].bar}`} style={{ width: `${(n(s) / total) * 100}%` }} title={`${SEVERITY_META[s].label}: ${count(n(s))}`} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {SEVERITIES.map((s) => {
          const inner = (
            <>
              <span className={`size-2 shrink-0 rounded-[2px] ${SEVERITY_META[s].bar}`} />
              <span className="text-[11px] text-dim">{SEVERITY_META[s].label}</span>
              <span className="tnum text-[11.5px] font-semibold text-fg">{count(n(s))}</span>
            </>
          );
          return href ? (
            <Link key={s} href={href(s)} className="focusable flex items-center gap-1.5 rounded-sm hover:underline">
              {inner}
            </Link>
          ) : (
            <span key={s} className="flex items-center gap-1.5">
              {inner}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export { FINDING_STATUSES, SEVERITIES };
