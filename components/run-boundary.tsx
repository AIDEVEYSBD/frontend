"use client";
import { Failure } from "./pending";

import { useEffect, useState } from "react";
import { Button, Tag } from "./ui";
import { RunStrip, specLine, type LimitEntry, type RunFacts, type RunSpec } from "./run-limits";
import { sandboxOfEntry, sandboxRunOf, SANDBOX_TOOL, type SandboxRun } from "@/lib/sandbox";
import { shortDigest } from "@/lib/digest";
import { notBuilt, readConfiguration } from "@/lib/not-built";
import { callOutcomes } from "@/lib/tool-calls";
import { useDoorBuilt } from "@/lib/use-doors";
import { controlLabel } from "@/lib/guardrails";

/**
 * The trust boundary of one run, stated in one place: where it executed and
 * under what. The isolation the journal recorded, the tools each step was
 * granted and how each is scoped (the spec), the data class ceiling where
 * one is set, the deployment's egress allowlist, and how many calls were
 * refused, with a jump to them. Each line is a fact the record or the
 * deployment holds; where it holds none, the line says so.
 */

type Rec = Record<string, unknown>;
const obj = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === "string");

export interface GrantedTool {
  name: string;
  risk: string;
  sink: boolean;
  taints: boolean;
  /** Argument path to the values it may take: the tool's registered scope, then the step's narrowing over it. */
  scope: Record<string, string[]>;
  /** The step narrowed the tool's own scope. */
  narrowed: boolean;
  /** A sink's limit on the class of what it may carry out. */
  maxDataClass: string;
}

export interface StepGrant {
  node: string;
  label: string;
  tools: GrantedTool[];
  /** The highest class of data the step may read. */
  maxDataClass: string;
  /** `spec`: `policy.grants`. `journal`: the tools the run journalled on entering the step, when there is no spec. */
  from: "spec" | "journal";
}

const scopeOf = (v: unknown): Record<string, string[]> => Object.fromEntries(Object.entries(obj(v)).map(([k, x]) => [k, strs(x)]));

/** What each step may call: the spec's grants, or (with no spec) the tools the journal recorded on entry. */
export function stepGrants(spec: Rec | null, entries: LimitEntry[]): StepGrant[] {
  if (!spec) {
    const out: StepGrant[] = [];
    for (const e of entries) {
      if (e.kind !== "node.enter" || !e.node || !Array.isArray(e.data?.tools) || out.some((g) => g.node === e.node)) continue;
      out.push({
        node: e.node,
        label: str(e.title) || e.node,
        tools: strs(e.data?.tools).map((name) => ({ name, risk: "", sink: false, taints: false, scope: {}, narrowed: false, maxDataClass: "" })),
        maxDataClass: "",
        from: "journal",
      });
    }
    return out;
  }
  const tools = new Map(arr(spec.tools).map((t) => [str(obj(t).name), obj(t)]));
  const grants = new Map(arr(obj(spec.policy).grants).map((g) => [str(obj(g).node), obj(g)]));
  return arr(spec.nodes).map((n) => {
    const id = str(obj(n).id);
    const g = grants.get(id) ?? {};
    const narrowing = obj(g.scope);
    return {
      node: id,
      label: str(obj(n).label) || id,
      tools: strs(g.tools).map((name) => {
        const t = tools.get(name) ?? {};
        const own = scopeOf(narrowing[name]);
        return {
          name,
          risk: str(t.risk),
          sink: t.is_sink === true,
          taints: t.taints === true,
          scope: { ...scopeOf(t.scope), ...own },
          narrowed: Object.keys(own).length > 0,
          maxDataClass: str(t.max_data_class),
        };
      }),
      maxDataClass: str(g.max_data_class),
      from: "spec" as const,
    };
  });
}

/** Every isolated execution the journal holds: a `sandbox.execute` result, or an entry the runtime journalled for one. */
export function isolationOf(entries: LimitEntry[]): SandboxRun[] {
  const out: SandboxRun[] = [];
  for (const e of entries) {
    const run = e.kind === "tool.result" && e.data?.tool === SANDBOX_TOOL ? sandboxRunOf(e.data?.value) : e.kind !== "tool.call" ? sandboxOfEntry({ kind: e.kind, title: e.title, data: e.data }) : null;
    if (run) out.push(run);
  }
  return out;
}

const SOURCE: Record<string, string> = {
  "": "the platform's runtime",
  console: "the platform's runtime, from the console",
  worker: "a platform worker, from the queue",
  sdk: "the attached agent's process, via the SDK",
  a2a: "an attached agent, over A2A",
  gateway: "outside the platform, via the model gateway",
};

/** The spec's four risk levels: read, write, risky, destructive. */
const RISK_TONE = (risk: string) => (risk === "destructive" ? "err" : risk === "risky" ? "warn" : "neutral");

function Fact({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-2">
      <dt className="text-[10px] font-medium text-faint">{k}</dt>
      <dd className="text-[11.5px] leading-[1.5] text-dim">{children}</dd>
    </div>
  );
}

/**
 * What the deployment says about itself, from its configuration record (read
 * once per page): the egress allowlist, and the parts its `not_built` list
 * names (`tools`, `egress`). A failed read states nothing either way.
 */
function useDeployment(): { state: "loading" | "ok" | "error"; hosts: string[]; unbuilt: string[]; message: string } {
  const [got, setGot] = useState<{ hosts: string[]; unbuilt: string[]; message: string; ok: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    void readConfiguration().then((r) => {
      if (!live) return;
      if (r.ok) setGot({ ok: true, hosts: strs(obj(r.body.deployment).egress), unbuilt: r.notBuilt, message: "" });
      else setGot({ ok: false, hosts: [], unbuilt: [], message: r.message });
    });
    return () => {
      live = false;
    };
  }, []);
  if (!got) return { state: "loading", hosts: [], unbuilt: [], message: "" };
  return { state: got.ok ? "ok" : "error", hosts: got.hosts, unbuilt: got.unbuilt, message: got.message };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The run's tool calls as its journal holds them, in one sentence: how many, and how they ended. */
function toolCallLine(entries: LimitEntry[]): string {
  const outcomes = callOutcomes(entries);
  const before = entries.filter((e) => (e.kind === "denied" || e.kind === "contract.breach") && e.data?.tool && !(e.because ?? []).some((id) => outcomes.has(id))).length;
  const held = entries.filter((e) => e.kind === "gate.open" && e.data?.tool && !(e.because ?? []).some((id) => outcomes.has(id))).length;
  const n = outcomes.size;
  const count = (st: string) => [...outcomes.values()].filter((o) => o.state === st).length;
  const parts = [
    count("returned") && `${count("returned")} returned`,
    count("refused") && `${count("refused")} refused after being recorded`,
    count("failed") && `${count("failed")} failed`,
    count("unknown") && `${count("unknown")} with an unknown outcome`,
    count("held") && `${count("held")} waiting for a person`,
    count("open") && `${count("open")} with no outcome on record`,
  ].filter(Boolean);
  const made = n ? `${plural(n, "tool call")}${parts.length ? `: ${parts.join(", ")}` : ""}.` : "No tool call in the journal.";
  const extra = [before && `${plural(before, "call")} refused before ${before === 1 ? "it was" : "they were"} made`, held && `${plural(held, "call")} held for a person before ${held === 1 ? "it was" : "they were"} made`].filter(Boolean);
  return extra.length ? `${made} ${extra.join("; ")}.` : made;
}

/** The statement itself. Presentational, but for the egress read. */
export function RunBoundaryPanel({
  spec,
  facts,
  entries,
  source,
  onShowRefusals,
  open: asked = null,
  onToggle,
}: {
  spec: RunSpec;
  facts: RunFacts;
  entries: LimitEntry[];
  /** Where the run came from: "" or `console` for the platform's own, `worker`, `sdk`, `a2a`, `gateway`. */
  source: string;
  /** Show the refused calls in the activity list. */
  onShowRefusals: () => void;
  /** Whether the strip is open, when the page decides; null leaves it to the strip. */
  open?: boolean | null;
  onToggle?: (open: boolean) => void;
}) {
  const [chosen, setChosen] = useState(false);
  const open = asked ?? chosen;
  const deployment = useDeployment();
  // Whether the platform has built the tool server registry: a fact of the deployment, never assumed.
  const serversBuilt = useDoorBuilt("GET", "/api/mcp");
  const toolsUnbuilt = deployment.state === "ok" && notBuilt(deployment.unbuilt, "tools");
  const egressUnbuilt = deployment.state === "ok" && notBuilt(deployment.unbuilt, "egress");
  const isolationRefusals = entries.filter((e) => e.kind === "denied" && e.data?.control === "isolation");
  const grants = stepGrants(spec.body, entries);
  const granted = new Set(grants.flatMap((g) => g.tools.map((t) => t.name)));
  const holding = grants.filter((g) => g.tools.length > 0);
  const refusals = entries.filter((e) => e.kind === "denied" || e.kind === "contract.breach").length;
  const isolated = isolationOf(entries);
  const isolators = [...new Set(isolated.map((r) => r.isolator))];
  const models = [...new Set(entries.filter((e) => e.kind === "model.call").map((e) => str(e.data?.model) || str(e.title)).filter(Boolean))];
  const from = specLine(spec);

  const body = spec.body;
  const stepCeilings = grants.filter((g) => g.maxDataClass);
  const sinkCeilings = [...new Map(grants.flatMap((g) => g.tools).filter((t) => t.maxDataClass).map((t) => [t.name, t])).values()];
  const outputCeilings = arr(body?.outputs).map(obj).filter((o) => str(o.max_data_class));
  const anyCeiling = stepCeilings.length + sinkCeilings.length + outputCeilings.length > 0;

  return (
    <RunStrip
      title="Trust boundary"
      open={open}
      onToggle={() => {
        setChosen(!open);
        onToggle?.(!open);
      }}
      summary={
        spec.loading
          ? "reading the spec…"
          : `${!spec.body && grants.length === 0 ? "grants not known: no spec" : `${granted.size} tool${granted.size === 1 ? "" : "s"} granted to ${holding.length} step${holding.length === 1 ? "" : "s"}${grants.length && grants[0].from === "journal" ? " (as journalled)" : ""}`} · ${isolated.length ? `sandbox: ${isolators.join(", ")}` : "no sandboxed execution"} · ${refusals} refused`
      }
    >
      <div className="max-h-[320px] overflow-y-auto border-t border-line">
        <p className="border-b border-line px-4 py-1.5 text-[11px] leading-[1.5] text-faint">
          {toolCallLine(entries)}
          {toolsUnbuilt && " Tool registry: not built."}
          {serversBuilt === false && " Tool servers: not built."}
        </p>
        <div className="grid gap-px bg-line lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)_minmax(0,300px)]">
          <dl className="flex min-w-0 flex-col divide-y divide-line/70 bg-surface">
            <Fact k="Executed in">
              {SOURCE[source] ?? source}
              {source && <span className="block font-mono text-[10px] text-ghost">source: {source}</span>}
            </Fact>
            <Fact k="Model provider">
              {facts.provider ? <span className="font-mono text-[11px] text-fg">{facts.provider}</span> : <span className="text-faint">Not recorded on this run</span>}
              {(facts.model || models.length > 0) && (
                <span className="block text-[10.5px] text-faint">
                  {facts.model ? "run model" : "models called"}: <span className="font-mono text-dim">{facts.model || models.join(", ")}</span>
                </span>
              )}
            </Fact>
            <Fact k="Isolation">
              {isolated.length ? (
                <>
                  {isolated.length} isolated execution{isolated.length === 1 ? "" : "s"} of <span className="font-mono text-[11px]">{SANDBOX_TOOL}</span>, under <span className="font-mono text-[11px] text-fg">{isolators.join(", ")}</span>
                  <span className="mt-0.5 flex flex-col text-[10px] text-faint">
                    {isolated.map((r, i) => (
                      <span key={i} className="font-mono" title={r.manifest_digest || undefined}>
                        {r.isolator} · {r.exit === null ? "no exit" : `exit ${r.exit}`} · manifest {shortDigest(r.manifest_digest) || "not recorded"}
                      </span>
                    ))}
                  </span>
                </>
              ) : isolationRefusals.length ? (
                <span className="flex flex-col gap-0.5">
                  <span className="text-err">
                    {plural(isolationRefusals.length, "job")} refused: {controlLabel("isolation")}.
                  </span>
                  {isolationRefusals.map((e, i) => (e.detail ? <span key={i} className="text-[10.5px] text-faint">{e.detail}</span> : null))}
                </span>
              ) : (
                <span className="text-faint">The journal records no isolated execution.</span>
              )}
            </Fact>
          </dl>

          <section className="min-w-0 bg-surface" aria-label="Tools granted">
            <h3 className="border-b border-line px-4 py-1.5 text-[11px] font-semibold text-dim">Tools each step was granted</h3>
            {from.text && <p className={`border-b border-line/70 px-4 py-1.5 text-[10.5px] leading-[1.5] ${from.tone === "warn" ? "text-warn" : "text-faint"}`}>{from.text}</p>}
            {grants.length === 0 && <p className="px-4 py-2 text-[11.5px] text-faint">{spec.loading ? "Reading the spec…" : "Not known: no spec."}</p>}
            <ul className="flex flex-col">
              {grants.map((g) => {
                const scoped = g.tools.filter((t) => Object.keys(t.scope).length > 0).length;
                return (
                  <li key={g.node} className="border-b border-line/70 last:border-b-0">
                    {g.tools.length === 0 ? (
                      <div className="flex flex-wrap items-baseline gap-x-2 px-4 py-1.5">
                        <span className="text-[11.5px] font-medium text-fg">{g.label}</span>
                        <span className="text-[11px] text-faint">no tools granted</span>
                      </div>
                    ) : (
                      <details>
                        <summary className="focusable flex cursor-pointer flex-wrap items-baseline gap-x-2 px-4 py-1.5 hover:bg-raise/40">
                          <span className="text-[11.5px] font-medium text-fg">{g.label}</span>
                          <span className="tnum text-[11px] text-dim">
                            {g.tools.length} tool{g.tools.length === 1 ? "" : "s"}
                            {g.from === "spec" ? ` · ${scoped ? `${scoped} scoped` : "none scoped"}` : " · as journalled on entry"}
                            {g.tools.some((t) => t.sink) ? ` · ${g.tools.filter((t) => t.sink).length} act outward` : ""}
                          </span>
                          {g.maxDataClass && <Tag>reads up to {g.maxDataClass}</Tag>}
                        </summary>
                        <ul className="flex flex-col gap-1 px-4 pt-0.5 pb-2">
                          {g.tools.map((t) => (
                            <li key={t.name} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="font-mono text-[11px] text-fg">{t.name}</span>
                              {t.risk && <Tag tone={RISK_TONE(t.risk)}>{t.risk}</Tag>}
                              {t.sink && <Tag tone="warn">acts outward</Tag>}
                              {t.taints && <Tag>returns untrusted content</Tag>}
                              {t.maxDataClass && <Tag>carries up to {t.maxDataClass}</Tag>}
                              {Object.entries(t.scope).map(([arg, values]) => (
                                <span key={arg} className="font-mono text-[10.5px] text-dim">
                                  {arg}: {values.length ? values.join(", ") : "nothing permitted"}
                                </span>
                              ))}
                              {g.from === "spec" && Object.keys(t.scope).length === 0 && <span className="text-[10.5px] text-faint">no scope limit</span>}
                              {t.narrowed && <span className="text-[10.5px] text-faint">narrowed for this step</span>}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <dl className="flex min-w-0 flex-col divide-y divide-line/70 bg-surface">
            <Fact k="Data class ceiling">
              {facts.dataClass && (
                <span className="block">
                  This run&rsquo;s data was classed <span className="font-medium text-fg">{facts.dataClass}</span>.
                </span>
              )}
              {anyCeiling ? (
                <span className="flex flex-col">
                  {stepCeilings.map((g) => (
                    <span key={g.node}>
                      {g.label} may read up to <span className="font-medium text-fg">{g.maxDataClass}</span>
                    </span>
                  ))}
                  {sinkCeilings.map((t) => (
                    <span key={t.name}>
                      <span className="font-mono text-[11px]">{t.name}</span> may carry out up to <span className="font-medium text-fg">{t.maxDataClass}</span>
                    </span>
                  ))}
                  {outputCeilings.map((o, i) => (
                    <span key={i}>
                      The {str(o.kind) || "declared"} output may carry up to <span className="font-medium text-fg">{str(o.max_data_class)}</span>
                    </span>
                  ))}
                </span>
              ) : (
                <span className="text-faint">{body ? "None set." : "Not known: no spec."}</span>
              )}
            </Fact>
            <Fact k="Egress allowlist">
              {deployment.state === "ok" ? (
                egressUnbuilt ? (
                  <span className="text-faint">Not built</span>
                ) : deployment.hosts.length ? (
                  <>
                    <span className="flex flex-wrap gap-1">
                      {deployment.hosts.map((h) => (
                        <span key={h} className="rounded-sm border border-line bg-raise px-1.5 py-0.5 font-mono text-[10.5px] text-fg">
                          {h}
                        </span>
                      ))}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-faint">The deployment&rsquo;s list now, not the run&rsquo;s.</span>
                  </>
                ) : (
                  <span className="text-faint">No host listed now.</span>
                )
              ) : deployment.state === "error" ? (
                <Failure inline what="Could not be read" message={deployment.message} />
              ) : (
                <span className="text-faint">Reading the deployment&rsquo;s configuration…</span>
              )}
            </Fact>
            <Fact k="Refusals">
              {refusals ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span>
                    <span className="tnum font-semibold text-err">{refusals}</span> call{refusals === 1 ? " was" : "s were"} refused in this run.
                  </span>
                  <Button size="sm" variant="solid" tone="neutral" onClick={onShowRefusals}>
                    Show {refusals === 1 ? "it" : "them"}
                  </Button>
                </span>
              ) : (
                <span className="text-faint">No call was refused in this run.</span>
              )}
            </Fact>
          </dl>
        </div>
      </div>
    </RunStrip>
  );
}
