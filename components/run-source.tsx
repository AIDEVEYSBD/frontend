import { Tag } from "./ui";
import { runSourceOf } from "@/lib/api/l6";

/**
 * Where a run came from, when it was not the platform itself: an attached
 * agent that opened it through its SDK (`POST /api/sdk/runs`, phase L6), or
 * one reported over A2A. The same marks the Configuration page gives the
 * two ways an agent attaches. A run the platform started shows nothing:
 * that is the default, and a badge on every row would say nothing.
 *
 * Reads `source` from a ledger row, else the record's `reported_by.mode`
 * (lib/api/l6.ts runSourceOf).
 */
export function RunSourceTag({ run }: { run: unknown }) {
  const source = runSourceOf(run);
  if (source === "sdk") {
    return (
      <span title="Opened by an attached agent through the SDK. A kill, a steer and a gate's answer reach it on the SDK's control channel." className="inline-flex shrink-0">
        <Tag tone="run" solid>
          SDK
        </Tag>
      </span>
    );
  }
  if (source === "a2a") {
    return (
      <span title="Reported by an attached agent over A2A, through the tool broker and the model gateway." className="inline-flex shrink-0">
        <Tag tone="queue" solid>
          A2A
        </Tag>
      </span>
    );
  }
  return null;
}
