"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { errorText } from "@/lib/api/client";
import { PageHeader } from "./section";
import { Skeleton } from "./loaders";
import { Button, Mono, Status, type Tone } from "./ui";
import { WINDOWS, WindowPick, type Win } from "./window-pick";
import { Card, ErrorLine, count, runHref } from "./observability-shared";
import { ExploreFrame, FILTERS, Timeline, VIEWS, ViewSwitch, pageChips, useAddress, type Address, type Bucket, type FacetView, type RailSection, type ViewId } from "./explore-parts";

/**
 * Explore: one place to filter and read everything the platform recorded.
 *
 * The page reads `GET /api/explore` with its own address: the window (or a
 * dragged span, `from` and `to`), the filters (`kind`, `agent`, `run`,
 * `control`, `outcome`, `person`) and the search (`q`) are the address's
 * parameters under the names the platform takes, so a copied link opens the
 * same query. The platform answers one page of entries newest first, the
 * total, the timeline's bars over the whole filtered set and the count
 * beside each filter; nothing here counts a record. A view (`view`) is a
 * preset of kinds, used while the address names no kind.
 */

/* ═══════════════════ shapes (mirror GET /api/explore) ═══════════════════ */

interface Entry {
  id: string;
  source: "journal" | "audit";
  run: string | null;
  seq: number | null;
  at: string;
  kind: string;
  entry_kind: string;
  node: string;
  agent: string;
  control: string;
  outcome: string;
  actor: string;
  starter: string;
  title: string;
  detail: string;
  tool: string;
  model: string;
  cost_usd: number | null;
  unpriced: boolean;
  tainted: boolean;
  ms: number | null;
}

interface ExplorePage {
  entries: Entry[];
  total: number;
  next: string | null;
  limit: number;
  timeline: { unit: string; size_s: number; from: string; to: string; points: { at: string; count: number; flagged: number }[] };
  facets: Record<string, { value: string; count: number }[]>;
  filters: Record<string, unknown>;
  visible: string;
  not_included: { what: string; why: string }[];
  basis: string;
}

/* ═══════════════════ words ═══════════════════ */

const KIND_WORD: Record<string, string> = {
  tool_call: "Tool call",
  model_call: "Model call",
  refusal: "Refusal",
  gate: "Gate",
  security: "Security event",
  operator: "Operator act",
  activity: "Activity",
  access: "Sign-in",
};
const KIND_TONE: Record<string, Tone> = { refusal: "err", security: "warn", operator: "warn", gate: "warn", tool_call: "run", model_call: "run" };

const OUTCOME_WORD: Record<string, string> = {
  ran: "ran",
  refused: "refused",
  failed: "failed",
  open: "open",
  opened: "opened",
  approved: "approved",
  answered: "answered",
  priced: "priced",
  unpriced: "no price",
  flagged: "flagged",
  done: "done",
};
const OUTCOME_TONE: Record<string, "ok" | "warn" | "err"> = {
  ran: "ok",
  refused: "err",
  failed: "err",
  open: "warn",
  opened: "warn",
  approved: "ok",
  answered: "ok",
  priced: "ok",
  unpriced: "warn",
  flagged: "warn",
  done: "ok",
};

const FACET_LABEL: Record<string, string> = { kind: "Kind", outcome: "Outcome", agent: "Agent", control: "Control", person: "Person", run: "Run" };

const PAGE = 50;
const DEFAULT_WINDOW: Win = "7d";

const fmtMoney = (c: number) => (c === 0 ? "$0.00" : c < 0.01 ? `$${c.toFixed(4)}` : `$${c.toFixed(2)}`);
const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`);
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit" });

/* ═══════════════════ the query ═══════════════════ */

/** The kinds read: the address's own, else the view's preset (none for everything). */
function kindsOf(address: Address, view: ViewId): string[] {
  const asked = address.all("kind");
  return asked.length ? asked : VIEWS.find((v) => v.id === view)!.kinds;
}

/** The address as the platform's query: the same parameter names, several values joined by commas. */
function queryOf(address: Address, view: ViewId, win: Win): URLSearchParams {
  const q = new URLSearchParams();
  if (address.span) {
    q.set("from", new Date(address.span.from).toISOString());
    q.set("to", new Date(address.span.to).toISOString());
  } else q.set("window", win);
  for (const id of FILTERS) {
    const values = id === "kind" ? kindsOf(address, view) : address.all(id);
    if (values.length) q.set(id, values.join(","));
  }
  const words = address.one("q").trim();
  if (words) q.set("q", words);
  q.set("limit", String(PAGE));
  return q;
}

async function readPage(query: URLSearchParams, before: string | null): Promise<ExplorePage> {
  const q = new URLSearchParams(query);
  if (before) q.set("before", before);
  let res: Response;
  try {
    res = await fetch(`/api/explore?${q.toString()}`, { cache: "no-store" });
  } catch (e) {
    throw new Error(`the backend did not answer GET /api/explore (${(e as Error).message})`);
  }
  const body = (await res.json().catch(() => null)) as (ExplorePage & { error?: string }) | null;
  if (!res.ok || !body || !Array.isArray(body.entries)) throw new Error(errorText(body, res, "GET", "/api/explore"));
  return body;
}

/** The pages read so far for one query: the first page again on "Read again" and whenever the query changes, the next one on "Show more". */
function usePages(query: string, tick: number) {
  const [state, setState] = useState<{ of: string; first: ExplorePage | null; rows: Entry[]; next: string | null; error: string; loading: boolean }>({
    of: "",
    first: null,
    rows: [],
    next: null,
    error: "",
    loading: true,
  });
  const asked = useRef("");
  useEffect(() => {
    const mark = `${query}#${tick}`;
    asked.current = mark;
    setState((s) => ({ ...s, loading: true, error: "" }));
    readPage(new URLSearchParams(query), null).then(
      (page) => asked.current === mark && setState({ of: query, first: page, rows: page.entries, next: page.next, error: "", loading: false }),
      (e) => asked.current === mark && setState((s) => ({ ...s, of: query, first: s.of === query ? s.first : null, rows: s.of === query ? s.rows : [], error: (e as Error).message, loading: false })),
    );
  }, [query, tick]);
  const more = useCallback(async () => {
    if (!state.next) return;
    const mark = asked.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const page = await readPage(new URLSearchParams(query), state.next);
      if (asked.current === mark) setState((s) => ({ ...s, rows: [...s.rows, ...page.entries], next: page.next, loading: false, error: "" }));
    } catch (e) {
      if (asked.current === mark) setState((s) => ({ ...s, loading: false, error: (e as Error).message }));
    }
  }, [query, state.next]);
  return { ...state, more };
}

/* ═══════════════════ the page ═══════════════════ */

function Explore() {
  const address = useAddress();
  const view: ViewId = VIEWS.find((v) => v.id === address.one("view"))?.id ?? "all";
  const win: Win = WINDOWS.find((w) => w.id === address.one("window"))?.id ?? DEFAULT_WINDOW;
  const [tick, setTick] = useState(0);
  const query = useMemo(() => queryOf(address, view, win).toString(), [address, view, win]);
  const { first, rows, next, error, loading, more } = usePages(query, tick);
  const kinds = kindsOf(address, view);

  /* A kind picked while the view's preset is in force starts from the preset. */
  const toggle = useCallback(
    (id: string, value: string) => {
      if (id === "kind" && !address.all("kind").length) {
        const preset = VIEWS.find((v) => v.id === view)!.kinds;
        address.set("kind", preset.includes(value) ? preset.filter((k) => k !== value) : [...preset, value]);
      } else address.toggle(id, value);
    },
    [address, view],
  );

  const facets: FacetView[] = useMemo(() => {
    if (!first) return [];
    return (["kind", "outcome", "agent", "control", "person", "run"] as const)
      .map((id) => {
        const chosen = id === "kind" ? kinds : address.all(id);
        const listed = first.facets[id] ?? [];
        // A value picked from a link that nothing carries now still shows, at zero, so it can be removed.
        const values = [...listed, ...chosen.filter((v) => !listed.some((l) => l.value === v)).map((value) => ({ value, count: 0 }))];
        return {
          id,
          label: FACET_LABEL[id],
          values: values.map((v) => ({
            value: v.value,
            label: id === "kind" ? KIND_WORD[v.value] ?? v.value : id === "outcome" ? OUTCOME_WORD[v.value] ?? v.value : v.value,
            count: v.count,
            on: chosen.includes(v.value),
            tone: id === "outcome" ? OUTCOME_TONE[v.value] : undefined,
          })),
        };
      })
      .filter((f) => f.values.length > 0);
  }, [first, kinds, address]);
  const sections: RailSection[] = [{ facets }];
  const chips = [
    ...FILTERS.flatMap((id) => address.all(id).map((v) => ({ key: `${id}\u0000${v}`, label: `${FACET_LABEL[id]}: ${id === "kind" ? KIND_WORD[v] ?? v : id === "outcome" ? OUTCOME_WORD[v] ?? v : v}` }))),
    ...pageChips(address),
  ];

  const buckets: Bucket[] = useMemo(
    () => (first ? first.timeline.points.map((p) => ({ from: Date.parse(p.at), to: Date.parse(p.at) + first.timeline.size_s * 1000, total: p.count, flagged: p.flagged })) : []),
    [first],
  );
  const nouns: [string, string] = view === "tools" && !address.all("kind").length ? ["call", "calls"] : ["entry", "entries"];

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7">
      <PageHeader
        title="Explore"
        action={
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-faint">{address.span ? "Window: the span dragged on the timeline" : "Window"}</span>
            <WindowPick value={win} onChange={address.window} inherited={Boolean(address.span)} />
            <Button size="sm" variant="solid" tone="neutral" loading={loading} onClick={() => setTick((t) => t + 1)}>
              Read again
            </Button>
          </span>
        }
      >
        Filter and read everything the platform recorded.
      </PageHeader>

      <ViewSwitch value={view} onChange={address.go} />

      {error && <ErrorLine what={first ? "Explore stopped answering" : "Explore could not be read"} message={error} />}

      {!first && !error && (
        <Card title="Entries" meta="reading…">
          <div className="p-4">
            <Skeleton lines={4} />
          </div>
        </Card>
      )}

      {first && (
        <ExploreFrame
          timeline={
            buckets.length > 0 ? (
              <Timeline buckets={buckets} step={first.timeline.size_s * 1000} span={address.span} onSpan={address.setSpan} nouns={nouns} flagNoun="refused or failed" title="When" />
            ) : null
          }
          sections={sections}
          address={{ ...address, toggle }}
          chips={chips}
          placeholder="Search titles, details, tools, steps, agents, controls, runs"
          shown={`${count(first.total)} ${first.total === 1 ? "entry" : "entries"}`}
        >
          <Card
            title="Entries"
            meta={[
              `${count(first.total)} ${first.total === 1 ? "entry" : "entries"}, newest first`,
              first.visible === "every run" ? "" : `only ${first.visible}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          >
            {rows.length === 0 ? (
              <p className="px-4 py-6 text-[12px] text-faint">{first.total === 0 ? "Nothing recorded matches these filters." : "Reading…"}</p>
            ) : (
              <div className="af-list af-list-tall overflow-x-auto">
                <table className="w-full min-w-[920px] border-collapse text-[11.5px]">
                  <thead>
                    <tr className="border-b border-line text-left text-[10.5px] text-faint">
                      {["When", "Kind", "Agent · run", "Step", "What", "Control", "Outcome", "Who"].map((c, i) => (
                        <th key={c} className={`py-2 font-medium ${i === 0 ? "px-4" : "px-3"}`}>
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((e) => (
                      <EntryRow key={e.id} e={e} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-2.5">
              <span className="text-[11px] text-faint">
                {count(rows.length)} of {count(first.total)} shown
              </span>
              <span className="grow" />
              {next && (
                <Button size="sm" variant="solid" tone="neutral" loading={loading} onClick={more}>
                  Show {Math.min(PAGE, first.total - rows.length)} more
                </Button>
              )}
            </div>
          </Card>
        </ExploreFrame>
      )}
    </div>
  );
}

function EntryRow({ e }: { e: Entry }) {
  const what = e.tool || e.model ? `${e.title}${e.detail ? ` — ${e.detail}` : ""}` : e.detail ? `${e.title} — ${e.detail}` : e.title;
  const figures = [e.ms !== null ? fmtMs(e.ms) : "", e.cost_usd !== null ? fmtMoney(e.cost_usd) : e.unpriced ? "no price set" : ""].filter(Boolean).join(" · ");
  const who = e.actor || e.starter;
  return (
    <tr className="border-b border-line align-top last:border-0 hover:bg-raise/40">
      <td className="px-4 py-2 font-mono text-[10.5px] whitespace-nowrap text-dim">{when(e.at)}</td>
      <td className="px-3 py-2 whitespace-nowrap">
        <Status tone={KIND_TONE[e.kind] ?? "neutral"}>{KIND_WORD[e.kind] ?? e.kind}</Status>
      </td>
      <td className="max-w-[220px] px-3 py-2">
        {e.run ? (
          <Link href={runHref(e.run, e.id)} className="focusable flex min-w-0 flex-col rounded-sm hover:underline">
            <span className="truncate text-fg">{e.agent || "a draft"}</span>
            <Mono className="truncate text-[10px] text-faint">{e.id}</Mono>
          </Link>
        ) : (
          <span className="text-faint">the audit trail</span>
        )}
      </td>
      <td className="px-3 py-2">
        <Mono className="text-[10.5px] text-dim">{e.node}</Mono>
      </td>
      <td className="max-w-[420px] px-3 py-2">
        <span className="line-clamp-2 text-mist" title={what}>
          {what}
        </span>
        {figures && <span className="text-[10.5px] text-faint">{figures}</span>}
        {e.tainted && <span className="ml-1 text-[10.5px] text-warn">derived from untrusted content</span>}
      </td>
      <td className="px-3 py-2">{e.control ? <Mono className="text-[10.5px] text-dim">{e.control}</Mono> : null}</td>
      <td className="px-3 py-2 whitespace-nowrap">{e.outcome ? <Status tone={OUTCOME_TONE[e.outcome] ?? "neutral"}>{OUTCOME_WORD[e.outcome] ?? e.outcome}</Status> : null}</td>
      <td className="max-w-[180px] px-3 py-2">
        <span className="block truncate text-dim" title={e.actor && e.starter && e.actor !== e.starter ? `${e.actor}, on a run ${e.starter} started` : who}>
          {who}
        </span>
      </td>
    </tr>
  );
}

export function ExploreView() {
  return (
    <Suspense>
      <Explore />
    </Suspense>
  );
}
