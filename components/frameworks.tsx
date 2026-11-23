"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Status, Tag } from "./ui";
import { Banner } from "./overlays";
import { Field, Input } from "./forms";
import { Pick } from "./select";
import { ControlRef } from "./control-ref";
import { Figures, Section } from "./section";
import { GroupHeader } from "./page-tabs";
import { soon } from "@/lib/soon";
import { listAgents, type AgentSummary } from "@/lib/api/l2";
import { OBLIGATION_STATUSES, getFrameworkView, listFrameworks, type AgentObligation, type FrameworkAgent, type FrameworkInfo, type RegulatoryView } from "@/lib/api/assurance";
import { CONFIGURATION_META, OBLIGATION_META, frameworkLine, isUnmapped, unmappedLine, viewCounts } from "@/lib/assurance-words";
import { whenText } from "@/lib/lifecycle";

/**
 * Framework views: the estate through one framework. Each saved agent is set
 * against the framework's obligations, each obligation reading evidenced (a
 * control answering it is enforced now and fired in the period), configured
 * (one is enforced now and none fired), or not evidenced (none answering it is
 * enforced now, or none answers it), with the controls and firings behind it.
 * Enforcement is read when the view is asked for. The client's own list (the
 * ABB ICL) is a framework here once it is loaded on the Compliance page, and
 * says it is not loaded until then. The doors are lib/api/assurance.ts, the
 * words lib/assurance-words.ts.
 */

/** The plain statement for a framework with no obligations mapped. Renders nothing for one that has them. */
export function UnmappedNotice({ framework }: { framework: FrameworkInfo }) {
  if (!isUnmapped(framework)) return null;
  return (
    <Banner tone="warn" title={`No obligations of ${framework.short} are mapped`}>
      {unmappedLine(framework)} Nothing on this page says an agent meets it.
    </Banner>
  );
}

function ObligationRow({ o }: { o: AgentObligation }) {
  const m = OBLIGATION_META[o.status];
  return (
    <details className="border-b border-line last:border-b-0">
      <summary className="focusable flex cursor-pointer flex-wrap items-center gap-2 px-3 py-1.5 text-[11.5px] hover:bg-raise/40">
        <span className="font-mono text-[10.5px] text-mist">{o.ref}</span>
        <span className="text-fg">{o.name}</span>
        <span className="grow" />
        <Status tone={m.tone}>{m.label}</Status>
      </summary>
      <ul className="flex flex-col gap-1 border-t border-line bg-raise/20 px-3 py-2">
        <li className="text-[10.5px] leading-[1.5] text-faint">{o.detail}.</li>
        {o.controls.map((c) => {
          const conf = CONFIGURATION_META[c.configuration] ?? { label: c.configuration, tone: "neutral" as const };
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
              <ControlRef control={c.id} />
              <span className="text-fg">{c.title}</span>
              <Tag tone={conf.tone}>{conf.label}</Tag>
              {c.firings === null ? (
                <span className="text-faint">acts outside a run: no firing is counted</span>
              ) : c.firings > 0 ? (
                <Link href={`/evidence?control=${encodeURIComponent(c.id)}`} className="focusable rounded-sm text-dim underline">
                  {c.firings} firing{c.firings === 1 ? "" : "s"}
                  {c.latest ? `, latest ${whenText(c.latest)}` : ""}
                </Link>
              ) : (
                <span className="text-faint">no firing</span>
              )}
              {c.detail && <span className="w-full pl-1 text-[10.5px] leading-[1.5] text-faint">{c.detail}</span>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function AgentCard({ a }: { a: FrameworkAgent }) {
  return (
    <div className="overflow-hidden rounded-md border border-line">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/40 px-3 py-2">
        <Link href={`/lifecycle?agent=${encodeURIComponent(a.agent)}`} className="focusable rounded-sm text-[12.5px] font-semibold text-fg hover:underline">
          {a.agent}
        </Link>
        {a.deployed && <Tag>deployed version {a.deployed.version}</Tag>}
        <span className="grow" />
        <span className="text-[10.5px] text-faint">{OBLIGATION_STATUSES.filter((s) => a.summary[s]).map((s) => `${a.summary[s]} ${OBLIGATION_META[s].label.toLowerCase()}`).join(" · ") || "no obligations mapped"}</span>
      </div>
      {a.obligations.length ? (
        a.obligations.map((o) => <ObligationRow key={`${o.ref}:${o.name}`} o={o} />)
      ) : (
        <p className="px-3 py-2 text-[11px] text-faint">No obligations mapped, so nothing to read for this agent.</p>
      )}
    </div>
  );
}

/** The estate through one framework. Presentational. */
export function FrameworkViewPanel({ view }: { view: RegulatoryView }) {
  const unmapped = isUnmapped(view.framework);
  const counts = viewCounts(view);
  return (
    <div className="flex flex-col gap-3">
      <UnmappedNotice framework={view.framework} />
      {!unmapped && <Figures items={OBLIGATION_STATUSES.map((s) => ({ k: OBLIGATION_META[s].label.toLowerCase(), v: counts[s] }))} />}
      <p className="text-[11px] text-faint">
        {view.framework.name} · {whenText(view.period.from)} to {whenText(view.period.to)}
        {view.framework.mapping.length ? ` · mapped from ${view.framework.mapping.join(" and ")}` : ""}
      </p>
      <p className="text-[11px] text-faint">
        {[view.framework.scope, view.as_of]
          .filter(Boolean)
          .map((x) => `${x.charAt(0).toUpperCase()}${x.slice(1)}.`)
          .join(" ")}
      </p>
      {view.agents.length ? (
        <div className="grid items-start gap-3 lg:grid-cols-2">
          {view.agents.map((a) => (
            <AgentCard key={a.agent} a={a} />
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-faint">No agent is saved yet.</p>
      )}
    </div>
  );
}

function FrameworksPage() {
  const params = useSearchParams();
  const router = useRouter();
  const [frameworks, setFrameworks] = useState<FrameworkInfo[] | null>(null);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [agent, setAgent] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [view, setView] = useState<RegulatoryView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const name = params.get("name") ?? frameworks?.[0]?.id ?? "";
  const iso = (local: string): string | undefined => (local && !Number.isNaN(Date.parse(local)) ? new Date(local).toISOString() : local || undefined);
  const load = useCallback(() => {
    if (!name) return;
    setBusy(true);
    getFrameworkView(name, { agent: agent || undefined, from: iso(from), to: iso(to) })
      .then((v) => {
        setView(v);
        setError("");
      })
      .catch((e) => {
        setView(null);
        setError((e as Error).message);
      })
      .finally(() => setBusy(false));
  }, [name, agent, from, to]);
  useEffect(() => soon(load), [load]);
  useEffect(() => {
    listFrameworks()
      .then(setFrameworks)
      .catch((e) => setError((e as Error).message));
    listAgents()
      .then(setAgents)
      .catch(() => setAgents([]));
  }, []);
  const groups = useMemo(() => {
    const all = frameworks ?? [];
    return [
      { title: "Regulations", rows: all.filter((f) => f.kind === "regulation") },
      { title: "Frameworks", rows: all.filter((f) => f.kind !== "regulation") },
    ];
  }, [frameworks]);
  // A framework catalogue that did not answer: the failure is shown above, and both panels say they were not read.
  const quietDown = Boolean(error) && !frameworks;
  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7">
      <GroupHeader group="assurance" tab="frameworks">
        The estate through one framework or regulation: each saved agent against its obligations, with the controls and firings that answer each. Where no control answers an obligation, or nothing is mapped, this says so rather than showing an empty pass.
      </GroupHeader>
      {error && (
        <Banner tone="err" title="Could not read the framework">
          {error}
        </Banner>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Section title="Frameworks and regulations" hue="control">
          {frameworks === null && <p className="text-[12px] text-faint">{quietDown ? "Not read." : "Reading the catalogue…"}</p>}
          {frameworks?.length === 0 && <p className="text-[12px] text-faint">No framework or regulation is in the catalogue.</p>}
          {groups.map((g) =>
            g.rows.length ? (
              <div key={g.title} className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-dim">{g.title}</span>
                <ul className="flex flex-col">
                  {g.rows.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => router.push(`/frameworks?name=${encodeURIComponent(f.id)}`)}
                        className={`focusable flex w-full cursor-pointer flex-col rounded-sm px-2 py-1.5 text-left hover:bg-raise/40 ${f.id === name ? "bg-raise/60" : ""}`}
                      >
                        <span className="text-[12px] font-medium text-fg">{f.short}</span>
                        <span className={`text-[10.5px] ${isUnmapped(f) ? "text-warn" : "text-faint"}`}>{frameworkLine(f)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </Section>
        <Section
          title={view?.framework.short ?? "View"}
          hue="control"
          meta={view ? `${view.count} agent${view.count === 1 ? "" : "s"}` : error ? "not read" : frameworks?.length === 0 ? undefined : name ? "reading…" : "pick one"}
          action={
            name ? (
              <Button size="sm" variant="solid" tone="neutral" disabled={!view || isUnmapped(view.framework)} href={`/evidence?framework=${encodeURIComponent(name)}`}>
                Evidence pack
              </Button>
            ) : quietDown ? (
              <Button size="sm" variant="solid" tone="neutral" disabled>
                Evidence pack
              </Button>
            ) : undefined
          }
        >
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Agent">
              <Pick value={agent} onChange={setAgent} options={[{ value: "", label: "Every agent" }, ...agents.map((a) => ({ value: a.id, label: a.name }))]} />
            </Field>
            <Field label="From" hint="the default is 30 days back">
              <Input type="datetime-local" value={from} onChange={setFrom} />
            </Field>
            <Field label="To" hint="the default is now">
              <Input type="datetime-local" value={to} onChange={setTo} />
            </Field>
          </div>
          {view ? <FrameworkViewPanel view={view} /> : busy ? <p className="text-[12px] text-faint">Reading…</p> : quietDown ? <p className="text-[12px] text-faint">Not read.</p> : null}
        </Section>
      </div>
    </div>
  );
}

export function FrameworksView() {
  return (
    <Suspense>
      <FrameworksPage />
    </Suspense>
  );
}
