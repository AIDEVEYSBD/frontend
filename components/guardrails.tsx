"use client";

import { useEffect, useMemo, useState } from "react";
import { soon } from "@/lib/soon";
import { Mono, Status } from "./ui";
import { DrillModal } from "./drill";
import { Donut } from "./charts";
import { usePageFacts } from "./assistant";
import { CORE_PRINCIPLE, DOMAINS, EXECUTIVE_TAKEAWAY, GUARDRAILS, SCOPE } from "@/lib/data-guardrails";
import { CLIENT_RESPONSIBILITIES, CONTROLS, FAMILIES, RESIDUAL_RISK, STANDARDS, type Control } from "@/lib/guardrails";
import { GROUPINGS, GROUPING_BY_ID } from "@/lib/control-domains";

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
  runs: number;
  counts: Record<string, number>;
  byAgent: Record<string, Record<string, number>>;
  recent: { control: string; run: string; agent: string; node: string; title: string; detail: string; at: string }[];
  posture: { agents: number; tools: number; tainting: number; sinks: number; gatedWorkflows: number; byRisk: Record<string, number> };
}

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
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [std, setStd] = useState("");
  const [view, setView] = useState<"register" | "framework">("register");
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
    fetch("/api/guardrails").then((r) => r.json()).then((d) => !stop && setData(d)).catch(() => {});
    return () => { stop = true; };
  }, []);

  // Arriving from a firing elsewhere in the console: open that control and
  // bring it into view, so the link from the evidence lands on the statement.
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

  const shown = useMemo(() => (std ? CONTROLS.filter((c) => c.references.some((r) => r.std === std)) : CONTROLS), [std]);
  const fired = (c: Control) => (c.journal === "—" ? null : (data?.counts[c.journal] ?? 0));
  const totalFired = data ? Object.values(data.counts).reduce((a, b) => a + b, 0) : 0;
  // The register can be read in the platform's own families or in another
  // framework's domains; the controls are the same, only the shelves move.
  const DOMAIN_PALETTE = ["var(--t-c1)", "var(--t-c2)", "var(--t-c5)", "var(--t-c7)", "var(--t-c8)", "var(--t-c3)", "var(--t-c6)", "var(--t-c9)", "var(--t-c4)"];
  const grouping = groupBy === "family" ? null : GROUPING_BY_ID.get(groupBy) ?? null;
  const groups: { id: string; name: string; purpose: string; color: string; member: (c: Control) => boolean }[] = grouping
    ? grouping.domains.map((d, i) => ({ id: d.id, name: d.name, purpose: d.note ?? "", color: DOMAIN_PALETTE[i % DOMAIN_PALETTE.length], member: (c) => grouping.of[c.id] === d.id }))
    : FAMILIES.map((f) => ({ id: f.id, name: f.name, purpose: f.purpose, color: FAMILY_COLOR[f.id], member: (c) => c.family === f.id }));
  const resp = (["platform", "shared"] as const).map((r) => ({
    label: RESP_LABEL[r], value: GUARDRAILS.filter((g) => g.responsibility === r).length, color: RESP_COLOR[r],
  }));
  const openControl = open ? CONTROLS.find((c) => c.id === open) ?? null : null;
  const openGuardrail = open && !openControl ? GUARDRAILS.find((g) => g.id === open) ?? null : null;
  const openFired = openControl ? fired(openControl) : null;
  const openFirings = openControl && data ? data.recent.filter((e) => e.control === openControl.journal).slice(0, 8) : [];
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
      {/* ── hero ── */}
      <header className="flex flex-col gap-3">
        <span className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] font-medium tracking-[0.08em] text-faint uppercase">Controls</span>
          <span className="flex items-center rounded-md border border-line bg-canvas p-0.5">
            {(["register", "framework"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => { setView(v); setOpen(null); }}
                className={`focusable rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium transition-colors ${view === v ? "bg-surface text-fg elev-1" : "text-faint hover:text-fg"}`}
              >
                {v === "register" ? "What the platform enforces" : "Data security guardrails"}
              </button>
            ))}
          </span>
        </span>
        {view === "register" ? (
          <>
            <h1 className="max-w-[24ch] text-[26px] leading-[1.15] font-semibold tracking-[-0.02em]">
              Controls applied across every workflow.
            </h1>
            <p className="max-w-[78ch] text-[13px] leading-[1.6] text-faint">
              Agent Factory applies {CONTROLS.length} platform controls to workflow execution. Each
              control documents its implementation, the evidence it produces and the recognized
              standards it references; control decisions are retained in the run record.
            </p>
          </>
        ) : (
          <>
            <h1 className="max-w-[26ch] text-[26px] leading-[1.15] font-semibold tracking-[-0.02em]">
              Understand the framework used to assess data security.
            </h1>
            <p className="max-w-[78ch] text-[13px] leading-[1.6] text-faint">{CORE_PRINCIPLE}</p>
          </>
        )}
      </header>

      {view === "register" && (
        <>
          {/* ── posture band ── */}
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line elev-1 sm:grid-cols-3">
              {[
                { label: "Controls", value: String(CONTROLS.length), sub: `${FAMILIES.length} families` },
                { label: "Standards cited", value: String(STANDARDS.length), sub: "sources, not examiners" },
                { label: "Workflows covered", value: data ? String(data.posture.agents) : "—", sub: "every one deployed" },
                { label: "Tools registered", value: data ? String(data.posture.tools) : "—", sub: data ? `${data.posture.sinks} act outside` : "" },
                { label: "Runs on record", value: data ? String(data.runs) : "—", sub: "the evidence base" },
                { label: "Control firings", value: data ? String(totalFired) : "—", sub: "refusals, marks, gates" },
              ].map((k) => (
                <div key={k.label} className="flex flex-col justify-center gap-0.5 bg-surface px-4 py-3">
                  <span className="tnum text-[22px] leading-none font-semibold tracking-[-0.02em]">{k.value}</span>
                  <span className="text-[11px] text-faint">{k.label}</span>
                  {k.sub && <span className="truncate text-[9.5px] text-ghost">{k.sub}</span>}
                </div>
              ))}
            </section>
            <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4 elev-1">
              <span className="text-[11px] font-medium tracking-[0.06em] text-faint uppercase">Firings by family</span>
              {FAMILIES.map((f) => {
                const n = CONTROLS.filter((c) => c.family === f.id).reduce((s, c) => s + (fired(c) ?? 0), 0);
                return (
                  <div key={f.id} className="flex flex-col gap-1">
                    <span className="flex items-baseline justify-between text-[11px]">
                      <span className="flex items-center gap-1.5 text-fg"><span className="size-1.5 rounded-[2px]" style={{ background: FAMILY_COLOR[f.id] }} />{f.name}</span>
                      <span className="tnum text-faint">{n}</span>
                    </span>
                    <span className="block h-1 w-full overflow-hidden rounded-[2px] bg-sunken">
                      <span className="block h-full rounded-[2px]" style={{ width: `${totalFired ? (n / totalFired) * 100 : 0}%`, background: FAMILY_COLOR[f.id] }} />
                    </span>
                  </div>
                );
              })}
            </section>
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
              {STANDARDS.map((s) => {
                const n = CONTROLS.filter((c) => c.references.some((r) => r.std === s.std)).length;
                const active = std === s.std;
                return (
                  <button key={s.std} type="button" onClick={() => setStd(active ? "" : s.std)} className={`focusable flex flex-col gap-1.5 px-4 py-3 text-left transition-colors ${active ? "bg-raise" : "bg-surface hover:bg-raise/50"}`}>
                    <span className="h-[3px] w-8 rounded-full" style={{ background: STD_TONE[s.std] }} />
                    <span className="flex items-baseline gap-2"><span className="text-[12px] font-semibold text-fg">{s.std}</span><span className="tnum text-[11px] text-faint">{n}</span></span>
                    <span className="text-[10.5px] leading-[1.45] text-faint">{s.title}</span>
                  </button>
                );
              })}
            </div>
            {std && <p className="border-t border-line px-4 py-2.5 text-[11.5px] leading-[1.55] text-faint">{STANDARDS.find((s) => s.std === std)?.note}</p>}
          </section>

          {/* ── group by: the platform's families, or a framework's domains ── */}
          <div className="flex flex-wrap items-center gap-2 px-1">
            <span className="text-[11px] font-medium tracking-[0.06em] text-faint uppercase">Group by</span>
            <span className="flex items-center rounded-md border border-line bg-canvas p-0.5">
              {[{ id: "family", short: "Platform family" }, ...GROUPINGS].map((g) => (
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
            {grouping && <span className="text-[11px] text-faint">{grouping.label}: each control shelved under the domain whose intent it serves.</span>}
          </div>

          {/* ── the register, as a card grid per group ── */}
          {groups.map((f) => {
            const rows = shown.filter(f.member);
            if (!rows.length) return null;
            const isFolded = folded.has(f.id);
            const firedHere = rows.reduce((a, c) => a + (fired(c) ?? 0), 0);
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
                    {rows.length} control{rows.length === 1 ? "" : "s"}{firedHere ? ` · ${firedHere} fired` : ""}{isFolded ? " · show" : ""}
                  </span>
                </button>
                {!isFolded && (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {rows.map((c) => {
                    const n = fired(c);
                    const isOpen = open === c.id;
                    return (
                      <article key={c.id} id={`control-${c.id}`} className={`flex flex-col rounded-lg border bg-surface transition-[border-color,box-shadow] elev-1 ${isOpen ? "border-line-strong" : "border-line hover:border-line-strong"}`}>
                        <button type="button" onClick={() => setOpen(c.id)} aria-haspopup="dialog" className="focusable flex grow flex-col gap-2 p-4 text-left">
                          <span className="flex items-center gap-2">
                            <Mono className="text-[10.5px] text-faint">{c.id}</Mono>
                            <span className="grow" />
                            {n === null ? (
                              <span className="text-[10px] text-ghost">outside the run</span>
                            ) : (
                              <span className={`tnum rounded-sm px-1.5 py-px text-[10px] ${n > 0 ? "bg-raise text-fg" : "text-ghost"}`}>{n} fired</span>
                            )}
                          </span>
                          <span className="text-[13px] font-semibold tracking-[-0.005em] text-fg">{c.title}</span>
                          <span className="line-clamp-3 text-[11.5px] leading-[1.55] text-faint">{c.statement}</span>
                          <span className="flex flex-wrap gap-1 pt-1">
                            {c.references.map((r) => <Chip key={`${r.std}${r.ref}`} std={r.std} ref_={r.ref} name={r.name} />)}
                          </span>
                          <span className="text-[9.5px] text-ghost">
                            {GROUPINGS.map((g) => `${g.short} ${g.domains.find((d) => d.id === g.of[c.id])?.id ?? "—"}`).join(" · ")}
                          </span>
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
              <span className="max-w-[92ch] text-[11.5px] leading-[1.5] text-faint">Controls that cannot be implemented from inside the platform, stated so they are assigned rather than assumed.</span>
            </div>
            <div className="grid gap-px bg-line md:grid-cols-2">
              {CLIENT_RESPONSIBILITIES.map((r) => (
                <div key={r.title} className="flex flex-col gap-1 bg-surface px-4 py-3">
                  <span className="flex flex-wrap items-baseline gap-2">
                    <span className="text-[12.5px] font-medium text-fg">{r.title}</span>
                    {r.references.map((x) => <Chip key={`${x.std}${x.ref}`} std={x.std} ref_={x.ref} name={x.name} />)}
                  </span>
                  <span className="text-[11.5px] leading-[1.55] text-faint">{r.body}</span>
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
              <Donut data={resp} size={110} />
              <span className="text-[11px] leading-[1.5] text-faint">
                Every guardrail listed is implemented by a named control in the register. Platform means the control covers it in full; shared means the platform does its part and the deployment completes it.
              </span>
            </section>
            <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line elev-1 sm:grid-cols-3">
              {[
                { label: "Guardrails", value: String(GUARDRAILS.length), sub: `${DOMAINS.length} domains` },
                { label: "Critical", value: String(GUARDRAILS.filter((g) => g.priority === "Critical").length), sub: "must hold at release" },
                { label: "Release gates", value: String(GUARDRAILS.filter((g) => g.gate).length), sub: "one per guardrail" },
                { label: "Platform enforces", value: String(resp[0].value), sub: "a control implements it" },
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
            <span className="mt-1 block text-[11px] text-faint">{SCOPE}</span>
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
                  <span className="flex w-44 items-center gap-2">
                    <span className="flex h-1.5 grow overflow-hidden rounded-full bg-sunken">
                      <span className="h-full" style={{ width: `${(p / rows.length) * 100}%`, background: RESP_COLOR.platform }} />
                      <span className="h-full" style={{ width: `${(sh / rows.length) * 100}%`, background: RESP_COLOR.shared }} />
                    </span>
                    <span className="tnum shrink-0 text-[10px] text-faint">{p + sh}/{rows.length}</span>
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

      {/* ── the open control, as a dialog rather than a card that grows ── */}
      {openControl && (
        <DrillModal
          title={`${openControl.id} · ${openControl.title}`}
          subtitle={openControl.statement}
          onClose={() => setOpen(null)}
          actions={
            openFired === null ? (
              <span className="text-[10.5px] text-ghost">outside the run</span>
            ) : (
              <span className={`tnum rounded-sm px-1.5 py-px text-[11px] ${openFired > 0 ? "bg-raise text-fg" : "text-ghost"}`}>{openFired} fired</span>
            )
          }
        >
          <div className="flex flex-wrap gap-1 border-b border-line px-4 py-3">
            {openControl.references.map((r) => <Chip key={`${r.std}${r.ref}`} std={r.std} ref_={r.ref} name={r.name} />)}
          </div>
          <div className="grid gap-px bg-line md:grid-cols-2">
            <Cell k="Implementation" v={openControl.implementation} />
            <Cell k="Evidence" v={openControl.evidence} />
            {openControl.order !== null && <Cell k="Evaluated" v={`Position ${openControl.order} in the policy engine, on every tool call.`} />}
            {openControl.journal !== "—" && <Cell k="Journalled as" v={<Mono className="text-[11px]">{openControl.journal}</Mono>} />}
            <Cell k="Platform family" v={FAMILIES.find((f) => f.id === openControl.family)?.name ?? openControl.family} />
            <Cell k="Framework domains" v={GROUPINGS.map((g) => `${g.short}: ${g.domains.find((d) => d.id === g.of[openControl.id])?.name ?? "—"}`).join(" · ")} />
            <Cell k="Derives from" v={openControl.references.map((r) => `${r.std} ${r.ref}: ${r.name}`).join(" · ")} />
            {data && openFired !== null && openFired > 0 && (
              <Cell k="Fired in" v={Object.entries(data.byAgent).filter(([, m]) => m[openControl.journal]).map(([a, m]) => `${a} (${m[openControl.journal]})`).join(", ")} />
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
        <p className="max-w-[100ch] text-[11.5px] leading-[1.6] text-faint">{RESIDUAL_RISK.body}</p>
      </section>

      {/* ── evidence ── */}
      <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
        <div className="flex items-center gap-2 border-b border-line px-4 py-3">
          <span className="text-[13px] font-semibold tracking-[-0.005em]">Latest control firings</span>
          <span className="text-[11.5px] text-faint">{data ? "from the run journals · click through to the run" : "reading the record…"}</span>
        </div>
        {data?.recent.length === 0 && <p className="px-4 py-3 text-[11.5px] text-faint">No control has fired on this deployment yet.</p>}
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
      </section>
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
