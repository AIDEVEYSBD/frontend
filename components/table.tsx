"use client";

import { useMemo, useState } from "react";
import { Mono, Status, Tag, type Tone } from "./ui";
import { ActionMenu } from "./dropdown";
import { Meter } from "./ui";

export type Run = {
  id: string;
  subject: string;
  workflow: string;
  status: { tone: Tone; label: string };
  progress: number;
  confidence: number;
  cost: number;
  elapsed: string;
};

export const RUN_ROWS: Run[] = [
  { id: "4128", subject: "CL-88213 · R. Alvarez", workflow: "Claims Intake", status: { tone: "run", label: "Running" }, progress: 0.43, confidence: 0.93, cost: 0.84, elapsed: "04:12" },
  { id: "4127", subject: "CL-88209 · M. Okafor", workflow: "Claims Intake", status: { tone: "warn", label: "Needs review" }, progress: 0.86, confidence: 0.71, cost: 1.12, elapsed: "06:41" },
  { id: "4126", subject: "Nordic Energy — infrastructure audit", workflow: "RFP Response", status: { tone: "run", label: "Running" }, progress: 0.75, confidence: 0.86, cost: 3.4, elapsed: "12:08" },
  { id: "4125", subject: "CL-88204 · T. Lindqvist", workflow: "Claims Intake", status: { tone: "ok", label: "Passed" }, progress: 1, confidence: 0.97, cost: 0.91, elapsed: "05:02" },
  { id: "4124", subject: "CL-88198 · D. Ferreira", workflow: "Claims Intake", status: { tone: "err", label: "Failed" }, progress: 0.29, confidence: 0.44, cost: 0.36, elapsed: "01:54" },
  { id: "4123", subject: "Halden Group — compliance sweep", workflow: "Controls Review", status: { tone: "queue", label: "Queued" }, progress: 0, confidence: 0, cost: 0, elapsed: "—" },
];

type Col = "id" | "subject" | "workflow" | "confidence" | "cost" | "elapsed";

const SortGlyph = ({ dir }: { dir: "asc" | "desc" | null }) => (
  <svg
    width="10"
    height="10"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="3"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={dir ? "text-fg" : "text-ghost opacity-0 group-hover:opacity-100"}
    aria-hidden
  >
    {dir === "asc" ? <path d="M6 15l6-6 6 6" /> : <path d="M6 9l6 6 6-6" />}
  </svg>
);

/**
 * Dense data table. Sticky header, sortable columns, row selection with
 * a bulk bar, and per-row actions. Numeric columns are right-aligned and
 * tabular so the eye can scan a column without reading it.
 */
export function DataTable({ compact = false }: { compact?: boolean }) {
  const [sort, setSort] = useState<{ col: Col; dir: "asc" | "desc" }>({
    col: "id",
    dir: "desc",
  });
  const [selected, setSelected] = useState<string[]>([]);

  const rows = useMemo(() => {
    const v = [...RUN_ROWS];
    v.sort((a, b) => {
      const x = a[sort.col];
      const y = b[sort.col];
      const cmp = typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y));
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return v;
  }, [sort]);

  const allOn = selected.length === rows.length;
  const toggleAll = () => setSelected(allOn ? [] : rows.map((r) => r.id));
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const head = (col: Col, label: string, align: "l" | "r" = "l") => {
    const active = sort.col === col;
    return (
      <th
        className={`sticky top-0 z-10 bg-raise ${align === "r" ? "text-right" : "text-left"}`}
      >
        <button
          onClick={() =>
            setSort((s) =>
              s.col === col ? { col, dir: s.dir === "asc" ? "desc" : "asc" } : { col, dir: "asc" },
            )
          }
          className={`group focusable inline-flex w-full cursor-pointer items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
            align === "r" ? "justify-end" : ""
          } ${active ? "text-fg" : "text-faint hover:text-dim"}`}
        >
          {label}
          <SortGlyph dir={active ? sort.dir : null} />
        </button>
      </th>
    );
  };

  const cell = compact ? "py-2" : "py-3";

  return (
    <div className="flex flex-col">
      {/* Bulk bar replaces the header row rather than stacking on it. */}
      <div
        className={`flex items-center justify-between gap-3 rounded-t-lg border border-b-0 border-line px-3 py-2 transition-colors ${
          selected.length ? "bg-raise" : "bg-surface"
        }`}
      >
        {selected.length ? (
          <>
            <span className="text-[12.5px] font-medium">
              {selected.length} selected
            </span>
            <div className="flex items-center gap-1.5">
              <button className="focusable cursor-pointer rounded-sm px-2 py-1 text-[12.5px] text-dim transition-colors hover:bg-surface hover:text-fg">
                Re-run
              </button>
              <button className="focusable cursor-pointer rounded-sm px-2 py-1 text-[12.5px] text-dim transition-colors hover:bg-surface hover:text-fg">
                Export
              </button>
              <button className="focusable cursor-pointer rounded-sm px-2 py-1 text-[12.5px] text-err transition-colors hover:bg-err-bg">
                Abort
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="text-[12.5px] text-faint">
              {rows.length} runs
            </span>
            <Mono className="text-[11px] text-ghost">updated 12s ago</Mono>
          </>
        )}
      </div>

      <div className="max-h-[380px] overflow-auto rounded-b-lg border border-line">
        <table className="w-full min-w-[820px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line-strong">
              <th className="sticky top-0 z-10 w-9 bg-raise pl-3">
                <button
                  role="checkbox"
                  aria-checked={allOn}
                  onClick={toggleAll}
                  className={`focusable grid size-3.5 cursor-pointer place-items-center rounded-xs border transition-colors ${
                    allOn ? "border-ink bg-ink text-on-ink" : "border-line-strong"
                  }`}
                >
                  {allOn && (
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M4 13l5 5 11-13" />
                    </svg>
                  )}
                </button>
              </th>
              {head("id", "Run")}
              {head("subject", "Subject")}
              {head("workflow", "Workflow")}
              <th className="sticky top-0 z-10 bg-raise py-2.5 text-left text-[11px] font-medium text-faint">
                Status
              </th>
              <th className="sticky top-0 z-10 bg-raise py-2.5 text-left text-[11px] font-medium text-faint">
                Progress
              </th>
              {head("confidence", "Conf.", "r")}
              {head("cost", "Cost", "r")}
              {head("elapsed", "Elapsed", "r")}
              <th className="sticky top-0 z-10 w-10 bg-raise" />
            </tr>
          </thead>

          <tbody>
            {rows.map((r) => {
              const on = selected.includes(r.id);
              return (
                <tr
                  key={r.id}
                  className={`group border-b border-line transition-colors last:border-0 ${
                    on ? "bg-raise" : "hover:bg-raise"
                  }`}
                >
                  <td className={`${cell} pl-3`}>
                    <button
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggle(r.id)}
                      className={`focusable grid size-3.5 cursor-pointer place-items-center rounded-xs border transition-colors ${
                        on ? "border-ink bg-ink text-on-ink" : "border-line-strong"
                      }`}
                    >
                      {on && (
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M4 13l5 5 11-13" />
                        </svg>
                      )}
                    </button>
                  </td>
                  <td className={cell}>
                    <Mono className="text-[11.5px] text-faint">{r.id}</Mono>
                  </td>
                  <td className={`${cell} max-w-[240px] pr-4`}>
                    <span className="block truncate text-[13px] font-medium">{r.subject}</span>
                  </td>
                  <td className={`${cell} pr-4`}>
                    <Tag>{r.workflow}</Tag>
                  </td>
                  <td className={`${cell} pr-4`}>
                    <Status tone={r.status.tone}>{r.status.label}</Status>
                  </td>
                  <td className={`${cell} w-[110px] pr-4`}>
                    <Meter
                      value={r.progress}
                      tone={r.status.tone === "err" ? "err" : r.progress === 1 ? "ok" : "run"}
                    />
                  </td>
                  <td className={`${cell} pr-4 text-right`}>
                    <span
                      className={`tnum font-mono text-[12px] ${
                        r.confidence && r.confidence < 0.85 ? "text-warn" : "text-dim"
                      }`}
                    >
                      {r.confidence ? r.confidence.toFixed(2) : "—"}
                    </span>
                  </td>
                  <td className={`${cell} pr-4 text-right`}>
                    <span className="tnum font-mono text-[12px] text-dim">
                      {r.cost ? `$${r.cost.toFixed(2)}` : "—"}
                    </span>
                  </td>
                  <td className={`${cell} pr-4 text-right`}>
                    <span className="tnum font-mono text-[12px] text-dim">{r.elapsed}</span>
                  </td>
                  <td className={`${cell} pr-2`}>
                    <div className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <ActionMenu
                        items={[
                          { label: "Open run", kbd: "↵" },
                          { label: "View trace", kbd: "T" },
                          { label: "Re-run", kbd: "R" },
                        ]}
                        destructive="Abort run"
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
