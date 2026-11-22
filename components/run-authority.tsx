"use client";

import Link from "next/link";
import { Tag } from "./ui";
import { NotConnected, NotBuiltValue, useDoor } from "./pending";
import { notBuilt } from "@/lib/not-built";
import type { RunAuthority } from "@/lib/api/pending";

/**
 * The authority a run was started under (door `runAuthority`,
 * `GET /api/runs/{id}/authority`): who started it and what they held at
 * that moment (`held`), the run it was started under when it was, its gates,
 * and, where the platform builds them, its tool grants, what was narrowed and
 * its data class ceiling. A field the answer names in `not_built` reads "not
 * built", never "none". Opened from the run's page and from a row of the run
 * tree.
 */

const FROM: Record<RunAuthority["grants"][number]["from"], string> = {
  spec: "its own spec",
  caller: "its caller",
};

const TH = "px-2 py-1 text-left text-[10px] font-medium text-faint";
const TD = "px-2 py-1 align-top text-[11px]";

/** The authority as the door answers it. Presentational. */
const VIA: Record<string, string> = { iap: "signed in through Google Identity-Aware Proxy", key: "calling with an API key", issuer: "signing in with a workload token" };

export function RunAuthorityView({ a }: { a: RunAuthority }) {
  const grants = Array.isArray(a.grants) ? a.grants : [];
  const narrowed = Array.isArray(a.narrowed) ? a.narrowed : [];
  const gates = Array.isArray(a.gates) ? a.gates : [];
  const unbuilt = Array.isArray(a.not_built) ? a.not_built : [];
  const off = (field: string) => notBuilt(unbuilt, field) || unbuilt.includes(field);
  const held = a.held;
  const starter = a.started_by ? a.started_by.name || a.started_by.email || a.started_by.sub : "";
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <p className="text-[11px] leading-[1.5] text-dim">
        {starter ? <>Started by {starter}: the run acts with their authority, as they held it when it started, and nobody else&rsquo;s.</> : "The record names nobody as having started this run."}
        {a.caller && (
          <>
            {" "}It was started under run{" "}
            <Link href={`/runs?id=${encodeURIComponent(a.caller.run)}`} className="focusable rounded-sm font-mono text-[10.5px] text-fg hover:underline">
              {a.caller.run}
            </Link>
            {a.caller.agent ? `, which ran as ${a.caller.agent}` : ""}.
          </>
        )}
      </p>

      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[10.5px] font-semibold text-dim">What the starter held when it started</span>
        {held ? (
          <span className="flex flex-col gap-1 text-[11px] text-dim">
            <span className="flex flex-wrap items-center gap-1">
              <span className="text-faint">Roles</span>
              {held.roles.length ? held.roles.map((r) => <Tag key={r}>{r}</Tag>) : <span className="text-faint">none</span>}
            </span>
            <span className="flex flex-wrap items-center gap-1">
              <span className="text-faint">Permissions</span>
              {held.permissions.length ? held.permissions.map((p) => <Tag key={p}>{p}</Tag>) : <span className="text-faint">none</span>}
            </span>
            {(held.via || held.kind) && <span className="text-faint">{[held.kind ? `a ${held.kind}` : "", held.via ? (VIA[held.via] ?? `by ${held.via}`) : ""].filter(Boolean).join(", ")}</span>}
          </span>
        ) : (
          <span className="text-[11px] text-faint">The record does not say what the starter held.</span>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[10.5px] font-semibold text-dim">
          Grants {off("grants") ? <NotBuiltValue field="grants" className="font-normal" /> : <span className="tnum font-normal text-faint">({grants.length})</span>}
        </span>
        {off("grants") ? (
          <span className="text-[11px] text-faint">Tools are not connected on this platform, so no run holds a tool grant.</span>
        ) : grants.length ? (
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
          Narrowed {off("narrowed") ? <NotBuiltValue field="narrowed" className="font-normal" /> : <span className="tnum font-normal text-faint">({narrowed.length})</span>}
        </span>
        {off("narrowed") ? (
          <span className="text-[11px] text-faint">With no tool grant, nothing is cut down to what a caller held.</span>
        ) : narrowed.length ? (
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
          ) : off("max_data_class") ? (
            <span className="text-[11px] text-faint">
              <NotBuiltValue field="max_data_class" />: nothing sets a run&rsquo;s data class yet.
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
            <span className="text-[11px] text-faint">Its definition has no step where it waits for a person.</span>
          )}
          {unbuilt.some((f) => f.startsWith("gates[")) && <span className="text-[10.5px] text-faint">Gates on tool calls: not built; only the run&rsquo;s own waiting steps are listed.</span>}
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
        Who started this run and what they held, its gates, and what it was granted.
      </NotConnected>
    );
  }
  if (answer.state === "error") return <p className="text-[11px] text-err">The authority could not be read: {answer.message}</p>;
  return <RunAuthorityView a={answer.data} />;
}
