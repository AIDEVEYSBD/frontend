"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BarSpark } from "./data";
import { Button, Status, Tag } from "./ui";
import { NavIcon } from "./nav-icons";
import { useDoor, AnswerFailure } from "./pending";
import { Card, FootNote, Nothing, ReadError } from "./overview-parts";
import { fmtAge, fmtCount } from "./overview-data";
import { SEVERITIES, type CloudFinding, type CloudFindingList, type Severity } from "@/lib/api/pending";

/**
 * The Dashboards page's own pieces. The cards, figure tiles and ranked lists
 * are the Overview page's (components/overview-parts.tsx); what is here is
 * the board switch and a column chart for a value that is not a failure
 * count (that chart's frame, `TrendBars`, is worded and toned for failures).
 */

/* ═══════════════════ board switch ═══════════════════ */

/** One board at a time: a segmented control, every segment a solid fill. */
export function BoardSwitch<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: string }[] }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-line-strong bg-raise p-0.5" role="radiogroup" aria-label="Board">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`focusable h-8 cursor-pointer rounded-[5px] px-3.5 text-[12.5px] font-medium whitespace-nowrap transition-colors ${
            value === o.id ? "bg-ink text-on-ink" : "bg-surface text-dim hover:bg-canvas hover:text-fg"
          }`}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

/** A line of plain text between the switch and the figures: an empty window, a deployment with no runs. */
export function BoardNote({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface px-3 py-2">
      <p className="min-w-0 grow text-[12px] leading-[1.5] text-dim">{children}</p>
      {action}
    </div>
  );
}

/* ═══════════════════ value per bucket ═══════════════════ */

/**
 * A value per bucket of time as columns, at the width of its card, in the
 * Overview page's chart style (`BarSpark` in a measured frame, the first
 * bucket's date and "now" under it). Each column answers a pointer with its
 * bucket and its figure; `describe` says what the chart is for a screen reader.
 */
export function ValueBars({ points, titles, from, to, describe }: { points: number[]; /** One per point: the bucket and its figure, in words. */ titles: string[]; from: string; to: string; describe: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const measure = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    measure.observe(el);
    return () => measure.disconnect();
  }, []);
  const peak = Math.max(...points);
  return (
    <div className="flex flex-col gap-1.5">
      <div ref={frame} className="relative h-12 border-b border-line-strong" role="img" aria-label={`${describe}, oldest first: ${titles.join("; ")}`}>
        {width > 0 && peak > 0 && <BarSpark points={points} width={width} height={48} tone="ink" />}
        {/* The pointer's targets: one per column, the full height of the frame, on the columns' own grid (equal widths, a 2px gap). */}
        <div className="absolute inset-0 flex gap-[2px]" aria-hidden>
          {titles.map((t, i) => (
            <span key={i} title={t} className="h-full min-w-0 flex-1 rounded-[1px] hover:bg-fg/[0.06]" />
          ))}
        </div>
      </div>
      <div className="flex justify-between font-mono text-[9.5px] text-faint">
        <span>{from}</span>
        <span>{to}</span>
      </div>
    </div>
  );
}

/* ═══════════════════ cloud security findings ═══════════════════ */

const FINDING_STATES: CloudFinding["state"][] = ["active", "muted", "fixed"];
const FINDING_STATE: Record<CloudFinding["state"], { tone: "err" | "neutral" | "ok"; label: string }> = {
  active: { tone: "err", label: "Active" },
  muted: { tone: "neutral", label: "Muted" },
  fixed: { tone: "ok", label: "Fixed" },
};
const SEVERITY_TONE: Record<Severity, "err" | "warn" | "neutral"> = { critical: "err", high: "err", medium: "warn", low: "neutral", info: "neutral" };
/** How many findings the card lists before it is asked for the rest. */
const FINDINGS_SHOWN = 8;

const rank = <T,>(list: readonly T[], v: T): number => (list.indexOf(v) < 0 ? list.length : list.indexOf(v));

/** A date as the boards write one: `16 Nov 2026, 04:22`. */
function whenText(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/**
 * The findings the cloud provider's security centre holds for this
 * deployment's resources: the ones still active first, then by severity,
 * the newest first. Each says what it is about, the resource, when it was
 * found and its state, and opens in the provider's console when the door
 * gives a link. The card is ahead of its door (`cloudFindings`,
 * lib/api/pending.ts): until it answers the card says, in one line, what it
 * will list. No finding is ever made up.
 */
export function CloudFindingsCard({ now }: { /** The board's clock, stamped when its reads land; 0 until then. */ now: number }) {
  const { answer, reload } = useDoor<CloudFindingList>("cloudFindings");
  const [all, setAll] = useState(false);
  useEffect(() => {
    const id = setInterval(reload, 60_000);
    return () => clearInterval(id);
  }, [reload]);

  const findings = useMemo(() => {
    const list = answer?.state === "ok" && Array.isArray(answer.data?.findings) ? answer.data.findings.filter((f) => f && typeof f.id === "string") : [];
    return [...list].sort(
      (a, b) => rank(FINDING_STATES, a.state) - rank(FINDING_STATES, b.state) || rank(SEVERITIES, a.severity) - rank(SEVERITIES, b.severity) || (Date.parse(b.found_at) || 0) - (Date.parse(a.found_at) || 0) || a.id.localeCompare(b.id),
    );
  }, [answer]);
  const count = (state: CloudFinding["state"]) => findings.filter((f) => f.state === state).length;
  const active = findings.filter((f) => f.state === "active");
  const worst = SEVERITIES.map((s) => ({ s, n: active.filter((f) => f.severity === s).length })).filter((x) => x.n > 0);
  const shown = all ? findings : findings.slice(0, FINDINGS_SHOWN);
  const source = answer?.state === "ok" ? answer.data?.source : undefined;
  const off = answer?.state === "pending";

  return (
    <Card
      title="Cloud security findings"
      meta={findings.length ? "active first, then by severity, newest first" : undefined}
      footer={
        <>
          <FootNote>
            {findings.length
              ? `${fmtCount(count("active"))} active${worst.length ? ` (${worst.map((x) => `${fmtCount(x.n)} ${x.s}`).join(", ")})` : ""} · ${fmtCount(count("muted"))} muted · ${fmtCount(count("fixed"))} fixed${source ? ` · from ${source}` : ""}`
              : "Findings the cloud provider's security centre holds for this deployment's resources"}
          </FootNote>
          {findings.length > FINDINGS_SHOWN && (
            <Button size="sm" onClick={() => setAll((v) => !v)}>
              {all ? `Show the first ${FINDINGS_SHOWN}` : `Show all ${fmtCount(findings.length)}`}
            </Button>
          )}
        </>
      }
    >
      {answer === null ? (
        <Nothing>Reading the cloud security findings.</Nothing>
      ) : answer.state === "pending" ? (
        <div className="p-4">
          <AnswerFailure answer={answer} />
        </div>
      ) : answer.state === "error" ? (
        <ReadError>The cloud security findings could not be read: {answer.message}</ReadError>
      ) : findings.length === 0 ? (
        <Nothing>The cloud security centre holds no finding for this deployment&rsquo;s resources.</Nothing>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-line text-left text-[10.5px] text-faint">
                <th className="py-2 pr-3 pl-4 font-medium">Severity</th>
                <th className="px-3 py-2 font-medium">Finding</th>
                <th className="px-3 py-2 font-medium">Resource</th>
                <th className="px-3 py-2 font-medium">Found</th>
                <th className="px-3 py-2 font-medium">State</th>
                <th className="py-2 pr-4 pl-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {shown.map((f) => {
                const st = FINDING_STATE[f.state] ?? { tone: "neutral" as const, label: String(f.state) };
                const found = Date.parse(f.found_at);
                const link = typeof f.url === "string" && /^https:\/\//i.test(f.url) ? f.url : "";
                return (
                  <tr key={f.id} className="border-b border-line align-top last:border-b-0">
                    <td className="py-2.5 pr-3 pl-4 whitespace-nowrap">
                      <Tag tone={SEVERITY_TONE[f.severity] ?? "neutral"}>{f.severity}</Tag>
                    </td>
                    <td className="max-w-[420px] px-3 py-2.5">
                      <span className="flex flex-col gap-0.5">
                        <span className="leading-[1.45] break-words text-fg">{f.title}</span>
                        {f.category && <span className="text-[10.5px] text-faint">{f.category}</span>}
                      </span>
                    </td>
                    <td className="max-w-[340px] px-3 py-2.5">
                      <span className="flex flex-col gap-0.5">
                        <span className="font-mono text-[11px] leading-[1.45] break-all text-dim">{f.resource}</span>
                        {f.resource_type && <span className="text-[10.5px] text-faint">{f.resource_type}</span>}
                      </span>
                    </td>
                    <td className="tnum px-3 py-2.5 whitespace-nowrap text-dim" title={whenText(f.found_at)}>
                      {Number.isNaN(found) ? "time not recorded" : now > 0 ? `${fmtAge(now - found)} ago` : whenText(f.found_at)}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <Status tone={st.tone}>{st.label}</Status>
                    </td>
                    <td className="py-2.5 pr-4 pl-3 text-right whitespace-nowrap">
                      {link && (
                        <a href={link} target="_blank" rel="noopener noreferrer" className="focusable inline-flex items-center gap-1 rounded-sm text-[11.5px] font-medium text-fg hover:underline">
                          Open finding
                          <NavIcon name="external-link" size={11} />
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
