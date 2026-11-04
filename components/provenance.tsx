"use client";

import { useMemo, useState } from "react";
import { Button, Mono, Status, Tag } from "./ui";
import { ControlMark } from "./control-ref";
import { DigestChip } from "./digest-chip";
import { DrillModal } from "./drill";
import { RunChain } from "./chain";
import type { SignedDecision } from "@/lib/api/l9";
import { decisionLine, stampLine } from "@/lib/evidence";
import type { LineageEntry } from "@/lib/lineage";
import { ROLE_LABEL, decisionEntry, provenanceOf, type Provenance } from "@/lib/provenance";

/**
 * The provenance chain of a decision, prompt to result (phase L9): what it
 * stands on and what it led to, step by step, from the journal the runtime
 * already keeps (lib/provenance.ts). Each step shows what was actually said
 * (the prompt, the answer, the arguments) and the hash that puts it on the
 * chain. On an older record, a step the runtime did not cite and the walk
 * joined by position says so, because a reader relying on this should know
 * which links are records.
 */

/** The rules that redacted an entry as it was written: what it says here is what the chain hashed. */
const redactedOf = (e: LineageEntry): string[] => {
  const r = (e as { redacted?: { rule?: string }[] }).redacted;
  return Array.isArray(r) ? [...new Set(r.map((x) => String(x.rule ?? "")).filter(Boolean))] : [];
};

const ROLE_TONE: Record<string, string> = { decision: "text-warn", gate: "text-warn", refusal: "text-err", prompt: "text-run", outcome: "text-ok", result: "text-ok" };

/** The chain, drawn. Presentational. */
export function ProvenanceChain({ chain, onFocus }: { chain: Provenance; onFocus?: (id: string) => void }) {
  if (!chain.root) return <p className="px-4 py-4 text-[12px] text-faint">That entry is not on this run&rsquo;s journal.</p>;
  return (
    <ol className="flex flex-col">
      {chain.steps.map((s) => {
        const e = s.entry as LineageEntry & { hash?: string };
        const control = e.data?.control ? String(Array.isArray(e.data.control) ? e.data.control[0] : e.data.control) : "";
        return (
          <li key={e.id} className={`flex flex-col gap-0.5 border-b border-line px-4 py-2 last:border-b-0 ${s.root ? "bg-raise/50" : ""}`}>
            <span className="flex flex-wrap items-center gap-2">
              <span className={`text-[10.5px] font-medium ${ROLE_TONE[s.role] ?? "text-dim"}`}>{ROLE_LABEL[s.role]}</span>
              <span className="truncate text-[12px] font-medium text-fg">{e.title || e.kind}</span>
              {s.root && <Tag tone="warn">this decision</Tag>}
              {e.tainted && <Tag tone="warn">tainted</Tag>}
              <ControlMark control={control} />
              {s.link === "joined" && <Tag>joined by position</Tag>}
              {redactedOf(e).length > 0 && <Tag>redacted: {redactedOf(e).join(", ")}</Tag>}
              <span className="grow" />
              {e.node && <span className="text-[10.5px] text-ghost">{e.node}</span>}
              {e.hash && <DigestChip digest={e.hash} label={`Hash of entry ${e.id}`} />}
              {!s.root && onFocus && (
                <Button size="sm" variant="quiet" onClick={() => onFocus(e.id)}>
                  Focus
                </Button>
              )}
            </span>
            {s.said && <span className="line-clamp-4 font-mono text-[10.5px] leading-[1.5] break-words whitespace-pre-wrap text-faint">{s.said}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** The chain of one entry of a run, in a drawer. Any step can become the root. */
export function ProvenanceDrawer({ entries, entryId, onClose }: { entries: LineageEntry[]; entryId: string; onClose: () => void }) {
  const [focus, setFocus] = useState(entryId);
  const chain = useMemo(() => provenanceOf(entries, focus), [entries, focus]);
  return (
    <DrillModal title="Provenance" subtitle={chain.root ? `${chain.root.title || chain.root.kind}: from the input and prompt to the result` : focus} onClose={onClose}>
      {chain.missing.length > 0 && <p className="border-b border-line px-4 py-2 text-[11px] text-err">The chain cites entries this record does not hold: {chain.missing.join(", ")}.</p>}
      {chain.joined > 0 && (
        <p className="border-b border-line px-4 py-2 text-[11px] leading-[1.5] text-faint">
          {chain.joined} step{chain.joined === 1 ? " is" : "s are"} joined by journal position: this run was recorded before the runtime cited across a resume, or into a run&rsquo;s first step or its end.
        </p>
      )}
      <ProvenanceChain chain={chain} onFocus={setFocus} />
    </DrillModal>
  );
}

/** The signed answers on a run, each with its stamped controls and its chain. Renders nothing when the run has none. */
export function DecisionsPanel({ decisions, entries }: { decisions: SignedDecision[]; entries: LineageEntry[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!decisions.length) return null;
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-line bg-surface px-3 py-2">
      <span className="text-[11px] font-semibold text-dim">Signed decisions</span>
      {decisions.map((d) => {
        const entry = decisionEntry(entries, d);
        return (
          <div key={d.digest || d.gate} className="flex flex-wrap items-center gap-2 text-[11px] text-dim">
            <Status tone={d.approved ? "ok" : "err"}>{d.approved ? "approved" : d.aborted ? "closed" : "refused"}</Status>
            <span className="min-w-0">{decisionLine(d)}</span>
            {d.control_ids.map((c) => (
              <ControlMark key={c} control={c} />
            ))}
            {!d.control_ids.length && d.controls.map((c) => <Mono key={c} className="text-[10.5px] text-mist">{c}</Mono>)}
            <span className="text-[10.5px] text-ghost">{stampLine(d)}</span>
            {d.digest && <DigestChip digest={d.digest} label="Digest of this decision" />}
            <span className="grow" />
            {entry && (
              <Button size="sm" variant="quiet" onClick={() => setOpen(entry.id)}>
                Provenance
              </Button>
            )}
          </div>
        );
      })}
      {open && <ProvenanceDrawer entries={entries} entryId={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** What a run's page holds about its own record: the chain, and the decisions signed on it. */
export function RunAssurance({ run, decisions = [], entries = [] }: { run: string; decisions?: SignedDecision[]; entries?: LineageEntry[] }) {
  if (!run) return null;
  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-line bg-raise/30 px-4 py-2">
      <RunChain run={run} />
      <DecisionsPanel decisions={decisions} entries={entries} />
    </div>
  );
}
