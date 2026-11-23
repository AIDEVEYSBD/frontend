"use client";

import { useState, type ReactNode } from "react";
import { Button, Mono, Status, Tag } from "./ui";
import { SafeLink } from "./safe-link";

/**
 * A retrieval call, as a reviewer reads one: which sources were consulted
 * (each one that answered, with its hits, and each that failed, with why),
 * and the passages that came back, each with its score and where it came
 * from. The shape is the retrieval tool's own result
 * (`runtime/agentfactory/retrieval.py`: `{query, results, consulted}`).
 * A screening verdict is shown beside a passage only when the entry carries
 * one; nothing is inferred from its absence.
 */

type Rec = Record<string, unknown>;
const obj = (v: unknown): Rec => (v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export interface Consulted {
  source: string;
  kind: string;
  ok: boolean;
  hits: number | null;
  error: string;
}

export interface Verdict {
  /** What the screener did or said: `allow`, `block`, `flag`, or its own word. */
  action: string;
  control: string;
  reasons: string[];
}

export interface Passage {
  id: string;
  title: string;
  excerpt: string;
  /** 0 to 1 within its source, weighted by the source's weight. */
  score: number | null;
  source: string;
  origin: string;
  verdict: Verdict | null;
}

export interface Retrieval {
  query: string;
  consulted: Consulted[];
  passages: Passage[];
  images: number;
}

function verdictOf(v: unknown): Verdict | null {
  if (typeof v === "string" && v) return { action: v, control: "", reasons: [] };
  const o = obj(v);
  const action = str(o.action) || str(o.verdict) || str(o.decision);
  if (!action) return null;
  return { action, control: str(o.control), reasons: Array.isArray(o.reasons) ? o.reasons.map(String) : str(o.reason) ? [str(o.reason)] : [] };
}

/**
 * The retrieval a tool result describes, or null when it describes none: the
 * tool is one of `retrieval.*` and the value carries the sources consulted
 * or a list of passages. A value may arrive as the JSON text of one.
 */
export function retrievalOf(tool: string, value: unknown): Retrieval | null {
  if (!tool.startsWith("retrieval.")) return null;
  let v = value;
  if (typeof v === "string" && v.trim().startsWith("{")) {
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  const o = obj(v);
  if (!Array.isArray(o.consulted) && !Array.isArray(o.results)) return null;
  // Verdicts the entry may carry beside the passages, keyed by passage id.
  const beside = new Map<string, Verdict>();
  for (const key of ["screening", "verdicts"]) {
    if (!Array.isArray(o[key])) continue;
    for (const x of o[key] as unknown[]) {
      const verdict = verdictOf(x);
      const id = str(obj(x).id);
      if (verdict && id) beside.set(id, verdict);
    }
  }
  return {
    query: str(o.query),
    consulted: (Array.isArray(o.consulted) ? o.consulted : []).map((c) => {
      const x = obj(c);
      return { source: str(x.source), kind: str(x.kind), ok: x.ok === true, hits: num(x.hits), error: str(x.error) };
    }),
    passages: (Array.isArray(o.results) ? o.results : []).map((r) => {
      const x = obj(r);
      const id = str(x.id);
      return {
        id,
        title: str(x.title),
        excerpt: str(x.excerpt),
        score: num(x.score),
        source: str(x.source),
        origin: str(x.origin),
        verdict: verdictOf(x.screening) ?? verdictOf(x.verdict) ?? beside.get(id) ?? null,
      };
    }),
    images: Array.isArray(o.images) ? o.images.length : 0,
  };
}

/** One line over a retrieval, for a collapsed row: `9 passages · news ok (9)`. */
export function retrievalLine(r: Retrieval): string {
  const sources = r.consulted.map((c) => (c.ok ? `${c.source} ok${c.hits !== null ? ` (${c.hits})` : ""}` : `${c.source} failed`));
  return [`${r.passages.length} passage${r.passages.length === 1 ? "" : "s"}`, ...sources].join(" · ");
}

const flat = (s: string) => s.replace(/\s+/g, " ").trim();
// A web address is offered as a link through lib/safe-link.ts (https only); any other origin (an upload, a corpus) is text.
const isWeb = (s: string) => /^https?:\/\//i.test(s);
const verdictTone = (a: string) => (/block|refus|deny|reject|withh/i.test(a) ? "err" : /flag|warn|redact/i.test(a) ? "warn" : "ok");

/** Sources and passages, without a frame: the body of the card, and of a retrieval row anywhere else. */
export function RetrievalBody({ r, initial = 3 }: { r: Retrieval; initial?: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? r.passages : r.passages.slice(0, initial);
  const screened = r.passages.some((p) => p.verdict);
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-col gap-1">
        <span className="text-[10.5px] font-medium text-faint">Sources consulted</span>
        {r.consulted.length === 0 ? (
          <span className="text-[11.5px] text-faint">The result does not say which sources were consulted.</span>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {r.consulted.map((c, i) => (
              <li key={`${c.source}-${i}`} className="flex flex-wrap items-baseline gap-x-2 text-[11.5px]">
                <Status tone={c.ok ? "ok" : "err"}>{c.ok ? "ok" : "failed"}</Status>
                <span className="font-mono text-[11px] text-fg">{c.source || "unnamed source"}</span>
                {c.kind && <span className="text-[10.5px] text-faint">{c.kind}</span>}
                {c.ok ? (
                  <span className="tnum text-dim">{c.hits === null ? "hits not recorded" : `${c.hits} hit${c.hits === 1 ? "" : "s"}`}</span>
                ) : (
                  <span className="min-w-0 break-words text-err">{c.error || "no reason recorded"}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-[10.5px] font-medium text-faint">
          Passages returned <span className="tnum">({r.passages.length})</span>
          {r.images > 0 && <span className="font-normal"> · {r.images} image{r.images === 1 ? "" : "s"} beside them</span>}
        </span>
        {r.passages.length === 0 ? (
          <span className="text-[11.5px] text-faint">No passage came back.</span>
        ) : (
          <ol className="flex flex-col divide-y divide-line/70 overflow-hidden rounded-md border border-line bg-surface">
            {shown.map((p, i) => (
              <li key={`${p.id}-${i}`} className="flex gap-2.5 px-2.5 py-1.5">
                <span className="tnum w-9 shrink-0 pt-px text-right font-mono text-[11px] text-fg" title="Score: 0 to 1 within its source, weighted by the source">
                  {p.score === null ? "—" : p.score.toFixed(2)}
                </span>
                <span className="flex min-w-0 grow flex-col gap-0.5">
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                    <span className="min-w-0 truncate text-[12px] font-medium text-fg">{p.title || p.id || "untitled"}</span>
                    {p.source && <Tag>{p.source}</Tag>}
                    {p.verdict && (
                      <span title={[p.verdict.control, ...p.verdict.reasons].filter(Boolean).join(" · ") || undefined} className="inline-flex">
                        <Tag tone={verdictTone(p.verdict.action)}>screened: {p.verdict.action}</Tag>
                      </span>
                    )}
                  </span>
                  {p.origin &&
                    (isWeb(p.origin) ? (
                      <SafeLink href={p.origin} className="focusable min-w-0 truncate rounded-sm font-mono text-[10px] text-dim hover:underline">
                        {p.origin}
                      </SafeLink>
                    ) : (
                      <span className="min-w-0 truncate font-mono text-[10px] text-dim">{p.origin}</span>
                    ))}
                  {p.excerpt && <span className="line-clamp-2 text-[11.5px] leading-[1.5] text-mist">{flat(p.excerpt)}</span>}
                  {p.verdict && p.verdict.reasons.length > 0 && <span className="text-[10.5px] text-faint">{p.verdict.reasons.join("; ")}</span>}
                </span>
              </li>
            ))}
          </ol>
        )}
        {r.passages.length > initial && (
          <Button size="sm" variant="quiet" className="self-start" onClick={() => setAll(!all)}>
            {all ? "show fewer" : `show all ${r.passages.length}`}
          </Button>
        )}
        {!screened && r.passages.length > 0 && <span className="text-[10px] text-faint">This entry carries no screening verdict for its passages.</span>}
      </div>
    </div>
  );
}

/** The card a retrieval call takes in the activity list, in place of the generic tool card. */
export function RetrievalCard({
  tool,
  r,
  tainted,
  raw,
  actions,
  startOpen = false,
}: {
  tool: string;
  r: Retrieval;
  /** The result was marked untrusted: content authored outside the system. */
  tainted: boolean;
  /** The exact request and response, behind a click. */
  raw: ReactNode;
  actions?: ReactNode;
  startOpen?: boolean;
}) {
  const [showRaw, setShowRaw] = useState(startOpen);
  const failed = r.consulted.filter((c) => !c.ok).length;
  return (
    <div className="min-w-0 grow rounded-md border border-line bg-raise">
      <div className="flex flex-col gap-0.5 border-b border-line px-3 py-2">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Mono className="text-[11.5px] text-mist">{tool}</Mono>
          <span className="text-[10.5px] font-medium text-c2">retrieval</span>
          {tainted && <Tag tone="warn">untrusted content</Tag>}
          <span className="grow" />
          {failed > 0 && <Status tone="err">{failed} source{failed === 1 ? "" : "s"} failed</Status>}
          <Mono className="text-[10.5px] text-ok">returned</Mono>
        </span>
        {r.query && (
          <span className="text-[12px] leading-[1.5] text-fg">
            <span className="text-faint">asked: </span>
            {r.query}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2 px-3 py-2.5">
        <RetrievalBody r={r} />
        <span className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="quiet" onClick={() => setShowRaw(!showRaw)}>
            {showRaw ? "hide request and response" : "view request and response"}
          </Button>
          {actions}
        </span>
        {showRaw && <div className="flex flex-col gap-2">{raw}</div>}
      </div>
    </div>
  );
}
