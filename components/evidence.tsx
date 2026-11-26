"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button, Mono, Tag } from "./ui";
import { Banner } from "./overlays";
import { Field, Input } from "./forms";
import { Pick } from "./select";
import { ControlMark, ControlRef } from "./control-ref";
import { DigestChip } from "./digest-chip";
import { Section } from "./section";
import { GroupHeader } from "./page-tabs";
import { ChainStatus } from "./chain";
import { soon } from "@/lib/soon";
import { listAgents, type AgentSummary } from "@/lib/api/l2";
import { getControls, saveFile, type ControlsCatalogue } from "@/lib/api/l9";
import { downloadEvidence, getEvidence, listFrameworks, type EvidencePack, type FrameworkInfo } from "@/lib/api/assurance";
import { EMPTY_PACK_FORM, decisionLine, noFiringLine, packChainLine, packLine, packProblem, packQuery, periodLine, stampLine, type PackForm } from "@/lib/assurance-words";
import { whenText } from "@/lib/lifecycle";

/**
 * Evidence packs: what an assessor asks for. For a control or a framework's
 * controls, over a period, optionally for one agent: the firings, the signed
 * decisions on its gates (each digest checked again, each checked against the
 * chain), the definitions the cited runs ran and each control's enforcement as
 * read now, the identities that acted, and the chain of every run cited. The
 * pack reads here as JSON and downloads as a zip with a manifest and a SHA-256
 * per file; each cited run's journal is inside as stored, with every field its
 * hash covers, so a verifier can recompute the chain from the zip alone. A pack
 * is read on request, never polled. The doors are lib/api/assurance.ts.
 */

function Rows({ head, children, min = 720 }: { head: string[]; children: React.ReactNode; min?: number }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full border-collapse text-[11.5px]" style={{ minWidth: min }}>
        <thead>
          <tr className="border-b border-line bg-raise/40 text-left text-[10.5px] text-faint">
            {head.map((h) => (
              <th key={h} className="px-3 py-1.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** A run, by id. With `entry`, the link opens the run on that journal entry, marked. */
const Run = ({ run, entry }: { run: string; entry?: string }) => (
  <Link
    href={`/runs?id=${encodeURIComponent(run)}${entry ? `&entry=${encodeURIComponent(entry)}` : ""}`}
    title={entry ? `Open the run at entry ${entry}` : undefined}
    className="focusable rounded-sm font-mono text-[10.5px] text-dim hover:underline"
  >
    {run}
  </Link>
);

/** The pack as an assessor reads it. Presentational. */
export function EvidencePackView({ pack }: { pack: EvidencePack }) {
  const p = pack;
  const chain = packChainLine(p.chain);
  const notBuilt = Object.entries(p.not_built);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11px] text-faint">
        {packLine(p)} · {periodLine(p.pack)}
        {p.pack.agent ? ` · ${p.pack.agent}` : ""} · built by {p.pack.generated_by}
      </p>
      {p.pack.framework && !p.controls.length && (
        <Banner tone="warn" title={`No control is mapped to ${p.pack.framework}`} />
      )}
      <Banner tone={chain.tone} title={chain.title}>
        {chain.line || p.chain.broken.length ? (
          <>
            {chain.line}
            {p.chain.broken.map((b) => (
              <span key={b.run} className="mt-1 block font-mono text-[10.5px] break-words">
                {b.run}: {b.reason}
              </span>
            ))}
          </>
        ) : undefined}
      </Banner>
      {p.truncated && (
        <Banner tone="warn" title="This pack lists only the first firings">
          Narrow the period or name an agent to list the rest.
        </Banner>
      )}

      {p.controls.length > 0 && (
        <Section title="Controls" hue="control" meta={`${p.controls.length} in the pack`}>
          <ul className="flex flex-col gap-2">
            {p.controls.map((c) => {
              const enforced = p.policy.platform.find((x) => x.control === c.id);
              return (
                <li key={c.id} className="flex flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <ControlRef control={c.id} />
                    <span className="text-[12px] font-semibold text-fg">{c.title}</span>
                    {enforced && (
                      <span className="inline-flex">
                        <Tag tone={enforced.state === "enforced" ? "ok" : enforced.state === "partly" ? "warn" : "err"}>{enforced.state ? enforced.state.replace("_", " ") : "enforcement unknown"}</Tag>
                      </span>
                    )}
                  </span>
                  <span className="text-[11.5px] leading-[1.5] text-dim">{c.statement}</span>
                </li>
              );
            })}
          </ul>
          {p.policy.platform_as_of && <p className="text-[10.5px] text-faint">Enforcement is {p.policy.platform_as_of}.</p>}
        </Section>
      )}

      <Section title="Firings" hue="control" meta={Object.entries(p.counts.by_key).map(([k, n]) => `${k} ${n}`).join(" · ") || "none"}>
        {p.firings.length ? (
          <Rows head={["When", "Run", "Control", "What", "Detail"]}>
            {p.firings.map((f) => (
              <tr key={`${f.entry}:${f.key}`} className="border-b border-line align-top last:border-0">
                <td className="px-3 py-1.5 whitespace-nowrap text-faint">{whenText(f.at)}</td>
                <td className="px-3 py-1.5">
                  <span className="block text-fg">{f.agent}</span>
                  <Run run={f.run} entry={f.entry} />
                </td>
                <td className="px-3 py-1.5">{f.control_ids.length ? f.control_ids.map((c) => <ControlRef key={c} control={c} />) : <ControlMark control={f.key} />}</td>
                <td className="px-3 py-1.5 text-fg">
                  {f.title}
                  <span className="block font-mono text-[10px] text-ghost">
                    {f.kind}
                    {f.node ? ` · ${f.node}` : ""}
                  </span>
                </td>
                <td className="max-w-[420px] px-3 py-1.5 leading-[1.5] break-words text-dim">{f.detail}</td>
              </tr>
            ))}
          </Rows>
        ) : (
          <p className="text-[12px] text-faint">{noFiringLine(p)}</p>
        )}
      </Section>

      <Section title="Signed decisions" hue="approvals" meta="gates of these controls answered in the period">
        {p.decisions.length ? (
          <Rows head={["Run", "Decision", "Controls", "Record"]}>
            {p.decisions.map((d) => (
              <tr key={d.digest || `${d.run}:${d.gate}`} className="border-b border-line align-top last:border-0">
                <td className="px-3 py-1.5">
                  <span className="block text-fg">{d.agent}</span>
                  <Run run={d.run} entry={d.entry || d.gate} />
                </td>
                <td className="max-w-[420px] px-3 py-1.5 leading-[1.5] text-dim">{decisionLine(d)}</td>
                <td className="px-3 py-1.5">
                  <span className="flex flex-wrap gap-1">{d.control_ids.length ? d.control_ids.map((c) => <ControlRef key={c} control={c} />) : d.controls.map((c) => <Tag key={c}>{c}</Tag>)}</span>
                </td>
                <td className="px-3 py-1.5">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Tag tone={d.digest_holds ? "ok" : "err"}>{d.digest_holds ? "digest holds" : "digest does not match"}</Tag>
                    <Tag tone={d.chained ? "ok" : "err"}>{d.chained ? "on the chain" : "not on the chain"}</Tag>
                    {d.digest && <DigestChip digest={d.digest} label="Decision digest" />}
                  </span>
                  <span className="mt-0.5 block text-[10.5px] text-ghost">{stampLine(d)}</span>
                </td>
              </tr>
            ))}
          </Rows>
        ) : (
          <p className="text-[12px] text-faint">No gate of these controls was answered in the period.</p>
        )}
      </Section>

      <Section title="Definitions run" hue="guardrail" meta="the definition each cited run ran">
        {p.policy.versions.length > 0 ? (
          <Rows head={["Agent", "Version", "Digest", "Saved"]} min={620}>
            {p.policy.versions.map((v) => (
              <tr key={`${v.agent}:${v.digest}`} className="border-b border-line align-top last:border-0">
                <td className="px-3 py-1.5 text-fg">{v.agent}</td>
                <td className="px-3 py-1.5 text-dim">
                  {v.draft ? "a draft, never saved as a version" : v.version}
                  {v.deployed && <span className="text-faint"> · deployed now</span>}
                </td>
                <td className="px-3 py-1.5">
                  <DigestChip digest={v.digest} label="Definition digest" />
                </td>
                <td className="px-3 py-1.5 text-faint">{v.draft ? "" : `${whenText(v.saved_at)} by ${v.saved_by}`}</td>
              </tr>
            ))}
          </Rows>
        ) : (
          <p className="text-[12px] text-faint">No run is cited, so no definition is.</p>
        )}
        {notBuilt.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-[11px] leading-[1.5] text-faint">
            {notBuilt.map(([k]) => (
              <li key={k}>
                <Mono className="text-[10.5px]">{k}</Mono>: Not built
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Policy changes" hue="guardrail" meta="changes that moved in the period">
        {p.policy.changes.length > 0 ? (
          <Rows head={["Change", "Target", "State", "Proposed", "Approved", "Applied or ended"]} min={820}>
            {p.policy.changes.map((c) => (
              <tr key={c.id} className="border-b border-line align-top last:border-0">
                <td className="px-3 py-1.5">
                  <Mono className="text-[10.5px] text-fg">{c.id}</Mono>
                  {c.emergency && <span className="ml-1 text-[10.5px] text-warn">emergency</span>}
                  {c.rollback_of && <span className="block text-[10.5px] text-faint">rolls back {c.rollback_of}</span>}
                  {c.reason && <span className="block max-w-[40ch] text-[10.5px] text-faint">{c.reason}</span>}
                </td>
                <td className="px-3 py-1.5 text-dim">{c.target.id === "estate" ? "every agent" : `${c.target.kind} ${c.target.id}`}</td>
                <td className="px-3 py-1.5 text-dim">{c.state.replace(/_/g, " ")}</td>
                <td className="px-3 py-1.5 text-faint">{whenText(c.proposed_at)}{c.proposed_by ? ` by ${c.proposed_by}` : ""}</td>
                <td className="px-3 py-1.5 text-faint">{c.approved_at ? `${whenText(c.approved_at)}${c.approved_by ? ` by ${c.approved_by}` : ""}` : c.rejected_at ? `rejected ${whenText(c.rejected_at)}${c.rejected_by ? ` by ${c.rejected_by}` : ""}` : "not approved"}</td>
                <td className="px-3 py-1.5 text-faint">{c.rolled_back_at ? `rolled back ${whenText(c.rolled_back_at)}` : c.applied_at ? `applied ${whenText(c.applied_at)}` : "not applied"}</td>
              </tr>
            ))}
          </Rows>
        ) : (
          <p className="text-[12px] text-faint">No policy change moved in the period.</p>
        )}
      </Section>

      <Section title="Deployments" hue="guardrail" meta="every deployment and rollback made in the period">
        {p.policy.deployments.length > 0 ? (
          <Rows head={["Agent", "Version", "Kind", "By", "Gate conditions"]} min={760}>
            {p.policy.deployments.map((d) => (
              <tr key={d.id} className="border-b border-line align-top last:border-0">
                <td className="px-3 py-1.5 text-fg">
                  {d.agent}
                  <span className="block text-[10.5px] text-faint">{d.environment}</span>
                </td>
                <td className="px-3 py-1.5 text-dim">
                  {d.version ?? "not recorded"} {d.digest && <DigestChip digest={d.digest} label="Definition digest" />}
                </td>
                <td className="px-3 py-1.5 text-dim">
                  {d.kind}
                  {d.reason && <span className="block max-w-[34ch] text-[10.5px] text-faint">{d.reason}</span>}
                </td>
                <td className="px-3 py-1.5 text-faint">{d.by || "not recorded"}, {whenText(d.at)}</td>
                <td className="px-3 py-1.5 text-faint">
                  {d.conditions.length
                    ? d.conditions.map((c) => `${c.condition}: ${c.holds === true ? "held" : c.holds === false ? "did not hold" : "not judged"}`).join("; ")
                    : "none recorded"}
                </td>
              </tr>
            ))}
          </Rows>
        ) : (
          <p className="text-[12px] text-faint">No deployment or rollback was made in the period.</p>
        )}
        {p.policy.truncated && <p className="text-[11px] text-warn">Only the newest are listed.</p>}
      </Section>

      <Section title="Identities" hue="identity" meta="who acted, as what">
        {p.identities.length ? (
          <ul className="flex flex-col gap-1">
            {p.identities.map((i) => (
              <li key={i.identity} className="flex flex-wrap items-center gap-2 text-[11.5px]">
                <span className="font-medium text-fg">{i.identity}</span>
                <span className="text-dim">{i.acted_as.join(", ")}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-faint">Nobody acted on this in the period.</p>
        )}
      </Section>

      <Section title="Runs cited" hue="ledger">
        {p.runs.length ? (
          <Rows head={["Run", "State", "Chain", "Last hash", "Started"]}>
            {p.runs.map((r) => (
              <tr key={r.id} className="border-b border-line align-top last:border-0">
                <td className="px-3 py-1.5">
                  <span className="block text-fg">{r.agent}</span>
                  <Run run={r.id} />
                </td>
                <td className="px-3 py-1.5 text-dim">{r.state}</td>
                <td className="max-w-[360px] px-3 py-1.5">
                  <ChainStatus chain={r.chain} />
                  {r.reason && <span className="block text-[10.5px] leading-[1.5] break-words text-faint">{r.reason}</span>}
                </td>
                <td className="px-3 py-1.5">{r.anchor ? <DigestChip digest={r.anchor} label="Last hash" /> : <span className="text-[11px] text-ghost">none</span>}</td>
                <td className="px-3 py-1.5 whitespace-nowrap text-faint">{whenText(r.started_at)}</td>
              </tr>
            ))}
          </Rows>
        ) : (
          <p className="text-[12px] text-faint">No run is cited.</p>
        )}
      </Section>
    </div>
  );
}


function EvidencePage() {
  const params = useSearchParams();
  const [catalogue, setCatalogue] = useState<ControlsCatalogue | null>(null);
  const [frameworkList, setFrameworkList] = useState<FrameworkInfo[] | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  /** Why the agents were not read: the agent picker says so, never offering an empty list as the estate's. */
  const [agentsError, setAgentsError] = useState("");
  const [form, setForm] = useState<PackForm>(() => ({ ...EMPTY_PACK_FORM, control: params.get("control") ?? "", framework: params.get("framework") ?? "", agent: params.get("agent") ?? "" }));
  const [pack, setPack] = useState<EvidencePack | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const edit = (patch: Partial<PackForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setSaved("");
  };
  const problem = packProblem(form);
  const build = useCallback((f: PackForm) => {
    setBusy(true);
    setError("");
    getEvidence(packQuery(f))
      .then(setPack)
      .catch((e) => {
        setPack(null);
        setError((e as Error).message);
      })
      .finally(() => setBusy(false));
  }, []);
  useEffect(() => {
    getControls()
      .then(setCatalogue)
      .catch((e) => setLoadError((e as Error).message));
    listFrameworks()
      .then(setFrameworkList)
      .catch((e) => setLoadError((e as Error).message));
    listAgents()
      .then((a) => {
        setAgents(a);
        setAgentsError("");
      })
      .catch((e) => {
        setAgents([]);
        setAgentsError((e as Error).message);
      });
  }, []);
  // A link names what it wants: read it once.
  useEffect(() => {
    if (!packProblem(form)) return soon(() => build(form));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const download = async () => {
    setSaving(true);
    setError("");
    try {
      const f = await downloadEvidence(packQuery(form));
      saveFile(f);
      setSaved(f.sha256 ? `Saved ${f.filename} · manifest SHA-256 ${f.sha256}` : `Saved ${f.filename}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const controls = useMemo(() => [{ value: "", label: "No single control" }, ...(catalogue?.controls ?? []).map((c) => ({ value: c.id, label: `${c.id} · ${c.title}` }))], [catalogue]);
  const frameworks = useMemo(() => [{ value: "", label: "No framework" }, ...(frameworkList ?? []).map((f) => ({ value: f.id, label: f.short }))], [frameworkList]);
  const picked = frameworkList?.find((f) => f.id === form.framework);
  // A catalogue that did not answer: the failure is shown above, and the form says it was not read.
  const quietDown = Boolean(loadError) && !catalogue;
  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7">
      <GroupHeader group="assurance" tab="evidence">
        An assessor&rsquo;s pack for a control or framework over a period.
      </GroupHeader>
      {loadError && (
        <Banner tone="err" title="Could not read the controls or the frameworks">
          {loadError}
        </Banner>
      )}
      <>
      <Section title="Build a pack" hue="control" meta={catalogue ? `${catalogue.count} controls · ${frameworkList ? `${frameworkList.length} frameworks` : "frameworks not read"}` : quietDown ? "the catalogue was not read" : "reading the catalogue…"}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Control">
            <Pick value={form.control} onChange={(v) => edit({ control: v })} options={controls} />
          </Field>
          <Field label="Or a control key" hint="a journal key the catalogue does not map">
            <Input mono value={form.key} onChange={(v) => edit({ key: v })} />
          </Field>
          <Field label="Framework" hint={picked && !picked.obligations.length ? "No controls are mapped to it." : undefined}>
            <Pick value={form.framework} onChange={(v) => edit({ framework: v })} options={frameworks} />
          </Field>
          <Field label="From" hint="default: 30 days back">
            <Input type="datetime-local" value={form.from} onChange={(v) => edit({ from: v })} />
          </Field>
          <Field label="To" hint="default: now">
            <Input type="datetime-local" value={form.to} onChange={(v) => edit({ to: v })} />
          </Field>
          <Field label="Agent" error={agentsError ? `the agents could not be read: ${agentsError}` : undefined}>
            <Pick value={form.agent} onChange={(v) => edit({ agent: v })} options={[{ value: "", label: "The whole estate" }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} />
          </Field>
        </div>
        <span className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="solid" tone="ink" disabled={Boolean(problem)} loading={busy} onClick={() => build(form)}>
            Build pack
          </Button>
          <Button size="sm" variant="solid" tone="neutral" disabled={Boolean(problem)} loading={saving} onClick={download}>
            Download zip
          </Button>
          {problem && <span className="text-[11px] text-faint">{problem}</span>}
          {saved && <Mono className="text-[10.5px] break-all text-faint">{saved}</Mono>}
          {error && (<span className="text-[11.5px] text-err">{error}</span>)}
        </span>
      </Section>
      {pack ? (
        <EvidencePackView pack={pack} />
      ) : (
        !busy && !error && <p className="text-[12px] text-faint">Name a control or a framework to build a pack.</p>
      )}
      </>
    </div>
  );
}

export function EvidenceView() {
  return (
    <Suspense>
      <EvidencePage />
    </Suspense>
  );
}

