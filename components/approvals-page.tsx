"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Mono, Status, Tag } from "./ui";
import { Banner, EmptyState, QuietNote } from "./overlays";
import { QUIET } from "@/lib/quiet";
import { Checkbox } from "./forms";
import { Pick } from "./select";
import { Chips, FilterBar, SearchBox, type Chip } from "./filters";
import { Figures, PageHeader, Section } from "./section";
import { WindowPick, winMs, type Win } from "./window-pick";
import { ApproveDialog } from "./approve";
import { Deadline, ShapeTag, useNow } from "./gate-form";
import { listGates, type Gate } from "@/lib/api/l5";
import { getEvidence, type SignedDecision } from "@/lib/api/l9";
import { batchable, chainOf, countdown, escalationPath, gateAccess, type Who } from "@/lib/gates";
import { useSession } from "@/lib/use-session";
import { soon } from "@/lib/soon";

/**
 * Approvals: the gates waiting for a person, and the gates answered.
 *
 * The queue is the approvals door's inbox (`GET /api/approvals`, the same
 * read the Control page's inbox and the attention queue make), ordered by
 * what runs out first: overdue, then the nearest deadline, then the longest
 * wait. A row opens the same dialog every other answer goes through
 * (components/approve.tsx); a person whose roles do not match a gate's
 * approvers sees which role it needs, on the row and in the dialog.
 *
 * Answered gates are the signed decisions the evidence door returns for the
 * gate control (`GET /api/evidence?control=gate`): who answered, how, when,
 * and the note they left.
 */

/** How long ago, short: `40s`, `12m`, `3h 5m`, `2d 4h`. */
function span(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function when(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Overdue first, then the nearest deadline, then the longest wait; the run id keeps the order total. */
function byUrgency(now: number) {
  const due = (g: Gate) => {
    const t = g.deadline ? Date.parse(g.deadline) : NaN;
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
  };
  const since = (g: Gate) => {
    const t = Date.parse(g.waiting_since);
    return Number.isNaN(t) ? now : t;
  };
  return (a: Gate, b: Gate) => due(a) - due(b) || since(a) - since(b) || a.run.localeCompare(b.run);
}

const VIA: Record<string, string> = {
  inbox: "in the console",
  resume: "by resuming the run",
  link: "through a signed link",
  timeout: "by timeout, nobody answered",
  journal: "read back from the journal",
};

/** What the answer was, as the decision records it. */
function outcomeOf(d: SignedDecision): { tone: "ok" | "err" | "warn"; label: string } {
  if (d.aborted) return { tone: "err", label: "Aborted" };
  if (!d.approved) return { tone: "err", label: "Refused" };
  if (d.shape === "form") return { tone: "ok", label: "Submitted" };
  if (d.shape === "verdicts") return { tone: "ok", label: "Verdicts recorded" };
  return { tone: "ok", label: "Approved" };
}

type View = "all" | "mine" | "overdue";

export function ApprovalsView() {
  const [gates, setGates] = useState<Gate[] | null>(null);
  const [error, setError] = useState("");
  const [answering, setAnswering] = useState<Gate[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [view, setView] = useState<View>("all");
  const [agent, setAgent] = useState("");
  const [q, setQ] = useState("");
  const now = useNow(15_000);
  const { session, loaded } = useSession();
  const who: Who | null = useMemo(() => (loaded && session ? { roles: session.roles, appRoles: session.appRoles, groups: session.groups ?? [] } : null), [loaded, session]);

  const load = useCallback(() => {
    listGates()
      .then((d) => {
        setGates(d.pending);
        setError("");
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    const cancel = soon(load);
    const id = setInterval(load, 8000);
    return () => {
      cancel();
      clearInterval(id);
    };
  }, [load]);

  /* ── answered: the signed decisions of the gate control, over a window ── */
  const [win, setWin] = useState<Win>("30d");
  const [tick, setTick] = useState(0);
  const [answered, setAnswered] = useState<{ key: string; decisions: SignedDecision[]; truncated: boolean; error: string } | null>(null);
  const answeredKey = `${win}:${tick}`;
  useEffect(() => {
    let live = true;
    const from = win === "all" ? "2000-01-01T00:00:00.000Z" : new Date(Date.now() - winMs(win)).toISOString();
    getEvidence({ control: "gate", from })
      .then((p) => {
        if (!live) return;
        const decisions = [...p.decisions].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
        setAnswered({ key: answeredKey, decisions, truncated: p.truncated, error: "" });
      })
      .catch((e: Error) => live && setAnswered({ key: answeredKey, decisions: [], truncated: false, error: e.message }));
    return () => {
      live = false;
    };
  }, [win, answeredKey]);
  const answeredNow = answered && answered.key === answeredKey ? answered : null;

  /* ── the queue under its filters ── */
  const all = useMemo(() => [...(gates ?? [])].sort(byUrgency(now)), [gates, now]);
  const mayAnswer = useCallback((g: Gate) => gateAccess(who, g.approvers), [who]);
  const overdue = (g: Gate) => countdown(g.deadline, now).overdue;
  const term = q.trim().toLowerCase();
  const shown = all.filter((g) => {
    if (view === "mine" && !mayAnswer(g).ok) return false;
    if (view === "overdue" && !overdue(g)) return false;
    if (agent && g.agent !== agent) return false;
    if (term && ![g.agent, g.run, g.node, g.asks, ...g.approvers].some((x) => x.toLowerCase().includes(term))) return false;
    return true;
  });
  const agents = [...new Set(all.map((g) => g.agent))].sort();
  /* A quiet console (lib/quiet.ts) whose inbox was not read: no count stands in for it, on a chip or in a figure. */
  const inboxOff = QUIET && gates === null && Boolean(error);
  const off = <span className="text-[11.5px] font-normal text-faint">Not connected</span>;
  const views: Chip[] = [
    { value: "all", label: "All waiting", count: inboxOff ? undefined : all.length, active: view === "all" },
    { value: "mine", label: "Mine to answer", count: inboxOff ? undefined : all.filter((g) => mayAnswer(g).ok).length, active: view === "mine" },
    { value: "overdue", label: "Overdue", count: inboxOff ? undefined : all.filter(overdue).length, active: view === "overdue", tone: "err" },
  ];
  const filterCount = (view !== "all" ? 1 : 0) + (agent ? 1 : 0) + (term ? 1 : 0);
  const pickedGates = all.filter((g) => picked.has(g.run));
  const batch = batchable(pickedGates, who);
  const dueSoon = all.filter((g) => {
    const c = countdown(g.deadline, now);
    return c.soon && !c.overdue;
  }).length;

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7">
      <PageHeader title="Approvals">
        Gates waiting for a person, the most urgent first. Open one to read what the run asks and the evidence it shows, and to answer it; the answer is signed with your sign-in. Below, the gates answered recently, with who
        answered and how.
      </PageHeader>

      {error && (
        <Banner tone="err" title="Could not read the approvals inbox">
          {error}
        </Banner>
      )}

      <Figures
        items={[
          { k: "Waiting", v: gates ? all.length : inboxOff ? off : "—" },
          { k: "Overdue", v: gates ? all.filter(overdue).length : inboxOff ? off : "—" },
          { k: "Due within the hour", v: gates ? dueSoon : inboxOff ? off : "—" },
          { k: "Mine to answer", v: gates && who ? all.filter((g) => mayAnswer(g).ok).length : inboxOff ? off : "—" },
          { k: `Answered · ${win === "all" ? "all time" : win}`, v: answeredNow && !answeredNow.error ? answeredNow.decisions.length : QUIET && answeredNow?.error ? off : "—" },
        ]}
      />

      <Section
        title="Waiting"
        hue="approvals"
        meta={gates ? `${shown.length} of ${all.length}` : undefined}
        action={
          picked.size > 0 ? (
            <span className="flex flex-wrap items-center gap-1.5">
              {!batch.ok && <span className="max-w-[46ch] text-[11px] leading-[1.4] text-warn">{batch.reason}</span>}
              <Button size="sm" variant="solid" tone="warn" permission="approve" disabled={!batch.ok} onClick={() => setAnswering(pickedGates)}>
                Answer {picked.size} together
              </Button>
              <Button size="sm" variant="solid" tone="neutral" onClick={() => setPicked(new Set())}>
                Clear
              </Button>
            </span>
          ) : undefined
        }
      >
        <FilterBar
          count={filterCount}
          onClear={() => {
            setView("all");
            setAgent("");
            setQ("");
          }}
        >
          <Chips items={views} onToggle={(v) => setView(v === view ? "all" : (v as View))} />
          {agents.length > 1 && (
            <span className="w-52">
              <Pick aria-label="Agent" value={agent} onChange={setAgent} options={[{ value: "", label: "Every agent" }, ...agents.map((a) => ({ value: a, label: a }))]} />
            </span>
          )}
          <SearchBox value={q} onChange={setQ} placeholder="Agent, run, what is asked, role" width="w-[260px]" />
        </FilterBar>

        {gates === null && !error && <p className="text-[12px] text-faint">Reading the inbox…</p>}
        {inboxOff && <p className="text-[12px] text-faint">Gates waiting for a person are listed here, the most urgent first.</p>}
        {gates && all.length === 0 && <EmptyState title="No gates are waiting" detail="When a run stops for a person, it is listed here with what it asks, who may answer and its deadline." />}
        {gates && all.length > 0 && shown.length === 0 && <p className="text-[12px] text-faint">No waiting gate matches these filters.</p>}

        {shown.length > 0 && (
          <div className="-mx-4 -mb-4 overflow-x-auto border-t border-line">
            <table className="w-full min-w-[980px] border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-line text-left text-[10.5px] text-faint">
                  <th className="w-9 py-2 pr-0 pl-4" />
                  <th className="px-3 py-2 font-medium">Agent and run</th>
                  <th className="px-3 py-2 font-medium">What is asked</th>
                  <th className="px-3 py-2 font-medium">Who may answer</th>
                  <th className="px-3 py-2 font-medium">Waiting</th>
                  <th className="px-3 py-2 font-medium">Deadline</th>
                  <th className="px-3 py-2 font-medium">If nobody answers</th>
                  <th className="py-2 pr-4 pl-3" />
                </tr>
              </thead>
              <tbody>
                {shown.map((g) => {
                  const access = mayAnswer(g);
                  const chain = chainOf(g);
                  const since = Date.parse(g.waiting_since);
                  const path = escalationPath(g);
                  return (
                    <tr key={g.run} onClick={() => setAnswering([g])} className={`cursor-pointer border-b border-line align-top transition-colors last:border-b-0 hover:bg-raise/40 ${picked.has(g.run) ? "bg-raise/40" : ""}`}>
                      <td className="py-2.5 pr-0 pl-4" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          aria-label={`Tick ${g.agent} · ${g.node}`}
                          checked={picked.has(g.run)}
                          onChange={(on) =>
                            setPicked((s) => {
                              const n = new Set(s);
                              if (on) n.add(g.run);
                              else n.delete(g.run);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td className="max-w-[240px] px-3 py-2.5">
                        <span className="flex flex-col gap-0.5">
                          <span className="truncate text-[12.5px] font-medium text-fg">{g.agent}</span>
                          <Link href={`/runs?id=${encodeURIComponent(g.run)}`} onClick={(e) => e.stopPropagation()} className="focusable w-fit max-w-full truncate rounded-sm font-mono text-[10.5px] text-dim hover:underline">
                            {g.run}
                          </Link>
                        </span>
                      </td>
                      <td className="max-w-[340px] px-3 py-2.5">
                        <span className="flex flex-col gap-1">
                          <span className="line-clamp-2 leading-[1.45] text-fg">{g.asks || `Paused at ${g.node}`}</span>
                          <span className="flex flex-wrap items-center gap-1.5">
                            <ShapeTag shape={g.shape} />
                            {g.asks && <Mono className="text-[10.5px]">{g.node}</Mono>}
                            {(g.control === "report" || g.deliverables.length > 0) && (
                              <Tag tone="warn">
                                report · {g.deliverables.length} deliverable{g.deliverables.length === 1 ? "" : "s"}
                              </Tag>
                            )}
                          </span>
                        </span>
                      </td>
                      <td className="max-w-[240px] px-3 py-2.5">
                        <span className="flex flex-col gap-1">
                          <span className="flex flex-wrap gap-1">{g.approvers.length ? g.approvers.map((r) => <Tag key={r}>{r}</Tag>) : <span className="text-dim">Anyone with the approve permission</span>}</span>
                          {who && !access.ok && <span className="text-[11px] leading-[1.4] text-warn">Not yours to answer: it needs {g.approvers.join(" or ")}.</span>}
                        </span>
                      </td>
                      <td className="tnum px-3 py-2.5 whitespace-nowrap text-dim" title={g.waiting_since ? new Date(g.waiting_since).toLocaleString() : undefined}>
                        {Number.isNaN(since) ? "unknown" : span(now - since)}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <Deadline deadline={g.deadline} now={now} />
                      </td>
                      <td className="max-w-[230px] px-3 py-2.5">
                        <span className="flex flex-col gap-0.5 text-[11.5px] leading-[1.45] text-dim">
                          {!g.deadline ? (
                            <span>It waits; no deadline is set.</span>
                          ) : chain.ahead.length ? (
                            <span>
                              Escalates to <span className="font-medium text-fg">{chain.ahead[0]}</span> at {when(g.deadline)}
                            </span>
                          ) : (
                            <span>
                              {g.on_timeout ? `On timeout: ${g.on_timeout}` : "No further role to escalate to"}, at {when(g.deadline)}
                            </span>
                          )}
                          {g.escalations > 0 && (
                            <span className="text-[10.5px] text-faint" title={path}>
                              Escalated {g.escalations}×{path ? `: ${path}` : ""}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="py-2.5 pr-4 pl-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        {who && !access.ok ? (
                          <Button size="sm" variant="solid" tone="neutral" onClick={() => setAnswering([g])}>
                            Open
                          </Button>
                        ) : (
                          <Button size="sm" variant="solid" tone="warn" permission="approve" onClick={() => setAnswering([g])}>
                            Answer
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
      </Section>

      <Section
        title="Answered"
        hue="approvals"
        meta={answeredNow && !answeredNow.error ? `${answeredNow.decisions.length} in the window${answeredNow.truncated ? " · the door cut the list short" : ""}` : undefined}
        action={<WindowPick value={win} onChange={setWin} />}
      >
        {!answeredNow && <p className="text-[12px] text-faint">Reading the answered gates…</p>}
        {answeredNow?.error && QUIET && (inboxOff ? <p className="text-[12px] text-faint">Gates answered in the window are listed here, with who answered and how.</p> : <QuietNote inline />)}
        {answeredNow?.error && !QUIET && <p className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err">The answered gates could not be read: {answeredNow.error}</p>}
        {answeredNow && !answeredNow.error && answeredNow.decisions.length === 0 && <p className="text-[12px] text-faint">No gate was answered in this window.</p>}
        {answeredNow && answeredNow.decisions.length > 0 && (
          <div className="-m-4 overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-line text-left text-[10.5px] text-faint">
                  <th className="py-2 pr-3 pl-4 font-medium">Answered</th>
                  <th className="px-3 py-2 font-medium">Agent and run</th>
                  <th className="px-3 py-2 font-medium">Gate</th>
                  <th className="px-3 py-2 font-medium">Answer</th>
                  <th className="px-3 py-2 font-medium">By</th>
                  <th className="px-3 py-2 font-medium">How</th>
                  <th className="py-2 pr-4 pl-3 font-medium">Note</th>
                </tr>
              </thead>
              <tbody>
                {answeredNow.decisions.map((d) => {
                  const o = outcomeOf(d);
                  return (
                    <tr key={`${d.run}:${d.gate}:${d.at}`} className="border-b border-line align-top last:border-b-0">
                      <td className="tnum py-2.5 pr-3 pl-4 whitespace-nowrap text-dim">{when(d.at) || "time not recorded"}</td>
                      <td className="max-w-[240px] px-3 py-2.5">
                        <span className="flex flex-col gap-0.5">
                          <span className="truncate font-medium text-fg">{d.agent}</span>
                          <Link href={`/runs?id=${encodeURIComponent(d.run)}`} className="focusable w-fit max-w-full truncate rounded-sm font-mono text-[10.5px] text-dim hover:underline">
                            {d.run}
                          </Link>
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <Mono className="text-[11px]">{d.node || "—"}</Mono>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <Status tone={o.tone}>{o.label}</Status>
                      </td>
                      <td className="max-w-[200px] px-3 py-2.5 break-words text-fg">{d.by || "not recorded"}</td>
                      <td className="px-3 py-2.5 text-dim">{VIA[d.via] ?? d.via ?? ""}</td>
                      <td className="max-w-[360px] py-2.5 pr-4 pl-3 leading-[1.45] text-dim">{d.note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {answering && (
        <ApproveDialog
          gates={answering}
          onClose={() => setAnswering(null)}
          onAnswered={() => {
            setPicked(new Set());
            load();
            setTick((t) => t + 1);
          }}
        />
      )}
    </div>
  );
}
