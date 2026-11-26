"use client";

import { useEffect, useMemo, useState } from "react";
import { Mono, Status, Tag, type Tone } from "./ui";
import { DigestChip } from "./digest-chip";
import { Skeleton } from "./loaders";
import { diffVersions, listVersions } from "@/lib/api/l2";
import { defaultPair, diffCounts, diffSections, versionRows, type DiffSection, type Op, type SpecDiff, type VersionList, type VersionStatus } from "@/lib/versions";

/**
 * A workflow's version history, and the difference between any two versions.
 *
 * Every save that changes what the agent runs is a version on the backend
 * (`GET /api/agents/{id}/versions`): who saved it, when, its digest, and
 * whether it is the one deployed, one deployed before, or a draft. Pick two
 * and the backend's comparison (`GET /api/agents/{id}/diff`) is read in the
 * spec's vocabulary by lib/versions.ts: nodes, edges and guards, tools,
 * grants, gates, budgets and policy, each added, removed or changed. A page
 * opens on what is deployed against the latest save.
 */

const STATUS_TONE: Record<VersionStatus, Tone> = { deployed: "ok", "deployed earlier": "neutral", draft: "queue" };
const OP_MARK: Record<Op, { mark: string; tone: string; word: string }> = {
  added: { mark: "+", tone: "text-ok", word: "added" },
  removed: { mark: "−", tone: "text-err", word: "removed" },
  changed: { mark: "~", tone: "text-warn", word: "changed" },
};

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "");

export function VersionHistory({ agent }: { agent: string }) {
  const [list, setList] = useState<VersionList | null>(null);
  const [error, setError] = useState("");
  const [pair, setPair] = useState<{ from: number; to: number } | null>(null);
  const [diff, setDiff] = useState<{ key: string; diff: SpecDiff | null; error: string } | null>(null);

  useEffect(() => {
    let stop = false;
    listVersions(agent)
      .then((l) => {
        if (stop) return;
        setList(l);
        setPair(defaultPair(l));
      })
      .catch((e: Error) => !stop && setError(e.message));
    return () => {
      stop = true;
    };
  }, [agent]);

  const key = pair ? `${pair.from}:${pair.to}` : "";
  useEffect(() => {
    if (!pair || pair.from === pair.to) return;
    let stop = false;
    diffVersions(agent, pair.from, pair.to)
      .then((d) => !stop && setDiff({ key: `${pair.from}:${pair.to}`, diff: d, error: "" }))
      .catch((e: Error) => !stop && setDiff({ key: `${pair.from}:${pair.to}`, diff: null, error: e.message }));
    return () => {
      stop = true;
    };
  }, [agent, pair]);

  const rows = useMemo(() => (list ? versionRows(list) : []), [list]);
  const shown = diff?.key === key ? diff : null;
  const sections = useMemo(() => (shown?.diff ? diffSections(shown.diff) : []), [shown]);

  const pick = (end: "from" | "to", version: number) => setPair((p) => (p ? { ...p, [end]: version } : { from: version, to: version }));

  if (error) return <p className="px-4 py-4 text-[12px] leading-[1.55] text-err">{error}</p>;
  if (!list) {
    return (
      <div className="px-4 py-4">
        <Skeleton lines={4} />
      </div>
    );
  }
  if (rows.length === 0) {
    return <p className="px-4 py-4 text-[12px] leading-[1.55] text-faint">No version on record yet.</p>;
  }

  return (
    <div className="flex flex-col">
      <p className="border-b border-line px-4 py-2.5 text-[11.5px] leading-[1.55] text-faint">
        {rows.length} version{rows.length === 1 ? "" : "s"}, newest first; pick from and to to compare.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[11.5px]">
          <thead>
            <tr className="border-b border-line text-left text-[10.5px] text-faint">
              <th className="w-9 px-2 py-2 text-center font-medium" title="Compare from this version">from</th>
              <th className="w-9 px-2 py-2 text-center font-medium" title="Compare to this version">to</th>
              <th className="px-3 py-2 font-medium">Version</th>
              <th className="px-3 py-2 font-medium">Saved by</th>
              <th className="px-3 py-2 font-medium">When</th>
              <th className="px-3 py-2 font-medium">Digest</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.version} className={`border-b border-line align-top last:border-0 ${pair && (pair.from === v.version || pair.to === v.version) ? "bg-raise/40" : ""}`}>
                <td className="px-2 py-2 text-center">
                  <PickDot on={pair?.from === v.version} label={`Compare from version ${v.version}`} onPick={() => pick("from", v.version)} />
                </td>
                <td className="px-2 py-2 text-center">
                  <PickDot on={pair?.to === v.version} label={`Compare to version ${v.version}`} onPick={() => pick("to", v.version)} />
                </td>
                <td className="px-3 py-2">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <Mono className="text-[11.5px] font-semibold text-fg">v{v.version}</Mono>
                    <Status tone={STATUS_TONE[v.status]}>{v.status}</Status>
                    {v.latest && <Tag>latest</Tag>}
                  </span>
                  <span className="block text-[10.5px] text-faint">
                    {v.name ? `${v.name} · ` : ""}
                    {v.nodes} node{v.nodes === 1 ? "" : "s"} · {v.tools.length} tool{v.tools.length === 1 ? "" : "s"}
                    {v.deployed_at ? ` · deployed ${when(v.deployed_at)}` : ""}
                    {v.sameAs !== null ? ` · runs the same as v${v.sameAs}` : ""}
                  </span>
                </td>
                <td className="px-3 py-2 text-dim">{v.saved_by || <span className="text-ghost">not recorded</span>}</td>
                <td className="px-3 py-2 whitespace-nowrap text-dim">{when(v.saved_at)}</td>
                <td className="px-3 py-2">
                  <DigestChip digest={v.digest} label={`Version ${v.version} digest`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-line">
        {!pair && <p className="px-4 py-3 text-[11.5px] text-faint">One version so far: nothing to compare it with.</p>}
        {pair && pair.from === pair.to && <p className="px-4 py-3 text-[11.5px] text-faint">Pick two different versions to compare.</p>}
        {pair && pair.from !== pair.to && <DiffView from={pair.from} to={pair.to} shown={shown} sections={sections} />}
      </div>
    </div>
  );
}

/** One end of the comparison, in the house radio's look (components/forms.tsx Radio). */
function PickDot({ on, label, onPick }: { on: boolean; label: string; onPick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      aria-label={label}
      title={label}
      onClick={onPick}
      className={`focusable mx-auto grid size-4 cursor-pointer place-items-center rounded-full border transition-all duration-100 ${on ? "border-ink" : "border-line-strong bg-field"}`}
    >
      {on && <span className="size-2 rounded-full bg-ink" />}
    </button>
  );
}

function DiffView({ from, to, shown, sections }: { from: number; to: number; shown: { diff: SpecDiff | null; error: string } | null; sections: DiffSection[] }) {
  return <SpecDiffView fromLabel={`v${from}`} toLabel={`v${to}`} fromDigestLabel={`Version ${from} digest`} toDigestLabel={`Version ${to} digest`} shown={shown} sections={sections} />;
}

/**
 * A spec-vocabulary diff (`SpecDiff`, lib/versions.ts diffSections), between
 * any two documents: two versions here, a template and the agent cut from
 * it on the lifecycle page (the lineage's drift). `shown` null reads as
 * loading. A diff whose digests match says nothing that runs changed; one
 * whose digests differ with nothing named says `quietNote`.
 */
export function SpecDiffView({
  fromLabel,
  toLabel,
  fromDigestLabel,
  toDigestLabel,
  shown,
  sections,
  quietNote = "Digests differ; nothing the comparison names moved.",
}: {
  fromLabel: string;
  toLabel: string;
  fromDigestLabel?: string;
  toDigestLabel?: string;
  shown: { diff: SpecDiff | null; error: string } | null;
  sections: DiffSection[];
  quietNote?: string;
}) {
  const counts = diffCounts(sections);
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-raise/55 px-4 py-2.5">
        <span className="text-[12.5px] font-semibold">
          {fromLabel} → {toLabel}
        </span>
        {shown?.diff && !shown.diff.same && (
          <span className="flex items-center gap-2 text-[11px]">
            <span className="text-ok">{counts.added} added</span>
            <span className="text-err">{counts.removed} removed</span>
            <span className="text-warn">{counts.changed} changed</span>
          </span>
        )}
        <span className="grow" />
        {shown?.diff && (
          <span className="flex items-center gap-1.5 text-[10.5px] text-faint">
            <DigestChip digest={shown.diff.from.digest} label={fromDigestLabel ?? `${fromLabel} digest`} />
            <span>→</span>
            <DigestChip digest={shown.diff.to.digest} label={toDigestLabel ?? `${toLabel} digest`} />
          </span>
        )}
      </div>
      {!shown && (
        <div className="px-4 py-3">
          <Skeleton lines={3} />
        </div>
      )}
      {shown?.error && <p className="px-4 py-3 text-[11.5px] leading-[1.55] text-err">{shown.error}</p>}
      {shown?.diff?.same && (
        <p className="px-4 py-3 text-[11.5px] leading-[1.55] text-faint">Same digest: nothing that runs changed.</p>
      )}
      {shown?.diff && !shown.diff.same && sections.length === 0 && <p className="px-4 py-3 text-[11.5px] leading-[1.55] text-faint">{quietNote}</p>}
      {sections.map((s) => (
        <section key={s.id} className="border-t border-line px-4 py-2.5">
          <span className="text-[11px] font-semibold text-dim">{s.title}</span>
          <ul className="mt-1 flex flex-col gap-1">
            {s.lines.map((l, i) => (
              <li key={`${s.id}-${i}`} className="flex min-w-0 items-baseline gap-2 text-[11.5px] leading-[1.5]">
                <span className={`w-3 shrink-0 text-center font-mono font-semibold ${OP_MARK[l.op].tone}`} aria-label={OP_MARK[l.op].word}>
                  {OP_MARK[l.op].mark}
                </span>
                <span className="min-w-0">
                  <span className="font-medium text-fg">{l.subject}</span>
                  <span className="text-faint"> · {OP_MARK[l.op].word}</span>
                  {l.detail && <span className="text-mist"> · {l.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
