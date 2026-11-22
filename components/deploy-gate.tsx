"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Mono, Status, Tag } from "./ui";
import { Banner } from "./overlays";
import { Field, Textarea } from "./forms";
import { useSession } from "@/lib/use-session";
import { DoorError } from "@/lib/api/l5";
import { deploy, gateRefusalOf, retiredRefusalOf, type Condition, type Deployed, type GateRefusal } from "@/lib/api/l8";
import {
  CONDITION_ASKS,
  EMPTY_OVERRIDE,
  canOverride,
  conditionLabel,
  findingHref,
  gateSummary,
  itemLine,
  overrideBody,
  overrideChoices,
  overrideLine,
  overrideOutcome,
  overrideProblem,
  retiredLine,
  shortDigest,
  whenText,
  type OverrideForm,
} from "@/lib/lifecycle";
import type { ConditionName } from "@/lib/api/l8";

/**
 * The promotion gate, as a person meets it (phase L8). A deploy to
 * production is held to five conditions read for exactly the digest being
 * deployed: an eval on the spec's own suite at or above its threshold, an
 * approving policy review by someone who did not author it, nothing open
 * for the agent, no regression against the deployed predecessor, and (L9)
 * every control its declared autonomy tier requires. A
 * refusal (409) names every unmet condition with its detail and the items
 * the gate read; this shows them, and every condition beside them. An
 * administrator may deploy past the gate with a reason, passing every unmet
 * condition or only the ones named; the override is recorded on the
 * deployment, audited and raised as attention. Anyone else is told who may.
 */

function ConditionRow({ c, agent }: { c: Pick<Condition, "condition" | "detail" | "items"> & { met?: boolean; overridden?: boolean }; agent: string }) {
  const asks = CONDITION_ASKS[c.condition as ConditionName];
  return (
    <li className="flex flex-col gap-1 border-b border-line/70 px-3 py-2 last:border-b-0">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-semibold text-fg">{conditionLabel(c.condition)}</span>
        {c.met === undefined ? (
          <Status tone="err">unmet</Status>
        ) : c.overridden ? (
          <Status tone="warn">passed by override</Status>
        ) : c.met ? (
          <Status tone="ok">met</Status>
        ) : (
          <Status tone="err">unmet</Status>
        )}
        {asks && <span className="text-[10.5px] text-faint">{asks}</span>}
      </span>
      <span className="text-[11.5px] leading-[1.5] text-dim">{c.detail}</span>
      {c.items.length > 0 && (
        <ul className="flex flex-col gap-0.5 pl-3">
          {c.items.map((it, i) => {
            const href = findingHref(it);
            return (
              <li key={i} className="list-disc font-mono text-[10.5px] leading-[1.5] break-words text-faint">
                {href ? (
                  <Link href={href} className="focusable rounded-sm hover:underline">
                    {itemLine(it)}
                  </Link>
                ) : (
                  itemLine(it)
                )}
              </li>
            );
          })}
        </ul>
      )}
      {c.condition === "eval" && c.met !== true && !c.overridden && (
        <Link href={`/evals?agent=${encodeURIComponent(agent)}`} className="focusable w-fit rounded-sm text-[11px] font-medium text-fg underline">
          Run its eval
        </Link>
      )}
      {c.condition === "review" && c.met !== true && !c.overridden && (
        <Link href={`/lifecycle?agent=${encodeURIComponent(agent)}#reviews`} className="focusable w-fit rounded-sm text-[11px] font-medium text-fg underline">
          Its reviews
        </Link>
      )}
      {c.condition === "autonomy" && c.met !== true && !c.overridden && (
        <Link href={`/lifecycle?agent=${encodeURIComponent(agent)}#autonomy`} className="focusable w-fit rounded-sm text-[11px] font-medium text-fg underline">
          Its tier, and what it lacks
        </Link>
      )}
    </li>
  );
}

/** The conditions as the gate read them: the unmet ones first (with what they read), then the rest. */
export function GateConditions({ refusal, agent }: { refusal: Pick<GateRefusal, "unmet" | "conditions">; agent: string }) {
  const unmet = new Set(refusal.unmet.map((u) => u.condition));
  const rest = refusal.conditions.filter((c) => !unmet.has(c.condition));
  const full = new Map(refusal.conditions.map((c) => [c.condition, c]));
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-semibold text-dim">Unmet</span>
      <ul className="overflow-hidden rounded-md border border-err-line bg-surface">
        {refusal.unmet.map((u) => (
          <ConditionRow key={u.condition} c={{ ...u, met: full.get(u.condition)?.met ?? false, overridden: full.get(u.condition)?.overridden ?? false }} agent={agent} />
        ))}
      </ul>
      {rest.length > 0 && (
        <>
          <span className="text-[11px] font-semibold text-dim">The rest of the gate</span>
          <ul className="overflow-hidden rounded-md border border-line bg-surface">
            {rest.map((c) => (
              <ConditionRow key={c.condition} c={c} agent={agent} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** An administrator's override: a reason, and every unmet condition or the ones picked. */
export function OverrideForm({
  refusal,
  busy,
  error,
  onSubmit,
}: {
  refusal: Pick<GateRefusal, "unmet">;
  busy: boolean;
  error: string;
  onSubmit: (body: ReturnType<typeof overrideBody>) => void;
}) {
  const [form, setForm] = useState<OverrideForm>(EMPTY_OVERRIDE);
  const [tried, setTried] = useState(false);
  const choices = overrideChoices(refusal);
  const problem = overrideProblem(form);
  const outcome = overrideOutcome(form, refusal);
  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-warn-line bg-warn-bg/30 p-3">
      <span className="text-[12.5px] font-semibold text-fg">Deploy past the gate</span>
      <span className="text-[11.5px] leading-[1.5] text-dim">
        An administrator&rsquo;s override passes the conditions it names. It is recorded on the deployment and the gate&rsquo;s decision, audited, and raised as
        attention for seven days, so the gate is made whole on its own records afterwards.
      </span>
      <Field label="Reason" error={tried && !form.reason.trim() ? "An override needs a reason." : undefined} hint="Recorded with your name on the deployment and in the audit trail.">
        <Textarea rows={2} value={form.reason} onChange={(v) => setForm((f) => ({ ...f, reason: v }))} disabled={busy} placeholder="Why this version ships without what the gate asks." />
      </Field>
      <div className="flex flex-col gap-1.5">
        <label className="flex cursor-pointer items-center gap-2 text-[12px] text-fg">
          <input type="radio" name="af-override-scope" checked={form.all} onChange={() => setForm((f) => ({ ...f, all: true }))} disabled={busy} />
          Pass every unmet condition ({refusal.unmet.map((u) => conditionLabel(u.condition).toLowerCase()).join(", ")})
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-[12px] text-fg">
          <input type="radio" name="af-override-scope" checked={!form.all} onChange={() => setForm((f) => ({ ...f, all: false }))} disabled={busy} />
          Pass only these:
        </label>
        {!form.all && (
          <span className="flex flex-wrap gap-3 pl-6">
            {choices.map((c) => (
              <label key={c} className="flex cursor-pointer items-center gap-1.5 text-[12px] text-dim">
                <input
                  type="checkbox"
                  checked={form.picked.includes(c)}
                  onChange={(e) => setForm((f) => ({ ...f, picked: e.target.checked ? [...f.picked, c] : f.picked.filter((x) => x !== c) }))}
                  disabled={busy}
                />
                {conditionLabel(c)}
              </label>
            ))}
          </span>
        )}
      </div>
      {outcome.holds.length > 0 && (
        <span className="text-[11px] text-err">Still unmet after it: {outcome.holds.map((c) => conditionLabel(c).toLowerCase()).join(", ")}. The gate refuses the deploy again.</span>
      )}
      {tried && problem && <span className="text-[11px] text-err">{problem}</span>}
      {error && <span className="text-[11.5px] text-err">{error}</span>}
      <span className="flex items-center gap-2">
        <span className="grow" />
        <Button
          size="sm"
          variant="solid"
          tone="warn"
          permission="deploy"
          loading={busy}
          onClick={() => {
            setTried(true);
            if (problem) return;
            onSubmit(overrideBody(form));
          }}
        >
          Deploy with override
        </Button>
      </span>
    </div>
  );
}

/** A refusal and, for an administrator, the override. Presentational: the caller sends the deploy. */
export function GatePanel({
  refusal,
  agent,
  admin,
  busy,
  error,
  onOverride,
}: {
  refusal: GateRefusal;
  agent: string;
  admin: boolean;
  busy: boolean;
  error: string;
  onOverride: (body: ReturnType<typeof overrideBody>) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Banner tone="err" title="The platform refused this deploy">
        {gateSummary(refusal)}
        <span className="mt-0.5 block font-mono text-[10.5px] text-faint">
          decision {refusal.decision || "not recorded"} · digest {shortDigest(refusal.digest)}
        </span>
      </Banner>
      <GateConditions refusal={refusal} agent={agent} />
      {admin ? (
        <OverrideForm refusal={refusal} busy={busy} error={error} onSubmit={onOverride} />
      ) : (
        <p className="text-[11.5px] leading-[1.5] text-faint">Only an administrator may deploy past the gate, with a reason. Meet the conditions above, then deploy again.</p>
      )}
    </div>
  );
}

/** A deploy that went through: where, which version, the gate's decision, and any override. */
export function DeployedReceipt({ d }: { d: Deployed }) {
  return (
    <Banner tone={d.override ? "warn" : "ok"} title={`Version ${d.version ?? "?"} deployed to ${d.environment}`}>
      {d.environment === "production" ? (d.override ? overrideLine(d.override) : "Deployed. Production runs this version from its next run.") : "Recorded for that environment; production runs what it ran."}
      <span className="mt-0.5 block font-mono text-[10.5px] text-faint">
        digest {shortDigest(d.digest)} · deployment {d.deployment}
        {d.decision ? ` · decision ${d.decision}` : ""} · {whenText(d.at)}
      </span>
    </Banner>
  );
}

/**
 * Deploy one version to production through the gate, as a dialog: from the
 * Control page's lifecycle strip and the lifecycle page. It asks first,
 * then sends the deploy; a refusal shows the gate and, for an
 * administrator, the override, sent as the same deploy with `override`.
 */
export function DeployDialog({
  agent,
  version,
  label,
  onClose,
  onDeployed,
}: {
  agent: string;
  /** The version to deploy; the latest save when left out. */
  version?: number | null;
  /** What is being deployed, in words: `version 3 of triage`. */
  label: string;
  onClose: () => void;
  onDeployed: (d: Deployed) => void;
}) {
  const { session } = useSession();
  const admin = canOverride(session);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<GateRefusal | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Deployed | null>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const send = async (override?: ReturnType<typeof overrideBody>) => {
    setBusy(true);
    setError("");
    try {
      const d = await deploy(agent, { ...(version ? { version } : {}), ...(override ? { override } : {}) });
      setDone(d);
      setRefusal(null);
      onDeployed(d);
    } catch (e) {
      const gate = gateRefusalOf(e);
      const gone = retiredRefusalOf(e);
      if (gate) setRefusal(gate);
      else if (gone) setError(`${agent} is retired. ${retiredLine(gone)}`);
      else if (e instanceof DoorError && e.status === 403 && e.control === "override") setError(`${e.message}. Only an administrator may override the gate.`);
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-canvas/70 p-4" onClick={busy ? undefined : onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="af-deploy-title" onClick={(e) => e.stopPropagation()} className="flex max-h-[88vh] w-full max-w-[640px] flex-col rounded-xl border border-line bg-surface elev-3 af-pop">
        <div className="flex flex-col gap-1.5 border-b border-line p-5 pb-4">
          <h3 id="af-deploy-title" className="text-[16px] font-semibold tracking-tight">
            Deploy {label} to production
          </h3>
          <p className="text-[12.5px] leading-[1.55] text-dim">
            No promotion gate runs on this deployment: no eval, review or regression is checked before a deploy. The version you deploy becomes what production runs. If the
            platform refuses the deploy, its reason is shown here.
          </p>
        </div>
        <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto p-5">
          {done ? <DeployedReceipt d={done} /> : refusal ? <GatePanel refusal={refusal} agent={agent} admin={admin} busy={busy} error={error} onOverride={(o) => send(o)} /> : null}
          {!refusal && error && (
            <Banner tone="err" title="The deploy was refused">
              {error}
            </Banner>
          )}
          {!done && !refusal && !error && <Mono className="text-[11px] text-faint">Nothing is sent until you deploy.</Mono>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          {refusal && <Tag tone="err">{refusal.unmet.length} unmet</Tag>}
          <span className="grow" />
          <Button variant="solid" tone={done ? "neutral" : "err"} size="sm" onClick={onClose} disabled={busy}>
            {done ? "Close" : "Cancel"}
          </Button>
          {!done && !refusal && (
            <Button variant="solid" tone="ink" size="sm" permission="deploy" loading={busy} onClick={() => send()}>
              Deploy
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
