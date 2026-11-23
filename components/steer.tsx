"use client";

import { useState } from "react";
import { Button, Mono } from "./ui";
import { Field, Textarea } from "./forms";
import { Pick } from "./select";
import { steerRun, type SteerResult } from "@/lib/api/l5";
import { CURRENT_USER } from "@/lib/user";
import { signerName, useSession } from "@/lib/use-session";
import { notBuiltDoorOf } from "@/lib/api/client";
import { useDoorBuilt } from "@/lib/use-doors";
import { useModels } from "@/lib/use-models";
import { Failure, NotConnected, type NamedDoor } from "./pending";

/**
 * Steering a run in flight.
 *
 * Three levers, each its own `POST /api/runs/{id}/steer` with one lever:
 * guidance added to the run's next model call; a hold, so the run's next
 * tool call at or above write waits for a person even if no gate names it;
 * and the model the next model call goes to, from the models this
 * deployment offers (`GET /api/config` `models`, the list chosen under
 * Configuration, Models; the platform refuses any other). The platform
 * parks the lever on the run and the run takes it at its next step; the
 * run's journal then notes who asked (the transcript draws that note). A
 * run waiting at a gate takes levers too: they wait for its next step after
 * the gate. A lever still pending when the run ends is never applied. A
 * hold, once asked, cannot be withdrawn: the platform has no lever for that.
 * The panel keeps the platform's receipt for each lever it sent.
 */

/** Where the platform says the lever went, in words. */
const DELIVERED: Record<SteerResult["delivery"], string> = {
  "in-process": "taken at the run's next step",
  worker: "handed to the worker at its next heartbeat",
  sdk: "handed to the agent on its next control poll",
  broker: "taken at the broker on its next call",
};

export function SteerPanel({ runId, atGate = false }: { runId: string; /** The run waits at a gate: each lever is taken at its next step after the gate. */ atGate?: boolean }) {
  const { session } = useSession();
  const by = signerName(session, CURRENT_USER.name);
  const [guidance, setGuidance] = useState("");
  const [held, setHeld] = useState(false);
  const { models, read: modelsRead, error: modelsError } = useModels();
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState<"guidance" | "hold" | "model" | null>(null);
  const [receipts, setReceipts] = useState<{ what: string; r: SteerResult }[]>([]);
  const [error, setError] = useState("");
  /** The platform answered 501 to the steer: the panel becomes the not-built panel, with no form that cannot be acted on. */
  const [pressedNotBuilt, setNotBuilt] = useState<NamedDoor | null>(null);
  // The platform's own list of what it has built (GET /api/doors) says so before anyone presses.
  const listed = useDoorBuilt("POST", "/api/runs/{id}/steer");
  const notBuilt = pressedNotBuilt ?? (listed === false ? { method: "POST", path: "/api/runs/{id}/steer" } : null);

  const send = async (what: "guidance" | "hold" | "model", req: Parameters<typeof steerRun>[1], label: string) => {
    setBusy(what);
    setError("");
    try {
      const r = await steerRun(runId, req);
      setReceipts((rs) => [{ what: label, r }, ...rs].slice(0, 6));
      if (what === "guidance") setGuidance("");
      if (what === "hold") setHeld(true);
      return true;
    } catch (e) {
      const door = notBuiltDoorOf((e as Error).message);
      if (door) setNotBuilt(door);
      else setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  if (notBuilt)
    return (
      <NotConnected door={notBuilt} compact title="Steering a run is not built yet">
        The platform does not take guidance, a hold or a model for a run in flight yet.
      </NotConnected>
    );

  const modelOptions = [{ value: "", label: !modelsRead && !modelsError ? "reading the offered models…" : models.length ? "choose a model" : "no model offered" }, ...models.map((m) => ({ value: m.id, label: m.label || m.id }))];

  return (
    <div className="relative flex flex-col gap-3 overflow-hidden rounded-md border border-line bg-surface p-3 pl-4">
      <span className="absolute inset-y-0 left-0 w-[3px] bg-run" />
      <span className="flex flex-col gap-0.5">
        <span className="text-[12px] font-semibold text-fg">Steer this run</span>
        <span className="text-[10.5px] leading-[1.45] text-faint">
          {atGate
            ? "Waiting at a gate: each lever waits on the run and is taken at its next step after the gate is answered. A lever still waiting when the run ends is never applied."
            : "Each lever is taken at the run's next step. A lever still waiting when the run ends is never applied."}
        </span>
      </span>

      <Field label="Guidance for the next model call" hint="Added to the run's next model call as your words, with your name in its journal.">
        <Textarea rows={2} value={guidance} onChange={setGuidance} placeholder="What the next step should bear in mind." disabled={busy !== null} />
      </Field>
      <Button size="sm" variant="solid" tone="ink" permission="run" className="self-start" loading={busy === "guidance"} disabled={!guidance.trim() || busy !== null} onClick={() => send("guidance", { guidance: guidance.trim() }, "Guidance")}>
        Send guidance
      </Button>

      <div className="flex items-start justify-between gap-3 border-t border-line pt-3">
        <span className="flex min-w-0 flex-col">
          <span className="text-[12.5px] font-medium text-mist">Hold the next write for a person</span>
          <span className="text-[11px] leading-[1.45] text-faint">
            {held
              ? "Asked. The run's next tool call at or above write waits for a person; a hold cannot be withdrawn."
              : atGate
                ? "The run's next tool call at or above write after this gate waits for a person, even if no gate names it."
                : "The run's next tool call at or above write waits for a person, even if no gate names it."}
          </span>
        </span>
        <Button size="sm" variant="solid" tone="warn" permission="run" className="shrink-0" loading={busy === "hold"} disabled={held || busy !== null} onClick={() => send("hold", { hold_at_next_gate: true }, "Hold on the next write")}>
          {held ? "Hold asked" : "Ask for a hold"}
        </Button>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-line pt-3">
        <span className="text-[12.5px] font-medium text-mist">Model for the next model call</span>
        <div className="flex items-center gap-2">
          <div className="min-w-0 grow">
            <Pick value={model} onChange={setModel} options={modelOptions} disabled={busy !== null || models.length === 0} aria-label="Model for the next model call" />
          </div>
          <Button size="sm" variant="solid" tone="ink" permission="run" loading={busy === "model"} disabled={!model || busy !== null} onClick={() => send("model", { model }, `Model ${model}`)}>
            Apply
          </Button>
        </div>
        {modelsError ? (
          <span className="text-[11px] leading-[1.45] text-err">The models this deployment offers could not be read: {modelsError}</span>
        ) : modelsRead && models.length === 0 ? (
          <span className="text-[11px] leading-[1.45] text-faint">This deployment offers no model (Configuration, Models), so there is none to steer to.</span>
        ) : (
          <span className="text-[11px] leading-[1.45] text-faint">The models this deployment offers (Configuration, Models).</span>
        )}
      </div>

      {error && <Failure inline message={error} />}
      {receipts.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-line pt-2">
          {receipts.map(({ what, r }, i) => (
            <span key={i} className="flex items-center gap-2 text-[11px] text-faint">
              <span className="size-1.5 shrink-0 rounded-[2px] bg-ok" />
              <span className="min-w-0 truncate">
                {what} · {r.state === "suspended" ? "waiting at its gate; taken at its next step after it" : DELIVERED[r.delivery]} · {r.by || by}
                {r.at ? (
                  <>
                    {" · "}
                    <Mono className="text-[10px]">{new Date(r.at).toLocaleTimeString()}</Mono>
                  </>
                ) : null}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
