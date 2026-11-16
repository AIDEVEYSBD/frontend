"use client";

import { useEffect, type ReactNode } from "react";
import { Button, Status, Tag } from "./ui";
import { NavIcon, type NavIconName } from "./nav-icons";
import { DATASET_KINDS, type Dataset, type DatasetKind } from "@/lib/api/pending";

/**
 * What the datasets page, the upload dialog and the picker share: how a
 * dataset's kind, mode, status, size and age are worded, and the frame a
 * dataset dialog sits in. Nothing here holds a record.
 */

export const KIND_ICON: Record<DatasetKind, NavIconName> = {
  code: "file-code",
  firewall_export: "brick-wall",
  telemetry: "radar",
  document: "scroll-text",
  other: "package",
};

/** A kind as the page names it; an unknown kind is shown as it was sent. */
export function kindLabel(kind: string): string {
  return DATASET_KINDS.find((k) => k.id === kind)?.label ?? kind.replace(/_/g, " ");
}

export function KindMark({ kind, size = 14 }: { kind: string; size?: number }) {
  const name = KIND_ICON[kind as DatasetKind] ?? "package";
  return <NavIcon name={name} size={size} className="shrink-0 text-faint" />;
}

/** Offline: a file handed over. Live: read from a connection when the run asks. */
export function ModeTag({ mode }: { mode: Dataset["mode"] }) {
  return <Tag tone={mode === "live" ? "run" : "neutral"}>{mode}</Tag>;
}

export function DatasetStatus({ status }: { status: Dataset["status"] }) {
  if (status === "ready") return <Status tone="ok">Ready</Status>;
  if (status === "failed") return <Status tone="err">Failed</Status>;
  if (status === "processing") return <Status tone="run">Processing</Status>;
  return <Status tone="neutral">{String(status)}</Status>;
}

/** A size as read: `26 bytes`, `3.1 KB`, `4.2 MB`, `1.3 GB`; "" when the record carries none. */
export function sizeText(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "";
  if (bytes < 1024) return `${bytes} byte${bytes === 1 ? "" : "s"}`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function filesText(files: number | null | undefined): string {
  if (files === null || files === undefined) return "";
  return `${files.toLocaleString("en-GB")} file${files === 1 ? "" : "s"}`;
}

/** `3m ago`, `2h ago`, `5d ago`; the date itself past a month; "" for none. */
export function agoText(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  const mins = Math.round((now - at) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days <= 30) return `${days}d ago`;
  return new Date(at).toISOString().slice(0, 10);
}

/** An ISO time written out: `2026-10-21 13:50 UTC`. */
export function whenFull(iso: string | null | undefined): string {
  if (!iso) return "";
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return iso;
  return `${new Date(at).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * The frame of a dataset dialog: a scrim, a titled panel, a body that
 * scrolls and a footer for the actions. Escape and a click on the scrim
 * close it unless `locked` (a request is in flight, or a confirmation is
 * open over it).
 */
export function DatasetDialog({
  title,
  subtitle,
  width = "w-[min(680px,100%)]",
  locked = false,
  onClose,
  footer,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  width?: string;
  locked?: boolean;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (locked) return;
    const onKey = (e: KeyboardEvent) => {
      // A dialog opened over this one answers Escape first and marks it handled.
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/75 p-3 sm:p-6" onClick={locked ? undefined : onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[88vh] ${width} flex-col overflow-hidden rounded-lg border border-line bg-surface elev-3 af-pop`}
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-line px-4 py-3">
          <span className="flex min-w-0 grow flex-col">
            <span className="truncate text-[14px] font-semibold tracking-[-0.005em]">{title}</span>
            {subtitle && <span className="text-[11.5px] leading-[1.5] text-faint">{subtitle}</span>}
          </span>
          <span className="shrink-0">
            <Button size="sm" variant="solid" tone="err" disabled={locked} onClick={onClose}>
              Close
            </Button>
          </span>
        </header>
        <div className="min-h-0 grow overflow-y-auto">{children}</div>
        {footer && <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-4 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

/** A key and its value, one above the other, for a record's facts. */
export function Fact({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 bg-surface px-3 py-2.5">
      <span className="text-[10.5px] text-faint">{k}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12.5px] font-medium text-fg">{children}</span>
    </div>
  );
}
