"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button, Mono, Status } from "./ui";
import { Banner } from "./overlays";
import { QUIET } from "@/lib/quiet";
import { Field, Input } from "./forms";
import { Pick } from "./select";
import { DigestChip } from "./digest-chip";
import { Figures, Section } from "./section";
import { GroupHeader } from "./page-tabs";
import { soon } from "@/lib/soon";
import { listAgents, type AgentSummary } from "@/lib/api/l2";
import { CHAIN_STATES, getRetention, verifyLedger, verifyRun, type ChainState, type LedgerVerification, type RetentionView, type RunVerification } from "@/lib/api/l9";
import { CHAIN_META, ledgerHeadline, ledgerNotes, verifyLine } from "@/lib/chain";
import { whenText } from "@/lib/lifecycle";

/**
 * The hash chain (phase L9): every journal entry carries `prev` and `hash`, a
 * run's first entry names the estate's previous anchor, and a run's last hash
 * is recorded in the ledger, in order. RunChain is the reading on a run's own
 * page; LedgerView walks every anchor. A break says where and why, in the
 * door's words. Retention sits here too, since a deletion leaves a tombstone
 * anchor and the chain still has to verify across it. Its rules change on the
 * Policy page. The doors are lib/api/l9.ts, the words lib/chain.ts.
 */

export function ChainStatus({ chain }: { chain: ChainState }) {
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
  // A quiet console (lib/quiet.ts) prints no reason a read failed: the run page has said once that it is not connected.
  if (error) return QUIET ? null : <p className="text-[11px] text-faint">The chain could not be read: {error}</p>;
  return reading ? <RunChainView reading={reading} /> : null;
}

/** The walk, row by row. Presentational. */
export function LedgerWalk({ ledger }: { ledger: LedgerVerification }) {
  if (!ledger.walk.length) return <p className="text-[12px] text-faint">No anchor in this view. A run writes its first when it comes to rest.</p>;
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full min-w-[860px] border-collapse text-[11.5px]">
        <thead>
          <tr className="border-b border-line bg-raise/40 text-left text-[10.5px] text-faint">
            <th className="px-3 py-1.5 font-medium">Seq</th>
            <th className="px-3 py-1.5 font-medium">Run</th>
            <th className="px-3 py-1.5 font-medium">Row</th>
            <th className="px-3 py-1.5 font-medium">Reading</th>
            <th className="px-3 py-1.5 font-medium">Entries</th>
            <th className="px-3 py-1.5 font-medium">Anchor</th>
            <th className="px-3 py-1.5 font-medium">At</th>
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
              <td className="px-3 py-1.5 text-dim">{r.kind === "tombstone" ? "tombstone" : r.state}</td>
              <td className="px-3 py-1.5">
                <ChainStatus chain={r.chain} />
                {r.broken_at !== null && <span className="block text-[10.5px] text-err">at entry {r.broken_at}</span>}
              </td>
              <td className="tnum px-3 py-1.5 text-dim">{r.entries}</td>
              <td className="px-3 py-1.5">
                <DigestChip digest={r.anchor} label={`Anchor ${r.seq}`} />
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
            {b.seq !== null ? `anchor ${b.seq} · ` : ""}
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

const CLASS_LABEL: Record<string, string> = { runs: "Runs", journals: "Journals", evals: "Evals", deliverables: "Deliverables", auth_events: "Auth events" };

/** Days per record class, the last sweep and what it left. Presentational. */
export function RetentionPanel({ view }: { view: RetentionView }) {
  return (
    <div className="flex flex-col gap-3">
      <Figures items={Object.entries(view.rules).map(([k, d]) => ({ k: CLASS_LABEL[k] ?? k, v: d === null ? "kept" : `${d} d` }))} />
      <p className="text-[11px] leading-[1.5] text-faint">
        {view.set_by ? `Set by ${view.set_by} ${whenText(view.set_at)}.` : "No rule is set: nothing is deleted."}{" "}
        {view.change && (
          <>
            By change{" "}
            <Link href={`/policy?change=${encodeURIComponent(view.change)}`} className="focusable rounded-sm font-mono hover:underline">
              {view.change}
            </Link>
            .{" "}
          </>
        )}
        {view.last_sweep_at ? `Last swept ${whenText(view.last_sweep_at)}: ${view.last_sweep.map((s) => `${String(s.class)}, ${String(s.deleted)} deleted`).join("; ") || "nothing to delete"}.` : "No sweep has run on this instance."}
      </p>
      {view.tombstones.length > 0 ? (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full min-w-[720px] border-collapse text-[11.5px]">
            <thead>
              <tr className="border-b border-line bg-raise/40 text-left text-[10.5px] text-faint">
                <th className="px-3 py-1.5 font-medium">Record</th>
                <th className="px-3 py-1.5 font-medium">Class</th>
                <th className="px-3 py-1.5 font-medium">Deleted</th>
                <th className="px-3 py-1.5 font-medium">Digest of what was deleted</th>
              </tr>
            </thead>
            <tbody>
              {view.tombstones.map((t) => (
                <tr key={t.id} className="border-b border-line align-top last:border-0">
                  <td className="px-3 py-1.5">
                    <Mono className="text-[10.5px] text-dim">{t.record}</Mono>
                    <span className="block font-mono text-[10px] text-ghost">{t.id}</span>
                  </td>
                  <td className="px-3 py-1.5 text-dim">{CLASS_LABEL[t.class] ?? t.class}</td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-faint">
                    {whenText(t.deleted_at)} by {t.by}
                  </td>
                  <td className="px-3 py-1.5">
                    <DigestChip digest={t.digest} label="Tombstone digest" />
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
  const [agent, setAgent] = useState(params.get("agent") ?? "");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [ledger, setLedger] = useState<LedgerVerification | null>(null);
  const [retention, setRetention] = useState<RetentionView | null>(null);
  /** The retention door did not answer: a quiet console says so in place of "Reading" for good. */
  const [retentionDown, setRetentionDown] = useState(false);
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
      .then(setAgents)
      .catch(() => setAgents([]));
    getRetention()
      .then(setRetention)
      .catch(() => {
        setRetention(null);
        setRetentionDown(true);
      });
  }, []);
  const head = ledger ? ledgerHeadline(ledger) : null;
  const notes = ledger ? ledgerNotes(ledger) : [];
  // A quiet console whose ledger door did not answer says so once under the header, with the walk and the retention drawn empty beneath it.
  const unread = <span className="flex h-[15px] items-center text-[12px] font-normal text-faint">Not connected</span>;
  const headRow = (cols: string[], min: number) => (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full border-collapse text-[11.5px]" style={{ minWidth: min }}>
        <thead>
          <tr className="bg-raise/40 text-left text-[10.5px] text-faint">
            {cols.map((h) => (
              <th key={h} className="px-3 py-1.5 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
      </table>
    </div>
  );
  const quietDown = QUIET && Boolean(error) && !ledger;
  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7">
      <GroupHeader group="assurance" tab="ledger">
        Every run&rsquo;s journal is hash-chained, and its last hash is anchored here in order, each run&rsquo;s first entry naming the anchor before it. Walking the ledger verifies every run and shows any record that is not what was written.
      </GroupHeader>
      {error && (
        <Banner tone="err" title="Could not walk the ledger">
          {error}
        </Banner>
      )}
      {head && (
        <Banner tone={head.tone} title={head.title}>
          {head.line}
        </Banner>
      )}
      <>
      <Section title="Ledger walk" action={<Button size="sm" variant="solid" tone="neutral" loading={busy} onClick={walk}>Walk again</Button>}>
        <div className="grid gap-3 md:grid-cols-3">
          <Field label="Agent">
            <Pick value={agent} onChange={setAgent} options={[{ value: "", label: "The whole estate" }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} />
          </Field>
          <Field label="From" hint="rows recorded at or after it">
            <Input type="datetime-local" value={from} onChange={setFrom} />
          </Field>
          <Field label="To" hint="rows recorded at or before it">
            <Input type="datetime-local" value={to} onChange={setTo} />
          </Field>
        </div>
        {ledger && (
          <>
            <Figures items={[{ k: "anchors", v: ledger.anchors }, { k: "runs", v: ledger.runs }, ...CHAIN_STATES.map((c) => ({ k: CHAIN_META[c].label.toLowerCase(), v: ledger.counts[c] }))]} />
            {ledger.head && (
              <p className="flex flex-wrap items-center gap-2 text-[11px] text-faint">
                Head: anchor {ledger.head.seq} of <Mono className="text-[10.5px]">{ledger.head.run}</Mono>, {whenText(ledger.head.at)}
                <DigestChip digest={ledger.head.anchor} label="Head anchor" />
              </p>
            )}
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
            <Figures items={[{ k: "anchors", v: unread }, { k: "runs", v: unread }, ...CHAIN_STATES.map((c) => ({ k: CHAIN_META[c].label.toLowerCase(), v: unread }))]} />
            {headRow(["Seq", "Run", "Row", "Reading", "Entries", "Anchor", "At"], 860)}
            <p className="text-[12px] text-faint">Each anchor is listed here in order, with the run it closes and the reading of its chain.</p>
          </>
        )}
      </Section>
      <Section
        title="Retention"
        hue="ledger"
        meta="what is kept, and the tombstones left by what was not"
        action={
          <Button size="sm" variant="solid" tone="neutral" href="/policy#propose">
            Propose a change
          </Button>
        }
      >
        {retention ? (
          <RetentionPanel view={retention} />
        ) : QUIET && retentionDown ? (
          <>
            {headRow(["Record", "Class", "Deleted", "Digest of what was deleted"], 720)}
            <p className="text-[12px] text-faint">How long each class of record is kept is shown here, with a tombstone for every record deleted.</p>
          </>
        ) : (
          <p className="text-[12px] text-faint">Reading…</p>
        )}
      </Section>
      </>
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
