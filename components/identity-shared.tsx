"use client";

import { useState, type ReactNode } from "react";
import { Button, Mono, Status, type Tone } from "./ui";
import { hueFor } from "@/lib/hue";
import { agentHref } from "@/lib/agent-link";
import { revokeKey } from "@/lib/api/l2";
import type { LiveKey } from "@/lib/api/pending";

/**
 * What the identity roster, the identity page and the IAM page share: the
 * shapes the two IAM doors answer (`GET /api/iam/identities`, `GET
 * /api/iam/users`), one model for a row that is either a person or a
 * non-human identity, and the small pieces all three draw with.
 */

/* ═══════════════════ the doors' shapes ═══════════════════ */

export type Kind = "workflow" | "attached_agent" | "mcp_server" | "api_key" | "vault_credential";

export interface Owner {
  owner: string;
  owner_sub: string | null;
  /** Null when nobody has recorded why the identity exists. */
  purpose: string | null;
  review_due_at: string | null;
  updated_at: string;
  updated_by: string;
}
export interface Identity {
  kind: Kind;
  id: string;
  name: string;
  description: string | null;
  credential: string;
  privileges: string;
  risk: string;
  status: string;
  created_at: string | null;
  last_used: string | null;
  runs30d: number | null;
  owner: Owner | null;
  href: string | null;
  facts: Record<string, unknown>;
}
export type FindingOp = "revoke_key" | "rotate_key" | "block_agent" | "gate_agent" | "disconnect_server" | "remove_secret" | "assign_owner" | "open_builder";
export interface Finding {
  id: string;
  severity: "warn" | "err" | "info";
  identity: { kind: Kind; id: string; name: string };
  title: string;
  detail: string;
  action?: { label: string; op: FindingOp } | null;
}
export interface Register {
  identities: Identity[];
  findings: Finding[];
  counts: { total: number; byKind: Record<string, number>; findings: number; unowned: number };
  store: string;
  basis: string;
  /** The kinds the platform does not build (`mcp_server`, `vault_credential`): none is listed, and their count is not zero but not built. */
  not_built?: string[];
}
export interface Person {
  sub: string;
  email: string;
  /** Null when the sign-in does not say (Google IAP's assertion never does). */
  email_verified: boolean | null;
  name: string;
  /** Null when the sign-in does not carry one. */
  preferred_username: string | null;
  last_roles: string[];
  last_app_roles: string[];
  permissions: string[];
  first_seen: string | null;
  last_seen: string | null;
  sessions: number;
  /** When an administrator held them out; null while they are not. */
  disabled_at: string | null;
  /** Who held them out; null while they are not held out. */
  disabled_by: string | null;
}
export interface AuthEvent {
  id: number;
  at: string;
  /**
   * `sign_in`, `disabled` (held out), `enabled` (let back), `denied` (a held-out
   * person's request refused), `forbidden` (any other refusal), `action_failed`
   * (a permitted change that did not succeed), `action`.
   */
  kind: string;
  sub: string | null;
  email: string | null;
  detail: unknown;
}
export interface People {
  users: Person[];
  events: AuthEvent[];
  /** `demo_default_role` is null where nobody the role map leaves out is given a role. */
  sso: { configured: boolean; issuer: string; demo_default_role: string | null };
  roles: { role: string; permissions: string[] }[];
  permissions: { permission: string; means: string }[];
  store: string;
}

/* ═══════════════════ kinds ═══════════════════ */

export const KIND_META: Record<Kind, { label: string; plural: string; tone: Tone; color: string; glyph: string }> = {
  workflow: { label: "Workflow", plural: "Workflows", tone: "run", color: "var(--t-c2)", glyph: "W" },
  attached_agent: { label: "Attached agent", plural: "Attached agents", tone: "queue", color: "var(--t-c5)", glyph: "A" },
  mcp_server: { label: "MCP server", plural: "MCP servers", tone: "ok", color: "var(--t-c7)", glyph: "M" },
  api_key: { label: "API key", plural: "API keys", tone: "warn", color: "var(--t-c8)", glyph: "K" },
  vault_credential: { label: "Vault credential", plural: "Vault credentials", tone: "neutral", color: "var(--t-c3)", glyph: "V" },
};
export const KINDS = Object.keys(KIND_META) as Kind[];
export const RISK_TONE: Record<string, Tone> = { read: "ok", write: "warn", risky: "err", destructive: "err" };
export const RISK_COLOR: Record<string, string> = { read: "var(--t-ok)", write: "var(--t-warn)", risky: "var(--t-err)", destructive: "var(--t-err)" };
export const STATUS_TONE: Record<string, Tone> = { active: "ok", deployed: "ok", "in use": "ok", saved: "neutral", unreferenced: "warn", unset: "warn", blocked: "err", revoked: "neutral", "awaiting approval": "warn" };
export const riskLabel = (r: string): string => (r === "risky" ? "acts outside" : r);

export const FLAGS = [
  { value: "unowned", label: "No owner", tone: "warn" as const },
  { value: "unused", label: "Never used", tone: "warn" as const },
  { value: "stale", label: "Idle 30 days", tone: "warn" as const },
  { value: "risky", label: "Reaches outside", tone: "err" as const },
  { value: "blocked", label: "Blocked", tone: "err" as const },
  { value: "findings", label: "Has findings", tone: "err" as const },
];
export const DAY = 86_400_000;

/** The three groups the roster's kind filter offers. */
export type Group = "people" | "agents" | "machines";
export const GROUPS: { id: Group; label: string }[] = [
  { id: "people", label: "People" },
  { id: "agents", label: "Agents" },
  { id: "machines", label: "Keys and other machine identities" },
];

/* ═══════════════════ one row, a person or not ═══════════════════ */

export type Entry = { type: "person"; key: string; person: Person } | { type: "identity"; key: string; identity: Identity };

export const identityKey = (i: { kind: Kind; id: string }): string => `${i.kind}:${i.id}`;
export const personKey = (sub: string): string => `person:${sub}`;
export const personEntry = (p: Person): Entry => ({ type: "person", key: personKey(p.sub), person: p });
export const identityEntry = (i: Identity): Entry => ({ type: "identity", key: identityKey(i), identity: i });

export function groupOf(e: Entry): Group {
  if (e.type === "person") return "people";
  return e.identity.kind === "workflow" || e.identity.kind === "attached_agent" ? "agents" : "machines";
}
export const entryName = (e: Entry): string => (e.type === "person" ? e.person.name || e.person.email || e.person.sub : e.identity.name || e.identity.id);
export const kindLabel = (e: Entry): string => (e.type === "person" ? "Person" : KIND_META[e.identity.kind].label);
export const lastSeenOf = (e: Entry): string | null => (e.type === "person" ? e.person.last_seen : e.identity.last_used);

export function statusOf(e: Entry): { tone: Tone; label: string } {
  if (e.type === "person") {
    if (e.person.disabled_at) return { tone: "err", label: "disabled" };
    return e.person.sessions > 0 ? { tone: "ok", label: "signed in" } : { tone: "neutral", label: "signed out" };
  }
  return { tone: STATUS_TONE[e.identity.status] ?? "neutral", label: e.identity.status };
}

/** The address of an identity's page. */
export const identityUrl = (key: string): string => `/iam?identity=${encodeURIComponent(key)}`;

/** The entry an `identity=` value names: its full key, or a bare id, subject or email. */
export function findEntry(entries: Entry[], id: string): Entry | null {
  return (
    entries.find((e) => e.key === id) ??
    entries.find((e) => (e.type === "identity" ? e.identity.id === id : e.person.sub === id || (Boolean(e.person.email) && e.person.email === id))) ??
    null
  );
}

/** Where a non-human identity's own page is; an agent opens on its lifecycle, whatever address the register carries. */
export function recordHref(i: Identity): string | null {
  if (i.kind === "workflow") return agentHref(i.id);
  if (!i.href || i.href.startsWith("/builder")) return null;
  return i.href;
}

/** A finding's button, in this console's words: an agent opens on its own page. */
export const findingActionLabel = (f: Finding): string => (f.action?.op === "open_builder" ? "Open agent" : (f.action?.label ?? ""));
export const destructiveOp = (op: FindingOp): boolean => op === "revoke_key" || op === "disconnect_server" || op === "remove_secret";

/* ═══════════════════ time and names ═══════════════════ */

/** `3m ago`, `2h ago`, `5d ago`; "" when there is no time to tell. */
export function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const mins = Math.round((now - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function initialsOf(s: string): string {
  return (
    s
      .replace(/<.*>/, "")
      .trim()
      .split(/[\s._@-]+/)
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

/* ═══════════════════ the audit trail, per identity ═══════════════════ */

/** Whether a value of an event's detail names `id`: the value itself, a member of a list, or a segment of a path or query. */
function mentions(v: unknown, id: string, depth = 0): boolean {
  if (depth > 4 || v === null || v === undefined) return false;
  if (typeof v === "string") {
    if (v === id) return true;
    if (!v.includes(id)) return false;
    return v.split(/[/?&=\s,]+/).some((part) => part === id || decodeSafe(part) === id);
  }
  if (Array.isArray(v)) return v.some((x) => mentions(x, id, depth + 1));
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).some((x) => mentions(x, id, depth + 1));
  return false;
}
function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * An identity's entries in the audit trail. A person's are those signed with
 * their subject or email, or taken by them as the actor; a non-human
 * identity's are those whose detail names its id (the door it was changed
 * through, the agent an action was for).
 */
export function eventsFor(e: Entry, events: AuthEvent[]): AuthEvent[] {
  if (e.type === "person") {
    const p = e.person;
    return events.filter((ev) => {
      if (ev.sub && ev.sub === p.sub) return true;
      if (p.email && ev.email === p.email) return true;
      const actor = (ev.detail as { actor?: unknown } | null)?.actor;
      return typeof actor === "string" && Boolean(actor) && (actor === p.name || actor === p.email || actor === p.sub);
    });
  }
  const id = e.identity.id;
  if (!id) return [];
  return events.filter((ev) => mentions(ev.detail, id));
}

const EVENT_TONE = (kind: string): Tone =>
  kind === "sign_in" || kind === "enabled"
    ? "ok"
    : kind === "denied" || kind === "provision_failed" || kind === "disabled" || kind === "forbidden" || kind === "action_failed"
      ? "err"
      : kind === "refresh_failed"
        ? "warn"
        : kind === "action"
          ? "run"
          : "neutral";

/** One audit event: what happened, who or what it was about, the detail as recorded, and when. */
export function EventLine({ event: e, now }: { event: AuthEvent; now: number }) {
  const d = (e.detail && typeof e.detail === "object" ? e.detail : {}) as { actor?: unknown; method?: unknown; path?: unknown; action?: unknown };
  const about = e.kind === "disabled" || e.kind === "enabled";
  const line =
    e.kind === "action" || e.kind === "forbidden" || e.kind === "action_failed" || e.kind === "denied"
      ? `${String(d.actor ?? e.email ?? e.sub ?? "not recorded")} · ${String(d.method ?? "")} ${String(d.path ?? "")}`
      : about
        ? `${e.email || e.sub || "not recorded"}${typeof d.actor === "string" && d.actor ? `, by ${d.actor}` : ""}`
        : e.email || e.sub || "not recorded";
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-4 py-2 last:border-0">
      <span className="w-[120px] shrink-0">
        <Status tone={EVENT_TONE(e.kind)}>{e.kind.replace(/_/g, " ")}</Status>
      </span>
      <span className="min-w-0 grow basis-[220px] truncate text-[12px] text-fg">{line}</span>
      <span className="min-w-0 max-w-[46%] truncate font-mono text-[10.5px] text-faint">{e.detail && typeof e.detail === "object" ? JSON.stringify(e.detail).slice(0, 160) : ""}</span>
      <span className="tnum shrink-0 text-[11px] text-faint" title={new Date(e.at).toLocaleString()}>
        {ago(e.at, now)}
      </span>
    </div>
  );
}

/* ═══════════════════ pieces ═══════════════════ */

/** A card whose header folds it; the header carries the subject's hue. */
export function FoldSection({ id, title, caption, meta, children, folded = false, onToggle }: { id: string; title: string; caption: string; meta?: ReactNode; children: ReactNode; folded?: boolean; onToggle?: () => void }) {
  return (
    <section id={id} className="flex scroll-mt-4 flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!folded}
        aria-controls={`${id}-body`}
        data-hue={hueFor(title)}
        className={`focusable flex w-full items-start gap-3 bg-raise/55 px-4 py-2.5 text-left transition-colors hover:bg-raise/80 ${folded ? "" : "border-b border-line"}`}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`mt-0.5 shrink-0 text-faint transition-transform ${folded ? "-rotate-90" : ""}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
        <span className="flex min-w-0 grow flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold tracking-[-0.005em]">
            {title}
            {meta}
          </span>
          {!folded && <span className="max-w-[110ch] text-[11px] leading-[1.55] text-faint">{caption}</span>}
        </span>
        <span className="shrink-0 pt-0.5 text-[10.5px] text-faint">{folded ? "show" : "hide"}</span>
      </button>
      <div id={`${id}-body`} hidden={folded}>
        {children}
      </div>
    </section>
  );
}

/** A card with a plain header, for the identity page's sections. */
export function Card({ id, title, meta, action, children }: { id?: string; title: string; meta?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="flex min-w-0 scroll-mt-4 flex-col overflow-hidden rounded-lg border border-line bg-surface elev-1">
      <div data-hue={hueFor(title)} className="flex flex-wrap items-center gap-2 border-b border-line bg-raise/55 px-4 py-2.5">
        <span className="text-[12.5px] font-semibold tracking-[-0.005em] text-fg">{title}</span>
        {meta && <span className="text-[11px] text-faint">{meta}</span>}
        {action && (
          <>
            <span className="grow" />
            {action}
          </>
        )}
      </div>
      {children}
    </section>
  );
}

export function OwnerChip({ owner }: { owner: Owner }) {
  return (
    <span className="flex items-center gap-2">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink text-[9px] font-semibold text-on-ink">{initialsOf(owner.owner)}</span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[12px] text-fg">{owner.owner}</span>
        <span className="max-w-[220px] truncate text-[10.5px] text-faint" title={owner.purpose ?? undefined}>
          {owner.purpose || (owner.review_due_at ? `review ${owner.review_due_at.slice(0, 10)}` : "no purpose recorded")}
        </span>
      </span>
    </span>
  );
}

/** The square that says what kind a row is: a letter on the kind's colour, a person on the ink. */
export function KindGlyph({ entry, size = "size-6 text-[10px]" }: { entry: Entry; size?: string }) {
  if (entry.type === "person") return <span className={`grid shrink-0 place-items-center rounded-full bg-ink font-semibold text-on-ink ${size}`}>{initialsOf(entryName(entry))}</span>;
  const m = KIND_META[entry.identity.kind];
  return (
    <span className={`grid shrink-0 place-items-center rounded-md font-semibold text-on-solid ${size}`} style={{ background: m.color }}>
      {m.glyph}
    </span>
  );
}

/**
 * The API keys of a person who has just been held out. Holding a person out
 * does not stop their keys (a key acts with its own authority), so each is
 * listed with a way to revoke it, and what revoking answered.
 */
export function LiveKeys({ keys, onRevoked }: { keys: LiveKey[]; onRevoked?: () => void }) {
  const [revoked, setRevoked] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  if (keys.length === 0) return <span className="text-[12px] leading-[1.5] text-dim">No unrevoked API key answers to them, so nothing of theirs keeps working.</span>;
  const left = keys.filter((k) => !revoked[k.id]).length;
  const revoke = async (k: LiveKey) => {
    setBusy(k.id);
    try {
      const r = await revokeKey(k.id);
      setRevoked((m) => ({ ...m, [k.id]: r.revoked_at ?? "" }));
      setFailed((m) => ({ ...m, [k.id]: "" }));
      onRevoked?.();
    } catch (e) {
      setFailed((m) => ({ ...m, [k.id]: (e as Error).message }));
    } finally {
      setBusy("");
    }
  };
  return (
    <span className="flex w-full flex-col gap-1.5">
      <span className="text-[12px] leading-[1.5] text-fg">
        {left === 0
          ? "Every API key that answered to them is now revoked."
          : `${left === 1 ? "One API key" : `${left} API keys`} that answer${left === 1 ? "s" : ""} to them keep${left === 1 ? "s" : ""} working: a key acts with its own authority, not the person's. Revoke ${left === 1 ? "it" : "each"} unless someone else should answer for ${left === 1 ? "it" : "them"}.`}
      </span>
      <span className="flex flex-col overflow-hidden rounded-md border border-line">
        {keys.map((k) => (
          <span key={k.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-canvas px-3 py-1.5 last:border-0">
            <Mono className="text-[11px] text-faint">{k.prefix}…</Mono>
            <span className="min-w-0 grow truncate text-[12px] text-fg">{k.name}</span>
            <span className="text-[11px] text-faint">{k.agent ? `acts only as ${k.agent}` : "not bound to an agent"}</span>
            {revoked[k.id] !== undefined ? (
              <Status tone="neutral">revoked</Status>
            ) : (
              <Button size="sm" variant="solid" tone="err" permission="iam" loading={busy === k.id} onClick={() => void revoke(k)}>
                Revoke
              </Button>
            )}
            {failed[k.id] && <span className="w-full text-[11.5px] leading-[1.5] text-err">Not revoked: {failed[k.id]}</span>}
          </span>
        ))}
      </span>
    </span>
  );
}

/** One finding with the action that clears it. */
export function FindingLine({ finding: f, busy, onRun, showIdentity = false, onOpen }: { finding: Finding; busy: boolean; onRun: (f: Finding) => void; showIdentity?: boolean; onOpen?: () => void }) {
  const body = (
    <>
      <span className="text-[12.5px] text-fg">
        {f.title}
        {showIdentity && f.identity.name && <span className="text-faint"> · {KIND_META[f.identity.kind].label.toLowerCase()} </span>}
        {showIdentity && f.identity.name && <Mono className="text-[11px]">{f.identity.name}</Mono>}
      </span>
      <span className="max-w-[90ch] text-[11.5px] leading-[1.5] text-dim">{f.detail}</span>
    </>
  );
  return (
    <div className="flex flex-wrap items-start gap-3 border-b border-line px-4 py-2.5 last:border-0">
      <span className="w-[62px] shrink-0 pt-0.5">
        <Status tone={f.severity === "err" ? "err" : f.severity === "warn" ? "warn" : "neutral"}>{f.severity === "err" ? "fix" : f.severity === "warn" ? "review" : "note"}</Status>
      </span>
      {onOpen ? (
        <button type="button" onClick={onOpen} className="focusable flex min-w-0 grow basis-[260px] cursor-pointer flex-col gap-0.5 rounded-sm text-left">
          {body}
        </button>
      ) : (
        <span className="flex min-w-0 grow basis-[260px] flex-col gap-0.5">{body}</span>
      )}
      {f.action && (
        <Button size="sm" variant="solid" tone={destructiveOp(f.action.op) ? "err" : "ink"} permission="iam" loading={busy} onClick={() => onRun(f)}>
          {findingActionLabel(f)}
        </Button>
      )}
    </div>
  );
}
