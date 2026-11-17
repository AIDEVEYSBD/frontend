"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Button, Meter, Status } from "./ui";
import { QuietNote } from "./overlays";
import { Section } from "./section";
import { NotConnected, NotConnectedNote } from "./pending";
import { DecideDialog, amount, holdAgent, measureLabel, usedLine, waited } from "./budget-holds-parts";
import { QUIET } from "@/lib/quiet";
import { ask, type Answer, type BudgetHold, type BudgetHoldDecision, type BudgetHoldList, type Door } from "@/lib/api/pending";

/**
 * Paused at budget: the runs that reached a ceiling and wait for a person.
 *
 * A run that reaches its budget for tool calls, tokens, cost or elapsed
 * time pauses, and someone with the approve permission decides whether it
 * continues with a raised ceiling or stops. This is that queue, on the
 * Approvals page beside the gates, with the holds already decided below it.
 *
 * The section is ahead of its doors (`budgetHolds`, `budgetHoldDecide` in
 * lib/api/pending.ts). The page reads the door once, for the figure at its
 * top and for this section, and hands the answer down. Where the page is
 * already saying nothing is connected (`calm`), the section keeps to its
 * heading and one line; no row is ever made up.
 */

type Notice = { tone: "ok" | "err"; text: string } | { door: Door };

const WHAT = "Runs paused at their budget are listed here, with the ceiling each one reached, how long it has waited and the decision to continue or stop it.";
const th = "px-3 py-2 font-medium whitespace-nowrap";
/*
 * A hold's two decisions sit in the last column on a wide window. On a narrower one that column would scroll
 * out of sight, so it is dropped and the same decisions are drawn under the run, where they stay in view.
 */
const actCol = "hidden py-2 pr-4 pl-3 text-right xl:table-cell";

/** The holds of an answer, or none when the door has not answered with a list. */
export function holdsOf(answer: Answer<BudgetHoldList> | null): BudgetHold[] {
  return answer?.state === "ok" && Array.isArray(answer.data?.holds) ? answer.data.holds : [];
}

const at = (iso: string | undefined): number => (iso ? Date.parse(iso) || 0 : 0);

/** A time as the Approvals page writes one: `16 Nov 2026, 04:22`. */
function when(iso: string | undefined): string {
  const t = at(iso);
  return t ? new Date(t).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
}

/** When a hold ends by itself: how long is left, and that the run then stops. */
function Ends({ hold: h, now }: { hold: BudgetHold; now: number }) {
  if (!h.expires_at) return <span className="text-[11.5px] leading-[1.45] text-dim">It waits until someone decides.</span>;
  const left = at(h.expires_at) - now;
  const soon = left < 15 * 60_000;
  return (
    <span className="flex flex-col gap-0.5" title={when(h.expires_at)}>
      <span className={`tnum inline-flex items-center gap-1.5 font-mono text-[11px] whitespace-nowrap ${soon ? "text-warn" : "text-dim"}`}>
        <span className={`size-1.5 shrink-0 rounded-[2px] ${soon ? "bg-warn" : "bg-faint"}`} />
        {left > 0 ? `${waited(left)} left` : "due now"}
      </span>
      <span className="text-[10.5px] text-faint">then the run stops</span>
    </span>
  );
}

function RunCell({ hold: h }: { hold: BudgetHold }) {
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

const OUTCOME: Record<string, { tone: "ok" | "err" | "neutral"; label: string }> = {
  continued: { tone: "ok", label: "Continued" },
  stopped: { tone: "err", label: "Stopped" },
  expired: { tone: "neutral", label: "Expired" },
};

export function BudgetHolds({ answer, reload, now, calm }: { answer: Answer<BudgetHoldList> | null; reload: () => void; now: number; /** The page already says nothing is connected: say what will appear, and no more. */ calm: boolean }) {
  const [deciding, setDeciding] = useState<{ hold: BudgetHold; decision: BudgetHoldDecision["decision"] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const all = useMemo(() => holdsOf(answer), [answer]);
  // Waiting: the hold that ends by itself soonest first, then the longest wait.
  const waiting = useMemo(
    () => all.filter((h) => h.state === "waiting").sort((a, b) => (at(a.expires_at) || Number.POSITIVE_INFINITY) - (at(b.expires_at) || Number.POSITIVE_INFINITY) || at(a.paused_at) - at(b.paused_at) || a.id.localeCompare(b.id)),
    [all],
  );
  const decided = useMemo(() => all.filter((h) => h.state !== "waiting").sort((a, b) => at(b.decided_at || b.paused_at) - at(a.decided_at || a.paused_at)), [all]);
  const connected = answer?.state === "ok";

  const decide = async (body: BudgetHoldDecision) => {
    if (!deciding || busy) return;
    const h = deciding.hold;
    setBusy(true);
    const a = await ask<unknown>("budgetHoldDecide", { params: { id: h.id }, body });
    setBusy(false);
    setDeciding(null);
    if (a.state === "pending") return setNotice({ door: a.door });
    if (a.state === "error") return setNotice({ tone: "err", text: a.message });
    setNotice({ tone: "ok", text: body.decision === "continue" ? `Run ${h.run} continues with a ceiling of ${amount(h.measure, body.raise_to ?? h.limit)}.` : `Run ${h.run} was stopped.` });
    reload();
  };

  const noticeText: ReactNode = notice ? "door" in notice ? <NotConnectedNote door={notice.door} /> : notice.tone === "err" && QUIET ? <QuietNote inline /> : notice.text : null;

  return (
    <Section title="Paused at budget" hue="approvals" meta={connected ? `${waiting.length.toLocaleString("en-GB")} waiting${decided.length ? ` · ${decided.length.toLocaleString("en-GB")} decided` : ""}` : undefined}>
      {notice && (
        <div className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface px-3 py-2">
          {"tone" in notice && !(notice.tone === "err" && QUIET) && <Status tone={notice.tone}>{notice.tone === "err" ? "Refused" : "Done"}</Status>}
          <span className="min-w-0 text-[12.5px] leading-[1.5] text-fg">{noticeText}</span>
          <span className="grow" />
          <Button size="sm" variant="solid" tone="neutral" onClick={() => setNotice(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {answer === null && <p className="text-[12px] text-faint">Reading the runs paused at budget…</p>}
      {answer?.state === "pending" && (calm ? <p className="text-[12px] text-faint">{WHAT}</p> : <NotConnected door={answer.door} compact>{WHAT}</NotConnected>)}
      {answer?.state === "error" &&
        (QUIET ? calm ? <p className="text-[12px] text-faint">{WHAT}</p> : <QuietNote inline /> : <p className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err">The runs paused at budget could not be read: {answer.message}</p>)}
      {connected && waiting.length === 0 && <p className="text-[12px] text-faint">No run is paused at its budget. A run that reaches a ceiling and waits for a person is listed here with what it reached.</p>}

      {(waiting.length > 0 || decided.length > 0) && (
        <div className={`flex flex-col ${notice || waiting.length === 0 ? "-mx-4 -mb-4 border-t border-line" : "-m-4"}`}>
          {waiting.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[740px] border-collapse text-[12px] xl:min-w-[980px]">
                <thead>
                  <tr className="border-b border-line text-left text-[10.5px] text-faint">
                    <th className={`${th} pl-4`}>Agent and run</th>
                    <th className={th}>Started by</th>
                    <th className={th}>Ceiling reached</th>
                    <th className={th}>Waiting</th>
                    <th className={th}>Ends by itself</th>
                    <th className={actCol} />
                  </tr>
                </thead>
                <tbody>
                  {waiting.map((h) => {
                    const decisions = (
                      <>
                        <Button size="sm" variant="solid" tone="ink" permission="approve" onClick={() => setDeciding({ hold: h, decision: "continue" })}>
                          Continue with a raised budget
                        </Button>
                        <Button size="sm" variant="solid" tone="err" permission="approve" onClick={() => setDeciding({ hold: h, decision: "stop" })}>
                          Stop the run
                        </Button>
                      </>
                    );
                    return (
                      <tr key={h.id} className="border-b border-line align-top last:border-b-0">
                        <td className="max-w-[260px] py-2.5 pr-3 pl-4">
                          <RunCell hold={h} />
                          <span className="flex flex-wrap gap-1.5 pt-2 xl:hidden">{decisions}</span>
                        </td>
                        <td className="max-w-[180px] px-3 py-2.5">
                          <Person who={h.owner} none="not recorded" />
                        </td>
                        <td className="w-[280px] max-w-[320px] px-3 py-2.5">
                          <span className="flex flex-col gap-1.5">
                            <span className="font-medium text-fg">{measureLabel(h.measure)}</span>
                            <Meter value={h.limit > 0 ? h.used / h.limit : 1} tone="warn" />
                            <span className="tnum text-[11.5px] leading-[1.45] text-dim">{usedLine(h)}</span>
                          </span>
                        </td>
                        <td className="tnum px-3 py-2.5 whitespace-nowrap text-dim" title={when(h.paused_at)}>
                          {at(h.paused_at) ? waited(now - at(h.paused_at)) : "unknown"}
                        </td>
                        <td className="max-w-[180px] px-3 py-2.5">
                          <Ends hold={h} now={now} />
                        </td>
                        <td className={actCol}>
                          <span className="inline-flex flex-wrap justify-end gap-1.5">{decisions}</span>
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
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] border-collapse text-[12px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[10.5px] text-faint">
                      <th className={`${th} pl-4`}>Decided</th>
                      <th className={th}>Agent and run</th>
                      <th className={th}>Ceiling reached</th>
                      <th className={th}>Outcome</th>
                      <th className={th}>By</th>
                      <th className={`${th} pr-4`}>Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decided.map((h) => {
                      const o = OUTCOME[h.state] ?? { tone: "neutral" as const, label: String(h.state) };
                      return (
                        <tr key={h.id} className="border-b border-line align-top last:border-b-0">
                          <td className="tnum py-2.5 pr-3 pl-4 whitespace-nowrap text-dim">{when(h.decided_at) || "time not recorded"}</td>
                          <td className="max-w-[240px] px-3 py-2.5">
                            <RunCell hold={h} />
                          </td>
                          <td className="max-w-[260px] px-3 py-2.5">
                            <span className="flex flex-col gap-0.5">
                              <span className="font-medium text-fg">{measureLabel(h.measure)}</span>
                              <span className="tnum text-[11.5px] leading-[1.45] text-dim">{usedLine(h)}</span>
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="flex flex-col gap-0.5">
                              <Status tone={o.tone}>{o.label}</Status>
                              {h.state === "continued" && <span className="tnum text-[11.5px] text-dim">{h.raised_to !== undefined ? `new ceiling ${amount(h.measure, h.raised_to)}` : "new ceiling not recorded"}</span>}
                              {h.state === "expired" && <span className="text-[11.5px] text-dim">nobody decided in time; the run stopped</span>}
                            </span>
                          </td>
                          <td className="max-w-[180px] px-3 py-2.5">
                            <Person who={h.decided_by} none={h.state === "expired" ? "nobody" : "not recorded"} />
                          </td>
                          <td className="max-w-[360px] min-w-[220px] py-2.5 pr-4 pl-3 leading-[1.45] break-words text-dim">{h.reason || <span className="text-faint">{h.state === "expired" ? "" : "none recorded"}</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {deciding && <DecideDialog key={`${deciding.hold.id}:${deciding.decision}`} hold={deciding.hold} decision={deciding.decision} busy={busy} onConfirm={decide} onClose={() => !busy && setDeciding(null)} />}
    </Section>
  );
}
