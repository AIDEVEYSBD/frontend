"use client";
import { Failure } from "./pending";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Status, Tag } from "./ui";
import { Checkbox } from "./forms";
import { GroupHeader } from "./page-tabs";
import { hueFor } from "@/lib/hue";
import { errorText } from "@/lib/api/client";
import { fmtUsd } from "@/lib/run-tree";

/**
 * Drift per agent (`GET /api/drift`): the last day of an agent's ended runs
 * against the thirty days before it, on six measures read from the records:
 * the refusal rate, how runs ended, the cost per run, the working time per
 * run, the model mix and the findings' severities. Each measure carries its
 * statistic, its distance or z, its threshold and both windows side by side;
 * a measure with too little data in either window says so and carries no
 * number. Reading only. The answer is read here as the backend writes it
 * (its measures are not the ones lib/api/l7.ts names).
 */

type Kind = "mix" | "mean" | "rate";
type Statistic = "jensen_shannon" | "welch_z" | "proportion_z";

interface Measure {
  name: string;
  kind: Kind;
  statistic: Statistic;
  /** The Jensen–Shannon distance of a mix, |z| of a mean or a rate; null when there is not enough to compute it. */
  distance: number | null;
  z: number | null;
  threshold: number;
  drifted: boolean;
  enough: boolean;
  says: string;
  recent: Record<string, unknown>;
  baseline: Record<string, unknown>;
  field: string | null;
}

interface Window {
  since: string;
  until: string;
  runs: number;
}

interface AgentDrift {
  agent: string;
  recent: Window;
  baseline: Window;
  enough: boolean;
  drifted: boolean;
  says: string;
  measures: Measure[];
}

interface Report {
  agents: AgentDrift[];
  count: number;
  now: string;
  thresholds: { mix_js?: number; mean_z?: number };
  min_runs: { recent?: number; baseline?: number };
  windows: { recent_h?: number; baseline_d?: number };
}

const MEASURE_LABEL: Record<string, string> = {
  refusal_rate: "Refusal rate",
  outcome_mix: "How runs ended",
  cost_per_run: "Cost per run",
  latency_ms: "Working time per run",
  model_mix: "Model mix",
  severity_mix: "Finding severities",
};

const MEASURE_ASKS: Record<string, string> = {
  refusal_rate: "the share of runs with at least one refused call",
  outcome_mix: "done, failed or stopped",
  cost_per_run: "US dollars per run, over runs whose every model has a price; runs with an unpriced model are left out and counted",
  latency_ms: "the run's working time, in milliseconds",
  model_mix: "model calls per model, every call pooled",
  severity_mix: "the findings runs recorded, by severity",
};

const STATISTIC_LABEL: Record<Statistic, string> = { jensen_shannon: "Jensen–Shannon distance", welch_z: "Welch's z", proportion_z: "two-proportion z" };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

function measureOf(v: unknown): Measure {
  const o = obj(v);
  const kind = o.kind === "mean" || o.kind === "rate" ? o.kind : "mix";
  const statistic = o.statistic === "welch_z" || o.statistic === "proportion_z" ? o.statistic : "jensen_shannon";
  return { name: str(o.name), kind, statistic, distance: num(o.distance), z: num(o.z), threshold: num(o.threshold) ?? 0, drifted: o.drifted === true,
           enough: o.enough === true, says: str(o.says), recent: obj(o.recent), baseline: obj(o.baseline), field: str(o.field) || null };
}

function windowOf(v: unknown): Window {
  const o = obj(v);
  return { since: str(o.since), until: str(o.until), runs: num(o.runs) ?? 0 };
}

function reportOf(v: unknown): Report {
  const o = obj(v);
  const agents = (Array.isArray(o.agents) ? o.agents : []).map((x): AgentDrift => {
    const a = obj(x);
    return { agent: str(a.agent), recent: windowOf(a.recent), baseline: windowOf(a.baseline), enough: a.enough === true, drifted: a.drifted === true,
             says: str(a.says), measures: (Array.isArray(a.measures) ? a.measures : []).map(measureOf) };
  });
  return { agents, count: num(o.count) ?? agents.length, now: str(o.now), thresholds: obj(o.thresholds), min_runs: obj(o.min_runs), windows: obj(o.windows) };
}

async function readDrift(agent: string): Promise<Report> {
  const path = agent ? `/api/drift?agent=${encodeURIComponent(agent)}` : "/api/drift";
  const res = await fetch(path, { cache: "no-store" });
  const d: unknown = await res.json().catch(() => null);
  if (!res.ok || !d || obj(d).error) throw new Error(errorText(d, res, "GET", "/api/drift"));
  return reportOf(d);
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function statText(m: Measure): string {
  if (m.kind === "mix") return m.distance === null ? "—" : m.distance.toFixed(3);
  return m.z === null ? "—" : `z ${m.z < 0 ? "−" : "+"}${Math.abs(m.z).toFixed(2)}`;
}

function sideText(m: Measure, side: Record<string, unknown>): string {
  const n = num(side.n) ?? 0;
  if (m.kind === "mix") {
    const shares = Object.entries(obj(side.shares)).filter((e): e is [string, number] => typeof e[1] === "number").sort((a, b) => b[1] - a[1]);
    if (!shares.length) return `none (n ${n})`;
    const shown = shares.slice(0, 3).map(([k, v]) => `${k} ${pct(v)}`);
    return `${shown.join(" · ")}${shares.length > 3 ? ` · +${shares.length - 3} more` : ""} (n ${n})`;
  }
  if (m.kind === "mean") {
    const mean = num(side.mean);
    const sd = num(side.sd) ?? 0;
    const left = num(side.left_out);
    const unit = (x: number) => (m.name === "cost_per_run" ? fmtUsd(x) : `${Math.round(x)} ms`);
    return `${mean === null ? "none" : `${unit(mean)} ± ${unit(sd)}`} (n ${n}${left ? `, ${left} left out unpriced` : ""})`;
  }
  const rate = num(side.rate);
  return rate === null ? `none (n ${n})` : `${pct(rate)} of runs (${num(side.runs_with) ?? 0} of ${n})`;
}

export function Drift() {
  return (
    <Suspense>
      <DriftInner />
    </Suspense>
  );
}

function DriftInner() {
  const params = useSearchParams();
  const router = useRouter();
  const agent = params.get("agent") ?? "";
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [onlyDrifted, setOnlyDrifted] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    readDrift(agent)
      .then((r) => {
        setReport(r);
        setError("");
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [agent]);
  useEffect(() => {
    const id = setTimeout(load, 0);
    return () => clearTimeout(id);
  }, [load]);

  const agents = report?.agents ?? [];
  const shown = onlyDrifted ? agents.filter((a) => a.drifted) : agents;
  const drifted = agents.filter((a) => a.drifted).length;
  const compared = agents.filter((a) => a.enough && !a.drifted).length;
  const thin = agents.filter((a) => !a.enough).length;
  const quietDown = Boolean(error) && !report;

  return (
    <div className="mx-auto w-full max-w-[1520px] px-5 py-7" data-hue="amber">
      <GroupHeader
        group="quality"
        tab="drift"
        actions={
          <>
            {agent ? (
              <Button size="sm" variant="solid" tone="neutral" onClick={() => router.replace("/drift", { scroll: false })}>
                All agents
              </Button>
            ) : (
              <Checkbox label="Only drifted" checked={onlyDrifted} onChange={setOnlyDrifted} />
            )}
            <Button size="sm" variant="solid" tone="neutral" loading={loading} onClick={load}>
              Read again
            </Button>
          </>
        }
      >
        {agent && (
          <>
            Showing <span className="font-mono text-[11.5px] text-fg">{agent}</span> only.{" "}
          </>
        )}
        Whether an agent still behaves as it did: its last {report?.windows.recent_h ?? 24} hours of ended runs against the {report?.windows.baseline_d ?? 30} days before, on how often a run meets a refusal, how runs end, what a run costs, how long it works, which models it calls and the severities of what it finds.
      </GroupHeader>

      <section className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-4">
        {[
          { k: "Drifted", v: report ? String(drifted) : "…", tone: drifted ? "text-err" : "" },
          { k: "Within thresholds", v: report ? String(compared) : "…", tone: "" },
          { k: "Not enough runs", v: report ? String(thin) : "…", tone: "" },
          { k: "Thresholds", v: report ? `JS ${report.thresholds.mix_js} · z ±${report.thresholds.mean_z}` : "…", tone: "" },
        ].map((x) => (
          <div key={x.k} className="flex flex-col gap-0.5 bg-surface px-3 py-2.5">
            {quietDown ? <span className="flex h-[17px] items-center text-[12px] text-faint">Not read</span> : <span className={`tnum text-[17px] leading-none font-semibold ${x.tone}`}>{x.v}</span>}
            <span className="text-[10.5px] text-faint">{x.k}</span>
          </div>
        ))}
      </section>
      {report && (
        <p className="mt-2 text-[11px] text-faint">
          A measure needs {report.min_runs.recent} in the last {report.windows.recent_h} h and {report.min_runs.baseline} in the {report.windows.baseline_d} days before (runs, model
          calls or findings, as it counts); with fewer it says so and has no number. A mix moves by its Jensen–Shannon distance (0 to 1, past {report.thresholds.mix_js}); a mean by
          Welch&rsquo;s z and a rate by the two-proportion z (past ±{report.thresholds.mean_z}). Read {report.now ? new Date(report.now).toLocaleString() : "now"}.
        </p>
      )}

      {error && <Failure className="mt-4" what="The drift report could not be read" message={error} />}
      {report && shown.length === 0 && !error && (
        <p className="mt-6 text-[12.5px] text-faint">{onlyDrifted ? "No agent drifted." : "There are no agents, and no runs in these windows."}</p>
      )}

      <div className="mt-4 flex flex-col gap-4">
        {shown.map((a) => (
          <AgentCard key={a.agent} drift={a} single={Boolean(agent)} windows={report?.windows ?? {}} />
        ))}
      </div>
    </div>
  );
}

/** One agent's drift: its verdict, both windows, and each measure side by side. Presentational. */
export function AgentCard({ drift: a, single, windows }: { drift: AgentDrift; single: boolean; windows: Report["windows"] }) {
  const moved = a.measures.filter((m) => m.drifted).map((m) => MEASURE_LABEL[m.name] ?? m.name);
  const verdict = a.drifted ? { tone: "err" as const, label: "Drifted", detail: `shifted: ${moved.join(", ")}` } : !a.measures.some((m) => m.enough)
    ? { tone: "neutral" as const, label: "Not enough runs", detail: a.says } : { tone: "ok" as const, label: "Within thresholds", detail: a.says };
  return (
    <section className="flex flex-col overflow-hidden rounded-md border border-line bg-surface">
      <div data-hue={hueFor(a.drifted ? "refusal" : "agent")} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-raise/55 px-4 py-2.5">
        {single ? (
          <span className="text-[13px] font-semibold text-fg">{a.agent}</span>
        ) : (
          <Link href={`/drift?agent=${encodeURIComponent(a.agent)}`} className="focusable rounded-sm text-[13px] font-semibold text-fg hover:underline">
            {a.agent}
          </Link>
        )}
        <Status tone={verdict.tone}>{verdict.label}</Status>
        <span className="min-w-0 text-[11.5px] text-dim">{verdict.detail}</span>
        <span className="grow" />
        <span className="text-[11px] text-faint">
          {a.recent.runs} ended run{a.recent.runs === 1 ? "" : "s"} in the last {windows.recent_h ?? 24} h against {a.baseline.runs} in the {windows.baseline_d ?? 30} days before
        </span>
        <Button size="sm" variant="solid" tone="neutral" href={`/dependencies?node=${encodeURIComponent(`agent:${a.agent}`)}`}>
          Dependencies
        </Button>
        <Button size="sm" variant="solid" tone="neutral" href={`/evals?agent=${encodeURIComponent(a.agent)}`}>
          Benchmark
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] border-collapse text-[11.5px]">
          <thead>
            <tr className="border-b border-line bg-raise/40 text-left text-[10.5px] text-faint">
              <th className="px-4 py-1.5 font-medium">Measure</th>
              <th className="px-3 py-1.5 font-medium">Statistic</th>
              <th className="px-3 py-1.5 text-right font-medium">Value</th>
              <th className="px-3 py-1.5 font-medium">Threshold</th>
              <th className="px-3 py-1.5 font-medium">Last day</th>
              <th className="px-3 py-1.5 font-medium">Thirty days before</th>
              <th className="px-4 py-1.5 font-medium">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {a.measures.map((m) => (
              <tr key={m.name} className={`border-b border-line align-top last:border-0 ${m.drifted ? "bg-err-bg/30" : ""}`}>
                <td className="px-4 py-2">
                  <span className="flex flex-col gap-0.5">
                    <span className={`font-medium ${m.drifted ? "text-err" : "text-fg"}`}>{MEASURE_LABEL[m.name] ?? m.name}</span>
                    <span className="max-w-[34ch] text-[10.5px] leading-[1.45] text-faint">{MEASURE_ASKS[m.name] ?? ""}</span>
                  </span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-dim">{STATISTIC_LABEL[m.statistic]}</td>
                <td className={`tnum px-3 py-2 text-right font-mono whitespace-nowrap ${m.drifted ? "font-semibold text-err" : "text-fg"}`}>{statText(m)}</td>
                <td className="px-3 py-2 whitespace-nowrap text-faint">{m.kind === "mix" ? `past ${m.threshold}` : `past ±${m.threshold}`}</td>
                <td className="max-w-[260px] px-3 py-2 font-mono text-[10.5px] leading-[1.5] break-words text-dim">{sideText(m, m.recent)}</td>
                <td className="max-w-[260px] px-3 py-2 font-mono text-[10.5px] leading-[1.5] break-words text-dim">{sideText(m, m.baseline)}</td>
                <td className="px-4 py-2">
                  <span className="flex flex-col gap-0.5">
                    {!m.enough ? <Tag>not enough data</Tag> : m.drifted ? <Tag tone="err" solid>drifted</Tag> : <Tag tone="ok">within</Tag>}
                    <span className="max-w-[30ch] text-[10.5px] leading-[1.45] text-faint">{m.says}</span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
