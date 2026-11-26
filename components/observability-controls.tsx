"use client";
import { Failure } from "./pending";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "./ui";
import { EmptyState } from "./overlays";
import { GroupHeader } from "./page-tabs";
import { Pick } from "./select";
import { Skeleton } from "./loaders";
import { ControlsInForce } from "./controls-in-force";
import { listAgents, type AgentSummary } from "@/lib/api/l2";
import { soon } from "@/lib/soon";

/**
 * Controls in force, for one agent at a time: the panel
 * (components/controls-in-force.tsx) under an agent picker. `?agent=` names
 * the agent, so another page can link straight to it.
 */
function ControlsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [error, setError] = useState("");
  useEffect(
    () =>
      soon(() => {
        listAgents()
          .then(setAgents)
          .catch((e) => setError((e as Error).message));
      }),
    [],
  );
  const asked = params.get("agent");
  const agent = asked ?? agents?.[0]?.id ?? "";
  const known = !agents || agents.some((a) => a.id === agent);
  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7">
      <GroupHeader
        group="controls"
        tab="inforce"
        actions={
          agents && agents.length > 0 ? (
            <label className="flex items-center gap-2">
              <span className="text-[11.5px] font-medium text-faint">Agent</span>
              <span className="w-[min(320px,60vw)]">
                <Pick
                  aria-label="Agent"
                  value={agent}
                  onChange={(id) => router.replace(`/observability/controls?agent=${encodeURIComponent(id)}`, { scroll: false })}
                  options={[...(known ? [] : [{ value: agent, label: `${agent} · not in the registry` }]), ...agents.map((a) => ({ value: a.id, label: a.name ? `${a.name} · ${a.id}` : a.id }))]}
                />
              </span>
            </label>
          ) : undefined
        }
      >
        Gates, tools, limits, estate rules and controls governing one agent.
      </GroupHeader>

      {/* The registry's failure, once, with its status and address. */}
      {error && <Failure what="The agent registry did not answer" message={error} />}
      {!agents && !error && !asked && (
        <div className="rounded-lg border border-line bg-surface p-4 elev-1">
          <Skeleton lines={4} />
        </div>
      )}
      {agents && agents.length === 0 && !asked && <EmptyState title="No agents yet" action={<Button size="sm" variant="solid" tone="ink" href="/agents">Open agents</Button>} />}
      {agent && <ControlsInForce key={agent} agent={agent} />}
    </div>
  );
}

export function ControlsInForceView() {
  return (
    <Suspense>
      <ControlsPage />
    </Suspense>
  );
}
