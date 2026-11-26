"use client";
import { Failure } from "./pending";
import { ask } from "@/lib/api/pending";
import { notBuiltText } from "@/lib/api/client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Mono, Status, Tag, type Tone } from "./ui";
import { ControlMark, ControlRef, resolveControl } from "./control-ref";
import { Skeleton } from "./loaders";
import { hueFor } from "@/lib/hue";
import { soon } from "@/lib/soon";
import { agentHref } from "@/lib/agent-link";
import { agentDocument } from "@/lib/api/l2";
import { getFleet, type FleetState } from "@/lib/api/l5";
import { getAutonomyTiers, listPolicyTargets, type AutonomyTiers, type TargetKind, type TargetKinds } from "@/lib/api/l9";
import { requirementLabel, requirementState, tierLine } from "@/lib/autonomy";
import { targetLabel } from "@/lib/policy";
import { enforcementOf, useControls, type ControlsRead } from "@/lib/controls-status";

/**
 * What governs one agent, in one panel.
 *
 * From its spec: the gates and who signs them, the tools each step is
 * granted, and its limits. From the estate: the rules that apply to it now
 * (the policy targets the Policy page lists under "The rules now"), a pause
 * or a lockdown, and its autonomy tier with what the tier requires. And the
 * register controls those declarations bring into force, each with whether
 * this deployment enforces it now (`GET /api/controls`) and how often it has
 * fired on this agent (counted by `GET /api/guardrails`, as the Controls page
 * reads it). Nothing here says a control is or is not applied unless one of
 * those answers says so. Every block links to the page where the rule is kept.
 * Each door is read on its own, so one that fails says so in its own block
 * and the rest still read.
 */

type Load<T> = { state: "reading" } | { state: "ok"; data: T } | { state: "error"; message: string };
const READING = { state: "reading" } as const;

function useLoad<T>(read: () => Promise<T>, key: string): Load<T> {
  const [got, setGot] = useState<{ key: string; load: Load<T> }>({ key, load: READING });
  useEffect(() => {
    let live = true;
    const cancel = soon(() => {
      read()
        .then((data) => live && setGot({ key, load: { state: "ok", data } }))
        .catch((e) => live && setGot({ key, load: { state: "error", message: (e as Error).message || "the door did not answer" } }));
    });
    return () => {
      live = false;
      cancel();
    };
    // `read` is a new function each render; `key` says when it reads something else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return got.key === key ? got.load : READING;
}

/* ═══════════════════ the spec, read defensively ═══════════════════ */

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const strs = (v: unknown): string[] => arr(v).map(str).filter(Boolean);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

interface SpecTool {
  name: string;
  risk: string;
  sink: boolean;
  taints: boolean;
  scoped: boolean;
  dataClass: string;
  maxDataClass: string;
}

interface Governed {
  name: string;
  owner: string;
  autonomy: string;
  /** Policy gates: calls at or above a risk wait for these roles. */
  gates: { risk: string; approvers: string[]; nodes: string[]; timeoutS: number | null; onTimeout: string }[];
  /** Steps that stop and wait: for a person, or for something outside. */
  waits: { node: string; label: string; kind: string; target: string; timeoutS: number | null; onTimeout: string }[];
  grants: { node: string; label: string; tools: string[]; scoped: boolean }[];
  tools: Map<string, SpecTool>;
  loops: { node: string; label: string; maxSteps: number }[];
  fanouts: { node: string; label: string; maxParallel: number | null; over: string }[];
  typed: number;
  injection: { patterns: number; prohibited: number; action: string } | null;
  blockTaintedSinks: boolean;
  /** `budget`, `limits`, `mass_action`, `redaction` and whatever else the policy holds that has no line of its own. */
  extra: [string, unknown][];
}

const KNOWN_POLICY = new Set(["grants", "gates", "injection", "block_tainted_sinks"]);

export function governedOf(doc: unknown): Governed {
  const d = obj(doc);
  const meta = obj(d.metadata);
  const spec = obj(d.spec);
  const policy = obj(spec.policy);
  const nodes = arr(spec.nodes).map(obj);
  const labelOf = (id: string) => str(nodes.find((n) => str(n.id) === id)?.label) || id;
  const tools = new Map<string, SpecTool>();
  for (const raw of arr(spec.tools)) {
    const t = obj(raw);
    const name = str(t.name);
    if (!name) continue;
    tools.set(name, { name, risk: str(t.risk) || "read", sink: t.is_sink === true, taints: t.taints === true, scoped: Object.keys(obj(t.scope)).length > 0, dataClass: str(t.data_class), maxDataClass: str(t.max_data_class) });
  }
  const inj = policy.injection && typeof policy.injection === "object" ? obj(policy.injection) : null;
  return {
    name: str(meta.name) || str(meta.id),
    owner: str(meta.owner),
    autonomy: str(meta.autonomy),
    gates: arr(policy.gates).map((g) => {
      const o = obj(g);
      return { risk: str(o.at_or_above), approvers: strs(o.approvers), nodes: strs(o.nodes), timeoutS: numOrNull(o.timeout_s), onTimeout: str(o.on_timeout) };
    }),
    waits: nodes
      .filter((n) => str(n.harness) === "await")
      .map((n) => {
        const i = obj(n.interface);
        return { node: str(n.id), label: labelOf(str(n.id)), kind: str(i.kind) || "approval", target: str(i.target), timeoutS: numOrNull(i.timeout_s), onTimeout: str(i.on_timeout) };
      }),
    grants: arr(policy.grants)
      .map((g) => {
        const o = obj(g);
        return { node: str(o.node), label: labelOf(str(o.node)), tools: strs(o.tools), scoped: Object.keys(obj(o.scope)).length > 0 };
      })
      .filter((g) => g.tools.length > 0),
    tools,
    loops: nodes.filter((n) => numOrNull(n.max_steps) !== null).map((n) => ({ node: str(n.id), label: labelOf(str(n.id)), maxSteps: n.max_steps as number })),
    fanouts: nodes
      .filter((n) => n.fanout && typeof n.fanout === "object")
      .map((n) => ({ node: str(n.id), label: labelOf(str(n.id)), maxParallel: numOrNull(obj(n.fanout).max_parallel), over: str(obj(n.fanout).over) })),
    typed: nodes.filter((n) => arr(n.emits).length > 0).length,
    injection: inj ? { patterns: arr(inj.patterns).length, prohibited: arr(inj.prohibited_actions).length + arr(inj.prohibited).length, action: str(inj.action) || "block" } : null,
    blockTaintedSinks: policy.block_tainted_sinks === true,
    extra: Object.entries(policy).filter(([k, v]) => !KNOWN_POLICY.has(k) && v !== null && v !== undefined && !(typeof v === "object" && Object.keys(v as object).length === 0)),
  };
}

function span(seconds: number): string {
  if (seconds < 120) return `${seconds} seconds`;
  if (seconds < 7200) return `${Math.round(seconds / 60)} minutes`;
  if (seconds < 172800) return `${Math.round(seconds / 3600)} hours`;
  return `${Math.round(seconds / 86400)} days`;
}

/* A declared timeout is acted on when it passes (lib/gates.ts GATE_TIMEOUT_LINE). */
const timeoutLine = (s: number | null, then: string): string => (s === null ? "" : `${then === "escalate" ? "escalates" : "fails"} after ${span(s)} unanswered`);

const shown = (v: unknown): string => (v === null || v === undefined ? "unset" : typeof v === "string" ? v || "none" : Array.isArray(v) ? (v.length ? v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(", ") : "none") : typeof v === "object" ? (Object.keys(v as object).length ? JSON.stringify(v) : "none") : String(v));

const RISK_TONE: Record<string, Tone> = { read: "neutral", write: "queue", risky: "warn", destructive: "err" };

/** The register controls a spec's declarations bring into force, each with the declaration that does it. */
export function declaredControls(g: Governed): { control: string; why: string }[] {
  const out: { control: string; why: string }[] = [];
  const granted = new Set(g.grants.flatMap((x) => x.tools));
  const grantedTools = [...granted].map((n) => g.tools.get(n)).filter((t): t is SpecTool => Boolean(t));
  if (granted.size) out.push({ control: "AF-AC-01", why: `${granted.size} tool${granted.size === 1 ? "" : "s"} granted across ${g.grants.length} step${g.grants.length === 1 ? "" : "s"} in the spec` });
  const scoped = grantedTools.filter((t) => t.scoped).length + g.grants.filter((x) => x.scoped).length;
  if (scoped) out.push({ control: "AF-AC-02", why: `${scoped} grant${scoped === 1 ? " carries" : "s carry"} a scope on ${scoped === 1 ? "its" : "their"} arguments` });
  if (g.injection?.prohibited) out.push({ control: "AF-AC-03", why: `${g.injection.prohibited} prohibited action${g.injection.prohibited === 1 ? "" : "s"} declared` });
  const taints = grantedTools.filter((t) => t.taints).length;
  if (taints) out.push({ control: "AF-DP-01", why: `${taints} granted tool${taints === 1 ? " returns" : "s return"} content authored outside the system` });
  const sinks = grantedTools.filter((t) => t.sink).length;
  if (g.blockTaintedSinks) out.push({ control: "AF-DP-02", why: `the spec asks that untrusted content be stopped at the ${sinks} granted tool${sinks === 1 ? " that acts" : "s that act"} outside` });
  if (g.injection?.patterns) out.push({ control: "AF-DP-04", why: `the spec declares ${g.injection.patterns} block phrase${g.injection.patterns === 1 ? "" : "s"}` });
  if (grantedTools.some((t) => t.maxDataClass || t.dataClass)) out.push({ control: "AF-DP-06", why: "granted tools declare a data class or a ceiling" });
  const people = g.gates.length + g.waits.filter((w) => w.kind === "approval").length;
  if (people) out.push({ control: "AF-HO-01", why: `${people} gate${people === 1 ? " waits" : "s wait"} for a person` });
  if (g.typed) out.push({ control: "AF-IN-01", why: `${g.typed} step${g.typed === 1 ? " declares what it emits" : "s declare what they emit"}; an output that does not match is a breach` });
  for (const [k] of g.extra) {
    if (k === "budget") out.push({ control: "AF-RS-01", why: "the policy sets a budget" });
    if (k === "limits") out.push({ control: "AF-AC-05", why: "the policy declares argument limits" });
    if (k === "mass_action") out.push({ control: "AF-RS-04", why: "the policy declares a mass-action gate" });
  }
  return out.filter((x) => resolveControl(x.control));
}

/**
 * What the platform says about one control on this deployment, as a short
 * label: "enforced now", "not enforced", "unknown". Nothing while
 * `GET /api/controls` has not answered; the block's failure line says why.
 */
function enforcementClause(read: ControlsRead | null, id: string): string {
  if (!read || read.state !== "ok") return "";
  return enforcementOf(read, id)!.label;
}

/* ═══════════════════ pieces ═══════════════════ */

function Block({ title, where, meta, children }: { title: string; where?: { href: string; label: string }; meta?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 bg-surface px-4 py-3">
      <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span className="text-[12px] font-semibold text-fg">{title}</span>
        {meta && <span className="text-[10.5px] text-faint">{meta}</span>}
        <span className="grow" />
        {where && (
          <Link href={where.href} className="focusable rounded-sm text-[11px] font-medium text-fg underline decoration-line-strong underline-offset-2 hover:decoration-fg">
            {where.label}
          </Link>
        )}
      </span>
      {children}
    </div>
  );
}

const Line = ({ children }: { children: ReactNode }) => <li className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-line px-3 py-1.5 text-[11.5px] leading-[1.55] text-dim last:border-b-0">{children}</li>;
const List = ({ children }: { children: ReactNode }) => <ul className="flex flex-col overflow-hidden rounded-md border border-line">{children}</ul>;
const None = ({ children }: { children: ReactNode }) => <p className="text-[11.5px] leading-[1.55] text-faint">{children}</p>;
// A block whose read failed: the not-built note for a 501, otherwise the failure with its status and address.
const Failed = ({ what, message }: { what: string; message: string }) => (
  <p>
    <Failure inline what={what} message={message} />
  </p>
);

function ToolChip({ tool, name = "" }: { tool: SpecTool | undefined; name?: string }) {
  // A grant of a tool the spec does not declare: the platform refuses every call to it (the call is not registered in the definition).
  if (!tool) {
    return (
      <span title={`${name}: granted, but not declared in the spec's tools, so every call to it is refused`} className="inline-flex max-w-full items-center gap-1 rounded-sm border border-err-line bg-err-bg px-1.5 py-px">
        <span className="truncate font-mono text-[10px] text-err">{name}</span>
        <span className="text-[10px] text-err">undeclared: every call refused</span>
      </span>
    );
  }
  const marks = [tool.risk !== "read" ? tool.risk : "", tool.sink ? "acts outside" : "", tool.taints ? "returns untrusted content" : "", tool.scoped ? "scoped" : ""].filter(Boolean);
  return (
    <span title={marks.length ? `${tool.name}: ${marks.join(", ")}` : tool.name} className="inline-flex max-w-full items-center gap-1 rounded-sm border border-line bg-raise px-1.5 py-px">
      {tool.risk !== "read" && <span className={`size-1.5 shrink-0 rounded-[2px] ${tool.risk === "destructive" ? "bg-err" : tool.risk === "risky" ? "bg-warn" : "bg-queue"}`} />}
      <span className="truncate font-mono text-[10px] text-dim">{tool.name}</span>
    </span>
  );
}

const empty = (v: unknown): boolean => v === null || v === "" || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length === 0);

/** One estate target as it bears on an agent: the estate's rules, and the agent's own where it holds any. Fields nobody set are left out. */
function TargetLines({ target, agent, tier }: { target: TargetKind; agent: string; tier: string }) {
  const own = target.by_id[agent];
  const estate = target.current;
  if (!estate && !own) return null;
  // The guardian switched off enforces nothing else it lists; of the tiers, only this agent's bears on it.
  const off = target.kind === "guardian" && estate?.enabled === false;
  const bears = (k: string) => (off ? k === "enabled" : target.kind === "autonomy_tiers" && tier ? k === tier || k === "attestation_within_days" : true);
  const rows = (rules: Record<string, unknown>) => Object.entries(rules).filter(([k, v]) => target.fields.includes(k) && bears(k) && !empty(v));
  return (
    <Line>
      <span className="w-full text-[11.5px] font-medium text-fg sm:w-[150px] sm:shrink-0">{targetLabel(target.kind)}</span>
      <span className="flex min-w-0 grow basis-[240px] flex-col gap-0.5">
        {own && (
          <span>
            <Tag tone="queue">this agent&rsquo;s own</Tag>{" "}
            {rows(own).length ? rows(own).map(([k, v]) => `${target.labels[k] ?? k} ${shown(v)}`).join("; ") : "nothing of its own; the estate's rules hold"}
          </span>
        )}
        {estate &&
          (rows(estate).length ? (
            <span className="flex flex-wrap gap-x-3 gap-y-0.5">
              {rows(estate).map(([k, v]) => (
                <span key={k} className="min-w-0">
                  <span className="text-faint">{target.labels[k] ?? k}</span> <span className="font-mono text-[10.5px] break-words text-fg">{shown(v)}</span>
                </span>
              ))}
            </span>
          ) : (
            <span className="text-faint">{target.kind === "autonomy_tiers" && tier ? `${tier} requires no controls` : "nothing set"}</span>
          ))}
        {target.kind === "autonomy_tiers" && tier && estate && empty(estate[tier]) && rows(estate).length > 0 && <span className="text-faint">{tier} requires no controls.</span>}
        {off && <span className="text-faint">The guardian is off.</span>}
        {!off && target.kind === "guardian" && estate && Array.isArray(estate.agents) && estate.agents.length > 0 && !estate.agents.map(String).includes(agent) && <span className="text-faint">Not on the guardian&rsquo;s list.</span>}
      </span>
    </Line>
  );
}

interface Counted {
  byAgent?: Record<string, Record<string, number>>;
  error?: string;
}

/* ═══════════════════ the panel ═══════════════════ */

export function ControlsInForce({ agent }: { agent: string }) {
  const spec = useLoad(() => agentDocument(agent).then(governedOf), `spec:${agent}`);
  const tiers = useLoad<AutonomyTiers>(() => getAutonomyTiers(agent), `tier:${agent}`);
  const targets = useLoad<TargetKinds>(() => listPolicyTargets(), "targets");
  const fleet = useLoad<FleetState>(() => getFleet(), "fleet");
  const fired = useLoad<Counted>(
    () =>
      ask<Counted>("guardrails").then((a) => {
        if (a.state === "ok") return a.data;
        throw new Error(a.state === "pending" ? notBuiltText(a.door.method, a.door.path) : a.message);
      }),
    "fired",
  );
  /** Whether this deployment enforces each control now (GET /api/controls), shared with the Controls pages. */
  const status = useControls();

  const g = spec.state === "ok" ? spec.data : null;
  const tier = tiers.state === "ok" ? tiers.data.agent : null;
  const pause = fleet.state === "ok" ? fleet.data.paused[agent] : undefined;
  const lockdown = fleet.state === "ok" ? fleet.data.lockdown : null;

  /* Firings on this agent, per register control; a key the register does not hold stays as itself. */
  const firings = new Map<string, number>();
  if (fired.state === "ok") for (const [key, n] of Object.entries(fired.data.byAgent?.[agent] ?? {})) firings.set(resolveControl(key)?.id ?? key, (firings.get(resolveControl(key)?.id ?? key) ?? 0) + n);
  const declared = g ? declaredControls(g) : [];
  const undeclared = [...firings.keys()].filter((k) => !declared.some((d) => d.control === k));
  const applicable = targets.state === "ok" ? targets.data.targets.filter((t) => t.current || t.by_id[agent]) : [];
  const granted = g ? new Set(g.grants.flatMap((x) => x.tools)) : new Set<string>();
  const beyondRead = g ? [...granted].filter((n) => (g.tools.get(n)?.risk ?? "read") !== "read").length : 0;
  const evidence = (control: string) => `/evidence?control=${encodeURIComponent(control)}&agent=${encodeURIComponent(agent)}`;


  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1" aria-label={`Controls in force on ${agent}`}>
      <div data-hue={hueFor("control")} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-raise/55 px-4 py-2.5">
        <span className="text-[12.5px] font-semibold tracking-[-0.005em] text-fg">Controls in force</span>
        <span className="text-[11px] text-faint">what governs {g?.name || agent}</span>
        <span className="grow" />
        <span className="flex flex-wrap items-center gap-2">
          {tier && <Tag>{tier.tier}</Tag>}
          {pause && <Tag tone="warn">{pause.mode === "drain" ? "draining" : "paused"}</Tag>}
          {lockdown?.on && <Tag tone="err">estate locked down</Tag>}
          {agent && <Mono className="text-[10.5px] text-faint">{agent}</Mono>}
        </span>
      </div>

      <div className="lg:grid lg:grid-cols-2">
        <div className="flex min-w-0 flex-col divide-y divide-line border-line lg:border-r">
        {/* ── gates ── */}
        <Block title="Gates and who signs them" meta={g ? `${g.gates.length + g.waits.length} declared` : undefined} where={{ href: agentHref(agent), label: "Kept in the agent's spec" }}>
          {spec.state === "reading" && <Skeleton lines={2} />}
          {spec.state === "error" && <Failed what="The agent's spec could not be read" message={spec.message} />}
          {g && g.gates.length + g.waits.length === 0 && <None>No gate is declared; the platform&rsquo;s own holds still apply.</None>}
          {g && g.gates.length + g.waits.length > 0 && (
            <List>
              {g.gates.map((x, i) => (
                <Line key={`g${i}`}>
                  <Status tone="warn">Policy gate</Status>
                  <span className="min-w-0 grow basis-[240px]">
                    A call at or above <Tag tone={RISK_TONE[x.risk] ?? "neutral"}>{x.risk || "unset"}</Tag> risk{x.nodes.length ? ` in ${x.nodes.join(", ")}` : ""} waits for <span className="font-medium text-fg">{x.approvers.length ? x.approvers.join(", ") : "anyone with the approve permission"}</span>
                    {timeoutLine(x.timeoutS, x.onTimeout) ? `; ${timeoutLine(x.timeoutS, x.onTimeout)}` : ""}.
                  </span>
                </Line>
              ))}
              {g.waits.map((w) => (
                <Line key={w.node}>
                  <Status tone={w.kind === "approval" ? "warn" : "queue"}>{w.kind === "approval" ? "Approval step" : `Waits on a ${w.kind}`}</Status>
                  <span className="min-w-0 grow basis-[240px]">
                    <Mono className="text-[10.5px] text-fg">{w.node}</Mono> stops and waits for <span className="font-medium text-fg">{w.target || (w.kind === "approval" ? "anyone with the approve permission" : `its ${w.kind}`)}</span>
                    {timeoutLine(w.timeoutS, w.onTimeout) ? `; ${timeoutLine(w.timeoutS, w.onTimeout)}` : ""}.
                  </span>
                </Line>
              ))}
            </List>
          )}
        </Block>

        {/* ── tools ── */}
        <Block title="Tools it is granted" meta={g ? `${granted.size} tool${granted.size === 1 ? "" : "s"} across ${g.grants.length} step${g.grants.length === 1 ? "" : "s"} · ${beyondRead} beyond read` : undefined} where={{ href: `/bom?agent=${encodeURIComponent(agent)}`, label: "Each tool on the AI-BOM" }}>
          {spec.state === "reading" && <Skeleton lines={3} />}
          {spec.state === "error" && <Failed what="The agent's spec could not be read" message={spec.message} />}
          {g && g.grants.length === 0 && <None>No tool is granted.</None>}
          {g && g.grants.length > 0 && (
            <>
              <List>
                {g.grants.map((x) => (
                  <Line key={x.node}>
                    <span className="w-full sm:w-[120px] sm:shrink-0">
                      <Mono className="text-[10.5px] text-fg">{x.node}</Mono>
                      <span className="ml-1.5 text-[10px] text-ghost">{x.tools.length}</span>
                    </span>
                    <span className="flex min-w-0 grow basis-[240px] flex-wrap gap-1">
                      {x.tools.map((name) => (
                        <ToolChip key={name} name={name} tool={g.tools.get(name)} />
                      ))}
                    </span>
                  </Line>
                ))}
              </List>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-ghost">
                <span>Declared risk:</span>
                <span className="flex items-center gap-1"><span className="size-1.5 rounded-[2px] bg-queue" /> write</span>
                <span className="flex items-center gap-1"><span className="size-1.5 rounded-[2px] bg-warn" /> risky</span>
                <span className="flex items-center gap-1"><span className="size-1.5 rounded-[2px] bg-err" /> destructive</span>
                <span>unmarked is read.</span>
              </p>
            </>
          )}
        </Block>

        </div>
        <div className="flex min-w-0 flex-col divide-y divide-line border-t border-line lg:border-t-0">
        {/* ── autonomy ── */}
        <Block title="Autonomy tier" meta={tier ? `${tier.tier} ${tier.name}` : undefined} where={{ href: "/policy", label: "Tier rules on Policy" }}>
          {tiers.state === "reading" && <Skeleton lines={2} />}
          {tiers.state === "error" && <Failed what="The autonomy tiers could not be read" message={tiers.message} />}
          {tiers.state === "ok" && !tier && <None>No tier is named for this agent.</None>}
          {tiers.state === "ok" && tier && (
            <>
              <span className="flex flex-wrap items-center gap-2">
                <Status tone={tier.problem ? "warn" : tier.met ? "ok" : "err"}>{tier.problem ? "cannot be judged" : tier.met ? "meets its tier" : `${tier.missing.length} missing`}</Status>
                <span className="text-[11.5px] leading-[1.55] text-dim">{tierLine(tier, tiers.data.requirements)}</span>
              </span>
              {tier.requires.length > 0 && (
                <List>
                  {tier.requires.map((r) => {
                    const s = requirementState(r);
                    return (
                      <Line key={r.requirement}>
                        <Status tone={s.tone}>{s.label}</Status>
                        <span className="font-medium text-fg">{requirementLabel(r.requirement, tiers.data.requirements)}</span>
                        <span className="min-w-0 basis-full text-[11px] text-faint">
                          {r.detail}
                        </span>
                      </Line>
                    );
                  })}
                </List>
              )}
              <p className="text-[10.5px] leading-[1.5] text-ghost">
                {g?.autonomy ? `Declared in the spec: metadata.autonomy ${g.autonomy}.` : "None declared in the spec; reads as L0."}{" "}
                <Link href={agentHref(agent)} className="focusable rounded-sm text-dim underline">
                  Open the agent
                </Link>
              </p>
            </>
          )}
        </Block>

        {/* ── limits ── */}
        <Block title="Its limits" where={{ href: agentHref(agent), label: "Kept in the agent's spec" }}>
          {spec.state === "reading" && <Skeleton lines={3} />}
          {spec.state === "error" && <Failed what="The agent's spec could not be read" message={spec.message} />}
          {g && (
            <>
              {g.loops.length + g.fanouts.length + g.extra.length === 0 && !g.injection && !g.blockTaintedSinks ? (
                <None>The spec declares no limits.</None>
              ) : (
                <List>
                  {g.loops.length > 0 && (
                    <Line>
                      <span className="w-full font-medium text-fg sm:w-[150px] sm:shrink-0">Model steps</span>
                      <span className="min-w-0 grow basis-[240px]">
                        {g.loops.map((l, i) => (
                          <span key={l.node}>
                            {i > 0 && "; "}
                            <Mono className="text-[10.5px] text-fg">{l.node}</Mono> at most {l.maxSteps}
                          </span>
                        ))}
                      </span>
                    </Line>
                  )}
                  {g.fanouts.map((f) => (
                    <Line key={f.node}>
                      <span className="w-full font-medium text-fg sm:w-[150px] sm:shrink-0">Fan-out</span>
                      <span className="min-w-0 grow basis-[240px]">
                        <Mono className="text-[10.5px] text-fg">{f.node}</Mono> runs once per item{f.over ? ` of ${f.over}` : ""}, {f.maxParallel === null ? "with no cap on how many at once" : `at most ${f.maxParallel} at once`}
                      </span>
                    </Line>
                  ))}
                  <Line>
                    <span className="w-full font-medium text-fg sm:w-[150px] sm:shrink-0">Sink protection</span>
                    <span className="min-w-0 grow basis-[240px]">{g.blockTaintedSinks ? `Declared in the spec${enforcementClause(status, "AF-DP-02") ? ` · ${enforcementClause(status, "AF-DP-02")}` : ""}` : "Not declared in the spec."}</span>
                  </Line>
                  <Line>
                    <span className="w-full font-medium text-fg sm:w-[150px] sm:shrink-0">Screening</span>
                    <span className="min-w-0 grow basis-[240px]">
                      {`${g.injection ? `${g.injection.patterns} block phrase${g.injection.patterns === 1 ? "" : "s"}, ${g.injection.prohibited} prohibited action${g.injection.prohibited === 1 ? "" : "s"}` : "None declared"}${enforcementClause(status, "AF-DP-04") ? ` · screening ${enforcementClause(status, "AF-DP-04")}` : ""}`}
                    </span>
                  </Line>
                  {g.extra.map(([k, v]) => (
                    <Line key={k}>
                      <span className="w-full font-medium text-fg sm:w-[150px] sm:shrink-0">{k.replace(/_/g, " ")}</span>
                      <span className="min-w-0 grow basis-[240px] font-mono text-[10.5px] break-all text-fg">{shown(v)}</span>
                    </Line>
                  ))}
                </List>
              )}
            </>
          )}
        </Block>

        {/* ── estate rules ── */}
        <Block title="Estate rules that apply now" meta={targets.state === "ok" ? `${applicable.length} of ${targets.data.targets.length} policy targets` : undefined} where={{ href: "/policy", label: "The rules now, on Policy" }}>
          {fleet.state === "error" && <Failed what="Pause and lockdown could not be read" message={fleet.message} />}
          {(pause || lockdown?.on) && (
            <List>
              {pause && (
                <Line>
                  <Status tone="warn">{pause.mode === "drain" ? "Draining" : "Paused"}</Status>
                  <span className="min-w-0 grow basis-[240px]">
                    {pause.mode === "drain" ? "No new run starts; runs in flight finish." : "No new run starts and runs in flight were killed."} {pause.by ? `By ${pause.by}` : ""}
                    {pause.reason ? `: ${pause.reason}` : ""}{" "}
                    <Link href="/control" className="focusable rounded-sm text-fg underline">
                      Control
                    </Link>
                  </span>
                </Line>
              )}
              {lockdown?.on && (
                <Line>
                  <Status tone="err">Estate locked down</Status>
                  <span className="min-w-0 grow basis-[240px]">
                    Nothing starts until the lockdown is lifted. {lockdown.by ? `By ${lockdown.by}` : ""}
                    {lockdown.reason ? `: ${lockdown.reason}` : ""}{" "}
                    <Link href="/control" className="focusable rounded-sm text-fg underline">
                      Control
                    </Link>
                  </span>
                </Line>
              )}
            </List>
          )}
          {targets.state === "reading" && <Skeleton lines={3} />}
          {targets.state === "error" && <Failed what="The estate's rules could not be read" message={targets.message} />}
          {targets.state === "ok" && applicable.length === 0 && <None>No estate rule applies to this agent.</None>}
          {applicable.length > 0 && (
            <List>
              {applicable.map((t) => (
                <TargetLines key={t.kind} target={t} agent={agent} tier={tier?.tier ?? ""} />
              ))}
            </List>
          )}
        </Block>

        {/* ── controls ── */}
        <Block title="Controls it maps to" meta={g ? `${declared.length} from its spec${fired.state === "ok" ? ` · ${[...firings.values()].reduce((a, b) => a + b, 0)} firings on record` : ""}` : undefined} where={{ href: "/guardrails", label: "The register, on Controls" }}>
          {spec.state === "reading" && <Skeleton lines={3} />}
          {fired.state === "error" && <Failed what="Firings could not be read" message={fired.message} />}
          {g && declared.length === 0 && undeclared.length === 0 && <None>No register control is declared.</None>}
          {(declared.length > 0 || undeclared.length > 0) && (
            <List>
              {declared.map((d) => {
                const n = firings.get(d.control) ?? 0;
                return (
                  <Line key={d.control}>
                    <span className="w-full sm:w-[230px] sm:shrink-0">
                      <ControlRef control={d.control} />
                    </span>
                    <span className="min-w-0 grow basis-[200px]" title={d.why}>
                      {(() => {
                        const e = enforcementOf(status, d.control);
                        return e ? (
                          <span className="ml-1.5 inline-flex align-middle">
                            <Tag tone={e.tone}>{e.label}</Tag>
                          </span>
                        ) : null;
                      })()}
                    </span>
                    {fired.state === "ok" &&
                      (n > 0 ? (
                        <Link href={evidence(d.control)} className="focusable tnum rounded-sm text-[11px] font-medium whitespace-nowrap text-fg underline">
                          fired {n.toLocaleString("en-GB")}
                        </Link>
                      ) : (
                        <span className="text-[11px] whitespace-nowrap text-ghost">never fired</span>
                      ))}
                  </Line>
                );
              })}
              {undeclared.map((k) => (
                <Line key={k}>
                  <span className="w-full sm:w-[230px] sm:shrink-0">
                    <ControlMark control={k} />
                  </span>
                  <span className="min-w-0 grow basis-[200px]">
                    Not declared in the current spec.
                    {(() => {
                      const e = resolveControl(k) ? enforcementOf(status, resolveControl(k)!.id) : null;
                      return e ? (
                        <span className="ml-1.5 inline-flex align-middle">
                          <Tag tone={e.tone}>{e.label}</Tag>
                        </span>
                      ) : null;
                    })()}
                  </span>
                  <Link href={resolveControl(k) ? evidence(k) : `/evidence?agent=${encodeURIComponent(agent)}`} className="focusable tnum rounded-sm text-[11px] font-medium whitespace-nowrap text-fg underline">
                    fired {(firings.get(k) ?? 0).toLocaleString("en-GB")}
                  </Link>
                </Line>
              ))}
            </List>
          )}
          {status && status.state !== "ok" && (
            <p>
              <Failure inline what="Enforcement could not be read" message={status.state === "pending" ? notBuiltText(status.door.method, status.door.path) : status.message} />
            </p>
          )}
        </Block>
        </div>
      </div>
    </section>
  );
}
