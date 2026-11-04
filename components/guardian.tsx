"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Meter, Status, Tag } from "./ui";
import { Checkbox, Field, Input, Switch, Textarea } from "./forms";
import { Pick } from "./select";
import { ChipEditor } from "./gate-form";
import { OpenChanges, ProposalNote } from "./policy";
import { hueFor } from "@/lib/hue";
import { soon } from "@/lib/soon";
import { useModels } from "@/lib/use-models";
import { useSession } from "@/lib/use-session";
import { listAgents } from "@/lib/api/l2";
import { DoorError, auditLine } from "@/lib/api/l5";
import { getGuardian, listGuardianActions, type GuardianAction, type GuardianView } from "@/lib/api/l7";
import { proposePolicyChange, type PolicyChange } from "@/lib/api/l9";
import { effectiveAt, effectiveProblem, proposedField, proposedLine } from "@/lib/policy";
import { cadenceText, capText, coverageText, formOf, formProblems, mayOf, mayText, outcomeText, patchOf, refusedField, verdictText, type GuardianField, type GuardianForm } from "@/lib/guardian";

/**
 * The guardian (phase L7): a supervisory model the backend runs over each
 * covered run's trajectory as it progresses, against the run's goal and a
 * rubric a person writes. Within the limits set here it may hold a run at
 * its next gate, block (kill) it, or (phase L8) redirect it: its reason is
 * handed to the run as guidance, signed `guardian`, taken at its next model
 * call; outside them (an action it may not take, the hourly cap, a
 * confidence under the floor) it only raises attention, and a redirect it
 * could not make is offered to a person as the steer it would have sent. Every act is journalled on the run as a note signed
 * `guardian`, which the run's transcript shows as an operator's action.
 *
 * The limits are a person's, and since L9 a reviewed person's: `GET
 * /api/guardian` reads them, and the form proposes only what changed through
 * the policy door (`POST /api/policy/changes`, target `guardian`); someone
 * other than the proposer approves it on the Policy page, and `PUT
 * /api/guardian` answers 409 naming that door. Every control needs the
 * configure permission, so a viewer reads all of it and changes none of it.
 * Its stats are the backend instance's since it started; its actions (`GET
 * /api/guardian/actions`) come from the record.
 */

function ago(iso: string): string {
  const t = Date.parse(iso);
  if (!iso || Number.isNaN(t)) return iso || "never";
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

type Filter = "all" | "acted" | "attention";

export function Guardian() {
  const { can, loaded } = useSession();
  const editable = !loaded || can("configure");
  const { models, defaultModel } = useModels();
  const [view, setView] = useState<GuardianView | null>(null);
  const [form, setForm] = useState<GuardianForm | null>(null);
  const [dirty, setDirty] = useState(false);
  const [actions, setActions] = useState<GuardianAction[] | null>(null);
  const [known, setKnown] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<PolicyChange | null>(null);
  const [saveError, setSaveError] = useState("");
  const [reason, setReason] = useState("");
  const [effective, setEffective] = useState("");
  /** Moved by a proposal, so the list of what waits on review is read again. */
  const [proposals, setProposals] = useState(0);
  /** The limit the door refused, in its own words (`400 {error, field}`), marked on the form until it is edited. */
  const [refused, setRefused] = useState<{ field: GuardianField; error: string } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  /** Read by the poll: a form being edited is not overwritten by the next read. */
  const dirtyRef = useRef(false);

  const load = useCallback(() => {
    getGuardian()
      .then((v) => {
        setView(v);
        setError("");
        // A form being edited is left alone; the next save re-reads it.
        setForm((f) => (f && dirtyRef.current ? f : formOf(v)));
      })
      .catch((e) => setError((e as Error).message));
    listGuardianActions({ limit: 200 })
      .then((r) => setActions(r.actions))
      .catch((e) => setError((e as Error).message));
  }, []);
  useEffect(() => {
    const cancel = soon(load);
    const id = setInterval(load, 5000);
    listAgents()
      .then((rows) => setKnown(rows.map((a) => a.id)))
      .catch(() => setKnown([]));
    return () => {
      cancel();
      clearInterval(id);
    };
  }, [load]);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const edit = (patch: Partial<GuardianForm>) => {
    setForm((f) => (f ? { ...f, ...patch } : f));
    setDirty(true);
    setSaved(null);
    setSaveError("");
    setRefused(null);
  };
  const problems = form ? formProblems(form) : {};
  /** A field's problem: the form's own first, else the door's refusal of it. */
  const problemOf = (field: GuardianField): string | undefined => (problems as Partial<Record<string, string>>)[field] ?? (refused?.field === field ? refused.error : undefined);
  const patch = view && form ? patchOf(view, form) : {};
  const changed = Object.keys(patch);

  const blocked = !changed.length || Object.keys(problems).length > 0 || !reason.trim() || Boolean(effectiveProblem(effective));

  /** The limits do not move here: they go to review, and read as they were until someone else approves. */
  const propose = async () => {
    if (!view || !form || blocked) return;
    setSaving(true);
    setSaveError("");
    try {
      const c = await proposePolicyChange({ target: { kind: "guardian" }, proposed: { ...patch }, effective_at: effectiveAt(effective), reason: reason.trim() });
      setForm(formOf(view));
      setDirty(false);
      setReason("");
      setEffective("");
      setSaved(c);
      setProposals((n) => n + 1);
    } catch (e) {
      // A 400 names the limit it refused: mark it on the form, in the door's words.
      const field = e instanceof DoorError && e.status === 400 ? refusedField(proposedField(e) ?? e.field) : null;
      if (field && field !== "body") {
        setRefused({ field, error: (e as Error).message });
        setSaveError(`Not proposed: ${field.replace(/_/g, " ")} is marked above.`);
      } else setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const modelOptions = [{ value: "", label: `Deployment default${defaultModel ? ` (${defaultModel})` : ""}` }, ...models.map((m) => ({ value: m.id, label: m.label }))];
  // A model set before it left the offered list still shows as set.
  if (form?.model && !modelOptions.some((o) => o.value === form.model)) modelOptions.push({ value: form.model, label: form.model });

  const shown = (actions ?? []).filter((a) => filter === "all" || a.outcome === filter);
  const s = view?.stats;

  return (
    <div className="mx-auto w-full max-w-[1520px] px-5 py-7" data-hue="red">
      <header className="flex flex-wrap items-end gap-4">
        <div className="flex max-w-[86ch] flex-col gap-1.5">
          <span className="flex items-center gap-3">
            <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">Guardian</h1>
            {view && <Status tone={view.enabled ? "ok" : "neutral"}>{view.enabled ? "on" : "off"}</Status>}
          </span>
          <p className="text-[12.5px] leading-[1.6] text-dim">
            A supervisory model that reads each covered run&rsquo;s trajectory as it runs, against the run&rsquo;s goal and the rubric below. Within the limits set
            here it holds a run at its next gate, blocks it, or redirects it with its reason as guidance; outside them it only raises the verdict for a person.
            Every act is journalled on the run, signed guardian.
          </p>
        </div>
      </header>

      {error && <p className="mt-4 text-[12.5px] text-err">{error}</p>}

      <div className="mt-5 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        {/* ── the limits a person sets ── */}
        <section className="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
          <div data-hue={hueFor("approvals person")} className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/55 px-4 py-2.5">
            <span className="text-[12px] font-semibold">Limits</span>
            <span className="text-[11px] text-faint">
              {view ? (view.set_by ? `set by ${view.set_by} ${ago(view.set_at)}${auditLine(view.audit_id)}` : "never set: the defaults (off, no agents, may do nothing)") : "reading…"}
            </span>
          </div>
          {!form || !view ? (
            <p className="px-4 py-4 text-[12px] text-faint">Reading the guardian&rsquo;s limits…</p>
          ) : (
            <div className="flex flex-col gap-4 px-4 py-4">
              {!editable && <p className="text-[11.5px] text-warn">Proposing a change to the guardian&rsquo;s limits needs the configure permission; these are shown as set.</p>}
              {editable && <p className="text-[11px] text-faint">A change here goes to review: someone other than you approves it on the Policy page, and these read as they are until it applies.</p>}
              <OpenChanges target={{ kind: "guardian", id: "estate" }} tick={proposals} />
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                <Switch label={form.enabled ? "On: it judges the runs it covers" : "Off: it judges no run"} checked={form.enabled} onChange={(on) => edit({ enabled: on })} disabled={!editable} />
                {problemOf("enabled") && <span className="text-[11px] text-err">{problemOf("enabled")}</span>}
                <span className="text-[11.5px] text-faint">Watching {coverageText({ enabled: form.enabled, agents: form.allAgents ? "*" : form.agents })}.</span>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <span className="text-[12.5px] font-medium text-mist">Agents it watches</span>
                  <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    <Checkbox label="Every agent" checked={form.allAgents} onChange={(on) => edit({ allAgents: on })} disabled={!editable} />
                  </span>
                  {!form.allAgents && (
                    <>
                      <ChipEditor values={form.agents} onChange={(v) => edit({ agents: v })} disabled={!editable} placeholder="Agent ids, Enter after each" invalid={Boolean(problemOf("agents"))} />
                      {problemOf("agents") && <span className="text-[11px] text-err">{problemOf("agents")}</span>}
                      {editable && known.filter((k) => !form.agents.includes(k)).length > 0 && (
                        <span className="flex flex-wrap items-center gap-1">
                          <span className="text-[10.5px] text-ghost">add</span>
                          {known
                            .filter((k) => !form.agents.includes(k))
                            .slice(0, 12)
                            .map((k) => (
                              <Button key={k} size="sm" variant="solid" tone="neutral" permission="configure" onClick={() => edit({ agents: [...form.agents, k] })}>
                                {k}
                              </Button>
                            ))}
                        </span>
                      )}
                    </>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-[12.5px] font-medium text-mist">What it may do on its own</span>
                  <Checkbox label="Hold a run at its next gate" checked={form.hold} onChange={(on) => edit({ hold: on })} disabled={!editable} />
                  <Checkbox label="Block a run (kill it and what it set off)" checked={form.block} onChange={(on) => edit({ block: on })} disabled={!editable} />
                  <Checkbox label="Redirect a run (its reason becomes guidance at the next model call)" checked={form.redirect} onChange={(on) => edit({ redirect: on })} disabled={!editable} />
                  <span className="text-[11px] text-faint">It may {mayText(mayOf(form))}.</span>
                  {problemOf("may") && <span className="text-[11px] text-err">{problemOf("may")}</span>}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <Field label="Model" error={problemOf("model")} hint="what it judges with">
                  <Pick value={form.model} onChange={(v) => edit({ model: v })} options={modelOptions} disabled={!editable} />
                </Field>
                <Field label="Acts per hour, at most" error={problemOf("max_actions_per_hour")} hint="past it, verdicts are raised for a person">
                  <Input type="number" value={form.max_actions_per_hour} onChange={(v) => edit({ max_actions_per_hour: v })} disabled={!editable} />
                </Field>
                <Field label="Minimum confidence" error={problemOf("min_confidence")} hint="0 to 1; under it, only attention">
                  <Input type="number" value={form.min_confidence} onChange={(v) => edit({ min_confidence: v })} disabled={!editable} />
                </Field>
                <Field label="Judge every … new entries" error={problemOf("every_entries")} hint="or after the seconds below">
                  <Input type="number" value={form.every_entries} onChange={(v) => edit({ every_entries: v })} disabled={!editable} />
                </Field>
                <Field label="… or after seconds" error={problemOf("every_s")} hint="with at least one new entry">
                  <Input type="number" value={form.every_s} onChange={(v) => edit({ every_s: v })} disabled={!editable} />
                </Field>
              </div>

              <Field label="Rubric" error={problemOf("rubric")} hint="what it judges a trajectory against, besides the run's own goal">
                <Textarea rows={3} value={form.rubric} onChange={(v) => edit({ rubric: v })} disabled={!editable} placeholder="Triage only: never move money, never send case data outside the firm." />
              </Field>

              {changed.length > 0 && <ProposalNote reason={reason} onReason={setReason} effective={effective} onEffective={setEffective} disabled={!editable} />}

              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <Button variant="solid" tone="ink" size="sm" permission="configure" disabled={blocked} loading={saving} onClick={propose}>
                  {changed.length ? `Propose ${changed.length} change${changed.length === 1 ? "" : "s"}` : "No changes"}
                </Button>
                {dirty && (
                  <Button
                    variant="solid"
                    tone="err"
                    size="sm"
                    onClick={() => {
                      setForm(formOf(view));
                      setDirty(false);
                    }}
                  >
                    Discard
                  </Button>
                )}
                {changed.length > 0 && <span className="text-[11px] text-faint">{reason.trim() ? `Proposes only ${changed.join(", ")}; the rest keep their value.` : "A change needs a reason."}</span>}
                {saved && (
                  <Link href={`/policy?change=${encodeURIComponent(saved.id)}`} className="focusable rounded-sm text-[11.5px] text-ok hover:underline">
                    {proposedLine(saved)}
                  </Link>
                )}
                {saveError && <span className="text-[11.5px] text-err">{saveError}</span>}
              </div>
            </div>
          )}
        </section>

        {/* ── what it has done ── */}
        <section className="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
          <div data-hue={hueFor("activity")} className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/55 px-4 py-2.5">
            <span className="text-[12px] font-semibold">Since this backend started</span>
            <span className="text-[11px] text-faint">{s ? `watching ${s.watching} run${s.watching === 1 ? "" : "s"}` : ""}</span>
          </div>
          {view && s ? (
            <div className="flex flex-col">
              <div className="grid grid-cols-4 gap-px border-b border-line bg-line">
                {[
                  { k: "judged", v: s.evaluations },
                  { k: "ok", v: s.ok },
                  { k: "acted", v: s.acted, tone: s.acted ? "text-err" : "" },
                  { k: "raised", v: s.attention, tone: s.attention ? "text-warn" : "" },
                  { k: "unparseable", v: s.unparseable, tone: s.unparseable ? "text-warn" : "" },
                  { k: "model errors", v: s.errors, tone: s.errors ? "text-err" : "" },
                  { k: "repeated", v: s.repeated },
                  { k: "watching", v: s.watching },
                ].map((x) => (
                  <div key={x.k} className="flex flex-col gap-0.5 bg-surface px-3 py-2">
                    <span className={`tnum text-[15px] leading-none font-semibold ${x.tone ?? ""}`}>{x.v}</span>
                    <span className="text-[10px] text-faint">{x.k}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-1.5 px-4 py-3">
                <span className="text-[11px] text-dim">{capText(view)}</span>
                <Meter value={view.max_actions_per_hour ? view.actions_last_hour / view.max_actions_per_hour : view.actions_last_hour ? 1 : 0} tone={view.actions_last_hour >= view.max_actions_per_hour ? "err" : "warn"} />
                <span className="text-[11px] text-faint">Judges {cadenceText(view)}; it may {mayText(view.may)}.</span>
                <span className="text-[10.5px] text-ghost">
                  The counts are this backend instance&rsquo;s since it started; what it acted on or raised is on the record below. An unparseable answer is read as ok and
                  never acted on.
                </span>
              </div>
            </div>
          ) : (
            <p className="px-4 py-4 text-[12px] text-faint">Reading…</p>
          )}
        </section>
      </div>

      {/* ── what it did ── */}
      <section className="mt-4 flex flex-col overflow-hidden rounded-md border border-line bg-surface">
        <div data-hue={hueFor("guardrail")} className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/55 px-4 py-2.5">
          <span className="text-[12px] font-semibold">Verdicts it acted on or raised</span>
          <span className="text-[11px] text-faint">{actions ? `${actions.length} on record, newest first` : "reading…"}</span>
          <span className="grow" />
          <span role="radiogroup" aria-label="Show" className="inline-flex items-center gap-px rounded-md border border-line bg-raise p-px">
            {(["all", "acted", "attention"] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={filter === f}
                onClick={() => setFilter(f)}
                className={`focusable cursor-pointer rounded-sm px-2 py-0.5 text-[11px] transition-colors ${filter === f ? "bg-surface font-semibold text-fg shadow-[var(--shadow-1)]" : "font-medium text-faint hover:text-dim"}`}
              >
                {f === "all" ? "All" : f === "acted" ? "Acted" : "Raised for a person"}
              </button>
            ))}
          </span>
        </div>
        <div className="overflow-x-auto">
          <GuardianActionsTable actions={shown} />
          {actions && shown.length === 0 && (
            <p className="px-4 py-4 text-[12px] text-faint">
              {actions.length ? "None of this kind." : "Nothing yet: a verdict of ok leaves no row; an act, or a verdict it could not act on, lands here."}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

/** The guardian's verdicts as rows: when, the run (a link), the verdict and its confidence, what it did or why it only raised it, the reason, the model. Presentational, so tests render it from a captured list. */
export function GuardianActionsTable({ actions }: { actions: GuardianAction[] }) {
  return (
    <table className="w-full min-w-[1080px] border-collapse text-[11.5px]">
      <thead>
        <tr className="border-b border-line bg-raise/40 text-left text-[10.5px] text-faint">
          <th className="px-4 py-1.5 font-medium">When</th>
          <th className="px-3 py-1.5 font-medium">Run</th>
          <th className="px-3 py-1.5 font-medium">Verdict</th>
          <th className="px-3 py-1.5 font-medium">What it did</th>
          <th className="px-3 py-1.5 font-medium">Reason</th>
          <th className="px-4 py-1.5 font-medium">Model</th>
        </tr>
      </thead>
      <tbody>
        {actions.map((a) => (
          <tr key={a.id} className="border-b border-line align-top last:border-0">
            <td className="px-4 py-2 whitespace-nowrap text-dim" title={a.at}>
              {ago(a.at)}
            </td>
            <td className="px-3 py-2">
              <span className="flex flex-col gap-0.5">
                <span className="text-fg">{a.agent}</span>
                <Link href={`/runs?id=${encodeURIComponent(a.run)}`} className="focusable rounded-sm font-mono text-[10.5px] text-dim hover:underline">
                  {a.run}
                </Link>
                <span className="text-[10px] text-ghost">
                  {a.source || "console"} · read {a.entries} entr{a.entries === 1 ? "y" : "ies"}
                </span>
              </span>
            </td>
            <td className="px-3 py-2 whitespace-nowrap">
              <Tag tone={a.action === "block" ? "err" : a.action === "redirect" ? "run" : "warn"}>{verdictText(a)}</Tag>
            </td>
            <td className="max-w-[340px] px-3 py-2">
              <span className="flex flex-col gap-0.5">
                <Status tone={a.outcome === "acted" ? "err" : "warn"}>{a.outcome === "acted" ? "acted" : "attention only"}</Status>
                <span className="text-[11px] leading-[1.45] text-faint">{outcomeText(a)}</span>
              </span>
            </td>
            <td className="max-w-[420px] px-3 py-2 leading-[1.5] text-fg">{a.reason}</td>
            <td className="px-4 py-2 whitespace-nowrap">
              <span className="tnum font-mono text-[10.5px]">{a.model || "default"}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
