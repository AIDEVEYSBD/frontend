"use client";
import { notBuiltDoorOf } from "@/lib/api/client";
import { NotConnectedNote } from "./pending";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Mono, Status, Tag } from "./ui";
import { Banner } from "./overlays";
import { Field, Input, Radio } from "./forms";
import { Pick } from "./select";
import { soon } from "@/lib/soon";
import { DoorError } from "@/lib/api/l5";
import type { VersionView } from "@/lib/api/l2";
import { CANARY_MODES, canaryRefusalOf, endCanary, getCanary, putCanary, type CanaryCondition, type CanaryMode, type CanaryRefusal, type CanaryView } from "@/lib/api/l8b";
import {
  EMPTY_CANARY,
  MODE_LABEL,
  MODE_MEANS,
  armLine,
  armRows,
  canaryBody,
  canaryConditionRows,
  canaryErrorText,
  canaryHeadline,
  canaryProblem,
  canaryRefusalText,
  outcomeLabel,
  pendingSkippedText,
  productionMoved,
  rateText,
  shareText,
  type CanaryForm,
} from "@/lib/canary";
import { itemLine, shortDigest, whenText } from "@/lib/lifecycle";
import { useDoorBuilt } from "@/lib/use-doors";

/**
 * Canary and shadow beside production (phase L8, second round), on the
 * lifecycle page.
 *
 * Start one: a saved version other than production's, that passed the
 * promotion gate (regression is read and shown, never required), with a
 * share and a mode, and an optional end. A canary takes that share of the
 * agent's queued and triggered starts; a shadow mirrors that share of
 * production runs on the same input in shadow mode, where nothing above
 * read executes and every such call is journalled as what it would have
 * called. The live report: for a shadow, the disagreement rate between each
 * production run and its mirror on the spec's `evals.compare` field, with
 * the disagreeing pairs side by side; for a canary, each arm's runs and
 * outcomes; what is still pending, and why pairs were skipped. End it, and
 * its queued shadow jobs are withdrawn and its candidate's queued retries go
 * back to production. The doors are the backend's (lib/api/l8b.ts), the
 * words lib/canary.ts's.
 */

const pctOf = (x: number | null) => (x === null ? "—" : `${Math.round(x * 1000) / 10}%`);
const runHref = (id: string) => `/runs?id=${encodeURIComponent(id)}`;

/** The gate's conditions as the canary read them: met, unmet and holding it, or unmet and only shown. Presentational. */
export function CanaryConditions({ conditions }: { conditions: CanaryCondition[] }) {
  if (!conditions.length) return null;
  return (
    <ul className="flex flex-col overflow-hidden rounded-md border border-line">
      {canaryConditionRows(conditions).map((c, i) => {
        const items = conditions[i]?.items ?? [];
        return (
          <li key={c.condition} className="flex flex-col gap-0.5 border-b border-line px-3 py-2 last:border-b-0">
            <span className="flex flex-wrap items-center gap-2">
              <Status tone={c.tone}>{c.label}</Status>
              <span className={`text-[11px] ${c.tone === "err" ? "text-err" : c.tone === "warn" ? "text-warn" : "text-faint"}`}>{c.says}</span>
              {!c.required && <Tag>not required</Tag>}
            </span>
            {c.detail && <span className="text-[11.5px] leading-[1.5] text-dim">{c.detail}</span>}
            {items.slice(0, 3).map((it, j) => (
              <Mono key={j} className="text-[10px] text-faint">
                {itemLine(it)}
              </Mono>
            ))}
          </li>
        );
      })}
    </ul>
  );
}

/** The gate's refusal of a candidate: why, and every condition with whether it holds the canary. Presentational. */
export function CanaryRefusalView({ refusal }: { refusal: CanaryRefusal }) {
  return (
    <div className="flex flex-col gap-2">
      <Banner tone="err" title={`The promotion gate holds version ${refusal.version ?? "?"} for ${refusal.environment}`}>
        {canaryRefusalText(refusal)}
        <span className="mt-0.5 block font-mono text-[10px] text-faint">gate decision {refusal.decision}</span>
      </Banner>
      <CanaryConditions conditions={refusal.conditions.length ? refusal.conditions : refusal.unmet.map((u) => ({ condition: u.condition, met: false, detail: u.detail, items: u.items, overridden: false, required: u.condition !== "regression" }))} />
    </div>
  );
}

/** One arm of a canary: its runs and its outcomes. */
function ArmsTable({ canary }: { canary: CanaryView }) {
  const rows = armRows(canary.arms);
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full border-collapse text-[11.5px]">
        <thead>
          <tr className="border-b border-line text-left text-[10.5px] text-faint">
            <th className="px-3 py-1.5 font-medium">Outcome{canary.field ? ` (${canary.field})` : ""}</th>
            <th className="px-3 py-1.5 text-right font-medium">
              Candidate v{canary.version ?? "?"} · {armLine(canary.arms.candidate)}
            </th>
            <th className="px-3 py-1.5 text-right font-medium">
              Production{canary.production ? ` v${canary.production.version ?? "?"}` : ""} · {armLine(canary.arms.production)}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="px-3 py-2 text-faint">
                No run of either arm has finished yet.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.outcome} className="border-b border-line last:border-b-0">
              <td className="px-3 py-1.5 font-mono text-fg">{r.label}</td>
              <td className="tnum px-3 py-1.5 text-right text-dim">
                {r.candidate} <span className="text-faint">({pctOf(r.candidateShare)})</span>
              </td>
              <td className="tnum px-3 py-1.5 text-right text-dim">
                {r.production} <span className="text-faint">({pctOf(r.productionShare)})</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A shadow's disagreeing pairs, production's outcome beside the candidate's, each with its run. */
function ExamplesTable({ canary }: { canary: CanaryView }) {
  if (!canary.examples.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold text-dim">Where they disagreed</span>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr className="border-b border-line text-left text-[10.5px] text-faint">
              <th className="px-3 py-1.5 font-medium">Production{canary.production ? ` v${canary.production.version ?? "?"}` : ""}</th>
              <th className="px-3 py-1.5 font-medium">Shadow v{canary.version ?? "?"}</th>
              <th className="px-3 py-1.5 font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {canary.examples.map((e) => (
              <tr key={`${e.production_run}:${e.shadow_run}`} className="border-b border-line align-top last:border-b-0">
                <td className="px-3 py-1.5">
                  <span className="block font-mono text-fg">{outcomeLabel(e.production)}</span>
                  <Link href={runHref(e.production_run)} className="focusable rounded-sm font-mono text-[10px] text-dim hover:underline">
                    {e.production_run}
                  </Link>
                </td>
                <td className="px-3 py-1.5">
                  <span className="block font-mono text-warn">{outcomeLabel(e.shadow)}</span>
                  <Link href={runHref(e.shadow_run)} className="focusable rounded-sm font-mono text-[10px] text-dim hover:underline">
                    {e.shadow_run}
                  </Link>
                </td>
                <td className="px-3 py-1.5 whitespace-nowrap text-faint">{whenText(e.at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The live report of a canary or a shadow. Presentational, so tests render it from a captured view. */
export function CanaryReport({ canary }: { canary: CanaryView }) {
  const moved = productionMoved(canary);
  const waiting = pendingSkippedText(canary);
  const ended = [...canary.cancelled_jobs.map((j) => `shadow job ${j.slice(0, 8)} withdrawn`), ...canary.released_jobs.map((j) => `job ${j.slice(0, 8)} given back to production`)];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone={canary.mode === "shadow" ? "queue" : "run"}>{MODE_LABEL[canary.mode]}</Tag>
        {canary.active ? <Status tone="run">standing</Status> : <Status tone="neutral">ended</Status>}
        <span className="text-[12px] font-medium text-fg">
          version {canary.version ?? "?"} · {shareText(canary.share)}
        </span>
        <Mono className="text-[10.5px] text-dim">{shortDigest(canary.digest)}</Mono>
        <span className="grow" />
        <Mono className="text-[10px] text-ghost">
          {canary.id}
          {canary.deployment ? ` · deployment ${canary.deployment}` : ""}
        </Mono>
      </div>
      <p className="text-[12px] leading-[1.55] text-dim">{canaryHeadline(canary)}</p>
      {moved && <p className="text-[11.5px] text-warn">{moved}</p>}

      {canary.mode === "shadow" ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="flex flex-col">
              <span className="text-[10px] text-faint">disagreement rate</span>
              <span className={`tnum text-[20px] leading-tight font-semibold ${canary.rate && canary.rate > 0 ? "text-warn" : "text-fg"}`}>{pctOf(canary.rate)}</span>
            </span>
            {[
              ["compared", canary.compared],
              ["disagree", canary.disagreements],
              ["pending", canary.pending],
              ["skipped", canary.skipped],
              ["shadow runs", canary.runs],
            ].map(([k, v]) => (
              <span key={String(k)} className="flex flex-col">
                <span className="text-[10px] text-faint">{k}</span>
                <span className="tnum text-[14px] font-semibold text-fg">{v}</span>
              </span>
            ))}
          </div>
          <p className="text-[11.5px] text-dim">{rateText(canary)}</p>
          <ExamplesTable canary={canary} />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-[11.5px] text-dim">{rateText(canary)}</p>
          <ArmsTable canary={canary} />
        </div>
      )}
      {canary.mode === "shadow" && <ArmsTable canary={canary} />}
      {waiting && <p className="text-[11.5px] text-faint">{waiting}.</p>}
      {ended.length > 0 && <p className="text-[11px] text-faint">Ending it: {ended.join("; ")}.</p>}
      {canary.conditions.length > 0 && (
        <details>
          <summary className="focusable cursor-pointer text-[11px] text-faint">The promotion gate as read when it was configured</summary>
          <div className="mt-2">
            <CanaryConditions conditions={canary.conditions} />
          </div>
        </details>
      )}
    </div>
  );
}

/** Saved versions a canary may run: newest first, one per digest, never what production runs. */
function candidateChoices(versions: readonly VersionView[], production: number | null): { value: string; label: string }[] {
  const seen = new Set<string>();
  const out: { value: string; label: string }[] = [];
  for (const v of [...versions].sort((a, b) => b.version - a.version)) {
    if (v.version === production || seen.has(v.digest)) continue;
    seen.add(v.digest);
    out.push({ value: String(v.version), label: `version ${v.version} · ${shortDigest(v.digest)}` });
  }
  return out;
}

/** The canary panel on an agent's lifecycle page. */
export function CanaryPanel({ agent, versions, production, retired, onChanged }: { agent: string; versions: VersionView[]; production: number | null; retired: boolean; onChanged: () => void }) {
  const [canary, setCanary] = useState<CanaryView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [readError, setReadError] = useState("");
  // Starting one is offered only while its address is built (GET /api/doors); unknown leaves the form, and a press hears the answer.
  const startBuilt = useDoorBuilt("PUT", "/api/agents/{agent}/canary");
  const choices = candidateChoices(versions, production);
  const [form, setForm] = useState<CanaryForm>(() => ({ ...EMPTY_CANARY, version: choices[0] ? Number(choices[0].value) : null }));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState<"start" | "end" | null>(null);
  const [refusal, setRefusal] = useState<CanaryRefusal | null>(null);
  const [error, setError] = useState("");
  const [confirmEnd, setConfirmEnd] = useState(false);

  const load = useCallback(async () => {
    try {
      setCanary(await getCanary(agent));
      setReadError("");
    } catch (e) {
      setReadError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, [agent]);

  useEffect(() => soon(load), [load]);
  // While one stands, its report is live: re-read it every ten seconds.
  useEffect(() => {
    if (!canary?.active) return;
    const id = setInterval(() => void load(), 10_000);
    return () => clearInterval(id);
  }, [canary?.active, load]);

  // The clock the form is judged against while it is filled in; the click judges it again against the time it is clicked.
  const [openedAt] = useState(() => Date.now());
  if (form.version === null && choices[0]) setForm((f) => ({ ...f, version: Number(choices[0].value) }));
  const problem = canaryProblem(form, { production, now: openedAt });

  const start = async () => {
    setTried(true);
    if (problem) return;
    const late = canaryProblem(form, { production, now: Date.now() });
    if (late) {
      setError(late);
      return;
    }
    setBusy("start");
    setRefusal(null);
    setError("");
    try {
      setCanary(await putCanary(agent, canaryBody(form)));
      setTried(false);
      onChanged();
    } catch (e) {
      const r = canaryRefusalOf(e);
      if (r) setRefusal(r);
      else setError(e instanceof DoorError ? canaryErrorText(e) : (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const end = async () => {
    // One click asks; the second, within three seconds, ends it.
    if (!confirmEnd) {
      setConfirmEnd(true);
      setTimeout(() => setConfirmEnd(false), 3000);
      return;
    }
    setBusy("end");
    setError("");
    try {
      setCanary(await endCanary(agent));
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
      setConfirmEnd(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {readError && (
        <Banner tone="err" title="Could not read the canary">
          {readError}
        </Banner>
      )}
      {!loaded && <p className="text-[12px] text-faint">Reading the canary…</p>}
      {loaded && !canary && !readError && <p className="text-[12px] text-faint">No canary or shadow has run beside production for {agent}.</p>}
      {canary && (
        <div className="flex flex-col gap-3 rounded-md border border-line bg-canvas/60 p-3">
          <CanaryReport canary={canary} />
          {canary.active && (
            <span className="flex items-center gap-2">
              <span className="text-[11px] text-faint">Ending it withdraws its queued shadow jobs and gives its candidate&rsquo;s queued retries back to production.</span>
              <span className="grow" />
              <Button size="sm" variant="solid" tone="neutral" onClick={() => void load()}>
                Refresh
              </Button>
              <Button size="sm" variant="solid" tone="err" permission="deploy" loading={busy === "end"} onClick={() => void end()}>
                {confirmEnd ? `Click again to end the ${canary.mode}` : `End the ${canary.mode}`}
              </Button>
            </span>
          )}
        </div>
      )}
      {error && (
        <Banner tone="err" title="The canary door refused">
          {error}
        </Banner>
      )}
      {refusal && <CanaryRefusalView refusal={refusal} />}

      {/* While the canary is not built (its read answers 501), no form offers to start one. */}
      {!retired && !notBuiltDoorOf(readError) && startBuilt === false && <NotConnectedNote door={{ method: "PUT", path: "/api/agents/{agent}/canary" }} />}
      {!retired && !notBuiltDoorOf(readError) && startBuilt !== false && (
        <div className="flex flex-col gap-2.5 rounded-md border border-line bg-canvas/60 p-3">
          <span className="text-[12.5px] font-semibold text-fg">{canary?.active ? "Replace it with another" : "Run a version beside production"}</span>
          <span className="text-[11.5px] leading-[1.5] text-dim">
            One canary per agent: starting one ends the one standing.
          </span>
          {production === null ? (
            <p className="text-[12px] text-faint">Nothing of {agent} is deployed to production yet: a canary runs beside production.</p>
          ) : !choices.length ? (
            <p className="text-[12px] text-faint">No saved version other than the one production runs. A canary needs a second version to run beside it.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Candidate">
                  <Pick value={form.version === null ? "" : String(form.version)} onChange={(v) => setForm((f) => ({ ...f, version: v ? Number(v) : null }))} options={choices} />
                </Field>
                <Field label="Share (%)" error={tried && problem.startsWith("the share") ? problem : undefined} hint={form.mode === "shadow" ? "of production runs, mirrored" : "of queued and triggered starts"}>
                  <Input value={form.share} onChange={(v) => setForm((f) => ({ ...f, share: v }))} mono />
                </Field>
                <Field label="Until (optional)" error={tried && problem.startsWith("the end") ? problem : undefined} hint="It ends itself then">
                  <Input type="datetime-local" value={form.until} onChange={(v) => setForm((f) => ({ ...f, until: v }))} />
                </Field>
                <Field label="Mode">
                  <Radio name={`af-canary-mode-${agent}`} value={form.mode} onChange={(v) => setForm((f) => ({ ...f, mode: v as CanaryMode }))} options={CANARY_MODES.map((m) => ({ value: m, label: MODE_LABEL[m] }))} />
                </Field>
              </div>
              <span className="text-[11px] leading-[1.5] text-faint">
                {MODE_LABEL[form.mode]}: {MODE_MEANS[form.mode]}.
              </span>
              {tried && problem && !problem.startsWith("the share") && !problem.startsWith("the end") && <span className="text-[11px] text-err">{problem}</span>}
              <span className="flex items-center gap-2">
                <span className="grow" />
                <Button size="sm" variant="solid" tone="ink" permission="deploy" loading={busy === "start"} onClick={() => void start()}>
                  {form.mode === "shadow" ? "Start the shadow" : "Start the canary"}
                </Button>
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
