"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Mono, Status, Tag } from "./ui";
import { Field, Input } from "./forms";
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
  gateAgent: (i: Identity) => void;
  disconnectServer: (i: Identity) => void;
  removeSecret: (i: Identity) => void;
  /** Resolves true when the owner was saved. */
  saveOwner: (i: Identity, draft: OwnerDraft) => Promise<boolean>;
  runFinding: (f: Finding) => void;
  signOut: (p: Person) => void;
  setAccess: (p: Person, disabled: boolean) => void;
}

const list = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).map(String) : []);

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
  /** A quiet console (lib/quiet.ts) with a door unread: "nothing needs attention" is not known, so the card is left out. */
  unread?: boolean;
}) {
  const [confirming, setConfirming] = useState("");
  const st = statusOf(entry);
  const mine = events ? eventsFor(entry, events) : [];
  const i = entry.type === "identity" ? entry.identity : null;
  const p = entry.type === "person" ? entry.person : null;
  const local = Boolean(p && p.sub.startsWith("local:"));
  const self = Boolean(p && p.sub === meSub);

  /* ── what needs attention ── */
  const personIssues: { tone: "err" | "warn"; title: string; detail: string }[] = [];
  if (p?.disabled_at) personIssues.push({ tone: "err", title: "Access is disabled", detail: `Disabled ${ago(p.disabled_at, now)}. This person cannot sign in until an administrator enables them again.` });
  if (p && !p.disabled_at && p.last_app_roles.length === 0)
    personIssues.push({
      tone: "warn",
      title: "No role in this app",
      detail: people?.sso.demo_default_role
        ? `Their latest token carried no role this app recognises; this deployment treats them as ${people.sso.demo_default_role}.`
        : "Their latest token carried no role this app recognises, so no permission maps to them. Roles are assigned in the identity provider.",
    });
  const unowned = Boolean(i && !i.owner && i.status !== "revoked");
  const attention = findings.length + personIssues.length + (unowned ? 1 : 0);

  const confirmPair = (go: string, onGo: () => void, loading: boolean) => (
    <>
      <Button size="sm" variant="solid" tone="err" permission="iam" loading={loading} onClick={onGo}>
        {go}
      </Button>
      <Button size="sm" variant="solid" tone="neutral" onClick={() => setConfirming("")}>
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
            {p?.org_type && <Tag>{p.org_type}</Tag>}
            {self && <Tag>you</Tag>}
            {i && Boolean(i.facts.demo) && <Tag>sample</Tag>}
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-dim">
            {p ? (
              <>
                {p.email && <span>{p.email}</span>}
                <Mono className="text-[11px]">{p.sub}</Mono>
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
            (local ? (
              <span className="text-[11.5px] text-faint">The console&rsquo;s own operator; sign-in is off on this deployment.</span>
            ) : self ? (
              <span className="text-[11.5px] text-faint">Nobody changes their own access; another administrator does it.</span>
            ) : (
              <>
                {p.sessions > 0 && (
                  <Button size="sm" variant="solid" tone="neutral" permission="iam" loading={busy === `signout:${p.sub}`} onClick={() => actions.signOut(p)}>
                    Sign out everywhere
                  </Button>
                )}
                {p.disabled_at ? (
                  <Button size="sm" variant="solid" tone="ok" permission="iam" loading={busy === `user:${p.sub}`} onClick={() => actions.setAccess(p, false)}>
                    Enable
                  </Button>
                ) : confirming === "disable" ? (
                  confirmPair("Disable now", () => { setConfirming(""); actions.setAccess(p, true); }, busy === `user:${p.sub}`)
                ) : (
                  <Button size="sm" variant="solid" tone="err" permission="iam" loading={busy === `user:${p.sub}`} onClick={() => setConfirming("disable")}>
                    Disable
                  </Button>
                )}
              </>
            ))}
          {i?.kind === "attached_agent" && (
            <Button size="sm" variant="solid" tone={i.status === "blocked" ? "ok" : "err"} permission="iam" loading={busy === `block:${i.id}`} onClick={() => actions.blockAgent(i, i.status !== "blocked")}>
              {i.status === "blocked" ? "Unblock" : "Block"}
            </Button>
          )}
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
        {attention === 0 && <p className="px-4 py-3 text-[12px] text-dim">Nothing about this identity needs attention on this read.</p>}
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
              <span className="max-w-[90ch] text-[11.5px] leading-[1.5] text-dim">Nobody is named as answering for this identity. Name a person and why it exists, under Access.</span>
            </span>
          </div>
        )}
      </Card>}

      {/* ── access ── */}
      {p && (
        <Card id="access" title="Access" meta="roles from the identity provider, and the permissions they map to here">
          <div className="grid gap-px bg-line lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <div className="flex flex-col bg-surface px-4 py-1.5">
              <Fact k="Roles in this app">
                <span className="flex flex-wrap gap-1">{p.last_app_roles.length ? p.last_app_roles.map((r) => <Tag key={r}>{r}</Tag>) : <Tag tone="warn">none</Tag>}</span>
              </Fact>
              <Fact k="Directory roles">{p.last_roles.length ? p.last_roles.join(", ") : <span className="text-faint">none</span>}</Fact>
              <Fact k="Organisation">{p.org_type ? <Tag>{p.org_type}</Tag> : <span className="text-faint">not given by the identity provider</span>}</Fact>
              <Fact k="Sessions open">
                <span className="tnum">{p.sessions}</span>
              </Fact>
              {p.first_seen && <Fact k="First seen">{ago(p.first_seen, now)}</Fact>}
              {p.last_seen && <Fact k="Last seen">{ago(p.last_seen, now)}</Fact>}
              <Fact k="Access">{p.disabled_at ? <Status tone="err">disabled {ago(p.disabled_at, now)}</Status> : <Status tone="ok">enabled</Status>}</Fact>
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
  if (i.kind === "workflow")
    facts.push(
      { k: "Tools granted", v: String(f.tools ?? 0) },
      { k: "Gate level", v: f.gate ? `stops for a person at ${String(f.gate)} and above` : "no gate" },
      { k: "Trigger", v: String(f.trigger ?? "prompt") },
      { k: "Secrets referenced", v: list(f.secrets).join(", ") || "none" },
    );
  if (i.kind === "attached_agent")
    facts.push(
      { k: "Grants", v: list(f.grants).length ? <span className="flex flex-wrap gap-1">{list(f.grants).map((g) => <Mono key={g} className="rounded-sm border border-line bg-raise px-1 py-px text-[11px]">{g}</Mono>)}</span> : "none" },
      { k: "Gate level", v: f.gate_at ? `stops for a person at ${String(f.gate_at)} and above` : "no gate" },
      { k: "Mode", v: String(f.mode ?? "") },
      { k: "Injection screening", v: String(f.injection ?? "") },
      { k: "Blocked", v: f.blocked ? "yes" : "no" },
    );
  if (i.kind === "mcp_server")
    facts.push(
      { k: "Tools", v: list(f.tools).length ? <span className="flex flex-wrap gap-1">{list(f.tools).map((g) => <Mono key={g} className="rounded-sm border border-line bg-raise px-1 py-px text-[11px]">{g}</Mono>)}</span> : "none" },
      { k: "Held by workflows", v: list(f.workflows).join(", ") || "none" },
      { k: "Granted to agents", v: list(f.attached).join(", ") || "none" },
    );
  if (i.kind === "api_key")
    facts.push({ k: "Scope", v: String(f.agent ?? "any workflow") }, { k: "Prefix", v: <Mono className="text-[11px]">{String(f.prefix ?? "")}</Mono> }, { k: "Created", v: i.created_at ? ago(i.created_at, now) : "not recorded" });
  if (i.kind === "vault_credential") facts.push({ k: "Referenced by", v: list(f.referenced_by).join(", ") || "no spec" }, { k: "Declared users", v: list(f.declared_users).join(", ") || "none" }, { k: "Value set", v: f.set ? "yes" : "no" });

  const save = async () => {
    if (await actions.saveOwner(i, draft)) setEditing(false);
  };

  return (
    <Card id="access" title="Access" meta={i.kind === "workflow" || i.kind === "attached_agent" ? "what it may call, where it stops for a person, and who answers for it" : "what it gives access to, and who answers for it"}>
      <div className="grid gap-px bg-line lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="flex flex-col bg-surface px-4 py-1.5">
          <Fact k="May reach">
            <span className="flex flex-wrap items-baseline gap-2">
              {i.risk && <Tag tone={RISK_TONE[i.risk] ?? "neutral"}>{riskLabel(i.risk)}</Tag>}
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
              <Field label="Review due" hint="A date, as YYYY-MM-DD. Leave empty for none.">
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
              {i.owner ? <OwnerChip owner={i.owner} /> : <span className="text-[12px] text-warn">No owner. Nobody is named as answering for this identity.</span>}
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
              {ownerStoreDown && (<span className="text-[11.5px] leading-[1.5] text-faint">Owners cannot be saved here: the register&rsquo;s own table is not reachable on this deployment.</span>)}
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
  if (items.length === 0 && !i.last_used) return null;
  items.push({ k: "Last used", v: i.last_used ? ago(i.last_used, now) : "none on record" });
  return (
    <Card id="usage" title="Usage" meta="as the identity register measured it on this read">
      <div className="p-4">
        <Figures items={items} />
      </div>
    </Card>
  );
}
