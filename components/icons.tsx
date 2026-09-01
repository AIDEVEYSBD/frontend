type IconProps = { className?: string; size?: number };

const base = {
  fill: "none",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
};

export function Check({ className, size = 12 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} className={className} stroke="currentColor" strokeWidth={2.5}>
      <path d="M4 13l5 5 11-13" />
    </svg>
  );
}

export function Doc({ className, size = 14 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} className={className} stroke="currentColor" strokeWidth={1.8}>
      <path d="M6 2h9l5 5v15H6z" />
      <path d="M15 2v5h5" />
    </svg>
  );
}

export function Person({ className, size = 12 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} className={className} stroke="currentColor">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.5-7 8-7s8 3 8 7" />
    </svg>
  );
}

export function Spinner({ className, size = 11 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={`animate-spin ${className ?? ""}`}>
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.2" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Wrench({ className, size = 12 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} className={className} stroke="currentColor" strokeWidth={1.8}>
      <path d="M14.5 6.5a4 4 0 0 0 5 5l-9 9a2.8 2.8 0 0 1-4-4z" />
      <path d="M14.5 6.5 18 3l3 3-3.5 3.5" />
    </svg>
  );
}

export function Shield({ className, size = 12 }: IconProps) {
  return (
    <svg {...base} width={size} height={size} className={className} stroke="currentColor" strokeWidth={1.8}>
      <path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z" />
    </svg>
  );
}
