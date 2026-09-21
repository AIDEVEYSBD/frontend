"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { HARNESS } from "@/lib/spec";
import { Mono, Status } from "./ui";

/**
 * The agent roster — every saved workflow as a band, every node in it as an
 * agent row. Nothing on this page is typed in: purpose is the node's own
 * persona or plan, autonomy is derived from grants × tool risk × gates, the
 * hierarchy is the graph, and the run columns are the runtime's own records.
 */

interface Autonomy {
  level: string;
  bars: number;
  detail: string;
}

interface AgentRow {
  node: string;
  label: string;
  harness: string;
  purpose: string;
  autonomy: Autonomy;
  tools: string[];
  hierarchy: { stage: number | null; of: number; fanout: boolean; maxSteps: number | null };
  lastRun: string | null;
  runs7d: number;
  pending: number;
}

interface Group {
  id: string;
  name: string;
  description: string;
  trigger: string;
  lastRun: string | null;
  runs7d: number;
  pending: number;
  agents: AgentRow[];
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function Meter({ a }: { a: Autonomy }) {
  return (
    <span
      title={a.detail}
      aria-label={`${a.level} — ${a.detail}`}
      className="inline-flex w-fit flex-col gap-0.5 rounded-md border border-line bg-raise px-2 py-1"
    >
      <span className="flex items-center gap-1.5">
        <span className="flex items-end gap-[2px]" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={`w-[2.5px] rounded-[1px] ${i < a.bars ? "bg-fg" : "bg-line-strong"}`}
              style={{ height: 9 }}
            />
          ))}
        </span>
        <span className="text-[11.5px] font-semibold whitespace-nowrap text-fg">{a.level}</span>
      </span>
      {/* The derivation, visible — the page's best idea should not hide in a tooltip. */}
      <span className="line-clamp-2 text-[9px] leading-[1.3] text-faint">{a.detail}</span>
    </span>
  );
}

function Hierarchy({ h, harness }: { h: AgentRow["hierarchy"]; harness: string }) {
  const meta = HARNESS[harness as keyof typeof HARNESS];
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-[12px] whitespace-nowrap text-fg">
        {h.stage === null ? "unreached" : h.stage === 0 ? "entry" : `stage ${h.stage + 1} of ${h.of}`}
      </span>
      <span className="font-mono text-[10px] whitespace-nowrap text-faint">
        {meta?.name ?? harness}
        {h.fanout ? " · per item" : ""}
        {h.maxSteps ? ` · ≤${h.maxSteps} steps` : ""}
      </span>
    </span>
  );
}

const HEAD = (
  <div className="grid grid-cols-[minmax(150px,1.1fr)_minmax(240px,2.4fr)_150px_120px_90px_70px_70px] items-center gap-4 border-b border-line bg-surface px-5 py-2">
    {["Agent", "Purpose", "Autonomy", "Hierarchy", "Last run", "Runs · 7d", "Pending"].map((h, i) => (
      <span key={h} className={`text-[11.5px] font-semibold text-dim ${i >= 4 ? "text-right" : ""}`}>
        {h}
      </span>
    ))}
  </div>
);

export function Roster() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stop = false;
    fetch("/api/roster")
      .then((r) => r.json())
      .then((d) => {
        if (stop) return;
        if (d.error) throw new Error(String(d.error));
        setGroups(d.groups ?? []);
      })
      .catch((e) => !stop && setError((e as Error).message));
    return () => {
      stop = true;
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-[1520px] px-5 py-7" data-hue="indigo">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">Agent roster</h1>
        <p className="max-w-[72ch] text-[13px] leading-[1.6] text-dim">
          Review the agents within each deployed workflow, including their purpose, permitted
          tools, execution pattern and recent activity. Autonomy is derived from tool risk and
          approval requirements rather than entered as a subjective rating.
        </p>
      </div>

      {error && <p className="mt-6 text-[12.5px] text-err">{error}</p>}
      {!groups && !error && <p className="mt-6 text-[12.5px] text-faint">Reading the registry…</p>}
      {groups && groups.length === 0 && (
        <p className="mt-6 text-[13px] text-faint">
          No agents are registered. Save a workflow in the builder to add its agents to this view.
        </p>
      )}

      {(groups?.length ?? 0) > 0 && (
      // No overflow on this wrapper — it would become the scroll container and
      // the sticky band headers would pin to it instead of the page.
      <div className="mt-8 flex flex-col rounded-md border border-line bg-surface">
        {(groups ?? []).map((g, gi) => (
          <section key={g.id}>
            {/* Band header and column header pin together, so the columns stay
                labelled however far down a long band the reader is. */}
            <div className="sticky top-0 z-10 bg-surface">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-5 py-2.5">
                <span className="font-mono text-[11px] text-ghost">
                  {String(gi + 1).padStart(2, "0")}
                </span>
                <Link
                  href={`/builder?load=${encodeURIComponent(g.id)}`}
                  className="focusable rounded-sm text-[13.5px] font-semibold text-fg hover:underline"
                >
                  {g.name}
                </Link>
                {g.description && <span className="text-[12px] text-dim">{g.description}</span>}
                <span className="grow" />
                <Mono className="whitespace-nowrap">{g.trigger}</Mono>
                <Mono className="whitespace-nowrap">last run {ago(g.lastRun)}</Mono>
                <Mono className="whitespace-nowrap">{g.runs7d} in 7d</Mono>
                {g.pending > 0 && (
                  <Status tone="warn" chip>
                    {g.pending} awaiting approval
                  </Status>
                )}
              </div>

              {HEAD}
            </div>

            {g.agents.map((a) => (
              <div
                key={a.node}
                className="grid grid-cols-[minmax(150px,1.1fr)_minmax(240px,2.4fr)_150px_120px_90px_70px_70px] items-center gap-4 border-b border-line px-5 py-3.5 last:border-b-0"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-[13px] font-semibold text-fg">{a.label}</span>
                  <span className="truncate font-mono text-[10.5px] text-faint">{a.node}</span>
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="text-[12.5px] leading-[1.5] text-mist">{a.purpose}</span>
                  {a.tools.length > 0 && (
                    <span className="truncate font-mono text-[10px] text-ghost">
                      {a.tools.join(" · ")}
                    </span>
                  )}
                </span>
                <Meter a={a.autonomy} />
                <Hierarchy h={a.hierarchy} harness={a.harness} />
                <span className="text-right text-[12px] whitespace-nowrap text-dim">
                  {ago(a.lastRun)}
                </span>
                <span className="text-right text-[12.5px] text-fg tabular-nums">{a.runs7d}</span>
                {a.pending > 0 ? (
                  <Link
                    href="/runs"
                    title="Open runs"
                    className="focusable justify-self-end rounded-sm hover:underline"
                  >
                    <Status tone="warn">{a.pending} pending</Status>
                  </Link>
                ) : (
                  <span className="text-right text-[12.5px] text-ghost tabular-nums">—</span>
                )}
              </div>
            ))}
          </section>
        ))}
      </div>
      )}
    </div>
  );
}
