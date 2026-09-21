"use client";

import { useEffect, type ReactNode } from "react";
import { Button } from "./ui";

/**
 * The drill-down: any number, segment or cell on a page opens one of these
 * with the records behind it, so a figure is never the end of the enquiry.
 * The modal owns only the frame; the page supplies the title, a one-line
 * account of what the number means, and the table.
 */
export function DrillModal({
  title,
  subtitle,
  count,
  onClose,
  actions,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  count?: number;
  onClose: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/75 p-3 sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-[min(1080px,100%)] flex-col overflow-hidden rounded-lg border border-line bg-surface elev-3 af-pop"
      >
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <span className="flex min-w-0 grow flex-col">
            <span className="flex items-baseline gap-2">
              <span className="text-[14px] font-semibold tracking-[-0.005em]">{title}</span>
              {count !== undefined && <span className="tnum text-[12px] text-faint">{count}</span>}
            </span>
            {subtitle && <span className="max-w-[100ch] text-[11.5px] leading-[1.5] text-faint">{subtitle}</span>}
          </span>
          {actions}
          <Button size="sm" variant="solid" tone="err" onClick={onClose}>Close</Button>
        </header>
        <div className="min-h-0 grow overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

/** A plain table for a drill-down: columns and rows, nothing clever. */
export function DrillTable<T>({
  columns,
  rows,
  keyOf,
  onRow,
  empty = "Nothing here.",
}: {
  columns: { label: string; cell: (row: T) => ReactNode; right?: boolean; className?: string }[];
  rows: T[];
  keyOf: (row: T) => string;
  onRow?: (row: T) => void;
  empty?: string;
}) {
  return (
    <table className="w-full border-collapse text-[11.5px]">
      <thead className="sticky top-0 z-10 bg-surface">
        <tr className="border-b border-line text-left text-[10.5px] text-faint">
          {columns.map((c, i) => (
            <th key={i} className={`px-4 py-2 font-medium whitespace-nowrap ${c.right ? "text-right" : ""}`}>{c.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={keyOf(r)} onClick={onRow ? () => onRow(r) : undefined} className={`border-b border-line last:border-0 ${onRow ? "cursor-pointer hover:bg-raise/40" : ""}`}>
            {columns.map((c, i) => (
              <td key={i} className={`px-4 py-2 align-top ${c.right ? "tnum text-right" : ""} ${c.className ?? ""}`}>{c.cell(r)}</td>
            ))}
          </tr>
        ))}
        {rows.length === 0 && (
          <tr>
            <td colSpan={columns.length} className="px-4 py-4 text-center text-[11.5px] text-faint">{empty}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
