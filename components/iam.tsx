"use client";
import { Failure } from "./pending";

import { IapAccess } from "./iap-access";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { agentHref } from "@/lib/agent-link";
import { Button, Mono, Status, Tag, type Tone } from "./ui";
import { Donut, RankBar, StackedBar } from "./charts";
import { usePageFacts } from "./assistant";
import { CURRENT_USER } from "@/lib/user";
import { useSession, signerName } from "@/lib/use-session";
import { soon } from "@/lib/soon";
import { disconnectIdentity, mintKey, readIdentities, readUsers, removeVaultKey, revokeKey as revokeKeyDoor, setAttachedPolicy, setIdentityOwner, setUserAccess, signOutUser } from "@/lib/api/l2";
import {
  Card,
  EventLine,
  FindingLine,
  FoldSection,
  KINDS,
  KIND_META,
  RISK_COLOR,
  entryName,
  findEntry,
  identityEntry,
  identityKey,
  identityUrl,
  personEntry,
  type Entry,
  type Finding,
  type Identity,
  type People,
  type Person,
  type Register,
} from "./identity-shared";
import { IdentityRoster, NO_FILTER, keyToReview, type RosterFilter } from "./identity-roster";
import { IdentityPage, type IamActions, type OwnerDraft } from "./identity-page";

/**
 * Identity and access: who may use this platform, and every identity that
 * is not a person.
 *
 * One roster holds both: the people the identity provider has signed in and
 * the workflows, attached agents, MCP servers, keys and vault credentials
 * that can act here. A row opens the identity's page (`/iam?identity=<id>`):
 * what needs attention, what it may do, what the register measured of its
 * use, and its entries in the audit trail.
 *
 * Every number is computed from what the two IAM doors answered on this
 * read (`GET /api/iam/identities`, `GET /api/iam/users`). Nothing here is a
 * stored verdict, and nothing is generated: a time the doors do not give is
 * left empty.
 */

export function Iam() {
  return (
    <Suspense>
      <IamPage />
    </Suspense>
  );
}

function IamPage() {
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get("identity") ?? "";
  const editOwner = params.get("owner") === "1";

  const [reg, setReg] = useState<Register | null>(null);
  const [regError, setRegError] = useState("");
  const [people, setPeople] = useState<People | null>(null);
  const [peopleError, setPeopleError] = useState("");
  const [filter, setFilter] = useState<RosterFilter>(NO_FILTER);
  const { session: me } = useSession();
  const byName = signerName(me, CURRENT_USER.name);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ tone: Tone; text: string; secret?: string } | null>(null);
  // One clock reading per mount; "idle 30 days" must not move while the page is open.
  const [now] = useState(() => Date.now());
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const fold = (id: string) => ({ folded: Boolean(folded[id]), onToggle: () => setFolded((f) => ({ ...f, [id]: !f[id] })) });

  /* The two doors are read apart: one failing leaves the other on the page. */
  const load = useCallback(async () => {
    const [r, p] = await Promise.allSettled([readIdentities(), readUsers()]);
    if (r.status === "fulfilled") {
      setReg(r.value as unknown as Register);
      setRegError("");
    } else setRegError((r.reason as Error)?.message || "the request failed");
    if (p.status === "fulfilled") {
      setPeople(p.value as unknown as People);
      setPeopleError("");
    } else setPeopleError((p.reason as Error)?.message || "the request failed");
  }, []);
  useEffect(() => soon(load), [load]);

  /* ── the register ── */

  // This console starts empty: an identity the control plane marks as a seeded sample is not shown as part of the estate.
  const all = useMemo(() => (reg?.identities ?? []).filter((i) => !i.facts?.demo), [reg]);
  const findingsOf = useMemo(() => {
    const m = new Map<string, Finding[]>();
    for (const f of reg?.findings ?? []) {
      if (!f.identity.id) continue;
      const k = identityKey(f.identity);
      m.set(k, [...(m.get(k) ?? []), f]);
    }
    return m;
  }, [reg]);

  /* ── people; with sign-in off, the console's own operator as the session door names it ── */

  const peopleRead = Boolean(people) || Boolean(peopleError);
  const persons: Person[] = useMemo(() => {
    // Nothing until the users door has answered or failed: the first paint is the same on the server and here.
    if (!peopleRead) return [];
    const rows = people?.users ?? [];
    if (rows.length === 0 && me && me.mode === "local") {
      // No identity provider gave this row anything: no organisation, and no sign-in times.
      return [{ sub: me.sub, email: me.email, name: me.name, org_type: "", last_roles: me.roles, last_app_roles: me.appRoles, permissions: me.permissions, first_seen: null, last_seen: null, sessions: 1, disabled_at: null }];
    }
    return rows;
  }, [people, peopleRead, me]);

  const entries: Entry[] = useMemo(() => [...persons.map(personEntry), ...all.map(identityEntry)], [persons, all]);
  const entry = selected ? findEntry(entries, selected) : null;

  /* ── the posture ── */

  const live = all.filter((i) => i.status !== "revoked");
  const unowned = live.filter((i) => !i.owner).length;
  const owned = live.length - unowned;
  const toReview = all.filter((i) => keyToReview(i, now)).length;
  const findings = reg?.findings ?? [];
  const errs = findings.filter((f) => f.severity === "err").length;
  const warns = findings.filter((f) => f.severity === "warn").length;
  const sessionsOpen = persons.reduce((n, u) => n + u.sessions, 0);
  const reachBy = ["read", "write", "risky"].map((r) => {
    const n = live.filter((i) => (i.risk || "read") === r).length;
    return { label: r === "risky" ? "Acts outside the system" : r === "write" ? "Writes records" : "Reads only", value: n, color: RISK_COLOR[r], meta: `${n}` };
  });
  const permList = people?.permissions.map((p) => p.permission) ?? [];
  const roleList = people?.roles ?? [];
  const holders = (role: string) => persons.filter((p) => p.last_app_roles.includes(role)).length;

  usePageFacts(
    reg && people
      ? {
          people: { signedIn: persons.length, sessionsOpen, ssoConfigured: people.sso.configured, demoDefaultRole: people.sso.demo_default_role, roles: people.roles },
          identities: reg.counts,
          ownership: { owned, unowned },
          findings: reg.findings.map((f) => ({ severity: f.severity, title: f.title, identity: f.identity.name })),
          filters: filter,
          open: entry ? { key: entry.key, name: entryName(entry) } : null,
        }
      : null,
  );

  /* ── actions: every one maps onto a backend door, through the generated client (lib/api/l2.ts) ── */

  const act = async (label: string, fn: () => Promise<unknown>, done: (d: Record<string, unknown>) => { tone: Tone; text: string; secret?: string }) => {
    setBusy(label);
    try {
      // A refusal rejects with the backend's own message.
      const d = ((await fn()) ?? {}) as Record<string, unknown>;
      setNotice(done(d));
      await load();
    } catch (e) {
      setNotice({ tone: "err", text: (e as Error).message });
    } finally {
      setBusy("");
    }
  };
  const revokeKey = (i: Identity) => act(`revoke:${i.id}`, () => revokeKeyDoor(i.id), () => ({ tone: "ok", text: `Revoked ${i.name}. Anything still presenting it is refused from now.` }));
  const rotateKey = (i: Identity) =>
    act(
      `rotate:${i.id}`,
      async () => {
        // The new key first: a refused mint leaves the old one standing.
        const minted = await mintKey(i.name, (i.facts.agent as string | null) ?? null);
        await revokeKeyDoor(i.id).catch(() => {});
        return minted;
      },
      (d) => ({ tone: "ok", text: `Rotated ${i.name}: the old key is revoked and this is the only time the new one is shown.`, secret: String(d.key ?? "") }),
    );
  const blockAgent = (i: Identity, blocked: boolean) =>
    act(`block:${i.id}`, () => setAttachedPolicy({ id: i.id, blocked }), () => ({ tone: blocked ? "warn" : "ok", text: blocked ? `${i.name} is blocked; every door refuses it until the block is lifted.` : `${i.name} is unblocked.` }));
  const gateAgent = (i: Identity) => act(`gate:${i.id}`, () => setAttachedPolicy({ id: i.id, gate_at: "write" }), () => ({ tone: "ok", text: `${i.name} now stops for a person at write and above.` }));
  const disconnectServer = (i: Identity) => act(`disconnect:${i.id}`, () => disconnectIdentity("mcp_server", i.id), () => ({ tone: "ok", text: `Disconnected ${i.name} from the registry.` }));
  const removeSecret = (i: Identity) => act(`secret:${i.id}`, () => removeVaultKey(i.id), () => ({ tone: "ok", text: `Removed \${secret:${i.id}} from the vault.` }));
  const saveOwner = async (i: Identity, draft: OwnerDraft): Promise<boolean> => {
    let saved = false;
    await act(
      `owner:${i.id}`,
      () => setIdentityOwner({ kind: i.kind, id: i.id, owner: draft.owner, purpose: draft.purpose, review_due_at: draft.review || null, by: byName }),
      () => {
        saved = true;
        return { tone: "ok", text: draft.owner ? `${draft.owner} now answers for ${i.id}.` : `Owner cleared on ${i.id}.` };
      },
    );
    return saved;
  };
  const signOut = (p: Person) => act(`signout:${p.sub}`, () => signOutUser(p.sub), () => ({ tone: "ok", text: `${p.name || p.email} signed out everywhere.` }));
  const setAccess = (p: Person, disabled: boolean) =>
    act(`user:${p.sub}`, () => setUserAccess(p.sub, disabled, byName), () => ({ tone: disabled ? "warn" : "ok", text: disabled ? `${p.name || p.email} disabled and signed out everywhere.` : `${p.name || p.email} re-enabled.` }));

  const open = (key: string, owner = false) => router.push(`${identityUrl(key)}${owner ? "&owner=1" : ""}`);
  const byRef = (f: Finding) => all.find((i) => i.kind === f.identity.kind && i.id === f.identity.id);
  const runFinding = (f: Finding) => {
    const i = byRef(f);
    if (!f.action || !i) return;
    switch (f.action.op) {
      case "revoke_key":
        return void revokeKey(i);
      case "rotate_key":
        return void rotateKey(i);
      case "block_agent":
        return void blockAgent(i, true);
      case "gate_agent":
        return void gateAgent(i);
      case "disconnect_server":
        return void disconnectServer(i);
      case "remove_secret":
        return void removeSecret(i);
      case "assign_owner":
        return open(identityKey(i), true);
      case "open_builder":
        // The register names the agent by an old address; the agent's own page is where it opens.
        return router.push(agentHref(i.id));
    }
  };
  const actions: IamActions = {
    revokeKey: (i) => void revokeKey(i),
    rotateKey: (i) => void rotateKey(i),
    blockAgent: (i, b) => void blockAgent(i, b),
    gateAgent: (i) => void gateAgent(i),
    disconnectServer: (i) => void disconnectServer(i),
    removeSecret: (i) => void removeSecret(i),
    saveOwner,
    runFinding,
    signOut: (p) => void signOut(p),
    setAccess: (p, d) => void setAccess(p, d),
  };

  /** Narrow the roster to what a figure counts, and bring it into view. */
  const show = (patch: Partial<RosterFilter>) => {
    setFilter({ ...NO_FILTER, ...patch });
    document.getElementById("roster")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const ownerStoreDown = reg?.store === "db unreachable";
  /* The users door answers an empty trail when its store is down; that is "not read", not "nothing happened". */
  const auditDown = people?.store === "db unreachable";
  const auditError = peopleError || (auditDown ? "the store that holds people and the audit trail is not reachable on this deployment" : "");
  const loading = !reg && !people && !regError && !peopleError;
  /* A door that failed is shown with its reason above; every panel it feeds says it was not read, and nothing is counted as zero. */
  const quietDown = Boolean(regError || peopleError);
  const noReg = Boolean(regError) && !reg;
  const noPeople = Boolean(peopleError) && !people;
  const notRead = (what: string) => (what ? "Not read." : "");

  const strip: { label: string; value: string; sub: string; go: () => void }[] = [
    { label: "People", value: people ? String(persons.length) : "—", sub: people ? (people.sso.configured ? "signed in through the identity provider" : "sign-in is off") : "", go: () => show({ groups: ["people"] }) },
    { label: "Sessions open", value: people ? String(sessionsOpen) : "—", sub: "", go: () => show({ groups: ["people"], statuses: ["signed in"] }) },
    { label: "Non-human identities", value: reg ? String(live.length) : "—", sub: reg ? `${KINDS.filter((k) => live.some((i) => i.kind === k)).length} kinds on the register` : "", go: () => show({ groups: ["agents", "machines"] }) },
    { label: "With a named owner", value: reg ? `${live.length ? Math.round((owned / live.length) * 100) : 0}%` : "—", sub: reg ? `${unowned} without one` : "", go: () => show({ flags: ["unowned"] }) },
    { label: "Credentials to review", value: reg ? String(toReview) : "—", sub: "keys unused, idle or past 90 days", go: () => show({ flags: ["review"] }) },
    {
      label: "Findings",
      value: reg ? String(findings.length) : "—",
      sub: reg ? `${errs} to fix now · ${warns} to review` : "",
      go: () => {
        setFolded((f) => ({ ...f, findings: false }));
        document.getElementById("findings")?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    },
  ];

  const noticeBar = notice && (
    <div className="relative flex flex-wrap items-center gap-3 overflow-hidden rounded-lg border border-line bg-surface py-2.5 pr-3 pl-4 elev-1">
      <span className={`absolute inset-y-0 left-0 w-[3px] ${notice.tone === "err" ? "bg-err" : notice.tone === "warn" ? "bg-warn" : "bg-ok"}`} />
      <Status tone={notice.tone}>{notice.tone === "err" ? "Refused" : "Done"}</Status>
      <span className="min-w-0 text-[12.5px] leading-[1.5] text-fg">{notice.text}</span>
      {notice.secret && (
        <>
          <Mono className="text-[11.5px] break-all text-fg">{notice.secret}</Mono>
          <Button size="sm" variant="solid" tone="ink" onClick={() => navigator.clipboard?.writeText(notice.secret ?? "")}>
            Copy
          </Button>
        </>
      )}
      <span className="grow" />
      <Button size="sm" variant="solid" tone="neutral" onClick={() => setNotice(null)}>
        Dismiss
      </Button>
    </div>
  );
  const errorLines = (
    <>
      {regError && <Failure what="The identity register could not be read" message={regError} />}
      {peopleError && <Failure what="People and the audit trail could not be read" message={peopleError} />}
    </>
  );

  /* ═══════════════════ one identity ═══════════════════ */

  if (selected) {
    return (
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-5 py-7">
        <div>
          <Button size="sm" variant="solid" tone="neutral" href="/iam">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 6l-6 6 6 6" />
            </svg>
            Identity and access
          </Button>
        </div>
        {errorLines}
        {noticeBar}
        {quietDown && !entry ? (
          <p className="text-[12.5px] text-faint">The roster could not be read, so this identity cannot be shown.</p>
        ) : entry ? (
          <IdentityPage
            key={entry.key}
            entry={entry}
            findings={findingsOf.get(entry.key) ?? []}
            events={people && !auditDown ? people.events : null}
            eventsError={auditError}
            people={people}
            now={now}
            meSub={me?.sub ?? ""}
            busy={busy}
            ownerStoreDown={ownerStoreDown}
            editOwner={editOwner}
            actions={actions}
            unread={quietDown}
          />
        ) : loading || (!reg && !regError) || (!people && !peopleError) ? (
          <p className="text-[12.5px] text-faint">Reading the identity…</p>
        ) : (
          <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-line-strong px-6 py-10">
            <span className="text-[14px] font-medium">No identity with this id is on the roster</span>
            <span className="max-w-[70ch] text-[12.5px] leading-[1.55] text-dim">
              <Mono className="text-[12px]">{selected}</Mono> is not a person the identity provider has signed in, nor an identity on the register. It may have been revoked, disconnected or removed.
            </span>
          </div>
        )}
      </div>
    );
  }

  /* ═══════════════════ the roster and the estate ═══════════════════ */

  return (
    <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-4 px-5 py-7">
      <header className="flex flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-[24px] font-semibold tracking-[-0.02em]">Identity and access</h1>
          {people && (people.sso.configured ? <Tag tone="ok">Identity provider connected</Tag> : <Tag tone="warn">Sign-in is off</Tag>)}
          {people?.sso.demo_default_role && <Tag tone="warn">people with no role are treated as {people.sso.demo_default_role}</Tag>}
        </span>
        <p className="max-w-[86ch] text-[13.5px] leading-relaxed text-dim">
          The people who sign in, and the workflows, attached agents, MCP servers, keys and credentials that can act on this deployment, in one roster. Open one for what needs attention, what it may do and what it has done.
        </p>
        {people && !people.sso.configured && (
          <p className="max-w-[86ch] text-[12px] leading-[1.55] text-faint">
            Sign-in is off on this deployment, so the console runs as its own operator. Once people sign in through the identity provider they are listed here with the roles their token carried, and their gate answers are signed
            with that identity.
          </p>
        )}
      </header>

      {/* Who the proxy lets in: read from Google IAP itself, so it stands whether or not the control plane is connected. */}
      <IapAccess />

      <>
      {/* ── posture: each figure narrows the roster to what it counts ── */}
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line elev-1 sm:grid-cols-3 xl:grid-cols-6">
        {strip.map((k) => (
          <button key={k.label} type="button" onClick={k.go} className="focusable flex cursor-pointer flex-col justify-center gap-0.5 bg-surface px-4 py-3 text-left transition-colors hover:bg-raise/60">
            {quietDown && k.value === "—" ? (
              <span className="flex h-[22px] items-center text-[12px] text-faint">Not connected</span>
            ) : (
              <span className="tnum text-[22px] leading-none font-semibold tracking-[-0.02em] text-fg">{k.value}</span>
            )}
            <span className="text-[11.5px] text-dim">{k.label}</span>
            {k.sub && <span className="truncate text-[10.5px] text-faint">{k.sub}</span>}
          </button>
        ))}
      </section>

      {errorLines}
      {noticeBar}

      {/* ── findings ── */}
      <FoldSection
        id="findings"
        {...fold("findings")}
        title="Findings"
        caption="Computed from the register on every read: credentials nobody uses, servers nothing holds, risky tools with no gate, identities with no owner. A finding goes when the record changes; each has the action that clears it."
        meta={reg ? <Tag tone={errs ? "err" : warns ? "warn" : "neutral"}>{findings.length}</Tag> : null}
      >
        {!reg && !regError && <p className="px-4 py-3 text-[12px] text-faint">Reading the register…</p>}
        {noReg && <p className="px-4 py-3 text-[12px] text-faint">Not read.</p>}
        {reg && findings.length === 0 && <p className="px-4 py-3 text-[12px] text-dim">No findings on this read.</p>}
        {(["err", "warn", "info"] as const).map((sev) => {
          const group = findings.filter((f) => f.severity === sev);
          if (!group.length) return null;
          return (
            <div key={sev} className="border-b border-line last:border-0">
              <div className="flex items-center gap-2 border-b border-line bg-raise/40 px-4 py-1.5 text-[11px] font-medium text-faint">
                <span className={`size-1.5 rounded-[2px] ${sev === "err" ? "bg-err" : sev === "warn" ? "bg-warn" : "bg-line-strong"}`} />
                {sev === "err" ? "Fix now" : sev === "warn" ? "Review" : "Notes"} · {group.length}
              </div>
              {group.map((f) => (
                <FindingLine
                  key={f.id}
                  finding={f}
                  showIdentity
                  busy={Boolean(f.identity.id) && busy.endsWith(`:${f.identity.id}`)}
                  onRun={runFinding}
                  onOpen={f.identity.id ? () => open(identityKey(f.identity)) : () => show({ flags: ["unowned"] })}
                />
              ))}
            </div>
          );
        })}
      </FoldSection>

      {/* ── the roster ── */}
      <Card id="roster" title="Roster" meta={reg || people ? `${entries.length} identities: ${persons.length} ${persons.length === 1 ? "person" : "people"}, ${all.length} not a person` : undefined}>
        <IdentityRoster
          entries={entries}
          findingsOf={findingsOf}
          now={now}
          loading={loading}
          filter={filter}
          onFilter={setFilter}
          meSub={me?.sub ?? ""}
          onOpen={(key) => open(key)}
          onAssignOwner={(key) => open(key, true)}
          ownerStoreDown={ownerStoreDown}
          unread={noReg || noPeople}
        />
        {ownerStoreDown && <p className="border-t border-line px-4 py-2 text-[11.5px] leading-[1.5] text-warn">Owners cannot be read or saved: the register&rsquo;s own table is not reachable on this deployment.</p>}
        {reg?.basis && <p className="border-t border-line px-4 py-2 text-[11px] leading-[1.5] text-faint">{reg.basis}</p>}
      </Card>

      {/* ── the shape of the estate; each segment narrows the roster ── */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 elev-1">
          <span className="text-[11px] font-medium text-faint">What can act here</span>
          {reg ? (
            live.length ? (
              <Donut
                data={KINDS.filter((k) => live.some((i) => i.kind === k)).map((k) => ({ label: KIND_META[k].plural, value: live.filter((i) => i.kind === k).length, color: KIND_META[k].color }))}
                size={104}
                onPick={(label) => {
                  const k = KINDS.find((x) => KIND_META[x].plural === label);
                  if (k) show({ kinds: [k] });
                }}
              />
            ) : (
              <span className="text-[12px] text-faint">No identity is on the register.</span>
            )
          ) : (
            <span className="text-[12px] text-faint">{regError ? notRead("The identities on the register are drawn here by kind.") : "Reading…"}</span>
          )}
          <span className="mt-auto text-[10.5px] text-faint">Select a segment to list the identities behind it.</span>
        </section>
        <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 elev-1">
          <span className="text-[11px] font-medium text-faint">Who answers for it</span>
          {reg && live.length > 0 && (
            <StackedBar
              data={KINDS.filter((k) => live.some((i) => i.kind === k)).map((k) => ({ label: KIND_META[k].glyph, values: [live.filter((i) => i.kind === k && i.owner).length, live.filter((i) => i.kind === k && !i.owner).length] }))}
              keys={["owned", "no owner"]}
              colors={["var(--t-ok)", "var(--t-warn)"]}
              height={120}
              onPick={(label, seg) => {
                const k = KINDS.find((x) => KIND_META[x].glyph === label);
                if (k) show({ kinds: [k], flags: seg === "no owner" ? ["unowned"] : [] });
              }}
            />
          )}
          {!reg && <span className="text-[12px] text-faint">{regError ? notRead("Each kind is drawn here by how many of its identities have a named owner.") : "Reading…"}</span>}
          <span className="mt-auto text-[10.5px] text-faint">W workflows · A agents · M MCP servers · K keys · V credentials</span>
        </section>
        <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 elev-1">
          <span className="text-[11px] font-medium text-faint">How far it reaches</span>
          {reg && live.length > 0 && (
            <RankBar
              data={reachBy}
              onPick={(label) => show({ risks: [label.startsWith("Acts") ? "risky" : label.startsWith("Writes") ? "write" : "read"] })}
            />
          )}
          {!reg && <span className="text-[12px] text-faint">{regError ? notRead("Identities are ranked here by the risk of what they may call.") : "Reading…"}</span>}
          <span className="mt-auto text-[10.5px] leading-[1.45] text-faint">Reach is the declared risk of what the identity may call.</span>
        </section>
        <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4 elev-1">
          <span className="text-[11px] font-medium text-faint">Who may do what</span>
          {people ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[11px]">
                <thead>
                  <tr className="text-faint">
                    <th className="pr-2 pb-1 text-left font-medium">role</th>
                    {permList.map((p) => (
                      <th key={p} className="px-1 pb-1 text-center font-medium">
                        {p}
                      </th>
                    ))}
                    <th className="pb-1 pl-2 text-right font-medium">held</th>
                  </tr>
                </thead>
                <tbody>
                  {roleList.map((r) => (
                    <tr key={r.role} className="cursor-pointer border-t border-line hover:bg-raise/50" onClick={() => show({ groups: ["people"], roles: [r.role] })} title={`List the people holding ${r.role}`}>
                      <td className="py-1.5 pr-2 font-mono text-[10.5px] text-fg">{r.role}</td>
                      {permList.map((p) => (
                        <td
                          key={p}
                          className="px-1 py-1.5 text-center"
                          onClick={(e) => {
                            e.stopPropagation();
                            show({ groups: ["people"], permissions: [p] });
                          }}
                        >
                          <span className={`inline-block size-3 rounded-[3px] ${r.permissions.includes(p) ? "bg-ok" : "bg-sunken"}`} title={`${r.role} ${r.permissions.includes(p) ? "may" : "may not"} ${p}`} />
                        </td>
                      ))}
                      <td className="tnum py-1.5 pl-2 text-right text-dim">{holders(r.role)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <span className="text-[12px] text-faint">{peopleError ? notRead("Each role is listed here with the permissions it carries and how many people hold it.") : "Reading…"}</span>
          )}
          <span className="mt-auto text-[10.5px] text-faint">Roles are assigned in the identity provider; this platform decides what each one may do.</span>
        </section>
      </div>

      {/* ── roles and permissions ── */}
      <FoldSection
        id="roles"
        {...fold("roles")}
        title="Roles and permissions"
        caption="Roles are assigned centrally and read from every token; this platform maps each role to what it may do here and stores no decision of its own."
        meta={people ? <Tag>{roleList.length} roles</Tag> : null}
      >
        {!people && <p className="px-4 py-3 text-[12px] text-faint">{peopleError ? notRead("Roles are listed here with their permissions and holders, beside what each permission lets a person do.") : "Reading…"}</p>}
        {people && (
          <div className="grid gap-px bg-line lg:grid-cols-2">
            <div className="flex flex-col bg-surface">
              <span className="border-b border-line px-4 py-2 text-[11px] text-faint">Roles this deployment recognises, as the identity provider names them</span>
              {roleList.map((r) => (
                <button key={r.role} type="button" onClick={() => show({ groups: ["people"], roles: [r.role] })} className="focusable flex cursor-pointer flex-wrap items-start gap-x-3 gap-y-1 border-b border-line px-4 py-2 text-left last:border-0 hover:bg-raise/40">
                  <Mono className="w-[120px] shrink-0 pt-px text-[11.5px] text-fg">{r.role}</Mono>
                  <span className="flex min-w-0 grow basis-[180px] flex-wrap gap-1">
                    {r.permissions.map((p) => (
                      <Tag key={p}>{p}</Tag>
                    ))}
                  </span>
                  <span className="tnum text-[11px] text-dim">
                    {holders(r.role)} holder{holders(r.role) === 1 ? "" : "s"}
                  </span>
                </button>
              ))}
            </div>
            <div className="flex flex-col bg-surface">
              <span className="border-b border-line px-4 py-2 text-[11px] text-faint">What each permission lets a person do here</span>
              {people.permissions.map((p) => (
                <span key={p.permission} className="flex items-start gap-3 border-b border-line px-4 py-2 last:border-0">
                  <Mono className="w-[120px] shrink-0 pt-px text-[11.5px] text-fg">{p.permission}</Mono>
                  <span className="min-w-0 grow text-[11.5px] leading-[1.5] text-dim">{p.means}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </FoldSection>

      {/* ── audit trail ── */}
      <FoldSection
        id="audit"
        {...fold("audit")}
        title="Audit trail"
        caption="Sign-ins, sign-outs, refresh failures, re-links, provisioning failures and denials from the identity layer, and privileged actions taken through the console with who took them, as the door returned them: the latest events only."
        meta={people && !auditDown ? <Tag>{people.events.length} events</Tag> : null}
      >
        {!people && <p className="px-4 py-3 text-[12px] text-faint">{peopleError ? notRead("Sign-ins, sign-outs, denials and privileged actions are listed here, newest first.") : "Reading…"}</p>}
        {people && auditDown && (<p className="px-4 py-3 text-[12px] text-err">The audit trail could not be read: {auditError}.</p>)}
        {people && !auditDown && people.events.length === 0 && <p className="px-4 py-3 text-[12px] text-dim">No sign-in or action has been recorded yet.</p>}
        {(people?.events ?? []).map((e) => (
          <EventLine key={e.id} event={e} now={now} />
        ))}
      </FoldSection>
      </>
    </div>
  );
}
