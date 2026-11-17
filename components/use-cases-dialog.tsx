"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "./ui";
import { Field, Input } from "./forms";
import { Pick, PickMany } from "./select";
import { QuietNote } from "./overlays";
import { NotConnectedNote } from "./pending";
import { QUIET } from "@/lib/quiet";
import { BASELINE } from "@/lib/baseline-policies";
import { TIERS } from "@/lib/api/l9";
import { DATA_CLASSES, ask, type DataClass, type Door, type UseCase, type UseCaseGate, type UseCaseRegistration } from "@/lib/api/pending";

/**
 * Registering a use case: who owns it, the data classes it handles, how much
 * it may do on its own, the workload it uses, and the gates where a run of it
 * waits for a person. A gate that nobody answers in time escalates or stops
 * the run; it never proceeds, so the form offers no such choice.
 *
 * The autonomy level is one of the platform's own tiers (lib/api/l9.ts
 * TIERS), named as the baseline policy names them.
 */

/* The tiers with the names and meanings the baseline policy "Autonomy tiers" gives them. */
const TIER_SETTINGS = BASELINE.find((p) => p.name === "Autonomy tiers")?.settings ?? [];
export const TIER_CHOICES: { value: string; label: string; means: string }[] = TIERS.map((t) => {
  const s = TIER_SETTINGS.find((x) => x.name.startsWith(`${t} `));
  return { value: t, label: s?.name ?? t, means: s?.value ?? "" };
});
/** A tier as the platform names it: `L3 Conditional`. A value that is not a tier is shown as it came. */
export const tierLabel = (tier: string): string => TIER_CHOICES.find((t) => t.value === tier)?.label ?? tier;

const ON_TIMEOUT: { value: UseCaseGate["on_timeout"]; label: string }[] = [
  { value: "escalate", label: "Escalate to another role" },
  { value: "stop", label: "Stop the run" },
];

interface GateDraft {
  key: number;
  name: string;
  approver_role: string;
  threshold: string;
  timeout: string;
  on_timeout: UseCaseGate["on_timeout"];
  escalate_to: string;
}

const minutesOf = (text: string): number => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : 0);

export function RegisterDialog({ workloads, onDone, onClose }: { workloads: { value: string; label: string }[]; onDone: (registered: UseCase | null, name: string) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [classes, setClasses] = useState<DataClass[]>([]);
  const [autonomy, setAutonomy] = useState("");
  const [workload, setWorkload] = useState("");
  const [gates, setGates] = useState<GateDraft[]>([]);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [waits, setWaits] = useState<Door | null>(null);
  const [error, setError] = useState("");
  const nextKey = useRef(1);

  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  const locked = useRef(busy);
  useEffect(() => {
    close.current = onClose;
    locked.current = busy;
  }, [onClose, busy]);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (!locked.current) close.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus?.();
    };
  }, []);

  const addGate = () => setGates((g) => [...g, { key: nextKey.current++, name: "", approver_role: "", threshold: "", timeout: "", on_timeout: "escalate", escalate_to: "" }]);
  const setGate = (key: number, patch: Partial<GateDraft>) => setGates((g) => g.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const tier = TIER_CHOICES.find((t) => t.value === autonomy);

  const gateOk = (g: GateDraft) => Boolean(g.name.trim() && g.approver_role.trim() && g.threshold.trim() && minutesOf(g.timeout) > 0 && (g.on_timeout === "stop" || g.escalate_to.trim()));
  const ready = Boolean(name.trim() && owner.trim() && classes.length && autonomy && workload) && gates.every(gateOk);
  const need = (missing: boolean, text: string) => (tried && missing ? text : undefined);

  const register = async () => {
    setTried(true);
    if (!ready || busy) return;
    const body: UseCaseRegistration = {
      name: name.trim(),
      owner: owner.trim(),
      data_classes: DATA_CLASSES.filter((c) => classes.includes(c)),
      autonomy,
      workload,
      gates: gates.map((g) => ({
        name: g.name.trim(),
        approver_role: g.approver_role.trim(),
        threshold: g.threshold.trim(),
        timeout_minutes: minutesOf(g.timeout),
        on_timeout: g.on_timeout,
        ...(g.on_timeout === "escalate" ? { escalate_to: g.escalate_to.trim() } : {}),
      })),
    };
    setBusy(true);
    setWaits(null);
    setError("");
    const a = await ask<UseCase>("useCaseRegister", { body });
    setBusy(false);
    if (a.state === "pending") return setWaits(a.door);
    if (a.state === "error") return setError(a.message);
    onDone(a.data && typeof a.data === "object" && typeof a.data.id === "string" ? a.data : null, body.name);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-canvas/70 p-4" onClick={busy ? undefined : onClose}>
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="af-use-case-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-[680px] flex-col overflow-hidden rounded-xl border border-line bg-surface elev-3 af-pop"
      >
        <div className="flex shrink-0 flex-col gap-1 border-b border-line px-5 py-3.5">
          <h3 id="af-use-case-title" className="text-[16px] font-semibold tracking-tight">
            Register a use case
          </h3>
          <p className="text-[12.5px] leading-[1.5] text-dim">It is registered as a draft. Nothing runs under it until it has been sent for approval and approved.</p>
        </div>

        <div className="flex min-h-0 grow flex-col gap-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" error={need(!name.trim(), "The use case needs a name.")}>
              <Input value={name} onChange={setName} disabled={busy} autoComplete="off" />
            </Field>
            <Field label="Owner" error={need(!owner.trim(), "Name the person who answers for it.")} hint={tried && !owner.trim() ? undefined : "The email or name of the person who answers for it."}>
              <Input value={owner} onChange={setOwner} disabled={busy} autoComplete="off" />
            </Field>
            <Field label="Data classes handled" error={need(classes.length === 0, "Choose every data class it handles.")}>
              <PickMany size="md" aria-label="Data classes handled" values={classes} onChange={setClasses} options={DATA_CLASSES.map((c) => ({ value: c, label: c }))} placeholder="Choose data classes" disabled={busy} />
            </Field>
            <Field label="Workload it uses" error={need(!workload, "Choose the workload it uses.")}>
              <Pick size="md" aria-label="Workload it uses" value={workload} onChange={setWorkload} options={[{ value: "", label: "Choose a workload" }, ...workloads]} disabled={busy} invalid={tried && !workload} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Autonomy level" error={need(!autonomy, "Choose an autonomy level.")} hint={tried && !autonomy ? undefined : tier?.means ? `${tier.label}: ${tier.means}.` : "How much a run of it may do without a person."}>
                <Pick size="md" aria-label="Autonomy level" value={autonomy} onChange={setAutonomy} options={[{ value: "", label: "Choose a level" }, ...TIER_CHOICES.map((t) => ({ value: t.value, label: t.label }))]} disabled={busy} invalid={tried && !autonomy} />
              </Field>
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] font-semibold text-fg">Gates</span>
              <span className="text-[11.5px] text-faint">where a run waits for a person</span>
              <span className="grow" />
              <Button size="sm" variant="solid" tone="neutral" onClick={addGate} disabled={busy}>
                Add a gate
              </Button>
            </div>
            {gates.length === 0 && <p className="text-[12px] leading-[1.5] text-faint">No gate is set: a run of this use case would not wait for a person anywhere. Add a gate for each point where one must decide.</p>}
            {gates.map((g, i) => (
              <div key={g.key} className="flex flex-col gap-3 rounded-md border border-line bg-canvas px-3 py-3">
                <div className="flex items-center gap-2">
                  <span className="text-[11.5px] font-medium text-dim">Gate {i + 1}</span>
                  <span className="grow" />
                  <Button size="sm" variant="solid" tone="err" onClick={() => setGates((all) => all.filter((x) => x.key !== g.key))} disabled={busy}>
                    Remove gate
                  </Button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Gate" error={need(!g.name.trim(), "Name the gate.")}>
                    <Input value={g.name} onChange={(v) => setGate(g.key, { name: v })} disabled={busy} autoComplete="off" />
                  </Field>
                  <Field label="Approver role" error={need(!g.approver_role.trim(), "Name the role that answers it.")}>
                    <Input value={g.approver_role} onChange={(v) => setGate(g.key, { approver_role: v })} disabled={busy} autoComplete="off" />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Threshold" error={need(!g.threshold.trim(), "Say what sends a run to this gate.")} hint={tried && !g.threshold.trim() ? undefined : "What sends a run to this gate, in plain words."}>
                      <Input value={g.threshold} onChange={(v) => setGate(g.key, { threshold: v })} disabled={busy} autoComplete="off" />
                    </Field>
                  </div>
                  <Field label="Timeout, in minutes" error={need(minutesOf(g.timeout) <= 0, "A whole number of minutes above zero.")}>
                    <Input value={g.timeout} onChange={(v) => setGate(g.key, { timeout: v })} disabled={busy} autoComplete="off" />
                  </Field>
                  <Field label="If nobody answers in time" hint="A gate never lets the run proceed by itself.">
                    <Pick size="md" aria-label="If nobody answers in time" value={g.on_timeout} onChange={(v) => setGate(g.key, { on_timeout: v })} options={ON_TIMEOUT} disabled={busy} />
                  </Field>
                  {g.on_timeout === "escalate" && (
                    <div className="sm:col-span-2">
                      <Field label="Escalate to" error={need(!g.escalate_to.trim(), "Name the role it escalates to.")} hint={tried && !g.escalate_to.trim() ? undefined : "The role the gate goes to once the timeout has passed."}>
                        <Input value={g.escalate_to} onChange={(v) => setGate(g.key, { escalate_to: v })} disabled={busy} autoComplete="off" />
                      </Field>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
          <span className="min-w-0 grow basis-[40%] text-[11.5px] leading-[1.5] text-faint">
            {waits ? <NotConnectedNote door={waits} /> : error ? QUIET ? <QuietNote inline /> : <span className="text-err">The use case was not registered: {error}</span> : tried && !ready ? <span className="text-err">Some fields above still need an answer.</span> : null}
          </span>
          <Button variant="solid" tone="err" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="solid" tone="ink" size="sm" permission="configure" onClick={() => void register()} loading={busy}>
            Register use case
          </Button>
        </div>
      </div>
    </div>
  );
}
