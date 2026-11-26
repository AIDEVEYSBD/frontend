"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Mono, Status, Tag } from "./ui";
import { Checkbox, Field, Input } from "./forms";
import { Figures } from "./section";
import {
  Card,
  EventLine,
  FindingLine,
  KIND_META,
  KindGlyph,
  OwnerChip,
  RISK_TONE,
  ago,
  entryName,
  eventsFor,
  kindLabel,
  recordHref,
  riskLabel,
  statusOf,
  type AuthEvent,
  type Entry,
  type Finding,
  type Identity,
  type People,
  type Person,
} from "./identity-shared";

/**
 * One identity's page: a person, or something that is not one.
 *
 * It opens on what needs attention (the findings the register computed
 * about this identity), then what it may do (a person's roles and the
 * permissions they map to here; an agent's grants and the level it stops
 * for a person at), then what the register measured of its use, then its
 * entries in the audit trail. Every figure is what a door answered.
 */

export interface OwnerDraft {
  owner: string;
  purpose: string;
  review: string;
}

export interface IamActions {
  revokeKey: (i: Identity) => void;
  rotateKey: (i: Identity) => void;
  blockAgent: (i: Identity, blocked: boolean) => void;
  /** A service a trusted issuer admits: every token issued to it until now is refused (`DELETE /api/iam/identities?kind=attached_agent`). */
  disconnectService: (i: Identity) => void;
  gateAgent: (i: Identity) => void;
  disconnectServer: (i: Identity) => void;
  removeSecret: (i: Identity) => void;
  /** Resolves true when the owner was saved. */
  saveOwner: (i: Identity, draft: OwnerDraft) => Promise<boolean>;
  runFinding: (f: Finding) => void;
  /** Hold out by signing out everywhere; `revokeKeys` revokes their API keys that still work in the same act. */
  signOut: (p: Person, revokeKeys?: boolean) => void;
  /** Hold out (`disabled` true) or let back; `revokeKeys`, only with a hold, revokes their API keys that still work in the same act. */
  setAccess: (p: Person, disabled: boolean, revokeKeys?: boolean) => void;
}

const list = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).map(String) : []);

/** An attached agent with its own key (`facts.via` "key"), not a service a trusted issuer admits ("issuer"): both are the register's `attached_agent`. */
const keyedAgent = (i: Identity): boolean => i.kind === "attached_agent" && i.facts.via === "key";

/**
 * A person's team: the one an administrator set here, else the one the
 * deployment names for their address's domain (TEAM_DOMAINS), else none.
 * Records they create carry it, and the Costs page groups spend by it.
 * Setting it needs the iam permission (`PATCH /api/iam/users {sub, team}`).
 */
function TeamLine({ sub, team, from }: { sub: string; team: string | null; from: string | null }) {
  const [shown, setShown] = useState<{ team: string | null; from: string | null }>({ team, from });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(team && from === "set" ? team : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/iam/users", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ sub, team: draft.trim() }) });
      const d = (await r.json().catch(() => ({}))) as { user?: { team?: string | null; team_from?: string | null }; error?: string };
      if (!r.ok || !d.user) throw new Error(d.error || `the platform answered ${r.status}`);
      setShown({ team: d.user.team ?? null, from: d.user.team_from ?? null });
      setEditing(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (editing)
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <Input value={draft} onChange={setDraft} placeholder="Team name, or empty to clear" aria-label="Team" />
        <Button size="sm" variant="solid" tone="ink" permission="iam" loading={busy} onClick={save}>
          Save team
        </Button>
        <Button size="sm" variant="solid" tone="err" disabled={busy} onClick={() => setEditing(false)}>
          Cancel
        </Button>
        {error && <span className="text-[11px] text-err">Not saved: {error}</span>}
      </span>
    );
  return (
    <span className="flex items-center gap-1.5">
      <span>
        Team: {shown.team ? <>{shown.team}<span className="text-faint">{shown.from === "domain" ? " (from the address's domain)" : " (set by an administrator)"}</span></> : <span className="text-faint">none</span>}
      </span>
      <Button size="sm" variant="solid" tone="neutral" permission="iam" onClick={() => setEditing(true)}>
        Set team
      </Button>
    </span>
  );
}

function Fact({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-line py-2 text-[12px] last:border-0">
      <span className="w-[140px] shrink-0 text-faint">{k}</span>
      <span className="min-w-0 grow break-words text-fg">{children}</span>
    </div>
  );
}

export function IdentityPage({
  entry,
  findings,
  events,
  eventsError,
  people,
  now,
  meSub,
  busy,
  ownerStoreDown,
  editOwner,
  actions,
  unread = false,
  keysOfPerson = null,
}: {
  entry: Entry;
  findings: Finding[];
  /** The audit trail as the users door returned it; null while it has not answered. */
  events: AuthEvent[] | null;
  eventsError: string;
  people: People | null;
  now: number;
  meSub: string;
  /** The action in flight, as `verb:id`. */
  busy: string;
  ownerStoreDown: boolean;
  /** Open the owner form at once (the roster's and a finding's "Assign owner"). */
  editOwner: boolean;
  actions: IamActions;
  /** A door unread: "nothing needs attention" is not known, so the card is left out. */
  unread?: boolean;
  /** For a person: the unrevoked API keys the register says answer to them; null when the register was not read. */
  keysOfPerson?: Identity[] | null;
}) {
  const [confirming, setConfirming] = useState("");
  /** The hold also revokes the person's API keys that still work, in the same act (`revoke_keys`). */
  const [revokeWithHold, setRevokeWithHold] = useState(false);
  const st = statusOf(entry);
  const mine = events ? eventsFor(entry, events) : [];
  const i = entry.type === "identity" ? entry.identity : null;
  const p = entry.type === "person" ? entry.person : null;
  const self = Boolean(p && p.sub === meSub);
  const who = p ? p.name || p.email || p.sub : "";
  const theirKeys = keysOfPerson ?? [];

  /* ── what needs attention ── */
  const personIssues: { tone: "err" | "warn"; title: string; detail: string }[] = [];
  if (p?.disabled_at)
    personIssues.push({
      tone: "err",
      title: "Held out of the console",
      detail: `Held out ${ago(p.disabled_at, now)}${p.disabled_by ? ` by ${p.disabled_by}` : ""}${
        theirKeys.length ? `; ${theirKeys.length === 1 ? "one API key still works" : `${theirKeys.length} API keys still work`}: ${theirKeys.map((k) => k.name).join(", ")}` : ""
      }.`,
    });
  if (p && !p.disabled_at && p.last_app_roles.length === 0)
    personIssues.push({
      tone: "warn",
      title: "No role in this app",
      // Behind Google IAP a person's roles come from this deployment's role map, never from the sign-in.
      detail: "Give them a role in this deployment's role map.",
    });
  const unowned = Boolean(i && !i.owner && i.status !== "revoked");
  const attention = findings.length + personIssues.length + (unowned ? 1 : 0);

  const confirmPair = (go: string, onGo: () => void, loading: boolean) => (
    <>
      <Button size="sm" variant="solid" tone="err" permission="iam" loading={loading} onClick={onGo}>
        {go}
      </Button>
      <Button
        size="sm"
        variant="solid"
        tone="neutral"
        onClick={() => {
          setConfirming("");
          setRevokeWithHold(false);
        }}
      >
        Keep
      </Button>
    </>
  );

  const href = i ? recordHref(i) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <KindGlyph entry={entry} size="size-11 text-[15px]" />
        <div className="flex min-w-0 grow basis-[320px] flex-col gap-1.5">
          <span className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 text-[22px] leading-[1.2] font-semibold tracking-[-0.02em] break-words">{entryName(entry)}</h1>
            <Tag>{kindLabel(entry)}</Tag>
            <Status tone={st.tone}>{st.label}</Status>
            {self && <Tag>you</Tag>}
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-dim">
            {p ? (
              <>
                {p.email && <span>{p.email}</span>}
                <Mono className="text-[11px]">{p.sub}</Mono>
                <TeamLine sub={p.sub} team={(p as { team?: string | null }).team ?? null} from={(p as { team_from?: string | null }).team_from ?? null} />
              </>
            ) : (
              <>
                <Mono className="text-[11px]">{i!.id}</Mono>
                {href && (
                  <Link href={href} className="focusable rounded-sm text-fg underline decoration-line-strong underline-offset-2 hover:decoration-fg">
                    Open {i!.kind === "workflow" ? "agent" : i!.kind === "vault_credential" ? "settings" : KIND_META[i!.kind].label.toLowerCase()}
                  </Link>
                )}
              </>
            )}
          </span>
          {i?.description && i.kind !== "vault_credential" && <p className="line-clamp-3 max-w-[100ch] text-[12.5px] leading-[1.55] text-dim">{i.description}</p>}
        </div>
        <span className="flex flex-wrap items-center gap-1.5">
          {p &&
            (self ? (
              <span className="text-[11.5px] text-faint">Nobody changes their own access; another administrator does it.</span>
            ) : p.disabled_at ? (
              <Button size="sm" variant="solid" tone="ok" permission="iam" loading={busy === `user:${p.sub}`} onClick={() => actions.setAccess(p, false)}>
                Let back in
              </Button>
            ) : confirming === "disable" || confirming === "signout" ? (
              <span className="flex max-w-[460px] flex-col items-end gap-1.5">
                <span className="text-right text-[11.5px] leading-[1.5] text-dim">
                  {confirming === "signout" ? `Holds ${who} out: every request refused until let back.` : `Every request ${who} makes is refused until let back.`}
                </span>
                <span className="flex flex-col items-end gap-0.5">
                  <Checkbox
                    label={
                      keysOfPerson === null
                        ? "Also revoke their API keys"
                        : theirKeys.length
                          ? `Also revoke their ${theirKeys.length === 1 ? "API key" : `${theirKeys.length} API keys`}: ${theirKeys.map((k) => k.name).join(", ")}`
                          : "Also revoke their API keys (the register lists none that still work)"
                    }
                    checked={revokeWithHold}
                    onChange={setRevokeWithHold}
                  />
                </span>
                <span className="flex gap-1.5">
                  {confirmPair(
                    confirming === "signout" ? (revokeWithHold ? "Sign out everywhere and revoke keys" : "Sign out everywhere") : revokeWithHold ? "Hold out and revoke keys" : "Hold out",
                    () => {
                      const how = confirming;
                      const revoke = revokeWithHold;
                      setConfirming("");
                      setRevokeWithHold(false);
                      if (how === "signout") actions.signOut(p, revoke);
                      else actions.setAccess(p, true, revoke);
                    },
                    busy === `user:${p.sub}` || busy === `signout:${p.sub}`,
                  )}
                </span>
              </span>
            ) : (
              <>
                {p.sessions > 0 && (
                  <Button size="sm" variant="solid" tone="neutral" permission="iam" loading={busy === `signout:${p.sub}`} onClick={() => setConfirming("signout")}>
                    Sign out everywhere
                  </Button>
                )}
                <Button size="sm" variant="solid" tone="err" permission="iam" loading={busy === `user:${p.sub}`} onClick={() => setConfirming("disable")}>
                  Hold out
                </Button>
              </>
            ))}
          {/* An attached agent's own key: blocked here, detached on Configuration, Third-party agents (the link above). */}
          {i && keyedAgent(i) && i.status !== "revoked" && (
            <Button size="sm" variant="solid" tone={i.status === "blocked" ? "ok" : "warn"} permission="configure" loading={busy === `block:${i.id}`} onClick={() => actions.blockAgent(i, i.status !== "blocked")}>
              {i.status === "blocked" ? "Unblock" : "Block"}
            </Button>
          )}
          {i?.kind === "attached_agent" &&
            !keyedAgent(i) &&
            (confirming === "disconnect-service" ? (
              <span className="flex max-w-[460px] flex-col items-end gap-1.5">
                <span className="text-right text-[11.5px] leading-[1.5] text-dim">Every token issued to {i.name} until now is refused.</span>
                <span className="flex gap-1.5">{confirmPair("Disconnect now", () => { setConfirming(""); actions.disconnectService(i); }, busy === `service:${i.id}`)}</span>
              </span>
            ) : (
              <Button size="sm" variant="solid" tone="err" permission="iam" loading={busy === `service:${i.id}`} onClick={() => setConfirming("disconnect-service")}>
                Disconnect
              </Button>
            ))}
          {i?.kind === "api_key" &&
            i.status === "active" &&
            (confirming === "revoke" ? (
              confirmPair("Revoke now", () => { setConfirming(""); actions.revokeKey(i); }, busy === `revoke:${i.id}`)
            ) : (
              <>
                <Button size="sm" variant="solid" tone="ink" permission="iam" loading={busy === `rotate:${i.id}`} onClick={() => actions.rotateKey(i)}>
                  Rotate
                </Button>
                <Button size="sm" variant="solid" tone="err" permission="iam" loading={busy === `revoke:${i.id}`} onClick={() => setConfirming("revoke")}>
                  Revoke
                </Button>
              </>
            ))}
          {i?.kind === "mcp_server" &&
            (confirming === "disconnect" ? (
              confirmPair("Disconnect now", () => { setConfirming(""); actions.disconnectServer(i); }, busy === `disconnect:${i.id}`)
            ) : (
              <Button size="sm" variant="solid" tone="err" permission="iam" loading={busy === `disconnect:${i.id}`} onClick={() => setConfirming("disconnect")}>
                Disconnect
              </Button>
            ))}
          {i?.kind === "vault_credential" &&
            (confirming === "remove" ? (
              confirmPair("Remove now", () => { setConfirming(""); actions.removeSecret(i); }, busy === `secret:${i.id}`)
            ) : (
              <Button size="sm" variant="solid" tone="err" permission="iam" loading={busy === `secret:${i.id}`} onClick={() => setConfirming("remove")}>
                Remove
              </Button>
            ))}
        </span>
      </div>

      {/* ── needs attention ── */}
      {!(unread && attention === 0) && <Card id="attention" title="Needs attention" meta={attention ? `${attention}` : "nothing"}>
        {attention === 0 && <p className="px-4 py-3 text-[12px] text-dim">Nothing needs attention.</p>}
        {personIssues.map((x) => (
          <div key={x.title} className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-2.5 last:border-0">
            <span className="w-[62px] shrink-0 pt-0.5">
              <Status tone={x.tone}>{x.tone === "err" ? "fix" : "review"}</Status>
            </span>
            <span className="flex min-w-0 grow basis-[260px] flex-col gap-0.5">
              <span className="text-[12.5px] text-fg">{x.title}</span>
              <span className="max-w-[90ch] text-[11.5px] leading-[1.5] text-dim">{x.detail}</span>
            </span>
          </div>
        ))}
        {findings.map((f) => (
          <FindingLine key={f.id} finding={f} busy={busy.endsWith(`:${f.identity.id}`)} onRun={actions.runFinding} />
        ))}
        {unowned && i && (
          <div className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-2.5 last:border-0">
            <span className="w-[62px] shrink-0 pt-0.5">
              <Status tone="warn">review</Status>
            </span>
            <span className="flex min-w-0 grow basis-[260px] flex-col gap-0.5">
              <span className="text-[12.5px] text-fg">No owner</span>
              <span className="max-w-[90ch] text-[11.5px] leading-[1.5] text-dim">Name a person and a purpose under Access.</span>
            </span>
          </div>
        )}
      </Card>}

      {/* ── access ── */}
      {p && (
        <Card id="access" title="Access" meta="roles and the permissions they map to">
          <div className="grid gap-px bg-line lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <div className="flex flex-col bg-surface px-4 py-1.5">
              <Fact k="Roles in this app">
                <span className="flex flex-wrap gap-1">{p.last_app_roles.length ? p.last_app_roles.map((r) => <Tag key={r}>{r}</Tag>) : <Tag tone="warn">none</Tag>}</span>
              </Fact>
              <Fact k="Directory roles">{p.last_roles.length ? p.last_roles.join(", ") : <span className="text-faint">none carried by the sign-in</span>}</Fact>
              <Fact k="Email verified">{p.email_verified === null ? <span className="text-faint">not stated by the sign-in</span> : p.email_verified ? "yes" : "no"}</Fact>
              {p.preferred_username && <Fact k="Username">{p.preferred_username}</Fact>}
              <Fact k="Connected now">
                <span className="tnum">{p.sessions > 0 ? "yes, seen in the last 30 minutes" : "no"}</span>
              </Fact>
              {p.first_seen && <Fact k="First seen">{ago(p.first_seen, now)}</Fact>}
              {p.last_seen && <Fact k="Last seen">{ago(p.last_seen, now)}</Fact>}
              <Fact k="Access">
                {p.disabled_at ? (
                  <span className="flex flex-col gap-0.5">
                    <Status tone="err">held out {ago(p.disabled_at, now)}</Status>
                    {p.disabled_by && <span className="text-[11px] text-faint">by {p.disabled_by}</span>}
                  </span>
                ) : (
                  <Status tone="ok">let in</Status>
                )}
              </Fact>
            </div>
            <div className="flex flex-col bg-surface">
              <span className="border-b border-line px-4 py-2 text-[11px] text-faint">What this person may do here, and the role that grants it</span>
              {(people?.permissions ?? []).map((perm) => {
                const may = p.permissions.includes(perm.permission);
                const by = (people?.roles ?? []).filter((r) => r.permissions.includes(perm.permission) && p.last_app_roles.includes(r.role)).map((r) => r.role);
                return (
                  <div key={perm.permission} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-4 py-2 last:border-0">
                    <Mono className="w-[84px] shrink-0 text-[11.5px] text-fg">{perm.permission}</Mono>
                    <span className="w-[72px] shrink-0">
                      <Status tone={may ? "ok" : "neutral"}>{may ? "may" : "may not"}</Status>
                    </span>
                    <span className="min-w-0 grow basis-[200px] text-[11.5px] leading-[1.5] text-dim">{perm.means}</span>
                    <span className="shrink-0 text-[11px] text-faint">{may ? (by.length ? `from ${by.join(", ")}` : "") : ""}</span>
                  </div>
                );
              })}
              {people && people.permissions.length === 0 && <span className="px-4 py-3 text-[12px] text-faint">The door listed no permissions.</span>}
              {!people && (
                <span className="px-4 py-3 text-[12px] text-faint">
                  {p.permissions.length ? `May: ${p.permissions.join(", ")}.` : "No permission maps to this person."}
                </span>
              )}
            </div>
          </div>
        </Card>
      )}
      {i && <IdentityAccess key={`${i.kind}:${i.id}`} identity={i} now={now} busy={busy} ownerStoreDown={ownerStoreDown} editOwner={editOwner} actions={actions} />}

      {/* ── usage: only what the register measured ── */}
      {i && <Usage identity={i} now={now} />}

      {/* ── activity ── */}
      <Card id="activity" title="Activity" meta={events && events.length ? `${mine.length} of the last ${events.length} audit events name this identity` : undefined}>
        {eventsError && (<p className="px-4 py-3 text-[12px] text-err">The audit trail could not be read: {eventsError}.</p>)}
        {!events && !eventsError && <p className="px-4 py-3 text-[12px] text-faint">Reading the audit trail…</p>}
        {events && mine.length === 0 && (
          <p className="px-4 py-3 text-[12px] text-dim">
            {events.length === 0 ? "The audit trail holds no events yet." : "None of the audit trail's latest events names this identity."}
          </p>
        )}
        {mine.map((e) => (
          <EventLine key={e.id} event={e} now={now} />
        ))}
      </Card>
    </div>
  );
}

/** A non-human identity's access: what it may reach and how, and who answers for it. */
function IdentityAccess({ identity: i, now, busy, ownerStoreDown, editOwner, actions }: { identity: Identity; now: number; busy: string; ownerStoreDown: boolean; editOwner: boolean; actions: IamActions }) {
  const [editing, setEditing] = useState(editOwner && i.status !== "revoked");
  const [draft, setDraft] = useState<OwnerDraft>({ owner: i.owner?.owner ?? "", purpose: i.owner?.purpose ?? "", review: i.owner?.review_due_at?.slice(0, 10) ?? "" });
  const f = i.facts;
  const facts: { k: string; v: React.ReactNode }[] = [];
  const text = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
  const when = (v: unknown, none: string) => (typeof v === "string" && v ? `${ago(v, now)} (${new Date(v).toLocaleString("en-GB")})` : none);
  const chips = (v: unknown) =>
    list(v).length ? (
      <span className="flex flex-wrap gap-1">
        {list(v).map((g) => (
          <Mono key={g} className="rounded-sm border border-line bg-raise px-1 py-px text-[11px]">
            {g}
          </Mono>
        ))}
      </span>
    ) : (
      "none"
    );
  // Only what the register answered for each kind; a kind's fact the register does not carry is left out, never filled in.
  if (i.kind === "workflow")
    facts.push(
      { k: "Latest version", v: text(f.latest_version) || "none saved" },
      { k: "Deployed version", v: text(f.deployed_version) || "not deployed" },
      { k: "Deployed", v: when(f.deployed_at, "never") },
      { k: "Retired", v: f.retired ? "yes" : "no" },
    );
  if (keyedAgent(i)) {
    const person = (v: unknown): string => {
      const p = (v && typeof v === "object" ? v : {}) as { sub?: unknown; email?: unknown; name?: unknown };
      return text(p.email) || text(p.name) || text(p.sub);
    };
    const block = (f.blocked && typeof f.blocked === "object" ? f.blocked : null) as { reason?: unknown; by?: unknown; at?: unknown } | null;
    facts.push(
      { k: "Key", v: <Mono className="text-[11px]">{text(f.key_prefix)}…</Mono> },
      { k: "Attached over", v: `${f.mode === "a2a" ? "A2A" : "the SDK"}${text(f.framework) ? ` · ${text(f.framework)}` : ""}${text(f.language) ? ` · ${text(f.language)}` : ""}` },
      { k: "Owning team", v: text(f.team) || "none given when it was attached" },
      { k: "Attached by", v: `${person(f.attached_by) || "not recorded"}, ${when(i.created_at, "at a time not recorded")}` },
      { k: "Approved by", v: f.approved_by ? `${person(f.approved_by)}, ${when(f.approved_at, "at a time not recorded")}` : "nobody yet: the key works once a second person approves" },
      ...(block ? [{ k: "Blocked", v: <span className="text-err">by {text(block.by) || "not recorded"}, {when(block.at, "at a time not recorded")}: {text(block.reason) || "no reason given"}</span> }] : []),
      ...(f.detached_at ? [{ k: "Detached", v: `${when(f.detached_at, "")} by ${text(f.detached_by) || "not recorded"}; key revoked` }] : []),
      { k: "Granted tools", v: chips(f.grants) },
      { k: "Stops for a person at", v: list(f.gates).join(", ") || "never: no gate in its policy" },
      { k: "Data class", v: text(f.data_class) || "not recorded" },
      ...(f.owner_held_out ? [{ k: "Its owner", v: <span className="text-err">is held out; this agent&rsquo;s key still works</span> }] : []),
    );
  } else if (i.kind === "attached_agent")
    facts.push(
      { k: "Issuer", v: <Mono className="text-[11px] break-all">{text(f.issuer)}</Mono> },
      { k: "Subject", v: <Mono className="text-[11px] break-all">{text(f.subject)}</Mono> },
      {
        k: "Trusted through",
        v: (
          <Link href="/authorization" className="focusable rounded-sm text-fg underline decoration-line-strong underline-offset-2 hover:decoration-fg">
            {text(f.server)}
          </Link>
        ),
      },
      { k: "First signed in", v: when(f.first_seen, "not yet") },
      { k: "Tokens refused", v: typeof f.refuse_issued_before === "string" && f.refuse_issued_before ? `every token issued before ${new Date(f.refuse_issued_before).toLocaleString("en-GB")}` : "none: it has not been disconnected" },
    );
  if (i.kind === "mcp_server")
    facts.push(
      { k: "Tools", v: list(f.tools).length ? <span className="flex flex-wrap gap-1">{list(f.tools).map((g) => <Mono key={g} className="rounded-sm border border-line bg-raise px-1 py-px text-[11px]">{g}</Mono>)}</span> : "none" },
      { k: "Held by workflows", v: list(f.workflows).join(", ") || "none" },
      { k: "Granted to agents", v: list(f.attached).join(", ") || "none" },
    );
  if (i.kind === "api_key") {
    const minted = (f.minted_by && typeof f.minted_by === "object" ? f.minted_by : {}) as { sub?: unknown; email?: unknown; name?: unknown };
    facts.push(
      { k: "Prefix", v: <Mono className="text-[11px]">{text(f.prefix)}…</Mono> },
      { k: "Bound to an agent", v: text(f.agent) ? `acts only as ${text(f.agent)}` : "no: it acts as any agent its permissions allow" },
      { k: "Permissions", v: chips(f.permissions) },
      { k: "Minted by", v: text(minted.email) || text(minted.name) || text(minted.sub) || "not recorded" },
      { k: "Minted", v: when(i.created_at, "not recorded") },
      // When it stops working: its own expiry, or its minting plus the longest lifetime the deployment allows now, whichever is first.
      { k: i.status === "expired" ? "Expired" : "Expires", v: typeof f.expires_at === "string" && f.expires_at ? new Date(f.expires_at).toLocaleString("en-GB") : "not said by the register" },
      ...(f.revoked_at ? [{ k: "Revoked", v: when(f.revoked_at, "") }] : []),
      ...(f.owner_held_out ? [{ k: "Its owner", v: <span className="text-err">is held out; this key still works</span> }] : []),
    );
  }
  if (i.kind === "vault_credential") facts.push({ k: "Referenced by", v: list(f.referenced_by).join(", ") || "no spec" }, { k: "Declared users", v: list(f.declared_users).join(", ") || "none" }, { k: "Value set", v: f.set ? "yes" : "no" });

  const save = async () => {
    if (await actions.saveOwner(i, draft)) setEditing(false);
  };

  return (
    <Card id="access" title="Access" meta={i.kind === "workflow" || i.kind === "attached_agent" ? "what it may call, and who answers for it" : "what it gives access to, and who answers for it"}>
      <div className="grid gap-px bg-line lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="flex flex-col bg-surface px-4 py-1.5">
          <Fact k="May reach">
            <span className="flex flex-wrap items-baseline gap-2">
              {i.risk ? <Tag tone={RISK_TONE[i.risk] ?? "neutral"}>{riskLabel(i.risk)}</Tag> : i.kind === "workflow" ? <Tag tone="warn">risk not known</Tag> : null}
              <span>{i.privileges}</span>
            </span>
          </Fact>
          <Fact k="Authenticates with">{i.credential}</Fact>
          {facts.map((x) => (
            <Fact key={x.k} k={x.k}>
              {x.v}
            </Fact>
          ))}
        </div>
        <form
          id="owner"
          className="flex flex-col gap-2.5 bg-surface px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <span className="text-[11px] font-medium text-faint">Owner and purpose</span>
          {editing ? (
            <>
              <Field label="Person">
                <Input value={draft.owner} onChange={(v) => setDraft((d) => ({ ...d, owner: v }))} placeholder="Name or email" />
              </Field>
              <Field label="Purpose">
                <Input value={draft.purpose} onChange={(v) => setDraft((d) => ({ ...d, purpose: v }))} placeholder="Why this identity exists" />
              </Field>
              <Field label="Review due" hint="YYYY-MM-DD; empty for none.">
                <Input value={draft.review} onChange={(v) => setDraft((d) => ({ ...d, review: v }))} placeholder="YYYY-MM-DD" mono />
              </Field>
              <span className="flex gap-2">
                <Button type="submit" size="sm" variant="solid" tone="ink" permission="iam" loading={busy === `owner:${i.id}`}>
                  Save
                </Button>
                <Button size="sm" variant="solid" tone="err" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </span>
            </>
          ) : (
            <>
              {i.owner ? <OwnerChip owner={i.owner} /> : <span className="text-[12px] text-warn">No owner.</span>}
              {i.owner && (f.owner_from === "minted" || f.owner_from === "saved") && (
                <span className="text-[11.5px] leading-[1.5] text-faint">Owner by default: the person who {f.owner_from === "minted" ? "minted it" : "first saved it"}.</span>
              )}
              {i.owner?.review_due_at && (
                <span className="text-[11.5px] text-dim">
                  Review due {i.owner.review_due_at.slice(0, 10)} · set by {i.owner.updated_by} {ago(i.owner.updated_at, now)}
                </span>
              )}
              {i.status !== "revoked" && (
                <Button size="sm" variant="solid" tone={i.owner ? "neutral" : "warn"} permission="iam" className="w-fit" onClick={() => setEditing(true)} disabled={ownerStoreDown}>
                  {i.owner ? "Change owner" : "Assign owner"}
                </Button>
              )}
              {ownerStoreDown && (<span className="text-[11.5px] leading-[1.5] text-faint">Owners cannot be saved: their table is not reachable.</span>)}
            </>
          )}
        </form>
      </div>
    </Card>
  );
}

/** What the identity register measured of this identity's use; nothing when it measured nothing for this kind. */
function Usage({ identity: i, now }: { identity: Identity; now: number }) {
  const items: { k: string; v: React.ReactNode }[] = [];
  if (typeof i.runs30d === "number") items.push({ k: "Runs · 30 days", v: i.runs30d.toLocaleString("en-GB") });
  if (typeof i.facts.calls30d === "number") items.push({ k: "Tool calls · 30 days", v: i.facts.calls30d.toLocaleString("en-GB") });
  if (typeof i.facts.denials30d === "number") items.push({ k: "Denials · 30 days", v: i.facts.denials30d.toLocaleString("en-GB") });
  const useKept = i.facts.last_use_recorded !== false;
  if (items.length === 0 && !i.last_used && useKept) return null;
  items.push({ k: "Last used", v: i.last_used ? ago(i.last_used, now) : useKept ? "none on record" : "not recorded with this secret store" });
  return (
    <Card id="usage" title="Usage">
      <div className="p-4">
        <Figures items={items} />
      </div>
    </Card>
  );
}
