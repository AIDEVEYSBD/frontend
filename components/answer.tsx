"use client";

import { useEffect, useState } from "react";
import { Button, Mono, Status } from "./ui";
import { Field, Textarea } from "./forms";
import { Banner } from "./overlays";
import { BrandLockup } from "./brand";
import { Material } from "./material";
import { DoorError, readExternalGate, submitExternalAnswer, type Answer, type AnswerResult, type ExternalGate } from "@/lib/api/l5";
import { declaresNote, emptyForm, refusalErrors, validateForm, validateVerdicts, type FormState } from "@/lib/gates";
import { Deadline, EvidencePanel, GateFields, NextLines, ShapeTag, VerdictTable, useNow } from "./gate-form";

/**
 * Why a link does not open, by the platform's status: 410 a link that was
 * used or has expired, 404 a token that is not one, 403 a link made for
 * another address than the one signed in, 401 nobody signed in, 409 a gate
 * that has moved on (answered elsewhere, or the run moved on or ended).
 */
function linkTrouble(status: number): string {
  if (status === 410) return "This link has been used or has expired";
  if (status === 404) return "This link is not valid";
  if (status === 403) return "This link was made for someone else";
  if (status === 401) return "You are not signed in";
  if (status === 409) return "The question this link was made for has moved on";
  return "This link cannot be opened";
}

/**
 * An outside approver answers one gate.
 *
 * The person is signed in by the identity proxy like everyone else and
 * holds no platform role. The link in the page's address was made by
 * someone who could answer the gate, for one email address, one run and one
 * gate; the platform lets only that address use it, once, before it
 * expires. The platform hands over the gate's question, shape and evidence
 * (`GET /api/answer/{token}`), the same components the console's inbox uses
 * render it, and the answer goes back the same way (`POST
 * /api/answer/{token}`), signed `external:<email>`, which the page says
 * plainly before anything is pressed. The console's navigation stays off
 * this page (lib/route-policy.ts OPEN_PREFIXES): nothing else of the
 * console is shown to a person with no role.
 */
export function AnswerPage({ token }: { token: string }) {
  const [data, setData] = useState<ExternalGate | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const now = useNow();

  const [form, setForm] = useState<FormState>({});
  const [chosen, setChosen] = useState<Record<string, string | undefined>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "refuse" | "submit" | null>(null);
  const [result, setResult] = useState<AnswerResult | null>(null);
  /** What was sent, for the line beside the result. */
  const [label, setLabel] = useState("");
  const [failure, setFailure] = useState("");

  useEffect(() => {
    let stop = false;
    readExternalGate(token)
      .then((d) => {
        if (stop) return;
        setData(d);
        setForm(emptyForm(d.gate.fields));
      })
      .catch((e) => !stop && setLoadError({ status: e instanceof DoorError ? e.status : 0, message: (e as Error).message }));
    return () => {
      stop = true;
    };
  }, [token]);

  const submit = async (decision?: boolean) => {
    if (!data) return;
    const g = data.gate;
    let answer: Answer;
    if (g.shape === "decision") {
      answer = { approved: Boolean(decision) };
    } else if (g.shape === "form") {
      const c = validateForm(g.fields, form);
      if (!c.ok) {
        setErrors(c.errors);
        return;
      }
      answer = c.answer;
    } else {
      const c = validateVerdicts(g.items, g.verdicts, g.transitions, chosen);
      if (!c.ok) {
        setErrors(c.errors);
        return;
      }
      answer = c.answer;
    }
    setErrors({});
    setFailure("");
    setLabel(g.shape === "decision" ? (decision ? "Approved" : "Refused") : g.shape === "form" ? "Submitted" : "Verdicts recorded");
    setBusy(decision === undefined ? "submit" : decision ? "approve" : "refuse");
    try {
      setResult(await submitExternalAnswer(token, answer, note.trim()));
    } catch (e) {
      // A 400 names the field it refused: mark it where it was typed.
      const marked = e instanceof DoorError ? refusalErrors(g, e.field, e.message) : {};
      if (Object.keys(marked).length) setErrors(marked);
      setFailure((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const done = Boolean(result?.ok || result?.state === "closed");

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <Material />
      <header className="relative z-20 flex h-12 shrink-0 items-center gap-3 border-b border-line bg-surface px-4">
        <BrandLockup line={false} />
        <span className="text-[11.5px] text-faint">· a question for you</span>
        <span className="grow" />
      </header>

      <main className="mx-auto flex w-full max-w-[860px] flex-col gap-4 px-4 py-7 sm:px-5">
        {loadError && (
          <Banner tone="err" title={linkTrouble(loadError.status)}>
            {loadError.message}
          </Banner>
        )}
        {!data && !loadError && <p className="text-[12.5px] text-faint">Reading the gate…</p>}

        {data && (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium tracking-[0.08em] text-faint uppercase">Human gate</span>
              <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">{data.gate.agent} is waiting for your answer</h1>
              <p className="max-w-[64ch] text-[12.5px] leading-[1.55] text-dim">{data.gate.asks || "A workflow paused here for your answer."}</p>
            </div>

            <Banner tone="queue" title={`Answering as ${data.answered_as || "an external participant"}`}>
              The link works once{data.expires_at ? ` and expires ${new Date(data.expires_at).toLocaleString()}` : ""}.
            </Banner>

            <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
              <div data-hue="amber" className="flex w-full flex-wrap items-center gap-3 border-b border-line bg-raise/55 px-4 py-2.5">
                <Status tone="warn">gate</Status>
                <span className="text-[12.5px] font-semibold tracking-[-0.005em]">{data.gate.node}</span>
                <ShapeTag shape={data.gate.shape} />
                <span className="grow" />
                <Mono className="text-[10px] text-ghost">{data.gate.run}</Mono>
              </div>
              <EvidencePanel evidence={data.gate.evidence} />
              {/* What the link is told: when the answer is due and what each answer does. Who else may answer is the firm's, not the page's. */}
              <div className="flex flex-col gap-2 border-b border-line px-4 py-3 text-[11.5px] text-faint">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-dim">Answer due</span>
                  <Deadline deadline={data.gate.deadline} now={now} />
                </span>
                <NextLines gate={data.gate} />
              </div>

              <div className="flex flex-col gap-3 px-4 py-3">
                {data.gate.shape === "form" && (
                  <GateFields fields={data.gate.fields} state={form} errors={errors} onChange={(name, v) => { setForm((f) => ({ ...f, [name]: v })); setErrors((e) => ({ ...e, [name]: "" })); }} disabled={Boolean(busy) || done} />
                )}
                {data.gate.shape === "verdicts" && (
                  <VerdictTable items={data.gate.items} verdicts={data.gate.verdicts} transitions={data.gate.transitions} chosen={chosen} errors={errors} onChange={(c) => { setChosen(c); setErrors({}); }} disabled={Boolean(busy) || done} />
                )}
                {data.gate.shape === "decision" && errors.decision && <p className="text-[11.5px] text-err">{errors.decision}</p>}
                {/* A form with its own note field takes the note there: a second box would overwrite it. */}
                {!declaresNote(data.gate) && (
                  <Field label={data.gate.shape === "decision" ? "Reason" : "Note"} hint="Optional; recorded beside your answer.">
                    <Textarea rows={3} value={note} onChange={setNote} disabled={Boolean(busy) || done} placeholder={data.gate.shape === "decision" ? "Why this decision stands." : "Anything the record should carry beside the answer."} />
                  </Field>
                )}
                {failure && <p className="text-[11.5px] leading-[1.55] text-err">{failure}</p>}
                {result && (
                  <p className={`text-[11.5px] leading-[1.55] ${done ? "text-ok" : "text-err"}`}>
                    {done ? `${label}; the link is now spent.` : `${label}, but the workflow could not continue${result.error ? `: ${result.error}` : "."}`}
                  </p>
                )}
              </div>

              <footer className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
                {data.gate.shape === "decision" ? (
                  <>
                    <Button size="md" variant="solid" tone="ink" loading={busy === "approve"} disabled={Boolean(busy) || done} onClick={() => submit(true)}>
                      Approve
                    </Button>
                    <Button size="md" variant="solid" tone="err" loading={busy === "refuse"} disabled={Boolean(busy) || done} onClick={() => submit(false)}>
                      Refuse
                    </Button>
                  </>
                ) : (
                  <Button size="md" variant="solid" tone="ink" loading={busy === "submit"} disabled={Boolean(busy) || done} onClick={() => submit()}>
                    {data.gate.shape === "form" ? "Submit answer" : "Record verdicts"}
                  </Button>
                )}
                <span className="grow" />
                <span className="text-[10.5px] text-ghost">Signed {data.answered_as || "external"} · opening and answering are audited</span>
              </footer>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
