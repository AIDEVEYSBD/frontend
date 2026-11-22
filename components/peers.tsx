"use client";
import { useDoorOff } from "@/lib/use-doors";
import { Failure } from "./pending";
import { notBuiltDoorOf } from "@/lib/api/client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Mono, Status, Tag } from "./ui";
import { Pick } from "./select";
import { ControlRef } from "./control-ref";
import { DigestChip } from "./digest-chip";
import { dataClassChoices } from "@/lib/bom";
import { soon } from "@/lib/soon";
import { controlLabel } from "@/lib/guardrails";
import { DoorError } from "@/lib/api/l5";
import { addPeer, approvePeer, deletePeer, listPeers, peerOfRefusal, rescanPeer, type Peer } from "@/lib/api/l7b";
import { type Me } from "@/lib/mcp-registry";
import {
  EMPTY_PEER_FORM,
  PEER_STATUS_META,
  approvePeerAccess,
  approvedDigest,
  cardChange,
  cardChangeLine,
  cardTitle,
  fetchLine,
  orderPeers,
  peerBody,
  peerClassLine,
  peerCounts,
  peerFormProblem,
  skillsOf,
  slugOfLabel,
  type PeerForm,
} from "@/lib/peers";

/**
 * The peer registry (phase L7, second round; backend/CONTRACT.md "The peer
 * registry"): the A2A agents this factory hands tasks to and hears tasks
 * from, shaped like Tool servers (components/tool-servers.tsx), because a
 * peer is admitted the way a tool server is.
 *
 * Registering is admission, not trust. The registry fetches the peer's
 * agent card signed under the secret the two sides share, checks the
 * answer's signature, and pins the card by its digest; the peer waits,
 * pending, until a person approves the card, and only an approved peer is
 * spoken to, or heard. A rescan that finds another card marks the peer
 * changed and refuses it both ways until someone approves again; the row
 * shows the digest approved against the one found, and what moved. A card
 * that could not be fetched is kept with the fetch's error: two factories
 * register each other before either can answer. The secret is shown by its
 * vault name only; the value never leaves the vault. Every action needs the
 * configure permission, so a viewer reads all of this and changes none of it.
 *
 * It is a panel of Configuration (components/configuration.tsx): this file
 * holds the panel's body and the registry's read.
 */

function ago(iso: string): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const mins = Math.round((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

/** The signer as a reader wants it: the name, the email kept for the hover. */
function who(by: string): string {
  return by.replace(/\s*<[^>]*>\s*$/, "").trim() || by || "unknown";
}

export function meOf(session: { name: string; email: string; sub: string } | null): Me | null {
  return session ? { name: session.name, email: session.email, sub: session.sub } : null;
}

/** A status as a chip: a changed card is solid red, so it stops a reader scanning the list. */
function PeerStatusTag({ status }: { status: Peer["status"] }) {
  const meta = PEER_STATUS_META[status];
  return (
    <span title={meta.means}>
      <Tag tone={meta.tone} solid={meta.alarming}>
        {meta.label}
      </Tag>
    </span>
  );
}

/** A refusal from the registry: the message, and the control it names in the register's words. */
function Refusal({ error }: { error: Error }) {
  if (notBuiltDoorOf(error.message)) return <Failure inline message={error.message} />;
  const control = error instanceof DoorError ? error.control ?? "" : "";
  return (
    <span className="flex flex-wrap items-center gap-2 text-[11.5px] leading-[1.5] text-err">
      {control && <span className="font-medium">{controlLabel(control)}.</span>}
      <span>{error.message}</span>
      {control && <ControlRef control={control} />}
    </span>
  );
}

function Fact({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[10px] text-ghost">{k}</span>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-dim">{children}</span>
    </span>
  );
}

/* ═══════════════════ registering a peer ═══════════════════ */

const INPUT = "focusable h-8 w-full rounded-md border border-line-strong bg-field px-2.5 text-[12.5px] text-fg placeholder:text-ghost";

/**
 * The register form. It posts the contract's body (lib/peers.ts peerBody):
 * the peer's A2A endpoint and the vault name of the secret the two sides
 * share. The card is fetched at once; a fetch that fails is no refusal (the
 * peer is kept, without a card, until a rescan pins one).
 */
function RegisterPeerForm({ onAdded, onCancel }: { onAdded: (p: Peer) => void; onCancel: () => void }) {
  const [form, setForm] = useState<PeerForm>(EMPTY_PEER_FORM);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const set = (patch: Partial<PeerForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setError(null);
  };
  const problem = peerFormProblem(form);
  const cell = "flex min-w-0 grow basis-[200px] flex-col gap-1";

  const submit = async () => {
    if (problem || busy) return;
    setBusy(true);
    setError(null);
    try {
      const peer = await addPeer(peerBody(form));
      setForm(EMPTY_PEER_FORM);
      onAdded(peer);
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-2.5 border-b border-line bg-raise/40 px-4 py-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold text-fg">Register a peer</span>
        <span className="text-[10.5px] text-faint">its agent card is fetched signed and pinned; nothing is sent to it, or heard from it, until a person approves the card</span>
      </span>
      <div className="flex flex-wrap items-end gap-2">
        <label className={cell}>
          <span className="text-[10.5px] text-ghost">Name</span>
          <input value={form.label} onChange={(e) => set({ label: e.target.value })} placeholder="SOC triage peer" className={INPUT} />
        </label>
        <label className={cell}>
          <span className="text-[10.5px] text-ghost">Id (optional; the name a spec&rsquo;s peer config uses)</span>
          <input value={form.id} onChange={(e) => set({ id: e.target.value })} placeholder={slugOfLabel(form.label) || "from the name"} spellCheck={false} className={`${INPUT} font-mono text-[11.5px]`} />
        </label>
        <label className={cell}>
          <span className="text-[10.5px] text-ghost">Calls in as (optional; this factory&rsquo;s x-af-agent)</span>
          <input value={form.agent} onChange={(e) => set({ agent: e.target.value })} placeholder="the deployment's own id" spellCheck={false} className={`${INPUT} font-mono text-[11.5px]`} />
        </label>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[10.5px] text-ghost">A2A endpoint (its card is read at the endpoint&rsquo;s /.well-known/agent.json)</span>
          <input value={form.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://peer.example.com/a2a" spellCheck={false} className={`${INPUT} font-mono text-[11.5px]`} />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[10.5px] text-ghost">Shared secret, by its vault name</span>
          <input value={form.secret_name} onChange={(e) => set({ secret_name: e.target.value })} placeholder="soc-peer-a2a" spellCheck={false} className={`${INPUT} font-mono text-[11.5px]`} />
        </label>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[10.5px] text-ghost">Data class of what it returns (optional; a task it sends in starts here or higher)</span>
          <Pick aria-label="Data class of what the peer returns" value={form.data_class} onChange={(v) => set({ data_class: v })} options={dataClassChoices("undeclared")} />
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-[10.5px] text-ghost">Highest class it takes (optional; a spec&rsquo;s limit holds too, and the lower decides)</span>
          <Pick aria-label="Highest data class the peer takes" value={form.max_data_class} onChange={(v) => set({ max_data_class: v })} options={dataClassChoices("no limit here")} />
        </label>
      </div>
      <p className="text-[10.5px] leading-[1.5] text-faint">
        Store the secret in the vault first (Credentials, on this page) and give its name here, or <Mono className="text-[10px]">{"${secret:name}"}</Mono>; a value pasted where the name belongs is refused, and one name signs for one caller only.
      </p>
      {error && <Refusal error={error} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant="solid" tone="ink" permission="configure" disabled={Boolean(problem)} loading={busy}>
          {busy ? "Fetching its card…" : "Register and fetch its card"}
        </Button>
        <Button size="sm" variant="solid" tone="err" onClick={onCancel}>
          Cancel
        </Button>
        {problem && (form.label || form.url || form.secret_name) && <span className="text-[11px] text-faint">{problem}</span>}
      </div>
    </form>
  );
}

/* ═══════════════════ one peer ═══════════════════ */

export function PeerRow({ peer: p, twoPerson, me, onChanged }: { peer: Peer; twoPerson: boolean; me: Me | null; onChanged: () => void }) {
  const [busy, setBusy] = useState<"approve" | "rescan" | "delete" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const meta = PEER_STATUS_META[p.status];
  const access = approvePeerAccess(p, me, twoPerson);
  const skills = skillsOf(p.card);
  const change = cardChange(p);
  const title = cardTitle(p.card);
  const fetched = fetchLine(p);
  const approval = p.approvals.at(-1);
  const moved = new Set([...(change?.added ?? []), ...(change?.rewritten ?? [])]);

  const act = async (what: "approve" | "rescan" | "delete") => {
    setBusy(what);
    setError(null);
    setNotice(null);
    try {
      if (what === "approve") {
        await approvePeer(p.id);
        setNotice({ tone: "ok", text: "Card approved: runs may hand this peer tasks, and it may hand tasks in." });
      } else if (what === "rescan") {
        const r = await rescanPeer(p.id);
        setNotice(
          !r.changed
            ? { tone: "ok", text: r.peer.status === "pending" && !p.card ? "Rescanned: its card is read and pinned; it waits for an approval." : "Rescanned: the card still matches the pin." }
            : { tone: "err", text: "Agent card changed — re-approval needed. The peer is refused both ways until someone approves the new card." },
        );
      } else {
        await deletePeer(p.id);
        setConfirming(false);
      }
      onChanged();
    } catch (e) {
      // A failed fetch is recorded on the peer (502); the row reads it again.
      const recorded = peerOfRefusal(e);
      if (recorded) setNotice({ tone: "err", text: `The card could not be fetched: ${recorded.last_fetch?.error || (e as Error).message}` });
      else setError(e as Error);
      if (e instanceof DoorError && [404, 409, 502].includes(e.status)) onChanged();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div id={`peer-${p.id}`} className={`relative flex scroll-mt-16 flex-col gap-2.5 border-b border-line px-4 py-3 last:border-0 ${meta.alarming ? "bg-err-bg/40" : ""}`}>
      {meta.alarming && <span className="absolute inset-y-0 left-0 w-[3px] bg-err" aria-hidden />}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-[12.5px] font-semibold text-fg">{p.label}</span>
        <Mono className="text-[10.5px] text-faint">{p.id}</Mono>
        <PeerStatusTag status={p.status} />
        {!p.card && (
          <span title="No agent card is pinned: the last fetch failed. Rescan once the peer answers." className="inline-flex">
            <Tag tone="warn">No card</Tag>
          </span>
        )}
        {p.adopted && (
          <span title={`Read back from the runtime's ${p.adopted.from || "file"} ${ago(p.adopted.at)}, because the registry's own record was gone`} className="inline-flex">
            <Tag tone="warn">Adopted</Tag>
          </span>
        )}
        {title.version && <Mono className="text-[10.5px] text-faint">v{title.version}</Mono>}
        <span className="text-[10.5px] text-faint">{peerClassLine(p)}</span>
        <Link href="/policy" className="focusable rounded-sm text-[10.5px] text-dim hover:underline">
          Changed on the Policy page
        </Link>
        <span className="grow" />
        {confirming ? (
          <span className="inline-flex items-center gap-1.5">
            <Button size="sm" variant="solid" tone="err" permission="configure" loading={busy === "delete"} onClick={() => act("delete")}>
              Delete now
            </Button>
            <Button size="sm" variant="solid" tone="neutral" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </span>
        ) : (
          <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
            {p.status !== "approved" && (
              <Button size="sm" variant="solid" tone="ink" permission="configure" disabled={!access.ok || busy !== null} loading={busy === "approve"} onClick={() => act("approve")}>
                {p.status === "changed" ? "Approve new card" : "Approve"}
              </Button>
            )}
            <Button size="sm" variant="solid" tone="neutral" permission="configure" disabled={busy !== null} loading={busy === "rescan"} onClick={() => act("rescan")}>
              Rescan
            </Button>
            <Button size="sm" variant="solid" tone="err" permission="configure" disabled={busy !== null} onClick={() => setConfirming(true)}>
              Delete
            </Button>
          </span>
        )}
      </div>
      {p.status !== "approved" && !access.ok && access.reason && <span className="-mt-1 self-end text-[11px] text-warn">{access.reason}</span>}

      <Mono className="block truncate text-[10.5px] text-ghost">{p.url}</Mono>
      <span className="text-[11px] leading-[1.5] text-faint">{meta.means}.</span>
      {(title.name || title.description) && (
        <span className="text-[11px] leading-[1.5] text-dim">
          {title.name && <span className="font-medium text-fg">{title.name}</span>}
          {title.name && title.description ? " — " : ""}
          {title.description}
        </span>
      )}

      <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-5">
        <Fact k={p.status === "changed" ? "Card (new, waiting)" : "Card"}>
          {p.card ? (
            <>
              <DigestChip digest={p.card.digest} label="Card" />
              <span>
                {skills.length} skill{skills.length === 1 ? "" : "s"} · pinned {ago(p.card.at)}
              </span>
            </>
          ) : (
            <span className="text-ghost">none pinned</span>
          )}
        </Fact>
        <Fact k="Approved">
          {approval ? (
            <span className="inline-flex flex-wrap items-center gap-1.5" title={approval.by}>
              by {who(approval.by)} · {ago(approval.at)}
              {approval.digest && <DigestChip digest={approval.digest} label="Approved card" />}
            </span>
          ) : (
            <span className="text-ghost">not yet</span>
          )}
          <span className="text-ghost" title={p.added_by}>
            · registered by {who(p.added_by)}
            {p.added_at ? ` ${ago(p.added_at)}` : ""}
          </span>
        </Fact>
        <Fact k="Shared secret (vault name)">
          <Mono className="rounded-[3px] bg-raise px-1 py-px text-[10px] text-fg">{p.secret_name || "none"}</Mono>
        </Fact>
        <Fact k="This factory calls in as">
          <Mono className="text-[10.5px] text-fg">{p.agent || "the deployment's own id"}</Mono>
        </Fact>
        <Fact k="Last fetch">
          {p.last_fetch ? (
            <span title={p.last_fetch.by}>
              {ago(p.last_fetch.at)} by {who(p.last_fetch.by)} · <span className={p.last_fetch.ok ? "text-ok" : "font-medium text-err"}>{p.last_fetch.ok ? "read" : "failed"}</span>
            </span>
          ) : (
            <span className="text-ghost">{fetched.text}</span>
          )}
        </Fact>
      </div>

      {p.last_fetch && !p.last_fetch.ok && <p className="text-[11px] leading-[1.5] break-words text-err">The last fetch failed: {fetched.text}.</p>}

      {skills.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 text-[10px] text-ghost">{p.status === "changed" ? "Skills on the new card" : "Skills on the card"}</span>
          {skills.map((s) => (
            <span
              key={s.id || s.name}
              title={`${s.description || s.name}${s.tags.length ? `\nTags: ${s.tags.join(", ")}` : ""}`}
              className={`inline-flex items-center gap-1 rounded-[3px] border bg-surface px-1 py-px font-mono text-[10px] ${moved.has(s.id || s.name) ? "border-err text-err" : "border-line text-dim"}`}
            >
              {s.id || s.name}
              {s.name && s.name !== s.id && <span className="font-sans text-faint">· {s.name}</span>}
            </span>
          ))}
        </div>
      )}

      {p.status === "changed" && (
        <div className="flex flex-col gap-1.5">
          <p className="text-[11.5px] leading-[1.5] font-medium text-err">
            Agent card changed — re-approval needed. A rescan found a card other than the one approved and pinned it, waiting; the runtime will not send this peer a task, and the tasks door will not hear one from it, until someone approves the new card.
          </p>
          <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-dim">
            <span>Approved</span>
            <DigestChip digest={p.previous_card?.digest || approvedDigest(p)} label="Approved card" />
            <span>→ found</span>
            <DigestChip digest={p.card?.digest ?? ""} label="New card" />
            {change && cardChangeLine(change) && <span className="text-err">· {cardChangeLine(change)}</span>}
          </span>
        </div>
      )}

      {notice && <p className={`text-[11.5px] leading-[1.5] ${notice.tone === "ok" ? "text-ok" : "font-medium text-err"}`}>{notice.text}</p>}
      {error && <Refusal error={error} />}
    </div>
  );
}

/* ═══════════════════ the panel ═══════════════════ */

export function usePeers() {
  const [peers, setPeers] = useState<Peer[] | null>(null);
  const [twoPerson, setTwoPerson] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    try {
      const r = await listPeers();
      setPeers(r.peers);
      setTwoPerson(r.two_person);
      setError("");
    } catch (e) {
      setPeers((p) => p ?? []);
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => soon(refresh), [refresh]);
  return { peers, twoPerson, error, refresh };
}

/**
 * The body of Configuration's Peers panel (components/configuration.tsx):
 * the counts, the register form, then one row per peer. The page reads the
 * registry (`usePeers`) so the panel's heading can say a card changed, and
 * names the signed-in person (`meOf`) for the two-person rule. A row
 * is addressed as `#peer-<id>`: a kill receipt, a breaker and a finding link
 * a peer to its row.
 */
export function PeerList({ peers, twoPerson, me, error, refresh, bare = false }: { peers: Peer[] | null; twoPerson: boolean; me: Me | null; error: string; refresh: () => void; /** The console has nothing behind it (null: not known yet). */ bare?: boolean | null }) {
  const [adding, setAdding] = useState(false);
  const addDoor = useDoorOff("POST", "/api/peers");
  const [added, setAdded] = useState<Peer | null>(null);
  const counts = peerCounts(peers ?? []);
  const shown = orderPeers(peers ?? []);
  const none = shown.length === 0;
  const approvalRule = twoPerson ? "Two-person approval is on: whoever registers a peer cannot approve its card." : "One approval admits a peer; two-person approval is off on this deployment.";

  // Quiet (lib/quiet.ts): a registry that could not be read is not shown as an empty one with zero counts.
  // Not known yet whether anything is behind the console: no "no peer is registered" in the meantime.
  if (peers === null || (none && bare === null && !adding && !error)) return <p className="px-4 py-3 text-[11.5px] text-faint">Reading the registry&hellip;</p>;

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-2 last:border-b-0">
        {none && !error ? (
          <span className="min-w-0 max-w-[92ch] text-[12px] leading-[1.55] text-dim">
            No peer is registered. A spec&rsquo;s peer step reaches another party&rsquo;s agent only once that agent is registered here and its card approved; until then the runtime refuses it,
            whatever URL the spec carries. {approvalRule}
          </span>
        ) : (
          <>
            {/* With the registry unread (an error and nothing listed), no count is shown: a zero would be a claim. */}
            {!(none && error) && (
            <span className="flex flex-wrap items-center gap-3">
              <Status tone="ok">{counts.approved} approved</Status>
              <Status tone="warn">{counts.pending} pending</Status>
              <Status tone={counts.changed ? "err" : "neutral"}>{counts.changed} changed</Status>
              {counts.no_card > 0 && <Status tone="warn">{counts.no_card} without a card</Status>}
            </span>
            )}
            <span className="min-w-0 max-w-[70ch] text-[11px] leading-[1.5] text-faint">{approvalRule}</span>
          </>
        )}
        <span className="grow" />
        {!adding && (
          <Button size="sm" variant="solid" tone="ink" permission="configure" disabled={addDoor.off} title={addDoor.why} onClick={() => setAdding(true)}>
            Register a peer
          </Button>
        )}
      </div>

      {adding && (
        <RegisterPeerForm
          onCancel={() => setAdding(false)}
          onAdded={(p) => {
            setAdded(p);
            setAdding(false);
            refresh();
          }}
        />
      )}
      {added && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/40 px-4 py-2">
          <Status tone={added.card ? "warn" : "err"}>{added.label} registered</Status>
          {added.card ? (
            <>
              <span className="text-[11px] text-faint">card pinned</span>
              <DigestChip digest={added.card.digest} label="Card" />
              <span className="text-[11px] text-faint">and pending: nothing is sent to it until the card is approved{twoPerson ? " by someone other than you" : ""}.</span>
            </>
          ) : (
            <span className="text-[11px] text-faint">without a card: {fetchLine(added).text}.</span>
          )}
          <span className="grow" />
          <Button size="sm" variant="solid" tone="neutral" onClick={() => setAdded(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {error && <p className="border-b border-line px-4 py-2.5 text-[11.5px] text-err">{error}</p>}
      {shown.map((p) => (
        <PeerRow key={p.id} peer={p} twoPerson={twoPerson} me={me} onChanged={refresh} />
      ))}
    </>
  );
}
