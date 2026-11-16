"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Meter, Status, Tag } from "./ui";
import { Pick } from "./select";
import { Field, Input } from "./forms";
import { PageHeader } from "./section";
import { CURRENT_USER } from "@/lib/user";
import { useSession, signerName } from "@/lib/use-session";
import { soon } from "@/lib/soon";
import { Markdown, headingsOf } from "./markdown";
import { BrandMark } from "./brand";
import { Donut } from "./charts";
import { PipelineView } from "./pipeline";
import { AskCorpus } from "./ask";
import { FetchModal } from "./fetch-modal";
import { Dialog, EmptyState } from "./overlays";
import { NotConnectedNote } from "./pending";
import { usePageFacts } from "./assistant";
import { DATA_CLASSES, DOORS, ask, doorUrl, type DataClass, type Door, type DoorId } from "@/lib/api/pending";
import {
  DEFAULT_NAMESPACE,
  FAMILIES,
  LICENCE_NOTE,
  NAMESPACE_RE,
  NAMESPACE_RULE,
  NAMESPACE_SLOT,
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
 * Three things here are ahead of their door (lib/api/pending.ts): adding a
 * source of the deployment's own, uploading a document, and setting a
 * source's data class and who is entitled to it. Their forms are built and
 * say they are not connected until something serves the door.
 */

interface Source extends SourceClassFields {
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
  namespace?: string;
  namespaces?: string[];
  /** The register: sources a person added to this corpus. */
  sources?: Source[];
  /** Offered and not added: the public catalogue, and anything removed from the register. */
  catalogue?: Source[];
  staged?: Staged[];
  admissions?: { document_id: string; source_id: string; admitted: boolean; by_whom: string; note: string; chunks: number; at: string; title: string }[];
  totals?: { chunks: number; documents: number; admitted: number; tokens: number; sources: number };
  index?: {
    store: string;
    model: string;
    dimensions: number;
    embeddingReady: boolean;
    /** The provider as configured: host, sources, and the dimension it has answered with in this process. */
    embedding?: { ready: boolean; model: string; host: string; endpointSource: string; keySource: string; dimension: number | null; columnDimensions: number };
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

/** What the re-embed door answers when the provider's width differs from the column's. */
interface ReembedRefusal {
  error: string;
  dimension?: number;
  columnDimensions?: number;
  model?: string;
  mustChange?: string[];
  hint?: string;
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
  /** The re-embed: confirming, running, or refused with what must change. */
  const [reembed, setReembed] = useState<null | { stage: "confirm" | "busy"; force: boolean } | { stage: "refused"; refusal: ReembedRefusal }>(null);
  const { session } = useSession();
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

  /* Re-embed the namespace with the current provider. A width that differs
     from the column's is refused by the door with what must change; the
     dialog shows that and offers force, which alters the column. */
  const runReembed = async (force: boolean) => {
    if (!namespace) return;
    setReembed({ stage: "busy", force });
    try {
      const r = await fetch("/api/knowledge/reembed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ namespace, force, by: signerName(session, CURRENT_USER.name) }),
      });
      const j = (await r.json().catch(() => ({}))) as ReembedRefusal & { note?: string; chunks?: number; model?: string; dimension?: number; needsReembed?: string[] };
      if (r.status === 409 && j.mustChange) {
        setReembed({ stage: "refused", refusal: j });
        return;
      }
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setNotice({ ok: true, text: `${j.note ?? "Re-embedded."}${j.needsReembed?.length ? ` Next: ${j.needsReembed.join(", ")}.` : ""}` });
      setReembed(null);
      load();
    } catch (e) {
      setNotice({ ok: false, text: (e as Error).message });
      setReembed(null);
    }
  };

  /* Add a source to this corpus's register, or take it out. The row stays in
     the store either way; the register is the rows a person switched on. */
  const setEnabled = async (s: Source, enabled: boolean): Promise<boolean> => {
    if (!namespace) return false;
    setBusyId(s.id);
    try {
      const r = await fetch("/api/knowledge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: s.id, namespace, enabled }) });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error ?? `the server answered ${r.status}`);
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
  const offered = useMemo(() => data?.catalogue ?? [], [data]);
  const staged = data?.staged ?? [];
  const totals = data?.totals;
  /** The store answered: figures are measured. Otherwise they are unknown, not zero. */
  const ready = data?.ready === true;
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
    value: sources.filter((s) => s.licence === l).length,
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
  const offerIsOpen = offerOpen ?? (data !== null && sources.length === 0);
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
        <PageHeader
          title="Knowledge"
          action={
            <span className="flex flex-wrap items-center gap-2">
              <Button variant="solid" tone="neutral" permission="configure" onClick={() => setUploading(true)}>
                Upload a document
              </Button>
              <Button variant="solid" tone="ink" permission="configure" onClick={() => setAdding(true)}>
                Add a source
              </Button>
            </span>
          }
        >
          The sources agents on this deployment may retrieve from. A person adds a source, a copy of it is fetched, and a person admits that copy before any of it can be retrieved. Each
          engagement has its own corpus; the one open here is <span className="font-mono text-[12.5px] text-fg">{ns}</span>.
        </PageHeader>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-2.5 elev-1">
          <NamespacePicker value={ns} options={namespaces} loading={!namespace} onChange={pickNamespace} />
          <span className="text-[11.5px] leading-[1.5] text-faint">Everything below is this corpus&rsquo;s and no other&rsquo;s.</span>
        </div>

        {failed && <p className="rounded-md border border-err/40 bg-surface px-3 py-2.5 text-[11.5px] leading-[1.5] text-err">The knowledge base could not be read: {failed}</p>}
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
            <span className="tnum mt-1 text-[30px] leading-none font-semibold tracking-[-0.025em]">{ready ? count(sources.length) : "—"}</span>
            <span className="mt-1 text-[11.5px] text-faint">source{sources.length === 1 ? "" : "s"} a person added to this corpus</span>
            <div className="mt-4 border-t border-line pt-3">
              {ready && sources.length > 0 && <Donut data={byLicence.filter((d) => d.value > 0)} size={96} />}
              {ready && sources.length === 0 && (
                <p className="text-[11.5px] leading-[1.55] text-dim">No source has been added. Add one from the public sources below, or add your own.</p>
              )}
              {!ready && <span className="text-[11.5px] text-ghost">{data ? "Unknown while the store is unreachable." : failed ? "Unknown." : "Reading…"}</span>}
            </div>
          </section>

          <section className={`flex flex-col rounded-lg border p-4 elev-1 ${staged.length ? "border-warn/50 bg-surface" : "border-line bg-surface"}`}>
            <span className="text-[11px] font-medium tracking-[0.06em] text-faint uppercase">Waiting for a person</span>
            <span className={`tnum mt-1 text-[30px] leading-none font-semibold tracking-[-0.025em] ${staged.length ? "text-warn" : ""}`}>{ready ? count(staged.length) : "—"}</span>
            <span className="mt-1 text-[11.5px] text-faint">fetched and split · not embedded, not searchable</span>
            <div className="mt-4 flex flex-col gap-1.5 border-t border-line pt-3">
              {ready && staged.length === 0 && (
                <p className="text-[11.5px] leading-[1.55] text-dim">
                  Nothing is waiting. {sources.length ? "Fetch a source in the register to stage a copy." : "A copy is staged when a source in the register is fetched."}
                </p>
              )}
              {!ready && <span className="text-[11.5px] text-ghost">{data ? "Unknown while the store is unreachable." : failed ? "Unknown." : "Reading…"}</span>}
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
            <span className="tnum mt-1 text-[30px] leading-none font-semibold tracking-[-0.025em]">{ready && totals ? count(totals.chunks) : "—"}</span>
            <span className="mt-1 text-[11.5px] text-faint">
              {ready && totals ? `chunk${totals.chunks === 1 ? "" : "s"} retrievable now, from ${count(totals.admitted)} admitted document${totals.admitted === 1 ? "" : "s"}` : "chunks retrievable now"}
            </span>
            <div className="mt-4 flex flex-col gap-2 border-t border-line pt-3 text-[11.5px]">
              <Row k="Store" v={data?.index?.store ?? "—"} />
              <Row k="Embedding" v={data?.index?.model ?? "—"} mono />
              <Row k="Provider" v={data?.index?.embedding ? (data.index.embedding.host || "not configured") : "—"} mono />
              <Row
                k="Dimensions"
                v={
                  data?.index
                    ? `${data.index.dimensions} column${data.index.embedding?.dimension && data.index.embedding.dimension !== data.index.dimensions ? ` · provider answers ${data.index.embedding.dimension}` : ""}`
                    : "—"
                }
              />
              <Row k="Sources indexed" v={ready ? `${indexed} of ${sources.length}` : "—"} />
              {ready && sources.length > 0 && <Meter value={indexed / sources.length} tone="ok" />}
            </div>
            {/* Integrity: recomputed on this read against what the latest admission recorded. */}
            <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
              {data?.index?.integrity === undefined || data?.index?.integrity === null ? (
                <span className="text-[11px] text-faint">{data?.ready === false ? "Integrity is checked once the index is reachable." : data ? "No integrity result came with this read." : "Integrity: reading…"}</span>
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
                <Button size="sm" variant="solid" tone="ink" permission="configure" disabled={!data?.ready || !totals?.admitted || reembed?.stage === "busy"} loading={reembed?.stage === "busy"} onClick={() => setReembed({ stage: "confirm", force: false })}>
                  Re-embed namespace
                </Button>
                <span className="text-[10.5px] text-ghost">{!ready ? "needs the store" : totals?.admitted ? "every admitted chunk, with the current provider" : "nothing is admitted, so there is nothing to embed"}</span>
              </span>
            </div>
          </section>
        </div>

        {/* ── the register ── */}
        <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/55 px-4 py-2.5">
            <span className="text-[12.5px] font-semibold tracking-[-0.005em]">Sources in this corpus</span>
            <span className="tnum text-[11px] text-faint">{data ? (ready ? (shown.length === sources.length ? count(sources.length) : `${shown.length} of ${sources.length}`) : "unknown") : failed ? "" : "reading…"}</span>
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
                              <span title={LICENCE_NOTE[s.licence]}><Status tone={LICENCE_TONE[s.licence] ?? "neutral"}>{s.licence}</Status></span>
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
          {!data && !failed && <p className="px-4 py-4 text-[12px] text-faint">Reading the register…</p>}
          {!data && failed && <p className="px-4 py-4 text-[12px] text-faint">The register could not be read, so nothing is shown.</p>}
          {data && !ready && <p className="px-4 py-4 text-[12px] text-faint">The register is kept in the store, which is not reachable, so it is not shown.</p>}
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

        {/* ── the public catalogue: offered, not held ── */}
        {data && (
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
              <span className="tnum text-[11px] text-faint">{count(offered.length)}</span>
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
                              <span title={LICENCE_NOTE[s.licence]}><Status tone={LICENCE_TONE[s.licence] ?? "neutral"}>{s.licence}</Status></span>
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
                {offered.length === 0 && <p className="px-4 py-4 text-[12px] text-faint">{ready ? "Every public source on offer is already in this corpus." : "The list of public sources did not come with this read."}</p>}
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
          {!data && <p className="px-4 py-3 text-[11.5px] text-faint">{failed ? "The record could not be read." : "Reading…"}</p>}
          {data && !ready && <p className="px-4 py-3 text-[11.5px] text-faint">The record is kept in the store, which is not reachable.</p>}
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

      {reembed && reembed.stage !== "refused" && (
        <Dialog
          modal
          title={reembed.force ? `Widen the column and re-embed "${namespace}"?` : `Re-embed "${namespace}"?`}
          confirm={reembed.force ? "Alter the column and re-embed" : "Re-embed"}
          cancel="Cancel"
          tone={reembed.force ? "err" : "ink"}
          loading={reembed.stage === "busy"}
          onConfirm={() => runReembed(reembed.force)}
          onClose={() => setReembed(null)}
        >
          {reembed.force
            ? "The vector column is shared by every namespace. Changing its width empties every namespace's vectors; this one is re-embedded now and the others must be re-embedded before their searches answer again. The act is recorded as an admission."
            : `Every admitted chunk in this namespace is embedded again with ${data?.index?.model ?? "the current model"} on ${data?.index?.embedding?.host || "the configured provider"}. Searches keep answering from the old vectors until each chunk is rewritten. The act is recorded as an admission with the model and dimension.`}
        </Dialog>
      )}
      {reembed && reembed.stage === "refused" && (
        <Dialog
          modal
          title="The provider's width differs from the column's"
          confirm="Force: alter the column and re-embed"
          cancel="Cancel"
          tone="err"
          onConfirm={() => runReembed(true)}
          onClose={() => setReembed(null)}
        >
          <span className="flex flex-col gap-2">
            <span>{reembed.refusal.error}</span>
            <span className="text-[11.5px] font-medium text-fg">What must change:</span>
            <span className="flex flex-col gap-0.5 text-[11.5px] leading-[1.55]">
              {(reembed.refusal.mustChange ?? []).map((m) => <span key={m}>· {m}</span>)}
            </span>
            {reembed.refusal.hint && <span className="text-[11px] text-faint">{reembed.refusal.hint}</span>}
          </span>
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

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <span className="flex items-baseline justify-between gap-3">
      <span className="text-faint">{k}</span>
      <span className={`tnum truncate text-fg ${mono ? "font-mono text-[11px]" : ""}`}>{v}</span>
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
 * Whether anything serves a door, asked without sending the door's own
 * request: OPTIONS on its address. The doors here are writes, so there is no
 * read to try first, and a form should say it is not connected before a
 * person fills it in, not after. A route that exists answers with the
 * methods it allows; one that does not answers 404.
 */
function useDoorThere(id: DoorId, params: Record<string, string> = {}): "asking" | "there" | "pending" {
  const [state, setState] = useState<"asking" | "there" | "pending">("asking");
  const key = JSON.stringify(params);
  useEffect(() => {
    let live = true;
    const door: Door = DOORS[id];
    fetch(doorUrl(door, JSON.parse(key) as Record<string, string>), { method: "OPTIONS", cache: "no-store" })
      .then((r) => {
        if (!live) return;
        const allow = r.headers.get("allow");
        const missing = r.status === 404 || r.status === 501 || (allow !== null && !allow.toUpperCase().split(/\s*,\s*/).includes(door.method));
        setState(missing ? "pending" : "there");
      })
      // Unreachable is not the same as absent: let the request itself say what is wrong.
      .catch(() => live && setState("there"));
    return () => {
      live = false;
    };
  }, [id, key]);
  return state;
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
  const there = useDoorThere("knowledgeSourceClass", { id: s.id });
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
    else onSaved(`${s.name}: data class set to ${cls}${names.length ? `, entitled: ${names.join(", ")}` : ", nobody named as entitled"}.`);
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
              { k: "Waiting for a person", v: <span className="tnum">{s.staged ?? "0"}</span> },
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
            <dt className="text-faint">Fetched from</dt>
            <dd className="flex min-w-0 flex-col gap-0.5">
              {urls.length === 0 && <span className="text-ghost">no address</span>}
              {urls.slice(0, 3).map((u) => (
                <a key={u} href={u} target="_blank" rel="noreferrer" className="focusable truncate rounded-sm font-mono text-[11px] text-dim underline decoration-line hover:text-fg">
                  {u}
                </a>
              ))}
              {urls.length > 3 && <span className="text-[11px] text-faint">and {urls.length - 3} more addresses, fetched as one document</span>}
            </dd>
          </dl>

          {/* data class and entitlement */}
          <div className="flex items-center gap-2 border-b border-line bg-raise/55 px-4 py-2">
            <span className="text-[12px] font-semibold">Data class and entitlement</span>
            <span className="text-[11px] text-faint">
              {s.data_class ? `${s.data_class}${s.entitled && s.entitled.length ? ` · ${s.entitled.join(", ")}` : " · nobody named as entitled"}` : "not set on this source"}
            </span>
          </div>
          <div className="flex flex-col gap-3 px-4 py-3">
            {pending && <PendingLine door={waits ?? "knowledgeSourceClass"} />}
            <div className="flex flex-col gap-1.5">
              <span id="source-class-label" className="text-[12.5px] font-medium text-mist">Data class</span>
              <ClassChips value={cls} onChange={setCls} disabled={pending || saving} labelledBy="source-class-label" />
            </div>
            <Field label="Entitled" hint="Group or role names, as your identity provider names them, separated by commas. Leave it empty to name nobody.">
              <Input value={entitled} onChange={setEntitled} disabled={pending || saving} autoComplete="off" />
            </Field>
            {error && <p role="alert" className="text-[11.5px] leading-[1.5] text-err">{error}</p>}
            <span className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="solid" tone="ink" permission="configure" disabled={pending || !cls || !changed || there === "asking"} loading={saving} onClick={save}>
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
  const badAddress = address.length > 0 && !address.every((u) => /^https?:\/\/\S+$/i.test(u));
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
          <Button size="sm" variant="solid" tone="ink" permission="configure" disabled={pending || there === "asking" || missing.length > 0 || badAddress} loading={busy} onClick={add}>
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
        <Field label="Address" hint="Where it is fetched from. Several addresses separated by spaces are fetched as one document." error={badAddress ? "Each address starts with http:// or https://" : undefined}>
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
        {error && <p role="alert" className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err">{error}</p>}
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
          <Button size="sm" variant="solid" tone="ink" permission="configure" disabled={pending || there === "asking" || missing.length > 0} loading={busy} onClick={upload}>
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
        {error && <p role="alert" className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err">{error}</p>}
      </div>
    </Frame>
  );
}
