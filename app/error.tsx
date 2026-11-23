"use client";

import { Button } from "@/components/ui";

/**
 * The backstop for a page that fails to draw: the console's frame and
 * navigation stay, the page's area says what failed and offers to try again.
 * Blocks drawn from answers and fetched text have their own boundaries
 * (components/block-boundary.tsx), so one of those failing stays in its place
 * and never reaches here.
 */
export default function PageFailed({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div role="alert" data-page-failed="" className="flex flex-col items-start gap-3 px-8 py-10">
      <span className="text-[15px] font-semibold text-fg">This page could not be drawn</span>
      <span className="max-w-[90ch] text-[12.5px] leading-[1.55] text-err">
        {error.message || "No reason was given."}
        {error.digest ? ` (server log reference ${error.digest})` : ""}
      </span>
      <Button size="md" variant="solid" tone="ink" onClick={retry}>Try again</Button>
    </div>
  );
}
