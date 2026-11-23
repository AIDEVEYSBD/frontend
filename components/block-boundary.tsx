"use client";

import { catchError, type ErrorInfo } from "next/error";

/**
 * One drawn block (a chart, an answer block, a stretch of model text) that
 * fails to draw is replaced by a line saying so, with the reason; the rest of
 * the page stays. The blocks are checked before they are drawn
 * (lib/answer-blocks.ts, components/assistant-charts.tsx), so this catches
 * what those checks did not foresee.
 */
function BlockFailed({ what }: { what: string }, { error }: ErrorInfo) {
  const reason = (error instanceof Error ? error.message : String(error ?? "")).replace(/\.+$/, "");
  return (
    <p role="alert" data-block-failed="" className="my-1 rounded-sm border border-line px-2 py-1 text-[11px] text-err">
      {what} could not be drawn: {reason || "no reason was given"}.
    </p>
  );
}

export const BlockBoundary = catchError(BlockFailed);
