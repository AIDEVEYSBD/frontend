"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, Mono, Status, Tag } from "./ui";
import { Checkbox, Field, Input, Textarea } from "./forms";
import { Pick } from "./select";
import { CURRENT_USER } from "@/lib/user";
import { useSession, signerName } from "@/lib/use-session";
import { answerGate, answerGates, DoorError, listGates, mintLink, type Answer, type AnswerResult, type Gate, type MintedLink } from "@/lib/api/l5";
import { SAMPLE_SIZE, batchCount, batchable, declaresNote, emptyForm, gateAccess, nextSample, refusalErrors, sampleGates, validateForm, validateVerdicts, type Access, type FormState } from "@/lib/gates";
import { Deadline, EvidencePanel, GateFields, GateMeta, ShapeTag, SignerLine, VerdictTable, useNow } from "./gate-form";

/**
 * Answering a gate, from the console.
 *
 * A suspended run is a question put to a person, and the gate's interface
 * says what kind of answer it takes: a decision (approve or refuse, with a
 * note), a form (typed fields the runtime validates on resume), or a
 * verdict per item of a register the run emitted. The dialog renders the
 * shape, shows the evidence the backend laid out, who may answer and where
 * the gate goes if nobody does, and signs with the session: the identity
 * shown here is what the record will say, and it is never typed.
 *
 * The answer goes to the backend's approvals door, `POST
 * /api/approvals/{run}` (lib/api/l5.ts), which validates it against the
 * shape and resumes the run, or writes it onto an attached agent's record.
 * Several gates of one agent and one shape can be answered together through
 * the batch door, with any of them answered differently on its own. Before
 * a batch is answered, a sample of its gates is shown with their evidence
 * (three picked at random, or all of them when there are three or fewer,
 * and another sample on request), and the dialog says how many gates the
 * one answer goes to and how many are answered on their own. A gate
 * whose spec allows it can be handed to someone outside the firm as a
 * signed link, which the console shows and never sends.
 */

export type { Gate } from "@/lib/api/l5";

/** The inbox, re-read every `everyMs` while `active`: a gate escalates, times out or is answered elsewhere without a click here. */
export function useGates(active = true, everyMs = 8000) {
  const [gates, setGates] = useState<Gate[] | null>(null);

  const load = () => {
    listGates()
      .then((d) => setGates(d.pending))
      .catch(() => setGates((cur) => cur ?? []));
  };

  useEffect(() => {
    if (!active) return;
    load();
    const id = setInterval(load, everyMs);
    return () => clearInterval(id);
  }, [active, everyMs]);

  return { gates, reload: load };
}

/** Everything one gate's answer needs while it is being composed. */
interface Draft {
  decision: boolean | undefined;
  form: FormState;
  chosen: Record<string, string | undefined>;
  note: string;
  errors: Record<string, string>;
}

const draftFor = (g: Gate): Draft => ({ decision: undefined, form: emptyForm(g.fields), chosen: {}, note: "", errors: {} });

/** The draft as a typed answer, or the errors that stop it. */
function settle(g: Gate, d: Draft, decision?: boolean): { answer?: Answer; errors: Record<string, string> } {
  if (g.shape === "decision") {
    const approved = decision ?? d.decision;
    if (approved === undefined) return { errors: { decision: "Approve or refuse." } };
    return { answer: { approved }, errors: {} };
  }
  if (g.shape === "form") {
    const c = validateForm(g.fields, d.form);
    return c.ok ? { answer: c.answer, errors: {} } : { errors: c.errors };
  }
  const c = validateVerdicts(g.items, g.verdicts, g.transitions, d.chosen);
  return c.ok ? { answer: c.answer, errors: {} } : { errors: c.errors };
}

export function ApproveDialog({
  gates,
  onClose,
  onAnswered,
}: {
  /** One gate, or several of one agent and shape to answer together. */
  gates: Gate[];
  onClose: () => void;
  onAnswered: () => void;
}) {
  const gate = gates[0];
  const batch = gates.length > 1;
  const now = useNow();
  const { session: me, loaded } = useSession();
  const by = signerName(me, CURRENT_USER.name);
  const who = useMemo(() => (loaded && me ? { roles: me.roles, appRoles: me.appRoles, groups: me.groups ?? [] } : null), [loaded, me]);

  const [draft, setDraft] = useState<Draft>(() => draftFor(gate));
  // Batch: which gates answer on their own, and how.
  const [overrides, setOverrides] = useState<Record<string, Draft>>({});
  // Batch: the gates shown with their evidence before the answer goes, and every one shown so far.
  const runs = useMemo(() => gates.map((g) => g.run), [gates]);
  const [sample, setSample] = useState<{ runs: string[]; seen: string[] }>(() => {
    const first = sampleGates(gates.map((g) => g.run));
    return { runs: first, seen: first };
  });
  const showAnother = () =>
    setSample((cur) => {
      const n = nextSample(runs, cur.runs, cur.seen);
      return { runs: n.sample, seen: n.seen };
    });
  const count = batchCount(runs, Object.keys(overrides), sample.runs, sample.seen);
  const [busy, setBusy] = useState<"approve" | "refuse" | "submit" | null>(null);
  const [results, setResults] = useState<AnswerResult[] | null>(null);
  /** What each run was told, for the line beside its result: "Approved", "Refused", "Submitted", "Verdicts recorded". */
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState("");

  // The external link: an email, then the URL to copy.
  const [linking, setLinking] = useState(false);
  const [email, setEmail] = useState("");
  const [minted, setMinted] = useState<MintedLink | null>(null);
  const [minting, setMinting] = useState(false);
  const [linkError, setLinkError] = useState("");
  const [copied, setCopied] = useState(false);

  const access: Access = useMemo(() => {
    if (!loaded) return { ok: true, reason: "" };
    return batch ? batchable(gates, who) : gateAccess(who, gate.approvers);
  }, [loaded, batch, gates, gate.approvers, who]);

  const done = Boolean(results?.some((r) => r.ok || r.state === "closed"));
  const word = (approved: boolean) => (approved ? "Approved" : "Refused");

  const submit = async (decision?: boolean) => {
    setFailure("");
    setResults(null);
    // Validate everything before anything is sent: a batch half-answered is
    // worse than one refused whole.
    const shared = settle(gate, draft, decision);
    const own: { run: string; answer: Answer; note: string }[] = [];
    const errs: Record<string, Record<string, string>> = {};
    for (const [run, d] of Object.entries(overrides)) {
      const g = gates.find((x) => x.run === run);
      if (!g) continue;
      const s = settle(g, d, g.shape === "decision" ? d.decision : undefined);
      if (s.answer) own.push({ run, answer: s.answer, note: d.note.trim() });
      else errs[run] = s.errors;
    }
    const sharedRuns = gates.map((g) => g.run).filter((r) => !(r in overrides));
    if ((sharedRuns.length && !shared.answer) || Object.keys(errs).length) {
      setDraft((d) => ({ ...d, errors: sharedRuns.length ? shared.errors : {} }));
      setOverrides((o) => {
        const next = { ...o };
        for (const [run, e] of Object.entries(errs)) next[run] = { ...next[run], errors: e };
        return next;
      });
      return;
    }
    setBusy(decision === undefined ? "submit" : decision ? "approve" : "refuse");
    const labelOf = (a: Answer) => (gate.shape === "decision" ? word(Boolean((a as { approved?: boolean }).approved)) : gate.shape === "form" ? "Submitted" : "Verdicts recorded");
    const names: Record<string, string> = { "*": shared.answer ? labelOf(shared.answer) : "Answered" };
    for (const o of own) names[o.run] = labelOf(o.answer);
    setLabels(names);
    try {
      const out: AnswerResult[] = [];
      if (!batch) {
        out.push(await answerGate(gate.run, shared.answer!, draft.note.trim()));
      } else {
        if (sharedRuns.length === 1) out.push(await answerGate(sharedRuns[0], shared.answer!, draft.note.trim()));
        else if (sharedRuns.length > 1) out.push(...(await answerGates(sharedRuns, shared.answer!, draft.note.trim(), by)).results);
        for (const o of own) {
          try {
            out.push(await answerGate(o.run, o.answer, o.note));
          } catch (e) {
            out.push({ run: o.run, ok: false, state: "", continuing: false, delivered: "", error: (e as Error).message });
          }
        }
      }
      setResults(out);
      if (out.some((r) => r.ok || r.state === "closed")) onAnswered();
    } catch (e) {
      // A 400 names the field it refused: mark it where it was typed.
      const marked = !batch && e instanceof DoorError ? refusalErrors(gate, e.field, e.message) : {};
      if (Object.keys(marked).length) setDraft((d) => ({ ...d, errors: { ...d.errors, ...marked } }));
      setFailure((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const link = async () => {
    const to = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      setLinkError("Enter the participant's email address; the link is bound to it.");
      return;
    }
    setLinkError("");
    setMinting(true);
    try {
      setMinted(await mintLink(gate.run, to));
    } catch (e) {
      setLinkError((e as Error).message);
    } finally {
      setMinting(false);
    }
  };

  const resultLine = (r: AnswerResult, label: string) =>
    r.ok
      ? `${label}. ${r.delivered || `The run is continuing (${r.state || "running"}); its record settles as it runs.`}`
      : r.state === "closed"
        ? `${label} and recorded. ${r.error}`.trim()
        : `${label}, but the run could not continue. ${r.error}`.trim();

  const wide = gate.shape !== "decision" || batch;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={batch ? `Answer ${gates.length} gates on ${gate.agent}` : `Answer the gate on ${gate.agent}`}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[88vh] flex-col overflow-hidden rounded-lg border border-line bg-surface elev-3 af-pop ${wide ? "w-[min(860px,94vw)]" : "w-[min(560px,94vw)]"}`}
      >
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
          <Status tone="warn">{batch ? `${gates.length} gates` : "gate"}</Status>
          <span className="min-w-0 grow truncate text-[13px] font-semibold">{gate.agent}</span>
          <ShapeTag shape={gate.shape} />
          {!batch && <Mono className="shrink-0 text-[10px] text-ghost">{gate.node}</Mono>}
        </header>

        <div className="min-h-0 grow overflow-y-auto">
          <p className="border-b border-line px-4 py-3 text-[11.5px] leading-[1.6] text-faint">{gate.asks || "The workflow paused here for a person."}</p>

          {!batch && <EvidencePanel evidence={gate.evidence} />}
          {!batch && (
            <div className="border-b border-line">
              <GateMeta gate={gate} now={now} />
            </div>
          )}

          {batch && (
            <div className="border-b border-line pb-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 pt-2.5 pb-2">
                <span className="text-[11px] font-semibold text-dim">Sample</span>
                <span className="text-[11px] text-faint">
                  {count.sampled === count.total ? `all ${count.total} gates, each with its evidence` : `${count.sampled} of the ${count.total} gates, picked at random, each with its evidence`}
                  {count.seen > count.sampled ? ` · ${count.seen} of ${count.total} read in samples so far` : ""}
                </span>
                <span className="grow" />
                {count.total > SAMPLE_SIZE && (
                  <Button size="sm" variant="solid" tone="neutral" onClick={showAnother} disabled={Boolean(busy) || done}>
                    Show another
                  </Button>
                )}
              </div>
              {sample.runs.map((run) => {
                const g = gates.find((x) => x.run === run);
                if (!g) return null;
                const bare = !Object.keys(g.evidence.decided).length && !Object.keys(g.evidence.presented).length && !g.evidence.tainted_by.length && !g.evidence.trail.length;
                return (
                  <div key={run} className="mx-4 mb-2.5 overflow-hidden rounded-md border border-line bg-canvas">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2">
                      <span className="flex min-w-0 grow flex-col">
                        <span className="truncate text-[12px] font-medium text-fg">{g.asks || g.node}</span>
                        <Mono className="truncate text-[10px] text-faint">{g.run} · {g.node}</Mono>
                      </span>
                      <Deadline deadline={g.deadline} now={now} />
                      {overrides[run] && <Tag tone="queue">on its own</Tag>}
                    </div>
                    <EvidencePanel evidence={g.evidence} />
                    {g.shape === "verdicts" && <p className="px-3 py-2 text-[11px] text-faint">{g.items.length} item{g.items.length === 1 ? "" : "s"} on the register to rule on.</p>}
                    {bare && g.shape !== "verdicts" && <p className="px-3 py-2 text-[11px] text-faint">The backend laid out no evidence for this gate; open the run to read its journal.</p>}
                  </div>
                );
              })}
            </div>
          )}

          {batch && (
            <div className="border-b border-line">
              <span className="block px-4 pt-2.5 pb-1 text-[11px] font-semibold text-dim">Answering together · {count.total} gates</span>
              {gates.map((g) => {
                const o = overrides[g.run];
                return (
                  <div key={g.run} className="flex flex-col gap-2 border-t border-line px-4 py-2 first:border-t-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="flex min-w-0 grow flex-col">
                        <span className="truncate text-[12px] font-medium text-fg">{g.asks || g.node}</span>
                        <Mono className="truncate text-[10px] text-faint">{g.run} · {g.node}</Mono>
                      </span>
                      <Deadline deadline={g.deadline} now={now} />
                      <Checkbox
                        label="answer this one on its own"
                        checked={Boolean(o)}
                        onChange={(on) =>
                          setOverrides((prev) => {
                            const next = { ...prev };
                            if (on) next[g.run] = draftFor(g);
                            else delete next[g.run];
                            return next;
                          })
                        }
                        disabled={Boolean(busy) || done}
                      />
                    </div>
                    {o && (
                      <div className="flex flex-col gap-3 rounded-md border border-line bg-canvas p-3">
                        <EvidencePanel evidence={g.evidence} />
                        <GateAnswer gate={g} draft={o} onChange={(d) => setOverrides((prev) => ({ ...prev, [g.run]: d }))} disabled={Boolean(busy) || done} decisionPick />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-col gap-3 px-4 py-3">
            <SignerLine initials={me?.initials ?? CURRENT_USER.initials} name={by} />
            {batch && (
              <span className="text-[11px] text-faint">
                The answer below goes to {count.shared} of the {count.total} gates
                {count.own ? `; ${count.own} ${count.own === 1 ? "is" : "are"} answered on ${count.own === 1 ? "its" : "their"} own` : ""}. You have read {count.seen} of them in the sample.
              </span>
            )}
            <GateAnswer gate={gate} draft={draft} onChange={setDraft} disabled={Boolean(busy) || done} />
          </div>

          {gate.external.allowed && !batch && (
            <div className="flex flex-col gap-2 border-t border-line px-4 py-3">
              {!linking ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[11.5px] text-faint">This gate may be answered by someone outside the firm.</span>
                  <span className="grow" />
                  <Button size="sm" variant="outline" permission="approve" onClick={() => setLinking(true)} disabled={done}>
                    Send to someone outside
                  </Button>
                </span>
              ) : minted ? (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11.5px] text-faint">
                    Link for <span className="font-medium text-fg">{minted.email}</span>
                    {minted.expires_at ? ` · expires ${new Date(minted.expires_at).toLocaleString()}` : ""} · single use
                  </span>
                  <span className="flex items-center gap-2">
                    <code className="min-w-0 grow truncate rounded-sm border border-line bg-raise px-2 py-1.5 font-mono text-[11px] text-fg">{minted.url}</code>
                    <Button
                      size="sm"
                      variant="solid"
                      tone="ink"
                      onClick={() => {
                        navigator.clipboard?.writeText(minted.url).then(() => {
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1400);
                        });
                      }}
                    >
                      {copied ? "Copied" : "Copy link"}
                    </Button>
                  </span>
                  <span className="text-[10.5px] text-ghost">Copy it and send it yourself; the console never emails it. Their answer is written as external:{minted.email}.</span>
                </div>
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-[220px] grow">
                    <Field label="Participant's email" error={linkError || undefined} hint={linkError ? undefined : "The link is bound to this address and to this gate."}>
                      <Input type="email" value={email} onChange={setEmail} placeholder="name@example.com" disabled={minting} />
                    </Field>
                  </div>
                  <Button size="sm" variant="solid" tone="ink" permission="approve" loading={minting} onClick={link}>
                    Create link
                  </Button>
                  <Button size="sm" variant="solid" tone="err" onClick={() => setLinking(false)} disabled={minting}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          )}

          {failure && <p className="px-4 pb-3 text-[11.5px] leading-[1.55] text-err">{failure}</p>}
          {results && (
            <div className="flex flex-col gap-1 px-4 pb-3">
              {results.map((r, i) => (
                <p key={`${r.run}-${i}`} className={`text-[11.5px] leading-[1.55] ${r.ok || r.state === "closed" ? "text-ok" : "text-err"}`}>
                  {batch && <Mono className="mr-1.5 text-[10px]">{r.run}</Mono>}
                  {resultLine(r, labels[r.run] ?? labels["*"] ?? "Answered")}
                </p>
              ))}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-4 py-3">
          {gate.shape === "decision" && batch && count.shared === 0 ? (
            <Button size="sm" variant="solid" tone="ink" permission="approve" loading={busy === "submit"} disabled={Boolean(busy) || done || !access.ok} onClick={() => submit()}>
              Send the {count.own} answers given on their own
            </Button>
          ) : gate.shape === "decision" ? (
            <>
              <Button size="sm" variant="solid" tone="ink" permission="approve" loading={busy === "approve"} disabled={Boolean(busy) || done || !access.ok} onClick={() => submit(true)}>
                {batch ? `Approve ${count.shared}` : "Approve"}
              </Button>
              <Button size="sm" variant="solid" tone="err" permission="approve" loading={busy === "refuse"} disabled={Boolean(busy) || done || !access.ok} onClick={() => submit(false)}>
                {batch ? `Refuse ${count.shared}` : "Refuse"}
              </Button>
              {batch && count.own > 0 && <span className="text-[11px] text-faint">and {count.own} on their own</span>}
            </>
          ) : (
            <Button size="sm" variant="solid" tone="ink" permission="approve" loading={busy === "submit"} disabled={Boolean(busy) || done || !access.ok} onClick={() => submit()}>
              {gate.shape === "form" ? (batch ? `Submit ${gates.length} answers` : "Submit answer") : batch ? `Record verdicts on ${gates.length} gates` : "Record verdicts"}
            </Button>
          )}
          {!access.ok && <span className="min-w-0 text-[11px] leading-[1.4] text-err">{access.reason}</span>}
          {draft.errors.decision && <span className="text-[11px] text-err">{draft.errors.decision}</span>}
          <span className="grow" />
          <Button size="sm" variant="solid" tone="err" onClick={onClose}>
            {done ? "Close" : "Cancel"}
          </Button>
        </footer>
      </div>
    </div>
  );
}

/**
 * The answer's inputs for one gate, by shape. A decision is two buttons in
 * the footer, or a pick when it is one gate's own answer inside a batch
 * (`decisionPick`); a form is its fields; verdicts are the table. Every
 * shape takes a note.
 */
function GateAnswer({ gate, draft, onChange, disabled, decisionPick = false }: { gate: Gate; draft: Draft; onChange: (d: Draft) => void; disabled: boolean; decisionPick?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {gate.shape === "form" && (
        <GateFields fields={gate.fields} state={draft.form} errors={draft.errors} onChange={(name, v) => onChange({ ...draft, form: { ...draft.form, [name]: v }, errors: { ...draft.errors, [name]: "" } })} disabled={disabled} />
      )}
      {gate.shape === "verdicts" && (
        <VerdictTable items={gate.items} verdicts={gate.verdicts} transitions={gate.transitions} chosen={draft.chosen} errors={draft.errors} onChange={(chosen) => onChange({ ...draft, chosen, errors: {} })} disabled={disabled} />
      )}
      {gate.shape === "decision" && decisionPick && <OwnDecision draft={draft} onChange={onChange} disabled={disabled} />}
      {/* A form with its own note field takes the note there: a second box would overwrite it. */}
      {!declaresNote(gate) && (
        <Field label={gate.shape === "decision" ? "Reason" : "Note"} hint="Optional, and the first thing a reviewer reads six months from now.">
          <Textarea rows={2} value={draft.note} onChange={(v) => onChange({ ...draft, note: v })} placeholder={gate.shape === "decision" ? "Why this decision stands, or why it is being overridden." : "Anything the record should carry beside the answer."} disabled={disabled} />
        </Field>
      )}
    </div>
  );
}

/** Inside a batch, a gate answered on its own picks its decision here; the footer's buttons answer the rest. */
function OwnDecision({ draft, onChange, disabled }: { draft: Draft; onChange: (d: Draft) => void; disabled: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[12.5px] font-medium text-mist">Decision</span>
      <div className="w-40">
        <Pick
          value={draft.decision === true ? "approve" : draft.decision === false ? "refuse" : ""}
          onChange={(v) => onChange({ ...draft, decision: v === "approve" ? true : v === "refuse" ? false : undefined, errors: {} })}
          options={[{ value: "", label: "choose…" }, { value: "approve", label: "approve" }, { value: "refuse", label: "refuse" }]}
          disabled={disabled}
          aria-label="Decision for this gate"
        />
      </div>
      {draft.errors.decision && <span className="text-[11px] text-err">{draft.errors.decision}</span>}
      <Tag tone="queue">on its own</Tag>
    </div>
  );
}
