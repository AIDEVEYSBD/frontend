"use client";

import { useEffect, useState } from "react";
import { ask, type Answer } from "@/lib/api/pending";
import { AnswerFailure } from "./pending";
import { Status } from "./ui";

/**
 * The deployment's screener, as `GET /api/screener/health` answers: which
 * screener runs, whether it answered its own check just now, whether an
 * outage blocks (fails closed) or lets through, and how long screening takes.
 * One line above the injection and exfiltration watch, since the watch is
 * what that screener's verdicts fill. Every figure is the answer's; one it
 * does not give is left out.
 */

interface Health {
  implementation?: string;
  ok?: boolean;
  fail_closed?: boolean;
  region?: string;
  latency?: { count?: number; total?: number; window?: number | string; p50_ms?: number | null; p95_ms?: number | null };
  detail?: Record<string, unknown>;
}

const LABEL: Record<string, string> = { platform: "the platform's own screener", model_armor: "Google Model Armor" };

export function ScreenerHealthLine() {
  const [answer, setAnswer] = useState<Answer<Health> | null>(null);
  useEffect(() => {
    let live = true;
    void ask<Health>("screenerHealth").then((a) => live && setAnswer(a));
    return () => {
      live = false;
    };
  }, []);
  if (!answer) return null;
  if (answer.state !== "ok") return <AnswerFailure answer={answer} what="The screener's health could not be read" />;
  const h = answer.data ?? {};
  const d = h.detail ?? {};
  const why = [d.self_check, d.detail].find((x): x is string => typeof x === "string" && x !== "") ?? "";
  const lat = h.latency ?? {};
  const ms = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? `${Math.round(x)} ms` : "");
  const timing = [ms(lat.p50_ms) && `p50 ${ms(lat.p50_ms)}`, ms(lat.p95_ms) && `p95 ${ms(lat.p95_ms)}`].filter(Boolean).join(", ");
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-line bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-dim">
      <span className="font-medium text-fg">Screener</span>
      <span>{h.implementation ? LABEL[h.implementation] ?? h.implementation : "not named in the answer"}</span>
      {h.ok === true ? <Status tone="ok">answering</Status> : h.ok === false ? <Status tone="err">not answering</Status> : <Status tone="warn">health not stated</Status>}
      {typeof h.fail_closed === "boolean" && <span>{h.fail_closed ? "an outage blocks what it would have screened" : "an outage lets through what it would have screened"}</span>}
      {h.region && <span className="text-faint">· {h.region}</span>}
      {timing && (
        <span className="tnum text-faint">
          · {timing}
          {typeof lat.count === "number" ? ` over ${lat.count} call${lat.count === 1 ? "" : "s"}` : ""}
        </span>
      )}
      {why && h.ok !== true && <span className={`basis-full text-[11px] ${h.ok === false ? "text-err" : "text-faint"}`}>{why}</span>}
    </p>
  );
}
