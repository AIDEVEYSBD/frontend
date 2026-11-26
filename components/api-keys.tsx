"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Mono, Status, Tag } from "./ui";
import { Checkbox, Field, Input } from "./forms";
import { Pick } from "./select";
import { Dialog } from "./overlays";
import { Failure } from "./pending";
import { ago } from "./identity-shared";
import { listAgents, listKeys, mintKey, readUsers, revokeKey, type KeyList, type KeyRow, type MintedKey } from "@/lib/api/l2";

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
 *
 * A key expires. It is minted for the number of days asked, or, with none
 * asked, for the deployment's longest lifetime (API_KEY_MAX_LIFETIME_DAYS);
 * the platform refuses a number above that with the range it allows. The
 * list answers that longest lifetime (`max_lifetime_days`), and the form
 * names it. Each key shows when it stops working, as the list answers
 * it: its own expiry, or its minting plus the longest lifetime allowed now,
 * whichever is first. An expired key is refused from that moment.
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
  /** Days the key is to live; blank asks for the deployment's longest lifetime. */
  const [days, setDays] = useState("");
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState("");
  const [minted, setMinted] = useState<(MintedKey & { expires_at?: string | null }) | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<KeyRow | null>(null);
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

  /** The longest lifetime this deployment allows now, as the key list answers it; unknown until the list is read. */
  const maxDays = (list as { max_lifetime_days?: unknown } | null)?.max_lifetime_days;
  const lifetime = days.trim() ? Number(days.trim()) : undefined;
  const lifetimeProblem = lifetime === undefined ? "" : !Number.isInteger(lifetime) || lifetime < 1 ? "A whole number of days, 1 or more." : "";

  const mint = async () => {
    if (!name.trim() || busy || lifetimeProblem) return;
    setBusy(true);
    setRefused("");
    try {
      // With the permission list unread, nothing is sent and the platform mints its default.
      const m = await mintKey(name.trim(), agent || null, permissions ? picked : undefined, lifetime);
      setMinted(m);
      setCopied(false);
      setName("");
      setAgent("");
      setDays("");
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
      setRevokeNote({ tone: "ok", text: `${k.name} (${k.prefix}…) is revoked.` });
      load();
    } catch (e) {
      setRevokeNote({ tone: "err", text: `${k.name} was not revoked: ${(e as Error).message}` });
    } finally {
      setRevokeBusy(false);
      setRevoking(null);
    }
  };

  const keys: KeyRow[] = list?.keys ?? [];
  /** A key past its expiry is refused already, revoked or not. */
  const expired = (k: KeyRow) => Boolean(k.expires_at) && Date.parse(k.expires_at!) <= now;
  const until = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "");
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px]">
          <Field label="Name" hint="What it is for.">
            <Input value={name} onChange={setName} autoComplete="off" />
          </Field>
          <Field label="Acts as" hint={agentsError ? `The saved agents could not be read: ${agentsError}` : agents && agents.length === 0 ? "No agent is saved yet." : "A bound key starts only that agent's runs."}>
            <Pick
              aria-label="Acts as"
              value={agent}
              onChange={setAgent}
              loading={agents === null && !agentsError}
              options={[{ value: "", label: "Any agent its permissions allow" }, ...(agents ?? []).map((a) => ({ value: a.id, label: a.name === a.id ? a.id : `${a.name} (${a.id})` }))]}
            />
          </Field>
          <Field
            label="Lifetime in days (optional)"
            hint={
              lifetimeProblem ||
              (typeof maxDays === "number"
                ? `Blank for the longest allowed: ${maxDays} day${maxDays === 1 ? "" : "s"}.`
                : "Blank for the longest this deployment allows.")
            }
          >
            <Input value={days} onChange={setDays} type="number" invalid={Boolean(lifetimeProblem)} aria-label="Lifetime in days" autoComplete="off" />
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
            <span className="text-[11.5px] leading-[1.5] text-err">The permissions could not be read ({permissionsError}); the key gets view and run.</span>
          ) : (
            <span className="text-[11.5px] text-faint">Reading the permissions…</span>
          )}
        </div>
        <span className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" variant="solid" tone="ink" permission="iam" loading={busy} disabled={!name.trim() || (permissions !== null && picked.length === 0) || Boolean(lifetimeProblem)}>
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
            <span className="text-[12.5px] font-medium text-fg">{minted.name} is minted; it is shown only once.</span>
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
            Send it as Authorization: Bearer &lt;key&gt; · prefix <Mono className="text-[11px]">{minted.prefix}</Mono>
            {minted.agent ? ` · acts as ${agentName(minted.agent)}` : ""} · expires {minted.expires_at ? until(minted.expires_at) : "—"}
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
          <table className="w-full min-w-[860px] border-collapse text-left text-[12px]">
            <thead>
              <tr className="border-b border-line text-[10.5px] text-faint">
                <th className="py-2 pr-3 pl-4 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Acts as</th>
                <th className="px-3 py-2 font-medium">Minted</th>
                <th className="px-3 py-2 font-medium">Last used</th>
                <th className="px-3 py-2 font-medium">Expires</th>
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
                  <td className="tnum px-3 py-2 whitespace-nowrap text-dim" title={k.expires_at ? "Its own expiry, or its minting plus the longest lifetime this deployment allows now, whichever is first" : undefined}>
                    {k.expires_at ? until(k.expires_at) : <span className="text-faint">not said</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {k.revoked_at ? (
                      <Status tone="neutral">revoked {ago(k.revoked_at, now)}</Status>
                    ) : expired(k) ? (
                      <span title="Past its expiry: every request presenting it is refused.">
                        <Status tone="warn">expired</Status>
                      </span>
                    ) : (
                      <Status tone="ok">active</Status>
                    )}
                  </td>
                  <td className="py-2 pr-4 pl-3 text-right">
                    {!k.revoked_at && !expired(k) && (
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
          <span>
            Anything using <Mono className="text-[11.5px]">{revoking.prefix}…</Mono> is refused; it cannot be restored.
          </span>
        </Dialog>
      )}
    </div>
  );
}
