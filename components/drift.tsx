"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Status, Tag } from "./ui";
import { Checkbox } from "./forms";
import { hueFor } from "@/lib/hue";
import { getDrift, type AgentDrift, type DriftMeasure, type DriftReport } from "@/lib/api/l7";
import { MEASURE_ASKS, MEASURE_LABEL, STATISTIC_LABEL, dispositionField, driftVerdict, orderDrift, sideText, statText, thresholdText, windowsLine } from "@/lib/drift";

/**
 * Drift per agent (phase L7, `GET /api/drift`): the last day of an agent's
 * finished runs against the thirty days before it, on five measures (how
 * runs end, the result's confidence, the cost per run, the tool mix, the
 * refusal rate), each with its statistic, its distance or z, its threshold,
 * and both windows side by side. An agent with too few runs in either
 * window says so and is not compared. A shift past a threshold is also an
 * attention item, which opens here. Reading only.
 */

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
  const [report, setReport] = useState<DriftReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [onlyDrifted, setOnlyDrifted] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    getDrift(agent || undefined)
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

  const agents = report ? orderDrift(report.agents) : [];
  const shown = onlyDrifted ? agents.filter((a) => a.drifted) : agents;
  const drifted = agents.filter((a) => a.drifted).length;
  const compared = agents.filter((a) => a.enough && !a.drifted).length;
  const thin = agents.filter((a) => !a.enough).length;
  const mix = report?.thresholds.mix_js ?? 0.2;
  const z = report?.thresholds.mean_z ?? 2;

  return (
    <div className="mx-auto w-full max-w-[1520px] px-5 py-7" data-hue="amber">
      <header className="flex flex-wrap items-end gap-4">
        <div className="flex max-w-[86ch] flex-col gap-1.5">
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-fg">Drift{agent ? ` · ${agent}` : ""}</h1>
          <p className="text-[12.5px] leading-[1.6] text-dim">
            Whether an agent still behaves as it did: its last {report?.windows.recent_h ?? 24} hours of finished runs against the{" "}
            {report?.windows.baseline_d ?? 30} days before, on how runs end, the confidence they report, what a run costs, which tools it calls and how
            often it meets a refusal. A shift past its threshold is raised in the attention queue.
          </p>
        </div>
        <span className="grow" />
        <span className="flex flex-wrap items-center gap-2">
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
        </span>
      </header>

      <section className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-4">
        {[
          { k: "Drifted", v: report ? String(drifted) : "…", tone: drifted ? "text-err" : "" },
          { k: "Within thresholds", v: report ? String(compared) : "…", tone: "" },
          { k: "Not enough runs", v: report ? String(thin) : "…", tone: "" },
          { k: "Thresholds", v: `JS ${mix} · z ±${z}`, tone: "" },
        ].map((x) => (
          <div key={x.k} className="flex flex-col gap-0.5 bg-surface px-3 py-2.5">
            <span className={`tnum text-[17px] leading-none font-semibold ${x.tone}`}>{x.v}</span>
            <span className="text-[10.5px] text-faint">{x.k}</span>
          </div>
        ))}
      </section>
      {report && (
        <p className="mt-2 text-[11px] text-faint">
          Each window needs {report.min_runs.recent ?? 5} finished runs in the last {report.windows.recent_h ?? 24} h and {report.min_runs.baseline ?? 20} in the{" "}
          {report.windows.baseline_d ?? 30} days before; a confidence needs as many runs carrying one. A mix moves by its Jensen–Shannon distance (0 to 1, past {mix}); a
          mean by Welch&rsquo;s z and a rate by the two-proportion z (past ±{z}). Read {report.now ? new Date(report.now).toLocaleString() : "now"}.
        </p>
      )}

      {error && <p className="mt-4 text-[12.5px] text-err">{error}</p>}
      {report && shown.length === 0 && !error && (
        <p className="mt-6 text-[12.5px] text-faint">{onlyDrifted ? "No agent drifted." : "No agent has finished runs in these windows yet."}</p>
      )}

      <div className="mt-4 flex flex-col gap-4">
        {shown.map((a) => (
          <AgentCard key={a.agent} drift={a} windows={report?.windows ?? {}} single={Boolean(agent)} />
        ))}
      </div>
    </div>
  );
}

/** One agent's drift: its verdict, both windows, and each measure side by side. Presentational, so tests render it from a captured report. */
export function AgentCard({ drift: a, windows, single }: { drift: AgentDrift; windows: Record<string, number>; single: boolean }) {
  const v = driftVerdict(a);
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
        <Status tone={v.tone === "neutral" ? "neutral" : v.tone}>{v.label}</Status>
        <span className="min-w-0 text-[11.5px] text-dim">{v.detail}</span>
        <span className="grow" />
        <span className="text-[11px] text-faint">{windowsLine(a, windows)}</span>
        <Button size="sm" variant="solid" tone="neutral" href={`/dependencies?node=${encodeURIComponent(`agent:${a.agent}`)}`}>
          Dependencies
        </Button>
        <Button size="sm" variant="solid" tone="neutral" href={`/evals?agent=${encodeURIComponent(a.agent)}`}>
          Benchmark
        </Button>
      </div>
      {!a.enough ? (
        <p className="px-4 py-3 text-[12px] leading-[1.55] text-faint">Nothing is compared until both windows hold enough finished runs; the numbers above say how many each has and needs.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse text-[11.5px]">
            <thead>
              <tr className="border-b border-line bg-raise/40 text-left text-[10.5px] text-faint">
                <th className="px-4 py-1.5 font-medium">Measure</th>
                <th className="px-3 py-1.5 font-medium">Statistic</th>
                <th className="px-3 py-1.5 text-right font-medium">Value</th>
                <th className="px-3 py-1.5 font-medium">Threshold</th>
                <th className="px-3 py-1.5 font-medium">Recent</th>
                <th className="px-3 py-1.5 font-medium">Baseline</th>
                <th className="px-4 py-1.5 font-medium">Verdict</th>
              </tr>
            </thead>
            <tbody>
              {a.measures.map((m) => (
                <MeasureRow key={m.name} m={m} />
              ))}
            </tbody>
          </table>
          <p className="border-t border-line px-4 py-2 text-[10.5px] text-ghost">Disposition is read from {dispositionField(a)}.</p>
        </div>
      )}
    </section>
  );
}

function MeasureRow({ m }: { m: DriftMeasure }) {
  return (
    <tr className={`border-b border-line align-top last:border-0 ${m.drifted ? "bg-err-bg/30" : ""}`}>
      <td className="px-4 py-2">
        <span className="flex flex-col gap-0.5">
          <span className={`font-medium ${m.drifted ? "text-err" : "text-fg"}`}>{MEASURE_LABEL[m.name]}</span>
          <span className="max-w-[34ch] text-[10.5px] leading-[1.45] text-faint">{MEASURE_ASKS[m.name]}</span>
          {m.field && <span className="tnum font-mono text-[10px] text-ghost">field {m.field}</span>}
        </span>
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-dim">{STATISTIC_LABEL[m.statistic]}</td>
      <td className={`tnum px-3 py-2 text-right font-mono whitespace-nowrap ${m.drifted ? "font-semibold text-err" : "text-fg"}`}>{statText(m)}</td>
      <td className="px-3 py-2 whitespace-nowrap text-faint">{thresholdText(m)}</td>
      <td className="max-w-[260px] px-3 py-2 font-mono text-[10.5px] leading-[1.5] break-words text-dim">{sideText(m, m.recent)}</td>
      <td className="max-w-[260px] px-3 py-2 font-mono text-[10.5px] leading-[1.5] break-words text-dim">{sideText(m, m.baseline)}</td>
      <td className="px-4 py-2">
        <span className="flex flex-col gap-0.5">
          {!m.enough ? <Tag>not enough runs</Tag> : m.drifted ? <Tag tone="err" solid>drifted</Tag> : <Tag tone="ok">within</Tag>}
          <span className="max-w-[30ch] text-[10.5px] leading-[1.45] text-faint">{m.says}</span>
        </span>
      </td>
    </tr>
  );
}
