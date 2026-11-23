"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { WATCH_LABEL, type WatchEvent, type WatchKind } from "@/lib/guardrails-watch";
import { Chips, FilterBar } from "./filters";
import { Button, Mono, Status, Tag } from "./ui";
import { ControlRef, resolveControl } from "./control-ref";
import { CAT, Donut } from "./charts";
import { DrillModal } from "./drill";
import { LineageDrawer } from "./lineage";
import { Skeleton } from "./loaders";

/**
 * The injection and exfiltration watch.
 *
 * Every screened hit (a prompt or a response the screener matched), every
 * taint-to-sink refusal (untrusted content that reached a tool which acts
 * outside the box) and every egress refusal (a host the policy does not
 * allow), from the journals, with the excerpt the control saw. The figures
 * come from GET /api/guardrails; this only filters and draws them. A row
 * opens its facts; from there the lineage drawer walks the because chain
 * to show what the content came from and what it fed.
 */

const KIND_TONE: Record<WatchKind, "err" | "warn"> = { screened: "err", taint_sink: "warn", egress: "err" };

function ago(iso: string, now: number): string {
  if (!iso) return "unknown";
  const mins = Math.round((now - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function toggleIn(s: Set<string>, v: string): Set<string> {
  const n = new Set(s);
  if (n.has(v)) n.delete(v);
  else n.add(v);
  return n;
}

function controlLabel(key: string): string {
  const c = resolveControl(key);
  return c ? `${c.id} ${c.title}` : key;
}

export function GuardrailsWatch({ events }: { events: WatchEvent[] | null }) {
  const [now] = useState(() => Date.now());
  const [kinds, setKinds] = useState<Set<string>>(new Set());
  const [controls, setControls] = useState<Set<string>>(new Set());
  const [subjects, setSubjects] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<WatchEvent | null>(null);
  const [lineage, setLineage] = useState<{ run: string; entry: string } | null>(null);

  const all = useMemo(() => events ?? [], [events]);
  const shown = useMemo(
    () => all.filter((e) => (!kinds.size || kinds.has(e.kind)) && (!controls.size || controls.has(e.control)) && (!subjects.size || subjects.has(e.subject.id))),
    [all, kinds, controls, subjects],
  );
  const countBy = (pick: (e: WatchEvent) => string, from: WatchEvent[]) => {
    const m = new Map<string, number>();
    for (const e of from) m.set(pick(e), (m.get(pick(e)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const byControl = countBy((e) => e.control, all);
  const bySubject = countBy((e) => e.subject.id, all);
  const filterCount = kinds.size + controls.size + subjects.size;
  const clear = () => {
    setKinds(new Set());
    setControls(new Set());
    setSubjects(new Set());
  };

  const tiles: { id: WatchKind | "flagged" | "subjects"; label: string; value: number; sub: string; tone?: "err" | "warn" }[] = [
    { id: "screened", label: "Screened hits", value: all.filter((e) => e.kind === "screened").length, sub: "prompts and responses the screener matched", tone: "err" },
    { id: "flagged", label: "of which flagged", value: all.filter((e) => e.kind === "screened" && e.action === "flagged").length, sub: "recorded and let through under a flag policy" },
    { id: "taint_sink", label: "Taint to sink", value: all.filter((e) => e.kind === "taint_sink").length, sub: "untrusted content stopped at a tool that acts outside", tone: "warn" },
    { id: "egress", label: "Egress refused", value: all.filter((e) => e.kind === "egress").length, sub: "hosts outside the allowlist", tone: "err" },
    { id: "subjects", label: "Applications and agents", value: bySubject.length, sub: "with at least one event" },
  ];

  const donut = byControl.slice(0, 8).map(([label, value], i) => ({ label: controlLabel(label), value, color: CAT[i % CAT.length], key: label }));

  return (
    <>
      {/* ── the band ── */}
      <div className="grid grid-cols-2 overflow-hidden rounded-md border border-line bg-surface sm:grid-cols-5">
        {tiles.map((t) => {
          const active = (t.id === "screened" || t.id === "taint_sink" || t.id === "egress") && kinds.has(t.id);
          return (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => {
                if (t.id === "flagged") setKinds(new Set(["screened"]));
                else if (t.id === "subjects") clear();
                else setKinds((k) => (k.has(t.id) && k.size === 1 ? new Set() : new Set([t.id])));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  (e.currentTarget as HTMLElement).click();
                }
              }}
              aria-pressed={active}
              className={`focusable -mr-px -mb-px flex cursor-pointer flex-col gap-1 border-r border-b border-line px-3 py-2.5 text-left transition-colors ${active ? "bg-raise/80" : "hover:bg-raise/50"}`}
            >
              <span className="truncate text-[10.5px] text-faint">{t.label}</span>
              <span className="tnum text-[22px] leading-none font-semibold tracking-[-0.02em]" style={t.tone && t.value ? { color: `var(--color-${t.tone})` } : undefined}>
                {events ? t.value.toLocaleString("en-GB") : "…"}
              </span>
              <span className="truncate text-[10px] text-ghost">{t.sub}</span>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        {/* ── by control ── */}
        <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
          <div className="flex w-full items-start gap-3 border-b border-line bg-raise/55 px-4 py-2.5">
            <span className="text-[12.5px] font-semibold tracking-[-0.005em]">Events by control</span>
            <span className="text-[11px] leading-[1.55] text-faint">pick one to filter</span>
          </div>
          <div className="p-4">
            {!events && <Skeleton lines={4} />}
            {events && donut.length === 0 && <p className="text-[11.5px] text-faint">No screened hit, taint-to-sink refusal or egress refusal is on the record yet.</p>}
            {donut.length > 0 && (
              <Donut
                data={donut}
                size={110}
                onPick={(label) => {
                  const key = donut.find((d) => d.label === label)?.key;
                  if (key) setControls((c) => toggleIn(c, key));
                }}
              />
            )}
          </div>
        </section>

        {/* ── filters ── */}
        <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface px-4 py-3 elev-1">
          <FilterBar count={filterCount} onClear={clear}>
            <Chips
              label="Kind"
              items={(["screened", "taint_sink", "egress"] as WatchKind[]).map((k) => ({ value: k, label: WATCH_LABEL[k], count: events ? all.filter((e) => e.kind === k).length : undefined, active: kinds.has(k), tone: KIND_TONE[k] }))}
              onToggle={(v) => setKinds((s) => toggleIn(s, v))}
            />
            <Chips
              label="Control"
              items={byControl.slice(0, 10).map(([k, n]) => ({ value: k, label: resolveControl(k)?.id ?? k, count: n, active: controls.has(k) }))}
              onToggle={(v) => setControls((s) => toggleIn(s, v))}
            />
            <Chips
              label="Application or agent"
              items={bySubject.slice(0, 10).map(([k, n]) => ({ value: k, label: k || "(unnamed)", count: n, active: subjects.has(k) }))}
              onToggle={(v) => setSubjects((s) => toggleIn(s, v))}
            />
          </FilterBar>
        </section>
      </div>

      {/* ── the list ── */}
      <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
        <div className="flex w-full items-start gap-3 border-b border-line bg-raise/55 px-4 py-2.5">
          <span className="text-[12.5px] font-semibold tracking-[-0.005em]">Watch</span>
          <span className="max-w-[110ch] text-[11px] leading-[1.55] text-faint">
            {events ? `${shown.length.toLocaleString("en-GB")} of ${all.length.toLocaleString("en-GB")} events · newest first · excerpts are masked by credential shape, and a vault value the run was given is masked in its journal; a secret that looks like neither is not` : "reading the journals…"}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] border-collapse text-[11.5px]">
            <thead className="sticky top-0 z-10 bg-surface">
              <tr className="border-b border-line text-left text-[10.5px] text-faint">
                <th className="px-4 py-2 font-medium">Kind</th>
                <th className="px-3 py-2 font-medium">Control</th>
                <th className="px-3 py-2 font-medium">Application or agent</th>
                <th className="px-3 py-2 font-medium">Principal</th>
                <th className="px-3 py-2 font-medium">What the control saw</th>
                <th className="px-3 py-2 text-right font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id} onClick={() => setOpen(e)} className="cursor-pointer border-b border-line last:border-0 hover:bg-raise/40">
                  <td className="px-4 py-2 align-top">
                    <Status tone={e.action === "flagged" ? "warn" : KIND_TONE[e.kind]}>{WATCH_LABEL[e.kind]}</Status>
                    <span className="block text-[10px] text-ghost">{e.action}{e.tool ? ` · ${e.tool}` : ""}</span>
                  </td>
                  <td className="px-3 py-2 align-top">{resolveControl(e.control) ? <ControlRef control={e.control} /> : <Mono className="text-[10.5px]">{e.control}</Mono>}</td>
                  <td className="px-3 py-2 align-top">
                    <span className="flex flex-col">
                      <span className="text-[12px] font-medium text-fg">{e.subject.id || "(unnamed)"}</span>
                      <span className="text-[10.5px] text-faint">{e.subject.kind}{e.node ? ` · ${e.node}` : ""}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top text-dim">{e.principal || <span className="text-ghost">none</span>}</td>
                  <td className="px-3 py-2 align-top">
                    <span className="line-clamp-2 max-w-[48ch] font-mono text-[10.5px] leading-[1.5] text-mist">{e.excerpt || e.detail || e.title}</span>
                  </td>
                  <td className="tnum px-3 py-2 text-right align-top whitespace-nowrap text-faint">{ago(e.at, now)}</td>
                </tr>
              ))}
              {events && shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-[11.5px] text-faint">{all.length ? "Nothing matches these filters." : "Nothing on the watch yet."}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {open && (
        <DrillModal
          title={`${WATCH_LABEL[open.kind]} · ${open.subject.id || "(unnamed)"}`}
          subtitle={open.detail || open.title}
          onClose={() => setOpen(null)}
          actions={
            <span className="flex items-center gap-2">
              <Tag tone={open.action === "flagged" ? "warn" : "err"}>{open.action}</Tag>
              <Button size="sm" variant="solid" tone="ink" onClick={() => setLineage({ run: open.run, entry: open.entry })} disabled={!open.entry}>Lineage</Button>
              <Button size="sm" variant="quiet" href={`/runs?id=${encodeURIComponent(open.run)}`}>Open run</Button>
            </span>
          }
        >
          <div className="grid gap-px bg-line md:grid-cols-2">
            <Fact k="Control" v={resolveControl(open.control) ? <ControlRef control={open.control} size="md" /> : <Mono className="text-[11px]">{open.control}</Mono>} />
            <Fact
              k={open.subject.kind === "application" ? "Application" : "Agent"}
              v={
                open.subject.kind === "application" ? (
                  <Link href={`/applications/${encodeURIComponent(open.subject.id)}`} className="focusable underline">{open.subject.id}</Link>
                ) : (
                  open.subject.id || "(unnamed)"
                )
              }
            />
            <Fact k="Principal" v={open.principal || "none presented"} />
            <Fact k="Tool" v={open.tool || "none"} />
            <Fact k="Run · entry" v={<Mono className="text-[11px]">{open.run} · {open.entry || "—"}</Mono>} />
            <Fact k="When" v={`${ago(open.at, now)} · ${open.at ? new Date(open.at).toLocaleString("en-GB") : "unknown"} · ${(open.t / 1000).toFixed(1)}s into the run`} />
          </div>
          <div className="flex flex-col gap-1 border-t border-line px-4 py-3">
            <span className="text-[10.5px] font-medium tracking-[0.04em] text-ghost uppercase">What the control saw · masked by credential shape</span>
            <pre className="max-h-64 overflow-auto rounded-sm border border-line bg-canvas px-3 py-2 font-mono text-[10.5px] leading-[1.55] whitespace-pre-wrap text-mist">{open.excerpt || open.detail || "(no excerpt recorded)"}</pre>
          </div>
          {open.because.length > 0 && (
            <p className="border-t border-line px-4 py-2 text-[10.5px] text-ghost">Derived from {open.because.join(", ")}; the lineage drawer walks the chain.</p>
          )}
        </DrillModal>
      )}

      {lineage && <LineageDrawer runId={lineage.run} entryId={lineage.entry} onClose={() => setLineage(null)} />}
    </>
  );
}

function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 bg-surface px-4 py-2.5">
      <span className="text-[10.5px] font-medium tracking-[0.04em] text-ghost uppercase">{k}</span>
      <span className="text-[11.5px] leading-[1.6] text-faint">{v}</span>
    </div>
  );
}
