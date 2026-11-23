"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Mono, Tag, Status } from "./ui";
import { Banner } from "./overlays";
import { useDoorBuilt } from "@/lib/use-doors";
import { DoorError } from "@/lib/api/l5";
import { unsupportedOf, unsupportedReason, type UnsupportedPart } from "@/lib/unsupported";
import { UnsupportedParts } from "./unsupported";
import { deploy, gateRefusalOf, retiredRefusalOf, type Condition, type Deployed, type GateRefusal, type OverrideRequest } from "@/lib/api/l8";
import { conditionLabel, findingHref, itemLine, retiredLine, shortDigest, whenText } from "@/lib/lifecycle";

/**
 * Deploying a version, as a person meets it (phase 8). A deploy to
 * production is held to its conditions, read for exactly the digest being
 * deployed, and the platform answers every one with whether it holds and why:
 *
 *   review       the newest review of the digest approves it, by someone who did not author it
 *   supported    the definition uses no part the platform does not carry out
 *   retrieval    its retrieval tools name the knowledge stores they read
 *   not retired  the agent is not retired
 *   use case     the use case of the workload it runs is approved, and each gate it registers has its await node
 *   autonomy     every control the agent's autonomy tier requires is met
 *   eval         the latest evaluation of the digest meets the release threshold
 *
 * A deploy to staging needs the review only (and the agent not retired): it
 * is a record, and nothing runs it. A refusal (409) lists every condition;
 * this shows the ones that do not hold first. There is no override: a
 * version is deployed only when every condition holds.
 */

type Environment = "production" | "staging";

/** What each condition asks, in the platform's terms. */
const ASKS: Record<string, string> = {
  review: "an approving review of this digest by someone who did not author it",
  supported: "no part of the definition the platform does not carry out",
  retrieval: "every retrieval tool names the knowledge stores it reads",
  not_retired: "the agent is not retired",
  use_case: "its use case approved, and every gate it registers held by an await node with that approver and no longer a timeout",
  autonomy: "every control its autonomy tier requires: the tier of its use case, else the one its definition declares",
  eval: "the latest evaluation of this digest at or above the agent's release threshold",
};

/** Where a person goes to make a condition hold. */
const MEND: Record<string, { href: (agent: string) => string; says: string }> = {
  review: { href: (a) => `/lifecycle?agent=${encodeURIComponent(a)}#reviews`, says: "Its reviews" },
  use_case: { href: () => "/workloads#use-cases", says: "The use cases" },
  autonomy: { href: (a) => `/lifecycle?agent=${encodeURIComponent(a)}#autonomy`, says: "Its tier, and what it lacks" },
  eval: { href: (a) => `/evals?agent=${encodeURIComponent(a)}`, says: "Its evaluations" },
};

function ConditionRow({ c, agent }: { c: Pick<Condition, "condition" | "detail" | "items"> & { met?: boolean }; agent: string }) {
  const mend = MEND[c.condition];
  return (
    <li className="flex flex-col gap-1 border-b border-line/70 px-3 py-2 last:border-b-0">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] font-semibold text-fg">{conditionLabel(c.condition)}</span>
        {c.met ? <Status tone="ok">holds</Status> : <Status tone="err">does not hold</Status>}
        {ASKS[c.condition] && <span className="text-[10.5px] text-faint">{ASKS[c.condition]}</span>}
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
      {mend && !c.met && (
        <Link href={mend.href(agent)} className="focusable w-fit rounded-sm text-[11px] font-medium text-fg underline">
          {mend.says}
        </Link>
      )}
    </li>
  );
}

/** The conditions as the platform read them: those that do not hold first (with what they read), then the rest. */
export function GateConditions({ refusal, agent }: { refusal: Pick<GateRefusal, "unmet" | "conditions">; agent: string }) {
  const unmet = new Set(refusal.unmet.map((u) => u.condition));
  const rest = refusal.conditions.filter((c) => !unmet.has(c.condition));
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-semibold text-dim">Does not hold</span>
      <ul className="overflow-hidden rounded-md border border-err-line bg-surface">
        {refusal.unmet.map((u) => (
          <ConditionRow key={u.condition} c={{ ...u, met: false }} agent={agent} />
        ))}
      </ul>
      {rest.length > 0 && (
        <>
          <span className="text-[11px] font-semibold text-dim">Holds</span>
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

/**
 * A refused deploy: which version, which conditions do not hold, and every
 * condition. Presentational. `admin`, `busy`, `error` and `onOverride` are
 * kept for the callers written when an override existed; the platform has
 * none, so no override is offered.
 */
export function GatePanel({
  refusal,
  agent,
  error,
}: {
  refusal: GateRefusal;
  agent: string;
  admin: boolean;
  busy: boolean;
  error: string;
  onOverride: (body: OverrideRequest) => void;
}) {
  const what = refusal.version !== null ? `version ${refusal.version} (${shortDigest(refusal.digest)})` : shortDigest(refusal.digest);
  const unmet = refusal.unmet.map((u) => conditionLabel(u.condition).toLowerCase());
  const kept = refusal.saved ? ` Version ${refusal.saved.version ?? "?"} is saved${refusal.saved.draft ? " as a draft" : ""}.` : "";
  return (
    <div className="flex flex-col gap-3">
      <Banner tone="err" title="The platform refused this deploy">
        {`${what} is not deployed to ${refusal.environment}: ${unmet.join(", ") || "a condition"} ${unmet.length === 1 ? "does" : "do"} not hold. Nothing that runs changed.${kept}`}
        <span className="mt-0.5 block font-mono text-[10.5px] text-faint">decision {refusal.decision || "not recorded"}</span>
      </Banner>
      <GateConditions refusal={refusal} agent={agent} />
      {error && <span className="text-[11.5px] text-err">{error}</span>}
      <p className="text-[11.5px] leading-[1.5] text-faint">There is no override: meet the conditions above, then deploy again.</p>
    </div>
  );
}

/** A deploy that went through: where, which version, the decision, and the conditions it was held to. */
export function DeployedReceipt({ d }: { d: Deployed }) {
  const production = d.environment === "production";
  return (
    <Banner tone="ok" title={`Version ${d.version ?? "?"} deployed to ${d.environment}`}>
      {production ? "Every condition held. New runs of this agent use this version." : "The review held. Recorded for staging: nothing runs it, and production runs what it ran."}
      {d.conditions.length > 0 && (
        <span className="mt-0.5 block text-[11.5px] text-dim">Held: {d.conditions.map((c) => conditionLabel(c.condition).toLowerCase()).join(", ")}.</span>
      )}
      <span className="mt-0.5 block font-mono text-[10.5px] text-faint">
        digest {shortDigest(d.digest)}
        {d.deployment ? ` · deployment ${d.deployment}` : ""}
        {d.decision ? ` · decision ${d.decision}` : ""} · {whenText(d.at)}
      </span>
    </Banner>
  );
}

/**
 * Deploy one version, as a dialog: from the Control page's lifecycle strip
 * and the lifecycle page. It asks where (production, or staging), then sends
 * the deploy; a refusal lists every condition with whether it holds.
 */
export function DeployDialog({
  agent,
  version,
  label,
  onClose,
  onDeployed,
  unsupported = [],
}: {
  agent: string;
  /** The version to deploy; the latest save when left out. */
  version?: number | null;
  /** What is being deployed, in words: `version 3 of triage`. */
  label: string;
  onClose: () => void;
  onDeployed: (d: Deployed) => void;
  /** Parts of the agent's definition the platform does not carry out, when known before the press: production is off, with them listed. */
  unsupported?: UnsupportedPart[];
}) {
  const [environment, setEnvironment] = useState<Environment>("production");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<GateRefusal | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Deployed | null>(null);
  // Deploying is offered only while its address is built (GET /api/doors); unknown leaves the button, and a press hears the answer.
  const built = useDoorBuilt("POST", "/api/agents/{agent}/deploy");
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

  const blocked = environment === "production" && unsupported.length > 0;
  const send = async () => {
    setBusy(true);
    setError("");
    setRefusal(null);
    try {
      const d = await deploy(agent, { ...(version ? { version } : {}), environment });
      setDone(d);
      onDeployed(d);
    } catch (e) {
      const gate = gateRefusalOf(e);
      const gone = retiredRefusalOf(e);
      if (gate) setRefusal(gate);
      else if (gone) setError(`${agent} is retired. ${retiredLine(gone)}`);
      else if (e instanceof DoorError && e.status === 409 && unsupportedOf(e.body).length) setError(`${e.message}: ${unsupportedReason(unsupportedOf(e.body))}`);
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
            Deploy {label} to {environment}
          </h3>
          <p className="text-[12.5px] leading-[1.55] text-dim">
            {environment === "production"
              ? "Production is held to every condition: a review by someone who did not author the version, parts the platform carries out, its use case and the gates it registers, the controls its autonomy tier requires, and the release threshold. The answer lists each with whether it holds; the version becomes what new runs use only when all do."
              : "Staging needs the review only, by someone who did not author the version. It is a record: nothing runs a staging deployment, and production keeps running what it runs."}
          </p>
          <div className="mt-1 flex items-center gap-4" role="radiogroup" aria-label="Environment">
            {(["production", "staging"] as Environment[]).map((env) => (
              <label key={env} className="flex cursor-pointer items-center gap-1.5 text-[12px] text-fg">
                <input type="radio" name={`af-deploy-env-${agent}`} checked={environment === env} onChange={() => setEnvironment(env)} disabled={busy || Boolean(done)} />
                {env}
                <span className="text-[10.5px] text-faint">{env === "production" ? "every condition" : "the review only"}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="flex min-h-0 grow flex-col gap-3 overflow-y-auto p-5">
          {!done && blocked && <UnsupportedParts parts={unsupported} />}
          {done ? <DeployedReceipt d={done} /> : refusal ? <GatePanel refusal={refusal} agent={agent} admin={false} busy={busy} error="" onOverride={() => {}} /> : null}
          {!refusal && error && (
            <Banner tone="err" title="The deploy was refused">
              {error}
            </Banner>
          )}
          {!done && !refusal && !error && !blocked && <Mono className="text-[11px] text-faint">Nothing is sent until you deploy.</Mono>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          {refusal && <Tag tone="err">{refusal.unmet.length} do not hold</Tag>}
          <span className="grow" />
          <Button variant="solid" tone={done ? "neutral" : "err"} size="sm" onClick={onClose} disabled={busy}>
            {done ? "Close" : "Cancel"}
          </Button>
          {!done && (
            <Button
              variant="solid"
              tone="ink"
              size="sm"
              permission="deploy"
              loading={busy}
              disabled={blocked || built === false}
              title={blocked ? unsupportedReason(unsupported) : built === false ? "deploying is not built on this platform" : undefined}
              onClick={() => send()}
            >
              {refusal ? "Deploy again" : "Deploy"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
