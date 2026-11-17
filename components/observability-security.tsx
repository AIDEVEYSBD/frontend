"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, Mono, Status } from "./ui";
import { EmptyState, QuietNote } from "./overlays";
import { PageHeader } from "./section";
import { Chips, FilterBar, SearchBox } from "./filters";
import { ControlMark } from "./control-ref";
import { Skeleton } from "./loaders";
import { WATCH_LABEL, type WatchEvent } from "@/lib/guardrails-watch";
import { redactText } from "@/lib/redact";
import { getLockdown, listGates, type Gate, type LockdownState } from "@/lib/api/l5";
import { readUsers } from "@/lib/api/l2";
import type { RunRow } from "@/lib/api/client";
import { useSession } from "@/lib/use-session";
import { soon } from "@/lib/soon";
import { QUIET } from "@/lib/quiet";
import { Card, ErrorLine, MoreRow, RUN_BATCH, ROW_BATCH, RunLink, Tiles, agentOf, ago, clockText, count, lastActive, runHref, useDigests, useLedger, type RunDigest, type RunEvent } from "./observability-shared";

/**
 * Security events: one stream, newest first.
 *
 * What a control did and what a person did about it: refusals, screening
 * blocks and flags, contract breaches, content marked untrusted, gates opened
 * and answered, operator kills and lockdown changes. The firings and the
 * watch come from `GET /api/guardrails`, the door the Controls page reads
 * (its excerpts are redacted on the server by lib/redact.ts); the journals of
 * the runs it names are then read, a bounded number at a time, to give each
 * firing its entry and to find the gate answers and kills beside it. Gates
 * still waiting come from the inbox, the lockdown from its own door, and
 * operator actions from the audit trail for those allowed to read it.
 * Nothing here shows a prompt, an argument or a returned value: only the
 * control's own words and the redacted excerpt.
 */

type Group = "refusal" | "screening" | "breach" | "marked" | "gate" | "kill" | "lockdown" | "operator";

const GROUP: Record<Group, { label: string; tone: "err" | "warn" | "ok" | "neutral" }> = {
  refusal: { label: "Refusals", tone: "err" },
  screening: { label: "Screening", tone: "err" },
  breach: { label: "Contract breaches", tone: "err" },
  marked: { label: "Marked untrusted", tone: "warn" },
  gate: { label: "Gates", tone: "warn" },
  kill: { label: "Operator kills", tone: "err" },
  lockdown: { label: "Lockdown", tone: "err" },
  operator: { label: "Operator actions", tone: "warn" },
};
const GROUPS = Object.keys(GROUP) as Group[];

interface SecEvent {
  key: string;
  at: number;
  group: Group;
  label: string;
  tone: "err" | "warn" | "ok" | "neutral";
  control: string;
  subject: string;
  node: string;
  run: string;
  entry: string;
  what: string;
  detail: string;
  who: string;
  /** Where a row without a run leads. */
  href: string;
  /** Where the row was read from, in a few words. */
  source: string;
}

interface Firing {
  control: string;
  run: string;
  agent: string;
  node: string;
  title: string;
  detail: string;
  at: string;
}

interface Guardrails {
  runs: number;
  runsWithARefusal: number;
  counts: Record<string, number>;
  recent: Firing[];
  events: WatchEvent[];
  error?: string;
}

interface AuditEvent {
  id: number;
  at: string;
  kind: string;
  sub?: string | null;
  email?: string | null;
  detail: Record<string, unknown>;
}

const ms = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? 0 : t;
};
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const clean = (s: string, n = 400): string => redactText(s).replace(/\s+/g, " ").trim().slice(0, n);

/** A counted firing's place in the stream, from the control it names: the door does not say the entry's kind. */
function groupOfFiring(f: Firing): Group {
  if (f.control === "gate" || f.control === "report") return "gate";
  if (f.control === "AF-RS-03" || f.control === "kill") return "kill";
  if (f.control === "contract.breach") return "breach";
  if (f.control.startsWith("operator.") || f.control === "guardian") return "operator";
  if (f.control === "taint" && /untrusted/i.test(f.title)) return "marked";
  return "refusal";
}

const FIRING_LABEL: Record<Group, string> = { refusal: "Refusal", screening: "Screening", breach: "Contract breach", marked: "Marked untrusted", gate: "Gate opened", kill: "Killed by operator", lockdown: "Lockdown", operator: "Operator action" };

function fromJournal(e: RunEvent, waiting: Set<string>): SecEvent | null {
  const base = { key: `j:${e.key}`, at: e.at, control: e.control, subject: e.agent, node: e.node, run: e.run, entry: e.entry, what: e.title, detail: e.detail, who: e.by, href: "", source: "run journal" };
  switch (e.kind) {
    case "refusal":
      return { ...base, group: "refusal", label: "Refusal", tone: "err" };
    case "breach":
      return { ...base, group: "breach", label: "Contract breach", tone: "err" };
    case "marked":
      return { ...base, group: "marked", label: "Marked untrusted", tone: "warn" };
    case "gate_opened":
      return { ...base, group: "gate", label: waiting.has(`${e.run}:${e.node}`) ? "Gate opened, waiting" : "Gate opened", tone: "warn" };
    case "gate_answered":
      return { ...base, group: "gate", label: e.approved === false ? "Gate refused" : e.approved ? "Gate approved" : "Gate answered", tone: e.approved === false ? "err" : "ok" };
    case "killed":
      return { ...base, group: "kill", label: "Killed by operator", tone: "err" };
    case "operator":
      return { ...base, group: "operator", label: "Operator action", tone: "warn" };
    default:
      return null;
  }
}

/** A privileged action on the audit trail that belongs on this stream, or null. Only the path and who took it are read. */
function fromAudit(e: AuditEvent): SecEvent | null {
  if (e.kind !== "action") return null;
  const method = text(e.detail.method).toUpperCase();
  const path = text(e.detail.path);
  if (method === "GET" || !path) return null;
  const who = text(e.detail.actor) || e.email || e.sub || "";
  const base = { key: `a:${e.id}`, at: ms(e.at), control: "", subject: "", node: "", entry: "", detail: `${method} ${path}`, who, href: "/iam#audit", source: `audit event #${e.id}` };
  if (path === "/api/lockdown") return { ...base, group: "lockdown", label: "Lockdown changed", tone: "err", run: "", what: "The estate lockdown was switched" };
  if (path === "/api/runs/kill-all") return { ...base, group: "kill", label: "Kill switch", tone: "err", run: "", control: "AF-RS-03", what: "The kill switch was thrown on every run in flight" };
  const kill = /^\/api\/runs\/([^/]+)\/kill$/.exec(path);
  if (kill) return { ...base, group: "kill", label: "Killed by operator", tone: "err", run: decodeURIComponent(kill[1]), control: "AF-RS-03", what: "A run was killed" };
  if (path === "/api/fleet") return { ...base, group: "operator", label: "Fleet action", tone: "warn", run: "", what: "Agents were paused, drained, resumed or killed" };
  const gate = /^\/api\/approvals\/([^/]+)$/.exec(path);
  if (gate) return { ...base, group: "gate", label: "Gate answered", tone: "ok", run: decodeURIComponent(gate[1]), control: "gate", what: "A gate was answered" };
  return null;
}

export function SecurityEventsView() {
  const router = useRouter();
  const [now] = useState(() => Date.now());
  const { session, loaded, can } = useSession();
  const mayAudit = loaded && Boolean(session) && can("iam");
  const ledger = useLedger();
  const [data, setData] = useState<Guardrails | null>(null);
  const [error, setError] = useState("");
  const [gates, setGates] = useState<Gate[] | null>(null);
  const [gatesError, setGatesError] = useState("");
  const [lockdown, setLockdown] = useState<LockdownState | null>(null);
  const [lockdownError, setLockdownError] = useState("");
  const [audit, setAudit] = useState<AuditEvent[] | null>(null);
  const [auditError, setAuditError] = useState("");
  const [busy, setBusy] = useState(true);
  const [tick, setTick] = useState(0);

  const [groups, setGroups] = useState<Set<string>>(new Set());
  const [subjects, setSubjects] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(ROW_BATCH);
  const [limit, setLimit] = useState(RUN_BATCH);

  useEffect(
    () =>
      soon(() => {
        let left = 3;
        const done = () => {
          left -= 1;
          if (left === 0) setBusy(false);
        };
        fetch("/api/guardrails", { cache: "no-store" })
          .then(async (r) => {
            const body = (await r.json().catch(() => null)) as (Guardrails & { error?: string }) | null;
            if (!r.ok || !body) throw new Error(body?.error || `the server answered ${r.status}`);
            setData({ ...body, recent: Array.isArray(body.recent) ? body.recent : [], events: Array.isArray(body.events) ? body.events : [], counts: body.counts ?? {} });
            setError("");
          })
          .catch((e) => setError((e as Error).message))
          .finally(done);
        listGates()
          .then((g) => {
            setGates(g.pending);
            setGatesError("");
          })
          .catch((e) => setGatesError((e as Error).message))
          .finally(done);
        getLockdown()
          .then((l) => {
            setLockdown(l);
            setLockdownError("");
          })
          .catch((e) => setLockdownError((e as Error).message))
          .finally(done);
      }),
    [tick],
  );
  useEffect(() => {
    if (!mayAudit) return;
    return soon(() => {
      readUsers()
        .then((u) => {
          setAudit((u.events ?? []) as AuditEvent[]);
          setAuditError(/unreachable/i.test(u.store ?? "") ? `its store answered "${u.store}"` : "");
        })
        .catch((e) => setAuditError((e as Error).message));
    });
  }, [mayAudit, tick]);

  const reload = useCallback(() => {
    setBusy(true);
    ledger.reload();
    setTick((t) => t + 1);
  }, [ledger]);

  /* The runs the door names, newest first: their journals give each firing its entry. */
  const named = useMemo(() => {
    const at = new Map<string, { at: number; agent: string }>();
    for (const f of data?.recent ?? []) if (f.run && !at.has(f.run)) at.set(f.run, { at: ms(f.at), agent: f.agent });
    for (const e of data?.events ?? []) if (e.run && !at.has(e.run)) at.set(e.run, { at: ms(e.at), agent: e.subject.kind === "agent" ? e.subject.id : "" });
    for (const g of gates ?? []) if (g.run && !at.has(g.run)) at.set(g.run, { at: ms(g.waiting_since), agent: g.agent });
    // The ledger knows of kills and refusals the door did not count (an older journal stamps no control on a kill).
    for (const r of ledger.rows ?? []) if ((r.state === "killed" || r.denials > 0) && !at.has(r.id)) at.set(r.id, { at: lastActive(r), agent: agentOf(r) });
    const byId = new Map((ledger.rows ?? []).map((r) => [r.id, r]));
    return [...at.entries()]
      .sort((a, b) => b[1].at - a[1].at)
      .map(([id, v]) => byId.get(id) ?? ({ id, agent: v.agent, state: "", live: false, started: v.at ? new Date(v.at).toISOString() : "", at: v.at ? new Date(v.at).toISOString() : "" } as unknown as RunRow));
  }, [data, gates, ledger.rows]);
  const wanted = useMemo(() => named.slice(0, limit), [named, limit]);
  const journals = useDigests(wanted);

  const stream = useMemo(() => {
    const out: SecEvent[] = [];
    const read = new Map<string, RunDigest>(journals.digests.map((d) => [d.id, d]));
    const waiting = new Set((gates ?? []).map((g) => `${g.run}:${g.node}`));
    const watched = new Set<string>();

    // The watch: screened hits, taint-to-sink and egress refusals, redacted by the server.
    for (const e of data?.events ?? []) {
      const entryAt = read.get(e.run)?.events.find((x) => x.entry === e.entry)?.at;
      watched.add(`${e.run}:${e.entry}`);
      watched.add(`${e.run}|${e.node}|${e.control}|${e.title}`);
      out.push({
        key: `w:${e.id}`,
        at: entryAt || ms(e.at),
        group: e.kind === "screened" ? "screening" : "refusal",
        label: e.kind === "screened" ? (e.action === "flagged" ? "Screening flag" : "Screening block") : WATCH_LABEL[e.kind],
        tone: e.action === "flagged" ? "warn" : "err",
        control: e.control,
        subject: e.subject.id,
        node: e.node,
        run: e.run,
        entry: e.entry,
        what: e.title,
        detail: e.excerpt || e.detail,
        who: e.principal,
        href: "",
        source: "watch, redacted by the server",
      });
    }

    // Runs whose journal is read: every firing with its entry, and the answers and kills beside it.
    for (const d of read.values()) {
      for (const e of d.events) {
        if (watched.has(`${e.run}:${e.entry}`)) continue;
        const row = fromJournal(e, waiting);
        if (row) out.push(row);
      }
    }

    // Runs not read yet: the firing as the door counted it, which names the run and not the entry.
    (data?.recent ?? []).forEach((f, i) => {
      if (read.has(f.run)) return;
      const title = clean(f.title, 200);
      if (watched.has(`${f.run}|${f.node}|${f.control}|${title}`)) return;
      const group = groupOfFiring(f);
      out.push({ key: `f:${i}:${f.run}`, at: ms(f.at), group, label: FIRING_LABEL[group], tone: GROUP[group].tone, control: f.control, subject: f.agent, node: f.node, run: f.run, entry: "", what: title, detail: clean(f.detail), who: "", href: "", source: "counted firing; the entry is named once the run's journal is read" });
    });

    // Gates still waiting whose journal was not read.
    for (const g of gates ?? []) {
      if (read.has(g.run)) continue;
      out.push({ key: `g:${g.run}:${g.node}`, at: ms(g.waiting_since), group: "gate", label: "Gate opened, waiting", tone: "warn", control: g.control || "gate", subject: g.agent, node: g.node, run: g.run, entry: "", what: clean(g.asks, 200) || "Awaiting a decision", detail: g.approvers.length ? `waits on ${g.approvers.join(", ")}` : "", who: "", href: "", source: "approvals inbox" });
    }

    // The lockdown as it stands: its last switch.
    if (lockdown?.at) {
      out.push({ key: "l:now", at: ms(lockdown.at), group: "lockdown", label: lockdown.on ? "Lockdown set" : "Lockdown lifted", tone: lockdown.on ? "err" : "ok", control: "", subject: "", node: "", run: "", entry: "", what: lockdown.on ? "The estate is locked down" : "The lockdown was lifted", detail: clean(lockdown.reason), who: lockdown.by, href: "/control", source: lockdown.audit_id !== null ? `lockdown door · audit event #${lockdown.audit_id}` : "lockdown door" });
    }

    // Operator actions on the audit trail, for those who may read it.
    for (const a of audit ?? []) {
      if (lockdown?.audit_id !== null && lockdown?.audit_id !== undefined && a.id === lockdown.audit_id) continue;
      const row = fromAudit(a);
      if (row) out.push(row);
    }

    return out.sort((a, b) => b.at - a.at);
  }, [data, gates, lockdown, audit, journals.digests]);

  const needle = q.trim().toLowerCase();
  const matches = (e: SecEvent, skip?: "group" | "subject") =>
    (skip === "group" || !groups.size || groups.has(e.group)) &&
    (skip === "subject" || !subjects.size || subjects.has(e.subject)) &&
    (!needle || `${e.label} ${e.control} ${e.subject} ${e.node} ${e.run} ${e.what} ${e.detail} ${e.who}`.toLowerCase().includes(needle));
  const filtered = stream.filter((e) => matches(e));
  const bySubject = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of stream) if (e.subject) m.set(e.subject, (m.get(e.subject) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [stream]);
  const tally = (g: Group) => stream.filter((e) => e.group === g).length;
  const toggle = (set: (f: (s: Set<string>) => Set<string>) => void) => (v: string) =>
    set((s) => {
      const n = new Set(s);
      if (n.has(v)) n.delete(v);
      else n.add(v);
      return n;
    });
  const only = (g: Group) => setGroups((s) => (s.size === 1 && s.has(g) ? new Set() : new Set([g])));
  const is = (g: Group) => groups.size === 1 && groups.has(g);
  const filterCount = groups.size + subjects.size + (needle ? 1 : 0);
  const clear = () => {
    setGroups(new Set());
    setSubjects(new Set());
    setQ("");
  };

  const ready = data !== null || Boolean(error);
  const nothing = ready && !busy && stream.length === 0;
  const unread = named.length - journals.digests.length - journals.pending - journals.failed.length;
  // No record, no count: a figure that could not be read is unknown, never zero.
  const dash = busy && !ready ? "…" : error && !data ? "unknown" : null;
  // A quiet console (lib/quiet.ts) says once that it is not connected, whichever of the reads failed, and prints no reason.
  // With nothing read into the stream there are no figures to show either: a count of zero would say nothing happened.
  const quietGap = QUIET && Boolean(error || data?.error || gatesError || lockdownError || auditError || ledger.error);
  const quietDown = quietGap && stream.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7">
      <PageHeader
        title="Security events"
        action={
          <Button size="sm" variant="solid" tone="neutral" loading={busy} onClick={reload}>
            Read again
          </Button>
        }
      >
        What the controls did and what people did about it, newest first: refusals, screening blocks and flags, gates opened and answered, operator kills and lockdown changes. Each row names what fired and on which run, and opens the run at that entry.
      </PageHeader>

      {quietGap && <QuietNote />}
      {!QUIET && error && <ErrorLine what="The record of what the controls did could not be read" message={error} />}
      {!QUIET && data?.error && <ErrorLine what="The record of what the controls did is incomplete" message={data.error} />}
      {!QUIET && gatesError && <ErrorLine what="The approvals inbox did not answer, so gates still waiting are missing" message={gatesError} />}
      {!QUIET && lockdownError && <ErrorLine what="The lockdown door did not answer, so its state is missing" message={lockdownError} />}
      {!QUIET && auditError && <ErrorLine what="The audit trail could not be read, so kills and lockdown changes made outside a run are missing" message={auditError} />}

      {!quietDown && <Tiles
        tiles={[
          { id: "all", label: "Events listed", value: dash ?? count(stream.length), sub: data ? `across ${count(data.runs)} run${data.runs === 1 ? "" : "s"} on record` : "reading the record", onPick: () => setGroups(new Set()) },
          { id: "refusal", label: "Refusals", value: dash ?? count(tally("refusal")), sub: data ? `${count(data.runsWithARefusal)} run${data.runsWithARefusal === 1 ? "" : "s"} with a refusal` : "calls a control stopped", tone: tally("refusal") ? "err" : undefined, onPick: () => only("refusal"), active: is("refusal") },
          { id: "screening", label: "Screening blocks and flags", value: dash ?? count(tally("screening")), sub: "prompts and responses the screener matched", tone: tally("screening") ? "err" : undefined, onPick: () => only("screening"), active: is("screening") },
          { id: "gate", label: "Gate events", value: (busy && !ready ? "…" : null) ?? count(tally("gate")), sub: gates ? `${count(gates.length)} waiting now` : "opened and answered", tone: gates?.length ? "warn" : undefined, onPick: () => only("gate"), active: is("gate") },
          { id: "kill", label: "Operator kills", value: dash ?? count(tally("kill")), sub: "runs stopped by a person", tone: tally("kill") ? "err" : undefined, onPick: () => only("kill"), active: is("kill") },
          { id: "lockdown", label: "Lockdown", value: lockdown ? (lockdown.on ? "On" : "Off") : lockdownError ? "unknown" : "…", sub: lockdown?.at ? `${lockdown.on ? "set" : "lifted"} ${ago(ms(lockdown.at), now)}${lockdown.by ? ` by ${lockdown.by}` : ""}` : lockdown ? "never switched on this deployment" : "", tone: lockdown?.on ? "err" : undefined, onPick: () => only("lockdown"), active: is("lockdown") },
        ]}
      />}

      {quietDown ? null : nothing && !error ? (
        <EmptyState
          title="No security events yet"
          detail={data && data.runs > 0 ? `${count(data.runs)} run${data.runs === 1 ? "" : "s"} are on record and no control has refused, screened, gated or stopped anything on them.` : "Nothing has run on this deployment, so no control has fired. Events are listed here as runs are recorded."}
          action={<Button size="sm" variant="solid" tone="ink" href="/guardrails">Open controls</Button>}
        />
      ) : (
        <>
          <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-4 py-3 elev-1">
            <FilterBar count={filterCount} onClear={clear}>
              <Chips label="Kind" items={GROUPS.map((g) => ({ value: g, label: GROUP[g].label, count: stream.filter((e) => matches(e, "group") && e.group === g).length, active: groups.has(g) }))} onToggle={toggle(setGroups)} />
              {bySubject.length > 0 && <Chips label="Agent or application" items={bySubject.slice(0, 8).map(([s, n]) => ({ value: s, label: s, count: n, active: subjects.has(s) }))} onToggle={toggle(setSubjects)} />}
              <SearchBox value={q} onChange={setQ} placeholder="Search control, run, step or text" width="w-[280px]" />
            </FilterBar>
          </section>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-line bg-surface px-3 py-2">
            <span className="min-w-0 grow text-[11.5px] leading-[1.5] text-faint">
              The door answers its 40 most recent firings and 300 most recent watch events; the ledger adds the runs it marks killed or refused. Journals are read for <span className="tnum font-medium text-fg">{count(journals.digests.length)}</span> of the{" "}
              <span className="tnum font-medium text-fg">{count(named.length)}</span> run{named.length === 1 ? "" : "s"} they name, {RUN_BATCH} at a time, to give each firing its entry and to find gate answers and kills.
              {journals.pending > 0 ? ` Reading ${count(journals.pending)} more…` : ""}
              {journals.failed.length > 0 && !QUIET && <span className="text-err"> {count(journals.failed.length)} did not read: {journals.failed[0].message}</span>}
              {!mayAudit && loaded ? " Kills and lockdown changes made outside a run are on the audit trail, which needs the iam permission to read." : ""}
            </span>
            {unread > 0 && (
              <Button size="sm" variant="solid" tone="neutral" disabled={journals.pending > 0} onClick={() => setLimit((n) => n + RUN_BATCH)}>
                Read {Math.min(RUN_BATCH, unread)} more run{Math.min(RUN_BATCH, unread) === 1 ? "" : "s"}
              </Button>
            )}
          </div>

          <Card title="Events" hue="control" meta={`${count(filtered.length)} of ${count(stream.length)} · newest first · text is redacted of secrets`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-[11.5px]">
                <thead>
                  <tr className="border-b border-line text-left text-[10.5px] text-faint">
                    <th className="px-4 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">Event</th>
                    <th className="px-3 py-2 font-medium">What fired</th>
                    <th className="px-3 py-2 font-medium">Agent or application</th>
                    <th className="px-3 py-2 font-medium">What it said</th>
                    <th className="px-3 py-2 font-medium">Run</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, shown).map((e) => {
                    const href = e.run ? runHref(e.run, e.entry || undefined) : e.href;
                    return (
                      <tr key={e.key} onClick={href ? () => router.push(href) : undefined} className={`border-b border-line last:border-0 hover:bg-raise/50 ${href ? "cursor-pointer" : ""}`}>
                        <td className="px-4 py-2 align-top whitespace-nowrap">
                          <span className="tnum text-fg">{e.at ? clockText(e.at) : "unknown"}</span>
                          <span className="block text-[10px] text-ghost">{e.at ? ago(e.at, now) : ""}</span>
                        </td>
                        <td className="px-3 py-2 align-top">
                          <Status tone={e.tone}>{e.label}</Status>
                          {e.who && <span className="block max-w-[26ch] truncate text-[10px] text-ghost" title={e.who}>by {e.who}</span>}
                        </td>
                        <td className="px-3 py-2 align-top">{e.control ? <ControlMark control={e.control} /> : <span className="text-ghost">no control named</span>}</td>
                        <td className="px-3 py-2 align-top">
                          {e.subject ? (
                            <span className="flex flex-col">
                              <span className="text-[12px] font-medium whitespace-nowrap text-fg">{e.subject}</span>
                              {e.node && <Mono className="text-[10px] text-faint">{e.node}</Mono>}
                            </span>
                          ) : (
                            <span className="text-ghost">the estate</span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top">
                          <span className="block max-w-[52ch] text-[11.5px] leading-[1.5] text-mist">{e.what}</span>
                          {e.detail && e.detail !== e.what && <span className="line-clamp-2 max-w-[52ch] font-mono text-[10.5px] leading-[1.5] text-faint" title={e.detail}>{e.detail}</span>}
                          <span className="block text-[10px] text-ghost">{e.source}</span>
                        </td>
                        <td className="max-w-[220px] px-3 py-2 align-top">
                          {e.run ? (
                            <span className="flex flex-col gap-0.5">
                              <RunLink run={e.run} entry={e.entry || undefined} />
                              <Link href={href} onClick={(ev) => ev.stopPropagation()} className="focusable w-fit rounded-sm text-[10.5px] font-medium text-fg underline">
                                {e.entry ? "Open at this entry" : "Open run"}
                              </Link>
                            </span>
                          ) : href ? (
                            <Link href={href} onClick={(ev) => ev.stopPropagation()} className="focusable w-fit rounded-sm text-[10.5px] font-medium text-fg underline">
                              {e.href === "/control" ? "Open control" : "Open audit trail"}
                            </Link>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                  {!ready && (
                    <tr>
                      <td colSpan={6} className="px-4 py-4">
                        <Skeleton lines={4} />
                      </td>
                    </tr>
                  )}
                  {ready && filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-[11.5px] text-faint">
                        {stream.length ? "No event matches these filters." : error ? (QUIET ? "Not connected on this deployment." : "Nothing to list: the record could not be read.") : "Reading…"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {filtered.length > 0 && (
              <MoreRow
                action={
                  filtered.length > shown ? (
                    <Button size="sm" variant="solid" tone="neutral" onClick={() => setShown((n) => n + ROW_BATCH)}>
                      Show {Math.min(ROW_BATCH, filtered.length - shown)} more
                    </Button>
                  ) : undefined
                }
              >
                Showing {count(Math.min(shown, filtered.length))} of {count(filtered.length)} event{filtered.length === 1 ? "" : "s"}. The table draws {ROW_BATCH} rows at a time.
              </MoreRow>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
