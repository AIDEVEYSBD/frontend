"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Meter, Status, Tag } from "./ui";
import { Pick } from "./select";
import { Field, Input } from "./forms";
import { GroupHeader } from "./page-tabs";
import { CURRENT_USER } from "@/lib/user";
import { useSession, signerName } from "@/lib/use-session";
import { soon } from "@/lib/soon";
import { Markdown, headingsOf } from "./markdown";
import { SafeLink } from "./safe-link";
import { BrandMark } from "./brand";
import { Donut } from "./charts";
import { PipelineView } from "./pipeline";
import { AskCorpus } from "./ask";
import { FetchModal } from "./fetch-modal";
import { Dialog, EmptyState } from "./overlays";
import { NotConnectedNote, Failure } from "./pending";
import { usePageFacts } from "./assistant";
import { DATA_CLASSES, DOORS, ask, type DataClass, type Door, type DoorId } from "@/lib/api/pending";
import { useDoorBuilt } from "@/lib/use-doors";
import {
  DEFAULT_NAMESPACE,
  FAMILIES,
  LICENCE_NOTE,
  NAMESPACE_RE,
  NAMESPACE_RULE,
  NAMESPACE_SLOT,
  SOURCES,
  UPLOAD_FIELDS,
  type Licence,
  type SourceAddBody,
  type SourceClassBody,
  type SourceClassFields,
} from "@/lib/knowledge";

/**
 * The knowledge base of one corpus.
 *
 * A deployment starts with nothing: no source in its register, nothing
 * fetched, nothing admitted. The page shows the three states a source's
 * content can be in (in the register, waiting for a person, indexed), then
 * the register itself, then the public catalogue a source can be added from,
 * then the search that runs the pipeline an agent runs, and the record of
 * every admission. A source joins the register only when a person adds it
 * here; the catalogue is an offer and is never shown as the deployment's own.
 *
 * The licence column is load-bearing. It is why some sources are cited and
 * never stored.
 *
 * Everything on the page is one namespace's: the corpus picked in the header
 * (remembered per browser) is sent on every call the page makes.
 *
 * Everything is read from and written to the platform service. The public
 * catalogue alone is the console's (lib/knowledge.ts): the service holds no
 * source until a person adds one, so an entry of the catalogue is sent to it
 * only when a person adds that entry here. Adding a source, uploading a
 * document and setting a source's class go through doors declared in
 * lib/api/pending.ts; their forms say so if a deployment does not serve them.
 */

interface Source extends SourceClassFields {
  id: string;
  /** `upload` for a document a person uploaded: the platform marks every upload's licence "open", which says nothing about the document, so it is shown as their own. */
  kind?: string;
  name: string;
  publisher: string;
  family: string;
  licence: Licence;
  use_for: string;
  url: string;
  cadence: string;
  enabled: boolean;
  documents: number;
  staged: number;
  chunks: number;
  last_admitted: string | null;
  /** How its fetches stand, in the service's word: current, changed, overdue, never fetched and so on. */
  health?: string;
  last_fetch_at?: string | null;
  /** What the last fetch came to: staged, unchanged, refused or failed. */
  last_fetch_result?: string;
  last_fetch_detail?: string;
  /** How often the service fetches it again, in days; null when only a person does. */
  refresh_days?: number | null;
  next_refresh_at?: string | null;
  /** An entry of the public catalogue the service does not hold: adding it sends the entry. */
  suggested?: boolean;
}

/** The public catalogue as rows the page can list beside what the service holds. */
const SUGGESTED: Source[] = SOURCES.map((s) => ({
  id: s.id, name: s.name, publisher: s.publisher, family: s.family, licence: s.licence, use_for: s.use, url: s.url, cadence: s.cadence,
  enabled: false, documents: 0, staged: 0, chunks: 0, last_admitted: null, suggested: true,
}));

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
  namespace?: string;
  namespaces?: string[];
  /** The register: sources a person added to this corpus. */
  sources?: Source[];
  /** Sources a person took out of the register: held by the service, left out of retrieval. */
  catalogue?: Source[];
  staged?: Staged[];
  admissions?: { document_id: string; source_id: string; admitted: boolean; by_whom: string; note: string; chunks: number; at: string; title: string }[];
  totals?: { chunks: number; documents: number; admitted: number; tokens: number; sources: number };
  /** Whether retrieval from this corpus's store is switched on (Retrieval access); while it is off, every search and answer is refused. */
  retrieval?: { state: string; reason?: string };
  index?: {
    store: string;
    model: string;
    dimensions: number;
    embeddingReady: boolean;
    /** The embedding endpoint as configured: its host, the width its model answers with (null until the first call), and how many admitted chunks are on another model or width. */
    embedding?: { ready: boolean; model: string; host: string; dimension: number | null; behind: number };
    /** Recomputed on every read against what the latest admission recorded. */
    integrity?: {
      ok: boolean | null;
      expected: string;
      actual: string;
      admission: { id: string; at: string; by_whom: string; model: string; dimensions: number } | null;
      note: string;
    } | null;
  };
}

const LICENCES: Licence[] = ["open", "registration", "licensed"];
const LICENCE_TONE: Record<Licence, "ok" | "warn" | "neutral"> = { open: "ok", registration: "warn", licensed: "neutral" };
const LICENCE_COLOR: Record<Licence, string> = { open: "var(--t-ok)", registration: "var(--t-warn)", licensed: "var(--t-line-strong)" };
const FAMILY_COLOR: Record<string, string> = {
  ai: "var(--t-c2)", frameworks: "var(--t-c5)", threat: "var(--t-c1)",
  cloud: "var(--t-c7)", identity: "var(--t-c8)", regulation: "var(--t-c6)", market: "var(--t-c3)",
};
const OTHER_FAMILY = "__other__";
const familyColor = (id: string) => FAMILY_COLOR[id] ?? "var(--t-line-strong)";
const familyName = (id: string) => FAMILIES.find((f) => f.id === id)?.name ?? "";
const knownFamily = (id: string) => FAMILIES.some((f) => f.id === id);
const inFamily = (s: Source, family: string) => !family || (family === OTHER_FAMILY ? !knownFamily(s.family) : s.family === family);
const hasTerm = (s: Source, term: string) => !term || [s.name, s.publisher, s.use_for].some((v) => (v ?? "").toLowerCase().includes(term));
const canFetch = (s: Source) => s.licence !== "licensed" && Boolean((s.url ?? "").trim());

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

const count = (n: number) => n.toLocaleString("en-GB");

export function Knowledge() {
  const [data, setData] = useState<Data | null>(null);
  /** Why the page's own read failed, when it did. */
  const [failed, setFailed] = useState("");
  /** Which corpus. Null until the browser's remembered choice is read, so the first paint matches the server's. */
  const [namespace, setNamespace] = useState<string | null>(null);
  const [namespaces, setNamespaces] = useState<string[]>([DEFAULT_NAMESPACE]);
  const [family, setFamily] = useState("");
  const [q, setQ] = useState("");
  const [offerFamily, setOfferFamily] = useState("");
  const [offerQ, setOfferQ] = useState("");
  /** The catalogue section, when the person has folded or unfolded it; until then it is open only while the register is empty. */
  const [offerOpen, setOfferOpen] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [review, setReview] = useState<string | null>(null);
  /** The passage to open a document at, when a citation is clicked. */
  const [locate, setLocate] = useState<string | null>(null);
  const [askFacts, setAskFacts] = useState<Record<string, unknown> | null>(null);
  const [fetching, setFetching] = useState<{ id: string; name: string } | null>(null);
  /** The source whose record is open. */
  const [openSource, setOpenSource] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [uploading, setUploading] = useState(false);
  /** The source being added to or removed from the register. */
  const [busyId, setBusyId] = useState<string | null>(null);
  /** The re-embed: confirming or running. */
  const [reembed, setReembed] = useState<null | "confirm" | "busy">(null);
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const toggleFold = (p: string) =>
    setFolded((f) => {
      const n = new Set(f);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  const load = useCallback(() => {
    if (!namespace) return;
    fetch(`/api/knowledge?namespace=${encodeURIComponent(namespace)}`, { cache: "no-store" })
      .then(async (r) => {
        const d = (await r.json().catch(() => null)) as (Data & { error?: string }) | null;
        if (!r.ok || !d) throw new Error(d?.error || `the server answered ${r.status}`);
        setData(d);
        setFailed("");
        if (Array.isArray(d.namespaces) && d.namespaces.length) setNamespaces(d.namespaces);
      })
      .catch((e: Error) => {
        setData(null);
        setFailed(e.message || "the request did not reach the server");
      });
  }, [namespace]);

  // The remembered corpus is read after the first paint, so the server and
  // the client render the same page; the load follows a tick later.
  useEffect(
    () =>
      soon(() => {
        let saved = "";
        try {
          saved = localStorage.getItem(NAMESPACE_SLOT) ?? "";
        } catch {
          /* fresh */
        }
        setNamespace(NAMESPACE_RE.test(saved) ? saved : DEFAULT_NAMESPACE);
      }),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  const pickNamespace = (next: string) => {
    if (!NAMESPACE_RE.test(next) || next === namespace) return;
    try {
      localStorage.setItem(NAMESPACE_SLOT, next);
    } catch {
      /* fine */
    }
    setData(null);
    setFailed("");
    setNotice(null);
    setAskFacts(null);
    setOfferOpen(null);
    setNamespace(next);
  };

  /* Re-embed the namespace with the embedding model configured now. Each
     chunk records the model and width of its vector, so a change of either
     needs no change to the store: only this. */
  const runReembed = async () => {
    if (!namespace) return;
    setReembed("busy");
    try {
      const r = await fetch("/api/knowledge/reembed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ namespace }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string; note?: string; needsReembed?: string[] };
      if (!r.ok) throw new Error(j.error ?? `the server answered ${r.status}`);
      setNotice({ ok: true, text: `${j.note ?? "Re-embedded."}${j.needsReembed?.length ? ` Still on another model: ${j.needsReembed.join(", ")}.` : ""}` });
      load();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
    } finally {
      setReembed(null);
    }
  };

  /* Add a source to this corpus's register, or take it out. A source the
     service already holds is switched; an entry of the public catalogue it
     does not hold is sent to it whole, classed public, which is what a
     published standard is. */
  const setEnabled = async (s: Source, enabled: boolean): Promise<boolean> => {
    if (!namespace) return false;
    setBusyId(s.id);
    try {
      if (s.suggested) {
        const body: SourceAddBody = { namespace, id: s.id, name: s.name, url: s.url, publisher: s.publisher, licence: s.licence, data_class: "public", family: s.family, use_for: s.use_for, cadence: s.cadence };
        const a = await ask<unknown>("knowledgeSourceAdd", { body });
        if (a.state !== "ok") throw new Error(a.state === "error" ? a.message : "this deployment does not serve the door that adds a source");
      } else {
        const r = await fetch("/api/knowledge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: s.id, namespace, enabled }) });
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        if (!r.ok) throw new Error(j.error ?? `the server answered ${r.status}`);
      }
      setNotice({
        ok: true,
        text: enabled
          ? `${s.name} was added to the "${namespace}" corpus. ${s.licence === "licensed" ? "It is cited by reference; no text is held." : "Nothing of it is retrievable until a copy is fetched and a person admits it."}`
          : `${s.name} was removed from the "${namespace}" corpus.`,
      });
      load();
      return true;
    } catch (e) {
      setNotice({ ok: false, text: `${s.name} could not be ${enabled ? "added" : "removed"}: ${(e as Error).message}` });
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const sources = useMemo(() => data?.sources ?? [], [data]);
  /** What can be added: sources taken out of this corpus, then the public catalogue's entries the service does not hold here. */
  const offered = useMemo(() => {
    const removed = data?.catalogue ?? [];
    const held = new Set([...sources, ...removed].map((s) => s.id));
    return [...removed, ...SUGGESTED.filter((s) => !held.has(s.id))];
  }, [data, sources]);
  const staged = data?.staged ?? [];
  const totals = data?.totals;
  /** The store answered: figures are measured. Otherwise they are unknown, not zero. */
  const ready = data?.ready === true;
  /** The read failed or the store did not answer: the failure is shown above, and every figure says it was not read. */
  const off = Boolean(failed) || (data !== null && !ready);
  const offFigure = <span className="mt-1 flex h-[30px] items-center text-[12px] text-faint">Not read</span>;
  /** A row of the index card: what the read gave, or that it was not read. */
  const orOff = (v: string | null | undefined) => (off ? v || "not read" : (v ?? "—"));
  /** Retrieval from this store switched off: the chunks are held, and nothing can retrieve them. */
  const retrievalOff = data?.retrieval && data.retrieval.state && data.retrieval.state !== "enabled" ? data.retrieval : null;
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return sources.filter((s) => inFamily(s, family) && hasTerm(s, term));
  }, [sources, family, q]);
  const offerShown = useMemo(() => {
    const term = offerQ.trim().toLowerCase();
    return offered.filter((s) => inFamily(s, offerFamily) && hasTerm(s, term));
  }, [offered, offerFamily, offerQ]);

  const byLicence = LICENCES.map((l) => ({
    label: LICENCE_NOTE[l].split(".")[0],
    // Uploads are left out: the platform marks every upload "open", which says nothing of the document.
    value: sources.filter((s) => s.licence === l && s.kind !== "upload").length,
    color: LICENCE_COLOR[l],
  }));
  const indexed = sources.filter((s) => Number(s.chunks) > 0).length;
  const classed = sources.some((s) => s.data_class || (s.entitled && s.entitled.length));
  // The register reads by publisher. Largest publishers first.
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
  const offerIsOpen = offerOpen ?? ((data !== null || off) && sources.length === 0);
  const columns = classed ? 7 : 6;
  const current = openSource ? [...sources, ...offered].find((s) => s.id === openSource) ?? null : null;
  const ns = namespace ?? DEFAULT_NAMESPACE;

  usePageFacts(
    data
      ? {
          ready: data.ready,
          namespace: data.namespace ?? namespace,
          namespacesAvailable: namespaces,
          totals: data.totals,
          index: data.index,
          sourcesInTheRegister: sources.length,
          sourcesOfferedAndNotAdded: offered.length,
          sourcesIndexed: indexed,
          stagedAwaitingAPerson: staged.map((s) => ({ title: s.title, chunks: s.chunks })),
          familyFilter: family && family !== OTHER_FAMILY ? family : null,
          lastAsked: askFacts,
        }
      : null,
  );

  return (
    <div className="min-h-full" data-hue="violet">
      <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-5 px-5 py-7">
        {/* ── header ── */}
        <GroupHeader
          group="data"
          tab="knowledge"
          actions={
            <>
              <Button variant="solid" tone="neutral" permission="configure" onClick={() => setUploading(true)}>
                Upload a document
              </Button>
              <Button variant="solid" tone="ink" permission="configure" onClick={() => setAdding(true)}>
                Add a source
              </Button>
            </>
          }
        >
          The sources people search here, and agents with a read grant search through their retrieval.search tool. A person adds a source, a copy of it is fetched, and a person admits that copy before any of it can be searched; a bucket connector&rsquo;s documents are admitted instead by its rule, which a second person admits once. Each
          engagement has its own corpus; the one open here is <span className="font-mono text-[11.5px] text-fg">{ns}</span>.
        </GroupHeader>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2.5 elev-1">
          <NamespacePicker value={ns} options={namespaces} loading={!namespace} onChange={pickNamespace} />
          <span className="text-[11.5px] leading-[1.5] text-faint">Everything below is this corpus&rsquo;s and no other&rsquo;s.</span>
        </div>

        {failed && <Failure what="The knowledge base could not be read" message={failed} />}
        {retrievalOff && (
          <p className="rounded-md border border-warn/40 bg-surface px-3 py-2.5 text-[11.5px] leading-[1.5] text-warn">
            Retrieval from this corpus&rsquo;s store is switched off{retrievalOff.reason ? `: ${retrievalOff.reason}` : ""}. Every search and answer here is refused until it is switched back on under Retrieval access.
          </p>
        )}
        {data && !data.ready && (
          <p className="rounded-md border border-err/40 bg-surface px-3 py-2.5 text-[11.5px] leading-[1.5] text-err">
            {data.error} Which sources this corpus holds, and what is indexed, is not known until the store answers.
          </p>
        )}
        {notice && (
          <p className={`rounded-md border px-3 py-2 text-[11.5px] leading-[1.5] ${notice.ok ? "border-line bg-surface text-faint" : "border-err/40 bg-surface text-err"}`}>
            {notice.text}
          </p>
        )}

        {/* ── three states ── */}
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="flex flex-col rounded-lg border border-line bg-surface p-4 elev-1">
            <span className="text-[11px] font-medium tracking-[0.06em] text-faint uppercase">In the register</span>
            {off ? offFigure : <span className="tnum mt-1 text-[30px] leading-none font-semibold tracking-[-0.025em]">{ready ? count(sources.length) : "—"}</span>}
            <span className="mt-1 text-[11.5px] text-faint">source{sources.length === 1 ? "" : "s"} a person added to this corpus</span>
            <div className="mt-4 border-t border-line pt-3">
              {ready && sources.length > 0 && <Donut data={byLicence.filter((d) => d.value > 0)} size={96} />}
              {ready && sources.length === 0 && (
                <p className="text-[11.5px] leading-[1.55] text-dim">No source has been added. Add one from the public sources below, or add your own.</p>
              )}
              {!ready && <span className={`text-[11.5px] ${off ? "leading-[1.55] text-faint" : "text-ghost"}`}>{off ? "The sources in the register are counted here by licence." : data ? "Unknown while the store is unreachable." : failed ? "Unknown." : "Reading…"}</span>}
            </div>
          </section>

          <section className={`flex flex-col rounded-lg border p-4 elev-1 ${staged.length ? "border-warn/50 bg-surface" : "border-line bg-surface"}`}>
            <span className="text-[11px] font-medium tracking-[0.06em] text-faint uppercase">Waiting for a person</span>
            {off ? offFigure : <span className={`tnum mt-1 text-[30px] leading-none font-semibold tracking-[-0.025em] ${staged.length ? "text-warn" : ""}`}>{ready ? count(staged.length) : "—"}</span>}
            <span className="mt-1 text-[11.5px] text-faint">fetched and split · not embedded, not searchable</span>
            <div className="mt-4 flex flex-col gap-1.5 border-t border-line pt-3">
              {ready && staged.length === 0 && (
                <p className="text-[11.5px] leading-[1.55] text-dim">
                  Nothing is waiting. {sources.length ? "Fetch a source in the register to stage a copy." : "A copy is staged when a source in the register is fetched."}
                </p>
              )}
              {!ready && <span className={`text-[11.5px] ${off ? "leading-[1.55] text-faint" : "text-ghost"}`}>{off ? "Fetched copies waiting for a person to review are listed here." : data ? "Unknown while the store is unreachable." : failed ? "Unknown." : "Reading…"}</span>}
              {staged.length > 0 && (
                <div className="-mr-2 flex max-h-[188px] flex-col gap-1.5 overflow-y-auto pr-2">
                  {staged.map((s) => (
                    <div key={s.id} className="flex items-center gap-2">
                      <span className="flex min-w-0 grow flex-col">
                        <span className="truncate text-[12px] text-fg">{s.title}</span>
                        <span className="truncate text-[10px] text-faint">{s.chunks} chunks · {ago(s.fetched_at)}</span>
                      </span>
                      <Button size="sm" variant="outline" tone="warn" onClick={() => setReview(s.id)}>Review</Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="flex flex-col rounded-lg border border-line bg-surface p-4 elev-1">
            <span className="text-[11px] font-medium tracking-[0.06em] text-faint uppercase">Indexed</span>
            {off ? offFigure : <span className="tnum mt-1 text-[30px] leading-none font-semibold tracking-[-0.025em]">{ready && totals ? count(totals.chunks) : "—"}</span>}
            <span className="mt-1 text-[11.5px] text-faint">
              {ready && totals ? `chunk${totals.chunks === 1 ? "" : "s"} ${retrievalOff ? "held, with retrieval switched off" : "retrievable now"}, from ${count(totals.admitted)} admitted document${totals.admitted === 1 ? "" : "s"}` : "chunks indexed"}
            </span>
            <div className="mt-4 flex flex-col gap-2 border-t border-line pt-3 text-[11.5px]">
              <Row k="Store" v={orOff(data?.index?.store)} faint={off && !data?.index?.store} />
              <Row k="Embedding" v={orOff(data?.index?.model)} mono={!off || Boolean(data?.index?.model)} faint={off && !data?.index?.model} />
              <Row k="Provider" v={data?.index?.embedding ? (data.index.embedding.host || "not configured") : orOff(null)} mono={!off || Boolean(data?.index?.embedding?.host)} faint={off && !data?.index?.embedding?.host} />
              <Row
                k="Dimensions"
                v={
                  data?.index && !(off && !data.index.dimensions)
                    ? `${data.index.dimensions ? `${data.index.dimensions} held` : "none held"}${data.index.embedding?.behind ? ` · ${count(data.index.embedding.behind)} chunks on another model` : ""}`
                    : orOff(null)
                }
                faint={off && !data?.index?.dimensions}
              />
              <Row k="Sources indexed" v={ready ? `${indexed} of ${sources.length}` : orOff(null)} faint={off} />
              {ready && sources.length > 0 && <Meter value={indexed / sources.length} tone="ok" />}
            </div>
            {/* Integrity: recomputed on this read against what the latest admission recorded. */}
            <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
              {data?.index?.integrity === undefined || data?.index?.integrity === null ? (
                <span className="text-[11px] text-faint">{off ? "Integrity: not read." : data?.ready === false ? "Integrity is checked once the index is reachable." : data ? "No integrity result came with this read." : "Integrity: reading…"}</span>
              ) : (
                <span className="flex flex-col gap-0.5">
                  <Status tone={data.index.integrity.ok === true ? "ok" : data.index.integrity.ok === false ? "err" : "neutral"}>
                    {data.index.integrity.ok === true ? "index matches the latest admission" : data.index.integrity.ok === false ? "index changed outside admission" : "no integrity expectation yet"}
                  </Status>
                  <span className="text-[10.5px] leading-[1.5] text-faint">
                    {data.index.integrity.note}
                    {data.index.integrity.admission ? ` Latest admission #${data.index.integrity.admission.id} by ${data.index.integrity.admission.by_whom}${data.index.integrity.admission.model ? ` with ${data.index.integrity.admission.model} (${data.index.integrity.admission.dimensions}d)` : ""}.` : ""}
                  </span>
                </span>
              )}
              <span className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="solid" tone="ink" permission="configure" disabled={!data?.ready || !totals?.admitted || reembed === "busy"} loading={reembed === "busy"} onClick={() => setReembed("confirm")}>
                  Re-embed namespace
                </Button>
                <span className="text-[10.5px] text-ghost">{off ? "every admitted chunk, with the configured model" : !ready ? "needs the store" : totals?.admitted ? "every admitted chunk, with the configured model" : "nothing is admitted, so there is nothing to embed"}</span>
              </span>
            </div>
          </section>
        </div>

        {/* ── the register ── */}
        <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/55 px-4 py-2.5">
            <span className="text-[12.5px] font-semibold tracking-[-0.005em]">Sources in this corpus</span>
            <span className="tnum text-[11px] text-faint">{off ? "" : data ? (ready ? (shown.length === sources.length ? count(sources.length) : `${shown.length} of ${sources.length}`) : "unknown") : failed ? "" : "reading…"}</span>
            <span className="grow" />
            {sources.length > 0 && (
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search"
                aria-label="Search the register"
                className="focusable h-7 w-40 rounded-sm border border-line bg-canvas px-2 text-[11.5px] text-fg placeholder:text-ghost"
              />
            )}
          </div>
          {sources.length > 0 && <FamilyChips rows={sources} value={family} onChange={setFamily} />}
          {sources.length > 0 && (
            <div className="max-h-[520px] overflow-x-auto overflow-y-auto">
              <table className="w-full min-w-[920px] border-collapse text-left">
                <thead className="sticky top-0 z-10 bg-surface">
                  <tr className="border-b border-line text-[10.5px] text-faint">
                    <th className="px-4 py-2.5 font-medium">Source</th>
                    <th className="px-3 py-2.5 font-medium">Licence</th>
                    <th className="px-3 py-2.5 font-medium">Used for</th>
                    {classed && <th className="px-3 py-2.5 font-medium">Data class</th>}
                    <th className="px-3 py-2.5 font-medium">Indexed</th>
                    <th className="px-3 py-2.5 font-medium">Cadence</th>
                    <th className="px-3 py-2.5 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <Fragment key={g.publisher}>
                      <tr className="border-b border-line bg-raise/40">
                        <td colSpan={columns} className="p-0">
                          <button type="button" onClick={() => toggleFold(g.publisher)} aria-expanded={!folded.has(g.publisher)} className="focusable flex w-full cursor-pointer items-center gap-2.5 px-4 py-2 text-left hover:bg-raise/70">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 text-faint transition-transform ${folded.has(g.publisher) ? "-rotate-90" : ""}`}>
                              <path d="M6 9l6 6 6-6" />
                            </svg>
                            <BrandMark name={g.publisher} size={18} />
                            <span className="text-[12.5px] font-semibold text-fg">{g.publisher || "No publisher named"}</span>
                            <span className="text-[11px] text-faint">{g.rows.length} source{g.rows.length === 1 ? "" : "s"}</span>
                            <span className="grow" />
                            <span className="tnum text-[10.5px] text-faint">{g.indexed} indexed{g.staged ? ` · ${g.staged} waiting` : ""}</span>
                            <span className="text-[10.5px] text-ghost">{folded.has(g.publisher) ? "show" : ""}</span>
                          </button>
                        </td>
                      </tr>
                      {!folded.has(g.publisher) &&
                        g.rows.map((s) => (
                          <tr key={s.id} onClick={() => setOpenSource(s.id)} className="cursor-pointer border-b border-line transition-colors last:border-0 hover:bg-raise/50">
                            <td className="max-w-[380px] px-4 py-2.5">
                              <span className="flex items-center gap-2.5">
                                <span className="h-7 w-[3px] shrink-0 rounded-full" style={{ background: familyColor(s.family) }} />
                                <BrandMark name={s.publisher} size={18} />
                                <span className="flex min-w-0 flex-col">
                                  <button type="button" onClick={(e) => { e.stopPropagation(); setOpenSource(s.id); }} className="focusable w-fit max-w-full cursor-pointer truncate rounded-sm text-left text-[12.5px] font-medium text-fg hover:underline">
                                    {s.name}
                                  </button>
                                  <span className="truncate text-[10.5px] text-faint">{s.publisher}</span>
                                </span>
                              </span>
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              {s.kind === "upload" ? <span title="A document uploaded by a person on this deployment"><Status tone="neutral">own document</Status></span> : <span title={LICENCE_NOTE[s.licence]}><Status tone={LICENCE_TONE[s.licence] ?? "neutral"}>{s.licence}</Status></span>}
                            </td>
                            <td className="max-w-[300px] px-3 py-2.5 text-[11px] leading-[1.45] text-faint">{s.use_for}</td>
                            {classed && (
                              <td className="px-3 py-2.5 whitespace-nowrap">
                                <span className="flex flex-col items-start gap-0.5">
                                  {s.data_class && <Tag>{s.data_class}</Tag>}
                                  {s.entitled && s.entitled.length > 0 && <span className="max-w-[180px] truncate text-[10.5px] text-faint" title={s.entitled.join(", ")}>{s.entitled.join(", ")}</span>}
                                </span>
                              </td>
                            )}
                            <td className="px-3 py-2.5 whitespace-nowrap">
                              {Number(s.chunks) > 0 ? (
                                <span className="flex flex-col">
                                  <span className="tnum font-mono text-[11px] text-fg">{s.chunks} <span className="font-sans text-faint">chunks</span></span>
                                  {s.last_admitted && <span className="text-[10px] text-ghost">admitted {ago(s.last_admitted)}</span>}
                                </span>
                              ) : Number(s.staged ?? 0) > 0 ? (
                                <span className="text-[11px] text-warn">{s.staged} waiting for a person</span>
                              ) : (
                                <span className="text-[11px] text-ghost">not indexed</span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap text-[11px] text-faint">{s.cadence}</td>
                            <td className="px-3 py-2.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                              {s.licence === "licensed" ? (
                                <Tag>cited only</Tag>
                              ) : canFetch(s) ? (
                                <Button size="sm" variant="quiet" permission="configure" onClick={() => setFetching({ id: s.id, name: s.name })}>Fetch</Button>
                              ) : (
                                <span className="text-[11px] text-ghost">no address</span>
                              )}
                            </td>
                          </tr>
                        ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {sources.length > 0 && shown.length === 0 && <p className="px-4 py-4 text-[12px] text-faint">No source in the register matches.</p>}
          {off && sources.length === 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] border-collapse text-left">
                <thead>
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
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-[12px] text-faint">Sources added to this corpus are listed here by publisher, each with its licence and what is indexed.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          {!data && !failed && <p className="px-4 py-4 text-[12px] text-faint">Reading the register…</p>}
          {!off && !data && failed && <p className="px-4 py-4 text-[12px] text-faint">The register could not be read, so nothing is shown.</p>}
          {!off && data && !ready && <p className="px-4 py-4 text-[12px] text-faint">The register is kept in the store, which is not reachable, so it is not shown.</p>}
          {ready && sources.length === 0 && (
            <div className="p-4">
              <EmptyState
                title="No sources in this corpus yet"
                detail="Nothing has been added, so nothing can be fetched, admitted or retrieved. Add a public source from the list below, or add a source of your own."
                action={
                  <Button size="sm" variant="solid" tone="ink" permission="configure" onClick={() => setAdding(true)}>
                    Add a source
                  </Button>
                }
              />
            </div>
          )}
        </section>

        {/* ── connectors: a body of documents ── */}
        {namespace && <ConnectorsSection namespace={namespace} onDocument={(id) => setReview(id)} />}

        {/* ── the public catalogue: offered, not held ── */}
        {(data || off) && (
          <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
            <button
              type="button"
              onClick={() => setOfferOpen(!offerIsOpen)}
              aria-expanded={offerIsOpen}
              aria-controls="knowledge-offer"
              className={`focusable flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 bg-raise/55 px-4 py-2.5 text-left ${offerIsOpen ? "border-b border-line" : ""}`}
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 text-faint transition-transform ${offerIsOpen ? "" : "-rotate-90"}`}>
                <path d="M6 9l6 6 6-6" />
              </svg>
              <span className="text-[12.5px] font-semibold tracking-[-0.005em]">Public sources you can add</span>
              <span className="tnum text-[11px] text-faint">{off && !data ? "" : count(offered.length)}</span>
              <span className="text-[11px] leading-[1.55] text-faint">published standards, frameworks and regulation · none is part of this corpus until a person adds it</span>
              <span className="grow" />
              <span className="text-[10.5px] text-ghost">{offerIsOpen ? "hide" : "show"}</span>
            </button>
            {offerIsOpen && (
              <div id="knowledge-offer" className="flex flex-col">
                {offered.length > 0 && (
                  <div className="flex items-start gap-2 border-b border-line pr-3">
                    <span className="min-w-0 grow">
                      <FamilyChips rows={offered} value={offerFamily} onChange={setOfferFamily} bare />
                    </span>
                    <input
                      value={offerQ}
                      onChange={(e) => setOfferQ(e.target.value)}
                      placeholder="Search"
                      aria-label="Search the public sources"
                      className="focusable mt-2 h-7 w-32 shrink-0 rounded-sm border border-line bg-canvas px-2 text-[11.5px] text-fg placeholder:text-ghost sm:w-40"
                    />
                  </div>
                )}
                {offered.length > 0 && (
                  <div className="max-h-[440px] overflow-x-auto overflow-y-auto">
                    <table className="w-full min-w-[860px] border-collapse text-left">
                      <thead className="sticky top-0 z-10 bg-surface">
                        <tr className="border-b border-line text-[10.5px] text-faint">
                          <th className="px-4 py-2.5 font-medium">Source</th>
                          <th className="px-3 py-2.5 font-medium">Licence</th>
                          <th className="px-3 py-2.5 font-medium">Used for</th>
                          <th className="px-3 py-2.5 font-medium">Cadence</th>
                          <th className="px-3 py-2.5 font-medium" />
                        </tr>
                      </thead>
                      <tbody>
                        {offerShown.map((s) => (
                          <tr key={s.id} className="border-b border-line last:border-0">
                            <td className="max-w-[400px] px-4 py-2">
                              <span className="flex items-center gap-2.5">
                                <span className="h-7 w-[3px] shrink-0 rounded-full" style={{ background: familyColor(s.family) }} />
                                <BrandMark name={s.publisher} size={18} />
                                <span className="flex min-w-0 flex-col">
                                  <span className="truncate text-[12.5px] font-medium text-fg">{s.name}</span>
                                  <span className="truncate text-[10.5px] text-faint">
                                    {s.publisher}
                                    {familyName(s.family) ? ` · ${familyName(s.family)}` : ""}
                                  </span>
                                </span>
                              </span>
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap">
                              {s.kind === "upload" ? <span title="A document uploaded by a person on this deployment"><Status tone="neutral">own document</Status></span> : <span title={LICENCE_NOTE[s.licence]}><Status tone={LICENCE_TONE[s.licence] ?? "neutral"}>{s.licence}</Status></span>}
                            </td>
                            <td className="max-w-[320px] px-3 py-2 text-[11px] leading-[1.45] text-faint">
                              {s.use_for}
                              {Number(s.chunks) > 0 && <span className="block text-warn">{s.chunks} chunks from an earlier admission are held and left out of retrieval.</span>}
                            </td>
                            <td className="px-3 py-2 whitespace-nowrap text-[11px] text-faint">{s.cadence}</td>
                            <td className="sticky right-0 bg-surface px-3 py-2 text-right whitespace-nowrap">
                              <Button size="sm" variant="solid" tone="neutral" permission="configure" disabled={!ready || (busyId !== null && busyId !== s.id)} loading={busyId === s.id} onClick={() => setEnabled(s, true)}>
                                Add
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {offered.length > 0 && offerShown.length === 0 && <p className="px-4 py-4 text-[12px] text-faint">No public source matches.</p>}
                {offered.length === 0 && <p className="px-4 py-4 text-[12px] text-faint">{ready ? "Every public source on offer is already in this corpus." : off ? "Published standards, frameworks and regulation are offered here, each ready to add." : "The list of public sources did not come with this read."}</p>}
                {!ready && offered.length > 0 && <p className="border-t border-line px-4 py-2.5 text-[11.5px] text-faint">Adding waits for the store: a source is added by writing it to this corpus&rsquo;s register.</p>}
              </div>
            )}
          </section>
        )}

        {/* ── ask it ── */}
        {ready && totals && totals.chunks > 0 ? (
          <AskCorpus
            namespace={ns}
            onLocate={(documentId, body) => {
              setLocate(body);
              setReview(documentId);
            }}
            onResult={setAskFacts}
          />
        ) : off ? (
          // Store not read: the box takes no question; the failure is shown above.
          <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
            <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/55 px-4 py-2.5">
              <span className="text-[12.5px] font-semibold tracking-[-0.005em]">Search and answer from this corpus</span>
            </div>
            <div className="flex flex-wrap items-center gap-2 px-4 py-3">
              <input disabled placeholder="Ask a question the admitted sources can answer" aria-label="Ask the corpus" className="h-9 min-w-0 grow rounded-md border border-line bg-canvas px-3 text-[12.5px] text-fg placeholder:text-ghost" />
              <Button size="md" variant="solid" tone="ink" disabled>Answer</Button>
              <Button size="md" variant="solid" disabled>Search</Button>
            </div>
            <p className="border-t border-line px-4 py-4 text-[12px] leading-[1.55] text-faint">Passages found and answers with their citations are shown here.</p>
          </section>
        ) : (
          <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
            <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/55 px-4 py-2.5">
              <span className="text-[12.5px] font-semibold tracking-[-0.005em]">Search and answer from this corpus</span>
            </div>
            <p className="px-4 py-4 text-[12px] leading-[1.55] text-faint">
              {ready
                ? "Nothing is indexed in this corpus, so there is nothing to search. Search and answer open here once a document has been admitted."
                : data
                  ? "Search needs the store, which is not reachable."
                  : failed
                    ? "Search is not shown because the knowledge base could not be read."
                    : "Reading…"}
            </p>
          </section>
        )}

        {/* ── admissions ── */}
        <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/55 px-4 py-2.5">
            <span className="text-[12.5px] font-semibold tracking-[-0.005em]">Admission record</span>
            <span className="text-[11px] text-faint">every admission and refusal in this corpus, newest first</span>
          </div>
          {off && (data?.admissions ?? []).length === 0 && <p className="px-4 py-3 text-[11.5px] text-faint">Each decision is listed here with the document, who decided and when.</p>}
          {!off && !data && <p className="px-4 py-3 text-[11.5px] text-faint">{failed ? "The record could not be read." : "Reading…"}</p>}
          {!off && data && !ready && <p className="px-4 py-3 text-[11.5px] text-faint">The record is kept in the store, which is not reachable.</p>}
          {ready && (data?.admissions ?? []).length === 0 && <p className="px-4 py-3 text-[11.5px] text-faint">Nothing has been admitted or refused in this corpus yet.</p>}
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

        {/* ── the stages, explained ── */}
        <PipelineView />

        {ready && (
          <p className="pb-2 text-[10.5px] leading-[1.5] text-ghost">
            The register is the sources a person added to the &ldquo;{ns}&rdquo; corpus; document, chunk and admission figures are read from that corpus of the index on each load; the integrity
            digest is recomputed on each load and compared with the latest admission&rsquo;s.
          </p>
        )}
      </div>

      {reembed && (
        <Dialog
          modal
          title={`Re-embed "${namespace}"?`}
          confirm="Re-embed"
          cancel="Cancel"
          tone="ink"
          loading={reembed === "busy"}
          onConfirm={runReembed}
          onClose={() => setReembed(null)}
        >
          {`Every admitted chunk in this namespace is embedded again with ${data?.index?.model || "the configured model"}${data?.index?.embedding?.host ? ` on ${data.index.embedding.host}` : ""}. A chunk whose vector was made by another model or width is found by wording only until it has been rewritten. The act is recorded in the admission record with the model and width.`}
        </Dialog>
      )}

      {current && !fetching && (
        <SourceDialog
          key={current.id}
          source={current}
          namespace={ns}
          storeReady={ready}
          busy={busyId === current.id}
          onClose={() => setOpenSource(null)}
          onFetch={() => {
            setOpenSource(null);
            setFetching({ id: current.id, name: current.name });
          }}
          onEnable={async (enabled) => {
            const ok = await setEnabled(current, enabled);
            if (ok) setOpenSource(null);
          }}
          onSaved={(text) => {
            setNotice({ ok: true, text });
            load();
          }}
        />
      )}
      {adding && (
        <AddSourceDialog
          namespace={ns}
          namespaces={namespaces}
          onClose={() => setAdding(false)}
          onDone={(text) => {
            setAdding(false);
            setNotice({ ok: true, text });
            load();
          }}
        />
      )}
      {uploading && (
        <UploadDocumentDialog
          namespace={ns}
          namespaces={namespaces}
          onClose={() => setUploading(false)}
          onDone={(text, documentId, into) => {
            setUploading(false);
            setNotice({ ok: true, text });
            load();
            if (documentId && into === ns) setReview(documentId);
          }}
        />
      )}

      {fetching && (
        <FetchModal
          sourceId={fetching.id}
          sourceName={fetching.name}
          namespace={ns}
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
          namespace={ns}
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

function Row({ k, v, mono, faint }: { k: string; v: string; mono?: boolean; faint?: boolean }) {
  return (
    <span className="flex items-baseline justify-between gap-3">
      <span className="text-faint">{k}</span>
      <span className={`tnum truncate ${faint ? "text-faint" : "text-fg"} ${mono ? "font-mono text-[11px]" : ""}`}>{v}</span>
    </span>
  );
}

const NEW_NAMESPACE = "__new__";

/**
 * Which corpus the page is looking at.
 *
 * The list is what exists in the index (the default always among them) and
 * one more entry, "new…", which takes a name. A namespace exists once it has
 * been opened: the first read offers the public catalogue to it, with
 * nothing added, so the next load lists it.
 */
function NamespacePicker({ value, options, loading, onChange }: { value: string; options: string[]; loading?: boolean; onChange: (next: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const listed = options.includes(value) ? options : [value, ...options];
  const valid = NAMESPACE_RE.test(draft);
  const create = () => {
    if (!valid) return;
    onChange(draft);
    setAdding(false);
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-faint">Corpus</span>
      <div className="w-[200px]">
        <Pick<string>
          value={adding ? NEW_NAMESPACE : value}
          loading={loading}
          aria-label="Corpus namespace"
          options={[...listed.map((n) => ({ value: n, label: n })), { value: NEW_NAMESPACE, label: "new…" }]}
          onChange={(v) => {
            if (v === NEW_NAMESPACE) setAdding(true);
            else {
              setAdding(false);
              onChange(v);
            }
          }}
        />
      </div>
      {adding && (
        <>
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value.toLowerCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
              if (e.key === "Escape") {
                setAdding(false);
                setDraft("");
              }
            }}
            placeholder="engagement-name"
            aria-label="New namespace"
            aria-invalid={draft.length > 0 && !valid ? true : undefined}
            title={NAMESPACE_RULE}
            className={`focusable h-8 w-[180px] rounded-md border bg-canvas px-2.5 font-mono text-[12px] text-fg placeholder:text-ghost ${draft && !valid ? "border-err" : "border-line"}`}
          />
          <Button size="sm" variant="solid" tone="ink" disabled={!valid} onClick={create}>Open</Button>
          <Button size="sm" variant="solid" tone="err" onClick={() => { setAdding(false); setDraft(""); }}>Cancel</Button>
        </>
      )}
    </div>
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

function DocumentModal({ id, namespace, locate, onClose, onDone }: { id: string; namespace: string; locate?: string | null; onClose: () => void; onDone: (text: string, ok: boolean) => void }) {
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
    fetch(`/api/knowledge/document?id=${encodeURIComponent(id)}&namespace=${encodeURIComponent(namespace)}`)
      .then(async (r) => {
        // A page in place of an answer is no message: the status alone is the reason.
        const d = await r.json().catch(() => null);
        if (!d) throw new Error(`the server answered ${r.status}`);
        return d;
      })
      .then((d) => {
        if (stop) return;
        if (d.error) setFailed(String(d.error));
        else setDoc(d as Doc);
      })
      .catch((e) => !stop && setFailed((e as Error).message));
    return () => {
      stop = true;
    };
  }, [id, namespace]);

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
      const res = await fetch("/api/knowledge/admit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ document: doc.id, namespace, admit, by, note: note.trim() }) });
      const d = await res.json().catch(() => ({ error: `the server answered ${res.status}` }));
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
                <SafeLink href={doc.url.split(/\s+/)[0]} className="focusable truncate underline">
                  {doc.url.split(/\s+/)[0]}
                </SafeLink>
                {doc.parts > 1 && <span>· {doc.parts} parts</span>}
              </span>
            )}
          </span>
          <Button size="sm" variant="solid" tone="err" onClick={onClose}>Close</Button>
        </header>

        {failed && (<p className="px-4 py-4 text-[12px] text-err">{failed}</p>)}

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
                  {error && (<span className="basis-full text-[11.5px] text-err">{error}</span>)}
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

/* ═══════════════════ dialogs of the register ═══════════════════ */

/** The families among some rows, as filter chips; "Other" gathers rows whose family the catalogue does not name. */
function FamilyChips({ rows, value, onChange, bare = false }: { rows: Source[]; value: string; onChange: (next: string) => void; bare?: boolean }) {
  const present = FAMILIES.filter((f) => rows.some((r) => r.family === f.id));
  const other = rows.some((r) => !knownFamily(r.family));
  if (present.length + (other ? 1 : 0) < 2) return bare ? <span className="block h-11" /> : null;
  return (
    <div className={`flex flex-wrap items-center gap-1 px-3 py-2 ${bare ? "" : "border-b border-line"}`}>
      <FamilyChip active={value === ""} color="var(--t-fg-3)" label="All" onClick={() => onChange("")} />
      {present.map((f) => (
        <FamilyChip key={f.id} active={value === f.id} color={familyColor(f.id)} label={f.name} onClick={() => onChange(value === f.id ? "" : f.id)} />
      ))}
      {other && <FamilyChip active={value === OTHER_FAMILY} color={familyColor("")} label="Other" onClick={() => onChange(value === OTHER_FAMILY ? "" : OTHER_FAMILY)} />}
    </div>
  );
}

/**
 * Whether the platform serves a door, from its own list of built addresses
 * (`GET /api/doors`, lib/use-doors.ts). The doors here are writes, so a form
 * says it is not connected before a person fills it in, not after. Only an
 * address the platform lists as not built reads as pending; while the list is
 * unknown the form stays usable and a press learns the truth from the answer.
 */
function useDoorThere(id: DoorId): "there" | "pending" {
  const door: Door = DOORS[id];
  return useDoorBuilt(door.method, door.path) === false ? "pending" : "there";
}

/** The frame of a dialog on this page: a scrim, a titled panel, a body that scrolls, a footer for the actions. */
function Frame({ title, subtitle, mark, width = "w-[min(640px,100%)]", locked = false, onClose, footer, children }: { title: string; subtitle?: ReactNode; mark?: ReactNode; width?: string; locked?: boolean; onClose: () => void; footer?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (locked) return;
    const onKey = (e: KeyboardEvent) => {
      // A dialog opened over this one answers Escape first and marks it handled.
      if (e.key === "Escape" && !e.defaultPrevented) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked, onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/75 p-3 sm:p-6" onClick={locked ? undefined : onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} className={`flex max-h-[88vh] ${width} flex-col overflow-hidden rounded-lg border border-line bg-surface elev-3 af-pop`}>
        <header className="flex shrink-0 items-start gap-3 border-b border-line px-4 py-3">
          {mark}
          <span className="flex min-w-0 grow flex-col">
            <span className="truncate text-[14px] font-semibold tracking-[-0.005em]">{title}</span>
            {subtitle && <span className="text-[11.5px] leading-[1.5] text-faint">{subtitle}</span>}
          </span>
          <span className="shrink-0">
            <Button size="sm" variant="solid" tone="err" disabled={locked} onClick={onClose}>Close</Button>
          </span>
        </header>
        <div className="min-h-0 grow overflow-y-auto">{children}</div>
        {footer && <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-4 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

/** One of the four data classes, as a row of radio chips. */
function ClassChips({ value, onChange, disabled, labelledBy }: { value: DataClass | null; onChange: (c: DataClass) => void; disabled?: boolean; labelledBy: string }) {
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="flex flex-wrap gap-1.5">
      {DATA_CLASSES.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          disabled={disabled}
          onClick={() => onChange(c)}
          className={`focusable inline-flex h-8 cursor-pointer items-center rounded-sm border px-3 text-[12.5px] font-medium transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-40 ${
            value === c ? "border-transparent bg-ink text-on-ink" : "border-line bg-surface text-dim hover:bg-raise hover:text-fg"
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

function PendingLine({ door }: { door: DoorId | Door }) {
  return (
    <p className="rounded-md border border-dashed border-line-strong bg-surface px-3 py-2">
      <NotConnectedNote door={door} />
    </p>
  );
}

const namesOf = (text: string) => [...new Set(text.split(",").map((t) => t.trim()).filter(Boolean))];

/**
 * One source's record: what it is, where it is fetched from, what of it is
 * indexed, its data class and who is entitled to it, and the two things a
 * curator does with it: fetch a copy, or take it out of the corpus.
 */
function SourceDialog({
  source: s,
  namespace,
  storeReady,
  busy,
  onClose,
  onFetch,
  onEnable,
  onSaved,
}: {
  source: Source;
  namespace: string;
  storeReady: boolean;
  busy: boolean;
  onClose: () => void;
  onFetch: () => void;
  onEnable: (enabled: boolean) => void;
  onSaved: (text: string) => void;
}) {
  const there = useDoorThere("knowledgeSourceClass");
  const [cls, setCls] = useState<DataClass | null>(s.data_class ?? null);
  const [entitled, setEntitled] = useState((s.entitled ?? []).join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [waits, setWaits] = useState<Door | null>(null);
  const [removing, setRemoving] = useState(false);

  const pending = there === "pending" || waits !== null;
  const names = namesOf(entitled);
  const changed = cls !== (s.data_class ?? null) || names.join("|") !== (s.entitled ?? []).join("|");
  const urls = (s.url ?? "").trim().split(/\s+/).filter(Boolean);
  const chunks = Number(s.chunks);

  const save = async () => {
    if (!cls) return;
    setSaving(true);
    setError("");
    const body: SourceClassBody = { namespace, data_class: cls, entitled: names };
    const a = await ask<unknown>("knowledgeSourceClass", { params: { id: s.id }, body });
    setSaving(false);
    if (a.state === "pending") setWaits(a.door);
    else if (a.state === "error") setError(a.message);
    else onSaved(`${s.name}: data class set to ${cls}${names.length ? `, entitled: ${names.join(", ")}` : ", with no named restriction"}.`);
  };

  return (
    <>
      <Frame
        title={s.name}
        subtitle={[s.publisher, familyName(s.family)].filter(Boolean).join(" · ")}
        mark={<BrandMark name={s.publisher} size={22} />}
        width="w-[min(780px,100%)]"
        locked={removing || saving}
        onClose={onClose}
        footer={
          <>
            {s.enabled ? (
              <Button size="sm" variant="solid" tone="err" permission="configure" disabled={!storeReady || busy} onClick={() => setRemoving(true)}>
                Remove from this corpus
              </Button>
            ) : (
              <Button size="sm" variant="solid" tone="ink" permission="configure" disabled={!storeReady} loading={busy} onClick={() => onEnable(true)}>
                Add to this corpus
              </Button>
            )}
            <span className="grow" />
            {s.enabled && s.licence === "licensed" && <span className="text-[11.5px] text-faint">Cited by reference; no text is fetched or held.</span>}
            {s.enabled && s.licence !== "licensed" && !canFetch(s) && <span className="text-[11.5px] text-faint">No address to fetch from.</span>}
            {s.enabled && canFetch(s) && (
              <Button size="sm" variant="solid" tone="ink" permission="configure" onClick={onFetch}>
                Fetch a copy
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-col">
          <div className="grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4">
            {[
              { k: "In this corpus", v: <Status tone={s.enabled ? "ok" : "neutral"}>{s.enabled ? "in the register" : "not added"}</Status> },
              { k: "Licence", v: <Status tone={LICENCE_TONE[s.licence] ?? "neutral"}>{s.licence}</Status> },
              { k: "Indexed", v: chunks > 0 ? <span className="tnum">{count(chunks)} chunks</span> : <span className="font-normal text-ghost">not indexed</span> },
              { k: "Waiting for a person", v: <span className="tnum">{s.staged ?? 0}</span> },
            ].map((x) => (
              <div key={x.k} className="flex min-w-0 flex-col gap-1 bg-surface px-3 py-2.5">
                <span className="text-[10.5px] text-faint">{x.k}</span>
                <span className="text-[12.5px] font-medium text-fg">{x.v}</span>
              </div>
            ))}
          </div>
          <dl className="grid grid-cols-[112px_minmax(0,1fr)] gap-x-3 gap-y-2 border-b border-line px-4 py-3 text-[12px]">
            <dt className="text-faint">Used for</dt>
            <dd className="leading-[1.5] text-dim">{s.use_for || <span className="text-ghost">not said</span>}</dd>
            <dt className="text-faint">Licence terms</dt>
            <dd className="leading-[1.5] text-dim">{LICENCE_NOTE[s.licence] ?? s.licence}</dd>
            <dt className="text-faint">Changes</dt>
            <dd className="text-dim">{s.cadence || <span className="text-ghost">not said</span>}</dd>
            <dt className="text-faint">Last admitted</dt>
            <dd className="text-dim">{s.last_admitted ? ago(s.last_admitted) : <span className="text-ghost">{chunks > 0 ? "not recorded" : "never"}</span>}</dd>
            {s.health && (
              <>
                <dt className="text-faint">Last fetched</dt>
                <dd className="leading-[1.5] text-dim">
                  {s.last_fetch_at ? `${ago(s.last_fetch_at)} · ${s.last_fetch_result}${s.last_fetch_detail ? ` · ${s.last_fetch_detail}` : ""}` : <span className="text-ghost">never</span>}
                </dd>
                <dt className="text-faint">Fetched again</dt>
                <dd className="text-dim">
                  {s.refresh_days ? `every ${s.refresh_days} day${s.refresh_days === 1 ? "" : "s"}${s.next_refresh_at ? `, next on ${s.next_refresh_at.slice(0, 10)}` : ", once a person has fetched it"}` : "only when a person asks"}
                  {` · ${s.health}`}
                </dd>
              </>
            )}
            <dt className="text-faint">Fetched from</dt>
            <dd className="flex min-w-0 flex-col gap-0.5">
              {urls.length === 0 && <span className="text-ghost">no address</span>}
              {urls.slice(0, 3).map((u) => (
                <SafeLink key={u} href={u} className="focusable truncate rounded-sm font-mono text-[11px] text-dim underline decoration-line hover:text-fg">
                  {u}
                </SafeLink>
              ))}
              {urls.length > 3 && <span className="text-[11px] text-faint">and {urls.length - 3} more addresses, fetched as one document</span>}
            </dd>
          </dl>

          {/* data class and entitlement */}
          <div className="flex items-center gap-2 border-b border-line bg-raise/55 px-4 py-2">
            <span className="text-[12px] font-semibold">Data class and entitlement</span>
            <span className="text-[11px] text-faint">
              {s.data_class ? `${s.data_class}${s.entitled && s.entitled.length ? ` · ${s.entitled.join(", ")}` : " · no named restriction"}` : "not set on this source"}
            </span>
          </div>
          <div className="flex flex-col gap-3 px-4 py-3">
            {pending && <PendingLine door={waits ?? "knowledgeSourceClass"} />}
            <div className="flex flex-col gap-1.5">
              <span id="source-class-label" className="text-[12.5px] font-medium text-mist">Data class</span>
              <ClassChips value={cls} onChange={setCls} disabled={pending || saving} labelledBy="source-class-label" />
            </div>
            <Field label="Entitled" hint="Names an agent must hold one of to retrieve from it, separated by commas: an agent holds one name, its own id, and every retrieval.search applies this. People with either console role read every class and every source.">
              <Input value={entitled} onChange={setEntitled} disabled={pending || saving} autoComplete="off" />
            </Field>
            {error && (<p role="alert" className="text-[11.5px] leading-[1.5] text-err">{error}</p>)}
            <span className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="solid" tone="ink" permission="configure" disabled={pending || !cls || !changed} loading={saving} onClick={save}>
                Save class and entitlement
              </Button>
              {!pending && !cls && <span className="text-[11.5px] text-faint">Choose a data class to save.</span>}
            </span>
          </div>
        </div>
      </Frame>

      {removing && (
        <Dialog
          modal
          title={`Remove ${s.name} from "${namespace}"?`}
          confirm="Remove"
          cancel="Cancel"
          tone="err"
          loading={busy}
          onConfirm={() => onEnable(false)}
          onClose={() => !busy && setRemoving(false)}
        >
          It leaves this corpus&rsquo;s register and goes back to the sources that can be added.{" "}
          {chunks > 0
            ? `Its ${count(chunks)} indexed chunks stay in the store and are left out of retrieval until it is added again.`
            : "Nothing of it is indexed."}
        </Dialog>
      )}
    </>
  );
}

/**
 * Add a source of the deployment's own: its name, the address it is fetched
 * from, its publisher and licence, the corpus it joins and its data class.
 * Sent to the `knowledgeSourceAdd` door.
 */
function AddSourceDialog({ namespace, namespaces, onClose, onDone }: { namespace: string; namespaces: string[]; onClose: () => void; onDone: (text: string) => void }) {
  const there = useDoorThere("knowledgeSourceAdd");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [publisher, setPublisher] = useState("");
  const [licence, setLicence] = useState<Licence | "">("");
  const [into, setInto] = useState(namespace);
  const [cls, setCls] = useState<DataClass | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [waits, setWaits] = useState<Door | null>(null);

  const pending = there === "pending" || waits !== null;
  const off = pending || busy;
  const address = url.trim().split(/\s+/).filter(Boolean);
  const badAddress = address.length > 0 && !address.every((u) => /^https:\/\/\S+$/i.test(u));
  const missing = [!name.trim() && "a name", address.length === 0 && "an address", !publisher.trim() && "a publisher", !licence && "a licence", !cls && "a data class"].filter(Boolean) as string[];
  const corpora = namespaces.includes(namespace) ? namespaces : [namespace, ...namespaces];

  const add = async () => {
    if (missing.length || badAddress || !licence || !cls) return;
    setBusy(true);
    setError("");
    const body: SourceAddBody = { namespace: into, name: name.trim(), url: address.join(" "), publisher: publisher.trim(), licence, data_class: cls };
    const a = await ask<unknown>("knowledgeSourceAdd", { body });
    setBusy(false);
    if (a.state === "pending") setWaits(a.door);
    else if (a.state === "error") setError(a.message);
    else onDone(`${body.name} was added to the "${into}" corpus.`);
  };

  return (
    <Frame
      title="Add a source"
      subtitle="A source of your own: a document set, a policy library, a site. It joins one corpus."
      locked={busy}
      onClose={onClose}
      footer={
        <>
          <span className="min-w-0 grow text-[11.5px] leading-[1.5] text-faint">
            {pending ? "" : missing.length ? `Still needed: ${missing.join(", ")}.` : "Adding a source fetches nothing. It can be fetched from the register once it is there."}
          </span>
          <Button size="sm" variant="solid" tone="ink" permission="configure" disabled={pending || missing.length > 0 || badAddress} loading={busy} onClick={add}>
            Add source
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        {pending && <PendingLine door={waits ?? "knowledgeSourceAdd"} />}
        <Field label="Name">
          <Input value={name} onChange={setName} disabled={off} autoComplete="off" />
        </Field>
        <Field label="Address" hint="Where it is fetched from. Several addresses separated by spaces are fetched as one document." error={badAddress ? "Each address starts with https://: sources are fetched over https only" : undefined}>
          <Input value={url} onChange={setUrl} disabled={off} type="url" mono autoComplete="off" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Publisher" hint="Who issues it. Sources are listed by publisher.">
            <Input value={publisher} onChange={setPublisher} disabled={off} autoComplete="off" />
          </Field>
          <Field label="Licence" hint={licence ? LICENCE_NOTE[licence] : "What may be held of its text."}>
            <Pick<Licence | "">
              size="md"
              value={licence}
              disabled={off}
              onChange={setLicence}
              options={[{ value: "", label: "Choose a licence" }, ...LICENCES.map((l) => ({ value: l, label: l }))]}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Corpus" hint="The namespace it joins.">
            <Pick<string> size="md" value={into} disabled={off} onChange={setInto} options={corpora.map((n) => ({ value: n, label: n }))} />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span id="add-source-class-label" className="text-[12.5px] font-medium text-mist">Data class</span>
            <ClassChips value={cls} onChange={setCls} disabled={off} labelledBy="add-source-class-label" />
            <span className="text-[11.5px] text-faint">The classification of its content, as your organisation labels it.</span>
          </div>
        </div>
        {error && (<p role="alert" className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err">{error}</p>)}
      </div>
    </Frame>
  );
}

const bytesText = (n: number) => (n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} bytes`);

/**
 * Upload a document into a corpus: one file, a title, and the namespace it
 * goes into. Sent multipart to the `knowledgeUpload` door.
 */
function UploadDocumentDialog({ namespace, namespaces, onClose, onDone }: { namespace: string; namespaces: string[]; onClose: () => void; onDone: (text: string, documentId: string | null, into: string) => void }) {
  const there = useDoorThere("knowledgeUpload");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [into, setInto] = useState(namespace);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [waits, setWaits] = useState<Door | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const pending = there === "pending" || waits !== null;
  const off = pending || busy;
  const corpora = namespaces.includes(namespace) ? namespaces : [namespace, ...namespaces];
  const missing = [!file && "a file", !title.trim() && "a title"].filter(Boolean) as string[];

  const take = (f: File | null | undefined) => {
    if (!f || off) return;
    setFile(f);
    setError("");
    if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ""));
  };

  const upload = async () => {
    if (!file || !title.trim()) return;
    setBusy(true);
    setError("");
    const form = new FormData();
    form.append(UPLOAD_FIELDS.file, file);
    form.append(UPLOAD_FIELDS.namespace, into);
    form.append(UPLOAD_FIELDS.title, title.trim());
    const a = await ask<{ document?: string; note?: string }>("knowledgeUpload", { form });
    setBusy(false);
    if (a.state === "pending") setWaits(a.door);
    else if (a.state === "error") setError(a.message);
    else onDone(a.data?.note || `${title.trim()} was uploaded into the "${into}" corpus.`, typeof a.data?.document === "string" ? a.data.document : null, into);
  };

  return (
    <Frame
      title="Upload a document"
      subtitle="One file, put into one corpus. Like a fetched copy, a person admits it before it can be retrieved."
      locked={busy}
      onClose={onClose}
      footer={
        <>
          <span className="min-w-0 grow text-[11.5px] leading-[1.5] text-faint">{pending ? "" : missing.length ? `Still needed: ${missing.join(", ")}.` : `Goes into the "${into}" corpus.`}</span>
          <Button size="sm" variant="solid" tone="ink" permission="configure" disabled={pending || missing.length > 0} loading={busy} onClick={upload}>
            Upload
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        {pending && <PendingLine door={waits ?? "knowledgeUpload"} />}
        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-mist">File</span>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!off) setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              take(e.dataTransfer.files?.[0]);
            }}
            className={`flex flex-wrap items-center gap-3 rounded-md border border-dashed px-3 py-3 transition-colors duration-100 ${over ? "border-fg bg-raise/60" : "border-line-strong bg-canvas"} ${pending ? "opacity-60" : ""}`}
          >
            <input ref={input} type="file" className="sr-only" tabIndex={-1} aria-label="Document to upload" disabled={off} onChange={(e) => take(e.target.files?.[0])} />
            {file ? (
              <span className="flex min-w-0 grow flex-col">
                <span className="truncate font-mono text-[12px] text-fg">{file.name}</span>
                <span className="tnum text-[11px] text-faint">{bytesText(file.size)}</span>
              </span>
            ) : (
              <span className="min-w-0 grow text-[12px] leading-[1.5] text-dim">Drop one file here, or choose it.</span>
            )}
            <Button size="sm" variant="solid" tone="neutral" disabled={off} onClick={() => input.current?.click()}>
              {file ? "Choose another" : "Choose a file"}
            </Button>
          </div>
        </div>
        <Field label="Title" hint="How the document is named in the corpus and in citations.">
          <Input value={title} onChange={setTitle} disabled={off} autoComplete="off" />
        </Field>
        <Field label="Corpus" hint="The namespace it goes into.">
          <Pick<string> size="md" value={into} disabled={off} onChange={setInto} options={corpora.map((n) => ({ value: n, label: n }))} />
        </Field>
        {error && (<p role="alert" className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err">{error}</p>)}
      </div>
    </Frame>
  );
}

/* ═══════════════════ connectors: a body of documents under a bucket and prefix ═══════════════════ */

interface ConnectorWho {
  sub: string;
  email: string;
  name: string;
}

type ObjectState = "queued" | "ingested" | "failed" | "refused" | "withdrawn";

interface Connector {
  id: string;
  kind: string;
  name: string;
  namespace: string;
  location: string;
  bucket: string;
  prefix: string;
  data_class: DataClass;
  entitled: string[];
  file_types: string[];
  max_bytes: number;
  /** The rule as it stands: its digest, and who wrote this version of it (registered the connector or last changed the rule). */
  rule: { digest: string; by: ConnectorWho | null; at: string };
  /** True while the latest admission is of the rule as it stands. */
  admitted: boolean;
  state: string;
  admission: { digest: string; current: boolean; by: ConnectorWho | null; at: string; note: string } | null;
  next_sync_at: string | null;
  sync_running: boolean;
  health: {
    last_sync: { at: string; by: string | null; origin: string; result: "done" | "failed"; listed: number; queued: number; unchanged: number; refused: number; withdrawn: number; error: string | null } | null;
    objects: Record<ObjectState, number>;
    seen: number;
    last_error: { at: string; what: string; object: string | null; reason: string } | null;
  };
}

interface ConnectorObject {
  name: string;
  address: string;
  state: ObjectState;
  reason: string | null;
  generation: string;
  size: number;
  document_id: string | null;
  changed_at: string;
  provenance: { document: string; generation: string; md5_hash: string | null; admission: string; rule_digest: string; admitted_by: ConnectorWho | null; admitted_at: string; ingested_at: string } | null;
}

interface ConnectorAccepts {
  file_types: string[];
  max_bytes_most: number;
  bucket_api: string;
  note: string;
}

const OBJECT_TONE: Record<ObjectState, "ok" | "queue" | "err" | "warn" | "neutral"> = { ingested: "ok", queued: "queue", failed: "err", refused: "warn", withdrawn: "neutral" };
const OBJECT_STATES: ObjectState[] = ["ingested", "queued", "failed", "refused", "withdrawn"];
const whoName = (w: ConnectorWho | null | undefined) => (w ? w.name || w.email || w.sub : "someone");

/** One fetch of a connector address: the JSON it answered, or an Error carrying the service's own sentence. */
async function connectorCall<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { cache: "no-store", ...init, headers: init?.body ? { "content-type": "application/json" } : undefined });
  const j = (await r.json().catch(() => null)) as (T & { error?: string; phase?: number }) | null;
  if (!r.ok || !j) throw new Error(j?.error ? `${j.error}${j.error === "not built" && j.phase ? ` (phase ${j.phase})` : ""}` : `the server answered ${r.status}`);
  return j;
}

/**
 * The connectors feeding this corpus. Each lists the objects under a Cloud
 * Storage bucket and prefix with the service's own Google identity and
 * ingests every new or changed object straight to admitted under its rule;
 * one person registers it and another admits the rule. An object removed
 * from the bucket is withdrawn from retrieval. Everything shown is read from
 * the service on each load; the list refreshes while objects are queued.
 */
function ConnectorsSection({ namespace, onDocument }: { namespace: string; onDocument: (id: string) => void }) {
  const [data, setData] = useState<{ connectors: Connector[]; accepts: ConnectorAccepts } | null>(null);
  const [failed, setFailed] = useState("");
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<Connector | "new" | null>(null);
  const [admitting, setAdmitting] = useState<Connector | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const { session } = useSession();

  const load = useCallback(() => {
    connectorCall<{ connectors: Connector[]; accepts: ConnectorAccepts }>(`/api/knowledge/connectors?namespace=${encodeURIComponent(namespace)}`)
      .then((d) => {
        setData(d);
        setFailed("");
      })
      .catch((e: Error) => {
        setData(null);
        setFailed(e.message || "the request did not reach the server");
      });
  }, [namespace]);
  useEffect(() => {
    setData(null);
    setNotice(null);
    setShown(null);
    load();
  }, [load]);
  const working = Boolean(data?.connectors.some((c) => c.health.objects.queued > 0 || c.sync_running));
  useEffect(() => {
    if (!working) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [working, load]);

  const syncNow = async (c: Connector) => {
    setSyncing(c.id);
    try {
      const d = await connectorCall<{ listed: number; queued: number; unchanged: number; refused: number; withdrawn: number }>(`/api/knowledge/connectors/${c.id}/sync`, { method: "POST" });
      setNotice({ ok: true, text: `${c.name}: listed ${d.listed} object${d.listed === 1 ? "" : "s"}; ${d.queued} queued to be read, ${d.unchanged} unchanged, ${d.refused} refused by the rule, ${d.withdrawn} withdrawn.` });
    } catch (e) {
      setNotice({ ok: false, text: `${c.name} was not synced: ${(e as Error).message}` });
    } finally {
      setSyncing(null);
      load();
    }
  };

  const connectors = data?.connectors ?? [];
  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-raise/55 px-4 py-2.5">
        <span className="text-[12.5px] font-semibold tracking-[-0.005em]">Bucket connectors</span>
        <span className="tnum text-[11px] text-faint">{data ? count(connectors.length) : ""}</span>
        <span className="text-[11px] leading-[1.55] text-faint">a body of documents under a Cloud Storage bucket and prefix, ingested by a rule one person registers and another admits</span>
        <span className="grow" />
        <Button size="sm" variant="solid" tone="ink" permission="configure" disabled={!data} onClick={() => setEditing("new")}>
          Register a connector
        </Button>
      </div>
      {data?.accepts?.note && <p className="border-b border-line px-4 py-2 text-[11px] leading-[1.5] text-warn">{data.accepts.note}</p>}
      {failed && <Failure what="The connectors could not be read" message={failed} className="px-4 py-3" />}
      {!data && !failed && <p className="px-4 py-4 text-[12px] text-faint">Reading the connectors…</p>}
      {notice && <p className={`border-b border-line px-4 py-2 text-[11.5px] leading-[1.5] ${notice.ok ? "text-faint" : "text-err"}`}>{notice.text}</p>}
      {data && connectors.length === 0 && (
        <p className="px-4 py-4 text-[12px] leading-[1.55] text-faint">
          No connector feeds the &ldquo;{namespace}&rdquo; corpus. A connector reads every document under a bucket and prefix; it ingests nothing until a second person admits its rule.
        </p>
      )}
      {connectors.map((c) => {
        const mine = Boolean(session && c.rule.by && session.sub === c.rule.by.sub);
        const h = c.health;
        return (
          <div key={c.id} className="flex flex-col gap-2.5 border-b border-line px-4 py-3 last:border-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[13px] font-semibold text-fg">{c.name}</span>
              <span className="font-mono text-[11px] text-faint">{c.id}</span>
              <Status tone={c.admitted ? "ok" : "warn"}>{c.state}</Status>
              {c.sync_running && <Status tone="run">syncing</Status>}
              <span className="grow" />
              <span className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="solid" tone="ok" permission="configure" disabled={c.admitted || mine} title={c.admitted ? "This rule is admitted." : mine ? "You wrote this rule, so another person must admit it." : undefined} onClick={() => setAdmitting(c)}>
                  Admit rule
                </Button>
                <Button size="sm" variant="solid" tone="neutral" permission="configure" disabled={!c.admitted || c.sync_running || syncing !== null} loading={syncing === c.id} title={c.admitted ? undefined : "Nothing is listed until the rule is admitted."} onClick={() => syncNow(c)}>
                  Sync now
                </Button>
                <Button size="sm" variant="solid" tone="neutral" permission="configure" onClick={() => setEditing(c)}>
                  Change rule
                </Button>
                <Button size="sm" variant="solid" tone="neutral" onClick={() => setShown(shown === c.id ? null : c.id)}>
                  {shown === c.id ? "Hide objects" : "Objects"}
                </Button>
              </span>
            </div>
            <div className="grid gap-x-6 gap-y-1 text-[11.5px] sm:grid-cols-2">
              <Row k="Location" v={c.location} mono />
              <Row k="Data class" v={`${c.data_class}${c.entitled.length ? ` · entitled: ${c.entitled.join(", ")}` : " · no names entitled"}`} />
              <Row k="Takes" v={`${c.file_types.join(" ")} · at most ${bytesText(c.max_bytes)}`} />
              <Row k="Rule" v={`${c.rule.digest.slice(0, 12)} · by ${whoName(c.rule.by)} ${ago(c.rule.at)}`} mono />
            </div>
            <p className="text-[11px] leading-[1.5] text-faint">
              {c.admission
                ? c.admitted
                  ? `Admitted by ${whoName(c.admission.by)} ${ago(c.admission.at)}${c.admission.note ? `: “${c.admission.note}”` : ""}. Every object ingested under it records this admission.`
                  : `The rule admitted by ${whoName(c.admission.by)} ${ago(c.admission.at)} was changed by ${whoName(c.rule.by)}; nothing new is ingested until a person other than ${whoName(c.rule.by)} admits the change.`
                : `Not admitted. Nothing is listed or ingested until a person other than ${whoName(c.rule.by)} admits the rule.`}
            </p>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-md border border-line bg-canvas px-3 py-2 text-[11px]">
              <span className="text-faint">
                Last sync{" "}
                <span className="text-fg">
                  {h.last_sync ? `${ago(h.last_sync.at)} · ${h.last_sync.result === "done" ? `listed ${h.last_sync.listed}` : "failed"} · ${h.last_sync.origin === "clock" ? "by the clock" : `by ${h.last_sync.by ?? "a person"}`}` : "never"}
                </span>
              </span>
              <span className="text-faint">
                Seen <span className="tnum text-fg">{count(h.seen)}</span>
              </span>
              {OBJECT_STATES.map((s) => (
                <span key={s} className="text-faint">
                  {s} <span className={`tnum ${h.objects[s] && s !== "ingested" && s !== "withdrawn" ? (s === "queued" ? "text-queue" : s === "failed" ? "text-err" : "text-warn") : "text-fg"}`}>{count(h.objects[s] ?? 0)}</span>
                </span>
              ))}
              {c.admitted && c.next_sync_at && <span className="text-ghost">next sync by the clock {new Date(c.next_sync_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>}
            </div>
            {h.last_error && (
              <p className="text-[11px] leading-[1.5] text-err">
                Last error, {ago(h.last_error.at)} ({h.last_error.what}{h.last_error.object ? ` ${h.last_error.object}` : ""}): {h.last_error.reason}
              </p>
            )}
            {shown === c.id && <ConnectorObjects id={c.id} refresh={h} onDocument={onDocument} />}
          </div>
        );
      })}
      {editing && data && (
        <ConnectorDialog
          connector={editing === "new" ? null : editing}
          namespace={namespace}
          accepts={data.accepts}
          onClose={() => setEditing(null)}
          onDone={(text) => {
            setEditing(null);
            setNotice({ ok: true, text });
            load();
          }}
        />
      )}
      {admitting && (
        <AdmitConnectorDialog
          connector={admitting}
          onClose={() => setAdmitting(null)}
          onDone={(text) => {
            setAdmitting(null);
            setNotice({ ok: true, text });
            load();
          }}
        />
      )}
    </section>
  );
}

/** The objects one connector has seen, failures first, each with its state, the reason when it was not ingested, and its provenance when it was. */
function ConnectorObjects({ id, refresh, onDocument }: { id: string; refresh: unknown; onDocument: (id: string) => void }) {
  const [data, setData] = useState<{ objects: ConnectorObject[]; total: number; shown: number } | null>(null);
  const [failed, setFailed] = useState("");
  const key = JSON.stringify(refresh);
  useEffect(() => {
    connectorCall<{ objects: ConnectorObject[]; total: number; shown: number }>(`/api/knowledge/connectors/${id}`)
      .then((d) => {
        setData(d);
        setFailed("");
      })
      .catch((e: Error) => setFailed(e.message));
  }, [id, key]);
  if (failed) return <Failure what="The objects could not be read" message={failed} />;
  if (!data) return <p className="text-[11.5px] text-faint">Reading the objects…</p>;
  if (data.objects.length === 0) return <p className="text-[11.5px] text-faint">The connector has seen no object yet: nothing is listed until it is synced.</p>;
  return (
    <div className="max-h-[420px] overflow-auto rounded-md border border-line">
      <table className="w-full min-w-[860px] border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="border-b border-line text-[10.5px] text-faint">
            <th className="px-3 py-2 font-medium">Object</th>
            <th className="px-3 py-2 font-medium">State</th>
            <th className="px-3 py-2 font-medium">Generation</th>
            <th className="px-3 py-2 font-medium">Size</th>
            <th className="px-3 py-2 font-medium">Why, or what it rests on</th>
            <th className="px-3 py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {data.objects.map((o) => (
            <tr key={o.name} className="border-b border-line align-top last:border-0">
              <td className="max-w-[300px] px-3 py-2">
                <span className="block truncate font-mono text-[11px] text-fg" title={o.address}>{o.name}</span>
                <span className="text-[10px] text-ghost">changed {ago(o.changed_at)}</span>
              </td>
              <td className="px-3 py-2 whitespace-nowrap"><Status tone={OBJECT_TONE[o.state]}>{o.state}</Status></td>
              <td className="px-3 py-2 font-mono text-[10.5px] whitespace-nowrap text-faint">{o.generation}</td>
              <td className="tnum px-3 py-2 text-[11px] whitespace-nowrap text-faint">{bytesText(o.size)}</td>
              <td className="max-w-[380px] px-3 py-2 text-[11px] leading-[1.45]">
                {o.reason && <span className={`block ${o.state === "failed" ? "text-err" : o.state === "refused" ? "text-warn" : "text-faint"}`}>{o.reason}</span>}
                {o.provenance && (
                  <span className="block text-faint">
                    Generation {o.provenance.generation}
                    {o.provenance.md5_hash ? ` (MD5 ${o.provenance.md5_hash})` : ""}, admitted under rule {o.provenance.rule_digest.slice(0, 12)} as admitted by {whoName(o.provenance.admitted_by)} {ago(o.provenance.admitted_at)}; ingested {ago(o.provenance.ingested_at)}.
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap">
                {o.document_id && (
                  <Button size="sm" variant="solid" tone="neutral" onClick={() => onDocument(o.document_id!)}>
                    Open
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.total > data.shown && <p className="border-t border-line px-3 py-2 text-[11px] text-faint">{data.shown} of {count(data.total)} objects shown, failures first.</p>}
    </div>
  );
}

/** Register a connector, or change its rule. A changed rule must be admitted again, by someone other than the person who changed it. */
function ConnectorDialog({ connector, namespace, accepts, onClose, onDone }: { connector: Connector | null; namespace: string; accepts: ConnectorAccepts; onClose: () => void; onDone: (text: string) => void }) {
  const [name, setName] = useState(connector?.name ?? "");
  const [bucket, setBucket] = useState(connector?.bucket ?? "");
  const [prefix, setPrefix] = useState(connector?.prefix ?? "");
  const [cls, setCls] = useState<DataClass | null>(connector?.data_class ?? null);
  const [entitled, setEntitled] = useState((connector?.entitled ?? []).join(", "));
  const [types, setTypes] = useState<string[]>(connector?.file_types ?? []);
  const [megabytes, setMegabytesText] = useState(connector ? String(Math.round((connector.max_bytes / 1024 ** 2) * 1000) / 1000) : "");
  /** Whether the person edited the size cap: a cap shown rounded to megabytes is sent back only then, so saving another change keeps it exact. */
  const [sizeEdited, setSizeEdited] = useState(!connector);
  const setMegabytes = (v: string) => {
    setMegabytesText(v);
    setSizeEdited(true);
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const most = accepts.max_bytes_most;
  const bytes = Math.round(Number(megabytes) * 1024 ** 2);
  const badSize = sizeEdited && megabytes.trim() !== "" && (!Number.isFinite(bytes) || bytes < 1 || bytes > most);
  const missing = [!name.trim() && "a name", !bucket.trim() && "a bucket", !cls && "a data class", types.length === 0 && "a file type", !megabytes.trim() && "a size cap"].filter(Boolean) as string[];
  const toggle = (t: string) => setTypes((now) => (now.includes(t) ? now.filter((x) => x !== t) : [...now, t].sort()));

  const save = async () => {
    if (missing.length || badSize || !cls) return;
    setBusy(true);
    setError("");
    const body = { name: name.trim(), bucket: bucket.trim(), prefix, data_class: cls, entitled: namesOf(entitled), file_types: types, ...(sizeEdited ? { max_bytes: bytes } : {}), ...(connector ? {} : { namespace }) };
    try {
      if (connector) {
        await connectorCall(`/api/knowledge/connectors/${connector.id}`, { method: "PATCH", body: JSON.stringify(body) });
        onDone(`${body.name}: the change is saved. Nothing new is ingested until a person other than you admits it.`);
      } else {
        const d = await connectorCall<{ connector: Connector }>("/api/knowledge/connectors", { method: "POST", body: JSON.stringify(body) });
        onDone(`${d.connector.name} was registered for the "${namespace}" corpus as ${d.connector.id}. It lists and ingests nothing until a person other than you admits its rule.`);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame
      title={connector ? `Change the rule of ${connector.name}` : "Register a connector"}
      subtitle={connector ? "A changed rule stops ingestion until another person admits it." : "Every document under a bucket and prefix, read with this service's own Google identity. Another person admits its rule before anything is read."}
      locked={busy}
      onClose={onClose}
      footer={
        <>
          <span className="min-w-0 grow text-[11.5px] leading-[1.5] text-faint">{missing.length ? `Still needed: ${missing.join(", ")}.` : `Feeds the "${connector?.namespace ?? namespace}" corpus.`}</span>
          <Button size="sm" variant="solid" tone="err" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="solid" tone="ink" permission="configure" disabled={missing.length > 0 || badSize} loading={busy} onClick={save}>
            {connector ? "Save the change" : "Register"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <Field label="Name">
          <Input value={name} onChange={setName} disabled={busy} autoComplete="off" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Bucket" hint="The Cloud Storage bucket's name, without gs://.">
            <Input value={bucket} onChange={setBucket} disabled={busy} mono autoComplete="off" />
          </Field>
          <Field label="Prefix" hint="Only objects whose names begin with this are read. Empty: the whole bucket.">
            <Input value={prefix} onChange={setPrefix} disabled={busy} mono autoComplete="off" />
          </Field>
        </div>
        <div className="flex flex-col gap-1.5">
          <span id="connector-class-label" className="text-[12.5px] font-medium text-mist">Data class</span>
          <ClassChips value={cls} onChange={setCls} disabled={busy} labelledBy="connector-class-label" />
          <span className="text-[11.5px] text-faint">Every document the connector ingests carries this class.</span>
        </div>
        <Field label="Entitled" hint="Names a caller must hold one of, separated by commas (an agent's id, for example). Empty: the class alone decides.">
          <Input value={entitled} onChange={setEntitled} disabled={busy} autoComplete="off" />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-mist">File types</span>
          <div className="flex flex-wrap gap-1.5">
            {accepts.file_types.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={types.includes(t)}
                disabled={busy}
                onClick={() => toggle(t)}
                className={`focusable inline-flex h-8 cursor-pointer items-center rounded-sm border px-3 font-mono text-[12px] transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-40 ${
                  types.includes(t) ? "border-transparent bg-ink text-on-ink" : "border-line bg-surface text-dim hover:bg-raise hover:text-fg"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <span className="text-[11.5px] text-faint">An object of any other type is recorded as refused, with the reason.</span>
        </div>
        <Field label="Size cap (MB)" hint={`An object larger than this is recorded as refused. At most ${bytesText(most)}, the largest document this deployment accepts.`} error={badSize ? `Give a size from 1 byte to ${bytesText(most)}.` : undefined}>
          <Input value={megabytes} onChange={setMegabytes} disabled={busy} type="number" autoComplete="off" />
        </Field>
        {error && <p role="alert" className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err">{error}</p>}
      </div>
    </Frame>
  );
}

/** Admit a connector's rule as it stands, naming the digest shown here: a rule that changed since is refused. Not open to the rule's own author. */
function AdmitConnectorDialog({ connector, onClose, onDone }: { connector: Connector; onClose: () => void; onDone: (text: string) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const admit = async () => {
    setBusy(true);
    setError("");
    try {
      const d = await connectorCall<{ admitted: { sources_reclassed: number } }>(`/api/knowledge/connectors/${connector.id}/admit`, {
        method: "POST",
        body: JSON.stringify({ digest: connector.rule.digest, note: note.trim() }),
      });
      const reclassed = d.admitted.sources_reclassed;
      onDone(`The rule of ${connector.name} is admitted in your name.${reclassed ? ` ${reclassed} document source${reclassed === 1 ? "" : "s"} it already feeds now carr${reclassed === 1 ? "ies" : "y"} its class and entitlement.` : ""} The clock syncs it within a minute, or sync it now.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Frame
      title={`Admit the rule of ${connector.name}`}
      subtitle="Every object read under this rule is admitted in your name, straight into retrieval, without a person reviewing each one."
      locked={busy}
      onClose={onClose}
      footer={
        <>
          <span className="min-w-0 grow text-[11.5px] leading-[1.5] text-faint">You admit exactly the rule shown, by its digest.</span>
          <Button size="sm" variant="solid" tone="err" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="solid" tone="ok" permission="configure" loading={busy} onClick={admit}>Admit rule</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 p-4 text-[12px]">
        <Row k="Location" v={connector.location} mono />
        <Row k="Corpus" v={connector.namespace} mono />
        <Row k="Data class" v={connector.data_class} />
        <Row k="Entitled" v={connector.entitled.length ? connector.entitled.join(", ") : "no names: the class alone decides"} />
        <Row k="File types" v={connector.file_types.join(" ")} mono />
        <Row k="Size cap" v={bytesText(connector.max_bytes)} />
        <Row k="Written by" v={`${whoName(connector.rule.by)} ${ago(connector.rule.at)}`} />
        <span className="flex flex-col gap-0.5">
          <span className="text-faint">Digest</span>
          <span className="font-mono text-[11px] break-all text-fg">{connector.rule.digest}</span>
        </span>
        <Field label="Note" hint="Kept with the admission.">
          <Input value={note} onChange={setNote} disabled={busy} autoComplete="off" />
        </Field>
        {error && <p role="alert" className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err">{error}</p>}
      </div>
    </Frame>
  );
}
