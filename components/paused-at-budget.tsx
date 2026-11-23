"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Button, Meter, Status } from "./ui";
import { Section } from "./section";
import { Field, Input } from "./forms";
import { NotConnected, NotConnectedNote, Failure } from "./pending";
import { holdAgent, waited } from "./budget-holds-parts";
import { ReasonDialog } from "./retrieval-access-parts";
import { ask, type Answer, type BudgetHold, type BudgetHoldDecision, type BudgetHoldList, type Door } from "@/lib/api/pending";
import { useSession } from "@/lib/use-session";

/**
 * Paused at budget, on the Approvals page: the runs that reached a budget
 * and wait for a person (`GET /api/budget/holds`, agentfactory/budgets/paused.py).
 *
 * A run pauses at its own cost budget, at the deployment's period budget or
 * at its use case's. A person with the approve permission who did not start
 * the run decides (`POST /api/budget/holds/{id}/decide`): continue with an
 * amount, or stop, with a reason either way. What continuing means depends
 * on the budget reached. For the run's own budget, the amount is the run's
 * new budget. For a period budget, the budget itself is not changed (that is
 * done on the Costs page): this run alone may go on until the period's spend
 * reaches the amount. A hold waits until someone decides; it does not run
 * out by itself.
 */

type Notice = { tone: "ok" | "err"; text: string } | { door: Door };
/** What the service answers beside the console's `BudgetHold`: the budget reached, and why the run paused. */
export type Hold = BudgetHold & { scope?: "run" | "deployment" | "use_case"; key?: string; paused_because?: string };

const WHAT = "Runs paused at a budget are listed here: the budget each reached, why, how long it has waited, and the decision to continue or stop it.";
const th = "px-3 py-2 font-medium whitespace-nowrap";

/** The holds of an answer, or none when the address has not answered with a list. */
export function holdsOf(answer: Answer<BudgetHoldList> | null): Hold[] {
  return answer?.state === "ok" && Array.isArray(answer.data?.holds) ? (answer.data.holds as Hold[]) : [];
}

const at = (iso: string | undefined): number => (iso ? Date.parse(iso) || 0 : 0);
function when(iso: string | undefined): string {
  const t = at(iso);
  return t ? new Date(t).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
}
const dollars = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: Math.abs(n) < 1 ? 6 : 2 });
/** Spent against the budget, to the millionth of a dollar the service records: `$0.000109 of $0.000001 spent, $0.000108 over`. */
const usedLine = (h: Pick<BudgetHold, "used" | "limit">) => `${dollars(h.used)} of ${dollars(h.limit)} spent${h.used > h.limit ? `, ${dollars(h.used - h.limit)} over` : ""}`;

/** The budget a hold reached, in words. */
export function budgetName(h: Hold): string {
  if (h.scope === "deployment") return "the deployment's period budget";
  if (h.scope === "use_case") return `the period budget of the use case ${h.key || "not named"}`;
  if (h.scope === "run") return "its own budget";
  return "a budget the answer does not name";
}

const period = (h: Hold) => h.scope === "deployment" || h.scope === "use_case";

function RunCell({ hold: h }: { hold: Hold }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="truncate text-[12.5px] font-medium text-fg">{holdAgent(h)}</span>
      <Link href={`/runs?id=${encodeURIComponent(h.run)}`} className="focusable w-fit max-w-full truncate rounded-sm font-mono text-[10.5px] text-dim hover:underline">
        {h.run}
      </Link>
    </span>
  );
}

function Person({ who, none }: { who: BudgetHold["owner"]; none: string }) {
  if (!who) return <span className="text-faint">{none}</span>;
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-fg">{who.name || who.email || who.sub}</span>
      {(who.team || (who.name && who.email)) && <span className="truncate text-[10.5px] text-faint">{who.team || who.email}</span>}
    </span>
  );
}

function Reached({ hold: h, meter }: { hold: Hold; meter: boolean }) {
  return (
    <span className="flex flex-col gap-1">
      <span className="font-medium text-fg">{budgetName(h)[0].toUpperCase() + budgetName(h).slice(1)}</span>
      {meter && <Meter value={h.limit > 0 ? h.used / h.limit : 1} tone="warn" />}
      <span className="tnum text-[11.5px] leading-[1.45] text-dim">{usedLine(h)}</span>
      {h.paused_because && <span className="text-[11px] leading-[1.45] text-faint">{h.paused_because}</span>}
    </span>
  );
}

export function PausedAtBudget({ answer, reload, now }: { answer: Answer<BudgetHoldList> | null; reload: () => void; now: number }) {
  const { session, loaded } = useSession();
  const [deciding, setDeciding] = useState<{ hold: Hold; decision: BudgetHoldDecision["decision"] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const all = useMemo(() => holdsOf(answer), [answer]);
  const waiting = useMemo(() => all.filter((h) => h.state === "waiting").sort((a, b) => at(a.paused_at) - at(b.paused_at) || a.id.localeCompare(b.id)), [all]);
  const decided = useMemo(() => all.filter((h) => h.state !== "waiting").sort((a, b) => at(b.decided_at || b.paused_at) - at(a.decided_at || a.paused_at)), [all]);
  const connected = answer?.state === "ok";

  /** The second-person rule, said before a click: the person who started a run never decides its hold. */
  const starter = (h: Hold) => Boolean(loaded && session && h.owner?.sub && h.owner.sub === session.sub);

  const decide = async (body: BudgetHoldDecision) => {
    if (!deciding || busy) return;
    const h = deciding.hold;
    setBusy(true);
    const a = await ask<unknown>("budgetHoldDecide", { params: { id: h.id }, body });
    setBusy(false);
    setDeciding(null);
    if (a.state === "pending") return setNotice({ door: a.door });
    if (a.state === "error") return setNotice({ tone: "err", text: a.message });
    const to = dollars(body.raise_to ?? 0);
    setNotice({
      tone: "ok",
      text: body.decision === "stop" ? `Run ${h.run} is stopped.` : period(h) ? `Run ${h.run} goes on until ${budgetName(h)} has seen ${to} spent; the budget itself is unchanged.` : `Run ${h.run} goes on with its budget raised to ${to}.`,
    });
    reload();
  };

  const noticeText: ReactNode = notice ? "door" in notice ? <NotConnectedNote door={notice.door} /> : notice.text : null;

  return (
    <Section title="Paused at budget" hue="approvals" meta={connected ? `${waiting.length.toLocaleString("en-GB")} waiting${decided.length ? ` · ${decided.length.toLocaleString("en-GB")} decided` : ""}` : undefined}>
      {notice && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface px-3 py-2">
          {"tone" in notice && <Status tone={notice.tone}>{notice.tone === "err" ? "Refused" : "Done"}</Status>}
          <span className="min-w-0 text-[12.5px] leading-[1.5] text-fg">{noticeText}</span>
          <span className="grow" />
          <Button size="sm" variant="solid" tone="neutral" onClick={() => setNotice(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {answer === null && <p className="text-[12px] text-faint">Reading the runs paused at a budget…</p>}
      {answer?.state === "pending" && <NotConnected door={answer.door} compact>{WHAT}</NotConnected>}
      {answer?.state === "error" && <Failure what="The runs paused at a budget could not be read" message={answer.message} />}
      {connected && waiting.length === 0 && (
        <p className="text-[12px] leading-[1.55] text-faint">
          No run is paused at a budget. A run that reaches its own budget, the deployment&rsquo;s or its use case&rsquo;s pauses and is listed here until a person other than the one who started it decides.
        </p>
      )}

      {(waiting.length > 0 || decided.length > 0) && (
        <div className={`flex flex-col ${notice || waiting.length === 0 ? "-mx-4 -mb-4 border-t border-line" : "-m-4"}`}>
          {waiting.length > 0 && (
            <div className="af-list overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-line text-left text-[10.5px] text-faint">
                    <th className={`${th} pl-4`}>Agent and run</th>
                    <th className={th}>Started by</th>
                    <th className={th}>Budget reached</th>
                    <th className={th}>Waiting</th>
                    <th className={`${th} pr-4 text-right`}>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {waiting.map((h) => {
                    const own = starter(h);
                    const why = own ? "You started this run, so another person decides its hold." : undefined;
                    return (
                      <tr key={h.id} className="border-b border-line align-top last:border-b-0">
                        <td className="max-w-[260px] py-2.5 pr-3 pl-4">
                          <RunCell hold={h} />
                        </td>
                        <td className="max-w-[180px] px-3 py-2.5">
                          <Person who={h.owner} none="not recorded" />
                        </td>
                        <td className="w-[340px] max-w-[380px] px-3 py-2.5">
                          <Reached hold={h} meter />
                        </td>
                        <td className="tnum px-3 py-2.5 whitespace-nowrap text-dim" title={when(h.paused_at)}>
                          {at(h.paused_at) ? waited(now - at(h.paused_at)) : "unknown"}
                          <span className="block text-[10.5px] text-faint">until someone decides</span>
                        </td>
                        <td className="py-2.5 pr-4 pl-3 text-right">
                          <span className="inline-flex flex-wrap justify-end gap-1.5">
                            <Button size="sm" variant="solid" tone="ink" permission="approve" disabled={own} title={why} onClick={() => setDeciding({ hold: h, decision: "continue" })}>
                              Continue
                            </Button>
                            <Button size="sm" variant="solid" tone="err" permission="approve" disabled={own} title={why} onClick={() => setDeciding({ hold: h, decision: "stop" })}>
                              Stop the run
                            </Button>
                          </span>
                          {own && <span className="mt-1 block text-[10.5px] text-faint">{why}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {decided.length > 0 && (
            <>
              <div className={`flex items-center gap-2 border-b border-line bg-raise/55 px-4 py-2 ${waiting.length > 0 ? "border-t" : ""}`}>
                <span className="text-[12px] font-semibold text-fg">Decided</span>
                <span className="tnum text-[11px] text-faint">{decided.length.toLocaleString("en-GB")}</span>
              </div>
              <div className="af-list overflow-x-auto">
                <table className="w-full min-w-[980px] border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[10.5px] text-faint">
                      <th className={`${th} pl-4`}>Decided</th>
                      <th className={th}>Agent and run</th>
                      <th className={th}>Budget reached</th>
                      <th className={th}>Outcome</th>
                      <th className={th}>By</th>
                      <th className={`${th} pr-4`}>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decided.map((h) => (
                      <tr key={h.id} className="border-b border-line align-top last:border-b-0">
                        <td className="tnum py-2.5 pr-3 pl-4 whitespace-nowrap text-dim">{when(h.decided_at) || "time not recorded"}</td>
                        <td className="max-w-[240px] px-3 py-2.5">
                          <RunCell hold={h} />
                        </td>
                        <td className="max-w-[300px] px-3 py-2.5">
                          <Reached hold={h} meter={false} />
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="flex flex-col gap-0.5">
                            <Status tone={h.state === "continued" ? "ok" : "err"}>{h.state === "continued" ? "Continued" : h.state === "stopped" ? "Stopped" : String(h.state)}</Status>
                            {h.state === "continued" && (
                              <span className="tnum text-[11.5px] text-dim">
                                {h.raised_to === undefined ? "amount not recorded" : period(h) ? `may go on until ${dollars(h.raised_to)} is spent in the period` : `its budget raised to ${dollars(h.raised_to)}`}
                              </span>
                            )}
                          </span>
                        </td>
                        <td className="max-w-[180px] px-3 py-2.5">
                          <Person who={h.decided_by} none="not recorded" />
                        </td>
                        <td className="max-w-[360px] min-w-[220px] py-2.5 pr-4 pl-3 leading-[1.45] break-words text-dim">{h.reason || <span className="text-faint">none recorded</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {deciding && <Decide key={`${deciding.hold.id}:${deciding.decision}`} hold={deciding.hold} decision={deciding.decision} busy={busy} onConfirm={decide} onClose={() => !busy && setDeciding(null)} />}
    </Section>
  );
}

/** A typed amount in dollars; NaN when it is not one. */
function parseDollars(text: string): number {
  const t = text.trim().replace(/^\$/, "").replace(/[,\s]/g, "");
  return /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}

/** Decide one hold: continue with an amount (worded by the budget reached), or stop. A reason is recorded either way. */
function Decide({ hold: h, decision, busy, onConfirm, onClose }: { hold: Hold; decision: BudgetHoldDecision["decision"]; busy: boolean; onConfirm: (body: BudgetHoldDecision) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [pressed, setPressed] = useState(false);
  const reached = (
    <span>
      <span className="font-medium text-fg">{holdAgent(h)}</span> paused at {budgetName(h)}: {usedLine(h)}.
    </span>
  );

  if (decision === "stop") {
    return (
      <ReasonDialog
        title={`Stop run ${h.run}?`}
        confirm="Stop the run"
        tone="err"
        permission="approve"
        busy={busy}
        hint="Recorded with the decision and your name."
        missing="A reason is needed. It is recorded with the decision and your name."
        placeholder="Why this run stops here."
        onClose={onClose}
        onConfirm={(reason) => onConfirm({ decision: "stop", reason })}
      >
        {reached}
        <span>Stopping ends the run where it paused, as a kill does: what it still had to do is not done.</span>
      </ReasonDialog>
    );
  }

  const value = parseDollars(text);
  const valid = Number.isFinite(value) && value > h.used;
  const problem = !text.trim() ? "Enter the amount in dollars." : !Number.isFinite(value) ? "Enter an amount in dollars." : value <= h.used ? `It must be above ${dollars(h.used)}, which has been spent.` : "";
  const error = !valid && (text.trim() || pressed) ? problem : undefined;
  const label = period(h) ? "Let this run go on until the period's spend reaches, in dollars" : "The run's new budget, in dollars";

  return (
    <ReasonDialog
      title={`Continue run ${h.run}?`}
      confirm="Continue the run"
      tone="ink"
      permission="approve"
      busy={busy}
      ready={valid}
      onBlocked={() => setPressed(true)}
      hint="Recorded with the decision and your name."
      missing="A reason is needed. It is recorded with the decision and your name."
      placeholder="Why this run may spend more."
      onClose={onClose}
      onConfirm={(reason) => onConfirm({ decision: "continue", raise_to: value, reason })}
    >
      {reached}
      <Field label={label} error={error} hint={`Above ${dollars(h.used)}, spent so far.`}>
        <Input value={text} onChange={setText} disabled={busy} prefix="$" autoComplete="off" />
      </Field>
      {valid && (
        <span className="rounded-sm border border-line bg-canvas px-2 py-1.5 text-[12px] leading-[1.5] text-fg">
          {period(h)
            ? `${budgetName(h)[0].toUpperCase() + budgetName(h).slice(1)} stays ${dollars(h.limit)}; change it on the Costs page. This run alone goes on until the period's spend reaches ${dollars(value)}; other runs it applies to are still refused or paused.`
            : `The run's budget goes from ${dollars(h.limit)} to ${dollars(value)}: it can spend ${dollars(value - h.used)} more before it pauses again.`}
        </span>
      )}
    </ReasonDialog>
  );
}
