"use client";

import Link from "next/link";
import { Fragment, Suspense, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Button, Mono, Status, Tag } from "./ui";
import { Switch } from "./forms";
import { Pick } from "./select";
import { EmptyState } from "./overlays";
import { Section } from "./section";
import { GroupHeader } from "./page-tabs";
import { NotConnected, NotConnectedNote, useDoor, Failure } from "./pending";
import { agoText, whenFull } from "./dataset-parts";
import { ChangeDialog, type Act, type Change } from "./retrieval-access-dialog";
import { EVENT_WORD, RightCell, heldOf, inOrder, namesOf, ownerName, revokedOf } from "./retrieval-access-parts";
import { RETRIEVAL_RIGHTS, ask, type Door, type RetrievalAccess, type RetrievalGrant, type RetrievalStore } from "@/lib/api/pending";

/**
 * Retrieval access: the switch that stops an agent, or every agent, reading
 * from a knowledge store or data store.
 *
 * Three parts, all from one read (door `retrievalAccess`): the stores and
 * whether retrieval from each is on; each agent's rights in each store, as
 * its definition grants them and as they stand now; and the history of
 * every revocation, restoration and switch. A change (doors
 * `retrievalRevoke`, `retrievalRestore`, `retrieverDisable`,
 * `retrieverEnable`) goes through a dialog that says what stops and takes a
 * reason, and the page reads the door again afterwards.
 *
 * The screen is ahead of its doors (lib/api/pending.ts): until the control
 * plane serves them it says so and shows its three parts with no rows.
 */

type Notice = { tone: "ok" | "err"; text: string } | { door: Door };

const HISTORY_PAGE = 50;
const th = "px-3 py-2 text-[10.5px] font-medium whitespace-nowrap text-faint";
/*
 * A row's actions sit in the last column on a wide window. On a narrower one that column would scroll out
 * of sight, so it is dropped and the same actions are drawn under the row's name, where they stay in view.
 */
const actCol = "hidden py-2 pr-4 pl-3 text-right whitespace-nowrap xl:table-cell";
const actInline = "flex flex-wrap gap-1.5 pt-1.5 xl:hidden";

/** Who did something and when, on one line; what the record does not say is said. */
function ByLine({ verb, by, at, now }: { verb: string; by: string; at: string | undefined; now: number }) {
  return (
    <span className="text-[11.5px] leading-[1.45] text-dim" title={whenFull(at)}>
      {verb} {by ? <>by <span className="font-medium text-fg">{by}</span></> : "by someone the record does not name"}
      {at ? `, ${agoText(at, now)}` : ""}
    </span>
  );
}

function Reason({ text }: { text: string | undefined }) {
  return text ? <span className="text-[11.5px] leading-[1.45] break-words text-dim">Reason: {text}</span> : <span className="text-[11.5px] leading-[1.45] text-faint">No reason is recorded.</span>;
}

function RetrievalAccessPage() {
  const params = useSearchParams();
  const { answer, reload } = useDoor<RetrievalAccess>("retrievalAccess");
  const [agentF, setAgentF] = useState(() => params.get("agent") ?? "");
  const [storeF, setStoreF] = useState(() => params.get("store") ?? "");
  const [revokedOnly, setRevokedOnly] = useState(false);
  const [act, setAct] = useState<Act | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [historyShown, setHistoryShown] = useState(HISTORY_PAGE);
  // One clock reading per mount: "2h ago" must not move while the page is open.
  const [now] = useState(() => Date.now());

  const pending = answer?.state === "pending";
  const connected = answer?.state === "ok";
  const data: RetrievalAccess = useMemo(() => {
    const d = answer?.state === "ok" ? answer.data : null;
    return { stores: Array.isArray(d?.stores) ? d.stores : [], grants: Array.isArray(d?.grants) ? d.grants : [], history: Array.isArray(d?.history) ? d.history : [] };
  }, [answer]);
  const names = useMemo(() => namesOf(data), [data]);

  const stores = useMemo(() => [...data.stores].sort((a, b) => Number(b.retrieval === "disabled") - Number(a.retrieval === "disabled") || (a.name || a.id).localeCompare(b.name || b.id)), [data]);
  const off = stores.filter((s) => s.retrieval === "disabled").length;

  /* Each agent with the stores it holds, under the filters. */
  const agentIds = useMemo(() => [...new Set(data.grants.map((g) => g.agent))].sort((a, b) => names.agent(a).localeCompare(names.agent(b))), [data, names]);
  const groups = useMemo(
    () =>
      agentIds
        .filter((a) => !agentF || a === agentF)
        .map((a) => ({
          agent: a,
          all: data.grants.filter((g) => g.agent === a),
          shown: data.grants.filter((g) => g.agent === a && (!storeF || g.store === storeF) && (!revokedOnly || revokedOf(g).length > 0)).sort((x, y) => names.store(x.store).localeCompare(names.store(y.store))),
        }))
        .filter((g) => g.shown.length > 0),
    [agentIds, data, names, agentF, storeF, revokedOnly],
  );
  const agentsRevoked = agentIds.filter((a) => data.grants.some((g) => g.agent === a && revokedOf(g).length > 0)).length;
  const filters = (agentF ? 1 : 0) + (storeF ? 1 : 0) + (revokedOnly ? 1 : 0);
  const clear = () => {
    setAgentF("");
    setStoreF("");
    setRevokedOnly(false);
  };
  // A filter from the address that names nothing in the list still shows in its picker, so it can be seen and cleared.
  const agentOptions = [{ value: "", label: "Every agent" }, ...[...new Set([...agentIds, ...(agentF ? [agentF] : [])])].map((a) => ({ value: a, label: names.agent(a) }))];
  const storeOptions = [{ value: "", label: "Every store" }, ...[...new Set([...stores.map((s) => s.id), ...data.grants.map((g) => g.store), ...(storeF ? [storeF] : [])])].map((s) => ({ value: s, label: names.store(s) }))];

  const history = useMemo(() => [...data.history].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0)), [data]);

  const send = async (c: Change) => {
    if (busy) return;
    setBusy(true);
    const a = "store" in c ? await ask<unknown>(c.door, { params: { id: c.store }, body: c.body }) : await ask<unknown>(c.door, { body: c.body });
    setBusy(false);
    setAct(null);
    if (a.state === "pending") return setNotice({ door: a.door });
    if (a.state === "error") return setNotice({ tone: "err", text: a.message });
    setNotice({ tone: "ok", text: c.done });
    reload();
  };

  const noticeText: ReactNode = notice ? "door" in notice ? <NotConnectedNote door={notice.door} /> : notice.text : null;

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7">
      <GroupHeader
        group="data"
        tab="retrieval"
        actions={
          <Button variant="solid" tone="neutral" onClick={reload} loading={answer === null}>
            Read again
          </Button>
        }
      >
        Switch retrieval from a knowledge store off, which refuses every search and answer from it on the Knowledge page at once, or record that an agent may no longer read, write or delete in a store. Agents do not
        retrieve on this deployment yet, so a revocation is recorded and changes no run today.
      </GroupHeader>

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

      {/* 1. the stores, and whether retrieval from each is on */}
      <Section title="Stores" hue="retrieval" meta={connected ? `${stores.length.toLocaleString("en-GB")}${off ? ` · ${off.toLocaleString("en-GB")} switched off` : ""}` : undefined}>
        {answer === null && <p className="text-[12px] text-faint">Reading the stores…</p>}
        {pending && (
          <NotConnected door={answer.door}>
            Each knowledge store and data store an agent retrieves from, with its kind, its data class and whether retrieval from it is on. Switching a store off stops every agent retrieving from
            it; the row then says who switched it off, when and why. The agents and the history below wait for the same door.
          </NotConnected>
        )}
        {answer?.state === "error" && <Failure what="Retrieval access could not be read" message={answer.message} />}
        {connected && stores.length === 0 && <EmptyState title="No stores" detail="This deployment has no knowledge store or data store. Each one is listed here once it exists." />}
        {stores.length > 0 && (
          <div className="-m-4 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-[12px] xl:min-w-[900px]">
              <thead>
                <tr className="border-b border-line">
                  <th className={`${th} pl-4`}>Store</th>
                  <th className={th}>Kind</th>
                  <th className={th}>Data class</th>
                  <th className={th}>Retrieval</th>
                  <th className={th}>Agents with access</th>
                  <th className={actCol} />
                </tr>
              </thead>
              <tbody>
                {stores.map((s) => {
                  const isOff = s.retrieval === "disabled";
                  const holders = new Set(data.grants.filter((g) => g.store === s.id).map((g) => g.agent)).size;
                  const action = isOff ? (
                    <Button size="sm" variant="solid" tone="ink" permission="run" onClick={() => setAct({ what: "enable", store: s })}>
                      Switch back on
                    </Button>
                  ) : (
                    <Button size="sm" variant="solid" tone="err" permission="run" onClick={() => setAct({ what: "disable", store: s })}>
                      Switch retrieval off
                    </Button>
                  );
                  return (
                    <tr key={s.id} className="border-b border-line align-top last:border-0">
                      <td className="max-w-[320px] py-2.5 pr-3 pl-4">
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-[12.5px] font-medium text-fg">{s.name || s.id}</span>
                          {s.name && <span className="truncate font-mono text-[10.5px] text-faint">{s.id}</span>}
                          <span className={actInline}>{action}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-dim">{s.kind}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{s.data_class ? <Tag>{s.data_class}</Tag> : <span className="text-[11px] text-ghost">not set</span>}</td>
                      <td className="max-w-[420px] px-3 py-2.5">
                        <span className="flex flex-col gap-0.5">
                          {isOff ? <Status tone="err">Off for every agent</Status> : <Status tone="ok">On</Status>}
                          {isOff && (
                            <>
                              <ByLine verb="Switched off" by={ownerName(s.disabled_by)} at={s.disabled_at} now={now} />
                              <Reason text={s.reason} />
                            </>
                          )}
                        </span>
                      </td>
                      <td className="tnum px-3 py-2.5 whitespace-nowrap text-dim">{holders === 0 ? "none" : holders.toLocaleString("en-GB")}</td>
                      <td className={actCol}>{action}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* 2. each agent's rights in each store */}
      <Section
        title="Agents"
        meta={connected ? `${agentIds.length.toLocaleString("en-GB")}${agentsRevoked ? ` · ${agentsRevoked.toLocaleString("en-GB")} with access revoked` : ""}` : undefined}
      >
        <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 ${connected && data.grants.length > 0 ? "" : "pointer-events-none opacity-60"}`} aria-disabled={!(connected && data.grants.length > 0) || undefined}>
          <span className="w-56 max-w-full">
            <Pick aria-label="Agent" value={agentF} onChange={setAgentF} options={agentOptions} />
          </span>
          <span className="w-56 max-w-full">
            <Pick aria-label="Store" value={storeF} onChange={setStoreF} options={storeOptions} />
          </span>
          <Switch label="Revoked only" checked={revokedOnly} onChange={setRevokedOnly} />
          {filters > 0 && (
            <>
              <span className="grow" />
              <Button size="sm" variant="solid" tone="neutral" onClick={clear}>
                Clear {filters} filter{filters === 1 ? "" : "s"}
              </Button>
            </>
          )}
        </div>

        {!connected && <p className="text-[12px] text-faint">Each agent is listed here with the stores it holds: what its definition grants it there (read, write, delete) and what of that is revoked now.</p>}
        {connected && data.grants.length === 0 && <p className="text-[12px] text-faint">No agent holds access to a store. Agents do not retrieve on this deployment yet.</p>}
        {connected && data.grants.length > 0 && groups.length === 0 && <p className="text-[12px] text-faint">{revokedOnly && !agentF && !storeF ? "Nothing is revoked at the moment." : "No agent and store match these filters."}</p>}

        {groups.length > 0 && (
          <div className="-mx-4 -mb-4 overflow-x-auto border-t border-line">
            <table className="w-full min-w-[740px] border-collapse text-left text-[12px] xl:min-w-[980px]">
              <thead>
                <tr className="border-b border-line">
                  <th className={`${th} pl-4`}>Store</th>
                  {RETRIEVAL_RIGHTS.map((r) => (
                    <th key={r} className={`${th} capitalize`}>
                      {r}
                    </th>
                  ))}
                  <th className={th}>Revoked now</th>
                  <th className={actCol} />
                </tr>
              </thead>
              <tbody>
                {groups.map((grp) => {
                  const held = grp.all.some((g) => heldOf(g).length > 0);
                  const revoked = grp.all.filter((g) => revokedOf(g).length > 0).length;
                  const actions = (
                    <>
                      {revoked > 0 && (
                        <Button size="sm" variant="solid" tone="ink" permission="run" onClick={() => setAct({ what: "restore-all", agent: grp.agent })}>
                          Restore all access
                        </Button>
                      )}
                      {held && (
                        <Button size="sm" variant="solid" tone="err" permission="run" onClick={() => setAct({ what: "revoke-all", agent: grp.agent })}>
                          Revoke all access
                        </Button>
                      )}
                    </>
                  );
                  return (
                    <Fragment key={grp.agent}>
                      <tr className="border-b border-line bg-raise/40">
                        <td colSpan={RETRIEVAL_RIGHTS.length + 2} className="py-2 pr-3 pl-4">
                          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                            <span className="grid size-6 shrink-0 place-items-center rounded-md text-[10px] font-semibold text-on-solid" style={{ background: "var(--t-c2)" }} aria-hidden>
                              A
                            </span>
                            <span className="flex min-w-0 flex-col">
                              <Link href={`/agent?id=${encodeURIComponent(grp.agent)}`} className="focusable w-fit max-w-full truncate rounded-sm text-[12.5px] font-semibold text-fg hover:underline">
                                {names.agent(grp.agent)}
                              </Link>
                              {names.agent(grp.agent) !== grp.agent && <span className="truncate font-mono text-[10.5px] text-faint">{grp.agent}</span>}
                            </span>
                            <span className="text-[11px] text-faint">
                              {grp.all.length === 1 ? "1 store" : `${grp.all.length.toLocaleString("en-GB")} stores`}
                              {revoked > 0 ? ` · revoked in ${revoked.toLocaleString("en-GB")}` : ""}
                            </span>
                            {!held && <Status tone="err">Every right revoked</Status>}
                            <span className="grow xl:hidden" />
                            <span className="flex flex-wrap gap-1.5 xl:hidden">{actions}</span>
                          </span>
                        </td>
                        <td className={actCol}>
                          <span className="inline-flex flex-wrap justify-end gap-1.5">{actions}</span>
                        </td>
                      </tr>
                      {grp.shown.map((g) => (
                        <GrantRow key={`${g.agent}:${g.store}`} grant={g} store={names.storeById.get(g.store)} storeName={names.store(g.store)} now={now} onAct={setAct} />
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* 3. every change, newest first */}
      <Section title="History" hue="audit" meta={connected && history.length > 0 ? history.length.toLocaleString("en-GB") : undefined}>
        {!connected && <p className="text-[12px] text-faint">Every revocation, restoration and switch is listed here, newest first: when, who, what, which agent and store, and the reason.</p>}
        {connected && history.length === 0 && <p className="text-[12px] text-faint">Nothing has been revoked, restored or switched off on this deployment.</p>}
        {history.length > 0 && (
          <div className="-m-4 overflow-x-auto">
            <table className="w-full min-w-[1080px] border-collapse text-left text-[12px]">
              <thead>
                <tr className="border-b border-line">
                  <th className={`${th} pl-4`}>When</th>
                  <th className={th}>Who</th>
                  <th className={th}>What</th>
                  <th className={th}>Agent</th>
                  <th className={th}>Store</th>
                  <th className={`${th} pr-4`}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, historyShown).map((e, i) => {
                  const word = EVENT_WORD[e.action] ?? { label: String(e.action), tone: "neutral" as const };
                  const onStore = e.action === "disabled" || e.action === "enabled";
                  const rights = inOrder(e.rights);
                  return (
                    <tr key={`${e.at}:${e.action}:${e.agent ?? ""}:${e.store ?? ""}:${i}`} className="border-b border-line align-top last:border-0">
                      <td className="py-2.5 pr-3 pl-4 whitespace-nowrap">
                        <span className="flex flex-col">
                          <span className="tnum text-dim">{whenFull(e.at)}</span>
                          <span className="text-[10.5px] text-faint">{agoText(e.at, now)}</span>
                        </span>
                      </td>
                      <td className="max-w-[200px] px-3 py-2.5">
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-medium text-fg">{ownerName(e.who) || "not recorded"}</span>
                          {(e.who?.email || e.who?.team) && <span className="truncate text-[10.5px] text-faint">{[e.who.email, e.who.team].filter(Boolean).join(" · ")}</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex flex-col gap-0.5">
                          <Status tone={word.tone}>{word.label}</Status>
                          {!onStore && <span className="text-[11px] text-dim">{rights.length ? rights.join(", ") : "every right"}</span>}
                        </span>
                      </td>
                      <td className="max-w-[220px] px-3 py-2.5">
                        {e.agent ? (
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate text-fg">{names.agent(e.agent)}</span>
                            {names.agent(e.agent) !== e.agent && <span className="truncate font-mono text-[10.5px] text-faint">{e.agent}</span>}
                          </span>
                        ) : (
                          <span className="text-faint">{onStore ? "every agent" : "not recorded"}</span>
                        )}
                      </td>
                      <td className="max-w-[220px] px-3 py-2.5">{e.store ? <span className="block truncate text-fg">{names.store(e.store)}</span> : <span className="text-faint">{onStore ? "not recorded" : "every store it holds"}</span>}</td>
                      <td className="max-w-[360px] min-w-[260px] py-2.5 pr-4 pl-3 leading-[1.45] break-words text-dim">{e.reason || <span className="text-faint">none recorded</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {history.length > historyShown && (
              <div className="border-t border-line px-4 py-3">
                <Button size="sm" variant="solid" tone="neutral" onClick={() => setHistoryShown((n) => n + HISTORY_PAGE)}>
                  Show {Math.min(HISTORY_PAGE, history.length - historyShown).toLocaleString("en-GB")} more
                </Button>
              </div>
            )}
          </div>
        )}
      </Section>

      {act && connected && <ChangeDialog key={JSON.stringify([act.what, "agent" in act ? act.agent : "grant" in act ? [act.grant.agent, act.grant.store] : act.store.id])} act={act} data={data} busy={busy} onConfirm={send} onClose={() => !busy && setAct(null)} />}
    </div>
  );
}

/** One agent in one store: each right as granted, revoked or never granted, who revoked what, and the way to change it. */
function GrantRow({ grant: g, store, storeName, now, onAct }: { grant: RetrievalGrant; store: RetrievalStore | undefined; storeName: string; now: number; onAct: (a: Act) => void }) {
  const held = heldOf(g);
  const revoked = revokedOf(g);
  const actions = (
    <>
      {revoked.length > 0 && (
        <Button size="sm" variant="solid" tone="ink" permission="run" onClick={() => onAct({ what: "restore", grant: g })}>
          Restore
        </Button>
      )}
      {held.length > 0 && (
        <Button size="sm" variant="solid" tone="err" permission="run" onClick={() => onAct({ what: "revoke", grant: g })}>
          Revoke
        </Button>
      )}
    </>
  );
  return (
    <tr className="border-b border-line align-top last:border-0">
      <td className="max-w-[300px] py-2.5 pr-3 pl-4">
        <span className="flex min-w-0 flex-col gap-0.5 pl-9">
          <span className="truncate text-[12.5px] font-medium text-fg">{storeName}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {store?.kind && <span className="text-[10.5px] text-faint">{store.kind}</span>}
            {!store && <Mono className="text-[10.5px]">{g.store}</Mono>}
            {store?.retrieval === "disabled" && <Status tone="err">Retrieval off for every agent</Status>}
          </span>
          <span className={actInline}>{actions}</span>
        </span>
      </td>
      {RETRIEVAL_RIGHTS.map((r) => (
        <td key={r} className="px-3 py-2.5 whitespace-nowrap">
          <RightCell grant={g} right={r} />
        </td>
      ))}
      <td className="max-w-[360px] px-3 py-2.5">
        {revoked.length > 0 ? (
          <span className="flex flex-col gap-0.5">
            <ByLine verb={`${revoked.join(", ")} revoked`} by={ownerName(g.revoked_by)} at={g.revoked_at} now={now} />
            <Reason text={g.reason} />
          </span>
        ) : (
          <span className="text-[11.5px] text-faint">nothing</span>
        )}
      </td>
      <td className={actCol}>
        <span className="inline-flex flex-wrap justify-end gap-1.5">{actions}</span>
      </td>
    </tr>
  );
}

export function RetrievalAccessView() {
  return (
    <Suspense>
      <RetrievalAccessPage />
    </Suspense>
  );
}
