import type { ReactNode } from "react";
import { Button, IconButton, Mono, Status, Tag, type Tone } from "./ui";

/**
 * Notification format.
 *
 * One sentence structure everywhere: WHO did WHAT to WHICH THING, then
 * when. The subject is always a named actor — a person, or a named
 * harness — never "the system", because a reader needs to know who to
 * ask. Unread is a bar on the leading edge, not a coloured background:
 * a tinted row stops being readable once three of them stack up.
 */

const ICON: Record<string, ReactNode> = {
  ok: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.5 2.5L16 9.5" />
    </svg>
  ),
  warn: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </svg>
  ),
  err: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </svg>
  ),
  run: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  ),
  queue: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.5v.01" />
    </svg>
  ),
};

const RULE: Record<string, string> = {
  ok: "bg-ok",
  warn: "bg-warn",
  err: "bg-err",
  run: "bg-run",
  queue: "bg-queue",
};

const FG: Record<string, string> = {
  ok: "text-ok",
  warn: "text-warn",
  err: "text-err",
  run: "text-run",
  queue: "text-queue",
};

export interface Notice {
  id: string;
  tone: Exclude<Tone, "ink" | "neutral">;
  actor: string;
  action: string;
  target: string;
  meta?: string;
  at: string;
  unread?: boolean;
  action_label?: string;
}

export const NOTICES: Notice[] = [
  {
    id: "n1",
    tone: "warn",
    actor: "Claims Intake",
    action: "escalated a run to you",
    target: "CL-88209 · M. Okafor",
    meta: "confidence 0.71, below the 0.85 gate",
    at: "18m",
    unread: true,
    action_label: "Review",
  },
  {
    id: "n2",
    tone: "err",
    actor: "policy_db",
    action: "failed after three retries in",
    target: "Controls Review",
    meta: "connection timed out · 2 runs parked",
    at: "42m",
    unread: true,
    action_label: "Open trace",
  },
  {
    id: "n3",
    tone: "ok",
    actor: "Sana Rahman",
    action: "approved",
    target: "CL-88204 · T. Lindqvist",
    meta: "settled in full · £14,200",
    at: "1h 04m",
    unread: true,
  },
  {
    id: "n4",
    tone: "run",
    actor: "Nordic Energy",
    action: "started a batch of 42 runs in",
    target: "RFP Response",
    at: "3h",
  },
  {
    id: "n5",
    tone: "queue",
    actor: "Agent Factory",
    action: "scheduled maintenance for",
    target: "Saturday 02:00–04:00 UTC",
    meta: "queued runs start when the window closes",
    at: "Yesterday",
  },
];

/* ═══════════════════ Single notification ═══════════════════ */

export function NoticeRow({ n, compact = false }: { n: Notice; compact?: boolean }) {
  return (
    <div
      className={`relative flex gap-3 transition-colors hover:bg-raise ${
        compact ? "px-3 py-2.5" : "px-4 py-3"
      }`}
    >
      {/* Unread: a leading rule. A tinted row loses legibility once several stack. */}
      {n.unread && <span className={`absolute inset-y-0 left-0 w-[3px] ${RULE[n.tone]}`} />}

      <span className={`mt-px shrink-0 ${FG[n.tone]}`}>{ICON[n.tone]}</span>

      <div className="flex min-w-0 grow flex-col gap-1">
        <p className="text-[12.5px] leading-[1.5] text-mist">
          <span className="font-medium text-fg">{n.actor}</span> {n.action}{" "}
          <span className="font-medium text-fg">{n.target}</span>
        </p>
        {n.meta && <span className="truncate text-[11.5px] text-faint">{n.meta}</span>}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <Mono className="text-[10.5px] text-ghost">{n.at}</Mono>
        {n.action_label && (
          <Button size="sm" variant="solid" tone={n.tone}>
            {n.action_label}
          </Button>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════ Notification centre ═══════════════════ */

export function NoticeCentre() {
  const unread = NOTICES.filter((n) => n.unread).length;

  return (
    <div className="flex w-full max-w-[440px] flex-col overflow-hidden rounded-lg border border-line bg-surface elev-3">
      <div className="flex items-center gap-2 border-b border-line bg-raise px-3 py-2">
        <span className="text-[12.5px] font-semibold">Notifications</span>
        {/* Count is a squared marker, not a pill. */}
        <span className="grid h-4 min-w-4 place-items-center rounded-xs bg-ink px-1 font-mono text-[10px] font-medium text-on-ink">
          {unread}
        </span>
        <div className="grow" />
        <Button size="sm" variant="quiet">
          Mark all read
        </Button>
      </div>

      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        {["All", "Needs you", "Runs", "System"].map((f, i) => (
          <button
            key={f}
            type="button"
            className={`focusable cursor-pointer rounded-sm px-2 py-1 text-[12px] transition-colors ${
              i === 0 ? "bg-raise font-medium text-fg" : "text-faint hover:text-dim"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="flex flex-col divide-y divide-line">
        <span className="bg-raise px-3 py-1 text-[10.5px] font-medium text-faint">Today</span>
        {NOTICES.slice(0, 4).map((n) => (
          <NoticeRow key={n.id} n={n} compact />
        ))}
        <span className="bg-raise px-3 py-1 text-[10.5px] font-medium text-faint">Earlier</span>
        {NOTICES.slice(4).map((n) => (
          <NoticeRow key={n.id} n={n} compact />
        ))}
      </div>

      <div className="border-t border-line p-2">
        <Button size="sm" variant="quiet" full>
          View all notifications
        </Button>
      </div>
    </div>
  );
}

/* ═══════════════════ Nav trigger ═══════════════════ */

export function NoticeBell({ count = 3 }: { count?: number }) {
  return (
    <IconButton label={`Notifications, ${count} unread`} className="relative">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8a6 6 0 1 0-12 0c0 6-3 7-3 7h18s-3-1-3-7" />
        <path d="M10.5 21a2 2 0 0 0 3 0" />
      </svg>
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-xs bg-err px-0.5 font-mono text-[9px] font-medium text-on-solid">
          {count}
        </span>
      )}
    </IconButton>
  );
}

/* ═══════════════════ Digest email ═══════════════════ */

export function DigestEmail() {
  return (
    <div className="flex w-full max-w-[520px] flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
      <div className="flex flex-col gap-0.5 border-b border-line bg-raise px-4 py-2.5">
        <span className="text-[12.5px] font-medium">
          Agent Factory · 3 items need you
        </span>
        <span className="text-[11px] text-faint">
          to sana.rahman@example.com · daily digest, 08:00 GMT
        </span>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <p className="text-[13px] leading-[1.6] text-mist">
          Yesterday your agents completed <strong className="font-medium text-fg">214 runs</strong>{" "}
          across three engagements. Three need a decision from you.
        </p>

        <div className="flex flex-col divide-y divide-line rounded-md border border-line">
          {NOTICES.filter((n) => n.action_label).map((n) => (
            <NoticeRow key={n.id} n={{ ...n, unread: false }} compact />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-4 border-t border-line pt-3">
          {[
            ["Completed", "214"],
            ["Escalated", "12"],
            ["Failed", "2"],
            ["Spend", "$226"],
          ].map(([l, v]) => (
            <div key={l} className="flex flex-col gap-0.5">
              <span className="text-[10.5px] text-faint">{l}</span>
              <span className="tnum text-[15px] font-semibold tracking-[-0.01em]">{v}</span>
            </div>
          ))}
          <div className="grow" />
          <Button size="sm" tone="ink" variant="solid">
            Open review queue
          </Button>
        </div>
      </div>

      <div className="border-t border-line px-4 py-2.5">
        <span className="text-[10.5px] text-ghost">
          You receive this because you are an approver on Aviva Claims. Change frequency in
          notification settings.
        </span>
      </div>
    </div>
  );
}

/* ═══════════════════ Inline banner variant ═══════════════════ */

export function NoticeSummary() {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface px-3 py-2.5">
      <Status tone="warn">3 need you</Status>
      <span className="text-[12.5px] text-dim">
        Oldest has been waiting <span className="font-medium text-fg">1h 04m</span>
      </span>
      <div className="grow" />
      <Tag>SLA 2h</Tag>
      <Button size="sm" variant="solid" tone="warn">
        Review queue
      </Button>
    </div>
  );
}


