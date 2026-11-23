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
import { notBuiltOf } from "@/lib/not-built";
import { disconnectIdentity, mintKey, readIdentities, readUsers, removeVaultKey, revokeKey as revokeKeyDoor, setAttachedPolicy, setIdentityOwner, setUserAccess, signOutUser } from "@/lib/api/l2";
import type { LiveKey } from "@/lib/api/pending";
import {
  Card,
  EventLine,
  FindingLine,
  FoldSection,
  KINDS,
  KIND_META,
  LiveKeys,
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

/** How a kind the register names as not built is said in a sentence. */
const UNBUILT_WORD: Record<string, string> = { mcp_server: "MCP servers", vault_credential: "stored credentials" };

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
  /** Behind Google IAP a person's roles come from this deployment's role map, never from the sign-in. */
  const [busy, setBusy] = useState("");
  /** What the last action did. `keys` is a held-out person's unrevoked API keys, which keep working; `secret` a key shown this once. */
  const [notice, setNotice] = useState<{ tone: Tone; text: string; secret?: string; keys?: LiveKey[] } | null>(null);
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

  const all = useMemo(() => reg?.identities ?? [], [reg]);
  /** The kinds the register names as not built: none can be listed, so none is counted as zero. */
  const unbuiltKinds = useMemo(() => notBuiltOf(reg).filter((k) => (KINDS as string[]).includes(k)), [reg]);
  const unbuiltWords = unbuiltKinds.map((k) => UNBUILT_WORD[k] ?? KIND_META[k as keyof typeof KIND_META].plural.toLowerCase());
  const unbuiltLine = unbuiltWords.length ? `${unbuiltWords.join(" and ")} ${unbuiltWords.length === 1 ? "is" : "are"} not built on this platform` : "";
  const findingsOf = useMemo(() => {
    const m = new Map<string, Finding[]>();
    for (const f of reg?.findings ?? []) {
      if (!f.identity.id) continue;
      const k = identityKey(f.identity);
      m.set(k, [...(m.get(k) ?? []), f]);
    }
    return m;
  }, [reg]);

  /* ── people: everyone who has signed in, as the users door lists them ── */

  const peopleRead = Boolean(people) || Boolean(peopleError);
  // Nothing until the users door has answered or failed: the first paint is the same on the server and here.
  const persons: Person[] = useMemo(() => (peopleRead ? (people?.users ?? []) : []), [people, peopleRead]);

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
  // Each identity at the risk the register gives it: an agent's is the highest among the tools its definition grants (`facts.risk_from`
  // says which). A blank risk is never counted as "reads only": an agent whose risk could not be read is counted as not known, and a
  // tool server or a stored credential, which calls nothing itself, is left out of the chart.
  const REACH: { risk: string; label: string }[] = [
    { risk: "read", label: "Reads only" },
    { risk: "write", label: "Writes records" },
    { risk: "risky", label: "Acts outside the system" },
    { risk: "destructive", label: "Destructive" },
  ];
  const actors = live.filter((i) => i.risk || i.kind === "workflow" || i.kind === "attached_agent" || i.kind === "api_key");
  const reachBy = [
    ...REACH.map(({ risk, label }) => {
      const n = actors.filter((i) => i.risk === risk).length;
      return { label, value: n, color: RISK_COLOR[risk], meta: `${n}` };
    }),
    ...(actors.some((i) => !i.risk) ? [{ label: "Risk not known", value: actors.filter((i) => !i.risk).length, color: "var(--t-line-strong)", meta: `${actors.filter((i) => !i.risk).length}` }] : []),
  ];
  const noReach = live.length - actors.length;
  const permList = people?.permissions.map((p) => p.permission) ?? [];
  const roleList = people?.roles ?? [];
  const holders = (role: string) => persons.filter((p) => p.last_app_roles.includes(role)).length;

  usePageFacts(
    reg && people
      ? {
          people: { signedIn: persons.length, sessionsOpen, ssoConfigured: people.sso.configured, roles: people.roles },
          identities: reg.counts,
          ownership: { owned, unowned },
          findings: reg.findings.map((f) => ({ severity: f.severity, title: f.title, identity: f.identity.name })),
          filters: filter,
          open: entry ? { key: entry.key, name: entryName(entry) } : null,
        }
      : null,
  );

  /* ── actions: every one maps onto a backend door, through the generated client (lib/api/l2.ts) ── */

  const act = async (label: string, fn: () => Promise<unknown>, done: (d: Record<string, unknown>) => { tone: Tone; text: string; secret?: string; keys?: LiveKey[] }) => {
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
        // The new key first, with what the old one held: a refused mint leaves the old one standing.
        const held = Array.isArray(i.facts.permissions) ? (i.facts.permissions as unknown[]).filter((p): p is string => typeof p === "string") : undefined;
        const minted = await mintKey(i.name, typeof i.facts.agent === "string" && i.facts.agent ? i.facts.agent : null, held?.length ? held : undefined);
        let revokeFailed = "";
        await revokeKeyDoor(i.id).catch((e: Error) => {
          revokeFailed = e.message;
        });
        return { ...minted, revokeFailed };
      },
      (d) =>
        d.revokeFailed
          ? { tone: "err", text: `A new key for ${i.name} was minted, but the old one was NOT revoked and still works: ${String(d.revokeFailed)}. Copy the new key now: it is not shown again.`, secret: String(d.key ?? "") }
          : { tone: "ok", text: `Rotated ${i.name}: the old key is revoked. Copy the new key now: it is not shown again.`, secret: String(d.key ?? "") },
    );
  const disconnectService = (i: Identity) =>
    act(`service:${i.id}`, () => disconnectIdentity("attached_agent", i.id), (d) => ({ tone: "warn", text: `${i.name} is disconnected: ${typeof d.note === "string" && d.note ? d.note : "every token issued to it until now is refused."}` }));
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
  const liveKeysOf = (d: Record<string, unknown>): LiveKey[] =>
    Array.isArray(d.live_keys) ? (d.live_keys as LiveKey[]).filter((k) => k && typeof k.id === "string") : [];
  const HELD = "every request of theirs is refused until an administrator lets them back. Their Google sign-in itself is untouched";
  /** The keys a hold revoked in the same act, when it was asked to, in a sentence; "" when it revoked none. */
  const revokedLine = (d: Record<string, unknown>, asked: boolean): string => {
    const revoked = Array.isArray(d.revoked_keys) ? (d.revoked_keys as LiveKey[]).filter((k) => k && typeof k.id === "string") : [];
    if (revoked.length) return ` Revoked with the hold: ${revoked.map((k) => `${k.name} (${k.prefix}…)`).join(", ")}.`;
    return asked ? " No API key of theirs still worked, so none was revoked." : "";
  };
  const signOut = (p: Person, revokeKeys = false) =>
    act(`signout:${p.sub}`, () => signOutUser(p.sub, revokeKeys), (d) => ({
      tone: "warn",
      text: `This service cannot end a Google session, so ${p.name || p.email} is held out instead: ${HELD}.${d.signedOut === 1 ? " Their live connection to the console is ended." : " They had no live connection to the console."}${revokedLine(d, revokeKeys)}`,
      keys: liveKeysOf(d),
    }));
  const setAccess = (p: Person, disabled: boolean, revokeKeys = false) =>
    act(`user:${p.sub}`, () => setUserAccess(p.sub, disabled, byName, revokeKeys), (d) =>
      disabled
        ? { tone: "warn", text: `${p.name || p.email} is held out: ${HELD}.${revokedLine(d, revokeKeys)}`, keys: liveKeysOf(d) }
        : { tone: "ok", text: `${p.name || p.email} is let back: their next request is let through.` },
    );

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
    disconnectService: (i) => void disconnectService(i),
    gateAgent: (i) => void gateAgent(i),
    disconnectServer: (i) => void disconnectServer(i),
    removeSecret: (i) => void removeSecret(i),
    saveOwner,
    runFinding,
    signOut: (p, revokeKeys) => void signOut(p, revokeKeys),
    setAccess: (p, d, revokeKeys) => void setAccess(p, d, revokeKeys),
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
    { label: "People", value: people ? String(persons.length) : "—", sub: people ? (people.sso.configured ? "signed in through Identity-Aware Proxy" : "sign-in is not set up on the service") : "", go: () => show({ groups: ["people"] }) },
    { label: "Sessions open", value: people ? String(sessionsOpen) : "—", sub: people ? "people seen in the last 30 minutes" : "", go: () => show({ groups: ["people"], statuses: ["signed in"] }) },
    {
      label: "Non-human identities",
      value: reg ? String(live.length) : "—",
      sub: reg ? `${KINDS.filter((k) => live.some((i) => i.kind === k)).length} kinds on the register${unbuiltWords.length ? `; ${unbuiltWords.join(" and ")}: not built` : ""}` : "",
      go: () => show({ groups: ["agents", "machines"] }),
    },
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
      <Status tone={notice.tone}>{notice.tone === "err" ? (notice.secret ? "Part done" : "Refused") : "Done"}</Status>
      <span className="min-w-0 basis-[420px] grow text-[12.5px] leading-[1.5] text-fg">{notice.text}</span>
      <Button size="sm" variant="solid" tone="neutral" onClick={() => setNotice(null)}>
        Dismiss
      </Button>
      {notice.secret && (
        <span className="flex w-full flex-wrap items-center gap-2">
          <Mono className="min-w-0 grow rounded-sm border border-line bg-raise px-2 py-1 text-[11.5px] break-all text-fg">{notice.secret}</Mono>
          <Button size="sm" variant="solid" tone="ink" onClick={() => navigator.clipboard?.writeText(notice.secret ?? "")}>
            Copy
          </Button>
        </span>
      )}
      {notice.keys && <LiveKeys keys={notice.keys} onRevoked={() => void load()} />}
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
            keysOfPerson={entry.type === "person" && reg ? all.filter((i) => i.kind === "api_key" && i.status === "active" && i.owner?.owner_sub === entry.person.sub) : null}
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
          {people && (people.sso.configured ? <Tag tone="ok">Signed in through Identity-Aware Proxy</Tag> : <Tag tone="err">Sign-in is not set up on the service</Tag>)}
        </span>
        <p className="max-w-[86ch] text-[13.5px] leading-relaxed text-dim">
          The people who sign in, and the workflows, attached agents and API keys that can act on this deployment, in one roster. Open one for what needs attention, what it may do and what it has done.
          {unbuiltLine && <span className="text-faint"> {unbuiltLine[0].toUpperCase() + unbuiltLine.slice(1)}, so none is listed.</span>}
        </p>
        {people && !people.sso.configured && (
          <p className="max-w-[86ch] text-[12px] leading-[1.55] text-err">
            The service names no IAP_AUDIENCE, so it cannot verify anyone&rsquo;s Google sign-in and refuses every person until it is set.
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
        caption="Computed from the register on every read: identities with no owner, keys whose owner is held out, identities not used in 90 days, keys older than 180 days. A finding goes when the record changes; each has the action that clears it."
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
          notBuiltKinds={unbuiltKinds}
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
          <span className="mt-auto text-[10.5px] text-faint">{KINDS.filter((k) => !unbuiltKinds.includes(k)).map((k) => `${KIND_META[k].glyph} ${KIND_META[k].plural.toLowerCase()}`).join(" · ")}</span>
        </section>
        <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 elev-1">
          <span className="text-[11px] font-medium text-faint">How far it reaches</span>
          {reg && live.length > 0 && (
            <RankBar
              data={reachBy}
              onPick={(label) => {
                const risk = REACH.find((r) => r.label === label)?.risk;
                // "Risk not known" counts agents, attached agents and keys with no risk, not the tool servers and credentials that call nothing.
                show(risk ? { risks: [risk] } : { risks: ["none"], kinds: ["workflow", "attached_agent", "api_key"] });
              }}
            />
          )}
          {!reg && <span className="text-[12px] text-faint">{regError ? notRead("Identities are ranked here by the risk of what they may call.") : "Reading…"}</span>}
          <span className="mt-auto text-[10.5px] leading-[1.45] text-faint">
            Reach is the highest risk among what the identity may call; an agent&rsquo;s is read from the tools its deployed definition grants (its latest saved one while none is deployed).
            {noReach > 0 ? ` ${noReach} tool server${noReach === 1 ? "" : "s"} and stored credential${noReach === 1 ? "" : "s"} call nothing themselves and are not ranked.` : ""}
          </span>
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
          <span className="mt-auto text-[10.5px] text-faint">Roles come from this deployment&rsquo;s map from a person&rsquo;s email to a role; this platform decides what each one may do.</span>
        </section>
      </div>

      {/* ── roles and permissions ── */}
      <FoldSection
        id="roles"
        {...fold("roles")}
        title="Roles and permissions"
        caption="Behind Google Identity-Aware Proxy the sign-in names a person and never a role: each person's role comes from this deployment's role map, read on every request, and this platform maps each role to what it may do here."
        meta={people ? <Tag>{roleList.length} roles</Tag> : null}
      >
        {!people && <p className="px-4 py-3 text-[12px] text-faint">{peopleError ? notRead("Roles are listed here with their permissions and holders, beside what each permission lets a person do.") : "Reading…"}</p>}
        {people && (
          <div className="grid gap-px bg-line lg:grid-cols-2">
            <div className="flex flex-col bg-surface">
              <span className="border-b border-line px-4 py-2 text-[11px] text-faint">Roles this deployment recognises, as its role map names them</span>
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
        caption="Every row of the platform's audit trail, newest first, as the door returned it (the latest only): first sign-ins, people held out and let back, requests refused, changes that did not succeed, and every change made, with who made it."
        meta={people && !auditDown ? <Tag>{people.events.length} events</Tag> : null}
      >
        {!people && <p className="px-4 py-3 text-[12px] text-faint">{peopleError ? notRead("Sign-ins, sign-outs, denials and privileged actions are listed here, newest first.") : "Reading…"}</p>}
        {people && auditDown && (<p className="px-4 py-3 text-[12px] text-err">The audit trail could not be read: {auditError}.</p>)}
        {people && !auditDown && people.events.length === 0 && <p className="px-4 py-3 text-[12px] text-dim">No sign-in or action has been recorded yet.</p>}
        {people && !auditDown && people.events.length > 0 && (
          <div className="af-list af-list-tall">
            {people.events.map((e) => (
              <EventLine key={e.id} event={e} now={now} />
            ))}
          </div>
        )}
      </FoldSection>
      </>
    </div>
  );
}
