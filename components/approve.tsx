"use client";

import { useEffect, useState } from "react";
import { Button, Mono, Status } from "./ui";
import { Field, Textarea } from "./forms";
import { CURRENT_USER } from "@/lib/user";
import { useSession, signerName } from "@/lib/use-session";

/**
 * Answering a gate, from the console.
 *
 * A suspended run is a question put to a person, and until this existed the
 * only way to answer one was the command line. The dialog shows what is being
 * signed off — the decision, the score, the evidence hash — then takes an
 * identity and a reason, because an approval nobody signed is not an approval
 * and the record has to say who.
 *
 * The identity is the console's operator (lib/user), never typed: until the
 * deployment is behind a sign-in the record says who the console was issued
 * to, which is what the runtime writes and what an auditor reads.
 */

export interface Gate {
  run: string;
  agent: string;
  node: string;
  kind: string;
  asks: string;
  approvers: string[];
  timeout_s: number | null;
  on_timeout: string;
  waiting_since: string;
  decided: Record<string, unknown>;
  job?: { id: string; external_id: string | null; source: string };
}

export function useGates(active = true) {
  const [gates, setGates] = useState<Gate[] | null>(null);

  const load = () => {
    fetch("/api/approvals")
      .then((r) => r.json())
      .then((d) => setGates(d.pending ?? []))
      .catch(() => setGates([]));
  };

  useEffect(() => {
    if (!active) return;
    load();
  }, [active]);

  return { gates, reload: load };
}

export function ApproveDialog({
  gate,
  onClose,
  onAnswered,
}: {
  gate: Gate;
  onClose: () => void;
  onAnswered: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "refuse" | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const { session: me } = useSession();
  const by = signerName(me, CURRENT_USER.name);

  const answer = async (approved: boolean) => {
    setBusy(approved ? "approve" : "refuse");
    setResult(null);
    try {
      const res = await fetch("/api/approvals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ run: gate.run, approved, by, note: note.trim() }),
      });
      const d = await res.json();
      if (d.error) {
        setResult({ ok: false, text: String(d.error) });
      } else {
        const r = (d.results ?? [])[0] ?? {};
        setResult({
          ok: Boolean(r.ok) || r.state === "closed",
          text: r.ok
            ? `${approved ? "Approved" : "Refused"}. The run continued and settled as ${r.state}.`
            : r.state === "closed"
              ? `${approved ? "Approved" : "Refused"} and recorded. ${String(r.error ?? "")}`.trim()
              : `${approved ? "Approved" : "Refused"}, but the run ended as ${r.state}. ${String(r.error ?? "")}`.trim(),
        });
        onAnswered();
      }
    } catch (e) {
      setResult({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const decided = Object.entries(gate.decided).filter(([k]) =>
    ["disposition", "risk_score", "model_disposition", "hard_rule_fired", "needs_review", "audit_hash"].includes(k),
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Answer the gate on ${gate.agent}`}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[86vh] w-[min(560px,94vw)] flex-col overflow-hidden rounded-lg border border-line bg-surface elev-3 af-pop"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
          <Status tone="warn">gate</Status>
          <span className="min-w-0 grow truncate text-[13px] font-semibold">{gate.agent}</span>
          <Mono className="shrink-0 text-[10px] text-ghost">{gate.node}</Mono>
        </header>

        <div className="min-h-0 grow overflow-y-auto">
          <p className="border-b border-line px-4 py-3 text-[11.5px] leading-[1.6] text-faint">{gate.asks}</p>

          {decided.length > 0 && (
            <div className="border-b border-line">
              <span className="block px-4 pt-2.5 pb-1 text-[11px] font-semibold text-dim">
                What you are signing off
              </span>
              {decided.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-3 px-4 py-1.5">
                  <span className="text-[11.5px] text-faint">{k.replace(/_/g, " ")}</span>
                  <span className="tnum min-w-0 truncate text-right font-mono text-[11px] text-fg">{String(v)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-2 border-b border-line px-4 py-3 text-[11px] text-faint">
            <span>
              For {gate.approvers.length ? gate.approvers.join(", ") : "anyone"} · waiting since{" "}
              {new Date(gate.waiting_since).toLocaleString()}
            </span>
            {gate.on_timeout && <span>If nobody answers: {gate.on_timeout}</span>}
            {gate.job?.external_id && <span>Raised by {gate.job.source} as {gate.job.external_id}</span>}
          </div>

          <div className="flex flex-col gap-3 px-4 py-3">
            <span className="flex items-center gap-2 text-[11.5px] text-faint">
              <span className="grid size-5 place-items-center rounded-full bg-ink text-[8.5px] font-semibold text-on-ink">{me?.initials ?? CURRENT_USER.initials}</span>
              Signing as <span className="font-medium text-fg">{by}</span> · written into the run record
            </span>
            <Field label="Reason" hint="Optional, and the first thing a reviewer reads six months from now.">
              <Textarea rows={3} value={note} onChange={setNote} placeholder="Why this decision stands, or why it is being overridden." />
            </Field>
          </div>

          {result && (
            <p className={`px-4 pb-3 text-[11.5px] leading-[1.55] ${result.ok ? "text-ok" : "text-err"}`}>
              {result.text}
            </p>
          )}
        </div>

        <footer className="flex shrink-0 items-center gap-2 border-t border-line px-4 py-3">
          <Button
            size="sm"
            variant="solid"
            tone="ink"
            permission="approve" loading={busy === "approve"}
            disabled={Boolean(busy)}
            onClick={() => answer(true)}
          >
            Approve
          </Button>
          <Button
            size="sm"
            variant="solid"
            tone="err"
            permission="approve" loading={busy === "refuse"}
            disabled={Boolean(busy)}
            onClick={() => answer(false)}
          >
            Refuse
          </Button>
          <span className="grow" />
          <Button size="sm" variant="quiet" onClick={onClose}>
            {result?.ok ? "Close" : "Cancel"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
