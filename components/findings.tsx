"use client";

import { Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Tag } from "./ui";
import { Banner, EmptyState } from "./overlays";
import { Field, Textarea } from "./forms";
import { Pick } from "./select";
import { ActiveFilters, SearchBox } from "./filters";
import { DrillModal } from "./drill";
import { GroupHeader } from "./page-tabs";
import { NotConnected, NotConnectedNote, useDoor } from "./pending";
import { notBuilt, notBuiltOf } from "@/lib/not-built";
import { FindingDetail, hasFindingDetail } from "./finding-detail";
import {
  FINDING_STATUSES,
  FINDING_STATUS_META,
  FindingStatusMark,
  RunLink,
  SEVERITIES,
  SEVERITY_META,
  SeverityTag,
  bySeverityThenRecent,
  count,
  countBySeverity,
  findingStatusMeta,
  shortWhen,
  workloadName,
} from "./finding-marks";
import { listAgents } from "@/lib/api/l2";
import { WORKLOADS, ask, type Door, type Finding, type FindingList, type FindingStatus, type Scope } from "@/lib/api/pending";

/**
 * Findings (features 11.1, 11.2, 11.3): what the four security workloads
 * reported, in one list.
 *
 * The list reads `GET /api/findings` with the workload, status, agent, run
 * and scope it is filtered to; severity and the search narrow what came back,
 * so the counts by severity above the table always describe the same rows the
 * table can show. Rows sort by severity, then the most recent first. A
 * finding opens over the list at `?id=`: what it is, the part that differs by
 * workload (components/finding-detail.tsx), its evidence as links into the
 * run's journal, its status history, and the control that changes its status
 * with a note. `?run=`, `?workload=`, `?severity=` and `?status=` preset the
 * filters, so a run's page and the outcome dashboard can link here.
 *
 * The doors are named in lib/api/pending.ts.
 */

const LIMIT = 500;

/* A person's team is set on the IAM page; the platform answers a person with no team their own findings for "My team". */
const SCOPES: { id: Scope; label: string; title: string; off?: boolean }[] = [
  { id: "mine", label: "Mine", title: "Findings of runs you started" },
  { id: "team", label: "My team", title: "Findings of runs your team started; with no team set on the IAM page, your own" },
  { id: "all", label: "All", title: "Every finding you may see" },
];

const HEAD = ["Severity", "Finding", "Workload", "Status", "Agent", "Run", "Reported"];

function Filter({ label, width = "w-44", children }: { label: string; width?: string; children: ReactNode }) {
  return (
    <span className={`flex ${width} max-w-full flex-col gap-1`}>
      <span className="text-[11px] font-medium text-faint">{label}</span>
      {children}
    </span>
  );
}

function Block({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="flex items-baseline gap-2">
        <span className="text-[11px] font-semibold text-dim">{title}</span>
        {meta !== undefined && <span className="tnum text-[11px] text-faint">{meta}</span>}
      </span>
      {children}
    </div>
  );
}

/** How sure the run said it was. Read as a share when it is one, as a percentage otherwise. */
function confidenceText(c: unknown): string {
  if (typeof c !== "number" || !Number.isFinite(c) || c < 0) return "";
  return `${Math.round(c <= 1 ? c * 100 : c)}%`;
}

/* ═══════════════════ triage ═══════════════════ */

/** Change a finding's status, with a note that says why. */
function Triage({ finding, disabled = false, onChanged }: { finding: Finding | null; disabled?: boolean; onChanged: () => void }) {
  const [to, setTo] = useState<FindingStatus | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Door | null>(null);
  const options = FINDING_STATUSES.filter((s) => s !== finding?.status);
  const ready = Boolean(finding && to && note.trim());

  const submit = async () => {
    if (!finding || !to || !note.trim()) return;
    setBusy(true);
    setError("");
    const a = await ask<unknown>("findingTriage", { params: { id: finding.id }, body: { status: to, note: note.trim() } });
    setBusy(false);
    if (a.state === "pending") return setPending(a.door);
    if (a.state === "error") return setError(a.message);
    setTo("");
    setNote("");
    onChanged();
  };

  return (
    <Block title="Change status">
      <div className="flex flex-col gap-2.5 rounded-md border border-line bg-canvas p-3">
        <Field label="New status" hint={to ? `${FINDING_STATUS_META[to].means}.` : undefined}>
          <Pick<FindingStatus | "">
            value={to}
            onChange={setTo}
            disabled={disabled || busy}
            options={[{ value: "", label: "Choose a status" }, ...options.map((s) => ({ value: s, label: FINDING_STATUS_META[s].label }))]}
          />
        </Field>
        <Field label="Note" hint="Required. Kept in the finding's history.">
          <Textarea value={note} onChange={setNote} rows={2} disabled={disabled || busy} placeholder="Why the status changes" />
        </Field>
        <span className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="solid" tone="ink" permission="approve" disabled={disabled || !ready} loading={busy} onClick={submit}>
            Change status
          </Button>
          {error && <span className="text-[11.5px] text-err">{error}</span>}
        </span>
        {(disabled || pending) && <NotConnectedNote door={pending ?? "findingTriage"} />}
      </div>
    </Block>
  );
}

/* ═══════════════════ one finding ═══════════════════ */

/** One finding in full. Presentational, apart from the triage control. */
export function FindingView({ finding, onChanged, partial = false }: { finding: Finding; onChanged: () => void; /** Only the list's row is known; the finding's own door has not answered. */ partial?: boolean }) {
  const f = finding;
  const evidence = Array.isArray(f.evidence) ? f.evidence : [];
  const history = Array.isArray(f.history) ? f.history : [];
  const confidence = confidenceText(f.confidence);
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-5 p-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityTag severity={f.severity} />
          <FindingStatusMark status={f.status} />
          {confidence && (
            <span className="text-[11px] text-faint" title="As the run recorded it">
              Confidence <span className="tnum font-medium text-dim">{confidence}</span>
            </span>
          )}
        </div>
        {f.summary && (
          <Block title="Summary">
            <p className="max-w-[86ch] text-[12.5px] leading-[1.55] break-words whitespace-pre-wrap text-mist">{f.summary}</p>
          </Block>
        )}
        {f.recommendation && (
          <Block title="Recommendation">
            <p className="max-w-[86ch] text-[12.5px] leading-[1.55] break-words whitespace-pre-wrap text-mist">{f.recommendation}</p>
          </Block>
        )}
        {hasFindingDetail(f) && (
          <div className="flex min-w-0 flex-col gap-3 border-t border-line pt-4">
            <span className="text-[12px] font-semibold text-fg">{workloadName(f.workload)}</span>
            <FindingDetail finding={f} />
          </div>
        )}
        {!f.summary && !f.recommendation && !hasFindingDetail(f) && <p className="text-[12px] text-faint">No summary, recommendation or detail recorded.</p>}
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-md border border-line px-3 py-2.5">
          <dt className="text-[11.5px] text-faint">Workload</dt>
          <dd className="text-[12px] text-fg">{workloadName(f.workload)}</dd>
          <dt className="text-[11.5px] text-faint">Agent</dt>
          <dd className="font-mono text-[11px] break-all text-fg">{f.agent}</dd>
          <dt className="text-[11.5px] text-faint">Run</dt>
          <dd className="flex min-w-0 items-center break-all">
            <RunLink run={f.run} />
          </dd>
          {f.owner?.name && (
            <>
              <dt className="text-[11.5px] text-faint">Owner</dt>
              <dd className="text-[12px] break-words text-fg">
                {f.owner.name}
                {f.owner.team ? <span className="text-faint"> · {f.owner.team}</span> : null}
              </dd>
            </>
          )}
          <dt className="text-[11.5px] text-faint">Reported</dt>
          <dd className="tnum text-[12px] text-fg" title={f.created_at}>
            {shortWhen(f.created_at)}
          </dd>
          {f.updated_at && (
            <>
              <dt className="text-[11.5px] text-faint">Updated</dt>
              <dd className="tnum text-[12px] text-fg" title={f.updated_at}>
                {shortWhen(f.updated_at)}
              </dd>
            </>
          )}
        </dl>

        <Block title="Evidence" meta={evidence.length || undefined}>
          {evidence.length === 0 ? (
            <p className="text-[12px] text-faint">{partial ? "—" : "No journal entry is linked to this finding."}</p>
          ) : (
            <ul className="flex flex-col overflow-hidden rounded-md border border-line">
              {evidence.map((e, i) => (
                <li key={`${e.run}-${e.entry}-${i}`} className="border-b border-line last:border-b-0">
                  <Link href={`/runs?id=${encodeURIComponent(e.run)}&entry=${encodeURIComponent(e.entry)}`} className="focusable flex flex-col gap-0.5 px-3 py-2 hover:bg-raise/50">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 text-[12px] font-medium break-words text-fg underline decoration-line-strong underline-offset-2">{e.label || `Entry ${e.entry}`}</span>
                      {e.kind && <Tag>{e.kind}</Tag>}
                    </span>
                    <span className="font-mono text-[10.5px] break-all text-faint">
                      run {e.run} · entry {e.entry}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Block>

        <Block title="Status history" meta={history.length || undefined}>
          {history.length === 0 ? (
            <p className="text-[12px] text-faint">{partial ? "—" : "No status change is recorded."}</p>
          ) : (
            <ol className="flex flex-col overflow-hidden rounded-md border border-line">
              {history.map((h, i) => (
                <li key={`${h.at}-${i}`} className="flex flex-col gap-1 border-b border-line px-3 py-2 last:border-b-0">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {h.from ? (
                      <>
                        <FindingStatusMark status={h.from} />
                        <span className="text-[11px] text-faint">to</span>
                      </>
                    ) : (
                      <span className="text-[11px] text-faint">Reported as</span>
                    )}
                    <FindingStatusMark status={h.to} />
                  </span>
                  <span className="text-[11px] text-faint">
                    {h.by ? `${h.by} · ` : ""}
                    <span className="tnum" title={h.at}>
                      {shortWhen(h.at)}
                    </span>
                  </span>
                  {h.note && <span className="text-[12px] leading-[1.5] break-words text-mist">{h.note}</span>}
                </li>
              ))}
            </ol>
          )}
        </Block>

        <Triage finding={f} onChanged={onChanged} />
      </div>
    </div>
  );
}

/** The finding at `?id=`, over the list. `row` is the list's copy, shown until the finding's own door answers. */
function FindingPanel({ id, row, onClose, onChanged }: { id: string; row: Finding | null; onClose: () => void; onChanged: () => void }) {
  const { answer, reload } = useDoor<Finding>("finding", { params: { id } });
  const full = answer?.state === "ok" && answer.data && typeof answer.data === "object" ? answer.data : null;
  const shown = full ?? row;
  const changed = () => {
    reload();
    onChanged();
  };
  return (
    <DrillModal
      title={shown?.title || "Finding"}
      onClose={onClose}
      subtitle={
        <span className="font-mono text-[10.5px] break-all">
          {id}
          {shown ? ` · ${shown.agent}` : ""}
        </span>
      }
    >
      {answer?.state === "error" && (
        <div className="px-5 pt-5">
          <Banner tone="err" title="Could not read this finding">
            {answer.message}
          </Banner>
        </div>
      )}
      {answer?.state === "pending" && (
        <div className="flex flex-col gap-4 p-5">
          <NotConnected door={answer.door} />
          {!row && (
            <div className="max-w-[520px]">
              <Triage finding={null} disabled onChanged={changed} />
            </div>
          )}
        </div>
      )}
      {!answer && !shown && <p className="p-5 text-[12px] text-faint">Reading the finding…</p>}
      {shown && <FindingView finding={shown} partial={!full} onChanged={changed} />}
    </DrillModal>
  );
}

/* ═══════════════════ the list ═══════════════════ */

function FindingsTable({ rows, selected, hrefOf, onOpen }: { rows: Finding[]; selected: string | null; hrefOf: (id: string) => string; onOpen: (id: string) => void }) {
  return (
    <div className="af-list af-list-tall overflow-x-auto">
      <table className="w-full min-w-[920px] border-collapse text-[11.5px]">
        <thead>
          <tr className="border-b border-line bg-raise/55 text-left text-[10.5px] text-faint">
            {HEAD.map((h, i) => (
              <th key={h} className={`py-2 font-medium whitespace-nowrap ${i === 0 ? "px-4" : "px-3"}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr key={f.id} onClick={() => onOpen(f.id)} className={`cursor-pointer border-b border-line align-top last:border-0 hover:bg-raise/50 ${selected === f.id ? "bg-raise/50" : ""}`}>
              <td className="px-4 py-2">
                <SeverityTag severity={f.severity} />
              </td>
              <td className="max-w-[420px] px-3 py-2">
                <Link href={hrefOf(f.id)} onClick={(e) => e.stopPropagation()} className="focusable rounded-sm text-[12px] font-medium break-words text-fg hover:underline">
                  {f.title || f.id}
                </Link>
                <div className="font-mono text-[10.5px] break-all text-faint">{f.id}</div>
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-dim">{workloadName(f.workload)}</td>
              <td className="px-3 py-2">
                <FindingStatusMark status={f.status} />
              </td>
              <td className="px-3 py-2 font-mono text-[10.5px] whitespace-nowrap text-dim">{f.agent}</td>
              <td className="px-3 py-2 whitespace-nowrap">
                <RunLink run={f.run} />
              </td>
              <td className="tnum px-3 py-2 whitespace-nowrap text-faint" title={f.created_at}>
                {shortWhen(f.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FindingsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const run = params.get("run") ?? "";
  const workload = params.get("workload") ?? "";
  const severity = params.get("severity") ?? "";
  const status = params.get("status") ?? "";
  const agent = params.get("agent") ?? "";
  const scopeParam = params.get("scope");
  // `mine`, `team` (the platform answers a person with no team their own) or every finding.
  const scope: Scope = scopeParam === "mine" || scopeParam === "team" ? scopeParam : "all";
  const selected = params.get("id");
  const [q, setQ] = useState("");
  const [agents, setAgents] = useState<string[]>([]);
  /** Why the agents were not read: the agent filter then offers only those on the findings read, and says why. */
  const [agentsError, setAgentsError] = useState("");

  const hrefWith = useCallback(
    (next: Record<string, string | null>) => {
      const merged: Record<string, string | null> = { run, workload, severity, status, agent, scope: scope === "all" ? null : scope, id: selected, ...next };
      const query = new URLSearchParams();
      for (const [k, v] of Object.entries(merged)) if (v) query.set(k, v);
      const s = query.toString();
      return `/findings${s ? `?${s}` : ""}`;
    },
    [run, workload, severity, status, agent, scope, selected],
  );
  /** Filters replace the address; opening a finding adds to history, so Back closes it. */
  const filter = useCallback((next: Record<string, string | null>) => router.replace(hrefWith(next), { scroll: false }), [router, hrefWith]);
  const open = useCallback((id: string | null) => router.push(hrefWith({ id }), { scroll: false }), [router, hrefWith]);

  const { answer, reload } = useDoor<FindingList>("findings", { query: { run, agent, workload, status, scope, limit: LIMIT } });

  useEffect(() => {
    let live = true;
    listAgents()
      .then((a) => {
        if (!live) return;
        setAgents(a.map((x) => x.id));
        setAgentsError("");
      })
      .catch((e) => {
        if (!live) return;
        setAgents([]);
        setAgentsError((e as Error).message);
      });
    return () => {
      live = false;
    };
  }, []);

  const rows = useMemo(() => (answer?.state === "ok" && Array.isArray(answer.data?.findings) ? answer.data.findings : []), [answer]);
  const total = answer?.state === "ok" && typeof answer.data?.total === "number" ? answer.data.total : rows.length;
  const searched = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((f) => [f.title, f.id, f.run, f.agent, f.summary ?? "", workloadName(f.workload)].some((x) => x.toLowerCase().includes(needle)));
  }, [rows, q]);
  const counts = useMemo(() => countBySeverity(searched), [searched]);
  const shown = useMemo(() => searched.filter((f) => !severity || f.severity === severity).sort(bySeverityThenRecent), [searched, severity]);

  // Agents to filter by: the registry's, and any the findings name that it does not.
  const agentOptions = useMemo(() => [...new Set([...agents, ...rows.map((f) => f.agent), agent].filter(Boolean))].sort(), [agents, rows, agent]);
  const set = [workload, severity, status, agent, run].filter(Boolean).length + (scope === "all" ? 0 : 1) + (q.trim() ? 1 : 0);
  const selectedRow = selected ? (rows.find((f) => f.id === selected) ?? null) : null;

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-5 px-5 py-7" data-hue="red">
      <GroupHeader group="results" tab="findings">
        Each finding with its severity, status, agent and run.
      </GroupHeader>

      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface px-4 py-3 elev-1">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <span className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-faint">Whose</span>
            <span className="flex h-8 items-center rounded-md border border-line bg-canvas p-0.5" role="radiogroup" aria-label="Whose findings">
              {SCOPES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={scope === s.id}
                  aria-disabled={s.off || undefined}
                  disabled={s.off}
                  title={s.title}
                  onClick={() => filter({ scope: s.id === "all" ? null : s.id })}
                  className={`focusable h-full rounded-[5px] px-2.5 text-[11.5px] font-medium whitespace-nowrap ${s.off ? "cursor-not-allowed text-ghost" : scope === s.id ? "cursor-pointer bg-surface text-fg elev-1" : "cursor-pointer text-faint hover:text-fg"}`}
                >
                  {s.label}
                  {s.off && <span className="ml-1 text-[10px] font-normal">not built</span>}
                </button>
              ))}
            </span>
          </span>
          <Filter label="Workload" width="w-44">
            <Pick value={workload} onChange={(v) => filter({ workload: v || null })} aria-label="Workload" options={[{ value: "", label: "Every workload" }, ...WORKLOADS.map((w) => ({ value: w.id as string, label: w.name }))]} />
          </Filter>
          <Filter label="Severity" width="w-36">
            <Pick value={severity} onChange={(v) => filter({ severity: v || null })} aria-label="Severity" options={[{ value: "", label: "Every severity" }, ...SEVERITIES.map((s) => ({ value: s as string, label: SEVERITY_META[s].label }))]} />
          </Filter>
          <Filter label="Status" width="w-36">
            <Pick
              value={status}
              onChange={(v) => filter({ status: v || null })}
              aria-label="Status"
              options={[{ value: "", label: "Every status" }, ...FINDING_STATUSES.map((s) => ({ value: s as string, label: FINDING_STATUS_META[s].label })), ...(status && !FINDING_STATUSES.includes(status as FindingStatus) ? [{ value: status, label: findingStatusMeta(status).label }] : [])]}
            />
          </Filter>
          <Filter label="Agent" width="w-44">
            <Pick value={agent} onChange={(v) => filter({ agent: v || null })} aria-label="Agent" options={[{ value: "", label: "Every agent" }, ...agentOptions.map((a) => ({ value: a, label: a }))]} />
            {agentsError && <span className="text-[10.5px] leading-[1.4] text-err" title={agentsError}>The agents could not be read.</span>}
          </Filter>
          <Filter label="Search" width="w-52">
            <span className="flex h-8 items-center">
              <SearchBox value={q} onChange={setQ} placeholder="Title, id, run or agent" width="w-full" />
            </span>
          </Filter>
        </div>
        {set > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <ActiveFilters items={run ? [{ key: "run", label: `Run ${run}` }] : []} onClear={() => filter({ run: null })} />
            <Button
              size="sm"
              variant="solid"
              tone="neutral"
              onClick={() => {
                setQ("");
                router.replace(selected ? `/findings?id=${encodeURIComponent(selected)}` : "/findings", { scroll: false });
              }}
            >
              Clear {set} filter{set === 1 ? "" : "s"}
            </Button>
          </div>
        )}
      </div>

      {answer?.state === "error" && (
        <Banner tone="err" title="Could not read the findings" action={<Button size="sm" variant="solid" tone="neutral" onClick={reload}>Try again</Button>}>
          {answer.message}
        </Banner>
      )}

      {answer?.state === "ok" && (
        <div className="grid grid-cols-2 overflow-hidden rounded-md border border-line bg-surface sm:grid-cols-5" aria-label="Findings by severity">
          {SEVERITIES.map((s) => {
            const on = severity === s;
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                title={on ? "Show every severity" : `Show only ${SEVERITY_META[s].label.toLowerCase()}`}
                onClick={() => filter({ severity: on ? null : s })}
                className={`focusable -mr-px -mb-px flex cursor-pointer flex-col items-start gap-1.5 border-r border-b border-line px-3 py-2.5 text-left hover:bg-raise/50 ${on ? "bg-raise/80" : ""}`}
              >
                <SeverityTag severity={s} />
                <span className="tnum text-[22px] leading-none font-semibold tracking-[-0.02em] text-fg">{count(counts[s])}</span>
              </button>
            );
          })}
        </div>
      )}

      <section className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
        <FindingsTable rows={shown} selected={selected} hrefOf={(id) => hrefWith({ id })} onOpen={open} />
        {answer === null && <p className="px-4 py-6 text-[12px] text-faint">Reading the findings…</p>}
        {answer?.state === "pending" && (
          <div className="p-4">
            <NotConnected door={answer.door} />
          </div>
        )}
        {answer?.state === "error" && <p className="px-4 py-6 text-[12px] text-faint">Not read.</p>}
        {answer?.state === "ok" && shown.length === 0 && (
          <div className="p-4">
            {rows.length === 0 && notBuilt(notBuiltOf(answer.data), "producer") ? (
              <EmptyState title="Not built" />
            ) : rows.length === 0 ? (
              <EmptyState title={set > 0 ? "No finding matches these filters" : "No findings yet"} />
            ) : (
              <EmptyState title="No finding matches" />
            )}
          </div>
        )}
        {answer?.state === "ok" && rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-2 text-[11px] text-faint">
            <span className="tnum">
              {shown.length === rows.length ? `${count(rows.length)} finding${rows.length === 1 ? "" : "s"}` : `${count(shown.length)} of ${count(rows.length)} findings shown`}
            </span>
            <span>Sorted by severity, then most recent.</span>
            {total > rows.length && (
              <span className="text-warn">
                {count(total)} match on record, {count(rows.length)} read here; narrow the filters for the rest.
              </span>
            )}
          </div>
        )}
      </section>

      {selected && <FindingPanel key={selected} id={selected} row={selectedRow} onClose={() => router.push(hrefWith({ id: null }), { scroll: false })} onChanged={reload} />}
    </div>
  );
}

export function FindingsView() {
  return (
    <Suspense>
      <FindingsPage />
    </Suspense>
  );
}
