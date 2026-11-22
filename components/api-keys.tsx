"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Mono, Status, Tag } from "./ui";
import { Checkbox, Field, Input } from "./forms";
import { Pick } from "./select";
import { Dialog } from "./overlays";
import { Failure } from "./pending";
import { ago } from "./identity-shared";
import { listAgents, listKeys, mintKey, readUsers, revokeKey, type KeyList, type MintedKey } from "@/lib/api/l2";

/**
 * API keys: how an agent or a script calls the platform without a person at
 * a browser (`GET /api/keys`, `POST /api/keys`, `DELETE /api/keys/{id}`).
 *
 * A key is shown once, in the answer that mints it, and never again: the
 * platform keeps its SHA-256 and a prefix to recognise it by. A key may be
 * bound to one saved agent, and then acts only as that agent. What a key may
 * hold is the platform's rule, not this page's: every permission is offered,
 * and one the platform refuses (approve, iam, configure) comes back with its
 * reason, shown as it was said. Minting and revoking need `iam`.
 */

type Permission = { permission: string; means: string };
const DEFAULT_PERMISSIONS = ["view", "run"];

export function ApiKeys() {
  const [list, setList] = useState<KeyList | null>(null);
  const [listError, setListError] = useState("");
  const [agents, setAgents] = useState<{ id: string; name: string }[] | null>(null);
  const [agentsError, setAgentsError] = useState("");
  const [permissions, setPermissions] = useState<Permission[] | null>(null);
  const [permissionsError, setPermissionsError] = useState("");
  const [name, setName] = useState("");
  const [agent, setAgent] = useState("");
  const [picked, setPicked] = useState<string[]>(DEFAULT_PERMISSIONS);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState("");
  const [minted, setMinted] = useState<MintedKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<KeyList["keys"][number] | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);
  const [revokeNote, setRevokeNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  // One clock reading per mount: "3m ago" must not move while the panel is open.
  const [now] = useState(() => Date.now());

  const load = useCallback(() => {
    listKeys()
      .then((k) => {
        setList(k);
        setListError("");
      })
      .catch((e) => setListError((e as Error).message));
  }, []);

  useEffect(() => {
    load();
    listAgents()
      .then((rows) => setAgents(rows.map((a) => ({ id: a.id, name: a.name || a.id }))))
      .catch((e) => setAgentsError((e as Error).message));
    readUsers()
      .then((u) => setPermissions(u.permissions ?? []))
      .catch((e) => setPermissionsError((e as Error).message));
  }, [load]);

  const mint = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setRefused("");
    try {
      // With the permission list unread, nothing is sent and the platform mints its default.
      const m = await mintKey(name.trim(), agent || null, permissions ? picked : undefined);
      setMinted(m);
      setCopied(false);
      setName("");
      setAgent("");
      setPicked(DEFAULT_PERMISSIONS);
      load();
    } catch (e) {
      setRefused((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!revoking || revokeBusy) return;
    setRevokeBusy(true);
    const k = revoking;
    try {
      await revokeKey(k.id);
      setRevokeNote({ tone: "ok", text: `${k.name} (${k.prefix}…) is revoked: its next request is refused. The row stays as the record of what it was.` });
      load();
    } catch (e) {
      setRevokeNote({ tone: "err", text: `${k.name} was not revoked: ${(e as Error).message}` });
    } finally {
      setRevokeBusy(false);
      setRevoking(null);
    }
  };

  const keys = list?.keys ?? [];
  const toggle = (p: string, on: boolean) => setPicked((cur) => (on ? [...new Set([...cur, p])] : cur.filter((x) => x !== p)));
  const agentName = (id: string | null | undefined) => (id ? (agents?.find((a) => a.id === id)?.name ?? id) : "");

  return (
    <div className="flex flex-col">
      {/* ── mint ── */}
      <form
        className="flex flex-col gap-3 border-b border-line px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          void mint();
        }}
      >
        <span className="text-[12px] font-semibold text-fg">Mint a key</span>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" hint="What it is for, as the register and Sessions will show it.">
            <Input value={name} onChange={setName} autoComplete="off" />
          </Field>
          <Field label="Acts as" hint={agentsError ? `The saved agents could not be read: ${agentsError}` : agents && agents.length === 0 ? "No agent is saved yet, so the key cannot be bound to one." : "Bound to one agent, the key starts that agent's runs and no other."}>
            <Pick
              aria-label="Acts as"
              value={agent}
              onChange={setAgent}
              loading={agents === null && !agentsError}
              options={[{ value: "", label: "Any agent its permissions allow" }, ...(agents ?? []).map((a) => ({ value: a.id, label: a.name === a.id ? a.id : `${a.name} (${a.id})` }))]}
            />
          </Field>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-mist">Permissions</span>
          {permissions ? (
            <span className="flex flex-wrap gap-x-4 gap-y-1.5">
              {permissions.map((p) => (
                <span key={p.permission} title={p.means}>
                  <Checkbox label={p.permission} checked={picked.includes(p.permission)} onChange={(on) => toggle(p.permission, on)} />
                </span>
              ))}
            </span>
          ) : permissionsError ? (
            <span className="text-[11.5px] leading-[1.5] text-err">The permission list could not be read ({permissionsError}), so none is sent: the platform mints its default, view and run.</span>
          ) : (
            <span className="text-[11.5px] text-faint">Reading the permissions…</span>
          )}
          <span className="text-[11px] leading-[1.5] text-faint">What a key may hold is the platform&rsquo;s rule: a permission it refuses comes back with the reason, below.</span>
        </div>
        <span className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" variant="solid" tone="ink" permission="iam" loading={busy} disabled={!name.trim() || (permissions !== null && picked.length === 0)}>
            Mint key
          </Button>
          {permissions !== null && picked.length === 0 && <span className="text-[11.5px] text-faint">Pick at least one permission.</span>}
        </span>
        {refused && <Failure what="The key was not minted" message={refused} />}
      </form>

      {/* ── shown once ── */}
      {minted && (
        <div className="flex flex-col gap-2 border-b border-line bg-warn/5 px-4 py-3" role="status">
          <span className="flex flex-wrap items-center gap-2">
            <Status tone="warn">Copy it now</Status>
            <span className="text-[12.5px] font-medium text-fg">
              {minted.name} is minted. This is the only time the key is shown: it is not shown again, here or anywhere.
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 grow rounded-sm border border-line bg-surface px-2 py-1.5 font-mono text-[12px] break-all text-fg" data-minted-key>
              {minted.key}
            </span>
            <Button
              size="sm"
              variant="solid"
              tone="ink"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(minted.key)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false))
              }
            >
              {copied ? "Copied" : "Copy"}
            </Button>
            <Button size="sm" variant="solid" tone="neutral" onClick={() => setMinted(null)}>
              {copied ? "Done" : "I have kept it"}
            </Button>
          </span>
          <span className="text-[11.5px] leading-[1.5] text-dim">
            {(minted.note ?? "").replace(/^This is the only time the key is shown\.\s*/, "") || "Send it as Authorization: Bearer <key>."} The platform keeps only its SHA-256 and the prefix <Mono className="text-[11px]">{minted.prefix}</Mono>
            {minted.agent ? `; it acts only as the agent ${agentName(minted.agent)}` : ""}.
          </span>
        </div>
      )}

      {revokeNote && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
          <Status tone={revokeNote.tone}>{revokeNote.tone === "err" ? "Refused" : "Done"}</Status>
          <span className="min-w-0 grow text-[12px] leading-[1.5] text-fg">{revokeNote.text}</span>
          <Button size="sm" variant="solid" tone="neutral" onClick={() => setRevokeNote(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {/* ── every key ── */}
      {listError && (
        <div className="px-4 py-3">
          <Failure what="The keys could not be read" message={listError} />
        </div>
      )}
      {!list && !listError && <p className="px-4 py-3 text-[11.5px] text-faint">Reading the keys…</p>}
      {list && keys.length === 0 && <p className="px-4 py-3 text-[11.5px] text-faint">No key has been minted.</p>}
      {keys.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-[12px]">
            <thead>
              <tr className="border-b border-line text-[10.5px] text-faint">
                <th className="py-2 pr-3 pl-4 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Acts as</th>
                <th className="px-3 py-2 font-medium">Minted</th>
                <th className="px-3 py-2 font-medium">Last used</th>
                <th className="px-3 py-2 font-medium">State</th>
                <th className="py-2 pr-4 pl-3" />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b border-line align-middle last:border-0">
                  <td className="py-2 pr-3 pl-4">
                    <span className="flex flex-col">
                      <span className={k.revoked_at ? "text-dim" : "text-fg"}>{k.name}</span>
                      <Mono className="text-[10.5px] text-faint">
                        {k.prefix}… · {k.id}
                      </Mono>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-dim">{k.agent ? <Tag>{agentName(k.agent)}</Tag> : "any agent"}</td>
                  <td className="tnum px-3 py-2 whitespace-nowrap text-dim" title={new Date(k.created_at).toLocaleString("en-GB")}>
                    {ago(k.created_at, now)}
                  </td>
                  <td className="tnum px-3 py-2 whitespace-nowrap text-dim" title={k.last_used ? new Date(k.last_used).toLocaleString("en-GB") : undefined}>
                    {k.last_used ? ago(k.last_used, now) : <span className="text-faint">never</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{k.revoked_at ? <Status tone="neutral">revoked {ago(k.revoked_at, now)}</Status> : <Status tone="ok">active</Status>}</td>
                  <td className="py-2 pr-4 pl-3 text-right">
                    {!k.revoked_at && (
                      <Button size="sm" variant="solid" tone="err" permission="iam" onClick={() => setRevoking(k)}>
                        Revoke
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {revoking && (
        <Dialog modal tone="err" cancel="Cancel" confirm="Revoke key" title={`Revoke ${revoking.name}?`} loading={revokeBusy} onConfirm={revoke} onClose={() => !revokeBusy && setRevoking(null)}>
          <span className="flex flex-col gap-2">
            <span>
              Its next request is refused, and a revoked key cannot be restored: anything still using <Mono className="text-[11.5px]">{revoking.prefix}…</Mono> needs a new key.
            </span>
            {revoking.agent && <span>It acts as the agent {agentName(revoking.agent)}; that agent itself is not changed.</span>}
          </span>
        </Dialog>
      )}
    </div>
  );
}
