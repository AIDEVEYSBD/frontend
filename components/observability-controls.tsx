"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "./ui";
import { EmptyState, QuietNote } from "./overlays";
import { GroupHeader } from "./page-tabs";
import { Pick } from "./select";
import { Skeleton } from "./loaders";
import { ControlsInForce } from "./controls-in-force";
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
          ) : QUIET && error ? (
            <label className="flex items-center gap-2">
              <span className="text-[11.5px] font-medium text-faint">Agent</span>
              <span className="w-[min(320px,60vw)]">
                <Pick aria-label="Agent" value="" onChange={() => {}} options={[{ value: "", label: "Agents are picked here" }]} disabled />
              </span>
            </label>
          ) : undefined
        }
      >
        What governs one agent: its gates and who signs them, the tools it is granted, its limits, the estate rules that apply to it now, its autonomy tier and the controls those bring into force. Each block links to the page where the rule is kept.
      </GroupHeader>

      {/* The registry's failure, once: a quiet console (lib/quiet.ts) says it is not connected and prints no reason. */}
      {error &&
        (QUIET ? (
          <QuietNote />
        ) : (
          <p role="alert" className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err">
            The agent registry did not answer: {error}
          </p>
        ))}
      {!agents && !error && !asked && (
        <div className="rounded-lg border border-line bg-surface p-4 elev-1">
          <Skeleton lines={4} />
        </div>
      )}
      {agents && agents.length === 0 && !asked && <EmptyState title="No agents yet" detail="Once an agent is saved, pick it here to read what governs it." action={<Button size="sm" variant="solid" tone="ink" href="/agents">Open agents</Button>} />}
      {/* A quiet console whose registry did not answer has said so once above; the panel is drawn empty beneath it and reads nothing. */}
      {QUIET && error ? <ControlsInForce key="bare" agent="" bare /> : agent && <ControlsInForce key={agent} agent={agent} />}
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
