"use client";

import Link from "next/link";
import type { MouseEvent, ReactNode } from "react";
import { safeLink } from "@/lib/safe-link";

/**
 * A link whose address came from a model or a fetched document, drawn the one
 * safe way (lib/safe-link.ts decides): a console page as a client link in the
 * same tab, an https site in a new tab with no opener and no referrer, and
 * anything else as plain text that says it was not opened and why.
 */
export function SafeLink({
  href,
  children,
  className,
  onClick,
}: {
  href: unknown;
  children: ReactNode;
  className?: string;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const v = safeLink(href);
  if (v.kind === "page") {
    return (
      <Link href={v.href} className={className} onClick={onClick}>
        {children}
      </Link>
    );
  }
  if (v.kind === "external") {
    return (
      <a href={v.href} target="_blank" rel="noopener noreferrer" className={className} onClick={onClick}>
        {children}
      </a>
    );
  }
  // The text keeps its place and size, not a link's look.
  const plain = (className ?? "").split(/\s+/).filter((c) => c && !/(^|:)(underline|decoration-\S+)$|^hover:/.test(c)).join(" ");
  return (
    <span data-link-refused="" className={plain || undefined} title={`Not opened: ${v.reason}. Address: ${v.raw}`}>
      {children}
      <span className="text-ghost"> (not opened: {v.brief})</span>
    </span>
  );
}
