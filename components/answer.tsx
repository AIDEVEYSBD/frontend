"use client";

import { useEffect, useState } from "react";
import { Button, Mono, Status } from "./ui";
import { Field, Textarea } from "./forms";
import { Banner } from "./overlays";
import { BrandLockup } from "./brand";
import { Material } from "./material";
import { ThemeToggle } from "./theme";
import { DoorError, readExternalGate, submitExternalAnswer, type Answer, type AnswerResult, type ExternalGate } from "@/lib/api/l5";
import { declaresNote, emptyForm, refusalErrors, validateForm, validateVerdicts, type FormState } from "@/lib/gates";
import { Deadline, EvidencePanel, GateFields, NextLines, ShapeTag, VerdictTable, useNow } from "./gate-form";

/**
 * Why a link does not open, by the door's status: 410 is a link that was
 * one and is no more (used, expired, or its gate closed), 404 a token that
 * is not one of ours, 409 a run that is running right now.
 */
function linkTrouble(status: number): { title: string; tail: string } {
  if (status === 410) return { title: "This link has been used or has expired", tail: "Ask the person who sent it for a new one." };
  if (status === 404) return { title: "This link is not valid", tail: "Check that the whole address was copied, or ask the person who sent it for a new one." };
  if (status === 409) return { title: "The workflow is running right now", tail: "It is not waiting for an answer at this moment; try the link again shortly." };
  return { title: "This link cannot be opened", tail: "Try again, or ask the person who sent it for a new one." };
}

/**
 * An outside participant answers one gate.
 *
 * The page needs no sign-in: the token in its address is the signed link
 * an approver minted for one email, one run and one gate, and it is spent
 * when the answer lands. The backend hands over the gate's evidence and
 * shape (`GET /api/answer/{token}`), the same components the console's
 * inbox uses render it, and the answer goes back the same way (`POST
 * /api/answer/{token}`), written into the run record as
 * `external:<email>`, which the page says plainly before anything is
 * pressed.
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
        <ThemeToggle />
      </header>

      <main className="mx-auto flex w-full max-w-[860px] flex-col gap-4 px-4 py-7 sm:px-5">
        {loadError && (
          <Banner tone="err" title={linkTrouble(loadError.status).title}>
            {loadError.message}. {linkTrouble(loadError.status).tail}
          </Banner>
        )}
        {!data && !loadError && <p className="text-[12.5px] text-faint">Reading the gate…</p>}

        {data && (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium tracking-[0.08em] text-faint uppercase">Human gate</span>
              <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">{data.gate.agent} is waiting for your answer</h1>
              <p className="max-w-[64ch] text-[12.5px] leading-[1.55] text-dim">{data.gate.asks || "A workflow paused here for a person, and that person is you."}</p>
            </div>

            <Banner tone="queue" title={`Answering as ${data.answered_as || "an external participant"}`}>
              Your answer is written into the run record under that name, with the time and this note. The link works once
              {data.expires_at ? ` and expires ${new Date(data.expires_at).toLocaleString()}` : ""}.
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
                  <Field label={data.gate.shape === "decision" ? "Reason" : "Note"} hint="Optional. It goes into the record beside your answer.">
                    <Textarea rows={3} value={note} onChange={setNote} disabled={Boolean(busy) || done} placeholder={data.gate.shape === "decision" ? "Why this decision stands." : "Anything the record should carry beside the answer."} />
                  </Field>
                )}
                {failure && <p className="text-[11.5px] leading-[1.55] text-err">{failure}</p>}
                {result && (
                  <p className={`text-[11.5px] leading-[1.55] ${done ? "text-ok" : "text-err"}`}>
                    {done ? `${label}. ${result.delivered || "The workflow is continuing; thank you."}` : `${label}, but the workflow could not continue. ${result.error}`.trim()}
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
                <span className="text-[10.5px] text-ghost">Signed by the link, as {data.answered_as || "external"}; nothing else about you is recorded.</span>
              </footer>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
