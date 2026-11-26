"use client";
import { Failure } from "./pending";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Mono, Status, Tag } from "./ui";
import { Banner } from "./overlays";
import { Field } from "./forms";
import { Pick } from "./select";
import { DigestChip } from "./digest-chip";
import { Figures, JsonDetails, Section } from "./section";
import { AgentHeader, ChooseAgentHeader } from "./agent-header";
import { soon } from "@/lib/soon";
import { api, errorText } from "@/lib/api/client";
import { listAgents, type AgentSummary } from "@/lib/api/l2";
import { bomOf, type AiBom, type BomServer } from "@/lib/api/l9";
import { DATA_CLASS_TONE, chosenLine, classLines, impactLine, modelLine } from "@/lib/bom";
import { whenText } from "@/lib/lifecycle";
import type { VersionView } from "@/lib/versions";

/**
 * The AI bill of materials: what one version of an agent is made of and
 * reaches. Its models with the rule that chose each and the endpoint that
 * serves it; its tools with their risk, data classes and the servers that
 * serve them (name, version, the MCP `serverInfo` from discovery, the pinned
 * tool-list digest); the knowledge stores it is granted; the datasets its
 * runs were handed; the agents its runs started; the A2A peers its runs
 * handed tasks to (read from the runs, since which peer a call reaches is an
 * argument decided at run time), with each one's registration and pinned
 * card; the template it was cut from and the templates made from it; and the
 * digests. What the answer names in `not_built` (a sub-agent a definition
 * declares, the CycloneDX export) is said in its words. The answer is read as
 * the backend writes it: the typed part through lib/api/l9.ts, the rest here.
 */

interface BomExtra {
  knowledge: { store: string; rights: string[]; revoked: string[]; retrieval: string; data_classes: string[]; named_by: string[]; not_granted?: boolean }[];
  datasets: { id: string; name: string; data_class: string; runs: number; last_used: string | null }[];
  sub_agents: { agent: string; runs: number; last_at: string | null }[];
  /** How often its runs called each peer, and when last, by peer id. */
  peerCalls: Record<string, { calls: number; last_at: string | null }>;
  not_built: string[];
}

const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

async function readBom(agent: string, version?: number): Promise<{ bom: AiBom; extra: BomExtra }> {
  const path = `/api/agents/${encodeURIComponent(agent)}/bom${version === undefined ? "" : `?version=${version}`}`;
  const res = await fetch(path, { cache: "no-store" });
  const d = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !d || d.error) throw new Error(errorText(d, res, "GET", "/api/agents/{agent}/bom"));
  const peerCalls = Object.fromEntries(
    list<Record<string, unknown>>(d.peers).map((p) => [String(p.id ?? ""), { calls: typeof p.calls === "number" ? p.calls : 0, last_at: typeof p.last_at === "string" ? p.last_at : null }]),
  );
  return { bom: bomOf(d), extra: { knowledge: list(d.knowledge), datasets: list(d.datasets), sub_agents: list(d.sub_agents), peerCalls, not_built: list<string>(d.not_built) } };
}

function ClassTag({ value, none }: { value: string; none: string }) {
  return value ? <Tag tone={DATA_CLASS_TONE[value] ?? "neutral"}>{value}</Tag> : <span className="text-[11px] text-ghost">{none}</span>;
}

function ServerRow({ s }: { s: BomServer }) {
  return (
    <tr className="border-b border-line align-top last:border-0">
      <td className="px-3 py-1.5">
        <span className="block text-fg">{s.label || s.id}</span>
        <Mono className="text-[10px] text-ghost">{s.id}</Mono>
      </td>
      <td className="px-3 py-1.5 text-dim">{s.server_info ? `${s.server_info.name} ${s.server_info.version}` : s.version || "not discovered"}</td>
      <td className="px-3 py-1.5">
        <Status tone={s.status === "approved" || s.builtin ? "ok" : "warn"}>{s.status || "unknown"}</Status>
      </td>
      <td className="px-3 py-1.5 text-dim">{s.transport}</td>
      <td className="px-3 py-1.5">{s.tool_list_digest ? <DigestChip digest={s.tool_list_digest} label="Pinned tool-list digest" /> : <span className="text-[11px] text-ghost">{s.builtin ? "built in" : "none"}</span>}</td>
      <td className="px-3 py-1.5 font-mono text-[10.5px] text-faint">{s.tools.join(", ")}</td>
    </tr>
  );
}

/** The BOM. Presentational. */
export function BomView({ bom, extra }: { bom: AiBom; extra?: BomExtra }) {
  const b = bom;
  const unclassed = b.tools.filter((t) => !t.data_class && !t.sources.length && !t.sink).length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-dim">
        <span className="text-[13px] font-semibold text-fg">{b.name}</span>
        {b.autonomy && <Tag>{b.autonomy}</Tag>}
        <span>version {b.version ?? "?"}</span>
        <DigestChip digest={b.digest} label="Spec digest" />
        {b.deployed ? <Status tone="ok">production runs it</Status> : <Status tone="queue">{b.production ? `production runs version ${String(b.production.version ?? "?")}` : "not deployed"}</Status>}
        <span>owner {b.owner || "none on record"}</span>
        <span className="text-faint">
          {b.runtime.package} {b.runtime.version} · saved by {b.saved_by || "unknown"} {whenText(b.saved_at)}
        </span>
      </div>
      <Figures
        items={[
          { k: "models", v: b.count.models },
          { k: "tools", v: b.count.tools },
          { k: "servers", v: b.count.servers },
          ...(extra ? [{ k: "knowledge stores", v: extra.knowledge.length }, { k: "datasets handed", v: extra.datasets.length }, { k: "agents its runs started", v: extra.sub_agents.length }] : []),
        ]}
      />

      <Section title="Models" hue="model" meta="deployment and route">
        <ul className="flex flex-col gap-1">
          {b.models.map((m, i) => (
            <li key={`${m.model}-${i}`} className="flex flex-wrap items-center gap-2 text-[11.5px]">
              <Mono className="text-[11px] text-fg">{m.model || "the deployment's default"}</Mono>
              <span className="text-dim">{modelLine(m)}</span>
              <span className="text-faint">
                chosen by {chosenLine(m)} · {m.nodes.join(", ")}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Tools and data classes" hue="tool" meta={unclassed ? `${unclassed} declare no class` : "what each returns, and what each sink takes"}>
        {b.tools.length ? (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full min-w-[820px] border-collapse text-[11.5px]">
              <thead>
                <tr className="border-b border-line bg-raise/40 text-left text-[10.5px] text-faint">
                  <th className="px-3 py-1.5 font-medium">Tool</th>
                  <th className="px-3 py-1.5 font-medium">Risk</th>
                  <th className="px-3 py-1.5 font-medium">Returns</th>
                  <th className="px-3 py-1.5 font-medium">Takes up to</th>
                  <th className="px-3 py-1.5 font-medium">Knowledge stores it names</th>
                </tr>
              </thead>
              <tbody>
                {b.tools.map((t) => {
                  const c = classLines(t);
                  return (
                    <tr key={t.name} className="border-b border-line align-top last:border-0">
                      <td className="px-3 py-1.5">
                        <Mono className="text-[11px] text-mist">{t.name}</Mono>
                        <span className="block text-[10.5px] text-faint">
                          {t.server}
                          {t.sink ? " · sink" : ""}
                          {t.taints ? " · external input" : ""}
                          {t.impact.length ? ` · ${impactLine(t)}` : ""}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-dim">{t.risk}</td>
                      <td className="px-3 py-1.5">
                        <ClassTag value={t.data_class} none="undeclared" />
                      </td>
                      <td className="px-3 py-1.5">{t.sink ? <ClassTag value={t.max_data_class} none={c.takes} /> : <span className="text-[11px] text-ghost">not a sink</span>}</td>
                      <td className="px-3 py-1.5">
                        <span className="flex flex-col gap-0.5">
                          {t.sources.map((s) => (
                            <span key={s.name} className="flex items-center gap-1.5 text-[11px] text-dim">
                              {s.name} <ClassTag value={s.data_class} none="undeclared" />
                            </span>
                          ))}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[12px] text-faint">It holds no tools.</p>
        )}
      </Section>

      <Section title="Servers" hue="mcp" meta="names, versions and pinned tool lists">
        {b.servers.length ? (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full min-w-[820px] border-collapse text-[11.5px]">
              <thead>
                <tr className="border-b border-line bg-raise/40 text-left text-[10.5px] text-faint">
                  <th className="px-3 py-1.5 font-medium">Server</th>
                  <th className="px-3 py-1.5 font-medium">serverInfo</th>
                  <th className="px-3 py-1.5 font-medium">Status</th>
                  <th className="px-3 py-1.5 font-medium">Transport</th>
                  <th className="px-3 py-1.5 font-medium">Tool list</th>
                  <th className="px-3 py-1.5 font-medium">Tools</th>
                </tr>
              </thead>
              <tbody>
                {b.servers.map((s) => (
                  <ServerRow key={s.id} s={s} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[12px] text-faint">No servers.</p>
        )}
      </Section>

      <Section title="Peers" hue="mcp" meta="the A2A peers its runs handed tasks to">
        {b.peers.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[11.5px]">
              <thead>
                <tr className="border-b border-line text-left text-[10.5px] text-faint">
                  <th className="px-3 py-1.5 font-medium">Peer</th>
                  <th className="px-3 py-1.5 font-medium">Registration</th>
                  <th className="px-3 py-1.5 font-medium">Pinned card</th>
                  <th className="px-3 py-1.5 font-medium">Most sensitive data it may be sent</th>
                  <th className="px-3 py-1.5 font-medium">Calls</th>
                </tr>
              </thead>
              <tbody>
                {b.peers.map((p) => {
                  const used = extra?.peerCalls[p.id];
                  return (
                    <tr key={p.id} className="border-b border-line align-top last:border-0">
                      <td className="px-3 py-1.5">
                        <span className="block text-fg">{p.name || p.id}</span>
                        <Mono className="text-[10px] text-ghost">{p.id}</Mono>
                      </td>
                      <td className="px-3 py-1.5">
                        <Status tone={p.status === "approved" ? "ok" : p.registered ? "warn" : "err"}>{p.registered ? p.status || "unknown" : "not registered: every call is refused"}</Status>
                        {p.url && <Mono className="block truncate text-[10px] text-faint">{p.url}</Mono>}
                      </td>
                      <td className="px-3 py-1.5">
                        {p.card ? <span className="text-dim">{[p.card.name, p.card.version].filter(Boolean).join(" ") || "unnamed"}</span> : <span className="text-[11px] text-ghost">none pinned</span>}
                        {p.card_digest && <DigestChip digest={p.card_digest} label="Pinned card digest" />}
                      </td>
                      <td className="px-3 py-1.5"><ClassTag value={p.effective_max_data_class} none="not set" /></td>
                      <td className="tnum px-3 py-1.5 text-dim">{used ? `${used.calls}, last ${whenText(used.last_at)}` : "not counted"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[11.5px] text-faint">Its runs handed no task to a peer.</p>
        )}
      </Section>

      <Section title="Templates" hue="ledger" meta="where it was cut from, and what was made from it">
        {(() => {
          const t = b.templates;
          const cut = t.cut_from;
          const text = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
          return (
            <div className="flex flex-col gap-1.5 text-[11.5px]">
              {cut ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-faint">Cut from</span>
                  <span className="text-fg">{text(cut.name) || text(cut.template)}</span>
                  <Mono className="text-[10.5px] text-faint">{text(cut.template)}</Mono>
                  {cut.certified === true ? <Status tone="ok">certified</Status> : <Status tone="warn">not certified</Status>}
                  {text(cut.template_digest) && <DigestChip digest={text(cut.template_digest)} label="Template digest" />}
                  <span className="text-faint">as version {text(cut.version) || "not recorded"}, {whenText(text(cut.at) || null)}</span>
                </span>
              ) : (
                <span className="text-faint">Made by hand: it was not cut from a template.</span>
              )}
              {t.made.length ? (
                t.made.map((m, i) => (
                  <span key={`${text(m.template)}-${i}`} className="flex flex-wrap items-center gap-2">
                    <span className="text-faint">Made into the template</span>
                    <span className="text-fg">{text(m.name) || text(m.template)}</span>
                    <Mono className="text-[10.5px] text-faint">{text(m.template)}</Mono>
                    {m.certified === true ? <Status tone="ok">certified</Status> : <Status tone="warn">not certified</Status>}
                    <span className="text-faint">from version {text(m.version) || "not recorded"}, {whenText(text(m.at) || null)}</span>
                  </span>
                ))
              ) : (
                <span className="text-faint">No template was made from its versions.</span>
              )}
            </div>
          );
        })()}
      </Section>

      {extra && (
        <Section title="Knowledge, datasets and agents its runs started" hue="ledger">
          {extra.knowledge.length ? (
            <ul className="flex flex-col gap-1 text-[11.5px]">
              {extra.knowledge.map((k) => (
                <li key={k.store} className="flex flex-wrap items-center gap-2">
                  <Mono className="text-[11px] text-fg">{k.store}</Mono>
                  {k.not_granted ? <Status tone="warn">named by a tool, not granted</Status> : <span className="text-dim">may {k.rights.join(", ") || "do nothing"}{k.revoked.length ? `; revoked: ${k.revoked.join(", ")}` : ""}</span>}
                  {k.retrieval && <span className="text-faint">retrieval {k.retrieval}</span>}
                  {k.data_classes.map((c) => (
                    <ClassTag key={c} value={c} none="" />
                  ))}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11.5px] text-faint">It is granted no knowledge store, and no tool names one.</p>
          )}
          {extra.datasets.length ? (
            <ul className="flex flex-col gap-1 text-[11.5px]">
              {extra.datasets.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-2">
                  <span className="text-fg">{d.name}</span> <ClassTag value={d.data_class} none="" />
                  <span className="text-faint">
                    handed to {d.runs} run{d.runs === 1 ? "" : "s"}, last {whenText(d.last_used)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11.5px] text-faint">No dataset was handed to its runs.</p>
          )}
          {extra.sub_agents.length ? (
            <ul className="flex flex-col gap-1 text-[11.5px]">
              {extra.sub_agents.map((a) => (
                <li key={a.agent}>
                  <Mono className="text-[11px] text-fg">{a.agent}</Mono> <span className="text-faint">{a.runs} run{a.runs === 1 ? "" : "s"} started under its runs, last {whenText(a.last_at)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[11.5px] text-faint">Its runs started no run of another agent.</p>
          )}
          {extra.not_built.map((n) => (
            <p key={n} className="text-[11px] text-faint">
              {({ "sub_agents.declared": "Declared sub-agents", cyclonedx: "CycloneDX export" } as Record<string, string>)[n] ?? n}: Not built
            </p>
          ))}
        </Section>
      )}

      <Section title="Digests" hue="ledger">
        <JsonDetails label="Every digest" value={b.digests} />
      </Section>
    </div>
  );
}


function BomPage() {
  const params = useSearchParams();
  const router = useRouter();
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  /** The registry did not answer: the failure is said, never that no agent is saved. */
  const [agentsDown, setAgentsDown] = useState("");
  const [versions, setVersions] = useState<VersionView[]>([]);
  const [bom, setBom] = useState<{ bom: AiBom; extra: BomExtra } | null>(null);
  const [error, setError] = useState("");
  /** The agent this tab is open on; with none named the page offers the choice and reads nothing. */
  const agent = params.get("agent") ?? "";
  const version = params.get("version");
  const versionNumber = version ? Number(version) : undefined;
  const load = useCallback(() => {
    if (!agent) return;
    readBom(agent, versionNumber)
      .then((b) => {
        setBom(b);
        setError("");
      })
      .catch((e) => {
        setBom(null);
        setError((e as Error).message);
      });
  }, [agent, versionNumber]);
  useEffect(() => soon(load), [load]);
  useEffect(() => {
    listAgents()
      .then(setAgents)
      .catch((e) => {
        setAgents([]);
        setAgentsDown((e as Error).message);
      });
  }, []);
  useEffect(() => {
    if (!agent) return;
    let stop = false;
    api
      .GET("/api/agents/{agent}/versions", { params: { path: { agent } } })
      .then(({ data, error: err, response }) => {
        if (stop) return;
        if (!data) return setError(errorText(err, response));
        setVersions(data.versions);
      })
      .catch(() => !stop && setVersions([]));
    return () => {
      stop = true;
    };
  }, [agent]);
  const go = (a: string, v?: string) => router.push(`/bom?agent=${encodeURIComponent(a)}${v ? `&version=${encodeURIComponent(v)}` : ""}`);
  const versionOptions = useMemo(() => [{ value: "", label: "Latest, or what production runs" }, ...[...versions].reverse().map((v) => ({ value: String(v.version), label: `Version ${v.version}${v.deployed ? " (production)" : ""}` }))], [versions]);

  if (!agent) {
    return (
      <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7">
        <ChooseAgentHeader title="Bill of materials">
          Choose an agent to read what it is made of.
        </ChooseAgentHeader>
        {agentsDown ? (
          <Failure what="The agents could not be read" message={agentsDown} />
        ) : (
          <>
            <div className="max-w-[320px]">
              <Field label="Agent">
                <Pick value="" onChange={(a) => a && go(a)} options={[{ value: "", label: "Choose an agent" }, ...(agents ?? []).map((a) => ({ value: a.id, label: a.name }))]} disabled={!agents?.length} loading={agents === null} />
              </Field>
            </div>
            {agents?.length === 0 && <p className="text-[12px] text-faint">No agent is saved yet.</p>}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7">
      <AgentHeader
        tab="bom"
        id={agent}
        agent={agents?.find((a) => a.id === agent) ?? null}
      >
        Models, tools, servers, knowledge and digests.
      </AgentHeader>
      {(
        <>
          <div className="max-w-[320px]">
            <Field label="Version">
              <Pick value={version ?? ""} onChange={(v) => go(agent, v)} options={versionOptions} disabled={!versions.length} />
            </Field>
          </div>
          {error && (
            <Banner tone="err" title="Could not read the bill of materials">
              {error}
            </Banner>
          )}
          {bom && <BomView bom={bom.bom} extra={bom.extra} />}
        </>
      )}
    </div>
  );
}

export function BomPageView() {
  return (
    <Suspense>
      <BomPage />
    </Suspense>
  );
}
