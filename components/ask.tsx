"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Status } from "./ui";
import { Markdown } from "./markdown";
import { AssistantChart, ChartDrawing, parseChart } from "./assistant-charts";

/**
 * Ask the corpus.
 *
 * Two ways in. Search runs the retrieval pipeline and shows the passages.
 * Answer runs the whole loop the answer route runs (retrieve, judge the
 * evidence, rewrite and retry, answer from the passages, check the
 * grounding) and shows the answer with every claim cited to the passage it
 * came from, the attempts it took, and what the grounding check said about
 * each cited sentence. A citation is hoverable (the passage and its source)
 * and clickable (the document, opened at that passage).
 *
 * The panel shows what was done and what came back. It says nothing about
 * what that guarantees.
 */

export interface Hit {
  id: string;
  documentId: string;
  source: string;
  title: string;
  heading: string;
  url: string;
  similarity: number | null;
  denseRank: number | null;
  lexicalRank: number | null;
  score: number;
  relevance: number | null;
  meta: { refs?: Record<string, string[]> };
  body: string;
}

interface Stages { stages: Record<string, number>; timings: Record<string, number>; rerankModel: string | null; rerankKind: string | null }

export interface Citation {
  n: number;
  id: string;
  documentId: string;
  source: string;
  publisher: string;
  title: string;
  heading: string;
  url: string;
  ordinal: number;
  relevance: number | null;
  body: string;
  used: boolean;
}
interface Attempt { n: number; queries: string[]; reason: string; hits: number; top: number | null; strong: number; verdict: "enough" | "retry" | "exhausted"; missing?: string; ms: number }
interface Verdict { sentence: string; cites: number[]; supported: boolean; note: string }
export interface Answer {
  question: string;
  answer: string;
  covered?: boolean;
  gap?: string;
  citations: Citation[];
  grounding: { rounds: number; checked: number; supported: number; unsupported: number; verdicts: Verdict[] } | null;
  attempts: Attempt[];
  verdict: string;
  models: { rerank: string | null; answer: string; judge: string };
  tokens: { in: number; out: number };
  ms: number;
  note?: string;
}

const STAGE_LABEL: Record<string, string> = {
  retrieve: "Retrieving",
  assess: "Judging the evidence",
  rewrite: "Rewriting the query",
  outline: "Reading the document outline",
  answer: "Answering from the passages",
  "rewrite-answer": "Rewriting unsupported sentences",
  ground: "Checking grounding",
};

export function AskCorpus({
  onLocate,
  onResult,
}: {
  /** Open a document at a passage. */
  onLocate: (documentId: string, body: string) => void;
  /** What the page should tell the assistant about the last thing asked. */
  onResult?: (facts: Record<string, unknown> | null) => void;
}) {
  const [probe, setProbe] = useState("");
  const [mode, setMode] = useState<"search" | "answer" | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [stages, setStages] = useState<Stages | null>(null);
  const [live, setLive] = useState<{ stage: string; attempt?: number; queries?: string[] }[]>([]);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const search = async () => {
    if (!probe.trim()) return;
    setBusy(true);
    setMode("search");
    setHits(null);
    setStages(null);
    setAnswer(null);
    setNotice(null);
    try {
      const res = await fetch("/api/knowledge/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: probe, limit: 6 }) });
      const d = await res.json();
      if (d.error) setNotice(d.error);
      else {
        setHits(d.hits ?? []);
        setStages({ stages: d.stages, timings: d.timings, rerankModel: d.rerankModel, rerankKind: d.rerankKind });
        if (!(d.hits ?? []).length) setNotice(d.note ?? "Nothing in the corpus answers that.");
        onResult?.({ mode: "search", query: probe, stages: d.stages, hits: (d.hits ?? []).map((h: Hit) => h.source) });
      }
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ask = async () => {
    if (!probe.trim()) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    setMode("answer");
    setHits(null);
    setStages(null);
    setAnswer(null);
    setNotice(null);
    setLive([]);
    setShowEvidence(false);
    try {
      const res = await fetch("/api/knowledge/answer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: probe }), signal: ctl.signal });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = frame.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          const e = JSON.parse(line.slice(6));
          if (e.type === "stage") setLive((l) => [...l, { stage: e.stage, attempt: e.attempt, queries: e.queries }]);
          else if (e.type === "error") setNotice(e.error);
          else if (e.type === "done") {
            setAnswer(e as Answer);
            if (e.note) setNotice(e.note);
            onResult?.({
              mode: "answer",
              question: probe,
              attempts: (e.attempts as Attempt[]).map((a) => ({ n: a.n, queries: a.queries, strong: a.strong, verdict: a.verdict })),
              answer: String(e.answer ?? "").slice(0, 1200),
              citationsUsed: (e.citations as Citation[]).filter((c) => c.used).map((c) => `[${c.n}] ${c.source}${c.heading ? ` › ${c.heading}` : ""}`),
              grounding: e.grounding ? { checked: e.grounding.checked, supported: e.grounding.supported, unsupported: e.grounding.unsupported } : null,
              ms: e.ms,
            });
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => () => abort.current?.abort(), []);

  const cites = answer ? new Map(answer.citations.map((c) => [c.n, c])) : new Map<number, Citation>();

  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
      <div className="flex flex-col gap-1 border-b border-line px-4 py-3">
        <span className="text-[13px] font-semibold tracking-[-0.005em]">Ask the corpus what an agent would</span>
        <span className="max-w-[100ch] text-[11.5px] leading-[1.55] text-faint">
          Search runs the retrieval stages and shows the passages: hybrid search over meaning and words, a cross-encoder rerank against the
          question, and the guardrails in the query. Answer runs the whole loop: it judges the evidence, rewrites and retries the query when the
          evidence is weak, answers from the passages only with every claim cited, then checks each cited sentence against the passage it cites.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <input
          value={probe}
          onChange={(e) => setProbe(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.shiftKey ? search : ask)();
          }}
          placeholder="What is prompt injection, and how should an agent be protected from it?"
          className="focusable h-9 min-w-0 grow rounded-md border border-line bg-canvas px-3 text-[12.5px] text-fg placeholder:text-ghost"
        />
        <Button size="md" variant="solid" tone="ink" loading={busy && mode === "answer"} disabled={busy} onClick={ask}>Answer</Button>
        <Button size="md" variant="solid" loading={busy && mode === "search"} disabled={busy} onClick={search}>Search</Button>
      </div>

      {notice && <p className="border-t border-line px-4 py-2.5 text-[11.5px] text-faint">{notice}</p>}

      {/* ── the loop, as it turns ── */}
      {mode === "answer" && (live.length > 0 || answer) && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-4 py-2.5">
          {(answer ? answer.attempts.flatMap((a) => [{ stage: "retrieve", attempt: a.n, queries: a.queries, verdict: a.verdict }]) : live).map((s, i, arr) => (
            <span key={i} className="flex items-center gap-1.5">
              <span
                className={`inline-flex h-6 items-center gap-1.5 rounded-sm border px-2 text-[10.5px] ${
                  !answer && i === arr.length - 1 && busy ? "border-line-strong bg-raise text-fg" : "border-line text-dim"
                }`}
                title={s.queries?.join("\n")}
              >
                {!answer && i === arr.length - 1 && busy && <span className="size-1.5 animate-pulse rounded-full bg-run" />}
                {STAGE_LABEL[s.stage] ?? s.stage}
                {s.attempt ? <span className="font-mono text-[9.5px] text-faint">#{s.attempt}</span> : null}
                {"verdict" in s && s.verdict === "retry" && <span className="text-[9.5px] text-warn">incomplete, retried</span>}
              </span>
              {i < arr.length - 1 && <span className="text-[10px] text-ghost">›</span>}
            </span>
          ))}
          {answer && (
            <>
              <span className="text-[10px] text-ghost">›</span>
              <span className="inline-flex h-6 items-center rounded-sm border border-line px-2 text-[10.5px] text-dim">{STAGE_LABEL.answer}</span>
              <span className="text-[10px] text-ghost">›</span>
              <span className="inline-flex h-6 items-center rounded-sm border border-line px-2 text-[10.5px] text-dim">
                {STAGE_LABEL.ground}
                {answer.grounding && answer.grounding.rounds > 1 && <span className="ml-1 text-[9.5px] text-warn">× {answer.grounding.rounds}</span>}
              </span>
              <span className="grow" />
              <span className="tnum text-[10px] text-ghost">
                {(answer.ms / 1000).toFixed(1)} s · {answer.models.answer}
                {answer.models.rerank ? ` · rerank ${answer.models.rerank.split("/").pop()}` : ""}
              </span>
            </>
          )}
        </div>
      )}

      {/* ── the answer ── */}
      {answer && answer.answer && (
        <div className="flex flex-col gap-3 border-t border-line px-4 py-4">
          <div className="max-w-[96ch] text-[13px] leading-[1.7] text-fg">
            <Markdown
              text={answer.answer}
              cite={(n, k) => {
                const c = cites.get(n);
                return c ? <Cite key={k} c={c} onLocate={onLocate} /> : <span key={k}>[{n}]</span>;
              }}
              fence={(lang, code, closed) => {
                if (lang !== "chart" && lang !== "json chart") return null;
                if (!closed) return <ChartDrawing />;
                const spec = parseChart(code);
                return spec ? <AssistantChart spec={spec} /> : <p className="my-1 text-[11px] text-faint">The chart could not be drawn from the data given.</p>;
              }}
            />
          </div>
          {answer.grounding && answer.grounding.unsupported > 0 && (
            <div className="flex flex-col gap-1 rounded-md border border-warn/40 bg-surface px-3 py-2">
              <span className="text-[10.5px] font-medium tracking-[0.04em] text-warn uppercase">Not supported by the passage cited</span>
              {answer.grounding.verdicts.filter((v) => !v.supported).map((v, i) => (
                <span key={i} className="text-[11.5px] leading-[1.5] text-dim">
                  “{v.sentence.replace(/\s*\[\d+\]/g, "").replace(/\*\*/g, "")}” <span className="text-faint">· {v.note || "the cited passage does not say this"}</span>
                </span>
              ))}
            </div>
          )}
          {answer.gap && <p className="max-w-[92ch] text-[11.5px] leading-[1.55] text-faint">Not covered by the corpus: {answer.gap}</p>}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10.5px] text-faint">
            {answer.grounding && (
              <span className="flex items-center gap-1.5">
                <Status tone={answer.grounding.unsupported ? "warn" : "ok"}>
                  grounding {answer.grounding.supported}/{answer.grounding.checked} cited sentences supported
                </Status>
                {answer.grounding.unsupported > 0 && <span>{answer.grounding.unsupported} not supported by the passage cited, marked in the text</span>}
              </span>
            )}
            <span>{answer.citations.filter((c) => c.used).length} of {answer.citations.length} passages cited</span>
            <span>judge {answer.models.judge}</span>
            <span className="grow" />
            <button type="button" onClick={() => setShowEvidence((v) => !v)} className="focusable underline hover:text-fg">
              {showEvidence ? "Hide the passages" : "Show the passages"}
            </button>
          </div>
        </div>
      )}

      {/* ── attempts, when there was more than one ── */}
      {answer && answer.attempts.length > 1 && (
        <div className="flex flex-col border-t border-line">
          {answer.attempts.map((a) => (
            <div key={a.n} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-line px-4 py-2 text-[11px] last:border-0">
              <span className="font-mono text-[10px] text-faint">attempt {a.n}</span>
              <span className="min-w-0 grow text-fg">{a.queries.map((q) => `“${q}”`).join(" · ")}</span>
              <span className="text-faint">{a.strong} strong of {a.hits} · top {a.top === null ? "—" : a.top.toFixed(2)}</span>
              <Status tone={a.verdict === "enough" ? "ok" : a.verdict === "retry" ? "warn" : "err"}>{a.verdict}</Status>
              {a.missing && <span className="basis-full text-[10.5px] text-warn">missing: {a.missing}</span>}
              {a.n > 1 && <span className="basis-full text-[10.5px] text-ghost">{a.reason}</span>}
            </div>
          ))}
        </div>
      )}

      {/* ── passages: the search hits, or the answer's evidence ── */}
      {mode === "search" && stages && (
        <div className="grid grid-cols-2 gap-px border-t border-line bg-line sm:grid-cols-5">
          {[
            { k: "Dense", v: stages.stages.dense, s: "by meaning" },
            { k: "Lexical", v: stages.stages.lexical, s: "by words" },
            { k: "Fused", v: stages.stages.fused, s: "reciprocal rank" },
            { k: "Reranked", v: stages.stages.reranked, s: stages.rerankModel ? `${stages.rerankKind === "cross-encoder" ? "cross-encoder" : "model"} · ${stages.rerankModel.split("/").pop()}` : "unavailable" },
            { k: "Adjacent", v: stages.stages.adjacent, s: `${stages.timings.total_ms} ms in all` },
          ].map((x) => (
            <div key={x.k} className="flex flex-col bg-surface px-3 py-2">
              <span className="tnum text-[17px] leading-none font-semibold">{x.v}</span>
              <span className="text-[10.5px] text-faint">{x.k}</span>
              <span className="truncate text-[9.5px] text-ghost">{x.s}</span>
            </div>
          ))}
        </div>
      )}
      {((mode === "search" ? hits ?? [] : showEvidence && answer ? answer.citations : []) as (Hit | Citation)[]).map((h, i) => {
        const c = h as Partial<Citation> & Partial<Hit> & { id: string; documentId: string; source: string; heading: string; url: string; body: string; relevance: number | null };
        return (
          <div key={h.id ?? i} className={`flex flex-col gap-1.5 border-t border-line px-4 py-3 ${"used" in c && !c.used ? "opacity-60" : ""}`}>
            <span className="flex flex-wrap items-baseline gap-2">
              {"n" in c && c.n !== undefined ? (
                <span className="tnum shrink-0 rounded-sm bg-raise px-1.5 py-px font-mono text-[10.5px] text-fg">[{c.n}]</span>
              ) : null}
              {h.relevance !== null && h.relevance !== undefined && (
                <span className={`tnum shrink-0 rounded-sm px-1.5 py-px font-mono text-[10.5px] ${h.relevance >= 0.35 ? "bg-ok/15 text-ok" : "bg-raise text-dim"}`} title="Cross-encoder relevance to the question">
                  {h.relevance.toFixed(2)}
                </span>
              )}
              <span className="min-w-0 truncate text-[12.5px] font-medium text-fg">{h.source}</span>
              {h.heading && <span className="min-w-0 truncate text-[11px] text-faint">· {h.heading}</span>}
              <span className="grow" />
              {"denseRank" in h && (
                <span className="tnum shrink-0 text-[9.5px] text-ghost">
                  {h.denseRank ? `meaning #${h.denseRank}` : "words only"}
                  {h.lexicalRank ? ` · words #${h.lexicalRank}` : ""}
                </span>
              )}
              <button type="button" onClick={() => onLocate(h.documentId, h.body)} className="focusable shrink-0 text-[10.5px] text-faint underline hover:text-fg">open at passage</button>
              <a href={h.url} target="_blank" rel="noreferrer" className="focusable shrink-0 text-[10.5px] text-faint underline">source</a>
            </span>
            {"meta" in h && h.meta?.refs && Object.keys(h.meta.refs).length > 0 && (
              <span className="flex flex-wrap gap-1">
                {(Object.values(h.meta.refs).flat() as string[]).slice(0, 8).map((v) => (
                  <span key={v} className="rounded-sm border border-line bg-raise px-1 py-px font-mono text-[9px] text-dim">{v}</span>
                ))}
              </span>
            )}
            <p className="max-h-[4.6em] overflow-hidden text-[11.5px] leading-[1.55] text-faint">{h.body}</p>
          </div>
        );
      })}
    </section>
  );
}

/* ═══════════════════ citations ═══════════════════ */

function Cite({ c, onLocate }: { c: Citation; onLocate: (documentId: string, body: string) => void }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(true);
  }, []);
  const hide = useCallback(() => {
    timer.current = setTimeout(() => setOpen(false), 120);
  }, []);
  return (
    <span className="relative inline-block" onMouseEnter={show} onMouseLeave={hide}>
      <button
        type="button"
        onClick={() => onLocate(c.documentId, c.body)}
        onFocus={show}
        onBlur={hide}
        aria-label={`Citation ${c.n}: ${c.source}${c.heading ? `, ${c.heading}` : ""}`}
        className="focusable -my-1 mx-px inline-flex h-4 min-w-4 items-center justify-center rounded-[3px] border border-line bg-raise px-1 align-super font-mono text-[9.5px] leading-none text-dim hover:border-line-strong hover:text-fg"
      >
        {c.n}
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 z-30 mb-1.5 flex w-[min(380px,80vw)] -translate-x-1/2 flex-col gap-1 rounded-md border border-line bg-surface p-3 text-left elev-3 af-pop"
          onMouseEnter={show}
          onMouseLeave={hide}
        >
          <span className="flex items-baseline gap-2">
            <span className="font-mono text-[10px] text-faint">[{c.n}]</span>
            <span className="min-w-0 truncate text-[12px] font-medium text-fg">{c.source}</span>
            {c.relevance !== null && <span className="tnum ml-auto shrink-0 font-mono text-[9.5px] text-ghost">{c.relevance.toFixed(2)}</span>}
          </span>
          <span className="truncate text-[10.5px] text-faint">{c.title}{c.heading ? ` › ${c.heading}` : ""}</span>
          <span className="max-h-[7.5em] overflow-hidden text-[11px] leading-[1.5] text-dim">{c.body}</span>
          <span className="flex items-center gap-3 pt-0.5 text-[10px] text-faint">
            <button type="button" onClick={() => onLocate(c.documentId, c.body)} className="focusable underline hover:text-fg">open the document at this passage</button>
            <a href={c.url} target="_blank" rel="noreferrer" className="focusable underline hover:text-fg" onClick={(e) => e.stopPropagation()}>original source</a>
          </span>
        </span>
      )}
    </span>
  );
}
