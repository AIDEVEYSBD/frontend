"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { GroupHeader } from "./page-tabs";
import { Mono, Status } from "./ui";

/**
 * The header of one agent's pages: Configuration (/agent), Versions
 * (/lifecycle) and Bill of materials (/bom) are tabs of the agent that is
 * open, so the three draw this and nothing of their own above the body. It
 * is the group header (components/page-tabs.tsx) with the agent's name for a
 * title, its id carried to every tab, its status beside the name, and a
 * small way back to the list above it.
 *
 * Each tab reads the agent through its own door, so the name and status
 * arrive a moment after the page does. What the last tab learned is kept
 * here, per agent, for as long as the console stays open: moving between
 * tabs shows the same name and status at once, with no flash of the bare id.
 */

/** What the header needs to know of an agent; every door that describes one carries these. */
export interface AgentFacts {
  name: string;
  retired?: unknown;
  deployed_version?: number | null;
}

type Tab = "configuration" | "versions" | "bom";

const seen = new Map<string, AgentFacts>();

function BackToAgents() {
  return (
    <Link href="/agents" className="focusable flex w-fit items-center gap-1 rounded-sm text-[11.5px] font-medium text-faint hover:text-fg">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m15 6-6 6 6 6" />
      </svg>
      All agents
    </Link>
  );
}

/** The status every list and header shows for an agent: retired, deployed or not deployed. */
export function AgentStatus({ agent }: { agent: Pick<AgentFacts, "retired" | "deployed_version"> }) {
  if (agent.retired) return <Status tone="neutral">Retired</Status>;
  return typeof agent.deployed_version === "number" ? <Status tone="ok">Deployed</Status> : <Status tone="neutral">Not deployed</Status>;
}

export function AgentHeader({ tab, id, agent, actions, children }: { tab: Tab; id: string; /** The agent as this tab read it; null until its door answers. */ agent: AgentFacts | null; actions?: ReactNode; children?: ReactNode }) {
  const name = agent?.name ?? "";
  const retired = Boolean(agent?.retired);
  const deployed = agent?.deployed_version ?? null;
  useEffect(() => {
    if (name) seen.set(id, { name, retired, deployed_version: deployed });
  }, [id, name, retired, deployed]);
  const known = agent?.name ? agent : (seen.get(id) ?? null);
  return (
    <div className="flex flex-col gap-1.5">
      <BackToAgents />
      <GroupHeader
        group="agent"
        tab={tab}
        title={known?.name ?? id}
        subject={id}
        meta={
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            {known && <Mono className="text-[11px] text-faint">{id}</Mono>}
            {known && <AgentStatus agent={known} />}
          </span>
        }
        actions={actions}
      >
        {children}
      </GroupHeader>
    </div>
  );
}

/** A page of the group opened with no agent named: its own title, what to do, and the way back to the list. */
export function ChooseAgentHeader({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <BackToAgents />
      <header className="flex flex-col gap-3">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">{title}</h1>
        <p className="max-w-[92ch] text-[12.5px] leading-[1.6] text-dim">{children}</p>
      </header>
    </div>
  );
}
