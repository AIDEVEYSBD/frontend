"use client";

import { useState } from "react";
import { shortDigest } from "@/lib/digest";

/**
 * A content digest, short (lib/digest.ts): a tool server's pin or scan, a
 * sandbox's copy-in manifest. The full value is the hover title, and a click
 * copies it whole, so the short form never costs a reviewer the real one.
 */
export function DigestChip({ digest, label }: { digest: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!digest) return <span className="text-[11px] text-ghost">none</span>;
  return (
    <button
      type="button"
      title={`${digest}\nClick to copy the full digest.`}
      aria-label={`${label ?? "Digest"} ${digest}, copy`}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(digest).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
      className="focusable inline-flex max-w-full cursor-pointer items-center gap-1 rounded-sm border border-line bg-raise px-1.5 py-px font-mono text-[10.5px] text-fg transition-[filter] hover:brightness-[1.06]"
    >
      <span className="truncate">{copied ? "copied" : shortDigest(digest)}</span>
    </button>
  );
}
