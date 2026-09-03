import { Button, Label, Mono, Status, Tag, Meter } from "./ui";
import { FilterMenu, ActionMenu } from "./dropdown";
import { Segmented, Select } from "./forms";
import { Sparkline, Delta } from "./data";
import { CAT, Donut, Heatmap, LineChart, RankBar, StackedBar } from "./charts";
import { DataTable } from "./table";

/* ═══════════════════ Shared chrome ═══════════════════ */

/**
 * Panel header for a dense grid. Title, an optional qualifier, and the
 * actions — all on one 34px row, because a stack of headers eats the
 * vertical budget a dashboard needs for data.
 */
function PanelHead({
  title,
  meta,
  action,
}: {
  title: string;
  meta?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line bg-raise/55 px-3">
      <span className="text-[12px] font-semibold tracking-[-0.005em]">{title}</span>
      {meta && <span className="truncate text-[11px] text-faint">{meta}</span>}
      <div className="grow" />
      {action}
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  delta,
  invert,
  spark,
  tone = "ink",
  sub,
}: {
  label: string;
  value: string;
  unit?: string;
  delta?: number;
  invert?: boolean;
  spark?: number[];
  tone?: "ink" | "ok" | "warn" | "err" | "queue" | "run";
  sub?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5 border-r border-line px-3.5 py-3 last:border-r-0">
      <span className="truncate text-[11px] text-faint">{label}</span>
      <div className="flex items-baseline gap-1.5">
        <span className="tnum text-[21px] leading-none font-semibold tracking-[-0.02em]">
          {value}
        </span>
        {unit && <span className="text-[12px] text-dim">{unit}</span>}
        {delta !== undefined && <Delta value={delta} invert={invert} />}
      </div>
      <div className="flex items-center justify-between gap-2">
        {sub && <span className="truncate text-[10.5px] text-ghost">{sub}</span>}
        {spark && <Sparkline points={spark} tone={tone} width={64} height={18} area={false} />}
      </div>
    </div>
  );
}

/* ═══════════════════ Operations control room ═══════════════════ */

const FACETS = [
  { name: "Engagement", items: [["Meridian Bank DLP", 412], ["Nordic Energy NIST", 188], ["Halden Group TPRM", 96], ["Atlas Health Resilience", 74]] },
  { name: "Harness", items: [["extraction", 318], ["decision", 261], ["drafting", 154], ["review", 137]] },
];

export function OperationsDashboard() {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/55 px-3 py-2">
        <div className="flex items-center gap-1.5 text-[12px]">
          <span className="text-faint">Advisory</span>
          <span className="text-ghost">/</span>
          <span className="font-medium">Operations</span>
        </div>
        <Tag tone="ok" solid>
          live
        </Tag>
        <div className="grow" />
        <Segmented options={["1h", "24h", "7d", "30d"]} defaultValue="7d" />
        <FilterMenu
          label="Engagement"
          options={["Meridian Bank DLP", "Nordic Energy NIST", "Halden Group TPRM", "Atlas Health Resilience"]}
          defaultSelected={["Meridian Bank DLP"]}
        />
        <div className="w-[160px]">
          <Select options={["All regions", "EMEA", "AMER", "APAC"]} aria-label="Region" />
        </div>
        <Button size="sm" variant="outline">
          Export
        </Button>
        <Button size="sm" tone="ink" variant="solid">
          New run
        </Button>
      </div>

      <div className="flex min-h-0">
        {/* Facet rail */}
        <aside className="hidden w-[188px] shrink-0 flex-col gap-4 border-r border-line bg-raise/55 p-3 xl:flex">
          <div className="flex flex-col gap-1.5">
            <Label>Saved views</Label>
            {["My engagements", "Escalations only", "Cost outliers"].map((v, i) => (
              <button
                key={v}
                type="button"
                className={`focusable truncate rounded-sm px-2 py-1 text-left text-[12px] transition-colors ${
                  i === 0 ? "bg-raise font-medium text-fg" : "text-dim hover:bg-raise"
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          {FACETS.map((f) => (
            <div key={f.name} className="flex flex-col gap-1.5">
              <Label>{f.name}</Label>
              {f.items.map(([n, c], i) => (
                <button
                  key={n as string}
                  type="button"
                  className="focusable group flex items-center gap-2 rounded-sm px-2 py-1 text-left transition-colors hover:bg-raise"
                >
                  <span
                    className="size-2 shrink-0 rounded-[2px]"
                    style={{ background: CAT[i + (f.name === "Harness" ? 4 : 0)] }}
                  />
                  <span className="grow truncate text-[12px] text-dim group-hover:text-fg">
                    {n}
                  </span>
                  <span className="tnum font-mono text-[10.5px] text-ghost">{c}</span>
                </button>
              ))}
            </div>
          ))}
        </aside>

        {/* Panels */}
        <div className="flex min-w-0 grow flex-col">
          {/* Stat strip — one row, not four floating cards */}
          <div className="grid grid-cols-2 border-b border-line sm:grid-cols-3 xl:grid-cols-6">
            <Stat label="Runs" value="1,284" delta={18} spark={[42, 51, 47, 62, 58, 74, 96]} sub="7d" />
            <Stat label="Resolved" value="87.2" unit="%" delta={4} tone="ok" spark={[81, 82, 84, 83, 86, 86, 87]} sub="target 85%" />
            <Stat label="Escalated" value="164" delta={-9} invert tone="warn" spark={[31, 28, 26, 24, 22, 19, 17]} sub="12.8% of runs" />
            <Stat label="Failed" value="12" delta={-22} invert tone="err" sub="0.9% of runs" />
            <Stat label="p50 latency" value="5.02" unit="m" delta={-6} invert tone="queue" spark={[7.1, 6.8, 6.4, 6, 5.6, 5.2, 5] } sub="p95 14.8m" />
            <Stat label="Spend" value="1,361" unit="$" delta={11} sub="$1.06 / resolution" />
          </div>

          {/* Chart grid */}
          <div className="grid grid-cols-1 border-b border-line lg:grid-cols-[1.5fr_1fr]">
            <div className="flex flex-col border-b border-line lg:border-r lg:border-b-0">
              <PanelHead
                title="Volume & outcome"
                meta="runs per day"
                action={<ActionMenu items={[{ label: "Export CSV" }, { label: "Add to report" }]} />}
              />
              <div className="p-3">
                <LineChart
                  labels={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]}
                  series={[
                    { name: "Resolved", data: [148, 162, 155, 178, 191, 104, 86], color: CAT[3] },
                    { name: "Escalated", data: [22, 19, 31, 24, 28, 11, 9], color: CAT[6] },
                    { name: "Failed", data: [3, 2, 5, 2, 4, 1, 1], color: CAT[7] },
                    { name: "Forecast", data: [150, 158, 164, 172, 185, 110, 92], color: CAT[1], dashed: true },
                  ]}
                />
              </div>
            </div>

            <div className="flex flex-col">
              <PanelHead title="Outcome mix" meta="7d" />
              <div className="p-3">
                <Donut
                  data={[
                    { label: "Auto-resolved", value: 1108, color: CAT[3] },
                    { label: "Escalated", value: 164, color: CAT[6] },
                    { label: "Failed", value: 12, color: CAT[7] },
                  ]}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 border-b border-line lg:grid-cols-3">
            <div className="flex flex-col border-b border-line lg:border-r lg:border-b-0">
              <PanelHead title="Harness load" meta="invocations" />
              <div className="p-3">
                <StackedBar
                  keys={["extraction", "decision", "drafting", "review"]}
                  colors={[CAT[1], CAT[5], CAT[2], CAT[3]]}
                  data={[
                    { label: "Mon", values: [62, 48, 30, 26] },
                    { label: "Tue", values: [71, 52, 34, 29] },
                    { label: "Wed", values: [66, 55, 31, 27] },
                    { label: "Thu", values: [78, 61, 38, 32] },
                    { label: "Fri", values: [84, 66, 41, 35] },
                  ]}
                />
              </div>
            </div>

            <div className="flex flex-col border-b border-line lg:border-r lg:border-b-0">
              <PanelHead title="Top escalation reasons" meta="164 total" />
              <div className="px-3 py-2">
                <RankBar
                  data={[
                    { label: "Confidence below gate", value: 61, color: CAT[6], meta: "61" },
                    { label: "Conflicting clauses", value: 38, color: CAT[5], meta: "38" },
                    { label: "Missing document", value: 27, color: CAT[1], meta: "27" },
                    { label: "Policy lapsed", value: 21, color: CAT[8], meta: "21" },
                    { label: "Tool timeout", value: 17, color: CAT[7], meta: "17" },
                  ]}
                />
              </div>
            </div>

            <div className="flex flex-col">
              <PanelHead title="Load by hour" meta="UTC" />
              <div className="p-3">
                <Heatmap
                  rows={["Mon", "Tue", "Wed", "Thu", "Fri"]}
                  cols={["00", "02", "04", "06", "08", "10", "12", "14", "16", "18", "20", "22"]}
                  values={[
                    [2, 1, 1, 4, 18, 32, 41, 38, 29, 12, 5, 3],
                    [1, 1, 2, 6, 22, 36, 44, 41, 31, 14, 6, 2],
                    [2, 2, 1, 5, 20, 34, 39, 44, 33, 15, 7, 3],
                    [3, 1, 2, 7, 25, 41, 48, 46, 35, 16, 8, 4],
                    [2, 2, 3, 8, 27, 44, 52, 49, 38, 19, 9, 5],
                  ]}
                />
              </div>
            </div>
          </div>

          {/* SLA + queue */}
          <div className="grid grid-cols-1 border-b border-line lg:grid-cols-[1fr_1fr]">
            <div className="flex flex-col border-b border-line lg:border-r lg:border-b-0">
              <PanelHead title="Service levels" meta="rolling 30d" />
              <div className="flex flex-col divide-y divide-line">
                {[
                  { n: "First response < 2m", v: 0.982, t: "98.2%", ok: true },
                  { n: "Resolution < 15m", v: 0.941, t: "94.1%", ok: true },
                  { n: "Escalation ack < 1h", v: 0.876, t: "87.6%", ok: false },
                  { n: "Audit trail complete", v: 1, t: "100%", ok: true },
                ].map((s) => (
                  <div key={s.n} className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2.5">
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <span className="truncate text-[12px] text-mist">{s.n}</span>
                      <Meter value={s.v} tone={s.ok ? "ok" : "warn"} />
                    </div>
                    <span className="flex items-center gap-2">
                      <span className={`tnum font-mono text-[11.5px] ${s.ok ? "text-ok" : "text-warn"}`}>
                        {s.t}
                      </span>
                      <Status tone={s.ok ? "ok" : "warn"}>{s.ok ? "met" : "missed"}</Status>
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col">
              <PanelHead
                title="Awaiting you"
                meta="3 items"
                action={
                  <Button size="sm" variant="quiet">
                    Review all
                  </Button>
                }
              />
              <div className="flex flex-col divide-y divide-line">
                {[
                  { s: "CL-88209 · M. Okafor", w: "Coverage denial", c: "0.71", age: "18m" },
                  { s: "Nordic Energy — pricing", w: "Partner sign-off", c: "0.78", age: "42m" },
                  { s: "CL-88176 · A. Bianchi", w: "Exclusion applied", c: "0.69", age: "1h 04m" },
                ].map((r) => (
                  <div
                    key={r.s}
                    className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-raise"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate text-[12.5px] font-medium">{r.s}</span>
                      <span className="truncate text-[11px] text-faint">{r.w}</span>
                    </div>
                    <span className="tnum font-mono text-[11.5px] text-warn">{r.c}</span>
                    <span className="tnum w-14 text-right font-mono text-[11px] text-ghost">
                      {r.age}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Detail table */}
          <div className="p-3">
            <DataTable />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════ Engagement view ═══════════════════ */

export function EngagementDashboard() {
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <span className="text-[13px] font-semibold tracking-[-0.01em]">Meridian Bank DLP</span>
        <Tag tone="ok" solid>
          deployed
        </Tag>
        <Mono className="text-[11px] text-faint">v12 · 2h ago</Mono>
        <div className="grow" />
        <Button size="sm" variant="outline">
          Run evals
        </Button>
        <Button size="sm" tone="ink" variant="solid">
          Deploy
        </Button>
      </div>

      <div className="grid grid-cols-2 border-b border-line md:grid-cols-4">
        <Stat label="In flight" value="12" tone="run" sub="4 near gate" />
        <Stat label="Awaiting approval" value="3" tone="warn" sub="oldest 1h 04m" />
        <Stat label="Completed today" value="214" delta={9} tone="ok" spark={[142, 158, 171, 166, 189, 203, 214]} />
        <Stat label="Failed today" value="2" delta={-40} invert tone="err" sub="both tool timeouts" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr]">
        <div className="flex flex-col border-b border-line lg:border-r lg:border-b-0">
          <PanelHead title="Harness performance" meta="pass rate, 14d" />
          <div className="flex flex-col divide-y divide-line">
            {[
              { n: "Document extraction", k: "extraction", p: 0.964, s: [92, 93, 95, 94, 96, 96, 96], c: CAT[1] },
              { n: "Rule decision", k: "decision", p: 0.941, s: [90, 91, 92, 93, 93, 94, 94], c: CAT[5] },
              { n: "Document drafting", k: "drafting", p: 0.893, s: [86, 87, 86, 88, 89, 89, 89], c: CAT[2] },
              { n: "Compliance review", k: "review", p: 0.986, s: [97, 98, 98, 98, 99, 99, 99], c: CAT[3] },
            ].map((h) => (
              <div key={h.n} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="size-2 shrink-0 rounded-[2px]" style={{ background: h.c }} />
                  <span className="truncate text-[12.5px]">{h.n}</span>
                </div>
                <Sparkline points={h.s} width={68} height={20} area={false} tone="ok" />
                <span className="tnum w-12 text-right font-mono text-[11.5px] text-dim">
                  {(h.p * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col">
          <PanelHead title="Live now" meta="12 active" action={<Status tone="run">running</Status>} />
          <div className="flex flex-col divide-y divide-line">
            {[
              { id: "4128", s: "CL-88213 · R. Alvarez", step: "Validate coverage", t: "04:12", p: 0.43 },
              { id: "4126", s: "Nordic Energy — audit", step: "Draft sections", t: "12:08", p: 0.75 },
              { id: "4131", s: "CL-88221 · P. Novak", step: "Extract", t: "00:38", p: 0.12 },
              { id: "4132", s: "CL-88224 · L. Meyer", step: "Compliance review", t: "02:51", p: 0.88 },
            ].map((r) => (
              <div
                key={r.id}
                className="grid grid-cols-[46px_1fr_72px_46px] items-center gap-2.5 px-3 py-2.5 transition-colors hover:bg-raise"
              >
                <Mono className="text-[11px] text-faint">{r.id}</Mono>
                <div className="flex min-w-0 flex-col gap-1">
                  <span className="truncate text-[12.5px]">{r.s}</span>
                  <span className="truncate text-[10.5px] text-faint">{r.step}</span>
                </div>
                <Meter value={r.p} tone="run" />
                <span className="tnum text-right font-mono text-[11px] text-faint">{r.t}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
