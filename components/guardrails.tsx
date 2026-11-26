"use client";
import { AnswerFailure } from "./pending";
import { ask, type Answer } from "@/lib/api/pending";

import { useEffect, useMemo, useState } from "react";
import { soon } from "@/lib/soon";
import { Mono, Status, Tag } from "./ui";
import { DrillModal } from "./drill";
import { usePageFacts } from "./assistant";
import { DOMAINS, EXECUTIVE_TAKEAWAY, GUARDRAILS } from "@/lib/data-guardrails";
import { CLIENT_RESPONSIBILITIES, CONTROLS, FAMILIES, RESIDUAL_RISK, type Control } from "@/lib/guardrails";
import type { WatchEvent } from "@/lib/guardrails-watch";
import { GuardrailsWatch } from "./guardrails-watch";
import { GroupHeader } from "./page-tabs";
import { enforcementOf, servedReferences, useControls, type ServedFramework } from "@/lib/controls-status";
import { notBuilt, notBuiltOf } from "@/lib/not-built";
import { ScreenerHealthLine } from "./screener-health";

/**
 * The control register, and the framework it is assessed against.
 *
 * Two views on one page. The register is what the platform enforces, written
 * as controls with identifiers, statements, implementation and evidence, and
 * the standards each derives from. The framework is the enterprise guardrail
 * set, with the responsibility split that says who implements what.
 *
 * Firing counts come from the run journals; zero is shown as zero. The
 * responsibility split and the residual risk carry the same weight as the
 * controls, because that is what a control document does.
 */

interface Data {
  /** null when the platform cannot say; its reason is beside it (`runs_why`, lib/not-built.ts unknownWhy). */
  runs: number | null;
  counts: Record<string, number>;
  byAgent: Record<string, Record<string, number>>;
  recent: { control: string; run: string; agent: string; node: string; title: string; detail: string; at: string }[];
  /** The injection and exfiltration watch: screened hits, taint-to-sink and egress refusals, excerpts redacted. */
  events?: WatchEvent[];
  posture: { agents: number | null; tools: number | null; tainting: number | null; sinks: number | null; gatedWorkflows: number | null; byRisk: Record<string, number> };
  not_built?: string[];
}

/** A figure of the firing record as a reader sees it: the number, or "—" when the answer gives null. */
function figure<T extends object>(row: T, key: keyof T & string): string {
  const v = (row as Record<string, unknown>)[key];
  return typeof v === "number" ? String(v) : "—";
}

type View = "register" | "framework" | "watch";
const VIEW_LABEL: Record<View, string> = { register: "The control catalogue", framework: "Data security guardrails", watch: "Injection and exfiltration watch" };

const STD_TONE: Record<string, string> = {
  "OWASP Agentic": "var(--t-c2)", "OWASP LLM": "var(--t-c7)", "NIST AI RMF": "var(--t-c5)", "ISO/IEC 42001": "var(--t-c1)", "EU AI Act": "var(--t-c8)",
};
const FAMILY_COLOR: Record<string, string> = {
  AC: "var(--t-c1)", DP: "var(--t-c2)", HO: "var(--t-c8)", IN: "var(--t-c5)", RS: "var(--t-c7)", AU: "var(--t-c3)", ID: "var(--t-c9)",
};
const RESP_COLOR = { platform: "var(--t-ok)", shared: "var(--t-warn)", client: "var(--t-line-strong)" } as const;
const RESP_LABEL = { platform: "Platform", shared: "Shared", client: "Deployment" } as const;

function Chip({ std, ref_, name }: { std: string; ref_: string; name: string }) {
  return (
    <span title={`${std} — ${name}`} className="inline-flex items-center gap-1 rounded-sm border border-line bg-raise px-1.5 py-px text-[9.5px] text-dim">
      <span className="size-1.5 rounded-[2px]" style={{ background: STD_TONE[std] ?? "var(--t-fg-4)" }} />
      {ref_}
    </span>
  );
}

export function Guardrails() {
  /** Whether this deployment enforces each control now, and its firings (GET /api/controls): the only source of either once it answers. */
  const status = useControls();
  const fromControls = status?.state === "ok";
  // Where each control is cited or placed is the service's (GET /api/controls `references`, `frameworks`), never the console's own copy.
  const served: ServedFramework[] | null = status?.state === "ok" ? status.frameworks : null;
  const cited = (served ?? []).filter((f) => f.basis === "cited");
  const placed = (served ?? []).filter((f) => f.basis === "placed");
  /** Why the service's mapping is not on the page, when it is not: still reading, not built, failed, or an answer without it. */
  const mapWhy = !status ? "Reading…" : status.state === "pending" ? "Not built" : status.state !== "ok" ? "Not read" : served === null ? "—" : "";
  const refsOf = (c: Control) => servedReferences(status, c.id);
  /** The domain a framework places a control in, as the service serves it. */
  const placedIn = (f: ServedFramework, id: string) => f.obligations.find((o) => o.controls.includes(id)) ?? null;
  const [data, setData] = useState<Data | null>(null);
  /** The firing record's own not-built list. */
  const unbuilt = notBuiltOf(data);
  /** The firings read (GET /api/guardrails) as it answered: not built, failed, or the record. */
  const [answer, setAnswer] = useState<Answer<unknown> | null>(null);
  const failed = answer !== null && answer.state !== "ok";
  const [open, setOpen] = useState<string | null>(null);
  const [std, setStd] = useState("");
  const [view, setView] = useState<View>("register");
  const [domain, setDomain] = useState("");
  const [groupBy, setGroupBy] = useState<"family" | string>("family");
  // Collapsed groups, by group id. Every group starts open; the choice is the reader's for the visit.
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const toggleFold = (id: string) =>
    setFolded((f) => {
      const n = new Set(f);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  useEffect(() => {
    let stop = false;
    ask<Data>("guardrails").then((a) => {
      if (stop) return;
      // An answer that is not the record is a failed read, never a record to draw.
      if (a.state === "ok" && (!a.data || typeof a.data.counts !== "object" || !a.data.posture)) {
        setAnswer({ state: "error", message: "GET /api/guardrails answered with something that is not the record of firings" });
        return;
      }
      setAnswer(a);
      if (a.state === "ok") setData({ ...a.data, recent: Array.isArray(a.data.recent) ? a.data.recent : [] });
    });
    return () => { stop = true; };
  }, []);

  // Arriving from a firing elsewhere in the console: open that control and
  // bring it into view, so the link from the evidence lands on the statement.
  // Arriving from an application's dashboard: open the watch.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("view") !== "watch") return;
    return soon(() => setView("watch"));
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("control");
    if (!id || !CONTROLS.some((c) => c.id === id)) return;
    return soon(() => {
      setView("register");
      setStd("");
      setFolded(new Set());
      setOpen(id);
      setTimeout(() => document.getElementById(`control-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
    });
  }, []);

  const shown = useMemo(
    () => (std ? CONTROLS.filter((c) => { const r = servedReferences(status, c.id); return r.refs !== null && r.refs.some((x) => x.std === std); }) : CONTROLS),
    [std, status],
  );
  // A control is counted under its journal key (what the policy engine writes
  // on a refusal) and under its catalogue id (what the runtime stamps on a
  // kill or a marking); a reviewer sees one number.
  const keysOf = (c: Control) => (c.journal === c.id ? [c.id] : [c.journal, c.id]).filter((k) => k !== "—");
  const sumOf = (m: Record<string, number> | undefined, c: Control) => keysOf(c).reduce((n, k) => n + (m?.[k] ?? 0), 0);
  const fired = (c: Control) => (c.journal === "—" ? null : sumOf(data?.counts, c));
  /** A control's firing count as a reader sees it: the platform's own figure once GET /api/controls answers, else the firing record's sum, else nothing. */
  const firedText = (c: Control): { text: string; title?: string; n: number } | null => {
    if (status?.state === "ok") {
      const st = status.byId.get(c.id);
      if (!st) return null;
      return st.fired === null ? { text: "fired: —", title: st.firedWhy, n: 0 } : { text: `${st.fired} fired`, n: st.fired };
    }
    const n = fired(c);
    return n === null || bare ? null : { text: `${n} fired`, n };
  };
  /** A control's count for a sum: the platform's own figure once GET /api/controls answers (an unknown one adds nothing), else the firing record's. */
  const firedFor = (c: Control): number => (status?.state === "ok" ? (status.byId.get(c.id)?.fired ?? 0) : (fired(c) ?? 0));
  /** Whether the platform does not know a control's count (`fired: null`, or the control is not in its answer): a sum over it is partial and says so. */
  const firedUnknown = (c: Control): boolean => status?.state === "ok" && (status.byId.get(c.id)?.fired ?? null) === null;
  const partial = (n: number, unknown: number) => `${n}${unknown ? ` + ${unknown} not counted` : ""}`;
  const familyTotal = CONTROLS.reduce((a, c) => a + firedFor(c), 0);
  const enforcedCount = status?.state === "ok" ? [...status.byId.values()].filter((x) => x.state === "enforced" && CONTROLS.some((c) => c.id === x.id)).length : 0;
  const totalFired = data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : 0;
  // Firings not read (the address is not built, or the read failed): the register is shown as the catalogue it is,
  // and every figure read from the record is left out, never drawn as a zero.
  const noRecord = failed;
  const bare = noRecord || data === null;
  // The register can be read in the platform's own families or in another
  // framework's domains; the controls are the same, only the shelves move.
  const DOMAIN_PALETTE = ["var(--t-c1)", "var(--t-c2)", "var(--t-c5)", "var(--t-c7)", "var(--t-c8)", "var(--t-c3)", "var(--t-c6)", "var(--t-c9)", "var(--t-c4)"];
  const grouping = groupBy === "family" ? null : placed.find((f) => f.id === groupBy) ?? null;
  const groups: { id: string; name: string; purpose: string; color: string; member: (c: Control) => boolean }[] = grouping
    ? grouping.obligations.map((d, i) => ({ id: d.ref, name: d.name, purpose: d.note ?? "", color: DOMAIN_PALETTE[i % DOMAIN_PALETTE.length], member: (c) => d.controls.includes(c.id) }))
    : FAMILIES.map((f) => ({ id: f.id, name: f.name, purpose: f.purpose, color: FAMILY_COLOR[f.id], member: (c) => c.family === f.id }));
  const resp = (["platform", "shared"] as const).map((r) => ({
    label: RESP_LABEL[r], value: GUARDRAILS.filter((g) => g.responsibility === r).length, color: RESP_COLOR[r],
  }));
  const openControl = open ? CONTROLS.find((c) => c.id === open) ?? null : null;
  const openGuardrail = open && !openControl ? GUARDRAILS.find((g) => g.id === open) ?? null : null;
  const openFired = openControl ? fired(openControl) : null;
  const openFirings = openControl && data ? data.recent.filter((e) => keysOf(openControl).includes(e.control)).slice(0, 8) : [];
  usePageFacts({
    view,
    controls: CONTROLS.length,
    families: FAMILIES.map((f) => f.name),
    standardFilter: std || null,
    openControl: open,
    frameworkSplit: Object.fromEntries(resp.map((r) => [r.label, r.value])),
    firings: data ? { runs: data.runs, counts: data.counts, recent: data.recent.slice(0, 5) } : "loading",
  });

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-5 px-5 py-7" data-hue="indigo">
      <GroupHeader
        group="controls"
        tab="catalogue"
        actions={
          <span className="flex flex-wrap items-center rounded-md border border-line bg-canvas p-0.5" role="group" aria-label="Catalogue view">
            {(["register", "framework", "watch"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => { setView(v); setOpen(null); }}
                className={`focusable rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium transition-colors ${view === v ? "bg-surface text-fg elev-1" : "text-faint hover:text-fg"}`}
              >
                {VIEW_LABEL[v]}
                {v === "watch" && data?.events?.length ? <span className="tnum ml-1.5 font-mono text-[10px] text-faint">{data.events.length}</span> : null}
              </button>
            ))}
          </span>
        }
      >
        {view === "watch"
          ? "Screener matches, taint-to-sink refusals and egress refusals from the run journals."
          : view === "register"
            ? `The ${CONTROLS.length} controls a deployment starts with.`
            : "The framework used to assess data security."}
      </GroupHeader>

      {/* While the platform does not report the controls it applies (GET /api/controls), the page says so before anything else. */}
      {status && status.state !== "ok" && view !== "watch" && <AnswerFailure answer={status} what="Whether each control is enforced could not be read" />}
      {noRecord && answer && view !== "watch" && <AnswerFailure answer={answer} what="The record of control firings could not be read" />}

      {view === "register" && (
        <>
          {/* ── posture band ── */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <section className={`grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line elev-1 ${bare && !noRecord ? "" : "sm:grid-cols-3"}`}>
              {[
                { label: "Controls", value: String(CONTROLS.length), sub: fromControls ? `${enforcedCount} enforced on this deployment now` : `${FAMILIES.length} families` },
                { label: "Standards cited", value: served ? String(cited.length) : "—", sub: served ? "sources, not examiners" : "not read" },
                { label: "Workflows on record", value: noRecord ? "" : data ? figure(data.posture, "agents") : "—", sub: data && data.posture.agents === null && notBuilt(unbuilt, "agents") ? "not built" : "deployed" },
                { label: "Tools in definitions", value: noRecord ? "" : data ? figure(data.posture, "tools") : "—", sub: data && !noRecord ? (data.posture.tools === null ? (notBuilt(unbuilt, "tools") ? "not built" : "") : data.posture.sinks === null ? "act outside: —" : `${data.posture.sinks} act outside`) : "" },
                { label: "Runs on record", value: noRecord ? "" : data ? figure(data, "runs") : "—", sub: data && data.runs === null && notBuilt(unbuilt, "runs") ? "not built" : "the evidence base" },
                { label: "Control firings", value: noRecord ? "" : data ? String(totalFired) : "—", sub: "refusals, marks, gates" },
              ].slice(0, bare && !noRecord ? 2 : 6).map((k) => (
                <div key={k.label} className="flex flex-col justify-center gap-0.5 bg-surface px-4 py-3">
                  {k.value ? <span className="tnum text-[22px] leading-none font-semibold tracking-[-0.02em]">{k.value}</span> : <span className="flex h-[22px] items-center text-[12px] text-faint">Not read</span>}
                  <span className="text-[11px] text-faint">{k.label}</span>
                  {k.sub && <span className="truncate text-[9.5px] text-ghost">{k.sub}</span>}
                </div>
              ))}
            </section>
            {noRecord ? (
              <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4 elev-1">
                <span className="text-[11px] font-medium tracking-[0.06em] text-faint uppercase">Firings by family</span>
                <p className="text-[11.5px] leading-[1.55] text-faint">Not read.</p>
                {FAMILIES.map((f) => (
                  <span key={f.id} className="flex items-center gap-1.5 text-[11px] text-fg">
                    <span className="size-1.5 rounded-[2px]" style={{ background: FAMILY_COLOR[f.id] }} />
                    {f.name}
                  </span>
                ))}
              </section>
            ) : bare ? null : <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4 elev-1">
              <span className="text-[11px] font-medium tracking-[0.06em] text-faint uppercase">Firings by family</span>
              {FAMILIES.map((f) => {
                const n = CONTROLS.filter((c) => c.family === f.id).reduce((s, c) => s + firedFor(c), 0);
                const unknown = CONTROLS.filter((c) => c.family === f.id && firedUnknown(c)).length;
                return (
                  <div key={f.id} className="flex flex-col gap-1">
                    <span className="flex items-baseline justify-between text-[11px]">
                      <span className="flex items-center gap-1.5 text-fg"><span className="size-1.5 rounded-[2px]" style={{ background: FAMILY_COLOR[f.id] }} />{f.name}</span>
                      <span className="tnum text-faint" title={unknown ? `${unknown} control${unknown === 1 ? "" : "s"} in this family with a count the platform does not know: the figure is partial` : undefined}>{partial(n, unknown)}</span>
                    </span>
                    <span className="block h-1 w-full overflow-hidden rounded-[2px] bg-sunken">
                      <span className="block h-full rounded-[2px]" style={{ width: `${familyTotal ? (n / familyTotal) * 100 : 0}%`, background: FAMILY_COLOR[f.id] }} />
                    </span>
                  </div>
                );
              })}
            </section>}
          </div>

          {/* ── provenance ── */}
          <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <span className="text-[13px] font-semibold tracking-[-0.005em]">Where these controls come from</span>
              <span className="text-[11.5px] text-faint">pick one to filter</span>
              <span className="grow" />
              {std && <button type="button" onClick={() => setStd("")} className="focusable text-[11px] text-faint hover:text-fg">clear</button>}
            </div>
            <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-5">
              {mapWhy && <p className="col-span-full bg-surface px-4 py-3 text-[11.5px] leading-[1.55] text-faint">{mapWhy}</p>}
              {cited.map((s) => {
                // Controls the catalogue cites an entry of this standard for, as the service serves them.
                const n = new Set(s.obligations.flatMap((o) => o.controls)).size;
                const active = std === s.short;
                return (
                  <button key={s.id} type="button" onClick={() => setStd(active ? "" : s.short)} className={`focusable flex flex-col gap-1.5 px-4 py-3 text-left transition-colors ${active ? "bg-raise" : "bg-surface hover:bg-raise/50"}`}>
                    <span className="h-[3px] w-8 rounded-full" style={{ background: STD_TONE[s.short] ?? "var(--t-fg-4)" }} />
                    <span className="flex items-baseline gap-2"><span className="text-[12px] font-semibold text-fg">{s.short}</span><span className="tnum text-[11px] text-faint" title="Controls citing it">{n}</span></span>
                    <span className="text-[10.5px] leading-[1.45] text-faint">{s.name}</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── group by: the platform's families, or a framework's domains ── */}
          <div className="flex flex-wrap items-center gap-2 px-1">
            <span className="text-[11px] font-medium tracking-[0.06em] text-faint uppercase">Group by</span>
            <span className="flex items-center rounded-md border border-line bg-canvas p-0.5">
              {[{ id: "family", short: "Platform family" }, ...placed].map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => { setGroupBy(g.id); setOpen(null); }}
                  className={`focusable rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium transition-colors ${groupBy === g.id ? "bg-surface text-fg elev-1" : "text-faint hover:text-fg"}`}
                >
                  {g.short}
                </button>
              ))}
            </span>
            {grouping && <span className="text-[11px] text-faint">{grouping.name}</span>}
          </div>

          {/* ── the register, as a card grid per group ── */}
          {groups.map((f) => {
            const rows = shown.filter(f.member);
            if (!rows.length) return null;
            const isFolded = folded.has(f.id);
            const firedHere = rows.reduce((a, c) => a + firedFor(c), 0);
            const unknownHere = rows.filter(firedUnknown).length;
            return (
              <section key={f.id} className="flex flex-col gap-3">
                <button type="button" onClick={() => toggleFold(f.id)} aria-expanded={!isFolded} className="focusable flex w-full items-baseline gap-3 rounded-md px-1 py-1 text-left hover:bg-raise/40">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 self-center text-faint transition-transform ${isFolded ? "-rotate-90" : ""}`}>
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                  <span className="h-[3px] w-6 shrink-0 self-center rounded-full" style={{ background: f.color }} />
                  <span className="text-[14px] font-semibold tracking-[-0.005em]">{f.name}</span>
                  <span className="text-[11.5px] text-faint">{f.purpose}</span>
                  <span className="tnum ml-auto shrink-0 text-[11px] text-faint">
                    {rows.length} control{rows.length === 1 ? "" : "s"}{firedHere || unknownHere ? ` · ${partial(firedHere, unknownHere)} fired` : ""}{isFolded ? " · show" : ""}
                  </span>
                </button>
                {!isFolded && (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {rows.map((c) => {
                    const n = fired(c);
                    const f = firedText(c);
                    const enf = enforcementOf(status, c.id);
                    const isOpen = open === c.id;
                    return (
                      <article key={c.id} id={`control-${c.id}`} className={`flex flex-col rounded-lg border bg-surface transition-[border-color,box-shadow] elev-1 ${isOpen ? "border-line-strong" : "border-line hover:border-line-strong"}`}>
                        <button type="button" onClick={() => setOpen(c.id)} aria-haspopup="dialog" className="focusable flex grow flex-col gap-2 p-4 text-left">
                          <span className="flex items-center gap-2">
                            <Mono className="text-[10.5px] text-faint">{c.id}</Mono>
                            <span className="grow" />
                            {enf && (
                              <span className="inline-flex">
                                <Tag tone={enf.tone}>{enf.label}</Tag>
                              </span>
                            )}
                            {f ? (
                              <span title={f.title} className={`tnum rounded-sm px-1.5 py-px text-[10px] ${f.n > 0 ? "bg-raise text-fg" : "text-ghost"}`}>{f.text}</span>
                            ) : n === null && !fromControls ? (
                              <span className="text-[10px] text-ghost">outside the run</span>
                            ) : null}
                          </span>
                          <span className="text-[13px] font-semibold tracking-[-0.005em] text-fg">{c.title}</span>
                          <span className="line-clamp-3 text-[11.5px] leading-[1.55] text-faint">{c.statement}</span>
                          <span className="flex flex-wrap gap-1 pt-1">
                            {(() => {
                              const r = refsOf(c);
                              if (r.refs === null) return <span className="text-[9.5px] text-ghost">—</span>;
                              if (!r.refs.length) return <span className="text-[9.5px] text-ghost">no standard cited</span>;
                              return r.refs.map((x) => <Chip key={`${x.std}${x.ref}`} std={x.std} ref_={x.ref} name={x.name} />);
                            })()}
                          </span>
                          {placed.length > 0 && <span className="text-[9.5px] text-ghost">{placed.map((g) => `${g.short} ${placedIn(g, c.id)?.ref ?? "—"}`).join(" · ")}</span>}
                        </button>
                      </article>
                    );
                  })}
                </div>
                )}
              </section>
            );
          })}

          {/* ── the split ── */}
          <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
            <div className="flex flex-col gap-0.5 border-b border-line px-4 py-3">
              <span className="text-[13px] font-semibold tracking-[-0.005em]">Retained by the deploying organisation</span>
              <span className="max-w-[92ch] text-[11.5px] leading-[1.5] text-faint">Controls the platform cannot implement from inside.</span>
            </div>
            <div className="grid gap-px bg-line md:grid-cols-2">
              {CLIENT_RESPONSIBILITIES.map((r) => (
                <div key={r.title} className="flex flex-col gap-1 bg-surface px-4 py-3" title={r.body}>
                  <span className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[12.5px] font-medium text-fg">{r.title}</span>
                    {r.references.map((x) => <Chip key={`${x.std}${x.ref}`} std={x.std} ref_={x.ref} name={x.name} />)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {view === "framework" && (
        <>
          {/* ── posture band ── */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 elev-1">
              <span className="text-[11px] font-medium tracking-[0.06em] text-faint uppercase">Who implements what</span>
              <span className="text-[12px] leading-[1.55] text-dim">
                {resp[0].value} given to the platform, {resp[1].value} shared; the rest stay with the deployment.
              </span>
            </section>
            <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line elev-1 sm:grid-cols-3">
              {[
                { label: "Guardrails", value: String(GUARDRAILS.length), sub: `${DOMAINS.length} domains` },
                { label: "Critical", value: String(GUARDRAILS.filter((g) => g.priority === "Critical").length), sub: "must hold at release" },
                { label: "Release gates", value: String(GUARDRAILS.filter((g) => g.gate).length), sub: "one per guardrail" },
                { label: "Given to the platform", value: String(resp[0].value), sub: "in the catalogue" },
                { label: "Shared", value: String(resp[1].value), sub: "platform plus deployment" },
                { label: "Register controls", value: String(new Set(GUARDRAILS.flatMap((g) => g.implementedBy)).size), sub: "implementing them" },
              ].map((k) => (
                <div key={k.label} className="flex flex-col justify-center gap-0.5 bg-surface px-4 py-3">
                  <span className="tnum text-[22px] leading-none font-semibold tracking-[-0.02em]">{k.value}</span>
                  <span className="text-[11px] text-faint">{k.label}</span>
                  <span className="truncate text-[9.5px] text-ghost">{k.sub}</span>
                </div>
              ))}
            </section>
          </div>

          <p className="rounded-lg border border-line bg-surface px-4 py-3 text-[12.5px] leading-[1.6] text-fg elev-1">
            {EXECUTIVE_TAKEAWAY}
          </p>

          <div className="flex flex-wrap items-center gap-1">
            <button type="button" onClick={() => setDomain("")} className={`focusable rounded-sm px-2 py-1 text-[11px] ${domain === "" ? "bg-raise text-fg" : "text-faint hover:text-fg"}`}>every domain</button>
            {DOMAINS.map((d) => (
              <button key={d} type="button" onClick={() => setDomain(domain === d ? "" : d)} className={`focusable rounded-sm px-2 py-1 text-[11px] ${domain === d ? "bg-raise text-fg" : "text-faint hover:text-fg"}`}>{d}</button>
            ))}
          </div>

          {DOMAINS.filter((d) => !domain || d === domain).map((d) => {
            const rows = GUARDRAILS.filter((g) => g.domain === d);
            const p = rows.filter((g) => g.responsibility === "platform").length;
            const sh = rows.filter((g) => g.responsibility === "shared").length;
            const isFolded = folded.has(`domain:${d}`);
            return (
              <section key={d} className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
                <button type="button" onClick={() => toggleFold(`domain:${d}`)} aria-expanded={!isFolded} className={`focusable flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-raise/40 ${isFolded ? "" : "border-b border-line"}`}>
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 text-faint transition-transform ${isFolded ? "-rotate-90" : ""}`}>
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                  <span className="text-[13px] font-semibold tracking-[-0.005em]">{d}</span>
                  <span className="text-[11.5px] text-faint">{rows.length} guardrails</span>
                  <span className="grow" />
                  <span className="tnum shrink-0 text-[10.5px] text-faint">
                    {p} platform · {sh} shared
                  </span>
                  {isFolded && <span className="text-[10.5px] text-ghost">show</span>}
                </button>
                {!isFolded && rows.map((g) => {
                  const isOpen = open === g.id;
                  return (
                    <div key={g.id} className="border-b border-line last:border-0">
                      <button type="button" onClick={() => setOpen(g.id)} aria-haspopup="dialog" className={`focusable flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-raise/40 ${isOpen ? "bg-raise/50" : ""}`}>
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-[2px]" style={{ background: RESP_COLOR[g.responsibility] }} />
                        <Mono className="w-[48px] shrink-0 pt-0.5 text-[10.5px] text-faint">{g.id}</Mono>
                        <span className="flex min-w-0 grow flex-col gap-0.5">
                          <span className="flex flex-wrap items-baseline gap-2">
                            <span className="text-[12.5px] font-medium text-fg">{g.area}</span>
                            <span className={`text-[9.5px] font-medium tracking-[0.04em] uppercase ${g.priority === "Critical" ? "text-err" : "text-warn"}`}>{g.priority}</span>
                          </span>
                          <span className="line-clamp-2 text-[11.5px] leading-[1.55] text-faint">{g.guardrail}</span>
                        </span>
                        <Status tone={g.responsibility === "platform" ? "ok" : g.responsibility === "shared" ? "warn" : "neutral"}>{RESP_LABEL[g.responsibility]}</Status>
                      </button>
                    </div>
                  );
                })}
              </section>
            );
          })}
        </>
      )}

      {view === "watch" && <ScreenerHealthLine />}
      {view === "watch" && (noRecord && answer ? <AnswerFailure answer={answer} compact={false} what="The watch could not be read" /> : <GuardrailsWatch events={data ? data.events ?? [] : null} />)}

      {/* ── the open control, as a dialog rather than a card that grows ── */}
      {openControl && (
        <DrillModal
          title={`${openControl.id} · ${openControl.title}`}
          subtitle={openControl.statement}
          onClose={() => setOpen(null)}
          actions={
            fromControls ? (
              (() => {
                const f = firedText(openControl);
                return f ? <span title={f.title} className={`tnum rounded-sm px-1.5 py-px text-[11px] ${f.n > 0 ? "bg-raise text-fg" : "text-ghost"}`}>{f.text}</span> : undefined;
              })()
            ) : openFired === null ? (
              <span className="text-[10.5px] text-ghost">outside the run</span>
            ) : bare ? undefined : (
              <span className={`tnum rounded-sm px-1.5 py-px text-[11px] ${openFired > 0 ? "bg-raise text-fg" : "text-ghost"}`}>{openFired} fired</span>
            )
          }
        >
          <div className="flex flex-wrap gap-1 border-b border-line px-4 py-3">
            {(() => {
              const r = refsOf(openControl);
              if (r.refs === null) return <span className="text-[11px] text-faint">—</span>;
              if (!r.refs.length) return <span className="text-[11px] text-faint">No standard is cited for it.</span>;
              return r.refs.map((x) => <Chip key={`${x.std}${x.ref}`} std={x.std} ref_={x.ref} name={x.name} />);
            })()}
          </div>
          <div className="grid gap-px bg-line md:grid-cols-2">
            <Cell
              k="On this deployment now"
              v={
                status?.state === "ok"
                  ? (() => {
                      const enf = enforcementOf(status, openControl.id)!;
                      const facts = status.byId.get(openControl.id)?.facts ?? [];
                      return (
                        <span className="flex flex-col gap-1">
                          <span>{`${enf.label[0].toUpperCase()}${enf.label.slice(1)}`}</span>
                          {facts.length > 0 && (
                            <span className="flex flex-col gap-0.5 text-[10.5px]">
                              {facts.map((f, i) => (
                                <span key={i}>
                                  <span className={f.holds === true ? "text-ok" : f.holds === false ? "text-err" : "text-warn"}>{f.holds === true ? "holds" : f.holds === false ? "does not hold" : "not known"}</span> · {f.said || f.fact}
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                      );
                    })()
                  : status
                    ? <AnswerFailure inline answer={status} what="Not reported" />
                    : "Reading…"
              }
            />
            {status?.state === "ok" && status.byId.has(openControl.id) && (
              <Cell
                k="Firings on this deployment"
                v={(() => {
                  const st = status.byId.get(openControl.id)!;
                  return st.fired === null ? <span title={st.firedWhy || undefined}>—</span> : st.fired.toLocaleString("en-GB");
                })()}
              />
            )}
            <Cell k="Intended implementation" v={openControl.implementation} />
            <Cell k="Evidence" v={openControl.evidence} />
            {openControl.journal !== "—" && <Cell k="Journalled as" v={<Mono className="text-[11px]">{openControl.journal}</Mono>} />}
            <Cell k="Platform family" v={FAMILIES.find((f) => f.id === openControl.family)?.name ?? openControl.family} />
            <Cell k="Framework domains" v={placed.length ? placed.map((g) => `${g.short}: ${placedIn(g, openControl.id)?.name ?? "—"}`).join(" · ") : mapWhy || "No framework places it in a domain."} />
            <Cell k="Derives from" v={(() => { const r = refsOf(openControl); return r.refs === null ? "—" : r.refs.length ? r.refs.map((x) => `${x.std} ${x.ref}: ${x.name}`).join(" · ") : "No standard is cited for it."; })()} />
            {data && openFired !== null && openFired > 0 && Object.entries(data.byAgent ?? {}).some(([, m]) => sumOf(m, openControl) > 0) && (
              <Cell k="Fired in" v={Object.entries(data.byAgent ?? {}).map(([a, m]) => [a, sumOf(m, openControl)] as const).filter(([, n]) => n > 0).map(([a, n]) => `${a} (${n})`).join(", ")} />
            )}
            {GUARDRAILS.some((g) => g.implementedBy.includes(openControl.id)) && (
              <Cell k="Implements guardrails" v={GUARDRAILS.filter((g) => g.implementedBy.includes(openControl.id)).map((g) => `${g.id} ${g.area}`).join(" · ")} />
            )}
          </div>
          {openFirings.length > 0 && (
            <div className="flex flex-col border-t border-line">
              <span className="px-4 pt-3 pb-1 text-[10.5px] font-medium tracking-[0.04em] text-ghost uppercase">Latest firings · click through to the run</span>
              {openFirings.map((e, i) => (
                <a key={`${e.run}-${i}`} href={`/runs?id=${encodeURIComponent(e.run)}`} className="focusable flex items-baseline gap-3 border-b border-line px-4 py-2 last:border-0 hover:bg-raise/40">
                  <span className="flex min-w-0 grow flex-col">
                    <span className="truncate text-[11.5px] text-fg">{e.title}</span>
                    <span className="truncate text-[10.5px] text-faint">{e.detail}</span>
                  </span>
                  <span className="shrink-0 text-[10.5px] text-ghost">{e.agent}{e.node ? ` · ${e.node}` : ""}</span>
                </a>
              ))}
            </div>
          )}
        </DrillModal>
      )}
      {openGuardrail && (
        <DrillModal
          title={`${openGuardrail.id} · ${openGuardrail.area}`}
          subtitle={openGuardrail.guardrail}
          onClose={() => setOpen(null)}
          actions={
            <span className="flex items-center gap-2">
              <span className={`text-[9.5px] font-medium tracking-[0.04em] uppercase ${openGuardrail.priority === "Critical" ? "text-err" : "text-warn"}`}>{openGuardrail.priority}</span>
              <Status tone={openGuardrail.responsibility === "platform" ? "ok" : openGuardrail.responsibility === "shared" ? "warn" : "neutral"}>{RESP_LABEL[openGuardrail.responsibility]}</Status>
            </span>
          }
        >
          <div className="grid gap-px bg-line md:grid-cols-2">
            <Cell k="Domain" v={openGuardrail.domain} />
            <Cell k="Risk addressed" v={openGuardrail.risk} />
            <Cell k="Accountable owner" v={openGuardrail.owner} />
            <Cell k="Evidence" v={openGuardrail.evidence} />
            <Cell k="Release gate" v={openGuardrail.gate} />
            {openGuardrail.implementedBy.length > 0 && (
              <Cell
                k="Implemented by"
                v={
                  <span className="flex flex-wrap gap-1.5">
                    {openGuardrail.implementedBy.map((id) => (
                      <button key={id} type="button" onClick={() => { setView("register"); setStd(""); setFolded(new Set()); setOpen(id); }} className="focusable rounded-sm border border-line px-1.5 py-0.5 font-mono text-[10.5px] text-fg hover:bg-raise/50">
                        {id} <span className="font-sans text-faint">{CONTROLS.find((c) => c.id === id)?.title ?? ""}</span>
                      </button>
                    ))}
                  </span>
                }
              />
            )}
            {openGuardrail.sources.length > 0 && (
              <Cell k="Source" v={<span className="flex flex-col gap-0.5">{openGuardrail.sources.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer" className="focusable truncate underline">{u}</a>)}</span>} />
            )}
          </div>
        </DrillModal>
      )}

      {/* ── residual risk ── */}
      <section className="flex flex-col gap-1.5 rounded-lg border border-warn/40 bg-surface px-4 py-3 elev-1">
        <span className="text-[13px] font-semibold tracking-[-0.005em]">{RESIDUAL_RISK.title}</span>
        <p className="max-w-[100ch] text-[11.5px] leading-[1.6] text-faint" title={RESIDUAL_RISK.body}>Compensated by the decision record and sampled review of automated decisions.</p>
      </section>

      {/* ── evidence ── */}
      {(!bare || noRecord) && <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="text-[13px] font-semibold tracking-[-0.005em]">Latest control firings</span>
          <span className="text-[11.5px] text-faint">{noRecord ? "not read" : data ? "click through to the run" : "reading the record…"}</span>
        </div>
        {noRecord && <p className="px-4 py-3 text-[11.5px] text-faint">Not read.</p>}
        {!noRecord && data?.recent.length === 0 && <p className="px-4 py-3 text-[11.5px] text-faint">No control has fired on this deployment yet.</p>}
        {(data?.recent ?? []).slice(0, 10).map((e, i) => (
          <a key={`${e.run}-${i}`} href={`/runs?id=${encodeURIComponent(e.run)}`} className="focusable flex items-baseline gap-3 border-b border-line px-4 py-2 last:border-0 hover:bg-raise/40">
            <Status tone={e.control === "taint" ? "warn" : e.control === "gate" ? "run" : "err"}>{e.control}</Status>
            <span className="flex min-w-0 grow flex-col">
              <span className="truncate text-[11.5px] text-fg">{e.title}</span>
              <span className="truncate text-[10.5px] text-faint">{e.detail}</span>
            </span>
            <span className="shrink-0 text-[10.5px] text-ghost">{e.agent}{e.node ? ` · ${e.node}` : ""}</span>
          </a>
        ))}
      </section>}
    </div>
  );
}

function Cell({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 bg-surface px-4 py-2.5">
      <span className="text-[10.5px] font-medium tracking-[0.04em] text-ghost uppercase">{k}</span>
      <span className="text-[11.5px] leading-[1.6] text-faint">{v}</span>
    </div>
  );
}
