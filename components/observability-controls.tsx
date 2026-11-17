"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "./ui";
import { EmptyState } from "./overlays";
import { PageHeader } from "./section";
import { Pick } from "./select";
import { Skeleton } from "./loaders";
import { ControlsInForce } from "./controls-in-force";
import { ErrorLine } from "./observability-shared";
import { listAgents, type AgentSummary } from "@/lib/api/l2";
import { soon } from "@/lib/soon";
import { QUIET } from "@/lib/quiet";

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
      <PageHeader
        title="Controls in force"
        action={
          agents && agents.length > 0 ? (
            <label className="flex w-[min(340px,100%)] flex-col gap-1">
              <span className="text-[11px] font-medium text-faint">Agent</span>
              <Pick
                aria-label="Agent"
                value={agent}
                onChange={(id) => router.replace(`/observability/controls?agent=${encodeURIComponent(id)}`, { scroll: false })}
                options={[...(known ? [] : [{ value: agent, label: `${agent} · not in the registry` }]), ...agents.map((a) => ({ value: a.id, label: a.name ? `${a.name} · ${a.id}` : a.id }))]}
              />
            </label>
          ) : undefined
        }
      >
        What governs one agent: its gates and who signs them, the tools it is granted, its limits, the estate rules that apply to it now, its autonomy tier and the controls those bring into force. Each block links to the page where the rule is kept.
      </PageHeader>

      {error && <ErrorLine what="The agent registry did not answer" message={error} />}
      {!agents && !error && !asked && (
        <div className="rounded-lg border border-line bg-surface p-4 elev-1">
          <Skeleton lines={4} />
        </div>
      )}
      {agents && agents.length === 0 && !asked && <EmptyState title="No agents yet" detail="Once an agent is saved, pick it here to read what governs it." action={<Button size="sm" variant="solid" tone="ink" href="/workflows">Open workflows</Button>} />}
      {/* A quiet console whose registry did not answer has said so once above; the panel's own reads would only repeat it. */}
      {agent && !(QUIET && error) && <ControlsInForce key={agent} agent={agent} />}
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
