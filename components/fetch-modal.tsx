"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Status } from "./ui";
import { BrandMark } from "./brand";
import { CURRENT_USER } from "@/lib/user";
import { useSession, signerName } from "@/lib/use-session";

/**
 * The fetch, watched.
 *
 * Fetching a source is the one moment the pipeline touches the outside
 * world, so the person who pressed the button sees what came back before
 * anything is done with it: first the raw record as the pipeline holds it
 * (the document, the pages it was pulled from, what the cleaning pass
 * removed, the sections and a sample of the chunks), arriving as it is
 * read; then the same record settled into a table they can judge. Admitting
 * from here embeds the chunks and makes them retrievable; refusing records
 * the refusal. Nothing reaches the index without that decision.
 */

interface Staged {
  staged?: boolean;
  unchanged?: boolean;
  document: string;
  status?: string;
  title?: string;
  note?: string;
  error?: string;
}

interface Doc {
  id: string;
  title: string;
  url: string;
  status: string;
  bytes: number;
  chunks: number;
  parts: number;
  digest: string;
  publisher: string;
  source_name: string;
  licence: string;
  pages: string[];
  cleaning: { chrome: number; boilerplate: number; duplicates: number; fragments: number; before: number; after: number } | null;
  sections: { ordinal: number; heading: string; bytes: number; chunks: string }[];
  references: Record<string, { distinct: number; top: string[] }>;
  sample: { ordinal: number; heading: string; body: string; tokens: number; meta: Record<string, unknown> }[];
  decided_by: string;
  note: string;
}

const REF_LABEL: Record<string, string> = { cve: "CVEs", cwe: "CWEs", controls: "Control ids", owasp: "OWASP ids" };
const kb = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : n >= 1000 ? `${Math.round(n / 1000)} kB` : `${n} B`);

type Phase = "fetching" | "raw" | "morph" | "table" | "failed";

export function FetchModal({
  sourceId,
  sourceName,
  onClose,
  onReview,
  onDone,
}: {
  sourceId: string;
  sourceName: string;
  onClose: () => void;
  /** Open the full document. */
  onReview: (documentId: string) => void;
  /** Something was decided or staged; the page should reload and say so. */
  onDone: (text: string, ok: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>("fetching");
  const [error, setError] = useState("");
  const [staged, setStaged] = useState<Staged | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [shownLines, setShownLines] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"admit" | "refuse" | null>(null);
  const [decideError, setDecideError] = useState("");
  const rawPane = useRef<HTMLPreElement>(null);
  const { session: me } = useSession();
  const by = signerName(me, CURRENT_USER.name);

  /* ── 1. fetch, then read the record back ── */
  useEffect(() => {
    let stop = false;
    const tick = setInterval(() => setElapsed((e) => e + 1), 1000);
    (async () => {
      try {
        const res = await fetch("/api/knowledge/fetch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: sourceId }) });
        const d = (await res.json()) as Staged;
        if (stop) return;
        if (d.error) throw new Error(d.error);
        setStaged(d);
        const r = await fetch(`/api/knowledge/document?id=${encodeURIComponent(d.document)}`);
        const full = (await r.json()) as Doc & { error?: string };
        if (stop) return;
        if (full.error) throw new Error(full.error);
        setDoc(full);
        // The raw record, as the pipeline holds it. Chunk bodies are clipped:
        // the point is the shape and the metadata, the text has its own view.
        const raw = {
          document: { id: full.id, title: full.title, source: full.source_name, publisher: full.publisher, status: full.status, url: full.url, bytes: full.bytes, parts: full.parts, digest: full.digest },
          pages: full.pages,
          cleaning: full.cleaning,
          sections: full.sections.map((s) => ({ ordinal: s.ordinal, heading: s.heading, chunks: Number(s.chunks), bytes: s.bytes })),
          chunks: full.sample.map((c) => ({ ordinal: c.ordinal, heading: c.heading, tokens: c.tokens, meta: c.meta, body: c.body.replace(/\s+/g, " ") + (c.body.length >= 280 ? "…" : "") })),
        };
        setLines(JSON.stringify(raw, null, 2).split("\n"));
        setPhase("raw");
      } catch (e) {
        if (!stop) {
          setError((e as Error).message);
          setPhase("failed");
        }
      } finally {
        clearInterval(tick);
      }
    })();
    return () => {
      stop = true;
      clearInterval(tick);
    };
  }, [sourceId]);

  /* ── 2. the raw record arrives line by line, and the pane follows it ── */
  useEffect(() => {
    if (phase !== "raw" || !lines.length) return;
    const total = lines.length;
    const step = Math.max(1, Math.ceil(total / 160));
    let n = 0;
    let raf = 0;
    let last = 0;
    const frame = (t: number) => {
      if (t - last >= 16) {
        last = t;
        n = Math.min(total, n + step);
        setShownLines(n);
        const el = rawPane.current;
        if (el) el.scrollTop = el.scrollHeight;
      }
      if (n < total) raf = requestAnimationFrame(frame);
      else {
        setTimeout(() => setPhase("morph"), 500);
        setTimeout(() => setPhase("table"), 1100);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [phase, lines]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const decide = async (admit: boolean) => {
    if (!doc) return;
    setBusy(admit ? "admit" : "refuse");
    setDecideError("");
    try {
      const res = await fetch("/api/knowledge/admit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ document: doc.id, admit, by, note: note.trim() }) });
      const d = await res.json();
      if (d.error) setDecideError(d.error);
      else onDone(d.note, true);
    } catch (e) {
      setDecideError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const c = doc?.cleaning ?? null;
  const removed = c ? c.chrome + c.boilerplate + c.duplicates + c.fragments : 0;
  const refs = doc ? Object.entries(doc.references).filter(([, v]) => v.distinct > 0) : [];
  const settled = phase === "table";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/75 p-3 sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Fetching ${sourceName}`}
        onClick={(e) => e.stopPropagation()}
        className="flex h-[min(90vh,900px)] w-[min(1120px,100%)] flex-col overflow-hidden rounded-lg border border-line bg-surface elev-3 af-pop"
      >
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          {doc ? <BrandMark name={doc.publisher} size={22} /> : <span className="size-[22px] rounded-md bg-raise" />}
          <span className="flex min-w-0 grow flex-col">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[14px] font-semibold tracking-[-0.005em]">{doc?.title ?? sourceName}</span>
              {phase === "fetching" && <Status tone="run">fetching · {elapsed}s</Status>}
              {(phase === "raw" || phase === "morph") && <Status tone="run">reading the record</Status>}
              {settled && doc && <Status tone={doc.status === "staged" ? "warn" : staged?.unchanged ? "neutral" : "ok"}>{doc.status === "staged" ? "staged · awaiting a person" : doc.status}</Status>}
              {phase === "failed" && <Status tone="err">failed</Status>}
            </span>
            <span className="truncate text-[11px] text-faint">
              {phase === "fetching"
                ? "Pulling every page the source has, normalising it, and stripping site chrome, repeats and fragments before anything is staged."
                : doc
                  ? `${doc.source_name} · ${doc.publisher}${doc.pages?.length > 1 ? ` · ${doc.pages.length} pages` : ""}${staged?.unchanged ? " · byte-identical to a fetch already on record" : ""}`
                  : ""}
            </span>
          </span>
          <Button size="sm" variant="solid" tone="err" onClick={onClose}>Close</Button>
        </header>

        {phase === "failed" && <p className="px-4 py-4 text-[12px] text-err">{error}</p>}

        {phase === "fetching" && (
          <div className="flex grow flex-col items-center justify-center gap-3 px-6 text-center">
            <span className="relative flex size-3">
              <span className="absolute inline-flex size-3 animate-ping rounded-full bg-run opacity-60" />
              <span className="relative inline-flex size-3 rounded-full bg-run" />
            </span>
            <span className="text-[12.5px] text-fg">Fetching {sourceName}</span>
            <span className="max-w-[60ch] text-[11.5px] leading-[1.55] text-faint">
              The front page first; if it is an index, the pages it links to under its own path as well. Each is normalised to text with its
              structure kept, then cleaned. A large standard takes a little while.
            </span>
          </div>
        )}

        {/* ── the raw record, then the table: both mounted through the morph so one fades into the other ── */}
        {(phase === "raw" || phase === "morph" || settled) && doc && (
          <div className="relative min-h-0 grow">
            <pre
              ref={rawPane}
              aria-hidden={settled}
              className={`absolute inset-0 overflow-y-auto bg-canvas px-5 py-4 font-mono text-[11px] leading-[1.5] text-dim transition-[opacity,transform,filter] duration-500 ease-[var(--ease-out)] ${
                phase === "raw" ? "opacity-100" : "pointer-events-none scale-[0.985] opacity-0 blur-[2px]"
              }`}
            >
              {lines.slice(0, shownLines).map((l, i) => (
                <div key={i} className={/"(id|title|status|cleaning|pages|sections|chunks)":/.test(l) ? "text-fg" : ""}>{l}</div>
              ))}
              {phase === "raw" && <span className="inline-block h-3 w-1.5 animate-pulse bg-fg align-middle" />}
            </pre>

            <div
              className={`absolute inset-0 flex flex-col overflow-y-auto transition-[opacity,transform] duration-500 ease-[var(--ease-out)] ${
                settled ? "opacity-100" : phase === "morph" ? "scale-[1.005] opacity-100" : "pointer-events-none scale-[1.01] opacity-0"
              }`}
            >
              {/* what the pipeline made of it */}
              <div className="grid shrink-0 grid-cols-3 gap-px border-b border-line bg-line sm:grid-cols-6">
                {[
                  { k: "Pages", v: String(doc.pages?.length ?? 1) },
                  { k: "Text kept", v: kb(doc.bytes) },
                  { k: "Removed", v: c ? kb(Math.max(0, c.before - c.after)) : "—" },
                  { k: "Sections", v: String(doc.sections.length) },
                  { k: "Chunks", v: String(doc.chunks) },
                  { k: "Digest", v: doc.digest.slice(0, 12), mono: true },
                ].map((x) => (
                  <div key={x.k} className="flex flex-col bg-surface px-3 py-2">
                    <span className={`tnum truncate text-[13px] font-semibold ${x.mono ? "font-mono text-[11.5px]" : ""}`}>{x.v}</span>
                    <span className="text-[10px] text-faint">{x.k}</span>
                  </div>
                ))}
              </div>

              {/* what was left out, and where it came from */}
              <div className="grid shrink-0 gap-px border-b border-line bg-line md:grid-cols-2">
                <div className="flex flex-col gap-1 bg-surface px-4 py-3">
                  <span className="text-[10.5px] font-medium tracking-[0.04em] text-ghost uppercase">Removed before staging</span>
                  {c ? (
                    <span className="text-[11.5px] leading-[1.55] text-dim">
                      {removed === 0 ? "Nothing needed removing." : (
                        <>
                          <b className="text-fg">{c.chrome}</b> site chrome block{c.chrome === 1 ? "" : "s"} (menus, cookie notices, share bars), <b className="text-fg">{c.boilerplate}</b> paragraph{c.boilerplate === 1 ? "" : "s"} repeated on most pages,{" "}
                          <b className="text-fg">{c.duplicates}</b> duplicate paragraph{c.duplicates === 1 ? "" : "s"}, <b className="text-fg">{c.fragments}</b> fragment{c.fragments === 1 ? "" : "s"} too short to carry a claim. {kb(c.before)} in, {kb(c.after)} kept.
                        </>
                      )}
                    </span>
                  ) : (
                    <span className="text-[11.5px] text-faint">This document was staged before the cleaning pass recorded its figures.</span>
                  )}
                </div>
                <div className="flex min-w-0 flex-col gap-1 bg-surface px-4 py-3">
                  <span className="text-[10.5px] font-medium tracking-[0.04em] text-ghost uppercase">Fetched from</span>
                  <span className="flex max-h-[4.8em] flex-col overflow-y-auto text-[10.5px] leading-[1.6]">
                    {(doc.pages?.length ? doc.pages : [doc.url]).map((u) => (
                      <a key={u} href={u} target="_blank" rel="noreferrer" className="focusable truncate font-mono text-faint underline decoration-line hover:text-fg">{u}</a>
                    ))}
                  </span>
                </div>
              </div>

              {refs.length > 0 && (
                <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 border-b border-line px-4 py-2">
                  <span className="text-[10.5px] font-medium tracking-[0.04em] text-ghost uppercase">Identifiers found</span>
                  {refs.map(([k, v]) => (
                    <span key={k} className="flex flex-wrap items-center gap-1 text-[10.5px]">
                      <span className="text-faint">{REF_LABEL[k] ?? k} <span className="tnum text-fg">{v.distinct}</span></span>
                      {v.top.slice(0, 6).map((t) => (
                        <span key={t} className="rounded-sm border border-line bg-raise px-1 py-px font-mono text-[9.5px] text-dim">{t}</span>
                      ))}
                    </span>
                  ))}
                </div>
              )}

              {/* the table */}
              <table className="w-full border-collapse text-[11.5px]">
                <thead className="sticky top-0 z-10 bg-surface">
                  <tr className="border-b border-line text-left text-[10.5px] text-faint">
                    <th className="w-12 px-4 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">Section</th>
                    <th className="px-3 py-2 text-right font-medium">Chunks</th>
                    <th className="px-3 py-2 text-right font-medium">Text</th>
                  </tr>
                </thead>
                <tbody>
                  {doc.sections.map((s, i) => (
                    <tr key={s.ordinal} className="border-b border-line last:border-0" style={settled ? { animation: `af-pop-in 240ms var(--ease-out) both`, animationDelay: `${Math.min(i, 40) * 12}ms` } : undefined}>
                      <td className="tnum px-4 py-1.5 font-mono text-[10.5px] text-faint">{s.ordinal + 1}</td>
                      <td className="px-3 py-1.5 text-fg">{s.heading || <span className="text-faint">(untitled)</span>}</td>
                      <td className="tnum px-3 py-1.5 text-right">{s.chunks}</td>
                      <td className="tnum px-3 py-1.5 text-right text-dim">{kb(s.bytes)}</td>
                    </tr>
                  ))}
                  {!doc.sections.length && <tr><td colSpan={4} className="px-4 py-4 text-center text-faint">No sections were found.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* the decision */}
        {settled && doc && (
          <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line px-4 py-3">
            <Button size="sm" variant="quiet" onClick={() => onReview(doc.id)}>Read the full text</Button>
            {doc.status === "staged" ? (
              <>
                <span className="flex items-center gap-2 text-[11.5px] text-faint">
                  <span className="grid size-5 place-items-center rounded-full bg-ink text-[8.5px] font-semibold text-on-ink">{me?.initials ?? CURRENT_USER.initials}</span>
                  Deciding as <span className="font-medium text-fg">{by}</span>
                </span>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Reason: authoritative, current, and within our licence."
                  className="focusable h-8 min-w-[220px] grow rounded-md border border-line bg-canvas px-3 text-[12px] text-fg placeholder:text-ghost"
                />
                <Button size="sm" variant="solid" tone="ink" permission="configure" loading={busy === "admit"} disabled={Boolean(busy)} onClick={() => decide(true)}>Admit and index</Button>
                <Button size="sm" variant="solid" tone="err" permission="configure" loading={busy === "refuse"} disabled={Boolean(busy)} onClick={() => decide(false)}>Refuse</Button>
                {decideError && <span className="basis-full text-[11.5px] text-err">{decideError}</span>}
              </>
            ) : (
              <span className="text-[11.5px] text-faint">
                {doc.status === "admitted" ? "Already admitted" : doc.status === "rejected" ? "Already refused" : doc.status}
                {doc.decided_by ? ` by ${doc.decided_by}` : ""}
                {doc.note ? ` · ${doc.note}` : ""}
              </span>
            )}
          </footer>
        )}
      </div>
    </div>
  );
}
