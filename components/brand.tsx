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
  "Microsoft", "Dynamics 365", "SharePoint", "Azure Blob", "Outlook", "Teams", "SQL Server",
  "Entra ID", "Microsoft Purview", "Microsoft Defender", "Microsoft Sentinel",
  "OneDrive", "Power BI", "Azure DevOps",
]);

const MAP = new Map((brands as Brand[]).map((b) => [b.name, b]));

export function brandOf(name: string): Brand {
  return MAP.get(name) ?? { name, hex: "var(--t-fg-4)", path: null };
}

/** Whether `BrandMark` has something real to draw for this name — a glyph,
 *  a vendored logo, or the Microsoft squares — rather than a fallback. */
export function hasBrand(name: string): boolean {
  return MICROSOFT.has(name) || MAP.has(name);
}

/** Every name a mark exists for, for callers that match against labels. */
export const BRAND_NAMES: string[] = [...new Set([...MAP.keys(), ...MICROSOFT])];

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

/**
 * The ABB wordmark, the vector as ABB publishes it, in ABB red. It is ABB's
 * trademark and is shown here to say whose console this is, nothing more.
 */
export function ABBWordmark({ height = 15, className = "" }: { height?: number; className?: string }) {
  return (
    <svg
      role="img"
      aria-label="ABB"
      viewBox="-1 -1 88.2 35"
      height={height}
      width={(height * 88.2) / 35}
      fill="#ff000f"
      className={`shrink-0 ${className}`}
    >
      <path d="M47 33h2c6-.3 10.2-5 10.2-10.6 0-1.9-.4-3.8-1.3-5.3H47V33z" />
      <rect width="10" height="16" x="36" y="17" />
      <path d="M57.3 16c-1-1.4-2.4-2.5-3.9-3.3 1.8-1.3 3-3.4 3-5.7 0-3.9-3.1-7-7-7H47v16h10.3z" />
      <rect width="10" height="16" x="36" />
      <path d="M74 33h2c6-.3 10.2-5 10.2-10.6 0-1.9-.4-3.8-1.3-5.3H74V33z" />
      <rect width="10" height="16" x="63" y="17" />
      <path d="M84.3 16c-1-1.4-2.4-2.5-3.9-3.3 1.8-1.3 3-3.4 3-5.7 0-3.9-3.1-7-7-7H74v16h10.3z" />
      <rect width="10" height="16" x="63" />
      <polygon points="5.7,17 0,33 8.3,33 10.7,26 16,26 16,17" />
      <polygon points="16,0 11.7,0 6,16 16,16" />
      <polygon points="17,26 22.3,26 24.7,33 33,33 27.3,17 17,17" />
      <polygon points="27,16 21.3,0 17,0 17,16" />
    </svg>
  );
}

/** What the console calls itself beside the wordmark, in one place. */
export const PRODUCT = { name: "Agent Factory", line: "AI SecOps Platform" };

/**
 * The lockup: whose console this is, a rule, then what it is. `onDark` is the
 * sidebar, where the type is white; elsewhere it takes the page's ink.
 */
export function BrandLockup({
  onDark = false,
  line = true,
  height = 15,
}: {
  onDark?: boolean;
  /** The second line under the product's name. */
  line?: boolean;
  height?: number;
}) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <ABBWordmark height={height} />
      <span className={`min-w-0 border-l pl-2.5 leading-tight ${onDark ? "border-white/15" : "border-line-strong"}`}>
        <span className={`block truncate text-[12.5px] font-semibold tracking-[-0.01em] ${onDark ? "text-white" : "text-fg"}`}>{PRODUCT.name}</span>
        {line && <span className={`block truncate text-[10.5px] ${onDark ? "text-white/50" : "text-faint"}`}>{PRODUCT.line}</span>}
      </span>
    </span>
  );
}
