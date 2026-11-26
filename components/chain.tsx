"use client";
import { Failure } from "./pending";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button, Mono, Status } from "./ui";
import { Banner } from "./overlays";
import { Field, Input } from "./forms";
import { Pick } from "./select";
import { DigestChip } from "./digest-chip";
import { Figures, Section } from "./section";
import { GroupHeader } from "./page-tabs";
import { soon } from "@/lib/soon";
import { listAgents, type AgentSummary } from "@/lib/api/l2";
import { getRetention, verifyLedger, verifyRun, type ChainReading, type LedgerVerification, type RetentionView, type RunVerification } from "@/lib/api/assurance";
import { CHAIN_META, ledgerHeadline, ledgerNotes, verifyLine } from "@/lib/assurance-words";
import { whenText } from "@/lib/lifecycle";

/**
 * The hash chain. Every journal entry carries the hash of the one before it,
 * from a genesis bound to the run and its definition, and the run's own row
 * holds the last hash and the count. RunChain is the reading on a run's own
 * page; LedgerView checks every run's chain and the audit trail's, and says
 * where each breaks in the platform's words. Retention sits here too: what is
 * kept, what the sweep removed, and the tombstones it left. The doors are
 * lib/api/assurance.ts, the words lib/assurance-words.ts.
 */

export function ChainStatus({ chain }: { chain: ChainReading }) {
  const m = CHAIN_META[chain];
  return <Status tone={m.tone}>{m.label}</Status>;
}

/** A reading, as the run page shows it. Presentational. */
export function RunChainView({ reading }: { reading: RunVerification }) {
  const r = reading;
  return (
    <div className="flex flex-col gap-1 rounded-md border border-line bg-surface px-3 py-2">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold text-dim">Journal chain</span>
        <ChainStatus chain={r.chain} />
        <span className="text-[10.5px] text-faint">{r.entries} entries</span>
        {r.anchor && <DigestChip digest={r.anchor} label="Last hash verified" />}
        <span className="grow" />
        <Link href={r.agent ? `/ledger?agent=${encodeURIComponent(r.agent)}` : "/ledger"} className="focusable rounded-sm text-[11px] text-faint hover:underline">
          Ledger
        </Link>
      </span>
      <p className={`text-[11px] leading-[1.5] ${r.chain === "broken" ? "text-err" : "text-faint"}`}>{verifyLine(r)}</p>
    </div>
  );
}

/** A run's chain, read from its door. A run still being written is read again when `tick` moves. */
export function RunChain({ run, tick = 0 }: { run: string; tick?: number }) {
  const [reading, setReading] = useState<RunVerification | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!run) return;
    let stop = false;
    verifyRun(run)
      .then((r) => {
        if (stop) return;
        setReading(r);
        setError("");
      })
      .catch((e) => {
        if (!stop) setError((e as Error).message);
      });
    return () => {
      stop = true;
    };
  }, [run, tick]);
  if (error) return <Failure inline what="The chain could not be read" message={error} />;
  return reading ? <RunChainView reading={reading} /> : null;
}

/** The walk, run by run. Presentational. */
export function LedgerWalk({ ledger }: { ledger: LedgerVerification }) {
  if (!ledger.walk.length) return <p className="text-[12px] text-faint">No run was created in this view.</p>;
  return (
    <div className="af-list af-list-tall overflow-x-auto rounded-md border border-line">
      <table className="w-full min-w-[860px] border-collapse text-[11.5px]">
        <thead>
          <tr className="border-b border-line bg-raise/40 text-left text-[10.5px] text-faint">
            <th className="px-3 py-1.5 font-medium">#</th>
            <th className="px-3 py-1.5 font-medium">Run</th>
            <th className="px-3 py-1.5 font-medium">State</th>
            <th className="px-3 py-1.5 font-medium">Reading</th>
            <th className="px-3 py-1.5 font-medium">Entries</th>
            <th className="px-3 py-1.5 font-medium">Last hash</th>
            <th className="px-3 py-1.5 font-medium">Created</th>
          </tr>
        </thead>
        <tbody>
          {ledger.walk.map((r) => (
            <tr key={r.seq} className="border-b border-line align-top last:border-0">
              <td className="tnum px-3 py-1.5 text-dim">{r.seq}</td>
              <td className="px-3 py-1.5">
                <span className="block text-fg">{r.agent}</span>
                <Link href={`/runs?id=${encodeURIComponent(r.run)}`} className="focusable rounded-sm font-mono text-[10.5px] text-dim hover:underline">
                  {r.run}
                </Link>
              </td>
              <td className="px-3 py-1.5 text-dim">{r.state}</td>
              <td className="px-3 py-1.5">
                <ChainStatus chain={r.chain} />
                {r.broken_at !== null && <span className="block text-[10.5px] text-err">at entry {r.broken_at}</span>}
              </td>
              <td className="tnum px-3 py-1.5 text-dim">{r.entries}</td>
              <td className="px-3 py-1.5">
                <DigestChip digest={r.anchor} label={`Last hash of ${r.run}`} />
              </td>
              <td className="px-3 py-1.5 whitespace-nowrap text-faint">{whenText(r.at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Where the walk failed. Presentational. */
export function LedgerBreaks({ ledger }: { ledger: LedgerVerification }) {
  if (!ledger.breaks.length) return null;
  return (
    <ul className="flex flex-col gap-1.5">
      {ledger.breaks.map((b, i) => (
        <li key={`${b.seq}-${b.run}-${i}`} className="rounded-md border border-err-line px-3 py-2 text-[11.5px] leading-[1.5] text-fg">
          <span className="font-mono text-[10.5px] text-dim">
            <Link href={`/runs?id=${encodeURIComponent(b.run)}`} className="focusable rounded-sm hover:underline">
              {b.run}
            </Link>
            {b.broken_at !== null ? ` · entry ${b.broken_at}` : ""}
          </span>
          <span className="block break-words">{b.reason}</span>
        </li>
      ))}
    </ul>
  );
}

/** The audit trail's chain, walked whole. Presentational. */
function AuditTrail({ ledger }: { ledger: LedgerVerification }) {
  const a = ledger.audit;
  if (!a) return <p className="text-[12px] text-err">The answer did not include the audit trail&rsquo;s reading.</p>;
  return (
    <div className="flex flex-col gap-1.5 text-[11.5px] leading-[1.5]">
      <span className="flex flex-wrap items-center gap-2">
        <Status tone={a.valid ? "ok" : "err"}>{a.valid ? "Audit trail holds" : "Audit trail broken"}</Status>
        <span className="tnum text-faint">
          {a.rows} row{a.rows === 1 ? "" : "s"} checked
        </span>
        {a.head && <DigestChip digest={a.head} label="Hash of the last audit row" />}
      </span>
      {!a.valid && (
        <p className="text-err">
          At row {a.broken_at}: {a.reason}
        </p>
      )}
    </div>
  );
}

/** Each class of record with its period, the last sweep, and what it left. Presentational. */
export function RetentionPanel({ view }: { view: RetentionView }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="af-list af-list-tall overflow-x-auto rounded-md border border-line">
        <table className="w-full min-w-[720px] border-collapse text-[11.5px]">
          <thead>
            <tr className="border-b border-line bg-raise/40 text-left text-[10.5px] text-faint">
              <th className="px-3 py-1.5 font-medium">Class</th>
              <th className="px-3 py-1.5 font-medium">What it holds</th>
              <th className="px-3 py-1.5 font-medium">Kept</th>
            </tr>
          </thead>
          <tbody>
            {view.classes.map((c) => (
              <tr key={c.class} className="border-b border-line align-top last:border-0">
                <td className="px-3 py-1.5 text-fg">{c.label}</td>
                <td className="px-3 py-1.5 text-dim">{c.holds}</td>
                <td className="px-3 py-1.5 text-dim">{c.days !== null ? `${c.days} days` : c.kept_because}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.last_sweep_error ? (
        <p className="text-[11.5px] leading-[1.5] text-err">
          The last sweep ({whenText(view.last_sweep_at)}) failed: {view.last_sweep_error}
        </p>
      ) : view.last_sweep_at ? (
        <p className="text-[11px] leading-[1.5] text-faint">
          Last swept {whenText(view.last_sweep_at)} by the {view.last_sweep_by}: {view.last_sweep.map((s) => s.said).join("; ")}.
        </p>
      ) : (
        <p className="text-[11px] leading-[1.5] text-faint">No sweep is on record.</p>
      )}
      {view.tombstones.length > 0 ? (
        <div className="af-list af-list-tall overflow-x-auto rounded-md border border-line">
          <table className="w-full min-w-[720px] border-collapse text-[11.5px]">
            <thead>
              <tr className="border-b border-line bg-raise/40 text-left text-[10.5px] text-faint">
                <th className="px-3 py-1.5 font-medium">Record</th>
                <th className="px-3 py-1.5 font-medium">Class</th>
                <th className="px-3 py-1.5 font-medium">Removed</th>
                <th className="px-3 py-1.5 font-medium">Digest of what was removed</th>
              </tr>
            </thead>
            <tbody>
              {view.tombstones.map((t) => (
                <tr key={t.id} className="border-b border-line align-top last:border-0">
                  <td className="px-3 py-1.5">
                    <Mono className="text-[10.5px] text-dim">{t.record}</Mono>
                    {typeof t.detail.name === "string" && <span className="block text-[10.5px] text-faint">{t.detail.name}</span>}
                  </td>
                  <td className="px-3 py-1.5 text-dim">{view.classes.find((c) => c.class === t.class)?.label ?? t.class}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-faint">
                    {whenText(t.deleted_at)} by the {t.by}
                  </td>
                  <td className="px-3 py-1.5">
                    <DigestChip digest={t.digest} label="Digest of what was removed" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-[12px] text-faint">No tombstone on record.</p>
      )}
    </div>
  );
}

const iso = (local: string): string | undefined => (local && !Number.isNaN(Date.parse(local)) ? new Date(local).toISOString() : local || undefined);

function LedgerPage() {
  const params = useSearchParams();
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  /** Why the agents were not read: the agent picker says so, never offering an empty list as the estate's. */
  const [agentsError, setAgentsError] = useState("");
  const [agent, setAgent] = useState(params.get("agent") ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [ledger, setLedger] = useState<LedgerVerification | null>(null);
  const [retention, setRetention] = useState<RetentionView | null>(null);
  /** The retention door did not answer: said in place of "Reading" for good. */
  const [retentionDown, setRetentionDown] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const walk = useCallback(() => {
    setBusy(true);
    verifyLedger({ agent: agent || undefined, from: iso(from), to: iso(to) })
      .then((l) => {
        setLedger(l);
        setError("");
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  }, [agent, from, to]);
  useEffect(() => soon(walk), [walk]);
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
    getRetention()
      .then(setRetention)
      .catch((e) => {
        setRetention(null);
        setRetentionDown((e as Error).message);
      });
  }, []);
  const head = ledger ? ledgerHeadline(ledger) : null;
  const notes = ledger ? ledgerNotes(ledger) : [];
  // A ledger door that did not answer: the failure is shown under the header, and every figure says it was not read.
  const unread = <span className="flex h-[15px] items-center text-[12px] font-normal text-faint">Not read</span>;
  const quietDown = Boolean(error) && !ledger;
  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7">
      <GroupHeader group="assurance" tab="ledger">
        Checks every run&rsquo;s hash chain and the audit trail.
      </GroupHeader>
      {error && (
        <Banner tone="err" title="Could not check the record">
          {error}
        </Banner>
      )}
      {head && (
        <Banner tone={head.tone} title={head.title}>
          {head.line}
        </Banner>
      )}
      <Section title="Runs" action={<Button size="sm" variant="solid" tone="neutral" loading={busy} onClick={walk}>Check again</Button>}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Agent" error={agentsError ? `the agents could not be read: ${agentsError}` : undefined}>
            <Pick value={agent} onChange={setAgent} options={[{ value: "", label: "The whole estate" }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} />
          </Field>
          <Field label="From" hint="runs created at or after it">
            <Input type="datetime-local" value={from} onChange={setFrom} />
          </Field>
          <Field label="To" hint="runs created at or before it">
            <Input type="datetime-local" value={to} onChange={setTo} />
          </Field>
        </div>
        {ledger && (
          <>
            <Figures items={[{ k: "runs checked", v: ledger.runs }, { k: "chain holds", v: ledger.counts.ok }, { k: "chain broken", v: ledger.counts.broken }]} />
            {notes.map((n) => (
              <p key={n} className="text-[11px] text-faint">
                {n}.
              </p>
            ))}
            <LedgerBreaks ledger={ledger} />
            <LedgerWalk ledger={ledger} />
          </>
        )}
        {quietDown && (
          <>
            <Figures items={[{ k: "runs checked", v: unread }, { k: "chain holds", v: unread }, { k: "chain broken", v: unread }]} />
            <p className="text-[12px] text-faint">Not read.</p>
          </>
        )}
      </Section>
      <Section title="Audit trail" hue="ledger" meta="sign-ins, every change and every refusal, hash-chained">
        {ledger ? <AuditTrail ledger={ledger} /> : <p className="text-[12px] text-faint">{quietDown ? "Not read." : "Reading…"}</p>}
      </Section>
      <Section title="Retention" hue="ledger" meta="what is kept, and tombstones of what was removed">
        {retention ? (
          <RetentionPanel view={retention} />
        ) : retentionDown ? (
          <Failure what="The retention record could not be read" message={retentionDown} />
        ) : (
          <p className="text-[12px] text-faint">Reading…</p>
        )}
      </Section>
    </div>
  );
}

export function LedgerView() {
  return (
    <Suspense>
      <LedgerPage />
    </Suspense>
  );
}
