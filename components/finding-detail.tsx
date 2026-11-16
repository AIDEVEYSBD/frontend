"use client";

import type { ReactNode } from "react";
import { Status, type Tone } from "./ui";
import { count, shortWhen } from "./finding-marks";
import type { Finding } from "@/lib/api/pending";

/**
 * The part of a finding that differs by workload (features 11.2, 11.3).
 *
 * A static code analysis finding is a place in a file and a path to it; a
 * penetration test finding is a target and what was done to it; a firewall
 * finding is a rule and a proposed change; a threat hunt finding is a
 * hypothesis and what the telemetry said. Each reads `finding.detail`, every
 * member of which is optional, and shows only what is there: a field the run
 * did not record leaves no label behind. A workload this console does not
 * know falls back to the detail as keys and values. Nothing here is computed
 * or judged: the words are the record's.
 */

type Bag = Record<string, unknown>;

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bag = (v: unknown): Bag | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Bag) : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const texts = (v: unknown): string[] => list(v).map(text).filter(Boolean);
const words = (raw: string): string => {
  const s = raw.replace(/_/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "";
};

/* ── pieces ── */

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[11px] font-semibold text-dim">{title}</span>
      {children}
    </div>
  );
}

function Prose({ children }: { children: ReactNode }) {
  return <p className="max-w-[86ch] text-[12.5px] leading-[1.55] break-words whitespace-pre-wrap text-mist">{children}</p>;
}

/** Keys and values; a pair with no value is left out, and no pairs renders nothing. */
function Facts({ items }: { items: { k: string; v: ReactNode; mono?: boolean }[] }) {
  const shown = items.filter((x) => x.v !== "" && x.v !== null && x.v !== undefined && x.v !== false);
  if (!shown.length) return null;
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5">
      {shown.map((x) => (
        <div key={x.k} className="contents">
          <dt className="text-[11.5px] text-faint">{x.k}</dt>
          <dd className={`min-w-0 break-words text-fg ${x.mono ? "font-mono text-[11px] leading-[1.6]" : "text-[12.5px]"}`}>{x.v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="flex flex-col overflow-hidden rounded-md border border-line">
      {items.map((s, i) => (
        <li key={i} className="flex gap-3 border-b border-line px-3 py-1.5 last:border-b-0">
          <span className="tnum w-4 shrink-0 pt-px text-right font-mono text-[10.5px] text-faint">{i + 1}</span>
          <span className="min-w-0 grow text-[12px] leading-[1.55] break-words text-mist">{s}</span>
        </li>
      ))}
    </ol>
  );
}

/** A state the record names, as a word with its mark; a state outside the known ones is shown as it came. */
function Stated({ value, known }: { value: string; known: Record<string, { label: string; tone: Tone }> }) {
  const m = known[value] ?? { label: words(value), tone: "neutral" as Tone };
  return <Status tone={m.tone}>{m.label}</Status>;
}

/** Whatever of the detail the workload's own panel did not show, as keys and values. */
function Rest({ detail, shown, title }: { detail: Bag; shown: readonly string[]; title?: string }) {
  const keys = Object.keys(detail).filter((k) => !shown.includes(k) && detail[k] !== null && detail[k] !== undefined && detail[k] !== "");
  if (!keys.length) return null;
  const facts = (
    <Facts
      items={keys.map((k) => {
        const v = detail[k];
        const plain = typeof v === "string" || typeof v === "number" || typeof v === "boolean";
        return { k: words(k), v: plain ? String(v) : JSON.stringify(v, null, 1), mono: !plain };
      })}
    />
  );
  return title ? <Block title={title}>{facts}</Block> : facts;
}

/* ── static code analysis ── */

const VALIDATION: Record<string, { label: string; tone: Tone }> = {
  validated: { label: "Validated", tone: "ink" },
  not_reproduced: { label: "Not reproduced", tone: "neutral" },
  not_attempted: { label: "Not attempted", tone: "neutral" },
};

function lineRange(start: number | null, end: number | null): string {
  if (start === null) return "";
  return end !== null && end !== start ? `${start} to ${end}` : String(start);
}

function Snippet({ code, from }: { code: string; from: number | null }) {
  const lines = code.replace(/\n+$/, "").split("\n");
  return (
    <pre className="overflow-x-auto rounded-md border border-line bg-canvas py-2 font-mono text-[11px] leading-[1.6] text-mist">
      {lines.map((l, i) => (
        <span key={i} className="flex">
          {from !== null && <span className="tnum w-12 shrink-0 pr-3 text-right text-faint select-none">{from + i}</span>}
          <span className={`pr-3 whitespace-pre ${from === null ? "pl-3" : ""}`}>{l || " "}</span>
        </span>
      ))}
    </pre>
  );
}

const SAST_KEYS = ["file", "line_start", "line_end", "cwe", "rule", "snippet", "attack_path", "validation"] as const;

function Sast({ d }: { d: Bag }) {
  const start = num(d.line_start);
  const end = num(d.line_end);
  const snippet = typeof d.snippet === "string" ? d.snippet : "";
  const path = list(d.attack_path)
    .map(bag)
    .filter((s): s is Bag => !!s && Boolean(text(s.file) || text(s.note)));
  const v = bag(d.validation);
  return (
    <>
      <Facts
        items={[
          { k: "File", v: text(d.file), mono: true },
          { k: end !== null && end !== start ? "Lines" : "Line", v: lineRange(start, end) },
          { k: "CWE", v: text(d.cwe) },
          { k: "Rule", v: text(d.rule), mono: true },
        ]}
      />
      {snippet.trim() && (
        <Block title="Code">
          <Snippet code={snippet} from={start} />
        </Block>
      )}
      {path.length > 0 && (
        <Block title="Candidate attack path">
          <Steps
            items={path.map((s, i) => (
              <span key={i} className="flex flex-col gap-0.5">
                {text(s.file) && (
                  <span className="font-mono text-[10.5px] break-all text-dim">
                    {text(s.file)}
                    {num(s.line) !== null ? `:${num(s.line)}` : ""}
                  </span>
                )}
                {text(s.note) && <span>{text(s.note)}</span>}
              </span>
            ))}
          />
        </Block>
      )}
      {v && (text(v.state) || text(v.method) || text(v.note)) && (
        <Block title="Validation">
          <div className="flex flex-col gap-1.5">
            {text(v.state) && <Stated value={text(v.state)} known={VALIDATION} />}
            <Facts items={[{ k: "Method", v: text(v.method) }]} />
            {text(v.note) && <Prose>{text(v.note)}</Prose>}
          </div>
        </Block>
      )}
      <Rest detail={d} shown={SAST_KEYS} title="Other fields" />
    </>
  );
}

/* ── penetration testing ── */

const RETEST: Record<string, { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "warn" },
  passed: { label: "Passed", tone: "ok" },
  failed: { label: "Failed", tone: "err" },
};

const PENTEST_KEYS = ["target", "interface", "technique", "steps", "impact", "rollback", "retest"] as const;

function Pentest({ d }: { d: Bag }) {
  const steps = texts(d.steps);
  const retest = bag(d.retest);
  return (
    <>
      <Facts
        items={[
          { k: "Target", v: text(d.target), mono: true },
          { k: "Interface", v: text(d.interface) },
          { k: "Technique", v: text(d.technique) },
        ]}
      />
      {steps.length > 0 && (
        <Block title="Steps taken">
          <Steps items={steps} />
        </Block>
      )}
      {text(d.impact) && (
        <Block title="Impact">
          <Prose>{text(d.impact)}</Prose>
        </Block>
      )}
      {text(d.rollback) && (
        <Block title="Rollback guidance">
          <Prose>{text(d.rollback)}</Prose>
        </Block>
      )}
      {retest && (text(retest.state) || text(retest.at)) && (
        <Block title="Retest">
          <span className="flex flex-wrap items-center gap-2">
            {text(retest.state) && <Stated value={text(retest.state)} known={RETEST} />}
            {text(retest.at) && (
              <span className="tnum text-[11px] text-faint" title={text(retest.at)}>
                {shortWhen(text(retest.at))}
              </span>
            )}
          </span>
        </Block>
      )}
      <Rest detail={d} shown={PENTEST_KEYS} title="Other fields" />
    </>
  );
}

/* ── firewall rule review ── */

const FIREWALL_KEYS = ["rule_id", "device", "action", "source", "destination", "service", "usage", "risk", "proposal", "limitations"] as const;

function Firewall({ d }: { d: Bag }) {
  const usage = bag(d.usage);
  const hits = usage ? num(usage.hits) : null;
  const proposal = bag(d.proposal);
  const rule = [
    { k: "Rule", v: text(d.rule_id), mono: true },
    { k: "Device", v: text(d.device), mono: true },
    { k: "Action", v: text(d.action) },
    { k: "Source", v: text(d.source), mono: true },
    { k: "Destination", v: text(d.destination), mono: true },
    { k: "Service", v: text(d.service), mono: true },
  ];
  return (
    <>
      {rule.some((x) => x.v) && (
        <Block title="The rule">
          <Facts items={rule} />
        </Block>
      )}
      {usage && (hits !== null || text(usage.last_hit)) && (
        <Block title="Usage">
          <Facts
            items={[
              { k: "Hits", v: hits !== null ? count(hits) : "" },
              { k: "Last hit", v: text(usage.last_hit) ? <span title={text(usage.last_hit)}>{shortWhen(text(usage.last_hit))}</span> : "" },
            ]}
          />
        </Block>
      )}
      {text(d.risk) && (
        <Block title="Risk">
          <Prose>{text(d.risk)}</Prose>
        </Block>
      )}
      {proposal && (text(proposal.change) || text(proposal.expires) || text(proposal.rollback)) && (
        <Block title="Proposed change">
          <div className="flex flex-col gap-1.5">
            {text(proposal.change) && <Prose>{text(proposal.change)}</Prose>}
            <Facts
              items={[
                { k: "Expires", v: text(proposal.expires) ? <span title={text(proposal.expires)}>{shortWhen(text(proposal.expires))}</span> : "" },
                { k: "Rollback", v: text(proposal.rollback) },
              ]}
            />
          </div>
        </Block>
      )}
      {text(d.limitations) && (
        <Block title="Limitations stated">
          <Prose>{text(d.limitations)}</Prose>
        </Block>
      )}
      <Rest detail={d} shown={FIREWALL_KEYS} title="Other fields" />
    </>
  );
}

/* ── threat hunting ── */

const HUNT_KEYS = ["hypothesis", "verdict", "indicators", "telemetry", "coverage"] as const;

function ThreatHunt({ d }: { d: Bag }) {
  const indicators = texts(d.indicators);
  const telemetry = list(d.telemetry)
    .map(bag)
    .filter((t): t is Bag => !!t && Boolean(text(t.source)));
  return (
    <>
      {text(d.hypothesis) && (
        <Block title="Hypothesis">
          <Prose>{text(d.hypothesis)}</Prose>
        </Block>
      )}
      {text(d.verdict) && (
        <Block title="Verdict">
          <p className="text-[12.5px] leading-[1.55] font-medium break-words text-fg">{text(d.verdict)}</p>
        </Block>
      )}
      {indicators.length > 0 && (
        <Block title="Indicators">
          <ul className="flex flex-wrap gap-1.5">
            {indicators.map((x, i) => (
              <li key={`${x}-${i}`} className="max-w-full rounded-sm border border-line bg-raise px-1.5 py-0.5 font-mono text-[10.5px] break-all text-dim">
                {x}
              </li>
            ))}
          </ul>
        </Block>
      )}
      {telemetry.length > 0 && (
        <Block title="Telemetry consulted">
          <ul className="flex flex-col overflow-hidden rounded-md border border-line">
            {telemetry.map((t, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line px-3 py-1.5 last:border-b-0">
                <span className="text-[12px] font-medium break-words text-fg">{text(t.source)}</span>
                {text(t.window) && <span className="tnum text-[11px] text-faint">{text(t.window)}</span>}
              </li>
            ))}
          </ul>
        </Block>
      )}
      {text(d.coverage) && (
        <Block title="Coverage stated">
          <Prose>{text(d.coverage)}</Prose>
        </Block>
      )}
      <Rest detail={d} shown={HUNT_KEYS} title="Other fields" />
    </>
  );
}

/* ── the door other screens use ── */

const PANELS: Record<string, (p: { d: Bag }) => ReactNode> = {
  sast: Sast,
  pentest: Pentest,
  firewall: Firewall,
  threat_hunt: ThreatHunt,
};

/** Whether a finding carries anything this panel would show. */
export function hasFindingDetail(finding: Finding): boolean {
  const d = bag(finding.detail);
  return !!d && Object.values(d).some((v) => v !== null && v !== undefined && v !== "");
}

export function FindingDetail({ finding }: { finding: Finding }) {
  const d = bag(finding.detail);
  if (!d || !hasFindingDetail(finding)) return null;
  const Panel = PANELS[finding.workload];
  return (
    <div className="flex min-w-0 flex-col gap-4" data-finding-detail={finding.workload}>
      {Panel ? <Panel d={d} /> : <Rest detail={d} shown={[]} />}
    </div>
  );
}
