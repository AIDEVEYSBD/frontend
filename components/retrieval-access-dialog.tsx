"use client";

import { useState } from "react";
import { Checkbox } from "./forms";
import { Affected, ReasonDialog, agentName, heldOf, inOrder, namesOf, revokedOf, rightsPhrase } from "./retrieval-access-parts";
import { RETRIEVAL_RIGHTS, type RetrievalAccess, type RetrievalChange, type RetrievalGrant, type RetrievalRight, type RetrievalStore, type RetrieverSwitch } from "@/lib/api/pending";

/**
 * The question asked before retrieval access changes: what is about to stop
 * (or come back), for whom, and why. Taking something away is the red
 * action; giving it back is the ordinary one. Every change carries a reason,
 * because the doors record one (`RetrievalChange`, `RetrieverSwitch`).
 */

export type Act =
  | { what: "revoke"; grant: RetrievalGrant }
  | { what: "revoke-all"; agent: string }
  | { what: "restore"; grant: RetrievalGrant }
  | { what: "restore-all"; agent: string }
  | { what: "disable"; store: RetrievalStore }
  | { what: "enable"; store: RetrievalStore };

/** What a confirmed change sends, and what the page says once it is done. */
export type Change =
  | { door: "retrievalRevoke" | "retrievalRestore"; body: RetrievalChange; done: string }
  | { door: "retrieverDisable" | "retrieverEnable"; store: string; body: RetrieverSwitch; done: string };

const RIGHT_LABEL: Record<RetrievalRight, string> = { read: "Read", write: "Write", delete: "Delete" };

/** Tick boxes for the rights a change covers, when there is more than one to choose from. */
function RightsChoice({ label, among, picked, onChange, disabled, error }: { label: string; among: RetrievalRight[]; picked: RetrievalRight[]; onChange: (r: RetrievalRight[]) => void; disabled: boolean; error: boolean }) {
  if (among.length < 2) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium text-mist">{label}</span>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {among.map((r) => (
          <Checkbox key={r} label={RIGHT_LABEL[r]} checked={picked.includes(r)} disabled={disabled} onChange={(on) => onChange(inOrder(on ? [...picked, r] : picked.filter((x) => x !== r)))} />
        ))}
      </div>
      {error && (
        <span role="alert" className="text-[11.5px] text-err">
          Choose at least one right.
        </span>
      )}
    </div>
  );
}

export function ChangeDialog({ act, data, busy, onConfirm, onClose }: { act: Act; data: RetrievalAccess; busy: boolean; onConfirm: (c: Change) => void; onClose: () => void }) {
  const names = namesOf(data);
  // What one grant's change may cover: what is still held (to revoke) or what is revoked (to restore).
  const among = act.what === "revoke" ? heldOf(act.grant) : act.what === "restore" ? revokedOf(act.grant) : [];
  const [picked, setPicked] = useState<RetrievalRight[]>(among);
  const [unpicked, setUnpicked] = useState(false);
  const choose = (r: RetrievalRight[]) => {
    setPicked(r);
    setUnpicked(false);
  };

  if (act.what === "revoke" || act.what === "restore") {
    const g = act.grant;
    const agent = agentName(g);
    const store = names.store(g.store);
    const taking = act.what === "revoke";
    return (
      <ReasonDialog
        title={taking ? `Revoke ${agent}'s access to ${store}?` : `Restore ${agent}'s access to ${store}?`}
        confirm={taking ? "Revoke access" : "Restore access"}
        tone={taking ? "err" : "ink"}
        permission="run"
        busy={busy}
        ready={picked.length > 0}
        onBlocked={() => setUnpicked(true)}
        placeholder={taking ? "Why this access is taken away." : "Why this access is given back."}
        onClose={onClose}
        onConfirm={(reason) =>
          onConfirm({
            door: taking ? "retrievalRevoke" : "retrievalRestore",
            body: { agent: g.agent, store: g.store, rights: picked, reason },
            done: taking ? `${agent} can no longer ${rightsPhrase(picked)} ${store}.` : `${agent} can again ${rightsPhrase(picked, "and")} ${store}.`,
          })
        }
      >
        <RightsChoice label={taking ? "What to take away" : "What to give back"} among={among} picked={picked} onChange={choose} disabled={busy} error={unpicked} />
        {picked.length > 0 &&
          (taking ? (
            <span>
              <span className="font-medium text-fg">{agent}</span> can no longer {rightsPhrase(picked)} <span className="font-medium text-fg">{store}</span>, from its next call.
            </span>
          ) : (
            <span>
              <span className="font-medium text-fg">{agent}</span> can again {rightsPhrase(picked, "and")} <span className="font-medium text-fg">{store}</span>, from its next call.
            </span>
          ))}
      </ReasonDialog>
    );
  }

  if (act.what === "revoke-all" || act.what === "restore-all") {
    const mine = data.grants.filter((g) => g.agent === act.agent);
    const agent = names.agent(act.agent);
    const taking = act.what === "revoke-all";
    const rows = mine
      .map((g) => ({ key: g.store, name: names.store(g.store), rights: taking ? heldOf(g) : revokedOf(g) }))
      .filter((r) => r.rights.length > 0)
      .map((r) => ({ key: r.key, name: r.name, detail: r.rights.join(", ") }));
    // Restoring names the rights that are revoked somewhere; revoking names every right there is.
    const rights = taking ? RETRIEVAL_RIGHTS : inOrder(mine.flatMap((g) => revokedOf(g)));
    return (
      <ReasonDialog
        title={taking ? `Revoke all access of ${agent}?` : `Restore all access of ${agent}?`}
        confirm={taking ? "Revoke all access" : "Restore all access"}
        tone={taking ? "err" : "ink"}
        permission="run"
        busy={busy}
        placeholder={taking ? "Why this agent's access is taken away." : "Why this agent's access is given back."}
        onClose={onClose}
        onConfirm={(reason) =>
          onConfirm({
            door: taking ? "retrievalRevoke" : "retrievalRestore",
            body: { agent: act.agent, rights, reason },
            done: taking ? `Every right ${agent} held was revoked, in every store.` : `Everything revoked from ${agent} was restored.`,
          })
        }
      >
        {taking ? (
          <span>
            <span className="font-medium text-fg">{agent}</span> loses every right in every store it holds.
          </span>
        ) : (
          <span>
            Everything revoked from <span className="font-medium text-fg">{agent}</span> is given back, from its next call.
          </span>
        )}
        {rows.length > 0 && <Affected rows={rows} />}
      </ReasonDialog>
    );
  }

  const s = act.store;
  const name = s.name || s.id;
  const holders = data.grants.filter((g) => g.store === s.id);
  const rows = holders.map((g) => ({ key: g.agent, name: agentName(g), detail: heldOf(g).join(", ") || "every right revoked" }));
  if (act.what === "disable") {
    return (
      <ReasonDialog
        title={`Switch retrieval from ${name} off?`}
        confirm="Switch retrieval off"
        tone="err"
        permission="run"
        busy={busy}
        placeholder="Why retrieval from this store is stopped."
        onClose={onClose}
        onConfirm={(reason) => onConfirm({ door: "retrieverDisable", store: s.id, body: { reason }, done: `Retrieval from ${name} is switched off for every agent.` })}
      >
        <span>
          Every search and retrieval from <span className="font-medium text-fg">{name}</span> is refused until switched back on.
        </span>
        {rows.length > 0 && (
          <>
            <span>{rows.length === 1 ? "One agent holds access to it:" : `${rows.length.toLocaleString("en-GB")} agents hold access to it:`}</span>
            <Affected rows={rows} />
          </>
        )}
      </ReasonDialog>
    );
  }
  return (
    <ReasonDialog
      title={`Switch retrieval from ${name} back on?`}
      confirm="Switch back on"
      tone="ink"
      permission="run"
      busy={busy}
      placeholder="Why retrieval from this store is allowed again."
      onClose={onClose}
      onConfirm={(reason) => onConfirm({ door: "retrieverEnable", store: s.id, body: { reason }, done: `Retrieval from ${name} is switched back on.` })}
    >
      <span>
        Agents with access to <span className="font-medium text-fg">{name}</span> can retrieve again from their next call.
      </span>
      {rows.length > 0 && <Affected rows={rows} />}
    </ReasonDialog>
  );
}
