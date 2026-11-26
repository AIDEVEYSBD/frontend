"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Mono, Tag } from "./ui";
import { Pick } from "./select";
import { Chips, type Chip } from "./filters";
import { PageHeader, Section } from "./section";
import { WindowPick, winMs, type Win } from "./window-pick";
import { NotConnected, NotBuiltValue } from "./pending";
import { notBuilt, notBuiltOf } from "@/lib/not-built";
import { ask, type AccessEvent, type AccessLog, type Answer } from "@/lib/api/pending";
import { readUsers } from "@/lib/api/l2";

/**
 * The access log: who opened which record, and when (`GET /api/access-log`).
 *
 * Reads, not changes: a record viewed, downloaded or exported. The person,
 * kind and time filters are sent to the platform (`subject`, `kind`, `since`,
 * `limit`); `total` counts every match. A field the answer names in
 * `not_built` (a person's team) says so. No row is ever made up.
 */

type Kind = AccessEvent["kind"];

const KINDS: { id: Kind; label: string }[] = [
  { id: "run", label: "Run" },
  { id: "evidence", label: "Evidence pack" },
  { id: "deliverable", label: "Deliverable" },
  { id: "document", label: "Document" },
  { id: "dataset", label: "Dataset" },
  { id: "finding", label: "Finding" },
];
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.id, k.label])) as Record<Kind, string>;
const ACTION_LABEL: Record<AccessEvent["action"], string> = { viewed: "Viewed", downloaded: "Downloaded", exported: "Exported" };
const PAGE = 200;

/** Where a record opens in this console; null where no page takes the record by its id. */
function recordHref(e: AccessEvent): string | null {
  switch (e.kind) {
    case "run":
      return `/runs?id=${encodeURIComponent(e.id)}`;
    case "deliverable":
      return `/deliverables?id=${encodeURIComponent(e.id)}`;
    case "evidence":
      return "/evidence";
    case "document":
      return "/knowledge";
    default:
      return null;
  }
}

function when(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? iso : new Date(t).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

const sinceOf = (w: Win): string | undefined => (w === "all" ? undefined : new Date(Date.now() - winMs(w)).toISOString());

const HEADERS = ["When", "Person", "Action", "Kind", "Record", "Run"];

export function AccessLogView() {
  const [subject, setSubject] = useState("");
  const [kind, setKind] = useState<Kind | "">("");
  const [win, setWin] = useState<Win>("7d");
  // The window's start is fixed when the window is picked, so a re-render does not move it.
  const [since, setSince] = useState<string | undefined>(() => sinceOf("7d"));
  const [limit, setLimit] = useState(PAGE);
  const [tick, setTick] = useState(0);
  const [answer, setAnswer] = useState<{ key: string; a: Answer<AccessLog> } | null>(null);
  /** People to pick from: those the identity door lists, and whoever the log itself has named. */
  const [people, setPeople] = useState<Record<string, string>>({});

  const key = JSON.stringify([subject, kind, since ?? "", limit, tick]);
  useEffect(() => {
    let live = true;
    ask<AccessLog>("accessLog", { query: { subject, kind, since, limit } }).then((a) => {
      if (!live) return;
      setAnswer({ key, a });
      if (a.state === "ok") {
        setPeople((cur) => {
          const next = { ...cur };
          for (const e of a.data.events ?? []) if (e.who?.sub && !next[e.who.sub]) next[e.who.sub] = e.who.name || e.who.email || e.who.sub;
          return next;
        });
      }
    });
    return () => {
      live = false;
    };
  }, [key, subject, kind, since, limit]);

  useEffect(() => {
    // The people the identity door knows, when this person may read it; the filter works without it.
    readUsers()
      .then((u) => {
        setPeople((cur) => {
          const next = { ...cur };
          for (const p of u.users) if (p.sub && !next[p.sub]) next[p.sub] = p.name || p.email || p.sub;
          return next;
        });
      })
      .catch(() => undefined);
  }, []);

  const current = answer && answer.key === key ? answer.a : null;
  // While a new read is on its way the last answer stays on screen, unless nothing serves the door at all.
  const shown = current ?? answer?.a ?? null;
  const loading = current === null;
  const pending = shown?.state === "pending";
  const events = shown?.state === "ok" ? (shown.data.events ?? []) : [];
  const total = shown?.state === "ok" ? (shown.data.total ?? events.length) : 0;
  /** A person's team, when the platform names it as not built: it is never shown as blank or filtered on. */
  const teamUnbuilt = shown?.state === "ok" && notBuilt(notBuiltOf(shown.data), "team");

  const kindChips: Chip[] = [{ value: "", label: "Every kind", active: kind === "" }, ...KINDS.map((k) => ({ value: k.id, label: k.label, active: kind === k.id }))];
  const personOptions = [{ value: "", label: "Everyone" }, ...Object.entries(people).sort((a, b) => a[1].localeCompare(b[1])).map(([sub, name]) => ({ value: sub, label: name }))];
  const filtered = Boolean(subject || kind || win !== "7d");

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7">
      <PageHeader
        title="Access log"
        action={
          <Button size="sm" variant="solid" tone="neutral" onClick={() => setTick((t) => t + 1)} loading={loading && !pending}>
            Read again
          </Button>
        }
      >
        Who opened which run, evidence pack, deliverable or document, and when.
      </PageHeader>

      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface px-4 py-3 elev-1">
        <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
          <label className="flex w-60 max-w-full flex-col gap-1">
            <span className="text-[11px] font-medium text-faint">Person</span>
            <Pick
              aria-label="Person"
              value={subject}
              onChange={(v) => {
                setSubject(v);
                setLimit(PAGE);
              }}
              options={personOptions}
            />
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-faint">Time range</span>
            <span className="flex h-8 items-center">
              <WindowPick
                value={win}
                onChange={(w) => {
                  setWin(w);
                  setSince(sinceOf(w));
                  setLimit(PAGE);
                }}
              />
            </span>
          </div>
          {filtered && (
            <>
              <span className="grow" />
              <Button
                size="sm"
                variant="solid"
                tone="neutral"
                onClick={() => {
                  setSubject("");
                  setKind("");
                  setWin("7d");
                  setSince(sinceOf("7d"));
                  setLimit(PAGE);
                }}
              >
                Clear filters
              </Button>
            </>
          )}
        </div>
        <Chips
          label="Kind"
          items={kindChips}
          onToggle={(v) => {
            setKind(v as Kind | "");
            setLimit(PAGE);
          }}
        />
        {personOptions.length === 1 && <span className="text-[11px] text-faint">No people to filter by yet.</span>}
        {teamUnbuilt && (
          <span className="flex items-baseline gap-1.5 text-[11px] text-faint">
            Team: <NotBuiltValue field="events[].who.team" />
          </span>
        )}
      </div>

      <Section title="Access events" hue="audit" meta={shown?.state === "ok" ? `${events.length.toLocaleString("en-GB")} of ${total.toLocaleString("en-GB")}` : undefined}>
        <div className="-m-4 overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-line text-left text-[10.5px] text-faint">
                {HEADERS.map((h, i) => (
                  <th key={h} className={`py-2 font-medium ${i === 0 ? "pr-3 pl-4" : i === HEADERS.length - 1 ? "pr-4 pl-3" : "px-3"}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => {
                const href = recordHref(e);
                const name = e.label || e.id;
                return (
                  <tr key={`${e.at}:${e.who?.sub ?? ""}:${e.kind}:${e.id}:${i}`} className="border-b border-line align-top last:border-b-0 hover:bg-raise/40">
                    <td className="tnum py-2.5 pr-3 pl-4 whitespace-nowrap text-dim">{when(e.at)}</td>
                    <td className="max-w-[240px] px-3 py-2.5">
                      <span className="flex flex-col gap-0.5">
                        <button
                          type="button"
                          onClick={() => {
                            if (e.who?.sub) {
                              setSubject(e.who.sub);
                              setLimit(PAGE);
                            }
                          }}
                          title="Show only this person"
                          className="focusable w-fit max-w-full cursor-pointer truncate rounded-sm text-left font-medium text-fg hover:underline"
                        >
                          {e.who?.name || e.who?.email || e.who?.sub || "not recorded"}
                        </button>
                        {(e.who?.email || e.who?.team) && <span className="truncate text-[10.5px] text-faint">{[e.who.email, e.who.team].filter(Boolean).join(" · ")}</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-fg">{ACTION_LABEL[e.action] ?? e.action}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <Tag>{KIND_LABEL[e.kind] ?? e.kind}</Tag>
                    </td>
                    <td className="max-w-[360px] px-3 py-2.5">
                      <span className="flex flex-col gap-0.5">
                        {href ? (
                          <Link href={href} className="focusable w-fit max-w-full truncate rounded-sm text-fg underline decoration-line-strong underline-offset-2 hover:decoration-fg">
                            {name}
                          </Link>
                        ) : (
                          <span className="truncate text-fg">{name}</span>
                        )}
                        {e.label && <Mono className="truncate text-[10.5px]">{e.id}</Mono>}
                      </span>
                    </td>
                    <td className="max-w-[220px] py-2.5 pr-4 pl-3">
                      {e.run && e.kind !== "run" ? (
                        <Link href={`/runs?id=${encodeURIComponent(e.run)}`} className="focusable block truncate rounded-sm font-mono text-[10.5px] text-dim hover:underline">
                          {e.run}
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="px-4 py-4 empty:hidden">
            {shown === null && <p className="text-[12px] text-faint">Reading the access log…</p>}
            {pending && shown?.state === "pending" && (
              <NotConnected door={shown.door} compact />
            )}
            {shown?.state === "error" && <p className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err">The access log could not be read: {shown.message}</p>}
            {shown?.state === "ok" && events.length === 0 && <p className="text-[12px] text-faint">{filtered ? "No access was recorded for these filters." : "No access has been recorded in this time range."}</p>}
            {shown?.state === "ok" && events.length > 0 && total > events.length && (
              <Button size="sm" variant="solid" tone="neutral" onClick={() => setLimit((l) => l + PAGE)} loading={loading}>
                Show {Math.min(PAGE, total - events.length).toLocaleString("en-GB")} more
              </Button>
            )}
          </div>
        </div>
      </Section>
    </div>
  );
}
