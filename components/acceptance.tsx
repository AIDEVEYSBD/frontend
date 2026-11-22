"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Button, Status } from "./ui";
import { Banner, Dialog, EmptyState, QuietNote } from "./overlays";
import { QUIET } from "@/lib/quiet";
import { Field, Textarea } from "./forms";
import { Pick } from "./select";
import { Chips } from "./filters";
import { GroupHeader } from "./page-tabs";
import { NotConnected, NotConnectedNote, useDoor } from "./pending";
import { SeverityTag, acceptanceStatusMeta, count, shortWhen, workloadName } from "./finding-marks";
import { hueFor } from "@/lib/hue";
import { useSession } from "@/lib/use-session";
import { WORKLOADS, ask, type Acceptance, type AcceptanceList, type Door } from "@/lib/api/pending";

/**
 * Acceptance (feature 12.5): the record of each use case's acceptance.
 *
 * One section per use case, as `GET /api/acceptance` returns it: the status
 * the record carries, the criteria with the threshold and the result of each
 * and whether it was met, the eval run those results came from, the issues
 * still outstanding, and the sign-offs by role. The Sign control records the
 * signed-in person's decision under a role the record names.
 *
 * The page reports the record and decides nothing: a use case reads as
 * accepted only when its record's status says so, a criterion as met only
 * when the record says so, and a role as signed only when it carries a
 * decision. A criterion without a result says it has none.
 */

type Decision = "accepted" | "rejected";

const DECISION: Record<Decision, { label: string; tone: "ok" | "err" }> = {
  accepted: { label: "Accepted", tone: "ok" },
  rejected: { label: "Rejected", tone: "err" },
};

const CRITERIA_HEAD = ["Criterion", "Metric", "Threshold", "Result", "Met"];
const SIGNOFF_HEAD = ["Role", "Who", "When", "Decision", "Note"];

const figure = (v: unknown): string => (typeof v === "number" && Number.isFinite(v) ? v.toLocaleString("en-GB", { maximumFractionDigits: 4 }) : "");

function Rows({ head, right = [], min = 640, children }: { head: string[]; right?: number[]; min?: number; children?: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full border-collapse text-[11.5px]" style={{ minWidth: min }}>
        <thead>
          <tr className="border-b border-line bg-raise/40 text-left text-[10.5px] text-faint last:border-b-0">
            {head.map((h, i) => (
              <th key={h} className={`px-3 py-1.5 font-medium whitespace-nowrap ${right.includes(i) ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        {children && <tbody>{children}</tbody>}
      </table>
    </div>
  );
}

function Block({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[12px] font-semibold text-fg">{title}</span>
        {meta && <span className="tnum text-[11px] text-faint">{meta}</span>}
      </span>
      {children}
    </div>
  );
}

/* ═══════════════════ signing ═══════════════════ */

/** Record the signed-in person's decision on a use case, under a role its record names. */
function Sign({ record, disabled = false, onSigned }: { record: Acceptance | null; disabled?: boolean; onSigned: () => void }) {
  const { session } = useSession();
  const roles = [...new Set((record?.signoffs ?? []).map((s) => s.role).filter(Boolean))];
  // The person's own roles, as the identity provider names them: the one of them the record asks for is offered first.
  const mine = new Set([...(session?.appRoles ?? []), ...(session?.groups ?? []), ...(session?.roles ?? [])].map((r) => r.toLowerCase()));
  const matching = roles.filter((r) => mine.has(r.toLowerCase()));
  const [picked, setPicked] = useState<string | null>(null);
  const role = picked ?? (matching.length === 1 ? matching[0] : roles.length === 1 ? roles[0] : "");
  const [decision, setDecision] = useState<Decision | "">("");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Door | null>(null);

  const name = record ? workloadName(record.use_case) : "";
  const noteNeeded = decision === "rejected";
  const ready = Boolean(record && decision && (roles.length === 0 || role) && (!noteNeeded || note.trim()));
  const already = record?.signoffs.find((s) => s.role === role && s.decision);
  const as = role ? `as ${role}` : "under your own roles";

  const submit = async () => {
    if (!record || !decision) return;
    setBusy(true);
    setError("");
    const a = await ask<unknown>("acceptanceSign", { params: { use_case: record.use_case }, body: { ...(role ? { role } : {}), decision, note: note.trim() } });
    setBusy(false);
    setConfirming(false);
    if (a.state === "pending") return setPending(a.door);
    if (a.state === "error") return setError(a.message);
    setDecision("");
    setNote("");
    onSigned();
  };

  return (
    <Block title="Sign" meta={session?.name ? `signing as ${session.name}` : undefined}>
      <div className="flex flex-col gap-3 rounded-md border border-line bg-canvas p-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,240px)_max-content_minmax(0,1fr)]">
          <Field
            label="Role you sign as"
            hint={
              roles.length === 0
                ? record
                  ? `The record names no sign-off role; the signature is kept under your own roles${session?.appRoles.length ? ` (${session.appRoles.join(", ")})` : ""}.`
                  : undefined
                : already
                  ? `This role already carries a decision${already.by ? ` by ${already.by}` : ""}.`
                  : undefined
            }
          >
            <Pick value={role} onChange={setPicked} disabled={disabled || busy || roles.length === 0} options={[{ value: "", label: roles.length ? "Choose a role" : "No role named" }, ...roles.map((r) => ({ value: r, label: r }))]} />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium text-mist">Decision</span>
            <span className={`flex h-8 items-center ${disabled ? "pointer-events-none opacity-40" : ""}`} aria-disabled={disabled || undefined}>
              <Chips
                items={[
                  { value: "accepted", label: "Accept", active: decision === "accepted" },
                  { value: "rejected", label: "Reject", active: decision === "rejected" },
                ]}
                onToggle={(v) => setDecision(decision === v ? "" : (v as Decision))}
              />
            </span>
          </div>
          <Field label="Note" hint={noteNeeded ? "Required for a rejection." : "Kept with the signature."}>
            <Textarea value={note} onChange={setNote} rows={2} disabled={disabled || busy} placeholder="What the decision rests on" />
          </Field>
        </div>
        <span className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="solid" tone="ink" permission="approve" disabled={disabled || !ready} loading={busy} onClick={() => setConfirming(true)}>
            {role ? `Sign as ${role}` : "Sign"}
          </Button>
          {error && (QUIET ? <QuietNote inline /> : <span className="text-[11.5px] text-err">{error}</span>)}
        </span>
        {(disabled || pending) && <NotConnectedNote door={pending ?? "acceptanceSign"} />}
      </div>
      {confirming && record && decision && (
        <Dialog
          modal
          title={`Sign ${name} ${as}?`}
          confirm={decision === "accepted" ? "Sign: accept" : "Sign: reject"}
          tone="ink"
          loading={busy}
          onConfirm={submit}
          onClose={() => setConfirming(false)}
        >
          This records your decision, {DECISION[decision].label.toLowerCase()}, on the acceptance of {name} {as}, with your name and the time.
          {already ? " The role already carries a decision; the record keeps what the control plane makes of a second one." : ""}
        </Dialog>
      )}
    </Block>
  );
}

/* ═══════════════════ one use case ═══════════════════ */

/** One use case's record. Presentational, apart from the Sign control. */
export function AcceptanceRecord({ record, onSigned }: { record: Acceptance; onSigned: () => void }) {
  const r = record;
  const criteria = Array.isArray(r.criteria) ? r.criteria : [];
  const issues = Array.isArray(r.issues) ? r.issues : [];
  const signoffs = Array.isArray(r.signoffs) ? r.signoffs : [];
  const status = acceptanceStatusMeta(r.status);
  const met = criteria.filter((c) => c.met === true).length;
  const notMet = criteria.filter((c) => c.met === false).length;
  const unstated = criteria.length - met - notMet;
  const openIssues = issues.filter((i) => i.state === "open").length;
  const signed = signoffs.filter((s) => s.decision).length;

  return (
    <section id={r.use_case} className="flex min-w-0 scroll-mt-4 flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1" data-use-case={r.use_case}>
      <div data-hue={hueFor("approval")} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-raise/55 px-4 py-2.5">
        <span className="text-[13px] font-semibold tracking-[-0.005em] text-fg">{workloadName(r.use_case)}</span>
        {r.agent && <span className="font-mono text-[10.5px] break-all text-faint">{r.agent}</span>}
        <span className="grow" />
        <span className="flex items-center gap-2">
          <span className="text-[11px] text-faint">Record status</span>
          <Status tone={status.tone} chip>
            {status.label}
          </Status>
        </span>
      </div>

      <div className="flex flex-col gap-5 p-4">
        <Block
          title="Criteria"
          meta={criteria.length ? [`${count(met)} met`, `${count(notMet)} not met`, unstated ? `${count(unstated)} without a result` : ""].filter(Boolean).join(" · ") : undefined}
        >
          {criteria.length === 0 ? (
            <p className="text-[12px] text-faint">The record lists no criteria.</p>
          ) : (
            <Rows head={CRITERIA_HEAD} right={[2, 3]}>
              {criteria.map((c) => (
                <tr key={c.id} className="border-b border-line align-top last:border-0">
                  <td className="max-w-[520px] px-3 py-2">
                    <span className="text-[12px] break-words text-fg">{c.text}</span>
                    <div className="font-mono text-[10.5px] text-faint">{c.id}</div>
                  </td>
                  <td className="px-3 py-2 text-dim">{c.metric ?? ""}</td>
                  <td className="tnum px-3 py-2 text-right text-dim">{figure(c.threshold)}</td>
                  <td className="tnum px-3 py-2 text-right font-medium text-fg">{figure(c.result) || <span className="font-normal text-faint">no result</span>}</td>
                  <td className="px-3 py-2">
                    {c.met === true ? <Status tone="ok">Met</Status> : c.met === false ? <Status tone="err">Not met</Status> : <Status tone="neutral">Not stated</Status>}
                  </td>
                </tr>
              ))}
            </Rows>
          )}
          <p className="text-[11.5px] text-faint">
            {r.eval_run ? (
              <>
                Results from eval run{" "}
                <Link href="/evals" className="focusable rounded-sm font-mono text-[10.5px] text-dim underline decoration-line-strong underline-offset-2 hover:text-fg">
                  {r.eval_run}
                </Link>
                .
              </>
            ) : (
              "The record names no eval run for these results."
            )}
          </p>
        </Block>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          <Block title="Outstanding issues" meta={issues.length ? `${count(openIssues)} open of ${count(issues.length)}` : undefined}>
            {issues.length === 0 ? (
              <p className="text-[12px] text-faint">The record lists no issues.</p>
            ) : (
              <ul className="flex flex-col overflow-hidden rounded-md border border-line">
                {issues.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-line px-3 py-2 last:border-b-0">
                    <span className="flex w-14 shrink-0">
                      <SeverityTag severity={i.severity} />
                    </span>
                    <span className="flex min-w-0 grow basis-[55%] flex-col gap-0.5">
                      <span className="text-[12px] break-words text-fg">{i.text}</span>
                      <span className="font-mono text-[10.5px] text-faint">{i.id}</span>
                    </span>
                    {i.state === "closed" ? <Status tone="ok">Closed</Status> : <Status tone="warn">Open</Status>}
                  </li>
                ))}
              </ul>
            )}
          </Block>

          <Block title="Sign-offs" meta={signoffs.length ? `${count(signed)} of ${count(signoffs.length)} roles signed` : undefined}>
            {signoffs.length === 0 ? (
              <p className="text-[12px] text-faint">The record names no sign-off roles.</p>
            ) : (
              <Rows head={SIGNOFF_HEAD} min={560}>
                {signoffs.map((s, i) => (
                  <tr key={`${s.role}-${i}`} className="border-b border-line align-top last:border-0">
                    <td className="px-3 py-2 text-[12px] font-medium text-fg">{s.role}</td>
                    <td className="px-3 py-2 text-dim">{s.by ?? ""}</td>
                    <td className="tnum px-3 py-2 whitespace-nowrap text-faint" title={s.at}>
                      {shortWhen(s.at)}
                    </td>
                    <td className="px-3 py-2">{s.decision && DECISION[s.decision] ? <Status tone={DECISION[s.decision].tone}>{DECISION[s.decision].label}</Status> : <Status tone="neutral">Not signed</Status>}</td>
                    <td className="max-w-[320px] px-3 py-2 break-words text-dim">{s.note ?? ""}</td>
                  </tr>
                ))}
              </Rows>
            )}
          </Block>
        </div>

        <Sign record={r} onSigned={onSigned} />
      </div>
    </section>
  );
}

/* ═══════════════════ the page ═══════════════════ */

export function AcceptanceView() {
  const { answer, reload } = useDoor<AcceptanceList>("acceptance");
  const order = (id: string) => {
    const i = WORKLOADS.findIndex((w) => w.id === id);
    return i < 0 ? WORKLOADS.length : i;
  };
  const records = answer?.state === "ok" && Array.isArray(answer.data?.use_cases) ? [...answer.data.use_cases].sort((a, b) => order(a.use_case) - order(b.use_case)) : [];

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-5 px-5 py-7" data-hue="amber">
      <GroupHeader group="quality" tab="acceptance">
        The acceptance record of each use case: its criteria with the result of each, the evaluation run the results came from, the issues still outstanding and the sign-offs by role. A use case is accepted when its record says so.
      </GroupHeader>

      {answer === null && <p className="text-[12px] text-faint">Reading the acceptance records…</p>}

      {answer?.state === "error" && (
        <Banner tone="err" title="Could not read the acceptance records" action={<Button size="sm" variant="solid" tone="neutral" onClick={reload}>Try again</Button>}>
          {answer.message}
        </Banner>
      )}

      {answer?.state === "pending" && (
        <>
          <NotConnected door={answer.door} />
          <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
            <div data-hue={hueFor("approval")} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-raise/55 px-4 py-2.5">
              <span className="text-[13px] font-semibold tracking-[-0.005em] text-fg">A use case&rsquo;s record</span>
              <span className="text-[11px] text-faint">none read</span>
            </div>
            <div className="flex flex-col gap-5 p-4">
              <Block title="Criteria">
                <Rows head={CRITERIA_HEAD} right={[2, 3]} />
              </Block>
              <Block title="Sign-offs">
                <Rows head={SIGNOFF_HEAD} min={560} />
              </Block>
              <Sign record={null} disabled onSigned={reload} />
            </div>
          </section>
        </>
      )}

      {answer?.state === "ok" && records.length === 0 && <EmptyState title="No acceptance record yet" detail="A use case appears here once its acceptance record is opened, with its criteria and the roles that sign it." />}

      {records.map((r) => (
        <AcceptanceRecord key={r.use_case} record={r} onSigned={reload} />
      ))}
    </div>
  );
}
