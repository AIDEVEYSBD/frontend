"use client";

import { useEffect, useState } from "react";
import { Button, Mono } from "./ui";
import { Field, Switch, Textarea } from "./forms";
import { Pick } from "./select";
import { listOfferedModels, steerRun, type OfferedModel, type SteerResult } from "@/lib/api/l5";
import { CURRENT_USER } from "@/lib/user";
import { signerName, useSession } from "@/lib/use-session";
import { notBuiltDoorOf } from "@/lib/api/client";
import { useDoorBuilt } from "@/lib/use-doors";
import { Failure, NotConnected, type NamedDoor } from "./pending";

/**
 * Steering a live run.
 *
 * Three controls on the same channel as the cancel: guidance appended to
 * the next model prompt, a hold so the next call at or above write waits
 * for a person even if no gate names it, and the model the next model call
 * goes to (from what the deployment offers, `GET /api/models`). Each is
 * `POST /api/runs/{id}/steer` and is journalled as an operator action with
 * who and when; the transcript shows that entry when the stream delivers
 * it, and the panel keeps the backend's receipt until then. Only a run in
 * flight can be steered (the door answers 409 otherwise), and a hold, once
 * asked, cannot be withdrawn: the door has no lever for that.
 */
/** Where the backend says the steer went, in words. */
const DELIVERED: Record<SteerResult["delivery"], string> = {
  "in-process": "taken at the run's next step",
  worker: "handed to the worker at its next heartbeat",
  sdk: "handed to the agent on its next control poll",

  broker: "taken at the broker on its next call",
};

/**
 * `holdBlocked`: why the hold is not offered now (an SDK run waiting at a
 * gate, lib/steer.ts), shown in the hold's place; guidance and the model
 * still go.
 */
export function SteerPanel({ runId, holdBlocked }: { runId: string; holdBlocked?: string }) {
  const { session } = useSession();
  const by = signerName(session, CURRENT_USER.name);
  const [guidance, setGuidance] = useState("");
  const [hold, setHold] = useState(false);
  const [models, setModels] = useState<OfferedModel[]>([]);
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState<"guidance" | "hold" | "model" | null>(null);
  const [receipts, setReceipts] = useState<{ what: string; r: SteerResult }[]>([]);
  const [error, setError] = useState("");
  /** The platform answered 501 to the steer: the panel becomes the not-built panel, with no form that cannot be acted on. */
  const [pressedNotBuilt, setNotBuilt] = useState<NamedDoor | null>(null);
  // The platform's own list of what it has built (GET /api/doors) says so before anyone presses.
  const listed = useDoorBuilt("POST", "/api/runs/{id}/steer");
  const notBuilt = pressedNotBuilt ?? (listed === false ? { method: "POST", path: "/api/runs/{id}/steer" } : null);

  useEffect(() => {
    let stop = false;
    listOfferedModels()
      .then((m) => !stop && setModels(m))
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, []);

  const send = async (what: "guidance" | "hold" | "model", req: Parameters<typeof steerRun>[1], label: string) => {
    setBusy(what);
    setError("");
    try {
      const r = await steerRun(runId, req);
      setReceipts((rs) => [{ what: label, r }, ...rs].slice(0, 6));
      if (what === "guidance") setGuidance("");
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
        The platform does not take guidance or a model for a run in flight yet.
      </NotConnected>
    );

  return (
    <div className="relative flex flex-col gap-3 overflow-hidden rounded-md border border-line bg-surface p-3 pl-4">
      <span className="absolute inset-y-0 left-0 w-[3px] bg-run" />
      <span className="flex items-center gap-2">
        <span className="text-[12px] font-semibold text-fg">Steer this run</span>
        <span className="text-[10.5px] text-faint">{holdBlocked ? "waiting at a gate · taken on the agent's next control poll" : "applies to the next step"}</span>
      </span>

      <Field label="Guidance for the next step" hint="Sent to the platform for the run's next model call; its answer is shown below.">
        <Textarea rows={2} value={guidance} onChange={setGuidance} placeholder="What the next step should bear in mind." disabled={busy !== null} />
      </Field>
      <Button size="sm" variant="solid" tone="ink" permission="run" className="self-start" loading={busy === "guidance"} disabled={!guidance.trim() || busy !== null} onClick={() => send("guidance", { guidance: guidance.trim() }, "Guidance")}>
        Send guidance
      </Button>

      <div className="flex flex-col gap-1.5 border-t border-line pt-3">
        <span className="text-[12.5px] font-medium text-mist">Model for the next model call</span>
        <div className="flex items-center gap-2">
          <div className="min-w-0 grow">
            <Pick
              value={model}
              onChange={setModel}
              options={[{ value: "", label: models.length ? "as the spec routes it" : "no models offered" }, ...models.map((m) => ({ value: m.id, label: m.label }))]}
              disabled={busy !== null || models.length === 0}
              aria-label="Model for the next model call"
            />
          </div>
          <Button size="sm" variant="solid" tone="ink" permission="run" loading={busy === "model"} disabled={!model || busy !== null} onClick={() => send("model", { model }, `Model ${model}`)}>
            Apply
          </Button>
        </div>
      </div>

      {error && <Failure inline message={error} />}
      {receipts.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-line pt-2">
          {receipts.map(({ what, r }, i) => (
            <span key={i} className="flex items-center gap-2 text-[11px] text-faint">
              <span className="size-1.5 shrink-0 rounded-[2px] bg-ok" />
              <span className="min-w-0 truncate">
                {what} · {DELIVERED[r.delivery]} · {r.by || by}
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
