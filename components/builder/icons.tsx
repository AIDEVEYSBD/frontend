/**
 * The builder's icon set.
 *
 * One hand-kept set of stroke icons on a 24-grid, drawn to match IBM Plex's
 * weight. Inline SVG rather than an icon font or a package: the whole set is
 * ~2KB, theme-reactive through currentColor, and nothing external decides how
 * this product looks. Vendor logos are a different thing — those come from
 * `BrandMark`, which draws real marks or honest lettermarks, never inventions.
 */

import type { CSSProperties } from "react";

const PATHS: Record<string, React.ReactNode> = {
  // shapes & flow
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.8-3.8" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5.5" rx="7" ry="2.5" />
      <path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5" />
    </>
  ),
  pulse: <path d="M3 12h4l2.5-7 4 14 2.5-7h5" />,
  code: <path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16" />,
  chip: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
      <path d="M4 10h3M4 14h3M17 10h3M17 14h3M10 4v3M14 4v3M10 17v3M14 17v3" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5z" />
      <path d="m3 13 9 5 9-5" />
    </>
  ),
  bell: (
    <>
      <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </>
  ),
  gavel: (
    <>
      <path d="m13 6 5 5M9 10l5 5M11 8l4-4 5 5-4 4zM3 21h9" />
      <path d="m12 13-7 7" />
    </>
  ),
  cross: <path d="M6 6l12 12M18 6L6 18" />,
  // connectors
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  vector: (
    <>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="18" cy="7" r="2.5" />
      <circle cx="8" cy="18" r="2.5" />
      <circle cx="17.5" cy="16.5" r="2.5" />
      <path d="m8.3 7 7.3.6M7 8.3 7.7 15.6M10.4 17.3l4.8-.4M16.6 9.3l.6 4.8" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.7 2.6 4 5.7 4 9s-1.3 6.4-4 9c-2.7-2.6-4-5.7-4-9s1.3-6.4 4-9" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="m21 16-4.5-4.5L7 21" />
    </>
  ),
  plug: (
    <>
      <path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-5 5 5 5 0 0 1-5-5z" />
      <path d="M12 16v5" />
    </>
  ),
  // system
  prompt: (
    <>
      <path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H12l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
      <path d="M8 9h8M8 12h5" />
    </>
  ),
  api: (
    <>
      <path d="M8 8 4 12l4 4M16 8l4 4-4 4" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  webhook: (
    <>
      <path d="M10 4.5a4 4 0 1 1 4.9 6.2L12 15" />
      <path d="M6.7 11.5a4 4 0 1 0 5.6 5.4h7" />
      <circle cx="19" cy="17" r="1.3" fill="currentColor" stroke="none" />
    </>
  ),
  response: <path d="M20 5H4v10h4v4l5-4h7z" />,
  json: (
    <>
      <path d="M8 4c-2 0-2.5 1-2.5 2.5v2C5.5 10 4.8 11 3 11.5v1c1.8.5 2.5 1.5 2.5 3v2C5.5 19 6 20 8 20" />
      <path d="M16 4c2 0 2.5 1 2.5 2.5v2c0 1.5.7 2.5 2.5 3v1c-1.8.5-2.5 1.5-2.5 3v2c0 1.5-.5 2.5-2.5 2.5" />
    </>
  ),
  workflow: (
    <>
      <rect x="3" y="3" width="7" height="6" rx="1.5" />
      <rect x="14" y="15" width="7" height="6" rx="1.5" />
      <path d="M10 6h5a2 2 0 0 1 2 2v7" />
    </>
  ),
  bot: (
    <>
      <rect x="5" y="8" width="14" height="11" rx="2.5" />
      <path d="M12 8V4.5M9.5 4.5h5" />
      <circle cx="9.5" cy="13" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.5" cy="13" r="1" fill="currentColor" stroke="none" />
      <path d="M9.5 16.2h5" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="14" r="4.5" />
      <path d="m11.5 10.5 8-8M16 5l3 3M13.5 7.5l3 3" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v3M12 18.2v3M21.2 12h-3M5.8 12h-3M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1M18.5 18.5l-2.1-2.1M7.6 7.6 5.5 5.5" />
    </>
  ),
};

export function Icon({
  name,
  size = 14,
  strokeWidth = 1.75,
  className = "",
  style,
}: {
  name: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const paths = PATHS[name];
  if (!paths) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      style={style}
      aria-hidden
    >
      {paths}
    </svg>
  );
}

export const ICON_NAMES = Object.keys(PATHS);
