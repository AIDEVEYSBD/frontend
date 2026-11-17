"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { PAGE_GROUPS, type PageGroup, type PageGroupId } from "@/lib/page-groups";

/**
 * The header of a page that is one tab of a group (lib/page-groups.ts): the
 * group's name, what the person can do here, the tabs, then one paragraph on
 * the tab that is open. Every member page draws this in place of a header of
 * its own, so moving between tabs changes the body and nothing above it.
 *
 *   <GroupHeader group="results" tab="findings" actions={<Button…/>}>
 *     What this tab is, in a sentence or two.
 *   </GroupHeader>
 *
 * `subject` is carried to every tab that names a parameter for it; `title`
 * replaces the group's name (an agent's own name on an agent's pages).
 */
export function GroupHeader({
  group,
  tab,
  title,
  subject,
  meta,
  actions,
  children,
}: {
  group: PageGroupId;
  tab: string;
  title?: ReactNode;
  subject?: string;
  /** Beside the title: a status, a count. */
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const g: PageGroup = PAGE_GROUPS[group];
  return (
    <header className="flex flex-col gap-3" data-page-group={group}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">{title ?? g.title}</h1>
        {meta}
        <span className="grow" />
        {actions && <span className="flex flex-wrap items-center gap-2">{actions}</span>}
      </div>
      <nav aria-label={`${g.title} sections`} className="flex flex-wrap gap-x-1 border-b border-line">
        {g.tabs.map((t) => {
          const on = t.id === tab;
          const href = subject && t.param ? `${t.href}?${t.param}=${encodeURIComponent(subject)}` : t.href;
          return (
            <Link
              key={t.id}
              href={href}
              aria-current={on ? "page" : undefined}
              className={`focusable -mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors ${
                on ? "border-brand text-fg" : "border-transparent text-dim hover:border-line-strong hover:text-fg"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      {children && <p className="max-w-[92ch] text-[12.5px] leading-[1.6] text-dim">{children}</p>}
    </header>
  );
}
