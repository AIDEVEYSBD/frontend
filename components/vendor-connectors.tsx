"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, Mono, Status, Tag, type Tone } from "./ui";
import { Field, Input } from "./forms";
import { Pick } from "./select";
import { Dialog } from "./overlays";
import { Failure } from "./pending";
import { ago } from "./identity-shared";
import { errorText } from "@/lib/api/client";

/**
 * Vendor connectors (`/api/vendors`): agents that live in a vendor's cloud,
 * brought under the platform through a connector for that vendor.
 *
 * A connector is code installed on the deployment; when none is, the
 * register says so and nothing can be connected. Through an installed one,
 * an administrator connects a vendor account, naming the vault credential
 * that holds the integration identity (never its value). A sync discovers
 * the account's agents and brings in its audit records, kept apart from
 * this platform's runs. How a vendor's model and tool calls would be routed
 * through the gateway and policy is shown as the platform says it: not built.
 */

type Routing = { built: boolean; says: string; model_calls: string | null; tool_calls: string | null };
type Installed = { vendor: string; label: string; account_means: string; routing: Routing };
type Connection = {
  id: string;
  vendor: string;
  label: string;
  account: string;
  identity: string;
  state: "never_synced" | "synced" | "failed";
  last_sync_at: string | null;
  last_error: string | null;
  agents: number | null;
  records: number;
  installed: boolean;
  routing: Routing;
};
type Register = { installed: Installed[]; connectors: Connection[]; says: string | null; not_built: string[] };

const STATE: Record<Connection["state"], { tone: Tone; label: string }> = {
  never_synced: { tone: "neutral", label: "never synced" },
  synced: { tone: "ok", label: "synced" },
  failed: { tone: "err", label: "last sync failed" },
};

async function send(method: string, path: string, body?: unknown): Promise<unknown> {
  const r = await fetch(path, { method, cache: "no-store", ...(body !== undefined ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
  const said = await r.json().catch(() => null);
  if (!r.ok) throw new Error(errorText(said, r, method, path));
  return said;
}

export function VendorConnectors() {
  const [register, setRegister] = useState<Register | null>(null);
  const [failed, setFailed] = useState("");
  const [vendor, setVendor] = useState("");
  const [label, setLabel] = useState("");
  const [account, setAccount] = useState("");
  const [identity, setIdentity] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const [removing, setRemoving] = useState<Connection | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const r = (await send("GET", "/api/vendors")) as Register;
      setRegister(r);
      setFailed("");
      setNow(Date.now());
      setVendor((v) => v || r.installed[0]?.vendor || "");
    } catch (e) {
      setFailed((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (what: string, run: () => Promise<string>) => {
    setBusy(what);
    try {
      setNote({ tone: "ok", text: await run() });
    } catch (e) {
      setNote({ tone: "err", text: (e as Error).message });
    } finally {
      setBusy("");
      void load();
    }
  };

  const connect = () =>
    act("connect", async () => {
      const made = (await send("POST", "/api/vendors", { vendor, label: label.trim(), account: account.trim(), identity: identity.trim() })) as Connection;
      setLabel("");
      setAccount("");
      setIdentity("");
      return `${made.label} is connected.`;
    });
  const sync = (c: Connection) =>
    act(`sync:${c.id}`, async () => {
      const done = (await send("POST", `/api/vendors/${encodeURIComponent(c.id)}/sync`)) as Connection & { this_sync: { agents: number; records_new: number; more: boolean } };
      const s = done.this_sync;
      return `${c.label} synced: ${s.agents} ${s.agents === 1 ? "agent" : "agents"} found, ${s.records_new} new audit ${s.records_new === 1 ? "record" : "records"}${s.more ? "; more remain, sync again" : ""}.`;
    });
  const remove = async () => {
    const c = removing;
    if (!c) return;
    await act(`remove:${c.id}`, async () => {
      const done = (await send("DELETE", `/api/vendors/${encodeURIComponent(c.id)}`)) as { records_kept: number };
      return `${c.label} is removed; its ${done.records_kept} audit ${done.records_kept === 1 ? "record is" : "records are"} kept.`;
    });
    setRemoving(null);
  };

  const chosen = register?.installed.find((i) => i.vendor === vendor);

  return (
    <div className="flex flex-col border-t border-line bg-surface">
      <span className="border-b border-line px-4 py-2 text-[10.5px] text-ghost">Vendor connectors</span>
      {failed && (
        <div className="px-4 py-3">
          <Failure what="The vendor connectors could not be read" message={failed} />
        </div>
      )}
      {!register && !failed && <p className="px-4 py-3 text-[11.5px] text-faint">Reading the vendor connectors…</p>}
      {register && register.installed.length === 0 && <p className="px-4 py-3 text-[12px] text-dim">No vendor connector is installed.</p>}

      {register && register.installed.length > 0 && (
        <form
          className="flex flex-col gap-3 border-b border-line px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
          }}
        >
          <span className="text-[12px] font-semibold text-fg">Connect a vendor account</span>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Vendor">
              <Pick aria-label="Vendor" value={vendor} onChange={setVendor} options={register.installed.map((i) => ({ value: i.vendor, label: i.label }))} />
            </Field>
            <Field label="Label" hint="How the register names this account.">
              <Input value={label} onChange={setLabel} autoComplete="off" />
            </Field>
            <Field label="Account" hint={chosen ? `This vendor's account is ${chosen.account_means}.` : undefined}>
              <Input value={account} onChange={setAccount} mono autoComplete="off" />
            </Field>
            <Field label="Integration identity" hint="The vault credential name the connector signs in with.">
              <Input value={identity} onChange={setIdentity} mono autoComplete="off" />
            </Field>
          </div>
          <span>
            <Button type="submit" size="sm" variant="solid" tone="ink" permission="configure" loading={busy === "connect"}
              disabled={!vendor || !label.trim() || !account.trim() || !identity.trim()}>
              Connect
            </Button>
          </span>
        </form>
      )}

      {note && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
          <Status tone={note.tone}>{note.tone === "err" ? "Refused" : "Done"}</Status>
          <span className="min-w-0 grow text-[12px] leading-[1.5] text-fg">{note.text}</span>
          <Button size="sm" variant="solid" tone="neutral" onClick={() => setNote(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {register && register.installed.length > 0 && register.connectors.length === 0 && (
        <p className="px-4 py-3 text-[11.5px] text-faint">No vendor account is connected.</p>
      )}
      {register?.connectors.map((c) => (
        <div key={c.id} className="flex flex-col gap-1.5 border-b border-line px-4 py-2.5 last:border-0">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-medium text-fg">{c.label}</span>
            <Tag>{c.vendor}</Tag>
            <Status tone={STATE[c.state].tone}>{STATE[c.state].label}</Status>
            {!c.installed && <Status tone="warn">connector no longer installed</Status>}
            <span className="grow" />
            <Button size="sm" variant="solid" tone="ink" permission="configure" loading={busy === `sync:${c.id}`} disabled={!c.installed} onClick={() => void sync(c)}>
              Sync now
            </Button>
            <Button size="sm" variant="solid" tone="err" permission="configure" onClick={() => setRemoving(c)}>
              Remove
            </Button>
          </span>
          <span className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-faint">
            <span>
              account <Mono className="text-[10.5px]">{c.account}</Mono>
            </span>
            <span>
              identity <Mono className="text-[10.5px]">{c.identity}</Mono> (vault)
            </span>
            <span>last sync {c.last_sync_at ? ago(c.last_sync_at, now) : "never"}</span>
            <span>{c.agents === null ? "agents not discovered yet" : `${c.agents} ${c.agents === 1 ? "agent" : "agents"}`}</span>
            <span>
              {c.records} audit {c.records === 1 ? "record" : "records"} brought in
            </span>
          </span>
          {c.last_error && <span className="text-[11px] leading-[1.5] text-err">{c.last_error}</span>}
          <span className="text-[11px] leading-[1.5] text-faint">
            Routing:{" "}
            {c.routing.built ? (
              [c.routing.model_calls && `model calls: ${c.routing.model_calls}`, c.routing.tool_calls && `tool calls: ${c.routing.tool_calls}`].filter(Boolean).join("; ") || "built"
            ) : (
              <span data-not-built="routing">Not built</span>
            )}
          </span>
        </div>
      ))}

      {removing && (
        <Dialog modal tone="err" cancel="Cancel" confirm="Remove account" title={`Remove ${removing.label}?`} loading={busy === `remove:${removing.id}`}
          onConfirm={() => void remove()} onClose={() => !busy && setRemoving(null)}>
          <span className="text-[12px] leading-[1.5] text-dim">
            Its agents are forgotten; its {removing.records} audit {removing.records === 1 ? "record is" : "records are"} kept.
          </span>
        </Dialog>
      )}
    </div>
  );
}
