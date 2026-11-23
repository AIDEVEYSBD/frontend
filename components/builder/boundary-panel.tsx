"use client";

import { Pick } from "../select";
import {
  OUTPUT_META,
  TRIGGER_META,
  type AgentSystem,
  type DataClass,
  type OutputDecl,
  type Trigger,
} from "@/lib/spec";
import { dataClassChoices } from "@/lib/bom";
import { machineAddress, machineLine } from "@/lib/site";
import { useMachineOrigin } from "@/lib/use-session";
import type { Action } from "@/lib/builder-store";
import { Cross, Mini, Plus, Row, Section, Text } from "./controls";

/**
 * The system's boundary: how a run starts, and what happens to the result.
 *
 * Neither is a harness — a trigger fires before any model call is decided, and
 * an output runs after the last one has been. They are bindings on the
 * boundary, which is why they are declared beside the graph rather than drawn
 * inside it, and why the same graph can be prompt-driven today and
 * cron-driven tomorrow without a node moving.
 */
export function BoundaryPanel({
  system,
  dispatch,
}: {
  system: AgentSystem;
  dispatch: (a: Action) => void;
}) {
  const trigger: Trigger = system.trigger ?? { kind: "api" };
  const outputs = system.outputs ?? [];

  // An outside system posts to the platform's own address (the session's machineOrigin), never the console's: the console's sign-in stands in front of that.
  const machine = useMachineOrigin();
  const door = trigger.kind === "webhook" ? `/api/webhooks/${system.id}` : `/api/trigger/${system.id}`;
  const endpoint = machineAddress(machine, door);
  const setTrigger = (t: Trigger) => dispatch({ type: "set-trigger", trigger: t });
  const setOutputs = (o: OutputDecl[]) => dispatch({ type: "set-outputs", outputs: o });

  return (
    <>
      <Section title="Input">
        <p className="-mt-0.5 text-[11.5px] leading-[1.5] text-faint">
          {TRIGGER_META[trigger.kind].blurb} The graph is identical whichever starts it.
        </p>
        <Row label="Started by" tight>
          <Pick
            value={trigger.kind}
            onChange={(v) => setTrigger({ kind: v as Trigger["kind"], config: {} })}
            options={(Object.keys(TRIGGER_META) as Trigger["kind"][]).map((k) => ({
              value: k,
              label: TRIGGER_META[k].label,
            }))}
          />
        </Row>

        {trigger.kind === "cron" && (
          <Row label="Schedule" tight hint="Five fields: minute hour day month weekday.">
            <Text
              mono
              value={String(trigger.config?.cron ?? "")}
              placeholder="*/15 9-17 * * 1-5"
              invalid={!String(trigger.config?.cron ?? "").trim()}
              onChange={(v) => setTrigger({ ...trigger, config: { ...trigger.config, cron: v } })}
            />
          </Row>
        )}
        {trigger.kind === "prompt" && (
          <Row label="Prompt placeholder" tight hint="Shown to whoever types the input.">
            <Text
              value={String(trigger.config?.placeholder ?? "")}
              placeholder="What should this agent look at?"
              onChange={(v) =>
                setTrigger({ ...trigger, config: { ...trigger.config, placeholder: v } })
              }
            />
          </Row>
        )}
        {trigger.kind === "webhook" && (
          <Row label="Route" tight hint="The suffix this agent listens on.">
            <Text
              mono
              value={String(trigger.config?.route ?? "")}
              placeholder="alerts/incoming"
              onChange={(v) => setTrigger({ ...trigger, config: { ...trigger.config, route: v } })}
            />
          </Row>
        )}
        {(trigger.kind === "api" || trigger.kind === "webhook") && (
          <Row
            label="Endpoint"
            tight
            hint={
              trigger.kind === "webhook"
                ? "Open once the agent is deployed. The posted JSON body is the run's input, marked untrusted. The delivery is signed (Standard Webhooks) with the secret the trigger's config names (secret: ${secret:<name>}), or carries an API key bound to the agent. The answer is 202 with the job and its status_url."
                : 'Open once the agent is deployed. Send an API key bound to the agent and {"input": {...}} matching the entry node\'s inputs; GET describes them. The answer is 202 with the job and its status_url; a worker then carries out the run.'
            }
          >
            {endpoint ? (
              <code className="block truncate rounded-md border border-line bg-canvas px-2.5 py-1.5 font-mono text-[11px] text-fg">POST {endpoint}</code>
            ) : (
              <p className={`text-[11px] leading-[1.5] ${machine === undefined ? "text-faint" : "text-warn"}`}>
                {machineLine(machine, door, trigger.kind === "webhook" ? "a sender cannot reach this agent's webhook" : "an outside system cannot reach this agent's trigger")}
              </p>
            )}
          </Row>
        )}
      </Section>

      <Section
        title="Outputs"
        count={outputs.length}
        action={
          <Mini
            label="Add an output"
            onClick={() => setOutputs([...outputs, { kind: "response" }])}
          >
            <Plus />
          </Mini>
        }
      >
        {outputs.length === 0 && (
          <p className="text-[11.5px] leading-[1.5] text-faint">
            Nothing declared — the result is returned to the caller and goes nowhere else. Declare
            more and the same run also writes a report, a file, or a webhook.
          </p>
        )}
        <div className="flex flex-col gap-2">
          {outputs.map((o, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-md border border-line bg-raise/50 p-2.5">
              <div className="flex items-center gap-2">
                <div className="w-[130px] shrink-0">
                  <Pick
                    value={o.kind}
                    onChange={(v) =>
                      setOutputs(
                        outputs.map((x, j) =>
                          j === i ? { kind: v as OutputDecl["kind"], from_node: x.from_node, config: {} } : x,
                        ),
                      )
                    }
                    options={(Object.keys(OUTPUT_META) as OutputDecl["kind"][]).map((k) => ({
                      value: k,
                      label: OUTPUT_META[k].label,
                    }))}
                  />
                </div>
                <div className="min-w-0 grow">
                  <Pick
                    value={o.from_node ?? ""}
                    onChange={(v) =>
                      setOutputs(outputs.map((x, j) => (j === i ? { ...x, from_node: v || undefined } : x)))
                    }
                    options={[
                      { value: "", label: "from the run result" },
                      ...system.nodes.map((n) => ({ value: n.id, label: `from ${n.label || n.id}` })),
                    ]}
                  />
                </div>
                <Mini label="Remove output" tone="err" onClick={() => setOutputs(outputs.filter((_, j) => j !== i))}>
                  <Cross size={10} />
                </Mini>
              </div>

              <p className="text-[11px] leading-[1.5] text-faint">{OUTPUT_META[o.kind].blurb}</p>

              {(o.kind === "document" || o.kind === "json") && (
                <div className="grid grid-cols-2 gap-2">
                  {o.kind === "document" && (
                    <Row label="Format" tight>
                      <Pick
                        value={String(o.config?.format ?? "md")}
                        onChange={(v) =>
                          setOutputs(outputs.map((x, j) => (j === i ? { ...x, config: { ...x.config, format: v } } : x)))
                        }
                        options={["md", "pdf", "docx", "html", "txt", "csv", "xlsx"].map((f) => ({
                          value: f,
                          label: f === "md" ? "Markdown" : f.toUpperCase(),
                        }))}
                      />
                    </Row>
                  )}
                  {o.kind === "document" && (
                    <Row label="Title" tight>
                      <Text
                        value={String(o.config?.title ?? "")}
                        placeholder={system.name}
                        onChange={(v) =>
                          setOutputs(outputs.map((x, j) => (j === i ? { ...x, config: { ...x.config, title: v } } : x)))
                        }
                      />
                    </Row>
                  )}
                  <Row label="Filename" tight hint="{ts} and {id} are filled in. Just a name — never a path.">
                    <Text
                      mono
                      value={String(o.config?.filename ?? "")}
                      placeholder={`${system.id}-{ts}.${o.kind === "json" ? "json" : "md"}`}
                      onChange={(v) =>
                        setOutputs(outputs.map((x, j) => (j === i ? { ...x, config: { ...x.config, filename: v } } : x)))
                      }
                    />
                  </Row>
                </div>
              )}

              {o.kind === "webhook" && (
                <Row label="URL" tight hint={'Auth headers can reference the vault: {"authorization": "Bearer ${secret:name}"}.'}>
                  <Text
                    mono
                    value={String(o.config?.url ?? "")}
                    placeholder="https://hooks.your-org.example/agent-results"
                    invalid={!String(o.config?.url ?? "").trim()}
                    onChange={(v) =>
                      setOutputs(outputs.map((x, j) => (j === i ? { ...x, config: { ...x.config, url: v } } : x)))
                    }
                  />
                </Row>
              )}
              {o.kind === "webhook" && (
                <Row label="Highest data class it takes" tight hint="A result of a higher class is refused here, and nothing is posted.">
                  <Pick
                    aria-label={`Highest data class output ${i + 1} takes`}
                    value={o.max_data_class ?? ""}
                    options={dataClassChoices("no limit declared")}
                    onChange={(v) =>
                      setOutputs(outputs.map((x, j) => {
                        if (j !== i) return x;
                        const { max_data_class: _, ...rest } = x;
                        return v ? { ...rest, max_data_class: v as DataClass } : rest;
                      }))
                    }
                  />
                </Row>
              )}
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
