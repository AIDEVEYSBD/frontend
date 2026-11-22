"use client";

import { Suspense, useCallback, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Status, Tag } from "./ui";
import { Checkbox } from "./forms";
import { Dialog, EmptyState } from "./overlays";
import { PageHeader } from "./section";
import { Chips, FilterBar, SearchBox } from "./filters";
import { NotConnected, NotConnectedNote, useDoor } from "./pending";
import { ago } from "./identity-shared";
import { whenFull } from "./dataset-parts";
import { Affected, KIND_WORD, STATE_TONE, SessionGlyph, SessionPanel, SessionState, clientWord, consequence, consequences, isLive, kindWord, sameWord, targetWord, until, whoLine } from "./sessions-parts";
import { useSession } from "@/lib/use-session";
import { SESSION_KINDS, SESSION_STATES, ask, type Door, type Session, type SessionKind, type SessionList, type SessionState as State, type SessionsEnded } from "@/lib/api/pending";

/**
 * Sessions: every live connection to this deployment, and who is behind it.
 *
 * Three kinds in one list: a person signed in to the console, an agent
 * holding a key or a workload sign-in, and a connection the platform holds
 * open to a tool server on behalf of a person or an agent. A row opens the
 * session at the side; a session, or a selection of them, can be ended by
 * someone who administers access, after a question that names who is
 * affected and what stops.
 *
 * The screen is ahead of its doors (`sessions`, `sessionEnd`, `sessionsEnd`
 * in lib/api/pending.ts). The identity door that exists today
 * (`GET /api/iam/users`) gives a count of sessions per person, not the
 * sessions, so all three kinds wait for the new door: until it answers the
 * filters and the column headers stand and the rows' place says the page is
 * not connected. No row is ever made up.
 */

const COLUMNS = ["Who", "Kind", "Client", "Connected to", "Started", "Last active", "Ends", "State"];

type Ending = { what: "sessions"; rows: Session[] } | { what: "client"; registration: string; client: string; rows: Session[] };
type Notice = { tone: "ok" | "err"; text: string } | { door: Door };

function matches(s: Session, term: string): boolean {
  if (!term) return true;
  return [s.principal.name, s.principal.email, s.principal.id, s.owner?.name, s.owner?.email].some((v) => (v ?? "").toLowerCase().includes(term));
}

const seenAt = (s: Session): number => Date.parse(s.last_seen_at || s.started_at) || 0;

function SessionsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const selectedId = params.get("id");
  const { answer, reload } = useDoor<SessionList>("sessions");
  const { session: me } = useSession();
  const [kind, setKind] = useState<SessionKind | "">("");
  const [states, setStates] = useState<State[]>([]);
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [ending, setEnding] = useState<Ending | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  // One clock reading per mount: "in 12m" must not move while the page is open.
  const [now] = useState(() => Date.now());

  const open = useCallback((id: string | null) => router.push(id ? `/sessions?id=${encodeURIComponent(id)}` : "/sessions"), [router]);

  const pending = answer?.state === "pending";
  const connected = answer?.state === "ok";
  const all = useMemo(() => (answer?.state === "ok" && Array.isArray(answer.data?.sessions) ? answer.data.sessions : []), [answer]);
  const counts = answer?.state === "ok" ? answer.data?.counts : undefined;
  const countOf = (k: SessionKind): number => counts?.[k] ?? all.filter((s) => s.kind === k).length;

  const isMine = useCallback((s: Session) => s.kind === "person" && Boolean(me?.sub) && s.principal.id === me?.sub, [me]);
  const canEnd = useCallback((s: Session) => isLive(s) && !isMine(s), [isMine]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all
      .filter((s) => (!kind || s.kind === kind) && (!states.length || states.includes(s.state)) && matches(s, term))
      .sort((a, b) => Number(isLive(b)) - Number(isLive(a)) || seenAt(b) - seenAt(a));
  }, [all, kind, states, q]);

  const filters = (kind ? 1 : 0) + states.length + (q.trim() ? 1 : 0);
  const clear = () => {
    setKind("");
    setStates([]);
    setQ("");
  };

  // The selection is what is ticked and still endable: a session that ended on a later read drops out.
  const endable = shown.filter(canEnd);
  const selection = all.filter((s) => picked.includes(s.id) && canEnd(s));
  const allTicked = endable.length > 0 && endable.every((s) => picked.includes(s.id));
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const row = selectedId ? all.find((s) => s.id === selectedId) ?? null : null;
  const issuedTo = (registration: string | undefined): Session[] => (registration ? all.filter((s) => s.client.registration === registration && isLive(s)) : []);

  const end = async () => {
    if (!ending || busy) return;
    setBusy(true);
    const ids = ending.rows.map((s) => s.id);
    const a =
      ending.what === "client"
        ? await ask<SessionsEnded>("sessionsEnd", { body: { client: ending.registration } })
        : ids.length === 1
          ? await ask<SessionsEnded>("sessionEnd", { params: { id: ids[0] } })
          : await ask<SessionsEnded>("sessionsEnd", { body: { ids } });
    setBusy(false);
    const was = ending;
    setEnding(null);
    if (a.state === "pending") return setNotice({ door: a.door });
    if (a.state === "error") return setNotice({ tone: "err", text: a.message });
    setPicked((p) => p.filter((id) => !ids.includes(id)));
    setNotice({
      tone: "ok",
      text:
        was.what === "client"
          ? `The registration of ${was.client} was ended, and every session issued to it with it.`
          : ids.length === 1
            ? `The session of ${was.rows[0].principal.name || was.rows[0].principal.id} was ended.`
            : `${ids.length.toLocaleString("en-GB")} sessions were ended.`,
    });
    reload();
  };

  const noticeText: ReactNode = notice ? "door" in notice ? <NotConnectedNote door={notice.door} /> : notice.text : null;

  const kindTabs: { id: SessionKind | ""; label: string; count: number }[] = [
    { id: "", label: "All", count: SESSION_KINDS.reduce((n, k) => n + countOf(k), 0) },
    ...SESSION_KINDS.map((k) => ({ id: k, label: KIND_WORD[k].many, count: countOf(k) })),
  ];

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7">
      <PageHeader
        title="Sessions"
        action={
          <Button size="sm" variant="solid" tone="neutral" onClick={reload} loading={answer === null}>
            Read again
          </Button>
        }
      >
        Every live connection to this deployment and who is behind it: people signed in to the console, agents holding a key or a workload sign-in, and the connections the platform holds open to
        tool servers on their behalf. Ending a session stops it at once.
      </PageHeader>

      {notice && (
        <div className="relative flex flex-wrap items-center gap-3 overflow-hidden rounded-lg border border-line bg-surface py-2.5 pr-3 pl-4 elev-1">
          {"tone" in notice && (
            <>
              <span className={`absolute inset-y-0 left-0 w-[3px] ${notice.tone === "err" ? "bg-err" : "bg-ok"}`} />
              <Status tone={notice.tone}>{notice.tone === "err" ? "Refused" : "Done"}</Status>
            </>
          )}
          <span className="min-w-0 text-[12.5px] leading-[1.5] text-fg">{noticeText}</span>
          <span className="grow" />
          <Button size="sm" variant="solid" tone="neutral" onClick={() => setNotice(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {/* filters: kind, search, state */}
      <div className={`flex flex-col gap-2 rounded-lg border border-line bg-surface px-4 py-3 elev-1 ${connected ? "" : "pointer-events-none opacity-60"}`} aria-disabled={!connected || undefined}>
        <FilterBar count={filters} onClear={clear}>
          <span role="radiogroup" aria-label="Kind of session" className="inline-flex h-8 max-w-full items-center gap-px overflow-x-auto rounded-md border border-line bg-raise p-px">
            {kindTabs.map((t) => (
              <button
                key={t.id || "all"}
                type="button"
                role="radio"
                aria-checked={kind === t.id}
                onClick={() => setKind(t.id)}
                className={`focusable inline-flex h-full cursor-pointer items-center gap-1.5 rounded-sm px-2.5 text-[12px] whitespace-nowrap transition-colors ${
                  kind === t.id ? "bg-surface font-medium text-fg shadow-[var(--shadow-1)]" : "text-faint hover:text-dim"
                }`}
              >
                {t.label}
                {connected && <span className="tnum font-mono text-[10.5px] text-faint">{t.count.toLocaleString("en-GB")}</span>}
              </button>
            ))}
          </span>
          <SearchBox value={q} onChange={setQ} placeholder="Search by person or agent" width="w-[260px]" />
          <Chips
            label="State"
            onToggle={(v) => setStates((cur) => (cur.includes(v as State) ? cur.filter((x) => x !== v) : [...cur, v as State]))}
            items={SESSION_STATES.map((st) => ({
              value: st,
              label: st,
              active: states.includes(st),
              count: connected ? all.filter((s) => s.state === st && (!kind || s.kind === kind)).length : undefined,
              tone: STATE_TONE[st] === "ok" ? "ok" : STATE_TONE[st] === "warn" ? "warn" : STATE_TONE[st] === "err" ? "err" : undefined,
            }))}
          />
        </FilterBar>
      </div>

      {/* the list */}
      <section className="flex flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
        <div className="flex min-h-[44px] flex-wrap items-center gap-2 border-b border-line bg-raise/55 px-4 py-2">
          <span className="text-[12.5px] font-semibold tracking-[-0.005em]">Sessions on this deployment</span>
          <span className="tnum text-[11px] text-faint">{answer === null ? "reading…" : connected ? (filters ? `${shown.length} of ${all.length}` : all.length.toLocaleString("en-GB")) : ""}</span>
          {selection.length > 0 && (
            <>
              <span className="grow" />
              <span className="tnum text-[11.5px] text-dim">{selection.length.toLocaleString("en-GB")} selected</span>
              <Button size="sm" variant="solid" tone="neutral" onClick={() => setPicked([])}>
                Clear selection
              </Button>
              <Button size="sm" variant="solid" tone="err" permission="iam" onClick={() => setEnding({ what: "sessions", rows: selection })}>
                End {selection.length === 1 ? "session" : `${selection.length.toLocaleString("en-GB")} sessions`}
              </Button>
            </>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] border-collapse text-left text-[12px]">
            <thead>
              <tr className="border-b border-line">
                <th className="w-9 py-2 pr-1 pl-4">
                  {endable.length > 0 && (
                    <Checkbox
                      aria-label="Select every session shown that can be ended"
                      checked={allTicked}
                      indeterminate={!allTicked && endable.some((s) => picked.includes(s.id))}
                      onChange={(on) => setPicked((p) => (on ? [...new Set([...p, ...endable.map((s) => s.id)])] : p.filter((id) => !endable.some((s) => s.id === id))))}
                    />
                  )}
                </th>
                {COLUMNS.map((c) => (
                  <th key={c} className="px-3 py-2 text-[10.5px] font-medium whitespace-nowrap text-faint">
                    {c}
                  </th>
                ))}
                <th className="py-2 pr-4 pl-3" />
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => {
                const mine = isMine(s);
                const live = isLive(s);
                return (
                  <tr key={s.id} onClick={() => open(s.id)} className={`cursor-pointer border-b border-line align-top transition-colors last:border-0 hover:bg-raise/50 ${selectedId === s.id ? "bg-raise/50" : ""}`}>
                    <td className="py-2.5 pr-1 pl-4" onClick={(e) => e.stopPropagation()}>
                      {canEnd(s) && <Checkbox aria-label={`Select the session of ${s.principal.name || s.principal.id}`} checked={picked.includes(s.id)} onChange={() => toggle(s.id)} />}
                    </td>
                    <td className="max-w-[280px] px-3 py-2.5">
                      <span className="flex items-start gap-2.5">
                        <SessionGlyph session={s} />
                        <span className="flex min-w-0 flex-col">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                open(s.id);
                              }}
                              className={`focusable min-w-0 cursor-pointer truncate rounded-sm text-left text-[12.5px] font-medium hover:underline ${live ? "text-fg" : "text-dim"}`}
                            >
                              {s.principal.name || s.principal.id}
                            </button>
                            {mine && <Tag>you</Tag>}
                          </span>
                          <span className="truncate text-[10.5px] text-faint">{whoLine(s)}</span>
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-dim">{kindWord(s.kind)}</td>
                    <td className="max-w-[190px] px-3 py-2.5">
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-fg">{s.client.name}</span>
                        {!sameWord(s.client.name, clientWord(s.client.kind)) && <span className="truncate text-[10.5px] text-faint">{clientWord(s.client.kind)}</span>}
                      </span>
                    </td>
                    <td className="max-w-[200px] px-3 py-2.5">
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-fg">{s.target.name}</span>
                        {!sameWord(s.target.name, targetWord(s.target.kind)) && <span className="truncate text-[10.5px] text-faint">{targetWord(s.target.kind)}</span>}
                      </span>
                    </td>
                    <td className="tnum px-3 py-2.5 whitespace-nowrap text-dim" title={whenFull(s.started_at)}>
                      {ago(s.started_at, now)}
                    </td>
                    <td className="tnum px-3 py-2.5 whitespace-nowrap text-dim" title={whenFull(s.last_seen_at)}>
                      {s.last_seen_at ? ago(s.last_seen_at, now) : <span className="text-ghost">not recorded</span>}
                    </td>
                    <td className="tnum px-3 py-2.5 whitespace-nowrap text-dim" title={whenFull(s.expires_at)}>
                      {s.expires_at ? until(s.expires_at, now) : <span className="text-ghost">no end recorded</span>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <SessionState state={s.state} />
                    </td>
                    <td className="py-2 pr-4 pl-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {canEnd(s) && (
                        <Button size="sm" variant="solid" tone="err" permission="iam" onClick={() => setEnding({ what: "sessions", rows: [s] })}>
                          End session
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {answer === null && <p className="px-4 py-4 text-[12px] text-faint">Reading the sessions…</p>}
        {pending && (
          <div className="p-4">
            <NotConnected door={answer.door}>
              Every live connection, each tied to who is behind it: people signed in to the console, agents holding a key or a workload sign-in, and the connections held open to tool servers on
              their behalf. Each will be a row here, with what it connected with, what it is connected to, when it started, when it was last active and when it must be renewed. Ending a session
              waits for the same door.
            </NotConnected>
          </div>
        )}
        {answer?.state === "error" && <div className="p-4">{<p className="rounded-md border border-err/40 bg-surface px-3 py-2 text-[11.5px] leading-[1.5] text-err">The sessions could not be read: {answer.message}</p>}</div>}
        {connected && all.length === 0 && (
          <div className="p-4">
            <EmptyState title="No sessions" detail="The control plane holds no session right now. People, agents and connections to tool servers are listed here as they sign in or connect." />
          </div>
        )}
        {connected && all.length > 0 && shown.length === 0 && (
          <p className="flex flex-wrap items-center gap-3 px-4 py-4 text-[12px] text-faint">
            No session matches these filters.
            <Button size="sm" variant="solid" tone="neutral" onClick={clear}>
              Clear filters
            </Button>
          </p>
        )}
      </section>

      {row && connected && (
        <SessionPanel
          key={row.id}
          session={row}
          now={now}
          mine={isMine(row)}
          issuedToClient={issuedTo(row.client.registration)}
          locked={Boolean(ending)}
          onClose={() => open(null)}
          onEnd={() => setEnding({ what: "sessions", rows: [row] })}
          onEndClient={() => row.client.registration && setEnding({ what: "client", registration: row.client.registration, client: row.client.name, rows: issuedTo(row.client.registration) })}
        />
      )}
      {selectedId && connected && !row && (
        <p className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-line-strong bg-surface px-4 py-3 text-[12px] text-dim">
          No session with this id is in the list. It may have ended and been cleared.
          <Button size="sm" variant="solid" tone="neutral" onClick={() => open(null)}>
            Show the list
          </Button>
        </p>
      )}

      {ending && (
        <Dialog
          modal
          tone="err"
          cancel="Cancel"
          loading={busy}
          onConfirm={end}
          onClose={() => !busy && setEnding(null)}
          title={
            ending.what === "client"
              ? `End the registration of ${ending.client}?`
              : ending.rows.length === 1
                ? `End the session of ${ending.rows[0].principal.name || ending.rows[0].principal.id}?`
                : `End ${ending.rows.length.toLocaleString("en-GB")} sessions?`
          }
          confirm={ending.what === "client" ? "End registration" : ending.rows.length === 1 ? "End session" : `End ${ending.rows.length.toLocaleString("en-GB")} sessions`}
        >
          <span className="flex flex-col gap-2">
            {ending.what === "client" ? (
              <>
                <span>
                  Ending a client&rsquo;s registration ends every session issued to it: {ending.rows.length === 1 ? "one live session" : `${ending.rows.length.toLocaleString("en-GB")} live sessions`}. {ending.client} has to
                  register again before it can connect.
                </span>
                <Affected rows={ending.rows} />
                {consequences(ending.rows).map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </>
            ) : ending.rows.length === 1 ? (
              <>
                <span>{consequence(ending.rows[0])}</span>
                <Affected rows={ending.rows} />
                {ending.rows[0].client.registration && (
                  <span>Only this session ends. The registration of {ending.rows[0].client.name} stays, so it can start a new one; ending the registration ends every session issued to it.</span>
                )}
              </>
            ) : (
              <>
                <span>These end at once:</span>
                <Affected rows={ending.rows} />
                {consequences(ending.rows).map((line) => (
                  <span key={line}>{line}</span>
                ))}
              </>
            )}
          </span>
        </Dialog>
      )}
    </div>
  );
}

export function SessionsView() {
  return (
    <Suspense>
      <SessionsPage />
    </Suspense>
  );
}
