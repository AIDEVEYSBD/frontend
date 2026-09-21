"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button, Mono, Status, Tag, type Tone } from "./ui";
import { Donut, RankBar, StackedBar } from "./charts";
import { ActiveFilters, Chips, FilterBar, MoreFilters, SearchBox, type Chip } from "./filters";
import { usePageFacts } from "./assistant";
import { DrillModal, DrillTable } from "./drill";
import { CURRENT_USER } from "@/lib/user";
import { useSession, signerName } from "@/lib/use-session";
import { soon } from "@/lib/soon";
import { hueFor } from "@/lib/hue";

/**
 * IAM: who may use this platform, and every identity that is not a person.
 *
 * One page a client reads top to bottom: the posture in six numbers, the
 * shape of the estate in four instruments, the register of every principal
 * that can act here with the person who answers for it, what needs fixing,
 * the people and what their roles let them do, and the sign-in record.
 *
 * Every number is computed from the records that govern the identities on
 * every load. Nothing here is a stored verdict, and nothing is invented.
 */

type Kind = "workflow" | "attached_agent" | "mcp_server" | "api_key" | "vault_credential";
interface Owner { owner: string; owner_sub: string | null; purpose: string; review_due_at: string | null; updated_at: string; updated_by: string }
interface Identity {
  kind: Kind; id: string; name: string; description: string; credential: string; privileges: string; risk: string; status: string;
  created_at: string | null; last_used: string | null; runs30d: number | null; owner: Owner | null; href: string | null; facts: Record<string, unknown>;
}
interface Finding {
  id: string; severity: "warn" | "err" | "info"; identity: { kind: Kind; id: string; name: string }; title: string; detail: string;
  action?: { label: string; op: "revoke_key" | "rotate_key" | "block_agent" | "gate_agent" | "disconnect_server" | "remove_secret" | "assign_owner" | "open_builder" };
}
interface Register { identities: Identity[]; findings: Finding[]; counts: { total: number; byKind: Record<string, number>; findings: number; unowned: number }; store: string; basis: string }
interface Person {
  sub: string; email: string; name: string; org_type: string; is_ey_employee: boolean; last_roles: string[]; last_app_roles: string[]; permissions: string[];
  first_seen: string; last_seen: string; sessions: number; disabled_at: string | null;
}
interface People {
  users: Person[]; events: { id: number; at: string; kind: string; sub: string | null; email: string | null; detail: unknown }[];
  sso: { configured: boolean; issuer: string; demo_default_role: string };
  roles: { role: string; permissions: string[] }[]; permissions: { permission: string; means: string }[]; store: string;
}

const KIND_META: Record<Kind, { label: string; plural: string; tone: Tone; color: string; glyph: string }> = {
  workflow: { label: "Workflow", plural: "Workflows", tone: "run", color: "var(--t-c2)", glyph: "W" },
  attached_agent: { label: "Attached agent", plural: "Attached agents", tone: "queue", color: "var(--t-c5)", glyph: "A" },
  mcp_server: { label: "MCP server", plural: "MCP servers", tone: "ok", color: "var(--t-c7)", glyph: "M" },
  api_key: { label: "API key", plural: "API keys", tone: "warn", color: "var(--t-c8)", glyph: "K" },
  vault_credential: { label: "Vault credential", plural: "Vault credentials", tone: "neutral", color: "var(--t-c3)", glyph: "V" },
};
const KINDS = Object.keys(KIND_META) as Kind[];
const RISK_TONE: Record<string, Tone> = { read: "ok", write: "warn", risky: "err", destructive: "err" };
const RISK_COLOR: Record<string, string> = { read: "var(--t-ok)", write: "var(--t-warn)", risky: "var(--t-err)", destructive: "var(--t-err)" };
const STATUS_TONE: Record<string, Tone> = { active: "ok", deployed: "ok", "in use": "ok", saved: "neutral", unreferenced: "warn", unset: "warn", blocked: "err", revoked: "neutral" };
const FLAGS = [
  { value: "unowned", label: "No owner", tone: "warn" as const },
  { value: "unused", label: "Never used", tone: "warn" as const },
  { value: "stale", label: "Idle 30 days", tone: "warn" as const },
  { value: "risky", label: "Reaches outside", tone: "err" as const },
  { value: "blocked", label: "Blocked", tone: "err" as const },
  { value: "findings", label: "Has findings", tone: "err" as const },
];
const DAY = 86_400_000;

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}
function initialsOf(s: string): string {
  return s.replace(/<.*>/, "").trim().split(/[\s._@-]+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
}
function key(i: { kind: Kind; id: string }): string {
  return `${i.kind}:${i.id}`;
}

const control = "focusable h-8 rounded-md border border-line-strong bg-field px-2.5 text-[13px] text-fg placeholder:text-ghost";

function Section({ id, title, caption, meta, children, folded = false, onToggle }: { id: string; title: string; caption: string; meta?: React.ReactNode; children: React.ReactNode; folded?: boolean; onToggle?: () => void }) {
  return (
    <section id={id} className="flex scroll-mt-4 flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
      <button type="button" onClick={onToggle} aria-expanded={!folded} aria-controls={`${id}-body`} data-hue={hueFor(title)} className={`focusable flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-raise/40 ${folded ? "" : "border-b border-line"}`}>
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`mt-0.5 shrink-0 text-faint transition-transform ${folded ? "-rotate-90" : ""}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
        <span className="flex min-w-0 grow flex-col gap-0.5">
          <span className="flex items-center gap-2 text-[13px] font-semibold tracking-[-0.005em]">
            {title}
            {meta}
          </span>
          {!folded && <span className="max-w-[100ch] text-[11px] leading-[1.55] text-faint">{caption}</span>}
        </span>
        <span className="shrink-0 pt-0.5 text-[10.5px] text-ghost">{folded ? "show" : "hide"}</span>
      </button>
      <div id={`${id}-body`} hidden={folded}>
        {children}
      </div>
    </section>
  );
}

function OwnerChip({ owner }: { owner: Owner }) {
  return (
    <span className="flex items-center gap-2">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink text-[9px] font-semibold text-on-ink">{initialsOf(owner.owner)}</span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[11.5px] text-fg">{owner.owner}</span>
        <span className="max-w-[200px] truncate text-[10px] text-ghost" title={owner.purpose}>{owner.purpose || (owner.review_due_at ? `review ${owner.review_due_at.slice(0, 10)}` : "no purpose recorded")}</span>
      </span>
    </span>
  );
}

export function Iam() {
  const [reg, setReg] = useState<Register | null>(null);
  const [people, setPeople] = useState<People | null>(null);
  const [failed, setFailed] = useState(false);
  const [kinds, setKinds] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Set<string>>(new Set());
  const [risks, setRisks] = useState<Set<string>>(new Set());
  const [flags, setFlags] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: "name" | "kind" | "owner" | "last" | "runs" | "risk"; dir: 1 | -1 }>({ key: "kind", dir: 1 });
  const [expanded, setExpanded] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ kind: Kind; id: string } | null>(null);
  const [draft, setDraft] = useState({ owner: "", purpose: "", review: "" });
  const { session: me } = useSession();
  const byName = signerName(me, CURRENT_USER.name);
  const [confirming, setConfirming] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ tone: Tone; text: string; secret?: string } | null>(null);
  // One clock reading per mount; "idle 30 days" must not move while the page is open.
  const [now] = useState(() => Date.now());
  // Sections open on every visit: a demo should never start with a folded page.
  const [folded, setFolded] = useState<Record<string, boolean>>({});
  const toggleFold = (id: string) => setFolded((f) => ({ ...f, [id]: !f[id] }));
  const fold = (id: string) => ({ folded: Boolean(folded[id]), onToggle: () => toggleFold(id) });
  // The drill-down: a number, a segment or a cell, opened onto the records behind it.
  const [drill, setDrill] = useState<
    | { kind: "identities"; title: string; subtitle: string; rows: Identity[]; filter?: { kinds?: string[]; flags?: string[]; statuses?: string[] } }
    | { kind: "people"; title: string; subtitle: string; rows: Person[] }
    | { kind: "findings"; title: string; subtitle: string; rows: Finding[] }
    | { kind: "person"; title: string; subtitle: string; person: Person }
    | null
  >(null);

  const load = () =>
    Promise.all([fetch("/api/iam/identities").then((r) => r.json()), fetch("/api/iam/users").then((r) => r.json())])
      .then(([r, p]) => {
        if (r.error || p.error) throw new Error(String(r.error ?? p.error));
        setReg(r);
        setPeople(p);
      })
      .catch(() => setFailed(true));
  useEffect(() => soon(load), []);

  /* ── the register, under its filters ── */

  const all = useMemo(() => reg?.identities ?? [], [reg]);
  const findingsOf = useMemo(() => {
    const m = new Map<string, Finding[]>();
    for (const f of reg?.findings ?? []) {
      const k = key(f.identity);
      m.set(k, [...(m.get(k) ?? []), f]);
    }
    return m;
  }, [reg]);

  const hasFlag = (i: Identity, flag: string): boolean => {
    const live = i.status !== "revoked";
    switch (flag) {
      case "unowned": return live && !i.owner;
      case "unused": return live && !i.last_used && i.kind !== "workflow";
      case "stale": return live && Boolean(i.last_used) && now - new Date(i.last_used!).getTime() > 30 * DAY;
      case "risky": return i.risk === "risky" || i.risk === "destructive";
      case "blocked": return i.status === "blocked";
      case "findings": return findingsOf.has(key(i));
      default: return true;
    }
  };
  const matches = (i: Identity, skip?: "kind" | "status" | "risk" | "flag") => {
    const term = q.trim().toLowerCase();
    if (skip !== "kind" && kinds.size && !kinds.has(i.kind)) return false;
    if (skip !== "status" && statuses.size && !statuses.has(i.status)) return false;
    if (skip !== "risk" && risks.size && !risks.has(i.risk || "none")) return false;
    if (skip !== "flag" && flags.size && ![...flags].every((f) => hasFlag(i, f))) return false;
    if (term && !(i.name.toLowerCase().includes(term) || i.id.toLowerCase().includes(term) || (i.owner?.owner ?? "").toLowerCase().includes(term) || i.privileges.toLowerCase().includes(term) || i.credential.toLowerCase().includes(term))) return false;
    return true;
  };
  const identities = useMemo(() => {
    const riskRank: Record<string, number> = { destructive: 4, risky: 3, write: 2, read: 1 };
    const rows = all.filter((i) => matches(i));
    rows.sort((a, b) => {
      const d =
        sort.key === "name" ? a.name.localeCompare(b.name)
        : sort.key === "kind" ? KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.name.localeCompare(b.name)
        : sort.key === "owner" ? (a.owner?.owner ?? "~").localeCompare(b.owner?.owner ?? "~")
        : sort.key === "last" ? (b.last_used ? new Date(b.last_used).getTime() : 0) - (a.last_used ? new Date(a.last_used).getTime() : 0)
        : sort.key === "runs" ? (b.runs30d ?? -1) - (a.runs30d ?? -1)
        : (riskRank[b.risk] ?? 0) - (riskRank[a.risk] ?? 0);
      return d * sort.dir;
    });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, kinds, statuses, risks, flags, q, sort, findingsOf]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void) => (v: string) => {
    const next = new Set(set);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    setter(next);
  };
  const filterCount = kinds.size + statuses.size + risks.size + flags.size + (q.trim() ? 1 : 0);
  const clearAll = () => { setKinds(new Set()); setStatuses(new Set()); setRisks(new Set()); setFlags(new Set()); setQ(""); };
  const only = (patch: { kinds?: string[]; flags?: string[]; statuses?: string[] }) => {
    setKinds(new Set(patch.kinds ?? []));
    setFlags(new Set(patch.flags ?? []));
    setStatuses(new Set(patch.statuses ?? []));
    setRisks(new Set());
    setQ("");
    document.getElementById("identities")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const kindChips: Chip[] = KINDS.map((k) => ({ value: k, label: KIND_META[k].plural, count: all.filter((i) => i.kind === k && matches(i, "kind")).length, active: kinds.has(k) }));
  const statusValues = [...new Set(all.map((i) => i.status))];
  const statusChips: Chip[] = statusValues.map((s) => ({ value: s, label: s, count: all.filter((i) => i.status === s && matches(i, "status")).length, active: statuses.has(s), tone: STATUS_TONE[s] === "err" ? "err" : STATUS_TONE[s] === "warn" ? "warn" : undefined }));
  const riskChips: Chip[] = ["read", "write", "risky"].map((r) => ({ value: r, label: r === "risky" ? "acts outside" : r, count: all.filter((i) => (i.risk || "none") === r && matches(i, "risk")).length, active: risks.has(r), tone: r === "risky" ? "err" : r === "write" ? "warn" : "ok" }));
  const flagChips: Chip[] = FLAGS.map((f) => ({ value: f.value, label: f.label, count: all.filter((i) => hasFlag(i, f.value) && matches(i, "flag")).length, active: flags.has(f.value), tone: f.tone }));
  const active = [
    ...[...kinds].map((k) => ({ key: `kind:${k}`, label: KIND_META[k as Kind].plural })),
    ...[...statuses].map((s) => ({ key: `status:${s}`, label: s })),
    ...[...risks].map((r) => ({ key: `risk:${r}`, label: r === "risky" ? "acts outside" : r })),
    ...[...flags].map((f) => ({ key: `flag:${f}`, label: FLAGS.find((x) => x.value === f)?.label ?? f })),
    ...(q.trim() ? [{ key: "q", label: `“${q.trim()}”` }] : []),
  ];
  const clearOne = (k: string) => {
    const [group, v] = k.split(":", 2);
    if (group === "kind") toggle(kinds, setKinds)(v);
    else if (group === "status") toggle(statuses, setStatuses)(v);
    else if (group === "risk") toggle(risks, setRisks)(v);
    else if (group === "flag") toggle(flags, setFlags)(v);
    else setQ("");
  };

  /* ── the posture ── */

  const live = all.filter((i) => i.status !== "revoked");
  const unowned = live.filter((i) => !i.owner).length;
  const owned = live.length - unowned;
  const stale = all.filter((i) => i.kind === "api_key" && i.status === "active" && (hasFlag(i, "unused") || hasFlag(i, "stale") || (i.created_at && now - new Date(i.created_at).getTime() > 90 * DAY))).length;
  const errs = (reg?.findings ?? []).filter((f) => f.severity === "err").length;
  const warns = (reg?.findings ?? []).filter((f) => f.severity === "warn").length;
  const sessionsOpen = people ? people.users.reduce((n, u) => n + u.sessions, 0) : 0;
  const reachBy = ["read", "write", "risky"].map((r) => ({ label: r === "risky" ? "Acts outside the system" : r === "write" ? "Writes records" : "Reads only", value: live.filter((i) => (i.risk || "read") === r).length, color: RISK_COLOR[r], meta: `${live.filter((i) => (i.risk || "read") === r).length}` }));

  /* ── people, including the console's own operator when there is no SSO ── */

  const persons: Person[] = useMemo(() => {
    const rows = people?.users ?? [];
    if (rows.length === 0 && me && me.mode === "local") {
      return [{ sub: me.sub, email: me.email, name: me.name, org_type: me.orgType, is_ey_employee: me.isEy, last_roles: me.roles, last_app_roles: me.appRoles, permissions: me.permissions, first_seen: new Date().toISOString(), last_seen: new Date().toISOString(), sessions: 1, disabled_at: null }];
    }
    return rows;
  }, [people, me]);
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
          filters: { kinds: [...kinds], statuses: [...statuses], risks: [...risks], flags: [...flags], q },
        }
      : null,
  );

  /* ── actions: every one maps onto an endpoint that already exists ── */

  const act = async (label: string, fn: () => Promise<Response>, done: (d: Record<string, unknown>) => { tone: Tone; text: string; secret?: string }) => {
    setBusy(label);
    setConfirming("");
    try {
      const r = await fn();
      const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) throw new Error(String(d.error ?? `HTTP ${r.status}`));
      setNotice(done(d));
      await load();
    } catch (e) {
      setNotice({ tone: "err", text: (e as Error).message });
    } finally {
      setBusy("");
    }
  };
  const json = (method: string, url: string, body?: unknown) => fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const revokeKey = (i: { id: string; name: string }) => act(`revoke:${i.id}`, () => fetch(`/api/keys?id=${encodeURIComponent(i.id)}`, { method: "DELETE" }), () => ({ tone: "ok", text: `Revoked ${i.name}. Anything still presenting it is refused from now.` }));
  const rotateKey = (i: Identity) =>
    act(
      `rotate:${i.id}`,
      async () => {
        const minted = await json("POST", "/api/keys", { name: i.name, agent: (i.facts.agent as string | null) ?? null });
        if (!minted.ok) return minted;
        const d = await minted.clone().json();
        await fetch(`/api/keys?id=${encodeURIComponent(i.id)}`, { method: "DELETE" });
        return new Response(JSON.stringify(d), { status: 200, headers: { "content-type": "application/json" } });
      },
      (d) => ({ tone: "ok", text: `Rotated ${i.name}: the old key is revoked and this is the only time the new one is shown.`, secret: String(d.key ?? "") }),
    );
  const blockAgent = (i: Identity, blocked: boolean) => act(`block:${i.id}`, () => json("PATCH", "/api/attached", { id: i.id, blocked }), () => ({ tone: blocked ? "warn" : "ok", text: blocked ? `${i.name} is blocked; every door refuses it until the block is lifted.` : `${i.name} is unblocked.` }));
  const gateAgent = (i: Identity) => act(`gate:${i.id}`, () => json("PATCH", "/api/attached", { id: i.id, gate_at: "write" }), () => ({ tone: "ok", text: `${i.name} now stops for a person at write and above.` }));
  const disconnectServer = (i: { id: string; name: string }) => act(`disconnect:${i.id}`, () => fetch(`/api/iam/identities?kind=mcp_server&id=${encodeURIComponent(i.id)}`, { method: "DELETE" }), () => ({ tone: "ok", text: `Disconnected ${i.name} from the registry.` }));
  const removeSecret = (i: { id: string; name: string }) => act(`secret:${i.id}`, () => fetch(`/api/vault?name=${encodeURIComponent(i.id)}`, { method: "DELETE" }), () => ({ tone: "ok", text: `Removed \${secret:${i.id}} from the vault.` }));
  const saveOwner = () =>
    editing &&
    act(
      `owner:${editing.id}`,
      () => json("PATCH", "/api/iam/identities", { kind: editing.kind, id: editing.id, owner: draft.owner, purpose: draft.purpose, review_due_at: draft.review || null, by: byName }),
      () => {
        setEditing(null);
        return { tone: "ok", text: draft.owner ? `${draft.owner} now answers for ${editing.id}.` : `Owner cleared on ${editing.id}.` };
      },
    );
  const openOwner = (i: Identity) => {
    setExpanded(key(i));
    setEditing({ kind: i.kind, id: i.id });
    setDraft({ owner: i.owner?.owner ?? "", purpose: i.owner?.purpose ?? "", review: i.owner?.review_due_at?.slice(0, 10) ?? "" });
  };
  const byRef = (f: Finding) => reg?.identities.find((i) => i.kind === f.identity.kind && i.id === f.identity.id);
  const runFinding = (f: Finding) => {
    const i = byRef(f);
    if (!f.action || !i) return;
    switch (f.action.op) {
      case "revoke_key": return revokeKey(i);
      case "rotate_key": return rotateKey(i);
      case "block_agent": return blockAgent(i, true);
      case "gate_agent": return gateAgent(i);
      case "disconnect_server": return disconnectServer(i);
      case "remove_secret": return removeSecret(i);
      case "assign_owner": return openOwner(i);
      case "open_builder": return window.location.assign(i.href ?? "/builder");
    }
  };

  const staleKeys = all.filter((i) => i.kind === "api_key" && i.status === "active" && (hasFlag(i, "unused") || hasFlag(i, "stale") || (i.created_at && now - new Date(i.created_at).getTime() > 90 * DAY)));
  const strip: { label: string; value: string; sub: string; tone?: "err" | "warn" | "ok"; go?: () => void }[] = [
    { label: "People", value: people ? String(persons.length) : "—", sub: people ? (people.sso.configured ? "signed in through the SSO" : "local mode, no SSO") : "", go: () => setDrill({ kind: "people", title: "People", subtitle: "Everyone the identity provider has signed in, with the roles their latest token carried and the permissions those roles map to here.", rows: persons }) },
    { label: "Sessions open", value: people ? String(sessionsOpen) : "—", sub: "server-side, cookie-bound", go: () => setDrill({ kind: "people", title: "Sessions open", subtitle: "People with at least one live session. A session is a server-side row bound to a signed cookie; it dies on sign-out, on disable, or twelve hours after sign-in.", rows: persons.filter((p) => p.sessions > 0) }) },
    { label: "Non-human identities", value: reg ? String(live.length) : "—", sub: reg ? `${KINDS.filter((k) => reg.counts.byKind[k]).length} kinds, every one on the register` : "", go: () => setDrill({ kind: "identities", title: "Non-human identities", subtitle: "Every principal that is not a person and can act on this deployment, read from the records that govern it.", rows: live, filter: {} }) },
    { label: "With a named owner", value: reg ? `${live.length ? Math.round((owned / live.length) * 100) : 0}%` : "—", sub: reg ? `${unowned} still unowned` : "", tone: unowned ? "warn" : "ok", go: () => setDrill({ kind: "identities", title: "Identities without an owner", subtitle: "Live identities nobody has been named as answering for. Assigning an owner is the first control an auditor looks for.", rows: live.filter((i) => !i.owner), filter: { flags: ["unowned"] } }) },
    { label: "Credentials to review", value: reg ? String(stale) : "—", sub: "keys unused, idle or past 90 days", tone: stale ? "warn" : "ok", go: () => setDrill({ kind: "identities", title: "Credentials to review", subtitle: "Active API keys that have never been used, have been idle for thirty days, or are older than ninety days. Rotate or revoke from here.", rows: staleKeys, filter: { kinds: ["api_key"], flags: ["unused"] } }) },
    { label: "Findings", value: reg ? String(reg.counts.findings) : "—", sub: reg ? `${errs} to fix now · ${warns} to review` : "", tone: errs ? "err" : warns ? "warn" : "ok", go: () => setDrill({ kind: "findings", title: "Findings", subtitle: "Computed from the register on this read. Each has the one action that clears it.", rows: reg?.findings ?? [] }) },
  ];

  const sortBtn = (k: typeof sort.key, label: string, right = false) => (
    <th className={`px-3 py-2 font-medium whitespace-nowrap ${right ? "text-right" : ""}`}>
      <button type="button" onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? ((s.dir * -1) as 1 | -1) : 1 }))} className={`focusable inline-flex items-center gap-1 ${sort.key === k ? "text-fg" : ""}`}>
        {label}
        <span aria-hidden className="text-[9px] text-ghost">{sort.key === k ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );

  return (
    <div className="min-h-full">
      <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-5 px-5 py-7">
        {/* ── hero ── */}
        <header className="flex flex-col gap-2">
          <span className="flex flex-wrap items-center gap-3">
            <span className="text-[11px] font-medium tracking-[0.08em] text-faint uppercase">Identity and access</span>
            {people && (people.sso.configured ? <Tag tone="ok" solid>SSO connected</Tag> : <Tag tone="warn" solid>Local mode</Tag>)}
            {people?.sso.demo_default_role && <Tag tone="warn">demo default role: {people.sso.demo_default_role}</Tag>}
          </span>
          <h1 className="max-w-[30ch] text-[26px] leading-[1.15] font-semibold tracking-[-0.02em]">Maintain accountability for every identity.</h1>
          <p className="max-w-[86ch] text-[13px] leading-[1.6] text-faint">
            Review people and their current single sign-on roles alongside the workflows, attached
            agents, MCP servers, keys and credentials that can act within this deployment. Ownership,
            permissions and observed use are derived from current governing records rather than stored assessments.
          </p>
        </header>

        {/* ── posture, each number a way in ── */}
        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line elev-1 sm:grid-cols-3 lg:grid-cols-6">
          {strip.map((k) => (
            <button key={k.label} type="button" onClick={k.go} className="focusable flex flex-col justify-center gap-0.5 bg-surface px-4 py-3 text-left transition-colors hover:bg-raise/60">
              <span className={`tnum text-[22px] leading-none font-semibold tracking-[-0.02em] ${k.tone === "err" ? "text-err" : k.tone === "warn" ? "text-warn" : ""}`}>{k.value}</span>
              <span className="text-[11px] text-faint">{k.label}</span>
              {k.sub && <span className="truncate text-[9.5px] text-ghost">{k.sub}</span>}
            </button>
          ))}
        </section>

        {failed && <p className="text-[12px] text-err">The identity register could not be read from the runtime.</p>}
        {notice && (
          <div className={`flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 ${notice.tone === "err" ? "border-err-line bg-err-bg" : notice.tone === "warn" ? "border-warn-line bg-warn-bg" : "border-ok-line bg-ok-bg"}`}>
            <Status tone={notice.tone}>{notice.text}</Status>
            {notice.secret && (
              <>
                <Mono className="text-[11px] text-fg">{notice.secret}</Mono>
                <Button size="sm" variant="solid" tone="ink" onClick={() => navigator.clipboard?.writeText(notice.secret ?? "")}>Copy</Button>
              </>
            )}
            <span className="grow" />
            <Button size="sm" variant="solid" tone="neutral" onClick={() => setNotice(null)}>Dismiss</Button>
          </div>
        )}

        {/* ── instruments ── */}
        <div className="grid gap-4 lg:grid-cols-4">
          <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 elev-1">
            <span className="text-[11px] font-medium tracking-[0.06em] text-faint uppercase">What can act here</span>
            {reg ? (
              <Donut
                data={KINDS.filter((k) => live.some((i) => i.kind === k)).map((k) => ({ label: KIND_META[k].plural, value: live.filter((i) => i.kind === k).length, color: KIND_META[k].color }))}
                size={104}
                onPick={(label) => {
                  const k = KINDS.find((x) => KIND_META[x].plural === label);
                  if (k) setDrill({ kind: "identities", title: KIND_META[k].plural, subtitle: `Every ${KIND_META[k].label.toLowerCase()} on the register, with its owner, reach and last use.`, rows: live.filter((i) => i.kind === k), filter: { kinds: [k] } });
                }}
              />
            ) : <span className="text-[11px] text-faint">Reading…</span>}
            <span className="text-[10px] text-ghost">Click a segment for the identities behind it.</span>
          </section>
          <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 elev-1">
            <span className="text-[11px] font-medium tracking-[0.06em] text-faint uppercase">Who answers for it</span>
            {reg && (
              <StackedBar
                data={KINDS.filter((k) => live.some((i) => i.kind === k)).map((k) => ({ label: KIND_META[k].glyph, values: [live.filter((i) => i.kind === k && i.owner).length, live.filter((i) => i.kind === k && !i.owner).length] }))}
                keys={["owned", "no owner"]}
                colors={["var(--t-ok)", "var(--t-warn)"]}
                height={120}
                onPick={(label, seg) => {
                  const k = KINDS.find((x) => KIND_META[x].glyph === label);
                  if (!k) return;
                  const rows = live.filter((i) => i.kind === k && (seg === undefined || (seg === "owned") === Boolean(i.owner)));
                  setDrill({ kind: "identities", title: `${KIND_META[k].plural}${seg ? ` · ${seg}` : ""}`, subtitle: seg === "no owner" ? "Identities of this kind with nobody named as answering for them." : seg === "owned" ? "Identities of this kind with a named owner and purpose." : "Every identity of this kind, owned or not.", rows, filter: { kinds: [k], flags: seg === "no owner" ? ["unowned"] : [] } });
                }}
              />
            )}
            <span className="text-[10px] text-ghost">W workflows · A agents · M MCP servers · K keys · V credentials</span>
          </section>
          <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 elev-1">
            <span className="text-[11px] font-medium tracking-[0.06em] text-faint uppercase">How far it reaches</span>
            {reg && (
              <RankBar
                data={reachBy}
                onPick={(label) => {
                  const r = label.startsWith("Acts") ? "risky" : label.startsWith("Writes") ? "write" : "read";
                  setDrill({ kind: "identities", title: label, subtitle: r === "risky" ? "Identities whose tools act outside the system: notifications, records written, actions taken. Each stops for a person unless a policy says otherwise." : r === "write" ? "Identities that can write records inside the platform." : "Identities that can only read.", rows: live.filter((i) => (i.risk || "read") === r) });
                }}
              />
            )}
            <span className="text-[10px] leading-[1.45] text-ghost">Reach is the declared risk of what the identity may call. Anything that acts outside the system stops for a person unless a policy says otherwise.</span>
          </section>
          <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4 elev-1">
            <span className="text-[11px] font-medium tracking-[0.06em] text-faint uppercase">Who may do what</span>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[10.5px]">
                <thead>
                  <tr className="text-faint">
                    <th className="pr-2 pb-1 text-left font-medium">role</th>
                    {permList.map((p) => <th key={p} className="px-1 pb-1 text-center font-medium">{p}</th>)}
                    <th className="pl-2 pb-1 text-right font-medium">held</th>
                  </tr>
                </thead>
                <tbody>
                  {roleList.map((r) => (
                    <tr key={r.role} className="cursor-pointer border-t border-line hover:bg-raise/50" onClick={() => setDrill({ kind: "people", title: `Role · ${r.role}`, subtitle: `People whose latest token carried the ${r.role} role. It grants: ${r.permissions.join(", ")}.`, rows: persons.filter((p) => p.last_app_roles.includes(r.role)) })}>
                      <td className="py-1.5 pr-2 font-mono text-[10.5px] text-fg">{r.role}</td>
                      {permList.map((p) => (
                        <td
                          key={p}
                          className="px-1 py-1.5 text-center"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDrill({ kind: "people", title: `Who may ${p}`, subtitle: `${people?.permissions.find((x) => x.permission === p)?.means ?? ""} Granted by: ${roleList.filter((x) => x.permissions.includes(p)).map((x) => x.role).join(", ") || "no role"}.`, rows: persons.filter((x) => x.permissions.includes(p)) });
                          }}
                        >
                          <span className={`inline-block size-3 rounded-[3px] ${r.permissions.includes(p) ? "bg-ok" : "bg-sunken"}`} title={`${r.role} ${r.permissions.includes(p) ? "may" : "may not"} ${p}`} />
                        </td>
                      ))}
                      <td className="tnum py-1.5 pl-2 text-right text-faint">{holders(r.role)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <span className="text-[10px] text-ghost">Roles are assigned in the identity provider; this platform decides what each one may do.</span>
          </section>
        </div>

        {/* ── people ── */}
        <Section
          id="people"
          {...fold("people")}
          title="People"
          caption="Everyone the identity provider has signed in, keyed on their stable subject and never on email. Roles are assigned centrally; this platform maps each role to what it may do here and re-reads the roles from every token rather than storing a decision."
          meta={people ? (people.sso.configured ? <Tag tone="ok" solid>SSO connected</Tag> : <Tag tone="warn" solid>local mode</Tag>) : null}
        >
          {people && !people.sso.configured && (
            <p className="border-b border-line px-4 py-2.5 text-[11px] leading-[1.6] text-faint">
              Single sign-on is switched on for the production console; on this deployment the console runs as its issued operator. Once people sign in they appear here with the roles their token carried, and their gate answers are signed with that identity.
            </p>
          )}
          <div className="grid gap-px bg-line md:grid-cols-2 xl:grid-cols-3">
            {persons.map((u) => (
              <button
                key={u.sub}
                type="button"
                onClick={() => setDrill({ kind: "person", title: u.name || u.email || u.sub, subtitle: "The person as the identity provider presents them, the roles their latest token carried, and what those roles let them do here.", person: u })}
                className={`focusable flex flex-col gap-2.5 bg-surface p-4 text-left transition-colors hover:bg-raise/50 ${u.disabled_at ? "opacity-60" : ""}`}
              >
                <span className="flex items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-semibold text-on-ink">{initialsOf(u.name || u.email)}</span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-semibold text-fg">{u.name || u.email || u.sub}</span>
                    <span className="truncate text-[10.5px] text-faint">{u.is_ey_employee || u.org_type === "EY" ? "EY" : u.org_type || "external"}{me && u.sub === me.sub ? " · you" : ""}</span>
                  </span>
                  <span className="grow" />
                  {u.disabled_at ? <Status tone="err">disabled</Status> : <Status tone={u.sessions ? "ok" : "neutral"}>{u.sessions ? "signed in" : "signed out"}</Status>}
                </span>
                <span className="flex flex-wrap items-center gap-1">
                  {u.last_app_roles.length ? u.last_app_roles.map((r) => <Tag key={r} tone="run" solid>{r}</Tag>) : <Tag tone="warn">no app role</Tag>}
                  <span className="ml-auto text-[10px] text-ghost">{u.permissions.length} of {permList.length} permissions · details ▶</span>
                </span>
              </button>
            ))}
          </div>
          <div className="grid gap-px border-t border-line bg-line lg:grid-cols-2">
            <div className="flex flex-col bg-surface">
              <span className="border-b border-line px-4 py-2 text-[10.5px] text-ghost">Roles this deployment recognises, as the SSO names them</span>
              {roleList.map((r) => (
                <span key={r.role} className="flex items-start gap-3 border-b border-line px-4 py-2 last:border-0">
                  <Mono className="w-[120px] shrink-0 pt-px text-[11px] text-fg">{r.role}</Mono>
                  <span className="flex flex-wrap gap-1">{r.permissions.map((p) => <Tag key={p}>{p}</Tag>)}</span>
                  <span className="tnum ml-auto text-[10.5px] text-faint">{holders(r.role)} holder{holders(r.role) === 1 ? "" : "s"}</span>
                </span>
              ))}
            </div>
            <div className="flex flex-col bg-surface">
              <span className="border-b border-line px-4 py-2 text-[10.5px] text-ghost">What each permission lets a person do here</span>
              {(people?.permissions ?? []).map((p) => (
                <span key={p.permission} className="flex items-start gap-3 border-b border-line px-4 py-2 last:border-0">
                  <Mono className="w-[120px] shrink-0 pt-px text-[11px] text-fg">{p.permission}</Mono>
                  <span className="min-w-0 grow text-[11px] leading-[1.5] text-faint">{p.means}</span>
                </span>
              ))}
            </div>
          </div>
        </Section>

        {/* ── the register ── */}
        <Section
          id="identities"
          {...fold("identities")}
          title="Non-human identities"
          caption="Every principal that is not a person and can act on this deployment: what it is, what authenticates it, what it may reach, when it last did, and who answers for it. Open a row for the full record."
          meta={reg ? <Tag tone="neutral">{identities.length} of {live.length}</Tag> : null}
        >
          <div className="flex flex-col gap-2.5 border-b border-line px-4 py-3">
            <FilterBar count={filterCount} onClear={clearAll}>
              <Chips items={kindChips} label="Kind" onToggle={toggle(kinds, setKinds)} />
              <Chips items={flagChips} label="Only show" onToggle={toggle(flags, setFlags)} />
            </FilterBar>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <Chips items={riskChips} label="Reach" onToggle={toggle(risks, setRisks)} />
              <div className="grow" />
              <SearchBox value={q} onChange={setQ} placeholder="Name, id, owner, privilege, credential" />
            </div>
            <MoreFilters open={statuses.size > 0}>
              <Chips items={statusChips} label="Status" onToggle={toggle(statuses, setStatuses)} />
            </MoreFilters>
            <ActiveFilters items={active} onClear={clearOne} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] border-collapse text-[11.5px]">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-line text-left text-[10.5px] text-faint">
                  {sortBtn("kind", "Kind")}
                  {sortBtn("name", "Identity")}
                  {sortBtn("owner", "Owner")}
                  <th className="px-3 py-2 font-medium">Authenticates with</th>
                  {sortBtn("risk", "May reach")}
                  {sortBtn("last", "Last used")}
                  {sortBtn("runs", "Runs · 30d", true)}
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {identities.flatMap((i) => {
                  const k = key(i);
                  const isOpen = expanded === k;
                  const mine = findingsOf.get(k) ?? [];
                  const rows = [
                    <tr key={k} onClick={() => setExpanded(isOpen ? null : k)} className={`cursor-pointer border-b border-line transition-colors last:border-0 ${isOpen ? "bg-raise/50" : "hover:bg-raise/40"}`}>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="flex items-center gap-2">
                          <span className="grid size-6 place-items-center rounded-md text-[10px] font-semibold text-white" style={{ background: KIND_META[i.kind].color }}>{KIND_META[i.kind].glyph}</span>
                          <span className="text-[11px] text-dim">{KIND_META[i.kind].label}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex max-w-[280px] flex-col">
                          <span className="flex items-center gap-1.5 truncate text-[12.5px] font-medium text-fg">
                            {i.name}
                            {mine.length > 0 && <span className={`size-1.5 shrink-0 rounded-full ${mine.some((f) => f.severity === "err") ? "bg-err" : "bg-warn"}`} title={`${mine.length} finding${mine.length === 1 ? "" : "s"}`} />}
                            {Boolean(i.facts.demo) && <Tag>sample</Tag>}
                          </span>
                          <span className="truncate font-mono text-[10px] text-faint" title={i.description}>{i.kind === "api_key" ? i.description : i.id}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        {i.owner ? <OwnerChip owner={i.owner} /> : i.status === "revoked" ? <span className="text-ghost">—</span> : <Button size="sm" variant="solid" tone="warn" permission="iam" onClick={() => openOwner(i)} disabled={reg?.store === "db unreachable"}>Assign owner</Button>}
                      </td>
                      <td className="max-w-[240px] px-3 py-2.5 text-[11px] leading-[1.45] text-faint">{i.credential}</td>
                      <td className="max-w-[280px] px-3 py-2.5">
                        <span className="flex items-start gap-1.5">
                          {i.risk && <Tag tone={RISK_TONE[i.risk] ?? "neutral"}>{i.risk === "risky" ? "acts outside" : i.risk}</Tag>}
                          <span className="line-clamp-2 text-[11px] leading-[1.45] text-faint">{i.privileges}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-[11px] text-faint">{ago(i.last_used)}</td>
                      <td className="tnum px-3 py-2.5 text-right whitespace-nowrap">{i.runs30d === null ? <span className="text-ghost">—</span> : i.runs30d}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap"><Status tone={STATUS_TONE[i.status] ?? "neutral"}>{i.status}</Status></td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <span className="inline-flex items-center gap-1.5">
                          {i.kind === "attached_agent" && (
                            <Button size="sm" variant="solid" tone={i.status === "blocked" ? "ok" : "warn"} permission="iam" loading={busy === `block:${i.id}`} onClick={() => blockAgent(i, i.status !== "blocked")}>{i.status === "blocked" ? "Unblock" : "Block"}</Button>
                          )}
                          {i.kind === "api_key" && i.status === "active" && (confirming === k ? (
                            <>
                              <Button size="sm" variant="solid" tone="err" permission="iam" loading={busy === `revoke:${i.id}`} onClick={() => revokeKey(i)}>Revoke now</Button>
                              <Button size="sm" variant="solid" tone="neutral" onClick={() => setConfirming("")}>Keep</Button>
                            </>
                          ) : (
                            <>
                              <Button size="sm" variant="solid" tone="ink" permission="iam" loading={busy === `rotate:${i.id}`} onClick={() => rotateKey(i)}>Rotate</Button>
                              <Button size="sm" variant="solid" tone="err" permission="iam" onClick={() => setConfirming(k)}>Revoke</Button>
                            </>
                          ))}
                          {i.kind === "mcp_server" && (confirming === k ? (
                            <>
                              <Button size="sm" variant="solid" tone="err" permission="iam" loading={busy === `disconnect:${i.id}`} onClick={() => disconnectServer(i)}>Disconnect now</Button>
                              <Button size="sm" variant="solid" tone="neutral" onClick={() => setConfirming("")}>Keep</Button>
                            </>
                          ) : (
                            <Button size="sm" variant="solid" tone="err" permission="iam" onClick={() => setConfirming(k)}>Disconnect</Button>
                          ))}
                          {i.kind === "vault_credential" && (confirming === k ? (
                            <>
                              <Button size="sm" variant="solid" tone="err" permission="iam" loading={busy === `secret:${i.id}`} onClick={() => removeSecret(i)}>Remove now</Button>
                              <Button size="sm" variant="solid" tone="neutral" onClick={() => setConfirming("")}>Keep</Button>
                            </>
                          ) : (
                            <Button size="sm" variant="solid" tone="err" permission="iam" onClick={() => setConfirming(k)}>Remove</Button>
                          ))}
                          <span className={`text-[10px] text-ghost transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden>▶</span>
                        </span>
                      </td>
                    </tr>,
                  ];
                  if (isOpen) {
                    const f = i.facts;
                    const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map(String) : []);
                    const facts: { k: string; v: React.ReactNode }[] = [];
                    if (i.kind === "workflow") facts.push({ k: "Tools granted", v: String(f.tools ?? 0) }, { k: "Gate", v: String(f.gate || "none") }, { k: "Trigger", v: String(f.trigger ?? "prompt") }, { k: "Denials · 30d", v: String(f.denials30d ?? 0) }, { k: "Secrets referenced", v: list(f.secrets).join(", ") || "none" });
                    if (i.kind === "attached_agent") facts.push({ k: "Mode", v: String(f.mode) }, { k: "Grants", v: list(f.grants).join(", ") || "none" }, { k: "Gate at", v: String(f.gate_at || "none") }, { k: "Injection", v: String(f.injection) }, { k: "Blocked", v: f.blocked ? "yes" : "no" });
                    if (i.kind === "mcp_server") facts.push({ k: "Tools", v: list(f.tools).join(", ") || "none" }, { k: "Held by workflows", v: list(f.workflows).join(", ") || "none" }, { k: "Granted to agents", v: list(f.attached).join(", ") || "none" }, { k: "Calls · 30d", v: String(f.calls30d ?? 0) });
                    if (i.kind === "api_key") facts.push({ k: "Scope", v: String(f.agent ?? "any workflow") }, { k: "Prefix", v: <Mono className="text-[11px]">{String(f.prefix ?? "")}</Mono> }, { k: "Created", v: i.created_at ? ago(i.created_at) : "—" });
                    if (i.kind === "vault_credential") facts.push({ k: "Referenced by", v: list(f.referenced_by).join(", ") || "no spec" }, { k: "Declared users", v: list(f.declared_users).join(", ") || "none" }, { k: "Value set", v: f.set ? "yes" : "no" });
                    rows.push(
                      <tr key={`${k}-detail`} className="border-b border-line bg-raise/30">
                        <td colSpan={9} className="px-4 py-3">
                          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
                            <div className="flex flex-col gap-1.5">
                              <span className="text-[10.5px] font-medium tracking-[0.04em] text-ghost uppercase">The record</span>
                              {facts.map((x) => (
                                <span key={x.k} className="flex items-baseline gap-3 text-[11.5px]">
                                  <span className="w-[130px] shrink-0 text-faint">{x.k}</span>
                                  <span className="min-w-0 text-fg">{x.v}</span>
                                </span>
                              ))}
                              <span className="flex items-baseline gap-3 text-[11.5px]"><span className="w-[130px] shrink-0 text-faint">Privileges</span><span className="text-fg">{i.privileges}</span></span>
                              {i.href && <Link href={i.href} className="focusable mt-1 w-fit text-[11.5px] underline decoration-line-strong underline-offset-2 hover:decoration-fg">Open {KIND_META[i.kind].label.toLowerCase()}</Link>}
                            </div>
                            <div className="flex flex-col gap-1.5">
                              <span className="text-[10.5px] font-medium tracking-[0.04em] text-ghost uppercase">Findings</span>
                              {mine.length === 0 && <span className="text-[11.5px] text-faint">None. This identity is owned, used and within policy.</span>}
                              {mine.map((fd) => (
                                <span key={fd.id} className="flex items-start gap-2 text-[11.5px]">
                                  <Status tone={fd.severity === "err" ? "err" : fd.severity === "warn" ? "warn" : "neutral"}>{fd.severity === "err" ? "fix" : fd.severity === "warn" ? "review" : "note"}</Status>
                                  <span className="flex min-w-0 flex-col">
                                    <span className="text-fg">{fd.title}</span>
                                    <span className="text-[10.5px] leading-[1.45] text-faint">{fd.detail}</span>
                                    {fd.action && <Button size="sm" variant="solid" tone={fd.action.op === "revoke_key" || fd.action.op === "disconnect_server" || fd.action.op === "remove_secret" ? "err" : "ink"} permission="iam" className="mt-1 w-fit" loading={busy.endsWith(`:${fd.identity.id}`)} onClick={() => runFinding(fd)}>{fd.action.label}</Button>}
                                  </span>
                                </span>
                              ))}
                            </div>
                            <form
                              className="flex flex-col gap-2"
                              onSubmit={(e) => {
                                e.preventDefault();
                                if (!editing) setEditing({ kind: i.kind, id: i.id });
                                saveOwner();
                              }}
                            >
                              <span className="text-[10.5px] font-medium tracking-[0.04em] text-ghost uppercase">Owner and purpose</span>
                              {editing && editing.id === i.id && editing.kind === i.kind ? (
                                <>
                                  <label className="flex flex-col gap-1"><span className="text-[10.5px] text-ghost">Person</span><input value={draft.owner} onChange={(e) => setDraft((d) => ({ ...d, owner: e.target.value }))} placeholder="name or email" className={`${control} w-full`} /></label>
                                  <label className="flex flex-col gap-1"><span className="text-[10.5px] text-ghost">Purpose</span><input value={draft.purpose} onChange={(e) => setDraft((d) => ({ ...d, purpose: e.target.value }))} placeholder="why this identity exists" className={`${control} w-full`} /></label>
                                  <label className="flex flex-col gap-1"><span className="text-[10.5px] text-ghost">Review due</span><input value={draft.review} onChange={(e) => setDraft((d) => ({ ...d, review: e.target.value }))} placeholder="YYYY-MM-DD" className={`${control} w-[150px] font-mono`} /></label>
                                  <span className="flex gap-2">
                                    <Button type="submit" size="sm" variant="solid" tone="ink" permission="iam" loading={busy === `owner:${i.id}`}>Save</Button>
                                    <Button size="sm" variant="solid" tone="neutral" onClick={() => setEditing(null)}>Cancel</Button>
                                  </span>
                                </>
                              ) : (
                                <>
                                  {i.owner ? <OwnerChip owner={i.owner} /> : <span className="text-[11.5px] text-warn">No owner. An identity nobody answers for is the first thing an auditor asks about.</span>}
                                  {i.owner?.review_due_at && <span className="text-[10.5px] text-faint">Review due {i.owner.review_due_at.slice(0, 10)} · set by {i.owner.updated_by} {ago(i.owner.updated_at)}</span>}
                                  {i.status !== "revoked" && <Button size="sm" variant="solid" tone={i.owner ? "neutral" : "warn"} permission="iam" className="w-fit" onClick={() => openOwner(i)}>{i.owner ? "Change owner" : "Assign owner"}</Button>}
                                </>
                              )}
                            </form>
                          </div>
                        </td>
                      </tr>,
                    );
                  }
                  return rows;
                })}
                {reg && identities.length === 0 && <tr><td colSpan={9} className="px-4 py-4 text-center text-[11.5px] text-faint">Nothing matches these filters.</td></tr>}
                {!reg && !failed && <tr><td colSpan={9} className="px-4 py-3 text-[11.5px] text-faint">Reading the register…</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="border-t border-line px-4 py-2 text-[10.5px] text-ghost">{reg?.basis ?? ""}</p>
        </Section>

        {/* ── findings ── */}
        <Section
          id="findings"
          {...fold("findings")}
          title="Findings"
          caption="Computed from the register on every read: credentials nobody uses, servers nothing holds, risky tools with no gate, identities with no owner. Each clears itself the moment the record changes; each has the one action that clears it."
          meta={reg ? <Tag tone={errs ? "err" : warns ? "warn" : "ok"} solid>{reg.findings.length}</Tag> : null}
        >
          {reg && reg.findings.length === 0 && <p className="px-4 py-3 text-[11.5px] text-faint">Nothing to report. Every identity has an owner and every credential is in use.</p>}
          {(["err", "warn", "info"] as const).map((sev) => {
            const list = (reg?.findings ?? []).filter((f) => f.severity === sev);
            if (!list.length) return null;
            return (
              <div key={sev} className="border-b border-line last:border-0">
                <div className="flex items-center gap-2 bg-raise/40 px-4 py-1.5 text-[10.5px] font-medium tracking-[0.04em] text-faint uppercase">
                  <span className={`size-1.5 rounded-full ${sev === "err" ? "bg-err" : sev === "warn" ? "bg-warn" : "bg-line-strong"}`} />
                  {sev === "err" ? "Fix now" : sev === "warn" ? "Review" : "Notes"} · {list.length}
                </div>
                {list.map((f) => (
                  <div key={f.id} className="flex flex-wrap items-start gap-3 border-t border-line px-4 py-2.5">
                    <button type="button" onClick={() => { setExpanded(key(f.identity)); document.getElementById("identities")?.scrollIntoView({ behavior: "smooth" }); }} className="focusable flex min-w-0 grow flex-col gap-0.5 text-left">
                      <span className="text-[12px] text-fg">
                        {f.title}
                        {f.identity.name && <span className="text-faint"> · {KIND_META[f.identity.kind].label.toLowerCase()} </span>}
                        {f.identity.name && <Mono className="text-[10.5px]">{f.identity.name}</Mono>}
                      </span>
                      <span className="max-w-[90ch] text-[11px] leading-[1.5] text-faint">{f.detail}</span>
                    </button>
                    {f.action && <Button size="sm" variant="solid" tone={f.action.op === "revoke_key" || f.action.op === "disconnect_server" || f.action.op === "remove_secret" ? "err" : "ink"} permission="iam" loading={busy.endsWith(`:${f.identity.id}`)} onClick={() => runFinding(f)}>{f.action.label}</Button>}
                  </div>
                ))}
              </div>
            );
          })}
        </Section>

        {/* ── sign-in audit ── */}
        <Section id="audit" {...fold("audit")} title="Audit trail" caption="Every sign-in, sign-out, refresh failure, re-link, provisioning failure and denial from the identity layer, and every privileged action taken through the console with who took it. Nothing here is inferred." meta={people ? <Tag>{people.events.length} events</Tag> : null}>
          {people && people.events.length === 0 && <p className="px-4 py-3 text-[11.5px] text-faint">No sign-in activity has been recorded yet.</p>}
          {(people?.events ?? []).slice(0, 40).map((e) => (
            <div key={e.id} className="flex items-baseline gap-3 border-b border-line px-4 py-2 last:border-0">
              <Status tone={e.kind === "sign_in" || e.kind === "enabled" ? "ok" : e.kind === "denied" || e.kind === "provision_failed" || e.kind === "disabled" || e.kind === "forbidden" ? "err" : e.kind === "refresh_failed" ? "warn" : e.kind === "action" ? "run" : "neutral"}>{e.kind.replace(/_/g, " ")}</Status>
              <span className="min-w-0 grow truncate text-[11.5px] text-fg">
                {e.kind === "action" || e.kind === "forbidden"
                  ? `${String((e.detail as { actor?: string })?.actor ?? e.email ?? e.sub ?? "—")} · ${String((e.detail as { method?: string })?.method ?? "")} ${String((e.detail as { path?: string })?.path ?? "")}`
                  : e.email || e.sub || "—"}
              </span>
              <span className="min-w-0 max-w-[50%] truncate font-mono text-[10px] text-ghost">{typeof e.detail === "object" && e.detail ? JSON.stringify(e.detail).slice(0, 160) : ""}</span>
              <span className="shrink-0 text-[10.5px] text-faint">{ago(e.at)}</span>
            </div>
          ))}
        </Section>
      </div>

      {drill && (
        <DrillModal
          title={drill.title}
          subtitle={drill.subtitle}
          count={drill.kind === "person" ? undefined : drill.rows.length}
          onClose={() => setDrill(null)}
          actions={
            drill.kind === "identities" && drill.filter ? (
              <Button size="sm" variant="solid" tone="ink" onClick={() => { const f = drill.filter!; setDrill(null); only({ kinds: f.kinds, flags: f.flags, statuses: f.statuses }); }}>
                Show in register
              </Button>
            ) : drill.kind === "findings" ? (
              <Button size="sm" variant="solid" tone="ink" onClick={() => { setDrill(null); document.getElementById("findings")?.scrollIntoView({ behavior: "smooth" }); }}>Open findings</Button>
            ) : drill.kind === "person" ? (
              drill.person.sub.startsWith("local:") ? (
                <span className="text-[11px] text-ghost">console operator</span>
              ) : me && drill.person.sub === me.sub ? (
                <span className="text-[11px] text-ghost" title="Nobody changes their own access; another administrator does it.">this is you</span>
              ) : (
                <>
                  {drill.person.sessions > 0 && <Button size="sm" variant="solid" tone="neutral" permission="iam" loading={busy === `signout:${drill.person.sub}`} onClick={() => { const p = drill.person; setDrill(null); act(`signout:${p.sub}`, () => fetch(`/api/iam/users?sub=${encodeURIComponent(p.sub)}`, { method: "DELETE" }), () => ({ tone: "ok", text: `${p.name || p.email} signed out everywhere.` })); }}>Sign out everywhere</Button>}
                  <Button size="sm" variant="solid" tone={drill.person.disabled_at ? "ok" : "err"} permission="iam" loading={busy === `user:${drill.person.sub}`} onClick={() => { const p = drill.person; setDrill(null); act(`user:${p.sub}`, () => json("PATCH", "/api/iam/users", { sub: p.sub, disabled: !p.disabled_at, by: byName }), () => ({ tone: p.disabled_at ? "ok" : "warn", text: p.disabled_at ? `${p.name || p.email} re-enabled.` : `${p.name || p.email} disabled and signed out everywhere.` })); }}>
                    {drill.person.disabled_at ? "Enable" : "Disable"}
                  </Button>
                </>
              )
            ) : (
              <Button size="sm" variant="solid" tone="ink" onClick={() => { setDrill(null); document.getElementById("people")?.scrollIntoView({ behavior: "smooth" }); }}>Open people</Button>
            )
          }
        >
          {drill.kind === "identities" && (
            <DrillTable<Identity>
              rows={drill.rows}
              keyOf={(i) => key(i)}
              onRow={(i) => { setDrill(null); setExpanded(key(i)); document.getElementById("identities")?.scrollIntoView({ behavior: "smooth" }); }}
              empty="No identities behind this number."
              columns={[
                { label: "Kind", cell: (i) => <span className="flex items-center gap-2 whitespace-nowrap"><span className="grid size-5 place-items-center rounded-md text-[9px] font-semibold text-white" style={{ background: KIND_META[i.kind].color }}>{KIND_META[i.kind].glyph}</span>{KIND_META[i.kind].label}</span> },
                { label: "Identity", cell: (i) => <span className="flex flex-col"><span className="text-[12px] font-medium text-fg">{i.name}</span><span className="font-mono text-[10px] text-faint">{i.kind === "api_key" ? i.description : i.id}</span></span> },
                { label: "Owner", cell: (i) => (i.owner ? <OwnerChip owner={i.owner} /> : <span className="text-warn">none</span>) },
                { label: "May reach", cell: (i) => <span className="flex items-start gap-1.5">{i.risk && <Tag tone={RISK_TONE[i.risk] ?? "neutral"}>{i.risk === "risky" ? "acts outside" : i.risk}</Tag>}<span className="line-clamp-2 max-w-[280px] text-[11px] leading-[1.45] text-faint">{i.privileges}</span></span> },
                { label: "Last used", cell: (i) => <span className="whitespace-nowrap text-faint">{ago(i.last_used)}</span> },
                { label: "Status", cell: (i) => <Status tone={STATUS_TONE[i.status] ?? "neutral"}>{i.status}</Status> },
                { label: "Findings", right: true, cell: (i) => <span className={(findingsOf.get(key(i)) ?? []).length ? "text-warn" : "text-ghost"}>{(findingsOf.get(key(i)) ?? []).length || "—"}</span> },
              ]}
            />
          )}
          {drill.kind === "people" && (
            <DrillTable<Person>
              rows={drill.rows}
              keyOf={(p) => p.sub}
              empty="Nobody behind this number yet."
              columns={[
                { label: "Person", cell: (p) => <span className="flex items-center gap-2"><span className="grid size-6 place-items-center rounded-full bg-ink text-[9px] font-semibold text-on-ink">{initialsOf(p.name || p.email)}</span><span className="flex flex-col"><span className="text-[12px] font-medium text-fg">{p.name || p.email || p.sub}</span><span className="text-[10px] text-faint">{p.email || p.sub}</span></span></span> },
                { label: "Organisation", cell: (p) => <span className="flex gap-1">{p.org_type && <Tag>{p.org_type}</Tag>}{p.is_ey_employee && <Tag tone="ok">EY</Tag>}</span> },
                { label: "Roles", cell: (p) => <span className="flex flex-wrap gap-1">{p.last_app_roles.length ? p.last_app_roles.map((r) => <Tag key={r} tone="run" solid>{r}</Tag>) : <Tag tone="warn">none</Tag>}</span> },
                { label: "May", cell: (p) => <span className="flex flex-wrap gap-1">{p.permissions.map((x) => <span key={x} className="rounded-sm bg-ok/15 px-1.5 py-px text-[10px] text-ok">{x}</span>)}</span> },
                { label: "Sessions", right: true, cell: (p) => p.sessions },
                { label: "Last seen", cell: (p) => <span className="whitespace-nowrap text-faint">{ago(p.last_seen)}</span> },
                { label: "Status", cell: (p) => (p.disabled_at ? <Status tone="err">disabled</Status> : <Status tone="ok">active</Status>) },
              ]}
            />
          )}
          {drill.kind === "person" && (() => {
            const u = drill.person;
            const rows: { k: string; v: React.ReactNode }[] = [
              { k: "Name", v: u.name || "—" },
              { k: "Email", v: u.email || "—" },
              { k: "Subject", v: <Mono className="text-[11px]">{u.sub}</Mono> },
              { k: "Organisation", v: <span className="flex gap-1">{u.org_type ? <Tag>{u.org_type}</Tag> : "—"}{u.is_ey_employee && u.org_type !== "EY" && <Tag tone="ok">EY employee</Tag>}</span> },
              { k: "Roles in this app", v: <span className="flex flex-wrap gap-1">{u.last_app_roles.length ? u.last_app_roles.map((r) => <Tag key={r} tone="run" solid>{r}</Tag>) : <Tag tone="warn">none{people?.sso.demo_default_role ? ` · treated as ${people.sso.demo_default_role} (demo default)` : ""}</Tag>}</span> },
              { k: "Directory roles", v: u.last_roles.length ? u.last_roles.join(", ") : "—" },
              { k: "May", v: <span className="flex flex-wrap gap-1">{permList.map((p) => <span key={p} className={`rounded-sm px-1.5 py-px text-[10px] ${u.permissions.includes(p) ? "bg-ok/15 text-ok" : "bg-sunken text-ghost line-through"}`}>{p}</span>)}</span> },
              { k: "Sessions open", v: String(u.sessions) },
              { k: "First seen", v: ago(u.first_seen) },
              { k: "Last seen", v: ago(u.last_seen) },
              { k: "Access", v: u.disabled_at ? <Status tone="err">disabled {ago(u.disabled_at)}</Status> : <Status tone="ok">enabled</Status> },
            ];
            const events = (people?.events ?? []).filter((e) => e.sub === u.sub || (u.email && e.email === u.email)).slice(0, 12);
            return (
              <div className="grid gap-px bg-line lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
                <div className="flex flex-col bg-surface px-4 py-3">
                  {rows.map((r) => (
                    <span key={r.k} className="flex items-baseline gap-3 border-b border-line py-2 text-[11.5px] last:border-0">
                      <span className="w-[140px] shrink-0 text-faint">{r.k}</span>
                      <span className="min-w-0 text-fg">{r.v}</span>
                    </span>
                  ))}
                </div>
                <div className="flex flex-col bg-surface">
                  <span className="border-b border-line px-4 py-2 text-[10.5px] text-ghost">This person&rsquo;s recent record</span>
                  {events.length === 0 && <span className="px-4 py-3 text-[11.5px] text-faint">No events recorded for this person yet.</span>}
                  {events.map((e) => (
                    <span key={e.id} className="flex items-baseline gap-3 border-b border-line px-4 py-2 text-[11.5px] last:border-0">
                      <Status tone={e.kind === "sign_in" || e.kind === "enabled" ? "ok" : e.kind === "denied" || e.kind === "disabled" || e.kind === "forbidden" ? "err" : e.kind === "action" ? "run" : "neutral"}>{e.kind.replace(/_/g, " ")}</Status>
                      <span className="min-w-0 grow truncate font-mono text-[10px] text-ghost">{typeof e.detail === "object" && e.detail ? JSON.stringify(e.detail).slice(0, 120) : ""}</span>
                      <span className="shrink-0 text-[10.5px] text-faint">{ago(e.at)}</span>
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}
          {drill.kind === "findings" && (
            <DrillTable<Finding>
              rows={drill.rows}
              keyOf={(f) => f.id}
              onRow={(f) => { setDrill(null); setExpanded(key(f.identity)); document.getElementById("identities")?.scrollIntoView({ behavior: "smooth" }); }}
              columns={[
                { label: "Severity", cell: (f) => <Status tone={f.severity === "err" ? "err" : f.severity === "warn" ? "warn" : "neutral"}>{f.severity === "err" ? "fix" : f.severity === "warn" ? "review" : "note"}</Status> },
                { label: "Finding", cell: (f) => <span className="flex flex-col"><span className="text-[12px] text-fg">{f.title}</span><span className="max-w-[60ch] text-[10.5px] leading-[1.45] text-faint">{f.detail}</span></span> },
                { label: "Identity", cell: (f) => <span className="flex flex-col"><span className="text-[11.5px] text-fg">{f.identity.name}</span><span className="text-[10px] text-faint">{KIND_META[f.identity.kind].label}</span></span> },
                { label: "Action", cell: (f) => (f.action ? <Button size="sm" variant="solid" tone={f.action.op === "revoke_key" || f.action.op === "disconnect_server" || f.action.op === "remove_secret" ? "err" : "ink"} permission="iam" loading={busy.endsWith(`:${f.identity.id}`)} onClick={() => { setDrill(null); runFinding(f); }}>{f.action.label}</Button> : <span className="text-ghost">—</span>) },
              ]}
            />
          )}
        </DrillModal>
      )}
    </div>
  );
}
