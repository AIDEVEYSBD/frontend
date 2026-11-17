"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button, Mono, Tag } from "./ui";
import { Banner, QuietNote } from "./overlays";
import { QUIET } from "@/lib/quiet";
import { Field, Input } from "./forms";
import { Pick } from "./select";
import { ControlMark, ControlRef } from "./control-ref";
import { DigestChip } from "./digest-chip";
import { Section } from "./section";
import { GroupHeader } from "./page-tabs";
import { ChainStatus } from "./chain";
import { soon } from "@/lib/soon";
import { listAgents, type AgentSummary } from "@/lib/api/l2";
import { downloadEvidence, getControls, getEvidence, saveFile, type ControlsCatalogue, type EvidencePack } from "@/lib/api/l9";
import { packChainLine } from "@/lib/chain";
import { EMPTY_PACK_FORM, decisionLine, noFiringLine, packLine, packProblem, packQuery, periodLine, stampLine, type PackForm } from "@/lib/evidence";
import { whenText } from "@/lib/lifecycle";
import { CHANGE_STATE_META, targetLine } from "@/lib/policy";

/**
 * Evidence packs (phase L9): what an assessor asks for. For a control or a
 * framework's controls, over a period, optionally for one agent: the control's
 * firings, the signed decisions on its gates, the policy versions and changes
 * in force, the identities that acted, and the chain verification of every run
 * cited. The pack reads here as JSON and downloads as a zip with a manifest and
 * a SHA-256 per file, each cited record inside, so a verifier can walk the
 * chain from the zip alone. A pack is read on request, never polled: building
 * one walks every record in the period.
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
  return (
    <div className="flex flex-col gap-4">
      <p className="text-[11px] text-faint">
        {packLine(p)} · {periodLine(p.pack)}
        {p.pack.agent ? ` · ${p.pack.agent}` : ""} · built by {p.pack.generated_by}
      </p>
      {p.pack.framework && !p.controls.length && (
        <Banner tone="warn" title={`No control is mapped to ${p.pack.framework}`}>
          So this pack holds nothing about it, and cannot be read as meeting it.
        </Banner>
      )}
      <Banner tone={chain.tone} title={chain.title}>
        {p.chain.reason ? `${chain.line} ${p.chain.reason}.` : chain.line}
        {p.chain.broken.map((b) => (
          <span key={b.run} className="mt-1 block font-mono text-[10.5px] break-words">
            {b.run}: {b.reason}
          </span>
        ))}
      </Banner>
      {p.truncated && (
        <Banner tone="warn" title="This pack was cut short">
          The period holds more than a pack carries: narrow it or name an agent.
        </Banner>
      )}

      {p.controls.length > 0 && (
        <Section title="Controls" hue="control" meta={`${p.controls.length} in the pack`}>
          <ul className="flex flex-col gap-2">
            {p.controls.map((c) => (
              <li key={c.id} className="flex flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2">
                  <ControlRef control={c.id} />
                  <span className="text-[12px] font-semibold text-fg">{c.title}</span>
                </span>
                <span className="text-[11.5px] leading-[1.5] text-dim">{c.statement}</span>
                <span className="text-[10.5px] leading-[1.5] text-faint">Evidence it leaves: {c.evidence}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Firings" hue="control" meta={Object.entries(p.counts.by_key).map(([k, n]) => `${k} ${n}`).join(" · ") || "none"}>
        {p.firings.length ? (
          <Rows head={["When", "Run", "Control", "What", "Detail"]}>
            {p.firings.map((f) => (
              <tr key={`${f.run}:${f.entry}`} className="border-b border-line align-top last:border-0">
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

      <Section title="Signed decisions" hue="approvals" meta="each answer stamped with the controls that opened the gate">
        {p.decisions.length ? (
          <Rows head={["Run", "Decision", "Controls", "Digest"]}>
            {p.decisions.map((d) => (
              <tr key={d.digest || `${d.run}:${d.gate}`} className="border-b border-line align-top last:border-0">
                <td className="px-3 py-1.5">
                  <span className="block text-fg">{d.agent}</span>
                  {/* The signed answer's own entry when it is chained, else the gate it answers. */}
                  <Run run={d.run} entry={d.entry || d.gate} />
                </td>
                <td className="max-w-[420px] px-3 py-1.5 leading-[1.5] text-dim">{decisionLine(d)}</td>
                <td className="px-3 py-1.5">
                  <span className="flex flex-wrap gap-1">{d.control_ids.length ? d.control_ids.map((c) => <ControlRef key={c} control={c} />) : d.controls.map((c) => <Tag key={c}>{c}</Tag>)}</span>
                  <span className="mt-0.5 block text-[10.5px] text-ghost">{stampLine(d)}</span>
                </td>
                <td className="px-3 py-1.5">{d.digest ? <DigestChip digest={d.digest} label="Decision digest" /> : <span className="text-[11px] text-ghost">read back from the journal</span>}</td>
              </tr>
            ))}
          </Rows>
        ) : (
          <p className="text-[12px] text-faint">No gate of this control was answered in the period.</p>
        )}
      </Section>

      <Section title="Policy in force" hue="guardrail" meta={`${p.policy.versions.length} versions · ${p.policy.deployments.length} deployments · ${p.policy.changes.length} changes`}>
        {p.policy.versions.length + p.policy.deployments.length + p.policy.changes.length === 0 && <p className="text-[12px] text-faint">No version or policy change touches this period.</p>}
        {p.policy.versions.length > 0 && (
          <Rows head={["Agent", "Version", "Digest", "Saved", "Reviews"]} min={620}>
            {p.policy.versions.map((v) => (
              <tr key={`${v.agent}:${v.digest}`} className="border-b border-line align-top last:border-0">
                <td className="px-3 py-1.5 text-fg">{v.agent}</td>
                <td className="px-3 py-1.5 text-dim">
                  {v.version ?? "?"}
                  {v.deployed && <span className="text-faint"> · deployed</span>}
                </td>
                <td className="px-3 py-1.5">
                  <DigestChip digest={v.digest} label="Spec digest" />
                </td>
                <td className="px-3 py-1.5 text-faint">
                  {whenText(v.saved_at)} by {v.saved_by}
                </td>
                <td className="tnum px-3 py-1.5 text-dim">{v.reviews.length}</td>
              </tr>
            ))}
          </Rows>
        )}
        {p.policy.deployments.length > 0 && (
          <Rows head={["Agent", "Deployment", "Digest", "When"]} min={620}>
            {p.policy.deployments.map((d) => (
              <tr key={d.id} className="border-b border-line align-top last:border-0">
                <td className="px-3 py-1.5 text-fg">{d.agent}</td>
                <td className="px-3 py-1.5 text-dim">
                  {d.kind} of version {d.version ?? "?"} to {d.environment}
                  {d.in_force_at_start && <span className="text-faint"> · in force when the period began</span>}
                </td>
                <td className="px-3 py-1.5">
                  <DigestChip digest={d.digest} label="Deployed digest" />
                </td>
                <td className="px-3 py-1.5 text-faint">
                  {whenText(d.at)} by {d.by}
                </td>
              </tr>
            ))}
          </Rows>
        )}
        {p.policy.changes.length > 0 && (
          <Rows head={["Change", "Target", "What", "Who"]}>
            {p.policy.changes.map((c) => (
              <tr key={c.id} className="border-b border-line align-top last:border-0">
                <td className="px-3 py-1.5">
                  <Link href={`/policy?change=${encodeURIComponent(c.id)}`} className="focusable rounded-sm font-mono text-[10.5px] text-dim hover:underline">
                    {c.id}
                  </Link>
                  {c.emergency && <span className="block text-[10.5px] text-err">emergency rollback</span>}
                </td>
                <td className="px-3 py-1.5 text-dim">{targetLine({ kind: c.target_kind, id: c.target_id })}</td>
                <td className="max-w-[420px] px-3 py-1.5 leading-[1.5] text-dim">
                  {c.summary.join("; ")}
                  <span className="block text-[10.5px] text-faint">
                    {CHANGE_STATE_META[c.state as keyof typeof CHANGE_STATE_META]?.label ?? c.state}
                    {c.in_force_at_start ? " · in force when the period began" : ""}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-faint">
                  {c.proposed_by}
                  {c.approved_by && c.approved_by !== c.proposed_by ? `, approved by ${c.approved_by}` : ""}
                </td>
              </tr>
            ))}
          </Rows>
        )}
      </Section>

      <Section title="Identities" hue="identity" meta="who acted, as what">
        {p.identities.length ? (
          <ul className="flex flex-col gap-1">
            {p.identities.map((i) => (
              <li key={i.identity} className="flex flex-wrap items-center gap-2 text-[11.5px]">
                <span className="font-medium text-fg">{i.identity}</span>
                <span className="text-dim">{i.acted_as.join(", ")}</span>
                <span className="tnum text-[10.5px] text-faint">{i.count}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12px] text-faint">Nobody acted on this in the period.</p>
        )}
      </Section>

      <Section title="Runs cited" hue="ledger" meta={p.excluded.shadow ? `${p.excluded.shadow} shadow runs left out` : undefined}>
        {p.runs.length ? (
          <Rows head={["Run", "State", "Chain", "Anchor", "Started"]}>
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
                <td className="px-3 py-1.5">{r.anchor ? <DigestChip digest={r.anchor} label="Run anchor" /> : <span className="text-[11px] text-ghost">none</span>}</td>
                <td className="px-3 py-1.5 whitespace-nowrap text-faint">{whenText(r.started_at)}</td>
              </tr>
            ))}
          </Rows>
        ) : (
          <p className="text-[12px] text-faint">No run is cited: nothing fired in the period.</p>
        )}
      </Section>
    </div>
  );
}

/** Quiet (lib/quiet.ts): the pack's sections with nothing in them, each saying what it holds. */
function EvidencePackEmpty() {
  const line = (text: string) => <p className="text-[12px] text-faint">{text}</p>;
  return (
    <div className="flex flex-col gap-4">
      <Section title="Firings" hue="control">
        <Rows head={["When", "Run", "Control", "What", "Detail"]}>{null}</Rows>
        {line("Each time the control fired in the period is listed here, with the run and the journal entry.")}
      </Section>
      <Section title="Signed decisions" hue="approvals" meta="each answer stamped with the controls that opened the gate">
        <Rows head={["Run", "Decision", "Controls", "Digest"]}>{null}</Rows>
        {line("The gates a person answered in the period are listed here, each with its digest.")}
      </Section>
      <Section title="Policy in force" hue="guardrail">
        <Rows head={["Agent", "Version", "Digest", "Saved", "Reviews"]} min={620}>{null}</Rows>
        {line("The spec versions, deployments and policy changes that touch the period are listed here.")}
      </Section>
      <Section title="Identities" hue="identity" meta="who acted, as what">
        {line("Everyone who acted in the period is listed here, with the role they acted in.")}
      </Section>
      <Section title="Runs cited" hue="ledger">
        <Rows head={["Run", "State", "Chain", "Anchor", "Started"]}>{null}</Rows>
        {line("Every run the pack cites is listed here with the verification of its chain.")}
      </Section>
    </div>
  );
}

function EvidencePage() {
  const params = useSearchParams();
  const [catalogue, setCatalogue] = useState<ControlsCatalogue | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
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
    listAgents()
      .then(setAgents)
      .catch(() => setAgents([]));
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
      setSaved(f.sha256 ? `Saved ${f.filename}. Manifest SHA-256: ${f.sha256}` : `Saved ${f.filename}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const controls = useMemo(() => [{ value: "", label: "No single control" }, ...(catalogue?.controls ?? []).map((c) => ({ value: c.id, label: `${c.id} · ${c.title}` }))], [catalogue]);
  const frameworks = useMemo(() => [{ value: "", label: "No framework" }, ...(catalogue?.frameworks ?? []).map((f) => ({ value: f.id, label: f.short }))], [catalogue]);
  const picked = catalogue?.frameworks.find((f) => f.id === form.framework);
  // A quiet console (lib/quiet.ts) whose catalogue did not answer says so once; the form and the pack's sections are drawn empty beneath it.
  const quietDown = QUIET && Boolean(loadError) && !catalogue;
  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7">
      <GroupHeader group="assurance" tab="evidence">
        An assessor&rsquo;s pack for a control or a framework over a period: what fired, the signed decisions, the policy in force, who acted, and the chain verification of every run cited. It downloads as a zip with a SHA-256 for each file.
      </GroupHeader>
      {loadError && (
        <Banner tone="err" title="Could not read the controls catalogue">
          {loadError}
        </Banner>
      )}
      <>
      <Section title="Build a pack" hue="control" meta={catalogue ? `${catalogue.count} controls · ${catalogue.frameworks.length} frameworks` : quietDown ? undefined : "reading the catalogue…"}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Control">
            <Pick value={form.control} onChange={(v) => edit({ control: v })} options={controls} />
          </Field>
          <Field label="Or a control key" hint="what the journal names, for one the catalogue does not: lockdown, breaker, rate_limit">
            <Input mono value={form.key} onChange={(v) => edit({ key: v })} />
          </Field>
          <Field label="Framework" hint={picked && !picked.obligations.length ? "nothing is mapped to it: a pack would hold no controls" : undefined}>
            <Pick value={form.framework} onChange={(v) => edit({ framework: v })} options={frameworks} />
          </Field>
          <Field label="From" hint="the door's default is 30 days back">
            <Input type="datetime-local" value={form.from} onChange={(v) => edit({ from: v })} />
          </Field>
          <Field label="To" hint="the default is now">
            <Input type="datetime-local" value={form.to} onChange={(v) => edit({ to: v })} />
          </Field>
          <Field label="Agent">
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
          {error && (QUIET ? <QuietNote inline /> : <span className="text-[11.5px] text-err">{error}</span>)}
        </span>
      </Section>
      {pack ? (
        <EvidencePackView pack={pack} />
      ) : (
        !busy && !error && <p className="text-[12px] text-faint">Name a control or a framework to build a pack.</p>
      )}
      {quietDown && !pack && <EvidencePackEmpty />}
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

