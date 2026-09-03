"use client";

import { useMemo, useState } from "react";
import { BY_NAME, TOOL_BY_ID, toolCardOf } from "@/lib/catalogue";
import { CONNECTOR_DEFS, listConnections } from "@/lib/connections";
import { MODEL_CLASSES, useModels } from "@/lib/use-models";
import type { McpServer } from "@/lib/use-mcp";
import { ConnectorMark, RiskPill, ToolMark, grantLookOf } from "./marks";
import {
  HARNESS,
  KINDS,
  grantsFor,
  taintReaching,
  type AgentSystem,
  type Field,
  type Kind,
  type Node,
  type Problem,
  type Step,
} from "@/lib/spec";
import type { Action } from "@/lib/builder-store";
import { Button, Status } from "../ui";
import { Banner } from "../overlays";
import { Area, Check, Cross, CsvText, Mini, Num, Pick, Plus, Row, Section, Text } from "./controls";
import { BoundaryPanel } from "./boundary-panel";

/**
 * The right rail: what the selected node is.
 *
 * Ordered by what breaks a deployment most often. The contract comes before the
 * prompt, because a mistyped edge fails at a client and a mediocre prompt only
 * underperforms. Tools come before either, because what a node can touch is the
 * only thing that stops an instruction hidden in a document from mattering.
 */
export function Inspector({
  system,
  dispatch,
  selected,
  problems,
  servers,
  onSelect,
}: {
  system: AgentSystem;
  dispatch: (a: Action) => void;
  selected: string | null;
  problems: Problem[];
  /** Connected MCP servers, so a custom tool's row carries its server's mark. */
  servers?: McpServer[] | null;
  /** Lets a listed connection be opened; the shell owns selection. */
  onSelect?: (id: string) => void;
}) {
  // Hooks before any return — a component whose hook count depends on what is
  // selected is the exact thing React's rules exist to prevent.
  const { models, classDefaults } = useModels();
  // Which node's delete is armed — keyed by id so switching selection mid-arm
  // can never delete the wrong node.
  const [armDelete, setArmDelete] = useState<string | null>(null);

  if (selected?.startsWith("edge:")) {
    return (
      <div className="flex h-full flex-col overflow-y-auto">
        <EdgeInspector system={system} dispatch={dispatch} index={Number(selected.slice(5))} />
      </div>
    );
  }
  if (selected?.startsWith("conn:")) {
    return (
      <div className="flex h-full flex-col overflow-y-auto">
        <ConnectorInspector system={system} dispatch={dispatch} index={Number(selected.slice(5))} />
      </div>
    );
  }
  if (selected?.startsWith("sys:")) {
    return (
      <div className="flex h-full flex-col overflow-y-auto">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-[13px] font-semibold">Workflow boundary</h2>
          <p className="pt-1 text-[11.5px] leading-[1.5] text-faint">
            How this workflow starts and what happens to its result. Neither is an agent — nothing
            here decides a model call.
          </p>
        </div>
        <BoundaryPanel system={system} dispatch={dispatch} />
      </div>
    );
  }

  const node = selected ? system.nodes.find((n) => n.id === selected) : null;

  if (!node) return <SystemPanel system={system} dispatch={dispatch} />;

  const meta = HARNESS[node.harness];
  const granted = grantsFor(system, node.id);
  const mine = problems.filter((p) => p.at === node.id);
  const routes = system.edges.filter((e) => e.source === node.id || e.target === node.id).length;
  const patch = (p: Partial<Node>) => dispatch({ type: "patch-node", id: node.id, patch: p });

  /* Connections pinned beneath this node. The index is the position in the
     system-wide list — the same id the canvas selects a card by. */
  const conns = listConnections(system)
    .map((c, index) => ({ c, index }))
    .filter(({ c }) => c.attached_to === node.id);
  const heldCards = new Set(granted.map((t) => toolCardOf(t)?.id));
  const holdsConnectable = CONNECTOR_DEFS.some((d) => heldCards.has(d.tool));

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Identity */}
      <div className="relative flex flex-col gap-2 border-b border-line px-4 py-3.5 pl-5">
        <span
          className="absolute top-3.5 bottom-3.5 left-0 w-[3px] rounded-r-[2px]"
          style={{ background: `var(${meta.token})` }}
        />
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium" style={{ color: `var(${meta.token})` }}>
            {meta.name}
          </span>
          <span className="grow" />
          {system.entry === node.id ? (
            <span className="font-mono text-[10px] text-dim">entry point</span>
          ) : (
            <Button size="sm" onClick={() => dispatch({ type: "set-entry", id: node.id })}>
              Make entry point
            </Button>
          )}
        </div>
        <Text value={node.label ?? ""} onChange={(v) => patch({ label: v })} placeholder="Node name" />
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10.5px] text-ghost">{node.id}</span>
          <span className="grow" />
          <Button
            size="sm"
            variant="solid"
            tone="err"
            onClick={() => {
              // One click asks, naming what goes with the node; the second,
              // within three seconds, deletes.
              if (armDelete !== node.id) {
                setArmDelete(node.id);
                setTimeout(() => setArmDelete((v) => (v === node.id ? null : v)), 3000);
                return;
              }
              setArmDelete(null);
              dispatch({ type: "delete-node", id: node.id });
            }}
          >
            {armDelete !== node.id
              ? "Delete node"
              : routes > 0
                ? `Delete node and ${routes} route${routes === 1 ? "" : "s"}`
                : "Delete node and its grants"}
          </Button>
        </div>
        <p className="text-[11.5px] leading-[1.55] text-faint">{meta.does}</p>
      </div>

      {mine.length > 0 && (
        <div className="border-b border-line px-3 py-3">
          <Banner
            tone={mine.some((p) => p.severity === "error") ? "err" : "warn"}
            title={mine.length === 1 ? mine[0].title : `${mine.length} things to look at`}
          >
            <span className="flex flex-col gap-2">
              {mine.map((p, i) => (
                <span key={i} className="flex flex-col gap-0.5">
                  {mine.length > 1 && (
                    <Status tone={p.severity === "error" ? "err" : "warn"}>{p.title}</Status>
                  )}
                  <span className="block text-[11px] leading-[1.5]">{p.detail}</span>
                  {p.fix && <span className="block text-[11px] leading-[1.5] text-faint">{p.fix}</span>}
                </span>
              ))}
            </span>
          </Banner>
        </div>
      )}

      {/* ── What it may touch ── */}
      <Section title="Capabilities" count={granted.length}>
        {granted.length === 0 && (
          <p className="text-[11.5px] leading-[1.5] text-faint">
            This node holds nothing. That is the safe default, and it is the control that actually
            works — a node with no way to act cannot be talked into acting.
          </p>
        )}
        <div className="flex flex-col gap-1">
          {granted.map((t) => {
            const entry = BY_NAME.get(t);
            const binding = system.tools.find((x) => x.name === t);
            const look = grantLookOf(system, t, servers);
            const about = entry
              ? `Behind this endpoint: ${entry.behind}`
              : binding?.summary || `Served by ${look.label}`;
            return (
              <div
                key={t}
                className="flex items-center gap-2 rounded-sm border border-line bg-raise py-1 pr-1 pl-1.5"
              >
                {look.mark(18, look.label)}
                <span className="flex min-w-0 grow flex-col">
                  <span className="truncate font-mono text-[11px] text-mist">{t}</span>
                  <span className="truncate text-[10px] leading-[1.4] text-faint" title={about}>
                    {about}
                  </span>
                </span>
                {look.taints && <Status tone="warn">External input</Status>}
                {look.sink && <Status tone="err">Acts outside</Status>}
                <RiskPill risk={look.risk} compact />
                <Mini label={`Revoke ${t}`} tone="err" onClick={() => dispatch({ type: "revoke", node: node.id, tool: t })}>
                  <Cross size={10} />
                </Mini>
              </div>
            );
          })}
        </div>

        {system.tools.length > granted.length && (
          <Pick
            value=""
            onChange={(v) => v && dispatch({ type: "grant", node: node.id, tool: v })}
            options={[
              { value: "", label: "+ Grant a capability" },
              ...system.tools
                .filter((t) => !granted.includes(t.name))
                .map((t) => ({ value: t.name, label: t.name })),
            ]}
          />
        )}

        <TaintNotice system={system} node={node} granted={granted} />
      </Section>

      {/* ── What the tools reach ── */}
      {(conns.length > 0 || holdsConnectable) && (
        <Section title="Connections" count={conns.length}>
          {conns.length === 0 ? (
            <p className="text-[11.5px] leading-[1.5] text-faint">
              Nothing attached yet. Drop a connector from the rail onto this node — the agent only
              ever calls the tool; the connector decides what it reaches.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {conns.map(({ c, index }) => {
                const off = c.entry.enabled === false;
                const card = TOOL_BY_ID.get(c.def.tool);
                return (
                  <button
                    key={index}
                    type="button"
                    onClick={() => onSelect?.(`conn:${index}`)}
                    disabled={!onSelect}
                    title={`${c.def.label} — feeds ${card?.label ?? c.def.tool}.${onSelect ? " Click to configure." : ""}`}
                    className={`focusable flex items-center gap-2 rounded-sm border border-line bg-raise py-1 pr-1.5 pl-1.5 text-left transition-colors ${
                      onSelect ? "cursor-pointer hover:border-line-strong hover:bg-surface" : ""
                    } ${off ? "opacity-55" : ""}`}
                  >
                    <ConnectorMark def={c.def} size={18} />
                    <span className="min-w-0 grow truncate font-mono text-[11px] text-mist">
                      {String(c.entry.name ?? c.def.label)}
                    </span>
                    <span className="shrink-0 font-mono text-[9px] tracking-[0.06em] text-faint uppercase">
                      {c.def.label}
                      {off ? " · off" : ""}
                    </span>
                    {card && <ToolMark card={card} size={14} title={`Feeds ${card.label}`} />}
                  </button>
                );
              })}
            </div>
          )}
        </Section>
      )}

      {/* ── The contract ── */}
      <Section title="Receives" count={(node.expects ?? []).length}
        action={
          <Mini
            label="Add an expected field"
            onClick={() =>
              dispatch({
                type: "set-field",
                node: node.id,
                side: "expects",
                fields: [...(node.expects ?? []), { name: "", kind: "string" as Kind }],
              })
            }
          >
            <Plus />
          </Mini>
        }
      >
        <FieldList
          fields={node.expects ?? []}
          onChange={(fields) => dispatch({ type: "set-field", node: node.id, side: "expects", fields })}
          empty="Anything upstream produces reaches this node unchecked."
        />
      </Section>

      <Section title="Returns" count={(node.emits ?? []).length}
        action={
          <Mini
            label="Add an emitted field"
            onClick={() =>
              dispatch({
                type: "set-field",
                node: node.id,
                side: "emits",
                fields: [...(node.emits ?? []), { name: "", kind: "string" as Kind }],
              })
            }
          >
            <Plus />
          </Mini>
        }
      >
        <FieldList
          fields={node.emits ?? []}
          onChange={(fields) => dispatch({ type: "set-field", node: node.id, side: "emits", fields })}
          empty="Declare what this must return, or downstream nodes take whatever arrives."
        />
      </Section>

      {/* ── Harness-specific ── */}
      {node.harness === "sequence" && <StepsPanel node={node} system={system} dispatch={dispatch} />}
      {node.harness === "delegate" && <DelegatePanel node={node} patch={patch} />}
      {node.harness === "await" && <AwaitPanel node={node} patch={patch} />}

      {/* ── Cardinality ── */}
      <Section title="Cardinality">
        <Check
          checked={!!node.fanout}
          onChange={(on) =>
            patch({ fanout: on ? { over: "", as_field: "item", max_parallel: 4, collect_as: "results", tolerate_failures: true } : undefined })
          }
          label="Run once per item"
          hint="A binding, not a different harness — it changes how many copies of this decision are in flight, not what decides the next one."
        />
        {node.fanout && (
          <div className="flex flex-col gap-2.5 rounded-md border border-line bg-raise/50 p-2.5">
            <Row label="Spread over" tight hint="An input field holding a list.">
              <Text
                mono
                value={node.fanout.over}
                onChange={(v) => patch({ fanout: { ...node.fanout!, over: v } })}
                placeholder="files"
                invalid={!node.fanout.over}
              />
            </Row>
            <Row label="Each item arrives as" tight>
              <Text
                mono
                value={node.fanout.as_field ?? "item"}
                onChange={(v) => patch({ fanout: { ...node.fanout!, as_field: v } })}
              />
            </Row>
            <Row label="Collect results as" tight>
              <Text
                mono
                value={node.fanout.collect_as ?? "results"}
                onChange={(v) => patch({ fanout: { ...node.fanout!, collect_as: v } })}
              />
            </Row>
            <Row label="At a time" tight hint="Also the blast radius when one goes wrong.">
              <Num
                value={node.fanout.max_parallel ?? 4}
                min={1}
                max={64}
                onChange={(v) => patch({ fanout: { ...node.fanout!, max_parallel: v } })}
              />
            </Row>
            <Check
              checked={node.fanout.tolerate_failures !== false}
              onChange={(v) => patch({ fanout: { ...node.fanout!, tolerate_failures: v } })}
              label="Carry on past a failed item"
              hint="A scan over 400 files should not lose 399 results to one bad file. The count is always reported either way."
            />
          </div>
        )}
      </Section>

      {/* ── Model and persona ── */}
      <Section title="Model & persona">
        <Row
          label="Persona & guidelines"
          hint="Who this agent is and how it should plan. Config, never code — the only place its role is written."
        >
          <Area
            rows={5}
            value={node.persona ?? ""}
            onChange={(v) => patch({ persona: v })}
            placeholder="What this agent is for, how it should work, and when it should stop."
          />
        </Row>
        <Row
          label="Model"
          hint={
            node.model_class
              ? `Routed by tier: this deployment's ${node.model_class} model is ${classDefaults[node.model_class] ?? "not set on the Configuration page"}.`
              : "A model id, or a tier the router resolves per deployment. Tiers are set on the Configuration page."
          }
        >
          <Pick
            value={node.model ? node.model : node.model_class ? `class:${node.model_class}` : ""}
            onChange={(v) =>
              v.startsWith("class:")
                ? patch({ model: "", model_class: v.slice(6) as "small" | "medium" | "large" })
                : patch({ model: v, model_class: undefined })
            }
            options={[
              { value: "", label: "Factory default" },
              ...MODEL_CLASSES.map((c) => ({ value: `class:${c}`, label: `Any ${c} model (routed)` })),
              ...models.map((m) => ({ value: m.id, label: m.class ? `${m.label} · ${m.class}` : m.label })),
            ]}
          />
        </Row>
      </Section>

      {/* ── Routes in and out ── */}
      <RoutePanel system={system} node={node} dispatch={dispatch} />
    </div>
  );
}

/* ═══════════════════ Taint, shown where the decision is made ═══════════════════ */

function TaintNotice({
  system,
  node,
  granted,
}: {
  system: AgentSystem;
  node: Node;
  granted: string[];
}) {
  const upstream = useMemo(() => taintReaching(system, node.id), [system, node.id]);
  const holdsSink = granted.some((t) => BY_NAME.get(t)?.is_sink);
  const holdsTaint = granted.some((t) => BY_NAME.get(t)?.taints);

  if (!upstream.length) return null;

  if (holdsSink) {
    return (
      <Banner tone="err" title="Outside content reaches a node that acts outside">
        This node acts on the outside world, and its input traces back to content authored elsewhere
        ({upstream.join(", ")}). At runtime those calls are refused, not gated — the injection never
        targets the node that reads, it targets the one that can act.
      </Banner>
    );
  }

  return (
    <Banner tone="warn" title="Input carries outside content">
      Input here derives from content authored outside the system{holdsTaint ? "" : ", upstream"} (
      {upstream.join(", ")}). The mark travels with anything this node produces.
    </Banner>
  );
}

/* ═══════════════════ Typed fields ═══════════════════ */

function FieldList({
  fields,
  onChange,
  empty,
}: {
  fields: Field[];
  onChange: (f: Field[]) => void;
  empty: string;
}) {
  if (!fields.length) {
    return <p className="text-[11.5px] leading-[1.5] text-faint">{empty}</p>;
  }

  return (
    <div className="flex flex-col gap-1.5">
      {fields.map((f, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <div className="min-w-0 grow">
            <Text
              mono
              value={f.name}
              invalid={!f.name}
              placeholder="field_name"
              onChange={(v) => onChange(fields.map((g, j) => (j === i ? { ...g, name: v } : g)))}
            />
          </div>
          <div className="w-[104px] shrink-0">
            <Pick
              value={f.kind}
              onChange={(v) => onChange(fields.map((g, j) => (j === i ? { ...g, kind: v as Kind } : g)))}
              options={KINDS.map((k) => ({ value: k, label: k }))}
            />
          </div>
          <Mini label={`Remove ${f.name || "field"}`} tone="err" onClick={() => onChange(fields.filter((_, j) => j !== i))}>
            <Cross size={10} />
          </Mini>
        </div>
      ))}
    </div>
  );
}

/**
 * A line-per-entry list edited as a textarea. Same contract as CsvText:
 * local text is the truth while typing — splitting on change alone eats the
 * Enter key — and the parsed list flows out on every change.
 */
function LinesArea({
  values,
  onValues,
  placeholder,
}: {
  values: string[];
  onValues: (v: string[]) => void;
  placeholder?: string;
}) {
  const parse = (t: string) => t.split("\n").map((s) => s.trim()).filter(Boolean);
  const joined = values.join("\n");
  const [text, setText] = useState(joined);
  const [seen, setSeen] = useState(joined);
  if (joined !== seen) {
    setSeen(joined);
    if (parse(text).join("\n") !== joined) setText(joined);
  }
  return (
    <Area
      rows={3}
      mono
      value={text}
      placeholder={placeholder}
      onChange={(v) => {
        setText(v);
        onValues(parse(v));
      }}
      onBlur={() => setText(parse(text).join("\n"))}
    />
  );
}

/* ═══════════════════ Per-harness panels ═══════════════════ */

function StepsPanel({
  node,
  system,
  dispatch,
}: {
  node: Node;
  system: AgentSystem;
  dispatch: (a: Action) => void;
}) {
  const steps = node.steps ?? [];
  const granted = grantsFor(system, node.id);
  const set = (next: Step[]) => dispatch({ type: "patch-node", id: node.id, patch: { steps: next } });

  return (
    <Section
      title="Plan"
      count={steps.length}
      action={
        <Mini
          label="Add a step"
          onClick={() => set([...steps, { id: `s${steps.length + 1}`, action: "model", prompt: "", emits: "" }])}
        >
          <Plus />
        </Mini>
      }
    >
      <p className="-mt-0.5 text-[11.5px] leading-[1.5] text-faint">
        Decided before the run. Nothing this node discovers can add a step. A model step marked
        &ldquo;spread&rdquo; fills this node&rsquo;s declared fields from its returned object
        instead of nesting it under one name.
      </p>

      {steps.map((st, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-md border border-line bg-raise/50 p-2.5">
          <div className="flex items-center gap-1.5">
            <span className="tnum font-mono text-[10px] text-ghost">{i + 1}</span>
            <div className="w-[96px] shrink-0">
              <Pick
                value={st.action}
                onChange={(v) => set(steps.map((s, j) => (j === i ? { ...s, action: v as "model" | "tool" } : s)))}
                options={[
                  { value: "model", label: "model" },
                  { value: "tool", label: "tool" },
                ]}
              />
            </div>
            <div className="min-w-0 grow">
              <Text
                mono
                value={st.emits ?? ""}
                placeholder="saves as…"
                onChange={(v) => set(steps.map((s, j) => (j === i ? { ...s, emits: v } : s)))}
              />
            </div>
            {st.action === "model" && (
              <button
                type="button"
                onClick={() =>
                  set(steps.map((s, j) => (j === i ? { ...s, emits: s.emits === "*" ? "" : "*" } : s)))
                }
                aria-pressed={st.emits === "*"}
                title="Spread"
                className={`focusable flex h-8 shrink-0 cursor-pointer items-center gap-1 rounded-sm border px-1.5 font-mono text-[12px] transition-colors ${
                  st.emits === "*"
                    ? "border-line-strong bg-ink text-on-ink"
                    : "border-line text-faint hover:bg-raise hover:text-fg"
                }`}
              >
                ✳<span className="font-mono text-[10px]">spread</span>
              </button>
            )}
            <Mini label="Remove step" tone="err" onClick={() => set(steps.filter((_, j) => j !== i))}>
              <Cross size={10} />
            </Mini>
          </div>

          {st.action === "model" ? (
            <Area
              rows={3}
              value={st.prompt ?? ""}
              placeholder="Prompt. Use {{field}} to read earlier results."
              onChange={(v) => set(steps.map((s, j) => (j === i ? { ...s, prompt: v } : s)))}
            />
          ) : (
            <>
              <Pick
                value={st.tool ?? ""}
                onChange={(v) => set(steps.map((s, j) => (j === i ? { ...s, tool: v } : s)))}
                options={[
                  { value: "", label: granted.length ? "Pick a granted tool…" : "Grant a tool first" },
                  ...granted.map((t) => ({ value: t, label: t })),
                ]}
              />
              {st.tool === "document.write" && (
                <Row label="Format" tight hint="What file this step produces.">
                  <Pick
                    value={String(st.args?.format ?? "md")}
                    onChange={(v) =>
                      set(steps.map((s, j) => (j === i ? { ...s, args: { ...s.args, format: v } } : s)))
                    }
                    options={["md", "pdf", "docx", "html", "txt", "csv", "xlsx"].map((f) => ({
                      value: f,
                      label: f === "md" ? "Markdown" : f.toUpperCase(),
                    }))}
                  />
                </Row>
              )}
              <StepArgs
                // Remount when the dropdown changes format, so the JSON view
                // reflects it — the two edit the same object.
                key={String(st.args?.format ?? "")}
                step={st}
                onChange={(args) => set(steps.map((s, j) => (j === i ? { ...s, args } : s)))}
              />
            </>
          )}

          <Text
            mono
            value={st.when ?? ""}
            placeholder="only when… (optional)"
            onChange={(v) => set(steps.map((s, j) => (j === i ? { ...s, when: v } : s)))}
          />
        </div>
      ))}
    </Section>
  );
}

function DelegatePanel({ node, patch }: { node: Node; patch: (p: Partial<Node>) => void }) {
  return (
    <Section title="Loop">
      <p className="-mt-0.5 text-[11.5px] leading-[1.5] text-faint">
        The model reads what it found and decides whether to go again.
      </p>
      <Row
        label="Step budget"
        hint="The only stop condition the model cannot assert for itself. A phrase it emits to signal completion is a phrase an injected instruction can emit too."
      >
        <Num value={node.max_steps ?? 12} min={1} max={60} onChange={(v) => patch({ max_steps: v })} />
      </Row>
    </Section>
  );
}

function AwaitPanel({ node, patch }: { node: Node; patch: (p: Partial<Node>) => void }) {
  const iface = node.interface ?? { kind: "approval" as const };
  const set = (p: Partial<typeof iface>) => patch({ interface: { ...iface, ...p } });

  return (
    <Section title="Interface">
      <p className="-mt-0.5 text-[11.5px] leading-[1.5] text-faint">
        The run suspends here and serialises. What resumes it is a binding — a person, a webhook, a
        schedule, a peer agent — not a different harness.
      </p>
      <Row label="Resumed by">
        <Pick
          value={iface.kind}
          onChange={(v) => set({ kind: v as typeof iface.kind })}
          options={[
            { value: "approval", label: "A person approving" },
            { value: "webhook", label: "An inbound webhook" },
            { value: "schedule", label: "A schedule" },
            { value: "agent", label: "A peer agent" },
          ]}
        />
      </Row>
      <Row
        label={iface.kind === "approval" ? "Approving roles" : "Target"}
        hint={iface.kind === "approval" ? "Roles, not people — resolved at deploy time so the spec stays portable." : undefined}
      >
        <Text
          mono
          value={iface.target ?? ""}
          placeholder={iface.kind === "approval" ? "dlp-analyst,dlp-lead" : "route or peer id"}
          onChange={(v) => set({ target: v })}
        />
      </Row>
      <Row label="If nobody answers" hint="Never “proceed”. A gate that opens when nobody answers is a delay, not a gate.">
        <Pick
          value={iface.on_timeout ?? "escalate"}
          onChange={(v) => set({ on_timeout: v })}
          options={[
            { value: "escalate", label: "Escalate" },
            { value: "fail", label: "Fail the run" },
          ]}
        />
      </Row>
    </Section>
  );
}

/* ═══════════════════ A selected wire ═══════════════════ */

function EdgeInspector({
  system,
  dispatch,
  index,
}: {
  system: AgentSystem;
  dispatch: (a: Action) => void;
  index: number;
}) {
  const edge = system.edges[index];

  if (!edge) {
    return <p className="px-4 py-6 text-[12px] text-faint">This route no longer exists.</p>;
  }

  const label = (id: string) => system.nodes.find((n) => n.id === id)?.label || id;

  return (
    <>
      <div className="flex flex-col gap-1 border-b border-line px-4 py-3.5">
        <h2 className="text-[13px] font-semibold text-fg">
          Route — {label(edge.source)} → {label(edge.target)}
        </h2>
        <p className="text-[11.5px] leading-[1.5] text-faint">
          Work leaves {label(edge.source)} along this wire.
        </p>
      </div>
      <Section title="Condition">
        <Text
          mono
          value={edge.when ?? ""}
          placeholder='only when… e.g. disposition != "benign"'
          onChange={(v) => dispatch({ type: "patch-edge", index, patch: { when: v } })}
        />
        <p className="text-[11px] leading-[1.5] text-faint">
          Fires only when the condition holds; empty = always.
        </p>
        <Button
          size="sm"
          tone="err"
          variant="solid"
          className="self-start"
          onClick={() => dispatch({ type: "delete-edge", index })}
        >
          Remove route
        </Button>
      </Section>
    </>
  );
}

/* ═══════════════════ Routes ═══════════════════ */

function RoutePanel({
  system,
  node,
  dispatch,
}: {
  system: AgentSystem;
  node: Node;
  dispatch: (a: Action) => void;
}) {
  const outgoing = system.edges
    .map((e, index) => ({ e, index }))
    .filter(({ e }) => e.source === node.id);

  return (
    <Section title="Routes out" count={outgoing.length}>
      {outgoing.length === 0 ? (
        <p className="text-[11.5px] leading-[1.5] text-faint">
          Nothing leads out of this node. Drag from its right edge to wire it onward.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {outgoing.map(({ e, index }) => (
            <div key={index} className="flex flex-col gap-1.5 rounded-md border border-line bg-raise/50 p-2.5">
              <div className="flex items-center gap-2">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="shrink-0 text-faint" aria-hidden>
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
                <span className="min-w-0 grow truncate text-[12px] font-medium text-mist">
                  {system.nodes.find((n) => n.id === e.target)?.label ?? e.target}
                </span>
                <Mini label="Remove this route" tone="err" onClick={() => dispatch({ type: "delete-edge", index })}>
                  <Cross size={10} />
                </Mini>
              </div>
              <Text
                mono
                value={e.when ?? ""}
                placeholder='only when… e.g. disposition != "benign"'
                onChange={(v) => dispatch({ type: "patch-edge", index, patch: { when: v } })}
              />
            </div>
          ))}
          <p className="text-[11px] leading-[1.5] text-faint">
            A route closed by its condition is recorded as closed. A stage that did not run and a
            stage that ran and found nothing never read the same.
          </p>
        </div>
      )}
    </Section>
  );
}

/* ═══════════════════ Nothing selected ═══════════════════ */

function SystemPanel({ system, dispatch }: { system: AgentSystem; dispatch: (a: Action) => void }) {
  // Which gate's remove is armed, by index; auto-disarms after three seconds.
  const [armGate, setArmGate] = useState<number | null>(null);
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <BoundaryPanel system={system} dispatch={dispatch} />
      <Section title="System">
        <Row label="Name">
          <Text value={system.name} onChange={(v) => dispatch({ type: "meta", patch: { name: v } })} />
        </Row>
        <Row label="Identifier" hint="Stable across deployments. Runs are attributed to it.">
          <Text mono value={system.id} onChange={(v) => dispatch({ type: "meta", patch: { id: v } })} />
        </Row>
        <Row label="Owning team">
          <Text
            value={system.owner ?? ""}
            placeholder="cyber-dlp"
            onChange={(v) => dispatch({ type: "meta", patch: { owner: v } })}
          />
        </Row>
        <Row label="What it does">
          <Area
            rows={3}
            value={system.description ?? ""}
            onChange={(v) => dispatch({ type: "meta", patch: { description: v } })}
            placeholder="One or two sentences, for whoever approves this."
          />
        </Row>
      </Section>

      <Section title="Gates" count={system.policy.gates.length}
        action={
          <Mini
            label="Add a gate"
            onClick={() =>
              dispatch({
                type: "patch-policy",
                patch: {
                  gates: [...system.policy.gates, { at_or_above: "risky", approvers: [], on_timeout: "escalate" }],
                },
              })
            }
          >
            <Plus />
          </Mini>
        }
      >
        <p className="-mt-0.5 text-[11.5px] leading-[1.5] text-faint">
          Risk is declared when a tool is registered and read here as a lookup — never inferred at
          call time, because a classifier in the control path can be wrong in the direction that
          hurts.
        </p>
        {system.policy.gates.map((g, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-md border border-line bg-raise/50 p-2.5">
            <Row label="Stop at or above" tight>
              <Pick
                value={g.at_or_above}
                onChange={(v) =>
                  dispatch({
                    type: "patch-policy",
                    patch: {
                      gates: system.policy.gates.map((x, j) => (j === i ? { ...x, at_or_above: v } : x)),
                    },
                  })
                }
                options={[
                  { value: "write", label: "Write — reversible changes" },
                  { value: "risky", label: "Risky — visible outside" },
                  { value: "destructive", label: "Destructive — cannot be undone" },
                ]}
              />
            </Row>
            <Row label="Approving roles" tight>
              <CsvText
                mono
                values={g.approvers}
                placeholder="dlp-lead"
                invalid={!g.approvers.length}
                onValues={(approvers) =>
                  dispatch({
                    type: "patch-policy",
                    patch: {
                      gates: system.policy.gates.map((x, j) => (j === i ? { ...x, approvers } : x)),
                    },
                  })
                }
              />
            </Row>
            <Button
              size="sm"
              variant="solid"
              tone="err"
              className="self-start"
              onClick={() => {
                if (armGate !== i) {
                  setArmGate(i);
                  setTimeout(() => setArmGate((v) => (v === i ? null : v)), 3000);
                  return;
                }
                setArmGate(null);
                dispatch({
                  type: "patch-policy",
                  patch: { gates: system.policy.gates.filter((_, j) => j !== i) },
                });
              }}
            >
              {armGate === i ? "Remove gate and its approvers" : "Remove gate"}
            </Button>
          </div>
        ))}
      </Section>

      <Section title="Injection filter">
        <p className="-mt-0.5 text-[11.5px] leading-[1.55] text-faint">
          Defence in depth, honestly scoped: this catches the careless attempts. The sharpest attacks
          in this domain have no lexical signature — a grammatical sentence claiming sanctioned
          vendor traffic is both plausible and the payload. Tune it strict-first; a false positive
          costs a review, a false negative costs an incident.
        </p>
        <Row label="Refuse input matching">
          <LinesArea
            values={system.policy.injection.patterns}
            placeholder={"ignore all previous instructions\ndisregard your instructions"}
            onValues={(patterns) =>
              dispatch({
                type: "patch-policy",
                patch: { injection: { ...system.policy.injection, patterns } },
              })
            }
          />
        </Row>
        <Row
          label="Actions this system must never take"
          hint="Matched against what the model proposes to do, not against what it read. This half is the more useful one — your team is the authority on this system's remit."
        >
          <LinesArea
            values={system.policy.injection.prohibited_actions}
            placeholder={"close the case without review"}
            onValues={(prohibited_actions) =>
              dispatch({
                type: "patch-policy",
                patch: { injection: { ...system.policy.injection, prohibited_actions } },
              })
            }
          />
        </Row>
        <Check
          checked={system.policy.block_tainted_sinks}
          onChange={(v) => dispatch({ type: "patch-policy", patch: { block_tainted_sinks: v } })}
          label="Refuse outward actions built from untrusted content"
          hint="Recommended for anything client-facing. With this off, those calls are gated to a human instead of refused."
        />
      </Section>

      <Section title="Evals">
        <p className="-mt-0.5 text-[11.5px] leading-[1.55] text-faint">
          Upload a labelled set and run it. The result is stamped with this system&rsquo;s digest, so a
          number can never be shown against a config that did not produce it.
        </p>
        <Row label="Dataset">
          <Text
            mono
            value={system.evals.dataset ?? ""}
            placeholder="dlp-triage-2026q1.jsonl"
            onChange={(v) => dispatch({ type: "patch-evals", patch: { dataset: v } })}
          />
        </Row>
        <Row label="Compare field" hint="The output field checked against the label.">
          <Text
            mono
            value={system.evals.compare ?? ""}
            placeholder="disposition"
            onChange={(v) => dispatch({ type: "patch-evals", patch: { compare: v } })}
          />
        </Row>
      </Section>
    </div>
  );
}

/* ═══════════════════ Step arguments ═══════════════════ */

/**
 * A tool step's arguments, edited as the JSON that lands in the spec.
 *
 * This is where a `document.write` step's `format` gets set — pdf, docx, xlsx
 * — and where any tool's fixed arguments live. `{{field}}` values read earlier
 * results, exactly as in prompts. Kept as raw JSON on purpose: the arguments
 * are the spec, and a form that hides one key is a form that loses it.
 */
function StepArgs({
  step,
  onChange,
}: {
  step: Step;
  onChange: (args: Record<string, unknown>) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(step.args ?? {}, null, 2));
  const [bad, setBad] = useState(false);

  return (
    <div className="flex flex-col gap-1">
      <Area
        mono
        rows={4}
        value={text}
        invalid={bad}
        onChange={(v) => {
          setText(v);
          try {
            const parsed = JSON.parse(v || "{}");
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              setBad(false);
              onChange(parsed as Record<string, unknown>);
            } else setBad(true);
          } catch {
            setBad(true);
          }
        }}
        placeholder={'{\n  "title": "{{title}}",\n  "content": "{{body}}",\n  "format": "pdf"\n}'}
      />
      <span className={`text-[10.5px] ${bad ? "text-err" : "text-faint"}`}>
        {bad
          ? "Not a JSON object yet — the last valid version is what the spec holds."
          : "Arguments as JSON. {{field}} reads earlier results; format picks the file type for document.write."}
      </span>
    </div>
  );
}

/**
 * An object-valued connector field as one line of JSON. Same contract as
 * StepArgs — local text while typing, patch only when valid — plus a re-seed
 * when the value changes from outside this input.
 */
function JsonText({
  value,
  onPatch,
  placeholder,
}: {
  value: Record<string, unknown>;
  onPatch: (v: Record<string, unknown>) => void;
  placeholder?: string;
}) {
  const json = JSON.stringify(value);
  const [text, setText] = useState(json);
  const [seen, setSeen] = useState(json);
  const [bad, setBad] = useState(false);
  if (json !== seen) {
    setSeen(json);
    let echo = false;
    try {
      echo = JSON.stringify(JSON.parse(text || "{}")) === json;
    } catch {}
    if (!echo) {
      setText(json);
      setBad(false);
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <Text
        mono
        value={text}
        placeholder={placeholder}
        invalid={bad}
        onChange={(v) => {
          setText(v);
          try {
            const parsed = JSON.parse(v || "{}");
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              setBad(false);
              onPatch(parsed as Record<string, unknown>);
            } else setBad(true);
          } catch {
            setBad(true);
          }
        }}
      />
      {bad && (
        <span className="text-[10.5px] text-err">
          Not a JSON object yet — the last valid version is what the spec holds.
        </span>
      )}
    </div>
  );
}

/* ═══════════════════ Connection settings ═══════════════════
   One schema-driven panel for every connector kind — retrieval sources,
   register backends, notify transports, engines, git roots. The fields come
   from CONNECTOR_DEFS, so a new connector kind never needs new UI. */

function ConnectorInspector({
  system,
  dispatch,
  index,
}: {
  system: AgentSystem;
  dispatch: (a: Action) => void;
  index: number;
}) {
  const [armRemove, setArmRemove] = useState(false);
  const conn = listConnections(system)[index];

  if (!conn) {
    return <p className="px-4 py-6 text-[12px] text-faint">This connection no longer exists.</p>;
  }

  const { def, entry } = conn;
  const patch = (partial: Record<string, unknown>) =>
    dispatch({ type: "patch-connection", server: def.server, slot: def.slot, index: conn.index, patch: partial });

  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3.5">
        <ConnectorMark def={def} size={32} />
        <div className="flex min-w-0 grow flex-col">
          <span className="text-[13px] font-semibold text-fg">{def.label}</span>
          <span className="flex min-w-0 items-center gap-1 truncate text-[10.5px] text-faint">
            feeds
            <ToolMark card={def.tool} size={12} />
            <span className="truncate">
              {TOOL_BY_ID.get(def.tool)?.label ?? def.tool} under{" "}
              {system.nodes.find((n) => n.id === conn.attached_to)?.label ?? conn.attached_to ?? "—"}
            </span>
          </span>
        </div>
        <Button
          size="sm"
          variant="solid"
          tone="err"
          onClick={() => {
            if (!armRemove) {
              setArmRemove(true);
              setTimeout(() => setArmRemove(false), 3000);
              return;
            }
            setArmRemove(false);
            dispatch({ type: "remove-connection", server: def.server, slot: def.slot, index: conn.index });
          }}
        >
          {armRemove ? "Remove connection and its settings" : "Remove"}
        </Button>
      </div>

      <Section title="Connection">
        <p className="-mt-0.5 text-[11.5px] leading-[1.55] text-faint">
          {def.blurb}. The agent only ever calls {def.tool} — it never learns this connection
          exists, which is why swapping it moves nothing in the graph.
        </p>

        <Row label="Name" tight>
          <Text
            mono
            value={String(entry.name ?? "")}
            onChange={(v) => patch({ name: v })}
            invalid={!entry.name}
          />
        </Row>

        {def.fields.map((f) => {
          const value = entry[f.key];
          if (f.kind === "bool") {
            return (
              <Check
                key={f.key}
                checked={value === true}
                onChange={(v) => patch({ [f.key]: v })}
                label={f.label}
                hint={f.hint}
              />
            );
          }
          if (f.kind === "number") {
            return (
              <Row key={f.key} label={f.label} tight hint={f.hint}>
                <Num value={Number(value ?? 0)} min={0} max={65535} onChange={(v) => patch({ [f.key]: v })} />
              </Row>
            );
          }
          if (f.kind === "csv") {
            const list = Array.isArray(value) ? value.map(String) : [];
            return (
              <Row key={f.key} label={f.label} tight hint={f.hint}>
                <CsvText
                  mono={f.mono}
                  values={list}
                  placeholder={f.placeholder}
                  onValues={(v) => patch({ [f.key]: v })}
                />
              </Row>
            );
          }
          // Objects (like a column map) edit as JSON text; strings as strings.
          const isObject = value !== null && typeof value === "object";
          if (isObject) {
            return (
              <Row key={f.key} label={f.label} tight hint={f.hint}>
                <JsonText
                  value={value as Record<string, unknown>}
                  placeholder={f.placeholder}
                  onPatch={(v) => patch({ [f.key]: v })}
                />
              </Row>
            );
          }
          return (
            <Row key={f.key} label={f.label} tight hint={f.hint}>
              <Text
                mono={f.mono}
                value={String(value ?? "")}
                placeholder={f.placeholder}
                onChange={(v) => patch({ [f.key]: v })}
              />
            </Row>
          );
        })}

        <Check
          checked={entry.enabled !== false}
          onChange={(v) => patch({ enabled: v ? undefined : false })}
          label="Enabled"
          hint={`Off keeps the card and its settings, but ${def.tool} stops consulting it.`}
        />
      </Section>
    </>
  );
}
