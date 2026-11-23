"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "./ui";
import { Banner } from "./overlays";
import { NotConnectedNote, useDoor } from "./pending";
import { AgentLink, Card, Facts, Note, TextLink } from "./workload-parts";
import { InputFields, InputValueText } from "./workload-inputs";
import { FirstRun } from "./workload-first-run";
import { count } from "./finding-marks";
import { api, type Schemas } from "@/lib/api/client";
import { startRefusalOf } from "@/lib/start-refusal";
import type { Dataset, DatasetList } from "@/lib/api/pending";
import {
  SETUP_STEPS,
  formOf,
  gatesOf,
  inputProblems,
  isGiven,
  toRunInput,
  valueOf,
  workloadHref,
  type InputValue,
  type InputValues,
  type OfferReading,
  type SetupStep,
  type WorkloadGate,
  type WorkloadInput,
  type WorkloadProfile,
} from "@/lib/workloads";

/**
 * The guided set-up of one workload, in five steps kept in the address
 * (`&step=`): what it runs on, who decides, limits, review and start, and
 * the first run.
 *
 * The inputs and gates are the workloads door's once it names them; until
 * then the default set-up from lib/workloads.ts is shown, the form disabled,
 * so a person sees what will be asked. Start posts to the runs door
 * (`POST /api/runs` with `{agent, input}`, as the Runs page does) and is
 * disabled, with the reason said, while the workload is not available or a
 * required input is missing. The last step follows the run that Start made.
 */

const GATE_HEAD = ["What it guards", "Who signs", "When it opens"];

function Rail({ id, step, run, lines }: { id: string; step: SetupStep; run: string; lines: Record<SetupStep, string> }) {
  return (
    <ol className="flex flex-row flex-wrap gap-1 lg:flex-col lg:gap-0.5" aria-label="Set-up steps">
      {SETUP_STEPS.map((s, i) => {
        const on = s.id === step;
        return (
          <li key={s.id} className="min-w-0">
            <Link
              href={workloadHref(id, { step: s.id, run })}
              aria-current={on ? "step" : undefined}
              className={`focusable flex items-start gap-2.5 rounded-md border px-2.5 py-2 transition-colors duration-100 ${on ? "border-line bg-surface elev-1" : "border-transparent hover:bg-raise/60"}`}
            >
              <span className={`tnum grid size-5 shrink-0 place-items-center rounded-sm text-[11px] font-semibold ${on ? "bg-ink text-on-ink" : "border border-line-strong bg-surface text-dim"}`}>{i + 1}</span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className={`text-[12.5px] leading-5 whitespace-nowrap ${on ? "font-semibold text-fg" : "font-medium text-dim"}`}>{s.label}</span>
                <span className="hidden text-[11px] leading-[1.4] break-words text-faint lg:block">{lines[s.id]}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

/** Back and Continue under a step. */
function StepNav({ id, step, run }: { id: string; step: SetupStep; run: string }) {
  const at = SETUP_STEPS.findIndex((s) => s.id === step);
  const prev = SETUP_STEPS[at - 1];
  const next = SETUP_STEPS[at + 1];
  // The last step is reached by starting a run, not by Continue, unless a run is already in the address.
  const onward = next && (next.id !== "first-run" || run);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {prev && (
        <Button size="sm" variant="solid" tone="neutral" href={workloadHref(id, { step: prev.id, run })}>
          Back: {prev.label}
        </Button>
      )}
      {onward && (
        <Button size="sm" variant="solid" tone="ink" href={workloadHref(id, { step: next.id, run })}>
          Continue: {next.label}
        </Button>
      )}
    </div>
  );
}

/** Why the form or the gates are the default ones and not the control plane's. */
function WhyDefault({ reading, what }: { reading: OfferReading; what: string }) {
  if (reading.state === "reading") return <Note>Reading the workloads&hellip;</Note>;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-line bg-canvas px-3 py-2.5">
      <span className="max-w-[86ch] text-[12px] leading-[1.55] text-dim">
        {what} {reading.why}
      </span>
      {reading.door && <NotConnectedNote door={reading.door} />}
    </div>
  );
}

function GateRows({ gates }: { gates: WorkloadGate[] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full min-w-[520px] border-collapse text-[11.5px]">
        <thead>
          <tr className="border-b border-line bg-raise/40 text-left text-[10.5px] text-faint">
            {GATE_HEAD.map((h) => (
              <th key={h} className="px-3 py-1.5 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {gates.map((g, i) => (
            <tr key={`${g.name}-${i}`} className="border-b border-line align-top last:border-0">
              <td className="px-3 py-2 text-[12px] font-medium break-words text-fg">{g.name}</td>
              <td className="px-3 py-2 text-dim">{g.role || <span className="text-faint">Named by the deployed agent</span>}</td>
              <td className="px-3 py-2 text-dim">{g.when || <span className="text-faint">Not stated</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function inputFacts(inputs: WorkloadInput[], values: InputValues, datasets: Dataset[]): { k: string; v: ReactNode }[] {
  return inputs.map((i) => ({ k: i.label, v: <InputValueText input={i} value={valueOf(i, values)} datasets={datasets} /> }));
}

/** What a refused start said, in the platform's words, as the Runs page shows the same refusals (lib/start-refusal.ts). */
function startRefusal(agent: string, status: number, error: unknown, retryAfter: string | null, response: Response): string {
  const refusal = startRefusalOf(agent, status, error, retryAfter, response);
  return refusal.kind === "rate_limit" ? `${refusal.text} It can be tried again in ${count(refusal.limit.retry_after_s)} seconds.` : refusal.text;
}

export function WorkloadSetup({
  profile,
  reading,
  values,
  onValue,
  step,
  run,
}: {
  profile: WorkloadProfile;
  reading: OfferReading;
  values: InputValues;
  onValue: (name: string, v: InputValue) => void;
  step: SetupStep;
  run: string;
}) {
  const id = profile.id;
  const router = useRouter();
  const form = formOf(profile, reading);
  const gates = gatesOf(profile, reading);
  const problems = inputProblems(form.inputs, values);
  const hasDataset = form.inputs.some((i) => i.kind === "dataset");
  const { answer: listed } = useDoor<DatasetList>("datasets", { skip: !hasDataset });
  const datasets = listed?.state === "ok" && Array.isArray(listed.data?.datasets) ? listed.data.datasets : [];
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState("");

  const required = form.inputs.filter((i) => i.required);
  const given = required.filter((i) => isGiven(i, valueOf(i, values))).length;
  const available = reading.state === "available";
  const canStart = available && form.open && problems.length === 0;

  // Why Start is off, most basic reason first.
  const reasons: string[] = [];
  if (!available) reasons.push(reading.why);
  else if (!form.open) reasons.push("The control plane has not named this workload's inputs.");
  else for (const p of problems) reasons.push(p.problem);

  const lines: Record<SetupStep, string> = {
    inputs: !form.open ? "Not open yet" : required.length ? `${count(given)} of ${count(required.length)} required given` : form.inputs.length ? "Nothing required" : "Takes no input",
    gates: `${gates.gates.length === 0 ? "No gate" : gates.gates.length === 1 ? "1 gate" : `${count(gates.gates.length)} gates`}${gates.from === "default" ? ", from the requirements" : ""}`,
    limits: reading.agent ? `The limits of ${reading.agent}` : "Agent not named yet",
    review: canStart ? "Ready to start" : "Not ready to start",
    "first-run": run ? "Following a run" : "No run started yet",
  };

  const start = async () => {
    if (!canStart || busy) return;
    setBusy(true);
    setRefused("");
    try {
      // No model and no endpoint are named: the agent's own steps say which model each one uses. The generated request type still asks for `provider`.
      const { data, error, response } = await api.POST("/api/runs", { body: { agent: reading.agent, input: toRunInput(form.inputs, values), model: "" } as Schemas["RunStartRequest"] });
      if (!data?.run) {
        setRefused(startRefusal(reading.agent, response.status, error, response.headers.get("retry-after"), response));
        return;
      }
      router.push(workloadHref(id, { step: "first-run", run: data.run }));
    } catch (e) {
      setRefused((e as Error).message || "the request did not reach the server");
    } finally {
      setBusy(false);
    }
  };

  // The gate that approves scope and methods: the requirements' own, or the one the control plane lists under that name.
  const approvalGate = !profile.approval ? "" : gates.from === "default" ? profile.approval.gate : (gates.gates.find((g) => /scope|method/i.test(g.name))?.name ?? "");

  const fromDefault = "From the workload's requirements; the control plane's own list replaces it when it answers.";

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-5">
      <Rail id={id} step={step} run={run} lines={lines} />

      <div className="flex min-w-0 flex-col gap-4">
        {step === "inputs" && (
          <Card title="What it runs on" hue="source" meta={form.from === "door" ? "as the control plane names them" : "the default set-up"}>
            {!form.open && <WhyDefault reading={reading} what="This is the form the workload is set up with, shown so you can see what will be asked. It opens once the workload is available." />}
            {form.inputs.length === 0 ? (
              <p className="text-[12.5px] leading-[1.6] text-dim">{form.from === "door" ? "This workload takes no input: it can be started as it is." : "The control plane has not named what this workload takes."}</p>
            ) : (
              <InputFields inputs={form.inputs} values={values} onChange={onValue} disabled={!form.open} />
            )}
            {hasDataset && (
              <Note>
                A dataset is something handed over once and named in a run. They are uploaded and listed on <TextLink href="/datasets">Datasets</TextLink>.
              </Note>
            )}
          </Card>
        )}

        {step === "gates" && (
          <>
            <Card title="Who decides" hue="gate" meta={gates.from === "door" ? "as the control plane lists them" : "from the requirements"}>
              <p className="max-w-[86ch] text-[12.5px] leading-[1.6] text-dim">
                A gate is a point where the run stops and waits for a person. Each gate names what it guards, the role that signs and when it opens. A gate that is waiting is answered in{" "}
                <TextLink href="/approvals">Approvals</TextLink>.
              </p>
              {gates.gates.length > 0 ? (
                <GateRows gates={gates.gates} />
              ) : (
                <p className="rounded-md border border-line bg-canvas px-3 py-2.5 text-[12px] leading-[1.55] text-dim">
                  {gates.from === "door" ? "The control plane lists no gate for this workload: a run goes from start to finish without waiting for a person." : "The requirements name no gate before or during a run of this workload. The control plane lists any gate the deployed agent carries."}
                </p>
              )}
              {gates.from === "default" && gates.gates.length > 0 && <Note>{fromDefault}</Note>}
              {profile.afterwards && (
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-dim">After the run</span>
                  <p className="max-w-[86ch] text-[12.5px] leading-[1.6] text-dim">{profile.afterwards}</p>
                </div>
              )}
            </Card>

            {profile.approval && approvalGate && (
              <Card title="What the approver is asked to approve" hue="approval" meta={`the "${approvalGate}" gate`}>
                <div className="flex flex-col gap-2">
                  <span className="text-[11px] font-semibold text-dim">Scope</span>
                  <p className="max-w-[86ch] text-[12.5px] leading-[1.6] text-dim">{profile.approval.scope}</p>
                  <div className="rounded-md border border-line bg-canvas p-3">
                    <Facts items={inputFacts(form.inputs, values, datasets)} />
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-[11px] font-semibold text-dim">Methods</span>
                  <p className="max-w-[86ch] text-[12.5px] leading-[1.6] text-dim">{profile.approval.methods}</p>
                </div>
              </Card>
            )}
          </>
        )}

        {step === "limits" && (
          <Card title="Limits" hue="budget" meta={reading.agent ? "the agent's own" : undefined}>
            <p className="max-w-[86ch] text-[12.5px] leading-[1.6] text-dim">
              A run of this workload is held to the budget and the bounds of the agent that runs it. They are set on the agent, not here, and they apply to every run it makes. A run that reaches its cost budget pauses for a
              person to decide; a run that reaches another bound stops. Its journal names which.
            </p>
            {reading.agent ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-line bg-canvas px-3 py-2.5">
                <span className="text-[12px] text-dim">Run by</span>
                <AgentLink agent={reading.agent} />
                <span className="grow" />
                <Button size="sm" variant="solid" tone="neutral" href={`/agent?id=${encodeURIComponent(reading.agent)}`}>
                  Open the agent&rsquo;s configuration
                </Button>
              </div>
            ) : (
              <WhyDefault reading={reading} what="The budget and bounds are on the configuration page of the agent that runs the workload, and no agent is named yet." />
            )}
          </Card>
        )}

        {step === "review" && (
          <Card title="Review and start" hue="run" meta={profile.name}>
            <div className="flex flex-col gap-2">
              <span className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-[11px] font-semibold text-dim">What it runs on</span>
                {form.open && form.inputs.length > 0 && (
                  <Link href={workloadHref(id, { step: "inputs", run })} className="focusable rounded-sm text-[11px] text-dim underline decoration-line-strong underline-offset-2 hover:text-fg">
                    Change
                  </Link>
                )}
              </span>
              {form.inputs.length ? (
                <div className="rounded-md border border-line bg-canvas p-3">
                  <Facts items={inputFacts(form.inputs, values, datasets)} />
                </div>
              ) : (
                <Note>{form.from === "door" ? "This workload takes no input." : "The control plane has not named what this workload takes."}</Note>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold text-dim">Who decides</span>
              {gates.gates.length ? (
                <GateRows gates={gates.gates} />
              ) : (
                <Note>{gates.from === "door" ? "The control plane lists no gate: the run does not wait for a person." : "The requirements name no gate for this workload."}</Note>
              )}
              {gates.from === "default" && gates.gates.length > 0 && <Note>{fromDefault}</Note>}
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-semibold text-dim">Limits</span>
              <p className="text-[12.5px] leading-[1.6] text-dim">
                {reading.agent ? (
                  <>
                    Held to the budget and bounds of <AgentLink agent={reading.agent} />.
                  </>
                ) : (
                  "Held to the budget and bounds of the agent that runs it, once one is named."
                )}
              </p>
            </div>

            <div className="flex flex-col gap-2.5 rounded-md border border-line bg-canvas p-3">
              <span className="flex flex-wrap items-center gap-3">
                <Button variant="solid" tone="ink" permission="run" disabled={!canStart} loading={busy} onClick={start}>
                  Start the run
                </Button>
                <span className="text-[12px] text-dim">{canStart ? `Starts a run of ${reading.agent} on what is listed above.` : "Start is not available yet."}</span>
              </span>
              {!canStart && reasons.length > 0 && (
                <ul className="flex flex-col gap-1" data-start-reasons>
                  {reasons.map((r, i) => (
                    <li key={i} className="flex gap-2 text-[12px] leading-[1.5] text-mist">
                      <span className="mt-[7px] size-1 shrink-0 rounded-[1px] bg-warn" />
                      <span className="min-w-0 break-words">{r}</span>
                    </li>
                  ))}
                </ul>
              )}
              {!canStart && reading.door && <NotConnectedNote door={reading.door} />}
            </div>

            {refused && (
              <Banner tone="err" title="The run was not started">
                {/[.!?]$/.test(refused.trim()) ? refused.trim() : `${refused.trim()}.`} Nothing was started, and what you chose is still here.
              </Banner>
            )}
          </Card>
        )}

        {step === "first-run" && <FirstRun run={run} />}

        <StepNav id={id} step={step} run={run} />
      </div>
    </div>
  );
}
