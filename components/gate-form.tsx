"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Mono, Status, Tag } from "./ui";
import { RunSourceTag } from "./run-source";
import { Field, Input, Textarea } from "./forms";
import { Pick } from "./select";
import type { Evidence, Gate, GateField, Shape, VerdictItem } from "@/lib/api/l5";
import { allowedVerdicts, bulkVerdict, chainOf, countdown, type FormState } from "@/lib/gates";

/**
 * The parts of a gate's interface, shared by every place one is answered:
 * the inbox dialog, the theater's banner, and the external answer page.
 * The shape decides the form (a decision, typed fields, a verdict per
 * item); the evidence, the approvers, the chain and the deadline read the
 * same wherever the gate is met, so a reviewer learns one layout.
 */

/* ═══════════════════ time ═══════════════════ */

/** A clock that ticks, seeded on the client so a render never reads Date.now() itself. */
export function useNow(tickMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);
  return now;
}

export function Deadline({ deadline, now }: { deadline: string | null; now: number }) {
  const c = countdown(deadline, now);
  if (!deadline) return <span className="text-[11px] text-faint">no deadline</span>;
  return (
    <span className={`tnum inline-flex items-center gap-1.5 font-mono text-[11px] ${c.overdue ? "text-err" : c.soon ? "text-warn" : "text-dim"}`} title={new Date(deadline).toLocaleString()}>
      <span className={`size-1.5 shrink-0 rounded-[2px] ${c.overdue ? "bg-err" : c.soon ? "bg-warn" : "bg-faint"}`} />
      {c.overdue ? c.text : `${c.text} left`}
    </span>
  );
}

/* ═══════════════════ shape ═══════════════════ */

export const SHAPE_LABEL: Record<Shape, string> = { decision: "decision", form: "form", verdicts: "verdicts" };

export function ShapeTag({ shape }: { shape: Shape }) {
  return <Tag tone={shape === "decision" ? "warn" : shape === "form" ? "queue" : "run"}>{SHAPE_LABEL[shape]}</Tag>;
}

/* ═══════════════════ who, when, where it goes next ═══════════════════ */

/** What each answer does next, in the backend's words; nothing when the row carries none (a gate built from a live suspension). */
export function NextLines({ gate }: { gate: Pick<Gate, "shape" | "next"> }) {
  const { approve, refuse } = gate.next;
  if (!approve && !refuse) return null;
  return (
    <span className="flex flex-col gap-0.5 text-[11px]">
      {approve && (
        <span>
          <span className="text-dim">{gate.shape === "decision" ? "If approved" : "Once answered"}</span> · {approve}
        </span>
      )}
      {refuse && gate.shape === "decision" && (
        <span>
          <span className="text-dim">If refused</span> · {refuse}
        </span>
      )}
    </span>
  );
}

export function GateMeta({ gate, now }: { gate: Gate; now: number }) {
  const current = gate.approvers;
  const c = chainOf(gate);
  return (
    <div className="flex flex-col gap-2 px-4 py-3 text-[11.5px] text-faint">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-dim">Approvers</span>
        {current.length ? current.map((r) => <Tag key={r} tone="warn">{r}</Tag>) : <span>anyone with the approve permission</span>}
        <span className="grow" />
        <span className="text-dim">Deadline</span>
        <Deadline deadline={gate.deadline} now={now} />
      </span>
      {(c.ahead.length > 0 || c.passedFirst) && (
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <span className="text-dim">Chain</span>
          {c.passedFirst && (
            <span className="inline-flex items-center gap-1">
              <span className="line-through decoration-line-strong">first approvers</span>
              <span className="text-ghost">→</span>
            </span>
          )}
          {c.passed.map((r, i) => (
            <span key={`p-${i}`} className="inline-flex items-center gap-1">
              <span className="line-through decoration-line-strong">{r}</span>
              <span className="text-ghost">→</span>
            </span>
          ))}
          <span className="font-medium text-fg">{current.join(", ") || "current"}</span>
          {c.ahead.map((r, i) => (
            <span key={`a-${i}`} className="inline-flex items-center gap-1">
              <span className="text-ghost">→</span>
              <span>{r}</span>
            </span>
          ))}
          {gate.on_timeout && <span className="text-ghost">· on timeout: {gate.on_timeout}</span>}
        </span>
      )}
      {gate.escalations > 0 && (
        <span className="text-[11px]">
          Escalated {gate.escalations}× along the chain
          {c.ahead.length ? `; next ${c.ahead[0]} if this deadline passes` : gate.on_timeout === "escalate" ? "; the chain is spent, so when this deadline passes the gate is aborted and the run fails" : ""}
        </span>
      )}
      <NextLines gate={gate} />
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {/* An attached agent's gate (SDK, A2A): the answer goes back on its own channel, as the next steps above say. */}
        <RunSourceTag run={{ source: gate.source }} />
        <span>Waiting since {gate.waiting_since ? new Date(gate.waiting_since).toLocaleString() : "unknown"}</span>
        {gate.external.allowed && <Status tone="queue">may be answered from outside</Status>}
        {gate.job?.external_id && <span>· raised by {gate.job.source} as {gate.job.external_id}</span>}
      </span>
      {gate.warning && <span className="text-warn">{gate.warning}</span>}
    </div>
  );
}

/* ═══════════════════ evidence ═══════════════════ */

const scalar = (v: unknown) => v === null || v === undefined || ["string", "number", "boolean"].includes(typeof v);

function Value({ v }: { v: unknown }) {
  if (scalar(v)) return <span className="tnum min-w-0 truncate text-right font-mono text-[11px] text-fg">{String(v ?? "")}</span>;
  return (
    <pre className="max-h-40 min-w-0 overflow-auto rounded-sm border border-line bg-canvas px-2 py-1.5 text-left font-mono text-[10px] leading-[1.5] whitespace-pre-wrap text-mist">
      {JSON.stringify(v, null, 2)}
    </pre>
  );
}

export function EvidencePanel({ evidence, asks }: { evidence: Evidence; asks?: string }) {
  const decided = Object.entries(evidence.decided);
  const presented = Object.entries(evidence.presented);
  if (!decided.length && !presented.length && !evidence.tainted_by.length && !evidence.trail.length) return null;
  return (
    <div className="border-b border-line">
      {decided.length > 0 && (
        <>
          <span className="block px-4 pt-2.5 pb-1 text-[11px] font-semibold text-dim">What you are signing off</span>
          {decided.map(([k, v]) => (
            <div key={k} className={`flex gap-3 px-4 py-1.5 ${scalar(v) ? "items-baseline justify-between" : "flex-col"}`}>
              <span className="text-[11.5px] text-faint">{k.replace(/_/g, " ")}</span>
              <Value v={v} />
            </div>
          ))}
        </>
      )}
      {presented.length > 0 && (
        <>
          <span className="block px-4 pt-2.5 pb-1 text-[11px] font-semibold text-dim">What the gate was shown</span>
          {presented.map(([k, v]) => (
            <div key={k} className={`flex gap-3 px-4 py-1.5 ${scalar(v) ? "items-baseline justify-between" : "flex-col"}`}>
              <span className="text-[11.5px] text-faint">{k.replace(/_/g, " ")}</span>
              <Value v={v} />
            </div>
          ))}
        </>
      )}
      {evidence.tainted_by.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2">
          <Tag tone="warn">tainted input</Tag>
          <span className="text-[11px] text-faint">Some of this came from outside the firm: {evidence.tainted_by.join(", ")}</span>
        </div>
      )}
      {evidence.trail.length > 0 && (
        <>
          <span className="block px-4 pt-2.5 pb-1 text-[11px] font-semibold text-dim">How the run got here</span>
          <ol className="flex flex-col gap-1 px-4 pb-2.5">
            {evidence.trail.map((e) => (
              <li key={e.id || `${e.kind}-${e.t}`} className="flex min-w-0 items-baseline gap-2 text-[11.5px]">
                <Mono className="w-[84px] shrink-0 truncate text-[10px] text-ghost">{e.kind}</Mono>
                <span className="min-w-0 grow truncate text-mist">
                  {e.node && <span className="text-faint">{e.node} · </span>}
                  {e.summary || e.title || e.detail}
                </span>
                {e.tainted && <Tag tone="warn">tainted</Tag>}
              </li>
            ))}
          </ol>
        </>
      )}
      {asks && !decided.length && !presented.length && <p className="px-4 py-2 text-[11.5px] text-faint">{asks}</p>}
    </div>
  );
}

/* ═══════════════════ form fields ═══════════════════ */

const NOTE_LIKE = /note|reason|comment|rationale|justification|remark/i;

export function ChipEditor({ values, onChange, disabled, placeholder = "Type and press Enter", invalid }: { values: string[]; onChange: (v: string[]) => void; disabled?: boolean; placeholder?: string; invalid?: boolean }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const parts = draft.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    onChange([...values, ...parts.filter((p) => !values.includes(p))]);
    setDraft("");
  };
  return (
    <div className={`flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border bg-field px-2 py-1 ${invalid ? "border-err" : "border-line-strong"} ${disabled ? "cursor-not-allowed bg-raise" : ""}`}>
      {values.map((v) => (
        <span key={v} className="inline-flex items-center gap-1 rounded-sm border border-line bg-raise px-1.5 py-0.5 text-[11.5px] font-medium text-fg">
          {v}
          {!disabled && (
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="focusable -mr-0.5 grid size-4 cursor-pointer place-items-center rounded-xs text-faint hover:text-fg">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          )}
        </span>
      ))}
      <input
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          } else if (e.key === "Backspace" && !draft && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={add}
        placeholder={values.length ? "" : placeholder}
        aria-label="Add an entry"
        className="h-6 min-w-[8ch] grow bg-transparent text-[13px] text-fg placeholder:text-ghost focus:outline-none disabled:cursor-not-allowed"
      />
    </div>
  );
}

/** One input per field, by kind. `state` is the working state (lib/gates.ts FormState); `errors` is the last validation's. */
export function GateFields({ fields, state, errors, onChange, disabled }: { fields: GateField[]; state: FormState; errors: Record<string, string>; onChange: (name: string, v: FormState[string]) => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {fields.map((f) => {
        const label = `${f.label ?? f.name.replace(/_/g, " ")}${f.required ? " *" : ""}`;
        const hint = [f.hint, f.required ? "" : "optional"].filter(Boolean).join(" · ") || undefined;
        const err = errors[f.name];
        const raw = state[f.name];
        const wide = f.kind === "object" || f.kind === "list" || (f.kind === "string" && NOTE_LIKE.test(f.name));
        return (
          <div key={f.name} className={wide ? "sm:col-span-2" : ""}>
            <Field label={label} hint={hint} error={err}>
              {f.kind === "string" && NOTE_LIKE.test(f.name) ? (
                <Textarea rows={2} value={typeof raw === "string" ? raw : ""} onChange={(v) => onChange(f.name, v)} disabled={disabled} />
              ) : f.kind === "string" ? (
                <Input value={typeof raw === "string" ? raw : ""} onChange={(v) => onChange(f.name, v)} disabled={disabled} />
              ) : f.kind === "number" ? (
                <Input type="number" mono value={typeof raw === "string" ? raw : ""} onChange={(v) => onChange(f.name, v)} disabled={disabled} />
              ) : f.kind === "bool" ? (
                <Pick
                  size="md"
                  value={raw === true ? "true" : raw === false ? "false" : ""}
                  onChange={(v) => onChange(f.name, v === "" ? undefined : v === "true")}
                  options={[{ value: "", label: f.required ? "choose…" : "not answered" }, { value: "true", label: "yes" }, { value: "false", label: "no" }]}
                  disabled={disabled}
                />
              ) : f.kind === "choice" ? (
                <Pick
                  size="md"
                  value={typeof raw === "string" ? raw : ""}
                  onChange={(v) => onChange(f.name, v || undefined)}
                  options={[{ value: "", label: f.required ? "choose…" : "none" }, ...(f.choices ?? []).map((c) => ({ value: c, label: c }))]}
                  disabled={disabled}
                />
              ) : f.kind === "list" ? (
                <ChipEditor values={Array.isArray(raw) ? raw : []} onChange={(v) => onChange(f.name, v)} disabled={disabled} invalid={Boolean(err)} />
              ) : (
                <Textarea rows={4} mono value={typeof raw === "string" ? raw : ""} onChange={(v) => onChange(f.name, v)} placeholder={"{\n  \n}"} disabled={disabled} />
              )}
            </Field>
          </div>
        );
      })}
      {fields.length === 0 && <p className="text-[11.5px] text-faint sm:col-span-2">This form declares no fields; the note is the whole answer.</p>}
    </div>
  );
}

/* ═══════════════════ verdicts ═══════════════════ */

const EVIDENCE_COLUMNS = 3;

/**
 * A verdict per item of the register: the item with a few of its fields as
 * evidence, its current verdict, and a select limited to where it may move.
 * The bulk control sets every row that may take the verdict and leaves the
 * rest where they are.
 */
export function VerdictTable({ items, verdicts, transitions, chosen, errors, onChange, disabled }: { items: VerdictItem[]; verdicts: string[]; transitions: Record<string, string[]>; chosen: Record<string, string | undefined>; errors: Record<string, string>; onChange: (next: Record<string, string | undefined>) => void; disabled?: boolean }) {
  const [bulk, setBulk] = useState("");
  const columns = (() => {
    const seen: string[] = [];
    for (const it of items) for (const k of Object.keys(it.fields)) if (!seen.includes(k) && scalar(it.fields[k])) seen.push(k);
    return seen.filter((k) => !["title", "name", "summary"].includes(k)).slice(0, EVIDENCE_COLUMNS);
  })();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-medium text-mist">
          {items.length} item{items.length === 1 ? "" : "s"} · one verdict each
        </span>
        <span className="grow" />
        <span className="text-[11px] text-faint">Set all to</span>
        <div className="w-44">
          <Pick
            value={bulk}
            onChange={(v) => {
              setBulk(v);
              if (v) onChange(bulkVerdict(items, verdicts, transitions, chosen, v));
            }}
            options={[{ value: "", label: "choose…" }, ...verdicts.map((v) => ({ value: v, label: v }))]}
            disabled={disabled}
            aria-label="Set every verdict"
          />
        </div>
      </div>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full border-collapse text-[11.5px]">
          <thead className="bg-raise/60">
            <tr className="border-b border-line text-left text-[10.5px] text-faint">
              <th className="px-3 py-2 font-medium">Item</th>
              {columns.map((c) => (
                <th key={c} className="px-3 py-2 font-medium">{c.replace(/_/g, " ")}</th>
              ))}
              <th className="px-3 py-2 font-medium">Now</th>
              <th className="px-3 py-2 font-medium">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const allowed = allowedVerdicts(it.verdict, verdicts, transitions);
              const value = chosen[it.id] ?? it.verdict ?? "";
              const err = errors[it.id];
              return (
                <tr key={it.id} className="border-b border-line align-top last:border-0">
                  <td className="px-3 py-2">
                    <span className="flex flex-col">
                      <span className="text-[12px] font-medium text-fg">{it.title}</span>
                      {it.title !== it.id && <Mono className="text-[10px] text-faint">{it.id}</Mono>}
                    </span>
                  </td>
                  {columns.map((c) => (
                    <td key={c} className="max-w-[26ch] px-3 py-2 text-mist">
                      <span className="line-clamp-2">{String(it.fields[c] ?? "")}</span>
                    </td>
                  ))}
                  <td className="px-3 py-2">{it.verdict ? <Tag>{it.verdict}</Tag> : <span className="text-ghost">none</span>}</td>
                  <td className="min-w-[160px] px-3 py-1.5">
                    <Pick
                      value={value}
                      onChange={(v) => onChange({ ...chosen, [it.id]: v || undefined })}
                      options={[{ value: "", label: "choose…" }, ...allowed.map((v) => ({ value: v, label: v === it.verdict ? `${v} (unchanged)` : v }))]}
                      disabled={disabled || allowed.length === 0}
                      invalid={Boolean(err)}
                      aria-label={`Verdict for ${it.title}`}
                    />
                    {err && <span className="mt-1 block text-[11px] text-err">{err}</span>}
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={columns.length + 3} className="px-3 py-4 text-faint">The run emitted nothing under this register; there is nothing to rule on.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ═══════════════════ the signer ═══════════════════ */

export function SignerLine({ initials, name, as }: { initials: string; name: string; as?: ReactNode }) {
  return (
    <span className="flex items-center gap-2 text-[11.5px] text-faint">
      <span className="grid size-5 place-items-center rounded-full bg-ink text-[8.5px] font-semibold text-on-ink">{initials}</span>
      {as ?? (
        <>
          Signing as <span className="font-medium text-fg">{name}</span> · written into the run record
        </>
      )}
    </span>
  );
}
