"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Button, Meter, Status, Tag } from "./ui";
import { CURRENT_USER } from "@/lib/user";
import { useSession, signerName } from "@/lib/use-session";
import { Markdown, headingsOf } from "./markdown";
import { BrandMark } from "./brand";
import { Donut } from "./charts";
import { PipelineView, TelemetryRegister } from "./pipeline";
import { AskCorpus } from "./ask";
import { FetchModal } from "./fetch-modal";
import { usePageFacts } from "./assistant";
import { FAMILIES, LICENCE_NOTE, type Licence } from "@/lib/knowledge";

/**
 * The knowledge base.
 *
 * The page opens on the architecture, because that is what it is about: how
 * context reaches an agent. Below it, the three states a source can be in —
 * curated, waiting for a person, indexed — then the register, then the search
 * that runs the same pipeline an agent runs.
 *
 * The licence column is load-bearing. It is why some of the biggest names in
 * the register are cited and never stored.
 */

interface Source {
  id: string;
  name: string;
  publisher: string;
  family: string;
  licence: Licence;
  use_for: string;
  url: string;
  cadence: string;
  enabled: boolean;
  documents: string;
  staged: string;
  chunks: string;
  last_admitted: string | null;
}

interface Staged {
  id: string;
  source_id: string;
  title: string;
  url: string;
  bytes: number;
  chunks: number;
  digest: string;
  fetched_at: string;
  excerpt: string;
}

interface Data {
  ready: boolean;
  error?: string;
  sources?: Source[];
  staged?: Staged[];
  admissions?: { document_id: string; source_id: string; admitted: boolean; by_whom: string; note: string; chunks: number; at: string; title: string }[];
  totals?: { chunks: number; documents: number; admitted: number; tokens: number; sources: number };
  index?: { store: string; model: string; dimensions: number; embeddingReady: boolean };
  retrieval?: { calls: number; byAgent: Record<string, number> };
  basis: string;
}

const LICENCE_TONE: Record<Licence, "ok" | "warn" | "neutral"> = { open: "ok", registration: "warn", licensed: "neutral" };
const LICENCE_COLOR: Record<Licence, string> = { open: "var(--t-ok)", registration: "var(--t-warn)", licensed: "var(--t-line-strong)" };
const FAMILY_COLOR: Record<string, string> = {
  internal: "var(--t-c9)", ai: "var(--t-c2)", frameworks: "var(--t-c5)", threat: "var(--t-c1)",
  cloud: "var(--t-c7)", identity: "var(--t-c8)", regulation: "var(--t-c6)", market: "var(--t-c3)",
};

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function Knowledge() {
  const [data, setData] = useState<Data | null>(null);
  const [family, setFamily] = useState("");
  const [q, setQ] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [review, setReview] = useState<string | null>(null);
  /** The passage to open a document at, when a citation is clicked. */
  const [locate, setLocate] = useState<string | null>(null);
  const [askFacts, setAskFacts] = useState<Record<string, unknown> | null>(null);
  const [fetching, setFetching] = useState<{ id: string; name: string } | null>(null);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const toggleFold = (p: string) =>
    setFolded((f) => {
      const n = new Set(f);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  const load = () => {
    fetch("/api/knowledge").then((r) => r.json()).then(setData).catch(() => setData(null));
  };
  useEffect(load, []);

  const sources = useMemo(() => data?.sources ?? [], [data]);
  const staged = data?.staged ?? [];
  const totals = data?.totals;
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return sources.filter(
      (s) =>
        (!family || s.family === family) &&
        (!term || s.name.toLowerCase().includes(term) || s.publisher.toLowerCase().includes(term) || s.use_for.toLowerCase().includes(term)),
    );
  }, [sources, family, q]);

  const byLicence = (["open", "registration", "licensed"] as Licence[]).map((l) => ({
    label: LICENCE_NOTE[l].split(".")[0],
    value: sources.filter((s) => s.licence === l).length,
    color: LICENCE_COLOR[l],
  }));
  const indexed = sources.filter((s) => Number(s.chunks) > 0).length;
  // The register reads by publisher: OWASP is a kind of source, and the
  // things under it are the sources. Largest publishers first.
  const groups = useMemo(() => {
    const by = new Map<string, Source[]>();
    for (const s of shown) by.set(s.publisher, [...(by.get(s.publisher) ?? []), s]);
    return [...by.entries()]
      .map(([publisher, rows]) => ({
        publisher,
        rows,
        indexed: rows.filter((r) => Number(r.chunks) > 0).length,
        staged: rows.filter((r) => Number(r.staged ?? 0) > 0).length,
      }))
      .sort((a, b) => b.rows.length - a.rows.length || a.publisher.localeCompare(b.publisher));
  }, [shown]);
  usePageFacts(
    data
      ? {
          ready: data.ready,
          totals: data.totals,
          index: data.index,
          sourcesIndexed: indexed,
          stagedAwaitingAPerson: staged.map((s) => ({ title: s.title, chunks: s.chunks })),
          familyFilter: family || null,
          lastAsked: askFacts,
        }
      : null,
  );

  return (
    <div className="min-h-full" data-hue="violet">
      <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-5 px-5 py-7">
        {/* ── hero ── */}
        <header className="flex flex-col gap-2">
          <span className="text-[11px] font-medium tracking-[0.08em] text-faint uppercase">Knowledge base</span>
          <h1 className="max-w-[30ch] text-[26px] leading-[1.15] font-semibold tracking-[-0.02em]">
            Curate the knowledge available to every workflow.
          </h1>
          <p className="max-w-[78ch] text-[13px] leading-[1.6] text-faint">
            Review authoritative sources, licensing and indexing status before content becomes
            available for retrieval. Human admission and passage-level provenance help teams
            control what workflows can use and trace responses to supporting material.
          </p>
        </header>

        <PipelineView
          counts={{
            curated: totals ? `${totals.sources} sources` : "",
            sections: totals?.documents ? `${totals.documents} docs` : "",
            chunks: totals ? `${totals.chunks} chunks` : "",
            embedding: data?.index?.model?.replace("text-embedding-", "") ?? "",
            hitl: totals ? `${totals.admitted} admitted` : "",
            pgvector: data?.index ? `${data.index.dimensions}d` : "",
          }}
        />

        {data && !data.ready && (
          <p className="rounded-md border border-err/40 bg-surface px-3 py-2.5 text-[11.5px] text-err">{data.error}</p>
        )}
        {notice && (
          <p className={`rounded-md border px-3 py-2 text-[11.5px] leading-[1.5] ${notice.ok ? "border-line bg-surface text-faint" : "border-err/40 bg-surface text-err"}`}>
            {notice.text}
          </p>
        )}

        {/* ── three states of a source ── */}
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="flex flex-col rounded-lg border border-line bg-surface p-4 elev-1">
            <span className="text-[11px] font-medium tracking-[0.06em] text-faint uppercase">Curated</span>
            <span className="tnum mt-1 text-[30px] leading-none font-semibold tracking-[-0.025em]">{totals?.sources ?? "—"}</span>
            <span className="mt-1 text-[11.5px] text-faint">sources across {FAMILIES.length} families</span>
            <div className="mt-4 border-t border-line pt-3">
              <Donut data={byLicence.filter((d) => d.value > 0)} size={96} />
            </div>
          </section>

          <section className={`flex flex-col rounded-lg border p-4 elev-1 ${staged.length ? "border-warn/50 bg-surface" : "border-line bg-surface"}`}>
            <span className="text-[11px] font-medium tracking-[0.06em] text-faint uppercase">Waiting for a person</span>
            <span className={`tnum mt-1 text-[30px] leading-none font-semibold tracking-[-0.025em] ${staged.length ? "text-warn" : ""}`}>{data ? staged.length : "—"}</span>
            <span className="mt-1 text-[11.5px] text-faint">fetched and split · not embedded, not searchable</span>
            <div className="mt-4 flex flex-col gap-1.5 border-t border-line pt-3">
              {staged.length === 0 && data && (
                <span className="text-[11.5px] text-ghost">The quarantine is empty. Fetch a source below to stage one.</span>
              )}
              {staged.slice(0, 4).map((s) => (
                <div key={s.id} className="flex items-center gap-2">
                  <span className="flex min-w-0 grow flex-col">
                    <span className="truncate text-[12px] text-fg">{s.title}</span>
                    <span className="truncate text-[10px] text-faint">{s.chunks} chunks · {ago(s.fetched_at)}</span>
                  </span>
                  <Button size="sm" variant="outline" tone="warn" onClick={() => setReview(s.id)}>Review</Button>
                </div>
              ))}
            </div>
          </section>

          <section className="flex flex-col rounded-lg border border-line bg-surface p-4 elev-1">
            <span className="text-[11px] font-medium tracking-[0.06em] text-faint uppercase">Indexed</span>
            <span className="tnum mt-1 text-[30px] leading-none font-semibold tracking-[-0.025em]">{totals?.chunks ?? "—"}</span>
            <span className="mt-1 text-[11.5px] text-faint">chunks retrievable now, from {totals?.admitted ?? 0} admitted documents</span>
            <div className="mt-4 flex flex-col gap-2 border-t border-line pt-3 text-[11.5px]">
              <Row k="Store" v={data?.index?.store ?? "—"} />
              <Row k="Embedding" v={data?.index?.model ?? "—"} mono />
              <Row k="Dimensions" v={data?.index ? String(data.index.dimensions) : "—"} />
              <Row k="Sources indexed" v={data ? `${indexed} of ${sources.length}` : "—"} />
              <Meter value={sources.length ? indexed / sources.length : 0} tone="ok" />
            </div>
          </section>
        </div>

        {/* ── ask it ── */}
        <AskCorpus
          onLocate={(documentId, body) => {
            setLocate(body);
            setReview(documentId);
          }}
          onResult={setAskFacts}
        />

        {/* ── the register ── */}
        <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            <span className="text-[13px] font-semibold tracking-[-0.005em]">Curated sources</span>
            <span className="text-[11.5px] text-faint">{data ? `${shown.length} of ${sources.length}` : "reading…"}</span>
            <span className="grow" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search"
              className="focusable h-7 w-40 rounded-sm border border-line bg-canvas px-2 text-[11.5px] text-fg placeholder:text-ghost"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2">
            <FamilyChip active={family === ""} color="var(--t-fg-3)" label="All" onClick={() => setFamily("")} />
            {FAMILIES.map((f) => (
              <FamilyChip key={f.id} active={family === f.id} color={FAMILY_COLOR[f.id]} label={f.name} onClick={() => setFamily(family === f.id ? "" : f.id)} />
            ))}
          </div>
          <div className="max-h-[520px] overflow-x-auto overflow-y-auto">
            <table className="w-full min-w-[920px] border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-line text-[10.5px] text-faint">
                  <th className="px-4 py-2.5 font-medium">Source</th>
                  <th className="px-3 py-2.5 font-medium">Licence</th>
                  <th className="px-3 py-2.5 font-medium">Used for</th>
                  <th className="px-3 py-2.5 font-medium">Indexed</th>
                  <th className="px-3 py-2.5 font-medium">Cadence</th>
                  <th className="px-3 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.publisher}>
                    <tr className="border-b border-line bg-raise/40">
                      <td colSpan={6} className="p-0">
                        <button type="button" onClick={() => toggleFold(g.publisher)} aria-expanded={!folded.has(g.publisher)} className="focusable flex w-full items-center gap-2.5 px-4 py-2 text-left hover:bg-raise/70">
                          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 text-faint transition-transform ${folded.has(g.publisher) ? "-rotate-90" : ""}`}>
                            <path d="M6 9l6 6 6-6" />
                          </svg>
                          <BrandMark name={g.publisher} size={18} />
                          <span className="text-[12.5px] font-semibold text-fg">{g.publisher}</span>
                          <span className="text-[11px] text-faint">{g.rows.length} source{g.rows.length === 1 ? "" : "s"}</span>
                          <span className="grow" />
                          <span className="tnum text-[10.5px] text-faint">{g.indexed} indexed{g.staged ? ` · ${g.staged} waiting` : ""}</span>
                          <span className="text-[10.5px] text-ghost">{folded.has(g.publisher) ? "show" : ""}</span>
                        </button>
                      </td>
                    </tr>
                    {!folded.has(g.publisher) && g.rows.map((s) => (
                  <tr key={s.id} className="border-b border-line transition-colors last:border-0 hover:bg-raise/50">
                    <td className="max-w-[380px] px-4 py-2.5">
                      <span className="flex items-center gap-2.5">
                        <span className="h-7 w-[3px] shrink-0 rounded-full" style={{ background: FAMILY_COLOR[s.family] }} />
                        <BrandMark name={s.publisher} size={18} />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-[12.5px] font-medium text-fg">{s.name}</span>
                          <span className="truncate text-[10.5px] text-faint">{s.publisher}</span>
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span title={LICENCE_NOTE[s.licence]}><Status tone={LICENCE_TONE[s.licence]}>{s.licence}</Status></span>
                    </td>
                    <td className="max-w-[300px] px-3 py-2.5 text-[11px] leading-[1.45] text-faint">{s.use_for}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {Number(s.chunks) > 0 ? (
                        <span className="flex flex-col">
                          <span className="tnum font-mono text-[11px] text-fg">{s.chunks} <span className="font-sans text-faint">chunks</span></span>
                          <span className="text-[10px] text-ghost">admitted {ago(s.last_admitted)}</span>
                        </span>
                      ) : (
                        <span className="text-[11px] text-ghost">not indexed</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-[11px] text-faint">{s.cadence}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {s.licence === "licensed" ? (
                        <Tag>cited only</Tag>
                      ) : s.family === "internal" ? (
                        <Tag>on deployment</Tag>
                      ) : (
                        <Button size="sm" variant="quiet" permission="configure" onClick={() => setFetching({ id: s.id, name: s.name })}>Fetch</Button>
                      )}
                    </td>
                  </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <TelemetryRegister />

        {/* ── admissions ── */}
        <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
          <div className="flex items-center gap-2 border-b border-line px-4 py-3">
            <span className="text-[13px] font-semibold tracking-[-0.005em]">Admission record</span>
            <span className="text-[11.5px] text-faint">every decision about what the estate may believe</span>
          </div>
          {(data?.admissions ?? []).length === 0 && <p className="px-4 py-3 text-[11.5px] text-faint">Nothing has been admitted or refused yet.</p>}
          {(data?.admissions ?? []).map((a, i) => (
            <div key={i} className="flex items-baseline gap-3 border-b border-line px-4 py-2 last:border-0">
              <Status tone={a.admitted ? "ok" : "err"}>{a.admitted ? "admitted" : "refused"}</Status>
              <span className="flex min-w-0 grow flex-col">
                <span className="truncate text-[12px] text-fg">{a.title || a.document_id}</span>
                {a.note && <span className="truncate text-[10.5px] text-faint">{a.note}</span>}
              </span>
              <span className="shrink-0 text-[10.5px] text-faint">{a.by_whom}</span>
              <span className="shrink-0 text-[10.5px] text-ghost">{ago(a.at)}</span>
            </div>
          ))}
        </section>

        <p className="pb-2 text-[10.5px] text-ghost">{data?.basis ?? ""}</p>
      </div>

      {fetching && (
        <FetchModal
          sourceId={fetching.id}
          sourceName={fetching.name}
          onClose={() => {
            setFetching(null);
            load();
          }}
          onReview={(id) => {
            setFetching(null);
            setReview(id);
          }}
          onDone={(text, ok) => {
            setNotice({ ok, text });
            setFetching(null);
            load();
          }}
        />
      )}
      {review && (
        <DocumentModal
          id={review}
          locate={locate}
          onClose={() => {
            setReview(null);
            setLocate(null);
          }}
          onDone={(text, ok) => {
            setNotice({ ok, text });
            setReview(null);
            setLocate(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <span className="flex items-baseline justify-between gap-3">
      <span className="text-faint">{k}</span>
      <span className={`tnum truncate text-fg ${mono ? "font-mono text-[11px]" : ""}`}>{v}</span>
    </span>
  );
}

function FamilyChip({ active, color, label, onClick }: { active: boolean; color: string; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`focusable flex items-center gap-1.5 rounded-sm px-2 py-1 text-[11px] transition-colors ${active ? "bg-raise text-fg" : "text-faint hover:text-fg"}`}
    >
      <span className="size-1.5 rounded-[2px]" style={{ background: color }} />
      {label}
    </button>
  );
}

/**
 * The document, in full, and the decision about it.
 *
 * What was fetched is shown as it will be indexed: every heading, list and
 * table, with an index down the side and the identifiers found in the text.
 * A person admits or refuses from here, with a reason, and the record says
 * who. An already-admitted document opens read-only.
 */
interface Doc {
  id: string;
  source_id: string;
  source_name: string;
  publisher: string;
  licence: string;
  title: string;
  url: string;
  status: string;
  bytes: number;
  chunks: number;
  parts: number;
  digest: string;
  fetched_at: string;
  decided_at: string | null;
  decided_by: string;
  note: string;
  text: string;
  fullTextHeld: boolean;
  sections: { ordinal: number; heading: string; bytes: number; chunks: string }[];
  references: Record<string, { distinct: number; top: string[] }>;
  kinds: Record<string, number>;
  error?: string;
}

const REF_LABEL: Record<string, string> = { cve: "CVEs", cwe: "CWEs", controls: "Control ids", owasp: "OWASP ids" };
const RENDER_CAP = 450_000;

function kb(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : n >= 1000 ? `${Math.round(n / 1000)} kB` : `${n} B`;
}

function DocumentModal({ id, locate, onClose, onDone }: { id: string; locate?: string | null; onClose: () => void; onDone: (text: string, ok: boolean) => void }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [failed, setFailed] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"admit" | "refuse" | null>(null);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const { session: me } = useSession();
  const by = signerName(me, CURRENT_USER.name);

  useEffect(() => {
    let stop = false;
    fetch(`/api/knowledge/document?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((d) => {
        if (stop) return;
        if (d.error) setFailed(String(d.error));
        else setDoc(d as Doc);
      })
      .catch((e) => !stop && setFailed((e as Error).message));
    return () => {
      stop = true;
    };
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const text = doc ? (showAll || doc.text.length <= RENDER_CAP ? doc.text : doc.text.slice(0, RENDER_CAP)) : "";
  const headings = useMemo(() => (text ? headingsOf(text).filter((h) => h.level <= 3).slice(0, 400) : []), [text]);

  const decide = async (admit: boolean) => {
    if (!doc) return;
    setBusy(admit ? "admit" : "refuse");
    setError("");
    try {
      const res = await fetch("/api/knowledge/admit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ document: doc.id, admit, by, note: note.trim() }) });
      const d = await res.json();
      if (d.error) setError(d.error);
      else onDone(d.note, true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const jump = (hid: string) => {
    const el = body.current?.querySelector(`#${hid}`);
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // Opened at a passage: find the block that carries the cited text, bring it
  // into view and mark it. The chunk may begin mid-paragraph, so a few
  // windows into it are tried before giving up quietly.
  useEffect(() => {
    if (!doc || !locate || !body.current) return;
    const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
    const hay = [...body.current.querySelectorAll("p, li, td, th, blockquote, pre")] as HTMLElement[];
    const text = norm(locate);
    const probes = [0, 80, 200, 400].map((o) => text.slice(o, o + 60)).filter((w) => w.length >= 30);
    let found: HTMLElement | null = null;
    for (const w of probes) {
      found = hay.find((el) => norm(el.textContent ?? "").includes(w)) ?? null;
      if (found) break;
    }
    if (!found) return;
    for (const el of hay) el.classList.remove("af-located");
    found.classList.add("af-located");
    found.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [doc, locate, showAll]);

  const staged = doc?.status === "staged";
  const refs = doc ? Object.entries(doc.references).filter(([, v]) => v.distinct > 0) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/75 p-3 sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={doc ? `Fetched document ${doc.title}` : "Fetched document"}
        onClick={(e) => e.stopPropagation()}
        className="flex h-[min(92vh,980px)] w-[min(1180px,100%)] flex-col overflow-hidden rounded-lg border border-line bg-surface elev-3 af-pop"
      >
        {/* header */}
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          {doc && <BrandMark name={doc.publisher} size={22} />}
          <span className="flex min-w-0 grow flex-col">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[14px] font-semibold tracking-[-0.005em]">{doc?.title ?? (failed ? "Document" : "Reading the document…")}</span>
              {doc && (
                <Status tone={staged ? "warn" : doc.status === "admitted" ? "ok" : doc.status === "rejected" ? "err" : "neutral"}>
                  {staged ? "staged · awaiting a person" : doc.status}
                </Status>
              )}
            </span>
            {doc && (
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-[11px] text-faint">
                <span>{doc.source_name}</span>
                <span>·</span>
                <span>{doc.publisher}</span>
                <span>·</span>
                <a href={doc.url.split(/\s+/)[0]} target="_blank" rel="noreferrer" className="focusable truncate underline">
                  {doc.url.split(/\s+/)[0]}
                </a>
                {doc.parts > 1 && <span>· {doc.parts} parts</span>}
              </span>
            )}
          </span>
          <Button size="sm" variant="solid" tone="err" onClick={onClose}>Close</Button>
        </header>

        {failed && <p className="px-4 py-4 text-[12px] text-err">{failed}</p>}

        {doc && (
          <>
            {/* what the pipeline made of it */}
            <div className="grid shrink-0 grid-cols-3 gap-px border-b border-line bg-line sm:grid-cols-6">
              {[
                { k: "Fetched", v: ago(doc.fetched_at) },
                { k: "Text", v: kb(doc.bytes) },
                { k: "Sections", v: String(doc.sections.length) },
                { k: "Chunks", v: String(doc.chunks) },
                { k: "Digest", v: doc.digest.slice(0, 12), mono: true },
                { k: "Licence", v: doc.licence },
              ].map((x) => (
                <div key={x.k} className="flex flex-col bg-surface px-3 py-2">
                  <span className={`tnum truncate text-[13px] font-semibold ${x.mono ? "font-mono text-[11.5px]" : ""}`}>{x.v}</span>
                  <span className="text-[10px] text-faint">{x.k}</span>
                </div>
              ))}
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

            {/* the document */}
            <div className="grid min-h-0 grow grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)]">
              <nav className="hidden min-h-0 flex-col overflow-y-auto border-r border-line bg-canvas/40 py-2 md:flex" aria-label="Sections">
                <span className="px-3 pb-1 text-[10px] font-medium tracking-[0.04em] text-ghost uppercase">{headings.length ? "Contents" : "No headings"}</span>
                {headings.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => jump(h.id)}
                    className={`focusable truncate px-3 py-1 text-left text-[11px] text-faint hover:bg-raise hover:text-fg ${h.level === 1 ? "font-semibold text-fg" : h.level === 2 ? "pl-5" : "pl-7 text-[10.5px]"}`}
                    title={h.text}
                  >
                    {h.text}
                  </button>
                ))}
              </nav>
              <div ref={body} className="min-h-0 overflow-y-auto px-5 py-4 text-[12.5px] leading-[1.65] text-fg">
                {!doc.fullTextHeld && (
                  <p className="mb-3 rounded-md border border-line bg-raise/40 px-3 py-2 text-[11px] text-faint">
                    This document was fetched before full text was retained; the opening of it is shown. Fetch the source again to hold the whole document.
                  </p>
                )}
                <Markdown text={text} headingIds />
                {doc.text.length > RENDER_CAP && !showAll && (
                  <div className="mt-4 flex items-center gap-3 rounded-md border border-line bg-raise/40 px-3 py-2 text-[11px] text-faint">
                    Showing the first {kb(RENDER_CAP)} of {kb(doc.text.length)}.
                    <Button size="sm" variant="quiet" onClick={() => setShowAll(true)}>Show everything</Button>
                  </div>
                )}
              </div>
            </div>

            {/* the decision */}
            <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line px-4 py-3">
              {staged ? (
                <>
                  <span className="flex items-center gap-2 text-[11.5px] text-faint">
                    <span className="grid size-5 place-items-center rounded-full bg-ink text-[8.5px] font-semibold text-on-ink">{me?.initials ?? CURRENT_USER.initials}</span>
                    Admitting as <span className="font-medium text-fg">{by}</span>
                  </span>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Reason: authoritative, current, and within our licence."
                    className="focusable h-8 min-w-[240px] grow rounded-md border border-line bg-canvas px-3 text-[12px] text-fg placeholder:text-ghost"
                  />
                  <Button size="sm" variant="solid" tone="ink" permission="configure" loading={busy === "admit"} disabled={Boolean(busy)} onClick={() => decide(true)}>Admit and index</Button>
                  <Button size="sm" variant="solid" tone="err" permission="configure" loading={busy === "refuse"} disabled={Boolean(busy)} onClick={() => decide(false)}>Refuse</Button>
                  {error && <span className="basis-full text-[11.5px] text-err">{error}</span>}
                </>
              ) : (
                <span className="text-[11.5px] text-faint">
                  {doc.status === "admitted" ? "Admitted" : doc.status === "rejected" ? "Refused" : doc.status}
                  {doc.decided_by ? ` by ${doc.decided_by}` : ""}
                  {doc.decided_at ? ` · ${ago(doc.decided_at)}` : ""}
                  {doc.note ? ` · ${doc.note}` : ""}
                </span>
              )}
            </footer>
          </>
        )}
      </div>
    </div>
  );
}
