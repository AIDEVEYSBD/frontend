"use client";

import Link from "next/link";
import { Tag } from "./ui";
import { NotConnected, useDoor } from "./pending";
import type { RunAuthority } from "@/lib/api/pending";

/**
 * The authority a run in a tree ran under (door `runAuthority`,
 * `GET /api/runs/{id}/authority`): what it may use and where each grant
 * came from (its own spec, or what its caller held), what its spec asked
 * for and the caller did not hold, the data class ceiling, and its gates.
 * A run handed work only ever holds less than its caller, and this is where
 * that narrowing is read. Opened from a row of the run tree.
 */

const FROM: Record<RunAuthority["grants"][number]["from"], string> = {
  spec: "its own spec",
  caller: "its caller",
};

const TH = "px-2 py-1 text-left text-[10px] font-medium text-faint";
const TD = "px-2 py-1 align-top text-[11px]";

/** The authority as the door answers it. Presentational. */
export function RunAuthorityView({ a }: { a: RunAuthority }) {
  const grants = Array.isArray(a.grants) ? a.grants : [];
  const narrowed = Array.isArray(a.narrowed) ? a.narrowed : [];
  const gates = Array.isArray(a.gates) ? a.gates : [];
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <p className="text-[11px] leading-[1.5] text-dim">
        {a.caller ? (
          <>
            Started by run{" "}
            <Link href={`/runs?id=${encodeURIComponent(a.caller.run)}`} className="focusable rounded-sm font-mono text-[10.5px] text-fg hover:underline">
              {a.caller.run}
            </Link>
            {a.caller.agent ? `, running as ${a.caller.agent}` : ""}: it holds no more than that run held.
          </>
        ) : a.started_by ? (
          <>
            Started by {a.started_by.name}
            {a.started_by.team ? ` (${a.started_by.team})` : ""}, not by another run: its authority is its own spec&rsquo;s.
          </>
        ) : (
          "No caller is recorded for this run: its authority is its own spec's."
        )}
      </p>

      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[10.5px] font-semibold text-dim">
          Grants <span className="tnum font-normal text-faint">({grants.length})</span>
        </span>
        {grants.length ? (
          <div className="overflow-x-auto rounded-md border border-line bg-surface">
            <table className="w-full min-w-[420px] border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className={TH}>Tool</th>
                  <th className={TH}>Scope</th>
                  <th className={TH}>Came from</th>
                </tr>
              </thead>
              <tbody>
                {grants.map((g, i) => {
                  const scope = Object.entries(g.scope ?? {});
                  return (
                    <tr key={`${g.tool}-${i}`} className="border-b border-line/70 last:border-b-0">
                      <td className={`${TD} font-mono text-fg`}>{g.tool}</td>
                      <td className={`${TD} text-dim`}>
                        {scope.length ? (
                          <span className="flex flex-col">
                            {scope.map(([arg, values]) => (
                              <span key={arg} className="font-mono text-[10.5px] break-words">
                                {arg}: {Array.isArray(values) && values.length ? values.join(", ") : "nothing permitted"}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="text-faint">no scope limit</span>
                        )}
                      </td>
                      <td className={`${TD} text-dim`}>{FROM[g.from] ?? g.from}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <span className="text-[11px] text-faint">This run was granted no tool.</span>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[10.5px] font-semibold text-dim">
          Narrowed <span className="tnum font-normal text-faint">({narrowed.length})</span>
        </span>
        {narrowed.length ? (
          <ul className="flex flex-col gap-0.5">
            {narrowed.map((n, i) => (
              <li key={`${n.tool}-${i}`} className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                <span className="font-mono text-fg line-through decoration-err/70">{n.tool}</span>
                <span className="min-w-0 text-dim">{n.reason}</span>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-[11px] text-faint">Nothing its spec asked for was withheld.</span>
        )}
      </div>

      <div className="flex flex-wrap items-start gap-x-8 gap-y-2">
        <div className="flex flex-col gap-1">
          <span className="text-[10.5px] font-semibold text-dim">Data class ceiling</span>
          {a.max_data_class ? (
            <span className="inline-flex">
              <Tag>up to {a.max_data_class}</Tag>
            </span>
          ) : (
            <span className="text-[11px] text-faint">None set.</span>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[10.5px] font-semibold text-dim">
            Gates <span className="tnum font-normal text-faint">({gates.length})</span>
          </span>
          {gates.length ? (
            <ul className="flex flex-col gap-0.5">
              {gates.map((g, i) => (
                <li key={`${g.name}-${i}`} className="text-[11px] text-dim">
                  <span className="font-medium text-fg">{g.name}</span>
                  {Array.isArray(g.approvers) && g.approvers.length ? `: answered by ${g.approvers.join(", ")}` : ": no approver named"}
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-[11px] text-faint">No gate stands in front of it.</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Asks the door for one run's authority and shows it, or that nothing serves the door yet. */
export function RunAuthorityPanel({ run }: { run: string }) {
  const { answer } = useDoor<RunAuthority>("runAuthority", { params: { id: run } });
  if (!answer) return <p className="text-[11px] text-faint">Reading the authority this run was started under…</p>;
  if (answer.state === "pending") {
    return (
      <NotConnected door={answer.door} compact title="The authority a run started under is not built yet">
        What this run was granted and where each grant came from, what was narrowed and why, its data class ceiling and its gates.
      </NotConnected>
    );
  }
  if (answer.state === "error") return <p className="text-[11px] text-err">The authority could not be read: {answer.message}</p>;
  return <RunAuthorityView a={answer.data} />;
}
