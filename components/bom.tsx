"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Mono, Status, Tag } from "./ui";
import { Banner, QuietNote } from "./overlays";
import { QUIET } from "@/lib/quiet";
import { Field } from "./forms";
import { Pick } from "./select";
import { DigestChip } from "./digest-chip";
import { Figures, JsonDetails, Section } from "./section";
import { AgentHeader, ChooseAgentHeader } from "./agent-header";
import { soon } from "@/lib/soon";
import { api, errorText } from "@/lib/api/client";
import { listAgents, type AgentSummary } from "@/lib/api/l2";
import { downloadCycloneDx, getBom, saveFile, type AiBom, type BomPeer, type BomServer } from "@/lib/api/l9";
import { DATA_CLASS_TONE, chosenLine, classLines, impactLine, modelLine } from "@/lib/bom";
import { whenText } from "@/lib/lifecycle";
import type { VersionView } from "@/lib/versions";

/**
 * The AI bill of materials (phase L9): what an agent is made of. Its models
 * with deployment and route, its tools with their data classes and the servers
 * that serve them (name, version, the MCP `serverInfo` from discovery, the
 * pinned tool-list digest), its peers with their card digests, the template it
 * was cut from, and every digest. It downloads as CycloneDX 1.6. Endpoints with
 * credentials in them are masked by the backend. The data classes on tools and
 * sources read here, per version; they are declared in the Builder.
 */

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
        <Status tone={s.status === "approved" || s.status === "builtin" ? "ok" : "warn"}>{s.status || "unknown"}</Status>
      </td>
      <td className="px-3 py-1.5 text-dim">{s.transport}</td>
      <td className="px-3 py-1.5">{s.tool_list_digest ? <DigestChip digest={s.tool_list_digest} label="Pinned tool-list digest" /> : <span className="text-[11px] text-ghost">{s.builtin ? "built in" : "none"}</span>}</td>
      <td className="px-3 py-1.5 font-mono text-[10.5px] text-faint">{s.tools.join(", ")}</td>
    </tr>
  );
}

function PeerRow({ p }: { p: BomPeer }) {
  return (
    <tr className="border-b border-line align-top last:border-0">
      <td className="px-3 py-1.5 text-fg">{p.name}</td>
      <td className="px-3 py-1.5">
        <Status tone={p.status === "approved" ? "ok" : "warn"}>{p.registered ? p.status : "not registered"}</Status>
      </td>
      <td className="px-3 py-1.5 font-mono text-[10.5px] text-faint">{p.url}</td>
      <td className="px-3 py-1.5">{p.card_digest ? <DigestChip digest={p.card_digest} label="Card digest" /> : <span className="text-[11px] text-ghost">none</span>}</td>
      <td className="px-3 py-1.5"><ClassTag value={p.effective_max_data_class} none="no limit declared" /></td>
    </tr>
  );
}

/** The BOM. Presentational. */
export function BomView({ bom }: { bom: AiBom }) {
  const b = bom;
  const unclassed = b.tools.filter((t) => !t.data_class && !t.sources.length && !t.sink).length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-dim">
        <span className="text-[13px] font-semibold text-fg">{b.name}</span>
        <Tag>{b.autonomy}</Tag>
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
          { k: "peers", v: b.count.peers },
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
                  <th className="px-3 py-1.5 font-medium">Sources and peers</th>
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
                          {t.peers.map((p) => (
                            <span key={p.name} className="flex items-center gap-1.5 text-[11px] text-dim">
                              {p.name}, takes up to <ClassTag value={p.max_data_class} none="no limit declared" />
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

      {b.peers.length > 0 && (
        <Section title="Peers" hue="peer" meta="with their card digests">
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="w-full min-w-[620px] border-collapse text-[11.5px]">
              <thead>
                <tr className="border-b border-line bg-raise/40 text-left text-[10.5px] text-faint">
                  <th className="px-3 py-1.5 font-medium">Peer</th>
                  <th className="px-3 py-1.5 font-medium">Status</th>
                  <th className="px-3 py-1.5 font-medium">URL</th>
                  <th className="px-3 py-1.5 font-medium">Card</th>
                  <th className="px-3 py-1.5 font-medium">Takes up to</th>
                </tr>
              </thead>
              <tbody>
                {b.peers.map((p) => (
                  <PeerRow key={p.id || p.name} p={p} />
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title="Templates and digests" hue="ledger">
        {b.templates.cut_from ? (
          <p className="text-[11.5px] text-dim">
            Cut from{" "}
            <Link href="/templates" className="focusable rounded-sm font-mono hover:underline">
              {String(b.templates.cut_from.template ?? "")}
            </Link>{" "}
            ({String(b.templates.cut_from.template_digest ?? "")}).
          </p>
        ) : (
          <p className="text-[11.5px] text-faint">Not cut from a template.</p>
        )}
        {b.templates.made.length > 0 && <p className="text-[11.5px] text-faint">{b.templates.made.length} template{b.templates.made.length === 1 ? "" : "s"} made from it.</p>}
        <JsonDetails label="Every digest" value={b.digests} />
      </Section>
    </div>
  );
}

function BomPage() {
  const params = useSearchParams();
  const router = useRouter();
  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  /** The registry did not answer: a quiet console says it is not connected, never that no agent is saved. */
  const [agentsDown, setAgentsDown] = useState(false);
  const [versions, setVersions] = useState<VersionView[]>([]);
  const [bom, setBom] = useState<AiBom | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  /** The agent this tab is open on; with none named the page offers the choice and reads nothing. */
  const agent = params.get("agent") ?? "";
  const version = params.get("version");
  const versionNumber = version ? Number(version) : undefined;
  const load = useCallback(() => {
    if (!agent) return;
    getBom(agent, versionNumber)
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
      .catch(() => {
        setAgents([]);
        setAgentsDown(true);
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
          Choose an agent to read what it is made of: its models and routes, its tools with their data classes, the servers and peers behind them, and the digest of each.
        </ChooseAgentHeader>
        {agentsDown ? (
          QUIET ? (
            <QuietNote />
          ) : (
            <p className="text-[12.5px] text-err">The agents could not be read.</p>
          )
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

  const quietDown = QUIET && agentsDown && !bom;
  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7">
      <AgentHeader
        tab="bom"
        id={agent}
        agent={agents?.find((a) => a.id === agent) ?? null}
        actions={
          <Button
            size="sm"
            variant="solid"
            tone="neutral"
            disabled={!bom}
            loading={saving}
            onClick={async () => {
              setSaving(true);
              try {
                saveFile(await downloadCycloneDx(agent, versionNumber));
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            Download CycloneDX
          </Button>
        }
      >
        What this agent is made of: its models and routes, its tools with their data classes, the servers and peers behind them, and the digest of each.
      </AgentHeader>
      {quietDown && <QuietNote />}
      {!quietDown && (
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
          {bom && <BomView bom={bom} />}
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
