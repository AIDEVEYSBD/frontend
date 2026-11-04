"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Status, Tag } from "./ui";
import { DigestChip } from "./digest-chip";
import { getAutonomyTiers, type AgentTier, type AutonomyTiers } from "@/lib/api/l9";
import { requirementLabel, requirementState, tierDocLine, tierLine, tierTag } from "@/lib/autonomy";

/**
 * The autonomy tier on an agent, with the controls it lacks (phase L9). A
 * spec's `metadata.autonomy` declares L0 to L5; the promotion gate's autonomy
 * condition holds it to every control its tier requires, each named here with
 * who judges it, for what production runs, else the latest version. The tier
 * is declared in the Builder; a requirement the estate supplies (the guardian)
 * is changed on the Policy page. The tiers themselves are the runtime's.
 */

/** A tier as a tag on an agent's row. */
export function TierTag({ tier }: { tier: AgentTier }) {
  const t = tierTag(tier);
  return <Tag tone={t.tone}>{t.label}</Tag>;
}

/** One agent against its tier. Presentational. */
export function AutonomyPanelView({ tiers }: { tiers: AutonomyTiers }) {
  const a = tiers.agent;
  if (!a) return null;
  const tier = tiers.tiers.find((t) => t.tier === a.tier);
  return (
    <div className="flex flex-col gap-3">
      <span className="flex flex-wrap items-center gap-2">
        <Tag>{a.tier}</Tag>
        <span className="text-[12.5px] font-semibold text-fg">{a.name}</span>
        <Status tone={a.problem ? "warn" : a.met ? "ok" : "err"}>{a.problem ? "cannot be judged" : a.met ? "meets its tier" : `${a.missing.length} missing`}</Status>
        <span className="grow" />
        <span className="flex items-center gap-1.5 text-[10.5px] text-faint">
          judged on version {a.version ?? "?"}
          <DigestChip digest={a.digest} label="Digest judged" />
        </span>
      </span>
      <p className="text-[11.5px] leading-[1.55] text-dim">{tierLine(a, tiers.requirements)}</p>
      {tier && <p className="text-[11px] leading-[1.5] text-faint">{tier.description}</p>}
      {tier && <p className="text-[10.5px] leading-[1.5] text-ghost">{tierDocLine(tier)}</p>}
      {a.requires.length > 0 && (
        <ul className="flex flex-col overflow-hidden rounded-md border border-line">
          {a.requires.map((r) => {
            const s = requirementState(r);
            return (
              <li key={r.requirement} className="flex flex-col gap-0.5 border-b border-line px-3 py-1.5 last:border-b-0">
                <span className="flex flex-wrap items-center gap-2">
                  <Status tone={s.tone}>{s.label}</Status>
                  <span className="text-[12px] font-medium text-fg">{requirementLabel(r.requirement, tiers.requirements)}</span>
                  <span className="text-[10.5px] text-ghost">judged by the {r.judged_by}</span>
                </span>
                <span className="text-[11px] leading-[1.5] text-dim">{r.detail}</span>
                {r.requirement === "guardian" && r.met === false && (
                  <Link href="/guardian" className="focusable w-fit rounded-sm text-[11px] text-fg underline">
                    The guardian
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <details>
        <summary className="focusable cursor-pointer text-[10.5px] text-ghost">Every tier and what it requires</summary>
        <ul className="mt-1 flex flex-col gap-1">
          {tiers.tiers.map((t) => (
            <li key={t.tier} className="text-[11px] leading-[1.5] text-faint">
              <span className="font-medium text-dim">
                {t.tier} {t.name}
              </span>
              : {t.requires.length ? t.requires.map((r) => requirementLabel(r, tiers.requirements).toLowerCase()).join("; ") : "no controls required"}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** An agent's tier, read from its door. */
export function AutonomyPanel({ agent, tick = 0 }: { agent: string; tick?: number }) {
  const [tiers, setTiers] = useState<AutonomyTiers | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let stop = false;
    getAutonomyTiers(agent)
      .then((t) => {
        if (stop) return;
        setTiers(t);
        setError("");
      })
      .catch((e) => {
        if (!stop) setError((e as Error).message);
      });
    return () => {
      stop = true;
    };
  }, [agent, tick]);
  if (error) return <p className="text-[11.5px] text-err">{error}</p>;
  return tiers ? <AutonomyPanelView tiers={tiers} /> : <p className="text-[12px] text-faint">Reading…</p>;
}
