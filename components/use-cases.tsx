"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { Button, Status, Tag } from "./ui";
import { Dialog } from "./overlays";
import { Section } from "./section";
import { NotConnected, NotConnectedNote, useDoor, Failure } from "./pending";
import { notBuilt, notBuiltOf } from "@/lib/not-built";
import { RegisterDialog, tierLabel } from "./use-cases-dialog";
import { DATA_CLASS_TONE } from "@/lib/bom";
import { otherOffers, workloadHref } from "@/lib/workloads";
import { WORKLOADS, ask, type Answer, type Door, type UseCase, type UseCaseChange, type UseCaseGate, type UseCaseList, type UseCaseState, type WorkloadList } from "@/lib/api/pending";

/**
 * Use cases: the one place a use case is registered.
 *
 * A use case names who answers for it, the data classes it handles, how much
 * it may do on its own (one of the platform's autonomy tiers), the workload
 * it uses and the gates where a run of it waits for a person: who may
 * answer, what sends a run there, how long it waits and what happens when
 * nobody answers (it escalates or stops; it never proceeds). It is
 * registered as a draft, sent for approval, and approved.
 *
 * Its doors are `useCases`, `useCaseRegister` and `useCase` in
 * lib/api/pending.ts. No row is ever made up.
 */

type Notice = { tone: "ok" | "err"; text: string } | { door: Door };

const WHAT = "Registered use cases are listed here with their owner, the data classes they handle, their autonomy level, the workload they use and their gates.";
const th = "px-3 py-2 font-medium whitespace-nowrap";

const STATE: Record<UseCaseState, { tone: "ok" | "warn" | "neutral"; label: string }> = {
  draft: { tone: "neutral", label: "Draft" },
  awaiting_approval: { tone: "warn", label: "Awaiting approval" },
  approved: { tone: "ok", label: "Approved" },
};
const ORDER: UseCaseState[] = ["awaiting_approval", "draft", "approved"];

/** A gate's wait as a person says it: 45 minutes, 2 hours, 1 day. */
function waitText(minutes: number): string {
  if (!(minutes > 0)) return "no timeout recorded";
  const say = (n: number, unit: string) => `${n.toLocaleString("en-GB")} ${unit}${n === 1 ? "" : "s"}`;
  if (minutes % 1440 === 0) return say(minutes / 1440, "day");
  if (minutes % 60 === 0) return say(minutes / 60, "hour");
  return say(minutes, "minute");
}

function Gate({ gate: g }: { gate: UseCaseGate }) {
  return (
    <li className="flex flex-col gap-0.5">
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-fg">{g.name}</span>
        <span className="text-dim">{g.approver_role ? `answered by ${g.approver_role}` : "no approver role recorded"}</span>
      </span>
      {g.threshold && <span className="leading-[1.45] text-dim">Applies when: {g.threshold}</span>}
      <span className="leading-[1.45] text-dim">
        Recorded: waits {waitText(g.timeout_minutes)}, then {g.on_timeout === "stop" ? "the run stops" : g.escalate_to ? `escalates to ${g.escalate_to}` : "escalates"}. Runs are not yet held to it.
      </span>
    </li>
  );
}

export function UseCases({ workloads, calm }: { /** The workloads door's answer, for the names of the workloads a use case can use. */ workloads: Answer<WorkloadList> | null; /** The page already says nothing is connected: say what will appear, and no more. */ calm: boolean }) {
  const { answer, reload } = useDoor<UseCaseList>("useCases");
  const [registering, setRegistering] = useState(false);
  const [moving, setMoving] = useState<{ useCase: UseCase; to: UseCaseState } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const connected = answer?.state === "ok";
  const rows = useMemo(() => {
    const list = answer?.state === "ok" && Array.isArray(answer.data?.use_cases) ? answer.data.use_cases : [];
    return [...list].sort((a, b) => ORDER.indexOf(a.state) - ORDER.indexOf(b.state) || a.name.localeCompare(b.name));
  }, [answer]);
  const workloadChoices = useMemo(() => [...WORKLOADS.map((w) => ({ value: w.id as string, label: w.name })), ...otherOffers(workloads).map((o) => ({ value: o.id, label: o.name || o.id }))], [workloads]);
  const workloadName = (id: string) => workloadChoices.find((w) => w.value === id)?.label ?? id;

  const move = async () => {
    if (!moving || busy) return;
    const { useCase: u, to } = moving;
    setBusy(true);
    const body: UseCaseChange = { state: to };
    const a = await ask<unknown>("useCase", { params: { id: u.id }, body });
    setBusy(false);
    setMoving(null);
    if (a.state === "pending") return setNotice({ door: a.door });
    if (a.state === "error") return setNotice({ tone: "err", text: a.message });
    setNotice({ tone: "ok", text: to === "approved" ? `${u.name} is approved.` : `${u.name} was sent for approval.` });
    reload();
  };

  /* What the register's answer names as not built: the older platform names `enforcement` (nothing is held to a use case); the current one names `gates` and `autonomy` (a run is held to its use case's approval and data classes, not yet to these). */
  const unbuiltList = notBuiltOf(answer?.state === "ok" ? answer.data : null);
  const recordOnly = notBuilt(unbuiltList, "enforcement");
  const unchecked = [
    { field: "gates", words: "registered gates" },
    { field: "autonomy", words: "the autonomy tier" },
  ].filter((u) => notBuilt(unbuiltList, u.field));
  const noticeText: ReactNode = notice ? "door" in notice ? <NotConnectedNote door={notice.door} /> : notice.text : null;
  const waiting = rows.filter((u) => u.state === "awaiting_approval").length;

  return (
    <Section
      id="use-cases"
      title="Use cases"
      hue="workloads"
      meta={connected ? `${rows.length.toLocaleString("en-GB")} registered${waiting ? ` · ${waiting.toLocaleString("en-GB")} awaiting approval` : ""}` : undefined}
      action={
        <Button size="sm" variant="solid" tone="ink" permission="configure" onClick={() => setRegistering(true)}>
          Register a use case
        </Button>
      }
    >
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

      {answer === null && <p className="text-[12px] text-faint">Reading the registered use cases…</p>}
      {answer?.state === "pending" && (calm ? <p className="text-[12px] text-faint">{WHAT}</p> : <NotConnected door={answer.door} compact>{WHAT}</NotConnected>)}
      {answer?.state === "error" &&
        <Failure what="The registered use cases could not be read" message={answer.message} />}
      {connected && recordOnly && (
        <p className="text-[12px] leading-[1.55] text-dim" data-not-built="enforcement">
          A record only: holding runs to a registered use case (its data classes, autonomy level and gates) is not built, so nothing here is enforced on a run.
        </p>
      )}
      {connected && !recordOnly && unchecked.length > 0 && (
        <p className="text-[12px] leading-[1.55] text-dim" data-not-built={unchecked.map((u) => u.field).join(" ")}>
          A run of a workload is refused until its use case is approved, and a dataset above the use case&rsquo;s highest data class is refused; {unchecked.map((u) => u.words).join(" and ")} {unchecked.length === 1 ? "is" : "are"} recorded, not yet checked against runs. A workload has at most one use case.
        </p>
      )}
      {connected && rows.length === 0 && <p className="text-[12px] text-faint">No use case is registered. Register one to record its owner, the data it handles, its autonomy level and the gates where a person decides.</p>}

      {rows.length > 0 && (
        <div className={`overflow-x-auto ${notice ? "-mx-4 -mb-4 border-t border-line" : "-m-4"}`}>
          <table className="w-full min-w-[1080px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-line text-left text-[10.5px] text-faint">
                <th className={`${th} pl-4`}>Use case</th>
                <th className={th}>Owner</th>
                <th className={th}>Data classes</th>
                <th className={th}>Autonomy level</th>
                <th className={th}>Workload</th>
                <th className={th}>Gates</th>
                <th className={th}>State</th>
                <th className={`${th} pr-4`} />
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const s = STATE[u.state] ?? { tone: "neutral" as const, label: String(u.state) };
                const classes = Array.isArray(u.data_classes) ? u.data_classes : [];
                const gates = Array.isArray(u.gates) ? u.gates : [];
                return (
                  <tr key={u.id} className="border-b border-line align-top last:border-b-0">
                    <td className="max-w-[220px] py-2.5 pr-3 pl-4">
                      <span className="flex flex-col gap-0.5">
                        <span className="text-[12.5px] font-medium break-words text-fg">{u.name}</span>
                        <span className="truncate font-mono text-[10.5px] text-faint">{u.id}</span>
                      </span>
                    </td>
                    <td className="max-w-[170px] px-3 py-2.5">
                      {u.owner ? (
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-fg">{u.owner.name || u.owner.email || u.owner.sub}</span>
                          {(u.owner.team || (u.owner.name && u.owner.email)) && <span className="truncate text-[10.5px] text-faint">{u.owner.team || u.owner.email}</span>}
                        </span>
                      ) : (
                        <span className="text-faint">not recorded</span>
                      )}
                    </td>
                    <td className="max-w-[170px] px-3 py-2.5">
                      {classes.length ? (
                        <span className="flex flex-wrap gap-1">
                          {classes.map((c) => (
                            <Tag key={c} tone={DATA_CLASS_TONE[c] ?? "neutral"}>
                              {c}
                            </Tag>
                          ))}
                        </span>
                      ) : (
                        <span className="text-faint">none declared</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-fg">{u.autonomy ? tierLabel(u.autonomy) : <span className="text-faint">not set</span>}</td>
                    <td className="max-w-[170px] px-3 py-2.5">
                      {u.workload ? (
                        <Link href={workloadHref(u.workload)} className="focusable rounded-sm text-fg hover:underline">
                          {workloadName(u.workload)}
                        </Link>
                      ) : (
                        <span className="text-faint">not set</span>
                      )}
                    </td>
                    <td className="min-w-[260px] px-3 py-2.5 text-[11.5px]">
                      {gates.length ? (
                        <ul className="flex flex-col gap-2">
                          {gates.map((g, i) => (
                            <Gate key={`${g.name}:${i}`} gate={g} />
                          ))}
                        </ul>
                      ) : (
                        <span className="text-faint">No gate: no run waits for a person.</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="flex flex-col gap-0.5">
                        <Status tone={s.tone}>{s.label}</Status>
                        {u.state === "approved" && u.approved_by && <span className="text-[10.5px] text-faint">by {u.approved_by.name || u.approved_by.email || u.approved_by.sub}</span>}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 pl-3 text-right whitespace-nowrap">
                      {u.state === "draft" && (
                        <Button size="sm" variant="solid" tone="ink" permission="configure" onClick={() => setMoving({ useCase: u, to: "awaiting_approval" })}>
                          Send for approval
                        </Button>
                      )}
                      {u.state === "awaiting_approval" && (
                        <Button size="sm" variant="solid" tone="ink" permission="approve" onClick={() => setMoving({ useCase: u, to: "approved" })}>
                          Approve
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {registering && (
        <RegisterDialog
          workloads={workloadChoices}
          onClose={() => setRegistering(false)}
          onDone={(_, name) => {
            setRegistering(false);
            setNotice({ tone: "ok", text: `${name} is registered as a draft.` });
            reload();
          }}
        />
      )}
      {moving && (
        <Dialog
          modal
          title={moving.to === "approved" ? `Approve ${moving.useCase.name}?` : `Send ${moving.useCase.name} for approval?`}
          confirm={moving.to === "approved" ? "Approve use case" : "Send for approval"}
          loading={busy}
          onConfirm={() => void move()}
          onClose={() => !busy && setMoving(null)}
        >
          {moving.to === "approved"
            ? recordOnly
              ? "The approval is recorded with your name. The use case is a record of what was agreed: runs are not yet held to its owner, data classes, autonomy level or gates."
              : "The approval is recorded with your name. Runs of its workload may then start, and a dataset above its highest data class is refused. At each production deploy of the agent that runs it, the agent is held to the controls its autonomy level requires and needs an approval step for each of its gates (the gate's approver role, within its timeout); a gate's threshold, what happens on timeout and whom it escalates to are recorded and not checked."
            : recordOnly
              ? "It moves from draft to awaiting approval, and a person with the approve permission decides. It stays as registered until then."
              : "It moves from draft to awaiting approval, and a person with the approve permission decides. Until it is approved, a run of its workload is refused."}
        </Dialog>
      )}
    </Section>
  );
}
