"use client";

import { useState } from "react";
import brands from "@/lib/brands.json";

/**
 * Brand marks.
 *
 * Where an official glyph is available under a permissive licence
 * (Simple Icons, CC0) it is drawn in the vendor's own colour. Many
 * enterprise vendors — Microsoft, Salesforce, ServiceNow, the AWS
 * service marks — have had their icons withdrawn from open sets on
 * trademark request, so those fall back to a lettermark in the vendor's
 * real brand colour rather than an approximated logo. Inventing a mark
 * for a trademark holder is worse than not drawing one.
 */

export interface Brand {
  name: string;
  hex: string;
  path: string | null;
  /** Company domain, kept as the remote fallback source. */
  domain?: string;
  /** Vendored copy of the real logo, served from /public — no runtime fetch. */
  img?: string;
}

/** Products that carry the Microsoft mark — drawn exactly, four squares. */
const MICROSOFT = new Set([
  "Dynamics 365", "SharePoint", "Azure Blob", "Outlook", "Teams", "SQL Server",
  "Entra ID", "Microsoft Purview", "Microsoft Defender", "Microsoft Sentinel",
]);

const MAP = new Map((brands as Brand[]).map((b) => [b.name, b]));

export function brandOf(name: string): Brand {
  return MAP.get(name) ?? { name, hex: "#6A675E", path: null };
}

export const BRANDS = brands as Brand[];

export function BrandMark({
  name,
  size = 16,
  mono = false,
}: {
  name: string;
  size?: number;
  mono?: boolean;
}) {
  const b = brandOf(name);
  const colour = mono ? "currentColor" : b.hex;
  // Hooks before any return — the mark's source varies, its hook count must not.
  const [imgFailed, setImgFailed] = useState(false);

  // Microsoft product marks are the Microsoft mark — four squares, exact.
  if (MICROSOFT.has(name)) {
    return (
      <svg role="img" aria-label={name} viewBox="0 0 24 24" width={size} height={size} className="shrink-0">
        <rect x="2" y="2" width="9.5" height="9.5" fill={mono ? "currentColor" : "#F25022"} />
        <rect x="12.5" y="2" width="9.5" height="9.5" fill={mono ? "currentColor" : "#7FBA00"} />
        <rect x="2" y="12.5" width="9.5" height="9.5" fill={mono ? "currentColor" : "#00A4EF"} />
        <rect x="12.5" y="12.5" width="9.5" height="9.5" fill={mono ? "currentColor" : "#FFB900"} />
      </svg>
    );
  }

  if (b.path) {
    return (
      <svg
        role="img"
        aria-label={name}
        viewBox="0 0 24 24"
        width={size}
        height={size}
        className="shrink-0"
        style={{ fill: colour }}
      >
        <path d={b.path} />
      </svg>
    );
  }

  // The vendor's real logo, served from our own /public copy so it works
  // offline and behind proxies. The remote source is only the fallback for a
  // brand added before its logo was vendored; a lettermark is the last resort.
  if ((b.img || b.domain) && !imgFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={b.img ?? `https://unavatar.io/${b.domain}?fallback=false`}
        alt={name}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setImgFailed(true)}
        className="shrink-0 rounded-[3px] object-contain"
        style={{ width: size, height: size }}
      />
    );
  }

  // Lettermark: the vendor's initials in their own colour, never a
  // guessed-at reproduction of their logo.
  const initials = name
    .replace(/[^A-Za-z0-9 ]/g, "")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <span
      role="img"
      aria-label={name}
      className="grid shrink-0 place-items-center rounded-[3px] font-semibold text-white"
      style={{
        width: size,
        height: size,
        background: mono ? "currentColor" : b.hex,
        fontSize: size * 0.42,
        letterSpacing: "-0.02em",
      }}
    >
      {initials}
    </span>
  );
}

/**
 * The Agent Factory mark.
 *
 * Three chevrons, stacked — the platform's own thesis drawn once: layers of
 * governance, ascending, each resting on the one beneath. Depth is graded by
 * opacity (the surface layer is the sharpest, exactly as in the product's
 * architecture scene), and the whole mark is one currentColor so it sits on
 * ink, on surface, or in a favicon without variants. Legible at 16px.
 */
export function AFMark({ size = 20, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M4 20 L12 15 L20 20" opacity="0.35" />
      <path d="M4 14.5 L12 9.5 L20 14.5" opacity="0.65" />
      <path d="M4 9 L12 4 L20 9" />
    </svg>
  );
}
