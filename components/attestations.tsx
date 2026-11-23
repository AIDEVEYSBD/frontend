"use client";
import { Failure } from "./pending";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Status, Tag } from "./ui";
import { Banner } from "./overlays";
import { Field, Switch, Textarea } from "./forms";
import { Pick } from "./select";
import { DigestChip } from "./digest-chip";
import { SpecDiffView } from "./versions";
import { Figures, Section } from "./section";
import { GroupHeader } from "./page-tabs";
import { soon } from "@/lib/soon";
import { useSession } from "@/lib/use-session";
import { api, errorText } from "@/lib/api/client";
import { listAgents, type AgentSummary } from "@/lib/api/l2";
import { attestAgent, listAttestations, listStandings, type Attestation, type AttestationList, type Standing, type Standings } from "@/lib/api/l9";
import { attestationLine, deployedNote, diffLine, dueLine, mayAttest, ownerLine, standingState } from "@/lib/attestations";
import { whenText } from "@/lib/lifecycle";
import { isPlatformAdmin } from "@/lib/permissions";
import { diffSections, type VersionView } from "@/lib/versions";

/**
 * Owner attestations (phase 8). An agent's owner says, on the record, that it
 * still does what was approved. Each attestation names the version and carries
 * what changed in the definition since the last one, so the owner reads a diff
 * rather than a blank form. Deployed agents fall due on the period the
 * deployment sets (ATTESTATION_PERIOD_DAYS, 90 days unless set otherwise); an
 * L5 tier requires one within 30 days before a production deploy. Overdue ones
 * are listed first. Only the owner or a platform admin attests. The doors are
 * lib/api/l9.ts, the words lib/attestations.ts.
 */

const standingHref = (agent: string) => `/attestations?agent=${encodeURIComponent(agent)}`;

/** Every deployed agent's standing. Presentational. */
export function StandingsTable({ rows, selected }: { rows: Standing[]; selected?: string | null }) {
  if (!rows.length) return <p className="text-[12px] text-faint">No agent is deployed, so nothing is due. An attestation is due from an agent&rsquo;s first production deploy.</p>;
  return (
    <div className="af-list af-list-tall overflow-x-auto rounded-md border border-line">
      <table className="w-full min-w-[760px] border-collapse text-[11.5px]">
        <thead>
          <tr className="border-b border-line bg-raise/40 text-left text-[10.5px] text-faint">
            <th className="px-3 py-1.5 font-medium">Agent</th>
            <th className="px-3 py-1.5 font-medium">Standing</th>
            <th className="px-3 py-1.5 font-medium">Owner</th>
            <th className="px-3 py-1.5 font-medium">Last attested</th>
            <th className="px-3 py-1.5 font-medium">Due</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const s = standingState(r);
            return (
              <tr key={r.agent} className={`border-b border-line align-top last:border-0 ${selected === r.agent ? "bg-raise/50" : ""}`}>
                <td className="px-3 py-1.5">
                  <Link href={standingHref(r.agent)} className="focusable rounded-sm font-medium text-fg hover:underline">
                    {r.agent}
                  </Link>
                  {r.deployed && <span className="block text-[10.5px] text-faint">production runs version {r.deployed.version ?? "?"}</span>}
                </td>
                <td className="px-3 py-1.5">
                  <Status tone={s.tone}>{s.label}</Status>
                </td>
                <td className="px-3 py-1.5 text-dim">{r.owner.owner || "none on record"}</td>
                <td className="px-3 py-1.5 text-dim">{r.last ? attestationLine(r.last) : "never"}</td>
                <td className="px-3 py-1.5 whitespace-nowrap text-faint">
                  {whenText(r.due_at) || "not yet"} · every {r.period_days} d
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One attestation with what changed since the last. Presentational. */
export function AttestationRow({ a }: { a: Attestation }) {
  const note = deployedNote(a);
  const sections = useMemo(() => (a.diff ? diffSections(a.diff) : []), [a.diff]);
  return (
    <li className="flex flex-col gap-1.5 border-b border-line px-3 py-2.5 last:border-b-0">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold text-fg">{attestationLine(a)}</span>
        <DigestChip digest={a.digest} label="Attested digest" />
        {note && <Tag tone={note.tone}>{note.text}</Tag>}
      </span>
      <p className="text-[12px] leading-[1.55] text-dim">{a.statement}</p>
      <p className="text-[11px] text-faint">{diffLine(a)}</p>
      {a.diff && !a.diff.same && (
        <div className="overflow-hidden rounded-md border border-line">
          <SpecDiffView fromLabel={`Version ${a.diff.from.version ?? "?"}`} toLabel={`Version ${a.diff.to.version ?? "?"}`} shown={{ diff: a.diff, error: "" }} sections={sections} />
        </div>
      )}
    </li>
  );
}

function versionChoices(versions: VersionView[]): { value: string; label: string }[] {
  return [...versions].reverse().map((v) => ({ value: v.digest, label: `Version ${v.version}${v.deployed ? " (production)" : ""}` }));
}

/** The owner's word: a statement about one version. */
function AttestForm({ agent, list, onDone }: { agent: string; list: AttestationList; onDone: (a: Attestation) => void }) {
  const { session } = useSession();
  const [versions, setVersions] = useState<VersionView[]>([]);
  const [digest, setDigest] = useState("");
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let stop = false;
    api
      .GET("/api/agents/{agent}/versions", { params: { path: { agent } } })
      .then(({ data, error: err, response }) => {
        if (stop) return;
        if (!data) return setError(errorText(err, response));
        setVersions(data.versions);
      })
      .catch((e: Error) => !stop && setError(e.message));
    return () => {
      stop = true;
    };
  }, [agent]);
  const choices = versionChoices(versions);
  const chosen = digest || versions.find((v) => v.deployed)?.digest || choices[0]?.value || "";
  // The platform lets a platform admin attest for the owner; the shared helper knows that role under an older name.
  const owner = mayAttest(session, list.owner);
  const may = owner.may || isPlatformAdmin(session?.appRoles);
  const why = owner.why;
  const attest = async () => {
    setBusy(true);
    setError("");
    try {
      const a = await attestAgent(agent, { statement: statement.trim(), digest: chosen });
      setStatement("");
      onDone(a);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-3">
      <div className="grid gap-3 md:grid-cols-[240px_minmax(0,1fr)]">
        <Field label="Version">
          <Pick value={chosen} onChange={setDigest} options={choices} disabled={!choices.length} />
        </Field>
        <Field label="Statement" hint="what you are attesting to; it stays on the record">
          <Textarea rows={2} value={statement} onChange={setStatement} disabled={!may} placeholder="It still does what was approved" />
        </Field>
      </div>
      <span className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="solid" tone="ink" permission="deploy" disabled={!may || !chosen || !statement.trim()} loading={busy} onClick={attest}>
          Attest
        </Button>
        {!may && <span className="text-[11px] text-faint">{why}.</span>}
        {error && (<span className="text-[11.5px] text-err">{error}</span>)}
      </span>
    </div>
  );
}

function AgentAttestations({ agent, onChanged }: { agent: string; onChanged: () => void }) {
  const [list, setList] = useState<AttestationList | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    listAttestations(agent)
      .then((l) => {
        setList(l);
        setError("");
      })
      .catch((e) => setError((e as Error).message));
  }, [agent]);
  useEffect(() => soon(load), [load]);
  return (
    <Section title={agent} hue="approvals" meta={list ? `${list.count} on record` : error ? "not read" : "reading…"}>
      {error && <Failure what="This agent's attestations could not be read" message={error} />}
      {list && (
        <>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-dim">
            <span>Owner: {ownerLine(list.owner)}</span>
            <span className={list.overdue ? "text-err" : ""}>{dueLine(list)}</span>
          </span>
          {list.attestations.length ? (
            <ul className="flex flex-col overflow-hidden rounded-md border border-line">
              {list.attestations.map((a) => (
                <AttestationRow key={a.id} a={a} />
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-faint">Nobody has attested this agent yet.</p>
          )}
          <AttestForm
            agent={agent}
            list={list}
            onDone={() => {
              load();
              onChanged();
            }}
          />
        </>
      )}
    </Section>
  );
}

function AttestationsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const agent = params.get("agent");
  const [standings, setStandings] = useState<Standings | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  /** Why the agents were not read: the agent picker says so, never offering an empty list as the estate's. */
  const [agentsError, setAgentsError] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    listStandings()
      .then((s) => {
        setStandings(s);
        setError("");
      })
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => soon(load), [load]);
  useEffect(() => {
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
  const rows = (standings?.agents ?? []).filter((r) => !overdueOnly || r.overdue);
  const never = (standings?.agents ?? []).filter((r) => !r.last).length;
  // The attestations door did not answer: the failure is shown once above, and every figure and table says it was not read.
  const quietDown = Boolean(error) && !standings;
  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7">
      <GroupHeader group="assurance" tab="attestations">
        Each deployed agent&rsquo;s owner says, on a schedule, that it still does what was approved. The record carries what changed in its definition since the last time; overdue attestations are listed first.
      </GroupHeader>
      {error && (
        <Banner tone="err" title="Could not read the attestations">
          {error}
        </Banner>
      )}
      <>
      {quietDown && <Figures items={["deployed agents", "overdue", "never attested"].map((k) => ({ k, v: <span className="flex h-[15px] items-center text-[12px] font-normal text-faint">Not read</span> }))} />}
      {standings && (
        <Figures
          items={[
            { k: "deployed agents", v: standings.count },
            { k: "overdue", v: standings.overdue },
            { k: "never attested", v: never },
          ]}
        />
      )}
      <Section
        title="Standing"
        hue="approvals"
        meta="every deployed agent, overdue first"
        action={<Switch label="Overdue only" checked={overdueOnly} onChange={setOverdueOnly} />}
      >
        {standings ? (
          <StandingsTable rows={[...rows].sort((a, b) => Number(b.overdue) - Number(a.overdue))} selected={agent} />
        ) : quietDown ? (
          <>
            <p className="text-[12px] text-faint">Not read.</p>
          </>
        ) : (
          <p className="text-[12px] text-faint">Reading…</p>
        )}
      </Section>
      <div className="w-full max-w-sm">
        <Field label="An agent" hint="any saved agent, deployed or not" error={agentsError ? `the agents could not be read, so none can be picked: ${agentsError}` : undefined}>
          <Pick value={agent ?? ""} onChange={(v) => router.push(v ? standingHref(v) : "/attestations")} options={[{ value: "", label: "Pick one" }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} />
        </Field>
      </div>
      {agent && <AgentAttestations key={agent} agent={agent} onChanged={load} />}
      </>
    </div>
  );
}

export function AttestationsView() {
  return (
    <Suspense>
      <AttestationsPage />
    </Suspense>
  );
}
