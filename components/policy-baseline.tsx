"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Tag } from "./ui";
import { Section } from "./section";
import { BASELINE, BASELINE_AREAS, CHANGES_LABEL, KIND_LABEL, KIND_MEANS, controlsOf, liveSettings, referencesOf, type BaselineKind, type BaselinePolicy } from "@/lib/baseline-policies";
import { enforcementOf, useControls, type ControlsRead } from "@/lib/controls-status";
import { AnswerFailure } from "./pending";

/**
 * The baseline policy set (lib/baseline-policies.ts) on the Policy tab: what
 * the platform does before anyone has changed a setting, grouped by what it
 * protects. A row opens to the values it ships with, how they change, the
 * catalogue controls that carry it and the standards those controls cite.
 *
 * It is the catalogue's own words for the platform's defaults. Two answers
 * say what holds on this deployment: `GET /api/controls`, whether each
 * carrying control is enforced now, and `GET /api/policy/targets`, the rules
 * now of the rows marked `live` (rate limits, breakers, the guardian), whose
 * values are then the platform's and never the catalogue's. Until an answer
 * comes, the section says what it could not read.
 */

const KIND_TONE: Record<BaselineKind, "ok" | "neutral" | "warn"> = { fixed: "ok", default: "neutral", off: "warn" };
const KINDS: BaselineKind[] = ["fixed", "default", "off"];

/** The policy page's read of `GET /api/policy/targets`: each target's rules now; null while it is not read, with the reason when it failed. */
export type RulesNow = { kind: string; current: Record<string, unknown> | null }[] | null;

export function PolicyBaseline({ rules = null, rulesError = "" }: { rules?: RulesNow; rulesError?: string }) {
  /** Whether this deployment enforces each carrying control now: the platform's answer, or nothing. */
  const status = useControls();
  const [open, setOpen] = useState<string | null>(null);
  const [std, setStd] = useState("");
  const [kind, setKind] = useState<BaselineKind | "">("");

  const refs = useMemo(() => new Map(BASELINE.map((p) => [p.id, referencesOf(p)])), []);
  const standards = useMemo(() => {
    const count = new Map<string, number>();
    for (const p of BASELINE) for (const s of new Set((refs.get(p.id) ?? []).map((r) => r.std))) count.set(s, (count.get(s) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]);
  }, [refs]);
  const shown = BASELINE.filter((p) => (!std || (refs.get(p.id) ?? []).some((r) => r.std === std)) && (!kind || p.kind === kind));
  const chip = (on: boolean) =>
    `focusable flex cursor-pointer items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11.5px] font-medium ${on ? "border-fg bg-fg text-canvas" : "border-line-strong bg-raise text-fg hover:bg-field"}`;

  return (
    <Section
      id="baseline"
      title="Baseline policies"
      hue="controls"
      meta={`${BASELINE.length} in the catalogue · ${BASELINE.filter((p) => p.kind === "fixed").length} with no setting · ${BASELINE.filter((p) => p.kind === "default").length} with a default · ${BASELINE.filter((p) => p.kind === "off").length} off until set`}
    >
      {status && status.state !== "ok" && <AnswerFailure className="max-w-[96ch]" answer={status} what="Whether each control is enforced could not be read" />}
      {rulesError && !rules && (
        <p className="max-w-[96ch] rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-[12px] leading-[1.55] text-warn">
          The rules now could not be read: {rulesError}
        </p>
      )}
      <p className="max-w-[96ch] text-[12.5px] leading-[1.6] text-dim">
        The policy set a deployment starts with, and the{" "}
        <Link href="/guardrails" className="focusable font-medium text-fg underline underline-offset-2">
          catalogue controls
        </Link>{" "}
        carrying it.
      </p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-faint">Standard</span>
          <button type="button" aria-pressed={!std} onClick={() => setStd("")} className={chip(!std)}>
            All
          </button>
          {standards.map(([s, n]) => (
            <button key={s} type="button" aria-pressed={std === s} onClick={() => setStd(std === s ? "" : s)} className={chip(std === s)}>
              {s}
              <span className={`tnum text-[10.5px] ${std === s ? "opacity-70" : "text-faint"}`}>{n}</span>
            </button>
          ))}
        </span>
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-faint">Holds as</span>
          {KINDS.map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} title={KIND_MEANS[k]} onClick={() => setKind(kind === k ? "" : k)} className={chip(kind === k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </span>
      </div>

      <div className="af-list af-list-tall flex flex-col gap-4">
        {BASELINE_AREAS.map(({ area, purpose }) => {
          const rows = shown.filter((p) => p.area === area);
          if (!rows.length) return null;
          return (
            <div key={area} className="flex flex-col overflow-hidden rounded-md border border-line">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line bg-raise/40 px-4 py-2">
                <span className="text-[12.5px] font-semibold text-fg">{area}</span>
                <span className="text-[11.5px] text-faint">{purpose}</span>
              </div>
              {rows.map((p) => (
                <Row key={p.id} p={p} status={status} rules={rules} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} />
              ))}
            </div>
          );
        })}
        {shown.length === 0 && <p className="text-[12.5px] text-faint">No baseline policy matches these filters.</p>}
      </div>
    </Section>
  );
}

function Row({ p, status, rules, open, onToggle }: { p: BaselinePolicy; status: ControlsRead | null; rules: RulesNow; open: boolean; onToggle: () => void }) {
  const refs = referencesOf(p);
  // A live row's values are the platform's rules now; the catalogue's stand for its defaults only while that answer is not read.
  const live = p.live && rules ? liveSettings(p.live, rules.find((t) => t.kind === p.live)?.current) : null;
  const settings = live ?? p.settings;
  const stds = [...new Set(refs.map((r) => r.std))];
  const carriers = controlsOf(p);
  const enforced = status?.state === "ok" ? carriers.filter((c) => status.byId.get(c.id)?.state === "enforced").length : null;
  return (
    <div className="border-b border-line last:border-b-0" data-baseline={p.id}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="focusable flex w-full cursor-pointer items-start gap-3 px-4 py-3 text-left hover:bg-raise/40">
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`mt-1 shrink-0 text-faint transition-transform ${open ? "" : "-rotate-90"}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
        <span className="w-[52px] shrink-0 pt-px font-mono text-[11px] text-faint">{p.id}</span>
        <span className="flex min-w-0 grow flex-col gap-1">
          <span className="text-[13px] font-medium text-fg">{p.name}</span>
          <span className="max-w-[88ch] text-[12px] leading-[1.55] text-dim">{p.requires}</span>
        </span>
        <span className="hidden w-[250px] shrink-0 flex-wrap justify-end gap-1 pt-px lg:flex">
          {stds.map((s) => (
            <span key={s} className="rounded-sm border border-line px-1.5 py-px text-[10px] whitespace-nowrap text-dim">
              {s}
            </span>
          ))}
        </span>
        <span className="flex w-[112px] shrink-0 flex-col items-end gap-1 pt-px text-right">
          <Tag tone={KIND_TONE[p.kind]}>{KIND_LABEL[p.kind]}</Tag>
          {enforced !== null && (
            <span className="text-[10.5px] text-faint" title="Of the controls that carry it, how many this deployment enforces now (GET /api/controls).">
              {enforced} of {carriers.length} enforced
            </span>
          )}
        </span>
      </button>
      {open && (
        <div className="grid gap-x-8 gap-y-4 border-t border-line bg-raise/25 px-4 py-3.5 pl-[84px] xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-semibold text-dim">
              {live ? "The rules now" : p.live ? "The platform's defaults (rules now not read)" : "What it ships with"}
            </span>
            <dl className="flex flex-col">
              {settings.map((s) => (
                <div key={s.name} className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-x-4 border-b border-line py-1.5 last:border-b-0">
                  <dt className="text-[12px] leading-[1.5] text-dim">{s.name}</dt>
                  <dd className="text-[12px] leading-[1.5] font-medium text-fg">{s.value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-[11.5px] leading-[1.55] text-faint">
              <span className="font-medium text-dim">How it changes:</span> {CHANGES_LABEL[p.changes]}
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-dim">Carried by</span>
              <span className="flex flex-col gap-1">
                {carriers.map((c) => {
                  const enf = enforcementOf(status, c.id);
                  return (
                    <span key={c.id} className="flex flex-wrap items-baseline gap-2 text-[12px]">
                      <span className="font-mono text-[11px] text-faint">{c.id}</span>
                      <span className="text-fg">{c.title}</span>
                      {enf && (
                        <span className="inline-flex">
                          <Tag tone={enf.tone}>{enf.label}</Tag>
                        </span>
                      )}
                    </span>
                  );
                })}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-dim">Standards those controls cite</span>
              <span className="flex flex-col gap-1">
                {refs.map((r) => (
                  <span key={`${r.std}-${r.ref}`} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
                    <span className="w-[112px] shrink-0 text-dim">{r.std}</span>
                    <span className="font-mono text-[11px] text-faint">{r.ref}</span>
                    <span className="text-fg">{r.name}</span>
                  </span>
                ))}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
